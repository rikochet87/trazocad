// Operaciones de edición geométrica: recortar, alargar, partir, longitud, desfase, empalme, chaflán, descomponer, unir, estirar.
import * as G from './geom.js';
import { primsOf, bboxOf, dimParts, plPieces, pieceAt, pieceParam, pieceLen, plLength, cloneEnt, inWindow, xformEnt, blockEnts, mtextGeom, mleaderGeom, tableGeom, ellPts } from './entities.js';
import { hatchSegments } from './patterns.js';
import { splinePts, rebuild as rebuildSpline, deBoor, domain, nearestParam, tangentAt, subSpline, joinSplines, reverseSpline, lineSpline, interpolate } from './spline.js';
const { TAU } = G;

const props = e => ({ layer: e.layer, color: e.color, ltype: e.ltype, lw: e.lw });
const fresh = e => { const c = cloneEnt(e); delete c.id; return c; };

export function nearestOn(e, p) {
  let best = null, bd = Infinity;
  for (const q of primsOf(e)) { const r = G.nearPrim(p, q), d = G.dist(r, p); if (d < bd) { bd = d; best = r; } }
  return best;
}

// Crea una polilínea (o línea/arco si sólo tiene un tramo) a partir de vértices y curvaturas
function mkPoly(base, pts, bul, closed = false) {
  const b = bul.map(x => (Math.abs(x) < 1e-12 ? 0 : x));
  if (!closed && pts.length === 2) {
    if (!b[0]) return { ...base, type: 'line', p1: pts[0], p2: pts[1] };
    return { ...base, type: 'arc', ...G.bulgeArc(pts[0], pts[1], b[0]) };
  }
  const e = { ...base, type: 'pline', pts, closed };
  if (b.some(x => x)) e.bulges = b;
  return e;
}

// ---------- Parametrización de curvas ----------
export function curveInfo(e) {
  switch (e.type) {
    case 'line': return {
      closed: false, max: 1,
      param: p => { const d = G.sub(e.p2, e.p1), l2 = G.dot(d, d); return l2 ? G.dot(G.sub(p, e.p1), d) / l2 : 0; },
    };
    case 'arc': { const sw = G.sweep(e.a1, e.a2); return { closed: false, max: 1, param: p => G.normAng(G.ang(e.c, p) - e.a1) / sw }; }
    case 'circle': return { closed: true, max: TAU, param: p => G.normAng(G.ang(e.c, p)) };
    case 'pline': {
      const pcs = plPieces(e);
      return {
        closed: !!e.closed && e.pts.length > 2, max: pcs.length,
        param: p => {
          let best = 0, bd = Infinity;
          pcs.forEach((pc, i) => { const t = pieceParam(pc, p), d = G.dist(pieceAt(pc, t), p); if (d < bd - 1e-12) { bd = d; best = i + t; } });
          return best;
        },
      };
    }
    case 'spline': { const [u0, u1] = domain(e); return { closed: !!e.closed, max: u1 - u0, param: p => nearestParam(e, p) - u0 }; }
  }
  return null;
}

// Punto de intersección refinado sobre la curva exacta de una spline (la intersección se busca en su teselado).
// q: primitiva de la otra entidad (recta infinita si ext, o círculo)
function onSpline(s, pt, q) {
  const [u0, u1] = domain(s), h = (u1 - u0) * 1e-7;
  const f = u => { const c = deBoor(s, u); return q.k === 's' ? G.cross(G.sub(q.b, q.a), G.sub(c, q.a)) / (G.dist(q.a, q.b) || 1) : G.dist(c, q.c) - q.r; };
  let u = nearestParam(s, pt);
  for (let k = 0; k < 16; k++) {
    const fu = f(u);
    if (Math.abs(fu) < 1e-13) break;
    const d = (f(Math.min(u1, u + h)) - f(Math.max(u0, u - h))) / (Math.min(u1, u + h) - Math.max(u0, u - h));
    if (!d) break;
    const nu = Math.max(u0, Math.min(u1, u - fu / d));
    if (Math.abs(nu - u) < 1e-15) break;
    u = nu;
  }
  const p = deBoor(s, u), b = bboxOf(s);
  return G.dist(p, pt) < Math.max(b.x2 - b.x1, b.y2 - b.y1) * 0.01 ? p : pt;
}
// Intersecciones entre dos entidades (exactas cuando una es spline y la otra no)
export function entInts(e, o) {
  const out = [];
  if (!G.bbOverlap(bboxOf(e), bboxOf(o))) return out;
  const po = primsOf(o), pe = primsOf(e);
  for (const q of po) for (const p1 of pe) for (const pt of G.primInt(p1, q)) {
    out.push(e.type === 'spline' && o.type !== 'spline' ? onSpline(e, pt, q) : o.type === 'spline' && e.type !== 'spline' ? onSpline(o, pt, p1) : pt);
  }
  return out;
}

