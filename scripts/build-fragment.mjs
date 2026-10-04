// Builds a body-only fragment of index.html (no doctype/html/head/body wrapper) for hosts that
// supply their own page skeleton, such as the claude.ai artifact preview.
// Usage: node scripts/build-fragment.mjs <output-file>
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const head = html.match(/<head>([\s\S]*)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const out = process.argv[2];
if (!out) { console.error('usage: node scripts/build-fragment.mjs <output-file>'); process.exit(1); }
writeFileSync(out, head.trim() + '\n' + body.trim() + '\n');
console.log(`wrote ${out}`);
