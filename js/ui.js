// Interfaz: cinta de opciones, paletas (propiedades y capas), barra de estado, línea de comandos y diálogos.
import { icon } from './icons.js';
import { CMDS } from './commands.js';
import { TYPES, LTYPES, LWEIGHTS, COLORS, FONTS, ARROWS, DEFAULT_DIMSTYLE, fmt, bboxOf, bbUnion } from './entities.js';
import { OSNAP_MODES } from './snap.js';
import { PATTERNS } from './patterns.js';
import { PAPERS } from './document.js';
import { makeRV, setWorld, paintEntity } from './render.js';
import * as G from './geom.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const RIBBON = [
  { tab: 'Inicio', groups: [
    { name: 'Dibujo', items: [['LINE', 'Línea', 'line'], ['PLINE', 'Polilínea', 'pline'], ['CIRCLE', 'Círculo', 'circle'], ['ARC', 'Arco', 'arc'], ['RECTANG', 'Rectángulo', 'rect'], ['POLYGON', 'Polígono', 'polygon'], ['ELLIPSE', 'Elipse', 'ellipse'], ['HATCH', 'Sombreado', 'hatch']] },
    { name: 'Modificar', items: [['MOVE', 'Desplazar', 'move'], ['COPY', 'Copiar', 'copy'], ['ROTATE', 'Girar', 'rotate'], ['SCALE', 'Escala', 'scale'], ['MIRROR', 'Simetría', 'mirror'], ['OFFSET', 'Desfase', 'offset'], ['TRIM', 'Recortar', 'trim'], ['EXTEND', 'Alargar', 'extend'], ['FILLET', 'Empalme', 'fillet'], ['CHAMFER', 'Chaflán', 'chamfer'], ['BREAK', 'Partir', 'break'], ['LENGTHEN', 'Longitud', 'lengthen'], ['STRETCH', 'Estirar', 'stretch'], ['ARRAYRECT', 'Matriz', 'arrayrect'], ['ARRAYPOLAR', 'M. polar', 'arraypolar'], ['EXPLODE', 'Descomp.', 'explode'], ['JOIN', 'Unir', 'join'], ['ERASE', 'Borrar', 'erase']] },
    { name: 'Anotación', items: [['TEXT', 'Texto', 'text'], ['DIMLINEAR', 'Lineal', 'dimlin'], ['DIMALIGNED', 'Alineada', 'dimali'], ['DIMRADIUS', 'Radio', 'dimrad']] },
    { name: 'Bloque', items: [['BLOCK', 'Crear', 'block'], ['INSERT', 'Insertar', 'insert']] },
    { name: 'Capas', custom: 'layers' },
    { name: 'Propiedades', custom: 'props' },
    { name: 'Utilidades', items: [['DIST', 'Distancia', 'dist'], ['AREA', 'Área', 'area'], ['LIST', 'Lista', 'list']] },
  ] },
  { tab: 'Insertar', groups: [
    { name: 'Bloque', items: [['BLOCK', 'Crear bloque', 'block'], ['INSERT', 'Insertar', 'insert'], ['EXPLODE', 'Descomponer', 'explode'], ['PURGE', 'Limpiar', 'trash']] },
    { name: 'Importar', items: [['OPEN', 'Abrir DXF', 'dxf'], ['PASTECLIP', 'Pegar', 'copy']] },
  ] },
  { tab: 'Anotar', groups: [
    { name: 'Texto', items: [['TEXT', 'Texto', 'text'], ['STYLE', 'Estilo de texto', 'textstyle']] },
    { name: 'Cotas', items: [['DIMLINEAR', 'Lineal', 'dimlin'], ['DIMALIGNED', 'Alineada', 'dimali'], ['DIMRADIUS', 'Radio', 'dimrad'], ['DIMDIAMETER', 'Diámetro', 'dimdia'], ['DIMSTYLE', 'Estilo de cota', 'dimstyle']] },
    { name: 'Sombreado', items: [['HATCH', 'Sombreado', 'hatch']] },
  ] },
  { tab: 'Vista', groups: [
    { name: 'Navegar', items: [['!zoomext', 'Extensión', 'zoomext'], ['!zoomwin', 'Ventana', 'zoomwin'], ['!zoomprev', 'Previo', 'zoomprev'], ['PAN', 'Encuadre', 'pan'], ['REGEN', 'Regenerar', 'regen']] },
    { name: 'Dibujo', items: [['ISODRAFT', 'Isométrico', 'iso'], ['DSETTINGS', 'Parámetros', 'settings']] },
    { name: 'Paletas', items: [['PROPERTIES', 'Propiedades', 'props'], ['LAYER', 'Capas', 'layers'], ['!palette', 'Mostrar/ocultar', 'sidebar'], ['!fullscreen', 'Pantalla completa', 'fullscreen'], ['HELP', 'Ayuda', 'help']] },
  ] },
  { tab: 'Presentación', groups: [
    { name: 'Presentación', items: [['!newlayout', 'Nueva', 'layout'], ['PAGESETUP', 'Configurar página', 'page'], ['!model', 'Modelo', 'model']] },
    { name: 'Ventanas gráficas', items: [['MVIEW', 'Ventana', 'vport'], ['MSPACE', 'Espacio modelo', 'mspace'], ['PSPACE', 'Espacio papel', 'page']] },
    { name: 'Trazar', items: [['PLOT', 'Imprimir', 'print'], ['SVGOUT', 'SVG', 'svg'], ['PNGOUT', 'PNG', 'png']] },
  ] },
  { tab: 'Salida', groups: [
    { name: 'Archivo', items: [['NEW', 'Nuevo', 'new'], ['OPEN', 'Abrir', 'open'], ['QSAVE', 'Guardar', 'save'], ['SAVEAS', 'Guardar como', 'save']] },
    { name: 'Exportar', items: [['!dxf2000', 'DXF 2000', 'dxf'], ['!dxf12', 'DXF R12', 'dxf'], ['SVGOUT', 'SVG', 'svg'], ['PNGOUT', 'PNG', 'png'], ['PLOT', 'Imprimir', 'print']] },
  ] },
];

const TOGGLES = [
  ['grid', 'REJILLA', 'F7', 'Muestra la rejilla'], ['snap', 'FORZC', 'F9', 'Forzado de cursor a la rejilla'],
  ['ortho', 'ORTO', 'F8', 'Modo ortogonal'], ['polar', 'POLAR', 'F10', 'Rastreo polar'],
  ['osnap', 'REFENT', 'F3', 'Referencia a objetos (clic derecho: parámetros)'], ['otrack', 'RASTREO', 'F11', 'Rastreo de referencia a objetos'],
  ['dyn', 'DIN', 'F12', 'Entrada dinámica'], ['lwt', 'GLN', '', 'Mostrar grosores de línea'], ['iso', 'ISO', 'F5', 'Dibujo isométrico (F5: cambiar plano)'],
];
const ISO_NAMES = { top: 'superior', left: 'izquierdo', right: 'derecho' };

