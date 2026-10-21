// Comandos estilo AutoCAD. Cada comando es una función asíncrona que pide datos con el contexto `c`.
import * as G from './geom.js';
import { TYPES, cloneEnt, xformEnt, crosses, bboxOf, bbPts, describe, fmt, dimParts, plArea, plLength, plPieces, plPolygon, hatchArea, blockAttdefs, mlEff, fieldText, FIELD_PROPS, DATE_FORMATS, insertMatrix, LTYPES, primsOf, ellPts } from './entities.js';
import { entityLoop, chainLoops, booleanLoops, nestLoops, regionArea, regionPerimeter } from './region.js';
import { srcCenter, toLocal, itemCount, pathFit, localPath, pathable, ARRAY_KINDS, arrayInv, arrayM, invertM, itemWorld, itemMatrices, rectLevels } from './arrays.js';
import { rectClip } from './xclip.js';
import { mlineStyleRefs, MLEDIT_TOOLS, mlCross, mlTee, mlCorner, mlAddVertex, mlDelVertex, mlCutRange, nearestElem as mlNearestElem, sortedElems } from './mline.js';
import { readLas, writeLas } from './layerstates.js';
import { findBoundary, loopsOfEntity } from './hatch.js';
import { rebuild as rebuildSpline, splinePts } from './spline.js';
import { angBase, remapDim, updateDim, updateCenter } from './assoc.js';
import { parseSource, defineXref, detachXref, bindXref, xrefNames, xrefRefs, cleanXrefName } from './xref.js';
import * as OPS from './ops.js';
import { GRADIENTS, GRAD_DEFAULT, USER_DEFAULT, PATTERNS, parsePat, patText } from './patterns.js';
import { solve, evalParams, parseExpr, nearestPointRef, lineRefAt, refGeom, consDim, constrainable, entVals, refIds, GEOM_NAMES, autoConstrain, AUTO_TYPES, AUTO_DEFAULT } from './constraints.js';
import { makeGroup, removeGroup, findGroup, groupsOf, copyGroups, validGroupName, isAnonGroup, groupsWithin, nextAnonGroup } from './groups.js';
import { saveLayerState, restoreLayerState, findLayerState, validStateName, renameLayerState, deleteLayerState, LS_ALL } from './layerstates.js';
import { linsOf, rotsOf, lookupCols } from './dynblock.js';
const { P, Mx } = G;

export const CMDS = {};
function def(name, aliases, desc, fn, opts = {}) { CMDS[name] = { name, aliases, desc, fn, group: opts.group || '', ...opts }; }

const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
export function findCmd(s) {
  if (CMDS[s]) return CMDS[s];
  const k = strip(s.trim().replace(/^[_.']+/, ''));
  return CMDS[k] || Object.values(CMDS).find(d => d.aliases.includes(k));
}
export function suggest(s) {
  const k = strip(s.trim());
  if (!k) return [];
  const out = [];
  for (const d of Object.values(CMDS)) {
    if (d.hidden) continue;
    const hit = d.name.startsWith(k) ? 0 : d.aliases.some(a => a.startsWith(k)) ? 1 : -1;
    if (hit >= 0) out.push({ d, rank: (d.aliases.includes(k) || d.name === k ? -1 : hit) });
  }
  return out.sort((a, b) => a.rank - b.rank || a.d.name.localeCompare(b.d.name)).slice(0, 8).map(o => o.d);
}

const ghost = (c, ids, m) => ids.map(id => c.doc.get(id)).filter(Boolean).map(e => xformEnt(cloneEnt(e), m));
function applyX(c, ids, m, copy) {
  const map = new Map(), made = [];
  for (const id of ids) {
    const e = c.doc.get(id);
    if (!e) continue;
    if (copy) { const n = xformEnt(cloneEnt(e), m); delete n.id; c.doc.add(n); map.set(id, n.id); made.push(n); }
    else c.doc.modify(id, x => xformEnt(x, m));
  }
  remapAssoc(made, map);
  if (copy) copyGroups(c.doc, map); // un grupo copiado entero da lugar a un grupo sin nombre con las copias
}
// Un sombreado o una cota copiados junto con su geometría quedan asociados a las copias; copiados solos, dejan de ser asociativos
function remapAssoc(ents, map) {
  for (const n of ents) {
    if (n.type === 'array' && n.pathId != null) { if (map.has(n.pathId)) n.pathId = map.get(n.pathId); else delete n.pathId; continue; }
    if (!n.assoc) continue;
    if (n.type === 'dim') { remapDim(n, map); continue; }
    if (n.type === 'center') {
      const A = n.assoc;
      for (const k of ['a', 'b']) if (A[k] != null) { if (map.has(A[k])) A[k] = map.get(A[k]); else delete A[k]; }
      if (A.a == null) delete n.assoc; else if (A.b == null) delete A.b;
      continue;
    }
    if (n.assoc.every(id => map.has(id))) n.assoc = n.assoc.map(id => map.get(id));
    else { delete n.assoc; delete n.seed; }
  }
}
const rectPts = (a, b) => [a, P(b.x, a.y), b, P(a.x, b.y)];
const deg = r => fmt(G.deg(G.normAng(r)), 2) + '°';
const setPoly = (c, id, src) => c.doc.modify(id, e => { e.pts = src.pts; e.closed = src.closed; if (src.bulges?.some(b => b)) e.bulges = src.bulges; else delete e.bulges; });
const sendToBack = (c, e) => { const arr = c.doc.ents, i = arr.indexOf(e); if (i > 0) { arr.splice(i, 1); arr.unshift(e); c.doc.changed(); } };

// ================= DIBUJO =================
def('LINE', ['L', 'LINEA'], 'Dibuja segmentos de línea rectos', async c => {
  const first = await c.getPoint('Precise primer punto');
  const ids = [], pts = [first];
  for (;;) {
    const opts = [];
    if (pts.length >= 3) opts.push('Cerrar');
    if (pts.length >= 2) opts.push('desHacer');
    const last = pts[pts.length - 1];
    const r = await c.getPoint('Precise punto siguiente', { base: last, options: opts, allowEnter: true });
    if (r === null) break;
    if (r === 'Cerrar') { c.add({ type: 'line', p1: last, p2: first }); break; }
    if (r === 'desHacer') { c.doc.remove(ids.pop()); pts.pop(); c.setLast(pts[pts.length - 1]); continue; }
    ids.push(c.add({ type: 'line', p1: last, p2: r }).id);
    pts.push(r);
  }
}, { group: 'Dibujo' });

def('PLINE', ['PL', 'POLILINEA'], 'Dibuja una polilínea con tramos rectos y de arco', async c => {
  const pts = [await c.getPoint('Precise punto inicial')], bul = [0];
  let ent = null, arc = false;
  const sync = () => {
    if (pts.length < 2) { if (ent) { c.doc.remove(ent.id); ent = null; } return; }
    const data = { pts: [...pts], bulges: [...bul] };
    if (!ent) ent = c.add({ type: 'pline', ...data, closed: false });
    else c.doc.modify(ent.id, e => Object.assign(e, data));
  };
  // Dirección tangente al final del último tramo
  const tangent = () => {
    const n = pts.length;
    if (n < 2) return P(1, 0);
    const a = pts[n - 2], b = pts[n - 1], bu = bul[n - 2];
    if (!bu) return G.norm(G.sub(b, a));
    const k = G.bulgeArc(a, b, bu), r = G.norm(G.sub(b, k.c));
    return bu > 0 ? G.perp(r) : G.mul(G.perp(r), -1);
  };
  for (;;) {
    const opts = [arc ? 'Línea' : 'Arco'];
    if (pts.length >= 3) opts.push('Cerrar');
    if (pts.length >= 2) opts.push('desHacer');
    const last = pts[pts.length - 1];
    const preview = arc ? (p => [{ type: 'pline', pts: [last, p], bulges: [G.tangentBulge(last, tangent(), p), 0], closed: false }]) : null;
    const r = await c.getPoint(arc ? 'Precise punto final del arco' : 'Precise punto siguiente', { base: last, options: opts, allowEnter: true, preview, rubber: !arc });
    if (r === null) break;
    if (r === 'Arco') { arc = true; continue; }
    if (r === 'Línea') { arc = false; continue; }
    if (r === 'Cerrar') {
      bul[pts.length - 1] = arc ? G.tangentBulge(last, tangent(), pts[0]) : 0;
      sync();
      c.doc.modify(ent.id, e => { e.closed = true; e.bulges = [...bul]; });
      break;
    }
    if (r === 'desHacer') { pts.pop(); bul.pop(); bul[bul.length - 1] = 0; c.setLast(pts[pts.length - 1]); sync(); continue; }
    bul[pts.length - 1] = arc ? G.tangentBulge(last, tangent(), r) : 0;
    pts.push(r); bul.push(0); sync();
  }
  if (ent && !ent.bulges?.some(b => b)) c.doc.modify(ent.id, e => { delete e.bulges; });
}, { group: 'Dibujo' });

def('CIRCLE', ['C', 'CIRCULO'], 'Dibuja un círculo', async c => {
  const S = c.settings;
  const r = await c.getPoint('Precise punto central para círculo', { options: ['3P', '2P'] });
  if (r === '3P') {
    const a = await c.getPoint('Precise primer punto en círculo');
    const b = await c.getPoint('Precise segundo punto en círculo', { base: a });
    const p3 = await c.getPoint('Precise tercer punto en círculo', { preview: p => { const k = G.circle3(a, b, p); return k ? [{ type: 'circle', ...k }] : []; }, rubber: false });
    const k = G.circle3(a, b, p3);
    if (!k) return c.print('Los tres puntos están alineados.');
    c.add({ type: 'circle', c: k.c, r: k.r }); return;
  }
  if (r === '2P') {
    const a = await c.getPoint('Precise primer extremo del diámetro');
    const b = await c.getPoint('Precise segundo extremo del diámetro', { base: a, preview: p => [{ type: 'circle', c: G.mid(a, p), r: G.dist(a, p) / 2 }] });
    c.add({ type: 'circle', c: G.mid(a, b), r: G.dist(a, b) / 2 }); return;
  }
  const cen = r;
  let v = await c.getDistance('Precise radio de círculo', { base: cen, options: ['Diámetro'], def: S.lastRadius, preview: p => [{ type: 'circle', c: cen, r: G.dist(cen, p) }] });
  if (v === 'Diámetro') v = (await c.getDistance('Precise diámetro de círculo', { base: cen, def: S.lastRadius * 2, preview: p => [{ type: 'circle', c: cen, r: G.dist(cen, p) / 2 }] })) / 2;
  if (!(v > 0)) return;
  S.lastRadius = v;
  c.add({ type: 'circle', c: cen, r: v });
}, { group: 'Dibujo' });

def('ARC', ['A', 'ARCO'], 'Dibuja un arco', async c => {
  const r = await c.getPoint('Precise punto inicial del arco', { options: ['Centro'] });
  if (r === 'Centro') {
    const cen = await c.getPoint('Precise centro del arco');
    const s = await c.getPoint('Precise punto inicial del arco', { base: cen });
    const rad = G.dist(cen, s), a1 = G.ang(cen, s);
    const mk = p => ({ type: 'arc', c: cen, r: rad, a1, a2: G.ang(cen, p) });
    const e = await c.getPoint('Precise punto final del arco (mantenga sentido antihorario)', { base: cen, preview: p => [mk(p)] });
    c.add(mk(e)); return;
  }
  const a = r;
  const b = await c.getPoint('Precise segundo punto del arco', { base: a });
  const e = await c.getPoint('Precise punto final del arco', { preview: p => { const k = G.arc3(a, b, p); return k ? [{ type: 'arc', ...k }] : []; }, rubber: false });
  const k = G.arc3(a, b, e);
  if (!k) return c.print('Los puntos están alineados.');
  c.add({ type: 'arc', ...k });
}, { group: 'Dibujo' });

def('RECTANG', ['REC', 'RECTANGULO'], 'Dibuja un rectángulo (polilínea cerrada)', async c => {
  const a = await c.getPoint('Precise primer punto de esquina');
  let b = await c.getPoint('Precise otro punto de esquina', { base: a, options: ['Cotas'], preview: p => [{ type: 'pline', pts: rectPts(a, p), closed: true }], rubber: false });
  if (b === 'Cotas') {
    const w = await c.getDistance('Precise longitud de rectángulos', { def: 10 });
    const h = await c.getDistance('Precise anchura de rectángulos', { def: 10 });
    const q = await c.getPoint('Precise otro punto de esquina (cuadrante)', { base: a, preview: p => [{ type: 'pline', pts: rectPts(a, P(a.x + Math.sign(p.x - a.x || 1) * w, a.y + Math.sign(p.y - a.y || 1) * h)), closed: true }], rubber: false });
    b = P(a.x + Math.sign(q.x - a.x || 1) * w, a.y + Math.sign(q.y - a.y || 1) * h);
  }
  if (Math.abs(b.x - a.x) < 1e-12 || Math.abs(b.y - a.y) < 1e-12) return c.print('Rectángulo nulo.');
  c.add({ type: 'pline', pts: rectPts(a, b), closed: true });
}, { group: 'Dibujo' });

def('POLYGON', ['POL', 'POLIGONO'], 'Dibuja un polígono regular', async c => {
  const S = c.settings;
  const n = await c.getNumber('Indique número de lados', { def: S.polySides, int: true, min: 3, max: 1024 });
  S.polySides = n;
  const r = await c.getPoint('Precise centro del polígono', { options: ['Lado'] });
  const poly = (cen, rad, a0) => Array.from({ length: n }, (_, i) => G.polar(cen, a0 + i * G.TAU / n, rad));
  if (r === 'Lado') {
    const a = await c.getPoint('Precise primer punto final de lado');
    const mk = b => {
      const s = G.dist(a, b), R = s / (2 * Math.sin(Math.PI / n)), m = G.mid(a, b);
      const cen = G.add(m, G.mul(G.perp(G.norm(G.sub(b, a))), R * Math.cos(Math.PI / n)));
      return { type: 'pline', pts: poly(cen, R, G.ang(cen, a)), closed: true };
    };
    const b = await c.getPoint('Precise segundo punto final de lado', { base: a, preview: p => [mk(p)] });
    c.add(mk(b)); return;
  }
  const cen = r;
  const mode = await c.getKeyword('Indique una opción', ['Inscrito en el círculo', 'Circunscrito alrededor del círculo'], 'Inscrito en el círculo');
  const ins = mode.startsWith('Ins');
  const mk = p => {
    const d = G.dist(cen, p), a = G.ang(cen, p);
    return ins ? poly(cen, d, a) : poly(cen, d / Math.cos(Math.PI / n), a + Math.PI / n);
  };
  const p = await c.getPoint('Precise radio del círculo', { base: cen, preview: q => [{ type: 'pline', pts: mk(q), closed: true }], allowNumber: true });
  const q = typeof p === 'number' ? G.polar(cen, ins ? -Math.PI / 2 + Math.PI / n : -Math.PI / 2, p) : p;
  c.add({ type: 'pline', pts: mk(q), closed: true });
}, { group: 'Dibujo' });

const ISO_MAJOR = { top: 0, left: 120, right: 60 };
def('ELLIPSE', ['EL', 'ELIPSE'], 'Dibuja una elipse (o un isocírculo en modo isométrico)', async c => {
  const S = c.settings;
  let cen, a1;
  const r = await c.getPoint('Precise punto final de eje de elipse', { options: S.iso ? ['Centro', 'Isocírculo'] : ['Centro'] });
  if (r === 'Isocírculo') {
    cen = await c.getPoint('Precise centro de isocírculo');
    const mk = rad => ({ type: 'ellipse', c: cen, rx: rad * Math.sqrt(1.5), ry: rad * Math.sqrt(0.5), rot: G.rad(ISO_MAJOR[S.isoPlane]) });
    let v = await c.getDistance('Precise radio de isocírculo', { base: cen, options: ['Diámetro'], preview: p => [mk(Math.max(1e-6, G.dist(cen, p)))] });
    if (v === 'Diámetro') v = (await c.getDistance('Precise diámetro de isocírculo', { base: cen })) / 2;
    if (v > 0) c.add(mk(v));
    return;
  }
  if (r === 'Centro') {
    cen = await c.getPoint('Precise centro de elipse');
    a1 = await c.getPoint('Precise punto final de eje', { base: cen });
  } else {
    const a2 = await c.getPoint('Precise otro punto final del eje', { base: r });
    cen = G.mid(r, a2); a1 = a2;
  }
  const rx = G.dist(cen, a1), rot = G.ang(cen, a1);
  const ry = await c.getDistance('Precise distancia al otro eje', { base: cen, preview: p => [{ type: 'ellipse', c: cen, rx, ry: Math.max(1e-6, G.dist(cen, p)), rot }] });
  if (!(rx > 0 && ry > 0)) return;
  c.add({ type: 'ellipse', c: cen, rx, ry, rot });
}, { group: 'Dibujo' });

def('SPLINE', ['SPL', 'CURVA'], 'Dibuja una curva suave por puntos de ajuste o vértices de control', async c => {
  const S = c.settings;
  let method = S.splineMethod === 'cv' ? 'cv' : 'fit', first;
  for (;;) {
    const r = await c.getPoint(`Precise primer punto (método: ${method === 'fit' ? 'ajuste' : 'vértices de control'})`, { options: ['Método'] });
    if (r !== 'Método') { first = r; break; }
    const k = await c.getKeyword('Indique método de creación de spline', ['Ajuste', 'VC'], method === 'fit' ? 'Ajuste' : 'VC');
    method = S.splineMethod = k === 'VC' ? 'cv' : 'fit';
  }
  const pts = [first];
  const mk = (list, closed) => { const e = { type: 'spline', [method]: list, closed }; return rebuildSpline(e) ? e : null; };
  let closed = false;
  for (;;) {
    const opts = [];
    if (pts.length >= 3) opts.push('Cerrar');
    if (pts.length >= 2) opts.push('desHacer');
    const last = pts[pts.length - 1];
    const r = await c.getPoint(pts.length < 2 ? 'Precise punto siguiente' : 'Precise punto siguiente o INTRO para terminar', {
      base: last, options: opts, allowEnter: true, rubber: method === 'cv',
      preview: p => { const e = mk([...pts, p], false); return e ? [e] : []; },
    });
    if (r === null) break;
    if (r === 'Cerrar') { closed = true; break; }
    if (r === 'desHacer') { pts.pop(); c.setLast(pts[pts.length - 1]); continue; }
    if (!G.eqPt(r, last, 1e-9)) pts.push(r);
  }
  if (pts.length < 2) return c.print('Se necesitan al menos dos puntos.');
  const e = mk(pts, closed);
  if (e) c.add(e); else c.print('No se ha podido crear la spline con esos puntos.');
}, { group: 'Dibujo' });

// ---- Líneas múltiples ----
const ML_JUST_KW = { Superior: 'top', Cero: 'zero', Inferior: 'bottom' };
const justName = j => Object.keys(ML_JUST_KW).find(k => ML_JUST_KW[k] === j) || 'Superior';
const findMlStyle = (doc, name) => doc.mlineStyles.find(s => s.name.toLowerCase() === String(name).trim().toLowerCase());
def('MLINE', ['ML', 'LINEAM', 'LINEAMULTIPLE'], 'Dibuja líneas múltiples (elementos paralelos según un estilo)', async c => {
  const S = c.settings, doc = c.doc;
  let first;
  for (;;) {
    c.print(`Parámetros actuales: Justificación = ${justName(S.mlJust)}, Escala = ${fmt(S.mlScale, 2)}, Estilo = ${doc.mlineStyle(doc.cur.mlineStyle).name}`);
    const r = await c.getPoint('Precise punto inicial', { options: ['Justificación', 'Escala', 'eStilo'] });
    if (typeof r !== 'string') { first = r; break; }
    if (r === 'Justificación') S.mlJust = ML_JUST_KW[await c.getKeyword('Indique tipo de justificación', Object.keys(ML_JUST_KW), justName(S.mlJust))];
    else if (r === 'Escala') { const v = await c.getNumber('Indique escala de línea múltiple', { def: S.mlScale }); if (v) S.mlScale = v; }
    else {
      const s = (await c.getString('Indique nombre de estilo de línea múltiple o [?]', { def: doc.cur.mlineStyle, spaces: true })).trim();
      if (s === '?') { for (const st of doc.mlineStyles) c.print(`  ${st.name}${st.desc ? ` — ${st.desc}` : ''} (${st.elems.length} elementos)`); continue; }
      const st = findMlStyle(doc, s);
      if (st) doc.cur.mlineStyle = st.name; else c.print(`No se encuentra el estilo de línea múltiple "${s}". Créelo con ESTILOLM.`);
    }
  }
  const pts = [first], mk = (list, closed = false) => ({ type: 'mline', pts: list, closed, just: S.mlJust, scale: S.mlScale, mlstyle: doc.mlineStyle(doc.cur.mlineStyle).name });
  let ent = null;
  const sync = () => {
    if (pts.length < 2) { if (ent) { doc.remove(ent.id); ent = null; } return; }
    if (!ent) ent = c.add(mk([...pts])); else doc.modify(ent.id, e => { e.pts = [...pts]; });
  };
  for (;;) {
    const opts = [];
    if (pts.length >= 3) opts.push('Cerrar');
    if (pts.length >= 2) opts.push('desHacer');
    const r = await c.getPoint('Precise punto siguiente', { base: pts[pts.length - 1], options: opts, allowEnter: true, rubber: false, preview: p => [mk([...pts, p])] });
    if (r === null) break;
    if (r === 'Cerrar') { doc.modify(ent.id, e => { e.closed = true; }); break; }
    if (r === 'desHacer') { pts.pop(); c.setLast(pts[pts.length - 1]); sync(); continue; }
    if (G.eqPt(r, pts[pts.length - 1], 1e-9)) continue;
    pts.push(r); sync();
  }
}, { group: 'Dibujo' });
def('MLSTYLE', ['ESTILOLM', 'ESTILOLINEAM'], 'Administra los estilos de línea múltiple: elementos, desfases, colores, tipos de línea, remates y relleno', async c => { await c.app.ui.mlineStyleManager(); }, { group: 'Dibujo' });

// ---- Edición de líneas múltiples (MLEDIT): cruces, uniones en T, esquinas, vértices, cortes y soldaduras ----
const isMl = e => e.type === 'mline';
async function mledit(c, tool) {
  const doc = c.doc, styleOf = e => doc.mlineStyle(e.mlstyle), name = MLEDIT_TOOLS[tool];
  c.print(`${name}.`);
  let n = 0;
  for (;;) {
    if (['CC', 'OC', 'MC', 'CT', 'OT', 'MT', 'CJ'].includes(tool)) {
      const tee = tool[1] === 'T';
      const a = await c.getEntity(tee ? 'Designe primera línea múltiple (el pie de la T)' : 'Designe primera línea múltiple', { filter: isMl, allowEnter: true });
      if (!a) break;
      const b = await c.getEntity(tee ? 'Designe segunda línea múltiple (la barra de la T)' : 'Designe segunda línea múltiple', { filter: e => isMl(e) && e.id !== a.e.id, allowEnter: true });
      if (!b) break;
      // Se trabaja sobre copias: si la operación no es posible, el dibujo no cambia
      const A = cloneEnt(a.e), B = cloneEnt(b.e);
      const err = tool === 'CJ' ? mlCorner(A, styleOf(A), a.pt, B, styleOf(B), b.pt)
        : tee ? mlTee(A, styleOf(A), a.pt, B, styleOf(B), b.pt, tool) : mlCross(A, styleOf(A), a.pt, B, styleOf(B), b.pt, tool);
      if (err) { c.print(err); continue; }
      for (const [src, x] of [[a.e, A], [b.e, B]]) doc.modify(src.id, e => { e.pts = x.pts; if (x.cuts) e.cuts = x.cuts; else delete e.cuts; });
      n++;
      continue;
    }
    const o = await c.getEntity(tool === 'AV' || tool === 'DV' ? `Designe línea múltiple${tool === 'AV' ? ' en el punto del vértice nuevo' : ' junto al vértice'}` : 'Designe línea múltiple', { filter: isMl, allowEnter: true });
    if (!o) break;
    if (tool === 'AV' || tool === 'DV') {
      const x = cloneEnt(o.e), ok = tool === 'AV' ? mlAddVertex(x, o.pt) : mlDelVertex(x, o.pt);
      if (!ok) { c.print(tool === 'AV' ? 'El punto coincide con un vértice.' : 'La línea múltiple no tiene vértices que se puedan suprimir.'); continue; }
      doc.modify(o.e.id, e => { e.pts = x.pts; if (x.cuts) e.cuts = x.cuts; else delete e.cuts; });
      n++;
      continue;
    }
    const p2 = await c.getPoint('Designe segundo punto', { base: o.pt });
    const st = styleOf(o.e), ks = tool === 'CS' ? [mlNearestElem(o.e, st, o.pt)] : sortedElems(st).map((_, i) => i);
    doc.modify(o.e.id, e => mlCutRange(e, o.pt, p2, ks, tool === 'WA'));
    n++;
  }
  if (n) c.print(`${name}: ${n} edición(es).`);
}
def('MLEDIT', ['EDITARLM', 'EDITLM', 'MLE'], 'Edita líneas múltiples: cruces, uniones en T y en esquina, añadir o suprimir vértices, cortar y soldar elementos', async (c, arg) => {
  const tool = MLEDIT_TOOLS[String(arg || '').toUpperCase()] ? String(arg).toUpperCase() : await c.app.ui.mleditDialog();
  if (tool) await mledit(c, tool);
}, { group: 'Modificar' });
def('-MLEDIT', ['-EDITARLM'], 'MLEDIT por la línea de comandos: CC, OC, MC (cruces), CT, OT, MT (en T), CJ (esquina), AV, DV (vértices), CS, CA (cortar), WA (soldar)', async c => {
  for (const [k, v] of Object.entries(MLEDIT_TOOLS)) c.print(`  ${k}  ${v}`);
  await mledit(c, await c.getKeyword('Indique opción de edición', Object.keys(MLEDIT_TOOLS), 'CC'));
}, { group: 'Modificar' });

// ---- Marcas y líneas de centro asociativas (CENTERMARK, CENTERLINE) ----
const centerExt = c => (c.doc.dimStyle(c.doc.cur.dimStyle).txt || 2.5) * 1.5;
def('CENTERMARK', ['DIMCENTER', 'MARCACENTRO', 'CENTROMARCA'], 'Crea marcas de centro asociativas en círculos y arcos; siguen al objeto si cambia', async c => {
  let n = 0;
  for (;;) {
    const o = await c.getEntity('Designe círculo o arco para la marca de centro (Intro para terminar)', { filter: isCirc, allowEnter: true });
    if (!o) break;
    const e = { type: 'center', kind: 'mark', assoc: { a: o.e.id }, size: centerExt(c) };
    if (!updateCenter(e, id => c.doc.get(id))) { c.print('No se puede crear la marca de centro en ese objeto.'); continue; }
    c.add(e); n++;
  }
  if (n) c.print(`${n} marca(s) de centro creada(s).`);
}, { group: 'Anotación' });
def('CENTERLINE', ['LINEACENTRO', 'CENTROLINEA'], 'Crea líneas de centro asociativas entre dos líneas o entre dos círculos/arcos', async c => {
  const first = await c.getEntity('Designe primera línea o círculo', { filter: e => e.type === 'line' || isCirc(e) });
  const second = await c.getEntity('Designe segunda línea o círculo', { filter: e => (e.type === 'line' || isCirc(e)) && e.id !== first.e.id });
  const ok = (first.e.type === 'line' && second.e.type === 'line') || (isCirc(first.e) && isCirc(second.e));
  if (!ok) return c.print('La línea de centro necesita dos líneas o dos círculos/arcos.');
  const e = { type: 'center', kind: 'line', assoc: { a: first.e.id, b: second.e.id }, size: centerExt(c) };
  if (!updateCenter(e, id => c.doc.get(id))) return c.print('No se puede crear la línea de centro entre esos objetos.');
  c.add(e);
}, { group: 'Anotación' });

// ---- Nubes de revisión (REVCLOUD) y coberturas (WIPEOUT) ----
// Contorno cerrado → polilínea de arcos de `len` de longitud de cuerda, abombados hacia fuera
function cloudOf(path, len) {
  const n = path.length, cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + G.dist(path[i], path[(i + 1) % n]));
  const per = cum[n];
  const cnt = Math.max(8, Math.min(2000, Math.round(per / Math.max(len, 1e-9))));
  const at = t => {
    t = Math.max(0, Math.min(per - 1e-9, t));
    for (let i = 0; i < n; i++) if (t <= cum[i + 1]) {
      const a = path[i], b = path[(i + 1) % n], L = cum[i + 1] - cum[i];
      return G.add(a, G.mul(G.sub(b, a), L > 0 ? (t - cum[i]) / L : 0));
    }
    return path[0];
  };
  let area = 0;
  for (let i = 0; i < n; i++) area += G.cross(path[i], path[(i + 1) % n]);
  const sign = area > 0 ? -1 : 1, pts = [], bulges = [];
  for (let i = 0; i < cnt; i++) { pts.push(at(i * per / cnt)); bulges.push(sign); }
  return { type: 'pline', pts, bulges, closed: true };
}
def('REVCLOUD', ['NUBE', 'REVISION', 'NUBEREVISION'], 'Crea una nube de revisión rectangular, poligonal o a partir de un contorno cerrado', async c => {
  const S = c.settings;
  const len = await c.getNumber('Longitud de arco de la nube', { def: S.revcloud || 5, min: 0.001 });
  S.revcloud = len; c.doc.changed();
  const mode = await c.getKeyword('Indique forma de la nube', ['Rectangular', 'Poligonal', 'Objeto'], 'Rectangular');
  let path = null, src = null;
  if (mode === 'Rectangular') {
    const a = await c.getPoint('Precise primera esquina de la nube');
    const b = await c.getPoint('Precise esquina opuesta', { base: a, rubber: false });
    if (Math.abs(b.x - a.x) < 1e-9 || Math.abs(b.y - a.y) < 1e-9) return c.print('Nube nula.');
    path = [a, P(b.x, a.y), b, P(a.x, b.y)];
  } else if (mode === 'Poligonal') {
    const pts = [await c.getPoint('Precise primer punto de la nube')];
    for (;;) {
      const p = await c.getPoint('Precise punto siguiente (Intro para cerrar)', { base: pts[pts.length - 1], allowEnter: true, options: pts.length >= 2 ? ['desHacer'] : [] });
      if (p === null) break;
      if (p === 'desHacer') { pts.pop(); continue; }
      pts.push(p);
    }
    if (pts.length < 3) return c.print('Se necesitan al menos tres puntos.');
    path = pts;
  } else {
    const o = await c.getEntity('Designe polilínea cerrada, círculo, elipse o región', { filter: e => (e.type === 'pline' && e.closed && e.pts.length > 2) || e.type === 'circle' || e.type === 'ellipse' || e.type === 'region' });
    if (o.e.type === 'circle') { const k = Math.max(16, Math.round(G.TAU * o.e.r / Math.max(len, 1e-6))); path = Array.from({ length: k }, (_, i) => G.polar(o.e.c, i * G.TAU / k, o.e.r)); }
    else if (o.e.type === 'ellipse') path = ellPts(o.e, 96);
    else if (o.e.type === 'pline') path = o.e.pts;
    else path = o.e.loops[0].pts;
    src = o.e;
  }
  if (!path || path.length < 3) return c.print('El contorno no es válido.');
  const cloud = cloudOf(path, len);
  c.add(cloud);
  if (src) c.doc.remove(src.id);
  c.print(`Nube de revisión creada con ${cloud.pts.length} arcos.`);
}, { group: 'Dibujo' });
def('WIPEOUT', ['COBERTURA', 'TAPAR', 'OCULTAR'], 'Crea una cobertura poligonal que oculta lo dibujado debajo de ella', async c => {
  const pts = [await c.getPoint('Precise primer punto del contorno de la cobertura')];
  for (;;) {
    const p = await c.getPoint('Precise punto siguiente (Intro para cerrar)', { base: pts[pts.length - 1], allowEnter: true, options: pts.length >= 2 ? ['desHacer'] : [] });
    if (p === null) break;
    if (p === 'desHacer') { pts.pop(); continue; }
    pts.push(p);
  }
  if (pts.length < 3) return c.print('Se necesitan al menos tres puntos.');
  c.add({ type: 'wipeout', pts });
  c.print('Cobertura creada.');
}, { group: 'Dibujo' });
def('IMAGEATTACH', ['IMAGEN', 'ADJUNTARIMAGEN', 'IMATTACH'], 'Adjunta una imagen raster (PNG, JPEG, GIF, WebP o BMP) al dibujo', async c => {
  const f = await c.app.io.pickFile('Imágenes', ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
  if (!f) return;
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f.file); });
  const im = new Image();
  const ok = await new Promise(res => { im.onload = () => res(true); im.onerror = () => res(false); im.src = src; });
  if (!ok) return c.print('No se puede leer la imagen.');
  const p = await c.getPoint('Precise punto de inserción de la imagen');
  const sc = await c.getNumber('Escala de la imagen (1 píxel = 1 unidad)', { def: 1, min: 1e-6 });
  c.add({ type: 'image', p, w: im.naturalWidth * sc, h: im.naturalHeight * sc, src, name: f.file.name, rot: 0 });
  c.print(`Imagen "${f.file.name}" adjuntada (${im.naturalWidth} × ${im.naturalHeight} px).`);
}, { group: 'Insertar' });
def('POINT', ['PO', 'PUNTO'], 'Crea objetos punto', async c => {
  for (;;) {
    const p = await c.getPoint('Precise un punto', { allowEnter: true });
    if (!p) break;
    c.add({ type: 'point', p });
  }
}, { group: 'Dibujo' });

