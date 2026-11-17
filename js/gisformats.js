// Intercambio vectorial y contenedores ZIP/KMZ, sin bibliotecas externas.
import { inferSchema } from './gis.js';
import { resolveCRS } from './projections.js';
export const utf8 = new TextEncoder();
const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
export function readGeoJSON(src) {
  const o = typeof src === 'string' ? JSON.parse(src) : src;
  if (!o || !['FeatureCollection', 'Feature', 'Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection'].includes(o.type)) throw Error('GeoJSON inválido.');
  if (o.crs) throw Error('GeoJSON con CRS antiguo: elija el sistema de origen explícitamente y quite el miembro crs.');
  return o;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function readKML(src) {
  const xml = new DOMParser().parseFromString(src, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length || /<!DOCTYPE/i.test(src)) throw Error('KML inválido o con declaración de entidades.');
  const all = (el, tag) => [...el.getElementsByTagNameNS('*', tag)], first = (el, tag) => all(el, tag)[0]?.textContent || '';
  const schemas = new Map(all(xml, 'Schema').map(s => [s.getAttribute('id'), new Map(all(s, 'SimpleField').map(f => [f.getAttribute('name'), f.getAttribute('type')]))]));
  const coords = el => first(el, 'coordinates').trim().split(/\s+/).filter(Boolean).map(v => { const p = v.split(',').map(Number); if (p.length < 2 || p.some(n => !Number.isFinite(n))) throw Error('Coordenadas KML inválidas.'); return p; });
  const geometry = el => {
    switch (el.localName) {
      case 'Point': return { type: 'Point', coordinates: coords(el)[0] };
      case 'LineString': return { type: 'LineString', coordinates: coords(el) };
      case 'Polygon': return { type: 'Polygon', coordinates: [coords(all(el, 'outerBoundaryIs')[0]), ...all(el, 'innerBoundaryIs').map(coords)] };
      case 'MultiGeometry': return { type: 'GeometryCollection', geometries: [...el.children].map(geometry).filter(Boolean) };
      default: return null;
    }
  };
  return { type: 'FeatureCollection', features: all(xml, 'Placemark').map(pm => {
    const properties = { nombre: first(pm, 'name'), descripcion: first(pm, 'description') };
    for (const d of all(pm, 'Data')) properties[d.getAttribute('name')] = first(d, 'value');
    for (const schemaData of all(pm, 'SchemaData')) { const schema = schemas.get((schemaData.getAttribute('schemaUrl') || '').replace(/^#/, '')); for (const d of all(schemaData, 'SimpleData')) { const name = d.getAttribute('name'), type = schema?.get(name), text = d.textContent; let value = text; if (['int', 'uint', 'short', 'ushort', 'float', 'double'].includes(type)) { value = Number(text); if (!Number.isFinite(value)) throw Error('Número KML inválido.'); } else if (type === 'bool') { if (!['0', '1', 'true', 'false'].includes(text)) throw Error('Lógico KML inválido.'); value = text === '1' || text === 'true'; } Object.defineProperty(properties, name, { value, writable: true, enumerable: true, configurable: true }); } }
    const geometries = [...pm.children].map(geometry).filter(Boolean);
    return { type: 'Feature', properties, geometry: geometries.length === 1 ? geometries[0] : { type: 'GeometryCollection', geometries } };
  }) };
}
export function writeKML(fc) {
  const schema = inferSchema(fc.features.map(f => f.properties)), types = { texto: 'string', entero: 'double', real: 'double', logico: 'bool', fecha: 'string' };
  const co = p => p.join(','), seq = ps => ps.map(co).join(' ');
  function geom(g) {
    switch (g.type) {
      case 'Point': return `<Point><coordinates>${co(g.coordinates)}</coordinates></Point>`;
      case 'LineString': return `<LineString><coordinates>${seq(g.coordinates)}</coordinates></LineString>`;
      case 'Polygon': return `<Polygon>${g.coordinates.map((r, i) => `<${i ? 'inner' : 'outer'}BoundaryIs><LinearRing><coordinates>${seq(r)}</coordinates></LinearRing></${i ? 'inner' : 'outer'}BoundaryIs>`).join('')}</Polygon>`;
      default: { const types = { MultiPoint: 'Point', MultiLineString: 'LineString', MultiPolygon: 'Polygon' }, gs = g.type === 'GeometryCollection' ? g.geometries : g.coordinates.map(coordinates => ({ type: types[g.type], coordinates })); return `<MultiGeometry>${gs.map(geom).join('')}</MultiGeometry>`; }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Schema id="trazocad">${schema.map(f => `<SimpleField name="${esc(f.name)}" type="${types[f.type] || 'string'}"/>`).join('')}</Schema>${fc.features.map(f => `<Placemark><name>${esc(f.properties?.nombre ?? f.id)}</name><ExtendedData><SchemaData schemaUrl="#trazocad">${Object.entries(f.properties || {}).filter(([, v]) => v != null).map(([k, v]) => `<SimpleData name="${esc(k)}">${esc(v)}</SimpleData>`).join('')}</SchemaData></ExtendedData>${geom(f.geometry)}</Placemark>`).join('')}</Document></kml>`;
}
let crcTable;
export function crc32(bytes) {
  crcTable ||= Array.from({ length: 256 }, (_, i) => { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
  let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0;
}
export function writeZIP(files) {
  const entries = Object.entries(files).map(([name, value]) => ({ name: utf8.encode(name), data: typeof value === 'string' ? utf8.encode(value) : new Uint8Array(value), offset: 0 }));
  let offset = 0; const parts = [];
  for (const e of entries) { e.offset = offset; const h = new Uint8Array(30 + e.name.length), v = new DataView(h.buffer); v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true); v.setUint16(12, 33, true); v.setUint32(14, crc32(e.data), true); v.setUint32(18, e.data.length, true); v.setUint32(22, e.data.length, true); v.setUint16(26, e.name.length, true); h.set(e.name, 30); parts.push(h, e.data); offset += h.length + e.data.length; }
  const start = offset;
  for (const e of entries) { const h = new Uint8Array(46 + e.name.length), v = new DataView(h.buffer); v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x800, true); v.setUint16(14, 33, true); v.setUint32(16, crc32(e.data), true); v.setUint32(20, e.data.length, true); v.setUint32(24, e.data.length, true); v.setUint16(28, e.name.length, true); v.setUint32(42, e.offset, true); h.set(e.name, 46); parts.push(h); offset += h.length; }
  const end = new Uint8Array(22), v = new DataView(end.buffer); v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true); v.setUint32(12, offset - start, true); v.setUint32(16, start, true); parts.push(end);
  const out = new Uint8Array(offset + 22); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out;
}
export async function readZIP(input, maxBytes = 128 * 1024 * 1024) {
  const bytes = new Uint8Array(input), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('ZIP sin directorio final.');
  if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) throw Error('ZIP dividido no admitido.');
  const files = Object.create(null); let at = v.getUint32(end + 16, true), total = 0;
  for (let i = 0; i < v.getUint16(end + 10, true); i++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw Error('Directorio ZIP inválido.');
    const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true), packed = v.getUint32(at + 20, true), size = v.getUint32(at + 24, true), nl = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true), local = v.getUint32(at + 42, true), crc = v.getUint32(at + 16, true), name = text(bytes.subarray(at + 46, at + 46 + nl));
    if (flags & 1 || size === 0xffffffff || total + size > maxBytes) throw Error('ZIP cifrado, ZIP64 o tamaño descomprimido excesivo.');
    if (name.includes('..') || name.startsWith('/') || name.includes('\\') || Object.hasOwn(files, name)) throw Error('Nombre ZIP ambiguo o no permitido.');
    if (v.getUint32(local, true) !== 0x04034b50) throw Error('Cabecera ZIP inválida.');
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true); if (dataAt + packed > bytes.length) throw Error('Entrada ZIP truncada.');
    let data = bytes.slice(dataAt, dataAt + packed);
    if (method === 8) { const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), chunks = []; let count = 0; for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.length; if (count > size || total + count > maxBytes) { await reader.cancel(); throw Error('ZIP excede el tamaño declarado.'); } chunks.push(value); } data = new Uint8Array(count); let p = 0; for (const chunk of chunks) { data.set(chunk, p); p += chunk.length; } }
    else if (method !== 0) throw Error(`Compresión ZIP no admitida: ${method}`);
    if (data.length !== size || crc32(data) !== crc) throw Error('ZIP con longitud o CRC incorrectos.');
    if (!name.endsWith('/')) files[name] = data; total += size; at += 46 + nl + extra + comment;
  }
  return files;
}
export function writePRJ(value) {
  const c = resolveCRS(value), q = n => JSON.stringify(String(n)), geog = `GEOGCS["Sistema geográfico",DATUM["Datum",SPHEROID["Elipsoide",${c.a},${c.rf}],TOWGS84[${c.towgs84.join(',')}]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]`;
  if (c.proj === 'longlat') return geog;
  const methods = { tmerc: 'Transverse_Mercator', lcc: 'Lambert_Conformal_Conic_2SP', merc: 'Mercator_1SP', webmerc: 'Popular Visualisation Pseudo Mercator', stere: 'Stereographic', sterea: 'Oblique_Stereographic' };
  const params = { latitude_of_origin: c.lat_0, central_meridian: c.lon_0, scale_factor: c.k_0, false_easting: c.x_0 / c.to_meter, false_northing: c.y_0 / c.to_meter, ...(c.lat_1 != null ? { standard_parallel_1: c.lat_1, standard_parallel_2: c.lat_2 ?? c.lat_1 } : {}), ...(c.lat_ts != null ? { latitude_of_standard_parallel: c.lat_ts } : {}) };
  return `PROJCS[${q(c.name || c.proj)},${geog},PROJECTION[${q(methods[c.proj])}],${Object.entries(params).map(([k, v]) => `PARAMETER[${q(k)},${v}]`).join(',')},UNIT["unidad",${c.to_meter}],AXIS["${c.axis === 'neu' ? 'Norte' : 'Este'}",${c.axis === 'neu' ? 'NORTH' : 'EAST'}],AXIS["${c.axis === 'neu' ? 'Este' : 'Norte'}",${c.axis === 'neu' ? 'EAST' : 'NORTH'}]]`;
}
