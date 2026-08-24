import { CLIError } from '../errors';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { requireAgenvRepo } from '../config';
import { loadManifest } from '../manifest';
import { log } from '../logger';
import { runProcess } from '../proc';
import { pathExists } from '../fs';

export async function exportCommand(options?: { out?: string }) {
  const found = await requireAgenvRepo(process.cwd());

  const rootDir = found.rootDir;
  const dirname = path.basename(rootDir);
  const now = new Date();
  
  // Create YYYYMMDD-HHmmss format
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
  
  const defaultOut = `agenv-${dirname}-${dateStr}.tar.gz`;
  const outPath = options?.out ? path.resolve(process.cwd(), options.out) : path.resolve(process.cwd(), defaultOut);
  
  const itemsToArchive: string[] = ['agenv.json'];
  
  if (await pathExists(path.join(rootDir, 'files'))) {
    itemsToArchive.push('files');
  }
  if (await pathExists(path.join(rootDir, '.gitignore'))) {
    itemsToArchive.push('.gitignore');
  }
  if (await pathExists(path.join(rootDir, 'README.md'))) {
    itemsToArchive.push('README.md');
  }

  log.info(`Exporting environment to ${outPath}...`);
  
  const args = [
    'tar', 
    '-czf', 
    outPath, 
    '--exclude=.git', 
    '--exclude=node_modules', 
    '--exclude=dist', 
    ...itemsToArchive
  ];
  
  const res = await runProcess(args, { cwd: rootDir });
  if (res.code !== 0) {
    throw new CLIError(`Failed to create tarball: ${res.stderr}`);
  }

  const stat = await fs.stat(outPath);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
  
  const manifest = await loadManifest(rootDir);
  const totalCount = manifest.files.length;
  const encryptedCount = manifest.files.filter(f => f.encrypt).length;
  
  log.ok(`Environment exported → ${path.basename(outPath)}`);
  log.info(`Size: ${sizeMB} MB    Files: ${totalCount} (${encryptedCount} encrypted 🔒)`);
  log.info('Send this file anywhere — no git, no GitHub, no npm needed.');
  log.info('Import it on any machine with your age key:');
  log.info(`  agenv import ${path.basename(outPath)}`);
}
