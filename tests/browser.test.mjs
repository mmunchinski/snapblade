// Interaction tests in a real (headless) Chromium: clicks, keyboard, selection, colors.
// Run: npm run test:browser   (first time: npx playwright install chromium)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

let server, browser, base;
before(async () => {
  // Serve over http so localStorage behaves as it does for real users.
  server = createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(readFileSync(new URL('../index.html', import.meta.url))); });
  await new Promise(res => server.listen(0, res));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

// A fresh page with the sample diagram and helpers for driving it.
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, colorScheme: opts.scheme || 'light', acceptDownloads: true, permissions: opts.permissions || [] });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(seed => { localStorage.clear(); if (seed) localStorage.setItem('snapblade-playground-v1', seed); }, opts.seed || null);
  await page.reload(); await page.waitForTimeout(300);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const h = {
    page, errors, ev,
    toScreen: (x, y) => ev(([x, y]) => { const r = svg.getBoundingClientRect(); return { x: r.left + view.x + x * view.k, y: r.top + view.y + y * view.k }; }, [x, y]),
    at: id => ev(id => { const n = byId(id), r = svg.getBoundingClientRect(); return { x: r.left + view.x + (n.x + n.w / 2) * view.k, y: r.top + view.y + (n.y + n.h / 2) * view.k }; }, id),
    labelAt: id => ev(id => { const l = lastGeom.labels[id], r = svg.getBoundingClientRect(); return { x: r.left + view.x + (l.x + l.w / 2) * view.k, y: r.top + view.y + (l.y + l.h / 2) * view.k }; }, id),
    // A point on the canvas well away from any shape or connector.
    emptySpot: () => ev(() => { const r = svg.getBoundingClientRect();
      for (let y = r.top + 60; y < r.bottom - 60; y += 20) for (let x = r.left + 40; x < r.right - 40; x += 20) {
        const w = { x: (x - r.left - view.x) / view.k, y: (y - r.top - view.y) / view.k };
        if (!hitNode(w, 30 / view.k) && !hitEdge(w)) return { x, y }; } }),
    click: async id => { const p = await h.at(id); await page.mouse.click(p.x, p.y); },
    dblclick: async id => { const p = await h.at(id); await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(50); },
    drag: async (a, b, opt) => { await page.mouse.move(a.x, a.y); await page.mouse.down(opt); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(opt); },
    // Selection box around the three API boxes, starting on empty canvas left of the App tier.
    selectApis: async () => h.drag(await h.toScreen(488, 125), await h.toScreen(735, 590)),
    button: text => page.click(`#panel button:text-is("${text}")`),
    // Deselect and move the pointer away, so selection/hover highlights don't affect computed colors.
    clear: async () => { await page.keyboard.press('Escape'); await page.mouse.move(1050, 950); await page.waitForTimeout(30); },
    style: id => ev(id => byId(id).style || {}, id),
    css: (id, part, prop) => ev(([id, part, prop]) => getComputedStyle(document.querySelector(`[data-id="${id}"] ${part}`))[prop], [id, part, prop]),
    editor: () => ev(() => ({ open: !editor.hidden, focused: document.activeElement === editor, box: editor.dataset.id || null, edge: editor.dataset.edge || null })),
  };
  return h;
}
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test('double-click renames boxes and connectors; typing and F2 also edit', async () => {
  const h = await open();
  await h.dblclick('lb');
  assert.deepEqual(await h.editor(), { open: true, focused: true, box: 'lb', edge: null });
  await h.page.keyboard.press('Control+A'); await h.page.keyboard.type('Front door'); await h.page.keyboard.press('Enter');
  assert.equal(await h.ev(() => byId('lb').label), 'Front door');

  const lp = await h.labelAt('e3'); await h.page.mouse.dblclick(lp.x, lp.y); await h.page.waitForTimeout(50);
  assert.equal((await h.editor()).edge, 'e3');
  await h.page.keyboard.press('Control+A'); await h.page.keyboard.type('/orders v2'); await h.page.keyboard.press('Enter');
  assert.equal(await h.ev(() => S.edges.find(e => e.id === 'e3').label), '/orders v2');

  await h.click('inv'); await h.page.keyboard.type('Stock API'); await h.page.keyboard.press('Enter');
  assert.equal(await h.ev(() => byId('inv').label), 'Stock API');
  await h.click('inv'); await h.page.keyboard.press('F2');
  assert.equal((await h.editor()).box, 'inv');
  assert.deepEqual(h.errors, []);
});

