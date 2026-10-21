// Tipos de entidad: geometría, referencias, pinzamientos, transformaciones y propiedades.
import * as G from './geom.js';
import { PATTERNS, famsOf, famLines, gradientSpec, GRADIENTS, GRAD_DEFAULT, USER_DEFAULT } from './patterns.js';
import { splinePts, rebuild as rebuildSpline } from './spline.js';
import { parseRich, baseFmt, richPlain } from './richtext.js';
import { mlineGeom, mlinePrims, mlStyleOf, ML_JUST, reverseCuts } from './mline.js';
import { clipActive, clipKeeps, clipPrims } from './xclip.js';
const { P, Mx, TAU } = G;

export const ENV = { doc: null, layout: null };
const D = () => ENV.doc;

export const TXT_K = 1.4; // px de fuente por unidad de altura de mayúscula
export const FONT = 'Arial, Helvetica, sans-serif';
export const FONTS = ['Arial', 'Arial Narrow', 'Helvetica', 'Verdana', 'Tahoma', 'Segoe UI', 'Trebuchet MS', 'Times New Roman', 'Georgia', 'Courier New', 'Consolas', 'monospace'];
const mctx = document.createElement('canvas').getContext('2d');
const fontCss = (style, px) => `${px}px "${style.font}", ${FONT}`;
const styleOf = name => (D()?.textStyle ? D().textStyle(name) : { font: 'Arial', width: 1, oblique: 0 });
export function textWidth(str, h, style) {
  const st = styleOf(style);
  mctx.font = fontCss(st, 100);
  return mctx.measureText(str).width / 100 * h * TXT_K * (st.width || 1);
}

export const LTYPES = {
  CONTINUOUS: { desc: 'Continua', pat: [] },
  DASHED: { desc: 'Trazos', pat: [12.7, -6.35] },
  HIDDEN: { desc: 'Oculta', pat: [6.35, -3.175] },
  CENTER: { desc: 'Centro', pat: [31.75, -6.35, 6.35, -6.35] },
  PHANTOM: { desc: 'Fantasma', pat: [31.75, -6.35, 6.35, -6.35, 6.35, -6.35] },
  DASHDOT: { desc: 'Trazo y punto', pat: [12.7, -6.35, 0, -6.35] },
  DOT: { desc: 'Puntos', pat: [0, -6.35] },
};
export const LWEIGHTS = [0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11];
export const STD_SCALES = [['1:1', 1], ['1:2', 0.5], ['1:5', 0.2], ['1:10', 0.1], ['1:20', 0.05], ['1:25', 0.04], ['1:50', 0.02], ['1:100', 0.01], ['1:200', 0.005], ['1:500', 0.002], ['1:1000', 0.001], ['2:1', 2], ['5:1', 5], ['10:1', 10]];
export const ARROWS = { closed: 'Cerrada rellena', open: 'Abierta', tick: 'Trazo oblicuo', dot: 'Punto', none: 'Ninguna' };

export { aciToHex, hexToAci } from './colors.js';
export const COLORS = [
  ['#ff0000', 'Rojo'], ['#ffff00', 'Amarillo'], ['#00ff00', 'Verde'], ['#00ffff', 'Cian'],
  ['#0000ff', 'Azul'], ['#ff00ff', 'Magenta'], ['#ffffff', 'Blanco'], ['#808080', 'Gris'], ['#c0c0c0', 'Gris claro'],
];

// ---------- Utilidades ----------
export function bbPts(pts) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { if (p.x < x1) x1 = p.x; if (p.y < y1) y1 = p.y; if (p.x > x2) x2 = p.x; if (p.y > y2) y2 = p.y; }
  return { x1, y1, x2, y2 };
}
export const bbUnion = (a, b) => (!a ? b : !b ? a : { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) });
export function arcBB(c, r, a1, a2) {
  const pts = [G.polar(c, a1, r), G.polar(c, a2, r)];
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; if (G.angIn(a, a1, a2)) pts.push(G.polar(c, a, r)); }
  return bbPts(pts);
}
const primBBox = q => (q.k === 's' ? bbPts([q.a, q.b]) : arcBB(q.c, q.r, q.a1, q.a2));
const closedSegs = pts => pts.map((p, i) => ({ k: 's', a: p, b: pts[(i + 1) % pts.length] }));
export function ellPts(e, n = 96) {
  const co = Math.cos(e.rot), si = Math.sin(e.rot), pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * TAU, x = e.rx * Math.cos(t), y = e.ry * Math.sin(t);
    pts.push(P(e.c.x + x * co - y * si, e.c.y + x * si + y * co));
  }
  return pts;
}
export const fmt = (v, d = 2) => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(d);

// ---------- Polilíneas con arcos (curvatura DXF) ----------
export function plPieces(e) {
  const n = e.pts.length, closed = e.closed && n > 2, cnt = closed ? n : n - 1, out = [];
  for (let i = 0; i < cnt; i++) {
    const a = e.pts[i], b = e.pts[(i + 1) % n], bu = (e.bulges && e.bulges[i]) || 0;
    if (Math.abs(bu) > 1e-9 && G.dist(a, b) > 1e-12) out.push({ a, b, bulge: bu, prim: { k: 'a', ...G.bulgeArc(a, b, bu) } });
    else out.push({ a, b, bulge: 0, prim: { k: 's', a, b } });
  }
  return out;
}
export const plSegs = e => plPieces(e).map(p => p.prim);
export function pieceAt(pc, t) {
  if (!pc.bulge) return G.lerp(pc.a, pc.b, t);
  const th = 4 * Math.atan(pc.bulge), c = pc.prim.c;
  return G.polar(c, G.ang(c, pc.a) + th * t, pc.prim.r);
}
export function pieceParam(pc, p) {
  if (!pc.bulge) return G.nearSeg(p, pc.a, pc.b).t;
  const th = 4 * Math.atan(pc.bulge), c = pc.prim.c, s = G.ang(c, pc.a), ap = G.ang(c, p);
  const t = th > 0 ? G.normAng(ap - s) / th : G.normAng(s - ap) / -th;
  if (t <= 1 + 1e-9) return Math.min(1, t);
  return G.dist(p, pc.a) < G.dist(p, pc.b) ? 0 : 1;
}
export const pieceLen = pc => (pc.bulge ? pc.prim.r * Math.abs(4 * Math.atan(pc.bulge)) : G.dist(pc.a, pc.b));
export const plLength = e => plPieces(e).reduce((s, pc) => s + pieceLen(pc), 0);
export function plArea(e) {
  let a = G.polyArea(e.pts);
  for (const pc of plPieces(e)) if (pc.bulge) { const th = Math.abs(4 * Math.atan(pc.bulge)), r = pc.prim.r; a += Math.sign(pc.bulge) * r * r / 2 * (th - Math.sin(th)); }
  return a;
}
// Contorno de polilínea con los arcos discretizados
export function plPolygon(e, perCircle = 96) {
  const out = [];
  for (const pc of plPieces(e)) {
    out.push(pc.a);
    if (pc.bulge) {
      const n = Math.max(2, Math.ceil(Math.abs(4 * Math.atan(pc.bulge)) / TAU * perCircle));
      for (let k = 1; k < n; k++) out.push(pieceAt(pc, k / n));
    }
  }
  if (!(e.closed && e.pts.length > 2)) out.push(e.pts[e.pts.length - 1]);
  return out;
}

// ---------- Campos ----------
// Códigos dentro de los textos que se sustituyen al dibujar: %<Fecha>%, %<Fecha:formato>%, %<Archivo>%, %<Presentación>%,
// %<Escala>%, %<Autor>%, %<Obj:id:Propiedad:decimales>%. ENV.layout: presentación que se está dibujando (si no, la activa).
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DATE_FORMATS = ['dd/MM/yyyy', "d 'de' MMMM 'de' yyyy", 'yyyy-MM-dd', 'dd/MM/yyyy HH:mm', 'MMMM yyyy'];
export function formatDate(d, f) {
  const pad = n => String(n).padStart(2, '0');
  return f.split(/('[^']*')/).map(part => (part.startsWith("'") ? part.slice(1, -1) : part.replace(/yyyy|yy|MMMM|MM|dd|d|HH|mm/g, t => ({
    yyyy: d.getFullYear(), yy: pad(d.getFullYear() % 100), MMMM: MONTHS[d.getMonth()], MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), d: d.getDate(), HH: pad(d.getHours()), mm: pad(d.getMinutes()),
  })[t]))).join('');
}
// Propiedades de objeto disponibles en campos: nombre → función (null si no se aplica a la entidad)
export const FIELD_PROPS = {
  'Área': e => ({ circle: () => Math.PI * e.r * e.r, ellipse: () => Math.PI * e.rx * e.ry, pline: () => (e.closed ? Math.abs(plArea(e)) : null), hatch: () => hatchArea(e), spline: () => (e.closed ? Math.abs(G.polyArea(splinePts(e))) : null), region: () => Math.abs(regArea(e)) })[e.type]?.() ?? null,
  'Longitud': e => ({ line: () => G.dist(e.p1, e.p2), arc: () => e.r * G.sweep(e.a1, e.a2), circle: () => TAU * e.r, pline: () => plLength(e), spline: () => G.polyLen(splinePts(e), e.closed), mline: () => mlLen(e) })[e.type]?.() ?? null,
  'Radio': e => (e.type === 'circle' || e.type === 'arc' ? e.r : null),
  'Diámetro': e => (e.type === 'circle' || e.type === 'arc' ? 2 * e.r : null),
  'Medida': e => (e.type === 'dim' ? dimParts(e).val : null),
  'Ángulo': e => (e.type === 'line' ? G.deg(G.normAng(G.ang(e.p1, e.p2))) : e.rot != null ? G.deg(G.normAng(e.rot)) : null),
  'X': e => (e.p || e.c || e.p1)?.x ?? null,
  'Y': e => (e.p || e.c || e.p1)?.y ?? null,
};
export function fieldValue(code) {
  const doc = D(), [kind, ...args] = code.split(':');
  const lay = ENV.layout || (doc && doc.space !== 'model' && doc.space !== 'bedit' ? doc.layouts[doc.space] : null);
  switch (kind.trim()) {
    case 'Fecha': return formatDate(new Date(), args.join(':') || 'dd/MM/yyyy');
    case 'Archivo': return doc?.name || '';
    case 'Presentación': return lay ? lay.name : 'Modelo';
    case 'Autor': return doc?.settings.author || '';
    case 'Escala': { const vp = lay?.ents.find(x => x.type === 'vport'); return vp ? scaleLabel(vp.s) : '—'; }
    case 'Obj': {
      const e = doc?.get(+args[0]), fn = FIELD_PROPS[args[1]];
      const v = e && fn ? fn(e) : null;
      return v == null ? '####' : fmt(v, args[2] === undefined ? 2 : +args[2]);
    }
  }
  return '####';
}
const FIELD_RE = /%<([^%<>]*)>%/g;
// Texto con los campos evaluados (rich: el valor se escapa para los códigos de formato de MTEXT)
export function fieldText(s, rich = false) {
  if (typeof s !== 'string' || !s.includes('%<')) return s;
  return s.replace(FIELD_RE, (m, code) => { const v = fieldValue(code); return rich ? v.replace(/[\\{}]/g, x => '\\' + x) : v; });
}
export const fieldsKey = cells => cells.flat().filter(s => typeof s === 'string' && s.includes('%<')).map(s => fieldText(s)).join('|');

// ---------- Texto ----------
export function textBox(t) {
  const str = fieldText(t.text ?? t.str), w = textWidth(str, t.h, t.style);
  const x0 = t.align === 'c' ? -w / 2 : t.align === 'r' ? -w : 0;
  return [P(x0, -0.25 * t.h), P(x0 + w, -0.25 * t.h), P(x0 + w, 1.1 * t.h), P(x0, 1.1 * t.h)]
    .map(q => G.add(t.p, G.rot(q, t.rot || 0)));
}

export function drawText(c, R, t) {
  const px = t.h * R.scale * TXT_K;
  if (px < 0.8) return;
  const st = styleOf(t.style), s = R.toScreen(t.p);
  c.save();
  c.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  c.translate(s.x, s.y);
  c.rotate(-(t.rot || 0));
  if (st.oblique) c.transform(1, 0, -Math.tan(G.rad(st.oblique)), 1, 0, 0);
  if (st.width && st.width !== 1) c.scale(st.width, 1);
  c.font = fontCss(st, px);
  c.textAlign = t.align === 'c' ? 'center' : t.align === 'r' ? 'right' : 'left';
  c.textBaseline = 'alphabetic';
  c.fillText(fieldText(t.text ?? t.str), 0, 0);
  c.restore();
}

// ---------- Cotas ----------
export const DEFAULT_DIMSTYLE = { name: 'ISO-25', txt: 2.5, asz: 2.5, exo: 0.625, exe: 1.25, gap: 0.625, dec: 2, adec: 0, dli: 3.75, scale: 1, arrow: 'closed', textStyle: 'Standard', suffix: '' };
const dimStyleOf = e => (D()?.dimStyle ? D().dimStyle(e.style) : DEFAULT_DIMSTYLE);

// Punta de flecha en tip, apuntando hacia fuera de dirIn (vector unitario hacia el interior de la línea)
export function arrowHead(kind, tip, dirIn, asz, lines, arrows, dots) {
  const b = G.add(tip, G.mul(dirIn, asz)), pn = G.perp(dirIn), w = asz / 6;
  switch (kind) {
    case 'open': lines.push([tip, G.add(b, G.mul(pn, asz / 3))], [tip, G.add(b, G.mul(pn, -asz / 3))]); break;
    case 'tick': { const v = G.mul(G.rot(dirIn, Math.PI / 4), asz / 2); lines.push([G.sub(tip, v), G.add(tip, v)]); break; }
    case 'dot': dots.push([tip, asz / 4]); break;
    case 'none': break;
    default: arrows.push([tip, G.add(b, G.mul(pn, w)), G.add(b, G.mul(pn, -w))]);
  }
}

