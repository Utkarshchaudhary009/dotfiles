import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import crypto from 'node:crypto';

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string> {
  return await fs.readFile(p, 'utf8');
}

export async function writeText(p: string, content: string): Promise<void> {
  await ensureParent(p);
  await fs.writeFile(p, content, 'utf8');
}

export async function copyFile(src: string, dest: string): Promise<void> {
  await ensureParent(dest);
  await fs.copyFile(src, dest);
}

export async function writeFileAtomic(p: string, content: string): Promise<void> {
  await ensureParent(p);
  const tmpPath = `${p}.tmp-${process.pid}`;
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, p);
}


export async function mkdirp(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function ensureParent(p: string): Promise<void> {
  await mkdirp(path.dirname(p));
}

/**
 * List files under dir recursively. Symlinked entries are skipped (Dirent
 * reports them as neither file nor directory), which also prevents cycles.
 * When skipDir matches a directory name, that subtree is never entered —
 * pruning during the walk instead of filtering afterwards.
 */
export async function listFilesRecursive(
  dir: string,
  skipDir?: (name: string) => boolean
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string, relativePath: string) {
    if (!(await pathExists(currentDir))) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        if (skipDir && skipDir(entry.name)) continue;
        await walk(path.join(currentDir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  await walk(dir, '');
  return files;
}

export async function fileHash(p: string): Promise<string> {
  const content = await fs.readFile(p);
  return crypto.createHash('sha256').update(content).digest('hex');
}
