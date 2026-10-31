// Índice espacial (árbol R empaquetado con STR) para designación, referencias y dibujado rápidos. Es incremental: sigue el
// diario de cambios del documento (doc.log) y sólo se reconstruye entero tras un cambio general o cuando acumula muchos
// objetos nuevos o modificados. Guarda además los rectángulos que han cambiado (dirt) para el dibujo por teselas.
import { bboxIndex } from './entities.js';
import { bbOverlap } from './geom.js';

const M = 12;
const union = nodes => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const { b } of nodes) { if (b.x1 < x1) x1 = b.x1; if (b.y1 < y1) y1 = b.y1; if (b.x2 > x2) x2 = b.x2; if (b.y2 > y2) y2 = b.y2; }
  return { x1, y1, x2, y2 };
};

function level(nodes) {
  const n = nodes.length, S = Math.ceil(Math.sqrt(Math.ceil(n / M))), slice = S * M, out = [];
  nodes.sort((a, b) => a.b.x1 + a.b.x2 - b.b.x1 - b.b.x2);
  for (let i = 0; i < n; i += slice) {
    const sl = nodes.slice(i, i + slice).sort((a, b) => a.b.y1 + a.b.y2 - b.b.y1 - b.b.y2);
    for (let j = 0; j < sl.length; j += M) { const kids = sl.slice(j, j + M); out.push({ b: union(kids), kids }); }
  }
  return out;
}
const boxOf = e => { try { const b = bboxIndex(e); return b && isFinite(b.x1) && isFinite(b.y2) ? b : null; } catch { return null; } };

class Tree {
  constructor(ents) {
    let nodes = [];
    this.node = new Map(); // entidad → hoja (i: orden de dibujo)
    ents.forEach((e, i) => { const b = boxOf(e), n = { b, e, i }; this.node.set(e, n); if (b) nodes.push(n); });
    this.size = ents.length;
    this.next = ents.length; // orden de dibujo de los objetos añadidos después
    this.extra = [];         // hojas añadidas o modificadas desde la construcción (se recorren una a una)
    this.dead = 0;           // hojas del árbol que ya no valen
    this.dirt = [];          // rectángulos que han cambiado desde que se consultaron (teselas)
    while (nodes.length > 1) nodes = level(nodes);
    this.root = nodes[0] || null;
  }
  // Aplica un cambio del diario; false si conviene reconstruir el árbol
  apply(o, arr) {
    if (o.kind === 'add') { if (o.arr === arr && !this.node.has(o.e)) { this.put(o.e, this.next++); this.size++; } }
    else if (o.kind === 'del') { if (o.arr === arr && this.node.has(o.e)) { this.drop(o.e); this.size--; } }
    else if (o.kind === 'mod') { const n = this.node.get(o.e); if (n) { this.drop(o.e); this.put(o.e, n.i); } }
    return this.extra.length + this.dead < Math.max(2000, this.size / 5);
  }
  put(e, i) {
    const b = boxOf(e), n = { b, e, i };
    this.node.set(e, n);
    if (b) { this.extra.push(n); this.mark(b); }
  }
  mark(b) { if (this.dirt) { this.dirt.push(b); if (this.dirt.length > 4000) this.dirt = null; } } // null: todo
  drop(e) {
    const n = this.node.get(e);
    this.node.delete(e);
    if (!n) return;
    n.dead = true; this.dead++;
    if (n.b) this.mark(n.b);
  }
  // Entidades cuyo rectángulo envolvente toca r; ordered conserva el orden de dibujo
  query(r, ordered = false) {
    const hits = [], stack = this.root ? [this.root] : [];
    while (stack.length) {
      const n = stack.pop();
      if (!bbOverlap(n.b, r)) continue;
      if (n.e) { if (!n.dead) hits.push(n); } else for (const k of n.kids) stack.push(k);
    }
    for (const n of this.extra) if (!n.dead && bbOverlap(n.b, r)) hits.push(n);
    if (ordered) hits.sort((a, b) => a.i - b.i);
    return hits.map(n => n.e);
  }
}

export class SpatialIndex {
  constructor() { this.cache = new WeakMap(); }
  // Árbol del arreglo de entidades `arr`, al día con la versión del documento
  of(arr, doc) {
    let c = this.cache.get(arr);
    if (c && c.ver === doc.ver) return c.tree;
    if (!c || !this.sync(c, arr, doc)) { c = { tree: new Tree(arr) }; this.cache.set(arr, c); }
    c.ver = doc.ver;
    return c.tree;
  }
  sync(c, arr, doc) {
    const log = doc.log;
    if (!log.length || log[0].ver > c.ver + 1) return false; // el diario ya no llega a la versión del árbol
    let i = log.length - 1;
    while (i > 0 && log[i - 1].ver > c.ver) i--;
    for (; i < log.length; i++) {
      const o = log[i];
      if (o.ver <= c.ver) continue;
      if (o.full || !c.tree.apply(o, arr)) return false;
    }
    return c.tree.size === arr.length; // si la lista cambió sin pasar por el documento, se reconstruye
  }
}
