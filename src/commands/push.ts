import { CLIError } from '../errors';
import { runProcess } from '../proc';
import { gitPushSetUpstream } from '../git';
import { requireAgenvRepo } from '../config';
import { log } from '../logger';
import { pathExists } from '../fs';
import * as path from 'node:path';

export async function pushCommand(opts: { message?: string }) {
  const cwd = process.cwd();
  
  await requireAgenvRepo(cwd);

  // Check remote
  const remotes = await runProcess(['git', 'remote'], { cwd });
  if (remotes.code !== 0 || !remotes.stdout.trim()) {
    throw new CLIError("No git remote. Run 'agenv publish' first.");
  }

  log.info('Committing changes...');
  await runProcess(['git', 'add', '-u'], { cwd });
  if (await pathExists(path.join(cwd, 'agenv.json'))) {
    await runProcess(['git', 'add', 'agenv.json'], { cwd });
  }
  if (await pathExists(path.join(cwd, 'files'))) {
    await runProcess(['git', 'add', 'files'], { cwd });
  }
  
  const commitRes = await runProcess(['git', 'commit', '-m', opts.message ?? 'Update agenv environment'], { cwd });
  
  if (commitRes.code !== 0 && !commitRes.stdout.includes('nothing to commit') && !commitRes.stderr.includes('nothing to commit')) {
    throw new CLIError('Failed to commit: ' + commitRes.stdout + commitRes.stderr);
  }

  if (commitRes.stdout.includes('nothing to commit') || commitRes.stderr.includes('nothing to commit')) {
    log.info('No changes to commit.');
  }

  log.info('Pushing to remote...');
  await gitPushSetUpstream(cwd);

  log.ok('Successfully pushed environment.');
}
