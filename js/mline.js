// Líneas múltiples (MLINE): estilos y geometría de los elementos paralelos, con uniones a inglete, remates y relleno.
// Estilo: {name, desc, elems: [{off, color, ltype}], caps: {sLine, eLine, sOuter, eOuter, sInner, eInner}, joints, fill}
//   off: desfase del elemento (a la izquierda del sentido de dibujo, multiplicado por la escala de la línea);
//   color y ltype: 'BYLAYER', 'BYBLOCK' o un valor propio; fill: color de relleno o null.
// Entidad: {type: 'mline', pts, closed, just: 'top'|'zero'|'bottom', scale, mlstyle}
import * as G from './geom.js';
const { P } = G;

export const DEFAULT_MLINESTYLE = {
  name: 'STANDARD', desc: '', elems: [{ off: 0.5, color: 'BYLAYER', ltype: 'BYLAYER' }, { off: -0.5, color: 'BYLAYER', ltype: 'BYLAYER' }],
  caps: { sLine: false, eLine: false, sOuter: false, eOuter: false, sInner: false, eInner: false }, joints: false, fill: null,
};
export const ML_JUST = [['top', 'Superior'], ['zero', 'Cero'], ['bottom', 'Inferior']];
export const CAP_KEYS = { sLine: 'Línea al inicio', eLine: 'Línea al final', sOuter: 'Arco exterior al inicio', eOuter: 'Arco exterior al final', sInner: 'Arcos interiores al inicio', eInner: 'Arcos interiores al final' };

// Elementos ordenados del desfase mayor al menor (como los lista AutoCAD)
export const sortedElems = st => [...(st.elems?.length ? st.elems : DEFAULT_MLINESTYLE.elems)].sort((a, b) => b.off - a.off);

// Desplazamiento de la justificación: la línea dibujada coincide con el elemento superior, con el desfase 0 o con el inferior
export function justShift(st, just) {
  const offs = sortedElems(st).map(x => x.off);
  return just === 'top' ? -Math.max(...offs) : just === 'bottom' ? -Math.min(...offs) : 0;
}

// Direcciones de los tramos y vectores de inglete de cada vértice ({dir, miter, k}: k = 1 / seno entre inglete y tramo)
export function mlineFrames(pts, closed) {
  const n = pts.length, cl = closed && n > 2, out = [];
  const segDir = i => G.norm(G.sub(pts[(i + 1) % n], pts[i]));
  for (let i = 0; i < n; i++) {
    const hasPrev = cl || i > 0, hasNext = cl || i < n - 1;
    const dOut = hasNext ? segDir(i) : segDir(i - 1), dIn = hasPrev ? segDir((i - 1 + n) % n) : dOut;
    const nIn = G.perp(dIn), nOut = G.perp(dOut);
    let m = G.add(nIn, nOut), k;
    if (G.len(m) < 1e-9) { m = nOut; k = 1; } // vuelta de 180°: sin inglete
    else { m = G.norm(m); k = 1 / Math.max(0.05, G.dot(m, nOut)); }
    out.push({ dir: dOut, miter: m, k });
  }
  return out;
}

