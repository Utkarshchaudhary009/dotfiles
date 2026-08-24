import * as path from 'node:path';
import { isAgenvRepo } from './config';
import { loadRegistry, getEnvByUrl } from './registry';
import { pathExists } from './fs';

export function isLikelyUrl(s: string): boolean {
  return s.includes('://') || s.startsWith('git@') || s.endsWith('.git');
}

export async function resolveTarget(raw: string | undefined): Promise<{ name: string | null; path: string; url: string | null }> {
  const r = await loadRegistry();

  if (raw === undefined) {
    // 1. Try active from registry
    if (r.active && r.envs[r.active]) {
      return { name: r.active, path: r.envs[r.active].path, url: r.envs[r.active].url };
    }
    
    // 2. Fallback to cwd walk-up
    let current = process.cwd();
    while (true) {
      if (await isAgenvRepo(current)) {
        return { name: null, path: current, url: null };
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    
    throw new Error(`No active environment registered and current directory is not an agenv repo. Run 'agenv bind <name>' or 'agenv init'.`);
  }

  // Exact registry name match
  if (r.envs[raw]) {
    return { name: raw, path: r.envs[raw].path, url: r.envs[raw].url };
  }

  // Looks like URL
  if (isLikelyUrl(raw)) {
    const fromReg = await getEnvByUrl(raw);
    if (fromReg) {
      return { name: fromReg.name, path: fromReg.env.path, url: fromReg.env.url };
    }
    throw new Error(`Environment not registered \u2014 run 'agenv clone ${raw}' first or 'agenv bind <name> --url ${raw}'.`);
  }

  // Looks like path
  const absPath = path.resolve(raw);
  if (await pathExists(absPath)) {
    if (await isAgenvRepo(absPath)) {
      return { name: null, path: absPath, url: null };
    }
    throw new Error(`Target directory exists but is not an agenv repo: ${absPath}`);
  }

  throw new Error(`Unknown target '${raw}'. Not a registry name, valid url, or existing path.`);
}
