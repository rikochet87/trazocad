// Núcleo de la aplicación: estado, entrada (ratón, táctil, teclado), motor de comandos y peticiones de datos.
import * as G from './geom.js';
import { Doc } from './document.js';
import { View, VpView } from './view.js';
import { SpatialIndex } from './spatial.js';
import { Renderer } from './render.js';
import { Snapper } from './snap.js';
import { ENV, hitDist, inWindow, crosses, gripsOf, STD_SCALES, scaleLabel, blockAttdefs, tableCellAt } from './entities.js';
import { findCmd, suggest } from './commands.js';
import { UI } from './ui.js';
import { IO } from './io.js';
import './dynblock.js'; // registra los bloques dinámicos
import './arrays.js'; // registra las matrices asociativas
import { parseExpr, evalParams } from './constraints.js';
import { PAT_ENV } from './patterns.js';
import { expandGroups } from './groups.js';

const CANCEL = Symbol('cancel');
const PICKBOX = 6;
const PREFS_KEY = 'trazocad.prefs';
const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const TOGGLE_NAMES = { grid: 'Rejilla', snap: 'Forzcursor', ortho: 'Orto', polar: 'Polar', osnap: 'Refent', otrack: 'Rastreo', dyn: 'Entrada dinámica', lwt: 'Grosor de línea', groups: 'Selección de grupos' };

class App {
  constructor() {
    this.doc = new Doc();
    ENV.doc = this.doc;
    PAT_ENV.doc = this.doc;
    this.view = this.modelView = new View();
    this.layoutViews = new WeakMap();
    this.spatial = new SpatialIndex();
    this.tab = 'model'; this.vpActive = null;
    this.T = { grid: true, snap: false, ortho: false, polar: true, osnap: true, otrack: true, dyn: true, lwt: false, groups: true };
    this.osnapModes = { end: true, mid: true, cen: true, qua: true, int: true, per: true, nea: false, nod: true, ins: true };
    this.loadPrefs();

    this.sel = new Set(); this.hover = null; this.hoverGrip = null;
    this.req = null; this.cmd = null; this.cmdPromise = null; this.cancelFlag = false;
    this.lastCmd = null; this.lastPt = G.P(0, 0); this.lastRef = null; this.pickfirst = null; this.lastWindow = null; this.clipboard = null;
    this.mouse = { sx: 0, sy: 0, w: G.P(0, 0), pt: G.P(0, 0), snap: null, track: null, polar: null, inside: false };
    this.win = null; this.acquired = []; this.acqTimer = null; this.acqCand = null;
    this.ptrs = new Map(); this.panning = null; this.pinch = null; this.tap = null; this.touchMode = false; this.lastMid = 0;
    this.cmdHist = []; this.histIdx = -1; this.sugList = []; this.sugIdx = 0;

    this.base = document.getElementById('cv-base');
    this.over = document.getElementById('cv-over');
    this.input = document.getElementById('cmd-input');
    this.renderer = new Renderer(this, this.base, this.over);
    this.snapper = new Snapper(this);
    this.ui = new UI(this);
    this.io = new IO(this);
    this.ui.build();
    this.doc.on(kind => this.onDocChange(kind));
    this.bindEvents();
    this.renderer.resize();
    this.ui.setPrompt(null);
    this.print('TrazoCAD listo. Escriba un comando (p. ej. L para LÍNEA) o pulse F1 para ver la ayuda.');
    if (!/[?&]nuevo/.test(location.search) && this.io.restore()) { this.afterLoad(); this.print('Se ha recuperado el dibujo autoguardado.'); }
    this.ui.updateStatus();
    this.ui.refresh();
  }

