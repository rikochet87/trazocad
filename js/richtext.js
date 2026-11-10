// Texto con formato de MTEXT: análisis y escritura de los códigos de AutoCAD.
/** Formato de un trozo de texto: fuente, negrita, cursiva, subrayado, sobrerrayado, tachado, altura, color, anchura, oblicuidad.
 * @typedef {{font: string | null, b: boolean, i: boolean, u: boolean, o: boolean, k: boolean, h: number, color: string | null, w: number, q: number}} Fmt */
/** Pieza: texto, salto de línea o fracción apilada (k: ^, / o #). @typedef {{t: 's', s: string, f: Fmt} | {t: 'nl'} | {t: 'stk', a: string, b: string, k: string, f: Fmt}} Piece */
// @ts-check
// Formato interno: los códigos de AutoCAD tal cual, salvo los saltos de línea, que se guardan como "\n" en lugar de \P.
// Códigos admitidos: {…} grupos, \f fuente|b|i, \H altura (absoluta o x relativa), \C color ACI, \c color verdadero,
// \W anchura, \Q oblicuidad, \L \l subrayado, \O \o sobrerrayado, \K \k tachado, \S fracciones apiladas (/ ^ #), \~ espacio duro.
// \A, \T y \p se aceptan y se ignoran.
import { aciToHex, exactAci } from './colors.js';

// Formato base de un texto: {font, b, i, u, o, k, h, color, w, q}; font/color null = los del estilo/entidad
/** @param {number} h @returns {Fmt} */
export const baseFmt = h => ({ font: null, b: false, i: false, u: false, o: false, k: false, h, color: null, w: 1, q: 0 });

