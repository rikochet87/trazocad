// Lectura y escritura de DXF ASCII. Escribe DXF 2007 (AC1021, UTF-8, con directrices múltiples MULTILEADER, estilos de
// directriz y degradados), DXF 2000 (AC1015), ambos con presentaciones, ventanas gráficas y grupos, o R12 (AC1009, sólo modelo).
import * as G from './geom.js';
import { LTYPES, aciToHex, hexToAci, dimParts, ellPts, mtextGeom, mleaderGeom, insertAttribs, blockEnts, xformEnt, textBox, DEFAULT_DIMSTYLE, DEFAULT_MLSTYLE, fieldText, mlEff, ENV } from './entities.js';
import { explodeEntity } from './ops.js';
import { isDynamic } from './dynblock.js';
import { hasCodes, richPlain } from './richtext.js';
import { PATTERNS, famsOf, hatchSegments, GRADIENTS, GRAD_DEFAULT, baseFams } from './patterns.js';
import { splinePts, interpolate, rebuild as rebuildSpline } from './spline.js';
import { mlGeom, insertMatrix, tableGeom, DEFAULT_TBLSTYLE } from './entities.js';
import { sortedElems, justShift, DEFAULT_MLINESTYLE, cutParams } from './mline.js';
import { arrayEnts } from './arrays.js';
const { P } = G;

