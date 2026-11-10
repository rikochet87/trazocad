// Biblioteca de bloques para obras viales, generada por código (sin archivos externos): señalización vertical
/** @typedef {import('./document.js').Doc} Doc */
/** @typedef {import('./types').Entity} Entity */
/** @typedef {import('./types').Point} Point */
/** Bloque de la biblioteca: real (en metros, se escala con LIBUNITS) o anotativo (tamaño en el papel).
 * make crea las entidades del bloque (sin identificador).
 * @typedef {{name: string, cat: string, label: string, desc: string, real?: boolean, anno?: boolean, make: () => {base?: Point, ents: object[], dyn?: import('./types').DynDef}}} LibItem */
// @ts-check
// (reglamentaria, preventiva e informativa, con atributos y estados de visibilidad), planos tipo de alcantarillas
// (caño y cajón con tabla de medidas), defensas metálicas, cordones y cunetas.
// Las señales son bloques anotativos definidos en milímetros del papel (se ven del mismo tamaño en cualquier escala);
// los planos tipo están en metros a escala real y se insertan con el factor de las unidades del dibujo (LIBUNITS).
// Los nombres de bloque llevan el prefijo «TC_» para no chocar con los del usuario.
import * as G from './geom.js';
const { P } = G;

const BB = { layer: '0', color: 'BYBLOCK', ltype: 'BYBLOCK', lw: 'BYBLOCK' };
const RED = '#e53935', YELLOW = '#ffc107', BLUE = '#1e6fd0', GREEN = '#2e7d32', GREY = '#9e9e9e';
const ring = (c, r, n = 48) => Array.from({ length: n }, (_, i) => G.polar(c, (i * 2 * Math.PI) / n, r));
const ngon = (c, r, n, a0) => Array.from({ length: n }, (_, i) => G.polar(c, a0 + (i * 2 * Math.PI) / n, r));
const rect = (x1, y1, x2, y2) => [P(x1, y1), P(x2, y1), P(x2, y2), P(x1, y2)];
const line = (a, b, o = {}) => ({ ...BB, type: 'line', p1: a, p2: b, ...o });
const pl = (pts, closed = false, o = {}) => ({ ...BB, type: 'pline', pts, closed, ...o });
const circle = (c, r, o = {}) => ({ ...BB, type: 'circle', c, r, ...o });
const arc = (c, r, a1, a2, o = {}) => ({ ...BB, type: 'arc', c, r, a1: G.rad(a1), a2: G.rad(a2), ...o });
const fill = (loops, color, o = {}) => ({ ...BB, type: 'hatch', pattern: 'SOLID', loops, color, scale: 1, angle: 0, ...o });
const hatch = (loops, pattern, scale, o = {}) => ({ ...BB, type: 'hatch', pattern, loops, scale, angle: 0, ...o });
const text = (p, h, s, o = {}) => ({ ...BB, type: 'text', p: G.sub(p, P(0, h / 2)), h, rot: 0, align: 'c', style: 'Standard', text: s, ...o });
const att = (p, h, tag, prompt, def, o = {}) => ({ ...BB, type: 'attdef', p: G.sub(p, P(0, h / 2)), h, rot: 0, align: 'c', style: 'Standard', tag, prompt, def, ...o });
// Atributos ocultos comunes a las señales: código de la norma, progresiva y lado de la calzada
const signData = (code, at) => [
  att(G.add(at, P(0, -1.6)), 1.2, 'CODIGO', 'Código de la señal', code, { invisible: true }),
  att(G.add(at, P(0, -3.2)), 1.2, 'PROGRESIVA', 'Progresiva', '0+000', { invisible: true }),
  att(G.add(at, P(0, -4.8)), 1.2, 'LADO', 'Lado (Derecho/Izquierdo)', 'Derecho', { invisible: true }),
];