// ---- GRADUA y DIVIDE: puntos o bloques a lo largo de un objeto ----
const measurable = e => ['line', 'arc', 'circle', 'pline', 'spline', 'ellipse'].includes(e.type);
async function measureDivide(c, divide) {
  const S = c.settings, doc = c.doc;
  const o = await c.getEntity(divide ? 'Designe objeto a dividir' : 'Designe objeto a graduar', { filter: measurable });
  let path = OPS.pathOf(o.e);
  if (!path || !(path.len > 1e-9)) return c.print('El objeto no tiene longitud.');
  // GRADUA empieza por el extremo más próximo al punto con el que se designó el objeto
  if (!divide && !path.closed && G.dist(o.pt, path.end) < G.dist(o.pt, path.start)) path = OPS.reversePath(path);
  let block = null, align = true, v;
  for (;;) {
    const opts = block ? [] : ['Bloque'];
    v = divide
      ? await c.getNumber('Indique número de segmentos', { options: opts, int: true, min: 2, max: 32767, def: S.divideN || undefined })
      : await c.getDistance('Precise longitud de segmento', { options: opts, def: S.measureD || undefined });
    if (v !== 'Bloque') break;
    const name = (await c.getString('Indique nombre de bloque a insertar', { spaces: true })).trim();
    if (!doc.blocks[name] || name.startsWith('*')) { c.print(`El bloque "${name}" no existe.`); continue; }
    block = name;
    align = (await c.getKeyword('¿Alinear bloque con objeto?', ['Sí', 'No'], 'Sí')) === 'Sí';
  }
  let at;
  if (divide) {
    S.divideN = v;
    at = Array.from({ length: path.closed ? v : v - 1 }, (_, k) => (path.len * (path.closed ? k : k + 1)) / v);
  } else {
    if (!(v > 0)) return;
    S.measureD = v;
    const n = Math.floor(path.len / v + 1e-9);
    if (n > 32767) return c.print('Demasiados segmentos: indique una longitud mayor.');
    at = Array.from({ length: n }, (_, k) => v * (k + 1)).filter(s => s < path.len - 1e-9 * Math.max(1, path.len));
  }
  if (!at.length) return c.print('La longitud del segmento es mayor que la del objeto: no se crea ningún punto.');
  const defs = block ? blockAttdefs(block) : [];
  for (const s of at) {
    const { p, a } = path.at(s);
    if (!block) { c.add({ type: 'point', p }); continue; }
    c.add({ type: 'insert', name: block, p, sx: 1, sy: 1, rot: align ? G.normAng(a) : 0, ...(defs.length ? { attribs: Object.fromEntries(defs.map(d => [d.tag, d.def || ''])) } : {}) });
  }
  c.print(`${at.length} ${block ? `referencia(s) al bloque "${block}"` : 'punto(s)'} creado(s)${divide ? ` (${v} segmentos de ${fmt(path.len / v, 4)})` : ''}.`);
}
def('DIVIDE', ['DIV', 'DIVIDIR'], 'Divide un objeto en partes iguales con puntos o bloques', c => measureDivide(c, true), { group: 'Dibujo' });
def('MEASURE', ['ME', 'GRADUA', 'MEDIR'], 'Coloca puntos o bloques a lo largo de un objeto a intervalos de una longitud dada', c => measureDivide(c, false), { group: 'Dibujo' });

// Sombreado con patrón o, con grad, relleno degradado (mismo flujo de designación de contornos)
async function hatchLoop(c, grad) {
  const S = c.settings, made = [];
  const G0 = () => ({ ...GRAD_DEFAULT, ...S.gradient });
  for (;;) {
    const g = G0(), u = { ...USER_DEFAULT, ...S.hatchUser };
    const info = grad ? `degradado ${GRADIENTS[g.type].toLowerCase()}, ${g.c1} → ${g.c2}, ${S.hatchAng}°`
      : S.hatchPat === 'USER' ? `definido por el usuario, separación ${fmt(u.sp, 4)}${u.dbl ? ', doble' : ''}, ${S.hatchAng}°` : `${S.hatchPat}, escala ${S.hatchScale}, ${S.hatchAng}°`;
    const opts = grad ? ['Seleccionar objetos', 'Tipo', 'Colores', 'Ángulo', 'Centrado', 'asOciativo', 'desHacer'] : ['Seleccionar objetos', 'Patrón', 'Usuario', 'Escala', 'Ángulo', 'asOciativo', 'desHacer'];
    const r = await c.getPoint(`Designe punto interno [${info}, ${S.hatchAssoc ? 'asociativo' : 'no asociativo'}]`, { options: opts, allowEnter: true, noSnap: true });
    if (r === null) break;
    if (r === 'Tipo') {
      const names = Object.values(GRADIENTS), k = await c.getString(`Tipo de degradado (${names.join(', ')})`, { spaces: true, def: GRADIENTS[g.type] });
      const t = Object.keys(GRADIENTS).find(x => GRADIENTS[x].toLowerCase() === k.trim().toLowerCase());
      if (t) S.gradient = { ...g, type: t }; else c.print('Tipo no válido.');
      continue;
    }
    if (r === 'Colores') { const a = await c.app.ui.pickColor(g.c1), b = a ? await c.app.ui.pickColor(g.c2) : null; S.gradient = { ...g, ...(a ? { c1: a } : {}), ...(b ? { c2: b } : {}) }; continue; }
    if (r === 'Centrado') { S.gradient = { ...g, centered: !g.centered }; c.print(S.gradient.centered ? 'Degradado centrado.' : 'Degradado desplazado.'); continue; }
    if (r === 'asOciativo') { S.hatchAssoc = !S.hatchAssoc; c.print(S.hatchAssoc ? 'Los sombreados nuevos se actualizarán al modificar su contorno.' : 'Los sombreados nuevos no serán asociativos.'); continue; }
    if (r === 'Patrón') {
      const names = [...Object.keys(PATTERNS), ...Object.keys(c.doc.patterns)];
      const p = c.app.ui.pickPattern ? await c.app.ui.pickPattern(S.hatchPat) : (await c.getString(`Indique nombre de patrón (${names.join(', ')})`, { def: S.hatchPat })).toUpperCase();
      if (p && (p === 'USER' || PATTERNS[p] || c.doc.patterns[p])) S.hatchPat = p; else if (p) c.print(`El patrón "${p}" no existe. Cárguelo con PATRONES.`);
      continue;
    }
    if (r === 'Usuario') { // patrón definido por el usuario: líneas paralelas (o cruzadas) con separación propia
      const sp = await c.getDistance('Precise separación entre líneas', { def: u.sp });
      if (!(sp > 0)) continue;
      const k = await c.getKeyword('¿Doble sombreado (líneas cruzadas a 90°)?', ['Sí', 'No'], u.dbl ? 'Sí' : 'No');
      S.hatchUser = { sp, dbl: k === 'Sí' }; S.hatchPat = 'USER';
      continue;
    }
    if (r === 'Escala') { const v = await c.getNumber('Indique escala del patrón', { def: S.hatchScale }); if (v > 0) S.hatchScale = v; continue; }
    if (r === 'Ángulo') { S.hatchAng = await c.getNumber('Indique ángulo del patrón', { def: S.hatchAng }); continue; }
    if (r === 'desHacer') { if (made.length) c.doc.remove(made.pop()); else c.print('Nada que deshacer.'); continue; }
    let loops, assoc = null, seed = null;
    if (r === 'Seleccionar objetos') {
      const ids = (await c.getSelection('Designe objetos cerrados', { noPickfirst: true })).filter(id => loopsOfEntity(c.doc.get(id)));
      loops = ids.flatMap(id => loopsOfEntity(c.doc.get(id)));
      if (!loops.length) { c.print('Los objetos designados no son contornos cerrados.'); continue; }
      if (!ids.some(id => c.doc.get(id).type === 'hatch')) assoc = ids;
    } else {
      const ents = c.app.idx().query(c.app.view.rect()).filter(e => c.doc.visible(e));
      loops = findBoundary(ents, r);
      if (!loops) { c.print('No se ha encontrado un contorno cerrado válido alrededor del punto.'); continue; }
      c.print(`Contorno encontrado${loops.length > 1 ? ` con ${loops.length - 1} isla(s)` : ''}.`);
      assoc = loops.ids; seed = r;
    }
    const user = !grad && S.hatchPat === 'USER';
    const e = c.add({ type: 'hatch', loops: [...loops], pattern: grad ? 'GRADIENT' : S.hatchPat, scale: user ? 1 : S.hatchScale, angle: S.hatchAng, ...(grad ? { grad: G0() } : {}), ...(user ? { user: { ...USER_DEFAULT, ...S.hatchUser } } : {}) });
    if (S.hatchAssoc && assoc?.length) { e.assoc = assoc; if (seed) e.seed = seed; }
    sendToBack(c, e);
    made.push(e.id);
  }
}
def('HATCH', ['H', 'BH', 'SOMBCONT', 'SOMBREADO'], 'Rellena un área cerrada con un patrón de sombreado', c => hatchLoop(c, false), { group: 'Dibujo' });
def('GRADIENT', ['GD', 'DEGRADADO'], 'Rellena un área cerrada con un degradado de dos colores', c => hatchLoop(c, true), { group: 'Dibujo' });

// ---- Regiones y contornos ----
const isRegion = e => e.type === 'region';
const loopPline = (l, base = {}) => ({ ...base, type: 'pline', pts: [...l.pts], closed: true, ...(l.bulges?.some(b => b) ? { bulges: [...l.bulges] } : {}) });
def('REGION', ['REG', 'REGIÓN'], 'Convierte objetos cerrados (o cadenas de líneas y arcos que forman un contorno) en regiones', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const ents = ids.map(id => c.doc.get(id)).filter(Boolean), made = [];
  let loops = 0;
  for (const e of ents) {
    if (e.type === 'region') continue;
    const l = entityLoop(e);
    if (!l) continue;
    made.push(c.add({ type: 'region', loops: [l], layer: e.layer, color: e.color, ltype: e.ltype, lw: e.lw }));
    c.doc.remove(e.id); loops++;
  }
  // Líneas, arcos y polilíneas abiertas encadenados
  const loose = ents.filter(e => c.doc.get(e.id) && ['line', 'arc', 'pline'].includes(e.type) && !(e.type === 'pline' && e.closed));
  for (const lp of chainLoops(loose)) {
    made.push(c.add({ type: 'region', loops: [lp.loop], layer: lp.src[0].layer, color: lp.src[0].color, ltype: lp.src[0].ltype, lw: lp.src[0].lw }));
    for (const e of lp.src) c.doc.remove(e.id);
    loops++;
  }
  c.print(`${loops} bucle(s) extraído(s).`);
  c.print(`${made.length} región(es) creada(s).`);
}, { group: 'Dibujo', sel: true });

// Operación booleana entre regiones: el resultado sustituye a la primera región; las demás se borran
function applyBoolean(c, target, others, loops, what) {
  for (const e of others) if (e.id !== target.id) c.doc.remove(e.id);
  if (!loops.length) { c.doc.remove(target.id); c.print(`${what}: la región resultante está vacía y se ha suprimido.`); return; }
  c.doc.modify(target.id, e => { e.loops = loops; });
  c.print(`${what}: región con ${loops.length} contorno(s), área ${fmt(Math.abs(regionArea({ loops })), 4)}.`);
}
const foldRegions = (regs, op) => regs.slice(1).reduce((acc, r) => booleanLoops(acc, r.loops, op), regs[0].loops);
def('UNION', ['UNI', 'UNIÓN'], 'Une regiones en una sola (unión booleana)', async c => {
  const regs = (await c.getSelection('Designe regiones')).map(id => c.doc.get(id)).filter(e => e && isRegion(e));
  if (regs.length < 2) return c.print('Se necesitan al menos dos regiones.');
  applyBoolean(c, regs[0], regs, foldRegions(regs, 'union'), 'UNION');
}, { group: 'Dibujo', sel: true });
def('SUBTRACT', ['SU', 'DIFERENCIA', 'RESTAR'], 'Resta unas regiones de otras (diferencia booleana)', async c => {
  const a = (await c.getSelection('Designe las regiones de las que se va a restar')).map(id => c.doc.get(id)).filter(e => e && isRegion(e));
  if (!a.length) return c.print('No se ha designado ninguna región.');
  const ids = new Set(a.map(e => e.id));
  const b = (await c.getSelection('Designe las regiones que se van a restar', { noPickfirst: true })).map(id => c.doc.get(id)).filter(e => e && isRegion(e) && !ids.has(e.id));
  if (!b.length) return c.print('No se ha designado ninguna región que restar.');
  const A = a.length > 1 ? foldRegions(a, 'union') : a[0].loops, B = b.length > 1 ? foldRegions(b, 'union') : b[0].loops;
  applyBoolean(c, a[0], [...a, ...b], booleanLoops(A, B, 'subtract'), 'DIFERENCIA');
}, { group: 'Dibujo', sel: true });
def('INTERSECT', ['IN', 'INTERSEC', 'INTERSECCION'], 'Deja sólo el área común a las regiones designadas (intersección booleana)', async c => {
  const regs = (await c.getSelection('Designe regiones')).map(id => c.doc.get(id)).filter(e => e && isRegion(e));
  if (regs.length < 2) return c.print('Se necesitan al menos dos regiones.');
  applyBoolean(c, regs[0], regs, foldRegions(regs, 'intersect'), 'INTERSEC');
}, { group: 'Dibujo', sel: true });

def('BOUNDARY', ['BO', 'BPOLY', 'CONTORNO'], 'Crea una polilínea cerrada o una región con el contorno que rodea un punto interior', async c => {
  const S = c.settings;
  for (;;) {
    const r = await c.getPoint(`Designe punto interno [tipo: ${S.boundaryType === 'region' ? 'región' : 'polilínea'}, islas: ${S.boundaryIslands ? 'sí' : 'no'}]`, { options: ['Tipo de objeto', 'Detección de islas'], allowEnter: true, noSnap: true });
    if (r === null) return;
    if (r === 'Tipo de objeto') { S.boundaryType = (await c.getKeyword('Indique tipo de objeto de contorno', ['Polilínea', 'Región'], S.boundaryType === 'region' ? 'Región' : 'Polilínea')) === 'Región' ? 'region' : 'pline'; continue; }
    if (r === 'Detección de islas') { S.boundaryIslands = (await c.getKeyword('¿Detectar islas?', ['Sí', 'No'], S.boundaryIslands ? 'Sí' : 'No')) === 'Sí'; continue; }
    const ents = c.app.idx().query(c.app.view.rect()).filter(e => c.doc.visible(e));
    const found = findBoundary(ents, r);
    if (!found) { c.print('No se ha encontrado un contorno cerrado válido alrededor del punto.'); continue; }
    const loops = S.boundaryIslands ? found.exact : found.exact.slice(0, 1);
    if (S.boundaryType === 'region') { c.add({ type: 'region', loops: nestLoops(loops) }); c.print(`CONTORNO ha creado 1 región${loops.length > 1 ? ` con ${loops.length - 1} hueco(s)` : ''}.`); }
    else { for (const l of loops) c.add(loopPline(l)); c.print(`CONTORNO ha creado ${loops.length} polilínea(s).`); }
  }
}, { group: 'Dibujo' });

// ---- Patrones de sombreado personalizados ----
// Añade al dibujo los patrones de un texto .pat. k: factor de unidades (25,4 si está en pulgadas). Devuelve los nombres cargados
export function loadPatterns(c, text, k = 1, src = '') {
  const r = parsePat(text, k), names = Object.keys(r.pats);
  for (const n of names) c.doc.patterns[n] = r.pats[n];
  if (names.length) c.doc.changed();
  c.print(names.length ? `${names.length} patrón(es) cargado(s)${src ? ` de ${src}` : ''}: ${names.slice(0, 12).join(', ')}${names.length > 12 ? '…' : ''}.` : 'No se ha cargado ningún patrón.');
  if (r.skipped.length) c.print(`Se omiten ${r.skipped.length} patrón(es) que ya son predefinidos (${r.skipped.slice(0, 6).join(', ')}${r.skipped.length > 6 ? '…' : ''}).`);
  for (const e of r.errors.slice(0, 5)) c.app.print(`Aviso: ${e}.`, 'err');
  if (r.errors.length > 5) c.print(`… y ${r.errors.length - 5} aviso(s) más.`);
  return names;
}
const patternInUse = (doc, name) => [...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)].some(e => e.type === 'hatch' && e.pattern === name);
def('PATTERNS', ['PATRONES', 'PATSOMB'], 'Patrones de sombreado personalizados: cargar archivos .pat de AutoCAD, pegar definiciones, exportarlos o eliminarlos', async (c, arg) => {
  const doc = c.doc, app = c.app;
  if (arg?.text != null) { loadPatterns(c, arg.text, arg.k || 1, arg.src); return; }
  for (;;) {
    const r = await app.ui.patternManager();
    if (!r) return;
    if (r.action === 'load') {
      const f = await app.io.pickFile('Patrones de sombreado', ['.pat']);
      if (f) loadPatterns(c, await app.io.readText(f.file), r.k, f.file.name);
    } else if (r.action === 'paste') { const t = await app.ui.patternPaste(); if (t) loadPatterns(c, t, r.k); }
    else if (r.action === 'delete') {
      if (patternInUse(doc, r.name)) c.print(`El patrón "${r.name}" lo usan sombreados del dibujo: no se puede eliminar.`);
      else { delete doc.patterns[r.name]; if (doc.settings.hatchPat === r.name) doc.settings.hatchPat = 'ANSI31'; doc.changed(); c.print(`Patrón "${r.name}" eliminado.`); }
    } else if (r.action === 'export') {
      const names = Object.keys(doc.patterns);
      if (names.length) await app.io.writeFile(names.map(n => patText(n, doc.patterns[n])).join('\n') + '\n', `${doc.name}.pat`, 'text/plain', '.pat', 'Patrones de sombreado', false);
    } else if (r.action === 'use') { doc.settings.hatchPat = r.name; c.print(`Patrón actual para SOMBREADO: ${r.name}.`); }
  }
}, { group: 'Dibujo' });

