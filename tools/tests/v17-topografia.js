const { parseSurvey, adjustTraverse, pointAppearance } = await import('./js/survey.js'),
  { buildTIN, sampleTIN, contours, meshStats } = await import('./js/tin.js'),
  { runTopoJob } = await import('./js/topojobs.js'),
  { Doc } = await import('./js/document.js'),
  { labelEntity } = await import('./js/gis.js');
let checks = 0;
const assert = (v, m) => {
    checks++;
    if (!v) throw Error(m);
  },
  near = (a, b, t = 1e-7) => assert(Math.abs(a - b) < t, `${a} ≠ ${b}`),
  reject = async (fn, m) => {
    let ok = false;
    try {
      await fn();
    } catch {
      ok = true;
    }
    assert(ok, m);
  };
const csv = 'P;E;N;Z;D\n001;20,5;10,5;3,5;"CERCO; A"\n002;25;15;4;"doble ""comilla"""';
const rows = parseSurvey(csv, {
  format: 'PENZD',
  delimiter: ';',
  header: true,
  decimalComma: true,
});
assert(rows[0].number === '001' && rows[0].description === 'CERCO; A', 'CSV citado e identificadores');
near(rows[0].east, 20.5);
assert(rows[1].description === 'doble "comilla"', 'Escape CSV');
await reject(() => parseSurvey('1,2,3,4,a\n1,2,3,4,b'), 'Números repetidos');
await reject(() => parseSurvey('1,NaN,2,3,a'), 'No finitos');
assert(parseSurvey('# comentario\nA 10 20 30 COD', { delimiter: 'space' })[0].number === 'A', 'TXT espacios');
const tr = adjustTraverse({
  start: { x: 0, y: 0 },
  end: { x: 0, y: 0 },
  legs: [
    { distance: 100, azimuth: 0 },
    { distance: 100, azimuth: 90 },
    { distance: 100, azimuth: 180 },
    { distance: 99, azimuth: 270 },
  ],
});
near(tr.closure, 1);
near(tr.length, 399);
near(tr.points.at(-1).x, 0);
near(tr.points.at(-1).y, 0);
near(tr.corrections[0].x, -100 / 399);
await reject(
  () =>
    adjustTraverse({
      ...tr,
      start: { x: 0, y: 0 },
      legs: [{ distance: -1, azimuth: 0 }],
    }),
  'Tramo inválido'
);
const pts = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 10 },
  { x: 10, y: 10, z: 30 },
  { x: 0, y: 10, z: 20 },
  { x: 4, y: 3, z: 10 },
];
let mesh = buildTIN(pts);
assert(mesh.triangles.length === 4, 'Euler 5 vértices');
near(meshStats(mesh).area, 100);
const sample = sampleTIN(mesh, { x: 2, y: 3 });
near(sample.z, 8);
near(sample.percent, Math.sqrt(5) * 100);
near(sample.slope, (Math.atan(Math.sqrt(5)) * 180) / Math.PI);
assert(sampleTIN(mesh, { x: 20, y: 20 }) === null, 'Sin extrapolación');
await reject(() => buildTIN([...pts, { x: 0, y: 0, z: 5 }]), 'Mismo XY distintas Z');
const cs = contours(mesh, { interval: 5, majorEvery: 2 });
assert(cs.length > 0 && cs.some(c => c.major), 'Curvas mayores');
for (const c of cs)
  for (const p of c.pts) {
    near(p.x + 2 * p.y, c.level);
    near(p.z, c.level);
  }
