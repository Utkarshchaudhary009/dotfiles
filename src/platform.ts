import * as os from 'node:os';
import * as path from 'node:path';

export function homeDir(): string {
  if (process.env.HOME) return process.env.HOME;
  if (process.env.USERPROFILE) return process.env.USERPROFILE;
  return os.homedir();
}

export function isWindows(): boolean {
  return os.platform() === 'win32';
}

export function expandHome(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(homeDir(), p.slice(2));
  }
  if (p === '~') {
    return homeDir();
  }
  return p;
}

export function targetPathFor(targetRoot: string, rel: string): string {
  if (path.isAbsolute(rel)) {
    throw new Error(`Unsafe target path in manifest: ${rel}`);
  }
  const expandedRoot = expandHome(targetRoot);
  const home = homeDir();
  
  if (!expandedRoot.startsWith(home + path.sep) && expandedRoot !== home) {
    throw new Error(`Unsafe targetRoot: ${targetRoot} is outside user home directory`);
  }

  const targetPath = path.join(expandedRoot, rel);
  if (!targetPath.startsWith(expandedRoot + path.sep) && targetPath !== expandedRoot) {
    throw new Error(`Unsafe target path in manifest: ${rel}`);
  }
  return targetPath;
}
