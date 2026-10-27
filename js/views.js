// Vistas con nombre (VIEW) y ventanas en mosaico del espacio modelo (VPORTS): división, unión y configuraciones guardadas.
import { setUcs } from './ucs.js';

export const findView = (doc, name) => doc.views.find(v => v.name.toLowerCase() === String(name).trim().toLowerCase());
export const validViewName = n => /^[^<>/\\":;?*|,=`]{1,255}$/.test(n);

// Vista actual (o el rectángulo rect) como vista con nombre; ucs: guardar el SCP actual; layers: instantánea de las capas
export function captureView(app, name, { rect = null, ucs = true, layers = false } = {}) {
  const doc = app.doc, r = rect || app.view.rect();
  const space = app.tab === 'model' || app.vpActive ? 'model' : doc.layouts[app.tab].name;
  const rec = { name, space, cx: (r.x1 + r.x2) / 2, cy: (r.y1 + r.y2) / 2, w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
  if (ucs && space === 'model' && doc.ucs) rec.ucs = { o: { ...doc.ucs.o }, ang: doc.ucs.ang, ...(doc.ucs.name ? { name: doc.ucs.name } : {}) };
  if (layers) rec.layers = Object.fromEntries(doc.layers.map(l => [l.name, { on: l.on, lock: l.lock }]));
  return rec;
}
export function saveView(doc, rec) {
  const old = findView(doc, rec.name);
  if (old) { for (const k of Object.keys(old)) delete old[k]; Object.assign(old, rec); } else doc.views.push(rec);
  doc.changed();
  return old || rec;
}
export function deleteView(doc, name) {
  const v = findView(doc, name);
  if (!v) return false;
  doc.views = doc.views.filter(x => x !== v);
  doc.changed();
  return true;
}
// Restituye una vista: cambia al espacio donde se guardó (o a la ventana gráfica activa si es del modelo), ajusta la vista
// y, si se guardaron con ella, restituye el SCP y el estado de las capas. Devuelve false si la presentación ya no existe.
export function restoreView(app, rec) {
  const doc = app.doc;
  if (rec.space === 'model') { if (app.tab !== 'model' && !app.vpActive) app.switchTab('model'); }
  else {
    const i = doc.layouts.findIndex(l => l.name === rec.space);
    if (i < 0) return false;
    if (app.tab !== i) app.switchTab(i); else if (app.vpActive) app.pspace();
  }
  app.view.push();
  app.view.fit({ x1: rec.cx - rec.w / 2, y1: rec.cy - rec.h / 2, x2: rec.cx + rec.w / 2, y2: rec.cy + rec.h / 2 }, 0);
  if (rec.ucs) setUcs(doc, rec.ucs, rec.ucs.name);
  if (rec.layers) {
    for (const l of doc.layers) { const s = rec.layers[l.name]; if (s) { l.on = s.on; l.lock = s.lock; } }
    doc.changed();
  }
  app.renderer.invalidate();
  return true;
}

// ---------- Ventanas en mosaico ----------
// Rectángulos en fracciones de la zona de dibujo (y hacia abajo, como en la pantalla)
const R = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
export const TILE_DIRS = { 2: ['Horizontal', 'Vertical'], 3: ['Horizontal', 'Vertical', 'ENcima', 'DEbajo', 'Izquierda', 'deRecha'] };
// División de r en n ventanas; dir: disposición (con 3, «deRecha» deja la ventana grande a la derecha, como en AutoCAD)
export function splitTile(r, n, dir) {
  const { x1, y1, x2, y2 } = r, xm = (x1 + x2) / 2, ym = (y1 + y2) / 2;
  if (n === 2) return dir === 'Horizontal' ? [R(x1, y1, x2, ym), R(x1, ym, x2, y2)] : [R(x1, y1, xm, y2), R(xm, y1, x2, y2)];
  if (n === 3) {
    const tx = k => x1 + (x2 - x1) * k / 3, ty = k => y1 + (y2 - y1) * k / 3;
    switch (dir) {
      case 'Horizontal': return [R(x1, y1, x2, ty(1)), R(x1, ty(1), x2, ty(2)), R(x1, ty(2), x2, y2)];
      case 'Vertical': return [R(x1, y1, tx(1), y2), R(tx(1), y1, tx(2), y2), R(tx(2), y1, x2, y2)];
      case 'ENcima': return [R(x1, y1, x2, ym), R(x1, ym, xm, y2), R(xm, ym, x2, y2)];
      case 'DEbajo': return [R(x1, y1, xm, ym), R(xm, y1, x2, ym), R(x1, ym, x2, y2)];
      case 'Izquierda': return [R(x1, y1, xm, y2), R(xm, y1, x2, ym), R(xm, ym, x2, y2)];
      default: return [R(x1, y1, xm, ym), R(x1, ym, xm, y2), R(xm, y1, x2, y2)];
    }
  }
  if (n === 4) return [R(x1, y1, xm, ym), R(xm, y1, x2, ym), R(x1, ym, xm, y2), R(xm, ym, x2, y2)];
  return [R(x1, y1, x2, y2)];
}
// Unión de dos ventanas que comparten un lado entero, o null
export function joinTiles(a, b) {
  const eq = (u, v) => Math.abs(u - v) < 1e-9;
  const box = () => R(Math.min(a.x1, b.x1), Math.min(a.y1, b.y1), Math.max(a.x2, b.x2), Math.max(a.y2, b.y2));
  if (eq(a.y1, b.y1) && eq(a.y2, b.y2) && (eq(a.x2, b.x1) || eq(b.x2, a.x1))) return box();
  if (eq(a.x1, b.x1) && eq(a.x2, b.x2) && (eq(a.y2, b.y1) || eq(b.y2, a.y1))) return box();
  return null;
}
// División de un rectángulo del papel (y hacia arriba) con las mismas disposiciones
export function splitPaper(rc, n, dir) {
  return splitTile(R(rc.x1, -rc.y2, rc.x2, -rc.y1), n, dir).map(t => R(t.x1, -t.y2, t.x2, -t.y1));
}

export const findVportConfig = (doc, name) => doc.vportConfigs.find(v => v.name.toLowerCase() === String(name).trim().toLowerCase());
