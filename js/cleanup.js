// Limpieza y comprobación del dibujo: objetos duplicados o solapados (OVERKILL) y revisión y reparación (AUDIT).
/** @typedef {import('./document.js').Doc} Doc */
/** @typedef {import('./types').Entity} Entity */
/** @typedef {import('./types').Point} Point */
// @ts-check
import * as G from './geom.js';
import { TYPES } from './entities.js';
import { cleanGroups } from './groups.js';
import { consValid } from './constraints.js';

/** @type {Record<string, string>} */
export const OK_PROPS = { color: 'Color', layer: 'Capa', ltype: 'Tipo de línea', lw: 'Grosor de línea', pstyle: 'Estilo de trazado' };
export const OK_DEFAULTS = { tol: 1e-6, ignore: [], plines: true, overlap: true, endToEnd: false };
const SKIP = new Set(['id', '_xf', 'assoc', 'seed', 'pathId']);

// Clave de comparación: copia sin identificador ni propiedades ignoradas, con los números redondeados a la tolerancia
function keyOf(e, tol, ignore) {
  const r = v => (typeof v === 'number' ? Math.round(v / tol) : Array.isArray(v) ? v.map(r) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => !SKIP.has(k) && !ignore.has(k)).map(k => [k, r(v[k])])) : v);
  let x = e;
  if (e.type === 'line') { // la dirección no importa
    const a = r(e.p1), b = r(e.p2);
    x = { ...e, p1: a.x < b.x || (a.x === b.x && a.y <= b.y) ? e.p1 : e.p2, p2: a.x < b.x || (a.x === b.x && a.y <= b.y) ? e.p2 : e.p1 };
  } else if (e.type === 'pline' && e.pts.length <= 400) { // tampoco el sentido ni, si es cerrada, el vértice inicial
    const variants = plVariants(e).map(v => JSON.stringify(r({ ...e, pts: v.pts, bulges: v.bulges })));
    return variants.sort()[0];
  } else if (e.type === 'circle' || e.type === 'arc') x = { ...e, ...(e.type === 'arc' ? { a1: G.normAng(e.a1), a2: G.normAng(e.a2) } : {}) };
  return JSON.stringify(r(x));
}
function plVariants(e) {
  const n = e.pts.length, bl = i => e.bulges?.[i] || 0, out = [];
  const make = (idx, rev) => {
    const pts = idx.map(i => e.pts[i]);
    const bulges = idx.map((i, k) => (rev ? -bl(e.closed ? (i - 1 + n) % n : idx[k + 1] ?? -1) : bl(i)));
    return { pts, bulges: bulges.some(b => b) ? bulges.map(b => b || 0) : undefined };
  };
  const seq = (s, rev) => Array.from({ length: n }, (_, k) => (rev ? (s - k + n) % n : (s + k) % n));
  if (!e.closed) { out.push(make(seq(0, false), false)); out.push(make(seq(n - 1, true), true)); return out; }
  for (let s = 0; s < n; s++) { out.push(make(seq(s, false), false)); out.push(make(seq(s, true), true)); }
  return out;
}

// OVERKILL sobre las entidades ids. Devuelve {dup, merged, verts}. Debe llamarse dentro de una transacción.
/** OVERKILL: suprime duplicados y combina solapes. @param {Doc} doc @param {number[]} ids
 * @param {{tol?: number, ignore?: string[], plines?: boolean, overlap?: boolean, endToEnd?: boolean}} [opts] @returns {{dup: number, merged: number, verts: number}} */
