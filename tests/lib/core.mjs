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
// tidy() as it was before build 42, scoring every trial swap by recounting all crossings in the bundle. Build 42
// recounts only the crossings of the two swapped connectors; the layout test compares the two on random diagrams.
function tidyFullRecount(R) {
  for (const vert of [true, false]) {
    const key = vert ? 'x' : 'y', segs = [];
    for (const id in R) {
      const pts = R[id];
      for (let i = 1; i < pts.length - 2; i++) {
        const a = pts[i], b = pts[i + 1];
        if ((Math.abs(a.x - b.x) < 0.01) !== vert) continue;
        const u = vert ? a.y : a.x, v = vert ? b.y : b.x;
        if (Math.abs(u - v) < 0.01) continue;
        const s = { id, i, c: a[key], lo: Math.min(u, v), hi: Math.max(u, v) };
        let L = -Infinity, Rb = Infinity;
        for (const n of S.nodes) {
          const n0 = vert ? n.x : n.y, n1 = vert ? n.x + n.w : n.y + n.h;
          const m0 = vert ? n.y : n.x, m1 = vert ? n.y + n.h : n.x + n.w;
          if (m1 <= s.lo || m0 >= s.hi) continue;      // not beside this segment
          if (n0 < s.c && n1 > s.c) continue;           // a container the segment runs inside
          if (n1 <= s.c) L = Math.max(L, n1); else Rb = Math.min(Rb, n0);
        }
        // Open on one side: mirror the closed side so the segment keeps its place.
        if (!isFinite(L) && !isFinite(Rb)) { L = s.c - 100; Rb = s.c + 100; }
        else if (!isFinite(L)) L = 2 * s.c - Rb;
        else if (!isFinite(Rb)) Rb = 2 * s.c - L;
        s.L = L; s.R = Rb; segs.push(s);
      }
    }
    // Bundle: spans overlap and the corridors are essentially the same gap
    // (their overlap is most of the wider one), so narrow detours don't get pulled into wide channels.
    const fits = (a, b) => {
      const L = Math.max(a.L, b.L), Rb = Math.min(a.R, b.R);
      return Rb - L >= 0.6 * Math.max(a.R - a.L, b.R - b.L) && a.segs.some(t => b.segs.some(s => t.lo <= s.hi + 2 && s.lo <= t.hi + 2));
    };
    // Start with one bundle per segment and keep merging until nothing else fits,
    // so the result doesn't depend on the order segments were found in.
    let bundles = segs.map(s => ({ segs: [s], L: s.L, R: s.R }));
    for (let merged = true; merged;) {
      merged = false;
      outer: for (let i = 0; i < bundles.length; i++) for (let j = i + 1; j < bundles.length; j++) {
        const a = bundles[i], b = bundles[j];
        if (!fits(a, b)) continue;
        a.segs.push(...b.segs); a.L = Math.max(a.L, b.L); a.R = Math.min(a.R, b.R);
        bundles.splice(j, 1); merged = true; break outer;
      }
    }
    for (const { segs: cl, L, R: Rb } of bundles) {
      const mid = (L + Rb) / 2;
      const k = cl.length, room = Rb - L - 2 * CLEAR;
      const step = k > 1 ? Math.max(3, Math.min(TRACK, room / (k - 1))) : 0;
      const apply = order => order.forEach((s, t) => { const v = Math.round(mid + (t - (k - 1) / 2) * step); R[s.id][s.i][key] = v; R[s.id][s.i + 1][key] = v; });
      cl.sort((p, q) => p.c - q.c || p.lo - q.lo);
      if (k === 1) { apply(cl); continue; }
      const polys = [...new Set(cl.map(s => s.id))].map(id => R[id]);
      let bestOrder = cl, best = Infinity;
      if (k <= 6) {
        for (const perm of permutations(cl)) { apply(perm); const x = crossCount(polys); if (x < best) { best = x; bestOrder = perm; } if (!x) break; }
      } else {
        // Too many to try every order: swap neighbours while it helps.
        let order = [...cl]; apply(order); best = crossCount(polys);
        for (let improved = true, guard = 0; improved && guard < 50; guard++) {
          improved = false;
          for (let t = 0; t < k - 1; t++) {
            [order[t], order[t + 1]] = [order[t + 1], order[t]]; apply(order);
            const x = crossCount(polys);
            if (x < best) { best = x; improved = true; } else { [order[t], order[t + 1]] = [order[t + 1], order[t]]; }
          }
        }
        bestOrder = order;
      }
      apply(bestOrder);
    }
  }
}
// Routes for the current diagram before tidy(), so both versions start from the same input.
function untidied() {
  layoutAll(false); const P = computePorts(), base = routingBase(), R = dict();
  for (const e of S.edges) { const pe = P[e.id]; if (pe) R[e.id] = routeSmart(e, pe.from, pe.to, base) || route(pe.from, pe.to, 'ortho'); }
  return R;
}
// Boxes in a grid with connectors between pairs picked by a fixed pseudo-random sequence (jitter moves boxes off the grid).
function randomDiagram(seed, boxes, connectors, cols, jitter = 0) {
  let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const nodes = Array.from({ length: boxes }, (_, i) => ({ id: 'n' + i, kind: 'box', label: 'n' + i, w: 120, h: 60, parent: null,
    x: (i % cols) * 180 + Math.floor(rnd() * jitter), y: Math.floor(i / cols) * 120 + Math.floor(rnd() * jitter) }));
  const edges = [];
  for (let i = 0; edges.length < connectors; i++) { const a = Math.floor(rnd() * boxes), b = Math.floor(rnd() * boxes); if (a !== b) edges.push({ id: 'e' + i, from: { node: 'n' + a, side: 'auto' }, to: { node: 'n' + b, side: 'auto' }, arrow: 'end' }); }
  S = normalize({ nodes, edges });
}
function segmentsOf(R) {
  const segs = [];
  for (const id in R) R[id].slice(1).forEach((q, i) => { const a = R[id][i]; segs.push({ id, x: Math.min(a.x, q.x) - 0.5, y: Math.min(a.y, q.y) - 0.5, w: Math.abs(q.x - a.x) + 1, h: Math.abs(q.y - a.y) + 1 }); });
  return segs;
}
`;
