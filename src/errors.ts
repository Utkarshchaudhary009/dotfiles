import { expandHome } from './platform';

export class CLIError extends Error {
  /** Actionable next-step shown to the user after the message. */
  hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'CLIError';
    this.hint = hint;
  }
}

export const DEFAULT_KEY_PATH = '~/.config/agenv/key.txt';

/** Catalog of actionable fixes for known failure modes. */
export const HINTS = {
  keyMissing: (keyPath: string = DEFAULT_KEY_PATH) =>
    `Run: age-keygen -o ${expandHome(keyPath)}  — or securely copy your existing key.txt from another machine`,
  ageMissing:
    'Install age (https://github.com/FiloSottile/age#installation), e.g. `scoop install age`',
  ghAuth: 'Run: gh auth login',
  notRegistered: 'Run: agenv bind <name> --url <url>, or agenv clone <url>',
  notAnEnvRepo: 'Run: agenv init, or agenv clone <url> first',
};

/**
 * Map any thrown value to a message plus an optional actionable hint, so the
 * CLI never surfaces a bare ENOENT without telling the user what to do next.
 * Explicit CLIError hints win; unhinted CLIErrors still get classified below.
 */
export function describeError(e: unknown): { message: string; hint?: string } {
  if (e instanceof CLIError && e.hint) {
    return { message: e.message, hint: e.hint };
  }
  const message = e instanceof Error ? e.message : String(e);

  // Only treat key.txt ENOENT as the agenv key failure when the path looks like
  // the agenv key location (~/.config/agenv/key.txt); an unrelated missing file
  // that merely happens to be named key.txt stays generic.
  // Separators may appear escaped/doubled in raw error strings, hence [ /\\ ]+.
  if (/ENOENT[\s\S]*[/\\]+agenv[/\\]+key\.txt/i.test(message) || /ENOENT[\s\S]*[/\\]+\.config[/\\]+key\.txt/i.test(message)) {
    return {
      message: `Encryption key not found (${expandHome(DEFAULT_KEY_PATH)})`,
      hint: HINTS.keyMissing(),
    };
  }
  if (/age or age-keygen|age.*not installed/i.test(message)) {
    return { message, hint: HINTS.ageMissing };
  }
  if (/gh[^\n]*(auth|4\d\d)|Bad credentials/i.test(message)) {
    return { message, hint: HINTS.ghAuth };
  }
  if (/not registered/i.test(message)) {
    return { message, hint: HINTS.notRegistered };
  }
  if (/ENOENT/i.test(message)) {
    return { message, hint: 'Check the path exists, then re-run with --help for usage.' };
  }
  return { message };
}
