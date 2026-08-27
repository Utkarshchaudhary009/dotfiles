#!/usr/bin/env node
import { program } from 'commander';
import { log, setJsonMode } from './logger';
import { describeError } from './errors';
import { initCommand } from './commands/init';
import { scanCommand } from './commands/scan';
import { addCommand } from './commands/add';
import { removeCommand } from './commands/remove';
import { cloneCommand } from './commands/clone';
import { expandCommand } from './commands/expand';
import { updateCommand } from './commands/update';
import { statusCommand } from './commands/status';
import { listCommand } from './commands/list';
import { doctorCommand } from './commands/doctor';
import { publishCommand } from './commands/publish';
import { pushCommand } from './commands/push';
import { exportCommand } from './commands/export';
import { importCommand } from './commands/import';
import { envsCommand } from './commands/envs';
import { bindCommand } from './commands/bind';
import { unbindCommand } from './commands/unbind';
import { useCommand } from './commands/use';
import { syncCommand } from './commands/sync';
import { selfUpdateCommand } from './commands/self-update';
import { ALL_CATEGORIES } from './types';
import { CLI_VERSION } from './version';

function wrap(fn: (...args: any[]) => Promise<unknown>) {
  return async (...args: any[]) => {
    // Commander passes an options object; --json silences prose on stdout.
    const opts = args.find(a => a && typeof a === 'object' && !Array.isArray(a) && 'json' in a) as { json?: boolean } | undefined;
    if (opts?.json) setJsonMode(true);
    try {
      await fn(...args);
    } catch (e: unknown) {
      const { message, hint } = describeError(e);
      log.error(message);
      if (hint) log.hint(hint);
      process.exit(1);
    }
  };
}

program
  .name('agenv')
  .description('Portable encrypted AI environment manager')
  .version(CLI_VERSION);

program
  .command('init')
  .description('Initialize a new agenv repository')
  .option('--dir <path>', 'Directory to initialize in (default: cwd)')
  .option('--yes', 'Skip interactive prompts and use defaults')
  .option('--allow-plaintext-secrets', 'Allow storing sensitive files without encryption')
  .option('--force', 'Force initialization even if agenv.json exists')
  .option('--publish', 'Publish to GitHub after init (for --yes mode)')
  .option('--no-publish', 'Do not ask to publish after init')
  .action(wrap(initCommand));

program
  .command('scan')
  .description('Scan system for discoverable config files')
  .option('--category <id>', 'Only scan this tool category (opencode, claude, agents, git, vscode, shell)')
  .option('--apply', 'Track every discovered file via the shared capture engine')
  .option('--encrypt', 'Encrypt captured files (use with --apply)')
  .option('--allow-plaintext-secrets', 'Allow adding sensitive files without encryption')
  .option('-u, --update', 'With --apply: refresh drifted already-tracked files')
  .option('--yes', 'Non-interactive: keep local versions when files differ from repo')
  .option('--json', 'Emit machine-readable JSON on stdout')
  .action(wrap(scanCommand));

program
  .command('add')
  .description('Track files, directories, or a whole tool category (e.g. agenv add opencode)')
  .argument('<files...>', 'File/dir paths — or one bare category id: ' + ALL_CATEGORIES.join(', '))
  .option('--encrypt', 'Encrypt the file(s)')
  .option('-c, --category <id>', 'Category to place the file(s) in')
  .option('--allow-plaintext-secrets', 'Allow adding sensitive files without encryption')
  .option('-u, --update', 'Refresh already-tracked files from disk instead of skipping them')
  .option('--yes', 'Non-interactive: keep local versions when files differ from repo')
  .option('--json', 'Emit machine-readable JSON on stdout')
  .action(wrap(addCommand));

program
  .command('remove')
  .description('Remove a file from the manifest')
  .argument('<file|id>', 'Manifest ID, target-relative path, or file path of the tracked file')
  .option('--no-delete', 'Do not delete the stored file from the repo')
  .action(wrap(removeCommand));

program
  .command('clone')
  .description('Clone an agenv repository and expand it')
  .argument('<url>', 'Git repository URL')
  .option('--dir <path>', 'Destination directory')
  .action(wrap(cloneCommand));

program
  .command('expand [target]')
  .description('Deploy tracked files to your home directory')
  .option('--dry-run', 'Preview changes without applying')
  .option('--force', 'Overwrite existing files even if they have changed')
  .option('--yes', 'Skip confirmation when creating new files')
  .action(wrap(expandCommand as (...args: unknown[]) => Promise<unknown>));

program
  .command('update [target]')
  .description('Pull latest changes and expand')
  .action(wrap(updateCommand));

program
  .command('status [target]')
  .description('Show status of tracked files')
  .option('--json', 'Emit machine-readable JSON on stdout')
  .action(wrap(statusCommand));

program
  .command('list [target]')
  .description('List tracked files')
  .action(wrap(listCommand));

program
  .command('doctor')
  .description('Check prerequisites and manifest validity')
  .action(wrap(doctorCommand));

program
  .command('publish')
  .description('Publish the environment to GitHub')
  .option('--public', 'Create as a public repository (default is private)')
  .option('--name <repoName>', 'Repository name (default: directory name)')
  .option('--remote <url>', 'Git remote URL (if not using gh CLI)')
  .option('--yes', 'Skip interactive prompts and use defaults')
  .option('--dir <path>', 'Directory to publish (default: cwd)')
  .option('--attach', 'Attach to existing repository if it exists')
  .option('--new', 'Create a new repository even if name exists')
  .action(wrap(publishCommand));

program
  .command('envs')
  .description('List registered environments')
  .action(wrap(envsCommand));

program
  .command('bind <name>')
  .description('Register an environment under a friendly name')
  .option('--dir <path>', 'Path to environment (default: cwd)')
  .option('--url <url>', 'Remote git URL')
  .action(wrap(bindCommand));

program
  .command('unbind <name>')
  .description('Remove environment from registry (does NOT delete files)')
  .option('--yes', 'Skip confirmation')
  .action(wrap(unbindCommand));

program
  .command('use [name]')
  .description('Set the active environment (no arg -> show current)')
  .option('--clear', 'Clear active environment')
  .action(wrap(useCommand));

program
  .command('sync [target]')
  .description('Seamless 2-way sync: pull -> expand -> push')
  .option('--push', 'Push local changes after committing')
  .option('--no-push', 'Do not push local changes')
  .option('--no-scan', 'Skip auto-capture of newly discoverable files')
  .option('--yes', 'Skip interactive prompts')
  .action(wrap(syncCommand));

program
  .command('push')
  .description('Commit all changes and push to GitHub')
  .option('-m, --message <msg>', 'Commit message', 'Update agenv environment')
  .action(wrap(pushCommand));

program
  .command('export')
  .description('Bundle env to portable tarball (no git needed)')
  .option('--out <path>', 'Output tarball path')
  .action(wrap(exportCommand));

program
  .command('import')
  .description('Restore an exported environment tarball')
  .argument('<file>', 'Tarball file to import')
  .option('--dir <path>', 'Destination directory')
  .action(wrap(importCommand));

program
  .command('self-update')
  .description('Update the agenv CLI to the latest GitHub release')
  .action(wrap(selfUpdateCommand));

program.parse(process.argv);
