// Dibujado en canvas: capa base (rejilla, modelo, presentaciones) y capa superpuesta (cursor, selección, vistas previas).
import * as G from './geom.js';
import { TYPES, gripsOf, blockEnts } from './entities.js';

export const BG = '#212830';
const LAYOUT_BG = '#3a4049';
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

// st: {color, px, pat, ltscale}; sty: función entidad → st (para las entidades de los bloques);
// vis: función entidad → visible, aplicada también a las entidades de los bloques
export function paintEntity(c, e, R, st, sty, vis) {
  if (e.type === 'insert') { for (const v of blockEnts(e)) if (!vis || vis(v)) paintEntity(c, v, R, sty ? sty(v) : st, sty, vis); return; }
  c.strokeStyle = st.color; c.fillStyle = st.color;
  c.lineWidth = st.px / R.scale;
  let pat = [];
  if (st.pat && st.pat.length) {
    const k = st.ltscale || 1, sc = st.pat.map(v => Math.abs(v) * k);
    if (sc.reduce((a, b) => a + b, 0) * R.scale > 4) pat = sc.map(v => v || 0.5 / R.scale);
  }
  c.setLineDash(pat);
  c.lineCap = pat.length && st.pat.includes(0) ? 'round' : 'butt';
  const T = TYPES[e.type];
  if (T.draw) T.draw(c, e, R);
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
    this.drawModel(c, vpR(R, vp), vpModelRect(vp), sty, this.app.doc.visibleIn(vp));
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
    for (const e of layout.ents) {
      if (e.type === 'vport') this.drawViewport(c, R, e, sty);
      setWorld(c, R);
      if (on(e)) paintEntity(c, e, R, sty(e), sty, on);
    }
  }

  drawBase() {
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
    if (app.T.grid) this.drawGrid(c, R);
    this.drawModel(c, R, app.view.rect(), sty);
    this.drawUCS(c);
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
    paintEntity(c, e, R, { color: HL, px: strong ? 6 : 4, pat: [] });
    paintEntity(c, e, R, { color: strong ? '#9ccbff' : '#cfe4ff', px: 1, pat: [] });
  }

  drawOver() {
    const c = this.co, app = this.app, doc = app.doc, R = this.R(), m = app.mouse, req = app.req, d = this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.over.width, this.over.height);
    setWorld(c, R);

    const hl = new Set(app.sel);
    if (req?.set) for (const id of req.set) hl.add(id);
    for (const id of hl) { const e = doc.get(id); if (e && doc.visible(e)) this.highlight(c, e, R, true); }
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
      for (const g of gripsOf(e)) {
        const s = app.view.toScreen(g);
        const isHot = hot && G.eqPt(hot, g, 1e-9), isHover = app.hoverGrip && G.eqPt(app.hoverGrip.pt, g, 1e-9);
        c.fillStyle = isHot ? '#ff3b30' : isHover ? '#ff8a3d' : '#1f7ae0';
        c.fillRect(s.x - 4, s.y - 4, 8, 8);
        c.strokeStyle = '#e6eef7'; c.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
      }
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