// ================= ANOTACIÓN =================
def('TEXT', ['DT', 'DTEXT', 'TEXTO'], 'Crea texto de una línea', async c => {
  const S = c.settings;
  let p = await c.getPoint(`Precise punto inicial de texto (estilo "${c.doc.cur.textStyle}")`, { options: ['Justificar', 'Estilo'] });
  let align = 'l';
  while (typeof p === 'string') {
    if (p === 'Estilo') {
      const names = c.doc.textStyles.map(s => s.name);
      c.print(`Estilos: ${names.join(', ')}`);
      const s = await c.getString('Indique nombre de estilo', { def: c.doc.cur.textStyle, spaces: true });
      if (names.includes(s)) c.doc.cur.textStyle = s; else c.print(`El estilo "${s}" no existe.`);
    } else {
      const j = await c.getKeyword('Indique una opción', ['Izquierda', 'Centro', 'Derecha'], 'Izquierda');
      align = { Izquierda: 'l', Centro: 'c', Derecha: 'r' }[j];
    }
    p = await c.getPoint('Precise punto inicial de texto', { options: ['Justificar', 'Estilo'] });
  }
  const h = await c.getDistance('Precise altura', { base: p, def: S.textH });
  if (!(h > 0)) return;
  S.textH = h;
  const rot = await c.getAngle('Precise ángulo de rotación del texto', { base: p, def: 0 });
  for (;;) {
    const s = await c.getString('Escriba el texto (INTRO vacío para terminar)', { spaces: true, def: '' });
    if (!s) break;
    c.add({ type: 'text', p, h, rot, text: s, align });
    p = G.add(p, G.rot(P(0, -1.6 * h), rot));
  }
}, { group: 'Anotación' });

const MT_KW = { SI: 'tl', SC: 'tc', SD: 'tr', MI: 'ml', MC: 'mc', MD: 'mr', II: 'bl', IC: 'bc', ID: 'br' };
async function chooseTextStyle(c) {
  const names = c.doc.textStyles.map(s => s.name);
  c.print(`Estilos: ${names.join(', ')}`);
  const s = await c.getString('Indique nombre de estilo', { def: c.doc.cur.textStyle, spaces: true });
  if (names.includes(s)) c.doc.cur.textStyle = s; else c.print(`El estilo "${s}" no existe.`);
}
def('MTEXT', ['T', 'MT', 'TEXTOM'], 'Crea un párrafo de texto de líneas múltiples con ajuste de palabras', async c => {
  const S = c.settings;
  let h = S.textH, rot = 0, attach = 'tl';
  const opt = async r => {
    if (r === 'Altura') { const v = await c.getDistance('Precise altura', { def: h }); if (v > 0) h = S.textH = v; }
    else if (r === 'Justificar') { const k = await c.getKeyword('Indique justificación', Object.keys(MT_KW), Object.keys(MT_KW).find(k => MT_KW[k] === attach)); attach = MT_KW[k]; }
    else if (r === 'Rotación') rot = await c.getAngle('Precise ángulo de rotación', { def: 0 });
    else if (r === 'Estilo') await chooseTextStyle(c);
  };
  // Rectángulo de las dos esquinas en el sistema girado del texto
  const local = (a, b) => G.rot(G.sub(b, a), -rot);
  const frame = (a, b) => { const d = local(a, b); return [P(0, 0), P(d.x, 0), d, P(0, d.y)].map(q => G.add(a, G.rot(q, rot))); };
  let a;
  for (;;) {
    const r = await c.getPoint(`Precise primera esquina (estilo "${c.doc.cur.textStyle}", altura ${fmt(h, 4)})`, { options: ['Altura', 'Justificar', 'Rotación', 'Estilo'] });
    if (typeof r !== 'string') { a = r; break; }
    await opt(r);
  }
  let p, w;
  for (;;) {
    const r = await c.getPoint('Precise esquina opuesta', { base: a, options: ['Altura', 'Justificar', 'Rotación', 'Estilo', 'Anchura'], rubber: false, preview: q => [{ type: 'pline', pts: frame(a, q), closed: true }] });
    if (r === 'Anchura') { w = await c.getDistance('Precise anchura (0 = sin ajuste)', { base: a, def: 0 }); p = a; break; }
    if (typeof r === 'string') { await opt(r); continue; }
    const d = local(a, r), x0 = Math.min(0, d.x), x1 = Math.max(0, d.x), y0 = Math.min(0, d.y), y1 = Math.max(0, d.y);
    const lx = { l: x0, c: (x0 + x1) / 2, r: x1 }[attach[1]], ly = { t: y1, m: (y0 + y1) / 2, b: y0 }[attach[0]];
    p = G.add(a, G.rot(P(lx, ly), rot)); w = x1 - x0;
    break;
  }
  const r = await c.app.ui.editMText({ text: '', h, style: c.doc.cur.textStyle }, 'Texto de líneas múltiples');
  if (!r?.text) return;
  c.add({ type: 'mtext', p, w: w > 1e-9 ? w : 0, h, rot, attach, text: r.text, ...(r.rich ? { rich: true } : {}) });
}, { group: 'Anotación' });

// Asociatividad de una cota nueva a partir de las referencias de sus puntos ({p1: ref, …}; se omiten las nulas)
const withAssoc = (c, e, refs) => {
  const a = Object.fromEntries(Object.entries(refs).filter(([, r]) => r != null));
  if (Object.keys(a).length && c.settings.dimAssoc) e.assoc = a;
  return e;
};

// Puntos de una línea, arco o tramo de polilínea designados para acotarlos (INTRO en la primera solicitud)
function dimObjectPoints(o) {
  const e = o.e;
  if (e.type === 'line') return { p1: e.p1, p2: e.p2, r1: { id: e.id, snap: 'end', i: 0 }, r2: { id: e.id, snap: 'end', i: 1 } };
  if (e.type === 'arc') { const s = TYPES.arc.snaps(e).end; return { p1: s[0], p2: s[1], r1: { id: e.id, snap: 'end', i: 0 }, r2: { id: e.id, snap: 'end', i: 1 } }; }
  if (e.type === 'pline') {
    const n = e.pts.length, k = Math.min(Math.floor(OPS.curveInfo(e).param(OPS.nearestOn(e, o.pt))), (e.closed ? n : n - 1) - 1), j = (k + 1) % n;
    return { p1: e.pts[k], p2: e.pts[j], r1: { id: e.id, snap: 'end', i: k }, r2: { id: e.id, snap: 'end', i: j } };
  }
  return null;
}

async function dimAsk(c, kind) {
  let p1, p2, r1, r2;
  const first = await c.getPoint('Precise origen de la primera línea de referencia o <designar objeto>', { allowEnter: true });
  if (first === null) {
    const o = await c.getEntity('Designe objeto que desea acotar', { filter: e => ['line', 'arc', 'pline'].includes(e.type) });
    ({ p1, p2, r1, r2 } = dimObjectPoints(o));
  } else {
    p1 = first; r1 = c.ref();
    p2 = await c.getPoint('Precise origen de la segunda línea de referencia', { base: p1 }); r2 = c.ref();
  }
  let text = '';
  const mk = p3 => {
    let rot = 0;
    if (kind === 'lin') {
      const ox = p3.x < Math.min(p1.x, p2.x) ? Math.min(p1.x, p2.x) - p3.x : p3.x > Math.max(p1.x, p2.x) ? p3.x - Math.max(p1.x, p2.x) : 0;
      const oy = p3.y < Math.min(p1.y, p2.y) ? Math.min(p1.y, p2.y) - p3.y : p3.y > Math.max(p1.y, p2.y) ? p3.y - Math.max(p1.y, p2.y) : 0;
      rot = oy >= ox ? 0 : Math.PI / 2;
    }
    return { type: 'dim', kind, p1, p2, p3, rot, text, style: c.doc.cur.dimStyle };
  };
  for (;;) {
    const p3 = await c.getPoint('Precise ubicación de línea de cota', { options: ['Texto'], preview: p => [mk(p)], rubber: false });
    if (p3 === 'Texto') { text = await c.getString('Indique texto de cota (<> = medida)', { spaces: true, def: '<>' }); continue; }
    const e = c.add(withAssoc(c, mk(p3), { p1: r1, p2: r2 }));
    c.print(`Texto de cota = ${dimParts(e).text.str}${e.assoc ? ' (asociativa)' : ''}`);
    return;
  }
}
def('DIMLINEAR', ['DLI', 'COTALINEAL', 'ACOLINEAL'], 'Cota lineal horizontal o vertical', c => dimAsk(c, 'lin'), { group: 'Anotación' });
def('DIMALIGNED', ['DAL', 'COTAALINEADA', 'ACOALINEADA'], 'Cota alineada con los puntos', c => dimAsk(c, 'ali'), { group: 'Anotación' });

async function dimCircle(c, kind) {
  const o = await c.getEntity('Designe arco o círculo', { filter: e => e.type === 'circle' || e.type === 'arc' });
  const { c: cen, r } = o.e;
  const mk = p => ({ type: 'dim', kind, p1: cen, p2: G.polar(cen, G.ang(cen, p), r), p3: p, style: c.doc.cur.dimStyle });
  const p = await c.getPoint('Precise ubicación de línea de cota', { preview: q => [mk(q)], rubber: false });
  const e = c.add(withAssoc(c, mk(p), { obj: o.e.id }));
  c.print(`Texto de cota = ${dimParts(e).text.str}`);
}
def('DIMRADIUS', ['DRA', 'COTARADIO', 'ACORADIO'], 'Cota de radio', c => dimCircle(c, 'rad'), { group: 'Anotación' });
def('DIMDIAMETER', ['DDI', 'COTADIAMETRO', 'ACODIAMETRO'], 'Cota de diámetro', c => dimCircle(c, 'dia'), { group: 'Anotación' });
def('DIMANGULAR', ['DAN', 'COTAANGULAR', 'ACOANGULO'], 'Cota angular entre dos líneas, de un arco o por tres puntos', async c => {
  const o = await c.getEntity('Designe arco, círculo o línea, o INTRO para precisar vértice', { allowEnter: true, filter: e => ['line', 'arc', 'circle'].includes(e.type) });
  let base, refs = {};
  if (!o) {
    const cen = await c.getPoint('Precise vértice del ángulo'), rc = c.ref();
    const p1 = await c.getPoint('Precise primer punto final del ángulo', { base: cen }), r1 = c.ref();
    const p2 = await c.getPoint('Precise segundo punto final del ángulo', { base: cen });
    base = { c: cen, p1, p2 };
    refs = { c: rc, p1: r1, p2: c.ref() };
  } else if (o.e.type === 'arc') {
    const e = o.e;
    base = { c: e.c, p1: G.polar(e.c, e.a1, e.r), p2: G.polar(e.c, e.a2, e.r) };
    refs = { obj: e.id };
  } else if (o.e.type === 'circle') {
    const e = o.e, p2 = await c.getPoint('Precise segundo punto final del ángulo', { base: e.c });
    base = { c: e.c, p1: G.polar(e.c, G.ang(e.c, o.pt), e.r), p2 };
    refs = { obj: e.id, p2: c.ref() };
  } else {
    const o2 = await c.getEntity('Designe segunda línea', { filter: e => e.type === 'line' && e.id !== o.e.id });
    base = angBase(o.e, o2.e);
    if (!base) return c.print('Las líneas son paralelas.');
    refs = { l1: o.e.id, l2: o2.e.id };
  }
  if (G.dist(base.c, base.p1) < 1e-12 || G.dist(base.c, base.p2) < 1e-12) return c.print('Ángulo no válido.');
  let text = '';
  const mk = p3 => ({ type: 'dim', kind: 'ang', ...base, p3, text, style: c.doc.cur.dimStyle });
  for (;;) {
    const p3 = await c.getPoint('Precise ubicación del arco de cota', { options: ['Texto'], preview: p => [mk(p)], rubber: false });
    if (p3 === 'Texto') { text = await c.getString('Indique texto de cota (<> = medida)', { spaces: true, def: '<>' }); continue; }
    const e = c.add(withAssoc(c, mk(p3), refs));
    c.print(`Texto de cota = ${dimParts(e).text.str}`);
    return;
  }
}, { group: 'Anotación' });

def('DIMORDINATE', ['DOR', 'COTACOORD', 'ACOCOORDENADA'], 'Cota de la coordenada X o Y de un punto', async c => {
  const f = await c.getPoint('Precise ubicación de punto'), rf = c.ref();
  let axis = null, text = '';
  const mk = q => ({ type: 'dim', kind: 'ord', p1: f, p2: f, p3: q, ...(axis ? { axis } : {}), text, style: c.doc.cur.dimStyle });
  for (;;) {
    const q = await c.getPoint('Precise punto final de directriz', { base: f, options: ['Xdato', 'Ydato', 'Texto'], preview: p => [mk(p)], rubber: false });
    if (q === 'Xdato') { axis = 'x'; continue; }
    if (q === 'Ydato') { axis = 'y'; continue; }
    if (q === 'Texto') { text = await c.getString('Indique texto de cota (<> = medida)', { spaces: true, def: '<>' }); continue; }
    const n = withAssoc(c, mk(q), { p1: rf });
    n.axis = dimParts(n).axis;
    const e = c.add(n);
    c.print(`Texto de cota = ${dimParts(e).text.str}`);
    return;
  }
}, { group: 'Anotación' });

def('DIMARC', ['DAR', 'COTAARCO', 'ACOARCO'], 'Cota de longitud de arco de un arco o de un tramo de arco de polilínea (completa o parcial)', async c => {
  const o = await c.getEntity('Designe arco o segmento de arco de polilínea', { filter: e => e.type === 'arc' || (e.type === 'pline' && e.bulges?.some(b => b)) });
  let base, refs = {};
  if (o.e.type === 'arc') { const e = o.e; base = { c: e.c, p1: G.polar(e.c, e.a1, e.r), p2: G.polar(e.c, e.a2, e.r) }; refs = { obj: e.id }; }
  else {
    const e = o.e, pcs = plPieces(e), k = Math.min(Math.floor(OPS.curveInfo(e).param(OPS.nearestOn(e, o.pt))), pcs.length - 1), pc = pcs[k];
    if (!pc.bulge) return c.print('El tramo designado de la polilínea es recto.');
    base = { c: pc.prim.c, p1: pc.bulge > 0 ? pc.a : pc.b, p2: pc.bulge > 0 ? pc.b : pc.a };
  }
  let text = '', partial = false;
  const mk = p3 => ({ type: 'dim', kind: 'arc', ...base, p3, text, ...(partial ? { partial: true } : {}), style: c.doc.cur.dimStyle });
  for (;;) {
    const p3 = await c.getPoint('Precise ubicación de cota de longitud de arco', { options: ['Parcial', 'Texto'], preview: p => [mk(p)], rubber: false });
    if (p3 === 'Texto') { text = await c.getString('Indique texto de cota (<> = medida)', { spaces: true, def: '<>' }); continue; }
    if (p3 === 'Parcial') {
      const r = G.dist(base.c, base.p1), a0 = G.ang(base.c, base.p1), sw = G.sweep(a0, G.ang(base.c, base.p2));
      const onArc = p => { const t = Math.min(sw, G.normAng(G.ang(base.c, p) - a0)); return { t, p: G.polar(base.c, a0 + t, r) }; };
      const q1 = onArc(await c.getPoint('Precise primer punto para cota de longitud de arco'));
      const q2 = onArc(await c.getPoint('Precise segundo punto para cota de longitud de arco'));
      if (Math.abs(q1.t - q2.t) < 1e-9) { c.print('Los dos puntos coinciden.'); continue; }
      [base.p1, base.p2] = q1.t < q2.t ? [q1.p, q2.p] : [q2.p, q1.p];
      partial = true;
      continue;
    }
    const e = c.add(withAssoc(c, mk(p3), refs));
    c.print(`Texto de cota = ${dimParts(e).text.str}`);
    return;
  }
}, { group: 'Anotación' });

def('DIMJOGGED', ['DJO', 'COTARECODO', 'ACORECODO', 'DIMJOG'], 'Cota de radio con recodo para arcos y círculos de radio grande (centro desplazado)', async c => {
  const o = await c.getEntity('Designe arco o círculo', { filter: e => e.type === 'circle' || e.type === 'arc' });
  const { c: cen, r } = o.e;
  const p4 = await c.getPoint('Precise ubicación de anulación de centro');
  let text = '';
  const mk = (p3, p5) => ({ type: 'dim', kind: 'jog', p1: cen, p2: G.polar(cen, G.ang(cen, p3), r), p3, p4, p5: p5 || G.lerp(cen, p3, 0.5), text, style: c.doc.cur.dimStyle });
  let p3;
  for (;;) {
    p3 = await c.getPoint('Precise ubicación de línea de cota', { options: ['Texto'], preview: p => [mk(p)], rubber: false });
    if (p3 !== 'Texto') break;
    text = await c.getString('Indique texto de cota (<> = medida)', { spaces: true, def: '<>' });
  }
  const p5 = await c.getPoint('Precise ubicación de recodo', { preview: p => [mk(p3, p)], rubber: false });
  const e = c.add(withAssoc(c, mk(p3, p5), { obj: o.e.id }));
  c.print(`Texto de cota = ${dimParts(e).text.str}`);
}, { group: 'Anotación' });

const ML_KW = { Mtexto: 'mtext', Globo: 'block', Ninguno: 'none' };
def('MLEADER', ['MLD', 'LE', 'DIRECTRIZM', 'DIRECTRIZ', 'QLEADER'], 'Directriz múltiple con texto, globo numerado o sin contenido', async c => {
  const S = c.settings, st = c.doc.mleaderStyle(c.doc.cur.mleaderStyle);
  const base = { mstyle: st.name, w: 0 }, eff = mlEff(base);
  c.print(`Estilo de directriz: "${st.name}".`);
  let content = S.mleaderContent || st.content || 'mtext', first;
  const names = { mtext: 'texto', block: 'globo', none: 'ninguno' };
  for (;;) {
    const r = await c.getPoint(`Precise ubicación de la punta de flecha (contenido: ${names[content]})`, { options: ['Contenido'] });
    if (r !== 'Contenido') { first = r; break; }
    const k = await c.getKeyword('Indique tipo de contenido', Object.keys(ML_KW), Object.keys(ML_KW).find(x => ML_KW[x] === content));
    content = S.mleaderContent = ML_KW[k];
  }
  const pts = [first], sample = content === 'block' ? String((S.balloonNum || 0) + 1) : content === 'mtext' ? 'Texto' : '';
  const mk = (list, text = sample) => ({ type: 'mleader', ...base, pts: list, content, text });
  for (;;) {
    const r = await c.getPoint(pts.length < 2 ? 'Precise ubicación del rellano' : 'Precise punto siguiente o INTRO para terminar', {
      base: pts[pts.length - 1], allowEnter: pts.length >= 2, rubber: false, preview: p => [mk([...pts, p])],
    });
    if (r === null) break;
    if (!G.eqPt(r, pts[pts.length - 1], 1e-9)) pts.push(r);
    if (pts.length >= 12) break;
  }
  let text = '', rich = false;
  if (content === 'mtext') {
    const v = await c.app.ui.editMText({ text: '', h: eff.h, style: eff.textStyle }, 'Texto de la directriz');
    if (!v?.text) return c.print('Directriz cancelada: no hay texto.');
    ({ text, rich } = v);
  } else if (content === 'block') {
    text = (await c.getString('Indique el texto del globo', { def: sample })).trim();
    if (/^\d+$/.test(text)) S.balloonNum = +text;
  }
  c.add({ ...mk(pts, text), ...(rich ? { rich: true } : {}) });
}, { group: 'Anotación' });

def('TABLE', ['TB', 'TABLA'], 'Crea una tabla con título, encabezados y celdas de texto', async c => {
  const S = c.settings, ts = c.doc.tableStyle(c.doc.cur.tableStyle);
  let nc = S.tableCols || 3, nr = S.tableRows || 4, th = ts.th, own = false;
  c.print(`Estilo de tabla: "${ts.name}".`);
  const mk = p => {
    const cw = th * 14, rh = th * (1.2 + 2 * (ts.margin ?? 0.6)), n = nr + 2;
    const cells = Array.from({ length: n }, (_, r) => Array.from({ length: nc }, (_, k) => (r === 0 && k === 0 ? 'Título' : r === 1 ? `Encabezado ${k + 1}` : '')));
    return { type: 'table', p, rot: 0, cols: Array(nc).fill(cw), rows: Array(n).fill(rh), cells, tstyle: ts.name, ...(own ? { th } : {}), title: true, header: true };
  };
  let p;
  for (;;) {
    const r = await c.getPoint(`Precise punto de inserción (${nc} columnas, ${nr} filas de datos, altura de texto ${fmt(th, 4)})`, { options: ['Columnas', 'Filas', 'Altura'], preview: q => [mk(q)] });
    if (r === 'Columnas') { nc = S.tableCols = await c.getNumber('Indique número de columnas', { def: nc, int: true, min: 1, max: 50 }); continue; }
    if (r === 'Filas') { nr = S.tableRows = await c.getNumber('Indique número de filas de datos', { def: nr, int: true, min: 1, max: 500 }); continue; }
    if (r === 'Altura') { const v = await c.getDistance('Precise altura de texto', { def: th }); if (v > 0) { th = v; own = true; } continue; }
    p = r; break;
  }
  const e = c.add(mk(p));
  const v = await c.app.ui.editTable(e, [1, 0]);
  if (v) c.doc.modify(e.id, x => Object.assign(x, v));
}, { group: 'Anotación' });

def('MLEADERSTYLE', ['MLS', 'ESTILODIRECTRIZ'], 'Administra los estilos de directriz múltiple', async c => { await c.app.ui.mleaderStyleManager(); }, { group: 'Anotación' });
def('TABLESTYLE', ['TS', 'ESTILOTABLA'], 'Administra los estilos de tabla', async c => { await c.app.ui.tableStyleManager(); }, { group: 'Anotación' });

// ---- Campos ----
const FIELD_KW = ['Fecha', 'Archivo', 'Presentación', 'Escala', 'aUtor', 'Objeto'];
// Pide un campo por la línea de comandos y devuelve su código (%<…>%)
async function askField(c) {
  const k = await c.getKeyword('Indique tipo de campo', FIELD_KW, 'Fecha');
  if (k === 'Fecha') {
    c.print(`Formatos: ${DATE_FORMATS.join(' · ')}`);
    const f = await c.getString('Indique formato de fecha', { spaces: true, def: DATE_FORMATS[0] });
    return f && f !== DATE_FORMATS[0] ? `%<Fecha:${f}>%` : '%<Fecha>%';
  }
  if (k !== 'Objeto') return `%<${k === 'aUtor' ? 'Autor' : k}>%`;
  const o = await c.getEntity('Designe objeto', { filter: e => Object.values(FIELD_PROPS).some(fn => fn(e) != null) });
  const props = Object.keys(FIELD_PROPS).filter(n => FIELD_PROPS[n](o.e) != null);
  c.print(props.map(n => `${n} = ${fmt(FIELD_PROPS[n](o.e), 4)}`).join(' · '));
  const prop = await c.getKeyword('Indique propiedad', props, props[0]);
  const dec = await c.getNumber('Indique número de decimales', { def: 2, int: true, min: 0, max: 8 });
  return `%<Obj:${o.e.id}:${prop}:${dec}>%`;
}
def('FIELD', ['CAMPO'], 'Inserta un texto con un campo que se actualiza solo (fecha, archivo, escala, propiedad de un objeto…)', async c => {
  const code = await askField(c);
  c.print(`Valor actual: ${fieldText(code)}`);
  const p = await c.getPoint('Precise punto de inserción del texto');
  const h = await c.getDistance('Precise altura', { base: p, def: c.settings.textH });
  if (!(h > 0)) return;
  c.add({ type: 'mtext', p, w: 0, h, rot: 0, attach: 'bl', text: code });
}, { group: 'Anotación' });

// ---- Cotas continuas, de línea base y rápidas ----
const SERIES = ['lin', 'ali', 'ord', 'ang'];
const isSeriesDim = e => e?.type === 'dim' && SERIES.includes(e.kind);
const dimDli = (c, e) => { const ds = c.doc.dimStyle(e.style); return (ds.dli ?? 3.75) * (ds.scale || 1); };
// Copia de una cota con los orígenes intercambiados (para continuar desde la línea de referencia designada)
const swapOrigins = e => ({ ...e, p1: e.p2, p2: e.p1, ...(e.assoc ? { assoc: { ...e.assoc, p1: e.assoc.p2, p2: e.assoc.p1 } } : {}) });
const midSector = (c, p1, p2, ccw, R) => { const a1 = G.ang(c, p1), a2 = G.ang(c, p2); return G.polar(c, ccw ? a1 + G.sweep(a1, a2) / 2 : a2 + G.sweep(a2, a1) / 2, R); };

