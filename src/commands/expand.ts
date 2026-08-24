import { requireAgenvRepo } from '../config';
import { loadManifest } from '../manifest';
import { deployFiles } from '../deploy';
import { log } from '../logger';
import { ensureAgeFor } from '../deps';
import { pathExists } from '../fs';
import { targetPathFor } from '../platform';
import * as p from '@clack/prompts';
import { resolveTarget } from '../resolve';
import { CLIError } from '../errors';

export async function expandCommand(target: string | undefined, options: { dryRun?: boolean, force?: boolean, yes?: boolean } = {}) {
  const resolved = await resolveTarget(target);
  const found = await requireAgenvRepo(resolved.path, `Searched from ${resolved.path}`);

  const manifest = await loadManifest(found.rootDir);
  await ensureAgeFor(manifest);

  const newFiles = [];
  for (const f of manifest.files) {
    const cat = manifest.config.categories.find(c => c.id === f.category);
    if (!cat) continue;
    const targetPath = targetPathFor(cat.targetRoot, f.targetRel);
    if (!(await pathExists(targetPath))) {
      newFiles.push(targetPath);
    }
  }

  if (newFiles.length > 0 && !options?.yes) {
    if (!process.stdout.isTTY) {
      log.warn(`Warning: expanding will create ${newFiles.length} new file(s) that do not currently exist.`);
    } else {
      log.info(`Expanding will create ${newFiles.length} new file(s):`);
      const limit = Math.min(newFiles.length, 5);
      for (let i = 0; i < limit; i++) {
        log.info(`  - ${newFiles[i]}`);
      }
      if (newFiles.length > limit) {
        log.info(`  ... and ${newFiles.length - limit} more.`);
      }
      const confirm = await p.confirm({
        message: `Do you want to proceed and write these files?`
      });
      if (p.isCancel(confirm) || !confirm) {
        throw new CLIError('Expand cancelled by user.');
      }
    }
  }

  log.info(`Expanding environment from ${found.rootDir}...`);
  const summary = await deployFiles(found.rootDir, manifest, options);
  
  log.deploySummary(summary);

  if (summary.failed > 0 && !options.dryRun) {
    throw new CLIError('Deploy completed with errors.');
  }
}
