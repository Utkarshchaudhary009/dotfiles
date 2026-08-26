import * as clack from '@clack/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Manifest, TrackedFile, repoStorePath, slugFor } from './manifest';
import { targetPathFor, expandHome } from './platform';
import { pathExists, listFilesRecursive, fileHash, readText } from './fs';
import { captureFiles, decryptToMemory } from './deploy';
import { log, isJsonMode } from './logger';
import { CLIError } from './errors';
import { isSensitiveForCategory } from './scanner';

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
  /** IDs of tracked files actually captured — lets callers report honestly. */
  capturedIds: string[];
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
  const summary: CaptureSummary = { captured: 0, unchanged: 0, skipped: 0, failed: 0, capturedIds: [] };
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
        summary.capturedIds.push(tf.id);
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
        summary.capturedIds.push(tf.id);
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
 * Consumed by the Phase 3 sync rework (`agenv sync` conflict resolution);
 * until that lands it is exercised directly by tests.
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

/**
 * Where a tracked file lands in files/<category>/<stored-name>; collisions
 * here mean data loss. Keys use the ACTUAL stored filename — `<slug>` for
 * plaintext vs `<slug>.age` for encrypted — so a plaintext/encrypted pair on
 * the same target can coexist while real overwrites stay blocked.
 */
function storeKeyOf(tf: TrackedFile): string {
  return `${tf.category}::${tf.encrypt ? 'age:' : 'raw:'}${slugFor(tf.targetRel)}`;
}

/**
 * Shared engine behind `agenv add <category>` sugar and `agenv scan --apply`:
 * add untracked candidates to the in-memory manifest + capture them, and with
 * `update` also refresh drifted already-tracked candidates via captureTracked.
 * Mutates the passed manifest; the caller owns lock + saveManifest.
 *
 * Per-file semantics: one failing candidate never sinks the batch. `added`
 * only lists files whose bytes actually reached the repo store; store-path
 * collisions are rejected instead of clobbering an existing entry's copy.
 */
export async function applyCandidates(
  rootDir: string,
  manifest: Manifest,
  candidates: FileCandidateInput[],
  opts: ApplyOptions = {}
): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { added: [], updated: [], skipped: [], failed: [] };
  const pendingNew: { cand: FileCandidateInput; tf: TrackedFile }[] = [];
  const refreshEntries: TrackedFile[] = [];

  // Seed with every existing entry so a new add cannot overwrite the stored
  // copy of a file that is already tracked under a colliding slug.
  const storeOwners = new Map<string, TrackedFile>();
  for (const f of manifest.files) storeOwners.set(storeKeyOf(f), f);

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

      // Candidate-provided sensitivity wins, but the engine double-checks with
      // the same category rules the scanner uses (e.g. ~/.gitconfig, profiles).
      const sensitive = !!cand.sensitive || isSensitiveForCategory(cand.category, cand.targetRel);
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

      const owner = storeOwners.get(storeKeyOf(tf));
      if (owner && owner !== tf) {
        outcome.failed.push({
          path: cand.sourcePath,
          error: `store collision: '${tf.targetRel}' maps to the same stored file as '${owner.targetRel}' in category '${tf.category}'`,
        });
        continue;
      }

      manifest.files.push(tf);
      storeOwners.set(storeKeyOf(tf), tf);
      pendingNew.push({ cand, tf });
    } catch (err) {
      outcome.failed.push({ path: cand.sourcePath, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Capture new entries one at a time so a single bad file cannot reject the
  // whole batch after earlier files were already written; roll back the
  // manifest entry when its capture fails.
  for (const { cand, tf } of pendingNew) {
    try {
      await captureFiles(rootDir, manifest, [{ src: cand.sourcePath, tf }]);
      outcome.added.push(cand.sourcePath);
    } catch (err) {
      const idx = manifest.files.indexOf(tf);
      if (idx >= 0) manifest.files.splice(idx, 1);
      storeOwners.delete(storeKeyOf(tf));
      outcome.failed.push({ path: cand.sourcePath, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (refreshEntries.length > 0) {
    const sum = await captureTracked(rootDir, manifest, refreshEntries, { yes: opts.yes });
    // Only claim updates for files that were actually captured this run —
    // unchanged/locked/skipped files must not show up as updated. Keyed by
    // tracked-file ID so same-named files in different categories stay distinct.
    const capturedSet = new Set(sum.capturedIds);
    for (const tf of refreshEntries) {
      if (capturedSet.has(tf.id)) outcome.updated.push(targetPathOf(manifest, tf));
    }
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
 * original location. Directories recurse, pruning node_modules/.git/cache
 * during the walk. Every candidate must resolve (realpath) inside the category
 * root, so symlinks pointing at files outside the tree are rejected instead of
 * silently copying external content into the repo.
 */
export async function collectCandidatesFromPath(
  absPath: string,
  categoryId: string,
  targetRoot: string
): Promise<FileCandidateInput[]> {
  const stat = await fs.stat(absPath);
  const expandedRoot = expandHome(targetRoot);

  let realRoot = path.resolve(expandedRoot);
  try {
    realRoot = await fs.realpath(realRoot);
  } catch {
    // Root may not exist yet for custom categories; fall back to lexical path.
  }

  const assertContained = async (absFile: string): Promise<void> => {
    let realFile = path.resolve(absFile);
    try {
      realFile = await fs.realpath(realFile);
    } catch {
      // Broken/unreadable link: keep the lexical fallback below.
    }
    if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
      throw new CLIError(
        `${absFile} resolves outside the '${categoryId}' category root (${expandedRoot})`,
        `Symlinks pointing outside the category root are not tracked. Drop -c/--category to auto-detect, or pick a category whose root contains the real path.`
      );
    }
  };

  const toCandidate = async (absFile: string): Promise<FileCandidateInput> => {
    await assertContained(absFile);
    const rel = path.relative(path.resolve(expandedRoot), absFile);
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
      sensitive: isSensitiveForCategory(categoryId, rel),
    };
  };

  if (stat.isFile()) return [await toCandidate(absPath)];

  // listFilesRecursive already skips symlinked entries and we prune excluded
  // directories during traversal instead of filtering afterwards.
  const rels = await listFilesRecursive(absPath, name => SKIP_DIR_NAMES.has(name.toLowerCase()));
  const candidates: FileCandidateInput[] = [];
  for (const rel of rels) {
    candidates.push(await toCandidate(path.join(absPath, rel)));
  }
  return candidates;
}
