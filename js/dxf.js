// Lectura y escritura de DXF ASCII. Escribe DXF 2000 (AC1015), con presentaciones y ventanas gráficas, o R12 (AC1009, sólo modelo).
import * as G from './geom.js';
import { LTYPES, aciToHex, hexToAci, dimParts, ellPts, mtextGeom, insertAttribs, xformEnt } from './entities.js';
import { PATTERNS, famsOf, hatchSegments } from './patterns.js';
import { splinePts, interpolate, rebuild as rebuildSpline } from './spline.js';
const { P } = G;

const num = v => (Math.abs(v) < 1e-12 ? 0 : +(+v).toFixed(10));
const lwCode = lw => (lw === 'BYLAYER' ? -1 : lw === 'BYBLOCK' ? -2 : lw === 'DEFAULT' ? -3 : Math.round(lw * 100));
const tcolor = hex => parseInt(hex.slice(1), 16);

// ================= EXPORTAR =================
const MT_ATT = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
const mtextEsc = s => String(s).replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\n/g, '\\P');

export function writeDXF(doc, version = '2000') {
  const R12 = version === 'R12';
  const o = [];
  const g = (code, val) => { o.push(String(code), String(val)); };
  let hseed = 0x30;
  const H = () => (hseed++).toString(16).toUpperCase();
  const xy = (k, p) => { g(10 + k, num(p.x)); g(20 + k, num(p.y)); g(30 + k, 0); };

  // Registros de bloque (2000): modelo, un espacio papel por presentación y bloques de usuario
  const userBlocks = Object.values(doc.blocks).filter(b => !b.name.startsWith('*'));
  const layouts = R12 ? [] : doc.layouts;
  const brMS = H(), brPS = H(), brUser = Object.fromEntries(userBlocks.map(b => [b.name, H()]));
  const brLay = layouts.map((_, i) => (i ? H() : brPS));
  const psName = i => (i ? `*Paper_Space${i - 1}` : '*Paper_Space');
  const layDict = H(), layModel = H(), layH = layouts.map(() => H());
  const layerH = Object.fromEntries(doc.layers.map(l => [l.name, H()]));
  const lastVp = [];
  let ps = false; // escribiendo entidades del espacio papel

  const common = (type, e, owner, subclass) => {
    g(0, type);
    let h = null;
    if (!R12) { h = H(); g(5, h); g(330, owner); g(100, 'AcDbEntity'); }
    if (ps) g(67, 1);
    g(8, e.layer || '0');
    if (e.ltype && e.ltype !== 'BYLAYER') g(6, e.ltype === 'BYBLOCK' ? 'ByBlock' : e.ltype);
    if (e.color === 'BYBLOCK') g(62, 0);
    else if (e.color && e.color !== 'BYLAYER') { g(62, hexToAci(e.color)); if (!R12) g(420, tcolor(e.color)); }
    if (!R12 && e.lw !== undefined && e.lw !== 'BYLAYER') g(370, lwCode(e.lw));
    if (!R12 && subclass) g(100, subclass);
    return h;
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
  // Parte común de TEXT, ATTDEF y ATTRIB (subclase AcDbText)
  const textBody = (t, str) => {
    const st = doc.textStyle(t.style);
    xy(0, t.p); g(40, num(t.h)); g(1, str);
    if (t.rot) g(50, num(G.deg(t.rot)));
    if (st.width && st.width !== 1) g(41, st.width);
    if (st.oblique) g(51, st.oblique);
    g(7, st.name);
    const j = { c: 1, r: 2 }[t.align];
    if (j) { g(72, j); xy(1, t.p); }
  };
  const text = (e, t, ow) => { common('TEXT', e, ow, 'AcDbText'); textBody(t, t.text ?? t.str); if (!R12) g(100, 'AcDbText'); };
  const attdef = (e, ow) => {
    common('ATTDEF', e, ow, 'AcDbText'); textBody(e, e.def || '');
    if (!R12) g(100, 'AcDbAttributeDefinition');
    g(3, e.prompt || e.tag); g(2, e.tag); g(70, e.invisible ? 1 : 0);
  };
  const mtext = (e, ow) => {
    if (R12) { for (const ln of mtextGeom(e).lines) if (ln.str) text(e, ln, ow); return; }
    common('MTEXT', e, ow, 'AcDbMText');
    xy(0, e.p); g(40, num(e.h)); g(41, num(e.w || 0)); g(71, MT_ATT.indexOf(e.attach || 'tl') + 1); g(72, 1);
    let str = mtextEsc(e.text);
    while (str.length > 250) { g(3, str.slice(0, 250)); str = str.slice(250); }
    g(1, str); g(7, doc.textStyle(e.style).name);
    g(11, num(Math.cos(e.rot || 0))); g(21, num(Math.sin(e.rot || 0))); g(31, 0);
    g(73, 1); g(44, num(e.ls || 1));
  };
  const spline = (e, ow) => {
    if (R12) { poly(e, splinePts(e), !!e.closed, null, ow); return; }
    // Las cerradas se escriben con sus vértices repetidos y nudos uniformes: geometría exacta como spline abierta
    const fit = e.fit && !e.closed ? e.fit : null;
    common('SPLINE', e, ow, 'AcDbSpline');
    g(210, 0); g(220, 0); g(230, 1);
    g(70, 8); g(71, e.deg); g(72, e.knots.length); g(73, e.ctrl.length); g(74, fit ? fit.length : 0);
    g(42, 1e-10); g(43, 1e-10); if (fit) g(44, 1e-10);
    for (const k of e.knots) g(40, num(k));
    e.ctrl.forEach((p, i) => { xy(0, p); if (e.w) g(41, num(e.w[i])); });
    if (fit) for (const p of fit) xy(1, p);
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
  const insert = (e, ow) => {
    const atts = insertAttribs(e);
    common('INSERT', e, ow, 'AcDbBlockReference');
    if (atts.length) g(66, 1);
    g(2, e.name); xy(0, e.p);
    g(41, num(e.sx ?? 1)); g(42, num(e.sy ?? 1)); g(43, 1);
    if (e.rot) g(50, num(G.deg(e.rot)));
    if (!atts.length) return;
    for (const a of atts) {
      common('ATTRIB', a.t, ow, 'AcDbText'); textBody(a.t, a.value);
      if (!R12) g(100, 'AcDbAttribute');
      g(2, a.tag); g(70, a.invisible ? 1 : 0);
    }
    g(0, 'SEQEND');
    if (!R12) { g(5, H()); g(330, ow); g(100, 'AcDbEntity'); }
    if (ps) g(67, 1);
    g(8, e.layer);
  };
  // VIEWPORT: v = {cx, cy, w, h (papel), vcx, vcy, vh (modelo), id, status, frozen}
  const viewport = (e, ow, v) => {
    const h = common('VIEWPORT', e, ow, 'AcDbViewport');
    xy(0, P(v.cx, v.cy)); g(40, num(v.w)); g(41, num(v.h)); g(68, v.status); g(69, v.id);
    g(12, num(v.vcx)); g(22, num(v.vcy)); g(13, 0); g(23, 0); g(14, 10); g(24, 10); g(15, 10); g(25, 10);
    g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0);
    g(42, 50); g(43, 0); g(44, 0); g(45, num(v.vh)); g(50, 0); g(51, 0); g(72, 1000);
    for (const l of v.frozen || []) if (layerH[l]) g(331, layerH[l]);
    g(90, 32864); g(1, ''); g(281, 0); g(71, 1); g(74, 0);
    g(110, 0); g(120, 0); g(130, 0); g(111, 1); g(121, 0); g(131, 0); g(112, 0); g(122, 1); g(132, 0);
    g(79, 0); g(146, 0); g(170, 0); g(61, 5);
    return h;
  };

  const writeEnt = (e, ow) => {
    switch (e.type) {
      case 'line': line(e, e.p1, e.p2, ow); break;
      case 'circle': common('CIRCLE', e, ow, 'AcDbCircle'); xy(0, e.c); g(40, num(e.r)); break;
      case 'arc': arc(e, e.c, e.r, e.a1, e.a2, ow); break;
      case 'pline': poly(e, e.pts, e.closed, e.bulges, ow); break;
      case 'spline': spline(e, ow); break;
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
      case 'mtext': mtext(e, ow); break;
      case 'attdef': attdef(e, ow); break;
      case 'hatch': hatch(e, ow); break;
      case 'insert': insert(e, ow); break;
      case 'dim': {
        const d = dimParts(e);
        for (const [a, b] of d.lines) line(e, a, b, ow);
        for (const [c, r, a1, a2] of d.arcs) arc(e, c, r, a1, a2, ow);
        for (const tri of d.arrows) solid(e, tri, ow);
        for (const [c, r] of d.dots) { common('CIRCLE', e, ow, 'AcDbCircle'); xy(0, c); g(40, num(r)); }
        text(e, d.text, ow);
        break;
      }
    }
  };
  // Entidades de una presentación: primero la ventana general del papel (id 1), después las del usuario
  const writePaper = (lay, i, ow) => {
    ps = true;
    lastVp[i] = viewport({ layer: '0' }, ow, { cx: lay.w / 2, cy: lay.h / 2, w: lay.w, h: lay.h, vcx: lay.w / 2, vcy: lay.h / 2, vh: lay.h, id: 1, status: 1 });
    let id = 2;
    for (const e of lay.ents) {
      if (e.type !== 'vport') { writeEnt(e, ow); continue; }
      const w = e.p2.x - e.p1.x, h = e.p2.y - e.p1.y;
      viewport(e, ow, { cx: (e.p1.x + e.p2.x) / 2, cy: (e.p1.y + e.p2.y) / 2, w, h, vcx: e.cx, vcy: e.cy, vh: h / e.s, id, status: id, frozen: e.frozen });
      id++;
    }
    ps = false;
  };

  // ---- HEADER ----
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, R12 ? 'AC1009' : 'AC1015');
  if (!R12) { g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252'); g(9, '$INSUNITS'); g(70, 4); g(9, '$MEASUREMENT'); g(70, 1); g(9, '$TILEMODE'); g(70, 1); }
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
  const rec = (type, th, sub, handleCode = 5, h = H()) => { g(0, type); if (!R12) { g(handleCode, h); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, sub); } };
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
      rec('LAYER', th, 'AcDbLayerTableRecord', 5, layerH[l.name]);
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
    table('BLOCK_RECORD', 2 + Math.max(0, layouts.length - 1) + userBlocks.length, th => {
      const br = (h, name, lay) => { g(0, 'BLOCK_RECORD'); g(5, h); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbBlockTableRecord'); g(2, name); if (lay) g(340, lay); };
      br(brMS, '*Model_Space', layouts.length ? layModel : null);
      br(brPS, '*Paper_Space', layH[0]);
      for (let i = 1; i < layouts.length; i++) br(brLay[i], psName(i), layH[i]);
      for (const b of userBlocks) br(brUser[b.name], b.name);
    });
  }
  g(0, 'ENDSEC');

  // ---- BLOCKS ----
  g(0, 'SECTION'); g(2, 'BLOCKS');
  const block = (name, base, brh, body, paper = false) => {
    g(0, 'BLOCK');
    if (!R12) { g(5, H()); g(330, brh); g(100, 'AcDbEntity'); }
    if (paper) g(67, 1);
    g(8, '0');
    if (!R12) g(100, 'AcDbBlockBegin');
    g(2, name); g(70, 0); xy(0, base); g(3, name); g(1, '');
    body();
    g(0, 'ENDBLK');
    if (!R12) { g(5, H()); g(330, brh); g(100, 'AcDbEntity'); }
    if (paper) g(67, 1);
    g(8, '0');
    if (!R12) g(100, 'AcDbBlockEnd');
  };
  if (!R12) {
    block('*Model_Space', P(0, 0), brMS, () => {});
    block('*Paper_Space', P(0, 0), brPS, () => {}, true);
    // La primera presentación va en ENTITIES; las demás, dentro de su bloque *Paper_SpaceN
    for (let i = 1; i < layouts.length; i++) block(psName(i), P(0, 0), brLay[i], () => writePaper(layouts[i], i, brLay[i]), true);
  }
  for (const b of userBlocks) block(b.name, b.base, brUser[b.name], () => { for (const e of b.ents) writeEnt(e, brUser[b.name]); });
  g(0, 'ENDSEC');

  // ---- ENTITIES ----
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const e of doc.model) writeEnt(e, brMS);
  if (layouts.length) writePaper(layouts[0], 0, brPS);
  g(0, 'ENDSEC');

  // ---- OBJECTS ----
  if (!R12) {
    const root = H(), grp = H();
    g(0, 'SECTION'); g(2, 'OBJECTS');
    g(0, 'DICTIONARY'); g(5, root); g(330, 0); g(100, 'AcDbDictionary'); g(281, 1);
    g(3, 'ACAD_GROUP'); g(350, grp);
    if (layouts.length) { g(3, 'ACAD_LAYOUT'); g(350, layDict); }
    g(0, 'DICTIONARY'); g(5, grp); g(330, root); g(100, 'AcDbDictionary'); g(281, 1);
    if (layouts.length) {
      g(0, 'DICTIONARY'); g(5, layDict); g(330, root); g(100, 'AcDbDictionary'); g(281, 1);
      g(3, 'Model'); g(350, layModel);
      layouts.forEach((l, i) => { g(3, l.name); g(350, layH[i]); });
      const layoutObj = (h, name, tab, br, w, hh, vp) => {
        g(0, 'LAYOUT'); g(5, h); g(102, '{ACAD_REACTORS'); g(330, layDict); g(102, '}'); g(330, layDict);
        g(100, 'AcDbPlotSettings'); g(1, ''); g(2, 'none_device'); g(4, ''); g(6, '');
        g(40, 0); g(41, 0); g(42, 0); g(43, 0); g(44, num(w)); g(45, num(hh)); g(46, 0); g(47, 0);
        g(48, 0); g(49, 0); g(140, 0); g(141, 0); g(142, 1); g(143, 1);
        g(70, 688); g(72, 1); g(73, 0); g(74, 5); g(7, ''); g(75, 16); g(76, 0); g(77, 2); g(78, 300); g(147, 1); g(148, 0); g(149, 0);
        g(100, 'AcDbLayout'); g(1, name); g(70, 1); g(71, tab);
        g(10, 0); g(20, 0); g(11, num(w)); g(21, num(hh)); g(12, 0); g(22, 0); g(32, 0);
        g(14, 0); g(24, 0); g(34, 0); g(15, num(w)); g(25, num(hh)); g(35, 0); g(146, 0);
        g(13, 0); g(23, 0); g(33, 0); g(16, 1); g(26, 0); g(36, 0); g(17, 0); g(27, 1); g(37, 0); g(76, 0);
        g(330, br);
        if (vp) g(331, vp);
      };
      layoutObj(layModel, 'Model', 0, brMS, 297, 210, null);
      layouts.forEach((l, i) => layoutObj(layH[i], l.name, i + 1, brLay[i], l.w, l.h, lastVp[i]));
    }
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
const PAPERS_MM = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Carta: [279.4, 215.9], Oficio: [355.6, 215.9] };
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
        } else if (t === 4) {
          const deg = parseInt(at(94), 10), rational = parseInt(at(73), 10); at(74);
          const nk = parseInt(at(95), 10), nc = parseInt(at(96), 10), knots = [], ctrl = [], w = [];
          for (let k = 0; k < nk; k++) knots.push(nextNum(40));
          for (let k = 0; k < nc; k++) { ctrl.push(P(nextNum(10), nextNum(20))); if (rational) w.push(d[i]?.[0] === 42 ? parseFloat(d[i++][1]) : 1); }
          // Datos de ajuste (DXF 2010+): «97 n» propio de la arista, distinto del 97 que cierra el contorno
          if (d[i]?.[0] === 97) {
            const cnt = parseInt(d[i][1], 10), nx = d[i + 1]?.[0];
            if (nx === 11 || (cnt === 0 && (nx === 97 || nx === 72 || nx === 12))) {
              i++;
              for (let k = 0; k < cnt; k++) { nextNum(11); nextNum(21); }
              if (d[i]?.[0] === 12) i += 2;
              if (d[i]?.[0] === 13) i += 2;
            }
          }
          if (nc > deg && nk === nc + deg + 1) pts.push(...splinePts({ deg, ctrl, knots, ...(rational ? { w } : {}) }).slice(0, -1));
        } else return loops;
      }
    }
    const ns = parseInt(at(97), 10);
    for (let k = 0; k < ns; k++) at(330);
    if (pts.length > 2) loops.push(pts);
  }
  return loops;
}