// Bloque con estados de visibilidad: common (siempre), states: {nombre: [entidades]}
function withStates(common, states, pos) {
  const ents = [...common], hideAll = {}, own = {};
  for (const [name, list] of Object.entries(states)) { own[name] = list.map((e, i) => ents.length + i); ents.push(...list); }
  const names = Object.keys(states);
  for (const n of names) hideAll[n] = names.filter(m => m !== n).flatMap(m => own[m]);
  return { ents, dyn: { vis: { states: names, hide: hideAll, pos } } };
}

// ---------- Pictogramas (en un círculo o rombo de radio ~3 mm centrado en c) ----------
const arrow = (a, b, w = 0.7) => { const d = G.norm(G.sub(b, a)), n = G.perp(d), k = G.sub(b, G.mul(d, w * 1.2)); return [line(a, k), pl([b, G.add(k, G.mul(n, w)), G.sub(k, G.mul(n, w))], true), fill([[b, G.add(k, G.mul(n, w)), G.sub(k, G.mul(n, w))]], 'BYBLOCK')]; };
const PICTO = {
  'Curva a la derecha': c => [pl([G.add(c, P(-0.8, -2.2)), G.add(c, P(-0.8, 0)), G.add(c, P(0.4, 1.2))]), ...arrow(G.add(c, P(0.4, 1.2)), G.add(c, P(1.4, 2.2)))],
  'Curva a la izquierda': c => [pl([G.add(c, P(0.8, -2.2)), G.add(c, P(0.8, 0)), G.add(c, P(-0.4, 1.2))]), ...arrow(G.add(c, P(-0.4, 1.2)), G.add(c, P(-1.4, 2.2)))],
  'Curva y contracurva': c => [pl([G.add(c, P(-0.9, -2.2)), G.add(c, P(-0.9, -0.9)), G.add(c, P(0.9, 0.2)), G.add(c, P(0.9, 1.0))]), ...arrow(G.add(c, P(0.9, 1.0)), G.add(c, P(-0.2, 2.2)))],
  'Cruce de caminos': c => [line(G.add(c, P(0, -2.3)), G.add(c, P(0, 2.3)), { lw: 0.5 }), line(G.add(c, P(-2.3, 0)), G.add(c, P(2.3, 0)), { lw: 0.5 })],
  'Estrechamiento': c => [pl([G.add(c, P(-1.4, -2.2)), G.add(c, P(-1.4, -0.4)), G.add(c, P(-0.6, 0.6)), G.add(c, P(-0.6, 2.2))]), pl([G.add(c, P(1.4, -2.2)), G.add(c, P(1.4, -0.4)), G.add(c, P(0.6, 0.6)), G.add(c, P(0.6, 2.2))])],
  'Obras en la vía': c => [circle(G.add(c, P(-0.3, 1.5)), 0.45), pl([G.add(c, P(-0.3, 1.0)), G.add(c, P(0, -0.6)), G.add(c, P(-0.9, -2.0))]), line(G.add(c, P(0, -0.6)), G.add(c, P(0.7, -2.0))), line(G.add(c, P(-0.2, 0.4)), G.add(c, P(1.3, -0.2))), pl([G.add(c, P(0.8, -2.0)), G.add(c, P(2.0, -2.0)), G.add(c, P(1.4, -1.0))], true)],
  'Puente angosto': c => [line(G.add(c, P(-0.8, -2.2)), G.add(c, P(-0.8, 2.2))), line(G.add(c, P(0.8, -2.2)), G.add(c, P(0.8, 2.2))), line(G.add(c, P(-1.6, -1.0)), G.add(c, P(-0.8, -0.4))), line(G.add(c, P(1.6, -1.0)), G.add(c, P(0.8, -0.4))), line(G.add(c, P(-1.6, 1.0)), G.add(c, P(-0.8, 0.4))), line(G.add(c, P(1.6, 1.0)), G.add(c, P(0.8, 0.4)))],
  'Animales sueltos': c => [pl([G.add(c, P(-1.8, -0.2)), G.add(c, P(1.0, -0.2)), G.add(c, P(1.4, 0.8)), G.add(c, P(2.0, 0.6)), G.add(c, P(1.6, 1.4)), G.add(c, P(1.0, 1.0)), G.add(c, P(-1.8, 1.0))], true), line(G.add(c, P(-1.5, -0.2)), G.add(c, P(-1.5, -1.6))), line(G.add(c, P(0.7, -0.2)), G.add(c, P(0.7, -1.6)))],
};
const REG = {
  'Velocidad máxima': c => [att(c, 2.6, 'VALOR', 'Velocidad máxima (km/h)', '60')],
  'Prohibido adelantar': c => [pl(rect(c.x - 2.1, c.y - 0.7, c.x - 0.5, c.y + 0.9), true, { color: RED }), pl(rect(c.x + 0.5, c.y - 0.7, c.x + 2.1, c.y + 0.9), true), fill([rect(c.x - 2.1, c.y - 0.7, c.x - 0.5, c.y + 0.9)], RED)],
  'Prohibido estacionar': c => [text(G.add(c, P(0, 0)), 3, 'E'), line(G.add(c, P(-2.4, -2.4)), G.add(c, P(2.4, 2.4)), { color: RED, lw: 0.5 })],
  'Prohibido girar a la izquierda': c => [pl([G.add(c, P(0.6, -2.2)), G.add(c, P(0.6, 0.4)), G.add(c, P(-0.6, 0.4))]), ...arrow(G.add(c, P(-0.6, 0.4)), G.add(c, P(-2.0, 0.4))), line(G.add(c, P(-2.4, -2.4)), G.add(c, P(2.4, 2.4)), { color: RED, lw: 0.5 })],
  'Prohibido el paso': c => [fill([rect(c.x - 2.4, c.y - 0.6, c.x + 2.4, c.y + 0.6)], RED)],
  'Peso máximo': c => [att(c, 2.2, 'VALOR', 'Peso máximo (t)', '10 t')],
};

