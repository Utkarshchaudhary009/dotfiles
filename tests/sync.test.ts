import { expect, test, describe, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runProcess } from '../src/proc';

const AGENV_BIN = path.resolve(__dirname, '../dist/agenv.js');

async function runAgenv(args: string[], cwd: string, env: Record<string, string> = {}) {
  const allArgs = ['node', AGENV_BIN, ...args];
  return await runProcess(allArgs, { cwd, env: { ...process.env, ...env } });
}

describe('Sync and Publish CLI Commands', () => {
  let tempHome: string;
  let repoPath: string;
  let bareRepo: string;
  let otherCwd: string;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agenv-sync-test-home-'));
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agenv-sync-test-repo-'));
    bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'agenv-sync-test-bare-'));
    otherCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agenv-sync-test-other-'));

    // Create bare repo
    await runProcess(['git', 'init', '--bare', '-b', 'main'], { cwd: bareRepo });
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
    await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
    await fs.rm(bareRepo, { recursive: true, force: true }).catch(() => {});
    await fs.rm(otherCwd, { recursive: true, force: true }).catch(() => {});
  });

  test('publish --remote registers env, sync works from anywhere', async () => {
    const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
    const env = { 
      HOME: tempHome, 
      USERPROFILE: tempHome, 
      [pathKey]: (process.env[pathKey] || '').split(path.delimiter).filter(p => !p.toLowerCase().includes('github cli')).join(path.delimiter),
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    };

    // Seed home so init finds something
    const opencodeDir = path.join(tempHome, ".config", "opencode");
    await fs.mkdir(opencodeDir, { recursive: true });
    await fs.writeFile(path.join(opencodeDir, "opencode.json"), "{}");

    // 1. Init
    const initRes = await runAgenv(['init', '--yes', '--dir', repoPath], repoPath, env);
    if (initRes.code !== 0) console.log('INIT ERROR:', initRes.stderr, initRes.stdout);
    
    await fs.writeFile(path.join(repoPath, 'test.txt'), 'hello');
    
    // 2. Publish to bare remote
    const pubRes = await runAgenv(['publish', '--name', 'testenv', '--remote', "file:///" + encodeURI(bareRepo.replace(/\\/g, '/')), '--yes'], repoPath, env);
    if (pubRes.code !== 0) console.log(pubRes.stderr, pubRes.stdout);
    expect(pubRes.code).toBe(0);

    // Verify registry bound it
    const envsRes = await runAgenv(['envs'], repoPath, env);
    expect(envsRes.stdout).toContain('testenv');
    expect(envsRes.stdout).toContain("file:///" + encodeURI(bareRepo.replace(/\\/g, '/')));

    // 3. Simulate remote change
    const cloneDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agenv-sync-test-clone-'));
    await runProcess(['git', 'clone', bareRepo, cloneDir]);
    await fs.writeFile(path.join(cloneDir, 'remote-file.txt'), 'from remote');
    await runProcess(['git', 'add', '.'], { cwd: cloneDir });
    await runProcess(['git', 'commit', '-m', 'remote change'], { cwd: cloneDir, env });
    const clonePushRes = await runProcess(['git', 'push'], { cwd: cloneDir, env });
    console.log('CLONE PUSH:', clonePushRes.stdout, clonePushRes.stderr);
    if (clonePushRes.code !== 0) console.log('CLONE PUSH ERROR:', clonePushRes.stderr, clonePushRes.stdout);
    await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {});

    // 4. Sync --yes from DIFFERENT cwd
    const syncRes = await runAgenv(['sync', 'testenv', '--yes'], otherCwd, env);
    console.log('SYNC STDOUT:', syncRes.stdout);
    if (syncRes.code !== 0) console.log('SYNC ERROR:', syncRes.stderr, syncRes.stdout);
    expect(syncRes.code).toBe(0);

    // Verify pulled file exists in repo path
    const repoContents = await fs.readdir(repoPath);
    console.log('REPO CONTENTS:', repoContents);
    const remoteFileExists = await fs.access(path.join(repoPath, 'remote-file.txt')).then(() => true).catch(() => false);
    expect(remoteFileExists).toBe(true);

    // 5. Local change then sync --push --yes
    await fs.writeFile(path.join(repoPath, 'files', 'local-file.txt'), 'local');
    const syncPushRes = await runAgenv(['sync', 'testenv', '--push', '--yes'], otherCwd, env);
    if (syncPushRes.code !== 0) console.log('SYNC PUSH ERROR:', syncPushRes.stderr, syncPushRes.stdout);
    expect(syncPushRes.code).toBe(0);
    expect(syncPushRes.stdout).toContain('Pushed');

    // Verify bare repo has it
    const logRes = await runProcess(['git', '--git-dir=' + bareRepo, 'log', '--oneline']);
    expect(logRes.stdout).toContain('Sync agenv environment');
    
    const showRes = await runProcess(['git', '--git-dir=' + bareRepo, 'show', 'HEAD:files/local-file.txt']);
    expect(showRes.stdout).toContain('local');

    // 6. Sync --no-push
    await fs.writeFile(path.join(repoPath, 'files', 'local-file-2.txt'), 'local2');
    const syncNoPushRes = await runAgenv(['sync', 'testenv', '--no-push'], otherCwd, env);
    if (syncNoPushRes.code !== 0) console.log('SYNC NO PUSH ERROR:', syncNoPushRes.stderr, syncNoPushRes.stdout);
    expect(syncNoPushRes.code).toBe(0);
    expect(syncNoPushRes.stdout).toContain('Push skipped');
    
    const logRes2 = await runProcess(['git', '--git-dir=' + bareRepo, 'log', '--oneline']);
    expect(logRes2.stdout.split('\n').length).toBe(logRes.stdout.split('\n').length); // No new commit in bare
  }, 120000);

  test('local edit to a tracked file survives `agenv sync --push --yes`', async () => {
    const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
    const env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      [pathKey]: (process.env[pathKey] || '').split(path.delimiter).filter(p => !p.toLowerCase().includes('github cli')).join(path.delimiter),
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    };

    // Init the repo + publish to bare origin
    const opencodeDir = path.join(tempHome, '.config', 'opencode');
    await fs.mkdir(opencodeDir, { recursive: true });
    await fs.writeFile(path.join(opencodeDir, 'opencode.json'), JSON.stringify({ theme: 'dark' }));
    const initRes = await runAgenv(['init', '--yes', '--dir', repoPath], repoPath, env);
    if (initRes.code !== 0) throw new Error('init failed: ' + initRes.stderr);
    const pubRes = await runAgenv(['publish', '--name', 'drifttest', '--remote', `file:///${path.posix.join(...path.resolve(bareRepo).split('/'))}`, '--yes'], repoPath, env);
    if (pubRes.code !== 0) throw new Error('publish failed: ' + pubRes.stderr);

    // Edit the tracked file on disk
    const targetFile = path.join(tempHome, '.config', 'opencode', 'opencode.json');
    const localEdit = JSON.stringify({ theme: 'light', note: 'edited-locally' });
    await fs.writeFile(targetFile, localEdit);

    // Sync with --push --yes from a different cwd
    const syncRes = await runAgenv(['sync', 'drifttest', '--push', '--yes', '--json'], otherCwd, env);
    if (syncRes.code !== 0) throw new Error('sync failed: ' + syncRes.stderr + '\nstdout: ' + syncRes.stdout);

    // The local edit must still be on disk after sync.
    const onDisk = await fs.readFile(targetFile, 'utf8');
    expect(onDisk).toBe(localEdit);

    // The local edit must also have reached the bare origin. The repo
    // store path is files/<category>/<targetRel>, not files/<targetRel>.
    const showRes = await runProcess(['git', '--git-dir=' + bareRepo, 'show', 'HEAD:files/opencode/opencode.json']);
    expect(showRes.stdout).toContain('edited-locally');
  }, 120000);
});
