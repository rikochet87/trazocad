// Georreferenciación del proyecto: transforma coordenadas reales, independientemente del origen local y del SCP.
import { resolveCRS, transform } from './projections.js';
import { toReal, fromReal } from './origin.js';
export function validateGeo(value) {
  const g = { crs: 'EPSG:3857', reference: { x: 0, y: 0 }, projected: { x: 0, y: 0 }, units: 1, north: 0, format: 'decimal', ...value };
  g.crs = resolveCRS(g.crs);
  if (!(g.units > 0) || !Number.isFinite(+g.north) || !['decimal', 'dms'].includes(g.format)) throw Error('Unidades, norte o formato geográfico inválidos.');
  for (const p of [g.reference, g.projected]) if (!p || !Number.isFinite(+p.x) || !Number.isFinite(+p.y)) throw Error('Punto de referencia inválido.');
  return g;
}
export function toProjected(doc, p) {
  const g = doc.geo; if (!g) throw Error('Configure GEOGRAPHICLOCATION antes de usar coordenadas geográficas.');
  const r = toReal(doc, p), a = g.north * Math.PI / 180, x = (r.x - g.reference.x) * g.units, y = (r.y - g.reference.y) * g.units;
  return { x: g.projected.x + x * Math.cos(a) - y * Math.sin(a), y: g.projected.y + x * Math.sin(a) + y * Math.cos(a), z: p.z ?? 0 };
}
export function fromProjected(doc, p) {
  const g = doc.geo; if (!g) throw Error('Dibujo sin georreferenciación.');
  const a = g.north * Math.PI / 180, x = p.x - g.projected.x, y = p.y - g.projected.y;
  return { ...fromReal(doc, { x: g.reference.x + (x * Math.cos(a) + y * Math.sin(a)) / g.units, y: g.reference.y + (-x * Math.sin(a) + y * Math.cos(a)) / g.units }), z: p.z ?? 0 };
}
export const toGeographic = (doc, p) => { const q = transform(toProjected(doc, p), doc.geo.crs, 'EPSG:4326'); return { lon: q.x, lat: q.y, h: q.z }; };
export const fromGeographic = (doc, p) => fromProjected(doc, transform({ x: p.lon, y: p.lat, z: p.h ?? 0 }, 'EPSG:4326', doc.geo.crs));
export function parseAngle(text, limit) {
  const s = String(text).trim().toUpperCase(), hem = s.match(/[NSEWO]$/)?.[0], clean = s.replace(/[NSEWO]$/, '').trim();
  const m = clean.match(/^([+-]?\d+(?:\.\d+)?)(?:[°:\s]+(\d+(?:\.\d+)?)(?:['′:\s]+(\d+(?:\.\d+)?)\s*["″]?)?\s*['′]?)?\s*°?$/);
  if (!m || (+m[2] || 0) >= 60 || (+m[3] || 0) >= 60 || hem && (limit === 90 ? !'NS'.includes(hem) : !'EWO'.includes(hem))) throw Error('Coordenada geográfica inválida.');
  const sign = hem ? ('SWO'.includes(hem) ? -1 : 1) : /^-/.test(m[1]) ? -1 : 1;
  const v = sign * (Math.abs(+m[1]) + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600);
  if (Math.abs(v) > limit) throw Error('Coordenada geográfica fuera de rango.'); return v;
}
export function parseGeographic(text) {
  const m = String(text).match(/^(?:GEO:|LL:)([^,]+),([^,]+)(?:,([^,]+))?$/i);
  if (!m) return null;
  const h = m[3] == null ? 0 : Number(m[3]); if (!Number.isFinite(h)) throw Error('Altitud inválida.');
  return { lat: parseAngle(m[1], 90), lon: parseAngle(m[2], 180), h };
}
export function formatGeographic(p, format = 'decimal') {
  const angle = (v, lat) => { const h = lat ? v < 0 ? 'S' : 'N' : v < 0 ? 'O' : 'E';
    if (format !== 'dms') return `${Math.abs(v).toFixed(7)}° ${h}`;
    const sec = Math.round(Math.abs(v) * 360000) / 100, d = Math.floor(sec / 3600), m = Math.floor((sec - d * 3600) / 60), s = sec - d * 3600 - m * 60;
    return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(2).padStart(5, '0')}″ ${h}`;
  }; return `${angle(p.lat, true)} · ${angle(p.lon, false)}`;
}
export class GeoLocation {
  constructor(app) { this.app = app; this.watch = null; this.position = null; this.generation = 0; }
  stop() { this.generation++; if (this.watch != null) navigator.geolocation?.clearWatch(this.watch); this.watch = null; this.position = null; this.app.renderer.invalidate(); }
  start(follow = false) {
    if (!this.app.doc.geo) throw Error('Configure primero la georreferenciación.');
    if (!navigator.geolocation) throw Error('GPS no disponible en este navegador.');
    this.stop(); const gen = this.generation, doc = this.app.doc, geo = doc.geo; this.geo = geo;
    const success = pos => {
      if (gen !== this.generation || this.app.doc !== doc || doc.geo !== geo) return;
      try { const p = fromGeographic(doc, { lon: pos.coords.longitude, lat: pos.coords.latitude, h: pos.coords.altitude ?? 0 });
        this.position = { lon: pos.coords.longitude, lat: pos.coords.latitude, h: pos.coords.altitude ?? 0, accuracy: pos.coords.accuracy, timestamp: pos.timestamp };
        if (follow && !this.app.layoutShown() && !doc.bedit) { this.app.view.cx = p.x; this.app.view.cy = p.y; }
        this.app.renderer.invalidate();
      } catch (e) { this.stop(); this.app.print(`GPS: ${e.message}`, 'err'); }
    };
    this.watch = navigator.geolocation.watchPosition(success, err => { if (gen !== this.generation) return; this.stop(); this.app.print(`GPS: ${err.code === 1 ? 'permiso denegado' : err.code === 2 ? 'posición no disponible' : 'tiempo de espera agotado'}.`, 'err'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 });
  }
  draw(c, R) {
    if (!this.position || !this.app.doc.geo) return;
    // Se vuelve a calcular desde geográficas si cambia el origen local.
    const p = fromGeographic(this.app.doc, this.position), q = R.toScreen(p);
    const ll = toGeographic(this.app.doc, p), north = fromGeographic(this.app.doc, { lon: ll.lon, lat: ll.lat + Math.min(0.001, (89.999 - ll.lat) / 2) });
    const meters = Math.abs((north ? Math.hypot(north.x - p.x, north.y - p.y) : 0) / (Math.min(0.001, (89.999 - ll.lat) / 2) * 111320));
    const radius = Math.max(4, this.position.accuracy * meters * R.scale);
    c.save(); c.setTransform(R.dpr, 0, 0, R.dpr, 0, 0); c.fillStyle = 'rgba(45,153,255,0.14)'; c.strokeStyle = '#2d99ff'; c.lineWidth = 1;
    c.beginPath(); c.arc(q.x, q.y, Math.min(radius, 1e5), 0, 2 * Math.PI); c.fill(); c.stroke();
    c.fillStyle = '#2d99ff'; c.beginPath(); c.arc(q.x, q.y, 5, 0, 2 * Math.PI); c.fill(); c.fillStyle = '#ffffff'; c.font = '12px sans-serif'; c.fillText(`GPS ±${this.position.accuracy.toFixed(1)} m`, q.x + 10, q.y - 10); c.restore();
  }
}
