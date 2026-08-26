import * as path from 'node:path';
import { CLIError } from '../errors';
import { requireAgenvRepo } from '../config';
import { loadManifest, saveManifest, withManifestLock, Manifest, TrackedFile } from '../manifest';
import { log } from '../logger';
import { pathExists } from '../fs';
import { expandHome } from '../platform';
import { ToolCategoryId, ALL_CATEGORIES } from '../types';
import { scanSystem } from '../scanner';
import {
  applyCandidates,
  collectCandidatesFromPath,
  targetPathOf,
  ApplyOutcome,
  FileCandidateInput,
} from '../capture';

export interface AddOptions {
  encrypt?: boolean;
  category?: string;
  allowPlaintextSecrets?: boolean;
  /** Refresh already-tracked files from disk instead of skipping them. */
  update?: boolean;
  yes?: boolean;
  json?: boolean;
}

/** True when the argument is a bare category id like `opencode`, not a path. */
function isCategorySugar(arg: string): boolean {
  return (
    (ALL_CATEGORIES as readonly string[]).includes(arg) &&
    !path.isAbsolute(arg) &&
    !arg.includes('/') &&
    !arg.includes('\\') &&
    !arg.startsWith('.')
  );
}

interface ResolvedCategory {
  categoryId: ToolCategoryId;
  targetRoot: string;
}

function resolveCategory(
  manifestCategories: { id: string; targetRoot: string }[],
  absPath: string,
  override?: string
): ResolvedCategory {
  if (override) {
    if (!/^[a-z0-9-]+$/.test(override)) {
      throw new CLIError(`Invalid category ID: ${override}. Only lowercase letters, numbers, and dashes are allowed.`);
    }
    const existing = manifestCategories.find(c => c.id === override);
    if (existing) return { categoryId: override as ToolCategoryId, targetRoot: existing.targetRoot };
    return { categoryId: override as ToolCategoryId, targetRoot: '~/' };
  }

  // Longest matching category targetRoot wins. path.relative is
  // case-insensitive on Windows and case-sensitive elsewhere — exactly the
  // filesystems' own rules — and handles trailing separators and path
  // boundaries without hand-rolled prefix math.
  let best: { id: ToolCategoryId; targetRoot: string } | null = null;
  let bestLen = 0;
  for (const cat of manifestCategories) {
    const tr = expandHome(cat.targetRoot);
    const rel = path.relative(tr, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (tr.length > bestLen) {
      best = { id: cat.id as ToolCategoryId, targetRoot: cat.targetRoot };
      bestLen = tr.length;
    }
  }
  if (best) return { categoryId: best.id, targetRoot: best.targetRoot };
  return { categoryId: 'custom', targetRoot: '~/' };
}

/** Best-effort display path; never throws on odd manifests. */
function safeTargetPath(manifest: Manifest, tf: TrackedFile): string {
  try {
    return targetPathOf(manifest, tf);
  } catch {
    return `~/${tf.targetRel}`;
  }
}

/** Core add logic operating on an explicit repo root (testable, no cwd magic). */
export async function addToRepo(rootDir: string, args: string[], options: AddOptions): Promise<ApplyOutcome> {
  return withManifestLock(rootDir, async () => {
    const manifest = await loadManifest(rootDir);

    // Preset sugar: `agenv add opencode`
    if (args.length === 1 && isCategorySugar(args[0])) {
      const categoryId = args[0];
      const found = await scanSystem([categoryId as ToolCategoryId]);
      log.info(`Discovered ${found.length} config file(s) for '${categoryId}'.`);
      const discovered = found.map(c => ({
        category: c.category,
        sourcePath: c.sourcePath,
        targetRel: c.targetRel,
        sensitive: c.sensitive,
      }));
      // With --update, refresh every tracked entry in this category — not
      // just what the scanner discovers (lockfiles and root configs often
      // fall outside preset patterns).
      const trackedOnly = options.update
        ? manifest.files
            .filter(f => f.category === categoryId)
            .filter(tf => !discovered.some(c => c.targetRel === tf.targetRel))
            .map(tf => ({
              category: tf.category,
              sourcePath: safeTargetPath(manifest, tf),
              targetRel: tf.targetRel,
              sensitive: false,
            }))
        : [];
      const outcome = await applyCandidates(rootDir, manifest, [...discovered, ...trackedOnly], options);
      await saveManifest(rootDir, manifest);
      return outcome;
    }

    // Path mode: files and/or directories.
    const candidates: FileCandidateInput[] = [];
    const resolutionFailures: { path: string; error: string }[] = [];

    for (const arg of args) {
      try {
        const absPath = path.resolve(expandHome(arg));
        if (!(await pathExists(absPath))) {
          resolutionFailures.push({ path: absPath, error: 'not found' });
          continue;
        }

        const { categoryId, targetRoot } = resolveCategory(manifest.config.categories, absPath, options.category);
        if (!manifest.config.categories.find(c => c.id === categoryId)) {
          log.info(`Auto-registering custom category: ${categoryId}`);
          manifest.config.categories.push({ id: categoryId, label: categoryId, enabled: true, targetRoot });
        }
        candidates.push(...(await collectCandidatesFromPath(absPath, categoryId, targetRoot)));
      } catch (err) {
        resolutionFailures.push({ path: arg, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const outcome = await applyCandidates(rootDir, manifest, candidates, options);
    outcome.failed.unshift(...resolutionFailures);
    await saveManifest(rootDir, manifest);
    return outcome;
  });
}

/** Shared printer + exit-code semantics for ApplyOutcome consumers (add, scan --apply). */
export function reportApplyOutcome(outcome: ApplyOutcome, json?: boolean): void {
  if (json) {
    log.json(outcome);
  } else {
    for (const p of outcome.added) log.ok(`added ${p}`);
    for (const p of outcome.updated) log.ok(`updated ${p}`);
    for (const s of outcome.skipped) log.warn(`skipped ${s.path} (${s.reason})`);
    for (const f of outcome.failed) log.error(`failed ${f.path}: ${f.error}`);
    log.info(`Summary: ${outcome.added.length} added, ${outcome.updated.length} updated, ${outcome.skipped.length} skipped, ${outcome.failed.length} failed`);
    if (outcome.added.length > 0 || outcome.updated.length > 0) {
      log.hint('Commit & publish with: agenv push');
    }
  }
  if (outcome.failed.length > 0) {
    throw new CLIError(`${outcome.failed.length} path(s) could not be added.`);
  }
}

export async function addCommand(files: string[], options: AddOptions = {}) {
  if (files.length === 0) {
    throw new CLIError('Nothing to add. Pass file/dir paths or a category name (opencode, claude, agents, git, vscode, shell).');
  }
  const found = await requireAgenvRepo(process.cwd(), "Tip: 'agenv add opencode' captures a whole tool's configs.");
  const outcome = await addToRepo(found.rootDir, files, options);
  reportApplyOutcome(outcome, options.json);
}
