// Patrones de sombreado en formato acad.pat: [ángulo, origen x, origen y, desplazamiento, separación, ...trazos]
// Además de los predefinidos, el dibujo guarda sus patrones personalizados (doc.patterns, leídos de archivos .pat)
// y admite el patrón «definido por el usuario» (pattern 'USER', e.user = {sp, dbl}): líneas paralelas, opcionalmente cruzadas.
import * as G from './geom.js';

// Documento cuyos patrones personalizados se consultan (lo fija app.js)
export const PAT_ENV = { doc: null };
export const USER_DEFAULT = { sp: 3.175, dbl: false };
// Definición de un patrón por su nombre: personalizado del dibujo o predefinido (null si no existe)
export const patternDef = name => PAT_ENV.doc?.patterns?.[name] || PATTERNS[name] || null;
export const isCustomPattern = name => !!PAT_ENV.doc?.patterns?.[name] && !PATTERNS[name];
// Familias base del patrón definido por el usuario
export const userFams = u => { const { sp, dbl } = { ...USER_DEFAULT, ...u }; return dbl ? [[0, 0, 0, 0, sp], [90, 0, 0, 0, sp]] : [[0, 0, 0, 0, sp]]; };

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

// ---------- Degradados (pattern 'GRADIENT', datos en e.grad = {type, c1, c2, centered, stops}; ángulo en e.angle) ----------
// stops: paradas [[posición 0..1, color], …] de un degradado de varios colores; si falta, se usan c1 → c2
export const GRADIENTS = { LINEAR: 'Lineal', CYLINDER: 'Cilíndrico', INVCYLINDER: 'Cilíndrico invertido', SPHERICAL: 'Esférico', INVSPHERICAL: 'Esférico invertido', HEMISPHERICAL: 'Semiesférico', INVHEMISPHERICAL: 'Semiesférico invertido' };
export const GRAD_DEFAULT = { type: 'LINEAR', c1: '#1e90d6', c2: '#ffffff', centered: true };
// Paradas de color ordenadas (al menos dos)
export function gradStops(g) {
  const s = Array.isArray(g.stops) ? g.stops.filter(x => Array.isArray(x) && Number.isFinite(+x[0]) && typeof x[1] === 'string').map(([t, c]) => [Math.max(0, Math.min(1, +t)), c]) : [];
  return s.length >= 2 ? s.sort((a, b) => a[0] - b[0]) : [[0, g.c1], [1, g.c2]];
}
// Texto editable de las paradas: "0 #ff0000, 0.5 #ffff00, 1 #0000ff" (las posiciones también admiten %)
export const stopsText = g => gradStops(g).map(([t, c]) => `${+(t * 100).toFixed(2)}% ${c}`).join(', ');
export function parseStops(s) {
  const out = [];
  for (const part of String(s).split(/[,;]/)) {
    const m = part.trim().match(/^([\d.]+)\s*(%?)\s+(#[0-9a-f]{6})$/i);
    if (!m) continue;
    out.push([Math.max(0, Math.min(1, +m[1] / (m[2] ? 100 : (+m[1] > 1 ? 100 : 1)))), m[3].toLowerCase()]);
  }
  return out.length >= 2 ? out.sort((a, b) => a[0] - b[0]) : null;
}
// Geometría del degradado en coordenadas del dibujo: {kind: 'linear', p0, p1, stops} o {kind: 'radial', c, r, stops}
export function gradientSpec(e, bb) {
  const g = { ...GRAD_DEFAULT, ...e.grad }, a = G.rad(e.angle || 0), u = G.P(Math.cos(a), Math.sin(a)), n = G.perp(u);
  const C = G.P((bb.x1 + bb.x2) / 2, (bb.y1 + bb.y2) / 2), shift = g.centered === false ? 0.3 : 0;
  const corners = [G.P(bb.x1, bb.y1), G.P(bb.x2, bb.y1), G.P(bb.x2, bb.y2), G.P(bb.x1, bb.y2)];
  const pu = corners.map(q => G.dot(G.sub(q, C), u)), pn = corners.map(q => G.dot(G.sub(q, C), n));
  const lo = Math.min(...pu), hi = Math.max(...pu), half = Math.max(1e-9, Math.hypot(hi - lo, Math.max(...pn) - Math.min(...pn)) / 2);
  // S: paradas del primer color al último; los tipos invertidos las recorren al revés
  const inv = g.type.startsWith('INV'), t = g.type.replace(/^INV/, ''), base = gradStops(g);
  const S = inv ? base.map(([k, c]) => [1 - k, c]).reverse() : base, rev = S.map(([k, c]) => [1 - k, c]).reverse();
  if (t === 'LINEAR') return { kind: 'linear', p0: G.add(C, G.mul(u, lo)), p1: G.add(C, G.mul(u, hi)), stops: base };
  if (t === 'CYLINDER') { // del primer color en los bordes al último en el centro (desplazado si no está centrado)
    const m = 0.5 - shift / 2;
    return { kind: 'linear', p0: G.add(C, G.mul(u, lo)), p1: G.add(C, G.mul(u, hi)), stops: [...S.map(([k, c]) => [k * m, c]), ...rev.slice(1).map(([k, c]) => [m + k * (1 - m), c])] };
  }
  if (t === 'HEMISPHERICAL') { const c0 = G.add(C, G.mul(n, Math.min(...pn))); return { kind: 'radial', c: c0, r: half * 2, stops: rev }; }
  // Esférico: luz en el centro (desplazada hacia arriba a la izquierda si no está centrado)
  const c0 = G.add(C, G.mul(G.add(G.mul(u, -1), n), half * shift));
  return { kind: 'radial', c: c0, r: half * (1 + shift), stops: rev };
}

// Familias de líneas del patrón de un sombreado, ya giradas y escaladas
export function famsOf(e) {
  const fam = e.pattern === 'USER' ? userFams(e.user) : (patternDef(e.pattern) || PATTERNS.ANSI31).fam;
  const A = G.rad(e.angle || 0), S = e.scale || 1;
  return fam.map(([ang, ox, oy, dx, dy, ...dash]) => {
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

// ---------- Archivos .pat ----------
const RESERVED = new Set(['SOLID', 'GRADIENT', 'USER', '_USER']);
// Lee un archivo de patrones de AutoCAD (acad.pat, acadiso.pat o uno propio): «*NOMBRE, descripción» seguido de una línea
// por familia «ángulo, x origen, y origen, desplazamiento, separación[, trazos…]». k: factor de unidades (25,4 si el archivo
// está en pulgadas, como acad.pat). Los nombres de los patrones predefinidos se omiten.
// Devuelve {pats: {NOMBRE: {desc, fam}}, skipped: [nombres omitidos], errors: [texto]}
export function parsePat(text, k = 1) {
  const pats = {}, skipped = [], errors = [];
  let cur = null;
  String(text).replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) return;
    if (line.startsWith('*')) {
      const [name, ...rest] = line.slice(1).split(',');
      const nm = name.trim().toUpperCase();
      cur = null;
      if (!nm || !/^[\wÁÉÍÓÚÑ$\-]+$/i.test(nm)) { errors.push(`línea ${i + 1}: nombre de patrón no válido`); return; }
      if (PATTERNS[nm] || RESERVED.has(nm)) { skipped.push(nm); return; }
      cur = pats[nm] = { desc: rest.join(',').trim(), fam: [] };
      return;
    }
    if (!cur) { if (!skipped.length || !/^[-\d.,\s+e]+$/i.test(line)) errors.push(`línea ${i + 1}: familia fuera de un patrón`); return; }
    const v = line.split(',').map(s => s.trim()).filter(s => s !== '').map(Number);
    if (v.length < 5 || v.some(x => !Number.isFinite(x))) { errors.push(`línea ${i + 1}: familia no válida`); return; }
    if (Math.abs(v[4]) < 1e-12) { errors.push(`línea ${i + 1}: la separación entre líneas no puede ser 0`); return; }
    const [ang, ...rest] = v;
    cur.fam.push([ang, ...rest.map(x => x * k)]);
  });
  for (const [n, p] of Object.entries(pats)) if (!p.fam.length) { delete pats[n]; errors.push(`el patrón ${n} no tiene familias de líneas`); }
  return { pats, skipped, errors };
}
// Texto .pat de un patrón (para exportarlo)
const pn = v => String(+(+v).toFixed(8));
export const patText = (name, p) => [`*${name}${p.desc ? `, ${p.desc}` : ''}`, ...p.fam.map(f => f.map(pn).join(', '))].join('\n');
// Patrón base a partir de familias ya giradas y escaladas (las de un HATCH de DXF): deshace el ángulo A (grados) y la escala S
export function baseFams(fams, A, S) {
  const a = G.rad(A), s = S || 1;
  return fams.map(f => {
    const u = G.P(Math.cos(G.rad(f.ang)), Math.sin(G.rad(f.ang))), n = G.perp(u), o = G.rot(f.o, -a), off = f.off;
    const r = v => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(9)); // sin el ruido de los decimales del DXF
    return [r(f.ang - A), r(o.x / s), r(o.y / s), r(G.dot(off, u) / s), r(G.dot(off, n) / s), ...f.dash.map(d => r(d / s))];
  });
}
