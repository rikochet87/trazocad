import { pointMarker } from './survey.js';
import { labelEntity } from './gis.js';
// Dibujado en canvas: capa base (rejilla, modelo, presentaciones) y capa superpuesta (cursor, selección, vistas previas).
import * as G from './geom.js';
import { TYPES, gripsOf, blockEnts, ENV, textBox, dimParts, bboxOf, bbUnion, insertClip, applyDash } from './entities.js';
const arrayEntsOf = e => ENV.arrayEnts?.(e) || [];
import { linsOf, rotsOf } from './dynblock.js';
import { evalParams, refGeom, consDim, refIds, DIM_TYPES } from './constraints.js';
import { ucsOf, isWorld } from './ucs.js';
import { toFrame, fromFrame, vpModelBox } from './view.js';
import { annoEff, ANNO, vpScale, PAPER_SCALE } from './annoscale.js';

export const BG = '#212830';
const LAYOUT_BG = '#3a4049';
const BEDIT_BG = '#2a2f37';
const HL = 'rgba(47,140,255,0.45)';
const SNAP_COLOR = '#d4e157';
const TRACK_COLOR = '#58d68d';
export const ISO_AXES = { top: [30, 150], left: [90, 150], right: [30, 90] };

// Contexto de dibujo con el origen desplazado. El canvas guarda las coordenadas y la transformación en coma flotante de
// 32 bits (unos 7 dígitos): con coordenadas grandes o mucho zoom, los trazos tiemblan y se descolocan. Tras setWorld, las
// coordenadas del dibujo se pasan al canvas restándoles el centro de la vista (rx, ry), calculado en doble precisión; en
// coordenadas de pantalla (después de setTransform) pasan tal cual.
const PASS_PROPS = ['strokeStyle', 'fillStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'font', 'textAlign', 'textBaseline', 'direction', 'globalAlpha', 'globalCompositeOperation', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'filter'];
const PASS_FNS = ['beginPath', 'closePath', 'stroke', 'fill', 'clip', 'setLineDash', 'getLineDash', 'measureText', 'createPattern', 'putImageData', 'getImageData', 'createImageData', 'isPointInPath', 'isPointInStroke', 'resetTransform', 'getTransform'];
export class ShiftCtx {
  constructor(c) { this.c = c; this.rx = 0; this.ry = 0; this.world = false; this.stack = []; }
  get canvas() { return this.c.canvas; }
  save() { this.stack.push(this.world); this.c.save(); }
  restore() { if (this.stack.length) this.world = this.stack.pop(); this.c.restore(); }
  setTransform(...a) { this.world = false; this.c.setTransform(...a); }
  // Pasar a un sistema local: con translate, el nuevo origen es el punto del dibujo (x, y); con giros o escalas sin
  // traslación previa, el origen del dibujo
  translate(x, y) { if (this.world) { this.world = false; this.c.translate(x - this.rx, y - this.ry); } else this.c.translate(x, y); }
  leave() { if (this.world) { this.world = false; this.c.translate(-this.rx, -this.ry); } }
  rotate(a) { this.leave(); this.c.rotate(a); }
  scale(x, y) { this.leave(); this.c.scale(x, y); }
  transform(...a) { this.leave(); this.c.transform(...a); }
  moveTo(x, y) { if (this.world) this.c.moveTo(x - this.rx, y - this.ry); else this.c.moveTo(x, y); }
  lineTo(x, y) { if (this.world) this.c.lineTo(x - this.rx, y - this.ry); else this.c.lineTo(x, y); }
  arc(x, y, ...a) { if (this.world) this.c.arc(x - this.rx, y - this.ry, ...a); else this.c.arc(x, y, ...a); }
  ellipse(x, y, ...a) { if (this.world) this.c.ellipse(x - this.rx, y - this.ry, ...a); else this.c.ellipse(x, y, ...a); }
  arcTo(x1, y1, x2, y2, r) { const { rx, ry } = this.world ? this : { rx: 0, ry: 0 }; this.c.arcTo(x1 - rx, y1 - ry, x2 - rx, y2 - ry, r); }
  quadraticCurveTo(a, b, x, y) { const { rx, ry } = this.world ? this : { rx: 0, ry: 0 }; this.c.quadraticCurveTo(a - rx, b - ry, x - rx, y - ry); }
  bezierCurveTo(a, b, e, f, x, y) { const { rx, ry } = this.world ? this : { rx: 0, ry: 0 }; this.c.bezierCurveTo(a - rx, b - ry, e - rx, f - ry, x - rx, y - ry); }
  rect(x, y, w, h) { if (this.world) this.c.rect(x - this.rx, y - this.ry, w, h); else this.c.rect(x, y, w, h); }
  fillRect(x, y, w, h) { if (this.world) this.c.fillRect(x - this.rx, y - this.ry, w, h); else this.c.fillRect(x, y, w, h); }
  strokeRect(x, y, w, h) { if (this.world) this.c.strokeRect(x - this.rx, y - this.ry, w, h); else this.c.strokeRect(x, y, w, h); }
  clearRect(x, y, w, h) { if (this.world) this.c.clearRect(x - this.rx, y - this.ry, w, h); else this.c.clearRect(x, y, w, h); }
  fillText(t, x, y, ...a) { if (this.world) this.c.fillText(t, x - this.rx, y - this.ry, ...a); else this.c.fillText(t, x, y, ...a); }
  strokeText(t, x, y, ...a) { if (this.world) this.c.strokeText(t, x - this.rx, y - this.ry, ...a); else this.c.strokeText(t, x, y, ...a); }
  drawImage(img, ...a) {
    if (this.world) { const k = a.length === 8 ? 4 : 0; a[k] -= this.rx; a[k + 1] -= this.ry; }
    this.c.drawImage(img, ...a);
  }
  createLinearGradient(x0, y0, x1, y1) { const { rx, ry } = this.world ? this : { rx: 0, ry: 0 }; return this.c.createLinearGradient(x0 - rx, y0 - ry, x1 - rx, y1 - ry); }
  createRadialGradient(x0, y0, r0, x1, y1, r1) { const { rx, ry } = this.world ? this : { rx: 0, ry: 0 }; return this.c.createRadialGradient(x0 - rx, y0 - ry, r0, x1 - rx, y1 - ry, r1); }
}
for (const k of PASS_PROPS) Object.defineProperty(ShiftCtx.prototype, k, { get() { return this.c[k]; }, set(v) { this.c[k] = v; } });
for (const k of PASS_FNS) ShiftCtx.prototype[k] = function (...a) { return this.c[k](...a); };

// rot: giro de la vista (la dirección del dibujo con ese ángulo se ve horizontal)
export function makeRV(cx, cy, scale, w, h, dpr, ox = 0, oy = 0, rot = 0) {
  return { scale, dpr, w, h, cx, cy, ox, oy, rot, toScreen: p => { const [u, v] = toFrame(rot, p.x - cx, p.y - cy); return { x: u * scale + ox + w / 2, y: oy + h / 2 - v * scale }; } };
}
export const makeR = (view, dpr) => makeRV(view.cx, view.cy, view.scale, view.w, view.h, dpr, view.ox || 0, view.oy || 0, view.rot || 0);
export function setWorld(c, R) {
  const s = R.scale, d = R.dpr, r = R.rot || 0, co = Math.cos(r), sn = Math.sin(r);
  if (c instanceof ShiftCtx) { // el centro de la vista pasa a ser el origen de las coordenadas que recibe el canvas
    c.setTransform(d * s * co, d * s * sn, d * s * sn, -d * s * co, d * ((R.ox || 0) + R.w / 2), d * ((R.oy || 0) + R.h / 2));
    c.rx = R.cx; c.ry = R.cy; c.world = true;
    return;
  }
  const ex = (R.ox || 0) + R.w / 2 - s * (co * R.cx + sn * R.cy), fy = (R.oy || 0) + R.h / 2 - s * (sn * R.cx - co * R.cy);
  c.setTransform(d * s * co, d * s * sn, d * s * sn, -d * s * co, d * ex, d * fy);
}
// Dibujo en caché del espacio modelo con muchos objetos: una imagen de la vista con un margen alrededor, alineada con los
// ejes y la escala de la vista. Al encuadrar se desplaza y sólo se dibujan las franjas nuevas; al cambiar objetos, sólo
// los rectángulos que tocan (antes y después, del índice espacial). Cambiar la escala, el giro, las capas o los estilos
// la invalida. Lo pendiente se reparte entre fotogramas (budget, en ms) con la imagen anterior escalada como vista previa.
const CACHE_MIN = 3000, CACHE_MARGIN = 128, BAND = 256;
export const TILES = { min: CACHE_MIN, on: true, budget: 70 }; // budget 0: dibujarlo todo de una vez
// Rectángulo a menos rectángulo b: hasta cuatro rectángulos
function rectMinus(a, b) {
  if (b.x2 <= a.x1 || b.x1 >= a.x2 || b.y2 <= a.y1 || b.y1 >= a.y2) return [a];
  const out = [];
  if (b.y1 > a.y1) out.push({ x1: a.x1, y1: a.y1, x2: a.x2, y2: b.y1 });
  if (b.y2 < a.y2) out.push({ x1: a.x1, y1: b.y2, x2: a.x2, y2: a.y2 });
  const y1 = Math.max(a.y1, b.y1), y2 = Math.min(a.y2, b.y2);
  if (b.x1 > a.x1) out.push({ x1: a.x1, y1, x2: b.x1, y2 });
  if (b.x2 < a.x2) out.push({ x1: b.x2, y1, x2: a.x2, y2 });
  return out;
}
// Vista del modelo dentro de una ventana gráfica (con su giro), a partir de la vista del papel
export function vpR(R, vp) {
  const vcx = (vp.p1.x + vp.p2.x) / 2, vcy = (vp.p1.y + vp.p2.y) / 2, t = vp.twist || 0;
  const [x, y] = fromFrame(t, (R.cx - vcx) / vp.s, (R.cy - vcy) / vp.s);
  return makeRV(vp.cx + x, vp.cy + y, R.scale * vp.s, R.w, R.h, R.dpr, R.ox || 0, R.oy || 0, t + (R.rot || 0));
}
// Rectángulo del modelo que contiene lo visible a través de la ventana
export const vpModelRect = vpModelBox;

// Color semitransparente (#rrggbb → rgba)
export const fadeColor = (col, a) => { const m = /^#(..)(..)(..)$/.exec(col); return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : col; };
// Factor de escala de tipo de línea dentro de una ventana: el suyo y, con PSLTSCALE = 1, el que deja los trazos con el
// mismo tamaño en el papel en todas las ventanas (como en AutoCAD)
export const vpLtk = (doc, vp) => (vp.ltscale || 1) * (doc.settings.psltscale ? 1 / (vp.s || 1) : 1);
// st: {color, px, pat, ltscale}; sty: función entidad → st (para las entidades de los bloques);
// vis: función entidad → visible, aplicada también a las entidades de los bloques
export function paintEntity(c, e, R, st, sty, vis) {
  e = annoEff(e); // anotativo: representación de la escala actual; si no la tiene, atenuado (ANNOALLVISIBLE = 1)
  if (e._annoOff && !st.hl) st = { ...st, color: fadeColor(st.color, 0.35) };
  if (e.type === 'insert') {
    const k = insertClip(e);
    if (k) { // delimitación (XCLIP): recorte del contorno, o de todo lo de fuera si está invertida
      c.save();
      c.beginPath();
      if (k.invert) { const b = bboxOf({ ...e, clip: null }), m = Math.max(b.x2 - b.x1, b.y2 - b.y1) + 1; c.rect(b.x1 - m, b.y1 - m, b.x2 - b.x1 + 2 * m, b.y2 - b.y1 + 2 * m); }
      k.poly.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.closePath();
      c.clip('evenodd');
    }
    for (const v of blockEnts(e)) if (!vis || vis(v)) paintEntity(c, v, R, sty ? sty(v) : st, sty, vis);
    if (k) {
      c.restore();
      const fr = ENV.doc?.settings?.xclipFrame ?? 2; // 0: oculto, 1: visible e impreso, 2: sólo en pantalla
      if (fr === 1 || (fr === 2 && ENV.onScreen) || st.hl) paintEntity(c, { type: 'pline', pts: k.poly, closed: true }, R, { ...st, pat: [] });
    }
    return;
  }
  if (e.type === 'array') { for (const v of arrayEntsOf(e)) if (!vis || vis(v)) paintEntity(c, v, R, sty && !st.hl ? sty(v) : st, st.hl ? null : sty, vis); return; }
  c.strokeStyle = st.color; c.fillStyle = st.color;
  c.lineWidth = st.px / R.scale;
  applyDash(c, st.pat, st.ltscale || 1, R);
  const T = TYPES[e.type];
  if (st.gisFill && !st.hl && (e.type === 'region' || e.type === 'pline' && e.closed)) { c.save(); c.globalAlpha = 0.22; c.beginPath(); T.path(c, e, R); c.fill('evenodd'); c.restore(); }
  if (e.topoAnalysis && !st.hl) { c.save(); c.globalAlpha=.65; c.beginPath(); e.pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y)); c.closePath(); c.fill(); c.restore(); }
  const marker = e.topoPoint && pointMarker(ENV.doc, e);
  if (marker) { c.beginPath(); TYPES[marker.type].path(c, marker, R); c.stroke(); }
  else if (T.draw) T.draw(c, e, R, st);
  else { c.beginPath(); T.path(c, e, R); c.stroke(); }
  if (!st.hl && e.data) { const label = labelEntity(ENV.doc, e); if (label) paintEntity(c, label, R, sty ? sty(label) : { ...st, color: label.color, gisFill: false }, sty, vis); }
}

