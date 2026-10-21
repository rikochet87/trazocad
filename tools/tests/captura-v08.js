// Captura de la v0.8: planta de oficina con muros MLINE, matriz de columnas con un elemento sustituido,
// marcas y líneas de centro, cotas espaciadas y cortadas, nube de revisión, cobertura e imagen delimitada
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {};
const drive = async (p, ...steps) => {
  for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); }
  await tick();
  if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; }
  await p; return 'ok';
};
const cmd = (name, ...steps) => drive(app.run(name), ...steps);
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const selIds = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const last = () => doc.model.at(-1);
const layer = n => { doc.cur.layer = n; };
const text = (x, y, str, h, color, w = 80, lay = 'Notas') => doc.add({ type: 'mtext', p: { x, y }, h, w, text: str, attach: 'tl', color, layer: lay });

doc.name = 'Oficina-Revision-08';
doc.begin();
doc.addLayer('Muros', '#eef3f8'); doc.layer('Muros').lw = 0.4;
doc.addLayer('Estructura', '#ffb74d');
doc.addLayer('Cotas', '#9ccc65');
doc.addLayer('Notas', '#cfd8dc');
doc.addLayer('Revision', '#ff7043');
doc.addLayer('Raster', '#90a4ae');
doc.mlineStyles.push({ name: 'MURO24', desc: 'Muro de 24 cm', elems: [{ off: 1.2, color: 'BYLAYER', ltype: 'BYLAYER' }, { off: -1.2, color: 'BYLAYER', ltype: 'BYLAYER' }],
  caps: { sLine: true, eLine: true }, joints: true, fill: '#46525f' });
doc.mlineStyles.push({ name: 'MURO12', desc: 'Muro de 12 cm', elems: [{ off: 0.9, color: 'BYLAYER', ltype: 'BYLAYER' }, { off: -0.9, color: 'BYLAYER', ltype: 'BYLAYER' }],
  caps: { sLine: true, eLine: true }, joints: true, fill: '#3d4854' });
doc.cur.mlineStyle = 'MURO24';
doc.settings.hatchPat = 'NET'; doc.settings.hatchScale = 0.8; doc.settings.hatchAng = 0;
doc.cur.dimStyle = 'Standard';
doc.commit();

// ---- Muros: rectángulo de líneas múltiples y tabiques que se cruzan (MLEDIT CC) ----
layer('Muros');
await cmd('MLINE', 'S', 'MURO24', 'J', 'C', 'E', '1', '18,42', '138,42', '138,132', '18,132', 'C');
await cmd('MLINE', 'S', 'MURO24', 'J', 'C', 'E', '1', '78,43.2', '78,130.8', '');
await cmd('MLINE', 'S', 'MURO24', 'J', 'C', 'E', '1', '19.2,86', '136.8,86', '');
const wallV = doc.model.filter(e => e.type === 'mline').at(-2), wallH = last();
out.mledit = await cmd('-MLEDIT', 'CC', pick(wallV, { x: 78, y: 100 }), pick(wallH, { x: 110, y: 86 }), '');
out.cuts = [wallV.cuts?.length || 0, wallH.cuts?.length || 0];

// ---- Matriz de columnas 3 x 2 con un elemento sustituido por una columna circular ----
layer('Estructura');
await cmd('RECTANG', '98,54', '102,58'); const sq = last();
await cmd('LINE', '98,54', '102,58', ''); const d1 = last();
await cmd('LINE', '98,58', '102,54', ''); const d2 = last();
await cmd('ARRAYRECT', selIds([sq.id, d1.id, d2.id]), 'COL', '3', '16', 'F', '2', '17', '');
const arr = last();
await cmd('CIRCLE', '132,73', '3.3'); const rc = last();
await cmd('LINE', '129.7,73', '134.3,73', ''); const rl1 = last();
await cmd('LINE', '132,70.7', '132,75.3', ''); const rl2 = last();
out.repl = await cmd('ARRAYEDIT', pick(arr, { x: 100, y: 56 }), 'RZ', '132,73', selIds([rc.id, rl1.id, rl2.id]), '');

// ---- Cota general y dos parciales; DIMSPACE las separa y DIMBREAK corta donde pasa el eje ----
layer('Cotas');
await cmd('DIMLINEAR', '18,42', '138,42', '78,34'); const dimA = last();
await cmd('DIMLINEAR', '18,42', '78,42', '48,32'); const dimB = last();
await cmd('DIMLINEAR', '78,42', '138,42', '108,32'); const dimC = last();
out.space = await cmd('DIMSPACE', pick(dimA, { x: 60, y: 34 }), selIds([dimB.id, dimC.id]), '9');
layer('Notas');
await cmd('LINE', '121,42', '121,11', '');
const axis = last();
doc.begin(); doc.modify(axis.id, e => { e.layer = 'Cotas'; e.color = '#f06292'; e.ltype = 'DASHED'; }); doc.commit();
out.breakA = await cmd('DIMBREAK', pick(dimA, { x: 60, y: 34 }), 'S', selIds([axis.id]));
out.breakC = await cmd('DIMBREAK', pick(dimC, { x: 100, y: dimC.p3.y }), 'S', selIds([axis.id]));
out.dims = [dimA.p3.y, dimB.p3.y, dimC.p3.y];
out.breaks = [dimA.breaks?.length || 0, dimC.breaks?.length || 0];

