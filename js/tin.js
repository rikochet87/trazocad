// TIN 2,5D: Delaunay incremental, aristas obligatorias y curvas interpoladas linealmente.
// Filtro de error de redondeo; en casos casi degenerados se evalúa el signo
// exacto de los números IEEE-754 mediante enteros, sin bibliotecas externas.
const bits = new DataView(new ArrayBuffer(8));
function dyadic(value) {
  bits.setFloat64(0, value);
  const hi = bits.getUint32(0),
    lo = bits.getUint32(4),
    exp = (hi >>> 20) & 2047;
  let n = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp) n |= 1n << 52n;
  return { n: hi >>> 31 ? -n : n, e: exp ? exp - 1075 : -1074 };
}
function exactSign(points, circle = false) {
  const q = points.flatMap(p => [dyadic(p.x), dyadic(p.y)]),
    ex = Math.min(...q.map(p => p.e)),
    v = q.map(p => p.n << BigInt(p.e - ex));
  const last = points.length - 1,
    x = v[2 * last],
    y = v[2 * last + 1],
    a = v[0] - x,
    b = v[1] - y,
    c = v[2] - x,
    d = v[3] - y;
  let det = a * d - b * c;
  if (circle) {
    const e = v[4] - x,
      f = v[5] - y;
    det = (a * a + b * b) * (c * f - d * e) - (c * c + d * d) * (a * f - b * e) + (e * e + f * f) * (a * d - b * c);
  }
  return det > 0n ? 1 : det < 0n ? -1 : 0;
}
const orient = (a, b, c) => {
  const l = (b.x - a.x) * (c.y - a.y),
    r = (b.y - a.y) * (c.x - a.x),
    det = l - r;
  if (Math.abs(det) > 8 * Number.EPSILON * (Math.abs(l) + Math.abs(r))) return det;
  return exactSign([a, b, c]) * Math.max(Math.abs(det), Number.MIN_VALUE);
};
const edge = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
const ccw = (t, p) => (orient(p[t[0]], p[t[1]], p[t[2]]) > 0 ? t : [t[1], t[0], t[2]]);
function insideCircle(a, b, c, p) {
  const ax = a.x - p.x,
    ay = a.y - p.y,
    bx = b.x - p.x,
    by = b.y - p.y,
    cx = c.x - p.x,
    cy = c.y - p.y;
  const al = ax * ax + ay * ay,
    bl = bx * bx + by * by,
    cl = cx * cx + cy * cy;
  const det = al * (bx * cy - by * cx) - bl * (ax * cy - ay * cx) + cl * (ax * by - ay * bx);
  const bound =
    16 *
    Number.EPSILON *
    (al * (Math.abs(bx * cy) + Math.abs(by * cx)) +
      bl * (Math.abs(ax * cy) + Math.abs(ay * cx)) +
      cl * (Math.abs(ax * by) + Math.abs(ay * bx)));
  if (Math.abs(det) > bound) return det;
  return exactSign([a, b, c, p], true) * Math.max(Math.abs(det), Number.MIN_VALUE);
}
function crossing(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-14) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den,
    u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  return t > 1e-10 && t < 1 - 1e-10 && u > 1e-10 && u < 1 - 1e-10 ? { t, u } : null;
}
export function containsXY(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function delaunay(vertices, progress) {
  const p = vertices.map(q => ({ ...q })),
    n = p.length,
    x1 = Math.min(...p.map(q => q.x)),
    x2 = Math.max(...p.map(q => q.x)),
    y1 = Math.min(...p.map(q => q.y)),
    y2 = Math.max(...p.map(q => q.y)),
    d = Math.max(x2 - x1, y2 - y1);
  if (!(d > 0) || !Number.isFinite(d * 64)) throw Error('Puntos coincidentes.');
  const x = (x1 + x2) / 2,
    y = (y1 + y2) / 2;
  p.push({ x: x - 32 * d, y: y - 16 * d }, { x: x + 32 * d, y: y - 16 * d }, { x, y: y + 32 * d });
  let ts = [[n, n + 1, n + 2]];
  // Orden espacial determinista; todo el cálculo ocurre en el worker.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => p[a].x - p[b].x || p[a].y - p[b].y);
  for (let k = 0; k < n; k++) {
    const i = order[k],
      boundary = new Map(),
      keep = [];
    for (const t of ts) {
      if (insideCircle(p[t[0]], p[t[1]], p[t[2]], p[i]) > 0) {
        for (let j = 0; j < 3; j++) {
          const a = t[j],
            b = t[(j + 1) % 3],
            key = edge(a, b);
          if (boundary.has(key)) boundary.delete(key);
          else boundary.set(key, [a, b]);
        }
      } else keep.push(t);
    }
    for (const [a, b] of boundary.values()) if (Math.abs(orient(p[a], p[b], p[i])) !== 0) keep.push(ccw([a, b, i], p));
    ts = keep;
    if (k % 64 === 0) progress?.((k / n) * 0.65);
  }
  return ts.filter(t => t.every(i => i < n));
}
function adjacency(ts) {
  const m = new Map();
  ts.forEach((t, i) => {
    for (let j = 0; j < 3; j++) {
      const a = t[j],
        b = t[(j + 1) % 3],
        k = edge(a, b);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ i, a, b, c: t[(j + 2) % 3] });
    }
  });
  return m;
}
export function buildTIN(input, o = {}, progress = () => {}) {
  if (!Array.isArray(input) || input.length < 3 || input.length > 5000)
    throw Error('Una TIN admite entre 3 y 5 000 puntos; divida levantamientos mayores.');
  const tol = o.tolerance ?? 1e-6,
    zt = o.zTolerance ?? 0.001;
  if (!(tol > 0) || !(zt >= 0) || ![tol, zt].every(Number.isFinite)) throw Error('Tolerancias inválidas.');
  const raw = input.map(p => ({ ...p })),
    paths = [
      ...(o.breaklines || []).map(pts => ({ pts, hard: true })),
      ...(o.boundaries || []).map(pts => ({ pts, closed: true })),
      ...(o.holes || []).map(pts => ({ pts, closed: true })),
    ];
  const vertices = [],
    bins = new Map();
  let duplicates = 0;
  const add = p => {
    if (![p.x, p.y, p.z].every(Number.isFinite)) throw Error('Coordenada o cota no finita.');
    const bx = Math.floor(p.x / tol),
      by = Math.floor(p.y / tol);
    if (!Number.isSafeInteger(bx) || !Number.isSafeInteger(by) || Math.abs(bx) > 2 ** 50 || Math.abs(by) > 2 ** 50)
      throw Error('Coordenadas demasiado grandes para la tolerancia XY; use un origen local o aumente la tolerancia.');
    for (let x = bx - 1; x <= bx + 1; x++)
      for (let y = by - 1; y <= by + 1; y++)
        for (const i of bins.get(`${x},${y}`) || [])
          if (Math.hypot(vertices[i].x - p.x, vertices[i].y - p.y) <= tol) {
            if (Math.abs(vertices[i].z - p.z) > zt)
              throw Error('Cotas incompatibles en una misma posición XY; una TIN no admite paredes verticales.');
            duplicates++;
            return i;
          }
    const i = vertices.length;
    if (i >= 7000) throw Error('Máximo 7 000 vértices tras insertar restricciones.');
    vertices.push({ ...p });
    const key = `${bx},${by}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(i);
    return i;
  };
  for (const path of paths)
    if (path.closed) {
      const ring = path.pts;
      if (ring.some(p => ![p.x, p.y].every(Number.isFinite))) throw Error('Límite con coordenadas inválidas.');
      for (let i = 0; i < ring.length; i++)
        for (let j = i + 2; j < ring.length; j++) {
          if (i === 0 && j === ring.length - 1) continue;
          if (crossing(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length]))
            throw Error('Los límites deben ser anillos simples sin autointersecciones.');
        }
    }
  raw.forEach(add);
  for (const path of paths) if (path.hard) path.pts.forEach(add);
  let ts = delaunay(vertices, progress);
  if (!ts.length) throw Error('Los puntos son colineales.');
  // Los límites son planimétricos: sus cotas se toman del terreno inicial.
  const segments = [];
  for (const path of paths) {
    if (path.pts.length < (path.closed ? 3 : 2)) throw Error('Línea de quiebre o límite insuficiente.');
    const ids = path.pts.map(p => {
      if (path.hard) return add(p);
      const sample = sampleTIN({ vertices, triangles: ts }, p);
      if (!sample) throw Error('Todos los vértices de los límites deben estar dentro de la envolvente de los puntos.');
      return add({ ...p, z: sample.z });
    });
    for (let i = 0; i < ids.length - (path.closed ? 0 : 1); i++)
      if (ids[i] !== ids[(i + 1) % ids.length]) {
        const segment = [ids[i], ids[(i + 1) % ids.length]];
        segment.hard = !!path.hard;
        segments.push(segment);
      }
  }
  if (segments.length > 2000) throw Error('Máximo 2 000 segmentos de restricciones.');
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const [a, b] = segments[i].map(k => vertices[k]),
        [c, d] = segments[j].map(k => vertices[k]),
        q = crossing(a, b, c, d);
      if (q) {
        const z = a.z + q.t * (b.z - a.z),
          z2 = c.z + q.u * (d.z - c.z);
        if (segments[i].hard && segments[j].hard && Math.abs(z - z2) > zt)
          throw Error('Restricciones cruzadas con cotas incompatibles.');
        const x = a.x + q.t * (b.x - a.x),
          y = a.y + q.t * (b.y - a.y),
          height = segments[i].hard ? z : segments[j].hard ? z2 : sampleTIN({ vertices, triangles: ts }, { x, y })?.z;
        add({ x, y, z: height });
      }
    }
  if (vertices.length > 7000) throw Error('Demasiados vértices tras insertar restricciones.');
  const split = [];
  for (const segment of segments) {
    const [a, b] = segment;
    const A = vertices[a],
      B = vertices[b],
      dx = B.x - A.x,
      dy = B.y - A.y,
      l2 = dx * dx + dy * dy,
      chain = [];
    vertices.forEach((p, i) => {
      const t = ((p.x - A.x) * dx + (p.y - A.y) * dy) / l2;
      if (t >= -1e-10 && t <= 1 + 1e-10 && Math.abs(orient(A, B, p)) <= tol * Math.sqrt(l2)) {
        if (segment.hard && Math.abs(p.z - (A.z + t * (B.z - A.z))) > zt)
          throw Error('Un punto sobre una restricción tiene otra cota.');
        chain.push({ i, t });
      }
    });
    chain.sort((a, b) => a.t - b.t);
    for (let i = 1; i < chain.length; i++) split.push([chain[i - 1].i, chain[i].i]);
  }
  if (paths.length) ts = delaunay(vertices, progress);
  const locked = new Set();
  for (let k = 0; k < split.length; k++) {
    const [a, b] = split[k],
      target = edge(a, b);
    let count = 0;
    while (true) {
      const adj = adjacency(ts);
      if (adj.has(target)) {
        locked.add(target);
        break;
      }
      if (++count > ts.length * 4)
        throw Error('No se pudo recuperar una restricción; simplifique geometría o revise tolerancias.');
      let flipped = false;
      for (const [key, pair] of adj) {
        if (pair.length !== 2 || locked.has(key)) continue;
        const [u, v] = pair;
        if (!crossing(vertices[a], vertices[b], vertices[u.a], vertices[u.b])) continue;
        if (!crossing(vertices[u.a], vertices[u.b], vertices[u.c], vertices[v.c])) continue;
        ts[u.i] = ccw([u.c, v.c, u.a], vertices);
        ts[v.i] = ccw([v.c, u.c, u.b], vertices);
        flipped = true;
        break;
      }
      if (!flipped) throw Error('Restricción degenerada: revise vértices y tolerancias.');
    }
    progress(0.65 + (0.25 * (k + 1)) / Math.max(1, split.length));
  }
  // Legalizar las aristas libres; las restricciones permanecen fijas.
  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    const used = new Set();
    for (const [key, pair] of adjacency(ts)) {
      if (pair.length !== 2 || locked.has(key)) continue;
      const [u, v] = pair;
      if (used.has(u.i) || used.has(v.i) || !crossing(vertices[u.a], vertices[u.b], vertices[u.c], vertices[v.c]))
        continue;
      const t = ccw([u.a, u.b, u.c], vertices);
      const scale = Math.max(
        ...t.map(i => Math.hypot(vertices[i].x - vertices[v.c].x, vertices[i].y - vertices[v.c].y)),
        1
      );
      if (insideCircle(...t.map(i => vertices[i]), vertices[v.c]) > 1e-12 * scale ** 4) {
        ts[u.i] = ccw([u.c, v.c, u.a], vertices);
        ts[v.i] = ccw([v.c, u.c, u.b], vertices);
        used.add(u.i);
        used.add(v.i);
        changed = true;
      }
    }
    if (!changed) break;
    if (pass === 99) throw Error('Legalización no convergente; revise la precisión de entrada.');
  }
  ts = ts.filter(t => {
    const c = {
      x: t.reduce((s, i) => s + vertices[i].x, 0) / 3,
      y: t.reduce((s, i) => s + vertices[i].y, 0) / 3,
    };
    return (!o.boundaries?.length || o.boundaries.some(r => containsXY(c, r))) && !o.holes?.some(r => containsXY(c, r));
  });
  if (!ts.length) throw Error('Los límites excluyen toda la superficie.');
  progress(1);
  return { vertices, triangles: ts, constraints: split, duplicates };
}
export function sampleTIN(mesh, p) {
  for (const t of mesh.triangles) {
    const [a, b, c] = t.map(i => mesh.vertices[i]),
      d = orient(a, b, c);
    if (Math.abs(d) < 1e-20) continue;
    const u = orient(b, c, p) / d,
      v = orient(c, a, p) / d,
      w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-9) continue;
    const gx = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / d,
      gy = ((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / d;
    return {
      z: u * a.z + v * b.z + w * c.z,
      slope: (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI,
      percent: 100 * Math.hypot(gx, gy),
      aspect: Math.hypot(gx, gy) < 1e-12 ? -1 : ((Math.atan2(-gx, -gy) * 180) / Math.PI + 360) % 360,
    };
  }
  return null;
}
export function meshStats(mesh) {
  let area = 0,
    area3d = 0,
    min = Infinity,
    max = -Infinity,
    maxSlope = 0;
  for (const t of mesh.triangles) {
    const [a, b, c] = t.map(i => mesh.vertices[i]),
      s = sampleTIN({ vertices: mesh.vertices, triangles: [t] }, a),
      ar = Math.abs(orient(a, b, c)) / 2;
    area += ar;
    area3d += ar * Math.sqrt(1 + (s.percent / 100) ** 2);
    maxSlope = Math.max(maxSlope, s.slope);
    for (const p of [a, b, c]) {
      min = Math.min(min, p.z);
      max = Math.max(max, p.z);
    }
  }
  return { area, area3d, min, max, maxSlope, triangles: mesh.triangles.length };
}
export function contours(mesh, o = {}, progress = () => {}) {
  const interval = +o.interval,
    majorEvery = o.majorEvery ?? 5,
    base = Number(o.base ?? 0);
  if (!Number.isFinite(base)) throw Error('Cota base inválida.');
  if (!(interval > 0) || !Number.isFinite(interval) || !Number.isInteger(majorEvery) || majorEvery < 1)
    throw Error('Intervalo positivo y frecuencia mayor entera requeridos.');
  const range = mesh.vertices.reduce((b, p) => ({ min: Math.min(b.min, p.z), max: Math.max(b.max, p.z) }), {
      min: Infinity,
      max: -Infinity,
    }),
    lo = Math.ceil((range.min - base) / interval),
    hi = Math.floor((range.max - base) / interval);
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi))
    throw Error('Intervalo o cota base fuera de precisión numérica.');
  if (hi - lo > 2000 || mesh.triangles.length * (hi - lo + 1) > 1e7)
    throw Error('Demasiadas curvas; aumente el intervalo.');
  const out = [];
  let count = 0;
  for (let k = lo; k <= hi; k++) {
    const level = base + k * interval,
      segments = new Map(),
      key = p => `${Math.round(p.x / 1e-7)},${Math.round(p.y / 1e-7)}`;
    for (const t of mesh.triangles) {
      const pts = t.map(i => mesh.vertices[i]);
      if (pts.every(p => p.z === level)) continue;
      const cuts = new Map();
      for (let j = 0; j < 3; j++) {
        const a = pts[j],
          b = pts[(j + 1) % 3];
        if (a.z === level && b.z === level) {
          cuts.set(key(a), { ...a });
          cuts.set(key(b), { ...b });
        } else if ((a.z <= level && b.z > level) || (b.z <= level && a.z > level)) {
          const f = (level - a.z) / (b.z - a.z),
            p = {
              x: a.x + f * (b.x - a.x),
              y: a.y + f * (b.y - a.y),
              z: level,
            };
          cuts.set(key(p), p);
        }
      }
      if (cuts.size === 2) {
        const ps = [...cuts.values()],
          ks = ps.map(key).sort().join('|');
        segments.set(ks, ps);
      }
    }
    const links = new Map(),
      ss = [...segments.values()],
      used = new Set();
    ss.forEach((s, i) =>
      s.forEach(p => {
        const q = key(p);
        if (!links.has(q)) links.set(q, []);
        links.get(q).push(i);
      })
    );
    const walk = (i, start) => {
      let p = start,
        pts = [p];
      while (i != null && !used.has(i)) {
        used.add(i);
        const s = ss[i];
        p = key(s[0]) === key(p) ? s[1] : s[0];
        pts.push(p);
        const next = links.get(key(p));
        if (next.length !== 2) break;
        i = next.find(j => !used.has(j));
      }
      if (++count > 100000) throw Error('Demasiadas curvas.');
      out.push({
        pts,
        level,
        major: k % majorEvery === 0,
        closed: key(pts[0]) === key(pts.at(-1)),
      });
    };
    ss.forEach((s, i) => {
      if (!used.has(i)) {
        const p = s.find(p => links.get(key(p)).length !== 2);
        if (p) walk(i, p);
      }
    });
    ss.forEach((s, i) => {
      if (!used.has(i)) walk(i, s[0]);
    });
    progress((k - lo + 1) / (hi - lo + 1));
  }
  return out;
}
