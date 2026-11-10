// Tablas de estilos de trazado, como en AutoCAD: dependientes del color (.ctb, una entrada por color ACI 1-255)
/** @typedef {import('./types').PlotTable} PlotTable */
/** @typedef {import('./types').PlotStyle} PlotStyle */
/** @typedef {import('./types').Document} Doc */
// @ts-check
// y con nombre (.stb, estilos asignados a capas y objetos). Cambian el color, el grosor, la intensidad y el tipo de
// línea al imprimir y exportar (PDF, SVG, PNG); con «Mostrar estilos de trazado» también en la presentación en pantalla.
// Tabla: {name, type: 'ctb' | 'stb', desc, styles: {clave: estilo}}. Clave: número ACI (ctb) o nombre (stb).
// Estilo: {color: null (el del objeto) | '#rrggbb', gray: escala de grises, lw: null (el del objeto) | mm,
//          screen: intensidad 0-100 (100 = color pleno), ltype: null (el del objeto) | nombre de tipo de línea}
// Los archivos .ctb/.stb de AutoCAD (texto comprimido con zlib) se importan y exportan sin dependencias
// con DecompressionStream/CompressionStream.
import { hexToAci, aciToHex, LTYPES, LWEIGHTS } from './entities.js';

/** Estilo que deja las propiedades del objeto. @type {PlotStyle} */
export const OBJECT = { color: null, lw: null, screen: 100, ltype: null };
const allAci = st => Object.fromEntries(Array.from({ length: 255 }, (_, i) => [i + 1, { ...OBJECT, ...st }]));
// Tablas predefinidas (no se guardan en el dibujo; se pueden copiar para editarlas)
/** Tablas predefinidas. @type {Record<string, PlotTable>} */
export const BUILTIN_PLOT = {
  'acad.ctb': { name: 'acad.ctb', type: 'ctb', desc: 'Usa las propiedades de los objetos', styles: allAci({}) },
  'monochrome.ctb': { name: 'monochrome.ctb', type: 'ctb', desc: 'Todo en negro', styles: allAci({ color: '#000000' }) },
  'grayscale.ctb': { name: 'grayscale.ctb', type: 'ctb', desc: 'Colores convertidos a escala de grises', styles: allAci({ gray: true }) },
  'screening 50%.ctb': { name: 'screening 50%.ctb', type: 'ctb', desc: 'Intensidad al 50 %', styles: allAci({ screen: 50 }) },
  'acad.stb': { name: 'acad.stb', type: 'stb', desc: 'Estilo Normal: propiedades de los objetos', styles: { Normal: { ...OBJECT } } },
  'monochrome.stb': { name: 'monochrome.stb', type: 'stb', desc: 'Estilo Normal en negro', styles: { Normal: { ...OBJECT, color: '#000000' } } },
};
/** @param {Doc} doc @returns {Record<string, PlotTable>} */
export const plotTables = doc => ({ ...BUILTIN_PLOT, ...(doc.plotStyles || {}) });
/** @param {Doc} doc @param {string | null | undefined} name @returns {PlotTable | null} */
export const plotTable = (doc, name) => (name ? plotTables(doc)[name] || null : null);
// Nombres de los estilos de una tabla con nombre (Normal siempre primero)
/** @param {PlotTable | null} t @returns {string[]} */
export const stbNames = t => (t?.type === 'stb' ? ['Normal', ...Object.keys(t.styles).filter(k => k !== 'Normal')] : []);
// Tabla en uso para la presentación (o el modelo con lay = null)
/** Tabla de la presentación (o del modelo). @param {Doc} doc @param {import('./types').Layout | null} lay @returns {PlotTable | null} */
export const tableFor = (doc, lay) => plotTable(doc, lay ? lay.plotStyle : doc.settings.modelPlotStyle);
// Tabla con nombre (.stb) que decide los estilos que se ofrecen: la de la presentación o la primera en uso
/** @param {Doc} doc @param {import('./types').Layout | null} [lay] @returns {PlotTable | null} */
export function activeStb(doc, lay) {
  const own = tableFor(doc, lay);
  if (own?.type === 'stb') return own;
  for (const t of [doc.settings.modelPlotStyle, ...doc.layouts.map(l => l.plotStyle)].map(n => plotTable(doc, n))) if (t?.type === 'stb') return t;
  return null;
}

