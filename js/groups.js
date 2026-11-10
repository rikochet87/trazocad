// Grupos (GROUP): conjuntos de objetos con nombre que se designan juntos, como en AutoCAD.
/** @typedef {import('./document.js').Doc} Doc */
/** @typedef {import('./types').Entity} Entity */
/** @typedef {import('./types').Point} Point */
/** @typedef {import('./types').Group} Group */
// @ts-check
// doc.groups = [{name, desc, ids: [identificadores], sel: seleccionable}]. Los grupos sin nombre se llaman *A1, *A2…
// Un objeto puede estar en varios grupos. Cuando la selección de grupos está activada (botón GRUPO, Ctrl+Mayús+A),
// designar un miembro de un grupo seleccionable designa el grupo entero.

/** @param {string} name @returns {boolean} */
export const isAnonGroup = name => String(name).startsWith('*');
/** @param {string} name @returns {boolean} */
export const validGroupName = name => !!name && !name.startsWith('*') && !/[<>/\\":;?*|=`,]/.test(name) && name.length <= 255;
/** @param {Doc} doc @param {string} name @returns {Group | null} */
export const findGroup = (doc, name) => doc.groups.find(g => g.name.toLowerCase() === String(name).trim().toLowerCase()) || null;
/** @param {Doc} doc @returns {string} */
export function nextAnonGroup(doc) { let i = 1; while (doc.groups.some(g => g.name === `*A${i}`)) i++; return `*A${i}`; }
// Grupos a los que pertenece un objeto (del más reciente al más antiguo)
/** Grupos del objeto, del más reciente al más antiguo. @param {Doc} doc @param {number} id @returns {Group[]} */
export const groupsOf = (doc, id) => doc.groups.filter(g => g.ids.includes(id)).reverse();

// Crea un grupo (name null: sin nombre). Devuelve el grupo
/** @param {Doc} doc @param {string | null} name null: sin nombre @param {Iterable<number>} ids @param {string} [desc] @returns {Group} */
export function makeGroup(doc, name, ids, desc = '') {
  const g = { name: name || nextAnonGroup(doc), desc, ids: [...new Set(ids)], sel: true };
  doc.groups.push(g);
  doc.changed();
  return g;
}
/** @param {Doc} doc @param {Group} g */
export function removeGroup(doc, g) { doc.groups = doc.groups.filter(x => x !== g); doc.changed(); }

// Identificadores más los miembros de los grupos seleccionables a los que pertenecen
/** Los objetos y los demás miembros de sus grupos seleccionables. @param {Doc} doc @param {Iterable<number>} ids @returns {Set<number>} */
export function expandGroups(doc, ids) {
  const out = new Set(ids);
  if (!doc.groups.length) return out;
  for (const g of doc.groups) if (g.sel && g.ids.some(id => out.has(id))) for (const id of g.ids) out.add(id);
  return out;
}

// Tras copiar objetos (map: original → copia), cada grupo copiado entero da lugar a un grupo sin nombre con las copias
/** @param {Doc} doc @param {Map<number, number>} map original → copia @returns {number} grupos creados */
export function copyGroups(doc, map) {
  if (!doc.groups.length || !map.size) return 0;
  let n = 0;
  for (const g of [...doc.groups]) {
    if (!g.ids.length || !g.ids.every(id => map.has(id))) continue;
    doc.groups.push({ name: nextAnonGroup(doc), desc: g.desc, ids: g.ids.map(id => map.get(id)), sel: g.sel });
    n++;
  }
  return n;
}

// Quita de los grupos los objetos que ya no existen y elimina los grupos vacíos. Devuelve true si cambió algo
/** @param {Doc} doc @returns {boolean} */
export function cleanGroups(doc) {
  if (!doc.groups.length) return false;
  let changed = false;
  for (const g of doc.groups) {
    const ids = g.ids.filter(id => doc.byId.has(id));
    if (ids.length !== g.ids.length) { g.ids = ids; changed = true; }
  }
  const n = doc.groups.length;
  doc.groups = doc.groups.filter(g => g.ids.length);
  return changed || n !== doc.groups.length;
}

// Grupos contenidos por completo en una lista de objetos (para el portapapeles): [{name, desc, sel, ids}]
/** Grupos con todos sus miembros entre ids. @param {Doc} doc @param {Iterable<number>} ids */
export const groupsWithin = (doc, ids) => { const set = new Set(ids); return doc.groups.filter(g => g.ids.length && g.ids.every(id => set.has(id))).map(g => ({ ...g, ids: [...g.ids] })); };
