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
// Every kind of panel: what each setup selects. A new panel context (a new kind of selection) needs a line here.
const CONTEXTS = [
  ['diagram', 'sel = null; multi = []'],
  ['title block', "S.title.show = true; sel = { type: 'annot', id: 'title' }; multi = []"],
  ['legend', "S.legend.show = true; sel = { type: 'annot', id: 'legend' }; multi = []"],
  ['box', "sel = { type: 'node', id: 'users' }; multi = []"],
  ['box in a column', "sel = { type: 'node', id: 'lb' }; multi = []"],
  ['container', "sel = { type: 'node', id: 'app' }; multi = []"],
  ['connector', "sel = { type: 'edge', id: 'e3' }; multi = []"],
  ['connector, Visio-style', "setMode('fixed'); sel = { type: 'edge', id: 'e4' }; multi = []"],
  // Walking the container controls may leave Application tier in a row or column layout, which would disable Arrange.
  ['several shapes', "freeApp(); multi = ['orders', 'inv', 'pay']; sel = { type: 'node', id: 'orders' }"],
  ['container, then boxes inside it', "freeApp(); multi = ['app', 'orders', 'inv']; sel = { type: 'node', id: 'app' }"],
  // Sequence diagrams: the sample is loaded once, and the contexts after it keep working on it.
  ['sequence diagram', "seqOn(); sel = null; multi = []"],
  ['participant', "seqOn(); sel = { type: 'seq', id: 'orders' }; multi = []"],
  ['message', "seqOn(); sel = { type: 'seq', id: 'm4' }; multi = []"],
  ['note', "seqOn(); sel = { type: 'seq', id: 'n1' }; multi = []"],
  // The else line goes before the frame: switching the frame to Opt or Loop removes it.
  ['run of rows', "seqOn(); sel = { type: 'seq', id: 'm2', to: 'm4' }; multi = []"],
  ['else line', "seqOn(); sel = { type: 'seq', id: 'f1e' }; multi = []"],
  ['frame', "seqOn(); sel = { type: 'seq', id: 'f1' }; multi = []"],
  ['sequence title block', "seqOn(); S.title.show = true; sel = { type: 'annot', id: 'title' }; multi = []"],
];
// Defines freeApp() and seqOn() in the page, for the contexts above.
const contextHelpers = h => h.ev(() => {
  window.freeApp = () => { if (!isSeq() && byId('app').layout !== 'free') { byId('app').layout = 'free'; layoutAll(); save(); } };
  window.seqOn = () => { if (!isSeq()) { setContent(seqSample()); syncTypeUi(); save(); } };
});
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
  await h.button('Both');
  const after = await centers();
  assert.deepEqual(after.map(c => c.slice(0, 2)), [[160, 60], [160, 60], [160, 60]], 'matches the first selected');
  assert.deepEqual(after.map(c => c.slice(2)), before.map(c => c.slice(2)), 'centers are kept');
  await h.page.keyboard.press('Control+z');
  await h.button('Largest'); await h.button('Width');
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

test('Arrange: line up a column, straighten connectors, line up inside a container, undo', async () => {
  const h = await open();
  await h.ev(() => { byId('inv').x = 515; byId('pay').x = 540; byId('users').y = 260; refresh(true, false); });
  const cx = ids => h.ev(ids => ids.map(id => byId(id).x + byId(id).w / 2), ids);
  await h.selectApis();
  assert.deepEqual(await h.ev(() => multi), ['orders', 'inv', 'pay']);
  assert.ok((await h.page.textContent('#panel')).includes('Lines up with Orders API'));
  await h.page.click('#panel button[aria-label="Column: line up centers"]');
  assert.deepEqual(await cx(['orders', 'inv', 'pay']), [600, 600, 600]);
  await h.page.keyboard.press('Control+z');
  assert.deepEqual(await cx(['orders', 'inv', 'pay']), [600, 595, 620], 'one undo step');

  await h.clear(); await h.click('users'); await h.button('Straighten connectors');
  assert.ok(await h.ev(() => { const P = computePorts(); return P.e1.from.y === P.e1.to.y; }), 'Customers to firewall runs straight');
  assert.equal(await h.ev(() => byId('users').x), 40);

  // Container first, then boxes inside it: they line up inside the container, which stays put.
  await h.clear();
  const app = await h.ev(() => { const g = byId('app'); return [g.x, g.y, g.w, g.h]; });
  const hdr = await h.toScreen(app[0] + 60, app[1] + 12); await h.page.mouse.click(hdr.x, hdr.y);
  await h.page.keyboard.down('Shift'); await h.click('inv'); await h.click('pay'); await h.page.keyboard.up('Shift');
  assert.deepEqual(await h.ev(() => multi), ['app', 'inv', 'pay']);
  assert.ok((await h.page.textContent('#panel')).includes('Lines up inside Application tier'));
  await h.page.click('#panel button[aria-label="Column: line up rights"]');
  assert.deepEqual(await h.ev(() => { const g = byId('app'); return [g.x, g.y, g.w, g.h]; }), app);
  assert.deepEqual(await h.ev(() => ['inv', 'pay'].map(id => byId(id).x + byId(id).w)), [app[0] + app[2] - 20, app[0] + app[2] - 20]);
  assert.deepEqual(h.errors, []);
});

