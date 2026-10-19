// Referencias externas: otro dibujo (.tcad o .dxf) insertado como bloque vinculado a su archivo.
// El contenido se guarda en caché dentro del dibujo (bloque con `xref: {file, loaded}`) y se actualiza con Recargar.
// Las capas, bloques y estilos de la referencia llevan el prefijo "NOMBRE|", como en AutoCAD; al unirla pasan a "NOMBRE$0$".
import { cloneEnt } from './entities.js';
import { readDXF } from './dxf.js';

export const isXref = (doc, name) => !!doc.blocks[name]?.xref;
export const xrefNames = doc => Object.keys(doc.blocks).filter(n => doc.blocks[n].xref);
export const cleanXrefName = s => String(s).replace(/\.[^.]+$/, '').replace(/[|<>/\\":;?*=`]/g, '_').trim() || 'Referencia';

// Contenido de un archivo: {ents, layers, blocks, textStyles, dimStyles, base}
export function parseSource(text, fileName) {
  if (/\.dxf$/i.test(fileName)) {
    const r = readDXF(text);
    return { ents: r.ents, layers: r.layers, blocks: r.blocks, textStyles: r.textStyles, dimStyles: r.dimStyles || [], patterns: r.patterns || {}, base: r.insBase || { x: 0, y: 0 } };
  }
  const o = JSON.parse(text);
  if (o.app !== 'TrazoCAD') throw new Error('El archivo no es un dibujo de TrazoCAD ni un DXF');
  return { ents: o.model || o.ents || [], layers: o.layers || [], blocks: o.blocks || {}, textStyles: o.textStyles || [], dimStyles: o.dimStyles || [], patterns: o.patterns || {}, base: o.settings?.insBase || { x: 0, y: 0 } };
}

const STRIP = ['id', 'assoc', 'seed', '_xf', '_h'];
// Define (o actualiza) la referencia `name` con el contenido `src`. Devuelve el número de objetos.
export function defineXref(doc, name, src, fileName) {
  const pre = n => `${name}|${n}`;
  const lay = n => (!n || n === '0' ? '0' : pre(n));
  const blk = n => pre(n);
  const tsty = new Set(src.textStyles.map(s => s.name)), dsty = new Set(src.dimStyles.map(s => s.name));
  const conv = e => {
    const c = cloneEnt(e);
    for (const k of STRIP) delete c[k];
    c.layer = lay(c.layer);
    if (c.type === 'insert') c.name = blk(c.name);
    if (c.style && (c.type === 'dim' ? dsty : tsty).has(c.style)) c.style = pre(c.style);
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
export const xrefRefs = (doc, name) => { let n = 0; eachEnt(doc, e => { if (e.type === 'insert' && e.name === name) n++; }); return n; };

// Desenlaza: borra las referencias, el bloque y todo lo que depende de él
export function detachXref(doc, name) {
  for (const arr of doc.lists()) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].type === 'insert' && arr[i].name === name) { doc.byId.delete(arr[i].id); arr.splice(i, 1); }
  for (const b of Object.values(doc.blocks)) b.ents = b.ents.filter(e => !(e.type === 'insert' && e.name === name));
  delete doc.blocks[name];
  for (const k of Object.keys(doc.blocks)) if (doc.blocks[k].xrefDep === name) delete doc.blocks[k];
  doc.layers = doc.layers.filter(l => !usesPrefix(l.name, name));
  doc.textStyles = doc.textStyles.filter(s => !usesPrefix(s.name, name));
  doc.dimStyles = doc.dimStyles.filter(s => !usesPrefix(s.name, name));
  if (usesPrefix(doc.cur.layer, name)) doc.cur.layer = '0';
  doc.reindex(); doc.changed();
}

// Une: la referencia pasa a ser un bloque normal; los prefijos "NOMBRE|" se convierten en "NOMBRE$0$"
export function bindXref(doc, name) {
  const ren = n => (usesPrefix(n, name) ? `${name}$0$${n.slice(name.length + 1)}` : n);
  eachEnt(doc, e => {
    e.layer = ren(e.layer);
    if (e.type === 'insert') e.name = ren(e.name);
    if (e.style) e.style = ren(e.style);
  });
  for (const l of doc.layers) if (usesPrefix(l.name, name)) { l.name = ren(l.name); delete l.xref; }
  for (const s of [...doc.textStyles, ...doc.dimStyles]) { s.name = ren(s.name); if (s.textStyle) s.textStyle = ren(s.textStyle); }
  for (const k of Object.keys(doc.blocks)) {
    const b = doc.blocks[k];
    if (b.xrefDep === name) { delete doc.blocks[k]; delete b.xrefDep; b.name = ren(k); doc.blocks[b.name] = b; }
  }
  delete doc.blocks[name].xref;
  if (usesPrefix(doc.cur.layer, name)) doc.cur.layer = ren(doc.cur.layer);
  doc.changed();
}
