// Novedades de la v0.12 (1): vistas giradas. PLAN y DVIEW en el modelo, designación por ventana, rastreo, zoom y
// encuadre con la vista girada, ventanas gráficas giradas (propiedad Giro, GIRA con VPROTATEASSOC), SCP por ventana
// (UCSVP, UCSFOLLOW), vistas con nombre giradas y su paso por DXF, SVG, PDF y .tcad
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const pick = (ent, pt) => async () => { await tick(); app.req.resolve({ e: ent, pt }); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const r4 = v => +(+v).toFixed(4);
const pt = p => [r4(p.x), r4(p.y)];
const dg = a => r4(((a * 180 / Math.PI) % 360 + 360) % 360);
const base = { layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' };
const add = e => { doc.begin(); const x = doc.add({ ...base, ...e }); doc.commit(); return x; };
const DXF = await import('./js/dxf.js'), E = await import('./js/entities.js');
const prop = (e, label) => E.propsOf(e).find(p => p.label === label);
app.view.cx = 50; app.view.cy = 50; app.view.scale = 4; app.renderer.invalidate();

// ---- PLAN: con el SCP girado 30°, la vista se alinea con él ----
const c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6);
const eje = add({ type: 'line', p1: P(0, 0), p2: P(100 * c30, 100 * s30) });
const perp = add({ type: 'line', p1: P(50 * c30, 50 * s30), p2: P(50 * c30 - 20 * s30, 50 * s30 + 20 * c30) });
await cmd('UCS', 'Z', '30');
out.plan = await cmd('PLAN', '');
const v = app.view;
const a = v.toScreen(eje.p1), b = v.toScreen(eje.p2);
out.planView = { rot: dg(v.rot), horizontal: r4(a.y - b.y), rightward: b.x > a.x };
const q = v.toScreen(perp.p2), q0 = v.toScreen(perp.p1);
out.perpVertical = r4(q.x - q0.x);
out.roundTrip = pt(v.toWorld(v.toScreen(P(12.3, -45.6))));
// El zoom con la rueda conserva el punto bajo el cursor; el encuadre mueve en la dirección de la pantalla
const sp = { x: 300, y: 200 }, wp = v.toWorld(sp);
v.zoomAt(1.7, sp);
out.zoomKeeps = pt(G_sub(v.toWorld(sp), wp));
function G_sub(p, q) { return P(p.x - q.x, p.y - q.y); }
const before = v.toWorld({ x: 400, y: 300 });
v.panBy(30, 0);
const after = v.toWorld({ x: 430, y: 300 });
out.panKeeps = pt(G_sub(after, before));
// rect() contiene toda la vista girada
const r = v.rect(), corners = v.poly();
out.rectContains = corners.every(c => c.x >= r.x1 - 1e-9 && c.x <= r.x2 + 1e-9 && c.y >= r.y1 - 1e-9 && c.y <= r.y2 + 1e-9);
app.zoomExtents();
// ---- Designación por ventana en la vista girada: la ventana es un rectángulo de la pantalla ----
app.sel.clear();
const sa = v.toScreen(P(-5 * c30 + 5 * s30, -5 * s30 - 5 * c30)), sb = v.toScreen(P(105 * c30, 105 * s30 + 1));
// ventana de izquierda a derecha que encierra el eje (y no la perpendicular, que sale por arriba)
const top = Math.min(sa.y, sb.y) - 4, bottom = Math.max(sa.y, sb.y) + 4;
app.win = { s: { x: Math.min(sa.x, sb.x) - 4, y: bottom }, shift: false, set: app.sel, dragged: true };
app.mouse.sx = Math.max(sa.x, sb.x) + 4; app.mouse.sy = top;
app.finishWindow();
out.winSel = { eje: app.sel.has(eje.id), perp: app.sel.has(perp.id), rot: dg(app.lastWindow.rot) };
// Captura de derecha a izquierda: toca la perpendicular
app.sel.clear();
app.win = { s: { x: Math.max(sa.x, sb.x) + 4, y: bottom }, shift: false, set: app.sel, dragged: true };
app.mouse.sx = Math.min(sa.x, sb.x) - 4; app.mouse.sy = top;
app.finishWindow();
out.crossSel = { eje: app.sel.has(eje.id), perp: app.sel.has(perp.id) };
app.sel.clear();
// ---- Rastreo: horizontal y vertical de la pantalla ----
app.acquired = [eje.p2];
const sv = v.toScreen(eje.p2), mpt = v.toWorld({ x: sv.x - 80, y: sv.y + 2 });
const tr = app.snapper.track({ w: mpt, sx: sv.x - 80, sy: sv.y + 2 });
const ts = v.toScreen(tr.pt);
out.track = { lines: tr.lines.length, onHorizontal: r4(ts.y - sv.y), dx: r4(ts.x - (sv.x - 80)) };
app.acquired = [];
// ---- DVIEW: giro escrito, dos puntos, objeto y restablecer ----
out.dvAng = await cmd('DVIEW', 'G', '45');
out.rot45 = dg(app.view.rot);
await cmd('DVIEW', 'D', '0,0', '0,10');
out.rot2p = dg(app.view.rot);
await cmd('DVIEW', 'O', pick(eje, P(40, 23)));
out.rotObj = dg(app.view.rot);
await cmd('DVIEW', 'R');
out.rotReset = app.view.rot;
// ZOOM Ventana con la vista girada: el rectángulo de la pantalla
await cmd('PLAN', '');
const za = v.toWorld({ x: 100, y: 100 }), zb = v.toWorld({ x: 500, y: 300 }), zm = v.toWorld({ x: 300, y: 200 });
await cmd('ZOOM', `*${za.x},${za.y}`, `*${zb.x},${zb.y}`);
const zc = v.toWorld({ x: v.w / 2, y: v.h / 2 });
out.zoomWin = { center: pt(G_sub(zc, zm)), rot: dg(v.rot) };
// UCSFOLLOW: al cambiar el SCP, la vista lo sigue
await cmd('UCSFOLLOW', '1');
await cmd('UCS', 'Z', '30');
out.follow = { ucs: dg(doc.ucs.ang), view: dg(app.view.rot) };
await cmd('UCSFOLLOW', '0');
await cmd('UCS', 'U');
out.afterWorldUcs = dg(app.view.rot); // sin UCSFOLLOW la vista no cambia
// ---- Vistas con nombre: guardan el giro ----
await cmd('PLAN', 'U');
await cmd('DVIEW', 'G', '30');
const vc = app.view.toWorld({ x: app.view.w / 2, y: app.view.h / 2 });
await cmd('-VIEW', 'G', 'Tramo1');
const vw = doc.views.find(x => x.name === 'Tramo1');
out.viewSaved = { twist: dg(vw.twist), c: pt(G_sub(P(vw.cx, vw.cy), vc)), ratio: r4(vw.w / vw.h) };
await cmd('PLAN', 'U');
await cmd('-VIEW', 'R', 'Tramo1');
out.viewRestored = { rot: dg(app.view.rot), c: pt(G_sub(app.view.toWorld({ x: app.view.w / 2, y: app.view.h / 2 }), vc)) };

// ---- Ventanas en mosaico: cada una con su giro y su SCP (UCSVP) ----
await cmd('UCS', 'U');
await cmd('VPORTS', '2', 'V');
out.tiles = app.tiles.length;
const [t1, t2] = app.tiles;
app.setActiveTile(t1);
await cmd('UCS', 'Z', '30');
await cmd('PLAN', '');
app.setActiveTile(t2);
out.tile2 = { ucs: doc.ucs ? dg(doc.ucs.ang) : 'universal', rot: dg(t2.view.rot) };
await cmd('UCS', 'U');
app.setActiveTile(t1);
out.tile1 = { ucs: doc.ucs ? dg(doc.ucs.ang) : 'universal', rot: dg(t1.view.rot) };
const st = app.tilesState();
out.tilesState = st.tiles.map(t => ({ rot: t.rot ? dg(t.rot) : 0, ucs: t.ucs === undefined ? 'dibujo' : t.ucs ? dg(t.ucs.ang) : 'universal' }));
// Se guarda en el .tcad
const saved = JSON.parse(JSON.stringify(doc.toJSON()));
out.tcadVersion = saved.version;
doc.fromJSON(saved); app.afterLoad();
out.tcadTiles = app.tiles.map(t => dg(t.view.rot));
await cmd('VPORTS', 'UN');
out.single = { n: app.tiles.length, rot: dg(app.view.rot) };
// Una sola vista girada también se guarda
const s1 = JSON.parse(JSON.stringify(doc.toJSON()));
out.tcadSingle = s1.tiles ? dg(s1.tiles.tiles[0].rot) : null;
// En DXF, *ACTIVE con VIEWTWIST = −30° (330)
const dx = DXF.writeDXF(doc, '2007');
const act = dx.split('\n').map(s => s.trim());
const iA = act.indexOf('*ACTIVE'), i51 = act.indexOf('51', iA);
out.dxfActiveTwist = +act[i51 + 1];
const rd = DXF.readDXF(dx);
out.dxfModelView = rd.modelView ? { rot: dg(rd.modelView.rot) } : null;
out.dxfView = rd.views.map(x => ({ name: x.name, twist: x.twist ? dg(x.twist) : 0, c: pt(G_sub(P(x.cx, x.cy), vc)) }));

// ---- Ventanas gráficas giradas ----
app.switchTab('model');
await cmd('UCS', 'U');
doc.begin();
const lay = doc.addLayout('Planta', 'A3');
lay.ents.push({ ...base, id: doc.nextId++, type: 'vport', p1: P(20, 20), p2: P(400, 120), cx: 50 * c30, cy: 50 * s30, s: 2 });
doc.reindex(); doc.commit();
const vp = lay.ents[0];
app.switchTab(doc.layouts.indexOf(lay)); await tick(20);
// Propiedad Giro (grados en la paleta, radianes en la entidad)
doc.begin(); doc.modify(vp.id, e => prop(e, 'Giro').set(e, Math.PI / 6)); doc.commit();
const vpE = doc.get(vp.id);
out.vpProp = { twist: dg(vpE.twist), shown: dg(prop(vpE, 'Giro').get(vpE)) };
// El eje se ve horizontal en el papel: papel = centro + giro(modelo − centro, −twist)·s
app.mspace(vpE);
const vv = app.view, pa = vv.toScreen(eje.p1), pb = vv.toScreen(eje.p2);
out.vpView = { rot: dg(vv.rot), horizontal: r4(pa.y - pb.y), centre: pt(G_sub(app.paperView.toWorld(vv.toScreen(P(vpE.cx, vpE.cy))), P(210, 70))) };
// Dentro de la ventana, zoom y encuadre conservan el giro y el punto bajo el cursor
const wv = vv.toWorld({ x: 500, y: 300 });
vv.zoomAt(1.5, { x: 500, y: 300 });
out.vpZoom = pt(G_sub(vv.toWorld({ x: 500, y: 300 }), wv));
// UCSVP: el SCP de la ventana se conserva al salir y volver
await cmd('UCS', 'Z', '30');
app.pspace();
out.vpUcsOut = { model: doc.ucs ? dg(doc.ucs.ang) : 'universal', vp: dg(doc.get(vp.id).ucs.ang) };
app.mspace(doc.get(vp.id));
out.vpUcsIn = doc.ucs ? dg(doc.ucs.ang) : 'universal';
// PLAN en la ventana: conserva la escala
const s0 = doc.get(vp.id).s;
await cmd('PLAN', 'U');
out.vpPlan = { twist: doc.get(vp.id).twist || 0, s: r4(doc.get(vp.id).s / s0) };
await cmd('PLAN', '');
out.vpPlanUcs = dg(doc.get(vp.id).twist);
app.pspace();
// GIRA la ventana 90°: con VPROTATEASSOC = 1 la vista gira con ella
await cmd('ROTATE', sel([vp.id]), '210,70', '90');
const vr = doc.get(vp.id);
out.vpRotate = { twist: dg(vr.twist), w: r4(vr.p2.x - vr.p1.x), h: r4(vr.p2.y - vr.p1.y) };
doc.undo(); app.afterUndo();
await cmd('VPROTATEASSOC', '0');
await cmd('ROTATE', sel([vp.id]), '210,70', '90');
out.vpRotateNoAssoc = dg(doc.get(vp.id).twist);
doc.undo(); app.afterUndo();
await cmd('VPROTATEASSOC', '1');
// SVG con la matriz girada y PDF
const svg = app.io.buildSVG().svg;
out.svgMatrix = (svg.match(/<g transform="matrix\([^)]*\)">/) || [''])[0];
const pages = await app.io.buildPDF('current');
out.pdfOps = pages[0].ctx.ops.length > 10;
// DXF: VIEWPORT con VIEWTWIST y centro en DCS
const rv = DXF.readDXF(DXF.writeDXF(doc, '2007')), lv = rv.layouts.find(l => l.name === 'Planta').ents.find(e => e.type === 'vport');
out.dxfVport = { twist: dg(lv.twist), c: pt(G_sub(P(lv.cx, lv.cy), P(doc.get(vp.id).cx, doc.get(vp.id).cy))), s: r4(lv.s / doc.get(vp.id).s) };
const r2 = DXF.readDXF(DXF.writeDXF(doc, '2000')).layouts.find(l => l.name === 'Planta').ents.find(e => e.type === 'vport');
out.dxf2000Vport = dg(r2.twist);
app.switchTab('model');
return out;
