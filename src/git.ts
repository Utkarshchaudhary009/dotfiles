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

/**
 * Relationship between local HEAD and the configured origin remote.
 * Read-only and best-effort: any Git error (no remote, no upstream, no
 * network) is reported as a non-throwing string so callers can surface
 * it without try/catch noise.
 */
export type RemoteState =
  | 'no-remote'        // repo has no origin configured
  | 'in-sync'          // local HEAD equals origin/HEAD
  | 'ahead'            // local has commits not on origin
  | 'behind'           // origin has commits not local
  | 'diverged'         // both sides have unique commits
  | 'unknown';         // transient error (no network, etc.)

export async function gitRemoteState(dir: string): Promise<RemoteState> {
  // 1. Is there a configured origin? `git remote` lists configured remotes
  //    (no error = a real repo state). If it lists nothing, there is genuinely
  //    no origin. If it itself errors, git itself is broken — surface 'unknown'
  //    rather than pretending the user just hasn't configured a remote yet.
  let remote: string | null = null;
  try {
    const list = (await runGit(dir, ['remote'])).trim();
    if (list.length === 0) return 'no-remote';
    remote = (await runGit(dir, ['remote', 'get-url', 'origin'])).trim() || null;
    if (!remote) return 'no-remote';
  } catch {
    return 'unknown';
  }

  // 2. Is the local branch tracking origin?
  let upstream: string;
  try {
    upstream = (await runGit(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim();
  } catch {
    // No upstream configured yet: if HEAD exists we have local commits that
    // could be pushed, so classify as 'ahead' to surface the next action.
    // If HEAD itself is missing the repo is in an unexpected state — report
    // 'unknown' rather than guessing.
    try {
      await runGit(dir, ['rev-parse', '--verify', 'HEAD']);
      return 'ahead';
    } catch {
      return 'unknown';
    }
  }

  // 3. Compare counts both directions in parallel. A failure here usually
  //    means the remote is unreachable (offline, auth, deleted) — surface
  //    as 'unknown' instead of silently treating the divergence as zero.
  function count(revRange: string): Promise<number> {
    return runGit(dir, ['rev-list', '--count', revRange])
      .then(s => {
        const n = parseInt(s.trim(), 10);
        return Number.isFinite(n) ? n : Promise.reject(new Error(`bad count: ${s}`));
      });
  }
  let ahead: number;
  let behind: number;
  try {
    [ahead, behind] = await Promise.all([
      count(`${upstream}..HEAD`),
      count(`HEAD..${upstream}`),
    ]);
  } catch {
    return 'unknown';
  }
  if (ahead > 0 && behind > 0) return 'diverged';
  if (ahead > 0) return 'ahead';
  if (behind > 0) return 'behind';
  return 'in-sync';
}