export function subCurve(e, a, b) {
  switch (e.type) {
    case 'line': return { ...props(e), type: 'line', p1: G.lerp(e.p1, e.p2, a), p2: G.lerp(e.p1, e.p2, b) };
    case 'arc': { const sw = G.sweep(e.a1, e.a2); return { ...props(e), type: 'arc', c: e.c, r: e.r, a1: G.normAng(e.a1 + a * sw), a2: G.normAng(e.a1 + b * sw) }; }
    case 'circle': return { ...props(e), type: 'arc', c: e.c, r: e.r, a1: G.normAng(a), a2: G.normAng(b) };
    case 'pline': {
      const pcs = plPieces(e), n = pcs.length, np = e.pts.length, closed = !!e.closed && np > 2;
      const norm = t => (closed ? ((t % n) + n) % n : Math.min(Math.max(t, 0), n));
      const at = t => { const tt = norm(t), i = Math.min(Math.floor(tt), n - 1); return pieceAt(pcs[i], tt - i); };
      const pts = [at(a)], bul = [];
      let t = a, guard = 0;
      while (t < b - 1e-9 && guard++ < 100000) {
        const i = Math.floor(t + 1e-12), nx = Math.min(i + 1, b), pi = ((i % n) + n) % n;
        bul.push(pcs[pi].bulge ? Math.tan(Math.atan(pcs[pi].bulge) * (nx - t)) : 0);
        pts.push(nx === b ? at(b) : e.pts[(i + 1) % np]);
        t = nx;
      }
      bul.push(0);
      const P2 = [], B2 = [];
      pts.forEach((p, i) => { if (!i || !G.eqPt(p, P2[P2.length - 1], 1e-9)) { P2.push(p); B2.push(bul[i]); } else B2[B2.length - 1] = bul[i]; });
      if (P2.length < 2) return null;
      return mkPoly(props(e), P2, B2);
    }
    case 'spline': {
      // a, b relativos al inicio del dominio; en las cerradas b puede pasar del final (tramo que cruza la costura)
      const [u0, u1] = domain(e), U = u1 - u0;
      const piece = (x, y) => (y - x > U * 1e-9 ? subSpline(e, u0 + x, u0 + y) : null);
      let s;
      if (b > U + 1e-9) { const A = piece(a, U), B = piece(0, b - U); s = A && B ? joinSplines(A, B) : A || B; }
      else s = piece(a, Math.min(b, U));
      return s ? { ...props(e), type: 'spline', ...s, closed: false } : null;
    }
  }
  return null;
}

function cutParams(e, info, others) {
  const ts = [];
  for (const o of others) {
    if (o.id === e.id) continue;
    for (const pt of entInts(e, o)) ts.push(info.param(pt));
  }
  ts.sort((a, b) => a - b);
  return ts.filter((t, i) => !i || t - ts[i - 1] > 1e-9);
}

// Devuelve {add:[...]} (la entidad original se elimina) o null si no hay cambio
export function trimEntity(e, pick, others) {
  const info = curveInfo(e);
  if (!info) return null;
  const tp = info.param(nearestOn(e, pick));
  let ts = cutParams(e, info, others);
  if (info.closed) ts = ts.map(t => ((t % info.max) + info.max) % info.max).sort((a, b) => a - b);
  else ts = ts.filter(t => t > 1e-9 && t < info.max - 1e-9);
  if (!ts.length) return { add: [] };
  if (!info.closed) {
    let lo = null, hi = null;
    for (const t of ts) { if (t < tp) lo = t; else if (hi === null) hi = t; }
    const add = [];
    if (lo !== null) add.push(subCurve(e, 0, lo));
    if (hi !== null) add.push(subCurve(e, hi, info.max));
    return { add: add.filter(Boolean) };
  }
  if (ts.length < 2) return null;
  let hi = ts.find(t => t > tp), lo = [...ts].reverse().find(t => t < tp);
  if (hi === undefined) hi = ts[0] + info.max;
  if (lo === undefined) lo = ts[ts.length - 1] - info.max;
  return { add: [subCurve(e, hi, lo + info.max)].filter(Boolean) };
}

