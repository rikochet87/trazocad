import { registerGeoprocess } from './geocommands.js';
import { registerGIS } from './giscommands.js';
import { CATALOG, resolveCRS } from './projections.js';
import { validateGeo, toGeographic, formatGeographic } from './geographic.js';
import { OSM, validateMap } from './basemap.js';
// Comandos estilo AutoCAD. Cada comando es una función asíncrona que pide datos con el contexto `c`.
import * as G from './geom.js';
import { ELEV_TYPES, TYPES, cloneEnt, xformEnt, setTwist, crosses, bboxOf, bbPts, describe, fmt, dimParts, plArea, plLength, plPieces, pieceAt, plPolygon, hatchArea, blockAttdefs, mlEff, fieldText, FIELD_PROPS, DATE_FORMATS, insertMatrix, LTYPES, primsOf, ellPts, imageClipLoops, DIM_VARS, dimStyleOf, DEFAULT_DIMSTYLE } from './entities.js';
import { entityLoop, chainLoops, booleanLoops, nestLoops, regionArea, regionPerimeter } from './region.js';
import { srcCenter, toLocal, itemCount, pathFit, localPath, pathable, ARRAY_KINDS, arrayInv, arrayM, invertM, itemWorld, itemMatrices, rectLevels } from './arrays.js';
import { rectClip } from './xclip.js';
import { mlineStyleRefs, MLEDIT_TOOLS, mlCross, mlTee, mlCorner, mlAddVertex, mlDelVertex, mlCutRange, nearestElem as mlNearestElem, sortedElems } from './mline.js';
import { readLas, writeLas } from './layerstates.js';
import { findBoundary, loopsOfEntity, applyIslands, islandAt, ISLAND_MODES } from './hatch.js';
import { rebuild as rebuildSpline, splinePts } from './spline.js';
import { angBase, remapDim, updateDim, updateCenter } from './assoc.js';
import { parseSource, defineXref, detachXref, bindXref, xrefNames, xrefRefs, cleanXrefName, rememberXref, recallXref, recalledFile, forgetXref } from './xref.js';
import { activeStb, stbNames } from './plotstyles.js';
import * as OPS from './ops.js';
import { GRADIENTS, GRAD_DEFAULT, USER_DEFAULT, PATTERNS, parsePat, patText } from './patterns.js';
import { solve, evalParams, parseExpr, nearestPointRef, lineRefAt, refGeom, consDim, constrainable, entVals, refIds, GEOM_NAMES, autoConstrain, AUTO_TYPES, AUTO_DEFAULT } from './constraints.js';
import { makeGroup, removeGroup, findGroup, groupsOf, copyGroups, validGroupName, isAnonGroup, groupsWithin, nextAnonGroup } from './groups.js';
import { saveLayerState, restoreLayerState, findLayerState, validStateName, renameLayerState, deleteLayerState, LS_ALL } from './layerstates.js';
import { linsOf, rotsOf, lookupCols } from './dynblock.js';
import { WORLD, ucsOf, wcsOf, isWorld, toUcs, setUcs, prevUcs, findUcs, saveUcs, deleteUcs, renameUcs, validUcsName, ucs3P, ucsFromObject } from './ucs.js';
import * as ORG from './origin.js';
import { toFrame, fromFrame } from './view.js';
import * as AN from './annoscale.js';
import * as SC from './scripting.js';
import { LIBRARY, libItem, libScale, ensureLibBlock, LIB_UNITS } from './library.js';
import { loadPalettes } from './toolpalettes.js';
import { findView, validViewName, captureView, saveView, deleteView, restoreView, splitTile, joinTiles, splitPaper, TILE_DIRS, findVportConfig } from './views.js';
import { candidates, qselect, findFilter, applyFilter, condText } from './select.js';
import { findText, replaceText } from './find.js';
import { overkill, audit, OK_DEFAULTS } from './cleanup.js';
import { layIso, layUniso, layMerge } from './layertools.js';
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
// Rectángulo de esquinas opuestas a y b alineado con los ejes de la vista v (girada o no)
const viewRectPts = (v, a, b) => {
  const r = v.rot || 0;
  if (!r) return rectPts(a, b);
  const [au, av] = toFrame(r, a.x, a.y), [bu, bv] = toFrame(r, b.x, b.y);
  return [[au, av], [bu, av], [bu, bv], [au, bv]].map(([u, w]) => P(...fromFrame(r, u, w)));
};
// Estiramiento con la ventana de captura de una vista girada: en los ejes de la vista
function stretchIn(e, W, d) {
  if (!W.rot) return OPS.stretchEntity(e, W.rect, d);
  const n = OPS.stretchEntity(xformEnt(cloneEnt(e), Mx.R(-W.rot)), W.rect, G.rot(d, -W.rot));
  return n && xformEnt(n, Mx.R(W.rot));
}
const deg = r => fmt(G.deg(G.normAng(r)), 2) + '°';
const setPoly = (c, id, src) => c.doc.modify(id, e => { e.pts = src.pts; e.closed = src.closed; if (src.bulges?.some(b => b)) e.bulges = src.bulges; else delete e.bulges; });
const sendToBack = (c, e) => { const arr = c.doc.ents, i = arr.indexOf(e); if (i > 0) c.doc.setOrder(arr, [e, ...arr.slice(0, i), ...arr.slice(i + 1)]); };

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
  return { type: 'pline', pts, bulges, closed: true, cloud: len };
}
const isCloud = e => e?.type === 'pline' && e.closed && (e.cloud != null ? e.cloud > 0 : (e.bulges?.length && e.bulges.every(b => Math.abs(Math.abs(b) - 1) < 1e-9)));
const cloudSeg = (e, p) => {
  let best = -1, bd = Infinity;
  plPieces(e).forEach((pc, i) => { const d = G.dist(p, G.nearPrim(p, pc.prim)); if (d < bd) { bd = d; best = i; } });
  return best;
};
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
def('REVCLOUDEDIT', ['EDITNUBE', 'NUBEEDIT', 'EDITARNUBE'], 'Añade o quita arcos de una nube de revisión, o la convierte en polilínea', async c => {
  const o = await c.getEntity('Designe una nube de revisión', { filter: isCloud });
  const e = o.e;
  const op = await c.getKeyword('Indique la operación', ['Añadir', 'Quitar', 'Convertir'], 'Añadir');
  if (op === 'Convertir') {
    c.doc.modify(e.id, x => { x.cloud = 0; });
    return c.print('Nube convertida en polilínea normal.');
  }
  const p = await c.getPoint(op === 'Añadir' ? 'Precise el arco donde añadir un vértice' : 'Precise el arco que desea quitar');
  const j = cloudSeg(e, p);
  if (j < 0) return c.print('No se ha encontrado un arco de la nube.');
  if (op === 'Añadir') {
    const pc = plPieces(e)[j], m = pieceAt(pc, 0.5), b = pc.bulge || 1, b2 = Math.tan(Math.atan(b) / 2);
    c.doc.modify(e.id, x => {
      const n = x.pts.length;
      if (j === n - 1) {
        x.pts.push(m); x.bulges = [...(x.bulges || []), b2]; x.bulges[n - 1] = b2;
      } else {
        x.pts.splice(j + 1, 0, m); x.bulges.splice(j + 1, 0, b2); x.bulges[j] = b2;
      }
      x.closed = true;
    });
    c.print('Arco añadido a la nube.');
  } else {
    if (e.pts.length <= 4) return c.print('La nube debe conservar al menos cuatro arcos.');
    c.doc.modify(e.id, x => {
      x.pts.splice(j, 1);
      if (x.bulges) x.bulges.splice(j, 1);
    });
    c.print('Arco quitado de la nube.');
  }
}, { group: 'Dibujo' });
def('WIPEOUTFRAME', ['MARCOCOBERTURA', 'WOF'], 'Marco de las coberturas: 0 oculto, 1 visible e impreso, 2 visible sólo en pantalla', async c => {
  const v = await c.getNumber('Indique valor nuevo para WIPEOUTFRAME (0 oculto, 1 visible e impreso, 2 sólo en pantalla)', { def: c.settings.wipeoutFrame ?? 2, int: true, min: 0, max: 2 });
  c.settings.wipeoutFrame = v; c.doc.changed();
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
  const dpi = imageFileDpi(new Uint8Array(await f.file.arrayBuffer()));
  const p = await c.getPoint('Precise punto de inserción de la imagen');
  const sc = await imageScale(c, dpi);
  c.add({ type: 'image', p, w: im.naturalWidth * sc, h: im.naturalHeight * sc, src, name: f.file.name, rot: 0, pxw: im.naturalWidth, pxh: im.naturalHeight });
  c.print(`Imagen "${f.file.name}" adjuntada (${im.naturalWidth} × ${im.naturalHeight} px, ${fmt(im.naturalWidth * sc, 4)} × ${fmt(im.naturalHeight * sc, 4)} unidades).`);
}, { group: 'Insertar' });
// Resolución guardada en el archivo (ppp), o 0 si no consta: PNG (pHYs), JPEG (JFIF y EXIF) y BMP
export function imageFileDpi(b) {
  const u32 = i => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    for (let i = 8; i + 12 <= b.length;) {
      const len = u32(i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (type === 'pHYs' && b[i + 16] === 1) return u32(i + 8) * 0.0254; // píxeles por metro
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
    return 0;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 4 < b.length && b[i] === 0xff;) {
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m === 0xe0 && String.fromCharCode(...b.slice(i + 4, i + 9)) === 'JFIF\0') {
        const unit = b[i + 11], x = (b[i + 12] << 8) | b[i + 13];
        if (unit === 1 && x > 1) return x;
        if (unit === 2 && x > 1) return x * 2.54;
      }
      if (m === 0xe1 && String.fromCharCode(...b.slice(i + 4, i + 8)) === 'Exif') { const d = exifDpi(b, i + 10); if (d) return d; }
      if (m === 0xda) break;
      i += 2 + len;
    }
    return 0;
  }
  if (b[0] === 0x42 && b[1] === 0x4d && b.length > 42) { const ppm = (b[38] | (b[39] << 8) | (b[40] << 16) | (b[41] << 24)) >>> 0; return ppm > 0 ? ppm * 0.0254 : 0; }
  return 0;
}
// XResolution (282) y ResolutionUnit (296) del IFD0 de un bloque EXIF que empieza en t
function exifDpi(b, t) {
  const le = b[t] === 0x49, r16 = i => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const r32 = i => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])) >>> 0;
  const ifd = t + r32(t + 4);
  if (ifd + 2 > b.length) return 0;
  let x = 0, unit = 2;
  for (let k = 0, n = r16(ifd); k < n; k++) {
    const e = ifd + 2 + k * 12, tag = r16(e);
    if (tag === 282) { const o = t + r32(e + 8), d = r32(o + 4); x = d ? r32(o) / d : 0; }
    if (tag === 296) unit = r16(e + 8);
  }
  return x > 1 ? (unit === 3 ? x * 2.54 : x) : 0;
}
// Escala en unidades del dibujo por píxel. Con resolución conocida, la propuesta es el tamaño real
// (unitsPerInch: unidades del dibujo por pulgada, 25,4 si se dibuja en milímetros)
async function imageScale(c, dpi) {
  const S = c.settings, upi = S.unitsPerInch || 25.4;
  if (dpi) c.print(`Resolución del archivo: ${fmt(dpi, 1)} ppp (tamaño real con ${fmt(upi, 4)} unidades por pulgada).`);
  const r = await c.getNumber('Indique escala de la imagen en unidades por píxel', { def: dpi ? upi / dpi : 1, min: 1e-12, options: ['Resolución', 'Píxeles por unidad'] });
  if (r === 'Píxeles por unidad') return 1 / (await c.getNumber('Indique píxeles por unidad del dibujo', { def: 1, min: 1e-12 }));
  if (r !== 'Resolución') return r;
  const d = await c.getNumber('Indique resolución de la imagen en puntos por pulgada (ppp)', { def: dpi || 96, min: 1e-6 });
  S.unitsPerInch = await c.getNumber('Indique unidades del dibujo por pulgada (25.4 en milímetros, 1 en pulgadas)', { def: upi, min: 1e-12 });
  return S.unitsPerInch / d;
}
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
    const info = grad ? `degradado ${GRADIENTS[g.type].toLowerCase()}, ${g.stops?.length > 2 ? `${g.stops.length} colores` : `${g.c1} → ${g.c2}`}, ${S.hatchAng}°`
      : S.hatchPat === 'USER' ? `definido por el usuario, separación ${fmt(u.sp, 4)}${u.dbl ? ', doble' : ''}, ${S.hatchAng}°` : `${S.hatchPat}, escala ${S.hatchScale}, ${S.hatchAng}°`;
    const opts = [...(grad ? ['Seleccionar objetos', 'Tipo', 'Colores', 'Ángulo', 'Centrado'] : ['Seleccionar objetos', 'Patrón', 'Usuario', 'Escala', 'Ángulo']), 'asOciativo', 'Detección de islas', 'Incluir islas', 'Quitar islas', 'desHacer'];
    const isl = ISLAND_MODES[S.hatchIslands || 'normal'].toLowerCase();
    const r = await c.getPoint(`Designe punto interno [${info}, ${S.hatchAssoc ? 'asociativo' : 'no asociativo'}, islas: ${isl}]`, { options: opts, allowEnter: true, noSnap: true });
    if (r === null) break;
    if (r === 'Detección de islas') {
      const k = await c.getKeyword('Indique estilo de detección de islas', ['Normal', 'Exterior', 'Ignorar'], ISLAND_MODES[S.hatchIslands || 'normal']);
      S.hatchIslands = Object.keys(ISLAND_MODES).find(x => ISLAND_MODES[x] === k) || 'normal';
      continue;
    }
    if (r === 'Incluir islas' || r === 'Quitar islas') {
      const h = made.length ? c.doc.get(made[made.length - 1]) : null;
      if (!h) { c.print('Cree primero un sombreado: las islas se añaden o quitan del último creado.'); continue; }
      if (r === 'Incluir islas') {
        const picked = (await c.getSelection('Designe objetos cerrados que serán islas', { noPickfirst: true })).filter(id => id !== h.id && loopsOfEntity(c.doc.get(id)));
        const ids = picked.filter(id => !h.assoc?.includes(id)); // los que ya forman parte del contorno no se repiten
        const add = ids.flatMap(id => loopsOfEntity(c.doc.get(id)));
        if (!add.length) { c.print(picked.length ? 'Los objetos designados ya forman parte del contorno del sombreado.' : 'Los objetos designados no son contornos cerrados.'); continue; }
        c.doc.modify(h.id, x => { x.loops = [...x.loops, ...add]; if (x.assoc) x.assoc = [...new Set([...x.assoc, ...ids])]; });
        c.print(`${add.length} isla(s) añadida(s) al sombreado.`);
      } else {
        for (;;) {
          const p = await c.getPoint('Designe un punto dentro de la isla que desea quitar', { allowEnter: true, noSnap: true });
          if (!p) break;
          const cur = c.doc.get(h.id), i = islandAt(cur.loops, p);
          if (i < 0) { c.print('El punto no está dentro de ninguna isla del sombreado.'); continue; }
          c.doc.modify(h.id, x => {
            x.loops = applyIslands(x.loops, 'normal', [p]);
            if (x.seed) x.rmIsl = [...(x.rmIsl || []), p]; // se recuerda para cuando cambie el contorno
            else delete x.assoc; // asociativo por objetos: la isla quitada ya no se podría reconstruir
          });
          c.print('Isla quitada.');
        }
      }
      continue;
    }
    if (r === 'Tipo') {
      const names = Object.values(GRADIENTS), k = await c.getString(`Tipo de degradado (${names.join(', ')})`, { spaces: true, def: GRADIENTS[g.type] });
      const t = Object.keys(GRADIENTS).find(x => GRADIENTS[x].toLowerCase() === k.trim().toLowerCase());
      if (t) S.gradient = { ...g, type: t }; else c.print('Tipo no válido.');
      continue;
    }
    if (r === 'Colores') { // dos colores y, si se quiere, colores intermedios en posiciones de 0 a 1
      const a = await c.app.ui.pickColor(g.c1), b = a ? await c.app.ui.pickColor(g.c2) : null;
      if (!a || !b) continue;
      const mids = [];
      while ((await c.getKeyword(`¿Añadir un color intermedio? (${mids.length + 2} colores)`, ['Sí', 'No'], 'No')) === 'Sí') {
        const m = await c.app.ui.pickColor('#ffffff');
        if (!m) break;
        mids.push([await c.getNumber('Indique posición del color (0 = primer color, 1 = último)', { def: 0.5, min: 0, max: 1 }), m]);
      }
      const ng = { ...g, c1: a, c2: b };
      if (mids.length) ng.stops = [[0, a], ...mids, [1, b]].sort((x, y) => x[0] - y[0]); else delete ng.stops;
      S.gradient = ng;
      continue;
    }
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
      loops = applyIslands(loops, S.hatchIslands);
      c.print(`Contorno encontrado${loops.length > 1 ? ` con ${loops.length - 1} isla(s)` : ''}.`);
      assoc = loops.ids; seed = r;
    }
    const user = !grad && S.hatchPat === 'USER';
    const e = c.add({ type: 'hatch', loops: [...loops], pattern: grad ? 'GRADIENT' : S.hatchPat, scale: user ? 1 : S.hatchScale, angle: S.hatchAng, ...(grad ? { grad: G0() } : {}), ...(user ? { user: { ...USER_DEFAULT, ...S.hatchUser } } : {}) });
    if (S.hatchAssoc && assoc?.length) { e.assoc = assoc; if (seed) e.seed = seed; }
    if (seed && S.hatchIslands && S.hatchIslands !== 'normal') e.islands = S.hatchIslands;
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
  const ann = c.doc.textStyle(c.doc.cur.textStyle)?.annotative; // estilo anotativo: la altura es la del papel
  const h = await c.getDistance(ann ? 'Precise altura del texto en el papel' : 'Precise altura', { base: p, def: S.textH });
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
  const o = wcsOf(c.doc).o, org = o.x || o.y ? { org: P(o.x, o.y) } : {}; // con origen local, las coordenadas reales
  const mk = q => ({ type: 'dim', kind: 'ord', p1: f, p2: f, p3: q, ...(axis ? { axis } : {}), ...org, text, style: c.doc.cur.dimStyle });
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
// DIMOVERRIDE: cambia variables de cota sólo en las cotas designadas (sin tocar su estilo) o borra esas modificaciones
def('DIMOVERRIDE', ['DOV', 'DIMOVER', 'MODIFCOTA', 'ANULARCOTA'], 'Modifica variables de cota (DIMTXT, DIMTOL, DIMTP…) sólo en las cotas designadas, o borra las modificaciones', async c => {
  const ov = {};
  let clear = false;
  for (;;) {
    const raw = (await c.getString(`Indique nombre de variable de cota que desea modificar o [Borrar modificaciones]${Object.keys(ov).length ? ' (Intro para designar cotas)' : ''}`, { def: '' })).trim().toUpperCase();
    if (!raw) break;
    if (/^B(ORRAR)?/.test(raw) && !DIM_VARS[raw]) { clear = true; break; }
    const v = DIM_VARS[raw];
    if (!v) { c.print(`Variable desconocida. Variables admitidas: ${Object.keys(DIM_VARS).join(', ')}.`); continue; }
    const [key, type] = v;
    if (type === 'flag') {
      const on = (await c.getNumber(`Indique valor nuevo para ${raw} (0 desactivada, 1 activada)`, { def: 1, int: true, min: 0, max: 1 })) === 1;
      ov[raw] = on; continue;
    }
    if (type === 'str') { ov[key] = (await c.getString(`Indique sufijo para ${raw} (texto tras la medida)`, { spaces: true, def: '' })).replace('<>', ''); continue; }
    const n = await c.getNumber(`Indique valor nuevo para ${raw}`, { ...(type === 'int' ? { int: true, min: 0, max: 8 } : {}) });
    ov[key] = n;
  }
  if (!clear && !Object.keys(ov).length) return;
  const ids = (await c.getSelection('Designe cotas')).filter(id => c.doc.get(id)?.type === 'dim');
  if (!ids.length) return c.print('No se ha designado ninguna cota.');
  for (const id of ids) c.doc.modify(id, e => {
    if (clear) { delete e.ov; return; }
    const st = dimStyleOf(e), nv = { ...e.ov };
    for (const [k, v] of Object.entries(ov)) if (k !== 'DIMTOL' && k !== 'DIMLIM') nv[k] = v;
    if ('DIMTOL' in ov || 'DIMLIM' in ov || 'tp' in ov || 'tm' in ov) { // DIMLIM manda sobre DIMTOL; con DIMTP = DIMTM la tolerancia es simétrica
      const cur = st.tol, lim = ov.DIMLIM ?? cur === 'lim', tol = ov.DIMTOL ?? (cur === 'sym' || cur === 'dev');
      const tp = nv.tp ?? st.tp, tm = nv.tm ?? st.tm;
      nv.tol = lim ? 'lim' : tol ? (Math.abs(tp - tm) < 1e-12 ? 'sym' : 'dev') : cur === 'basic' ? 'basic' : 'none';
    }
    const base = { ...DEFAULT_DIMSTYLE, ...c.doc.dimStyle(e.style) };
    for (const k of Object.keys(nv)) if (nv[k] === base[k]) delete nv[k];
    if (Object.keys(nv).length) e.ov = nv; else delete e.ov;
  });
  c.print(clear ? `Modificaciones borradas en ${ids.length} cota(s).` : `${ids.length} cota(s) modificada(s): ${Object.keys(ov).join(', ')}.`);
}, { group: 'Anotación', sel: true });

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
  const ann = c.doc.textStyle(c.doc.cur.textStyle)?.annotative; // estilo anotativo: la altura es la del papel
  const h = await c.getDistance(ann ? 'Precise altura del texto en el papel' : 'Precise altura', { base: p, def: S.textH });
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

