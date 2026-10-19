// Bloques dinámicos v0.6: dos parámetros lineales, uno de rotación, visibilidad y tabla de consulta
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, E = await import('./js/entities.js'), DX = await import('./js/dxf.js'), DB = await import('./js/dynblock.js');
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const selIds = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
// Alcantarilla: marco 100×80 (polilínea), flecha de sentido de escurrimiento y cabezal
await cmd('RECTANG', '0,0', '100,80');
await cmd('LINE', '50,40', '80,40', '');
await cmd('LINE', '-10,-5', '110,-5', '');
app.sel.clear(); doc.model.slice(-3).forEach(e => app.sel.add(e.id));
await cmd('BLOCK', 'ALCANTARILLA', '0,0');
const ins = doc.model.find(e => e.type === 'insert');
await app.run('BEDIT', 'ALCANTARILLA');
const [frame, arrow, head] = doc.ents.map(e => e.id);
out.p1 = await cmd('BPARAMETER', 'L', 'Ancho', '0,0', '100,0', '90,-2', '110,90', selIds([frame]));
out.p2 = await cmd('BPARAMETER', 'L', 'Alto', '0,0', '0,80', '-2,70', '110,90', selIds([frame]));
out.p3 = await cmd('BPARAMETER', 'R', 'Giro', '50,40', '80,40', selIds([arrow]));
out.p4 = await cmd('BPARAMETER', 'V', '-20,40');
await cmd('BVSTATE', 'R', 'Con cabezal');
await cmd('BVSTATE', 'N', 'Sin cabezal', 'C');
app.sel.clear(); app.sel.add(head);
await cmd('BVHIDE');
await cmd('BVSTATE', 'S', 'Con cabezal');
out.dynBedit = { lins: doc.bedit.dyn.lins.map(l => [l.name, l.ents.length]), rots: doc.bedit.dyn.rots.map(r => [r.name, r.ents.length]) };
// Tabla de consulta: diámetro nominal → ancho, alto, giro y cabezal
const table = { name: 'Diámetro', cols: ['lin:Ancho', 'lin:Alto', 'rot:Giro', 'vis'], rows: [
  { label: 'Ø600', vals: [80, 60, 0, 'Sin cabezal'] },
  { label: 'Ø800', vals: [100, 80, null, null] },
  { label: 'Ø1000', vals: [120, 100, 90, 'Con cabezal'] }] };
{ const p = app.run('BLOOKUPTABLE', table); await tick(); app.submit('-20,60'); await tick(); await p; }
out.look = doc.bedit.dyn.look && { name: doc.bedit.dyn.look.name, rows: doc.bedit.dyn.look.rows.length };
app.renderer.drawBase();
await cmd('BCLOSE', 'S');
const b = doc.blocks.ALCANTARILLA;
out.saved = { lins: b.dyn.lins.map(l => l.ents), rots: b.dyn.rots.map(r => r.ents), look: b.dyn.look.cols };
const r = () => doc.get(ins.id);
out.kinds = E.TYPES.insert.gripKinds(r());
out.rowDefault = DB.lookupRow(b, r())?.label;
// Pinzamiento de consulta: pasa a la fila siguiente
const gi = E.TYPES.insert.gripKinds(r()).indexOf('look');
doc.begin(); doc.modify(ins.id, e => E.TYPES.insert.moveGrip(e, gi, E.gripsOf(e)[gi])); doc.commit();
out.rowNext = DB.lookupRow(b, r())?.label;
out.stateNext = r().dyn;
out.bbox1000 = E.bboxOf(r());
const arrowNow = E.blockEnts(r()).find(e => e.type === 'line' && Math.abs(e.p1.x - 50) < 1e-6);
out.arrow1000 = arrowNow && [arrowNow.p2.x, arrowNow.p2.y].map(v => +v.toFixed(6));
out.entsVisible = E.blockEnts(r()).length;
// Elegir una fila desde las propiedades
const prop = E.propsOf(r()).find(p => p.label === 'Diámetro');
out.options = prop.options(r()).map(o => o[1]);
doc.begin(); doc.modify(ins.id, e => prop.set(e, '0')); doc.commit();
out.row600 = [DB.lookupRow(b, r())?.label, E.blockEnts(r()).length];
// Pinzamiento de rotación: 45°
const gr = E.TYPES.insert.gripKinds(r()).indexOf('rot');
doc.begin(); doc.modify(ins.id, e => E.TYPES.insert.moveGrip(e, gr, { x: 50 + 30, y: 40 + 30 })); doc.commit();
out.ang = +(r().dyn.ang.Giro * 180 / Math.PI).toFixed(6);
out.rowAfterRot = DB.lookupRow(b, r())?.label ?? '(personalizado)';
out.props = E.propsOf(r()).filter(p => p.label).map(p => `${p.label}=${typeof p.get(r()) === 'number' ? +p.get(r()).toFixed(4) : p.get(r())}`);
// Referencia girada y con simetría de inserción: el pinzamiento de rotación sigue funcionando
doc.begin(); doc.modify(ins.id, e => { e.rot = Math.PI / 2; e.sx = -1; }); doc.commit();
const g2 = E.gripsOf(r())[gr];
doc.begin(); doc.modify(ins.id, e => E.TYPES.insert.moveGrip(e, gr, g2)); doc.commit();
out.rotStable = +(r().dyn.ang.Giro * 180 / Math.PI).toFixed(6);
// Compatibilidad: un bloque de la v0.5 (lin único) sigue funcionando y al editarlo pasa a lins
doc.begin();
doc.defineBlock('V05', { x: 0, y: 0 }, [{ type: 'line', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, layer: '0', color: 'BYBLOCK', ltype: 'BYBLOCK', lw: 'BYBLOCK' }], { dyn: { lin: { name: 'L', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, rect: { x1: 9, y1: -1, x2: 11, y2: 1 }, ents: [0] } } });
const old = doc.add({ type: 'insert', name: 'V05', p: { x: 300, y: 0 }, sx: 1, sy: 1, rot: 0, dyn: { dist: 25 } });
doc.commit();
out.v05 = E.blockEnts(doc.get(old.id))[0].p2.x;
await app.run('BEDIT', 'V05');
await cmd('BCLOSE', 'S');
out.v05After = [Object.keys(doc.blocks.V05.dyn), E.blockEnts(doc.get(old.id))[0].p2.x];
// DXF: las referencias dinámicas se escriben como bloques anónimos con su geometría
const d = DX.writeDXF(doc, '2007');
out.dxfAnon = (d.match(/\*U\d+/g) || []).length > 0;
// Archivo .tcad: se conserva
const back = JSON.parse(JSON.stringify(doc.toJSON()));
out.file = Object.keys(back.blocks.ALCANTARILLA.dyn);
return out;
