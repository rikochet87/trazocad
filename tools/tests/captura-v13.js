// Captura de la v0.13: planta de un tramo de ruta en coordenadas de proyección (Gauss-Krüger, 7 cifras) abierta desde
// un DXF: curvas de nivel como polilíneas 3D (maestras cada 5 m), superficie TIN de caras 3D a lo largo del eje, eje como
// polilínea 3D con la rasante, bordes y progresivas. El origen local se elige solo; la barra de estado y Propiedades
// muestran las coordenadas reales y la Z del vértice designado del eje
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const out = {}, P = (x, y) => ({ x, y });
const G = await import('./js/geom.js'), DXF = await import('./js/dxf.js'), { Doc } = await import('./js/document.js'), E = await import('./js/entities.js');
const X0 = 5654000, Y0 = 6123000; // esquina del modelo en coordenadas reales
// Terreno: valle cuyo fondo sigue g(x) y sube hacia el este; z = 100 + 0.004 x + k (y − g(x))²
const g = x => 700 + 160 * Math.sin(x / 520) + 60 * Math.sin(x / 190);
const K = 0.00045, zt = (x, y) => 100 + 0.004 * x + K * (y - g(x)) ** 2;
const d = new Doc();
const L = { CURVAS: '#7d6a4f', MAESTRAS: '#c8a165', TIN: '#2f6b5c', EJE: '#ff5252', BORDE: '#e6e6e6', PK: '#ffeb3b', COTAS: '#c8a165' };
for (const [n, c] of Object.entries(L)) d.addLayer(n, c);
d.layer('EJE').ltype = 'CENTER';
const add = e => d.add({ color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', ...e }, d.model);
// Curvas de nivel cada metro: para cada cota, las dos ramas del valle
for (let c = 101; c <= 150; c++) {
  for (const s of [-1, 1]) {
    let run = [];
    const flush = () => { if (run.length > 1) add({ type: 'pline3d', layer: c % 5 ? 'CURVAS' : 'MAESTRAS', pts: run }); run = []; };
    for (let x = 0; x <= 3000; x += 6) {
      const r = (c - 100 - 0.004 * x) / K;
      if (r < 0) { flush(); continue; }
      run.push({ x: X0 + x, y: Y0 + g(x) + s * Math.sqrt(r), z: c });
    }
    flush();
    if (c % 5 === 0) for (let x = 300; x < 3000; x += 900) { const r = (c - 100 - 0.004 * x) / K; if (r > 0) add({ type: 'text', layer: 'COTAS', p: P(X0 + x, Y0 + g(x) + s * Math.sqrt(r) + 3), h: 9, rot: 0, text: String(c), align: 'c' }); }
  }
}
// Eje: sigue el valle a media ladera, con la rasante del terreno suavizada; bordes de calzada a ±3,65 m
const axis = [];
for (let x = 0; x <= 3000; x += 15) { const y = g(x) + 130; axis.push({ x: X0 + x, y: Y0 + y, z: +(zt(x, y) + 1.2).toFixed(3) }); }
add({ type: 'pline3d', layer: 'EJE', pts: axis });
const off = (pts, dd) => pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], n = G.perp(G.norm(G.sub(b, a))); return P(p.x + n.x * dd, p.y + n.y * dd); });
for (const s of [-1, 1]) add({ type: 'pline', layer: 'BORDE', pts: off(axis, 3.65 * s) });
// Superficie TIN a lo largo del eje (franja de 120 m): triángulos con la cota del terreno
for (let i = 0; i + 1 < axis.length; i += 1) {
  const a = axis[i], b = axis[i + 1], n = G.perp(G.norm(G.sub(b, a)));
  for (let k = -3; k < 3; k++) {
    const q = (p, j) => { const x = p.x + n.x * 20 * j, y = p.y + n.y * 20 * j; return { x, y, z: +zt(x - X0, y - Y0).toFixed(3) }; };
    const p1 = q(a, k), p2 = q(b, k), p3 = q(b, k + 1), p4 = q(a, k + 1);
    add({ type: 'face3d', layer: 'TIN', pts: [p1, p2, p3, p3] });
    add({ type: 'face3d', layer: 'TIN', pts: [p1, p3, p4, p4] });
  }
}
// Progresivas cada 300 m
let acc = 0;
for (let i = 1; i < axis.length; i++) {
  const prev = acc; acc += G.dist(axis[i - 1], axis[i]);
  if (Math.floor(acc / 300) > Math.floor(prev / 300)) {
    const n = G.perp(G.norm(G.sub(axis[i], axis[i - 1]))), pk = Math.floor(acc / 300) * 300;
    add({ type: 'line', layer: 'PK', p1: P(axis[i].x - n.x * 8, axis[i].y - n.y * 8), p2: P(axis[i].x + n.x * 8, axis[i].y + n.y * 8) });
    add({ type: 'text', layer: 'PK', p: P(axis[i].x + n.x * 11, axis[i].y + n.y * 11), h: 7, rot: G.ang(axis[i - 1], axis[i]), text: `${Math.floor(pk / 1000)}+${String(pk % 1000).padStart(3, '0')}`, align: 'l' });
  }
}
const text = DXF.writeDXF(d, '2007');
await app.io.loadFile(new File([text], 'Planta-RP-v013.dxf'));
await tick(50);
const doc = app.doc;
out.n = doc.model.length; out.origin = { ...doc.origin };
out.types = doc.model.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
// Vista: tramo central; eje designado y un vértice suyo en Propiedades
app.T.grid = false; app.T.lwt = true;
const eje = doc.model.find(e => e.type === 'pline3d' && e.layer === 'EJE');
const v = app.view, c = eje.pts[100];
v.cx = c.x + 60; v.cy = c.y - 90; v.scale = 1.35; v.rot = 0;
const vx = E.propsOf(eje).find(p => p.label === 'Vértice');
doc.begin(); doc.modify(eje.id, e => vx.set(e, 101)); doc.commit();
app.sel = new Set([eje.id]); app.selChanged();
app.ui.showPalette('props');
app.mouse.pt = { ...eje.pts[100] }; app.mouse.inside = false;
app.ui.updateCoords(eje.pts[100]);
await tick(80);
app.renderer.invalidate(); app.renderer.drawBase();
await tick(1200);
document.getElementById('cmd-history').innerHTML = '';
app.print(`Comando: OPEN  Planta-RP-v013.dxf  ›  DXF importado en segundo plano: ${out.n} objetos (curvas de nivel 3D, TIN de ${out.types.face3d} caras 3D, eje 3D).`);
app.print(`Coordenadas grandes: origen local del dibujo en ${doc.origin.x}, ${doc.origin.y}; se ven y se exportan las coordenadas reales.`);
out.vertex = { x: +(eje.pts[100].x + doc.origin.x).toFixed(3), y: +(eje.pts[100].y + doc.origin.y).toFixed(3), z: eje.pts[100].z };
out.status = app.ui.coordsEl.textContent;
return out;
