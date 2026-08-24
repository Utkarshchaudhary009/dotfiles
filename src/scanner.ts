import * as path from 'node:path';
import { pathExists, listFilesRecursive } from './fs';
import { homeDir } from './platform';
import { ToolCategoryId } from './types';
import { isWindows } from './platform';

export interface FileCandidate {
  id: string;
  category: ToolCategoryId;
  label: string;
  sourcePath: string;
  targetRel: string;
  sensitive: boolean;
  description?: string;
}

interface ScanPreset {
  category: ToolCategoryId;
  find: () => Promise<FileCandidate[]>;
}

export function isSensitive(name: string): boolean {
  const lower = name.toLowerCase();
  return ['auth', 'credentials', 'token', 'accounts', 'backup', '.env', 'keys', 'secret'].some(kw => lower.includes(kw));
}

const presets: ScanPreset[] = [
  {
    category: 'opencode',
    find: async () => {
      const root = path.join(homeDir(), '.config', 'opencode');
      if (!(await pathExists(root))) return [];
      const candidates: FileCandidate[] = [];
      
      const files = await listFilesRecursive(root);
      for (const rel of files) {
        if (
          rel === 'opencode.json' || 
          rel === 'opencode.jsonc' || 
          rel === 'smart-title.jsonc' ||
          rel.startsWith(`agents${path.sep}`) ||
          rel.startsWith(`skills${path.sep}`)
        ) {
          candidates.push({
            id: `opencode:${rel.replace(/[\\/]/g, '-')}`,
            category: 'opencode',
            label: `Opencode ${rel}`,
            sourcePath: path.join(root, rel),
            targetRel: rel,
            sensitive: isSensitive(rel)
          });
        }
      }
      return candidates;
    }
  },
  {
    category: 'claude',
    find: async () => {
      const root = path.join(homeDir(), '.claude');
      if (!(await pathExists(root))) return [];
      const files = await listFilesRecursive(root);
      const excludeRegex = /telemetry|todos__|projects__|stats-cache|sessions-index/;
      return files.filter(f => f.endsWith('.json') && !excludeRegex.test(f)).map(rel => ({
        id: `claude:${rel.replace(/[\\/]/g, '-')}`,
        category: 'claude',
        label: `Claude ${rel}`,
        sourcePath: path.join(root, rel),
        targetRel: rel,
        sensitive: isSensitive(rel) || rel === '.credentials.json'
      }));
    }
  },
  {
    category: 'agents',
    find: async () => {
      const root = path.join(homeDir(), '.agents');
      if (!(await pathExists(root))) return [];
      const files = await listFilesRecursive(root);
      return files.filter(f => f.startsWith(`skills${path.sep}`)).map(rel => ({
        id: `agents:${rel.replace(/[\\/]/g, '-')}`,
        category: 'agents',
        label: `Agents ${rel}`,
        sourcePath: path.join(root, rel),
        targetRel: rel,
        sensitive: isSensitive(rel)
      }));
    }
  },
  {
    category: 'git',
    find: async () => {
      const candidates: FileCandidate[] = [];
      const conf = path.join(homeDir(), '.gitconfig');
      if (await pathExists(conf)) {
        candidates.push({ id: 'git:config', category: 'git', label: 'Git Config', sourcePath: conf, targetRel: '.gitconfig', sensitive: true });
      }
      const ignore = path.join(homeDir(), '.gitignore_global');
      if (await pathExists(ignore)) {
        candidates.push({ id: 'git:ignore_global', category: 'git', label: 'Git Global Ignore', sourcePath: ignore, targetRel: '.gitignore_global', sensitive: true });
      }
      return candidates;
    }
  },
  {
    category: 'vscode',
    find: async () => {
      const p = isWindows() 
        ? path.join(process.env.APPDATA || '', 'Code', 'User', 'settings.json')
        : path.join(homeDir(), '.config', 'Code', 'User', 'settings.json');
      if (await pathExists(p)) {
        return [{ id: 'vscode:settings', category: 'vscode', label: 'VS Code Settings', sourcePath: p, targetRel: 'settings.json', sensitive: false }];
      }
      return [];
    }
  },
  {
    category: 'shell',
    find: async () => {
      const files = ['.bashrc', '.zshrc', '.bash_profile', '.profile'];
      const candidates: FileCandidate[] = [];
      for (const f of files) {
        const p = path.join(homeDir(), f);
        if (await pathExists(p)) {
          candidates.push({ id: `shell:${f}`, category: 'shell', label: `Shell ${f}`, sourcePath: p, targetRel: f, sensitive: true });
        }
      }
      
      if (isWindows()) {
        const psProfiles = [
          path.join('Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
          path.join('Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')
        ];
        for (const ps of psProfiles) {
          const p = path.join(homeDir(), ps);
          if (await pathExists(p)) {
            candidates.push({ 
              id: `shell:ps1-${ps.replace(/[\\/]/g, '-')}`, 
              category: 'shell', 
              label: `PowerShell Profile`, 
              sourcePath: p, 
              targetRel: ps, // Relative to ~
              sensitive: true 
            });
          }
        }
      }
      
      return candidates;
    }
  }
];

export async function scanSystem(cats: ToolCategoryId[]): Promise<FileCandidate[]> {
  let all: FileCandidate[] = [];
  for (const preset of presets) {
    if (cats.includes(preset.category)) {
      const found = await preset.find();
      all = all.concat(found);
    }
  }
  return all;
}
