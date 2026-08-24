import { CLIError } from '../errors';
import { unregisterEnv, loadRegistry } from '../registry';
import * as clack from '@clack/prompts';

export async function unbindCommand(name: string, options: { yes?: boolean }) {
  const r = await loadRegistry();
  if (!r.envs[name]) {
    throw new CLIError(`Environment '${name}' is not registered.`);
  }

  if (process.stdout.isTTY && !options.yes) {
    const confirm = await clack.confirm({
      message: `Are you sure you want to unbind '${name}'? (This does NOT delete files)`,
      initialValue: true,
    });
    if (clack.isCancel(confirm) || !confirm) {
      clack.log.info('Cancelled.');
      return;
    }
  }

  await unregisterEnv(name);
  clack.log.success(`\u2713 Unbound environment '${name}'.`);
}
