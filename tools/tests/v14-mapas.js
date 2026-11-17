const { OSM, validateMap, tileURL, tileLonLat, MAP_CACHE, visibleTiles } = await import('./js/basemap.js'), { makeRV } = await import('./js/render.js'), { validateGeo, fromGeographic } = await import('./js/geographic.js');
let checks = 0;
const assert = (v, msg) => { checks++; if (!v) throw Error(msg); };
const doc = app.doc;
doc.geo = validateGeo({ crs: 'EPSG:3857' });
const center = fromGeographic(doc, { lon: -58.4, lat: -34.6 });
const R = makeRV(center.x, center.y, 0.5, 512, 512, 1);
// Imagen de control servida localmente: pruebas repetibles incluso sin Internet.
doc.basemap = validateMap({ ...OSM, url: location.origin + '/icons/icon-192.png?z={z}&x={x}&y={y}', opacity: 1, attribution: 'Mapa de prueba local' });
const tiles = visibleTiles(doc, R, doc.basemap); assert(tiles.length > 0 && tiles.length <= 64, 'Cobertura acotada');
const n = await app.basemap.prepare(R); assert(n === tiles.length, 'Carga de teselas');
const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
app.basemap.draw(canvas.getContext('2d'), R);
assert(canvas.getContext('2d').getImageData(256, 256, 1, 1).data[3] > 0, 'Mapa reproyectado visible');
assert(canvas.toDataURL().length > 1000, 'Canvas exportable, sin contaminación CORS');
// Fondo uniforme: no deben aparecer costuras transparentes en la malla de reproyección.
const savedImages = new Map(app.basemap.images), solid = document.createElement('canvas'); solid.width = solid.height = 256;
solid.getContext('2d').fillStyle = '#78a87a'; solid.getContext('2d').fillRect(0, 0, 256, 256);
const im = new Image(); im.src = solid.toDataURL(); await im.decode(); for (const t of tiles) app.basemap.images.set(t.url, im); app.basemap.revision++;
canvas.getContext('2d').clearRect(0, 0, 512, 512); app.basemap.draw(canvas.getContext('2d'), R);
const pixels = canvas.getContext('2d').getImageData(16, 16, 480, 460).data;
let transparent = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 250) transparent++;
assert(transparent === 0, `Malla sin costuras (${transparent} píxeles, muestra ${[...pixels].filter((v,i)=>i%4===3 && v<250).slice(0,20)})`);
app.basemap.images = savedImages; app.basemap.revision++;
const cache = await caches.open(MAP_CACHE); assert(!!await cache.match(tiles[0].url), 'Caché persistente');
const fetchOrig = window.fetch; window.fetch = async () => { throw Error('Sin conexión de prueba'); };
app.basemap.images.clear(); app.basemap.rasters.clear(); const offline = await app.basemap.prepare(R); window.fetch = fetchOrig; assert(offline === n, 'Caché funciona sin red');
// WMS y WMTS: parámetros, coordenadas y codificación de nombres de capa.
const wms = new URL(tileURL(validateMap({ ...OSM, type: 'WMS', url: location.origin + '/wms?token=demo', layer: 'vialidad:rutas' }), 1, 1, 0));
assert(wms.searchParams.get('SRS') === 'EPSG:3857', 'SRS WMS'); assert(wms.searchParams.get('BBOX') === '0,0,20037508.342789244,20037508.342789244', 'BBOX WMS'); assert(wms.searchParams.get('token') === 'demo', 'Preservar query');
const wmts = new URL(tileURL(validateMap({ ...OSM, type: 'WMTS', url: location.origin + '/wmts', layer: 'capa', matrixSet: 'GoogleMapsCompatible', matrixPrefix: 'EPSG:3857:' }), 3, 2, 4));
assert(wmts.searchParams.get('TILEMATRIX') === 'EPSG:3857:3' && wmts.searchParams.get('TILEROW') === '4', 'WMTS');
const corner = tileLonLat(0, 0, 0); assert(Math.abs(corner.lat - 85.05112878) < 1e-7 && corner.lon === -180, 'Extensión Web Mercator');
for (const bad of [{ url: 'javascript:alert(1)' }, { url: 'https://example.com/no-template' }, { type: 'WMS', layer: '' }, { opacity: 2 }, { maxZoom: 50 }]) {
  let rejected = false; try { validateMap({ ...OSM, ...bad }); } catch { rejected = true; } assert(rejected, 'Rechazar configuración inválida');
}
// PDF incluye el fondo como imagen incrustada; PNG también pasa por el dibujado común.
app.view.cx = center.x; app.view.cy = center.y; app.view.scale = 0.5;
doc.begin(); doc.add({ type: 'line', p1: { x: center.x - 400, y: center.y - 400 }, p2: { x: center.x + 400, y: center.y + 400 }, layer: '0' }); doc.commit();
const pages = await app.io.buildPDF(); assert(pages[0].ctx.images.size > 0, 'PDF incrusta mapa');
const { buildPdf } = await import('./js/pdf.js'); const pdf = await buildPdf(pages, 'Mapa de prueba'); assert(pdf.size > 2000, 'PDF generado');
const writeFile = app.io.writeFile; let png;
app.io.writeFile = async blob => { png = blob; return true; }; await app.io.exportPNG(); app.io.writeFile = writeFile;
assert(png.type === 'image/png' && png.size > 1000, 'PNG con mapa');
const snapshot = JSON.parse(JSON.stringify(doc.toJSON())); assert(snapshot.basemap.type === 'XYZ', 'Servicio guardado en tcad');
doc.basemap.enabled = false; await app.basemap.clear(); assert(!(await caches.keys()).includes(MAP_CACHE), 'Borrar caché');
return { ok: true, checks, teselas: n, pdfBytes: pdf.size, pngBytes: png.size };
