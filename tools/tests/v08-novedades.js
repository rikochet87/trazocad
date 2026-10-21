// v0.8: centros asociativos, DIMBREAK/DIMSPACE, estados de capa en DXF, REVCLOUD, WIPEOUT e imágenes
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {};
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const last = () => doc.model.at(-1);
const r4 = v => +v.toFixed(4);
const G = await import('./js/geom.js'), E = await import('./js/entities.js'), DXF = await import('./js/dxf.js'), OPS = await import('./js/ops.js');
const P = G.P;

// ---- CENTERMARK: marca asociativa que sigue al círculo ----
await cmd('CIRCLE', '0,0', '10');
const circ = last();
out.mark = await cmd('CENTERMARK', pick(circ, P(10, 0)), '');
const mark = last();
out.markType = [mark.type, mark.kind, mark.lines.length, !!mark.assoc];
const midOf = e => G.mid(e.lines[0][0], e.lines[0][1]);
out.markAt = [r4(midOf(mark).x), r4(midOf(mark).y)];
doc.begin(); doc.modify(circ.id, e => { e.c = P(5, 5); e.r = 20; }); doc.commit();
out.markFollows = [r4(midOf(mark).x), r4(midOf(mark).y), mark.lines[0][0].x < 5 - 20, !!mark.assoc];

// ---- Copia conjunta: la referencia se remapea a la copia ----
const maxId = doc.nextId;
await cmd('COPY', sel([circ.id, mark.id]), '0,0', '100,0', '');
const c2 = doc.model.find(e => e.type === 'circle' && e.c.x === 105), m2 = doc.model.find(e => e.type === 'center' && midOf(e).x === 105);
out.copy = [!!c2, !!m2, m2?.assoc?.a === c2?.id];

// ---- Mover sólo la marca: se desasocia ----
await cmd('MOVE', sel([mark.id]), '5,5', '7,7', '');
out.markMoved = [!!mark.assoc, r4(midOf(mark).x), r4(midOf(mark).y)];

// ---- CENTERLINE entre dos círculos ----
await cmd('CIRCLE', '200,0', '10');
const circ3 = last();
out.line = await cmd('CENTERLINE', pick(c2, P(115, 0)), pick(circ3, P(210, 0)));
const cl = last();
out.lineGeom = [cl.kind, cl.lines.length, !!cl.assoc, r4(cl.lines[0][0].x), r4(cl.lines[0][1].x)];
doc.begin(); doc.modify(circ3.id, e => { e.c = P(220, 0); }); doc.commit();
out.lineFollows = [r4(cl.lines[0][1].x), !!cl.assoc];

// ---- DIMBREAK: hueco donde una línea cruza la cota ----
doc.begin();
const dim = doc.add({ type: 'dim', kind: 'lin', p1: P(300, 0), p2: P(400, 0), p3: P(350, 20), rot: 0 });
const cross = doc.add({ type: 'line', p1: P(350, -10), p2: P(350, 30) });
doc.commit();
out.dimBreak = await cmd('DIMBREAK', pick(dim, P(350, 20)), '');
const gaps = d => d.lines.some(([a, b]) => Math.abs(a.y - 20) < 1e-9 && Math.abs(b.y - 20) < 1e-9 && Math.min(a.x, b.x) < 349.9 && Math.max(a.x, b.x) > 350.1);
out.breakGap = [dim.breaks?.length, !gaps(E.dimParts(dim))];

// ---- DIMSPACE: alinear y separar ----
doc.begin();
const d2 = doc.add({ type: 'dim', kind: 'lin', p1: P(300, -50), p2: P(400, -50), p3: P(350, 60), rot: 0 });
const d3 = doc.add({ type: 'dim', kind: 'lin', p1: P(300, -100), p2: P(400, -100), p3: P(350, 90), rot: 0 });
doc.commit();
out.space0 = await cmd('DIMSPACE', pick(dim, P(350, 20)), sel([d2.id]), '0');
out.space0y = [r4(d2.p3.y)];
out.space10 = await cmd('DIMSPACE', pick(dim, P(350, 20)), sel([d3.id]), '10');
out.space10y = [r4(d3.p3.y)];

// ---- Estados de capa en DXF 2000 y 2007 ----
doc.layerStates = [{ name: 'Prueba', desc: 'Estado de prueba', cur: '0', layers: { '0': { on: false, lock: true, color: '#ff0000', ltype: 'CONTINUOUS', lw: 0.5 } } }];
for (const v of ['2000', '2007']) {
  const text = DXF.writeDXF(doc, v), r = DXF.readDXF(text), s = r.layerStates?.[0];
  out['ls' + v] = [text.includes('ACAD_LAYERSTATES'), s?.name, s?.desc, s?.layers['0']?.on, s?.layers['0']?.lock, s?.layers['0']?.color, s?.layers['0']?.lw];
}

// ---- REVCLOUD y WIPEOUT ----
out.cloud = await cmd('REVCLOUD', '5', '', '-100,0', '-40,30');
const cloud = last();
out.cloudGeom = [cloud.type, cloud.closed, cloud.pts.length, cloud.bulges.every(b => b === -1), cloud.pts.length > 10];
out.wipe = await cmd('WIPEOUT', '-200,0', '-150,0', '-150,20', '');
const wipe = last();
out.wipeGeom = [wipe.type, wipe.pts.length, E.bboxOf(wipe).x1];

// ---- Imagen y delimitación ----
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
doc.begin();
const img = doc.add({ type: 'image', p: P(500, 0), w: 40, h: 20, src: png, name: 'pixel.png', rot: 0 });
doc.commit();
img.clip = { pts: [P(500, 0), P(520, 0), P(520, 20), P(500, 20)] };
out.img = [E.bboxOf(img).x2, E.primsOf(img).length, E.snapsOf(img).ins[0].x];
const svg = app.io.buildSVG().svg;
out.imgSvg = [svg.includes('<image'), svg.includes('href="data:image/png'), svg.includes('clipPath')];

// ---- DXF: centros como líneas y coberturas como sombreado sólido ----
const dxf = DXF.writeDXF(doc, '2000'), dxfr = DXF.readDXF(dxf);
out.dxfCenter = dxfr.ents.filter(e => e.type === 'line').length;
out.dxfWipe = dxfr.ents.filter(e => e.type === 'hatch' && e.pattern === 'SOLID').length;

return out;