test('double-click on empty canvas adds a box; two slow clicks do not count as a double-click', async () => {
  const h = await open();
  const empty = await h.emptySpot(), n0 = await h.ev(() => S.nodes.length);
  await h.page.mouse.dblclick(empty.x, empty.y); await h.page.waitForTimeout(50);
  assert.equal(await h.ev(() => S.nodes.length), n0 + 1);
  assert.ok((await h.editor()).open);
  await h.page.keyboard.press('Escape'); await h.clear();
  const p = await h.at('lb');
  await h.page.mouse.click(p.x, p.y); await h.page.waitForTimeout(600); await h.page.mouse.click(p.x, p.y);
  assert.equal((await h.editor()).open, false);
});

test('selection box, shift/ctrl-click and make same size', async () => {
  const h = await open();
  await h.ev(() => { Object.assign(byId('inv'), { w: 200, h: 80 }); Object.assign(byId('pay'), { w: 180, h: 100 }); refresh(true, false); });
  await h.selectApis();
  assert.deepEqual(await h.ev(() => multi), ['orders', 'inv', 'pay']);
  const centers = () => h.ev(() => ['orders', 'inv', 'pay'].map(id => { const n = byId(id); return [n.w, n.h, n.x + n.w / 2, n.y + n.h / 2]; }));
  const before = await centers();
  await h.button('Same size');
  const after = await centers();
  assert.deepEqual(after.map(c => c.slice(0, 2)), [[160, 60], [160, 60], [160, 60]], 'matches the first selected');
  assert.deepEqual(after.map(c => c.slice(2)), before.map(c => c.slice(2)), 'centers are kept');
  await h.page.keyboard.press('Control+z');
  await h.button('Largest'); await h.button('Same width');
  assert.deepEqual(await h.ev(() => ['orders', 'inv', 'pay'].map(id => byId(id).w)), [200, 200, 200]);
  await h.page.keyboard.press('Control+z');

  await h.click('inv');                      // narrows the selection to Inventory API
  await h.page.keyboard.down('Shift'); await h.click('pay'); await h.page.keyboard.up('Shift');
  assert.deepEqual(await h.ev(() => multi), ['inv', 'pay']);
  await h.page.keyboard.down('Control'); await h.click('pay'); await h.page.keyboard.up('Control');
  assert.deepEqual(await h.ev(() => [multi.length, sel.id]), [0, 'inv']);

  const hdr = await h.toScreen(900, 100); await h.page.mouse.click(hdr.x, hdr.y);
  await h.button('Same size');
  assert.deepEqual(await h.ev(() => ['odb', 'cache', 'idb'].map(id => [byId(id).w, byId(id).h])), [[160, 90], [160, 90], [160, 90]]);
  assert.deepEqual(h.errors, []);
});

test('copy, paste, duplicate, cut, group move and delete', async () => {
  const h = await open();
  await h.click('orders');
  const o = await h.ev(() => [byId('orders').x, byId('orders').y]);
  await h.page.keyboard.press('Control+c'); await h.page.keyboard.press('Control+v'); await h.page.keyboard.press('Control+v');
  assert.deepEqual(await h.ev(() => S.nodes.slice(-2).map(n => [n.x, n.y, n.parent])), [[o[0] + 20, o[1] + 20, 'app'], [o[0] + 40, o[1] + 40, 'app']]);
  const n1 = await h.ev(() => S.nodes.length);
  await h.page.keyboard.press('Control+d');
  assert.equal(await h.ev(() => S.nodes.length), n1 + 1);

  const hdr = await h.toScreen(300, 165); await h.page.mouse.click(hdr.x, hdr.y);   // Edge container
  const [n2, e2] = await h.ev(() => [S.nodes.length, S.edges.length]);
  await h.page.keyboard.press('Control+c'); await h.page.keyboard.press('Control+v');
  assert.deepEqual(await h.ev(() => [S.nodes.length, S.edges.length]), [n2 + 3, e2 + 1], 'container, its two boxes and the connector between them');
  await h.page.keyboard.press('Control+z');

  await h.click('gw'); const g = await h.ev(() => [byId('gw').x, byId('gw').y]);
  await h.page.keyboard.press('Control+x');
  assert.equal(await h.ev(() => !!byId('gw')), false);
  await h.page.keyboard.press('Control+v');
  assert.deepEqual(await h.ev(() => { const n = S.nodes[S.nodes.length - 1]; return [n.x, n.y]; }), g, 'paste after cut lands in place');

  await h.page.keyboard.press('Escape'); await h.selectApis();
  const ids = await h.ev(() => multi.slice()), y0 = await h.ev(ids => ids.map(id => byId(id).y), ids);
  const p = await h.at(ids[0]); await h.drag(p, { x: p.x, y: p.y + 40 });
  const y1 = await h.ev(ids => ids.map(id => byId(id).y), ids);
  assert.ok(y1.every((y, i) => y > y0[i]), 'every selected shape moved down');
  const n3 = await h.ev(() => S.nodes.length);
  await h.page.keyboard.press('Delete');
  assert.equal(await h.ev(() => S.nodes.length), n3 - ids.length);
  assert.deepEqual(h.errors, []);
});

