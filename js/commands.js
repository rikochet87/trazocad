// Comandos estilo AutoCAD. Cada comando es una función asíncrona que pide datos con el contexto `c`.
import * as G from './geom.js';
import { TYPES, cloneEnt, xformEnt, bboxOf, describe, fmt, dimParts, plArea, plLength, hatchArea, blockAttdefs } from './entities.js';
import { findBoundary, loopsOfEntity } from './hatch.js';
import { rebuild as rebuildSpline, splinePts } from './spline.js';
import * as OPS from './ops.js';
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
}
// Un sombreado copiado junto con su contorno queda asociado a las copias; copiado solo, deja de ser asociativo
function remapAssoc(ents, map) {
  for (const n of ents) {
    if (!n.assoc) continue;
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

def('POINT', ['PO', 'PUNTO'], 'Crea objetos punto', async c => {
  for (;;) {
    const p = await c.getPoint('Precise un punto', { allowEnter: true });
    if (!p) break;
    c.add({ type: 'point', p });
  }
}, { group: 'Dibujo' });

def('HATCH', ['H', 'BH', 'SOMBCONT', 'SOMBREADO'], 'Rellena un área cerrada con un patrón de sombreado', async c => {
  const S = c.settings, made = [];
  for (;;) {
    const r = await c.getPoint(`Designe punto interno [${S.hatchPat}, escala ${S.hatchScale}, ${S.hatchAng}°, ${S.hatchAssoc ? 'asociativo' : 'no asociativo'}]`, { options: ['Seleccionar objetos', 'Patrón', 'Escala', 'Ángulo', 'asOciativo', 'desHacer'], allowEnter: true, noSnap: true });
    if (r === null) break;
    if (r === 'asOciativo') { S.hatchAssoc = !S.hatchAssoc; c.print(S.hatchAssoc ? 'Los sombreados nuevos se actualizarán al modificar su contorno.' : 'Los sombreados nuevos no serán asociativos.'); continue; }
    if (r === 'Patrón') { const p = await c.app.ui.pickPattern(S.hatchPat); if (p) S.hatchPat = p; continue; }
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
    const e = c.add({ type: 'hatch', loops: [...loops], pattern: S.hatchPat, scale: S.hatchScale, angle: S.hatchAng });
    if (S.hatchAssoc && assoc?.length) { e.assoc = assoc; if (seed) e.seed = seed; }
    sendToBack(c, e);
    made.push(e.id);
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
  const text = await c.app.ui.editMText('', 'Texto de líneas múltiples');
  if (!text) return;
  c.add({ type: 'mtext', p, w: w > 1e-9 ? w : 0, h, rot, attach, text });
}, { group: 'Anotación' });

async function dimAsk(c, kind) {
  const p1 = await c.getPoint('Precise origen de la primera línea de referencia');
  const p2 = await c.getPoint('Precise origen de la segunda línea de referencia', { base: p1 });
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
    const e = c.add(mk(p3));
    c.print(`Texto de cota = ${dimParts(e).text.str}`);
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
  const e = c.add(mk(p));
  c.print(`Texto de cota = ${dimParts(e).text.str}`);
}
def('DIMRADIUS', ['DRA', 'COTARADIO', 'ACORADIO'], 'Cota de radio', c => dimCircle(c, 'rad'), { group: 'Anotación' });
def('DIMDIAMETER', ['DDI', 'COTADIAMETRO', 'ACODIAMETRO'], 'Cota de diámetro', c => dimCircle(c, 'dia'), { group: 'Anotación' });
def('DIMANGULAR', ['DAN', 'COTAANGULAR', 'ACOANGULO'], 'Cota angular entre dos líneas, de un arco o por tres puntos', async c => {
  const o = await c.getEntity('Designe arco, círculo o línea, o INTRO para precisar vértice', { allowEnter: true, filter: e => ['line', 'arc', 'circle'].includes(e.type) });
  let base;
  if (!o) {
    const cen = await c.getPoint('Precise vértice del ángulo');
    const p1 = await c.getPoint('Precise primer punto final del ángulo', { base: cen });
    const p2 = await c.getPoint('Precise segundo punto final del ángulo', { base: cen });
    base = { c: cen, p1, p2 };
  } else if (o.e.type === 'arc') {
    const e = o.e;
    base = { c: e.c, p1: G.polar(e.c, e.a1, e.r), p2: G.polar(e.c, e.a2, e.r) };
  } else if (o.e.type === 'circle') {
    const e = o.e, p2 = await c.getPoint('Precise segundo punto final del ángulo', { base: e.c });
    base = { c: e.c, p1: G.polar(e.c, G.ang(e.c, o.pt), e.r), p2 };
  } else {
    const o2 = await c.getEntity('Designe segunda línea', { filter: e => e.type === 'line' && e.id !== o.e.id });
    const l1 = [o.e.p1, o.e.p2], l2 = [o2.e.p1, o2.e.p2], X = G.llInt(l1[0], l1[1], l2[0], l2[1]);
    if (!X) return c.print('Las líneas son paralelas.');
    const far = l => (G.dist(l[0], X.p) > G.dist(l[1], X.p) ? l[0] : l[1]);
    base = { c: X.p, p1: far(l1), p2: far(l2), l1, l2 };
  }
  if (G.dist(base.c, base.p1) < 1e-12 || G.dist(base.c, base.p2) < 1e-12) return c.print('Ángulo no válido.');
  let text = '';
  const mk = p3 => ({ type: 'dim', kind: 'ang', ...base, p3, text, style: c.doc.cur.dimStyle });
  for (;;) {
    const p3 = await c.getPoint('Precise ubicación del arco de cota', { options: ['Texto'], preview: p => [mk(p)], rubber: false });
    if (p3 === 'Texto') { text = await c.getString('Indique texto de cota (<> = medida)', { spaces: true, def: '<>' }); continue; }
    const e = c.add(mk(p3));
    c.print(`Texto de cota = ${dimParts(e).text.str}`);
    return;
  }
}, { group: 'Anotación' });

def('DIMORDINATE', ['DOR', 'COTACOORD', 'ACOCOORDENADA'], 'Cota de la coordenada X o Y de un punto', async c => {
  const f = await c.getPoint('Precise ubicación de punto');
  let axis = null, text = '';
  const mk = q => ({ type: 'dim', kind: 'ord', p1: f, p2: f, p3: q, ...(axis ? { axis } : {}), text, style: c.doc.cur.dimStyle });
  for (;;) {
    const q = await c.getPoint('Precise punto final de directriz', { base: f, options: ['Xdato', 'Ydato', 'Texto'], preview: p => [mk(p)], rubber: false });
    if (q === 'Xdato') { axis = 'x'; continue; }
    if (q === 'Ydato') { axis = 'y'; continue; }
    if (q === 'Texto') { text = await c.getString('Indique texto de cota (<> = medida)', { spaces: true, def: '<>' }); continue; }
    const n = mk(q);
    n.axis = dimParts(n).axis;
    const e = c.add(n);
    c.print(`Texto de cota = ${dimParts(e).text.str}`);
    return;
  }
}, { group: 'Anotación' });

def('STYLE', ['ST', 'ESTILO'], 'Administra los estilos de texto', async c => { await c.app.ui.textStyleManager(); }, { group: 'Anotación' });
def('DIMSTYLE', ['D', 'DST', 'ACOESTIL', 'ESTILOCOTA'], 'Administra los estilos de cota', async c => { await c.app.ui.dimStyleManager(); }, { group: 'Anotación' });

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
  if (!Object.keys(c.doc.blocks).some(n => !n.startsWith('*'))) return c.print('No hay bloques definidos. Cree uno con BLOQUE.');
  const name = arg || await c.app.ui.pickBlock();
  if (!name || !c.doc.blocks[name]) return;
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
    c.add(ins);
    return;
  }
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
    if (!['line', 'circle', 'arc', 'pline'].includes(o.e.type)) { c.print('No se puede desfasar ese objeto.'); continue; }
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

const breakable = e => ['line', 'arc', 'circle', 'pline'].includes(e.type);
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

def('ARRAYRECT', ['AR', 'MATRIZ', 'MATRIZRECT', 'ARRAY'], 'Matriz rectangular de objetos', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const b = c.doc.extents(ids.map(id => c.doc.get(id)));
  const rows = await c.getNumber('Indique número de filas', { def: 3, int: true, min: 1, max: 1000 });
  const cols = await c.getNumber('Indique número de columnas', { def: 4, int: true, min: 1, max: 1000 });
  const dy = rows > 1 ? await c.getDistance('Precise distancia entre filas', { def: +((b.y2 - b.y1) * 1.5 || 10).toFixed(4) }) : 0;
  const dx = cols > 1 ? await c.getDistance('Precise distancia entre columnas', { def: +((b.x2 - b.x1) * 1.5 || 10).toFixed(4) }) : 0;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (i || j) applyX(c, ids, Mx.T(j * dx, i * dy), true);
}, { group: 'Modificar', sel: true });

def('ARRAYPOLAR', ['ARP', 'MATRIZPOLAR'], 'Matriz polar de objetos alrededor de un centro', async c => {
  const ids = await c.getSelection();
  if (!ids.length) return;
  const cen = await c.getPoint('Precise punto central de la matriz');
  const n = await c.getNumber('Indique número de elementos', { def: 6, int: true, min: 2, max: 1000 });
  const fill = await c.getNumber('Precise ángulo a rellenar (+=antihorario)', { def: 360 });
  const step = Math.abs(Math.abs(fill) - 360) < 1e-9 ? G.rad(fill) / n : G.rad(fill) / (n - 1);
  for (let k = 1; k < n; k++) applyX(c, ids, Mx.R(k * step, cen), true);
}, { group: 'Modificar', sel: true });

def('EXPLODE', ['X', 'DESCOMP'], 'Descompone polilíneas, cotas, bloques y sombreados', async c => {
  const ids = await c.getSelection();
  let n = 0;
  for (const id of ids) {
    const parts = OPS.explodeEntity(c.doc.get(id));
    if (!parts) continue;
    c.doc.remove(id); parts.forEach(p => c.doc.add(p)); n++;
  }
  c.print(n ? `${n} objeto(s) descompuesto(s).` : 'Ningún objeto se puede descomponer.');
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
    if (e.type === o.e.type && ['text', 'mtext', 'attdef', 'dim'].includes(e.type) && o.e.style) e.style = o.e.style;
    if (e.type === 'hatch' && o.e.type === 'hatch') Object.assign(e, { pattern: o.e.pattern, scale: o.e.scale, angle: o.e.angle });
  });
}, { group: 'Propiedades' });

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
    const o = await c.getEntity('Designe objeto', { filter: e => ['circle', 'pline', 'ellipse', 'hatch'].includes(e.type) || (e.type === 'spline' && e.closed) });
    const e = o.e;
    if (e.type === 'circle') { area = Math.PI * e.r ** 2; per = G.TAU * e.r; }
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
    for (const name of Object.keys(doc.blocks)) if (!doc.blockInUse(name)) { delete doc.blocks[name]; nb++; changed = true; }
  }
  const all = [...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)];
  const usedL = new Set(['0', doc.cur.layer, ...all.map(e => e.layer)]);
  const nl = doc.layers.length;
  doc.layers = doc.layers.filter(l => usedL.has(l.name));
  const usedD = new Set([doc.cur.dimStyle, ...all.filter(e => e.type === 'dim').map(e => e.style)]);
  const nd = doc.dimStyles.length;
  doc.dimStyles = doc.dimStyles.filter((s, i) => !i || usedD.has(s.name));
  const usedT = new Set(['Standard', doc.cur.textStyle, ...all.filter(e => ['text', 'mtext', 'attdef'].includes(e.type)).map(e => e.style), ...doc.dimStyles.map(s => s.textStyle)]);
  const nt = doc.textStyles.length;
  doc.textStyles = doc.textStyles.filter(s => usedT.has(s.name));
  doc.changed();
  c.print(`Limpiado: ${nb} bloque(s), ${nl - doc.layers.length} capa(s), ${nt - doc.textStyles.length} estilo(s) de texto, ${nd - doc.dimStyles.length} estilo(s) de cota.`);
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

