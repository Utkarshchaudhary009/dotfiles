import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CLIError } from '../errors';
import { log } from '../logger';
import { CLI_VERSION } from '../version';

const REPO = 'Utkarshchaudhary009/dotfiles';
const ASSET_NAME = 'agenv.js';
const API_BASE = 'https://api.github.com';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface LatestRelease {
  tag_name: string;
  assets: ReleaseAsset[];
}

/** Compare dotted numeric versions; positive when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agenv-cli' }
    });
  } catch {
    throw new CLIError('Network error: could not reach github.com');
  }
  if (res.status === 404) {
    throw new CLIError(`No releases found for ${REPO}. Install manually from the repository.`);
  }
  if (!res.ok) {
    throw new CLIError(`GitHub API error ${res.status} while fetching latest release`);
  }
  return (await res.json()) as LatestRelease;
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'agenv-cli' } });
  if (!res.ok || !res.body) {
    throw new CLIError(`Download failed with HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf, { mode: 0o755 });
}

export async function selfUpdateCommand(): Promise<void> {
  log.info(`Current agenv version: ${CLI_VERSION}`);

  const release = await fetchLatestRelease();
  const latest = release.tag_name;

  if (compareVersions(latest, CLI_VERSION) <= 0) {
    log.ok(`Already up to date (${CLI_VERSION}).`);
    return;
  }

  const asset = release.assets.find((a) => a.name === ASSET_NAME);
  if (!asset) {
    throw new CLIError(`Latest release ${latest} has no ${ASSET_NAME} asset`);
  }

  const target = process.argv[1] ? await fs.realpath(process.argv[1]) : '';
  if (!target.toLowerCase().endsWith('.js')) {
    throw new CLIError('Cannot locate installed agenv bundle; reinstall via install.ps1/install.sh or npm.');
  }
  if (target.includes('node_modules')) {
    log.warn('agenv appears to be npm-installed; prefer: npm install -g agenv@latest');
  }

  const tmp = path.join(path.dirname(target), `${path.basename(target)}.tmp-${process.pid}`);
  log.info(`Downloading ${latest}...`);
  try {
    await downloadTo(asset.browser_download_url, tmp);
    await fs.rename(tmp, target);
  } catch (e: unknown) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    if (e instanceof CLIError) throw e;
    throw new CLIError(
      `Update failed: ${e instanceof Error ? e.message : String(e)}. Re-run the installer script to recover.`
    );
  }

  log.ok(`Updated agenv to ${latest}. Open a new shell and run agenv --version.`);
}