// ---------- Señales ----------
const PLATE = 7, POST = 5; // diámetro de la placa y altura del poste en el papel (mm)
const post = top => [line(P(0, 0), P(0, top)), line(P(-1, 0), P(1, 0))];
function regulatory() {
  const c = P(0, POST + PLATE / 2), r = PLATE / 2;
  const common = [...post(POST), fill([ring(c, r), ring(c, r * 0.78)], RED), circle(c, r), circle(c, r * 0.78), ...signData('R-15', P(0, -0.5))];
  return { ...withStates(common, Object.fromEntries(Object.entries(REG).map(([k, f]) => [k, f(c)])), G.add(c, P(r + 1.5, r))), base: P(0, 0) };
}
function warning(shape) {
  const r = PLATE / 2 + 0.3, c = P(0, POST + r);
  const outline = shape === 'rombo' ? ngon(c, r, 4, Math.PI / 2) : ngon(G.add(c, P(0, -0.4)), r + 0.6, 3, Math.PI / 2);
  const inner = shape === 'rombo' ? ngon(c, r * 0.88, 4, Math.PI / 2) : ngon(G.add(c, P(0, -0.4)), (r + 0.6) * 0.72, 3, Math.PI / 2);
  const common = [...post(POST), ...(shape === 'rombo' ? [fill([inner], YELLOW), pl(outline, true), pl(inner, true)] : [fill([outline, inner], RED), pl(outline, true), pl(inner, true)]), ...signData(shape === 'rombo' ? 'P-1' : 'A-1', P(0, -0.5))];
  const pc = shape === 'rombo' ? c : G.add(c, P(0, -0.9));
  const sc = shape === 'rombo' ? 1 : 0.8, scaled = f => f(pc).map(e => scaleAbout(e, pc, sc));
  return { ...withStates(common, Object.fromEntries(Object.keys(PICTO).map(k => [k, scaled(PICTO[k])])), G.add(c, P(r + 1.5, r))), base: P(0, 0) };
}
// Escala una entidad de pictograma alrededor de c (sólo los tipos usados aquí)
function scaleAbout(e, c, k) {
  if (k === 1) return e;
  const f = p => G.add(c, G.mul(G.sub(p, c), k));
  const o = { ...e };
  if (e.p1) { o.p1 = f(e.p1); o.p2 = f(e.p2); }
  if (e.pts) o.pts = e.pts.map(f);
  if (e.c) { o.c = f(e.c); o.r = e.r * k; }
  if (e.loops) o.loops = e.loops.map(l => l.map(f));
  return o;
}
function stop() {
  const c = P(0, POST + PLATE / 2), r = PLATE / 2 / Math.cos(Math.PI / 8);
  const oct = ngon(c, r, 8, Math.PI / 8), inner = ngon(c, r * 0.86, 8, Math.PI / 8);
  return { base: P(0, 0), ents: [...post(POST), fill([oct, inner], RED), pl(oct, true), pl(inner, true), att(c, 1.9, 'TEXTO', 'Leyenda', 'PARE'), ...signData('R-1', P(0, -0.5))] };
}
function yieldSign() {
  const c = P(0, POST + PLATE / 2), r = PLATE / 2 + 0.8, tri = ngon(c, r, 3, -Math.PI / 2), inner = ngon(c, r * 0.62, 3, -Math.PI / 2);
  return { base: P(0, 0), ents: [...post(POST - 0.6), fill([tri, inner], RED), pl(tri, true), pl(inner, true), ...signData('R-2', P(0, -0.5))] };
}
// Informativa: cartel rectangular con dos destinos y distancias; parámetro lineal Ancho
function informative() {
  const W = 14, H = 7, y0 = POST, col = GREEN;
  const box = rect(-W / 2, y0, W / 2, y0 + H);
  const ents = [line(P(-W / 2 + 2, 0), P(-W / 2 + 2, y0)), line(P(W / 2 - 2, 0), P(W / 2 - 2, y0)), fill([box], col), pl(box, true), pl(rect(-W / 2 + 0.5, y0 + 0.5, W / 2 - 0.5, y0 + H - 0.5), true),
    att(P(-W / 2 + 1.2, y0 + 4.9), 1.6, 'DESTINO1', 'Primer destino', 'Ciudad', { align: 'l', p: P(-W / 2 + 1.2, y0 + 4.1) }),
    att(P(W / 2 - 1.2, y0 + 4.9), 1.6, 'DIST1', 'Distancia al primer destino', '25 km', { align: 'r', p: P(W / 2 - 1.2, y0 + 4.1) }),
    att(P(-W / 2 + 1.2, y0 + 2.1), 1.6, 'DESTINO2', 'Segundo destino', 'Puerto', { align: 'l', p: P(-W / 2 + 1.2, y0 + 1.3) }),
    att(P(W / 2 - 1.2, y0 + 2.1), 1.6, 'DIST2', 'Distancia al segundo destino', '48 km', { align: 'r', p: P(W / 2 - 1.2, y0 + 1.3) }),
    ...signData('I-1', P(0, -0.5))];
  const idx = ents.map((_, i) => i);
  return { base: P(0, 0), ents, dyn: { lins: [{ name: 'Ancho', p1: P(-W / 2, y0 + H), p2: P(W / 2, y0 + H), rect: { x1: W / 2 - 3, y1: -100, x2: 100, y2: 100 }, ents: idx, min: 8, max: 40 }] } };
}
function kmPost() {
  return { base: P(0, 0), ents: [pl(rect(-1.2, 0, 1.2, 5.5), true), fill([rect(-1.2, 3.2, 1.2, 5.5)], GREY), att(P(0, 4.35), 1.5, 'KM', 'Kilómetro', '0'), att(P(0, 1.6), 1.0, 'RUTA', 'Ruta', 'RN', {})] };
}

