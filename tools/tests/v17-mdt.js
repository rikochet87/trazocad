const { runTopoJob } = await import('./js/topojobs.js'),
  { validateGeo } = await import('./js/geographic.js'),
  { writeGeoTIFF } = await import('./js/geotiff.js'),
  { importFiles } = await import('./js/giscommands.js');
let checks = 0;
const assert = (v, m) => {
    checks++;
    if (!v) throw Error(m);
  },
  near = (a, b, t = 1e-6) => assert(Math.abs(a - b) < t, `${a} ≠ ${b}`);
const d = app.doc;
d.geo = validateGeo({ crs: 'EPSG:32721' });
d.origin = { x: 371600, y: 6170400 };
const width = 7,
  height = 7,
  data = new Float32Array(width * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = 100 + x + 2 * y;
data[3 * width + 3] = -9999;
const bytes = writeGeoTIFF({
    width,
    height,
    data,
    bits: 32,
    format: 3,
    samples: 1,
    photo: 1,
    transform: [371620, 10, 0, 6170500, 0, -10],
    crs: 'EPSG:32721',
    nodata: -9999,
  }),
  original = await importFiles(app, [new File([bytes], 'control.tif')], {
    layer: 'MDT',
  }),
  source = JSON.stringify(d.get(original[0]));
const result = await runTopoJob(app, {
  operation: 'mdt',
  id: original[0],
  step: 1,
  zMetersPerUnit: 1,
  outputLayer: 'TIN_MDT',
});
assert(result.ids.length === 64, '36 celdas menos 4 afectadas por NoData, dos triángulos por celda');
assert(JSON.stringify(d.get(original[0])) === source, 'MDT intacto');
const surfaceId = result.surfaceId;
const q = await runTopoJob(app, {
  operation: 'sample',
  surfaceId,
  point: { x: 30, y: 90 },
});
near(q.elevation, 101.5);
near(q.percent, Math.hypot(0.1, 0.2) * 100);
assert(
  (await runTopoJob(app, {
    operation: 'sample',
    surfaceId,
    point: { x: 55, y: 65 },
  })) === null,
  'NoData no se rellena'
);
const stats = await runTopoJob(app, { operation: 'stats', surfaceId });
near(stats.area, 3200);
d.undo();
assert(!d.topo.surfaces.length && !!d.get(original[0]), 'Deshacer superficie conserva imagen');
const coarse = await runTopoJob(app, {
  operation: 'mdt',
  id: original[0],
  step: 2,
  zMetersPerUnit: 1,
  outputLayer: 'TIN_PASO2',
});
assert(coarse.ids.length === 16, 'NoData intermedio impide puentear una celda de muestreo');
d.undo();
d.begin();
d.modify(original[0], e => {
  e.p.x += 10;
});
d.commit();
const before = d.state();
let rejected = false;
try {
  await runTopoJob(app, {
    operation: 'mdt',
    id: original[0],
    step: 1,
    outputLayer: 'MAL',
  });
} catch (e) {
  rejected = e.message.includes('georreferenciación');
}
assert(rejected && before === d.state(), 'Rechazar fuente desplazada sin mutar');
return { checks, caras: result.ids.length };