test('panning: right-drag, middle-drag and Space+drag; no browser menu on the canvas', async () => {
  const h = await open();
  await h.ev(() => { window.__menus = 0; window.addEventListener('contextmenu', e => { if (!e.defaultPrevented) window.__menus++; }); });
  const vx = () => h.ev(() => Math.round(view.x));
  let v = await vx();
  await h.drag({ x: 60, y: 500 }, { x: 180, y: 500 }, { button: 'right' }); assert.equal(await vx(), v + 120); v += 120;
  const lb = await h.at('lb'), bx = await h.ev(() => byId('lb').x);
  await h.drag(lb, { x: lb.x + 50, y: lb.y }, { button: 'right' }); assert.equal(await vx(), v + 50); v += 50;
  assert.equal(await h.ev(() => byId('lb').x), bx, 'right-drag on a box pans instead of moving it');
  await h.drag({ x: 60, y: 500 }, { x: 160, y: 500 }, { button: 'middle' }); assert.equal(await vx(), v + 100); v += 100;
  await h.page.keyboard.down('Space'); await h.drag({ x: 60, y: 500 }, { x: 110, y: 500 }); await h.page.keyboard.up('Space');
  assert.equal(await vx(), v + 50);
  assert.equal(await h.ev(() => window.__menus), 0);
});

test('colors: presets, hex, RGB, tint, custom and no fill, patterns, connectors, undo', async () => {
  const h = await open();
  await h.click('inv'); await h.page.click('#panel .sw[title="Teal"]'); await h.clear();
  assert.deepEqual(await h.style('inv'), { line: 'teal' });
  assert.equal(await h.css('inv', '.b-body', 'stroke'), rgb('#1d8585'));

  await h.click('inv'); await h.page.fill('#f-line-hex', '#ff0000');
  assert.deepEqual(await h.ev(() => ['r', 'g', 'b'].map(c => document.getElementById('f-line-' + c).value)), ['255', '0', '0']);
  await h.page.fill('#f-line-g', '128');
  assert.equal(await h.page.inputValue('#f-line-hex'), '#FF8000');

  await h.page.locator('#f-tint').fill('40');
  assert.equal((await h.style('inv')).tint, 40);
  await h.button('Custom'); await h.page.fill('#f-fill-hex', '#00AA44'); await h.clear();
  assert.equal(await h.css('inv', '.b-body', 'fill'), rgb('#00aa44'));
  await h.click('inv'); await h.button('None'); await h.clear();
  assert.equal(await h.css('inv', '.b-body', 'fill'), 'rgba(0, 0, 0, 0)');
  await h.click('inv');
  assert.equal(await h.ev(() => sel.id), 'inv', 'a see-through box can still be selected');
  await h.button('Dotted'); await h.page.keyboard.press('Control+z'); await h.clear();
  assert.equal(await h.css('inv', '.b-body', 'strokeDasharray'), 'none', 'undo reverts the pattern');

  const lp = await h.labelAt('e3'); await h.page.mouse.click(lp.x, lp.y);
  await h.page.click('#panel .sw[title="Red"]'); await h.clear();
  const line = await h.css('e3', '.line', 'stroke');
  const head = await h.ev(() => { const id = document.querySelector('[data-id="e3"] .line').getAttribute('marker-end').match(/#([\w-]+)/)[1]; return getComputedStyle(document.querySelector(`#${id} path`)).fill; });
  assert.equal(line, rgb('#c2463b')); assert.equal(head, line, 'arrowhead matches its connector');

  await h.selectApis(); await h.page.click('#panel .sw[title="Violet"]');
  assert.deepEqual(await h.ev(() => ['orders', 'inv', 'pay'].map(id => byId(id).style.line)), ['violet', 'violet', 'violet']);
  assert.deepEqual(h.errors, []);
});

test('match colors, container color and copy/paste style', async () => {
  const h = await open();
  await h.ev(() => { byId('orders').style = { line: 'red', dash: 'dashed', tint: 30 }; byId('inv').style = { line: 'blue' }; byId('pay').style = {}; refresh(true, false); });
  await h.selectApis(); await h.button('Same line');
  assert.deepEqual([await h.style('inv'), await h.style('pay')], [{ line: 'red', dash: 'dashed' }, { line: 'red', dash: 'dashed' }]);
  await h.page.keyboard.press('Control+z');

  await h.selectApis(); await h.button('Same fill'); await h.clear();
  const norm = c => c.startsWith('color(') ? rgb('#' + c.match(/[\d.]+/g).slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')) : c;
  const ref = norm(await h.css('orders', '.b-body', 'fill'));
  assert.equal(norm(await h.css('inv', '.b-body', 'fill')), ref);
  assert.equal(norm(await h.css('pay', '.b-body', 'fill')), ref);
  assert.equal((await h.style('inv')).line, 'blue', 'Same fill leaves the line alone');
  await h.page.keyboard.press('Control+z');

  await h.selectApis(); await h.button('Same colors');
  const all = await h.ev(() => ['orders', 'inv', 'pay'].map(id => JSON.stringify(byId(id).style)));
  assert.ok(all.every(s => s === all[0]));

  await h.ev(() => { byId('data').style = { line: 'teal' }; refresh(true, false); });
  const hdr = await h.toScreen(900, 100); await h.page.mouse.click(hdr.x, hdr.y);
  await h.button("Use container's color");
  assert.deepEqual(await h.ev(() => ['odb', 'cache', 'idb'].map(id => byId(id).style.line)), ['teal', 'teal', 'teal']);

  await h.click('users'); await h.page.keyboard.press('Control+Shift+C');
  await h.click('gw'); await h.page.keyboard.press('Control+Shift+V');
  assert.deepEqual(await h.style('gw'), await h.style('users'));
  const lp = await h.labelAt('e4'); await h.page.mouse.click(lp.x, lp.y); await h.button('Paste style');
  assert.equal(await h.ev(() => S.edges.find(e => e.id === 'e4').style.line), 'blue');
  assert.deepEqual(h.errors, []);
});

test('saved diagrams load, including old formats (Diogramo key, named colors) in both themes', async () => {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ colorScheme: scheme });
    await page.goto(base);
    await page.evaluate(() => {
      const s = sample(); s.nodes.forEach(n => delete n.style);
      Object.assign(s.nodes.find(n => n.id === 'users'), { color: 'blue', label: 'Saved' });
      s.nodes.find(n => n.id === 'gw').color = 'ghost';
      localStorage.clear(); localStorage.setItem('diogramo-playground-v1', JSON.stringify(s));
    });
    await page.reload(); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ label: byId('users').label, users: byId('users').style, gw: byId('gw').style, stroke: getComputedStyle(document.querySelector('[data-id="users"] .b-body')).stroke }));
    assert.equal(r.label, 'Saved');
    assert.deepEqual(r.users, { line: 'blue', fill: 'pair' });
    assert.deepEqual(r.gw, { dash: 'dashed', fill: 'none' });
    assert.equal(r.stroke, rgb(scheme === 'light' ? '#3a63c4' : '#7f9ef0'));
    await page.close();
  }
});

