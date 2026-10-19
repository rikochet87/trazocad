// Regiones: áreas cerradas con huecos y operaciones booleanas (unión, diferencia e intersección) con aristas rectas y de arco.
// Región: {type: 'region', loops: [{pts, bulges?}]}. Cada contorno es cerrado y está orientado con el interior a su izquierda:
// los exteriores en sentido antihorario (área positiva) y los huecos en sentido horario.
import * as G from './geom.js';
import { plPieces, plArea, plLength, ellPts } from './entities.js';
import { splinePts } from './spline.js';

const loopEnt = l => ({ pts: l.pts, bulges: l.bulges, closed: true });
export const loopArea = l => plArea(loopEnt(l));
export const loopLength = l => plLength(loopEnt(l));
export const regionArea = e => e.loops.reduce((s, l) => s + loopArea(l), 0);
export const regionPerimeter = e => e.loops.reduce((s, l) => s + loopLength(l), 0);
// Contorno normalizado: curvaturas nulas fuera y al menos tres vértices (una polilínea de dos vértices no se cierra),
// partiendo por la mitad el arco de mayor ángulo
function clean(l) {
  let pts = [...l.pts], bul = l.pts.map((_, i) => (Math.abs(l.bulges?.[i] || 0) > 1e-12 ? l.bulges[i] : 0));
  while (pts.length < 3 && bul.some(b => b)) {
    let k = 0;
    bul.forEach((b, i) => { if (Math.abs(b) > Math.abs(bul[k])) k = i; });
    const a = pts[k], b = pts[(k + 1) % pts.length], th = 4 * Math.atan(bul[k]), arc = G.bulgeArc(a, b, bul[k]);
    const m = G.polar(arc.c, G.ang(arc.c, a) + th / 2, arc.r), half = Math.tan(th / 8);
    pts.splice(k + 1, 0, m); bul.splice(k, 1, half, half);
  }
  return bul.some(b => b) ? { pts, bulges: bul } : { pts };
}

// Sentido contrario: mismos tramos recorridos al revés (curvaturas cambiadas de signo)
export function reverseLoop(l) {
  const n = l.pts.length, b = l.bulges || [];
  return clean({ pts: [l.pts[0], ...l.pts.slice(1).reverse()], bulges: l.pts.map((_, k) => -(b[n - 1 - k] || 0)) });
}
// Contorno orientado en sentido antihorario (sign = 1) u horario (sign = -1)
export const orient = (l, sign = 1) => (Math.sign(loopArea(l)) === sign ? clean(l) : reverseLoop(l));

// Contorno cerrado de una entidad (sentido antihorario) o null
export function entityLoop(e) {
  switch (e.type) {
    case 'circle': return { pts: [0, 1, 2, 3].map(k => G.polar(e.c, k * Math.PI / 2, e.r)), bulges: [1, 1, 1, 1].map(() => Math.tan(Math.PI / 8)) };
    case 'ellipse': return orient({ pts: ellPts(e, 144) });
    case 'pline': return e.closed && e.pts.length > 2 ? orient({ pts: [...e.pts], bulges: e.pts.map((_, i) => e.bulges?.[i] || 0) }) : null;
    case 'spline': {
      if (!e.closed) return null;
      const p = splinePts(e);
      if (G.eqPt(p[0], p[p.length - 1], 1e-9)) p.pop();
      return orient({ pts: p });
    }
  }
  return null;
}
export const entityLoops = e => (e.type === 'region' ? e.loops.map(l => ({ ...l })) : (l => (l ? [l] : null))(entityLoop(e)));

