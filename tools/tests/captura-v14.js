// Captura reproducible sin servicios externos: mapa sintético XYZ, dibujo UTM con origen local y corredor ilustrativo.
const { validateGeo, fromGeographic } = await import('./js/geographic.js'), { OSM, visibleTiles } = await import('./js/basemap.js'), ORG = await import('./js/origin.js');
const doc = app.doc;
doc.geo = validateGeo({ crs: 'EPSG:32721', format: 'dms' });
doc.basemap = { ...OSM, enabled: false, opacity: 0.9, url: location.origin + '/mapa-demo/{z}/{x}/{y}.png', attribution: 'Mapa sintético de demostración · sin datos cartográficos' };
doc.name = 'Corredor ilustrativo — UTM 21S';
const coords = [[-58.485, -34.67], [-58.477, -34.666], [-58.47, -34.66], [-58.463, -34.654], [-58.454, -34.649], [-58.446, -34.642], [-58.437, -34.636]];
const pts = coords.map(([lon, lat]) => fromGeographic(doc, { lon, lat }));
doc.begin(); doc.addLayer('EJE DE ESTUDIO', '#ffcc33'); doc.addLayer('FAJA DE ESTUDIO', '#22e0e0'); doc.addLayer('PROGRESIVAS', '#ffffff');
const axis = doc.add({ type: 'pline', pts, closed: false, layer: 'EJE DE ESTUDIO', lw: 0.8 });
for (const side of [-1, 1]) doc.add({ type: 'pline', pts: pts.map(p => ({ x: p.x + side * 85, y: p.y - side * 70 })), layer: 'FAJA DE ESTUDIO', lw: 0.35 });
for (let i = 0; i < pts.length; i++) {
  doc.add({ type: 'circle', c: pts[i], r: 25, layer: 'PROGRESIVAS' });
  doc.add({ type: 'text', p: { x: pts[i].x + 65, y: pts[i].y + 35 }, text: `${i}+000`, h: 44, rot: 0, layer: 'PROGRESIVAS' });
}
ORG.setOrigin(doc, { x: 370000, y: 6165000 }); doc.commit();
const center = fromGeographic(doc, { lon: -58.459, lat: -34.651 });
app.view.cx = center.x; app.view.cy = center.y; app.view.scale = 0.17; app.view.rot = 0;
app.T.grid = false; app.T.lwt = true; app.ui.showPalette('props'); app.sel = new Set([axis.id]); app.selChanged();
const tab = [...document.querySelectorAll('#ribbon-tabs button')].find(el => el.textContent.includes('Geografía')); tab?.click();
app.ui.updateCoords(center);
// Teselas de demostración creadas por el guion: permiten repetir la captura sin Internet y sin representar cartografía real.
const tiles = visibleTiles(doc, app.renderer.R(), { ...doc.basemap, enabled: true });
for (const t of tiles) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const c = cv.getContext('2d');
  c.fillStyle = '#dcd9cb'; c.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const green = (t.x * 3 + t.y * 7 + i * 5 + j * 3) % 11 < 3;
    c.fillStyle = green ? '#b4c99e' : '#c8c3b5'; c.fillRect(i * 64 + 7, j * 64 + 7, 50, 50);
    if (!green) { c.strokeStyle = '#e9e5dc'; c.lineWidth = 2; c.strokeRect(i * 64 + 15, j * 64 + 15, 34, 34); }
  }
  for (const color of ['#b6b2a8', '#f9f5e9']) { c.strokeStyle = color; c.lineWidth = color === '#b6b2a8' ? 8 : 6; c.beginPath(); for (let k = 0; k <= 256; k += 64) { c.moveTo(k, 0); c.lineTo(k, 256); c.moveTo(0, k); c.lineTo(256, k); } c.stroke(); }
  c.strokeStyle = '#e8c783'; c.lineWidth = 14; c.beginPath(); c.moveTo(0, 128); c.lineTo(256, 128); c.stroke(); c.strokeStyle = '#fff0bd'; c.lineWidth = 10; c.stroke();
  c.fillStyle = '#77786c'; c.font = '10px sans-serif'; c.fillText('SECTOR DEMO', 12, 121);
  const im = new Image(); im.src = cv.toDataURL(); await im.decode(); app.basemap.images.set(t.url, im);
}
app.basemap.revision++; doc.basemap.enabled = true;
const n = await app.basemap.prepare(app.renderer.R());
app.renderer.invalidate(); app.renderer.drawBase();
document.getElementById('cmd-history').replaceChildren();
app.print('TrazoCAD v0.14 · SIG 1 — georreferenciación y mapa base');
app.print('EPSG:32721 · WGS 84 / UTM 21S · X este / Y norte · origen local 370000, 6165000');
app.print(`Mapa sintético XYZ: ${n} teselas reproyectadas · corredor ilustrativo, sin validez de proyecto.`);
app.print('Puntos: GEO:latitud,longitud · mapa XYZ/WMS/WMTS · GPS con precisión y seguimiento');
await new Promise(r => setTimeout(r, 500));
return { teselas: n, crs: doc.geo.crs.code, origen: doc.origin };
