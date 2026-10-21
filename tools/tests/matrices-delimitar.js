// Matrices asociativas (ARRAYRECT, ARRAYPOLAR, ARRAYPATH, ARRAYEDIT, pinzamientos, recorrido asociado) y XCLIP
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {};
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const last = () => doc.model.at(-1);
const grip = async (g, p) => { const pr = app.run('_GRIP', g); await tick(); app.submit(p); await tick(); await pr; };
const r4 = v => +v.toFixed(4);
const E = await import('./js/entities.js'), A = await import('./js/arrays.js');
app.view.cx = 50; app.view.cy = 25; app.view.scale = 3; app.renderer.invalidate();

// ---- ARRAYRECT asociativa: 4 × 3 por defecto, luego COLumnas y Filas ----
await cmd('CIRCLE', '0,0', '2'); const C = last();
out.rect = await cmd('ARRAYRECT', sel([C.id]), 'COL', '5', '10', 'F', '2', '8', '');
const AR = last();
out.rectEnt = { type: AR.type, kind: AR.kind, cols: AR.cols, rows: AR.rows, dx: AR.dx, dy: AR.dy, items: A.itemCount(AR), src: AR.src.length, gone: !doc.get(C.id) };
out.rectLast = (e => [r4(e.c.x), r4(e.c.y)])(A.arrayEnts(AR).at(-1));
// Pinzamiento de separación entre columnas (cian) y de recuento
const gr = A.arrayGrips(AR);
out.grips = gr.map(g => g.kind || 'base');
await grip({ pt: gr[1].p, refs: [{ id: AR.id, i: 1 }] }, '12,0');
out.afterGrip = doc.get(AR.id).dx;
await grip({ pt: A.arrayGrips(doc.get(AR.id))[3].p, refs: [{ id: AR.id, i: 3 }] }, '72,16');
out.afterCount = [doc.get(AR.id).cols, doc.get(AR.id).rows];
// Mover y girar la matriz entera: la matriz local se acumula
await cmd('MOVE', sel([AR.id]), '0,0', '0,100');
await cmd('ROTATE', sel([AR.id]), '0,100', '90');
out.moved = (e => [r4(e.c.x), r4(e.c.y)])(A.arrayEnts(doc.get(AR.id))[1]);
// ARRAYEDIT y propiedades
out.edit = await cmd('ARRAYEDIT', pick(AR, { x: 0, y: 100 }), 'R', '2', '2', '');
out.editCounts = [doc.get(AR.id).cols, doc.get(AR.id).rows, A.itemCount(doc.get(AR.id))];
out.props = E.describe(doc.get(AR.id)).slice(0, 5);
// Descomponer: elementos sueltos
const OPS = await import('./js/ops.js');
out.explodeN = OPS.explodeEntity(doc.get(AR.id)).length;
// No asociativa: copias sueltas al salir
await cmd('RECTANG', '200,0', '204,4'); const R0 = last();
const n0 = doc.model.length;
out.noAssoc = await cmd('ARRAYRECT', sel([R0.id]), 'ASO', 'N', 'R', '3', '1', '');
out.noAssocEnts = doc.model.slice(n0 - 1).map(e => e.type);
await cmd('ARRAYRECT', sel([doc.model.at(-1).id]), 'ASO', 'S', 'sA'); // vuelve a dejar ASOciativa = Sí
await cmd('UNDO');

// ---- Ángulo de filas: a 0° las filas van en vertical; a 30° giran en sentido antihorario ----
await cmd('CIRCLE', '200,-50', '1'); const AC = last();
await cmd('ARRAYRECT', sel([AC.id]), 'COL', '2', '10', 'F', '2', '10', 'Ángulo de filas', '30', '');
const ARa = last(), Lr = A.itemMatrices(ARa);
out.rowAngle = [r4(Lr[1][4]), r4(Lr[1][5]), r4(Lr[2][4]), r4(Lr[2][5])];

// ---- ARRAYPOLAR: 6 elementos en 360°, luego 4 en 180° sin girar ----
await cmd('LINE', '50,-50', '55,-50', ''); const L = last();
out.polar = await cmd('ARRAYPOLAR', sel([L.id]), '40,-50', '');
const AP = last();
out.polarEnt = [AP.kind, AP.n, r4(AP.fill), A.itemCount(AP)];
out.polarItem3 = (e => [r4(e.p1.x), r4(e.p1.y)])(A.arrayEnts(AP)[3]);
await cmd('ARRAYEDIT', pick(AP, { x: 50, y: -50 }), 'E', '4', 'L', '180', 'G', 'N', '');
const ap = doc.get(AP.id);
out.polarEdit = [ap.n, r4(ap.fill * 180 / Math.PI), ap.rot, A.arrayEnts(ap).map(e => r4(e.p2.x - e.p1.x))];

