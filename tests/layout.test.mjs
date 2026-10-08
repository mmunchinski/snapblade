// Layout engine tests: anchors, routing, bundling and label placement. Run: npm run test:layout
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './lib/core.mjs';

const run = loadCore();
const json = code => JSON.parse(run(`JSON.stringify(${code})`));

test('sample diagram: no connector passes through a box', () => {
  run('S = sample()');
  assert.deepEqual(json('throughBoxes(routesNow().R)'), []);
});

test('a box dropped into a connector path is routed around', () => {
  run(`S = sample(); S.nodes.push({ id: 'blk', kind: 'box', label: 'X', x: 420, y: 310, w: 60, h: 60, parent: null })`);
  assert.deepEqual(json('throughBoxes(routesNow().R)'), []);
  assert.ok(json('routesNow().R.e4').length > 2, 'expected a detour, not a straight line');
});

test('connectors go around containers they do not belong to', () => {
  run(`S = sample(); Object.assign(byId('gw'), { x: 1080, y: 230 })`);
  assert.deepEqual(json('throughBoxes(routesNow().R)'), []);
});

test('bends sit on the midline of the gap between boxes', () => {
  run('S = sample()');
  const R = json('routesNow().R');
  // Load balancer right edge 380, Orders API left edge 520: midline 450.
  assert.equal(R.e3[1].x, 450);
  assert.equal(R.e5[1].x, 450);
});

test('a two-way pair splits evenly around the midline without crossing', () => {
  run(`S = { nodes: [{ id: 'A', kind: 'box', label: 'A', x: 0, y: 0, w: 140, h: 60, parent: null }, { id: 'B', kind: 'box', label: 'B', x: 300, y: 120, w: 140, h: 60, parent: null }],
    edges: [{ id: 'f', from: { node: 'A', side: 'auto' }, to: { node: 'B', side: 'auto' }, arrow: 'end' }, { id: 'r', from: { node: 'B', side: 'auto' }, to: { node: 'A', side: 'auto' }, arrow: 'end' }],
    settings: { mode: 'even', grid: 10, routing: 'ortho' } }`);
  const R = json('routesNow().R');
  const xf = R.f[1].x, xr = R.r[1].x;
  assert.notEqual(xf, xr, 'the two bends should not overlap');
  assert.equal((xf + xr) / 2, 220, 'the pair should be centered on the 220 midline');
  assert.equal(json('crossCount(Object.values(routesNow().R))'), 0);
});

test('a bundle through one gap is centered, evenly spaced and crossing-free', () => {
  run('twoColumns(560)');
  const R = json('routesNow().R');
  const xs = ['a', 'b', 'c', 'd', 'f'].map(id => R[id][1].x).sort((p, q) => p - q);
  assert.deepEqual(xs.map((x, i) => i && x - xs[i - 1]).slice(1), [12, 12, 12, 12], `bends ${xs}`);
  assert.equal((xs[0] + xs[4]) / 2, 640, 'centered halfway between the two columns (380..900)');
  assert.equal(json('crossCount(Object.values(routesNow().R))'), 0);
});

test('dragging a container through every height never produces crossings', () => {
  let total = 0;
  for (let y = 0; y <= 700; y += 10) { run(`twoColumns(${y})`); total += json('crossCount(Object.values(routesNow().R))'); }
  assert.equal(total, 0);
});

test('the busiest side keeps even spacing wherever its partners move', () => {
  const seen = new Set();
  for (let y = 60; y <= 660; y += 100) {
    run(`twoColumns(${y})`);
    const P = json('routesNow().P');
    seen.add(JSON.stringify(['a', 'b', 'c', 'd', 'f'].map(id => (id === 'a' || id === 'c' || id === 'f' ? P[id].to : P[id].from).y)));
  }
  assert.deepEqual([...seen], ['[223,277,330,383,437]']);
});

