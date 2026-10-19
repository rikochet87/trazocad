// Splines: B-splines (racionales opcionales) con evaluación de De Boor, interpolación por puntos de ajuste y teselado.
// Una spline guarda {deg, ctrl, knots, w?} y, según cómo se creó, `fit` (puntos de ajuste) o `cv` (vértices de control).
import * as G from './geom.js';
const { P } = G;

// Intervalo de nudos [knots[k], knots[k+1]) que contiene u, dentro del dominio de la curva
function span(knots, p, n, u) {
  if (u >= knots[n]) { let k = n - 1; while (k > p && knots[k] === knots[k + 1]) k--; return k; }
  if (u <= knots[p]) { let k = p; while (k < n - 1 && knots[k] === knots[k + 1]) k++; return k; }
  let lo = p, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (u < knots[m]) hi = m; else lo = m; }
  return lo;
}

export function deBoor(s, u) {
  const { deg: p, ctrl, knots, w } = s, k = span(knots, p, ctrl.length, u);
  const d = [];
  for (let j = 0; j <= p; j++) { const c = ctrl[k - p + j], wt = w ? w[k - p + j] : 1; d.push([c.x * wt, c.y * wt, wt]); }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j, den = knots[i + p - r + 1] - knots[i], a = den ? (u - knots[i]) / den : 0;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
    }
  }
  const q = d[p];
  return P(q[0] / q[2], q[1] / q[2]);
}
export const domain = s => [s.knots[s.deg], s.knots[s.ctrl.length]];

// Funciones base no nulas N[0..p] en u para el intervalo k (The NURBS Book, A2.2)
function basis(k, u, p, knots) {
  const N = [1], left = [], right = [];
  for (let j = 1; j <= p; j++) {
    left[j] = u - knots[k + 1 - j]; right[j] = knots[k + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const den = right[r + 1] + left[j - r], t = den ? N[r] / den : 0;
      N[r] = saved + right[r + 1] * t;
      saved = left[j - r] * t;
    }
    N[j] = saved;
  }
  return N;
}

// Resuelve A·X = B (B con columnas x, y) por eliminación gaussiana con pivote parcial
function solve(A, B) {
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-14) return null;
    [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      B[r] = [B[r][0] - f * B[c][0], B[r][1] - f * B[c][1]];
    }
  }
  const X = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let x = B[r][0], y = B[r][1];
    for (let k = r + 1; k < n; k++) { x -= A[r][k] * X[k].x; y -= A[r][k] * X[k].y; }
    X[r] = P(x / A[r][r], y / A[r][r]);
  }
  return X;
}

const dedupe = pts => pts.filter((p, i) => !i || !G.eqPt(p, pts[i - 1], 1e-9));

export function clampedKnots(n, p) {
  const k = [];
  for (let i = 0; i <= p; i++) k.push(0);
  for (let j = 1; j <= n - 1 - p; j++) k.push(j / (n - p));
  for (let i = 0; i <= p; i++) k.push(1);
  return k;
}
// Cúbica periódica uniforme: los 3 primeros vértices se repiten al final
function periodic(ctrl) {
  const c = [...ctrl, ctrl[0], ctrl[1], ctrl[2]];
  return { deg: 3, ctrl: c, knots: Array.from({ length: c.length + 4 }, (_, i) => i) };
}

