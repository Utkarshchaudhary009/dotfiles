import { CLIError } from '../errors';
import { resolveTarget } from '../resolve';
import { runProcess } from '../proc';
import { gitPushSetUpstream } from '../git';
import { loadRegistry, saveRegistry, withRegistryLock } from '../registry';
import { expandCommand } from './expand';
import * as clack from '@clack/prompts';
import { requireAgenvRepo } from '../config';
import chalk from 'chalk';
import { loadManifest } from '../manifest';
import { planReconcile, stageCanonicalFiles, SyncPlan, SyncAction, ConflictFile } from '../reconcile';
import { log, isJsonMode } from '../logger';

export interface SyncOptions {
  push?: boolean;
  noPush?: boolean;
  yes?: boolean;
  scan?: boolean;
  rebase?: boolean;
  json?: boolean;
}

export interface SyncResult {
  action: SyncAction;
  remote: SyncPlan['remote'];
  pulled: number;
  pushed: number;
  expanded: number;
  captured: number;
  conflicts: ConflictFile[];
  nextCommand: string;
  reason: string;
}

interface SyncCounts {
  pulled: number;
  pushed: number;
  expanded: number;
  captured: number;
  pushSkippedReason: string;
}

function pullArgs(rebase: boolean): string[] {
  return rebase ? ['pull', '--rebase'] : ['pull', '--ff-only'];
}

async function commitIfNeeded(repoPath: string, message: string): Promise<{ committed: boolean; staged: string[] }> {
  // Clear any pre-staged entries so a sync commit only ever touches the
  // canonical agenv state. Without this, anything the user (or another
  // tool) staged before sync ran would be silently included.
  await runProcess(['git', 'reset', '--', '.'], { cwd: repoPath });
  const staged = await stageCanonicalFiles(repoPath);
  for (const f of staged) {
    await runProcess(['git', 'add', '--', f], { cwd: repoPath });
  }
  if (staged.length === 0) {
    return { committed: false, staged: [] };
  }
  const res = await runProcess(['git', 'commit', '-m', message], { cwd: repoPath });
  const out = (res.stdout + res.stderr).toLowerCase();
  if (res.code === 0) return { committed: true, staged };
  if (out.includes('nothing to commit')) return { committed: false, staged };
  throw new CLIError(`Failed to commit: ${(res.stderr || res.stdout).trim()}`);
}