function dimPartsBase(e) {
  const ds = dimStyleOf(e), k = ds.scale || 1;
  const asz = ds.asz * k, h = ds.txt * k, gap = ds.gap * k, exo = ds.exo * k, exe = ds.exe * k;
  const lines = [], arrows = [], dots = [], arcs = [];
  const arrow = (tip, dirIn) => arrowHead(ds.arrow, tip, dirIn, asz, lines, arrows, dots);
  const num = v => fmt(v, ds.dec) + (ds.suffix || '');
  const label = v => (e.text ? fieldText(e.text).replace('<>', v) : v);
  if (e.kind === 'ang') {
    // Vértice c; p1 y p2 sobre los dos lados; p3 sitúa el arco y elige el sector que se acota.
    // Con l1/l2 (dos líneas) los lados son rectas completas: hay cuatro sectores posibles.
    const c = e.c, R = Math.max(G.dist(c, e.p3), 1e-9), ap = G.ang(c, e.p3), a1 = G.ang(c, e.p1), a2 = G.ang(c, e.p2);
    let s = a1, t = a2;
    if (e.l1) {
      const rays = [a1, a1 + Math.PI, a2, a2 + Math.PI].map(G.normAng).sort((x, y) => x - y);
      for (let i = 0; i < 4; i++) { const lo = rays[i], hi = rays[(i + 1) % 4]; if (G.angIn(ap, lo, hi)) { s = lo; t = hi; break; } }
    } else if (!G.angIn(ap, a1, a2)) { s = a2; t = a1; }
    const sw = G.sweep(s, t);
    // Línea de referencia a lo largo de un lado, sólo si el arco no toca la geometría acotada
    const ext = (th, seg, org) => {
      const u = P(Math.cos(th), Math.sin(th));
      let lo, hi;
      if (seg) {
        const t1 = G.dot(G.sub(seg[0], c), u), t2 = G.dot(G.sub(seg[1], c), u);
        hi = Math.max(t1, t2); lo = Math.max(0, Math.min(t1, t2));
        if (hi < 0) lo = hi = 0;
      } else lo = hi = Math.max(0, G.dot(G.sub(org, c), u));
      if (R >= lo - 1e-9 && R <= hi + 1e-9) return;
      if (R > hi) lines.push([G.add(c, G.mul(u, hi + exo)), G.add(c, G.mul(u, R + exe))]);
      else lines.push([G.add(c, G.mul(u, lo - exo)), G.add(c, G.mul(u, R - exe))]);
    };
    for (const th of [s, t]) {
      const first = Math.abs(Math.sin(th - a1)) < 1e-9;
      ext(th, e.l1 ? (first ? e.l1 : e.l2) : null, first ? e.p1 : e.p2);
    }
    arcs.push([c, R, s, t]);
    arrow(G.polar(c, s, R), P(-Math.sin(s), Math.cos(s)));
    arrow(G.polar(c, t, R), P(Math.sin(t), -Math.cos(t)));
    const am = s + sw / 2;
    let ta = Math.atan2(Math.sin(am - Math.PI / 2), Math.cos(am - Math.PI / 2)), flip = false;
    if (ta > Math.PI / 2 + 1e-9) { ta -= Math.PI; flip = true; } else if (ta <= -Math.PI / 2 + 1e-9) { ta += Math.PI; flip = true; }
    const val = G.deg(sw);
    return { lines, arrows, dots, arcs, val, text: { p: G.polar(c, am, R + gap + (flip ? h : 0)), rot: ta, h, str: label(fmt(val, ds.adec ?? 0) + '°'), align: 'c', style: ds.textStyle } };
  }
  if (e.kind === 'ord') {
    // Cota de coordenadas: directriz desde el punto p1 hasta p3. Directriz horizontal → cota Y; vertical → cota X.
    const f = e.p1, q = e.p3, axis = e.axis || (Math.abs(q.x - f.x) >= Math.abs(q.y - f.y) ? 'y' : 'x');
    const val = axis === 'x' ? f.x : f.y;
    const sw = axis === 'x' ? (p => P(p.y, p.x)) : (p => p); // trabaja siempre como si la directriz fuera horizontal
    const F = sw(f), Q = sw(q), s = Math.sign(Q.x - F.x) || 1, L = Math.abs(Q.x - F.x), a = P(F.x + s * exo, F.y);
    if (Math.abs(Q.y - F.y) < 1e-9) { if (L > exo) lines.push([sw(a), q]); }
    else if (L > 3 * asz + exo) {
      const k1 = P(Q.x - s * 2 * asz, F.y), k2 = P(Q.x - s * asz, Q.y);
      lines.push([sw(a), sw(k1)], [sw(k1), sw(k2)], [sw(k2), q]);
    } else {
      if (L > exo) lines.push([sw(a), sw(P(Q.x, F.y))]);
      lines.push([sw(P(Q.x, F.y)), q]);
    }
    const text = axis === 'x'
      ? { p: G.add(q, P(h / 2, s * gap)), rot: Math.PI / 2, align: s > 0 ? 'l' : 'r' }
      : { p: G.add(q, P(s * gap, -h / 2)), rot: 0, align: s > 0 ? 'l' : 'r' };
    return { lines, arrows, dots, arcs, val, axis, text: { ...text, h, str: label(num(val)), style: ds.textStyle } };
  }
  if (e.kind === 'arc') {
    // Longitud de arco: centro c, arco de p1 a p2 en sentido antihorario, p3 sitúa el arco de cota. Con menos de 90° las líneas
    // de referencia son paralelas a la bisectriz; si no, radiales. El símbolo de arco va encima del texto.
    const c = e.c, r = G.dist(c, e.p1), a1 = G.ang(c, e.p1), sw = G.sweep(a1, G.ang(c, e.p2)), R = Math.max(G.dist(c, e.p3), 1e-9);
    const am = a1 + sw / 2, um = P(Math.cos(am), Math.sin(am)), out = R >= r;
    const foot = p => {
      if (sw >= Math.PI / 2) return G.polar(c, G.ang(c, p), R);
      const b = G.dot(um, G.sub(p, c)), disc = b * b - (G.dot(G.sub(p, c), G.sub(p, c)) - R * R);
      if (disc < 0) return G.polar(c, G.ang(c, p), R);
      return G.add(p, G.mul(um, out ? -b + Math.sqrt(disc) : -b - Math.sqrt(disc)));
    };
    const q1 = foot(e.p1), q2 = foot(e.p2);
    for (const [p, q] of [[e.p1, q1], [e.p2, q2]]) {
      const v = G.sub(q, p), L = G.len(v);
      if (L < 1e-9) continue;
      const u = G.mul(v, 1 / L);
      lines.push([L > exo ? G.add(p, G.mul(u, exo)) : q, G.add(q, G.mul(u, exe))]);
    }
    const s = G.ang(c, q1), t = G.ang(c, q2);
    arcs.push([c, R, s, t]);
    arrow(q1, P(-Math.sin(s), Math.cos(s)));
    arrow(q2, P(Math.sin(t), -Math.cos(t)));
    const mid = s + G.sweep(s, t) / 2;
    let ta = Math.atan2(Math.sin(mid - Math.PI / 2), Math.cos(mid - Math.PI / 2)), flip = false;
    if (ta > Math.PI / 2 + 1e-9) { ta -= Math.PI; flip = true; } else if (ta <= -Math.PI / 2 + 1e-9) { ta += Math.PI; flip = true; }
    // Símbolo: arco pequeño sobre el texto (en el sistema del texto: x a lo largo, y hacia arriba). Con el texto girado,
    // su parte superior mira al arco de cota: se aleja para dejar sitio al símbolo
    const sw2 = 0.45 * h, sag = 0.28 * h, y0 = 1.2 * h, rho = (sw2 * sw2 + sag * sag) / (2 * sag), cy = y0 + sag - rho, ar = Math.atan2(y0 - cy, sw2);
    const val = r * sw, tp = G.polar(c, mid, R + gap + (flip ? y0 + sag + 0.1 * h : 0));
    arcs.push([G.add(tp, G.rot(P(0, cy), ta)), rho, ar + ta, Math.PI - ar + ta]);
    return { lines, arrows, dots, arcs, val, text: { p: tp, rot: ta, h, str: label(num(val)), align: 'c', style: ds.textStyle } };
  }
  if (e.kind === 'jog') {
    // Radio con recodo: p1 centro, p2 en el arco (radio), p3 ubicación de la línea de cota, p4 centro desplazado, p5 recodo
    const c = e.p1, r = G.dist(c, e.p2), u = G.norm(G.sub(e.p3, c)), n = G.perp(u), a = G.add(c, G.mul(u, r));
    const d = G.dot(G.sub(e.p4, c), n), ad = Math.abs(d), k0 = G.dot(G.sub(e.p4, c), u);
    const sj = Math.min(r - ad / 2, Math.max(k0 + ad / 2, G.dot(G.sub(e.p5, c), u)));
    const J2 = G.add(c, G.mul(u, sj + ad / 2)), J1 = G.add(G.add(c, G.mul(n, d)), G.mul(u, sj - ad / 2));
    const end = G.dist(c, e.p3) > r ? e.p3 : a;
    if (G.dot(G.sub(J1, e.p4), u) > 1e-9) lines.push([e.p4, J1]);
    lines.push([J1, J2], [J2, end]);
    arrow(a, G.mul(u, -1));
    const right = u.x >= 0;
    return { lines, arrows, dots, arcs, val: r, text: { p: G.add(end, P(right ? gap : -gap, -h / 2)), rot: 0, h, str: label('R' + num(r)), align: right ? 'l' : 'r', style: ds.textStyle } };
  }
  if (e.kind === 'rad' || e.kind === 'dia') {
    const r = G.dist(e.p1, e.p2), u = G.norm(G.sub(e.p3, e.p1)), a = G.add(e.p1, G.mul(u, r));
    const start = e.kind === 'dia' ? G.sub(e.p1, G.mul(u, r)) : e.p1;
    const end = G.dist(e.p1, e.p3) > r ? e.p3 : a;
    lines.push([start, end]);
    arrow(a, G.mul(u, -1));
    if (e.kind === 'dia') arrow(start, u);
    const val = e.kind === 'dia' ? 2 * r : r;
    const base = (e.kind === 'dia' ? 'Ø' : 'R') + num(val);
    const right = u.x >= 0;
    return { lines, arrows, dots, arcs, val, text: { p: G.add(end, P(right ? gap : -gap, -h / 2)), rot: 0, h, str: label(base), align: right ? 'l' : 'r', style: ds.textStyle } };
  }
  let dir = e.kind === 'ali' ? G.norm(G.sub(e.p2, e.p1)) : P(Math.cos(e.rot || 0), Math.sin(e.rot || 0));
  if (e.kind === 'ali' && G.dist(e.p1, e.p2) < 1e-12) dir = P(1, 0);
  const n = G.perp(dir);
  const d1 = G.add(e.p1, G.mul(n, G.dot(G.sub(e.p3, e.p1), n)));
  const d2 = G.add(e.p2, G.mul(n, G.dot(G.sub(e.p3, e.p2), n)));
  const val = Math.abs(G.dot(G.sub(e.p2, e.p1), dir));
  const ext = (p, d) => {
    const v = G.sub(d, p), L = G.len(v);
    if (L < 1e-9) return;
    const u = G.mul(v, 1 / L);
    lines.push([L > exo ? G.add(p, G.mul(u, exo)) : d, G.add(d, G.mul(u, exe))]);
  };
  ext(e.p1, d1); ext(e.p2, d2);
  lines.push([d1, d2]);
  if (G.dist(d1, d2) > 1e-9) { const u = G.norm(G.sub(d2, d1)); arrow(d1, u); arrow(d2, G.mul(u, -1)); }
  let ta = Math.atan2(dir.y, dir.x);
  if (ta > Math.PI / 2 + 1e-9) ta -= Math.PI;
  if (ta <= -Math.PI / 2 + 1e-9) ta += Math.PI;
  const up = P(-Math.sin(ta), Math.cos(ta));
  const str = label(num(val));
  return { lines, arrows, dots, arcs, val, d1, d2, text: { p: G.add(G.mid(d1, d2), G.mul(up, gap)), rot: ta, h, str, align: 'c', style: ds.textStyle } };
}