test('copy, paste, duplicate, cut, group move and delete', async () => {
  const h = await open();
  await h.click('orders');
  const o = await h.ev(() => [byId('orders').x, byId('orders').y]);
  await h.page.keyboard.press('Control+c'); await h.page.keyboard.press('Control+v'); await h.page.keyboard.press('Control+v');
  // Copies drop to the first free spot below the original: under Orders API, then between Inventory and Payments.
  assert.deepEqual(o, [520, 140]);
  assert.deepEqual(await h.ev(() => S.nodes.slice(-2).map(n => [n.x, n.y, n.parent])), [[520, 220, 'app'], [520, 390, 'app']]);
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
  const p = await h.at(ids[0]); await h.drag(p, { x: p.x, y: p.y - 40 });
  const y1 = await h.ev(ids => ids.map(id => byId(id).y), ids);
  assert.ok(y1.every((y, i) => y < y0[i]), 'every selected shape moved up');
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

test('the diagram panel holds settings only; Help opens from the bar, F1 and ?', async () => {
  const h = await open();
  await h.clear();
  const panelText = () => h.ev(() => panel.textContent);
  const t = await panelText();
  for (const s of ['Connector routing', 'Grid snap', 'Corner radius', 'Title block', 'Legend']) assert.ok(t.includes(s), `panel shows ${s}`);
  for (const s of ['Things to try', 'Ctrl+Z', 'Reload sample', 'Anchor behavior']) assert.ok(!t.includes(s), `panel leaves out ${s}`);
  assert.ok(await h.ev(() => [...document.querySelectorAll('#modeSeg button')].every(b => b.title.length > 20)), 'anchor modes explain themselves on hover');

  const modalOpen = () => h.ev(() => !document.getElementById('modal').hidden);
  const modalText = () => h.ev(() => document.querySelector('#modal .modal').textContent);
  await h.page.click('#helpBtn');
  assert.ok(await modalOpen());
  assert.ok((await modalText()).includes('Ctrl+Z'), 'opens on the shortcuts');
  await h.page.click('#modal button:text-is("How anchors work")');
  assert.ok((await modalText()).includes('Even spacing, then straighten'));
  await h.page.click('#modal button:text-is("Things to try")');
  assert.ok((await modalText()).includes('Load balancer'));

  // The sample button restores the sample and closes Help; undo brings the edit back.
  await h.page.keyboard.press('Escape'); assert.ok(!(await modalOpen()));
  await h.click('inv'); await h.page.keyboard.press('Delete');
  const n0 = await h.ev(() => S.nodes.length);
  await h.button('Shortcuts and help');
  assert.ok((await modalText()).includes('Load balancer'), 'reopens on the last tab');
  await h.page.click('#modal button:text-is("Load the sample diagram")');
  assert.ok(!(await modalOpen()));
  assert.equal(await h.ev(() => S.nodes.length), n0 + 1);
  await h.page.keyboard.press('Control+z');
  assert.equal(await h.ev(() => S.nodes.length), n0);

  await h.clear();
  await h.page.keyboard.press('?'); assert.ok(await modalOpen(), '? opens help with nothing selected');
  await h.page.keyboard.press('Escape');
  await h.page.keyboard.press('F1'); assert.ok(await modalOpen(), 'F1 opens help');
  await h.page.keyboard.press('Escape');
  await h.click('lb'); await h.page.keyboard.press('?');
  assert.ok(!(await modalOpen()), '? with a box selected types into it');
  assert.equal((await h.editor()).box, 'lb');
  assert.deepEqual(h.errors, []);
});

// normalize() keeps only the fields it knows, so a setting it hasn't been told about works until the page
// is reloaded or the file reopened. This walks the controls on screen rather than a list of fields, so a
// new control is covered as soon as it exists: each one is used, then the diagram must come back unchanged
// from what a reload reads (load()) and from a save and reopen (parseDiagram(serialize())).
test('every control in every panel survives a reload and a file round trip', { timeout: 180000 }, async () => {
  const h = await open();
  const SKIP = new Set(['delete', 'deleteAll', 'duplicate', 'help', 'annHide']);   // remove or add shapes, or open a dialog
  await contextHelpers(h);
  const controls = () => h.ev(() => [...document.querySelectorAll('#panel [data-act], #panel [data-field], #modeSeg [data-mode]')]
    .filter(el => !el.disabled && el.offsetParent !== null)
    .map(el => ({
      key: (el.closest('#modeSeg') ? '#modeSeg ' : '#panel ') + (el.id ? '#' + el.id : el.tagName.toLowerCase() +
        ['data-act', 'data-field', 'data-mode', 'data-val', 'data-scope', 'data-key'].filter(k => el.hasAttribute(k)).map(k => `[${k}="${CSS.escape(el.getAttribute(k))}"]`).join('')),
      act: el.dataset.act || null, field: el.dataset.field || null, tag: el.tagName, type: el.type, pressed: el.getAttribute('aria-pressed') === 'true',
    })));
  const check = async label => {
    const [now, reloaded, reopened] = await h.ev(() => [S, load(), parseDiagram(serialize())].map(x => JSON.parse(JSON.stringify(x))));
    assert.deepStrictEqual(reloaded, now, `${label}: a reload changes the diagram`);
    assert.deepStrictEqual(reopened, now, `${label}: saving and reopening changes the diagram`);
  };
  const use = async (c, label) => {
    const el = h.page.locator(c.key);
    if (c.tag === 'SELECT') {
      for (const v of await el.evaluate(s => [...s.options].filter(o => !o.selected).map(o => o.value))) {
        await h.page.locator(c.key).selectOption(v); await check(`${label} = ${v}`);
      }
      return;
    }
    if (c.tag === 'BUTTON' || c.type === 'checkbox') await el.click();
    else if (c.type === 'color') await el.fill('#2a9d8f');
    else if (c.type === 'range') await el.evaluate(r => { r.value = +r.min + (r.value - r.min + 5) % (r.max - r.min + 1); r.dispatchEvent(new Event('input', { bubbles: true })); });
    else if (c.type === 'number') { const v = +(await el.inputValue()); await el.fill(String(/-[rgb]$/.test(c.field) ? (v + 97) % 256 : v + 13)); }
    else await el.fill(c.field.endsWith('-hex') ? '#3a7bd5' : `Round trip ${c.field}`);
    await check(label);
  };

  const visited = new Set();
  for (const [name, setup] of CONTEXTS) {
    const reselect = () => h.ev(`(() => { ${setup}; renderPanel(); render(); })()`);
    await reselect();
    let queue = [];
    for (;;) {
      const now = await controls(), fresh = c => !visited.has(name + c.key) && !SKIP.has(c.act) && !c.pressed;
      // Controls that a change just revealed (a fill color after "Custom", Gap after "Row") go first, before another change hides them.
      const next = queue.map(k => now.find(c => c.key === k)).find(c => c && fresh(c)) || now.find(fresh);
      if (!next) break;
      visited.add(name + next.key);
      await use(next, `${name}: ${next.key}`);
      await reselect();
      const after = await controls();
      queue = [...after.filter(c => !now.some(o => o.key === c.key)).map(c => c.key), ...queue];
    }
  }
  const seen = [...visited].join(' ');
  for (const k of ['f-tint', 'f-fill-hex', 'f-line-r', 'data-act="align"', 'f-gap', 'f-fromSide', 'data-mode="fixed"', 'data-field="leg-label"', 'f-ann-author', 'data-act="annPos"', 'f-radius', 'data-act="lineUp"', 'data-act="straighten"', 'f-spaceGap',
    'f-autonumber', 'f-footbox', 'data-act="msgType"', 'f-msgFrom', 'f-noteTo', 'data-act="noteSide"', 'data-act="seqMove"'])
    assert.ok(seen.includes(k), `the walk reached ${k}`);
  assert.ok(visited.size > 120, `walked ${visited.size} controls`);

  // And for real: reload the page and compare.
  const before = await h.ev(() => JSON.parse(JSON.stringify(S)));
  await h.page.reload(); await h.page.waitForTimeout(300);
  assert.deepStrictEqual(await h.ev(() => JSON.parse(JSON.stringify(S))), before);
  assert.deepStrictEqual(h.errors, []);
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
  assert.equal(saved.format, 'snapblade'); assert.equal(saved.version, 2);
  assert.equal(saved.pages[0].diagram.nodes.find(n => n.id === 'lb').label, 'Front door');
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
      [{ mode: 'straighten', grid: 10, showSlots: true, routing: 'ortho', radius: 6, labelPos: 'start', walls: true, autonumber: false, footbox: true }, 'bottom-right', 'bottom-left', {}, []]);
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
  assert.equal(await h.ev(() => JSON.parse(localStorage.getItem('snapblade-playground-v1')).pages[0].diagram.nodes.length), 14);
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

test('hard walls: shapes stop 20 px apart, Alt overrides, containers push, and the setting turns it off', async () => {
  const h = await open(), { page } = h;
  const xy = id => h.ev(id => [byId(id).x, byId(id).y], id), box = id => h.ev(id => { const n = byId(id); return [n.x, n.y, n.w, n.h]; }, id);
  // Undo, then wait out the double-click window: the next drag starts where the last one did.
  const undo = async () => { await page.keyboard.press('Control+z'); await page.waitForTimeout(500); };
  // Payment gateway dragged left toward the Application tier stops 20 px short of it (700 + 20).
  let p = await h.at('gw'); await h.drag(p, await h.toScreen(750, 510));
  assert.deepEqual(await xy('gw'), [720, 480]);
  await undo();
  // Alt lets it overlap.
  p = await h.at('gw'); await page.keyboard.down('Alt'); await h.drag(p, await h.toScreen(750, 510)); await page.keyboard.up('Alt');
  assert.deepEqual(await xy('gw'), [670, 480]);
  await undo();
  // Dropped inside the container, it keeps clear of the boxes there.
  p = await h.at('gw'); await h.drag(p, await h.toScreen(600, 255));
  const [gx, gy] = await xy('gw');
  assert.equal(await h.ev(() => byId('gw').parent), 'app');
  assert.ok(gx === 520 && gy >= 200 + 20 && gy + 60 <= 310 - 20, `between Orders and Inventory, 20 px clear of both (y ${gy})`);
  await undo();

  // A resized edge stops 20 px from the next box: Inventory API's bottom stops above Payments API (480 - 20).
  await h.click('inv'); p = await h.toScreen(600, 370); await h.drag(p, await h.toScreen(600, 570));
  assert.deepEqual(await box('inv'), [520, 310, 160, 150]);
  await undo();
  // Nudging into a wall stops at it; so does typing a position.
  await h.click('pay'); for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
  assert.deepEqual(await xy('pay'), [520, 390]);
  await undo(); await h.click('pay'); await page.fill('#f-y', '300');
  assert.deepEqual(await xy('pay'), [520, 390]);
  await page.keyboard.press('Escape'); await undo();

  // A box added to the Data tier column makes it taller, and it pushes Payment gateway down to stay 20 px clear.
  const hdr = await h.toScreen(900, 105); await page.mouse.click(hdr.x, hdr.y);
  await page.click('#addBox'); await page.keyboard.press('Escape');
  const data = await box('data');
  assert.equal(data[1] + data[3], 470);
  assert.deepEqual(await xy('gw'), [820, 490]);
  await undo();

  // Turned off: the gateway goes where it's dragged.
  await h.clear(); await page.click('#f-walls');
  assert.equal(await h.ev(() => S.settings.walls), false);
  p = await h.at('gw'); await h.drag(p, await h.toScreen(750, 510));
  assert.deepEqual(await xy('gw'), [670, 480]);
  assert.deepEqual(h.errors, []);
});

test('connecting: an edge band pins that side and lights it up; the middle is auto and lights up the shape; re-attaching works the same', async () => {
  const h = await open(), { page } = h;
  const center = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const status = () => h.ev(() => statusEl.textContent);
  const lit = () => h.ev(() => ({ side: !!svg.querySelector('.side-hl'), shape: [...svg.querySelectorAll('.node.target')].map(n => n.dataset.id) }));
  // Press on a handle, move to `to`, report what's highlighted, then let go.
  const dragTo = async (from, to) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 });
    const seen = { ...(await lit()), status: await status() }; await page.mouse.up(); await page.waitForTimeout(500);
    return seen;
  };
  const fromHandle = async () => { await page.mouse.move(...Object.values(await h.at('users'))); return center('[data-role="connect"][data-id="users"][data-side="bottom"] circle'); };
  const last = () => h.ev(() => S.edges[S.edges.length - 1]);

  // Payments API is at 520..680 x 480..540: x = 525 is in its left band.
  let seen = await dragTo(await fromHandle(), await h.toScreen(525, 510));
  assert.deepEqual([seen.side, seen.shape], [true, []], 'only the left side lights up');
  assert.match(seen.status, /Connect to Payments API\s+·\s+left side/);
  assert.deepEqual((await last()).to, { node: 'pay', side: 'left' });
  assert.deepEqual((await last()).from, { node: 'users', side: 'bottom' });

  seen = await dragTo(await fromHandle(), await h.toScreen(600, 510));
  assert.deepEqual([seen.side, seen.shape], [false, ['pay']], 'the whole shape lights up');
  assert.match(seen.status, /Connect to Payments API\s+·\s+auto side/);
  assert.deepEqual((await last()).to, { node: 'pay', side: 'auto' });

  // The new connector is selected: drag its arrowhead end to Inventory API's top band (310..370), then its middle.
  const id = (await last()).id;
  seen = await dragTo(await center('circle.eh[data-which="to"]'), await h.toScreen(600, 313));
  assert.equal(seen.side, true);
  assert.deepEqual(await h.ev(id => S.edges.find(e => e.id === id).to, id), { node: 'inv', side: 'top' });
  await h.ev(id => { sel = { type: 'edge', id }; render(); }, id);
  seen = await dragTo(await center('circle.eh[data-which="to"]'), await h.toScreen(600, 340));
  assert.deepEqual(seen.shape, ['inv']);
  assert.deepEqual(await h.ev(id => S.edges.find(e => e.id === id).to, id), { node: 'inv', side: 'auto' }, 'dropped in the middle: back to auto');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await h.ev(id => S.edges.find(e => e.id === id).to, id), { node: 'inv', side: 'top' });
  assert.deepEqual(h.errors, []);
});

