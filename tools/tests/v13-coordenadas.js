// Novedades de la v0.13 (2): coordenadas grandes. DXF con coordenadas de proyección (7 cifras): origen local automático,
// coordenadas reales en la barra de estado, la entrada de puntos, ID, Propiedades, cotas de coordenadas, la API y la
// grabación de guiones; DXF exportado con las coordenadas exactas; LOCALORIGIN con deshacer (la vista no salta);
// intersecciones y áreas sin pérdida de precisión; dibujo en el canvas sin temblores al ampliar (ShiftCtx)
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const r4 = v => +(+v).toFixed(4);
const DXF = await import('./js/dxf.js'), E = await import('./js/entities.js'), G = await import('./js/geom.js'), ORG = await import('./js/origin.js');
const prop = (e, label) => E.propsOf(e).find(p => p.label === label);
const last = () => doc.model[doc.model.length - 1];

// ---- DXF con coordenadas de proyección (Gauss-Krüger, X = 5 654 xxx, Y = 6 123 xxx) ----
const X0 = 5654321.123, Y0 = 6123456.789;
const g = (...a) => a.join('\n');
const L = (x1, y1, x2, y2, z1 = 0, z2 = 0) => g('0', 'LINE', '8', 'EJE', '10', x1, '20', y1, '30', z1, '11', x2, '21', y2, '31', z2);
const src = g('0', 'SECTION', '2', 'HEADER', '9', '$INSBASE', '10', 0, '20', 0, '30', 0, '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  L(X0, Y0, X0 + 250.5, Y0 + 100.25, 101.5, 103.25), L(X0 + 100, Y0 - 50, X0 + 100, Y0 + 200),
  '0', 'CIRCLE', '8', 'PIQUETES', '10', X0 + 10, '20', Y0 + 20, '30', 98.7, '40', 0.75,
  '0', 'TEXT', '8', 'TEXTOS', '10', X0 + 5, '20', Y0 + 5, '30', 0, '40', 2.5, '1', 'PK 0+000',
  '0', 'LWPOLYLINE', '8', 'PARCELA', '90', 4, '70', 1, '10', X0 + 300, '20', Y0, '10', X0 + 340, '20', Y0, '10', X0 + 340, '20', Y0 + 25, '10', X0 + 300, '20', Y0 + 25,
  '0', 'ENDSEC', '0', 'EOF');
await app.io.loadFile(new File([src], 'proyecto.dxf'));
await tick(50);
const eje = doc.model.find(e => e.type === 'line' && e.layer === 'EJE'), ci = doc.model.find(e => e.type === 'circle'), par = doc.model.find(e => e.type === 'pline');
out.origin = { ...doc.origin };
out.internal = { p1: [r4(eje.p1.x), r4(eje.p1.y)], small: Math.max(...doc.model.flatMap(e => E.primsOf(e).flatMap(q => (q.a ? [q.a, q.b] : [q.c])).map(p => Math.max(Math.abs(p.x), Math.abs(p.y))))) < 1000, z: [eje.z1, eje.z2], elev: ci.elev };
// Propiedades y LIST con las coordenadas reales
out.props = { x: r4(prop(eje, 'Inicio X').get(eje)), y: r4(prop(eje, 'Inicio Y').get(eje)), cx: r4(prop(ci, 'Centro X').get(ci)) };
out.list = E.describe(eje).find(s => s.includes('Inicio X'))?.trim();
doc.begin(); doc.modify(ci.id, e => prop(e, 'Centro X').set(e, X0 + 12)); doc.commit();
out.propSet = r4(ci.c.x + doc.origin.x);
// Barra de estado y entrada de coordenadas reales
app.ui.updateCoords(P(eje.p1.x, eje.p1.y));
out.status = app.ui.coordsEl.textContent;
const q = app.parsePoint(`${X0 + 1},${Y0 + 2}`), qw = app.parsePoint(`*${X0 + 1},${Y0 + 2}`);
out.parse = [r4(q.x), r4(q.y), r4(qw.x), r4(qw.y)];
await cmd('LINE', `${X0 + 400},${Y0}`, `@10,0`, '');
out.drawn = { p1: [r4(last().p1.x + doc.origin.x), r4(last().p1.y + doc.origin.y)], len: r4(G.dist(last().p1, last().p2)) };
const hist = [], pr = app.print.bind(app);
app.print = (m, ...a) => { hist.push(m); return pr(m, ...a); };
await cmd('ID', `${X0 + 0.5},${Y0 + 0.25}`);
app.print = pr;
out.id = hist.find(m => /^X =/.test(m));
// Cota de coordenadas: mide la coordenada real
await cmd('DIMORDINATE', `${X0 + 100},${Y0 + 150}`, `${X0 + 140},${Y0 + 150}`);
const od = last();
out.ordinate = { org: od.org && [od.org.x, od.org.y], text: E.dimParts(od).text.str };
// La API trabaja con coordenadas reales
const id = tc.line([X0 + 500, Y0], [X0 + 510, Y0 + 10, 7]);
out.api = { p1: [r4(doc.get(id).p1.x), r4(doc.get(id).p1.y)], z2: doc.get(id).z2, real: tc.real(doc.get(id).p1), origin: tc.origin };

