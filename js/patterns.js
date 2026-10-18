// Patrones de sombreado en formato acad.pat: [ángulo, origen x, origen y, desplazamiento, separación, ...trazos]
import * as G from './geom.js';

export const PATTERNS = {
  SOLID: { desc: 'Relleno sólido', fam: [] },
  ANSI31: { desc: 'ANSI31 · hierro, ladrillo, piedra', fam: [[45, 0, 0, 0, 3.175]] },
  ANSI32: { desc: 'ANSI32 · acero', fam: [[45, 0, 0, 0, 9.525], [45, 4.49013, 0, 0, 9.525]] },
  ANSI37: { desc: 'ANSI37 · plomo, cinc, magnesio', fam: [[45, 0, 0, 0, 3.175], [135, 0, 0, 0, 3.175]] },
  NET: { desc: 'NET · malla', fam: [[0, 0, 0, 0, 3.175], [90, 0, 0, 0, 3.175]] },
  LINE: { desc: 'LINE · líneas paralelas', fam: [[0, 0, 0, 0, 3.175]] },
  DASH: { desc: 'DASH · trazos', fam: [[0, 0, 0, 3.175, 3.175, 3.175, -3.175]] },
  BRICK: { desc: 'BRICK · ladrillo', fam: [[0, 0, 0, 0, 6.35], [90, 0, 0, 6.35, 6.35, 6.35, -6.35]] },
  CROSS: { desc: 'CROSS · cruces', fam: [[0, 0, 0, 6.35, 6.35, 3.175, -9.525], [90, 1.5875, -1.5875, 6.35, 6.35, 3.175, -9.525]] },
  DOTS: { desc: 'DOTS · puntos', fam: [[0, 0, 0, 0.79375, 1.5875, 0, -1.5875]] },
  EARTH: { desc: 'EARTH · tierra', fam: [
    [0, 0, 0, 6.35, 6.35, 6.35, -6.35], [0, 0, 2.38125, 6.35, 6.35, 6.35, -6.35], [0, 0, 4.7625, 6.35, 6.35, 6.35, -6.35],
    [90, 0.79375, 5.55625, 6.35, 6.35, 6.35, -6.35], [90, 3.175, 5.55625, 6.35, 6.35, 6.35, -6.35], [90, 5.55625, 5.55625, 6.35, 6.35, 6.35, -6.35]] },
};

// Familias de líneas del patrón de un sombreado, ya giradas y escaladas
export function famsOf(e) {
  const pat = PATTERNS[e.pattern] || PATTERNS.ANSI31, A = G.rad(e.angle || 0), S = e.scale || 1;
  return pat.fam.map(([ang, ox, oy, dx, dy, ...dash]) => {
    const a = G.rad(ang) + A, u = G.P(Math.cos(a), Math.sin(a));
    return { ang: a, u, n: G.perp(u), o: G.mul(G.rot(G.P(ox, oy), A), S), dx: dx * S, dy: dy * S, dash: dash.map(d => d * S), base: [ang, ox, oy, dx, dy, ...dash] };
  });
}

// Líneas de una familia que cubren el rectángulo bb. Cada línea empieza en un inicio de patrón.
export function famLines(f, bb, maxLines = 4000) {
  const dy = f.dy;
  if (Math.abs(dy) < 1e-9) return null;
  const cs = [G.P(bb.x1, bb.y1), G.P(bb.x2, bb.y1), G.P(bb.x2, bb.y2), G.P(bb.x1, bb.y2)];
  const ns = cs.map(p => G.dot(G.sub(p, f.o), f.n) / dy);
  const k0 = Math.floor(Math.min(...ns)), k1 = Math.ceil(Math.max(...ns));
  if (k1 - k0 > maxLines) return null;
  const L = f.dash.reduce((a, b) => a + Math.abs(b), 0), out = [];
  for (let k = k0; k <= k1; k++) {
    const B = G.add(f.o, G.add(G.mul(f.n, k * dy), G.mul(f.u, k * f.dx)));
    const us = cs.map(p => G.dot(G.sub(p, B), f.u));
    let t0 = Math.min(...us);
    const t1 = Math.max(...us);
    if (L > 0) t0 = Math.floor(t0 / L) * L;
    out.push({ a: G.add(B, G.mul(f.u, t0)), b: G.add(B, G.mul(f.u, t1)) });
  }
  return out;
}

// Segmentos reales (recortados con par-impar y troceados por trazos) de un sombreado de patrón
export function hatchSegments(e, bb, maxLines = 20000) {
  if (e.pattern === 'SOLID') return [];
  const edges = [];
  for (const loop of e.loops) for (let i = 0; i < loop.length; i++) edges.push([loop[i], loop[(i + 1) % loop.length]]);
  const out = [];
  for (const f of famsOf(e)) {
    const lines = famLines(f, bb, maxLines);
    if (!lines) continue;
    for (const { a, b } of lines) {
      const len = G.dist(a, b);
      if (len < 1e-12) continue;
      const ts = [];
      for (const [p, q] of edges) { const r = G.llInt(a, b, p, q); if (r && r.u >= 0 && r.u < 1 && r.t >= 0 && r.t <= 1) ts.push(r.t * len); }
      ts.sort((x, y) => x - y);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const s = ts[i], t = ts[i + 1];
        if (!f.dash.length) { out.push([G.add(a, G.mul(f.u, s)), G.add(a, G.mul(f.u, t))]); continue; }
        const L = f.dash.reduce((x, y) => x + Math.abs(y), 0);
        let pos = Math.floor(s / L) * L, guard = 0;
        while (pos < t && guard++ < 100000) {
          for (const d of f.dash) {
            const len2 = Math.abs(d);
            if (d >= 0) {
              const x0 = Math.max(pos, s), x1 = Math.min(pos + len2, t);
              if (x1 >= x0 && (d > 0 ? x1 > x0 : pos >= s && pos <= t)) out.push([G.add(a, G.mul(f.u, x0)), G.add(a, G.mul(f.u, d > 0 ? x1 : x0))]);
            }
            pos += len2;
            if (pos >= t) break;
          }
        }
      }
    }
  }
  return out;
}
