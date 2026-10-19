// DXF de la v0.7: MLINE y MLINESTYLE, ACAD_TABLE y TABLESTYLE, ARC_DIMENSION, LARGE_RADIAL_DIMENSION, regiones, matrices,
// delimitaciones (SPATIAL_FILTER) y estados de capa en archivos .las
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, DX = await import('./js/dxf.js'), E = await import('./js/entities.js'), LS = await import('./js/layerstates.js');
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const last = () => doc.model.at(-1);
const r4 = v => +v.toFixed(4);
const count = (s, re) => (s.match(re) || []).length;
app.view.cx = 50; app.view.cy = 0; app.view.scale = 2; app.renderer.invalidate();

doc.begin();
doc.mlineStyles.push({ name: 'TABIQUE', desc: 'Tabique de 10', elems: [{ off: 0.5, color: '#ff0000', ltype: 'BYLAYER' }, { off: 0, color: 'BYLAYER', ltype: 'CENTER' }, { off: -0.5, color: 'BYLAYER', ltype: 'BYLAYER' }], caps: { sLine: true, eLine: false, sOuter: false, eOuter: true, sInner: false, eInner: false }, joints: true, fill: '#336699' });
doc.tableStyles.push({ name: 'Planilla', th: 3, textStyle: 'Standard', margin: 0.5, titleScale: 1.5, align: 'c' });
doc.commit();
await cmd('MLINE', 'S', 'TABIQUE', 'J', 'C', 'E', '10', '0,0', '50,0', '50,40', '');
const ML = last();
await cmd('RECTANG', '100,0', '140,30'); const R = last();
await cmd('CIRCLE', '120,15', '5'); const C = last();
await cmd('REGION', sel([R.id, C.id]));
const [RA, RB] = doc.model.filter(e => e.type === 'region');
await cmd('SUBTRACT', sel([RA.id]), sel([RB.id]));
await cmd('ARC', 'C', '0,100', '30,100', '0,130'); const ARC = last();
await cmd('DIMARC', pick(ARC, { x: 21, y: 121 }), '45,115');
await cmd('CIRCLE', '200,100', '60'); const BIG = last();
await cmd('DIMJOGGED', pick(BIG, { x: 260, y: 100 }), '230,60', '250,130', '235,110');
await cmd('CIRCLE', '0,-60', '3'); const SRC = last();
await cmd('ARRAYRECT', sel([SRC.id]), 'R', '3', '2', '');
const ARR = last();
await cmd('LINE', '0,0', '10,0', ''); const b1 = last();
await cmd('LINE', '0,0', '0,10', ''); const b2 = last();
app.sel.clear(); app.sel.add(b1.id); app.sel.add(b2.id);
await cmd('BLOCK', 'ESQUINA', '0,0');
const pi = app.run('INSERT', 'ESQUINA'); await tick(); app.submit('300,0'); await pi;
const INS = doc.model.filter(e => e.type === 'insert').at(-1);
await cmd('XCLIP', sel([INS.id]), 'N', 'P', '299,-1', '305,-1', '305,5', '');
doc.begin();
const tb = doc.add({ type: 'table', p: { x: 0, y: -100 }, rot: 0, cols: [20, 30], rows: [6, 6, 6], cells: [['Planilla de huecos', ''], ['Tipo', 'Ancho'], ['V1', '1.20']], tstyle: 'Planilla', title: true, header: true });
doc.commit();
out.made = doc.model.map(e => e.type + (e.kind ? ':' + e.kind : ''));