export class UI {
  constructor(app) { this.app = app; this.histOpen = false; this.pending = false; }

  build() {
    this.buildRibbon();
    this.buildStatus();
    this.buildPalette();
    $('#qa').append(
      ...[['NEW', 'new', 'Nuevo (Ctrl+N)'], ['OPEN', 'open', 'Abrir (Ctrl+O)'], ['QSAVE', 'save', 'Guardar (Ctrl+S)'], ['UNDO', 'undo', 'Deshacer (Ctrl+Z)'], ['REDO', 'redo', 'Rehacer (Ctrl+Y)']]
        .map(([cmd, ic, t]) => h('button', { class: 'qa-btn', title: t, html: icon(ic, 18), onclick: () => this.app.run(cmd) })),
    );
    $('#tb-right').append(
      h('button', { class: 'qa-btn', id: 'btn-install', title: 'Instalar aplicación', hidden: true, html: icon('install', 18) + '<span>Instalar</span>' }),
      h('button', { class: 'qa-btn', title: 'Paleta lateral', html: icon('sidebar', 18), onclick: () => this.togglePalette() }),
      h('button', { class: 'qa-btn', title: 'Ayuda (F1)', html: icon('help', 18), onclick: () => this.openHelp() }),
    );
    $('#cmd-hist-toggle').onclick = () => this.showHistory(!this.histOpen);
    this.updateTitle();
  }

  // ---------- Cinta ----------
  buildRibbon() {
    const tabs = $('#ribbon-tabs'), body = $('#ribbon');
    RIBBON.forEach((t, ti) => {
      const panel = h('div', { class: 'rb-panel' + (ti ? '' : ' active'), 'data-tab': ti });
      for (const g of t.groups) {
        const grp = h('div', { class: 'rb-group' });
        const content = h('div', { class: 'rb-items' + (g.custom ? ' custom' : '') });
        if (g.custom === 'layers') this.buildLayerCtl(content);
        else if (g.custom === 'props') this.buildPropCtl(content);
        else for (const [cmd, label, ic] of g.items) {
          const d = CMDS[cmd];
          const tip = d ? `${label} (${d.name}${d.aliases[0] ? ' · ' + d.aliases[0] : ''})\n${d.desc}` : label;
          content.append(h('button', { class: 'rb-btn', title: tip, 'data-cmd': cmd, onclick: () => this.action(cmd) }, h('span', { html: icon(ic, 22) }), h('span', { class: 'lbl' }, label)));
        }
        grp.append(content, h('div', { class: 'rb-title' }, g.name));
        panel.append(grp);
      }
      body.append(panel);
      tabs.append(h('button', { class: 'rb-tab' + (ti ? '' : ' active'), onclick: e => {
        tabs.querySelectorAll('.rb-tab').forEach(b => b.classList.remove('active'));
        body.querySelectorAll('.rb-panel').forEach(p => p.classList.toggle('active', p.dataset.tab == ti));
        e.currentTarget.classList.add('active');
      } }, t.tab));
    });
  }

  action(cmd) {
    const app = this.app;
    switch (cmd) {
      case '!zoomext': app.zoomExtents(); break;
      case '!zoomprev': if (app.view.prev()) app.renderer.invalidate(); break;
      case '!zoomwin': app.run('ZOOM', 'Ventana'); break;
      case '!palette': this.togglePalette(); break;
      case '!fullscreen': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
      case '!newlayout': app.run('LAYOUT', 'Nueva'); break;
      case '!model': app.switchTab('model'); break;
      case '!dxf2000': app.run('DXFOUT', '2000'); break;
      case '!dxf12': app.run('DXFOUT', 'R12'); break;
      default: app.run(cmd);
    }
  }

  colorOptions(sel, withByLayer = true) {
    const opts = [];
    if (withByLayer) opts.push(h('option', { value: 'BYLAYER' }, 'PorCapa'));
    for (const [hex, name] of COLORS) opts.push(h('option', { value: hex, style: `color:${hex}` }, `■ ${name}`));
    if (sel && sel !== 'BYLAYER' && sel !== '*' && !COLORS.some(c => c[0] === sel)) opts.push(h('option', { value: sel, style: `color:${sel}` }, `■ ${sel}`));
    opts.push(h('option', { value: '__custom' }, 'Seleccionar color…'));
    return opts;
  }
  ltypeOptions(withByLayer = true) {
    return [...(withByLayer ? [h('option', { value: 'BYLAYER' }, 'PorCapa')] : []), ...Object.entries(LTYPES).map(([k, v]) => h('option', { value: k }, `${v.desc} (${k})`))];
  }
  lwOptions(withByLayer = true) {
    return [...(withByLayer ? [h('option', { value: 'BYLAYER' }, 'PorCapa')] : []), h('option', { value: 'DEFAULT' }, 'Por defecto'), ...LWEIGHTS.map(w => h('option', { value: w }, `${w.toFixed(2)} mm`))];
  }
  pickColor(current) {
    return new Promise(res => {
      const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#ffffff', style: 'position:fixed;left:-100px' });
      document.body.append(inp);
      inp.addEventListener('change', () => { res(inp.value); inp.remove(); });
      inp.addEventListener('blur', () => setTimeout(() => { if (inp.isConnected) { inp.remove(); res(null); } }, 400));
      inp.click();
    });
  }

  buildLayerCtl(box) {
    this.layerSwatch = h('span', { class: 'swatch' });
    this.layerSel = h('select', { class: 'rb-select', title: 'Capa actual (o capa de los objetos seleccionados)', onchange: e => this.applyProp('layer', e.target.value) });
    box.append(h('div', { class: 'rb-row' }, this.layerSwatch, this.layerSel),
      h('button', { class: 'rb-mini', onclick: () => this.showPalette('layers') }, h('span', { html: icon('layers', 16) }), 'Propiedades de capa'));
  }
  buildPropCtl(box) {
    this.colorSel = h('select', { class: 'rb-select', title: 'Color', onchange: async e => {
      let v = e.target.value;
      if (v === '__custom') { v = await this.pickColor('#ffffff'); if (!v) return this.refreshRibbonProps(); }
      this.applyProp('color', v);
    } });
    this.ltypeSel = h('select', { class: 'rb-select', title: 'Tipo de línea', onchange: e => this.applyProp('ltype', e.target.value) });
    this.lwSel = h('select', { class: 'rb-select', title: 'Grosor de línea', onchange: e => this.applyProp('lw', e.target.value === 'BYLAYER' || e.target.value === 'DEFAULT' ? e.target.value : +e.target.value) });
    box.append(h('div', { class: 'rb-col' }, this.colorSel, this.ltypeSel, this.lwSel),
      h('button', { class: 'rb-btn', title: 'Igualar propiedades (MATCHPROP)', onclick: () => this.app.run('MATCHPROP') }, h('span', { html: icon('matchprop', 22) }), h('span', { class: 'lbl' }, 'Igualar')));
  }

