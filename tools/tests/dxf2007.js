// DXF 2007: MULTILEADER (texto con formato, sin contenido, sin flecha), MLEADERSTYLE, degradados, grupos y Unicode.
// Se vuelve a importar y se guardan out2007.dxf y out2000.dxf para validarlos con otras herramientas.
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, DX = await import('./js/dxf.js'), E = await import('./js/entities.js');
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const base = { layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' };
doc.begin();
doc.addLayer('Anotación', '#ffd54f');
doc.mleaderStyles.push({ ...E.DEFAULT_MLSTYLE, name: 'Notas grandes', h: 5, asz: 4, land: 8, gap: 2 });
doc.add({ ...base, layer: 'Anotación', type: 'mleader', mstyle: 'Standard', w: 0, pts: [{ x: 0, y: 0 }, { x: 20, y: 15 }], content: 'mtext', text: 'Alcantarilla Ø800\ncota de solera −1,25', });
doc.add({ ...base, type: 'mleader', mstyle: 'Notas grandes', w: 40, pts: [{ x: 100, y: 0 }, { x: 90, y: 10 }, { x: 70, y: 20 }], content: 'mtext', text: '{\\fArial|b1;Negrita} y \\C1;rojo', rich: true });
doc.add({ ...base, type: 'mleader', mstyle: 'Standard', w: 0, pts: [{ x: 0, y: -30 }, { x: 15, y: -20 }], content: 'none', text: '' });
doc.add({ ...base, type: 'mleader', mstyle: 'Standard', w: 0, pts: [{ x: 40, y: -30 }, { x: 55, y: -20 }], content: 'mtext', text: 'Sin flecha', arrow: 'none' });
doc.add({ ...base, type: 'mleader', mstyle: 'Standard', w: 0, pts: [{ x: 80, y: -30 }, { x: 95, y: -20 }], content: 'block', text: '7' });
// Degradados de todos los tipos
const types = ['LINEAR', 'CYLINDER', 'INVCYLINDER', 'SPHERICAL', 'INVSPHERICAL', 'HEMISPHERICAL', 'INVHEMISPHERICAL'];
types.forEach((t, i) => doc.add({ ...base, type: 'hatch', pattern: 'GRADIENT', scale: 1, angle: i * 15, loops: [[{ x: i * 30, y: 50 }, { x: i * 30 + 25, y: 50 }, { x: i * 30 + 25, y: 70 }, { x: i * 30, y: 70 }]], grad: { type: t, c1: '#1e90d6', c2: '#ffffff', centered: i % 2 === 0 } }));
// Texto con caracteres no ASCII y un grupo
const t = doc.add({ ...base, type: 'text', p: { x: 0, y: 90 }, h: 3, rot: 0, text: 'Señalización vertical — ±0,5 m²' });
const c = doc.add({ ...base, type: 'circle', c: { x: 50, y: 95 }, r: 4 });
doc.groups.push({ name: 'Rótulo', desc: 'Texto y círculo', ids: [t.id, c.id], sel: true });
doc.commit();
app.createLayout('Plano 1', 'A3');
await tick(20);
app.switchTab('model');

const d07 = DX.writeDXF(doc, '2007'), d00 = DX.writeDXF(doc, '2000');
out.header = { v07: /\$ACADVER\r\n  ?1\r\nAC1021/.test(d07) || d07.includes('AC1021'), v00: d00.includes('AC1015') };
out.counts = { mleader07: (d07.match(/\r\nMULTILEADER\r\n/g) || []).length, leader07: (d07.match(/\r\nLEADER\r\n/g) || []).length, styles07: (d07.match(/\r\nMLEADERSTYLE\r\n/g) || []).length,
  leader00: (d00.match(/\r\nLEADER\r\n/g) || []).length, grad07: (d07.match(/\r\n450\r\n1\r\n/g) || []).length, grad00: (d00.match(/\r\n450\r\n/g) || []).length };
out.unicode = { utf8: d07.includes('Señalización'), escaped: d00.includes('Se\\U+00F1alizaci\\U+00F3n') && !/[^\x00-\x7f]/.test(d00) };
const r = DX.readDXF(d07);
out.back = {
  mleaders: r.ents.filter(e => e.type === 'mleader').map(e => ({ c: e.content, text: e.text, rich: !!e.rich, n: e.pts.length, style: e.mstyle, h: e.h, land: e.land, arrow: e.arrow })),
  styles: r.mleaderStyles.map(s => [s.name, s.h, s.asz, s.land, s.gap]),
  grads: r.ents.filter(e => e.pattern === 'GRADIENT').map(e => [e.grad.type, Math.round(e.angle), e.grad.centered]),
  groups: r.groups.map(g => [g.name, g.handles.length]),
  text: r.ents.find(e => e.type === 'text')?.text,
  layouts: r.layouts.length,
};
// Geometría del MULTILEADER importado igual a la original
const orig = doc.model.filter(e => e.type === 'mleader' && e.content !== 'block'), imp = r.ents.filter(e => e.type === 'mleader' && e.content !== 'block');
out.sameGeom = orig.map((e, i) => { const a = E.mleaderGeom(e), b = E.mleaderGeom({ ...imp[i], layer: '0' }); return [Math.hypot(a.L.x - b.L.x, a.L.y - b.L.y) < 1e-6, Math.abs(E.mlEff(e).h - E.mlEff(imp[i]).h) < 1e-9]; });
return { ...out, d2007: d07, d2000: d00 };
