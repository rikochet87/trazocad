// Cotas asociativas: referencias de los puntos de una cota a la geometría y recálculo cuando ésta cambia.
// assoc = { p1?, p2?, c?: referencia de punto, obj?: id (círculo/arco), l1?, l2?: ids (líneas de una cota angular) }
// Referencia de punto: {id, snap, i} (índice en la lista de referencias a objetos de la entidad) o {ids: [a, b], snap: 'int'}
import * as G from './geom.js';
import { snapsOf, primsOf } from './entities.js';

const PT_KEYS = ['p1', 'p2', 'c'];
// Tipos a los que no se asocia una cota (también se mueven por asociatividad o no tienen geometría estable)
export const NO_ASSOC = new Set(['dim', 'mleader', 'hatch', 'table']);

const refIds = r => (r == null ? [] : typeof r === 'number' ? [r] : r.ids || [r.id]);
export const dimRefIds = e => (e.assoc ? Object.values(e.assoc).flatMap(refIds) : []);

// Posición actual del punto referenciado (null si ya no existe)
export function refPoint(ref, get, old) {
  if (ref.snap === 'int') {
    const a = get(ref.ids[0]), b = get(ref.ids[1]);
    if (!a || !b) return null;
    let best = null, bd = Infinity;
    const pa = primsOf(a), pb = a === b ? pa : primsOf(b);
    for (const q1 of pa) for (const q2 of pb) {
      if (q1 === q2) continue;
      for (const p of G.primInt(q1, q2)) { const d = old ? G.dist(p, old) : 0; if (d < bd) { bd = d; best = p; } }
    }
    return best;
  }
  const e = get(ref.id);
  return (e && snapsOf(e)[ref.snap]?.[ref.i]) || null;
}

const clean = e => { if (e.assoc && !Object.keys(e.assoc).length) delete e.assoc; };

// Copias: las referencias a entidades copiadas a la vez pasan a las copias; las demás se pierden
export function remapDim(e, map) {
  if (!e.assoc) return;
  const A = e.assoc;
  for (const k of Object.keys(A)) {
    const ids = refIds(A[k]);
    if (!ids.every(id => map.has(id))) { delete A[k]; continue; }
    const r = A[k];
    A[k] = typeof r === 'number' ? map.get(r) : r.ids ? { ...r, ids: r.ids.map(id => map.get(id)) } : { ...r, id: map.get(r.id) };
  }
  clean(e);
}

// Quita las referencias a entidades borradas
export function dropMissing(e, get) {
  if (!e.assoc) return;
  for (const k of Object.keys(e.assoc)) if (refIds(e.assoc[k]).some(id => !get(id))) delete e.assoc[k];
  clean(e);
}

const linesX = (a, b) => G.llInt(a.p1, a.p2, b.p1, b.p2);
// Base de una cota angular entre dos líneas: vértice y extremo más alejado de cada una
export function angBase(a, b) {
  const X = linesX(a, b);
  if (!X) return null;
  const l1 = [a.p1, a.p2], l2 = [b.p1, b.p2], far = l => (G.dist(l[0], X.p) > G.dist(l[1], X.p) ? l[0] : l[1]);
  return { c: X.p, p1: far(l1), p2: far(l2), l1, l2 };
}

// Recalcula los puntos de la cota a partir de su geometría. Devuelve false si la asociación ya no es válida.
export function updateDim(e, get) {
  const A = e.assoc;
  if (!A) return true;
  if (A.obj != null) {
    const o = get(A.obj);
    if (!o || (o.type !== 'circle' && o.type !== 'arc')) return false;
    if (e.kind === 'rad' || e.kind === 'dia') {
      const a = G.ang(e.p1, e.p2), r0 = G.dist(e.p1, e.p2), k = r0 > 1e-12 ? o.r / r0 : 1;
      e.p3 = G.add(o.c, G.mul(G.sub(e.p3, e.p1), k));
      e.p1 = o.c; e.p2 = G.polar(o.c, a, o.r);
      return true;
    }
    const d = G.sub(o.c, e.c);
    e.p3 = G.add(e.p3, d);
    if (o.type === 'arc') { e.c = o.c; e.p1 = G.polar(o.c, o.a1, o.r); e.p2 = G.polar(o.c, o.a2, o.r); return true; }
    const a = G.ang(e.c, e.p1);
    e.c = o.c; e.p1 = G.polar(o.c, a, o.r);
    e.p2 = (A.p2 && refPoint(A.p2, get, e.p2)) || G.add(e.p2, d);
    return true;
  }
  if (A.l1 != null) {
    const a = get(A.l1), b = get(A.l2);
    if (a?.type !== 'line' || b?.type !== 'line') return false;
    const base = angBase(a, b);
    if (!base) return false;
    e.p3 = G.add(e.p3, G.sub(base.c, e.c));
    Object.assign(e, base);
    return true;
  }
  const q = {};
  for (const k of PT_KEYS) if (A[k]) { q[k] = refPoint(A[k], get, e[k]); if (!q[k]) return false; }
  const np = k => q[k] || e[k];
  if (e.kind === 'ang') {
    e.p3 = G.add(e.p3, G.sub(np('c'), e.c));
    e.c = np('c'); e.p1 = np('p1'); e.p2 = np('p2');
    return true;
  }
  if (e.kind === 'ord') {
    e.p3 = G.add(e.p3, G.sub(np('p1'), e.p1));
    e.p1 = e.p2 = np('p1');
    return true;
  }
  const a = np('p1'), b = np('p2');
  if (e.kind === 'ali' && G.dist(e.p1, e.p2) > 1e-12 && G.dist(a, b) > 1e-12) {
    // Mantiene la separación de la línea de cota respecto a los puntos acotados
    const L = G.dist(e.p1, e.p2), u = G.norm(G.sub(e.p2, e.p1)), v = G.sub(e.p3, e.p1);
    const s = G.dot(v, u) / L, d = G.cross(u, v);
    const L2 = G.dist(a, b), u2 = G.norm(G.sub(b, a));
    e.p3 = G.add(G.add(a, G.mul(u2, s * L2)), G.mul(G.perp(u2), d));
  } else e.p3 = G.add(e.p3, G.mul(G.add(G.sub(a, e.p1), G.sub(b, e.p2)), 0.5));
  e.p1 = a; e.p2 = b;
  return true;
}
