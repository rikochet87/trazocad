// Captura de la v0.12: lámina de planta de un tramo de ruta con dos ventanas gráficas giradas según la dirección de
// cada recta (1:1000 la general y 1:500 el detalle), señales de la biblioteca anotativas (mismo tamaño en el papel en las
// dos escalas), alcantarillas, defensas a lo largo del borde y la paleta de herramientas abierta en «Señalización»
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const G = await import('./js/geom.js'), L = await import('./js/library.js'), AN = await import('./js/annoscale.js');
const add = e => doc.add({ color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', ...e });
// Polilínea paralela a una poligonal (ingletes en los vértices)
const offset = (pts, d) => pts.map((p, i) => {
  const n1 = i > 0 ? G.perp(G.norm(G.sub(p, pts[i - 1]))) : null, n2 = i < pts.length - 1 ? G.perp(G.norm(G.sub(pts[i + 1], p))) : null;
  if (!n1 || !n2) return G.add(p, G.mul(n1 || n2, d));
  const m = G.norm(G.add(n1, n2));
  return G.add(p, G.mul(m, d / G.dot(m, n1)));
});
app.T.lwt = true;

// Modelo en metros: en la lámina (milímetros) 1:1000 es una escala de ventana de 1 y 1:500, de 2. La lista de escalas
// del dibujo lleva esos nombres para que la escala de anotación de cada ventana se llame como en el plano
doc.name = 'Planta-RP-v012';
doc.begin();
doc.scales = [{ name: '1:1000', paper: 1, draw: 1 }, { name: '1:500', paper: 2, draw: 1 }, { name: '1:2000', paper: 1, draw: 2 }, ...AN.defaultScales().filter(s => !['1:1', '2:1'].includes(s.name))];
doc.settings.cannoscale = '1:1000';
for (const [n, c, lt] of [['EJE', '#ff5252', 'CENTER'], ['BORDE', '#ffffff'], ['BANQUINA', '#bdbdbd', 'DASHED'], ['PK', '#ffeb3b'], ['ALCANTARILLAS', '#4fc3f7'], ['DEFENSAS', '#ff9800'], ['SEÑALIZACION', '#ff5252'], ['ALAMBRADO', '#8d6e63', 'DASHDOT'], ['TERRENO', '#6d8b5a'], ['Notas', '#cfd8dc']]) {
  const l = doc.addLayer(n, c); if (lt) l.ltype = lt;
}
doc.layer('BORDE').lw = 0.35;
const axis = [P(0, 40), P(110, 70), P(250, 70), P(360, 130)];
add({ type: 'pline', pts: axis, closed: false, layer: 'EJE' });
for (const s of [-1, 1]) {
  add({ type: 'pline', pts: offset(axis, 6.5 * s), closed: false, layer: 'BORDE' });
  add({ type: 'pline', pts: offset(axis, 9 * s), closed: false, layer: 'BANQUINA' });
  add({ type: 'pline', pts: offset(axis, 22 * s), closed: false, layer: 'ALAMBRADO' });
}
for (let k = 0; k < 7; k++) add({ type: 'pline', pts: Array.from({ length: 52 }, (_, i) => { const x = -30 + i * 8; return P(x, -20 + k * 30 + x * 0.18 + 9 * Math.sin(x / 41 + k * 0.7) + 4 * Math.sin(x / 13 + k)); }), closed: false, layer: 'TERRENO' });
const segs = axis.slice(1).map((b, i) => ({ a: axis[i], b, L: G.dist(axis[i], b) }));
const at = s => { for (const g of segs) { if (s <= g.L) return { p: G.lerp(g.a, g.b, s / g.L), ang: G.ang(g.a, g.b) }; s -= g.L; } return null; };
// Progresivas anotativas (2,5 mm en el papel en cualquier ventana)
for (let s = 0; at(s); s += 50) {
  const { p, ang } = at(s), nn = G.P(-Math.sin(ang), Math.cos(ang));
  add({ type: 'line', p1: G.add(p, G.mul(nn, -8)), p2: G.add(p, G.mul(nn, 8)), layer: 'PK' });
  add({ type: 'text', p: G.add(p, G.mul(nn, 10)), h: 2.2, rot: ang + Math.PI / 2, text: `PK 0+${String(s).padStart(3, '0')}`, layer: 'PK', style: 'Standard', anno: ['1:1000', '1:500'] });
}
// Alcantarillas de caño y de cajón
for (const s of [70, 185, 300]) {
  const { p, ang } = at(s), nn = G.P(-Math.sin(ang), Math.cos(ang));
  for (const k of [-1, 1]) add({ type: 'circle', c: G.add(p, G.mul(nn, 14 * k)), r: 1.6, layer: 'ALCANTARILLAS' });
  add({ type: 'line', p1: G.add(p, G.mul(nn, -14)), p2: G.add(p, G.mul(nn, 14)), layer: 'ALCANTARILLAS', ltype: 'HIDDEN' });
}
{
  const { p, ang } = at(235), u = G.P(Math.cos(ang), Math.sin(ang)), nn = G.perp(u), c = (a, b) => G.add(G.add(p, G.mul(u, a)), G.mul(nn, b));
  add({ type: 'pline', pts: [c(-3, -16), c(3, -16), c(3, 16), c(-3, 16)], closed: true, layer: 'ALCANTARILLAS' });
}
// Señales de la biblioteca (anotativas) junto al borde derecho, con su estado de visibilidad y atributos
const sign = (name, s, vis, attribs, side = -1) => {
  L.ensureLibBlock(doc, name);
  const { p, ang } = at(s), nn = G.P(-Math.sin(ang), Math.cos(ang));
  add({ type: 'insert', name, p: G.add(p, G.mul(nn, 11 * side)), sx: 1, sy: 1, rot: ang, layer: 'SEÑALIZACION', anno: ['1:1000', '1:500'], ...(vis ? { dyn: { vis } } : {}), attribs });
};
sign('TC_SEÑAL_REGLAMENTARIA', 20, 'Velocidad máxima', { VALOR: '80', CODIGO: 'R-15', PROGRESIVA: '0+020', LADO: 'Derecho' });
sign('TC_SEÑAL_PREVENTIVA_ROMBO', 95, 'Curva a la izquierda', { CODIGO: 'P-1', PROGRESIVA: '0+095', LADO: 'Derecho' });
sign('TC_SEÑAL_REGLAMENTARIA', 160, 'Prohibido adelantar', { CODIGO: 'R-9', PROGRESIVA: '0+160', LADO: 'Derecho' });
sign('TC_SEÑAL_PREVENTIVA_ROMBO', 265, 'Curva a la derecha', { CODIGO: 'P-2', PROGRESIVA: '0+265', LADO: 'Derecho' });
sign('TC_SEÑAL_INFORMATIVA', 330, null, { DESTINO1: 'Villa Unión', DIST1: '12 km', DESTINO2: 'Ruta 40', DIST2: '27 km', CODIGO: 'I-1', PROGRESIVA: '0+330', LADO: 'Izquierdo' }, 1);
// Defensas metálicas a lo largo del borde, en la curva del PK 0+255
L.ensureLibBlock(doc, 'TC_DEFENSA_PLANTA_4M');
for (let s = 262; s < 302; s += 4) { const { p, ang } = at(s), nn = G.P(-Math.sin(ang), Math.cos(ang)); add({ type: 'insert', name: 'TC_DEFENSA_PLANTA_4M', p: G.add(p, G.mul(nn, 8.2)), sx: 1, sy: 1, rot: ang, layer: 'DEFENSAS' }); }
doc.textStyles[0].font = 'Arial';
doc.commit();

// Lámina A3 con dos ventanas giradas: general 1:1000 alineada con la recta 2 y detalle 1:500 con la recta 3
doc.begin();
app.createLayout('Lámina 1', 'A3');
const lay = doc.layouts[doc.layouts.length - 1];
lay.ents = lay.ents.filter(e => e.type !== 'vport');
const vp = (p1, p2, c, s, twist) => doc.add({ type: 'vport', p1, p2, cx: c.x, cy: c.y, s, twist, layer: 'Ventanas', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' }, lay.ents);
const t1 = G.ang(axis[0], axis[3]), t3 = G.ang(segs[2].a, segs[2].b);
vp(P(14, 150), P(406, 283), P(180, 85), 1, t1);
vp(P(14, 38), P(262, 146), at(285).p, 2, t3);
const note = (x, y, text, h = 3) => doc.add({ type: 'mtext', p: P(x, y), h, w: 0, text, attach: 'tl', layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' }, lay.ents);
note(18, 280, 'PLANTA GENERAL — ESC. 1:1000 (ventana girada según el eje)', 3.2);
note(18, 143, 'DETALLE PK 0+260 a 0+310 — ESC. 1:500 (girada según la recta 3)', 3.2);
note(270, 140, 'Señales y progresivas anotativas:\n2,2 mm en el papel en las dos escalas.\nDefensa metálica (biblioteca vial)\nen la curva del PK 0+255.', 3.4);
const tb = lay.ents.find(e => e.type === 'insert' && e.name === 'CAJETIN');
if (tb) tb.attribs = { ...tb.attribs, ESCALA: 'Indicadas' };
doc.commit();
app.switchTab(doc.layouts.indexOf(lay));
app.zoomExtents();
app.ui.palIdx = 0; app.ui.showPalette('tools');
await tick(60);
app.renderer.invalidate(); app.renderer.drawBase();
await tick(450);
document.getElementById('cmd-history').innerHTML = '';
app.print('Comando: PLAN / Propiedades › Giro: ventanas gráficas giradas según la dirección de cada recta del eje (VIEWTWIST). Comando: CANNOSCALE › 1:1000 y 1:500 por ventana');
app.print('Comando: TOOLPALETTES  ›  Señalización: señales de la biblioteca vial con su capa, estado de visibilidad y atributos (clic o arrastrar al dibujo)');
out.vports = lay.ents.filter(e => e.type === 'vport').map(v => ({ s: v.s, twist: +(v.twist * 180 / Math.PI).toFixed(2), anno: AN.vpScale(doc, v).name }));
out.signs = doc.model.filter(e => e.type === 'insert' && e.name.startsWith('TC_SEÑAL')).length;
return out;