// ---------- Planos tipo (metros, escala real) ----------
// Alcantarilla de caño: sección transversal con el caño, la cama de asiento y el relleno; diámetros por visibilidad
function pipeCulvert() {
  const ds = [0.6, 0.8, 1.0, 1.2, 1.5];
  const common = [line(P(-1.6, 0), P(1.6, 0), { ltype: 'DASHED' }), att(P(0, -0.55), 0.12, 'PROGRESIVA', 'Progresiva', '0+000'), att(P(0, -0.75), 0.1, 'OBRA', 'Denominación de la obra', 'Alcantarilla A-1', { invisible: true })];
  const states = {};
  for (const D of ds) {
    const t = D / 10 + 0.02, R = D / 2 + t, c = P(0, R + 0.1);
    states[`Ø ${D.toFixed(2).replace('.', ',')} m`] = [circle(c, D / 2), circle(c, R), pl(rect(-R - 0.3, 0, R + 0.3, 0.1), true), hatch([rect(-R - 0.3, 0, R + 0.3, 0.1)], 'DOTS', 0.03),
      pl([P(-R - 0.3, 0.1), P(-R - 0.3, R + 0.1), P(-R - 0.3 - (R + 0.6), 2 * R + 0.4), P(R + 0.3 + (R + 0.6), 2 * R + 0.4), P(R + 0.3, R + 0.1), P(R + 0.3, 0.1)], false, { ltype: 'DASHED' }),
      text(P(0, 2 * R + 0.65), 0.15, `Caño Ø ${D.toFixed(2).replace('.', ',')} m`)];
  }
  return { base: P(0, 0), ...withStates(common, states, P(1.8, 0.4)) };
}
// Alcantarilla de cajón (losa): celda de luz × altura con tabiques, losa superior e inferior; parámetros Luz y Altura
function boxCulvert() {
  const W = 1.5, H = 1.0, t = 0.2;
  const outer = rect(-t, -t, W + t, H + t), cell = rect(0, 0, W, H);
  const ents = [pl(outer, true), pl(cell, true), hatch([outer, cell], 'ANSI31', 0.02), line(P(-t - 0.6, H + t), P(W + t + 0.6, H + t), { ltype: 'DASHED' }),
    att(P(W / 2, H / 2), 0.12, 'MEDIDAS', 'Luz × altura', '1,50 × 1,00 m'), att(P(W / 2, -t - 0.25), 0.12, 'PROGRESIVA', 'Progresiva', '0+000')];
  const all = ents.map((_, i) => i);
  return {
    base: P(0, 0), ents,
    dyn: {
      lins: [
        { name: 'Luz', p1: P(0, -t), p2: P(W, -t), rect: { x1: W - 0.05, y1: -100, x2: 100, y2: 100 }, ents: all, min: 0.5, max: 8 },
        { name: 'Altura', p1: P(-t, 0), p2: P(-t, H), rect: { x1: -100, y1: H - 0.05, x2: 100, y2: 100 }, ents: all, min: 0.5, max: 5 },
      ],
      look: { name: 'Medidas', pos: P(W + t + 0.3, H + t + 0.3), cols: ['lin:Luz', 'lin:Altura'],
        rows: [[1, 1], [1.5, 1], [2, 1.5], [2, 2], [3, 2], [4, 2.5]].map(([a, b]) => ({ label: `${String(a).replace('.', ',')} × ${String(b).replace('.', ',')} m`, vals: [a, b] })) },
    },
  };
}
// Cabecera de caño: alzado del muro de cabecera con alas y el caño
function headwall() {
  const D = 1.0, c = P(0, D / 2 + 0.25);
  return { base: P(0, 0), ents: [pl([P(-1.4, 0), P(1.4, 0), P(1.4, 1.6), P(-1.4, 1.6)], true), pl([P(-1.4, 0), P(-2.8, 0), P(-2.8, 0.4), P(-1.4, 1.6)], false), pl([P(1.4, 0), P(2.8, 0), P(2.8, 0.4), P(1.4, 1.6)], false),
    circle(c, D / 2), circle(c, D / 2 + 0.1), line(P(-3.2, 0), P(3.2, 0)), hatch([rect(-3.2, -0.25, 3.2, 0)], 'EARTH', 0.02), att(P(0, 1.85), 0.12, 'OBRA', 'Denominación de la obra', 'Cabecera alcantarilla A-1')] };
}
// Defensa metálica (viga de doble onda): planta de un tramo de 4 m con postes cada 2 m, sección y terminal
function guardrailPlan() {
  return { base: P(0, 0), ents: [line(P(0, 0), P(4, 0)), line(P(0, 0.08), P(4, 0.08)), ...[0, 2, 4].map(x => pl(rect(x - 0.075, -0.25, x + 0.075, -0.1), true)), ...[0, 2, 4].map(x => line(P(x, -0.1), P(x, 0)))] };
}
function guardrailTerminal() {
  return { base: P(0, 0), ents: [pl([P(0, 0), P(2, 0), P(4, -0.6)], false), pl([P(0, 0.08), P(2, 0.08), P(4.02, -0.52)], false), arc(P(4.2, -0.4), 0.25, 150, 330), ...[0, 2].map(x => pl(rect(x - 0.075, -0.25, x + 0.075, -0.1), true)), pl(rect(3.925, -0.85, 4.075, -0.7), true)] };
}
function guardrailSection() {
  // perfil W de 310 mm sobre separador y poste C de 1,80 m (1,10 enterrado), con la calzada a la izquierda
  const wave = [P(0.28, 0.55), P(0.33, 0.6), P(0.28, 0.67), P(0.33, 0.74), P(0.28, 0.79), P(0.33, 0.86)];
  return { base: P(0, 0), ents: [pl(rect(0.4, -1.1, 0.5, 0.7), true), pl(rect(0.33, 0.55, 0.4, 0.85), true), pl(wave, false), line(P(-1.2, 0), P(1.2, 0)), hatch([rect(0.5, -0.3, 1.2, 0)], 'EARTH', 0.02),
    text(P(0, 1.05), 0.08, 'Defensa metálica de doble onda'), line(P(-1.2, 0), P(0.4, 0), { lw: 0.5 })] };
}
// Cordón cuneta: cordón de 0,15 × 0,30 con cuneta de ancho variable (parámetro Ancho)
function curbGutter() {
  const W = 0.6;
  const shape = [P(-W, 0), P(0, -0.04), P(0, 0.15), P(0.04, 0.15), P(0.15, 0.17), P(0.15, -0.15), P(-W, -0.15)];
  const ents = [pl(shape, true), hatch([shape], 'DOTS', 0.02), line(P(-W - 0.4, 0.02), P(-W, 0)), line(P(0.15, 0.17), P(0.6, 0.18)), att(P(-W / 2, -0.35), 0.06, 'TIPO', 'Tipo de cordón', 'Cordón cuneta H-21')];
  return { base: P(0, 0), ents, dyn: { lins: [{ name: 'Ancho de cuneta', p1: P(0, -0.15), p2: P(-W, -0.15), rect: { x1: -100, y1: -100, x2: -W + 0.05, y2: 100 }, ents: ents.map((_, i) => i), min: 0.3, max: 1.5 }] } };
}
function barrierCurb() {
  const shape = [P(0, 0), P(0, 0.15), P(0.02, 0.17), P(0.15, 0.17), P(0.15, -0.15), P(-0.1, -0.15), P(-0.1, 0)];
  return { base: P(0, 0), ents: [pl(shape, true), hatch([shape], 'DOTS', 0.02), line(P(-0.6, 0), P(0, 0)), line(P(0.15, 0.17), P(0.6, 0.18))] };
}
// Cuneta trapezoidal en tierra: fondo de ancho variable (Fondo) y profundidad (Profundidad), taludes 1:1,5
function trapDitch() {
  const B = 0.5, Hh = 0.5, z = 1.5;
  const prof = [P(-B / 2 - z * Hh - 0.5, Hh), P(-B / 2 - z * Hh, Hh), P(-B / 2, 0), P(B / 2, 0), P(B / 2 + z * Hh, Hh), P(B / 2 + z * Hh + 0.5, Hh)];
  const ents = [pl(prof, false), hatch([[...prof.slice(1, 5), P(B / 2 + z * Hh, Hh - 0.12), P(B / 2, -0.12), P(-B / 2, -0.12), P(-B / 2 - z * Hh, Hh - 0.12)]], 'EARTH', 0.01),
    att(P(0, -0.35), 0.07, 'TIPO', 'Denominación', 'Cuneta trapezoidal')];
  const all = ents.map((_, i) => i);
  return { base: P(0, 0), ents, dyn: { lins: [
    { name: 'Fondo', p1: P(-B / 2, 0), p2: P(B / 2, 0), rect: { x1: B / 2 - 0.01, y1: -100, x2: 100, y2: 100 }, ents: all, min: 0.2, max: 3 },
    { name: 'Profundidad', p1: P(0, 0), p2: P(0, Hh), rect: { x1: -100, y1: Hh - 0.01, x2: 100, y2: 100 }, ents: all, min: 0.2, max: 2 },
  ] } };
}
function triDitch() {
  const prof = [P(-1.5, 0.4), P(-1.2, 0.4), P(0, 0), P(0.6, 0.4), P(0.9, 0.4)];
  return { base: P(0, 0), ents: [pl(prof, false), hatch([[P(-1.2, 0.4), P(0, 0), P(0.6, 0.4), P(0.6, 0.3), P(0, -0.1), P(-1.2, 0.3)]], 'EARTH', 0.01), att(P(0, -0.3), 0.07, 'TIPO', 'Denominación', 'Cuneta triangular')] };
}

