// Líneas múltiples (MLINE, MLSTYLE), regiones (REGION, UNION, SUBTRACT, INTERSECT), CONTORNO y cotas DIMARC / DIMJOGGED
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {};
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const last = () => doc.model.at(-1);
const r4 = v => +v.toFixed(4);
const E = await import('./js/entities.js');
app.view.cx = 50; app.view.cy = 25; app.view.scale = 4; app.renderer.invalidate();

// ---- MLINE con el estilo STANDARD (±0,5 × escala 20), justificación cero ----
out.mline = await cmd('MLINE', 'J', 'C', 'E', '10', '0,0', '40,0', '40,30', '');
const ML = last();
out.mlType = [ML.type, ML.pts.length, ML.just, ML.scale, ML.mlstyle];
const g = E.mlGeom(ML);
out.mlElems = g.elems.map(el => el.pts.map(p => [r4(p.x), r4(p.y)]));
// Inglete en el vértice (40,0): esquina a 45° de ±5
out.mlMiter = [r4(g.elems[0].pts[1].x), r4(g.elems[0].pts[1].y), r4(g.elems[1].pts[1].x), r4(g.elems[1].pts[1].y)];
out.mlProps = E.describe(ML).slice(0, 4);
// Estilo con tres elementos, remates de línea y relleno
doc.begin();
doc.mlineStyles.push({ name: 'MURO', desc: 'Muro con cámara', elems: [{ off: 0.5, color: 'BYLAYER', ltype: 'BYLAYER' }, { off: 0, color: '#ff0000', ltype: 'CENTER' }, { off: -0.5, color: 'BYLAYER', ltype: 'BYLAYER' }], caps: { sLine: true, eLine: true, sOuter: false, eOuter: true }, joints: false, fill: '#404040' });
doc.commit();
out.mlStyleCmd = await cmd('MLINE', 'S', 'muro', 'J', 'S', 'E', '20', '0,-20', '60,-20', '');
const MW = last();
const gw = E.mlGeom(MW);
out.muro = { style: MW.mlstyle, just: MW.just, elems: gw.elems.length, caps: gw.lines.length, arcs: gw.arcs.length, fill: !!gw.fill, firstY: gw.elems.map(el => r4(el.pts[0].y)) };
// Simetría: los elementos siguen al mismo lado
await cmd('MIRROR', sel([MW.id]), '0,-40', '10,-40', 'N');
const MM = last();
out.mirrorY = E.mlGeom(MM).elems.map(el => r4(el.pts[0].y));
// Descomponer: 3 elementos + 2 remates (el inicio y el arco del final) + relleno
const parts = (await import('./js/ops.js')).explodeEntity(MW);
out.explode = parts.map(p => p.type).reduce((a, t) => ({ ...a, [t]: (a[t] || 0) + 1 }), {});
out.mlSnaps = E.snapsOf(ML).end.length;
await cmd('ERASE', sel([MM.id]));

// ---- REGION: rectángulo y círculo; UNION, SUBTRACT, INTERSECT ----
await cmd('RECTANG', '100,0', '140,30'); const R1 = last();
await cmd('CIRCLE', '140,15', '10'); const C1 = last();
out.region = await cmd('REGION', sel([R1.id, C1.id]));
const regs = doc.model.filter(e => e.type === 'region');
out.regions = regs.map(r => [r.loops.length, r4(Math.abs(r.loops.reduce((s, l) => s + E.plArea({ ...l, closed: true }), 0)))]);
const [RA, RB] = regs;
const RX = (await import('./js/region.js'));
out.unionArea = r4(RX.regionArea({ loops: RX.booleanLoops(RA.loops, RB.loops, 'union') }));
out.subArea = r4(RX.regionArea({ loops: RX.booleanLoops(RA.loops, RB.loops, 'subtract') }));
out.intArea = r4(RX.regionArea({ loops: RX.booleanLoops(RA.loops, RB.loops, 'intersect') }));
out.expected = { union: r4(1200 + Math.PI * 50), sub: r4(1200 - Math.PI * 50), int: r4(Math.PI * 50) };
// Los arcos se conservan (la diferencia tiene un tramo de arco)
out.subArcs = RX.booleanLoops(RA.loops, RB.loops, 'subtract').map(l => (l.bulges || []).filter(b => b).length);
out.subtract = await cmd('SUBTRACT', sel([RA.id]), sel([RB.id]));
const RS = doc.model.filter(e => e.type === 'region');
out.afterSub = RS.map(r => [r.loops.length, r4(Math.abs(RX.regionArea(r)))]);
// Hueco: círculo dentro de un rectángulo → región con un contorno exterior y uno interior
await cmd('RECTANG', '100,40', '130,60'); const R2 = last();
await cmd('CIRCLE', '115,50', '5'); const C2 = last();
await cmd('REGION', sel([R2.id, C2.id]));
const [RH1, RH2] = doc.model.filter(e => e.type === 'region').slice(-2);
await cmd('SUBTRACT', sel([RH1.id]), sel([RH2.id]));
const hole = doc.get(RH1.id);
out.hole = { loops: hole.loops.length, area: r4(RX.regionArea(hole)), expected: r4(600 - Math.PI * 25), signs: hole.loops.map(l => Math.sign(RX.loopArea(l))) };
// Unión de dos regiones separadas: un único objeto con dos contornos
await cmd('CIRCLE', '200,0', '5'); const K1 = last();
await cmd('CIRCLE', '220,0', '5'); const K2 = last();
await cmd('REGION', sel([K1.id, K2.id]));
const [U1, U2] = doc.model.filter(e => e.type === 'region').slice(-2);
await cmd('UNION', sel([U1.id, U2.id]));
out.unionDisjoint = doc.get(U1.id).loops.length + ' contornos, ' + doc.model.filter(e => e.type === 'region').length + ' regiones';
// Región a partir de líneas encadenadas
await cmd('LINE', '0,60', '20,60', '20,80', 'C');
const lines = doc.model.slice(-3).map(e => e.id);
out.chain = await cmd('REGION', sel(lines));
out.chainArea = r4(Math.abs(RX.regionArea(last())));
out.intersectEmpty = await cmd('INTERSECT', sel([U1.id, last().id]));
out.areaCmd = await cmd('AREA', 'O', pick(hole, { x: 100, y: 45 }));