  // Aplica una propiedad a la selección, o la fija como actual si no hay selección
  applyProp(key, value) {
    const app = this.app, doc = app.doc;
    if (app.sel.size) {
      doc.begin();
      for (const id of app.sel) doc.modify(id, e => { e[key] = value; });
      doc.commit();
    } else {
      doc.cur[key] = value;
      if (key === 'layer') app.print(`Capa actual: "${value}"`);
    }
    app.renderer.invalidate();
    this.refresh();
  }

  refreshRibbonProps() {
    const app = this.app, doc = app.doc;
    const sel = [...app.sel].map(id => doc.get(id)).filter(Boolean);
    const common = k => {
      if (!sel.length) return doc.cur[k];
      const v = sel[0][k];
      return sel.every(e => e[k] === v) ? v : '*';
    };
    const fill = (s, opts, v) => {
      s.replaceChildren(...opts);
      if (v === '*') { s.prepend(h('option', { value: '*' }, '*Varios*')); }
      s.value = String(v);
    };
    const lay = common('layer');
    fill(this.layerSel, doc.layers.map(l => h('option', { value: l.name }, `${l.on ? '' : '◌ '}${l.lock ? '🔒 ' : ''}${l.name}`)), lay);
    this.layerSwatch.style.background = lay === '*' ? 'transparent' : doc.layer(lay).color;
    const col = common('color');
    fill(this.colorSel, this.colorOptions(col), col);
    fill(this.ltypeSel, this.ltypeOptions(), common('ltype'));
    fill(this.lwSel, this.lwOptions(), common('lw'));
  }

  // ---------- Barra de estado ----------
  buildStatus() {
    const sb = $('#statusbar');
    this.coordsEl = h('div', { class: 'sb-coords', title: 'Coordenadas del cursor' }, '0.0000, 0.0000');
    const tg = h('div', { class: 'sb-toggles' });
    this.toggleEls = {};
    for (const [k, label, key, tip] of TOGGLES) {
      const b = h('button', { class: 'sb-tg', title: `${tip}${key ? ` (${key})` : ''}`, onclick: () => this.app.toggle(k), oncontextmenu: e => { e.preventDefault(); if (k === 'osnap' || k === 'polar' || k === 'grid' || k === 'snap') this.openSettings(); } }, label);
      this.toggleEls[k] = b; tg.append(b);
    }
    this.spaceEl = h('button', { class: 'sb-model', title: 'Espacio actual. En una presentación, clic para alternar entre papel y modelo (ventana gráfica)', onclick: () => {
      const app = this.app;
      if (app.tab === 'model') return;
      if (app.vpActive) app.pspace(); else app.mspace();
    } }, 'MODELO');
    sb.append(this.spaceEl, this.coordsEl, tg,
      h('button', { class: 'sb-tg icon', title: 'Zoom extensión (doble clic con rueda)', html: icon('zoomext', 16), onclick: () => this.app.zoomExtents() }),
      h('button', { class: 'sb-tg icon', title: 'Parámetros de dibujo', html: icon('settings', 16), onclick: () => this.openSettings() }));
    // Pestañas Modelo / Presentaciones (abajo a la izquierda del área de dibujo)
    this.tabsEl = h('div', { id: 'layout-tabs' });
    $('#viewport').append(this.tabsEl);
    this.updateStatus();
  }
  updateStatus() {
    const app = this.app, S = app.doc.settings;
    for (const k in this.toggleEls) this.toggleEls[k].classList.toggle('on', k === 'iso' ? !!S.iso : !!app.T[k]);
    this.toggleEls.iso.textContent = S.iso ? `ISO ${{ top: 'SUP', left: 'IZQ', right: 'DER' }[S.isoPlane]}` : 'ISO';
    this.spaceEl.textContent = app.tab === 'model' ? 'MODELO' : app.vpActive ? 'MODELO (ventana)' : 'PAPEL';
    this.spaceEl.classList.toggle('paper', app.tab !== 'model' && !app.vpActive);
    this.renderLayoutTabs();
  }
  renderLayoutTabs() {
    const app = this.app, doc = app.doc;
    const tab = (label, t, menu) => h('button', {
      class: 'lt' + (app.tab === t ? ' active' : ''), title: menu ? 'Clic derecho: opciones' : '',
      onclick: () => app.switchTab(t),
      oncontextmenu: e => { e.preventDefault(); if (menu) this.contextMenu(e.clientX, e.clientY, menu); },
    }, label);
    const items = [tab('Modelo', 'model')];
    doc.layouts.forEach((l, i) => items.push(tab(l.name, i, [
      { label: 'Renombrar…', fn: async () => { const n = await this.prompt('Renombrar presentación', 'Nombre', l.name); if (n && !doc.layouts.some(x => x !== l && x.name === n)) { doc.begin(); l.name = n; doc.changed(); doc.commit(); this.updateStatus(); } } },
      { label: 'Configurar página…', fn: async () => { app.switchTab(i); await this.pageSetup(l); app.zoomExtents(); } },
      { label: 'Eliminar', fn: async () => { if (await this.confirm(`¿Eliminar la presentación "${l.name}"?`, 'Eliminar')) app.deleteLayout(i); } },
    ])));
    items.push(h('button', { class: 'lt add', title: 'Nueva presentación', onclick: () => app.run('LAYOUT', 'Nueva') }, '+'));
    this.tabsEl.replaceChildren(...items);
  }
  updateCoords(p) { const d = this.app.doc.settings.coordDec; this.coordsEl.textContent = `${fmt(p.x, d)}, ${fmt(p.y, d)}, 0.0000`; }

  // ---------- Paleta lateral ----------
  buildPalette() {
    const pal = $('#palette');
    const tabs = h('div', { class: 'pal-tabs' });
    this.palTabs = {};
    this.palBodies = {};
    for (const [k, label, ic] of [['props', 'Propiedades', 'props'], ['layers', 'Capas', 'layers']]) {
      const b = h('button', { class: 'pal-tab', onclick: () => this.showPalette(k) }, h('span', { html: icon(ic, 16) }), label);
      this.palTabs[k] = b; tabs.append(b);
      this.palBodies[k] = h('div', { class: 'pal-body' });
    }
    tabs.append(h('button', { class: 'pal-close', title: 'Cerrar paleta', html: icon('close', 16), onclick: () => this.togglePalette(false) }));
    pal.append(tabs, this.palBodies.props, this.palBodies.layers);
    this.showPalette('props', false);
    if (window.innerWidth < 900) this.togglePalette(false);
  }
  showPalette(k, open = true) {
    for (const key in this.palTabs) { this.palTabs[key].classList.toggle('active', key === k); this.palBodies[key].hidden = key !== k; }
    this.palTab = k;
    if (open) this.togglePalette(true);
    this.refresh();
  }
  togglePalette(force) {
    const pal = $('#palette'), show = force ?? pal.classList.contains('hidden');
    pal.classList.toggle('hidden', !show);
    setTimeout(() => this.app.renderer.resize(), 0);
  }

