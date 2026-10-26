// Novedades de la v0.9: imágenes (transparencia, recorte por pinzamientos, DXF y PDF/SVG), DIMBREAK en DXF,
// matrices asociativas reconstruidas al importar, edición de nubes de revisión, marco de coberturas, orden de dibujo
// y edición de vértices de líneas múltiples con Ctrl+clic
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const grip = async (g, p) => { const pr = app.run('_GRIP', g); await tick(); app.submit(p); await tick(); await pr; };
const last = () => doc.model.at(-1);
const r4 = v => +v.toFixed(4);
const E = await import('./js/entities.js'), DXF = await import('./js/dxf.js'), PDF = await import('./js/pdf.js');
app.view.cx = 50; app.view.cy = 25; app.view.scale = 2; app.renderer.invalidate();

// ---- Imagen: transparencia, pinzamientos de recorte y SVG ----
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
doc.begin();
const img = doc.add({ type: 'image', layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', p: P(500, 0), w: 40, h: 20, rot: 0, src: PNG, name: 'foto-ñandú.png', pxw: 1, pxh: 1, transparency: 40,
  clip: { pts: [P(505, 2), P(535, 2), P(535, 18), P(505, 18)] } });
doc.commit();
out.img = { grips: E.gripsOf(img).length, kinds: E.TYPES.image.gripKinds(img), alpha: r4(E.imageAlpha(img)) };
out.imgProps = E.propsOf(img).filter(p => p.ro && (p.type === 'num' || p.type === 'int') && typeof p.get(img) !== 'number').map(p => p.label);
let svg = app.io.buildSVG().svg;
out.imgSvg = { opacity: svg.includes('opacity="0.6"'), clip: svg.includes('<clipPath id="ic'), image: svg.includes('<image ') };
// Pinzamiento de un vértice del recorte (índice 5 en adelante): sólo se mueve ese punto
await grip({ pt: E.gripsOf(img)[5], refs: [{ id: img.id, i: 5 }] }, '512,1');
out.clipGrip = { p: [img.p.x, img.p.y], pts: img.clip.pts.map(q => [q.x, q.y]) };
// Pinzamiento de esquina: la imagen se desplaza y el recorte la acompaña
await grip({ pt: E.gripsOf(img)[2], refs: [{ id: img.id, i: 2 }] }, '542,0');
out.moveGrip = { p: [img.p.x, img.p.y], clip: img.clip.pts.map(q => [q.x, q.y]) };

// ---- DXF: IMAGE e IMAGEDEF con XDATA troceada (fuente larga) ----
const longSrc = PNG + 'A'.repeat(400);
doc.begin();
const img2 = doc.add({ type: 'image', layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', p: P(600, 0), w: 10, h: 10, rot: 0, src: longSrc,
  name: 'captura-ñ.png', pxw: 2, pxh: 2, transparency: 15, clip: { pts: [P(601, 1), P(608, 1), P(608, 9), P(601, 9)] } });
doc.commit();
const dxf = DXF.writeDXF(doc, '2007');
out.imgDxfText = { raster: dxf.includes('AcDbRasterImage'), dict: dxf.includes('ACAD_IMAGE_DICT'), def: dxf.includes('IMAGEDEF'), xdata: dxf.includes('IMAGEN') };
const back = DXF.readDXF(dxf);
const bi = back.ents.find(e => e.type === 'image' && e.src === longSrc);
out.imgDxf = bi ? { name: bi.name, w: r4(bi.w), h: r4(bi.h), pxw: bi.pxw, transparency: bi.transparency,
  clip: bi.clip?.pts.map(q => [r4(q.x), r4(q.y)]) } : null;
doc.begin(); doc.remove(img2.id); doc.commit();

// ---- DIMBREAK: los cortes viajan en XDATA ----
doc.begin();
const dim = doc.add({ type: 'dim', layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', kind: 'lin', style: 'ISO-25',
  p1: P(0, 60), p2: P(30, 60), p3: P(15, 50), rot: 0, breaks: [{ p: P(15, 60), len: 4 }, { p: P(8, 60), len: 3 }] });
doc.commit();
const dxf2 = DXF.writeDXF(doc, '2007');
out.dimBreakText = dxf2.includes('DIMBREAK');
const back2 = DXF.readDXF(dxf2);
const bd = back2.ents.find(e => e.type === 'dim' && e.kind === 'lin');
out.dimBreak = { breaks: bd?.breaks?.map(b => [r4(b.p.x), r4(b.p.y), r4(b.len)]), lineY: bd ? r4(bd.p3.y) : null };

