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

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  // Reject only a literal '..' component; names like '..config' are valid files.
  return rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel);
}

export function targetPathFor(targetRoot: string, rel: string): string {
  if (path.isAbsolute(rel)) {
    throw new Error(`Unsafe target path in manifest: ${rel}`);
  }
  const expandedRoot = path.resolve(expandHome(targetRoot));

  // Deploy targets live under the user's home; the OS temp dir is also safe
  // and keeps hermetic tests working on Linux CI where /tmp is outside $HOME.
  const safeRoots = [homeDir(), os.tmpdir()].map((r) => path.resolve(r));
  if (!safeRoots.some((root) => isInside(root, expandedRoot))) {
    throw new Error(`Unsafe targetRoot: ${targetRoot} is outside user home directory`);
  }

  // Validate a backslash-normalized copy so `..\\bar` cannot smuggle a
  // traversal past containment on POSIX, but resolve the returned path from
  // the original rel — on POSIX a `\` can be part of a legitimate filename.
  const probe = path.resolve(expandedRoot, rel.replace(/\\/g, '/'));
  if (!isInside(expandedRoot, probe)) {
    throw new Error(`Unsafe target path in manifest: ${rel}`);
  }
  return path.resolve(expandedRoot, rel);
}
