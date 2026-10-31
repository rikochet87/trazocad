// Restricciones paramétricas: geométricas (horizontal, vertical, paralela, perpendicular, coincidente, concéntrica,
// igual, fija, tangente, colineal) y de cota (distancia horizontal/vertical/alineada, radio, diámetro, ángulo) con
// parámetros y expresiones. Un solucionador numérico ajusta la geometría con el menor cambio posible.
//
// Restricción: {id, type, refs, ...}. Referencias:
//   punto  {id, k: 'p1'|'p2'|'c'|'s'|'e'|'p'|'v', i?}  (s/e: extremos de un arco; v: vértice i de una polilínea)
//   línea  {id, seg?}  (línea o tramo seg de una polilínea)   ·   círculo {id}  (círculo o arco)
// De cota: {name, expr, ...} y datos de colocación del texto (off, ang).
import * as G from './geom.js';

const { P } = G;

// ---------- Variables de cada entidad ----------
const VARS = {
  line: e => [e.p1.x, e.p1.y, e.p2.x, e.p2.y],
  circle: e => [e.c.x, e.c.y, e.r],
  arc: e => [e.c.x, e.c.y, e.r, e.a1, e.a2],
  point: e => [e.p.x, e.p.y],
  pline: e => e.pts.flatMap(p => [p.x, p.y]),
};
const WRITE = {
  line: (e, v) => { e.p1 = P(v[0], v[1]); e.p2 = P(v[2], v[3]); },
  circle: (e, v) => { e.c = P(v[0], v[1]); e.r = Math.max(1e-9, v[2]); },
  arc: (e, v) => { e.c = P(v[0], v[1]); e.r = Math.max(1e-9, v[2]); e.a1 = G.normAng(v[3]); e.a2 = G.normAng(v[4]); },
  point: (e, v) => { e.p = P(v[0], v[1]); },
  pline: (e, v) => { e.pts = e.pts.map((_, i) => P(v[2 * i], v[2 * i + 1])); },
};
export const constrainable = e => !!e && !!VARS[e.type];
export const entVals = e => VARS[e.type](e);
// ¿Siguen existiendo las entidades y los vértices o tramos referenciados?
export function consValid(doc, c) {
  return c.refs.every(r => {
    const e = doc.get(r.id);
    if (!constrainable(e)) return false;
    if (e.type !== 'pline') return r.k !== 'v' && r.seg == null;
    const n = e.pts.length;
    return r.k === 'v' ? r.i < n : r.seg != null && r.seg < (e.closed ? n : n - 1);
  });
}

export const refIds = c => [...new Set(c.refs.map(r => r.id))];

// Lectores de geometría sobre el vector de variables x (o sobre la entidad si x falta)
function readers(ents, x, off) {
  const at = (id, k) => x[off.get(id) + k];
  const pt = r => {
    const e = ents.get(r.id), t = e.type;
    if (t === 'line') return r.k === 'p2' ? P(at(r.id, 2), at(r.id, 3)) : r.k === 'mid' ? P((at(r.id, 0) + at(r.id, 2)) / 2, (at(r.id, 1) + at(r.id, 3)) / 2) : P(at(r.id, 0), at(r.id, 1));
    if (t === 'point') return P(at(r.id, 0), at(r.id, 1));
    if (t === 'pline') return P(at(r.id, 2 * r.i), at(r.id, 2 * r.i + 1));
    const c = P(at(r.id, 0), at(r.id, 1));
    if (r.k === 's' || r.k === 'e') return G.polar(c, at(r.id, r.k === 's' ? 3 : 4), at(r.id, 2));
    return c;
  };
  const line = r => {
    const e = ents.get(r.id);
    if (e.type === 'pline') { const n = e.pts.length, j = r.seg, k = (j + 1) % n; return [P(at(r.id, 2 * j), at(r.id, 2 * j + 1)), P(at(r.id, 2 * k), at(r.id, 2 * k + 1))]; }
    return [P(at(r.id, 0), at(r.id, 1)), P(at(r.id, 2), at(r.id, 3))];
  };
  const circ = r => ({ c: P(at(r.id, 0), at(r.id, 1)), r: at(r.id, 2) });
  return { pt, line, circ };
}
const isLineRef = (ents, r) => r.k == null && (ents.get(r.id)?.type === 'line' || (ents.get(r.id)?.type === 'pline' && r.seg != null));
const isCircRef = (ents, r) => r.k == null && ['circle', 'arc'].includes(ents.get(r.id)?.type);
const distLine = (p, [a, b]) => G.cross(G.sub(b, a), G.sub(p, a)) / (G.dist(a, b) || 1);

