// Bloques dinámicos: parámetros lineales (estiramiento), de rotación, simetría, visibilidad y tabla de consulta.
/** @typedef {import('./types').Entity} Entity */
/** @typedef {import('./types').Point} Point */
/** @typedef {import('./types').BBox} BBox */
/** @typedef {import('./types').Matrix} Matrix */
/** @typedef {import('./types').DynDef} DynDef */
// @ts-check
// Definición: b.dyn = {
//   vis?:  {states, hide: {estado: [índices]}, pos},
//   flip?: {a, b},
//   lins?: [{name, p1, p2, rect, ents: [índices], min?, max?}]   (lin: un único parámetro lineal, formato de la v0.5)
//   rots?: [{name, c, p, ents: [índices]}]                        (c: centro; p: pinzamiento en el ángulo base)
//   look?: {name, pos, cols: ['lin:Nombre' | 'rot:Nombre' | 'vis' | 'flip'], rows: [{label, vals: [valor por columna]}]}
// }
// Referencia: e.dyn = { vis, flip, len: {nombre: distancia}, ang: {nombre: ángulo absoluto en radianes} }
// (dist: distancia del primer parámetro lineal, formato de la v0.5). Lo que falte toma el valor por defecto del bloque.
// Las tablas de consulta guardan las distancias en unidades del bloque y los ángulos en grados.
// Los índices se refieren al orden de b.ents; en el editor de bloques se trabajan como identificadores.
import * as G from './geom.js';
import { ENV, xformEnt, insertMatrix } from './entities.js';
import { stretchEntity } from './ops.js';
const { Mx } = G;

const D = () => ENV.doc;
/** Parámetros lineales. @param {DynDef | null | undefined} d @returns {import('./types').DynLinear[]} */
export const linsOf = d => d?.lins || (d?.lin ? [d.lin] : []);
/** Parámetros de rotación. @param {DynDef | null | undefined} d @returns {import('./types').DynRotation[]} */
export const rotsOf = d => d?.rots || [];
const baseAng = r => G.ang(r.c, r.p);
/** Estado inicial de las referencias del bloque. @param {import('./types').Block | undefined} b */
export function dynDefaults(b) {
  const d = b.dyn;
  return {
    vis: d?.vis?.states?.[0], flip: false,
    len: Object.fromEntries(linsOf(d).map(l => [l.name, G.dist(l.p1, l.p2)])),
    ang: Object.fromEntries(rotsOf(d).map(r => [r.name, baseAng(r)])),
  };
}
/** Estado de la referencia (con los valores por defecto del bloque). @param {import('./types').Block | undefined} b @param {import('./types').Insert} e */
export function dynState(b, e) {
  const def = dynDefaults(b), x = e.dyn || {}, lins = linsOf(b.dyn);
  const len = { ...def.len, ...(x.dist != null && lins[0] ? { [lins[0].name]: x.dist } : {}), ...x.len };
  return { vis: x.vis ?? def.vis, flip: !!(x.flip ?? def.flip), len, ang: { ...def.ang, ...x.ang } };
}
/** @param {import('./types').Block | undefined} b @returns {boolean} */
export const isDynamic = b => !!(b?.dyn && (b.dyn.vis || b.dyn.flip || linsOf(b.dyn).length || rotsOf(b.dyn).length));
const clampLin = (l, v) => Math.max(1e-6, l.min != null ? Math.max(l.min, l.max != null ? Math.min(l.max, v) : v) : l.max != null ? Math.min(l.max, v) : v);

// Entidades del bloque (copias, en coordenadas del bloque) según el estado de la referencia
/** Entidades del bloque con el estado de la referencia aplicado. @param {import('./types').Block | undefined} b @param {import('./types').Insert} e @param {Entity[]} ents @returns {Entity[]} */
export function applyDyn(b, e, ents) {
  const d = b.dyn, s = dynState(b, e);
  let out = ents.map((x, i) => ({ x, i }));
  if (d.vis?.states?.length) { const hide = new Set(d.vis.hide?.[s.vis] || []); out = out.filter(o => !hide.has(o.i)); }
  for (const L of linsOf(d)) {
    const u = G.norm(G.sub(L.p2, L.p1)), delta = G.mul(u, s.len[L.name] - G.dist(L.p1, L.p2));
    if (G.len(delta) > 1e-12) { const set = new Set(L.ents); out = out.map(o => (set.has(o.i) ? { ...o, x: stretchEntity(o.x, L.rect, delta) || o.x } : o)); }
  }
  for (const r of rotsOf(d)) {
    const da = s.ang[r.name] - baseAng(r);
    if (Math.abs(da) > 1e-12) { const set = new Set(r.ents), m = Mx.R(da, r.c); out = out.map(o => (set.has(o.i) ? { ...o, x: xformEnt(o.x, m) } : o)); }
  }
  if (d.flip && s.flip) { const m = Mx.Mi(d.flip.a, d.flip.b); out = out.map(o => ({ ...o, x: xformEnt(o.x, m) })); }
  return out.map(o => o.x);
}

