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

export interface RemoteSync {
  /** True when the repo has a configured, resolvable upstream branch. */
  configured: boolean;
  /** Local commits not on the upstream yet (need `agenv push`). */
  ahead: number;
  /** Upstream commits not on local yet (need review/sync). */
  behind: number;
  error?: string;
}

/**
 * Compare local HEAD against its upstream using only locally available refs —
 * no network round-trip. Returns `configured: false` when there is no remote
 * or upstream, so status can simply omit the remote dimension rather than
 * fail. Used by `agenv status` to report remote actionable state.
 */
export async function gitRemoteSync(dir: string): Promise<RemoteSync> {
  let upstream: string;
  try {
    upstream = (await runGit(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim();
  } catch {
    return { configured: false, ahead: 0, behind: 0 };
  }
  if (!upstream) return { configured: false, ahead: 0, behind: 0 };

  try {
    const counts = (await runGit(dir, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])).trim();
    const [left, right] = counts.split(/\s+/).map(n => parseInt(n, 10) || 0);
    // Left side = commits in upstream not in HEAD = behind; right = ahead.
    return { configured: true, ahead: right, behind: left };
  } catch (e) {
    return { configured: true, ahead: 0, behind: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
