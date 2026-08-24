import { ALL_CATEGORIES } from '../types';
import { scanSystem } from '../scanner';
import { log } from '../logger';

export async function scanCommand() {
  
  log.info('Scanning system for configuration files...');
  
  const candidates = await scanSystem(ALL_CATEGORIES as any);
  if (candidates.length === 0) {
    log.info('No files found.');
    return;
  }
  
  log.sectionTitle('Discoverable Files');
  const rows = candidates.map(c => [
    c.category,
    c.targetRel,
    c.sensitive ? '🔒 sensitive' : ''
  ]);
  log.table(rows);
}