// Residuos de una restricción (S: longitud característica, para comparar ángulos con distancias)
function residuals(c, R, ents, S, vals) {
  const { pt, line, circ } = R, rf = c.refs, out = [];
  const dir = l => G.sub(l[1], l[0]), nrm = v => G.len(v) || 1;
  switch (c.type) {
    case 'horizontal': case 'vertical': {
      const [a, b] = rf.length === 2 ? [pt(rf[0]), pt(rf[1])] : line(rf[0]);
      out.push(c.type === 'horizontal' ? b.y - a.y : b.x - a.x);
      break;
    }
    case 'parallel': case 'perpendicular': {
      const d1 = dir(line(rf[0])), d2 = dir(line(rf[1]));
      out.push(S * (c.type === 'parallel' ? G.cross(d1, d2) : G.dot(d1, d2)) / (nrm(d1) * nrm(d2)));
      break;
    }
    case 'collinear': { const l1 = line(rf[0]), l2 = line(rf[1]); out.push(distLine(l2[0], l1), distLine(l2[1], l1)); break; }
    case 'coincident': {
      const p = pt(rf[0]);
      if (rf[1].k != null) { const q = pt(rf[1]); out.push(q.x - p.x, q.y - p.y); }
      else if (isCircRef(ents, rf[1])) { const k = circ(rf[1]); out.push(G.dist(p, k.c) - k.r); }
      else out.push(distLine(p, line(rf[1])));
      break;
    }
    case 'concentric': { const a = circ(rf[0]).c, b = circ(rf[1]).c; out.push(b.x - a.x, b.y - a.y); break; }
    case 'equal':
      if (isCircRef(ents, rf[0])) out.push(circ(rf[1]).r - circ(rf[0]).r);
      else { const a = line(rf[0]), b = line(rf[1]); out.push(G.dist(b[0], b[1]) - G.dist(a[0], a[1])); }
      break;
    case 'fix':
      if (rf[0].k != null) { const p = pt(rf[0]); out.push(p.x - c.at.x, p.y - c.at.y); }
      else { const e = ents.get(rf[0].id), v = VARS[e.type](e); void v; c.vals.forEach((v0, k) => out.push(R.raw(rf[0].id, k) - v0)); }
      break;
    case 'tangent': {
      if (isLineRef(ents, rf[0])) { const k = circ(rf[1]); out.push(Math.abs(distLine(k.c, line(rf[0]))) - k.r); }
      else { const a = circ(rf[0]), b = circ(rf[1]), d = G.dist(a.c, b.c); out.push(c.inner ? d - Math.abs(a.r - b.r) : d - (a.r + b.r)); }
      break;
    }
    // De cota
    case 'dist': {
      const v = vals.get(c.name), a = pt(rf[0]), b = pt(rf[1]);
      if (c.orient === 'h') out.push((b.x - a.x) - c.sgn * v);
      else if (c.orient === 'v') out.push((b.y - a.y) - c.sgn * v);
      else out.push(G.dist(a, b) - v);
      break;
    }
    case 'radius': out.push(circ(rf[0]).r - vals.get(c.name)); break;
    case 'diameter': out.push(2 * circ(rf[0]).r - vals.get(c.name)); break;
    case 'angle': {
      const d1 = dir(line(rf[0])), d2 = dir(line(rf[1]));
      const a = Math.atan2(G.cross(d1, d2), G.dot(d1, d2));
      out.push(S * (a - c.sgn * G.rad(vals.get(c.name))));
      break;
    }
  }
  return out;
}

