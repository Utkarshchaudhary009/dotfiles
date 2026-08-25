import * as clack from '@clack/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Manifest, TrackedFile, repoStorePath } from './manifest';
import { targetPathFor, expandHome } from './platform';
import { pathExists, listFilesRecursive, fileHash, readText } from './fs';
import { captureFiles, decryptToMemory } from './deploy';
import { log, isJsonMode } from './logger';
import { CLIError } from './errors';

/** Relationship between a tracked file's disk copy and its repo store copy. */
export type TrackState =
  | 'unchanged'      // disk == repo copy
  | 'repo-missing'   // exists on disk, never captured
  | 'target-missing' // not on disk (expand would restore it)
  | 'locked'         // encrypted but key missing / decrypt failed
  | 'conflict';      // both exist and differ

function categoryFor(manifest: Manifest, tf: TrackedFile) {
  return manifest.config.categories.find(c => c.id === tf.category);
}

export function targetPathOf(manifest: Manifest, tf: TrackedFile): string {
  const cat = categoryFor(manifest, tf);
  if (!cat) throw new CLIError(`Unknown category '${tf.category}' for ${tf.id}`);
  return targetPathFor(cat.targetRoot, tf.targetRel);
}

/** Compare one tracked file's disk copy against its repo store copy. */
export async function trackedFileState(rootDir: string, manifest: Manifest, tf: TrackedFile): Promise<TrackState> {
  let targetPath: string;
  try {
    targetPath = targetPathOf(manifest, tf);
  } catch {
    return 'target-missing';
  }
  const repoPath = repoStorePath(rootDir, tf);

  if (!(await pathExists(targetPath))) return 'target-missing';
  if (!(await pathExists(repoPath))) return 'repo-missing';

  if (!tf.encrypt) {
    return (await fileHash(repoPath)) === (await fileHash(targetPath)) ? 'unchanged' : 'conflict';
  }

  const keyPath = expandHome(manifest.config.encryption.keyPath);
  if (!(await pathExists(keyPath))) return 'locked';
  try {
    const decrypted = await decryptToMemory(repoPath, keyPath);
    const current = await readText(targetPath);
    return decrypted === current ? 'unchanged' : 'conflict';
  } catch {
    return 'locked';
  }
}