test('the Help guide mentions every control, panel heading, top-bar button and export option', { timeout: 120000 }, async () => {
  const h = await open(), { page } = h;
  await contextHelpers(h);
  // What each control is called on screen: its text, its field's label, or its aria-label. Counts and values
  // after a "·" change with the diagram, so they're left off.
  const names = sel => h.ev(sel => [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null).map(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    const lab = el.closest('label'), span = lab?.querySelector('span');
    const t = el.classList.contains('eyebrow') ? el.textContent : el.tagName === 'BUTTON' ? own || el.getAttribute('aria-label') || el.title
      : span?.textContent || lab?.textContent || el.getAttribute('aria-label') || el.title;
    return t.replace(/\s·\s.*$/s, '').replace(/[▾…]/g, '').replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim();
  }), sel);
  const all = new Set();
  for (const [, setup] of CONTEXTS) {
    await h.ev(`(() => { ${setup}; renderPanel(); render(); })()`);
    for (const n of await names('#panel [data-act], #panel [data-field], #panel .eyebrow, .bar button')) all.add(n);
  }
  await page.click('#fileBtn');
  for (const n of await names('#fileMenu button')) all.add(n);
  await page.keyboard.press('Escape');
  // The tab strip's own controls (not the tabs, which are named by the user), with a second tab so Delete tab and the export Tabs option show.
  await h.ev(() => { closeMenu(); addTab('copy'); });
  await page.click('#tabAdd');
  for (const n of await names('#tabs button, #tabs [data-tabdel], #tabMenu button')) all.add(n);
  await page.keyboard.press('Escape'); await h.ev(() => closeMenu());
  await h.ev(() => { sel = null; multi = []; renderPanel(); });
  await page.click('#exportBtn');
  for (const fmt of ['PNG', 'PDF']) {
    await page.click(`[data-ex="format"]:text-is("${fmt}")`);
    for (const n of await names('#modal [data-ex], #modal .field > span, #modal .actions button')) all.add(n);
  }
  await page.keyboard.press('Escape');
  await page.click('#helpBtn'); await page.click('[data-help="guide"]');
  const guide = (await page.textContent('.help-body')).replace(/\s+/g, ' ').toLowerCase();
  const skip = n => !n || /^meaning of /i.test(n) || n === 'Close';   // legend rows are named after their style; Close is obvious
  const missing = [...all].filter(n => !skip(n) && !guide.includes(n.toLowerCase()));
  assert.ok(all.size > 100, `checked ${all.size} names`);
  assert.deepEqual(missing, [], 'not mentioned in the Help guide');
  assert.deepEqual(h.errors, []);
});

