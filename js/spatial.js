// Índice espacial (árbol R empaquetado con STR) para designación, referencias y dibujado rápidos.
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

class Tree {
  constructor(ents) {
    let nodes = [];
    ents.forEach((e, i) => { const b = bboxIndex(e); if (b && isFinite(b.x1)) nodes.push({ b, e, i }); });
    this.size = nodes.length;
    while (nodes.length > 1) nodes = level(nodes);
    this.root = nodes[0] || null;
  }
  // Entidades cuyo rectángulo envolvente toca r; ordered conserva el orden de dibujo
  query(r, ordered = false) {
    const hits = [], stack = this.root ? [this.root] : [];
    while (stack.length) {
      const n = stack.pop();
      if (!bbOverlap(n.b, r)) continue;
      if (n.e) hits.push(n); else stack.push(...n.kids);
    }
    if (ordered) hits.sort((a, b) => a.i - b.i);
    return hits.map(n => n.e);
  }
}

export class SpatialIndex {
  constructor() { this.cache = new WeakMap(); }
  // Árbol del arreglo de entidades `arr`, reconstruido si cambió la versión del documento
  of(arr, ver) {
    let c = this.cache.get(arr);
    if (!c || c.ver !== ver) { c = { ver, tree: new Tree(arr) }; this.cache.set(arr, c); }
    return c.tree;
  }
}
