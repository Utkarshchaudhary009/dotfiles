import { runProcess } from './proc';
import { Manifest } from './manifest';
import { CLIError } from './errors';

export async function whichBin(name: string): Promise<string | null> {
  const res = await runProcess([name, '--version']).catch(() => null);
  if (res && res.code === 0) return name;
  return null;
}

export async function ensureGit(): Promise<void> {
  const bin = await whichBin('git');
  if (!bin) {
    throw new CLIError('git is not installed or not in PATH');
  }
}

export async function ensureAge(): Promise<void> {
  const age = await whichBin('age');
  const ageKeygen = await whichBin('age-keygen');
  if (!age || !ageKeygen) {
    throw new CLIError('age or age-keygen is not installed or not in PATH');
  }
}

export async function ensureAgeFor(manifest: Manifest): Promise<void> {
  if (manifest.files.some(f => f.encrypt)) {
    try {
      await ensureAge();
    } catch {
      throw new CLIError('Age is required to decrypt files, but it is not installed.');
    }
  }
}
