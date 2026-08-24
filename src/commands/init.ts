import { CLIError } from '../errors';
import { intro, outro, multiselect, confirm, isCancel, cancel } from '@clack/prompts';
import * as path from 'node:path';
import { log } from '../logger';
import { createDefaultConfig, isAgenvRepo } from '../config';
import { scanSystem } from '../scanner';
import { Manifest, saveManifest, TrackedFile, DEFAULT_GITIGNORE, withManifestLock } from '../manifest';
import { captureFiles } from '../deploy';
import { gitInit, gitAdd, gitCommit } from '../git';
import { ensureAge, whichBin } from '../deps';
import { pathExists, ensureParent, writeText } from '../fs';
import { runProcess } from '../proc';
import { publishCommand } from './publish';
import { expandHome } from '../platform';
import { ALL_CATEGORIES } from '../types';

export async function initCommand(options: { dir?: string, yes?: boolean, allowPlaintextSecrets?: boolean, force?: boolean, publish?: boolean, noPublish?: boolean }) {
  const rootDir = options.dir ? path.resolve(options.dir) : process.cwd();
  
  if (!(await pathExists(rootDir))) {
    throw new CLIError(`Directory does not exist: ${rootDir}`);
  }

  if (await isAgenvRepo(rootDir) && !options.force) {
    throw new CLIError('Already an agenv environment — use agenv add/remove/expand');
  }

  if (!options.yes) {
    intro(`agenv init — ${rootDir}`);
  }

  
  
  let selectedCats: string[] = ['opencode', 'claude', 'agents'];
  if (!options.yes) {
    const cats = await multiselect({
      message: 'Select categories to track',
      options: ALL_CATEGORIES.map((c: string) => ({ value: c, label: c })),
      initialValues: selectedCats
    });
    if (isCancel(cats)) return cancel('Aborted.');
    selectedCats = cats as string[];
  }

  if (!options.yes) {
    log.info('Scanning for configuration files...');
  }
  const candidates = await scanSystem(selectedCats as any);
  
  if (candidates.length === 0) {
    log.warn('No configuration files found for selected categories.');
    if (!options.yes) return outro('Done');
    return;
  }

  if (!options.yes) {
    log.sectionTitle('Found Configuration Files');
    const rows = candidates.map(c => [
      c.category,
      c.targetRel,
      c.sensitive ? '🔒 sensitive' : ''
    ]);
    log.table(rows);
  }

  const hasSensitive = candidates.some(c => c.sensitive);
  let doEncrypt = false;
  if (hasSensitive) {
    if (options.yes) {
      doEncrypt = !!(await whichBin('age'));
      if (!doEncrypt && !options.allowPlaintextSecrets) {
        throw new CLIError('Sensitive files selected but age is missing. Aborting to prevent plaintext secrets. Use --allow-plaintext-secrets to override.');
      }
    } else {
      const ans = await confirm({
        message: 'Some files are sensitive. Encrypt them with age? (Recommended)',
        initialValue: true
      });
      if (isCancel(ans)) return cancel('Aborted.');
      doEncrypt = ans as boolean;
    }
  }

  const config = createDefaultConfig(rootDir);
  for (const cat of config.categories) {
    cat.enabled = selectedCats.includes(cat.id);
  }

  if (doEncrypt) {
    try {
      await ensureAge();
      const keyPath = expandHome(config.encryption.keyPath);
      
      const keyResolved = path.resolve(keyPath);
      if (keyResolved.startsWith(path.resolve(rootDir))) {
        log.warn(`WARNING: keyPath is inside the environment repository (${keyPath}). This is insecure!`);
      }

      if (!(await pathExists(keyPath))) {
        await ensureParent(keyPath);
        const { code, stderr } = await runProcess(['age-keygen', '-o', keyPath]);
        if (code !== 0) throw new Error(`age-keygen failed: ${stderr}`);
        if (process.platform !== 'win32') {
          await require('node:fs/promises').chmod(keyPath, 0o600);
        }
        if (!options.yes) log.ok(`Generated age key at ${keyPath}`);
      }
    } catch (e: any) {
      throw new CLIError(`Encryption setup failed: ${e.message}`);
    }
  }

  const trackedFiles: TrackedFile[] = candidates.map(c => ({
    id: c.id,
    category: c.category,
    targetRel: c.targetRel,
    encrypt: doEncrypt && c.sensitive
  }));

  const manifest: Manifest = {
    version: 1,
    config,
    files: trackedFiles
  };

  await withManifestLock(rootDir, async () => {
    await saveManifest(rootDir, manifest);
  });
  
  const captures = candidates.map((c, i) => ({
    src: c.sourcePath,
    tf: trackedFiles[i]
  }));
  await captureFiles(rootDir, manifest, captures);

  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!(await pathExists(gitignorePath))) {
    await writeText(gitignorePath, DEFAULT_GITIGNORE);
  }

  const readmePath = path.join(rootDir, 'README.md');
  if (!(await pathExists(readmePath))) {
    const readmeContent = `# agenv Environment

Portable encrypted AI developer environment manager.

## Commands

- \`agenv expand\` - Deploy tracked files to your home directory
- \`agenv update\` - Pull latest changes and expand
- \`agenv status\` - Show status of tracked files
- \`agenv add <file>\` - Add a new file to the manifest
- \`agenv publish\` - Publish this environment to GitHub

> **Note:** The decryption key lives at \`~/.config/agenv/key.txt\` on each machine — back it up!
`;
    await writeText(readmePath, readmeContent);
  }

  try {
    await gitInit(rootDir);
    await gitAdd(rootDir, ['.gitignore', 'README.md', 'agenv.json', 'files/']);
    await gitCommit(rootDir, 'Initial agenv environment captured by agenv init');
    await runProcess(['git', 'branch', '-M', 'main'], { cwd: rootDir });
  } catch (e: any) {
    log.warn(`Git initialization failed: ${e.message}`);
  }

  if (!options.yes) {
    outro('Success! Environment captured.');
    log.info('Next steps:');
    log.info('  agenv status');
    if (doEncrypt) {
      log.warn(`  IMPORTANT: Backup your age key at ${config.encryption.keyPath}`);
    }

    if (!options.noPublish) {
      const ans = await confirm({
        message: 'Publish to GitHub so you can clone this anywhere?',
        initialValue: true
      });
      if (!isCancel(ans) && ans) {
        await publishCommand({ dir: rootDir });
      } else {
        log.info("Tip: run 'agenv publish' to push this to GitHub and get a clone URL.");
      }
    } else {
      log.info("Tip: run 'agenv publish' to push this to GitHub and get a clone URL.");
    }
  } else {
    log.ok('Agenv initialized successfully.');
    if (options.publish) {
      await publishCommand({ yes: true, dir: rootDir });
    } else {
      log.info("Tip: run 'agenv publish' to push this to GitHub and get a clone URL.");
    }
  }
}