// Siguiente cota de una serie. mode: 'cont' (encadenada a prev) o 'base' (desde el origen de first, desplazada)
function seriesNext(c, mode, first, prev, p, ref) {
  const st = { type: 'dim', style: prev.style };
  if (prev.kind === 'ord') {
    const p3 = prev.axis === 'x' ? P(p.x, prev.p3.y) : P(prev.p3.x, p.y);
    return withAssoc(c, { ...st, kind: 'ord', p1: p, p2: p, p3, axis: prev.axis }, { p1: ref });
  }
  if (prev.kind === 'ang') {
    const R = G.dist(prev.c, prev.p3), ccw = G.angIn(G.ang(prev.c, prev.p3), G.ang(prev.c, prev.p1), G.ang(prev.c, prev.p2));
    const [p1, r1, rad] = mode === 'cont' ? [prev.p2, prev.assoc?.p2, R] : [first.p1, first.assoc?.p1, R + dimDli(c, prev)];
    return withAssoc(c, { ...st, kind: 'ang', c: prev.c, p1, p2: p, p3: midSector(prev.c, p1, p, ccw, rad) }, { c: prev.assoc?.c, p1: r1, p2: ref });
  }
  const rot = prev.kind === 'lin' ? prev.rot || 0 : G.ang(prev.p1, prev.p2), n = G.perp(P(Math.cos(rot), Math.sin(rot))), d = dimParts(prev);
  if (mode === 'cont') return withAssoc(c, { ...st, kind: 'lin', p1: prev.p2, p2: p, p3: d.d2, rot }, { p1: prev.assoc?.p2, p2: ref });
  const s = Math.sign(G.dot(G.sub(d.d1, first.p1), n)) || 1;
  return withAssoc(c, { ...st, kind: 'lin', p1: first.p1, p2: p, p3: G.add(d.d2, G.mul(n, s * dimDli(c, prev))), rot }, { p1: first.assoc?.p1, p2: ref });
}

async function dimSeries(c, mode) {
  const doc = c.doc;
  // Cota base designada: la línea de referencia más próxima al punto designado es el origen de la serie
  const pickBase = async () => {
    const o = await c.getEntity('Designe cota base', { filter: isSeriesDim });
    const e = o.e;
    if (e.kind === 'ord') return e;
    const nearP1 = G.dist(o.pt, e.p1) < G.dist(o.pt, e.p2);
    return mode === 'cont' ? (nearP1 ? swapOrigins(e) : e) : (nearP1 ? e : swapOrigins(e));
  };
  let prev = [...doc.ents].reverse().find(isSeriesDim);
  if (!prev) { c.print('No hay una cota anterior: designe la cota base.'); prev = await pickBase(); }
  let first = prev;
  const made = [];
  c.print(`Cota base: ${({ lin: 'lineal', ali: 'alineada', ord: 'de coordenada', ang: 'angular' })[prev.kind]}.`);
  for (;;) {
    const r = await c.getPoint(`Precise origen de la siguiente línea de referencia (${mode === 'cont' ? 'continua' : 'línea base'}) o INTRO para terminar`, {
      allowEnter: true, options: ['Seleccionar', 'desHacer'], rubber: false, preview: q => [seriesNext(c, mode, first, prev, q, null)],
    });
    if (r === null) break;
    if (r === 'Seleccionar') { prev = first = await pickBase(); continue; }
    if (r === 'desHacer') { const m = made.pop(); if (m) { doc.remove(m.e.id); prev = m.prev; } else c.print('Nada que deshacer.'); continue; }
    const e = c.add(seriesNext(c, mode, first, prev, r, c.ref()));
    c.print(`Texto de cota = ${dimParts(e).text.str}`);
    made.push({ e, prev });
    prev = e;
  }
}
def('DIMCONTINUE', ['DCO', 'COTACONTINUA', 'ACOCONTINUA'], 'Cotas encadenadas a continuación de la última cota (o de una designada)', c => dimSeries(c, 'cont'), { group: 'Anotación' });
def('DIMBASELINE', ['DBA', 'COTABASE', 'ACOLINEABASE'], 'Cotas desde la misma línea base que la última cota (o una designada)', c => dimSeries(c, 'base'), { group: 'Anotación' });

// Puntos acotables de una entidad, con su referencia para la asociatividad
function qdimPoints(e) {
  const s = TYPES[e.type].snaps(e), out = [];
  const take = k => (s[k] || []).forEach((p, i) => out.push({ p, ref: { id: e.id, snap: k, i } }));
  if (['line', 'arc', 'pline', 'spline'].includes(e.type)) take('end');
  if (['arc', 'circle', 'ellipse'].includes(e.type)) take('cen');
  if (e.type === 'point') take('nod');
  if (e.type === 'insert') out.push({ p: e.p, ref: { id: e.id, snap: 'ins', i: 0 } });
  return out;
}
const QD_KW = { Continua: 'cont', 'Línea base': 'base', Ordenada: 'ord' };
def('QDIM', ['QD', 'ACOTARAPIDO', 'COTARAPIDA'], 'Acotación rápida de una serie de objetos: continua, línea base u ordenada', async c => {
  const S = c.settings, doc = c.doc;
  const ids = await c.getSelection('Designe la geometría que desea acotar');
  const pts = ids.map(id => doc.get(id)).filter(Boolean).flatMap(qdimPoints);
  if (pts.length < 2) return c.print('Se necesitan al menos dos puntos acotables (extremos, centros, vértices).');
  const bb = bbPts(pts.map(q => q.p)), size = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) || 1;
  let mode = S.qdimMode || 'cont';
  const build = (loc, assoc) => {
    const ox = loc.x < bb.x1 ? bb.x1 - loc.x : loc.x > bb.x2 ? loc.x - bb.x2 : 0, oy = loc.y < bb.y1 ? bb.y1 - loc.y : loc.y > bb.y2 ? loc.y - bb.y2 : 0;
    const horiz = oy >= ox, k = horiz ? 'x' : 'y';
    const sorted = [...pts].sort((a, b) => a.p[k] - b.p[k]).filter((q, i, a) => !i || q.p[k] - a[i - 1].p[k] > size * 1e-9);
    const ref = q => (assoc ? q.ref : null), style = doc.cur.dimStyle, base = { type: 'dim', style };
    if (mode === 'ord') return sorted.map(q => withAssoc(c, { ...base, kind: 'ord', p1: q.p, p2: q.p, p3: horiz ? P(q.p.x, loc.y) : P(loc.x, q.p.y), axis: horiz ? 'x' : 'y' }, { p1: ref(q) }));
    const rot = horiz ? 0 : Math.PI / 2;
    if (mode === 'cont') return sorted.slice(1).map((q, i) => withAssoc(c, { ...base, kind: 'lin', p1: sorted[i].p, p2: q.p, p3: loc, rot }, { p1: ref(sorted[i]), p2: ref(q) }));
    const ds = doc.dimStyle(style), dli = (ds.dli ?? 3.75) * (ds.scale || 1), s = (horiz ? loc.y < bb.y1 : loc.x < bb.x1) ? -1 : 1;
    return sorted.slice(1).map((q, i) => withAssoc(c, { ...base, kind: 'lin', p1: sorted[0].p, p2: q.p, p3: horiz ? P(loc.x, loc.y + s * i * dli) : P(loc.x + s * i * dli, loc.y), rot }, { p1: ref(sorted[0]), p2: ref(q) }));
  };
  for (;;) {
    const name = Object.keys(QD_KW).find(k => QD_KW[k] === mode);
    const r = await c.getPoint(`Precise ubicación de línea de cota (${name.toLowerCase()})`, { options: Object.keys(QD_KW), rubber: false, preview: q => build(q, false) });
    if (typeof r === 'string') { mode = S.qdimMode = QD_KW[r]; continue; }
    const list = build(r, true);
    for (const e of list) c.add(e);
    return c.print(`${list.length} cota(s) creada(s).`);
  }
}, { group: 'Anotación', sel: true });

def('DIMDISASSOCIATE',['DDA', 'DESASOCIARCOTA'], 'Elimina la asociatividad de las cotas designadas', async c => {
  const ids = (await c.getSelection('Designe cotas')).filter(id => c.doc.get(id)?.assoc && c.doc.get(id).type === 'dim');
  for (const id of ids) c.doc.modify(id, e => { delete e.assoc; });
  c.print(`${ids.length} cota(s) desasociada(s).`);
}, { group: 'Anotación', sel: true });

def('DIMREASSOCIATE', ['DRE', 'REASOCIARCOTA'], 'Asocia los puntos de las cotas a la geometría', async c => {
  const ids = (await c.getSelection('Designe cotas')).filter(id => c.doc.get(id)?.type === 'dim');
  const get = id => c.doc.get(id);
  for (const id of ids) {
    const e = get(id), refs = { ...e.assoc };
    c.app.sel.clear(); c.app.sel.add(id); c.app.selChanged();
    if (e.kind === 'rad' || e.kind === 'dia' || (e.kind === 'ang' && !e.l1 && G.dist(e.c, e.p1) > 1e-9 && Math.abs(G.dist(e.c, e.p1) - G.dist(e.c, e.p2)) < 1e-9)) {
      const o = await c.getEntity('Designe arco o círculo, o INTRO para omitir', { allowEnter: true, filter: x => x.type === 'circle' || x.type === 'arc' });
      if (o) { refs.obj = o.e.id; delete refs.c; delete refs.p1; }
    } else if (e.kind === 'ang' && e.l1) {
      const a = await c.getEntity('Designe primera línea, o INTRO para omitir', { allowEnter: true, filter: x => x.type === 'line' });
      if (a) {
        const b = await c.getEntity('Designe segunda línea', { filter: x => x.type === 'line' && x.id !== a.e.id });
        Object.assign(refs, { l1: a.e.id, l2: b.e.id });
      }
    } else {
      const keys = e.kind === 'ord' ? [['p1', 'ubicación del punto']] : e.kind === 'ang' ? [['c', 'vértice'], ['p1', 'primer punto final'], ['p2', 'segundo punto final']] : [['p1', 'primer origen de línea de referencia'], ['p2', 'segundo origen de línea de referencia']];
      for (const [k, label] of keys) {
        const p = await c.getPoint(`Precise ${label} o INTRO para mantenerlo`, { allowEnter: true });
        if (!p) continue;
        if (c.app.lastRef) refs[k] = c.app.lastRef; else c.print('El punto no está sobre un objeto: no se asocia.');
      }
    }
    c.doc.modify(id, x => {
      if (!Object.keys(refs).length) return;
      x.assoc = refs;
      if (!updateDim(x, get)) delete x.assoc;
    });
  }
  c.app.clearSel();
  c.print(`${ids.filter(id => get(id)?.assoc).length} de ${ids.length} cota(s) asociada(s).`);
}, { group: 'Anotación', sel: true });

def('STYLE', ['ST', 'ESTILO'], 'Administra los estilos de texto', async c => { await c.app.ui.textStyleManager(); }, { group: 'Anotación' });
def('DIMSTYLE', ['D', 'DST', 'ACOESTIL', 'ESTILOCOTA'], 'Administra los estilos de cota', async c => { await c.app.ui.dimStyleManager(); }, { group: 'Anotación' });

// ---- DIMBREAK: cortes en las cotas donde las cruzan otros objetos ----
def('DIMBREAK', ['DBR', 'CORTARCOTA', 'ROMPERCOTA'], 'Rompe la línea de cota (y sus líneas de referencia) donde la cruzan otros objetos', async c => {
  const o = await c.getEntity('Designe cota para romper', { filter: e => e.type === 'dim' });
  if (o.e.breaks?.length) {
    const k = await c.getKeyword(`La cota tiene ${o.e.breaks.length} corte(s)`, ['Añadir', 'Quitar'], 'Añadir');
    if (k === 'Quitar') { c.doc.modify(o.e.id, e => { delete e.breaks; }); c.print('Cortes de cota eliminados.'); return; }
  }
  const how = await c.getKeyword('Indique cómo calcular los cortes', ['Automático', 'Seleccionar objetos'], 'Automático');
  const objs = how === 'Automático'
    ? c.doc.ents.filter(e => e.id !== o.e.id && !['dim', 'mleader', 'table'].includes(e.type) && c.doc.visible(e))
    : (await c.getSelection('Designe los objetos que cortan la cota')).map(id => c.doc.get(id)).filter(Boolean);
  const d = dimParts(o.e), segs = d.lines.map(([a, b]) => ({ k: 's', a, b })), pts = [];
  for (const ob of objs) for (const q of primsOf(ob)) for (const s of segs) pts.push(...G.primInt(q, s));
  const uniq = pts.filter((p, i) => pts.findIndex(q => G.dist(p, q) < 1e-6) === i);
  if (!uniq.length) return c.print('No hay intersecciones con la cota.');
  const len = (d.text?.h || 2.5) * 1.2;
  c.doc.modify(o.e.id, e => { e.breaks = [...(e.breaks || []), ...uniq.map(p => ({ p, len }))]; });
  c.print(`${uniq.length} corte(s) añadido(s) a la cota.`);
}, { group: 'Anotación' });
// ---- DIMSPACE: separa o alinea cotas paralelas respecto a una cota base ----
const dimDir = e => (e.kind === 'ali' ? G.norm(G.sub(e.p2, e.p1)) : P(Math.cos(e.rot || 0), Math.sin(e.rot || 0)));
def('DIMSPACE', ['DSP', 'ESPACIARCOTAS'], 'Separa o alinea cotas paralelas a partir de una cota base (0 = alinear)', async c => {
  const base = await c.getEntity('Designe cota base', { filter: e => e.type === 'dim' && (e.kind === 'lin' || e.kind === 'ali') });
  const ids = await c.getSelection('Designe cotas que desea espaciar', { noPickfirst: true });
  const targets = ids.map(id => c.doc.get(id)).filter(e => e && e.type === 'dim' && e.id !== base.e.id && (e.kind === 'lin' || e.kind === 'ali'));
  if (!targets.length) return c.print('No hay cotas lineales o alineadas que espaciar.');
  const sp = await c.getNumber('Indique espaciado entre cotas (0 = alinear con la base)', { def: 10, min: 0 });
  const B = base.e, dir = dimDir(B), n = G.perp(dir), bc = G.dot(B.p3, n);
  const items = targets.map(e => {
    const d = dimDir(e);
    return { e, coord: G.dot(e.p3, n), side: G.cross(dir, d) < 0 ? -1 : 1 };
  }).sort((a, b) => Math.abs(a.coord - bc) - Math.abs(b.coord - bc));
  items.forEach((it, k) => {
    const sign = it.side * (Math.sign(it.coord - bc) || 1), want = bc + sign * sp * (k + 1);
    c.doc.modify(it.e.id, e => { e.p3 = G.add(e.p3, G.mul(n, want - it.coord)); });
  });
  c.print(`${items.length} cota(s) ${sp ? `espaciada(s) a ${fmt(sp, 4)}` : 'alineada(s) con la cota base'}.`);
}, { group: 'Anotación' });

