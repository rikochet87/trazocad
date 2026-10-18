// Lectura y escritura de DXF ASCII. Escribe DXF 2000 (AC1015) o R12 (AC1009). Exporta el espacio modelo y los bloques.
import * as G from './geom.js';
import { LTYPES, aciToHex, hexToAci, dimParts, ellPts } from './entities.js';
import { PATTERNS, famsOf, hatchSegments } from './patterns.js';
const { P } = G;

const num = v => (Math.abs(v) < 1e-12 ? 0 : +(+v).toFixed(10));
const lwCode = lw => (lw === 'BYLAYER' ? -1 : lw === 'BYBLOCK' ? -2 : lw === 'DEFAULT' ? -3 : Math.round(lw * 100));
const tcolor = hex => parseInt(hex.slice(1), 16);

// ================= EXPORTAR =================
export function writeDXF(doc, version = '2000') {
  const R12 = version === 'R12';
  const o = [];
  const g = (code, val) => { o.push(String(code), String(val)); };
  let hseed = 0x30;
  const H = () => (hseed++).toString(16).toUpperCase();
  const xy = (k, p) => { g(10 + k, num(p.x)); g(20 + k, num(p.y)); g(30 + k, 0); };

  // Tablas de registros de bloque (2000)
  const userBlocks = Object.values(doc.blocks).filter(b => !b.name.startsWith('*'));
  const brMS = H(), brPS = H(), brUser = Object.fromEntries(userBlocks.map(b => [b.name, H()]));

  const common = (type, e, owner, subclass) => {
    g(0, type);
    if (!R12) { g(5, H()); g(330, owner); g(100, 'AcDbEntity'); }
    g(8, e.layer);
    if (e.ltype && e.ltype !== 'BYLAYER') g(6, e.ltype === 'BYBLOCK' ? 'ByBlock' : e.ltype);
    if (e.color === 'BYBLOCK') g(62, 0);
    else if (e.color && e.color !== 'BYLAYER') { g(62, hexToAci(e.color)); if (!R12) g(420, tcolor(e.color)); }
    if (!R12 && e.lw !== undefined && e.lw !== 'BYLAYER') g(370, lwCode(e.lw));
    if (!R12 && subclass) g(100, subclass);
  };
  const line = (e, a, b, ow) => { common('LINE', e, ow, 'AcDbLine'); xy(0, a); xy(1, b); };
  const arc = (e, c, r, a1, a2, ow) => { common('ARC', e, ow, 'AcDbCircle'); xy(0, c); g(40, num(r)); if (!R12) g(100, 'AcDbArc'); g(50, num(G.deg(G.normAng(a1)))); g(51, num(G.deg(G.normAng(a2)))); };
  const poly = (e, pts, closed, bulges, ow) => {
    if (R12) {
      common('POLYLINE', e, ow); g(66, 1); xy(0, P(0, 0)); g(70, closed ? 1 : 0);
      pts.forEach((p, i) => { g(0, 'VERTEX'); g(8, e.layer); xy(0, p); if (bulges?.[i]) g(42, num(bulges[i])); });
      g(0, 'SEQEND'); g(8, e.layer);
      return;
    }
    common('LWPOLYLINE', e, ow, 'AcDbPolyline'); g(90, pts.length); g(70, closed ? 1 : 0); g(43, 0);
    pts.forEach((p, i) => { g(10, num(p.x)); g(20, num(p.y)); if (bulges?.[i]) g(42, num(bulges[i])); });
  };
  const text = (e, t, ow) => {
    const st = doc.textStyle(t.style);
    common('TEXT', e, ow, 'AcDbText'); xy(0, t.p); g(40, num(t.h)); g(1, t.text ?? t.str);
    if (t.rot) g(50, num(G.deg(t.rot)));
    if (st.width && st.width !== 1) g(41, st.width);
    if (st.oblique) g(51, st.oblique);
    g(7, st.name);
    const j = { c: 1, r: 2 }[t.align];
    if (j) { g(72, j); xy(1, t.p); }
    if (!R12) g(100, 'AcDbText');
  };
  const solid = (e, tri, ow) => { common('SOLID', e, ow, 'AcDbTrace'); xy(0, tri[0]); xy(1, tri[1]); xy(2, tri[2]); xy(3, tri[3] || tri[2]); };
  const hatch = (e, ow) => {
    if (R12) { // R12 no tiene HATCH: contorno + líneas del patrón
      for (const l of e.loops) poly(e, l, true, null, ow);
      const bb = e.loops.flat().reduce((r, p) => ({ x1: Math.min(r.x1, p.x), y1: Math.min(r.y1, p.y), x2: Math.max(r.x2, p.x), y2: Math.max(r.y2, p.y) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
      for (const [a, b] of hatchSegments(e, bb)) line(e, a, b, ow);
      return;
    }
    const solidFill = e.pattern === 'SOLID';
    common('HATCH', e, ow, 'AcDbHatch');
    xy(0, P(0, 0)); g(210, 0); g(220, 0); g(230, 1);
    g(2, solidFill ? 'SOLID' : e.pattern); g(70, solidFill ? 1 : 0); g(71, 0); g(91, e.loops.length);
    e.loops.forEach((l, i) => {
      g(92, i ? 2 : 3); g(72, 0); g(73, 1); g(93, l.length);
      for (const p of l) { g(10, num(p.x)); g(20, num(p.y)); }
      g(97, 0);
    });
    g(75, 0); g(76, 1);
    if (!solidFill) {
      g(52, num(e.angle || 0)); g(41, num(e.scale || 1)); g(77, 0);
      const fams = famsOf(e);
      g(78, fams.length);
      for (const f of fams) {
        g(53, num(G.deg(f.ang))); g(43, num(f.o.x)); g(44, num(f.o.y));
        const off = G.add(G.mul(f.u, f.dx), G.mul(f.n, f.dy));
        g(45, num(off.x)); g(46, num(off.y)); g(79, f.dash.length);
        for (const d of f.dash) g(49, num(d));
      }
    }
    g(98, 0);
  };

  const writeEnt = (e, ow) => {
    switch (e.type) {
      case 'line': line(e, e.p1, e.p2, ow); break;
      case 'circle': common('CIRCLE', e, ow, 'AcDbCircle'); xy(0, e.c); g(40, num(e.r)); break;
      case 'arc': arc(e, e.c, e.r, e.a1, e.a2, ow); break;
      case 'pline': poly(e, e.pts, e.closed, e.bulges, ow); break;
      case 'ellipse':
        if (R12) poly(e, ellPts(e, 72), true, null, ow);
        else {
          common('ELLIPSE', e, ow, 'AcDbEllipse'); xy(0, e.c);
          const big = e.rx >= e.ry, maj = big ? G.polar(P(0, 0), e.rot, e.rx) : G.polar(P(0, 0), e.rot + Math.PI / 2, e.ry);
          xy(1, maj); g(210, 0); g(220, 0); g(230, 1);
          g(40, num(big ? e.ry / e.rx : e.rx / e.ry)); g(41, 0); g(42, num(G.TAU));
        }
        break;
      case 'point': common('POINT', e, ow, 'AcDbPoint'); xy(0, e.p); break;
      case 'text': text(e, e, ow); break;
      case 'hatch': hatch(e, ow); break;
      case 'insert':
        common('INSERT', e, ow, 'AcDbBlockReference'); g(2, e.name); xy(0, e.p);
        g(41, num(e.sx ?? 1)); g(42, num(e.sy ?? 1)); g(43, 1);
        if (e.rot) g(50, num(G.deg(e.rot)));
        break;
      case 'dim': {
        const d = dimParts(e);
        for (const [a, b] of d.lines) line(e, a, b, ow);
        for (const tri of d.arrows) solid(e, tri, ow);
        for (const [c, r] of d.dots) { common('CIRCLE', e, ow, 'AcDbCircle'); xy(0, c); g(40, num(r)); }
        text(e, d.text, ow);
        break;
      }
    }
  };

  // ---- HEADER ----
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, R12 ? 'AC1009' : 'AC1015');
  if (!R12) { g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252'); g(9, '$INSUNITS'); g(70, 4); g(9, '$MEASUREMENT'); g(70, 1); }
  g(9, '$LTSCALE'); g(40, doc.settings.ltscale);
  const ext = doc.extents(doc.model);
  if (ext) { g(9, '$EXTMIN'); xy(0, P(ext.x1, ext.y1)); g(9, '$EXTMAX'); xy(0, P(ext.x2, ext.y2)); }
  const seedAt = o.length;
  if (!R12) { g(9, '$HANDSEED'); g(5, 'FFFFF'); }
  g(0, 'ENDSEC');

  if (!R12) { g(0, 'SECTION'); g(2, 'CLASSES'); g(0, 'ENDSEC'); }

  // ---- TABLES ----
  g(0, 'SECTION'); g(2, 'TABLES');
  const table = (name, count, fn, sub) => {
    const th = H();
    g(0, 'TABLE'); g(2, name);
    if (!R12) { g(5, th); g(330, 0); g(100, 'AcDbSymbolTable'); }
    g(70, count);
    if (!R12 && sub) g(100, sub);
    fn(th);
    g(0, 'ENDTAB');
  };
  const rec = (type, th, sub, handleCode = 5) => { g(0, type); if (!R12) { g(handleCode, H()); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, sub); } };
  table('VPORT', 1, th => {
    rec('VPORT', th, 'AcDbViewportTableRecord');
    g(2, '*ACTIVE'); g(70, 0); g(10, 0); g(20, 0); g(11, 1); g(21, 1);
    const c = ext ? P((ext.x1 + ext.x2) / 2, (ext.y1 + ext.y2) / 2) : P(0, 0);
    g(12, num(c.x)); g(22, num(c.y)); g(13, 0); g(23, 0); g(14, 10); g(24, 10); g(15, 10); g(25, 10);
    g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0);
    g(40, num(ext ? Math.max(ext.y2 - ext.y1, 1) * 1.1 : 300)); g(41, 1.6); g(42, 50); g(43, 0); g(44, 0); g(50, 0); g(51, 0);
    g(71, 0); g(72, 100); g(73, 1); g(74, 3); g(75, 0); g(76, 0); g(77, 0); g(78, 0);
  });
  const lts = [['ByBlock', '', []], ['ByLayer', '', []], ...Object.entries(LTYPES).map(([k, v]) => [k === 'CONTINUOUS' ? 'Continuous' : k, v.desc, v.pat])];
  table('LTYPE', lts.length, th => {
    for (const [name, desc, pat] of lts) {
      rec('LTYPE', th, 'AcDbLinetypeTableRecord');
      g(2, name); g(70, 0); g(3, desc); g(72, 65); g(73, pat.length); g(40, num(pat.reduce((a, b) => a + Math.abs(b), 0)));
      for (const v of pat) { g(49, num(v)); if (!R12) g(74, 0); }
    }
  });
  table('LAYER', doc.layers.length, th => {
    for (const l of doc.layers) {
      const aci = hexToAci(l.color);
      rec('LAYER', th, 'AcDbLayerTableRecord');
      g(2, l.name); g(70, l.lock ? 4 : 0); g(62, l.on ? aci : -aci);
      g(6, l.ltype === 'CONTINUOUS' ? 'Continuous' : l.ltype);
      if (!R12) g(370, lwCode(l.lw));
    }
  });
  table('STYLE', doc.textStyles.length, th => {
    for (const s of doc.textStyles) {
      rec('STYLE', th, 'AcDbTextStyleTableRecord');
      g(2, s.name); g(70, 0); g(40, 0); g(41, s.width || 1); g(50, s.oblique || 0); g(71, 0); g(42, 2.5);
      g(3, `${s.font.toLowerCase().replace(/\s+/g, '')}.ttf`); g(4, '');
    }
  });
  table('VIEW', 0, () => {});
  table('UCS', 0, () => {});
  table('APPID', 1, th => { rec('APPID', th, 'AcDbRegAppTableRecord'); g(2, 'ACAD'); g(70, 0); });
  table('DIMSTYLE', 1, th => { rec('DIMSTYLE', th, 'AcDbDimStyleTableRecord', 105); g(2, 'Standard'); g(70, 0); }, 'AcDbDimStyleTable');
  if (!R12) {
    table('BLOCK_RECORD', 2 + userBlocks.length, th => {
      const br = (h, name) => { g(0, 'BLOCK_RECORD'); g(5, h); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbBlockTableRecord'); g(2, name); };
      br(brMS, '*Model_Space'); br(brPS, '*Paper_Space');
      for (const b of userBlocks) br(brUser[b.name], b.name);
    });
  }
  g(0, 'ENDSEC');

  // ---- BLOCKS ----
  g(0, 'SECTION'); g(2, 'BLOCKS');
  const block = (name, base, ents, brh) => {
    g(0, 'BLOCK');
    if (!R12) { g(5, H()); g(330, brh); g(100, 'AcDbEntity'); }
    g(8, '0');
    if (!R12) g(100, 'AcDbBlockBegin');
    g(2, name); g(70, 0); xy(0, base); g(3, name); g(1, '');
    for (const e of ents) writeEnt(e, brh);
    g(0, 'ENDBLK');
    if (!R12) { g(5, H()); g(330, brh); g(100, 'AcDbEntity'); }
    g(8, '0');
    if (!R12) g(100, 'AcDbBlockEnd');
  };
  if (!R12) { block('*Model_Space', P(0, 0), [], brMS); block('*Paper_Space', P(0, 0), [], brPS); }
  for (const b of userBlocks) block(b.name, b.base, b.ents, brUser[b.name]);
  g(0, 'ENDSEC');

  // ---- ENTITIES ----
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const e of doc.model) writeEnt(e, brMS);
  g(0, 'ENDSEC');

  // ---- OBJECTS ----
  if (!R12) {
    const root = H(), grp = H();
    g(0, 'SECTION'); g(2, 'OBJECTS');
    g(0, 'DICTIONARY'); g(5, root); g(330, 0); g(100, 'AcDbDictionary'); g(281, 1); g(3, 'ACAD_GROUP'); g(350, grp);
    g(0, 'DICTIONARY'); g(5, grp); g(330, root); g(100, 'AcDbDictionary'); g(281, 1);
    g(0, 'ENDSEC');
    o[seedAt + 3] = hseed.toString(16).toUpperCase();
  }
  g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}

// ================= IMPORTAR =================
function groups(pairs, from, to) {
  const out = [];
  let cur = null;
  for (let i = from; i < to; i++) {
    const [c, v] = pairs[i];
    if (c === 0) { cur = { type: v, d: [] }; out.push(cur); } else if (cur) cur.d.push([c, v]);
  }
  return out;
}
const val = (gr, code, def) => { const f = gr.d.find(x => x[0] === code); return f ? f[1] : def; };
const numv = (gr, code, def = 0) => { const v = val(gr, code); return v === undefined ? def : parseFloat(v); };
const LW_OK = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const lwFrom = v => { const n = parseInt(v, 10); if (n === -2) return 'BYBLOCK'; if (n === -3) return 'DEFAULT'; if (n < 0 || Number.isNaN(n)) return 'BYLAYER'; return (LW_OK.includes(n) ? n : 25) / 100; };

// Bucles del contorno de un HATCH (polilínea o aristas línea/arco/elipse)
function hatchLoops(gr) {
  const d = gr.d, loops = [];
  let i = d.findIndex(x => x[0] === 91);
  if (i < 0) return loops;
  const nLoops = parseInt(d[i][1], 10);
  i++;
  const at = code => { while (i < d.length && d[i][0] !== code) i++; return i < d.length ? d[i++][1] : undefined; };
  const nextNum = code => parseFloat(at(code));
  for (let L = 0; L < nLoops && i < d.length; L++) {
    const flags = parseInt(at(92), 10), pts = [];
    if (flags & 2) {
      const hasB = parseInt(at(72), 10); at(73);
      const n = parseInt(at(93), 10), verts = [];
      for (let k = 0; k < n; k++) { const x = nextNum(10), y = nextNum(20); let b = 0; if (hasB && d[i]?.[0] === 42) b = parseFloat(d[i++][1]); verts.push({ p: P(x, y), b }); }
      verts.forEach((v, k) => {
        pts.push(v.p);
        if (v.b) { const a = G.bulgeArc(v.p, verts[(k + 1) % n].p, v.b), sw = G.sweep(a.a1, a.a2), m = 16; for (let s = 1; s < m; s++) pts.push(G.polar(a.c, v.b > 0 ? a.a1 + sw * s / m : a.a2 - sw * s / m, a.r)); }
      });
    } else {
      const ne = parseInt(at(93), 10);
      for (let k = 0; k < ne; k++) {
        const t = parseInt(at(72), 10);
        if (t === 1) { const a = P(nextNum(10), nextNum(20)); nextNum(11); nextNum(21); pts.push(a); }
        else if (t === 2) {
          const c = P(nextNum(10), nextNum(20)), r = nextNum(40), a1 = G.rad(nextNum(50)), a2 = G.rad(nextNum(51)), ccw = parseInt(at(73), 10);
          const sw = ccw ? G.sweep(a1, a2) : -G.sweep(-a1, -a2), m = 24;
          for (let s = 0; s < m; s++) pts.push(G.polar(c, ccw ? a1 + sw * s / m : -a1 + sw * s / m, r));
        } else if (t === 3) {
          const c = P(nextNum(10), nextNum(20)), maj = P(nextNum(11), nextNum(21)), ratio = nextNum(40), t1 = G.rad(nextNum(50)), t2 = G.rad(nextNum(51)), ccw = parseInt(at(73), 10);
          const rx = G.len(maj), rot = Math.atan2(maj.y, maj.x), sw = G.sweep(t1, t2), m = 32;
          for (let s = 0; s < m; s++) { const tt = ccw ? t1 + sw * s / m : -(t1 + sw * s / m); pts.push(G.add(c, G.rot(P(rx * Math.cos(tt), rx * ratio * Math.sin(tt)), rot))); }
        } else return loops; // splines: no compatibles
      }
    }
    const ns = parseInt(at(97), 10);
    for (let k = 0; k < ns; k++) at(330);
    if (pts.length > 2) loops.push(pts);
  }
  return loops;
}

export function readDXF(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(c)) { i--; continue; }
    pairs.push([c, lines[i + 1].replace(/\s+$/, '')]);
  }
  const sections = {};
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1];
      let j = i + 2;
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) j++;
      sections[name] = groups(pairs, i + 2, j);
      i = j;
    }
  }

  const layers = new Map(), textStyles = [];
  for (const gr of sections.TABLES || []) {
    if (gr.type === 'LAYER') {
      const name = val(gr, 2, '0'), aci = parseInt(val(gr, 62, '7'), 10), flags = parseInt(val(gr, 70, '0'), 10), tc = val(gr, 420);
      const lt = (val(gr, 6, 'CONTINUOUS') || 'CONTINUOUS').toUpperCase();
      layers.set(name, {
        name, color: tc ? '#' + (+tc).toString(16).padStart(6, '0') : aciToHex(Math.abs(aci) || 7),
        ltype: LTYPES[lt] ? lt : 'CONTINUOUS', lw: val(gr, 370) !== undefined ? (v => (v === 'BYLAYER' || v === 'BYBLOCK' ? 'DEFAULT' : v))(lwFrom(val(gr, 370))) : 'DEFAULT',
        on: aci >= 0 && !(flags & 1), lock: !!(flags & 4),
      });
    } else if (gr.type === 'STYLE') {
      const name = val(gr, 2, '');
      if (!name) continue;
      const file = (val(gr, 3, '') || '').toLowerCase();
      const font = file.includes('times') ? 'Times New Roman' : file.includes('cour') ? 'Courier New' : file.includes('verdana') ? 'Verdana' : 'Arial';
      textStyles.push({ name, font, width: numv(gr, 41, 1) || 1, oblique: numv(gr, 50, 0) });
    }
  }
  if (!layers.has('0')) layers.set('0', { name: '0', color: '#ffffff', ltype: 'CONTINUOUS', lw: 'DEFAULT', on: true, lock: false });
  const ensureLayer = name => { if (!layers.has(name)) layers.set(name, { name, color: '#ffffff', ltype: 'CONTINUOUS', lw: 'DEFAULT', on: true, lock: false }); };

  // Bloques de origen
  const rawBlocks = new Map();
  let curBlock = null;
  for (const gr of sections.BLOCKS || []) {
    if (gr.type === 'BLOCK') { curBlock = { name: val(gr, 2, ''), base: P(numv(gr, 10), numv(gr, 20)), items: [] }; rawBlocks.set(curBlock.name, curBlock); }
    else if (gr.type === 'ENDBLK') curBlock = null;
    else if (curBlock) curBlock.items.push(gr);
  }

  let skipped = 0;
  const outBlocks = {};
  // Convierte una lista de grupos en entidades. M: transformación aplicada (para bloques expandidos)
  const convert = (list, M, depth, inheritLayer, out) => {
    for (let i = 0; i < list.length; i++) {
      const gr = list[i];
      let layer = val(gr, 8, '0');
      if (layer === '0' && inheritLayer) layer = inheritLayer;
      ensureLayer(layer);
      const aci = parseInt(val(gr, 62, '256'), 10), tc = val(gr, 420);
      const color = tc ? '#' + (+tc).toString(16).padStart(6, '0') : aci === 0 ? 'BYBLOCK' : aci > 0 && aci < 256 ? aciToHex(aci) : 'BYLAYER';
      const lt = (val(gr, 6) || '').toUpperCase();
      const base = { layer, color, ltype: lt === 'BYBLOCK' ? 'BYBLOCK' : LTYPES[lt] ? lt : 'BYLAYER', lw: val(gr, 370) !== undefined ? lwFrom(val(gr, 370)) : 'BYLAYER' };
      const ap = p => G.Mx.ap(M, p), s = G.Mx.scaleOf(M), mir = G.Mx.det(M) < 0;
      const push = e => out.push({ ...base, ...e });
      const pt = k => ap(P(numv(gr, 10 + k), numv(gr, 20 + k)));
      const addArc = (c, r, a1, a2) => {
        const q1 = ap(G.polar(c, a1, r)), q2 = ap(G.polar(c, a2, r)), cc = ap(c);
        push({ type: 'arc', c: cc, r: r * s, a1: G.ang(cc, mir ? q2 : q1), a2: G.ang(cc, mir ? q1 : q2) });
      };
      const addPoly = (verts, closed) => {
        if (verts.length < 2) return;
        const e = { type: 'pline', pts: verts.map(v => ap(v.p)), closed };
        if (verts.some(v => Math.abs(v.b) > 1e-12)) e.bulges = verts.map(v => (mir ? -v.b : v.b));
        push(e);
      };
      switch (gr.type) {
        case 'LINE': push({ type: 'line', p1: pt(0), p2: pt(1) }); break;
        case 'CIRCLE': push({ type: 'circle', c: pt(0), r: numv(gr, 40) * s }); break;
        case 'ARC': addArc(P(numv(gr, 10), numv(gr, 20)), numv(gr, 40), G.rad(numv(gr, 50)), G.rad(numv(gr, 51))); break;
        case 'POINT': push({ type: 'point', p: pt(0) }); break;
        case 'LWPOLYLINE': {
          const verts = [];
          for (const [c, v] of gr.d) {
            if (c === 10) verts.push({ p: P(parseFloat(v), 0), b: 0 });
            else if (c === 20 && verts.length) verts[verts.length - 1].p.y = parseFloat(v);
            else if (c === 42 && verts.length) verts[verts.length - 1].b = parseFloat(v);
          }
          addPoly(verts, (parseInt(val(gr, 70, '0'), 10) & 1) === 1);
          break;
        }
        case 'POLYLINE': {
          const verts = [];
          let j = i + 1;
          for (; j < list.length && list[j].type === 'VERTEX'; j++) verts.push({ p: P(numv(list[j], 10), numv(list[j], 20)), b: numv(list[j], 42) });
          if (list[j]?.type === 'SEQEND') j++;
          i = j - 1;
          addPoly(verts, (parseInt(val(gr, 70, '0'), 10) & 1) === 1);
          break;
        }
        case 'SOLID': case 'TRACE': {
          const q = [pt(0), pt(1), pt(3), pt(2)].filter((p, k, a) => !k || !G.eqPt(p, a[k - 1]));
          if (q.length > 2 && G.eqPt(q[0], q[q.length - 1])) q.pop();
          push({ type: 'hatch', pattern: 'SOLID', scale: 1, angle: 0, loops: [q] });
          break;
        }
        case 'HATCH': {
          const loops = hatchLoops(gr).map(l => l.map(ap));
          if (!loops.length) { skipped++; break; }
          const name = (val(gr, 2, 'ANSI31') || 'ANSI31').toUpperCase(), solidFlag = val(gr, 70) === '1';
          const v = G.Mx.apV(M, P(1, 0));
          push({ type: 'hatch', loops, pattern: solidFlag || name === 'SOLID' ? 'SOLID' : PATTERNS[name] ? name : 'ANSI31', scale: numv(gr, 41, 1) * s || 1, angle: numv(gr, 52, 0) + G.deg(Math.atan2(v.y, v.x)) });
          break;
        }
        case 'TEXT': case 'ATTRIB': {
          if (gr.type === 'ATTRIB' && (parseInt(val(gr, 70, '0'), 10) & 1)) break;
          const h = numv(gr, 40, 2.5) * s, j = parseInt(val(gr, 72, '0'), 10);
          const p = j && val(gr, 11) !== undefined ? pt(1) : pt(0);
          const r = G.rad(numv(gr, 50)), v = G.Mx.apV(M, P(Math.cos(r), Math.sin(r)));
          push({ type: 'text', p, h, rot: Math.atan2(v.y, v.x), text: val(gr, 1, ''), align: j === 1 || j === 4 ? 'c' : j === 2 ? 'r' : 'l', style: val(gr, 7, 'Standard') });
          break;
        }
        case 'MTEXT': {
          let str = gr.d.filter(x => x[0] === 3).map(x => x[1]).join('') + val(gr, 1, '');
          str = str.replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/[{}]/g, '').replace(/\\~/g, ' ');
          const h = numv(gr, 40, 2.5) * s;
          let r = G.rad(numv(gr, 50));
          if (val(gr, 11) !== undefined) r = Math.atan2(numv(gr, 21), numv(gr, 11));
          const v = G.Mx.apV(M, P(Math.cos(r), Math.sin(r))), rot = Math.atan2(v.y, v.x);
          let p = G.add(pt(0), G.rot(P(0, -h), rot));
          for (const ln of str.split(/\\P/i)) { if (ln) push({ type: 'text', p, h, rot, text: ln, align: 'l', style: val(gr, 7, 'Standard') }); p = G.add(p, G.rot(P(0, -1.6 * h), rot)); }
          break;
        }
        case 'ELLIPSE': {
          const c = P(numv(gr, 10), numv(gr, 20)), maj = P(numv(gr, 11), numv(gr, 21)), ratio = numv(gr, 40, 1);
          const t1 = numv(gr, 41, 0), t2 = numv(gr, 42, G.TAU);
          const rx = G.len(maj), rot = Math.atan2(maj.y, maj.x), ry = rx * ratio;
          if (Math.abs(t2 - t1 - G.TAU) < 1e-6 || Math.abs(G.normAng(t2 - t1)) < 1e-6) {
            const v = G.Mx.apV(M, P(Math.cos(rot), Math.sin(rot)));
            push({ type: 'ellipse', c: ap(c), rx: rx * s, ry: ry * s, rot: Math.atan2(v.y, v.x) });
          } else {
            const sw = G.sweep(t1, t2), pts = [];
            for (let k = 0; k <= 48; k++) { const t = t1 + sw * k / 48; pts.push(ap(G.add(c, G.rot(P(rx * Math.cos(t), ry * Math.sin(t)), rot)))); }
            push({ type: 'pline', pts, closed: false });
          }
          break;
        }
        case 'SPLINE': {
          const fit = [], ctrl = [];
          for (const [c, v] of gr.d) {
            if (c === 11) fit.push(P(parseFloat(v), 0)); else if (c === 21 && fit.length) fit[fit.length - 1].y = parseFloat(v);
            if (c === 10) ctrl.push(P(parseFloat(v), 0)); else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1].y = parseFloat(v);
          }
          const src = fit.length > 1 ? fit : ctrl;
          if (src.length > 1) push({ type: 'pline', pts: src.map(ap), closed: (parseInt(val(gr, 70, '0'), 10) & 1) === 1 });
          break;
        }
        case 'INSERT': case 'DIMENSION': {
          const name = val(gr, 2, ''), b = rawBlocks.get(name);
          if (!b || depth > 8) { if (gr.type === 'INSERT') skipped++; break; }
          const sx = gr.type === 'INSERT' ? numv(gr, 41, 1) : 1, sy = gr.type === 'INSERT' ? numv(gr, 42, 1) : 1;
          const uniform = Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-9;
          const ins = P(numv(gr, 10), numv(gr, 20)), r = G.rad(numv(gr, 50));
          // Referencias uniformes en el nivel superior se conservan como bloques
          if (gr.type === 'INSERT' && uniform && depth === 0 && !name.startsWith('*')) {
            defineBlock(name);
            const e = { type: 'insert', name, p: ins, sx, sy, rot: r };
            push(e);
            break;
          }
          let L;
          if (gr.type === 'INSERT') {
            L = G.Mx.mul([sx, 0, 0, sy, 0, 0], G.Mx.T(-b.base.x, -b.base.y));
            L = G.Mx.mul(G.Mx.T(ins.x, ins.y), G.Mx.mul(G.Mx.R(r), L));
          } else L = G.Mx.I();
          convert(b.items, G.Mx.mul(M, L), depth + 1, layer, out);
          break;
        }
        case 'VERTEX': case 'SEQEND': case 'ATTDEF': case 'VIEWPORT': break;
        default: skipped++;
      }
    }
  };
  const defining = new Set();
  function defineBlock(name) {
    if (outBlocks[name] || defining.has(name)) return;
    defining.add(name);
    const b = rawBlocks.get(name), ents = [];
    // Dentro de un bloque las referencias anidadas uniformes también se conservan
    const conv = list => {
      let run = [];
      const flush = () => { if (run.length) convert(run, G.Mx.I(), 1, null, ents); run = []; };
      for (let i = 0; i < list.length; i++) {
        const gr = list[i];
        if (gr.type === 'INSERT') {
          const nm = val(gr, 2, ''), sx = numv(gr, 41, 1), sy = numv(gr, 42, 1);
          if (rawBlocks.has(nm) && !nm.startsWith('*') && Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-9) {
            defineBlock(nm);
            let layer = val(gr, 8, '0'); ensureLayer(layer);
            const aci = parseInt(val(gr, 62, '256'), 10);
            flush();
            ents.push({ type: 'insert', name: nm, p: P(numv(gr, 10), numv(gr, 20)), sx, sy, rot: G.rad(numv(gr, 50)), layer, color: aci === 0 ? 'BYBLOCK' : aci > 0 && aci < 256 ? aciToHex(aci) : 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' });
            continue;
          }
        }
        run.push(gr);
      }
      flush();
    };
    conv(b.items.filter(gr => gr.type !== 'ATTDEF'));
    outBlocks[name] = { name, base: b.base, ents, ver: 1 };
  }
  const ents = [];
  convert(sections.ENTITIES || [], G.Mx.I(), 0, null, ents);
  return { layers: [...layers.values()], ents, blocks: outBlocks, textStyles, skipped };
}

