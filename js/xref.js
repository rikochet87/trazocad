// Referencias externas: otro dibujo (.tcad o .dxf) insertado como bloque vinculado a su archivo.
/** @typedef {import('./document.js').Doc} Doc */
/** @typedef {import('./types').Entity} Entity */
/** @typedef {import('./types').Point} Point */
/** @typedef {import('./types').BBox} BBox */
// @ts-check
// El contenido se guarda en caché dentro del dibujo (bloque con `xref: {file, loaded}`) y se actualiza con Recargar.
// Las capas, bloques y estilos de la referencia llevan el prefijo "NOMBRE|", como en AutoCAD; al unirla pasan a "NOMBRE$0$".
import { cloneEnt } from './entities.js';
import { readDXF } from './dxf.js';

/** @param {Doc} doc @param {string} name @returns {boolean} */
export const isXref = (doc, name) => !!doc.blocks[name]?.xref;

// ---- Archivos recordados entre sesiones (IndexedDB, clave = nombre del archivo) ----
// Con acceso al sistema de archivos se guarda su manejador (el archivo se relee al abrir el dibujo si el navegador mantiene
// el permiso); sin él, una copia del archivo, que basta para recuperar la referencia de un DXF exportado.
const XDB = 'trazocad', XSTORE = 'xrefs';
function xdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(XDB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(XSTORE)) r.result.createObjectStore(XSTORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function xtx(mode, fn) {
  const db = await xdb();
  return new Promise((res, rej) => {
    const t = db.transaction(XSTORE, mode), req = fn(t.objectStore(XSTORE));
    t.oncomplete = () => { db.close(); res(req?.result); };
    t.onerror = t.onabort = () => { db.close(); rej(t.error); };
  });
}
/** Recuerda en el navegador el archivo (copia o manejador) de la referencia. @param {string} file @param {Blob | FileSystemFileHandle} source @returns {Promise<boolean>} */
export async function rememberXref(file, source) {
  if (!file || !source || typeof indexedDB === 'undefined') return false;
  try { await xtx('readwrite', st => st.put(source, file)); return true; } catch { return false; }
}
/** @param {string} file @returns {Promise<Blob | FileSystemFileHandle | null>} */
export async function recallXref(file) {
  if (!file || typeof indexedDB === 'undefined') return null;
  try { return (await xtx('readonly', st => st.get(file))) || null; } catch { return null; }
}
/** @param {string} file @returns {Promise<void>} */
export async function forgetXref(file) { try { await xtx('readwrite', st => st.delete(file)); } catch { /* sin almacenamiento */ } }
// Archivo de lo recordado: copia guardada o manejador (pide permiso de lectura sólo con ask, que necesita un gesto del usuario)
/** @param {Blob | FileSystemFileHandle | null} src @param {boolean} [ask] @returns {Promise<Blob | null>} */
export async function recalledFile(src, ask = false) {
  if (!src) return null;
  if (typeof Blob !== 'undefined' && src instanceof Blob) return src;
  const h = /** @type {FileSystemFileHandle} */ (src); // no es una copia: es un manejador
  try {
    if (h.queryPermission) {
      let p = await h.queryPermission({ mode: 'read' });
      if (p !== 'granted' && ask && h.requestPermission) p = await h.requestPermission({ mode: 'read' });
      if (p !== 'granted') return null;
    }
    return await h.getFile();
  } catch { return null; }
}
// Recarga las referencias del dibujo cuyos archivos se recuerdan y se pueden leer sin preguntar.
// Las copias guardadas sólo se usan si la referencia está vacía (DXF exportado). Devuelve {loaded, missing}
export async function restoreXrefs(doc) {
  let loaded = 0, missing = 0;
  for (const name of xrefNames(doc)) {
    const b = doc.blocks[name], src = await recallXref(b.xref.file);
    const isCopy = typeof Blob !== 'undefined' && src instanceof Blob;
    const f = src && (!isCopy || !b.ents.length) ? await recalledFile(src) : null;
    if (!f) { if (!b.ents.length) missing++; continue; }
    try { defineXref(doc, name, parseSource(await f.text(), b.xref.file), b.xref.file); loaded++; } catch { missing++; }
  }
  return { loaded, missing };
}
/** @param {Doc} doc @returns {string[]} */
export const xrefNames = doc => Object.keys(doc.blocks).filter(n => doc.blocks[n].xref);
/** @param {string} s @returns {string} */
export const cleanXrefName = s => String(s).replace(/\.[^.]+$/, '').replace(/[|<>/\\":;?*=`]/g, '_').trim() || 'Referencia';

// Contenido de un archivo: {ents, layers, blocks, textStyles, dimStyles, base}
export function parseSource(text, fileName) {
  if (/\.dxf$/i.test(fileName)) {
    const r = readDXF(text);
    return { ents: r.ents, layers: r.layers, blocks: r.blocks, textStyles: r.textStyles, dimStyles: r.dimStyles || [], mlineStyles: r.mlineStyles || [], patterns: r.patterns || {}, base: r.insBase || { x: 0, y: 0 } };
  }
  const o = JSON.parse(text);
  if (o.app !== 'TrazoCAD') throw new Error('El archivo no es un dibujo de TrazoCAD ni un DXF');
  return { ents: o.model || o.ents || [], layers: o.layers || [], blocks: o.blocks || {}, textStyles: o.textStyles || [], dimStyles: o.dimStyles || [], mlineStyles: o.mlineStyles || [], patterns: o.patterns || {}, base: o.settings?.insBase || { x: 0, y: 0 } };
}

const STRIP = ['id', 'assoc', 'seed', '_xf', '_h', 'pathId'];
// Define (o actualiza) la referencia `name` con el contenido `src`. Devuelve el número de objetos.
/** @param {Doc} doc @param {string} name @param {ReturnType<typeof parseSource>} src contenido del archivo @param {string} fileName */
export function defineXref(doc, name, src, fileName) {
  const pre = n => `${name}|${n}`;
  const lay = n => (!n || n === '0' ? '0' : pre(n));
  const blk = n => pre(n);
  const tsty = new Set(src.textStyles.map(s => s.name)), dsty = new Set(src.dimStyles.map(s => s.name)), msty = new Set((src.mlineStyles || []).map(s => s.name));
  const conv = e => {
    const c = cloneEnt(e);
    for (const k of STRIP) delete c[k];
    c.layer = lay(c.layer);
    if (c.type === 'insert') c.name = blk(c.name);
    if (c.style && (c.type === 'dim' ? dsty : tsty).has(c.style)) c.style = pre(c.style);
    if (c.type === 'mline' && msty.has(c.mlstyle || 'STANDARD')) c.mlstyle = pre(c.mlstyle || 'STANDARD');
    if (c.type === 'array') c.src = c.src.map(conv);
    return c;
  };
  // Capas: se conservan el estado y el color de las que ya existían (recarga)
  for (const l of src.layers) {
    if (l.name === '0') continue;
    const nm = pre(l.name), old = doc.layers.find(x => x.name === nm);
    if (!old) doc.layers.push({ ...l, name: nm, xref: name });
  }
  for (const s of src.textStyles) if (!doc.textStyles.some(t => t.name === pre(s.name))) doc.textStyles.push({ ...s, name: pre(s.name) });
  for (const s of src.dimStyles) if (!doc.dimStyles.some(t => t.name === pre(s.name))) doc.dimStyles.push({ ...s, name: pre(s.name), textStyle: tsty.has(s.textStyle) ? pre(s.textStyle) : s.textStyle });
  for (const s of src.mlineStyles || []) if (!doc.mlineStyles.some(t => t.name === pre(s.name))) doc.mlineStyles.push({ ...JSON.parse(JSON.stringify(s)), name: pre(s.name) });
  for (const [n, p] of Object.entries(src.patterns || {})) doc.patterns[n] ??= p; // patrones personalizados de sus sombreados
  // Bloques anidados de la referencia (las referencias externas anidadas quedan como bloques dependientes)
  for (const k of Object.keys(doc.blocks)) if (doc.blocks[k].xrefDep === name) delete doc.blocks[k];
  for (const [bn, b] of Object.entries(src.blocks)) {
    doc.blocks[blk(bn)] = { name: blk(bn), base: { ...b.base }, ents: b.ents.map(conv), ver: (doc.blocks[blk(bn)]?.ver || 0) + 1, xrefDep: name };
  }
  const ents = src.ents.map(conv);
  const old = doc.blocks[name];
  doc.blocks[name] = { name, base: { x: src.base.x, y: src.base.y }, ents, ver: (old?.ver || 0) + 1, xref: { file: fileName, loaded: new Date().toISOString() } };
  doc.changed();
  return ents.length;
}

const usesPrefix = (n, name) => typeof n === 'string' && n.startsWith(`${name}|`);
function eachEnt(doc, fn) {
  for (const arr of doc.lists()) for (const e of arr) fn(e, arr);
  for (const b of Object.values(doc.blocks)) for (const e of b.ents) fn(e, b.ents);
}
/** Número de referencias al bloque. @param {Doc} doc @param {string} name @returns {number} */
export const xrefRefs = (doc, name) => { let n = 0; eachEnt(doc, e => { if (e.type === 'insert' && e.name === name) n++; }); return n; };

// Desenlaza: borra las referencias, el bloque y todo lo que depende de él
/** @param {Doc} doc @param {string} name */
export function detachXref(doc, name) {
  for (const arr of doc.lists()) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].type === 'insert' && /** @type {import('./types').Insert} */ (arr[i]).name === name) { doc.byId.delete(arr[i].id); arr.splice(i, 1); }
  for (const b of Object.values(doc.blocks)) b.ents = b.ents.filter(e => !(e.type === 'insert' && e.name === name));
  delete doc.blocks[name];
  for (const k of Object.keys(doc.blocks)) if (doc.blocks[k].xrefDep === name) delete doc.blocks[k];
  doc.layers = doc.layers.filter(l => !usesPrefix(l.name, name));
  doc.textStyles = doc.textStyles.filter(s => !usesPrefix(s.name, name));
  doc.dimStyles = doc.dimStyles.filter(s => !usesPrefix(s.name, name));
  doc.mlineStyles = doc.mlineStyles.filter(s => !usesPrefix(s.name, name));
  if (usesPrefix(doc.cur.layer, name)) doc.cur.layer = '0';
  doc.reindex(); doc.changed();
}

// Une: la referencia pasa a ser un bloque normal; los prefijos "NOMBRE|" se convierten en "NOMBRE$0$"
/** @param {Doc} doc @param {string} name */
export function bindXref(doc, name) {
  const ren = n => (usesPrefix(n, name) ? `${name}$0$${n.slice(name.length + 1)}` : n);
  eachEnt(doc, e => {
    e.layer = ren(e.layer);
    if (e.type === 'insert') e.name = ren(e.name);
    if (e.style) e.style = ren(e.style);
    if (e.mlstyle) e.mlstyle = ren(e.mlstyle);
    if (e.type === 'array') for (const x of e.src) { x.layer = ren(x.layer); if (x.type === 'insert') x.name = ren(x.name); }
  });
  for (const l of doc.layers) if (usesPrefix(l.name, name)) { l.name = ren(l.name); delete l.xref; }
  for (const s of /** @type {{name: string, textStyle?: string}[]} */ ([...doc.textStyles, ...doc.dimStyles, ...doc.mlineStyles])) { s.name = ren(s.name); if (s.textStyle) s.textStyle = ren(s.textStyle); }
  for (const k of Object.keys(doc.blocks)) {
    const b = doc.blocks[k];
    if (b.xrefDep === name) { delete doc.blocks[k]; delete b.xrefDep; b.name = ren(k); doc.blocks[b.name] = b; }
  }
  delete doc.blocks[name].xref;
  if (usesPrefix(doc.cur.layer, name)) doc.cur.layer = ren(doc.cur.layer);
  doc.changed();
}
