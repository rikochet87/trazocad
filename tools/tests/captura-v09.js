// Captura de la v0.9: plano de taller con imagen raster semitransparente y recortada (pinzamientos visibles),
// cota cortada por un eje (DIMBREAK), matriz asociativa, nube de revisión editada, cobertura con marco y
// vértice añadido a una línea múltiple; el rótulo de fondo demuestra DRAWORDER
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
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
const text = (x, y, str, h, color, w = 80, lay = 'Notas') => doc.add({ type: 'mtext', p: P(x, y), h, w, text: str, attach: 'tl', color, layer: lay });
const E = await import('./js/entities.js');
app.T.lwt = true;

doc.name = 'Taller-Revision-09';
doc.begin();
doc.addLayer('Forjado', '#90caf9');
doc.addLayer('Estructura', '#ffb74d');
doc.addLayer('Cotas', '#9ccc65');
doc.addLayer('Notas', '#cfd8dc');
doc.addLayer('Revision', '#ff7043');
doc.addLayer('Raster', '#90a4ae');
doc.mlineStyles.push({ name: 'MURO12', desc: 'Muro de 12 cm', elems: [{ off: 0.9, color: 'BYLAYER', ltype: 'BYLAYER' }, { off: -0.9, color: 'BYLAYER', ltype: 'BYLAYER' }],
  caps: { sLine: true, eLine: true }, joints: true, fill: '#3d4854' });
doc.cur.mlineStyle = 'MURO12';
doc.settings.hatchPat = 'NET'; doc.settings.hatchScale = 1.6; doc.settings.hatchAng = 45;
doc.cur.dimStyle = 'Standard';
doc.commit();

// ---- Imagen raster: transparencia y recorte con pinzamientos ----
const photo = await (async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 450;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 450); sky.addColorStop(0, '#e9eff5'); sky.addColorStop(1, '#c6d5e1');
  g.fillStyle = sky; g.fillRect(0, 0, 900, 450);
  g.fillStyle = '#b9c4a6'; g.fillRect(0, 300, 900, 150);
  g.fillStyle = '#9aa78a'; g.fillRect(0, 392, 900, 58);
  // Naves y oficinas
  const block = (x, y, w, h, col) => {
    g.fillStyle = col; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < w - 16; i += 22) for (let j = 0; j < h - 16; j += 20) g.fillRect(x + 8 + i, y + 8 + j, 12, 10);
    g.fillStyle = 'rgba(20,30,40,0.35)'; g.fillRect(x, y + h - 6, w, 6);
  };
  block(60, 168, 250, 132, '#8e9fb0');
  block(340, 138, 190, 162, '#9fb0c0');
  block(560, 196, 220, 104, '#8798a8');
  g.fillStyle = '#2f3a45'; g.fillRect(40, 330, 820, 14);
  g.fillStyle = '#c9784f'; g.fillRect(660, 300, 120, 30);
  g.fillStyle = '#6f9b58';
  for (const [x, y, r] of [[520, 355, 16], [545, 362, 12], [610, 352, 15], [760, 348, 14], [300, 366, 12], [120, 360, 15]]) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#5f6b78'; g.fillRect(0, 344, 900, 6);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let x = 10; x < 900; x += 46) g.fillRect(x, 346, 24, 3);
  g.fillStyle = 'rgba(25,40,60,0.8)'; g.fillRect(18, 18, 286, 34);
  g.fillStyle = '#ffffff'; g.font = 'bold 22px Arial'; g.fillText('SECTOR 4 · ESTADO ACTUAL', 30, 42);
  return c.toDataURL('image/png');
})();
doc.begin();
doc.add({ type: 'image', p: P(10, 78), w: 100, h: 50, rot: 0, src: photo, name: 'Sector-4.png', pxw: 900, pxh: 450,
  transparency: 40, layer: 'Raster',
  clip: { pts: [P(10, 78), P(110, 78), P(110, 110), P(92, 110), P(92, 128), P(10, 128)] } });
doc.commit();
const img = last();
// Rótulo que queda detrás de la imagen (DRAWORDER al fondo) y se lee a través de su transparencia
doc.begin();
text(56, 127, 'REVISIÓN 09', 5, '#0b2233', 120);
doc.commit();
const back = last();
await cmd('DRAWORDER', selIds([back.id]), 'D');

