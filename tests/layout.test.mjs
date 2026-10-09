// Layout engine tests: anchors, routing, bundling and label placement. Run: npm run test:layout
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    const settings = { mode: Object.keys(MODES), grid: valuesOf(GRIDS), routing: valuesOf(ROUTINGS), labelPos: LABEL_POS, radius: [0, 9, 16], showSlots: [false, true], walls: [false, true],
      autonumber: [true, false], footbox: [false, true], activation: [false, true] };
    for (const k in settings) for (const v of settings[k]) { S.settings[k] = v; trip('settings.' + k + ' = ' + v); }
    S = normalize(seqSample());
    for (const [type] of FRAME_TYPES) { seqWrap('m1', 'm2', type, type + ' label'); if (BRANCHED.includes(type)) seqAddElse(S.rows[0].id); }
    for (const [kind] of BREAKS) S.rows.push({ id: 'b-' + kind, kind, label: kind });
    for (const [head] of HEADS) S.parts.push({ id: 'h-' + head, kind: 'participant', label: head, ...(head === 'box' ? {} : { head }) });
    S.groups.push({ id: 'grp1', kind: 'group', label: 'Grouped', parts: ['h-actor', 'h-database'], style: { line: 'violet', dash: 'dashed' } });
    for (const [t] of MSG_TYPES) for (const [side] of NOTE_SIDES) S.rows.push({ id: 'r' + i++, from: 'web', to: 'orders', type: t, label: t }, { id: 'r' + i++, kind: 'note', side, on: ['web'], label: side });
    trip('a sequence diagram with every kind of head, frame, message, note, divider and delay, and a group');
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

// ---------- dropping a connector end ----------
// Near an edge (a quarter of the width or height, at most 24 px, or just outside it) pins that side;
// the middle leaves the side to auto.
test('where a connector end is dropped on a shape picks its side, or auto in the middle', () => {
  run(`flat([['a', 0, 0, 140, 60]])`);
  const zone = (x, y) => json(`dropSide(byId('a'), { x: ${x}, y: ${y} })`);
  assert.deepEqual([zone(5, 30), zone(135, 30), zone(70, 5), zone(70, 56)], ['left', 'right', 'top', 'bottom']);
  assert.deepEqual([zone(70, 30), zone(30, 30), zone(110, 40)], ['auto', 'auto', 'auto'], 'bands are at most 24 px wide');
  assert.equal(zone(70, 14), 'top', 'a 60 px tall box has 15 px bands');
  assert.equal(zone(70, 16), 'auto');
  assert.deepEqual([zone(3, 5), zone(8, 2)], ['left', 'top'], 'in a corner the nearer edge wins');
  assert.deepEqual([zone(-6, 30), zone(70, 66)], ['left', 'bottom'], 'just outside an edge counts');
});

test('attaching an end pins the dropped side or sets auto, and glues a Visio-style point', () => {
  run(`flat([['a', 0, 0, 140, 60], ['b', 300, 0, 140, 60]], [['a', 'b']])`);
  run(`attachEnd(S.edges[0], 'to', byId('b'), { x: 305, y: 30 })`);
  assert.deepEqual(json('S.edges[0].to'), { node: 'b', side: 'left' });
  run(`attachEnd(S.edges[0], 'to', byId('b'), { x: 370, y: 30 })`);
  assert.deepEqual(json('S.edges[0].to'), { node: 'b', side: 'auto' });
  run(`S.settings.mode = 'fixed'; S.edges[0].fixed = { from: { side: 'right', frac: 0.5 }, to: { side: 'left', frac: 0.5 } }`);
  run(`attachEnd(S.edges[0], 'to', byId('b'), { x: 335, y: 4 })`);
  assert.deepEqual(json('[S.edges[0].to, S.edges[0].fixed.to]'), [{ node: 'b', side: 'top' }, { side: 'top', frac: 0.25 }]);
  run(`attachEnd(S.edges[0], 'to', byId('b'), { x: 370, y: 30 })`);
  assert.deepEqual(json('[S.edges[0].to, S.edges[0].fixed.to]'), [{ node: 'b', side: 'auto' }, { side: 'left', frac: 0.5 }],
    'auto in Visio-style mode glues to the middle of the side auto picks');
});

// ---------- instructions for AI agents (llms.txt) ----------
test('llms.txt is the current agent instructions (run npm run docs after changing them)', () => {
  const file = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');
  assert.ok(file === json('agentSpec()'), 'llms.txt is out of date: run npm run docs');
});