// Reported 2026-10-07: a firewall and load balancer each with several connectors into one side of an API box.
// Ends were ordered by the other box's center, so a line from a box's top or bottom sorted as if it left
// from the middle, and two L-shaped lines from one bottom into one side were stacked the wrong way round.
for (const mode of ['straighten', 'even']) {
  test(`connectors sharing a side are ordered so they don't cross (${mode})`, () => {
    run(`{ S = sample(); const lb = byId('lb'); lb.parent = null; Object.assign(lb, { x: 240, y: 290 });
      Object.assign(byId('orders'), { x: 525, y: 145 }); Object.assign(byId('inv'), { x: 505, y: 305 });
      Object.assign(byId('pay'), { x: 530, y: 530 }); Object.assign(byId('gw'), { y: 530 });
      const E = (id, a, b, sa = 'auto', sb = 'auto') => ({ id, from: { node: a, side: sa }, to: { node: b, side: sb }, arrow: 'end' });
      S.edges.push(E('wr', 'waf', 'orders'), E('wt', 'waf', 'orders', 'top'), E('wb', 'waf', 'orders', 'bottom', 'bottom'),
        E('b1', 'lb', 'pay', 'bottom'), E('b2', 'lb', 'pay', 'bottom'));
      S.settings.mode = '${mode}'; }`);
    const pairs = json(`(() => { const { R } = routesNow(), ids = Object.keys(R), out = [];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (crossCount([R[ids[i]], R[ids[j]]])) out.push(ids[i] + ' x ' + ids[j]);
      return out; })()`);
    // /orders and the firewall-bottom-to-Orders-bottom line have to cross: that end was pinned to Orders' bottom.
    assert.deepEqual(pairs, ['e3 x wb']);
  });
}

for (const mode of ['start', 'center', 'end']) {
  test(`labels (${mode}): on their own line, clear of boxes, other labels and other lines`, () => {
    for (const setup of ['S = sample()', `twoColumns(190); S.edges.forEach((e, i) => e.label = ['req', 'resp', 'sync', 'ack', 'push'][i] || '')`]) {
      run(setup);
      const problems = json(`(() => {
        S.settings.labelPos = '${mode}';
        const { R } = routesNow(), segs = segmentsOf(R), taken = [], out = [], bad = [];
        for (const e of S.edges) if (e.label) { const lb = placeLabel(e, R[e.id], taken, segs); taken.push({ x: lb.x - 3, y: lb.y - 3, w: lb.w + 6, h: lb.h + 6 }); out.push([e, lb]); }
        for (const [e, lb] of out) {
          for (const n of S.nodes) if (n.kind === 'box' && overlaps(lb, n)) bad.push(e.id + ' on box ' + n.id);
          for (const [f, lc] of out) if (f !== e && e.id < f.id && overlaps(lb, lc)) bad.push(e.id + ' on label ' + f.id);
          for (const l of segs) if (l.id !== e.id && overlaps({ x: lb.x + 1, y: lb.y + 1, w: lb.w - 2, h: lb.h - 2 }, l)) { bad.push(e.id + ' covers ' + l.id); break; }
        }
        return bad;
      })()`);
      assert.deepEqual(problems, []);
    }
  });
}

test('legend finds every style in use and names it readably', () => {
  run('S = sample()');
  assert.deepEqual(json('legendEntries().map(e => [e.key, e.auto, e.count])'), [
    ['box:blue||pair', 'Blue box', 1],
    ['box:green||pair', 'Green box', 2],
    ['box:amber||pair', 'Amber box', 1],
    ['box:|dashed|none', 'Dashed box, no fill', 1],
    ['connector:|dashed', 'Dashed connector', 1],
  ]);
  run(`byId('inv').style = { line: '#ff8000', dash: 'dotted', fill: '#ffffff' }`);
  assert.ok(json('legendEntries().map(e => e.auto)').includes('#FF8000 dotted box, #FFFFFF fill'));
});

test('title block and legend never overlap the diagram or each other, in any corners', () => {
  const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  for (const a of corners) for (const b of corners) {
    run(`S = sample(); S.legend.pos = '${a}'; S.title.pos = '${b}'`);
    const r = json(`(() => {
      const { R } = routesNow(), B = contentBounds(S.nodes, S.edges, R, {});
      const blocks = annotationLayout(B, 'sans-serif', 'Diagram');
      const hit = (p, q) => p.x < q.x2 && q.x1 < p.x + p.w && p.y < q.y2 && q.y1 < p.y + p.h;
      return { onContent: blocks.some(k => hit(k, B)), onEach: overlaps(blocks[0], blocks[1]), same: blocks[0].w === blocks[1].w };
    })()`);
    assert.equal(r.onContent, false, `${a}/${b}: a block overlaps the diagram`);
    assert.equal(r.onEach, false, `${a}/${b}: the blocks overlap`);
    if (a === b) assert.ok(r.same, `${a}: blocks sharing a corner should share a width`);
  }
});

