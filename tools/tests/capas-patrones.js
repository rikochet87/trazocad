// Estados de capa (-LAYERSTATE y layerstates.js) y patrones de sombreado personalizados (.pat), de usuario y por DXF
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, DX = await import('./js/dxf.js'), LS = await import('./js/layerstates.js'), PT = await import('./js/patterns.js');
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const lay = n => doc.layer(n);
doc.begin(); doc.addLayer('Planimetría', '#ffffff'); doc.addLayer('Drenaje', '#00ffff'); doc.addLayer('Señalización', '#ffff00'); doc.commit();
// ---- Estados de capa ----
out.save1 = await cmd('-LAYERSTATE', 'G', 'Todo', '');
doc.begin(); lay('Drenaje').on = false; lay('Señalización').lock = true; lay('Planimetría').color = '#ff0000'; doc.cur.layer = 'Planimetría'; doc.commit();
out.save2 = await cmd('-LAYERSTATE', 'G', 'Sin drenaje', 'D', 'Sin drenaje', 'Vista para planimetría', '');
out.list = doc.layerStates.map(s => ({ name: s.name, desc: s.desc, cur: s.cur, n: Object.keys(s.layers).length }));
out.restore = await cmd('-LAYERSTATE', 'R', 'Todo', '');
out.afterRestore = ['Drenaje', 'Señalización', 'Planimetría'].map(n => [n, lay(n).on, lay(n).lock, lay(n).color]).concat([[doc.cur.layer]]);
await cmd('UNDO');
out.undo = [lay('Drenaje').on, lay('Planimetría').color];
// Restaurar sólo el color, desactivando las capas nuevas
doc.begin(); doc.addLayer('Nueva', '#00ff00'); doc.commit();
const st = LS.findLayerState(doc, 'todo');
doc.begin(); out.partial = LS.restoreLayerState(doc, st, { props: ['color'], offMissing: true }); doc.commit();
out.afterPartial = [lay('Planimetría').color, lay('Drenaje').on, lay('Nueva').on];
out.matches = doc.layerStates.map(s => [s.name, LS.layerStateMatches(doc, s)]);
// Renombrar una capa actualiza los estados
doc.begin(); LS.renameLayerInStates(doc, 'Drenaje', 'Desagües'); lay('Drenaje').name = 'Desagües'; doc.commit();
out.renamedInState = Object.keys(st.layers).includes('Desagües');
out.ren = await cmd('-LAYERSTATE', 'O', 'Sin drenaje', 'Planimetría sola', '');
out.del = await cmd('-LAYERSTATE', 'E', 'Todo', '');
out.final = doc.layerStates.map(s => s.name);
// Se guardan en el archivo
const json = JSON.parse(JSON.stringify(doc.toJSON()));
out.file = { version: json.version, states: json.layerStates.length };

// ---- Patrones .pat ----
const pat = `;; patrones de prueba
*LADRILLO45, Ladrillo a 45 grados
45, 0,0, 0,6
135, 0,0, 0,12, 6,-6
*PUNTOS-CR, Puntos al tresbolillo ; comentario
0, 0,0, 2,2, 0,-4
*ANSI31, ya predefinido
45, 0,0, 0,3.175
*MALO
0, 0,0
`;
out.load = await (async () => { const p = app.run('PATTERNS', { text: pat, src: 'prueba.pat' }); await p; return Object.keys(doc.patterns); })();
out.parse = PT.parsePat(pat).errors;
out.inch = PT.parsePat('*X\n0, 0,0, 0,0.125\n', 25.4).pats.X.fam[0];
out.patText = PT.patText('LADRILLO45', doc.patterns.LADRILLO45);
// Sombreado con un patrón personalizado
app.view.cx = 50; app.view.cy = 50; app.view.scale = 4; app.renderer.invalidate();
await cmd('RECTANG', '0,0', '40,30');
doc.settings.hatchPat = 'LADRILLO45';
out.hatch = await cmd('HATCH', '20,15', '');
const h1 = doc.model.find(e => e.type === 'hatch');
out.h1 = [h1.pattern, PT.famsOf(h1).length];
// Sombreado definido por el usuario (cruzado, separación 5)
await cmd('RECTANG', '60,0', '100,30');
out.user = await cmd('HATCH', 'U', '5', 'S', '80,15', '');
const h2 = doc.model.find(e => e.type === 'hatch' && e.pattern === 'USER');
out.h2 = [h2.pattern, h2.user, PT.famsOf(h2).map(f => [Math.round(f.ang * 180 / Math.PI), f.dy])];
// Exportación SVG/explosión con el patrón personalizado
const OPS = await import('./js/ops.js');
out.explode = OPS.explodeEntity(h1).length > 10;
// DXF: patrón personalizado (76=2) y de usuario (_USER, 76=0), y vuelta
for (const v of ['2000', '2007']) {
  const d = DX.writeDXF(doc, v);
  const r = DX.readDXF(d);
  const hs = r.ents.filter(e => e.type === 'hatch');
  out['dxf' + v] = { names: hs.map(e => e.pattern), pats: Object.keys(r.patterns), fam: r.patterns.LADRILLO45?.fam, user: hs.find(e => e.pattern === 'USER')?.user, layers: r.layers.map(l => l.name).filter(n => /ñ|í/.test(n)), escaped: v === '2000' ? /Se\\U\+00F1alizaci\\U\+00F3n/.test(d) : d.includes('Señalización') };
}
// Patrón en uso: PURGE no lo elimina; sin uso sí
doc.begin(); doc.patterns.SIN_USO = { desc: '', fam: [[0, 0, 0, 0, 1]] }; doc.commit();
await cmd('PURGE');
out.purge = Object.keys(doc.patterns);
return out;