test('the agent instructions\' examples open unchanged', () => {
  const examples = [...json('agentSpec()').matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.equal(examples.length, 2, 'a box diagram and a sequence diagram');
  for (const example of examples) {
    const file = JSON.parse(example), d = file.diagram.type ? { nodes: [], edges: [], ...file.diagram } : file.diagram;   // a sequence diagram leaves out nodes and edges
    assert.deepStrictEqual(json(`parseDiagram(${JSON.stringify(example)})`), d);
  }
});

test('the agent instructions name every field a diagram can keep', () => {
  const spec = json('agentSpec()').replace(/```json[\s\S]*?```/g, '');   // the examples would mention them all anyway
  // Everything normalize() keeps, from a diagram that uses every kind of field.
  const keys = json(`(() => {
    const d = normalize({ nodes: [
        { id: 'g', kind: 'group', label: 'g', x: 0, y: 0, w: 200, h: 100, parent: null, layout: 'row', align: 'start', pad: 5, gap: 5, style: { line: 'blue', fill: 'pair', tint: 30, dash: 'dashed' } },
        { id: 'b', kind: 'box', label: 'b', x: 0, y: 0, w: 120, h: 60, parent: 'g', style: { line: '#123456', fill: 'none', dash: 'dotted' } }],
      edges: [{ id: 'e', from: { node: 'g', side: 'auto' }, to: { node: 'b', side: 'left' }, arrow: 'both', label: 'x', labelPos: 'end', style: { line: 'red', dash: 'dashed' },
        fixed: { from: { side: 'top', frac: 0.5 }, to: { side: 'left', frac: 0.2 } } }],
      settings: sample().settings, title: sample().title, legend: { ...sample().legend, hidden: ['box:blue||pair'] } });
    const keys = new Set(), walk = (o, skip) => { if (Array.isArray(o)) o.forEach(v => walk(v)); else if (o && typeof o === 'object') for (const k in o) { if (!skip) keys.add(k); walk(o[k], k === 'labels'); } };
    walk({ format: 1, version: 1, diagram: d });
    walk({ pages: [{ name: 'x', diagram: {} }], active: 0 });
    walk(normalize({ type: 'sequence', parts: [{ id: 'a', label: 'A', style: { line: 'blue' } }],
      rows: [{ id: 'm', from: 'a', to: 'a', type: 'reply', label: 'x', style: { dash: 'dotted' } }, { id: 'n', kind: 'note', side: 'over', on: ['a'], label: 'n' },
        { id: 'f', kind: 'frame', type: 'alt', label: 'ok' }, { id: 'e', kind: 'else', label: 'no' }, { id: 'x', kind: 'end' }] }));
    return [...keys];
  })()`);
  assert.ok(keys.length > 35, `found ${keys.length} fields`);
  const missing = keys.filter(k => !spec.includes('`' + k + '`') && !spec.includes('"' + k + '"'));
  assert.deepEqual(missing, [], 'fields the instructions never mention');
});

// ---------- sequence diagrams ----------
// Nothing in a sequence diagram has a position: these pin that the layout always leaves room for what's drawn.
test('sequence: columns make room for every head, label and note, and rows never overlap', () => {
  run(`S = normalize(seqSample()); S.rows.push(
    { id: 'wide', from: 'cust', to: 'web', type: 'sync', label: 'a very long message label that needs a wider gap than the heads' },
    { id: 'far', from: 'cust', to: 'bus', type: 'async', label: 'x' },
    { id: 'self2', from: 'web', to: 'web', type: 'sync', label: 'a self-message with a long label' },
    { id: 'nl', kind: 'note', side: 'left', on: ['orders'], label: 'a note to the left of Orders API' },
    { id: 'nr', kind: 'note', side: 'right', on: ['cust'], label: 'a note right of the customer' },
    { id: 'no', kind: 'note', side: 'over', on: ['pay'], label: 'a wide note over Payments API only' })`);
  const L = json(`(() => { const L = seqLayout(); return { ...L, R: L.R.map(g => ({ ...g, r: g.r.id, tw: g.ls?.length ? Math.max(...g.ls.map(t => textWidth(t))) : 0 })) }; })()`);
  const x = Object.fromEntries(L.P.map(q => [q.id, q]));
  L.P.slice(1).forEach((q, i) => assert.ok(q.x - q.w / 2 >= L.P[i].x + L.P[i].w / 2 + 40, `heads ${L.P[i].id} and ${q.id} keep 40 px apart`));
  for (const g of L.R) {
    const next = L.R[L.R.indexOf(g) + 1];
    if (next) assert.ok(next.y >= g.y + g.h + 14, `row ${next.r} starts below ${g.r}`);
    if (g.mark) continue;
    if (g.note) {
      // A note crosses no lifeline except the ones it is on (or spans).
      for (const [i, q] of L.P.entries()) if (i < g.a || i > g.b) assert.ok(q.x < g.x || q.x > g.x + g.w, `note ${g.r} clear of ${q.id}`);
    } else if (g.self) assert.ok(!L.P[g.a + 1] || L.P[g.a + 1].x > g.x1 + 36 + 8 + g.tw, `self-message ${g.r} label clear of the next lifeline`);
    else assert.ok(Math.abs(g.x2 - g.x1) >= g.tw + 24, `label of ${g.r} fits between its lifelines`);
  }
  assert.ok(L.bounds.x1 <= Math.min(...L.R.filter(g => g.note).map(g => g.x)), 'bounds hold the notes');
  const pad = json('SEQ.groupPad');   // the sample's group runs a margin past the bottom heads
  assert.equal(L.bounds.y2, L.end + L.H - L.G + pad, 'participants at the bottom too');
  run('S.settings.footbox = false');
  assert.equal(json('seqLayout().bounds.y2'), json('seqLayout().end') + pad);
});

test('sequence heads: actor, database and queue heads sit on their lifelines; a box head stays out of the file', () => {
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a', label: 'Customer', head: 'actor' }, { id: 'b', label: 'Orders', head: 'database' },
    { id: 'c', label: 'Events', head: 'queue' }, { id: 'd', label: 'Events', head: 'box' }, { id: 'e', label: 'X', head: '<svg onload=1>' }],
    rows: [{ id: 'm', from: 'a', to: 'b', label: 'hi' }] })`);
  assert.deepEqual(json('S.parts.map(p => p.head || null)'), ['actor', 'database', 'queue', null, null], 'box and anything unknown are left out');
  const L = json('(() => { const L = seqLayout(); return { H: L.H, P: L.P.map(q => ({ id: q.id, head: q.head, w: q.w, hh: q.hh, top: q.top })) }; })()');
  const q = Object.fromEntries(L.P.map(o => [o.id, o]));
  assert.deepEqual(['b', 'c', 'd', 'e'].map(id => q[id].hh), Array(4).fill(json('SEQ.headH')), 'box, database and queue heads share the box height');
  assert.ok(q.a.hh > q.d.hh, 'the actor (figure and name) is taller');
  assert.equal(L.H, q.a.hh, 'lifelines start below the tallest head');
  for (const o of L.P) assert.equal(o.top + o.hh, L.H, `${o.id} sits on its lifeline`);
  assert.ok(q.c.w > q.d.w || q.d.w === json('SEQ.minW') && q.c.w >= q.d.w, 'a queue makes room for its round end');
  // Drawn: one figure per actor head (two with participants at the bottom too), cylinders as arcs.
  const draw = json(`seqMarkup(seqLayout(), new Proxy({}, { get: () => () => '' }))`);
  assert.equal((draw.match(/<circle/g) || []).length, 2);
  assert.ok((draw.match(/ A[\d.]+,[\d.]+ 0 0 1 /g) || []).length >= 4, 'database and queue are drawn round');
  run('S.settings.footbox = false');
  assert.equal((json(`seqMarkup(seqLayout(), new Proxy({}, { get: () => () => '' }))`).match(/<circle/g) || []).length, 1);
  // A diagram of boxes keeps the head row it had.
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', head: 'database' }], rows: [] })`);
  assert.equal(json('seqLayout().H'), json('SEQ.headH'));
});

