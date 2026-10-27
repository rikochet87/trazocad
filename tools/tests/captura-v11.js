// Captura de la v0.11: planta de un tramo de ruta en tres ventanas en mosaico (la general a la derecha y dos detalles),
// SCP alineado con la recta central (rejilla, cursor e icono girados), alcantarillas designadas con QSELECT en todas
// las ventanas, vistas con nombre, capas aisladas con un filtro de capas en la paleta
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const G = await import('./js/geom.js');
const text = (x, y, str, h, color, w = 80, lay = 'Notas') => doc.add({ type: 'mtext', p: P(x, y), h, w, text: str, attach: 'tl', color, layer: lay, ltype: 'BYLAYER', lw: 'BYLAYER' });
const add = e => doc.add({ color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', ...e });
// Polilínea paralela a una poligonal (ingletes en los vértices)
const offset = (pts, d) => pts.map((p, i) => {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const n1 = i > 0 ? G.perp(G.norm(G.sub(p, pts[i - 1]))) : null, n2 = i < pts.length - 1 ? G.perp(G.norm(G.sub(pts[i + 1], p))) : null;
  if (!n1 || !n2) return G.add(p, G.mul(n1 || n2, d));
  const m = G.norm(G.add(n1, n2));
  return G.add(p, G.mul(m, d / G.dot(m, n1)));
});
app.T.lwt = true;

doc.name = 'Planta-RP-v011';
doc.begin();
for (const [n, c, lt] of [['EJE', '#ff5252', 'CENTER'], ['BORDE', '#ffffff'], ['BANQUINA', '#bdbdbd', 'DASHED'], ['PK', '#ffeb3b'], ['ALCANTARILLAS', '#4fc3f7'], ['ALAMBRADO', '#8d6e63', 'DASHDOT'], ['TERRENO', '#6d8b5a'], ['COTAS', '#9ccc65'], ['Notas', '#cfd8dc']]) {
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
// Curvas de nivel del terreno
for (let k = 0; k < 7; k++) add({ type: 'pline', pts: Array.from({ length: 48 }, (_, i) => { const x = -10 + i * 8; return P(x, 2 + k * 24 + x * 0.18 + 9 * Math.sin(x / 41 + k * 0.7) + 4 * Math.sin(x / 13 + k)); }), closed: false, layer: 'TERRENO' });
// Progresivas cada 50 m sobre el eje
const segs = axis.slice(1).map((b, i) => ({ a: axis[i], b, L: G.dist(axis[i], b) }));
const at = s => { for (const g of segs) { if (s <= g.L) return { p: G.lerp(g.a, g.b, s / g.L), ang: G.ang(g.a, g.b) }; s -= g.L; } return null; };
for (let s = 0, n = 0; at(s); s += 50, n++) {
  const { p, ang } = at(s), nn = G.P(-Math.sin(ang), Math.cos(ang));
  add({ type: 'line', p1: G.add(p, G.mul(nn, -8)), p2: G.add(p, G.mul(nn, 8)), layer: 'PK' });
  add({ type: 'text', p: G.add(p, G.mul(nn, 10)), h: 2.6, rot: ang + Math.PI / 2, text: `PK 0+${String(s).padStart(3, '0')}`, layer: 'PK', style: 'Standard' });
}
// Alcantarillas: caños circulares bajo la calzada y una alcantarilla de cajón
const culv = [];
for (const s of [70, 185, 300]) {
  const { p, ang } = at(s), nn = G.P(-Math.sin(ang), Math.cos(ang));
  for (const k of [-1, 1]) culv.push(add({ type: 'circle', c: G.add(p, G.mul(nn, 14 * k)), r: 1.6, layer: 'ALCANTARILLAS' }));
  add({ type: 'line', p1: G.add(p, G.mul(nn, -14)), p2: G.add(p, G.mul(nn, 14)), layer: 'ALCANTARILLAS', ltype: 'HIDDEN' });
}
{
  const { p, ang } = at(235), u = G.P(Math.cos(ang), Math.sin(ang)), nn = G.perp(u);
  const c = (a, b) => G.add(G.add(p, G.mul(u, a)), G.mul(nn, b));
  add({ type: 'pline', pts: [c(-3, -16), c(3, -16), c(3, 16), c(-3, 16)], closed: true, layer: 'ALCANTARILLAS' });
}
// Ancho de la calzada
const { p: pw, ang: aw } = at(150), nw = G.P(-Math.sin(aw), Math.cos(aw));
add({ type: 'dim', style: 'ISO-25', kind: 'ali', p1: G.add(pw, G.mul(nw, -6.5)), p2: G.add(pw, G.mul(nw, 6.5)), p3: G.add(G.add(pw, G.mul(nw, -6.5)), G.mul(G.P(Math.cos(aw), Math.sin(aw)), 18)), layer: 'COTAS' });
doc.textStyles[0].font = 'Arial';
doc.commit();

// SCP alineado con la recta central y vistas con nombre
await app.run('UCS', { ...(() => { const g = segs[2]; return { o: g.a, ang: G.ang(g.a, g.b) }; })(), name: 'Recta 3' });
doc.begin(); doc.ucsList.push({ name: 'Recta 3', o: segs[2].a, ang: G.ang(segs[2].a, segs[2].b) }); doc.commit();
app.zoomExtents();
await app.run('VIEW', { save: 'General' });
const rv = (name, c, w) => doc.views.push({ name, space: 'model', cx: c.x, cy: c.y, w, h: w * 0.6, ucs: { ...doc.ucs } });
doc.begin(); rv('Alcantarilla PK 0+185', at(185).p, 70); rv('Cajón PK 0+235', at(235).p, 60); doc.commit();
// Filtro de capas en la paleta
doc.begin(); doc.layerFilters.push({ name: 'Vialidad', kind: 'prop', rules: { name: 'B*,E*,P*' } }); doc.commit();

// Ventanas en mosaico: dos detalles a la izquierda y la general a la derecha
await app.run('VPORTS', { op: '3', dir: 'ENcima' });
const [tC, tA, tB] = app.tiles;
const look = (t, c, w) => { t.view.cx = c.x; t.view.cy = c.y; t.view.scale = t.view.w / w; };
look(tA, at(185).p, 105);
look(tB, G.add(at(235).p, P(22, 6)), 105);
app.setActiveTile(tC);
app.view.fit({ x1: -5, y1: 12, x2: 365, y2: 150 }, 0.02);
// QSELECT: alcantarillas circulares
await app.run('QSELECT', { type: 'circle', prop: 'Capa', op: '=', value: 'ALCANTARILLAS' });
app.ui.layFilter = 'Vialidad';
app.ui.showPalette('layers');
app.mouse.sx = tC.view.ox + tC.view.w * 0.86; app.mouse.sy = tC.view.oy + tC.view.h * 0.86; app.mouse.inside = true;
app.updateMouse(); app.hover = null;
app.renderer.invalidate(); app.renderer.drawBase();
await tick(450);
document.getElementById('cmd-history').innerHTML = '';
app.print('Comando: VPORTS  ›  3 (ENcima): planta general y dos detalles, cada uno con su vista. Comando: UCS › Objeto: SCP «Recta 3» alineado con la recta PK 0+255 – PK 0+380 (rejilla, cursor e icono girados)');
app.print('Comando: QSELECT  ›  6 objeto(s) cumplen la condición (Círculo: Capa = ALCANTARILLAS); 6 designado(s).');

out.tiles = app.tiles.length;
out.sel = app.sel.size;
out.ucs = doc.ucs?.name;
out.views = doc.views.map(v => v.name);
return out;