// ---------- Tramos ----------
// Tramo: {a, b, bu (curvatura), prim (primitiva: segmento o arco antihorario)}
const segPrim = (a, b) => ({ k: 's', a, b });
const arcPrim = (a, b, bu) => ({ k: 'a', ...G.bulgeArc(a, b, bu) });
const mkPiece = (a, b, bu) => ({ a, b, bu, prim: bu ? arcPrim(a, b, bu) : segPrim(a, b) });
const piecesOf = loops => loops.flatMap(l => plPieces(loopEnt(l)).map(pc => mkPiece(pc.a, pc.b, pc.bulge)));
const sweepOf = pc => 4 * Math.atan(pc.bu);
// Punto en la fracción t del recorrido
const at = (pc, t) => (pc.bu ? G.polar(pc.prim.c, G.ang(pc.prim.c, pc.a) + sweepOf(pc) * t, pc.prim.r) : G.lerp(pc.a, pc.b, t));
// Fracción del recorrido de un punto situado sobre el tramo
function tOf(pc, p) {
  if (!pc.bu) { const d = G.sub(pc.b, pc.a), l2 = G.dot(d, d); return l2 ? G.dot(G.sub(p, pc.a), d) / l2 : 0; }
  const th = sweepOf(pc), a0 = G.ang(pc.prim.c, pc.a), ap = G.ang(pc.prim.c, p);
  return th > 0 ? G.normAng(ap - a0) / th : G.normAng(a0 - ap) / -th;
}
function sub(pc, t0, t1) {
  const a = t0 === 0 ? pc.a : at(pc, t0), b = t1 === 1 ? pc.b : at(pc, t1);
  return mkPiece(a, b, pc.bu ? Math.tan(sweepOf(pc) * (t1 - t0) / 4) : 0);
}
// Dirección de avance en la fracción t
function dirAt(pc, t) {
  if (!pc.bu) return G.norm(G.sub(pc.b, pc.a));
  const rv = G.norm(G.sub(at(pc, t), pc.prim.c));
  return pc.bu > 0 ? G.perp(rv) : G.mul(G.perp(rv), -1);
}
const nearOn = (pc, p) => (pc.bu ? G.nearArc(p, pc.prim) : G.nearSeg(p, pc.a, pc.b).p);
const rev = pc => mkPiece(pc.b, pc.a, -pc.bu);

// Polígono fino del contorno (clasificación de puntos)
function polyOf(l, per = 256) {
  const out = [];
  for (const pc of piecesOf([l])) {
    out.push(pc.a);
    if (pc.bu) { const m = Math.max(2, Math.ceil(Math.abs(sweepOf(pc)) / G.TAU * per)); for (let k = 1; k < m; k++) out.push(at(pc, k / m)); }
  }
  return out;
}
const insideOf = polys => p => polys.reduce((n, poly) => n + (G.pointInPoly(p, poly) ? 1 : 0), 0) % 2 === 1;
// Punto dentro del área encerrada por el contorno, junto a la mitad de su primer tramo
function probe(l) {
  const pc = piecesOf([l])[0], m = at(pc, 0.5), size = Math.max(1e-9, G.dist(pc.a, pc.b));
  return G.add(m, G.mul(G.perp(dirAt(pc, 0.5)), Math.sign(loopArea(l)) * size * 1e-5));
}

// Agrupa contornos sueltos en un conjunto con huecos: un contorno dentro de un número impar de otros es un hueco
export function nestLoops(loops) {
  const polys = loops.map(l => polyOf(l));
  return loops.map((l, i) => {
    const pt = probe(l), depth = polys.filter((p, j) => j !== i && G.pointInPoly(pt, p)).length;
    return orient(l, depth % 2 ? -1 : 1);
  });
}

// ---------- Operaciones booleanas ----------
// Se cortan todos los tramos de A con los de B, se clasifica cada trozo según quede dentro o fuera de la otra región
// (los tramos comunes se comparan por su sentido) y se encadenan los trozos que se conservan.
function splitAll(A, B, tol) {
  const cuts = [A.map(() => [0, 1]), B.map(() => [0, 1])];
  A.forEach((pa, i) => B.forEach((pb, j) => {
    for (const x of G.primInt(pa.prim, pb.prim)) { cuts[0][i].push(tOf(pa, x)); cuts[1][j].push(tOf(pb, x)); }
    // Tramos que se solapan: los extremos de cada uno sobre el otro también son cortes
    for (const [p, q, k, idx] of [[pb.a, pa, 0, i], [pb.b, pa, 0, i], [pa.a, pb, 1, j], [pa.b, pb, 1, j]]) if (G.dist(nearOn(q, p), p) < tol) cuts[k][idx].push(tOf(q, p));
  }));
  const split = (list, cs) => list.flatMap((pc, i) => {
    const ts = [...new Set(cs[i].map(t => Math.min(1, Math.max(0, t))))].sort((x, y) => x - y).filter((t, k, a) => !k || t - a[k - 1] > 1e-9);
    if (ts[ts.length - 1] < 1) ts.push(1);
    const out = [];
    for (let k = 1; k < ts.length; k++) { const s = sub(pc, ts[k - 1], ts[k]); if (G.dist(s.a, s.b) > tol) out.push(s); }
    return out;
  });
  return [split(A, cuts[0]), split(B, cuts[1])];
}

