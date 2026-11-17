// Proyecciones elipsoidales y cambios de datum. Ángulos públicos en grados; longitudes en metros.
const D = Math.PI / 180, H = Math.PI / 2;
export const ELLIPSOIDS = { WGS84: [6378137, 298.257223563], GRS80: [6378137, 298.257222101], intl: [6378388, 297], clrk66: [6378206.4, 294.9786982] };
export const DATUMS = { WGS84: { ellps: 'WGS84', towgs84: [0, 0, 0] }, NAD83: { ellps: 'GRS80', towgs84: [0, 0, 0] }, POSGAR2007: { ellps: 'WGS84', towgs84: [0, 0, 0] }, CampoInchauspe: { ellps: 'intl', towgs84: [-148, 136, 90] } };
export const CATALOG = [
  { code: 4326, name: 'WGS 84 — geográficas', proj: 'longlat' },
  { code: 3857, name: 'WGS 84 — Web Mercator', proj: 'webmerc' },
  { code: 3395, name: 'WGS 84 — Mercator mundial', proj: 'merc' },
  { code: 4269, name: 'NAD83 — geográficas', proj: 'longlat', datum: 'NAD83' },
  { code: 4258, name: 'ETRS89 — geográficas', proj: 'longlat', ellps: 'GRS80' },
  { code: 2154, name: 'RGF93 — Lambert-93', proj: 'lcc', ellps: 'GRS80', lat_0: 46.5, lat_1: 49, lat_2: 44, lon_0: 3, x_0: 700000, y_0: 6600000 },
  { code: 3413, name: 'WGS 84 — estereográfica polar norte', proj: 'stere', lat_0: 90, lat_ts: 70, lon_0: -45 },
  { code: 3031, name: 'WGS 84 — estereográfica polar sur', proj: 'stere', lat_0: -90, lat_ts: -71 },
];
for (let zone = 1; zone <= 60; zone++) for (const south of [false, true]) CATALOG.push({ code: (south ? 32700 : 32600) + zone, name: `WGS 84 — UTM ${zone}${south ? 'S' : 'N'}`, proj: 'utm', zone, south });
for (let zone = 28; zone <= 38; zone++) CATALOG.push({ code: 25800 + zone, name: `ETRS89 — UTM ${zone}N`, proj: 'utm', zone, ellps: 'GRS80' });
for (let zone = 1; zone <= 7; zone++) {
  CATALOG.push({ code: 5342 + zone, name: `POSGAR 2007 — Argentina faja ${zone}`, proj: 'tmerc', ellps: 'WGS84', lat_0: -90, lon_0: -75 + 3 * zone, x_0: zone * 1e6 + 500000 });
  CATALOG.push({ code: 22190 + zone, name: `Campo Inchauspe — Argentina faja ${zone}`, proj: 'tmerc', datum: 'CampoInchauspe', lat_0: -90, lon_0: -75 + 3 * zone, x_0: zone * 1e6 + 500000 });
}
const finite = (n, msg) => { if (!Number.isFinite(n)) throw Error(msg); return n; };
function wkt(text) {
  // WKT1 y WKT2: se admiten métodos y parámetros conocidos, nunca se adivina uno desconocido.
  const method = (text.match(/(?:PROJECTION|METHOD)\s*\[\s*"([^"]+)"/i) || [,''])[1].toLowerCase().replace(/[ _-]/g, '');
  const names = { transversemercator: 'tmerc', lambertconformalconic2sp: 'lcc', lambertconformalconic1sp: 'lcc', lambertconicconformal2sp: 'lcc', mercator1sp: 'merc', mercator2sp: 'merc', mercatorvarianta: 'merc', mercatorvariantb: 'merc', popularvisualisationpseudomercator: 'webmerc', polarstereographicvarianta: 'stere', polarstereographicvariantb: 'stere', stereographic: 'stere', obliquestereographic: 'sterea' };
  if (method && !names[method]) throw Error(`Método WKT no admitido: ${method}`);
  const o = { proj: method ? names[method] : 'longlat', name: (text.match(/^[A-Z0-9_]+\s*\[\s*"([^"]+)"/i) || [,'WKT'])[1] };
  const el = text.match(/(?:SPHEROID|ELLIPSOID)\s*\[\s*"[^"]+"\s*,\s*([\d.e+-]+)\s*,\s*([\d.e+-]+)/i);
  if (el) { o.a = +el[1]; o.rf = +el[2]; }
  if (/^(PROJCS|PROJCRS)/i.test(text) && !method) throw Error('WKT proyectado sin método.');
  const params = { centralmeridian: 'lon_0', longitudeofnaturalorigin: 'lon_0', longitudeoffalseorigin: 'lon_0', latitudeoforigin: 'lat_0', latitudeofnaturalorigin: 'lat_0', latitudeoffalseorigin: 'lat_0', standardparallel1: 'lat_1', standardparallel2: 'lat_2', latitudeof1ststandardparallel: 'lat_1', latitudeof2ndstandardparallel: 'lat_2', latitudeofstandardparallel: 'lat_ts', scalefactor: 'k_0', scalefactoratnaturalorigin: 'k_0', falseeasting: 'x_0', falsenorthing: 'y_0', eastingatfalseorigin: 'x_0', northingatfalseorigin: 'y_0' };
  for (const m of text.matchAll(/PARAMETER\s*\[\s*"([^"]+)"\s*,\s*([\d.e+-]+)/gi)) { const k = params[m[1].toLowerCase().replace(/[ _-]/g, '')]; if (!k) throw Error(`Parámetro WKT no admitido: ${m[1]}`); o[k] = +m[2]; }
  const tw = text.match(/TOWGS84\s*\[([^\]]+)\]/i); if (tw) o.towgs84 = tw[1].split(',').map(Number);
  const units = [...text.matchAll(/(?:LENGTHUNIT|UNIT)\s*\[\s*"[^"]+"\s*,\s*([\d.e+-]+)/gi)];
  if (method && units.length) { o.to_meter = +units.at(-1)[1]; for (const k of ['x_0', 'y_0']) if (o[k] != null) o[k] *= o.to_meter; }
  const prime = text.match(/PRIMEM\s*\[\s*"[^"]+"\s*,\s*([\d.e+-]+)/i);
  if (prime && Math.abs(+prime[1]) > 1e-12) throw Error('WKT: sólo se admite el meridiano de Greenwich.');
  for (const m of text.matchAll(/ANGLEUNIT\s*\[\s*"[^"]+"\s*,\s*([\d.e+-]+)/gi)) if (Math.abs(+m[1] - D) > 1e-12) throw Error('WKT: las unidades angulares deben ser grados.');
  const axes = []; let depth = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') { quoted = !quoted; continue; } if (quoted) continue;
    if (text[i] === '[') depth++; else if (text[i] === ']') depth--;
    else if (depth === 1 && /^AXIS\s*\[/i.test(text.slice(i))) { const dir = text.slice(i).match(/^AXIS\s*\[\s*"[^"]+"\s*,\s*(NORTH|EAST|SOUTH|WEST)/i)?.[1]; if (dir) axes.push(dir.toUpperCase()); }
  }
  if (axes.length && !(['EAST,NORTH', 'NORTH,EAST'].includes(axes.slice(0, 2).join(',')))) throw Error('WKT: sólo se admiten ejes este/norte o norte/este.');
  if (axes[0] === 'NORTH') o.axis = 'neu';
  if (/CS\s*\[\s*Cartesian\s*,\s*3/i.test(text)) throw Error('WKT geocéntrico no admitido.');
  if (o.proj === 'stere' && o.lat_ts && o.lat_0 == null) o.lat_0 = Math.sign(o.lat_ts) * 90;
  if (o.proj === 'lcc' && o.lat_1 == null) o.lat_1 = o.lat_0;
  return o;
}
export function resolveCRS(value = 'EPSG:4326') {
  let o;
  if (typeof value === 'object' && value) o = { ...value };
  else {
    const s = String(value).trim(), m = s.match(/^(?:EPSG:)?(\d+)$/i);
    if (m) { o = CATALOG.find(x => x.code === +m[1]); if (!o) throw Error(`EPSG:${m[1]} no está en el catálogo; importe su definición WKT o PROJ.`); o = { ...o }; }
    else if (/^(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS|GEODCRS)\s*\[/i.test(s)) o = wkt(s);
    else if (s.includes('+proj=')) {
      o = {}; const allowed = new Set('proj zone south datum ellps a b rf f lon_0 lat_0 lat_1 lat_2 lat_ts k k_0 x_0 y_0 towgs84 units to_meter axis no_defs type title'.split(' '));
      for (const m of s.matchAll(/\+(\w+)(?:=([^\s]+))?/g)) { if (!allowed.has(m[1])) throw Error(`Parámetro PROJ no admitido: ${m[1]}`); o[m[1]] = m[2] ?? true; }
      if (o.towgs84) o.towgs84 = o.towgs84.split(',').map(Number);
    } else throw Error('Indique EPSG, WKT o una definición +proj.');
  }
  if (o.proj === 'latlong') o.proj = 'longlat';
  if (!['longlat', 'webmerc', 'merc', 'tmerc', 'utm', 'lcc', 'stere', 'sterea'].includes(o.proj)) throw Error(`Proyección no admitida: ${o.proj}`);
  const datum = o.datum ? DATUMS[o.datum] : DATUMS.WGS84;
  if (!datum) throw Error(`Datum no admitido: ${o.datum}; indique el elipsoide y +towgs84.`);
  const ell = ELLIPSOIDS[o.ellps || datum.ellps];
  if (!ell && !o.a) throw Error(`Elipsoide no admitido: ${o.ellps}`);
  const a = +(o.a ?? ell?.[0]), rf = +(o.rf ?? (o.b ? a / (a - +o.b) : o.f ? 1 / +o.f : ell?.[1] ?? 0));
  const f = rf === 0 || !Number.isFinite(rf) ? 0 : 1 / rf;
  if (!(a > 0) || f < 0 || f >= 1) throw Error('Elipsoide inválido.');
  const c = { lon_0: 0, lat_0: 0, x_0: 0, y_0: 0, k_0: o.k ?? 1, axis: 'enu', ...o, a, rf, e2: f * (2 - f), towgs84: o.towgs84 || datum.towgs84 || [0, 0, 0] };
  for (const k of ['lon_0', 'lat_0', 'x_0', 'y_0', 'k_0', 'lat_1', 'lat_2', 'lat_ts']) if (c[k] != null) c[k] = finite(+c[k], `Parámetro inválido: ${k}`);
  c.to_meter = +(o.to_meter ?? ({ m: 1, ft: 0.3048, 'us-ft': 1200 / 3937 }[o.units || 'm'] ?? NaN));
  if (!(c.to_meter > 0) || !(c.k_0 > 0) || !['enu', 'neu'].includes(c.axis)) throw Error('Unidades, escala u orden de ejes no admitidos.');
  if (c.proj === 'utm') { const z = +c.zone; if (!(z >= 1 && z <= 60 && Number.isInteger(z))) throw Error('Zona UTM fuera de 1–60.'); Object.assign(c, { proj: 'tmerc', lon_0: z * 6 - 183, lat_0: 0, k_0: 0.9996, x_0: 500000, y_0: c.south ? 1e7 : 0 }); }
  if (c.proj === 'lcc' && (c.lat_1 == null || Math.abs(c.lat_1 + (c.lat_2 ?? c.lat_1)) < 1e-10)) throw Error('Lambert necesita paralelos estándar válidos.');
  if (c.towgs84.length !== 3 && c.towgs84.length !== 7 || c.towgs84.some(v => !Number.isFinite(+v))) throw Error('Helmert necesita 3 o 7 parámetros finitos.');
  c.e = Math.sqrt(c.e2); return c;
}
const tfn = (p, e) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
function phi(t, e) { let p = H - 2 * Math.atan(t); for (let i = 0; i < 20; i++) { const q = H - 2 * Math.atan(t * ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2)); if (Math.abs(q - p) < 1e-14) return q; p = q; } return p; }
const meridian = (p, c) => { const e = c.e2; return c.a * ((1 - e / 4 - 3 * e ** 2 / 64 - 5 * e ** 3 / 256) * p - (3 * e / 8 + 3 * e ** 2 / 32 + 45 * e ** 3 / 1024) * Math.sin(2 * p) + (15 * e ** 2 / 256 + 45 * e ** 3 / 1024) * Math.sin(4 * p) - 35 * e ** 3 / 3072 * Math.sin(6 * p)); };
const wrap = l => Math.atan2(Math.sin(l), Math.cos(l));
function rawForward(c, lon, lat) {
  const p = lat * D, p0 = c.lat_0 * D, l = wrap((lon - c.lon_0) * D), { a, e, e2, k_0: k } = c;
  if (c.proj === 'longlat') return [lon, lat];
  if (c.proj === 'webmerc') return [a * lon * D, a * Math.log(Math.tan(Math.PI / 4 + p / 2))];
  if (c.proj === 'merc') { const km = c.lat_ts != null ? Math.cos(c.lat_ts * D) / Math.sqrt(1 - e2 * Math.sin(c.lat_ts * D) ** 2) : k; return [a * km * l, -a * km * Math.log(tfn(p, e))]; }
  if (c.proj === 'tmerc') {
    if (Math.abs(l) > Math.PI / 6) throw Error('Punto fuera del dominio de la transversa de Mercator (±30° del meridiano central).');
    // Serie de Krüger de sexto orden (n = tercera excentricidad): estable también lejos del eje de la faja.
    const n = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2)), n2 = n * n, n3 = n2 * n, n4 = n2 * n2, n5 = n4 * n, n6 = n3 * n3;
    const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
    const alpha = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
      13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
      61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
      49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
      34729 * n5 / 80640 - 3418889 * n6 / 1995840, 212378941 * n6 / 319334400];
    const conformal = q => Math.sinh(Math.asinh(Math.tan(q)) - e * Math.atanh(e * Math.sin(q)));
    const tau = conformal(p), xi = Math.atan2(tau, Math.cos(l)), eta = Math.asinh(Math.sin(l) / Math.hypot(tau, Math.cos(l))), xi0 = Math.atan(conformal(p0));
    let X = eta, Y = xi, Y0 = xi0;
    alpha.forEach((v, i) => { const j = 2 * (i + 1); X += v * Math.cos(j * xi) * Math.sinh(j * eta); Y += v * Math.sin(j * xi) * Math.cosh(j * eta); Y0 += v * Math.sin(j * xi0); });
    return [k * A * X, k * A * (Y - Y0)];
  }
  if (c.proj === 'lcc') {
    const p1 = c.lat_1 * D, p2 = (c.lat_2 ?? c.lat_1) * D, m = q => Math.cos(q) / Math.sqrt(1 - e2 * Math.sin(q) ** 2);
    const n = Math.abs(p1 - p2) < 1e-12 ? Math.sin(p1) : Math.log(m(p1) / m(p2)) / Math.log(tfn(p1, e) / tfn(p2, e));
    const F = m(p1) / (n * tfn(p1, e) ** n), r = a * F * tfn(p, e) ** n * k, r0 = a * F * tfn(p0, e) ** n * k;
    return [r * Math.sin(n * l), r0 - r * Math.cos(n * l)];
  }
  if (Math.abs(Math.abs(c.lat_0) - 90) < 1e-9) {
    const sign = Math.sign(c.lat_0), pp = sign * p, ts = Math.abs(c.lat_ts ?? 90) * D;
    const factor = Math.abs(ts - H) < 1e-12 ? 2 * a * k / Math.sqrt((1 + e) ** (1 + e) * (1 - e) ** (1 - e)) : a * Math.cos(ts) / Math.sqrt(1 - e2 * Math.sin(ts) ** 2) / tfn(ts, e);
    const r = factor * tfn(pp, e); return [r * Math.sin(l), -sign * r * Math.cos(l)];
  }
  // Estereográfica oblicua sobre la esfera conforme de Gauss (EPSG 9809).
  const s0 = Math.sin(p0), co0 = Math.cos(p0), n = c.proj === 'sterea' ? Math.sqrt(1 + e2 * co0 ** 4 / (1 - e2)) : 1;
  const chi0 = c.proj === 'sterea' ? Math.asin(s0 / n) : H - 2 * Math.atan(tfn(p0, e)), C = Math.tan(Math.PI / 4 + chi0 / 2) / (1 / tfn(p0, e)) ** n;
  const chi = 2 * Math.atan(C * (1 / tfn(p, e)) ** n) - H, L = n * l;
  const radius = c.proj === 'sterea' ? a * Math.sqrt(1 - e2) / (1 - e2 * s0 * s0) : a * co0 / (Math.sqrt(1 - e2 * s0 * s0) * Math.cos(chi0));
  const den = 1 + Math.sin(chi0) * Math.sin(chi) + Math.cos(chi0) * Math.cos(chi) * Math.cos(L);
  if (den < 1e-12) throw Error('Antípoda fuera del dominio estereográfico.');
  const K = 2 * radius * k / den;
  return [K * Math.cos(chi) * Math.sin(L), K * (Math.cos(chi0) * Math.sin(chi) - Math.sin(chi0) * Math.cos(chi) * Math.cos(L))];
}
export function forward(crs, point) {
  const c = resolveCRS(crs), lon = +point.lon, lat = +point.lat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) >= 90 || Math.abs(lon) > 180) throw Error('Longitud o latitud fuera de rango (polos excluidos).');
  let [x, y] = rawForward(c, lon, lat);
  if (c.proj !== 'longlat') { x = (x + c.x_0) / c.to_meter; y = (y + c.y_0) / c.to_meter; }
  if (c.axis === 'neu') [x, y] = [y, x];
  return { x: finite(x, 'Proyección fuera de dominio.'), y: finite(y, 'Proyección fuera de dominio.'), z: point.h ?? 0 };
}
export function inverse(crs, point) {
  const c = resolveCRS(crs); let x = +point.x, y = +point.y;
  if (c.axis === 'neu') [x, y] = [y, x];
  if (c.proj === 'longlat') return { lon: x, lat: y, h: point.z ?? 0 };
  x = x * c.to_meter - c.x_0; y = y * c.to_meter - c.y_0;
  let lon = c.lon_0 + x / c.a / D, lat = (c.lat_0 * D + y / c.a) / D;
  if (['merc', 'webmerc'].includes(c.proj)) {
    const k = c.proj === 'webmerc' ? 1 : c.lat_ts != null ? Math.cos(c.lat_ts * D) / Math.sqrt(1 - c.e2 * Math.sin(c.lat_ts * D) ** 2) : c.k_0;
    lon = (c.proj === 'webmerc' ? 0 : c.lon_0) + x / (c.a * k * D); lat = phi(Math.exp(-y / (c.a * k)), c.proj === 'webmerc' ? 0 : c.e) / D;
  } else {
    // Inversión de las mismas fórmulas mediante Newton con jacobiano numérico: evita una segunda serie truncada.
    if (c.proj === 'stere' || c.proj === 'sterea') { lon = c.lon_0 + (Math.abs(c.lat_0) > 89 ? Math.atan2(x, -Math.sign(c.lat_0) * y) / D : 0); lat = Math.abs(c.lat_0) > 89 ? Math.sign(c.lat_0) * 75 : c.lat_0; }
    lat = Math.max(-89, Math.min(89, lat));
    let ok = false;
    for (let i = 0; i < 45; i++) {
      const q = rawForward(c, lon, lat), dx = x - q[0], dy = y - q[1];
      if (Math.hypot(dx, dy) < 0.00001) { ok = true; break; }
      const step = 0.00001, u = rawForward(c, lon + step, lat), v = rawForward(c, lon, lat + step), A = (u[0] - q[0]) / step, B = (v[0] - q[0]) / step, C = (u[1] - q[1]) / step, E = (v[1] - q[1]) / step, det = A * E - B * C;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
      const dl = (dx * E - B * dy) / det, dp = (A * dy - dx * C) / det, damp = Math.min(1, 15 / Math.max(Math.abs(dl), Math.abs(dp)));
      lon += dl * damp; lat = Math.max(-89.999999, Math.min(89.999999, lat + dp * damp));
    }
    if (!ok) throw Error('No converge la proyección inversa; punto fuera de dominio.');
  }
  return { lon: finite(wrap(lon * D) / D, 'Longitud inválida.'), lat: finite(lat, 'Latitud inválida.'), h: point.z ?? 0 };
}
function cart(p, c) { const l = p.lon * D, f = p.lat * D, N = c.a / Math.sqrt(1 - c.e2 * Math.sin(f) ** 2), h = p.h || 0; return [(N + h) * Math.cos(f) * Math.cos(l), (N + h) * Math.cos(f) * Math.sin(l), (N * (1 - c.e2) + h) * Math.sin(f)]; }
function geod(v, c) { const [x, y, z] = v, r = Math.hypot(x, y); let p = Math.atan2(z, r * (1 - c.e2)); for (let i = 0; i < 15; i++) { const N = c.a / Math.sqrt(1 - c.e2 * Math.sin(p) ** 2); const q = Math.atan2(z + c.e2 * N * Math.sin(p), r); if (Math.abs(q - p) < 1e-14) { p = q; break; } p = q; } const N = c.a / Math.sqrt(1 - c.e2 * Math.sin(p) ** 2); return { lon: Math.atan2(y, x) / D, lat: p / D, h: Math.abs(Math.cos(p)) > 1e-8 ? r / Math.cos(p) - N : Math.abs(z) - N * (1 - c.e2) }; }
function helmert(v, params, inv = false) {
  const [dx, dy, dz, rx = 0, ry = 0, rz = 0, ppm = 0] = params.map(Number), r = D / 3600, s = 1 + ppm * 1e-6;
  const A = [[s, -s * rz * r, s * ry * r], [s * rz * r, s, -s * rx * r], [-s * ry * r, s * rx * r, s]], t = [dx, dy, dz];
  if (!inv) return A.map((row, i) => t[i] + row.reduce((z, a, j) => z + a * v[j], 0));
  const m = A.map((row, i) => [...row, v[i] - t[i]]);
  for (let i = 0; i < 3; i++) { const f = m[i][i]; for (let j = i; j < 4; j++) m[i][j] /= f; for (let k = 0; k < 3; k++) if (k !== i) { const q = m[k][i]; for (let j = i; j < 4; j++) m[k][j] -= q * m[i][j]; } }
  return m.map(row => row[3]);
}
export function transform(point, source, target) {
  const s = resolveCRS(source), t = resolveCRS(target), p = inverse(s, point);
  const same = s.a === t.a && s.e2 === t.e2 && JSON.stringify(s.towgs84) === JSON.stringify(t.towgs84);
  const q = same ? p : geod(helmert(helmert(cart(p, s), s.towgs84), t.towgs84, true), t);
  return forward(t, q);
}