test('sequence dividers and delays: rows across the whole diagram; a delay dots the lifelines; frames and bars ignore them', () => {
  run(`S = normalize(seqSample());
    S.rows.splice(3, 0, { id: 'dv', kind: 'divider', label: 'Payment' });
    S.rows.splice(S.rows.findIndex(r => r.id === 'm7'), 0, { id: 'dl', kind: 'delay', label: 'up to 5 s later' }, { id: 'd0', kind: 'delay', label: '' });
    S = normalize(JSON.parse(JSON.stringify(S)))`);
  assert.deepEqual(json(`['dv', 'dl', 'd0'].map(id => S.rows.find(r => r.id === id))`),
    [{ id: 'dv', kind: 'divider', label: 'Payment' }, { id: 'dl', kind: 'delay', label: 'up to 5 s later' }, { id: 'd0', kind: 'delay', label: '' }], 'kept by normalize');
  const L = json(`(() => { const L = seqLayout(); return { bounds: L.bounds, P: L.P.map(q => q.x), R: L.R.map(g => ({ id: g.r.id, y: g.y, h: g.h, brk: g.brk, cx: g.cx, lw: g.lw })) }; })()`);
  const g = Object.fromEntries(L.R.map(o => [o.id, o]));
  assert.equal(g.dv.brk, 'divider'); assert.equal(g.dl.brk, 'delay');
  const mid = (L.P[0] + L.P.at(-1)) / 2;
  assert.equal(g.dv.cx, mid, 'labels center on the participants');
  assert.ok(g.dl.h >= json('SEQ.delayH') && g.d0.h >= json('SEQ.delayH'), 'a delay leaves a gap, labeled or not');
  for (const [i, o] of L.R.entries()) if (L.R[i + 1]) assert.ok(L.R[i + 1].y >= o.y + o.h + 14, `${L.R[i + 1].id} starts below ${o.id}`);
  // Frames still find their columns (the delay inside the alt frame doesn't touch a lifeline), and bars carry on through a delay.
  assert.equal(json(`seqLayout().R.find(g => g.r.id === 'f1').x1 < seqLayout().P[0].x`), true, 'the alt frame still covers Customer');
  const bars = rows => json(`(rows => seqActivations(rows).map(b => [rows[b.i].id, rows[b.end].id, b.p, b.level]))(${rows})`);
  assert.deepEqual(bars('S.rows'), bars(`S.rows.filter(r => r.kind !== 'divider' && r.kind !== 'delay')`), 'activation bars ignore dividers and delays');
  // Drawn: the divider's two lines run edge to edge; a delay turns every lifeline dotted for its stretch.
  run(`globalThis.marks = []; seqMarkup(seqLayout(), new Proxy({}, { get: (_, k) => (...a) => { if (k === 'life') marks.push(a[1] ? 'wait' : 'line'); return ''; } }))`);
  assert.equal(json('marks.filter(m => m === "wait").length'), 2 * json('S.parts.length'), 'one dotted stretch per lifeline per delay');
  run(`globalThis.acts = []; seqMarkup(seqLayout(), new Proxy({}, { get: (_, k) => (...a) => { if (k === 'act') acts.push(!!a[1]); return ''; } }))`);
  assert.ok(json('acts.filter(Boolean).length') >= 3, 'bars crossing a delay are dashed for that stretch');
  assert.equal(json('acts.filter(w => !w).length'), json('seqActivations(S.rows).length') + json('acts.filter(Boolean).length'), 'and solid on either side');
  const draw = json(`seqMarkup(seqLayout(), new Proxy({}, { get: () => () => '' }))`);
  assert.ok(draw.includes(`M${L.bounds.x1},`) && draw.includes(`H${L.bounds.x2}`), 'the divider spans the diagram');
  assert.ok(draw.includes('>Payment<') && draw.includes('>up to 5 s later<'));
  // Moving and removing treat them as rows; numbering skips them.
  run('S.settings.autonumber = true');
  assert.deepEqual(json(`seqLayout().R.filter(g => !g.mark && !g.note && !g.brk).slice(0, 4).map(g => g.ls[0].split('.')[0])`), ['1', '2', '3', '4']);
  assert.equal(json(`seqMoveTo('dv', 0)`), true);
  assert.equal(json('S.rows[0].id'), 'dv');
  run(`seqRemove('dl')`);
  assert.equal(json(`S.rows.some(r => r.id === 'dl')`), false);
});

