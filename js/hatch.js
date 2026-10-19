// Detección de contornos para SOMBREADO: grafo plano a partir de las entidades, trazado de caras e islas.
// También recalcula los sombreados asociativos cuando cambia su contorno.
import * as G from './geom.js';
import { primsOf, ellPts, plPolygon } from './entities.js';
import { splinePts } from './spline.js';
import { exactLoop } from './region.js';
const { P } = G;

// Segmentos [a, b, id de la entidad de origen, primitiva de origen]
function primSegs(q, out, src) {
  if (q.k === 's') { if (G.dist(q.a, q.b) > 1e-12) out.push([q.a, q.b, src, q]); return; }
  const sw = G.sweep(q.a1, q.a2), n = Math.max(2, Math.ceil(sw / (G.TAU / 96)));
  let prev = G.polar(q.c, q.a1, q.r);
  for (let i = 1; i <= n; i++) { const p = G.polar(q.c, q.a1 + sw * i / n, q.r); out.push([prev, p, src, q]); prev = p; }
}
const NO_BOUNDARY = new Set(['hatch', 'text', 'mtext', 'attdef', 'point', 'dim', 'mleader', 'table']);

// Contornos cerrados de una entidad (para "Seleccionar objetos")
export function loopsOfEntity(e) {
  switch (e.type) {
    case 'circle': return [Array.from({ length: 96 }, (_, i) => G.polar(e.c, i / 96 * G.TAU, e.r))];
    case 'ellipse': return [ellPts(e, 96)];
    case 'pline': return e.closed && e.pts.length > 2 ? [plPolygon(e)] : null;
    case 'spline': return e.closed ? [splinePts(e)] : null;
    case 'hatch': return e.loops.map(l => [...l]);
    case 'region': return e.loops.map(l => plPolygon({ pts: l.pts, bulges: l.bulges, closed: true }));
  }
  return null;
}

