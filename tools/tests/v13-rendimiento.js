// Novedades de la v0.13 (3): rendimiento con más de 100 000 objetos. Deshacer incremental (tiempos y memoria por paso),
// índice espacial incremental (igual que reconstruido tras altas, cambios, supresiones, deshacer y rehacer), dibujo por
// teselas (igual, píxel a píxel, que el dibujo directo tras editar), simplificación de curvas de nivel, designación
// grande y apertura de un DXF grande en segundo plano (Web Worker) con barra de progreso. Los tiempos son orientativos.
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y }), now = () => performance.now(), ms = t => Math.round(now() - t);
const R = app.renderer, RM = await import('./js/render.js'), E = await import('./js/entities.js'), DXF = await import('./js/dxf.js');
const base = { layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' };
RM.TILES.budget = 0; // en la prueba, las teselas se dibujan enteras en cada fotograma

// 70 000 líneas y 30 000 curvas de nivel de 60 vértices
let t = now();
doc.begin();
doc.ensureLayer('CURVAS', '#c08040');
doc.quiet = true;
for (let i = 0; i < 70000; i++) { const x = (i % 350) * 8, y = Math.floor(i / 350) * 8; doc.add({ ...base, type: 'line', p1: P(x, y), p2: P(x + 5, y + 3) }); }
for (let i = 0; i < 30000; i++) { const pts = []; for (let k = 0; k < 60; k++) pts.push(P(k * 47, i * 0.055 + Math.sin(k * 0.7 + i) * 2)); doc.add({ ...base, layer: 'CURVAS', type: 'pline', pts }); }
doc.quiet = false;
doc.commit();
out.n = doc.model.length;
out.build = ms(t);
const step = doc.undoS[doc.undoS.length - 1];
out.buildStep = { ops: step.j.length, mb: +((step.size || 0) / 1e6).toFixed(3) }; // el diario de las altas guarda referencias, no copias (v0.12: 52 MB por paso)
app.zoomExtents();

// ---- Una orden con 100 000 objetos: transacción, deshacer y rehacer ----
t = now(); doc.begin(); const ln = doc.add({ ...base, type: 'line', p1: P(1, 1), p2: P(900, 600) }); doc.commit(); out.addLine = ms(t);
t = now(); doc.undo(); out.undo = ms(t);
t = now(); doc.redo(); out.redo = ms(t);
t = now(); doc.begin(); doc.modify(ln.id, e => { e.p2 = P(800, 500); }); doc.commit(); out.modify = ms(t);
out.undoStepKB = +(JSON.stringify(doc.undoS[doc.undoS.length - 1].j.map(o => o.json || '')).length / 1e3).toFixed(2);

// ---- Índice espacial incremental: mismas respuestas que uno reconstruido ----
const { SpatialIndex } = await import('./js/spatial.js');
const check = label => {
  const inc = app.idx(), fresh = new SpatialIndex().of([...doc.model], doc);
  const rs = [{ x1: 0, y1: 0, x2: 300, y2: 200 }, { x1: 1000, y1: 500, x2: 1400, y2: 900 }, { x1: -10, y1: -10, x2: 3000, y2: 1700 }, { x1: 795, y1: 495, x2: 805, y2: 505 }];
  return rs.every(r => { const a = inc.query(r, true).map(e => e.id).join(), b = fresh.query(r, true).map(e => e.id).join(); return a === b; }) ? 'igual' : `DISTINTO (${label})`;
};
out.idxAfterAdd = check('alta');
t = now(); app.idx(); out.idxSync = ms(t);
doc.begin();
for (let i = 0; i < 500; i++) doc.modify(doc.model[i * 37].id, e => E.xformEnt(e, [1, 0, 0, 1, 13, 7]));
for (let i = 0; i < 300; i++) doc.add({ ...base, type: 'circle', c: P(i * 9, 900), r: 2 });
doc.removeMany(doc.model.slice(2000, 2400).map(e => e.id));
doc.remove(doc.model[50].id);
doc.commit();
out.idxAfterEdit = check('edición');
doc.undo(); out.idxAfterUndo = check('deshacer'); out.nUndo = doc.model.length;
doc.redo(); out.idxAfterRedo = check('rehacer'); out.nRedo = doc.model.length;
doc.undo();

// ---- Teselas: el dibujo en caché es igual al directo (tras encuadrar, añadir, mover y suprimir) ----
// Fotograma completo: dibujo y rasterizado (getImageData obliga a terminarlo)
const frame = () => { R.drawBase(); R.base.getContext('2d').getImageData(0, 0, 1, 1); };
const shot = () => { const c = R.base.getContext('2d'); return c.getImageData(0, 0, R.base.width, R.base.height).data; };
// Bloques de 8 × 8 píxeles con distinto brillo medio (un objeto de más o de menos); el suavizado subpíxel de las zonas muy
// densas puede variar entre teselas y dibujo directo sin que se vea
const diff = (a, b) => {
  const W = R.base.width, H = R.base.height;
  let n = 0;
  for (let by = 0; by + 8 <= H; by += 8) for (let bx = 0; bx + 8 <= W; bx += 8) {
    let s = 0;
    for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) { const i = (y * W + x) * 4; s += a[i] + a[i + 1] + a[i + 2] - b[i] - b[i + 1] - b[i + 2]; }
    if (Math.abs(s) / 192 > 10) n++;
  }
  return n;
};
const compare = () => { RM.TILES.on = true; R.drawBase(); const a = shot(); RM.TILES.on = false; R.drawBase(); const b = shot(); RM.TILES.on = true; return diff(a, b); };
app.view.zoomAt(6, { x: 500, y: 350 });
t = now(); frame(); out.tilesFirst = ms(t);
t = now(); frame(); out.tilesCached = ms(t);
app.view.panBy(137, -61);
t = now(); frame(); out.tilesPan = ms(t);
RM.TILES.on = false; t = now(); frame(); out.directFrame = ms(t); RM.TILES.on = true;
out.diffPan = compare();
const w = app.view.toWorld({ x: 400, y: 300 });
doc.begin(); const c1 = doc.add({ ...base, type: 'circle', c: w, r: 20, color: '#ffff00' }); doc.commit();
R.drawBase(); t = now(); doc.begin(); doc.modify(c1.id, e => { e.c = P(w.x + 30, w.y + 10); }); doc.commit(); frame(); out.tilesEdit = ms(t);
out.diffEdit = compare();
doc.begin(); doc.remove(c1.id); doc.removeMany(app.idx().query({ x1: w.x - 40, y1: w.y - 40, x2: w.x + 40, y2: w.y + 40 }).map(e => e.id)); doc.commit();
out.diffErase = compare();
doc.undo(); out.diffUndo = compare();
app.view.zoomAt(0.5, { x: 600, y: 300 });
out.diffZoom = compare();