// ---------- files ----------
// Firefox/Safari path: Save downloads the file, Open uses a file chooser.
const noFilePickers = () => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; };

test('save downloads a .snapblade file; reopening restores it; unsaved changes are protected', async () => {
  const h = await open({ init: noFilePickers }), { page } = h;
  const tmp = await import('node:os').then(os => os.tmpdir());
  await page.fill('#docName', 'Order platform'); await page.keyboard.press('Enter');
  await h.dblclick('lb'); await page.keyboard.press('Control+A'); await page.keyboard.type('Front door'); await page.keyboard.press('Enter');
  assert.equal(await h.ev(() => doc.dirty), true);
  assert.equal(await page.isVisible('#dirtyDot'), true, 'unsaved dot shows');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  assert.equal(dl.suggestedFilename(), 'Order platform.snapblade');
  const file = `${tmp}/snapblade-test.snapblade`; await dl.saveAs(file);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.format, 'snapblade'); assert.equal(saved.version, 1);
  assert.equal(saved.diagram.nodes.find(n => n.id === 'lb').label, 'Front door');
  assert.equal(await h.ev(() => doc.dirty), false, 'saving clears the unsaved state');

  await h.click('gw'); await page.keyboard.press('Delete');
  await page.click('#fileBtn'); await page.click('#fileMenu [data-file="open"]');
  assert.ok(await page.isVisible('.modal h2:has-text("Save changes")'), 'asks before replacing unsaved work');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.modal button:text-is("Don\'t save")')]);
  await chooser.setFiles(file); await page.waitForTimeout(150);
  assert.deepEqual(await h.ev(() => [S.nodes.length, !!byId('gw'), byId('lb').label, doc.name, doc.dirty, undoStack.length]), [13, true, 'Front door', 'snapblade-test', false, 0]);
  assert.deepEqual(h.errors, []);
});

test('a file that is not a diagram is rejected without touching the current one', async () => {
  const h = await open({ init: noFilePickers }), { page } = h;
  const tmp = await import('node:os').then(os => os.tmpdir()), bad = `${tmp}/not-a-diagram.snapblade`;
  (await import('node:fs')).writeFileSync(bad, '{"hello": 1}');
  await page.click('#fileBtn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#fileMenu [data-file="open"]')]);
  await chooser.setFiles(bad); await page.waitForTimeout(100);
  assert.match(await page.textContent('#toast'), /isn't a Snapblade diagram/);
  assert.equal(await h.ev(() => S.nodes.length), 13);
});