def('INSERT', ['I', 'INSERTAR', 'DDINSERT'], 'Inserta una referencia a un bloque (también los de la biblioteca, por su nombre)', async (c, arg) => {
  if (arg && !c.doc.blocks[arg] && libItem(arg)) return placeInsert(c, arg, libOpts(c, arg));
  if (!Object.keys(c.doc.blocks).some(n => !n.startsWith('*') && !c.doc.blocks[n].xrefDep)) return c.print('No hay bloques definidos. Cree uno con BLOQUE o inserte uno de la biblioteca con ADCENTER o LIBINSERT.');
  const name = arg || await c.app.ui.pickBlock();
  if (!name || !c.doc.blocks[name]) return;
  await placeInsert(c, name);
}, { group: 'Bloques' });

// Pide punto de inserción, escala y rotación (y los atributos) y añade la referencia al bloque.
// o: valores iniciales (s, rot en radianes, layer, color, dyn) y at (punto: se inserta allí sin preguntar)
async function placeInsert(c, name, o = {}) {
  let s = o.s ?? 1, rot = o.rot ?? 0;
  const cur = c.doc.cur;
  const mk = p => ({ type: 'insert', name, p, sx: s, sy: s, rot, layer: o.layer ?? cur.layer, color: o.color ?? cur.color, ltype: cur.ltype, lw: cur.lw, ...(o.dyn ? { dyn: { ...o.dyn } } : {}) });
  if (o.at) { const ins = mk(o.at), defs = blockAttdefs(name); if (defs.length) ins.attribs = Object.fromEntries(defs.map(a => [a.tag, a.def || ''])); return c.add(ins); }
  for (;;) {
    const r = await c.getPoint(`Precise punto de inserción de "${name}"`, { options: ['Escala', 'Rotación'], preview: p => [mk(p)] });
    if (r === 'Escala') { const v = await c.getNumber('Indique factor de escala', { def: s }); if (v) s = v; continue; }
    if (r === 'Rotación') { rot = G.rad(await c.getNumber('Indique ángulo de rotación (grados)', { def: G.deg(rot) })); continue; }
    const ins = mk(r), defs = blockAttdefs(name);
    if (defs.length) {
      ins.attribs = {};
      for (const a of defs) if (!(a.tag in ins.attribs)) ins.attribs[a.tag] = await c.getString(a.prompt || `Indique valor de ${a.tag}`, { spaces: true, def: a.def || '' }); // una vez por etiqueta
    }
    return c.add(ins);
  }
}

