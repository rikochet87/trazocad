// Selección por propiedades: condiciones de QSELECT y filtros de selección con nombre (FILTER).
// Una condición es {type, prop, op, value}: type '*' (cualquier tipo) o un tipo de objeto; prop, una propiedad general
// (Color, Capa…) o una de la paleta Propiedades de ese tipo; op, un operador de OPS.
import * as G from './geom.js';
import { TYPES, propsOf, COLORS, aciToHex } from './entities.js';

export const OPS = { '=': 'Igual a', '<>': 'Distinto de', '>': 'Mayor que', '<': 'Menor que', '>=': 'Mayor o igual que', '<=': 'Menor o igual que', '*': 'Comodín (* ?)', 'all': 'Seleccionar todo' };
const GENERAL = {
  Color: e => e.color, Capa: e => e.layer, 'Tipo de línea': e => e.ltype, 'Grosor de línea': e => e.lw, 'Estilo de trazado': e => e.pstyle || 'BYLAYER',
  Tipo: e => TYPES[e.type]?.name || e.type,
};
export const GENERAL_PROPS = Object.keys(GENERAL);

const usable = pr => !pr.sec && pr.type !== 'action' && pr.type !== 'table' && pr.get;
// Propiedades que se pueden consultar en los objetos de un tipo ('*': sólo las generales)
export function propNames(ents, type = '*') {
  const out = [...GENERAL_PROPS];
  if (type === '*') return out;
  const seen = new Set(out);
  for (const e of ents) {
    if (e.type !== type) continue;
    for (const pr of propsOf(e)) if (usable(pr) && !seen.has(pr.label)) { seen.add(pr.label); out.push(pr.label); }
  }
  return out;
}
// Valor de una propiedad (los ángulos, en grados) o undefined si el objeto no la tiene
export function propValue(e, prop) {
  if (GENERAL[prop]) return GENERAL[prop](e);
  const pr = TYPES[e.type] && propsOf(e).find(q => usable(q) && q.label === prop);
  if (!pr) return undefined;
  const v = pr.get(e);
  return pr.type === 'ang' ? G.deg(G.normAng(v)) : v;
}

// Colores escritos por el usuario: «PorCapa», «PorBloque», nombres (rojo…), números ACI o #rrggbb
function colorKey(v) {
  const s = String(v).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^(porcapa|bylayer)$/.test(s)) return 'BYLAYER';
  if (/^(porbloque|byblock)$/.test(s)) return 'BYBLOCK';
  if (/^\d{1,3}$/.test(s)) return aciToHex(+s).toLowerCase();
  const named = COLORS.find(([, n]) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === s);
  return named ? named[0] : s;
}
const lwKey = v => { const s = String(v).trim().toLowerCase(); return /^(porcapa|bylayer)$/.test(s) ? 'BYLAYER' : /^(por defecto|defecto|default)$/.test(s) ? 'DEFAULT' : s; };
const wildRe = pat => new RegExp('^' + String(pat).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'is');
const numOf = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\s*[-+]?(\d+[.,]?\d*|[.,]\d+)(e[-+]?\d+)?\s*$/i.test(v) ? parseFloat(v.replace(',', '.')) : null);

// ¿Cumple el objeto la condición?
export function testCond(e, k) {
  if (k.type && k.type !== '*' && e.type !== k.type) return false;
  if (k.op === 'all') return true;
  let v = propValue(e, k.prop);
  if (v === undefined) return false;
  let want = k.value;
  if (k.prop === 'Color') { v = colorKey(v); want = colorKey(want); }
  else if (k.prop === 'Grosor de línea') { v = lwKey(v); want = lwKey(want); }
  if (k.op === '*') return wildRe(want).test(String(v));
  const a = numOf(v), b = numOf(want);
  if (a !== null && b !== null) {
    const eq = Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    switch (k.op) {
      case '=': return eq; case '<>': return !eq;
      case '>': return a > b && !eq; case '<': return a < b && !eq;
      case '>=': return a > b || eq; case '<=': return a < b || eq;
    }
    return false;
  }
  const sa = typeof v === 'boolean' ? (v ? 'sí' : 'no') : String(v).toLowerCase(), sb = String(want).trim().toLowerCase();
  switch (k.op) {
    case '=': return sa === sb; case '<>': return sa !== sb;
    case '>': return sa > sb; case '<': return sa < sb; case '>=': return sa >= sb; case '<=': return sa <= sb;
  }
  return false;
}

// Objetos en que se busca: los designables del espacio actual o los de la lista ids
export function candidates(doc, ids) {
  const list = ids ? ids.map(id => doc.get(id)).filter(Boolean) : doc.ents;
  return list.filter(e => doc.visible(e) && !doc.locked(e));
}
// QSELECT. q: {type, prop, op, value, exclude} → identificadores
export function qselect(ents, q) {
  return ents.filter(e => testCond(e, q) !== !!q.exclude).map(e => e.id);
}

// ---------- Filtros de selección con nombre ----------
// {name, join: 'and'|'or', conds: [{type, prop, op, value, not}]}
export const findFilter = (doc, name) => doc.selFilters.find(f => f.name.toLowerCase() === String(name).trim().toLowerCase());
export function testFilter(e, f) {
  if (!f.conds.length) return true;
  const t = k => testCond(e, k) !== !!k.not;
  return f.join === 'or' ? f.conds.some(t) : f.conds.every(t);
}
export const applyFilter = (ents, f) => ents.filter(e => testFilter(e, f)).map(e => e.id);
export const condText = k => `${k.not ? 'NO ' : ''}${k.type && k.type !== '*' ? `${TYPES[k.type]?.name || k.type}: ` : ''}${k.op === 'all' ? 'todos' : `${k.prop} ${k.op === '*' ? '≈' : k.op} ${k.value}`}`;
