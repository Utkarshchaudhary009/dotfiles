import { requireAgenvRepo } from '../config';
import { loadManifest, repoStorePath } from '../manifest';
import { log } from '../logger';
import { pathExists, fileHash, readText } from '../fs';
import { targetPathFor, expandHome } from '../platform';
import { resolveTarget } from '../resolve';
import { decryptToMemory } from '../deploy';

export async function statusCommand(target?: string) {
  const resolved = await resolveTarget(target);
  const found = await requireAgenvRepo(resolved.path);

  const manifest = await loadManifest(found.rootDir);
  const rows: string[][] = [];

  const keyPath = expandHome(manifest.config.encryption.keyPath);
  const hasKey = await pathExists(keyPath);

  let newCount = 0;
  let modCount = 0;
  let okCount = 0;
  let missingCount = 0;

  for (const tf of manifest.files) {
    const cat = manifest.config.categories.find(c => c.id === tf.category);
    if (!cat) continue;
    const targetPath = targetPathFor(cat.targetRoot, tf.targetRel);
    const repoPath = repoStorePath(found.rootDir, tf);
    
    if (!(await pathExists(targetPath))) {
      rows.push([tf.category, tf.targetRel, 'missing']);
      missingCount++;
      continue;
    }
    
    if (!(await pathExists(repoPath))) {
      rows.push([tf.category, tf.targetRel, 'new in target (missing in repo)']);
      newCount++;
      continue;
    }

    if (tf.encrypt) {
      if (!hasKey) {
        rows.push([tf.category, tf.targetRel, '🔒 encrypted (no key)']);
        okCount++;
        continue;
      }
      let decryptedContent: string;
      try {
        decryptedContent = await decryptToMemory(repoPath, keyPath);
      } catch (err) {
        rows.push([tf.category, tf.targetRel, '🔒 encrypted (decrypt failed)']);
        okCount++;
        continue;
      }
      const currentContent = await readText(targetPath);
      if (decryptedContent === currentContent) {
        rows.push([tf.category, tf.targetRel, 'up-to-date 🔒']);
        okCount++;
      } else {
        rows.push([tf.category, tf.targetRel, 'modified 🔒']);
        modCount++;
      }
      continue;
    }

    const srcHash = await fileHash(repoPath);
    const dstHash = await fileHash(targetPath);
    if (srcHash === dstHash) {
      rows.push([tf.category, tf.targetRel, 'up-to-date']);
      okCount++;
    } else {
      rows.push([tf.category, tf.targetRel, 'modified']);
      modCount++;
    }
  }

  log.sectionTitle('Status');
  if (rows.length === 0) {
    log.info('No files tracked.');
    return;
  }
  
  log.table(rows);
  log.info('');
  log.info(`Summary: ${okCount} ok, ${modCount} modified, ${missingCount} missing, ${newCount} new/untracked`);
}
