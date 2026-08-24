import { requireAgenvRepo } from '../config';
import { loadManifest } from '../manifest';
import { log } from '../logger';
import { resolveTarget } from '../resolve';

export async function listCommand(target?: string) {
  const resolved = await resolveTarget(target);
  const found = await requireAgenvRepo(resolved.path);

  const manifest = await loadManifest(found.rootDir);
  
  if (manifest.files.length === 0) {
    log.info('No files tracked.');
    return;
  }

  log.sectionTitle('Tracked Files');
  const rows = manifest.files.map(tf => [
    tf.category,
    tf.targetRel,
    tf.encrypt ? '🔒 yes' : 'no'
  ]);
  
  log.table([['Category', 'File', 'Encrypted'], ...rows]);
}
