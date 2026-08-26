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

/**
 * Category-aware sensitivity for ad-hoc/path-mode adds — mirrors what the
 * scan presets flag (git configs, shell profiles, Claude credentials) and
 * always keeps the generic keyword heuristic, so `agenv add ~/.gitconfig`
 * demands --encrypt even without a sensitive keyword, and a git-category
 * file named e.g. `tokens.json` stays flagged too.
 */
export function isSensitiveForCategory(categoryId: string, targetRel: string): boolean {
  const segments = targetRel.replace(/\\/g, '/').split('/');
  const base = (segments[segments.length - 1] || '').toLowerCase();
  switch (categoryId) {
    case 'git':
      return base === '.gitconfig' || base === '.gitignore_global' || isSensitive(targetRel);
    case 'shell':
      return (
        ['.bashrc', '.zshrc', '.bash_profile', '.profile'].includes(base) ||
        base.endsWith('powershell_profile.ps1') ||
        isSensitive(targetRel)
      );
    case 'claude':
      return base === '.credentials.json' || isSensitive(targetRel);
    default:
      return isSensitive(targetRel);
  }
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
            sensitive: isSensitiveForCategory('opencode', rel)
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
        sensitive: isSensitiveForCategory('claude', rel)
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
        sensitive: isSensitiveForCategory('agents', rel)
      }));
    }
  },
  {
    category: 'git',
    find: async () => {
      const candidates: FileCandidate[] = [];
      const conf = path.join(homeDir(), '.gitconfig');
      if (await pathExists(conf)) {
        candidates.push({ id: 'git:config', category: 'git', label: 'Git Config', sourcePath: conf, targetRel: '.gitconfig', sensitive: isSensitiveForCategory('git', '.gitconfig') });
      }
      const ignore = path.join(homeDir(), '.gitignore_global');
      if (await pathExists(ignore)) {
        candidates.push({ id: 'git:ignore_global', category: 'git', label: 'Git Global Ignore', sourcePath: ignore, targetRel: '.gitignore_global', sensitive: isSensitiveForCategory('git', '.gitignore_global') });
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
          candidates.push({ id: `shell:${f}`, category: 'shell', label: `Shell ${f}`, sourcePath: p, targetRel: f, sensitive: isSensitiveForCategory('shell', f) });
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
            sensitive: isSensitiveForCategory('shell', ps) 
          });
          }
        }
      }
      
      return candidates;
    }
  }
];

/**
 * Deterministic ordering: by preset category (so the same tool grouping
 * always appears first) then by targetRel. The underlying `readdir` walk does
 * not guarantee order, so we sort explicitly — repeated scans of the same
 * machine state must produce identical results.
 */
const PRESET_ORDER = presets.map(p => p.category);

function sortCandidates(cands: FileCandidate[]): FileCandidate[] {
  return [...cands].sort((a, b) => {
    const ca = PRESET_ORDER.indexOf(a.category);
    const cb = PRESET_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.targetRel.replace(/\\/g, '/').localeCompare(b.targetRel.replace(/\\/g, '/'));
  });
}

export async function scanSystem(cats: ToolCategoryId[]): Promise<FileCandidate[]> {
  let all: FileCandidate[] = [];
  for (const preset of presets) {
    if (cats.includes(preset.category)) {
      const found = await preset.find();
      // Sort within a preset too, so a single category's output is stable.
      all = all.concat(sortCandidates(found));
    }
  }
  return sortCandidates(all);
}
