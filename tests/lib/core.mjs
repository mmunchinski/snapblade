// Loads the app's script from index.html into a sandbox without a DOM, so the layout engine
// (anchors, routing, labels) can be tested in plain Node. Returns an evaluator for that sandbox.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function loadCore() {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const ctx = vm.createContext({ console, performance });
  vm.runInContext(script, ctx);
  vm.runInContext(TEST_HELPERS, ctx);
  return code => vm.runInContext(code, ctx);
}

// Helpers shared by the layout tests, evaluated inside the sandbox.
const TEST_HELPERS = String.raw`
// Two columns: three boxes in a container on the left, a tall firewall and a load balancer on the right,
// with two-way connectors. Reproduces layouts reported while tuning the anchor and bundle rules.
function twoColumns(containerY) {
  const B = (id, w, h, parent) => ({ id, kind: 'box', label: id, x: 0, y: 0, w, h, parent });
  const G = (id, x, y) => ({ id, kind: 'group', label: id, x, y, w: 100, h: 100, parent: null, layout: 'column', align: 'center', pad: 20, gap: 30 });
  const E = (id, a, b) => ({ id, from: { node: a, side: 'auto' }, to: { node: b, side: 'auto' }, arrow: 'end' });
  S = {
    nodes: [G('L', 150, containerY), B('cust', 150, 70, 'L'), B('nb1', 190, 70, 'L'), B('nb2', 180, 70, 'L'),
      G('edge', 900, 120), B('waf', 180, 320, 'edge'), B('lb', 180, 150, 'edge')],
    edges: [E('a', 'cust', 'waf'), E('b', 'waf', 'cust'), E('c', 'nb1', 'waf'), E('d', 'waf', 'nb1'), E('f', 'nb2', 'waf'), E('g', 'waf', 'lb')],
    settings: { mode: 'straighten', grid: 10, routing: 'ortho', radius: 6, labelPos: 'start' },
  };
  layoutAll();
}
function routesNow() { layoutAll(); const P = computePorts(); return { P, R: computeRoutes(P) }; }
// Segments of any connector that pass through a box other than its own ends and their containers.
function throughBoxes(R) {
  const bad = [];
  for (const e of S.edges) {
    const pts = R[e.id], skip = new Set([...ancestors(byId(e.from.node)), ...ancestors(byId(e.to.node)), e.from.node, e.to.node]);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      for (const n of S.nodes) if (!skip.has(n.id) && x2 > n.x && x1 < n.x + n.w && y2 > n.y && y1 < n.y + n.h) bad.push(e.id + ' through ' + n.id);
    }
  }
  return bad;
}
function segmentsOf(R) {
  const segs = [];
  for (const id in R) R[id].slice(1).forEach((q, i) => { const a = R[id][i]; segs.push({ id, x: Math.min(a.x, q.x) - 0.5, y: Math.min(a.y, q.y) - 0.5, w: Math.abs(q.x - a.x) + 1, h: Math.abs(q.y - a.y) + 1 }); });
  return segs;
}
`;