// ---------- untrusted input ----------
// Files and the saved copy pass through normalize(); these pin what it must not let through.
const box = (id, o = {}) => ({ id, kind: 'box', label: id, x: 0, y: 0, w: 120, h: 60, parent: null, ...o });
const link = (id, a, b, o = {}) => ({ id, from: { node: a, side: 'auto' }, to: { node: b, side: 'auto' }, arrow: 'end', ...o });

test('normalize keeps ids unique, so a container loop cannot hide behind a duplicate', () => {
  run(`S = normalize(${JSON.stringify({ nodes: [box('a', { parent: 'b' }), box('b', { parent: 'a' }), box('a', { label: 'second a' }), box('b')],
    edges: [link('e', 'a', 'b'), link('e', 'b', 'a')] })})`);
  assert.deepEqual(json('S.nodes.map(n => [n.id, n.label])'), [['a', 'a'], ['b', 'b']], 'the first shape with an id wins');
  assert.deepEqual(json('S.edges.map(e => [e.id, e.from.node])'), [['e', 'a']], 'the first connector with an id wins');
  assert.equal(json('S.nodes.filter(n => n.parent).length'), 1, 'the loop is broken');
  assert.deepEqual(json('S.nodes.map(depth)').sort(), [0, 1]);
});

test('ids that are also built-in property names behave like any other id', () => {
  const core = loadCore();   // its own sandbox: a failure here must not leak into the other tests
  core(`S = normalize(${JSON.stringify({ nodes: [box('__proto__'), box('constructor', { x: 400 }), box('toString', { x: 400, y: 200 })],
    edges: [link('__proto__', '__proto__', 'constructor', { label: 'one' }), link('constructor', 'constructor', 'toString'), link('hasOwnProperty', '__proto__', 'toString')] })})`);
  const r = JSON.parse(core(`JSON.stringify((() => {
    const { P, R } = routesNow(), segs = routeSegments(R);
    return { routed: S.edges.map(e => R[e.id].length >= 2 && !!P[e.id].from && !!P[e.id].to), segs: segs.length > 0,
      label: !!placeLabel(S.edges[0], R[S.edges[0].id], [], segs),
      leaked: [({}).from, ({}).to, Object.from, Object.to].filter(v => v !== undefined).length };
  })())`));
  assert.deepEqual(r, { routed: [true, true, true], segs: true, label: true, leaked: 0 });
});

test('normalize bounds positions and sizes, and takes only strings as colors', () => {
  run(`S = normalize(${JSON.stringify({ nodes: [
    box('a', { x: -1e308, y: 1e308, w: 1e308, h: 5e9, style: { line: ['#ff0000'], fill: [['#00ff00']], dash: ['dashed'], tint: 20 } }),
    { id: 'g', kind: 'group', label: 'g', x: 0, y: 0, w: 200, h: 100, parent: null, layout: 'row', pad: -1e9, gap: 1e300 }], edges: [] })})`);
  assert.deepEqual(json(`[byId('a').x, byId('a').y, byId('a').w, byId('a').h, byId('a').style, byId('g').pad, byId('g').gap]`),
    [-1e6, 1e6, 1e5, 1e5, { tint: 20 }, 0, 1000]);
  // Shapes as far apart as a file can put them: the connector between them still gets its label.
  run(`S = normalize(${JSON.stringify({ nodes: [box('a', { x: -1e308 }), box('b', { x: 1e308 })], edges: [link('e', 'a', 'b', { label: 'far' })] })})`);
  assert.ok(json(`(() => { const { R } = routesNow(); return placeLabel(S.edges[0], R.e, [], []); })()`));
});