// ---- DXF 2007 ----
const d07 = DX.writeDXF(doc, '2007');
out.s2007 = { mline: count(d07, /\r\nMLINE\r\n/g), mlstyle: count(d07, /\r\nMLINESTYLE\r\n/g), table: count(d07, /\r\nACAD_TABLE\r\n/g), tstyle: count(d07, /\r\nTABLESTYLE\r\n/g),
  arcdim: count(d07, /\r\nARC_DIMENSION\r\n/g), jog: count(d07, /\r\nLARGE_RADIAL_DIMENSION\r\n/g), filter: count(d07, /\r\nSPATIAL_FILTER\r\n/g), xdict: count(d07, /\{ACAD_XDICTIONARY/g), anonU: count(d07, /\r\n\*U\d+\r\n/g) };
const r07 = DX.readDXF(d07);
out.back07 = r07.ents.map(e => e.type + (e.kind ? ':' + e.kind : ''));
const m = r07.ents.find(e => e.type === 'mline'), st = r07.mlineStyles.find(s => s.name === 'TABIQUE');
out.mlBack = { pts: m.pts.length, just: m.just, scale: m.scale, style: m.mlstyle, elems: st.elems.map(x => [x.off, x.color, x.ltype]), caps: st.caps, joints: st.joints, fill: st.fill };
const t = r07.ents.find(e => e.type === 'table'), ts = r07.tableStyles.find(s => s.name === 'Planilla');
out.tblBack = { cols: t.cols, rows: t.rows.map(r4), cells: t.cells, title: t.title, header: t.header, style: t.tstyle, ts: ts && [ts.th, ts.margin, ts.titleScale, ts.align] };
const da = r07.ents.find(e => e.kind === 'arc'), dj = r07.ents.find(e => e.kind === 'jog');
out.arcBack = [r4(da.c.x), r4(da.c.y), r4(E.dimParts({ ...da, style: 'ISO-25' }).val), r4(Math.PI * 15)];
out.jogBack = [r4(dj.p1.x), r4(E.dimParts({ ...dj, style: 'ISO-25' }).val), [r4(dj.p4.x), r4(dj.p4.y)], [r4(dj.p5.x), r4(dj.p5.y)]];
const ib = r07.ents.find(e => e.type === 'insert' && e.name === 'ESQUINA' && e.clip);
out.clipBack = ib?.clip?.pts.map(p => [r4(p.x), r4(p.y)]);
out.regionBack = r07.ents.filter(e => e.type === 'pline' && e.closed).map(e => [e.pts.length, (e.bulges || []).filter(b => b).length]);
out.arrayBack = r07.ents.filter(e => e.type === 'circle').length;
// Abrir el DXF en un documento nuevo (como hace ABRIR)
const io = app.io, f = new File([d07], 'v07.dxf');
await io.loadFile(f);
out.opened = { mlineStyles: doc.mlineStyles.map(s => s.name), tableStyles: doc.tableStyles.map(s => s.name), table: doc.model.filter(e => e.type === 'table').length };
app.renderer.drawBase();

// ---- DXF 2000 y R12: tablas y cotas nuevas descompuestas, líneas múltiples como MLINE (2000) o líneas (R12) ----
await io.loadFile(f);
const d00 = DX.writeDXF(doc, '2000'), d12 = DX.writeDXF(doc, 'R12');
out.s2000 = { mline: count(d00, /\r\nMLINE\r\n/g), table: count(d00, /\r\nACAD_TABLE\r\n/g), arcdim: count(d00, /\r\nARC_DIMENSION\r\n/g), filter: count(d00, /\r\nSPATIAL_FILTER\r\n/g) };
out.sR12 = { mline: count(d12, /\r\nMLINE\r\n/g), lines: count(d12, /\r\nLINE\r\n/g) > 10 };
const r00 = DX.readDXF(d00), r12 = DX.readDXF(d12);
out.back00 = [r00.ents.filter(e => e.type === 'mline').length, r00.ents.some(e => e.type === 'insert' && e.clip), r00.ents.filter(e => e.type === 'dim').length];
out.back12 = r12.ents.length > 20;

// ---- Estados de capa en archivos .las ----
doc.begin();
doc.addLayer('Muros', '#ff0000'); doc.addLayer('Cotas', '#00ff00');
doc.layer('Cotas').lock = true; doc.layer('Muros').lw = 0.5; doc.layer('Muros').ltype = 'DASHED';
LS.saveLayerState(doc, 'Planta', 'Planta general');
doc.layer('Muros').on = false;
LS.saveLayerState(doc, 'Sin muros');
doc.commit();
const las = LS.writeLas(doc, doc.layerStates);
out.las = { states: count(las, /\r\nLAYERSTATE\r\n/g), head: las.split('\r\n').slice(0, 4) };
const back = LS.readLas(las, E.LTYPES);
out.lasBack = back.map(s => ({ name: s.name, desc: s.desc, cur: s.cur, muros: s.layers.Muros, cotas: s.layers.Cotas }));
// Importar con LAYERSTATE (sustituye los estados del mismo nombre)
doc.begin(); doc.layerStates = []; doc.commit();
out.import = await (async () => { await app.run('LAYERSTATE', { las, src: 'prueba.las' }); return doc.layerStates.map(s => s.name); })();
await cmd('-LAYERSTATE', 'R', 'Planta', '');
out.restored = [doc.layer('Muros').on, doc.layer('Muros').ltype, doc.layer('Cotas').lock];
return { ...out, d2007: d07 };