// ---------- Cortes (MLEDIT) ----------
// e.cuts = [{s, k, a, b}]: el elemento k (en el orden de sortedElems) no se dibuja en el tramo s entre las distancias a y b,
// medidas a lo largo del eje desde el vértice s (así no dependen del inglete ni de la escala del estilo).
const segCount = (n, closed) => (closed ? n : n - 1);
// Une intervalos solapados
function mergeIv(list) {
  const iv = list.filter(([a, b]) => b > a + 1e-9).sort((x, y) => x[0] - y[0]), out = [];
  for (const [a, b] of iv) { const l = out[out.length - 1]; if (l && a <= l[1] + 1e-9) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
}
// Tramos visibles de un elemento: [{pts, closed}]; start/end: el elemento llega a su primer / último vértice
function elemRuns(axis, closed, el, cuts) {
  const n = axis.length, m = segCount(n, closed);
  if (!cuts.length) return { runs: [{ pts: el, closed }], start: true, end: true };
  const runs = [];
  let cur = [el[0]], start = true, end = true;
  for (let s = 0; s < m; s++) {
    const A = axis[s], dir = G.norm(G.sub(axis[(s + 1) % n], A)), p0 = el[s], p1 = el[(s + 1) % n];
    const d0 = G.dot(G.sub(p0, A), dir), d1 = G.dot(G.sub(p1, A), dir), at = d => (Math.abs(d1 - d0) < 1e-12 ? p0 : G.lerp(p0, p1, (d - d0) / (d1 - d0)));
    const iv = mergeIv(cuts.filter(c => c.s === s).map(c => [Math.max(d0, Math.min(c.a, c.b)), Math.min(d1, Math.max(c.a, c.b))]));
    for (const [a, b] of iv) {
      if (s === 0 && a <= d0 + 1e-9) start = false;
      if (a > d0 + 1e-9) cur.push(at(a));
      if (cur.length > 1) runs.push(cur);
      cur = b >= d1 - 1e-9 ? [] : [at(b)];
      if (b >= d1 - 1e-9 && s === m - 1) end = false;
    }
    if (!cur.length) cur = [p1]; else cur.push(p1);
  }
  if (closed && start && end && runs.length) runs[0] = [...cur, ...runs[0].slice(1)]; // el primer tramo continúa el último
  else if (cur.length > 1) runs.push(cur);
  if (closed && !runs.length && start && end) return { runs: [{ pts: el, closed: true }], start, end };
  return { runs: runs.filter(r => r.length > 1).map(r => ({ pts: r, closed: false })), start, end };
}

// Geometría: {elems: [{pts, runs, color, ltype, off}], lines: [[a, b]] (remates e ingletes), arcs: [[c, r, a1, a2]], fill: [[puntos]] , frames}
export function mlineGeom(e, st) {
  const pts = e.pts, n = pts.length, closed = !!e.closed && n > 2, s = e.scale ?? 1, sh = justShift(st, e.just || 'top');
  const frames = mlineFrames(pts, closed), list = sortedElems(st);
  const at = (i, off) => G.add(pts[i], G.mul(frames[i].miter, (off + sh) * s * frames[i].k));
  const elems = list.map((x, k) => {
    const ep = pts.map((_, i) => at(i, x.off)), r = elemRuns(pts, closed, ep, (e.cuts || []).filter(c => c.k === k));
    return { pts: ep, runs: r.runs, start: r.start, end: r.end, color: x.color, ltype: x.ltype, off: x.off };
  });
  const lines = [], arcs = [], caps = { ...st.caps };
  // Un extremo recortado por MLEDIT (unión en T, esquina) no lleva remate
  if (elems.some(x => !x.start)) caps.sLine = caps.sOuter = caps.sInner = false;
  if (elems.some(x => !x.end)) caps.eLine = caps.eOuter = caps.eInner = false;
  if (n >= 2 && !closed) {
    const top = elems[0], bot = elems[elems.length - 1];
    const cap = (i, line, outer, inner, start) => {
      if (line) lines.push([top.pts[i], bot.pts[i]]);
      // Arcos: semicírculos que unen elementos simétricos (los extremos), hacia fuera de la línea
      const arcPair = (a, b) => {
        const c = G.mid(a.pts[i], b.pts[i]), r = G.dist(a.pts[i], b.pts[i]) / 2;
        if (r < 1e-12) return;
        const t = G.ang(c, a.pts[i]), tb = G.ang(c, b.pts[i]);
        // El arco sale hacia atrás al inicio y hacia delante al final
        const dir = frames[i].dir, fwd = G.polar(c, t + Math.PI / 2, r), goesFwd = G.dot(G.sub(fwd, c), dir) > 0;
        if (goesFwd !== start) arcs.push([c, r, t, tb]); else arcs.push([c, r, tb, t]);
      };
      if (outer && elems.length > 1) arcPair(top, bot);
      if (inner) for (let a = 1, b = elems.length - 2; a < b; a++, b--) arcPair(elems[a], elems[b]);
    };
    cap(0, caps.sLine, caps.sOuter, caps.sInner, true);
    cap(n - 1, caps.eLine, caps.eOuter, caps.eInner, false);
  }
  if (st.joints && elems.length > 1) for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) lines.push([elems[0].pts[i], elems[elems.length - 1].pts[i]]);
  let fill = null;
  if (st.fill && elems.length > 1) {
    const a = elems[0].pts, b = elems[elems.length - 1].pts;
    if (!e.cuts?.length) fill = closed ? [a, b] : [[...a, ...[...b].reverse()]];
    // Con cortes: un cuadrilátero por tramo visible de los dos elementos extremos
    else {
      const m = elems.length - 1, at = (p0, p1, t, L) => G.add(p0, G.mul(G.sub(p1, p0), t / L));
      fill = [];
      for (let s = 0; s < segCount(n, closed); s++) {
        const L = G.dist(pts[s], pts[(s + 1) % n]) || 1e-12;
        const iv = mergeIv(e.cuts.filter(c => c.s === s && (c.k === 0 || c.k === m)).map(c => [Math.max(0, Math.min(c.a, c.b)), Math.min(L, Math.max(c.a, c.b))]));
        let cur = 0;
        const vis = [];
        for (const [x, y] of iv) { if (x > cur + 1e-9) vis.push([cur, x]); cur = Math.max(cur, y); }
        if (cur < L - 1e-9) vis.push([cur, L]);
        for (const [x, y] of vis) {
          const A = a[s], B = a[(s + 1) % n], C = b[s], D = b[(s + 1) % n];
          fill.push([at(A, B, x, L), at(A, B, y, L), at(C, D, y, L), at(C, D, x, L)]);
        }
      }
      if (!fill.length) fill = null;
    }
  }
  return { elems, lines, arcs, fill, frames, closed };
}

