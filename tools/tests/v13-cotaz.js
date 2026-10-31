// Novedades de la v0.13 (1): cota Z. Coordenadas x,y,z, ELEV, Z de las líneas y elevación de los objetos planos,
// 3DPOLY (cota, desHacer, cerrar), 3DFACE (aristas invisibles, caras encadenadas), referencias a vértices 3D, propiedades,
// FLATTEN, deshacer, y paso por DXF 2007/2000/R12 (LINE 30/31, LWPOLYLINE 38, POLYLINE 3D, 3DFACE, mallas policara y M×N)
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const r4 = v => +(+v).toFixed(4);
const p3 = q => [r4(q.x), r4(q.y), r4(q.z || 0)];
const DXF = await import('./js/dxf.js'), E = await import('./js/entities.js');
const prop = (e, label) => E.propsOf(e).find(p => p.label === label);
const last = () => doc.model[doc.model.length - 1];
app.view.cx = 50; app.view.cy = 50; app.view.scale = 4; app.renderer.invalidate();

// ---- Coordenadas x,y,z y ELEV ----
out.parse = p3(app.parsePoint('10,20,5.5'));
app.lastPt = { x: 10, y: 20, z: 5.5 };
out.parseRel = p3(app.parsePoint('@1,2,0.5'));
out.line = await cmd('LINE', '0,0,100', '50,0,110', '');
const ln = last();
out.lineZ = { z1: ln.z1, z2: ln.z2, p1: Object.keys(ln.p1), inicioZ: prop(ln, 'Inicio Z').get(ln), finZ: prop(ln, 'Fin Z').get(ln) };
out.elev = await cmd('ELEV', '12.5');
await cmd('CIRCLE', '0,50', '5');
const ci = last();
out.circleElev = { elev: ci.elev, prop: prop(ci, 'Elevación').get(ci) };
await cmd('LINE', '0,60', '10,60', '');
out.lineElev = [last().z1, last().z2];
await cmd('ELEV', '0');
await cmd('TEXT', '0,70', '2.5', '0', 'cota');
out.textNoElev = 'elev' in last();

// ---- 3DPOLY: cota de los puntos sin Z, puntos con Z, desHacer y Cerrar ----
out.poly = await cmd('3DPOLY', 'E', '100', '0,0', '10,0,105', '20,0', '99,99', 'H', '20,10,110', 'C');
const pl = last();
out.poly3d = { type: pl.type, closed: !!pl.closed, pts: pl.pts.map(p3) };
out.polyProps = { n: prop(pl, 'Vértices').get(pl), len3: r4(prop(pl, 'Longitud 3D').get(pl)), len2: r4(prop(pl, 'Longitud en planta').get(pl)), zmin: prop(pl, 'Z mínima').get(pl), zmax: prop(pl, 'Z máxima').get(pl) };
// Edición de un vértice en Propiedades (Vértice, Vértice Z)
doc.begin(); doc.modify(pl.id, e => prop(e, 'Vértice').set(e, 3)); doc.modify(pl.id, e => prop(e, 'Vértice Z').set(e, 120)); doc.commit();
out.vertexEdit = { sel: prop(pl, 'Vértice').get(pl), z: pl.pts[2].z, x: prop(pl, 'Vértice X').get(pl) };
doc.undo();
out.vertexUndo = pl.pts[2].z;
// Referencia a objetos: el punto final de un vértice 3D lleva su Z
const sn = E.snapsOf(pl).end[1];
out.snapZ = sn.z;
// Desplazar y girar conservan la Z
doc.begin(); doc.modify(pl.id, e => E.xformEnt(e, [0, 1, -1, 0, 5, 5])); doc.commit();
out.rotKeepsZ = pl.pts.map(q => q.z);
doc.undo();

// ---- 3DFACE: triángulo con arista invisible y cara encadenada ----
const n0 = doc.model.length;
out.face = await cmd('3DFACE', '0,0,1', '10,0,2', 'I', '10,10,3', '', '0,20,4', '5,25,5', '');
const faces = doc.model.slice(n0);
out.faces = faces.map(f => ({ pts: f.pts.map(p3), hide: f.hide || null }));
out.faceProps = { z3: prop(faces[0], 'Vértice 3 Z').get(faces[0]), edge3: prop(faces[0], 'Arista 3 visible').get(faces[0]), area: r4(prop(faces[0], 'Área').get(faces[0])) };
out.facePrims = E.primsOf(faces[0]).length;