  refresh() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.refreshRibbonProps();
      if (this.palTab === 'props') this.renderProps(); else this.renderLayers();
      this.updateTitle();
      this.updateStatus();
    });
  }

  propRow(label, input) { return h('div', { class: 'prop-row' }, h('label', {}, label), input); }

  renderProps() {
    const app = this.app, doc = app.doc, body = this.palBodies.props;
    const active = document.activeElement;
    if (active && body.contains(active) && active.tagName === 'INPUT') return; // no interrumpir la edición
    const sel = [...app.sel].map(id => doc.get(id)).filter(Boolean);
    body.replaceChildren();
    const types = [...new Set(sel.map(e => e.type))];
    const head = sel.length ? (types.length === 1 ? `${TYPES[types[0]].name} (${sel.length})` : `Todos (${sel.length})`) : 'Sin selección';
    body.append(h('div', { class: 'prop-head' }, head));
    const common = k => { if (!sel.length) return doc.cur[k]; const v = sel[0][k]; return sel.every(e => e[k] === v) ? v : '*'; };
    const mkSel = (opts, val, onch) => { const s = h('select', { onchange: e => onch(e.target.value) }, ...opts); if (val === '*') s.prepend(h('option', { value: '*' }, '*Varios*')); s.value = String(val); return s; };

    body.append(h('div', { class: 'prop-sec' }, 'General'));
    body.append(this.propRow('Capa', mkSel(doc.layers.map(l => h('option', { value: l.name }, l.name)), common('layer'), v => this.applyProp('layer', v))));
    const col = common('color');
    body.append(this.propRow('Color', mkSel(this.colorOptions(col), col, async v => {
      if (v === '__custom') { v = await this.pickColor('#ffffff'); if (!v) return this.refresh(); }
      this.applyProp('color', v);
    })));
    body.append(this.propRow('Tipo de línea', mkSel(this.ltypeOptions(), common('ltype'), v => this.applyProp('ltype', v))));
    body.append(this.propRow('Grosor de línea', mkSel(this.lwOptions(), common('lw'), v => this.applyProp('lw', v === 'BYLAYER' || v === 'DEFAULT' ? v : +v))));

    if (sel.length === 1) {
      const e = sel[0];
      body.append(h('div', { class: 'prop-sec' }, 'Geometría'));
      for (const pr of TYPES[e.type].props) {
        const raw = pr.get(e);
        let input;
        if (pr.ro) {
          const txt = pr.type === 'num' ? fmt(raw, 4) : pr.type === 'deg' ? fmt(raw, 2) + '°' : String(raw);
          input = h('span', { class: 'prop-ro' }, txt);
        } else if (pr.type === 'bool') {
          input = h('input', { type: 'checkbox', checked: raw, onchange: ev => this.setGeom(e.id, pr, ev.target.checked) });
        } else if (pr.type === 'select') {
          input = h('select', { onchange: ev => this.setGeom(e.id, pr, ev.target.value) }, ...(typeof pr.options === 'function' ? pr.options() : pr.options).map(([v, l]) => h('option', { value: v }, l)));
          input.value = raw;
        } else {
          const shown = pr.type === 'num' ? fmt(raw, 4) : pr.type === 'ang' ? fmt(G.deg(G.normAng(raw)), 2) : raw;
          input = h('input', { type: 'text', value: shown, onkeydown: ev => { if (ev.key === 'Enter') ev.target.blur(); if (ev.key === 'Escape') { ev.target.value = shown; ev.target.blur(); } },
            onchange: ev => {
              const s = ev.target.value;
              if (pr.type === 'text') return this.setGeom(e.id, pr, s);
              const v = parseFloat(s.replace(',', '.'));
              if (!Number.isFinite(v)) { ev.target.value = shown; return; }
              this.setGeom(e.id, pr, pr.type === 'ang' ? G.rad(v) : v);
            } });
        }
        body.append(this.propRow(pr.label, input));
      }
    }
    if (!sel.length) {
      body.append(h('div', { class: 'prop-sec' }, 'Dibujo'));
      body.append(this.propRow(app.tab === 'model' ? 'Objetos (modelo)' : 'Objetos (papel)', h('span', { class: 'prop-ro' }, String(doc.ents.length))));
      body.append(this.propRow('Bloques', h('span', { class: 'prop-ro' }, String(Object.keys(doc.blocks).length))));
      body.append(this.propRow('Estilo de texto', mkSel(doc.textStyles.map(t => h('option', { value: t.name }, t.name)), doc.cur.textStyle, v => { doc.cur.textStyle = v; })));
      body.append(this.propRow('Estilo de cota', mkSel(doc.dimStyles.map(t => h('option', { value: t.name }, t.name)), doc.cur.dimStyle, v => { doc.cur.dimStyle = v; })));
      body.append(this.propRow('Capas', h('span', { class: 'prop-ro' }, String(doc.layers.length))));
      body.append(this.propRow('Escala tipo línea', h('input', { type: 'text', value: doc.settings.ltscale, onchange: ev => { const v = parseFloat(ev.target.value); if (v > 0) { doc.settings.ltscale = v; doc.changed(); } } })));
      body.append(h('p', { class: 'hint' }, 'Seleccione objetos para ver y editar sus propiedades. Las propiedades de arriba se aplican a los objetos nuevos.'));
    }
  }

  setGeom(id, pr, v) {
    const doc = this.app.doc;
    doc.begin(); doc.modify(id, e => pr.set(e, v)); doc.commit();
    this.app.renderer.invalidate(); this.refresh();
  }

  renderLayers() {
    const app = this.app, doc = app.doc, body = this.palBodies.layers;
    if (document.activeElement && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    body.replaceChildren();
    const tx = fn => { doc.begin(); fn(); doc.commit(); app.renderer.invalidate(); this.refresh(); };
    const bar = h('div', { class: 'lay-bar' },
      h('button', { class: 'btn', onclick: async () => {
        let i = 1;
        while (doc.layers.some(l => l.name === `Capa${i}`)) i++;
        const name = await this.prompt('Nueva capa', 'Nombre de la capa', `Capa${i}`);
        if (!name) return;
        if (doc.layers.some(l => l.name.toLowerCase() === name.toLowerCase())) return app.print(`La capa "${name}" ya existe.`);
        const palette = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff7f00', '#7fbfff'];
        tx(() => { doc.addLayer(name, palette[(doc.layers.length - 1) % palette.length]); doc.cur.layer = name; });
      } }, h('span', { html: icon('plus', 16) }), 'Nueva'),
      h('button', { class: 'btn', onclick: () => {
        const name = this.selLayer;
        if (!name) return app.print('Seleccione una capa de la lista.');
        if (name === '0') return app.print('La capa "0" no se puede eliminar.');
        if (name === doc.cur.layer) return app.print('No se puede eliminar la capa actual.');
        if ([...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)].some(e => e.layer === name)) return app.print(`La capa "${name}" contiene objetos y no se puede eliminar.`);
        tx(() => { doc.layers = doc.layers.filter(l => l.name !== name); this.selLayer = null; });
      } }, h('span', { html: icon('trash', 16) }), 'Eliminar'),
      h('button', { class: 'btn', onclick: () => { if (this.selLayer) { doc.cur.layer = this.selLayer; this.refresh(); } } }, h('span', { html: icon('check', 16) }), 'Actual'));
    body.append(bar);
    const list = h('div', { class: 'lay-list' });
    list.append(h('div', { class: 'lay-row head' }, h('span', {}, ''), h('span', {}, 'Nombre'), h('span', { title: 'Activada' }, 'Act.'), h('span', { title: 'Bloqueada' }, 'Bloq.'), h('span', { title: 'Color' }, 'Col.'), h('span', {}, 'Tipo / Grosor')));
    for (const l of doc.layers) {
      let count = 0;
      for (const e of doc.allEnts()) if (e.layer === l.name) count++;
      const lt = h('select', { onchange: e => tx(() => { l.ltype = e.target.value; }) }, ...this.ltypeOptions(false)); lt.value = l.ltype;
      const lw = h('select', { onchange: e => tx(() => { l.lw = e.target.value === 'DEFAULT' ? 'DEFAULT' : +e.target.value; }) }, ...this.lwOptions(false)); lw.value = String(l.lw);
      const row = h('div', { class: 'lay-row' + (this.selLayer === l.name ? ' sel' : ''), onclick: () => { this.selLayer = l.name; list.querySelectorAll('.lay-row').forEach(r => r.classList.remove('sel')); row.classList.add('sel'); } },
        h('span', { class: 'lay-cur', title: 'Doble clic en el nombre para establecer como actual' }, doc.cur.layer === l.name ? '✔' : ''),
        h('span', { class: 'lay-name', title: `${count} objeto(s). Doble clic: actual · Clic derecho: renombrar`,
          ondblclick: () => { doc.cur.layer = l.name; this.refresh(); },
          oncontextmenu: async ev => {
            ev.preventDefault();
            if (l.name === '0') return app.print('La capa "0" no se puede renombrar.');
            const n = await this.prompt('Renombrar capa', 'Nuevo nombre', l.name);
            if (!n || n === l.name) return;
            if (doc.layers.some(x => x.name.toLowerCase() === n.toLowerCase())) return app.print(`La capa "${n}" ya existe.`);
            tx(() => { for (const e of [...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)]) if (e.layer === l.name) e.layer = n; if (doc.cur.layer === l.name) doc.cur.layer = n; l.name = n; });
          } }, l.name),
        h('button', { class: 'ib' + (l.on ? '' : ' off'), title: l.on ? 'Desactivar' : 'Activar', html: icon(l.on ? 'eye' : 'eyeoff', 16), onclick: ev => { ev.stopPropagation(); tx(() => { l.on = !l.on; }); } }),
        h('button', { class: 'ib' + (l.lock ? ' off' : ''), title: l.lock ? 'Desbloquear' : 'Bloquear', html: icon(l.lock ? 'lock' : 'unlock', 16), onclick: ev => { ev.stopPropagation(); tx(() => { l.lock = !l.lock; }); } }),
        h('button', { class: 'lay-color', title: 'Cambiar color', style: `background:${l.color}`, onclick: async ev => { ev.stopPropagation(); const c = await this.pickColor(l.color); if (c) tx(() => { l.color = c; }); } }),
        h('span', { class: 'lay-lt' }, lt, lw));
      list.append(row);
    }
    body.append(list, h('p', { class: 'hint' }, 'Doble clic en un nombre: capa actual. Clic derecho: renombrar. Los objetos nuevos se dibujan en la capa actual.'));
  }

  updateTitle() {
    const d = this.app.doc;
    const t = `${d.name}${d.dirty ? ' *' : ''}`;
    $('#doc-name').textContent = t;
    document.title = `${t} — TrazoCAD`;
  }

  // ---------- Línea de comandos ----------
  setPrompt(req) {
    const el = $('#cmd-prompt');
    el.replaceChildren();
    if (!req) { el.append('Comando:'); return; }
    el.append(this.promptText(req, true));
  }
  promptText(req, interactive) {
    const frag = document.createDocumentFragment();
    frag.append(req.prompt.replace(/:\s*$/, ''));
    const opts = req.opts.options || [];
    if (opts.length) {
      frag.append(' o [');
      opts.forEach((o, i) => {
        if (i) frag.append('/');
        frag.append(interactive ? h('span', { class: 'kw', onclick: () => this.app.submit(o) }, o) : o);
      });
      frag.append(']');
    }
    if (req.opts.def !== undefined && req.opts.def !== '') frag.append(` <${typeof req.opts.def === 'number' ? +req.opts.def.toFixed(4) : req.opts.def}>`);
    frag.append(':');
    return frag;
  }
  print(msg, cls = '') {
    const hist = $('#cmd-history');
    hist.append(h('div', { class: 'hl ' + cls }, msg));
    while (hist.childNodes.length > 400) hist.firstChild.remove();
    hist.scrollTop = hist.scrollHeight;
  }
  echo(req, typed) {
    const div = h('div', { class: 'hl echo' }, this.promptText(req, false), typed ? ' ' + typed : '');
    const hist = $('#cmd-history');
    hist.append(div); hist.scrollTop = hist.scrollHeight;
  }
  showHistory(open) {
    this.histOpen = open;
    $('#cmdline').classList.toggle('open', open);
    const hist = $('#cmd-history'); hist.scrollTop = hist.scrollHeight;
  }

  showSuggest(list, idx) {
    const box = $('#cmd-suggest');
    if (!list.length) { box.hidden = true; return; }
    box.replaceChildren(...list.map((d, i) => h('div', { class: 'sg' + (i === idx ? ' active' : ''), onmousedown: e => { e.preventDefault(); this.app.pickSuggestion(d); } },
      h('b', {}, d.name), h('span', { class: 'al' }, d.aliases.slice(0, 2).join(', ')), h('span', { class: 'ds' }, d.desc))));
    box.hidden = false;
  }

  // ---------- Información junto al cursor ----------
  updateTips() {
    const app = this.app, m = app.mouse, req = app.req;
    const dyn = $('#dyn'), tip = $('#snaptip');
    if (m.snap && m.inside) {
      const s = app.view.toScreen(m.snap.pt);
      tip.textContent = OSNAP_MODES[m.snap.mode] || '';
      tip.style.transform = `translate(${s.x + 12}px, ${s.y + 12}px)`;
      tip.hidden = false;
    } else if ((m.polar || m.track) && m.inside) {
      const s = app.view.toScreen(m.pt);
      const base = req?.opts.base || req?.tmpBase;
      tip.textContent = m.polar ? `Polar: ${fmt(m.polar.d, 4)} < ${fmt(G.deg(G.normAng(m.polar.ang)), 0)}°` : base ? `Rastreo: ${fmt(G.dist(base, m.pt), 4)}` : 'Rastreo';
      tip.style.transform = `translate(${s.x + 12}px, ${s.y + 12}px)`;
      tip.hidden = false;
    } else tip.hidden = true;

    if (app.T.dyn && req && m.inside && !app.touchMode) {
      const base = req.opts.base || req.tmpBase;
      let html = `<div class="dp">${esc(req.prompt.replace(/:\s*$/, ''))}</div>`;
      const typed = $('#cmd-input').value;
      if (base && req.pointLike) html += `<div class="dv"><span>${fmt(G.dist(base, m.pt), 4)}</span><span>${fmt(G.deg(G.normAng(G.ang(base, m.pt))), 1)}°</span></div>`;
      else if (req.pointLike) html += `<div class="dv"><span>${fmt(m.pt.x, 4)}</span><span>${fmt(m.pt.y, 4)}</span></div>`;
      if (typed) html += `<div class="dt">${esc(typed)}</div>`;
      dyn.innerHTML = html;
      dyn.style.transform = `translate(${m.sx + 22}px, ${m.sy + 22}px)`;
      dyn.hidden = false;
    } else dyn.hidden = true;
  }

  // ---------- Menú contextual ----------
  contextMenu(x, y, items) {
    const menu = $('#ctxmenu');
    menu.replaceChildren(...items.map(it => (it === '-' ? h('div', { class: 'sep' }) : h('div', { class: 'mi', onclick: () => { this.hideMenu(); it.fn(); } }, it.label, it.key ? h('span', { class: 'k' }, it.key) : null))));
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 4) + 'px';
  }
  hideMenu() { $('#ctxmenu').hidden = true; }

  // ---------- Diálogos ----------
  modal(title, content, buttons) {
    return new Promise(res => {
      const root = $('#modal-root');
      const close = v => { root.replaceChildren(); root.hidden = true; res(v); };
      const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
        h('div', { class: 'modal-head' }, h('span', {}, title), h('button', { class: 'ib', html: icon('close', 16), onclick: () => close(null) })),
        h('div', { class: 'modal-body' }, content),
        h('div', { class: 'modal-foot' }, ...buttons.map(b => h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label))));
      root.replaceChildren(h('div', { class: 'modal-back', onmousedown: e => { if (e.target === e.currentTarget) close(null); } }, box));
      root.hidden = false;
      box.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = buttons.find(b => b.primary); if (p) close(typeof p.value === 'function' ? p.value() : p.value); }
      });
      setTimeout(() => (box.querySelector('input,select') || box.querySelector('.btn.primary'))?.focus(), 30);
    });
  }
  confirm(msg, okLabel = 'Aceptar') {
    return this.modal('TrazoCAD', h('p', {}, msg), [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, primary: true }]).then(v => !!v);
  }
  prompt(title, label, value = '') {
    const inp = h('input', { type: 'text', value, class: 'full' });
    return this.modal(title, h('label', { class: 'fld' }, label, inp), [{ label: 'Cancelar', value: null }, { label: 'Aceptar', value: () => inp.value.trim(), primary: true }]);
  }

  openSettings() {
    const app = this.app, S = app.doc.settings;
    const box = h('div', { class: 'settings' });
    const sec = (t, ...k) => box.append(h('fieldset', {}, h('legend', {}, t), ...k));
    const field = (label, key, step = 'any') => h('label', { class: 'fld' }, label, h('input', { type: 'number', step, min: 0, 'data-key': key, value: S[key] }));
    const modes = Object.entries(OSNAP_MODES).map(([k, l]) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-osnap': k, checked: !!app.osnapModes[k] }), l));
    sec('Referencia a objetos (REFENT)', h('div', { class: 'grid2' }, ...modes));
    const pol = h('select', { 'data-key': 'polarInc' }, ...[5, 10, 15, 18, 22.5, 30, 45, 90].map(v => h('option', { value: v }, `${v}°`)));
    pol.value = String(S.polarInc);
    sec('Rejilla, forzado y polar', h('div', { class: 'grid2' }, field('Espaciado de rejilla', 'gridX'), field('Forzado (FORZC)', 'snapX'), h('label', { class: 'fld' }, 'Incremento polar', pol)));
    const isoChk = h('input', { type: 'checkbox', 'data-iso': '1', checked: !!S.iso });
    const plane = h('select', { 'data-plane': '1' }, ...Object.entries(ISO_NAMES).map(([k, v]) => h('option', { value: k }, `Plano ${v}`)));
    plane.value = S.isoPlane;
    sec('Dibujo isométrico', h('div', { class: 'grid2' }, h('label', { class: 'chk' }, isoChk, 'Rejilla y forzado isométricos'), h('label', { class: 'fld' }, 'Plano isométrico (F5)', plane)));
    sec('Otros', h('div', { class: 'grid2' }, field('Altura de texto por defecto', 'textH'), field('Escala de tipo de línea', 'ltscale'), field('Decimales de coordenadas', 'coordDec', 1)));
    this.modal('Parámetros de dibujo', box, [{ label: 'Cancelar', value: false }, { label: 'Aceptar', value: true, primary: true }]).then(ok => {
      if (!ok) return;
      box.querySelectorAll('[data-key]').forEach(inp => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v) && v >= 0) S[inp.dataset.key] = inp.dataset.key.endsWith('Dec') ? Math.min(8, Math.round(v)) : v;
      });
      S.iso = isoChk.checked; S.isoPlane = plane.value;
      app.ui.updateStatus();
      box.querySelectorAll('[data-osnap]').forEach(inp => { app.osnapModes[inp.dataset.osnap] = inp.checked; });
      app.savePrefs();
      app.doc.changed();
      app.renderer.invalidate();
    });
  }

  // ---------- Miniaturas ----------
  thumb(ents, w = 96, hgt = 72, pad = 0.12) {
    const cv = h('canvas', { width: w * 2, height: hgt * 2, style: `width:${w}px;height:${hgt}px`, class: 'thumb' });
    const c = cv.getContext('2d'), doc = this.app.doc;
    c.fillStyle = '#1b2027'; c.fillRect(0, 0, cv.width, cv.height);
    let b = null;
    for (const e of ents) b = bbUnion(b, bboxOf(e));
    if (!b) return cv;
    const bw = Math.max(b.x2 - b.x1, 1e-6), bh = Math.max(b.y2 - b.y1, 1e-6);
    const R = makeRV((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, Math.min(w / bw, hgt / bh) * (1 - 2 * pad), w, hgt, 2);
    const sty = e => ({ ...doc.style(e), px: 1 });
    setWorld(c, R);
    for (const e of ents) paintEntity(c, e, R, sty(e), sty);
    return cv;
  }

  // Selector de patrón de sombreado. Devuelve el nombre o null.
  pickPattern(current) {
    let chosen = current;
    const grid = h('div', { class: 'swatches' });
    const sq = [G.P(0, 0), G.P(40, 0), G.P(40, 40), G.P(0, 40)];
    for (const [name, p] of Object.entries(PATTERNS)) {
      const sw = h('button', { class: 'swatch-btn' + (name === current ? ' sel' : ''), title: p.desc,
        onclick: () => { chosen = name; grid.querySelectorAll('.swatch-btn').forEach(x => x.classList.remove('sel')); sw.classList.add('sel'); },
        ondblclick: () => grid.closest('.modal').querySelector('.btn.primary').click() },
      this.thumb([{ type: 'hatch', loops: [sq], pattern: name, scale: 1, angle: 0, layer: '0', color: '#ffffff', ltype: 'BYLAYER', lw: 'BYLAYER' }], 72, 72, 0.02), h('span', {}, name));
      grid.append(sw);
    }
    return this.modal('Patrón de sombreado', grid, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', value: () => chosen, primary: true }]);
  }

  // Selector de bloque con vista previa. Devuelve el nombre o null.
  pickBlock() {
    const doc = this.app.doc, names = Object.keys(doc.blocks).filter(n => !n.startsWith('*')).sort();
    let chosen = names[0];
    const grid = h('div', { class: 'swatches blocks' });
    for (const name of names) {
      const b = doc.blocks[name];
      const sw = h('button', { class: 'swatch-btn' + (name === chosen ? ' sel' : ''), title: `${name} · ${b.ents.length} objeto(s)`,
        onclick: () => { chosen = name; grid.querySelectorAll('.swatch-btn').forEach(x => x.classList.remove('sel')); sw.classList.add('sel'); },
        ondblclick: () => grid.closest('.modal').querySelector('.btn.primary').click() },
      this.thumb(b.ents, 110, 80), h('span', {}, name));
      grid.append(sw);
    }
    return this.modal('Insertar bloque', grid, [{ label: 'Cancelar', value: null }, { label: 'Insertar', value: () => chosen, primary: true }]);
  }

  // Administrador genérico de estilos (texto o cota) sobre una copia de trabajo
  async styleManager({ title, listKey, curKey, make, fields, preview }) {
    const doc = this.app.doc, work = JSON.parse(JSON.stringify(doc[listKey]));
    let current = doc.cur[curKey], idx = Math.max(0, work.findIndex(s => s.name === current));
    const list = h('select', { size: 8, class: 'style-list' });
    const form = h('div', { class: 'grid2' }), prev = h('div', { class: 'style-prev' });
    const fill = () => {
      list.replaceChildren(...work.map((s, i) => h('option', { value: i }, `${s.name === current ? '✔ ' : ''}${s.name}`)));
      list.value = String(idx);
      const s = work[idx];
      form.replaceChildren(...fields.map(f => {
        let inp;
        if (f.options) { inp = h('select', {}, ...(typeof f.options === 'function' ? f.options() : f.options).map(([v, l]) => h('option', { value: v }, l))); inp.value = String(s[f.key]); }
        else inp = h('input', { type: f.type || 'number', step: 'any', value: s[f.key] ?? '' });
        inp.addEventListener('change', () => { s[f.key] = f.type === 'text' || f.options ? inp.value : parseFloat(inp.value) || 0; prev.replaceChildren(preview(s)); });
        return h('label', { class: 'fld' }, f.label, inp);
      }));
      prev.replaceChildren(preview(s));
    };
    list.addEventListener('change', () => { idx = +list.value; fill(); });
    const btns = h('div', { class: 'style-btns' },
      h('button', { class: 'btn', onclick: async () => {
        const name = await this.prompt('Nuevo estilo', 'Nombre del estilo', `${work[idx].name} copia`);
        if (!name || work.some(s => s.name === name)) return;
        work.push(make({ ...work[idx], name })); idx = work.length - 1; fill();
      } }, h('span', { html: icon('plus', 16) }), 'Nuevo'),
      h('button', { class: 'btn', onclick: () => { current = work[idx].name; fill(); } }, h('span', { html: icon('check', 16) }), 'Actual'),
      h('button', { class: 'btn', onclick: () => {
        const s = work[idx];
        if (idx === 0) return this.app.print('El estilo base no se puede eliminar.');
        if (s.name === current) return this.app.print('No se puede eliminar el estilo actual.');
        work.splice(idx, 1); idx = 0; fill();
      } }, h('span', { html: icon('trash', 16) }), 'Eliminar'));
    const box = h('div', { class: 'style-mgr' }, h('div', { class: 'style-col' }, list, btns), h('div', { class: 'style-col grow' }, form, prev));
    fill();
    const ok = await this.modal(title, box, [{ label: 'Cancelar', value: false }, { label: 'Aplicar', value: true, primary: true }]);
    if (!ok) return;
    const names = new Set(work.map(s => s.name));
    doc.begin();
    doc[listKey] = work;
    doc.cur[curKey] = current;
    const typ = listKey === 'textStyles' ? 'text' : 'dim';
    for (const e of [...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)]) if (e.type === typ && !names.has(e.style)) e.style = work[0].name;
    if (typ === 'text') for (const d of doc.dimStyles) if (!names.has(d.textStyle)) d.textStyle = work[0].name;
    for (const b of Object.values(doc.blocks)) b.ver = (b.ver || 0) + 1;
    doc.changed();
    doc.commit();
    this.app.renderer.invalidate();
  }

  textStyleManager() {
    return this.styleManager({
      title: 'Estilos de texto', listKey: 'textStyles', curKey: 'textStyle', make: s => s,
      fields: [{ key: 'font', label: 'Fuente', options: FONTS.map(f => [f, f]) }, { key: 'width', label: 'Factor de anchura' }, { key: 'oblique', label: 'Ángulo oblicuo (°)' }],
      preview: s => {
        const el = h('div', { class: 'text-sample' }, 'AaBbCc 0123 ÁÑ');
        el.style.fontFamily = `"${s.font}", Arial`;
        el.style.transform = `scaleX(${s.width || 1}) skewX(${-(s.oblique || 0)}deg)`;
        return el;
      },
    });
  }

  dimStyleManager() {
    const doc = this.app.doc;
    return this.styleManager({
      title: 'Estilos de cota', listKey: 'dimStyles', curKey: 'dimStyle', make: s => s,
      fields: [
        { key: 'txt', label: 'Altura de texto' }, { key: 'asz', label: 'Tamaño de flecha' },
        { key: 'arrow', label: 'Tipo de flecha', options: Object.entries(ARROWS) },
        { key: 'textStyle', label: 'Estilo de texto', options: () => doc.textStyles.map(t => [t.name, t.name]) },
        { key: 'gap', label: 'Separación del texto' }, { key: 'exo', label: 'Desfase desde origen' },
        { key: 'exe', label: 'Prolongación línea ref.' }, { key: 'dec', label: 'Decimales' },
        { key: 'scale', label: 'Escala global' }, { key: 'suffix', label: 'Sufijo (p. ej. mm)', type: 'text' },
      ],
      preview: s => {
        const name = '__prev__', saved = doc.dimStyles;
        doc.dimStyles = [{ ...DEFAULT_DIMSTYLE, ...s, name }];
        const ents = [{ type: 'line', p1: G.P(0, 0), p2: G.P(30, 0) }, { type: 'line', p1: G.P(30, 0), p2: G.P(30, 15) },
          { type: 'dim', kind: 'lin', p1: G.P(0, 0), p2: G.P(30, 0), p3: G.P(15, -8), rot: 0, style: name },
          { type: 'dim', kind: 'lin', p1: G.P(30, 0), p2: G.P(30, 15), p3: G.P(38, 7), rot: Math.PI / 2, style: name }]
          .map(e => ({ layer: '0', color: '#ffffff', ltype: 'BYLAYER', lw: 'BYLAYER', ...e }));
        const cv = this.thumb(ents, 260, 140, 0.08);
        doc.dimStyles = saved;
        return cv;
      },
    });
  }

  async pageSetup(layout) {
    const sizeSel = h('select', {}, ...Object.entries(PAPERS).map(([k, [w, hh]]) => h('option', { value: k }, `${k} (${w} × ${hh} mm)`)));
    sizeSel.value = layout.paper in PAPERS ? layout.paper : 'A4';
    const orient = h('select', {}, h('option', { value: 'h' }, 'Horizontal'), h('option', { value: 'v' }, 'Vertical'));
    orient.value = layout.w >= layout.h ? 'h' : 'v';
    const box = h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Tamaño de papel', sizeSel), h('label', { class: 'fld' }, 'Orientación', orient));
    const ok = await this.modal(`Configurar página · ${layout.name}`, box, [{ label: 'Cancelar', value: false }, { label: 'Aceptar', value: true, primary: true }]);
    if (!ok) return;
    const [a, b] = PAPERS[sizeSel.value], doc = this.app.doc;
    doc.begin();
    layout.paper = sizeSel.value;
    [layout.w, layout.h] = orient.value === 'h' ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
    doc.changed();
    doc.commit();
    this.app.print(`Página: ${layout.paper} ${orient.value === 'h' ? 'horizontal' : 'vertical'} (${layout.w} × ${layout.h} mm).`);
  }

  openHelp() {
    const groups = {};
    for (const d of Object.values(CMDS)) if (!d.hidden) (groups[d.group || 'Otros'] ||= []).push(d);
    const box = h('div', { class: 'help' });
    box.append(h('div', { class: 'help-intro', html: `
      <p><b>TrazoCAD</b> es un programa de dibujo 2D de precisión inspirado en AutoCAD. Escriba un comando (o su alias) en la línea de comandos y pulse <kbd>Intro</kbd> o <kbd>Espacio</kbd>. <kbd>Intro</kbd> en vacío repite el último comando; <kbd>Esc</kbd> cancela.</p>
      <h4>Entrada de coordenadas</h4>
      <ul>
        <li><code>x,y</code> absoluta · <code>@dx,dy</code> relativa · <code>@dist&lt;ángulo</code> polar relativa · <code>dist&lt;ángulo</code> polar absoluta</li>
        <li>Un número solo = <b>distancia directa</b> en la dirección del cursor (combínelo con ORTO o POLAR).</li>
      </ul>
      <h4>Selección</h4>
      <ul>
        <li>Clic sobre un objeto lo añade. <kbd>Mayús</kbd>+clic lo quita.</li>
        <li>Ventana de izquierda a derecha (azul): objetos totalmente dentro. De derecha a izquierda (verde, captura): objetos que toquen la ventana.</li>
        <li>Seleccione objetos y arrastre los <b>pinzamientos</b> azules para editarlos.</li>
      </ul>
      <h4>Presentaciones (espacio papel)</h4>
      <ul>
        <li>Pestañas <b>Modelo / Presentación</b> abajo a la izquierda; <b>+</b> crea una presentación con marco, cajetín y una ventana gráfica a escala estándar.</li>
        <li>Doble clic dentro de una ventana gráfica: trabaja en el modelo a través de ella (zoom y encuadre cambian su vista). Doble clic fuera: vuelve al papel.</li>
        <li>La escala de la ventana se cambia en la paleta de Propiedades. Imprimir, SVG y PNG de una presentación salen a escala real en milímetros.</li>
      </ul>
      <h4>Isométrico</h4>
      <ul><li>Botón <b>ISO</b> o comando ISODRAFT. <kbd>F5</kbd> o <kbd>Ctrl+E</kbd> cambia de plano (izquierdo, superior, derecho). ELIPSE ofrece la opción Isocírculo.</li></ul>
      <h4>Teclado y ratón</h4>
      <ul>
        <li>Rueda: zoom · botón central/arrastrar: encuadre · doble clic central: zoom extensión · clic derecho: Intro / menú.</li>
        <li><kbd>F1</kbd> ayuda · <kbd>F2</kbd> historial · <kbd>F3</kbd> REFENT · <kbd>F7</kbd> rejilla · <kbd>F8</kbd> orto · <kbd>F9</kbd> forzado · <kbd>F10</kbd> polar · <kbd>F11</kbd> rastreo · <kbd>F12</kbd> dinámica</li>
        <li><kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> deshacer/rehacer · <kbd>Ctrl+S</kbd> guardar · <kbd>Ctrl+O</kbd> abrir · <kbd>Ctrl+N</kbd> nuevo · <kbd>Ctrl+A</kbd> todo · <kbd>Ctrl+C</kbd>/<kbd>Ctrl+V</kbd> copiar/pegar · <kbd>Supr</kbd> borrar</li>
      </ul>` }));
    for (const [g, list] of Object.entries(groups)) {
      box.append(h('h4', {}, g));
      box.append(h('table', { class: 'cmd-table' }, ...list.map(d => h('tr', {}, h('td', {}, h('code', {}, d.name)), h('td', { class: 'al' }, d.aliases.join(', ')), h('td', {}, d.desc)))));
    }
    this.modal('Ayuda de TrazoCAD', box, [{ label: 'Cerrar', value: true, primary: true }]);
  }
}
