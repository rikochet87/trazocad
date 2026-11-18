import { surveyLabel } from './survey.js';
// Datos SIG del documento. Geometría CAD editable, atributos tipados y reglas de representación por capa.
import { transform, resolveCRS } from './projections.js';
import { fromProjected, toProjected } from './geographic.js';
import { bboxOf, plPolygon } from './entities.js';
import { orient, loopArea } from './region.js';
export const emptyGIS = () => ({ schemas: {}, themes: {}, labels: {}, next: 1 });
const copy = v => JSON.parse(JSON.stringify(v));
export const fieldTypes = ['texto', 'entero', 'real', 'logico', 'fecha'];
export function typed(value, type) {
  if (value == null || value === '') return null;
  if (type === 'texto') return String(value);
  if (type === 'logico') { if ([true, 'true', 'sí', 'si', '1', 1].includes(value)) return true; if ([false, 'false', 'no', '0', 0].includes(value)) return false; throw Error('Indique sí/no o true/false.'); }
  if (type === 'fecha') { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value) throw Error('Fecha inválida (AAAA-MM-DD).'); return value; }
  const n = Number(value); if (!Number.isFinite(n) || type === 'entero' && !Number.isSafeInteger(n)) throw Error(`Valor ${type} inválido.`); return n;
}
export function addField(doc, layer, field) {
  if (!fieldTypes.includes(field.type) || !field.name || ['__proto__', 'constructor', 'prototype'].includes(field.name)) throw Error('Campo o tipo inválido.');
  const schema = doc.gis.schemas[layer] || [];
  if (schema.some(f => f.name === field.name)) throw Error('El campo ya existe.');
  const value = typed(field.default, field.type), edits = doc.model.filter(e => e.layer === layer).map(e => [e.id, Object.hasOwn(e.data || {}, field.name) ? typed(e.data[field.name], field.type) : value]);
  doc.gis.schemas[layer] = schema; schema.push({ name: field.name, type: field.type });
  for (const [id, value] of edits) doc.modify(id, e => { e.data = { ...e.data, [field.name]: value }; }); doc.changed();
}
export function setValue(doc, ids, field, value) {
  const rows = ids.map(id => doc.get(id)).filter(Boolean), schemas = new Map([...new Set(rows.map(e => e.layer))].map(layer => [layer, schemaFor(doc, layer)])), edits = rows.map(e => { const f = schemas.get(e.layer).find(f => f.name === field); if (!f) throw Error(`Campo ${field} no definido en ${e.layer}.`); return [e.id, typed(value, f.type)]; });
  for (const [id, v] of edits) doc.modify(id, e => { e.data = { ...e.data, [field]: v }; });
}
export function queryRows(doc, { layer, field, op = '=', value = '', text = '' } = {}) {
  const schemas = new Map();
  const fields = name => { if (!schemas.has(name)) schemas.set(name, schemaFor(doc, name)); return schemas.get(name); };
  return doc.model.filter(e => (!layer || e.layer === layer) && (!text || JSON.stringify(e.data || {}).toLocaleLowerCase().includes(text.toLocaleLowerCase())) && (!field || (() => {
    const a = e.data?.[field], f = fields(e.layer).find(f => f.name === field), b = typed(value, f?.type || 'texto');
    switch (op) { case '=': return a === b; case '≠': return a !== b; case '>': return a != null && b != null && a > b; case '<': return a != null && b != null && a < b; case 'contiene': return String(a ?? '').toLocaleLowerCase().includes(String(b ?? '').toLocaleLowerCase()); default: throw Error('Operador no admitido.'); }
  })()));
}
export function validateTheme(theme) {
  if (!theme?.field || !['categorias', 'rangos'].includes(theme.mode)) throw Error('Seleccione un campo y un modo temático.');
  if (!Array.isArray(theme.rules) || theme.rules.some(r => !/^#[\da-f]{6}$/i.test(r.color) || theme.mode === 'rangos' && (!Number.isFinite(+r.min) || !Number.isFinite(+r.max) || +r.min > +r.max))) throw Error('Reglas temáticas inválidas.');
  return copy(theme);
}
export function thematic(doc, e, st) {
  const t = doc.gis?.themes?.[e.layer]; if (!e.data || !t || t.off) return st;
  const v = e.data?.[t.field], rule = t.rules.find(r => t.mode === 'rangos' ? v != null && Number.isFinite(+v) && +v >= +r.min && +v <= +r.max : String(v ?? '') === String(r.value ?? ''));
  return rule ? { ...st, color: rule.color, gisFill: rule.fill !== false } : st;
}
export function labelEntity(doc, e) {
  if (e.topoPoint) return surveyLabel(doc, e);
  const l = doc.gis?.labels?.[e.layer], v = l && !l.off && e.data?.[l.field];
  if (v == null || v === '') return null;
  const b = bboxOf(e); if (!b || !(l.height > 0)) return null;
  return { type: 'text', p: { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }, h: +l.height, text: String(v), align: 'c', rot: 0, layer: e.layer, color: l.color || '#ffffff' };
}
export function importFeatures(doc, collection, { crs = 'EPSG:4326', layer = 'SIG', schemas } = {}) {
  if (!doc.geo) throw Error('Configure GEOGRAPHICLOCATION antes de importar datos SIG.');
  const source = resolveCRS(crs), ents = [], sourceFeatures = collection.type === 'FeatureCollection' ? collection.features : collection.type === 'Feature' ? [collection] : [{ type: 'Feature', geometry: collection, properties: {} }];
  if (!Array.isArray(sourceFeatures)) throw Error('Colección GeoJSON inválida.');
  const point = a => { if (!Array.isArray(a) || a.length < 2 || a.slice(0, Math.min(3, a.length)).some(n => !Number.isFinite(n))) throw Error('Coordenada SIG inválida.'); return fromProjected(doc, transform({ x: a[0], y: a[1], z: a[2] ?? 0 }, source, doc.geo.crs)); };
  function convert(g, props, sourceId) {
    if (!g) return;
    if (g.type === 'GeometryCollection') { for (const q of g.geometries) convert(q, props, sourceId); return; }
    if (props != null && (typeof props !== 'object' || Array.isArray(props) || Object.entries(props).some(([k, v]) => ['__proto__', 'constructor', 'prototype'].includes(k) || v != null && !['string', 'number', 'boolean'].includes(typeof v)))) throw Error('Los atributos deben ser campos escalares de texto, número, lógico o nulo, con nombres válidos.');
    const add = e => ents.push({ ...e, layer, data: copy(props || {}), gisSourceId: sourceId ?? null });
    switch (g.type) {
      case 'Point': { const p = point(g.coordinates); add({ type: 'point', p: { x: p.x, y: p.y }, elev: p.z }); break; }
      case 'MultiPoint': for (const p of g.coordinates) convert({ type: 'Point', coordinates: p }, props, sourceId); break;
      case 'LineString': if (g.coordinates.length < 2) throw Error('Línea con menos de dos vértices.'); add({ type: 'pline3d', pts: g.coordinates.map(point) }); break;
      case 'MultiLineString': for (const p of g.coordinates) convert({ type: 'LineString', coordinates: p }, props, sourceId); break;
      case 'Polygon': {
        const loops = g.coordinates.map((r, i) => { if (r.length < 4 || r[0][0] !== r.at(-1)[0] || r[0][1] !== r.at(-1)[1]) throw Error('Anillo de polígono abierto o incompleto.'); return orient({ pts: r.slice(0, -1).map(point) }, i ? -1 : 1); });
        if (loops.length) add({ type: 'region', loops }); break;
      }
      case 'MultiPolygon': for (const p of g.coordinates) convert({ type: 'Polygon', coordinates: p }, props, sourceId); break;
      default: throw Error(`Geometría SIG no admitida: ${g.type}`);
    }
  }
  // Se valida y reproyecta todo antes de modificar el documento: no quedan importaciones parciales.
  for (const f of sourceFeatures) convert(f.geometry, f.properties, f.id);
  const schema = schemas || inferSchema(ents.map(e => e.data));
  for (const e of ents) for (const f of schema) e.data[f.name] = typed(e.data[f.name], f.type);
  const existing = doc.gis.schemas[layer] || [];
  for (const f of schema) { const old = existing.find(q => q.name === f.name); if (old && old.type !== f.type) throw Error(`El tipo del campo ${f.name} no coincide con la capa existente.`); }
  const ownTx = !doc.tx; if (ownTx) doc.begin();
  try {
    if (!doc.layers.some(l => l.name === layer)) doc.addLayer(layer, '#7ac6a2');
    const fields = doc.gis.schemas[layer] ||= [];
    for (const f of schema) { const old = fields.find(q => q.name === f.name); if (old && old.type !== f.type) throw Error(`El tipo del campo ${f.name} no coincide con la capa existente.`); }
    for (const f of schema) if (!fields.some(q => q.name === f.name)) fields.push(copy(f));
    const ids = ents.map(e => doc.add(e, doc.model).id); doc.changed(); return ids;
  } finally { if (ownTx) doc.commit(); }
}
export function inferSchema(rows) {
  const names = [...new Set(rows.flatMap(r => Object.keys(r || {})))];
  return names.map(name => { const vs = rows.map(r => r?.[name]).filter(v => v != null), type = vs.length && vs.every(v => typeof v === 'boolean') ? 'logico' : vs.length && vs.every(v => typeof v === 'number') ? vs.every(Number.isSafeInteger) ? 'entero' : 'real' : 'texto'; return { name, type }; });
}
export function exportFeatures(doc, { crs = 'EPSG:4326', ids, layer } = {}) {
  if (!doc.geo) throw Error('Dibujo sin georreferenciación.');
  const target = resolveCRS(crs), point = p => { const q = transform(toProjected(doc, p), doc.geo.crs, target); return [q.x, q.y, q.z ?? p.z ?? 0]; }, close = ps => [...ps, ps[0]];
  const features = [], omitted = [];
  for (const e of doc.model) {
    if (ids && !ids.includes(e.id) || layer && e.layer !== layer) continue;
    let geometry;
    switch (e.type) {
      case 'point': geometry = { type: 'Point', coordinates: point({ ...e.p, z: e.elev ?? e.p.z ?? 0 }) }; break;
      case 'line': geometry = { type: 'LineString', coordinates: [point({ ...e.p1, z: e.z1 ?? 0 }), point({ ...e.p2, z: e.z2 ?? 0 })] }; break;
      case 'pline': case 'pline3d': { const ps = e.type === 'pline' ? plPolygon(e) : e.pts; geometry = { type: e.closed && ps.length > 2 ? 'Polygon' : 'LineString', coordinates: e.closed && ps.length > 2 ? [close(ps.map(point))] : ps.map(point) }; break; }
      case 'region': {
        const loops = e.loops.map(l => ({ ring: close(plPolygon({ ...l, type: 'pline', closed: true }).map(point)), area: loopArea(l) }));
        const polygons = loops.filter(l => l.area > 0).map(l => [l.ring]);
        const inside = (p, ring) => { let hit = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) && p[0] < (ring[j][0] - ring[i][0]) * (p[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit; return hit; };
        for (const hole of loops.filter(l => l.area <= 0)) { const owners = polygons.filter(p => inside(hole.ring[0], p[0])); if (!owners.length) throw Error('Región con hueco sin contorno exterior.'); owners.sort((a, b) => { const area = ring => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)); return area(a[0]) - area(b[0]); }); owners[0].push(hole.ring); }
        geometry = polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons }; break;
      }
      default: omitted.push(e.id); continue;
    }
    features.push({ type: 'Feature', id: e.id, properties: copy(e.data || {}), geometry });
  }
  return { type: 'FeatureCollection', features, omitted };
}

export function renameGISLayer(doc, before, after) {
  for (const key of ['schemas', 'themes', 'labels']) if (doc.gis?.[key]?.[before]) { doc.gis[key][after] = doc.gis[key][before]; delete doc.gis[key][before]; }
}

// Los atributos acompañan al objeto al cambiar de capa. Los campos sin esquema explícito se infieren para poder editarlos.
export function schemaFor(doc, layer) {
  const known = doc.gis.schemas[layer] || [], extras = inferSchema(doc.model.filter(e => e.layer === layer).map(e => e.data));
  return [...known, ...extras.filter(f => !known.some(k => k.name === f.name))];
}
