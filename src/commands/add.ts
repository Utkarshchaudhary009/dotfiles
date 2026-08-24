import { CLIError } from '../errors';
import * as path from 'node:path';
import { requireAgenvRepo } from '../config';
import { loadManifest, saveManifest, TrackedFile, withManifestLock } from '../manifest';
import { captureFiles } from '../deploy';
import { log } from '../logger';
import { pathExists } from '../fs';
import { expandHome } from '../platform';
import { ToolCategoryId } from '../types';
import { isSensitive } from '../scanner';

export async function addCommand(file: string, options: { encrypt?: boolean, category?: string, allowPlaintextSecrets?: boolean }) {
  const absPath = path.resolve(expandHome(file));
  if (!(await pathExists(absPath))) {
    throw new CLIError(`File not found: ${absPath}`);
  }

  const found = await requireAgenvRepo(process.cwd());
  const { rootDir } = found;

  await withManifestLock(rootDir, async () => {
    const manifest = await loadManifest(rootDir);

    let categoryId = options.category as ToolCategoryId;
    let targetRel = path.basename(absPath);

    if (!categoryId) {
      // Try to guess category based on path matching targetRoots
      let bestMatch = null;
      let bestMatchLen = 0;
      for (const cat of manifest.config.categories) {
        const tr = expandHome(cat.targetRoot);
        if (absPath.startsWith(tr) && tr.length > bestMatchLen) {
          bestMatch = cat;
          bestMatchLen = tr.length;
        }
      }
      if (bestMatch) {
        categoryId = bestMatch.id;
        targetRel = path.relative(expandHome(bestMatch.targetRoot), absPath);
      } else {
        categoryId = 'custom'; // fallback or error
      }
    }

    if (!/^[a-z0-9-]+$/.test(categoryId)) {
      throw new CLIError(`Invalid category ID: ${categoryId}. Only lowercase letters, numbers, and dashes are allowed.`);
    }

    if (!options.encrypt && !options.allowPlaintextSecrets && isSensitive(targetRel)) {
      log.error(`Please use --encrypt to secure it, or pass --allow-plaintext-secrets if you are sure.`);
      throw new CLIError(`File '${targetRel}' appears to contain sensitive information.`);
    }

    if (!manifest.config.categories.find(c => c.id === categoryId)) {
      log.info(`Auto-registering custom category: ${categoryId}`);
      manifest.config.categories.push({
        id: categoryId,
        label: categoryId,
        enabled: true,
        targetRoot: '~/'
      });
    }

    const cat = manifest.config.categories.find(c => c.id === categoryId)!;
    if (!options.category && categoryId === 'custom') {
       targetRel = path.relative(expandHome(cat.targetRoot), absPath);
    }

    const id = `${categoryId}:${targetRel.replace(/[\\/]/g, '-')}`;
    if (manifest.files.find(f => f.id === id)) {
      log.info(`File already tracked: ${id}`);
      return;
    }

    const tf: TrackedFile = {
      id,
      category: categoryId,
      targetRel,
      encrypt: !!options.encrypt
    };

    manifest.files.push(tf);
    await saveManifest(rootDir, manifest);
    await captureFiles(rootDir, manifest, [{ src: absPath, tf }]);
    log.ok(`Added ${targetRel} to ${categoryId}`);
  });
}