// ---- Biblioteca de bloques viales (library.js) ----
// Opciones de inserción de un bloque de la biblioteca: lo define si falta y aplica el factor de unidades (LIBUNITS)
function libOpts(c, name, o = {}) {
  const it = libItem(name);
  if (ensureLibBlock(c.doc, name)) c.print(`Bloque "${name}" de la biblioteca añadido al dibujo${it.anno ? ' (anotativo: tamaño en el papel)' : ` (en metros, factor ${libScale(c.doc, it)} por LIBUNITS)`}.`);
  return { ...o, s: (o.s ?? 1) * libScale(c.doc, it) };
}
def('LIBINSERT', ['BIBLIOTECA', 'INSERTARBIBLIOTECA', '-BIBLIOTECA'], 'Inserta un bloque de la biblioteca de obras viales (señales, alcantarillas, defensas, cordones y cunetas)', async (c, arg) => {
  let name = arg;
  while (!name) {
    const t = (await c.getString('Indique nombre del bloque de la biblioteca o [?]', { spaces: true, def: '?' })).trim();
    if (t === '?') { for (const l of LIBRARY) c.print(`  ${l.name}: ${l.label} — ${l.desc}`); continue; }
    const it = LIBRARY.find(l => l.name.toUpperCase() === t.toUpperCase() || l.name.toUpperCase() === `TC_${t.toUpperCase()}`);
    if (!it) { c.print(`No hay ningún bloque "${t}" en la biblioteca.`); continue; }
    name = it.name;
  }
  if (!libItem(name)) return c.print(`No hay ningún bloque "${name}" en la biblioteca.`);
  await placeInsert(c, name, libOpts(c, name));
}, { group: 'Bloques' });
def('LIBUNITS', ['UNIDADESBIBLIOTECA'], 'Unidades del dibujo para los planos tipo de la biblioteca (definidos en metros): m, cm o mm', async (c, arg) => {
  const KW = { Metros: 'm', Centímetros: 'cm', Milímetros: 'mm' }, cur = Object.keys(KW).find(n => KW[n] === (c.settings.libUnits || 'm'));
  const r = arg || await c.getKeyword('Unidades del dibujo', Object.keys(KW), cur), k = KW[r] || r;
  if (!LIB_UNITS[k]) return;
  c.settings.libUnits = k; c.doc.changed();
  c.print(`Los planos tipo de la biblioteca se insertarán con factor ${LIB_UNITS[k]} (unidades: ${k}).`);
}, { group: 'Bloques', keepSel: true });
// Herramienta de una paleta que inserta un bloque (con sus propiedades); arg = {tool, at}
def('_TOOLBLOCK', [], 'Herramienta de bloque', async (c, { tool: t, at } = {}) => {
  if (!t) return;
  const doc = c.doc;
  if (t.layer) doc.ensureLayer(t.layer, '#ffffff');
  if (!doc.blocks[t.block] && !libItem(t.block)) return c.print(`El bloque "${t.block}" no está en el dibujo ni en la biblioteca.`);
  let o = { s: t.scale || 1, rot: G.rad(t.rot || 0), ...(t.layer ? { layer: t.layer } : {}), ...(t.color ? { color: t.color } : {}), ...(t.vis ? { dyn: { vis: t.vis } } : {}), at };
  if (libItem(t.block)) o = libOpts(c, t.block, o);
  c.print(`Herramienta: ${t.label}`);
  await placeInsert(c, t.block, o);
}, { group: 'Bloques', hidden: true });
def('TOOLPALETTES', ['PH', 'PALETAHERRAMIENTAS', 'HERRAMIENTAS'], 'Muestra la paleta de herramientas: bloques de la biblioteca, sombreados y órdenes con sus propiedades', async c => {
  c.app.ui.showPalette('tools');
  c.print(`Paleta de herramientas: ${loadPalettes().map(p => p.name).join(', ')}. Clic en una herramienta o arrástrela al dibujo.`);
}, { group: 'Herramientas', noTx: true, keepSel: true });
def('TOOLPALETTESCLOSE', ['CERRARPH'], 'Cierra la paleta de herramientas', async c => { c.app.ui.showPalette('props', false); c.app.ui.togglePalette(false); }, { group: 'Herramientas', noTx: true, keepSel: true });
def('ADCENTER', ['DC', 'ADC', 'DESIGNCENTER', 'CENTRODISEÑO'], 'DesignCenter: inserta bloques, capas y estilos de la biblioteca o de otros dibujos', async c => {
  for (;;) {
    const r = await c.app.ui.designCenter();
    if (!r) return;
    if (r.action === 'insert') {
      if (r.lib) return placeInsert(c, r.name, libOpts(c, r.name));
      const src = r.src;
      if (!c.doc.blocks[r.name]) importBlock(c.doc, src, r.name);
      else if (src !== c.doc && !(await c.app.ui.confirm(`El dibujo ya tiene un bloque "${r.name}". ¿Insertar el existente?`, 'Insertar'))) continue;
      return placeInsert(c, r.name);
    }
    if (r.action === 'add') { const n = importItems(c.doc, r.src, r.kind, r.names); c.print(`${n} elemento(s) añadido(s) al dibujo${n < r.names.length ? ` (${r.names.length - n} ya existían)` : ''}.`); }
  }
}, { group: 'Bloques' });
// Copia un bloque de otro dibujo (con los bloques que inserta, las capas y estilos que usa)
function importBlock(doc, src, name, seen = new Set()) {
  if (seen.has(name) || doc.blocks[name] || !src.blocks[name]) return;
  seen.add(name);
  const b = JSON.parse(JSON.stringify(src.blocks[name]));
  for (const e of b.ents) {
    if (e.type === 'insert') importBlock(doc, src, e.name, seen);
    if (e.layer && !doc.layers.some(l => l.name === e.layer)) { const l = src.layers.find(x => x.name === e.layer); if (l) doc.layers.push(JSON.parse(JSON.stringify(l))); }
    if (e.style && (e.type === 'text' || e.type === 'mtext' || e.type === 'attdef')) importItems(doc, src, 'textStyles', [e.style]);
  }
  const { base, ents, ...extra } = b;
  delete extra.name; delete extra.ver;
  doc.defineBlock(name, base, ents, extra);
}
// Copia capas o estilos (kind: layers, textStyles, dimStyles, mleaderStyles, tableStyles, mlineStyles) que no existan
function importItems(doc, src, kind, names) {
  if (kind === 'blocks') { let n = 0; for (const nm of names) if (!doc.blocks[nm]) { importBlock(doc, src, nm); n++; } return n; }
  let n = 0;
  for (const nm of names) {
    if (doc[kind].some(x => x.name === nm)) continue;
    const it = src[kind].find(x => x.name === nm);
    if (!it) continue;
    doc[kind].push(JSON.parse(JSON.stringify(it)));
    if (kind === 'dimStyles' || kind === 'mleaderStyles' || kind === 'tableStyles') if (it.textStyle) importItems(doc, src, 'textStyles', [it.textStyle]);
    n++;
  }
  doc.changed();
  return n;
}

// ---- Referencias externas ----
// Archivo de una referencia: el manejador de esta sesión, el recordado de otras (IndexedDB) o, si no, el selector
async function readXrefFile(c, name, hint) {
  const app = c.app, h = app.xrefHandles?.[name];
  let picked = null;
  if (h) { try { picked = { file: await h.getFile(), handle: h }; } catch { picked = null; } }
  if (!picked && hint) {
    const src = await recallXref(hint), f = await recalledFile(src, true);
    if (f && !(src instanceof Blob)) picked = { file: f, handle: src };
  }
  if (!picked) {
    if (hint) c.print(`Seleccione el archivo de la referencia "${name}" (${hint}).`);
    picked = await app.io.pickFile('Dibujos de referencia');
  }
  if (!picked) return null;
  (app.xrefHandles ||= {})[name] = picked.handle;
  await rememberXref(picked.file.name, picked.handle || picked.file);
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
    await rememberXref(picked.file.name, picked.handle || picked.file); // para recargarla al abrir el dibujo otro día
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
      const n = xrefRefs(doc, name), file = doc.blocks[name].xref.file;
      detachXref(doc, name);
      if (!xrefNames(doc).some(x => doc.blocks[x].xref.file === file)) await forgetXref(file);
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
  const clipped = ins.filter(e => e.clip), imgs = clipped.filter(e => e.type === 'image');
  const k = await c.getKeyword('Indique opción de delimitación', ['ACtivar', 'DEsactivar', 'Suprimir', 'generar Polilínea', 'Nuevo contorno', ...(imgs.length ? ['Añadir contorno'] : [])], 'Nuevo contorno');
  if (k === 'Añadir contorno') { // imágenes: contornos adicionales (huecos o zonas visibles separadas, par-impar)
    const { poly } = await clipPoly(c, false);
    for (const e of imgs) c.doc.modify(e.id, x => { x.clip = { ...x.clip, loops: [...(x.clip.loops || []), poly] }; });
    return c.print(`Contorno añadido a ${imgs.length} imagen(es): ${imageClipLoops(c.doc.get(imgs[0].id)).length} contornos.`);
  }
  if (k === 'ACtivar' || k === 'DEsactivar') { for (const e of clipped) c.doc.modify(e.id, x => { x.clip = { ...x.clip, off: k === 'DEsactivar' }; }); return c.print(`${clipped.length} delimitación(es) ${k === 'ACtivar' ? 'activada(s)' : 'desactivada(s)'}.`); }
  if (k === 'Suprimir') { for (const e of clipped) c.doc.modify(e.id, x => { delete x.clip; }); return c.print(`${clipped.length} delimitación(es) suprimida(s).`); }
  if (k === 'generar Polilínea') {
    let n = 0;
    for (const e of clipped) {
      for (const l of e.type === 'image' ? imageClipLoops(e) : [e.clip.pts.map(q => Mx.ap(insertMatrix(e, c.doc.blocks[e.name]), q))]) { c.add({ type: 'pline', pts: l, closed: true }); n++; }
    }
    return c.print(`${n} polilínea(s) creada(s) con el contorno de delimitación.`);
  }
  let targets = ins;
  if (clipped.length && (await c.getKeyword('¿Desea suprimir el contorno anterior?', ['Sí', 'No'], 'Sí')) === 'No') targets = ins.filter(e => !e.clip);
  if (!targets.length) return;
  const { poly, invert } = await clipPoly(c, true);
  for (const e of targets) c.doc.modify(e.id, x => { x.clip = { pts: x.type === 'image' ? poly : toBlockCoords(c, x, poly), ...(invert ? { invert: true } : {}) }; });
  c.print(`${targets.length} referencia(s) delimitada(s)${invert ? ' (delimitación invertida)' : ''}.`);
}, { group: 'Bloques', sel: true });
// Contorno de delimitación en coordenadas del dibujo: rectangular, poligonal o de una polilínea cerrada
async function clipPoly(c, canInvert) {
  let invert = false, poly = null;
  while (!poly) {
    const m = await c.getKeyword(`Precise opción de delimitación${invert ? ' (invertida: se ocultará lo de dentro)' : ''}`, ['Seleccionar polilínea', 'Poligonal', 'Rectangular', ...(canInvert ? ['Invertir delimitación'] : [])], 'Rectangular');
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
  return { poly, invert };
}
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
  c.doc.removeMany(ids);
  if (ids.length) c.print(`${ids.length} objeto(s) borrado(s).`);
}, { group: 'Modificar', sel: true });

def('DRAWORDER', ['ORDENDIBUJO', 'ORDEN', 'DRAWORDER'], 'Cambia el orden de dibujo: lleva los objetos al frente o al fondo', async c => {
  const ids = await c.getSelection('Designe objetos para cambiar el orden de dibujo');
  if (!ids.length) return;
  const op = await c.getKeyword('Indique la posición', ['Frente', 'Detrás'], 'Frente');
  const arr = c.doc.ents, set = new Set(ids), sel = arr.filter(e => set.has(e.id));
  if (!sel.length) return c.print('Los objetos designados no pertenecen al espacio activo.');
  const rest = arr.filter(e => !set.has(e.id));
  c.doc.begin();
  c.doc.setOrder(arr, op === 'Frente' ? [...rest, ...sel] : [...sel, ...rest]);
  c.doc.commit();
  c.print(`${sel.length} objeto(s) enviado(s) ${op === 'Frente' ? 'al frente' : 'al fondo'}.`);
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
      if (steps.length) c.doc.rollback(steps.pop()); else c.print('Nada que deshacer.');
      continue;
    }
    const others = c.doc.ents.filter(e => c.doc.visible(e));
    const doExtend = extend !== r.shift;
    const before = c.doc.savepoint();
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
    if (o === 'desHacer') { if (steps.length) c.doc.rollback(steps.pop()); continue; }
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
    steps.push(c.doc.savepoint());
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
    return ids.map(id => { const e = c.doc.get(id); return W ? stretchIn(e, W, d) : xformEnt(cloneEnt(e), Mx.T(d.x, d.y)); }).filter(Boolean);
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
  const p = await c.getPoint('Precise punto'), u = ucsOf(c.doc), q = toUcs(u, p), w = toUcs(wcsOf(c.doc), p);
  if (c.doc.geo && (c.doc.space === 'model' || c.doc.activeVp)) c.print(formatGeographic(toGeographic(c.doc, p), c.doc.geo.format));
  const z = p.z ?? c.settings.elevation ?? 0; // la Z del punto designado (referencia a un vértice 3D o escrita) o la elevación actual
  c.print(`X = ${fmt(q.x, 4)}     Y = ${fmt(q.y, 4)}     Z = ${fmt(z, 4)}${isWorld(u) ? '' : `   (universal: ${fmt(w.x, 4)}, ${fmt(w.y, 4)})`}`);
}, { group: 'Utilidades' });

// ================= COTA Z Y COORDENADAS GRANDES =================
// Z de un punto designado: la escrita (x,y,z), la del vértice 3D al que se hizo referencia o la cota actual
const zOf = (p, z0) => (p && p.z != null ? +p.z : z0);
const pz = (p, z0) => ({ x: p.x, y: p.y, z: zOf(p, z0) });

def('3DPOLY', ['3P', 'POL3D', 'POLILINEA3D'], 'Dibuja una polilínea 3D: cada vértice con su cota Z (x,y,z, referencias a vértices 3D o la cota indicada)', async c => {
  let z0 = c.settings.elevation || 0;
  const first = await c.getPoint(`Precise punto inicial de la polilínea (x,y,z; cota de los puntos sin Z = ${fmt(z0, 3)})`, { options: ['Elevación'] });
  let p = first;
  while (p === 'Elevación') { z0 = await c.getNumber('Indique la cota Z de los puntos que se designen', { def: z0 }); p = await c.getPoint('Precise punto inicial de la polilínea', { options: ['Elevación'] }); }
  const pts = [pz(p, z0)];
  let ent = null;
  const sync = () => {
    if (pts.length < 2) { if (ent) { c.doc.remove(ent.id); ent = null; } return; }
    if (ent) c.doc.modify(ent.id, e => { e.pts = pts.map(q => ({ ...q })); });
    else ent = c.add({ type: 'pline3d', pts: pts.map(q => ({ ...q })) });
  };
  for (;;) {
    const opts = ['Elevación'];
    if (pts.length >= 3) opts.push('Cerrar');
    if (pts.length >= 2) opts.push('desHacer');
    const last = pts[pts.length - 1];
    const r = await c.getPoint(`Precise punto final de la línea (cota ${fmt(z0, 3)})`, { base: last, options: opts, allowEnter: true });
    if (r === null) break;
    if (r === 'Elevación') { z0 = await c.getNumber('Indique la cota Z de los puntos que se designen', { def: z0 }); continue; }
    if (r === 'Cerrar') { c.doc.modify(ent.id, e => { e.closed = true; }); break; }
    if (r === 'desHacer') { pts.pop(); sync(); c.setLast(pts[pts.length - 1]); continue; }
    pts.push(pz(r, z0)); sync();
  }
  if (ent) c.print(`Polilínea 3D de ${pts.length} vértices (Z de ${fmt(Math.min(...pts.map(q => q.z)), 3)} a ${fmt(Math.max(...pts.map(q => q.z)), 3)}).`);
}, { group: 'Dibujo' });

