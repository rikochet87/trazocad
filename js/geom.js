// Geometría 2D: vectores, ángulos, matrices afines e intersecciones.
// @ts-check
/** @typedef {import('./types').Point} Point */
/** @typedef {import('./types').BBox} BBox */
/** @typedef {import('./types').Matrix} Matrix */
/** @typedef {import('./types').Prim} Prim */
/** @typedef {import('./types').SegPrim} SegPrim */
/** @typedef {import('./types').ArcPrim} ArcPrim */
/** @typedef {{c: Point, r: number}} CircleGeom */
/** @typedef {{c: Point, r: number, a1: number, a2: number}} ArcGeom Ángulos en radianes */
export const TAU = Math.PI * 2;
export const EPS = 1e-9;

/** @param {number} x @param {number} y @returns {Point} */
export const P = (x, y) => ({ x, y });
/** @param {Point} a @param {Point} b @returns {Point} */
export const add = (a, b) => P(a.x + b.x, a.y + b.y);
/** @param {Point} a @param {Point} b @returns {Point} */
export const sub = (a, b) => P(a.x - b.x, a.y - b.y);
/** @param {Point} a @param {number} s @returns {Point} */
export const mul = (a, s) => P(a.x * s, a.y * s);
/** @param {Point} a @param {Point} b @returns {number} */
export const dot = (a, b) => a.x * b.x + a.y * b.y;
/** @param {Point} a @param {Point} b @returns {number} */
export const cross = (a, b) => a.x * b.y - a.y * b.x;
/** @param {Point} a @returns {number} */
export const len = a => Math.hypot(a.x, a.y);
/** @param {Point} a @param {Point} b @returns {number} */
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** @param {Point} a @returns {Point} */
export const norm = a => { const l = len(a) || 1; return P(a.x / l, a.y / l); };
/** @param {Point} a @returns {Point} */
export const perp = a => P(-a.y, a.x);
/** Ángulo de a → b en radianes. @param {Point} a @param {Point} b @returns {number} */
export const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
/** @param {Point} p @param {number} a radianes @param {number} d @returns {Point} */
export const polar = (p, a, d) => P(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
/** @param {Point} a @param {Point} b @param {number} t @returns {Point} */
export const lerp = (a, b, t) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
/** @param {Point} a @param {Point} b @returns {Point} */
export const mid = (a, b) => lerp(a, b, 0.5);
/** @param {Point} v @param {number} a radianes @returns {Point} */
export const rot = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return P(v.x * c - v.y * s, v.x * s + v.y * c); };
/** Ángulo en [0, TAU). @param {number} a @returns {number} */
export const normAng = a => { a %= TAU; return a < 0 ? a + TAU : a; };
/** Barrido antihorario de a1 a a2, en (0, TAU]. @param {number} a1 @param {number} a2 @returns {number} */
export const sweep = (a1, a2) => { const s = normAng(a2 - a1); return s < 1e-12 ? TAU : s; };
/** @param {number} a @param {number} a1 @param {number} a2 @returns {boolean} */
export const angIn = (a, a1, a2) => normAng(a - a1) <= sweep(a1, a2) + 1e-9;
/** Radianes → grados. @param {number} r @returns {number} */
export const deg = r => r * 180 / Math.PI;
/** Grados → radianes. @param {number} d @returns {number} */
export const rad = d => d * Math.PI / 180;
/** @param {Point} a @param {Point} b @param {number} [e] @returns {boolean} */
export const eqPt = (a, b, e = 1e-7) => Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e;

// Matriz afín [a,b,c,d,e,f]: x' = a·x + c·y + e ; y' = b·x + d·y + f
export const Mx = {
  /** @returns {Matrix} */
  I: () => [1, 0, 0, 1, 0, 0],
  /** @param {number} dx @param {number} dy @returns {Matrix} */
  T: (dx, dy) => [1, 0, 0, 1, dx, dy],
  /** Giro de a radianes alrededor de c. @param {number} a @param {Point} [c] @returns {Matrix} */
  R: (a, c = P(0, 0)) => {
    const co = Math.cos(a), s = Math.sin(a);
    return [co, s, -s, co, c.x - co * c.x + s * c.y, c.y - s * c.x - co * c.y];
  },
  /** Escala k desde c. @param {number} k @param {Point} [c] @returns {Matrix} */
  S: (k, c = P(0, 0)) => [k, 0, 0, k, c.x - k * c.x, c.y - k * c.y],
  /** Simetría respecto de la recta p1-p2. @param {Point} p1 @param {Point} p2 @returns {Matrix} */
  Mi: (p1, p2) => {
    const a = ang(p1, p2), co = Math.cos(2 * a), s = Math.sin(2 * a);
    return [co, s, s, -co, p1.x - (co * p1.x + s * p1.y), p1.y - (s * p1.x - co * p1.y)];
  },
  /** @param {Matrix} m @param {Matrix} n @returns {Matrix} */
  mul: (m, n) => [ // m después de n
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ],
  /** @param {Matrix} m @param {Point} p @returns {Point} */
  ap: (m, p) => P(m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]),
  /** Aplica sólo la parte lineal (vectores). @param {Matrix} m @param {Point} v @returns {Point} */
  apV: (m, v) => P(m[0] * v.x + m[2] * v.y, m[1] * v.x + m[3] * v.y),
  /** @param {Matrix} m @returns {number} */
  det: m => m[0] * m[3] - m[1] * m[2],
  /** @param {Matrix} m @returns {number} */
  scaleOf: m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])),
};