// ---------- Expresiones ----------
// Números, nombres, + - * / ^, paréntesis, pi y funciones (ángulos en grados)
const FUN = { sin: x => Math.sin(G.rad(x)), cos: x => Math.cos(G.rad(x)), tan: x => Math.tan(G.rad(x)), asin: x => G.deg(Math.asin(x)), acos: x => G.deg(Math.acos(x)), atan: x => G.deg(Math.atan(x)), sqrt: Math.sqrt, abs: Math.abs, round: Math.round, min: Math.min, max: Math.max };
export function parseExpr(src) {
  const toks = String(src).match(/\d+(?:[.,]\d+)?(?:e[-+]?\d+)?|[A-Za-zÁÉÍÓÚáéíóúÑñ_][\wÁÉÍÓÚáéíóúÑñ]*|[-+*/^(),]|\S/g) || [];
  let i = 0;
  const peek = () => toks[i], eat = t => { if (toks[i] !== t) throw new Error(`se esperaba "${t}"`); i++; };
  const prim = () => {
    const t = toks[i++];
    if (t === undefined) throw new Error('expresión incompleta');
    if (t === '(') { const v = add(); eat(')'); return v; }
    if (t === '-') { const v = pow(); return env => -v(env); }
    if (t === '+') return pow();
    if (/^\d/.test(t)) { const n = parseFloat(t.replace(',', '.')); return () => n; }
    if (/^[A-Za-zÁÉÍÓÚáéíóúÑñ_]/.test(t)) {
      if (peek() === '(') {
        const f = FUN[t.toLowerCase()];
        if (!f) throw new Error(`función desconocida "${t}"`);
        eat('(');
        const args = [add()];
        while (peek() === ',') { i++; args.push(add()); }
        eat(')');
        return env => f(...args.map(a => a(env)));
      }
      if (t.toLowerCase() === 'pi') return () => Math.PI;
      return env => env(t);
    }
    throw new Error(`símbolo no válido "${t}"`);
  };
  const pow = () => { const a = prim(); if (peek() === '^') { i++; const b = pow(); return env => a(env) ** b(env); } return a; };
  const mul = () => { let a = pow(); while (peek() === '*' || peek() === '/') { const op = toks[i++], b = pow(), x = a; a = op === '*' ? env => x(env) * b(env) : env => x(env) / b(env); } return a; };
  const add = () => { let a = mul(); while (peek() === '+' || peek() === '-') { const op = toks[i++], b = mul(), x = a; a = op === '+' ? env => x(env) + b(env) : env => x(env) - b(env); } return a; };
  const f = add();
  if (i < toks.length) throw new Error(`sobra "${toks[i]}"`);
  return f;
}
export const exprNames = src => (String(src).match(/[A-Za-zÁÉÍÓÚáéíóúÑñ_][\wÁÉÍÓÚáéíóúÑñ]*/g) || []).filter(n => n.toLowerCase() !== 'pi' && !FUN[n.toLowerCase()]);

// Valores de todos los parámetros (de cota y de usuario). Devuelve {vals: Map, errors: Map}
export function evalParams(doc) {
  const defs = new Map();
  for (const p of doc.params || []) defs.set(p.name, p.expr);
  for (const c of doc.constraints || []) if (c.name) defs.set(c.name, c.expr);
  const vals = new Map(), errors = new Map(), busy = new Set();
  const get = name => {
    if (vals.has(name)) return vals.get(name);
    if (!defs.has(name)) throw new Error(`"${name}" no existe`);
    if (busy.has(name)) throw new Error(`referencia circular en "${name}"`);
    busy.add(name);
    try { const v = parseExpr(defs.get(name))(get); if (!Number.isFinite(v)) throw new Error('resultado no numérico'); vals.set(name, v); return v; }
    finally { busy.delete(name); }
  };
  for (const n of defs.keys()) { try { get(n); } catch (err) { errors.set(n, err.message); } }
  return { vals, errors };
}