// ---- Matriz asociativa reconstruida desde XDATA MATRIZ (DXF 2007) ----
await cmd('CIRCLE', '700,40', '2');
const CC = last();
await cmd('ARRAYRECT', sel([CC.id]), 'COL', '3', '8', 'F', '2', '6', '');
const AR = last();
const dxf3 = DXF.writeDXF(doc, '2007');
out.arrayText = dxf3.includes('MATRIZ');
const back3 = DXF.readDXF(dxf3);
const ra = back3.ents.find(e => e.type === 'array');
out.array = ra ? { kind: ra.kind, cols: ra.cols, rows: ra.rows, dx: r4(ra.dx), dy: r4(ra.dy), src: ra.src.map(x => x.type) } : null;

// ---- REVCLOUDEDIT: añadir, quitar y convertir ----
await cmd('REVCLOUD', '5', '', '-100,0', '-40,30');
const CL = last();
out.cloud = { type: CL.type, closed: CL.closed, arcs: CL.pts.length, cloud: CL.cloud, pieces: E.plPieces(CL).length };
const cq = () => E.pieceAt(E.plPieces(CL)[0], 0.5);
const qs = () => { const q = cq(); return `${q.x},${q.y}`; };
await cmd('REVCLOUDEDIT', pick(CL, cq()), 'A', qs());
out.cloudAdd = CL.pts.length;
await cmd('REVCLOUDEDIT', pick(CL, cq()), 'Q', qs());
out.cloudDel = CL.pts.length;
await cmd('REVCLOUDEDIT', pick(CL, cq()), 'C');
out.cloudConv = { cloud: CL.cloud, closed: CL.closed };

// ---- WIPEOUTFRAME: marco de las coberturas en SVG (0 oculto, 1 impreso, 2 sólo pantalla) ----
await cmd('WIPEOUT', '0,0', '10,0', '10,10', '');
const WO = last();
const dWo = `${WO.pts.map(p => `${+p.x.toFixed(6)} ${+p.y.toFixed(6)}`).join('L').replace(/^/, 'M')}Z`;
const frameCount = v => { doc.settings.wipeoutFrame = v; return app.io.buildSVG().svg.split(`d="${dWo}"`).length - 1; };
out.woFrame = { def: 2, f0: frameCount(0), f1: frameCount(1), f2: frameCount(2), set: doc.settings.wipeoutFrame };
await cmd('WIPEOUTFRAME', '0');
out.woCmd = doc.settings.wipeoutFrame;

// ---- DRAWORDER: al frente y al fondo ----
await cmd('LINE', '800,0', '820,0', '');
const L1 = last();
await cmd('LINE', '800,5', '820,5', '');
const before = doc.model.length;
await cmd('DRAWORDER', sel([L1.id]), 'D');
out.orderBack = doc.model[0].id === L1.id;
await cmd('DRAWORDER', sel([L1.id]), 'F');
out.orderFront = doc.model.at(-1).id === L1.id;
out.orderCount = [before, doc.model.length, new Set(doc.model.map(e => e.id)).size];

// ---- Vértices de línea múltiple con Ctrl+clic (_GRIPVERTEX) ----
await cmd('MLINE', 'J', 'C', 'E', '10', '0,0', '40,0', '40,30', '');
const ML = last();
out.ml = { pts: ML.pts.length, kinds: E.TYPES.mline.gripKinds(ML) };
await app.run('_GRIPVERTEX', { pt: P(20, 0), refs: [{ id: ML.id, i: -1 }] });
out.mlAdd = { pts: ML.pts.length, at: [r4(ML.pts[1].x), r4(ML.pts[1].y)], kinds: E.TYPES.mline.gripKinds(ML) };
await app.run('_GRIPVERTEX', { pt: P(20, 0), refs: [{ id: ML.id, i: 1 }] });
out.mlDel = { pts: ML.pts.length, at: [r4(ML.pts[1].x), r4(ML.pts[1].y)] };
await app.run('_GRIPVERTEX', { pt: P(0, 0), refs: [{ id: ML.id, i: 0 }] });
out.mlEnd = ML.pts.length;

// ---- PDF: la imagen se incrusta como XObject con transparencia ----
const pages = await app.io.buildPDF('current');
const blob = await PDF.buildPdf(pages, 'v09');
const buf = new Uint8Array(await blob.arrayBuffer());
let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
out.pdfInfo = { bytes: buf.length, xobject: bin.includes('/XObject'), rgb: bin.includes('/DeviceRGB'), gstate: bin.includes('/ExtGState'),
  alpha: bin.includes('/ca 0.6'), image: bin.includes('/Subtype /Image') };
return out;
