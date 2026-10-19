const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, G = await import('./js/geom.js'), C = await import('./js/constraints.js');
const click = async pt => { await tick(); const s = app.view.toScreen(pt); app.mouse.sx = s.x; app.mouse.sy = s.y; app.mouse.inside = true; app.updateMouse(); app.leftClick({ shiftKey: false }); };
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const r4 = v => +v.toFixed(4);
// Cuadrilátero casi rectangular con líneas sueltas
await cmd('LINE', '0,0', '98,3', '');  const A = doc.model.at(-1);
await cmd('LINE', '98,3', '101,52', ''); const B = doc.model.at(-1);
await cmd('LINE', '101,52', '-2,49', ''); const Cc = doc.model.at(-1);
await cmd('LINE', '-2,49', '0,0', ''); const D = doc.model.at(-1);
app.view.cx = 50; app.view.cy = 25; app.view.scale = 5; app.renderer.invalidate();
// Coincidencias en las esquinas (punto final con referencia a objetos)
out.co1 = await cmd('GCCOINCIDENT', pick(A, { x: 97, y: 3 }), pick(B, { x: 98, y: 4 }));
await cmd('GCCOINCIDENT', pick(B, { x: 101, y: 51 }), pick(Cc, { x: 100, y: 52 }));
await cmd('GCCOINCIDENT', pick(Cc, { x: -1, y: 49 }), pick(D, { x: -2, y: 48 }));
await cmd('GCCOINCIDENT', pick(D, { x: 0, y: 1 }), pick(A, { x: 1, y: 0 }));
// Horizontal A, vertical B, paralela C-A, perpendicular D-A, fija el origen
out.h = await cmd('GCHORIZONTAL', '', pick(A, { x: 50, y: 1.5 }));
out.v = await cmd('GCVERTICAL', '', pick(B, { x: 99.5, y: 27 }));
out.par = await cmd('GCPARALLEL', pick(A, { x: 50, y: 1.5 }), pick(Cc, { x: 50, y: 50 }));
out.perp = await cmd('GCPERPENDICULAR', pick(A, { x: 50, y: 1.5 }), pick(D, { x: -1, y: 25 }));
out.fix = await cmd('GCFIX', pick(A, { x: 0.5, y: 0 }));
const g = e => [e.p1, e.p2].map(p => [r4(p.x), r4(p.y)]);
out.geomAfter = { A: g(doc.get(A.id)), B: g(doc.get(B.id)), C: g(doc.get(Cc.id)), D: g(doc.get(D.id)) };
// Cota de restricción horizontal sobre A: d1 = 120
out.dc = await cmd('DCHORIZONTAL', '', pick(A, { x: 50, y: 0 }), '50,-15', '120');
out.d1 = { A: g(doc.get(A.id)), cons: doc.constraints.at(-1) };
// Parámetro de usuario y expresión
doc.begin(); doc.params.push({ name: 'ancho', expr: '80' }); doc.constraints.find(k => k.name === 'd1').expr = 'ancho*1.5'; doc.consDirty = true; doc.changed(); doc.commit();
out.expr = { A: g(doc.get(A.id)), vals: [...C.evalParams(doc).vals] };
// Radio
await cmd('CIRCLE', '200,0', '10'); const K = doc.model.at(-1);
out.rad = await cmd('DCRADIUS', pick(K, { x: 210, y: 0 }), '220,10', '15');
out.radius = doc.get(K.id).r;
// Pinzamiento: mover el extremo libre de B arrastra la geometría manteniendo las restricciones
doc.begin(); doc.modify(B.id, e => { e.p2 = { x: 120, y: 70 }; }); doc.commit();
out.afterGrip = { A: g(doc.get(A.id)), B: g(doc.get(B.id)), C: g(doc.get(Cc.id)), D: g(doc.get(D.id)) };
// Conflicto: vertical sobre A (horizontal ya) → se rechaza
const n0 = doc.constraints.length;
await cmd('GCVERTICAL', '', pick(A, { x: 50, y: 0 }));
out.conflict = doc.constraints.length === n0;
// Tangente línea-círculo
await cmd('LINE', '180,30', '230,25', ''); const T = doc.model.at(-1);
out.tan = await cmd('GCTANGENT', pick(K, { x: 200, y: 15 }), () => app.req ? app.req.resolve({ e: doc.get(K.id), pt: { x: 200, y: 15 } }) : null);
// (círculo con círculo no aplica aquí; línea tangente:)
const n1 = doc.constraints.length;
await cmd('GCTANGENT', pick(T, { x: 205, y: 27 }), pick(K, { x: 200, y: 15 }));
const t = doc.get(T.id), k = doc.get(K.id);
out.tangent = { added: doc.constraints.length > n1, dist: r4(Math.abs(G.cross(G.sub(t.p2, t.p1), G.sub(k.c, t.p1)) / G.dist(t.p1, t.p2))), r: r4(k.r) };
// Dibujo y JSON
app.zoomExtents(); app.renderer.drawBase();
out.labels = (app.renderer.consLabels || []).length;
const j = JSON.parse(JSON.stringify(doc.toJSON()));
out.json = { cons: j.constraints.length, params: j.params.length };
// borrar una línea elimina sus restricciones
const before = doc.constraints.length;
app.sel.clear(); app.sel.add(Cc.id); await cmd('ERASE');
out.erase = before - doc.constraints.length;
doc.undo(); app.afterUndo();
out.undo = doc.constraints.length === before;
return out;
