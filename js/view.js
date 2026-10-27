// Vista: transformación mundo <-> pantalla, zoom y encuadre. ox, oy: esquina de la vista en la zona de dibujo
// (las ventanas en mosaico del modelo la dividen en varias vistas).
export class View {
  constructor() { this.cx = 210; this.cy = 148.5; this.scale = 2; this.w = 800; this.h = 600; this.ox = 0; this.oy = 0; this.stack = []; }

  toScreen(p) { return { x: (p.x - this.cx) * this.scale + this.ox + this.w / 2, y: this.oy + this.h / 2 - (p.y - this.cy) * this.scale }; }
  toWorld(s) { return { x: (s.x - this.ox - this.w / 2) / this.scale + this.cx, y: (this.oy + this.h / 2 - s.y) / this.scale + this.cy }; }
  rect() { const a = this.toWorld({ x: this.ox, y: this.oy + this.h }), b = this.toWorld({ x: this.ox + this.w, y: this.oy }); return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
  contains(s) { return s.x >= this.ox && s.x < this.ox + this.w && s.y >= this.oy && s.y < this.oy + this.h; }

  push() { this.stack.push({ cx: this.cx, cy: this.cy, scale: this.scale }); if (this.stack.length > 50) this.stack.shift(); }
  prev() { const s = this.stack.pop(); if (s) Object.assign(this, s); return !!s; }

  zoomAt(f, s) {
    const w = this.toWorld(s);
    this.scale = Math.min(1e8, Math.max(1e-6, this.scale * f));
    this.cx = w.x - (s.x - this.ox - this.w / 2) / this.scale;
    this.cy = w.y - (this.oy + this.h / 2 - s.y) / this.scale;
  }
  panBy(dx, dy) { this.cx -= dx / this.scale; this.cy += dy / this.scale; }

  fit(b, margin = 0.06) {
    if (!b || !isFinite(b.x1)) return;
    const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    if (bw > 1e-9 || bh > 1e-9) {
      this.scale = Math.min(this.w / Math.max(bw, 1e-9), this.h / Math.max(bh, 1e-9)) * (1 - 2 * margin);
    }
    this.cx = (b.x1 + b.x2) / 2; this.cy = (b.y1 + b.y2) / 2;
  }
}

// Vista del modelo a través de una ventana gráfica activa de una presentación (MSPACE).
// Papel = (modelo − centroVentana)·s + centroRectángulo
export class VpView {
  constructor(paper, vp) { this.paper = paper; this.vp = vp; this.stack = []; }
  get w() { return this.paper.w; }
  get h() { return this.paper.h; }
  get ox() { return 0; }
  get oy() { return 0; }
  contains() { return true; }
  get scale() { return this.paper.scale * this.vp.s; }
  get vc() { return { x: (this.vp.p1.x + this.vp.p2.x) / 2, y: (this.vp.p1.y + this.vp.p2.y) / 2 }; }
  get cx() { return this.vp.cx - (this.vc.x - this.paper.cx) / this.vp.s; }
  get cy() { return this.vp.cy - (this.vc.y - this.paper.cy) / this.vp.s; }

  toScreen(p) { return { x: (p.x - this.cx) * this.scale + this.w / 2, y: this.h / 2 - (p.y - this.cy) * this.scale }; }
  toWorld(s) { return { x: (s.x - this.w / 2) / this.scale + this.cx, y: (this.h / 2 - s.y) / this.scale + this.cy }; }
  // Rectángulo del modelo visible a través de la ventana
  rect() {
    const { vp } = this, vc = this.vc;
    return { x1: vp.cx + (vp.p1.x - vc.x) / vp.s, y1: vp.cy + (vp.p1.y - vc.y) / vp.s, x2: vp.cx + (vp.p2.x - vc.x) / vp.s, y2: vp.cy + (vp.p2.y - vc.y) / vp.s };
  }
  push() { this.stack.push({ cx: this.vp.cx, cy: this.vp.cy, s: this.vp.s }); if (this.stack.length > 50) this.stack.shift(); }
  prev() { const s = this.stack.pop(); if (s) Object.assign(this.vp, s); return !!s; }
  zoomAt(f, s) {
    const w = this.toWorld(s);
    this.vp.s = Math.min(1e6, Math.max(1e-8, this.vp.s * f));
    const sc = this.scale, vc = this.vc;
    const cxe = w.x - (s.x - this.w / 2) / sc, cye = w.y - (this.h / 2 - s.y) / sc;
    this.vp.cx = cxe + (vc.x - this.paper.cx) / this.vp.s;
    this.vp.cy = cye + (vc.y - this.paper.cy) / this.vp.s;
  }
  panBy(dx, dy) { this.vp.cx -= dx / this.scale; this.vp.cy += dy / this.scale; }
  fit(b, margin = 0.05) {
    if (!b || !isFinite(b.x1)) return;
    const vw = this.vp.p2.x - this.vp.p1.x, vh = this.vp.p2.y - this.vp.p1.y;
    const bw = Math.max(b.x2 - b.x1, 1e-9), bh = Math.max(b.y2 - b.y1, 1e-9);
    this.vp.s = Math.min(vw / bw, vh / bh) * (1 - 2 * margin);
    this.vp.cx = (b.x1 + b.x2) / 2; this.vp.cy = (b.y1 + b.y2) / 2;
  }
}
