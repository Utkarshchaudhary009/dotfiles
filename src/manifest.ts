import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { readText, writeFileAtomic, pathExists } from './fs';
import { ConfigSettings, ToolCategoryId } from './types';
import { createDefaultConfig } from './config';
import { targetPathFor } from './platform';
import { CLIError } from './errors';

export const DEFAULT_GITIGNORE = "key.txt\n*.key\n*.pem\n*.log\n.DS_Store\nThumbs.db\n";

export interface TrackedFile {
  id: string;
  category: ToolCategoryId;
  targetRel: string;
  encrypt: boolean;
}

export interface Manifest {
  version: 1;
  config: ConfigSettings;
  files: TrackedFile[];
}

export async function loadManifest(rootDir: string): Promise<Manifest> {
  const p = path.join(rootDir, 'agenv.json');
  if (await pathExists(p)) {
    const data = JSON.parse(await readText(p));
    if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.files) || !data.config || !Array.isArray(data.config.categories)) {
      throw new CLIError(`Corrupt agenv.json at ${p}`);
    }
    
    // Validate path traversal
    for (const file of data.files) {
      const cat = data.config.categories.find((c: any) => c.id === file.category);
      if (cat) {
        targetPathFor(cat.targetRoot, file.targetRel);
      }
    }
    return data as Manifest;
  }
  return {
    version: 1,
    config: createDefaultConfig(rootDir),
    files: []
  };
}

export async function withManifestLock<T>(rootDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(rootDir, '.agenv.lock');
  
  let acquired = false;
  for (let i = 0; i < 10; i++) {
    try {
      await fs.mkdir(lockPath);
      acquired = true;
      break;
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  if (!acquired) {
    throw new CLIError('another agenv process is running');
  }

  try {
    return await fn();
  } finally {
    try {
      await fs.rmdir(lockPath);
    } catch {}
  }
}

export async function saveManifest(rootDir: string, manifest: Manifest): Promise<void> {
  const p = path.join(rootDir, 'agenv.json');
  await writeFileAtomic(p, JSON.stringify(manifest, null, 2));
}

export function slugFor(rel: string): string {
  // Replace slashes with double underscores
  return rel.replace(/[\\/]/g, '__');
}

export function repoStorePath(rootDir: string, tf: TrackedFile): string {
  const slug = slugFor(tf.targetRel);
  const filename = tf.encrypt ? `${slug}.age` : slug;
  return path.join(rootDir, 'files', tf.category, filename);
}
