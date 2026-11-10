// Sistemas de coordenadas personales (SCP): origen y dirección del eje X en el plano, conversión de coordenadas,
/** @typedef {import('./types').Point} Point */
/** @typedef {import('./types').Ucs} Ucs */
/** @typedef {import('./document.js').Doc} Doc */
// @ts-check
// SCP con nombre, SCP previos y alineación con objetos o tres puntos. El SCP sólo actúa en el espacio modelo.
import * as G from './geom.js';
import { primsOf } from './entities.js';
import { hasOrigin, inModelSpace } from './origin.js';

/** SCP universal. @type {Readonly<Ucs>} */
export const WORLD = Object.freeze({ o: Object.freeze({ x: 0, y: 0 }), ang: 0 });
const PREV_MAX = 10;

/** ¿Es el universal (o equivalente)? @param {Ucs | null | undefined} u @returns {boolean} */
export const isWorld = u => !u || !!u.world || (Math.abs(u.o.x) < 1e-12 && Math.abs(u.o.y) < 1e-12 && Math.abs(Math.sin(u.ang)) < 1e-12 && Math.cos(u.ang) > 0);
// SCP universal del espacio actual: en el modelo con origen local (origin.js), su origen está en −origen, de modo que las
// coordenadas que se ven y se escriben son las reales
/** @param {Doc} doc @returns {Ucs} */
export const wcsOf = doc => (hasOrigin(doc) && inModelSpace(doc) ? { o: G.P(-doc.origin.x, -doc.origin.y), ang: 0, world: true } : WORLD);
// SCP que se usa en el espacio actual (en el papel y en el editor de bloques, el universal)
/** @param {Doc} doc @returns {Ucs} */
export const ucsOf = doc => (doc.space === 'model' && doc.ucs) || wcsOf(doc);

// Universal → SCP y SCP → universal
/** Universal → SCP. @param {Ucs} u @param {Point} p @returns {Point} */
export function toUcs(u, p) {
  const c = Math.cos(u.ang), s = Math.sin(u.ang), dx = p.x - u.o.x, dy = p.y - u.o.y;
  return G.P(dx * c + dy * s, -dx * s + dy * c);
}
/** SCP → universal. @param {Ucs} u @param {Point} p @returns {Point} */
export function fromUcs(u, p) {
  const c = Math.cos(u.ang), s = Math.sin(u.ang);
  return G.P(u.o.x + p.x * c - p.y * s, u.o.y + p.x * s + p.y * c);
}
/** Vector del SCP al universal. @param {Ucs} u @param {Point} v @returns {Point} */
export const vecFromUcs = (u, v) => G.rot(v, u.ang);

// Cambia el SCP actual guardando el anterior (para UCS › Previo). name: SCP con nombre restituido.
/** @param {Doc} doc @param {Ucs} u @param {string} [name] */
export function setUcs(doc, u, name) {
  doc.ucsPrev ||= [];
  doc.ucsPrev.push(doc.ucs || null);
  if (doc.ucsPrev.length > PREV_MAX) doc.ucsPrev.shift();
  doc.ucs = isWorld(u) ? null : { o: G.P(u.o.x, u.o.y), ang: G.normAng(u.ang), ...(name ? { name } : {}) };
  doc.changed();
}
/** @param {Doc} doc @returns {boolean} */
export function prevUcs(doc) {
  if (!doc.ucsPrev?.length) return false;
  doc.ucs = doc.ucsPrev.pop();
  doc.changed();
  return true;
}
/** @param {Doc} doc @returns {string} */
export const ucsName = doc => (!doc.ucs ? 'Universal' : doc.ucs.name || 'Sin nombre');
/** @param {Doc} doc @param {string} name @returns {Ucs | undefined} */
export const findUcs = (doc, name) => doc.ucsList.find(u => u.name.toLowerCase() === String(name).trim().toLowerCase());
/** @param {string} n @returns {boolean} */
export const validUcsName = n => /^[^<>/\\":;?*|,=`]{1,255}$/.test(n) && !/^(universal|world|previo|previous|\*)/i.test(n);
/** @param {Doc} doc @param {string} name @returns {Ucs} */
export function saveUcs(doc, name) {
  const u = doc.ucs || WORLD, old = findUcs(doc, name), rec = { name: old?.name || name, o: G.P(u.o.x, u.o.y), ang: u.ang };
  if (old) Object.assign(old, rec); else doc.ucsList.push(rec);
  if (doc.ucs) doc.ucs.name = rec.name;
  doc.changed();
  return rec;
}
/** @param {Doc} doc @param {string} name @returns {boolean} */
export function deleteUcs(doc, name) {
  const u = findUcs(doc, name);
  if (!u) return false;
  doc.ucsList = doc.ucsList.filter(x => x !== u);
  if (doc.ucs?.name === u.name) delete doc.ucs.name;
  doc.changed();
  return true;
}
/** @param {Doc} doc @param {Ucs} u @param {string} name */
export function renameUcs(doc, u, name) {
  if (doc.ucs?.name === u.name) doc.ucs.name = name;
  u.name = name;
  doc.changed();
}

// SCP por tres puntos: origen, punto del eje X positivo (y punto del plano XY positivo, que en 2D no cambia nada)
/** @param {Point} o origen @param {Point} [px] punto del eje X @returns {Ucs} */
export const ucs3P = (o, px) => ({ o, ang: px && G.dist(o, px) > 1e-12 ? G.ang(o, px) : 0 });

// SCP alineado con un objeto, como en AutoCAD: línea (origen en el extremo más cercano al punto designado),
// arco y círculo (centro, eje X hacia el extremo o el punto designado), polilínea (primer vértice y primer tramo),
// textos, bloques, atributos y cotas (punto de inserción y rotación), elipse (centro y eje mayor)
/** @param {import('./types').Entity} e @param {Point} pick @returns {Ucs | null} */
export function ucsFromObject(e, pick) {
  switch (e.type) {
    case 'line': {
      const near = G.dist(pick, e.p1) <= G.dist(pick, e.p2), o = near ? e.p1 : e.p2, q = near ? e.p2 : e.p1;
      return { o, ang: G.ang(o, q) };
    }
    case 'circle': return { o: e.c, ang: G.dist(e.c, pick) > 1e-12 ? G.ang(e.c, pick) : 0 };
    case 'arc': {
      const a = G.polar(e.c, e.a1, e.r), b = G.polar(e.c, e.a2, e.r);
      return { o: e.c, ang: G.dist(pick, a) <= G.dist(pick, b) ? e.a1 : e.a2 };
    }
    case 'pline': case 'mline': return e.pts.length > 1 ? { o: e.pts[0], ang: G.ang(e.pts[0], e.pts[1]) } : null;
    case 'ellipse': return { o: e.c, ang: e.rot || 0 };
    case 'point': return { o: e.p, ang: 0 };
    case 'text': case 'mtext': case 'attdef': case 'insert': case 'table': return e.p ? { o: e.p, ang: e.rot || 0 } : null;
    default: {
      const q = primsOf(e).find(x => x.k === 's');
      return q ? { o: q.a, ang: G.ang(q.a, q.b) } : null;
    }
  }
}
