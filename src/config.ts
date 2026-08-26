import * as path from 'node:path';
import { pathExists, readText } from './fs';
import { CategorySettings, ConfigSettings } from './types';
import { isWindows } from './platform';
import { CLIError } from './errors';

export function createDefaultConfig(rootDir: string): ConfigSettings {
  return {
    rootDir,
    encryption: { method: 'age', keyPath: '~/.config/agenv/key.txt' },
    categories: [
      { id: 'opencode', label: 'Opencode', enabled: false, targetRoot: '~/.config/opencode' },
      { id: 'claude', label: 'Claude', enabled: false, targetRoot: '~/.claude' },
      { id: 'agents', label: 'Agents', enabled: false, targetRoot: '~/.agents' },
      { id: 'git', label: 'Git', enabled: false, targetRoot: '~/' },
      { id: 'vscode', label: 'VS Code', enabled: false, targetRoot: isWindows() ? '~/AppData/Roaming/Code/User' : '~/.config/Code/User' },
      { id: 'shell', label: 'Shell', enabled: false, targetRoot: '~/' }
    ]
  };
}

/** Scanner-preset definition for a category id, or null when not a preset. */
export function presetCategory(id: string): CategorySettings | null {
  return createDefaultConfig('').categories.find(c => c.id === id) ?? null;
}

export async function findConfig(startDir: string): Promise<{ rootDir: string; config: ConfigSettings } | null> {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, 'agenv.json');
    if (await pathExists(candidate)) {
      const data = JSON.parse(await readText(candidate));
      if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.files)) {
        throw new CLIError(`Corrupt agenv.json at ${candidate}`);
      }
      return { rootDir: current, config: data.config as ConfigSettings };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function loadConfig(rootDir: string): Promise<ConfigSettings> {
  const candidate = path.join(rootDir, 'agenv.json');
  if (await pathExists(candidate)) {
    const data = JSON.parse(await readText(candidate));
    if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.files) || !data.config || !Array.isArray(data.config.categories)) {
      throw new CLIError(`Corrupt agenv.json at ${candidate}`);
    }
    return data.config as ConfigSettings;
  }
  return createDefaultConfig(rootDir);
}

export async function isAgenvRepo(dir: string): Promise<boolean> {
  return await pathExists(path.join(dir, 'agenv.json'));
}

export async function requireAgenvRepo(startDir = process.cwd(), hint = ''): Promise<{ rootDir: string; config: ConfigSettings }> {
  const found = await findConfig(startDir);
  if (!found) {
    throw new CLIError(`Not in an agenv repository. Run 'agenv init' or 'agenv clone' first.${hint ? ' ' + hint : ''}`);
  }
  return found;
}