// ---- Marcas de centro y línea de centro entre dos círculos ----
layer('Cotas');
await cmd('CIRCLE', '170,132', '6'); const c1 = last();
await cmd('CIRCLE', '204,132', '6'); const c2 = last();
await cmd('CENTERMARK', pick(c1, { x: 176, y: 132 }), pick(c2, { x: 210, y: 132 }), '');
await cmd('CENTERLINE', pick(c1, { x: 176, y: 132 }), pick(c2, { x: 210, y: 132 }));
out.centers = doc.model.filter(e => e.type === 'center').map(e => [e.kind, (e.lines || []).length]);

// ---- Cobertura sobre un sombreado ----
layer('Notas');
await cmd('RECTANG', '24,48', '72,80'); const floor = last();
await cmd('HATCH', 'S', selIds([floor.id]), '');
out.wipeout = await cmd('WIPEOUT', '31,51', '38,70', '55,72', '66,66', '66,53', '56,48', '40,48', '');

// ---- Detalle de cruce de muros con nube de revisión ----
layer('Muros');
await cmd('MLINE', 'S', 'MURO12', 'J', 'C', 'E', '1.2', '164,48', '224,48', '');
await cmd('MLINE', 'S', 'MURO12', 'J', 'C', 'E', '1.2', '194,30', '194,66', '');
const cv = doc.model.filter(e => e.type === 'mline').at(-2), ch = last();
await cmd('-MLEDIT', 'CC', pick(cv, { x: 180, y: 48 }), pick(ch, { x: 194, y: 36 }), '');
layer('Revision');
out.cloud = await cmd('REVCLOUD', '4', 'R', '160,22', '230,72');

// ---- Imagen raster delimitada ----
const image = await (async () => {
  const c = document.createElement('canvas'); c.width = 720; c.height = 300;
  const g = c.getContext('2d');
  g.fillStyle = '#dde5d5'; g.fillRect(0, 0, 720, 300);
  g.fillStyle = '#c7cdc2'; g.fillRect(0, 128, 720, 44); g.fillRect(300, 0, 40, 300);
  for (const [x, y, w, h] of [[35, 30, 110, 75], [175, 30, 80, 75], [360, 22, 110, 86], [500, 26, 140, 70], [38, 196, 200, 76], [365, 190, 100, 82], [500, 188, 150, 88]]) {
    g.fillStyle = '#eee9de'; g.fillRect(x + 6, y + 6, w, h); g.fillStyle = '#c9784f'; g.fillRect(x, y, w, h);
  }
  g.fillStyle = '#9ec4d8'; g.beginPath(); g.ellipse(610, 230, 55, 28, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#6f9b58';
  for (let i = 0; i < 46; i++) { const x = 25 + (i * 137) % 680, y = 25 + (i * 83) % 255; g.beginPath(); g.arc(x, y, 5 + (i % 3) * 2, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ffffff'; g.font = 'bold 20px Arial'; g.fillText('SECTOR NORTE', 20, 288);
  return c.toDataURL('image/png');
})();
doc.begin();
doc.add({ type: 'image', p: { x: 158, y: 86 }, w: 70, h: 29.2, src: image, name: 'Sector-Norte.png', rot: 0, layer: 'Raster' });
doc.commit();
const img = last();
out.image = await cmd('XCLIP', selIds([img.id]), 'N', 'P', '159,88', '198,88', '198,98', '212,98', '212,88', '227,88', '227,114', '159,114', '');

// ---- Rótulos ----
layer('Notas');
doc.begin();
text(18, 148, 'PLANTA DE OFICINA · REVISIÓN 08', 3.9, '#ffffff', 120);
text(156, 146, 'CENTERMARK / CENTERLINE', 2.6, '#ffd54f', 74, 'Cotas');
text(156, 80, 'IMAGEATTACH / XCLIP', 2.6, '#ffd54f', 74, 'Cotas');
text(156, 13, 'MLEDIT CC / REVCLOUD', 2.6, '#ffd54f', 74, 'Cotas');
text(36.5, 66, 'WIPEOUT\noculta el relleno', 2.0, '#ffd54f', 28, 'Cotas');
doc.commit();

// Vista: cámara desplazada para dejar libre la paleta de propiedades
app.view.cx = 158; app.view.cy = 80; app.view.scale = 4.1;
app.renderer.invalidate(); app.renderer.drawBase();
app.sel.clear(); app.sel.add(arr.id); app.selChanged();
app.ui.showPalette('props');
app.renderer.invalidate(); app.renderer.drawBase();
await tick(400);
document.getElementById('cmd-history').innerHTML = '';

out.array = [arr.cols, arr.rows, arr.dx, arr.dy, Object.keys(arr.repl || {}).length];
out.types = [...new Set(doc.model.map(e => e.type))].join(',');

out.clip = img.clip?.pts.length;
out.wipe = doc.model.filter(e => e.type === 'wipeout').length;
return out;

