import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import { runProcess } from '../src/proc';

const cliPath = path.resolve(__dirname, '../dist/agenv.js');

describe('export and import commands', () => {
  let sourceDir: string;
  let targetDir: string;
  let bundlePath: string;

  beforeAll(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tests-export-source-'));
    targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tests-export-target-'));
    bundlePath = path.join(sourceDir, 'bundle.tar.gz');
  });

  afterAll(async () => {
    try { await fs.rm(sourceDir, { recursive: true, force: true }); } catch (e) {}
    try { await fs.rm(targetDir, { recursive: true, force: true }); } catch (e) {}
  });

  test('setup fake agenv repo', async () => {
    const manifest = {
      version: 1,
      config: {
        rootDir: sourceDir,
        encryption: { method: 'age', keyPath: '~/.config/agenv/key.txt' },
        categories: [
          { id: 'shell', label: 'Shell', enabled: true, targetRoot: path.join(sourceDir, 'home') }
        ]
      },
      files: [
        { id: 'shell/test.txt', category: 'shell', targetRel: 'test.txt', encrypt: false }
      ]
    };

    await fs.writeFile(path.join(sourceDir, 'agenv.json'), JSON.stringify(manifest, null, 2));
    
    await fs.mkdir(path.join(sourceDir, 'files', 'shell'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'files', 'shell', 'test.txt'), 'hello world');
    
    await fs.mkdir(path.join(sourceDir, '.git'));
    await fs.writeFile(path.join(sourceDir, '.git', 'config'), 'fake git config');
  });

  test('agenv export creates tarball without .git', async () => {
    const res = await runProcess(['node', cliPath, 'export', '--out', bundlePath], { cwd: sourceDir });
    if (res.code !== 0) {
      console.error('EXPORT STDOUT:', res.stdout);
      console.error('EXPORT STDERR:', res.stderr);
    }
    expect(res.code).toBe(0);
    
    const stat = await fs.stat(bundlePath);
    expect(stat.size).toBeGreaterThan(0);
    
    const tarRes = await runProcess(['tar', '-tzf', bundlePath], { cwd: sourceDir });
    expect(tarRes.code).toBe(0);
    
    const files = tarRes.stdout.split('\n').filter(Boolean);
    expect(files.some(f => f.includes('agenv.json'))).toBe(true);
    expect(files.some(f => f.includes('files/shell/test.txt'))).toBe(true);
    
    expect(files.some(f => f.includes('.git/config'))).toBe(false);
  }, 30000);

  test('agenv import extracts and deploys', async () => {
    const res = await runProcess(['node', cliPath, 'import', bundlePath, '--dir', targetDir], { cwd: process.cwd() });
    
    expect(res.code).toBe(0);
    
    const hasManifest = await fs.stat(path.join(targetDir, 'agenv.json')).then(() => true).catch(() => false);
    expect(hasManifest).toBe(true);
    
    const hasFiles = await fs.stat(path.join(targetDir, 'files', 'shell', 'test.txt')).then(() => true).catch(() => false);
    expect(hasFiles).toBe(true);
    
    const expandRes = await runProcess(['node', cliPath, 'expand', '--dry-run'], { cwd: targetDir });
    if (expandRes.code !== 0) {
      console.error('EXPAND STDOUT:', expandRes.stdout);
      console.error('EXPAND STDERR:', expandRes.stderr);
    }
    expect(expandRes.code).toBe(0);
  }, 15000);
});
