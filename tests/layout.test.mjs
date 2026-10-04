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
