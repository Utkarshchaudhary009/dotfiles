export type ToolCategoryId = 'opencode' | 'claude' | 'agents' | 'git' | 'vscode' | 'shell' | 'custom';
export const ALL_CATEGORIES = ['opencode','claude','agents','git','vscode','shell'] as const;

export interface CategorySettings {
  id: ToolCategoryId;
  label: string;
  enabled: boolean;
  sourceRoot?: string;          // filesystem dir to scan
  targetRoot: string;           // target home path, e.g. ".config/opencode"
}

export interface ConfigSettings {
  rootDir: string;              // environment repo root
  encryption: { method: 'age'; keyPath: string };
  categories: CategorySettings[];  // per-category activation + paths
}