// Segmentos de los tramos visibles de un elemento
const runSegs = el => el.runs.flatMap(r => { const p = r.pts, m = r.closed ? p.length : p.length - 1; return Array.from({ length: m }, (_, i) => [p[i], p[(i + 1) % p.length]]); });

// Segmentos y arcos (primitivas) de la geometría
export function mlinePrims(g) {
  const out = [];
  for (const el of g.elems) for (const [a, b] of runSegs(el)) out.push({ k: 's', a, b });
  for (const [a, b] of g.lines) out.push({ k: 's', a, b });
  for (const [c, r, a1, a2] of g.arcs) out.push({ k: 'a', c, r, a1, a2 });
  return out;
}

// Polilíneas, líneas y arcos sueltos en que se descompone (EXPLODE, DXF R12): [{type, …, color, ltype}]
export function mlineParts(g) {
  const out = [];
  for (const el of g.elems) for (const [a, b] of runSegs(el)) out.push({ type: 'line', p1: a, p2: b, color: el.color, ltype: el.ltype });
  for (const [a, b] of g.lines) out.push({ type: 'line', p1: a, p2: b });
  for (const [c, r, a1, a2] of g.arcs) out.push({ type: 'arc', c, r, a1, a2 });
  return out;
}

// ---------- Edición de líneas múltiples (MLEDIT) ----------
export const MLEDIT_TOOLS = {
  CC: 'Cruz cerrada', OC: 'Cruz abierta', MC: 'Cruz combinada', CT: 'T cerrada', OT: 'T abierta', MT: 'T combinada',
  CJ: 'Unión en esquina', AV: 'Añadir vértice', DV: 'Suprimir vértice', CS: 'Cortar uno', CA: 'Cortar todo', WA: 'Soldar todo',
};
const FAR = 1e9; // corte hasta el final del tramo
const isClosed = e => !!e.closed && e.pts.length > 2;
// Desfases reales de los elementos (a la izquierda del sentido de dibujo, en unidades del dibujo), en el orden de sortedElems
export const elemOffsets = (e, st) => { const sh = justShift(st, e.just || 'top'), s = e.scale ?? 1; return sortedElems(st).map(x => (x.off + sh) * s); };
function segOf(e, i) {
  const A = e.pts[i], B = e.pts[(i + 1) % e.pts.length], d = G.sub(B, A), len = G.len(d) || 1e-12, dir = G.mul(d, 1 / len);
  return { A, B, dir, nrm: G.perp(dir), len };
}
const param = (g, p) => G.dot(G.sub(p, g.A), g.dir);
// Tramo del eje más próximo a un punto
export function nearestSeg(e, p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < segCount(e.pts.length, isClosed(e)); i++) { const g = segOf(e, i), d = G.dist(p, G.nearSeg(p, g.A, g.B).p); if (d < bd) { bd = d; best = i; } }
  return best;
}
// Elemento más próximo a un punto (índice en el orden de sortedElems)
export function nearestElem(e, st, p) {
  const g = segOf(e, nearestSeg(e, p)), o = elemOffsets(e, st), d = G.dot(G.sub(p, g.A), g.nrm);
  return o.reduce((bi, x, i) => (Math.abs(x - d) < Math.abs(o[bi] - d) ? i : bi), 0);
}
// Intersección de la recta de un elemento (desfase o1 en el tramo g1) con la de otro (o2 en g2): punto y parámetro en cada eje
function crossAt(g1, o1, g2, o2) {
  const a = G.add(g1.A, G.mul(g1.nrm, o1)), c = G.add(g2.A, G.mul(g2.nrm, o2)), r = G.llInt(a, G.add(a, g1.dir), c, G.add(c, g2.dir));
  return r ? { p: r.p, t1: param(g1, r.p), t2: param(g2, r.p) } : null;
}
// Une los cortes solapados de cada elemento en cada tramo
function normCuts(e) {
  const by = new Map();
  for (const c of e.cuts || []) { const key = `${c.s},${c.k}`; (by.get(key) || by.set(key, []).get(key)).push([c.a, c.b]); }
  e.cuts = [...by].flatMap(([key, iv]) => { const [s, k] = key.split(',').map(Number); return mergeIv(iv).map(([a, b]) => ({ s, k, a, b })); });
  if (!e.cuts.length) delete e.cuts;
}
export function addCut(e, s, k, a, b) { (e.cuts ||= []).push({ s, k, a: Math.min(a, b), b: Math.max(a, b) }); normCuts(e); }
// Quita los cortes de los elementos ks en el intervalo [a, b] del tramo s
function weldRange(e, s, a, b, ks) {
  e.cuts = (e.cuts || []).flatMap(c => {
    if (c.s !== s || !ks.includes(c.k) || c.b <= a || c.a >= b) return [c];
    return [...(c.a < a ? [{ ...c, b: a }] : []), ...(c.b > b ? [{ ...c, a: b }] : [])];
  });
  normCuts(e);
}
// Cortes tras invertir el sentido de la línea (simetría): el tramo s pasa a ser el n−2−s (el de cierre sigue siendo el último)
export function reverseCuts(e) {
  if (!e.cuts) return;
  const n = e.pts.length, cl = isClosed(e);
  e.cuts = e.cuts.map(c => {
    const j = cl && c.s === n - 1 ? n - 1 : n - 2 - c.s, L = segOf(e, j).len;
    return { ...c, s: j, a: L - c.b, b: L - c.a };
  });
}

