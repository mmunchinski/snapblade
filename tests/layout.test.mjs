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
