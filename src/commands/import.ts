import { CLIError } from '../errors';
import * as path from 'node:path';
import { isAgenvRepo } from '../config';
import { loadManifest } from '../manifest';
import { deployFiles } from '../deploy';
import { log } from '../logger';
import { runProcess } from '../proc';
import { pathExists, mkdirp } from '../fs';
import { ensureAgeFor } from '../deps';

export async function importCommand(file: string, options?: { dir?: string }) {
  const resolvedFile = path.resolve(process.cwd(), file);
  if (!(await pathExists(resolvedFile))) {
    throw new CLIError(`File not found: ${file}`);
  }
  
  if (!file.endsWith('.tar.gz')) {
    log.warn(`File does not end with .tar.gz: ${file}`);
  }

  const isCurrentRepo = await isAgenvRepo(process.cwd());
  let targetDir = process.cwd();
  
  if (options?.dir) {
    targetDir = path.resolve(process.cwd(), options.dir);
  } else if (isCurrentRepo) {
    throw new CLIError('Already in an agenv environment — use --dir to choose the import location');
  }

  log.info(`Validating ${path.basename(resolvedFile)}...`);
  const tarListRes = await runProcess(['tar', '-tzf', resolvedFile]);
  if (tarListRes.code !== 0) {
    throw new CLIError(`Failed to list tarball: ${tarListRes.stderr}`);
  }

  const tarPaths = tarListRes.stdout.split('\n').map(p => p.trim()).filter(Boolean);
  for (const p of tarPaths) {
    if (p.includes('..') || p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) {
      throw new CLIError(`Unsafe path in tarball rejected: ${p}`);
    }
  }

  const tarTypesRes = await runProcess(['tar', '-tvzf', resolvedFile]);
  if (tarTypesRes.code !== 0) {
    throw new CLIError(`Failed to verify tarball types: ${tarTypesRes.stderr}`);
  }
  const typeLines = tarTypesRes.stdout.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of typeLines) {
    if (line.startsWith('l') || line.startsWith('h')) {
      throw new CLIError(`Symlinks and hardlinks are not allowed in bundles: ${line}`);
    }
  }

  await mkdirp(targetDir);

  log.info(`Extracting ${path.basename(resolvedFile)} into ${targetDir}...`);
  const tarRes = await runProcess(['tar', '-xzf', resolvedFile, '-C', targetDir]);
  if (tarRes.code !== 0) {
    throw new CLIError(`Failed to extract tarball: ${tarRes.stderr}`);
  }

  const agenvJsonPath = path.join(targetDir, 'agenv.json');
  if (!(await pathExists(agenvJsonPath))) {
    throw new CLIError('Not a valid agenv bundle — missing agenv.json');
  }

  let manifest;
  try {
    manifest = await loadManifest(targetDir);
  } catch (err: unknown) {
    throw new CLIError(`Invalid agenv.json manifest: ${err instanceof Error ? err.message : String(err)}`);
  }

  await ensureAgeFor(manifest);

  log.info(`Deploying environment from ${targetDir}...`);
  const summary = await deployFiles(targetDir, manifest);
  
  log.deploySummary(summary);
  
  if (summary.failed > 0) {
    throw new CLIError('Deploy completed with errors.');
  }
  
  log.ok('Import completed successfully!');
}