// Recorta (o alarga) la línea E en su tramo s: cada elemento k termina en el parámetro ts[k] del eje. keepStart: se conserva
// la parte inicial (el extremo final se mueve) o la final. Devuelve un mensaje si no se puede.
function trimEnd(E, s, g, ts, keepStart) {
  if (keepStart) {
    const T = Math.max(...ts);
    if (s === 0 && T < 1e-6) return 'La línea múltiple quedaría sin longitud.';
    E.pts = [...E.pts.slice(0, s + 1), G.add(g.A, G.mul(g.dir, T))];
    E.cuts = (E.cuts || []).filter(c => c.s <= s);
    ts.forEach((t, k) => { if (T - t > 1e-9) (E.cuts ||= []).push({ s, k, a: t, b: FAR }); });
  } else {
    const T = Math.min(...ts);
    if (s === E.pts.length - 2 && T > g.len - 1e-6) return 'La línea múltiple quedaría sin longitud.';
    E.pts = [G.add(g.A, G.mul(g.dir, T)), ...E.pts.slice(s + 1)];
    E.cuts = (E.cuts || []).filter(c => c.s >= s).map(c => (c.s === s ? { ...c, s: 0, a: c.a - T, b: c.b - T } : { ...c, s: c.s - s }));
    ts.forEach((t, k) => { if (t - T > 1e-9) E.cuts.push({ s: 0, k, a: -FAR, b: t - T }); });
  }
  normCuts(E);
  return null;
}
const outerIdx = o => [...new Set([o.indexOf(Math.max(...o)), o.indexOf(Math.min(...o))])];

