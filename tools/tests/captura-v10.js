// Captura de la v0.10: hoja de un tramo de ruta con ortofoto a escala real recortada con dos contornos (corredor y un
// hueco), señal enlazada como referencia externa, perfil tipo con cotas con tolerancia (simétrica, desviación, límites
// y básica), terraplén sombreado con detección de islas «Exterior» alrededor de una alcantarilla, leyenda con un
// degradado de cuatro colores y la paleta de Propiedades editando dos cotas a la vez
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const drive = async (p, ...steps) => {
  for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); }
  await tick();
  if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; }
  await p; return 'ok';
};
const cmd = (name, ...steps) => drive(app.run(name), ...steps);
const selIds = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const last = () => doc.model.at(-1);
const layer = n => { doc.cur.layer = n; };
const text = (x, y, str, h, color, w = 80, lay = 'Notas') => doc.add({ type: 'mtext', p: P(x, y), h, w, text: str, attach: 'tl', color, layer: lay });
const XR = await import('./js/xref.js');
app.T.lwt = true;

doc.name = 'Tramo-RP-v010';
doc.begin();
doc.addLayer('Orto', '#90a4ae');
doc.addLayer('Perfil', '#ffffff');
doc.addLayer('Firme', '#ffb74d');
doc.addLayer('Terreno', '#a1887f');
doc.addLayer('Obras', '#4fc3f7');
doc.addLayer('Cotas', '#9ccc65');
doc.addLayer('Notas', '#cfd8dc');
doc.cur.dimStyle = 'ISO-25';
doc.dimStyles[0] = { ...doc.dimStyles[0], dec: 1, tdec: 1, txt: 2.2, asz: 1.8 };
doc.settings.xclipFrame = 2;
doc.commit();

