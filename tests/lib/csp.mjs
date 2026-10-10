// The page's Content-Security-Policy (build 42). Its own script is allowed by hash, so the policy has to be rewritten
// whenever the script changes: npm run docs does it (npm test too), and a layout test fails while it's stale.
// The PDF libraries are allowed by their pinned folders on jsDelivr, read from PDF_LIBS.
import { createHash } from 'node:crypto';
import { loadCore } from './core.mjs';

export const POLICY_TAG = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/;
export function policyFor(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(script, 'utf8').digest('base64');
  const libs = JSON.parse(loadCore()('JSON.stringify(PDF_LIBS)')).map(([url]) => url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/[^/]+\//)[0]);
  return [
    "default-src 'none'",
    `script-src 'sha256-${hash}' ${libs.join(' ')}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    'img-src blob:',
    'connect-src https://fonts.googleapis.com https://fonts.gstatic.com',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