export class Renderer {
  constructor(app, base, over) {
    this.app = app; this.base = base; this.over = over;
    this.cb = new ShiftCtx(base.getContext('2d')); this.co = new ShiftCtx(over.getContext('2d'));
    this.tc = {}; // imagen en caché del modelo (drawModelTiles)
    ENV.onImageLoad = () => this.flushTiles(); // una imagen o una fuente cargada cambia el aspecto
    document.fonts?.addEventListener?.('loadingdone', () => { this.flushTiles(); this.invalidate(); });
    this.dpr = 1; this.baseDirty = true; this.overDirty = true;
    const tick = () => {
      if (this.baseDirty) { this.baseDirty = false; this.drawBase(); }
      if (this.overDirty) { this.overDirty = false; this.drawOver(); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const r = this.base.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    for (const cv of [this.base, this.over]) {
      cv.width = Math.max(1, Math.round(r.width * this.dpr));
      cv.height = Math.max(1, Math.round(r.height * this.dpr));
      cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    }
    this.app.setViewSize(r.width, r.height);
    this.invalidate();
  }
  invalidate(base = true) { if (base) this.baseDirty = true; this.overDirty = true; }
  R() { return makeR(this.app.view, this.dpr); }

  // ---------- Escena ----------
  paintList(c, R, ents, sty, vis = e => this.app.doc.visible(e)) {
    for (const e of ents) if (vis(e)) paintEntity(c, e, R, sty(e), sty, vis);
  }
  drawModel(c, R, rect, sty, vis) {
    const doc = this.app.doc;
    setWorld(c, R);
    this.paintList(c, R, this.app.spatial.of(doc.model, doc).query(rect, true), sty, vis);
  }
  drawViewport(c, R, vp, sty) {
    c.save();
    setWorld(c, R);
    c.beginPath(); c.rect(vp.p1.x, vp.p1.y, vp.p2.x - vp.p1.x, vp.p2.y - vp.p1.y); c.clip();
    const k = vpLtk(this.app.doc, vp), vsty = k === 1 ? sty : e => { const s = sty(e); return { ...s, ltscale: (s.ltscale || 1) * k }; };
    const prev = ANNO.override;
    ANNO.override = vpScale(this.app.doc, vp); // escala de anotación de la ventana: la suya
    this.app.basemap?.draw(c, vpR(R, vp), !!c.images);
    try { this.drawModel(c, vpR(R, vp), vpModelRect(vp), vsty, this.app.doc.visibleIn(vp)); } finally { ANNO.override = prev; }
    c.restore();
  }
  drawLayout(c, R, layout, sty, forExport = false) {
    const doc = this.app.doc;
    setWorld(c, R);
    if (!forExport) {
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 14 * R.dpr; c.shadowOffsetX = 3 * R.dpr; c.shadowOffsetY = 3 * R.dpr;
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, layout.w, layout.h);
      c.restore();
      c.strokeStyle = '#9aa3ad'; c.lineWidth = 1 / R.scale; c.setLineDash([4 / R.scale, 3 / R.scale]);
      c.strokeRect(5, 5, layout.w - 10, layout.h - 10);
      c.setLineDash([]);
    }
    const on = x => doc.layer(x.layer).on; // en el papel no cuentan las capas inutilizadas en ventanas
    const prev = ENV.layout;
    ENV.layout = layout; // campos %<Presentación>% y %<Escala>%
    const pa = ANNO.override;
    ANNO.override = PAPER_SCALE; // los objetos anotativos del papel, a 1:1
    try {
      for (const e of layout.ents) {
        if (e.type === 'vport') this.drawViewport(c, R, e, sty);
        setWorld(c, R);
        if (on(e)) paintEntity(c, e, R, sty(e), sty, on);
      }
    } finally { ANNO.override = pa; ENV.layout = prev; }
  }

  // ENV.onScreen: dibujo en pantalla (los marcos de delimitación con XCLIPFRAME = 2 sólo se ven aquí)
  drawBase() { ENV.onScreen = true; try { this.drawScene(); } finally { ENV.onScreen = false; } }
  drawScene() {
    const c = this.cb, app = this.app, R = this.R();
    c.setTransform(1, 0, 0, 1, 0, 0);
    const lay = app.layoutShown();
    c.fillStyle = lay ? LAYOUT_BG : BG;
    c.fillRect(0, 0, this.base.width, this.base.height);
    const sty = e => app.styleFor(e);
    if (lay) {
      const PR = makeR(app.paperView, this.dpr);
      this.drawLayout(c, PR, lay, sty);
      return;
    }
    if (app.doc.bedit) { // editor de bloques: fondo propio, entidades del bloque y punto base
      c.fillStyle = BEDIT_BG; c.fillRect(0, 0, this.base.width, this.base.height);
      if (app.T.grid) this.drawGrid(c, R);
      setWorld(c, R);
      const be = app.doc.bedit, hid = new Set(be.dyn?.vis?.hide?.[be.visCur] || []);
      const fade = col => { const m = /^#(..)(..)(..)$/.exec(col); return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0.22)` : col; };
      this.paintList(c, R, app.idx().query(app.view.rect(), true), e => (hid.has(e.id) ? { ...sty(e), color: fade(sty(e).color) } : sty(e)));
      this.drawDynParams(c, R, be);
      this.drawBasePoint(c, app.view.toScreen(be.base));
      this.drawUCS(c);
      return;
    }
    const tiles = app.modelTiles(), d = this.dpr;
    if (tiles) { // ventanas en mosaico: cada una con su vista, recortada a su rectángulo; la activa, con el marco resaltado
      for (const t of tiles) {
        const v = t.view, Rt = makeR(v, d);
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0); c.beginPath(); c.rect(v.ox * d, v.oy * d, v.w * d, v.h * d); c.clip();
        app.basemap?.draw(c, Rt);
        if (app.T.grid) this.drawGrid(c, Rt, v);
        this.drawModel(c, Rt, v.rect(), sty);
        if (v === app.view) { this.drawConstraints(c, Rt); app.gps?.draw(c, Rt); }
        this.drawUCS(c, v);
        c.restore();
      }
      c.setTransform(d, 0, 0, d, 0, 0); c.setLineDash([]);
      for (const t of tiles) { const v = t.view; c.strokeStyle = '#4a5462'; c.lineWidth = 1; c.strokeRect(v.ox + 0.5, v.oy + 0.5, v.w - 1, v.h - 1); }
      const v = app.view; c.strokeStyle = '#1e90d6'; c.lineWidth = 2; c.strokeRect(v.ox + 1, v.oy + 1, v.w - 2, v.h - 2);
      return;
    }
    app.basemap?.draw(c, R);
    if (app.T.grid) this.drawGrid(c, R);
    if (TILES.on && app.doc.model.length >= TILES.min) this.drawModelTiles(c, sty);
    else this.drawModel(c, R, app.view.rect(), sty);
    this.drawConstraints(c, R);
    app.gps?.draw(c, R);
    this.drawUCS(c);
  }

  // ---------- Dibujo en caché ----------
  flushTiles() { const t = this.tc; t.key = null; t.prev = null; this.invalidate(); }
  drawModelTiles(c, sty) {
    const app = this.app, doc = app.doc, v = app.view, d = this.dpr, tree = app.spatial.of(doc.model, doc);
    const sd = v.scale * d, rot = v.rot || 0, M = CACHE_MARGIN;
    const rest = [rot, d, app.T.lwt, doc.activeVp, JSON.stringify(doc.layers), JSON.stringify(doc.settings)].join('|'), key = `${v.scale}|${rest}`;
    const fr = p => { const [u, w] = toFrame(rot, p.x, p.y); return [u * sd, -w * sd]; }; // píxeles de la vista (sin centrar)
    const [fcx, fcy] = fr({ x: v.cx, y: v.cy }), x0 = (v.ox + v.w / 2) * d - fcx, y0 = (v.oy + v.h / 2) * d - fcy;
    // Zona visible en píxeles de la vista
    const vis = { x1: v.ox * d - x0, y1: v.oy * d - y0, x2: (v.ox + v.w) * d - x0, y2: (v.oy + v.h) * d - y0 };
    let t = this.tc;
    const fresh = () => { // imagen nueva que cubre la vista con margen; toda pendiente de dibujar
      const W = Math.ceil(v.w * d) + 2 * M, H = Math.ceil(v.h * d) + 2 * M;
      const cv = t.cv?.width === W && t.cv?.height === H && !t.prev ? t.cv : Object.assign(document.createElement('canvas'), { width: W, height: H });
      return { cv, W, H, ax: Math.floor(vis.x1) - M, ay: Math.floor(vis.y1) - M };
    };
    if (key !== t.key || tree !== t.tree) {
      // Sólo cambió la escala (zoom): la imagen anterior, escalada, sirve de vista previa de lo que falta por dibujar
      const prev = tree === t.tree && rest === t.rest && t.cv ? { cv: t.cv, ax: t.ax, ay: t.ay, fx: t.fx, fy: t.fy, sd: t.sd, part: !!t.pending?.length } : null;
      const keepOld = prev?.part && t.prev; // zoom seguido sin haber terminado: se conserva la vista previa anterior
      t = this.tc = { key, rest, tree, sd, fx: x0 - Math.floor(x0), fy: y0 - Math.floor(y0), prev: keepOld ? t.prev : prev, ...(keepOld ? {} : { cv: null }) };
      Object.assign(t, fresh());
      t.pending = [{ x1: 0, y1: 0, x2: t.W, y2: t.H }];
      tree.dirt = [];
    }
    const X0 = Math.round(x0 - t.fx), Y0 = Math.round(y0 - t.fy);
    // Píxel de la imagen (a, b) = píxel de la vista (ax + a − fx, ay + b − fy)
    const toCache = f => ({ x1: f.x1 - t.ax + t.fx, y1: f.y1 - t.ay + t.fy, x2: f.x2 - t.ax + t.fx, y2: f.y2 - t.ay + t.fy });
    // Encuadre fuera de la imagen: nueva imagen desplazada con lo ya dibujado; sólo quedan pendientes las franjas nuevas
    const need = toCache(vis);
    if (need.x1 < 0 || need.y1 < 0 || need.x2 > t.W || need.y2 > t.H || t.W !== Math.ceil(v.w * d) + 2 * M || t.H !== Math.ceil(v.h * d) + 2 * M) {
      const old = { cv: t.cv, ax: t.ax, ay: t.ay, W: t.W, H: t.H, pending: t.pending };
      Object.assign(t, fresh());
      if (t.cv === old.cv) t.cv = Object.assign(document.createElement('canvas'), { width: t.W, height: t.H });
      const dx = old.ax - t.ax, dy = old.ay - t.ay, g = t.cv.getContext('2d');
      g.drawImage(old.cv, dx, dy);
      const kept = { x1: Math.max(0, dx), y1: Math.max(0, dy), x2: Math.min(t.W, dx + old.W), y2: Math.min(t.H, dy + old.H) };
      t.pending = [...rectMinus({ x1: 0, y1: 0, x2: t.W, y2: t.H }, kept), ...old.pending.map(r => ({ x1: r.x1 + dx, y1: r.y1 + dy, x2: r.x2 + dx, y2: r.y2 + dy }))];
    }
    // Objetos cambiados (rectángulos del índice espacial, antes y después, con margen para grosores, puntos y textos)
    if (tree.dirt === null) t.pending = [{ x1: 0, y1: 0, x2: t.W, y2: t.H }];
    else for (const b of tree.dirt) {
      if (!isFinite(b.x1)) continue;
      const cs = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]].map(([x, y]) => fr({ x, y })), m = 24 * d;
      t.pending.push(toCache({ x1: Math.min(...cs.map(q => q[0])) - m, y1: Math.min(...cs.map(q => q[1])) - m, x2: Math.max(...cs.map(q => q[0])) + m, y2: Math.max(...cs.map(q => q[1])) + m }));
    }
    tree.dirt = [];
    // Pendientes: recortados a la imagen, en franjas (para repartirlos entre fotogramas) y primero los visibles
    let list = [];
    for (const r of t.pending) {
      const q = { x1: Math.max(0, Math.floor(r.x1)), y1: Math.max(0, Math.floor(r.y1)), x2: Math.min(t.W, Math.ceil(r.x2)), y2: Math.min(t.H, Math.ceil(r.y2)) };
      if (q.x2 <= q.x1 || q.y2 <= q.y1) continue;
      for (let y = q.y1; y < q.y2; y += BAND) list.push({ ...q, y1: y, y2: Math.min(q.y2, y + BAND) });
    }
    if (list.length > 64) { const u = list.reduce((a, r) => bbUnion(a, r), null); list = []; for (let y = u.y1; y < u.y2; y += BAND) list.push({ ...u, y1: y, y2: Math.min(u.y2, y + BAND) }); }
    const seen = r => r.x2 > need.x1 && r.x1 < need.x2 && r.y2 > need.y1 && r.y1 < need.y2;
    list.sort((a, b) => seen(b) - seen(a));
    const until = performance.now() + TILES.budget, left = [];
    for (const r of list) {
      if (TILES.budget && performance.now() > until && left.length + 1 < list.length) { left.push(r); continue; }
      this.renderTile(t, r, sty, tree, v, d);
    }
    t.pending = left;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const vl = left.filter(seen);
    if (vl.length && t.prev && t.prev.sd) { // vista previa escalada debajo de lo que falta
      const p = t.prev, s = sd / p.sd;
      c.save(); c.beginPath();
      for (const r of vl) c.rect(X0 + t.ax + r.x1, Y0 + t.ay + r.y1, r.x2 - r.x1, r.y2 - r.y1);
      c.clip();
      c.drawImage(p.cv, x0 + (p.ax - p.fx) * s, y0 + (p.ay - p.fy) * s, p.cv.width * s, p.cv.height * s);
      c.restore();
    }
    c.drawImage(t.cv, X0 + t.ax, Y0 + t.ay);
    if (left.length) setTimeout(() => this.invalidate(), 0);
    else t.prev = null;
  }
  // Dibuja una zona r (en píxeles de la imagen en caché): la borra y vuelve a dibujar los objetos que la tocan
  renderTile(t, r, sty, tree, v, d) {
    const sd = v.scale * d, rot = v.rot || 0, raw = t.cv.getContext('2d'), c = new ShiftCtx(raw);
    raw.save();
    raw.setTransform(1, 0, 0, 1, 0, 0); raw.clearRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    raw.beginPath(); raw.rect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1); raw.clip();
    const w = (a, b) => fromFrame(rot, (t.ax + a - t.fx) / sd, -(t.ay + b - t.fy) / sd); // píxel de la imagen → dibujo
    const [cx, cy] = w(t.W / 2, t.H / 2), R = makeRV(cx, cy, v.scale, t.W / d, t.H / d, d, 0, 0, rot), m = 24 / v.scale;
    const q = [w(r.x1, r.y1), w(r.x2, r.y1), w(r.x2, r.y2), w(r.x1, r.y2)];
    const rect = { x1: Math.min(...q.map(p => p[0])) - m, y1: Math.min(...q.map(p => p[1])) - m, x2: Math.max(...q.map(p => p[0])) + m, y2: Math.max(...q.map(p => p[1])) + m };
    R.clip = rect; // las polilíneas largas sólo dibujan lo que cae en la zona (simplePath)
    setWorld(c, R);
    this.paintList(c, R, tree.query(rect, true), sty);
    raw.restore();
  }

  // Restricciones: símbolos junto a la geometría (pantalla) y cotas de restricción con nombre=expresión (dibujo)
  drawConstraints(c, R) {
    const app = this.app, doc = app.doc;
    this.consLabels = [];
    if (!doc.constraints?.length || doc.settings.showCons === false) return;
    const inSpace = new Set(doc.ents.map(e => e.id)), v = app.view, d = this.dpr;
    const { vals } = evalParams(doc), slots = new Map();
    const COL = '#7fb3ff';
    for (const k of doc.constraints) {
      if (!refIds(k).every(id => inSpace.has(id) && doc.visible(doc.get(id)))) continue;
      if (DIM_TYPES.has(k.type)) {
        const val = vals.get(k.name), num = val == null ? '?' : +val.toFixed(4);
        const label = /^[-+]?[\d.]+$/.test(k.expr) ? `${k.name}=${num}` : `${k.name}=${k.expr} (${num})`;
        const dv = consDim(doc, k, label);
        if (!dv) continue;
        dv.style = doc.cur.dimStyle;
        setWorld(c, R);
        paintEntity(c, dv, R, { color: COL, px: 1, pat: [] });
        this.consLabels.push({ k, box: textBox(dimParts(dv).text) });
        continue;
      }
      // Símbolo en el primer objeto (y en el segundo si la restricción relaciona dos)
      const anchors = k.type === 'coincident' ? [k.refs[0]] : k.refs.slice(0, 2);
      for (const rf of anchors) {
        const g = refGeom(doc, rf);
        if (!g) continue;
        let p, off = { x: 10, y: -14 };
        if (g.pt) { p = g.pt; if (k.type === 'coincident') { const s = v.toScreen(p); c.setTransform(d, 0, 0, d, 0, 0); c.fillStyle = COL; c.fillRect(s.x - 3, s.y - 3, 6, 6); continue; } }
        else if (g.line) { p = { x: (g.line[0].x + g.line[1].x) / 2, y: (g.line[0].y + g.line[1].y) / 2 }; const a = Math.atan2(g.line[1].y - g.line[0].y, g.line[1].x - g.line[0].x); off = { x: -Math.sin(a) * 14, y: -Math.cos(a) * 14 }; }
        else p = { x: g.circ.c.x, y: g.circ.c.y + g.circ.r };
        const key = `${rf.id}|${rf.seg ?? rf.k ?? ''}`, n = slots.get(key) || 0;
        slots.set(key, n + 1);
        const s = v.toScreen(p);
        this.drawBadge(c, k.type, s.x + off.x + n * 17 - 7, s.y + off.y - 7);
      }
    }
  }
  drawBadge(c, type, x, y) {
    const d = this.dpr;
    c.setTransform(d, 0, 0, d, 0, 0); c.setLineDash([]);
    c.fillStyle = 'rgba(25,40,60,0.85)'; c.fillRect(x, y, 14, 14);
    c.strokeStyle = '#7fb3ff'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, 13, 13);
    c.beginPath();
    const L = (a, b, e, f) => { c.moveTo(x + a, y + b); c.lineTo(x + e, y + f); };
    switch (type) {
      case 'horizontal': L(3, 7, 11, 7); break;
      case 'vertical': L(7, 3, 7, 11); break;
      case 'parallel': L(4, 11, 8, 3); L(7, 11, 11, 3); break;
      case 'perpendicular': L(3, 11, 11, 11); L(7, 11, 7, 3); break;
      case 'collinear': L(2, 10, 12, 4); break;
      case 'equal': L(3, 5, 11, 5); L(3, 9, 11, 9); break;
      case 'concentric': c.moveTo(x + 11, y + 7); c.arc(x + 7, y + 7, 4, 0, G.TAU); c.moveTo(x + 9, y + 7); c.arc(x + 7, y + 7, 2, 0, G.TAU); break;
      case 'tangent': c.moveTo(x + 10, y + 8); c.arc(x + 7, y + 8, 3, 0, G.TAU); L(2, 11, 12, 11); break;
      case 'fix': c.rect(x + 4, y + 7, 6, 5); c.moveTo(x + 5, y + 7); c.arc(x + 7, y + 6, 2, Math.PI, 0); break;
    }
    c.stroke();
  }

  // Parámetros dinámicos en el editor de bloques
  drawDynParams(c, R, be) {
    const d = be.dyn, v = this.app.view, dp = this.dpr;
    if (!d) return;
    c.setTransform(dp, 0, 0, dp, 0, 0); c.lineWidth = 1.2; c.font = '11px sans-serif';
    c.strokeStyle = c.fillStyle = '#14b8a6';
    const label = (p, t) => { const s = v.toScreen(p); c.fillText(t, s.x + 8, s.y - 8); };
    for (const l of linsOf(d)) {
      const a = v.toScreen(l.p1), b = v.toScreen(l.p2), r1 = v.toScreen({ x: l.rect.x1, y: l.rect.y2 }), r2 = v.toScreen({ x: l.rect.x2, y: l.rect.y1 });
      c.setLineDash([]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      c.beginPath(); c.arc(b.x, b.y, 4, 0, G.TAU); c.fill(); c.strokeRect(a.x - 3, a.y - 3, 6, 6);
      c.setLineDash([4, 3]); c.strokeRect(r1.x, r1.y, r2.x - r1.x, r2.y - r1.y); c.setLineDash([]);
      label(G.mid(l.p1, l.p2), `${l.name} (${l.ents.length} obj.)`);
    }
    for (const r of rotsOf(d)) { // centro, radio hasta el pinzamiento y arco de giro
      const a = v.toScreen(r.c), b = v.toScreen(r.p), R = Math.hypot(b.x - a.x, b.y - a.y), a0 = Math.atan2(b.y - a.y, b.x - a.x);
      c.setLineDash([]); c.beginPath(); c.moveTo(a.x - 5, a.y); c.lineTo(a.x + 5, a.y); c.moveTo(a.x, a.y - 5); c.lineTo(a.x, a.y + 5); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      c.setLineDash([4, 3]); c.beginPath(); c.arc(a.x, a.y, R, a0 - 0.6, a0 + 0.6); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(b.x, b.y, 4, 0, G.TAU); c.fill();
      label(r.p, `${r.name} (${r.ents.length} obj.)`);
    }
    if (d.look) { const s = v.toScreen(d.look.pos || be.base); c.beginPath(); c.moveTo(s.x, s.y - 5); c.lineTo(s.x + 5, s.y + 4); c.lineTo(s.x - 5, s.y + 4); c.closePath(); c.fill(); label(d.look.pos || be.base, `${d.look.name || 'Consulta'}: ${d.look.rows.length} fila(s)`); }
    if (d.flip) { const a = v.toScreen(d.flip.a), b = v.toScreen(d.flip.b); c.setLineDash([8, 3, 2, 3]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]); label(d.flip.b, 'Simetría'); }
    if (d.vis) label(d.vis.pos || be.base, `Visibilidad: ${be.visCur} (${d.vis.states.length} estados)`);
  }

  drawBasePoint(c, s) {
    const d = this.dpr;
    c.setTransform(d, 0, 0, d, 0, 0); c.setLineDash([]); c.lineWidth = 1.5;
    c.strokeStyle = c.fillStyle = '#f0b429';
    c.beginPath(); c.arc(s.x, s.y, 7, 0, G.TAU); c.moveTo(s.x - 12, s.y); c.lineTo(s.x + 12, s.y); c.moveTo(s.x, s.y - 12); c.lineTo(s.x, s.y + 12); c.stroke();
    c.font = '11px sans-serif'; c.fillText('Punto base', s.x + 10, s.y - 10);
  }

  drawGrid(c, R, v = this.app.view) {
    const S = this.app.doc.settings, u = ucsOf(this.app.doc);
    let step = S.gridX;
    if (!(step > 0)) return;
    while (step * v.scale < 9) step *= 5;
    const d = this.dpr;
    c.setTransform(d, 0, 0, d, 0, 0); c.lineWidth = 1; c.setLineDash([]);
    const minor = new Path2D(), major = new Path2D();
    const r = v.rect();
    // Familias de líneas: ángulo y separación perpendicular
    const ua = S.iso ? 0 : G.deg(u.ang), o = S.iso ? G.P(0, 0) : u.o; // en el SCP: familias giradas que pasan por su origen
    const fams = S.iso
      ? [[30, step * Math.cos(Math.PI / 6)], [150, step * Math.cos(Math.PI / 6)], [90, step * Math.cos(Math.PI / 6)]]
      : [[ua, step], [ua + 90, step]];
    const cs = [G.P(r.x1, r.y1), G.P(r.x2, r.y1), G.P(r.x2, r.y2), G.P(r.x1, r.y2)];
    const far = Math.hypot(v.w, v.h) * 2, vr = v.rot || 0;
    for (const [deg, sp] of fams) {
      const a = G.rad(deg), n = G.perp(G.P(Math.cos(a), Math.sin(a))), off = G.dot(o, n), u = G.P(Math.cos(a - vr), Math.sin(a - vr)); // u: dirección en la pantalla
      const ns = cs.map(p => (G.dot(p, n) - off) / sp), k0 = Math.ceil(Math.min(...ns)), k1 = Math.floor(Math.max(...ns));
      if (k1 - k0 > 600) return;
      for (let k = k0; k <= k1; k++) {
        const s = v.toScreen(G.mul(n, k * sp + off)), path = k % 5 === 0 ? major : minor;
        let x = s.x, y = s.y;
        if (Math.abs(u.y) < 1e-9) y = Math.round(y) + 0.5; else if (Math.abs(u.x) < 1e-9) x = Math.round(x) + 0.5;
        path.moveTo(x - u.x * far, y + u.y * far); path.lineTo(x + u.x * far, y - u.y * far);
      }
    }
    c.strokeStyle = 'rgba(255,255,255,0.045)'; c.stroke(minor);
    c.strokeStyle = 'rgba(255,255,255,0.10)'; c.stroke(major);
    // ejes X e Y del SCP (o del universal)
    const so = v.toScreen(o), ax = (S.iso ? 0 : u.ang) - vr;
    for (const [aa, col] of [[ax, 'rgba(220,80,80,0.45)'], [ax + Math.PI / 2, 'rgba(80,200,90,0.45)']]) {
      const dx = Math.cos(aa) * far, dy = -Math.sin(aa) * far;
      let x = so.x, y = so.y;
      if (Math.abs(dy) < 1e-6) y = Math.round(y) + 0.5; else if (Math.abs(dx) < 1e-6) x = Math.round(x) + 0.5;
      c.strokeStyle = col; c.beginPath(); c.moveTo(x - dx, y - dy); c.lineTo(x + dx, y + dy); c.stroke();
    }
  }

  // Icono del SCP: en la esquina inferior izquierda o, con UCSICON › Origen, en el origen si cabe en la vista.
  // Gira con el SCP; el cuadrado del origen indica el SCP universal y la cruz, que el icono está en el origen.
  drawUCS(c, v = this.app.view) {
    const d = this.dpr, doc = this.app.doc, S = doc.settings;
    if (S.ucsIcon === false) return;
    const u = ucsOf(doc);
    let x = v.ox + 28, y = v.oy + v.h - 28, atOrigin = false;
    if (S.ucsIconOrigin !== false && !isWorld(u)) {
      const s = v.toScreen(u.o);
      if (s.x >= v.ox + 50 && s.x <= v.ox + v.w - 50 && s.y >= v.oy + 50 && s.y <= v.oy + v.h - 50) { x = s.x; y = s.y; atOrigin = true; }
    }
    // a: distancia sobre el eje X del SCP; b: sobre el eje Y (en píxeles)
    const ia = u.ang - (v.rot || 0), cs = Math.cos(ia), sn = Math.sin(ia), P = (a, b) => [x + a * cs - b * sn, y - a * sn - b * cs];
    c.setTransform(d, 0, 0, d, 0, 0); c.setLineDash([]); c.lineWidth = 2; c.font = '11px sans-serif';
    const arrow = (dir, col, lab) => {
      const [ax, ay] = dir, pt = k => P(ax * k, ay * k), side = (k, w) => P(ax * k - ay * w, ay * k + ax * w);
      c.strokeStyle = c.fillStyle = col;
      c.beginPath(); c.moveTo(x, y); c.lineTo(...pt(38)); c.stroke();
      c.beginPath(); c.moveTo(...pt(44)); c.lineTo(...side(36, 4)); c.lineTo(...side(36, -4)); c.fill();
      const [lx, ly] = pt(53); c.fillText(lab, lx - 3, ly + 4);
    };
    arrow([1, 0], '#e05656', 'X');
    arrow([0, 1], '#5ccf6a', 'Y');
    if (isWorld(u)) { c.fillStyle = '#9aa4b1'; c.fillRect(x - 3, y - 3, 6, 6); }
    else if (atOrigin) { c.strokeStyle = '#9aa4b1'; c.lineWidth = 1; c.beginPath(); c.moveTo(...P(-5, 0)); c.lineTo(...P(5, 0)); c.moveTo(...P(0, -5)); c.lineTo(...P(0, 5)); c.stroke(); }
  }

  highlight(c, e, R, strong) {
    paintEntity(c, e, R, { color: HL, px: strong ? 6 : 4, pat: [], hl: true });
    paintEntity(c, e, R, { color: strong ? '#9ccbff' : '#cfe4ff', px: 1, pat: [], hl: true });
  }

  drawOver() {
    const c = this.co, app = this.app, doc = app.doc, R = this.R(), m = app.mouse, req = app.req, d = this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.over.width, this.over.height);

    const hl = new Set(app.sel);
    if (req?.set) for (const id of req.set) hl.add(id);
    const tiles = app.modelTiles();
    if (tiles) { // las demás ventanas en mosaico sólo muestran la designación; todo lo demás va recortado a la activa
      for (const t of tiles) {
        if (t.view === app.view) continue;
        const v = t.view, Rt = makeR(v, d);
        c.save(); c.beginPath(); c.rect(v.ox * d, v.oy * d, v.w * d, v.h * d); c.clip();
        setWorld(c, Rt);
        for (const id of hl) { const e = doc.get(id); if (e && doc.visible(e)) this.highlight(c, e, Rt, true); }
        c.restore();
      }
      const v = app.view;
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.beginPath(); c.rect(v.ox * d, v.oy * d, v.w * d, v.h * d); c.clip();
    }
    if (hl.size > 1500 && !tiles) this.drawBigSelection(c, hl, R); // muchos objetos designados: en caché
    else {
      setWorld(c, R);
      for (const id of hl) { const e = doc.get(id); if (e && doc.visible(e)) this.highlight(c, e, R, true); }
    }
    setWorld(c, R);
    // Grupos designados enteros: recuadro discontinuo alrededor del grupo
    if (doc.groups.length && hl.size > 1) {
      c.save(); c.setTransform(d, 0, 0, d, 0, 0); c.strokeStyle = 'rgba(156,203,255,0.8)'; c.lineWidth = 1; c.setLineDash([5, 4]);
      for (const g of doc.groups) {
        if (g.ids.length < 2 || !g.ids.every(id => hl.has(id))) continue;
        let b = null;
        for (const id of g.ids) { const e = doc.get(id); if (e && doc.visible(e)) b = bbUnion(b, bboxOf(e)); }
        if (!b) continue;
        const a = app.view.toScreen({ x: b.x1, y: b.y2 }), q = app.view.toScreen({ x: b.x2, y: b.y1 });
        c.strokeRect(Math.round(a.x) - 4.5, Math.round(a.y) - 4.5, q.x - a.x + 9, q.y - a.y + 9);
      }
      c.restore();
    }
    if (app.hover && !hl.has(app.hover)) { const e = doc.get(app.hover); if (e) this.highlight(c, e, R, false); }

    const base = req && (req.opts.base || req.tmpBase);
    if (req && m.inside !== false) {
      const st = app.curStyle(), sty = e => app.styleFor(e);
      if (req.opts.preview && req.pointLike) {
        let list = [];
        try { list = req.opts.preview(m.pt) || []; } catch (err) { list = []; }
        for (const e of list) paintEntity(c, e, R, e.layer || e.color ? app.styleFor(e) : st, sty);
      }
      if (base && req.pointLike && req.opts.rubber !== false) {
        paintEntity(c, { type: 'line', p1: base, p2: m.pt }, R, { color: app.layoutShown() ? '#4a5462' : '#d9dee5', px: 1, pat: req.opts.preview ? [2 / R.scale, -3 / R.scale] : [] });
      }
    }

    // ---- espacio pantalla ----
    c.setTransform(d, 0, 0, d, 0, 0); c.setLineDash([]); c.lineWidth = 1;

    if (app.vpActive) {
      const vp = doc.get(app.vpActive);
      if (vp) {
        const a = app.paperView.toScreen(vp.p1), b = app.paperView.toScreen(vp.p2);
        c.strokeStyle = '#1e90d6'; c.lineWidth = 3;
        c.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        c.lineWidth = 1;
      }
    }

    if (!req || req.gripCmd) this.drawGrips(c, req);

    if (app.win) {
      const a = app.win.s, b = { x: m.sx, y: m.sy }, crossing = b.x < a.x;
      c.fillStyle = crossing ? 'rgba(60,200,90,0.14)' : 'rgba(60,130,255,0.14)';
      c.strokeStyle = crossing ? '#5fd37a' : '#5b9bff';
      c.setLineDash(crossing ? [5, 4] : []);
      c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      c.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
      c.setLineDash([]);
    }

    c.strokeStyle = TRACK_COLOR; c.setLineDash([3, 4]);
    if (m.polar) {
      const s = app.view.toScreen(m.polar.base), far = Math.hypot(app.view.w, app.view.h) * 2;
      const pa = m.polar.ang - (app.view.rot || 0);
      c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + Math.cos(pa) * far, s.y - Math.sin(pa) * far); c.stroke();
    }
    if (m.track) {
      for (const ln of m.track.lines) {
        const s = app.view.toScreen(ln.from), far = 4000;
        c.beginPath();
        if (ln.vertical) { c.moveTo(s.x, s.y - far); c.lineTo(s.x, s.y + far); } else { c.moveTo(s.x - far, s.y); c.lineTo(s.x + far, s.y); }
        c.stroke();
      }
    }
    c.setLineDash([]);
    if (req && app.acquired.length) {
      c.strokeStyle = TRACK_COLOR;
      for (const p of app.acquired) {
        const s = app.view.toScreen(p);
        c.beginPath(); c.moveTo(s.x - 4, s.y); c.lineTo(s.x + 4, s.y); c.moveTo(s.x, s.y - 4); c.lineTo(s.x, s.y + 4); c.stroke();
      }
    }

    if (m.snap) this.drawMarker(c, app.view.toScreen(m.snap.pt), m.snap.mode);

    if (m.inside && !app.touchMode && (!tiles || app.view.contains({ x: m.sx, y: m.sy }))) this.drawCursor(c, req);
    if (tiles) c.restore();
  }

  // Resaltado de una designación muy grande: sólo lo visible y dibujado una vez por vista, versión y designación
  drawBigSelection(c, hl, R) {
    const app = this.app, doc = app.doc, v = app.view, key = [v.cx, v.cy, v.scale, v.rot, this.dpr, doc.ver, hl.size, app.selStamp || 0].join('|');
    let k = this.selCache;
    if (!k || k.key !== key || k.cv.width !== this.over.width || k.cv.height !== this.over.height) {
      const cv = k?.cv && k.cv.width === this.over.width && k.cv.height === this.over.height ? k.cv : Object.assign(document.createElement('canvas'), { width: this.over.width, height: this.over.height });
      const raw = cv.getContext('2d'), sc = new ShiftCtx(raw);
      raw.setTransform(1, 0, 0, 1, 0, 0); raw.clearRect(0, 0, cv.width, cv.height);
      setWorld(sc, R);
      for (const e of app.idx().query(v.rect(), true)) if (hl.has(e.id) && doc.visible(e)) this.highlight(sc, e, R, true);
      k = this.selCache = { key, cv };
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(k.cv, 0, 0);
  }

  drawGrips(c, req) {
    const app = this.app, doc = this.app.doc;
    if (!app.sel.size || app.sel.size > 300) return;
    const hot = req?.gripCmd ? req.opts.hot : null;
    for (const id of app.sel) {
      const e = doc.get(id);
      if (!e || !doc.visible(e)) continue;
      const kinds = TYPES[e.type].gripKinds?.(e) || [];
      gripsOf(e).forEach((g, gi) => {
        const s = app.view.toScreen(g);
        const isHot = hot && G.eqPt(hot, g, 1e-9), isHover = app.hoverGrip && G.eqPt(app.hoverGrip.pt, g, 1e-9);
        c.fillStyle = isHot ? '#ff3b30' : isHover ? '#ff8a3d' : kinds[gi] ? '#14b8a6' : '#1f7ae0'; // cian: pinzamiento dinámico
        c.fillRect(s.x - 4, s.y - 4, 8, 8);
        c.strokeStyle = '#e6eef7'; c.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
      });
    }
  }

  drawMarker(c, s, mode) {
    const r = 6;
    c.strokeStyle = SNAP_COLOR; c.lineWidth = 2;
    c.beginPath();
    switch (mode) {
      case 'end': c.rect(s.x - r, s.y - r, 2 * r, 2 * r); break;
      case 'mid': c.moveTo(s.x, s.y - r); c.lineTo(s.x + r, s.y + r * 0.75); c.lineTo(s.x - r, s.y + r * 0.75); c.closePath(); break;
      case 'cen': c.arc(s.x, s.y, r, 0, G.TAU); break;
      case 'qua': c.moveTo(s.x, s.y - r); c.lineTo(s.x + r, s.y); c.lineTo(s.x, s.y + r); c.lineTo(s.x - r, s.y); c.closePath(); break;
      case 'int': c.moveTo(s.x - r, s.y - r); c.lineTo(s.x + r, s.y + r); c.moveTo(s.x + r, s.y - r); c.lineTo(s.x - r, s.y + r); break;
      case 'per': c.moveTo(s.x - r, s.y - r); c.lineTo(s.x - r, s.y + r); c.lineTo(s.x + r, s.y + r); c.moveTo(s.x - r, s.y); c.lineTo(s.x, s.y); c.lineTo(s.x, s.y + r); break;
      case 'nea': c.moveTo(s.x - r, s.y - r); c.lineTo(s.x + r, s.y - r); c.lineTo(s.x - r, s.y + r); c.lineTo(s.x + r, s.y + r); c.closePath(); break;
      case 'nod': c.arc(s.x, s.y, r, 0, G.TAU); c.moveTo(s.x - r * 0.7, s.y - r * 0.7); c.lineTo(s.x + r * 0.7, s.y + r * 0.7); c.moveTo(s.x + r * 0.7, s.y - r * 0.7); c.lineTo(s.x - r * 0.7, s.y + r * 0.7); break;
      case 'ins': c.rect(s.x - r, s.y - r, r, r); c.rect(s.x, s.y, r, r); break;
    }
    c.stroke(); c.lineWidth = 1;
  }

  drawCursor(c, req) {
    const app = this.app, m = app.mouse, s = req && req.pointLike ? app.view.toScreen(m.pt) : { x: m.sx, y: m.sy };
    const x = Math.round(s.x) + 0.5, y = Math.round(s.y) + 0.5;
    const arm = Math.max(40, 0.05 * Math.max(app.view.w, app.view.h));
    const dark = app.layoutShown() && !app.vpActive;
    c.strokeStyle = dark ? 'rgba(40,46,54,0.9)' : 'rgba(235,240,245,0.9)'; c.lineWidth = 1; c.setLineDash([]);
    const pickOnly = req && req.kind === 'entity';
    c.beginPath();
    if (!pickOnly) {
      const S = app.doc.settings;
      const ua = G.deg(ucsOf(app.doc).ang), axes = S.iso && app.tab === 'model' ? ISO_AXES[S.isoPlane] : [ua, ua + 90], vr = app.view.rot || 0;
      for (const deg of axes) { const a = G.rad(deg) - vr, dx = Math.cos(a) * arm, dy = Math.sin(a) * arm; c.moveTo(x - dx, y + dy); c.lineTo(x + dx, y - dy); }
    }
    c.stroke();
    if (!req || req.kind === 'select' || req.kind === 'entity') c.strokeRect(x - 5, y - 5, 10, 10);
  }
}