// ---------- round trip ----------
// The other side of normalize(): it must keep everything the app can set. Every value comes from the
// lists the panels draw their controls from, so a new option is covered as soon as it is added there.
// (A new field still needs adding here; the browser test "every control in every panel..." walks the
// controls themselves and catches that too.)
test('every option the panels offer survives a reload and a file round trip', () => {
  const trips = json(`(() => {
    const trips = [], trip = what => trips.push([what, JSON.parse(JSON.stringify(S)), normalize(JSON.parse(JSON.stringify(S))), parseDiagram(serialize())]);
    const box = (id, o) => ({ id, kind: 'box', label: id, x: 0, y: 0, w: 120, h: 60, parent: null, ...o });
    S = normalize(sample());
    let i = 0;
    for (const line of [...PRESETS, '#3a7bd5']) for (const fill of ['pair', 'none', '#2a9d8f']) for (const [dash] of DASHES)
      S.nodes.push(box('s' + i++, { x: i * 10, y: 900, style: { line, fill, tint: 31, dash } }));
    for (const [layout] of LAYOUTS) for (const [align] of ALIGNS)
      S.nodes.push({ id: 'g' + i++, kind: 'group', label: 'g', x: i * 10, y: 1200, w: 200, h: 100, parent: null, layout, align, pad: 7, gap: 11 },
        box('k' + i++, { parent: 'g' + (i - 2), x: 0, y: 1200, w: 90.5, h: 47 }));
    for (const from of SIDE_OPTS) for (const to of SIDE_OPTS) for (const [arrow] of ARROWS)
      S.edges.push({ id: 'c' + i++, from: { node: 's0', side: from }, to: { node: 's1', side: to }, arrow, label: from + to, style: { line: 'teal', dash: 'dotted' } });
    for (const labelPos of LABEL_POS) for (const side of SIDES)
      S.edges.push({ id: 'c' + i++, from: { node: 's2', side: 'auto' }, to: { node: 's3', side }, arrow: 'end', labelPos, fixed: { from: { side, frac: 0.25 }, to: { side, frac: 1 } } });
    S.title = { show: true, title: 'Order platform', version: '2.1', date: '2026-10-04', author: 'A. Architect', pos: 'top-left' };
    S.legend = { show: true, heading: 'Key', pos: 'top-right', labels: { 'box:teal||pair31': 'Service' }, hidden: ['connector:teal|dotted'] };
    trip('shapes, connectors, title block and legend');
    for (const [pos] of CORNERS) { S.title.pos = pos; S.legend.pos = pos; trip('corner ' + pos); }
    S.title.show = S.legend.show = false; trip('blocks hidden');
    const settings = { mode: Object.keys(MODES), grid: valuesOf(GRIDS), routing: valuesOf(ROUTINGS), labelPos: LABEL_POS, radius: [0, 9, 16], showSlots: [false, true], walls: [false, true] };
    for (const k in settings) for (const v of settings[k]) { S.settings[k] = v; trip('settings.' + k + ' = ' + v); }
    return trips;
  })()`);
  assert.ok(trips.length > 20);
  for (const [what, now, reloaded, reopened] of trips) {
    assert.deepStrictEqual(reloaded, now, `${what}: a reload changes the diagram`);
    assert.deepStrictEqual(reopened, now, `${what}: saving and reopening changes the diagram`);
  }
});

// Arrange: Row/Column line-up, spacing and Straighten.
run(`function flat(boxes, edges = [], mode = 'even') {
  S = normalize({ nodes: boxes.map(([id, x, y, w, h]) => ({ id, kind: 'box', label: id, x, y, w, h, parent: null })),
    edges: edges.map(([a, b], i) => ({ id: 'e' + i, from: { node: a, side: 'auto' }, to: { node: b, side: 'auto' }, arrow: 'end' })),
    settings: { mode } });
}
const at = (...ids) => ids.map(id => { const n = byId(id); return [n.x, n.y]; });
const box4 = id => { const n = byId(id); return [n.x, n.y, n.w, n.h]; };`);

test('Row lines up with the first pick, keeps the order, and Keep only pushes apart shapes that would touch', () => {
  run(`flat([['a', 0, 0, 100, 50], ['b', 200, 40, 120, 60], ['c', 150, 100, 80, 40]])`);
  assert.equal(json(`lineUp(['a', 'b', 'c'], 'middle', { mode: 'keep' }).moved`), 2);
  assert.deepEqual(json(`at('a', 'c', 'b')`), [[0, 0], [150, 5], [250, -5]]);
});