// ---------- Solucionador ----------
// Ajusta las entidades para cumplir las restricciones con el menor cambio ponderado (las de `keep` se mueven menos).
// Devuelve {ok, changed: Set de ids, residual}
export function solve(doc, keep = new Set()) {
  const cons = doc.constraints || [];
  if (!cons.length) return { ok: true, changed: new Set(), residual: 0 };
  const ents = new Map(), off = new Map(), x0 = [], wts = [];
  for (const c of cons) for (const id of refIds(c)) {
    if (ents.has(id)) continue;
    const e = doc.get(id);
    if (!constrainable(e)) continue;
    ents.set(id, e); off.set(id, x0.length);
    for (const v of VARS[e.type](e)) { x0.push(v); wts.push(keep.has(id) ? 1e4 : 1); }
  }
  const active = cons.filter(c => refIds(c).every(id => ents.has(id)));
  const { vals } = evalParams(doc);
  const usable = active.filter(c => !c.name || vals.has(c.name));
  const n = x0.length;
  if (!n || !usable.length) return { ok: true, changed: new Set(), residual: 0 };
  let b = null;
  for (const e of ents.values()) for (const p of e.type === 'circle' || e.type === 'arc' ? [e.c] : e.type === 'line' ? [e.p1, e.p2] : e.type === 'point' ? [e.p] : e.pts) b = b ? { x1: Math.min(b.x1, p.x), y1: Math.min(b.y1, p.y), x2: Math.max(b.x2, p.x), y2: Math.max(b.y2, p.y) } : { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  const S = Math.max(1, b.x2 - b.x1, b.y2 - b.y1);
  const F = x => {
    const R = readers(ents, x, off);
    R.raw = (id, k) => x[off.get(id) + k];
    return usable.flatMap(c => residuals(c, R, ents, S, vals));
  };
  let x = [...x0], r = F(x);
  const norm = v => Math.sqrt(v.reduce((s, a) => s + a * a, 0));
  const tol = 1e-9 * S;
  for (let it = 0; it < 60 && norm(r) > tol; it++) {
    const m = r.length, h = 1e-7 * S, J = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const xs = [...x]; xs[j] += h;
      const rj = F(xs);
      for (let k = 0; k < m; k++) J[k][j] = (rj[k] - r[k]) / h;
    }
    // Paso de mínimo cambio ponderado: dx = -W⁻¹Jᵀ (J W⁻¹ Jᵀ + λI)⁻¹ r
    const A = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, c) => { let s = 0; for (let j = 0; j < n; j++) s += J[a][j] * J[c][j] / wts[j]; return s; }));
    const tr = A.reduce((s, row, k) => s + row[k], 0) / m || 1;
    for (let k = 0; k < m; k++) A[k][k] += 1e-10 * tr;
    const y = solveLin(A, r.map(v => -v));
    if (!y) break;
    const dx = new Array(n).fill(0);
    for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < m; k++) s += J[k][j] * y[k]; dx[j] = s / wts[j]; }
    // Búsqueda lineal sencilla: se acepta el paso si reduce el residuo
    let t = 1, nr = norm(r), xn, rn;
    for (let k = 0; k < 12; k++) { xn = x.map((v, j) => v + t * dx[j]); rn = F(xn); if (norm(rn) < nr) break; t /= 2; }
    if (norm(rn) >= nr) break;
    x = xn; r = rn;
  }
  const residual = norm(r), ok = residual <= Math.max(tol * 1e3, 1e-7);
  const changed = new Set();
  if (ok) for (const [id, e] of ents) {
    const o = off.get(id), len = VARS[e.type](e).length, v = x.slice(o, o + len);
    if (v.some((a, k) => Math.abs(a - x0[o + k]) > 1e-12)) { doc.before?.(e); WRITE[e.type](e, v); changed.add(id); }
  }
  return { ok, changed, residual };
}
function solveLin(A, b) {
  const n = A.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const y = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * y[k]; y[r] = s / M[r][r]; }
  return y;
}