export async function syncCommand(target: string | undefined, options: SyncOptions) {
  const resolved = await resolveTarget(target);
  const repoPath = resolved.path;

  await requireAgenvRepo(repoPath);

  // If the registry knows a URL for this environment but git has no origin
  // yet, register it before planning. Without this, sync would skip the
  // pull/push entirely even though the user clearly intended a remote.
  if (resolved.url) {
    const existing = await runProcess(['git', 'remote', 'get-url', 'origin'], { cwd: repoPath });
    if (existing.code !== 0 || !existing.stdout.trim()) {
      await runProcess(['git', 'remote', 'add', 'origin', resolved.url], { cwd: repoPath });
    }
  }

  const manifest = await loadManifest(repoPath);
  const plan = await planReconcile(repoPath, manifest, { rebase: options.rebase });

  if (plan.action === 'error') {
    return finish(plan, { pulled: 0, pushed: 0, expanded: 0, captured: 0, pushSkippedReason: '' }, options);
  }

  if (plan.action === 'diverged-conflict') {
    throw new CLIError(
      `Branches diverged. Run: ${plan.nextCommand}\n` +
      `If rebase is not safe, resolve manually and retry.`,
    );
  }

  if (!isJsonMode() && !options.json) {
    clack.log.info(`Syncing environment at ${repoPath}`);
  }

  let remoteUrl = resolved.url;
  if (plan.remote !== 'no-remote' && !remoteUrl) {
    const r = await runProcess(['git', 'remote', 'get-url', 'origin'], { cwd: repoPath });
    if (r.code === 0) remoteUrl = r.stdout.trim();
  }

  // ---- pull ----
  let pulled = 0;
  if (plan.action === 'pull' || plan.action === 'pull-and-push' || plan.action === 'diverged-rebase') {
    if (!isJsonMode() && !options.json) clack.log.step(`Pulling from remote (${options.rebase ? 'rebase' : 'ff-only'})...`);
    const pullRes = await runProcess(['git', ...pullArgs(!!options.rebase)], { cwd: repoPath });
    if (pullRes.code !== 0) {
      throw new CLIError(
        `Pull failed.\n${(pullRes.stderr || pullRes.stdout).trim()}\n` +
        `Retry: agenv sync${options.rebase ? '' : ' --rebase'}`,
      );
    }
    pulled = countPulledCommits(pullRes.stdout);
  }

  // ---- capture BEFORE expand ----
  // Auto-capture must run before expand so that any newly-discovered
  // tracked file is read from disk into the repo before we overwrite
  // the disk with the repo copy. Otherwise `expand --force` would clobber
  // the user's local edits.
  let captured = 0;
  if (options.scan !== false && (plan.action === 'pull-and-push' || plan.action === 'capture-and-push' || plan.action === 'diverged-rebase')) {
    const { discoverConfigs, applyDiscovered } = await import('./scan');
    try {
      const discovered = await discoverConfigs();
      if (discovered.length > 0) {
        const outcome = await applyDiscovered(repoPath, discovered, { yes: options.yes });
        captured = outcome.added.length + outcome.updated.length;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      clack.log.warn(`Auto-capture skipped: ${msg}`);
    }
  }

  // ---- expand ----
  let expanded = 0;
  if (plan.action !== 'noop') {
    if (!isJsonMode() && !options.json) clack.log.step('Expanding files...');
    const before = manifest.files.length;
    await expandCommand(repoPath, { force: true });
    const afterManifest = await loadManifest(repoPath);
    expanded = Math.max(0, afterManifest.files.length - before);
  }

  // ---- commit + push ----
  let pushed = 0;
  let pushSkippedReason = '';
  if (plan.action === 'capture-and-push' || plan.action === 'pull-and-push' || plan.action === 'diverged-rebase') {
    const shouldPush = await decideShouldPush(options, repoPath);
    if (shouldPush) {
      if (!isJsonMode() && !options.json) clack.log.step('Committing local changes...');
      const { committed } = await commitIfNeeded(repoPath, 'Sync agenv environment');
      if (committed && plan.remote !== 'no-remote') {
        if (!isJsonMode() && !options.json) clack.log.step('Pushing to remote...');
        await gitPushSetUpstream(repoPath);
        pushed = 1;
      } else if (committed) {
        if (!isJsonMode() && !options.json) clack.log.info('Committed locally. No remote — run "agenv publish" to push.');
        pushSkippedReason = 'no remote';
      }
    } else {
      if (options.noPush) pushSkippedReason = '--no-push flag';
      else if (options.yes) pushSkippedReason = '--yes prevents interactive prompt';
      else pushSkippedReason = 'user declined or no changes';
    }
  }

  // ---- registry update ----
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

  return finish(plan, { pulled, pushed, expanded, captured, pushSkippedReason }, options);
}

async function decideShouldPush(options: SyncOptions, repoPath: string): Promise<boolean> {
  if (options.noPush) return false;
  if (options.push) return true;
  if (!process.stdout.isTTY || options.yes) return false;
  const res = await runProcess(['git', 'status', '--porcelain'], { cwd: repoPath });
  if (res.stdout.trim().length === 0) return false;
  const confirm = await clack.confirm({
    message: 'Local changes detected — commit & push them?',
    initialValue: true,
  });
  if (clack.isCancel(confirm)) throw new CLIError('Sync cancelled.');
  return confirm === true;
}

function countPulledCommits(stdout: string): number {
  // `git pull --ff-only` emits "Fast-forward\n ... X files changed".
  // `git pull --rebase` emits "Rebasing (N/M)..." and "X files changed".
  // Both end with a "X files changed" line for non-empty pulls.
  const m = stdout.match(/(\d+)\s+files? changed/);
  if (m) return parseInt(m[1], 10);
  if (/Fast-forward/.test(stdout)) return 1;
  if (/Successfully rebased/.test(stdout)) return 1;
  return 0;
}

function finish(plan: SyncPlan, counts: SyncCounts, options: SyncOptions): SyncResult {
  const result: SyncResult = {
    action: plan.action,
    remote: plan.remote,
    pulled: counts.pulled,
    pushed: counts.pushed,
    expanded: counts.expanded,
    captured: counts.captured,
    conflicts: plan.conflicts,
    nextCommand: plan.nextCommand,
    reason: plan.reason,
  };
  if (options.json || isJsonMode()) {
    log.json(result);
    return result;
  }
  clack.log.success(chalk.bgGreen(chalk.black(' SYNC COMPLETE ')));
  if (plan.action === 'noop') {
    clack.log.info(`Nothing to sync — ${plan.reason}`);
    return result;
  }
  const parts: string[] = [];
  if (counts.pulled) parts.push(`Pulled ${counts.pulled}`);
  if (counts.captured) parts.push(`Captured ${counts.captured}`);
  if (counts.expanded) parts.push(`Expanded ${counts.expanded}`);
  if (counts.pushed) parts.push(`Pushed`);
  if (parts.length === 0) parts.push('In sync');
  if (counts.pushSkippedReason && !counts.pushed) parts.push(`Push skipped (${counts.pushSkippedReason})`);
  clack.log.info(parts.join(' · '));
  if (plan.nextCommand) clack.log.info(`Next: ${plan.nextCommand}`);
  return result;
}
