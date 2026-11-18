const { runTopoJob } = await import('./js/topojobs.js');
const d = app.doc;
d.name = 'Topografía — levantamiento y superficie de terreno';
const rows = [];
let n = 1;
for (let y = 0; y <= 100; y += 10)
  for (let x = 0; x <= 140; x += 10)
    rows.push(
      [
        String(n++).padStart(3, '0'),
        y,
        x,
        (80 + 0.045 * x + 0.09 * y + 8 * Math.exp(-((x - 66) ** 2 + (y - 45) ** 2) / 1800)).toFixed(4),
        'TERRENO',
      ].join(',')
    );
const points = await runTopoJob(app, {
  operation: 'points',
  text: rows.join('\n'),
  outputLayer: 'LEVANTAMIENTO',
  size: 0.45,
  height: 1.2,
});
await runTopoJob(app, {
  operation: 'configure',
  groups: [{ name: 'Terreno', description: 'TER*', symbol: 'circle', size: 0.45, label: 'none', color: '#a3c5cd' }],
  keys: [],
});
d.begin();
d.addLayer('EXCLUSION', '#ed9c78');
const hole = d.add({
  type: 'pline',
  pts: [
    { x: 100, y: 20 },
    { x: 120, y: 20 },
    { x: 120, y: 40 },
    { x: 100, y: 40 },
  ],
  closed: true,
  layer: 'EXCLUSION',
});
d.commit();
const tin = await runTopoJob(app, {
  operation: 'tin',
  ids: points.ids,
  holeIds: [hole.id],
  metersPerUnit: 1,
  zMetersPerUnit: 1,
  outputLayer: 'TIN',
});
d.layer('TIN').color = '#38555e';
await runTopoJob(app, {
  operation: 'contours',
  surfaceId: tin.surfaceId,
  interval: 1,
  majorEvery: 5,
  outputLayer: 'CURVAS',
  labels: false,
});
d.layer('CURVAS').color = '#65bea9';
d.layer('CURVAS_MAYORES').color = '#f3d17a';
const analysis = await runTopoJob(app, {
  operation: 'analysis',
  surfaceId: tin.surfaceId,
  mode: 'slope',
  min: 0,
  max: 15,
  outputLayer: 'PENDIENTE',
});
d.begin();
for (const id of analysis.ids)
  d.modify(id, e => {
    e.pts = e.pts.map(p => ({ ...p, x: p.x + 195 }));
  });
d.addLayer('TITULOS', '#d8e3ed');
for (const [x, y, text, h] of [
  [0, 135, 'LEVANTAMIENTO · SUPERFICIE TIN', 4.5],
  [0, 124, '165 puntos · curvas de 1 m / 5 m · zona excluida', 3],
  [195, 135, 'ANÁLISIS DE PENDIENTES', 4.5],
  [195, 124, 'Caras del terreno · verde 0° → rojo 15°', 3],
  [0, -13, 'TIN 2,5D · cotas 80–96 m · unidades métricas', 3],
  [195, -13, 'Cálculo en segundo plano · datos originales conservados', 3],
  [100, 29, 'EXCLUIDA', 1.7],
])
  d.add({ type: 'text', p: { x, y }, text, h, rot: 0, layer: 'TITULOS' });
d.commit();
app.sel.clear();
app.selChanged();
app.T.grid = false;
app.T.lwt = true;
app.ui.showPalette('props');
app.view.cx = 168;
app.view.cy = 60;
app.view.scale = 3;
[...document.querySelectorAll('#ribbon-tabs button')].find(b => b.textContent === 'Topografía')?.click();
document.getElementById('cmd-history').replaceChildren();
app.print('TrazoCAD v0.17 · Topografía — puntos, poligonales, superficies y curvas de nivel');
app.print(`TINCREATE: ${tin.ids.length} caras, con exclusión · TINCONTOURS: curvas mayores y menores con cota Z.`);
app.print('TRAVERSEADJUST: Bowditch / Tránsito · TINFROMDEM: superficie desde MDT, sin puentear NoData.');
app.renderer.flushTiles();
app.renderer.drawBase();
await new Promise(r => setTimeout(r, 300));
return { version: d.toJSON().version, puntos: points.ids.length, caras: tin.ids.length };