// ================= EDICIÓN / ARCHIVO =================
def('UNDO', ['U', 'DESHACER'], 'Deshace la última operación', async c => { c.print(c.doc.undo() ? 'Deshacer: operación anulada.' : 'No hay nada que deshacer.'); c.app.clearSel(); c.app.afterUndo(); }, { noTx: true, group: 'Edición' });
def('REDO', ['REHACER'], 'Rehace la operación deshecha', async c => { c.print(c.doc.redo() ? 'Rehacer: operación restaurada.' : 'No hay nada que rehacer.'); c.app.clearSel(); c.app.afterUndo(); }, { noTx: true, group: 'Edición' });

function collectBlocks(doc, ents, out = {}) {
  for (const e of ents) if (e.type === 'insert' && doc.blocks[e.name] && !out[e.name]) { out[e.name] = doc.blocks[e.name]; collectBlocks(doc, doc.blocks[e.name].ents, out); }
  return out;
}
def('COPYCLIP', ['COPIARPORTAPAPELES'], 'Copia los objetos al portapapeles', async c => {
  const ids = await c.getSelection();
  const ents = ids.map(id => cloneEnt(c.doc.get(id)));
  c.app.clipboard = { ents, blocks: JSON.parse(JSON.stringify(collectBlocks(c.doc, ents))) };
  try { localStorage.setItem('trazocad.clip', JSON.stringify(c.app.clipboard)); } catch { /* sin almacenamiento */ }
  c.print(`${ids.length} objeto(s) copiado(s) al portapapeles.`);
}, { sel: true, noTx: true, group: 'Edición' });