// PARTE: elimina el tramo entre p1 y p2 (en círculos, en sentido antihorario de p1 a p2)
export function breakEntity(e, p1, p2) {
  const info = curveInfo(e);
  if (!info) return null;
  let t1 = info.param(nearestOn(e, p1)), t2 = info.param(nearestOn(e, p2));
  const same = Math.abs(t1 - t2) < 1e-9;
  if (!info.closed) {
    if (t1 > t2) [t1, t2] = [t2, t1];
    const add = [];
    if (same) { if (t1 > 1e-9 && t1 < info.max - 1e-9) add.push(subCurve(e, 0, t1), subCurve(e, t1, info.max)); else return null; }
    else {
      if (t1 > 1e-9) add.push(subCurve(e, 0, t1));
      if (t2 < info.max - 1e-9) add.push(subCurve(e, t2, info.max));
    }
    return { add: add.filter(Boolean) };
  }
  if (same) return { add: [subCurve(e, t1, t1 + info.max)].filter(Boolean) };
  return { add: [subCurve(e, t2, t1 < t2 ? t1 + info.max : t1)].filter(Boolean) };
}

// Devuelve la entidad modificada (clon) o null
export function extendEntity(e, pick, others) {
  const bounds = [], owner = [];
  for (const o of others) if (o.id !== e.id) for (const q of primsOf(o)) { bounds.push(q); owner.push(o); }
  // Intersecciones de la prolongación (recta o circunferencia `ray`) con los contornos, refinadas sobre splines
  const hits = ray => {
    const out = [];
    bounds.forEach((q, k) => { for (const pt of G.primInt(ray, q, true, false)) out.push(owner[k].type === 'spline' ? onSpline(owner[k], pt, ray) : pt); });
    return out;
  };
  if (e.type === 'spline') {
    if (e.closed) return null;
    const [u0, u1] = domain(e), s0 = deBoor(e, u0), s1 = deBoor(e, u1), atStart = G.dist(pick, s0) < G.dist(pick, s1);
    const end = atStart ? s0 : s1, tan = atStart ? G.mul(tangentAt(e, u0), -1) : tangentAt(e, u1);
    let best = Infinity, bp = null;
    for (const pt of hits({ k: 's', a: G.sub(end, tan), b: end })) {
      const t = G.dot(G.sub(pt, end), tan);
      if (t > 1e-9 && t < best) { best = t; bp = pt; }
    }
    if (!bp) return null;
    const c = cloneEnt(e);
    if (e.fit) { c.fit = atStart ? [bp, ...e.fit] : [...e.fit, bp]; return rebuildSpline(c) ? c : null; }
    // Vértices de control o geometría importada: se añade un tramo recto tangente (la curva existente no cambia)
    let s = subSpline(e, u0, u1);
    if (atStart) s = reverseSpline(s);
    s = joinSplines(s, lineSpline(end, bp, s.deg));
    if (atStart) s = reverseSpline(s);
    delete c.cv; delete c.w;
    return Object.assign(c, s);
  }
  const lastLine = e.type === 'pline' && !e.closed && e.pts.length > 1;
  if (e.type === 'line' || lastLine) {
    let a, b, atStart;
    if (e.type === 'line') { atStart = G.dist(pick, e.p1) < G.dist(pick, e.p2); [a, b] = atStart ? [e.p2, e.p1] : [e.p1, e.p2]; }
    else {
      const n = e.pts.length;
      atStart = G.dist(pick, e.pts[0]) < G.dist(pick, e.pts[n - 1]);
      if (e.bulges?.[atStart ? 0 : n - 2]) return null;
      [a, b] = atStart ? [e.pts[1], e.pts[0]] : [e.pts[n - 2], e.pts[n - 1]];
    }
    const d = G.sub(b, a), l2 = G.dot(d, d);
    if (l2 < 1e-18) return null;
    let best = Infinity, bp = null;
    for (const pt of hits({ k: 's', a, b })) {
      const t = G.dot(G.sub(pt, a), d) / l2;
      if (t > 1 + 1e-9 && t < best) { best = t; bp = pt; }
    }
    if (!bp) return null;
    const c = cloneEnt(e);
    if (e.type === 'line') c[atStart ? 'p1' : 'p2'] = bp; else c.pts[atStart ? 0 : c.pts.length - 1] = bp;
    return c;
  }
  if (e.type === 'arc') {
    const s1 = G.polar(e.c, e.a1, e.r), s2 = G.polar(e.c, e.a2, e.r), atStart = G.dist(pick, s1) < G.dist(pick, s2);
    const gap = G.normAng(e.a1 - e.a2);
    let best = Infinity, ba = null;
    for (const pt of hits({ k: 'a', c: e.c, r: e.r, a1: 0, a2: TAU })) {
      const a = G.ang(e.c, pt), d = atStart ? G.normAng(e.a1 - a) : G.normAng(a - e.a2);
      if (d > 1e-9 && d < gap - 1e-9 && d < best) { best = d; ba = a; }
    }
    if (ba === null) return null;
    const c = cloneEnt(e);
    if (atStart) c.a1 = ba; else c.a2 = ba;
    return c;
  }
  return null;
}

