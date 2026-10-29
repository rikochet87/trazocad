// Vista: transformación mundo <-> pantalla, zoom, encuadre y giro. ox, oy: esquina de la vista en la zona de dibujo
// (las ventanas en mosaico del modelo la dividen en varias vistas). rot: giro de la vista (VIEWTWIST), en radianes: la
// dirección del dibujo con ese ángulo se ve horizontal (PLAN alinea la vista con el SCP poniendo rot = ángulo del SCP).

// Universal → ejes de la vista (sin escala) y al revés
export const toFrame = (rot, x, y) => { if (!rot) return [x, y]; const c = Math.cos(rot), s = Math.sin(rot); return [x * c + y * s, -x * s + y * c]; };
export const fromFrame = (rot, u, v) => { if (!rot) return [u, v]; const c = Math.cos(rot), s = Math.sin(rot); return [u * c - v * s, u * s + v * c]; };

// Métodos comunes a las vistas: usan cx, cy (centro en el dibujo), scale, rot, w, h, ox, oy
class ViewBase {
  toScreen(p) {
    const [u, v] = toFrame(this.rot, p.x - this.cx, p.y - this.cy);
    return { x: u * this.scale + this.ox + this.w / 2, y: this.oy + this.h / 2 - v * this.scale };
  }
  toWorld(s) {
    const [dx, dy] = fromFrame(this.rot, (s.x - this.ox - this.w / 2) / this.scale, (this.oy + this.h / 2 - s.y) / this.scale);
    return { x: dx + this.cx, y: dy + this.cy };
  }
  // Esquinas de la vista en el dibujo (inferior izquierda, inferior derecha, superior derecha, superior izquierda)
  poly() {
    const { ox, oy, w, h } = this;
    return [{ x: ox, y: oy + h }, { x: ox + w, y: oy + h }, { x: ox + w, y: oy }, { x: ox, y: oy }].map(s => this.toWorld(s));
  }
  // Rectángulo del dibujo que contiene la vista (con la vista girada, el de sus cuatro esquinas)
  rect() {
    if (!this.rot) { const a = this.toWorld({ x: this.ox, y: this.oy + this.h }), b = this.toWorld({ x: this.ox + this.w, y: this.oy }); return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
    const q = this.poly(), xs = q.map(p => p.x), ys = q.map(p => p.y);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  contains(s) { return s.x >= this.ox && s.x < this.ox + this.w && s.y >= this.oy && s.y < this.oy + this.h; }
  // Rectángulo de los puntos en los ejes de la vista: {u1, v1, u2, v2}
  frameBox(pts) {
    let u1 = Infinity, v1 = Infinity, u2 = -Infinity, v2 = -Infinity;
    for (const p of pts) { const [u, v] = toFrame(this.rot, p.x, p.y); u1 = Math.min(u1, u); u2 = Math.max(u2, u); v1 = Math.min(v1, v); v2 = Math.max(v2, v); }
    return { u1, v1, u2, v2 };
  }
  // Centro en el dibujo del rectángulo de la vista (en sus ejes)
  frameCenter(f) { const [x, y] = fromFrame(this.rot, (f.u1 + f.u2) / 2, (f.v1 + f.v2) / 2); return { x, y }; }
  fit(b, margin) {
    if (!b || !isFinite(b.x1)) return;
    this.fitPts([{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y1 }, { x: b.x2, y: b.y2 }, { x: b.x1, y: b.y2 }], margin);
  }
}

export class View extends ViewBase {
  constructor() { super(); this.cx = 210; this.cy = 148.5; this.scale = 2; this.rot = 0; this.w = 800; this.h = 600; this.ox = 0; this.oy = 0; this.stack = []; }

  push() { this.stack.push({ cx: this.cx, cy: this.cy, scale: this.scale, rot: this.rot }); if (this.stack.length > 50) this.stack.shift(); }
  prev() { const s = this.stack.pop(); if (s) Object.assign(this, s); return !!s; }

  zoomAt(f, s) {
    const w = this.toWorld(s);
    this.scale = Math.min(1e8, Math.max(1e-6, this.scale * f));
    const [dx, dy] = fromFrame(this.rot, (s.x - this.ox - this.w / 2) / this.scale, (this.oy + this.h / 2 - s.y) / this.scale);
    this.cx = w.x - dx; this.cy = w.y - dy;
  }
  panBy(dx, dy) { const [x, y] = fromFrame(this.rot, dx / this.scale, -dy / this.scale); this.cx -= x; this.cy -= y; }

  // Ajusta la vista a los puntos (en el dibujo), sin cambiar el giro
  fitPts(pts, margin = 0.06) {
    if (!pts.length) return;
    const f = this.frameBox(pts), bw = f.u2 - f.u1, bh = f.v2 - f.v1;
    if (!isFinite(bw) || !isFinite(bh)) return;
    if (bw > 1e-9 || bh > 1e-9) this.scale = Math.min(this.w / Math.max(bw, 1e-9), this.h / Math.max(bh, 1e-9)) * (1 - 2 * margin);
    const c = this.frameCenter(f);
    this.cx = c.x; this.cy = c.y;
  }
  // Gira la vista alrededor de su centro (o del punto del dibujo p, que se queda en el mismo sitio de la pantalla)
  setRot(a, p = null) {
    const s = p ? this.toScreen(p) : null;
    this.rot = Math.abs(a) < 1e-12 ? 0 : a;
    if (p) { const w = this.toWorld(s); this.cx += p.x - w.x; this.cy += p.y - w.y; }
  }
}

// Vista del modelo a través de una ventana gráfica activa de una presentación (MSPACE). Con el giro de la ventana (twist):
// papel = centroRectángulo + giro(modelo − centroVentana, −twist)·s
export class VpView extends ViewBase {
  constructor(paper, vp) { super(); this.paper = paper; this.vp = vp; this.stack = []; }
  get w() { return this.paper.w; }
  get h() { return this.paper.h; }
  get ox() { return 0; }
  get oy() { return 0; }
  contains() { return true; }
  get rot() { return (this.vp.twist || 0) + (this.paper.rot || 0); }
  get scale() { return this.paper.scale * this.vp.s; }
  get vc() { return { x: (this.vp.p1.x + this.vp.p2.x) / 2, y: (this.vp.p1.y + this.vp.p2.y) / 2 }; }
  // Punto del modelo que se ve en el punto del papel q
  modelAt(q) { const vc = this.vc, [x, y] = fromFrame(this.vp.twist || 0, (q.x - vc.x) / this.vp.s, (q.y - vc.y) / this.vp.s); return { x: this.vp.cx + x, y: this.vp.cy + y }; }
  get cx() { return this.modelAt({ x: this.paper.cx, y: this.paper.cy }).x; }
  get cy() { return this.modelAt({ x: this.paper.cx, y: this.paper.cy }).y; }
  // Coloca el centro de la ventana de modo que el punto del modelo m se vea en el centro de la vista del papel
  centerOn(m) {
    const vc = this.vc, [x, y] = fromFrame(this.vp.twist || 0, (this.paper.cx - vc.x) / this.vp.s, (this.paper.cy - vc.y) / this.vp.s);
    this.vp.cx = m.x - x; this.vp.cy = m.y - y;
  }
  // Rectángulo del modelo que contiene lo visible a través de la ventana
  rect() { return vpModelBox(this.vp); }
  push() { this.stack.push({ cx: this.vp.cx, cy: this.vp.cy, s: this.vp.s }); if (this.stack.length > 50) this.stack.shift(); }
  prev() { const s = this.stack.pop(); if (s) Object.assign(this.vp, s); return !!s; }
  zoomAt(f, s) {
    const w = this.toWorld(s);
    this.vp.s = Math.min(1e6, Math.max(1e-8, this.vp.s * f));
    const [dx, dy] = fromFrame(this.rot, (s.x - this.w / 2) / this.scale, (this.h / 2 - s.y) / this.scale);
    this.centerOn({ x: w.x - dx, y: w.y - dy });
  }
  panBy(dx, dy) { const [x, y] = fromFrame(this.rot, dx / this.scale, -dy / this.scale); this.vp.cx -= x; this.vp.cy -= y; }
  // Ajusta la escala de la ventana para que los puntos quepan en su rectángulo, centrados en ella
  fitPts(pts, margin = 0.05) {
    if (!pts.length) return;
    const vw = this.vp.p2.x - this.vp.p1.x, vh = this.vp.p2.y - this.vp.p1.y;
    const f = this.frameBox(pts.map(p => ({ x: p.x, y: p.y }))), bw = Math.max(f.u2 - f.u1, 1e-9), bh = Math.max(f.v2 - f.v1, 1e-9);
    if (!isFinite(bw) || !isFinite(bh)) return;
    this.vp.s = Math.min(vw / bw, vh / bh) * (1 - 2 * margin);
    const [x, y] = fromFrame(this.vp.twist || 0, (f.u1 + f.u2) / 2, (f.v1 + f.v2) / 2);
    this.vp.cx = x; this.vp.cy = y;
  }
  frameBox(pts) { // en los ejes de la ventana (su giro), no en los de la vista del papel
    const r = this.vp.twist || 0;
    let u1 = Infinity, v1 = Infinity, u2 = -Infinity, v2 = -Infinity;
    for (const p of pts) { const [u, v] = toFrame(r, p.x, p.y); u1 = Math.min(u1, u); u2 = Math.max(u2, u); v1 = Math.min(v1, v); v2 = Math.max(v2, v); }
    return { u1, v1, u2, v2 };
  }
}

// Esquinas en el modelo del rectángulo de una ventana gráfica (con su giro) y rectángulo que las contiene
export function vpModelPoly(vp) {
  const vc = { x: (vp.p1.x + vp.p2.x) / 2, y: (vp.p1.y + vp.p2.y) / 2 }, t = vp.twist || 0;
  return [[vp.p1.x, vp.p1.y], [vp.p2.x, vp.p1.y], [vp.p2.x, vp.p2.y], [vp.p1.x, vp.p2.y]].map(([px, py]) => {
    const [x, y] = fromFrame(t, (px - vc.x) / vp.s, (py - vc.y) / vp.s);
    return { x: vp.cx + x, y: vp.cy + y };
  });
}
export function vpModelBox(vp) {
  const q = vpModelPoly(vp), xs = q.map(p => p.x), ys = q.map(p => p.y);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}
