import chalk from 'chalk';
import { DeploySummary } from './deploy';

export const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ') + ' ' + msg),
  ok: (msg: string) => console.log(chalk.green('✓') + ' ' + msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠') + ' ' + msg),
  error: (msg: string) => console.log(chalk.red('✗') + ' ' + msg),
  sectionTitle: (t: string) => {
    console.log();
    console.log(chalk.bold.magenta(t));
    console.log(chalk.magenta('─'.repeat(t.length)));
  },
  table: (rows: string[][]) => {
    if (rows.length === 0) return;
    const colWidths = rows[0].map((_, i) => Math.max(...rows.map(row => row[i]?.length || 0)));
    for (const row of rows) {
      const formatted = row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join('   ');
      console.log('  ' + formatted);
    }
  },
  deploySummary: (summary: DeploySummary) => {
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
  }
};
