import { requireAgenvRepo } from '../config';
import { loadManifest, Manifest } from '../manifest';
import { log } from '../logger';
import { resolveTarget } from '../resolve';
import { trackedFileState, TrackState } from '../capture';
import { HINTS } from '../errors';

export interface StatusEntry {
  id: string;
  category: string;
  targetRel: string;
  state: TrackState;
}

export interface StatusSummary {
  total: number;
  ok: number;          // unchanged
  modified: number;    // conflict (disk differs from repo)
  newInTarget: number; // repo-missing (never captured)
  missing: number;     // target-missing (not on disk)
  locked: number;      // encrypted without usable key
}

export interface StatusResult {
  summary: StatusSummary;
  files: StatusEntry[];
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
  'repo-missing': 'new in target (not in repo)',
  'target-missing': 'missing',
  locked: '🔒 encrypted (no key / decrypt failed)',
};

/** Compute per-file states + roll-up counts for the whole manifest. */
export async function collectStatus(rootDir: string, manifest: Manifest): Promise<StatusResult> {
  const summary: StatusSummary = { total: 0, ok: 0, modified: 0, newInTarget: 0, missing: 0, locked: 0 };
  const files: StatusEntry[] = [];

  for (const tf of manifest.files) {
    if (!manifest.config.categories.some(c => c.id === tf.category)) continue;
    const state = await trackedFileState(rootDir, manifest, tf);
    files.push({ id: tf.id, category: tf.category, targetRel: tf.targetRel, state });
    summary.total++;
    switch (state) {
      case 'unchanged': summary.ok++; break;
      case 'conflict': summary.modified++; break;
      case 'repo-missing': summary.newInTarget++; break;
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
  return { summary, files };
}

/** Actionable next steps derived from the status breakdown. */
export function statusHints(s: StatusSummary): string[] {
  const hints: string[] = [];
  if (s.modified > 0) hints.push(`${s.modified} modified — capture with: agenv add <path> --update  (or: agenv sync)`);
  if (s.newInTarget > 0) hints.push(`${s.newInTarget} not yet in repo — track with: agenv add <tool>  (e.g. agenv add opencode)`);
  if (s.missing > 0) hints.push(`${s.missing} missing on disk — restore with: agenv expand${s.modified > 0 ? ' (careful: local edits exist)' : ''}`);
  if (s.locked > 0) hints.push(HINTS.keyMissing());
  if (hints.length === 0 && s.total > 0) hints.push('Everything in sync — back up with: agenv push');
  return hints;
}

function summarizeLine(s: StatusSummary): string {
  const bits = [`${s.total} tracked`, `${s.modified} modified`, `${s.newInTarget} new`, `${s.missing} missing`];
  if (s.locked > 0) bits.push(`${s.locked} 🔒`);
  return `Status: ${bits.join(', ')}, ${s.ok} ok`;
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
  log.info(summarizeLine(result.summary));
  if (result.files.length === 0) {
    log.hint("Nothing tracked yet — run: agenv add <tool|path>, or 'agenv scan --apply'");
    return;
  }
  log.sectionTitle('Files');
  log.table(result.files.map(f => [f.category, f.targetRel, STATE_LABELS[f.state]]));
  for (const h of statusHints(result.summary)) log.hint(h);
}