// ---------- Tabla de consulta ----------
// Valor actual de una columna en el estado s
const colVal = (s, k) => (k === 'vis' ? s.vis : k === 'flip' ? s.flip : k.startsWith('lin:') ? s.len[k.slice(4)] : k.startsWith('rot:') ? G.deg(s.ang[k.slice(4)]) : undefined);
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a)) : a === b);
// Columnas válidas de una tabla (las de parámetros que siguen existiendo)
/** Columnas de la tabla de consulta. @param {DynDef} d */
export function lookupCols(d) {
  const ok = new Set([...linsOf(d).map(l => `lin:${l.name}`), ...rotsOf(d).map(r => `rot:${r.name}`), ...(d?.vis?.states?.length ? ['vis'] : []), ...(d?.flip ? ['flip'] : [])]);
  return ok;
}
// Fila de la tabla que coincide con el estado de la referencia (las celdas vacías no cuentan), o null
/** Fila de la tabla de consulta que coincide con el estado (o null). @param {import('./types').Block | undefined} b @param {import('./types').Insert} e
 * @returns {{label: string, vals: unknown[]} | null} */
export function lookupRow(b, e) {
  const t = b.dyn?.look;
  if (!t?.rows?.length) return null;
  const s = dynState(b, e), ok = lookupCols(b.dyn);
  const eq = (k, a, v) => (k.startsWith('rot:') ? Math.abs(((a - +v) % 360 + 540) % 360 - 180) <= 1e-6 : same(a, k === 'flip' ? !!v : k === 'vis' ? v : +v));
  return t.rows.find(r => t.cols.every((k, j) => !ok.has(k) || r.vals[j] == null || r.vals[j] === '' || eq(k, colVal(s, k), r.vals[j]))) || null;
}
// Aplica una fila de la tabla al estado de una referencia
/** @param {import('./types').Block | undefined} b @param {import('./types').Insert} e @param {{label: string, vals: unknown[]}} row */
export function applyLookupRow(b, e, row) {
  const t = b.dyn.look, s = dynState(b, e), ok = lookupCols(b.dyn);
  t.cols.forEach((k, j) => {
    const v = row.vals[j];
    if (!ok.has(k) || v == null || v === '') return;
    if (k === 'vis') { if (b.dyn.vis.states.includes(/** @type {string} */ (v))) s.vis = /** @type {string} */ (v); }
    else if (k === 'flip') s.flip = !!v;
    else if (k.startsWith('lin:')) { const l = linsOf(b.dyn).find(x => x.name === k.slice(4)); s.len[l.name] = clampLin(l, +v); }
    else s.ang[k.slice(4)] = G.rad(+v);
  });
  e.dyn = s;
}

