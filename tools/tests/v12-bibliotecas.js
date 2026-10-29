// Novedades de la v0.12 (4): biblioteca de bloques viales (señales anotativas con estados de visibilidad y atributos,
// alcantarillas con parámetros y tabla de medidas, defensas, cordones y cunetas), LIBINSERT y LIBUNITS, paleta de
// herramientas (clic, soltar en el dibujo, herramientas desde la designación) y DesignCenter (otros dibujos)
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const r4 = v => +(+v).toFixed(4);
const last = () => doc.model[doc.model.length - 1];
const E = await import('./js/entities.js'), L = await import('./js/library.js'), TP = await import('./js/toolpalettes.js'), DY = await import('./js/dynblock.js'), AN = await import('./js/annoscale.js');
const bbH = e => { const b = E.bboxOf(e); return r4(b.y2 - b.y1); };
app.view.cx = 0; app.view.cy = 0; app.view.scale = 0.5; app.renderer.invalidate();

// ---- Catálogo: todas las definiciones son válidas ----
out.catalog = L.LIB_CATS.map(c => `${c}: ${L.LIBRARY.filter(l => l.cat === c).length}`);
out.allValid = L.LIBRARY.every(it => { const b = L.libBlock(it); return b.ents.every(e => E.TYPES[e.type]) && b.ents.length > 2; });

// ---- Señal reglamentaria: anotativa, con estados de visibilidad y atributos ----
await cmd('CANNOSCALE', '1:500');
await cmd('LIBINSERT', 'TC_SEÑAL_REGLAMENTARIA', '100,50', 'R-15', '2+350', 'Derecho', '80');
const sg = last();
const bdef = doc.blocks.TC_SEÑAL_REGLAMENTARIA;
out.sign = { anno: sg.anno, blockAnno: bdef.annotative, attribs: sg.attribs, states: bdef.dyn.vis.states.length, h: bbH(sg) > 1000 * 0.9 * 12 / 12 };
// a 1:500 la señal de ~12 mm del papel mide ~6 m en el modelo
out.signModelH = r4(bbH(sg) / 500);
// otro estado de visibilidad: la geometría cambia
const n1 = E.blockEnts(sg).map(x => x.type).join();
doc.begin(); doc.modify(sg.id, e => { e.dyn = { ...e.dyn, vis: 'Prohibido el paso' }; }); doc.commit();
out.signVis = { before: n1, after: E.blockEnts(doc.get(sg.id)).map(x => x.type).join() };
// ---- Planos tipo a escala real: LIBUNITS ----
await cmd('LIBUNITS', 'MI');
await cmd('LIBINSERT', 'TC_ALCANTARILLA_CAJON', '0,0', '', '');
const bx = last();
out.boxScale = bx.sx;
await cmd('LIBUNITS', 'ME');
await cmd('LIBINSERT', 'TC_ALCANTARILLA_CAJON', '10,0', '', '');
const bx2 = last(), bw0 = (() => { const b = E.bboxOf(bx2); return r4(b.x2 - b.x1); })();
// tabla de medidas: 3,00 × 2,00 m
const B = doc.blocks.TC_ALCANTARILLA_CAJON, row = B.dyn.look.rows.find(r => r.label.startsWith('3'));
doc.begin(); doc.modify(bx2.id, e => DY.applyLookupRow(B, e, row)); doc.commit();
const b2 = E.bboxOf(doc.get(bx2.id));
out.boxLookup = { before: bw0, after: r4(b2.x2 - b2.x1), h: r4(b2.y2 - b2.y1), row: DY.lookupRow(B, doc.get(bx2.id))?.label };
// cuneta trapezoidal: el fondo se ensancha con el parámetro
await cmd('LIBINSERT', 'TC_CUNETA_TRAPEZOIDAL', '30,0', '');
const cu = last(), w0 = (() => { const b = E.bboxOf(cu); return r4(b.x2 - b.x1); })();
doc.begin(); doc.modify(cu.id, e => { e.dyn = { len: { Fondo: 1.5 } }; }); doc.commit();
const cb = E.bboxOf(doc.get(cu.id));
out.ditch = { before: w0, after: r4(cb.x2 - cb.x1) };
// lista por la línea de órdenes
await cmd('LIBINSERT', '?', 'TC_DEFENSA_PLANTA_4M', '50,0');
out.guardrail = last().name;

