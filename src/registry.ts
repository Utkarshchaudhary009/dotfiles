import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { homeDir } from './platform';
import { pathExists, writeFileAtomic } from './fs';

export interface RegistryEnv {
  path: string;
  url: string | null;
  lastSynced: string | null;
}

export interface Registry {
  version: 1;
  active: string | null;
  envs: Record<string, RegistryEnv>;
}

function getRegistryPath(): string {
  return path.join(homeDir(), '.config', 'agenv', 'registry.json');
}

export async function loadRegistry(): Promise<Registry> {
  const p = getRegistryPath();
  if (await pathExists(p)) {
    const data = await fs.readFile(p, 'utf8');
    try {
      return JSON.parse(data);
    } catch (e: any) {
      throw new Error(`Corrupted registry file at ${p}. Please delete or fix it. (${e.message})`);
    }
  }
  return { version: 1, active: null, envs: {} };
}

export async function withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(homeDir(), '.config', 'agenv', 'registry.lock');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  
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
    throw new Error('another agenv process is running');
  }

  try {
    return await fn();
  } finally {
    try {
      await fs.rmdir(lockPath);
    } catch {}
  }
}

export async function saveRegistry(r: Registry): Promise<void> {
  const p = getRegistryPath();
  await writeFileAtomic(p, JSON.stringify(r, null, 2));
}

export async function registerEnv(name: string, env: { path: string; url: string | null }): Promise<void> {
  await withRegistryLock(async () => {
    const r = await loadRegistry();
    const absPath = path.resolve(env.path);
    const existing = r.envs[name];
    
    r.envs[name] = {
      path: absPath,
      url: env.url ?? existing?.url ?? null,
      lastSynced: existing?.lastSynced ?? null,
    };
    await saveRegistry(r);
  });
}

export async function unregisterEnv(name: string): Promise<boolean> {
  return await withRegistryLock(async () => {
    const r = await loadRegistry();
    if (!r.envs[name]) return false;
    
    delete r.envs[name];
    if (r.active === name) {
      r.active = null;
    }
    await saveRegistry(r);
    return true;
  });
}

export async function setActive(name: string): Promise<boolean> {
  return await withRegistryLock(async () => {
    const r = await loadRegistry();
    if (!r.envs[name]) return false;
    r.active = name;
    await saveRegistry(r);
    return true;
  });
}

export async function getActive(): Promise<{ name: string; env: RegistryEnv } | null> {
  const r = await loadRegistry();
  if (!r.active || !r.envs[r.active]) return null;
  return { name: r.active, env: r.envs[r.active] };
}

export async function listEnvNames(): Promise<string[]> {
  const r = await loadRegistry();
  return Object.keys(r.envs);
}

export async function getEnvByUrl(url: string): Promise<{ name: string; env: RegistryEnv } | null> {
  const r = await loadRegistry();
  for (const [name, env] of Object.entries(r.envs)) {
    if (env.url === url) {
      return { name, env };
    }
  }
  return null;
}