test('Even keeps the outer shapes and makes the gaps between them equal', () => {
  run(`flat([['a', 0, 0, 100, 50], ['b', 30, 120, 60, 40], ['c', 10, 400, 80, 60]])`);
  run(`lineUp(['a', 'b', 'c'], 'center', { mode: 'even' })`);
  assert.deepEqual(json(`at('a', 'b', 'c')`), [[0, 0], [20, 205], [10, 400]]);
});

test('Fixed packs shapes the given gap apart, from the first one in line', () => {
  run(`flat([['a', 300, 0, 100, 50], ['b', 0, 20, 100, 50]])`);
  run(`lineUp(['a', 'b'], 'top', { mode: 'fixed', gap: 40 })`);
  assert.deepEqual(json(`at('b', 'a')`), [[0, 0], [140, 0]]);
});

test('lining up never stacks shapes: Lefts on two shapes side by side makes a column', () => {
  run(`flat([['a', 0, 0, 100, 50], ['b', 200, 0, 100, 50]])`);
  run(`lineUp(['a', 'b'], 'left', { mode: 'keep' })`);
  assert.deepEqual(json(`at('a', 'b')`), [[0, 0], [0, 70]]);
  assert.equal(json(`lineUp(['a', 'b'], 'left', { mode: 'keep' }).moved`), 0, 'already lined up');
});

test('Arrange leaves shapes placed by a row or column container alone', () => {
  run(`S = normalize(sample()); layoutAll()`);
  const data = json(`at('odb', 'idb')`);
  assert.equal(json(`lineUp(['odb', 'idb'], 'left', { mode: 'keep' }).moved`), 0);
  run(`byId('pay').x = 540`);
  assert.equal(json(`lineUp(['orders', 'odb', 'pay'], 'center', { mode: 'keep' }).skipped`), 1);
  assert.deepEqual(json(`at('odb', 'idb')`), data);
  assert.equal(json(`center(byId('pay')).x`), json(`center(byId('orders')).x`));
});

test('a selected container moves with its contents, and they move once', () => {
  run(`S = normalize(sample()); layoutAll()`);
  const [app0, orders0] = json(`[box4('app'), box4('orders')]`);
  run(`lineUp(['gw', 'app'], 'bottom', { mode: 'keep' }); layoutAll()`);
  const [app1, orders1, gw] = json(`[box4('app'), box4('orders'), box4('gw')]`);
  assert.equal(app1[1] + app1[3], gw[1] + gw[3], 'container bottom on the gateway bottom');
  assert.equal(orders1[1] - app1[1], orders0[1] - app0[1], 'contents keep their place in the container');
  assert.equal(orders1[0], orders0[0]);
});

test('container picked first: shapes line up inside it, and the container stays put', () => {
  run(`S = normalize(sample()); byId('pay').x = 540; byId('inv').x = 505; layoutAll()`);
  const app = json(`box4('app')`), pad = json(`byId('app').pad`), header = json('HEADER');
  run(`lineUp(['app', 'orders', 'inv', 'pay'], 'center', { mode: 'keep' }); layoutAll()`);
  assert.deepEqual(json(`box4('app')`), app);
  for (const cx of json(`['orders', 'inv', 'pay'].map(id => center(byId(id)).x)`)) assert.ok(Math.abs(cx - (app[0] + app[2] / 2)) <= 0.5, `centered: ${cx}`);

  run(`lineUp(['app', 'orders', 'inv', 'pay'], 'left', { mode: 'even' }); layoutAll()`);
  const [o, i, p] = json(`[box4('orders'), box4('inv'), box4('pay')]`);
  assert.equal(o[0], app[0] + pad);
  assert.equal(o[1], app[1] + header + pad, 'first one at the top of the inner area');
  assert.equal(p[1] + p[3], app[1] + app[3] - pad, 'last one at the bottom of the inner area');
  assert.equal(i[1] - (o[1] + o[3]), p[1] - (i[1] + i[3]), 'equal gaps');

  run(`lineUp(['app', 'inv'], 'right', { mode: 'keep' })`);
  assert.equal(json(`byId('inv').x + byId('inv').w`), app[0] + app[2] - pad, 'one shape is enough');
  assert.deepEqual(json(`box4('app')`), app);
});

