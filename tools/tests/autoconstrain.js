// AUTOCONSTRAIN: restricciones automáticas sin redundancias, tolerancias y comportamiento posterior
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, E = await import('./js/entities.js'), C = await import('./js/constraints.js');
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const last = () => doc.model.at(-1);
const types = () => { const c = {}; for (const k of doc.constraints) c[k.type] = (c[k.type] || 0) + 1; return c; };
// 1. Rectángulo de cuatro líneas
await cmd('LINE', '0,0', '60,0', '60,40', '0,40', 'C');
const L = doc.model.slice(-4);
out.rect = await cmd('AUTOCONSTRAIN', sel(L.map(e => e.id)));
out.rectTypes = types();
// Repetirlo no añade nada
out.again = await cmd('AUTOCONSTRAIN', sel(L.map(e => e.id)));
out.againN = doc.constraints.length;
// Arrastrar una esquina: sigue siendo un rectángulo
doc.begin(); doc.modify(L[1].id, e => E.TYPES.line.moveGrip(e, 2, { x: 80, y: 50 })); doc.commit();
const q = L.map(e => doc.get(e.id));
out.afterDrag = q.map(e => [e.p1, e.p2].map(p => [+p.x.toFixed(4), +p.y.toFixed(4)]));
out.stillRect = Math.abs(q[0].p1.y - q[0].p2.y) < 1e-6 && Math.abs(q[1].p1.x - q[1].p2.x) < 1e-6 && Math.abs(q[2].p1.y - q[2].p2.y) < 1e-6 && Math.abs(q[3].p1.x - q[3].p2.x) < 1e-6;
await cmd('DELCONSTRAINT', sel(L.map(e => e.id)));
// 2. Geometría casi alineada: dentro de las tolerancias se ajusta
await cmd('LINE', '100,0', '150,0.3', ''); const A = last();          // 0,34° → horizontal
await cmd('LINE', '150.02,0.31', '150.5,30', ''); const B = last();   // extremo a 0,022 → coincidente; casi vertical
await cmd('LINE', '100,0', '100.2,30', ''); const Cc = last();
out.near = await cmd('AUTOCONSTRAIN', sel([A.id, B.id, Cc.id]));
out.nearTypes = types();
const a = doc.get(A.id), b = doc.get(B.id);
out.nearGeom = { horiz: Math.abs(a.p2.y - a.p1.y) < 1e-6, joined: Math.hypot(a.p2.x - b.p1.x, a.p2.y - b.p1.y) < 1e-6 };
await cmd('DELCONSTRAINT', sel([A.id, B.id, Cc.id]));
// Con tolerancia de ángulo 0,1° la línea A ya no es horizontal
doc.begin(); doc.modify(A.id, e => { e.p2 = { x: 150, y: 0.3 }; }); doc.modify(B.id, e => { e.p1 = { x: 150, y: 0.3 }; }); doc.commit();
out.tight = await cmd('AUTOCONSTRAIN', 'P', '0.05', '0.1', '', sel([A.id]));
out.tightTypes = types();
await cmd('DELCONSTRAINT', sel([A.id]));
// Con la horizontal desactivada
out.offH = await cmd('AUTOCONSTRAIN', 'P', '0.05', '1', 'H', 'V', '', sel([A.id, B.id]));
out.offTypes = types();
out.settings = doc.settings.autoCons;
await cmd('DELCONSTRAINT', sel([A.id, B.id]));
// 3. Tangencia, concentricidad e igualdad de radios
await cmd('CIRCLE', '0,100', '10'); const K1 = last();
await cmd('CIRCLE', '0,100', '5'); const K2 = last();
await cmd('CIRCLE', '40,100', '10'); const K3 = last();
await cmd('LINE', '-20,110', '60,110', ''); const T = last();       // tangente a K1 y a K3 por arriba
out.circ = await cmd('AUTOCONSTRAIN', 'P', '0.05', '1', 'H', 'V', '', sel([K1.id, K2.id, K3.id, T.id]));
out.circTypes = types();
// cambiar el radio de K1 arrastra K3 (igual) y la tangente
doc.begin(); doc.modify(K1.id, e => { e.r = 12; }); doc.commit();
const k3 = doc.get(K3.id), t = doc.get(T.id);
out.circAfter = { r3: +k3.r.toFixed(6), tanDist: +Math.abs((t.p2.x - t.p1.x) * (t.p1.y - k3.c.y) - (t.p1.x - k3.c.x) * (t.p2.y - t.p1.y)) / Math.hypot(t.p2.x - t.p1.x, t.p2.y - t.p1.y), conc: Math.hypot(doc.get(K2.id).c.x - doc.get(K1.id).c.x, doc.get(K2.id).c.y - doc.get(K1.id).c.y) < 1e-6 };
await cmd('DELCONSTRAINT', sel([K1.id, K2.id, K3.id, T.id]));
// 4. Polilínea cerrada con un arco y un punto sobre ella
await cmd('PLINE', '200,0', '260,0', '260,40', 'A', '200,40', 'L', 'C');
const PL = last();
await cmd('POINT', '230,0', ''); const PT = last();
out.pl = await cmd('AUTOCONSTRAIN', 'P', '0.05', '1', '', sel([PL.id, PT.id]));
out.plTypes = types();
// El rango del jacobiano: ninguna restricción redundante
const res = C.solve(doc);
out.solveOk = res.ok;
// 5. Rendimiento con muchas líneas (rejilla 8×8 de cuadrados)
const t0 = performance.now();
doc.begin();
const many = [];
for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const x = 400 + i * 12, y = j * 12; many.push(doc.add({ type: 'pline', pts: [{ x, y }, { x: x + 10, y }, { x: x + 10, y: y + 10 }, { x, y: y + 10 }], closed: true })); }
doc.commit();
const r = C.autoConstrain(doc, many.map(e => e.id), C.AUTO_DEFAULT);
out.manyN = r.cons.length;
out.manyCounts = r.counts;
out.manyMs = Math.round(performance.now() - t0);
return out;