// ---- DXF exportado: coordenadas reales exactas ----
const d = DXF.writeDXF(ORG.realDoc(doc), '2007');
const back = DXF.readDXF(d);
const eje2 = back.ents.find(e => e.type === 'line' && e.layer === 'EJE');
out.export = { p1: [eje2.p1.x, eje2.p1.y], p2: [eje2.p2.x, eje2.p2.y], z: [eje2.z1, eje2.z2], exact: eje2.p1.x === X0 && eje2.p1.y === Y0 && eje2.p2.x === X0 + 250.5, ordOrg: back.ents.find(e => e.kind === 'ord')?.org ?? null, text: d.includes('5654321.123') };
out.unchanged = [eje.p1.x, eje.p1.y]; // la exportación no toca el dibujo

// ---- Precisión: intersección y área ----
const A = P(X0 + 0.0001, Y0 + 0.0002), B = P(X0 + 1000.0003, Y0 + 707.0001), C = P(X0 + 0.0002, Y0 + 707.0002), D = P(X0 + 1000.0001, Y0 + 0.0003);
const exact = G.llInt(G.P(0.0001, 0.0002), G.P(1000.0003, 707.0001), G.P(0.0002, 707.0002), G.P(1000.0001, 0.0003)).p;
const big = G.llInt(A, B, C, D).p, loc = G.llInt(...[A, B, C, D].map(p => ORG.fromReal(doc, p))).p;
out.precision = { absError: +Math.hypot(big.x - X0 - exact.x, big.y - Y0 - exact.y).toExponential(1), localError: +Math.hypot(loc.x + doc.origin.x - X0 - exact.x, loc.y + doc.origin.y - Y0 - exact.y).toExponential(1) };
// Área de la parcela de 40 × 25: con las coordenadas internas, exacta; con las reales (productos de 7 cifras), con error
out.area = { local: prop(par, 'Área').get(par), absolute: Math.abs(G.polyArea(par.pts.map(p => ORG.toReal(doc, p)))) };

// ---- LOCALORIGIN: restablecer y deshacer; la vista no salta ----
app.zoomExtents();
const s0 = app.view.toScreen(eje.p1), o0 = { ...doc.origin };
out.lo = await cmd('LOCALORIGIN', 'R');
const s1 = app.view.toScreen(eje.p1);
out.reset = { origin: { ...doc.origin }, p1: [r4(eje.p1.x), r4(eje.p1.y)], screenSame: Math.hypot(s1.x - s0.x, s1.y - s0.y) < 1e-3, propX: r4(prop(eje, 'Inicio X').get(eje)) };
doc.undo();
const s2 = app.view.toScreen(eje.p1);
out.undo = { origin: { ...doc.origin }, same: doc.origin.x === o0.x && doc.origin.y === o0.y, p1: [r4(eje.p1.x), r4(eje.p1.y)], screenSame: Math.hypot(s2.x - s0.x, s2.y - s0.y) < 1e-3 };
await cmd('LOCALORIGIN', 'P', `${X0 + 100},${Y0 + 100}`);
out.point = { origin: [r4(doc.origin.x), r4(doc.origin.y)], p1: [r4(eje.p1.x), r4(eje.p1.y)], ord: E.dimParts(od).text.str };
doc.undo();

// ---- .tcad: el origen se guarda ----
const j = JSON.parse(JSON.stringify(doc.toJSON()));
out.tcad = { origin: j.origin, x: j.model.find(e => e.id === eje.id).p1.x };

// ---- Dibujo sin temblores: línea vertical a 6 millones con un zoom de 20 000 px por unidad ----
const { Doc } = await import('./js/document.js');
const R = await import('./js/render.js');
doc.begin(); doc.removeMany(doc.model.map(e => e.id)); doc.origin = { x: 0, y: 0 }; doc.commit();
const xv = 6123456.7891;
doc.begin(); doc.add({ type: 'line', p1: P(xv, Y0 - 1), p2: P(xv, Y0 + 1), layer: '0', color: '#ff0000', ltype: 'BYLAYER', lw: 'BYLAYER' }); doc.commit();
app.T.grid = false;
const v = app.view; v.rot = 0; v.scale = 20000; v.cx = xv + 0.0005; v.cy = Y0;
app.renderer.drawBase();
const cv = app.base, cx = app.renderer.base.getContext('2d'), row = Math.round(v.h / 2 * app.renderer.dpr);
const pix = cx.getImageData(0, row, cv.width, 1).data, red = [];
for (let i = 0; i < cv.width; i++) if (pix[i * 4] > 90 && pix[i * 4 + 1] < 60) red.push(i);
const expect = v.toScreen(P(xv, Y0)).x * app.renderer.dpr;
out.render = { expect: r4(expect), got: red.length ? r4((red[0] + red[red.length - 1] + 1) / 2) : null, ok: red.length > 0 && Math.abs((red[0] + red[red.length - 1] + 1) / 2 - expect) < 1.5 };
// Con el contexto normal (sin restar el centro), la misma línea sale descolocada
const raw = document.createElement('canvas'); raw.width = cv.width; raw.height = cv.height;
const rc = raw.getContext('2d'), RR = R.makeR(v, app.renderer.dpr);
R.setWorld(rc, RR); rc.strokeStyle = '#ff0000'; rc.lineWidth = 1 / v.scale; rc.beginPath(); rc.moveTo(xv, Y0 - 1); rc.lineTo(xv, Y0 + 1); rc.stroke();
const p2 = rc.getImageData(0, row, cv.width, 1).data, red2 = [];
for (let i = 0; i < cv.width; i++) if (p2[i * 4 + 3] > 0 && p2[i * 4] > 90) red2.push(i);
out.renderRaw = { got: red2.length ? (red2[0] + red2[red2.length - 1] + 1) / 2 : null };
app.T.grid = true;
return out;
