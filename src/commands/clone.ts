import { CLIError } from '../errors';
import * as path from 'node:path';
import { gitClone } from '../git';
import { log } from '../logger';
import { ensureGit, ensureAgeFor } from '../deps';
import { isAgenvRepo } from '../config';
import { expandCommand } from './expand';
import { pathExists, writeText } from '../fs';
import { loadManifest, DEFAULT_GITIGNORE } from '../manifest';
import { expandHome, targetPathFor } from '../platform';

export async function cloneCommand(url: string, options: { dir?: string }) {
  await ensureGit();

  const repoName = url.split(/[\\/]/).filter(Boolean).pop()?.replace(/\.git$/, '') || 'agenv-repo';
  const dest = options.dir ? path.resolve(options.dir) : path.join(process.cwd(), repoName);

  if (await pathExists(dest)) {
    throw new CLIError(`Destination already exists: ${dest}`);
  }

  log.info(`Cloning ${url} into ${dest}...`);
  await gitClone(url, dest);

  if (!(await isAgenvRepo(dest))) {
    throw new CLIError('The cloned repository does not contain an agenv.json manifest.');
  }

  const manifest = await loadManifest(dest);
  const config = manifest.config;
  
  await ensureAgeFor(manifest);
  if (manifest.files.some(f => f.encrypt) && config.encryption) {
    const keyPath = expandHome(config.encryption.keyPath);
    if (!(await pathExists(keyPath))) {
      throw new CLIError(`Decrypt key not found at ${keyPath} — copy key from original machine or create one.`);
    }
  }

  const gitignorePath = path.join(dest, '.gitignore');
  if (!(await pathExists(gitignorePath))) {
    await writeText(gitignorePath, DEFAULT_GITIGNORE);
  }

  const allTargets = [];
  for (const f of manifest.files) {
    const cat = config.categories.find(c => c.id === f.category);
    if (cat) {
      allTargets.push(targetPathFor(cat.targetRoot, f.targetRel));
    }
  }
  
  if (allTargets.length > 0) {
    log.info(`Ready to expand ${allTargets.length} file(s):`);
    const limit = Math.min(allTargets.length, 5);
    for (let i = 0; i < limit; i++) {
      log.info(`  - ${allTargets[i]}`);
    }
    if (allTargets.length > limit) {
      log.info(`  ... and ${allTargets.length - limit} more.`);
    }
  }

  log.info('Expanding environment...');
  process.chdir(dest);
  await expandCommand(undefined, { yes: true });
  
  log.ok('Environment cloned and expanded.');
}
