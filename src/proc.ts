import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runProcess(cmd: string[], opts: { cwd?: string, env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  if (cmd.length === 0) throw new Error('Empty command');
  try {
    const { stdout, stderr } = await execFileAsync(cmd[0], cmd.slice(1), { 
      cwd: opts.cwd, 
      env: opts.env,
      shell: false,
      maxBuffer: 1024 * 1024 * 10
    });
    return { code: 0, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (err: any) {
    const code = typeof err?.code === 'number' ? err.code : 1;
    let stderr = err.stderr?.toString() ?? err.message;
    if (typeof err?.code === 'string') {
      stderr = `[${err.code}] ${stderr}`;
    }
    return { 
      code, 
      stdout: err.stdout?.toString() ?? '', 
      stderr 
    };
  }
}
