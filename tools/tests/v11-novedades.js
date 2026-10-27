// Novedades de la v0.11: SCP (UCS) con nombre, por tres puntos y por objeto, entrada de coordenadas y ayudas en el SCP,
// vistas con nombre, ventanas en mosaico del modelo (VPORTS), QSELECT, FILTER, FIND, OVERKILL, AUDIT y herramientas de
// capas (LAYISO, LAYUNISO, LAYWALK, LAYMRG y filtros de capa), con su paso por DXF y .tcad
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const pick = (ent, pt) => async () => { await tick(); app.req.resolve({ e: ent, pt }); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const r4 = v => +(+v).toFixed(4);
const pt = p => [r4(p.x), r4(p.y)];
const base = { layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' };
const add = e => { doc.begin(); const x = doc.add({ ...base, ...e }); doc.commit(); return x; };
const last = () => doc.model[doc.model.length - 1];
const U = await import('./js/ucs.js'), DXF = await import('./js/dxf.js'), LT = await import('./js/layertools.js'), SL = await import('./js/select.js');
app.view.cx = 50; app.view.cy = 50; app.view.scale = 4; app.renderer.invalidate();

// ---- SCP: tres puntos, coordenadas escritas en el SCP y en el universal (*) ----
out.ucs3p = await cmd('UCS', '3', '100,50', '110,60', '');
out.ucsNow = { o: pt(doc.ucs.o), ang: r4(doc.ucs.ang * 180 / Math.PI) };
await cmd('LINE', '0,0', '10,0', '');
const l1 = last();
out.lineUcs = { p1: pt(l1.p1), p2: pt(l1.p2) }; // de (100,50) a 45°
await cmd('LINE', '*0,0', '@10<90', '');
const l2 = last();
out.lineWcs = { p1: pt(l2.p1), p2: pt(l2.p2) }; // relativa polar: 90° del SCP = 135° universal
await cmd('LINE', '0,0', '@5,5', '');
out.lineRel = pt(last().p2);
app.updateMouse(); app.ui.updateCoords(P(100, 50 + Math.SQRT2 * 5));
out.coords = document.querySelector('.sb-coords').textContent;
// ORTO y FORZC siguen los ejes del SCP
app.T.ortho = true; app.T.polar = false; app.T.osnap = false; app.T.otrack = false;
const snapR = app.snapper.resolve({ w: P(100 + 10, 50 + 1), sx: 0, sy: 0 }, P(100, 50), true);
out.ortho = pt(snapR.pt);
app.T.ortho = false; app.T.snap = true; doc.settings.snapX = 10;
out.gridSnap = pt(app.snapper.resolve({ w: P(100 + 6.5, 50 + 7.6), sx: 0, sy: 0 }, null, true).pt);
app.T.snap = false; app.T.polar = true;
// SCP con nombre, universal, previo
out.save = await cmd('UCS', 'N', 'G', 'Diagonal');
out.world = await cmd('UCS', 'U');
out.afterWorld = doc.ucs;
out.restore = await cmd('UCS', 'N', 'R', 'diagonal');
out.restored = { name: doc.ucs?.name, ang: r4(doc.ucs.ang * 180 / Math.PI) };
await cmd('UCS', 'Z', '45');
out.rotZ = r4(doc.ucs.ang * 180 / Math.PI);
await cmd('UCS', 'P');
out.prev = r4(doc.ucs.ang * 180 / Math.PI);
// Alineado con un objeto: línea (origen en el extremo cercano) y círculo
const ln = add({ type: 'line', p1: P(0, 0), p2: P(0, 20) });
await cmd('UCS', 'OB', pick(ln, P(0, 18)));
out.ucsObjLine = { o: pt(doc.ucs.o), ang: r4(doc.ucs.ang * 180 / Math.PI) };
const ci = add({ type: 'circle', c: P(30, 30), r: 5 });
await cmd('UCS', 'OB', pick(ci, P(30, 36)));
out.ucsObjCircle = { o: pt(doc.ucs.o), ang: r4(doc.ucs.ang * 180 / Math.PI) };
await cmd('ID', '0,0');
out.id = [...document.querySelectorAll('#cmd-history .hl')].at(-1).textContent;
doc.undo(); app.afterUndo();
out.undoUcs = pt(doc.ucs.o);
await cmd('UCS', '');
out.enterWorld = doc.ucs;

// ---- Vistas con nombre ----
app.view.cx = 10; app.view.cy = 20; app.view.scale = 2;
await cmd('UCS', 'N', 'R', 'Diagonal');
await app.run('VIEW', { save: 'Detalle', ucs: true, layers: true });
await cmd('UCS', 'U');
app.view.cx = 500; app.view.cy = 500; app.view.scale = 10;
await app.run('VIEW', { restore: 'detalle' });
out.viewRestored = { cx: r4(app.view.cx), cy: r4(app.view.cy), scale: r4(app.view.scale), ucs: doc.ucs?.name, saved: doc.views.length };
out.viewList = await cmd('-VIEW', 'Ventana', 'Planta', '0,0', '100,50');
out.views = doc.views.map(v => [v.name, v.space, r4(v.w), r4(v.h), !!v.ucs, !!v.layers]);
out.viewDel = await cmd('-VIEW', 'B', 'Planta');
out.viewCount = doc.views.length;

// ---- Ventanas en mosaico ----
await cmd('UCS', 'U');
const v0 = { cx: app.view.cx, cy: app.view.cy };
out.vp4 = await cmd('VPORTS', '4');
out.tiles4 = app.tiles.map(t => [t.r.x1, t.r.y1, t.r.x2, t.r.y2, t.view === app.view]);
out.tilesSize = app.tiles.map(t => [t.view.ox, t.view.oy, t.view.w, t.view.h]);
out.tilesSameView = app.tiles.every(t => r4(t.view.cx) === r4(v0.cx));
app.setActiveTile(app.tiles[3]);
app.view.cx += 100; // cada ventana con su propia vista
out.independent = app.tiles.map(t => r4(t.view.cx));
out.join = await cmd('VPORTS', 'U', 'Izquierda'); // la activa (abajo a la derecha) con la de su izquierda
out.tilesJoin = app.tiles.map(t => [t.r.x1, t.r.y1, t.r.x2, t.r.y2]);
out.vp3 = await cmd('VPORTS', '3', 'R'); // la activa (abajo, ancha) en tres: dos a la izquierda y una a la derecha
out.tiles3 = app.tiles.length;
out.cfgSave = await cmd('VPORTS', 'G', 'Cinco');
out.single = await cmd('VPORTS', 'UN');
out.tiles1 = app.tiles.length;
out.cfgRestore = await cmd('VPORTS', 'R', 'Cinco');
out.tilesCfg = app.tiles.length;
await tick(30);
out.render = { ok: !!app.modelTiles(), state: app.tilesState()?.tiles.length };
const json = JSON.parse(JSON.stringify(doc.toJSON()));
out.tcadTiles = json.tiles?.tiles.length;
await cmd('VPORTS', 'UN');
// En una presentación: varias ventanas gráficas de una vez
app.createLayout('Hoja');
const nvp0 = doc.layouts[0].ents.filter(e => e.type === 'vport').length;
await app.run('VPORTS', { n: 3, dir: 'deRecha', rect: { x1: 20, y1: 40, x2: 280, y2: 200 } });
out.paperVp = doc.layouts[0].ents.filter(e => e.type === 'vport').length - nvp0;
app.switchTab('model');

// ---- QSELECT y FILTER ----
doc.begin();
const lay = n => doc.ensureLayer(n, '#ffffff');
lay('EJE'); lay('BORDE'); lay('COTAS');
const qs = [
  doc.add({ ...base, type: 'circle', c: P(200, 0), r: 3, layer: 'EJE' }),
  doc.add({ ...base, type: 'circle', c: P(210, 0), r: 8, layer: 'EJE', color: '#ff0000' }),
  doc.add({ ...base, type: 'circle', c: P(220, 0), r: 12, layer: 'BORDE' }),
  doc.add({ ...base, type: 'line', p1: P(200, 10), p2: P(260, 10), layer: 'BORDE', color: '#ff0000' }),
  doc.add({ ...base, type: 'text', p: P(200, 20), h: 2.5, rot: 0, text: 'PK 0+100', layer: 'COTAS' }),
];
doc.commit();
const ids = sel => [...app.sel].filter(id => qs.some(e => e.id === id)).map(id => qs.findIndex(e => e.id === id)).sort();
await app.run('QSELECT', { type: 'circle', prop: 'Radio', op: '>', value: '5' });
out.qsRadius = ids();
await app.run('QSELECT', { type: '*', prop: 'Color', op: '=', value: 'rojo' });
out.qsColor = ids();
await app.run('QSELECT', { type: '*', prop: 'Capa', op: '*', value: 'B*' });
out.qsWild = ids();
await app.run('QSELECT', { type: 'circle', prop: 'Capa', op: '=', value: 'EJE', exclude: true });
out.qsExclude = ids();
await app.run('QSELECT', { type: 'text', prop: 'Contenido', op: '*', value: 'PK*', append: true });
out.qsAppend = ids();
app.clearSel();
await app.run('FILTER', { all: true, filter: { join: 'and', conds: [{ type: 'circle', prop: 'Radio', op: '>=', value: '8' }, { type: '*', prop: 'Capa', op: '=', value: 'BORDE', not: true }] } });
out.filterAnd = ids();
await app.run('FILTER', { all: true, filter: { join: 'or', conds: [{ type: 'line', prop: 'Longitud', op: '=', value: '60' }, { type: 'text', prop: 'Altura', op: '<', value: '3' }] } });
out.filterOr = ids();
doc.begin(); doc.selFilters.push({ name: 'Rojos', join: 'and', conds: [{ type: '*', prop: 'Color', op: '=', value: '1' }] }); doc.commit();
await app.run('FILTER', { all: true, name: 'rojos' });
out.filterNamed = ids();
out.condText = SL.condText({ type: 'circle', prop: 'Radio', op: '>', value: 5, not: true });
app.clearSel();

// ---- FIND: buscar y reemplazar ----
doc.begin();
const t1 = doc.add({ ...base, type: 'text', p: P(0, -50), h: 2.5, rot: 0, text: 'Calle Mayor' });
const t2 = doc.add({ ...base, type: 'mtext', p: P(0, -60), h: 2.5, w: 40, rot: 0, text: 'calle principal\nCALLES' });
const dm = doc.add({ ...base, type: 'dim', style: 'ISO-25', kind: 'lin', p1: P(0, -80), p2: P(30, -80), p3: P(15, -75), rot: 0, text: 'Calle <>' });
doc.defineBlock('ROT', P(0, 0), [{ ...base, type: 'attdef', p: P(0, 0), h: 2, rot: 0, tag: 'NOMBRE', prompt: 'Nombre', def: 'calle' }]);
const ins = doc.add({ ...base, type: 'insert', name: 'ROT', p: P(50, -50), sx: 1, sy: 1, rot: 0, attribs: { NOMBRE: 'Calle Real' } });
const tb = doc.add({ ...base, type: 'table', p: P(80, -40), rot: 0, cols: [30, 30], rows: [8, 8], cells: [['Calle', 'Ancho'], ['calle 1', '7']] });
doc.commit();
await app.run('FIND', { find: 'calle', where: 'space' });
out.findAll = app.sel.size;
await app.run('FIND', { find: 'calle', where: 'space', opts: { matchCase: true } });
out.findCase = [...app.sel].length;
await app.run('FIND', { find: 'calle', where: 'space', opts: { whole: true } });
out.findWhole = [...app.sel].length; // «CALLES» no cuenta como palabra completa
await app.run('FIND', { find: 'C?lle*', where: 'space', opts: { wild: true }, kinds: ['text'] });
out.findWild = [...app.sel].length;
await app.run('FIND', { find: 'calle', replace: 'Avenida', where: 'space', opts: { whole: true } });
out.replaced = { t1: t1.text, t2: t2.text, dim: dm.text, att: ins.attribs.NOMBRE, cells: tb.cells };
doc.undo(); app.afterUndo();
out.replaceUndo = doc.get(t1.id).text;
app.clearSel();

// ---- OVERKILL ----
doc.begin();
lay('OK');
const okL = p => doc.add({ ...base, layer: 'OK', ...p });
const d1 = okL({ type: 'line', p1: P(0, 100), p2: P(10, 100) });
okL({ type: 'line', p1: P(10, 100), p2: P(0, 100) }); // duplicada en sentido contrario
okL({ type: 'line', p1: P(5, 100), p2: P(20, 100) }); // solapada
okL({ type: 'line', p1: P(20, 100), p2: P(30, 100) }); // contigua (sólo con extremo a extremo)
okL({ type: 'line', p1: P(0, 110), p2: P(10, 110), color: '#ff0000' });
okL({ type: 'line', p1: P(0, 110), p2: P(10, 110) }); // igual salvo el color
okL({ type: 'arc', c: P(50, 100), r: 5, a1: 0, a2: Math.PI / 2 });
okL({ type: 'arc', c: P(50, 100), r: 5, a1: Math.PI / 3, a2: Math.PI });
okL({ type: 'circle', c: P(70, 100), r: 4 });
okL({ type: 'arc', c: P(70, 100), r: 4, a1: 1, a2: 2 });
okL({ type: 'pline', pts: [P(0, 120), P(5, 120), P(5, 120), P(10, 120), P(10, 130)], closed: false });
okL({ type: 'pline', pts: [P(10, 130), P(10, 120), P(0, 120)], closed: false }); // misma geometría, al revés y sin vértices sobrantes
doc.commit();
const okIds = doc.model.filter(e => e.layer === 'OK').map(e => e.id);
app.sel = new Set(okIds);
await app.run('OVERKILL',{ tol: 1e-6, ignore: [], plines: true, overlap: true, endToEnd: false });
await tick();
const okNow = () => doc.model.filter(e => e.layer === 'OK');
out.overkill1 = { n: okNow().length, lines: okNow().filter(e => e.type === 'line').map(e => [pt(e.p1), pt(e.p2), e.color]), arcs: okNow().filter(e => e.type === 'arc').map(e => [r4(e.a1), r4(e.a2)]), circles: okNow().filter(e => e.type === 'circle').length, plines: okNow().filter(e => e.type === 'pline').map(e => e.pts.length) };
out.overkillMsg = [...document.querySelectorAll('#cmd-history .hl')].at(-1).textContent;
app.sel = new Set(okNow().map(e => e.id));
await app.run('OVERKILL', { tol: 1e-6, ignore: ['color'], plines: true, overlap: true, endToEnd: true });
out.overkill2 = { n: okNow().length, lines: okNow().filter(e => e.type === 'line').map(e => [pt(e.p1), pt(e.p2)]) };
out.okKeepsFirst = !!doc.get(d1.id);

// ---- AUDIT ----
doc.begin();
doc.model.push({ ...base, id: 9001, type: 'line', p1: P(0, 0), p2: P(1, 1), layer: 'NO_EXISTE' });
doc.model.push({ ...base, id: 9002, type: 'insert', name: 'FANTASMA', p: P(0, 0), sx: 1, sy: 1, rot: 0 });
doc.model.push({ ...base, id: 9003, type: 'circle', c: P(NaN, 0), r: 2 });
doc.model.push({ ...base, id: 9001, type: 'point', p: P(3, 3) });
doc.model.push({ ...base, id: 9004, type: 'text', p: P(0, 0), h: 2, rot: 0, text: 'x', style: 'Inexistente' });
doc.blocks.BUCLE = { name: 'BUCLE', base: P(0, 0), ents: [{ ...base, type: 'insert', name: 'BUCLE', p: P(0, 0), sx: 1, sy: 1, rot: 0 }] };
doc.reindex();
doc.commit();
const nBefore = doc.model.length;
out.audit1 = await cmd('AUDIT', 'N');
const msgs = [...document.querySelectorAll('#cmd-history .hl')].map(x => x.textContent);
out.auditReport = msgs.at(-1);
out.auditNoFix = doc.model.length === nBefore;
out.audit2 = await cmd('AUDIT', 'S');
out.auditFixed = [...document.querySelectorAll('#cmd-history .hl')].at(-1).textContent;
out.afterFix = { n: nBefore - doc.model.length, layer: doc.get(9001)?.layer, ids: new Set(doc.model.map(e => e.id)).size === doc.model.length, style: doc.get(9004)?.style, loop: doc.blocks.BUCLE.ents.length };
await cmd('AUDIT', 'N');
out.audit3 = [...document.querySelectorAll('#cmd-history .hl')].at(-1).textContent;

// ---- Herramientas de capas ----
const eje = qs[0];
await cmd('LAYISO', sel([eje.id]));
out.layiso = doc.layers.filter(l => l.on).map(l => l.name);
out.layisoCur = doc.cur.layer;
await cmd('LAYUNISO');
out.layuniso = doc.layers.filter(l => !l.on).map(l => l.name);
await app.run('LAYISO', { ids: [eje.id], mode: 'lock' });
out.layisoLock = doc.layers.filter(l => l.lock).length === doc.layers.length - 1 && !doc.layer('EJE').lock;
await cmd('LAYUNISO');
out.unlock = doc.layers.filter(l => l.lock).length;
await app.run('LAYWALK', { layers: ['BORDE'] });
out.laywalkRestored = doc.layers.every(l => l.on);
await app.run('LAYWALK', { layers: ['BORDE', 'EJE'], keep: true });
out.laywalkKept = doc.layers.filter(l => l.on).map(l => l.name);
doc.begin(); for (const l of doc.layers) l.on = true; doc.changed(); doc.commit();
doc.begin(); doc.layerStates.push({ name: 'E1', layers: { COTAS: { on: true, lock: false, color: '#ffffff', ltype: 'CONTINUOUS', lw: 'DEFAULT' }, BORDE: { on: false, lock: false, color: '#ffffff', ltype: 'CONTINUOUS', lw: 'DEFAULT' } }, cur: '0', saved: new Date().toISOString() }); doc.layerFilters.push({ name: 'Grupo', kind: 'group', layers: ['COTAS', 'EJE'] }); doc.commit();
out.laymrg = await cmd('LAYMRG', 'N', 'COTAS', '', 'N', 'BORDE', 'S');
out.merged = { layers: doc.layers.map(l => l.name).includes('COTAS'), textLayer: doc.get(qs[4].id).layer, state: Object.keys(doc.layerStates.at(-1).layers), group: doc.layerFilters[0].layers };
// Filtros de capa
doc.begin(); doc.layerFilters.push({ name: 'Ejes', kind: 'prop', rules: { name: 'E*,O?' } }, { name: 'Vacías', kind: 'prop', rules: { used: 'no' } }); doc.ensureLayer('VACIA', '#00ff00'); doc.commit();
out.lfProp = LT.filteredLayers(doc, 'Ejes').map(l => l.name);
out.lfInv = LT.filteredLayers(doc, 'Ejes', true).length === doc.layers.length - out.lfProp.length;
out.lfUnused = LT.filteredLayers(doc, 'Vacías').map(l => l.name);
out.lfUsed = LT.filteredLayers(doc, '*usadas*').map(l => l.name).includes('VACIA');
out.lfGroup = LT.filteredLayers(doc, 'grupo').map(l => l.name);
app.ui.layFilter = 'Ejes'; app.ui.showPalette('layers');
await tick(40);
out.palette = [...document.querySelectorAll('.lay-list .lay-name')].map(x => x.textContent);
app.ui.layFilter = ''; app.ui.showPalette('props');

// ---- DXF y .tcad ----
await cmd('UCS', 'N', 'R', 'Diagonal');
doc.begin(); doc.views.push({ name: 'Papel', space: 'Hoja', cx: 100, cy: 80, w: 200, h: 150, layers: { EJE: { on: false, lock: false } } }); doc.changed(); doc.commit();
for (const v of ['2007', '2000']) {
  const txt = DXF.writeDXF(doc, v), r = DXF.readDXF(txt);
  out['dxf' + v] = { ucsList: r.ucsList.map(u => [u.name, pt(u.o), r4(u.ang * 180 / Math.PI)]), ucs: r.ucs && [pt(r.ucs.o), r4(r.ucs.ang * 180 / Math.PI), r.ucs.name], views: r.views.map(x => [x.name, x.space, r4(x.cx), r4(x.w), !!x.ucs, !!x.layers]) };
}
const r12 = DXF.readDXF(DXF.writeDXF(doc, 'R12'));
out.dxfR12 = { ucsList: r12.ucsList.length, views: r12.views.length };
const saved = JSON.parse(JSON.stringify(doc.toJSON()));
out.tcad = { version: saved.version, ucs: saved.ucs?.name, ucsList: saved.ucsList.length, views: saved.views.length, filters: saved.selFilters.length, layerFilters: saved.layerFilters.length };
doc.fromJSON(saved); app.afterLoad();
out.reload = { ucs: doc.ucs?.name, views: doc.views.length, filters: doc.selFilters.length, lf: doc.layerFilters.length };
return out;