test('sequence groups: a labeled box behind neighbouring participants; members stay side by side through moves, adds and deletes', () => {
  // normalize: members must exist, belong to one group, and sit side by side (the longest run is kept).
  run(`S = normalize({ type: 'sequence', parts: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id.toUpperCase() })), rows: [],
    groups: [{ id: 'g1', label: 'Platform', parts: ['b', 'c', 'zz', 'e', 'b'], style: { line: 'teal' } }, { id: 'g2', label: 'Dup', parts: ['c', 'd'] },
      { id: 'g3', parts: [] }, { id: 'a', parts: ['a'] }, { id: '<x>', parts: ['a'] }, 'junk'] })`);
  assert.deepEqual(json('S.groups'), [{ id: 'g1', kind: 'group', label: 'Platform', parts: ['b', 'c'], style: { line: 'teal' } }, { id: 'g2', kind: 'group', label: 'Dup', parts: ['d'] }]);
  // Layout: a strip above the heads for the labels; each box covers its members' heads and fits its label.
  const geo = () => json(`(() => { const L = seqLayout(); return { H: L.H, G: L.G, end: L.end, bounds: L.bounds, P: L.P.map(q => ({ id: q.id, x: q.x, w: q.w, top: q.top, hh: q.hh })), groups: L.groups.map(o => ({ id: o.g.id, x1: o.x1, x2: o.x2, y1: o.y1, y2: o.y2 })) }; })()`);
  let L = geo();
  const q = Object.fromEntries(L.P.map(o => [o.id, o]));
  assert.equal(L.G, json('SEQ.groupH'));
  assert.equal(L.H, L.G + json('SEQ.headH'), 'heads move down by the strip');
  for (const o of L.P) assert.equal(o.top + o.hh, L.H);
  const g1 = L.groups.find(o => o.id === 'g1');
  assert.ok(g1.x1 <= q.b.x - q.b.w / 2 - 10 && g1.x2 >= q.c.x + q.c.w / 2 + 10, 'covers its members');
  assert.ok(g1.x2 <= q.d.x - q.d.w / 2 && L.groups.find(o => o.id === 'g2').x1 >= g1.x2 + 10, 'clear of the next head and the next group');
  assert.ok(q.a.x + q.a.w / 2 <= g1.x1, 'clear of the head before it');
  assert.equal(g1.y1, 0); assert.ok(g1.y2 >= L.end + L.H - L.G, 'runs down past the bottom heads');
  assert.ok(L.bounds.y2 >= g1.y2);
  // A long label widens the box, and the columns make room for it.
  run(`S.groups[1].label = 'A much longer group label than one head'`);
  L = geo();
  const g2 = L.groups.find(o => o.id === 'g2');
  assert.ok(g2.x2 - g2.x1 >= json(`textWidth('A MUCH LONGER GROUP LABEL THAN ONE HEAD', '600 11.5px ' + UI_STACK)`) + 16);
  assert.ok(g2.x2 <= L.P[4].x - L.P[4].w / 2 && g2.x1 >= L.groups[0].x2 + 10, 'neighbours keep clear of the wider box');
  // Moving: between two members joins, anywhere else leaves; members stay side by side.
  run(`S = normalize({ type: 'sequence', parts: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id })), rows: [], groups: [{ id: 'g', label: 'G', parts: ['b', 'c', 'd'] }] })`);
  const members = () => json('S.groups.map(g => g.parts)');
  run(`seqMoveTo('a', 2)`); assert.deepEqual(json('S.parts.map(p => p.id)'), ['b', 'c', 'a', 'd', 'e']); assert.deepEqual(members(), [['b', 'c', 'a', 'd']], 'dropped between two members: joins');
  run(`seqMoveTo('a', 0)`); assert.deepEqual(members(), [['b', 'c', 'd']], 'dropped outside: leaves');
  run(`seqMoveTo('b', 3)`); assert.deepEqual(json('S.parts.map(p => p.id)'), ['a', 'c', 'd', 'b', 'e']); assert.deepEqual(members(), [['c', 'd']], 'a member dropped at the edge leaves');
  run(`seqMoveTo('e', 2)`); assert.deepEqual(members(), [['c', 'e', 'd']]);
  // Removing a member, or all of them.
  run(`seqRemove('e')`); assert.deepEqual(members(), [['c', 'd']]);
  run(`seqRemove('c'); seqRemove('d')`); assert.deepEqual(members(), [], 'an empty group goes');
  // Wrapping: a run of participants becomes a group, unless one of them is already in a group.
  run(`S = normalize({ type: 'sequence', parts: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id })), rows: [], groups: [{ id: 'g', label: 'G', parts: ['d', 'e'] }] })`);
  assert.equal(json(`seqGroupWrap('c', 'a').parts.join()`), 'a,b,c');
  assert.equal(json(`seqGroupWrap('c', 'd')`), null, 'd is already in a group');
  // Moving a group: its members move as a block, never into another group.
  const gid = json(`S.groups[1].id`);
  run(`seqMoveGroup('g', 0)`); assert.deepEqual(json('S.parts.map(p => p.id)'), ['d', 'e', 'a', 'b', 'c']);
  run(`seqMoveGroup('g', 2)`); assert.deepEqual(json('S.parts.map(p => p.id)'), ['a', 'b', 'c', 'd', 'e'], 'a spot inside another group snaps to its nearer edge');
  run(`seqStepGroup('g', -1)`); assert.deepEqual(json('S.parts.map(p => p.id)'), ['d', 'e', 'a', 'b', 'c'], 'a step hops over a whole group');
  // Resizing by an edge: participants it passes join or leave; it keeps one member and stops at another group.
  // Now g is d,e and the other group a,b,c.
  const mem = id => json(`S.groups.find(g => g.id === '${id}').parts`);
  run(`seqResizeGroup('${gid}', 'l', 0)`); assert.deepEqual(mem(gid), ['a', 'b', 'c'], 'stops at the group to its left');
  run(`seqResizeGroup('${gid}', 'l', 4)`); assert.deepEqual(mem(gid), ['c'], 'keeps one member');
  run(`seqResizeGroup('${gid}', 'l', 3)`); assert.deepEqual(mem(gid), ['b', 'c']);
  run(`seqResizeGroup('g', 'r', 4)`); assert.deepEqual(mem('g'), ['d', 'e', 'a'], 'takes in a; stops at the group to its right');
  run(`seqResizeGroup('g', 'r', 0)`); assert.deepEqual(mem('g'), ['d']);
  assert.deepEqual(json('S.parts.map(p => p.id)'), ['d', 'e', 'a', 'b', 'c'], 'resizing never moves participants');
  run(`seqRemove('${gid}')`); assert.deepEqual(json('S.groups.map(g => g.id)'), ['g'], 'ungrouping keeps the participants');
  assert.equal(json('S.parts.length'), 5);
  // Styled groups get a legend row, named as groups.
  run(`S.groups[0].style = { line: 'teal' }`);
  assert.deepEqual(json(`legendEntries().filter(e => e.key.startsWith('group:')).map(e => e.auto)`), ['Teal group']);
  // A diagram without groups keeps its head row.
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a', label: 'A' }], rows: [] })`);
  assert.deepEqual(json('[S.groups, seqLayout().G, seqLayout().H]'), [[], 0, json('SEQ.headH')]);
});

