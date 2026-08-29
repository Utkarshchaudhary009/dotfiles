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

/**
 * Best-effort `git fetch origin` that retries briefly. The planner must
 * observe the latest server state, so when a sibling process has just
 * pushed (or a flaky network dropped the first attempt) we give it a
 * moment. The user's view of "behind / diverged" must never be stale by
 * more than a fraction of a second.
 */
async function fetchOriginWithRetry(rootDir: string, attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const r = await runProcess(['git', 'fetch', '--quiet', 'origin'], { cwd: rootDir });
    if (r.code === 0) return;
    if (i < attempts - 1) {
      await new Promise(res => setTimeout(res, 50 * (i + 1)));
    }
  }
}

export async function planReconcile(
  rootDir: string,
  manifest: Manifest,
  options: ReconcileOptions = {},
): Promise<SyncPlan> {
  if (await hasOrigin(rootDir)) {
    await fetchOriginWithRetry(rootDir);
  }
  const remote = await gitRemoteState(rootDir);

  const porcelain = await runProcess(['git', 'status', '--porcelain'], { cwd: rootDir });
  // Filter out untracked canonical files (agenv.json, files/, .gitignore,
  // README.md) — these are part of the manifest and would otherwise be
  // treated as "working-tree changes" the moment a repo is initialized.
  const expectedUntracked = ['agenv.json', 'files/', '.gitignore', 'README.md'];
  const workingTreeLines = porcelain.stdout
    .split('\n')
    .filter(Boolean)
    .filter(line => {
      const isUntracked = line.startsWith('??');
      if (!isUntracked) return true;
      return !expectedUntracked.some(p => line.includes(p));
    });
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
  // "remoteAhead" = remote has commits local does not → local must pull.
  // "remoteBehind" = local has commits remote does not → local must push.
  const remoteAhead = remote === 'behind' || remote === 'diverged';
  const remoteBehind = remote === 'ahead' || remote === 'diverged';

  if (remote === 'unknown') {
    return {
      action: 'error',
      remote,
      hasLocalChanges,
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
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
        hasRemoteAhead: remoteAhead,
        hasRemoteBehind: remoteBehind,
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
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
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
        hasRemoteAhead: remoteAhead,
        hasRemoteBehind: remoteBehind,
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
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: 'agenv sync --rebase',
      reason: 'Branches diverged; rebase required to reconcile',
    };
  }

  // remote === 'in-sync' | 'ahead' | 'behind'
  if (!hasLocalChanges && !hasWorkingTreeChanges && !remoteAhead && !remoteBehind) {
    return {
      action: 'noop',
      remote,
      hasLocalChanges,
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: 'Local, repository, and remote are all in sync',
    };
  }

  if (remoteAhead && !hasLocalChanges && !hasWorkingTreeChanges) {
    return {
      action: 'pull',
      remote,
      hasLocalChanges,
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: 'Remote has new commits to pull',
    };
  }

  // Remote has commits and the working tree is dirty (untracked files).
  // Pull first so we don't lose remote commits; the executor will not
  // auto-commit arbitrary untracked files anyway.
  if (remoteAhead && hasWorkingTreeChanges && !hasLocalChanges) {
    return {
      action: 'pull',
      remote,
      hasLocalChanges,
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: 'Remote has commits and working tree is dirty — pull, leave working tree alone',
    };
  }

  if (remoteBehind) {
    // When there is real manifest drift we must commit it before pushing,
    // so we combine pull and push. When there is only a dirty working tree
    // (untracked files outside the manifest), we still want to pull first
    // so we don't lose remote commits; the executor will not auto-commit
    // arbitrary untracked files anyway.
    if (hasLocalChanges) {
      return {
        action: 'pull-and-push',
        remote,
        hasLocalChanges,
        hasRemoteAhead: remoteAhead,
        hasRemoteBehind: remoteBehind,
        hasWorkingTreeChanges,
        conflicts,
        nextCommand: '',
        reason: 'Remote has commits and local manifest drift — pull then push',
      };
    }
    return {
      action: hasWorkingTreeChanges ? 'pull' : 'capture-and-push',
      remote,
      hasLocalChanges,
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: hasWorkingTreeChanges
        ? 'Remote has commits and working tree is dirty — pull, then commit what the manifest owns'
        : 'Local has unpushed commits',
    };
  }

  if (remoteAhead && hasLocalChanges) {
    return {
      action: 'pull-and-push',
      remote,
      hasLocalChanges,
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
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
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
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
    hasRemoteAhead: remoteAhead,
    hasRemoteBehind: remoteBehind,
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