const hex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
// Intensidad: mezcla con el blanco del papel (screen 100 = sin cambio, 0 = blanco)
const screenOf = (h, s) => { if (s >= 100) return h; const k = Math.max(0, s) / 100; return '#' + rgb(h).map(v => hex2(255 - (255 - v) * k)).join(''); };
const grayOf = h => { const [r, g, b] = rgb(h), y = 0.299 * r + 0.587 * g + 0.114 * b; return '#' + hex2(y).repeat(3); };

// Estilo de trazado que corresponde a un objeto: por su color ACI (ctb) o por su estilo con nombre, o el de su capa (stb)
/** Estilo de trazado de una entidad. @param {Doc} doc @param {PlotTable} t @param {import('./types').Entity} e @param {string} color @returns {PlotStyle} */
export function styleOf(doc, t, e, color) {
  if (!t) return null;
  if (t.type === 'ctb') return t.styles[hexToAci(color)] || null;
  const own = e.pstyle && e.pstyle !== 'BYLAYER' && e.pstyle !== 'BYBLOCK' ? e.pstyle : null;
  const name = own || doc.layer(e.layer)?.pstyle || 'Normal';
  return t.styles[name] || t.styles.Normal || null;
}
// st = doc.style(e) → {color, lw, pat} tal como se imprime. Sin tabla, devuelve null (se usan las propiedades del objeto)
/** @param {Doc} doc @param {PlotTable} t @param {import('./types').Entity} e @param {{color: string, lw: number, pat: number[]}} st */
export function applyPlot(doc, t, e, st) {
  const s = styleOf(doc, t, e, st.color);
  if (!s) return null;
  let color = s.color || st.color;
  if (!s.color && color.toLowerCase() === '#ffffff') color = '#000000'; // el blanco de pantalla se imprime en negro
  if (s.gray) color = grayOf(color);
  color = screenOf(color, s.screen ?? 100);
  const lt = s.ltype && LTYPES[s.ltype] ? LTYPES[s.ltype].pat : st.pat;
  return { color, lw: s.lw != null ? s.lw : st.lw, pat: lt };
}
// Función entidad → estilo de impresión ({color, lw, pat}) para la tabla de la presentación (null si no tiene)
/** Función que aplica la tabla de la presentación al estilo de cada entidad (null si no hay tabla). @param {Doc} doc @param {import('./types').Layout | null} lay */
export function plotStyler(doc, lay) {
  const t = tableFor(doc, lay);
  return t ? (e, st) => applyPlot(doc, t, e, st) || st : null;
}

// ---------- Archivos .ctb / .stb de AutoCAD ----------
// Cabecera de 48 bytes («PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec»), tres enteros (suma, tamaños)
// y el texto comprimido con zlib. El texto describe la tabla con bloques «clave{ … }» y pares «clave=valor».
const HEAD = { ctb: 'PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec', stb: 'PIAFILEVERSION_2.0,STBVER1,compress\r\npmzlibcodec' };
const USE_COLOR = -1006632961; // 0xC3FFFFFF: «usar el color del objeto»

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new TextDecoder('latin1').decode(out);
}
async function deflate(text) {
  const bytes = new Uint8Array([...text].map(ch => ch.charCodeAt(0) & 255));
  const cs = new CompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer());
}
// Texto de la tabla → árbol {clave: valor | árbol}
function parseTree(text) {
  const root = {}, stack = [root];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '}') { if (stack.length > 1) stack.pop(); continue; }
    const open = line.match(/^([^=]+)\{$/);
    if (open) { const o = {}; stack[stack.length - 1][open[1].trim()] = o; stack.push(o); continue; }
    const i = line.indexOf('=');
    if (i > 0) stack[stack.length - 1][line.slice(0, i).trim()] = line.slice(i + 1).replace(/^"/, '');
  }
  return root;
}
// Grosores de la tabla del archivo (índice → mm)
const lwTable = tree => Object.fromEntries(Object.entries(tree.custom_lineweight_table || {}).map(([k, v]) => [k, parseFloat(v)]));
const colorFrom = v => { const n = parseInt(v, 10); if (!Number.isFinite(n) || n === USE_COLOR || ((n >>> 24) & 255) !== 0xc2) return null; return '#' + (n & 0xffffff).toString(16).padStart(6, '0'); };

