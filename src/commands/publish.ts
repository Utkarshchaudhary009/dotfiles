import { CLIError } from '../errors';
import * as path from 'node:path';
import { runProcess } from '../proc';
import { requireAgenvRepo } from '../config';
import { log } from '../logger';
import { whichBin } from '../deps';
import * as p from '@clack/prompts';
import { spawn } from 'node:child_process';
import { isWindows } from '../platform';
import { registerEnv, setActive, loadRegistry } from '../registry';

function guardRemoteUrl(url: string) {
  if (url.startsWith('-')) {
    throw new CLIError('Invalid remote URL: cannot start with "-"');
  }
}

export async function publishCommand(opts: { public?: boolean; name?: string; remote?: string; yes?: boolean; dir?: string; attach?: boolean; new?: boolean }) {
  const cwd = opts.dir ? path.resolve(opts.dir) : process.cwd();
  
  await requireAgenvRepo(cwd);

  // Ensure git repo has commits
  const gitLog = await runProcess(['git', 'log', '-1'], { cwd }).catch(() => null);
  if (!gitLog || gitLog.code !== 0) {
    log.info('No commits found. Creating initial commit...');
    await runProcess(['git', 'add', '.'], { cwd });
    await runProcess(['git', 'commit', '-m', 'Initial agenv environment'], { cwd });
  }

  // Rename branch to main
  await runProcess(['git', 'branch', '-M', 'main'], { cwd });

  let repoUrl = '';

  if (opts.remote) {
    guardRemoteUrl(opts.remote);
    log.info(`Adding remote ${opts.remote}...`);
    const remotes = await runProcess(['git', 'remote'], { cwd });
    if (remotes.stdout.includes('origin')) {
      await runProcess(['git', 'remote', 'set-url', 'origin', '--', opts.remote], { cwd });
    } else {
      await runProcess(['git', 'remote', 'add', 'origin', '--', opts.remote], { cwd });
    }
    log.info('Pushing to remote...');
    const pushRes = await runProcess(['git', 'push', '-u', 'origin', 'main'], { cwd });
    if (pushRes.code !== 0) {
      log.error('If authentication failed, ensure you are using a Personal Access Token (PAT) for HTTPS, or use SSH: git remote set-url origin git@github.com:user/repo.git');
      throw new CLIError('Failed to push: ' + pushRes.stderr);
    }
    repoUrl = opts.remote;
  } else {
    const ghBin = await whichBin('gh');
    let ghAuthStatus = -1;
    if (ghBin) {
      const authRes = await runProcess(['gh', 'auth', 'status'], { cwd }).catch(() => null);
      if (authRes) ghAuthStatus = authRes.code;
    }

    if (ghBin && ghAuthStatus === 0) {
      log.info('Using GitHub CLI to publish...');
      let repoName = opts.name || path.basename(cwd);
      const visibility = opts.public ? '--public' : '--private';
      
      const checkRes = await runProcess(['gh', 'repo', 'view', repoName, '--json', 'nameWithOwner,url'], { cwd });
      if (checkRes.code === 0) {
        // Repo exists
        let repoData;
        try {
          repoData = JSON.parse(checkRes.stdout);
        } catch (e: unknown) {
          throw new CLIError('Failed to parse gh output: ' + (e instanceof Error ? e.message : String(e)));
        }
        repoUrl = repoData.url;
        
        if (opts.attach) {
          log.info(`Attaching to existing repository ${repoName}...`);
        } else if (opts.new) {
          throw new CLIError(`Name '${repoName}' is taken — pass --name <other>`);
        } else {
          if (!process.stdout.isTTY || opts.yes) {
            throw new CLIError(`Repository '${repoName}' exists. Use --attach or --new --name <other>.`);
          }
          const choice = await p.select({
            message: `Repository '${repoName}' already exists on GitHub. What would you like to do?`,
            options: [
              { value: 'attach', label: `Attach to existing '${repoName}' and push` },
              { value: 'new', label: 'Create another (new) repository' },
              { value: 'cancel', label: 'Cancel' }
            ]
          });
          if (p.isCancel(choice) || choice === 'cancel') {
            throw new CLIError('Publish cancelled.');
          }
          if (choice === 'new') {
            const newName = await p.text({
              message: 'Enter new repository name:',
              placeholder: `${repoName}-dotfiles`
            });
            if (p.isCancel(newName) || !newName) throw new CLIError('Publish cancelled.');
            repoName = newName as string;
            log.info(`Creating ${opts.public ? 'public' : 'private'} repository '${repoName}'...`);
            const createRes = await runProcess(['gh', 'repo', 'create', repoName, '--source', '.', '--push', '--remote', 'origin', visibility], { cwd });
            if (createRes.code !== 0) {
              throw new CLIError('Failed to create repository: ' + createRes.stderr);
            }
            const urlRes = await runProcess(['gh', 'repo', 'view', repoName, '--json', 'url', '--jq', '.url'], { cwd });
            repoUrl = urlRes.code === 0 ? urlRes.stdout.trim() : `https://github.com/${repoName}`;
          }
        }
        
        // Ensure remote and push if attaching
        if (opts.attach || checkRes.code === 0) {
          guardRemoteUrl(repoUrl);
          const remotes = await runProcess(['git', 'remote'], { cwd });
          if (remotes.stdout.includes('origin')) {
            await runProcess(['git', 'remote', 'set-url', 'origin', '--', repoUrl], { cwd });
          } else {
            await runProcess(['git', 'remote', 'add', 'origin', '--', repoUrl], { cwd });
          }
          log.info('Pushing to remote...');
          const pushRes = await runProcess(['git', 'push', '-u', 'origin', 'main'], { cwd });
          if (pushRes.code !== 0) {
            throw new CLIError('Failed to push: ' + pushRes.stderr);
          }
        }

      } else {
        // Does not exist, create it
        log.info(`Creating ${opts.public ? 'public' : 'private'} repository '${repoName}'...`);
        const createRes = await runProcess(['gh', 'repo', 'create', repoName, '--source', '.', '--push', '--remote', 'origin', visibility], { cwd });
        if (createRes.code !== 0) {
          throw new CLIError('Failed to create repository: ' + createRes.stderr);
        }

        const urlRes = await runProcess(['gh', 'repo', 'view', repoName, '--json', 'url', '--jq', '.url'], { cwd });
        if (urlRes.code === 0) {
          repoUrl = urlRes.stdout.trim();
        } else {
          repoUrl = `https://github.com/${repoName}`;
        }
      }

    } else {
      if (opts.yes) {
        log.error("GitHub CLI not found or not authenticated.");
        log.error("Create an empty repo at https://github.com/new (or any git host), copy its URL, and run:");
        throw new CLIError("  agenv publish --remote <url>");
      }
      
      log.info("GitHub CLI not found or not authenticated.");
      const remoteUrl = await p.text({
        message: 'Create an empty repo at https://github.com/new (or any git host) and paste its URL (or press Enter to open browser):',
        placeholder: 'https://github.com/user/repo.git or git@github.com:user/repo.git',
      });
      
      if (p.isCancel(remoteUrl)) {
        throw new CLIError('Publish cancelled.');
      }

      if (!remoteUrl) {
        log.info('Opening browser to create a new repository...');
        const startCmd = isWindows() ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
        try {
          if (isWindows()) {
             spawn('cmd.exe', ['/c', 'start', 'https://github.com/new'], { detached: true, stdio: 'ignore' }).unref();
          } else {
             spawn(startCmd, ['https://github.com/new'], { detached: true, stdio: 'ignore' }).unref();
          }
        } catch (e) {
          log.warn('Could not open browser automatically. Please go to https://github.com/new');
        }
        
        const finalUrl = await p.text({
          message: 'Paste the new repository URL here:',
        });
        if (p.isCancel(finalUrl) || !finalUrl) {
          throw new CLIError('Publish cancelled.');
        }
        repoUrl = finalUrl.toString().trim();
      } else {
        repoUrl = remoteUrl.toString().trim();
      }

      if (!repoUrl.includes('://') && !repoUrl.includes('@')) {
        throw new CLIError("Invalid git URL provided.");
      }

      log.info(`Adding remote and pushing...`);
      guardRemoteUrl(repoUrl);
      const remotes = await runProcess(['git', 'remote'], { cwd });
      if (remotes.stdout.includes('origin')) {
        await runProcess(['git', 'remote', 'set-url', 'origin', '--', repoUrl], { cwd });
      } else {
        await runProcess(['git', 'remote', 'add', 'origin', '--', repoUrl], { cwd });
      }
      
      const pushRes = await runProcess(['git', 'push', '-u', 'origin', 'main'], { cwd });
      if (pushRes.code !== 0) {
        log.error('If authentication failed, ensure you are using a Personal Access Token (PAT) for HTTPS, or use SSH: git remote set-url origin git@github.com:user/repo.git');
        throw new CLIError('Failed to push: ' + pushRes.stderr);
      }
    }
  }

  // Auto-bind
  if (repoUrl) {
    const bindName = opts.name || path.basename(cwd);
    await registerEnv(bindName, { path: cwd, url: repoUrl });
    const reg = await loadRegistry();
    if (!reg.active) {
      await setActive(bindName);
    }
  }

  const lines = [
    'Environment published!',
    `URL: ${repoUrl}`,
    'Copy it and run on any machine:',
    `  agenv clone ${repoUrl}`
  ];
  const maxLen = Math.max(...lines.map(l => l.length));
  console.log('\u250C\u2500' + '\u2500'.repeat(maxLen + 2) + '\u2510');
  for (const line of lines) {
    console.log('\u2502 ' + line.padEnd(maxLen) + ' \u2502');
  }
  console.log('\u2514\u2500' + '\u2500'.repeat(maxLen + 2) + '\u2518');
}