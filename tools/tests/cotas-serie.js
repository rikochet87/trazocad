const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, E = await import('./js/entities.js');
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const dims = () => doc.model.filter(e => e.type === 'dim');
await cmd('PLINE', '0,0', '30,0', '50,10', '90,10', '');
await cmd('DIMLINEAR', '0,0', '30,0', '15,-10');
out.cont = await cmd('DIMCONTINUE', '50,10', '90,10', '');
out.contVals = dims().map(d => [E.dimParts(d).text.str, +E.dimParts(d).d1.y.toFixed(3)]);
await cmd('DIMBASELINE', 'S', () => app.req.resolve({ e: dims()[0], pt: { x: 1, y: -10 } }), '50,10', '90,10', '');
out.baseVals = dims().slice(3).map(d => [E.dimParts(d).text.str, +E.dimParts(d).d1.y.toFixed(3)]);
// angular continua
await cmd('LINE', '200,0', '250,0', '');
await cmd('DIMANGULAR', '', '200,0', '250,0', '235,35.355', '240,10');
await cmd('DIMCONTINUE', '200,50', '');
out.angCont = dims().slice(-2).map(d => E.dimParts(d).text.str);
// QDIM
await cmd('CIRCLE', '0,50', '5'); await cmd('CIRCLE', '20,50', '5'); await cmd('CIRCLE', '45,50', '5');
const circles = doc.model.filter(e => e.type === 'circle');
const n0 = dims().length;
app.sel.clear(); circles.forEach(c => app.sel.add(c.id));
out.qdim = await cmd('QDIM', '20,70');
out.qVals = dims().slice(n0).map(d => [E.dimParts(d).text.str, !!d.assoc]);
const n1 = dims().length;
app.sel.clear(); circles.forEach(c => app.sel.add(c.id));
await cmd('QDIM', 'L', '20,70');
out.qBase = dims().slice(n1).map(d => [E.dimParts(d).text.str, +d.p3.y.toFixed(2)]);
doc.begin(); doc.modify(circles[2].id, e => { e.c = { x: 60, y: 50 }; }); doc.commit();
out.qAssoc = dims().slice(n0).map(d => E.dimParts(d).text.str);
return out;
