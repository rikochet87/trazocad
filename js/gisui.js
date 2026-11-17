// Diálogos SIG independientes de la cinta y de los formatos de archivo.
import { fieldTypes, addField, setValue, queryRows, validateTheme, schemaFor } from './gis.js';
const h = (tag, attrs = {}, ...children) => { const el = document.createElement(tag); for (const [key, value] of Object.entries(attrs)) { if (key === 'class') el.className = value; else if (key.startsWith('on')) el.addEventListener(key.slice(2), value); else if (key in el) el[key] = value; else el.setAttribute(key, value); } for (const c of children.flat()) if (c != null) el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(c) : c); return el; };
const option = (v, label = v) => h('option', { value: v }, label);
const field = (label, el) => h('label', { class: 'fld' }, label, el);
const layers = app => app.doc.layers.map(l => l.name);
const select = (values, value) => { const el = h('select', {}, values.map(v => option(v))); if (value != null) el.value = value; return el; };
const transact = (app, fn) => { app.doc.begin(); try { fn(); } finally { app.doc.commit(); app.renderer.flushTiles(); app.ui.refresh(); } };
export async function chooseLayer(app) {
  const el = select(layers(app), app.doc.cur.layer);
  return app.ui.modal('Capa de datos SIG', field('Capa', el), [{ label: 'Cancelar', value: null }, { label: 'Aceptar', value: () => el.value, primary: true }]);
}
export async function importDialog(app) {
  const force = h('input', { type: 'checkbox' }), source = h('input', { value: 'EPSG:4326' }), layer = h('input', { value: 'SIG' }), error = h('p', { role: 'alert', class: 'hint' }), fileInput = h('input', { type: 'file', multiple: true, accept: '.geojson,.json,.shp,.shx,.dbf,.prj,.cpg,.zip,.kml,.kmz,.tif,.tiff' });
  const box = h('div', {}, field('Archivos (para Shapefile elija juntos SHP, DBF, PRJ y CPG, o un ZIP)', fileInput), field('Capa de destino', layer), field('Sistema de origen si el archivo no lo indica', source), h('label', { class: 'chk' }, force, 'Forzar el sistema indicado para Shapefile / GeoTIFF'), h('p', { class: 'hint' }, 'GeoJSON y KML usan WGS84. Shapefile usa su PRJ y GeoTIFF sus claves EPSG; el sistema indicado arriba sólo se usa si falta esa información. Configure antes la georreferenciación del dibujo.'), error);
  return app.ui.modal('Importar datos SIG', box, [{ label: 'Cancelar', value: null }, { label: 'Importar', primary: true, validate: () => { if (!fileInput.files.length || !layer.value.trim()) { error.textContent = 'Elija archivos y una capa de destino.'; return false; } return true; }, value: () => ({ files: [...fileInput.files], options: { layer: layer.value.trim(), crs: source.value.trim(), overrideCRS: force.checked ? source.value.trim() : undefined } }) }]);
}
export async function exportDialog(app) {
  const format = select(['GeoJSON', 'Shapefile ZIP', 'KML', 'KMZ', 'GeoTIFF']), crs = h('input', { value: app.doc.geo?.crs?.code ? `EPSG:${app.doc.geo.crs.code}` : 'EPSG:4326' }), layer = select(['Todas', ...layers(app)]), selected = h('input', { type: 'checkbox', checked: app.sel.size > 0 }), original = h('input', { type: 'checkbox', checked: true });
  return app.ui.modal('Exportar datos SIG', h('div', {}, field('Formato', format), field('Capa', layer), field('EPSG de salida para Shapefile / GeoTIFF', crs), h('label', { class: 'chk' }, selected, 'Sólo objetos designados'), h('label', { class: 'chk' }, original, 'GeoTIFF: conservar original numérico y sistema de origen'), h('p', { class: 'hint' }, 'GeoJSON y KML/KMZ se escriben en WGS84. Cada Shapefile admite una familia geométrica. Para GeoTIFF elija una única imagen importada; la imagen actual se exporta en el EPSG del dibujo.')),
    [{ label: 'Cancelar', value: null }, { label: 'Exportar', primary: true, value: () => ({ format: format.value, crs: crs.value.trim(), layer: layer.value === 'Todas' ? undefined : layer.value, ids: selected.checked ? [...app.sel] : undefined, original: original.checked }) }]);
}
export async function addFieldDialog(app, layer) {
  const name = h('input'), type = select(fieldTypes), initial = h('input'), error = h('p', { role: 'alert' });
  await app.ui.modal('Añadir campo', h('div', {}, field('Nombre', name), field('Tipo', type), field('Valor inicial (vacío = sin dato)', initial), error), [{ label: 'Cancelar', value: false }, { label: 'Añadir', primary: true, validate: () => { try { transact(app, () => addField(app.doc, layer, { name: name.value.trim(), type: type.value, default: initial.value })); return true; } catch (e) { error.textContent = e.message; return false; } }, value: true }]);
}
export async function attributeTable(app, initialLayer) {
  const doc = app.doc, layer = select(layers(app), initialLayer || Object.keys(doc.gis.schemas)[0] || doc.cur.layer), search = h('input', { placeholder: 'Buscar en atributos…' }), condition = h('select'), op = select(['=', '≠', '>', '<', 'contiene']), value = h('input'), body = h('tbody'), head = h('thead'), status = h('p', { class: 'hint', role: 'status' }); let page = 0, current = [];
  const refreshFields = () => { condition.replaceChildren(option('', 'Sin condición'), ...(schemaFor(doc, layer.value)).map(f => option(f.name))); };
  const render = () => {
    const fields = schemaFor(doc, layer.value); let rows;
    try { rows = queryRows(doc, { layer: layer.value, text: search.value, field: condition.value, op: op.value, value: value.value }); } catch (e) { status.textContent = e.message; return; }
    current = rows; page = Math.max(0, Math.min(page, Math.ceil(rows.length / 100) - 1));
    head.replaceChildren(h('tr', {}, ['Objeto', 'Tipo', ...fields.map(f => `${f.name} (${f.type})`)].map(label => h('th', {}, label))));
    body.replaceChildren(...rows.slice(page * 100, page * 100 + 100).map(e => h('tr', { class: app.sel.has(e.id) ? 'sel' : '', onclick: ev => { if (ev.target.tagName === 'INPUT') return; if (!ev.ctrlKey) app.sel.clear(); if (ev.ctrlKey && app.sel.has(e.id)) app.sel.delete(e.id); else app.sel.add(e.id); app.selChanged(); render(); }, ondblclick: ev => { if (ev.target.tagName !== 'INPUT') { app.sel = new Set([e.id]); app.selChanged(); const b = doc.extents([e]); if (b) { app.view.fit(b); app.renderer.invalidate(); } } } }, h('td', {}, String(e.id)), h('td', {}, e.type), ...fields.map(f => {
      const input = h('input', { value: e.data?.[f.name] == null ? '' : String(e.data[f.name]), 'aria-label': `${f.name}, objeto ${e.id}`, onchange: () => { try { transact(app, () => setValue(doc, [e.id], f.name, input.value)); input.setCustomValidity(''); status.textContent = 'Dato actualizado. Se puede deshacer.'; } catch (err) { input.setCustomValidity(err.message); input.reportValidity(); input.value = e.data?.[f.name] ?? ''; status.textContent = err.message; } } }); return h('td', {}, input);
    }))));
    status.textContent = `${rows.length} objetos · página ${page + 1} de ${Math.max(1, Math.ceil(rows.length / 100))} · ${app.sel.size} designados`;
  };
  layer.onchange = () => { page = 0; refreshFields(); render(); }; search.oninput = () => { page = 0; render(); }; condition.onchange = op.onchange = () => { page = 0; render(); }; value.onchange = () => { page = 0; render(); };
  const box = h('div', { class: 'gis-table' }, h('div', { class: 'grid2' }, field('Capa', layer), field('Búsqueda', search)), h('div', { class: 'grid2' }, field('Campo', condition), field('Operador', op), field('Valor', value)), h('div', { class: 'gis-scroll' }, h('table', { class: 'xref-list' }, head, body)), status,
    h('div', { class: 'gis-actions' }, h('button', { class: 'btn', onclick: () => { page--; render(); } }, 'Anterior'), h('button', { class: 'btn', onclick: () => { page++; render(); } }, 'Siguiente'), h('button', { class: 'btn', onclick: () => { app.sel = new Set(current.map(e => e.id)); app.selChanged(); render(); } }, 'Designar resultados'), h('button', { class: 'btn', onclick: async () => { await addFieldDialog(app, layer.value); refreshFields(); render(); } }, 'Añadir campo…'), h('button', { class: 'btn', onclick: () => { doc.undo(); refreshFields(); render(); } }, 'Deshacer')));
  refreshFields(); render(); return app.ui.modal('Tabla de atributos SIG', box, [{ label: 'Cerrar', value: null }]);
}
const palette = ['#67b681', '#66a9dc', '#e7bf58', '#d88875', '#ac91cb', '#6ac8bd', '#d99bc4'];
export async function themeDialog(app, layer) {
  const fields = schemaFor(app.doc, layer); if (!fields.length) throw Error('La capa no tiene campos.');
  const old = app.doc.gis.themes[layer], fieldEl = select(fields.map(f => f.name), old?.field), mode = select(['categorias', 'rangos'], old?.mode), table = h('div'), off = h('input', { type: 'checkbox', checked: old?.off || false }), error = h('p', { role: 'alert' }); let rules = [];
  const render = () => { table.replaceChildren(...rules.map(r => { const color = h('input', { type: 'color', value: r.color, oninput: e => { r.color = e.target.value; } }); const input = (key, type = 'text') => h('input', { type, value: r[key] ?? '', onchange: e => { r[key] = type === 'number' ? +e.target.value : e.target.value; } }); return h('div', { class: 'grid2' }, field(mode.value === 'rangos' ? 'Desde' : 'Valor', input(mode.value === 'rangos' ? 'min' : 'value', mode.value === 'rangos' ? 'number' : 'text')), ...(mode.value === 'rangos' ? [field('Hasta', input('max', 'number'))] : []), field('Color', color)); })); };
  const generate = () => { const values = app.doc.model.filter(e => e.layer === layer).map(e => e.data?.[fieldEl.value]).filter(v => v != null);
    if (mode.value === 'rangos') { const ns = values.map(Number).filter(Number.isFinite), min = ns.length ? ns.reduce((a, b) => Math.min(a, b), Infinity) : 0, max = ns.length ? ns.reduce((a, b) => Math.max(a, b), -Infinity) : 1; rules = Array.from({ length: 5 }, (_, i) => ({ min: min + (max - min) * i / 5, max: min + (max - min) * (i + 1) / 5, color: palette[i] })); }
    else { const unique = [...new Set(values.map(String))]; if (unique.length > 128) { error.textContent = 'Más de 128 categorías; elija otro campo o use rangos.'; rules = []; } else rules = unique.map((value, i) => ({ value, color: palette[i % palette.length] })); } render(); };
  fieldEl.onchange = mode.onchange = generate;
  if (old) { rules = JSON.parse(JSON.stringify(old.rules)); render(); } else generate();
  let result;
  const box = h('div', {}, field('Campo', fieldEl), field('Clasificación', mode), h('label', { class: 'chk' }, off, 'Desactivar simbología'), table, error);
  const ok = await app.ui.modal(`Simbología temática · ${layer}`, box, [{ label: 'Cancelar', value: false }, { label: 'Aplicar', primary: true, validate: () => { try { if (!off.checked && !rules.length) throw Error('No hay reglas; elija un campo con datos.'); result = validateTheme({ field: fieldEl.value, mode: mode.value, rules, off: off.checked }); return true; } catch (e) { error.textContent = e.message; return false; } }, value: true }]); return ok ? result : null;
}
export async function labelDialog(app, layer) {
  const fields = schemaFor(app.doc, layer); if (!fields.length) throw Error('La capa no tiene campos.');
  const old = app.doc.gis.labels[layer], fieldEl = select(fields.map(f => f.name), old?.field), height = h('input', { type: 'number', min: '0.000001', step: 'any', value: old?.height || 2.5 }), color = h('input', { type: 'color', value: old?.color || '#ffffff' }), off = h('input', { type: 'checkbox', checked: old?.off || false });
  return app.ui.modal(`Etiquetas · ${layer}`, h('div', {}, field('Campo', fieldEl), field('Altura en unidades de dibujo', height), field('Color', color), h('label', { class: 'chk' }, off, 'Ocultar etiquetas')),
    [{ label: 'Cancelar', value: null }, { label: 'Aplicar', primary: true, validate: () => height.reportValidity() && Number.isFinite(+height.value) && +height.value > 0, value: () => ({ field: fieldEl.value, height: +height.value, color: color.value, off: off.checked }) }]);
}
export async function cadastralDialog(app) {
  const fields = [['parcela', 'Identificador de parcela', 'texto'], ['titular', 'Titular', 'texto'], ['nomenclatura', 'Nomenclatura', 'texto'], ['superficie', 'Superficie declarada', 'real']], inputs = fields.map(([name]) => h('input', { value: name }));
  return app.ui.modal('Campos catastrales del proyecto', h('div', {}, h('p', { class: 'hint' }, 'Puede cambiar los nombres según la nomenclatura de su proyecto. No se asignan titulares ni superficies automáticamente.'), fields.map(([, label], i) => field(label, inputs[i]))), [{ label: 'Cancelar', value: null }, { label: 'Crear campos', primary: true, value: () => fields.map(([, , type], i) => ({ name: inputs[i].value.trim(), type })) }]);
}
