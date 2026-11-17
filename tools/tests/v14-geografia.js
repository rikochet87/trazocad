const geo = await import('./js/geographic.js'), P = await import('./js/projections.js'), ORG = await import('./js/origin.js'), { Doc } = await import('./js/document.js');
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
let checks = 0;
const assert = (v, msg) => { checks++; if (!v) throw Error(msg); };
const near = (a, b, e = 1e-7) => assert(Math.abs(a - b) < e, `${a} ≠ ${b}`);
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); app.submit(s); } await tick(); if (app.req) { const prompt = app.req.prompt; app.escape(); await p; throw Error('Orden pendiente: ' + prompt); } await p; };
const doc = app.doc;
const config = { crs: 'EPSG:32721', reference: { x: 100, y: 200 }, projected: { x: 371624.54419030336, y: 6170423.240398882 }, units: 0.001, north: 30 };
await app.run('GEOGRAPHICLOCATION', config);
assert(!!doc.geo, 'Configuración por comando');
const q = geo.fromGeographic(doc, { lon: -58.4, lat: -34.6, h: 12 }); near(q.x, 100, 1e-4); near(q.y, 200, 1e-4); near(q.z, 12, 1e-4);
const ll = geo.toGeographic(doc, { x: 1120, y: -450 }); const back = geo.fromGeographic(doc, ll); near(back.x, 1120, 1e-4); near(back.y, -450, 1e-4);
const pp = geo.toProjected(doc, { x: 1100, y: 200 }); near(pp.x - config.projected.x, Math.cos(Math.PI / 6), 1e-6); near(pp.y - config.projected.y, 0.5, 1e-6);
doc.undo(); assert(doc.geo === null, 'Deshacer georreferenciación'); doc.redo(); assert(doc.geo.crs.proj === 'tmerc', 'Rehacer');
const json = JSON.parse(JSON.stringify(doc.toJSON())), copy = new Doc(); copy.fromJSON(json); near(geo.toGeographic(copy, q).lat, -34.6); assert(json.version >= 14, 'Formato compatible con v14');
const old = new Doc(); old.fromJSON({ version: 13, model: [] }); assert(old.geo === null, 'Compatibilidad v13');
const parse = app.parsePoint('GEO:34°36\'0"S,58°24\'0"O,12'); near(parse.x, 100, 0.001); near(parse.y, 200, 0.001); near(parse.z, 12, 0.001);
assert(app.parsePoint('GEO:91,0') === null, 'Latitud inválida'); assert(app.parsePoint('GEO:34°70\'S,58O') === null, 'Minutos inválidos');
assert(app.parsePoint('GEO:34N,58N') === null, 'Hemisferio inválido');
app.ui.updateCoords(q); assert(app.ui.coordsEl.textContent.includes('34.6000000° S'), 'Barra geográfica');
await cmd('GEOFORMAT', 'Sexagesimal'); app.ui.updateCoords(q); assert(app.ui.coordsEl.textContent.includes('34°36'), 'Formato sexagesimal');
const hist = [], originalPrint = app.print; app.print = (m, ...a) => { hist.push(m); originalPrint.call(app, m, ...a); };
await cmd('ID', 'GEO:-34.6,-58.4'); app.print = originalPrint; assert(hist.some(m => m.includes('34°36')), 'ID geográfico');
// El origen local no altera el lugar geográfico, tampoco tras deshacer.
const before = geo.toGeographic(doc, q); doc.begin(); ORG.setOrigin(doc, { x: 1000000, y: 6000000 }); doc.commit();
const shifted = { x: q.x - 1000000, y: q.y - 6000000 }; near(geo.toGeographic(doc, shifted).lon, before.lon); near(geo.toGeographic(doc, shifted).lat, before.lat); doc.undo();
// GPS simulado: permisos, posición, seguimiento y liberación. No solicita la ubicación real del entorno.
let success, failure, cleared = null;
const own = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: (ok, err) => { success = ok; failure = err; return 42; }, clearWatch: id => { cleared = id; } } });
app.gps.start(true); success({ coords: { longitude: -58.4, latitude: -34.6, altitude: 12, accuracy: 4 }, timestamp: Date.now() });
assert(app.gps.position.accuracy === 4, 'GPS precisión'); near(app.view.cx, 100, 1e-4); app.gps.stop(); assert(cleared === 42 && app.gps.position === null, 'Detener GPS');
app.gps.start(); failure({ code: 1 }); assert(app.gps.watch === null, 'Permiso denegado');
if (own) Object.defineProperty(navigator, 'geolocation', own); else delete navigator.geolocation;
// Configuración completa por línea de comandos, incluida referencia real y giro.
await cmd('-GEOGRAPHICLOCATION', 'EPSG:32721', 'EsteNorte', '*100,200', '371624.54419030336', '6170423.240398882', '0.001', '30');
near(geo.fromGeographic(doc, { lon: -58.4, lat: -34.6 }).x, 100, 0.001);
await cmd('GEOCS', 'Quitar'); assert(doc.geo === null && doc.basemap === null, 'Quitar ubicación'); doc.undo(); assert(!!doc.geo, 'Deshacer quitar');
return { ok: true, checks };