// ---------- Intersecciones ----------
// Primitivas: {k:'s', a, b} segmento | {k:'a', c, r, a1, a2} arco (círculo completo: a1=0, a2=TAU)
/** Rectas a-b y c-d: p = a + (b−a)·t = c + (d−c)·u. @param {Point} a @param {Point} b @param {Point} c @param {Point} d @returns {{p: Point, t: number, u: number} | null} */
export function llInt(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  return { p: add(a, mul(r, t)), t, u };
}

/** Recta a-b y círculo (c, r). @param {Point} a @param {Point} b @param {Point} c @param {number} r @returns {{p: Point, t: number}[]} */
export function lcInt(a, b, c, r) {
  const d = sub(b, a), f = sub(a, c);
  const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - r * r;
  let disc = B * B - 4 * A * C;
  if (A < 1e-18 || disc < -1e-9 * A) return [];
  if (disc < 0) disc = 0;
  const sq = Math.sqrt(disc);
  const ts = sq < 1e-12 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.map(t => ({ p: add(a, mul(d, t)), t }));
}

/** @param {Point} c1 @param {number} r1 @param {Point} c2 @param {number} r2 @returns {Point[]} */
export function ccInt(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < 1e-12 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a, h = h2 > 0 ? Math.sqrt(h2) : 0;
  const pm = add(c1, mul(sub(c2, c1), a / d));
  if (h < 1e-12) return [pm];
  const ox = -(c2.y - c1.y) / d * h, oy = (c2.x - c1.x) / d * h;
  return [P(pm.x + ox, pm.y + oy), P(pm.x - ox, pm.y - oy)];
}

/** @param {number} t */
const onSeg = t => t >= -1e-9 && t <= 1 + 1e-9;

// extA/extB: tratar la primitiva como infinita (recta / círculo completo)
/** @param {Prim} A @param {Prim} B @param {boolean} [extA] @param {boolean} [extB] @returns {Point[]} */
export function primInt(A, B, extA = false, extB = false) {
  if (A.k === 's' && B.k === 's') {
    const r = llInt(A.a, A.b, B.a, B.b);
    if (!r) return [];
    return (extA || onSeg(r.t)) && (extB || onSeg(r.u)) ? [r.p] : [];
  }
  if (A.k === 'a' && B.k === 's') return primInt(B, A, extB, extA);
  if (A.k === 's' && B.k === 'a') {
    return lcInt(A.a, A.b, B.c, B.r)
      .filter(o => (extA || onSeg(o.t)) && (extB || angIn(ang(B.c, o.p), B.a1, B.a2)))
      .map(o => o.p);
  }
  const a = /** @type {ArcPrim} */ (A), b = /** @type {ArcPrim} */ (B); // quedan dos arcos
  return ccInt(a.c, a.r, b.c, b.r)
    .filter(p => (extA || angIn(ang(a.c, p), a.a1, a.a2)) && (extB || angIn(ang(b.c, p), b.a1, b.a2)));
}

/** @param {Point} p @param {Point} a @param {Point} b @returns {{p: Point, t: number}} */
export function nearSeg(p, a, b) {
  const d = sub(b, a), l2 = dot(d, d);
  let t = l2 < 1e-18 ? 0 : dot(sub(p, a), d) / l2;
  t = Math.max(0, Math.min(1, t));
  return { p: add(a, mul(d, t)), t };
}

/** @param {Point} p @param {ArcGeom} A @returns {Point} */
export function nearArc(p, A) {
  const a = ang(A.c, p);
  if (angIn(a, A.a1, A.a2)) return polar(A.c, a, A.r);
  const e1 = polar(A.c, A.a1, A.r), e2 = polar(A.c, A.a2, A.r);
  return dist(p, e1) < dist(p, e2) ? e1 : e2;
}

