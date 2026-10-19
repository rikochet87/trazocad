// Captura de la v0.7: planta de una vivienda con muros de líneas múltiples, columnas en matriz rectangular, árboles en matriz
// a lo largo de un sendero curvo, patio como región con la piscina restada, cotas de longitud de arco y de radio con recodo,
// un bloque de entorno delimitado con XCLIP y una planilla de locales
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {};
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const selIds = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const last = () => doc.model.at(-1);
const layer = n => { doc.cur.layer = n; };
doc.name = 'Vivienda-Los-Aromos';
doc.begin();
doc.addLayer('Muros', '#ffffff'); doc.layer('Muros').lw = 0.5;
doc.addLayer('Tabiques', '#c0c0c0');
doc.addLayer('Estructura', '#ff8a65');
doc.addLayer('Patio', '#4fc3f7');
doc.addLayer('Paisaje', '#81c784');
doc.addLayer('Entorno', '#8d6e63');
doc.addLayer('Cotas', '#ffd54f');
doc.addLayer('Notas', '#e0e0e0');
doc.mlineStyles.push({ name: 'MURO30', desc: 'Muro exterior de 30 cm con cámara', elems: [{ off: 0.5, color: 'BYLAYER', ltype: 'BYLAYER' }, { off: 0.1, color: '#9e9e9e', ltype: 'HIDDEN' }, { off: -0.5, color: 'BYLAYER', ltype: 'BYLAYER' }],
  caps: { sLine: true, eLine: true }, joints: false, fill: '#56677a' });
doc.mlineStyles.push({ name: 'TABIQUE', desc: 'Tabique de 12 cm', elems: [{ off: 0.5, color: 'BYLAYER', ltype: 'BYLAYER' }, { off: -0.5, color: 'BYLAYER', ltype: 'BYLAYER' }], caps: { sLine: true, eLine: true }, joints: false, fill: '#46525f' });
doc.tableStyles.push({ name: 'Planilla', th: 2.2, textStyle: 'Standard', margin: 0.5, titleScale: 1.3, align: 'auto' });
doc.settings.ltscale = 0.4;
doc.commit();
app.view.cx = 60; app.view.cy = 40; app.view.scale = 5; app.renderer.invalidate();