test('Straighten moves one shape just enough that its connectors run straight', () => {
  run(`S = normalize(sample()); byId('users').y = 260; layoutAll()`);
  const waf = json(`box4('waf')`), x = json(`byId('users').x`);
  assert.equal(json(`straighten(['users']).moved`), 1);
  const P = json('routesNow().P');
  assert.equal(P.e1.from.y, P.e1.to.y);
  assert.deepEqual(json(`box4('waf')`), waf, 'the partner stays put');
  assert.equal(json(`byId('users').x`), x, 'moves on one axis only');
  assert.equal(json(`straighten(['users']).moved`), 0, 'already straight');
});

test('Straighten with several shapes: the first pick stays put and the others follow', () => {
  run(`flat([['a', 0, 0, 100, 50], ['b', 200, 60, 100, 50], ['c', 400, -50, 100, 50]], [['a', 'b'], ['b', 'c']])`);
  assert.equal(json(`straighten(['a', 'b', 'c']).moved`), 2);
  assert.deepEqual(json(`at('a', 'b', 'c')`), [[0, 0], [200, 0], [400, 0]]);
});

test('Straighten never moves a shape onto another one', () => {
  run(`flat([['a', 0, 0, 100, 50], ['b', 200, 100, 100, 50], ['x', 200, 0, 100, 50]], [['a', 'b']])`);
  assert.equal(json(`straighten(['b']).moved`), 0);
  assert.deepEqual(json(`at('b')`), [[200, 100]]);
});

test('Straighten follows Visio-style pins in that anchor mode', () => {
  run(`flat([['a', 0, 0, 100, 50], ['b', 200, 60, 100, 80]], [['a', 'b']], 'fixed');
    S.edges[0].fixed = { from: { side: 'right', frac: 0.2 }, to: { side: 'left', frac: 0.5 } }`);
  run(`straighten(['b'])`);
  const P = json('computePorts()');
  assert.equal(P.e0.from.y, P.e0.to.y);
  assert.equal(P.e0.from.y, 10);
});

// ---------- hard walls ----------
// With settings.walls on, shapes beside each other keep 20 px apart: a move stops at the wall, a resize stops
// at it, and a container that grows pushes its neighbors out of the way. Overlaps a file already has stay put.
test('a moved shape stops 20 px from a neighbor, slides along it, and goes past once the spot is free', () => {
  run(`flat([['a', 0, 0, 100, 50], ['b', 200, 0, 100, 50]])`);
  assert.deepEqual(json(`wallOffset([byId('a')], 150, 0)`), { x: 80, y: 0 }, 'stops with a 20 px gap');
  assert.deepEqual(json(`wallOffset([byId('a')], 150, 30)`), { x: 80, y: 30 }, 'slides along the wall');
  assert.deepEqual(json(`wallOffset([byId('a')], 280, 0)`), { x: 80, y: 0 }, 'still behind the wall');
  assert.deepEqual(json(`wallOffset([byId('a')], 330, 0)`), { x: 330, y: 0 }, 'past it: no wall');
  assert.deepEqual(json(`wallOffset([byId('a')], 200, 70)`), { x: 200, y: 70 }, 'below it: no wall');
  run(`S.settings.walls = false`);
  assert.deepEqual(json(`wallOffset([byId('a')], 150, 0)`), { x: 150, y: 0 }, 'walls off');
});

