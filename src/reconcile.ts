import { gitRemoteState, RemoteState } from './git';
import { runProcess } from './proc';
import * as path from 'node:path';
import { pathExists } from './fs';
import { Manifest, repoStorePath, TrackedFile } from './manifest';
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
  /** True when the remote has commits the local branch does not (pull required). */
  hasRemoteAhead: boolean;
  /** True when the local branch has commits the remote does not (push required). */
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
 *
 * Returns true if at least one fetch succeeded, false if all attempts
 * failed. A failure here MUST be honored by the caller — classifying
 * against stale `origin/*` refs after a failed fetch would silently
 * report an offline repository as "in-sync" with the server.
 */
async function fetchOriginWithRetry(rootDir: string, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const r = await runProcess(['git', 'fetch', '--quiet', 'origin'], { cwd: rootDir });
    if (r.code === 0) return true;
    if (i < attempts - 1) {
      await new Promise(res => setTimeout(res, 50 * (i + 1)));
    }
  }
  return false;
}

export async function planReconcile(
  rootDir: string,
  manifest: Manifest,
  options: ReconcileOptions = {},
): Promise<SyncPlan> {
  if (await hasOrigin(rootDir)) {
    const fetched = await fetchOriginWithRetry(rootDir);
    // If every fetch attempt failed we must not classify against stale
    // origin/* refs — the user expects an "unknown" / error state when
    // the network or auth is broken. Force the remote classification to
    // 'unknown' so the planner returns action: 'error' with a recovery
    // command, exactly as if gitRemoteState had surfaced it directly.
    if (!fetched) {
      return {
        action: 'error',
        remote: 'unknown',
        hasLocalChanges: false,
        hasRemoteAhead: false,
        hasRemoteBehind: false,
        hasWorkingTreeChanges: false,
        conflicts: [],
        nextCommand: 'agenv status',
        reason: 'Could not reach origin (network, auth, or repository missing)',
      };
    }
  }
  const remote = await gitRemoteState(rootDir);

  const porcelain = await runProcess(['git', 'status', '--porcelain'], { cwd: rootDir });
  // Filter out untracked canonical files (agenv.json, files/, .gitignore,
  // README.md) — these are part of the manifest and would otherwise be
  // treated as "working-tree changes" the moment a repo is initialized.
  // Porcelain v1 lines look like '?? <path>' for untracked entries; the
  // path may contain spaces. Match by whole path, not substring, so a
  // file like 'myfiles/agenv.json.bak' does not collide.
  const expectedUntracked = new Set(['agenv.json', 'files/', '.gitignore', 'README.md']);
  const workingTreeLines = porcelain.stdout
    .split('\n')
    .filter(Boolean)
    .filter(line => {
      if (!line.startsWith('??')) return true;
      const entryPath = line.slice(3).trim();
      if (expectedUntracked.has(entryPath)) return false;
      // Treat any file inside files/ as canonical (it is a tracked-files dir).
      if (entryPath.startsWith('files/')) return false;
      return true;
    });
  const hasWorkingTreeChanges = workingTreeLines.length > 0;

  // Classify a real file-level conflict with a three-way comparison:
  // the user's local target, the local repo-store/base copy, and the
  // incoming remote repo-store copy must all differ. Local drift plus an
  // unrelated remote commit is ordinary reconciliation, not a conflict.
  const conflicts: ConflictFile[] = [];
  const drift: ConflictFile[] = [];
  for (const tf of manifest.files) {
    if (!manifest.config.categories.some(c => c.id === tf.category)) continue;
    const state = await trackedFileState(rootDir, manifest, tf);
    if (state !== 'conflict' && state !== 'repo-missing') continue;
    const isRealConflict = (remote === 'behind' || remote === 'diverged')
      ? await isTrueRemoteConflict(rootDir, manifest, tf)
      : false;
    if (isRealConflict) {
      conflicts.push({ id: tf.id, targetRel: tf.targetRel, reason: 'local-and-remote-changed' });
    } else {
      drift.push({ id: tf.id, targetRel: tf.targetRel, reason: 'repo-missing' });
    }
  }

  const hasLocalChanges = conflicts.length > 0 || drift.length > 0;
  // "remoteAhead" = remote has commits local does not → local must pull.
  // "remoteBehind" = local has commits remote does not → local must push.
  const { hasRemoteAhead: remoteAhead, hasRemoteBehind: remoteBehind } = remoteFlags(remote);

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

  if (conflicts.length > 0) {
    return {
      action: 'diverged-conflict',
      remote,
      hasLocalChanges,
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: `agenv status`,
      reason: `${conflicts.length} tracked file conflict${conflicts.length === 1 ? '' : 's'} require manual resolution before sync can expand`,
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

  // Tracked file drift was detected but the working tree itself is
  // already clean (e.g. the user ran `agenv capture` first, or a previous
  // step already wrote the drift into the repo store). We must still
  // commit and push it.
  if (hasLocalChanges) {
    return {
      action: 'capture-and-push',
      remote,
      hasLocalChanges,
      hasRemoteAhead: remoteAhead,
      hasRemoteBehind: remoteBehind,
      hasWorkingTreeChanges,
      conflicts,
      nextCommand: '',
      reason: 'Tracked file drift captured; commit and push',
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

/**
 * Determine whether a tracked file's local drift is a true
 * local-vs-remote conflict or just ordinary local drift.
 *
 * Returns true when the local target differs from the repo store AND
 * also differs from the incoming remote tree (i.e. both sides have
 * changed the file). Returns false when the local target matches the
 * incoming remote (pull will replace it cleanly) or when no upstream
 * comparison is possible (no origin, no upstream, or path missing
 * remotely). Best-effort: any git error during the comparison returns
 * false so the planner does not block on read-only Git operations.
 */
async function isTrueRemoteConflict(
  rootDir: string,
  manifest: Manifest,
  tf: TrackedFile,
): Promise<boolean> {
  // Only meaningful when we have a fetchable origin with an upstream.
  const upstreamRes = await runProcess(
    ['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { cwd: rootDir },
  );
  if (upstreamRes.code !== 0) return false;
  const upstream = upstreamRes.stdout.trim();

  // Hash the local target file as it lives on disk right now.
  const cat = manifest.config.categories.find(c => c.id === tf.category);
  if (!cat) return false;
  const { targetPathFor, expandHome } = await import('./platform');
  const targetPath = targetPathFor(cat.targetRoot, tf.targetRel);
  const expanded = expandHome(targetPath);
  let localHash: string;
  try {
    localHash = await (await import('./fs')).fileHash(expanded);
  } catch {
    return false; // local file does not exist or unreadable
  }

  // Hash the remote's canonical repo-store copy without writing it to a
  // temp file. If the remote has no such path the command exits non-zero
  // and we return false (no conflict can be asserted).
  const remoteHashRes = await runProcess(
    ['git', 'show', `${upstream}:${path.relative(rootDir, repoStorePath(rootDir, tf)).replace(/\\/g, '/')}`],
    { cwd: rootDir },
  );
  if (remoteHashRes.code !== 0) return false;
  const crypto = await import('node:crypto');
  const remoteHash = crypto.createHash('sha256').update(remoteHashRes.stdout).digest('hex');
  let baseHash: string;
  try {
    baseHash = await (await import('./fs')).fileHash(repoStorePath(rootDir, tf));
  } catch {
    return localHash !== remoteHash;
  }

  return localHash !== baseHash && remoteHash !== baseHash && localHash !== remoteHash;
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

export function remoteFlags(remote: RemoteState): { hasRemoteAhead: boolean; hasRemoteBehind: boolean } {
  return {
    hasRemoteAhead: remote === 'behind' || remote === 'diverged',
    hasRemoteBehind: remote === 'ahead' || remote === 'diverged',
  };
}
