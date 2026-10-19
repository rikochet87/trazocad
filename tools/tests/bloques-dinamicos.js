const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, E = await import('./js/entities.js'), DX = await import('./js/dxf.js');
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
// Bloque "PUERTA": marco + hoja (línea) + arco de giro
await cmd('RECTANG', '0,0', '100,5');
await cmd('LINE', '0,5', '0,95', '');
await cmd('ARC', 'C', '0,5', '90,5', '0,95');
app.selectAll();
await cmd('BLOCK', 'PUERTA', '0,0');
const ins = doc.model.find(e => e.type === 'insert');
await app.run('BEDIT', 'PUERTA');
const ids = doc.ents.map(e => e.id);
// Lineal: estira el marco hacia la derecha
await cmd('BPARAMETER', 'L', 'Anchura', '0,0', '100,0', '90,-5', '110,10', () => { app.req.set.add(ids[0]); }, '');
// Simetría por el eje vertical x=50
await cmd('BPARAMETER', 'S', '50,-10', '50,10');
// Visibilidad: estado "Abierta" (todo) y "Cerrada" (sin arco)
await cmd('BPARAMETER', 'V', '50,50');
await cmd('BVSTATE', 'R', 'Abierta');
await cmd('BVSTATE', 'N', 'Cerrada', 'C');
app.sel.clear(); app.sel.add(ids[2]);
await cmd('BVHIDE');
out.beditDyn = JSON.parse(JSON.stringify(doc.bedit.dyn));
app.renderer.drawBase();
await cmd('BCLOSE', 'S');
const b = doc.blocks.PUERTA;
out.blockDyn = { lin: (b.dyn.lins || [b.dyn.lin])[0].ents, flip: !!b.dyn.flip, states: b.dyn.vis.states, hide: b.dyn.vis.hide };
const r = doc.get(ins.id);
out.grips = E.gripsOf(r).length;
out.kinds = E.TYPES.insert.gripKinds(r);
// estiramiento con pinzamiento
doc.begin(); doc.modify(r.id, e => E.TYPES.insert.moveGrip(e, 1, { x: 150, y: 3 })); doc.commit();
out.dist = doc.get(r.id).dyn.len.Anchura;
out.bboxStretched = E.bboxOf(doc.get(r.id));
// visibilidad cerrada
doc.begin(); doc.modify(r.id, e => { e.dyn = { ...e.dyn, vis: 'Cerrada' }; }); doc.commit();
out.entsClosed = E.blockEnts(doc.get(r.id)).map(e => e.type);
// simetría
doc.begin(); doc.modify(r.id, e => { e.dyn = { ...e.dyn, flip: true, vis: 'Abierta' }; }); doc.commit();
out.flipped = E.blockEnts(doc.get(r.id)).find(e => e.type === 'line').p1;
out.props = E.propsOf(doc.get(r.id)).filter(p => p.label).map(p => p.label);
// DXF
const d = DX.writeDXF(doc, '2000');
out.dxf = { anon: (d.match(/\*U\d+/g) || []).length };
const rr = DX.readDXF(d);
out.reimport = rr.ents.map(e => e.type);
return { ...out, d2000: d, d12: DX.writeDXF(doc, 'R12') };