test('Help: the guide links to its sections; the AI tab shows the agent instructions and copies them', async () => {
  const h = await open({ permissions: ['clipboard-read', 'clipboard-write'] }), { page } = h;
  await page.click('#helpBtn'); await page.click('[data-help="guide"]');
  assert.ok(await page.locator('.toc a').count() >= 10);
  await page.click('.toc a[href="#g-export"]');
  assert.ok(await page.locator('#g-export').isVisible());
  await page.click('[data-help="agents"]');
  const spec = await h.ev(() => agentSpec());
  assert.equal(await page.textContent('pre.spec'), spec);
  await page.click('[data-copy-spec]');
  assert.equal(await h.ev(() => navigator.clipboard.readText()), spec);
  assert.match(await page.textContent('#toast'), /Instructions copied/);
  assert.deepEqual(h.errors, []);
});

// ---------- sequence diagrams ----------
// Screen positions in a sequence diagram: a point on a participant's lifeline at world y, and the middle of a row.
const seqAt = (h, id, y) => h.ev(([id, y]) => { const q = lastGeom.seq.P.find(q => q.id === id), r = svg.getBoundingClientRect(); return { x: r.left + view.x + q.x * view.k, y: r.top + view.y + y * view.k }; }, [id, y]);
const seqRow = (h, id) => h.ev(id => { const g = lastGeom.seq.R.find(g => g.r.id === id), r = svg.getBoundingClientRect();
  const p = g.note ? { x: g.x + g.w / 2, y: g.y + g.h / 2 } : g.self ? { x: g.x1 + SEQ.self, y: (g.ay + g.by) / 2 } : { x: (g.x1 + g.x2) / 2, y: g.ay };
  return { x: r.left + view.x + p.x * view.k, y: r.top + view.y + p.y * view.k }; }, id);