test('sequence: numbering prefixes messages only, and widens the columns it needs to', () => {
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    rows: [{ id: 'm1', from: 'a', to: 'b', label: 'x'.repeat(30) }, { id: 'n', kind: 'note', on: ['a'], label: 'n' }, { id: 'm2', from: 'b', to: 'a', label: '' }] })`);
  const off = json('seqLayout().P[1].x');
  run('S.settings.autonumber = true');
  assert.deepEqual(json('seqLayout().R.map(g => g.ls)'), [['1. ' + 'x'.repeat(30)], ['n'], ['2. ']]);
  assert.ok(json('seqLayout().P[1].x') > off);
});

test('sequence: a message answering the sync call above starts as a reply; rows and columns move; removing a participant takes its rows', () => {
  run(`S = normalize(seqSample())`);
  assert.equal(json(`seqMessage('pay', 'orders', 4).type`), 'reply', 'right below Orders -> Payments');
  assert.equal(json(`seqMessage('pay', 'orders', 0).type`), 'sync');
  run(`S = normalize(seqSample())`);
  assert.equal(json(`seqMoveTo('m1', 2)`), true);
  assert.deepEqual(json('S.rows.slice(0, 3).map(r => r.id)'), ['m2', 'm3', 'm1']);
  assert.equal(json(`seqMoveTo('m2', 0)`), false, 'already there');
  assert.equal(json(`seqMoveTo('bus', 0)`), true);
  assert.equal(json('S.parts[0].id'), 'bus');
  run(`seqRemove('gw')`);
  assert.ok(json(`S.rows.every(r => isNote(r) ? !r.on.includes('gw') : r.from !== 'gw' && r.to !== 'gw')`));
  assert.deepEqual(json('S.rows.map(r => r.id)'), ['m2', 'm3', 'm1', 'm4', 'f1', 'm7', 'm8', 'm9', 'm10', 'f1e', 'm11', 'm12', 'm13', 'f1x'], 'frames stay');
  // Insertion points follow the rows on screen.
  const L = json('(() => { const L = seqLayout(); return { y: L.R.map(g => [g.y, g.h]) }; })()');
  assert.equal(json(`seqIndexAt(seqLayout(), ${L.y[2][0] + L.y[2][1]})`), 3, 'below the middle of row 2');
  assert.equal(json(`seqIndexAt(seqLayout(), 0)`), 0);
});

test('sequence: normalize drops what a sequence diagram cannot hold', () => {
  run(`S = normalize(${JSON.stringify({ type: 'sequence', nodes: [box('x')], edges: [link('e', 'x', 'x')],
    parts: [{ id: 'a', label: 'A', kind: 'box', style: { line: 'red', fill: '<b>' } }, { id: 'a', label: 'dup' }, { id: 'b c' }, { id: 'b', label: 7 }, 'x', null],
    rows: [{ id: 'a', from: 'a', to: 'b' }, { id: 'm', from: 'a', to: 'b', type: 'call', label: 'ok', extra: 1 }, { id: 'm', from: 'b', to: 'a' },
      { id: 'n1', kind: 'note', side: 'under', on: ['a', 'b'] }, { id: 'n2', kind: 'note', side: 'over', on: ['b', 'a', 'b', 'zz'] },
      { id: 'n3', kind: 'note', on: ['zz'] }, { id: 'n4', kind: 'note', on: 'a' }, { id: 'm2', from: 'a', to: 'zz' }, { id: '__proto__', from: 'b', to: 'b' }] })})`);
  assert.deepEqual(json('S'), json(`({ type: 'sequence', nodes: [], edges: [],
    parts: [{ id: 'a', kind: 'participant', label: 'A', style: { line: 'red' } }, { id: 'b', kind: 'participant', label: '' }],
    rows: [{ id: 'm', from: 'a', to: 'b', type: 'sync', label: 'ok' }, { id: 'n1', kind: 'note', side: 'right', on: ['a'], label: '' },
      { id: 'n2', kind: 'note', side: 'over', on: ['b', 'a'], label: '' }, { id: '__proto__', from: 'b', to: 'b', type: 'sync', label: '' }],
    groups: [],
    settings: sample().settings, title: normalize({ nodes: [], edges: [] }).title, legend: normalize({ nodes: [], edges: [] }).legend })`));
  run(`S = normalize({ type: 'sequence', parts: Array.from({ length: 300 }, (_, i) => ({ id: 'p' + i })), rows: Array.from({ length: 3000 }, (_, i) => ({ id: 'r' + i, from: 'p0', to: 'p1' })) })`);
  assert.deepEqual(json('[S.parts.length, S.rows.length]'), [100, 1000]);
  assert.ok(json('seqLayout().R.length') === 1000);
});

// Frames (alt, opt, loop, par) are rows: a start, else lines and an end, nested.
const ids = () => json('S.rows.map(r => r.id)');
test('sequence frames: each holds its rows, fits its tab and condition, and a frame inside another sits inset', () => {
  run(`S = normalize(seqSample()); seqWrap('m8', 'm9', 'loop', 'for each line item in the order, until the stock check passes');
    seqWrap('m3', 'm3', 'opt', 'cart has items that need validating first')`);
  const L = json(`(() => { const L = seqLayout(); return { P: L.P.map(q => ({ id: q.id, x: q.x })), R: L.R.map(g => ({ ...g, r: g.r })), bounds: L.bounds }; })()`);
  const frames = L.R.filter(g => g.mark === 'frame');
  assert.equal(frames.length, 3);
  for (const f of frames) {
    const i = L.R.indexOf(f), j = L.R.findIndex((g, k) => k > i && g.mark === 'end' && g.frame === f.r.id);
    assert.ok(j > i, `${f.r.id} has an end`);
    assert.ok(f.x1 + f.tw + 6 + f.gw <= f.x2, `tab and condition of ${f.r.id} fit`);
    assert.ok(f.x1 >= L.bounds.x1 && f.x2 <= L.bounds.x2, `bounds hold ${f.r.id}`);
    assert.equal(f.y2, L.R[j].y);
    for (const g of L.R.slice(i + 1, j)) {
      if (g.mark === 'frame') assert.ok(g.x1 > f.x1 && g.x2 < f.x2 && g.y > f.y && g.y2 < f.y2, `${g.r.id} sits inside ${f.r.id}`);
      else if (g.note) assert.ok(g.x > f.x1 && g.x + g.w < f.x2, `note ${g.r.id} inside ${f.r.id}`);
      else if (!g.mark) assert.ok(Math.min(g.x1, g.x2) - f.x1 >= 12 && f.x2 - Math.max(g.x1, g.x2) >= 12, `message ${g.r.id} inside ${f.r.id}`);
    }
  }
  // A frame around one lifeline with a long condition pushes the next lifeline clear of it.
  const opt = frames.find(f => f.r.type === 'opt'), next = L.P[L.P.findIndex(q => q.id === 'orders') + 1];
  assert.ok(next.x > opt.x2 + 8, 'the next lifeline is clear of the opt frame');
  // Labels: the kind in the tab, the condition in brackets (added unless already there).
  assert.deepEqual(json(`[guard('ok'), guard('[ok]'), guard(''), guard(' a\\nb ')]`), ['[ok]', '[ok]', '', '[a b]']);
});

test('sequence frames: normalize keeps them nested, drops stray lines and closes open frames', () => {
  run(`S = normalize(${JSON.stringify({ type: 'sequence', parts: [{ id: 'a' }, { id: 'b' }], rows: [
    { id: 'e0', kind: 'else' }, { id: 'x0', kind: 'end' }, { id: 'f1', kind: 'frame', type: 'weird', label: 5, style: { line: 'red' } },
    { id: 'm1', from: 'a', to: 'b' }, { id: 'e1', kind: 'else', label: 'no', on: ['a'] }, { id: 'f2', kind: 'frame', type: 'opt', label: 'x' },
    { id: 'e2', kind: 'else' }, { id: 'm2', from: 'b', to: 'a' }, { id: 'x2', kind: 'end' }] })})`);
  assert.deepEqual(json('S.rows'), [{ id: 'f1', kind: 'frame', type: 'alt', label: '' }, { id: 'm1', from: 'a', to: 'b', type: 'sync', label: '' },
    { id: 'e1', kind: 'else', label: 'no' }, { id: 'f2', kind: 'frame', type: 'opt', label: 'x' }, { id: 'm2', from: 'b', to: 'a', type: 'sync', label: '' },
    { id: 'x2', kind: 'end' }, { id: 'end1', kind: 'end' }]);
  assert.deepStrictEqual(json('normalize(JSON.parse(JSON.stringify(S)))'), json('S'), 'a repaired diagram is stable');
  // Too deep: frames past MAX_DEPTH go, with their ends.
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a' }], rows: [...Array.from({ length: 25 }, (_, i) => ({ id: 'f' + i, kind: 'frame', type: 'loop' })),
    { id: 'm', from: 'a', to: 'a' }, ...Array.from({ length: 25 }, (_, i) => ({ id: 'x' + i, kind: 'end' }))] })`);
  assert.deepEqual(json(`[S.rows.filter(r => r.kind === 'frame').length, S.rows.filter(r => r.kind === 'end').length, S.rows.length]`), [20, 20, 41]);
  assert.ok(json('seqLayout().R.length') === 41);
});

