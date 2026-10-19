const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, P = (x, y) => ({ x, y }), B = String.fromCharCode(92);
const S = await import('./js/spline.js'), OPS = await import('./js/ops.js'), H = await import('./js/hatch.js');
doc.name = 'Placa-soporte';
doc.begin();
doc.addLayer('Contorno', '#ffffff'); doc.layer('Contorno').lw = 0.5;
doc.addLayer('Ejes', '#ff5555'); doc.layer('Ejes').ltype = 'CENTER';
doc.addLayer('Cotas', '#4fc3f7');
doc.addLayer('Sombreado', '#8bc34a');
doc.addLayer('Textos', '#ffd54f');
const add = (layer, e) => doc.add({ layer, color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', ...e });
const outline = add('Contorno', { type: 'pline', closed: true, pts: [P(0, 0), P(160, 0), P(160, 70), P(120, 100), P(0, 100)] });
const f = OPS.filletPline(outline, 8).ent; outline.pts = f.pts; outline.bulges = f.bulges;
const spl = { type: 'spline', fit: [P(30, 100), P(45, 82), P(65, 88), P(80, 100)], closed: false };
S.rebuild(spl); add('Contorno', spl);
const holes = [[P(30, 35), 12], [P(130, 30), 9], [P(90, 45), 6]].map(([c, r]) => add('Contorno', { type: 'circle', c, r }));
for (const h of holes) {
  add('Ejes', { type: 'line', p1: P(h.c.x - h.r - 4, h.c.y), p2: P(h.c.x + h.r + 4, h.c.y) });
  add('Ejes', { type: 'line', p1: P(h.c.x, h.c.y - h.r - 4), p2: P(h.c.x, h.c.y + h.r + 4) });
}
const sec = add('Contorno', { type: 'pline', closed: true, pts: [P(200, 0), P(212, 0), P(212, 100), P(200, 100)] });
const loops = H.findBoundary([sec], P(206, 50));
add('Sombreado', { type: 'hatch', loops: [...loops], pattern: 'ANSI31', scale: 0.8, angle: 0, assoc: loops.ids, seed: P(206, 50) });
// Cotas asociativas (punto final de la polilínea y objetos)
const end = i => ({ id: outline.id, snap: 'end', i });
const ip = i => outline.pts[i];
const dim = (e, assoc) => add('Cotas', { type: 'dim', style: 'ISO-25', ...e, ...(assoc ? { assoc } : {}) });
const n = outline.pts.length;
// vértices: tras el empalme la polilínea tiene puntos de tangencia; se usan los extremos inferiores
const bl = outline.pts.findIndex(p => Math.abs(p.y) < 1e-9), br = outline.pts.findIndex((p, i) => i !== bl && Math.abs(p.y) < 1e-9);
dim({ kind: 'lin', p1: ip(bl), p2: ip(br), p3: P(80, -16), rot: 0 }, { p1: end(bl), p2: end(br) });
dim({ kind: 'lin', p1: P(0, 8), p2: P(0, 92), p3: P(-16, 50), rot: Math.PI / 2 });
dim({ kind: 'dia', p1: holes[0].c, p2: P(30 + 12 * Math.cos(0.8), 35 + 12 * Math.sin(0.8)), p3: P(56, 64) }, { obj: holes[0].id });
dim({ kind: 'rad', p1: holes[1].c, p2: P(130 + 9 * Math.cos(-0.6), 30 + 9 * Math.sin(-0.6)), p3: P(150, 12) }, { obj: holes[1].id });
dim({ kind: 'ord', p1: holes[2].c, p2: holes[2].c, p3: P(91, -32), axis: 'x' }, { p1: { id: holes[2].id, snap: 'cen', i: 0 } });
dim({ kind: 'lin', p1: P(200, 100), p2: P(212, 100), p3: P(206, 110), rot: 0 }, { p1: { id: sec.id, snap: 'end', i: 3 }, p2: { id: sec.id, snap: 'end', i: 2 } });
// Directrices: globos y nota
const ml = (pts, content, text, extra = {}) => add('Textos', { type: 'mleader', pts, content, text, h: 3, asz: 2.5, arrow: 'closed', land: 6, gap: 1.5, w: 0, style: 'Standard', ...extra });
ml([P(36, 44), P(52, 120)], 'block', '1');
ml([P(136, 37), P(150, 120)], 'block', '2');
ml([P(204, 60), P(232, 78)], 'mtext', `Sección {${B}fArial|b1|i0;A-A}` + '\n' + `{${B}H2.5;espesor 12 mm}`, { rich: true });
// Notas con formato
add('Textos', { type: 'mtext', p: P(0, -48), w: 150, h: 3, rot: 0, attach: 'tl', rich: true,
  text: `{${B}fArial|b1|i0;${B}LNOTAS${B}l}` + '\n' + `1. Material: acero {${B}C3;S275JR}, espesor 12 mm.` + '\n' + `2. Aristas matadas 0,5 × 45°. Tolerancia general ISO 2768-m.` + '\n' + `3. Taladros {${B}fArial|b0|i1;pasantes}, ajuste {${B}S+0.1^-0;}` });
// Tabla de piezas
add('Textos', { type: 'table', p: P(240, 20), rot: 0, cols: [12, 46, 18], rows: [7, 6, 6, 6], th: 2.8, title: true, header: true, style: 'Standard',
  cells: [['LISTA DE PIEZAS', '', ''], ['Pos.', 'Descripción', 'Cant.'], ['1', 'Placa soporte S275JR, 12 mm', '1'], ['2', 'Casquillo de bronce Ø18', '2']] });
doc.commit();
// La sección se ensancha: la cota asociativa y el sombreado se actualizan
doc.begin(); doc.modify(sec.id, e => { e.pts[1] = P(216, 0); e.pts[2] = P(216, 100); }); doc.commit();
app.zoomExtents(); app.view.zoomAt(0.93, { x: app.view.w / 2, y: app.view.h / 2 });

{ const pl = app.run('LAYOUT', 'Nueva'); await tick(30); app.submit(''); await pl; }
doc.model.push(...[]);
// degradado en el modelo
doc.begin(); doc.add({ type: 'hatch', layer: 'Sombreado', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', pattern: 'GRADIENT', grad: { type: 'SPHERICAL', c1: '#1e90d6', c2: '#ffffff', centered: true }, angle: 0, scale: 1, loops: [[P(260, -40), P(300, -40), P(300, -10), P(260, -10)]] }); doc.commit();
const PDF = await import('./js/pdf.js');
const pages = await app.io.buildPDF('all');
const model = (app.switchTab('model'), await app.io.buildPDF('current'));
const blob = await PDF.buildPdf([...pages, ...model], 'demo');
const buf = new Uint8Array(await blob.arrayBuffer());
let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
return { pages: pages.length + model.length, size: buf.length, fonts: [...new Set([...pages, ...model].flatMap(p => [...p.ctx.fonts]))], pdf: btoa(bin) };