test('a hostile file cannot run script: unexpected values are dropped or reset', { timeout: 60000 }, async () => {
  const pwn = '"><img src=x onerror="window.__pwn=1">';
  const node = o => ({ id: 'a', kind: 'box', label: 'A', x: 0, y: 0, w: 120, h: 60, parent: null, ...o });
  const diagram = {
    nodes: [
      node({ id: 'bad' + pwn }),
      node({ id: 'a', kind: 'box' + pwn, x: '0' + pwn, style: { line: 'x)' + pwn, fill: pwn, dash: 'toString', tint: pwn } }),
      node({ id: 'b', x: 300, style: { line: 'green', dash: 'dashed' } }),
      { id: 'g', kind: 'group', label: 'G', x: 0, y: 200, w: 200, h: 100, parent: 'g2', layout: pwn, pad: pwn, gap: 30, align: pwn },
      { id: 'g2', kind: 'group', label: 'G2', x: 0, y: 200, w: 200, h: 100, parent: 'g', layout: 'free' },
    ],
    edges: [
      { id: 'e1', from: { node: 'a', side: pwn }, to: { node: 'b', side: 'left' }, arrow: pwn, labelPos: pwn, label: 'ok', style: { line: pwn },
        fixed: { from: { side: pwn, frac: 0.5 }, to: { side: 'left', frac: 0.5 } } },
      { id: 'e2' + pwn, from: { node: 'a', side: 'auto' }, to: { node: 'b', side: 'auto' }, arrow: 'end' },
    ],
    settings: { mode: pwn, grid: pwn, radius: pwn, routing: pwn, labelPos: pwn },
    title: { show: true, title: 'T', pos: pwn }, legend: { show: true, pos: pwn, labels: { k: { x: pwn } }, hidden: [{}] },
  };
  const file = JSON.stringify({ format: 'snapblade', version: 1, diagram });
  const check = async h => {
    assert.equal(await h.ev(() => window.__pwn), undefined);
    assert.equal(await h.ev(() => document.querySelectorAll('img').length), 0);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(await h.ev(() => S.nodes.map(n => n.id)), ['a', 'b', 'g', 'g2']);
    assert.deepEqual(await h.ev(() => S.edges.map(e => e.id)), ['e1']);
    assert.deepEqual(await h.ev(() => ({ ...byId('a'), x: 0 })), { id: 'a', kind: 'box', label: 'A', x: 0, y: 0, w: 120, h: 60, parent: null, style: {} });
    assert.deepEqual(await h.ev(() => byId('b').style), { line: 'green', dash: 'dashed' });
    assert.deepEqual(await h.ev(() => [byId('g').layout, byId('g').pad, byId('g').align, byId('g').parent === null || byId('g2').parent === null]), ['free', 20, 'center', true]);
    assert.deepEqual(await h.ev(() => S.edges[0]), { id: 'e1', from: { node: 'a', side: 'auto' }, to: { node: 'b', side: 'left' }, arrow: 'end', label: 'ok', style: {} });
    assert.deepEqual(await h.ev(() => [S.settings, S.title.pos, S.legend.pos, S.legend.labels, S.legend.hidden]),
      [{ mode: 'straighten', grid: 10, showSlots: true, routing: 'ortho', radius: 6, labelPos: 'start' }, 'bottom-right', 'bottom-left', {}, []]);
    const svg = await h.ev(() => buildExportSvg({ theme: 'light', background: 'white', scope: 'all' }).svg);
    assert.doesNotMatch(svg, /onerror|<img/);
  };
  // Dropped on the canvas, then reloaded from storage.
  const h = await open();
  await h.ev(t => { const dt = new DataTransfer(); dt.items.add(new File([t], 'hostile.snapblade')); stage.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, file);
  await h.page.waitForTimeout(200);
  await check(h);
  await h.page.reload(); await h.page.waitForTimeout(300);
  await check(h);
  // Already in storage from an earlier visit.
  await check(await open({ seed: JSON.stringify(diagram) }));
});

const dropFile = (h, text, name) => h.ev(([t, name]) => { const dt = new DataTransfer(); dt.items.add(new File([t], name)); stage.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, [text, name]);
const box = (id, o = {}) => ({ id, kind: 'box', label: id, x: 0, y: 0, w: 120, h: 60, parent: null, ...o });
const link = (id, a, b, o = {}) => ({ id, from: { node: a, side: 'auto' }, to: { node: b, side: 'auto' }, arrow: 'end', ...o });

test('ids that repeat or match built-in names cannot hang or break the app', { timeout: 30000 }, async () => {
  // Before build 20: the repeated ids hid a container loop (the tab hung), and a connector called
  // "__proto__" wrote onto every object in the page, after which nothing could be drawn.
  const diagram = { nodes: [box('a', { parent: 'b' }), box('b', { parent: 'a', x: 300 }), box('a'), box('b'), box('__proto__', { y: 200 }), box('constructor', { x: 300, y: 200 })],
    edges: [link('__proto__', '__proto__', 'constructor', { label: 'ok' }), link('e', 'a', 'b'), link('e', 'b', 'a')] };
  const h = await open(), { page } = h;
  const check = async () => {
    assert.deepEqual(await h.ev(() => [S.nodes.map(n => n.id), S.edges.map(e => e.id)]), [['a', 'b', '__proto__', 'constructor'], ['__proto__', 'e']]);
    assert.deepEqual(await h.ev(() => [document.querySelectorAll('#cv [data-role="node"]').length, document.querySelectorAll('#cv [data-role="edge"]').length]), [4, 2]);
    assert.deepEqual(await h.ev(() => [({}).from, ({}).to].map(v => v === undefined)), [true, true], 'nothing leaks onto other objects');
    assert.deepEqual(h.errors, []);
  };
  await dropFile(h, JSON.stringify({ format: 'snapblade', version: 1, diagram }), 'ids.snapblade'); await page.waitForTimeout(300);
  assert.match(await page.textContent('#toast'), /Opened ids\.snapblade/);
  await check();
  await page.reload(); await page.waitForTimeout(300);
  await check();
  // Such shapes can be used like any other: select one and duplicate it.
  await h.click('__proto__'); await page.keyboard.press('Control+d'); await page.waitForTimeout(50);
  assert.deepEqual(await h.ev(() => [S.nodes.length, new Set(S.nodes.map(n => n.id)).size, S.nodes.every(n => typeof n.id === 'string')]), [5, 5, true]);
  assert.deepEqual(h.errors, []);
});

// Stand-in for a diagram this build can't draw: measuring the connector label "BOOM" throws.
const cannotDraw = () => { const m = CanvasRenderingContext2D.prototype.measureText;
  CanvasRenderingContext2D.prototype.measureText = function (t) { if (t === 'BOOM') throw new Error('cannot draw this'); return m.call(this, t); }; };
const undrawable = { nodes: [box('a'), box('b', { x: 300 })], edges: [link('e', 'a', 'b', { label: 'BOOM' })] };

test('a file that cannot be drawn is refused, and the current diagram stays', async () => {
  const h = await open({ init: cannotDraw }), { page } = h;
  await h.ev(() => { byId('users').label = 'Mine'; save(); });
  const stored = await h.ev(() => localStorage.getItem('snapblade-playground-v1'));
  await dropFile(h, JSON.stringify({ format: 'snapblade', version: 1, diagram: undrawable }), 'broken.snapblade'); await page.waitForTimeout(100);
  await page.click('.modal button:text-is("Don\'t save")'); await page.waitForTimeout(200);
  assert.match(await page.textContent('#toast'), /couldn't be opened/);
  assert.deepEqual(await h.ev(() => [S.nodes.length, byId('users').label, doc.name, doc.dirty]), [13, 'Mine', 'Untitled diagram', true]);
  assert.equal(await h.ev(() => localStorage.getItem('snapblade-playground-v1')), stored, 'the saved copy is untouched');
  // The canvas is still alive: it shows the old diagram and takes edits.
  await page.click('#addBox'); await page.keyboard.press('Escape');
  assert.equal(await h.ev(() => document.querySelectorAll('#cv [data-role="node"]').length), 14);
  assert.deepEqual(h.errors, []);
});

test('a saved diagram that cannot be drawn is set aside, and the sample loads instead', async () => {
  const h = await open({ init: cannotDraw, seed: JSON.stringify(undrawable) }), { page } = h;
  assert.match(await page.textContent('#toast'), /couldn't be drawn/);
  assert.deepEqual(await h.ev(() => [S.nodes.length, doc.name, document.querySelectorAll('#cv [data-role="node"]').length]), [13, 'Untitled diagram', 13]);
  assert.deepEqual(await h.ev(() => [JSON.parse(localStorage.getItem('snapblade-set-aside-v1')).edges[0].label, localStorage.getItem('snapblade-playground-v1')]), ['BOOM', null], 'kept, but out of the way');
  // Work carries on from the sample and is saved as usual.
  await page.click('#addBox'); await page.keyboard.press('Escape');
  assert.equal(await h.ev(() => JSON.parse(localStorage.getItem('snapblade-playground-v1')).nodes.length), 14);
  assert.deepEqual(h.errors, []);
});

test('dropping a file on the canvas opens it; New empties the canvas', async () => {
  const h = await open(), { page } = h;
  const text = await h.ev(() => { byId('users').label = 'From file'; return serialize(); });
  await h.ev(() => { byId('users').label = 'Edited'; save(); });
  await h.ev(t => { const dt = new DataTransfer(); dt.items.add(new File([t], 'dropped.snapblade')); stage.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, text);
  await page.waitForTimeout(100);
  await page.click('.modal button:text-is("Don\'t save")'); await page.waitForTimeout(100);
  assert.deepEqual(await h.ev(() => [doc.name, byId('users').label]), ['dropped', 'From file']);
  await page.click('#fileBtn'); await page.click('#fileMenu [data-file="new"]'); await page.waitForTimeout(50);
  assert.deepEqual(await h.ev(() => [S.nodes.length, doc.name]), [0, 'Untitled diagram']);
  assert.ok(await page.isVisible('#emptyHint'));
});

test('Chrome/Edge: Save writes back to the same file; Save as asks for a new one', async () => {
  // Stand-in for the browser's file picker that records what gets written.
  const h = await open({ init: () => {
    window.__picks = 0; window.__writes = [];
    window.showSaveFilePicker = async ({ suggestedName }) => { window.__picks++; return {
      name: window.__picks === 1 ? suggestedName : 'copy.snapblade',
      createWritable: async () => ({ write: async b => window.__writes.push(await b.text()), close: async () => {} }) }; };
  } }), { page } = h;
  await page.keyboard.press('Control+s'); await page.waitForTimeout(100);
  await h.ev(() => { byId('users').label = 'Second save'; save(); });
  await page.keyboard.press('Control+s'); await page.waitForTimeout(100);
  assert.deepEqual(await h.ev(() => [window.__picks, window.__writes.length]), [1, 2], 'second Save reuses the file');
  assert.match(await h.ev(() => window.__writes[1]), /Second save/);
  await page.keyboard.press('Control+Shift+S'); await page.waitForTimeout(100);
  assert.deepEqual(await h.ev(() => [window.__picks, doc.name]), [2, 'copy']);
});

// ---------- export ----------
async function exportAs(h, choices) {
  await h.page.click('#exportBtn'); await h.page.waitForTimeout(200);
  for (const [k, v] of Object.entries(choices)) await h.page.click(`.modal [data-ex="${k}"][data-val="${v}"]`);
  const [dl] = await Promise.all([h.page.waitForEvent('download', { timeout: 30000 }), h.page.click('.modal button:text-is("Download")')]);
  const tmp = await import('node:os').then(os => os.tmpdir()), file = `${tmp}/${dl.suggestedFilename()}`;
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), data: readFileSync(file) };
}

test('SVG export is clean and standalone', async () => {
  const h = await open();
  // Without the title block and legend, so the legend's sample arrow isn't counted below.
  const { name, data } = await exportAs(h, { format: 'svg', annots: 'no' }), svg = data.toString();
  assert.equal(name, 'Untitled diagram.svg');
  assert.ok(svg.startsWith('<svg'));
  for (const bad of ['var(', 'foreignObject', 'data-role', 'url(#gp)']) assert.ok(!svg.includes(bad), `should not contain ${bad}`);
  assert.ok(svg.includes('>Load balancer</text>'), 'labels are real text');
  assert.equal((svg.match(/ Z" fill=/g) || []).length, 10, 'one arrowhead per connector');
});

test('PNG export is the size the dialog promises; dark theme and selection-only work', async () => {
  const h = await open();
  await h.page.click('#exportBtn'); await h.page.waitForTimeout(200);
  await h.page.click('.modal [data-ex="format"][data-val="png"]'); await h.page.click('.modal [data-ex="scale"][data-val="3"]'); await h.page.waitForTimeout(200);
  const info = await h.page.textContent('#exInfo'); await h.page.click('.modal button:text-is("Close")');
  const { data } = await exportAs(h, { format: 'png', scale: 3 });
  assert.equal(data.subarray(1, 4).toString(), 'PNG');
  assert.ok(info.includes(`${data.readUInt32BE(16)} × ${data.readUInt32BE(20)}`), `${info} vs ${data.readUInt32BE(16)}×${data.readUInt32BE(20)}`);

  const dark = (await exportAs(h, { format: 'svg', theme: 'dark', background: 'none' })).data.toString();
  assert.ok(dark.includes('#7f9ef0'), 'dark palette used');
  await h.ev(() => { setMulti(['orders', 'inv', 'pay']); render(); });
  const part = (await exportAs(h, { theme: 'light', background: 'white', scope: 'selection' })).data.toString();
  assert.ok(part.includes('>Orders API<') && !part.includes('>Customers<'));
});

test('PDF export is a vector PDF using Helvetica (needs internet for the PDF library)', async () => {
  const h = await open();
  const { name, data } = await exportAs(h, { format: 'pdf', page: 'letter' });
  assert.equal(name, 'Untitled diagram.pdf');
  assert.equal(data.subarray(0, 5).toString(), '%PDF-');
  assert.match(data.toString('latin1'), /\/MediaBox \[0 0 792\.?\d* 612\.?\d*\]/, 'US Letter landscape');
  assert.deepEqual(h.errors, []);
});

test('Copy to clipboard puts a PNG on the clipboard', async () => {
  const h = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
  await h.page.click('#exportBtn'); await h.page.waitForTimeout(200);
  await h.page.click('.modal [data-ex="format"][data-val="png"]');
  await h.page.click('.modal button:text-is("Copy to clipboard")'); await h.page.waitForTimeout(1500);
  assert.ok((await h.ev(async () => (await navigator.clipboard.read()).flatMap(i => i.types))).includes('image/png'));
});

// ---------- title block and legend ----------
const blockAt = (h, id) => h.ev(id => { const b = lastGeom.annots.find(q => q.id === id), r = svg.getBoundingClientRect(); return b && { x: r.left + view.x + (b.x + 30) * view.k, y: r.top + view.y + (b.y + 12) * view.k }; }, id);

test('title block: turn on, fills date and remembered author, edits live, survives a file round trip', async () => {
  const h = await open(), { page } = h;
  await h.ev(() => { S.title = titleDefaults(); localStorage.setItem('snapblade-author', 'M. Munchinski'); renderPanel(); render(); });
  await page.click('#f-showTitle');   // the panel switches to the block's settings, so no check() re-verification
  assert.equal(await h.ev(() => sel?.type + ':' + sel?.id), 'annot:title', 'turning it on opens its settings');
  assert.deepEqual(await h.ev(() => [S.title.date, S.title.author]), [await h.ev(() => todayIso()), 'M. Munchinski']);
  await page.fill('#f-ann-title', 'Checkout flow'); await page.fill('#f-ann-version', '2.1');
  const texts = await h.ev(() => [...document.querySelectorAll('[data-id="title"] text')].map(t => t.textContent));
  assert.deepEqual(texts, ['Checkout flow', 'VERSION', '2.1', 'DATE', await h.ev(() => todayIso()), 'AUTHOR', 'M. Munchinski']);
  const restored = await h.ev(() => { const s = parseDiagram(serialize()); return s.title; });
  assert.equal(restored.title, 'Checkout flow'); assert.equal(restored.version, '2.1');
  assert.deepEqual(h.errors, []);
});

test('legend: meanings, hiding rows, corner picker, drag to a corner, delete and undo', async () => {
  const h = await open(), { page } = h;
  let p = await blockAt(h, 'legend'); await page.mouse.click(p.x, p.y);
  assert.equal(await h.ev(() => sel?.id), 'legend');
  await page.fill('#panel [data-key="box:green||pair"]', 'Relational database');
  const rows = () => h.ev(() => [...document.querySelectorAll('[data-id="legend"] .ann-row')].map(t => t.textContent));
  assert.ok((await rows()).includes('Relational database'));
  await page.click('#panel .legrow:has([data-key="box:amber||pair"]) button');
  assert.ok(!(await rows()).includes('Cache'), 'hidden row is gone from the legend');
  await page.click('#panel [data-act="annPos"][data-val="top-left"]');
  assert.equal(await h.ev(() => S.legend.pos), 'top-left');

  // Drag the legend toward the bottom-right of the diagram: it snaps there.
  p = await blockAt(h, 'legend'); const target = await h.toScreen(980, 600);
  await h.drag(p, target);
  assert.equal(await h.ev(() => S.legend.pos), 'bottom-right');

  p = await blockAt(h, 'legend'); await page.mouse.click(p.x, p.y); await page.keyboard.press('Delete');
  assert.equal(await h.ev(() => S.legend.show), false, 'Delete hides the block');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await h.ev(() => [S.legend.show, S.legend.pos]), [true, 'bottom-right'], 'undo brings it back');
  assert.deepEqual(h.errors, []);
});

test('double-clicking a block opens its settings with the first field focused', async () => {
  const h = await open(), { page } = h;
  const p = await blockAt(h, 'title'); await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(80);
  assert.equal(await h.ev(() => document.activeElement?.id), 'f-ann-title');
  assert.equal(await h.ev(() => S.nodes.length), 13, 'no box was added');
});

test('exports include the title block and legend unless left out', async () => {
  const h = await open();
  const withBlocks = (await exportAs(h, { format: 'svg' })).data.toString();
  assert.ok(withBlocks.includes('>Order platform<') && withBlocks.includes('>Database<') && withBlocks.includes('>LEGEND<'));
  const without = (await exportAs(h, { format: 'svg', annots: 'no' })).data.toString();
  assert.ok(!without.includes('>Order platform<') && !without.includes('>LEGEND<'));
});