const seqBottom = h => h.ev(() => lastGeom.seq.end - 12);
const seqSampleOn = h => h.ev(() => { loadSample(true); undoStack.length = 0; });
const rows = h => h.ev(() => S.rows.map(r => r.kind === 'note' ? `note ${r.side} ${r.on.join(',')}: ${r.label}` : r.kind ? `${r.kind} ${r.type || ''}: ${r.label || ''}` : `${r.from}>${r.to} ${r.type}: ${r.label}`));

test('sequence diagrams: New, + Participant, double-click adds a participant, drag between lifelines adds a message, Enter goes on to the next', async () => {
  const h = await open(), { page } = h;
  await page.click('#fileBtn'); await page.click('[data-file="newseq"]'); await page.waitForTimeout(100);
  assert.equal(await h.ev(() => S.type), 'sequence');
  assert.deepEqual(await h.ev(() => ['addBox', 'addGroup', 'modeSeg', 'addPart', 'addNote'].map(id => document.getElementById(id).hidden)), [true, true, true, false, false]);
  // + Participant adds one after the selected one, named as you type.
  for (const name of ['Customer', 'Web app', 'Orders API']) { await page.click('#addPart'); await page.keyboard.type(name); await page.keyboard.press('Enter'); }
  assert.deepEqual(await h.ev(() => S.parts.map(p => p.label)), ['Customer', 'Web app', 'Orders API']);
  const [c, w, o] = await h.ev(() => S.parts.map(p => p.id));
  await page.keyboard.press('Escape');
  for (const [a, b, label] of [[c, w, 'checkout'], [w, o, 'POST /orders']]) {
    const y = await seqBottom(h);
    await h.drag(await seqAt(h, a, y), await seqAt(h, b, y)); await page.waitForTimeout(80);
    await page.keyboard.type(label); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  }
  assert.deepEqual(await rows(h), [`${c}>${w} sync: checkout`, `${w}>${o} sync: POST /orders`]);

  // Double-click right of the last head: a participant there, named as you type.
  const lastHead = await seqAt(h, o, 20);
  await page.mouse.dblclick(lastHead.x + 200, lastHead.y); await page.waitForTimeout(80);
  assert.equal((await h.editor()).open, true);
  await page.keyboard.type('Payments'); await page.keyboard.press('Enter');
  assert.deepEqual(await h.ev(() => S.parts.map(p => p.label)), ['Customer', 'Web app', 'Orders API', 'Payments']);
  const pay = await h.ev(() => S.parts[3].id);

  // Drag from one lifeline to another below the last row: a message at the end, label editor open.
  const y = await seqBottom(h);
  await h.drag(await seqAt(h, o, y), await seqAt(h, pay, y)); await page.waitForTimeout(80);
  await page.keyboard.type('charge'); await page.keyboard.press('Enter');
  assert.match(await page.textContent('#status'), /Next message from Payments/);
  // Enter went on: click the lifeline the next one goes to. It answers the call above, so it starts as a reply.
  await page.mouse.click(...Object.values(await seqAt(h, o, y - 30))); await page.waitForTimeout(80);
  await page.keyboard.type('ok'); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.deepEqual((await rows(h)).slice(2), [`${o}>${pay} sync: charge`, `${pay}>${o} reply: ok`]);
  // A drag that stays on its own lifeline is a self-message, inserted at the row where it started.
  const top = await h.ev(() => lastGeom.seq.H + 10);
  await h.drag(await seqAt(h, w, top), { ...(await seqAt(h, w, top)), y: (await seqAt(h, w, top)).y + 40 }); await page.waitForTimeout(80);
  await page.keyboard.type('think'); await page.keyboard.press('Enter');
  assert.deepEqual((await rows(h))[0], `${w}>${w} sync: think`);
  // Each new message, with its label, is one undo step.
  await page.keyboard.press('Escape'); await page.keyboard.press('Control+z');
  assert.equal((await rows(h)).length, 4);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await rows(h)).slice(2), [`${o}>${pay} sync: charge`]);
  // Survives a reload.
  const before = await h.ev(() => JSON.parse(JSON.stringify(S)));
  await page.reload(); await page.waitForTimeout(300);
  assert.deepStrictEqual(await h.ev(() => JSON.parse(JSON.stringify(S))), before);
  assert.equal(await h.ev(() => document.getElementById('addPart').hidden), false);
  assert.deepEqual(h.errors, []);
});

test('sequence diagrams: drag rows and participants to reorder, arrow keys, panel controls, delete and undo', async () => {
  const h = await open(), { page } = h;
  await seqSampleOn(h);
  // Drag Place order down below Validate cart.
  await h.drag(await seqRow(h, 'm1'), { ...(await seqRow(h, 'm3')), y: (await seqRow(h, 'm3')).y + 12 });
  assert.deepEqual(await h.ev(() => S.rows.slice(0, 3).map(r => r.id)), ['m2', 'm3', 'm1']);
  // Drag the Event bus head left of Orders API.
  await h.drag(await seqAt(h, 'bus', 20), { ...(await seqAt(h, 'orders', 20)), x: (await seqAt(h, 'orders', 20)).x - 70 });
  assert.deepEqual(await h.ev(() => S.parts.map(p => p.id)), ['cust', 'web', 'bus', 'orders', 'pay', 'gw']);
  // Arrow keys move the selection: a row up or down, a participant left or right.
  await page.mouse.click(...Object.values(await seqRow(h, 'm1')));
  assert.deepEqual(await h.ev(() => sel), { type: 'seq', id: 'm1' });
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  assert.deepEqual(await h.ev(() => S.rows.slice(0, 3).map(r => r.id)), ['m1', 'm2', 'm3']);
  await page.mouse.click(...Object.values(await seqAt(h, 'bus', 20)));
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await h.ev(() => S.parts.map(p => p.id)), ['cust', 'web', 'orders', 'bus', 'pay', 'gw']);
  // The message panel: kind, ends, reverse.
  await page.mouse.click(...Object.values(await seqRow(h, 'm2')));
  await h.button('Async');
  await page.selectOption('#f-msgTo', 'pay');
  await h.button('Reverse direction');
  assert.deepEqual(await h.ev(() => S.rows.find(r => r.id === 'm2')), { id: 'm2', from: 'pay', to: 'web', type: 'async', label: 'POST /orders' });
  // A note: position and span.
  await page.mouse.click(...Object.values(await seqRow(h, 'n1')));
  await h.button('Left of');
  assert.deepEqual(await h.ev(() => S.rows.find(r => r.id === 'n1').on), ['pay']);
  await h.button('Over'); await page.selectOption('#f-noteTo', 'cust');
  assert.deepEqual(await h.ev(() => S.rows.find(r => r.id === 'n1')), { id: 'n1', kind: 'note', side: 'over', on: ['pay', 'cust'], label: 'mTLS. Can take up to 5 s.' });
  // Deleting a participant takes its messages and notes; undo brings them back.
  const all = await rows(h);
  await page.mouse.click(...Object.values(await seqAt(h, 'gw', 20)));
  await page.keyboard.press('Delete');
  assert.ok(await h.ev(() => !partOf('gw') && S.rows.every(r => isNote(r) ? !r.on.includes('gw') : r.from !== 'gw' && r.to !== 'gw')));
  await page.keyboard.press('Control+z');
  assert.deepEqual(await rows(h), all);
  // A note added beside the selected message, typed in place.
  await page.mouse.click(...Object.values(await seqRow(h, 'm4')));
  await page.click('#addNote'); await page.keyboard.type('retries twice'); await page.keyboard.press('Enter');
  const i = await h.ev(() => S.rows.findIndex(r => r.id === 'm4'));
  assert.deepEqual(await h.ev(i => { const r = S.rows[i + 1]; return [r.kind, r.side, r.on, r.label]; }, i), ['note', 'right', ['pay'], 'retries twice']);
  assert.deepEqual(h.errors, []);
});