// ---------- Ayudas para comandos y dibujo ----------
// Referencia de punto a partir de la referencia a objetos del punto designado
export function pointRefFromSnap(doc, s) {
  if (!s || s.ids) return null;
  const e = doc.get(s.id);
  if (!constrainable(e)) return null;
  if (s.snap === 'end') return e.type === 'line' ? { id: e.id, k: s.i ? 'p2' : 'p1' } : e.type === 'arc' ? { id: e.id, k: s.i ? 'e' : 's' } : e.type === 'pline' ? { id: e.id, k: 'v', i: s.i } : null;
  if (s.snap === 'cen' && (e.type === 'circle' || e.type === 'arc')) return { id: e.id, k: 'c' };
  if (s.snap === 'mid' && e.type === 'line') return { id: e.id, k: 'mid' };
  if (s.snap === 'nod' && e.type === 'point') return { id: e.id, k: 'p' };
  return null;
}
// Punto restringible de una entidad más cercano al punto designado (extremos, centro, vértices, punto medio)
export function nearestPointRef(e, p) {
  const c = [];
  if (e.type === 'line') c.push([{ id: e.id, k: 'p1' }, e.p1], [{ id: e.id, k: 'p2' }, e.p2], [{ id: e.id, k: 'mid' }, G.mid(e.p1, e.p2)]);
  else if (e.type === 'circle') c.push([{ id: e.id, k: 'c' }, e.c]);
  else if (e.type === 'arc') c.push([{ id: e.id, k: 's' }, G.polar(e.c, e.a1, e.r)], [{ id: e.id, k: 'e' }, G.polar(e.c, e.a2, e.r)], [{ id: e.id, k: 'c' }, e.c]);
  else if (e.type === 'point') c.push([{ id: e.id, k: 'p' }, e.p]);
  else if (e.type === 'pline') e.pts.forEach((q, i) => c.push([{ id: e.id, k: 'v', i }, q]));
  return c.reduce((b, x) => (!b || G.dist(x[1], p) < G.dist(b[1], p) ? x : b), null)?.[0] || null;
}
// Referencia de línea (línea o tramo de polilínea más cercano al punto designado)
export function lineRefAt(e, p) {
  if (e.type === 'line') return { id: e.id };
  if (e.type !== 'pline') return null;
  const n = e.pts.length, segs = e.closed ? n : n - 1;
  let best = 0, bd = Infinity;
  for (let j = 0; j < segs; j++) { const d = G.dist(p, G.nearSeg(p, e.pts[j], e.pts[(j + 1) % n]).p); if (d < bd) { bd = d; best = j; } }
  return { id: e.id, seg: best };
}
// Geometría actual de una referencia (para colocar símbolos y cotas)
export function refGeom(doc, r) {
  const e = doc.get(r.id);
  if (!e) return null;
  const ents = new Map([[e.id, e]]), off = new Map([[e.id, 0]]), R = readers(ents, VARS[e.type](e), off);
  if (r.k != null) return { pt: R.pt(r) };
  if (isCircRef(ents, r)) return { circ: R.circ(r) };
  return { line: R.line(r) };
}
// Cota virtual con la que se dibuja una restricción de cota
export function consDim(doc, c, label) {
  const g = rf => refGeom(doc, rf);
  if (c.type === 'dist') {
    const a = g(c.refs[0])?.pt, b = g(c.refs[1])?.pt;
    if (!a || !b) return null;
    if (c.orient === 'a') { const u = G.norm(G.sub(b, a)), nn = G.perp(u); return { type: 'dim', kind: 'ali', p1: a, p2: b, p3: G.add(G.mid(a, b), G.mul(nn, c.off || 0)), text: label }; }
    const rot = c.orient === 'h' ? 0 : Math.PI / 2, nn = G.perp(P(Math.cos(rot), Math.sin(rot)));
    return { type: 'dim', kind: 'lin', p1: a, p2: b, p3: G.add(G.mid(a, b), G.mul(nn, c.off || 0)), rot, text: label };
  }
  if (c.type === 'radius' || c.type === 'diameter') {
    const k = g(c.refs[0])?.circ;
    if (!k) return null;
    const ang = c.ang || 0.7;
    return { type: 'dim', kind: c.type === 'radius' ? 'rad' : 'dia', p1: k.c, p2: G.polar(k.c, ang, k.r), p3: G.polar(k.c, ang, k.r + (c.off ?? k.r * 0.5)), text: label };
  }
  if (c.type === 'angle') {
    const l1 = g(c.refs[0])?.line, l2 = g(c.refs[1])?.line;
    if (!l1 || !l2) return null;
    const X = G.llInt(l1[0], l1[1], l2[0], l2[1]);
    if (!X) return null;
    const far = l => (G.dist(l[0], X.p) > G.dist(l[1], X.p) ? l[0] : l[1]);
    const a1 = G.ang(X.p, far(l1)), a2 = G.ang(X.p, far(l2)), R = c.off || G.dist(X.p, far(l1)) * 0.6;
    const mid = a1 + (c.sgn > 0 ? G.sweep(a1, a2) : -G.sweep(a2, a1)) / 2;
    return { type: 'dim', kind: 'ang', c: X.p, p1: far(l1), p2: far(l2), p3: G.polar(X.p, mid, R), l1, l2, text: label };
  }
  return null;
}
export const GEOM_NAMES = { horizontal: 'Horizontal', vertical: 'Vertical', parallel: 'Paralela', perpendicular: 'Perpendicular', coincident: 'Coincidente', concentric: 'Concéntrica', equal: 'Igual', fix: 'Fija', tangent: 'Tangente', collinear: 'Colineal' };
export const DIM_TYPES = new Set(['dist', 'radius', 'diameter', 'angle']);

// ---------- Restricciones automáticas (AUTOCONSTRAIN) ----------
// Tipos en el orden de prioridad de AutoCAD. Las tolerancias son la distancia y el ángulo (grados) dentro de los que se
// considera que la geometría ya cumple la restricción.
export const AUTO_TYPES = { coincident: 'Coincidente', collinear: 'Colineal', parallel: 'Paralela', perpendicular: 'Perpendicular', tangent: 'Tangente', concentric: 'Concéntrica', horizontal: 'Horizontal', vertical: 'Vertical', equal: 'Igual' };
export const AUTO_DEFAULT = { tol: 0.05, angTol: 1, off: [] };
export const AUTO_MAX_VARS = 2400; // variables (coordenadas) como máximo en una designación: el cálculo crece con su cubo

