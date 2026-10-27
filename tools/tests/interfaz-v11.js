// Interfaz de la v0.11: diálogos de SCP, vistas, selección rápida, filtros, búsqueda, OVERKILL, recorrer capas y filtros
// de capa; botones de la cinta; dibujo con ventanas en mosaico y con un SCP girado (sin errores en la consola)
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const base = { layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' };
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const modal = () => ({ title: $('#modal-root .modal-head span')?.textContent || null, btns: $$('#modal-root .modal-foot .btn').map(b => b.textContent) });
const press = label => { const b = $$('#modal-root .modal-foot .btn').find(x => x.textContent === label); b?.click(); return !!b; };
const inBody = label => { const b = $$('#modal-root .modal-body .btn').find(x => x.textContent.includes(label)); b?.click(); return !!b; };
doc.begin();
doc.ensureLayer('EJE', '#ff0000'); doc.ensureLayer('BORDE', '#00ff00');
for (let i = 0; i < 4; i++) doc.add({ ...base, type: 'circle', c: P(i * 20, 0), r: 2 + i * 2, layer: i % 2 ? 'EJE' : 'BORDE' });
doc.add({ ...base, type: 'text', p: P(0, 20), h: 2.5, rot: 0, text: 'Ruta Provincial 13' });
doc.add({ ...base, type: 'line', p1: P(0, 0), p2: P(60, 0) });
doc.add({ ...base, type: 'line', p1: P(0, 0), p2: P(60, 0) });
doc.commit();
app.zoomExtents();

out.ribbon = ['UCS', '!ucsworld', 'UCSMAN', 'VIEW', 'VPORTS', 'QSELECT', 'FILTER', 'FIND', 'OVERKILL', 'AUDIT', 'LAYISO', 'LAYWALK', 'LAYMRG', 'LAYFILTER'].filter(c => !document.querySelector(`.rb-btn[data-cmd="${c}"]`));

// SCP girado y ventanas en mosaico: se dibuja sin errores
await app.run('UCS', { o: P(10, 5), ang: Math.PI / 6 });
let p = app.run('VPORTS', { op: '3', dir: 'deRecha' }); await p;
app.updateMouse({ clientX: 300, clientY: 200 });
await tick(60);
out.tiles = app.tiles.length;
out.coordsUcs = $('.sb-coords').textContent;

// UCSMAN
p = app.run('UCSMAN'); await tick();
out.ucsman = modal();
press('Guardar actual…'); await tick();
out.ucsSavePrompt = modal().title;
$('#modal-root input.full').value = 'Eje 30'; press('Aceptar'); await tick();
out.ucsList = doc.ucsList.map(u => u.name);
press('Cerrar'); await p;

// VIEW
p = app.run('VIEW'); await tick();
out.view = modal();
press('Nueva…'); await tick();
$('#modal-root input.full').value = 'General'; press('Aceptar'); await tick();
out.views = doc.views.map(v => v.name);
press('Cerrar'); await p;

// QSELECT
app.run('UCS', 'Universal'); await tick();
p = app.run('QSELECT'); await tick();
out.qselect = modal();
const fl = [...$$('#modal-root .fld')].reduce((o, f) => { o[f.firstChild.textContent] = f.querySelector('select,input'); return o; }, {});
fl['Tipo de objeto'].value = 'circle'; fl['Tipo de objeto'].dispatchEvent(new Event('change'));
await tick();
const fl2 = [...$$('#modal-root .fld')].reduce((o, f) => { o[f.firstChild.textContent] = f.querySelector('select,input'); return o; }, {});
out.qsProps = [...fl2['Propiedad'].options].map(o => o.value).slice(0, 12);
fl2['Propiedad'].value = 'Radio'; fl2['Propiedad'].dispatchEvent(new Event('change'));
fl2['Operador'].value = '>='; fl2['Valor'].value = '6';
out.qsDatalist = $$('#modal-root datalist option').map(o => o.value);
press('Aceptar'); await p;
out.qsSel = app.sel.size;

// FILTER
p = app.run('FILTER'); await tick();
out.filter = modal();
inBody('Añadir condición'); await tick();
const row = $('#modal-root tbody tr');
const [tS, pS, oS] = row.querySelectorAll('select');
pS.value = 'Capa'; oS.value = '='; row.querySelector('input[type=text]').value = 'EJE';
press('Aplicar'); await tick();
out.filterAsk = app.req?.prompt;
app.submit(''); await p;
out.filterSel = app.sel.size;

// FIND
p = app.run('FIND'); await tick();
out.find = modal();
const fq = $$('#modal-root .fld input')[0], fr = $$('#modal-root .fld input')[1];
fq.value = 'ruta'; fr.value = 'RP';
inBody('Buscar'); await tick();
out.findRows = $$('#modal-root .find-res tbody tr').length;
out.findStatus = $$('#modal-root .modal-body p.hint').at(-1).textContent;
inBody('Reemplazar todo'); await tick();
out.findReplaced = doc.model.find(e => e.type === 'text').text;
press('Cerrar'); await p;

// OVERKILL
app.clearSel();
p = app.run('OVERKILL'); await tick();
out.overkillAsk = app.req?.prompt; app.submit(''); await tick();
out.overkill = modal();
press('Aceptar'); await p;
out.lines = doc.model.filter(e => e.type === 'line').length;

// LAYWALK
p = app.run('LAYWALK'); await tick();
out.laywalk = modal();
$$('#modal-root .walk-row').find(r => r.textContent.startsWith('EJE')).click(); await tick();
out.walkOn = doc.layers.filter(l => l.on).map(l => l.name);
press('Cerrar'); await p;
out.walkRestored = doc.layers.filter(l => l.on).length === doc.layers.length;

// Filtros de capa
p = app.run('LAYFILTER'); await tick();
out.layfilter = modal();
press('Nuevo de propiedades…'); await tick();
out.lfEditor = modal().title;
const nameIn = $$('#modal-root .fld input')[1];
nameIn.value = 'E*'; nameIn.dispatchEvent(new Event('input'));
out.lfCount = $$('#modal-root .modal-body p.hint').at(-1).textContent;
press('Aceptar'); await tick();
press('Usar en la paleta'); await p;
await tick(40);
out.paletteLayers = $$('.lay-list .lay-name').map(x => x.textContent);
out.paletteFilter = $('.lay-filter select')?.value;

// Unir ventanas con el ratón: clic en la ventana vecina
p = app.run('VPORTS', { op: 'Unir' }); await tick();
const other = app.tiles.find(t => t.view !== app.view);
app.onDown({ button: 0, pointerId: 9, clientX: other.view.ox + other.view.w / 2 + app.over.getBoundingClientRect().left, clientY: other.view.oy + other.view.h / 2 + app.over.getBoundingClientRect().top, pointerType: 'mouse', preventDefault() {} });
await p;
out.afterJoin = app.tiles.length;
await app.run('VPORTS', { op: 'ÚNica' });
out.single = app.tiles.length;
return out;
