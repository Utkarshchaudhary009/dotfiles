import { CLIError } from '../errors';
import { resolveTarget } from '../resolve';
import { runProcess } from '../proc';
import { gitPushSetUpstream } from '../git';
import { loadRegistry, saveRegistry, withRegistryLock } from '../registry';
import { expandCommand } from './expand';
import * as clack from '@clack/prompts';
import { requireAgenvRepo } from '../config';
import chalk from 'chalk';
import { pathExists } from '../fs';
import * as path from 'node:path';
import { discoverConfigs, applyDiscovered } from './scan';

export interface SyncOptions {
  push?: boolean;
  noPush?: boolean;
  yes?: boolean;
  /**
   * Whether to auto-capture newly discoverable files. Commander maps the
   * `--no-scan` flag to `options.scan = false`, so the default is true.
   */
  scan?: boolean;
}

export async function syncCommand(target: string | undefined, options: SyncOptions) {
  const resolved = await resolveTarget(target);
  const repoPath = resolved.path;

  await requireAgenvRepo(repoPath);

  clack.log.info(`Syncing environment at ${repoPath}`);
    let remoteUrl = resolved.url;

  // Pull logic
  let hasRemote = false;
  try {
    const res = await runProcess(['git', 'remote', 'get-url', 'origin'], { cwd: repoPath });
    if (res.code === 0 && res.stdout.trim()) {
      hasRemote = true;
      if (!remoteUrl) remoteUrl = res.stdout.trim();
    }
  } catch {
    hasRemote = false;
  }

  if (!hasRemote && remoteUrl) {
    clack.log.step(`Adding remote origin: ${remoteUrl}`);
    await runProcess(['git', 'remote', 'add', 'origin', remoteUrl], { cwd: repoPath });
    hasRemote = true;
  }

  if (hasRemote) {
    clack.log.step('Pulling from remote...');
    try {
      const pullRes = await runProcess(['git', 'pull', '--ff-only'], { cwd: repoPath });
      if (pullRes.code !== 0) {
        throw new CLIError(`Pull failed \u2014 resolve conflicts and retry.\n${pullRes.stderr}`);
      }
      clack.log.success('\u2713 PULL ok');
    } catch (e: any) {
      throw new CLIError(`Pull failed \u2014 resolve conflicts and retry.\n${e.message || String(e)}`);
    }
  } else {
    clack.log.info('No remote configured and no URL found in registry. Skipping pull.');
  }

  // Auto-capture newly discoverable files (idempotent: skips already-tracked ones).
  if (options.scan !== false) {
    try {
      const discovered = await discoverConfigs();
      if (discovered.length > 0) {
        const outcome = await applyDiscovered(repoPath, discovered, { yes: options.yes });
        const added = outcome.added.length + outcome.updated.length;
        if (added > 0) {
          clack.log.step(`Captured ${added} discoverable file(s) (${outcome.skipped.length} skipped).`);
        } else {
          clack.log.info(`${discovered.length} discoverable file(s) already tracked.`);
        }
      }
    } catch (e: unknown) {
      // Auto-capture is a best-effort convenience — never block sync.
      const msg = e instanceof Error ? e.message : String(e);
      clack.log.warn(`Auto-capture skipped: ${msg}`);
    }
  }

  // Expand
  clack.log.step('Expanding files...');
  await expandCommand(repoPath, { force: true });

  // Local changes check
  const statusRes = await runProcess(['git', 'status', '--porcelain'], { cwd: repoPath });
  const hasChanges = statusRes.stdout.trim().length > 0;
  let pushDone = false;
  let pushSkippedReason = 'no changes';

  if (hasChanges) {
    let shouldPush = options.push;
    
    if (options.noPush) {
      shouldPush = false;
      pushSkippedReason = '--no-push flag';
    } else if (shouldPush === undefined) {
      if (process.stdout.isTTY && !options.yes) {
        const confirm = await clack.confirm({
          message: 'Local changes detected \u2014 commit & push them?',
          initialValue: true,
        });
        if (clack.isCancel(confirm)) {
          throw new CLIError('Sync cancelled.');
        }
        shouldPush = confirm === true;
        if (!shouldPush) pushSkippedReason = 'user declined';
      } else if (options.yes) {
        shouldPush = false;
        pushSkippedReason = '--yes flag prevents interactive prompt';
      }
    }

    if (shouldPush) {
      clack.log.step('Committing local changes...');
      await runProcess(['git', 'add', '-u'], { cwd: repoPath });
      
      if (await pathExists(path.join(repoPath, 'agenv.json'))) {
        await runProcess(['git', 'add', 'agenv.json'], { cwd: repoPath });
      }
      if (await pathExists(path.join(repoPath, 'files'))) {
        await runProcess(['git', 'add', 'files'], { cwd: repoPath });
      }

      await runProcess(['git', 'commit', '-m', 'Sync agenv environment'], { cwd: repoPath });
      
      if (hasRemote) {
        clack.log.step('Pushing to remote...');
        await gitPushSetUpstream(repoPath);
        pushDone = true;
      } else {
        clack.log.info('Committed locally. No remote \u2014 run "agenv publish" to push.');
        pushSkippedReason = 'no remote';
      }
    }
  }

  // Update registry
  if (resolved.name) {
    await withRegistryLock(async () => {
      const r = await loadRegistry();
      if (r.envs[resolved.name!]) {
        r.envs[resolved.name!].lastSynced = new Date().toISOString();
        if (remoteUrl && !r.envs[resolved.name!].url) {
          r.envs[resolved.name!].url = remoteUrl;
        }
        await saveRegistry(r);
      }
    });
  }

  // Summary
  clack.log.success(chalk.bgGreen(chalk.black(' SYNC COMPLETE ')));
  const pushMsg = pushDone ? 'PUSH done' : `PUSH skipped (${pushSkippedReason})`;
  clack.log.info(`PULL ok | Files expanded | ${pushMsg}`);
}
