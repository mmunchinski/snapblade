// Renders page 1 of a PDF to a PNG with pdf.js in headless Chromium, and prints its size and text.
// Used to eyeball PDF exports. Usage: node scripts/pdf-to-png.mjs <in.pdf> <out.png>   (needs internet for pdf.js)
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: node scripts/pdf-to-png.mjs <in.pdf> <out.png>'); process.exit(1); }
const pdf = readFileSync(input).toString('base64');
const page = `<!doctype html><body style="margin:0;background:#888"><canvas id="c"></canvas><script type="module">
import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob('${pdf}'), c => c.charCodeAt(0)) }).promise;
const p = await doc.getPage(1), vp = p.getViewport({ scale: 2 }), c = document.getElementById('c');
c.width = vp.width; c.height = vp.height;
await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
window.info = { pages: doc.numPages, widthPt: p.view[2], heightPt: p.view[3], text: (await p.getTextContent()).items.map(i => i.str).filter(Boolean).join(' | ') };
</script>`;
const server = createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(page); }).listen(0);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1800, height: 1400 } });
await tab.goto(`http://localhost:${server.address().port}/`);
await tab.waitForFunction(() => window.info, null, { timeout: 30000 });
console.log(JSON.stringify(await tab.evaluate(() => window.info), null, 1));
await (await tab.$('#c')).screenshot({ path: output });
await browser.close(); server.close();