// Spline que pasa por los puntos de ajuste (cúbica, parametrización por longitud de cuerda)
export function interpolate(pts, closed) {
  pts = dedupe(pts);
  if (closed && pts.length > 2 && G.eqPt(pts[0], pts[pts.length - 1], 1e-9)) pts.pop();
  const n = pts.length;
  if (n < 2) return null;
  if (closed && n >= 3) {
    // Q_i = (R_{i-1} + 4R_i + R_{i+1}) / 6, cíclico
    const A = pts.map((_, i) => { const row = new Array(n).fill(0); row[(i - 1 + n) % n] += 1 / 6; row[i] += 4 / 6; row[(i + 1) % n] += 1 / 6; return row; });
    const R = solve(A, pts.map(q => [q.x, q.y]));
    if (!R) return null;
    return periodic([R[n - 1], ...R.slice(0, n - 1)]);
  }
  const p = Math.min(3, n - 1), d = [0];
  for (let i = 1; i < n; i++) d.push(d[i - 1] + G.dist(pts[i - 1], pts[i]));
  const u = d.map(x => x / d[n - 1]);
  const knots = [];
  for (let i = 0; i <= p; i++) knots.push(0);
  for (let j = 1; j <= n - 1 - p; j++) { let s = 0; for (let i = j; i < j + p; i++) s += u[i]; knots.push(s / p); }
  for (let i = 0; i <= p; i++) knots.push(1);
  const A = u.map(uk => {
    const row = new Array(n).fill(0), k = span(knots, p, n, uk), N = basis(k, uk, p, knots);
    for (let j = 0; j <= p; j++) row[k - p + j] = N[j];
    return row;
  });
  const ctrl = solve(A, pts.map(q => [q.x, q.y]));
  return ctrl ? { deg: p, ctrl, knots } : null;
}

// Spline definida por vértices de control
export function fromCV(cv, closed) {
  cv = dedupe(cv);
  if (cv.length < 2) return null;
  if (closed && cv.length >= 3) return periodic(cv);
  const p = Math.min(3, cv.length - 1);
  return { deg: p, ctrl: cv, knots: clampedKnots(cv.length, p) };
}

// Recalcula la geometría (ctrl, knots) a partir de fit/cv. Devuelve false si no es posible.
export function rebuild(e) {
  const src = e.fit || e.cv;
  if (!src) return true;
  const s = e.fit ? interpolate(src, e.closed) : fromCV(src, e.closed);
  if (!s) return false;
  e.deg = s.deg; e.ctrl = s.ctrl; e.knots = s.knots; delete e.w;
  return true;
}

// Polilínea que aproxima la curva (los extremos de cada intervalo de nudos siempre se incluyen)
const tcache = new WeakMap();
function tessellate(e, perSpan = 16) {
  const key = `${e.deg}|${e.knots.join(',')}|${e.ctrl.map(p => `${p.x},${p.y}`).join(';')}|${e.w ? e.w.join(',') : ''}|${!!e.closed}`;
  const hit = tcache.get(e);
  if (hit && hit.key === key) return hit;
  const [u0, u1] = domain(e), raw = [];
  const spans = [];
  for (let i = e.deg; i < e.ctrl.length; i++) if (e.knots[i + 1] > e.knots[i]) spans.push([e.knots[i], e.knots[i + 1]]);
  const per = Math.max(4, Math.min(perSpan, Math.floor(2400 / Math.max(1, spans.length))));
  if (!spans.length) spans.push([u0, u1]);
  for (const [a, b] of spans) for (let k = 0; k < per; k++) { const u = a + (b - a) * k / per; raw.push([deBoor(e, u), u]); }
  raw.push([deBoor(e, u1), u1]);
  const kept = raw.filter((r, i) => !i || !G.eqPt(r[0], raw[i - 1][0], 1e-12));
  if (e.closed && kept.length > 2 && G.eqPt(kept[0][0], kept[kept.length - 1][0], 1e-7)) kept.pop();
  const t = { key, pts: kept.map(r => r[0]), us: kept.map(r => r[1]) };
  tcache.set(e, t);
  return t;
}
export const splinePts = e => tessellate(e).pts;
// Parámetro de cada punto de splinePts (en las cerradas el tramo final vuelve al primer punto con u = fin del dominio)
export const splineParams = e => tessellate(e).us;

// Parámetro del punto de la curva más cercano a p
export function nearestParam(e, p) {
  const { pts, us } = tessellate(e), n = pts.length, [u0, u1] = domain(e);
  let bi = 0, bd = Infinity;
  const segs = e.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n], d = G.dist(p, G.nearSeg(p, a, b).p);
    if (d < bd) { bd = d; bi = i; }
  }
  const ua = us[bi], ub = bi + 1 < n ? us[bi + 1] : u1;
  // Sección áurea en el intervalo del tramo más cercano, ampliado a sus vecinos
  let lo = Math.max(u0, ua - (ub - ua)), hi = Math.min(u1, ub + (ub - ua));
  const f = u => G.dist(deBoor(e, u), p), g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = f(x1), f2 = f(x2);
  for (let k = 0; k < 60 && hi - lo > (u1 - u0) * 1e-13; k++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = f(x1); }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = f(x2); }
  }
  const u = (lo + hi) / 2;
  return [u, u0, u1].reduce((b, c) => (f(c) < f(b) ? c : b));
}