// ---- Ortofoto: 880 × 440 px a 8 px por unidad (escala de la propiedad «Escala»), recorte con corredor y hueco ----
const photo = await (async () => {
  const c = document.createElement('canvas'); c.width = 880; c.height = 440;
  const g = c.getContext('2d');
  const fields = ['#7d8f4e', '#8fa05a', '#6f8445', '#a3a866', '#879a52', '#94864f'];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { g.fillStyle = fields[(i * 2 + j) % 6]; g.fillRect(i * 150 - 20, j * 150, 150, 150); }
  g.strokeStyle = 'rgba(60,50,30,0.35)'; g.lineWidth = 3;
  for (let x = 0; x < 900; x += 150) { g.beginPath(); g.moveTo(x - 20, 0); g.lineTo(x + 40, 440); g.stroke(); }
  g.strokeStyle = '#5b5f63'; g.lineWidth = 62; g.beginPath(); g.moveTo(-10, 302); g.lineTo(890, 138); g.stroke();
  g.strokeStyle = '#c9c39a'; g.lineWidth = 8; g.setLineDash([]);
  for (const o of [-34, 34]) { g.beginPath(); g.moveTo(-10, 302 + o); g.lineTo(890, 138 + o); g.stroke(); }
  g.strokeStyle = '#f5f5f5'; g.lineWidth = 3; g.setLineDash([26, 22]); g.beginPath(); g.moveTo(-10, 302); g.lineTo(890, 138); g.stroke();
  g.setLineDash([]); g.fillStyle = '#3d6b35';
  for (const [x, y, r] of [[120, 120, 18], [160, 140, 14], [610, 330, 20], [650, 300, 15], [420, 80, 16], [760, 380, 18], [300, 400, 14]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#b0623c'; g.fillRect(470, 250, 70, 40); g.fillStyle = '#d7ccc8'; g.fillRect(480, 258, 50, 24);
  return c.toDataURL('image/png');
})();
layer('Orto');
doc.begin();
const img = doc.add({ type: 'image', p: P(10, 95), w: 110, h: 55, rot: 0, src: photo, name: 'orto-tramo.png', pxw: 880, pxh: 440, layer: 'Orto' });
doc.commit();
await cmd('XCLIP', selIds([img.id]), 'Nuevo contorno', 'Poligonal', '10,100.5', '120,120.5', '120,144.5', '10,124.5', '');
await cmd('XCLIP', selIds([img.id]), 'Añadir contorno', 'Rectangular', '58,117', '72,127');

// ---- Señal enlazada como referencia externa (contenido de otro dibujo) ----
const sign = JSON.stringify({ app: 'TrazoCAD', version: 10,
  layers: [{ name: '0', color: '#ffffff', ltype: 'CONTINUOUS', lw: 'DEFAULT', on: true, lock: false }, { name: 'Senal', color: '#ffeb3b', ltype: 'CONTINUOUS', lw: 0.35, on: true, lock: false }],
  model: [
    { type: 'line', p1: P(0, 0), p2: P(0, 6), layer: 'Senal', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' },
    { type: 'pline', closed: true, pts: [P(-3, 6), P(3, 6), P(0, 11)], layer: 'Senal', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' },
    { type: 'text', p: P(0, 7.1), h: 2.2, align: 'c', text: '!', layer: 'Senal', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' },
  ], blocks: {}, textStyles: [], dimStyles: [] });
doc.begin();
XR.defineXref(doc, 'senal-P2', XR.parseSource(sign, 'senal-P2.tcad'), 'senal-P2.tcad');
for (const [x, y] of [[30, 127], [92, 139]]) doc.add({ type: 'insert', name: 'senal-P2', p: P(x, y), sx: 1, sy: 1, rot: 0, layer: 'Obras', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' });
doc.commit();
await XR.rememberXref('senal-P2.tcad', new File([sign], 'senal-P2.tcad'));

// ---- Perfil tipo: terraplén con alcantarilla (islas «Exterior») y paquete estructural ----
layer('Terreno');
await cmd('PLINE', '10,22', '30,47', '100,47', '120,22', 'C');
const terr = last();
layer('Obras');
await cmd('CIRCLE', '65,31', '5'); const pipeO = last();
await cmd('CIRCLE', '65,31', '4'); const pipeI = last();
doc.settings.hatchPat = 'EARTH'; doc.settings.hatchScale = 0.6; doc.settings.hatchAng = 0; doc.settings.hatchIslands = 'outer';
layer('Terreno');
app.view.cx = 65; app.view.cy = 40; app.view.scale = 6; app.renderer.invalidate();
await cmd('HATCH', '20,26', '');
const thatch = doc.model.find(e => e.type === 'hatch');
layer('Firme');
await cmd('PLINE', '31,47', '99,47', '97,50', '33,50', 'C'); const sub = last();
await cmd('PLINE', '33,50', '97,50', '95.5,52.5', '34.5,52.5', 'C'); const bas = last();
await cmd('PLINE', '34.5,52.5', '95.5,52.5', '95,54', '35,54', 'C'); const car = last();
doc.settings.hatchIslands = 'normal';
doc.settings.hatchPat = 'DOTS'; doc.settings.hatchScale = 0.5;
await cmd('HATCH', 'S', selIds([sub.id]), '');
doc.settings.hatchPat = 'ANSI31'; doc.settings.hatchScale = 0.4;
await cmd('HATCH', 'S', selIds([bas.id]), '');
doc.settings.hatchPat = 'SOLID';
await cmd('HATCH', 'S', selIds([car.id]), '');

// ---- Cotas con tolerancias (en decímetros) ----
layer('Cotas');
await cmd('DIMLINEAR', '35,54', '95,54', '65,62'); const dCal = last();
await cmd('DIMLINEAR', '97,50', '95.5,52.5', '112,51'); const dBase = last();
await cmd('DIMLINEAR', '120,22', '100,47', '130,34'); const dAlt = last();
const pp = P(65 + 5 * Math.cos(-Math.PI / 4), 31 + 5 * Math.sin(-Math.PI / 4));
await cmd('DIMDIAMETER', pick(pipeO, pp), '84,12'); const dPipe = last();
doc.begin();
doc.modify(dCal.id, e => { e.ov = { tol: 'sym', tp: 0.2 }; });
doc.modify(dAlt.id, e => { e.ov = { tol: 'dev', tp: 0.5, tm: 0.2, tfac: 0.7 }; });
doc.modify(dBase.id, e => { e.ov = { tol: 'basic' }; });
doc.modify(dPipe.id, e => { e.ov = { tol: 'lim', tp: 0.2, tm: 0.1 }; });
doc.commit();

// ---- Leyenda del modelo de terreno: degradado de cuatro colores ----
layer('Notas');
await cmd('RECTANG', '140,104', '206,112'); const lg = last();
doc.settings.gradient = { type: 'LINEAR', c1: '#2e7d32', c2: '#f5f5f5', centered: true, stops: [[0, '#2e7d32'], [0.35, '#c0ca33'], [0.7, '#8d6e63'], [1, '#f5f5f5']] };
doc.settings.hatchAng = 0;
await cmd('GRADIENT', 'S', selIds([lg.id]), '');
doc.begin();
for (const [i, z] of ['62', '64', '66', '68'].entries()) text(139 + i * 21.3, 102.5, z + ' m', 1.8, '#cfd8dc', 10);
doc.commit();

// ---- Rótulos ----
doc.begin();
text(10, 165, 'RUTA PROVINCIAL · TRAMO 3A · PROYECTO v0.10', 4.2, '#ffffff', 190);
text(10, 157, 'Ortofoto a escala real (ppp) con recorte de dos contornos · XREF recordada · tolerancias y DIMOVERRIDE · islas · degradado de 4 colores · CTB/STB · Propiedades múltiples', 2.0, '#9ccc65', 200);
text(10, 93, 'IMAGEATTACH a 8 px/unidad + XCLIP «Añadir contorno»: corredor visible y hueco interior (par-impar)', 1.8, '#cfd8dc', 110);
text(130, 147, 'XREF senal-P2.tcad (las dos señales): recordada entre sesiones; en DXF 2000/2007 se escribe como bloque XREF', 1.8, '#ffeb3b', 72);
text(10, 17, 'Terraplén: HATCH con islas «Exterior»: la alcantarilla queda sin sombrear (el anillo interior se ignora)', 1.8, '#cfd8dc', 116);
text(140, 82, 'Tolerancias del estilo o de cada cota (DIMOVERRIDE): simétrica en la calzada, desviación en la altura, límites en el caño y básica en el espesor de la base (cotas en dm)', 1.8, '#cfd8dc', 66);
text(140, 99.5, 'GRADIENT con «Colores»: cuatro paradas (Propiedades › Paradas de color)', 1.7, '#cfd8dc', 70);
text(140, 117, 'MDT · altitud del terreno', 2.2, '#ffffff', 60);
text(140, 66, 'Imprimir con monochrome.ctb, grayscale.ctb o tablas propias (STYLESMANAGER); .stb con estilos por capa (ESTILOTRAZADO); LTSCALE por ventana y PSLTSCALE', 1.8, '#ffcc80', 70);
text(140, 50, 'Propiedades: dos cotas designadas a la vez; los valores distintos se ven como *Varios*', 1.8, '#4fc3f7', 66);
doc.commit();

// ---- Vista y paleta: dos cotas designadas (calzada y base) ----
app.view.cx = 112; app.view.cy = 87; app.view.scale = 3.6;
app.renderer.invalidate(); app.renderer.drawBase();
app.sel.clear(); app.sel.add(dCal.id); app.sel.add(dBase.id); app.selChanged();
app.ui.showPalette('props');
app.renderer.invalidate(); app.renderer.drawBase();
await tick(450);
document.getElementById('cmd-history').innerHTML = '';

out.image = { extra: img.clip.loops?.length, w: img.w };
out.hatchLoops = thatch?.loops.length;
out.dims = [dCal, dBase, dAlt, dPipe].map(d => d.ov?.tol);
out.types = [...new Set(doc.model.map(e => e.type))].join(',');
return out;