// Encadena trozos orientados en contornos cerrados
function chain(pieces, tol) {
  const loops = [], used = new Array(pieces.length).fill(false);
  for (let s = 0; s < pieces.length; s++) {
    if (used[s]) continue;
    const loop = [pieces[s]];
    used[s] = true;
    for (let guard = 0; !G.eqPt(loop[loop.length - 1].b, loop[0].a, tol) && guard < 100000; guard++) {
      const end = loop[loop.length - 1], din = dirAt(end, 1);
      let best = -1, bestTurn = Infinity;
      for (let k = 0; k < pieces.length; k++) {
        if (used[k] || !G.eqPt(pieces[k].a, end.b, tol)) continue;
        const d = dirAt(pieces[k], 0), turn = -Math.atan2(G.cross(din, d), G.dot(din, d)); // el giro más cerrado a la izquierda
        if (turn < bestTurn) { bestTurn = turn; best = k; }
      }
      if (best < 0) break;
      used[best] = true; loop.push(pieces[best]);
    }
    if (G.eqPt(loop[loop.length - 1].b, loop[0].a, tol)) { const l = mergeLoop(loop, tol); if (l && Math.abs(loopArea(l)) > tol * tol) loops.push(l); }
  }
  return loops;
}
// Une los trozos consecutivos de una misma recta o de un mismo arco
function mergeLoop(lp, tol) {
  const same = (x, y) => (!x.bu && !y.bu
    ? Math.abs(G.cross(G.norm(G.sub(x.b, x.a)), G.norm(G.sub(y.b, y.a)))) < 1e-9 && G.dot(G.sub(x.b, x.a), G.sub(y.b, y.a)) > 0
    : !!x.bu && !!y.bu && Math.sign(x.bu) === Math.sign(y.bu) && G.dist(x.prim.c, y.prim.c) < tol && Math.abs(x.prim.r - y.prim.r) < tol);
  const join = (x, y) => { const th = sweepOf(x) + sweepOf(y); return Math.abs(th) < G.TAU - 1e-6 ? mkPiece(x.a, y.b, x.bu ? Math.tan(th / 4) : 0) : null; };
  const out = [];
  for (const pc of lp) {
    const last = out[out.length - 1], j = last && same(last, pc) ? join(last, pc) : null;
    if (j) out[out.length - 1] = j; else out.push(pc);
  }
  while (out.length > 2 && same(out[out.length - 1], out[0])) {
    const j = join(out[out.length - 1], out[0]);
    if (!j) break;
    out.pop(); out[0] = j;
  }
  if (out.length < 2) return null;
  out[out.length - 1] = mkPiece(out[out.length - 1].a, out[0].a, out[out.length - 1].bu); // cierra exactamente
  if (out.length === 2 && !out[0].bu && !out[1].bu) return null;
  return clean({ pts: out.map(p => p.a), bulges: out.map(p => p.bu) });
}