// Derivada (numérica) en u
export function tangentAt(e, u) {
  const [u0, u1] = domain(e), h = (u1 - u0) * 1e-6, a = Math.max(u0, u - h), b = Math.min(u1, u + h);
  return G.norm(G.sub(deBoor(e, b), deBoor(e, a)));
}

// ---------- Inserción de nudos, tramos y unión (geometría exacta) ----------
const sameK = (a, b) => Math.abs(a - b) < 1e-12;
// Inserta el nudo u una vez (algoritmo de Boehm, en coordenadas homogéneas)
function insertKnot(s, u) {
  const { deg: p, ctrl, knots } = s, w = s.w || ctrl.map(() => 1), n = ctrl.length;
  const k = span(knots, p, n, u), C = [], W = [];
  for (let i = 0; i <= n; i++) {
    if (i <= k - p) { C.push(ctrl[i]); W.push(w[i]); continue; }
    if (i > k) { C.push(ctrl[i - 1]); W.push(w[i - 1]); continue; }
    const den = knots[i + p] - knots[i], a = den ? (u - knots[i]) / den : 0;
    const wa = (1 - a) * w[i - 1], wb = a * w[i], ww = wa + wb;
    C.push(P((wa * ctrl[i - 1].x + wb * ctrl[i].x) / ww, (wa * ctrl[i - 1].y + wb * ctrl[i].y) / ww)); W.push(ww);
  }
  const K = [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)];
  return { deg: p, ctrl: C, knots: K, ...(s.w ? { w: W } : {}) };
}
const mult = (knots, u) => knots.filter(k => sameK(k, u)).length;
function refineTo(s, u) { let c = s; while (mult(c.knots, u) < c.deg) c = insertKnot(c, u); return c; }

// Tramo [ua, ub] de la curva como spline abierta con extremos fijados
export function subSpline(s, ua, ub) {
  const c = refineTo(refineTo(s, ua), ub), p = c.deg, t = c.knots;
  const ra = t.findIndex(k => sameK(k, ua)), rb = t.findIndex(k => sameK(k, ub)), ma = mult(t, ua);
  const ja = ra + ma - p - 1, jb = rb - 1;
  const inner = t.slice(ra + ma, rb);
  const out = { deg: p, ctrl: c.ctrl.slice(ja, jb + 1), knots: [...Array(p + 1).fill(ua), ...inner, ...Array(p + 1).fill(ub)] };
  if (c.w) out.w = c.w.slice(ja, jb + 1);
  return out;
}
// Une dos splines abiertas del mismo grado (el final de a coincide con el inicio de b)
export function joinSplines(a, b) {
  const p = a.deg, a1 = a.knots[a.knots.length - 1], b0 = b.knots[0];
  const out = { deg: p, ctrl: [...a.ctrl, ...b.ctrl.slice(1)], knots: [...a.knots.slice(0, -1), ...b.knots.slice(p + 1).map(k => k - b0 + a1)] };
  if (a.w || b.w) out.w = [...(a.w || a.ctrl.map(() => 1)), ...(b.w || b.ctrl.map(() => 1)).slice(1)];
  return out;
}
export function reverseSpline(s) {
  const k0 = s.knots[0], k1 = s.knots[s.knots.length - 1];
  const out = { deg: s.deg, ctrl: [...s.ctrl].reverse(), knots: s.knots.map(k => k0 + k1 - k).reverse() };
  if (s.w) out.w = [...s.w].reverse();
  return out;
}
// Segmento recto como spline del grado p (para alargar una spline en la dirección de su tangente)
export function lineSpline(a, b, p) {
  return { deg: p, ctrl: Array.from({ length: p + 1 }, (_, i) => G.lerp(a, b, i / p)), knots: [...Array(p + 1).fill(0), ...Array(p + 1).fill(1)] };
}
