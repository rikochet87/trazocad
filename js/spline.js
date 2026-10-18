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
export function splinePts(e, perSpan = 16) {
  const key = `${e.deg}|${e.knots.join(',')}|${e.ctrl.map(p => `${p.x},${p.y}`).join(';')}|${e.w ? e.w.join(',') : ''}`;
  const hit = tcache.get(e);
  if (hit && hit.key === key) return hit.pts;
  const [u0, u1] = domain(e), out = [];
  const spans = [];
  for (let i = e.deg; i < e.ctrl.length; i++) if (e.knots[i + 1] > e.knots[i]) spans.push([e.knots[i], e.knots[i + 1]]);
  const per = Math.max(4, Math.min(perSpan, Math.floor(2400 / Math.max(1, spans.length))));
  if (!spans.length) spans.push([u0, u1]);
  for (const [a, b] of spans) for (let k = 0; k < per; k++) out.push(deBoor(e, a + (b - a) * k / per));
  out.push(deBoor(e, u1));
  const pts = out.filter((p, i) => !i || !G.eqPt(p, out[i - 1], 1e-12));
  if (e.closed && pts.length > 2 && G.eqPt(pts[0], pts[pts.length - 1], 1e-7)) pts.pop();
  tcache.set(e, { key, pts });
  return pts;
}
