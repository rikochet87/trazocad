// Puente CAD ↔ cálculo métrico. La selección se copia antes de trabajar; nunca se modifica la geometría de origen.
import { entityLoops } from './region.js';
import { plPolygon, bboxOf } from './entities.js';
import { resolveCRS, transform } from './projections.js';
import { toProjected, fromProjected } from './geographic.js';
import { schemaFor, inferSchema, typed } from './gis.js';
const pause = () => new Promise(r => setTimeout(r, 0));
export function metricFrame(doc, entities, options = {}) {
  const bb = entities.reduce((b, e) => { const q = bboxOf(e); return { x1: Math.min(b.x1, q.x1), y1: Math.min(b.y1, q.y1), x2: Math.max(b.x2, q.x2), y2: Math.max(b.y2, q.y2) }; }, { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }), center = { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) throw Error('No hay geometría compatible para calcular.');
  const crs = doc.geo && resolveCRS(doc.geo.crs);
  if (crs?.proj === 'longlat') {
    const q = transform(toProjected(doc, center), crs, 'EPSG:4326'), local = resolveCRS({ proj: 'tmerc', lat_0: q.y, lon_0: q.x, datum: 'WGS84' });
    const forward = p => { const ll = transform(toProjected(doc, p), crs, 'EPSG:4326'); if (Math.abs(ll.x - q.x) > 3 || Math.abs(ll.y - q.y) > 3 || Math.abs(ll.y) > 85) throw Error('Para geoprocesos en geográficas use un área local de ±3° y latitudes menores de 85°, o reproyecte el dibujo.'); return transform(ll, 'EPSG:4326', local); };
    return { forward, inverse: p => fromProjected(doc, transform(p, local, crs)), geographic: true, description: 'Proyección métrica local, aproximada; no distancias geodésicas.' };
  }
  const factor = crs ? doc.geo.units * crs.to_meter : options.metersPerUnit ?? 0.0254 / (doc.settings.unitsPerInch || 25.4);
  if (!(factor > 0) || !Number.isFinite(factor)) throw Error('Las unidades deben tener un factor positivo en metros.');
  return { forward: p => ({ x: (p.x - center.x) * factor, y: (p.y - center.y) * factor }), inverse: p => ({ x: center.x + p.x / factor, y: center.y + p.y / factor }), geographic: false, description: crs ? 'Metros del sistema proyectado (no geodésicos).' : `${factor} metros por unidad de dibujo.` };
}
export async function prepareFeatures(doc, entities, frame, signal) {
  const schemas = new Map(), out = []; let vertices = 0;
  for (const e of entities) {
    if (signal?.aborted) throw new DOMException('Proceso cancelado.', 'AbortError');
    let kind, paths;
    if (e.type === 'point') { kind = 'point'; paths = [[e.p]]; }
    else if (e.type === 'line') { kind = 'line'; paths = [[e.p1, e.p2]]; }
    else if (e.type === 'pline3d' && !e.closed || e.type === 'pline' && !e.closed) { kind = 'line'; paths = [e.type === 'pline' ? plPolygon(e) : e.pts]; }
    else if (e.type === 'pline3d' && e.closed) { kind = 'polygon'; paths = [e.pts]; }
    else { const loops = entityLoops(e); if (!loops?.length) throw Error(`Objeto ${e.id}: tipo no admitido para geoprocesos.`); kind = 'polygon'; paths = loops.map(l => plPolygon({ ...l, closed: true })); }
    if (kind === 'polygon') { // Normalizar también las polilíneas 3D cerradas; las regiones ya llevan sus huecos orientados.
      if (e.type !== 'region') paths = paths.map(ps => { const area = ps.reduce((s, p, i) => { const q = ps[(i + 1) % ps.length]; return s + (p.x - ps[0].x) * (q.y - ps[0].y) - (q.x - ps[0].x) * (p.y - ps[0].y); }, 0); return area < 0 ? [...ps].reverse() : ps; });
    }
    const mapped = [];
    for (const ps of paths) {
      const target = [];
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], next = ps[(i + 1) % ps.length], lastOpen = kind !== 'polygon' && i === ps.length - 1;
        const count = frame.geographic && !lastOpen ? Math.min(256, Math.max(1, Math.ceil(Math.hypot(toProjected(doc, p).x - toProjected(doc, next).x, toProjected(doc, p).y - toProjected(doc, next).y) / .02))) : 1;
        for (let j = 0; j < count; j++) { const t = j / count; target.push(frame.forward({ x: p.x + (next.x - p.x) * t, y: p.y + (next.y - p.y) * t })); if (++vertices > 250000) throw Error('El lote supera 250 000 vértices; divida la operación.'); if (vertices % 512 === 0) { await pause(); if (signal?.aborted) throw new DOMException('Proceso cancelado.', 'AbortError'); } }
      } mapped.push(target);
    }
    if (vertices > 250000) throw Error('El lote supera 250 000 vértices; divida la operación.');
    if (!schemas.has(e.layer)) schemas.set(e.layer, Object.fromEntries(schemaFor(doc, e.layer).map(f => [f.name, f.type])));
    out.push({ id: e.id, kind, paths: mapped, data: structuredClone(e.data || {}), types: schemas.get(e.layer) });
  } return out;
}
export async function resultEntities(features, frame, signal, sourceDoc) {
  const entities = []; let count = 0;
  for (const f of features) {
    if (f.copySource != null && sourceDoc) { const original = sourceDoc.get(f.copySource); if (!original) throw Error('El objeto de origen ya no existe.'); entities.push({ ...structuredClone(original), data: f.data }); continue; }
    const paths = [];
    for (const ps of f.paths) { const path = []; for (const p of ps) { path.push(frame.inverse(p)); if (++count % 512 === 0) { await pause(); if (signal?.aborted) throw new DOMException('Proceso cancelado.', 'AbortError'); } } paths.push(path); }
    if (f.kind === 'point') entities.push({ type: 'point', p: paths[0][0], data: f.data });
    else if (f.kind === 'line') for (const pts of paths) entities.push({ type: 'pline', pts, closed: false, data: structuredClone(f.data) });
    else entities.push({ type: 'region', loops: paths.map(pts => ({ pts })), data: f.data });
  }
  const schema = inferSchema(features.map(f => f.data));
  for (const field of schema) { const types = new Set(features.filter(f => Object.hasOwn(f.data, field.name)).map(f => f.types[field.name]).filter(Boolean)); if (types.size === 1) field.type = [...types][0]; else if ([...types].every(t => ['entero', 'real'].includes(t))) field.type = 'real'; }
  for (const e of entities) for (const f of schema) e.data[f.name] = typed(e.data[f.name], f.type);
  return { entities, schema };
}
