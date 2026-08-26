import { ALL_CATEGORIES, ToolCategoryId } from '../types';
import { scanSystem, FileCandidate } from '../scanner';
import { CLIError } from '../errors';
import { log } from '../logger';
import { requireAgenvRepo } from '../config';
import { loadManifest, saveManifest, withManifestLock } from '../manifest';
import { applyCandidates, ApplyOutcome } from '../capture';
import { reportApplyOutcome } from './add';

export interface ScanOptions {
  /** Limit discovery to one tool category (e.g. `opencode`). */
  category?: string;
  /** Track everything discovered using the shared capture engine. */
  apply?: boolean;
  /** With --apply: also refresh drifted already-tracked files. */
  update?: boolean;
  encrypt?: boolean;
  allowPlaintextSecrets?: boolean;
  yes?: boolean;
  json?: boolean;
}

/** Validate and normalize the requested category list. */
function resolveCategories(category?: string): ToolCategoryId[] {
  if (!category) return [...ALL_CATEGORIES] as ToolCategoryId[];
  if (!(ALL_CATEGORIES as readonly string[]).includes(category)) {
    throw new CLIError(
      `Unknown category '${category}'.`,
      `Scanner presets exist for: ${ALL_CATEGORIES.join(', ')}.`
    );
  }
  return [category as ToolCategoryId];
}

/** Discover trackable config files, optionally scoped to one category. */
export async function discoverConfigs(category?: string): Promise<FileCandidate[]> {
  return scanSystem(resolveCategories(category));
}

export interface ScanListing {
  summary: { total: number; categories: { category: string; count: number }[] };
  files: { category: string; targetRel: string; sourcePath: string; sensitive: boolean }[];
}

/** Build the summary-first listing document from raw candidates. */
export function buildListing(candidates: FileCandidate[]): ScanListing {
  const byCat = new Map<string, number>();
  for (const c of candidates) byCat.set(c.category, (byCat.get(c.category) || 0) + 1);
  return {
    summary: {
      total: candidates.length,
      categories: [...byCat.entries()].map(([category, count]) => ({ category, count })),
    },
    files: candidates.map(c => ({
      category: c.category,
      targetRel: c.targetRel,
      sourcePath: c.sourcePath,
      sensitive: c.sensitive,
    })),
  };
}

/**
 * Apply every discovered candidate through the shared capture engine.
 * Owns lock + persistence; returns the same outcome shape as `agenv add`.
 */
export async function applyDiscovered(
  rootDir: string,
  candidates: FileCandidate[],
  opts: Pick<ScanOptions, 'update' | 'encrypt' | 'allowPlaintextSecrets' | 'yes'> = {}
): Promise<ApplyOutcome> {
  return withManifestLock(rootDir, async () => {
    const manifest = await loadManifest(rootDir);
    const outcome = await applyCandidates(
      rootDir,
      manifest,
      candidates.map(c => ({
        category: c.category,
        sourcePath: c.sourcePath,
        targetRel: c.targetRel,
        sensitive: c.sensitive,
      })),
      opts
    );
    await saveManifest(rootDir, manifest);
    return outcome;
  });
}

function printListing(listing: ScanListing): void {
  if (listing.summary.total === 0) {
    log.info('No files found.');
    return;
  }
  // Summary first: totals per tool before the file-level table.
  const parts = listing.summary.categories.map(c => `${c.category}: ${c.count}`).join(', ');
  log.info(`Found ${listing.summary.total} file(s) — ${parts}`);
  log.sectionTitle('Discoverable Files');
  log.table(listing.files.map(f => [f.category, f.targetRel, f.sensitive ? '🔒 sensitive' : '']));
  log.hint('Track them with: agenv scan --apply  (add --encrypt for secrets)');
}

export async function scanCommand(options: ScanOptions = {}) {
  const candidates = await discoverConfigs(options.category);
  const listing = buildListing(candidates);

  if (!options.apply) {
    if (options.json) {
      log.json(listing);
    } else {
      printListing(listing);
    }
    return;
  }

  const found = await requireAgenvRepo(process.cwd(), "Tip: 'agenv init' creates a repo; 'agenv clone <url>' adopts one.");
  const outcome = await applyDiscovered(found.rootDir, candidates, options);
  reportApplyOutcome(outcome, options.json);
}
