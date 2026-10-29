// Escalas anotativas: lista de escalas del dibujo (SCALELISTEDIT), escala de anotación actual (CANNOSCALE en el modelo y
// la de cada ventana gráfica, que es la suya), objetos anotativos con una representación por escala (OBJECTSCALE) y
// visibilidad de los que no tienen la escala actual (ANNOALLVISIBLE). Un objeto anotativo guarda sus tamaños en unidades
// del papel y la lista de escalas que admite (e.anno); se dibuja con sus tamaños multiplicados por el factor de la escala
// (1:100 → 100). Si no admite la escala actual, se dibuja con la primera de las suyas, atenuado, o se oculta.

// Contexto: doc (el dibujo), ctx (función de la aplicación que da la escala actual) y override (la de la ventana gráfica
// que se está dibujando, o 1:1 para los objetos del papel)
export const ANNO = { doc: null, ctx: null, override: null };

// Lista métrica de AutoCAD (unidades del papel : unidades del dibujo)
export const DEFAULT_SCALES = [[1, 1], [1, 2], [1, 4], [1, 5], [1, 8], [1, 10], [1, 16], [1, 20], [1, 25], [1, 30], [1, 40], [1, 50], [1, 75], [1, 100], [1, 200], [1, 250], [1, 500],
  [1, 1000], [1, 1500], [1, 2000], [1, 2500], [1, 5000], [1, 10000], [1, 20000], [1, 25000], [1, 50000], [2, 1], [4, 1], [5, 1], [8, 1], [10, 1], [100, 1]]
  .map(([paper, draw]) => ({ name: `${paper}:${draw}`, paper, draw }));
export const defaultScales = () => DEFAULT_SCALES.map(s => ({ ...s }));

// Tipos que pueden ser anotativos
export const ANNO_TYPES = new Set(['text', 'mtext', 'attdef', 'dim', 'mleader', 'hatch', 'insert']);
export const isAnno = e => Array.isArray(e?.anno) && e.anno.length > 0;

const num = v => +(+v).toFixed(6);
export const factorOf = s => s.draw / s.paper;
// "1:100", "1/100", "100" (= 1:100), "2:1"; devuelve {paper, draw} o null
export function parseScale(t) {
  const s = String(t).trim().replace(',', '.');
  let m = /^([\d.]+)\s*[:/=]\s*([\d.]+)$/.exec(s);
  if (m) { const paper = +m[1], draw = +m[2]; return paper > 0 && draw > 0 ? { paper, draw } : null; }
  m = /^[\d.]+$/.exec(s);
  return m && +s > 0 ? { paper: 1, draw: +s } : null;
}
export const scaleName = (paper, draw) => `${num(paper)}:${num(draw)}`;
const key = n => String(n).trim().toLowerCase().replace(/\s+/g, '');
export const scalesOf = doc => (doc.scales?.length ? doc.scales : (doc.scales = defaultScales()));
export const findScale = (doc, name) => scalesOf(doc).find(s => key(s.name) === key(name)) || null;
// Escala de la lista con el factor k (o null)
export const scaleWithFactor = (doc, k) => scalesOf(doc).find(s => Math.abs(factorOf(s) - k) / k < 1e-6) || null;
// Escala por nombre o por proporción ("1:100" aunque se llame de otro modo); con add, la añade a la lista si no está
export function resolveScale(doc, t, add = false) {
  const s = findScale(doc, t);
  if (s) return s;
  const p = parseScale(t);
  if (!p) return null;
  const same = scaleWithFactor(doc, p.draw / p.paper);
  if (same) return same;
  if (!add) return null;
  const n = { name: scaleName(p.paper, p.draw), paper: p.paper, draw: p.draw };
  scalesOf(doc).push(n);
  return n;
}
export const factorOfName = (doc, name) => { const s = findScale(doc, name) || (parseScale(name) && { ...parseScale(name) }); return s ? factorOf(s) : 1; };

// Escala de anotación de una ventana gráfica: la de la lista que coincide con su escala (1/s), o una a medida
export function vpScale(doc, vp) {
  const k = 1 / (vp.s || 1), s = scaleWithFactor(doc, k);
  return s ? { name: s.name, k } : { name: k >= 1 ? `1:${num(k)}` : `${num(1 / k)}:1`, k };
}
// Escala de anotación actual: {name, k}
export function curScale() {
  if (ANNO.override) return ANNO.override;
  const c = ANNO.ctx?.();
  if (c) return c;
  const doc = ANNO.doc, n = doc?.settings?.cannoscale || '1:1';
  return { name: n, k: doc ? factorOfName(doc, n) : 1 };
}
export const PAPER_SCALE = Object.freeze({ name: '1:1', k: 1 });
const has = (e, name) => e.anno.some(n => key(n) === key(name));
export const supports = (e, name = curScale().name) => isAnno(e) && has(e, name);
// Oculto por no admitir la escala actual con ANNOALLVISIBLE = 0
export const annoHidden = e => isAnno(e) && ANNO.doc?.settings?.annoAllVisible === 0 && !has(e, curScale().name);

