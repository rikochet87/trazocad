// Diálogos y controles nuevos de la v0.7: se abren, se usan y se cierran sin errores
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, E = await import('./js/entities.js');
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const modal = () => document.querySelector('#modal-root .modal');
const btn = label => [...document.querySelectorAll('#modal-root .modal-foot .btn')].find(b => b.textContent === label);
const click = async label => { await tick(); const b = btn(label); if (!b) throw new Error(`No hay botón "${label}" en ${modal()?.querySelector('.modal-head span')?.textContent}`); b.click(); await tick(); };
// Cinta
out.ribbon = ['MLINE', 'MLSTYLE', 'ARRAYPATH', 'ARRAYEDIT', 'REGION', 'BOUNDARY', 'UNION', 'SUBTRACT', 'INTERSECT', 'DIMARC', 'DIMJOGGED', 'XCLIP'].map(c => !!document.querySelector(`.rb-btn[data-cmd="${c}"]`));
out.icons = [...document.querySelectorAll('.rb-btn[data-cmd="MLINE"] svg, .rb-btn[data-cmd="XCLIP"] svg')].map(s => s.innerHTML.length > 20);
// ESTILOLM: estilo nuevo con un tercer elemento, remate y relleno
let p = app.run('MLSTYLE');
for (let k = 0; k < 50 && !modal(); k++) await tick(20);
out.mlDlg = [...modal().querySelectorAll('.style-list option')].map(o => o.textContent);
[...modal().querySelectorAll('.style-btns .btn')].find(b => b.textContent.includes('Nuevo')).click(); await tick(30);
modal().querySelector('input').value = 'CALZADA'; await click('Aceptar'); await tick(30);
const addBtn = [...modal().querySelectorAll('.ml-elems .btn')].find(b => b.textContent.includes('Añadir elemento'));
addBtn.click(); await tick();
const offs = modal().querySelectorAll('.ml-elems input[type=number]');
offs[1].value = '0.25'; offs[1].dispatchEvent(new Event('change')); await tick();
const caps = [...modal().querySelectorAll('.fld.wide .chk input')];
caps[0].checked = true; caps[0].dispatchEvent(new Event('change'));
const fillChk = caps.find(c => c.parentElement.textContent.includes('Relleno'));
fillChk.checked = true; fillChk.dispatchEvent(new Event('change'));
out.preview = !!modal().querySelector('.style-prev canvas');
[...modal().querySelectorAll('.style-btns .btn')].find(b => b.textContent.includes('Actual')).click(); await tick();
await click('Aplicar'); await p;
const st = doc.mlineStyles.find(s => s.name === 'CALZADA');
out.mlStyle = st && { elems: st.elems.map(x => x.off), sLine: st.caps.sLine, fill: !!st.fill, current: doc.cur.mlineStyle };
// La línea múltiple nueva usa el estilo actual; Propiedades la muestra y la cambia
await cmd('MLINE', '0,0', '30,0', '30,20', '');
const ML = doc.model.at(-1);
app.sel.clear(); app.sel.add(ML.id); app.selChanged();
app.ui.showPalette('props'); app.ui.renderProps();
const rows = [...document.querySelectorAll('.prop-row')];
out.mlProps = rows.map(r => r.querySelector('label')?.textContent).filter(t => ['Estilo', 'Justificación', 'Escala', 'Cerrada'].includes(t));
const just = rows.find(r => r.querySelector('label')?.textContent === 'Justificación').querySelector('select');
just.value = 'bottom'; just.dispatchEvent(new Event('change'));
out.mlJust = doc.get(ML.id).just;
app.sel.clear(); app.selChanged();
// Matriz: propiedades editables
await cmd('CIRCLE', '100,0', '2');
await cmd('ARRAYRECT', async () => { await tick(); app.req.set.add(doc.model.at(-1).id); app.submit(''); }, '');
const AR = doc.model.at(-1);
app.sel.clear(); app.sel.add(AR.id); app.selChanged(); app.ui.renderProps();
const colsIn = [...document.querySelectorAll('.prop-row')].find(r => r.querySelector('label')?.textContent === 'Columnas').querySelector('input');
colsIn.value = '6'; colsIn.dispatchEvent(new Event('change'));
out.arrCols = doc.get(AR.id).cols;
// Pinzamientos cian de la matriz
out.arrGripKinds = E.TYPES.array.gripKinds(doc.get(AR.id));
app.renderer.drawOver();
app.sel.clear(); app.selChanged();
// Estados de capa: botones de importar y exportar archivos .las
p = app.run('LAYERSTATE'); await tick(30);
out.lsButtons = [...document.querySelectorAll('#modal-root .modal-foot .btn')].map(b => b.textContent);
await click('Cerrar'); await p;
// Ayuda
app.ui.openHelp(); await tick(30);
out.help = ['Novedades de la v0.7', 'ARRAYPATH', 'XCLIP', 'DIMJOGGED'].map(t => modal().textContent.includes(t));
await click('Cerrar');
app.renderer.drawBase();
return out;