const unesc = s => s.replace(/\\([\\{}#^/])/g, '$1');

// Lista de piezas: {t:'s', s, f} texto · {t:'nl'} salto de línea · {t:'stk', a, b, k, f} fracción apilada
/** Texto con los códigos de formato de MTEXT → piezas. @param {string} str @param {number} h @returns {Piece[]} */
export function parseRich(str, h) {
  const out = [], stack = [];
  let f = baseFmt(h), buf = '';
  const flush = () => { if (buf) { out.push({ t: 's', s: buf, f: { ...f } }); buf = ''; } };
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\n') { flush(); out.push({ t: 'nl' }); continue; }
    if (ch === '{') { flush(); stack.push({ ...f }); continue; }
    if (ch === '}') { flush(); if (stack.length) f = stack.pop(); continue; }
    if (ch !== '\\' || i + 1 >= s.length) { buf += ch; continue; }
    const c = s[++i];
    if (c === '\\' || c === '{' || c === '}') { buf += c; continue; }
    if (c === 'P' || c === 'N') { flush(); out.push({ t: 'nl' }); continue; }
    if (c === '~') { buf += ' '; continue; }
    if ('LlOoKk'.includes(c)) { flush(); f[{ l: 'u', o: 'o', k: 'k' }[c.toLowerCase()]] = c === c.toUpperCase(); continue; }
    const end = s.indexOf(';', i + 1);
    if (!'fFHCcWQTApS'.includes(c) || end < 0) { buf += c; continue; }
    const arg = s.slice(i + 1, end);
    i = end;
    flush();
    switch (c) {
      case 'f': case 'F': {
        const parts = arg.split('|');
        f.font = parts[0] && !/\.shx$/i.test(parts[0]) ? parts[0] : null;
        for (const p of parts.slice(1)) { if (p[0] === 'b') f.b = p[1] === '1'; else if (p[0] === 'i') f.i = p[1] === '1'; }
        break;
      }
      case 'H': { const v = parseFloat(arg); if (v > 0) f.h = /x$/i.test(arg) ? f.h * v : v; break; }
      case 'C': { const n = parseInt(arg, 10); f.color = n > 0 && n < 256 ? aciToHex(n) : null; break; }
      case 'c': { // color verdadero: 0xBBGGRR
        const n = parseInt(arg, 10);
        f.color = Number.isFinite(n) ? '#' + [n & 255, (n >> 8) & 255, (n >> 16) & 255].map(x => x.toString(16).padStart(2, '0')).join('') : null;
        break;
      }
      case 'W': { const v = parseFloat(arg); if (v > 0) f.w = /x$/i.test(arg) ? f.w * v : v; break; }
      case 'Q': f.q = parseFloat(arg) || 0; break;
      case 'S': {
        const m = arg.match(/^((?:\\.|[^#^/])*)([#^/])(.*)$/s);
        if (m) out.push({ t: 'stk', a: unesc(m[1]), b: unesc(m[3]), k: m[2], f: { ...f } });
        else buf += unesc(arg);
        break;
      }
      default: break; // \T, \A, \p: sin efecto
    }
  }
  flush();
  return out;
}

// ¿Contiene el texto algún código de formato? (para decidir si un MTEXT importado es con formato)
/** @param {unknown} s @returns {boolean} */
export const hasCodes = s => /\\[fFHCcWQLOKSTAp]|[{}]/.test(String(s).replace(/\\\\/g, ''));

// Texto sin formato (fracciones como a/b)
/** @param {string} s @param {number} [h] @returns {string} */
export const richPlain = (s, h = 1) => parseRich(s, h).map(t => (t.t === 'nl' ? '\n' : t.t === 'stk' ? `${t.a}/${t.b}` : t.s)).join('');

const escText = s => String(s).replace(/[\\{}]/g, m => '\\' + m).replace(/ /g, '\\~');
const escStk = s => escText(s).replace(/[#^/]/g, m => '\\' + m);
const num = v => +(+v).toFixed(6);

// Códigos de formato de f respecto al formato base (font: fuente del estilo para \f cuando sólo cambian b/i)
function codes(f, base, styleFont) {
  let c = '';
  if (f.font || f.b !== base.b || f.i !== base.i) c += `\\f${f.font || styleFont}|b${f.b ? 1 : 0}|i${f.i ? 1 : 0};`;
  if (Math.abs(f.h - base.h) > 1e-9) c += `\\H${num(f.h)};`;
  if (f.color) { const aci = exactAci(f.color); c += aci ? `\\C${aci};` : `\\c${parseInt(f.color.slice(5, 7) + f.color.slice(3, 5) + f.color.slice(1, 3), 16)};`; }
  if (Math.abs(f.w - 1) > 1e-9) c += `\\W${num(f.w)};`;
  if (f.q) c += `\\Q${num(f.q)};`;
  if (f.u) c += '\\L';
  if (f.o) c += '\\O';
  if (f.k) c += '\\K';
  return c;
}
const sameFmt = (a, b) => ['font', 'b', 'i', 'u', 'o', 'k', 'color', 'w', 'q'].every(k => a[k] === b[k]) && Math.abs(a.h - b.h) < 1e-9;

// Escribe piezas como texto con códigos. Devuelve {text, rich}; sin formato, el texto es plano y rich = false.
/** Piezas → texto (con códigos de formato si hacen falta). @param {Piece[]} pieces @param {number} h @param {string} [styleFont] @returns {{text: string, rich: boolean}} */
export function buildRich(pieces, h, styleFont = 'Arial') {
  const base = baseFmt(h), merged = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (p.t === 's' && last?.t === 's' && sameFmt(last.f, p.f)) last.s += p.s;
    else if (p.t !== 's' || p.s) merged.push(p.t === 's' ? { ...p } : p);
  }
  const rich = merged.some(p => p.t === 'stk' || (p.t === 's' && codes(p.f, base, styleFont)));
  if (!rich) return { text: merged.map(p => (p.t === 'nl' ? '\n' : p.s)).join(''), rich: false };
  const text = merged.map(p => {
    if (p.t === 'nl') return '\n';
    const c = codes(p.f, base, styleFont);
    if (p.t === 'stk') return `{${c}\\S${escStk(p.a)}${p.k}${escStk(p.b)};}`;
    return c ? `{${c}${escText(p.s)}}` : escText(p.s);
  }).join('');
  return { text, rich: true };
}
// Texto plano → texto con códigos (escapa \ { })
/** @param {string} s @returns {string} */
export const plainToRich = s => String(s).split('\n').map(escText).join('\n');
