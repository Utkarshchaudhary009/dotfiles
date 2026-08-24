import { loadRegistry } from '../registry';
import * as clack from '@clack/prompts';
import { pathExists } from '../fs';
import { isAgenvRepo } from '../config';
import chalk from 'chalk';

export async function envsCommand() {
  const r = await loadRegistry();
  const names = Object.keys(r.envs);
  
  if (names.length === 0) {
    clack.log.info("No environments registered yet \u2014 run 'agenv bind <name>' or 'agenv clone <url>'.");
    return;
  }
  
  const rows: string[][] = [];
  rows.push(['NAME', 'PATH', 'URL', 'STATUS']);
  
  for (const name of names) {
    const env = r.envs[name];
    let status = 'missing';
    
    if (await pathExists(env.path)) {
      if (await isAgenvRepo(env.path)) {
        status = 'ok';
      } else {
        status = 'invalid';
      }
    }
    
    const displayName = r.active === name ? chalk.green(`* ${name}`) : `  ${name}`;
    rows.push([displayName, env.path, env.url || '-', status]);
  }
  
  // Basic table formatting
  const colWidths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].replace(/\x1b\[[0-9;]*m/g, '').length)));
  
  for (const row of rows) {
    const formatted = row.map((c, i) => {
      const plainLen = c.replace(/\x1b\[[0-9;]*m/g, '').length;
      return c + ' '.repeat(colWidths[i] - plainLen);
    }).join(' | ');
    // eslint-disable-next-line no-console
    console.log(formatted);
  }
}
