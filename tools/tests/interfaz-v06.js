// Diálogos y controles nuevos de la v0.6: se abren, se usan y se cierran sin errores
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, E = await import('./js/entities.js');
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const modal = () => document.querySelector('#modal-root .modal');
const btn = label => [...document.querySelectorAll('#modal-root .modal-foot .btn')].find(b => b.textContent === label);
const click = async label => { await tick(); const b = btn(label); if (!b) throw new Error(`No hay botón "${label}" en ${modal()?.querySelector('.modal-head span')?.textContent}`); b.click(); await tick(); };
// Ribbon y barra de estado
out.ribbon = ['GROUP', 'UNGROUP', 'GROUPEDIT', 'CLASSICGROUP', 'DIVIDE', 'MEASURE', 'AUTOCONSTRAIN', 'BLOOKUPTABLE', 'PATTERNS', '!dxf2007'].map(c => !!document.querySelector(`.rb-btn[data-cmd="${c}"]`));
out.status = [...document.querySelectorAll('.sb-tg')].some(b => b.textContent === 'GRUPO' && b.classList.contains('on'));
// Ctrl+Mayús+A alterna la selección de grupos
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', ctrlKey: true, shiftKey: true, bubbles: true }));
out.toggleGroups = app.T.groups;
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', ctrlKey: true, shiftKey: true, bubbles: true }));
// Grupos: administrador
await cmd('RECTANG', '0,0', '10,10'); await cmd('CIRCLE', '5,5', '2');
app.sel.clear(); doc.model.forEach(e => app.sel.add(e.id));
await cmd('GROUP');
out.anon = doc.groups.map(g => g.name);
let p = app.run('CLASSICGROUP');
await tick(30);
out.groupDlg = [...modal().querySelectorAll('tbody tr')].map(tr => tr.textContent);
await click('Seleccionable sí/no');
out.selectable = doc.groups[0].sel;
await click('Renombrar…');
modal().querySelector('input').value = 'Pieza'; await click('Aceptar');
out.renamed = doc.groups[0].name;
await tick(30);
await click('Designar');
await p;
out.designated = app.sel.size;
// Propiedades: fila «Grupo»
app.ui.showPalette('props'); app.ui.renderProps();
out.propGroup = [...document.querySelectorAll('.prop-row')].find(r => r.querySelector('label')?.textContent === 'Grupo')?.textContent;
app.sel.clear(); app.selChanged();
// Estados de capa: nuevo, restaurar
doc.begin(); doc.addLayer('Ejes', '#ff0000'); doc.commit();
p = app.run('LAYERSTATE');
await tick(30);
await click('Nuevo…');
modal().querySelector('input').value = 'Inicial'; await click('Aceptar');
await tick(30);
out.lsRows = [...modal().querySelectorAll('tbody tr')].map(tr => tr.textContent);
await click('Cerrar'); await p;
doc.begin(); doc.layer('Ejes').on = false; doc.commit();
p = app.run('LAYERSTATE'); await tick(30);
await click('Restaurar'); await p;
out.lsRestored = doc.layer('Ejes').on;
out.layerBtn = [...document.querySelectorAll('.rb-mini')].some(b => b.textContent === 'Estados');
// Patrones: pegar una definición y elegirlo en el selector de SOMBREADO
p = app.run('PATTERNS'); await tick(30);
await click('Pegar definición…');
modal().querySelector('textarea').value = '*TEJA, Teja\n0, 0,0, 0,4\n90, 0,0, 4,4, 4,-4\n';
await click('Cargar'); await tick(30);
out.patDlg = [...modal().querySelectorAll('.swatch-btn span')].map(s => s.textContent);
await click('Cerrar'); await p;
app.view.cx = 5; app.view.cy = 5; app.view.scale = 20; app.renderer.invalidate();
p = app.run('HATCH'); await tick(30);
app.submit('P'); await tick(40);
out.picker = [...modal().querySelectorAll('.swatch-btn span')].map(s => s.textContent).slice(-3);
[...modal().querySelectorAll('.swatch-btn')].find(b => b.textContent === 'TEJA').click();
await click('Aceptar');
app.submit('5,1'); await tick(30); app.submit(''); await p;
out.hatchPat = doc.model.filter(e => e.type === 'hatch').map(e => e.pattern);
// Propiedades de un sombreado de usuario
const hh = doc.model.find(e => e.type === 'hatch');
doc.begin(); doc.modify(hh.id, e => { e.pattern = 'USER'; e.user = { sp: 2, dbl: true }; }); doc.commit();
out.userProps = E.propsOf(doc.get(hh.id)).map(p => p.label);
out.patOptions = E.propsOf(doc.get(hh.id))[0].options().map(o => o[0]).slice(-3);
// Tabla de consulta (editor) en un bloque con un parámetro
await cmd('LINE', '50,0', '60,0', '');
app.sel.clear(); app.sel.add(doc.model.at(-1).id);
await cmd('BLOCK', 'BARRA', '50,0');
await app.run('BEDIT', 'BARRA');
const id0 = doc.ents[0].id;
await cmd('BPARAMETER', 'L', 'Largo', '50,0', '60,0', '59,-1', '61,1', async () => { await tick(); app.req.set.add(id0); app.submit(''); });
p = app.run('BLOOKUPTABLE'); await tick(); app.submit('50,5'); await tick(40);
out.lookupHead = [...modal().querySelectorAll('thead th')].map(t => t.textContent);
[...modal().querySelectorAll('.lay-bar .btn')].find(b => b.textContent.includes('Añadir fila')).click(); await tick();
const cells = modal().querySelectorAll('tbody tr:last-child input');
cells[0].value = 'Larga'; cells[0].dispatchEvent(new Event('change'));
cells[1].value = '25'; cells[1].dispatchEvent(new Event('change'));
await click('Aceptar'); await p;
out.lookupRows = doc.bedit.dyn.look.rows.map(r => [r.label, ...r.vals]);
app.renderer.drawBase();
await cmd('BCLOSE', 'S');
// Ayuda: novedades de la v0.6
app.ui.openHelp(); await tick(30);
out.help = modal().textContent.includes('Novedades de la v0.6');
await click('Cerrar');
return out;