// Cortes de cota (DIMBREAK): e.breaks = [{p, len}] son huecos centrados en los puntos de cruce con otros objetos
export function dimParts(e) {
  const d = dimPartsBase(e);
  if (!e.breaks?.length) return d;
  const out = [];
  for (const [a, b] of d.lines) {
    const L = G.dist(a, b), u = L > 1e-12 ? G.norm(G.sub(b, a)) : null;
    if (!u) { out.push([a, b]); continue; }
    const iv = [];
    for (const br of e.breaks) {
      const t = G.dot(G.sub(br.p, a), u), q = G.add(a, G.mul(u, t));
      if (t <= 1e-9 || t >= L - 1e-9 || G.dist(q, br.p) > (br.tol || 1e-6)) continue;
      iv.push([Math.max(0, t - (br.len || 0)), Math.min(L, t + (br.len || 0))]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    let cur = 0;
    for (const [x, y] of iv) {
      if (x > cur + 1e-9) out.push([G.add(a, G.mul(u, cur)), G.add(a, G.mul(u, x))]);
      cur = Math.max(cur, y);
    }
    if (cur < L - 1e-9) out.push([G.add(a, G.mul(u, cur)), b]);
  }
  d.lines = out;
  return d;
}

// ---------- Bloques ----------
export function insertMatrix(e, b) {
  let M = Mx.T(-b.base.x, -b.base.y);
  M = Mx.mul([e.sx ?? 1, 0, 0, e.sy ?? 1, 0, 0], M);
  M = Mx.mul(Mx.R(e.rot || 0), M);
  return Mx.mul(Mx.T(e.p.x, e.p.y), M);
}
export const blockAttdefs = name => D()?.blocks?.[name]?.ents.filter(x => x.type === 'attdef') || [];
export const attVal = (ins, a) => ins.attribs?.[a.tag] ?? a.def ?? '';
// Texto que representa una definición de atributo: la etiqueta, o el valor dentro de una referencia
const attText = (a, str) => ({ type: 'text', p: a.p, h: a.h, rot: a.rot || 0, align: a.align || 'l', style: a.style, text: str, layer: a.layer, color: a.color, ltype: a.ltype, lw: a.lw });
// Atributos de una referencia: {tag, value, invisible, t: texto ya situado en el dibujo}
export function insertAttribs(e) {
  const b = D()?.blocks?.[e.name];
  if (!b) return [];
  const M = insertMatrix(e, b);
  return b.ents.filter(x => x.type === 'attdef').map(a => {
    const value = attVal(e, a), t = xformEnt(attText(a, value), M);
    if (t.layer === '0' || !t.layer) t.layer = e.layer;
    if (t.color === 'BYBLOCK') t.color = e.color;
    return { tag: a.tag, value, invisible: !!a.invisible, t };
  });
}
const vcache = new WeakMap();
let depth = 0;
export function blockEnts(e) {
  const b = D()?.blocks?.[e.name];
  if (!b || depth > 12) return [];
  const key = `${b.ver || 0}|${e.p.x},${e.p.y},${e.sx},${e.sy},${e.rot},${e.layer},${e.color},${e.ltype},${e.lw}|${e.attribs ? JSON.stringify(e.attribs) : ''}|${b.dyn ? JSON.stringify([b.dyn, e.dyn]) : ''}`;
  const hit = vcache.get(e);
  if (hit && hit.key === key && hit.b === b) return hit.ents;
  const M = insertMatrix(e, b);
  depth++;
  const src = b.dyn && ENV.applyDyn ? ENV.applyDyn(b, e, b.ents.map(cloneEnt)) : b.ents; // bloques dinámicos
  const ents = src.filter(x => !(x.type === 'attdef' && x.invisible)).map(x => {
    const v = xformEnt(x.type === 'attdef' ? attText(x, attVal(e, x)) : cloneEnt(x), M);
    if (v.layer === '0') v.layer = e.layer;
    if (v.color === 'BYBLOCK') v.color = e.color;
    if (v.ltype === 'BYBLOCK') v.ltype = e.ltype;
    if (v.lw === 'BYBLOCK') v.lw = e.lw;
    v.id = e.id;
    return v;
  });
  depth--;
  vcache.set(e, { key, b, ents });
  return ents;
}

// ---------- Descriptores de propiedades ----------
const num = (label, get, set) => ({ label, type: 'num', get, set });
const angp = (label, get, set) => ({ label, type: 'ang', get, set });
const ro = (label, get, type = 'num') => ({ label, type, get, ro: true });
const ptProps = (name, key) => [
  num(`${name} X`, e => e[key].x, (e, v) => { e[key] = P(v, e[key].y); }),
  num(`${name} Y`, e => e[key].y, (e, v) => { e[key] = P(e[key].x, v); }),
];
const sel = (label, options, get, set) => ({ label, type: 'select', options, get, set });

// ---------- Tipos ----------
export const TYPES = {};

TYPES.line = {
  name: 'Línea',
  prims: e => [{ k: 's', a: e.p1, b: e.p2 }],
  bbox: e => bbPts([e.p1, e.p2]),
  snaps: e => ({ end: [e.p1, e.p2], mid: [G.mid(e.p1, e.p2)] }),
  grips: e => [e.p1, G.mid(e.p1, e.p2), e.p2],
  moveGrip(e, i, p) {
    if (i === 0) e.p1 = p; else if (i === 2) e.p2 = p;
    else { const d = G.sub(p, G.mid(e.p1, e.p2)); e.p1 = G.add(e.p1, d); e.p2 = G.add(e.p2, d); }
  },
  xform(e, m) { e.p1 = Mx.ap(m, e.p1); e.p2 = Mx.ap(m, e.p2); },
  path(c, e) { c.moveTo(e.p1.x, e.p1.y); c.lineTo(e.p2.x, e.p2.y); },
  props: [...ptProps('Inicio', 'p1'), ...ptProps('Fin', 'p2'),
    ro('Longitud', e => G.dist(e.p1, e.p2)), ro('Ángulo', e => G.deg(G.normAng(G.ang(e.p1, e.p2))), 'deg')],
};

const quads = (c, r) => [0, 1, 2, 3].map(i => G.polar(c, i * Math.PI / 2, r));
TYPES.circle = {
  name: 'Círculo',
  prims: e => [{ k: 'a', c: e.c, r: e.r, a1: 0, a2: TAU }],
  bbox: e => ({ x1: e.c.x - e.r, y1: e.c.y - e.r, x2: e.c.x + e.r, y2: e.c.y + e.r }),
  snaps: e => ({ cen: [e.c], qua: quads(e.c, e.r) }),
  grips: e => [e.c, ...quads(e.c, e.r)],
  moveGrip(e, i, p) { if (i === 0) e.c = p; else e.r = Math.max(1e-6, G.dist(e.c, p)); },
  xform(e, m) { e.c = Mx.ap(m, e.c); e.r *= Mx.scaleOf(m); },
  path(c, e) { c.moveTo(e.c.x + e.r, e.c.y); c.arc(e.c.x, e.c.y, e.r, 0, TAU); },
  props: [...ptProps('Centro', 'c'),
    num('Radio', e => e.r, (e, v) => { if (v > 0) e.r = v; }),
    num('Diámetro', e => 2 * e.r, (e, v) => { if (v > 0) e.r = v / 2; }),
    ro('Circunferencia', e => TAU * e.r), ro('Área', e => Math.PI * e.r * e.r)],
};

const arcEnds = e => [G.polar(e.c, e.a1, e.r), G.polar(e.c, e.a2, e.r)];
const arcMid = e => G.polar(e.c, e.a1 + G.sweep(e.a1, e.a2) / 2, e.r);
TYPES.arc = {
  name: 'Arco',
  prims: e => [{ k: 'a', c: e.c, r: e.r, a1: e.a1, a2: e.a2 }],
  bbox: e => arcBB(e.c, e.r, e.a1, e.a2),
  snaps: e => ({ end: arcEnds(e), mid: [arcMid(e)], cen: [e.c], qua: quads(e.c, e.r).filter((q, i) => G.angIn(i * Math.PI / 2, e.a1, e.a2)) }),
  grips: e => [...arcEnds(e), arcMid(e), e.c],
  moveGrip(e, i, p) {
    if (i === 3) { e.c = p; return; }
    const pts = [...arcEnds(e), arcMid(e)];
    pts[i] = p;
    const k = G.arc3(pts[0], pts[2], pts[1]);
    if (k) Object.assign(e, k);
  },
  xform(e, m) {
    const [s1, s2] = arcEnds(e);
    e.c = Mx.ap(m, e.c); e.r *= Mx.scaleOf(m);
    const q1 = Mx.ap(m, s1), q2 = Mx.ap(m, s2);
    if (Mx.det(m) < 0) { e.a1 = G.ang(e.c, q2); e.a2 = G.ang(e.c, q1); } else { e.a1 = G.ang(e.c, q1); e.a2 = G.ang(e.c, q2); }
  },
  path(c, e) { const s = G.polar(e.c, e.a1, e.r); c.moveTo(s.x, s.y); c.arc(e.c.x, e.c.y, e.r, e.a1, e.a1 + G.sweep(e.a1, e.a2)); },
  props: [...ptProps('Centro', 'c'),
    num('Radio', e => e.r, (e, v) => { if (v > 0) e.r = v; }),
    angp('Ángulo inicial', e => e.a1, (e, v) => { e.a1 = v; }),
    angp('Ángulo final', e => e.a2, (e, v) => { e.a2 = v; }),
    ro('Longitud de arco', e => e.r * G.sweep(e.a1, e.a2))],
};

TYPES.pline = {
  name: 'Polilínea',
  prims: plSegs,
  bbox: e => plSegs(e).reduce((b, q) => bbUnion(b, primBBox(q)), null) || bbPts(e.pts),
  snaps: e => { const pcs = plPieces(e); return { end: e.pts, mid: pcs.map(pc => pieceAt(pc, 0.5)), cen: pcs.filter(pc => pc.bulge).map(pc => pc.prim.c) }; },
  grips: e => [...e.pts, ...plPieces(e).map(pc => pieceAt(pc, 0.5))],
  moveGrip(e, i, p) {
    const n = e.pts.length;
    if (i < n) { e.pts[i] = p; return; }
    const j = i - n, k = (j + 1) % n;
    if (e.bulges?.[j]) { e.bulges[j] = G.bulgeFrom3(e.pts[j], p, e.pts[k]); return; }
    const m = G.mid(e.pts[j], e.pts[k]), d = G.sub(p, m);
    e.pts[j] = G.add(e.pts[j], d); e.pts[k] = G.add(e.pts[k], d);
  },
  xform(e, m) {
    e.pts = e.pts.map(p => Mx.ap(m, p));
    if (e.bulges && Mx.det(m) < 0) e.bulges = e.bulges.map(b => -b);
  },
  path(c, e) {
    c.moveTo(e.pts[0].x, e.pts[0].y);
    for (const pc of plPieces(e)) {
      if (!pc.bulge) c.lineTo(pc.b.x, pc.b.y);
      else { const q = pc.prim; c.arc(q.c.x, q.c.y, q.r, G.ang(q.c, pc.a), G.ang(q.c, pc.b), pc.bulge < 0); }
    }
    if (e.closed) c.closePath();
  },
  props: [
    { label: 'Cerrada', type: 'bool', get: e => !!e.closed, set: (e, v) => { e.closed = v; } },
    ro('Vértices', e => e.pts.length, 'int'),
    ro('Longitud', e => plLength(e)),
    ro('Área', e => Math.abs(plArea(e))),
  ],
};

TYPES.ellipse = {
  name: 'Elipse',
  prims: e => closedSegs(ellPts(e)),
  bbox: e => {
    const co = Math.cos(e.rot), si = Math.sin(e.rot);
    const hx = Math.hypot(e.rx * co, e.ry * si), hy = Math.hypot(e.rx * si, e.ry * co);
    return { x1: e.c.x - hx, y1: e.c.y - hy, x2: e.c.x + hx, y2: e.c.y + hy };
  },
  axes: e => [G.polar(e.c, e.rot, e.rx), G.polar(e.c, e.rot + Math.PI / 2, e.ry), G.polar(e.c, e.rot + Math.PI, e.rx), G.polar(e.c, e.rot - Math.PI / 2, e.ry)],
  snaps(e) { return { cen: [e.c], qua: this.axes(e) }; },
  grips(e) { return [e.c, ...this.axes(e)]; },
  moveGrip(e, i, p) { if (i === 0) e.c = p; else if (i % 2) e.rx = Math.max(1e-6, G.dist(e.c, p)); else e.ry = Math.max(1e-6, G.dist(e.c, p)); },
  xform(e, m) {
    const s = Mx.scaleOf(m), v = Mx.apV(m, P(Math.cos(e.rot), Math.sin(e.rot)));
    e.c = Mx.ap(m, e.c); e.rx *= s; e.ry *= s; e.rot = Math.atan2(v.y, v.x);
  },
  path(c, e) { c.moveTo(e.c.x + e.rx * Math.cos(e.rot), e.c.y + e.rx * Math.sin(e.rot)); c.ellipse(e.c.x, e.c.y, e.rx, e.ry, e.rot, 0, TAU); },
  props: [...ptProps('Centro', 'c'),
    num('Radio mayor', e => e.rx, (e, v) => { if (v > 0) e.rx = v; }),
    num('Radio menor', e => e.ry, (e, v) => { if (v > 0) e.ry = v; }),
    angp('Rotación', e => e.rot, (e, v) => { e.rot = v; }),
    ro('Área', e => Math.PI * e.rx * e.ry)],
};

// Vértices de control repetidos al final de una spline periódica importada (se editan juntos)
const splWrap = e => {
  if (!e.closed || e.fit || e.cv) return 0;
  const n = e.ctrl.length, p = e.deg;
  for (let j = 0; j < p; j++) if (!G.eqPt(e.ctrl[n - p + j], e.ctrl[j], 1e-9)) return 0;
  return p;
};
TYPES.spline = {
  name: 'Spline',
  prims: e => { const p = splinePts(e); return e.closed ? closedSegs(p) : p.slice(1).map((q, i) => ({ k: 's', a: p[i], b: q })); },
  bbox: e => bbPts(splinePts(e)),
  snaps: e => { const p = splinePts(e); return e.closed ? {} : { end: [p[0], p[p.length - 1]] }; },
  grips: e => e.fit || e.cv || e.ctrl.slice(0, e.ctrl.length - splWrap(e)),
  moveGrip(e, i, p) {
    const k = e.fit ? 'fit' : e.cv ? 'cv' : null;
    if (k) { const old = e[k]; e[k] = old.map((q, j) => (j === i ? p : q)); if (!rebuildSpline(e)) e[k] = old; return; }
    const w = splWrap(e), n = e.ctrl.length;
    e.ctrl = e.ctrl.map((q, j) => (j === i || (i < w && j === n - w + i) ? p : q));
  },
  xform(e, m) { for (const k of ['fit', 'cv', 'ctrl']) if (e[k]) e[k] = e[k].map(q => Mx.ap(m, q)); },
  path(c, e) {
    const p = splinePts(e);
    c.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) c.lineTo(p[i].x, p[i].y);
    if (e.closed) c.closePath();
  },
  props: e => [
    ro('Método', x => (x.fit ? 'Ajuste' : x.cv ? 'Vértices de control' : 'Control (sin puntos de ajuste)'), 'text'),
    e.fit || e.cv
      ? { label: 'Cerrada', type: 'bool', get: x => !!x.closed, set: (x, v) => { const old = !!x.closed; x.closed = v; if (!rebuildSpline(x)) x.closed = old; } }
      : ro('Cerrada', x => (x.closed ? 'Sí' : 'No'), 'text'),
    ro('Grado', x => x.deg, 'int'),
    ro(e.fit ? 'Puntos de ajuste' : 'Vértices de control', x => (x.fit || x.cv || x.ctrl).length, 'int'),
    ro('Longitud', x => G.polyLen(splinePts(x), x.closed)),
    ...(e.closed ? [ro('Área', x => Math.abs(G.polyArea(splinePts(x))))] : []),
  ],
};

TYPES.point = {
  name: 'Punto',
  prims: () => [],
  bbox: e => bbPts([e.p]),
  hit: (e, p) => G.dist(e.p, p),
  snaps: e => ({ nod: [e.p] }),
  grips: e => [e.p],
  moveGrip(e, i, p) { e.p = p; },
  xform(e, m) { e.p = Mx.ap(m, e.p); },
  draw(c, e, R) {
    const s = R.toScreen(e.p);
    c.save(); c.setTransform(R.dpr, 0, 0, R.dpr, 0, 0); c.lineWidth = 1; c.setLineDash([]);
    c.beginPath(); c.moveTo(s.x - 4, s.y); c.lineTo(s.x + 4, s.y); c.moveTo(s.x, s.y - 4); c.lineTo(s.x, s.y + 4); c.stroke();
    c.beginPath(); c.arc(s.x, s.y, 1.5, 0, TAU); c.fill();
    c.restore();
  },
  props: ptProps('Posición', 'p'),
};

TYPES.text = {
  name: 'Texto',
  prims: () => [],
  selPrims: e => closedSegs(textBox(e)),
  bbox: e => bbPts(textBox(e)),
  hit(e, p) { const b = textBox(e); return G.pointInPoly(p, b) ? 0 : Math.min(...closedSegs(b).map(s => G.dist(p, G.nearSeg(p, s.a, s.b).p))); },
  snaps: e => ({ ins: [e.p] }),
  grips: e => [e.p],
  moveGrip(e, i, p) { e.p = p; },
  xform(e, m) {
    const s = Mx.scaleOf(m), dir = P(Math.cos(e.rot || 0), Math.sin(e.rot || 0)), v = Mx.apV(m, dir);
    let a = Math.atan2(v.y, v.x);
    if (Mx.det(m) < 0) { // MIRRTEXT=0: el texto se mantiene legible
      const w = textWidth(e.text, e.h, e.style), ra = a + Math.PI;
      if (Math.cos(ra) > -1e-9) { e.p = Mx.ap(m, G.add(e.p, G.mul(dir, w))); a = ra; }
      else e.p = Mx.ap(m, G.add(e.p, G.mul(G.perp(dir), e.h)));
    } else e.p = Mx.ap(m, e.p);
    e.rot = a; e.h *= s;
  },
  draw(c, e, R) { drawText(c, R, e); },
  props: [{ label: 'Contenido', type: 'text', get: e => e.text, set: (e, v) => { e.text = v; } },
    { label: 'Estilo', type: 'select', options: () => D().textStyles.map(s => [s.name, s.name]), get: e => e.style || 'Standard', set: (e, v) => { e.style = v; } },
    num('Altura', e => e.h, (e, v) => { if (v > 0) e.h = v; }),
    angp('Rotación', e => e.rot || 0, (e, v) => { e.rot = v; }),
    sel('Justificación', [['l', 'Izquierda'], ['c', 'Centro'], ['r', 'Derecha']], e => e.align || 'l', (e, v) => { e.align = v; }),
    ...ptProps('Posición', 'p')],
};

// ---------- Texto de líneas múltiples ----------
export const MT_ATTACH = [['tl', 'Superior izquierda'], ['tc', 'Superior centro'], ['tr', 'Superior derecha'], ['ml', 'Centro izquierda'], ['mc', 'Centro'], ['mr', 'Centro derecha'], ['bl', 'Inferior izquierda'], ['bc', 'Inferior centro'], ['br', 'Inferior derecha']];
const MT_PITCH = 5 / 3; // interlineado por defecto de AutoCAD: 5/3 de la altura (de la letra más alta de cada línea)
const STK = 0.7;        // tamaño de las fracciones apiladas
const fmtFont = (f, st, px) => `${f.i ? 'italic ' : ''}${f.b ? 'bold ' : ''}${px}px "${f.font || st.font}", ${FONT}`;
function runWidth(str, f, st, h = f.h) {
  mctx.font = fmtFont(f, st, 100);
  return mctx.measureText(str).width / 100 * h * TXT_K * (st.width || 1) * (f.w || 1);
}
const stkWidth = (t, st) => (t.k === '#' ? runWidth(t.a, t.f, st, t.f.h * STK) + runWidth('/', t.f, st) + runWidth(t.b, t.f, st, t.f.h * STK)
  : Math.max(runWidth(t.a, t.f, st, t.f.h * STK), runWidth(t.b, t.f, st, t.f.h * STK)) + 0.2 * t.f.h);
const mlcache = new WeakMap();
// Líneas tras el ajuste de palabras a la anchura e.w (0 = sin ajuste). Cada línea: {frags:[{s|stk, f, x, w}], w, h, str}
export function mtextLayout(e) {
  const st = styleOf(e.style), src = fieldText(e.text, !!e.rich), key = `${e.rich ? 1 : 0}|${src}|${e.h}|${e.w}|${e.style}|${st.font}|${st.width}`;
  let lay = mlcache.get(e);
  if (lay && lay.key === key) return lay;
  const base = baseFmt(e.h);
  const toks = e.rich ? parseRich(src, e.h) : String(src ?? '').split('\n').flatMap((s, i) => (i ? [{ t: 'nl' }] : []).concat([{ t: 's', s, f: base }]));
  const lines = [];
  let cur = null;
  const newLine = () => { cur = { frags: [], w: 0, h: 0, lastH: cur ? cur.lastH : e.h }; lines.push(cur); };
  const push = fr => { cur.frags.push({ ...fr, x: cur.w }); cur.w += fr.w; cur.h = Math.max(cur.h, fr.f.h); cur.lastH = fr.f.h; };
  newLine();
  for (const t of toks) {
    if (t.t === 'nl') { newLine(); continue; }
    if (t.t === 'stk') {
      const w = stkWidth(t, st);
      if (e.w > 0 && cur.frags.length && cur.w + w > e.w) newLine();
      push({ stk: t, f: t.f, w });
      continue;
    }
    for (const part of t.s.split(/( +)/)) {
      if (!part) continue;
      const w = runWidth(part, t.f, st);
      if (part[0] !== ' ' && e.w > 0 && cur.frags.length && cur.w + w > e.w) {
        while (cur.frags.length && /^ +$/.test(cur.frags[cur.frags.length - 1].s ?? '')) cur.w -= cur.frags.pop().w; // sin espacios al final
        newLine();
      }
      if (part[0] === ' ' && !cur.frags.length && lines.length > 1 && e.w > 0) continue; // ni al principio de una línea ajustada
      push({ s: part, f: t.f, w });
    }
  }
  // Une los fragmentos contiguos con el mismo formato (una sola llamada de dibujo por tramo)
  for (const l of lines) {
    if (!l.h) l.h = l.lastH;
    const m = [];
    for (const fr of l.frags) {
      const p = m[m.length - 1];
      if (p && !p.stk && !fr.stk && p.f === fr.f) { p.s += fr.s; p.w += fr.w; } else m.push({ ...fr });
    }
    l.frags = m;
    l.str = m.map(fr => (fr.stk ? `${fr.stk.a}/${fr.stk.b}` : fr.s)).join('');
  }
  lay = { key, lines, widths: lines.map(l => l.w) };
  mlcache.set(e, lay);
  return lay;
}
// Posición de cada línea y de cada tramo con formato, y contorno, en coordenadas del dibujo
export function mtextGeom(e) {
  const { lines, widths } = mtextLayout(e), ls = (e.ls || 1) * MT_PITCH;
  const att = e.attach || 'tl', col = att[1];
  const base = []; // línea base de cada línea, medida hacia abajo desde el borde superior
  lines.forEach((l, i) => base.push(i ? base[i - 1] + ls * l.h : l.h));
  const W = e.w > 0 ? e.w : Math.max(e.h, ...widths), H = base[base.length - 1];
  const top = att[0] === 't' ? 0 : att[0] === 'm' ? H / 2 : H;
  const left = col === 'l' ? 0 : col === 'c' ? -W / 2 : -W, ax = left + (col === 'l' ? 0 : col === 'c' ? W / 2 : W);
  const rot = e.rot || 0, W2 = q => G.add(e.p, G.rot(q, rot)), lastH = lines[lines.length - 1].h;
  return {
    lines: lines.map((l, i) => {
      const y = top - base[i], x0 = col === 'l' ? left : col === 'c' ? ax - l.w / 2 : ax - l.w;
      return { p: W2(P(ax, y)), str: l.str, align: col, h: l.h, rot, style: e.style, frags: l.frags.map(fr => ({ ...fr, p: W2(P(x0 + fr.x, y)) })) };
    }),
    box: [P(left, top - H - 0.3 * lastH), P(left + W, top - H - 0.3 * lastH), P(left + W, top), P(left, top)].map(W2),
    widthGrip: W2(P(col === 'r' ? left : left + W, top - H / 2)),
  };
}
// Dibuja un tramo con formato. hl: resaltado (se ignoran los colores propios del tramo)
function drawFrag(c, R, fr, rot, st, hl) {
  const f = fr.f, H = f.h * R.scale;
  if (H * TXT_K < 0.8) return;
  const s = R.toScreen(fr.p);
  c.save();
  c.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  c.translate(s.x, s.y);
  c.rotate(-rot);
  const obl = (st.oblique || 0) + (f.q || 0);
  if (obl) c.transform(1, 0, -Math.tan(G.rad(obl)), 1, 0, 0);
  const sx = (st.width || 1) * (f.w || 1);
  if (sx !== 1) c.scale(sx, 1);
  if (!hl && f.color) c.fillStyle = f.color;
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const wpx = fr.w * R.scale / sx;
  if (fr.stk) {
    const t = fr.stk, small = H * STK;
    c.font = fmtFont(f, st, small * TXT_K);
    if (t.k === '#') {
      const wa = runWidth(t.a, f, st, f.h * STK) * R.scale / sx, wsl = runWidth('/', f, st) * R.scale / sx;
      c.fillText(t.a, 0, -0.45 * H);
      c.font = fmtFont(f, st, H * TXT_K); c.fillText('/', wa, 0);
      c.font = fmtFont(f, st, small * TXT_K); c.fillText(t.b, wa + wsl, 0);
    } else {
      const wa = runWidth(t.a, f, st, f.h * STK) * R.scale / sx, wb = runWidth(t.b, f, st, f.h * STK) * R.scale / sx;
      c.fillText(t.a, (wpx - wa) / 2, -0.62 * H);
      c.fillText(t.b, (wpx - wb) / 2, 0.32 * H);
      if (t.k === '/') c.fillRect(0.05 * wpx, -0.5 * H, 0.9 * wpx, Math.max(1, 0.06 * H));
    }
  } else {
    c.font = fmtFont(f, st, H * TXT_K);
    c.fillText(fr.s, 0, 0);
  }
  const lw = Math.max(1, 0.07 * H);
  if (f.u) c.fillRect(0, 0.18 * H, wpx, lw);
  if (f.o) c.fillRect(0, -1.2 * H, wpx, lw);
  if (f.k) c.fillRect(0, -0.5 * H, wpx, lw);
  c.restore();
}
export function drawMText(c, R, e, hl) {
  const st = styleOf(e.style);
  for (const ln of mtextGeom(e).lines) for (const fr of ln.frags) drawFrag(c, R, fr, ln.rot, st, hl);
}
export { richPlain };
TYPES.mtext = {
  name: 'Texto de líneas múltiples',
  prims: () => [],
  selPrims: e => closedSegs(mtextGeom(e).box),
  bbox: e => bbPts(mtextGeom(e).box),
  hit(e, p) { const b = mtextGeom(e).box; return G.pointInPoly(p, b) ? 0 : Math.min(...closedSegs(b).map(s => G.dist(p, G.nearSeg(p, s.a, s.b).p))); },
  snaps: e => ({ ins: [e.p] }),
  grips: e => [e.p, mtextGeom(e).widthGrip],
  moveGrip(e, i, p) {
    if (i === 0) { e.p = p; return; }
    const lx = G.rot(G.sub(p, e.p), -(e.rot || 0)).x, col = (e.attach || 'tl')[1];
    e.w = Math.max(e.h, col === 'l' ? lx : col === 'c' ? 2 * Math.abs(lx) : -lx);
  },
  xform(e, m) {
    const s = Mx.scaleOf(m), v = Mx.apV(m, P(Math.cos(e.rot || 0), Math.sin(e.rot || 0)));
    let a = Math.atan2(v.y, v.x);
    if (Mx.det(m) < 0) { // simetría con el texto legible: se invierte la justificación en lugar de las letras
      const att = e.attach || 'tl';
      if (Math.cos(a) < -1e-9) { a += Math.PI; e.attach = att[0] + { l: 'r', r: 'l', c: 'c' }[att[1]]; }
      else e.attach = { t: 'b', b: 't', m: 'm' }[att[0]] + att[1];
    }
    e.p = Mx.ap(m, e.p); e.rot = a;
    if (Math.abs(s - 1) > 1e-12) {
      e.h *= s;
      if (e.w) e.w *= s;
      if (e.rich) e.text = String(e.text).replace(/\\H([\d.]+);/g, (_, v) => `\\H${+(parseFloat(v) * s).toFixed(6)};`); // alturas absolutas
    }
  },
  draw(c, e, R, st) { drawMText(c, R, e, st?.hl); },
  props: [{ label: 'Contenido', type: 'mtext', get: e => (e.rich ? richPlain(e.text) : e.text), set: (e, v) => { e.text = v.text; if (v.rich) e.rich = true; else delete e.rich; } },
    { label: 'Estilo', type: 'select', options: () => D().textStyles.map(s => [s.name, s.name]), get: e => e.style || 'Standard', set: (e, v) => { e.style = v; } },
    num('Altura', e => e.h, (e, v) => { if (v > 0) e.h = v; }),
    num('Anchura (0 = libre)', e => e.w || 0, (e, v) => { if (v >= 0) e.w = v; }),
    angp('Rotación', e => e.rot || 0, (e, v) => { e.rot = v; }),
    sel('Justificación', MT_ATTACH, e => e.attach || 'tl', (e, v) => { e.attach = v; }),
    num('Interlineado', e => e.ls || 1, (e, v) => { if (v > 0) e.ls = v; }),
    ...ptProps('Posición', 'p'),
    ro('Líneas', e => mtextLayout(e).lines.length, 'int'),
    ro('Formato', e => (e.rich ? 'Con formato' : 'Sin formato'), 'text')],
};

// ---------- Directriz múltiple ----------
// {pts: [punta, …, último vértice], content: 'mtext'|'block'|'none', text, rich?, h, asz, arrow, land (rellano), gap, w, style}
// El rellano horizontal sale del último vértice hacia el lado del texto; content 'block' es un globo con número.
export const ML_CONTENT = [['mtext', 'Texto'], ['block', 'Globo'], ['none', 'Ninguno']];
export const DEFAULT_MLSTYLE = { name: 'Standard', h: 2.5, asz: 2.5, arrow: 'closed', land: 5, gap: 1.25, textStyle: 'Standard', content: 'mtext' };
const ML_KEYS = ['h', 'asz', 'arrow', 'land', 'gap'];
// Valores efectivos de una directriz: los de su estilo, sustituidos por los que la propia entidad modifica
export function mlEff(e) {
  const s = D()?.mleaderStyle ? D().mleaderStyle(e.mstyle) : DEFAULT_MLSTYLE, out = { textStyle: e.style ?? s.textStyle };
  for (const k of ML_KEYS) out[k] = e[k] ?? s[k];
  return out;
}
const mgcache = new WeakMap();
export function mleaderGeom(e) {
  const m = mlEff(e);
  const key = JSON.stringify([e.pts, e.content, e.text, e.rich, m, e.w, D()?.textStyle?.(m.textStyle)]);
  const hit = mgcache.get(e);
  if (hit && hit.key === key) return hit.g;
  const pts = e.pts, n = pts.length, last = pts[n - 1], prev = pts[n - 2] || G.sub(last, P(1, 0));
  const side = last.x >= prev.x - 1e-9 ? 1 : -1, hasContent = e.content !== 'none';
  const L = hasContent && m.land > 0 ? G.add(last, P(side * m.land, 0)) : last;
  const lines = [], arrows = [], dots = [];
  for (let i = 0; i + 1 < n; i++) lines.push([pts[i], pts[i + 1]]);
  if (!G.eqPt(L, last)) lines.push([last, L]);
  if (n > 1 && G.dist(pts[0], pts[1]) > 1e-9) arrowHead(m.arrow || 'closed', pts[0], G.norm(G.sub(pts[1], pts[0])), m.asz, lines, arrows, dots);
  let text = null, circle = null;
  if (e.content === 'mtext' && e.text) {
    // Texto con el centro de su primera línea a la altura del rellano
    text = { type: 'mtext', p: G.add(L, P(side * (m.gap || 0), m.h / 2)), h: m.h, w: e.w || 0, rot: 0, attach: side > 0 ? 'tl' : 'tr', text: e.text, style: m.textStyle, ...(e.rich ? { rich: true } : {}) };
  } else if (e.content === 'block') {
    const r = Math.max(m.h * 1.25, textWidth(fieldText(e.text || ''), m.h, m.textStyle) / 2 + 0.5 * m.h), c = G.add(L, P(side * r, 0));
    circle = [c, r];
    if (e.text) text = { type: 'mtext', p: c, h: m.h, w: 0, rot: 0, attach: 'mc', text: e.text, style: m.textStyle };
  }
  const g = { lines, arrows, dots, text, circle, L, side };
  mgcache.set(e, { key, g });
  return g;
}
const mlSegs = g => [...g.lines.map(([a, b]) => ({ k: 's', a, b })), ...(g.circle ? [{ k: 'a', c: g.circle[0], r: g.circle[1], a1: 0, a2: TAU }] : [])];
TYPES.mleader = {
  name: 'Directriz múltiple',
  prims: e => mlSegs(mleaderGeom(e)),
  selPrims: e => { const g = mleaderGeom(e); return [...mlSegs(g), ...(g.text ? closedSegs(mtextGeom(g.text).box) : [])]; },
  bbox: e => {
    const g = mleaderGeom(e);
    let b = bbPts([...e.pts, g.L, ...g.arrows.flat()]);
    if (g.circle) b = bbUnion(b, { x1: g.circle[0].x - g.circle[1], y1: g.circle[0].y - g.circle[1], x2: g.circle[0].x + g.circle[1], y2: g.circle[0].y + g.circle[1] });
    if (g.text) b = bbUnion(b, bbPts(mtextGeom(g.text).box));
    return b;
  },
  hit(e, p) {
    const g = mleaderGeom(e);
    if (g.text && G.pointInPoly(p, mtextGeom(g.text).box)) return 0;
    return Math.min(...mlSegs(g).map(q => G.dist(p, G.nearPrim(p, q))));
  },
  snaps: e => ({ end: [e.pts[0], e.pts[e.pts.length - 1]], ins: [mleaderGeom(e).L] }),
  grips: e => [...e.pts, mleaderGeom(e).L],
  moveGrip(e, i, p) {
    const n = e.pts.length;
    if (i < n) { e.pts = e.pts.map((q, j) => (j === i ? p : q)); return; }
    const g = mleaderGeom(e); // el pinzamiento del rellano arrastra el texto con el último vértice
    e.pts = e.pts.map((q, j) => (j === n - 1 ? G.add(q, G.sub(p, g.L)) : q));
  },
  xform(e, m) {
    const s = Mx.scaleOf(m);
    e.pts = e.pts.map(q => Mx.ap(m, q));
    if (Math.abs(s - 1) > 1e-12) {
      const m = mlEff(e);
      for (const k of ['h', 'asz', 'land', 'gap']) e[k] = m[k] * s;
      if (e.w) e.w *= s;
      if (e.rich) e.text = String(e.text).replace(/\\H([\d.]+);/g, (_, v) => `\\H${+(parseFloat(v) * s).toFixed(6)};`);
    }
  },
  draw(c, e, R, st) {
    const g = mleaderGeom(e);
    c.beginPath();
    for (const [a, b] of g.lines) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
    if (g.circle) { const [q, r] = g.circle; c.moveTo(q.x + r, q.y); c.arc(q.x, q.y, r, 0, TAU); }
    c.stroke();
    c.beginPath();
    for (const [a, b, q] of g.arrows) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(q.x, q.y); c.closePath(); }
    for (const [p, r] of g.dots) { c.moveTo(p.x + r, p.y); c.arc(p.x, p.y, r, 0, TAU); }
    c.fill();
    if (g.text) drawMText(c, R, g.text, st?.hl);
  },
  props: e => [
    sel('Contenido', ML_CONTENT, x => x.content, (x, v) => { x.content = v; if (v === 'block' && x.rich) { x.text = richPlain(x.text); delete x.rich; } }),
    e.content === 'mtext'
      ? { label: 'Texto', type: 'mtext', get: x => (x.rich ? richPlain(x.text) : x.text || ''), set: (x, v) => { x.text = v.text; if (v.rich) x.rich = true; else delete x.rich; } }
      : { label: 'Texto', type: 'text', get: x => x.text || '', set: (x, v) => { x.text = v; delete x.rich; } },
    { label: 'Estilo de directriz', type: 'select', options: () => D().mleaderStyles.map(s => [s.name, s.name]), get: x => D().mleaderStyle(x.mstyle).name, set: (x, v) => { x.mstyle = v; } },
    { label: 'Estilo de texto', type: 'select', options: () => D().textStyles.map(s => [s.name, s.name]), get: x => mlEff(x).textStyle, set: (x, v) => { x.style = v; } },
    num('Altura de texto', x => mlEff(x).h, (x, v) => { if (v > 0) x.h = v; }),
    num('Anchura de texto (0 = libre)', x => x.w || 0, (x, v) => { if (v >= 0) x.w = v; }),
    sel('Punta de flecha', () => Object.entries(ARROWS), x => mlEff(x).arrow, (x, v) => { x.arrow = v; }),
    num('Tamaño de flecha', x => mlEff(x).asz, (x, v) => { if (v >= 0) x.asz = v; }),
    num('Longitud del rellano', x => mlEff(x).land, (x, v) => { if (v >= 0) x.land = v; }),
    { label: 'Valores del estilo', type: 'action', get: () => 'Quitar modificaciones', set: x => { for (const k of [...ML_KEYS, 'style']) delete x[k]; } },
    ro('Vértices', x => x.pts.length, 'int'),
  ],
};