def('3DFACE', ['3F', 'CARA3D'], 'Dibuja caras 3D de tres o cuatro vértices (con aristas invisibles); cada cara sigue desde los dos últimos vértices de la anterior', async c => {
  let z0 = c.settings.elevation || 0, n = 0;
  // Pide un vértice; «Invisible» antes del punto hace invisible la arista que sale de él
  const ask = async (msg, opts = {}) => {
    let hide = false;
    for (;;) {
      const r = await c.getPoint(msg, { options: ['Invisible', 'Elevación'], ...opts });
      if (r === 'Invisible') { hide = true; continue; }
      if (r === 'Elevación') { z0 = await c.getNumber('Indique la cota Z de los puntos que se designen', { def: z0 }); continue; }
      return r === null ? null : { p: pz(r, z0), hide };
    }
  };
  let a = await ask('Precise primer punto');
  let b = await ask('Precise segundo punto', { base: a.p });
  for (;;) {
    const v3 = await ask(n ? 'Precise tercer punto <salir>' : 'Precise tercer punto', { base: b.p, allowEnter: n > 0 });
    if (!v3) break;
    const v4 = await ask('Precise cuarto punto <crear cara triangular>', { base: v3.p, allowEnter: true });
    const d = v4 || { p: { ...v3.p }, hide: false };
    const hide = [a.hide, b.hide, v3.hide, d.hide];
    c.add({ type: 'face3d', pts: [a.p, b.p, v3.p, d.p].map(q => ({ ...q })), ...(hide.some(Boolean) ? { hide } : {}) });
    n++;
    a = v3; b = d; // la cara siguiente empieza en el tercer y el cuarto vértice
  }
  c.print(`${n} cara(s) 3D creada(s).`);
}, { group: 'Dibujo' });

def('ELEV', ['ELEVACION', 'ELEVATION', 'COTAZ'], 'Cota Z (elevación) de los objetos nuevos y de los puntos que se designan sin Z', async c => {
  const v = await c.getNumber('Indique la elevación nueva', { def: c.settings.elevation || 0 });
  c.settings.elevation = v;
  c.doc.changed();
  c.print(`Elevación actual: ${fmt(v, 4)}.`);
}, { group: 'Utilidades', keepSel: true });

// Lleva a una cota (0 por defecto) los objetos designados: las polilíneas 3D pasan a polilíneas con esa elevación y las
// caras 3D quedan planas
def('FLATTEN', ['APLANAR', 'APLANA'], 'Aplana los objetos designados: les quita la cota Z (o los lleva a la cota indicada)', async c => {
  const ids = await c.getSelection('Designe objetos para aplanar');
  if (!ids.length) return;
  const z = await c.getNumber('Indique la cota a la que se llevan', { def: 0 });
  let n = 0;
  for (const id of ids) {
    const e = c.doc.get(id);
    if (!e) continue;
    if (e.type === 'pline3d') {
      const pts = e.pts.filter((q, i) => !i || !G.eqPt(q, e.pts[i - 1], 1e-12)).map(q => P(q.x, q.y));
      if (pts.length < 2) continue;
      const { id: _i, type: _t, pts: _p, closed, ...rest } = e;
      c.doc.remove(id);
      c.doc.add({ ...rest, type: 'pline', pts, ...(closed ? { closed: true } : {}), ...(z ? { elev: z } : {}) });
    } else c.doc.modify(id, x => {
      if (x.type === 'line') { if (z) { x.z1 = z; x.z2 = z; } else { delete x.z1; delete x.z2; } }
      else if (x.type === 'face3d') x.pts = x.pts.map(q => ({ x: q.x, y: q.y, z }));
      else if (TYPES[x.type] && ELEV_TYPES.has(x.type)) { if (z) x.elev = z; else delete x.elev; }
    });
    n++;
  }
  c.print(`${n} objeto(s) llevado(s) a la cota ${fmt(z, 4)}.`);
}, { group: 'Modificar', sel: true });

// Origen local del dibujo (origin.js): las coordenadas internas son relativas a él y el usuario ve las reales
def('LOCALORIGIN', ['ORIGENLOCAL', 'ORIGENDIBUJO'], 'Origen local del dibujo para trabajar con coordenadas grandes (de proyección) sin perder precisión', async c => {
  const doc = c.doc, o = doc.origin || P(0, 0);
  c.print(`Origen local actual: ${fmt(o.x, 3)}, ${fmt(o.y, 3)}. Las coordenadas que se ven y se escriben son siempre las reales.`);
  const k = await c.getKeyword('Indique opción', ['Automático', 'Punto', 'Restablecer'], 'Automático');
  let n = null;
  if (k === 'Automático') {
    const b = doc.extents(doc.model);
    if (!b) return c.print('El modelo está vacío.');
    n = ORG.roundOrigin({ x1: b.x1 + o.x, y1: b.y1 + o.y, x2: b.x2 + o.x, y2: b.y2 + o.y });
  } else if (k === 'Punto') {
    const p = await c.getPoint('Precise el punto que será el origen local (en coordenadas reales)');
    const r = ORG.toReal(doc, p);
    n = P(r.x, r.y);
  } else n = P(0, 0);
  if (!ORG.setOrigin(doc, n)) return c.print('El origen local no cambia.');
  c.print(`Origen local: ${fmt(n.x, 3)}, ${fmt(n.y, 3)}.`);
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
  if (typeof r === 'number') { v.push(); v.zoomAt(r, { x: (v.ox || 0) + v.w / 2, y: (v.oy || 0) + v.h / 2 }); c.app.renderer.invalidate(); return; }
  const a = r === 'Ventana' ? await c.getPoint('Precise primera esquina', { noSnap: true }) : r;
  const b = await c.getPoint('Precise esquina opuesta', { noSnap: true, base: a, rubber: false, preview: p => [{ type: 'pline', pts: viewRectPts(v, a, p), closed: true }] });
  v.push(); v.fitPts(viewRectPts(v, a, b), 0); c.app.renderer.invalidate();
}, { group: 'Vista', noTx: true });

def('PAN', ['P', 'ENCUADRE'], 'Desplaza la vista arrastrando', async c => {
  c.app.view.push();
  await c.app.ask('pan', 'Arrastre para encuadrar. Pulse ESC o INTRO para salir', { allowEnter: true });
}, { group: 'Vista', noTx: true });

def('REGEN', ['RE', 'REGENERAR'], 'Regenera el dibujo', async c => { c.app.renderer.invalidate(); }, { group: 'Vista', noTx: true });

def('ISODRAFT', ['ISO', 'ISOMETRICO'], 'Activa o desactiva el dibujo isométrico (F5 cambia de plano)', async c => { c.app.toggleIso(); }, { group: 'Vista', noTx: true });

// ================= SCP, VISTAS Y VENTANAS EN MOSAICO =================
const ucsDesc = u => (!u ? 'Universal' : `${u.name ? `"${u.name}" ` : ''}origen ${fmt(u.o.x, 4)},${fmt(u.o.y, 4)}, eje X a ${deg(u.ang)}`);
async function ucsNamed(c, arg) {
  const doc = c.doc;
  const k = arg?.op || await c.getKeyword('Indique una opción', ['Restituir', 'Guardar', 'Suprimir', '?'], 'Restituir');
  if (k === '?') { c.print(`SCP actual: ${ucsDesc(doc.ucs)}`); if (!doc.ucsList.length) c.print('No hay SCP con nombre.'); for (const u of doc.ucsList) c.print(`  ${u.name}: origen ${fmt(u.o.x, 4)},${fmt(u.o.y, 4)}, eje X a ${deg(u.ang)}`); return; }
  const name = (arg?.name ?? await c.getString(k === 'Guardar' ? 'Indique nombre para guardar el SCP actual' : `Indique nombre del SCP que desea ${k === 'Suprimir' ? 'suprimir' : 'restituir'}`, { spaces: true })).trim();
  const u = findUcs(doc, name);
  if (k === 'Guardar') {
    if (!validUcsName(name)) return c.print('Nombre de SCP no válido.');
    saveUcs(doc, name); return c.print(`SCP "${name}" guardado: ${ucsDesc(doc.ucs)}.`);
  }
  if (!u) return c.print(`No existe el SCP "${name}".`);
  if (k === 'Suprimir') { deleteUcs(doc, u.name); return c.print(`SCP "${u.name}" suprimido.`); }
  setUcs(doc, u, u.name); c.print(`SCP "${u.name}" restituido.`);
}
def('UCS', ['SCP'], 'Sistema de coordenadas personal: origen y eje X, tres puntos, objeto, giro, con nombre, previo o universal', async (c, arg) => {
  const before = JSON.stringify(c.doc.ucs || null);
  await ucsCmd(c, arg);
  if (c.settings.ucsfollow && c.doc.space === 'model' && JSON.stringify(c.doc.ucs || null) !== before) planView(c, ucsOf(c.doc));
}, { group: 'Vista', keepSel: true });
async function ucsCmd(c, arg) {
  const doc = c.doc;
  if (doc.space !== 'model') return c.print('El SCP sólo se usa en el espacio modelo (en una presentación, active una ventana gráfica).');
  if (arg && typeof arg === 'object' && arg.o) { setUcs(doc, arg, arg.name); return; }
  const cur = ucsOf(doc);
  const r = arg || await c.getPoint('Precise origen del SCP', { options: ['Nombre', 'OBjeto', 'Previo', 'Universal', 'Z', '3puntos'], def: 'Universal' });
  if (r === 'Universal') { setUcs(doc, WORLD); return c.print('SCP universal.'); }
  if (r === 'Previo') { if (!prevUcs(doc)) c.print('No hay SCP previo.'); else c.print(`SCP previo: ${ucsDesc(doc.ucs)}.`); return; }
  if (r === 'Nombre') return ucsNamed(c);
  if (r === 'Z') {
    const a = await c.getNumber('Precise ángulo de rotación alrededor del eje Z', { def: 90 });
    setUcs(doc, { o: cur.o, ang: cur.ang + G.rad(a) }); return c.print(`SCP girado ${fmt(a, 2)}°.`);
  }
  if (r === 'OBjeto') {
    const o = await c.getEntity('Designe objeto para alinear el SCP');
    const u = ucsFromObject(o.e, o.pt);
    if (!u) return c.print('No se puede alinear el SCP con ese objeto.');
    setUcs(doc, u); return c.print(`SCP alineado con ${TYPES[o.e.type].name.toLowerCase()}: ${ucsDesc(doc.ucs)}.`);
  }
  const o = r === '3puntos' ? await c.getPoint('Precise nuevo punto de origen', { def: cur.o }) : r;
  const px = await c.getPoint('Precise punto en el eje X positivo o <aceptar>', { base: o, allowEnter: true });
  if (r === '3puntos' && px) await c.getPoint('Precise punto en la parte positiva Y del plano XY o <aceptar>', { base: o, allowEnter: true });
  setUcs(doc, px ? ucs3P(o, px) : { o, ang: cur.ang });
  c.print(`SCP: ${ucsDesc(doc.ucs)}.`);
}

// ---- Vistas giradas ----
// Giro de la vista actual: en el modelo, el de la vista (o de la ventana en mosaico); en una ventana gráfica, su giro.
// a: ángulo del dibujo que se ve horizontal; p: punto que no se mueve en la pantalla (el centro, si no se indica)
function setViewRot(c, a, p = null) {
  const app = c.app, v = app.view;
  if (v.vp) {
    const keep = p || v.modelAt(v.vc);
    setTwist(v.vp, a);
    if (!p) { v.vp.cx = keep.x; v.vp.cy = keep.y; } else { const s = v.toScreen(p), w = v.toWorld(s); v.vp.cx += keep.x - w.x; v.vp.cy += keep.y - w.y; }
  } else v.setRot(G.normAng(a) < 1e-12 || G.TAU - G.normAng(a) < 1e-12 ? 0 : G.normAng(a), p);
  app.renderer.invalidate(); app.ui.updateStatus();
}
const viewRotOk = c => {
  if (c.app.layoutShown() && !c.app.vpActive) { c.print('Esta orden gira la vista del modelo: entre en una ventana gráfica (MSPACE o doble clic) o vaya a la pestaña Modelo. En el papel, el giro de una ventana se cambia en Propiedades (Giro) o con GIRA.'); return false; }
  if (c.doc.bedit) { c.print('En el editor de bloques la vista no se gira.'); return false; }
  return true;
};
// PLAN: vista en planta del SCP u (su eje X horizontal). En el modelo amplía la extensión; en una ventana gráfica
// conserva la escala y el centro para no estropear la escala de la lámina
function planView(c, u) {
  const app = c.app, v = app.view;
  v.push();
  setViewRot(c, u ? u.ang : 0);
  if (!v.vp) app.zoomExtents();
}
def('PLAN', ['PLANTA'], 'Vista en planta: gira la vista para alinearla con el SCP actual, con un SCP con nombre o con el universal', async (c, arg) => {
  if (!viewRotOk(c)) return;
  const doc = c.doc;
  const k = arg || await c.getKeyword('Indique una opción', ['SCP actual', 'SCP', 'Universal'], 'SCP actual');
  let u = ucsOf(doc), what = 'el SCP actual';
  if (k === 'Universal') { u = WORLD; what = 'el SCP universal'; }
  else if (k === 'SCP') {
    const name = (await c.getString('Indique nombre del SCP', { spaces: true })).trim();
    u = findUcs(doc, name);
    if (!u) return c.print(`No existe el SCP "${name}".`);
    what = `el SCP "${u.name}"`;
  }
  planView(c, u);
  c.print(`Vista en planta de ${what}${u.ang ? ` (girada ${deg(u.ang)})` : ''}.`);
}, { group: 'Vista', keepSel: true });