def('PASTECLIP', ['PEGARPORTAPAPELES'], 'Pega objetos del portapapeles', async c => {
  let clip = c.app.clipboard;
  if (!clip?.ents?.length) { try { clip = JSON.parse(localStorage.getItem('trazocad.clip') || 'null'); } catch { clip = null; } }
  if (Array.isArray(clip)) clip = { ents: clip, blocks: {} };
  if (!clip?.ents?.length) return c.print('El portapapeles está vacío.');
  for (const [name, b] of Object.entries(clip.blocks || {})) if (!c.doc.blocks[name]) c.doc.defineBlock(name, b.base, b.ents);
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
}, { group: 'Edición' });

def('SELECTALL', ['TODO', 'SELTODO'], 'Selecciona todos los objetos', async c => { c.app.selectAll(); }, { noTx: true, group: 'Edición' });

def('LAYER', ['LA', 'CAPA'], 'Administra las capas', async c => { c.app.ui.showPalette('layers'); }, { noTx: true, group: 'Propiedades' });
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
def('DXFOUT', ['EXPORTARDXF', 'DXF'], 'Exporta el espacio modelo a DXF (2000 o R12)', async (c, arg) => {
  const v = arg || await c.app.ask('keyword', 'Versión de DXF', { options: ['2000', 'R12'], def: '2000' });
  await c.app.io.exportDXF(v === 'R12' ? 'R12' : '2000');
}, { noTx: true, group: 'Archivo' });
def('SVGOUT', ['EXPORTARSVG', 'SVG'], 'Exporta el modelo o la presentación a SVG', async c => { await c.app.io.exportSVG(); }, { noTx: true, group: 'Archivo' });
def('PNGOUT', ['EXPORTARPNG', 'PNG'], 'Exporta el modelo o la presentación a PNG', async c => { await c.app.io.exportPNG(); }, { noTx: true, group: 'Archivo' });
def('PLOT', ['PRINT', 'IMPRIMIR', 'TRAZAR'], 'Imprime el modelo o la presentación (a escala en presentaciones)', async c => { await c.app.io.print(); }, { noTx: true, group: 'Archivo' });

// ================= INTERNOS =================
def('_GRIP', [], 'Edición por pinzamientos', async (c, g) => {
  const prev = p => g.refs.map(({ id, i }) => { const e = cloneEnt(c.doc.get(id)); TYPES[e.type].moveGrip(e, i, p); return e; });
  const pt = await c.getPoint('** ESTIRAR ** Precise punto de estiramiento', { base: g.pt, hot: g.pt, gripCmd: true, preview: prev });
  for (const { id, i } of g.refs) c.doc.modify(id, e => TYPES[e.type].moveGrip(e, i, pt));
}, { hidden: true, keepSel: true });