// ---- Paleta de herramientas ----
app.ui.showPalette('tools'); await tick(30);
out.palettes = TP.defaultPalettes().map(p => `${p.name} (${p.tools.length})`);
out.toolButtons = document.querySelectorAll('.tp-tool').length;
// herramienta de bloque con capa, estado de visibilidad: se suelta en un punto
const t = TP.defaultPalettes()[0].tools.find(x => x.vis === 'Curva a la derecha');
await app.ui.runTool(t, P(200, 100)); await tick(20);
const ins = last();
out.toolDrop = { name: ins.name, layer: ins.layer, vis: ins.dyn?.vis, p: [ins.p.x, ins.p.y], layerExists: !!doc.layers.find(l => l.name === 'SEÑALIZACION') };
// clic en la herramienta: pide el punto
const pr = app.ui.runTool(TP.defaultPalettes()[1].tools[0]); await tick(20);
out.toolPrompt = app.req?.prompt?.slice(0, 30);
app.submit('300,0'); await tick(10); app.submit(''); await tick(10); app.submit(''); await tick(10);
await pr;
out.toolClick = last().name;
// herramienta de sombreado: patrón, escala y capa
const th = TP.defaultPalettes().find(p => p.name === 'Sombreados').tools[0];
doc.begin(); doc.add({ layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', type: 'pline', pts: [P(-100, -100), P(-50, -100), P(-50, -60), P(-100, -60)], closed: true }); doc.commit();
app.view.cx = -75; app.view.cy = -80; app.view.scale = 4; app.renderer.invalidate(); await tick(30);
const curLayer = doc.cur.layer;
await app.ui.runTool(th, P(-75, -80)); await tick(30);
if (app.req) { app.submit(''); await tick(20); }
const ht = doc.model.filter(e => e.type === 'hatch').at(-1);
out.toolHatch = ht ? { pattern: ht.pattern, scale: ht.scale, layer: ht.layer, restored: doc.cur.layer === curLayer } : null;
// herramientas desde la designación
app.sel.clear(); app.sel.add(ins.id); if (ht) app.sel.add(ht.id);
const before = app.ui.palettes[0].tools.length;
[...document.querySelectorAll('.tp-bar .btn')][0].click(); await tick(20);
out.fromSel = app.ui.palettes[0].tools.length - before;
out.fromSelTool = TP.toolFromEntity(ins);
app.ui.palettes = TP.resetPalettes(); app.ui._toolsVer = 99;

// ---- DesignCenter: bloques, capas y estilos de otro dibujo ----
const other = { name: 'otro.tcad', blocks: { CARTEL: { name: 'CARTEL', base: P(0, 0), ents: [{ layer: 'CARTELES', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', type: 'circle', c: P(0, 0), r: 2 }, { layer: '0', color: 'BYBLOCK', ltype: 'BYBLOCK', lw: 'BYBLOCK', type: 'text', p: P(0, 0), h: 1, rot: 0, text: 'A', align: 'c', style: 'Rotulos' }] } },
  layers: [{ name: '0', color: '#ffffff', on: true, lock: false, ltype: 'CONTINUOUS', lw: 'DEFAULT' }, { name: 'CARTELES', color: '#00ff00', on: true, lock: false, ltype: 'CONTINUOUS', lw: 'DEFAULT' }, { name: 'EJES', color: '#ff0000', on: true, lock: false, ltype: 'CENTER', lw: 'DEFAULT' }],
  textStyles: [{ name: 'Rotulos', font: 'Arial', width: 0.8, oblique: 0 }], dimStyles: [], mleaderStyles: [], tableStyles: [], mlineStyles: [] };
app.ui.dcSources = [{ name: 'otro.tcad', data: other }]; app.ui.dcSrc = 'otro.tcad';
const pDC = app.run('ADCENTER'); await tick(30);
out.dcOpen = { sources: document.querySelectorAll('.dc-src .dc-row').length, blocks: document.querySelectorAll('.dc-items .swatch-btn').length };
// capas: elegir EJES y añadir
[...document.querySelectorAll('.dc-kinds .dc-row')].find(r => r.textContent.startsWith('Capas')).click(); await tick(10);
[...document.querySelectorAll('.dc-items .dc-row')].find(r => r.textContent.startsWith('EJES')).click();
[...document.querySelectorAll('#modal-root .modal-foot .btn')].find(b => b.textContent === 'Añadir al dibujo').click(); await tick(30);
out.dcLayer = !!doc.layers.find(l => l.name === 'EJES');
// bloque: doble clic inserta (con su capa y su estilo de texto)
[...document.querySelectorAll('.dc-kinds .dc-row')].find(r => r.textContent.startsWith('Bloques')).click(); await tick(10);
document.querySelector('.dc-items .swatch-btn').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await tick(30);
out.dcPrompt = app.req?.prompt?.slice(0, 30);
app.submit('400,0'); await tick(10);
await pDC;
out.dcInsert = { name: last().name, layerCopied: !!doc.layers.find(l => l.name === 'CARTELES'), styleCopied: !!doc.textStyles.find(s => s.name === 'Rotulos') };
// biblioteca en el DesignCenter
app.ui.dcSrc = 'lib';
const pDC2 = app.run('ADCENTER'); await tick(30);
out.dcLib = document.querySelectorAll('.dc-items .swatch-btn').length;
document.querySelector('#modal-root .modal-head .ib').click(); await tick(10);
await pDC2;
// .tcad conserva los bloques de la biblioteca con sus parámetros
const saved = JSON.parse(JSON.stringify(doc.toJSON()));
doc.fromJSON(saved); app.afterLoad();
out.tcad = { box: !!doc.blocks.TC_ALCANTARILLA_CAJON?.dyn?.look, sign: doc.blocks.TC_SEÑAL_REGLAMENTARIA?.annotative };
return out;