/** Archivo .ctb o .stb de AutoCAD. @param {ArrayBuffer} buf @param {string} fileName @returns {Promise<PlotTable>} */
export async function readPlotFile(buf, fileName) {
  const b = new Uint8Array(buf);
  let k = 48;
  while (k < Math.min(b.length - 1, 80) && !(b[k] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(b[k + 1]))) k++;
  const tree = parseTree(await inflate(b.slice(k)));
  const isCtb = /\.ctb$/i.test(fileName) || String(tree.aci_table_available).toUpperCase() === 'TRUE';
  const lws = lwTable(tree), styles = {};
  for (const [idx, ps] of Object.entries(tree.plot_style || {})) {
    if (typeof ps !== 'object') continue;
    const lwi = parseInt(ps.lineweight, 10), lt = parseInt(ps.linetype, 10);
    const st = { color: colorFrom(ps.color), lw: Number.isFinite(lwi) && lwi !== 255 && lws[lwi] != null ? lws[lwi] : null, screen: Math.max(0, Math.min(100, parseInt(ps.screen ?? '100', 10))), ltype: null };
    if (Number.isFinite(lt) && lt !== 31 && LT_CODES[lt]) st.ltype = LT_CODES[lt];
    if (isCtb) styles[+idx + 1] = st; else styles[String(ps.name || `Estilo${idx}`).replace(/"$/, '')] = st;
  }
  if (isCtb) for (let i = 1; i <= 255; i++) styles[i] ??= { ...OBJECT };
  else styles.Normal ??= { ...OBJECT };
  return { name: fileName.replace(/^.*[\\/]/, ''), type: isCtb ? 'ctb' : 'stb', desc: String(tree.description || '').replace(/"$/, ''), styles };
}
// Tipos de línea de la tabla de estilos de AutoCAD (índices propios del formato) que tienen equivalente
const LT_CODES = { 0: 'CONTINUOUS', 2: 'DASHED', 6: 'DOT', 10: 'CENTER', 12: 'DASHDOT', 14: 'PHANTOM', 31: null };
const LT_INDEX = Object.fromEntries(Object.entries(LT_CODES).filter(([, v]) => v).map(([k, v]) => [v, +k]));

/** Archivo .ctb/.stb comprimido. @param {PlotTable} t @returns {Promise<Uint8Array<ArrayBuffer>>} */
export async function writePlotFile(t) {
  const lws = [...new Set([0, ...LWEIGHTS.filter(v => typeof v === 'number'), ...Object.values(t.styles).map(s => s.lw).filter(v => v != null)])].sort((a, b) => a - b);
  const keys = t.type === 'ctb' ? Array.from({ length: 255 }, (_, i) => i + 1) : stbNames(t);
  const lines = [`description="${t.desc || ''}`, `aci_table_available=${t.type === 'ctb' ? 'TRUE' : 'FALSE'}`, 'scale_factor=1.0', 'apply_factor=FALSE', 'custom_lineweight_display_units=0'];
  if (t.type === 'ctb') { lines.push('aci_table{'); keys.forEach((k, i) => lines.push(` ${i}="Color_${k}`)); lines.push('}'); }
  lines.push('plot_style{');
  keys.forEach((k, i) => {
    const s = { ...OBJECT, ...t.styles[k] }, name = t.type === 'ctb' ? `Color_${k}` : k;
    const col = s.color ? (0xc2000000 | parseInt(s.color.slice(1), 16)) | 0 : USE_COLOR;
    lines.push(` ${i}{`, `  name="${name}`, `  localized_name="${name}`, '  description="', `  color=${col}`, `  mode_color=${col}`, '  color_policy=1',
      '  physical_pen_number=0', '  virtual_pen_number=0', `  screen=${Math.round(s.screen ?? 100)}`, '  linepattern_size=0.5',
      `  linetype=${s.ltype && LT_INDEX[s.ltype] != null ? LT_INDEX[s.ltype] : 31}`, '  adaptive_linetype=TRUE',
      `  lineweight=${s.lw != null ? lws.indexOf(s.lw) : 255}`, '  fill_style=73', '  end_style=4', '  join_style=5', ' }');
  });
  lines.push('}', 'custom_lineweight_table{', ...lws.map((v, i) => ` ${i}=${v.toFixed(2)}`), '}');
  const text = lines.join('\n') + '\n', z = await deflate(text);
  const head = new TextEncoder().encode(HEAD[t.type]), out = new Uint8Array(head.length + 12 + z.length), dv = new DataView(out.buffer);
  out.set(head, 0);
  dv.setUint32(head.length, adler32(text), true); dv.setUint32(head.length + 4, text.length, true); dv.setUint32(head.length + 8, z.length, true);
  out.set(z, head.length + 12);
  return out;
}
function adler32(s) { let a = 1, b = 0; for (let i = 0; i < s.length; i++) { a = (a + (s.charCodeAt(i) & 255)) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }

// Color de muestra para la tabla del editor
/** @param {number} i @returns {string} */
export const aciSample = i => aciToHex(i);