export interface CaptureSummary {
  /** Written to the repo this run (new captures + kept-local conflicts). */
  captured: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export interface CaptureOptions {
  /** Non-interactive: keep LOCAL copies on conflicts (backup semantics). */
  yes?: boolean;
}

function interactive(opts: CaptureOptions): boolean {
  // Both sides must be a real terminal — CI, test runners, and agent shells
  // typically fake one side.
  return !!process.stdout.isTTY && !!process.stdin.isTTY && !opts.yes && !isJsonMode();
}

async function captureEntry(rootDir: string, manifest: Manifest, tf: TrackedFile): Promise<void> {
  await captureFiles(rootDir, manifest, [{ src: targetPathOf(manifest, tf), tf }]);
}

/**
 * Capture disk → repo for already-tracked files.
 * Conflicts prompt per file (keep local / keep repo / stop asking);
 * non-interactive runs keep local versions — capturing your current state is
 * the point of a backup.
 */
export async function captureTracked(
  rootDir: string,
  manifest: Manifest,
  files: TrackedFile[],
  opts: CaptureOptions = {}
): Promise<CaptureSummary> {
  const summary: CaptureSummary = { captured: 0, unchanged: 0, skipped: 0, failed: 0 };
  let stopAsking = false;

  for (const tf of files) {
    try {
      const state = await trackedFileState(rootDir, manifest, tf);

      if (state === 'unchanged') {
        summary.unchanged++;
        continue;
      }

      if (state === 'repo-missing') {
        await captureEntry(rootDir, manifest, tf);
        summary.captured++;
        log.ok(`captured ${tf.targetRel}`);
        continue;
      }

      if (state === 'target-missing') {
        summary.skipped++;
        log.warn(`nothing to capture (not on disk): ${tf.targetRel}`);
        continue;
      }

      if (state === 'locked') {
        summary.skipped++;
        log.warn(`🔒 encrypted (no key / decrypt failed): ${tf.targetRel}`);
        continue;
      }

      // conflict
      if (stopAsking) {
        summary.skipped++;
        continue;
      }

      let keepLocal = true;
      if (interactive(opts)) {
        const sel = await clack.select({
          message: `Differs from repo copy: ${tf.targetRel}`,
          options: [
            { value: 'local', label: 'Keep local version (capture into repo)' },
            { value: 'repo', label: 'Keep repo version (skip)' },
            { value: 'stop', label: 'Stop asking — skip the rest' },
          ],
        });
        if (clack.isCancel(sel)) throw new CLIError('Capture cancelled.');
        if (sel === 'stop') {
          stopAsking = true;
          summary.skipped++;
          continue;
        }
        keepLocal = sel === 'local';
      }

      if (keepLocal) {
        await captureEntry(rootDir, manifest, tf);
        summary.captured++;
        log.ok(`captured (kept local) ${tf.targetRel}`);
      } else {
        summary.skipped++;
        log.info(`kept repo version of ${tf.targetRel}`);
      }
    } catch (err) {
      if (err instanceof CLIError) throw err;
      summary.failed++;
      log.error(`failed to capture ${tf.targetRel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}

export interface SyncDecision {
  keepMine: TrackedFile[];
  takeRemote: TrackedFile[];
}

/**
 * Resolve expand-direction conflicts before deploying: which locally modified
 * files should be captured into the repo first ("keep mine") and which should
 * be overwritten by the repo/remote copy ("take remote").
 * Non-interactive runs keep every local modification (never clobber silently).
 */
export async function resolveExpandConflicts(
  rootDir: string,
  manifest: Manifest,
  opts: CaptureOptions = {}
): Promise<SyncDecision> {
  const keepMine: TrackedFile[] = [];
  const takeRemote: TrackedFile[] = [];
  let stopAsking = false;

  for (const tf of manifest.files) {
    if ((await trackedFileState(rootDir, manifest, tf)) !== 'conflict') continue;

    if (stopAsking) {
      keepMine.push(tf);
      continue;
    }

    let mine = true;
    if (interactive(opts)) {
      const sel = await clack.select({
        message: `Local changes in ${tf.targetRel} differ from repo`,
        options: [
          { value: 'mine', label: 'Keep my version (capture into repo)' },
          { value: 'remote', label: 'Take repo version (local file is backed up)' },
          { value: 'stop', label: 'Stop asking — keep mine for the rest' },
        ],
      });
      if (clack.isCancel(sel)) throw new CLIError('Sync cancelled.');
      if (sel === 'stop') {
        stopAsking = true;
        keepMine.push(tf);
        continue;
      }
      mine = sel === 'mine';
    }

    if (mine) {
      keepMine.push(tf);
      log.info(`keeping local: ${tf.targetRel}`);
    } else {
      takeRemote.push(tf);
      log.info(`taking repo version: ${tf.targetRel}`);
    }
  }

  return { keepMine, takeRemote };
}

// --- candidate application ------------------------------------------------

export interface FileCandidateInput {
  category: string;
  sourcePath: string;
  targetRel: string;
  sensitive?: boolean;
}

export interface ApplyOutcome {
  added: string[];
  updated: string[];
  skipped: { path: string; reason: string }[];
  failed: { path: string; error: string }[];
}

export interface ApplyOptions {
  update?: boolean;
  encrypt?: boolean;
  allowPlaintextSecrets?: boolean;
  yes?: boolean;
}

const SENSITIVE_KEYWORDS = ['auth', 'credentials', 'token', 'accounts', 'backup', '.env', 'keys', 'secret'];

export function isSensitiveRel(rel: string): boolean {
  const lower = rel.toLowerCase();
  return SENSITIVE_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Shared engine behind `agenv add <category>` sugar and `agenv scan --apply`:
 * add untracked candidates to the in-memory manifest + capture them, and with
 * `update` also refresh drifted already-tracked candidates via captureTracked.
 * Mutates the passed manifest; the caller owns lock + saveManifest.
 */
export async function applyCandidates(
  rootDir: string,
  manifest: Manifest,
  candidates: FileCandidateInput[],
  opts: ApplyOptions = {}
): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { added: [], updated: [], skipped: [], failed: [] };
  const newEntries: TrackedFile[] = [];
  const refreshEntries: TrackedFile[] = [];

  for (const cand of candidates) {
    try {
      const id = `${cand.category}:${cand.targetRel.replace(/[\\/]/g, '-')}`;
      const existing = manifest.files.find(
        f => f.id === id || (f.category === cand.category && f.targetRel === cand.targetRel)
      );

      if (existing) {
        if (opts.update) {
          refreshEntries.push(existing);
        } else {
          outcome.skipped.push({ path: cand.sourcePath, reason: 'already tracked' });
        }
        continue;
      }

      const sensitive = !!cand.sensitive || isSensitiveRel(cand.targetRel);
      if (sensitive && !opts.encrypt && !opts.allowPlaintextSecrets) {
        outcome.skipped.push({ path: cand.sourcePath, reason: 'looks sensitive — re-run with --encrypt' });
        continue;
      }

      const tf: TrackedFile = {
        id,
        category: cand.category as TrackedFile['category'],
        targetRel: cand.targetRel,
        encrypt: !!opts.encrypt,
      };
      manifest.files.push(tf);
      newEntries.push(tf);
      outcome.added.push(cand.sourcePath);
    } catch (err) {
      outcome.failed.push({ path: cand.sourcePath, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (newEntries.length > 0) {
    await captureFiles(
      rootDir,
      manifest,
      newEntries.map(tf => ({ src: targetPathOf(manifest, tf), tf }))
    );
  }

  if (refreshEntries.length > 0) {
    const sum = await captureTracked(rootDir, manifest, refreshEntries, { yes: opts.yes });
    for (const tf of refreshEntries) outcome.updated.push(targetPathOf(manifest, tf));
    if (sum.failed > 0) {
      outcome.failed.push({ path: '(refresh)', error: `${sum.failed} file(s) failed during refresh` });
    }
  }

  return outcome;
}

// --- candidate collection -------------------------------------------------

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'cache', '.cache']);

/**
 * Expand a user-supplied file or directory into candidates whose targetRel is
 * relative to the category root — so expand() restores every file to its exact
 * original location. Directories recurse, skipping node_modules/.git/cache.
 */
export async function collectCandidatesFromPath(
  absPath: string,
  categoryId: string,
  targetRoot: string
): Promise<FileCandidateInput[]> {
  await fs.stat(absPath);
  const expandedRoot = expandHome(targetRoot);

  const toCandidate = (absFile: string): FileCandidateInput => {
    const rel = path.relative(expandedRoot, absFile);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new CLIError(
        `${absFile} is outside the '${categoryId}' category root (${expandedRoot})`,
        `Drop -c/--category to auto-detect, or use a category whose root contains this path.`
      );
    }
    return {
      category: categoryId,
      sourcePath: absFile,
      targetRel: rel,
      sensitive: isSensitiveRel(rel),
    };
  };

  const stat = await fs.stat(absPath);
  if (stat.isFile()) return [toCandidate(absPath)];

  const all = await listFilesRecursive(absPath);
  return all
    .filter(rel => !rel.split(/[\\/]/).some(p => SKIP_DIR_NAMES.has(p.toLowerCase())))
    .map(rel => toCandidate(path.join(absPath, rel)));
}