// ---- CONTORNO: polilínea con arcos alrededor de un punto ----
await cmd('LINE', '0,-80', '30,-80', ''); await cmd('LINE', '30,-80', '30,-60', '');
await cmd('ARC', '30,-60', '15,-45', '0,-60'); await cmd('LINE', '0,-60', '0,-80', '');
await cmd('CIRCLE', '15,-68', '3');
app.view.cx = 15; app.view.cy = -65; app.view.scale = 6; app.renderer.invalidate();
const nBefore = doc.model.length;
out.boundary = await cmd('BOUNDARY', '10,-75', '');
const bp = doc.model.slice(nBefore);
out.bpoly = bp.map(e => ({ type: e.type, n: e.pts.length, closed: e.closed, arcs: (e.bulges || []).filter(b => b).length, area: r4(Math.abs(E.plArea(e))) }));
out.bexpected = r4(30 * 20 + Math.PI * 15 * 15 / 2);
await cmd('ERASE', sel(bp.map(e => e.id)));
out.boundaryRegion = await cmd('BOUNDARY', 'T', 'R', '10,-75', '');
const br = last();
out.bregion = { type: br.type, loops: br.loops.length, area: r4(Math.abs(RX.regionArea(br))), expected: r4(30 * 20 + Math.PI * 225 / 2 - Math.PI * 9) };

// ---- DIMARC y DIMJOGGED ----
await cmd('ARC', 'C', '200,100', '220,100', '200,120'); const A1 = last();
out.dimarc = await cmd('DIMARC', pick(A1, { x: 214.14, y: 114.14 }), '230,110');
const DA = last();
const da = E.dimParts(DA);
out.dimarcVal = [r4(da.val), r4(Math.PI * 10), da.text.str, DA.assoc ? Object.keys(DA.assoc) : null, da.arcs.length];
out.dimarcPartial = await cmd('DIMARC', pick(A1, { x: 214.14, y: 114.14 }), 'P', '220,100', '214.1421,114.1421', '228,108');
out.partialVal = [r4(E.dimParts(last()).val), r4(Math.PI * 5), !!last().partial];
// La cota sigue al arco (asociativa)
await cmd('MOVE', sel([A1.id]), '0,0', '10,0');
out.dimarcAssoc = [r4(doc.get(DA.id).c.x), r4(E.dimParts(doc.get(DA.id)).val)];
await cmd('CIRCLE', '300,0', '80'); const BIG = last();
out.dimjog = await cmd('DIMJOGGED', pick(BIG, { x: 380, y: 0 }), '340,-40', '400,30', '360,0');
const DJ = last();
const dj = E.dimParts(DJ);
out.dimjogVal = [DJ.kind, r4(dj.val), dj.text.str, dj.lines.length, dj.arrows.length];
await cmd('SCALE', sel([BIG.id]), '300,0', '0.5');
out.dimjogAssoc = r4(E.dimParts(doc.get(DJ.id)).val);
out.dimKinds = [E.describe(DA)[1], E.describe(DJ)[1]];
// .tcad: versión 7 con los estilos de línea múltiple
const j = doc.toJSON();
out.tcad = [j.version, j.mlineStyles.map(s => s.name)];
return out;
