// Dibujado en canvas: capa base (rejilla, modelo, presentaciones) y capa superpuesta (cursor, selección, vistas previas).
import * as G from './geom.js';
import { TYPES, gripsOf, blockEnts, ENV, textBox, dimParts, bboxOf, bbUnion, insertClip, applyDash } from './entities.js';
const arrayEntsOf = e => ENV.arrayEnts?.(e) || [];
import { linsOf, rotsOf } from './dynblock.js';
import { evalParams, refGeom, consDim, refIds, DIM_TYPES } from './constraints.js';

export const BG = '#212830';
const LAYOUT_BG = '#3a4049';
const BEDIT_BG = '#2a2f37';
const HL = 'rgba(47,140,255,0.45)';
const SNAP_COLOR = '#d4e157';
const TRACK_COLOR = '#58d68d';
export const ISO_AXES = { top: [30, 150], left: [90, 150], right: [30, 90] };

export function makeRV(cx, cy, scale, w, h, dpr) {
  return { scale, dpr, w, h, cx, cy, toScreen: p => ({ x: (p.x - cx) * scale + w / 2, y: h / 2 - (p.y - cy) * scale }) };
}
export const makeR = (view, dpr) => makeRV(view.cx, view.cy, view.scale, view.w, view.h, dpr);
export function setWorld(c, R) {
  const s = R.scale, d = R.dpr;
  c.setTransform(d * s, 0, 0, -d * s, d * (R.w / 2 - R.cx * s), d * (R.h / 2 + R.cy * s));
}
// Vista del modelo dentro de una ventana gráfica, a partir de la vista del papel
export function vpR(R, vp) {
  const vcx = (vp.p1.x + vp.p2.x) / 2, vcy = (vp.p1.y + vp.p2.y) / 2;
  return makeRV(vp.cx - (vcx - R.cx) / vp.s, vp.cy - (vcy - R.cy) / vp.s, R.scale * vp.s, R.w, R.h, R.dpr);
}
export function vpModelRect(vp) {
  const vcx = (vp.p1.x + vp.p2.x) / 2, vcy = (vp.p1.y + vp.p2.y) / 2;
  return { x1: vp.cx + (vp.p1.x - vcx) / vp.s, y1: vp.cy + (vp.p1.y - vcy) / vp.s, x2: vp.cx + (vp.p2.x - vcx) / vp.s, y2: vp.cy + (vp.p2.y - vcy) / vp.s };
}

// Factor de escala de tipo de línea dentro de una ventana: el suyo y, con PSLTSCALE = 1, el que deja los trazos con el
// mismo tamaño en el papel en todas las ventanas (como en AutoCAD)
export const vpLtk = (doc, vp) => (vp.ltscale || 1) * (doc.settings.psltscale ? 1 / (vp.s || 1) : 1);
// st: {color, px, pat, ltscale}; sty: función entidad → st (para las entidades de los bloques);
// vis: función entidad → visible, aplicada también a las entidades de los bloques
export function paintEntity(c, e, R, st, sty, vis) {
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
  if (T.draw) T.draw(c, e, R, st);
  else { c.beginPath(); T.path(c, e, R); c.stroke(); }
}