def('DVIEW', ['DV', 'VISTADIN', 'GIRARVISTA', 'VIEWTWIST'], 'Gira la vista: ángulo, alinear con dos puntos o con un objeto, o restablecer (VIEWTWIST)', async (c, arg) => {
  if (!viewRotOk(c)) return;
  const v = c.app.view, cur = v.rot || 0;
  const k = arg ?? await c.getKeyword(`Giro actual ${deg(cur)}. Indique una opción`, ['Giro', 'Dos puntos', 'Objeto', 'Restablecer'], 'Giro');
  if (typeof k === 'number') { v.push(); setViewRot(c, G.rad(k)); return c.print(`Vista girada ${deg(G.rad(k))}.`); }
  if (k === 'Restablecer') { v.push(); setViewRot(c, 0); return c.print('Vista sin giro: el eje X universal se ve horizontal.'); }
  let a;
  if (k === 'Giro') a = G.rad(await c.getNumber('Indique ángulo del dibujo que se verá horizontal', { def: +G.deg(cur).toFixed(6) }));
  else if (k === 'Dos puntos') {
    const p1 = await c.getPoint('Precise primer punto de la dirección horizontal');
    const p2 = await c.getPoint('Precise segundo punto', { base: p1 });
    if (G.dist(p1, p2) < 1e-12) return c.print('Los puntos coinciden.');
    a = G.ang(p1, p2);
  } else {
    const o = await c.getEntity('Designe la línea, el tramo de polilínea, el arco o el texto con el que alinear la vista');
    const u = ucsFromObject(o.e, o.pt);
    if (!u) return c.print('No se puede alinear la vista con ese objeto.');
    a = o.e.type === 'pline' ? plTangentAt(o.e, o.pt) ?? u.ang : o.e.type === 'arc' || o.e.type === 'circle' ? G.ang(o.e.c, o.pt) - Math.PI / 2 : u.ang;
  }
  v.push(); setViewRot(c, a);
  c.print(`Vista girada ${deg(G.normAng(a))}: esa dirección se ve horizontal.`);
}, { group: 'Vista', keepSel: true });

// Dirección del tramo de polilínea más cercano al punto (o null)
function plTangentAt(e, p) {
  let best = null, bd = Infinity;
  for (const q of primsOf(e)) {
    const n = G.nearPrim(p, q), d = G.dist(p, n);
    if (d < bd) { bd = d; best = q.k === 's' ? G.ang(q.a, q.b) : G.ang(q.c, n) + Math.PI / 2; }
  }
  return best;
}

// ---- Escalas anotativas (annoscale.js) ----
const scaleDesc = s => `${s.name} (${fmt(s.paper, 4)} unidad(es) del papel = ${fmt(s.draw, 4)} del dibujo)`;
// Cambia la escala de anotación actual: en una ventana gráfica, su escala (las dos van unidas); en el modelo, CANNOSCALE.
// Con ANNOAUTOSCALE = 1 la escala nueva se añade a los objetos anotativos de las capas activadas y desbloqueadas
function setAnnoScale(c, s) {
  const app = c.app, doc = c.doc;
  if (app.vpActive) {
    const vp = doc.get(app.vpActive);
    vp.s = 1 / AN.factorOf(s);
  } else if (app.tab !== 'model') { c.print('En el papel la escala de anotación es 1:1: active una ventana gráfica o vaya al modelo.'); return false; }
  else doc.settings.cannoscale = s.name;
  if (doc.settings.annoAutoScale) {
    let n = 0;
    for (const e of doc.model) if (AN.isAnno(e) && doc.layer(e.layer).on && !doc.locked(e) && !e.anno.includes(s.name)) { doc.before(e); n += AN.addScales(e, [s.name]) ? 1 : 0; }
    if (n) c.print(`ANNOAUTOSCALE: escala ${s.name} añadida a ${n} objeto(s) anotativo(s).`);
  }
  doc.changed();
  app.renderer.invalidate(); app.ui.updateStatus();
  return true;
}
def('CANNOSCALE', ['ESCALAANOTACION', 'ESCANOT'], 'Escala de anotación actual (del modelo o de la ventana gráfica activa)', async (c, arg) => {
  const cur = AN.curScale();
  const t = arg ?? (await c.getString(`Escala de anotación actual ${cur.name}. Indique escala nueva (nombre o proporción, p. ej. 1:500)`, { def: cur.name })).trim();
  if (!t) return;
  const s = AN.resolveScale(c.doc, t, true);
  if (!s) return c.print(`Escala no válida: "${t}".`);
  if (setAnnoScale(c, s)) c.print(`Escala de anotación: ${s.name}.`);
}, { group: 'Anotación', keepSel: true });

def('SCALELISTEDIT', ['EDITARLISTAESCALAS', 'LISTAESCALAS'], 'Edita la lista de escalas del dibujo: añadir, suprimir, listar o restablecer la lista por defecto', async c => {
  const doc = c.doc;
  for (;;) {
    const k = await c.getKeyword('Indique una opción', ['?', 'Añadir', 'Suprimir', 'Restablecer', 'Salir'], 'Salir');
    if (k === 'Salir') return;
    if (k === '?') { for (const s of AN.scalesOf(doc)) c.print(`  ${scaleDesc(s)}${AN.inUse(doc, s.name) ? '  (en uso)' : ''}`); continue; }
    if (k === 'Restablecer') {
      const used = AN.scalesInUse(doc), keep = AN.scalesOf(doc).filter(s => used.has(s.name.toLowerCase()) && !AN.DEFAULT_SCALES.some(d => d.name === s.name));
      doc.scales = [...AN.defaultScales(), ...keep]; doc.changed();
      c.print(`Lista de escalas restablecida (${doc.scales.length} escalas${keep.length ? `; se conservan ${keep.length} en uso` : ''}).`);
      continue;
    }
    if (k === 'Añadir') {
      const name = (await c.getString('Indique nombre de la escala', { spaces: true })).trim();
      if (!name) continue;
      if (AN.findScale(doc, name)) { c.print(`Ya existe la escala "${name}".`); continue; }
      const p = AN.parseScale(name);
      const paper = await c.getNumber('Indique unidades del papel', { def: p?.paper ?? 1, min: 1e-9 });
      const draw = await c.getNumber('Indique unidades del dibujo', { def: p?.draw ?? 1, min: 1e-9 });
      AN.scalesOf(doc).push({ name, paper, draw }); doc.changed();
      c.print(`Escala añadida: ${scaleDesc({ name, paper, draw })}.`);
      continue;
    }
    const name = (await c.getString('Indique nombre de la escala que desea suprimir', { spaces: true })).trim();
    const s = AN.findScale(doc, name);
    if (!s) { c.print(`No existe la escala "${name}".`); continue; }
    if (AN.inUse(doc, s.name)) { c.print(`La escala ${s.name} está en uso (es la actual o la tienen objetos anotativos).`); continue; }
    if (AN.scalesOf(doc).length < 2) { c.print('La lista debe tener al menos una escala.'); continue; }
    doc.scales = AN.scalesOf(doc).filter(x => x !== s); doc.changed();
    c.print(`Escala ${s.name} suprimida.`);
  }
}, { group: 'Anotación', keepSel: true });

// Añade o quita escalas de anotación a los objetos anotativos designados
async function objScales(c, op, names) {
  const ids = await c.getSelection('Designe objetos anotativos');
  const ents = ids.map(id => c.doc.get(id)).filter(e => AN.isAnno(e));
  if (!ents.length) return c.print('Ningún objeto anotativo designado.');
  if (!op) op = await c.getKeyword('Indique una opción', ['Añadir', 'Suprimir', '?'], 'Añadir');
  if (op === '?') { for (const e of ents) c.print(`  ${TYPES[e.type].name}: ${e.anno.join(', ')}`); return; }
  if (!names) {
    const t = (await c.getString(`Indique escala(s) que desea ${op === 'Añadir' ? 'añadir' : 'suprimir'}, separadas por comas (* = todas las de la lista)`, { spaces: true, def: AN.curScale().name })).trim();
    names = t === '*' ? AN.scalesOf(c.doc).map(s => s.name) : t.split(/[;,]/).map(x => x.trim()).filter(Boolean);
  }
  const ok = [];
  for (const n of names) { const s = AN.resolveScale(c.doc, n, op === 'Añadir'); if (s) ok.push(s.name); else c.print(`Escala no válida: "${n}".`); }
  if (!ok.length) return;
  let n = 0, last = 0;
  for (const e of ents) c.doc.modify(e.id, x => { const r = op === 'Añadir' ? AN.addScales(x, ok) : AN.removeScales(x, ok); if (r > 0) n++; if (r < 0) last++; });
  c.print(`${n} objeto(s) modificado(s)${last ? `; ${last} conservan su única escala (un objeto anotativo necesita al menos una)` : ''}.`);
}
def('OBJECTSCALE', ['ESCALAOBJETO', 'ESCALASOBJETO'], 'Añade o suprime escalas de anotación de los objetos anotativos', c => objScales(c), { group: 'Anotación' });
def('AIOBJECTSCALEADD', ['ESCALAOBJETOAÑADIR'], 'Añade la escala de anotación actual a los objetos anotativos designados', c => objScales(c, 'Añadir', [AN.curScale().name]), { group: 'Anotación' });
def('AIOBJECTSCALEREMOVE', ['ESCALAOBJETOQUITAR'], 'Quita la escala de anotación actual de los objetos anotativos designados', c => objScales(c, 'Suprimir', [AN.curScale().name]), { group: 'Anotación' });
def('ANNOTATIVE', ['ANOTATIVO'], 'Hace anotativos (o no) los objetos designados, con la escala de anotación actual', async c => {
  const ids = await c.getSelection('Designe textos, cotas, directrices, sombreados o bloques');
  const ents = ids.map(id => c.doc.get(id)).filter(e => AN.ANNO_TYPES.has(e.type));
  if (!ents.length) return c.print('Ningún objeto que pueda ser anotativo.');
  const on = (await c.getKeyword('¿Anotativos?', ['Sí', 'No'], 'Sí')) === 'Sí';
  for (const e of ents) c.doc.modify(e.id, x => AN.setAnnotative(x, on));
  c.print(`${ents.length} objeto(s) ${on ? `anotativo(s) con la escala ${AN.curScale().name}` : 'ya no anotativo(s)'}.`);
}, { group: 'Anotación' });

