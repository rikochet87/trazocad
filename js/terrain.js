// Análisis de un MDT numérico en su cuadrícula original: derivadas de Horn y métrica afín por celda.
import { resolveCRS } from './projections.js';
export function terrainAnalysis(r, options = {}, progress = () => {}) {
  const mode = options.mode || 'pendiente', vertical = options.verticalScale ?? 1, azimuth = options.azimuth ?? 315, altitude = options.altitude ?? 45;
  if (!['pendiente', 'orientacion', 'sombreado'].includes(mode) || !Number.isFinite(vertical) || vertical <= 0 || !Number.isFinite(azimuth) || !Number.isFinite(altitude) || altitude <= 0 || altitude > 90) throw Error('Parámetros de análisis de terreno inválidos.');
  if (r.samples !== 1 || r.photo === 3 || r.width < 3 || r.height < 3) throw Error('Se necesita un MDT numérico de una banda, de al menos 3×3 píxeles (no una imagen de color).');
  const crs = resolveCRS(r.crs), g = r.transform, out = new Float32Array(r.width * r.height).fill(-9999), rad = Math.PI / 180;
  const light = [Math.cos(altitude * rad) * Math.sin(azimuth * rad), Math.cos(altitude * rad) * Math.cos(azimuth * rad), Math.sin(altitude * rad)];
  const nodata = r.format === 3 && r.bits === 32 && r.nodata != null ? Math.fround(r.nodata) : r.nodata;
  const valid = v => Number.isFinite(v) && (nodata == null || v !== nodata);
  for (let y = 1; y < r.height - 1; y++) {
    for (let x = 1; x < r.width - 1; x++) {
      const z = [r.data[(y - 1) * r.width + x - 1], r.data[(y - 1) * r.width + x], r.data[(y - 1) * r.width + x + 1], r.data[y * r.width + x - 1], r.data[y * r.width + x], r.data[y * r.width + x + 1], r.data[(y + 1) * r.width + x - 1], r.data[(y + 1) * r.width + x], r.data[(y + 1) * r.width + x + 1]];
      if (!z.every(valid)) continue;
      let ex = g[1], ey = g[2], nx = g[4], ny = g[5];
      if (crs.axis === 'neu') [ex, ey, nx, ny] = [nx, ny, ex, ey];
      if (crs.proj === 'longlat') {
        const lat = (crs.axis === 'neu' ? g[0] + g[1] * (x + .5) + g[2] * (y + .5) : g[3] + g[4] * (x + .5) + g[5] * (y + .5)) * rad, den = 1 - crs.e2 * Math.sin(lat) ** 2;
        const east = crs.a / Math.sqrt(den) * Math.cos(lat) * rad, north = crs.a * (1 - crs.e2) / den ** 1.5 * rad;
        ex *= east; ey *= east; nx *= north; ny *= north;
      } else { ex *= crs.to_meter; ey *= crs.to_meter; nx *= crs.to_meter; ny *= crs.to_meter; }
      const det = ex * ny - ey * nx; if (Math.abs(det) < 1e-14) throw Error('Cuadrícula del MDT singular o situada en un polo.');
      const dc = (z[2] + 2 * z[5] + z[8] - z[0] - 2 * z[3] - z[6]) * vertical / 8, dr = (z[6] + 2 * z[7] + z[8] - z[0] - 2 * z[1] - z[2]) * vertical / 8;
      const gx = (dc * ny - dr * nx) / det, gy = (ex * dr - ey * dc) / det, gradient = Math.hypot(gx, gy);
      out[y * r.width + x] = mode === 'pendiente' ? options.percent ? gradient * 100 : Math.atan(gradient) / rad : mode === 'orientacion' ? gradient < 1e-12 ? -1 : (Math.atan2(-gx, -gy) / rad + 360) % 360 : 255 * Math.max(0, (-gx * light[0] - gy * light[1] + light[2]) / Math.sqrt(1 + gradient * gradient));
    }
    if (y % 32 === 0) progress(y / r.height);
  }
  progress(1);
  return { width: r.width, height: r.height, samples: 1, bits: 32, format: 3, photo: 1, data: out, transform: [...g], crs, nodata: -9999 };
}

// Colores de visualización; el archivo de resultados conserva siempre los valores numéricos originales.
export function terrainColor(value, mode, percent = false) {
  if (mode === 'sombreado') return [value, value, value];
  if (mode === 'orientacion') {
    if (value < 0) return [160, 160, 160]; const h = (value % 360) / 60, x = 210 * (1 - Math.abs(h % 2 - 1)), rgb = h < 1 ? [210, x, 0] : h < 2 ? [x, 210, 0] : h < 3 ? [0, 210, x] : h < 4 ? [0, x, 210] : h < 5 ? [x, 0, 210] : [210, 0, x]; return rgb.map(v => v + 30);
  }
  const t = Math.max(0, Math.min(1, value / (percent ? 100 : 45))); return t < .5 ? [70 + 350 * t, 175 + 100 * t, 100 - 100 * t] : [245, 225 - (t - .5) * 330, 50 + (t - .5) * 40];
}