test('sequence frames: edges move within their frame, a frame moves whole, wrap widens to whole frames, removing keeps or takes the rows', () => {
  run('S = normalize(seqSample())');
  const at = id => ids().indexOf(id);
  // The end can't go above its else line, nor the else line above the start: each stops at the nearest spot that keeps it.
  assert.equal(json(`seqMoveTo('f1x', ${at('m8')})`), true);
  assert.deepEqual(ids().slice(at('f1e')), ['f1e', 'f1x', 'm11', 'm12', 'm13'], 'the end stops right below its else line');
  run('S = normalize(seqSample())');
  json(`seqMoveTo('f1e', 0)`);
  assert.deepEqual(ids().slice(at('f1'), at('f1') + 2), ['f1', 'f1e']);
  // Messages cross edges freely: dragging one past the end takes it out.
  run('S = normalize(seqSample())');
  json(`seqMoveTo('m13', ${at('f1x')})`);
  assert.deepEqual(ids().slice(-2), ['f1x', 'm13']);
  // Arrow keys on an else line skip over a frame inside the section.
  run(`S = normalize(seqSample()); seqWrap('m11', 'm12', 'opt')`);
  assert.equal(json(`seqStep('f1e', 1)`), true);
  assert.deepEqual(ids().slice(at('f1e') - 1, at('f1e') + 1), [ids()[at('f1e') - 1], 'f1e']);
  assert.equal(json(`S.rows[${at('f1e') - 1}].kind`), 'end', 'the else line moved past the whole opt frame');
  // A whole frame moves one row at a time; the row it passes goes to its other side.
  run('S = normalize(seqSample())');
  assert.equal(json(`seqMoveBlock('f1', -1)`), true);
  assert.deepEqual(ids().slice(at('f1') - 1, at('f1') + 1), ['n1', 'f1']);
  assert.equal(ids()[at('f1x') + 1], 'm6');
  assert.equal(json(`seqMoveBlock('f1', 1)`), true);
  assert.equal(json(`seqMoveBlock('f1', 1)`), false, 'already at the bottom');
  // Wrapping rows that cut into a frame takes in the whole frame.
  run('S = normalize(seqSample())');
  assert.deepEqual(json(`seqSpan('m6', 'm8')`), [at('m6'), at('f1x')]);
  const f = json(`seqWrap('m6', 'm8', 'opt', 'paid').id`);
  assert.deepEqual([ids()[at('m6') - 1], ids()[at('f1x') + 1]], [f, json(`S.rows[${at('f1x') + 1}].id`)]);
  assert.equal(json(`S.rows[${at('f1x') + 1}].kind`), 'end');
  assert.equal(json(`seqWrap('m8', 'm9', 'loop').type`), 'loop', 'a frame inside a frame inside a frame');
  assert.deepStrictEqual(json('normalize(JSON.parse(JSON.stringify(S)))'), json('S'), 'what the model builds survives a reload');
  // Opt and loop have no else lines; switching to them drops the lines and keeps the rows.
  run(`S = normalize(seqSample()); seqFrameType('f1', 'loop')`);
  assert.equal(at('f1e'), -1);
  assert.equal(ids().length, 16);
  assert.equal(json(`seqAddElse('f1')`), null, 'a loop takes no else line');
  run(`seqFrameType('f1', 'par'); seqAddElse('f1')`);
  assert.equal(json(`S.rows[${at('f1x') - 1}].kind`), 'else', 'a new else line goes at the bottom');
  // Removing a frame keeps its rows; with its contents, everything inside goes.
  run(`S = normalize(seqSample()); seqRemove('f1')`);
  assert.deepEqual([at('f1'), at('f1e'), at('f1x'), ids().length], [-1, -1, -1, 14]);
  run(`S = normalize(seqSample()); seqRemove('f1x', true)`);
  assert.deepEqual(ids(), ['m1', 'm2', 'm3', 'm4', 'm5', 'n1', 'm6']);
  run(`S = normalize(seqSample()); seqRemove('f1e')`);
  assert.equal(ids().length, 16);
  // Removing a run of rows takes the frames wholly inside it and leaves frame lines whose frame reaches outside.
  run('S = normalize(seqSample())'); run(`seqRemoveRows(${at('m10')}, ${at('m13')})`);
  assert.deepEqual(ids().slice(at('f1')), ['f1', 'm7', 'm8', 'm9', 'f1e', 'f1x']);
  run('S = normalize(seqSample())'); run(`seqRemoveRows(${at('m6')}, ${at('f1x')})`);
  assert.deepEqual(ids(), ['m1', 'm2', 'm3', 'm4', 'm5', 'n1']);
  // A message right after a frame line still answers the call above it.
  run('S = normalize(seqSample())');
  assert.equal(json(`guessType('pay', 'orders', ${at('f1') + 1})`), 'reply', 'Authorize payment is still waiting, two rows up');
  assert.equal(json(`guessType('pay', 'orders', ${at('f1x') + 1})`), 'sync', 'both sections answered it');
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a' }, { id: 'b' }], rows: [{ id: 'm', from: 'a', to: 'b' }, { id: 'f', kind: 'frame', type: 'opt' }, { id: 'x', kind: 'end' }] })`);
  assert.equal(json(`guessType('b', 'a', 2)`), 'reply');
});

