import * as path from 'node:path';
import { runProcess } from './proc';
import { CLIError } from './errors';

const GIT_URL_SCHEME = /^(https:\/\/|ssh:\/\/|git@|file:\/\/)/;

function runGit(cwd: string, args: string[]): Promise<string> {
  return runProcess(['git', ...args], { cwd }).then(({ code, stdout, stderr }) => {
    if (code === 0) return stdout;
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  });
}

export async function gitInit(dir: string): Promise<void> {
  await runGit(dir, ['init']);
}

export async function gitAdd(dir: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await runGit(dir, ['add', ...files]);
}

export async function gitCommit(dir: string, msg: string): Promise<void> {
  await runGit(dir, ['commit', '-m', msg]);
}

export async function gitRemote(dir: string): Promise<string | null> {
  try {
    const out = await runGit(dir, ['remote', 'get-url', 'origin']);
    return out.trim();
  } catch {
    return null;
  }
}

export async function gitClone(url: string, dest: string): Promise<void> {
  if (url.startsWith('-')) {
    throw new Error('Invalid git URL: cannot start with "-"');
  }
  const source = GIT_URL_SCHEME.test(url) ? url : path.resolve(url);
  await runGit(process.cwd(), ['clone', '--depth=1', '--', source, dest]);
}

export async function gitPull(dir: string): Promise<void> {
  await runGit(dir, ['pull']);
}

export async function gitPushSetUpstream(dir: string): Promise<void> {
  const res = await runProcess(['git', 'push', '-u', 'origin', 'HEAD'], { cwd: dir });
  if (res.code !== 0) {
    throw new CLIError(
      `Failed to push: ${(res.stderr || res.stdout).trim()} ` +
      `If this repo has no remote, run 'agenv publish' or 'git remote add origin <url>'.`
    );
  }
}
