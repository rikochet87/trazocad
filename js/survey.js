// Levantamientos y compensación: funciones puras, sin acceso al documento.
export const emptyTopo = () => ({
  groups: [],
  keys: [],
  surfaces: [],
  traverses: [],
  nextId: 1,
});
export function parseSurvey(text, o = {}) {
  const format = (o.format || 'PNEZD').toUpperCase().replace(/[ ,;\t]/g, '');
  if (
    !/^[PNEZD_]+$/.test(format) ||
    !['P', 'N', 'E'].every(c => format.includes(c)) ||
    [...'PNEZD'].some(c => format.split(c).length > 2)
  )
    throw Error('Formato inválido: P, N y E son obligatorios y no se repiten.');
  const delimiter = o.delimiter === 'tab' ? '\t' : o.delimiter || ',',
    rows = [];
  let row = [],
    cell = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some(Boolean) && !/^\s*(#|\/\/)/.test(row[0])) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else if (!quoted && (delimiter === 'space' ? /[ \t]/.test(c) : c === delimiter)) {
      if (delimiter !== 'space' || cell) endCell();
    } else cell += c;
  }
  if (quoted) throw Error('Comillas sin cerrar.');
  if (cell || row.length) endRow();
  if (o.header) rows.shift();
  if (rows.length > 50000) throw Error('Máximo 50 000 puntos por lote.');
  const seen = new Set(),
    number = (s, line) => {
      if (o.decimalComma && delimiter !== ',') s = s.replace(',', '.');
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s) || !Number.isFinite(+s))
        throw Error(`Registro ${line}: coordenada inválida «${s}».`);
      return +s;
    };
  return rows.map((r, i) => {
    if (r.length !== format.length)
      throw Error(`Registro ${i + 1}: se esperaban ${format.length} campos, hay ${r.length}.`);
    const q = Object.fromEntries([...format].map((k, j) => [k, r[j]]));
    if (!q.P || seen.has(q.P)) throw Error(`Número de punto vacío o duplicado: ${q.P}.`);
    seen.add(q.P);
    return {
      number: q.P,
      east: number(q.E, i + 1),
      north: number(q.N, i + 1),
      z: q.Z == null ? 0 : number(q.Z, i + 1),
      description: q.D || '',
    };
  });
}
export const wildcard = (s, pattern = '*') =>
  new RegExp(
    '^' +
      String(pattern)
        .split('*')
        .map(p =>
          p
            .split('?')
            .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.')
        )
        .join('.*') +
      '$',
    'i'
  ).test(String(s));
