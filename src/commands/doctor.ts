import { CLIError } from '../errors';
import { whichBin } from '../deps';
import { log } from '../logger';
import { findConfig } from '../config';
import { loadManifest, repoStorePath } from '../manifest';
import { pathExists } from '../fs';
import { expandHome } from '../platform';

export async function doctorCommand() {
  log.sectionTitle('Agenv Doctor');
  
  let errors = 0;

  // Check git
  const gitPath = await whichBin('git');
  if (gitPath) {
    log.ok(`Git found: ${gitPath}`);
  } else {
    log.error('Git not found in PATH');
    errors++;
  }

  // Check age
  const agePath = await whichBin('age');
  const ageKeygenPath = await whichBin('age-keygen');
  if (agePath && ageKeygenPath) {
    log.ok(`Age found: ${agePath}`);
  } else {
    log.warn('Age / age-keygen not found in PATH (required only if using encryption)');
  }

  // Check config
  const found = await findConfig(process.cwd());
  if (!found) {
    log.info('Not in an agenv repository (run `agenv init` to create one).');
    return;
  }
  
  log.ok(`Found agenv repository at ${found.rootDir}`);
  const manifest = await loadManifest(found.rootDir);

  // Check age key
  const keyPath = expandHome(manifest.config.encryption.keyPath);
  if (await pathExists(keyPath)) {
    log.ok(`Encryption key found at ${keyPath}`);
  } else if (manifest.files.some(f => f.encrypt)) {
    log.error(`Encryption key missing at ${keyPath} but encrypted files exist!`);
    errors++;
  } else {
    log.info(`No encryption key at ${keyPath} (none required)`);
  }

  // Check manifest consistency
  let missingFiles = 0;
  for (const tf of manifest.files) {
    const p = repoStorePath(found.rootDir, tf);
    if (!(await pathExists(p))) {
      log.error(`Tracked file missing from store: ${p}`);
      missingFiles++;
      errors++;
    }
  }

  if (missingFiles === 0 && manifest.files.length > 0) {
    log.ok(`All ${manifest.files.length} tracked files exist in store`);
  }

  log.info('');
  if (errors > 0) {
    throw new CLIError(`Doctor found ${errors} issues.`);
  } else {
    log.ok('Everything looks good!');
  }
}