// ---- ARRAYPATH a lo largo de una polilínea, asociada al recorrido ----
await cmd('PLINE', '0,-100', '100,-100', '');
const PL = last();
await cmd('RECTANG', '-1,-101', '1,-99'); const SQ = last();
out.path = await cmd('ARRAYPATH', sel([SQ.id]), pick(PL, { x: 50, y: -100 }), 'E', '25', '', '');
const APa = last();
out.pathEnt = [APa.kind, APa.method, APa.sp, APa.n, A.itemCount(APa), APa.pathId === PL.id];
out.pathX = A.arrayEnts(APa).map(e => r4(E.bboxOf(e).x1 + 1));
// Al estirar el recorrido la matriz se recalcula (5 elementos → caben 7)
await grip({ pt: { x: 100, y: -100 }, refs: [{ id: PL.id, i: 1 }] }, '150,-100');
out.pathAfter = [A.itemCount(doc.get(APa.id)), r4(E.bboxOf(A.arrayEnts(doc.get(APa.id)).at(-1)).x1 + 1)];
await cmd('ARRAYEDIT', pick(APa, { x: 0, y: -100 }), 'E', '25', '7', 'M', 'D', 'E', '4', '');
out.pathDivide = A.arrayEnts(doc.get(APa.id)).map(e => r4(E.bboxOf(e).x1 + 1));
// Arco como recorrido, con alineación
await cmd('ARC', 'C', '0,-200', '20,-200', '-20,-200'); const ARC = last();
await cmd('LINE', '20,-200', '24,-200', ''); const T = last();
await cmd('ARRAYPATH', sel([T.id]), pick(ARC, { x: 0, y: -180 }), 'M', 'D', 'E', '3', '');
out.pathArc = A.arrayEnts(last()).map(e => [r4(e.p1.x), r4(e.p1.y), r4(Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x) * 180 / Math.PI)]);
// Copiar la matriz sola: pierde la asociación; mover la matriz sola, también
await cmd('COPY', sel([APa.id]), '0,0', '0,-20', '');
out.copyAssoc = [doc.get(APa.id).pathId != null, last().pathId != null];
await cmd('MOVE', sel([APa.id]), '0,0', '0,5');
out.moveAssoc = doc.get(APa.id).pathId != null;
// .tcad: deshacer y rehacer conservan las matrices
await cmd('UNDO'); out.undoAssoc = doc.get(APa.id).pathId != null; await cmd('REDO');

// ---- XCLIP: delimitación rectangular, invertida, desactivada, polilínea y suprimir ----
await cmd('LINE', '0,0', '20,0', ''); const b1 = last();
await cmd('LINE', '0,0', '0,20', ''); const b2 = last();
await cmd('CIRCLE', '10,10', '5'); const b3 = last();
app.sel.clear(); for (const x of [b1, b2, b3]) app.sel.add(x.id);
await cmd('BLOCK', 'PIEZA', '0,0');
const pi = app.run('INSERT', 'PIEZA'); await tick(); app.submit('E'); await tick(); app.submit('2'); await tick(); app.submit('300,0'); await pi;
const I = doc.model.filter(e => e.type === 'insert').at(-1);
out.ins = [I.name, I.sx, r4(E.bboxOf(I).x2)];
out.xclip = await cmd('XCLIP', sel([I.id]), 'N', 'R', '290,-10', '320,10');
const ic = doc.get(I.id);
out.clip = { pts: ic.clip.pts.map(p => [r4(p.x), r4(p.y)]), bbox: (b => [r4(b.x1), r4(b.y1), r4(b.x2), r4(b.y2)])(E.bboxOf(ic)) };
// La línea horizontal (de 300 a 340) queda recortada en x = 320; la vertical, en y = 10
out.clipPrims = E.primsOf(ic).filter(q => q.k === 's' && Math.abs(q.a.y - q.b.y) < 1e-9 && Math.abs(q.a.y) < 1e-9).map(q => [r4(Math.min(q.a.x, q.b.x)), r4(Math.max(q.a.x, q.b.x))]);
out.hitOut = E.hitDist(ic, { x: 330, y: 0 }) === Infinity;
out.hitIn = r4(E.hitDist(ic, { x: 310, y: 0.5 }));
out.snapsEnd = E.snapsOf(ic).end?.map(p => [r4(p.x), r4(p.y)]);
out.invert = await cmd('XCLIP', sel([I.id]), 'N', 'S', 'I', 'R', '290,-10', '320,10');
out.inverted = [!!doc.get(I.id).clip.invert, E.hitDist(doc.get(I.id), { x: 330, y: 0 }) < 1e-6, E.hitDist(doc.get(I.id), { x: 310, y: 0 }) === Infinity];
out.off = await cmd('XCLIP', sel([I.id]), 'DE');
out.offState = [doc.get(I.id).clip.off, r4(E.bboxOf(doc.get(I.id)).x2)];
await cmd('XCLIP', sel([I.id]), 'AC');
const nP = doc.model.length;
out.genPoly = await cmd('XCLIP', sel([I.id]), 'P');
out.genPolyPts = doc.model.slice(nP).map(e => [e.type, e.pts.length]);
// SVG y PDF con la delimitación
const svg = app.io.buildSVG().svg;
out.svgClip = (svg.match(/<clipPath id="xc/g) || []).length;
out.supr = await cmd('XCLIP', sel([I.id]), 'S');
out.noClip = !doc.get(I.id).clip;
out.frame = await cmd('XCLIPFRAME', '1');
out.frameVal = doc.settings.xclipFrame;
// Pintado en pantalla sin errores
app.renderer.drawBase(); app.renderer.drawOver();
return out;