// ---------- Tabla ----------
// {p: esquina superior izquierda, rot, cols: [anchos], rows: [alturas mínimas], cells: [[texto]], th: altura de texto,
//  title: la primera fila es un título que ocupa todas las columnas, header: la fila siguiente es de encabezados, style}
// Las filas crecen para que quepa el texto, que se ajusta a la anchura de cada celda.
const tgcache = new WeakMap();
export const DEFAULT_TBLSTYLE = { name: 'Standard', th: 2.5, textStyle: 'Standard', margin: 0.6, titleScale: 1.25, align: 'auto' };
// Valores efectivos de una tabla (estilo + modificaciones propias)
export function tblEff(e) {
  const s = D()?.tableStyle ? D().tableStyle(e.tstyle) : DEFAULT_TBLSTYLE;
  return { th: e.th ?? s.th, textStyle: e.style ?? s.textStyle, margin: s.margin ?? 0.6, titleScale: s.titleScale ?? 1.25, align: s.align || 'auto' };
}
const isNumber = s => /^[-+]?\s*[\d.,]+\s*[%€$°]?$/.test(String(s).trim());
export function tableGeom(e) {
  const t0 = tblEff(e), th = t0.th;
  const key = JSON.stringify([e.p, e.rot, e.cols, e.rows, e.cells, t0, e.title, e.header, D()?.textStyle?.(t0.textStyle), fieldsKey(e.cells)]);
  const hit = tgcache.get(e);
  if (hit && hit.key === key) return hit.g;
  const nr = e.rows.length, nc = e.cols.length, mar = th * t0.margin, colX = [0];
  for (const w of e.cols) colX.push(colX[colX.length - 1] + w);
  const W = colX[nc], cells = [], rowH = [];
  for (let r = 0; r < nr; r++) {
    const isTitle = e.title && r === 0, isHead = e.header && r === (e.title ? 1 : 0);
    let need = e.rows[r];
    for (const [c0, c1] of isTitle ? [[0, nc]] : e.cols.map((_, c) => [c, c + 1])) {
      const str = e.cells[r]?.[c0] ?? '';
      if (!String(str).trim()) continue;
      const t = { type: 'mtext', p: P(0, 0), text: String(str), h: th * (isTitle ? t0.titleScale : 1), w: Math.max(colX[c1] - colX[c0] - 2 * mar, th), rot: 0, attach: 'tl', style: t0.textStyle };
      const hgt = -bbPts(mtextGeom(t).box).y1;
      need = Math.max(need, hgt + 2 * mar);
      cells.push({ r, c0, c1, t, align: isTitle || isHead ? 'c' : t0.align !== 'auto' ? t0.align : isNumber(fieldText(str)) ? 'r' : 'l' });
    }
    rowH.push(need);
  }
  const rowY = [0];
  for (const hh of rowH) rowY.push(rowY[rowY.length - 1] - hh);
  const H = -rowY[nr], rot = e.rot || 0, W2 = q => G.add(e.p, G.rot(q, rot));
  const lines = [];
  for (let r = 0; r <= nr; r++) lines.push([W2(P(0, rowY[r])), W2(P(W, rowY[r]))]);
  for (let c = 0; c <= nc; c++) {
    const inner = c > 0 && c < nc;
    const y0 = inner && e.title ? rowY[1] : 0; // el título no tiene divisiones verticales
    if (y0 > rowY[nr]) lines.push([W2(P(colX[c], y0)), W2(P(colX[c], rowY[nr]))]);
  }
  const texts = cells.map(({ r, c0, c1, t, align }) => {
    const ym = (rowY[r] + rowY[r + 1]) / 2, x = align === 'c' ? (colX[c0] + colX[c1]) / 2 : align === 'r' ? colX[c1] - mar : colX[c0] + mar;
    return { ...t, p: W2(P(x, ym)), rot, attach: 'm' + align };
  });
  const g = { lines, texts, colX, rowY, W, H, box: [P(0, 0), P(W, 0), P(W, -H), P(0, -H)].map(W2), local: q => G.rot(G.sub(q, e.p), -rot), world: W2 };
  tgcache.set(e, { key, g });
  return g;
}
// Celda [fila, columna] en un punto del dibujo, o null
export function tableCellAt(e, p) {
  const g = tableGeom(e), q = g.local(p);
  if (q.x < 0 || q.x > g.W || q.y > 0 || q.y < -g.H) return null;
  const r = g.rowY.findIndex((y, i) => i > 0 && q.y >= y) - 1, c = e.title && r === 0 ? 0 : g.colX.findIndex((x, i) => i > 0 && q.x <= x) - 1;
  return r >= 0 && c >= 0 ? [r, c] : null;
}
TYPES.table = {
  name: 'Tabla',
  prims: e => tableGeom(e).lines.map(([a, b]) => ({ k: 's', a, b })),
  bbox: e => bbPts(tableGeom(e).box),
  hit(e, p) { const g = tableGeom(e); return G.pointInPoly(p, g.box) ? 0 : Math.min(...g.lines.map(([a, b]) => G.dist(p, G.nearSeg(p, a, b).p))); },
  snaps: e => ({ end: tableGeom(e).box, ins: [e.p] }),
  // Pinzamientos: punto de inserción, bordes derechos de las columnas (anchura) y bordes inferiores de las filas (altura)
  grips: e => { const g = tableGeom(e); return [e.p, ...g.colX.slice(1).map(x => g.world(P(x, 0))), ...g.rowY.slice(1).map(y => g.world(P(0, y)))]; },
  moveGrip(e, i, p) {
    if (i === 0) { e.p = p; return; }
    const g = tableGeom(e), q = g.local(p), nc = e.cols.length;
    const th = tblEff(e).th;
    if (i <= nc) { e.cols = e.cols.map((w, c) => (c === i - 1 ? Math.max(th, q.x - g.colX[c]) : w)); return; }
    const r = i - nc - 1;
    e.rows = e.rows.map((hh, k) => (k === r ? Math.max(th * 1.2, g.rowY[r] - q.y) : hh));
  },
  xform(e, m) {
    const s = Mx.scaleOf(m), v = Mx.apV(m, P(Math.cos(e.rot || 0), Math.sin(e.rot || 0)));
    let a = Math.atan2(v.y, v.x);
    if (Mx.det(m) < 0) { // simetría con el texto legible: la tabla no se invierte, se recoloca
      const b = tableGeom(e).box;
      if (Math.cos(a + Math.PI) > -1e-9) { e.p = Mx.ap(m, b[1]); a += Math.PI; } else e.p = Mx.ap(m, b[3]);
    } else e.p = Mx.ap(m, e.p);
    e.rot = Math.abs(G.normAng(a)) < 1e-12 || Math.abs(G.normAng(a) - TAU) < 1e-12 ? 0 : G.normAng(a);
    if (Math.abs(s - 1) > 1e-12) { e.cols = e.cols.map(w => w * s); e.rows = e.rows.map(hh => hh * s); e.th = tblEff(e).th * s; }
  },
  draw(c, e, R, st) {
    const g = tableGeom(e);
    c.beginPath();
    for (const [a, b] of g.lines) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
    c.stroke();
    for (const t of g.texts) drawMText(c, R, t, st?.hl);
  },
  props: [
    ro('Filas', e => e.rows.length, 'int'), ro('Columnas', e => e.cols.length, 'int'),
    { label: 'Celdas', type: 'table', get: e => `${e.rows.length} × ${e.cols.length}` },
    { label: 'Estilo de tabla', type: 'select', options: () => D().tableStyles.map(s => [s.name, s.name]), get: e => D().tableStyle(e.tstyle).name, set: (e, v) => { e.tstyle = v; } },
    num('Altura de texto', e => tblEff(e).th, (e, v) => { if (v > 0) e.th = v; }),
    { label: 'Estilo de texto', type: 'select', options: () => D().textStyles.map(s => [s.name, s.name]), get: e => tblEff(e).textStyle, set: (e, v) => { e.style = v; } },
    { label: 'Fila de título', type: 'bool', get: e => !!e.title, set: (e, v) => { e.title = v; } },
    { label: 'Fila de encabezado', type: 'bool', get: e => !!e.header, set: (e, v) => { e.header = v; } },
    angp('Rotación', e => e.rot || 0, (e, v) => { e.rot = v; }),
    ...ptProps('Posición', 'p'),
    ro('Anchura total', e => tableGeom(e).W), ro('Altura total', e => tableGeom(e).H),
  ],
};