test('walls apply between shapes in the same container, not between a container and what it holds', () => {
  run(`S = normalize({ nodes: [{ id: 'g', kind: 'group', label: 'g', x: 0, y: 0, w: 400, h: 200, parent: null, layout: 'free', align: 'center', pad: 20, gap: 30 },
    { id: 'a', kind: 'box', label: 'a', x: 20, y: 50, w: 100, h: 50, parent: 'g' }, { id: 'b', kind: 'box', label: 'b', x: 250, y: 50, w: 100, h: 50, parent: 'g' },
    { id: 'out', kind: 'box', label: 'out', x: 600, y: 50, w: 100, h: 50, parent: null }], edges: [] }); layoutAll(false)`);
  assert.deepEqual(json(`wallOffset([byId('a')], 200, 0)`), { x: 110, y: 0 }, 'a stops 20 px short of b');
  assert.deepEqual(json(`wallOffset([byId('a')], -15, 0)`), { x: -15, y: 0 }, 'the container edge is not a wall');
  // Dragged out onto the canvas: the container itself is now a neighbor.
  assert.deepEqual(json(`wallOffset([byId('a')], 0, 230, () => null)`), { x: 0, y: 230 });
  assert.deepEqual(json(`wallOffset([byId('a')], 0, 160, () => null)`), { x: 0, y: 170 }, 'stops 20 px below the container');
});

test('a resized edge stops 20 px from a neighbor', () => {
  run(`flat([['a', 0, 0, 100, 50], ['b', 200, 0, 100, 50], ['c', 0, 200, 100, 50]])`);
  const r = (w, h, dir) => json(`wallResize(byId('a'), { x: 0, y: 0, w: ${w}, h: ${h} }, '${dir}')`);
  assert.deepEqual(r(250, 50, 'e'), { x: 0, y: 0, w: 180, h: 50 });
  assert.deepEqual(r(100, 250, 's'), { x: 0, y: 0, w: 100, h: 180 });
  assert.deepEqual(r(250, 120, 'se'), { x: 0, y: 0, w: 180, h: 120 }, 'b only blocks the width');
  assert.deepEqual(r(150, 150, 'se'), { x: 0, y: 0, w: 150, h: 150 }, 'room to grow');
});

test('a container that grows pushes the shapes it would crowd, and they push the next ones', () => {
  const setup = walls => run(`S = normalize({ nodes: [
      { id: 'g', kind: 'group', label: 'g', x: 0, y: 0, w: 100, h: 100, parent: null, layout: 'column', align: 'center', pad: 20, gap: 30 },
      { id: 'k1', kind: 'box', label: 'k1', x: 0, y: 0, w: 120, h: 60, parent: 'g' },
      { id: 'u', kind: 'box', label: 'u', x: 20, y: 170, w: 120, h: 60, parent: null },
      { id: 'v', kind: 'box', label: 'v', x: 20, y: 250, w: 120, h: 60, parent: null },
      { id: 'side', kind: 'box', label: 'side', x: 200, y: 100, w: 100, h: 60, parent: null },
      { id: 'old', kind: 'box', label: 'old', x: 165, y: 0, w: 30, h: 30, parent: null }],
    edges: [], settings: { walls: ${walls} } }); layoutAll(false)`);
  setup(true);
  assert.deepEqual(json(`box4('g')`), [0, 0, 160, 130]);
  run(`S.nodes.push({ id: 'k2', kind: 'box', label: 'k2', x: 0, y: 0, w: 120, h: 60, parent: 'g' }); layoutAll()`);
  assert.deepEqual(json(`box4('g')`), [0, 0, 160, 220], 'the column grew');
  assert.deepEqual(json(`at('u', 'v', 'side', 'old')`), [[20, 240], [20, 320], [200, 100], [165, 0]],
    'u pushed 20 px below it, v below u; the shape beside it and the one already crowding it stay put');
  setup(false);
  run(`S.nodes.push({ id: 'k2', kind: 'box', label: 'k2', x: 0, y: 0, w: 120, h: 60, parent: 'g' }); layoutAll()`);
  assert.deepEqual(json(`at('u', 'v')`), [[20, 170], [20, 250]], 'walls off: nothing pushed');
});

test('a pasted copy goes to the first free spot below the original', () => {
  run(`flat([['a', 0, 0, 100, 50], ['b', 0, 90, 100, 50]])`);
  // Right below a is only 40 px: not enough for a 50 px copy and two 20 px gaps. Below b is.
  run(`S.nodes.push({ id: 'c', kind: 'box', label: 'c', x: 0, y: 0, w: 100, h: 50, parent: null })`);
  assert.deepEqual(json(`belowFree([byId('c')])`), { x: 0, y: 160 });
});
