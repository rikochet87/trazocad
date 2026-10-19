// Captura de la v0.6: eje de camino graduado con mojones (GRADUA), alcantarillas dinámicas con tabla de consulta,
// directrices, patrón personalizado, figura con restricciones automáticas y un grupo designado
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {};
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const selIds = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const last = () => doc.model.at(-1);
const layer = n => { doc.cur.layer = n; };
doc.name = 'Ruta-provincial-13';
doc.begin();
doc.addLayer('Eje', '#ff5252'); doc.layer('Eje').ltype = 'CENTER';
doc.addLayer('Calzada', '#ffffff'); doc.layer('Calzada').lw = 0.5;
doc.addLayer('Banquina', '#a1887f');
doc.addLayer('Obras de arte', '#4fc3f7');
doc.addLayer('Mojones', '#ffd54f');
doc.addLayer('Notas', '#e0e0e0');
doc.settings.ltscale = 0.6;
doc.commit();
// Patrón personalizado de ripio
await app.run('PATTERNS', { text: '*RIPIO, Ripio compactado\n0, 0,0, 2.2,2.6, 0.5,-3.9\n60, 1.1,0.4, 3.1,3.3, 0,-6.1\n120, 0.5,1.7, 2.6,2.9, 0,-5.7\n', src: 'ripio.pat' });
// Eje con una curva
layer('Eje');
await cmd('PLINE', '0,0', '140,0', 'A', '220,60', 'L', '300,140', '');
const axis = last();
layer('Calzada');
await cmd('OFFSET', '7.3', pick(axis, { x: 50, y: 0 }), '50,5', '', '');
await cmd('OFFSET', '7.3', pick(axis, { x: 50, y: 0 }), '50,-5', '', '');
// Banquina de ripio (polilínea cerrada) y sombreado con el patrón personalizado
layer('Banquina');
await cmd('PLINE', '0,-7.3', '140,-7.3', '140,-14.3', '0,-14.3', 'C');
app.view.cx = 70; app.view.cy = -10; app.view.scale = 6; app.renderer.invalidate();
doc.settings.hatchPat = 'RIPIO'; doc.settings.hatchScale = 1.6;
await cmd('HATCH', '70,-10.8', '');
// Mojones cada 25 m con un bloque alineado al eje (GRADUA)
layer('0');
await cmd('LINE', '0,-9', '0,9', ''); const m1 = last();
await cmd('CIRCLE', '0,11', '2'); const m2 = last();
app.sel.clear(); app.sel.add(m1.id); app.sel.add(m2.id);
await cmd('BLOCK', 'MOJON', '0,0');
await cmd('ERASE', selIds(doc.model.filter(e => e.type === 'insert' && e.name === 'MOJON').map(e => e.id)));
layer('Mojones');
out.measure = await cmd('MEASURE', pick(axis, { x: 1, y: 0 }), 'B', 'MOJON', 'S', '25');
// Alcantarilla dinámica con tabla de consulta (Ø600 / Ø800 / Ø1000)
layer('0');
await cmd('RECTANG', '0,0', '16,12');
await cmd('LINE', '8,6', '14,6', '');
await cmd('LINE', '-3,-2', '19,-2', '');
app.sel.clear(); doc.model.slice(-3).forEach(e => app.sel.add(e.id));
await cmd('BLOCK', 'ALCANTARILLA', '8,6');
const firstIns = doc.model.find(e => e.type === 'insert' && e.name === 'ALCANTARILLA');
await cmd('ERASE', selIds([firstIns.id]));
await app.run('BEDIT', 'ALCANTARILLA');
const [frame, arrow, head] = doc.ents.map(e => e.id);
await cmd('BPARAMETER', 'L', 'Ancho', '0,0', '16,0', '14,-1', '18,14', selIds([frame]));
await cmd('BPARAMETER', 'L', 'Alto', '0,0', '0,12', '-1,10', '18,14', selIds([frame]));
await cmd('BPARAMETER', 'R', 'Escurrimiento', '8,6', '14,6', selIds([arrow]));
await cmd('BPARAMETER', 'V', '-6,6');
await cmd('BVSTATE', 'R', 'Con cabezal');
await cmd('BVSTATE', 'N', 'Sin cabezal', 'C');
app.sel.clear(); app.sel.add(head);
await cmd('BVHIDE');
await cmd('BVSTATE', 'S', 'Con cabezal');
{ const p = app.run('BLOOKUPTABLE', { name: 'Diámetro', cols: ['lin:Ancho', 'lin:Alto', 'rot:Escurrimiento', 'vis'], rows: [
  { label: 'Ø600', vals: [12, 9, 0, 'Sin cabezal'] }, { label: 'Ø800', vals: [16, 12, null, 'Con cabezal'] }, { label: 'Ø1000', vals: [20, 15, 90, 'Con cabezal'] }] });
  await tick(); app.submit('-6,10'); await tick(); await p; }