// ---------- LONGITUD ----------
export function lengthOf(e) {
  switch (e.type) {
    case 'line': return G.dist(e.p1, e.p2);
    case 'arc': return e.r * G.sweep(e.a1, e.a2);
    case 'circle': return TAU * e.r;
    case 'pline': return plLength(e);
    case 'spline': return G.polyLen(splinePts(e), e.closed);
  }
  return null;
}
// ---------- Recorrido por longitud (GRADUA, DIVIDE) ----------
// Curva parametrizada por la longitud recorrida desde su inicio: {len, closed, start, end, at(s) → {p, a}} (a: ángulo de la
// tangente en el sentido de avance). Las elipses y splines se recorren sobre su teselado. null si el objeto no es una curva.
function polyPath(pts, closed) {
  const P2 = closed ? [...pts, pts[0]] : pts, cum = [0];
  for (let i = 1; i < P2.length; i++) cum.push(cum[i - 1] + G.dist(P2[i - 1], P2[i]));
  const len = cum[cum.length - 1];
  return {
    len, closed, start: P2[0], end: P2[P2.length - 1],
    at: s => {
      s = Math.max(0, Math.min(len, s));
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      const L = cum[hi] - cum[lo], t = L > 0 ? (s - cum[lo]) / L : 0;
      return { p: G.lerp(P2[lo], P2[hi], t), a: G.ang(P2[lo], P2[hi]) };
    },
  };
}
export function pathOf(e) {
  switch (e.type) {
    case 'line': { const len = G.dist(e.p1, e.p2), a = G.ang(e.p1, e.p2); return { len, closed: false, start: e.p1, end: e.p2, at: s => ({ p: G.lerp(e.p1, e.p2, len ? s / len : 0), a }) }; }
    case 'arc': case 'circle': {
      const a1 = e.type === 'arc' ? e.a1 : 0, sw = e.type === 'arc' ? G.sweep(e.a1, e.a2) : TAU;
      return { len: e.r * sw, closed: e.type === 'circle', start: G.polar(e.c, a1, e.r), end: G.polar(e.c, a1 + sw, e.r), at: s => { const t = a1 + s / e.r; return { p: G.polar(e.c, t, e.r), a: t + Math.PI / 2 }; } };
    }
    case 'pline': {
      const pcs = plPieces(e), cum = [0];
      if (!pcs.length) return null;
      for (const pc of pcs) cum.push(cum[cum.length - 1] + pieceLen(pc));
      const len = cum[cum.length - 1], closed = !!e.closed && e.pts.length > 2;
      return {
        len, closed, start: pcs[0].a, end: pcs[pcs.length - 1].b,
        at: s => {
          s = Math.max(0, Math.min(len, s));
          let i = 0;
          while (i < pcs.length - 1 && cum[i + 1] <= s) i++;
          const pc = pcs[i], L = cum[i + 1] - cum[i], p = pieceAt(pc, L > 0 ? (s - cum[i]) / L : 0);
          return { p, a: pc.bulge ? G.ang(pc.prim.c, p) + (pc.bulge > 0 ? Math.PI / 2 : -Math.PI / 2) : G.ang(pc.a, pc.b) };
        },
      };
    }
    case 'spline': { const pts = splinePts(e); return polyPath(e.closed ? pts.slice(0, G.eqPt(pts[0], pts[pts.length - 1], 1e-9) ? -1 : undefined) : pts, !!e.closed); }
    case 'ellipse': return polyPath(ellPts(e, 720), true);
  }
  return null;
}
// Recorrido en sentido contrario (GRADUA empieza por el extremo más próximo al punto designado)
export function reversePath(pt) { return { ...pt, start: pt.end, end: pt.start, at: s => { const r = pt.at(pt.len - s); return { p: r.p, a: r.a + Math.PI }; } }; }

