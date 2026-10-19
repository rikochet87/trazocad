// Bloques dinámicos: parámetros de visibilidad, simetría y estiramiento lineal.
// Definición: b.dyn = { vis?: {states, hide: {estado: [índices]}, pos}, flip?: {a, b}, lin?: {name, p1, p2, rect, ents: [índices], min?, max?} }
// Referencia: e.dyn = { vis, flip, dist } (lo que falte toma el valor por defecto del bloque).
// Los índices se refieren al orden de b.ents; en el editor de bloques se trabajan como identificadores.
import * as G from './geom.js';
import { ENV, xformEnt, insertMatrix } from './entities.js';
import { stretchEntity } from './ops.js';
const { Mx } = G;

const D = () => ENV.doc;
export const dynDefaults = b => ({ vis: b.dyn?.vis?.states?.[0], flip: false, dist: b.dyn?.lin ? G.dist(b.dyn.lin.p1, b.dyn.lin.p2) : 0 });
export const dynState = (b, e) => ({ ...dynDefaults(b), ...e.dyn });
export const isDynamic = b => !!(b?.dyn && (b.dyn.vis || b.dyn.flip || b.dyn.lin));

// Entidades del bloque (copias, en coordenadas del bloque) según el estado de la referencia
export function applyDyn(b, e, ents) {
  const d = b.dyn, s = dynState(b, e);
  let out = ents.map((x, i) => ({ x, i }));
  if (d.vis?.states?.length) { const hide = new Set(d.vis.hide?.[s.vis] || []); out = out.filter(o => !hide.has(o.i)); }
  if (d.lin) {
    const L = d.lin, u = G.norm(G.sub(L.p2, L.p1)), delta = G.mul(u, s.dist - G.dist(L.p1, L.p2));
    if (G.len(delta) > 1e-12) { const set = new Set(L.ents); out = out.map(o => (set.has(o.i) ? { ...o, x: stretchEntity(o.x, L.rect, delta) || o.x } : o)); }
  }
  if (d.flip && s.flip) { const m = Mx.Mi(d.flip.a, d.flip.b); out = out.map(o => ({ ...o, x: xformEnt(o.x, m) })); }
  return out.map(o => o.x);
}

// Pinzamientos dinámicos de una referencia: [{p, kind: 'lin'|'flip'|'vis'}] en coordenadas del dibujo
export function dynGrips(e) {
  const b = D()?.blocks?.[e.name];
  if (!isDynamic(b)) return [];
  const M = insertMatrix(e, b), s = dynState(b, e), d = b.dyn, out = [];
  if (d.lin) { const u = G.norm(G.sub(d.lin.p2, d.lin.p1)); out.push({ p: Mx.ap(M, G.add(d.lin.p1, G.mul(u, s.dist))), kind: 'lin' }); }
  if (d.flip) out.push({ p: Mx.ap(M, G.mid(d.flip.a, d.flip.b)), kind: 'flip' });
  if (d.vis?.states?.length > 1) out.push({ p: Mx.ap(M, d.vis.pos || b.base), kind: 'vis' });
  return out;
}
// Arrastre de un pinzamiento dinámico: el lineal cambia la distancia; los de simetría y visibilidad alternan su estado
export function dynMoveGrip(e, i, p) {
  const b = D()?.blocks?.[e.name], g = dynGrips(e)[i];
  if (!g) return;
  const s = dynState(b, e), d = b.dyn;
  if (g.kind === 'lin') {
    const inv = invert(insertMatrix(e, b)), q = Mx.ap(inv, p), u = G.norm(G.sub(d.lin.p2, d.lin.p1));
    let v = G.dot(G.sub(q, d.lin.p1), u);
    if (d.lin.min != null) v = Math.max(d.lin.min, v);
    if (d.lin.max != null) v = Math.min(d.lin.max, v);
    s.dist = Math.max(1e-6, v);
  } else if (g.kind === 'flip') s.flip = !s.flip;
  else { const st = d.vis.states; s.vis = st[(st.indexOf(s.vis) + 1) % st.length]; }
  e.dyn = s;
}
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
// Propiedades «Personalizado» de una referencia dinámica
export function dynProps(e) {
  const b = D()?.blocks?.[e.name];
  if (!isDynamic(b)) return [];
  const d = b.dyn, set = (k, v) => x => { x.dyn = { ...dynState(b, x), [k]: v }; };
  const out = [{ sec: 'Personalizado' }];
  if (d.vis?.states?.length) out.push({ label: 'Visibilidad', type: 'select', options: () => d.vis.states.map(s => [s, s]), get: x => dynState(b, x).vis, set: (x, v) => set('vis', v)(x) });
  if (d.flip) out.push({ label: 'Simetría', type: 'bool', get: x => !!dynState(b, x).flip, set: (x, v) => set('flip', v)(x) });
  if (d.lin) out.push({ label: d.lin.name || 'Distancia', type: 'num', get: x => dynState(b, x).dist, set: (x, v) => { if (v > 0) set('dist', v)(x); } });
  return out;
}

// Conversión de índices ↔ identificadores (editor de bloques)
export function remapDyn(dyn, f) {
  if (!dyn) return dyn;
  const list = l => (l || []).map(f).filter(v => v != null);
  const out = JSON.parse(JSON.stringify(dyn));
  if (out.lin) out.lin.ents = list(dyn.lin.ents);
  if (out.vis) out.vis.hide = Object.fromEntries(Object.entries(dyn.vis.hide || {}).map(([k, l]) => [k, list(l)]));
  return out;
}

ENV.applyDyn = applyDyn;
ENV.dynGrips = dynGrips;
ENV.dynMoveGrip = dynMoveGrip;
ENV.dynProps = dynProps;
