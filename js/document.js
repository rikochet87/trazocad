// Documento: capas, espacio modelo, presentaciones, bloques, estilos, grupos, estados de capa, patrones,
// deshacer/rehacer, sombreados asociativos y serialización.
import { bboxOf, bbUnion, cloneEnt, LTYPES, DEFAULT_DIMSTYLE, DEFAULT_MLSTYLE, DEFAULT_TBLSTYLE } from './entities.js';
import { assocLoops } from './hatch.js';
import { ENV } from './entities.js';
ENV.assocLoops = assocLoops; // para recalcular un sombreado al cambiar su estilo de islas en Propiedades
import { updateDim, updateCenter, centerRefs, dropMissing, dimRefIds } from './assoc.js';
import { remapDyn } from './dynblock.js';
import { solve, consValid, refIds } from './constraints.js';
import { cleanGroups } from './groups.js';
import { DEFAULT_MLINESTYLE } from './mline.js';
import { annoHidden, defaultScales } from './annoscale.js';
import { localPath, pathable } from './arrays.js';

export const DEFAULT_SETTINGS = {
  gridX: 10, snapX: 10, polarInc: 15, ltscale: 1, coordDec: 4,
  textH: 2.5, filletR: 0, chamferA: 0, chamferB: 0, offsetD: 10, lastRadius: 10, polySides: 4,
  hatchPat: 'ANSI31', hatchScale: 1, hatchAng: 0, hatchAssoc: true, iso: false, isoPlane: 'top', splineMethod: 'fit',
  dimAssoc: true, mleaderContent: 'mtext', balloonNum: 0, insBase: { x: 0, y: 0 },
  mlScale: 20, mlJust: 'top', arrayAssoc: true, xclipFrame: 2, wipeoutFrame: 2, boundaryType: 'pline', boundaryIslands: true, revcloud: 5,
  unitsPerInch: 25.4, hatchIslands: 'normal', psltscale: 0, ucsIcon: true, ucsIconOrigin: true,
  ucsvp: 1, ucsfollow: 0, vprotateassoc: 1, cannoscale: '1:1', annoAllVisible: 1, annoAutoScale: 0,
};
const newMlStyle = () => JSON.parse(JSON.stringify(DEFAULT_MLINESTYLE));
// Diferencias entre dos estados completos (mensajes de la comprobación del deshacer)
function diffStates(a, b) {
  const A = JSON.parse(a), B = JSON.parse(b), out = [];
  for (const k of Object.keys({ ...A, ...B })) {
    if (k === 'model') {
      const ma = new Map((A.model || []).map(e => [e.id, JSON.stringify(e)])), mb = new Map((B.model || []).map(e => [e.id, JSON.stringify(e)]));
      const bad = [...new Set([...ma.keys(), ...mb.keys()])].filter(id => ma.get(id) !== mb.get(id));
      if (bad.length) out.push(`modelo: ${bad.slice(0, 5).map(id => `${id} ${(ma.get(id) || '—').slice(0, 160)} ≠ ${(mb.get(id) || '—').slice(0, 160)}`).join('; ')}`);
      else if (JSON.stringify(A.model.map(e => e.id)) !== JSON.stringify(B.model.map(e => e.id))) out.push('modelo: orden distinto');
    } else if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) out.push(k);
  }
  return out.join(' | ') || 'sin diferencias visibles';
}
export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Carta: [279.4, 215.9], Oficio: [355.6, 215.9] };

const newLayer = (name, color = '#ffffff') => ({ name, color, ltype: 'CONTINUOUS', lw: 'DEFAULT', on: true, lock: false });

// Sustituye el contenido de una entidad por el de su JSON conservando el objeto (y su sitio en las listas y los índices)
const setContent = (e, json) => { for (const k of Object.keys(e)) delete e[k]; Object.assign(e, JSON.parse(json)); };

export class Doc {
  constructor() { this.listeners = []; this.ver = 0; this.log = []; this.quiet = false; this.reset(); }

  on(fn) { this.listeners.push(fn); }
  emit(kind, data) { if (!this.quiet) for (const f of this.listeners) f(kind, data); }