// mode: 'delta' | 'percent' | 'total'
export function lengthenEntity(e, pick, mode, val) {
  const L = lengthOf(e);
  const newL = mode === 'delta' ? L + val : mode === 'percent' ? L * val / 100 : val;
  if (!(newL > 1e-9)) return null;
  const c = cloneEnt(e);
  if (e.type === 'line') {
    const u = G.norm(G.sub(e.p2, e.p1));
    if (G.dist(pick, e.p2) <= G.dist(pick, e.p1)) c.p2 = G.add(e.p1, G.mul(u, newL)); else c.p1 = G.sub(e.p2, G.mul(u, newL));
    return c;
  }
  if (e.type === 'arc') {
    const sw = newL / e.r;
    if (sw >= TAU - 1e-9) return null;
    const s2 = G.polar(e.c, e.a2, e.r), s1 = G.polar(e.c, e.a1, e.r);
    if (G.dist(pick, s2) <= G.dist(pick, s1)) c.a2 = G.normAng(e.a1 + sw); else c.a1 = G.normAng(e.a2 - sw);
    return c;
  }
  return null;
}

// ---------- DESFASE ----------
function offsetPiece(pc, d, sg) {
  if (!pc.bulge) { const o = G.mul(G.perp(G.norm(G.sub(pc.b, pc.a))), d * sg); return { a: G.add(pc.a, o), b: G.add(pc.b, o), line: true }; }
  const { c, r } = pc.prim, nr = r + (pc.bulge > 0 ? -1 : 1) * sg * d;
  if (nr <= 1e-9) return null;
  return { a: G.add(c, G.mul(G.norm(G.sub(pc.a, c)), nr)), b: G.add(c, G.mul(G.norm(G.sub(pc.b, c)), nr)), c, r: nr, sign: Math.sign(pc.bulge) };
}
const primOfOff = o => (o.line ? { k: 's', a: o.a, b: o.b } : { k: 'a', c: o.c, r: o.r, a1: 0, a2: TAU });
function joinOff(o1, o2, vertex) {
  if (G.eqPt(o1.b, o2.a, 1e-9)) return o1.b;
  if (o1.line && o2.line) { const x = G.llInt(o1.a, o1.b, o2.a, o2.b); return x ? x.p : o2.a; }
  const cands = G.primInt(primOfOff(o1), primOfOff(o2), true, true);
  if (!cands.length) return null;
  return cands.reduce((b, p) => (G.dist(p, vertex) < G.dist(b, vertex) ? p : b));
}

export function offsetEntity(e, d, side) {
  const c = fresh(e);
  switch (e.type) {
    case 'line': {
      const v = G.sub(e.p2, e.p1), s = G.cross(v, G.sub(side, e.p1)) > 0 ? 1 : -1, o = G.mul(G.perp(G.norm(v)), d * s);
      c.p1 = G.add(e.p1, o); c.p2 = G.add(e.p2, o); return c;
    }
    case 'circle': case 'arc': {
      const r = e.r + (G.dist(side, e.c) > e.r ? d : -d);
      if (r <= 1e-9) return null;
      c.r = r; return c;
    }
    case 'pline': {
      const pcs = plPieces(e);
      if (!pcs.length) return null;
      let si = 0, bd = Infinity;
      pcs.forEach((pc, i) => { const dd = G.dist(side, G.nearPrim(side, pc.prim)); if (dd < bd) { bd = dd; si = i; } });
      const ps = pcs[si];
      const sg = !ps.bulge ? (G.cross(G.sub(ps.b, ps.a), G.sub(side, ps.a)) > 0 ? 1 : -1)
        : ((G.dist(side, ps.prim.c) < ps.prim.r) === (ps.bulge > 0) ? 1 : -1);
      const offs = pcs.map(pc => offsetPiece(pc, d, sg));
      if (offs.some(o => !o)) return null;
      const n = offs.length, closed = !!e.closed && e.pts.length > 2;
      const pts = [], bul = [];
      const starts = offs.map((o, i) => {
        if (i === 0 && !closed) return o.a;
        const prev = offs[(i - 1 + n) % n];
        return joinOff(prev, o, e.pts[i]) || o.a;
      });
      for (let i = 0; i < n; i++) {
        const o = offs[i], s = starts[i], t = i + 1 < n ? starts[i + 1] : closed ? starts[0] : o.b;
        pts.push(s);
        if (o.line) bul.push(0);
        else { const sw = o.sign > 0 ? G.sweep(G.ang(o.c, s), G.ang(o.c, t)) : G.sweep(G.ang(o.c, t), G.ang(o.c, s)); bul.push(o.sign * Math.tan(sw / 4)); }
      }
      if (!closed) { pts.push(offs[n - 1].b); bul.push(0); }
      c.pts = pts;
      if (bul.some(x => x)) c.bulges = bul; else delete c.bulges;
      return c;
    }
    case 'spline': {
      // Puntos desplazados según la normal y spline interpolada por ellos
      const [u0, u1] = domain(e), u = nearestParam(e, side), q = deBoor(e, u);
      const s = G.cross(tangentAt(e, u), G.sub(side, q)) > 0 ? 1 : -1;
      const N = Math.max(32, Math.min(400, e.ctrl.length * 8)), pts = [];
      for (let i = 0; i <= N; i++) {
        if (e.closed && i === N) break;
        const uu = u0 + (u1 - u0) * i / N;
        pts.push(G.add(deBoor(e, uu), G.mul(G.perp(tangentAt(e, uu)), d * s)));
      }
      const r = interpolate(pts, !!e.closed);
      return r ? { ...props(e), type: 'spline', ...r, closed: !!e.closed } : null;
    }
  }
  return null;
}

