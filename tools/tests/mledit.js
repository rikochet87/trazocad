// MLEDIT: cruces, uniones en T y en esquina, vértices, cortes y soldaduras; simetría, descomposición y DXF de ida y vuelta
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {};
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const last = () => doc.model.at(-1);
const r4 = v => +v.toFixed(4);
const E = await import('./js/entities.js'), ML = await import('./js/mline.js'), OPS = await import('./js/ops.js'), DXF = await import('./js/dxf.js');
const runs = e => E.mlGeom(doc.get(e.id)).elems.map(el => el.runs.length);
const cuts = e => (doc.get(e.id).cuts || []).map(c => [c.s, c.k, r4(c.a), r4(c.b)]);
const ml = async (...pts) => { await cmd('MLINE', 'J', 'C', 'E', '4', ...pts, ''); return last(); };

// ---- Cruz cerrada: A se corta entre los elementos exteriores de B ----
const A = await ml('-20,0', '20,0'), B = await ml('0,-20', '0,20');
out.cc = await cmd('-MLEDIT', 'CC', pick(A, { x: -10, y: 0 }), pick(B, { x: 0, y: -10 }), '');
out.ccCuts = [cuts(A), cuts(B), runs(A), runs(B)];
// Soldar todo: A vuelve a estar entero
out.wa = await cmd('-MLEDIT', 'WA', pick(A, { x: -5, y: 0 }), '5,0', '');
out.waCuts = [cuts(A), runs(A)];
// Cruz abierta: además se abren los exteriores de B
await cmd('-MLEDIT', 'OC', pick(A, { x: -10, y: 0 }), pick(B, { x: 0, y: -10 }), '');
out.oc = [cuts(A), cuts(B), runs(B)];

// ---- T cerrada y T abierta: el pie se alarga hasta la barra ----
const S = await ml('50,-20', '50,-5'), T = await ml('30,10', '70,10');
out.ct = await cmd('-MLEDIT', 'CT', pick(S, { x: 50, y: -15 }), pick(T, { x: 60, y: 10 }), '');
out.ctPts = doc.get(S.id).pts.map(p => [r4(p.x), r4(p.y)]);
out.ctCuts = [cuts(S), cuts(T)];
await cmd('UNDO');
await cmd('-MLEDIT', 'OT', pick(S, { x: 50, y: -15 }), pick(T, { x: 60, y: 10 }), '');
out.ot = [doc.get(S.id).pts.map(p => [r4(p.x), r4(p.y)]), cuts(S), cuts(T), runs(T)];

// ---- Unión en esquina ----
const P1 = await ml('100,0', '125,0'), P2 = await ml('120,-20', '120,10');
out.cj = await cmd('-MLEDIT', 'CJ', pick(P1, { x: 105, y: 0 }), pick(P2, { x: 120, y: -15 }), '');
out.cjPts = [doc.get(P1.id).pts.map(p => [r4(p.x), r4(p.y)]), doc.get(P2.id).pts.map(p => [r4(p.x), r4(p.y)])];
out.cjCuts = [cuts(P1), cuts(P2)];
// Las esquinas de los elementos exteriores coinciden (inglete limpio)
const g1 = E.mlGeom(doc.get(P1.id)), g2 = E.mlGeom(doc.get(P2.id));
out.cjEnds = [g1.elems.map(el => el.runs.at(-1).pts.at(-1)).map(p => [r4(p.x), r4(p.y)]), g2.elems.map(el => el.runs.at(-1).pts.at(-1)).map(p => [r4(p.x), r4(p.y)])];

// ---- Añadir y suprimir vértices, cortar uno y cortar todo ----
const V = await ml('0,50', '40,50');
await cmd('-MLEDIT', 'CS', pick(V, { x: 10, y: 52 }), '20,52', '');
out.cs = cuts(V);
await cmd('-MLEDIT', 'AV', pick(V, { x: 15, y: 50 }), '');
out.av = [doc.get(V.id).pts.length, cuts(V)];
await cmd('-MLEDIT', 'CA', pick(V, { x: 30, y: 50 }), '35,50', '');
out.ca = cuts(V);
await cmd('-MLEDIT', 'DV', pick(V, { x: 15, y: 50 }), '');
out.dv = [doc.get(V.id).pts.length, cuts(V)];

// ---- Simetría: los cortes siguen al elemento ----
const before = E.mlGeom(doc.get(A.id)).elems.map(el => el.runs.map(r => r.pts.map(p => [r4(p.x), r4(p.y)])));
await cmd('MIRROR', async () => { await tick(); app.req.set.add(A.id); app.submit(''); }, '0,-1', '0,1', 'N');
const mirrored = E.mlGeom(doc.get(A.id)).elems.map(el => el.runs.map(r => r.pts.map(p => [r4(-p.x), r4(p.y)])));
// La geometría reflejada coincide con la original (salvo el orden de recorrido)
const norm = list => JSON.stringify(list.flat().map(r => r.map(([x, y]) => `${x},${y}`).sort()).sort());
out.mirrorSame = norm(before) === norm(mirrored);
await cmd('UNDO');

// ---- Descomponer: líneas sólo donde no hay huecos ----
out.explode = OPS.explodeEntity(doc.get(T.id)).length;

// ---- DXF 2000 de ida y vuelta: los huecos se conservan ----
const d = DXF.writeDXF(doc, '2000'), r = DXF.readDXF(d);
const imp = r.ents.filter(e => e.type === 'mline');
out.dxf = imp.map(e => (e.cuts || []).length);
out.dxfSame = imp.map(e => JSON.stringify((e.cuts || []).map(c => [c.s, c.k, r4(c.a), r4(c.b)])));
out.orig = doc.model.filter(e => e.type === 'mline').map(e => JSON.stringify((e.cuts || []).map(c => [c.s, c.k, r4(Math.max(c.a, -1e6)), r4(c.b)])));
out.dialog = typeof app.ui.mleditDialog;
return out;