const num = v => (Math.abs(v) < 1e-12 ? 0 : +(+v).toFixed(10));
const lwCode = lw => (lw === 'BYLAYER' ? -1 : lw === 'BYBLOCK' ? -2 : lw === 'DEFAULT' ? -3 : Math.round(lw * 100));
const tcolor = hex => parseInt(hex.slice(1), 16);
const mixHex = (a, b) => '#' + [1, 3, 5].map(i => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, '0')).join('');
// Nombres con | (dependientes de referencias externas) no son válidos fuera de una referencia: se escriben como al unirla
const nm = s => String(s ?? '').split('|').join('$0$');
// En DXF 2000 y R12 (página de códigos ANSI) los caracteres no ASCII se escriben como \U+XXXX; DXF 2007 es UTF-8
const asciiDxf = s => s.replace(/[^\x00-\x7f]/g, ch => `\\U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
const BYBLOCK_RAW = -1056964608, NOCOLOR_RAW = -939524096; // colores «PorBloque» y «ninguno» de MULTILEADER y MLEADERSTYLE
const ML_CONTENT_CODE = { mtext: 2, block: 1, none: 0 };

// ================= EXPORTAR =================
const MT_ATT = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
const mtextEsc = s => String(s).replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\n/g, '\\P');

export function writeDXF(doc, version = '2000') {
  const R12 = version === 'R12', V07 = version === '2007';
  const o = [];
  const g = (code, val) => { o.push(String(code), typeof val === 'string' && !V07 ? asciiDxf(val) : String(val)); };
  // Cadenas largas en XDATA: 1000 admite 255 caracteres; con acentos el escape \U+XXXX ocupa más
  const gLong = (s, size) => { const t = String(s), n = size || (/[^\x00-\x7f]/.test(t) ? 60 : 240); for (let i = 0; i < t.length; i += n) g(1000, t.slice(i, i + n)); };
  let hseed = 0x30;
  const H = () => (hseed++).toString(16).toUpperCase();
  let zOff = 0; // elevación de la entidad que se escribe (niveles de las matrices)
  const xy = (k, p) => { g(10 + k, num(p.x)); g(20 + k, num(p.y)); g(30 + k, num(zOff)); };

  // Registros de bloque (2000): modelo, un espacio papel por presentación y bloques de usuario
  const userBlocks = Object.values(doc.blocks).filter(b => !b.name.startsWith('*'));
  const layouts = R12 ? [] : doc.layouts;
  const brMS = H(), brPS = H(), brUser = Object.fromEntries(userBlocks.map(b => [b.name, H()]));
  const brLay = layouts.map((_, i) => (i ? H() : brPS));
  const psName = i => (i ? `*Paper_Space${i - 1}` : '*Paper_Space');
  const layDict = H(), layModel = H(), layH = layouts.map(() => H());
  const layerH = Object.fromEntries(doc.layers.map(l => [l.name, H()]));
  const ltypeH = {};
  const mlsDict = V07 ? H() : null, mlsH = V07 ? Object.fromEntries(doc.mleaderStyles.map(st => [st.name, H()])) : {};
  // Grupos: identificador de cada grupo y de cada objeto que pertenece a alguno (con su reactor hacia el grupo)
  const written = new Set([...doc.model, ...layouts.flatMap(l => l.ents)].map(e => e.id)); // sólo se exportan los miembros que se escriben
  const grpDictH = R12 ? null : H(), groups = R12 ? [] : doc.groups.map(gr => ({ ...gr, ids: gr.ids.filter(id => written.has(id)) })).filter(gr => gr.ids.length), grpH = groups.map(() => H());
  const entH = new Map(), entGrp = new Map();
  groups.forEach((gr, i) => { for (const id of gr.ids) { if (!entH.has(id)) entH.set(id, H()); (entGrp.get(id) || entGrp.set(id, []).get(id)).push(grpH[i]); } });
  let pend = null; // objeto del dibujo que se está escribiendo: su primera entidad DXF usa el identificador reservado
  const styleH = Object.fromEntries(doc.textStyles.map(st => [st.name, H()]));
  const dimBlocks = new Map(); // cota → [nombre del bloque anónimo, identificador del registro]
  if (!R12) {
    let nd = 0;
    for (const list of [doc.model, ...layouts.map(l => l.ents), ...userBlocks.map(b => b.ents)]) for (const e of list) if (e.type === 'dim' && (V07 || (e.kind !== 'arc' && e.kind !== 'jog'))) dimBlocks.set(e, [`*D${++nd}`, H()]);
  }
  // Referencias a bloques dinámicos: cada una se escribe como bloque anónimo (*U1…) con su geometría según su estado
  // Las matrices asociativas se escriben igual: un bloque anónimo con todos sus elementos
  const dynIns = new Map();
  if (!R12) {
    let nu = 0;
    for (const list of [doc.model, ...layouts.map(l => l.ents), ...userBlocks.map(b => b.ents)]) for (const e of list) if ((e.type === 'insert' && isDynamic(doc.blocks[e.name])) || e.type === 'array') dynIns.set(e, [`*U${++nu}`, H()]);
  }
  const anonEnts = e => (e.type === 'array' ? arrayEnts(e) : blockEnts(e));
  // Imágenes raster: una definición IMAGEDEF compartida por cada fuente; la imagen se guarda en XDATA de la definición
  const imgDefs = new Map();
  let imgN = 0;
  if (!R12) {
    const addImg = e => {
      if (!e.src || imgDefs.has(e.src)) {
        if (e.src && imgDefs.has(e.src) && e.pxw && !imgDefs.get(e.src).pxw) { imgDefs.get(e.src).pxw = e.pxw; imgDefs.get(e.src).pxh = e.pxh; }
        return;
      }
      imgDefs.set(e.src, { key: `IMG${++imgN}`, h: H(), name: e.name || `imagen${imgN}`, src: e.src, pxw: +e.pxw || 0, pxh: +e.pxh || 0 });
    };
    const scan = list => {
      for (const e of list) {
        if (e.type === 'image') addImg(e);
        else if (e.type === 'array') for (const x of arrayEnts(e)) if (x.type === 'image') addImg(x);
      }
    };
    for (const list of [doc.model, ...layouts.map(l => l.ents), ...userBlocks.map(b => b.ents)]) scan(list);
  }
  const imgDictH = !R12 && imgDefs.size ? H() : null;
  // Tablas (DXF 2007): entidad ACAD_TABLE con su bloque anónimo *T y sus estilos (TABLESTYLE)
  const tblBlocks = new Map(), tsDict = V07 ? H() : null, tsH = V07 ? Object.fromEntries(doc.tableStyles.map(st => [st.name, H()])) : {};
  if (V07) { let nt = 0; for (const list of [doc.model, ...layouts.map(l => l.ents), ...userBlocks.map(b => b.ents)]) for (const e of list) if (e.type === 'table') tblBlocks.set(e, [`*T${++nt}`, H()]); }
  // Estilos de línea múltiple (MLINESTYLE) y delimitaciones de referencias (SPATIAL_FILTER en el diccionario de extensión)
  const mlstDict = R12 ? null : H(), mlstH = R12 ? {} : Object.fromEntries(doc.mlineStyles.map(st => [st.name, H()]));
  const lsDict = R12 || !doc.layerStates.length ? null : H(), lsH = R12 ? [] : doc.layerStates.map(() => H());
  const clips = [], clipsPlanned = !R12 && [doc.model, ...layouts.map(l => l.ents), ...userBlocks.map(b => b.ents)].some(list => list.some(e => e.type === 'insert' && e.clip?.pts?.length > 2));
  // Globos (directrices con contenido de bloque) en DXF 2007: un bloque _TrazoGlobo (círculo de radio 1 y atributo NUM)
  // por cada proporción altura de texto / radio, que el MULTILEADER inserta escalado al radio del globo
  const balloonBlk = new Map();
  if (V07) {
    for (const list of [doc.model, ...layouts.map(l => l.ents), ...userBlocks.map(b => b.ents)]) for (const e of list) {
      if (e.type !== 'mleader' || e.content !== 'block') continue;
      const gm = mleaderGeom(e);
      if (!gm.circle) continue;
      const k = +(mlEff(e).h / gm.circle[1]).toFixed(4);
      if (!balloonBlk.has(k)) balloonBlk.set(k, { name: `_TrazoGlobo${balloonBlk.size ? balloonBlk.size + 1 : ''}`, br: H(), att: H(), k });
    }
  }
  const lastVp = [];
  let ps = false; // escribiendo entidades del espacio papel

  const common = (type, e, owner, subclass, fh, xdict) => {
    g(0, type);
    let h = null;
    if (!R12) {
      const own = pend; pend = null;
      h = fh || (own && entH.get(own.id)) || H(); g(5, h);
      const reac = !fh && own && entGrp.get(own.id);
      if (reac) { g(102, '{ACAD_REACTORS'); for (const r of reac) g(330, r); g(102, '}'); }
      if (xdict) { g(102, '{ACAD_XDICTIONARY'); g(360, xdict(h)); g(102, '}'); }
      g(330, owner); g(100, 'AcDbEntity');
    }
    if (ps) g(67, 1);
    g(8, nm(e.layer || '0'));
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
      pts.forEach((p, i) => { g(0, 'VERTEX'); g(8, nm(e.layer)); xy(0, p); if (bulges?.[i]) g(42, num(bulges[i])); });
      g(0, 'SEQEND'); g(8, nm(e.layer));
      return;
    }
    common('LWPOLYLINE', e, ow, 'AcDbPolyline'); g(90, pts.length); g(70, closed ? 1 : 0); g(43, 0);
    pts.forEach((p, i) => { g(10, num(p.x)); g(20, num(p.y)); if (bulges?.[i]) g(42, num(bulges[i])); });
  };
  // Parte común de TEXT, ATTDEF y ATTRIB (subclase AcDbText)
  const textBody = (t, str) => {
    const st = doc.textStyle(t.style);
    xy(0, t.p); g(40, num(t.h)); g(1, fieldText(str));
    if (t.rot) g(50, num(G.deg(t.rot)));
    if (st.width && st.width !== 1) g(41, st.width);
    if (st.oblique) g(51, st.oblique);
    g(7, nm(st.name));
    const j = { c: 1, r: 2 }[t.align];
    if (j) { g(72, j); xy(1, t.p); }
  };
  const text = (e, t, ow) => { common('TEXT', e, ow, 'AcDbText'); textBody(t, t.text ?? t.str); if (!R12) g(100, 'AcDbText'); };
  const attdef = (e, ow) => {
    common('ATTDEF', e, ow, 'AcDbText'); textBody(e, e.def || '');
    if (!R12) g(100, 'AcDbAttributeDefinition');
    g(3, e.prompt || e.tag); g(2, e.tag); g(70, e.invisible ? 1 : 0);
  };
  const mtext = (e, ow, fh) => {
    if (R12) { for (const ln of mtextGeom(e).lines) if (ln.str) text(e, ln, ow); return; }
    common('MTEXT', e, ow, 'AcDbMText', fh);
    xy(0, e.p); g(40, num(e.h)); g(41, num(e.w || 0)); g(71, MT_ATT.indexOf(e.attach || 'tl') + 1); g(72, 1);
    let str = e.rich ? String(fieldText(e.text, true)).split('\n').join('\\P') : mtextEsc(fieldText(e.text));
    if (!V07) str = asciiDxf(str); // antes de trocear, para que ningún trozo pase de 250 caracteres
    while (str.length > 250) { g(3, str.slice(0, 250)); str = str.slice(250); }
    g(1, str); g(7, nm(doc.textStyle(e.style).name));
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
      if (e.pattern !== 'GRADIENT') for (const [a, b] of hatchSegments(e, bb)) line(e, a, b, ow);
      return;
    }
    // DXF 2000 no tiene degradados: se escribe un relleno sólido con el color medio
    const grad = e.pattern === 'GRADIENT' && V07 ? { ...GRAD_DEFAULT, ...e.grad } : null;
    if (e.pattern === 'GRADIENT' && !V07) { const gg = { ...GRAD_DEFAULT, ...e.grad }; e = { ...e, pattern: 'SOLID', color: mixHex(gg.c1, gg.c2) }; }
    const solidFill = e.pattern === 'SOLID' || !!grad, user = e.pattern === 'USER';
    common('HATCH', e, ow, 'AcDbHatch');
    xy(0, P(0, 0)); g(210, 0); g(220, 0); g(230, 1);
    g(2, solidFill ? 'SOLID' : user ? '_USER' : e.pattern); g(70, solidFill ? 1 : 0); g(71, 0); g(91, e.loops.length);
    e.loops.forEach((l, i) => {
      g(92, i ? 2 : 3); g(72, 0); g(73, 1); g(93, l.length);
      for (const p of l) { g(10, num(p.x)); g(20, num(p.y)); }
      g(97, 0);
    });
    g(75, 0); g(76, solidFill || PATTERNS[e.pattern] ? 1 : user ? 0 : 2); // predefinido, definido por el usuario o personalizado
    if (!solidFill) {
      g(52, num(e.angle || 0)); g(41, num(e.scale || 1)); g(77, user && e.user?.dbl ? 1 : 0);
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
    if (grad) { // degradado (DXF 2004 y posteriores)
      const ink = c => { g(63, hexToAci(c)); g(421, tcolor(c)); };
      g(450, 1); g(451, 0); g(460, num(G.rad(e.angle || 0))); g(461, grad.centered === false ? 0.25 : 0); g(452, 0); g(462, 0); g(453, 2);
      g(463, 0); ink(grad.c1); g(463, 1); ink(grad.c2);
      g(470, GRADIENTS[grad.type] ? grad.type : 'LINEAR');
    }
  };
  // IMAGE: inserción, vectores U/V de un píxel, tamaño en píxeles y contorno de recorte en píxeles.
  // La fuente incrustada y la transparencia van en XDATA de IMAGEDEF (compartida) y de la imagen.
  const image = (e, ow) => {
    const def = imgDefs.get(e.src);
    if (!def || !(e.w > 0) || !(e.h > 0)) return;
    const pxw = Math.max(1, +e.pxw || +def.pxw || 1), pxh = Math.max(1, +e.pxh || +def.pxh || 1);
    const c = Math.cos(e.rot || 0), s = Math.sin(e.rot || 0), u = P(c * e.w / pxw, s * e.w / pxw), v = P(-s * e.h / pxh, c * e.h / pxh);
    const local = q => { const dx = q.x - e.p.x, dy = q.y - e.p.y; return P((dx * c + dy * s) / e.w * pxw, (-dx * s + dy * c) / e.h * pxh); };
    const cp = e.clip?.pts?.length ? e.clip.pts.map(local) : [P(0, 0), P(pxw, 0), P(pxw, pxh), P(0, pxh)];
    common('IMAGE', e, ow, 'AcDbRasterImage');
    xy(0, e.p); xy(1, u); xy(2, v); g(13, num(pxw)); g(23, num(pxh)); g(340, def.h);
    g(71, e.clip?.off ? 0 : 1); g(91, cp.length);
    for (const q of cp) { g(14, num(q.x)); g(24, num(q.y)); }
    g(70, 1 | 2 | 4 | (+e.transparency > 0 ? 8 : 0)); g(280, cp.length > 4 ? 2 : 1);
    g(1001, 'TRAZOCAD'); g(1000, 'IMAGEN');
    gLong(JSON.stringify({ transparency: +e.transparency || 0, clip: e.clip ? { pts: cp, invert: !!e.clip.invert, off: !!e.clip.off } : null }));
  };
  const insert = (e, ow) => {
    if (isDynamic(doc.blocks[e.name])) { // bloque dinámico: geometría ya evaluada
      if (R12 || !dynIns.has(e)) { for (const x of blockEnts(e)) writeEnt(x, ow); return; }
      common('INSERT', e, ow, 'AcDbBlockReference'); g(2, dynIns.get(e)[0]); xy(0, P(0, 0)); g(41, 1); g(42, 1); g(43, 1);
      return;
    }
    const atts = insertAttribs(e), b = doc.blocks[e.name];
    // Delimitación: diccionario de extensión → ACAD_FILTER → SPATIAL (filtro con el contorno en coordenadas del bloque)
    const clip = !R12 && e.clip?.pts?.length > 2 && b ? { xd: H(), fd: H(), sf: H(), pts: e.clip.pts, M: insertMatrix(e, b), invert: !!e.clip.invert, off: !!e.clip.off } : null;
    common('INSERT', e, ow, 'AcDbBlockReference', null, clip ? h => { clip.ins = h; clips.push(clip); return clip.xd; } : null);
    if (atts.length) g(66, 1);
    g(2, nm(e.name)); xy(0, e.p);
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
    g(8, nm(e.layer));
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

  // Geometría de la cota (contenido de su bloque anónimo): capa 0 y PorBloque, como hace AutoCAD
  const dimGeometry = (e, ow) => {
    const d = dimParts(e), b = { layer: '0', color: 'BYBLOCK', ltype: 'BYBLOCK', lw: 'BYBLOCK', style: e.style };
    for (const [a, q] of d.lines) line(b, a, q, ow);
    for (const [c, r, a1, a2] of d.arcs) arc(b, c, r, a1, a2, ow);
    for (const tri of d.arrows) solid(b, tri, ow);
    for (const [c, r] of d.dots) { common('CIRCLE', b, ow, 'AcDbCircle'); xy(0, c); g(40, num(r)); }
    text(b, d.text, ow);
  };
  const DIM_TYPE = { lin: 0, ali: 1, dia: 3, rad: 4, ord: 6 };
  // Huecos de DIMBREAK en XDATA: punto central (1010/1020/1030) y longitud del corte (1040)
  const dimBreaks = e => {
    if (!e.breaks?.length) return;
    g(1001, 'TRAZOCAD'); g(1000, 'DIMBREAK');
    for (const b of e.breaks) { g(1010, num(b.p.x)); g(1020, num(b.p.y)); g(1030, 0); g(1040, num(b.len || 0)); }
  };
  const dimension = (e, ow) => {
    const d = dimParts(e), [bname] = dimBlocks.get(e), box = textBox(d.text), tm = G.mid(box[0], box[2]);
    const ang2 = e.kind === 'ang' && e.l1, type = e.kind === 'ang' ? (ang2 ? 2 : 5) : DIM_TYPE[e.kind];
    const dir = e.kind === 'rad' || e.kind === 'dia' ? G.norm(G.sub(e.p3, e.p1)) : null, r = dir ? G.dist(e.p1, e.p2) : 0;
    const def = { lin: d.d2, ali: d.d2, rad: e.p1, dia: dir && G.sub(e.p1, G.mul(dir, r)), ord: P(0, 0), ang: ang2 ? e.l2[1] : e.p3 }[e.kind];
    common('DIMENSION', e, ow, 'AcDbDimension');
    g(2, bname); xy(0, def || e.p3); xy(1, tm);
    g(70, type | 32 | 128 | (e.kind === 'ord' && (d.axis === 'x') ? 64 : 0));
    g(71, 5);
    if (e.text) g(1, fieldText(e.text));
    g(42, num(e.kind === 'ang' ? G.rad(d.val) : d.val));
    g(3, nm(doc.dimStyle(e.style).name));
    switch (e.kind) {
      case 'lin': g(100, 'AcDbAlignedDimension'); xy(3, e.p1); xy(4, e.p2); g(50, num(G.deg(e.rot || 0))); g(100, 'AcDbRotatedDimension'); break;
      case 'ali': g(100, 'AcDbAlignedDimension'); xy(3, e.p1); xy(4, e.p2); break;
      case 'rad': g(100, 'AcDbRadialDimension'); xy(5, G.add(e.p1, G.mul(dir, r))); g(40, 0); break;
      case 'dia': g(100, 'AcDbDiametricDimension'); xy(5, G.add(e.p1, G.mul(dir, r))); g(40, 0); break;
      case 'ord': g(100, 'AcDbOrdinateDimension'); xy(3, e.p1); xy(4, e.p3); break;
      case 'ang':
        if (ang2) { g(100, 'AcDb2LineAngularDimension'); xy(3, e.l1[0]); xy(4, e.l1[1]); xy(5, e.l2[0]); xy(6, e.p3); }
        else { g(100, 'AcDb3PointAngularDimension'); xy(3, e.p1); xy(4, e.p2); xy(5, e.c); }
        break;
    }
    dimBreaks(e);
  };
  // Cotas de longitud de arco y de radio con recodo (DXF 2007): ARC_DIMENSION y LARGE_RADIAL_DIMENSION
  const arcDimension = (e, ow) => {
    const d = dimParts(e), [bname] = dimBlocks.get(e), box = textBox(d.text);
    common('ARC_DIMENSION', e, ow, 'AcDbDimension');
    g(2, bname); xy(0, e.p3); xy(1, G.mid(box[0], box[2])); g(70, 8 | 32 | 128); g(71, 5);
    if (e.text) g(1, fieldText(e.text));
    g(42, num(d.val)); g(3, nm(doc.dimStyle(e.style).name));
    g(100, 'AcDbArcDimension'); xy(3, e.p1); xy(4, e.p2); xy(5, e.c);
    g(40, num(G.normAng(G.ang(e.c, e.p1)))); g(41, num(G.normAng(G.ang(e.c, e.p2)))); g(70, e.partial ? 1 : 0); g(71, 0); xy(6, e.p1); xy(7, e.p2);
    dimBreaks(e);
  };
  const jogDimension = (e, ow) => {
    const d = dimParts(e), [bname] = dimBlocks.get(e), u = G.norm(G.sub(e.p3, e.p1));
    common('LARGE_RADIAL_DIMENSION', e, ow, 'AcDbDimension');
    g(2, bname); xy(0, e.p1); xy(1, e.p3); g(70, 9 | 32 | 128); g(71, 5);
    if (e.text) g(1, fieldText(e.text));
    g(42, num(d.val)); g(3, nm(doc.dimStyle(e.style).name));
    g(100, 'AcDbRadialDimensionLarge'); xy(3, e.p4); xy(4, e.p5); xy(5, G.add(e.p1, G.mul(u, d.val)));     g(40, num(Math.PI / 4));
    dimBreaks(e);
  };
  // Línea múltiple: vértices con la dirección de su tramo y el vector de inglete; cada elemento, su distancia sobre el inglete,
  // el inicio (0) y los huecos de MLEDIT (pares inicio-fin a lo largo del tramo desde el inicio del elemento)
  const mline = (e, ow) => {
    if (R12) { for (const x of explodeEntity(e)) writeEnt(x, ow); return; }
    const st = doc.mlineStyle(e.mlstyle), gm = mlGeom(e), els = sortedElems(st), sh = justShift(st, e.just || 'top'), s = e.scale ?? 1;
    const caps = st.caps || {}, flags = 1 | (gm.closed ? 2 : 0) | (caps.sLine || caps.sOuter || caps.sInner ? 0 : 4) | (caps.eLine || caps.eOuter || caps.eInner ? 0 : 8);
    common('MLINE', e, ow, 'AcDbMline');
    g(2, nm(st.name)); g(340, mlstH[st.name]); g(40, num(s)); g(70, { top: 0, zero: 1, bottom: 2 }[e.just || 'top']); g(71, flags); g(72, e.pts.length); g(73, els.length);
    xy(0, e.pts[0]); g(210, 0); g(220, 0); g(230, 1);
    gm.frames.forEach((f, i) => {
      xy(1, e.pts[i]); xy(2, f.dir); xy(3, f.miter);
      els.forEach((el, k) => {
        const gaps = cutParams(e, gm, i, k);
        g(74, 2 + 2 * gaps.length); g(41, num((el.off + sh) * s * f.k)); g(41, 0);
        for (const [a, b] of gaps) { g(41, num(a)); g(41, num(b)); }
        g(75, 0);
      });
    });
  };
  // Tabla (DXF 2007): referencia a su bloque *T, filas, columnas, alturas, anchuras y texto de cada celda
  const acadTable = (e, ow) => {
    const [bname, brh] = tblBlocks.get(e), gm = tableGeom(e), nr = e.rows.length, nc = e.cols.length;
    common('ACAD_TABLE', e, ow, 'AcDbBlockReference');
    g(2, bname); xy(0, e.p);
    g(100, 'AcDbTable'); g(280, 0); g(342, tsH[doc.tableStyle(e.tstyle).name]); g(343, brh);
    xy(1, P(Math.cos(e.rot || 0), Math.sin(e.rot || 0))); g(90, 22); g(91, nr); g(92, nc); g(93, 0); g(94, 0); g(95, 0); g(96, 0);
    for (let r = 0; r < nr; r++) g(141, num(gm.rowY[r] - gm.rowY[r + 1]));
    for (const w of e.cols) g(142, num(w));
    for (let r = 0; r < nr; r++) for (let k = 0; k < nc; k++) {
      const title = e.title && r === 0, merged = title && k > 0;
      g(171, 1); g(172, 0); g(173, merged ? 1 : 0); g(174, 0); g(175, title && !k ? nc : 1); g(176, 1); g(91, 0); g(178, 0); g(145, 0);
      let str = merged ? '' : mtextEsc(fieldText(String(e.cells[r]?.[k] ?? '')));
      while (str.length > 250) { g(3, str.slice(0, 250)); str = str.slice(250); }
      g(1, str);
    }
    g(1001, 'TRAZOCAD'); g(1000, 'TABLA'); g(1070, (e.title ? 1 : 0) | (e.header ? 2 : 0)); if (e.th != null) g(1040, num(e.th));
  };
  // Directriz múltiple: LEADER (con la flecha del estilo de cota actual) + MTEXT enlazado, o globo (círculo + texto)
  const leader = (e, ow) => {
    const gm = mleaderGeom(e);
    if (R12) { for (const x of explodeEntity(e)) writeEnt(x, ow); return; }
    const linked = gm.text && e.content === 'mtext', th = linked ? H() : null;
    const verts = [...e.pts, ...(G.eqPt(gm.L, e.pts[e.pts.length - 1]) ? [] : [gm.L])];
    common('LEADER', e, ow, 'AcDbLeader');
    g(3, nm(doc.dimStyle(doc.cur.dimStyle).name)); g(71, mlEff(e).arrow === 'none' ? 0 : 1); g(72, 0); g(73, linked ? 0 : 3); g(74, 0); g(75, 0);
    g(40, num(mlEff(e).h)); g(41, 0); g(76, verts.length);
    for (const p of verts) xy(0, p);
    if (linked) g(340, th);
    if (gm.circle) { common('CIRCLE', e, ow, 'AcDbCircle'); xy(0, gm.circle[0]); g(40, num(gm.circle[1])); }
    if (gm.text) mtext({ ...e, ...gm.text }, ow, th);
  };
  // Directriz múltiple como MULTILEADER (DXF 2007): vértices, rellano (dogleg) y texto con formato.
  // Los valores efectivos (estilo + modificaciones) se escriben todos en la entidad (todas las modificaciones activadas).
  const multileader = (e, ow) => {
    const gm = mleaderGeom(e), m = mlEff(e), n = e.pts.length, last = e.pts[n - 1];
    const hasText = e.content === 'mtext' && !!gm.text, land = e.content !== 'none' && m.land > 0 ? m.land : 0;
    const blk = e.content === 'block' && gm.circle ? balloonBlk.get(+(m.h / gm.circle[1]).toFixed(4)) : null, R = blk ? gm.circle[1] : 0;
    const asz = m.arrow === 'none' ? 0 : m.asz, tsH = styleH[doc.textStyle(m.textStyle).name];
    const v3 = (c, p) => { g(c, num(p.x)); g(c + 10, num(p.y)); g(c + 20, 0); };
    common('MULTILEADER', e, ow, 'AcDbMLeader');
    g(270, 2);
    g(300, 'CONTEXT_DATA{');
    g(40, 1); v3(10, gm.L); g(41, num(m.h)); g(140, num(asz)); g(145, num(m.gap || 0)); g(174, 1); g(175, 1); g(176, 0); g(177, 0);
    g(290, hasText ? 1 : 0);
    if (hasText) {
      const str = e.rich ? String(fieldText(e.text, true)).split('\n').join('\\P') : mtextEsc(fieldText(e.text));
      g(304, str); g(11, 0); g(21, 0); g(31, 1); if (tsH) g(340, tsH);
      v3(12, gm.text.p); g(13, 1); g(23, 0); g(33, 0); g(42, 0); g(43, num(e.w || 0)); g(44, 0); g(45, 1); g(170, 1); g(90, BYBLOCK_RAW);
      g(171, gm.side > 0 ? 1 : 3); g(172, 1); g(91, NOCOLOR_RAW); g(141, 1.5); g(92, 0); g(291, 0); g(292, 0); g(173, 0); g(293, 0); g(142, 0); g(143, 0); g(294, 0); g(295, 1);
    }
    g(296, blk ? 1 : 0);
    if (blk) { // bloque del globo: posición, escala y matriz (AutoCAD no usa la matriz; se escribe la identidad)
      g(341, blk.br); g(14, 0); g(24, 0); g(34, 1); v3(15, gm.circle[0]); g(16, num(R)); g(26, num(R)); g(36, num(R)); g(46, 0); g(93, BYBLOCK_RAW);
      for (let k = 0; k < 16; k++) g(47, k % 5 ? 0 : 1);
    }
    g(110, 0); g(120, 0); g(130, 0); g(111, 1); g(121, 0); g(131, 0); g(112, 0); g(122, 1); g(132, 0); g(297, 0);
    g(302, 'LEADER{'); g(290, 1); g(291, 1); v3(10, last); g(11, gm.side); g(21, 0); g(31, 0); g(90, 0); g(40, num(land));
    g(304, 'LEADER_LINE{'); for (const q of e.pts.slice(0, -1)) v3(10, q); g(91, 0); g(92, BYBLOCK_RAW); g(305, '}');
    g(303, '}');
    g(301, '}');
    g(340, mlsH[doc.mleaderStyle(e.mstyle).name]); g(90, 2147483647); g(170, 1); g(91, BYBLOCK_RAW);
    if (ltypeH.ByBlock) g(341, ltypeH.ByBlock);
    g(171, -2); g(290, land ? 1 : 0); g(291, land ? 1 : 0); g(41, num(land)); g(42, num(asz)); g(172, ML_CONTENT_CODE[hasText ? 'mtext' : blk ? 'block' : 'none']);
    if (tsH) g(343, tsH);
    g(173, 1); g(95, 1); g(174, 1); g(175, 0); g(92, BYBLOCK_RAW); g(292, 0);
    if (blk) g(344, blk.br);
    g(93, BYBLOCK_RAW);
    g(10, num(blk ? R : 1)); g(20, num(blk ? R : 1)); g(30, num(blk ? R : 1)); g(43, 0); g(176, 0); g(293, 0);
    if (blk) { g(330, blk.att); g(177, 0); g(44, 1); g(302, fieldText(e.text || '')); } // valor del atributo NUM
    g(294, 0); g(178, 0); g(179, gm.side > 0 ? 1 : 3); g(45, 1);
  };
  const writeEnt = (e, ow) => {
    const z0 = zOff;
    zOff = e.z || 0;
    switch (e.type) {
      case 'mleader': if (V07 && (e.content !== 'block' || balloonBlk.size)) multileader(e, ow); else leader(e, ow); break;
      case 'table': if (tblBlocks.has(e)) acadTable(e, ow); else for (const x of explodeEntity(e)) writeEnt(x, ow); break;
      case 'mline': mline(e, ow); break;
      case 'region': for (const l of e.loops) poly(e, l.pts, true, l.bulges, ow); break;
      case 'array':
        if (R12 || !dynIns.has(e)) { for (const x of arrayEnts(e)) writeEnt(x, ow); break; }
        common('INSERT', e, ow, 'AcDbBlockReference'); g(2, dynIns.get(e)[0]); xy(0, P(0, 0)); g(41, 1); g(42, 1); g(43, 1);
        {
          const meta = { ...e }; delete meta.id; delete meta._xf; delete meta.pathId; delete meta._h;
          g(1001, 'TRAZOCAD'); g(1000, 'MATRIZ'); gLong(JSON.stringify(meta));
        }
        break;
      case 'image': if (!R12) image(e, ow); break;
      case 'line': line(e, e.p1, e.p2, ow); break;
      case 'center': for (const [a, b] of e.lines || []) line(e, a, b, ow); break;
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
      case 'wipeout': hatch({ ...e, type: 'hatch', pattern: 'SOLID', loops: [e.pts] }, ow); break;
      case 'insert': insert(e, ow); break;
      case 'dim': {
        if (V07 && e.kind === 'arc' && dimBlocks.has(e)) { arcDimension(e, ow); break; }
        if (V07 && e.kind === 'jog' && dimBlocks.has(e)) { jogDimension(e, ow); break; }
        if (!R12 && dimBlocks.has(e)) { dimension(e, ow); break; }
        const d = dimParts(e);
        for (const [a, b] of d.lines) line(e, a, b, ow);
        for (const [c, r, a1, a2] of d.arcs) arc(e, c, r, a1, a2, ow);
        for (const tri of d.arrows) solid(e, tri, ow);
        for (const [c, r] of d.dots) { common('CIRCLE', e, ow, 'AcDbCircle'); xy(0, c); g(40, num(r)); }
        text(e, d.text, ow);
        break;
      }
    }
    zOff = z0;
  };
  // Entidades de una presentación: primero la ventana general del papel (id 1), después las del usuario
  const writePaper = (lay, i, ow) => {
    ps = true;
    ENV.layout = lay;
    lastVp[i] = viewport({ layer: '0' }, ow, { cx: lay.w / 2, cy: lay.h / 2, w: lay.w, h: lay.h, vcx: lay.w / 2, vcy: lay.h / 2, vh: lay.h, id: 1, status: 1 });
    let id = 2;
    for (const e of lay.ents) {
      pend = e;
      if (e.type !== 'vport') { writeEnt(e, ow); pend = null; continue; }
      const w = e.p2.x - e.p1.x, h = e.p2.y - e.p1.y;
      viewport(e, ow, { cx: (e.p1.x + e.p2.x) / 2, cy: (e.p1.y + e.p2.y) / 2, w, h, vcx: e.cx, vcy: e.cy, vh: h / e.s, id, status: id, frozen: e.frozen });
      id++;
    }
    ps = false;
    ENV.layout = null;
  };

  // ---- HEADER ----
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, R12 ? 'AC1009' : V07 ? 'AC1021' : 'AC1015');
  if (!R12) { g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252'); g(9, '$INSUNITS'); g(70, 4); g(9, '$MEASUREMENT'); g(70, 1); g(9, '$TILEMODE'); g(70, 1); }
  g(9, '$LTSCALE'); g(40, doc.settings.ltscale);
  const ib = doc.settings.insBase || P(0, 0);
  g(9, '$INSBASE'); xy(0, ib);
  if (!R12) { g(9, '$DIMSTYLE'); g(2, nm(doc.dimStyle(doc.cur.dimStyle).name)); }
  const ext = doc.extents(doc.model);
  if (ext) { g(9, '$EXTMIN'); xy(0, P(ext.x1, ext.y1)); g(9, '$EXTMAX'); xy(0, P(ext.x2, ext.y2)); }
  const seedAt = o.length;
  if (!R12) { g(9, '$HANDSEED'); g(5, 'FFFFF'); }
  g(0, 'ENDSEC');

  if (!R12) {
    g(0, 'SECTION'); g(2, 'CLASSES');
    if (V07) { // clases de los objetos de directriz múltiple
      g(0, 'CLASS'); g(1, 'MLEADERSTYLE'); g(2, 'AcDbMLeaderStyle'); g(3, 'ACDB_MLEADERSTYLE_CLASS'); g(90, 4095); g(91, doc.mleaderStyles.length); g(280, 0); g(281, 0);
      g(0, 'CLASS'); g(1, 'MULTILEADER'); g(2, 'AcDbMLeader'); g(3, 'ACDB_MLEADER_CLASS'); g(90, 3071); g(91, 0); g(280, 0); g(281, 1);
      // Tablas, estilos de tabla, cotas de longitud de arco y de radio con recodo
      for (const [n, cls, fl, ent] of [['ACAD_TABLE', 'AcDbTable', 1025, 1], ['TABLESTYLE', 'AcDbTableStyle', 4095, 0], ['ARC_DIMENSION', 'AcDbArcDimension', 1025, 1], ['LARGE_RADIAL_DIMENSION', 'AcDbRadialDimensionLarge', 1025, 1]]) {
        g(0, 'CLASS'); g(1, n); g(2, cls); g(3, 'ObjectDBX Classes'); g(90, fl); g(91, 0); g(280, 0); g(281, ent);
      }
    }
    if (clipsPlanned) { g(0, 'CLASS'); g(1, 'SPATIAL_FILTER'); g(2, 'AcDbSpatialFilter'); g(3, 'ObjectDBX Classes'); g(90, 1153); g(91, 0); g(280, 0); g(281, 0); }
    g(0, 'ENDSEC');
  }

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
      ltypeH[name] = H();
      rec('LTYPE', th, 'AcDbLinetypeTableRecord', 5, ltypeH[name]);
      g(2, name); g(70, 0); g(3, desc); g(72, 65); g(73, pat.length); g(40, num(pat.reduce((a, b) => a + Math.abs(b), 0)));
      for (const v of pat) { g(49, num(v)); if (!R12) g(74, 0); }
    }
  });
  table('LAYER', doc.layers.length, th => {
    for (const l of doc.layers) {
      const aci = hexToAci(l.color);
      rec('LAYER', th, 'AcDbLayerTableRecord', 5, layerH[l.name]);
      g(2, nm(l.name)); g(70, l.lock ? 4 : 0); g(62, l.on ? aci : -aci);
      g(6, l.ltype === 'CONTINUOUS' ? 'Continuous' : l.ltype);
      if (!R12) g(370, lwCode(l.lw));
    }
  });
  table('STYLE', doc.textStyles.length, th => {
    for (const s of doc.textStyles) {
      rec('STYLE', th, 'AcDbTextStyleTableRecord', 5, styleH[s.name]);
      g(2, nm(s.name)); g(70, 0); g(40, 0); g(41, s.width || 1); g(50, s.oblique || 0); g(71, 0); g(42, 2.5);
      g(3, `${s.font.toLowerCase().replace(/\s+/g, '')}.ttf`); g(4, '');
    }
  });
  table('VIEW', 0, () => {});
  table('UCS', 0, () => {});
  table('APPID', R12 ? 1 : 2, th => {
    rec('APPID', th, 'AcDbRegAppTableRecord'); g(2, 'ACAD'); g(70, 0);
    if (!R12) { rec('APPID', th, 'AcDbRegAppTableRecord'); g(2, 'TRAZOCAD'); g(70, 0); } // datos extendidos propios (tablas y delimitaciones)
  });
  const dstyles = doc.dimStyles;
  table('DIMSTYLE', dstyles.length, th => {
    for (const d of dstyles) {
      rec('DIMSTYLE', th, 'AcDbDimStyleTableRecord', 105);
      g(2, nm(d.name)); g(70, 0);
      if (d.suffix) g(3, '<>' + d.suffix);
      g(40, num(d.scale || 1)); g(41, num(d.asz)); g(42, num(d.exo)); g(43, num(d.dli ?? 3.75)); g(44, num(d.exe));
      if (d.arrow === 'tick') g(142, num(d.asz / 2));
      g(73, 0); g(74, 0); g(77, 1); g(140, num(d.txt)); g(147, num(d.gap)); g(179, d.adec ?? 0); g(271, d.dec ?? 2);
      if (!R12 && styleH[doc.textStyle(d.textStyle).name]) g(340, styleH[doc.textStyle(d.textStyle).name]);
    }
  }, 'AcDbDimStyleTable');
  if (!R12) {
    table('BLOCK_RECORD', 2 + Math.max(0, layouts.length - 1) + userBlocks.length + dimBlocks.size + dynIns.size + balloonBlk.size + tblBlocks.size, th => {
      const br = (h, name, lay) => { g(0, 'BLOCK_RECORD'); g(5, h); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbBlockTableRecord'); g(2, name); if (lay) g(340, lay); };
      br(brMS, '*Model_Space', layouts.length ? layModel : null);
      br(brPS, '*Paper_Space', layH[0]);
      for (let i = 1; i < layouts.length; i++) br(brLay[i], psName(i), layH[i]);
      for (const b of userBlocks) br(brUser[b.name], nm(b.name));
      for (const [name, h] of dimBlocks.values()) br(h, name);
      for (const [name, h] of dynIns.values()) br(h, name);
      for (const b of balloonBlk.values()) br(b.br, b.name);
      for (const [name, h] of tblBlocks.values()) br(h, name);
    });
  }
  g(0, 'ENDSEC');

  // ---- BLOCKS ----
  g(0, 'SECTION'); g(2, 'BLOCKS');
  const block = (name, base, brh, body, paper = false, flags = 0) => {
    g(0, 'BLOCK');
    if (!R12) { g(5, H()); g(330, brh); g(100, 'AcDbEntity'); }
    if (paper) g(67, 1);
    g(8, '0');
    if (!R12) g(100, 'AcDbBlockBegin');
    g(2, name); g(70, flags); xy(0, base); g(3, name); g(1, '');
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
  for (const b of userBlocks) block(nm(b.name), b.base, brUser[b.name], () => { for (const e of b.ents) writeEnt(e, brUser[b.name]); });
  // Bloques anónimos con la geometría de cada cota (*D1, *D2…)
  for (const [e, [name, h]] of dimBlocks) block(name, P(0, 0), h, () => dimGeometry(e, h), false, 1);
  for (const [e, [name, h]] of dynIns) block(name, P(0, 0), h, () => { for (const x of anonEnts(e)) writeEnt(x, h); }, false, 1);
  for (const [e, [name, h]] of tblBlocks) block(name, P(0, 0), h, () => { for (const x of explodeEntity(e)) writeEnt(x, h); }, false, 1);
  for (const b of balloonBlk.values()) block(b.name, P(0, 0), b.br, () => {
    const st = { layer: '0', color: 'BYBLOCK', ltype: 'BYBLOCK', lw: 'BYBLOCK' };
    common('CIRCLE', st, b.br, 'AcDbCircle'); xy(0, P(0, 0)); g(40, 1);
    common('ATTDEF', st, b.br, 'AcDbText', b.att);
    xy(0, P(0, 0)); g(40, b.k); g(1, ''); g(7, nm(doc.textStyle(doc.mleaderStyles[0].textStyle).name)); g(72, 1); xy(1, P(0, 0));
    g(100, 'AcDbAttributeDefinition'); g(3, 'Número'); g(2, 'NUM'); g(70, 0); g(74, 2);
  }, false, 2);
  g(0, 'ENDSEC');

  // ---- ENTITIES ----
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const e of doc.model) { pend = e; writeEnt(e, brMS); pend = null; }
  if (layouts.length) writePaper(layouts[0], 0, brPS);
  g(0, 'ENDSEC');

  // ---- OBJECTS ----
  if (!R12) {
    const root = H(), grp = grpDictH;
    g(0, 'SECTION'); g(2, 'OBJECTS');
    g(0, 'DICTIONARY'); g(5, root); g(330, 0); g(100, 'AcDbDictionary'); g(281, 1);
    g(3, 'ACAD_GROUP'); g(350, grp);
    if (layouts.length) { g(3, 'ACAD_LAYOUT'); g(350, layDict); }
    if (V07) { g(3, 'ACAD_MLEADERSTYLE'); g(350, mlsDict); g(3, 'ACAD_TABLESTYLE'); g(350, tsDict); }
    if (lsDict) { g(3, 'ACAD_LAYERSTATES'); g(350, lsDict); }
    g(3, 'ACAD_MLINESTYLE'); g(350, mlstDict);
    if (imgDictH) { g(3, 'ACAD_IMAGE_DICT'); g(350, imgDictH); }
    // Imágenes raster: diccionario ACAD_IMAGE_DICT con una IMAGEDEF por fuente
    if (imgDictH) {
      g(0, 'DICTIONARY'); g(5, imgDictH); g(330, root); g(100, 'AcDbDictionary'); g(281, 1);
      for (const d of imgDefs.values()) { g(3, d.key); g(350, d.h); }
      for (const d of imgDefs.values()) {
        const pxw = d.pxw > 0 ? d.pxw : 1, pxh = d.pxh > 0 ? d.pxh : 1;
        g(0, 'IMAGEDEF'); g(5, d.h); g(102, '{ACAD_REACTORS'); g(330, imgDictH); g(102, '}'); g(330, imgDictH);
        g(100, 'AcDbRasterImageDef'); g(90, 0); g(1, nm(d.name || d.key));
        g(10, num(pxw)); g(20, num(pxh)); g(11, 1); g(21, 1); g(280, 0);
        g(1001, 'TRAZOCAD'); g(1000, 'IMAGEDEF'); gLong(JSON.stringify({ name: d.name || d.key, src: d.src, pxw, pxh }));
      }
    }
    // Estilos de línea múltiple
    g(0, 'DICTIONARY'); g(5, mlstDict); g(330, root); g(100, 'AcDbDictionary'); g(281, 1);
    for (const st of doc.mlineStyles) { g(3, nm(st.name)); g(350, mlstH[st.name]); }
    const colCode = c => (!c || c === 'BYLAYER' ? 256 : c === 'BYBLOCK' ? 0 : hexToAci(c));
    const ltName = l => (!l || l === 'BYLAYER' ? 'BYLAYER' : l === 'BYBLOCK' ? 'BYBLOCK' : l === 'CONTINUOUS' ? 'Continuous' : l);
    for (const st of doc.mlineStyles) {
      const c = st.caps || {}, fl = (st.fill ? 1 : 0) | (st.joints ? 2 : 0) | (c.sLine ? 16 : 0) | (c.sInner ? 32 : 0) | (c.sOuter ? 64 : 0) | (c.eLine ? 256 : 0) | (c.eInner ? 512 : 0) | (c.eOuter ? 1024 : 0);
      g(0, 'MLINESTYLE'); g(5, mlstH[st.name]); g(102, '{ACAD_REACTORS'); g(330, mlstDict); g(102, '}'); g(330, mlstDict); g(100, 'AcDbMlineStyle');
      g(2, nm(st.name)); g(70, fl); g(3, st.desc || ''); g(62, st.fill ? hexToAci(st.fill) : 256); if (st.fill) g(420, tcolor(st.fill)); g(51, 90); g(52, 90);
      const els = sortedElems(st);
      g(71, els.length);
      for (const el of els) { g(49, num(el.off)); g(62, colCode(el.color)); if (el.color?.startsWith('#')) g(420, tcolor(el.color)); g(6, ltName(el.ltype)); }
    }
    // Estados de capa (LAYERSTATE) en el diccionario ACAD_LAYERSTATES
    if (lsDict) {
      g(0, 'DICTIONARY'); g(5, lsDict); g(330, root); g(100, 'AcDbDictionary'); g(281, 1);
      doc.layerStates.forEach((s, i) => { g(3, nm(s.name)); g(350, lsH[i]); });
      doc.layerStates.forEach((s, i) => {
        g(0, 'LAYERSTATE'); g(5, lsH[i]); g(102, '{ACAD_REACTORS'); g(330, lsDict); g(102, '}'); g(330, lsDict); g(100, 'AcDbLayerState');
        g(1, nm(s.name)); g(91, 2047); g(301, s.desc || ''); g(290, 0); g(302, s.cur || '0');
        for (const [name, v] of Object.entries(s.layers)) {
          const aci = hexToAci(v.color || '#ffffff');
          g(8, nm(name)); g(90, (v.on === false ? 1 : 0) | (v.lock ? 4 : 0) | 8);
          g(62, aci); g(370, lwCode(v.lw)); g(6, v.ltype && v.ltype !== 'CONTINUOUS' ? v.ltype : 'Continuous'); g(2, `Color_${aci}`); g(440, 33554687);
          if ((v.color || '').toLowerCase() !== aciToHex(aci).toLowerCase()) g(420, tcolor(v.color));
        }
      });
    }
    // Delimitaciones de referencias: diccionario de extensión de la referencia → ACAD_FILTER → SPATIAL
    for (const k of clips) {
      g(0, 'DICTIONARY'); g(5, k.xd); g(330, k.ins); g(100, 'AcDbDictionary'); g(280, 1); g(281, 1); g(3, 'ACAD_FILTER'); g(360, k.fd);
      g(0, 'DICTIONARY'); g(5, k.fd); g(330, k.xd); g(100, 'AcDbDictionary'); g(280, 1); g(281, 1); g(3, 'SPATIAL'); g(360, k.sf);
      g(0, 'SPATIAL_FILTER'); g(5, k.sf); g(102, '{ACAD_REACTORS'); g(330, k.fd); g(102, '}'); g(330, k.fd); g(100, 'AcDbFilter'); g(100, 'AcDbSpatialFilter');
      g(70, k.pts.length); for (const p of k.pts) { g(10, num(p.x)); g(20, num(p.y)); }
      g(210, 0); g(220, 0); g(230, 1); g(11, 0); g(21, 0); g(31, 0); g(71, 1); g(72, 0); g(73, 0);
      // Matriz inversa de la referencia y matriz del contorno (3 × 4, por filas)
      const m = k.M, d = m[0] * m[3] - m[1] * m[2], iv = [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
      for (const v of [iv[0], iv[2], 0, iv[4], iv[1], iv[3], 0, iv[5], 0, 0, 1, 0]) g(40, num(v));
      for (const v of [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]) g(40, num(v));
      if (k.invert || k.off) { g(1001, 'TRAZOCAD'); g(1000, 'XCLIP'); g(1070, (k.invert ? 1 : 0) | (k.off ? 2 : 0)); }
    }
    // Estilos de tabla (DXF 2007): estilo de celda de datos, de encabezado y de título
    if (V07) {
      g(0, 'DICTIONARY'); g(5, tsDict); g(330, root); g(100, 'AcDbDictionary'); g(281, 1);
      for (const st of doc.tableStyles) { g(3, nm(st.name)); g(350, tsH[st.name]); }
      for (const st of doc.tableStyles) {
        const s = { ...DEFAULT_TBLSTYLE, ...st }, ts = nm(doc.textStyle(s.textStyle).name), al = { l: 4, c: 5, r: 6, auto: 4 }[s.align] || 4;
        g(0, 'TABLESTYLE'); g(5, tsH[st.name]); g(102, '{ACAD_REACTORS'); g(330, tsDict); g(102, '}'); g(330, tsDict); g(100, 'AcDbTableStyle');
        g(3, ''); g(70, 0); g(71, 0); g(40, num(s.th * s.margin)); g(41, num(s.th * s.margin)); g(280, 0); g(281, 0);
        for (const [hgt, a] of [[s.th, al], [s.th, 5], [s.th * s.titleScale, 5]]) {
          g(7, ts); g(140, num(hgt)); g(170, a); g(62, 256); g(63, 7); g(283, 0); g(90, 4); g(91, 0); g(1, '');
          for (let k = 274; k <= 279; k++) g(k, -2);
          for (let k = 284; k <= 289; k++) g(k, 1);
          for (let k = 64; k <= 69; k++) g(k, 0);
        }
        g(1001, 'TRAZOCAD'); g(1000, s.align);
      }
    }
    g(0, 'DICTIONARY'); g(5, grp); g(330, root); g(100, 'AcDbDictionary'); g(281, 1);
    groups.forEach((gr, i) => { g(3, gr.name); g(350, grpH[i]); });
    groups.forEach((gr, i) => {
      g(0, 'GROUP'); g(5, grpH[i]); g(102, '{ACAD_REACTORS'); g(330, grp); g(102, '}'); g(330, grp); g(100, 'AcDbGroup');
      g(300, gr.desc || ''); g(70, gr.name.startsWith('*') ? 1 : 0); g(71, gr.sel === false ? 0 : 1);
      for (const id of gr.ids) g(340, entH.get(id));
    });
    if (V07) {
      g(0, 'DICTIONARY'); g(5, mlsDict); g(330, root); g(100, 'AcDbDictionary'); g(281, 1);
      for (const st of doc.mleaderStyles) { g(3, st.name); g(350, mlsH[st.name]); }
      for (const st of doc.mleaderStyles) {
        const asz = st.arrow === 'none' ? 0 : st.asz;
        g(0, 'MLEADERSTYLE'); g(5, mlsH[st.name]); g(102, '{ACAD_REACTORS'); g(330, mlsDict); g(102, '}'); g(330, mlsDict); g(100, 'AcDbMLeaderStyle');
        g(179, 2); g(170, ML_CONTENT_CODE[st.content] ?? 2); g(171, 1); g(172, 0); g(90, 2); g(40, 0); g(41, 0); g(173, 1); g(91, BYBLOCK_RAW); g(92, -2);
        g(290, st.land > 0 ? 1 : 0); g(42, num(st.gap ?? 1.25)); g(291, st.land > 0 ? 1 : 0); g(43, num(st.land || 0)); g(3, st.name); g(44, num(asz)); g(300, '');
        if (styleH[doc.textStyle(st.textStyle).name]) g(342, styleH[doc.textStyle(st.textStyle).name]);
        g(174, 1); g(175, 1); g(176, 0); g(178, 1); g(93, BYBLOCK_RAW); g(45, num(st.h)); g(292, 0); g(297, 0); g(46, num(st.h));
        g(94, BYBLOCK_RAW); g(47, 1); g(48, 1); g(49, 1); g(140, 1); g(294, 1); g(141, 0); g(177, 0); g(142, 1); g(295, 0); g(296, 0); g(143, 3.75); g(271, 0); g(272, 9); g(273, 9);
      }
    }
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

// Familias de líneas de patrón de un HATCH (ya giradas y escaladas): [{ang (grados), o, off, dash}]
function hatchFams(gr) {
  const d = gr.d, out = [];
  let i = d.findIndex(x => x[0] === 78);
  if (i < 0) return out;
  const nf = parseInt(d[i][1], 10);
  i++;
  for (let k = 0; k < nf && i < d.length; k++) {
    const f = { ang: 0, o: P(0, 0), off: P(0, 0), dash: [] };
    while (i < d.length && d[i][0] !== 53) i++;
    if (i >= d.length) break;
    f.ang = parseFloat(d[i++][1]);
    for (; i < d.length && [43, 44, 45, 46, 79, 49].includes(d[i][0]); i++) {
      const [c, v] = d[i], x = parseFloat(v);
      if (c === 43) f.o.x = x; else if (c === 44) f.o.y = x; else if (c === 45) f.off.x = x; else if (c === 46) f.off.y = x; else if (c === 49) f.dash.push(x);
    }
    out.push(f);
  }
  return out;
}

// Códigos especiales %%d (°), %%p (±), %%c (Ø), %%% (%) y caracteres \U+XXXX
const specials = s => String(s).replace(/%%([dpc%])/gi, (m, k) => ({ d: '°', p: '±', c: 'Ø', '%': '%' }[k.toLowerCase()]))
  .replace(/\\U\+([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
// MTEXT de AutoCAD → texto interno: con formato (rich) si tiene códigos admitidos; los no admitidos se eliminan
function mtextIn(raw) {
  const s = specials(raw).replace(/\\[Aa]\d;/g, '').replace(/\\p[^;]*;/g, '').replace(/\\[Tt][\d.]+x?;/g, '').replace(/\\X/g, '').replace(/\\N/g, '\\P');
  if (!hasCodes(s.replace(/\\P/g, ''))) return { text: mtextPlain(s), rich: false };
  return { text: s.split('\\P').join('\n'), rich: true };
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
    const v = lines[i + 1].replace(/\s+$/, '');
    pairs.push([c, v.includes('\\U+') ? v.replace(/\\U\+([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))) : v]);
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

  const layers = new Map(), textStyles = [], layerByHandle = new Map(), brName = new Map(), styleByHandle = new Map(), dimStyles = [];
  const dimRaw = [];
  for (const gr of sections.TABLES || []) {
    if (gr.type === 'BLOCK_RECORD') brName.set(val(gr, 5), val(gr, 2, ''));
    if (gr.type === 'DIMSTYLE') dimRaw.push(gr);
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
      if (val(gr, 5)) styleByHandle.set(val(gr, 5), name);
    }
  }
  // Estilos de cota (DIMSTYLE): variables principales
  for (const gr of dimRaw) {
    const name = val(gr, 2, '');
    if (!name) continue;
    const D = DEFAULT_DIMSTYLE, post = val(gr, 3, '') || '';
    dimStyles.push({ ...D, name, txt: numv(gr, 140, D.txt), asz: numv(gr, 41, D.asz), exo: numv(gr, 42, D.exo), dli: numv(gr, 43, D.dli), exe: numv(gr, 44, D.exe), gap: Math.abs(numv(gr, 147, D.gap)),
      dec: parseInt(val(gr, 271, String(D.dec)), 10), adec: parseInt(val(gr, 179, '0'), 10), scale: numv(gr, 40, 1) || 1,
      arrow: numv(gr, 142, 0) > 0 ? 'tick' : 'closed', textStyle: styleByHandle.get(val(gr, 340)) || 'Standard', suffix: post.includes('<>') ? post.split('<>')[1] : '' });
  }
  const dimStyleName = n => (dimStyles.some(d => d.name === n) ? n : dimStyles[0]?.name || 'ISO-25');

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
  const outBlocks = {}, patterns = {};
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
      const push = e => out.push({ ...base, ...e, ...(depth === 0 && val(gr, 5) ? { _h: val(gr, 5) } : {}) });
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
          if (val(gr, 450) === '1') { // degradado (DXF 2004+)
            const cols = gr.d.filter(x => x[0] === 421).map(x => '#' + (+x[1] & 0xffffff).toString(16).padStart(6, '0'));
            const gname = (val(gr, 470, 'LINEAR') || 'LINEAR').toUpperCase(), type = GRADIENTS[gname] ? gname : 'LINEAR';
            push({ type: 'hatch', loops, pattern: 'GRADIENT', scale: 1, angle: G.deg(numv(gr, 460, 0)) + G.deg(Math.atan2(v.y, v.x)), grad: { type, c1: cols[0] || GRAD_DEFAULT.c1, c2: cols[1] || GRAD_DEFAULT.c2, centered: !numv(gr, 461, 0) } });
            break;
          }
          const ang = numv(gr, 52, 0), sc = numv(gr, 41, 1) || 1, rot = G.deg(Math.atan2(v.y, v.x));
          if (solidFlag || name === 'SOLID') { push({ type: 'hatch', loops, pattern: 'SOLID', scale: 1, angle: ang + rot }); break; }
          const fams = hatchFams(gr);
          if (name === '_USER' || (val(gr, 76) === '0' && !PATTERNS[name])) { // definido por el usuario: líneas paralelas o cruzadas
            const f = fams[0], sp = f ? Math.abs(G.dot(f.off, G.perp(P(Math.cos(G.rad(f.ang)), Math.sin(G.rad(f.ang)))))) / sc : 3.175;
            push({ type: 'hatch', loops, pattern: 'USER', scale: sc * s, angle: ang + rot, user: { sp: sp || 3.175, dbl: val(gr, 77) === '1' || fams.length > 1 } });
            break;
          }
          let pat = PATTERNS[name] ? name : 'ANSI31';
          if (!PATTERNS[name] && fams.length) { pat = name; patterns[name] ??= { desc: 'Importado de DXF', fam: baseFams(fams, ang, sc) }; }
          push({ type: 'hatch', loops, pattern: pat, scale: sc * s, angle: ang + rot });
          break;
        }
        case 'TEXT': case 'ATTRIB': {
          if (gr.type === 'ATTRIB' && (parseInt(val(gr, 70, '0'), 10) & 1)) break;
          const h = numv(gr, 40, 2.5) * s, j = parseInt(val(gr, 72, '0'), 10);
          const p = j && val(gr, 11) !== undefined ? pt(1) : pt(0);
          const r = G.rad(numv(gr, 50)), v = G.Mx.apV(M, P(Math.cos(r), Math.sin(r)));
          push({ type: 'text', p, h, rot: Math.atan2(v.y, v.x), text: specials(val(gr, 1, '')), align: j === 1 || j === 4 ? 'c' : j === 2 ? 'r' : 'l', style: val(gr, 7, 'Standard') });
          break;
        }
        case 'MTEXT': {
          if (ctx.used?.has(val(gr, 5))) break; // texto de una directriz ya importada
          const raw = gr.d.filter(x => x[0] === 3).map(x => x[1]).join('') + val(gr, 1, '');
          const mt = mtextIn(raw);
          let r = G.rad(numv(gr, 50));
          if (val(gr, 11) !== undefined) r = Math.atan2(numv(gr, 21), numv(gr, 11));
          const e = { type: 'mtext', p: P(numv(gr, 10), numv(gr, 20)), h: numv(gr, 40, 2.5), w: Math.max(0, numv(gr, 41, 0)), rot: r,
            attach: MT_ATT[(parseInt(val(gr, 71, '1'), 10) || 1) - 1] || 'tl', text: mt.text, style: val(gr, 7, 'Standard'), ...(mt.rich ? { rich: true } : {}) };
          const ls = numv(gr, 44, 1);
          if (ls > 0 && Math.abs(ls - 1) > 1e-9) e.ls = ls;
          push(xformEnt(e, M));
          break;
        }
        case 'ATTDEF': {
          if (!ctx.attdef) break;
          const j = parseInt(val(gr, 72, '0'), 10), r = G.rad(numv(gr, 50));
          const a = { type: 'attdef', p: P(numv(gr, j && val(gr, 11) !== undefined ? 11 : 10), numv(gr, j && val(gr, 11) !== undefined ? 21 : 20)), h: numv(gr, 40, 2.5), rot: r,
            align: j === 1 || j === 4 ? 'c' : j === 2 ? 'r' : 'l', style: val(gr, 7, 'Standard'), tag: (val(gr, 2, '') || 'ATRIBUTO').toUpperCase(), prompt: specials(val(gr, 3, '')), def: specials(val(gr, 1, '')) };
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
        case 'DIMENSION': {
          const dm = dimFrom(gr);
          if (dm) { dm.style = dimStyleName(val(gr, 3, '')); push(xformEnt(dm, M)); break; }
          const b = rawBlocks.get(val(gr, 2, '')); // tipo no admitido: se descompone su bloque
          if (b && depth <= 8) convert(b.items, M, depth + 1, layer, out); else skipped++;
          break;
        }
        case 'LEADER': {
          const verts = [];
          for (const [c, v] of gr.d) { if (c === 10) verts.push(P(parseFloat(v), 0)); else if (c === 20 && verts.length) verts[verts.length - 1].y = parseFloat(v); }
          if (verts.length < 2) { skipped++; break; }
          const ds = dimStyles.find(d => d.name === val(gr, 3, '')) || dimStyles[0] || DEFAULT_DIMSTYLE, k = ds.scale || 1;
          const e = { type: 'mleader', pts: verts, content: 'none', text: '', h: numv(gr, 40, ds.txt * k) || ds.txt * k, asz: ds.asz * k, arrow: val(gr, 71, '1') === '0' ? 'none' : 'closed', land: 0, gap: 0, w: 0, style: 'Standard' };
          const tg = ctx.mtexts?.get(val(gr, 340));
          if (tg) { // MTEXT enlazado: pasa a ser el contenido de la directriz
            ctx.used.add(val(gr, 340));
            const raw = tg.d.filter(x => x[0] === 3).map(x => x[1]).join('') + val(tg, 1, ''), mt = mtextIn(raw);
            const last = verts[verts.length - 1], tp = P(numv(tg, 10), numv(tg, 20));
            Object.assign(e, { content: 'mtext', text: mt.text, h: numv(tg, 40, e.h), w: numv(tg, 41, 0), gap: Math.abs(tp.x - last.x), style: val(tg, 7, 'Standard'), ...(mt.rich ? { rich: true } : {}) });
          }
          push(xformEnt(e, M));
          break;
        }
        case 'MULTILEADER': {
          const e = mleaderFrom(gr);
          if (e) push(xformEnt(e, M)); else skipped++;
          break;
        }
        case 'MLINE': {
          // Vértices (11), dirección del tramo (12), inglete (13) y, por elemento, sus parámetros (74 n, 41 × n)
          const vs = [];
          let par = null;
          for (const [c, v] of gr.d) {
            const x = parseFloat(v);
            if (c === 11) vs.push({ p: P(x, 0), dir: P(1, 0), mit: P(0, 1), els: [] });
            else if (!vs.length) continue;
            else if (c === 21) vs[vs.length - 1].p.y = x;
            else if (c === 12) vs[vs.length - 1].dir.x = x; else if (c === 22) vs[vs.length - 1].dir.y = x;
            else if (c === 13) vs[vs.length - 1].mit.x = x; else if (c === 23) vs[vs.length - 1].mit.y = x;
            else if (c === 74) { par = []; vs[vs.length - 1].els.push(par); }
            else if (c === 41 && par) par.push(x);
            else if (c === 75) par = null;
          }
          const pts = vs.map(q => q.p);
          if (pts.length < 2) { skipped++; break; }
          const sn = val(gr, 2, 'STANDARD'), st = mlineStyles.find(s => s.name.toUpperCase() === String(sn).toUpperCase());
          const ml = { type: 'mline', pts, closed: !!(parseInt(val(gr, 71, '0'), 10) & 2), just: ['top', 'zero', 'bottom'][parseInt(val(gr, 70, '0'), 10)] || 'top', scale: numv(gr, 40, 1) || 1, mlstyle: st ? st.name : 'STANDARD' };
          // Huecos de MLEDIT: distancias desde el inicio del elemento → distancias sobre el eje desde el vértice
          const cuts = [];
          vs.forEach((q, i) => q.els.forEach((pp, k) => {
            if (pp.length < 2) return;
            const d0 = G.dot(G.norm(q.mit), G.norm(q.dir)) * pp[0];
            if (pp[1] > 1e-9) cuts.push({ s: i, k, a: d0, b: d0 + pp[1] });
            for (let j = 2; j + 1 < pp.length; j += 2) if (pp[j + 1] > pp[j] + 1e-9) cuts.push({ s: i, k, a: d0 + pp[j], b: d0 + pp[j + 1] });
          }));
          if (cuts.length) ml.cuts = cuts;
          push(xformEnt(ml, M));
          break;
        }
        case 'ARC_DIMENSION': case 'LARGE_RADIAL_DIMENSION': {
          const k = gr.d.findIndex(x => x[0] === 100 && (x[1] === 'AcDbArcDimension' || x[1] === 'AcDbRadialDimensionLarge')), t = { d: k >= 0 ? gr.d.slice(k) : [] };
          const pt = (g2, n) => (val(g2, 10 + n) === undefined ? null : P(numv(g2, 10 + n), numv(g2, 20 + n)));
          const raw = val(gr, 1, ''), text = raw && raw !== '<>' && raw.trim() !== '' ? mtextPlain(specials(raw)) : '';
          let dm = null;
          if (gr.type === 'ARC_DIMENSION') {
            const a = pt(t, 3), b = pt(t, 4), c = pt(t, 5), loc = pt(gr, 0) || pt(gr, 1);
            if (a && b && c && loc) dm = { type: 'dim', kind: 'arc', c, p1: a, p2: b, p3: loc, ...(val(t, 70) === '1' ? { partial: true } : {}) };
          } else {
            const c = pt(gr, 0), loc = pt(gr, 1), oc = pt(t, 3), jg = pt(t, 4), ch = pt(t, 5);
            if (c && loc && oc && jg && ch) dm = { type: 'dim', kind: 'jog', p1: c, p2: ch, p3: loc, p4: oc, p5: jg };
          }
          if (!dm) { const b = rawBlocks.get(val(gr, 2, '')); if (b && depth <= 8) convert(b.items, M, depth + 1, layer, out); else skipped++; break; }
          if (text) dm.text = text;
          dm.style = dimStyleName(val(gr, 3, ''));
          push(xformEnt(dm, M));
          break;
        }
        case 'ACAD_TABLE': {
          const tb = tableFrom(gr);
          if (tb) { push(xformEnt(tb, M)); break; }
          const b = rawBlocks.get(val(gr, 2, ''));
          if (!b || depth > 8) { skipped++; break; }
          const ins = P(numv(gr, 10), numv(gr, 20)), r = Math.atan2(numv(gr, 21, 0), numv(gr, 11, 1));
          const L = G.Mx.mul(G.Mx.T(ins.x, ins.y), G.Mx.mul(G.Mx.R(r), G.Mx.T(-b.base.x, -b.base.y)));
          convert(b.items, G.Mx.mul(M, L), depth + 1, layer, out);
          break;
        }
        case 'IMAGE': {
          const def = imageDefs.get(val(gr, 340));
          if (!def?.src) { skipped++; break; }
          let meta = {};
          try { const raw = xdataText(gr, 'IMAGEN'); if (raw) meta = JSON.parse(raw); } catch { meta = {}; }
          const pxw = Math.max(1, +def.pxw || numv(gr, 13, 1)), pxh = Math.max(1, +def.pxh || numv(gr, 23, 1));
          const u = G.Mx.apV(M, P(numv(gr, 11, 1), numv(gr, 21, 0))), v = G.Mx.apV(M, P(numv(gr, 12, 0), numv(gr, 22, 1)));
          const p = pt(0), w = G.len(u) * pxw, h = G.len(v) * pxh;
          if (!(w > 0 && h > 0)) { skipped++; break; }
          const std = [];
          for (const [c, val2] of gr.d) { if (c === 14) std.push(P(parseFloat(val2), 0)); else if (c === 24 && std.length) std[std.length - 1].y = parseFloat(val2); }
          const cp = meta && meta.clip && Array.isArray(meta.clip.pts) && meta.clip.pts.length >= 3 ? meta.clip.pts : std;
          const e = { type: 'image', p, w, h, rot: Math.atan2(u.y, u.x), src: def.src, name: def.name, pxw, pxh };
          if (meta && 'clip' in meta && meta.clip === null) { /* sin recorte */ }
          else if (cp.length >= 3) {
            const pts = cp.map(q => G.add(p, G.add(G.mul(u, q.x), G.mul(v, q.y))));
            e.clip = { pts, ...(meta.clip?.invert ? { invert: true } : {}), ...(meta.clip?.off ? { off: true } : {}) };
          }
          if (+meta.transparency) e.transparency = Math.min(90, Math.max(0, +meta.transparency));
          push(e);
          break;
        }
        case 'INSERT': {
          const am = xdataText(gr, 'MATRIZ');
          if (am) {
            try {
              const a = JSON.parse(am);
              if (a?.type === 'array' && Array.isArray(a.src)) { delete a.pathId; push(a); break; }
            } catch { /* XDATA ilegible: se expande el bloque */ }
          }
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
            const av = attribValues(atts), cl = clipOf(gr);
            if (av) e.attribs = av;
            if (cl) e.clip = cl;
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
  // Cota DIMENSION → entidad de cota (null si el tipo no se admite)
  function dimFrom(gr) {
    const pt = k => (val(gr, 10 + k) === undefined ? null : P(numv(gr, 10 + k), numv(gr, 20 + k)));
    const f = parseInt(val(gr, 70, '0'), 10), type = f & 7, raw = val(gr, 1, '');
    const text = raw && raw !== '<>' && raw.trim() !== '' ? mtextPlain(specials(raw)) : '';
    const breaks = [];
    const xd = xdataOf(gr);
    const bi = xd ? xd.findIndex(x => x[0] === 1000 && x[1] === 'DIMBREAK') : -1;
    if (bi >= 0) {
      let cur = null;
      for (const [c, v] of xd.slice(bi + 1)) {
        if (c === 1010) cur = { p: P(parseFloat(v), 0), len: 0 };
        else if (c === 1020 && cur) cur.p.y = parseFloat(v);
        else if (c === 1040 && cur) { cur.len = parseFloat(v); breaks.push(cur); cur = null; }
      }
    }
    const base = { type: 'dim', ...(text ? { text } : {}), ...(breaks.length ? { breaks } : {}) };
    const p10 = pt(0), p11 = pt(1), p13 = pt(3), p14 = pt(4), p15 = pt(5), p16 = pt(6);
    switch (type) {
      case 0: return p13 && p14 && p10 ? { ...base, kind: 'lin', p1: p13, p2: p14, p3: p10, rot: G.rad(numv(gr, 50, 0)) } : null;
      case 1: return p13 && p14 && p10 ? { ...base, kind: 'ali', p1: p13, p2: p14, p3: p10, rot: 0 } : null;
      case 3: return p10 && p15 ? { ...base, kind: 'dia', p1: G.mid(p10, p15), p2: p15, p3: p11 || p15 } : null;
      case 4: return p10 && p15 ? { ...base, kind: 'rad', p1: p10, p2: p15, p3: p11 || p15 } : null;
      case 5: return p15 && p13 && p14 && p10 ? { ...base, kind: 'ang', c: p15, p1: p13, p2: p14, p3: p10 } : null;
      case 2: {
        if (!(p13 && p14 && p15 && p10 && p16)) return null;
        const X = G.llInt(p13, p14, p15, p10);
        if (!X) return null;
        const far = (a, b) => (G.dist(a, X.p) > G.dist(b, X.p) ? a : b);
        return { ...base, kind: 'ang', c: X.p, p1: far(p13, p14), p2: far(p15, p10), p3: p16, l1: [p13, p14], l2: [p15, p10] };
      }
      case 6: return p13 && p14 ? { ...base, kind: 'ord', p1: p13, p2: p13, p3: p14, axis: f & 64 ? 'x' : 'y' } : null;
    }
    return null;
  }
  // MULTILEADER (AutoCAD 2008+): texto, alturas, flecha, estilo, vértices de la primera línea de directriz y rellano;
  // los globos (contenido de bloque) toman el valor de su primer atributo
  function mleaderFrom(gr) {
    const d = gr.d, line = [];
    let text = '', h = null, asz = null, gap = null, land = 0, last = null, inCtx = false, inLeader = false, inLine = false, gotLine = false;
    let content = null, styleH = null, attVal = '', hasDog = true;
    for (let i = 0; i < d.length; i++) {
      const [c, v] = d[i];
      const xyAt = () => P(parseFloat(v), d[i + 1]?.[0] === c + 10 ? parseFloat(d[i + 1][1]) : 0);
      if (c === 300 && String(v).startsWith('CONTEXT_DATA{')) { inCtx = true; continue; }
      if (c === 301) { inCtx = false; continue; }
      if (c === 302 && String(v).startsWith('LEADER{')) { inLeader = true; continue; }
      if (c === 303) { inLeader = false; continue; }
      if (c === 304 && String(v).startsWith('LEADER_LINE{')) { inLine = !gotLine; continue; }
      if (c === 305) { if (inLine) gotLine = true; inLine = false; continue; }
      if (inLine) { if (c === 10) line.push(xyAt()); continue; }
      if (inLeader) {
        if (c === 10 && !last) last = xyAt();
        else if (c === 40) land = parseFloat(v) || 0;
        continue;
      }
      if (inCtx) {
        if (c === 41 && h == null) h = parseFloat(v) || null;
        else if (c === 140) asz = parseFloat(v);
        else if (c === 145) gap = parseFloat(v);
        else if (c === 304) text = String(v);
        continue;
      }
      if (c === 340 && !styleH) styleH = v;
      else if (c === 172) content = parseInt(v, 10);
      else if (c === 291) hasDog = v !== '0';
      else if (c === 302) attVal = String(v);
      else if (c === 42 && asz == null) asz = parseFloat(v);
    }
    const pts = [...line, ...(last ? [last] : [])];
    if (pts.length < 2) return null;
    const block = content === 1, mt = mtextIn(block ? attVal : text);
    const e = { type: 'mleader', pts, content: block ? 'block' : mt.text ? 'mtext' : 'none', text: block ? richPlain(mt.text) : mt.text, ...(mt.rich && !block ? { rich: true } : {}),
      arrow: asz === 0 ? 'none' : 'closed', land: hasDog ? land : 0, w: 0 };
    if (styleH && mlStyleByHandle.has(styleH)) e.mstyle = mlStyleByHandle.get(styleH);
    if (h) e.h = h;
    if (asz) e.asz = asz;
    if (gap != null) e.gap = gap;
    return e;
  }
  // XDATA propios y definiciones de imagen (se necesitan antes de convertir bloques)
  const xdataOf = (gr, app = 'TRAZOCAD') => { const i = gr.d.findIndex(x => x[0] === 1001 && x[1] === app); if (i < 0) return null; const out = []; for (let k = i + 1; k < gr.d.length && gr.d[k][0] !== 1001; k++) out.push(gr.d[k]); return out; };
  const xdataText = (gr, marker, app = 'TRAZOCAD') => {
    const xd = xdataOf(gr, app);
    if (!xd) return null;
    const i = xd.findIndex(x => x[0] === 1000 && x[1] === marker);
    return i < 0 ? null : xd.slice(i + 1).filter(x => x[0] === 1000).map(x => x[1]).join('');
  };
  const imageDefs = new Map();
  for (const gr of sections.OBJECTS || []) {
    if (gr.type !== 'IMAGEDEF' || !val(gr, 5)) continue;
    let meta = null;
    try { const raw = xdataText(gr, 'IMAGEDEF'); if (raw) meta = JSON.parse(raw); } catch { meta = null; }
    const path = val(gr, 1, '') || '';
    imageDefs.set(val(gr, 5), {
      name: meta?.name || path, src: meta?.src || (path.startsWith('data:') ? path : ''),
      pxw: +(meta?.pxw || numv(gr, 10, 0)), pxh: +(meta?.pxh || numv(gr, 20, 0)),
    });
  }
  const defining = new Set();
  function defineBlock(name) {
    if (outBlocks[name] || defining.has(name)) return;
    defining.add(name);
    const b = rawBlocks.get(name), ents = [];
    // Dentro de un bloque las referencias anidadas uniformes también se conservan
    const conv = list => {
      let run = [];
      const flush = () => { if (run.length) convert(run, G.Mx.I(), 1, null, ents, linkCtx(run, { attdef: true })); run = []; };
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
            const av = attribValues(atts), cl = clipOf(gr);
            if (av) ins.attribs = av;
            if (cl) ins.clip = cl;
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
  // Diccionarios de OBJECTS: identificador → nombre (estilos de directriz y grupos)
  const dictName = new Map();
  for (const gr of sections.OBJECTS || []) {
    if (gr.type !== 'DICTIONARY') continue;
    let key = null;
    for (const [c, v] of gr.d) { if (c === 3) key = v; else if ((c === 350 || c === 360) && key != null) { dictName.set(v, key); key = null; } }
  }
  const mlStyleByHandle = new Map(), mleaderStyles = [], groupsOut = [];
  for (const gr of sections.OBJECTS || []) {
    if (gr.type === 'MLEADERSTYLE') {
      const name = dictName.get(val(gr, 5)) || val(gr, 3, '') || 'Standard';
      if (mleaderStyles.some(x => x.name === name)) continue;
      mlStyleByHandle.set(val(gr, 5), name);
      const asz = numv(gr, 44, DEFAULT_MLSTYLE.asz), ct = parseInt(val(gr, 170, '2'), 10);
      mleaderStyles.push({ ...DEFAULT_MLSTYLE, name, h: numv(gr, 45, DEFAULT_MLSTYLE.h) || DEFAULT_MLSTYLE.h, asz: asz || DEFAULT_MLSTYLE.asz, arrow: asz === 0 ? 'none' : 'closed',
        land: val(gr, 291) === '0' ? 0 : numv(gr, 43, DEFAULT_MLSTYLE.land), gap: numv(gr, 42, DEFAULT_MLSTYLE.gap), textStyle: styleByHandle.get(val(gr, 342)) || 'Standard', content: ct === 1 ? 'block' : ct === 0 ? 'none' : 'mtext' });
    } else if (gr.type === 'GROUP') {
      const name = dictName.get(val(gr, 5));
      if (!name) continue;
      groupsOut.push({ name, desc: val(gr, 300, '') || '', sel: val(gr, 71, '1') !== '0', handles: gr.d.filter(x => x[0] === 340).map(x => x[1]) });
    }
  }
  // Objetos por identificador; estilos de línea múltiple y de tabla
  const objByHandle = new Map((sections.OBJECTS || []).filter(gr => val(gr, 5)).map(gr => [val(gr, 5), gr]));
  const dictEntries = gr => { const out = {}; let key = null; for (const [c, v] of gr?.d || []) { if (c === 3) key = v; else if ((c === 350 || c === 360) && key != null) { out[key] = v; key = null; } } return out; };
  const colorIn = (aci, tc) => (tc != null ? '#' + ((+tc >>> 0) & 0xffffff).toString(16).padStart(6, '0') : aci === 256 ? 'BYLAYER' : aci === 0 ? 'BYBLOCK' : aciToHex(Math.abs(aci) || 7));
  const mlineStyles = [], tableStyleByHandle = new Map(), tableStyles = [];
  for (const gr of sections.OBJECTS || []) {
    if (gr.type === 'MLINESTYLE') {
      const name = dictName.get(val(gr, 5)) || val(gr, 2, '') || 'STANDARD';
      if (mlineStyles.some(s => s.name === name)) continue;
      const fl = parseInt(val(gr, 70, '0'), 10) || 0, d = gr.d, k = d.findIndex(x => x[0] === 71), elems = [];
      let fill = null;
      if (fl & 1) { const i62 = d.findIndex(x => x[0] === 62); fill = colorIn(parseInt(d[i62]?.[1] ?? '7', 10), d[i62 + 1]?.[0] === 420 ? d[i62 + 1][1] : null); if (!fill.startsWith('#')) fill = '#808080'; }
      for (let i = k + 1; k >= 0 && i < d.length; i++) {
        const [c, v] = d[i];
        if (c === 49) elems.push({ off: parseFloat(v), color: 'BYLAYER', ltype: 'BYLAYER' });
        else if (c === 62 && elems.length) elems[elems.length - 1].color = colorIn(parseInt(v, 10), d[i + 1]?.[0] === 420 ? d[i + 1][1] : null);
        else if (c === 6 && elems.length) { const t = String(v).toUpperCase(); elems[elems.length - 1].ltype = t === 'BYLAYER' || t === 'BYBLOCK' ? t : LTYPES[t] ? t : 'CONTINUOUS'; }
        else if (c === 1001) break;
      }
      const caps = { sLine: !!(fl & 16), sInner: !!(fl & 32), sOuter: !!(fl & 64), eLine: !!(fl & 256), eInner: !!(fl & 512), eOuter: !!(fl & 1024) };
      mlineStyles.push({ name, desc: val(gr, 3, '') || '', elems: elems.length ? elems : JSON.parse(JSON.stringify(DEFAULT_MLINESTYLE.elems)), caps, joints: !!(fl & 2), fill });
    } else if (gr.type === 'TABLESTYLE') {
      const name = dictName.get(val(gr, 5)) || 'Standard', hs = gr.d.filter(x => x[0] === 140).map(x => parseFloat(x[1])), th = hs[0] || DEFAULT_TBLSTYLE.th;
      const xd = xdataOf(gr), al = xd?.find(x => x[0] === 1000)?.[1] || { 1: 'l', 4: 'l', 7: 'l', 2: 'c', 5: 'c', 8: 'c', 3: 'r', 6: 'r', 9: 'r' }[parseInt(val(gr, 170, '4'), 10)] || 'auto';
      tableStyleByHandle.set(val(gr, 5), name);
      if (!tableStyles.some(s => s.name === name)) tableStyles.push({ ...DEFAULT_TBLSTYLE, name, th, textStyle: val(gr, 7, 'Standard') || 'Standard', margin: +(numv(gr, 40, th * DEFAULT_TBLSTYLE.margin) / th).toFixed(6), titleScale: hs[2] ? +(hs[2] / th).toFixed(6) : DEFAULT_TBLSTYLE.titleScale, align: ['l', 'c', 'r', 'auto'].includes(al) ? al : 'auto' });
    }
  }
  // Delimitación (XCLIP) de una referencia: diccionario de extensión → ACAD_FILTER → SPATIAL (SPATIAL_FILTER)
  function clipOf(gr) {
    const i = gr.d.findIndex(x => x[0] === 102 && x[1] === '{ACAD_XDICTIONARY');
    if (i < 0) return null;
    const xd = gr.d[i + 1]?.[0] === 360 ? gr.d[i + 1][1] : null, fd = dictEntries(objByHandle.get(xd)).ACAD_FILTER, sf = objByHandle.get(dictEntries(objByHandle.get(fd)).SPATIAL);
    if (!sf || sf.type !== 'SPATIAL_FILTER') return null;
    const k = sf.d.findIndex(x => x[0] === 100 && x[1] === 'AcDbSpatialFilter'), pts = [];
    for (const [c, v] of sf.d.slice(k + 1)) { if (c === 10) pts.push(P(parseFloat(v), 0)); else if (c === 20 && pts.length) pts[pts.length - 1].y = parseFloat(v); else if (c === 210) break; }
    const poly = pts.length === 2 ? [pts[0], P(pts[1].x, pts[0].y), pts[1], P(pts[0].x, pts[1].y)] : pts; // dos puntos: rectángulo
    if (poly.length < 3) return null;
    const fl = +(xdataOf(sf)?.find(x => x[0] === 1070)?.[1] || 0);
    return { pts: poly, ...(fl & 1 ? { invert: true } : {}), ...(fl & 2 ? { off: true } : {}) };
  }
  // ACAD_TABLE → tabla (filas, columnas, alturas, anchuras, textos y estilo); null si no tiene los datos de AcDbTable
  function tableFrom(gr) {
    const k = gr.d.findIndex(x => x[0] === 100 && x[1] === 'AcDbTable');
    if (k < 0) return null;
    let nr = 0, nc = 0, dir = P(1, 0), style = null, cur = null, chunks = '';
    const rows = [], cols = [], cells = [];
    for (const [c, v] of gr.d.slice(k + 1)) {
      if (c === 1001) break;
      if (!cur) {
        if (c === 91 && !nr) nr = parseInt(v, 10);
        else if (c === 92 && !nc) nc = parseInt(v, 10);
        else if (c === 141) rows.push(parseFloat(v));
        else if (c === 142) cols.push(parseFloat(v));
        else if (c === 11) dir.x = parseFloat(v); else if (c === 21) dir.y = parseFloat(v);
        else if (c === 342) style = v;
      }
      if (c === 171) { cur = { text: '', span: 1 }; cells.push(cur); chunks = ''; }
      else if (!cur) continue;
      else if (c === 175) cur.span = parseInt(v, 10) || 1;
      else if (c === 3) chunks += v;
      else if (c === 1) cur.text = chunks + v;
    }
    if (!(nr > 0 && nc > 0) || rows.length !== nr || cols.length !== nc || cells.length < nr * nc) return null;
    const xd = xdataOf(gr), fl = xd?.find(x => x[0] === 1070), th = xd?.find(x => x[0] === 1040);
    const title = fl ? !!(+fl[1] & 1) : nc > 1 ? cells[0].span === nc : true;
    const tb = { type: 'table', p: P(numv(gr, 10), numv(gr, 20)), rot: Math.atan2(dir.y, dir.x), cols, rows, title, header: fl ? !!(+fl[1] & 2) : true, tstyle: tableStyleByHandle.get(style) || 'Standard',
      cells: Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_, c) => mtextPlain(specials(cells[r * nc + c].text || '')))) };
    if (th) tb.th = parseFloat(th[1]);
    return tb;
  }
  // Las directrices LEADER enlazan su MTEXT por identificador: se indexan los MTEXT de cada lista
  const linkCtx = (list, ctx = {}) => ({ ...ctx, used: new Set(), mtexts: new Map(list.filter(x => x.type === 'MTEXT' && val(x, 5)).map(x => [val(x, 5), x])) });
  const ents = [];
  convert(modelG, G.Mx.I(), 0, null, ents, linkCtx(modelG));

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
    convert(src, G.Mx.I(), 0, null, le, linkCtx(src, { paper: true }));
    const paper = Object.entries(PAPERS_MM).find(([, [a, b]]) => Math.abs(Math.max(a, b) - Math.max(l.w, l.h)) < 1 && Math.abs(Math.min(a, b) - Math.min(l.w, l.h)) < 1)?.[0] || 'A4';
    outLayouts.push({ name: l.name, paper, w: l.w, h: l.h, ents: le });
  }
  // Estados de capa (objetos LAYERSTATE): mismas propiedades que los archivos .las
  const layerStates = [];
  for (const gr of sections.OBJECTS || []) {
    if (gr.type !== 'LAYERSTATE') continue;
    const s = { name: val(gr, 1, ''), desc: val(gr, 301, ''), cur: val(gr, 302, '0'), layers: {}, saved: new Date().toISOString() };
    let l = null;
    for (const [c, v] of gr.d) {
      if (c === 8) { l = { on: true, lock: false, color: '#ffffff', ltype: 'CONTINUOUS', lw: 'DEFAULT' }; s.layers[v] = l; }
      else if (!l) continue;
      else if (c === 90) { const f = parseInt(v, 10) || 0; l.on = !(f & 1) && !(f & 2); l.lock = !!(f & 4); }
      else if (c === 62) { const a = parseInt(v, 10); if (a < 0) l.on = false; if (Math.abs(a) >= 1 && Math.abs(a) <= 255) l.color = aciToHex(Math.abs(a)); }
      else if (c === 92 || c === 420) l.color = '#' + ((parseInt(v, 10) >>> 0) & 0xffffff).toString(16).padStart(6, '0');
      else if (c === 370) l.lw = lwFrom(v);
      else if (c === 6) { const t = String(v).toUpperCase(); l.ltype = LTYPES[t] ? t : 'CONTINUOUS'; }
    }
    if (s.name) layerStates.push(s);
  }
  return { layers: [...layers.values()], ents, blocks: outBlocks, textStyles, dimStyles, mleaderStyles, mlineStyles, tableStyles, layouts: outLayouts, groups: groupsOut, patterns, layerStates, insBase: headerPoint(pairs, '$INSBASE') || P(0, 0), skipped };
}

// Punto de una variable de cabecera (código 9 seguido de 10/20)
function headerPoint(pairs, name) {
  const i = pairs.findIndex(p => p[0] === 9 && p[1] === name);
  if (i < 0 || pairs[i + 1]?.[0] !== 10) return null;
  return P(parseFloat(pairs[i + 1][1]) || 0, pairs[i + 2]?.[0] === 20 ? parseFloat(pairs[i + 2][1]) || 0 : 0);
}

// Valores de atributos {ETIQUETA: valor} de una lista de ATTRIB
function attribValues(atts) {
  const out = {};
  for (const a of atts) { const tag = (val(a, 2, '') || '').toUpperCase(); if (tag) out[tag] = specials(val(a, 1, '')); }
  return Object.keys(out).length ? out : null;
}