// Texto plano de un MTEXT: \P = nueva línea; se eliminan los códigos de formato
function mtextPlain(s) {
  s = s.split('\\\\').join('\u0001').split('\\{').join('\u0002').split('\\}').join('\u0003');
  s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ')
    .replace(/\\S([^;]*?)[#^/]([^;]*);/g, '$1/$2')
    .replace(/\\[ACHQTWFfcp][^;]*;/g, '').replace(/\\[LlOoKkNX]/g, '').replace(/[{}]/g, '');
  return s.replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
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

  const layers = new Map(), textStyles = [], layerByHandle = new Map(), brName = new Map();
  for (const gr of sections.TABLES || []) {
    if (gr.type === 'BLOCK_RECORD') brName.set(val(gr, 5), val(gr, 2, ''));
    if (gr.type === 'LAYER') {
      const name = val(gr, 2, '0'), aci = parseInt(val(gr, 62, '7'), 10), flags = parseInt(val(gr, 70, '0'), 10), tc = val(gr, 420);
      if (val(gr, 5)) layerByHandle.set(val(gr, 5), name);
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
  // ctx.attdef: conservar definiciones de atributo (dentro de bloques); ctx.paper: lista del espacio papel
  const convert = (list, M, depth, inheritLayer, out, ctx = {}) => {
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
          const raw = gr.d.filter(x => x[0] === 3).map(x => x[1]).join('') + val(gr, 1, '');
          let r = G.rad(numv(gr, 50));
          if (val(gr, 11) !== undefined) r = Math.atan2(numv(gr, 21), numv(gr, 11));
          const e = { type: 'mtext', p: P(numv(gr, 10), numv(gr, 20)), h: numv(gr, 40, 2.5), w: Math.max(0, numv(gr, 41, 0)), rot: r,
            attach: MT_ATT[(parseInt(val(gr, 71, '1'), 10) || 1) - 1] || 'tl', text: mtextPlain(raw), style: val(gr, 7, 'Standard') };
          const ls = numv(gr, 44, 1);
          if (ls > 0 && Math.abs(ls - 1) > 1e-9) e.ls = ls;
          push(xformEnt(e, M));
          break;
        }
        case 'ATTDEF': {
          if (!ctx.attdef) break;
          const j = parseInt(val(gr, 72, '0'), 10), r = G.rad(numv(gr, 50));
          const a = { type: 'attdef', p: P(numv(gr, j && val(gr, 11) !== undefined ? 11 : 10), numv(gr, j && val(gr, 11) !== undefined ? 21 : 20)), h: numv(gr, 40, 2.5), rot: r,
            align: j === 1 || j === 4 ? 'c' : j === 2 ? 'r' : 'l', style: val(gr, 7, 'Standard'), tag: (val(gr, 2, '') || 'ATRIBUTO').toUpperCase(), prompt: val(gr, 3, ''), def: val(gr, 1, '') };
          if (parseInt(val(gr, 70, '0'), 10) & 1) a.invisible = true;
          push(xformEnt(a, M));
          break;
        }
        case 'VIEWPORT': {
          if (!ctx.paper || parseInt(val(gr, 69, '0'), 10) === 1) break; // la ventana general del papel no se importa
          const c = P(numv(gr, 10), numv(gr, 20)), w = numv(gr, 40), h = numv(gr, 41), vh = numv(gr, 45, h);
          if (!(w > 0 && h > 0 && vh > 0)) break;
          const frozen = gr.d.filter(x => x[0] === 331).map(x => layerByHandle.get(x[1])).filter(Boolean);
          push({ type: 'vport', p1: P(c.x - w / 2, c.y - h / 2), p2: P(c.x + w / 2, c.y + h / 2), cx: numv(gr, 12), cy: numv(gr, 22), s: h / vh, ...(frozen.length ? { frozen } : {}) });
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
          const fit = [], ctrl = [], w = [], knots = [], deg = parseInt(val(gr, 71, '3'), 10) || 3;
          for (const [c, v] of gr.d) {
            if (c === 11) fit.push(P(parseFloat(v), 0)); else if (c === 21 && fit.length) fit[fit.length - 1].y = parseFloat(v);
            else if (c === 10) ctrl.push(P(parseFloat(v), 0)); else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1].y = parseFloat(v);
            else if (c === 40) knots.push(parseFloat(v)); else if (c === 41) w.push(parseFloat(v));
          }
          let closed = (parseInt(val(gr, 70, '0'), 10) & 1) === 1, e = null;
          if (ctrl.length > deg && knots.length === ctrl.length + deg + 1) {
            // Vértices repetidos al final (spline periódica escrita como abierta): se trata como cerrada
            if (!closed && ctrl.length > 2 * deg && ctrl.slice(0, deg).every((p, k) => G.eqPt(p, ctrl[ctrl.length - deg + k], 1e-9))) closed = true;
            e = { type: 'spline', deg, ctrl, knots, closed };
            if (w.length === ctrl.length && w.some(x => Math.abs(x - 1) > 1e-12)) e.w = w;
            else if (fit.length >= 2) { // si coincide con la interpolación propia se conserva como spline por ajuste
              const t = interpolate(fit, closed);
              if (t && t.ctrl.length === ctrl.length && t.ctrl.every((p, k) => G.eqPt(p, ctrl[k], 1e-6))) e.fit = fit;
            }
          } else if (fit.length >= 2) { e = { type: 'spline', fit, closed }; if (!rebuildSpline(e)) e = null; }
          if (e) push(xformEnt(e, M)); else skipped++;
          break;
        }
        case 'INSERT': case 'DIMENSION': {
          const atts = [];
          if (gr.type === 'INSERT') { // ATTRIB … SEQEND tras la referencia
            let j = i + 1;
            while (list[j]?.type === 'ATTRIB') atts.push(list[j++]);
            if (atts.length && list[j]?.type === 'SEQEND') j++;
            i = j - 1;
          }
          const name = val(gr, 2, ''), b = rawBlocks.get(name);
          if (!b || depth > 8) { if (gr.type === 'INSERT') skipped++; convert(atts, M, depth, inheritLayer, out, ctx); break; }
          const sx = gr.type === 'INSERT' ? numv(gr, 41, 1) : 1, sy = gr.type === 'INSERT' ? numv(gr, 42, 1) : 1;
          const uniform = Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-9;
          const ins = P(numv(gr, 10), numv(gr, 20)), r = G.rad(numv(gr, 50));
          // Referencias uniformes en el nivel superior se conservan como bloques
          if (gr.type === 'INSERT' && uniform && depth === 0 && !name.startsWith('*')) {
            defineBlock(name);
            const e = { type: 'insert', name, p: ins, sx, sy, rot: r };
            const av = attribValues(atts);
            if (av) e.attribs = av;
            push(e);
            break;
          }
          let L;
          if (gr.type === 'INSERT') {
            L = G.Mx.mul([sx, 0, 0, sy, 0, 0], G.Mx.T(-b.base.x, -b.base.y));
            L = G.Mx.mul(G.Mx.T(ins.x, ins.y), G.Mx.mul(G.Mx.R(r), L));
          } else L = G.Mx.I();
          convert(b.items, G.Mx.mul(M, L), depth + 1, layer, out);
          convert(atts, M, depth, inheritLayer, out, ctx); // los atributos de una referencia descompuesta quedan como texto
          break;
        }
        case 'VERTEX': case 'SEQEND': break;
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
      const flush = () => { if (run.length) convert(run, G.Mx.I(), 1, null, ents, { attdef: true }); run = []; };
      for (let i = 0; i < list.length; i++) {
        const gr = list[i];
        if (gr.type === 'INSERT') {
          const atts = [];
          let j = i + 1;
          while (list[j]?.type === 'ATTRIB') atts.push(list[j++]);
          if (atts.length && list[j]?.type === 'SEQEND') j++;
          const nm = val(gr, 2, ''), sx = numv(gr, 41, 1), sy = numv(gr, 42, 1);
          if (rawBlocks.has(nm) && !nm.startsWith('*') && Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-9) {
            defineBlock(nm);
            let layer = val(gr, 8, '0'); ensureLayer(layer);
            const aci = parseInt(val(gr, 62, '256'), 10);
            flush();
            const ins = { type: 'insert', name: nm, p: P(numv(gr, 10), numv(gr, 20)), sx, sy, rot: G.rad(numv(gr, 50)), layer, color: aci === 0 ? 'BYBLOCK' : aci > 0 && aci < 256 ? aciToHex(aci) : 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' };
            const av = attribValues(atts);
            if (av) ins.attribs = av;
            ents.push(ins);
            i = j - 1;
            continue;
          }
        }
        run.push(gr);
      }
      flush();
    };
    conv(b.items);
    outBlocks[name] = { name, base: b.base, ents, ver: 1 };
  }
  // Entidades del modelo y de la presentación activa (código 67 = 1); VERTEX/SEQEND/ATTRIB siguen a su entidad
  const modelG = [], paperG = [];
  let lastPaper = false;
  for (const gr of sections.ENTITIES || []) {
    const paper = ['VERTEX', 'SEQEND', 'ATTRIB'].includes(gr.type) ? lastPaper : val(gr, 67) === '1';
    (paper ? paperG : modelG).push(gr);
    lastPaper = paper;
  }
  const ents = [];
  convert(modelG, G.Mx.I(), 0, null, ents);

  // Presentaciones (objetos LAYOUT): nombre, orden, tamaño de papel y bloque *Paper_Space correspondiente
  const layouts = [];
  for (const gr of sections.OBJECTS || []) {
    if (gr.type !== 'LAYOUT') continue;
    const k = gr.d.findIndex(x => x[0] === 100 && x[1] === 'AcDbLayout');
    if (k < 0) continue;
    const ps = { d: gr.d.slice(0, k) }, ly = { d: gr.d.slice(k) }, name = val(ly, 1, '');
    const block = brName.get(val(ly, 330));
    if (!name || name === 'Model' || !block || !/^\*paper_space/i.test(block)) continue;
    let w = numv(ps, 44, 0), h = numv(ps, 45, 0);
    if (!parseInt(val(ps, 72, '1'), 10)) { w *= 25.4; h *= 25.4; }
    if (parseInt(val(ps, 73, '0'), 10) % 2) [w, h] = [h, w];
    if (!(w > 1 && h > 1)) { w = numv(ly, 11, 297) - numv(ly, 10, 0); h = numv(ly, 21, 210) - numv(ly, 20, 0); }
    if (!(w > 1 && h > 1)) { w = 297; h = 210; }
    layouts.push({ name, block, tab: parseInt(val(ly, 71, '1'), 10), w, h });
  }
  layouts.sort((a, b) => a.tab - b.tab);
  if (paperG.length && !layouts.some(l => l.block.toLowerCase() === '*paper_space')) layouts.unshift({ name: 'Presentación1', block: '*Paper_Space', tab: 0, w: 297, h: 210 });
  const outLayouts = [];
  const seen = new Set();
  for (const l of layouts) {
    if (seen.has(l.name)) continue;
    seen.add(l.name);
    const src = l.block.toLowerCase() === '*paper_space' ? paperG : rawBlocks.get(l.block)?.items || [];
    const le = [];
    convert(src, G.Mx.I(), 0, null, le, { paper: true });
    const paper = Object.entries(PAPERS_MM).find(([, [a, b]]) => Math.abs(Math.max(a, b) - Math.max(l.w, l.h)) < 1 && Math.abs(Math.min(a, b) - Math.min(l.w, l.h)) < 1)?.[0] || 'A4';
    outLayouts.push({ name: l.name, paper, w: l.w, h: l.h, ents: le });
  }
  return { layers: [...layers.values()], ents, blocks: outBlocks, textStyles, layouts: outLayouts, skipped };
}

// Valores de atributos {ETIQUETA: valor} de una lista de ATTRIB
function attribValues(atts) {
  const out = {};
  for (const a of atts) { const tag = (val(a, 2, '') || '').toUpperCase(); if (tag) out[tag] = val(a, 1, ''); }
  return Object.keys(out).length ? out : null;
}

