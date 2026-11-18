// Órdenes SIG 3. La interfaz prepara opciones; los trabajos validan, calculan en segundo plano y aplican una transacción.
import { runVectorJob, runTerrainJob } from './geojobs.js';
import { vectorDialog, terrainDialog, OPERATIONS } from './geoui.js';
export function registerGeoprocess(def) {
  const operations = [
    ['MAPBUFFER', ['AREAINFLUENCIA', 'BUFFER'], 'buffer'], ['MAPINTERSECT', ['INTERSECCIONSIG'], 'interseccion'],
    ['MAPCLIP', ['RECORTARSIG'], 'recorte'], ['MAPUNION', ['UNIONSIG'], 'union'], ['MAPDIFFERENCE', ['DIFERENCIASIG'], 'diferencia'],
    ['MAPDISSOLVE', ['DISOLVERSIG'], 'disolver'], ['MAPSPATIALJOIN', ['UNIONESPACIAL'], 'enlace'], ['MAPQUERY', ['CONSULTASIG', 'SELECCIONESPACIAL'], 'consulta'],
  ];
  for (const [name, aliases, operation] of operations) def(name, aliases, OPERATIONS[operation], async (c, arg) => {
    const options = arg ? { ...arg, operation } : await vectorDialog(c.app, operation); if (!options) return;
    try { const result = await runVectorJob(c.app, options); c.print(operation === 'consulta' ? `${result.ids.length} coincidencias; ${result.selected} objetos designados.` : `${result.ids.length} objetos creados en ${options.outputLayer}. ${result.metric}`); }
    catch (e) { if (e.name === 'AbortError') c.print('*Cancelar*: no se modificó el dibujo.'); else throw e; }
  }, { noTx: true, keepSel: true, group: 'Geografía' });
  for (const [name, aliases, mode] of [['MAPTERRAIN', ['ANALIZARMDT'], null], ['MAPSLOPE', ['PENDIENTE'], 'pendiente'], ['MAPASPECT', ['ORIENTACIONMDT'], 'orientacion'], ['MAPHILLSHADE', ['SOMBREADOMDT'], 'sombreado']]) def(name, aliases, 'Análisis numérico de pendiente, orientación y sombreado de un MDT', async (c, arg) => {
    const options = arg ? { ...arg, mode: mode || arg.mode } : await terrainDialog(c.app, mode); if (!options) return;
    try { const result = await runTerrainJob(c.app, options); c.print(`${result.ids.length} resultado de terreno en ${options.outputLayer}. El GeoTIFF numérico se exporta con MAPEXPORT → original.`); }
    catch (e) { if (e.name === 'AbortError') c.print('*Cancelar*: no se modificó el dibujo.'); else throw e; }
  }, { noTx: true, keepSel: true, group: 'Geografía' });
}
