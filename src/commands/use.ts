import { CLIError } from '../errors';
import { loadRegistry, setActive, saveRegistry, withRegistryLock } from '../registry';
import * as clack from '@clack/prompts';
import { pathExists } from '../fs';

export async function useCommand(name?: string, options?: { clear?: boolean }) {
  const r = await loadRegistry();

  if (options?.clear) {
    await withRegistryLock(async () => {
      const registry = await loadRegistry();
      registry.active = null;
      await saveRegistry(registry);
    });
    clack.log.success('Cleared active environment.');
    return;
  }

  if (!name) {
    if (!r.active) {
      clack.log.info("No active environment. Use 'agenv use <name>' to set one.");
    } else {
      clack.log.info(`Active environment: ${r.active}`);
    }
    return;
  }

  if (!r.envs[name]) {
    throw new CLIError(`Environment '${name}' is not registered.`);
  }

  const envPath = r.envs[name].path;
  if (!(await pathExists(envPath))) {
    clack.log.warn(`Path for environment '${name}' (${envPath}) does not exist. Setting active anyway.`);
  }

  await setActive(name);
  clack.log.success(`\u2713 Set active environment to '${name}'`);
}
