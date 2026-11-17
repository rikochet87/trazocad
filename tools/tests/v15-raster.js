const T = await import('./js/geotiff.js'), { validateGeo } = await import('./js/geographic.js'), { importFiles, exportData } = await import('./js/giscommands.js');
let checks = 0; const assert = (v, m) => { checks++; if (!v) throw Error(m); }, near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} ≠ ${b}`);
const fixture = async name => new Uint8Array(await (await fetch('./tools/fixtures/v15/' + name)).arrayBuffer());
for (const name of ['mdt-float.tif', 'mdt-deflate.tif', 'mdt-big.tif']) {
  const r = await T.readGeoTIFF(await fixture(name)); assert(r.width === 8 && r.height === 6 && r.data instanceof Float32Array, 'MDT ' + name); assert(r.data[0] === -9999 && r.nodata === -9999, 'NoData'); near(r.data[47], 6.75); near(T.pixelToWorld(r.transform, 0, 0).x, 371620); near(T.worldToPixel(r.transform, { x: 371650, y: 6170480 }).x, 3);
  const back = await T.readGeoTIFF(T.writeGeoTIFF(r)); assert([...back.data].every((v, i) => v === r.data[i]), 'GeoTIFF conserva valores ' + name); assert(back.crs.code === 32721, 'EPSG conservado');
}
const tile = await T.readGeoTIFF(await fixture('teselas16.tif')); assert(tile.width === 16 && tile.data[255] === 3315, 'Teselas deflate con predictor horizontal');
for (const name of ['lzw16.tif', 'packbits16.tif']) { const r = await T.readGeoTIFF(await fixture(name)); assert([...r.data].every((v, i) => v === i * 13), name); }
const doc = app.doc; doc.geo = validateGeo({ crs: 'EPSG:3857' });
const ids = await importFiles(app, [new File([await fixture('mdt-deflate.tif')], 'terreno.tif')], { layer: 'MDT' });
const im = doc.get(ids[0]); assert(im.type === 'image' && im.src.startsWith('data:image/png'), 'Imagen reproyectada'); assert(im.w > 80 && im.h > 60 && im.gisRaster.width === 8, 'Dimensiones originales y reproyección');
const image = new Image(); image.src = im.src; await image.decode(); const cv = document.createElement('canvas'); cv.width = image.width; cv.height = image.height; const c = cv.getContext('2d'); c.drawImage(image, 0, 0); assert(c.getImageData(0, 0, 1, 1).data[3] === 0, 'NoData transparente');
const original = await exportData(app, { format: 'GeoTIFF', ids, original: true }); assert((await T.readGeoTIFF(original.content)).data[47] === 6.75, 'Exportar MDT original numérico');
const current = await exportData(app, { format: 'GeoTIFF', ids, original: false, crs: 'EPSG:3857' }), r = await T.readGeoTIFF(current.content); assert(r.samples === 4 && r.crs.code === 3857, 'Exportar imagen actual georreferenciada');
const binary = JSON.parse(JSON.stringify(doc.toJSON())); doc.fromJSON(binary); assert(doc.get(ids[0]).gisRaster.original === im.gisRaster.original, 'Persistencia raster');
return { ok: true, checks, compresiones: ['sin compresión', 'deflate', 'predictor horizontal', 'LZW', 'PackBits'], endian: ['II', 'MM'] };
