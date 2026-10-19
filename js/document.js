// Documento: capas, espacio modelo, presentaciones, bloques, estilos, deshacer/rehacer, sombreados asociativos y serialización.
import { bboxOf, bbUnion, LTYPES, DEFAULT_DIMSTYLE } from './entities.js';
import { assocLoops } from './hatch.js';

export const DEFAULT_SETTINGS = {
  gridX: 10, snapX: 10, polarInc: 15, ltscale: 1, coordDec: 4,
  textH: 2.5, filletR: 0, chamferA: 0, chamferB: 0, offsetD: 10, lastRadius: 10, polySides: 4,
  hatchPat: 'ANSI31', hatchScale: 1, hatchAng: 0, hatchAssoc: true, iso: false, isoPlane: 'top', splineMethod: 'fit',
};
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
    this.space = 'model';
    this.textStyles = [{ name: 'Standard', font: 'Arial', width: 1, oblique: 0 }];
    this.dimStyles = [{ ...DEFAULT_DIMSTYLE }];
    this.byId = new Map();
    this.nextId = 1;
    this.cur = { layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', textStyle: 'Standard', dimStyle: 'ISO-25' };
    this.settings = { ...DEFAULT_SETTINGS };
    this.undoS = []; this.redoS = []; this.tx = null;
    this.touched = new Set(); // entidades añadidas, modificadas o borradas en la transacción
    this.activeVp = null;     // ventana gráfica por la que se trabaja (MSPACE): sus capas inutilizadas no se ven
    this.dirty = false;
    this.name = 'Dibujo1';
    this.ver++;
    this.emit('reset');
  }

  // Entidades del espacio activo (modelo o papel de la presentación activa)
  get ents() { return this.space === 'model' ? this.model : (this.layouts[this.space]?.ents || this.model); }
  *allEnts() { yield* this.model; for (const l of this.layouts) yield* l.ents; }
  layout() { return this.space === 'model' ? null : this.layouts[this.space]; }

  // ----- Deshacer / rehacer por instantáneas -----
  state() {
    return JSON.stringify({ layers: this.layers, model: this.model, layouts: this.layouts, blocks: this.blocks, textStyles: this.textStyles, dimStyles: this.dimStyles, nextId: this.nextId, cur: this.cur });
  }
  loadState(s) {
    const o = JSON.parse(s);
    Object.assign(this, { layers: o.layers, model: o.model, layouts: o.layouts, blocks: o.blocks, textStyles: o.textStyles, dimStyles: o.dimStyles, nextId: o.nextId, cur: o.cur });
    if (this.space !== 'model' && !this.layouts[this.space]) this.space = 'model';
    this.reindex();
  }
  reindex() { this.byId = new Map([...this.allEnts()].map(e => [e.id, e])); this.ver++; }
  begin() { if (this.tx) { this.tx.depth++; return; } this.tx = { snap: this.state(), depth: 1 }; }
  commit() {
    if (!this.tx || --this.tx.depth > 0) return;
    this.syncAssoc();
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
    for (const arr of [this.model, ...this.layouts.map(l => l.ents)]) {
      const i = arr.indexOf(e);
      if (i >= 0) { arr.splice(i, 1); break; }
    }
    this.byId.delete(id);
    this.touched.add(id);
    this.changed();
  }
  modify(id, fn) { const e = this.byId.get(id); if (e) { fn(e); this.touched.add(id); this.changed(); } return e; }

  // Sombreados asociativos: si cambió alguna entidad de su contorno se recalculan; si el contorno se borró,
  // o el sombreado se movió sin su contorno, dejan de ser asociativos.
  syncAssoc() {
    const t = this.touched;
    this.touched = new Set();
    if (!t.size) return;
    const drop = h => { delete h.assoc; delete h.seed; };
    for (const arr of [this.model, ...this.layouts.map(l => l.ents)]) {
      for (const h of arr) {
        if (h.type !== 'hatch') continue;
        const moved = h._xf;
        delete h._xf;
        if (!h.assoc) continue;
        const srcs = h.assoc.map(id => this.byId.get(id));
        if (srcs.some(x => !x)) { drop(h); continue; }
        if (!h.assoc.some(id => t.has(id))) { if (moved) drop(h); continue; }
        const r = assocLoops(h, srcs);
        if (!r) { drop(h); continue; }
        h.loops = [...r.loops]; h.assoc = r.ids;
        if (r.seed) h.seed = r.seed;
      }
    }
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
  defineBlock(name, base, ents) {
    const old = this.blocks[name];
    this.blocks[name] = { name, base, ents, ver: (old?.ver || 0) + 1 };
    this.changed();
  }
  // ¿Las entidades (o los bloques que insertan, recursivamente) hacen referencia al bloque `target`?
  refersTo(ents, target, seen = new Set()) {
    for (const e of ents) {
      if (e.type !== 'insert') continue;
      if (e.name === target) return true;
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      if (this.blocks[e.name] && this.refersTo(this.blocks[e.name].ents, target, seen)) return true;
    }
    return false;
  }
  blockInUse(name) { return this.refersTo([...this.allEnts()], name) || Object.values(this.blocks).some(b => b.name !== name && this.refersTo(b.ents, name)); }
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
      app: 'TrazoCAD', version: 3, name: this.name, layers: this.layers, model: this.model, layouts: this.layouts, blocks: this.blocks,
      textStyles: this.textStyles, dimStyles: this.dimStyles, cur: this.cur, settings: this.settings, nextId: this.nextId,
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
    this.cur = { ...this.cur, ...o.cur };
    this.settings = { ...DEFAULT_SETTINGS, ...o.settings };
    this.reindex();
    this.nextId = o.nextId || Math.max(0, ...this.byId.keys()) + 1;
    this.name = o.name || this.name;
    this.dirty = false;
    this.emit('reset');
  }
}
