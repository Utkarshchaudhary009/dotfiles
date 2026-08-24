import { expect, test, describe, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadRegistry, saveRegistry, registerEnv, unregisterEnv, setActive, getActive, listEnvNames, getEnvByUrl } from '../src/registry';

describe('Registry Module', () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agenv-registry-test-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
    delete process.env.HOME;
    delete process.env.USERPROFILE;
  });

  test('load empty registry', async () => {
    const r = await loadRegistry();
    expect(r.version).toBe(1);
    expect(r.active).toBeNull();
    expect(r.envs).toEqual({});
  });

  test('register and retrieve env', async () => {
    await registerEnv('work', { path: '/tmp/work', url: 'git@github.com:user/work.git' });
    const r = await loadRegistry();
    expect(r.envs['work'].path).toBe(path.resolve('/tmp/work'));
    expect(r.envs['work'].url).toBe('git@github.com:user/work.git');
    expect(r.envs['work'].lastSynced).toBeNull();
  });

  test('upsert env updates fields but preserves others', async () => {
    await registerEnv('work', { path: '/tmp/work', url: 'git@github.com:user/work.git' });
    
    // Simulate sync
    const r = await loadRegistry();
    r.envs['work'].lastSynced = '2023-01-01T00:00:00Z';
    await saveRegistry(r);
    
    // Upsert path only
    await registerEnv('work', { path: '/tmp/work2', url: null });
    const r2 = await loadRegistry();
    expect(r2.envs['work'].path).toBe(path.resolve('/tmp/work2'));
    expect(r2.envs['work'].url).toBe('git@github.com:user/work.git'); // preserved
    expect(r2.envs['work'].lastSynced).toBe('2023-01-01T00:00:00Z'); // preserved
  });

  test('unregister env', async () => {
    await registerEnv('work', { path: '/tmp/work', url: null });
    await setActive('work');
    expect((await getActive())?.name).toBe('work');
    
    await unregisterEnv('work');
    const r = await loadRegistry();
    expect(r.envs['work']).toBeUndefined();
    expect(r.active).toBeNull();
  });

  test('list env names and get by url', async () => {
    await registerEnv('env1', { path: '/t/1', url: 'url1' });
    await registerEnv('env2', { path: '/t/2', url: 'url2' });
    
    const names = await listEnvNames();
    expect(names.sort()).toEqual(['env1', 'env2']);
    
    const e = await getEnvByUrl('url2');
    expect(e?.name).toBe('env2');
  });
});