// ---- Automatización: guiones, grabación de acciones y JavaScript (scripting.js) ----
// El guion se ejecuta después de esta orden (sus órdenes no se pueden anidar en ella); app.scriptPromise permite esperarlo
function startScript(c, text, name) {
  const app = c.app;
  app.scriptPromise = SC.runScript(app, text, name)
    .then(n => { app.print(`Guion "${name}" terminado (${n} respuesta(s)).`); return n; })
    .catch(err => { app.print(err.message, 'err'); return -1; });
}
def('SCRIPT', ['SCR', 'GUION'], 'Ejecuta un guion .scr: órdenes y respuestas como en la línea de comandos (espacio o fin de línea = Intro)', async (c, arg) => {
  let text = arg?.text, name = arg?.name || 'guion';
  if (text == null) {
    const f = await c.app.io.pickFile('Guiones', ['.scr', '.txt']);
    if (!f) return;
    text = await f.file.text(); name = f.file.name;
  }
  c.print(`Ejecutando el guion "${name}" (Esc lo interrumpe)…`);
  startScript(c, text, name);
}, { group: 'Herramientas', noTx: true });
def('DELAY', ['RETARDO', 'PAUSA'], 'Pausa en un guion (milisegundos)', async c => {
  const ms = await c.getNumber('Indique retardo en milisegundos', { def: 1000, min: 0, max: 60000 });
  await new Promise(r => setTimeout(r, ms));
}, { group: 'Herramientas', noTx: true, keepSel: true });
def('ACTRECORD', ['GRABARACCION', 'GRABAR'], 'Empieza a grabar las órdenes y respuestas para guardarlas como guion .scr (ACTSTOP termina)', async c => {
  if (SC.REC.on) return c.print('Ya se está grabando. ACTSTOP termina la grabación.');
  SC.REC.on = true; SC.REC.lines = []; SC.REC.name = '';
  c.app.ui.updateStatus();
  c.print('Grabando acciones: lo que haga desde ahora (órdenes, puntos, designaciones y respuestas) se guardará como guion. ACTSTOP termina.');
}, { group: 'Herramientas', noTx: true, keepSel: true });
def('ACTSTOP', ['PARARGRABACION', 'DETENERGRABACION'], 'Termina la grabación de acciones y la guarda como guion .scr', async (c, arg) => {
  if (!SC.REC.on) return c.print('No se está grabando. ACTRECORD empieza una grabación.');
  SC.REC.on = false;
  c.app.ui.updateStatus();
  if (!SC.REC.lines.length) return c.print('No se ha grabado ninguna acción.');
  const name = arg?.name ?? ((await c.getString('Indique nombre del guion', { spaces: true, def: 'accion' })).trim() || 'accion');
  SC.REC.name = name;
  const text = SC.recText();
  c.app.lastRecording = text;
  c.print(`Grabación terminada: ${SC.REC.lines.length} línea(s). SCRIPT la vuelve a ejecutar.`);
  if (!arg?.noSave) await c.app.io.writeFile(text, `${name}.scr`, 'text/plain', '.scr', 'Guion de TrazoCAD', false);
}, { group: 'Herramientas', noTx: true, keepSel: true });
def('JSEVAL', ['-JS', 'EVALJS'], 'Ejecuta una línea de JavaScript con la API de TrazoCAD (tc) y muestra el resultado', async (c, arg) => {
  const code = arg ?? await c.getString('JavaScript (tc = API, app = aplicación)', { spaces: true });
  if (!code.trim()) return;
  const v = await SC.runJs(c.app, /\breturn\b|;/.test(code) ? code : `return (${code});`, 'JSEVAL');
  if (v !== undefined) c.print(`= ${typeof v === 'string' ? v : JSON.stringify(v)}`);
}, { group: 'Herramientas', noTx: true, keepSel: true });
def('JSCONSOLE', ['JS', 'CONSOLAJS', 'CONSOLA'], 'Consola de JavaScript con la API de TrazoCAD para automatizar y definir órdenes nuevas', async c => { await c.app.ui.jsConsole(); }, { group: 'Herramientas', noTx: true, keepSel: true });
def('APPLOAD', ['AP', 'CARGARAPLIC'], 'Carga aplicaciones JavaScript (.js) o guiones (.scr) y administra las que se cargan al iniciar', async c => {
  const app = c.app;
  for (;;) {
    const r = await app.ui.appManager();
    if (!r) return;
    if (r.action === 'remove') { SC.saveStartupApps(SC.startupApps().filter(a => a.name !== r.name)); continue; }
    const f = await app.io.pickFile('Aplicaciones', ['.js', '.scr']);
    if (!f) continue;
    const text = await f.file.text(), name = f.file.name;
    if (/\.scr$/i.test(name)) { startScript(c, text, name); return; }
    try { await SC.runJs(app, text, name); c.print(`Aplicación "${name}" cargada.`); }
    catch (err) { c.print(`Error en "${name}": ${err.message}`, 'err'); continue; }
    if (r.startup) {
      const list = SC.startupApps().filter(a => a.name !== name);
      if (SC.saveStartupApps([...list, { name, code: text }])) c.print(`"${name}" se cargará cada vez que se abra TrazoCAD.`);
    }
  }
}, { group: 'Herramientas', noTx: true, keepSel: true });

const sysvar01 = (name, aliases, desc, key, after) => def(name, aliases, desc, async c => {
  const v = await c.getNumber(`Indique valor nuevo para ${name} (0 o 1)`, { def: c.settings[key] ? 1 : 0, int: true, min: 0, max: 1 });
  c.settings[key] = v; c.doc.changed();
  after?.(c, v);
}, { group: 'Vista', keepSel: true });
sysvar01('UCSVP', ['SCPVENTANA'], 'SCP propio de cada ventana (en mosaico y gráficas): 1 = cada una conserva el suyo, 0 = todas usan el actual', 'ucsvp');
sysvar01('UCSFOLLOW', ['SCPSIGUE'], 'Vista en planta automática: 1 = al cambiar el SCP, la vista se alinea con él (como PLAN)', 'ucsfollow');
sysvar01('ANNOALLVISIBLE', ['ANOTODOVISIBLE'], 'Objetos anotativos que no tienen la escala actual: 1 = se ven atenuados, 0 = se ocultan', 'annoAllVisible', c => c.app.renderer.invalidate());
sysvar01('ANNOAUTOSCALE', ['ANOESCALAAUTO'], 'Al cambiar la escala de anotación: 1 = se añade a los objetos anotativos', 'annoAutoScale');
sysvar01('HPANNOTATIVE', ['SOMBREADOANOTATIVO'], 'Sombreados nuevos anotativos: 1 = la escala del patrón es la del papel', 'hatchAnno');
sysvar01('VPROTATEASSOC', ['GIROVENTANAASOC'], 'Al girar una ventana gráfica con GIRA: 1 = la vista del modelo gira con ella, 0 = sólo el marco', 'vprotateassoc');

def('UCSMAN', ['ADMINSCP', 'SCPMAN', 'UC'], 'Administrador de SCP: restituir, guardar, renombrar y suprimir SCP con nombre y opciones del icono', async c => {
  const doc = c.doc, ui = c.app.ui;
  for (;;) {
    const r = await ui.ucsManager();
    if (!r) return;
    if (r.action === 'set') {
      if (r.name === '*universal*') setUcs(doc, WORLD);
      else if (r.name === '*previo*') { if (!prevUcs(doc)) c.print('No hay SCP previo.'); }
      else { const u = findUcs(doc, r.name); if (u) setUcs(doc, u, u.name); }
      c.app.renderer.invalidate();
      return c.print(`SCP actual: ${ucsDesc(doc.ucs)}.`);
    }
    if (r.action === 'save') {
      if (doc.space !== 'model') { c.print('El SCP sólo se usa en el espacio modelo.'); continue; }
      let n = 1;
      while (findUcs(doc, `SCP${n}`)) n++;
      const v = await ui.prompt('Guardar SCP actual', 'Nombre', doc.ucs?.name || `SCP${n}`);
      if (v && validUcsName(v)) saveUcs(doc, v); else if (v !== null) c.print('Nombre de SCP no válido.');
      continue;
    }
    const u = findUcs(doc, r.name);
    if (!u) continue;
    if (r.action === 'rename') {
      const v = await ui.prompt('Renombrar SCP', 'Nuevo nombre', u.name);
      if (v && validUcsName(v) && !(findUcs(doc, v) && findUcs(doc, v) !== u)) renameUcs(doc, u, v); else if (v !== null) c.print('Nombre no válido o repetido.');
    } else if (r.action === 'delete') { deleteUcs(doc, u.name); c.print(`SCP "${u.name}" suprimido.`); }
  }
}, { group: 'Vista', keepSel: true });

def('UCSICON', ['ICONOSCP', 'ICONSCP'], 'Muestra u oculta el icono del SCP y lo coloca en el origen', async (c, arg) => {
  const S = c.settings;
  const k = arg || await c.getKeyword('Indique una opción', ['ACtivar', 'DEsactivar', 'Origen', 'No origen'], S.ucsIcon === false ? 'ACtivar' : 'DEsactivar');
  if (k === 'ACtivar') S.ucsIcon = true; else if (k === 'DEsactivar') S.ucsIcon = false; else if (k === 'Origen') S.ucsIconOrigin = true; else S.ucsIconOrigin = false;
  c.app.renderer.invalidate();
  c.print(`Icono del SCP ${S.ucsIcon === false ? 'oculto' : 'visible'}${S.ucsIcon !== false ? (S.ucsIconOrigin === false ? ', en la esquina' : ', en el origen') : ''}.`);
}, { group: 'Vista', noTx: true });

const viewDesc = v => `${v.name}: ${v.space === 'model' ? 'Modelo' : `presentación "${v.space}"`}, centro ${fmt(v.cx, 2)},${fmt(v.cy, 2)}, ${fmt(v.w, 2)} × ${fmt(v.h, 2)}${v.twist ? `, girada ${deg(v.twist)}` : ''}${v.ucs ? ', con SCP' : ''}${v.layers ? ', con capas' : ''}`;
async function newView(c, name, o = {}) {
  let pts = null;
  if (o.window) {
    const vw = c.app.view, a = await c.getPoint('Precise primera esquina', { noSnap: true });
    const b = await c.getPoint('Precise esquina opuesta', { noSnap: true, base: a, rubber: false, preview: p => [{ type: 'pline', pts: viewRectPts(vw, a, p), closed: true }] });
    pts = viewRectPts(vw, a, b);
  }
  const v = saveView(c.doc, captureView(c.app, name, { pts, ucs: o.ucs !== false, layers: !!o.layers }));
  c.print(`Vista "${v.name}" guardada (${viewDesc(v)}).`);
}
function goView(c, v) {
  if (!restoreView(c.app, v)) return c.print(`La presentación "${v.space}" de la vista "${v.name}" ya no existe.`);
  c.print(`Vista "${v.name}" restituida.`);
}
def('VIEW', ['V', 'VISTA', 'VISTAS'], 'Administrador de vistas con nombre: guardar la vista actual o una ventana (con su SCP y las capas) y restituirla', async (c, arg) => {
  const doc = c.doc, ui = c.app.ui;
  if (arg?.save) return newView(c, arg.save, arg);
  if (arg?.restore) { const v = findView(doc, arg.restore); return v ? goView(c, v) : c.print(`No existe la vista "${arg.restore}".`); }
  for (;;) {
    const r = await ui.viewManager();
    if (!r) return;
    const v = r.name ? findView(doc, r.name) : null;
    if (r.action === 'new') {
      let n = 1;
      while (findView(doc, `Vista${n}`)) n++;
      const name = await ui.prompt('Nueva vista', 'Nombre de la vista', `Vista${n}`);
      if (!name) continue;
      if (!validViewName(name)) { c.print('Nombre de vista no válido.'); continue; }
      if (findView(doc, name) && !(await ui.confirm(`La vista "${name}" ya existe. ¿Desea sustituirla?`, 'Sustituir'))) continue;
      await newView(c, name, r.opts);
      continue;
    }
    if (!v) continue;
    if (r.action === 'restore') return goView(c, v);
    if (r.action === 'update') { saveView(doc, captureView(c.app, v.name, { ucs: !!v.ucs, layers: !!v.layers })); c.print(`Vista "${v.name}" actualizada con la vista actual.`); }
    else if (r.action === 'rename') {
      const n = await ui.prompt('Renombrar vista', 'Nuevo nombre', v.name);
      if (n && validViewName(n) && !(findView(doc, n) && findView(doc, n) !== v)) { v.name = n; doc.changed(); } else if (n !== null) c.print('Nombre no válido o repetido.');
    } else if (r.action === 'delete') { deleteView(doc, v.name); c.print(`Vista "${v.name}" suprimida.`); }
  }
}, { group: 'Vista', keepSel: true });
def('-VIEW', ['-V', '-VISTA'], 'Vistas con nombre por la línea de comandos: guardar, ventana, restituir, borrar o listar', async c => {
  const doc = c.doc;
  const k = await c.getKeyword('Indique una opción', ['?', 'Borrar', 'Restituir', 'Guardar', 'Ventana'], 'Restituir');
  if (k === '?') { if (!doc.views.length) c.print('No hay vistas con nombre.'); for (const v of doc.views) c.print(`  ${viewDesc(v)}`); return; }
  const name = (await c.getString(k === 'Guardar' || k === 'Ventana' ? 'Indique nombre de la vista' : `Indique nombre de la vista que desea ${k === 'Borrar' ? 'borrar' : 'restituir'}`, { spaces: true })).trim();
  if (k === 'Guardar' || k === 'Ventana') { if (!validViewName(name)) return c.print('Nombre de vista no válido.'); return newView(c, name, { window: k === 'Ventana' }); }
  const v = findView(doc, name);
  if (!v) return c.print(`No existe la vista "${name}".`);
  if (k === 'Borrar') { deleteView(doc, v.name); c.print(`Vista "${v.name}" borrada.`); } else goView(c, v);
}, { group: 'Vista', keepSel: true });

