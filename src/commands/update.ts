import { CLIError } from '../errors';
import { gitPull, gitRemote } from '../git';
import { log } from '../logger';
import { expandCommand } from './expand';
import { requireAgenvRepo } from '../config';
import { resolveTarget } from '../resolve';

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '***';
    }
    return u.toString();
  } catch {
    return url.replace(/:\/\/[^@]+@/, '://***:***@');
  }
}

export async function updateCommand(target?: string) {
  const resolved = await resolveTarget(target);
  const found = await requireAgenvRepo(resolved.path);

  const remote = await gitRemote(found.rootDir);
  if (!remote) {
    log.info('No git remote configured, skipping pull.');
  } else {
    log.info(`Pulling from ${redactUrl(remote)}...`);
    try {
      await gitPull(found.rootDir);
      log.ok('Pulled latest changes.');
    } catch (e: any) {
      throw new CLIError(`Git pull failed: ${e.message}`);
    }
  }

  await expandCommand(resolved.path, {});
}