// ---------- Definición de atributo ----------
TYPES.attdef = {
  name: 'Definición de atributo',
  prims: () => [],
  selPrims: e => TYPES.text.selPrims(attText(e, e.tag)),
  bbox: e => TYPES.text.bbox(attText(e, e.tag)),
  hit: (e, p) => TYPES.text.hit(attText(e, e.tag), p),
  snaps: e => ({ ins: [e.p] }),
  grips: e => [e.p],
  moveGrip(e, i, p) { e.p = p; },
  xform(e, m) { e.text = e.tag; TYPES.text.xform(e, m); delete e.text; },
  draw(c, e, R) { drawText(c, R, attText(e, e.tag)); },
  props: [{ label: 'Etiqueta', type: 'text', get: e => e.tag, set: (e, v) => { if (v.trim()) e.tag = v.trim().toUpperCase().replace(/\s+/g, '_'); } },
    { label: 'Solicitud', type: 'text', get: e => e.prompt || '', set: (e, v) => { e.prompt = v; } },
    { label: 'Valor por defecto', type: 'text', get: e => e.def || '', set: (e, v) => { e.def = v; } },
    { label: 'Invisible', type: 'bool', get: e => !!e.invisible, set: (e, v) => { e.invisible = v; } },
    { label: 'Estilo', type: 'select', options: () => D().textStyles.map(s => [s.name, s.name]), get: e => e.style || 'Standard', set: (e, v) => { e.style = v; } },
    num('Altura', e => e.h, (e, v) => { if (v > 0) e.h = v; }),
    angp('Rotación', e => e.rot || 0, (e, v) => { e.rot = v; }),
    sel('Justificación', [['l', 'Izquierda'], ['c', 'Centro'], ['r', 'Derecha']], e => e.align || 'l', (e, v) => { e.align = v; }),
    ...ptProps('Posición', 'p')],
};