// ---------- EMPALME / CHAFLÁN ----------
function cornerSides(l1, pk1, l2, pk2) {
  const X = G.llInt(l1.p1, l1.p2, l2.p1, l2.p2);
  if (!X) return null;
  const x = X.p;
  const side = (l, pk) => {
    const d = G.sub(l.p2, l.p1), q = G.dot(d, d);
    const tp = G.dot(G.sub(pk, l.p1), d) / q, tx = G.dot(G.sub(x, l.p1), d) / q;
    return tp > tx ? { u: G.norm(d), far: l.p2 } : { u: G.norm(G.mul(d, -1)), far: l.p1 };
  };
  return { x, a: side(l1, pk1), b: side(l2, pk2) };
}

export function filletLines(l1, pk1, l2, pk2, R) {
  const k = cornerSides(l1, pk1, l2, pk2);
  if (!k) return { error: 'Las líneas son paralelas.' };
  const { x, a, b } = k;
  const r1 = { ...fresh(l1), p1: a.far }, r2 = { ...fresh(l2), p1: b.far };
  if (R <= 1e-12) { r1.p2 = x; r2.p2 = x; return { l1: r1, l2: r2, arc: null }; }
  const th = Math.acos(Math.max(-1, Math.min(1, G.dot(a.u, b.u))));
  if (th < 1e-9 || Math.PI - th < 1e-9) return { error: 'No se puede empalmar líneas colineales.' };
  const half = th / 2, dt = R / Math.tan(half);
  if (dt > G.dist(x, a.far) + 1e-9 || dt > G.dist(x, b.far) + 1e-9) return { error: 'El radio es demasiado grande.' };
  const t1 = G.add(x, G.mul(a.u, dt)), t2 = G.add(x, G.mul(b.u, dt));
  const c = G.add(x, G.mul(G.norm(G.add(a.u, b.u)), R / Math.sin(half)));
  let a1 = G.ang(c, t1), a2 = G.ang(c, t2);
  if (G.sweep(a1, a2) > Math.PI) [a1, a2] = [a2, a1];
  r1.p2 = t1; r2.p2 = t2;
  return { l1: r1, l2: r2, arc: { ...props(l1), type: 'arc', c, r: R, a1, a2 } };
}

export function chamferLines(l1, pk1, l2, pk2, d1, d2) {
  const k = cornerSides(l1, pk1, l2, pk2);
  if (!k) return { error: 'Las líneas son paralelas.' };
  const { x, a, b } = k;
  if (d1 > G.dist(x, a.far) + 1e-9 || d2 > G.dist(x, b.far) + 1e-9) return { error: 'La distancia de chaflán es demasiado grande.' };
  const t1 = G.add(x, G.mul(a.u, d1)), t2 = G.add(x, G.mul(b.u, d2));
  return { l1: { ...fresh(l1), p1: a.far, p2: t1 }, l2: { ...fresh(l2), p1: b.far, p2: t2 }, seg: d1 + d2 > 1e-12 ? { ...props(l1), type: 'line', p1: t1, p2: t2 } : null };
}

