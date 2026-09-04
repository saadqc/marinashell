const fs = require('fs');

const target = process.argv[2];
if (!target) {
  throw new Error('Usage: node scripts/trim-trailing-whitespace.js <file>');
}

const source = fs.readFileSync(target, 'utf8');
fs.writeFileSync(target, source.replace(/[ \t]+$/gm, ''), 'utf8');