// Ventana vecina de la activa por un lado (para unir)
function tileBeside(app, side) {
  const a = app.activeTile(), eq = (u, v) => Math.abs(u - v) < 1e-9;
  return app.tiles.find(t => t !== a && joinTiles(a.r, t.r) && (side === 'Izquierda' ? eq(t.r.x2, a.r.x1) : side === 'deRecha' ? eq(t.r.x1, a.r.x2) : side === 'ENcima' ? eq(t.r.y2, a.r.y1) : eq(t.r.y1, a.r.y2))) || null;
}
const tileItem = t => ({ r: t.r, cx: t.view.cx, cy: t.view.cy, scale: t.view.scale, rot: t.view.rot || 0, ...('ucs' in t ? { ucs: t.ucs } : {}) });
def('VPORTS', ['VENTANASMODELO', 'VMOSAICO', 'MOSAICO'], 'Divide el espacio modelo en ventanas en mosaico (o crea varias ventanas gráficas en una presentación); unir, guardar y restituir configuraciones', async (c, arg) => {
  const app = c.app, doc = c.doc;
  if (doc.bedit) return c.print('Cierre primero el editor de bloques.');
  const askDir = async n => (n === 2 ? c.getKeyword('Indique una disposición', TILE_DIRS[2], 'Vertical') : n === 3 ? c.getKeyword('Indique una disposición', TILE_DIRS[3], 'deRecha') : null);
  if (app.tab !== 'model') { // presentación: n ventanas gráficas en un rectángulo
    if (app.vpActive) app.pspace();
    const n = +(arg?.n || await c.getKeyword('Indique número de ventanas gráficas', ['1', '2', '3', '4'], '1'));
    const dir = arg?.dir || await askDir(n);
    const lay = doc.layout();
    const r = arg?.rect ? 'x' : await c.getPoint('Precise primera esquina', { options: ['Ajustar'], def: 'Ajustar' });
    let rc;
    if (arg?.rect) rc = arg.rect;
    else if (r === 'Ajustar') rc = { x1: 10, y1: 10, x2: lay.w - 10, y2: lay.h - 10 };
    else { const b = await c.getPoint('Precise esquina opuesta', { base: r, rubber: false, preview: p => [{ type: 'pline', pts: rectPts(r, p), closed: true }] }); rc = G.normRect(r, b); }
    if (rc.x2 - rc.x1 < 2 || rc.y2 - rc.y1 < 2) return c.print('Zona demasiado pequeña.');
    const made = splitPaper(rc, n, dir).map(t => app.addViewport(t));
    return c.print(`${made.length} ventana(s) gráfica(s) creada(s) a escala ${made.map(v => v.label).join(', ')}.`);
  }
  const k = arg?.op || await c.getKeyword('Indique una opción', ['Guardar', 'Restituir', 'Suprimir', 'Unir', 'ÚNica', '?', '2', '3', '4'], '3');
  if (k === 'ÚNica') { const a = app.activeTile(); app.setTiles([{ ...tileItem(a), r: { x1: 0, y1: 0, x2: 1, y2: 1 } }]); return c.print('Una sola ventana.'); }
  if (k === '?') {
    c.print(`Configuración actual: ${app.tiles.length} ventana(s).`);
    for (const v of doc.vportConfigs) c.print(`  ${v.name}: ${v.tiles.length} ventana(s)`);
    if (!doc.vportConfigs.length) c.print('No hay configuraciones de ventanas guardadas.');
    return;
  }
  if (k === 'Guardar' || k === 'Restituir' || k === 'Suprimir') {
    const name = (arg?.name ?? await c.getString(`Indique nombre de la configuración de ventanas`, { spaces: true, def: k === 'Guardar' ? '' : doc.vportConfigs[0]?.name || '' })).trim();
    const old = findVportConfig(doc, name);
    if (k === 'Guardar') {
      if (!validViewName(name)) return c.print('Nombre no válido.');
      const st = app.tilesState() || { active: 0, tiles: app.tiles.map(({ r, view: v }) => ({ r, cx: v.cx, cy: v.cy, vh: v.h / v.scale })) };
      const rec = { name: old?.name || name, ...JSON.parse(JSON.stringify(st)) };
      if (old) Object.assign(old, rec); else doc.vportConfigs.push(rec);
      doc.changed();
      return c.print(`Configuración "${rec.name}" guardada (${rec.tiles.length} ventana(s)).`);
    }
    if (!old) return c.print(`No existe la configuración "${name}".`);
    if (k === 'Suprimir') { doc.vportConfigs = doc.vportConfigs.filter(v => v !== old); doc.changed(); return c.print(`Configuración "${old.name}" suprimida.`); }
    app.setTiles(old.tiles, old.active || 0);
    return c.print(`Configuración "${old.name}" restituida.`);
  }
  if (k === 'Unir') {
    if (app.tiles.length < 2) return c.print('Sólo hay una ventana.');
    const pick = arg?.side || await c.app.ask('point', 'Designe la ventana que desea unir a la actual (o indique el lado)', { options: ['Izquierda', 'deRecha', 'ENcima', 'DEbajo'], pickTile: true, noSnap: true });
    const other = typeof pick === 'string' ? tileBeside(app, pick) : pick?.view ? pick : null;
    const a = app.activeTile(), r = other && other !== a ? joinTiles(a.r, other.r) : null;
    if (!r) return c.print('Las ventanas que se unen tienen que formar un rectángulo (compartir un lado entero).');
    app.setTiles(app.tiles.filter(t => t !== other).map(t => (t === a ? { ...tileItem(t), r } : tileItem(t))), app.tiles.filter(t => t !== other).indexOf(a));
    return c.print('Ventanas unidas.');
  }
  const n = +k, dir = arg?.dir || await askDir(n), a = app.activeTile();
  const parts = splitTile(a.r, n, dir);
  if ((a.r.x2 - a.r.x1) * app.vw / (n === 3 && /^(Vertical)$/.test(dir) ? 3 : 2) < 60 || (a.r.y2 - a.r.y1) * app.vh / (n === 3 && dir === 'Horizontal' ? 3 : 2) < 40) return c.print('La ventana actual es demasiado pequeña para dividirla.');
  const list = [], idx = app.tiles.indexOf(a);
  app.tiles.forEach((t, i) => { if (i === idx) for (const r of parts) list.push({ ...tileItem(t), r }); else list.push(tileItem(t)); });
  app.setTiles(list, idx);
  c.print(`Ventana dividida en ${n}${dir ? ` (${dir.toLowerCase()})` : ''}: ${app.tiles.length} ventanas en el modelo. Haga clic en una ventana para activarla.`);
}, { group: 'Vista', keepSel: true });

// ================= SELECCIÓN Y BÚSQUEDA =================
function setSelection(c, ids, append) {
  const app = c.app;
  if (!append) app.sel.clear();
  for (const id of ids) app.sel.add(id);
  app.selChanged();
  return app.sel.size;
}
def('QSELECT', ['SELECR', 'SELECCIONRAPIDA', 'SELRAPIDA'], 'Selección rápida: designa los objetos que cumplen una condición sobre sus propiedades', async (c, arg) => {
  const app = c.app, doc = c.doc;
  const q = arg || await app.ui.qselectDialog();
  if (!q) return;
  const pool = candidates(doc, q.scope === 'sel' ? [...app.sel] : null);
  const ids = qselect(pool, q);
  const n = setSelection(c, ids, q.append);
  c.print(`${ids.length} objeto(s) ${q.exclude ? 'excluidos de la condición' : 'cumplen la condición'} (${condText(q)}); ${n} designado(s).`);
}, { group: 'Utilidades', noTx: true });

def('FILTER', ['FI', 'FILTRO', 'FILTROS'], 'Filtros de selección: condiciones sobre las propiedades combinadas con Y / O, guardadas con nombre', async (c, arg) => {
  const app = c.app, doc = c.doc;
  let r = arg;
  if (!r) {
    for (;;) {
      r = await app.ui.filterDialog();
      if (!r) return;
      if (r.action === 'save') {
        const name = await app.ui.prompt('Guardar filtro', 'Nombre del filtro', r.filter.name || `Filtro${doc.selFilters.length + 1}`);
        if (name) { const old = findFilter(doc, name), f = { ...JSON.parse(JSON.stringify(r.filter)), name: old?.name || name }; if (old) Object.assign(old, f); else doc.selFilters.push(f); doc.changed(); app.ui.filterDraft = f; c.print(`Filtro "${f.name}" guardado (${f.conds.length} condición(es)).`); }
        continue;
      }
      if (r.action === 'delete') { const f = findFilter(doc, r.filter.name); if (f) { doc.selFilters = doc.selFilters.filter(x => x !== f); doc.changed(); c.print(`Filtro "${f.name}" eliminado.`); } continue; }
      break;
    }
  }
  const f = r.name ? findFilter(doc, r.name) : r.filter;
  if (!f) return c.print(`No existe el filtro "${r.name}".`);
  let ids = r.all ? null : await c.app.ask('select', 'Designe objetos a los que aplicar el filtro (Intro = todo el espacio actual)', { allowEnter: true });
  if (ids && !ids.length) ids = null;
  const out = applyFilter(candidates(doc, ids), f);
  setSelection(c, out, false);
  c.print(`Filtro${f.name ? ` "${f.name}"` : ''}: ${out.length} objeto(s) designado(s) (${f.conds.map(condText).join(f.join === 'or' ? ' O ' : ' Y ') || 'sin condiciones'}).`);
}, { group: 'Utilidades', keepSel: true });

// Objetos en que se busca: el espacio actual, todo el dibujo (modelo y presentaciones) o la designación actual
function findPool(c, where) {
  const doc = c.doc;
  if (where === 'sel') return [...c.app.sel].map(id => doc.get(id)).filter(Boolean);
  if (where === 'all') return [...doc.model, ...doc.layouts.flatMap(l => l.ents)];
  return doc.ents;
}
function spaceOf(doc, e) {
  if (doc.model.includes(e)) return 'model';
  const i = doc.layouts.findIndex(l => l.ents.includes(e));
  return i >= 0 ? i : null;
}
def('FIND', ['BUSCAR', 'REEMPLAZAR', 'BUSCARREEMPLAZAR'], 'Busca y reemplaza texto en textos, atributos, cotas, directrices y tablas', async (c, arg) => {
  const app = c.app, doc = c.doc;
  if (arg) { // por guion: {find, replace, where, opts, kinds}
    const res = findText(findPool(c, arg.where), arg.find, { ...arg.opts, kinds: arg.kinds });
    if (arg.replace == null) { setSelection(c, res.filter(r => doc.ents.includes(r.e)).map(r => r.e.id)); return c.print(`${res.length} coincidencia(s) de "${arg.find}".`); }
    const n = replaceText(doc, res, arg.find, arg.replace, arg.opts);
    return c.print(`${n} reemplazo(s) en ${res.length} texto(s).`);
  }
  const r = await app.ui.findDialog(findPool, spaceOf);
  if (r?.select?.length) { setSelection(c, r.select); c.print(`${r.select.length} objeto(s) designado(s).`); }
}, { group: 'Utilidades', keepSel: true });

// ================= LIMPIEZA Y COMPROBACIÓN =================
def('OVERKILL', ['SUPRDUPLICADOS', 'DUPLICADOS', 'SOLAPADOS'], 'Suprime objetos duplicados y combina líneas y arcos que se solapan; optimiza polilíneas', async (c, arg) => {
  const ids = await c.getSelection('Designe objetos (Intro = todo el espacio actual)', { allowEnter: true });
  const list = ids.length ? ids : c.doc.ents.filter(e => c.doc.visible(e) && !c.doc.locked(e)).map(e => e.id);
  const o = arg || await c.app.ui.overkillDialog({ ...OK_DEFAULTS, ...c.settings.overkill });
  if (!o) return;
  if (!arg) c.settings.overkill = o;
  const r = overkill(c.doc, list, o);
  c.print(`${r.dup} duplicado(s) suprimido(s), ${r.merged} objeto(s) solapado(s) o contiguo(s) combinado(s), ${r.verts} vértice(s) de polilínea eliminado(s).`);
}, { group: 'Utilidades', sel: true });

def('AUDIT', ['REVISAR', 'AUDITAR', 'COMPROBAR'], 'Comprueba la integridad del dibujo y corrige los errores', async (c, arg) => {
  const fix = (arg || await c.getKeyword('¿Corregir los errores detectados?', ['Sí', 'No'], 'No')) === 'Sí';
  const r = audit(c.doc, fix);
  for (const m of r.errors.slice(0, 60)) c.print(`  ${m}`);
  if (r.errors.length > 60) c.print(`  … y ${r.errors.length - 60} más.`);
  c.print(r.errors.length ? `${r.errors.length} error(es) encontrado(s), ${r.fixed} corregido(s).` : 'No se han encontrado errores.');
  if (r.errors.length) c.app.ui.showHistory(true);
  if (fix && r.fixed) c.app.afterUndo();
}, { group: 'Utilidades', fullUndo: true });

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