export class Renderer {
  constructor(app, base, over) {
    this.app = app; this.base = base; this.over = over;
    this.cb = base.getContext('2d'); this.co = over.getContext('2d');
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
    this.paintList(c, R, this.app.spatial.of(doc.model, doc.ver).query(rect, true), sty, vis);
  }
  drawViewport(c, R, vp, sty) {
    c.save();
    setWorld(c, R);
    c.beginPath(); c.rect(vp.p1.x, vp.p1.y, vp.p2.x - vp.p1.x, vp.p2.y - vp.p1.y); c.clip();
    const k = vpLtk(this.app.doc, vp), vsty = k === 1 ? sty : e => { const s = sty(e); return { ...s, ltscale: (s.ltscale || 1) * k }; };
    this.drawModel(c, vpR(R, vp), vpModelRect(vp), vsty, this.app.doc.visibleIn(vp));
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
    for (const e of layout.ents) {
      if (e.type === 'vport') this.drawViewport(c, R, e, sty);
      setWorld(c, R);
      if (on(e)) paintEntity(c, e, R, sty(e), sty, on);
    }
    ENV.layout = prev;
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
    if (app.T.grid) this.drawGrid(c, R);
    this.drawModel(c, R, app.view.rect(), sty);
    this.drawConstraints(c, R);
    this.drawUCS(c);
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

  drawGrid(c, R) {
    const v = this.app.view, S = this.app.doc.settings;
    let step = S.gridX;
    if (!(step > 0)) return;
    while (step * v.scale < 9) step *= 5;
    const d = this.dpr;
    c.setTransform(d, 0, 0, d, 0, 0); c.lineWidth = 1; c.setLineDash([]);
    const minor = new Path2D(), major = new Path2D();
    const r = v.rect();
    // Familias de líneas: ángulo y separación perpendicular
    const fams = S.iso
      ? [[30, step * Math.cos(Math.PI / 6)], [150, step * Math.cos(Math.PI / 6)], [90, step * Math.cos(Math.PI / 6)]]
      : [[0, step], [90, step]];
    const cs = [G.P(r.x1, r.y1), G.P(r.x2, r.y1), G.P(r.x2, r.y2), G.P(r.x1, r.y2)];
    const far = Math.hypot(v.w, v.h) * 2;
    for (const [deg, sp] of fams) {
      const a = G.rad(deg), u = G.P(Math.cos(a), Math.sin(a)), n = G.perp(u);
      const ns = cs.map(p => G.dot(p, n) / sp), k0 = Math.ceil(Math.min(...ns)), k1 = Math.floor(Math.max(...ns));
      if (k1 - k0 > 600) return;
      for (let k = k0; k <= k1; k++) {
        const s = v.toScreen(G.mul(n, k * sp)), path = k % 5 === 0 ? major : minor;
        let x = s.x, y = s.y;
        if (deg === 0) y = Math.round(y) + 0.5; else if (deg === 90) x = Math.round(x) + 0.5;
        path.moveTo(x - u.x * far, y + u.y * far); path.lineTo(x + u.x * far, y - u.y * far);
      }
    }
    c.strokeStyle = 'rgba(255,255,255,0.045)'; c.stroke(minor);
    c.strokeStyle = 'rgba(255,255,255,0.10)'; c.stroke(major);
    const o = v.toScreen({ x: 0, y: 0 });
    c.strokeStyle = 'rgba(220,80,80,0.45)'; c.beginPath(); c.moveTo(0, Math.round(o.y) + 0.5); c.lineTo(v.w, Math.round(o.y) + 0.5); c.stroke();
    c.strokeStyle = 'rgba(80,200,90,0.45)'; c.beginPath(); c.moveTo(Math.round(o.x) + 0.5, 0); c.lineTo(Math.round(o.x) + 0.5, v.h); c.stroke();
  }

  drawUCS(c) {
    const d = this.dpr, h = this.app.view.h, x = 28, y = h - 28;
    c.setTransform(d, 0, 0, d, 0, 0); c.setLineDash([]); c.lineWidth = 2; c.font = '11px sans-serif';
    c.strokeStyle = c.fillStyle = '#e05656';
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 38, y); c.stroke();
    c.beginPath(); c.moveTo(x + 44, y); c.lineTo(x + 36, y - 4); c.lineTo(x + 36, y + 4); c.fill();
    c.fillText('X', x + 47, y + 4);
    c.strokeStyle = c.fillStyle = '#5ccf6a';
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 38); c.stroke();
    c.beginPath(); c.moveTo(x, y - 44); c.lineTo(x - 4, y - 36); c.lineTo(x + 4, y - 36); c.fill();
    c.fillText('Y', x - 3, y - 48);
    c.fillStyle = '#9aa4b1'; c.fillRect(x - 3, y - 3, 6, 6);
  }

  highlight(c, e, R, strong) {
    paintEntity(c, e, R, { color: HL, px: strong ? 6 : 4, pat: [], hl: true });
    paintEntity(c, e, R, { color: strong ? '#9ccbff' : '#cfe4ff', px: 1, pat: [], hl: true });
  }

  drawOver() {
    const c = this.co, app = this.app, doc = app.doc, R = this.R(), m = app.mouse, req = app.req, d = this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.over.width, this.over.height);
    setWorld(c, R);

    const hl = new Set(app.sel);
    if (req?.set) for (const id of req.set) hl.add(id);
    for (const id of hl) { const e = doc.get(id); if (e && doc.visible(e)) this.highlight(c, e, R, true); }
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
      c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + Math.cos(m.polar.ang) * far, s.y - Math.sin(m.polar.ang) * far); c.stroke();
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

    if (m.inside && !app.touchMode) this.drawCursor(c, req);
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
      const axes = S.iso && app.tab === 'model' ? ISO_AXES[S.isoPlane] : [0, 90];
      for (const deg of axes) { const a = G.rad(deg), dx = Math.cos(a) * arm, dy = Math.sin(a) * arm; c.moveTo(x - dx, y + dy); c.lineTo(x + dx, y - dy); }
    }
    c.stroke();
    if (!req || req.kind === 'select' || req.kind === 'entity') c.strokeRect(x - 5, y - 5, 10, 10);
  }
}