  // ---------- Preferencias ----------
  loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      Object.assign(this.T, p.T || {});
      Object.assign(this.osnapModes, p.osnap || {});
    } catch { /* preferencias por defecto */ }
  }
  savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ T: this.T, osnap: this.osnapModes })); } catch { /* sin almacenamiento */ }
  }

  // ---------- Estado ----------
  onDocChange(kind) {
    if (kind === 'reset') { this.sel.clear(); this.beditView = null; if (this.tab !== 'model' || this.vpActive || this.view !== this.modelView) { this.tab = 'model'; this.vpActive = null; this.doc.activeVp = null; this.view = this.modelView; } }
    if (kind === 'constraint-fail') this.print('Aviso: las restricciones no se pueden cumplir con esta modificación (están en conflicto o la geometría no lo permite).', 'err');
    for (const id of this.sel) if (!this.doc.get(id)) this.sel.delete(id);
    this.renderer.invalidate();
    this.ui.refresh();
  }
  styleFor(e) {
    const st = this.doc.style(e), paper = this.tab !== 'model';
    const color = paper && st.color.toLowerCase() === '#ffffff' ? '#000000' : st.color;
    const px = this.T.lwt ? Math.max(1, st.lw * (paper ? this.paperView.scale : 4)) : 1;
    return { color, px, pat: st.pat, ltscale: this.doc.settings.ltscale, paper };
  }
  idx() { return this.spatial.of(this.doc.ents, this.doc.ver); }
  layoutShown() { return this.tab === 'model' ? null : this.doc.layouts[this.tab] || null; }
  get paperView() {
    const lay = this.layoutShown();
    if (!lay) return this.modelView;
    let v = this.layoutViews.get(lay);
    if (!v) {
      v = new View(); v.w = this.modelView.w; v.h = this.modelView.h;
      v.fit({ x1: -5, y1: -5, x2: lay.w + 5, y2: lay.h + 5 }, 0.03);
      this.layoutViews.set(lay, v);
    }
    return v;
  }
  setViewSize(w, h) {
    this.modelView.w = w; this.modelView.h = h;
    if (this.beditView) { this.beditView.w = w; this.beditView.h = h; }
    if (this.layoutShown()) { const v = this.paperView; v.w = w; v.h = h; }
  }

  // ---------- Presentaciones y ventanas gráficas ----------
  // ---------- Editor de bloques ----------
  enterBedit(name) {
    if (this.tab !== 'model') this.switchTab('model');
    this.doc.openBedit(name);
    this.syncBedit();
    const b = this.doc.extents(this.doc.ents);
    if (b) this.view.fit(G.normRect({ x: Math.min(b.x1, this.doc.bedit.base.x), y: Math.min(b.y1, this.doc.bedit.base.y) }, { x: Math.max(b.x2, this.doc.bedit.base.x), y: Math.max(b.y2, this.doc.bedit.base.y) }));
    this.print(`Editor de bloques: "${name}". Edite los objetos con cualquier comando; BASE cambia el punto base, BSAVE guarda y BCLOSE cierra el editor.`);
  }
  // Ajusta la vista al estado del documento (al abrir/cerrar el editor o al deshacer)
  syncBedit() {
    const doc = this.doc;
    if (doc.bedit && this.view !== this.beditView) {
      this.beditView = new View(); this.beditView.w = this.modelView.w; this.beditView.h = this.modelView.h;
      Object.assign(this.beditView, { cx: this.modelView.cx, cy: this.modelView.cy, scale: this.modelView.scale });
      this.view = this.beditView; this.tab = 'model'; this.vpActive = null; doc.activeVp = null;
    } else if (!doc.bedit && this.beditView) {
      this.beditView = null;
      this.view = this.tab === 'model' ? this.modelView : this.paperView;
      if (doc.space !== 'model' && doc.layouts[doc.space]) { this.tab = doc.space; this.view = this.paperView; }
    } else return;
    this.sel.clear(); this.acquired = []; this.hover = null;
    this.renderer.invalidate(); this.ui.refresh(); this.ui.updateStatus();
  }
  switchTab(t) {
    if (this.doc.bedit) { this.print('Cierre primero el editor de bloques (BCLOSE).'); return; }
    if (t !== 'model' && !this.doc.layouts[t]) t = 'model';
    if (this.cmdPromise) this.cancelCurrent();
    this.tab = t; this.vpActive = null; this.doc.activeVp = null;
    this.doc.space = t === 'model' ? 'model' : t;
    this.view = t === 'model' ? this.modelView : this.paperView;
    this.setViewSize(this.modelView.w, this.modelView.h);
    this.sel.clear(); this.acquired = []; this.hover = null;
    this.renderer.invalidate();
    this.ui.refresh(); this.ui.updateStatus();
  }
  mspace(vp) {
    if (this.tab === 'model') return this.print('Ya está en el espacio modelo.');
    const ents = this.doc.layouts[this.tab].ents;
    vp = vp || ents.find(e => e.type === 'vport' && this.doc.visible(e)) || ents.find(e => e.type === 'vport');
    if (!vp) return this.print('La presentación no tiene ventanas gráficas. Cree una con MVIEW.');
    this.vpActive = vp.id; this.doc.activeVp = vp.id;
    this.doc.space = 'model';
    this.view = new VpView(this.paperView, vp);
    this.sel.clear(); this.acquired = [];
    this.renderer.invalidate(); this.ui.refresh(); this.ui.updateStatus();
  }
  pspace() {
    if (this.tab === 'model' || !this.vpActive) return;
    this.vpActive = null; this.doc.activeVp = null;
    this.doc.space = this.tab;
    this.view = this.paperView;
    this.sel.clear(); this.acquired = [];
    this.renderer.invalidate(); this.ui.refresh(); this.ui.updateStatus();
  }
  // Escala estándar más grande con la que las extensiones del modelo caben en el rectángulo
  fitScale(rc, b) {
    if (!b) return 1;
    const s = Math.min((rc.x2 - rc.x1) / Math.max(b.x2 - b.x1, 1e-9), (rc.y2 - rc.y1) / Math.max(b.y2 - b.y1, 1e-9)) * 0.92;
    return STD_SCALES.map(x => x[1]).sort((a, c) => c - a).find(v => v <= s) || s;
  }
  addViewport(rc, layoutIdx = this.tab) {
    const doc = this.doc, lay = doc.layouts[layoutIdx], b = doc.extents(doc.model.filter(e => doc.visible(e)));
    doc.ensureLayer('Ventanas', '#808080');
    const s = this.fitScale(rc, b);
    const vp = doc.add({ type: 'vport', p1: G.P(rc.x1, rc.y1), p2: G.P(rc.x2, rc.y2), cx: b ? (b.x1 + b.x2) / 2 : 0, cy: b ? (b.y1 + b.y2) / 2 : 0, s, layer: 'Ventanas', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER' }, lay.ents);
    return { ...vp, label: scaleLabel(s) };
  }
  // Bloque del cajetín (140 × 24 mm, punto base en la esquina inferior izquierda) con atributos editables
  ensureTitleBlock() {
    const doc = this.doc, name = 'CAJETIN';
    if (doc.blocks[name]) return name;
    const P = G.P, tw = 140, th = 24, small = 1.8;
    const base = { layer: '0', color: 'BYBLOCK', ltype: 'BYBLOCK', lw: 'BYBLOCK' };
    const label = (x, y, text) => ({ ...base, type: 'text', p: P(x, y), h: small, rot: 0, text, style: 'Standard' });
    const att = (x, y, h, tag, prompt, def) => ({ ...base, type: 'attdef', p: P(x, y), h, rot: 0, align: 'l', tag, prompt, def, style: 'Standard' });
    doc.defineBlock(name, P(0, 0), [
      { ...base, type: 'pline', pts: [P(0, 0), P(tw, 0), P(tw, th), P(0, th)], closed: true, lw: 0.35 },
      { ...base, type: 'line', p1: P(0, th / 2), p2: P(tw, th / 2) },
      { ...base, type: 'line', p1: P(tw * 0.62, 0), p2: P(tw * 0.62, th / 2) },
      { ...base, type: 'line', p1: P(tw * 0.81, 0), p2: P(tw * 0.81, th / 2) },
      label(2, th - 3.2, 'TÍTULO'), label(2, th / 2 - 3.2, 'PRESENTACIÓN'),
      label(tw * 0.62 + 2, th / 2 - 3.2, 'ESCALA'), label(tw * 0.81 + 2, th / 2 - 3.2, 'FECHA'),
      att(2, th / 2 + 2.5, 4, 'TITULO', 'Título del plano', 'Dibujo'),
      att(2, 3, 3, 'PRESENTACION', 'Nombre de la presentación', ''),
      att(tw * 0.62 + 2, 3, 3, 'ESCALA', 'Escala', '1:1'),
      att(tw * 0.81 + 2, 3, 2.6, 'FECHA', 'Fecha', ''),
    ]);
    return name;
  }
  // Nueva presentación con marco, cajetín (bloque con atributos) y una ventana gráfica ajustada al modelo
  createLayout(name, paper = 'A4') {
    const doc = this.doc, lay = doc.addLayout(name, paper), idx = doc.layouts.length - 1, W = lay.w, H = lay.h, m = 10;
    const P = G.P, add = e => doc.add({ layer: '0', color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', ...e }, lay.ents);
    add({ type: 'pline', pts: [P(m, m), P(W - m, m), P(W - m, H - m), P(m, H - m)], closed: true, lw: 0.5 });
    const tw = 140, th = 24, tx = W - m - tw, ty = m;
    const vp = this.addViewport({ x1: m + 4, y1: ty + th + 4, x2: W - m - 4, y2: H - m - 4 }, idx);
    add({ type: 'insert', name: this.ensureTitleBlock(), p: P(tx, ty), sx: 1, sy: 1, rot: 0,
      attribs: { TITULO: '%<Archivo>%', PRESENTACION: '%<Presentación>%', ESCALA: '%<Escala>%', FECHA: '%<Fecha>%' } }); // campos: se actualizan solos
    this.switchTab(idx);
    this.print(`Presentación "${name}" creada (${paper}, ventana a escala ${vp.label}). Doble clic dentro de la ventana para trabajar en el modelo; doble clic en el cajetín para editar sus datos.`);
    return lay;
  }
  deleteLayout(i) {
    const doc = this.doc, lay = doc.layouts[i];
    if (!lay) return;
    doc.begin();
    doc.layouts.splice(i, 1);
    doc.reindex();
    doc.changed();
    doc.commit();
    this.switchTab('model');
    this.print(`Presentación "${lay.name}" eliminada.`);
  }
  toggleIso() {
    const S = this.doc.settings;
    S.iso = !S.iso;
    this.print(S.iso ? `<Isométrico activado, plano ${{ top: 'superior', left: 'izquierdo', right: 'derecho' }[S.isoPlane]} (F5 cambia de plano)>` : '<Isométrico desactivado>');
    this.ui.updateStatus(); this.updateMouse(); this.renderer.invalidate();
  }
  cycleIsoPlane() {
    const S = this.doc.settings, order = ['left', 'top', 'right'];
    S.isoPlane = order[(order.indexOf(S.isoPlane) + 1) % 3];
    this.print(`<Plano isométrico ${{ top: 'superior', left: 'izquierdo', right: 'derecho' }[S.isoPlane]}>`);
    this.ui.updateStatus(); this.updateMouse(); this.renderer.invalidate();
  }
  afterUndo() {
    this.syncBedit();
    if (this.doc.bedit) { this.ui.updateStatus(); return; }
    this.doc.activeVp = this.vpActive;
    if (this.tab !== 'model' && !this.doc.layouts[this.tab]) this.switchTab('model');
    else if (this.vpActive && !this.doc.get(this.vpActive)) this.pspace();
    else if (this.vpActive) this.view = new VpView(this.paperView, this.doc.get(this.vpActive));
    else if (this.tab !== 'model') this.view = this.paperView;
    this.ui.updateStatus();
  }
  curStyle() { const c = this.doc.cur; return this.styleFor({ layer: c.layer, color: c.color, ltype: c.ltype, lw: c.lw }); }
  print(msg, cls) { this.ui.print(msg, cls); }
  selChanged() { this.renderer.invalidate(false); this.ui.refresh(); }
  clearSel() { this.sel.clear(); this.selChanged(); }
  selectAll() {
    const set = this.req?.kind === 'select' ? this.req.set : this.req ? null : this.sel;
    if (!set) return;
    let n = 0;
    for (const e of this.doc.ents) if (this.doc.visible(e) && !this.doc.locked(e)) { set.add(e.id); n++; }
    this.print(`${n} encontrados`);
    this.selChanged();
  }
  toggle(k) {
    if (k === 'iso') return this.toggleIso();
    this.T[k] = !this.T[k];
    if (k === 'ortho' && this.T.ortho) this.T.polar = false;
    if (k === 'polar' && this.T.polar) this.T.ortho = false;
    if (k === 'otrack' && !this.T.otrack) this.acquired = [];
    this.print(`<${TOGGLE_NAMES[k]} ${this.T[k] ? 'activado' : 'desactivado'}>`);
    this.savePrefs();
    this.ui.updateStatus();
    this.updateMouse();
    this.renderer.invalidate();
  }
  zoomExtents() {
    const lay = this.layoutShown();
    this.view.push();
    if (lay && !this.vpActive) { this.view.fit({ x1: -5, y1: -5, x2: lay.w + 5, y2: lay.h + 5 }, 0.03); this.renderer.invalidate(); return; }
    const b = this.doc.extents(this.doc.ents.filter(e => this.doc.visible(e)));
    if (b) this.view.fit(b); else { this.view.cx = 210; this.view.cy = 148.5; this.view.scale = Math.min(this.view.w / 460, this.view.h / 330); }
    this.renderer.invalidate();
  }
  afterLoad() {
    this.switchTab('model');
    this.sel.clear();
    this.zoomExtents();
    this.ui.refresh();
    this.ui.updateTitle();
  }

  // ---------- Eventos ----------
  bindEvents() {
    const o = this.over;
    new ResizeObserver(() => this.renderer.resize()).observe(this.base.parentElement);
    o.addEventListener('pointerdown', e => this.onDown(e));
    o.addEventListener('pointermove', e => this.onMove(e));
    o.addEventListener('pointerup', e => this.onUp(e));
    o.addEventListener('pointercancel', e => this.onUp(e, true));
    o.addEventListener('pointerenter', () => { this.mouse.inside = true; });
    o.addEventListener('pointerleave', () => { this.mouse.inside = false; this.hover = null; this.renderer.invalidate(false); this.ui.updateTips(); });
    o.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    o.addEventListener('contextmenu', e => this.onContext(e));
    o.addEventListener('dblclick', e => this.onDbl(e));
    document.addEventListener('keydown', e => this.onKey(e));
    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('blur', () => setTimeout(() => { this.sugList = []; this.ui.showSuggest([]); }, 120));
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctxmenu')) this.ui.hideMenu(); }, true);

    const vp = document.getElementById('viewport');
    vp.addEventListener('dragover', e => { e.preventDefault(); vp.classList.add('drop'); });
    vp.addEventListener('dragleave', () => vp.classList.remove('drop'));
    vp.addEventListener('drop', async e => {
      e.preventDefault(); vp.classList.remove('drop');
      const f = e.dataTransfer.files[0];
      if (f && (await this.io.confirmDiscard())) this.io.loadFile(f);
    });

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      const b = document.getElementById('btn-install');
      b.hidden = false;
      b.onclick = async () => { b.hidden = true; e.prompt(); await e.userChoice; };
    });
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async p => {
        if (p.files?.length) { const f = await p.files[0].getFile(); this.io.loadFile(f, /\.tcad$/i.test(f.name) ? p.files[0] : null); }
      });
    }
  }

  screenOf(e) { const r = this.over.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  onDown(e) {
    this.ui.hideMenu();
    this.touchMode = e.pointerType === 'touch';
    try { this.over.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d: G.dist(a, b) || 1, c: G.mid(a, b) };
      this.tap = null; this.panning = null;
      if (this.win && !this.win.dragged) this.win = null;
      return;
    }
    if (e.button === 1 || (e.button === 0 && this.req?.kind === 'pan')) {
      e.preventDefault();
      const now = performance.now();
      if (e.button === 1 && now - this.lastMid < 350) this.zoomExtents();
      this.lastMid = now;
      this.panning = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    this.mouse.inside = true;
    if (this.touchMode) { this.tap = { x: e.clientX, y: e.clientY }; return; }
    this.updateMouse(e);
    this.leftClick(e);
  }

  onMove(e) {
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()], d = G.dist(a, b) || 1, c = G.mid(a, b), r = this.over.getBoundingClientRect();
      this.view.panBy(c.x - this.pinch.c.x, c.y - this.pinch.c.y);
      this.view.zoomAt(d / this.pinch.d, { x: c.x - r.left, y: c.y - r.top });
      this.pinch = { d, c };
      this.renderer.invalidate();
      return;
    }
    if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 8) { this.panning = { ...this.tap }; this.tap = null; }
    if (this.panning) {
      this.view.panBy(e.clientX - this.panning.x, e.clientY - this.panning.y);
      this.panning = { x: e.clientX, y: e.clientY };
      this.renderer.invalidate();
    }
    this.mouse.inside = true;
    this.updateMouse(e);
    if (this.win && !this.win.dragged && (e.buttons & 1) && Math.hypot(this.mouse.sx - this.win.s.x, this.mouse.sy - this.win.s.y) > 5) this.win.dragged = true;
    this.renderer.invalidate(false);
    this.ui.updateTips();
  }

  onUp(e, cancelled) {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (this.ptrs.size === 0) this.panning = null;
    if (this.tap) {
      this.tap = null;
      if (!cancelled) { this.updateMouse(e); this.leftClick(e); }
    } else if (this.win?.dragged) { this.updateMouse(e); this.finishWindow(); }
    if (this.touchMode) { this.mouse.inside = false; this.renderer.invalidate(false); this.ui.updateTips(); }
  }

  onWheel(e) {
    e.preventDefault();
    const f = Math.exp(-Math.max(-300, Math.min(300, e.deltaY * (e.deltaMode ? 33 : 1))) * 0.0018);
    this.view.zoomAt(f, this.screenOf(e));
    this.updateMouse(e);
    this.renderer.invalidate();
    this.ui.updateTips();
  }

  onContext(e) {
    e.preventDefault();
    if (this.touchMode) return;
    if (this.win) { this.win = null; this.renderer.invalidate(false); return; }
    if (this.req) { this.submit(this.input.value); return; }
    const run = c => () => this.run(c);
    const items = this.sel.size
      ? [{ label: 'Borrar', key: 'Supr', fn: run('ERASE') }, { label: 'Desplazar', fn: run('MOVE') }, { label: 'Copiar selección', fn: run('COPY') },
        { label: 'Girar', fn: run('ROTATE') }, { label: 'Escala', fn: run('SCALE') }, { label: 'Simetría', fn: run('MIRROR') }, '-',
        { label: 'Copiar al portapapeles', key: 'Ctrl+C', fn: run('COPYCLIP') }, { label: 'Propiedades', fn: () => this.ui.showPalette('props') },
        { label: 'Deseleccionar todo', key: 'Esc', fn: () => this.clearSel() }]
      : [...(this.lastCmd ? [{ label: `Repetir ${this.lastCmd}`, key: 'Intro', fn: run(this.lastCmd) }, '-'] : []),
        { label: 'Deshacer', key: 'Ctrl+Z', fn: run('UNDO') }, { label: 'Rehacer', key: 'Ctrl+Y', fn: run('REDO') }, '-',
        { label: 'Pegar', key: 'Ctrl+V', fn: run('PASTECLIP') }, { label: 'Seleccionar todo', key: 'Ctrl+A', fn: () => this.selectAll() }, '-',
        { label: 'Zoom extensión', fn: () => this.zoomExtents() }, { label: 'Encuadre', fn: run('PAN') }, { label: 'Parámetros de dibujo…', fn: () => this.ui.openSettings() }];
    this.ui.contextMenu(e.clientX, e.clientY, items);
  }

  async onDbl(e) {
    if (this.req || this.touchMode) return;
    this.updateMouse(e);
    if (this.tab !== 'model') {
      const pp = this.paperView.toWorld({ x: this.mouse.sx, y: this.mouse.sy });
      const vp = [...this.doc.layouts[this.tab].ents].reverse().find(v => v.type === 'vport' && pp.x >= v.p1.x && pp.x <= v.p2.x && pp.y >= v.p1.y && pp.y <= v.p2.y);
      if (this.vpActive && (!vp || vp.id !== this.vpActive)) { this.pspace(); if (!vp) return; }
      if (vp && vp.id !== this.vpActive) { this.mspace(vp); return; }
    }
    // Doble clic en una cota de restricción: cambiar su valor o expresión
    const lab = (this.renderer.consLabels || []).find(l => G.pointInPoly(this.mouse.w, l.box));
    if (lab) {
      const k = lab.k, v = await this.ui.prompt(`Restricción ${k.name}`, 'Valor o expresión (puede usar otros parámetros, p. ej. d1/2)', k.expr);
      if (v === null || !v.trim()) return;
      try { parseExpr(v); } catch (err) { this.print(`Expresión no válida: ${err.message}`, 'err'); return; }
      const doc = this.doc, old = k.expr;
      doc.begin(); k.expr = v.trim(); doc.consDirty = true; doc.changed(); doc.commit();
      const { errors } = evalParams(doc);
      if (errors.has(k.name)) { doc.undo(); this.afterUndo(); this.print(`No se puede usar "${v}": ${errors.get(k.name)}. Se mantiene "${old}".`, 'err'); }
      return;
    }
    const id = this.pickId(this.mouse.sx, this.mouse.sy);
    if (!id) return;
    const ent = this.doc.get(id);
    const edit = fn => { this.doc.begin(); this.doc.modify(id, fn); this.doc.commit(); };
    if (ent.type === 'text' || ent.type === 'dim') {
      const v = await this.ui.prompt('Editar texto', ent.type === 'text' ? 'Contenido' : 'Texto de cota (<> = medida, vacío = automático)', ent.text || '');
      if (v === null || (ent.type === 'text' && !v)) return;
      edit(x => { x.text = v; });
    } else if (ent.type === 'mtext') {
      const v = await this.ui.editMText(ent, 'Editar texto de líneas múltiples');
      if (v?.text) edit(x => { x.text = v.text; if (v.rich) x.rich = true; else delete x.rich; });
    } else if (ent.type === 'mleader' && ent.content === 'mtext') {
      const v = await this.ui.editMText(ent, 'Editar texto de la directriz');
      if (v?.text) edit(x => { x.text = v.text; if (v.rich) x.rich = true; else delete x.rich; });
    } else if (ent.type === 'mleader' && ent.content === 'block') {
      const v = await this.ui.prompt('Globo', 'Texto del globo', ent.text || '');
      if (v !== null) edit(x => { x.text = v; });
    } else if (ent.type === 'table') {
      const v = await this.ui.editTable(ent, tableCellAt(ent, this.mouse.w));
      if (v) edit(x => Object.assign(x, v));
    } else if (ent.type === 'insert' && blockAttdefs(ent.name).length) {
      const v = await this.ui.editAttribs(ent);
      if (v) edit(x => { x.attribs = v; });
    } else if (ent.type === 'attdef') {
      const v = await this.ui.editAttdef(ent);
      if (v) edit(x => Object.assign(x, v));
    } else {
      this.sel.clear(); this.sel.add(id); this.selChanged(); this.ui.showPalette('props');
    }
  }

  onKey(e) {
    if (!document.getElementById('modal-root').hidden) return;
    const t = e.target, inCmd = t === this.input, k = e.key;
    const inField = !inCmd && t.matches?.('input,select,textarea');
    if (/^F\d+$/.test(k)) {
      const map = { F1: () => this.ui.openHelp(), F2: () => this.ui.showHistory(!this.ui.histOpen), F3: () => this.toggle('osnap'), F5: () => this.cycleIsoPlane(), F7: () => this.toggle('grid'), F8: () => this.toggle('ortho'), F9: () => this.toggle('snap'), F10: () => this.toggle('polar'), F11: () => this.toggle('otrack'), F12: () => this.toggle('dyn') };
      if (map[k]) { e.preventDefault(); map[k](); }
      return;
    }
    if (inField) return;
    if (e.ctrlKey || e.metaKey) {
      const kk = k.toLowerCase();
      if (kk === 'a' && e.shiftKey) { e.preventDefault(); this.toggle('groups'); return; }
      if (kk === 'a') { e.preventDefault(); this.selectAll(); return; }
      if (kk === 'e') { e.preventDefault(); this.cycleIsoPlane(); return; }
      const map = { z: 'UNDO', y: 'REDO', s: e.shiftKey ? 'SAVEAS' : 'QSAVE', o: 'OPEN', n: 'NEW', p: 'PLOT', c: 'COPYCLIP', v: 'PASTECLIP' };
      if (!map[kk]) return;
      if (inCmd && this.input.value && 'cvzy'.includes(kk)) return; // edición normal del texto
      e.preventDefault();
      this.run(map[kk]);
      return;
    }
    if (k === 'Escape') { e.preventDefault(); this.escape(); return; }
    if (k === 'Enter' || (k === ' ' && this.req?.kind !== 'string')) { e.preventDefault(); this.submit(this.input.value); return; }
    if (k === 'Delete' && !this.req && !this.input.value) { if (this.sel.size) this.run('ERASE'); return; }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      const dir = k === 'ArrowUp' ? -1 : 1;
      if (this.sugList.length) {
        this.sugIdx = (this.sugIdx + dir + this.sugList.length) % this.sugList.length;
        this.ui.showSuggest(this.sugList, this.sugIdx);
      } else if (!this.req && this.cmdHist.length) {
        this.histIdx = Math.max(0, Math.min(this.cmdHist.length, (this.histIdx < 0 ? this.cmdHist.length : this.histIdx) + dir));
        this.input.value = this.cmdHist[this.histIdx] || '';
      }
      e.preventDefault();
      return;
    }
    if (k === 'Tab' && this.sugList.length) { e.preventDefault(); this.input.value = this.sugList[this.sugIdx].name; return; }
    if (!inCmd && k.length === 1 && !e.altKey) this.input.focus({ preventScroll: true });
  }

  onInput() {
    if (!this.req) { this.sugList = suggest(this.input.value); this.sugIdx = 0; this.ui.showSuggest(this.sugList, 0); }
    this.ui.updateTips();
  }
  pickSuggestion(d) { this.input.value = ''; this.sugList = []; this.ui.showSuggest([]); this.run(d.name); }

  escape() {
    this.ui.hideMenu();
    this.sugList = []; this.ui.showSuggest([]);
    this.input.value = '';
    if (this.win) { this.win = null; this.renderer.invalidate(false); return; }
    if (this.cmdPromise) { this.cancelCurrent(); return; }
    if (this.sel.size) this.clearSel();
    this.acquired = [];
  }

  // ---------- Cursor, designación y pinzamientos ----------
  updateMouse(e) {
    const m = this.mouse;
    if (e) { const s = this.screenOf(e); m.sx = s.x; m.sy = s.y; }
    m.w = this.view.toWorld({ x: m.sx, y: m.sy });
    const req = this.req;
    if (req?.pointLike) {
      Object.assign(m, this.snapper.resolve(m, req.opts.base || req.tmpBase, req.opts.noSnap));
      this.hover = null; this.hoverGrip = null;
    } else {
      m.pt = m.w; m.snap = null; m.track = null; m.polar = null;
      const busy = this.panning || this.win || req?.kind === 'pan' || req?.kind === 'string' || req?.kind === 'number' || req?.kind === 'keyword';
      this.hover = busy ? null : this.pickId(m.sx, m.sy, req?.opts?.filter);
      this.hoverGrip = !req && !busy ? this.gripAt(m.sx, m.sy) : null;
    }
    this.ui.updateCoords(m.pt);
  }

  considerAcquire(pt) {
    if (!this.T.otrack) return;
    if (!pt) { clearTimeout(this.acqTimer); this.acqCand = null; return; }
    if (this.acqCand && G.eqPt(this.acqCand, pt, 1e-9)) return;
    this.acqCand = pt;
    clearTimeout(this.acqTimer);
    this.acqTimer = setTimeout(() => {
      if (!this.req) return;
      const i = this.acquired.findIndex(q => G.eqPt(q, pt, 1e-9));
      if (i >= 0) this.acquired.splice(i, 1);
      else { this.acquired.push(pt); if (this.acquired.length > 5) this.acquired.shift(); }
      this.renderer.invalidate(false);
    }, 450);
  }

  pickId(sx, sy, filter) {
    const w = this.view.toWorld({ x: sx, y: sy }), tol = PICKBOX / this.view.scale, doc = this.doc;
    let best = null, bd = tol;
    for (const e of this.idx().query({ x1: w.x - tol, y1: w.y - tol, x2: w.x + tol, y2: w.y + tol }, true)) {
      if (!doc.visible(e) || doc.locked(e) || (filter && !filter(e))) continue;
      const d = hitDist(e, w);
      if (d <= bd) { bd = d; best = e.id; }
    }
    return best;
  }

  gripAt(sx, sy) {
    if (!this.sel.size || this.sel.size > 300) return null;
    let pt = null;
    for (const id of this.sel) {
      const e = this.doc.get(id);
      if (!e || !this.doc.visible(e)) continue;
      for (const g of gripsOf(e)) {
        const s = this.view.toScreen(g);
        if (Math.abs(s.x - sx) <= 6 && Math.abs(s.y - sy) <= 6) { pt = g; break; }
      }
      if (pt) break;
    }
    if (!pt) return null;
    const refs = [];
    for (const id of this.sel) {
      const e = this.doc.get(id);
      if (!e || this.doc.locked(e)) continue;
      gripsOf(e).forEach((g, i) => { if (G.eqPt(g, pt, 1e-9)) refs.push({ id, i }); });
    }
    return refs.length ? { pt, refs } : null;
  }

  leftClick(e) {
    const req = this.req, m = this.mouse;
    if (this.win) { this.finishWindow(); return; }
    if (!req) {
      const g = this.gripAt(m.sx, m.sy);
      if (g) { this.run('_GRIP', g); return; }
      this.selectClick(e.shiftKey, this.sel);
      return;
    }
    switch (req.kind) {
      case 'point': case 'distance': case 'angle': this.resolvePointLike(m.pt); break;
      case 'select': this.selectClick(e.shiftKey, req.set); break;
      case 'entity': {
        const id = this.pickId(m.sx, m.sy, req.opts.filter);
        if (id) req.resolve({ e: this.doc.get(id), pt: m.w, shift: e.shiftKey });
        else this.print(req.opts.filter && this.pickId(m.sx, m.sy) ? 'El objeto designado no es válido para este comando.' : 'Ningún objeto designado.');
        break;
      }
    }
  }

  // Con la selección de grupos activada, designar un miembro designa el grupo entero
  withGroups(ids) {
    if (!this.T.groups || this.noGroupPick || !this.doc.groups.length) return new Set(ids);
    const out = expandGroups(this.doc, ids), doc = this.doc;
    if (out.size === ids.length) return out;
    const space = new Set(doc.ents.map(e => e.id)), own = new Set(ids); // sólo miembros del espacio actual, visibles y desbloqueados
    for (const id of out) { const e = doc.get(id); if (!own.has(id) && (!e || !space.has(id) || !doc.visible(e) || doc.locked(e))) out.delete(id); }
    return out;
  }
  selectClick(shift, set) {
    const m = this.mouse, id = this.pickId(m.sx, m.sy);
    if (id) {
      const ids = this.withGroups([id]);
      for (const x of ids) if (shift) set.delete(x); else set.add(x);
      if (this.req?.kind === 'select') this.print(`${ids.size} encontrado(s)${ids.size > 1 ? ' (grupo)' : ''}, ${set.size} total`);
      this.selChanged();
    } else this.win = { s: { x: m.sx, y: m.sy }, shift, set, dragged: false };
  }

  finishWindow() {
    const W = this.win, m = this.mouse;
    this.win = null;
    const a = W.s, b = { x: m.sx, y: m.sy };
    if (Math.hypot(b.x - a.x, b.y - a.y) < 3) { this.renderer.invalidate(false); return; }
    const crossing = b.x < a.x, r = G.normRect(this.view.toWorld(a), this.view.toWorld(b));
    const hit = [];
    for (const e of this.idx().query(r)) {
      if (!this.doc.visible(e) || this.doc.locked(e)) continue;
      if (crossing ? crosses(e, r) : inWindow(e, r)) hit.push(e.id);
    }
    const ids = this.withGroups(hit), n = ids.size;
    for (const id of ids) if (W.shift) W.set.delete(id); else W.set.add(id);
    this.lastWindow = { rect: r, crossing };
    if (this.req?.kind === 'select') this.print(`${n} encontrados, ${W.set.size} total`);
    this.selChanged();
  }

  resolvePointLike(pt) {
    const r = this.req;
    if (r.kind === 'point') { this.lastPt = pt; this.lastRef = this.mouse.snap?.ref || null; r.resolve(pt); return; }
    const base = r.opts.base || r.tmpBase;
    if (!base) {
      r.tmpBase = pt;
      r.prompt = 'Precise segundo punto';
      this.ui.setPrompt(r);
      this.renderer.invalidate(false);
      return;
    }
    r.resolve(r.kind === 'distance' ? G.dist(base, pt) : G.ang(base, pt));
  }

  // ---------- Peticiones de datos ----------
  ask(kind, prompt, opts = {}) {
    if (this.cancelFlag) return Promise.reject(CANCEL);
    return new Promise((resolve, reject) => {
      const r = { kind, prompt, opts, pointLike: ['point', 'distance', 'angle'].includes(kind), gripCmd: !!opts.gripCmd };
      if (kind === 'select') r.set = new Set();
      r.resolve = (v, typed) => { if (this.req !== r) return; this.req = null; this.ui.echo(r, typed); resolve(v); };
      r.reject = err => { if (this.req !== r) return; this.req = null; reject(err); };
      this.req = r;
      this.input.value = '';
      this.sugList = []; this.ui.showSuggest([]);
      this.ui.setPrompt(r);
      this.updateMouse();
      this.renderer.invalidate(false);
      this.ui.updateTips();
    });
  }

  async getSelection(prompt, o = {}) {
    if (this.pickfirst && !o.noPickfirst) {
      const ids = this.pickfirst.filter(id => this.doc.get(id));
      this.pickfirst = null;
      this.print(`${ids.length} encontrados`);
      return ids;
    }
    return this.ask('select', prompt);
  }

  makeCtx() {
    const app = this;
    return {
      app, doc: this.doc,
      get settings() { return app.doc.settings; },
      getPoint: (p, o = {}) => app.ask('point', p, o),
      getDistance: (p, o = {}) => app.ask('distance', p, o),
      getAngle: (p, o = {}) => app.ask('angle', p, o),
      getNumber: (p, o = {}) => app.ask('number', p, o),
      getString: (p, o = {}) => app.ask('string', p, o),
      getKeyword: (p, options, def) => app.ask('keyword', p, { options, def }),
      getEntity: (p, o = {}) => app.ask('entity', p, o),
      getSelection: (p = 'Designe objetos', o = {}) => app.getSelection(p, o),
      print: m => app.print(m),
      add: e => app.doc.add(e),
      // Referencia a objetos del último punto designado con el ratón (para cotas asociativas)
      ref: () => (app.doc.settings.dimAssoc ? app.lastRef : null),
      setLast: p => { app.lastPt = p; },
    };
  }

  parseNum(t) {
    t = t.trim();
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return parseFloat(t);
    if (/^[\d\s.+\-*/()]+$/.test(t) && /\d/.test(t)) { // expresiones aritméticas simples
      try { const v = Function(`"use strict";return (${t})`)(); return Number.isFinite(v) ? v : null; } catch { return null; }
    }
    return null;
  }

  parsePoint(text, base) {
    let t = text.replace(/\s+/g, ''), rel = false;
    if (t.startsWith('@')) { rel = true; t = t.slice(1); } else if (t.startsWith('#')) t = t.slice(1);
    const from = base || this.lastPt;
    if (rel && t === '') return { ...from };
    let m = t.match(/^([^<,]+)<([^<,]+)$/);
    if (m) {
      const d = this.parseNum(m[1]), a = this.parseNum(m[2]);
      if (d === null || a === null) return null;
      return G.polar(rel ? from : G.P(0, 0), G.rad(a), d);
    }
    m = t.match(/^([^,]+),([^,]+)(,[^,]+)?$/);
    if (m) {
      const x = this.parseNum(m[1]), y = this.parseNum(m[2]);
      if (x === null || y === null) return null;
      return rel ? G.P(from.x + x, from.y + y) : G.P(x, y);
    }
    const d = this.parseNum(t);
    if (d !== null && base) {
      let v = G.sub(this.mouse.pt, base);
      if (G.len(v) < 1e-12) v = G.P(1, 0);
      return G.add(base, G.mul(G.norm(v), d));
    }
    return null;
  }

  matchKw(text, options) {
    const t = strip(text);
    for (const o of options) { const caps = o.replace(/[^A-ZÁÉÍÓÚÑ0-9]/g, ''); if (caps && strip(caps) === t) return o; }
    for (const o of options) if (strip(o).startsWith(t)) return o;
    return null;
  }

  submit(raw) {
    const text = raw.trim(), r = this.req;
    this.input.value = '';
    const sug = this.sugList;
    this.sugList = []; this.ui.showSuggest([]);
    if (!r) {
      if (!text) { if (this.lastCmd) this.run(this.lastCmd); return; }
      const d = findCmd(text) || (sug.length ? sug[this.sugIdx] : null);
      if (!d || d.hidden) { this.print(`Comando desconocido "${text.toUpperCase()}". Pulse F1 para ver la ayuda.`, 'err'); return; }
      this.cmdHist.push(text); this.histIdx = -1;
      this.run(d.name);
      return;
    }
    if (r.kind === 'pan') { r.resolve(null, ''); return; }
    const o = r.opts, def = o.def, base = o.base || r.tmpBase;
    if (text && o.options && r.kind !== 'string') { const kw = this.matchKw(text, o.options); if (kw) { r.resolve(kw, text); return; } }
    const empty = () => {
      if (def !== undefined) { r.resolve(def, ''); return true; }
      if (o.allowEnter) { r.resolve(null, ''); return true; }
      return false;
    };
    switch (r.kind) {
      case 'point': {
        this.lastRef = null;
        if (!text) return void empty();
        if (o.allowNumber) { const n = this.parseNum(text); if (n !== null && !text.includes(',')) return r.resolve(n, text); }
        const p = this.parsePoint(text, base);
        if (p) { this.lastPt = p; return r.resolve(p, text); }
        return this.print('Punto no válido. Formatos: x,y · @dx,dy · @dist<ángulo · distancia', 'err');
      }
      case 'distance': {
        if (!text) return void empty();
        const v = this.parseNum(text);
        if (v !== null) return r.resolve(v, text);
        const p = this.parsePoint(text, base);
        if (p && base) return r.resolve(G.dist(base, p), text);
        return this.print('Se requiere una distancia numérica o un punto.', 'err');
      }
      case 'angle': {
        if (!text) return void empty();
        const v = this.parseNum(text);
        if (v !== null) return r.resolve(G.rad(v), text);
        const p = this.parsePoint(text, base);
        if (p && base) return r.resolve(G.ang(base, p), text);
        return this.print('Se requiere un ángulo en grados.', 'err');
      }
      case 'number': {
        if (!text) return void empty();
        let v = this.parseNum(text);
        if (v === null) return this.print('Se requiere un número.', 'err');
        if (o.int) v = Math.round(v);
        if ((o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max)) return this.print(`El valor debe estar entre ${o.min} y ${o.max}.`, 'err');
        return r.resolve(v, text);
      }
      case 'string': return r.resolve(raw === '' && def !== undefined ? def : raw, raw);
      case 'keyword': if (!text && empty()) return; return this.print('Opción no válida.', 'err');
      case 'select': {
        if (!text) return r.resolve([...r.set], '');
        if (/^(todo|t|all)$/i.test(text)) { this.selectAll(); return; }
        return this.print('Designe objetos o pulse Intro para terminar.', 'err');
      }
      case 'entity': if (!text && o.allowEnter) return r.resolve(null, ''); return this.print('Designe un objeto.', 'err');
    }
  }

  // ---------- Motor de comandos ----------
  cancelCurrent() { this.cancelFlag = true; if (this.req) this.req.reject(CANCEL); }

  async run(name, arg) {
    const d = typeof name === 'string' ? findCmd(name) : name;
    if (!d) { this.print(`Comando desconocido "${name}".`, 'err'); return; }
    if (this.cmdPromise) { this.cancelCurrent(); try { await this.cmdPromise; } catch { /* cancelado */ } }
    this.ui.hideMenu();
    this.cancelFlag = false;
    if (!d.hidden) this.print(`Comando: ${d.name}`, 'cmd');
    this.cmd = d;
    this.pickfirst = d.sel && this.sel.size ? [...this.sel] : null;
    if (d.sel || (!d.keepSel && !d.noTx)) { this.sel.clear(); this.hoverGrip = null; }
    this.selChanged();
    if (!d.hidden) this.lastCmd = d.name;
    if (!d.noTx) this.doc.begin();
    const p = (async () => {
      try { await d.fn(this.makeCtx(), arg); }
      catch (err) {
        if (err === CANCEL) this.print('*Cancelar*');
        else { console.error(err); this.print(`Error: ${err.message}`, 'err'); }
      } finally {
        if (!d.noTx) this.doc.commit();
        this.req = null; this.cmd = null; this.pickfirst = null; this.win = null;
        this.acquired = []; this.considerAcquire(null);
        this.ui.setPrompt(null);
        this.updateMouse();
        this.renderer.invalidate();
        this.ui.refresh();
        this.ui.updateTips();
      }
    })();
    this.cmdPromise = p;
    await p;
    if (this.cmdPromise === p) this.cmdPromise = null;
  }
}

window.app = new App();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker no registrado:', err));
}