/** @param {Point} p @param {Prim} Q @returns {Point} */
export const nearPrim = (p, Q) => (Q.k === 's' ? nearSeg(p, Q.a, Q.b).p : nearArc(p, Q));

/** Caja de la primitiva (la de un arco es la de su círculo completo). @param {Prim} Q @returns {BBox} */
export const primBB = Q => {
  if (Q.k === 's') return { x1: Math.min(Q.a.x, Q.b.x), y1: Math.min(Q.a.y, Q.b.y), x2: Math.max(Q.a.x, Q.b.x), y2: Math.max(Q.a.y, Q.b.y) };
  return { x1: Q.c.x - Q.r, y1: Q.c.y - Q.r, x2: Q.c.x + Q.r, y2: Q.c.y + Q.r };
};

// ---------- Rectángulos ----------
/** @param {Point} a @param {Point} b @returns {BBox} */
export const normRect = (a, b) => ({ x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) });
/** @param {Point} p @param {BBox} r @returns {boolean} */
export const inRect = (p, r) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
/** @param {BBox} a @param {BBox} b @returns {boolean} */
export const bbOverlap = (a, b) => a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
/** @param {BBox} b @param {Point} p @param {number} t @returns {boolean} */
export const bbNear = (b, p, t) => p.x >= b.x1 - t && p.x <= b.x2 + t && p.y >= b.y1 - t && p.y <= b.y2 + t;

/** @param {Prim} Q @param {BBox} r @returns {boolean} */
export function primCrossRect(Q, r) {
  if (Q.k === 's') { if (inRect(Q.a, r) || inRect(Q.b, r)) return true; }
  else if (inRect(polar(Q.c, Q.a1, Q.r), r)) return true;
  const c = [P(r.x1, r.y1), P(r.x2, r.y1), P(r.x2, r.y2), P(r.x1, r.y2)];
  for (let i = 0; i < 4; i++) if (primInt(Q, { k: 's', a: c[i], b: c[(i + 1) % 4] }).length) return true;
  return false;
}

// ---------- Construcciones ----------
/** @param {Point} a @param {Point} b @param {Point} c @returns {CircleGeom | null} */
export function circle3(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cen = P(
    (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  );
  return { c: cen, r: dist(cen, a) };
}

/** Arco por a, b y c (b intermedio). @param {Point} a @param {Point} b @param {Point} c @returns {ArcGeom | null} */
export function arc3(a, b, c) {
  const k = circle3(a, b, c);
  if (!k) return null;
  const a1 = ang(k.c, a), a3 = ang(k.c, c), am = ang(k.c, b);
  return angIn(am, a1, a3) ? { c: k.c, r: k.r, a1, a2: a3 } : { c: k.c, r: k.r, a1: a3, a2: a1 };
}

// Arco de un segmento de polilínea con curvatura (bulge) DXF
/** @param {Point} p1 @param {Point} p2 @param {number} b curvatura @returns {ArcGeom} */
export function bulgeArc(p1, p2, b) {
  const th = 4 * Math.atan(b), d = dist(p1, p2);
  const c = add(mid(p1, p2), mul(perp(norm(sub(p2, p1))), d / 2 / Math.tan(th / 2)));
  const r = dist(c, p1);
  return b > 0 ? { c, r, a1: ang(c, p1), a2: ang(c, p2) } : { c, r, a1: ang(c, p2), a2: ang(c, p1) };
}

// Curvatura del arco que pasa por p1 → m → p2
/** @param {Point} p1 @param {Point} m @param {Point} p2 @returns {number} */
export function bulgeFrom3(p1, m, p2) {
  const k = arc3(p1, m, p2);
  if (!k) return 0;
  const s = Math.tan(sweep(k.a1, k.a2) / 4);
  return cross(sub(p2, p1), sub(m, p1)) < 0 ? s : -s;
}

// Curvatura de un arco tangente a la dirección t en p que termina en q
/** @param {Point} p @param {Point} t dirección @param {Point} q @returns {number} */
export function tangentBulge(p, t, q) {
  const ch = sub(q, p);
  return Math.tan(Math.atan2(cross(t, ch), dot(t, ch)) / 2);
}

/** @param {Point} p @param {Point[]} poly @returns {boolean} */
export function pointInPoly(p, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}

/** Área con signo (positiva en sentido antihorario). @param {Point[]} pts @returns {number} */
export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

/** @param {Point[]} pts @param {boolean} [closed] @returns {number} */
export function polyLen(pts, closed) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) l += dist(pts[pts.length - 1], pts[0]);
  return l;
}