// A frame's line (start, else or end) on screen: dx along it from the left edge, dy below it.
const frameAt = (h, id, dx = 30, dy = 0) => h.ev(([id, dx, dy]) => { const g = lastGeom.seq.R.find(g => g.r.id === id), r = svg.getBoundingClientRect();
  return { x: r.left + view.x + (g.x1 + dx) * view.k, y: r.top + view.y + (g.y + dy) * view.k }; }, [id, dx, dy]);
const ids = h => h.ev(() => S.rows.map(r => r.id));

test('sequence frames: Shift+click a run, + Frame, type the condition, drag an edge, move it whole, add an else line, remove it and keep the rows', async () => {
  const h = await open(), { page } = h;
  await seqSampleOn(h);
  // Click Authorize payment, Shift+click Result: the run, with its own panel.
  await page.mouse.click(...Object.values(await seqRow(h, 'm4')));
  await page.keyboard.down('Shift'); await page.mouse.click(...Object.values(await seqRow(h, 'm6'))); await page.keyboard.up('Shift');
  assert.deepEqual(await h.ev(() => sel), { type: 'seq', id: 'm4', to: 'm6' });
  assert.match(await page.textContent('#panel'), /Put in a frame/);
  assert.equal(await h.ev(() => document.querySelectorAll('#cv .sel').length), 4, 'the run is highlighted');
  // + Frame > Loop, then type the condition.
  await page.click('#addFrame'); await page.click('[data-frame="loop"]');
  assert.equal((await h.editor()).open, true);
  await page.keyboard.type('up to 3 tries'); await page.keyboard.press('Enter');
  const loop = await h.ev(() => sel.id), all = await ids(h);
  assert.deepEqual(await h.ev(id => S.rows.find(r => r.id === id), loop), { id: loop, kind: 'frame', type: 'loop', label: 'up to 3 tries' });
  assert.deepEqual(all.slice(all.indexOf(loop), all.indexOf(loop) + 6).slice(1, 5), ['m4', 'm5', 'n1', 'm6']);
  assert.equal(await h.ev(i => S.rows[i].kind, all.indexOf('m6') + 1), 'end');
  assert.ok((await h.ev(() => svg.textContent)).includes('[up to 3 tries]'));
  // One undo step takes the frame and its condition away.
  await page.keyboard.press('Control+z');
  assert.equal(await h.ev(id => S.rows.some(r => r.id === id), loop), false);
  await page.keyboard.press('Control+y');
  // Drag the alt frame's bottom edge up past Show payment error: it leaves the frame.
  const m13 = await seqRow(h, 'm13');
  await h.drag(await frameAt(h, 'f1x'), { x: (await frameAt(h, 'f1x')).x, y: m13.y - 20 });
  assert.deepEqual((await ids(h)).slice(-3), ['m12', 'f1x', 'm13']);
  assert.deepEqual(await h.ev(() => sel), { type: 'seq', id: 'f1' }, 'the bottom edge selects its frame');
  // The end can't go above its else line: it stops right below it.
  await h.drag(await frameAt(h, 'f1x'), { x: (await frameAt(h, 'f1x')).x, y: (await seqRow(h, 'm8')).y });
  const now = await ids(h);
  assert.deepEqual(now.slice(now.indexOf('f1e'), now.indexOf('f1e') + 2), ['f1e', 'f1x']);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  // Click the tab to select the frame; the arrow keys move it whole.
  await page.mouse.click(...Object.values(await frameAt(h, 'f1', 8, 9)));
  assert.deepEqual(await h.ev(() => sel), { type: 'seq', id: 'f1' });
  const before = await ids(h);
  await page.keyboard.press('ArrowUp');
  assert.equal(await h.ev(() => S.rows.indexOf(S.rows.find(r => r.id === 'f1'))), before.indexOf('f1') - 1);
  assert.equal(await h.ev(() => S.rows.at(-1).id), before[before.indexOf('f1') - 1], 'the row it passed is now below it');
  await page.keyboard.press('Control+z');
  // + Else line goes in at the bottom of the frame, ready to type.
  await h.button('+ Else line'); await page.keyboard.type('timed out'); await page.keyboard.press('Enter');
  const added = await h.ev(() => S.rows[S.rows.findIndex(r => r.id === 'f1x') - 1]);
  assert.deepEqual([added.kind, added.label], ['else', 'timed out']);
  assert.equal(await h.ev(() => document.querySelector('#panel .eyebrow').textContent), 'Else line');
  // Opt removes the else lines, not the rows; Delete removes the frame and keeps what was inside.
  await page.mouse.click(...Object.values(await frameAt(h, 'f1', 8, 9)));
  await h.button('Opt');
  assert.equal(await h.ev(() => S.rows.filter(r => r.kind === 'else').length), 0);
  await page.keyboard.press('Delete');
  assert.deepEqual(await h.ev(() => S.rows.filter(r => r.kind === 'frame').map(r => r.type)), ['loop']);
  assert.equal(await h.ev(() => S.rows.filter(isMsg).length), 13);
  // Exports draw the frame, and it survives a reload.
  const svgText = await h.ev(() => buildExportSvg({ theme: 'light', background: 'white', scope: 'all' }).svg);
  assert.ok(svgText.includes('>loop<') && svgText.includes('[up to 3 tries]'));
  const kept = await h.ev(() => JSON.parse(JSON.stringify(S)));
  await page.reload(); await page.waitForTimeout(300);
  assert.deepStrictEqual(await h.ev(() => JSON.parse(JSON.stringify(S))), kept);
  assert.deepEqual(h.errors, []);
});

