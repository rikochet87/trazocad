// Estados de capa (LAYERSTATE): la configuración de las capas guardada con un nombre, que se restaura de una vez.
// doc.layerStates = [{name, desc, cur: capa actual, layers: {capa: {on, lock, color, ltype, lw}}, saved: fecha ISO}]
import { aciToHex, hexToAci } from './colors.js';

// Propiedades que guarda un estado y que se pueden restaurar por separado
export const LS_PROPS = { on: 'Activada / desactivada', lock: 'Bloqueada', color: 'Color', ltype: 'Tipo de línea', lw: 'Grosor de línea' };
export const LS_ALL = Object.keys(LS_PROPS);

export const findLayerState = (doc, name) => doc.layerStates.find(s => s.name.toLowerCase() === String(name).trim().toLowerCase()) || null;
export const validStateName = name => !!name && !/[<>/\\":;?*|=`]/.test(name) && name.length <= 255;

const snapshot = doc => Object.fromEntries(doc.layers.map(l => [l.name, Object.fromEntries(LS_ALL.map(k => [k, l[k]]))]));

// Guarda (o actualiza) un estado con la configuración actual de las capas. Devuelve el estado
export function saveLayerState(doc, name, desc) {
  let s = findLayerState(doc, name);
  if (!s) { s = { name: name.trim(), desc: '' }; doc.layerStates.push(s); }
  if (desc != null) s.desc = desc;
  Object.assign(s, { cur: doc.cur.layer, layers: snapshot(doc), saved: new Date().toISOString() });
  doc.changed();
  return s;
}

// Restaura un estado. o.props: propiedades que se restauran (todas por defecto); o.offMissing: desactiva las capas que no
// estaban en el estado (las creadas después). Devuelve {changed: capas modificadas, missing: capas del estado que ya no existen}
export function restoreLayerState(doc, s, o = {}) {
  const props = o.props || LS_ALL, out = { changed: 0, missing: 0 };
  const known = new Set(Object.keys(s.layers));
  for (const l of doc.layers) {
    const v = s.layers[l.name];
    const before = JSON.stringify(LS_ALL.map(k => l[k]));
    if (v) { for (const k of props) if (v[k] !== undefined) l[k] = v[k]; }
    else if (o.offMissing) l.on = false;
    if (JSON.stringify(LS_ALL.map(k => l[k])) !== before) out.changed++;
  }
  for (const n of known) if (!doc.layers.some(l => l.name === n)) out.missing++;
  if (s.cur && doc.layers.some(l => l.name === s.cur)) doc.cur.layer = s.cur;
  doc.changed();
  return out;
}

// ¿La configuración actual coincide con el estado? (para marcarlo en el administrador)
export function layerStateMatches(doc, s) {
  const now = snapshot(doc);
  return Object.entries(s.layers).every(([n, v]) => !now[n] || LS_ALL.every(k => now[n][k] === v[k]));
}

export function renameLayerState(doc, s, name) { s.name = name.trim(); doc.changed(); }
export function deleteLayerState(doc, s) { doc.layerStates = doc.layerStates.filter(x => x !== s); doc.changed(); }
// Al renombrar una capa, los estados que la guardan se actualizan
export function renameLayerInStates(doc, from, to) {
  for (const s of doc.layerStates) {
    if (s.layers[from]) { s.layers[to] = s.layers[from]; delete s.layers[from]; }
    if (s.cur === from) s.cur = to;
  }
}

// ---------- Archivos .las de AutoCAD ----------
// Texto con pares código/valor como un DXF: LAYERSTATEDICT y un LAYERSTATE por estado (1 nombre, 301 descripción, 302 capa
// actual) seguido de sus capas (8 nombre, 90 indicadores: 1 desactivada, 2 inutilizada, 4 bloqueada, 8 imprimible;
// 62 color ACI, 92 color verdadero, 370 grosor en centésimas de mm, 6 tipo de línea).
const LW_CODES = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const lwOut = lw => (lw === 'BYLAYER' ? -1 : lw === 'BYBLOCK' ? -2 : lw === 'DEFAULT' || lw == null ? -3 : Math.round(lw * 100));
const lwIn = v => { const n = parseInt(v, 10); return n < 0 || Number.isNaN(n) ? 'DEFAULT' : (LW_CODES.includes(n) ? n : 25) / 100; };
const ltOut = lt => (!lt || lt === 'CONTINUOUS' ? 'Continuous' : lt);

export function writeLas(doc, states) {
  const o = [], g = (c, v) => o.push(String(c).padStart(3, ' '), String(v));
  g(0, 'LAYERSTATEDICT');
  for (const s of states) {
    g(0, 'LAYERSTATE'); g(1, s.name); g(91, 2047); g(301, s.desc || ''); g(290, 0); g(302, s.cur || '0');
    for (const [name, v] of Object.entries(s.layers)) {
      const aci = hexToAci(v.color || '#ffffff');
      g(8, name); g(90, (v.on === false ? 1 : 0) | (v.lock ? 4 : 0) | 8);
      g(62, aci); g(370, lwOut(v.lw)); g(6, ltOut(v.ltype)); g(2, `Color_${aci}`); g(440, 33554687);
      if ((v.color || '').toLowerCase() !== aciToHex(aci).toLowerCase()) g(92, parseInt(v.color.slice(1), 16));
    }
  }
  return o.join('\r\n') + '\r\n';
}

// Estados de capa de un archivo .las: [{name, desc, cur, layers, saved}]
export function readLas(text, known = {}) {
  const lines = text.split(/\r?\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(c)) { i--; continue; }
    pairs.push([c, lines[i + 1].trim()]);
  }
  const out = [];
  let s = null, l = null;
  for (const [c, v] of pairs) {
    if (c === 0) { l = null; s = v.toUpperCase() === 'LAYERSTATE' ? { name: '', desc: '', cur: '0', layers: {}, saved: new Date().toISOString() } : null; if (s) out.push(s); continue; }
    if (!s) continue;
    if (c === 1 && !s.name) s.name = v;
    else if (c === 301) s.desc = v;
    else if (c === 302) s.cur = v;
    else if (c === 8) { l = { on: true, lock: false, color: '#ffffff', ltype: 'CONTINUOUS', lw: 'DEFAULT' }; s.layers[v] = l; }
    else if (!l) continue;
    else if (c === 90) { const f = parseInt(v, 10) || 0; l.on = !(f & 1) && !(f & 2); l.lock = !!(f & 4); }
    else if (c === 62) { const a = parseInt(v, 10); if (a < 0) l.on = false; if (Math.abs(a) >= 1 && Math.abs(a) <= 255) l.color = aciToHex(Math.abs(a)); }
    else if (c === 92 || c === 420) l.color = '#' + ((parseInt(v, 10) >>> 0) & 0xffffff).toString(16).padStart(6, '0');
    else if (c === 370) l.lw = lwIn(v);
    else if (c === 6) { const t = v.toUpperCase(); l.ltype = known[t] ? t : 'CONTINUOUS'; }
  }
  return out.filter(x => x.name);
}