def('PAGESETUP', ['CONFIGPAG', 'PAGINA'], 'Tamaño de papel y tabla de estilos de trazado de la presentación actual (o del modelo)', async c => {
  if (c.app.tab === 'model') return c.app.ui.pageSetup(null);
  await c.app.ui.pageSetup(c.doc.layouts[c.app.tab]);
  c.app.zoomExtents();
}, { group: 'Presentación' });
def('STYLESMANAGER', ['ESTILOSTRAZADO', 'ADMINESTILOS', 'TABLASTRAZADO', 'CTB'], 'Crea, edita, importa y exporta tablas de estilos de trazado (.ctb y .stb)', async c => { await c.app.ui.plotStyleManager(); }, { group: 'Presentación', noTx: true });
// Estilo de trazado con nombre (tablas .stb) de objetos o de una capa
def('PLOTSTYLE', ['ESTILOTRAZADO', 'PSTYLE'], 'Asigna un estilo de trazado con nombre (tabla .stb) a objetos o a una capa', async c => {
  const t = activeStb(c.doc, c.app.layoutShown());
  if (!t) return c.print('Ninguna presentación usa una tabla de estilos con nombre (.stb). Elíjala en CONFIGPAG.');
  const names = stbNames(t);
  const k = await c.getKeyword('Asignar estilo de trazado a', ['Objetos', 'Capa'], 'Objetos');
  const ask = async def => {
    const v = (await c.getString(`Indique estilo de trazado (${['PorCapa', ...names].join(', ')})`, { spaces: true, def })).trim();
    const n = /^porcapa$/i.test(v) ? 'BYLAYER' : names.find(x => x.toLowerCase() === v.toLowerCase());
    if (!n) c.print(`El estilo "${v}" no existe en la tabla ${t.name}.`);
    return n;
  };
  if (k === 'Capa') {
    const name = (await c.getString('Indique nombre de la capa', { spaces: true, def: c.doc.cur.layer })).trim();
    const l = c.doc.layers.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!l) return c.print(`La capa "${name}" no existe.`);
    const n = await ask(l.pstyle || 'Normal');
    if (!n || n === 'BYLAYER') return;
    if (n === 'Normal') delete l.pstyle; else l.pstyle = n;
    c.doc.changed();
    return c.print(`Capa "${l.name}": estilo de trazado ${n}.`);
  }
  const ids = await c.getSelection();
  if (!ids.length) return;
  const n = await ask('PorCapa');
  if (!n) return;
  for (const id of ids) c.doc.modify(id, e => { if (n === 'BYLAYER') delete e.pstyle; else e.pstyle = n; });
  c.print(`${ids.length} objeto(s) con estilo de trazado ${n === 'BYLAYER' ? 'PorCapa' : n}.`);
}, { group: 'Presentación', sel: true });
def('PSLTSCALE', ['ESCALATLPAPEL'], 'Escala de los tipos de línea en las ventanas: 1 = igual tamaño en el papel con cualquier escala de ventana', async c => {
  const v = await c.getNumber('Indique valor nuevo para PSLTSCALE (0 o 1)', { def: c.settings.psltscale ? 1 : 0, int: true, min: 0, max: 1 });
  c.settings.psltscale = v; c.doc.changed();
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
// ---- Herramientas de capas ----
def('LAYISO', ['AISLARCAPA', 'AISLARCAPAS', 'CAPAISO'], 'Aísla las capas de los objetos designados: desactiva o bloquea las demás', async (c, arg) => {
  const doc = c.doc, S = c.settings;
  let ids = arg?.ids || (c.app.pickfirst ? await c.getSelection() : null);
  while (!ids) {
    const r = await c.app.ask('select', `Designe objetos en las capas que desea aislar (las demás se ${S.layIsoMode === 'lock' ? 'bloquean' : 'desactivan'})`, { options: ['Parámetros'] });
    if (r === 'Parámetros') { S.layIsoMode = (await c.getKeyword('Indique el modo para las demás capas', ['Desactivar', 'Bloquear'], S.layIsoMode === 'lock' ? 'Bloquear' : 'Desactivar')) === 'Bloquear' ? 'lock' : 'off'; continue; }
    ids = r;
  }
  const names = [...new Set(ids.map(id => doc.get(id)?.layer).filter(Boolean))];
  if (!names.length) return c.print('Ningún objeto designado.');
  const mode = arg?.mode || S.layIsoMode || 'off';
  layIso(doc, names, mode);
  c.print(`${names.length === 1 ? `La capa "${names[0]}" está aislada` : `Las capas ${names.map(n => `"${n}"`).join(', ')} están aisladas`}; las demás se han ${mode === 'lock' ? 'bloqueado' : 'desactivado'}. LAYUNISO las restaura.`);
}, { group: 'Propiedades', sel: true });
def('LAYUNISO', ['DESAISLARCAPA', 'DESAISLARCAPAS', 'CAPADESISO'], 'Restaura las capas como estaban antes del último LAYISO', async c => {
  const n = layUniso(c.doc);
  c.print(n < 0 ? 'No hay capas aisladas con LAYISO.' : `${n} capa(s) restaurada(s).`);
}, { group: 'Propiedades' });
def('LAYWALK', ['RECORRERCAPAS', 'RECORRECAPAS', 'PASEOCAPAS'], 'Recorre las capas: muestra sólo las elegidas en la lista y las restaura al salir', async (c, arg) => {
  const doc = c.doc, snap = doc.layers.map(l => [l, l.on]);
  const show = names => { const s = new Set(names); for (const l of doc.layers) l.on = s.has(l.name); doc.changed(); };
  let keep;
  if (arg) { show(arg.layers); keep = !!arg.keep; }
  else { const r = await c.app.ui.layWalk(show); keep = !!r?.keep; }
  if (!keep) { for (const [l, on] of snap) l.on = on; doc.changed(); c.print('Capas restauradas.'); }
  else c.print(`Estado de las capas conservado: ${doc.layers.filter(l => l.on).length} capa(s) activada(s).`);
}, { group: 'Propiedades', keepSel: true });
async function pickLayer(c, msg, allowEnter) {
  for (;;) {
    const r = await c.getEntity(msg, { options: ['Nombre'], allowEnter });
    if (r === null) return null;
    if (r === 'Nombre') {
      const n = (await c.getString('Indique nombre de capa', { spaces: true })).trim();
      const l = c.doc.layers.find(x => x.name.toLowerCase() === n.toLowerCase());
      if (l) return l.name;
      c.print(`La capa "${n}" no existe.`);
      continue;
    }
    return r.e.layer;
  }
}
def('LAYMRG', ['FUSIONARCAPAS', 'FUSIONCAPAS', 'UNIRCAPAS'], 'Fusiona capas: pasa sus objetos a una capa de destino y las elimina', async c => {
  const doc = c.doc, from = [];
  for (;;) {
    const l = await pickLayer(c, `Designe objeto en la capa que desea fusionar${from.length ? ' o Intro para terminar' : ''}`, from.length > 0);
    if (!l) break;
    if (l === '0') { c.print('La capa "0" no se puede fusionar con otra.'); continue; }
    if (!from.includes(l)) from.push(l);
    c.print(`Capas que se fusionan: ${from.join(', ')}`);
  }
  if (!from.length) return;
  const to = await pickLayer(c, 'Designe objeto en la capa de destino', false);
  const src = from.filter(n => n !== to);
  if (!src.length) return c.print('La capa de destino es la única designada.');
  if ((await c.getKeyword(`Se van a fusionar ${src.length} capa(s) en "${to}". ¿Desea continuar?`, ['Sí', 'No'], 'No')) !== 'Sí') return;
  const n = layMerge(doc, src, to);
  c.print(`${src.length} capa(s) fusionada(s) en "${to}" (${n} objeto(s) movidos).`);
}, { group: 'Propiedades' });
def('LAYFILTER', ['FILTROCAPAS', 'FILTROSCAPA'], 'Filtros de capa por propiedades y por grupos para la paleta de capas', async c => {
  await c.app.ui.layerFilterManager();
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
// Ctrl+clic sobre un pinzamiento: suprime el vértice interior; Ctrl+clic sobre el eje (i = -1): añade un vértice
def('_GRIPVERTEX', [], 'Edición de vértices de la línea múltiple por pinzamiento (Ctrl+clic)', async (c, g) => {
  let n = 0;
  for (const { id, i } of g.refs) {
    const m = c.doc.get(id);
    if (m?.type !== 'mline') continue;
    const x = cloneEnt(m), clos = !!x.closed && x.pts.length > 2;
    const interior = i >= 0 && (clos ? x.pts.length > 3 : i > 0 && i < x.pts.length - 1);
    if (i < 0 ? !mlAddVertex(x, g.pt) : !(interior && mlDelVertex(x, x.pts[i]))) continue;
    n++;
    c.doc.modify(id, e => { e.pts = x.pts; if (x.cuts) e.cuts = x.cuts; else delete e.cuts; });
  }
  c.print(n ? `${n} vértice(s) ${g.refs[0]?.i < 0 ? 'añadido(s)' : 'suprimido(s)'}.` : 'No se ha podido editar el vértice.');
}, { hidden: true, keepSel: true });


// ================= GEOGRAFÍA (v0.14) =================
def('GEOGRAPHICLOCATION', ['GEOUBICACION', 'GEORREFERENCIAR'], 'Sistema de coordenadas, referencia, unidades y norte del dibujo', async (c, arg) => {
  if (c.doc.space !== 'model' || c.doc.bedit) throw Error('Configure la ubicación desde el espacio modelo.');
  const value = arg || await c.app.ui.geographicDialog(); if (!value) return;
  const g = validateGeo(value); c.app.gps.stop(); c.doc.geo = g; c.doc.changed();
  c.print(`Georreferenciación: ${g.crs.name || g.crs.proj}; ${g.crs.axis === 'neu' ? 'X norte / Y este' : 'X este / Y norte'}.`);
}, { group: 'Geografía' });
def('-GEOGRAPHICLOCATION', ['-GEOUBICACION'], 'Configura la georreferenciación por línea de comandos', async c => {
  if (c.doc.space !== 'model' || c.doc.bedit) throw Error('Configure la ubicación desde el espacio modelo.');
  const crs = await c.getString('Sistema (EPSG:32721, definición PROJ o WKT)', { spaces: true, def: 'EPSG:3857' });
  const axis = await c.getKeyword('Orden de ejes del sistema', ['EsteNorte', 'NorteEste'], 'EsteNorte');
  const reference = await c.getPoint('Punto de referencia del dibujo (coordenadas reales)', { def: P(0, 0) });
  const x = await c.getNumber('Coordenada X de la referencia en el sistema', { def: 0 }), y = await c.getNumber('Coordenada Y de la referencia en el sistema', { def: 0 });
  const units = await c.getNumber('Unidades del sistema por unidad del dibujo', { min: 1e-12, def: 1 }), north = await c.getNumber('Giro al sistema (grados antihorarios)', { def: 0 });
  const definition = resolveCRS(crs); definition.axis = axis === 'NorteEste' ? 'neu' : 'enu';
  const g = validateGeo({ crs: definition, reference: ORG.toReal(c.doc, reference), projected: { x, y }, units, north });
  c.app.gps.stop(); c.doc.geo = g; c.doc.changed(); c.print('Ubicación geográfica guardada.');
}, { group: 'Geografía' });
def('GEOCS', ['SISTEMAGEO', 'EPSG'], 'Consulta el catálogo EPSG, importa .prj o quita la georreferenciación', async c => {
  const k = await c.getKeyword('Sistema de coordenadas', ['Catálogo', 'Importar', 'Quitar', 'Actual'], 'Actual');
  if (k === 'Catálogo') { for (const p of CATALOG) c.print(`EPSG:${p.code} · ${p.name}`); }
  else if (k === 'Importar') {
    const picked = await c.app.io.pickFile('Definición de coordenadas', ['.prj', '.wkt', '.txt']); if (!picked) return;
    const crs = resolveCRS(await picked.file.text()); c.doc.geo = validateGeo({ ...(c.doc.geo || {}), crs }); c.app.gps.stop(); c.doc.changed();
  } else if (k === 'Quitar') { c.app.gps.stop(); c.doc.geo = null; c.doc.basemap = null; c.doc.changed(); }
  else c.print(c.doc.geo ? JSON.stringify(c.doc.geo) : 'Dibujo sin georreferenciación.');
}, { group: 'Geografía' });
def('GEOFORMAT', ['FORMATOGEO'], 'Formato de latitud y longitud en la barra de estado e ID', async c => {
  if (!c.doc.geo) throw Error('Configure primero GEOGRAPHICLOCATION.');
  const k = await c.getKeyword('Formato geográfico', ['Decimal', 'Sexagesimal'], c.doc.geo.format === 'dms' ? 'Sexagesimal' : 'Decimal');
  c.doc.geo = { ...c.doc.geo, format: k === 'Sexagesimal' ? 'dms' : 'decimal' }; c.doc.changed();
}, { group: 'Geografía' });
def('GEOMAP', ['MAPABASE'], 'Configura un mapa XYZ, WMS o WMTS bajo el dibujo', async (c, arg) => {
  if (!c.doc.geo) throw Error('Configure primero GEOGRAPHICLOCATION.');
  const value = arg || await c.app.ui.basemapDialog(); if (!value) return;
  c.doc.basemap = validateMap(value); c.doc.changed(); c.app.basemap.warned = false;
  c.print(`Mapa ${c.doc.basemap.type}: ${c.doc.basemap.enabled ? 'activado' : 'oculto'}.`);
}, { group: 'Geografía' });
def('-GEOMAP', ['-MAPABASE'], 'Activa OpenStreetMap u oculta el mapa por línea de comandos', async c => {
  if (!c.doc.geo) throw Error('Configure primero GEOGRAPHICLOCATION.');
  const k = await c.getKeyword('Mapa base', ['OpenStreetMap', 'Activar', 'Desactivar'], 'OpenStreetMap');
  c.doc.basemap = k === 'OpenStreetMap' ? { ...OSM } : { ...(c.doc.basemap || OSM), enabled: k === 'Activar' }; c.doc.changed();
}, { group: 'Geografía' });
def('GEOMAPCACHE', ['CACHEMAPA'], 'Guarda la vista actual sin conexión o borra las teselas guardadas', async c => {
  const k = await c.getKeyword('Caché del mapa', ['Guardar', 'Borrar'], 'Guardar');
  if (k === 'Borrar') { await c.app.basemap.clear(); c.print('Caché de mapas borrada.'); }
  else { if (!c.doc.geo || !c.doc.basemap?.enabled) throw Error('Active un mapa georreferenciado.'); const n = await c.app.basemap.prepare(c.app.renderer.R()); c.print(`${n} teselas de la vista disponibles sin conexión (sujetas al almacenamiento del navegador).`); }
}, { noTx: true, group: 'Geografía' });
def('GEOPOSITION', ['GPS', 'POSICIONGPS'], 'Muestra la posición GPS, precisión y seguimiento sobre el plano', async c => {
  const k = await c.getKeyword('Posición del dispositivo', ['Mostrar', 'Seguir', 'Desactivar'], 'Mostrar');
  if (k === 'Desactivar') c.app.gps.stop(); else c.app.gps.start(k === 'Seguir');
  c.print(k === 'Desactivar' ? 'GPS desactivado.' : 'GPS activado; esperando posición y permiso del navegador.');
}, { noTx: true, group: 'Geografía' });

registerGIS(def);

registerGeoprocess(def);