// ================= BLOQUES =================
def('BLOCK', ['B', 'BLOQUE'], 'Crea un bloque a partir de objetos designados', async c => {
  const name = (await c.getString('Indique nombre de bloque', { spaces: true })).trim();
  if (!name) return;
  if (/[<>/\\":;?*|=`]/.test(name) || name.startsWith('*')) return c.print('Nombre de bloque no válido.');
  if (c.doc.blocks[name]) {
    const k = await c.getKeyword(`El bloque "${name}" ya existe. ¿Desea redefinirlo?`, ['Sí', 'No'], 'No');
    if (k !== 'Sí') return;
  }
  const base = await c.getPoint('Precise punto base de inserción');
  const ids = (await c.getSelection('Designe objetos para el bloque')).filter(id => c.doc.get(id)?.type !== 'vport');
  if (!ids.length) return c.print('No se ha designado ningún objeto.');
  const ents = ids.map(id => { const e = cloneEnt(c.doc.get(id)); delete e.id; delete e.assoc; delete e.seed; return e; });
  if (c.doc.refersTo(ents, name)) return c.print('Un bloque no puede contenerse a sí mismo.');
  c.doc.defineBlock(name, base, ents);
  for (const id of ids) c.doc.remove(id);
  c.add({ type: 'insert', name, p: base, sx: 1, sy: 1, rot: 0 });
  const na = ents.filter(e => e.type === 'attdef').length;
  c.print(`Bloque "${name}" ${ents.length} objeto(s)${na ? `, ${na} atributo(s)` : ''}. Los objetos se han convertido en una referencia al bloque.`);
}, { group: 'Bloques', sel: true });

def('ATTDEF', ['ATT', 'DEFATR', 'ATRDEF'], 'Define un atributo (texto variable) para incluir en un bloque', async c => {
  const S = c.settings;
  const tag = (await c.getString('Indique etiqueta de atributo')).trim().toUpperCase().replace(/\s+/g, '_');
  if (!tag) return;
  const prompt = await c.getString('Indique solicitud de atributo', { spaces: true, def: '' });
  const dv = await c.getString('Indique valor de atributo por defecto', { spaces: true, def: '' });
  let align = 'l', invisible = false;
  let p = await c.getPoint('Precise punto inicial de texto', { options: ['Justificar', 'Invisible'] });
  while (typeof p === 'string') {
    if (p === 'Invisible') { invisible = !invisible; c.print(invisible ? 'El atributo será invisible.' : 'El atributo será visible.'); }
    else align = { Izquierda: 'l', Centro: 'c', Derecha: 'r' }[await c.getKeyword('Indique una opción', ['Izquierda', 'Centro', 'Derecha'], 'Izquierda')];
    p = await c.getPoint('Precise punto inicial de texto', { options: ['Justificar', 'Invisible'] });
  }
  const h = await c.getDistance('Precise altura', { base: p, def: S.textH });
  if (!(h > 0)) return;
  S.textH = h;
  const rot = await c.getAngle('Precise ángulo de rotación', { base: p, def: 0 });
  c.add({ type: 'attdef', p, h, rot, align, tag, prompt, def: dv, ...(invisible ? { invisible: true } : {}) });
  c.print(`Atributo "${tag}" definido. Inclúyalo en un bloque con BLOQUE; cada referencia tendrá su propio valor.`);
}, { group: 'Bloques' });

def('ATTEDIT', ['ATE', 'EATTEDIT', 'EDITATR'], 'Edita los valores de los atributos de una referencia a bloque', async c => {
  const o = await c.getEntity('Designe referencia a bloque con atributos', { filter: e => e.type === 'insert' && blockAttdefs(e.name).length > 0 });
  const v = await c.app.ui.editAttribs(o.e);
  if (v) c.doc.modify(o.e.id, e => { e.attribs = v; });
}, { group: 'Bloques' });

def('INSERT', ['I', 'INSERTAR', 'DDINSERT'], 'Inserta una referencia a un bloque', async (c, arg) => {
  if (!Object.keys(c.doc.blocks).some(n => !n.startsWith('*') && !c.doc.blocks[n].xrefDep)) return c.print('No hay bloques definidos. Cree uno con BLOQUE.');
  const name = arg || await c.app.ui.pickBlock();
  if (!name || !c.doc.blocks[name]) return;
  await placeInsert(c, name);
}, { group: 'Bloques' });

// Pide punto de inserción, escala y rotación (y los atributos) y añade la referencia al bloque
async function placeInsert(c, name) {
  let s = 1, rot = 0;
  const cur = c.doc.cur;
  const mk = p => ({ type: 'insert', name, p, sx: s, sy: s, rot, layer: cur.layer, color: cur.color, ltype: cur.ltype, lw: cur.lw });
  for (;;) {
    const r = await c.getPoint(`Precise punto de inserción de "${name}"`, { options: ['Escala', 'Rotación'], preview: p => [mk(p)] });
    if (r === 'Escala') { const v = await c.getNumber('Indique factor de escala', { def: s }); if (v) s = v; continue; }
    if (r === 'Rotación') { rot = G.rad(await c.getNumber('Indique ángulo de rotación (grados)', { def: G.deg(rot) })); continue; }
    const ins = mk(r), defs = blockAttdefs(name);
    if (defs.length) {
      ins.attribs = {};
      for (const a of defs) ins.attribs[a.tag] = await c.getString(a.prompt || `Indique valor de ${a.tag}`, { spaces: true, def: a.def || '' });
    }
    return c.add(ins);
  }
}

// ---- Referencias externas ----
async function readXrefFile(c, name, hint) {
  const app = c.app, h = app.xrefHandles?.[name];
  let picked = null;
  if (h) { try { picked = { file: await h.getFile(), handle: h }; } catch { picked = null; } }
  if (!picked) {
    if (hint) c.print(`Seleccione el archivo de la referencia "${name}" (${hint}).`);
    picked = await app.io.pickFile('Dibujos de referencia');
  }
  if (!picked) return null;
  (app.xrefHandles ||= {})[name] = picked.handle;
  return { src: parseSource(await app.io.readText(picked.file), picked.file.name), file: picked.file.name };
}
def('XATTACH', ['XA', 'ENLAZARX', 'REFXENLAZAR'], 'Enlaza otro dibujo (.tcad o .dxf) como referencia externa', async c => {
  const doc = c.doc;
  if (doc.bedit) return c.print('No se pueden enlazar referencias dentro del editor de bloques.');
  const picked = await c.app.io.pickFile('Dibujos de referencia');
  if (!picked) return;
  let name = cleanXrefName(picked.file.name);
  if (doc.blocks[name] && !doc.blocks[name].xref) name = (await c.getString(`Ya existe un bloque "${name}". Indique otro nombre para la referencia`, { spaces: true, def: `${name}_ref` })).trim();
  if (!name || (doc.blocks[name] && !doc.blocks[name].xref)) return c.print('Nombre no válido o ya usado por un bloque.');
  if (!doc.blocks[name]) {
    let src;
    try { src = parseSource(await c.app.io.readText(picked.file), picked.file.name); } catch (err) { return c.print(`No se puede leer la referencia: ${err.message}`); }
    const n = defineXref(doc, name, src, picked.file.name);
    (c.app.xrefHandles ||= {})[name] = picked.handle;
    c.print(`Referencia externa "${name}" enlazada: ${n} objeto(s) de ${picked.file.name}.`);
  }
  await placeInsert(c, name);
}, { group: 'Insertar' });

def('XREF', ['XR', 'REFEXTERNAS', 'REFX'], 'Administra las referencias externas: recargar, desenlazar o unir', async c => {
  const doc = c.doc;
  for (;;) {
    if (!xrefNames(doc).length) return c.print('No hay referencias externas. Enlace una con XATTACH.');
    const r = await c.app.ui.xrefManager();
    if (!r) return;
    const { action, name } = r;
    if (action === 'attach') { c.app.run('XATTACH'); return; }
    if (action === 'reload') {
      const got = await readXrefFile(c, name, doc.blocks[name].xref.file);
      if (!got) continue;
      try { defineXref(doc, name, got.src, got.file); c.print(`Referencia "${name}" recargada desde ${got.file}.`); } catch (err) { c.print(`No se puede recargar: ${err.message}`); }
    } else if (action === 'detach') {
      const n = xrefRefs(doc, name);
      detachXref(doc, name);
      c.print(`Referencia "${name}" desenlazada (${n} inserción(es) eliminada(s)).`);
    } else if (action === 'bind') {
      bindXref(doc, name);
      c.print(`Referencia "${name}" unida al dibujo: ahora es un bloque normal; sus capas se llaman "${name}$0$…".`);
    }
  }
}, { group: 'Insertar' });

// ---- Delimitación de referencias (XCLIP) ----
const invM = m => { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
// Contorno del dibujo → coordenadas de la definición del bloque de la referencia
const toBlockCoords = (c, e, poly) => { const M = invM(insertMatrix(e, c.doc.blocks[e.name])); return poly.map(q => Mx.ap(M, q)); };
def('XCLIP', ['XC', 'DELIMITARX', 'DELIMITAR', 'CLIPX'], 'Delimita referencias a bloques, referencias externas e imágenes con un contorno rectangular o poligonal (normal o invertido)', async c => {
  const ins = (await c.getSelection()).map(id => c.doc.get(id)).filter(e => (e?.type === 'insert' && c.doc.blocks[e.name]) || e?.type === 'image');
  if (!ins.length) return c.print('No se ha designado ninguna referencia a bloque o imagen.');
  c.print(`${ins.length} referencia(s) designada(s).`);
  const k = await c.getKeyword('Indique opción de delimitación', ['ACtivar', 'DEsactivar', 'Suprimir', 'generar Polilínea', 'Nuevo contorno'], 'Nuevo contorno');
  const clipped = ins.filter(e => e.clip);
  if (k === 'ACtivar' || k === 'DEsactivar') { for (const e of clipped) c.doc.modify(e.id, x => { x.clip = { ...x.clip, off: k === 'DEsactivar' }; }); return c.print(`${clipped.length} delimitación(es) ${k === 'ACtivar' ? 'activada(s)' : 'desactivada(s)'}.`); }
  if (k === 'Suprimir') { for (const e of clipped) c.doc.modify(e.id, x => { delete x.clip; }); return c.print(`${clipped.length} delimitación(es) suprimida(s).`); }
  if (k === 'generar Polilínea') {
    for (const e of clipped) {
      const pts = e.type === 'image' ? e.clip.pts : e.clip.pts.map(q => Mx.ap(insertMatrix(e, c.doc.blocks[e.name]), q));
      c.add({ type: 'pline', pts, closed: true });
    }
    return c.print(`${clipped.length} polilínea(s) creada(s) con el contorno de delimitación.`);
  }
  let targets = ins;
  if (clipped.length && (await c.getKeyword('¿Desea suprimir el contorno anterior?', ['Sí', 'No'], 'Sí')) === 'No') targets = ins.filter(e => !e.clip);
  if (!targets.length) return;
  let invert = false, poly = null;
  while (!poly) {
    const m = await c.getKeyword(`Precise opción de delimitación${invert ? ' (invertida: se ocultará lo de dentro)' : ''}`, ['Seleccionar polilínea', 'Poligonal', 'Rectangular', 'Invertir delimitación'], 'Rectangular');
    if (m === 'Invertir delimitación') { invert = !invert; c.print(invert ? 'Delimitación invertida: se ocultará lo que quede dentro del contorno.' : 'Delimitación normal: se ocultará lo que quede fuera del contorno.'); continue; }
    if (m === 'Rectangular') {
      const a = await c.getPoint('Precise primera esquina');
      const b = await c.getPoint('Precise esquina opuesta', { base: a, rubber: false, preview: q => [{ type: 'pline', pts: rectClip(a, q), closed: true }] });
      if (Math.abs(b.x - a.x) < 1e-12 || Math.abs(b.y - a.y) < 1e-12) { c.print('Rectángulo nulo.'); continue; }
      poly = rectClip(a, b);
    } else if (m === 'Poligonal') {
      const pts = [await c.getPoint('Precise primer punto')];
      for (;;) {
        const p = await c.getPoint('Precise punto siguiente', { base: pts[pts.length - 1], allowEnter: true, options: pts.length >= 2 ? ['desHacer'] : [], preview: q => [{ type: 'pline', pts: [...pts, q], closed: true }] });
        if (p === null) break;
        if (p === 'desHacer') { if (pts.length > 1) pts.pop(); continue; }
        pts.push(p);
      }
      if (pts.length < 3) { c.print('Se necesitan al menos tres puntos.'); continue; }
      poly = pts;
    } else {
      const o = await c.getEntity('Designe polilínea cerrada', { filter: e => e.type === 'pline' && e.closed && e.pts.length > 2 });
      poly = plPolygon(o.e, 48);
    }
  }
  for (const e of targets) c.doc.modify(e.id, x => { x.clip = { pts: x.type === 'image' ? poly : toBlockCoords(c, x, poly), ...(invert ? { invert: true } : {}) }; });
  c.print(`${targets.length} referencia(s) delimitada(s)${invert ? ' (delimitación invertida)' : ''}.`);
}, { group: 'Bloques', sel: true });
def('XCLIPFRAME', ['MARCODELIMITAR', 'XCF'], 'Marco de las delimitaciones: 0 oculto, 1 visible e impreso, 2 visible sólo en pantalla', async c => {
  const v = await c.getNumber('Indique valor nuevo para XCLIPFRAME (0 oculto, 1 visible e impreso, 2 sólo en pantalla)', { def: c.settings.xclipFrame ?? 2, int: true, min: 0, max: 2 });
  c.settings.xclipFrame = v; c.doc.changed();
}, { group: 'Bloques' });

def('BEDIT', ['BE', 'EDITORBLOQUES', 'EDITARBLOQUE'], 'Abre el editor de bloques para modificar la definición de un bloque', async (c, arg) => {
  const app = c.app, doc = c.doc;
  if (doc.bedit) return c.print(`Ya está editando el bloque "${doc.bedit.name}". Ciérrelo con BCLOSE.`);
  const picked = (app.pickfirst || []).map(id => doc.get(id)).find(e => e?.type === 'insert');
  const name = arg || picked?.name || (Object.keys(doc.blocks).some(n => !n.startsWith('*')) ? await app.ui.pickBlock() : null);
  if (!name) return c.print('No hay bloques definidos. Cree uno con BLOQUE.');
  const b = doc.blocks[name];
  if (!b) return;
  if (b.xref) return c.print(`"${name}" es una referencia externa: no se puede editar como bloque. Ábrala como dibujo o únala con XREF.`);
  app.enterBedit(name);
}, { group: 'Bloques', sel: true });

def('BSAVE', ['BGUARDAR', 'GUARDARBLOQUE'], 'Guarda el bloque abierto en el editor de bloques', async c => {
  const doc = c.doc;
  if (!doc.bedit) return c.print('El editor de bloques no está abierto (BEDIT).');
  const ents = doc.beditContent();
  if (!ents.length) return c.print('El bloque no puede quedar vacío.');
  if (doc.refersTo(ents, doc.bedit.name)) return c.print('Un bloque no puede contenerse a sí mismo.');
  doc.saveBedit();
  c.print(`Bloque "${doc.bedit.name}" guardado (${ents.length} objeto(s)). Las referencias se han actualizado.`);
}, { group: 'Bloques' });

def('BCLOSE', ['BC', 'CERRARBLOQUE'], 'Cierra el editor de bloques', async c => {
  const doc = c.doc;
  if (!doc.bedit) return c.print('El editor de bloques no está abierto.');
  if (doc.beditChanged()) {
    const k = await c.getKeyword(`¿Guardar los cambios en el bloque "${doc.bedit.name}"?`, ['Sí', 'No'], 'Sí');
    if (k === 'Sí') {
      const ents = doc.beditContent();
      if (!ents.length) return c.print('El bloque no puede quedar vacío: deshaga los cambios o añada objetos.');
      if (doc.refersTo(ents, doc.bedit.name)) return c.print('Un bloque no puede contenerse a sí mismo.');
      doc.saveBedit();
    }
  }
  const name = doc.bedit.name;
  doc.closeBedit();
  c.app.syncBedit();
  c.print(`Editor de bloques cerrado ("${name}").`);
}, { group: 'Bloques' });

def('BASE', ['PUNTOBASE', 'INSBASE'], 'Punto base del bloque en edición, o punto de inserción del dibujo (para referencias externas)', async c => {
  const doc = c.doc, cur = doc.bedit ? doc.bedit.base : doc.settings.insBase;
  const p = await c.getPoint(`Precise punto base <${fmt(cur.x, 4)},${fmt(cur.y, 4)}>`, { allowEnter: true });
  if (!p) return;
  if (doc.bedit) { doc.bedit.base = { x: p.x, y: p.y }; doc.changed(); c.print('Punto base del bloque cambiado. Guarde el bloque para aplicarlo.'); }
  else { doc.settings.insBase = { x: p.x, y: p.y }; doc.dirty = true; c.print('Punto base del dibujo cambiado: se usará al insertarlo como referencia externa.'); }
}, { group: 'Bloques' });

// ---- Bloques dinámicos (dentro del editor de bloques) ----
const needBedit = c => { if (!c.doc.bedit) { c.print('Este comando sólo funciona dentro del editor de bloques (BEDIT).'); return false; } return true; };
const setDyn = (c, fn) => { const be = c.doc.bedit; be.dyn = fn(JSON.parse(JSON.stringify(be.dyn || {}))); c.doc.changed(); };
// Nombre de parámetro no repetido entre los de su tipo
const uniqueName = (list, name) => { let n = name, i = 2; while (list.some(x => x.name === n)) n = `${name}${i++}`; return n; };
def('BPARAMETER', ['BPARAM', 'PARAMETROB'], 'Añade un parámetro dinámico al bloque: estiramiento lineal, rotación, simetría o estados de visibilidad', async c => {
  if (!needBedit(c)) return;
  const k = await c.getKeyword('Indique tipo de parámetro', ['Lineal', 'Rotación', 'Simetría', 'Visibilidad'], 'Lineal');
  if (k === 'Rotación') {
    const d0 = c.doc.bedit.dyn;
    const name = uniqueName(rotsOf(d0), (await c.getString('Indique nombre del parámetro', { spaces: true, def: 'Ángulo' })).trim() || 'Ángulo');
    const cen = await c.getPoint('Precise punto base (centro de giro)');
    const p = await c.getPoint('Precise radio del parámetro (ubicación del pinzamiento en el ángulo base)', { base: cen });
    if (G.dist(cen, p) < 1e-9) return c.print('El radio no puede ser nulo.');
    const ids = await c.getSelection('Designe los objetos que giran', { noPickfirst: true });
    if (!ids.length) return c.print('No se ha designado ningún objeto.');
    setDyn(c, d => ({ ...d, rots: [...rotsOf(d), { name, c: cen, p, ents: ids }] }));
    return c.print(`Parámetro de rotación "${name}" (ángulo base ${deg(G.ang(cen, p))}) con ${ids.length} objeto(s). En las referencias, arrastre el pinzamiento cian para girarlos.`);
  }
  if (k === 'Lineal') {
    const name = uniqueName(linsOf(c.doc.bedit.dyn), (await c.getString('Indique nombre del parámetro', { spaces: true, def: 'Distancia' })).trim() || 'Distancia');
    const p1 = await c.getPoint('Precise punto inicial (fijo)');
    const p2 = await c.getPoint('Precise punto final (el que se arrastra)', { base: p1 });
    if (G.dist(p1, p2) < 1e-9) return c.print('Los puntos coinciden.');
    const a = await c.getPoint('Precise primera esquina de la ventana de estiramiento');
    const b = await c.getPoint('Precise esquina opuesta', { base: a, rubber: false, preview: q => [{ type: 'pline', pts: rectPts(a, q), closed: true }] });
    const rect = G.normRect(a, b);
    c.print('Designe los objetos que se estiran (INTRO: los que tocan la ventana).');
    let ids = await c.getSelection('Designe objetos', { noPickfirst: true });
    if (!ids.length) ids = c.doc.ents.filter(e => crosses(e, rect)).map(e => e.id);
    setDyn(c, d => { const lins = [...linsOf(d), { name, p1, p2, rect, ents: ids }]; delete d.lin; return { ...d, lins }; });
    c.print(`Parámetro lineal "${name}" (${fmt(G.dist(p1, p2), 4)}) con ${ids.length} objeto(s). En las referencias, arrastre el pinzamiento cian para cambiarlo.`);
  } else if (k === 'Simetría') {
    const a = await c.getPoint('Precise primer punto del eje de simetría');
    const b = await c.getPoint('Precise segundo punto del eje', { base: a });
    if (G.dist(a, b) < 1e-9) return c.print('Eje no válido.');
    setDyn(c, d => ({ ...d, flip: { a, b } }));
    c.print('Parámetro de simetría añadido. En las referencias, el pinzamiento cian invierte el bloque.');
  } else {
    const pos = await c.getPoint('Precise ubicación del pinzamiento de visibilidad');
    setDyn(c, d => ({ ...d, vis: { states: d.vis?.states?.length ? d.vis.states : ['Visibilidad1'], hide: d.vis?.hide || {}, pos } }));
    c.doc.bedit.visCur ||= 'Visibilidad1';
    c.print('Parámetro de visibilidad añadido. Cree estados con BVSTATE y oculte objetos en cada uno con BVHIDE.');
  }
}, { group: 'Bloques' });

def('BVSTATE', ['BVS', 'ESTADOVIS'], 'Crea, activa, renombra o elimina estados de visibilidad del bloque', async c => {
  if (!needBedit(c)) return;
  const be = c.doc.bedit;
  if (!be.dyn?.vis) return c.print('El bloque no tiene parámetro de visibilidad (BPARAMETER, Visibilidad).');
  const st = be.dyn.vis.states;
  c.print(`Estados: ${st.map(s => (s === be.visCur ? `[${s}]` : s)).join(', ')}`);
  const k = await c.getKeyword('Indique una opción', ['Nuevo', 'Establecer', 'Renombrar', 'eLiminar'], 'Nuevo');
  const ask = async (msg, def) => (await c.getString(msg, { spaces: true, def })).trim();
  if (k === 'Nuevo') {
    const name = await ask('Nombre del nuevo estado', `Visibilidad${st.length + 1}`);
    if (!name || st.includes(name)) return c.print('Nombre no válido o repetido.');
    const copy = await c.getKeyword('Objetos visibles', ['Mostrar todos', 'Copiar el actual'], 'Copiar el actual');
    setDyn(c, d => { d.vis.states.push(name); d.vis.hide[name] = copy === 'Mostrar todos' ? [] : [...(d.vis.hide[be.visCur] || [])]; return d; });
    be.visCur = name;
  } else if (k === 'Establecer') {
    const name = await ask('Estado que desea editar', be.visCur);
    if (!st.includes(name)) return c.print(`No existe el estado "${name}".`);
    be.visCur = name; c.doc.changed();
  } else if (k === 'Renombrar') {
    const name = await ask('Nuevo nombre del estado actual', be.visCur);
    if (!name || (name !== be.visCur && st.includes(name))) return c.print('Nombre no válido o repetido.');
    const old = be.visCur;
    setDyn(c, d => { d.vis.states = d.vis.states.map(s => (s === old ? name : s)); d.vis.hide[name] = d.vis.hide[old] || []; if (name !== old) delete d.vis.hide[old]; return d; });
    be.visCur = name;
  } else if (k === 'eLiminar') {
    if (st.length < 2) return c.print('Debe quedar al menos un estado.');
    const old = be.visCur;
    setDyn(c, d => { d.vis.states = d.vis.states.filter(s => s !== old); delete d.vis.hide[old]; return d; });
    be.visCur = c.doc.bedit.dyn.vis.states[0];
  }
  c.print(`Estado actual: "${be.visCur}".`);
}, { group: 'Bloques' });

async function visToggle(c, hide) {
  if (!needBedit(c)) return;
  const be = c.doc.bedit;
  if (!be.dyn?.vis) return c.print('El bloque no tiene parámetro de visibilidad (BPARAMETER, Visibilidad).');
  const ids = await c.getSelection(hide ? 'Designe objetos que se ocultan en este estado' : 'Designe objetos que se muestran en este estado');
  setDyn(c, d => { const set = new Set(d.vis.hide[be.visCur] || []); for (const id of ids) hide ? set.add(id) : set.delete(id); d.vis.hide[be.visCur] = [...set]; return d; });
  c.print(`${ids.length} objeto(s) ${hide ? 'ocultos' : 'visibles'} en el estado "${be.visCur}".`);
}
def('BVHIDE', ['BVH', 'OCULTARVIS'], 'Oculta objetos en el estado de visibilidad actual del bloque', c => visToggle(c, true), { group: 'Bloques', sel: true });
def('BVSHOW', ['BVSH', 'MOSTRARVIS'], 'Muestra objetos en el estado de visibilidad actual del bloque', c => visToggle(c, false), { group: 'Bloques', sel: true });

def('BLOOKUPTABLE', ['BLT', 'TABLACONSULTA'], 'Tabla de consulta del bloque dinámico: filas con nombre que fijan a la vez varios parámetros', async (c, arg) => {
  if (!needBedit(c)) return;
  const be = c.doc.bedit, d = be.dyn || {}, cols = [...lookupCols(d)];
  if (!cols.length) return c.print('El bloque no tiene parámetros: añada antes uno lineal, de rotación, de simetría o de visibilidad (BPARAMETER).');
  const pos = d.look?.pos || await c.getPoint('Precise ubicación del pinzamiento de consulta');
  const v = arg && typeof arg === 'object' ? arg : await c.app.ui.lookupTableEditor(d, cols);
  if (!v) return;
  const rows = (v.rows || []).filter(r => String(r.label ?? '').trim());
  if (!rows.length) { setDyn(c, x => { delete x.look; return x; }); return c.print('Tabla de consulta eliminada.'); }
  setDyn(c, x => ({ ...x, look: { name: (v.name || 'Consulta').trim(), pos, cols: v.cols || cols, rows } }));
  c.print(`Tabla de consulta con ${rows.length} fila(s) y ${(v.cols || cols).length} columna(s). En las referencias, el pinzamiento cian triangular pasa a la fila siguiente; la paleta de propiedades permite elegirla.`);
}, { group: 'Bloques' });

// ================= MODIFICAR =================
def('ERASE', ['E', 'BORRA', 'BORRAR'], 'Borra objetos', async c => {
  const ids = await c.getSelection();
  for (const id of ids) c.doc.remove(id);
  if (ids.length) c.print(`${ids.length} objeto(s) borrado(s).`);
}, { group: 'Modificar', sel: true });

def('MOVE', ['M', 'DESPLAZA'], 'Desplaza objetos', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const base = await c.getPoint('Precise punto base', { options: ['Desplazamiento'] });
  if (base === 'Desplazamiento') {
    const d = await c.getPoint('Precise desplazamiento (x,y)', { base: P(0, 0) });
    return applyX(c, ids, Mx.T(d.x, d.y));
  }
  const p2 = await c.getPoint('Precise segundo punto', { base, preview: p => ghost(c, ids, Mx.T(p.x - base.x, p.y - base.y)) });
  applyX(c, ids, Mx.T(p2.x - base.x, p2.y - base.y));
}, { group: 'Modificar', sel: true });

def('COPY', ['CO', 'CP', 'COPIA'], 'Copia objetos', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const base = await c.getPoint('Precise punto base');
  for (;;) {
    const p2 = await c.getPoint('Precise segundo punto', { base, allowEnter: true, preview: p => ghost(c, ids, Mx.T(p.x - base.x, p.y - base.y)) });
    if (!p2) break;
    applyX(c, ids, Mx.T(p2.x - base.x, p2.y - base.y), true);
  }
}, { group: 'Modificar', sel: true });

def('ROTATE', ['RO', 'GIRA'], 'Gira objetos alrededor de un punto base', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const base = await c.getPoint('Precise punto base');
  let copy = false, ref = 0;
  for (;;) {
    const a = await c.getAngle('Precise ángulo de rotación', { base, options: ['Copia', 'Referencia'], def: 0, preview: p => ghost(c, ids, Mx.R(G.ang(base, p) - ref, base)) });
    if (a === 'Copia') { copy = true; c.print('Girando una copia de los objetos seleccionados.'); continue; }
    if (a === 'Referencia') {
      ref = await c.getAngle('Precise ángulo de referencia', { def: 0 });
      const n = await c.getAngle('Precise nuevo ángulo', { base, preview: p => ghost(c, ids, Mx.R(G.ang(base, p) - ref, base)) });
      return applyX(c, ids, Mx.R(n - ref, base), copy);
    }
    return applyX(c, ids, Mx.R(a, base), copy);
  }
}, { group: 'Modificar', sel: true });

def('SCALE', ['SC', 'ESCALA'], 'Amplía o reduce objetos', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const base = await c.getPoint('Precise punto base');
  let copy = false;
  for (;;) {
    const f = await c.getDistance('Precise factor de escala', { base, options: ['Copia', 'Referencia'], def: 1, preview: p => { const k = G.dist(base, p); return k > 1e-9 ? ghost(c, ids, Mx.S(k, base)) : []; } });
    if (f === 'Copia') { copy = true; continue; }
    if (f === 'Referencia') {
      const r = await c.getDistance('Precise longitud de referencia', { def: 1 });
      const n = await c.getDistance('Precise nueva longitud', { base, preview: p => (r > 0 ? ghost(c, ids, Mx.S(G.dist(base, p) / r, base)) : []) });
      if (r > 0 && n > 0) applyX(c, ids, Mx.S(n / r, base), copy);
      return;
    }
    if (f > 0) applyX(c, ids, Mx.S(f, base), copy);
    return;
  }
}, { group: 'Modificar', sel: true });

def('MIRROR', ['MI', 'SIMETRIA'], 'Crea una copia simétrica de objetos', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const a = await c.getPoint('Precise primer punto de línea de simetría');
  const b = await c.getPoint('Precise segundo punto de línea de simetría', { base: a, preview: p => (G.dist(a, p) > 1e-9 ? ghost(c, ids, Mx.Mi(a, p)) : []) });
  if (G.dist(a, b) < 1e-12) return;
  const k = await c.getKeyword('¿Borrar objetos de origen?', ['Sí', 'No'], 'No');
  applyX(c, ids, Mx.Mi(a, b), k !== 'Sí');
}, { group: 'Modificar', sel: true });

def('OFFSET', ['O', 'DESFASE', 'EQDIST'], 'Crea objetos paralelos a una distancia', async c => {
  const S = c.settings;
  const r = await c.getDistance('Precise distancia de desfase', { options: ['Punto a atravesar'], def: S.offsetD });
  const through = r === 'Punto a atravesar';
  if (!through) { if (!(r > 0)) return; S.offsetD = r; }
  const compute = (e, p) => OPS.offsetEntity(e, through ? G.dist(p, OPS.nearestOn(e, p)) : S.offsetD, p);
  for (;;) {
    const o = await c.getEntity('Designe objeto a desplazar', { options: ['Salir'], allowEnter: true });
    if (!o || o === 'Salir') break;
    if (!['line', 'circle', 'arc', 'pline', 'spline'].includes(o.e.type)) { c.print('No se puede desfasar ese objeto.'); continue; }
    const p = await c.getPoint(through ? 'Precise punto a atravesar' : 'Precise punto en lado de desfase', { preview: q => { const n = compute(o.e, q); return n ? [n] : []; }, rubber: false });
    const n = compute(o.e, p);
    if (n) c.doc.add(n); else c.print('Distancia no válida para ese objeto.');
  }
}, { group: 'Modificar' });

async function trimExtend(c, extend) {
  const steps = [];
  for (;;) {
    const r = await c.getEntity(extend ? 'Designe objeto que desea alargar o mayús+designar para recortar' : 'Designe objeto que desea recortar o mayús+designar para alargar', { options: ['desHacer'], allowEnter: true });
    if (!r) break;
    if (r === 'desHacer') {
      if (steps.length) { c.doc.loadState(steps.pop()); c.doc.changed(); } else c.print('Nada que deshacer.');
      continue;
    }
    const others = c.doc.ents.filter(e => c.doc.visible(e));
    const doExtend = extend !== r.shift;
    const before = c.doc.state();
    if (doExtend) {
      const n = OPS.extendEntity(r.e, r.pt, others);
      if (!n) { c.print('El objeto no interseca ningún contorno.'); continue; }
      steps.push(before);
      c.doc.modify(r.e.id, e => Object.assign(e, n));
    } else {
      const res = OPS.trimEntity(r.e, r.pt, others);
      if (!res) { c.print('No se puede recortar este objeto.'); continue; }
      steps.push(before);
      c.doc.remove(r.e.id);
      for (const n of res.add) c.doc.add(n);
    }
  }
}
def('TRIM', ['TR', 'RECORTA'], 'Recorta objetos en las intersecciones (modo rápido)', c => trimExtend(c, false), { group: 'Modificar' });
def('EXTEND', ['EX', 'ALARGA'], 'Alarga objetos hasta el contorno más próximo', c => trimExtend(c, true), { group: 'Modificar' });

const isLine = e => e.type === 'line';
def('FILLET', ['F', 'EMPALME'], 'Redondea con un arco la esquina entre dos líneas o en una polilínea', async c => {
  const S = c.settings;
  for (;;) {
    const r = await c.getEntity(`Designe primera línea (radio = ${fmt(S.filletR, 4)})`, { options: ['Radio', 'Polilínea'], filter: isLine });
    if (r === 'Radio') {
      const v = await c.getDistance('Precise radio de empalme', { def: S.filletR });
      if (v >= 0) S.filletR = v;
      continue;
    }
    if (r === 'Polilínea') {
      const o = await c.getEntity('Designe polilínea 2D', { filter: e => e.type === 'pline' });
      if (!(S.filletR > 0)) return c.print('Defina primero un radio mayor que cero.');
      const res = OPS.filletPline(o.e, S.filletR);
      if (!res.count) return c.print('No se ha empalmado ningún vértice (tramos demasiado cortos o con arco).');
      setPoly(c, o.e.id, res.ent);
      return c.print(`${res.count} vértice(s) empalmado(s).`);
    }
    const r2 = await c.getEntity('Designe segunda línea', { filter: e => isLine(e) && e.id !== r.e.id });
    const res = OPS.filletLines(r.e, r.pt, r2.e, r2.pt, S.filletR);
    if (res.error) return c.print(res.error);
    c.doc.modify(r.e.id, e => { e.p1 = res.l1.p1; e.p2 = res.l1.p2; });
    c.doc.modify(r2.e.id, e => { e.p1 = res.l2.p1; e.p2 = res.l2.p2; });
    if (res.arc) c.doc.add(res.arc);
    return;
  }
}, { group: 'Modificar' });

def('CHAMFER', ['CHA', 'CHAFLAN'], 'Bisela la esquina entre dos líneas o en una polilínea', async c => {
  const S = c.settings;
  for (;;) {
    const r = await c.getEntity(`Designe primera línea (dist1 = ${fmt(S.chamferA, 4)}, dist2 = ${fmt(S.chamferB, 4)})`, { options: ['Distancia', 'Polilínea'], filter: isLine });
    if (r === 'Distancia') {
      const a = await c.getDistance('Precise primera distancia de chaflán', { def: S.chamferA });
      const b = await c.getDistance('Precise segunda distancia de chaflán', { def: a });
      if (a >= 0 && b >= 0) { S.chamferA = a; S.chamferB = b; }
      continue;
    }
    if (r === 'Polilínea') {
      const o = await c.getEntity('Designe polilínea 2D', { filter: e => e.type === 'pline' });
      const res = OPS.chamferPline(o.e, S.chamferA, S.chamferB);
      if (!res.count) return c.print('No se ha achaflanado ningún vértice.');
      setPoly(c, o.e.id, res.ent);
      return c.print(`${res.count} vértice(s) achaflanado(s).`);
    }
    const r2 = await c.getEntity('Designe segunda línea', { filter: e => isLine(e) && e.id !== r.e.id });
    const res = OPS.chamferLines(r.e, r.pt, r2.e, r2.pt, S.chamferA, S.chamferB);
    if (res.error) return c.print(res.error);
    c.doc.modify(r.e.id, e => { e.p1 = res.l1.p1; e.p2 = res.l1.p2; });
    c.doc.modify(r2.e.id, e => { e.p1 = res.l2.p1; e.p2 = res.l2.p2; });
    if (res.seg) c.doc.add(res.seg);
    return;
  }
}, { group: 'Modificar' });

