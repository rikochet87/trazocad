const { buildTIN, meshStats, sampleTIN, contours } = await import('./js/tin.js'),
  { adjustTraverse } = await import('./js/survey.js');
let checks = 0;
const assert = (v, m) => {
    checks++;
    if (!v) throw Error(m);
  },
  near = (a, b, t = 1e-7) => assert(Math.abs(a - b) < t, `${a} ≠ ${b}`);
const f = await (await fetch('./tools/fixtures/v17/delaunay.json')).json(),
  mesh = buildTIN(f.points),
  canon = ts => ts.map(t => [...t].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
assert(JSON.stringify(canon(mesh.triangles)) === JSON.stringify(canon(f.triangles)), 'Mismas caras que Qhull/SciPy');
for (const t of mesh.triangles) {
  const p = {
      x: t.reduce((s, i) => s + mesh.vertices[i].x, 0) / 3,
      y: t.reduce((s, i) => s + mesh.vertices[i].y, 0) / 3,
    },
    q = sampleTIN(mesh, p);
  near(q.z, 12 + 0.13 * p.x - 0.08 * p.y);
  near(q.slope, (Math.atan(Math.hypot(0.13, 0.08)) * 180) / Math.PI);
}
// Cualquier diagonal de un cuadrilátero convexo puede imponerse como línea de quiebre.
for (let i = 0; i < 15; i++) {
  const p = f.points.slice(i, i + 12),
    A = p[0],
    B = p.at(-1),
    m = buildTIN(p, { breaklines: [[A, B]] });
  assert(
    m.triangles.some(t => t.includes(0) && t.includes(p.length - 1)),
    'Restricción recuperada'
  );
}
// Superficie de control: límite cóncavo y dos zonas excluidas, área independiente por rectángulos.
const plane = (x, y) => ({ x, y, z: x + 2 * y }),
  points = [];
for (let y = 0; y <= 10; y += 2) for (let x = 0; x <= 10; x += 2) points.push(plane(x, y));
const ring = [
    [0, 0],
    [10, 0],
    [10, 4],
    [6, 4],
    [6, 10],
    [0, 10],
  ].map(([x, y]) => ({ x, y })),
  holes = [
    [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ],
    [
      [4, 6],
      [5, 6],
      [5, 8],
      [4, 8],
    ],
  ].map(r => r.map(([x, y]) => ({ x, y })));
const clipped = buildTIN(points, { boundaries: [ring], holes });
near(meshStats(clipped).area, 70);
assert(!sampleTIN(clipped, { x: 8, y: 8 }) && !sampleTIN(clipped, { x: 2, y: 2 }), 'Concavidad y hueco');
for (const c of contours(clipped, { interval: 1, majorEvery: 5 }))
  for (let i = 1; i < c.pts.length; i++) {
    const a = c.pts[i - 1],
      b = c.pts[i];
    assert(
      sampleTIN(clipped, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) !== null,
      'Las curvas no cruzan zonas excluidas'
    );
  }
// Control Bowditch analítico de 4 lados: cierre 1E, longitud399, corrección -Li/399.
const legs = [
    { distance: 100, azimuth: 0 },
    { distance: 100, azimuth: 90 },
    { distance: 100, azimuth: 180 },
    { distance: 99, azimuth: 270 },
  ],
  r = adjustTraverse({ legs });
near(r.closure, 1);
near(r.precision, 399);
r.corrections.forEach((c, i) => near(c.x, -legs[i].distance / 399));
const tr = adjustTraverse({ legs, method: 'transit' });
near(tr.corrections[0].x, 0);
near(tr.corrections[1].x, -100 / 199);
near(tr.corrections[3].x, -99 / 199);
return { checks, referencia: f.generator, caras: mesh.triangles.length };
