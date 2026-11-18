// Ejecución asíncrona y aplicación atómica: cálculo fuera del hilo de interfaz y una única operación de deshacer.
import { metricFrame, prepareFeatures, resultEntities } from './geoframe.js';
import { rasterEntity, rasterBounds } from './geotiff.js';
import { terrainColor } from './terrain.js';
import { inferSchema } from './gis.js';
const abortError = () => new DOMException('Proceso cancelado sin modificar el dibujo.', 'AbortError');
export function jobControl(app, title, options) {
  if (app.processingCancel) throw Error('Ya hay un geoproceso en curso.');
  if (app.doc.space !== 'model' || app.doc.bedit || app.doc.tx) throw Error('Ejecute los geoprocesos desde el espacio modelo, fuera de otra operación.');
  const doc = app.doc, version = doc.ver, controller = new AbortController(), stop = () => controller.abort(); app.processingCancel = stop;
  if (options.signal?.aborted) stop(); else options.signal?.addEventListener('abort', stop, { once: true });
  const panel = document.createElement('div'); panel.className = 'geo-progress'; panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
  const label = document.createElement('span'); label.textContent = title; const meter = document.createElement('progress'); meter.max = 1; meter.value = 0;
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancelar (Esc)'; cancel.onclick = stop; panel.append(label, meter, cancel); document.body.append(panel);
  return {
    doc, signal: controller.signal,
    progress: value => { meter.value = Math.max(0, Math.min(1, value)); options.onProgress?.(value); },
    check: () => { if (controller.signal.aborted) throw abortError(); if (app.doc !== doc || doc.ver !== version) throw Error('El dibujo cambió durante el cálculo. Se descartó el resultado; repita la operación.'); },
    close: () => { panel.remove(); options.signal?.removeEventListener('abort', stop); if (app.processingCancel === stop) app.processingCancel = null; },
  };
}
export function compute(payload, control, workerURL = new URL('./geoworker.js', import.meta.url)) {
  return new Promise((resolve, reject) => {
    if (control.signal.aborted) { reject(abortError()); return; }
    let worker; try { worker = new Worker(workerURL, { type: 'module' }); } catch { reject(Error('Este navegador no permite iniciar el worker de geoprocesos.')); return; }
    const end = (fn, value) => { worker.terminate(); control.signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => end(reject, abortError()); control.signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => end(reject, Error(event.message || 'Error al cargar el worker SIG.'));
    worker.onmessage = event => { const m = event.data; if (m.error) end(reject, Error(m.error)); else if (Object.hasOwn(m, 'result')) end(resolve, m.result); else if (m.progress != null) control.progress(.15 + .7 * m.progress); };
    try { worker.postMessage(payload); } catch (e) { end(reject, e); }
  });
}
const choose = (doc, layer, ids) => { const set = ids && new Set(ids); return doc.model.filter(e => (!layer || e.layer === layer) && (!set || set.has(e.id))); };
function commitOutput(app, control, layer, entities, schema) {
  control.check(); if (!entities.length) return [];
  if (!layer || !layer.trim() || Object.hasOwn(Object.prototype, layer)) throw Error('Nombre de capa de salida inválido.');
  const doc = control.doc, previous = doc.gis.schemas[layer] || [];
  for (const f of schema) { const old = previous.find(q => q.name === f.name); if (old && old.type !== f.type) throw Error(`El campo ${f.name} ya tiene otro tipo en la capa de salida.`); }
  doc.begin(); const quiet = doc.quiet; doc.quiet = true; let ids;
  try {
    if (!doc.layers.some(l => l.name === layer)) doc.addLayer(layer, '#8ad4b0');
    doc.gis.schemas[layer] = [...previous, ...schema.filter(f => !previous.some(q => q.name === f.name))];
    ids = entities.map(e => doc.add({ ...e, layer, color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' }, doc.model).id);
  } finally { doc.quiet = quiet; doc.changed(); doc.commit(); }
  app.sel = new Set(ids); app.selChanged(); app.renderer.flushTiles(); return ids;
}
export async function runVectorJob(app, options) {
  const control = jobControl(app, 'Geoproceso SIG…', options);
  try {
    const A = choose(control.doc, options.layerA, options.idsA), B = options.layerB || options.idsB ? choose(control.doc, options.layerB, options.idsB) : [];
    if (!A.length) throw Error('La capa o designación de entrada está vacía.');
    const frame = metricFrame(control.doc, [...A, ...B], options); control.progress(.01);
    const a = await prepareFeatures(control.doc, A, frame, control.signal), b = await prepareFeatures(control.doc, B, frame, control.signal); control.check();
    const { signal, onProgress, ...parameters } = options;
    const result = await compute({ type: 'vector', operation: options.operation, A: a, B: b, options: parameters }, control); control.check();
    if (result.ids) {
      const selected = options.selection === 'añadir' ? new Set([...app.sel, ...result.ids]) : options.selection === 'quitar' ? new Set([...app.sel].filter(id => !result.ids.includes(id))) : new Set(result.ids);
      app.sel = selected; app.selChanged(); control.progress(1); return { ids: result.ids, selected: selected.size, metric: frame.description };
    }
    const converted = await resultEntities(result.features, frame, control.signal, control.doc); control.check();
    const ids = commitOutput(app, control, options.outputLayer, converted.entities, converted.schema); control.progress(1); return { ids, metric: frame.description };
  } finally { control.close(); }
}
export async function runTerrainJob(app, options) {
  const control = jobControl(app, 'Analizando MDT…', options);
  try {
    if (!control.doc.geo) throw Error('El análisis requiere la georreferenciación del dibujo.');
    const e = control.doc.get(options.id); if (!e?.gisRaster?.original) throw Error('Designe un GeoTIFF numérico importado.');
    const { signal, onProgress, ...parameters } = options;
    const result = await compute({ type: 'terrain', original: e.gisRaster.original, crs: e.gisRaster.crs, options: parameters }, control); control.check();
    const expected = rasterBounds(control.doc, result), tolerance = Math.max(expected.w, expected.h, 1) * 1e-7;
    if (Math.hypot(e.p.x - expected.x1, e.p.y - expected.y1) > tolerance || Math.abs(e.w - expected.w) > tolerance || Math.abs(e.h - expected.h) > tolerance || Math.abs(e.rot || 0) > 1e-12 || e.clip && !e.clip.off) throw Error('El MDT fue movido, girado, escalado o recortado visualmente. Restituya su georreferenciación original para analizarlo.');
    const entity = await rasterEntity(control.doc, result, { signal: control.signal, colorize: v => terrainColor(v, options.mode || 'pendiente', options.percent) }); control.check();
    entity.name = `MDT · ${options.mode || 'pendiente'}`;
    entity.data = { ...(e.data || {}), analisis: options.mode || 'pendiente', unidad: options.mode === 'sombreado' ? '0–255' : options.mode === 'orientacion' ? 'grados desde norte de cuadrícula' : options.percent ? '%' : 'grados', origen_mdt: e.id };
    entity.gisRaster.analysis = { mode: options.mode || 'pendiente', verticalScale: options.verticalScale ?? 1, azimuth: options.azimuth ?? 315, altitude: options.altitude ?? 45, percent: !!options.percent, sourceId: e.id };
    const ids = commitOutput(app, control, options.outputLayer, [entity], inferSchema([entity.data])); control.progress(1); return { ids };
  } finally { control.close(); }
}
