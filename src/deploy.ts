import { promises as fs } from 'node:fs';
import { pathExists, copyFile, ensureParent, readText, fileHash } from './fs';
import { TrackedFile, Manifest, repoStorePath } from './manifest';
import { targetPathFor, expandHome } from './platform';
import { log } from './logger';
import { runProcess } from './proc';
import { CLIError, DEFAULT_KEY_PATH, HINTS } from './errors';

function runCmd(cmd: string, args: string[]): Promise<void> {
  return runProcess([cmd, ...args]).then(({ code, stderr }) => {
    if (code !== 0) throw new Error(`${cmd} failed: ${stderr}`);
  });
}

export async function encryptFile(src: string, dest: string, keyPath: string): Promise<void> {
  await ensureParent(dest);
  const keyContent = await readText(keyPath);
  
  if (!keyContent.includes('AGE-SECRET-KEY-1') || !/# public key: age1/.test(keyContent)) {
    throw new Error(`Invalid identity file at ${keyPath}: must contain a valid age identity and public key comment.`);
  }
  
  const match = keyContent.match(/# public key: (age1[a-z0-9]+)/);
  if (!match) throw new Error(`Could not find public key in ${keyPath}`);
  const pubkey = match[1];
  await runCmd('age', ['-e', '-r', pubkey, '-o', dest, src]);
}

export async function decryptFile(src: string, dest: string, keyPath: string): Promise<void> {
  await ensureParent(dest);
  await runCmd('age', ['-d', '-i', keyPath, '-o', dest, src]);
}

export async function decryptToMemory(src: string, keyPath: string): Promise<string> {
  const { code, stdout, stderr } = await runProcess(['age', '-d', '-i', keyPath, src]);
  if (code !== 0) throw new Error(`Failed to decrypt ${src}: ${stderr}`);
  return stdout;
}

export interface DeploySummary {
  deployed: number;
  skipped: number;
  unchanged: number;
  failed: number;
  encryptedSkipped: number;
  backups: number;
}

export async function captureFiles(rootDir: string, manifest: Manifest, filesToCapture: { src: string, tf: TrackedFile }[]): Promise<void> {
  const keyPath = expandHome(manifest.config.encryption.keyPath);
  const needsKey = filesToCapture.some(item => item.tf.encrypt);
  if (needsKey && !(await pathExists(keyPath))) {
    throw new CLIError(
      `Encryption key not found at ${keyPath}`,
      HINTS.keyMissing(keyPath === expandHome(DEFAULT_KEY_PATH) ? undefined : keyPath)
    );
  }
  for (const item of filesToCapture) {
    const dest = repoStorePath(rootDir, item.tf);
    await ensureParent(dest);
    if (item.tf.encrypt) {
      await encryptFile(item.src, dest, keyPath);
    } else {
      await copyFile(item.src, dest);
    }
  }
}

export interface DeployOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Only consider these tracked files; everything else counts as skipped. */
  filter?: (tf: TrackedFile) => boolean;
}

export async function deployFiles(rootDir: string, manifest: Manifest, opts?: DeployOptions): Promise<DeploySummary> {
  const summary: DeploySummary = { deployed: 0, skipped: 0, unchanged: 0, failed: 0, encryptedSkipped: 0, backups: 0 };
  const keyPath = expandHome(manifest.config.encryption.keyPath);
  const hasKey = await pathExists(keyPath);

  for (const tf of manifest.files) {
    if (opts?.filter && !opts.filter(tf)) {
      summary.skipped++;
      continue;
    }
    const cat = manifest.config.categories.find(c => c.id === tf.category);
    if (!cat) continue;
    const targetRoot = cat.targetRoot;
    const targetPath = targetPathFor(targetRoot, tf.targetRel);
    const repoPath = repoStorePath(rootDir, tf);

    if (!(await pathExists(repoPath))) {
      log.warn(`Missing in repo: ${repoPath}`);
      summary.failed++;
      continue;
    }

    if (tf.encrypt && !hasKey) {
      log.warn(`Skipping encrypted file (missing key): ${tf.targetRel}`);
      summary.encryptedSkipped++;
      continue;
    }

    let isSymlink = false;
    try {
      const st = await fs.lstat(targetPath);
      isSymlink = st.isSymbolicLink();
    } catch {}

    const targetExists = await pathExists(targetPath) || isSymlink;
    let shouldDeploy = false;
    let shouldBackup = false;

    if (!targetExists) {
      shouldDeploy = true;
    } else {
      if (isSymlink && !opts?.force) {
        log.warn(`Symlink exists (skipped — use --force): ${tf.targetRel}`);
        summary.skipped++;
        continue;
      }
      let differs = false;
      if (isSymlink) {
        differs = true;
      } else {
        if (!tf.encrypt) {
          const srcHash = await fileHash(repoPath);
          const dstHash = await fileHash(targetPath);
          differs = srcHash !== dstHash;
        } else {
          const decryptedContent = await decryptToMemory(repoPath, keyPath);
          const currentContent = await readText(targetPath);
          differs = decryptedContent !== currentContent;
        }
      }

      if (!differs) {
        summary.unchanged++;
        continue;
      }

      if (opts?.force) {
        shouldDeploy = true;
        shouldBackup = !isSymlink;
      } else {
        log.warn(`Modified (skipped — use --force): ${tf.targetRel}`);
        summary.skipped++;
        continue;
      }
    }

    if (shouldDeploy) {
      if (!opts?.dryRun) {
        try {
          if (shouldBackup) {
            const bakPath = `${targetPath}.agenv-bak-${Date.now()}-${process.pid}`;
            await copyFile(targetPath, bakPath);
            summary.backups++;
          }

          const tmpPath = `${targetPath}.agenv-tmp-${process.pid}`;
          await ensureParent(targetPath);
          try {
            if (tf.encrypt) {
              await decryptFile(repoPath, tmpPath, keyPath);
            } else {
              await copyFile(repoPath, tmpPath);
            }
            await fs.rename(tmpPath, targetPath);
            summary.deployed++;
          } finally {
            try {
              await fs.unlink(tmpPath);
            } catch (e: any) {
              // ignore
            }
          }
        } catch (e: any) {
          log.error(`Failed to deploy ${tf.targetRel}: ${e.message}`);
          summary.failed++;
        }
      } else {
        summary.deployed++;
        if (shouldBackup) summary.backups++;
      }
    }
  }
  return summary;
}
