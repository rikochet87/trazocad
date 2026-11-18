// Worker SIG: un trabajo por instancia. Cancelar termina la instancia sin dejar resultados parciales.
import { vectorProcess } from './geoprocess.js';
import { terrainAnalysis } from './terrain.js';
import { readGeoTIFF } from './geotiff.js';
self.onmessage = async ev => {
  let last = -1;
  const progress = value => { const percent = Math.floor(value * 100); if (percent !== last) { last = percent; self.postMessage({ progress: value }); } };
  try {
    if (ev.data.type === 'terrain') {
      const bytes = Uint8Array.from(atob(ev.data.original), c => c.charCodeAt(0));
      const r = await readGeoTIFF(bytes, ev.data.crs), result = terrainAnalysis(r, ev.data.options, progress);
      self.postMessage({ result }, [result.data.buffer]);
    } else self.postMessage({ result: vectorProcess(ev.data, progress) });
  } catch (e) { self.postMessage({ error: e.message || String(e) }); }
};
