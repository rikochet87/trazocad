// Grupos (GROUP, UNGROUP, GROUPEDIT, selección de grupos, copias, DXF) y GRADUA / DIVIDE
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, DX = await import('./js/dxf.js');
const pick = (e, pt) => async () => { await tick(); app.req.resolve({ e: doc.get(e.id), pt }); };
const sel = ids => async () => { await tick(); for (const id of ids) app.req.set.add(id); app.submit(''); };
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const last = () => doc.model.at(-1);
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
app.view.cx = 50; app.view.cy = 25; app.view.scale = 4; app.renderer.invalidate();

// ---- GROUP con nombre y descripción ----
await cmd('RECTANG', '0,0', '20,10'); const R1 = last();
await cmd('CIRCLE', '10,5', '3'); const C1 = last();
await cmd('LINE', '40,0', '60,0', ''); const L1 = last();
out.group = await cmd('GROUP', 'N', 'Placa', 'D', 'Placa con taladro', sel([R1.id, C1.id]));
out.groups = doc.groups.map(g => ({ name: g.name, desc: g.desc, n: g.ids.length, sel: g.sel }));
// Designar un miembro designa el grupo entero (clic sobre el círculo)
app.sel.clear();
const s = app.view.toScreen({ x: 13, y: 5 }); app.mouse.sx = s.x; app.mouse.sy = s.y;
app.selectClick(false, app.sel);
out.pickGroup = [...app.sel].sort();
app.toggle('groups'); app.sel.clear(); app.selectClick(false, app.sel); out.pickSingle = [...app.sel]; app.toggle('groups');
app.sel.clear();
// ---- COPY del grupo: grupo sin nombre con las copias ----
out.copy = await cmd('COPY', sel([R1.id, C1.id]), '0,0', '0,30', '');
out.afterCopy = doc.groups.map(g => [g.name, g.ids.length]);
const anon = doc.groups.find(g => g.name.startsWith('*'));
out.anonMembers = anon.ids.map(id => doc.get(id).type).sort();
// ---- GROUPEDIT: añadir la línea, quitar el círculo, renombrar ----
out.geAdd = await cmd('GROUPEDIT', pick(R1, { x: 0, y: 5 }), 'A', sel([L1.id]));
out.afterAdd = doc.groups.find(g => g.name === 'Placa').ids.length;
out.geDel = await cmd('GROUPEDIT', 'N', 'Placa', 'E', sel([C1.id]));
out.afterDel = doc.groups.find(g => g.name === 'Placa').ids.map(id => doc.get(id).type).sort();
out.geRen = await cmd('GROUPEDIT', 'N', 'Placa', 'R', 'Soporte');
out.renamed = doc.groups.map(g => g.name);
// ---- Borrar un miembro lo quita del grupo; deshacer lo devuelve ----
await cmd('ERASE', sel([L1.id]));
out.afterErase = doc.groups.find(g => g.name === 'Soporte').ids.length;
await cmd('UNDO');
out.afterUndo = doc.groups.find(g => g.name === 'Soporte').ids.length;
// ---- DXF: grupos con reactores, y vuelta ----
const d07 = DX.writeDXF(doc, '2007');
out.dxfGroups = { objects: (d07.match(/\nGROUP\r\n/g) || []).length, reactors: (d07.match(/\{ACAD_REACTORS/g) || []).length };
const rr = DX.readDXF(d07);
out.dxfBack = rr.groups.map(g => ({ name: g.name, desc: g.desc, n: g.handles.length, found: g.handles.every(h => rr.ents.some(e => e._h === h)) }));
// ---- UNGROUP por nombre y por designación ----
out.ung1 = await cmd('UNGROUP', 'N', 'Soporte');
out.ung2 = await cmd('UNGROUP', sel([anon.ids[0]]));
out.left = doc.groups.length;

// ---- DIVIDE y GRADUA ----
await cmd('LINE', '0,-20', '100,-20', ''); const L = last();
out.divLine = await cmd('DIVIDE', pick(L, { x: 10, y: -20 }), '5');
out.divPts = doc.model.filter(e => e.type === 'point').map(e => [+e.p.x.toFixed(6), +e.p.y.toFixed(6)]);
await cmd('ERASE', sel(doc.model.filter(e => e.type === 'point').map(e => e.id)));
// GRADUA desde el extremo más próximo al punto designado (el derecho)
out.meLine = await cmd('MEASURE', pick(L, { x: 95, y: -20 }), '30');
out.mePts = doc.model.filter(e => e.type === 'point').map(e => +e.p.x.toFixed(6));
await cmd('ERASE', sel(doc.model.filter(e => e.type === 'point').map(e => e.id)));
// Círculo: DIVIDE en 4 (cerrado: 4 puntos, el primero en el ángulo 0)
await cmd('CIRCLE', '0,-60', '10'); const K = last();
await cmd('DIVIDE', pick(K, { x: 10, y: -60 }), '4');
out.divCircle = doc.model.filter(e => e.type === 'point').map(e => [+e.p.x.toFixed(6), +e.p.y.toFixed(6)]);
await cmd('ERASE', sel(doc.model.filter(e => e.type === 'point').map(e => e.id)));
// Polilínea con arco: GRADUA con un bloque alineado
await cmd('PLINE', '30,-80', '50,-80', 'A', '70,-60', '');
const PL = last();
await cmd('LINE', '-1,0', '1,0', ''); const t1 = last();
await cmd('LINE', '0,-1', '0,1', ''); const t2 = last();
app.sel.clear(); app.sel.add(t1.id); app.sel.add(t2.id);
await cmd('BLOCK', 'MOJON', '0,0');
const before = doc.model.length;
out.meBlock = await cmd('MEASURE', pick(PL, { x: 31, y: -80 }), 'B', 'MOJON', 'S', '10');
const ins = doc.model.slice(before).filter(e => e.type === 'insert' && e.name === 'MOJON');
const Ltot = 20 + Math.PI / 2 * 20;
out.meBlockN = [ins.length, Math.floor(Ltot / 10 - 1e-9)];
out.meBlockRot = ins.map(e => +(e.rot * 180 / Math.PI).toFixed(3));
out.meBlockLast = [+ins.at(-1).p.x.toFixed(4), +ins.at(-1).p.y.toFixed(4)];
// sin alinear y DIVIDE con bloque
out.divBlock = await cmd('DIVIDE', pick(PL, { x: 31, y: -80 }), 'B', 'MOJON', 'N', '3');
out.divBlockRot = doc.model.slice(-2).map(e => e.rot);
// Spline y elipse
await cmd('ELLIPSE', 'C', '0,-120', '20,-120', '10');
const EL = last();
out.divEll = await cmd('DIVIDE', pick(EL, { x: 20, y: -120 }), '6');
out.divEllFirst = doc.model.filter(e => e.type === 'point').slice(-6).map(e => [+e.p.x.toFixed(3), +e.p.y.toFixed(3)])[0];
out.errors = doc.model.length;
return out;
