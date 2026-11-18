const { runTopoJob } = await import('./js/topojobs.js');
let checks = 0;
const assert = (v, m) => {
    checks++;
    if (!v) throw Error(m);
  },
  tick = () => new Promise(r => setTimeout(r, 30)),
  root = document.getElementById('modal-root'),
  accept = () => root.querySelector('.btn.primary').click(),
  cancel = () => [...root.querySelectorAll('button')].find(b => b.textContent === 'Cancelar').click();
assert(
  [...document.querySelectorAll('#ribbon-tabs button')].some(b => b.textContent === 'Topografía'),
  'Pestaña Topografía'
);
const job = app.run('SURVEYIMPORT');
await tick();
root.querySelector('textarea').value = '01,0,0,0,TERRENO\n02,0,10,10,TERRENO\n03,10,10,30,TERRENO\n04,10,0,20,TERRENO';
accept();
await job;
assert(app.doc.model.filter(e => e.topoPoint).length === 4, 'Importar desde diálogo');
const cfg = app.run('POINTGROUPS');
await tick();
[...root.querySelectorAll('button')].find(b => b.textContent === 'Añadir').click();
const row = root.querySelector('.geo-condition');
row.querySelector('input').value = 'Terreno';
row.querySelectorAll('select')[0].value = 'square';
accept();
await cfg;
assert(app.doc.topo.groups[0].symbol === 'square', 'Guardar grupo desde diálogo');
const tin = app.run('TINCREATE');
await tick();
accept();
await tin;
assert(app.doc.topo.surfaces.length === 1, 'Crear TIN desde diálogo');
const curves = app.run('TINCONTOURS');
await tick();
accept();
await curves;
assert(
  app.doc.model.some(e => e.type === 'pline3d' && e.data?.mayor),
  'Curvas mayores desde diálogo'
);
const analysis = app.run('TINANALYSIS');
await tick();
root.querySelectorAll('select')[1].value = 'slope';
accept();
await analysis;
assert(
  app.doc.model.some(e => e.topoAnalysis),
  'Análisis desde diálogo'
);
const state = app.doc.state(),
  pending = app.run('TRAVERSEADJUST');
await tick();
cancel();
await pending;
assert(state === app.doc.state(), 'Cancelar diálogo conserva dibujo');
const tr = app.run('TRAVERSEADJUST', {
  legs: [
    { distance: 10, azimuth: 0 },
    { distance: 10, azimuth: 90 },
    { distance: 10, azimuth: 180 },
    { distance: 9.9, azimuth: 270 },
  ],
  outputLayer: 'CONTROL',
});
await tr;
assert(app.doc.topo.traverses.length === 1, 'Comando de compensación con argumentos');
const s = app.doc.topo.surfaces[0];
await app.run('TINREBUILD', { surfaceId: s.id });
assert(
  app.doc.topo.surfaces.length === 1 && app.doc.topo.surfaces[0].id === s.id,
  'Reconstruir sin duplicar superficie'
);
const svg = app.io.buildSVG().svg;
assert(svg.includes('<polygon') && svg.includes('fill-opacity="0.65"'), 'Caras y rellenos en SVG');
assert(svg.includes('<polyline') && !svg.includes('fill="BYLAYER"'), 'Curvas 3D y colores resueltos en SVG');
app.renderer.flushTiles();
app.renderer.drawBase();
return { checks };