const bboxOfLoops = loops => loops.flatMap(l => l.pts).reduce((r, p) => ({ x1: Math.min(r.x1, p.x), y1: Math.min(r.y1, p.y), x2: Math.max(r.x2, p.x), y2: Math.max(r.y2, p.y) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
// op: 'union' | 'subtract' (A − B) | 'intersect'. A y B: listas de contornos orientados. Devuelve los contornos del resultado
export function booleanLoops(A, B, op) {
  const bb = bboxOfLoops([...A, ...B]), size = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) || 1, tol = size * 1e-9;
  const [pa, pb] = splitAll(piecesOf(A), piecesOf(B), tol * 10);
  const inA = insideOf(A.map(l => polyOf(l))), inB = insideOf(B.map(l => polyOf(l)));
  const keep = [];
  const classify = (list, inOther, other, isA) => {
    for (const s of list) {
      const m = at(s, 0.5), shared = other.find(o => G.dist(nearOn(o, m), m) < tol * 1000);
      if (shared) { // tramo común a las dos regiones: se conserva una sola vez (el de A)
        const same = G.dot(dirAt(s, 0.5), dirAt(shared, tOf(shared, m))) > 0;
        if (isA && (op === 'subtract' ? !same : same)) keep.push(s);
        continue;
      }
      const inside = inOther(m);
      if (op === 'union' ? !inside : op === 'intersect' ? inside : isA ? !inside : inside) keep.push(op === 'subtract' && !isA ? rev(s) : s);
    }
  };
  classify(pa, inB, pb, true);
  classify(pb, inA, pa, false);
  return chain(keep, tol * 1000);
}

// Contornos cerrados a partir de líneas, arcos y polilíneas abiertas con extremos coincidentes (REGION con objetos sueltos).
// Devuelve [{loop, src: [entidades que lo forman]}]; un objeto sólo forma parte de un contorno
export function chainLoops(items, tol = 1e-6) {
  const pieces = [];
  for (const e of items) {
    if (e.type === 'line') pieces.push({ a: e.p1, b: e.p2, bu: 0, e });
    else if (e.type === 'arc') pieces.push({ a: G.polar(e.c, e.a1, e.r), b: G.polar(e.c, e.a2, e.r), bu: Math.tan(G.sweep(e.a1, e.a2) / 4), e });
    else if (e.type === 'pline' && !e.closed && e.pts.length > 1) { const pcs = plPieces(e); pieces.push({ a: pcs[0].a, b: pcs[pcs.length - 1].b, sub: pcs.map(pc => ({ a: pc.a, b: pc.b, bu: pc.bulge })), e }); }
  }
  const flat = (p, fwd) => (p.sub ? (fwd ? p.sub : [...p.sub].reverse().map(s => ({ a: s.b, b: s.a, bu: -s.bu }))) : [fwd ? p : { a: p.b, b: p.a, bu: -p.bu }]);
  const used = new Array(pieces.length).fill(false), out = [];
  for (let s = 0; s < pieces.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    const lp = [...flat(pieces[s], true)], src = [pieces[s].e], marks = [s];
    for (let grew = true; grew && !G.eqPt(lp[lp.length - 1].b, lp[0].a, tol);) {
      grew = false;
      const end = lp[lp.length - 1].b;
      for (let k = 0; k < pieces.length; k++) {
        if (used[k]) continue;
        const fwd = G.eqPt(pieces[k].a, end, tol);
        if (!fwd && !G.eqPt(pieces[k].b, end, tol)) continue;
        lp.push(...flat(pieces[k], fwd)); src.push(pieces[k].e); marks.push(k); used[k] = grew = true;
        break;
      }
    }
    if (lp.length > 1 && G.eqPt(lp[lp.length - 1].b, lp[0].a, tol)) out.push({ loop: orient({ pts: lp.map(p => p.a), bulges: lp.map(p => p.bu) }), src });
    else for (const k of marks.slice(1)) used[k] = false; // la cadena no se cierra: sus piezas pueden formar otra
  }
  return out;
}

// Contorno exacto (con arcos) a partir de un contorno detectado sobre el teselado: edges = [{a, b, prim}] consecutivos, donde prim
// es la primitiva de origen de cada trozo. Los trozos de una misma primitiva se unen y los vértices se llevan a la intersección
// exacta de las primitivas vecinas. tol: distancia máxima del ajuste
export function exactLoop(edges, tol) {
  const runs = [];
  const signedStep = (c, a, b) => Math.atan2(G.cross(G.sub(a, c), G.sub(b, c)), G.dot(G.sub(a, c), G.sub(b, c)));
  for (const ed of edges) {
    const last = runs[runs.length - 1], isArc = ed.prim?.k === 'a';
    if (last && ed.prim && last.prim === ed.prim) { last.b = ed.b; if (isArc) last.th += signedStep(ed.prim.c, ed.a, ed.b); continue; }
    if (last && !isArc && last.prim?.k !== 'a' && G.dist(last.a, last.b) > 0 && Math.abs(G.cross(G.norm(G.sub(last.b, last.a)), G.norm(G.sub(ed.b, ed.a)))) < 1e-9) { last.b = ed.b; continue; }
    runs.push({ a: ed.a, b: ed.b, prim: ed.prim, th: isArc ? signedStep(ed.prim.c, ed.a, ed.b) : 0 });
  }
  if (runs.length > 1 && runs[0].prim?.k === 'a' && runs[0].prim === runs[runs.length - 1].prim) { const l = runs.pop(); runs[0].a = l.a; runs[0].th += l.th; }
  const n = runs.length;
  for (let i = 0; i < n; i++) {
    const p = runs[i], q = runs[(i + 1) % n];
    if (!p.prim || !q.prim || p.prim === q.prim) continue;
    let best = null, bd = tol;
    for (const x of G.primInt(p.prim, q.prim, true, true)) { const d = G.dist(x, p.b); if (d < bd) { bd = d; best = x; } }
    if (best) { p.b = best; q.a = best; }
  }
  const pts = [], bul = [];
  for (const r of runs) {
    if (r.prim?.k !== 'a') { pts.push(r.a); bul.push(0); continue; }
    const c = r.prim.c, a0 = G.ang(c, r.a), a1 = G.ang(c, r.b);
    let th = r.th > 0 ? G.normAng(a1 - a0) : -G.normAng(a0 - a1);
    if (Math.abs(th - r.th) > Math.PI) th += r.th > th ? G.TAU : -G.TAU;
    // Los arcos de más de media vuelta se parten en dos (la curvatura de una vuelta entera no existe)
    const parts = Math.abs(th) > Math.PI + 1e-9 ? 2 : 1;
    for (let k = 0; k < parts; k++) { pts.push(k ? G.polar(c, a0 + th / 2, r.prim.r) : r.a); bul.push(Math.tan(th / parts / 4)); }
  }
  return clean({ pts, bulges: bul });
}