const dimSegs = d => [...d.lines.map(([a, b]) => ({ k: 's', a, b })), ...d.arcs.map(([c, r, a1, a2]) => ({ k: 'a', c, r, a1, a2 }))];
const DIM_GRIPS = { ang: ['p3', 'c'], ord: ['p1', 'p3'], arc: ['p3', 'p1', 'p2'], jog: ['p3', 'p4', 'p5'] };
const dimGripKeys = e => DIM_GRIPS[e.kind] || ['p1', 'p2', 'p3'];
export const DIM_KINDS = { lin: 'Lineal', ali: 'Alineada', rad: 'Radio', dia: 'Diámetro', ang: 'Angular', ord: 'Coordenada', arc: 'Longitud de arco', jog: 'Radio con recodo' };
TYPES.dim = {
  name: 'Cota',
  prims: e => dimSegs(dimParts(e)),
  selPrims: e => { const d = dimParts(e); return [...dimSegs(d), ...closedSegs(textBox(d.text))]; },
  bbox: e => { const d = dimParts(e); return d.arcs.reduce((b, [c, r, a1, a2]) => bbUnion(b, arcBB(c, r, a1, a2)), bbPts([...d.lines.flat(), ...d.arrows.flat(), ...textBox(d.text)])); },
  hit(e, p) {
    const d = dimParts(e);
    if (G.pointInPoly(p, textBox(d.text))) return 0;
    return Math.min(...dimSegs(d).map(q => G.dist(p, G.nearPrim(p, q))));
  },
  snaps: e => { const d = dimParts(e); return { end: d.lines.flat(), nod: e.kind === 'ord' ? [e.p1] : e.kind === 'ang' ? [e.c] : [e.p1, e.p2] }; },
  grips: e => dimGripKeys(e).map(k => e[k]),
  moveGrip(e, i, p) {
    const k = dimGripKeys(e)[i];
    if (e.kind === 'arc' && k !== 'p3') { e[k] = G.polar(e.c, G.ang(e.c, p), G.dist(e.c, e.p1)); e.partial = true; return; } // longitud de arco parcial
    if (e.kind === 'jog') { e[k] = p; return; }
    if (e.assoc && k !== 'p3') { // el punto movido deja de estar asociado a la geometría
      delete e.assoc[k];
      if (k === 'c' || e.kind === 'rad' || e.kind === 'dia') { delete e.assoc.obj; delete e.assoc.l1; delete e.assoc.l2; }
      if (!Object.keys(e.assoc).length) delete e.assoc;
    }
    if (k === 'c') { const d = G.sub(p, e.c); for (const q of ['c', 'p1', 'p2', 'p3']) e[q] = G.add(e[q], d); if (e.l1) { e.l1 = e.l1.map(x => G.add(x, d)); e.l2 = e.l2.map(x => G.add(x, d)); } return; }
    e[k] = p;
  },
  // _xf: la cota se ha transformado; si su geometría no cambió a la vez, deja de ser asociativa (document.js)
  xform(e, m) {
    for (const k of ['p1', 'p2', 'p3', 'p4', 'p5', 'c']) if (e[k]) e[k] = Mx.ap(m, e[k]);
    if (e.kind === 'arc' && Mx.det(m) < 0) [e.p1, e.p2] = [e.p2, e.p1]; // el arco sigue en sentido antihorario
    if (e.l1) { e.l1 = e.l1.map(q => Mx.ap(m, q)); e.l2 = e.l2.map(q => Mx.ap(m, q)); }
    if (e.kind === 'lin') { const v = Mx.apV(m, P(Math.cos(e.rot), Math.sin(e.rot))); e.rot = Math.atan2(v.y, v.x); }
    if (e.assoc) e._xf = true;
  },
  draw(c, e, R) {
    const d = dimParts(e);
    c.beginPath();
    for (const [a, b] of d.lines) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
    for (const [q, r, a1, a2] of d.arcs) { c.moveTo(q.x + r * Math.cos(a1), q.y + r * Math.sin(a1)); c.arc(q.x, q.y, r, a1, a1 + G.sweep(a1, a2)); }
    c.stroke();
    c.beginPath();
    for (const [a, b, q] of d.arrows) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(q.x, q.y); c.closePath(); }
    for (const [p, r] of d.dots) { c.moveTo(p.x + r, p.y); c.arc(p.x, p.y, r, 0, TAU); }
    c.fill();
    drawText(c, R, d.text);
  },
  props: [ro('Tipo', e => DIM_KINDS[e.kind] || e.kind, 'text'), ro('Medida', e => dimParts(e).val),
    { label: 'Estilo de cota', type: 'select', options: () => D().dimStyles.map(s => [s.name, s.name]), get: e => e.style || D().dimStyles[0].name, set: (e, v) => { e.style = v; } },
    { label: 'Texto (<> = medida)', type: 'text', get: e => e.text || '', set: (e, v) => { e.text = v; } },
    { label: 'Asociativa', type: 'bool', get: e => !!e.assoc, set: (e, v) => { if (!v) delete e.assoc; } }],
};

// ---------- Marcas y líneas de centro (asociativas) ----------
TYPES.center = {
  name: 'Centro',
  prims: e => (e.lines || []).map(([a, b]) => ({ k: 's', a, b })),
  bbox: e => bbPts((e.lines || []).flat()),
  snaps: e => ({ end: (e.lines || []).flat(), mid: (e.lines || []).map(([a, b]) => G.mid(a, b)) }),
  grips: e => (e.lines?.length ? [G.mid(e.lines[0][0], e.lines[0][1])] : []),
  moveGrip(e, i, p) {
    const a = e.lines?.[0];
    if (!a) return;
    const d = G.sub(p, G.mid(a[0], a[1]));
    e.lines = e.lines.map(([q, r]) => [G.add(q, d), G.add(r, d)]);
    delete e.assoc;
  },
  xform(e, m) { e.lines = (e.lines || []).map(([a, b]) => [Mx.ap(m, a), Mx.ap(m, b)]); if (e.assoc) e._xf = true; },
  path(c, e) { for (const [a, b] of e.lines || []) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); } },
  props: [
    ro('Tipo', e => (e.kind === 'mark' ? 'Marca de centro' : 'Línea de centro'), 'text'),
    ro('Asociativa', e => (e.assoc ? 'Sí' : 'No'), 'text'),
    ro('Extensión', e => e.size ?? 2.5),
    ro('Referencias', e => (e.assoc ? Object.values(e.assoc).filter(x => x != null).length : 0)),
  ],
};

// ---------- Cobertura (WIPEOUT) ----------
const wipeoutBg = () => (!ENV.onScreen ? '#ffffff' : ENV.doc && (ENV.doc.space === 'model' || ENV.doc.space === 'bedit') ? '#212830' : '#ffffff');
TYPES.wipeout = {
  name: 'Cobertura',
  prims: e => closedSegs(e.pts),
  bbox: e => bbPts(e.pts),
  snaps: e => ({ end: e.pts, mid: e.pts.map((p, i) => G.mid(p, e.pts[(i + 1) % e.pts.length])) }),
  grips: e => e.pts,
  moveGrip(e, i, p) { e.pts[i] = p; },
  xform(e, m) { e.pts = e.pts.map(p => Mx.ap(m, p)); },
  draw(c, e, R, st) {
    c.beginPath(); TYPES.pline.path(c, { pts: e.pts, closed: true });
    c.save();
    c.fillStyle = wipeoutBg(); c.fill();
    if (st.hl) { c.strokeStyle = st.color; c.lineWidth = st.px / R.scale; c.setLineDash([6 / R.scale, 4 / R.scale]); c.stroke(); }
    c.restore();
  },
  props: [ro('Área', e => Math.abs(G.polyArea(e.pts))), ro('Vértices', e => e.pts.length, 'int')],
};

