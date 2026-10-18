// Tipos de entidad: geometría, referencias, pinzamientos, transformaciones y propiedades.
import * as G from './geom.js';
import { PATTERNS, famsOf, famLines } from './patterns.js';
const { P, Mx, TAU } = G;

export const ENV = { doc: null };
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

// ---------- Colores ACI (AutoCAD Color Index) ----------
const ACI_BASIC = { 1: [255, 0, 0], 2: [255, 255, 0], 3: [0, 255, 0], 4: [0, 255, 255], 5: [0, 0, 255], 6: [255, 0, 255], 7: [255, 255, 255], 8: [128, 128, 128], 9: [192, 192, 192] };
function aciRGB(i) {
  if (ACI_BASIC[i]) return ACI_BASIC[i];
  if (i >= 250) { const g = [51, 91, 132, 173, 214, 255][i - 250]; return [g, g, g]; }
  const h = (Math.floor(i / 10) - 1) * 15, k = i % 10;
  const v = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k], s = k % 2 ? 0.5 : 1;
  const f = n => { const kk = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1)))); };
  return [f(5), f(3), f(1)];
}
const hex2 = n => n.toString(16).padStart(2, '0');
const rgbHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const ACI_TABLE = Array.from({ length: 256 }, (_, i) => (i ? aciRGB(i) : [0, 0, 0]));
export const aciToHex = i => rgbHex(ACI_TABLE[Math.max(1, Math.min(255, i))]);
export function hexToAci(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 7;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  let best = 7, bd = Infinity;
  for (let i = 1; i < 256; i++) {
    const [R, Gr, B] = ACI_TABLE[i], d = (R - r) ** 2 + (Gr - g) ** 2 + (B - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
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

// ---------- Texto ----------
export function textBox(t) {
  const str = t.text ?? t.str, w = textWidth(str, t.h, t.style);
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
  c.fillText(t.text ?? t.str, 0, 0);
  c.restore();
}

// ---------- Cotas ----------
export const DEFAULT_DIMSTYLE = { name: 'ISO-25', txt: 2.5, asz: 2.5, exo: 0.625, exe: 1.25, gap: 0.625, dec: 2, scale: 1, arrow: 'closed', textStyle: 'Standard', suffix: '' };
const dimStyleOf = e => (D()?.dimStyle ? D().dimStyle(e.style) : DEFAULT_DIMSTYLE);

export function dimParts(e) {
  const ds = dimStyleOf(e), k = ds.scale || 1;
  const asz = ds.asz * k, h = ds.txt * k, gap = ds.gap * k, exo = ds.exo * k, exe = ds.exe * k;
  const lines = [], arrows = [], dots = [];
  const arrow = (tip, dirIn) => {
    const b = G.add(tip, G.mul(dirIn, asz)), pn = G.perp(dirIn), w = asz / 6;
    switch (ds.arrow) {
      case 'open': lines.push([tip, G.add(b, G.mul(pn, asz / 3))], [tip, G.add(b, G.mul(pn, -asz / 3))]); break;
      case 'tick': { const v = G.mul(G.rot(dirIn, Math.PI / 4), asz / 2); lines.push([G.sub(tip, v), G.add(tip, v)]); break; }
      case 'dot': dots.push([tip, asz / 4]); break;
      case 'none': break;
      default: arrows.push([tip, G.add(b, G.mul(pn, w)), G.add(b, G.mul(pn, -w))]);
    }
  };
  const num = v => fmt(v, ds.dec) + (ds.suffix || '');
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
    return { lines, arrows, dots, val, text: { p: G.add(end, P(right ? gap : -gap, -h / 2)), rot: 0, h, str: e.text ? e.text.replace('<>', base) : base, align: right ? 'l' : 'r', style: ds.textStyle } };
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
  const str = e.text ? e.text.replace('<>', num(val)) : num(val);
  return { lines, arrows, dots, val, d1, d2, text: { p: G.add(G.mid(d1, d2), G.mul(up, gap)), rot: ta, h, str, align: 'c', style: ds.textStyle } };
}

// ---------- Bloques ----------
export function insertMatrix(e, b) {
  let M = Mx.T(-b.base.x, -b.base.y);
  M = Mx.mul([e.sx ?? 1, 0, 0, e.sy ?? 1, 0, 0], M);
  M = Mx.mul(Mx.R(e.rot || 0), M);
  return Mx.mul(Mx.T(e.p.x, e.p.y), M);
}
const vcache = new WeakMap();
let depth = 0;
export function blockEnts(e) {
  const b = D()?.blocks?.[e.name];
  if (!b || depth > 12) return [];
  const key = `${b.ver || 0}|${e.p.x},${e.p.y},${e.sx},${e.sy},${e.rot},${e.layer},${e.color},${e.ltype},${e.lw}`;
  const hit = vcache.get(e);
  if (hit && hit.key === key && hit.b === b) return hit.ents;
  const M = insertMatrix(e, b);
  depth++;
  const ents = b.ents.map(x => {
    const v = xformEnt(cloneEnt(x), M);
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

const dimSegs = d => [...d.lines.map(([a, b]) => ({ k: 's', a, b }))];
TYPES.dim = {
  name: 'Cota',
  prims: e => dimSegs(dimParts(e)),
  selPrims: e => { const d = dimParts(e); return [...dimSegs(d), ...closedSegs(textBox(d.text))]; },
  bbox: e => { const d = dimParts(e); return bbPts([...d.lines.flat(), ...d.arrows.flat(), ...textBox(d.text)]); },
  hit(e, p) {
    const d = dimParts(e);
    if (G.pointInPoly(p, textBox(d.text))) return 0;
    return Math.min(...d.lines.map(([a, b]) => G.dist(p, G.nearSeg(p, a, b).p)));
  },
  snaps: e => { const d = dimParts(e); return { end: d.lines.flat(), nod: [e.p1, e.p2] }; },
  grips: e => [e.p1, e.p2, e.p3],
  moveGrip(e, i, p) { e[['p1', 'p2', 'p3'][i]] = p; },
  xform(e, m) {
    e.p1 = Mx.ap(m, e.p1); e.p2 = Mx.ap(m, e.p2); e.p3 = Mx.ap(m, e.p3);
    if (e.kind === 'lin') { const v = Mx.apV(m, P(Math.cos(e.rot), Math.sin(e.rot))); e.rot = Math.atan2(v.y, v.x); }
  },
  draw(c, e, R) {
    const d = dimParts(e);
    c.beginPath();
    for (const [a, b] of d.lines) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
    c.stroke();
    c.beginPath();
    for (const [a, b, q] of d.arrows) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(q.x, q.y); c.closePath(); }
    for (const [p, r] of d.dots) { c.moveTo(p.x + r, p.y); c.arc(p.x, p.y, r, 0, TAU); }
    c.fill();
    drawText(c, R, d.text);
  },
  props: [ro('Medida', e => dimParts(e).val),
    { label: 'Estilo de cota', type: 'select', options: () => D().dimStyles.map(s => [s.name, s.name]), get: e => e.style || D().dimStyles[0].name, set: (e, v) => { e.style = v; } },
    { label: 'Texto (<> = medida)', type: 'text', get: e => e.text || '', set: (e, v) => { e.text = v; } }],
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
  moveGrip(e, i, p) { const g = this.grips(e)[0], d = G.sub(p, g); e.loops = e.loops.map(l => l.map(q => G.add(q, d))); },
  xform(e, m) {
    e.loops = e.loops.map(l => l.map(q => Mx.ap(m, q)));
    const v = Mx.apV(m, P(1, 0)), r = G.deg(Math.atan2(v.y, v.x));
    e.angle = Mx.det(m) < 0 ? -(e.angle || 0) + r : (e.angle || 0) + r;
    e.scale = (e.scale || 1) * Mx.scaleOf(m);
  },
  draw(c, e, R) {
    c.save();
    c.beginPath();
    for (const l of e.loops) { l.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); }
    if (e.pattern === 'SOLID') { c.fill('evenodd'); c.restore(); return; }
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
  props: [
    sel('Patrón', () => Object.entries(PATTERNS).map(([k, v]) => [k, v.desc]), e => e.pattern, (e, v) => { e.pattern = v; }),
    num('Escala', e => e.scale || 1, (e, v) => { if (v > 0) e.scale = v; }),
    num('Ángulo (°)', e => e.angle || 0, (e, v) => { e.angle = v; }),
    ro('Contornos', e => e.loops.length, 'int'),
    ro('Área', e => hatchArea(e)),
  ],
};

// ---------- Referencia a bloque ----------
TYPES.insert = {
  name: 'Referencia a bloque',
  prims: e => blockEnts(e).flatMap(v => TYPES[v.type].prims(v)),
  selPrims: e => blockEnts(e).flatMap(v => { const T = TYPES[v.type]; return T.selPrims ? T.selPrims(v) : T.prims(v); }),
  bbox: e => blockEnts(e).reduce((b, v) => bbUnion(b, bboxOf(v)), null) || bbPts([e.p]),
  hit: (e, p) => blockEnts(e).reduce((d, v) => Math.min(d, hitDist(v, p)), Infinity),
  snaps: e => {
    const out = { ins: [e.p] };
    for (const v of blockEnts(e)) { const s = snapsOf(v); for (const k in s) (out[k] ||= []).push(...s[k]); }
    return out;
  },
  grips: e => [e.p],
  moveGrip(e, i, p) { e.p = p; },
  xform(e, m) {
    const N = Mx.mul([m[0], m[1], m[2], m[3], 0, 0], Mx.mul(Mx.R(e.rot || 0), [e.sx ?? 1, 0, 0, e.sy ?? 1, 0, 0]));
    const th = Math.atan2(N[1], N[0]);
    e.p = Mx.ap(m, e.p);
    e.rot = th;
    e.sx = Math.hypot(N[0], N[1]);
    e.sy = -Math.sin(th) * N[2] + Math.cos(th) * N[3];
  },
  draw() { /* lo dibuja render.js expandiendo blockEnts */ },
  props: [ro('Nombre', e => e.name, 'text'), ...ptProps('Posición', 'p'),
    num('Escala', e => Math.abs(e.sx ?? 1), (e, v) => { if (v > 0) { e.sx = Math.sign(e.sx || 1) * v; e.sy = Math.sign(e.sy || 1) * v; } }),
    angp('Rotación', e => e.rot || 0, (e, v) => { e.rot = v; })],
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

export function describe(e) {
  const T = TYPES[e.type], out = [`${T.name}  Capa: "${e.layer}"`];
  for (const pr of T.props) {
    const v = pr.get(e);
    out.push(`   ${pr.label}: ${pr.type === 'num' ? fmt(v, 4) : pr.type === 'ang' || pr.type === 'deg' ? fmt(pr.type === 'ang' ? G.deg(G.normAng(v)) : v, 2) + '°' : v}`);
  }
  return out;
}