test('sequence diagrams export to SVG and PNG, and come back from a saved file unchanged', async () => {
  const h = await open(), { page } = h;
  await seqSampleOn(h);
  const svgText = await h.ev(() => buildExportSvg({ theme: 'light', background: 'white', scope: 'all' }).svg);
  for (const t of ['Payment gateway', '(external)', 'Validate cart', 'mTLS. Can take up to 5 s.', 'Legend'.toUpperCase(), 'Checkout']) assert.ok(svgText.includes(t), `export has ${t}`);
  assert.doesNotMatch(svgText, /foreignObject|var\(--|data-role/);
  assert.equal((svgText.match(/stroke-dasharray="5 4"/g) || []).length, 6, 'one dashed lifeline per participant');
  await page.click('#exportBtn'); await page.click('[data-ex="format"][data-val="png"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-choice="download"]')]);
  assert.match(dl.suggestedFilename(), /\.png$/);
  // Save and reopen.
  const before = await h.ev(() => JSON.parse(JSON.stringify(S)));
  const file = await h.ev(() => serialize());
  await h.ev(() => { doc.dirty = false; return newDiagram(); });
  await page.waitForTimeout(100);
  assert.equal(await h.ev(() => isSeq()), false);
  await dropFile(h, file, 'checkout.snapblade'); await page.waitForTimeout(300);
  assert.deepStrictEqual(await h.ev(() => JSON.parse(JSON.stringify(S))), before);
  assert.equal(await h.ev(() => document.getElementById('addPart').hidden), false);
  assert.deepEqual(h.errors, []);
});