// ---------- Imagen raster (IMAGEATTACH) ----------
const IMG_CACHE = new Map();
function imageOf(src) {
  let im = IMG_CACHE.get(src);
  if (!im) {
    im = new Image();
    im.onload = () => ENV.doc?.emit('change');
    im.src = src;
    IMG_CACHE.set(src, im);
  }
  return im;
}
export const imageCorners = e => {
  const c = Math.cos(e.rot || 0), s = Math.sin(e.rot || 0);
  return [[0, 0], [e.w, 0], [e.w, e.h], [0, e.h]].map(([x, y]) => P(e.p.x + x * c - y * s, e.p.y + x * s + y * c));
};
TYPES.image = {
  name: 'Imagen',
  prims: e => closedSegs(e.clip?.pts?.length ? e.clip.pts : imageCorners(e)),
  bbox: e => bbPts(e.clip?.pts?.length ? e.clip.pts : imageCorners(e)),
  snaps: e => ({ end: imageCorners(e), mid: imageCorners(e).map((p, i, q) => G.mid(p, q[(i + 1) % 4])), ins: [e.p] }),
  grips: e => [e.p, ...imageCorners(e)],
  moveGrip(e, i, p) {
    if (i === 0) { e.p = p; return; }
    const d = G.sub(p, imageCorners(e)[i - 1]);
    e.p = G.add(e.p, d);
  },
  xform(e, m) {
    e.p = Mx.ap(m, e.p); e.w *= Mx.scaleOf(m); e.h *= Mx.scaleOf(m); e.rot = (e.rot || 0) + Math.atan2(m[1], m[0]);
    if (e.clip?.pts) e.clip = { ...e.clip, pts: e.clip.pts.map(q => Mx.ap(m, q)) };
  },
  draw(c, e, R, st) {
    const clip = e.clip?.pts?.length && !e.clip.off ? e.clip : null;
    if (clip) {
      c.save(); c.beginPath();
      if (e.clip.invert) { const b = bbPts(imageCorners(e)), m = Math.max(b.x2 - b.x1, b.y2 - b.y1) + 1; c.rect(b.x1 - m, b.y1 - m, b.x2 - b.x1 + 2 * m, b.y2 - b.y1 + 2 * m); }
      clip.pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.closePath(); c.clip('evenodd');
    }
    const im = imageOf(e.src);
    c.save(); c.translate(e.p.x, e.p.y); c.rotate(e.rot || 0); c.scale(1, -1);
    if (im.complete && im.naturalWidth && typeof c.drawImage === 'function') c.drawImage(im, 0, -e.h, e.w, e.h);
    else { c.strokeStyle = st.color; c.lineWidth = st.px / R.scale; c.strokeRect(0, -e.h, e.w, e.h); }
    c.restore();
    if (clip) {
      c.restore();
      const fr = ENV.doc?.settings?.xclipFrame ?? 2;
      if (fr === 1 || (fr === 2 && ENV.onScreen) || st.hl) { c.beginPath(); TYPES.pline.path(c, { pts: clip.pts, closed: true }); c.stroke(); }
    }
  },
  props: [ro('Archivo', e => e.name || 'Imagen'), num('Anchura', e => e.w, (e, v) => { if (v > 0) e.w = v; }),
    num('Altura', e => e.h, (e, v) => { if (v > 0) e.h = v; }),
    angp('Rotación', e => e.rot || 0, (e, v) => { e.rot = v; }), ro('Delimitada', e => (e.clip ? 'Sí' : 'No'))],
};

// ---------- Sombreado ----------
const hatchEdges = e => e.loops.flatMap(l => closedSegs(l));
export function hatchArea(e) {
  let a = 0;
  e.loops.forEach((l, i) => {
    const depthIn = e.loops.filter((o, j) => j !== i && G.pointInPoly(l[0], o)).length;
    a += (depthIn % 2 ? -1 : 1) * Math.abs(G.polyArea(l));
  });
  return Math.abs(a);
}
TYPES.hatch = {
  name: 'Sombreado',
  prims: () => [],
  selPrims: hatchEdges,
  bbox: e => bbPts(e.loops.flat()),
  hit(e, p) {
    const inside = e.loops.reduce((n, l) => n + (G.pointInPoly(p, l) ? 1 : 0), 0) % 2 === 1;
    if (inside) return 0;
    return Math.min(...hatchEdges(e).map(s => G.dist(p, G.nearSeg(p, s.a, s.b).p)));
  },
  snaps: () => ({}),
  grips: e => { const b = bbPts(e.loops.flat()); return [P((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2)]; },
  // _xf marca que el sombreado se ha transformado: si su contorno no cambió a la vez, pierde la asociatividad (document.js)
  moveGrip(e, i, p) {
    const g = this.grips(e)[0], d = G.sub(p, g);
    e.loops = e.loops.map(l => l.map(q => G.add(q, d)));
    if (e.seed) e.seed = G.add(e.seed, d);
    e._xf = true;
  },
  xform(e, m) {
    e.loops = e.loops.map(l => l.map(q => Mx.ap(m, q)));
    if (e.seed) e.seed = Mx.ap(m, e.seed);
    e._xf = true;
    const v = Mx.apV(m, P(1, 0)), r = G.deg(Math.atan2(v.y, v.x));
    e.angle = Mx.det(m) < 0 ? -(e.angle || 0) + r : (e.angle || 0) + r;
    e.scale = (e.scale || 1) * Mx.scaleOf(m);
  },
  draw(c, e, R, st) {
    c.save();
    c.beginPath();
    for (const l of e.loops) { l.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); }
    if (e.pattern === 'GRADIENT' && !st?.hl) {
      const g = gradientSpec(e, bbPts(e.loops.flat()));
      const gr = g.kind === 'linear' ? c.createLinearGradient(g.p0.x, g.p0.y, g.p1.x, g.p1.y) : c.createRadialGradient(g.c.x, g.c.y, 0, g.c.x, g.c.y, g.r);
      for (const [t, col] of g.stops) gr.addColorStop(Math.max(0, Math.min(1, t)), col);
      c.fillStyle = gr; c.fill('evenodd'); c.restore(); return;
    }
    if (e.pattern === 'SOLID' || e.pattern === 'GRADIENT') { c.fill('evenodd'); c.restore(); return; }
    c.clip('evenodd');
    const bb = bbPts(e.loops.flat());
    for (const f of famsOf(e)) {
      const dense = Math.abs(f.dy) * R.scale < 1.6;
      const lines = dense ? null : famLines(f, bb, 3000);
      if (!lines) { c.globalAlpha = 0.35; c.fillRect(bb.x1, bb.y1, bb.x2 - bb.x1, bb.y2 - bb.y1); c.globalAlpha = 1; break; }
      c.setLineDash(f.dash.length && f.dash.reduce((a, b) => a + Math.abs(b), 0) * R.scale > 3 ? f.dash.map(d => Math.abs(d) || 0.8 / R.scale) : []);
      c.lineCap = f.dash.includes(0) ? 'round' : 'butt';
      c.beginPath();
      for (const { a, b } of lines) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
      c.stroke();
    }
    c.restore();
  },
  props: e => [
    sel('Patrón', () => [...Object.entries(PATTERNS).map(([k, v]) => [k, v.desc]), ...Object.entries(D()?.patterns || {}).map(([k, v]) => [k, `${k} · ${v.desc || 'personalizado'}`]), ['USER', 'Definido por el usuario'], ['GRADIENT', 'Degradado']],
      x => x.pattern, (x, v) => { x.pattern = v; if (v === 'GRADIENT') x.grad = { ...GRAD_DEFAULT, ...x.grad }; if (v === 'USER') { x.user = { ...USER_DEFAULT, ...x.user }; x.scale = 1; } }),
    ...(e.pattern === 'USER' ? [
      num('Separación', x => (x.user?.sp ?? USER_DEFAULT.sp) * (x.scale || 1), (x, v) => { if (v > 0) { x.user = { ...USER_DEFAULT, ...x.user, sp: v / (x.scale || 1) }; } }),
      { label: 'Doble (cruzado)', type: 'bool', get: x => !!x.user?.dbl, set: (x, v) => { x.user = { ...USER_DEFAULT, ...x.user, dbl: v }; } },
    ] : []),
    ...(e.pattern === 'GRADIENT' ? [
      sel('Tipo de degradado', () => Object.entries(GRADIENTS), x => x.grad?.type || 'LINEAR', (x, v) => { x.grad = { ...GRAD_DEFAULT, ...x.grad, type: v }; }),
      { label: 'Color 1', type: 'color', get: x => x.grad?.c1 || GRAD_DEFAULT.c1, set: (x, v) => { x.grad = { ...GRAD_DEFAULT, ...x.grad, c1: v }; } },
      { label: 'Color 2', type: 'color', get: x => x.grad?.c2 || GRAD_DEFAULT.c2, set: (x, v) => { x.grad = { ...GRAD_DEFAULT, ...x.grad, c2: v }; } },
      { label: 'Centrado', type: 'bool', get: x => x.grad?.centered !== false, set: (x, v) => { x.grad = { ...GRAD_DEFAULT, ...x.grad, centered: v }; } },
    ] : e.pattern === 'USER' ? [] : [num('Escala', x => x.scale || 1, (x, v) => { if (v > 0) x.scale = v; })]),
    num('Ángulo (°)', x => x.angle || 0, (x, v) => { x.angle = v; }),
    { label: 'Asociativo', type: 'bool', get: e => !!e.assoc, set: (e, v) => { if (!v) { delete e.assoc; delete e.seed; } } },
    ro('Contornos', e => e.loops.length, 'int'),
    ro('Área', e => hatchArea(e)),
  ],
};

// ---------- Referencia a bloque ----------
// Contorno de delimitación (XCLIP) en coordenadas del dibujo: {poly, invert} o null
export function insertClip(e) {
  const b = D()?.blocks?.[e.name];
  if (!b || !clipActive(e)) return null;
  const M = insertMatrix(e, b);
  return { poly: e.clip.pts.map(q => Mx.ap(M, q)), invert: !!e.clip.invert };
}
const clipList = (e, list) => { const k = insertClip(e); return k ? clipPrims(list, k.poly, k.invert) : list; };
TYPES.insert = {
  name: 'Referencia a bloque',
  prims: e => clipList(e, blockEnts(e).flatMap(v => TYPES[v.type].prims(v))),
  selPrims: e => clipList(e, blockEnts(e).flatMap(v => { const T = TYPES[v.type]; return T.selPrims ? T.selPrims(v) : T.prims(v); })),
  bbox: e => {
    const b = blockEnts(e).reduce((r, v) => bbUnion(r, bboxOf(v)), null) || bbPts([e.p]), k = insertClip(e);
    if (!k || k.invert) return b;
    const c = bbPts(k.poly), x1 = Math.max(b.x1, c.x1), y1 = Math.max(b.y1, c.y1), x2 = Math.min(b.x2, c.x2), y2 = Math.min(b.y2, c.y2);
    return x1 <= x2 && y1 <= y2 ? { x1, y1, x2, y2 } : bbPts([e.p]);
  },
  hit: (e, p) => { const k = insertClip(e); if (k && !clipKeeps(k.poly, k.invert)(p)) return Infinity; return blockEnts(e).reduce((d, v) => Math.min(d, hitDist(v, p)), Infinity); },
  snaps: e => {
    const out = { ins: [e.p] }, k = insertClip(e), keep = k ? clipKeeps(k.poly, k.invert) : null;
    for (const v of blockEnts(e)) { const s = snapsOf(v); for (const kk in s) (out[kk] ||= []).push(...(keep ? s[kk].filter(keep) : s[kk])); }
    return out;
  },
  grips: e => [e.p, ...(ENV.dynGrips?.(e) || []).map(g => g.p)],
  gripKinds: e => ['', ...(ENV.dynGrips?.(e) || []).map(g => g.kind)],
  moveGrip(e, i, p) { if (i === 0) e.p = p; else ENV.dynMoveGrip?.(e, i - 1, p); },
  xform(e, m) {
    const N = Mx.mul([m[0], m[1], m[2], m[3], 0, 0], Mx.mul(Mx.R(e.rot || 0), [e.sx ?? 1, 0, 0, e.sy ?? 1, 0, 0]));
    const th = Math.atan2(N[1], N[0]);
    e.p = Mx.ap(m, e.p);
    e.rot = th;
    e.sx = Math.hypot(N[0], N[1]);
    e.sy = -Math.sin(th) * N[2] + Math.cos(th) * N[3];
  },
  draw() { /* lo dibuja render.js expandiendo blockEnts */ },
  props: e => {
    const xr = D()?.blocks?.[e.name]?.xref;
    const base = [ro('Nombre', x => x.name, 'text'), ...(xr ? [ro('Referencia externa', () => xr.file, 'text')] : []), ...ptProps('Posición', 'p'),
      num('Escala', x => Math.abs(x.sx ?? 1), (x, v) => { if (v > 0) { x.sx = Math.sign(x.sx || 1) * v; x.sy = Math.sign(x.sy || 1) * v; } }),
      angp('Rotación', x => x.rot || 0, (x, v) => { x.rot = v; }),
      ...(e.clip ? [{ label: 'Delimitación (XCLIP)', type: 'bool', get: x => !x.clip.off, set: (x, v) => { x.clip = { ...x.clip, off: !v }; } }] : [])];
    const defs = blockAttdefs(e.name);
    const dyn = ENV.dynProps?.(e) || [];
    if (!defs.length) return [...base, ...dyn];
    return [...base, ...dyn, { sec: 'Atributos' }, ...defs.map(a => ({ label: a.tag, type: 'text', get: x => attVal(x, a), set: (x, v) => { x.attribs = { ...x.attribs, [a.tag]: v }; } }))];
  },
};

