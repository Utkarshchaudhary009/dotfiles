import { requireAgenvRepo } from '../config';
import { loadManifest, Manifest } from '../manifest';
import { log } from '../logger';
import { resolveTarget } from '../resolve';
import { trackedFileState, TrackState } from '../capture';
import { HINTS } from '../errors';
import { gitRemoteState, RemoteState } from '../git';

export interface StatusEntry {
  id: string;
  category: string;
  targetRel: string;
  state: TrackState;
}

export interface StatusSummary {
  total: number;
  ok: number;           // unchanged
  modified: number;     // conflict (disk differs from repo)
  notCaptured: number;  // tracked, but stored copy gone (was 'repo-missing')
  missing: number;      // target-missing (not on disk)
  locked: number;       // encrypted without usable key
}

export interface StatusResult {
  summary: StatusSummary;
  files: StatusEntry[];
  remote: RemoteState;
}

/** Severity ordering so problems surface first in listings. */
const STATE_ORDER: Record<TrackState, number> = {
  conflict: 0,
  'repo-missing': 1,
  locked: 2,
  'target-missing': 3,
  unchanged: 4,
};

const STATE_LABELS: Record<TrackState, string> = {
  unchanged: 'up-to-date',
  conflict: 'modified',
  'repo-missing': 'not yet captured',
  'target-missing': 'missing on disk',
  locked: '🔒 encrypted (no key / decrypt failed)',
};

const REMOTE_LABELS: Record<RemoteState, string> = {
  'in-sync': 'in sync with remote',
  'ahead': 'local commits not pushed',
  'behind': 'remote has new commits',
  'diverged': 'diverged from remote',
  'no-remote': 'no remote configured',
  'unknown': 'remote state unknown',
};

/** Compute per-file states + roll-up counts for the whole manifest. */
export async function collectStatus(rootDir: string, manifest: Manifest): Promise<StatusResult> {
  const summary: StatusSummary = { total: 0, ok: 0, modified: 0, notCaptured: 0, missing: 0, locked: 0 };
  const files: StatusEntry[] = [];

  for (const tf of manifest.files) {
    if (!manifest.config.categories.some(c => c.id === tf.category)) continue;
    const state = await trackedFileState(rootDir, manifest, tf);
    files.push({ id: tf.id, category: tf.category, targetRel: tf.targetRel, state });
    summary.total++;
    switch (state) {
      case 'unchanged': summary.ok++; break;
      case 'conflict': summary.modified++; break;
      case 'repo-missing': summary.notCaptured++; break;
      case 'target-missing': summary.missing++; break;
      case 'locked': summary.locked++; break;
    }
  }

  files.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      a.category.localeCompare(b.category) ||
      a.targetRel.localeCompare(b.targetRel)
  );

  // Remote state is best-effort; never let a Git hiccup break status.
  let remote: RemoteState;
  try {
    remote = await gitRemoteState(rootDir);
  } catch (e) {
    // `gitRemoteState` is designed not to throw, but keep this guard so a
    // future change can't take down the whole status command.
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`Could not read remote state: ${msg}`);
    remote = 'unknown';
  }

  return { summary, files, remote };
}

/**
 * Actionable next steps derived from the status breakdown.
 * `keyPath` is the manifest's configured encryption key location so the
 * locked hint points at the real key file, not just the default one.
 */
export function statusHints(s: StatusSummary, keyPath?: string, remote: RemoteState = 'no-remote'): string[] {
  const hints: string[] = [];
  if (s.modified > 0) hints.push(`${s.modified} modified — capture with: agenv add <path> --update`);
  if (s.notCaptured > 0) hints.push(`${s.notCaptured} not yet captured — recapture with: agenv add <path> --update  (or: agenv scan --apply --update)`);
  if (s.missing > 0) hints.push(`${s.missing} missing on disk — restore with: agenv expand${s.modified > 0 ? ' (careful: local edits exist)' : ''}`);
  if (s.locked > 0) hints.push(HINTS.keyMissing(keyPath));
  if (remote === 'ahead') {
    hints.push(`Remote is ${REMOTE_LABELS[remote]} — publish with: agenv push`);
  } else if (remote === 'diverged') {
    // Diverged branches need reconciliation before any push can succeed.
    hints.push(`Remote is ${REMOTE_LABELS[remote]} — reconcile with: agenv sync (handles pull+rebase+push)`);
  } else if (remote === 'behind') {
    hints.push(`Remote is ${REMOTE_LABELS[remote]} — pull with: agenv sync`);
  } else if (remote === 'no-remote' && s.total > 0) {
    hints.push(`No remote configured — publish with: agenv publish <url>`);
  }
  if (hints.length === 0 && s.total > 0) hints.push('Everything in sync — back up with: agenv push');
  return hints;
}

function summarizeLine(s: StatusSummary, remote: RemoteState): string {
  const bits = [`${s.total} tracked`, `${s.modified} modified`, `${s.notCaptured} not captured`, `${s.missing} missing`];
  if (s.locked > 0) bits.push(`${s.locked} 🔒`);
  bits.push(`${s.ok} ok`);
  bits.push(`remote: ${REMOTE_LABELS[remote]}`);
  return `Status: ${bits.join(', ')}`;
}

export async function statusCommand(target?: string, options: { json?: boolean } = {}) {
  const resolved = await resolveTarget(target);
  const found = await requireAgenvRepo(resolved.path);

  const manifest = await loadManifest(found.rootDir);
  const result = await collectStatus(found.rootDir, manifest);

  if (options.json) {
    log.json(result);
    return;
  }

  // Summary first, then rows grouped by severity (problems before ok).
  log.info(summarizeLine(result.summary, result.remote));
  if (result.files.length === 0) {
    log.hint("Nothing tracked yet — run: agenv add <tool|path>, or 'agenv scan --apply'");
    return;
  }
  log.sectionTitle('Files');
  log.table(result.files.map(f => [f.category, f.targetRel, STATE_LABELS[f.state]]));
  for (const h of statusHints(result.summary, manifest.config.encryption.keyPath, result.remote)) log.hint(h);
}
