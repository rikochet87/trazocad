// Mapas base: teselas Web Mercator reproyectadas mediante una malla de triángulos.
import { toGeographic, fromGeographic } from './geographic.js';
export const MAP_CACHE = 'trazocad-mapas-v1';
export const OSM = { type: 'XYZ', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19, opacity: 0.65, enabled: true };
const LIMIT = 64, MEM_LIMIT = 192;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function validateMap(value) {
  const m = { ...OSM, ...value }; m.type = String(m.type).toUpperCase();
  if (!['XYZ', 'WMS', 'WMTS'].includes(m.type)) throw Error('Tipo de mapa no admitido.');
  const url = new URL(m.url, location.href); if (!['https:', 'http:'].includes(url.protocol)) throw Error('El mapa necesita una URL HTTP o HTTPS.');
  if (location.protocol === 'https:' && url.protocol !== 'https:') throw Error('Use HTTPS para el mapa.');
  if (!(m.opacity >= 0 && m.opacity <= 1) || !Number.isInteger(+m.maxZoom) || m.maxZoom < 0 || m.maxZoom > 22) throw Error('Opacidad o zoom del mapa inválidos.');
  if (m.type === 'XYZ' && !['{x}', '{y}', '{z}'].every(k => m.url.includes(k))) throw Error('La URL XYZ debe contener {z}, {x} e {y}.');
  if (m.type !== 'XYZ' && !m.layer) throw Error('Indique la capa del servicio.');
  if (m.type === 'WMTS' && !m.matrixSet) throw Error('Indique el conjunto de matrices Web Mercator.');
  return m;
}
export function tileURL(m, z, x, y) {
  const n = 2 ** z; x = ((x % n) + n) % n;
  if (m.type === 'XYZ') return m.url.replaceAll('{z}', z).replaceAll('{x}', x).replaceAll('{y}', y);
  const u = new URL(m.url, location.href), set = o => { for (const [k, v] of Object.entries(o)) u.searchParams.set(k, v); };
  if (m.type === 'WMTS') set({ SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0', LAYER: m.layer, STYLE: m.style || 'default', FORMAT: m.format || 'image/png', TILEMATRIXSET: m.matrixSet, TILEMATRIX: `${m.matrixPrefix || ''}${z}`, TILEROW: y, TILECOL: x });
  else {
    const h = 20037508.342789244, d = 2 * h / n, bbox = [-h + x * d, h - (y + 1) * d, -h + (x + 1) * d, h - y * d].join(',');
    set({ SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.1.1', LAYERS: m.layer, STYLES: m.style || '', FORMAT: m.format || 'image/png', TRANSPARENT: 'TRUE', SRS: 'EPSG:3857', BBOX: bbox, WIDTH: 256, HEIGHT: 256 });
  }
  return u.href;
}
export function tileLonLat(x, y, z) { const n = 2 ** z; return { lon: x / n * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI }; }
function tileXY(p, z) { const n = 2 ** z, lat = clamp(p.lat, -85.05112878, 85.05112878) * Math.PI / 180; return { x: (p.lon + 180) / 360 * n, y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * n }; }
export function screenPoint(R, sx, sy) { const x = (sx - (R.ox || 0) - R.w / 2) / R.scale, y = ((R.oy || 0) + R.h / 2 - sy) / R.scale, a = R.rot || 0; return { x: R.cx + x * Math.cos(a) - y * Math.sin(a), y: R.cy + x * Math.sin(a) + y * Math.cos(a) }; }
export function visibleTiles(doc, R, m) {
  if (!doc.geo || !m?.enabled) return [];
  const ll = [];
  for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) { try { ll.push(toGeographic(doc, screenPoint(R, (R.ox || 0) + R.w * i / 4, (R.oy || 0) + R.h * j / 4))); } catch { /* bordes fuera del dominio */ } }
  if (!ll.length) return [];
  const mid = toGeographic(doc, { x: R.cx, y: R.cy }), near = toGeographic(doc, screenPoint(R, (R.ox || 0) + R.w / 2 + 1, (R.oy || 0) + R.h / 2));
  const meters = Math.max(0.001, Math.hypot((near.lon - mid.lon) * Math.cos(mid.lat * Math.PI / 180), near.lat - mid.lat) * 111320);
  let z = clamp(Math.round(Math.log2(156543.033928 * Math.cos(mid.lat * Math.PI / 180) / meters)), 0, +m.maxZoom);
  let bounds;
  for (;;) {
    const qs = ll.map(p => tileXY(p, z)), n = 2 ** z;
    bounds = [clamp(Math.floor(Math.min(...qs.map(p => p.x))), 0, n - 1), clamp(Math.floor(Math.min(...qs.map(p => p.y))), 0, n - 1), clamp(Math.floor(Math.max(...qs.map(p => p.x))), 0, n - 1), clamp(Math.floor(Math.max(...qs.map(p => p.y))), 0, n - 1)];
    if ((bounds[2] - bounds[0] + 1) * (bounds[3] - bounds[1] + 1) <= LIMIT || !z) break; z--;
  }
  const out = []; for (let y = bounds[1]; y <= bounds[3]; y++) for (let x = bounds[0]; x <= bounds[2]; x++) out.push({ x, y, z, url: tileURL(m, z, x, y) }); return out;
}
function triangle(c, img, src, dst) {
  const [a, b, d] = dst, [u, v, w] = src, det = (v.x - u.x) * (w.y - u.y) - (w.x - u.x) * (v.y - u.y);
  if (Math.abs(det) < 1e-10) return;
  const ax = ((b.x - a.x) * (w.y - u.y) - (d.x - a.x) * (v.y - u.y)) / det, bx = ((d.x - a.x) * (v.x - u.x) - (b.x - a.x) * (w.x - u.x)) / det;
  const ay = ((b.y - a.y) * (w.y - u.y) - (d.y - a.y) * (v.y - u.y)) / det, by = ((d.y - a.y) * (v.x - u.x) - (b.y - a.y) * (w.x - u.x)) / det;
  // Solapar ligeramente los recortes evita las costuras del antialias entre triángulos adyacentes.
  const center = { x: (a.x + b.x + d.x) / 3, y: (a.y + b.y + d.y) / 3 };
  const clip = [a, b, d].map(p => { const dx = p.x - center.x, dy = p.y - center.y, len = Math.hypot(dx, dy) || 1; return { x: p.x + 2 * dx / len, y: p.y + 2 * dy / len }; });
  c.save(); c.beginPath(); c.moveTo(clip[0].x, clip[0].y); c.lineTo(clip[1].x, clip[1].y); c.lineTo(clip[2].x, clip[2].y); c.closePath(); c.clip(); c.transform(ax, ay, bx, by, a.x - ax * u.x - bx * u.y, a.y - ay * u.x - by * u.y); c.drawImage(img, 0, 0, 256, 256); c.restore();
}
export class Basemap {
  constructor(app) { this.app = app; this.images = new Map(); this.pending = new Map(); this.failures = new Map(); this.active = 0; this.queue = []; this.warned = false; this.revision = 0; this.rasters = new Map(); }
  async load(url) {
    if (this.images.has(url)) { const im = this.images.get(url); this.images.delete(url); this.images.set(url, im); return im; }
    if (this.pending.has(url)) return this.pending.get(url);
    if (Date.now() - (this.failures.get(url) || 0) < 30000) return null;
    const p = new Promise(resolve => { this.queue.push({ url, resolve }); this.pump(); }); this.pending.set(url, p); return p;
  }
  pump() {
    while (this.active < 4 && this.queue.length) { const job = this.queue.shift(); this.active++; this.fetchTile(job.url).then(job.resolve).finally(() => { this.pending.delete(job.url); this.active--; this.pump(); this.app.renderer.invalidate(); }); }
  }
  async fetchTile(url) {
    try {
      let cache; try { cache = await caches.open(MAP_CACHE); } catch { /* almacenamiento no disponible */ }
      let res = await cache?.match(url);
      if (!res) {
        res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(12000) });
        if (!res.ok || res.type === 'opaque' || !/^image\//i.test(res.headers.get('Content-Type') || '')) throw Error('El servicio no devolvió una imagen CORS válida.');
        if (cache) { try { await cache.put(url, res.clone()); const keys = await cache.keys(); if (keys.length > 512) await cache.delete(keys[0]); } catch { /* cuota agotada: mostrar sin guardar */ } }
      }
      const blob = await res.blob(), object = URL.createObjectURL(blob), im = new Image();
      try { im.src = object; await im.decode(); } finally { URL.revokeObjectURL(object); }
      this.revision++; this.images.set(url, im); while (this.images.size > MEM_LIMIT) this.images.delete(this.images.keys().next().value); return im;
    } catch (e) { this.failures.set(url, Date.now()); if (!this.warned) { this.warned = true; this.app.print(`Mapa: no se pudo cargar una tesela. Se usarán las guardadas sin conexión; compruebe la URL y CORS.`, 'err'); } return null; }
  }
  tiles(R) { try { return visibleTiles(this.app.doc, R, this.app.doc.basemap); } catch { return []; } }
  async prepare(R) { const tiles = this.tiles(R); await Promise.all(tiles.map(t => this.load(t.url))); return tiles.filter(t => this.images.has(t.url)).length; }
  draw(c, R, exporting = false) {
    const doc = this.app.doc, m = doc.basemap; if (!doc.geo || !m?.enabled) return;
    const tiles = this.tiles(R); if (!tiles.length) return;
    // Una imagen reproyectada por vista permite incrustar el mismo resultado en PDF, sin depender de URL externas.
    const key = JSON.stringify([doc.geo, doc.origin, m, R.cx, R.cy, R.scale, R.rot, R.w, R.h, this.revision]);
    let cv = this.rasters.get(key);
    if (!cv) {
    cv = document.createElement('canvas'); cv.width = Math.ceil(R.w); cv.height = Math.ceil(R.h); const ctx = cv.getContext('2d');
    const localR = { ...R, ox: 0, oy: 0, toScreen: p => { const q = R.toScreen(p); return { x: q.x - (R.ox || 0), y: q.y - (R.oy || 0) }; } };
    for (const t of tiles) {
      const im = this.images.get(t.url); if (!im) { if (!exporting) this.load(t.url); continue; }
      const size = 8, points = [];
      for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) { try { points.push(localR.toScreen(fromGeographic(doc, tileLonLat(t.x + i / size, t.y + j / size, t.z)))); } catch { points.push(null); } }
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const k = j * (size + 1) + i, a = points[k], b = points[k + 1], d = points[k + size + 1], e = points[k + size + 2], u = { x: i * 256 / size, y: j * 256 / size }, v = { x: (i + 1) * 256 / size, y: j * 256 / size }, w = { x: i * 256 / size, y: (j + 1) * 256 / size }, s = { x: (i + 1) * 256 / size, y: (j + 1) * 256 / size };
        if (a && b && e) triangle(ctx, im, [u, v, s], [a, b, e]); if (a && e && d) triangle(ctx, im, [u, s, w], [a, e, d]);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '11px sans-serif'; const attribution = String(m.attribution || 'Mapa base');
    ctx.fillRect(0, cv.height - 18, Math.min(cv.width, ctx.measureText(attribution).width + 12), 18); ctx.fillStyle = '#17232e'; ctx.fillText(attribution, 6, cv.height - 5);
    this.rasters.set(key, cv); while (this.rasters.size > 4) this.rasters.delete(this.rasters.keys().next().value);
    }
    c.save(); c.setTransform(R.dpr, 0, 0, R.dpr, 0, 0); c.globalAlpha = +m.opacity;
    if (exporting) c.drawImage({ src: cv.toDataURL('image/png'), naturalWidth: cv.width, naturalHeight: cv.height }, R.ox || 0, R.oy || 0, R.w, R.h);
    else c.drawImage(cv, R.ox || 0, R.oy || 0, R.w, R.h);
    c.restore();
  }
  async clear() { await caches.delete(MAP_CACHE); this.images.clear(); this.failures.clear(); this.warned = false; this.revision++; this.rasters.clear(); }
}