// Cruces entre A (primera designada) y B, en los tramos más próximos a los puntos designados.
// CC: todos los elementos de A se cortan entre los exteriores de B; OC: además los exteriores de B se cortan entre los de A;
// MC: sólo se cortan los exteriores de ambas (los interiores se cruzan).
export function mlCross(A, stA, pA, B, stB, pB, kind) {
  const sa = nearestSeg(A, pA), sb = nearestSeg(B, pB), ga = segOf(A, sa), gb = segOf(B, sb), X = crossAt(ga, 0, gb, 0);
  if (!X) return 'Las líneas múltiples son paralelas.';
  if (X.t1 < -1e-9 || X.t1 > ga.len + 1e-9 || X.t2 < -1e-9 || X.t2 > gb.len + 1e-9) return 'Las líneas múltiples no se cruzan en los tramos designados.';
  const oa = elemOffsets(A, stA), ob = elemOffsets(B, stB);
  const cutBetween = (E, sE, gE, oE, ks, gO, oO) => {
    const outs = outerIdx(oO);
    for (const k of ks) {
      const ts = (outs.length > 1 ? outs : [outs[0], outs[0]]).map(j => crossAt(gE, oE[k], gO, oO[j])?.t1);
      if (ts.every(t => t != null)) addCut(E, sE, k, ts[0], ts[1]);
    }
  };
  cutBetween(A, sa, ga, oa, kind === 'MC' ? outerIdx(oa) : oa.map((_, i) => i), gb, ob);
  if (kind !== 'CC') cutBetween(B, sb, gb, ob, outerIdx(ob), ga, oa);
  return null;
}

// Uniones en T: A (el pie) se recorta o alarga hasta B (la barra); se conserva la parte de A en la que se designó.
// CT: hasta el elemento de B más próximo; OT: además ese elemento de B se abre entre los exteriores de A;
// MT: como OT, pero los elementos interiores de A llegan hasta el eje de B.
export function mlTee(A, stA, pA, B, stB, pB, kind) {
  if (isClosed(A)) return 'La línea múltiple del pie de la T no puede ser cerrada.';
  const sa = nearestSeg(A, pA), sb = nearestSeg(B, pB), ga = segOf(A, sa), gb = segOf(B, sb), X = crossAt(ga, 0, gb, 0);
  if (!X) return 'Las líneas múltiples son paralelas.';
  const oa = elemOffsets(A, stA), ob = elemOffsets(B, stB), outA = outerIdx(oa);
  const side = G.cross(gb.dir, G.sub(pA, gb.A)) >= 0 ? 1 : -1; // lado de B en que queda el pie
  const near = side > 0 ? Math.max(...ob) : Math.min(...ob), axis = (Math.max(...ob) + Math.min(...ob)) / 2;
  const ts = oa.map((o, k) => crossAt(ga, o, gb, kind === 'MT' && !outA.includes(k) ? axis : near)?.t1);
  if (ts.some(t => t == null)) return 'Las líneas múltiples son paralelas.';
  const tb = outA.map(k => crossAt(ga, oa[k], gb, near).t2);
  const err = trimEnd(A, sa, ga, ts, param(ga, pA) < X.t1);
  if (err) return err;
  if (kind !== 'CT' && tb.length === 2) addCut(B, sb, ob.indexOf(near), tb[0], tb[1]);
  return null;
}

// Unión en esquina: las dos líneas se recortan o alargan hasta su intersección, cada elemento hasta el que le corresponde
// de la otra (el que tiene el mismo desfase en el recorrido A → esquina → B), como el inglete de una polilínea.
export function mlCorner(A, stA, pA, B, stB, pB) {
  if (isClosed(A) || isClosed(B)) return 'Las líneas múltiples cerradas no admiten uniones en esquina.';
  const sa = nearestSeg(A, pA), sb = nearestSeg(B, pB), ga = segOf(A, sa), gb = segOf(B, sb), X = crossAt(ga, 0, gb, 0);
  if (!X) return 'Las líneas múltiples son paralelas.';
  const keepA = param(ga, pA) < X.t1, keepB = param(gb, pB) < X.t2, oa = elemOffsets(A, stA), ob = elemOffsets(B, stB);
  const la = oa.map(o => (keepA ? o : -o)), lb = ob.map(o => (keepB ? -o : o));
  const near = (list, v) => list.reduce((bi, x, i) => (Math.abs(x - v) < Math.abs(list[bi] - v) ? i : bi), 0);
  const tA = oa.map((o, k) => crossAt(ga, o, gb, ob[near(lb, la[k])])?.t1), tB = ob.map((o, j) => crossAt(gb, o, ga, oa[near(la, lb[j])])?.t1);
  if ([...tA, ...tB].some(t => t == null)) return 'Las líneas múltiples son paralelas.';
  return trimEnd(A, sa, ga, tA, keepA) || trimEnd(B, sb, gb, tB, keepB);
}