// Pinzamientos dinámicos de una referencia: [{p, kind: 'lin'|'rot'|'flip'|'vis'|'look', i}] en coordenadas del dibujo
/** @param {import('./types').Insert} e @returns {import('./types').Grip[]} */
export function dynGrips(e) {
  const b = D()?.blocks?.[e.name];
  if (!isDynamic(b)) return [];
  const M = insertMatrix(e, b), s = dynState(b, e), d = b.dyn, out = [];
  linsOf(d).forEach((l, i) => { const u = G.norm(G.sub(l.p2, l.p1)); out.push({ p: Mx.ap(M, G.add(l.p1, G.mul(u, s.len[l.name]))), kind: 'lin', i }); });
  rotsOf(d).forEach((r, i) => out.push({ p: Mx.ap(M, G.polar(r.c, s.ang[r.name], G.dist(r.c, r.p))), kind: 'rot', i }));
  if (d.flip) out.push({ p: Mx.ap(M, G.mid(d.flip.a, d.flip.b)), kind: 'flip' });
  if (d.vis?.states?.length > 1) out.push({ p: Mx.ap(M, d.vis.pos || b.base), kind: 'vis' });
  if (d.look?.rows?.length) out.push({ p: Mx.ap(M, d.look.pos || b.base), kind: 'look' });
  return out;
}
// Arrastre de un pinzamiento dinámico: el lineal cambia la distancia, el de rotación el ángulo;
// los de simetría, visibilidad y consulta pasan al estado o fila siguiente
/** @param {import('./types').Insert} e @param {number} i @param {Point} p */
export function dynMoveGrip(e, i, p) {
  const b = D()?.blocks?.[e.name], g = dynGrips(e)[i];
  if (!g) return;
  const s = dynState(b, e), d = b.dyn, q = () => Mx.ap(invert(insertMatrix(e, b)), p);
  if (g.kind === 'lin') {
    const l = linsOf(d)[g.i], u = G.norm(G.sub(l.p2, l.p1));
    s.len[l.name] = clampLin(l, G.dot(G.sub(q(), l.p1), u));
  } else if (g.kind === 'rot') {
    const r = rotsOf(d)[g.i];
    s.ang[r.name] = G.ang(r.c, q());
  } else if (g.kind === 'flip') s.flip = !s.flip;
  else if (g.kind === 'vis') { const st = d.vis.states; s.vis = st[(st.indexOf(s.vis) + 1) % st.length]; }
  else if (g.kind === 'look') {
    const rows = d.look.rows, cur = lookupRow(b, e);
    applyLookupRow(b, e, rows[cur ? (rows.indexOf(cur) + 1) % rows.length : 0]);
    return;
  }
  e.dyn = s;
}
/** @param {import('./types').Matrix} m @returns {import('./types').Matrix} */
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
// Propiedades «Personalizado» de una referencia dinámica
/** Propiedades «Personalizado» de la referencia. @param {import('./types').Insert} e */
export function dynProps(e) {
  const b = D()?.blocks?.[e.name];
  if (!isDynamic(b)) return [];
  const d = b.dyn, upd = fn => x => { const s = dynState(b, x); fn(s); x.dyn = s; };
  /** @type {import('./types').PropItem<import('./types').Insert>[]} */
  const out = [{ sec: 'Personalizado' }];
  if (d.look?.rows?.length) {
    out.push({ label: d.look.name || 'Consulta', type: 'select', options: x => [...(lookupRow(b, x) ? [] : [['', '(Personalizado)']]), ...d.look.rows.map((r, i) => [String(i), r.label])],
      get: x => { const r = lookupRow(b, x); return r ? String(d.look.rows.indexOf(r)) : ''; },
      set: (x, v) => { if (v !== '') applyLookupRow(b, x, d.look.rows[+v]); } });
  }
  if (d.vis?.states?.length) out.push({ label: 'Visibilidad', type: 'select', options: () => d.vis.states.map(s => [s, s]), get: x => dynState(b, x).vis, set: (x, v) => upd(s => { s.vis = v; })(x) });
  if (d.flip) out.push({ label: 'Simetría', type: 'bool', get: x => !!dynState(b, x).flip, set: (x, v) => upd(s => { s.flip = v; })(x) });
  for (const l of linsOf(d)) out.push({ label: l.name || 'Distancia', type: 'num', get: x => dynState(b, x).len[l.name], set: (x, v) => { if (v > 0) upd(s => { s.len[l.name] = clampLin(l, v); })(x); } });
  for (const r of rotsOf(d)) out.push({ label: r.name || 'Ángulo', type: 'ang', get: x => dynState(b, x).ang[r.name], set: (x, v) => upd(s => { s.ang[r.name] = v; })(x) });
  return out;
}

// Conversión de índices ↔ identificadores (editor de bloques). Los parámetros lineales de la v0.5 pasan a la lista lins.
/** Cambia las referencias a entidades de los parámetros (índices ↔ identificadores). @param {DynDef | null | undefined} dyn @param {(x: number) => number | undefined} f @returns {DynDef | null} */
export function remapDyn(dyn, f) {
  if (!dyn) return dyn;
  const list = l => (l || []).map(f).filter(v => v != null);
  const out = JSON.parse(JSON.stringify(dyn));
  if (out.lin) { out.lins = [out.lin, ...(out.lins || [])]; delete out.lin; }
  if (out.lins) out.lins = out.lins.map(l => ({ ...l, ents: list(l.ents) }));
  if (out.rots) out.rots = out.rots.map(r => ({ ...r, ents: list(r.ents) }));
  if (out.vis) out.vis.hide = Object.fromEntries(Object.entries(dyn.vis.hide || {}).map(([k, l]) => [k, list(l)]));
  return out;
}

ENV.applyDyn = applyDyn;
ENV.dynGrips = dynGrips;
ENV.dynMoveGrip = dynMoveGrip;
ENV.dynProps = dynProps;