// Discontinuidad de un tipo de línea en pantalla (k: escala de tipos de línea); se ignora si el trazo sería demasiado pequeño
export function applyDash(c, pat, k, R) {
  let d = [];
  if (pat && pat.length) {
    const sc = pat.map(v => Math.abs(v) * (k || 1));
    if (sc.reduce((a, b) => a + b, 0) * R.scale > 4) d = sc.map(v => v || 0.5 / R.scale);
  }
  c.setLineDash(d);
  c.lineCap = d.length && pat.includes(0) ? 'round' : 'butt';
}

// ---------- Línea múltiple ----------
const mlStyle = e => mlStyleOf(D(), e.mlstyle);
const mlcacheG = new WeakMap();
export function mlGeom(e) {
  const st = mlStyle(e), key = JSON.stringify([e.pts, e.closed, e.just, e.scale, e.cuts, st]);
  const hit = mlcacheG.get(e);
  if (hit && hit.key === key) return hit.g;
  const g = mlineGeom(e, st);
  mlcacheG.set(e, { key, g });
  return g;
}
const mlLen = e => G.polyLen(e.pts, e.closed);
TYPES.mline = {
  name: 'Línea múltiple',
  prims: e => mlinePrims(mlGeom(e)),
  bbox: e => { const g = mlGeom(e); return g.arcs.reduce((b, [c, r, a1, a2]) => bbUnion(b, arcBB(c, r, a1, a2)), bbPts(g.elems.flatMap(x => x.pts))); },
  snaps: e => {
    const g = mlGeom(e), mid = [], end = [];
    for (const el of g.elems) for (const r of el.runs) {
      const p = r.pts;
      for (let i = 0; i < (r.closed ? p.length : p.length - 1); i++) mid.push(G.mid(p[i], p[(i + 1) % p.length]));
      end.push(...p);
    }
    return { end, mid };
  },
  grips: e => e.pts,
  moveGrip(e, i, p) { e.pts = e.pts.map((q, j) => (j === i ? p : q)); },
  // Simetría: se invierte el sentido para que los elementos sigan al mismo lado (y los cortes de MLEDIT, con él)
  xform(e, m) {
    const k = Mx.scaleOf(m);
    e.pts = e.pts.map(q => Mx.ap(m, q)); e.scale = (e.scale ?? 1) * k;
    if (e.cuts) e.cuts = e.cuts.map(c => ({ ...c, a: c.a * k, b: c.b * k }));
    if (Mx.det(m) < 0) { e.pts.reverse(); reverseCuts(e); }
  },
  draw(c, e, R, st) {
    const g = mlGeom(e), base = c.getLineDash(), doc = D();
    if (g.fill && !st?.hl) {
      c.save(); c.fillStyle = mlStyle(e).fill; c.beginPath();
      for (const l of g.fill) { l.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); }
      c.fill('evenodd'); c.restore();
    }
    const strokeEl = runs => { c.beginPath(); for (const r of runs) { r.pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); if (r.closed) c.closePath(); } c.stroke(); };
    for (const el of g.elems) {
      const own = !st?.hl && el.color && el.color !== 'BYLAYER' && el.color !== 'BYBLOCK';
      c.strokeStyle = own ? (st?.paper && el.color.toLowerCase() === '#ffffff' ? '#000000' : el.color) : st.color;
      if (!st?.hl && el.ltype && el.ltype !== 'BYLAYER' && el.ltype !== 'BYBLOCK') applyDash(c, (LTYPES[el.ltype] || LTYPES.CONTINUOUS).pat, st.ltscale ?? doc?.settings?.ltscale, R);
      else c.setLineDash(base);
      strokeEl(el.runs);
    }
    c.strokeStyle = st.color; c.setLineDash(base);
    c.beginPath();
    for (const [a, b] of g.lines) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
    for (const [q, r, a1, a2] of g.arcs) { c.moveTo(q.x + r * Math.cos(a1), q.y + r * Math.sin(a1)); c.arc(q.x, q.y, r, a1, a1 + G.sweep(a1, a2)); }
    c.stroke();
  },
  props: [
    { label: 'Estilo', type: 'select', options: () => (D()?.mlineStyles || []).map(s => [s.name, s.name]), get: e => mlStyle(e).name, set: (e, v) => { e.mlstyle = v; } },
    sel('Justificación', ML_JUST, e => e.just || 'top', (e, v) => { e.just = v; }),
    num('Escala', e => e.scale ?? 1, (e, v) => { if (v) e.scale = v; }),
    { label: 'Cerrada', type: 'bool', get: e => !!e.closed, set: (e, v) => { e.closed = v && e.pts.length > 2; } },
    ro('Vértices', e => e.pts.length, 'int'),
    ro('Elementos', e => mlStyle(e).elems.length, 'int'),
    ro('Cortes (MLEDIT)', e => e.cuts?.length || 0, 'int'),
    ro('Longitud (eje)', mlLen),
  ],
};

// ---------- Región ----------
// {loops: [{pts, bulges?}]}: contornos cerrados con el interior a su izquierda (exteriores antihorarios, huecos horarios)
const loopPl = l => ({ pts: l.pts, bulges: l.bulges, closed: true });
const regArea = e => e.loops.reduce((s, l) => s + plArea(loopPl(l)), 0);
const regCentroid = e => { const b = bbPts(e.loops.flatMap(l => l.pts)); return P((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2); };
TYPES.region = {
  name: 'Región',
  prims: e => e.loops.flatMap(l => plSegs(loopPl(l))),
  bbox: e => e.loops.reduce((b, l) => bbUnion(b, TYPES.pline.bbox(loopPl(l))), null),
  snaps: e => {
    const pcs = e.loops.flatMap(l => plPieces(loopPl(l)));
    return { end: e.loops.flatMap(l => l.pts), mid: pcs.map(pc => pieceAt(pc, 0.5)), cen: pcs.filter(pc => pc.bulge).map(pc => pc.prim.c) };
  },
  grips: e => [regCentroid(e)],
  moveGrip(e, i, p) { const d = G.sub(p, regCentroid(e)); e.loops = e.loops.map(l => ({ ...l, pts: l.pts.map(q => G.add(q, d)) })); },
  xform(e, m) {
    const mir = Mx.det(m) < 0;
    e.loops = e.loops.map(l => {
      const pts = l.pts.map(q => Mx.ap(m, q)), b = l.bulges ? l.bulges.map(x => (mir ? -x : x)) : null;
      if (!mir) return b ? { pts, bulges: b } : { pts };
      // Una simetría invierte el sentido de los contornos: se recorren al revés para que el interior quede a la izquierda
      const n = pts.length;
      return { pts: [pts[0], ...pts.slice(1).reverse()], ...(b ? { bulges: pts.map((_, k) => -(b[n - 1 - k] || 0)) } : {}) };
    });
  },
  path(c, e) { for (const l of e.loops) TYPES.pline.path(c, loopPl(l)); },
  props: [
    ro('Contornos', e => e.loops.length, 'int'),
    ro('Huecos', e => e.loops.filter(l => plArea(loopPl(l)) < 0).length, 'int'),
    ro('Área', e => Math.abs(regArea(e))),
    ro('Perímetro', e => e.loops.reduce((s, l) => s + plLength(loopPl(l)), 0)),
    ro('Centro X', e => regCentroid(e).x), ro('Centro Y', e => regCentroid(e).y),
  ],
};

// ---------- Matriz asociativa (arrays.js) ----------
const arrEnts = e => ENV.arrayEnts?.(e) || [];
TYPES.array = {
  name: 'Matriz asociativa',
  prims: e => arrEnts(e).flatMap(v => TYPES[v.type].prims(v)),
  selPrims: e => arrEnts(e).flatMap(v => { const T = TYPES[v.type]; return T.selPrims ? T.selPrims(v) : T.prims(v); }),
  bbox: e => arrEnts(e).reduce((b, v) => bbUnion(b, bboxOf(v)), null) || bbPts([e.base]),
  hit: (e, p) => arrEnts(e).reduce((d, v) => Math.min(d, hitDist(v, p)), Infinity),
  snaps: e => {
    const out = {};
    for (const v of arrEnts(e)) { const s = snapsOf(v); for (const k in s) (out[k] ||= []).push(...s[k]); }
    return out;
  },
  grips: e => (ENV.arrayGrips?.(e) || []).map(g => g.p),
  gripKinds: e => (ENV.arrayGrips?.(e) || []).map(g => (g.kind ? 'array' : '')),
  moveGrip(e, i, p) { ENV.arrayMoveGrip?.(e, i, p); },
  // La transformación se acumula en la matriz M (las entidades de origen y el recorrido quedan en coordenadas locales)
  xform(e, m) { e.M = Mx.mul(m, e.M || Mx.I()); e._xf = true; },
  draw() { /* lo dibuja render.js expandiendo los elementos */ },
  props: e => ENV.arrayProps?.(e) || [],
};

// ---------- Ventana gráfica (espacio papel) ----------
const vpCorners = e => [e.p1, P(e.p2.x, e.p1.y), e.p2, P(e.p1.x, e.p2.y)];
export const scaleLabel = s => { const f = STD_SCALES.find(([, v]) => Math.abs(v - s) / v < 1e-6); return f ? f[0] : s >= 1 ? `${+s.toFixed(3)}:1` : `1:${+(1 / s).toFixed(3)}`; };
TYPES.vport = {
  name: 'Ventana gráfica',
  prims: e => closedSegs(vpCorners(e)),
  bbox: e => bbPts([e.p1, e.p2]),
  snaps: e => ({ end: vpCorners(e), mid: closedSegs(vpCorners(e)).map(s => G.mid(s.a, s.b)) }),
  grips: vpCorners,
  moveGrip(e, i, p) {
    const c = vpCorners(e), o = c[(i + 2) % 4];
    e.p1 = P(Math.min(o.x, p.x), Math.min(o.y, p.y)); e.p2 = P(Math.max(o.x, p.x), Math.max(o.y, p.y));
  },
  xform(e, m) {
    const b = bbPts(vpCorners(e).map(q => Mx.ap(m, q)));
    e.p1 = P(b.x1, b.y1); e.p2 = P(b.x2, b.y2); e.s *= Mx.scaleOf(m);
  },
  path(c, e) { c.rect(e.p1.x, e.p1.y, e.p2.x - e.p1.x, e.p2.y - e.p1.y); },
  props: [
    sel('Escala estándar', () => [...STD_SCALES.map(([l, v]) => [String(v), l]), ['custom', 'Personalizada']], e => (STD_SCALES.find(([, v]) => Math.abs(v - e.s) / v < 1e-6) ? String(STD_SCALES.find(([, v]) => Math.abs(v - e.s) / v < 1e-6)[1]) : 'custom'), (e, v) => { if (v !== 'custom') e.s = +v; }),
    num('Escala (papel/modelo)', e => e.s, (e, v) => { if (v > 0) e.s = v; }),
    num('Centro modelo X', e => e.cx, (e, v) => { e.cx = v; }),
    num('Centro modelo Y', e => e.cy, (e, v) => { e.cy = v; }),
    ro('Ancho', e => e.p2.x - e.p1.x), ro('Alto', e => e.p2.y - e.p1.y),
    ro('Capas inutilizadas', e => (e.frozen?.length ? e.frozen.join(', ') : '—'), 'text'),
  ],
};

// ---------- API genérica ----------
export const primsOf = e => TYPES[e.type].prims(e);
export const bboxOf = e => TYPES[e.type].bbox(e);
export const snapsOf = e => TYPES[e.type].snaps(e);
export const gripsOf = e => TYPES[e.type].grips(e);
export const xformEnt = (e, m) => { TYPES[e.type].xform(e, m); return e; };
export const cloneEnt = e => JSON.parse(JSON.stringify(e));

export function hitDist(e, p) {
  const T = TYPES[e.type];
  if (T.hit) return T.hit(e, p);
  let d = Infinity;
  for (const q of T.prims(e)) d = Math.min(d, G.dist(p, G.nearPrim(p, q)));
  return d;
}
export function inWindow(e, r) {
  const b = bboxOf(e);
  return b.x1 >= r.x1 && b.x2 <= r.x2 && b.y1 >= r.y1 && b.y2 <= r.y2;
}
export function crosses(e, r) {
  if (inWindow(e, r)) return true;
  if (!G.bbOverlap(bboxOf(e), r)) return false;
  if (e.type === 'point') return G.inRect(e.p, r);
  const T = TYPES[e.type];
  if (e.type === 'hatch' && T.hit(e, G.P((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2)) === 0) return true;
  return (T.selPrims ? T.selPrims(e) : T.prims(e)).some(q => G.primCrossRect(q, r));
}

export const propsOf = e => { const p = TYPES[e.type].props; return typeof p === 'function' ? p(e) : p; };

export function describe(e) {
  const T = TYPES[e.type], out = [`${T.name}  Capa: "${e.layer}"`];
  for (const pr of propsOf(e)) {
    if (pr.sec) { out.push(`  ${pr.sec}:`); continue; }
    let v = pr.get(e);
    if (pr.type === 'mtext') v = String(v).replace(/\n/g, ' ¶ ');
    out.push(`   ${pr.label}: ${pr.type === 'num' ? fmt(v, 4) : pr.type === 'ang' || pr.type === 'deg' ? fmt(pr.type === 'ang' ? G.deg(G.normAng(v)) : v, 2) + '°' : v}`);
  }
  return out;
}