// Activation bars come from the messages alone.
const bars = () => json(`seqActivations(S.rows).map(b => [b.p, S.rows[b.i].id, S.rows[b.end].id, b.level])`);
test('sequence activation: a sync call activates its callee until the last reply back, or until the caller acts again; async starts none', () => {
  run('S = normalize(seqSample())');
  // Both alt sections reply, so the bars run to the last reply. Validate cart nests on Orders API. Nothing calls Customer; the bus only gets an event.
  // Customer, who starts it all, waits from its call to the answer.
  assert.deepEqual(bars(), [['cust', 'm1', 'm13', 0], ['web', 'm1', 'm13', 0], ['orders', 'm2', 'm12', 0], ['orders', 'm3', 'm3', 1], ['pay', 'm4', 'm11', 0], ['gw', 'm5', 'm6', 0]]);
  // No reply: the bar covers what the callee does next, up to its last message before the caller sends again; nothing more, a stub.
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], rows: [
    { id: 'call', from: 'a', to: 'b' }, { id: 'check', from: 'b', to: 'c' }, { id: 'ok', from: 'c', to: 'b', type: 'reply' },
    { id: 'log', from: 'b', to: 'c', type: 'async' }, { id: 'next', from: 'a', to: 'c' }, { id: 'n', kind: 'note', side: 'right', on: ['a'], label: 'x' }] })`);
  assert.deepEqual(bars(), [['a', 'call', 'log', 0], ['b', 'call', 'log', 0], ['c', 'check', 'ok', 0], ['a', 'next', 'next', 0], ['c', 'next', 'next', 0]]);
  // A call back into a participant that's already busy nests one level in.
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a' }, { id: 'b' }], rows: [{ id: 'm1', from: 'a', to: 'b' }, { id: 'm2', from: 'b', to: 'a' },
    { id: 'm3', from: 'a', to: 'b' }, { id: 'm4', from: 'b', to: 'a', type: 'reply' }, { id: 'm5', from: 'a', to: 'b', type: 'reply' }, { id: 'm6', from: 'b', to: 'a', type: 'reply' }] })`);
  assert.deepEqual(bars(), [['a', 'm1', 'm6', 0], ['b', 'm1', 'm6', 0], ['a', 'm2', 'm5', 1], ['b', 'm3', 'm4', 1]], 'each reply closes the latest open call between the two');
  // A call that one alt section answers and another doesn't is still open after the frame, for the path that didn't.
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a' }, { id: 'b' }], rows: [{ id: 'c', from: 'a', to: 'b' }, { id: 'f', kind: 'frame', type: 'alt' },
    { id: 'r1', from: 'b', to: 'a', type: 'reply' }, { id: 'e', kind: 'else' }, { id: 'w', from: 'b', to: 'b', type: 'async' }, { id: 'x', kind: 'end' },
    { id: 'r2', from: 'b', to: 'a', type: 'reply' }] })`);
  assert.deepEqual(bars(), [['a', 'c', 'r2', 0], ['b', 'c', 'r2', 0]]);
});

test('sequence activation: an answer to the first call starts as a reply, and the participant who called waits with a bar (owner\'s report)', () => {
  // A calls B, B calls C, C replies; the next message from B back to A answers A's call, two rows up.
  run(`S = normalize({ type: 'sequence', parts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], rows: [
    { id: 'm1', from: 'a', to: 'b' }, { id: 'm2', from: 'b', to: 'c' }, { id: 'm3', from: 'c', to: 'b', type: 'reply' }] })`);
  const answer = json(`seqMessage('b', 'a', 3)`);
  assert.equal(answer.type, 'reply');
  assert.deepEqual(bars(), [['a', 'm1', answer.id, 0], ['b', 'm1', answer.id, 0], ['c', 'm2', 'm3', 0]]);
  assert.equal(json(`seqMessage('c', 'b', 4).type`), 'sync', 'nothing is waiting on C');
});

test('sequence activation: arrows end at the bars, notes and columns make room for them, and the setting turns them off', () => {
  run(`S = normalize(seqSample()); S.rows.splice(4, 0, { id: 'nr', kind: 'note', side: 'right', on: ['orders'], label: 'stock reserved' })`);
  const L = json(`(() => { const L = seqLayout(); return { P: Object.fromEntries(L.P.map(q => [q.id, q.x])), R: Object.fromEntries(L.R.map(g => [g.r.id, g])), A: L.A.map(a => [a.p, a.x, a.y1, a.y2]) }; })()`);
  const { P, R } = L;
  assert.deepEqual([R.m1.x1, R.m1.x2], [P.cust + 5, P.web - 5], 'out of the caller\'s bar, into the bar the call starts');
  assert.deepEqual([R.m2.x1, R.m2.x2], [P.web + 5, P.orders - 5], 'out of the caller\'s bar');
  assert.deepEqual([R.m6.x1, R.m6.x2], [P.gw - 5, P.pay + 5], 'a reply leaves from the left of its bar');
  assert.equal(R.m8.x2, P.bus, 'no bar on the bus');
  assert.deepEqual([R.m3.x1, R.m3.x2], [P.orders + 5, P.orders + 10], 'a self-call returns into its nested bar');
  assert.ok(R.nr.x >= P.orders + 5 + 12, 'a note beside a busy lifeline clears its bar');
  const web = L.A.find(a => a[0] === 'web');
  assert.deepEqual([web[1], web[2], web[3]], [P.web - 5, R.m1.ay, R.m13.ay + 4], 'from the call to the last reply');
  // Bars go under frames, so a bar near a frame's edge never covers its tab or an else line's condition.
  const out = json(`seqMarkup(seqLayout(), new Proxy({}, { get: (_, k) => () => k === 'hit' ? '' : 'data-k="' + k + '"' }))`);
  assert.ok(out.lastIndexOf('data-k="act"') < out.indexOf('data-k="tab"'), 'bars are drawn before frames');
  run('S.settings.activation = false');
  assert.deepEqual(json('[seqLayout().A.length, seqLayout().R[0].x2 === seqLayout().P[1].x]'), [0, true]);
});

// ---------- tabs ----------
test('tabs: a file with several diagrams round-trips, and an old one-diagram file opens as one tab', () => {
  const book = json(`(() => {
    const a = normalize(sample()), b = normalize(seqSample());
    BOOK = { pages: [{ name: 'Architecture', S: a }, { name: 'Checkout', S: b }], active: 1 }; S = b;
    S.rows[0].label = 'changed on the open tab';
    return parseBook(serialize());
  })()`);
  assert.deepEqual(book.pages.map(p => [p.name, p.diagram.type || 'box']), [['Architecture', 'box'], ['Checkout', 'sequence']]);
  assert.equal(book.active, 1);
  assert.equal(book.pages[1].diagram.rows[0].label, 'changed on the open tab', 'the open tab is saved as it is now');
  assert.deepStrictEqual(json('parseDiagram(serialize())'), json('S'));
  assert.equal(json('JSON.parse(serialize()).version'), 2);
  const old = json(`parseBook(JSON.stringify({ format: 'snapblade', version: 1, diagram: seqSample() }))`);
  assert.deepEqual([old.pages.length, old.pages[0].name, old.active], [1, 'Sequence 1', 0]);
  assert.throws(() => run(`parseBook(JSON.stringify({ format: 'snapblade', version: 3, pages: [] }))`), /newer version/);
  run('BOOK = null');
});

test('tabs: hostile tab lists are capped and cleaned', () => {
  const b = json(`normalizeBook({ active: 99, pages: [
    { name: 7, diagram: { nodes: [], edges: [] } }, null, 'x', { name: 'no diagram' }, { name: '  spaced  ', diagram: { type: 'sequence' } },
    { name: 'x'.repeat(500), diagram: { nodes: [], edges: [] } }, ...Array.from({ length: 80 }, (_, i) => ({ name: 'p' + i, diagram: { nodes: [], edges: [] } })) ] })`);
  assert.equal(b.pages.length, 50 - 3, 'at most 50 entries are read; the ones that are not diagrams are dropped');
  assert.deepEqual(b.pages.slice(0, 3).map(p => p.name.length > 20 ? p.name.length : p.name), ['Page 1', 'spaced', 100]);
  assert.equal(b.active, b.pages.length - 1);
  assert.equal(json(`normalizeBook({ pages: [] })`), null);
  assert.equal(json(`normalizeBook({ pages: [{ name: 'a', diagram: 'nope' }] })`), null);
  assert.equal(json(`normalizeBook({ pages: [{ diagram: { nodes: [], edges: [] } }], active: -3 }).active`), 0);
});

// ---------- the README keeps up ----------
// Nothing else checks the README, and it once fell six builds behind. Every Help guide section is a feature or a
// piece of the app the README has to cover (the browser test "the Help guide mentions every control..." makes a
// new control land in the guide, so a new feature lands here). A new guide section needs an entry in this map:
// what the README must say about it, or null for sections that aren't features of their own.
const README_FOR_SECTION = {
  around: /## Getting started/, shapes: /\*\*Containers\.\*\*/, walls: /\*\*Shapes that can't overlap\.\*\*/, connect: /\*\*Connect where you drop\.\*\*/,
  anchors: /\*\*Self-spacing anchors\.\*\*/, routing: /\*\*Routing that respects your layout\.\*\*/, arrange: /\*\*Arrange\.\*\*/, colors: /\*\*Styling\.\*\*/,
  blocks: /\*\*Title block and legend\.\*\*/, settings: null, seq: /\*\*Sequence diagrams\.\*\*/, tabs: /\*\*Tabs\.\*\*/, files: /\*\*Files\.\*\*/,
  export: /\*\*Export\.\*\*/, ai: /\*\*Diagrams from an AI assistant\.\*\*/, privacy: /## Privacy/,
};
test('the README covers every section of the Help guide', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const sections = json(`[...guideHtml().matchAll(/<section id="g-([\\w-]+)"><h3>([^<]+)/g)].map(m => [m[1], m[2]])`);
  assert.ok(sections.length >= 15, `found ${sections.length} guide sections`);
  const unmapped = sections.filter(([id]) => !(id in README_FOR_SECTION)).map(([id, t]) => `${id} (${t})`);
  assert.deepEqual(unmapped, [], 'new Help guide sections: describe them in README.md and add them to README_FOR_SECTION');
  const missing = sections.filter(([id]) => README_FOR_SECTION[id] && !README_FOR_SECTION[id].test(readme)).map(([id, t]) => `${id} (${t})`);
  assert.deepEqual(missing, [], 'README.md doesn\'t cover these Help guide sections');
});

// Every outside server the page talks to is named in the README's Privacy section (the app promises nothing else leaves).
const README_FOR_HOST = { 'fonts.googleapis.com': /Google Fonts/, 'fonts.gstatic.com': /Google Fonts/, 'cdn.jsdelivr.net': /jsDelivr/, 'mmunchinski.github.io': null };
test('the README\'s Privacy section names every server the page loads from', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8'), html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const privacy = readme.split('## Privacy')[1]?.split(/\n## /)[0] || '';
  const hosts = [...new Set([...html.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map(m => m[1]))];
  assert.deepEqual(hosts.filter(h => !(h in README_FOR_HOST)), [], 'new servers: name them in the README\'s Privacy section and add them to README_FOR_HOST');
  assert.deepEqual(hosts.filter(h => README_FOR_HOST[h] && !README_FOR_HOST[h].test(privacy)), [], 'servers the Privacy section doesn\'t name');
});