// ---------- Catálogo ----------
// cat: categoría; anno: anotativo (en mm del papel); real: a escala real en metros
/** @type {LibItem[]} */
export const LIBRARY = [
  { name: 'TC_SEÑAL_REGLAMENTARIA', cat: 'Señalización', label: 'Reglamentaria (con estados)', desc: 'Señal circular con aro rojo: velocidad máxima, prohibido adelantar, estacionar, girar, el paso o peso máximo', anno: true, make: regulatory },
  { name: 'TC_SEÑAL_PARE', cat: 'Señalización', label: 'Pare (Stop)', desc: 'Octógono rojo con leyenda editable', anno: true, make: stop },
  { name: 'TC_SEÑAL_CEDA_EL_PASO', cat: 'Señalización', label: 'Ceda el paso', desc: 'Triángulo invertido con borde rojo', anno: true, make: yieldSign },
  { name: 'TC_SEÑAL_PREVENTIVA_ROMBO', cat: 'Señalización', label: 'Preventiva en rombo', desc: 'Rombo amarillo (América): curvas, cruce, estrechamiento, obras, puente angosto, animales', anno: true, make: () => warning('rombo') },
  { name: 'TC_SEÑAL_PREVENTIVA_TRIANGULO', cat: 'Señalización', label: 'Preventiva en triángulo', desc: 'Triángulo con borde rojo (Convención de Viena), con los mismos pictogramas', anno: true, make: () => warning('triangulo') },
  { name: 'TC_SEÑAL_INFORMATIVA', cat: 'Señalización', label: 'Informativa de destinos', desc: 'Cartel con dos destinos y distancias; ancho ajustable', anno: true, make: informative },
  { name: 'TC_MOJON_KILOMETRICO', cat: 'Señalización', label: 'Mojón kilométrico', desc: 'Hito con el kilómetro y la ruta', anno: true, make: kmPost },
  { name: 'TC_ALCANTARILLA_CAÑO', cat: 'Obras de arte', label: 'Alcantarilla de caño (sección)', desc: 'Sección transversal con caño de Ø 0,60 a 1,50 m, cama de asiento y relleno', real: true, make: pipeCulvert },
  { name: 'TC_ALCANTARILLA_CAJON', cat: 'Obras de arte', label: 'Alcantarilla de cajón (sección)', desc: 'Celda de hormigón con luz y altura ajustables y tabla de medidas típicas', real: true, make: boxCulvert },
  { name: 'TC_CABECERA_CAÑO', cat: 'Obras de arte', label: 'Cabecera de caño (alzado)', desc: 'Muro de cabecera con alas para caño de Ø 1,00 m', real: true, make: headwall },
  { name: 'TC_DEFENSA_PLANTA_4M', cat: 'Seguridad vial', label: 'Defensa metálica (tramo de 4 m)', desc: 'Planta de un tramo con postes cada 2 m; repítalo con ARRAYPATH a lo largo del borde', real: true, make: guardrailPlan },
  { name: 'TC_DEFENSA_TERMINAL', cat: 'Seguridad vial', label: 'Terminal de defensa', desc: 'Abatimiento final del tramo de defensa', real: true, make: guardrailTerminal },
  { name: 'TC_DEFENSA_SECCION', cat: 'Seguridad vial', label: 'Defensa metálica (sección)', desc: 'Viga de doble onda sobre separador y poste', real: true, make: guardrailSection },
  { name: 'TC_CORDON_CUNETA', cat: 'Drenaje', label: 'Cordón cuneta (sección)', desc: 'Cordón de 0,15 m con cuneta de ancho ajustable', real: true, make: curbGutter },
  { name: 'TC_CORDON_BARRERA', cat: 'Drenaje', label: 'Cordón barrera (sección)', desc: 'Cordón de 0,15 × 0,32 m', real: true, make: barrierCurb },
  { name: 'TC_CUNETA_TRAPEZOIDAL', cat: 'Drenaje', label: 'Cuneta trapezoidal (sección)', desc: 'Cuneta en tierra con fondo y profundidad ajustables, taludes 1:1,5', real: true, make: trapDitch },
  { name: 'TC_CUNETA_TRIANGULAR', cat: 'Drenaje', label: 'Cuneta triangular (sección)', desc: 'Cuneta en V con taludes 1:3 y 1:1,5', real: true, make: triDitch },
];
export const LIB_CATS = [...new Set(LIBRARY.map(l => l.cat))];
/** @param {string} name @returns {LibItem | null} */
export const libItem = name => LIBRARY.find(l => l.name === name) || null;
// Factor de las unidades del dibujo para los bloques a escala real (definidos en metros)
/** Factor de los bloques reales según las unidades del dibujo. @type {Record<string, number>} */
export const LIB_UNITS = { m: 1, cm: 100, mm: 1000 };
/** @param {Doc} doc @param {LibItem | null} it @returns {number} */
export const libScale = (doc, it) => (it?.real ? LIB_UNITS[doc.settings.libUnits || 'm'] || 1 : 1);

