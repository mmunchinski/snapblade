// Writes the Content-Security-Policy into index.html's <head> for the script as it stands (see csp.mjs).
// Run after changing the script: npm run docs (npm test runs it first). Until then the page loads blank.
import { readFileSync, writeFileSync } from 'node:fs';
import { POLICY_TAG, policyFor } from './csp.mjs';

const file = new URL('../../index.html', import.meta.url), html = readFileSync(file, 'utf8');
const tag = `<meta http-equiv="Content-Security-Policy" content="${policyFor(html)}">`;
const out = POLICY_TAG.test(html) ? html.replace(POLICY_TAG, tag) : html.replace('<meta charset="utf-8">\n', `<meta charset="utf-8">\n${tag}\n`);
if (out !== html) writeFileSync(file, out);
console.log(out !== html ? 'wrote the policy into index.html' : 'index.html policy is current');
