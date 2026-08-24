import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(process.cwd(), 'dist', 'agenv.js');

try {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.startsWith('#!/usr/bin/env bun')) {
    content = content.replace('#!/usr/bin/env bun', '#!/usr/bin/env node');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed shebang to node in dist/agenv.js');
  } else if (!content.startsWith('#!/usr/bin/env node')) {
    content = '#!/usr/bin/env node\n' + content;
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Added node shebang to dist/agenv.js');
  }
} catch (err) {
  console.error('Error fixing shebang:', err.message);
  process.exit(1);
}
