// Novedades de la v0.12 (2): escalas anotativas. Lista de escalas (SCALELISTEDIT), escala actual (CANNOSCALE) y la de cada
// ventana gráfica, estilos y objetos anotativos (textos, cotas, directrices, sombreados y bloques) con una representación
// por escala, OBJECTSCALE, ANNOALLVISIBLE, ANNOAUTOSCALE y su paso por SVG, DXF y .tcad
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const r4 = v => +(+v).toFixed(4);
const base = { layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' };
const last = () => doc.model[doc.model.length - 1];
const E = await import('./js/entities.js'), AN = await import('./js/annoscale.js'), DXF = await import('./js/dxf.js');
const prop = (e, label) => E.propsOf(e).find(p => p.label === label);
const hOf = e => { const b = E.bboxOf(e); return r4(b.y2 - b.y1); };
app.view.cx = 100; app.view.cy = 50; app.view.scale = 1; app.renderer.invalidate();

// ---- Lista de escalas ----
out.defaults = AN.scalesOf(doc).length;
out.parse = [AN.parseScale('1:500'), AN.parseScale('250'), AN.parseScale('2:1'), AN.parseScale('x')];
await cmd('SCALELISTEDIT', 'A', '1:750', '1', '750', 'S');
out.added = !!AN.findScale(doc, '1:750');
await cmd('SCALELISTEDIT', 'S', '1:750', 'S');
out.removed = !AN.findScale(doc, '1:750');
await cmd('SCALELISTEDIT', 'S', '1:1', 'S'); // la actual: no se suprime
out.keepCurrent = !!AN.findScale(doc, '1:1');

// ---- Estilo de texto anotativo: los textos nuevos son anotativos con la escala actual ----
await cmd('CANNOSCALE', '1:100');
out.cannoscale = doc.settings.cannoscale;
doc.textStyles[0].annotative = true;
await cmd('TEXT', '0,0', '2.5', '0', 'Eje 1', '');
const t = last();
out.text = { anno: [...t.anno], h: t.h, shown: hOf(t) > 200 }; // 2,5 mm de papel → 250 unidades a 1:100
doc.textStyles[0].annotative = false;
// Con otra escala que el texto no tiene: se dibuja con la suya (atenuado) o se oculta (ANNOALLVISIBLE = 0)
await cmd('CANNOSCALE', '1:50');
out.otherScale = { off: !!AN.annoEff(t)._annoOff, visible: doc.visible(t), h: hOf(t) > 200 };
await cmd('ANNOALLVISIBLE', '0');
out.hidden = !doc.visible(t);
await cmd('ANNOALLVISIBLE', '1');
// AIOBJECTSCALEADD: añade la actual (1:50) y el texto se ve a 1:50
await cmd('AIOBJECTSCALEADD', sel([t.id]));
const t50 = doc.get(t.id);
out.added50 = { anno: [...t50.anno], off: !!AN.annoEff(t50)._annoOff, ratio: r4(hOf(t50) / hOf({ ...t50, anno: undefined, h: 2.5 * 50 })) };
// OBJECTSCALE Suprimir: 1:100 se quita; la última no se puede quitar
await cmd('OBJECTSCALE', sel([t.id]), 'S', '1:100');
out.remove100 = [...doc.get(t.id).anno];
await cmd('OBJECTSCALE', sel([t.id]), 'S', '1:50');
out.keepLast = [...doc.get(t.id).anno];

// ---- Propiedad Anotativo: conserva el tamaño en pantalla ----
doc.begin();
const tx = doc.add({ ...base, type: 'text', p: P(0, -50), h: 100, rot: 0, text: 'Planta', align: 'l', style: 'Standard' });
const hat = doc.add({ ...base, type: 'hatch', pattern: 'ANSI31', scale: 50, angle: 0, loops: [[P(0, -200), P(100, -200), P(100, -150), P(0, -150)]] });
doc.commit();
const h0 = hOf(tx);
doc.begin(); doc.modify(tx.id, e => prop(e, 'Anotativo').set(e, true)); doc.modify(hat.id, e => prop(e, 'Anotativo').set(e, true)); doc.commit();
const tx2 = doc.get(tx.id), hat2 = doc.get(hat.id);
out.toggleOn = { h: tx2.h, anno: tx2.anno, same: r4(hOf(tx2) - h0), hatchScale: hat2.scale, effScale: AN.annoEff(hat2).scale, scales: prop(tx2, 'Escalas de anotación').get(tx2) };
doc.begin(); doc.modify(tx.id, e => prop(e, 'Anotativo').set(e, false)); doc.commit();
out.toggleOff = { h: doc.get(tx.id).h, anno: doc.get(tx.id).anno ?? null };

// ---- Cotas y directrices: los tamaños del estilo son del papel ----
await cmd('CANNOSCALE', '1:100');
doc.dimStyles[0].annotative = true;
await cmd('DIMLINEAR', '0,100', '3000,100', '1500,600');
const dm = last();
out.dim = { anno: [...dm.anno], scale: AN.annoEff(dm).ov.scale, txt: E.dimStyleOf(AN.annoEff(dm)).txt };
doc.dimStyles[0].annotative = false;
doc.mleaderStyles[0].annotative = true;
doc.begin(); const ml = doc.add(app.annoNew({ ...base, type: 'mleader', pts: [P(0, 0), P(500, 500)], content: 'mtext', text: 'Alcantarilla', mstyle: doc.mleaderStyles[0].name })); doc.commit();
out.mleader = { anno: [...ml.anno], h: r4(AN.annoEff(ml).h / E.mlEff(ml).h) };
doc.mleaderStyles[0].annotative = false;

// ---- Ventanas gráficas: cada una con su escala ----
doc.begin();
const lay = doc.addLayout('Lamina', 'A3');
lay.ents.push({ ...base, id: doc.nextId++, type: 'vport', p1: P(10, 10), p2: P(200, 280), cx: 0, cy: 0, s: 0.01 });
lay.ents.push({ ...base, id: doc.nextId++, type: 'vport', p1: P(210, 10), p2: P(410, 280), cx: 0, cy: 0, s: 0.02 });
doc.reindex(); doc.commit();
const [vp1, vp2] = lay.ents;
out.vpScales = [AN.vpScale(doc, vp1), AN.vpScale(doc, vp2), AN.vpScale(doc, { s: 1 / 333 })];
app.switchTab(doc.layouts.indexOf(lay)); await tick(20);
app.mspace(vp2);
out.inVp = { cur: AN.curScale().name, status: document.querySelector('.sb-anno').value };
// CANNOSCALE dentro de la ventana cambia su escala
await cmd('CANNOSCALE', '1:200');
out.vpCanno = { s: doc.get(vp2.id).s, cur: AN.curScale().name };
app.pspace();
out.paper = { cur: AN.curScale().name, disabled: document.querySelector('.sb-anno').disabled };
// SVG de la lámina: el texto anotativo (2,5 mm en el papel) se escribe con la escala de cada ventana
doc.begin(); doc.modify(t.id, e => { e.anno = ['1:100', '1:200']; }); doc.commit();
const svg = app.io.buildSVG().svg;
out.svgTexts = (svg.match(/>Eje 1</g) || []).length;
// ANNOAUTOSCALE: al cambiar la escala se añade a los anotativos
app.switchTab('model');
await cmd('ANNOAUTOSCALE', '1');
await cmd('CANNOSCALE', '1:250');
out.autoscale = [...doc.get(t.id).anno];
await cmd('ANNOAUTOSCALE', '0');
// DXF: se escribe la representación de CANNOSCALE (2,5 × 250)
const rd = DXF.readDXF(DXF.writeDXF(doc, '2007'));
out.dxfH = r4(rd.ents.find(e => e.type === 'text' && e.text === 'Eje 1').h);
// .tcad: lista de escalas y objetos anotativos
const saved = JSON.parse(JSON.stringify(doc.toJSON()));
doc.fromJSON(saved); app.afterLoad();
out.tcad = { anno: [...doc.model.find(e => e.text === 'Eje 1').anno], cannoscale: doc.settings.cannoscale, scales: doc.scales.length };
// Deshacer devuelve las escalas
const n0 = doc.get(doc.model.find(e => e.text === 'Eje 1').id).anno.length;
await cmd('OBJECTSCALE', sel([doc.model.find(e => e.text === 'Eje 1').id]), 'A', '1:500');
doc.undo(); app.afterUndo();
out.undo = doc.model.find(e => e.text === 'Eje 1').anno.length === n0;
return out;