// Empalme o chaflán en todos los vértices entre tramos rectos de una polilínea
function cornerPline(e, make) {
  const n = e.pts.length, closed = !!e.closed && n > 2, bul = e.bulges || [];
  const pts = [], bs = [];
  let count = 0;
  for (let i = 0; i < n; i++) {
    const pi = i - 1 < 0 ? n - 1 : i - 1;
    const interior = closed || (i > 0 && i < n - 1);
    const V = e.pts[i], A = e.pts[pi], B = e.pts[(i + 1) % n];
    const r = interior && !bul[pi] && !bul[i] ? make(A, V, B) : null;
    if (r) { pts.push(r.t1, r.t2); bs.push(r.bulge, bul[i] || 0); count++; } else { pts.push(V); bs.push(bul[i] || 0); }
  }
  const out = { ...cloneEnt(e), pts };
  if (bs.some(x => x)) out.bulges = bs; else delete out.bulges;
  return { ent: out, count };
}
export function filletPline(e, R) {
  return cornerPline(e, (A, V, B) => {
    const u1 = G.norm(G.sub(A, V)), u2 = G.norm(G.sub(B, V)), th = Math.acos(Math.max(-1, Math.min(1, G.dot(u1, u2))));
    if (th < 1e-6 || Math.PI - th < 1e-6) return null;
    const dt = R / Math.tan(th / 2);
    if (dt > G.dist(V, A) / 2 + 1e-9 || dt > G.dist(V, B) / 2 + 1e-9) return null;
    const turn = G.cross(G.sub(V, A), G.sub(B, V)) > 0 ? 1 : -1;
    return { t1: G.add(V, G.mul(u1, dt)), t2: G.add(V, G.mul(u2, dt)), bulge: turn * Math.tan((Math.PI - th) / 4) };
  });
}
export function chamferPline(e, d1, d2) {
  return cornerPline(e, (A, V, B) => {
    if (d1 > G.dist(V, A) / 2 + 1e-9 || d2 > G.dist(V, B) / 2 + 1e-9) return null;
    return { t1: G.add(V, G.mul(G.norm(G.sub(A, V)), d1)), t2: G.add(V, G.mul(G.norm(G.sub(B, V)), d2)), bulge: 0 };
  });
}