// ---- Simplificación de las curvas de nivel según el zoom ----
const pl = doc.model.find(e => e.layer === 'CURVAS');
const rec = { n: 0, moveTo() { this.n++; }, lineTo() { this.n++; }, closePath() {}, getLineDash: () => [] };
E.ENV.onScreen = true;
const segs = sc => { rec.n = 0; E.simplePath(rec, pl.pts, { scale: sc }, false); return rec.n; };
out.simplify = { vertices: pl.pts.length, far: segs(0.002), near: segs(50), export: (E.ENV.onScreen = false, segs(0.002)) };

// ---- Designación grande ----
app.sel = new Set(doc.model.slice(0, 60000).map(e => e.id)); app.selChanged();
t = now(); R.drawOver(); out.overSel = ms(t);
t = now(); R.drawOver(); out.overSelCached = ms(t);
t = now(); await app.run('ERASE'); out.erase60k = ms(t); out.left = doc.model.length;
t = now(); doc.undo(); out.undoErase = ms(t); out.back = doc.model.length;
app.sel.clear(); app.selChanged();

// ---- DXF grande en segundo plano ----
const lines = ['0', 'SECTION', '2', 'ENTITIES'];
for (let i = 0; i < 40000; i++) lines.push('0', 'LINE', '8', 'L' + (i % 5), '10', i % 200, '20', Math.floor(i / 200), '30', 0, '11', i % 200 + 0.5, '21', Math.floor(i / 200) + 0.5, '31', 0);
lines.push('0', 'ENDSEC', '0', 'EOF');
const text = lines.join('\n');
let workers = 0, prog = 0;
const W0 = window.Worker;
window.Worker = class extends W0 { constructor(...a) { super(...a); workers++; } };
const P0 = app.ui.progress.bind(app.ui);
app.ui.progress = title => { const p = P0(title); return { set: f => { prog = Math.max(prog, f); p.set(f); }, done: p.done }; };
t = now(); await app.io.loadFile(new File([text], 'grande.dxf')); out.dxfOpen = ms(t);
window.Worker = W0; app.ui.progress = P0;
out.dxf = { n: doc.model.length, layers: doc.layers.length, workers, progress: prog > 0.5, mb: +(text.length / 1e6).toFixed(1) };
return out;