await cmd('BCLOSE', 'S');
layer('Obras de arte');
const DB = await import('./js/dynblock.js');
const put = (x, y, rot, row) => { doc.begin(); const e = doc.add({ type: 'insert', name: 'ALCANTARILLA', p: { x, y }, sx: 1, sy: 1, rot }); DB.applyLookupRow(doc.blocks.ALCANTARILLA, e, doc.blocks.ALCANTARILLA.dyn.look.rows[row]); doc.commit(); return e; };
const a1 = put(60, 0, Math.PI / 2, 2), a2 = put(260, 100, Math.PI / 4 + Math.PI / 2, 0);
// Directrices
layer('Notas');
doc.begin();
doc.add({ type: 'mleader', mstyle: 'Standard', w: 0, h: 3.5, pts: [{ x: 66, y: 12 }, { x: 85, y: 34 }], content: 'mtext', text: 'Alcantarilla Ø1000\ncon cabezales' });
doc.add({ type: 'mleader', mstyle: 'Standard', w: 0, h: 3.5, pts: [{ x: 252, y: 106 }, { x: 228, y: 126 }], content: 'mtext', text: 'Alcantarilla Ø600' });
doc.add({ type: 'mleader', mstyle: 'Standard', w: 0, h: 3.5, pts: [{ x: 110, y: -10 }, { x: 128, y: -30 }], content: 'mtext', text: 'Banquina de ripio (patrón RIPIO)' });
doc.add({ type: 'mleader', mstyle: 'Standard', w: 0, h: 3, pts: [{ x: 200, y: 39.8 }, { x: 214, y: 22 }], content: 'block', text: '7' });
doc.commit();
// Estado de capa guardado
await cmd('-LAYERSTATE', 'G', 'Planimetría', '');
// Grupo: la alcantarilla Ø1000 con su nota
const note = doc.model.find(e => e.type === 'mleader');
out.group = await cmd('GROUP', 'N', 'Alcantarilla km 0,06', selIds([note.id, a1.id]));
// Badén con restricciones automáticas
layer('Calzada');
await cmd('LINE', '245,-12', '295,-12', '295,4', '245,4', 'C');
const bad = doc.model.slice(-4);
await cmd('CIRCLE', '270,-4', '4'); const kc = last();
app.view.cx = 270; app.view.cy = -4; app.view.scale = 8; app.renderer.invalidate();
out.auto = await cmd('AUTOCONSTRAIN', selIds([...bad.map(e => e.id), kc.id]));
// Vista y selección: el grupo (recuadro) y una alcantarilla (pinzamientos cian, triangular = tabla de consulta)
app.zoomExtents(); app.view.zoomAt(1.06, { x: app.view.w / 2, y: app.view.h / 2 });
app.sel.clear(); app.sel.add(note.id); app.sel.add(a1.id);
app.ui.showPalette('layers');
app.renderer.invalidate(); app.renderer.drawBase();
await tick(200);
out.cons = doc.constraints.length;
out.types = [...new Set(doc.model.map(e => e.type))].join(',');
return out;
