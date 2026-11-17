// Coordinación de archivos SIG y órdenes. Los lectores no conocen la interfaz ni modifican el documento.
import { importFeatures, exportFeatures, addField, fieldTypes, validateTheme, schemaFor } from './gis.js';
import { readGeoJSON, readKML, writeKML, readZIP, writeZIP } from './gisformats.js';
import { readSHP, writeSHP } from './shapefile.js';
import { readGeoTIFF, rasterEntity, exportRaster } from './geotiff.js';
import { importDialog, exportDialog, attributeTable, chooseLayer, addFieldDialog, themeDialog, labelDialog, cadastralDialog } from './gisui.js';
const decode = b => new TextDecoder().decode(b), baseName = s => s.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''), stem = s => s.replace(/\.[^.]+$/, '').toLowerCase();
export async function importFiles(app, files, options = {}) {
  if (!app.doc.geo) throw Error('Configure GEOGRAPHICLOCATION antes de importar.');
  let entries = Object.create(null);
  for (const f of files) {
    const b = new Uint8Array(await f.arrayBuffer());
    if (/\.(zip|kmz)$/i.test(f.name)) { const archive = await readZIP(b); for (const [name, data] of Object.entries(archive)) { if (entries[name]) throw Error('Archivos repetidos en la importación.'); entries[name] = data; } }
    else entries[f.name] = b;
  }
  const names = Object.keys(entries), shapes = names.filter(n => /\.shp$/i.test(n)), kmls = names.filter(n => /\.kml$/i.test(n)), vectors = names.filter(n => /\.(geojson|json)$/i.test(n) && !/campos\.json$/i.test(n)), rasters = names.filter(n => /\.(tif|tiff)$/i.test(n));
  if (shapes.length + kmls.length + vectors.length + rasters.length !== 1) throw Error('Importe una sola capa o imagen por operación; los archivos compañeros del SHP se eligen juntos.');
  const doc = app.doc, layer = options.layer || baseName(shapes[0] || kmls[0] || vectors[0] || rasters[0]);
  if (rasters.length) {
    const r = await readGeoTIFF(entries[rasters[0]], options.overrideCRS, options.crs), entity = await rasterEntity(doc, r); entity.layer = layer; entity.name = rasters[0]; entity.pxw = r.width; entity.pxh = r.height;
    doc.begin(); try { if (!doc.layers.some(l => l.name === layer)) doc.addLayer(layer, '#ffffff'); return [doc.add(entity, doc.model).id]; } finally { doc.commit(); }
  }
  let collection, crs = options.crs || 'EPSG:4326', schemas;
  if (shapes.length) {
    const name = shapes[0], companion = ext => names.find(n => stem(n) === stem(name) && n.toLowerCase().endsWith(ext)), dbf = companion('.dbf'), prj = companion('.prj'), cpg = companion('.cpg'), encoding = cpg ? decode(entries[cpg]).trim().replace(/^65001$/, 'utf-8').replace(/^1252$/, 'windows-1252') : 'windows-1252';
    const result = readSHP(entries[name], dbf && entries[dbf], encoding); collection = result.collection; schemas = result.schema; if (prj) crs = decode(entries[prj]); if (options.overrideCRS) crs = options.overrideCRS;
  } else if (kmls.length) { collection = readKML(decode(entries[kmls[0]])); crs = 'EPSG:4326'; }
  else { collection = readGeoJSON(decode(entries[vectors[0]])); crs = 'EPSG:4326'; }
  return importFeatures(doc, collection, { crs, layer, schemas });
}
export async function exportData(app, options) {
  const { format, crs = app.doc.geo?.crs, layer, ids } = options, doc = app.doc;
  if (!doc.geo) throw Error('El dibujo no tiene georreferenciación.');
  if (format === 'GeoTIFF') {
    const rasters = doc.model.filter(e => e.gisRaster && (!ids || ids.includes(e.id)) && (!layer || e.layer === layer)); if (rasters.length !== 1) throw Error('Designe una única imagen GeoTIFF.');
    const e = rasters[0], bytes = options.original ? Uint8Array.from(atob(e.gisRaster.original), c => c.charCodeAt(0)) : await exportRaster(doc, e, crs);
    return { content: bytes, name: `${doc.name}.tif`, mime: 'image/tiff' };
  }
  const target = format === 'Shapefile ZIP' ? crs : 'EPSG:4326', fc = exportFeatures(doc, { crs: target, layer, ids });
  if (!fc.features.length) throw Error('No hay objetos vectoriales compatibles para exportar.');
  if (fc.omitted.length) app.print(`SIG: ${fc.omitted.length} objetos no vectoriales o de tipos no admitidos omitidos.`);
  const standard = { type: fc.type, features: fc.features };
  if (format === 'GeoJSON') return { content: JSON.stringify(standard, null, 2), name: `${doc.name}.geojson`, mime: 'application/geo+json' };
  if (format === 'KML') return { content: writeKML(standard), name: `${doc.name}.kml`, mime: 'application/vnd.google-earth.kml+xml' };
  if (format === 'KMZ') return { content: writeZIP({ 'doc.kml': writeKML(standard) }), name: `${doc.name}.kmz`, mime: 'application/vnd.google-earth.kmz' };
  if (format === 'Shapefile ZIP') return { content: writeZIP(writeSHP(standard, target, layer ? schemaFor(doc, layer) : undefined)), name: `${doc.name}.zip`, mime: 'application/zip' };
  throw Error('Formato de exportación no admitido.');
}
export function registerGIS(def) {
  def('MAPIMPORT', ['IMPORTARSIG', 'SIGIMPORT'], 'Importa GeoJSON, Shapefile, KML/KMZ o GeoTIFF con reproyección', async (c, arg) => {
    const data = arg || await importDialog(c.app); if (!data) return; c.print('Leyendo y reproyectando datos SIG…');
    const ids = await importFiles(c.app, data.files, data.options); c.app.sel = new Set(ids); c.app.selChanged(); c.app.zoomExtents(); c.print(`${ids.length} objetos SIG importados. Los atributos se consultan con MAPTABLE.`);
  }, { noTx: true, group: 'Geografía' });
  def('MAPEXPORT', ['EXPORTARSIG', 'SIGEXPORT'], 'Exporta datos SIG y atributos', async (c, arg) => {
    const options = arg || await exportDialog(c.app); if (!options) return;
    const result = await exportData(c.app, options), ext = '.' + result.name.split('.').pop(); await c.app.io.writeFile(new Blob([result.content], { type: result.mime }), result.name, result.mime, ext, 'Datos SIG', false); c.print(`Exportado: ${result.name}`);
  }, { noTx: true, group: 'Geografía' });
  def('MAPTABLE', ['ATRIBUTOSSIG', 'TABLASIG'], 'Consulta, filtra y edita atributos tipados', async (c, layer) => { await attributeTable(c.app, layer); }, { noTx: true, keepSel: true, group: 'Geografía' });
  def('MAPFIELD', ['CAMPOSIG'], 'Añade o suprime un campo de la capa', async c => {
    const layer = await chooseLayer(c.app); if (!layer) return;
    const action = await c.getKeyword('Campo de atributos', ['Añadir', 'Suprimir'], 'Añadir'); if (action === 'Añadir') { await addFieldDialog(c.app, layer); return; }
    const name = await c.getString('Nombre del campo que se suprime', { spaces: true }); if (!schemaFor(c.doc, layer).some(f => f.name === name)) throw Error('Campo inexistente.');
    c.doc.begin(); try { c.doc.gis.schemas[layer] = schemaFor(c.doc, layer).filter(f => f.name !== name); for (const e of c.doc.model.filter(e => e.layer === layer)) c.doc.modify(e.id, q => { if (q.data) delete q.data[name]; }); if (c.doc.gis.themes[layer]?.field === name) delete c.doc.gis.themes[layer]; if (c.doc.gis.labels[layer]?.field === name) delete c.doc.gis.labels[layer]; c.doc.changed(); } finally { c.doc.commit(); c.app.renderer.flushTiles(); }
  }, { noTx: true, group: 'Geografía' });
  def('MAPTHEME', ['SIMBOLOGIASIG', 'TEMATICO'], 'Colores por categorías o rangos de un atributo', async (c, arg) => {
    const layer = arg?.layer || await chooseLayer(c.app); if (!layer) return; const theme = arg?.theme || await themeDialog(c.app, layer); if (!theme) return;
    if (!schemaFor(c.doc, layer).some(f => f.name === theme.field)) throw Error('Campo temático inexistente.');
    c.doc.gis.themes[layer] = validateTheme(theme); c.doc.changed(); c.app.renderer.flushTiles();
  }, { group: 'Geografía' });
  def('MAPLABEL', ['ETIQUETASSIG'], 'Etiquetas dinámicas tomadas de un atributo', async (c, arg) => {
    const layer = arg?.layer || await chooseLayer(c.app); if (!layer) return; const label = arg?.label || await labelDialog(c.app, layer); if (!label) return;
    if (!schemaFor(c.doc, layer).some(f => f.name === label.field) || !(label.height > 0) || !Number.isFinite(+label.height) || !/^#[0-9a-f]{6}$/i.test(label.color)) throw Error('Campo, altura o color de etiqueta inválidos.');
    c.doc.gis.labels[layer] = label; c.doc.changed(); c.app.renderer.flushTiles();
  }, { group: 'Geografía' });
  def('MAPCADASTRE', ['CATASTRO'], 'Añade campos catastrales configurables por proyecto', async (c, arg) => {
    const layer = arg?.layer || await chooseLayer(c.app); if (!layer) return; const fields = arg?.fields || await cadastralDialog(c.app); if (!fields) return;
    if (new Set(fields.map(f => f.name)).size !== fields.length || fields.some(f => !f.name || ['__proto__', 'constructor', 'prototype'].includes(f.name) || !fieldTypes.includes(f.type))) throw Error('Campos catastrales inválidos o repetidos.');
    c.doc.begin(); try { for (const f of fields) if (!c.doc.gis.schemas[layer]?.some(q => q.name === f.name)) addField(c.doc, layer, f); } finally { c.doc.commit(); }
    c.print('Esquema catastral añadido. Edite los datos con MAPTABLE.');
  }, { noTx: true, group: 'Geografía' });
}