const breakable = e => ['line', 'arc', 'circle', 'pline', 'spline'].includes(e.type);
def('BREAK', ['BR', 'PARTE'], 'Parte un objeto eliminando el tramo entre dos puntos', async c => {
  const o = await c.getEntity('Designe objeto', { filter: breakable });
  let p1 = OPS.nearestOn(o.e, o.pt);
  let p2 = await c.getPoint('Precise segundo punto de ruptura', { options: ['Primer punto'] });
  if (p2 === 'Primer punto') {
    p1 = await c.getPoint('Precise primer punto de ruptura');
    p2 = await c.getPoint('Precise segundo punto de ruptura', { base: p1 });
  }
  const res = OPS.breakEntity(o.e, p1, p2);
  if (!res) return c.print('No se puede partir el objeto por esos puntos.');
  c.doc.remove(o.e.id);
  res.add.forEach(n => c.doc.add(n));
}, { group: 'Modificar' });

def('BREAKATPOINT', ['BRP', 'PARTEENPUNTO'], 'Parte un objeto en dos en un punto', async c => {
  const o = await c.getEntity('Designe objeto', { filter: breakable });
  const p = await c.getPoint('Precise punto de ruptura');
  const res = OPS.breakEntity(o.e, p, p);
  if (!res) return c.print('No se puede partir el objeto en ese punto.');
  c.doc.remove(o.e.id);
  res.add.forEach(n => c.doc.add(n));
  c.print(`Objeto partido en ${res.add.length} parte(s).`);
}, { group: 'Modificar' });

def('LENGTHEN', ['LEN', 'LONGITUD'], 'Cambia la longitud de líneas y arcos', async c => {
  const S = c.settings;
  let mode = S.lenMode || 'delta', val = S.lenVal ?? 10;
  const names = { delta: 'Incremento', percent: 'Porcentaje', total: 'Total', dynamic: 'Dinámica' };
  for (;;) {
    const r = await c.getEntity(`Designe un objeto para medirlo (modo actual: ${names[mode]})`, { options: ['Incremento', 'Porcentaje', 'Total', 'Dinámica'], allowEnter: true, filter: breakable });
    if (r === null) break;
    if (typeof r !== 'string') { c.print(`Longitud actual: ${fmt(OPS.lengthOf(r.e), 4)}`); continue; }
    if (r === 'Incremento') { mode = 'delta'; val = await c.getNumber('Indique incremento de longitud (negativo acorta)', { def: mode === S.lenMode ? val : 10 }); }
    else if (r === 'Porcentaje') { mode = 'percent'; val = await c.getNumber('Indique porcentaje de longitud', { def: 100, min: 1e-6 }); }
    else if (r === 'Total') { mode = 'total'; val = await c.getDistance('Precise longitud total', { def: 100 }); }
    else mode = 'dynamic';
    break;
  }
  S.lenMode = mode; S.lenVal = val;
  const steps = [];
  for (;;) {
    const o = await c.getEntity('Designe objeto para cambiarlo', { options: ['desHacer'], filter: e => e.type === 'line' || e.type === 'arc', allowEnter: true });
    if (!o) break;
    if (o === 'desHacer') { if (steps.length) { c.doc.loadState(steps.pop()); c.doc.changed(); } continue; }
    const e = o.e;
    let n;
    if (mode === 'dynamic') {
      const calc = p => {
        if (e.type === 'line') {
          const atEnd = G.dist(o.pt, e.p2) <= G.dist(o.pt, e.p1), fixed = atEnd ? e.p1 : e.p2;
          return OPS.lengthenEntity(e, o.pt, 'total', G.dot(G.sub(p, fixed), G.norm(G.sub(atEnd ? e.p2 : e.p1, fixed))));
        }
        const atEnd = G.dist(o.pt, G.polar(e.c, e.a2, e.r)) <= G.dist(o.pt, G.polar(e.c, e.a1, e.r)), a = G.ang(e.c, p);
        return OPS.lengthenEntity(e, o.pt, 'total', e.r * (atEnd ? G.sweep(e.a1, a) : G.sweep(a, e.a2)));
      };
      const p = await c.getPoint('Precise nuevo punto final', { preview: q => { const x = calc(q); return x ? [x] : []; }, rubber: false });
      n = calc(p);
    } else n = OPS.lengthenEntity(e, o.pt, mode, val);
    if (!n) { c.print('La longitud resultante no es válida.'); continue; }
    steps.push(c.doc.state());
    c.doc.modify(e.id, x => Object.assign(x, n));
  }
}, { group: 'Modificar' });

def('STRETCH', ['S', 'ESTIRA'], 'Estira objetos designados con ventana de captura', async c => {
  c.print('Designe objetos con una ventana de captura (de derecha a izquierda).');
  const ids = await c.getSelection('Designe objetos a estirar', { noPickfirst: true });
  const W = c.app.lastWindow;
  if (!ids.length) return;
  const base = await c.getPoint('Precise punto base');
  const calc = p => {
    const d = G.sub(p, base);
    return ids.map(id => { const e = c.doc.get(id); return W ? OPS.stretchEntity(e, W.rect, d) : xformEnt(cloneEnt(e), Mx.T(d.x, d.y)); }).filter(Boolean);
  };
  const p2 = await c.getPoint('Precise segundo punto', { base, preview: calc });
  for (const n of calc(p2)) c.doc.modify(n.id, e => Object.assign(e, n));
}, { group: 'Modificar' });

// ---- Matrices asociativas (arrays.js) ----
// Las entidades designadas pasan a ser el origen de una matriz; con ASOciativa = No, al salir se descompone en objetos sueltos
function makeArray(c, ids, kind, params) {
  const src = ids.map(id => c.doc.get(id)).filter(Boolean).map(e => { const x = cloneEnt(e); for (const k of ['id', 'assoc', 'seed', '_xf', 'pathId']) delete x[k]; return x; });
  for (const id of ids) c.doc.remove(id);
  return c.add({ type: 'array', kind, src, base: srcCenter(src), M: Mx.I(), ...params });
}
const ARR_KW = {
  rect: ['ASOciativa', 'Base', 'Recuento', 'Separación', 'COLumnas', 'Filas', 'Ángulo de filas', 'Niveles', 'Origen', 'ReemplaZar', 'sAlir'],
  polar: ['ASOciativa', 'Base', 'Elementos', 'ángulo eNtre', 'reLlenar ángulo', 'Girar elementos', 'sAlir'],
  path: ['ASOciativa', 'Método', 'Base', 'Elementos', 'aLinear elementos', 'sAlir'],
};
const arrSummary = e => (e.kind === 'rect' ? `${e.cols} columna(s) × ${e.rows} fila(s)${rectLevels(e) > 1 ? ` × ${rectLevels(e)} nivel(es)` : ''}, separación ${fmt(e.dx, 4)} × ${fmt(e.dy, 4)}${e.ra ? `, filas a ${fmt(G.deg(e.ra), 2)}°` : ''}`
  : e.kind === 'polar' ? `${e.n} elementos en ${fmt(G.deg(e.fill), 2)}°${e.rot === false ? ', sin girar' : ''}`
    : `${itemCount(e)} elementos, ${e.method === 'divide' ? 'repartidos en el recorrido' : `separación ${fmt(e.sp, 4)}`}${e.align === false ? ', sin alinear' : ''}`);
// Clona objetos para el origen de una matriz (sin identificador ni datos de asociatividad) y los transforma a sus coordenadas locales
const arraySrcOf = (doc, ids, M, skip) => ids.filter(x => x !== skip).map(x => doc.get(x)).filter(Boolean).map(x => {
  const c = xformEnt(cloneEnt(x), M);
  for (const k of ['id', 'assoc', 'seed', '_xf', 'pathId']) delete c[k];
  return c;
});
async function arrayEditLoop(c, id, editing) {
  const doc = c.doc;
  let assoc = c.settings.arrayAssoc !== false;
  for (;;) {
    const e = doc.get(id);
    if (!e) return;
    const kw = ARR_KW[e.kind].filter(k => !(editing && k === 'ASOciativa'));
    const r = await c.app.ask('keyword', `Matriz ${ARRAY_KINDS[e.kind].toLowerCase()}: ${arrSummary(e)}. Seleccione una opción para editarla${editing ? '' : ` (asociativa: ${assoc ? 'sí' : 'no'})`}`, { options: kw, allowEnter: true });
    if (r === null || r === 'sAlir') break;
    const set = fn => doc.modify(id, fn);
    const loc = p => toLocal(doc.get(id), p);
    switch (r) {
      case 'ASOciativa': assoc = (await c.getKeyword('¿Crear una matriz asociativa?', ['Sí', 'No'], assoc ? 'Sí' : 'No')) === 'Sí'; c.settings.arrayAssoc = assoc; break;
      case 'Base': { const p = await c.getPoint('Precise punto base'); set(x => { x.base = loc(p); }); break; }
      case 'Recuento': {
        const cols = await c.getNumber('Indique número de columnas', { def: e.cols, int: true, min: 1, max: 1000 });
        const rows = await c.getNumber('Indique número de filas', { def: e.rows, int: true, min: 1, max: 1000 });
        set(x => { x.cols = cols; x.rows = rows; }); break;
      }
      case 'Separación': {
        const dx = await c.getDistance('Precise distancia entre columnas', { def: e.dx });
        const dy = await c.getDistance('Precise distancia entre filas', { def: e.dy });
        set(x => { if (dx) x.dx = dx; if (dy) x.dy = dy; }); break;
      }
      case 'COLumnas': {
        const n = await c.getNumber('Indique número de columnas', { def: e.cols, int: true, min: 1, max: 1000 });
        const d = await c.getDistance('Precise distancia entre columnas', { def: e.dx });
        set(x => { x.cols = n; if (d) x.dx = d; }); break;
      }
      case 'Filas': {
        const n = await c.getNumber('Indique número de filas', { def: e.rows, int: true, min: 1, max: 1000 });
        const d = await c.getDistance('Precise distancia entre filas', { def: e.dy });
        set(x => { x.rows = n; if (d) x.dy = d; }); break;
      }
      case 'Ángulo de filas': {
        const a = await c.getNumber('Precise ángulo de las filas (+ = antihorario, 0 = perpendiculares a las columnas)', { def: +fmt(G.deg(e.ra || 0), 4) });
        set(x => { x.ra = G.rad(a); }); break;
      }
      case 'Niveles': {
        const n = await c.getNumber('Indique número de niveles', { def: rectLevels(e), int: true, min: 1, max: 1000 });
        const dz = await c.getNumber('Indique separación entre niveles', { def: e.dz || 0 });
        set(x => { x.lv = n; x.dz = dz; }); break;
      }
      case 'Origen': {
        const ids = await c.getSelection('Designe los objetos que serán el origen de la matriz (Intro para conservarlos)', { noPickfirst: true });
        if (!ids.length) break;
        const src = arraySrcOf(doc, ids, arrayInv(doc.get(id)), id);
        if (!src.length) { c.print('No se puede usar la propia matriz como origen.'); break; }
        doc.modify(id, x => { x.src = src; x.repl = {}; });
        for (const x of ids) if (x !== id) doc.remove(x);
        c.print(`Origen de la matriz reemplazado por ${src.length} objeto(s).`);
        break;
      }
      case 'ReemplaZar': {
        const p = await c.getPoint('Designe el elemento de la matriz que desea reemplazar');
        const Ls = itemMatrices(e), M = arrayM(e);
        let k = 0, bd = Infinity;
        Ls.forEach((L, i) => { const d = G.dist(p, Mx.ap(Mx.mul(M, L), e.base)); if (d < bd) { bd = d; k = i; } });
        const ids = await c.getSelection(`Designe los objetos que sustituirán al elemento ${k + 1} (Intro para cancelar)`, { noPickfirst: true });
        if (!ids.length) break;
        const repl = arraySrcOf(doc, ids, invertM(itemWorld(doc.get(id), k)), id);
        if (!repl.length) { c.print('No se puede usar la propia matriz como reemplazo.'); break; }
        doc.modify(id, x => { x.repl = { ...(x.repl || {}), [k]: repl }; });
        for (const x of ids) if (x !== id) doc.remove(x);
        c.print(`Elemento ${k + 1} reemplazado por ${repl.length} objeto(s).`);
        break;
      }
      case 'Elementos':
        if (e.kind === 'path' && e.method !== 'divide') {
          const sp = await c.getDistance('Precise distancia entre elementos a lo largo del recorrido', { def: e.sp });
          if (sp > 0) set(x => { x.sp = sp; });
          const max = pathFit(doc.get(id));
          const n = await c.getNumber(`Indique número de elementos (máximo ${max})`, { def: max, int: true, min: 1, max });
          set(x => { x.n = n; });
        } else {
          const n = await c.getNumber('Indique número de elementos', { def: e.n, int: true, min: 1, max: 10000 });
          set(x => { x.n = n; });
        }
        break;
      case 'ángulo eNtre': {
        const a = await c.getNumber('Precise ángulo entre elementos (+ = antihorario)', { def: +fmt(G.deg(e.fill / Math.max(1, Math.abs(Math.abs(e.fill) - G.TAU) < 1e-9 ? e.n : e.n - 1)), 4) });
        if (a) set(x => { x.fill = G.rad(Math.max(-360, Math.min(360, a * Math.max(1, x.n - 1)))); });
        break;
      }
      case 'reLlenar ángulo': { const a = await c.getNumber('Precise ángulo a rellenar (+ = antihorario)', { def: +fmt(G.deg(e.fill), 4) }); if (a) set(x => { x.fill = G.rad(Math.max(-360, Math.min(360, a))); }); break; }
      case 'Girar elementos': { const k = await c.getKeyword('¿Girar los elementos de la matriz?', ['Sí', 'No'], e.rot === false ? 'No' : 'Sí'); set(x => { x.rot = k === 'Sí'; }); break; }
      case 'aLinear elementos': { const k = await c.getKeyword('¿Alinear los elementos con el recorrido?', ['Sí', 'No'], e.align === false ? 'No' : 'Sí'); set(x => { x.align = k === 'Sí'; }); break; }
      case 'Método': {
        const k = await c.getKeyword('Indique método de recorrido', ['Dividir', 'Medir'], e.method === 'divide' ? 'Dividir' : 'Medir');
        set(x => { x.method = k === 'Dividir' ? 'divide' : 'measure'; if (x.method === 'measure') x.n = Math.min(x.n, pathFit(x)); });
        break;
      }
    }
  }
  if (!editing && !assoc) { // matriz no asociativa: objetos sueltos
    const e = doc.get(id), parts = OPS.explodeEntity(e);
    doc.remove(id); parts.forEach(p => doc.add(p));
    c.print(`${parts.length} objeto(s) creado(s) (matriz no asociativa).`);
  }
}
def('ARRAYRECT', ['AR', 'MATRIZ', 'MATRIZRECT', 'ARRAY'], 'Matriz rectangular de objetos (asociativa y editable)', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const b = c.doc.extents(ids.map(id => c.doc.get(id)));
  const e = makeArray(c, ids, 'rect', { rows: 3, cols: 4, dx: +((b.x2 - b.x1) * 1.5 || 10).toFixed(4), dy: +((b.y2 - b.y1) * 1.5 || 10).toFixed(4) });
  await arrayEditLoop(c, e.id, false);
}, { group: 'Modificar', sel: true });
def('ARRAYPOLAR', ['ARP', 'MATRIZPOLAR'], 'Matriz polar de objetos alrededor de un centro (asociativa y editable)', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const cen = await c.getPoint('Precise punto central de la matriz');
  const e = makeArray(c, ids, 'polar', { c: cen, n: 6, fill: G.TAU, rot: true });
  await arrayEditLoop(c, e.id, false);
}, { group: 'Modificar', sel: true });
def('ARRAYPATH', ['ARPA', 'MATRIZRECORRIDO', 'MATRIZCAMINO'], 'Matriz de objetos a lo largo de un recorrido (línea, arco, polilínea, spline…), asociada a él', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const o = await c.getEntity('Designe curva de recorrido', { filter: e => pathable(e) && !ids.includes(e.id) });
  const pt = OPS.pathOf(o.e);
  if (!pt || !(pt.len > 1e-9)) return c.print('El recorrido no tiene longitud.');
  const b = c.doc.extents(ids.map(id => c.doc.get(id))), sp = +(Math.max(b.x2 - b.x1, b.y2 - b.y1) * 1.5 || pt.len / 5).toFixed(4);
  const e = makeArray(c, ids, 'path', { path: localPath({ M: Mx.I() }, o.e), pathId: o.e.id, method: 'measure', sp, n: 1, align: true });
  c.doc.modify(e.id, x => { x.n = pathFit(x); });
  await arrayEditLoop(c, e.id, false);
}, { group: 'Modificar', sel: true });
def('ARRAYEDIT', ['ARRAYEDIT', 'EDITARMATRIZ', 'MATRIZEDIT'], 'Edita una matriz asociativa: recuento, separaciones, ángulos, método y alineación', async c => {
  const o = await c.getEntity('Designe matriz', { filter: e => e.type === 'array' });
  await arrayEditLoop(c, o.e.id, true);
}, { group: 'Modificar' });

def('EXPLODE', ['X', 'DESCOMP'], 'Descompone polilíneas, cotas, bloques y sombreados', async c => {
  const ids = await c.getSelection();
  let n = 0;
  let xr = 0;
  for (const id of ids) {
    const src = c.doc.get(id);
    if (src.type === 'insert' && c.doc.blocks[src.name]?.xref) { xr++; continue; }
    const parts = OPS.explodeEntity(src);
    if (!parts) continue;
    c.doc.remove(id); parts.forEach(p => c.doc.add(p)); n++;
  }
  c.print(n ? `${n} objeto(s) descompuesto(s).` : 'Ningún objeto se puede descomponer.');
  if (xr) c.print(`${xr} referencia(s) externa(s) no se pueden descomponer (únalas antes con XREF).`);
}, { group: 'Modificar', sel: true });

def('JOIN', ['J', 'JUNTA', 'UNIR'], 'Une líneas, arcos y polilíneas con extremos coincidentes', async c => {
  const ids = await c.getSelection();
  const res = OPS.joinEntities(ids.map(id => c.doc.get(id)).filter(Boolean));
  for (const r of res) { r.ids.forEach(id => c.doc.remove(id)); c.doc.add(r.ent); }
  c.print(res.length ? `${res.reduce((a, r) => a + r.ids.length, 0)} objetos unidos en ${res.length} polilínea(s).` : 'No hay objetos que unir.');
}, { group: 'Modificar', sel: true });

def('MATCHPROP', ['MA', 'IGUALARPROP'], 'Copia las propiedades de un objeto a otros', async c => {
  const o = await c.getEntity('Designe objeto de origen');
  const { layer, color, ltype, lw } = o.e;
  c.print(`Propiedades: capa "${layer}", color ${color}, tipo de línea ${ltype}`);
  const ids = await c.getSelection('Designe objetos de destino', { noPickfirst: true });
  for (const id of ids) c.doc.modify(id, e => {
    Object.assign(e, { layer, color, ltype, lw });
    if (e.type === o.e.type && ['text', 'mtext', 'attdef', 'dim', 'mleader', 'table'].includes(e.type) && o.e.style) e.style = o.e.style;
    if (e.type === 'mline' && o.e.type === 'mline') Object.assign(e, { mlstyle: o.e.mlstyle, scale: o.e.scale, just: o.e.just });
    if (e.type === 'hatch' && o.e.type === 'hatch') {
      Object.assign(e, { pattern: o.e.pattern, scale: o.e.scale, angle: o.e.angle });
      if (o.e.grad) e.grad = { ...o.e.grad }; else delete e.grad;
      if (o.e.user) e.user = { ...o.e.user }; else delete e.user;
    }
  });
}, { group: 'Propiedades' });

// ================= GRUPOS =================
const groupLabel = g => (isAnonGroup(g.name) ? `sin nombre (${g.name})` : `"${g.name}"`);
function listGroups(c) {
  const doc = c.doc;
  if (!doc.groups.length) return c.print('No hay grupos en el dibujo.');
  for (const g of doc.groups) c.print(`  ${g.name}${g.desc ? ` — ${g.desc}` : ''}: ${g.ids.length} objeto(s)${g.sel ? '' : ', no seleccionable'}`);
}
// Selección previa (pickfirst) o designación con opciones. Devuelve una lista de identificadores o la opción elegida
async function selectOr(c, prompt, options) {
  const app = c.app;
  if (app.pickfirst) { const ids = app.pickfirst.filter(id => c.doc.get(id)); app.pickfirst = null; c.print(`${ids.length} encontrados`); return ids; }
  return app.ask('select', prompt, { options });
}
async function askGroupName(c, prompt, def) {
  for (;;) {
    const s = (await c.getString(`${prompt} o [?]`, { spaces: true, ...(def ? { def } : {}) })).trim();
    if (s === '?') { listGroups(c); continue; }
    return s;
  }
}
def('GROUP', ['G', 'GRUPO', 'AGRUPAR'], 'Crea un grupo (con o sin nombre) con los objetos designados; se designan juntos', async c => {
  const doc = c.doc;
  let name = null, desc = '', ids;
  for (;;) {
    const r = await selectOr(c, `Designe objetos para el grupo ${name ? `"${name}"` : 'sin nombre'}`, ['Nombre', 'Descripción']);
    if (r === 'Nombre') {
      const s = await askGroupName(c, 'Indique un nombre de grupo');
      if (!s) { name = null; continue; }
      if (!validGroupName(s)) { c.print('Nombre de grupo no válido (no puede empezar por * ni contener < > / \\ " : ; ? * | = ` ,).'); continue; }
      const old = findGroup(doc, s);
      if (old && (await c.getKeyword(`El grupo "${old.name}" ya existe. ¿Desea reemplazarlo?`, ['Sí', 'No'], 'No')) !== 'Sí') continue;
      name = s;
      continue;
    }
    if (r === 'Descripción') { desc = (await c.getString('Indique descripción del grupo', { spaces: true, def: desc })).trim(); continue; }
    ids = r.filter(id => doc.get(id));
    break;
  }
  if (!ids.length) return c.print('No se ha designado ningún objeto.');
  if (name && findGroup(doc, name)) removeGroup(doc, findGroup(doc, name));
  const g = makeGroup(doc, name, ids, desc);
  c.print(`Grupo ${groupLabel(g)} creado con ${g.ids.length} objeto(s).`);
}, { group: 'Grupos', sel: true });

def('UNGROUP', ['UNG', 'DESAGRUPAR'], 'Elimina los grupos de los objetos designados (los objetos se conservan)', async c => {
  const doc = c.doc;
  if (!doc.groups.length) return c.print('No hay grupos en el dibujo.');
  let targets;
  for (;;) {
    const r = await selectOr(c, 'Designe grupo', ['Nombre']);
    if (r === 'Nombre') {
      const g = findGroup(doc, await askGroupName(c, 'Indique nombre del grupo'));
      if (!g) { c.print('No existe ese grupo.'); continue; }
      targets = [g];
    } else targets = doc.groups.filter(g => g.ids.some(id => r.includes(id)));
    break;
  }
  if (!targets.length) return c.print('Los objetos designados no pertenecen a ningún grupo.');
  for (const g of targets) removeGroup(doc, g);
  c.print(`${targets.length === 1 ? `Grupo ${groupLabel(targets[0])} desagrupado` : `${targets.length} grupos desagrupados`}.`);
}, { group: 'Grupos', sel: true });