// Busca la región cerrada que contiene P. Devuelve [contorno, ...islas] o null.
// El resultado lleva en .ids las entidades que forman los contornos (para la asociatividad).
export function findBoundary(ents, Pt) {
  const segs = [];
  for (const e of ents) {
    if (NO_BOUNDARY.has(e.type)) continue;
    for (const q of primsOf(e)) primSegs(q, segs, e.id);
  }
  if (!segs.length) return null;
  let bb = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const [a, b] of segs) for (const p of [a, b]) { bb.x1 = Math.min(bb.x1, p.x); bb.y1 = Math.min(bb.y1, p.y); bb.x2 = Math.max(bb.x2, p.x); bb.y2 = Math.max(bb.y2, p.y); }
  const size = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) || 1, tol = size * 1e-9;

  // 1. Cortar segmentos en sus intersecciones (cubetas en rejilla)
  const n = segs.length, cuts = segs.map(() => [0, 1]);
  const GN = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(n)))), cw = (bb.x2 - bb.x1) / GN || 1, ch = (bb.y2 - bb.y1) / GN || 1;
  const cells = new Map();
  segs.forEach(([a, b], i) => {
    const cx1 = Math.min(GN - 1, Math.floor((Math.min(a.x, b.x) - bb.x1) / cw)), cx2 = Math.min(GN - 1, Math.floor((Math.max(a.x, b.x) - bb.x1) / cw));
    const cy1 = Math.min(GN - 1, Math.floor((Math.min(a.y, b.y) - bb.y1) / ch)), cy2 = Math.min(GN - 1, Math.floor((Math.max(a.y, b.y) - bb.y1) / ch));
    for (let x = cx1; x <= cx2; x++) for (let y = cy1; y <= cy2; y++) { const k = x * 1024 + y; let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(i); }
  });
  const done = new Set();
  for (const list of cells.values()) {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const i = list[x], j = list[y], key = i < j ? i * n + j : j * n + i;
      if (done.has(key)) continue;
      done.add(key);
      const [a, b] = segs[i], [c, d] = segs[j];
      const r = G.llInt(a, b, c, d);
      if (r && r.t > -1e-9 && r.t < 1 + 1e-9 && r.u > -1e-9 && r.u < 1 + 1e-9) { cuts[i].push(r.t); cuts[j].push(r.u); }
    }
  }

  // 2. Vértices fusionados y semiaristas
  const V = [], vmap = new Map(), q = tol * 1000;
  const vid = p => {
    const k = `${Math.round(p.x / q)},${Math.round(p.y / q)}`;
    let id = vmap.get(k);
    if (id === undefined) { id = V.length; V.push({ p, out: [] }); vmap.set(k, id); }
    return id;
  };
  const H = [], ekeys = new Set();
  segs.forEach(([a, b, src, prim], i) => {
    const ts = [...new Set(cuts[i].map(t => Math.min(1, Math.max(0, t))))].sort((x, y) => x - y);
    for (let k = 1; k < ts.length; k++) {
      const u = vid(G.lerp(a, b, ts[k - 1])), v = vid(G.lerp(a, b, ts[k]));
      if (u === v) continue;
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (ekeys.has(key)) continue;
      ekeys.add(key);
      const h1 = H.length;
      H.push({ from: u, to: v, twin: h1 + 1, src, prim }, { from: v, to: u, twin: h1, src, prim });
      V[u].out.push(h1); V[v].out.push(h1 + 1);
    }
  });
  for (const h of H) h.ang = G.ang(V[h.from].p, V[h.to].p);
  for (const v of V) { v.out.sort((a, b) => H[a].ang - H[b].ang); v.out.forEach((h, i) => { H[h].idx = i; }); }
  const next = h => { const v = V[H[h].to], tw = H[h].twin; return v.out[(H[tw].idx - 1 + v.out.length) % v.out.length]; };
  const used = new Set();
  const trace = h0 => {
    const loop = [], vs = [], edges = [];
    let h = h0, guard = 0;
    do { loop.push(V[H[h].from].p); vs.push(H[h].from); edges.push({ a: V[H[h].from].p, b: V[H[h].to].p, prim: H[h].prim }); used.add(H[h].src); h = next(h); } while (h !== h0 && ++guard < 200000);
    return { loop, vs, edges };
  };
  // Rayo horizontal hacia +x: primera semiarista con el punto a su izquierda
  const castRay = (O, allowed) => {
    let best = Infinity, bh = -1;
    for (let h = 0; h < H.length; h += 2) {
      if (allowed && !allowed(H[h].from)) continue;
      const a = V[H[h].from].p, b = V[H[h].to].p;
      if ((a.y > O.y) === (b.y > O.y)) continue;
      const x = a.x + (O.y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (x > O.x && x < best) { best = x; bh = G.cross(G.sub(b, a), G.sub(O, a)) > 0 ? h : h + 1; }
    }
    return bh;
  };

  const O = P(Pt.x, Pt.y + size * 1.2345e-7);
  const h0 = castRay(O);
  if (h0 < 0) return null;
  const outer = trace(h0);
  if (G.polyArea(outer.loop) <= 0 || !G.pointInPoly(O, outer.loop)) return null;

  // 3. Islas: componentes conexas no unidas al contorno y situadas dentro de él
  const comp = new Int32Array(V.length).fill(-1);
  let nc = 0;
  for (let s = 0; s < V.length; s++) {
    if (comp[s] >= 0) continue;
    const st = [s]; comp[s] = nc;
    while (st.length) { const v = st.pop(); for (const h of V[v].out) { const w = H[h].to; if (comp[w] < 0) { comp[w] = nc; st.push(w); } } }
    nc++;
  }
  const outerComp = new Set(outer.vs.map(v => comp[v]));
  const loops = [outer.loop], seen = new Set(), traced = [outer];
  for (let v = 0; v < V.length; v++) {
    const c = comp[v];
    if (outerComp.has(c) || seen.has(c)) continue;
    seen.add(c);
    if (!G.pointInPoly(V[v].p, outer.loop)) continue;
    let left = v;
    for (let w = 0; w < V.length; w++) if (comp[w] === c && V[w].p.x < V[left].p.x) left = w;
    const Q = P(V[left].p.x - size * 1e-6, V[left].p.y + size * 1.2345e-7);
    const hh = castRay(Q, x => comp[x] === c);
    if (hh >= 0) { const t = trace(hh); loops.push(t.loop); traced.push(t); }
  }
  loops.ids = [...used].filter(id => id != null);
  // Contornos exactos (con los arcos de origen) para CONTORNO y REGION: se calculan al pedirlos
  Object.defineProperty(loops, 'exact', { get: () => traced.map(t => exactLoop(t.edges, size * 2e-3)) });
  return loops;
}

// Punto interior de la región par-impar formada por los contornos (centro del tramo interior más ancho)
export function interiorPoint(loops) {
  const pts = loops.flat();
  if (pts.length < 3) return null;
  let y1 = Infinity, y2 = -Infinity;
  for (const p of pts) { y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y); }
  let best = null, bw = 0;
  for (const f of [0.5, 0.31, 0.69, 0.17, 0.83, 0.43, 0.57]) {
    const y = y1 + (y2 - y1) * f + (y2 - y1) * 1.234e-7, xs = [];
    for (const l of loops) for (let i = 0; i < l.length; i++) {
      const a = l[i], b = l[(i + 1) % l.length];
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bw) { bw = xs[i + 1] - xs[i]; best = P((xs[i] + xs[i + 1]) / 2, y); }
  }
  return best;
}

// Contornos de un sombreado asociativo a partir de sus entidades de origen (null si ya no hay contorno válido).
// Con punto interior (seed) se repite la detección sólo con esas entidades; si el punto quedó fuera,
// se prueba con un punto interior del contorno anterior.
export function assocLoops(h, srcs) {
  if (!h.seed) {
    const loops = srcs.flatMap(e => loopsOfEntity(e) || []);
    return loops.length ? { loops, ids: h.assoc } : null;
  }
  let seed = h.seed, loops = findBoundary(srcs, seed);
  if (!loops) { seed = interiorPoint(h.loops); loops = seed && findBoundary(srcs, seed); }
  return loops ? { loops, ids: loops.ids, seed } : null;
}