// ---- ID con un punto 3D ----
const hist = [];
const pr = app.print.bind(app); app.print = (m, ...a) => { hist.push(m); return pr(m, ...a); };
await cmd('ID', '1,2,3');
app.print = pr;
out.id = hist.find(m => /^X =/.test(m));

// ---- FLATTEN ----
const flatIds = [ln.id, ci.id, pl.id, faces[0].id];
out.flatten = await cmd('FLATTEN', sel(flatIds), '');
const pl2 = doc.model.find(e => e.type === 'pline' && e.pts.length === 4 && e.closed);
out.flattened = { line: [doc.get(ln.id).z1 ?? 0, doc.get(ln.id).z2 ?? 0], circle: doc.get(ci.id).elev ?? 0, poly: pl2 ? { type: pl2.type, elev: pl2.elev ?? 0, n: pl2.pts.length } : null, face: doc.get(faces[0].id).pts.map(q => q.z) };
doc.undo();
out.flattenUndo = { line: doc.get(ln.id).z2, poly3d: doc.get(pl.id)?.type, face: doc.get(faces[0].id).pts.map(q => q.z) };
await cmd('FLATTEN', sel([ci.id]), '7');
out.flattenTo7 = doc.get(ci.id).elev;

// ---- DXF: ida y vuelta en 2007, 2000 y R12 ----
const counts = r => r.ents.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
const round = ver => {
  const r = DXF.readDXF(DXF.writeDXF(doc, ver));
  const l = r.ents.find(e => e.type === 'line' && e.z2 === 110), c = r.ents.find(e => e.type === 'circle' && e.elev === 7);
  const p = r.ents.find(e => e.type === 'pline3d'), f = r.ents.filter(e => e.type === 'face3d');
  return { counts: counts(r), line: l ? [l.z1, l.z2] : null, circle: !!c, poly3d: p ? { pts: p.pts.map(p3), closed: !!p.closed } : null, faces: f.map(x => ({ z: x.pts.map(q => q.z), hide: x.hide || null })) };
};
out.rt2007 = round('2007');
out.rt2000 = round('2000');
out.rtR12 = round('R12');
const d00 = DXF.writeDXF(doc, '2000');
out.dxfCodes = { poly3d: /POLYLINE\r?\n[\s\S]*?AcDb3dPolyline/.test(d00), vertex32: /AcDb3dPolylineVertex/.test(d00), face: /3DFACE/.test(d00) };

// Malla policara (TIN de un programa de topografía) y malla poligonal 3 × 2: se importan como caras 3D
const g = (...a) => a.join('\n');
const v = (x, y, z, f) => g('0', 'VERTEX', '8', 'TIN', '10', x, '20', y, '30', z, '70', f);
const fr = (a, b, c) => g('0', 'VERTEX', '8', 'TIN', '10', 0, '20', 0, '30', 0, '70', 128, '71', a, '72', b, '73', c);
const pf = g('0', 'SECTION', '2', 'ENTITIES',
  '0', 'POLYLINE', '8', 'TIN', '66', 1, '10', 0, '20', 0, '30', 0, '70', 64, '71', 4, '72', 2,
  v(0, 0, 10, 192), v(10, 0, 11, 192), v(10, 10, 12, 192), v(0, 10, 13, 192), fr(1, 2, 3), fr(1, 3, -4), '0', 'SEQEND', '8', 'TIN',
  '0', 'POLYLINE', '8', 'MALLA', '66', 1, '10', 0, '20', 0, '30', 0, '70', 16, '71', 3, '72', 2,
  v(0, 0, 1, 64), v(0, 5, 2, 64), v(5, 0, 3, 64), v(5, 5, 4, 64), v(10, 0, 5, 64), v(10, 5, 6, 64), '0', 'SEQEND', '8', 'MALLA',
  '0', 'LWPOLYLINE', '8', 'CURVAS', '90', 3, '70', 0, '38', 245.5, '10', 0, '20', 0, '10', 5, '20', 1, '10', 9, '20', 0,
  '0', 'ENDSEC', '0', 'EOF');
const rm = DXF.readDXF(pf);
out.meshes = { faces: rm.ents.filter(e => e.type === 'face3d').map(f => ({ layer: f.layer, z: f.pts.map(q => q.z), hide: f.hide || null })), contour: rm.ents.filter(e => e.type === 'pline').map(e => e.elev) };

// ---- Archivo .tcad ----
const j = JSON.parse(JSON.stringify(doc.toJSON()));
out.tcad = { version: j.version, poly3d: j.model.some(e => e.type === 'pline3d' && e.pts.every(q => 'z' in q)), face: j.model.some(e => e.type === 'face3d') };
return out;
