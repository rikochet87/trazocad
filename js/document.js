// Documento: capas, espacio modelo, presentaciones, bloques, estilos, grupos, estados de capa, patrones,
// deshacer/rehacer, sombreados asociativos y serialización.
import { bboxOf, bbUnion, cloneEnt, LTYPES, DEFAULT_DIMSTYLE, DEFAULT_MLSTYLE, DEFAULT_TBLSTYLE } from './entities.js';
import { assocLoops } from './hatch.js';
import { updateDim, updateCenter, centerRefs, dropMissing, dimRefIds } from './assoc.js';
import { remapDyn } from './dynblock.js';
import { solve, consValid, refIds } from './constraints.js';
import { cleanGroups } from './groups.js';
import { DEFAULT_MLINESTYLE } from './mline.js';
import { localPath, pathable } from './arrays.js';

export const DEFAULT_SETTINGS = {
  gridX: 10, snapX: 10, polarInc: 15, ltscale: 1, coordDec: 4,
  textH: 2.5, filletR: 0, chamferA: 0, chamferB: 0, offsetD: 10, lastRadius: 10, polySides: 4,
  hatchPat: 'ANSI31', hatchScale: 1, hatchAng: 0, hatchAssoc: true, iso: false, isoPlane: 'top', splineMethod: 'fit',
  dimAssoc: true, mleaderContent: 'mtext', balloonNum: 0, insBase: { x: 0, y: 0 },
  mlScale: 20, mlJust: 'top', arrayAssoc: true, xclipFrame: 2, wipeoutFrame: 2, boundaryType: 'pline', boundaryIslands: true, revcloud: 5,
};
const newMlStyle = () => JSON.parse(JSON.stringify(DEFAULT_MLINESTYLE));
export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Carta: [279.4, 215.9], Oficio: [355.6, 215.9] };

const newLayer = (name, color = '#ffffff') => ({ name, color, ltype: 'CONTINUOUS', lw: 'DEFAULT', on: true, lock: false });

export class Doc {
  constructor() { this.listeners = []; this.ver = 0; this.reset(); }

