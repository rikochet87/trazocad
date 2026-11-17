// Shapefile y dBASE: puntos, multipuntos, líneas y polígonos, incluidas variantes Z. Escritura con índice SHX.
import { inferSchema } from './gis.js';
import { writePRJ, utf8 } from './gisformats.js';
const view = data => { const b = data instanceof Uint8Array ? data : new Uint8Array(data); return new DataView(b.buffer, b.byteOffset, b.byteLength); };
const area = r => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const inside = (p, r) => { let hit = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit; return hit; };
export function readDBF(input, encoding = 'windows-1252') {
  const v = view(input), b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength), decoder = new TextDecoder(encoding), n = v.getUint32(4, true), header = v.getUint16(8, true), stride = v.getUint16(10, true), fields = [];
  if (header < 33 || stride < 1 || header + n * stride > b.length) throw Error('DBF truncado o cabecera inválida.');
  let pos = 1;
  for (let at = 32; at + 32 <= header && b[at] !== 13; at += 32) { const end = b.subarray(at, at + 11).indexOf(0), name = decoder.decode(b.subarray(at, at + (end < 0 ? 11 : end))), code = String.fromCharCode(b[at + 11]), len = b[at + 16], decimals = b[at + 17]; if (!['C', 'N', 'F', 'L', 'D'].includes(code)) throw Error(`Tipo DBF no admitido: ${code}`); fields.push({ name, code, len, pos, decimals, type: code === 'L' ? 'logico' : code === 'D' ? 'fecha' : ['N', 'F'].includes(code) ? decimals ? 'real' : 'entero' : 'texto' }); pos += len; }
  if (pos > stride || new Set(fields.map(f => f.name)).size !== fields.length) throw Error('Campos DBF inconsistentes.');
  const rows = [];
  for (let i = 0; i < n; i++) {
    const at = header + i * stride; if (b[at] === 42) { rows.push(null); continue; }
    const row = {};
    for (const f of fields) { const s = decoder.decode(b.subarray(at + f.pos, at + f.pos + f.len)).trim(); let value = s || null;
      if (s && ['N', 'F'].includes(f.code)) { value = Number(s); if (!Number.isFinite(value)) throw Error('Número DBF inválido.'); }
      if (f.code === 'L') value = /^[YT]$/i.test(s) ? true : /^[NF]$/i.test(s) ? false : null;
      if (f.code === 'D') value = /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null;
      Object.defineProperty(row, f.name, { value, enumerable: true, writable: true, configurable: true });
    } rows.push(row);
  }
  return { rows, schema: fields.map(({ name, type }) => ({ name, type })) };
}
export function writeDBF(rows, schema = inferSchema(rows)) {
  const used = new Set(), map = {}, fields = schema.map(f => {
    let name = f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]/gi, '_').slice(0, 10) || 'CAMPO', base = name, i = 1;
    while (used.has(name.toUpperCase())) { const suffix = String(i++); name = base.slice(0, 10 - suffix.length) + suffix; } used.add(name.toUpperCase()); map[name] = f.name;
    const code = ({ texto: 'C', entero: 'N', real: 'N', logico: 'L', fecha: 'D' })[f.type]; if (!code) throw Error('Tipo de campo DBF inválido.');
    const len = code === 'C' ? rows.reduce((m, r) => Math.max(m, utf8.encode(String(r[f.name] ?? '')).length), 1) : code === 'L' ? 1 : code === 'D' ? 8 : f.type === 'real' ? 24 : 20;
    if (len > 254) throw Error(`Campo ${f.name}: supera 254 bytes DBF.`); return { ...f, dbf: name, code, len, decimals: f.type === 'real' ? 10 : 0 };
  });
  if (fields.length > 255) throw Error('Más de 255 campos DBF.');
  const header = 33 + 32 * fields.length, stride = 1 + fields.reduce((n, f) => n + f.len, 0); if (stride > 65535) throw Error('Registro DBF demasiado grande.');
  const b = new Uint8Array(header + rows.length * stride + 1), v = view(b), date = new Date(); b[0] = 3; b[1] = date.getUTCFullYear() - 1900; b[2] = date.getUTCMonth() + 1; b[3] = date.getUTCDate(); v.setUint32(4, rows.length, true); v.setUint16(8, header, true); v.setUint16(10, stride, true);
  fields.forEach((f, i) => { const at = 32 + i * 32; b.set(utf8.encode(f.dbf), at); b[at + 11] = f.code.charCodeAt(0); b[at + 16] = f.len; b[at + 17] = f.decimals; }); b[header - 1] = 13;
  rows.forEach((row, i) => { let at = header + i * stride; b.fill(32, at, at + stride); at++;
    for (const f of fields) { const value = row[f.name]; let s = value == null ? '' : f.code === 'L' ? value ? 'T' : 'F' : f.code === 'D' ? String(value).replaceAll('-', '') : f.type === 'real' ? Number(value).toFixed(f.decimals) : String(value);
      const bytes = utf8.encode(s); if (bytes.length > f.len) throw Error(`Valor demasiado largo para ${f.name}.`); b.set(bytes, at + (f.code === 'N' ? f.len - bytes.length : 0)); at += f.len; }
  }); b[b.length - 1] = 26; return { bytes: b, fieldMap: map };
}
export function readSHP(input, dbf, encoding) {
  const v = view(input); if (v.byteLength < 100 || v.getInt32(0) !== 9994 || v.getInt32(28, true) !== 1000 || v.getInt32(24) * 2 !== v.byteLength) throw Error('Shapefile inválido o truncado.');
  const table = dbf ? readDBF(dbf, encoding) : null, features = []; let at = 100, index = 0;
  while (at < v.byteLength) {
    if (at + 12 > v.byteLength) throw Error('Registro SHP truncado.'); const size = v.getInt32(at + 4) * 2, start = at + 8, end = start + size, type = v.getInt32(start, true); if (size < 4 || end > v.byteLength) throw Error('Longitud SHP inválida.');
    const rows = table?.rows[index], props = rows || {}; index++; at = end; if (!type || table && rows === null) continue;
    const z = [11, 13, 15, 18].includes(type), base = type % 10; let geometry;
    if (base === 1) { if (size < (z ? 28 : 20)) throw Error('Punto SHP truncado.'); geometry = { type: 'Point', coordinates: [v.getFloat64(start + 4, true), v.getFloat64(start + 12, true), ...(z ? [v.getFloat64(start + 20, true)] : [])] }; }
    else if ([3, 5, 8].includes(base)) {
      const nparts = base === 8 ? 0 : v.getInt32(start + 36, true), n = v.getInt32(start + (base === 8 ? 36 : 40), true), pa = start + (base === 8 ? 40 : 44) + nparts * 4;
      if (n < 0 || nparts < 0 || pa + n * 16 + (z ? 16 + n * 8 : 0) > end) throw Error('Coordenadas SHP truncadas.');
      const ps = Array.from({ length: n }, (_, i) => [v.getFloat64(pa + i * 16, true), v.getFloat64(pa + i * 16 + 8, true), ...(z ? [v.getFloat64(pa + n * 16 + 16 + i * 8, true)] : [])]);
      if (base === 8) geometry = { type: 'MultiPoint', coordinates: ps };
      else {
        const parts = Array.from({ length: nparts }, (_, i) => v.getInt32(start + 44 + i * 4, true)); if (!parts.length || parts[0] !== 0 || parts.some((p, i) => p < 0 || p >= n || i && p <= parts[i - 1])) throw Error('Índice de partes SHP inválido.');
        const rings = parts.map((p, i) => ps.slice(p, parts[i + 1] ?? n));
        if (base === 3) geometry = rings.length === 1 ? { type: 'LineString', coordinates: rings[0] } : { type: 'MultiLineString', coordinates: rings };
        else {
          // Clasificar por inclusión, sin depender del orden de los anillos ni de su orientación de entrada.
          const sorted = rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a))), polygons = [], known = [];
          for (const ring of sorted) { const parent = [...known].reverse().find(q => inside(ring[0], q.ring)), depth = parent ? parent.depth + 1 : 0; if (depth % 2 === 0) { const poly = [ring]; polygons.push(poly); known.push({ ring, depth, poly }); } else { parent.poly.push(ring); known.push({ ring, depth, poly: parent.poly }); } }
          geometry = polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
        }
      }
    } else throw Error(`Tipo SHP no admitido: ${type}`);
    features.push({ type: 'Feature', id: index, properties: props, geometry });
  }
  if (table && table.rows.length !== index) throw Error('SHP y DBF tienen distinto número de registros.');
  return { collection: { type: 'FeatureCollection', features }, schema: table?.schema };
}
export function writeSHP(collection, crs, schema) {
  const families = new Set(collection.features.map(f => f.geometry.type.includes('Point') ? 1 : f.geometry.type.includes('Line') ? 3 : f.geometry.type.includes('Polygon') ? 5 : 0));
  if (families.size !== 1 || families.has(0)) throw Error('Cada Shapefile necesita una única familia: puntos, líneas o polígonos.');
  const base = [...families][0], records = [], all = [], rows = [];
  const push = (g, props) => {
    if (g.type === 'MultiPoint') { for (const p of g.coordinates) push({ type: 'Point', coordinates: p }, props); return; }
    let rings = base === 1 ? [[g.coordinates]] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : g.coordinates.flatMap(p => p);
    if (base === 5) { rings = g.type === 'MultiPolygon' ? g.coordinates.flatMap(poly => poly.map((r, i) => (area(r) < 0) === (i === 0) ? r : [...r].reverse())) : rings.map((r, i) => (area(r) < 0) === (i === 0) ? r : [...r].reverse()); }
    const ps = rings.flat(); for (const p of ps) all.push(p); rows.push(props || {});
    const n = ps.length, size = base === 1 ? 28 : 44 + rings.length * 4 + n * 16 + 16 + n * 8, b = new Uint8Array(size), v = view(b); v.setInt32(0, base + 10, true);
    if (base === 1) { v.setFloat64(4, ps[0][0], true); v.setFloat64(12, ps[0][1], true); v.setFloat64(20, ps[0][2] ?? 0, true); }
    else { box(v, 4, ps); v.setInt32(36, rings.length, true); v.setInt32(40, n, true); let count = 0; rings.forEach((r, i) => { v.setInt32(44 + i * 4, count, true); count += r.length; }); const at = 44 + rings.length * 4; ps.forEach((p, i) => { v.setFloat64(at + i * 16, p[0], true); v.setFloat64(at + i * 16 + 8, p[1], true); }); const zs = ps.map(p => p[2] ?? 0); v.setFloat64(at + n * 16, zs.reduce((a, b) => Math.min(a, b), Infinity), true); v.setFloat64(at + n * 16 + 8, zs.reduce((a, b) => Math.max(a, b), -Infinity), true); zs.forEach((z, i) => v.setFloat64(at + n * 16 + 16 + i * 8, z, true)); }
    records.push(b);
  };
  collection.features.forEach(f => push(f.geometry, f.properties));
  const length = 100 + records.reduce((n, r) => n + r.length + 8, 0), shp = new Uint8Array(length), shx = new Uint8Array(100 + records.length * 8);
  for (const b of [shp, shx]) { const v = view(b); v.setInt32(0, 9994); v.setInt32(24, b.length / 2); v.setInt32(28, 1000, true); v.setInt32(32, base + 10, true); box(v, 36, all); }
  let at = 100; records.forEach((r, i) => { const v = view(shp); v.setInt32(at, i + 1); v.setInt32(at + 4, r.length / 2); shp.set(r, at + 8); const x = view(shx); x.setInt32(100 + i * 8, at / 2); x.setInt32(104 + i * 8, r.length / 2); at += r.length + 8; });
  const dbf = writeDBF(rows, schema); return { 'datos.shp': shp, 'datos.shx': shx, 'datos.dbf': dbf.bytes, 'datos.prj': writePRJ(crs), 'datos.cpg': 'UTF-8', 'campos.json': JSON.stringify(dbf.fieldMap, null, 2) };
}
function box(v, at, ps) { if (!ps.length) return; const b = ps.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]); b.forEach((x, i) => v.setFloat64(at + i * 8, x, true)); }
