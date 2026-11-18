// GeoTIFF clásico: tiras y teselas, coordenadas afines, RGB/grises/MDT y compresión habitual.
import { resolveCRS, transform } from './projections.js';
import { fromProjected, toProjected } from './geographic.js';
const MAX_PIXELS = 16 * 1024 * 1024;
export const pixelToWorld = (g, x, y) => ({ x: g[0] + g[1] * x + g[2] * y, y: g[3] + g[4] * x + g[5] * y });
export function worldToPixel(g, p) { const d = g[1] * g[5] - g[2] * g[4]; if (Math.abs(d) < 1e-20) throw Error('Transformación raster singular.'); const x = p.x - g[0], y = p.y - g[3]; return { x: (x * g[5] - y * g[2]) / d, y: (y * g[1] - x * g[4]) / d }; }
function lzw(bytes, limit) {
  let bit = 0, width = 9, next = 258, prev, table, out = new Uint8Array(limit), written = 0;
  const reset = () => { table = Array.from({ length: 256 }, (_, i) => [i]); next = 258; width = 9; prev = null; }; reset();
  while (bit + width <= bytes.length * 8) { let code = 0; for (let k = 0; k < width; k++, bit++) code = code * 2 + (bytes[bit >> 3] >> (7 - (bit & 7)) & 1);
    if (code === 256) { reset(); continue; } if (code === 257) break;
    const entry = table[code] || (code === next && prev ? [...prev, prev[0]] : null); if (!entry) throw Error('LZW TIFF inválido.');
    if (written + entry.length > limit) throw Error('LZW excede el tamaño esperado.'); out.set(entry, written); written += entry.length;
    if (prev && next < 4096) { table[next++] = [...prev, entry[0]]; if (next === (1 << width) - 1 && width < 12) width++; } prev = entry;
  } return out.subarray(0, written);
}
async function unpack(bytes, compression, length) {
  if (compression === 1) return bytes;
  if (compression === 5) return lzw(bytes, length);
  if ([8, 32946].includes(compression)) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(), chunks = []; let count = 0;
    for (;;) { const r = await reader.read(); if (r.done) break; count += r.value.length; if (count > length) { await reader.cancel(); throw Error('TIFF descomprimido demasiado grande.'); } chunks.push(r.value); }
    const out = new Uint8Array(count); let at = 0; for (const p of chunks) { out.set(p, at); at += p.length; } return out;
  }
  if (compression === 32773) { const out = new Uint8Array(length); let at = 0; for (let i = 0; i < bytes.length && at < length;) { const n = bytes[i++] << 24 >> 24; if (n >= 0) { if (i + n + 1 > bytes.length || at + n + 1 > length) throw Error('PackBits inválido.'); out.set(bytes.subarray(i, i + n + 1), at); i += n + 1; at += n + 1; } else if (n !== -128) { if (i >= bytes.length || at + 1 - n > length) throw Error('PackBits inválido.'); out.fill(bytes[i++], at, at + 1 - n); at += 1 - n; } } if (at !== length) throw Error('PackBits truncado.'); return out; }
  throw Error(`Compresión TIFF no admitida: ${compression}`);
}
export async function readGeoTIFF(input, overrideCRS, fallbackCRS) {
  const bytes = new Uint8Array(input), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), little = bytes[0] === 73 && bytes[1] === 73;
  if ((!little && !(bytes[0] === 77 && bytes[1] === 77)) || v.getUint16(2, little) !== 42) throw Error('TIFF clásico requerido (BigTIFF no admitido).');
  const ifd = v.getUint32(4, little), n = v.getUint16(ifd, little), tags = {}, sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
  for (let i = 0; i < n; i++) { const at = ifd + 2 + i * 12, tag = v.getUint16(at, little), type = v.getUint16(at + 2, little), count = v.getUint32(at + 4, little), size = sizes[type]; if (!size) continue; const pos = count * size > 4 ? v.getUint32(at + 8, little) : at + 8;
    if (pos + count * size > bytes.length || count > MAX_PIXELS * 4) throw Error('Etiqueta TIFF truncada o excesiva.');
    tags[tag] = type === 2 ? new TextDecoder().decode(bytes.subarray(pos, pos + count)).replace(/\0+$/, '') : Array.from({ length: count }, (_, j) => { const p = pos + j * size; return type === 3 ? v.getUint16(p, little) : type === 4 ? v.getUint32(p, little) : type === 5 ? v.getUint32(p, little) / v.getUint32(p + 4, little) : type === 11 ? v.getFloat32(p, little) : type === 12 ? v.getFloat64(p, little) : bytes[p]; });
  }
  const one = (t, d) => tags[t]?.[0] ?? d, width = one(256), height = one(257), samples = one(277, 1), bits = one(258, 8), format = one(339, 1), photo = one(262, 1), predictor = one(317, 1);
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS || ![1, 3, 4].includes(samples) || ![8, 16, 32].includes(bits) || ![1, 2, 3].includes(format) || format === 3 && bits !== 32 || samples > 1 && bits !== 8 || ![0, 1, 2, 3].includes(photo) || one(284, 1) !== 1 || ![1, 2].includes(predictor) || predictor === 2 && format === 3) throw Error('TIFF fuera del subconjunto admitido: grises/MDT 8–32 bits o RGB(A) de 8 bits, entrelazado por píxel y predictor 1/2.');
  if (photo === 2 && samples < 3 || photo !== 2 && samples !== 1 || samples === 4 && one(338, 2) !== 2) throw Error('Combinación fotométrica o alfa premultiplicado no admitidos.');
  if (tags[258]?.some(b => b !== bits) || tags[339]?.some(f => f !== format)) throw Error('TIFF con muestras heterogéneas no admitido.');
  const keys = tags[34735] || [], geo = {}; for (let i = 4; i + 3 < keys.length; i += 4) geo[keys[i]] = keys[i + 1] === 0 ? keys[i + 3] : null;
  const epsg = geo[3072] || geo[2048], crs = resolveCRS(overrideCRS || (epsg && epsg !== 32767 ? `EPSG:${epsg}` : fallbackCRS || ''));
  let affine;
  if (tags[34264]?.length === 16) { const m = tags[34264]; affine = [m[3], m[0], m[1], m[7], m[4], m[5]]; }
  else if (tags[33550]?.length >= 2 && tags[33922]?.length >= 6) { const s = tags[33550], t = tags[33922]; affine = [t[3] - t[0] * s[0], s[0], 0, t[4] + t[1] * s[1], 0, -s[1]]; }
  else throw Error('GeoTIFF sin transformación de píxel a coordenadas.');
  if (geo[1025] === 2) { affine[0] -= (affine[1] + affine[2]) / 2; affine[3] -= (affine[4] + affine[5]) / 2; }
  worldToPixel(affine, { x: affine[0], y: affine[3] });
  const Ctor = format === 3 ? Float32Array : format === 2 ? bits === 8 ? Int8Array : bits === 16 ? Int16Array : Int32Array : bits === 8 ? Uint8Array : bits === 16 ? Uint16Array : Uint32Array, data = new Ctor(width * height * samples), bps = bits / 8;
  const tiled = !!tags[324], offsets = tags[tiled ? 324 : 273], counts = tags[tiled ? 325 : 279], tw = tiled ? one(322) : width, th = tiled ? one(323) : Math.min(one(278, height), height);
  if (!offsets || offsets.length !== counts?.length || !(tw > 0 && th > 0) || offsets.length !== Math.ceil(width / tw) * Math.ceil(height / th)) throw Error('Tiras o teselas TIFF inconsistentes.');
  for (let tile = 0; tile < offsets.length; tile++) {
    const tx = tiled ? tile % Math.ceil(width / tw) * tw : 0, ty = tiled ? Math.floor(tile / Math.ceil(width / tw)) * th : tile * th, rows = tiled ? th : Math.min(th, height - ty), expected = tw * rows * samples * bps;
    if (expected > MAX_PIXELS * 16 || offsets[tile] + counts[tile] > bytes.length) throw Error('Tira TIFF fuera de límites.');
    const raw = await unpack(bytes.subarray(offsets[tile], offsets[tile] + counts[tile]), one(259, 1), expected); if (raw.length !== expected) throw Error('Tamaño de tira TIFF incorrecto.'); const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), rowValues = tw * samples;
    for (let y = 0; y < rows; y++) { let prev = Array(samples).fill(0); for (let x = 0; x < rowValues; x++) { const at = (y * rowValues + x) * bps, ch = x % samples; let value = format === 3 ? dv.getFloat32(at, little) : bps === 1 ? raw[at] : bps === 2 ? dv.getUint16(at, little) : dv.getUint32(at, little);
      if (predictor === 2) value = (value + prev[ch]) % (2 ** bits); prev[ch] = value;
      if (format === 2 && value >= 2 ** (bits - 1)) value -= 2 ** bits;
      const px = Math.floor(x / samples); if (tx + px < width && ty + y < height) data[((ty + y) * width + tx + px) * samples + ch] = value;
    } }
  }
  return { width, height, samples, bits, format, photo, data, transform: affine, crs, nodata: tags[42113] == null ? null : Number(tags[42113]), palette: tags[320], originalBytes: bytes };
}
export function writeGeoTIFF(r) {
  const { width, height, samples = 1, bits = 8, format = 1 } = r, crs = resolveCRS(r.crs);
  if (!crs.code || crs.code > 65535 || crs.axis !== 'enu') throw Error('La exportación GeoTIFF requiere un EPSG del catálogo con X este / Y norte.');
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS || r.data.length !== width * height * samples) throw Error('Dimensiones raster inválidas.');
  const g = r.transform, tags = [[256, 4, [width]], [257, 4, [height]], [258, 3, Array(samples).fill(bits)], [259, 3, [1]], [262, 3, [r.photo ?? (samples > 1 ? 2 : 1)]], [273, 4, [0]], [277, 3, [samples]], [278, 4, [height]], [279, 4, [r.data.length * bits / 8]], [284, 3, [1]], [339, 3, Array(samples).fill(format)], [34264, 12, [g[1], g[2], 0, g[0], g[4], g[5], 0, g[3], 0, 0, 1, 0, 0, 0, 0, 1]], [34735, 3, [1, 1, 0, 3, 1024, 0, 1, crs.proj === 'longlat' ? 2 : 1, 1025, 0, 1, 1, crs.proj === 'longlat' ? 2048 : 3072, 0, 1, crs.code]]];
  if (r.photo === 3) { if (!r.palette) throw Error('Falta la paleta TIFF.'); tags.push([320, 3, r.palette]); }
  if (samples === 4) tags.push([338, 3, [2]]);
  if (r.nodata != null) tags.push([42113, 2, String(r.nodata) + '\0']);
  tags.sort((a, b) => a[0] - b[0]);
  const sizeOf = t => t === 12 ? 8 : t === 4 ? 4 : t === 3 ? 2 : 1;
  let size = 8 + 2 + tags.length * 12 + 4; const positions = tags.map(([, t, a]) => { if (a.length * sizeOf(t) <= 4) return null; size = Math.ceil(size / 8) * 8; const at = size; size += a.length * sizeOf(t); return at; });
  const rasterAt = Math.ceil(size / 8) * 8, out = new Uint8Array(rasterAt + r.data.length * bits / 8), v = new DataView(out.buffer); out[0] = out[1] = 73; v.setUint16(2, 42, true); v.setUint32(4, 8, true); v.setUint16(8, tags.length, true);
  tags.forEach(([tag, t, a], i) => { const at = 10 + i * 12; v.setUint16(at, tag, true); v.setUint16(at + 2, t, true); v.setUint32(at + 4, a.length, true); const pos = positions[i] ?? at + 8; if (positions[i] != null) v.setUint32(at + 8, pos, true); if (tag === 273) a = [rasterAt]; for (let j = 0; j < a.length; j++) { const p = pos + j * sizeOf(t); if (t === 12) v.setFloat64(p, a[j], true); else if (t === 4) v.setUint32(p, a[j], true); else if (t === 3) v.setUint16(p, a[j], true); else out[p] = a.charCodeAt(j); } });
  for (let i = 0; i < r.data.length; i++) { const at = rasterAt + i * bits / 8, n = r.data[i]; if (format === 3) v.setFloat32(at, n, true); else if (bits === 8) out[at] = n; else if (bits === 16) v.setUint16(at, n, true); else v.setUint32(at, n, true); } return out;
}
export function rasterBounds(doc, r) {
  const boundary = [];
  for (let i = 0; i <= 16; i++) for (const p of [[r.width * i / 16, 0], [r.width * i / 16, r.height], [0, r.height * i / 16], [r.width, r.height * i / 16]]) boundary.push(fromProjected(doc, transform(pixelToWorld(r.transform, ...p), r.crs, doc.geo.crs)));
  const xs = boundary.map(p => p.x), ys = boundary.map(p => p.y), x1 = Math.min(...xs), y1 = Math.min(...ys), w = Math.max(...xs) - x1, h = Math.max(...ys) - y1;
  return { x1, y1, w, h };
}
export async function rasterEntity(doc, raster, options = {}) {
  if (!doc.geo) throw Error('Configure la georreferenciación del dibujo.');
  const r = raster, { x1, y1, w, h } = rasterBounds(doc, r);
  const factor = Math.min(1, Math.sqrt(2e6 / (r.width * r.height))), width = Math.max(1, Math.round(r.width * factor)), height = Math.max(1, Math.round(r.height * factor));
  const cv = document.createElement('canvas'); cv.width = width; cv.height = height; const c = cv.getContext('2d'), image = c.createImageData(width, height);
  let min = Infinity, max = -Infinity; if (r.samples === 1) for (const v of r.data) if (Number.isFinite(v) && v !== r.nodata) { min = Math.min(min, v); max = Math.max(max, v); }
  for (let y = 0; y < height; y++) { if (options.signal?.aborted) throw new DOMException('Proceso cancelado.', 'AbortError'); for (let x = 0; x < width; x++) {
    let p; try { p = worldToPixel(r.transform, transform(toProjected(doc, { x: x1 + (x + 0.5) * w / width, y: y1 + h - (y + 0.5) * h / height }), doc.geo.crs, r.crs)); } catch { continue; }
    const px = Math.floor(p.x), py = Math.floor(p.y); if (px < 0 || py < 0 || px >= r.width || py >= r.height) continue;
    const at = (py * r.width + px) * r.samples, k = (y * width + x) * 4, v = r.data[at]; if (!Number.isFinite(v) || v === r.nodata) continue;
    if (options.colorize) { const rgb = options.colorize(v); image.data[k] = rgb[0]; image.data[k + 1] = rgb[1]; image.data[k + 2] = rgb[2]; }
    else if (r.photo === 3 && r.palette) { const n = r.palette.length / 3; for (let j = 0; j < 3; j++) image.data[k + j] = r.palette[v + j * n] / 257; }
    else if (r.samples === 1) { const gray = r.bits === 8 && r.format === 1 ? r.photo === 0 ? 255 - v : v : 255 * (v - min) / ((max - min) || 1); image.data[k] = image.data[k + 1] = image.data[k + 2] = gray; }
    else for (let j = 0; j < 3; j++) image.data[k + j] = r.data[at + j]; image.data[k + 3] = r.samples === 4 ? r.data[at + 3] : 255;
  } if (y % 16 === 0) await new Promise(resolve => setTimeout(resolve, 0)); }
  c.putImageData(image, 0, 0);
  // El original permite recuperar los valores del MDT sin cuantificarlos como colores de pantalla.
  const raw = r.originalBytes || writeGeoTIFF({ ...r, crs: r.crs }); let encoded = ''; for (let i = 0; i < raw.length; i += 0x8000) encoded += String.fromCharCode(...raw.subarray(i, i + 0x8000));
  return { type: 'image', p: { x: x1, y: y1 }, w, h, rot: 0, src: cv.toDataURL('image/png'), gisRaster: { original: btoa(encoded), crs: r.crs, width: r.width, height: r.height, min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null } };
}
export async function exportRaster(doc, e, targetCRS) {
  const target = resolveCRS(targetCRS || doc.geo.crs);
  // Se exporta la representación CAD actual; el original numérico se ofrece por separado en la interfaz.
  const img = new Image(); img.src = e.src; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const c = cv.getContext('2d'); c.drawImage(img, 0, 0); const data = c.getImageData(0, 0, cv.width, cv.height).data;
  const project = (x, y) => { const a = e.rot || 0, p = { x: e.p.x + x * Math.cos(a) - y * Math.sin(a), y: e.p.y + x * Math.sin(a) + y * Math.cos(a) }; return transform(toProjected(doc, p), doc.geo.crs, target); };
  const a = project(0, e.h), b = project(e.w, e.h), d = project(0, 0);
  if (JSON.stringify(target) !== JSON.stringify(resolveCRS(doc.geo.crs))) throw Error('Para exportar una imagen reproyectada, use el EPSG del dibujo; el original conserva su EPSG de origen.');
  return writeGeoTIFF({ width: cv.width, height: cv.height, data, samples: 4, bits: 8, format: 1, transform: [a.x, (b.x - a.x) / cv.width, (d.x - a.x) / cv.height, a.y, (b.y - a.y) / cv.width, (d.y - a.y) / cv.height], crs: target });
}