// ---- Muros exteriores (justificación inferior: la cara interior es la línea dibujada) y tabiques ----
layer('Muros');
await cmd('MLINE', 'S', 'MURO30', 'J', 'S', 'E', '3', '0,0', '120,0', '120,70', '0,70', 'C');
layer('Tabiques');
await cmd('MLINE', 'S', 'TABIQUE', 'J', 'C', 'E', '1.2', '0,40', '70,40', '70,0', '');
await cmd('MLINE', 'S', 'TABIQUE', 'J', 'C', 'E', '1.2', '70,40', '70,70', '');
await cmd('MLINE', 'S', 'TABIQUE', 'J', 'C', 'E', '1.2', '35,40', '35,70', '');
// ---- Columnas en matriz rectangular asociativa ----
layer('Estructura');
await cmd('RECTANG', '-1.5,-1.5', '1.5,1.5');
const col = last();
await cmd('ARRAYRECT', selIds([col.id]), 'COL', '4', '40', 'F', '3', '35', '');
const cols = last();
// ---- Galería curva: arco con cota de longitud de arco ----
layer('Muros');
await cmd('ARC', '120,15', '138,35', '120,55');
const gal = last();
layer('Cotas');
await cmd('DIMARC', pick(gal, { x: 140, y: 35 }), '150,35');
// ---- Patio: región con la piscina restada, y sombreado ----
layer('Patio');
await cmd('RECTANG', '0,80', '70,115'); const pr = last();
await cmd('RECTANG', '15,88', '45,104'); const pool = last();
await cmd('CIRCLE', '52,96', '6'); const jac = last();
await cmd('REGION', selIds([pr.id, pool.id, jac.id]));
const [rp, rpool, rjac] = doc.model.filter(e => e.type === 'region');
await cmd('UNION', selIds([rpool.id, rjac.id]));
await cmd('SUBTRACT', selIds([rp.id]), selIds([rpool.id]));
doc.settings.hatchPat = 'DOTS'; doc.settings.hatchScale = 1.2;
app.view.cx = 35; app.view.cy = 98; app.view.scale = 6; app.renderer.invalidate();
await cmd('HATCH', 'S', selIds([rp.id]), '');
app.view.cx = 60; app.view.cy = 40; app.view.scale = 3; app.renderer.invalidate();
// ---- Sendero curvo con árboles en matriz de recorrido ----
layer('Paisaje');
await cmd('SPLINE', '80,120', '110,100', '140,108', '165,80', '180,50', '');
const path = last();
await cmd('CIRCLE', '0,0', '3.5'); const t1 = last();
await cmd('LINE', '-2.5,0', '2.5,0', ''); const t2 = last();
await cmd('LINE', '0,-2.5', '0,2.5', ''); const t3 = last();
app.sel.clear(); for (const t of [t1, t2, t3]) app.sel.add(t.id);
await cmd('BLOCK', 'ARBOL', '0,0');
const arbol = doc.model.filter(e => e.type === 'insert' && e.name === 'ARBOL');
out.trees = await cmd('ARRAYPATH', selIds(arbol.map(e => e.id)), pick(path, { x: 80, y: 120 }), 'E', '14', '', '');
// ---- Entorno: bloque de parcelas vecinas delimitado con XCLIP ----
layer('0');
const nb = [];
for (let i = 0; i < 6; i++) { await cmd('RECTANG', `${-40 + i * 30},-48`, `${-14 + i * 30},-14`); nb.push(last().id); }
await cmd('LINE', '-50,-8', '160,-8', ''); nb.push(last().id);
await cmd('CIRCLE', '50,-31', '7'); nb.push(last().id);
app.sel.clear(); for (const id of nb) app.sel.add(id);
await cmd('BLOCK', 'ENTORNO', '0,0');
const ent = doc.model.filter(e => e.type === 'insert' && e.name === 'ENTORNO').at(-1);
doc.begin(); doc.modify(ent.id, e => { e.layer = 'Entorno'; }); doc.commit();
await cmd('XCLIP', selIds([ent.id]), 'N', 'P', '-20,-5', '110,-5', '140,-25', '110,-50', '-20,-50', '');
// ---- Radio con recodo de la medianera curva (arco de radio grande) ----
layer('Muros');
await cmd('ARC', 'C', '-160,40', '-35,40', '-50.3,100.2');
const med = last();
layer('Cotas');
await cmd('DIMJOGGED', pick(med, { x: -35, y: 40 }), '-80,47', '-45,62', '-62,58');
// ---- Planilla de locales ----
layer('Notas');
doc.begin();
doc.add({ type: 'table', p: { x: 190, y: 115 }, rot: 0, cols: [24, 14], rows: [5, 5, 5, 5, 5, 5], tstyle: 'Planilla', title: true, header: true,
  cells: [['Planilla de locales', ''], ['Local', 'Área m²'], ['Estar-comedor', '34.5'], ['Dormitorio 1', '12.3'], ['Dormitorio 2', '11.8'], ['Patio', `%<Obj:${rp.id}:Área:1>%`]] });
doc.add({ type: 'mleader', mstyle: 'Standard', w: 0, h: 2.8, pts: [{ x: 40, y: 108 }, { x: 62, y: 125 }], content: 'mtext', text: 'Patio: región menos piscina\ny jacuzzi (UNION + SUBTRACT)' });
doc.add({ type: 'mleader', mstyle: 'Standard', w: 0, h: 2.8, pts: [{ x: 124, y: 104 }, { x: 150, y: 128 }], content: 'mtext', text: 'Arboleda: ARRAYPATH\nsobre el sendero' });
doc.commit();
// Vista: la matriz de columnas designada (pinzamientos cian) y la paleta de propiedades
app.zoomExtents(); app.view.zoomAt(1.04, { x: app.view.w / 2, y: app.view.h / 2 });
app.sel.clear(); app.sel.add(cols.id); app.selChanged();
app.ui.showPalette('props');
app.renderer.invalidate(); app.renderer.drawBase();
await tick(250);
out.types = [...new Set(doc.model.map(e => e.type))].join(',');
out.items = doc.model.filter(e => e.type === 'array').map(e => e.kind);
return out;
