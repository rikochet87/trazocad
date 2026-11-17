const F = await import('./js/gisformats.js'), S = await import('./js/shapefile.js'), G = await import('./js/gis.js'), C = await import('./js/giscommands.js'), { validateGeo } = await import('./js/geographic.js'), { resolveCRS } = await import('./js/projections.js');
const doc = app.doc; doc.geo = validateGeo({ crs: 'EPSG:32721' });
let checks = 0; const assert = (v, m) => { checks++; if (!v) throw Error(m); }, near = (a, b, tol = 1e-7) => assert(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
const fixture = async name => new Uint8Array(await (await fetch('./tools/fixtures/v15/' + name)).arrayBuffer());
const collection = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { nombre: 'Señal Ñ', valor: 3.5, activo: true }, geometry: { type: 'Point', coordinates: [-58.4, -34.6, 12] } },
  { type: 'Feature', properties: { nombre: 'Eje', valor: 7.5, activo: false }, geometry: { type: 'LineString', coordinates: [[-58.4, -34.6, 11], [-58.399, -34.599, 13]] } },
  { type: 'Feature', properties: { nombre: 'Parcela', valor: 8, activo: true }, geometry: { type: 'Polygon', coordinates: [[[-58.4, -34.6], [-58.398, -34.6], [-58.398, -34.598], [-58.4, -34.598], [-58.4, -34.6]], [[-58.3995, -34.5995], [-58.3995, -34.599], [-58.399, -34.599], [-58.399, -34.5995], [-58.3995, -34.5995]]] } }
] };
const ids = G.importFeatures(doc, F.readGeoJSON(JSON.stringify(collection)), { layer: 'Prueba' }); assert(ids.length === 3, 'Importación vectorial'); assert(doc.model.find(e => e.type === 'region').loops.length === 2, 'Hueco editable');
const out = G.exportFeatures(doc, { layer: 'Prueba' }); near(out.features[0].geometry.coordinates[0], -58.4); near(out.features[0].geometry.coordinates[2], 12); assert(out.features[0].properties.activo === true, 'Atributos tipados');
const count = doc.model.length; try { G.importFeatures(doc, { type: 'Point', coordinates: [Infinity, 10] }); } catch {} assert(doc.model.length === count, 'Importación fallida atómica');
const snapshot = JSON.stringify(doc.toJSON()); doc.undo(); assert(doc.model.length === 0 && !doc.gis.schemas.Prueba, 'Deshacer importación'); doc.redo(); assert(JSON.stringify(doc.toJSON()) === snapshot, 'Rehacer importación');
const originalShape = S.readSHP(await fixture('externo.shp'), await fixture('externo.dbf'), 'utf-8');
assert(originalShape.collection.features[0].properties.parcela === 'Lote Ñandú', 'DBF externo UTF-8'); near(originalShape.collection.features[0].properties.valor, 1250.75); assert(originalShape.collection.features[0].properties.fecha === '2026-11-17', 'DBF fecha'); assert(originalShape.collection.features[0].geometry.coordinates.length === 2, 'SHP externo con hueco');
const entries = S.writeSHP(originalShape.collection, 'EPSG:32721', originalShape.schema), backShape = S.readSHP(entries['datos.shp'], entries['datos.dbf'], 'utf-8');
near(backShape.collection.features[0].geometry.coordinates[0][0][0], 371620); assert(backShape.collection.features[0].geometry.coordinates.length === 2, 'SHP exportado conserva hueco'); assert(resolveCRS(entries['datos.prj']).proj === 'tmerc', 'PRJ legible');
const shx = new DataView(entries['datos.shx'].buffer); assert(shx.getInt32(100) === 50 && shx.getInt32(104) * 2 + 108 === entries['datos.shp'].length, 'Índice SHX');
const zip = F.writeZIP(entries), files = await F.readZIP(zip); assert(files['datos.shp'].length === entries['datos.shp'].length, 'ZIP Shapefile');
const kmz = await F.readZIP(await fixture('externo.kmz')); assert(F.readKML(new TextDecoder().decode(kmz['doc.kml'])).features[0].properties.nombre === 'Prueba Ñ', 'KMZ deflate externo');
const kml = F.readKML(F.writeKML(out)); assert(kml.features.length === 3 && kml.features[2].geometry.coordinates.length === 2, 'KML polígonos y huecos');
assert(kml.features[0].properties.activo === true && kml.features[0].properties.valor === 3.5, 'SchemaData KML tipado');
const badZip = zip.slice(); badZip[42] ^= 255; let rejected = false; try { await F.readZIP(badZip); } catch { rejected = true; } assert(rejected, 'CRC o cabecera corrupta rechazada');
const imported = await C.importFiles(app, [new File([zip], 'datos.zip')], { layer: 'Externo' }); assert(imported.length === 1 && doc.gis.schemas.Externo.some(f => f.type === 'fecha'), 'Importación ZIP integrada');
const exported = await C.exportData(app, { format: 'GeoJSON', layer: 'Externo' }); assert(JSON.parse(exported.content).features[0].properties.parcela === 'Lote Ñandú', 'Exportación integrada');
let mixed = false; try { S.writeSHP(out, 'EPSG:4326'); } catch { mixed = true; } assert(mixed, 'Shapefile rechaza familias mezcladas');
return { ok: true, checks, formatos: ['GeoJSON', 'SHP/SHX/DBF/PRJ/CPG', 'KML', 'KMZ', 'ZIP'] };
