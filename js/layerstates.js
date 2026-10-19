// Estados de capa (LAYERSTATE): la configuración de las capas guardada con un nombre, que se restaura de una vez.
// doc.layerStates = [{name, desc, cur: capa actual, layers: {capa: {on, lock, color, ltype, lw}}, saved: fecha ISO}]

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