// Copia de e con sus tamaños para el factor k (los del papel multiplicados)
export function scaleEnt(e, k) {
  const o = { ...e };
  switch (e.type) {
    case 'text': case 'attdef': o.h = e.h * k; break;
    case 'mtext': o.h = e.h * k; if (e.w) o.w = e.w * k; break;
    case 'dim': o.ov = { ...e.ov, scale: k }; break; // los tamaños del estilo son del papel: DIMSCALE = factor de la escala
    case 'mleader': {
      const st = ANNO.doc?.mleaderStyle?.(e.mstyle) || {};
      for (const f of ['h', 'asz', 'land', 'gap']) { const v = e[f] ?? st[f]; if (v != null) o[f] = v * k; }
      break;
    }
    case 'hatch': if (e.pattern !== 'SOLID' && e.pattern !== 'GRADIENT') { o.scale = (e.scale || 1) * k; if (e.user) o.user = { ...e.user, sp: (e.user.sp || 1) * k }; } break;
    case 'insert': o.sx = (e.sx ?? 1) * k; o.sy = (e.sy ?? 1) * k; break;
  }
  return o;
}

// Representación de e con la escala actual (o la de su primera escala, marcada con _annoOff); e si no es anotativo
const cache = new WeakMap();
export function annoEff(e) {
  if (!isAnno(e)) return e;
  const doc = ANNO.doc, c = curScale(), ok = has(e, c.name), k = ok ? c.k : factorOfName(doc, e.anno[0]);
  const ck = `${k}|${ok}|${doc?.ver}`, hit = cache.get(e);
  if (hit && hit.ck === ck) return hit.out;
  const out = scaleEnt(e, k);
  if (!ok) out._annoOff = true;
  cache.set(e, { ck, out });
  return out;
}

// Hace anotativo (on) o no a e conservando su tamaño en pantalla con la escala actual
export function setAnnotative(e, on) {
  const c = curScale();
  if (on) {
    if (isAnno(e)) return;
    const k = c.k;
    if (e.type === 'text' || e.type === 'attdef') e.h /= k;
    else if (e.type === 'mtext') { e.h /= k; if (e.w) e.w /= k; }
    else if (e.type === 'hatch' && e.pattern !== 'SOLID' && e.pattern !== 'GRADIENT') e.scale = (e.scale || 1) / k;
    else if (e.type === 'insert') { e.sx = (e.sx ?? 1) / k; e.sy = (e.sy ?? 1) / k; }
    else if (e.type === 'dim' && e.ov) delete e.ov.scale;
    e.anno = [c.name];
  } else {
    if (!isAnno(e)) return;
    const k = has(e, c.name) ? c.k : factorOfName(ANNO.doc, e.anno[0]), n = scaleEnt(e, k);
    for (const f of ['h', 'w', 'scale', 'sx', 'sy', 'ov', 'user', 'asz', 'land', 'gap']) if (f in n) e[f] = n[f];
    delete e.anno;
  }
}
// Añade o quita escalas de un objeto anotativo; un objeto conserva siempre al menos una
export function addScales(e, names) {
  if (!isAnno(e)) return 0;
  let n = 0;
  for (const nm of names) if (!has(e, nm)) { e.anno.push(nm); n++; }
  return n;
}
export function removeScales(e, names) {
  if (!isAnno(e)) return 0;
  const keep = e.anno.filter(n => !names.some(x => key(x) === key(n)));
  if (!keep.length) return -1;
  const n = e.anno.length - keep.length;
  e.anno = keep;
  return n;
}
// Escalas en uso por los objetos (para no suprimirlas de la lista)
export function scalesInUse(doc) {
  const used = new Set();
  const walk = list => { for (const e of list) if (isAnno(e)) for (const n of e.anno) used.add(key(n)); };
  walk(doc.model); for (const l of doc.layouts) walk(l.ents); for (const b of Object.values(doc.blocks)) walk(b.ents || []);
  used.add(key(doc.settings.cannoscale || '1:1'));
  return used;
}
export const inUse = (doc, name) => scalesInUse(doc).has(key(name));
