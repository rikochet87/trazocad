// Paletas de herramientas (TOOLPALETTES): grupos de herramientas que insertan bloques (de la biblioteca o del dibujo),
// @ts-check
// crean sombreados o ejecutan órdenes, con sus propiedades predefinidas (capa, color, escala, rotación, patrón, estado de
// visibilidad). Se usan con un clic o arrastrándolas al dibujo, y se guardan en el navegador (son del usuario, no del dibujo).
import { libItem, LIBRARY } from './library.js';

/** Herramienta de una paleta: bloque (rot en grados), sombreado (angle en grados) u orden, con capa y color propios.
 * @typedef {{kind: 'block' | 'hatch' | 'command', label: string, block?: string, pattern?: string, cmd?: string, scale?: number,
 *   rot?: number, angle?: number, vis?: string, layer?: string, color?: string}} Tool */
/** @typedef {{name: string, tools: Tool[]}} Palette */
const KEY = 'trazocad.toolpalettes';
/** @param {string} block @param {string} [label] @param {Partial<Tool>} [o] @returns {Tool} */
const blk = (block, label, o = {}) => ({ kind: 'block', block, label: label || libItem(block)?.label || block, ...o });
/** @param {string} pattern @param {string} label @param {number} scale @param {Partial<Tool>} [o] @returns {Tool} */
const hat = (pattern, label, scale, o = {}) => ({ kind: 'hatch', pattern, label, scale, angle: 0, ...o });
/** @param {string} cmd @param {string} label @param {Partial<Tool>} [o] @returns {Tool} */
const com = (cmd, label, o = {}) => ({ kind: 'command', cmd, label, ...o });

/** @returns {Palette[]} */
export function defaultPalettes() {
  const lib = cat => LIBRARY.filter(l => l.cat === cat);
  return [
    { name: 'Señalización', tools: [
      blk('TC_SEÑAL_REGLAMENTARIA', 'Velocidad máxima', { layer: 'SEÑALIZACION', vis: 'Velocidad máxima' }),
      blk('TC_SEÑAL_REGLAMENTARIA', 'Prohibido adelantar', { layer: 'SEÑALIZACION', vis: 'Prohibido adelantar' }),
      blk('TC_SEÑAL_REGLAMENTARIA', 'Prohibido estacionar', { layer: 'SEÑALIZACION', vis: 'Prohibido estacionar' }),
      blk('TC_SEÑAL_PARE', 'Pare', { layer: 'SEÑALIZACION' }),
      blk('TC_SEÑAL_CEDA_EL_PASO', 'Ceda el paso', { layer: 'SEÑALIZACION' }),
      blk('TC_SEÑAL_PREVENTIVA_ROMBO', 'Curva a la derecha', { layer: 'SEÑALIZACION', vis: 'Curva a la derecha' }),
      blk('TC_SEÑAL_PREVENTIVA_ROMBO', 'Curva a la izquierda', { layer: 'SEÑALIZACION', vis: 'Curva a la izquierda' }),
      blk('TC_SEÑAL_PREVENTIVA_ROMBO', 'Cruce de caminos', { layer: 'SEÑALIZACION', vis: 'Cruce de caminos' }),
      blk('TC_SEÑAL_PREVENTIVA_ROMBO', 'Obras en la vía', { layer: 'SEÑALIZACION', vis: 'Obras en la vía' }),
      blk('TC_SEÑAL_PREVENTIVA_TRIANGULO', 'Peligro (triángulo)', { layer: 'SEÑALIZACION', vis: 'Curva a la derecha' }),
      blk('TC_SEÑAL_INFORMATIVA', 'Destinos', { layer: 'SEÑALIZACION' }),
      blk('TC_MOJON_KILOMETRICO', 'Mojón kilométrico', { layer: 'SEÑALIZACION' }),
    ] },
    { name: 'Obras de arte', tools: lib('Obras de arte').map(l => blk(l.name, null, { layer: 'OBRAS DE ARTE' })) },
    { name: 'Seguridad vial', tools: lib('Seguridad vial').map(l => blk(l.name, null, { layer: 'DEFENSAS' })) },
    { name: 'Drenaje', tools: lib('Drenaje').map(l => blk(l.name, null, { layer: 'DRENAJE' })) },
    { name: 'Sombreados', tools: [
      hat('EARTH', 'Terreno natural', 0.05, { layer: 'SOMBREADOS' }),
      hat('ANSI31', 'Hormigón', 0.05, { layer: 'SOMBREADOS', angle: 45 }),
      hat('DOTS', 'Base granular', 0.05, { layer: 'SOMBREADOS' }),
      hat('ANSI37', 'Carpeta asfáltica', 0.03, { layer: 'SOMBREADOS' }),
      hat('SOLID', 'Relleno sólido', 1, { layer: 'SOMBREADOS', color: '#808080' }),
      hat('BRICK', 'Mampostería', 0.05, { layer: 'SOMBREADOS' }),
    ] },
    { name: 'Órdenes', tools: [
      com('PLAN', 'Planta del SCP'), com('UCS OB', 'SCP por objeto'), com('DVIEW D', 'Girar vista (2 puntos)'),
      com('CANNOSCALE', 'Escala de anotación'), com('ARRAYPATH', 'Matriz en recorrido'), com('MEASURE', 'Graduar'),
      com('DIMALIGNED', 'Cota alineada'), com('MLEADER', 'Directriz'), com('ADCENTER', 'DesignCenter'),
    ] },
  ];
}

/** @returns {Palette[]} */
export function loadPalettes() {
  try { const p = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(p) && p.length) return p; } catch { /* por defecto */ }
  return defaultPalettes();
}
/** @param {Palette[]} p @returns {boolean} */
export function savePalettes(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch { return false; } }
/** @returns {Palette[]} */
export function resetPalettes() { try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } return defaultPalettes(); }

// Herramienta a partir de un objeto del dibujo (referencia a bloque o sombreado), con sus propiedades
/** Herramienta a partir de un bloque o un sombreado del dibujo. @param {import('./types').Entity} e @returns {Tool | null} */
export function toolFromEntity(e) {
  const common = { ...(e.layer && e.layer !== '0' ? { layer: e.layer } : {}), ...(e.color && e.color !== 'BYLAYER' ? { color: e.color } : {}) };
  if (e.type === 'insert') return { kind: 'block', block: e.name, label: e.name, scale: Math.abs(e.sx ?? 1), rot: +((e.rot || 0) * 180 / Math.PI).toFixed(6), ...(e.dyn?.vis ? { vis: e.dyn.vis } : {}), ...common };
  if (e.type === 'hatch') return { kind: 'hatch', pattern: e.pattern, label: e.pattern, scale: e.scale || 1, angle: e.angle || 0, ...common };
  return null;
}
/** @param {Tool} t @returns {string} */
export const toolDesc = t => (t.kind === 'block' ? `Bloque ${t.block}${t.vis ? ` (${t.vis})` : ''}` : t.kind === 'hatch' ? `Sombreado ${t.pattern}, escala ${t.scale}${t.angle ? `, ${t.angle}°` : ''}` : `Orden: ${t.cmd}`)
  + (t.layer ? ` · capa ${t.layer}` : '') + (t.kind === 'block' && t.scale && t.scale !== 1 ? ` · escala ${t.scale}` : '') + (t.kind === 'block' && t.rot ? ` · ${t.rot}°` : '');
