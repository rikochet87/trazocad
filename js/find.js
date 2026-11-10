// Buscar y reemplazar texto (FIND) en textos, textos de líneas múltiples, atributos, cotas, directrices y tablas.
/** @typedef {import('./document.js').Doc} Doc */
/** @typedef {import('./types').Entity} Entity */
/** @typedef {import('./types').Point} Point */
/** Texto de un objeto que se puede buscar y reemplazar. @typedef {{kind: string, label: string, get: (e: Entity) => string, set: (e: Entity, v: string) => void}} TextSlot */
/** @typedef {{matchCase?: boolean, whole?: boolean, wild?: boolean, kinds?: string[]}} FindOpts */
// @ts-check
import { TYPES, blockAttdefs, attVal } from './entities.js';

/** @type {Record<string, string>} */
export const FIND_KINDS = { text: 'Textos', mtext: 'Textos de líneas múltiples', attrib: 'Valores de atributo', attdef: 'Definiciones de atributo', dim: 'Textos de cota', mleader: 'Directrices', table: 'Tablas' };

// Textos de un objeto que se pueden buscar: [{kind, label, get, set}]
/** @param {Entity} e @returns {TextSlot[]} */
export function textSlots(e) {
  const slot = (kind, label, get, set) => ({ kind, label, get, set });
  switch (e.type) {
    case 'text': return [slot('text', 'Contenido', x => x.text || '', (x, v) => { x.text = v; })];
    case 'mtext': return [slot('mtext', 'Contenido', x => x.text || '', (x, v) => { x.text = v; })];
    case 'attdef': return [slot('attdef', 'Valor por defecto', x => x.def || '', (x, v) => { x.def = v; }), slot('attdef', 'Solicitud', x => x.prompt || '', (x, v) => { x.prompt = v; })];
    case 'dim': return e.text && e.text !== '<>' ? [slot('dim', 'Texto de cota', x => x.text || '', (x, v) => { x.text = v; })] : [];
    case 'mleader': return e.text ? [slot('mleader', 'Texto', x => x.text || '', (x, v) => { x.text = v; })] : [];
    case 'insert': return blockAttdefs(e.name).map(a => slot('attrib', `Atributo ${a.tag}`, x => String(attVal(x, a)), (x, v) => { x.attribs = { ...x.attribs, [a.tag]: v }; }));
    case 'table': {
      const out = [];
      (e.cells || []).forEach((row, r) => (row || []).forEach((s, c) => {
        if (typeof s === 'string' && s) out.push(slot('table', `Celda ${String.fromCharCode(65 + (c % 26))}${r + 1}`, x => x.cells[r]?.[c] || '', (x, v) => { x.cells = x.cells.map(rw => [...rw]); x.cells[r][c] = v; }));
      }));
      return out;
    }
    default: return [];
  }
}

// Expresión regular global para el texto buscado. o: {matchCase, whole, wild}
/** @param {string} q @param {FindOpts} [o] @returns {RegExp} */
export function matcher(q, o = {}) {
  let src = String(q).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  if (o.wild) src = src.replace(/\*/g, '.*?').replace(/\?/g, '.'); else src = src.replace(/[*?]/g, '\\$&');
  if (o.whole) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `gu${o.matchCase ? '' : 'i'}`);
}

// Coincidencias en las entidades: [{e, slot, text, n}]. o.kinds: tipos de texto en que se busca (todos si falta)
/** @param {Iterable<Entity>} ents @param {string} q @param {FindOpts} [o] @returns {{e: Entity, slot: TextSlot, text: string, n: number}[]} */
export function findText(ents, q, o = {}) {
  if (!q) return [];
  const re = matcher(q, o), out = [];
  for (const e of ents) {
    if (!TYPES[e.type]) continue;
    for (const s of textSlots(e)) {
      if (o.kinds && !o.kinds.includes(s.kind)) continue;
      const text = s.get(e), n = (text.match(re) || []).length;
      if (n) out.push({ e, slot: s, text, n });
    }
  }
  return out;
}
// Reemplaza en los resultados (dentro de una transacción). El reemplazo es literal ($ no tiene significado especial).
/** @param {Doc} doc @param {{e: Entity, slot: TextSlot, text: string, n: number}[]} results @param {string} q @param {string} rep @param {FindOpts} [o] @returns {number} */
export function replaceText(doc, results, q, rep, o = {}) {
  const re = matcher(q, o);
  let n = 0;
  for (const r of results) {
    doc.modify(r.e.id, /** @param {Entity} x */ x => {
      const t = r.slot.get(x), nt = t.replace(re, () => { n++; return rep; });
      if (nt !== t) r.slot.set(x, nt);
    });
  }
  return n;
}
