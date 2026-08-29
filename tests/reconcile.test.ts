import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runProcess } from '../src/proc';
import { planReconcile } from '../src/reconcile';
import { saveManifest } from '../src/manifest';
import { createDefaultConfig } from '../src/config';

const gitEnv = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@e',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@e',
};

let tmpBase: string;

beforeAll(async () => {
  tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'agenv-reconcile-'));
});

afterAll(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
});

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpBase, 'repo-'));
  const init = await runProcess(['git', 'init', '-q', '-b', 'main'], { cwd: dir, env: gitEnv });
  if (init.code !== 0) throw new Error('git init failed');
  await runProcess(['git', 'config', 'user.email', 't@e'], { cwd: dir, env: gitEnv });
  await runProcess(['git', 'config', 'user.name', 't'], { cwd: dir, env: gitEnv });
  return dir;
}

function minimalManifest() {
  const config = createDefaultConfig('/tmp');
  // Mark opencode category as enabled so the planner doesn't skip its files.
  for (const c of config.categories) c.enabled = c.id === 'opencode';
  return { version: 1 as const, config, files: [] };
}

describe('planReconcile', () => {
  test('returns noop for a clean repo with no remote', async () => {
    const dir = await makeRepo();
    await saveManifest(dir, minimalManifest() as any);
    const plan = await planReconcile(dir, minimalManifest() as any);
    expect(plan.action).toBe('noop');
    expect(plan.remote).toBe('no-remote');
    expect(plan.conflicts).toEqual([]);
  });

  test('returns noop when local, repo, and remote are in sync', async () => {
    const dir = await makeRepo();
    const origin = mkdtempSync(path.join(tmpBase, 'origin-'));
    const init = await runProcess(['git', 'init', '--bare', '-q', '-b', 'main'], { cwd: origin, env: gitEnv });
    if (init.code !== 0) return;
    await runProcess(['git', 'remote', 'add', 'origin', origin], { cwd: dir, env: gitEnv });
    // First commit + push so upstream resolves
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    await runProcess(['git', 'add', '-A'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'commit', '-q', '-m', 'init'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'push', '-q', 'origin', 'HEAD:refs/heads/main'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'branch', '--set-upstream-to', 'origin/main'], { cwd: dir, env: gitEnv });
    await saveManifest(dir, minimalManifest() as any);

    const plan = await planReconcile(dir, minimalManifest() as any);
    expect(plan.action).toBe('noop');
    expect(plan.remote).toBe('in-sync');
  });

  test('returns pull when remote is ahead and local is clean', async () => {
    const dir = await makeRepo();
    const origin = mkdtempSync(path.join(tmpBase, 'origin-'));
    const init = await runProcess(['git', 'init', '--bare', '-q', '-b', 'main'], { cwd: origin, env: gitEnv });
    if (init.code !== 0) return;
    await runProcess(['git', 'remote', 'add', 'origin', origin], { cwd: dir, env: gitEnv });
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    await runProcess(['git', 'add', '-A'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'commit', '-q', '-m', 'init'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'push', '-q', 'origin', 'HEAD:refs/heads/main'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'branch', '--set-upstream-to', 'origin/main'], { cwd: dir, env: gitEnv });
    // Add a remote-only commit
    const clone = mkdtempSync(path.join(tmpBase, 'clone-'));
    await runProcess(['git', 'clone', '-q', origin, clone], { cwd: dir, env: gitEnv });
    writeFileSync(path.join(clone, 'remote.txt'), 'r');
    await runProcess(['git', 'add', '-A'], { cwd: clone, env: gitEnv });
    await runProcess(['git', 'commit', '-q', '-m', 'remote change'], { cwd: clone, env: gitEnv });
    await runProcess(['git', 'push', '-q', 'origin', 'HEAD:refs/heads/main'], { cwd: clone, env: gitEnv });
    await saveManifest(dir, minimalManifest() as any);

    const plan = await planReconcile(dir, minimalManifest() as any);
    expect(plan.action).toBe('pull');
    expect(plan.remote).toBe('behind');
  });

  test('returns diverged-conflict when branches have diverged', async () => {
    const dir = await makeRepo();
    const origin = mkdtempSync(path.join(tmpBase, 'origin-'));
    const init = await runProcess(['git', 'init', '--bare', '-q', '-b', 'main'], { cwd: origin, env: gitEnv });
    if (init.code !== 0) return;
    await runProcess(['git', 'remote', 'add', 'origin', origin], { cwd: dir, env: gitEnv });
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    await runProcess(['git', 'add', '-A'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'commit', '-q', '-m', 'init'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'push', '-q', 'origin', 'HEAD:refs/heads/main'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'branch', '--set-upstream-to', 'origin/main'], { cwd: dir, env: gitEnv });
    // Local commit
    writeFileSync(path.join(dir, 'local.txt'), 'l');
    await runProcess(['git', 'add', '-A'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'commit', '-q', '-m', 'local'], { cwd: dir, env: gitEnv });
    // Remote commit (force-push to same branch to force divergence)
    const clone = mkdtempSync(path.join(tmpBase, 'clone-'));
    await runProcess(['git', 'clone', '-q', origin, clone], { cwd: dir, env: gitEnv });
    writeFileSync(path.join(clone, 'remote.txt'), 'r');
    await runProcess(['git', 'add', '-A'], { cwd: clone, env: gitEnv });
    await runProcess(['git', 'commit', '-q', '-m', 'remote change'], { cwd: clone, env: gitEnv });
    await runProcess(['git', 'push', '-q', '-f', 'origin', 'HEAD:refs/heads/main'], { cwd: clone, env: gitEnv });
    await saveManifest(dir, minimalManifest() as any);

    const plan = await planReconcile(dir, minimalManifest() as any);
    expect(plan.action).toBe('diverged-conflict');
    expect(plan.nextCommand).toBe('agenv sync --rebase');
  });

  test('returns diverged-rebase when rebase option is set', async () => {
    const dir = await makeRepo();
    const origin = mkdtempSync(path.join(tmpBase, 'origin-'));
    const init = await runProcess(['git', 'init', '--bare', '-q', '-b', 'main'], { cwd: origin, env: gitEnv });
    if (init.code !== 0) return;
    await runProcess(['git', 'remote', 'add', 'origin', origin], { cwd: dir, env: gitEnv });
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    await runProcess(['git', 'add', '-A'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'commit', '-q', '-m', 'init'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'push', '-q', 'origin', 'HEAD:refs/heads/main'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'branch', '--set-upstream-to', 'origin/main'], { cwd: dir, env: gitEnv });
    writeFileSync(path.join(dir, 'local.txt'), 'l');
    await runProcess(['git', 'add', '-A'], { cwd: dir, env: gitEnv });
    await runProcess(['git', 'commit', '-q', '-m', 'local'], { cwd: dir, env: gitEnv });
    const clone = mkdtempSync(path.join(tmpBase, 'clone-'));
    await runProcess(['git', 'clone', '-q', origin, clone], { cwd: dir, env: gitEnv });
    writeFileSync(path.join(clone, 'remote.txt'), 'r');
    await runProcess(['git', 'add', '-A'], { cwd: clone, env: gitEnv });
    await runProcess(['git', 'commit', '-q', '-m', 'remote'], { cwd: clone, env: gitEnv });
    await runProcess(['git', 'push', '-q', '-f', 'origin', 'HEAD:refs/heads/main'], { cwd: clone, env: gitEnv });
    await saveManifest(dir, minimalManifest() as any);

    const plan = await planReconcile(dir, minimalManifest() as any, { rebase: true });
    expect(plan.action).toBe('diverged-rebase');
  });
});