export function overkill(doc, ids, opts = {}) {
  const o = { ...OK_DEFAULTS, ...opts }, tol = Math.max(o.tol, 1e-12), ignore = new Set(o.ignore);
  let ents = ids.map(id => doc.get(id)).filter(e => e && TYPES[e.type] && e.type !== 'vport');
  const res = { dup: 0, merged: 0, verts: 0 };
  // 1. Polilíneas: vértices repetidos y vértices intermedios de tramos rectos alineados
  if (o.plines) {
    for (const e of ents) {
      if (e.type !== 'pline') continue;
      const p = optimizePline(e, tol);
      if (p && p.pts.length < e.pts.length) { res.verts += e.pts.length - p.pts.length; doc.modify(e.id, x => { x.pts = p.pts; if (p.bulges) x.bulges = p.bulges; else delete x.bulges; }); }
    }
  }
  // 2. Duplicados exactos (dentro de la tolerancia): se conserva el primero en el orden de dibujo
  const order = new Map(doc.ents.map((e, i) => [e.id, i]));
  ents.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const seen = new Map(), gone = new Set();
  for (const e of ents) {
    const k = keyOf(e, tol, ignore);
    if (seen.has(k)) { doc.remove(e.id); gone.add(e.id); res.dup++; } else seen.set(k, e);
  }
  ents = ents.filter(e => !gone.has(e.id));
  const propKey = e => Object.keys(OK_PROPS).filter(k => !ignore.has(k)).map(k => String(e[k] ?? '')).join('|');
  // 3. Líneas colineales que se solapan (o que se tocan por los extremos, si se pide): se combinan en una
  if (o.overlap || o.endToEnd) {
    const lines = ents.filter(e => e.type === 'line' && G.dist(e.p1, e.p2) > tol);
    const groups = new Map();
    for (const e of lines) { const k = propKey(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    for (const list of groups.values()) res.merged += mergeLines(doc, list, tol, o.endToEnd);
    // Arcos y círculos del mismo centro y radio
    const arcs = /** @type {(import('./types').Arc | import('./types').Circle)[]} */ (ents.filter(e => (e.type === 'arc' || e.type === 'circle') && doc.get(e.id)));
    const ag = new Map();
    for (const e of arcs) { const k = `${propKey(e)}|${Math.round(e.c.x / tol)}|${Math.round(e.c.y / tol)}|${Math.round(e.r / tol)}`; if (!ag.has(k)) ag.set(k, []); ag.get(k).push(e); }
    for (const list of ag.values()) if (list.length > 1) res.merged += mergeArcs(doc, list, tol, o.endToEnd);
  }
  return res;
}

function optimizePline(e, tol) {
  const n = e.pts.length, bl = i => e.bulges?.[i] || 0;
  let pts = e.pts.map((p, i) => ({ p, b: bl(i) }));
  // vértices repetidos (tramos de longitud nula)
  pts = pts.filter((v, i) => i === 0 || G.dist(v.p, pts[i - 1].p) > tol);
  if (e.closed && pts.length > 1 && G.dist(pts[0].p, pts.at(-1).p) <= tol) pts.pop();
  // vértices intermedios de dos tramos rectos alineados y del mismo sentido
  for (let changed = true; changed && pts.length > 2;) {
    changed = false;
    const m = pts.length;
    for (let i = e.closed ? 0 : 1; i < (e.closed ? m : m - 1); i++) {
      const a = pts[(i - 1 + m) % m], v = pts[i], c = pts[(i + 1) % m];
      if (a.b || v.b) continue;
      const d = G.sub(c.p, a.p), L = G.len(d);
      if (L <= tol) continue;
      if (Math.abs(G.cross(d, G.sub(v.p, a.p))) / L <= tol && G.dot(G.sub(v.p, a.p), G.sub(c.p, v.p)) > 0) { pts.splice(i, 1); changed = true; break; }
    }
    if (pts.length <= (e.closed ? 3 : 2)) break;
  }
  if (pts.length === n || pts.length < 2) return null;
  return { pts: pts.map(v => v.p), bulges: pts.some(v => v.b) ? pts.map(v => v.b) : null };
}

function mergeLines(doc, list, tol, endToEnd) {
  let removed = 0;
  const used = new Set();
  for (let i = 0; i < list.length; i++) {
    const A = list[i];
    if (used.has(A.id)) continue;
    const u = G.norm(G.sub(A.p2, A.p1)), coll = [A];
    for (let j = i + 1; j < list.length; j++) {
      const B = list[j];
      if (used.has(B.id)) continue;
      const d1 = Math.abs(G.cross(u, G.sub(B.p1, A.p1))), d2 = Math.abs(G.cross(u, G.sub(B.p2, A.p1)));
      if (d1 <= tol && d2 <= tol) coll.push(B);
    }
    if (coll.length < 2) continue;
    // intervalos sobre la recta de A, ordenados; se unen los que se solapan (o se tocan)
    const iv = coll.map(e => { const t1 = G.dot(G.sub(e.p1, A.p1), u), t2 = G.dot(G.sub(e.p2, A.p1), u); return { e, a: Math.min(t1, t2), b: Math.max(t1, t2) }; }).sort((x, y) => x.a - y.a);
    let cur = null;
    const flush = () => {
      if (!cur || cur.items.length < 2) return;
      const keep = cur.items.find(x => x.e === A) || cur.items[0];
      for (const x of cur.items) if (x !== keep) { doc.remove(x.e.id); removed++; }
      doc.modify(keep.e.id, x => { x.p1 = G.add(A.p1, G.mul(u, cur.a)); x.p2 = G.add(A.p1, G.mul(u, cur.b)); });
    };
    for (const x of iv) {
      used.add(x.e.id);
      if (cur && (x.a < cur.b - tol || (endToEnd && x.a <= cur.b + tol))) { cur.b = Math.max(cur.b, x.b); cur.items.push(x); }
      else { flush(); cur = { a: x.a, b: x.b, items: [x] }; }
    }
    flush();
  }
  return removed;
}

function mergeArcs(doc, list, tol, endToEnd) {
  let removed = 0;
  const circle = list.find(e => e.type === 'circle');
  if (circle) { for (const e of list) if (e !== circle) { doc.remove(e.id); removed++; } return removed; }
  const at = tol / list[0].r; // tolerancia angular
  let arcs = list.map(e => ({ e, a: G.normAng(e.a1), s: G.sweep(e.a1, e.a2) }));
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < arcs.length; i++) for (let j = 0; j < arcs.length; j++) {
      if (i === j) continue;
      const A = arcs[i], B = arcs[j], off = G.normAng(B.a - A.a); // inicio de B medido desde el de A
      if (off < A.s - at || (endToEnd && off <= A.s + at) || off > G.TAU - at) {
        const end = Math.max(A.s, (off > G.TAU - at ? off - G.TAU : off) + B.s);
        A.s = Math.min(G.TAU, end);
        doc.remove(B.e.id); removed++;
        arcs.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  for (const A of arcs) {
    const e = doc.get(A.e.id);
    if (!e) continue;
    if (A.s >= G.TAU - at) doc.modify(e.id, x => { x.type = 'circle'; delete x.a1; delete x.a2; });
    else if (Math.abs(G.normAng(e.a1) - A.a) > 1e-12 || Math.abs(G.sweep(e.a1, e.a2) - A.s) > 1e-12) doc.modify(e.id, x => { x.a1 = A.a; x.a2 = G.normAng(A.a + A.s); });
  }
  return removed;
}

// ---------- AUDIT ----------
const finite = v => (typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finite) : v && typeof v === 'object' ? Object.values(v).every(finite) : true);
const label = e => `${TYPES[e.type]?.name || e.type || 'objeto'}${e.id != null ? ` (id ${e.id})` : ''}`;

// Revisa el dibujo y, con fix, corrige lo que encuentra. Devuelve la lista de errores (textos) y cuántos se corrigieron.
// Debe llamarse dentro de una transacción si fix es verdadero.
/** AUDIT: comprueba (y con fix, corrige) la estructura del dibujo. @param {Doc} doc @param {boolean} fix */
export function audit(doc, fix) {
  const errs = [];
  let fixed = 0;
  const err = (msg, repair) => { errs.push(msg); if (fix && repair) { repair(); fixed++; } };
  // Capas
  if (!doc.layers.some(l => l.name === '0')) err('Falta la capa "0"', () => doc.layers.unshift({ name: '0', color: '#ffffff', ltype: 'CONTINUOUS', lw: 'DEFAULT', on: true, lock: false }));
  const lnames = new Set();
  for (const l of [...doc.layers]) {
    if (!l.name || lnames.has(l.name.toLowerCase())) err(`Capa duplicada o sin nombre: "${l.name}"`, () => { doc.layers = doc.layers.filter(x => x !== l); });
    else lnames.add(l.name.toLowerCase());
    if (!/^#[0-9a-f]{6}$/i.test(l.color || '')) err(`Capa "${l.name}": color no válido`, () => { l.color = '#ffffff'; });
  }
  const hasLayer = n => doc.layers.some(l => l.name === n);
  const names = list => new Set(list.map(s => s.name));
  const tst = names(doc.textStyles), dst = names(doc.dimStyles), mst = names(doc.mleaderStyles), tbs = names(doc.tableStyles), mls = names(doc.mlineStyles);
  // Entidades de todos los espacios y de los bloques
  const ids = new Set();
  let maxId = 0;
  const checkList = (arr, where, top) => {
    for (const e of [...arr]) {
      const drop = () => { const i = arr.indexOf(e); if (i >= 0) arr.splice(i, 1); };
      if (!e || !TYPES[e.type]) { err(`${where}: objeto de tipo desconocido (${e?.type})`, drop); continue; }
      if (!finite(e)) { err(`${where}: ${label(e)} con coordenadas no válidas`, drop); continue; }
      if (top) {
        if (e.id == null || ids.has(e.id)) err(`${where}: ${label(e)} con identificador repetido`, () => { e.id = doc.nextId++; });
        ids.add(e.id); maxId = Math.max(maxId, e.id || 0);
      }
      if (!hasLayer(e.layer)) err(`${where}: ${label(e)} en la capa inexistente "${e.layer}"`, () => { e.layer = '0'; });
      if (e.type === 'insert' && !doc.blocks[e.name]) { err(`${where}: ${label(e)} hace referencia al bloque inexistente "${e.name}"`, drop); continue; }
      if ((e.type === 'line' && G.dist(e.p1, e.p2) === 0) || ((e.type === 'circle' || e.type === 'arc') && !(e.r > 0))) { err(`${where}: ${label(e)} de longitud o radio nulo`, drop); continue; }
      if ((e.type === 'pline' || e.type === 'spline' || e.type === 'mline') && !((e.pts || e.ctrl)?.length >= 2)) { err(`${where}: ${label(e)} con menos de dos vértices`, drop); continue; }
      if (e.type === 'hatch' && !e.loops?.some(l => l.length >= 3)) { err(`${where}: ${label(e)} sin contornos`, drop); continue; }
      if (e.type === 'vport' && where === 'Modelo') { err(`Modelo: ventana gráfica fuera de una presentación`, drop); continue; }
      if (['text', 'mtext', 'attdef'].includes(e.type) && e.style && !tst.has(e.style)) err(`${where}: ${label(e)} con el estilo de texto inexistente "${e.style}"`, () => { e.style = 'Standard'; });
      if (e.type === 'dim' && e.style && !dst.has(e.style)) err(`${where}: ${label(e)} con el estilo de cota inexistente "${e.style}"`, () => { e.style = doc.dimStyles[0].name; });
      if (e.type === 'mleader' && e.mstyle && !mst.has(e.mstyle)) err(`${where}: ${label(e)} con el estilo de directriz inexistente "${e.mstyle}"`, () => { e.mstyle = doc.mleaderStyles[0].name; });
      if (e.type === 'table' && e.tstyle && !tbs.has(e.tstyle)) err(`${where}: ${label(e)} con el estilo de tabla inexistente "${e.tstyle}"`, () => { e.tstyle = doc.tableStyles[0].name; });
      if (e.type === 'mline' && e.mlstyle && !mls.has(e.mlstyle)) err(`${where}: ${label(e)} con el estilo de línea múltiple inexistente "${e.mlstyle}"`, () => { e.mlstyle = doc.mlineStyles[0].name; });
      if (e.type === 'array' && e.src) checkList(e.src, `${where} › matriz`, false);
    }
  };
  checkList(doc.model, 'Modelo', true);
  doc.layouts.forEach(l => checkList(l.ents, `Presentación "${l.name}"`, true));
  if (doc.bedit) checkList(doc.bedit.ents, 'Editor de bloques', true);
  for (const [name, b] of Object.entries(doc.blocks)) {
    if (!b || !Array.isArray(b.ents)) { err(`Bloque "${name}" sin definición`, () => { delete doc.blocks[name]; }); continue; }
    if (b.name !== name) err(`Bloque "${name}": nombre interno distinto ("${b.name}")`, () => { b.name = name; });
    if (!b.base || !finite(b.base)) err(`Bloque "${name}": punto base no válido`, () => { b.base = { x: 0, y: 0 }; });
    checkList(b.ents, `Bloque "${name}"`, false);
    // Referencias circulares: un bloque que se inserta a sí mismo
    const self = b.ents.filter(e => e.type === 'insert' && (e.name === name || doc.refersTo([e], name)));
    for (const e of self) err(`Bloque "${name}": se inserta a sí mismo (referencia circular)`, () => { b.ents = b.ents.filter(x => x !== e); });
  }
  if (maxId >= doc.nextId) err('El contador de identificadores es menor que el último identificador usado', () => { doc.nextId = maxId + 1; });
  // Estado actual, grupos y restricciones
  if (!hasLayer(doc.cur.layer)) err(`La capa actual "${doc.cur.layer}" no existe`, () => { doc.cur.layer = '0'; });
  if (!tst.has(doc.cur.textStyle)) err(`El estilo de texto actual "${doc.cur.textStyle}" no existe`, () => { doc.cur.textStyle = 'Standard'; });
  if (!dst.has(doc.cur.dimStyle)) err(`El estilo de cota actual "${doc.cur.dimStyle}" no existe`, () => { doc.cur.dimStyle = doc.dimStyles[0].name; });
  if (fix) doc.reindex();
  const allIds = new Set([...doc.allEnts()].map(e => e.id));
  for (const g of doc.groups) if (g.ids.some(id => !allIds.has(id))) err(`Grupo "${g.name}" con objetos que ya no existen`, () => { g.ids = g.ids.filter(id => allIds.has(id)); });
  if (fix) cleanGroups(doc);
  const badCons = doc.constraints.filter(k => !consValid(doc, k));
  if (badCons.length) err(`${badCons.length} restricción(es) que hacen referencia a geometría inexistente`, () => { doc.constraints = doc.constraints.filter(k => consValid(doc, k)); });
  if (fix && fixed) doc.changed();
  return { errors: errs, fixed };
}