// Añade un vértice en el punto del eje más próximo a p
export function mlAddVertex(e, p) {
  const s = nearestSeg(e, p), g = segOf(e, s), t = param(g, p);
  if (t < 1e-9 || t > g.len - 1e-9) return false;
  e.pts = [...e.pts.slice(0, s + 1), G.add(g.A, G.mul(g.dir, t)), ...e.pts.slice(s + 1)];
  e.cuts = (e.cuts || []).flatMap(c => (c.s < s ? [c] : c.s > s ? [{ ...c, s: c.s + 1 }]
    : [...(c.a < t ? [{ ...c, b: Math.min(c.b, t) }] : []), ...(c.b > t ? [{ ...c, s: s + 1, a: Math.max(c.a, t) - t, b: c.b - t }] : [])]));
  normCuts(e);
  return true;
}
// Suprime el vértice más próximo a p. Los cortes de los dos tramos que se unen pasan al tramo nuevo (los del segundo, a
// continuación de la longitud del primero); en un extremo abierto se pierden los del tramo que desaparece.
export function mlDelVertex(e, p) {
  const n = e.pts.length, cl = isClosed(e);
  if (n <= (cl ? 3 : 2)) return false;
  let i = 0;
  e.pts.forEach((q, j) => { if (G.dist(q, p) < G.dist(e.pts[i], p)) i = j; });
  const prev = (i - 1 + n) % n, Lp = segOf(e, prev).len;
  const merged = cl || (i > 0 && i < n - 1), at = cl && i === 0 ? n - 2 : i - 1; // índice del tramo unido
  e.cuts = (e.cuts || []).flatMap(c => {
    if (merged && c.s === prev) return [{ ...c, s: at }];
    if (merged && c.s === i) return [{ ...c, s: at, a: c.a + Lp, b: c.b + Lp }];
    if (!merged && (c.s === i || c.s === i - 1)) return [];
    return [{ ...c, s: c.s > i ? c.s - 1 : c.s }];
  });
  e.pts = e.pts.filter((_, j) => j !== i);
  normCuts(e);
  return true;
}
// Corta (o suelda) los elementos ks entre dos puntos, aunque estén en tramos distintos
export function mlCutRange(e, p1, p2, ks, weld = false) {
  const pos = p => { const s = nearestSeg(e, p); return { s, t: param(segOf(e, s), p) }; };
  let a = pos(p1), b = pos(p2);
  if (a.s > b.s || (a.s === b.s && a.t > b.t)) [a, b] = [b, a];
  for (let s = a.s; s <= b.s; s++) {
    const lo = s === a.s ? a.t : -FAR, hi = s === b.s ? b.t : FAR;
    if (weld) weldRange(e, s, lo, hi, ks); else for (const k of ks) (e.cuts ||= []).push({ s, k, a: lo, b: hi });
  }
  normCuts(e);
}
// Huecos de cada elemento en cada vértice para el DXF: distancias a lo largo del tramo desde el inicio del elemento
export function cutParams(e, g, i, k) {
  const n = e.pts.length;
  if (i >= segCount(n, g.closed)) return [];
  const A = e.pts[i], dir = G.norm(G.sub(e.pts[(i + 1) % n], A)), el = g.elems[k];
  const d0 = G.dot(G.sub(el.pts[i], A), dir), d1 = G.dot(G.sub(el.pts[(i + 1) % n], A), dir);
  return mergeIv((e.cuts || []).filter(c => c.s === i && c.k === k).map(c => [Math.max(d0, c.a), Math.min(d1, c.b)])).map(([a, b]) => [a - d0, b - d0]);
}

const withSrc = list => list.flatMap(e => (e.type === 'array' ? [e, ...withSrc(e.src)] : [e]));
export const mlineStyleRefs = (doc, name) => withSrc([...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)]).filter(e => e.type === 'mline' && (e.mlstyle || 'STANDARD') === name).length;
export const mlStyleOf = (doc, name) => doc?.mlineStyles?.find(s => s.name === name) || doc?.mlineStyles?.[0] || DEFAULT_MLINESTYLE;
// Vértice de inicio cualquiera (para centrar el ejemplo del administrador de estilos)
export const samplePts = w => [P(0, 0), P(w * 0.45, 0), P(w * 0.7, w * 0.25), P(w, w * 0.25)];
