// Geoprocesos métricos puros. Se ejecutan en el worker con coordenadas pequeñas; no modifican el documento.
import * as G from './geom.js';
import { booleanLoops } from './region.js';
import { typed } from './gis.js';
const EPS = 1e-7;
const copy = o => structuredClone(o);
const areaRing = ps => { if (!ps.length) return 0; const o = ps[0]; return ps.reduce((sum, p, i) => { const q = ps[(i + 1) % ps.length]; return sum + (p.x - o.x) * (q.y - o.y) - (q.x - o.x) * (p.y - o.y); }, 0) / 2; };
export const areaOf = paths => paths.reduce((sum, p) => sum + areaRing(p), 0);
export function bounds(f) { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const path of f.paths) for (const p of path) { x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x); y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y); } return { x1, y1, x2, y2 }; }
const overlap = (a, b) => a.x1 <= b.x2 + EPS && a.x2 + EPS >= b.x1 && a.y1 <= b.y2 + EPS && a.y2 + EPS >= b.y1;
const expanded = (b, d) => ({ x1: b.x1 - d, y1: b.y1 - d, x2: b.x2 + d, y2: b.y2 + d });
const edges = f => f.paths.flatMap(ps => ps.slice(0, f.kind === 'polygon' ? ps.length : ps.length - 1).map((p, i) => [p, ps[(i + 1) % ps.length]]));
const onSegment = (p, a, b) => G.dist(p, G.nearSeg(p, a, b).p) <= EPS;
function location(p, polygon) {
  if (edges(polygon).some(([a, b]) => onSegment(p, a, b))) return 0;
  return polygon.paths.reduce((hit, ring) => hit !== G.pointInPoly(p, ring), false) ? 1 : -1;
}
function cuts(a, b, c, d) {
  const ab = G.sub(b, a), cd = G.sub(d, c), len2 = G.dot(ab, ab), cross = G.cross(ab, cd), out = [];
  if (len2 < EPS * EPS) return onSegment(a, c, d) ? [0] : [];
  if (Math.abs(cross) > 1e-14 * Math.max(1, G.len(ab) * G.len(cd))) {
    const t = G.cross(G.sub(c, a), cd) / cross, u = G.cross(G.sub(c, a), ab) / cross;
    if (t >= -1e-10 && t <= 1 + 1e-10 && u >= -1e-10 && u <= 1 + 1e-10) out.push(Math.max(0, Math.min(1, t)));
  } else if (onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d)) {
    for (const p of [c, d]) { const t = G.dot(G.sub(p, a), ab) / len2; if (t >= -1e-10 && t <= 1 + 1e-10) out.push(Math.max(0, Math.min(1, t))); }
    if (onSegment(a, c, d)) out.push(0); if (onSegment(b, c, d)) out.push(1);
  } return out;
}
export class BoundsIndex {
  constructor(features) {
    const build = items => {
      if (!items.length) return null;
      const b = items.reduce((a, v) => ({ x1: Math.min(a.x1, v.box.x1), y1: Math.min(a.y1, v.box.y1), x2: Math.max(a.x2, v.box.x2), y2: Math.max(a.y2, v.box.y2) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
      if (items.length <= 16) return { b, items };
      const axis = b.x2 - b.x1 > b.y2 - b.y1 ? 'x' : 'y'; items.sort((a, b) => a.box[axis + '1'] + a.box[axis + '2'] - b.box[axis + '1'] - b.box[axis + '2']);
      const mid = items.length >> 1; return { b, children: [build(items.slice(0, mid)), build(items.slice(mid))] };
    }; this.root = build(features.map(f => ({ f, box: bounds(f) })));
  }
  query(box) { const out = [], stack = [this.root]; while (stack.length) { const n = stack.pop(); if (!n || !overlap(box, n.b)) continue; if (n.items) { for (const item of n.items) if (overlap(box, item.box)) out.push(item.f); } else stack.push(...n.children); } return out; }
}
export function polygonBoolean(A, B, operation) {
  if (!A.length) return operation === 'union' ? copy(B) : [];
  if (!B.length) return operation === 'intersect' ? [] : copy(A);
  const a = bounds({ paths: A }), b = bounds({ paths: B });
  if (!overlap(a, b)) return operation === 'intersect' ? [] : operation === 'union' ? copy([...A, ...B]) : copy(A);
  const center = { x: (Math.min(a.x1, b.x1) + Math.max(a.x2, b.x2)) / 2, y: (Math.min(a.y1, b.y1) + Math.max(a.y2, b.y2)) / 2 }, local = paths => paths.map(ps => ({ pts: ps.map(p => G.sub(p, center)) }));
  return booleanLoops(local(A), local(B), operation, { tolerance: 1e-10 }).map(l => l.pts.map(p => G.add(p, center)));
}
export function unionAll(list) {
  let level = list.filter(p => p.length);
  while (level.length > 1) { const next = []; for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? polygonBoolean(level[i], level[i + 1], 'union') : level[i]); level = next; }
  return level[0] || [];
}
export function clipLines(line, polygon, keepInside = true) {
  const result = [], boundary = edges(polygon);
  for (const path of line.paths) {
    let run = [];
    const flush = () => { if (run.length > 1) result.push(run); run = []; };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], ts = [0, 1, ...boundary.flatMap(([c, d]) => cuts(a, b, c, d))].sort((x, y) => x - y).filter((t, j, all) => !j || t - all[j - 1] > 1e-10);
      for (let j = 1; j < ts.length; j++) {
        const start = G.lerp(a, b, ts[j - 1]), end = G.lerp(a, b, ts[j]), loc = location(G.lerp(a, b, (ts[j] + ts[j - 1]) / 2), polygon), keep = keepInside ? loc >= 0 : loc < 0;
        if (keep && G.dist(start, end) > EPS) { if (run.length && G.dist(run.at(-1), start) > EPS) flush(); if (!run.length) run.push(start); run.push(end); } else flush();
      }
    } flush();
  } return result;
}
export function intersects(a, b) {
  if (!overlap(bounds(a), bounds(b))) return false;
  if (a.kind === 'point') { const p = a.paths[0][0]; return b.kind === 'polygon' ? location(p, b) >= 0 : b.kind === 'point' ? G.dist(p, b.paths[0][0]) <= EPS : edges(b).some(([x, y]) => onSegment(p, x, y)); }
  if (b.kind === 'point') return intersects(b, a);
  if (edges(a).some(([x, y]) => edges(b).some(([c, d]) => cuts(x, y, c, d).length))) return true;
  return b.kind === 'polygon' && a.paths.some(ps => ps.some(p => location(p, b) >= 0)) || a.kind === 'polygon' && b.paths.some(ps => ps.some(p => location(p, a) >= 0));
}
export function within(a, b) {
  if (b.kind !== 'polygon') { if (a.kind === 'point' && b.kind === 'point') return intersects(a, b); if (a.kind === 'point' && b.kind === 'line') { const p = a.paths[0][0]; return intersects(a, b) && !b.paths.some(ps => G.dist(p, ps[0]) <= EPS || G.dist(p, ps.at(-1)) <= EPS); } return false; }
  if (a.kind === 'point') return location(a.paths[0][0], b) === 1;
  if (a.kind === 'polygon') return Math.abs(areaOf(polygonBoolean(a.paths, b.paths, 'subtract'))) < EPS * EPS && Math.abs(areaOf(polygonBoolean(a.paths, b.paths, 'intersect'))) > EPS * EPS;
  if (!a.paths.some(ps => ps.some(p => location(p, b) === 1)) && !clipLines(a, b).some(ps => ps.slice(1).some((p, i) => location(G.mid(p, ps[i]), b) === 1))) return false;
  return clipLines(a, b, false).length === 0;
}
export function distance(a, b) {
  if (intersects(a, b)) return 0;
  let min = Infinity;
  const ae = edges(a), be = edges(b), ap = a.paths.flat(), bp = b.paths.flat();
  for (const p of ap) { for (const [x, y] of be) min = Math.min(min, G.dist(p, G.nearSeg(p, x, y).p)); for (const q of bp) min = Math.min(min, G.dist(p, q)); }
  for (const p of bp) for (const [x, y] of ae) min = Math.min(min, G.dist(p, G.nearSeg(p, x, y).p)); return min;
}
export function relates(a, b, predicate, dist = 0) {
  switch (predicate) { case 'intersecta': return intersects(a, b); case 'dentro': return within(a, b); case 'contiene': return within(b, a); case 'separado': return !intersects(a, b); case 'distancia': return distance(a, b) <= dist + EPS; default: throw Error('Relación espacial no admitida.'); }
}
export function buffer(feature, d, segments = 48) {
  if (!Number.isFinite(d) || d === 0 || !Number.isInteger(segments) || segments < 12 || segments > 256) throw Error('Distancia distinta de cero y resolución de 12–256 lados requeridas.');
  if (d < 0 && feature.kind !== 'polygon') throw Error('Sólo los polígonos admiten áreas de influencia negativas.');
  const radius = Math.abs(d), circle = p => [Array.from({ length: segments }, (_, i) => G.polar(p, G.TAU * i / segments, radius))];
  if (feature.kind === 'point') return circle(feature.paths[0][0]);
  if (edges(feature).length * (segments + 2) > 250000) throw Error('El buffer supera el presupuesto de vértices; reduzca la resolución o divida la geometría.');
  const shapes = edges(feature).filter(([a, b]) => G.dist(a, b) > EPS).map(([a, b]) => {
    const angle = G.ang(a, b), half = Math.ceil(segments / 2), points = [];
    for (let i = 0; i <= half; i++) points.push(G.polar(b, angle - Math.PI / 2 + Math.PI * i / half, radius));
    for (let i = 0; i <= half; i++) points.push(G.polar(a, angle + Math.PI / 2 + Math.PI * i / half, radius)); return [points];
  });
  const rim = unionAll(shapes); return feature.kind === 'polygon' ? polygonBoolean(feature.paths, rim, d > 0 ? 'union' : 'subtract') : rim;
}
function fieldLayout(A, B, prefix) {
  const used = new Set(['__proto__', 'constructor', 'prototype', ...A.flatMap(f => Object.keys(f.data))]), right = new Map(), meta = {};
  const free = base => { let name = base, i = 2; while (used.has(name)) name = base + '_' + i++; used.add(name); return name; };
  for (const name of new Set(B.flatMap(f => Object.keys(f.data)))) right.set(name, free((prefix || 'b_') + name));
  for (const key of ['origen_a', 'origen_b', 'proceso', 'cantidad', 'distancia_m', 'resolucion']) meta[key] = free('_sig_' + key); const types = new Map(); for (const f of B) for (const [name, type] of Object.entries(f.types)) if (!types.has(name)) types.set(name, type); return { right, meta, types };
}
function attributeMatch(f, conditions, logic) {
  if (!conditions?.length) return true;
  const tests = conditions.map(c => { const a = f.data[c.field] ?? null, b = typed(c.value, f.types[c.field] || 'texto'); switch (c.op) { case '=': return a === b; case '≠': return a !== b; case '>': return a != null && b != null && a > b; case '<': return a != null && b != null && a < b; case '≥': return a != null && b != null && a >= b; case '≤': return a != null && b != null && a <= b; case 'contiene': return String(a ?? '').toLocaleLowerCase().includes(String(b ?? '').toLocaleLowerCase()); default: throw Error('Operador de consulta no admitido.'); } });
  return logic === 'o' ? tests.some(Boolean) : tests.every(Boolean);
}
function validateFeature(f) {
  if (!['point', 'line', 'polygon'].includes(f.kind) || !Array.isArray(f.paths) || !f.paths.length || f.paths.some(ps => ps.length < (f.kind === 'polygon' ? 3 : f.kind === 'line' ? 2 : 1) || ps.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw Error(`Geometría inválida en el objeto ${f.id}.`);
  if (Object.keys(f.data).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw Error('Atributo reservado no admitido.');
  if (f.kind !== 'polygon') return;
  for (const ring of f.paths) {
    if (Math.abs(areaRing(ring)) < EPS * EPS) throw Error(`Anillo sin área o autointersecado en el objeto ${f.id}.`);
    const segments = ring.map((a, i) => ({ id: i, paths: [[a, ring[(i + 1) % ring.length]]] })), index = new BoundsIndex(segments);
    for (const segment of segments) for (const other of index.query(bounds(segment))) {
      const i = segment.id, j = other.id; if (j <= i || j === i + 1 || i === 0 && j === ring.length - 1) continue;
      if (cuts(...segment.paths[0], ...other.paths[0]).length) throw Error(`Polígono autointersecado en el objeto ${f.id}; repare el contorno antes de calcular.`);
    }
    if (areaRing(ring) < 0 && !f.paths.some(outer => areaRing(outer) > 0 && G.pointInPoly(ring[0], outer))) throw Error(`Hueco sin contorno exterior en el objeto ${f.id}.`);
  }
}
export function vectorProcess(job, progress = () => {}) {
  const { operation, A = [], B = [], options = {} } = job, index = new BoundsIndex(B), output = [], layout = fieldLayout(A, B, options.prefix), ids = []; let outputVertices = 0, comparisons = 0;
  for (const f of [...A, ...B]) validateFeature(f);
  if (['interseccion', 'recorte', 'union', 'diferencia', 'enlace'].includes(operation) && !B.length) throw Error('La capa de referencia no contiene objetos.');
  if (!A.length) throw Error('No hay objetos de entrada compatibles.');
  if (['interseccion', 'recorte', 'union', 'diferencia'].includes(operation) && B.some(f => f.kind !== 'polygon')) throw Error('La capa de referencia debe contener sólo polígonos.');
  if (['union', 'disolver'].includes(operation) && A.some(f => f.kind !== 'polygon')) throw Error('Esta operación requiere polígonos.');
  if (operation === 'consulta') for (const c of options.conditions || []) if (!A.some(f => Object.hasOwn(f.types, c.field))) throw Error(`Campo de consulta inexistente: ${c.field}`);
  if (options.predicate === 'distancia' && !(Number.isFinite(options.distance) && options.distance >= 0)) throw Error('Distancia de consulta inválida.');
  const metadata = (a, b, kind, paths, count = null) => {
    const data = { ...(a?.data || {}) }, types = { ...(a?.types || {}) };
    if (operation !== 'recorte' && ['interseccion', 'union', 'enlace'].includes(operation)) for (const [name, mapped] of layout.right) { data[mapped] = b?.data?.[name] ?? null; types[mapped] = b?.types?.[name] || layout.types.get(name) || 'texto'; }
    for (const [k, v, t] of [['origen_a', a?.id ?? null, 'entero'], ['origen_b', b?.id ?? null, 'entero'], ['proceso', operation, 'texto'], ['cantidad', count, 'entero']]) { data[layout.meta[k]] = v; types[layout.meta[k]] = t; }
    if (operation === 'buffer') { data[layout.meta.distancia_m] = options.distance; types[layout.meta.distancia_m] = 'real'; data[layout.meta.resolucion] = options.segments ?? 48; types[layout.meta.resolucion] = 'entero'; }
    return { kind, paths, data, types, copySource: operation === 'enlace' ? a?.id : null };
  };
  const add = (a, b, kind, paths, count) => { if (paths.length && (kind !== 'polygon' || Math.abs(areaOf(paths)) > EPS * EPS)) { outputVertices += paths.reduce((n, ps) => n + ps.length, 0); if (outputVertices > 250000) throw Error('El resultado supera 250 000 vértices; divida la operación.'); output.push(metadata(a, b, kind, paths, count)); } };
  const filter = (a, p, inside = true) => !a.paths.length ? [] : a.kind === 'polygon' ? polygonBoolean(a.paths, p.paths, inside ? 'intersect' : 'subtract') : a.kind === 'line' ? clipLines(a, p, inside) : (location(a.paths[0][0], p) >= 0) === inside ? a.paths : [];
  if (operation === 'disolver') {
    const groups = new Map();
    for (const f of A) { if (options.field && !Object.hasOwn(f.types, options.field)) throw Error('Campo de disolución inexistente.'); const value = options.field ? f.data[options.field] ?? null : null, key = JSON.stringify([typeof value, value]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(f); }
    let done = 0; for (const list of groups.values()) { const base = copy(list[0]); for (const key of Object.keys(base.data)) if (!list.every(f => f.data[key] === base.data[key])) base.data[key] = null; add(base, null, 'polygon', unionAll(list.map(f => f.paths)), list.length); progress(++done / groups.size); }
    return { features: output };
  }
  for (let i = 0; i < A.length; i++) {
    const a = A[i], candidates = index.query(expanded(bounds(a), options.predicate === 'distancia' ? options.distance : 0));
    comparisons += options.predicate === 'separado' ? B.length : candidates.length; if (comparisons > 2000000) throw Error('Más de dos millones de comparaciones; reduzca las capas o divida el lote.');
    if (operation === 'buffer') add(a, null, 'polygon', buffer(a, options.distance, options.segments ?? 48));
    else if (operation === 'consulta' || operation === 'enlace') {
      const matches = (options.predicate === 'separado' ? B : candidates).filter(b => relates(a, b, options.predicate || 'intersecta', options.distance)).sort((a, b) => a.id - b.id);
      if (operation === 'consulta') { const spatial = !options.predicate || (options.predicate === 'separado' ? matches.length === B.length : matches.length > 0); if (attributeMatch(a, options.conditions, options.logic) && spatial) ids.push(a.id); }
      else if (options.join === 'todos') { if (!matches.length && options.keepUnmatched !== false) add(a, null, a.kind, a.paths, 0); for (const b of matches) add(a, b, a.kind, a.paths, matches.length); }
      else if (matches.length || options.keepUnmatched !== false) add(a, options.join === 'cantidad' ? null : matches[0], a.kind, a.paths, matches.length);
    } else if (operation === 'interseccion') { for (const b of candidates) add(a, b, a.kind, filter(a, b)); }
    else if (operation === 'recorte') { const mask = { kind: 'polygon', paths: unionAll(candidates.map(b => b.paths)) }; if (mask.paths.length) add(a, null, a.kind, filter(a, mask)); }
    else if (operation === 'diferencia' || operation === 'union') {
      let paths = a.paths; for (const b of candidates) paths = filter({ ...a, paths }, b, false);
      add(a, null, a.kind, paths);
      if (operation === 'union') for (const b of candidates) add(a, b, 'polygon', polygonBoolean(a.paths, b.paths, 'intersect'));
    } else throw Error('Geoproceso no admitido.');
    progress((i + 1) / (A.length + (operation === 'union' ? B.length : 0)));
  }
  if (operation === 'union') {
    const ai = new BoundsIndex(A); B.forEach((b, i) => { let paths = b.paths; for (const a of ai.query(bounds(b))) paths = polygonBoolean(paths, a.paths, 'subtract'); add(null, b, 'polygon', paths); progress((A.length + i + 1) / (A.length + B.length)); });
  }
  return operation === 'consulta' ? { ids } : { features: output };
}