  reset() {
    this.layers = [newLayer('0')];
    this.model = [];
    this.layouts = [];
    this.blocks = {};
    this.bedit = null; // editor de bloques abierto: {name, base, ents}
    this.constraints = []; // restricciones paramétricas (constraints.js)
    this.params = [];      // parámetros de usuario {name, expr}
    this.groups = [];      // grupos (groups.js)
    this.layerStates = []; // estados de capa (layerstates.js)
    this.patterns = {};    // patrones de sombreado personalizados {NOMBRE: {desc, fam}} (patterns.js)
    this.plotStyles = {};  // tablas de estilos de trazado propias {nombre.ctb|nombre.stb: tabla} (plotstyles.js)
    this.ucs = null;       // SCP actual del espacio modelo {o, ang, name?} (ucs.js); null = universal
    this.ucsList = [];     // SCP con nombre
    this.ucsPrev = [];     // SCP anteriores (UCS › Previo); no se guardan
    this.views = [];       // vistas con nombre (views.js)
    this.vportConfigs = []; // configuraciones de ventanas en mosaico del modelo con nombre
    this.selFilters = [];  // filtros de selección con nombre (FILTER, select.js)
    this.layerFilters = []; // filtros de capa por propiedades y por grupos (layertools.js)
    this.layIso = null;    // estado de las capas antes de LAYISO
    this.scales = defaultScales(); // lista de escalas (SCALELISTEDIT)
    this.origin = { x: 0, y: 0 }; // origen local del modelo: coordenada real = coordenada interna + origen (origin.js)
    this.tiles = null;     // ventanas en mosaico leídas del archivo (la aplicación las restituye)
    this.space = 'model';
    this.textStyles = [{ name: 'Standard', font: 'Arial', width: 1, oblique: 0 }];
    this.dimStyles = [{ ...DEFAULT_DIMSTYLE }];
    this.mleaderStyles = [{ ...DEFAULT_MLSTYLE }];
    this.tableStyles = [{ ...DEFAULT_TBLSTYLE }];
    this.mlineStyles = [newMlStyle()];
    this.byId = new Map();
    this.nextId = 1;
    this.cur = { layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', textStyle: 'Standard', dimStyle: 'ISO-25', mleaderStyle: 'Standard', tableStyle: 'Standard', mlineStyle: 'STANDARD' };
    this.settings = { ...DEFAULT_SETTINGS };
    this.undoS = []; this.redoS = []; this.tx = null;
    this.touched = new Set(); // entidades añadidas, modificadas o borradas en la transacción
    this.activeVp = null;     // ventana gráfica por la que se trabaja (MSPACE): sus capas inutilizadas no se ven
    this.dirty = false;
    this.name = 'Dibujo1';
    this.markFull();
    this.emit('reset');
  }

  // Entidades del espacio activo (modelo, papel de la presentación activa o editor de bloques)
  get ents() {
    if (this.space === 'bedit') return this.bedit?.ents || this.model;
    return this.space === 'model' ? this.model : (this.layouts[this.space]?.ents || this.model);
  }
  *allEnts() { yield* this.model; for (const l of this.layouts) yield* l.ents; if (this.bedit) yield* this.bedit.ents; }
  layout() { return this.space === 'model' || this.space === 'bedit' ? null : this.layouts[this.space]; }

  // ----- Deshacer / rehacer -----
  // Cada transacción guarda entero el estado de lo que no son entidades del modelo (capas, estilos, bloques, presentaciones
  // con sus objetos, editor de bloques, SCP…) y, del modelo, sólo un diario de cambios: objetos añadidos y suprimidos con
  // su posición y el estado anterior de los modificados. Así una orden no copia el dibujo entero (con 100 000 objetos,
  // decenas de MB por paso). Las entidades del modelo se cambian con add, remove y modify, o avisando antes con before(e).
  // state() es el estado completo (lo usa la comprobación del deshacer).
  state() {
    return JSON.stringify({ layers: this.layers, model: this.model, layouts: this.layouts, blocks: this.blocks, textStyles: this.textStyles, dimStyles: this.dimStyles, mleaderStyles: this.mleaderStyles, tableStyles: this.tableStyles, mlineStyles: this.mlineStyles, nextId: this.nextId, cur: this.cur, bedit: this.bedit, constraints: this.constraints, params: this.params, groups: this.groups, layerStates: this.layerStates, patterns: this.patterns, plotStyles: this.plotStyles, ucs: this.ucs, ucsList: this.ucsList, views: this.views, vportConfigs: this.vportConfigs, selFilters: this.selFilters, layerFilters: this.layerFilters, layIso: this.layIso, scales: this.scales });
  }
  loadState(s) {
    const o = JSON.parse(s);
    Object.assign(this, { layers: o.layers, model: o.model, layouts: o.layouts, blocks: o.blocks, textStyles: o.textStyles, dimStyles: o.dimStyles, mleaderStyles: o.mleaderStyles, tableStyles: o.tableStyles, mlineStyles: o.mlineStyles?.length ? o.mlineStyles : [newMlStyle()], nextId: o.nextId, cur: o.cur, bedit: o.bedit || null, constraints: o.constraints || [], params: o.params || [], groups: o.groups || [], layerStates: o.layerStates || [], patterns: o.patterns || {}, plotStyles: o.plotStyles || {}, ucs: o.ucs || null, ucsList: o.ucsList || [], views: o.views || [], vportConfigs: o.vportConfigs || [], selFilters: o.selFilters || [], layerFilters: o.layerFilters || [], layIso: o.layIso || null, scales: o.scales?.length ? o.scales : defaultScales() });
    if (this.bedit) this.space = 'bedit';
    else if (this.space === 'bedit') this.space = 'model';
    else if (this.space !== 'model' && this.space !== 'bedit' && !this.layouts[this.space]) this.space = 'model';
    this.reindex();
  }
  reindex() { this.byId = new Map([...this.allEnts()].map(e => [e.id, e])); this.markFull(); }
  // Estado salvo las entidades del modelo: «geo» afecta al aspecto y al tamaño de los objetos (capas, bloques, estilos,
  // escalas); «rest», lo demás (presentaciones con sus objetos, editor de bloques, SCP, vistas, grupos…)
  geoState() {
    return JSON.stringify({ layers: this.layers, blocks: this.blocks, textStyles: this.textStyles, dimStyles: this.dimStyles, mleaderStyles: this.mleaderStyles, tableStyles: this.tableStyles, mlineStyles: this.mlineStyles, patterns: this.patterns, scales: this.scales, origin: this.origin });
  }
  restState() {
    return JSON.stringify({ layouts: this.layouts, nextId: this.nextId, cur: this.cur, bedit: this.bedit, constraints: this.constraints, params: this.params, groups: this.groups, layerStates: this.layerStates, plotStyles: this.plotStyles, ucs: this.ucs, ucsList: this.ucsList, views: this.views, vportConfigs: this.vportConfigs, selFilters: this.selFilters, layerFilters: this.layerFilters, layIso: this.layIso });
  }
  *paperEnts() { for (const l of this.layouts) yield* l.ents; if (this.bedit) yield* this.bedit.ents; }
  loadMeta(geo, rest) {
    if (geo) {
      const g = JSON.parse(geo), o0 = this.origin;
      Object.assign(this, { layers: g.layers, blocks: g.blocks, textStyles: g.textStyles, dimStyles: g.dimStyles, mleaderStyles: g.mleaderStyles, tableStyles: g.tableStyles, mlineStyles: g.mlineStyles?.length ? g.mlineStyles : [newMlStyle()], patterns: g.patterns || {}, scales: g.scales?.length ? g.scales : defaultScales(), origin: g.origin || { x: 0, y: 0 } });
      this.markFull();
      const o1 = this.origin; // el origen local cambió: la aplicación desplaza sus vistas (origin.js)
      if (o0 && (o0.x !== o1.x || o0.y !== o1.y)) this.emit('origin', { dx: o0.x - o1.x, dy: o0.y - o1.y });
    }
    if (rest) {
      const o = JSON.parse(rest);
      for (const e of this.paperEnts()) this.byId.delete(e.id);
      Object.assign(this, { layouts: o.layouts, nextId: o.nextId, cur: o.cur, bedit: o.bedit || null, constraints: o.constraints || [], params: o.params || [], groups: o.groups || [], layerStates: o.layerStates || [], plotStyles: o.plotStyles || {}, ucs: o.ucs || null, ucsList: o.ucsList || [], views: o.views || [], vportConfigs: o.vportConfigs || [], selFilters: o.selFilters || [], layerFilters: o.layerFilters || [], layIso: o.layIso || null });
      if (this.bedit) this.space = 'bedit';
      else if (this.space === 'bedit') this.space = 'model';
      else if (this.space !== 'model' && !this.layouts[this.space]) this.space = 'model';
      for (const e of this.paperEnts()) this.byId.set(e.id, e);
      this.ver++; this.log.push({ ver: this.ver, kind: 'meta' });
    }
  }
  // full: la transacción guarda el estado completo (AUDIT, que repara la estructura del dibujo, incluso identificadores)
  begin(full = false) {
    if (this.tx) { this.tx.depth++; return; }
    this.tx = { depth: 1, geo: this.geoState(), rest: this.restState(), j: [], seen: new Set(), ...(full ? { snap: this.state() } : {}) };
    if (this.verifyUndo && !full) this.tx.full = this.state();
  }
  // ¿La entidad está en el espacio modelo? (las demás listas, pequeñas, se guardan enteras en cada transacción)
  inModel(e) { return this.byId.get(e.id) === e && !this.layouts.some(l => l.ents.includes(e)) && !this.bedit?.ents.includes(e); }
  // Registra el estado de una entidad del modelo antes de cambiarla (modify lo hace solo)
  before(e) {
    const t = this.tx;
    if (!t || !e || t.seen.has(e) || !this.inModel(e)) return;
    t.seen.add(e);
    t.j.push({ k: 'mod', e, json: JSON.stringify(e) });
  }
  commit() {
    if (!this.tx || --this.tx.depth > 0) return;
    this.syncConstraints();
    this.syncAssoc();
    cleanGroups(this);
    const t = this.tx;
    this.tx = null;
    if (t.snap) { // estado completo
      const s = this.state();
      if (s === t.snap) return;
      this.pushUndo({ full: [t.snap, s] });
      this.redoS = []; this.dirty = true; this.emit('commit');
      return;
    }
    const geo = this.geoState(), rest = this.restState();
    const j = t.j.filter(o => o.k !== 'mod' || o.json !== JSON.stringify(o.e)); // las modificaciones sin efecto no cuentan
    if (j.length || geo !== t.geo || rest !== t.rest) {
      const rec = { j, geo: geo !== t.geo ? [t.geo, geo] : null, rest: rest !== t.rest ? [t.rest, rest] : null };
      if (t.full) this.verifyRec(rec, t.full);
      this.pushUndo(rec);
      this.redoS = [];
      this.dirty = true;
      this.emit('commit');
    }
  }
  // Pila de deshacer: hasta 200 pasos y unos 100 millones de caracteres guardados (con 100 000 objetos, desplazarlos
  // todos guarda cada uno; los pasos más antiguos se descartan)
  pushUndo(rec) {
    const size = r => r.size ??= (r.full ? r.full[0].length + r.full[1].length : (r.geo ? r.geo[0].length + r.geo[1].length : 0) + (r.rest ? r.rest[0].length + r.rest[1].length : 0) + r.j.reduce((s, o) => s + (o.json?.length || 0) + (o.items ? o.items.reduce((a, x) => a + x.json.length, 0) : 0), 0));
    this.undoS.push(rec);
    let total = this.undoS.reduce((s, r) => s + size(r), 0);
    while (this.undoS.length > 1 && (this.undoS.length > 200 || total > 1e8)) total -= size(this.undoS.shift());
  }
  // Deshace los cambios del diario j (del último al primero) y devuelve el diario que los rehace
  revert(j) {
    const inv = [], m = this.model, q = this.quiet;
    let mid = false; // se reinsertaron objetos entre otros: el índice espacial se reconstruye (orden de dibujo)
    this.quiet = true;
    try {
      for (let i = j.length - 1; i >= 0; i--) {
        const o = j[i], e = o.e;
        if (o.k === 'ins') {
          const at = m[o.idx] === e ? o.idx : m.indexOf(e);
          if (at >= 0) m.splice(at, 1);
          this.byId.delete(e.id);
          inv.push({ k: 'rem', e, idx: at < 0 ? m.length : at, json: JSON.stringify(e) });
          this.logEnt('del', e, m);
        } else if (o.k === 'rem') {
          setContent(e, o.json);
          const at = Math.min(o.idx, m.length);
          m.splice(at, 0, e);
          this.byId.set(e.id, e);
          inv.push({ k: 'ins', e, idx: at });
          if (at < m.length - 1) mid = true;
          this.logEnt('add', e, m);
        } else if (o.k === 'mod') {
          inv.push({ k: 'mod', e, json: JSON.stringify(e) });
          setContent(e, o.json);
          this.logEnt('mod', e);
        } else if (o.k === 'remN') { // supresión de muchos (removeMany): se reinsertan en sus posiciones de una pasada
          const out = [], it = o.items;
          let p = 0, q = 0;
          for (let pos = 0, n = m.length + it.length; pos < n; pos++) {
            if (q < it.length && it[q].idx === pos) { const x = it[q++]; setContent(x.e, x.json); this.byId.set(x.e.id, x.e); out.push(x.e); this.logEnt('add', x.e, m); }
            else if (p < m.length) out.push(m[p++]);
          }
          while (q < it.length) { const x = it[q++]; setContent(x.e, x.json); this.byId.set(x.e.id, x.e); out.push(x.e); this.logEnt('add', x.e, m); }
          m.length = 0;
          for (const x of out) m.push(x);
          inv.push({ k: 'insN', es: it.map(x => x.e) });
          mid = true;
        } else if (o.k === 'insN') {
          const set = new Set(o.es), items = [];
          let k = 0;
          for (let i = 0; i < m.length; i++) {
            const e = m[i];
            if (!set.has(e)) { m[k++] = e; continue; }
            items.push({ e, idx: i, json: JSON.stringify(e) });
            this.byId.delete(e.id);
            this.logEnt('del', e, m);
          }
          m.length = k;
          inv.push({ k: 'remN', items });
        } else if (o.k === 'order') {
          inv.push({ k: 'order', ids: m.map(x => x.id) });
          const byId = new Map(m.map(x => [x.id, x])), list = o.ids.map(id => byId.get(id)).filter(Boolean);
          m.length = 0;
          for (const x of list) m.push(x);
          mid = true;
        }
      }
    } finally { this.quiet = q; }
    if (mid) this.markFull();
    return inv;
  }
  undo() {
    if (!this.undoS.length) return false;
    if (this.undoS[this.undoS.length - 1].full) { const r = this.undoS.pop(); this.loadState(r.full[0]); this.redoS.push(r); this.touched.clear(); this.dirty = true; this.emit('change'); return true; }
    const r = this.undoS.pop(), j = this.revert(r.j);
    if (r.geo || r.rest) this.loadMeta(r.geo?.[0], r.rest?.[0]);
    this.redoS.push({ ...r, j, size: undefined });
    this.touched.clear();
    this.dirty = true; this.emit('change'); return true;
  }
  redo() {
    if (!this.redoS.length) return false;
    if (this.redoS[this.redoS.length - 1].full) { const r = this.redoS.pop(); this.loadState(r.full[1]); this.undoS.push(r); this.touched.clear(); this.dirty = true; this.emit('change'); return true; }
    const r = this.redoS.pop(), j = this.revert(r.j);
    if (r.geo || r.rest) this.loadMeta(r.geo?.[1], r.rest?.[1]);
    this.undoS.push({ ...r, j, size: undefined });
    this.touched.clear();
    this.dirty = true; this.emit('change'); return true;
  }
  // Punto de restauración dentro de una transacción (opción desHacer de RECORTA, ALARGA y LONGITUD)
  savepoint() {
    const t = this.tx;
    if (!t) return null;
    t.seen = new Set();
    return { n: t.j.length, geo: this.geoState(), rest: this.restState() };
  }
  rollback(sp) {
    const t = this.tx;
    if (!t || !sp) return;
    this.revert(t.j.splice(sp.n));
    const geo = this.geoState(), rest = this.restState();
    if (geo !== sp.geo || rest !== sp.rest) this.loadMeta(geo !== sp.geo ? sp.geo : null, rest !== sp.rest ? sp.rest : null);
    t.seen = new Set();
    this.dirty = true; this.emit('change');
  }
  // Comprobación del deshacer (doc.verifyUndo, para las pruebas): deshacer y rehacer el registro tiene que devolver
  // exactamente el estado completo de antes y el de después
  verifyRec(rec, before) {
    const after = this.state(), q = this.quiet, tx = this.tx;
    // los objetos que no son del modelo se recrean al cargar su estado: al terminar se vuelven a poner los mismos
    const META = ['layers', 'blocks', 'textStyles', 'dimStyles', 'mleaderStyles', 'tableStyles', 'mlineStyles', 'patterns', 'scales', 'origin', 'layouts', 'nextId', 'cur', 'bedit', 'constraints', 'params', 'groups', 'layerStates', 'plotStyles', 'ucs', 'ucsList', 'views', 'vportConfigs', 'selFilters', 'layerFilters', 'layIso', 'space'];
    const keep = Object.fromEntries(META.map(k => [k, this[k]]));
    this.quiet = true; this.tx = null;
    try {
      const inv = this.revert(rec.j);
      if (rec.geo || rec.rest) this.loadMeta(rec.geo?.[0], rec.rest?.[0]);
      const s0 = this.state();
      this.revert(inv);
      if (rec.geo || rec.rest) this.loadMeta(rec.geo?.[1], rec.rest?.[1]);
      const s1 = this.state();
      if (s0 !== before) console.error(`DESHACER INCOMPLETO (${this.curCmd || '?'}): ${diffStates(before, s0)}`);
      if (s1 !== after) console.error(`REHACER INCOMPLETO (${this.curCmd || '?'}): ${diffStates(after, s1)}`);
    } finally {
      for (const e of this.paperEnts()) this.byId.delete(e.id);
      Object.assign(this, keep);
      for (const e of this.paperEnts()) this.byId.set(e.id, e);
      this.quiet = q; this.tx = tx;
    }
  }

  // ----- Diario de cambios (índice espacial incremental y dibujo por teselas) -----
  // Cada versión del documento tiene una entrada: un objeto añadido, suprimido o modificado (con su lista) o un cambio
  // general («full»: capas, estilos, orden de dibujo…), que obliga a reconstruir los índices.
  logEnt(kind, e, arr = null) {
    this.ver++;
    this.log.push({ ver: this.ver, kind, e, arr });
    if (this.log.length > 400000) this.markFull();
    this.dirty = true;
    this.emit('change');
  }
  markFull() { this.ver++; this.log = [{ ver: this.ver, full: true }]; }

  // ----- Entidades -----
  add(e, target = this.ents) {
    e.id = this.nextId++;
    e.layer ??= this.cur.layer; e.color ??= this.cur.color; e.ltype ??= this.cur.ltype; e.lw ??= this.cur.lw;
    if (this.cur.pstyle && this.cur.pstyle !== 'BYLAYER' && !('pstyle' in e)) e.pstyle = this.cur.pstyle; // estilo de trazado con nombre actual
    if (e.type === 'text') e.style ??= this.cur.textStyle;
    if (e.type === 'dim') e.style ??= this.cur.dimStyle;
    if (!this.layers.some(l => l.name === e.layer)) e.layer = '0';
    if (e.type === 'mtext' || e.type === 'attdef') e.style ??= this.cur.textStyle;
    target.push(e); this.byId.set(e.id, e);
    if (this.tx && target === this.model) { this.tx.j.push({ k: 'ins', e, idx: target.length - 1 }); this.tx.seen.add(e); }
    this.touched.add(e.id);
    this.logEnt('add', e, target);
    return e;
  }
  get(id) { return this.byId.get(id); }
  remove(id) {
    const e = this.byId.get(id);
    if (!e) return;
    for (const arr of this.lists()) {
      const i = arr.indexOf(e);
      if (i < 0) continue;
      if (this.tx && arr === this.model) this.tx.j.push({ k: 'rem', e, idx: i, json: JSON.stringify(e) });
      arr.splice(i, 1);
      this.byId.delete(id);
      this.touched.add(id);
      this.logEnt('del', e, arr);
      return;
    }
    this.byId.delete(id);
    this.touched.add(id);
    this.changed();
  }
  // Suprime muchos objetos de una vez (recorre cada lista una sola vez)
  removeMany(ids) {
    const set = new Set();
    for (const id of ids) { const e = this.byId.get(id); if (e) set.add(e); }
    if (set.size < 64) { for (const e of set) this.remove(e.id); return; }
    const q = this.quiet;
    this.quiet = true;
    try {
      for (const arr of this.lists()) {
        const items = this.tx && arr === this.model ? [] : null; // una sola entrada del diario: {e, idx (posición antes), json}
        let k = 0;
        for (let i = 0; i < arr.length; i++) {
          const e = arr[i];
          if (!set.has(e)) { arr[k++] = e; continue; }
          items?.push({ e, idx: i, json: JSON.stringify(e) });
          this.byId.delete(e.id);
          this.touched.add(e.id);
          this.logEnt('del', e, arr);
        }
        arr.length = k;
        if (items?.length) this.tx.j.push({ k: 'remN', items });
      }
    } finally { this.quiet = q; }
    this.emit('change');
  }
  modify(id, fn) { const e = this.byId.get(id); if (e) { this.before(e); fn(e); this.touched.add(id); this.logEnt('mod', e); } return e; }
  // Cambia el orden de dibujo de una lista de entidades (DRAWORDER)
  setOrder(arr, list) {
    if (this.tx && arr === this.model) this.tx.j.push({ k: 'order', ids: arr.map(e => e.id) });
    arr.length = 0;
    for (const e of list) arr.push(e);
    this.changed();
  }

  // Listas de entidades editables: modelo, presentaciones y, si está abierto, el editor de bloques
  lists() { return [this.model, ...this.layouts.map(l => l.ents), ...(this.bedit ? [this.bedit.ents] : [])]; }

  // Sombreados y cotas asociativos: si cambió alguna entidad de su geometría se recalculan; si la geometría
  // se borró, o el objeto se movió sin ella, dejan de ser asociativos (las cotas pierden sólo los puntos afectados).
  syncAssoc() {
    const t = this.touched;
    this.touched = new Set();
    if (!t.size) return;
    const get = id => this.byId.get(id);
    const drop = h => { delete h.assoc; delete h.seed; };
    const hit = id => t.has(id) || !get(id);
    for (const arr of this.lists()) {
      for (const h of arr) {
        const moved = h._xf;
        if (moved) { this.before(h); delete h._xf; }
        if (h.type === 'array' && h.pathId != null) { // matriz a lo largo de un recorrido: sigue al objeto del recorrido
          if (hit(h.pathId) || moved) this.before(h);
          const src = get(h.pathId);
          if (!src || !pathable(src)) delete h.pathId;
          else if (t.has(h.pathId)) h.path = localPath(h, src);
          else if (moved) delete h.pathId; // la matriz se movió sin su recorrido
          continue;
        }
        if (!h.assoc) continue;
        if ((h.type === 'dim' ? dimRefIds(h) : h.type === 'center' ? centerRefs(h) : h.type === 'hatch' ? h.assoc : []).some(hit)) this.before(h); // va a cambiar
        if (h.type === 'dim') {
          dropMissing(h, get);
          const ids = dimRefIds(h);
          if (!ids.length) continue;
          if (!ids.some(id => t.has(id))) { if (moved) delete h.assoc; continue; }
          if (!updateDim(h, get)) delete h.assoc;
          continue;
        }
        if (h.type === 'center') {
          dropMissing(h, get);
          const ids = centerRefs(h);
          if (!ids.length) continue;
          if (!ids.some(id => t.has(id))) { if (moved) delete h.assoc; continue; }
          if (!updateCenter(h, get)) delete h.assoc;
          continue;
        }
        if (h.type !== 'hatch') continue;
        const srcs = h.assoc.map(get);
        if (srcs.some(x => !x)) { drop(h); continue; }
        if (!h.assoc.some(id => t.has(id))) { if (moved) drop(h); continue; }
        const r = assocLoops(h, srcs);
        if (!r) { drop(h); continue; }
        h.loops = [...r.loops]; h.assoc = r.ids;
        if (r.seed) h.seed = r.seed;
      }
    }
  }
  // Restricciones: se quitan las que perdieron su geometría y se resuelven si cambió algo restringido.
  // Las entidades modificadas por el usuario se mueven lo menos posible.
  syncConstraints() {
    if (!this.constraints.length) return;
    this.constraints = this.constraints.filter(c => consValid(this, c));
    const cids = new Set(this.constraints.flatMap(refIds)), keep = new Set([...this.touched].filter(id => cids.has(id)));
    if (!keep.size && !this.consDirty) return;
    this.consDirty = false;
    const r = solve(this, keep);
    for (const id of r.changed) this.touched.add(id);
    if (!r.ok) this.emit('constraint-fail');
  }
  // Vista previa: cotas y sombreados asociados a las entidades `clones` (copias modificadas), ya recalculados
  previewDeps(clones) {
    const map = new Map(clones.map(e => [e.id, e])), get = id => map.get(id) || this.byId.get(id), out = [];
    for (const h of this.ents) {
      if (h.type === 'array' && map.has(h.pathId) && !map.has(h.id)) { out.push({ ...h, path: localPath(h, map.get(h.pathId)) }); continue; }
      if (!h.assoc || map.has(h.id)) continue;
      if (h.type === 'dim' && dimRefIds(h).some(id => map.has(id))) {
        const n = cloneEnt(h);
        if (updateDim(n, get)) out.push(n);
      } else if (h.type === 'center' && centerRefs(h).some(id => map.has(id))) {
        const n = cloneEnt(h);
        if (updateCenter(n, get)) out.push(n);
      } else if (h.type === 'hatch' && h.assoc.some(id => map.has(id))) {
        const srcs = h.assoc.map(get);
        const r = !srcs.some(x => !x) && srcs.length <= 50 ? assocLoops(h, srcs) : null;
        if (r) out.push({ ...h, loops: [...r.loops] });
      }
    }
    return out;
  }
  changed() { this.markFull(); this.dirty = true; this.emit('change'); }

  // ----- Capas, estilos y bloques -----
  layer(name) { return this.layers.find(l => l.name === name) || this.layers[0]; }
  addLayer(name, color) { const l = newLayer(name, color); this.layers.push(l); this.changed(); return l; }
  ensureLayer(name, color) { return this.layers.find(l => l.name === name) || this.addLayer(name, color); }
  visible(e) {
    if (!this.layer(e.layer).on || annoHidden(e)) return false;
    const vp = this.activeVp != null ? this.byId.get(this.activeVp) : null;
    return !vp?.frozen?.includes(e.layer);
  }
  // Visibilidad dentro de una ventana gráfica concreta (capas activadas y no inutilizadas en ella)
  visibleIn(vp) { return e => this.layer(e.layer).on && !vp.frozen?.includes(e.layer) && !annoHidden(e); }
  locked(e) { return this.layer(e.layer).lock; }
  textStyle(name) { return this.textStyles.find(s => s.name === name) || this.textStyles[0]; }
  dimStyle(name) { return this.dimStyles.find(s => s.name === name) || this.dimStyles[0]; }
  mleaderStyle(name) { return this.mleaderStyles.find(s => s.name === name) || this.mleaderStyles[0]; }
  tableStyle(name) { return this.tableStyles.find(s => s.name === name) || this.tableStyles[0]; }
  mlineStyle(name) { return this.mlineStyles.find(s => s.name === name) || this.mlineStyles[0]; }
  defineBlock(name, base, ents, extra = {}) {
    const old = this.blocks[name];
    this.blocks[name] = { name, base, ents, ver: (old?.ver || 0) + 1, ...extra };
    this.changed();
  }
  // ¿Las entidades (o los bloques que insertan, recursivamente) hacen referencia al bloque `target`?
  refersTo(ents, target, seen = new Set()) {
    for (const e of ents) {
      if (e.type === 'array') { if (this.refersTo(e.src, target, seen)) return true; continue; }
      if (e.type !== 'insert') continue;
      if (e.name === target) return true;
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      if (this.blocks[e.name] && this.refersTo(this.blocks[e.name].ents, target, seen)) return true;
    }
    return false;
  }
  // ----- Editor de bloques: se edita una copia de las entidades del bloque, con identificadores propios -----
  openBedit(name) {
    const b = this.blocks[name];
    this.bedit = { name, base: { ...b.base }, ents: [], prev: this.space };
    this.space = 'bedit';
    for (const e of b.ents) { const c = cloneEnt(e); delete c.id; this.add(c, this.bedit.ents); }
    // Parámetros dinámicos: índices → identificadores de las copias
    const ids = this.bedit.ents.map(e => e.id);
    this.bedit.dyn = remapDyn(b.dyn, i => ids[i]) || null;
    this.bedit.visCur = this.bedit.dyn?.vis?.states?.[0] || null;
    this.changed();
  }
  beditContent() {
    return this.bedit.ents.map(e => { const c = cloneEnt(e); for (const k of ['id', 'assoc', 'seed', '_xf', 'pathId']) delete c[k]; return c; });
  }
  beditChanged() {
    const b = this.blocks[this.bedit.name];
    return !b || JSON.stringify([this.bedit.base, this.beditContent(), this.beditDyn() || null]) !== JSON.stringify([b.base, b.ents, b.dyn || null]);
  }
  beditDyn() { const idx = new Map(this.bedit.ents.map((e, i) => [e.id, i])); return remapDyn(this.bedit.dyn, id => idx.get(id)); }
  saveBedit() { const dyn = this.beditDyn(); this.defineBlock(this.bedit.name, { ...this.bedit.base }, this.beditContent(), dyn ? { dyn } : {}); }
  closeBedit() {
    const prev = this.bedit.prev;
    this.bedit = null;
    this.space = prev === 'model' || this.layouts[prev] ? prev : 'model';
    this.reindex();
    this.changed();
  }
  blockInUse(name) { return this.bedit?.name === name || this.refersTo([...this.allEnts()], name) || Object.values(this.blocks).some(b => b.name !== name && this.refersTo(b.ents, name)); }
  style(e) {
    const L = this.layer(e.layer);
    const color = e.color === 'BYLAYER' || e.color === 'BYBLOCK' ? L.color : e.color;
    let lw = e.lw === 'BYLAYER' || e.lw === 'BYBLOCK' ? L.lw : e.lw;
    if (lw === 'DEFAULT') lw = 0.25;
    const lt = e.ltype === 'BYLAYER' || e.ltype === 'BYBLOCK' ? L.ltype : e.ltype;
    return { color, lw, pat: (LTYPES[lt] || LTYPES.CONTINUOUS).pat };
  }
  extents(ents = this.ents.filter(e => this.visible(e))) {
    let b = null;
    for (const e of ents) b = bbUnion(b, bboxOf(e));
    return b;
  }

  // ----- Presentaciones -----
  addLayout(name, paper = 'A4') {
    const [w, h] = PAPERS[paper] || PAPERS.A4;
    const l = { name, paper, w, h, ents: [] };
    this.layouts.push(l);
    this.changed();
    return l;
  }

  // ----- Serialización -----
  toJSON() {
    return {
      app: 'TrazoCAD', version: 13, name: this.name, layers: this.layers, model: this.model, layouts: this.layouts, blocks: this.blocks,
      textStyles: this.textStyles, dimStyles: this.dimStyles, mleaderStyles: this.mleaderStyles, tableStyles: this.tableStyles, mlineStyles: this.mlineStyles, constraints: this.constraints, params: this.params, groups: this.groups, layerStates: this.layerStates, patterns: this.patterns, plotStyles: this.plotStyles, cur: this.cur, settings: this.settings, nextId: this.nextId,
      ucs: this.ucs, ucsList: this.ucsList, views: this.views, vportConfigs: this.vportConfigs, selFilters: this.selFilters, layerFilters: this.layerFilters, layIso: this.layIso, scales: this.scales,
      ...(this.origin.x || this.origin.y ? { origin: this.origin } : {}),
      ...(this.viewState ? { tiles: this.viewState() } : {}),
    };
  }
  fromJSON(o) {
    this.reset();
    this.layers = o.layers?.length ? o.layers : this.layers;
    this.model = o.model || o.ents || [];
    this.layouts = o.layouts || [];
    this.blocks = o.blocks || {};
    this.textStyles = o.textStyles?.length ? o.textStyles : this.textStyles;
    if (o.dimStyles?.length) this.dimStyles = o.dimStyles;
    else if (o.settings?.dimTxt) { // archivo v1: el estilo de cota estaba en los parámetros
      const s = o.settings;
      this.dimStyles = [{ ...DEFAULT_DIMSTYLE, txt: s.dimTxt, asz: s.dimAsz, exo: s.dimExo, exe: s.dimExe, gap: s.dimGap, dec: s.dimDec }];
    }
    this.constraints = o.constraints || [];
    this.params = o.params || [];
    this.groups = o.groups || [];
    this.layerStates = o.layerStates || [];
    this.patterns = o.patterns || {};
    this.plotStyles = o.plotStyles || {};
    this.ucs = o.ucs || null;
    this.ucsList = o.ucsList || [];
    this.views = o.views || [];
    this.vportConfigs = o.vportConfigs || [];
    this.selFilters = o.selFilters || [];
    this.layerFilters = o.layerFilters || [];
    this.layIso = o.layIso || null;
    this.scales = o.scales?.length ? o.scales : defaultScales();
    this.origin = o.origin ? { x: +o.origin.x || 0, y: +o.origin.y || 0 } : { x: 0, y: 0 };
    this.tiles = o.tiles || null;
    if (o.mleaderStyles?.length) this.mleaderStyles = o.mleaderStyles;
    if (o.tableStyles?.length) this.tableStyles = o.tableStyles;
    if (o.mlineStyles?.length) this.mlineStyles = o.mlineStyles;
    this.cur = { ...this.cur, ...o.cur };
    this.settings = { ...DEFAULT_SETTINGS, ...o.settings };
    this.reindex();
    this.nextId = o.nextId || Math.max(0, ...this.byId.keys()) + 1;
    this.name = o.name || this.name;
    this.dirty = false;
    this.emit('reset');
  }
}