// ---------- DESCOMPONER ----------
export function explodeEntity(e) {
  const b = props(e);
  if (e.type === 'pline') return plPieces(e).map(pc => (pc.bulge ? { ...b, type: 'arc', c: pc.prim.c, r: pc.prim.r, a1: pc.prim.a1, a2: pc.prim.a2 } : { ...b, type: 'line', p1: pc.a, p2: pc.b }));
  if (e.type === 'dim') {
    const d = dimParts(e);
    return [
      ...d.lines.map(([p1, p2]) => ({ ...b, type: 'line', p1, p2 })),
      ...d.arcs.map(([c, r, a1, a2]) => ({ ...b, type: 'arc', c, r, a1, a2 })),
      ...d.arrows.map(pts => ({ ...b, type: 'hatch', pattern: 'SOLID', scale: 1, angle: 0, loops: [pts] })),
      ...d.dots.map(([c, r]) => ({ ...b, type: 'circle', c, r })),
      { ...b, type: 'text', p: d.text.p, h: d.text.h, rot: d.text.rot, text: d.text.str, align: d.text.align, style: d.text.style },
    ];
  }
  if (e.type === 'insert') return blockEnts(e).map(v => { const c = cloneEnt(v); delete c.id; return c; });
  if (e.type === 'mtext') return mtextGeom(e).lines.filter(l => l.str).map(l => ({ ...b, type: 'text', p: l.p, h: l.h, rot: l.rot, text: l.str, align: l.align, style: e.style }));
  if (e.type === 'spline') return [{ ...b, type: 'pline', pts: [...splinePts(e)], closed: !!e.closed }];
  if (e.type === 'mleader' || e.type === 'table') {
    const g = e.type === 'mleader' ? mleaderGeom(e) : tableGeom(e);
    return [
      ...g.lines.map(([p1, p2]) => ({ ...b, type: 'line', p1, p2 })),
      ...(g.arrows || []).map(pts => ({ ...b, type: 'hatch', pattern: 'SOLID', scale: 1, angle: 0, loops: [pts] })),
      ...[...(g.dots || []), ...(g.circle ? [g.circle] : [])].map(([c, r]) => ({ ...b, type: 'circle', c, r })),
      ...(g.texts || (g.text ? [g.text] : [])).map(t => ({ ...b, ...cloneEnt(t) })),
    ];
  }
  if (e.type === 'hatch') {
    if (e.pattern === 'SOLID' || e.pattern === 'GRADIENT') return e.loops.map(l => ({ ...b, type: 'pline', pts: l, closed: true }));
    const bb = e.loops.flat().reduce((r, p) => ({ x1: Math.min(r.x1, p.x), y1: Math.min(r.y1, p.y), x2: Math.max(r.x2, p.x), y2: Math.max(r.y2, p.y) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
    return hatchSegments(e, bb).map(([p1, p2]) => ({ ...b, type: 'line', p1, p2 }));
  }
  return null;
}

// ---------- UNIR ----------
const revChain = (pts, bul) => {
  const n = pts.length, rb = [];
  for (let i = 0; i < n - 1; i++) rb.push(-bul[n - 2 - i]);
  rb.push(0);
  return [[...pts].reverse(), rb];
};
// Une líneas, arcos y polilíneas abiertas con extremos coincidentes
export function joinEntities(ents, tol = 1e-6) {
  const items = [];
  for (const e of ents) {
    if (e.type === 'line') items.push({ id: e.id, src: e, pts: [e.p1, e.p2], bul: [0, 0] });
    else if (e.type === 'arc') items.push({ id: e.id, src: e, pts: [G.polar(e.c, e.a1, e.r), G.polar(e.c, e.a2, e.r)], bul: [Math.tan(G.sweep(e.a1, e.a2) / 4), 0] });
    else if (e.type === 'pline' && !e.closed) items.push({ id: e.id, src: e, pts: [...e.pts], bul: e.pts.map((_, i) => e.bulges?.[i] || 0) });
  }
  const out = [], used = new Set();
  for (const it of items) {
    if (used.has(it.id)) continue;
    used.add(it.id);
    let pts = [...it.pts], bul = [...it.bul], ids = [it.id], grew = true;
    while (grew) {
      grew = false;
      for (const o of items) {
        if (used.has(o.id)) continue;
        const s = pts[0], t = pts[pts.length - 1];
        let op = o.pts, ob = o.bul, mode = null;
        if (G.eqPt(t, op[0], tol)) mode = 'append';
        else if (G.eqPt(t, op[op.length - 1], tol)) { [op, ob] = revChain(op, ob); mode = 'append'; }
        else if (G.eqPt(s, op[op.length - 1], tol)) mode = 'prepend';
        else if (G.eqPt(s, op[0], tol)) { [op, ob] = revChain(op, ob); mode = 'prepend'; }
        if (!mode) continue;
        if (mode === 'append') { pts = [...pts, ...op.slice(1)]; bul = [...bul.slice(0, -1), ...ob]; }
        else { pts = [...op, ...pts.slice(1)]; bul = [...ob.slice(0, -1), ...bul]; }
        ids.push(o.id); used.add(o.id); grew = true;
      }
    }
    if (ids.length > 1) {
      let closed = false;
      if (pts.length > 2 && G.eqPt(pts[0], pts[pts.length - 1], tol)) { pts.pop(); bul.pop(); closed = true; }
      const ent = { ...props(it.src), type: 'pline', pts, closed };
      if (bul.some(x => Math.abs(x) > 1e-12)) ent.bulges = bul;
      out.push({ ids, ent });
    }
  }
  return out;
}

export function stretchEntity(e, r, d) {
  const c = cloneEnt(e), mv = p => (G.inRect(p, r) ? G.add(p, d) : p);
  if (inWindow(e, r)) return xformEnt(c, G.Mx.T(d.x, d.y));
  switch (e.type) {
    case 'line': c.p1 = mv(e.p1); c.p2 = mv(e.p2); return c;
    case 'pline': c.pts = e.pts.map(mv); return c;
    case 'dim':
      c.p1 = mv(e.p1); c.p2 = mv(e.p2); c.p3 = mv(e.p3);
      if (e.c) c.c = mv(e.c);
      if (e.l1) { c.l1 = e.l1.map(mv); c.l2 = e.l2.map(mv); }
      return c;
    case 'hatch': c.loops = e.loops.map(l => l.map(mv)); if (c.seed) c.seed = mv(c.seed); c._xf = true; return c;
    case 'circle': case 'arc': case 'ellipse': return G.inRect(e.c, r) ? xformEnt(c, G.Mx.T(d.x, d.y)) : null;
    case 'text': case 'mtext': case 'attdef': case 'point': case 'insert': case 'table': return G.inRect(e.p, r) ? xformEnt(c, G.Mx.T(d.x, d.y)) : null;
    case 'mleader': c.pts = e.pts.map(mv); return c;
    case 'spline': {
      const k = e.fit ? 'fit' : e.cv ? 'cv' : 'ctrl';
      c[k] = e[k].map(mv);
      if (k === 'ctrl') return c;
      return rebuildSpline(c) ? c : null;
    }
  }
  return null;
}