// Busca las restricciones geométricas que la geometría designada ya cumple (dentro de las tolerancias) y que no se deducen
// de otras: cada candidata se acepta sólo si aumenta el rango del jacobiano de las restricciones (las existentes incluidas),
// así no quedan restricciones redundantes. No modifica el documento. o: {tol, angTol, off: [tipos desactivados]}
// Devuelve {cons: [restricciones nuevas], counts: {tipo: n}}
export function autoConstrain(doc, ids, o = {}) {
  const tol = o.tol ?? AUTO_DEFAULT.tol, at = G.rad(o.angTol ?? AUTO_DEFAULT.angTol), off = new Set(o.off || []);
  const sel = [...new Set(ids)].map(id => doc.get(id)).filter(constrainable);
  const counts = {};
  if (!sel.length) return { cons: [], counts };
  const selIds = new Set(sel.map(e => e.id));
  // Variables: las entidades designadas y las unidas a ellas por restricciones existentes
  const ents = new Map(sel.map(e => [e.id, e]));
  const existing = (doc.constraints || []).filter(c => refIds(c).some(id => selIds.has(id)) && consValid(doc, c));
  for (const c of existing) for (const id of refIds(c)) ents.set(id, doc.get(id));
  const off2 = new Map(), x = [], kinds = [];
  for (const [id, e] of ents) { off2.set(id, x.length); VARS[e.type](e).forEach((v, k) => { x.push(v); kinds.push(e.type === 'arc' && k >= 3 ? 'a' : 'd'); }); }
  const n = x.length;
  if (n > AUTO_MAX_VARS) return { cons: [], counts, tooMany: true };
  let bb = null;
  for (const e of ents.values()) for (const p of e.type === 'circle' || e.type === 'arc' ? [e.c] : e.type === 'line' ? [e.p1, e.p2] : e.type === 'point' ? [e.p] : e.pts) bb = bb ? { x1: Math.min(bb.x1, p.x), y1: Math.min(bb.y1, p.y), x2: Math.max(bb.x2, p.x), y2: Math.max(bb.y2, p.y) } : { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  const S = Math.max(1, bb.x2 - bb.x1, bb.y2 - bb.y1);
  const { vals } = evalParams(doc);
  const R = readers(ents, x, off2);
  R.raw = (id, k) => x[off2.get(id) + k];
  const F = c => residuals(c, R, ents, S, vals);
  // Filas del jacobiano (diferencias centradas sobre las variables de las entidades de la restricción)
  const jac = c => {
    const m = F(c).length, rows = Array.from({ length: m }, () => new Float64Array(n));
    for (const id of refIds(c)) {
      const o0 = off2.get(id), len = VARS[ents.get(id).type](ents.get(id)).length;
      for (let j = o0; j < o0 + len; j++) {
        const h = kinds[j] === 'a' ? 1e-7 : 1e-6 * S, v = x[j];
        x[j] = v + h; const a = F(c);
        x[j] = v - h; const b = F(c);
        x[j] = v;
        for (let k = 0; k < m; k++) rows[k][j] = (a[k] - b[k]) / (2 * h);
      }
    }
    return rows;
  };
  // Base ortonormal de las filas aceptadas (Gram-Schmidt con reortogonalización)
  const basis = [];
  const dot = (a, b) => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };
  const take = rows => {
    const keep = basis.length;
    for (const v of rows) {
      const n0 = Math.sqrt(dot(v, v));
      if (n0 < 1e-12) { basis.length = keep; return false; }
      for (let pass = 0; pass < 2; pass++) for (const b of basis) { const k = dot(v, b); if (k) for (let i = 0; i < n; i++) v[i] -= k * b[i]; }
      const nn = Math.sqrt(dot(v, v));
      if (nn < 1e-6 * n0) { basis.length = keep; return false; }
      for (let i = 0; i < n; i++) v[i] /= nn;
      basis.push(v);
    }
    return true;
  };
  for (const c of existing) take(jac(c));

  // ---- Geometría de las entidades designadas ----
  const pts = [], lines = [], circs = [];
  for (const e of sel) {
    if (e.type === 'line') { pts.push({ ref: { id: e.id, k: 'p1' }, p: e.p1, id: e.id }, { ref: { id: e.id, k: 'p2' }, p: e.p2, id: e.id }); lines.push({ ref: { id: e.id }, a: e.p1, b: e.p2, id: e.id }); }
    else if (e.type === 'arc') { pts.push({ ref: { id: e.id, k: 's' }, p: G.polar(e.c, e.a1, e.r), id: e.id }, { ref: { id: e.id, k: 'e' }, p: G.polar(e.c, e.a2, e.r), id: e.id }); circs.push({ ref: { id: e.id }, e }); }
    else if (e.type === 'circle') circs.push({ ref: { id: e.id }, e });
    else if (e.type === 'point') pts.push({ ref: { id: e.id, k: 'p' }, p: e.p, id: e.id });
    else if (e.type === 'pline') {
      const np = e.pts.length, closed = !!e.closed && np > 2;
      e.pts.forEach((p, i) => pts.push({ ref: { id: e.id, k: 'v', i }, p, id: e.id, i, np, closed }));
      for (let j = 0; j < (closed ? np : np - 1); j++) if (!e.bulges?.[j]) lines.push({ ref: { id: e.id, seg: j }, a: e.pts[j], b: e.pts[(j + 1) % np], id: e.id });
    }
  }
  for (const l of lines) { l.len = G.dist(l.a, l.b); l.th = G.normAng(G.ang(l.a, l.b)) % Math.PI; }
  const valid = lines.filter(l => l.len > tol);
  const cands = [];
  const add = (type, c) => { if (!off.has(type)) cands.push({ type, ...c }); };
  const angDiff = (a, b) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };
  const onArc = (k, p) => k.e.type === 'circle' || G.angIn(G.ang(k.e.c, p), k.e.a1 - 1e-6, k.e.a2 + 1e-6);
  // Grupos por una relación de equivalencia (unión de pares cercanos): cada miembro se relaciona con el primero
  const clusters = (list, near) => {
    const par = list.map((_, i) => i), f = i => (par[i] === i ? i : (par[i] = f(par[i])));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (near(list[i], list[j])) par[f(j)] = f(i);
    const out = new Map();
    list.forEach((it, i) => { const r = f(i); if (!out.has(r)) out.set(r, []); out.get(r).push(it); });
    return [...out.values()];
  };

  // 1. Coincidentes: punto con punto (de objetos distintos, o los extremos de una polilínea abierta) y punto sobre objeto
  const pairs = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j];
    if (a.id === b.id && !(a.np && !a.closed && a.np > 2 && ((a.i === 0 && b.i === a.np - 1) || (b.i === 0 && a.i === a.np - 1)))) continue;
    const d = G.dist(a.p, b.p);
    if (d <= tol) pairs.push([d, a, b]);
  }
  pairs.sort((u, v) => u[0] - v[0]).forEach(([, a, b]) => add('coincident', { refs: [a.ref, b.ref] }));
  for (const q of pts) {
    for (const l of valid) {
      if (l.id === q.id) continue;
      const r = G.nearSeg(q.p, l.a, l.b);
      if (G.dist(r.p, q.p) <= tol && G.dist(q.p, l.a) > tol && G.dist(q.p, l.b) > tol) add('coincident', { refs: [q.ref, l.ref] });
    }
    for (const k of circs) {
      if (k.e.id === q.id) continue;
      if (Math.abs(G.dist(q.p, k.e.c) - k.e.r) <= tol && onArc(k, q.p) && !pts.some(o => o.id === k.e.id && G.dist(o.p, q.p) <= tol)) add('coincident', { refs: [q.ref, k.ref] });
    }
  }
  // 2-4. Colineales, paralelas y perpendiculares: grupos de direcciones
  const dirs = clusters(valid, (a, b) => angDiff(a.th, b.th) <= at);
  for (const g of dirs) {
    const u = P(Math.cos(g[0].th), Math.sin(g[0].th)), nn = G.perp(u);
    const offs = clusters(g, (a, b) => Math.abs(G.dot(G.sub(b.a, a.a), nn)) <= tol && Math.abs(G.dot(G.sub(b.b, a.a), nn)) <= tol);
    for (const c of offs) for (const l of c.slice(1)) add('collinear', { refs: [c[0].ref, l.ref] });
    g.reps = offs.map(c => c[0]);
  }
  for (const g of dirs) for (const l of g.reps.slice(1)) add('parallel', { refs: [g.reps[0].ref, l.ref] });
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
    if (Math.abs(angDiff(dirs[i][0].th, dirs[j][0].th) - Math.PI / 2) <= at) add('perpendicular', { refs: [dirs[i][0].ref, dirs[j][0].ref] });
  }
  // 5. Tangentes: línea con arco o círculo, y arcos o círculos entre sí, si el punto de contacto está sobre ambos
  for (const l of valid) for (const k of circs) {
    if (l.id === k.e.id) continue;
    const f = G.nearSeg(k.e.c, l.a, l.b), dl = Math.abs(distLine(k.e.c, [l.a, l.b]));
    if (Math.abs(dl - k.e.r) <= tol && G.dist(f.p, k.e.c) - dl <= tol && onArc(k, f.p)) add('tangent', { refs: [l.ref, k.ref] });
  }
  for (let i = 0; i < circs.length; i++) for (let j = i + 1; j < circs.length; j++) {
    const a = circs[i].e, b = circs[j].e, d = G.dist(a.c, b.c);
    if (d <= tol) continue;
    const outer = Math.abs(d - (a.r + b.r)) <= tol, inner = !outer && Math.abs(d - Math.abs(a.r - b.r)) <= tol;
    if (!outer && !inner) continue;
    const u = G.norm(G.sub(b.c, a.c)), p = G.add(a.c, G.mul(u, inner && a.r < b.r ? -a.r : a.r));
    if (onArc(circs[i], p) && onArc(circs[j], p)) add('tangent', { refs: [circs[i].ref, circs[j].ref], inner });
  }
  // 6. Concéntricas
  for (const g of clusters(circs, (a, b) => G.dist(a.e.c, b.e.c) <= tol)) for (const k of g.slice(1)) add('concentric', { refs: [g[0].ref, k.ref] });
  // 7-8. Horizontales y verticales
  for (const l of valid) { if (Math.abs(Math.sin(l.th)) <= Math.sin(at)) add('horizontal', { refs: [l.ref] }); }
  for (const l of valid) { if (Math.abs(Math.cos(l.th)) <= Math.sin(at)) add('vertical', { refs: [l.ref] }); }
  // 9. Iguales: longitudes de líneas y radios
  for (const g of clusters([...valid].sort((a, b) => a.len - b.len), (a, b) => Math.abs(a.len - b.len) <= tol)) for (const l of g.slice(1)) add('equal', { refs: [g[0].ref, l.ref] });
  for (const g of clusters(circs, (a, b) => Math.abs(a.e.r - b.e.r) <= tol)) for (const k of g.slice(1)) add('equal', { refs: [g[0].ref, k.ref] });

  // Ajuste de cambio mínimo de las variables locales para cumplir `list` (como solve, con el jacobiano disperso).
  // Así el rango de las restricciones siguientes se mide sobre la geometría ya ajustada: fuera de ella, restricciones
  // que se deducen de otras (vertical de dos líneas paralelas, por ejemplo) parecerían independientes.
  const norm = v => Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  const relax = list => {
    const saved = [...x], tolR = 1e-10 * S;
    let r = list.flatMap(F);
    for (let it = 0; it < 40 && norm(r) > tolR; it++) {
      const rows = list.flatMap(jac), m = rows.length, nz = rows.map(v => { const ix = []; for (let j = 0; j < n; j++) if (v[j]) ix.push(j); return ix; });
      const byVar = new Map();
      nz.forEach((ix, k) => { for (const j of ix) (byVar.get(j) || byVar.set(j, []).get(j)).push(k); });
      const A = Array.from({ length: m }, () => new Float64Array(m));
      for (const [j, ks] of byVar) for (const a of ks) for (const b of ks) A[a][b] += rows[a][j] * rows[b][j];
      const tr = A.reduce((t, row, k) => t + row[k], 0) / m || 1;
      for (let k = 0; k < m; k++) A[k][k] += 1e-10 * tr;
      const y = solveLin(A.map(row => [...row]), r.map(v => -v));
      if (!y) break;
      const dx = new Float64Array(n);
      nz.forEach((ix, k) => { for (const j of ix) dx[j] += rows[k][j] * y[k]; });
      const x0 = [...x], n0 = norm(r);
      let t = 1, rn;
      for (let k = 0; k < 12; k++) { for (let j = 0; j < n; j++) x[j] = x0[j] + t * dx[j]; rn = list.flatMap(F); if (norm(rn) < n0) break; t /= 2; }
      if (norm(rn) >= n0) { for (let j = 0; j < n; j++) x[j] = x0[j]; break; }
      r = rn;
    }
    if (norm(r) <= Math.max(1e-7, 1e-9 * S)) return true;
    for (let j = 0; j < n; j++) x[j] = saved[j];
    return false;
  };
  // Por tipos, en orden de prioridad. Si la geometría aún no cumple exactamente una restricción aceptada, se ajusta
  // (con todas las aceptadas) y se rehace la base antes de seguir; si no se puede cumplir con las anteriores, se descarta.
  const cons = [];
  const rebuild = () => { basis.length = 0; for (const c of [...existing, ...cons]) take(jac(c)); };
  for (const type of Object.keys(AUTO_TYPES)) for (const c of cands) {
    if (c.type !== type || !take(jac(c))) continue;
    cons.push(c);
    if (norm(F(c)) > 1e-9 * S) { if (!relax([...existing, ...cons])) cons.pop(); rebuild(); }
  }
  for (const c of cons) counts[c.type] = (counts[c.type] || 0) + 1;
  return { cons, counts };
}