test('a hostile sequence file cannot run script; it opens with what is valid', async () => {
  const pwn = '"><img src=x onerror="window.__pwn=1">';
  const diagram = { type: 'sequence',
    parts: [{ id: 'a', label: pwn, style: { line: pwn } }, { id: 'b' + pwn, label: 'B' }, { id: 'b', label: 'B', kind: pwn }],
    rows: [{ id: 'm', from: 'a', to: 'b', type: pwn, label: pwn }, { id: 'n', kind: 'note', side: pwn, on: ['b', pwn], label: pwn },
      { id: 'x' + pwn, from: 'a', to: 'b' }, { id: 'y', from: 'a', to: pwn },
      { id: 'f', kind: 'frame', type: pwn, label: pwn }, { id: 'e', kind: 'else', label: pwn }, { id: 'z', kind: pwn }] };
  const h = await open(), { page } = h;
  await dropFile(h, JSON.stringify({ format: 'snapblade', version: 1, diagram }), 'hostile.snapblade'); await page.waitForTimeout(300);
  const check = async () => {
    assert.equal(await h.ev(() => window.__pwn), undefined);
    assert.equal(await h.ev(() => document.querySelectorAll('img').length), 0);
    assert.deepEqual(await h.ev(() => [S.parts.map(p => [p.id, p.kind, p.style]), S.rows.map(r => r.id)]), [[['a', 'participant', {}], ['b', 'participant', undefined]], ['m', 'n', 'f', 'e', 'end1']]);
    assert.equal(await h.ev(() => S.rows[2].type), 'alt', 'an unknown frame kind becomes alt');
    assert.deepEqual(await h.ev(() => [S.rows[0].type, S.rows[1].side, S.rows[1].on]), ['sync', 'right', ['b']]);
    assert.ok((await h.ev(() => svg.textContent)).includes(pwn), 'the text is shown as text');
    assert.doesNotMatch(await h.ev(() => buildExportSvg({ theme: 'light', background: 'white', scope: 'all' }).svg), /<img|onerror="/);
    assert.deepEqual(h.errors, []);
  };
  await check();
  await page.reload(); await page.waitForTimeout(300);
  await check();
});

// ---------- tabs ----------
const tabNames = h => h.ev(() => BOOK.pages.map(p => p.name));
const tabAt = (h, i) => h.page.locator(`#tablist [data-tab="${i}"]`);

test('tabs: add, rename, reorder, switch with their own undo and view, delete, and keep them all on reload and in files', async () => {
  const h = await open(), { page } = h;
  assert.deepEqual(await tabNames(h), ['Page 1']);
  assert.equal(await page.locator('#tablist [data-tabdel]').count(), 0, 'the last tab cannot be deleted');
  // A sequence tab right after the open one.
  await page.click('#tabAdd'); await page.click('[data-tabadd="sequence"]');
  assert.deepEqual(await tabNames(h), ['Page 1', 'Sequence 1']);
  assert.equal(await h.ev(() => [isSeq(), BOOK.active].join()), 'true,1');
  await page.click('#addPart'); await page.keyboard.type('Client'); await page.keyboard.press('Enter');
  // Undo is per tab: switching back to the first tab and undoing leaves the sequence alone.
  await tabAt(h, 0).click();
  assert.equal(await h.ev(() => isSeq()), false);
  await h.click('inv'); await page.keyboard.press('Delete');
  await tabAt(h, 1).click();
  assert.equal(await h.ev(() => undoStack.length), 1);
  await page.keyboard.press('Control+z');
  assert.equal(await h.ev(() => S.parts.length), 0, 'undo on this tab undid this tab');
  await page.keyboard.press('Control+y');
  await tabAt(h, 0).click();
  assert.equal(await h.ev(() => !!byId('inv')), false, 'the other tab kept its change');
  await page.keyboard.press('Control+z');
  assert.equal(await h.ev(() => !!byId('inv')), true);
  // Rename: double-click the open tab.
  await tabAt(h, 0).dblclick();
  await page.keyboard.press('Control+a'); await page.keyboard.type('Architecture'); await page.keyboard.press('Enter');
  // Duplicate, then drag the copy to the front.
  await page.click('#tabAdd'); await page.click('[data-tabadd="copy"]');
  assert.deepEqual(await tabNames(h), ['Architecture', 'Architecture copy', 'Sequence 1']);
  const from = await tabAt(h, 1).boundingBox(), to = await tabAt(h, 0).boundingBox();
  await h.drag({ x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: to.x + 4, y: to.y + to.height / 2 });
  assert.deepEqual(await tabNames(h), ['Architecture copy', 'Architecture', 'Sequence 1']);
  assert.equal(await h.ev(() => BOOK.pages[BOOK.active].name), 'Architecture copy', 'the moved tab stays open');
  // The title block's empty title shows the tab's name when there are several.
  assert.ok((await h.ev(() => svg.textContent)).includes('Order platform'));
  await h.ev(() => { S.title.title = ''; render(); });
  assert.ok((await h.ev(() => svg.textContent)).includes('Architecture copy'));
  // Copy and paste between tabs.
  await h.click('users'); await page.keyboard.press('Control+c');
  await tabAt(h, 1).click(); await page.keyboard.press('Control+v');
  assert.equal(await h.ev(() => S.nodes.filter(n => n.label === 'Customers').length), 2);
  // Everything survives a reload, including which tab is open and each tab's own content.
  const before = await h.ev(() => ({ names: BOOK.pages.map(p => p.name), active: BOOK.active, d: JSON.parse(JSON.stringify(bookData())) }));
  await page.reload(); await page.waitForTimeout(300);
  assert.deepStrictEqual(await h.ev(() => ({ names: BOOK.pages.map(p => p.name), active: BOOK.active, d: JSON.parse(JSON.stringify(bookData())) })), before);
  assert.equal(await page.locator('#tablist [data-tab]').count(), 3);
  // And a save and reopen.
  const file = await h.ev(() => serialize());
  await h.ev(() => { doc.dirty = false; return newDiagram(); });
  assert.deepEqual(await tabNames(h), ['Page 1']);
  await dropFile(h, file, 'design.snapblade'); await page.waitForTimeout(300);
  assert.deepStrictEqual(await h.ev(() => JSON.parse(JSON.stringify(bookData()))), before.d);
  // Deleting a tab with something on it asks first; Cancel keeps it.
  await page.click('#tablist [data-tabdel]');
  assert.match(await page.textContent('#modal'), /Delete the tab “Architecture”/);
  await page.click('#modal [data-choice="cancel"]');
  assert.equal(await page.locator('#tablist [data-tab]').count(), 3);
  await page.click('#tablist [data-tabdel]'); await page.click('#modal [data-choice="delete"]');
  assert.deepEqual(await tabNames(h), ['Architecture copy', 'Sequence 1']);
  assert.equal(await h.ev(() => BOOK.active), 0, 'the tab before it opens');
  assert.deepEqual(h.errors, []);
});

test('tabs: export the open tab, or all of them (one PDF page or one file per tab)', { timeout: 60000 }, async () => {
  const h = await open(), { page } = h;
  await h.ev(() => { addTab('sequence'); loadSample(true); switchTab(0); });
  await page.click('#exportBtn');
  assert.equal(await page.isVisible('[data-ex="tabs"]'), true);
  await page.click('[data-ex="format"][data-val="svg"]'); await page.click('[data-ex="tabs"][data-val="all"]');
  assert.match(await page.textContent('#exInfo'), /2 files/);
  const downloads = [];
  page.on('download', d => downloads.push(d.suggestedFilename()));
  await page.click('[data-choice="download"]'); await page.waitForTimeout(800);
  assert.deepEqual(downloads.sort(), ['Untitled diagram - Page 1.svg', 'Untitled diagram - Sequence 1.svg']);
  // A PDF of all tabs has a page per tab.
  const pdf = await h.ev(async () => {
    const { blob } = await exportBlob({ ...exportOpts, format: 'pdf', tabs: 'all' });
    return { pages: ((await blob.text()).match(/\/Type \/Page\b/g) || []).length };
  });
  assert.equal(pdf.pages, 2);
  // The open tab only.
  const one = await h.ev(async () => (await exportSvgs({ ...exportOpts, format: 'svg', tabs: 'current' })).map(x => x.name));
  assert.deepEqual(one, ['Page 1']);
  assert.deepEqual(h.errors, []);
});

test('a hostile tab name is shown as text everywhere', async () => {
  const pwn = '"><img src=x onerror="window.__pwn=1">';
  const file = JSON.stringify({ format: 'snapblade', version: 2, active: 1, pages: [{ name: pwn, diagram: { nodes: [box('a')], edges: [] } }, { name: 'ok', diagram: { nodes: [box('b')], edges: [] } }] });
  const h = await open(), { page } = h;
  await dropFile(h, file, 'tabs.snapblade'); await page.waitForTimeout(300);
  await h.ev(() => { switchTab(0); S.title.show = true; render(); });
  await page.click('#exportBtn'); await page.click('[data-ex="tabs"][data-val="all"]'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await tabAt(h, 0).dblclick(); await page.keyboard.press('Escape');
  assert.equal(await h.ev(() => window.__pwn), undefined);
  assert.equal(await h.ev(() => document.querySelectorAll('img:not(#exPreview)').length), 0);
  assert.equal(await page.textContent('#tablist [data-tab="0"] .tname'), pwn);
  assert.deepEqual(h.errors, []);
});
