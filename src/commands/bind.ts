import { CLIError } from '../errors';
import { registerEnv, setActive, loadRegistry } from '../registry';
import { isAgenvRepo } from '../config';
import { runProcess } from '../proc';
import * as path from 'node:path';
import * as clack from '@clack/prompts';

export interface BindOptions {
  dir?: string;
  url?: string;
}

export async function bindCommand(name: string, options: BindOptions) {
  const dir = path.resolve(options.dir || process.cwd());
  
  if (!(await isAgenvRepo(dir))) {
    throw new CLIError(`Not an agenv environment \u2014 init first in ${dir}`);
  }

  let url = options.url || null;
  if (!url) {
    try {
      const res = await runProcess(['git', 'remote', 'get-url', 'origin'], { cwd: dir });
      if (res.code === 0) {
        url = res.stdout.trim();
      }
    } catch {
      // ignore
    }
  }

  await registerEnv(name, { path: dir, url });
  
  const r = await loadRegistry();
  if (!r.active) {
    await setActive(name);
  }
  
  clack.log.success(`\u2713 Bound environment '${name}' to ${dir}`);
}