// ---- Cota general cortada por el eje del pórtico (DIMBREAK) ----
layer('Cotas');
await cmd('DIMLINEAR', '10,128', '110,128', '60,137');
const dim = last();
await cmd('LINE', '40,120', '40,144', '');
const axis = last();
doc.begin(); doc.modify(axis.id, e => { e.color = '#f06292'; e.lw = 0.5; }); doc.commit();
await cmd('DIMBREAK', pick(dim, { x: 80, y: dim.p3.y }), 'S', selIds([axis.id]));

// ---- Matriz asociativa de pilares ----
layer('Estructura');
await cmd('RECTANG', '132,100', '140,108'); const sq = last();
await cmd('LINE', '132,100', '140,108', ''); const d1 = last();
await cmd('LINE', '132,108', '140,100', ''); const d2 = last();
await cmd('ARRAYRECT', selIds([sq.id, d1.id, d2.id]), 'COL', '3', '16', 'F', '2', '16', '');
const arr = last();

// ---- Nube de revisión con un arco añadido ----
layer('Revision');
await cmd('REVCLOUD', '4', 'R', '132,58', '192,88');
const cloud = last();
const pc = E.plPieces(cloud)[Math.floor(cloud.pts.length * 0.8)];
const q = E.pieceAt(pc, 0.5);
await cmd('REVCLOUDEDIT', pick(cloud, q), 'A', `${q.x},${q.y}`);
out.cloudAdd = cloud.pts.length;

// ---- Cobertura sobre un sombreado (marco visible) ----
layer('Forjado');
await cmd('RECTANG', '200,96', '244,126'); const fl = last();
await cmd('HATCH', 'S', selIds([fl.id]), '');
layer('Notas');
await cmd('WIPEOUT', '206,102', '238,102', '230,118', '214,120', '');
doc.begin(); doc.settings.wipeoutFrame = 2; doc.commit();

// ---- Muro de líneas múltiples con un vértice añadido (Ctrl+clic) ----
layer('Forjado');
await cmd('MLINE', 'S', 'MURO12', 'J', 'C', 'E', '1', '132,30', '200,30', '200,44', '');
const ml = last();
await app.run('_GRIPVERTEX', { pt: P(166, 30), refs: [{ id: ml.id, i: -1 }] });
out.mlPts = ml.pts.length;

// ---- Rótulos ----
layer('Notas');
doc.begin();
text(10, 162, 'TALLER DE MANTENIMIENTO · REVISIÓN 09', 4.2, '#ffffff', 150);
text(10, 154, 'Imagen transparente y recortada · DIMBREAK en DXF · matrices reconstruidas · REVCLOUDEDIT · WIPEOUTFRAME · DRAWORDER · vértices de MLINE', 2.1, '#9ccc65', 190);
text(10, 71.5, 'IMAGEATTACH + XCLIP: transparencia 40 % y recorte con pinzamientos (los del contorno mueven un vértice; los de esquina, imagen y contorno)', 1.9, '#cfd8dc', 104);
text(14, 75, 'DRAWORDER + transparencia: «REVISIÓN 09» queda detrás del ráster y se lee a través', 1.6, '#ffcc80', 104);
text(10, 143, 'DIMBREAK: el corte se guarda en el DXF (2000/2007)', 1.9, '#cfd8dc', 96);
text(132, 92.5, 'ARRAYRECT: la matriz vuelve asociativa al importar el DXF', 1.9, '#cfd8dc', 62);
text(132, 51.5, 'REVCLOUDEDIT: arco añadido; Admite Quitar y Convertir', 1.9, '#cfd8dc', 62);
text(200, 89.5, 'WIPEOUTFRAME = 2 (marco sólo en pantalla)', 1.9, '#cfd8dc', 50);
text(132, 21, 'MLINE + Ctrl+clic sobre el eje: vértice añadido (AV); sobre un vértice: suprimido (DV)', 1.9, '#cfd8dc', 82);
text(165.5, 33.4, 'AV', 2.2, '#ffd54f', 8);
doc.commit();

// ---- Vista y presentación ----
app.view.cx = 126; app.view.cy = 90; app.view.scale = 3.55;
app.renderer.invalidate(); app.renderer.drawBase();
app.sel.clear(); app.sel.add(img.id); app.selChanged();
app.ui.showPalette('props');
app.renderer.invalidate(); app.renderer.drawBase();
await tick(450);
document.getElementById('cmd-history').innerHTML = '';

out.image = [img.w, img.h, img.transparency, img.clip.pts.length];
out.types = [...new Set(doc.model.map(e => e.type))].join(',');
out.array = [arr.cols, arr.rows, arr.dx, arr.dy];
out.breaks = dim.breaks?.length || 0;
return out;
