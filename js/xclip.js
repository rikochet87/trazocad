// Delimitación de referencias a bloques y referencias externas (XCLIP): contorno poligonal en coordenadas del bloque.
/** @typedef {import('./document.js').Doc} Doc */
/** @typedef {import('./types').Entity} Entity */
/** @typedef {import('./types').Point} Point */
// @ts-check
// Referencia: e.clip = {pts: [vértices en coordenadas de la definición], invert: mostrar sólo lo de fuera, off: delimitación desactivada}
import * as G from './geom.js';

/** @param {{clip?: {pts?: Point[], off?: boolean}}} e @returns {boolean} */
export const clipActive = e => !!(e.clip && !e.clip.off && e.clip.pts?.length > 2);
// ¿Se ve el punto? (dentro del contorno, o fuera si la delimitación está invertida)
/** @param {Point[]} poly @param {boolean} [invert] @returns {(p: Point) => boolean} */
export const clipKeeps = (poly, invert) => p => G.pointInPoly(p, poly) !== !!invert;

// Recorta primitivas (segmentos y arcos) con el contorno: devuelve los segmentos visibles (los arcos se tesselan)
/** Recorta las primitivas al contorno (o a su exterior). @param {import('./types').Prim[]} prims @param {Point[]} poly @param {boolean} [invert] @returns {import('./types').Prim[]} */
export function clipPrims(prims, poly, invert) {
  const keep = clipKeeps(poly, invert), out = [], n = poly.length;
  const seg = (a, b) => {
    const ts = [0, 1];
    for (let i = 0; i < n; i++) {
      const r = G.llInt(a, b, poly[i], poly[(i + 1) % n]);
      if (r && r.t > 1e-12 && r.t < 1 - 1e-12 && r.u >= -1e-12 && r.u <= 1 + 1e-12) ts.push(r.t);
    }
    ts.sort((x, y) => x - y);
    for (let k = 1; k < ts.length; k++) {
      if (ts[k] - ts[k - 1] < 1e-12) continue;
      if (keep(G.lerp(a, b, (ts[k - 1] + ts[k]) / 2))) out.push({ k: 's', a: G.lerp(a, b, ts[k - 1]), b: G.lerp(a, b, ts[k]) });
    }
  };
  for (const q of prims) {
    if (q.k === 's') { seg(q.a, q.b); continue; }
    const sw = G.sweep(q.a1, q.a2), m = Math.max(4, Math.ceil(sw / (G.TAU / 96)));
    let prev = G.polar(q.c, q.a1, q.r);
    for (let k = 1; k <= m; k++) { const p = G.polar(q.c, q.a1 + sw * k / m, q.r); seg(prev, p); prev = p; }
  }
  return out;
}

// Contorno rectangular a partir de dos esquinas
/** @param {Point} a @param {Point} b @returns {Point[]} */
export const rectClip = (a, b) => [G.P(Math.min(a.x, b.x), Math.min(a.y, b.y)), G.P(Math.max(a.x, b.x), Math.min(a.y, b.y)), G.P(Math.max(a.x, b.x), Math.max(a.y, b.y)), G.P(Math.min(a.x, b.x), Math.max(a.y, b.y))];
