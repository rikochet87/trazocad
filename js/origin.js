// Origen local del dibujo: coordenadas grandes (de proyección, con 6 o 7 cifras) sin pérdida de precisión. El modelo guarda
// las coordenadas relativas a doc.origin (coordenada real = coordenada interna + origen), así que las intersecciones, las
// áreas, los contornos y el dibujo en pantalla trabajan con números pequeños. El usuario ve y escribe siempre las reales:
// el SCP universal del modelo tiene su origen en −origen (ucs.js), las propiedades y LIST suman el origen, y el DXF lleva
// las coordenadas reales. Al abrir un DXF con coordenadas grandes el origen se elige solo (centro redondeado).
import * as G from './geom.js';
import { xformEnt, cloneEnt, bboxOf, bbUnion } from './entities.js';
import { entVals } from './constraints.js';

const { Mx, P } = G;
// A partir de qué distancia al origen interno conviene un origen local (más allá, el canvas, que trabaja con números de
// 32 bits, empieza a temblar al ampliar, y los productos de coordenadas pierden decimales)
export const FAR = 1e5;

export const hasOrigin = doc => !!(doc.origin && (doc.origin.x || doc.origin.y));
// ¿Se trabaja en el modelo (directamente o a través de una ventana gráfica)? El papel y el editor de bloques no tienen origen.
export const inModelSpace = doc => doc.space === 'model' || (doc.activeVp != null && doc.space !== 'bedit');
// Punto interno → real y al revés (en el espacio modelo)
export const toReal = (doc, p) => (hasOrigin(doc) ? P(p.x + doc.origin.x, p.y + doc.origin.y) : P(p.x, p.y));
export const fromReal = (doc, p) => (hasOrigin(doc) ? P(p.x - doc.origin.x, p.y - doc.origin.y) : P(p.x, p.y));

// Traslada una entidad (sin pasar por el documento). Las cotas de coordenadas llevan su origen (org), que no se mueve al
// desplazar la cota pero sí al cambiar el origen local.
export function shiftEnt(e, dx, dy) {
  xformEnt(e, Mx.T(dx, dy));
  if (e.type === 'dim' && e.kind === 'ord') e.org = P((e.org?.x || 0) + dx, (e.org?.y || 0) + dy);
  return e;
}
const sp = (p, dx, dy) => (p ? { ...p, x: p.x + dx, y: p.y + dy } : p);

// Desplaza todo lo que está en coordenadas del modelo: objetos (con deshacer), vistas con nombre, SCP, configuraciones de
// ventanas, centros de las ventanas gráficas, punto base del dibujo y restricciones fijas. Lo de la aplicación (vistas
// abiertas) lo desplaza app.shiftViews.
export function shiftModel(doc, dx, dy) {
  for (const e of [...doc.model]) doc.modify(e.id, x => shiftEnt(x, dx, dy));
  for (const v of doc.views) { v.cx += dx; v.cy += dy; }
  if (doc.ucs) doc.ucs = { ...doc.ucs, o: sp(doc.ucs.o, dx, dy) };
  for (const u of doc.ucsList) u.o = sp(u.o, dx, dy);
  doc.ucsPrev = (doc.ucsPrev || []).map(u => (u ? { ...u, o: sp(u.o, dx, dy) } : u));
  for (const c of doc.vportConfigs) for (const t of c.tiles || []) { t.cx += dx; t.cy += dy; if (t.ucs) t.ucs = { ...t.ucs, o: sp(t.ucs.o, dx, dy) }; }
  for (const l of doc.layouts) for (const e of l.ents) if (e.type === 'vport') { e.cx += dx; e.cy += dy; if (e.ucs) e.ucs = { ...e.ucs, o: sp(e.ucs.o, dx, dy) }; }
  doc.settings.insBase = sp(doc.settings.insBase || P(0, 0), dx, dy);
  for (const k of doc.constraints) {
    if (k.type !== 'fix') continue;
    if (k.at) k.at = sp(k.at, dx, dy);
    else { const e = doc.get(k.refs[0].id); if (e) k.vals = entVals(e); }
  }
  doc.changed();
}

// Cambia el origen local conservando las coordenadas reales de todo
export function setOrigin(doc, o) {
  const old = doc.origin || P(0, 0), n = P(+o.x || 0, +o.y || 0);
  if (n.x === old.x && n.y === old.y) return false;
  shiftModel(doc, old.x - n.x, old.y - n.y);
  doc.origin = n;
  doc.changed();
  doc.emit('origin', { dx: old.x - n.x, dy: old.y - n.y });
  return true;
}

// Origen redondeado para unas coordenadas reales: el centro del rectángulo, a la potencia de 10 adecuada (1000 m para
// coordenadas de proyección)
export function roundOrigin(b) {
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, size = Math.max(b.x2 - b.x1, b.y2 - b.y1, 1);
  const step = Math.max(1, 10 ** Math.floor(Math.log10(size)));
  return P(Math.round(cx / step) * step, Math.round(cy / step) * step);
}
// Rectángulo de unas entidades (en sus coordenadas)
export function entsBox(ents) {
  let b = null;
  for (const e of ents) { try { const x = bboxOf(e); if (x && isFinite(x.x1)) b = bbUnion(b, x); } catch { /* entidad sin geometría */ } }
  return b;
}
// ¿Las coordenadas están lejos del origen (en relación con su tamaño)? Entonces conviene un origen local.
export const isFar = b => !!b && Math.max(Math.abs(b.x1), Math.abs(b.x2), Math.abs(b.y1), Math.abs(b.y2)) > FAR && Math.max(Math.abs(b.x1 + b.x2), Math.abs(b.y1 + b.y2)) / 2 > Math.max(b.x2 - b.x1, b.y2 - b.y1) / 4;

// Copia del documento con las coordenadas reales, para escribir el DXF (no toca el dibujo: sumar y volver a restar el
// origen perdería decimales)
export function realDoc(doc) {
  if (!hasOrigin(doc)) return doc;
  const { x: dx, y: dy } = doc.origin, T = Mx.T(dx, dy), out = Object.create(doc);
  out.model = doc.model.map(e => shiftEnt(cloneEnt(e), dx, dy));
  out.byId = new Map([...doc.byId, ...out.model.map(e => [e.id, e])]);
  out.layouts = doc.layouts.map(l => ({ ...l, ents: l.ents.map(e => (e.type === 'vport' ? { ...e, cx: e.cx + dx, cy: e.cy + dy } : e)) }));
  out.views = doc.views.map(v => ({ ...v, cx: v.cx + dx, cy: v.cy + dy }));
  out.ucs = doc.ucs ? { ...doc.ucs, o: Mx.ap(T, doc.ucs.o) } : null;
  out.ucsList = doc.ucsList.map(u => ({ ...u, o: Mx.ap(T, u.o) }));
  out.settings = { ...doc.settings, insBase: Mx.ap(T, doc.settings.insBase || P(0, 0)) };
  const vs = doc.viewState;
  if (vs) out.viewState = () => { const s = vs(); return s && { ...s, tiles: s.tiles.map(t => ({ ...t, cx: t.cx + dx, cy: t.cy + dy })) }; };
  return out;
}
