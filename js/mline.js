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

// Geometría: {elems: [{pts, color, ltype, off}], lines: [[a, b]] (remates e ingletes), arcs: [[c, r, a1, a2]], fill: [[puntos]] , frames}
export function mlineGeom(e, st) {
  const pts = e.pts, n = pts.length, closed = !!e.closed && n > 2, s = e.scale ?? 1, sh = justShift(st, e.just || 'top');
  const frames = mlineFrames(pts, closed), list = sortedElems(st);
  const at = (i, off) => G.add(pts[i], G.mul(frames[i].miter, (off + sh) * s * frames[i].k));
  const elems = list.map(x => ({ pts: pts.map((_, i) => at(i, x.off)), color: x.color, ltype: x.ltype, off: x.off }));
  const lines = [], arcs = [], caps = st.caps || {};
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
    fill = closed ? [a, b] : [[...a, ...[...b].reverse()]];
  }
  return { elems, lines, arcs, fill, frames, closed };
}

// Segmentos y arcos (primitivas) de la geometría
export function mlinePrims(g) {
  const out = [];
  for (const el of g.elems) {
    const p = el.pts, m = g.closed ? p.length : p.length - 1;
    for (let i = 0; i < m; i++) out.push({ k: 's', a: p[i], b: p[(i + 1) % p.length] });
  }
  for (const [a, b] of g.lines) out.push({ k: 's', a, b });
  for (const [c, r, a1, a2] of g.arcs) out.push({ k: 'a', c, r, a1, a2 });
  return out;
}

// Polilíneas, líneas y arcos sueltos en que se descompone (EXPLODE, DXF R12): [{type, …, color, ltype}]
export function mlineParts(g) {
  const out = [];
  for (const el of g.elems) {
    const p = el.pts, m = g.closed ? p.length : p.length - 1;
    for (let i = 0; i < m; i++) out.push({ type: 'line', p1: p[i], p2: p[(i + 1) % p.length], color: el.color, ltype: el.ltype });
  }
  for (const [a, b] of g.lines) out.push({ type: 'line', p1: a, p2: b });
  for (const [c, r, a1, a2] of g.arcs) out.push({ type: 'arc', c, r, a1, a2 });
  return out;
}

const withSrc = list => list.flatMap(e => (e.type === 'array' ? [e, ...withSrc(e.src)] : [e]));
export const mlineStyleRefs = (doc, name) => withSrc([...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)]).filter(e => e.type === 'mline' && (e.mlstyle || 'STANDARD') === name).length;
export const mlStyleOf = (doc, name) => doc?.mlineStyles?.find(s => s.name === name) || doc?.mlineStyles?.[0] || DEFAULT_MLINESTYLE;
// Vértice de inicio cualquiera (para centrar el ejemplo del administrador de estilos)
export const samplePts = w => [P(0, 0), P(w * 0.45, 0), P(w * 0.7, w * 0.25), P(w, w * 0.25)];
