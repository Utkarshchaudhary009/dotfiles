import chalk from 'chalk';
import { DeploySummary } from './deploy';

let jsonMode = false;

/** When true, data goes to stdout as one JSON document; prose is silenced. */
export function setJsonMode(v: boolean): void {
  jsonMode = v;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

function emitJsonLine(level: 'info' | 'warn' | 'error', msg: string): void {
  // Progress/errors stay visible to machines on stderr; stdout stays pure JSON.
  console.error(JSON.stringify({ level, message: msg }));
}

export const log = {
  info: (msg: string) => {
    if (jsonMode) return emitJsonLine('info', msg);
    console.log(chalk.blue('ℹ') + ' ' + msg);
  },
  ok: (msg: string) => {
    if (jsonMode) return emitJsonLine('info', msg);
    console.log(chalk.green('✓') + ' ' + msg);
  },
  warn: (msg: string) => {
    if (jsonMode) return emitJsonLine('warn', msg);
    console.log(chalk.yellow('⚠') + ' ' + msg);
  },
  error: (msg: string) => {
    if (jsonMode) return emitJsonLine('error', msg);
    console.log(chalk.red('✗') + ' ' + msg);
  },
  /** Actionable next-step line, e.g. `→ Run: gh auth login`. */
  hint: (msg: string) => {
    if (jsonMode) return emitJsonLine('info', msg);
    console.log(chalk.cyan('→') + ' ' + msg);
  },
  sectionTitle: (t: string) => {
    if (jsonMode) return;
    console.log();
    console.log(chalk.bold.magenta(t));
    console.log(chalk.magenta('─'.repeat(t.length)));
  },
  table: (rows: string[][]) => {
    if (jsonMode) return;
    if (rows.length === 0) return;
    const colWidths = rows[0].map((_, i) => Math.max(...rows.map(row => row[i]?.length || 0)));
    for (const row of rows) {
      const formatted = row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join('   ');
      console.log('  ' + formatted);
    }
  },
  deploySummary: (summary: DeploySummary) => {
    if (jsonMode) return emitJsonLine('info', `Deployed ${summary.deployed}, unchanged ${summary.unchanged}, skipped ${summary.skipped}, failed ${summary.failed}`);
    log.sectionTitle('Expand Summary');
    log.table([
      ['Deployed', String(summary.deployed)],
      ['Unchanged', String(summary.unchanged)],
      ['Skipped', String(summary.skipped)],
      ['Failed', String(summary.failed)],
      ['Encrypted Skipped', String(summary.encryptedSkipped)],
      ['Backups', String(summary.backups)]
    ]);
    if (summary.encryptedSkipped > 0) {
      log.warn(`Skipped ${summary.encryptedSkipped} encrypted files due to missing key. Add the correct key and retry.`);
    }
  },
  /** Print a machine-readable result document on stdout. */
  json: (result: unknown): void => {
    console.log(JSON.stringify(result, null, 2));
  }
};