  on(fn) { this.listeners.push(fn); }
  emit(kind) { for (const f of this.listeners) f(kind); }

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
    this.ver++;
    this.emit('reset');
  }

  // Entidades del espacio activo (modelo, papel de la presentación activa o editor de bloques)
  get ents() {
    if (this.space === 'bedit') return this.bedit?.ents || this.model;
    return this.space === 'model' ? this.model : (this.layouts[this.space]?.ents || this.model);
  }
  *allEnts() { yield* this.model; for (const l of this.layouts) yield* l.ents; if (this.bedit) yield* this.bedit.ents; }
  layout() { return this.space === 'model' || this.space === 'bedit' ? null : this.layouts[this.space]; }

  // ----- Deshacer / rehacer por instantáneas -----
  state() {
    return JSON.stringify({ layers: this.layers, model: this.model, layouts: this.layouts, blocks: this.blocks, textStyles: this.textStyles, dimStyles: this.dimStyles, mleaderStyles: this.mleaderStyles, tableStyles: this.tableStyles, mlineStyles: this.mlineStyles, nextId: this.nextId, cur: this.cur, bedit: this.bedit, constraints: this.constraints, params: this.params, groups: this.groups, layerStates: this.layerStates, patterns: this.patterns });
  }
  loadState(s) {
    const o = JSON.parse(s);
    Object.assign(this, { layers: o.layers, model: o.model, layouts: o.layouts, blocks: o.blocks, textStyles: o.textStyles, dimStyles: o.dimStyles, mleaderStyles: o.mleaderStyles, tableStyles: o.tableStyles, mlineStyles: o.mlineStyles?.length ? o.mlineStyles : [newMlStyle()], nextId: o.nextId, cur: o.cur, bedit: o.bedit || null, constraints: o.constraints || [], params: o.params || [], groups: o.groups || [], layerStates: o.layerStates || [], patterns: o.patterns || {} });
    if (this.bedit) this.space = 'bedit';
    else if (this.space === 'bedit') this.space = 'model';
    else if (this.space !== 'model' && this.space !== 'bedit' && !this.layouts[this.space]) this.space = 'model';
    this.reindex();
  }
  reindex() { this.byId = new Map([...this.allEnts()].map(e => [e.id, e])); this.ver++; }
  begin() { if (this.tx) { this.tx.depth++; return; } this.tx = { snap: this.state(), depth: 1 }; }
  commit() {
    if (!this.tx || --this.tx.depth > 0) return;
    this.syncConstraints();
    this.syncAssoc();
    cleanGroups(this);
    const s = this.tx.snap;
    this.tx = null;
    if (s !== this.state()) {
      this.undoS.push(s);
      if (this.undoS.length > 200) this.undoS.shift();
      this.redoS = [];
      this.dirty = true;
      this.emit('commit');
    }
  }
  undo() {
    if (!this.undoS.length) return false;
    this.redoS.push(this.state()); this.loadState(this.undoS.pop()); this.touched.clear();
    this.dirty = true; this.emit('change'); return true;
  }
  redo() {
    if (!this.redoS.length) return false;
    this.undoS.push(this.state()); this.loadState(this.redoS.pop()); this.touched.clear();
    this.dirty = true; this.emit('change'); return true;
  }

  // ----- Entidades -----
  add(e, target = this.ents) {
    e.id = this.nextId++;
    e.layer ??= this.cur.layer; e.color ??= this.cur.color; e.ltype ??= this.cur.ltype; e.lw ??= this.cur.lw;
    if (e.type === 'text') e.style ??= this.cur.textStyle;
    if (e.type === 'dim') e.style ??= this.cur.dimStyle;
    if (!this.layers.some(l => l.name === e.layer)) e.layer = '0';
    if (e.type === 'mtext' || e.type === 'attdef') e.style ??= this.cur.textStyle;
    target.push(e); this.byId.set(e.id, e);
    this.touched.add(e.id);
    this.changed();
    return e;
  }
  get(id) { return this.byId.get(id); }
  remove(id) {
    const e = this.byId.get(id);
    if (!e) return;
    for (const arr of this.lists()) {
      const i = arr.indexOf(e);
      if (i >= 0) { arr.splice(i, 1); break; }
    }
    this.byId.delete(id);
    this.touched.add(id);
    this.changed();
  }
  modify(id, fn) { const e = this.byId.get(id); if (e) { fn(e); this.touched.add(id); this.changed(); } return e; }

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
    for (const arr of this.lists()) {
      for (const h of arr) {
        const moved = h._xf;
        if (moved) delete h._xf;
        if (h.type === 'array' && h.pathId != null) { // matriz a lo largo de un recorrido: sigue al objeto del recorrido
          const src = get(h.pathId);
          if (!src || !pathable(src)) delete h.pathId;
          else if (t.has(h.pathId)) h.path = localPath(h, src);
          else if (moved) delete h.pathId; // la matriz se movió sin su recorrido
          continue;
        }
        if (!h.assoc) continue;
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
  changed() { this.ver++; this.dirty = true; this.emit('change'); }

  // ----- Capas, estilos y bloques -----
  layer(name) { return this.layers.find(l => l.name === name) || this.layers[0]; }
  addLayer(name, color) { const l = newLayer(name, color); this.layers.push(l); this.changed(); return l; }
  ensureLayer(name, color) { return this.layers.find(l => l.name === name) || this.addLayer(name, color); }
  visible(e) {
    if (!this.layer(e.layer).on) return false;
    const vp = this.activeVp != null ? this.byId.get(this.activeVp) : null;
    return !vp?.frozen?.includes(e.layer);
  }
  // Visibilidad dentro de una ventana gráfica concreta (capas activadas y no inutilizadas en ella)
  visibleIn(vp) { return e => this.layer(e.layer).on && !vp.frozen?.includes(e.layer); }
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
      app: 'TrazoCAD', version: 9, name: this.name, layers: this.layers, model: this.model, layouts: this.layouts, blocks: this.blocks,
      textStyles: this.textStyles, dimStyles: this.dimStyles, mleaderStyles: this.mleaderStyles, tableStyles: this.tableStyles, mlineStyles: this.mlineStyles, constraints: this.constraints, params: this.params, groups: this.groups, layerStates: this.layerStates, patterns: this.patterns, cur: this.cur, settings: this.settings, nextId: this.nextId,
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