async function editGroup(c, g) {
  const doc = c.doc, app = c.app;
  const k = await c.getKeyword(`Grupo ${groupLabel(g)} (${g.ids.length} objetos). Indique una opción`, ['Añadir objetos', 'Eliminar objetos', 'Renombrar'], 'Añadir objetos');
  if (k === 'Renombrar') {
    const s = (await c.getString('Indique el nuevo nombre del grupo', { spaces: true, def: isAnonGroup(g.name) ? '' : g.name })).trim();
    if (!validGroupName(s) || (findGroup(doc, s) && findGroup(doc, s) !== g)) return c.print('Nombre no válido o ya usado por otro grupo.');
    g.name = s; doc.changed();
    return c.print(`Grupo renombrado: "${s}".`);
  }
  let ids;
  if (k === 'Eliminar objetos') {
    app.noGroupPick = true; // para quitar miembros sueltos hay que designarlos de uno en uno
    try { ids = await app.ask('select', 'Designe los objetos que desea quitar del grupo'); } finally { app.noGroupPick = false; }
    const set = new Set(ids), n = g.ids.length;
    g.ids = g.ids.filter(id => !set.has(id));
    if (!g.ids.length) { removeGroup(doc, g); return c.print('El grupo se ha quedado vacío y se ha eliminado.'); }
    c.print(`${n - g.ids.length} objeto(s) quitado(s) del grupo; quedan ${g.ids.length}.`);
  } else {
    ids = await app.ask('select', 'Designe los objetos que desea añadir al grupo');
    const n = g.ids.length;
    g.ids = [...new Set([...g.ids, ...ids.filter(id => doc.get(id))])];
    c.print(`${g.ids.length - n} objeto(s) añadido(s); el grupo tiene ${g.ids.length}.`);
  }
  doc.changed();
}
def('GROUPEDIT', ['GE', 'EDITARGRUPO'], 'Añade o elimina objetos de un grupo, o lo renombra', async c => {
  const doc = c.doc, app = c.app;
  if (!doc.groups.length) return c.print('No hay grupos en el dibujo.');
  let g = null;
  while (!g) {
    const r = await app.ask('entity', 'Designe grupo', { options: ['Nombre'], filter: e => groupsOf(doc, e.id).length > 0 });
    if (r === 'Nombre') { g = findGroup(doc, await askGroupName(c, 'Indique nombre del grupo')); if (!g) c.print('No existe ese grupo.'); continue; }
    const all = groupsOf(doc, r.e.id);
    g = all[0];
    if (all.length > 1) c.print(`El objeto pertenece a ${all.length} grupos; se edita el más reciente, ${groupLabel(g)}.`);
  }
  app.sel = new Set(g.ids.filter(id => doc.get(id))); app.selChanged(); // el grupo se resalta mientras se edita
  try { await editGroup(c, g); } finally { app.sel.clear(); app.selChanged(); }
}, { group: 'Grupos' });

def('CLASSICGROUP', ['GRUPOS', 'ADMINGRUPOS'], 'Administrador de grupos: designar, renombrar, describir, hacer seleccionable o desagrupar', async c => {
  const doc = c.doc, app = c.app;
  for (;;) {
    if (!doc.groups.length) return c.print('No hay grupos en el dibujo. Cree uno con GROUP (G).');
    const r = await app.ui.groupManager();
    if (!r) return;
    const g = doc.groups.find(x => x.name === r.name);
    if (!g) continue;
    if (r.action === 'select') {
      const space = new Set(doc.ents.map(e => e.id));
      app.sel = new Set(g.ids.filter(id => space.has(id) && doc.visible(doc.get(id)) && !doc.locked(doc.get(id))));
      app.selChanged();
      return c.print(`${app.sel.size} objeto(s) del grupo ${groupLabel(g)} designados.`);
    }
    if (r.action === 'rename') {
      const v = await app.ui.prompt('Renombrar grupo', 'Nuevo nombre', isAnonGroup(g.name) ? '' : g.name);
      if (v === null) continue;
      if (!validGroupName(v) || (findGroup(doc, v) && findGroup(doc, v) !== g)) c.print('Nombre no válido o ya usado.'); else g.name = v;
    } else if (r.action === 'desc') { const v = await app.ui.prompt(`Descripción del grupo ${g.name}`, 'Descripción', g.desc || ''); if (v !== null) g.desc = v; }
    else if (r.action === 'selectable') g.sel = !g.sel;
    else if (r.action === 'delete') { removeGroup(doc, g); c.print(`Grupo ${groupLabel(g)} desagrupado.`); }
    doc.changed();
  }
}, { group: 'Grupos' });

// ================= CONSULTA =================
def('DIST', ['DI', 'DISTANCIA'], 'Mide la distancia y el ángulo entre dos puntos', async c => {
  const a = await c.getPoint('Precise primer punto');
  const b = await c.getPoint('Precise segundo punto', { base: a });
  c.print(`Distancia = ${fmt(G.dist(a, b), 4)},  Ángulo en plano XY = ${deg(G.ang(a, b))}`);
  c.print(`Incremento X = ${fmt(b.x - a.x, 4)},  Incremento Y = ${fmt(b.y - a.y, 4)}`);
}, { group: 'Utilidades' });

def('AREA', ['AA'], 'Calcula área y perímetro', async c => {
  const r = await c.getPoint('Precise primer punto de esquina', { options: ['Objeto'] });
  let area, per;
  if (r === 'Objeto') {
    const o = await c.getEntity('Designe objeto', { filter: e => ['circle', 'pline', 'ellipse', 'hatch', 'region'].includes(e.type) || (e.type === 'spline' && e.closed) });
    const e = o.e;
    if (e.type === 'region') { area = Math.abs(regionArea(e)); per = regionPerimeter(e); }
    else if (e.type === 'circle') { area = Math.PI * e.r ** 2; per = G.TAU * e.r; }
    else if (e.type === 'spline') { const pts = splinePts(e); area = Math.abs(G.polyArea(pts)); per = G.polyLen(pts, true); }
    else if (e.type === 'ellipse') { area = Math.PI * e.rx * e.ry; per = Math.PI * (3 * (e.rx + e.ry) - Math.sqrt((3 * e.rx + e.ry) * (e.rx + 3 * e.ry))); }
    else if (e.type === 'hatch') { area = hatchArea(e); per = e.loops.reduce((s, l) => s + G.polyLen(l, true), 0); }
    else { area = Math.abs(plArea(e)); per = plLength(e); }
  } else {
    const pts = [r];
    for (;;) {
      const p = await c.getPoint('Precise punto siguiente', { base: pts[pts.length - 1], allowEnter: true, preview: q => [{ type: 'pline', pts: [...pts, q], closed: true }] });
      if (!p) break;
      pts.push(p);
    }
    if (pts.length < 3) return c.print('Se necesitan al menos 3 puntos.');
    area = Math.abs(G.polyArea(pts)); per = G.polyLen(pts, true);
  }
  c.print(`Área = ${fmt(area, 4)},  Perímetro = ${fmt(per, 4)}`);
}, { group: 'Utilidades' });

def('ID', ['IDPUNTO'], 'Muestra las coordenadas de un punto', async c => {
  const p = await c.getPoint('Precise punto');
  c.print(`X = ${fmt(p.x, 4)}     Y = ${fmt(p.y, 4)}     Z = 0.0000`);
}, { group: 'Utilidades' });

def('LIST', ['LI', 'LS', 'LISTA'], 'Muestra la información de los objetos', async c => {
  const ids = await c.getSelection();
  for (const id of ids) describe(c.doc.get(id)).forEach(l => c.print(l));
  if (ids.length) c.app.ui.showHistory(true);
}, { group: 'Utilidades', sel: true });

def('PURGE', ['PU', 'LIMPIA'], 'Elimina bloques, capas y estilos no utilizados', async c => {
  const doc = c.doc;
  let nb = 0;
  for (let changed = true; changed;) {
    changed = false;
    for (const name of Object.keys(doc.blocks)) if (!doc.blocks[name].xref && !doc.blocks[name].xrefDep && !doc.blockInUse(name)) { delete doc.blocks[name]; nb++; changed = true; }
  }
  const withSrc = list => list.flatMap(e => (e.type === 'array' ? [e, ...withSrc(e.src)] : [e])); // también los objetos de origen de las matrices
  const all = withSrc([...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)]);
  const usedL = new Set(['0', doc.cur.layer, ...all.map(e => e.layer)]);
  const nl = doc.layers.length;
  doc.layers = doc.layers.filter(l => usedL.has(l.name));
  const usedD = new Set([doc.cur.dimStyle, ...all.filter(e => e.type === 'dim').map(e => e.style)]);
  const nd = doc.dimStyles.length;
  doc.dimStyles = doc.dimStyles.filter((s, i) => !i || usedD.has(s.name));
  const usedT = new Set(['Standard', doc.cur.textStyle, ...all.filter(e => ['text', 'mtext', 'attdef', 'mleader', 'table'].includes(e.type)).map(e => e.style), ...doc.dimStyles.map(s => s.textStyle)]);
  const nt = doc.textStyles.length;
  doc.textStyles = doc.textStyles.filter(s => usedT.has(s.name));
  const usedM = new Set([doc.cur.mleaderStyle, ...all.filter(e => e.type === 'mleader').map(e => e.mstyle)]), usedTb = new Set([doc.cur.tableStyle, ...all.filter(e => e.type === 'table').map(e => e.tstyle)]);
  const nm = doc.mleaderStyles.length + doc.tableStyles.length;
  doc.mleaderStyles = doc.mleaderStyles.filter((x, i) => !i || usedM.has(x.name));
  doc.tableStyles = doc.tableStyles.filter((x, i) => !i || usedTb.has(x.name));
  const usedP = new Set(all.filter(e => e.type === 'hatch').map(e => e.pattern)), np = Object.keys(doc.patterns).length;
  for (const k of Object.keys(doc.patterns)) if (!usedP.has(k) && doc.settings.hatchPat !== k) delete doc.patterns[k];
  const nml = doc.mlineStyles.length;
  doc.mlineStyles = doc.mlineStyles.filter((s, i) => !i || s.name === doc.cur.mlineStyle || mlineStyleRefs(doc, s.name));
  doc.changed();
  c.print(`Limpiado: ${nb} bloque(s), ${nl - doc.layers.length} capa(s), ${nt - doc.textStyles.length} estilo(s) de texto, ${nd - doc.dimStyles.length} estilo(s) de cota, ${nm - doc.mleaderStyles.length - doc.tableStyles.length} estilo(s) de directriz o tabla, ${nml - doc.mlineStyles.length} estilo(s) de línea múltiple, ${np - Object.keys(doc.patterns).length} patrón(es) de sombreado.`);
}, { group: 'Utilidades' });

// ================= VISTA =================
def('ZOOM', ['Z'], 'Amplía o reduce la vista', async (c, arg) => {
  const v = c.app.view;
  const r = arg || await c.getPoint('Precise esquina de ventana, indique un factor de escala', { options: ['Extensión', 'Ventana', 'Previo', 'Todo'], allowEnter: true, allowNumber: true, noSnap: true });
  if (r === null) return;
  if (r === 'Extensión' || r === 'Todo') return c.app.zoomExtents();
  if (r === 'Previo') { if (!v.prev()) c.print('No hay vista previa.'); c.app.renderer.invalidate(); return; }
  if (typeof r === 'number') { v.push(); v.zoomAt(r, { x: v.w / 2, y: v.h / 2 }); c.app.renderer.invalidate(); return; }
  const a = r === 'Ventana' ? await c.getPoint('Precise primera esquina', { noSnap: true }) : r;
  const b = await c.getPoint('Precise esquina opuesta', { noSnap: true, base: a, rubber: false, preview: p => [{ type: 'pline', pts: rectPts(a, p), closed: true }] });
  v.push(); v.fit(G.normRect(a, b), 0); c.app.renderer.invalidate();
}, { group: 'Vista', noTx: true });

def('PAN', ['P', 'ENCUADRE'], 'Desplaza la vista arrastrando', async c => {
  c.app.view.push();
  await c.app.ask('pan', 'Arrastre para encuadrar. Pulse ESC o INTRO para salir', { allowEnter: true });
}, { group: 'Vista', noTx: true });

def('REGEN', ['RE', 'REGENERAR'], 'Regenera el dibujo', async c => { c.app.renderer.invalidate(); }, { group: 'Vista', noTx: true });

def('ISODRAFT', ['ISO', 'ISOMETRICO'], 'Activa o desactiva el dibujo isométrico (F5 cambia de plano)', async c => { c.app.toggleIso(); }, { group: 'Vista', noTx: true });

// ================= PRESENTACIONES =================
def('LAYOUT', ['LO', 'PRESENTACION'], 'Crea, renombra, elimina o activa presentaciones', async (c, arg) => {
  const app = c.app, doc = c.doc;
  const k = arg || await c.getKeyword('Indique opción de presentación', ['Nueva', 'Renombrar', 'Eliminar', 'Establecer', '?'], 'Establecer');
  const pick = async (msg, def) => {
    const name = await c.getString(msg, { spaces: true, def });
    const i = doc.layouts.findIndex(l => l.name.toLowerCase() === name.trim().toLowerCase());
    if (i < 0) c.print(`No existe la presentación "${name}".`);
    return i;
  };
  const curName = app.tab === 'model' ? doc.layouts[0]?.name : doc.layouts[app.tab].name;
  switch (k) {
    case 'Nueva': {
      let n = doc.layouts.length + 1;
      while (doc.layouts.some(l => l.name === `Presentación${n}`)) n++;
      const name = (await c.getString('Indique nombre de la nueva presentación', { spaces: true, def: `Presentación${n}` })).trim();
      if (!name || doc.layouts.some(l => l.name === name)) return c.print('Nombre no válido o duplicado.');
      app.createLayout(name);
      break;
    }
    case 'Renombrar': {
      const i = await pick('Indique presentación que desea renombrar', curName);
      if (i < 0) return;
      const name = (await c.getString('Indique nuevo nombre', { spaces: true, def: doc.layouts[i].name })).trim();
      if (!name || doc.layouts.some((l, j) => j !== i && l.name === name)) return c.print('Nombre no válido o duplicado.');
      doc.layouts[i].name = name; doc.changed();
      break;
    }
    case 'Eliminar': {
      const i = await pick('Indique presentación que desea eliminar', curName);
      if (i < 0) return;
      app.deleteLayout(i);
      break;
    }
    case '?': c.print(`Presentaciones: ${doc.layouts.map(l => l.name).join(', ') || '(ninguna)'}`); break;
    default: {
      const name = await c.getString('Indique presentación que desea activar (o Modelo)', { spaces: true, def: curName || 'Modelo' });
      if (/^modelo$/i.test(name.trim())) return app.switchTab('model');
      const i = doc.layouts.findIndex(l => l.name.toLowerCase() === name.trim().toLowerCase());
      if (i < 0) return c.print(`No existe la presentación "${name}".`);
      app.switchTab(i);
    }
  }
}, { group: 'Presentación' });

def('MVIEW', ['MV', 'VMULT', 'VENTANAS'], 'Crea una ventana gráfica en la presentación', async c => {
  const app = c.app;
  if (app.tab === 'model') return c.print('MVIEW sólo está disponible en una presentación.');
  if (app.vpActive) app.pspace();
  const lay = c.doc.layout();
  const r = await c.getPoint('Precise esquina de la ventana gráfica', { options: ['Ajustar'] });
  let a, b;
  if (r === 'Ajustar') { a = P(10, 10); b = P(lay.w - 10, lay.h - 10); }
  else { a = r; b = await c.getPoint('Precise esquina opuesta', { base: a, rubber: false, preview: p => [{ type: 'pline', pts: rectPts(a, p), closed: true }] }); }
  const rc = G.normRect(a, b);
  if (rc.x2 - rc.x1 < 1 || rc.y2 - rc.y1 < 1) return c.print('Ventana demasiado pequeña.');
  const vp = app.addViewport(rc);
  c.print(`Ventana gráfica creada a escala ${vp.label}.`);
}, { group: 'Presentación' });

def('PAGESETUP', ['CONFIGPAG', 'PAGINA'], 'Tamaño de papel de la presentación actual', async c => {
  if (c.app.tab === 'model') return c.print('Active una presentación para configurar la página.');
  await c.app.ui.pageSetup(c.doc.layouts[c.app.tab]);
  c.app.zoomExtents();
}, { group: 'Presentación' });
def('MSPACE', ['MS', 'EM', 'ESPACIOM'], 'Trabaja en el modelo a través de una ventana gráfica', async c => { c.app.mspace(); }, { group: 'Presentación', noTx: true });
def('PSPACE', ['PS', 'EP', 'ESPACIOP'], 'Vuelve al espacio papel de la presentación', async c => { c.app.pspace(); }, { group: 'Presentación', noTx: true });

