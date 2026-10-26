// Novedades de la v0.10: escala real de imágenes (ppp) y recorte con varios contornos, tolerancias y modificaciones de
// cota (DIMOVERRIDE), islas de sombreado y degradados de varios colores, referencias externas recordadas y escritas
// como XREF, tablas de estilos de trazado (CTB/STB), escala de tipo de línea por ventana y Propiedades de varios objetos
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const grip = async (g, p) => { const pr = app.run('_GRIP', g); await tick(); app.submit(p); await tick(); await pr; };
const r4 = v => +(+v).toFixed(4);
const base = { layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' };
const add = e => { doc.begin(); const x = doc.add({ ...base, ...e }); doc.commit(); return x; };
const E = await import('./js/entities.js'), DXF = await import('./js/dxf.js'), C = await import('./js/commands.js');
const PT = await import('./js/patterns.js'), H = await import('./js/hatch.js'), XR = await import('./js/xref.js'), PS = await import('./js/plotstyles.js'), OPS = await import('./js/ops.js');
const RD = await import('./js/render.js');
app.view.cx = 50; app.view.cy = 50; app.view.scale = 3; app.renderer.invalidate();

// ---- Resolución guardada en el archivo: PNG (pHYs), JPEG (JFIF) y BMP ----
const be32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const chunk = (type, data) => [...be32(data.length), ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', new Array(13).fill(0)), ...chunk('pHYs', [...be32(11811), ...be32(11811), 1]), ...chunk('IDAT', [0])]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0, 150, 0, 150, 0, 0, 0xff, 0xda, 0, 2]);
const bmp = new Uint8Array(54); bmp[0] = 0x42; bmp[1] = 0x4d; bmp[38] = 0x13; bmp[39] = 0x0b; // 2835 px/m = 72 ppp
out.dpi = { png: r4(C.imageFileDpi(png)), jpg: r4(C.imageFileDpi(jpg)), bmp: r4(C.imageFileDpi(bmp)), none: C.imageFileDpi(new Uint8Array([1, 2, 3])) };

// ---- Imagen: escala y resolución en Propiedades; recorte con varios contornos ----
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const img = add({ type: 'image', p: P(0, 0), w: 100, h: 50, rot: 0, src: PNG, name: 'orto.png', pxw: 1000, pxh: 500 });
const prop = (e, l) => E.propsOf(e).find(p => p.label === l);
out.imgRes = { scale: r4(prop(img, 'Escala (unidades/píxel)').get(img)), dpi: prop(img, 'Resolución').get(img) };
doc.begin(); doc.modify(img.id, x => prop(x, 'Escala (unidades/píxel)').set(x, 0.254)); doc.commit(); // 0,254 mm/píxel = 100 ppp
out.imgScaled = { w: r4(img.w), h: r4(img.h), dpi: prop(img, 'Resolución').get(img) };
// XCLIP rectangular y luego «Añadir contorno» (hueco interior): dos contornos par-impar
await cmd('XCLIP', sel([img.id]), 'Nuevo contorno', 'Rectangular', '10,10', '200,120');
out.xclip1 = { loops: E.imageClipLoops(img).length };
const r1 = await cmd('XCLIP', sel([img.id]), 'Añadir contorno', 'Rectangular', '40,30', '60,40');
out.xclip2 = { r: r1, loops: E.imageClipLoops(img).length, prims: E.primsOf(img).length, grips: E.gripsOf(img).length, deleg: prop(img, 'Delimitada').get(img) };
// Pinzamiento de un vértice del segundo contorno: sólo cambia ese contorno
await grip({ pt: E.gripsOf(img)[5 + 4 + 1], refs: [{ id: img.id, i: 5 + 4 + 1 }] }, '65,30');
out.clipGrip2 = { main: img.clip.pts.map(q => [q.x, q.y]), hole: img.clip.loops[0].map(q => [q.x, q.y]) };
const svgImg = app.io.buildSVG().svg;
out.imgSvg = { evenodd: /clip-rule="evenodd"/.test(svgImg), twoLoops: (svgImg.match(/<clipPath id="ic\d+"[^>]*><path d="([^"]*)"/)?.[1].match(/M/g) || []).length };
const dImg = DXF.readDXF(DXF.writeDXF(doc, '2007')).ents.find(e => e.type === 'image');
out.imgDxf = dImg ? { loops: E.imageClipLoops(dImg).length, hole: dImg.clip.loops?.[0]?.map(q => [r4(q.x), r4(q.y)]) } : null;
const r2 = await cmd('XCLIP', sel([img.id]), 'generar Polilínea');
out.clipPlines = { r: r2, n: doc.model.filter(e => e.type === 'pline').length };
doc.begin(); for (const e of [...doc.model]) doc.remove(e.id); doc.commit();

// ---- Cotas: tolerancias del estilo y modificaciones por cota ----
const dm = add({ type: 'dim', kind: 'lin', style: 'ISO-25', p1: P(0, 0), p2: P(40, 0), p3: P(20, -10), rot: 0 });
const texts = e => E.dimTexts(E.dimParts(e)).map(t => t.str);
out.tolNone = texts(dm);
doc.begin(); doc.modify(dm.id, x => prop(x, 'Tolerancia').set(x, 'sym')); doc.modify(dm.id, x => prop(x, 'Desviación superior').set(x, 0.05)); doc.commit();
out.tolSym = { t: texts(dm), ov: dm.ov };
doc.begin(); doc.modify(dm.id, x => { x.ov = { ...x.ov, tol: 'dev', tp: 0.1, tm: 0.05, tfac: 0.7 }; }); doc.commit();
const dd = E.dimParts(dm);
out.tolDev = { t: texts(dm), h: dd.tols.map(t => r4(t.h)), right: dd.tols.every(t => t.p.x > dd.text.p.x), above: dd.tols[0].p.y > dd.tols[1].p.y };
doc.begin(); doc.modify(dm.id, x => { x.ov = { tol: 'lim', tp: 0.2, tm: 0.1 }; }); doc.commit();
out.tolLim = texts(dm);
doc.begin(); doc.modify(dm.id, x => { x.ov = { tol: 'basic' }; }); doc.commit();
out.tolBasic = { t: texts(dm), lines: E.dimParts(dm).lines.length };
// DIMOVERRIDE: desviación con DIMTOL y DIMTP/DIMTM, otra altura de texto; luego Borrar
doc.begin(); doc.modify(dm.id, x => { delete x.ov; }); doc.commit();
const rOv = await cmd('DIMOVERRIDE', 'DIMTOL', '1', 'DIMTP', '0.02', 'DIMTM', '0.01', 'DIMTXT', '3.5', '', sel([dm.id]));
out.dimOverride = { r: rOv, ov: dm.ov, t: texts(dm), mods: prop(dm, 'Modificaciones').get(dm) };
// En el DXF: XDATA ACAD/DSTYLE con las variables modificadas; se recuperan al leer
const dxfDim = DXF.writeDXF(doc, '2000');
out.dstyle = { xdata: dxfDim.includes('DSTYLE') };
const bDim = DXF.readDXF(dxfDim).ents.find(e => e.type === 'dim');
out.dimDxf = bDim ? { ov: bDim.ov } : null;
const ex = OPS.explodeEntity ? OPS.explodeEntity(dm) : null;
out.dimExplode = ex ? ex.filter(x => x.type === 'text').map(x => x.text) : null;
await cmd('DIMOVERRIDE', 'Borrar', sel([dm.id]));
out.dimClear = { ov: dm.ov ?? null, t: texts(dm) };
// Tolerancia en el estilo de cota: DIMSTYLE del DXF con DIMTOL, DIMTP, DIMTM y DIMTDEC
doc.dimStyles[0] = { ...doc.dimStyles[0], tol: 'dev', tp: 0.3, tm: 0.1, tdec: 1 };
const bStyle = DXF.readDXF(DXF.writeDXF(doc, '2007')).dimStyles[0];
out.dimStyleDxf = { tol: bStyle.tol, tp: bStyle.tp, tm: bStyle.tm, tdec: bStyle.tdec, t: texts(dm) };
doc.dimStyles[0] = { ...E.DEFAULT_DIMSTYLE };
doc.begin(); doc.remove(dm.id); doc.commit();

// ---- Degradados de varios colores ----
const stops = PT.parseStops('0% #ff0000, 50 % #00ff00, 100% #0000ff');
out.parseStops = { stops, text: PT.stopsText({ c1: '#ff0000', c2: '#0000ff', stops }), bad: PT.parseStops('rojo') };
const sq = [P(0, 0), P(100, 0), P(100, 50), P(0, 50)];
const gh = add({ type: 'hatch', loops: [sq], pattern: 'GRADIENT', scale: 1, angle: 0, grad: { type: 'LINEAR', c1: '#ff0000', c2: '#0000ff', centered: true, stops } });
out.gradSpec = { linear: PT.gradientSpec(gh, E.bboxOf(gh)).stops.length, cyl: PT.gradientSpec({ ...gh, grad: { ...gh.grad, type: 'CYLINDER' } }, E.bboxOf(gh)).stops.map(([t, c]) => [r4(t), c]),
  sph: PT.gradientSpec({ ...gh, grad: { ...gh.grad, type: 'SPHERICAL' } }, E.bboxOf(gh)).stops.map(s => s[1]),
  two: PT.gradientSpec({ ...gh, grad: { type: 'CYLINDER', c1: '#111111', c2: '#eeeeee' } }, E.bboxOf(gh)).stops.map(s => s[1]) };
const svgG = app.io.buildSVG().svg;
out.gradSvg = (svgG.match(/<linearGradient[\s\S]*?<\/linearGradient>/)?.[0].match(/<stop /g) || []).length;
const bg = DXF.readDXF(DXF.writeDXF(doc, '2007')).ents.find(e => e.type === 'hatch');
out.gradDxf = bg ? { stops: bg.grad.stops, c1: bg.grad.c1, c2: bg.grad.c2 } : null;
doc.begin(); doc.modify(gh.id, x => prop(x, 'Paradas de color').set(x, '0% #000000, 100% #ffffff')); doc.commit();
out.gradTwo = { stops: gh.grad.stops ?? null, c1: gh.grad.c1, c2: gh.grad.c2 };
doc.begin(); doc.remove(gh.id); doc.commit();

// ---- Islas del sombreado: normal, exterior e ignorar; añadir y quitar islas ----
const rect = (x1, y1, x2, y2) => add({ type: 'pline', closed: true, pts: [P(x1, y1), P(x2, y1), P(x2, y2), P(x1, y2)] });
const R0 = rect(0, 0, 100, 100), R1 = rect(20, 20, 80, 80), R2 = rect(40, 40, 60, 60);
const hatchAt = async mode => {
  doc.settings.hatchIslands = mode;
  const before = new Set(doc.model.map(e => e.id));
  await cmd('HATCH', '10,10', '');
  return doc.model.find(e => e.type === 'hatch' && !before.has(e.id)); // el sombreado nuevo va al fondo del orden de dibujo
};
const hn = await hatchAt('normal'), ho = await hatchAt('outer'), hi = await hatchAt('ignore');
out.islands = { normal: hn.loops.length, outer: ho.loops.length, ignore: hi.loops.length, keepO: ho.islands, depths: H.islandDepths(hn.loops) };
// Punto a la izquierda de una isla, a la altura de su borde inferior: el rayo choca primero con la isla y sigue
const tri = [P(200, 0), P(320, 0), P(300, 30), P(220, 30)].map((p, i, a) => [p, a[(i + 1) % 4]]);
const lines = tri.map(([a, b]) => ({ type: 'line', p1: a, p2: b }));
const isl = { type: 'circle', c: P(260, 9), r: 5 };
const fb = H.findBoundary([...lines, isl].map((e, i) => ({ ...e, id: 9000 + i })), P(215, 4));
out.islandRay = fb ? { loops: fb.length, ids: fb.ids.length } : null;
// Modo de islas desde Propiedades en un sombreado asociativo: se vuelve a detectar el contorno
doc.begin(); doc.modify(hn.id, x => prop(x, 'Detección de islas').set(x, 'outer')); doc.commit();
out.islandProp = { loops: hn.loops.length, mode: hn.islands };
doc.begin(); for (const h of [hn, ho, hi]) doc.remove(h.id); doc.commit();
// Quitar la isla R1 (y con ella la R2 que contiene) e incluir un círculo como isla nueva
doc.settings.hatchIslands = 'normal';
// El círculo está en una capa desactivada: la detección automática no lo ve y se incluye a mano
doc.begin(); doc.addLayer('Oculta', '#ffffff'); doc.layer('Oculta').on = false; doc.commit();
const circ = add({ type: 'circle', c: P(10, 90), r: 4, layer: 'Oculta' });
const before = new Set(doc.model.map(e => e.id));
const rq = await cmd('HATCH', '10,10', 'Quitar islas', '30,30', '', 'Incluir islas', sel([circ.id]), '');
const hq = doc.model.find(e => e.type === 'hatch' && !before.has(e.id));
out.islandEdit = { r: rq, loops: hq.loops.length, rm: hq.rmIsl?.length, assoc: hq.assoc?.includes(circ.id) };
// Al mover el contorno exterior, el sombreado se recalcula sin la isla quitada
doc.begin(); doc.modify(R0.id, x => { x.pts = x.pts.map(q => (q.x > 50 ? P(q.x + 20, q.y) : q)); }); doc.commit();
out.islandAssoc = { loops: hq.loops.length, w: r4(E.bboxOf(hq).x2) };
const hd = DXF.readDXF(DXF.writeDXF(doc, '2000')).ents.find(e => e.type === 'hatch');
out.islandDxf = { loops: hd?.loops.length };
doc.begin(); for (const e of [...doc.model]) doc.remove(e.id); doc.commit();

// ---- Referencias externas recordadas entre sesiones y escritas como XREF ----
const src = JSON.stringify({ app: 'TrazoCAD', version: 10, layers: [{ name: '0', color: '#ffffff', ltype: 'CONTINUOUS', lw: 'DEFAULT', on: true, lock: false }, { name: 'Ejes', color: '#ff0000', ltype: 'CENTER', lw: 'DEFAULT', on: true, lock: false }],
  model: [{ type: 'circle', c: P(0, 0), r: 5, ...base }, { type: 'line', p1: P(-8, 0), p2: P(8, 0), ...base, layer: 'Ejes' }], blocks: {}, textStyles: [], dimStyles: [] });
const file = new File([src], 'pieza.tcad');
doc.begin(); XR.defineXref(doc, 'pieza', XR.parseSource(src, 'pieza.tcad'), 'pieza.tcad'); doc.add({ type: 'insert', name: 'pieza', p: P(50, 50), sx: 1, sy: 1, rot: 0, ...base }); doc.commit();
out.remember = await XR.rememberXref('pieza.tcad', file);
const rec = await XR.recallXref('pieza.tcad');
out.recall = { kind: rec instanceof Blob ? 'copia' : typeof rec, size: rec?.size };
// DXF 2000: bloque XREF (indicador 4, ruta en el código 1), capa dependiente con | y contenido en XDATA
const dx = DXF.writeDXF(doc, '2000');
const blockOf = t => t.match(/\nBLOCK\r\n(?:[^\n]*\n){0,12}?2\r\npieza\r\n70\r\n(\d+)\r\n[\s\S]*?\n3\r\npieza\r\n1\r\n([^\r\n]*)/);
const blk = blockOf(dx);
out.xrefDxf = { flags: blk ? +blk[1] : null, path: blk ? blk[2] : null, depLayer: /\n2\r\npieza\|Ejes\r\n70\r\n48\r/.test(dx), cache: dx.includes('XREF') };
const bx = DXF.readDXF(dx);
out.xrefRead = { xref: bx.blocks.pieza?.xref?.file, ents: bx.blocks.pieza?.ents.length, layer: bx.layers.find(l => l.name === 'pieza|Ejes')?.xref, ins: bx.ents.filter(e => e.type === 'insert' && e.name === 'pieza').length };
// DXF de otro programa (sin la caché de TrazoCAD): la referencia llega vacía y se recupera con el archivo recordado
doc.blocks.pieza.ents = [];
const rs = await XR.restoreXrefs(doc);
out.restore = { ...rs, ents: doc.blocks.pieza.ents.length };
const d12 = DXF.writeDXF(doc, 'R12');
const b12 = blockOf(d12);
out.xrefR12 = { flags: b12 ? +b12[1] : null, layer: d12.includes('pieza$0$Ejes'), line: /\nLINE\r\n(?:[^\n]*\n){0,6}?8\r\npieza\$0\$Ejes/.test(d12) };
await XR.forgetXref('pieza.tcad');
out.forgot = await XR.recallXref('pieza.tcad');
XR.detachXref(doc, 'pieza');

// ---- Tablas de estilos de trazado ----
doc.begin();
doc.addLayer('Rojo', '#ff0000'); doc.addLayer('Gris', '#00ff00');
const lr = doc.add({ ...base, type: 'line', layer: 'Rojo', p1: P(0, 0), p2: P(50, 0) });
const lg = doc.add({ ...base, type: 'line', layer: 'Gris', p1: P(0, 10), p2: P(50, 10), lw: 0.5 });
const lay = doc.addLayout('Plano', 'A4');
doc.commit();
const pst = (name, e) => { lay.plotStyle = name; const f = app.io.printSty(lay, w => w); return f(e); };
out.ctb = { none: pst(undefined, lr).color, mono: pst('monochrome.ctb', lr).color, gray: pst('grayscale.ctb', lr).color, screen: pst('screening 50%.ctb', lr).color, acad: pst('acad.ctb', lr).color };
// Tabla propia: el color 1 (rojo) se imprime en azul con 0,7 mm y DASHED
doc.plotStyles['mia.ctb'] = { name: 'mia.ctb', type: 'ctb', desc: 'prueba', styles: { ...PS.BUILTIN_PLOT['acad.ctb'].styles, 1: { color: '#0000ff', lw: 0.7, screen: 100, ltype: 'DASHED' } } };
const own = pst('mia.ctb', lr);
out.ctbOwn = { color: own.color, lw: own.px, dashed: own.pat.length > 0, other: pst('mia.ctb', lg).color };
// .stb: estilo por capa y por objeto
doc.plotStyles['ruta.stb'] = { name: 'ruta.stb', type: 'stb', desc: '', styles: { Normal: { ...PS.OBJECT }, Fino: { ...PS.OBJECT, lw: 0.13, color: '#333333' }, Grueso: { ...PS.OBJECT, lw: 1 } } };
doc.layer('Rojo').pstyle = 'Fino';
lg.pstyle = 'Grueso';
out.stb = { byLayer: pst('ruta.stb', lr), byObject: pst('ruta.stb', lg).px, names: PS.stbNames(doc.plotStyles['ruta.stb']), active: PS.activeStb(doc, lay)?.name };
// Archivos .ctb/.stb de AutoCAD: exportar e importar conserva los estilos
const bytes = await PS.writePlotFile(doc.plotStyles['mia.ctb']);
const head = new TextDecoder().decode(bytes.slice(0, 48));
const back = await PS.readPlotFile(bytes.buffer, 'mia.ctb');
out.ctbFile = { head: head.startsWith('PIAFILEVERSION_2.0,CTBVER1'), type: back.type, c1: back.styles[1], c2: back.styles[2], n: Object.keys(back.styles).length };
const sb = await PS.readPlotFile((await PS.writePlotFile(doc.plotStyles['ruta.stb'])).buffer, 'ruta.stb');
out.stbFile = { type: sb.type, names: Object.keys(sb.styles), fino: sb.styles.Fino };
// Exportación PDF y SVG de la presentación con monochrome.ctb: sin rojo
lay.plotStyle = 'monochrome.ctb';
doc.begin(); lay.ents.push({ ...base, id: doc.nextId++, type: 'vport', p1: P(20, 20), p2: P(200, 150), cx: 25, cy: 5, s: 2, ltscale: 3 }); doc.reindex(); doc.commit();
app.switchTab(0); await tick(20);
const svgL = app.io.buildSVG().svg;
out.plotSvg = { red: svgL.includes('#ff0000'), black: svgL.includes('stroke="#000000"') };
const pages = await app.io.buildPDF('current');
const ops = pages[0].ctx.ops.join(' ');
out.plotPdf = { redStroke: /1 0 0 RG/.test(ops), blackStroke: /0 0 0 RG/.test(ops) };
// Escala de tipo de línea por ventana y PSLTSCALE
const vp = lay.ents.find(e => e.type === 'vport');
out.vpLt = { k: RD.vpLtk(doc, vp), prop: prop(vp, 'Escala de tipo de línea').get(vp) };
await cmd('PSLTSCALE', '1');
out.psltscale = { set: doc.settings.psltscale, k: r4(RD.vpLtk(doc, vp)) };
// En el DXF: tabla de la presentación (código 7 de PLOTSETTINGS) y $PSLTSCALE
const bl = DXF.readDXF(DXF.writeDXF(doc, '2007'));
out.plotDxf = { layout: bl.layouts[0]?.plotStyle, psltscale: bl.psltscale };
// «Mostrar estilos de trazado» en pantalla
lay.showPlot = true;
out.showPlot = app.styleFor(lr).color;
lay.showPlot = false;
app.switchTab('model'); await tick(20);

// ---- Propiedades de varios objetos: filtro por tipo, *Varios* y cambio en todos a la vez ----
const c1 = add({ type: 'circle', c: P(0, 0), r: 5 }), c2 = add({ type: 'circle', c: P(20, 0), r: 8 }), l3 = add({ type: 'line', p1: P(0, 20), p2: P(10, 20) });
app.sel.clear(); for (const e of [c1, c2, l3]) app.sel.add(e.id);
app.ui.propType = ''; app.ui.renderProps();
const pal = app.ui.palBodies.props;
out.propsMixed = { head: pal.querySelector('select.prop-type')?.value, opts: [...pal.querySelectorAll('select.prop-type option')].map(o => o.textContent), geom: pal.textContent.includes('tipos distintos') };
app.ui.propType = 'circle'; app.ui.renderProps();
const rowOf = l => [...pal.querySelectorAll('.prop-row')].find(r => r.querySelector('label')?.textContent === l);
out.propsCircles = { sec: pal.textContent.includes('Geometría (2 objetos)'), radius: rowOf('Radio')?.querySelector('input')?.placeholder };
app.ui.setGeomAll([c1.id, c2.id], 'Radio', 12);
out.propsSet = { r1: c1.r, r2: c2.r, line: l3.type };
doc.undo(); out.propsUndo = { r1: doc.get(c1.id).r, r2: doc.get(c2.id).r };
app.ui.applyProp('color', '#ffff00', [c1.id, c2.id]);
out.propsColor = { c1: doc.get(c1.id).color, l3: doc.get(l3.id).color };
app.sel.clear();
return out;
