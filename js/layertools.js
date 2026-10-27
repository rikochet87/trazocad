// Herramientas de capas: aislar y desaislar (LAYISO, LAYUNISO), recorrer (LAYWALK), fusionar (LAYMRG)
// y filtros de capa por propiedades y por grupos (paleta de capas).

// Todas las listas de entidades del dibujo, incluidas las de los bloques y los objetos de origen de las matrices
function* everyEnt(doc) {
  const walk = function* (list) { for (const e of list) { yield e; if (e.type === 'array' && e.src) yield* walk(e.src); } };
  yield* walk([...doc.allEnts()]);
  for (const b of Object.values(doc.blocks)) yield* walk(b.ents);
}
export function usedLayers(doc) {
  const s = new Set(['0', doc.cur.layer]);
  for (const e of everyEnt(doc)) s.add(e.layer);
  return s;
}

// ---------- Aislar ----------
// mode: 'off' desactiva las demás capas; 'lock' las bloquea. Guarda el estado anterior para LAYUNISO.
export function layIso(doc, names, mode = 'off') {
  const keep = new Set(names);
  doc.layIso = { mode, cur: doc.cur.layer, layers: Object.fromEntries(doc.layers.map(l => [l.name, { on: l.on, lock: l.lock }])) };
  for (const l of doc.layers) {
    if (keep.has(l.name)) { l.on = true; if (mode === 'lock') l.lock = false; }
    else if (mode === 'lock') l.lock = true;
    else l.on = false;
  }
  if (!keep.has(doc.cur.layer)) doc.cur.layer = names[0];
  doc.changed();
}
// Devuelve el número de capas restauradas, o -1 si no hay nada aislado
export function layUniso(doc) {
  const s = doc.layIso;
  if (!s) return -1;
  let n = 0;
  for (const l of doc.layers) {
    const o = s.layers[l.name];
    if (o && (l.on !== o.on || l.lock !== o.lock)) { l.on = o.on; l.lock = o.lock; n++; }
  }
  if (doc.layers.some(l => l.name === s.cur)) doc.cur.layer = s.cur;
  doc.layIso = null;
  doc.changed();
  return n;
}

// ---------- Fusionar ----------
// Pasa los objetos de las capas from a la capa to y elimina las capas from. Devuelve el número de objetos movidos.
export function layMerge(doc, from, to) {
  const src = new Set(from.filter(n => n !== to && n !== '0'));
  let n = 0;
  for (const e of everyEnt(doc)) if (src.has(e.layer)) { e.layer = to; n++; }
  for (const e of doc.allEnts()) {
    if (e.type === 'vport' && e.frozen) { const f = [...new Set(e.frozen.map(x => (src.has(x) ? to : x)))]; if (f.length) e.frozen = f; else delete e.frozen; }
  }
  for (const s of doc.layerStates) for (const k of src) delete s.layers[k];
  for (const f of doc.layerFilters) if (f.layers) f.layers = [...new Set(f.layers.map(x => (src.has(x) ? to : x)))];
  if (src.has(doc.cur.layer)) doc.cur.layer = to;
  doc.layers = doc.layers.filter(l => !src.has(l.name));
  doc.changed();
  return n;
}

// ---------- Filtros ----------
// {name, kind: 'prop', rules: {name, color, on, lock, ltype, lw, used}} o {name, kind: 'group', layers: [...]}
export const LF_RULES = { name: 'Nombre (* ?, varios separados por comas)', color: 'Color', on: 'Activada', lock: 'Bloqueada', ltype: 'Tipo de línea', lw: 'Grosor de línea', used: 'En uso' };
export const findLayerFilter = (doc, name) => doc.layerFilters.find(f => f.name.toLowerCase() === String(name).trim().toLowerCase());
const wild = p => new RegExp('^' + p.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
const yes = v => /^(s|si|sí|1|true|y|yes)$/i.test(String(v).trim());
// ¿Pasa la capa l el filtro f? used: conjunto de capas en uso (se calcula una vez por lista)
export function layerMatches(f, l, used) {
  if (f.kind === 'group') return f.layers.includes(l.name);
  const r = f.rules || {};
  if (r.name && !r.name.split(',').some(p => p.trim() && wild(p).test(l.name))) return false;
  if (r.color && l.color.toLowerCase() !== String(r.color).toLowerCase()) return false;
  if (r.on !== undefined && r.on !== '' && l.on !== yes(r.on)) return false;
  if (r.lock !== undefined && r.lock !== '' && l.lock !== yes(r.lock)) return false;
  if (r.ltype && l.ltype !== r.ltype) return false;
  if (r.lw !== undefined && r.lw !== '' && String(l.lw) !== String(r.lw)) return false;
  if (r.used !== undefined && r.used !== '' && used.has(l.name) !== yes(r.used)) return false;
  return true;
}
// Capas que muestra la paleta con el filtro de nombre fname ('' = todas, '*usadas*' = en uso) y su inversión
export function filteredLayers(doc, fname, invert = false) {
  if (!fname && !invert) return doc.layers;
  const used = usedLayers(doc);
  const f = fname === '*usadas*' ? { kind: 'prop', rules: { used: 'sí' } } : findLayerFilter(doc, fname);
  if (!f) return doc.layers;
  return doc.layers.filter(l => layerMatches(f, l, used) !== invert);
}