// Nombres de capa separados por comas, con comodines * y ?
const layerMatcher = list => {
  const res = list.split(',').map(t => t.trim()).filter(Boolean)
    .map(t => new RegExp('^' + t.replace(/[.+^$(){}|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));
  return name => res.some(r => r.test(name));
};
def('VPLAYER', ['VPL', 'CAPAVENTANA'], 'Inutiliza o reutiliza capas sólo en ventanas gráficas concretas', async c => {
  const app = c.app, doc = c.doc;
  if (app.tab === 'model') return c.print('VPLAYER sólo está disponible en una presentación.');
  const vports = () => doc.layouts[app.tab].ents.filter(e => e.type === 'vport');
  for (;;) {
    const k = await app.ask('keyword', 'Indique una opción', { options: ['?', 'Inutilizar', 'Reutilizar', 'Restablecer'], allowEnter: true });
    if (k === null) return;
    if (k === '?') {
      for (const vp of vports()) c.print(`Ventana ${vp.id}: ${vp.frozen?.length ? vp.frozen.join(', ') : 'sin capas inutilizadas'}`);
      continue;
    }
    let match = null;
    if (k !== 'Restablecer') {
      const names = await c.getString(`Indique nombres de capa a ${k === 'Inutilizar' ? 'inutilizar' : 'reutilizar'} (separados por comas, admite *)`, { spaces: true });
      match = layerMatcher(names);
      if (!doc.layers.some(l => match(l.name))) { c.print('Ninguna capa coincide.'); continue; }
    }
    const w = await c.getKeyword('Ventanas', ['Todas', 'Designar', 'Actual'], app.vpActive ? 'Actual' : 'Designar');
    let targets;
    if (w === 'Actual') {
      if (!app.vpActive) { c.print('No hay ninguna ventana activa (doble clic dentro de una para activarla).'); continue; }
      targets = [doc.get(app.vpActive)];
    } else if (w === 'Todas') targets = vports();
    else {
      if (app.vpActive) app.pspace();
      targets = (await app.ask('select', 'Designe ventanas gráficas')).map(id => doc.get(id)).filter(e => e?.type === 'vport');
    }
    for (const vp of targets) {
      doc.modify(vp.id, e => {
        const cur = new Set(e.frozen || []);
        if (k === 'Restablecer') cur.clear();
        for (const l of doc.layers) if (match?.(l.name)) { if (k === 'Inutilizar') cur.add(l.name); else cur.delete(l.name); }
        if (cur.size) e.frozen = [...cur]; else delete e.frozen;
      });
    }
    c.print(`${targets.length} ventana(s) actualizada(s).`);
  }
}, { group: 'Presentación' });

// ================= PARAMÉTRICO =================
const isLineLike = e => e.type === 'line' || e.type === 'pline';
const isCirc = e => e.type === 'circle' || e.type === 'arc';
async function pickLineRef(c, prompt) { const o = await c.getEntity(prompt, { filter: isLineLike }); return { ref: lineRefAt(o.e, o.pt), e: o.e }; }
async function pickCircRef(c, prompt) { const o = await c.getEntity(prompt, { filter: isCirc }); return { ref: { id: o.e.id }, e: o.e }; }
// Punto de un objeto: se designa el objeto cerca del punto (extremo, punto medio, centro o vértice más próximo)
async function pickPointRef(c, prompt, opts = {}) {
  const o = await c.getEntity(`${prompt} (designe el objeto cerca del punto)`, { ...opts, filter: constrainable });
  if (o === null || typeof o === 'string') return o;
  return nearestPointRef(o.e, o.pt);
}
const nextConsName = (doc, prefix) => { let i = 1; const used = new Set([...doc.constraints.map(k => k.name), ...doc.params.map(p => p.name)]); while (used.has(`${prefix}${i}`)) i++; return `${prefix}${i}`; };
// Añade la restricción y resuelve; si no tiene solución se descarta
function addConstraint(c, cons, keepId) {
  const doc = c.doc;
  cons.id = Math.max(0, ...doc.constraints.map(k => k.id)) + 1;
  doc.constraints.push(cons);
  const r = solve(doc, new Set(keepId != null ? [keepId] : []));
  if (!r.ok) {
    doc.constraints.pop();
    solve(doc);
    c.print('La restricción no se puede aplicar: entra en conflicto con otras o no tiene solución.');
    return false;
  }
  for (const id of r.changed) doc.touched.add(id);
  doc.changed();
  return true;
}

const GC_KW = { Horizontal: 'horizontal', Vertical: 'vertical', Perpendicular: 'perpendicular', paRalela: 'parallel', Tangente: 'tangent', Coincidente: 'coincident', cOncéntrica: 'concentric', Igual: 'equal', Fija: 'fix', coLineal: 'collinear' };
async function geomConstraint(c, type) {
  const doc = c.doc;
  if (!type) type = GC_KW[await c.getKeyword('Indique tipo de restricción', Object.keys(GC_KW), 'Horizontal')];
  let refs, keep;
  switch (type) {
    case 'horizontal': case 'vertical': {
      const r = await pickPointRef(c, 'Designe el primer punto o INTRO para designar una línea', { allowEnter: true });
      if (r === null) { const l = await pickLineRef(c, 'Designe línea'); refs = [l.ref]; keep = null; }
      else { const r2 = await pickPointRef(c, 'Designe el segundo punto'); refs = [r, r2]; keep = r.id; }
      break;
    }
    case 'parallel': case 'perpendicular': case 'collinear': {
      const a = await pickLineRef(c, 'Designe la primera línea'), b = await pickLineRef(c, 'Designe la segunda línea (es la que se ajusta)');
      refs = [a.ref, b.ref]; keep = a.e.id;
      break;
    }
    case 'coincident': {
      const a = await pickPointRef(c, 'Designe el primer punto');
      const b = await pickPointRef(c, 'Designe el segundo punto o [Objeto]', { options: ['Objeto'] });
      if (b === 'Objeto') { const o = await c.getEntity('Designe la línea, arco o círculo', { filter: e => isLineLike(e) || isCirc(e) }); refs = [a, isCirc(o.e) ? { id: o.e.id } : lineRefAt(o.e, o.pt)]; }
      else refs = [a, b];
      keep = a.id;
      break;
    }
    case 'concentric': { const a = await pickCircRef(c, 'Designe el primer círculo o arco'), b = await pickCircRef(c, 'Designe el segundo (se ajusta)'); refs = [a.ref, b.ref]; keep = a.e.id; break; }
    case 'equal': {
      const o = await c.getEntity('Designe la primera línea, arco o círculo', { filter: e => isLineLike(e) || isCirc(e) });
      const circ = isCirc(o.e), o2 = await c.getEntity('Designe el segundo objeto (se ajusta)', { filter: e => (circ ? isCirc(e) : isLineLike(e)) && e.id !== o.e.id });
      refs = circ ? [{ id: o.e.id }, { id: o2.e.id }] : [lineRefAt(o.e, o.pt), lineRefAt(o2.e, o2.pt)]; keep = o.e.id;
      break;
    }
    case 'tangent': {
      const o = await c.getEntity('Designe la primera línea, arco o círculo', { filter: e => isLineLike(e) || isCirc(e) });
      const b = await pickCircRef(c, 'Designe el arco o círculo (se ajusta)');
      if (isCirc(o.e)) {
        const k1 = o.e, k2 = b.e;
        return addConstraint(c, { type, refs: [{ id: k1.id }, b.ref], inner: G.dist(k1.c, k2.c) < Math.max(k1.r, k2.r) }, k1.id);
      }
      refs = [lineRefAt(o.e, o.pt), b.ref]; keep = o.e.id;
      break;
    }
    case 'fix': {
      const r = await pickPointRef(c, 'Designe el punto o [Objeto]', { options: ['Objeto'] });
      if (r === 'Objeto') { const o = await c.getEntity('Designe objeto', { filter: constrainable }); return addConstraint(c, { type, refs: [{ id: o.e.id }], vals: entVals(o.e) }, o.e.id) && c.print('Objeto fijado.'); }
      const g = refGeom(doc, r).pt;
      return addConstraint(c, { type, refs: [r], at: { x: g.x, y: g.y } }, r.id) && c.print('Punto fijado.');
    }
  }
  if (addConstraint(c, { type, refs }, keep)) c.print(`Restricción ${GEOM_NAMES[type].toLowerCase()} aplicada.`);
}
def('GEOMCONSTRAINT', ['GC', 'RESTRICCIONGEOM', 'RESTGEOM'], 'Restricción geométrica: horizontal, vertical, paralela, perpendicular, tangente, coincidente, concéntrica, igual, fija o colineal', c => geomConstraint(c), { group: 'Paramétrico' });
for (const [cmd, al, type] of [['GCHORIZONTAL', 'GCH', 'horizontal'], ['GCVERTICAL', 'GCV', 'vertical'], ['GCPARALLEL', 'GCPA', 'parallel'], ['GCPERPENDICULAR', 'GCPE', 'perpendicular'],
  ['GCCOINCIDENT', 'GCCO', 'coincident'], ['GCCONCENTRIC', 'GCCN', 'concentric'], ['GCEQUAL', 'GCE', 'equal'], ['GCFIX', 'GCF', 'fix'], ['GCTANGENT', 'GCT', 'tangent'], ['GCCOLLINEAR', 'GCCL', 'collinear']]) {
  def(cmd, [al], `Restricción geométrica ${GEOM_NAMES[type].toLowerCase()}`, c => geomConstraint(c, type), { group: 'Paramétrico' });
}

const DC_KW = { Lineal: 'lin', Horizontal: 'h', Vertical: 'v', Alineada: 'a', Radio: 'radius', 'Diámetro': 'diameter', aNgular: 'angle' };
async function dimConstraint(c, kind) {
  const doc = c.doc;
  if (!kind) kind = DC_KW[await c.getKeyword('Indique tipo de restricción de cota', Object.keys(DC_KW), 'Lineal')];
  const askValue = async (name, cur, unit = '') => {
    const s = (await c.getString(`Indique valor o expresión para ${name}`, { spaces: true, def: fmt(cur, 4).replace(/\.?0+$/, '') + unit })).trim().replace(/°$/, '');
    try { parseExpr(s); return s; } catch (err) { c.print(`Expresión no válida (${err.message}); se usa el valor actual.`); return String(+cur.toFixed(6)); }
  };
  const label = cons => `${cons.name}=${cons.expr}`;
  if (kind === 'radius' || kind === 'diameter') {
    const k = await pickCircRef(c, 'Designe arco o círculo');
    const cons = { type: kind, refs: [k.ref], name: nextConsName(doc, kind === 'radius' ? 'rad' : 'dia'), expr: '' };
    const p3 = await c.getPoint('Precise ubicación de la cota', { rubber: false, preview: q => { const t = { ...cons, ang: G.ang(k.e.c, q), off: G.dist(k.e.c, q) - k.e.r }; const v = consDim(doc, t, '…'); return v ? [{ ...v, style: doc.cur.dimStyle }] : []; } });
    Object.assign(cons, { ang: G.ang(k.e.c, p3), off: G.dist(k.e.c, p3) - k.e.r });
    cons.expr = await askValue(cons.name, kind === 'radius' ? k.e.r : 2 * k.e.r);
    if (addConstraint(c, cons, null)) c.print(`Restricción de cota ${label(cons)}.`);
    return;
  }
  if (kind === 'angle') {
    const a = await pickLineRef(c, 'Designe la primera línea'), b = await pickLineRef(c, 'Designe la segunda línea (se ajusta)');
    const la = refGeom(doc, a.ref).line, lb = refGeom(doc, b.ref).line, d1 = G.sub(la[1], la[0]), d2 = G.sub(lb[1], lb[0]);
    const ang = Math.atan2(G.cross(d1, d2), G.dot(d1, d2)), cons = { type: 'angle', refs: [a.ref, b.ref], name: nextConsName(doc, 'ang'), sgn: ang < 0 ? -1 : 1, expr: '' };
    const X = G.llInt(la[0], la[1], lb[0], lb[1]);
    if (!X) return c.print('Las líneas son paralelas.');
    const p3 = await c.getPoint('Precise ubicación del arco de cota', { rubber: false, preview: q => { const v = consDim(doc, { ...cons, off: G.dist(X.p, q) }, '…'); return v ? [{ ...v, style: doc.cur.dimStyle }] : []; } });
    cons.off = G.dist(X.p, p3);
    cons.expr = await askValue(cons.name, Math.abs(G.deg(ang)), '');
    if (addConstraint(c, cons, a.e.id)) c.print(`Restricción de cota ${label(cons)}°.`);
    return;
  }
  // Distancias: dos puntos (o INTRO para designar una línea o tramo)
  let r1 = await pickPointRef(c, 'Designe el primer punto de restricción o INTRO para designar una línea', { allowEnter: true }), r2;
  if (r1 === null) {
    const l = await pickLineRef(c, 'Designe línea');
    if (l.ref.seg != null) { const n = l.e.pts.length; r1 = { id: l.e.id, k: 'v', i: l.ref.seg }; r2 = { id: l.e.id, k: 'v', i: (l.ref.seg + 1) % n }; }
    else { r1 = { id: l.e.id, k: 'p1' }; r2 = { id: l.e.id, k: 'p2' }; }
  } else r2 = await pickPointRef(c, 'Designe el segundo punto de restricción');
  const a = refGeom(doc, r1).pt, b = refGeom(doc, r2).pt;
  const mk = (q, k) => {
    let orient = k;
    if (k === 'lin') orient = Math.abs(q.y - (a.y + b.y) / 2) * Math.abs(b.x - a.x) >= Math.abs(q.x - (a.x + b.x) / 2) * Math.abs(b.y - a.y) ? 'h' : 'v';
    const nn = orient === 'a' ? G.perp(G.norm(G.sub(b, a))) : orient === 'h' ? P(0, 1) : P(-1, 0);
    return { type: 'dist', refs: [r1, r2], orient, sgn: (orient === 'h' ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y)) || 1, off: G.dot(G.sub(q, G.mid(a, b)), nn) };
  };
  const p3 = await c.getPoint('Precise ubicación de la cota', { rubber: false, preview: q => { const v = consDim(doc, mk(q, kind), '…'); return v ? [{ ...v, style: doc.cur.dimStyle }] : []; } });
  const cons = { ...mk(p3, kind), name: nextConsName(doc, 'd') };
  const cur = cons.orient === 'h' ? Math.abs(b.x - a.x) : cons.orient === 'v' ? Math.abs(b.y - a.y) : G.dist(a, b);
  cons.expr = await askValue(cons.name, cur);
  if (addConstraint(c, cons, r1.id)) c.print(`Restricción de cota ${label(cons)}.`);
}
def('DIMCONSTRAINT', ['DCON', 'RESTRICCIONCOTA', 'RESTCOTA'], 'Restricción de cota: lineal, horizontal, vertical, alineada, radio, diámetro o angular (con nombre y expresión)', c => dimConstraint(c), { group: 'Paramétrico' });
for (const [cmd, al, kind, d] of [['DCLINEAR', 'DCL', 'lin', 'lineal'], ['DCHORIZONTAL', 'DCH', 'h', 'horizontal'], ['DCVERTICAL', 'DCV', 'v', 'vertical'], ['DCALIGNED', 'DCA', 'a', 'alineada'],
  ['DCRADIUS', 'DCR', 'radius', 'de radio'], ['DCDIAMETER', 'DCD', 'diameter', 'de diámetro'], ['DCANGULAR', 'DCAN', 'angle', 'angular']]) {
  def(cmd, [al], `Restricción de cota ${d}`, c => dimConstraint(c, kind), { group: 'Paramétrico' });
}

// ---- Restricciones automáticas ----
const AC_KW = { Coincidente: 'coincident', coLineal: 'collinear', paRalela: 'parallel', Perpendicular: 'perpendicular', Tangente: 'tangent', cOncéntrica: 'concentric', Horizontal: 'horizontal', Vertical: 'vertical', Igual: 'equal' };
def('AUTOCONSTRAIN', ['AUTORESTRICCION', 'AUTOREST', 'RESTAUTO'], 'Aplica automáticamente las restricciones geométricas que ya cumplen los objetos designados (coincidente, paralela, horizontal, tangente…)', async c => {
  const S = c.settings, doc = c.doc, app = c.app;
  const opts = () => ({ ...AUTO_DEFAULT, ...S.autoCons, off: [...(S.autoCons?.off || [])] });
  let ids;
  for (;;) {
    const o = opts(), offTxt = o.off.length ? `; sin ${o.off.map(t => AUTO_TYPES[t].toLowerCase()).join(', ')}` : '';
    const r = await selectOr(c, `Designe objetos (tolerancias: distancia ${fmt(o.tol, 4)}, ángulo ${fmt(o.angTol, 2)}°${offTxt})`, ['Parámetros']);
    if (r !== 'Parámetros') { ids = r; break; }
    const tol = await c.getDistance('Precise tolerancia de distancia', { def: o.tol });
    const angTol = await c.getNumber('Indique tolerancia de ángulo (grados)', { def: o.angTol, min: 0, max: 45 });
    const off = new Set(o.off);
    for (;;) {
      c.print(`Tipos: ${Object.entries(AC_KW).map(([k, t]) => `${k}${off.has(t) ? ' (no)' : ''}`).join(', ')}`);
      const k = await app.ask('keyword', 'Indique tipo que desea activar o desactivar, o INTRO para terminar', { options: Object.keys(AC_KW), allowEnter: true });
      if (k === null) break;
      const t = AC_KW[k];
      if (off.has(t)) off.delete(t); else off.add(t);
    }
    S.autoCons = { tol: tol > 0 ? tol : o.tol, angTol, off: [...off] };
  }
  ids = ids.filter(id => constrainable(doc.get(id)));
  if (!ids.length) return c.print('Ningún objeto designado se puede restringir (líneas, polilíneas, arcos, círculos y puntos).');
  const res = autoConstrain(doc, ids, opts());
  if (res.tooMany) return c.print('Demasiados objetos para restringir de una vez: designe una parte del dibujo (unas 300 líneas como máximo).');
  if (!res.cons.length) return c.print('No se ha encontrado ninguna restricción nueva: la geometría ya está restringida o no cumple ninguna relación dentro de las tolerancias.');
  let id = Math.max(0, ...doc.constraints.map(k => k.id));
  for (const k of res.cons) { k.id = ++id; doc.constraints.push(k); }
  const r = solve(doc);
  if (!r.ok) {
    doc.constraints.splice(doc.constraints.length - res.cons.length);
    solve(doc);
    return c.print('Las restricciones encontradas no se pueden cumplir a la vez: no se aplica ninguna.');
  }
  for (const x of r.changed) doc.touched.add(x);
  doc.changed();
  c.print(`${res.cons.length} restricción(es) aplicada(s): ${Object.entries(res.counts).map(([t, n]) => `${n} ${AUTO_TYPES[t].toLowerCase()}`).join(', ')}.`);
}, { group: 'Paramétrico', sel: true });

def('DELCONSTRAINT', ['DELCON', 'BORRARRESTRICCION'], 'Elimina las restricciones de los objetos designados', async c => {
  const ids = new Set(await c.getSelection('Designe objetos'));
  const n = c.doc.constraints.length;
  c.doc.constraints = c.doc.constraints.filter(k => !refIds(k).some(id => ids.has(id)));
  c.doc.changed();
  c.print(`${n - c.doc.constraints.length} restricción(es) eliminada(s).`);
}, { group: 'Paramétrico', sel: true });

def('PARAMETERS', ['PAR', 'PARAMETROS'], 'Administrador de parámetros: valores y expresiones de las restricciones de cota y parámetros de usuario', async c => {
  const v = await c.app.ui.parametersManager();
  if (!v) return;
  const doc = c.doc;
  for (const k of doc.constraints) if (k.name && v.cons[k.id]) { k.name = v.cons[k.id].name; k.expr = v.cons[k.id].expr; }
  doc.params = v.params;
  const r = solve(doc);
  for (const id of r.changed) doc.touched.add(id);
  doc.changed();
  const { errors } = evalParams(doc);
  if (errors.size) c.print(`Expresiones con errores: ${[...errors].map(([n, e]) => `${n} (${e})`).join(', ')}`);
  c.print(r.ok ? 'Parámetros aplicados.' : 'Los valores no se pueden cumplir con las restricciones actuales.');
}, { group: 'Paramétrico' });

def('CONSTRAINTBAR', ['CBAR', 'BARRARESTRICCIONES'], 'Muestra u oculta los símbolos y cotas de las restricciones', async c => {
  c.settings.showCons = c.settings.showCons === false;
  c.print(c.settings.showCons ? 'Restricciones visibles.' : 'Restricciones ocultas.');
  c.app.renderer.invalidate();
}, { group: 'Paramétrico', noTx: true });

// ================= EDICIÓN / ARCHIVO =================
def('UNDO', ['U', 'DESHACER'], 'Deshace la última operación', async c => { c.print(c.doc.undo() ? 'Deshacer: operación anulada.' : 'No hay nada que deshacer.'); c.app.clearSel(); c.app.afterUndo(); }, { noTx: true, group: 'Edición' });
def('REDO', ['REHACER'], 'Rehace la operación deshecha', async c => { c.print(c.doc.redo() ? 'Rehacer: operación restaurada.' : 'No hay nada que rehacer.'); c.app.clearSel(); c.app.afterUndo(); }, { noTx: true, group: 'Edición' });

function collectBlocks(doc, ents, out = {}) {
  for (const e of ents) {
    if (e.type === 'array') collectBlocks(doc, e.src, out);
    else if (e.type === 'insert' && doc.blocks[e.name] && !out[e.name]) { out[e.name] = doc.blocks[e.name]; collectBlocks(doc, doc.blocks[e.name].ents, out); }
  }
  return out;
}
def('COPYCLIP', ['COPIARPORTAPAPELES'], 'Copia los objetos al portapapeles', async c => {
  const ids = await c.getSelection();
  const ents = ids.map(id => cloneEnt(c.doc.get(id))), blocks = JSON.parse(JSON.stringify(collectBlocks(c.doc, ents)));
  const pats = Object.fromEntries([...ents, ...Object.values(blocks).flatMap(b => b.ents)].filter(e => e.type === 'hatch' && c.doc.patterns[e.pattern]).map(e => [e.pattern, c.doc.patterns[e.pattern]]));
  c.app.clipboard = { ents, blocks, groups: groupsWithin(c.doc, ids), patterns: pats };
  try { localStorage.setItem('trazocad.clip', JSON.stringify(c.app.clipboard)); } catch { /* sin almacenamiento */ }
  c.print(`${ids.length} objeto(s) copiado(s) al portapapeles.`);
}, { sel: true, noTx: true, group: 'Edición' });

def('PASTECLIP', ['PEGARPORTAPAPELES'], 'Pega objetos del portapapeles', async c => {
  let clip = c.app.clipboard;
  if (!clip?.ents?.length) { try { clip = JSON.parse(localStorage.getItem('trazocad.clip') || 'null'); } catch { clip = null; } }
  if (Array.isArray(clip)) clip = { ents: clip, blocks: {} };
  if (!clip?.ents?.length) return c.print('El portapapeles está vacío.');
  for (const [name, b] of Object.entries(clip.blocks || {})) if (!c.doc.blocks[name]) c.doc.defineBlock(name, b.base, b.ents);
  for (const [name, p] of Object.entries(clip.patterns || {})) c.doc.patterns[name] ??= p;
  let b = null;
  for (const e of clip.ents) { const bb = bboxOf(e); b = b ? { x1: Math.min(b.x1, bb.x1), y1: Math.min(b.y1, bb.y1) } : bb; }
  const base = P(b.x1, b.y1);
  const mv = p => clip.ents.map(e => xformEnt(cloneEnt(e), Mx.T(p.x - base.x, p.y - base.y)));
  const p = await c.getPoint('Precise punto de inserción', { preview: mv });
  const map = new Map(), made = [];
  for (const e of mv(p)) {
    const old = e.id;
    delete e.id;
    if (!c.doc.layers.some(l => l.name === e.layer)) e.layer = c.doc.cur.layer;
    c.doc.add(e); made.push(e);
    if (old != null) map.set(old, e.id);
  }
  remapAssoc(made, map);
  for (const g of clip.groups || []) if (g.ids.every(id => map.has(id))) c.doc.groups.push({ ...g, name: nextAnonGroup(c.doc), ids: g.ids.map(id => map.get(id)) });
}, { group: 'Edición' });

def('SELECTALL', ['TODO', 'SELTODO'], 'Selecciona todos los objetos', async c => { c.app.selectAll(); }, { noTx: true, group: 'Edición' });

def('LAYER', ['LA', 'CAPA'], 'Administra las capas', async c => { c.app.ui.showPalette('layers'); }, { noTx: true, group: 'Propiedades' });
// ---- Estados de capa ----
// Estados de un archivo .las: los que ya existen con el mismo nombre se sustituyen
function importLas(c, text, src = '') {
  const doc = c.doc, list = readLas(text, LTYPES);
  for (const s of list) { const old = findLayerState(doc, s.name); if (old) Object.assign(old, s); else doc.layerStates.push(s); }
  if (list.length) doc.changed();
  c.print(list.length ? `${list.length} estado(s) de capa importado(s)${src ? ` de ${src}` : ''}: ${list.map(s => s.name).join(', ')}.` : 'El archivo no contiene estados de capa.');
  return list;
}
async function exportLas(c, states) {
  if (!states.length) return c.print('No hay estados de capa que exportar.');
  const name = states.length === 1 ? states[0].name : c.doc.name;
  if (await c.app.io.writeFile(writeLas(c.doc, states), `${name}.las`, 'text/plain', '.las', 'Estados de capa', false)) c.print(`${states.length} estado(s) de capa exportado(s) a ${name}.las.`);
}
const lsSummary = (c, s, r) => c.print(`Estado de capa "${s.name}" restaurado: ${r.changed} capa(s) modificada(s)${r.missing ? `, ${r.missing} capa(s) del estado ya no existen` : ''}. Capa actual: "${c.doc.cur.layer}".`);
def('LAYERSTATE', ['LAS', 'ESTADOCAPAS', 'ESTADOSCAPA'], 'Administrador de estados de capa: guarda y restaura configuraciones de capas con nombre, e importa o exporta archivos .las', async (c, arg) => {
  const doc = c.doc;
  if (arg?.las != null) { importLas(c, arg.las, arg.src); return; }
  for (;;) {
    const r = await c.app.ui.layerStateManager();
    if (!r) return;
    const s = r.name ? findLayerState(doc, r.name) : null, ui = c.app.ui;
    if (['new', 'rename', 'desc'].includes(r.action)) {
      let n = 1;
      while (findLayerState(doc, `Estado${n}`)) n++;
      r.value = await (r.action === 'desc' ? ui.prompt(`Descripción de "${s?.name}"`, 'Descripción', s?.desc || '') : ui.prompt(r.action === 'new' ? 'Nuevo estado de capa' : 'Renombrar estado de capa', 'Nombre', r.action === 'new' ? `Estado${n}` : s?.name));
      if (r.value === null) continue;
      if (r.action === 'new' && findLayerState(doc, r.value) && !(await ui.confirm(`El estado "${r.value}" ya existe. ¿Desea sobrescribirlo?`, 'Sobrescribir'))) continue;
    }
    switch (r.action) {
      case 'new':
        if (!validStateName(r.value)) { c.print('Nombre de estado no válido.'); break; }
        saveLayerState(doc, r.value); c.print(`Estado de capa "${r.value}" guardado (${doc.layers.length} capas).`); break;
      case 'update': if (s) { saveLayerState(doc, s.name); c.print(`Estado de capa "${s.name}" actualizado con la configuración actual.`); } break;
      case 'restore': if (s) { lsSummary(c, s, restoreLayerState(doc, s, r.opts)); c.app.renderer.invalidate(); return; } break;
      case 'rename': if (s && validStateName(r.value) && !(findLayerState(doc, r.value) && findLayerState(doc, r.value) !== s)) renameLayerState(doc, s, r.value); else c.print('Nombre no válido o repetido.'); break;
      case 'desc': if (s) { s.desc = r.value; doc.changed(); } break;
      case 'delete': if (s) { deleteLayerState(doc, s); c.print(`Estado de capa "${s.name}" eliminado.`); } break;
      case 'import': { const f = await c.app.io.pickFile('Estados de capa', ['.las']); if (f) importLas(c, await c.app.io.readText(f.file), f.file.name); break; }
      case 'export': await exportLas(c, s ? [s] : doc.layerStates); break;
      case 'exportAll': await exportLas(c, doc.layerStates); break;
    }
  }
}, { group: 'Propiedades' });
def('-LAYERSTATE', ['-LAS', '-ESTADOCAPAS'], 'Estados de capa por la línea de comandos: guardar, restaurar, eliminar, renombrar o listar', async c => {
  const doc = c.doc;
  for (;;) {
    const k = await c.app.ask('keyword', 'Indique una opción', { options: ['?', 'Guardar', 'Restaurar', 'Eliminar', 'renOmbrar', 'Descripción', 'Importar', 'eXportar'], allowEnter: true });
    if (k === null) return;
    if (k === 'Importar') { const f = await c.app.io.pickFile('Estados de capa', ['.las']); if (f) importLas(c, await c.app.io.readText(f.file), f.file.name); continue; }
    if (k === 'eXportar') {
      const n = (await c.getString('Indique nombre del estado a exportar (* = todos)', { spaces: true, def: '*' })).trim();
      const st = n === '*' ? doc.layerStates : [findLayerState(doc, n)].filter(Boolean);
      if (!st.length) c.print(`No existe el estado de capa "${n}".`); else await exportLas(c, st);
      continue;
    }
    if (k === '?') { if (!doc.layerStates.length) c.print('No hay estados de capa guardados.'); for (const s of doc.layerStates) c.print(`  ${s.name}${s.desc ? ` — ${s.desc}` : ''} (${Object.keys(s.layers).length} capas, actual "${s.cur}")`); continue; }
    const name = (await c.getString(k === 'Guardar' ? 'Indique nombre del estado de capa' : 'Indique nombre del estado', { spaces: true })).trim();
    const s = findLayerState(doc, name);
    if (k === 'Guardar') {
      if (!validStateName(name)) { c.print('Nombre de estado no válido.'); continue; }
      if (s && (await c.getKeyword(`El estado "${s.name}" ya existe. ¿Desea sobrescribirlo?`, ['Sí', 'No'], 'No')) !== 'Sí') continue;
      saveLayerState(doc, name); c.print(`Estado de capa "${name}" guardado (${doc.layers.length} capas).`);
      continue;
    }
    if (!s) { c.print(`No existe el estado de capa "${name}".`); continue; }
    if (k === 'Restaurar') { lsSummary(c, s, restoreLayerState(doc, s, { props: LS_ALL, offMissing: !!c.settings.lsOffMissing })); c.app.renderer.invalidate(); }
    else if (k === 'Eliminar') { deleteLayerState(doc, s); c.print(`Estado de capa "${s.name}" eliminado.`); }
    else if (k === 'renOmbrar') {
      const n = (await c.getString('Indique el nuevo nombre', { spaces: true, def: s.name })).trim();
      if (!validStateName(n) || (findLayerState(doc, n) && findLayerState(doc, n) !== s)) c.print('Nombre no válido o repetido.'); else renameLayerState(doc, s, n);
    } else { s.desc = (await c.getString('Indique la descripción', { spaces: true, def: s.desc || '' })).trim(); doc.changed(); }
  }
}, { group: 'Propiedades' });
def('PROPERTIES', ['PR', 'CH', 'PROPIEDADES'], 'Paleta de propiedades', async c => { c.app.ui.showPalette('props'); }, { noTx: true, group: 'Propiedades' });
def('DSETTINGS', ['DS', 'OS', 'OSNAP', 'REFENT', 'PARAMSDIB'], 'Parámetros de dibujo (referencias, rejilla, polar, isométrico)', async c => { c.app.ui.openSettings(); }, { noTx: true, group: 'Utilidades' });
def('LTSCALE', ['LTS', 'ESCALATL'], 'Factor de escala global de tipos de línea', async c => {
  const v = await c.getNumber('Indique nuevo factor de escala de tipo de línea', { def: c.settings.ltscale });
  if (v > 0) { c.settings.ltscale = v; c.doc.changed(); }
}, { group: 'Propiedades' });
def('HELP', ['AYUDA', '?'], 'Muestra la ayuda', async c => { c.app.ui.openHelp(); }, { noTx: true, group: 'Archivo' });
def('NEW', ['NUEVO'], 'Nuevo dibujo', async c => { await c.app.io.newDoc(); }, { noTx: true, group: 'Archivo' });
def('OPEN', ['ABRIR'], 'Abre un dibujo (.tcad / .dxf)', async c => { await c.app.io.open(); }, { noTx: true, group: 'Archivo' });
def('QSAVE', ['SAVE', 'GUARDAR'], 'Guarda el dibujo', async c => { await c.app.io.save(false); }, { noTx: true, group: 'Archivo' });
def('SAVEAS', ['GUARDARCOMO'], 'Guarda el dibujo con otro nombre', async c => { await c.app.io.save(true); }, { noTx: true, group: 'Archivo' });
def('DXFOUT', ['EXPORTARDXF', 'DXF'], 'Exporta el dibujo a DXF (2007, con directrices múltiples y degradados; 2000; o R12)', async (c, arg) => {
  const v = arg || await c.app.ask('keyword', 'Versión de DXF', { options: ['2007', '2000', 'R12'], def: '2007' });
  await c.app.io.exportDXF(['2007', '2000', 'R12'].includes(v) ? v : '2007');
}, { noTx: true, group: 'Archivo' });
def('SVGOUT', ['EXPORTARSVG', 'SVG'], 'Exporta el modelo o la presentación a SVG', async c => { await c.app.io.exportSVG(); }, { noTx: true, group: 'Archivo' });
def('PNGOUT', ['EXPORTARPNG', 'PNG'], 'Exporta el modelo o la presentación a PNG', async c => { await c.app.io.exportPNG(); }, { noTx: true, group: 'Archivo' });
def('PDFOUT', ['PDF', 'EXPORTARPDF'], 'Exporta a PDF vectorial (la presentación a escala real, todas las presentaciones o el modelo)', async (c, arg) => {
  let which = arg || 'current';
  if (!arg && c.doc.layouts.length > 1) which = (await c.getKeyword('Presentaciones', ['Actual', 'Todas'], 'Actual')) === 'Todas' ? 'all' : 'current';
  await c.app.io.exportPDF(which);
}, { noTx: true, group: 'Archivo' });
def('PLOT', ['PRINT', 'IMPRIMIR', 'TRAZAR'], 'Imprime el modelo o la presentación (a escala en presentaciones)', async c => { await c.app.io.print(); }, { noTx: true, group: 'Archivo' });

// ================= INTERNOS =================
def('_GRIP', [], 'Edición por pinzamientos', async (c, g) => {
  // Vista previa de los objetos estirados y de las cotas y sombreados asociados a ellos
  const prev = p => {
    const moved = g.refs.map(({ id, i }) => { const e = cloneEnt(c.doc.get(id)); TYPES[e.type].moveGrip(e, i, p); return e; });
    return [...moved, ...c.doc.previewDeps(moved)];
  };
  const pt = await c.getPoint('** ESTIRAR ** Precise punto de estiramiento', { base: g.pt, hot: g.pt, gripCmd: true, preview: prev });
  for (const { id, i } of g.refs) c.doc.modify(id, e => TYPES[e.type].moveGrip(e, i, pt));
}, { hidden: true, keepSel: true });

