const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, E = await import('./js/entities.js'), DX = await import('./js/dxf.js');
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const last = () => doc.model[doc.model.length - 1];
// Degradado
await cmd('RECTANG', '0,0', '50,30');
app.view.cx = 25; app.view.cy = 15; app.view.scale = 5; app.renderer.invalidate();
out.grad = await cmd('GRADIENT', '25,15', '');
const gh = doc.model.find(e => e.type === 'hatch');
out.gradEnt = { pattern: gh?.pattern, grad: gh?.grad, assoc: !!gh?.assoc };
app.renderer.drawBase();
out.gradProps = E.propsOf(gh).map(p => p.label);
const svg = app.io.buildSVG().svg;
out.svgGrad = /linearGradient/.test(svg);
const d = DX.writeDXF(doc, '2000');
out.dxfSolid = /\nSOLID\r?\n/.test(d);
// Estilo de directriz
doc.mleaderStyles.push({ ...E.DEFAULT_MLSTYLE, name: 'Grande', h: 5, asz: 4, land: 10 });
doc.cur.mleaderStyle = 'Grande';
let p = app.run('MLEADER'); await tick(); app.submit('C'); await tick(); app.submit('G'); await tick(); app.submit('0,40'); await tick(); app.submit('10,50'); await tick(); app.submit(''); await tick(); app.submit(''); await p;
const ml = last();
out.ml = { mstyle: ml.mstyle, h: ml.h, eff: E.mlEff(ml) };
doc.mleaderStyle('Grande').h = 7;
out.mlAfterStyle = E.mlEff(ml).h;
// Estilo de tabla
doc.tableStyles.push({ ...E.DEFAULT_TBLSTYLE, name: 'T4', th: 4, align: 'c' });
doc.cur.tableStyle = 'T4';
p = app.run('TABLE'); await tick(); app.submit('100,50'); await tick(60); document.querySelector('.modal .btn.primary').click(); await p;
const tb = last();
out.table = { tstyle: tb.tstyle, th: tb.th, eff: E.tblEff(tb).th, H: +E.tableGeom(tb).H.toFixed(2) };
// Campos
doc.name = 'Pieza-7';
await cmd('FIELD', 'Archivo', '0,-20', '3');
const f1 = last();
out.field1 = { text: f1.text, shown: E.mtextLayout(f1).lines[0].str };
await cmd('FIELD', 'Objeto', () => app.req.resolve({ e: doc.model.find(e => e.type === 'pline'), pt: { x: 0, y: 0 } }), 'Área', '1', '0,-30', '3');
const f2 = last();
out.field2 = { text: f2.text, shown: E.mtextLayout(f2).lines[0].str };
doc.begin(); doc.modify(doc.model.find(e => e.type === 'pline').id, e => { e.pts[1] = { x: 60, y: 0 }; e.pts[2] = { x: 60, y: 30 }; }); doc.commit();
out.field2after = E.mtextLayout(doc.get(f2.id)).lines[0].str;
out.date = E.fieldText('%<Fecha:yyyy>%') === String(new Date().getFullYear());
// cajetín con campos en una presentación
await cmd('LAYOUT', 'Nueva', 'Plano A');
const caj = doc.layouts[0].ents.find(e => e.type === 'insert');
E.ENV.layout = doc.layouts[0];
out.cajetin = E.insertAttribs(caj).map(a => [a.tag, a.value, E.fieldText(a.value)]);
E.ENV.layout = null;
const d2 = DX.writeDXF(doc, '2000');
out.dxfField = d2.includes('Plano A') && !d2.includes('%<Presentación>%');
// JSON
const j = doc.toJSON();
out.json = { v: j.version, ml: j.mleaderStyles.length, ts: j.tableStyles.length };
return out;
