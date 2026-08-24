import { CLIError } from '../errors';
import { requireAgenvRepo } from '../config';
import { loadManifest, saveManifest, repoStorePath, slugFor, withManifestLock, Manifest, TrackedFile } from '../manifest';
import { log } from '../logger';
import { pathExists } from '../fs';
import { expandHome, targetPathFor } from '../platform';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';

function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

function isSamePath(a: string, b: string): boolean {
  return path.relative(a, b) === '';
}

export async function removeCommand(id: string, options: { delete?: boolean }) {
  const found = await requireAgenvRepo(process.cwd());

  await withManifestLock(found.rootDir, async () => {
    const manifest: Manifest = await loadManifest(found.rootDir);

    const collect = (match: (f: TrackedFile) => boolean): number[] => {
      const hits: number[] = [];
      manifest.files.forEach((f, i) => {
        if (match(f)) hits.push(i);
      });
      return hits;
    };

    const resolveTier = (hits: number[], tier: string): number => {
      if (hits.length === 0) return -1;
      if (hits.length > 1) {
        const candidates = hits.map(i => manifest.files[i].id).join(', ');
        throw new CLIError(`Ambiguous ${tier} '${id}' matches multiple tracked files: ${candidates}. Remove one by its exact ID.`);
      }
      return hits[0];
    };

    let idx = resolveTier(collect(f => f.id === id), 'ID');
    if (idx === -1) {
      idx = resolveTier(collect(
        f => normalizeSeparators(f.targetRel) === normalizeSeparators(id) || slugFor(f.targetRel) === id
      ), 'target path');
    }
    if (idx === -1) {
      const absArg = path.resolve(expandHome(id));
      idx = resolveTier(collect(
        f => {
          const cat = manifest.config.categories.find(c => c.id === f.category);
          if (!cat) return false;
          try {
            return isSamePath(targetPathFor(cat.targetRoot, f.targetRel), absArg);
          } catch {
            return false;
          }
        }
      ), 'file path');
    }
    if (idx === -1) {
      throw new CLIError(`Tracked file not found: ${id}`);
    }

    const tf = manifest.files[idx];
    manifest.files.splice(idx, 1);
    await saveManifest(found.rootDir, manifest);

    if (options.delete !== false) {
      const p = repoStorePath(found.rootDir, tf);
      if (await pathExists(p)) {
        await fs.unlink(p);
      }
    }

    log.ok(`Removed ${tf.targetRel}`);
  });
}
