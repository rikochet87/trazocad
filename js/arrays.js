// Matrices asociativas: rectangular, polar y a lo largo de un recorrido (ARRAYPATH), editables como un único objeto.
/** @typedef {import('./types').Entity} Entity */
/** @typedef {import('./types').Point} Point */
/** @typedef {import('./types').BBox} BBox */
/** @typedef {import('./types').Matrix} Matrix */
// @ts-check
// Entidad: {type: 'array', kind: 'rect'|'polar'|'path', src: [entidades de origen], base: punto base del origen, M: matriz local → dibujo,
//   rect:  rows, cols, dx (entre columnas), dy (entre filas), ra (ángulo de filas), lv (niveles), dz (separación entre niveles),
//   repl: {índice del elemento: [entidades que lo sustituyen]}
//   polar: c (centro), n, fill (ángulo a rellenar, con signo), rot (girar los elementos)
//   path:  path (copia del recorrido en coordenadas locales), pathId (recorrido asociado), method: 'divide'|'measure', n, sp, align}
// Todo se guarda en coordenadas locales; M recoge los desplazamientos, giros, escalas y simetrías aplicados después.
import * as G from './geom.js';
import { ENV, cloneEnt, xformEnt, bboxOf, bbUnion } from './entities.js';
import { pathOf } from './ops.js';
const { P, Mx } = G;