// Definición del bloque de la biblioteca (entidades, punto base y parámetros dinámicos)
/** @param {LibItem} it @returns {{base: Point, ents: Entity[], extra: Partial<import('./types').Block>}} */
export function libBlock(it) {
  const b = it.make();
  return { base: b.base || P(0, 0), ents: /** @type {Entity[]} */ (b.ents.map(e => ({ ...e }))), extra: { ...(b.dyn ? { dyn: b.dyn } : {}), ...(it.anno ? { annotative: true } : {}), lib: true, desc: it.desc } };
}
// Define en el dibujo el bloque de la biblioteca si no existe (devuelve true si lo ha creado)
/** @param {Doc} doc @param {string} name @returns {boolean} lo ha creado */
export function ensureLibBlock(doc, name) {
  if (doc.blocks[name]) return false;
  const it = libItem(name);
  if (!it) return false;
  const b = libBlock(it);
  doc.defineBlock(name, b.base, b.ents, b.extra);
  return true;
}
// Entidades para la vista previa: con estados de visibilidad, las del estado vis (o del primero); los atributos, con su
// valor por defecto (los invisibles no se ven)
/** @param {LibItem} it @param {string} [vis] estado de visibilidad @returns {Entity[]} */
export function libPreview(it, vis) {
  const b = libBlock(it), d = b.extra.dyn, st = d?.vis?.states?.includes(vis) ? vis : d?.vis?.states?.[0];
  const hide = new Set(st ? d.vis.hide?.[st] || [] : []);
  return b.ents.filter((e, i) => !hide.has(i) && !(e.type === 'attdef' && e.invisible))
    .map(e => (e.type === 'attdef' ? { ...e, type: 'text', text: e.def || '' } : e));
}
