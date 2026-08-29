import { gitRemoteState, RemoteState } from './git';
import { runProcess } from './proc';
import * as path from 'node:path';
import { pathExists } from './fs';
import { Manifest } from './manifest';
import { trackedFileState } from './capture';

export type SyncAction =
  | 'noop'
  | 'pull'
  | 'capture-and-push'
  | 'pull-and-push'
  | 'diverged-rebase'
  | 'diverged-conflict'
  | 'error';

export interface ConflictFile {
  id: string;
  targetRel: string;
  reason: 'local-and-remote-changed' | 'repo-missing' | 'local-modified-no-remote';
}

export interface SyncPlan {
  action: SyncAction;
  remote: RemoteState;
  hasLocalChanges: boolean;
  hasRemoteAhead: boolean;
  hasRemoteBehind: boolean;
  hasWorkingTreeChanges: boolean;
  conflicts: ConflictFile[];
  nextCommand: string;
  reason: string;
}

export interface ReconcileOptions {
  rebase?: boolean;
  strictWorkingTree?: boolean;
}

async function hasOrigin(rootDir: string): Promise<boolean> {
  const r = await runProcess(['git', 'remote', 'get-url', 'origin'], { cwd: rootDir });
  return r.code === 0 && r.stdout.trim().length > 0;
}

export async function planReconcile(
  rootDir: string,
  manifest: Manifest,
  options: ReconcileOptions = {},
): Promise<SyncPlan> {
  if (await hasOrigin(rootDir)) {
    await runProcess(['git', 'fetch', '--quiet', 'origin'], { cwd: rootDir }).catch(() => undefined);
  }
  const remote = await gitRemoteState(rootDir);

  const porcelain = await runProcess(['git', 'status', '--porcelain'], { cwd: rootDir });
  const workingTreeLines = porcelain.stdout.split('\n').filter(Boolean);
  const hasWorkingTreeChanges = workingTreeLines.length > 0;

  const conflicts: ConflictFile[] = [];
  const drift: ConflictFile[] = [];
  for (const tf of manifest.files) {
    if (!manifest.config.categories.some(c => c.id === tf.category)) continue;
    const state = await trackedFileState(rootDir, manifest, tf);
    if (state === 'conflict') {
      conflicts.push({ id: tf.id, targetRel: tf.targetRel, reason: 'local-and-remote-changed' });
    } else if (state === 'repo-missing') {
      drift.push({ id: tf.id, targetRel: tf.targetRel, reason: 'repo-missing' });
    }
  }

  const hasLocalChanges = conflicts.length > 0 || drift.length > 0;
  const hasRemoteAhead = remote === 'ahead' || remote === 'diverged';
  const hasRemoteBehind = remote === 'behind' || remote === 'diverged';

  if (remote === 'unknown') {
    return {
      action: 'error',
      remote,
      hasLocalChanges,
      hasRemoteAhead,
      hasRemoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: 'agenv status',
      reason: 'Could not determine remote state',
    };
  }

  if (remote === 'no-remote') {
    if (!hasLocalChanges && !hasWorkingTreeChanges) {
      return {
        action: 'noop',
        remote,
        hasLocalChanges,
        hasRemoteAhead,
        hasRemoteBehind,
        hasWorkingTreeChanges,
        conflicts,
        nextCommand: '',
        reason: 'No remote, no local changes',
      };
    }
    return {
      action: 'capture-and-push',
      remote,
      hasLocalChanges,
      hasRemoteAhead,
      hasRemoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: hasLocalChanges
        ? 'Local changes need to be captured'
        : 'Working tree has changes that need committing',
    };
  }

  if (remote === 'diverged') {
    if (options.rebase) {
      return {
        action: 'diverged-rebase',
        remote,
        hasLocalChanges,
        hasRemoteAhead,
        hasRemoteBehind,
        hasWorkingTreeChanges,
        conflicts,
        nextCommand: '',
        reason: 'Branches diverged; rebase will reconcile',
      };
    }
    return {
      action: 'diverged-conflict',
      remote,
      hasLocalChanges,
      hasRemoteAhead,
      hasRemoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: 'agenv sync --rebase',
      reason: 'Branches diverged; rebase required to reconcile',
    };
  }

  // remote === 'in-sync' | 'ahead' | 'behind'
  if (!hasLocalChanges && !hasWorkingTreeChanges && !hasRemoteAhead && !hasRemoteBehind) {
    return {
      action: 'noop',
      remote,
      hasLocalChanges,
      hasRemoteAhead,
      hasRemoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: 'Local, repository, and remote are all in sync',
    };
  }

  if (hasRemoteAhead && !hasLocalChanges && !hasWorkingTreeChanges) {
    return {
      action: 'pull',
      remote,
      hasLocalChanges,
      hasRemoteAhead,
      hasRemoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: 'Remote has new commits to pull',
    };
  }

  if (hasRemoteBehind) {
    return {
      action: hasLocalChanges || hasWorkingTreeChanges ? 'pull-and-push' : 'capture-and-push',
      remote,
      hasLocalChanges,
      hasRemoteAhead,
      hasRemoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: hasLocalChanges
        ? 'Remote has commits and local has changes — pull then push'
        : hasWorkingTreeChanges
          ? 'Remote has commits and working tree has changes — pull then push'
          : 'Local has unpushed commits',
    };
  }

  if (hasRemoteAhead && hasLocalChanges) {
    return {
      action: 'pull-and-push',
      remote,
      hasLocalChanges,
      hasRemoteAhead,
      hasRemoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: 'Local and remote both have changes',
    };
  }

  if (hasWorkingTreeChanges) {
    return {
      action: 'capture-and-push',
      remote,
      hasLocalChanges,
      hasRemoteAhead,
      hasRemoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: 'Working tree has changes to commit',
    };
  }

  return {
    action: 'noop',
    remote,
    hasLocalChanges,
    hasRemoteAhead,
    hasRemoteBehind,
    hasWorkingTreeChanges,
    conflicts,
    nextCommand: '',
    reason: 'Nothing to do',
  };
}

export function isInsideRepo(rootDir: string, filePath: string): boolean {
  const rel = path.relative(rootDir, filePath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export async function stageCanonicalFiles(rootDir: string): Promise<string[]> {
  const staged: string[] = [];
  for (const candidate of ['agenv.json', 'files', '.gitignore', 'README.md']) {
    if (await pathExists(path.join(rootDir, candidate))) {
      staged.push(candidate);
    }
  }
  return staged;
}