const hole = [
  { x: 2, y: 2 },
  { x: 3, y: 2 },
  { x: 3, y: 3 },
  { x: 2, y: 3 },
];
mesh = buildTIN(pts, {
  holes: [hole],
  breaklines: [
    [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 10, z: 30 },
    ],
  ],
});
near(meshStats(mesh).area, 99);
assert(!sampleTIN(mesh, { x: 2.5, y: 2.5 }), 'Hueco respetado');
for (const [a, b] of mesh.constraints) {
  const mid = {
    x: (mesh.vertices[a].x + mesh.vertices[b].x) / 2,
    y: (mesh.vertices[a].y + mesh.vertices[b].y) / 2,
  };
  if (mid.x > 2 && mid.x < 3 && mid.y > 2 && mid.y < 3) continue;
  assert(
    mesh.triangles.some(t => t.includes(a) && t.includes(b)),
    'Arista obligatoria'
  );
}
const d = app.doc;
d.origin = { x: 1000, y: 2000 };
const result = await runTopoJob(app, {
  operation: 'points',
  text: '01,2000,1000,0,TERRENO\n02,2000,1010,10,TERRENO\n03,2010,1010,30,TERRENO\n04,2010,1000,20,TERRENO',
  outputLayer: 'PUNTOS',
});
assert(result.ids.length === 4, 'Importación worker');
near(d.get(result.ids[0]).p.x, 0);
assert(d.get(result.ids[0]).elev === 0, 'Cota independiente');
const before = d.state();
await reject(
  () =>
    runTopoJob(app, {
      operation: 'points',
      text: '01,0,0,0,x',
      outputLayer: 'ERROR',
    }),
  'Duplicados proyecto'
);
assert(d.state() === before, 'Error no muta dibujo');
await runTopoJob(app, {
  operation: 'configure',
  groups: [
    {
      name: 'Terreno',
      description: 'TER*',
      symbol: 'triangle',
      color: '#aabbcc',
      label: 'PZ',
    },
  ],
  keys: [],
});
assert(pointAppearance(d, d.get(result.ids[0])).symbol === 'triangle', 'Grupo dinámico');
assert(labelEntity(d, d.get(result.ids[0])).text === '01 · 0.000', 'Etiqueta dinámica');
d.undo();
assert(!d.topo.groups.length, 'Deshacer configuración');
d.redo();
const surface = await runTopoJob(app, {
  operation: 'tin',
  ids: result.ids,
  metersPerUnit: 1,
  zMetersPerUnit: 1,
  outputLayer: 'TIN',
});
assert(d.topo.surfaces.length === 1 && surface.ids.length === 2, 'TIN registrada');
d.undo();
assert(!d.topo.surfaces.length && !d.get(surface.ids[0]), 'Deshacer TIN completo');
d.redo();
const s = d.topo.surfaces[0],
  q = await runTopoJob(app, {
    operation: 'sample',
    surfaceId: s.id,
    point: { x: 2, y: 3 },
  });
near(q.elevation, 8);
const clone = new Doc();
clone.fromJSON(d.toJSON());
assert(clone.topo.surfaces[0].faceIds.length === 2, 'Persistencia TIN');
assert(clone.toJSON().version === 17, 'Versión 17');
const curves = await runTopoJob(app, {
  operation: 'contours',
  surfaceId: s.id,
  interval: 5,
  majorEvery: 2,
  outputLayer: 'CURVAS',
  labels: true,
});
assert(curves.curves > 0 && d.get(curves.ids[0]).type === 'pline3d', 'Curvas CAD');
d.undo();
assert(!d.layers.some(l => l.name === 'CURVAS'), 'Deshacer curvas y capas');
const analysis = await runTopoJob(app, {
  operation: 'analysis',
  surfaceId: s.id,
  mode: 'slope',
  outputLayer: 'PENDIENTE',
});
assert(d.get(analysis.ids[0]).topoAnalysis, 'Análisis coloreado');
near(d.get(analysis.ids[0]).data.valor, q.slope);
d.undo();
const state = d.state(),
  undos = d.undoS.length,
  ctrl = new AbortController();
let aborted = false;
try {
  await runTopoJob(app, {
    operation: 'tin',
    ids: result.ids,
    metersPerUnit: 1,
    outputLayer: 'CANCELADO',
    signal: ctrl.signal,
    onProgress: () => ctrl.abort(),
  });
} catch (e) {
  aborted = e.name === 'AbortError';
}
assert(aborted && state === d.state() && undos === d.undoS.length && !app.processingCancel, 'Cancelación limpia');
// Las consultas leen caras editadas; los resultados concurrentes se descartan.
d.begin();
for (const id of s.faceIds)
  d.modify(id, e => {
    e.pts = e.pts.map(p => ({ ...p, z: p.z + 5 }));
  });
d.commit();
near((await runTopoJob(app, { operation: 'sample', surfaceId: s.id, point: { x: 2, y: 3 } })).elevation, 13);
d.undo();
let stale = false,
  edited = false;
try {
  await runTopoJob(app, {
    operation: 'tin',
    ids: result.ids,
    metersPerUnit: 1,
    outputLayer: 'OBSOLETO',
    onProgress: () => {
      if (!edited) {
        edited = true;
        d.begin();
        d.modify(result.ids[0], e => {
          e.data.descripcion = 'MODIFICADO';
        });
        d.commit();
      }
    },
  });
} catch (e) {
  stale = e.message.includes('cambió');
}
assert(
  stale && !d.layers.some(l => l.name === 'OBSOLETO') && d.get(result.ids[0]).data.descripcion === 'MODIFICADO',
  'Descartar cálculo obsoleto sin perder la edición'
);
await reject(
  () =>
    buildTIN([
      { x: 1e30, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 0, z: 0 },
    ]),
  'Rechazar bins fuera de precisión'
);
await reject(
  () => contours({ vertices: [{ x: 0, y: 0, z: 1 }], triangles: [] }, { interval: 1e-30 }),
  'Intervalos no representables'
);
return { checks, caras: surface.ids.length, curvas: curves.curves };