export function pointInGroup(e, g) {
  return (
    e.topoPoint &&
    (!g.ids?.length || g.ids.includes(e.id)) &&
    wildcard(e.data?.numero || '', g.number || '*') &&
    wildcard(e.data?.descripcion || '', g.description || '*') &&
    wildcard(e.layer, g.layer || '*')
  );
}
export function pointAppearance(doc, e) {
  let a = e.topoPoint || {};
  for (const g of doc.topo?.groups || []) if (pointInGroup(e, g)) a = { ...a, ...g };
  return a;
}
export function surveyLabel(doc, e) {
  if (!e.topoPoint) return null;
  const a = pointAppearance(doc, e);
  if (a.label === 'none') return null;
  const text = (a.label || 'PZD')
    .split('')
    .map(c =>
      c === 'P' ? e.data?.numero : c === 'Z' ? (e.elev || 0).toFixed(3) : c === 'D' ? e.data?.descripcion : ''
    )
    .filter(Boolean)
    .join(' · ');
  return {
    type: 'text',
    p: { x: e.p.x + (a.size || 1), y: e.p.y + (a.size || 1) },
    h: a.height || 1.5,
    text,
    rot: 0,
    layer: e.layer,
    color: a.color || e.color,
  };
}
export function pointMarker(doc, e) {
  const a = pointAppearance(doc, e),
    s = +a.size || 1,
    p = e.p;
  if (a.symbol === 'circle') return { type: 'circle', c: p, r: s };
  if (a.symbol === 'square' || a.symbol === 'triangle') {
    const pts =
      a.symbol === 'square'
        ? [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]
        : [
            [0, 1],
            [-1, -1],
            [1, -1],
          ];
    return {
      type: 'pline',
      closed: true,
      pts: pts.map(([x, y]) => ({ x: p.x + x * s, y: p.y + y * s })),
    };
  }
  return {
    type: 'center',
    lines: [
      [
        { x: p.x - s, y: p.y },
        { x: p.x + s, y: p.y },
      ],
      [
        { x: p.x, y: p.y - s },
        { x: p.x, y: p.y + s },
      ],
    ],
  };
}
export function adjustTraverse(o) {
  const legs = o.legs;
  if (!Array.isArray(legs) || !legs.length || legs.length > 10000) throw Error('Indique entre 1 y 10 000 tramos.');
  const start = o.start || { x: 0, y: 0 },
    end = o.end || start,
    method = o.method || 'bowditch';
  if (o.angleUnit && !['degrees', 'gon'].includes(o.angleUnit)) throw Error('Unidad angular desconocida.');
  if (o.maxClosure != null && (!(o.maxClosure >= 0) || !Number.isFinite(o.maxClosure)))
    throw Error('Cierre máximo inválido.');
  if (!Number.isFinite(start.z ?? 0)) throw Error('Cota inicial inválida.');
  if (!['bowditch', 'transit'].includes(method)) throw Error('Método desconocido.');
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) throw Error('Coordenadas de control inválidas.');
  const v = legs.map(l => {
    if (!(l.distance > 0) || !Number.isFinite(l.distance) || !Number.isFinite(l.azimuth) || !Number.isFinite(l.dz ?? 0))
      throw Error('Distancia o azimut inválido.');
    const a = l.azimuth * (o.angleUnit === 'gon' ? Math.PI / 200 : Math.PI / 180);
    return {
      dx: l.distance * Math.sin(a),
      dy: l.distance * Math.cos(a),
      d: l.distance,
      dz: +l.dz || 0,
    };
  });
  const length = v.reduce((s, l) => s + l.d, 0),
    ex = start.x + v.reduce((s, l) => s + l.dx, 0) - end.x,
    ey = start.y + v.reduce((s, l) => s + l.dy, 0) - end.y,
    closure = Math.hypot(ex, ey),
    sx = v.reduce((s, l) => s + Math.abs(l.dx), 0),
    sy = v.reduce((s, l) => s + Math.abs(l.dy), 0);
  if (o.maxClosure != null && closure > o.maxClosure)
    throw Error(`Cierre ${closure} supera la tolerancia ${o.maxClosure}.`);
  if (method === 'transit' && ((sx < 1e-12 && Math.abs(ex) > 1e-9) || (sy < 1e-12 && Math.abs(ey) > 1e-9)))
    throw Error('Tránsito no puede repartir el cierre en un eje sin proyecciones.');
  if (![length, ex, ey, closure, sx, sy].every(Number.isFinite))
    throw Error('El cálculo de cierre excede la precisión numérica.');
  let p = { ...start, z: start.z || 0 };
  const points = [{ ...p }],
    corrections = [];
  for (const l of v) {
    const cx = -ex * (method === 'bowditch' ? l.d / length : sx ? Math.abs(l.dx) / sx : 0),
      cy = -ey * (method === 'bowditch' ? l.d / length : sy ? Math.abs(l.dy) / sy : 0);
    corrections.push({ x: cx, y: cy });
    p = { x: p.x + l.dx + cx, y: p.y + l.dy + cy, z: p.z + l.dz };
    if (![p.x, p.y, p.z].every(Number.isFinite)) throw Error('La compensación produjo coordenadas no finitas.');
    points.push(p);
  }
  return {
    points,
    corrections,
    length,
    error: { x: ex, y: ey },
    closure,
    precision: closure ? length / closure : null,
    method,
  };
}