/** @type {Record<string, string>} */
export const ARRAY_KINDS = { rect: 'Rectangular', polar: 'Polar', path: 'Recorrido' };
/** ¿Puede ser recorrido de una matriz? @param {Entity | null | undefined} e @returns {boolean} */
export const pathable = e => ['line', 'arc', 'circle', 'pline', 'spline', 'ellipse'].includes(e?.type);
/** @type {[import('./types').ArrayEnt['method'], string][]} */
export const PATH_METHODS = [['measure', 'Medir (separación fija)'], ['divide', 'Dividir (repartir en todo el recorrido)']];
/** @param {import('./types').Matrix} m @returns {import('./types').Matrix} */
const inv = m => { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
/** Matriz local → dibujo. @param {{M?: Matrix}} e @returns {Matrix} */
export const arrayM = e => e.M || Mx.I();
/** @param {import('./types').ArrayEnt} e @param {Point} p @returns {Point} */
export const toLocal = (e, p) => Mx.ap(inv(arrayM(e)), p);
/** @param {import('./types').ArrayEnt} e @param {Point} p @returns {Point} */
export const toWorld = (e, p) => Mx.ap(arrayM(e), p);
/** @param {import('./types').ArrayEnt} e @returns {Matrix} */
export const arrayInv = e => inv(arrayM(e));
export const invertM = inv;
/** @param {import('./types').ArrayEnt} e @returns {number} */
export const rectLevels = e => Math.max(1, e.lv | 0 || 1);
// Matriz local del elemento `i` (con sus niveles, en el caso rectangular)
/** Matriz del elemento i en el dibujo. @param {import('./types').ArrayEnt} e @param {number} i @returns {Matrix} */
export const itemWorld = (e, i) => Mx.mul(arrayM(e), itemMatrices(e)[i] || Mx.I());
// Centro de la caja de las entidades de origen (punto base por defecto)
/** Centro de la caja de las entidades de origen. @param {Entity[]} ents @returns {Point} */
export function srcCenter(ents) {
  const b = ents.reduce((r, x) => bbUnion(r, bboxOf(x)), /** @type {import('./types').BBox | null} */ (null));
  return b ? P((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2) : P(0, 0);
}
// Recorrido local (copia del objeto del dibujo llevada a las coordenadas de la matriz)
/** Recorrido llevado a las coordenadas locales de la matriz. @param {{M?: Matrix}} e @param {Entity} pathEnt @returns {Entity} */
export const localPath = (e, pathEnt) => { const c = cloneEnt(pathEnt); delete c.id; return xformEnt(c, inv(arrayM(e))); };

// Posiciones del recorrido (distancias desde su inicio) según el método
/** Posiciones (punto y ángulo) de los elementos a lo largo del recorrido. @param {import('./types').ArrayEnt} e @param {import('./ops.js').Path | null} [pt] */
export function pathStations(e, pt = pathOf(e.path)) {
  if (!pt || !(pt.len > 1e-12)) return [];
  const n = Math.max(1, e.n | 0);
  if (e.method === 'divide') {
    if (n === 1) return [0];
    return Array.from({ length: n }, (_, k) => (pt.len * k) / (pt.closed ? n : n - 1));
  }
  const sp = Math.abs(e.sp) || pt.len;
  const max = Math.floor(pt.len / sp + 1e-9) + (pt.closed ? 0 : 1);
  return Array.from({ length: Math.min(n, Math.max(1, max)) }, (_, k) => k * sp);
}
// Número máximo de elementos que caben con la separación actual (Medir)
/** Elementos que caben en el recorrido con la separación sp. @param {import('./types').ArrayEnt} e @returns {number} */
export function pathFit(e) { const pt = pathOf(e.path), sp = Math.abs(e.sp); return pt && sp > 0 ? Math.floor(pt.len / sp + 1e-9) + (pt.closed ? 0 : 1) : 1; }

// Matrices locales de cada elemento
/** Matriz local de cada elemento. @param {import('./types').ArrayEnt} e @returns {Matrix[]} */
export function itemMatrices(e) {
  switch (e.kind) {
    case 'rect': {
      const out = [], ra = e.ra || 0, ca = Math.cos(ra), sa = Math.sin(ra);
      for (let l = 0; l < rectLevels(e); l++) for (let i = 0; i < Math.max(1, e.rows | 0); i++) for (let j = 0; j < Math.max(1, e.cols | 0); j++) out.push(Mx.T(j * e.dx - i * e.dy * sa, i * e.dy * ca));
      return out;
    }
    case 'polar': {
      const n = Math.max(1, e.n | 0), full = Math.abs(Math.abs(e.fill) - G.TAU) < 1e-9, step = n > 1 ? e.fill / (full ? n : n - 1) : 0;
      return Array.from({ length: n }, (_, k) => {
        const R = Mx.R(k * step, e.c);
        if (e.rot !== false) return R;
        const q = Mx.ap(R, e.base);
        return Mx.T(q.x - e.base.x, q.y - e.base.y);
      });
    }
    case 'path': {
      const pt = pathOf(e.path);
      if (!pt) return [Mx.I()];
      const a0 = pt.at(0).a;
      return pathStations(e, pt).map(s => {
        const { p, a } = pt.at(s);
        return Mx.mul(Mx.T(p.x, p.y), Mx.mul(Mx.R(e.align !== false ? a - a0 : 0), Mx.T(-e.base.x, -e.base.y)));
      });
    }
  }
  return [Mx.I()];
}

// Entidades de todos los elementos, en coordenadas del dibujo (con el identificador de la matriz)
const cache = new WeakMap();
/** Entidades de todos los elementos, en el dibujo. @param {import('./types').ArrayEnt} e @returns {Entity[]} */
export function arrayEnts(e) {
  const key = JSON.stringify([e.kind, e.rows, e.cols, e.dx, e.dy, e.ra, e.lv, e.dz, e.c, e.n, e.fill, e.rot, e.method, e.sp, e.align, e.base, e.M, e.path, e.layer, e.src.length, e.repl, e.ver || 0]);
  const hit = cache.get(e);
  if (hit && hit.key === key && hit.src === e.src) return hit.ents;
  const M = arrayM(e), ents = [], per = e.kind === 'rect' ? Math.max(1, e.rows | 0) * Math.max(1, e.cols | 0) : Infinity;
  let idx = 0;
  for (const L of itemMatrices(e)) {
    const W = Mx.mul(M, L), srcs = e.repl?.[idx] || e.src, z = e.kind === 'rect' && rectLevels(e) > 1 ? Math.floor(idx / per) * (e.dz || 0) : 0;
    for (const s of srcs) { const v = xformEnt(cloneEnt(s), W); v.id = e.id; if (z) v.z = (s.z || 0) + z; ents.push(v); }
    idx++;
  }
  cache.set(e, { key, src: e.src, ents });
  return ents;
}
/** @param {import('./types').ArrayEnt} e @returns {number} */
export const itemCount = e => itemMatrices(e).length;

// ---------- Pinzamientos ----------
// rect: base (desplaza), elemento (0,1) → separación entre columnas, elemento (1,0) → entre filas, último elemento → recuento
// polar: centro (desplaza), segundo elemento → ángulo entre elementos; path: base sobre el recorrido (desplaza)
/** @param {import('./types').ArrayEnt} e @returns {import('./types').Grip[]} */
export function arrayGrips(e) {
  const W = p => toWorld(e, p), b = e.base;
  if (e.kind === 'rect') {
    const rd = P(-Math.sin(e.ra || 0), Math.cos(e.ra || 0));
    const out = [{ p: W(b), kind: '' }];
    if (e.cols > 1) out.push({ p: W(G.add(b, P(e.dx, 0))), kind: 'cols' });
    if (e.rows > 1) out.push({ p: W(G.add(b, G.mul(rd, e.dy))), kind: 'rows' });
    out.push({ p: W(G.add(b, G.add(P((e.cols - 1) * e.dx + (e.cols > 1 ? 0 : e.dx || 1), 0), G.mul(rd, (e.rows - 1) * e.dy + (e.rows > 1 ? 0 : e.dy || 1))))), kind: 'count' });
    return out;
  }
  if (e.kind === 'polar') {
    const ms = itemMatrices(e), out = [{ p: W(e.c), kind: '' }];
    if (ms.length > 1) out.push({ p: W(Mx.ap(ms[1], b)), kind: 'step' });
    return out;
  }
  const ms = itemMatrices(e);
  return [{ p: W(Mx.ap(ms[0], b)), kind: '' }];
}
/** @param {import('./types').ArrayEnt} e @param {number} i @param {Point} p */
export function arrayMoveGrip(e, i, p) {
  const g = arrayGrips(e)[i];
  if (!g) return;
  if (!g.kind) { const d = G.sub(p, g.p); e.M = Mx.mul(Mx.T(d.x, d.y), arrayM(e)); e._xf = true; return; }
  const q = G.sub(toLocal(e, p), e.base);
  if (g.kind === 'cols') { if (Math.abs(q.x) > 1e-9) e.dx = q.x; }
  else if (g.kind === 'rows') { const d = G.dot(q, P(-Math.sin(e.ra || 0), Math.cos(e.ra || 0))); if (Math.abs(d) > 1e-9) e.dy = d; }
  else if (g.kind === 'count') {
    const rd = P(-Math.sin(e.ra || 0), Math.cos(e.ra || 0)), d = G.dot(q, rd), qc = G.sub(q, G.mul(rd, d));
    if (Math.abs(e.dx) > 1e-12) e.cols = Math.max(1, Math.min(1000, Math.round(qc.x / e.dx) + 1));
    if (Math.abs(e.dy) > 1e-12) e.rows = Math.max(1, Math.min(1000, Math.round(d / e.dy) + 1));
  } else if (g.kind === 'step') {
    const full = Math.abs(Math.abs(e.fill) - G.TAU) < 1e-9, a = G.ang(e.c, toLocal(e, p)) - G.ang(e.c, e.base);
    let step = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(step) < 1e-6) return;
    if (full && Math.abs(step * e.n) > G.TAU) step = Math.sign(step) * G.TAU / e.n;
    e.fill = step * (full ? e.n : e.n - 1);
  }
}

// ---------- Propiedades ----------
/** @param {string} label @param {(e: import('./types').ArrayEnt) => unknown} get @param {(e: import('./types').ArrayEnt, v: number) => void} set @returns {import('./types').PropItem<import('./types').ArrayEnt>} */
const num = (label, get, set) => ({ label, type: 'num', get, set });
/** Propiedad entera (de 1 a max) del campo key. @param {string} label @param {string} key @param {number} [max] @returns {import('./types').PropItem<import('./types').ArrayEnt>} */
const int = (label, key, max = 1000) => ({ label, type: 'num', get: e => e[key], set: (e, v) => { const k = Math.round(v); if (k >= 1 && k <= max) e[key] = k; } });
/** @param {import('./types').ArrayEnt} e */
export function arrayProps(e) {
  /** @type {import('./types').PropItem<import('./types').ArrayEnt>[]} */
  const out = [{ label: 'Tipo', type: 'text', get: x => ARRAY_KINDS[x.kind], ro: true }, { label: 'Elementos', type: 'int', get: x => itemCount(x), ro: true }];
  if (e.kind === 'rect') out.push(int('Columnas', 'cols'), num('Separación entre columnas', x => x.dx, (x, v) => { if (v) x.dx = v; }), int('Filas', 'rows'), num('Separación entre filas', x => x.dy, (x, v) => { if (v) x.dy = v; }),
    { label: 'Ángulo de filas (°)', type: 'num', get: x => G.deg(x.ra || 0), set: (x, v) => { x.ra = G.rad(v); } },
    { label: 'Niveles', type: 'num', get: x => rectLevels(x), set: (x, v) => { const n = Math.round(v); if (n >= 1 && n <= 1000) x.lv = n; } },
    num('Separación entre niveles', x => x.dz || 0, (x, v) => { x.dz = v; }),
    { label: 'Elementos sustituidos', type: 'int', get: x => Object.keys(x.repl || {}).length, ro: true });
  else if (e.kind === 'polar') out.push(int('Número de elementos', 'n'), num('Ángulo a rellenar (°)', x => G.deg(x.fill), (x, v) => { if (v) x.fill = G.rad(Math.max(-360, Math.min(360, v))); }),
    { label: 'Girar elementos', type: 'bool', get: x => x.rot !== false, set: (x, v) => { x.rot = v; } });
  else out.push({ label: 'Método', type: 'select', options: PATH_METHODS, get: x => x.method, set: (x, v) => { x.method = /** @type {'divide' | 'measure'} */ (v); if (v === 'measure' && x.n > pathFit(x)) x.n = pathFit(x); } },
    int('Número de elementos', 'n', 10000), num('Separación', x => x.sp, (x, v) => { if (v > 0) { x.sp = v; if (x.method === 'measure') x.n = Math.min(x.n, pathFit(x)); } }),
    { label: 'Alinear elementos', type: 'bool', get: x => x.align !== false, set: (x, v) => { x.align = v; } },
    { label: 'Asociada al recorrido', type: 'text', get: x => (x.pathId != null && ENV.doc?.get(x.pathId) ? 'Sí' : 'No'), ro: true });
  out.push({ label: 'Objetos de origen', type: 'int', get: x => x.src.length, ro: true });
  return out;
}

ENV.arrayEnts = arrayEnts;
ENV.arrayGrips = arrayGrips;
ENV.arrayMoveGrip = arrayMoveGrip;
ENV.arrayProps = arrayProps;
