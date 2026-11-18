import { parseSurvey, adjustTraverse } from './survey.js';
import { buildTIN, contours, meshStats, sampleTIN } from './tin.js';
import { readGeoTIFF } from './geotiff.js';
const progress = value => self.postMessage({ progress: value });
self.onmessage = async ({ data: m }) => {
  try {
    let result;
    if (m.operation === 'points') result = parseSurvey(m.text, m.options);
    else if (m.operation === 'traverse') result = adjustTraverse(m.options);
    else if (m.operation === 'tin') result = buildTIN(m.points, m.options, progress);
    else if (m.operation === 'contours') result = contours(m.mesh, m.options, progress);
    else if (m.operation === 'sample') result = sampleTIN(m.mesh, m.point);
    else if (m.operation === 'stats') result = meshStats(m.mesh);
    else if (m.operation === 'mdt') {
      const r = await readGeoTIFF(
          Uint8Array.from(atob(m.original), c => c.charCodeAt(0)),
          m.crs
        ),
        step = m.options.step ?? 1;
      if (r.samples !== 1 || !Number.isInteger(step) || step < 1)
        throw Error('Se requiere un MDT de una banda y paso entero positivo.');
      if (Math.ceil(r.width / step) * Math.ceil(r.height / step) > 50000)
        throw Error('Aumente el paso: máximo 50 000 muestras.');
      const vertices = [],
        triangles = [],
        map = new Map(),
        valid = (x, y) => Number.isFinite(r.data[y * r.width + x]) && r.data[y * r.width + x] !== r.nodata;
      const add = (x, y) => {
        const key = `${x},${y}`;
        if (map.has(key)) return map.get(key);
        const i = vertices.length,
          t = r.transform;
        vertices.push({
          x: t[0] + (x + 0.5) * t[1] + (y + 0.5) * t[2],
          y: t[3] + (x + 0.5) * t[4] + (y + 0.5) * t[5],
          z: r.data[y * r.width + x],
        });
        map.set(key, i);
        return i;
      };
      for (let y = 0; y + step < r.height; y += step) {
        for (let x = 0; x + step < r.width; x += step) {
          let ok = true;
          for (let j = y; j <= y + step && ok; j++)
            for (let i = x; i <= x + step; i++)
              if (!valid(i, j)) {
                ok = false;
                break;
              }
          if (!ok) continue;
          const a = add(x, y),
            b = add(x + step, y),
            c = add(x + step, y + step),
            d = add(x, y + step);
          triangles.push([a, b, c], [a, c, d]);
        }
        progress(y / r.height);
      }
      if (!triangles.length) throw Error('El MDT no tiene celdas completas con datos.');
      result = {
        vertices,
        triangles,
        crs: r.crs,
        raster: {
          width: r.width,
          height: r.height,
          transform: r.transform,
          crs: r.crs,
        },
      };
    } else throw Error('Operación topográfica desconocida.');
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
