// Interfaz: cinta de opciones, paletas (propiedades y capas), barra de estado, línea de comandos y diálogos.
// @ts-check
import { icon } from './icons.js';
import { CMDS, loadPatterns } from './commands.js';
import { TYPES, LTYPES, LWEIGHTS, COLORS, FONTS, ARROWS, DEFAULT_DIMSTYLE, DEFAULT_MLSTYLE, DEFAULT_TBLSTYLE, ML_CONTENT, DATE_FORMATS, formatDate, fmt, bboxOf, bbUnion, propsOf, blockAttdefs, attVal, TOL_MODES, hexToAci } from './entities.js';
import { OSNAP_MODES } from './snap.js';
import { PATTERNS, USER_DEFAULT, patText } from './patterns.js';
import { groupsOf, isAnonGroup } from './groups.js';
import { LS_PROPS, LS_ALL, layerStateMatches, renameLayerInStates } from './layerstates.js';
import { linsOf, rotsOf } from './dynblock.js';
import { PAPERS } from './document.js';
import { CAP_KEYS, samplePts, MLEDIT_TOOLS, sortedElems, mlCross, mlTee, mlCorner, mlCutRange } from './mline.js';
import { makeRV, setWorld, paintEntity } from './render.js';
import * as G from './geom.js';
import { parseRich, buildRich, baseFmt } from './richtext.js';
import { xrefNames, xrefRefs, recallXref } from './xref.js';
import { plotTables, BUILTIN_PLOT, OBJECT, stbNames, readPlotFile, writePlotFile, aciSample, activeStb } from './plotstyles.js';
import { evalParams } from './constraints.js';
import { ucsOf, toUcs } from './ucs.js';
import { OPS, propNames, propValue, candidates, findFilter } from './select.js';
import { FIND_KINDS, findText, replaceText } from './find.js';
import { OK_PROPS } from './cleanup.js';
import { usedLayers, LF_RULES, findLayerFilter, layerMatches, filteredLayers } from './layertools.js';
import { scalesOf, curScale } from './annoscale.js';
import { REC, runJs, startupApps } from './scripting.js';
import { LIBRARY, LIB_CATS, libItem, libPreview } from './library.js';
import { loadPalettes, savePalettes, resetPalettes, toolFromEntity, toolDesc } from './toolpalettes.js';
import { readDXF } from './dxf.js';

/** @typedef {import('./types').Entity} Entity */
const $ = (s, r = document) => r.querySelector(s);
/** Crea un elemento con atributos (on…: manejadores; class; html) e hijos.
 * @template {keyof HTMLElementTagNameMap} K @param {K} tag
 * @returns {HTMLElementTagNameMap[K]} */
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
    { name: 'Dibujo', items: [['LINE', 'Línea', 'line'], ['PLINE', 'Polilínea', 'pline'], ['CIRCLE', 'Círculo', 'circle'], ['ARC', 'Arco', 'arc'], ['RECTANG', 'Rectángulo', 'rect'], ['POLYGON', 'Polígono', 'polygon'], ['ELLIPSE', 'Elipse', 'ellipse'], ['SPLINE', 'Spline', 'spline'], ['HATCH', 'Sombreado', 'hatch'], ['DIVIDE', 'Dividir', 'divide'], ['MEASURE', 'Graduar', 'measure'], ['MLINE', 'Línea múlt.', 'mline'], ['MLSTYLE', 'Estilo LM', 'mlstyle'], ['MLEDIT', 'Editar LM', 'mledit'], ['REVCLOUD', 'Nube', 'revcloud'], ['REVCLOUDEDIT', 'Editar nube', 'revcloudedit'], ['WIPEOUT', 'Cobertura', 'wipeout'], ['WIPEOUTFRAME', 'Marco', 'woframe']] },
    { name: 'Modificar', items: [['MOVE', 'Desplazar', 'move'], ['COPY', 'Copiar', 'copy'], ['ROTATE', 'Girar', 'rotate'], ['SCALE', 'Escala', 'scale'], ['MIRROR', 'Simetría', 'mirror'], ['OFFSET', 'Desfase', 'offset'], ['TRIM', 'Recortar', 'trim'], ['EXTEND', 'Alargar', 'extend'], ['FILLET', 'Empalme', 'fillet'], ['CHAMFER', 'Chaflán', 'chamfer'], ['BREAK', 'Partir', 'break'], ['LENGTHEN', 'Longitud', 'lengthen'], ['STRETCH', 'Estirar', 'stretch'], ['ARRAYRECT', 'Matriz', 'arrayrect'], ['ARRAYPOLAR', 'M. polar', 'arraypolar'], ['ARRAYPATH', 'M. recorrido', 'arraypath'], ['ARRAYEDIT', 'Editar matriz', 'arrayedit'], ['EXPLODE', 'Descomp.', 'explode'], ['JOIN', 'Unir', 'join'], ['DRAWORDER', 'Orden', 'draworder'], ['ERASE', 'Borrar', 'erase']] },
    { name: 'Cota Z', items: [['3DPOLY', 'Polil. 3D', 'poly3d'], ['3DFACE', 'Cara 3D', 'face3d'], ['ELEV', 'Elevación', 'elev'], ['FLATTEN', 'Aplanar', 'flatten']] },
    { name: 'Regiones', items: [['REGION', 'Región', 'region'], ['BOUNDARY', 'Contorno', 'boundary'], ['UNION', 'Unión', 'union'], ['SUBTRACT', 'Diferencia', 'subtract'], ['INTERSECT', 'Intersección', 'intersect']] },
    { name: 'Anotación', items: [['MTEXT', 'Texto', 'mtext'], ['DIMLINEAR', 'Lineal', 'dimlin'], ['DIMALIGNED', 'Alineada', 'dimali'], ['DIMANGULAR', 'Angular', 'dimang'], ['DIMRADIUS', 'Radio', 'dimrad'], ['MLEADER', 'Directriz', 'mleader'], ['TABLE', 'Tabla', 'table']] },
    { name: 'Bloque', items: [['BLOCK', 'Crear', 'block'], ['INSERT', 'Insertar', 'insert'], ['BEDIT', 'Editar', 'bedit'], ['ATTDEF', 'Atributo', 'attdef']] },
    { name: 'Grupos', items: [['GROUP', 'Agrupar', 'group'], ['UNGROUP', 'Desagrupar', 'ungroup'], ['GROUPEDIT', 'Editar grupo', 'groupedit'], ['CLASSICGROUP', 'Grupos', 'groups']] },
    { name: 'Capas', custom: 'layers' },
    { name: 'Herramientas de capa', items: [['LAYISO', 'Aislar', 'layiso'], ['LAYUNISO', 'Desaislar', 'layuniso'], ['LAYWALK', 'Recorrer', 'laywalk'], ['LAYMRG', 'Fusionar', 'laymrg'], ['LAYFILTER', 'Filtros', 'layfilter']] },
    { name: 'Propiedades', custom: 'props' },
    { name: 'Utilidades', items: [['DIST', 'Distancia', 'dist'], ['AREA', 'Área', 'area'], ['LIST', 'Lista', 'list'], ['QSELECT', 'Sel. rápida', 'qselect'], ['FILTER', 'Filtro', 'filter'], ['FIND', 'Buscar', 'find'], ['OVERKILL', 'Duplicados', 'overkill'], ['AUDIT', 'Revisar', 'audit']] },
  ] },
  { tab: 'Insertar', groups: [
    { name: 'Bloque', items: [['BLOCK', 'Crear bloque', 'block'], ['INSERT', 'Insertar', 'insert'], ['BEDIT', 'Editor de bloques', 'bedit'], ['EXPLODE', 'Descomponer', 'explode'], ['PURGE', 'Limpiar', 'trash']] },
    { name: 'Bloque dinámico', items: [['BPARAMETER', 'Parámetro', 'bparam'], ['BVSTATE', 'Estados', 'bvstate'], ['BVHIDE', 'Ocultar', 'bvhide'], ['BVSHOW', 'Mostrar', 'bvshow'], ['BLOOKUPTABLE', 'Tabla consulta', 'lookup']] },
    { name: 'Referencia', items: [['XATTACH', 'Enlazar', 'xattach'], ['XREF', 'Referencias externas', 'xref'], ['IMAGEATTACH', 'Imagen', 'image'], ['XCLIP', 'Delimitar', 'xclip']] },
    { name: 'Atributos', items: [['ATTDEF', 'Definir atributo', 'attdef'], ['ATTEDIT', 'Editar atributos', 'attedit']] },
    { name: 'Importar', items: [['OPEN', 'Abrir DXF', 'dxf'], ['PASTECLIP', 'Pegar', 'copy']] },
  ] },
  { tab: 'Anotar', groups: [
    { name: 'Texto', items: [['MTEXT', 'Líneas múltiples', 'mtext'], ['TEXT', 'Una línea', 'text'], ['FIELD', 'Campo', 'field'], ['STYLE', 'Estilo de texto', 'textstyle']] },
    { name: 'Cotas', items: [['DIMLINEAR', 'Lineal', 'dimlin'], ['DIMALIGNED', 'Alineada', 'dimali'], ['DIMANGULAR', 'Angular', 'dimang'], ['DIMRADIUS', 'Radio', 'dimrad'], ['DIMDIAMETER', 'Diámetro', 'dimdia'], ['DIMORDINATE', 'Coordenada', 'dimord'], ['DIMARC', 'Long. de arco', 'dimarc'], ['DIMJOGGED', 'Recodo', 'dimjog'], ['CENTERMARK', 'Marca centro', 'centermark'], ['CENTERLINE', 'Línea centro', 'centerline'], ['DIMBREAK', 'Romper cota', 'dimbreak'], ['DIMOVERRIDE', 'Modificar cota', 'dimovr'], ['DIMSPACE', 'Espaciar cotas', 'dimspace'], ['DIMREASSOCIATE', 'Reasociar', 'dimassoc'], ['DIMDISASSOCIATE', 'Desasociar', 'unlink'], ['DIMSTYLE', 'Estilo de cota', 'dimstyle']] },
    { name: 'Series', items: [['DIMCONTINUE', 'Continua', 'dimcont'], ['DIMBASELINE', 'Línea base', 'dimbase'], ['QDIM', 'Rápida', 'qdim']] },
    { name: 'Directrices y tablas', items: [['MLEADER', 'Directriz', 'mleader'], ['TABLE', 'Tabla', 'table'], ['MLEADERSTYLE', 'Estilo dir.', 'mlstyle'], ['TABLESTYLE', 'Estilo tabla', 'tblstyle']] },
    { name: 'Sombreado', items: [['HATCH', 'Sombreado', 'hatch'], ['GRADIENT', 'Degradado', 'gradient'], ['PATTERNS', 'Patrones', 'patlib']] },
    { name: 'Escalas de anotación', items: [['CANNOSCALE', 'Escala actual', 'annoscale'], ['ANNOTATIVE', 'Anotativo', 'annotative'], ['OBJECTSCALE', 'Escalas objeto', 'objscale'], ['AIOBJECTSCALEADD', 'Añadir actual', 'objscaleadd'], ['AIOBJECTSCALEREMOVE', 'Quitar actual', 'objscalerem'], ['SCALELISTEDIT', 'Lista escalas', 'scalelist']] },
  ] },
  { tab: 'Paramétrico', groups: [
    { name: 'Geométricas', items: [['AUTOCONSTRAIN', 'Automática', 'autocons'], ['GCCOINCIDENT', 'Coincidente', 'gccoinc'], ['GCCOLLINEAR', 'Colineal', 'gccol'], ['GCCONCENTRIC', 'Concéntrica', 'gcconc'], ['GCFIX', 'Fija', 'gcfix'], ['GCPARALLEL', 'Paralela', 'gcpar'],
      ['GCPERPENDICULAR', 'Perpend.', 'gcperp'], ['GCHORIZONTAL', 'Horizontal', 'gchoriz'], ['GCVERTICAL', 'Vertical', 'gcvert'], ['GCTANGENT', 'Tangente', 'gctan'], ['GCEQUAL', 'Igual', 'gcequal']] },
    { name: 'De cota', items: [['DCLINEAR', 'Lineal', 'dcon'], ['DCALIGNED', 'Alineada', 'dimali'], ['DCANGULAR', 'Angular', 'dimang'], ['DCRADIUS', 'Radio', 'dimrad'], ['DCDIAMETER', 'Diámetro', 'dimdia']] },
    { name: 'Administrar', items: [['DELCONSTRAINT', 'Suprimir', 'delcon'], ['PARAMETERS', 'Parámetros', 'params'], ['CONSTRAINTBAR', 'Mostrar/ocultar', 'cbar']] },
  ] },
  { tab: 'Vista', groups: [
    { name: 'Navegar', items: [['!zoomext', 'Extensión', 'zoomext'], ['!zoomwin', 'Ventana', 'zoomwin'], ['!zoomprev', 'Previo', 'zoomprev'], ['PAN', 'Encuadre', 'pan'], ['REGEN', 'Regenerar', 'regen']] },
    { name: 'Coordenadas', items: [['UCS', 'SCP', 'ucs'], ['!ucsworld', 'Universal', 'ucsworld'], ['!ucsprev', 'Previo', 'ucsprev'], ['!ucsobj', 'Objeto', 'ucsobj'], ['!ucs3p', '3 puntos', 'ucs3p'], ['UCSMAN', 'Admin. SCP', 'ucsman'], ['UCSICON', 'Icono', 'ucsicon'], ['LOCALORIGIN', 'Origen local', 'origin']] },
    { name: 'Vista girada', items: [['PLAN', 'Planta del SCP', 'plan'], ['!planworld', 'Sin giro', 'planworld'], ['DVIEW', 'Girar vista', 'twist']] },
    { name: 'Vistas y ventanas', items: [['VIEW', 'Vistas', 'view'], ['VPORTS', 'Ventanas', 'vports'], ['!vpjoin', 'Unir', 'vpjoin'], ['!vpsingle', 'Única', 'vpsingle']] },
    { name: 'Dibujo', items: [['ISODRAFT', 'Isométrico', 'iso'], ['DSETTINGS', 'Parámetros', 'settings']] },
    { name: 'Paletas', items: [['PROPERTIES', 'Propiedades', 'props'], ['LAYER', 'Capas', 'layers'], ['!palette', 'Mostrar/ocultar', 'sidebar'], ['!fullscreen', 'Pantalla completa', 'fullscreen'], ['HELP', 'Ayuda', 'help']] },
  ] },
  { tab: 'Presentación', groups: [
    { name: 'Presentación', items: [['!newlayout', 'Nueva', 'layout'], ['PAGESETUP', 'Configurar página', 'page'], ['!model', 'Modelo', 'model']] },
    { name: 'Ventanas gráficas', items: [['MVIEW', 'Ventana', 'vport'], ['MSPACE', 'Espacio modelo', 'mspace'], ['PSPACE', 'Espacio papel', 'page'], ['VPLAYER', 'Capas ventana', 'freeze']] },
    { name: 'Trazar', items: [['PLOT', 'Imprimir', 'print'], ['STYLESMANAGER', 'Estilos de trazado', 'plotstyle'], ['PDFOUT', 'PDF', 'pdf'], ['SVGOUT', 'SVG', 'svg'], ['PNGOUT', 'PNG', 'png']] },
  ] },
  { tab: 'Administrar', groups: [
    { name: 'Paletas y bibliotecas', items: [['TOOLPALETTES', 'Paleta de herramientas', 'toolpal'], ['ADCENTER', 'DesignCenter', 'adcenter'], ['LIBINSERT', 'Biblioteca vial', 'library']] },
    { name: 'Automatización', items: [['SCRIPT', 'Ejecutar guion', 'script'], ['ACTRECORD', 'Grabar', 'actrec'], ['ACTSTOP', 'Detener', 'actstop'], ['JSCONSOLE', 'Consola JS', 'jsconsole'], ['APPLOAD', 'Cargar aplicación', 'appload']] },
  ] },
  { tab: 'Salida', groups: [
    { name: 'Archivo', items: [['NEW', 'Nuevo', 'new'], ['OPEN', 'Abrir', 'open'], ['QSAVE', 'Guardar', 'save'], ['SAVEAS', 'Guardar como', 'save']] },
    { name: 'Exportar', items: [['PDFOUT', 'PDF', 'pdf'], ['!dxf2007', 'DXF 2007', 'dxf'], ['!dxf2000', 'DXF 2000', 'dxf'], ['!dxf12', 'DXF R12', 'dxf'], ['SVGOUT', 'SVG', 'svg'], ['PNGOUT', 'PNG', 'png'], ['PLOT', 'Imprimir', 'print']] },
  ] },
];

const TOGGLES = [
  ['grid', 'REJILLA', 'F7', 'Muestra la rejilla'], ['snap', 'FORZC', 'F9', 'Forzado de cursor a la rejilla'],
  ['ortho', 'ORTO', 'F8', 'Modo ortogonal'], ['polar', 'POLAR', 'F10', 'Rastreo polar'],
  ['osnap', 'REFENT', 'F3', 'Referencia a objetos (clic derecho: parámetros)'], ['otrack', 'RASTREO', 'F11', 'Rastreo de referencia a objetos'],
  ['dyn', 'DIN', 'F12', 'Entrada dinámica'], ['lwt', 'GLN', '', 'Mostrar grosores de línea'], ['iso', 'ISO', 'F5', 'Dibujo isométrico (F5: cambiar plano)'],
  ['groups', 'GRUPO', 'Ctrl+Mayús+A', 'Selección de grupos: designar un objeto designa todo su grupo'],
];
const ISO_NAMES = { top: 'superior', left: 'izquierdo', right: 'derecho' };

export class UI {
  /** @param {import('./app.js').App} app */
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
      case '!dxf2007': app.run('DXFOUT', '2007'); break;
      case '!dxf2000': app.run('DXFOUT', '2000'); break;
      case '!dxf12': app.run('DXFOUT', 'R12'); break;
      case '!ucsworld': app.run('UCS', 'Universal'); break;
      case '!planworld': app.run('PLAN', 'Universal'); break;
      case '!ucsprev': app.run('UCS', 'Previo'); break;
      case '!ucsobj': app.run('UCS', 'OBjeto'); break;
      case '!ucs3p': app.run('UCS', '3puntos'); break;
      case '!vpjoin': app.run('VPORTS', { op: 'Unir' }); break;
      case '!vpsingle': app.run('VPORTS', { op: 'ÚNica' }); break;
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
      h('div', { class: 'rb-row' },
        h('button', { class: 'rb-mini', title: 'Propiedades de capa (paleta de capas)', onclick: () => this.showPalette('layers') }, h('span', { html: icon('layers', 16) }), 'Propiedades'),
        h('button', { class: 'rb-mini', title: 'Estados de capa (LAYERSTATE): guardar y restaurar configuraciones de capas', onclick: () => this.app.run('LAYERSTATE') }, h('span', { html: icon('laystate', 16) }), 'Estados')));
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
  // ids: objetos a los que se aplica (por defecto, toda la designación); sin designación cambia la propiedad actual
  applyProp(key, value, ids = [...this.app.sel]) {
    const app = this.app, doc = app.doc;
    if (app.sel.size) {
      doc.begin();
      for (const id of ids) doc.modify(id, e => { if (key === 'pstyle' && value === 'BYLAYER') delete e.pstyle; else e[key] = value; });
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
    // Escala de anotación (la del modelo o la de la ventana gráfica activa) y visibilidad de los anotativos
    this.annoSel = h('select', { class: 'sb-anno', title: 'Escala de anotación (CANNOSCALE). En una ventana gráfica es su escala', onchange: ev => {
      const v = ev.target.value;
      if (v === '*edit*') this.app.run('SCALELISTEDIT'); else if (v === '*other*') this.app.run('CANNOSCALE'); else this.app.run('CANNOSCALE', v);
    } });
    this.annoVisEl = h('button', { class: 'sb-tg', title: 'ANNOALLVISIBLE: mostrar (atenuados) los objetos anotativos que no tienen la escala actual', onclick: () => {
      const S = this.app.doc.settings;
      S.annoAllVisible = S.annoAllVisible === 0 ? 1 : 0; this.app.doc.changed(); this.app.renderer.invalidate(); this.updateStatus();
      this.app.print(`<Objetos anotativos sin la escala actual ${S.annoAllVisible ? 'visibles (atenuados)' : 'ocultos'}>`);
    } }, 'ANOT');
    this.recEl = h('button', { class: 'sb-rec', hidden: true, title: 'Grabando acciones (ACTRECORD). Clic para terminar (ACTSTOP)', onclick: () => this.app.run('ACTSTOP') }, '● GRABANDO');
    sb.append(this.spaceEl, this.recEl, this.coordsEl, tg, this.annoSel, this.annoVisEl,
      h('button', { class: 'sb-tg icon', title: 'Zoom extensión (doble clic con rueda)', html: icon('zoomext', 16), onclick: () => this.app.zoomExtents() }),
      h('button', { class: 'sb-tg icon', title: 'Parámetros de dibujo', html: icon('settings', 16), onclick: () => this.openSettings() }));
    // Pestañas Modelo / Presentaciones (abajo a la izquierda del área de dibujo)
    this.tabsEl = h('div', { id: 'layout-tabs' });
    // Barra del editor de bloques
    this.beditName = h('b');
    this.beditBar = h('div', { id: 'bedit-bar', hidden: true }, 'Editor de bloques:', this.beditName,
      h('button', { class: 'btn', title: 'Cambiar el punto base del bloque (BASE)', onclick: () => this.app.run('BASE') }, 'Punto base'),
      h('button', { class: 'btn', title: 'Guardar el bloque sin cerrar el editor (BSAVE)', onclick: () => this.app.run('BSAVE') }, h('span', { html: icon('save', 16) }), 'Guardar'),
      h('button', { class: 'btn primary', title: 'Cerrar el editor de bloques (BCLOSE)', onclick: () => this.app.run('BCLOSE') }, h('span', { html: icon('close', 16) }), 'Cerrar'));
    $('#viewport').append(this.tabsEl, this.beditBar);
    this.updateStatus();
  }
  updateStatus() {
    const app = this.app, S = app.doc.settings, be = app.doc.bedit;
    for (const k in this.toggleEls) this.toggleEls[k].classList.toggle('on', k === 'iso' ? !!S.iso : !!app.T[k]);
    this.toggleEls.iso.textContent = S.iso ? `ISO ${{ top: 'SUP', left: 'IZQ', right: 'DER' }[S.isoPlane]}` : 'ISO';
    this.spaceEl.textContent = be ? 'EDITOR DE BLOQUES' : app.tab === 'model' ? 'MODELO' : app.vpActive ? 'MODELO (ventana)' : 'PAPEL';
    this.spaceEl.classList.toggle('paper', app.tab !== 'model' && !app.vpActive);
    if (this.recEl) this.recEl.hidden = !REC.on;
    if (this.annoSel) {
      const cur = curScale(), list = scalesOf(app.doc), paper = (app.tab !== 'model' && !app.vpActive) || !!be;
      this.annoSel.replaceChildren(...(list.some(s => s.name === cur.name) ? [] : [h('option', { value: cur.name }, cur.name)]), ...list.map(s => h('option', { value: s.name }, s.name)),
        h('option', { value: '*other*' }, 'Otra…'), h('option', { value: '*edit*' }, 'Editar lista…'));
      this.annoSel.value = cur.name; this.annoSel.disabled = paper;
      this.annoVisEl.classList.toggle('on', S.annoAllVisible !== 0);
    }
    this.beditBar.hidden = !be;
    this.tabsEl.hidden = !!be;
    if (be) this.beditName.textContent = be.name;
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
  // Coordenadas del cursor en el SCP actual
  // Coordenadas del cursor (reales, con el origen local) y Z: la del punto de referencia 3D o la elevación actual
  updateCoords(p) { const S = this.app.doc.settings, d = S.coordDec, q = toUcs(ucsOf(this.app.doc), p); this.coordsEl.textContent = `${fmt(q.x, d)}, ${fmt(q.y, d)}, ${fmt(p.z ?? S.elevation ?? 0, d)}`; }

  // ---------- Paleta lateral ----------
  buildPalette() {
    const pal = $('#palette');
    const tabs = h('div', { class: 'pal-tabs' });
    this.palTabs = {};
    this.palBodies = {};
    for (const [k, label, ic] of [['props', 'Propiedades', 'props'], ['layers', 'Capas', 'layers'], ['tools', 'Herramientas', 'toolpal']]) {
      const b = h('button', { class: 'pal-tab', onclick: () => this.showPalette(k) }, h('span', { html: icon(ic, 16) }), label);
      this.palTabs[k] = b; tabs.append(b);
      this.palBodies[k] = h('div', { class: 'pal-body' });
    }
    tabs.append(h('button', { class: 'pal-close', title: 'Cerrar paleta', html: icon('close', 16), onclick: () => this.togglePalette(false) }));
    pal.append(tabs, this.palBodies.props, this.palBodies.layers, this.palBodies.tools);
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
      if (this.palTab === 'props') this.renderProps(); else if (this.palTab === 'tools') this.renderTools(); else this.renderLayers();
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
    // Con tipos distintos, la lista de la cabecera elige qué objetos se editan (todos o los de un tipo), como en AutoCAD
    if (!types.includes(this.propType)) this.propType = '';
    const shown = this.propType ? sel.filter(e => e.type === this.propType) : sel;
    if (types.length > 1) {
      const pick = h('select', { class: 'prop-head prop-type', onchange: ev => { this.propType = ev.target.value; this.refresh(); } },
        h('option', { value: '' }, `Todos (${sel.length})`), ...types.map(t => h('option', { value: t }, `${TYPES[t].name} (${sel.filter(e => e.type === t).length})`)));
      pick.value = this.propType;
      body.append(pick);
    } else body.append(h('div', { class: 'prop-head' }, sel.length ? `${TYPES[types[0]].name} (${sel.length})` : 'Sin selección'));
    const ids = shown.map(e => e.id);
    const common = k => { if (!shown.length) return doc.cur[k]; const v = shown[0][k]; return shown.every(e => e[k] === v) ? v : '*'; };
    const mkSel = (opts, val, onch) => { const s = h('select', { onchange: e => { if (e.target.value !== '*') onch(e.target.value); } }, ...opts); if (val === '*') s.prepend(h('option', { value: '*' }, '*Varios*')); s.value = String(val); return s; };

    body.append(h('div', { class: 'prop-sec' }, 'General'));
    body.append(this.propRow('Capa', mkSel(doc.layers.map(l => h('option', { value: l.name }, l.name)), common('layer'), v => this.applyProp('layer', v, ids))));
    const col = common('color');
    body.append(this.propRow('Color', mkSel(this.colorOptions(col), col, async v => {
      if (v === '__custom') { v = await this.pickColor('#ffffff'); if (!v) return this.refresh(); }
      this.applyProp('color', v, ids);
    })));
    body.append(this.propRow('Tipo de línea', mkSel(this.ltypeOptions(), common('ltype'), v => this.applyProp('ltype', v, ids))));
    body.append(this.propRow('Grosor de línea', mkSel(this.lwOptions(), common('lw'), v => this.applyProp('lw', v === 'BYLAYER' || v === 'DEFAULT' ? v : +v, ids))));
    const stb = activeStb(doc, app.layoutShown()); // estilo de trazado con nombre, si alguna presentación usa una tabla .stb
    if (stb) {
      const ps = shown.length ? (shown.every(e => (e.pstyle || 'BYLAYER') === (shown[0].pstyle || 'BYLAYER')) ? shown[0].pstyle || 'BYLAYER' : '*') : doc.cur.pstyle || 'BYLAYER';
      body.append(this.propRow('Estilo de trazado', mkSel([h('option', { value: 'BYLAYER' }, 'PorCapa'), ...stbNames(stb).map(n => h('option', { value: n }, n))], ps, v => this.applyProp('pstyle', v, ids))));
    }
    if (shown.length && doc.groups.length) { // grupos a los que pertenecen todos los objetos designados
      const gs = groupsOf(doc, shown[0].id).filter(g => shown.every(e => g.ids.includes(e.id)));
      if (gs.length) body.append(this.propRow('Grupo', h('span', { class: 'prop-ro', title: gs.map(g => g.desc ? `${g.name}: ${g.desc}` : g.name).join('\n') }, gs.map(g => (isAnonGroup(g.name) ? `${g.name} (sin nombre)` : g.name)).join(', '))));
    }

    // Geometría: de un objeto o, si todos los mostrados son del mismo tipo, de todos a la vez (*Varios* si difieren)
    if (shown.length && shown.every(e => e.type === shown[0].type)) {
      const one = shown.length === 1, e0 = shown[0], lists = shown.map(e => propsOf(e));
      const find = (list, label) => list.find(q => !q.sec && q.label === label);
      body.append(h('div', { class: 'prop-sec' }, one ? 'Geometría' : `Geometría (${shown.length} objetos)`));
      for (const pr of lists[0]) {
        if (pr.sec) { body.append(h('div', { class: 'prop-sec' }, pr.sec)); continue; }
        if (!one && (pr.type === 'mtext' || pr.type === 'table' || !lists.every(l => find(l, pr.label)))) continue;
        const vals = shown.map((e, i) => find(lists[i], pr.label).get(e)), same = vals.every(v => JSON.stringify(v) === JSON.stringify(vals[0]));
        const raw = vals[0], VAR = '*Varios*';
        const set = v => (one ? this.setGeom(e0.id, pr, v) : this.setGeomAll(shown.map(e => e.id), pr.label, v));
        let input;
        if (pr.type === 'mtext') {
          input = h('button', { class: 'btn prop-btn', title: raw, onclick: async () => { const v = await this.editMText(/** @type {import('./types').MText | import('./types').MLeader} */ (e0), 'Editar texto de líneas múltiples'); if (v?.text) this.setGeom(e0.id, pr, v); } },
            (String(raw).split('\n')[0] || '…').slice(0, 28) + (String(raw).length > 28 || String(raw).includes('\n') ? '…' : ''));
        } else if (pr.type === 'action') {
          input = h('button', { class: 'btn prop-btn', onclick: () => set(true) }, raw);
        } else if (pr.type === 'color') {
          input = h('input', { type: 'color', value: raw, class: 'prop-color', title: same ? raw : VAR, onchange: ev => set(ev.target.value) });
        } else if (pr.type === 'table') {
          input = h('button', { class: 'btn prop-btn', onclick: async () => { const v = await this.editTable(e0); if (v) this.setGeom(e0.id, { set: (x, val) => Object.assign(x, val) }, v); } }, `Editar celdas (${raw})…`);
        } else if (pr.ro) {
          const txt = !same ? VAR : pr.type === 'num' ? fmt(raw, 4) : pr.type === 'deg' ? fmt(raw, 2) + '°' : String(raw);
          input = h('span', { class: 'prop-ro' }, txt);
        } else if (pr.type === 'bool') {
          input = h('input', { type: 'checkbox', checked: same && raw, onchange: ev => set(ev.target.checked) });
          if (!same) input.indeterminate = true;
        } else if (pr.type === 'select') {
          input = h('select', { onchange: ev => { if (ev.target.value !== '*') set(ev.target.value); } }, ...(typeof pr.options === 'function' ? pr.options(e0) : pr.options).map(([v, l]) => h('option', { value: v }, l)));
          if (!same) input.prepend(h('option', { value: '*' }, VAR));
          input.value = same ? raw : '*';
        } else {
          const shownV = !same ? '' : pr.type === 'num' ? fmt(raw, 4) : pr.type === 'ang' ? fmt(G.deg(G.normAng(raw)), 2) : raw;
          input = h('input', { type: 'text', value: shownV, placeholder: same ? '' : VAR, onkeydown: ev => { if (ev.key === 'Enter') ev.target.blur(); if (ev.key === 'Escape') { ev.target.value = shownV; ev.target.blur(); } },
            onchange: ev => {
              const s = ev.target.value;
              if (pr.type === 'text') return set(s);
              const v = parseFloat(s.replace(',', '.'));
              if (!Number.isFinite(v)) { ev.target.value = shownV; return; }
              set(pr.type === 'ang' ? G.rad(v) : v);
            } });
        }
        body.append(this.propRow(pr.label, input));
      }
    } else if (shown.length > 1) body.append(h('p', { class: 'hint' }, 'Objetos de tipos distintos: sólo se editan las propiedades generales. Elija un tipo en la lista de arriba para editar su geometría.'));
    if (!sel.length) {
      body.append(h('div', { class: 'prop-sec' }, 'Dibujo'));
      body.append(this.propRow(doc.bedit ? 'Objetos (bloque)' : app.tab === 'model' ? 'Objetos (modelo)' : 'Objetos (papel)', h('span', { class: 'prop-ro' }, String(doc.ents.length))));
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
  // Cambia la propiedad de nombre label en varios objetos a la vez (una sola operación de deshacer)
  setGeomAll(ids, label, v) {
    const doc = this.app.doc;
    doc.begin();
    for (const id of ids) doc.modify(id, /** @param {Entity} e */ e => { const pr = propsOf(e).find(q => !q.sec && q.label === label); if (pr && !pr.ro) pr.set(e, v); });
    doc.commit();
    this.app.renderer.invalidate(); this.refresh();
  }

  // ---------- Paleta de herramientas ----------
  renderTools() {
    const body = this.palBodies.tools, app = this.app;
    if (this._toolsVer === this._toolsShown && body.childNodes.length) return; // sólo se reconstruye cuando cambian las paletas
    this._toolsShown = this._toolsVer;
    const pals = this.palettes ||= loadPalettes();
    let idx = Math.min(this.palIdx || 0, pals.length - 1);
    const save = () => { savePalettes(pals); this._toolsVer = (this._toolsVer || 0) + 1; this.renderTools(); };
    const sel = h('select', { class: 'tp-sel', onchange: ev => { this.palIdx = +ev.target.value; this._toolsVer = (this._toolsVer || 0) + 1; this.renderTools(); } }, ...pals.map((p, i) => h('option', { value: i }, p.name)));
    sel.value = String(idx);
    const pal = pals[idx], grid = h('div', { class: 'tp-grid' });
    pal.tools.forEach((t, i) => {
      const it = t.kind === 'block' ? libItem(t.block) : null, b = t.kind === 'block' && !it ? app.doc.blocks[t.block] : null;
      const ico = it ? this.thumb(libPreview(it, t.vis), 44, 40) : b ? this.thumb(b.ents, 44, 40) : t.kind === 'hatch' ? this.hatchSwatch(t) : h('span', { class: 'tp-ico', html: icon(t.kind === 'command' ? 'jsconsole' : 'insert', 22) });
      const btn = h('button', { class: 'tp-tool', title: `${t.label}\n${toolDesc(t)}\nClic: usar · Arrastrar al dibujo: colocar · Clic derecho: opciones`, draggable: 'true',
        onclick: () => this.runTool(t),
        ondragstart: ev => { ev.dataTransfer.setData('text/x-trazocad-tool', JSON.stringify(t)); ev.dataTransfer.effectAllowed = 'copy'; },
        oncontextmenu: ev => {
          ev.preventDefault();
          this.contextMenu(ev.clientX, ev.clientY, [
            { label: 'Propiedades de la herramienta…', fn: async () => { if (await this.editTool(t)) save(); } },
            { label: 'Subir', fn: () => { if (i > 0) { pal.tools.splice(i - 1, 0, ...pal.tools.splice(i, 1)); save(); } } },
            { label: 'Eliminar', fn: () => { pal.tools.splice(i, 1); save(); } },
          ]);
        } }, ico, h('span', {}, t.label));
      grid.append(btn);
    });
    const fromSel = () => {
      const ts = [...app.sel].map(id => app.doc.get(id)).map(e => e && toolFromEntity(e)).filter(Boolean);
      if (!ts.length) return app.print('Designe referencias a bloques o sombreados para crear herramientas con sus propiedades.');
      pal.tools.push(...ts); save(); app.print(`${ts.length} herramienta(s) añadida(s) a la paleta "${pal.name}".`);
    };
    const bar = h('div', { class: 'tp-bar' },
      h('button', { class: 'btn', title: 'Crear herramientas a partir de los bloques o sombreados designados', onclick: fromSel }, '+ Designación'),
      h('button', { class: 'btn', title: 'Añadir una herramienta que ejecute una orden o una línea de guion', onclick: async () => { const t = /** @type {import('./toolpalettes.js').Tool} */ ({ kind: 'command', label: 'Orden', cmd: 'LINE' }); if (await this.editTool(t)) { pal.tools.push(t); save(); } } }, '+ Orden'),
      h('button', { class: 'btn', title: 'Nueva paleta vacía', onclick: async () => { const n = await this.prompt('Nueva paleta', 'Nombre', 'Mis herramientas'); if (n) { pals.push({ name: n, tools: [] }); this.palIdx = pals.length - 1; save(); } } }, 'Nueva'),
      h('button', { class: 'btn', title: 'Cambiar el nombre de la paleta', onclick: async () => { const n = await this.prompt('Renombrar paleta', 'Nombre', pal.name); if (n) { pal.name = n; save(); } } }, 'Renombrar'),
      h('button', { class: 'btn', title: 'Eliminar esta paleta', onclick: async () => { if (pals.length > 1 && await this.confirm(`¿Eliminar la paleta "${pal.name}"?`, 'Eliminar')) { pals.splice(idx, 1); this.palIdx = 0; save(); } } }, 'Eliminar'),
      h('button', { class: 'btn', title: 'Volver a las paletas de TrazoCAD (se pierden los cambios)', onclick: async () => { if (await this.confirm('¿Restablecer las paletas de herramientas por defecto?', 'Restablecer')) { this.palettes = resetPalettes(); this.palIdx = 0; this._toolsVer = (this._toolsVer || 0) + 1; this.renderTools(); } } }, 'Restablecer'));
    body.replaceChildren(h('div', { class: 'tp-head' }, sel), grid, bar, h('p', { class: 'hint' }, 'Las herramientas guardan capa, color, escala, rotación y estado de visibilidad (bloques) o patrón, escala y ángulo (sombreados). Las paletas se guardan en este navegador.'));
  }
  hatchSwatch(t) {
    const cv = h('canvas', { width: 88, height: 80, style: 'width:44px;height:40px', class: 'thumb' }), c = cv.getContext('2d');
    c.fillStyle = '#1b2027'; c.fillRect(0, 0, 88, 80);
    if (t.pattern === 'SOLID') { c.fillStyle = t.color || '#9aa4b1'; c.fillRect(10, 10, 68, 60); return cv; }
    c.strokeStyle = '#cfd6de'; c.lineWidth = 1.5; c.save(); c.beginPath(); c.rect(10, 10, 68, 60); c.clip();
    const fam = PATTERNS[t.pattern]?.fam || [];
    for (const [ang, ox, oy, dx, dy, ...dash] of fam) {
      const a = (ang + (t.angle || 0)) * Math.PI / 180, u = [Math.cos(a), -Math.sin(a)], n = [-u[1], u[0]], sp = Math.max(6, Math.abs(dy) * 2.2);
      for (let k = -12; k <= 12; k++) {
        const cx = 44 + n[0] * k * sp + ox, cy = 40 + n[1] * k * sp - oy;
        c.setLineDash(dash.length ? dash.map(v => Math.max(1, Math.abs(v) * 2.2)) : []);
        c.beginPath(); c.moveTo(cx - u[0] * 80, cy - u[1] * 80); c.lineTo(cx + u[0] * 80, cy + u[1] * 80); c.stroke();
      }
    }
    c.restore();
    return cv;
  }
  // Ejecuta una herramienta; at: punto del dibujo donde se soltó
  async runTool(t, at = null) {
    const app = this.app, doc = app.doc;
    if (t.kind === 'block') return app.run('_TOOLBLOCK', { tool: t, at });
    if (t.kind === 'hatch') {
      const S = doc.settings, prev = { layer: doc.cur.layer, color: doc.cur.color };
      S.hatchPat = t.pattern; S.hatchScale = t.scale || 1; S.hatchAng = t.angle || 0;
      if (t.layer) { doc.begin(); doc.ensureLayer(t.layer, '#ffffff'); doc.commit(); doc.cur.layer = t.layer; }
      if (t.color) doc.cur.color = t.color;
      const p = app.run('HATCH');
      if (at) { // soltado en el dibujo: sombrea la zona del punto y termina
        const t0 = () => new Promise(r => setTimeout(r, 0));
        await t0(); if (app.req?.pointLike) app.req.resolve(at);
        await t0(); if (app.req?.pointLike) app.submit('');
      }
      try { await p; } finally { Object.assign(doc.cur, prev); this.refresh(); }
      return;
    }
    const cmd = String(t.cmd || '').trim();
    if (!cmd) return;
    if (/\s/.test(cmd)) return app.run('SCRIPT', { text: cmd, name: t.label });
    return app.run(cmd);
  }
  // Propiedades de una herramienta (devuelve true si se aceptan)
  async editTool(t) {
    const F = t.kind === 'block' ? [['label', 'Nombre'], ['block', 'Bloque'], ['layer', 'Capa'], ['color', 'Color (#rrggbb, vacío = PorCapa)'], ['scale', 'Escala', 1], ['rot', 'Rotación (°)', 1], ['vis', 'Estado de visibilidad']]
      : t.kind === 'hatch' ? [['label', 'Nombre'], ['pattern', 'Patrón'], ['scale', 'Escala', 1], ['angle', 'Ángulo (°)', 1], ['layer', 'Capa'], ['color', 'Color (#rrggbb, vacío = PorCapa)']]
        : [['label', 'Nombre'], ['cmd', 'Orden o línea de guion (p. ej. CIRCLE o UCS OB)']];
    // F: [campo, etiqueta, numérico]
    const inputs = F.map(([k, label, numeric]) => /** @type {[string, boolean, HTMLInputElement, string]} */ (/** @type {unknown} */ ([k, numeric, h('input', { type: 'text', value: t[k] ?? '', class: 'full' }), label])));
    const box = h('div', { class: 'grid2' }, ...inputs.map(([, , inp, label]) => h('label', { class: 'fld' }, label, inp)));
    const ok = await this.modal('Propiedades de la herramienta', box, [{ label: 'Cancelar', value: false }, { label: 'Aceptar', value: true, primary: true }]);
    if (!ok) return false;
    for (const [k, numeric, inp] of inputs) {
      const v = inp.value.trim();
      if (!v) { if (k !== 'label' && k !== 'block' && k !== 'cmd' && k !== 'pattern') delete t[k]; continue; }
      t[k] = numeric ? (Number.isFinite(parseFloat(v.replace(',', '.'))) ? parseFloat(v.replace(',', '.')) : t[k]) : v;
    }
    return true;
  }

  // ---------- DesignCenter ----------
  // Fuentes: la biblioteca, el dibujo actual y los dibujos abiertos en el DesignCenter durante la sesión. Devuelve
  // {action: 'insert', lib, name, src} | {action: 'add', src, kind, names} | null
  designCenter() {
    const app = this.app, doc = app.doc;
    this.dcSources ||= [];
    let src = this.dcSrc || 'lib', kind = 'blocks', picked = [];
    const KINDS = [['blocks', 'Bloques'], ['layers', 'Capas'], ['textStyles', 'Estilos de texto'], ['dimStyles', 'Estilos de cota'], ['mleaderStyles', 'Estilos de directriz'], ['tableStyles', 'Estilos de tabla'], ['mlineStyles', 'Estilos de línea múltiple']];
    const left = h('div', { class: 'dc-col dc-src' }), mid = h('div', { class: 'dc-col dc-kinds' }), right = h('div', { class: 'dc-items' }), info = h('p', { class: 'hint dc-info' });
    const data = () => (src === 'doc' ? doc : this.dcSources.find(s => s.name === src)?.data);
    const pick = (name, el, multi) => {
      if (!multi) { picked = [name]; right.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); }
      else if (picked.includes(name)) { picked = picked.filter(n => n !== name); el.classList.remove('sel'); } else { picked.push(name); el.classList.add('sel'); }
      const it = src === 'lib' ? libItem(name) : null;
      info.textContent = it ? `${it.label}: ${it.desc}${it.anno ? ' · Anotativo (tamaño en el papel).' : ' · En metros: se escala según LIBUNITS.'}` : `${picked.length} elemento(s) elegido(s).`;
    };
    const renderItems = () => {
      picked = []; info.textContent = '';
      if (src === 'lib') {
        right.replaceChildren(...LIB_CATS.flatMap(cat => [h('div', { class: 'prop-sec' }, cat), h('div', { class: 'swatches blocks' }, ...LIBRARY.filter(l => l.cat === cat).map(l => {
          const el = h('button', { class: 'swatch-btn', title: l.desc, onclick: ev => pick(l.name, el, ev.ctrlKey || ev.metaKey), ondblclick: () => this.closeModalWith({ action: 'insert', lib: true, name: l.name }) }, this.thumb(libPreview(l), 96, 70), h('span', {}, l.label));
          return el;
        }))]));
        return;
      }
      const d = data();
      if (!d) { right.replaceChildren(); return; }
      if (kind === 'blocks') {
        const names = Object.keys(d.blocks || {}).filter(n => !n.startsWith('*') && !d.blocks[n].xrefDep).sort();
        right.replaceChildren(names.length ? h('div', { class: 'swatches blocks' }, ...names.map(n => {
          const el = h('button', { class: 'swatch-btn', title: n, onclick: ev => pick(n, el, ev.ctrlKey || ev.metaKey), ondblclick: () => this.closeModalWith({ action: 'insert', src: d, name: n }) }, this.thumb(d.blocks[n].ents || [], 96, 70), h('span', {}, n));
          return el;
        })) : h('p', { class: 'hint' }, 'No hay bloques.'));
        return;
      }
      const list = d[kind] || [];
      right.replaceChildren(...(list.length ? list.map(x => {
        const el = h('div', { class: 'dc-row', onclick: ev => pick(x.name, el, true) }, kind === 'layers' ? h('span', { class: 'sw', style: `background:${x.color}` }) : null, h('span', {}, x.name), doc !== d && doc[kind]?.some(y => y.name === x.name) ? h('span', { class: 'tag' }, ' ya existe') : null);
        return el;
      }) : [h('p', { class: 'hint' }, 'Vacío.')]));
    };
    const renderKinds = () => {
      mid.replaceChildren(...(src === 'lib' ? [h('div', { class: 'dc-row sel' }, 'Bloques')] : KINDS.map(([k, l]) => h('div', { class: 'dc-row' + (k === kind ? ' sel' : ''), onclick: () => { kind = k; renderKinds(); renderItems(); } }, l, h('span', { class: 'tag' }, ` ${k === 'blocks' ? Object.keys(data()?.blocks || {}).filter(n => !n.startsWith('*')).length : (data()?.[k] || []).length}`)))));
    };
    const renderSrc = () => {
      const row = (id, label) => h('div', { class: 'dc-row' + (src === id ? ' sel' : ''), onclick: () => { src = this.dcSrc = id; kind = 'blocks'; renderSrc(); renderKinds(); renderItems(); } }, label);
      left.replaceChildren(row('lib', 'Biblioteca de obras viales'), row('doc', `Dibujo actual (${doc.name})`), ...this.dcSources.map(s => row(s.name, s.name)),
        h('button', { class: 'btn', onclick: async () => {
          const f = await app.io.pickFile('Dibujos', ['.tcad', '.dxf', '.json']);
          if (!f) return;
          try {
            const text = await f.file.text(), d = /\.dxf$/i.test(f.file.name) ? readDXF(text) : JSON.parse(text);
            const blocks = Array.isArray(d.blocks) ? Object.fromEntries(d.blocks.map(b => [b.name, b])) : d.blocks || {};
            this.dcSources = [...this.dcSources.filter(s => s.name !== f.file.name), { name: f.file.name, data: { name: f.file.name, blocks, layers: d.layers || [], textStyles: d.textStyles || [], dimStyles: d.dimStyles || [], mleaderStyles: d.mleaderStyles || [], tableStyles: d.tableStyles || [], mlineStyles: d.mlineStyles || [] } }];
            src = this.dcSrc = f.file.name; kind = 'blocks'; renderSrc(); renderKinds(); renderItems();
          } catch (err) { app.print(`No se pudo leer "${f.file.name}": ${err.message}`, 'err'); }
        } }, 'Abrir dibujo…'));
    };
    renderSrc(); renderKinds(); renderItems();
    const box = h('div', { class: 'dc' }, left, mid, h('div', { class: 'dc-col grow' }, right, info));
    const p = this.modal('DesignCenter', box, [{ label: 'Cerrar', value: null },
      { label: 'Añadir al dibujo', value: () => (picked.length && src !== 'lib' && data() !== doc ? { action: 'add', src: data(), kind, names: picked } : null) },
      { label: 'Insertar', value: () => (picked.length && (src === 'lib' || kind === 'blocks') ? (src === 'lib' ? { action: 'insert', lib: true, name: picked[0] } : { action: 'insert', src: data(), name: picked[0] }) : null), primary: true }]);
    this.closeModalWith = v => { const b = document.querySelector('#modal-root .modal'); if (b) { this._appPick = v; /** @type {HTMLElement} */ (b.querySelector('.modal-head .ib')).click(); } };
    return p.then(v => { const x = this._appPick; this._appPick = null; this.closeModalWith = null; return x || v; });
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
        if (name.includes('|')) return app.print('Las capas de una referencia externa se eliminan al desenlazarla (XREF).');
        if (name === doc.cur.layer) return app.print('No se puede eliminar la capa actual.');
        if ([...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)].some(e => e.layer === name)) return app.print(`La capa "${name}" contiene objetos y no se puede eliminar.`);
        tx(() => { doc.layers = doc.layers.filter(l => l.name !== name); this.selLayer = null; });
      } }, h('span', { html: icon('trash', 16) }), 'Eliminar'),
      h('button', { class: 'btn', onclick: () => { if (this.selLayer) { doc.cur.layer = this.selLayer; this.refresh(); } } }, h('span', { html: icon('check', 16) }), 'Actual'),
      h('button', { class: 'btn', title: 'Estados de capa (LAYERSTATE)', onclick: () => app.run('LAYERSTATE') }, h('span', { html: icon('laystate', 16) }), `Estados${doc.layerStates.length ? ` (${doc.layerStates.length})` : ''}…`));
    body.append(bar);
    if (this.layFilter && this.layFilter !== '*usadas*' && !findLayerFilter(doc, this.layFilter)) this.layFilter = '';
    const fsel = h('select', { title: 'Filtro de capas', onchange: e => { this.layFilter = e.target.value; this.refresh(); } },
      h('option', { value: '' }, 'Todas las capas'), h('option', { value: '*usadas*' }, 'Capas en uso'), ...doc.layerFilters.map(f => h('option', { value: f.name }, `${f.kind === 'group' ? '▣' : '⚲'} ${f.name}`)));
    fsel.value = this.layFilter || '';
    const inv = h('input', { type: 'checkbox', checked: !!this.layFilterInv, onchange: e => { this.layFilterInv = e.target.checked; this.refresh(); } });
    body.append(h('div', { class: 'lay-bar lay-filter' }, h('span', { html: icon('layfilter', 16) }), fsel, h('label', { class: 'chk', title: 'Mostrar las capas que no pasan el filtro' }, inv, 'Invertir'),
      h('button', { class: 'btn', title: 'Filtros de capa por propiedades y por grupos (LAYFILTER)', onclick: () => app.run('LAYFILTER') }, 'Filtros…')));
    body.append(h('div', { class: 'lay-bar' }, ...[['LAYISO', 'layiso', 'Aislar', 'Aísla las capas de los objetos designados (LAYISO)'], ['LAYUNISO', 'layuniso', 'Desaislar', 'Restaura las capas aisladas (LAYUNISO)'], ['LAYWALK', 'laywalk', 'Recorrer', 'Recorre las capas mostrando sólo las elegidas (LAYWALK)'], ['LAYMRG', 'laymrg', 'Fusionar', 'Fusiona capas en otra (LAYMRG)']]
      .map(([cmd, ic, label, tip]) => h('button', { class: 'btn', title: tip, onclick: () => app.run(cmd) }, h('span', { html: icon(ic, 16) }), label))));
    const vp = app.vpActive ? doc.get(app.vpActive) : null;
    const list = h('div', { class: 'lay-list' + (vp ? ' vp' : '') });
    list.append(h('div', { class: 'lay-row head' }, h('span', {}, ''), h('span', {}, 'Nombre'), h('span', { title: 'Activada' }, 'Act.'), h('span', { title: 'Bloqueada' }, 'Bloq.'),
      vp ? h('span', { title: 'Inutilizada en la ventana gráfica actual' }, 'Vent.') : null, h('span', { title: 'Color' }, 'Col.'), h('span', {}, 'Tipo / Grosor')));
    const shownLayers = filteredLayers(doc, this.layFilter, this.layFilterInv);
    for (const l of shownLayers) {
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
            if (l.name.includes('|')) return app.print('Las capas de una referencia externa no se pueden renombrar.');
            const n = await this.prompt('Renombrar capa', 'Nuevo nombre', l.name);
            if (!n || n === l.name) return;
            if (doc.layers.some(x => x.name.toLowerCase() === n.toLowerCase())) return app.print(`La capa "${n}" ya existe.`);
            tx(() => { for (const e of [...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)]) if (e.layer === l.name) { doc.before(e); e.layer = n; } if (doc.cur.layer === l.name) doc.cur.layer = n; renameLayerInStates(doc, l.name, n); l.name = n; });
          } }, l.name),
        h('button', { class: 'ib' + (l.on ? '' : ' off'), title: l.on ? 'Desactivar' : 'Activar', html: icon(l.on ? 'eye' : 'eyeoff', 16), onclick: ev => { ev.stopPropagation(); tx(() => { l.on = !l.on; }); } }),
        h('button', { class: 'ib' + (l.lock ? ' off' : ''), title: l.lock ? 'Desbloquear' : 'Bloquear', html: icon(l.lock ? 'lock' : 'unlock', 16), onclick: ev => { ev.stopPropagation(); tx(() => { l.lock = !l.lock; }); } }),
        vp ? (() => {
          const fz = !!/** @type {import('./types').Viewport} */ (vp).frozen?.includes(l.name);
          return h('button', { class: 'ib' + (fz ? ' frz' : ''), title: fz ? 'Reutilizar en esta ventana' : 'Inutilizar en esta ventana', html: icon(fz ? 'freeze' : 'sun', 16), onclick: ev => {
            ev.stopPropagation();
            tx(() => doc.modify(vp.id, v => { const set = new Set(v.frozen || []); if (fz) set.delete(l.name); else set.add(l.name); if (set.size) v.frozen = [...set]; else delete v.frozen; }));
          } });
        })() : null,
        h('button', { class: 'lay-color', title: 'Cambiar color', style: `background:${l.color}`, onclick: async ev => { ev.stopPropagation(); const c = await this.pickColor(l.color); if (c) tx(() => { l.color = c; }); } }),
        h('span', { class: 'lay-lt' }, lt, lw));
      list.append(row);
    }
    if (shownLayers.length < doc.layers.length) list.append(h('div', { class: 'lay-row hint' }, h('span', {}, ''), h('span', {}, `${shownLayers.length} de ${doc.layers.length} capas (filtro)`)));
    body.append(list, h('p', { class: 'hint' }, 'Doble clic en un nombre: capa actual. Clic derecho: renombrar. Los objetos nuevos se dibujan en la capa actual.' +
      (vp ? ' La columna «Vent.» oculta la capa sólo en la ventana gráfica activa.' : app.tab !== 'model' ? ' Active una ventana gráfica (doble clic dentro) para inutilizar capas sólo en ella.' : '')));
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
      tip.textContent = m.polar ? `Polar: ${fmt(m.polar.d, 4)} < ${fmt(G.deg(G.normAng(m.polar.ang - ucsOf(app.doc).ang)), 0)}°` : base ? `Rastreo: ${fmt(G.dist(base, m.pt), 4)}` : 'Rastreo';
      tip.style.transform = `translate(${s.x + 12}px, ${s.y + 12}px)`;
      tip.hidden = false;
    } else tip.hidden = true;

    if (app.T.dyn && req && m.inside && !app.touchMode) {
      const base = req.opts.base || req.tmpBase;
      let html = `<div class="dp">${esc(req.prompt.replace(/:\s*$/, ''))}</div>`;
      const typed = $('#cmd-input').value;
      const u = ucsOf(app.doc), q = toUcs(u, m.pt); // distancias, ángulos y coordenadas en el SCP
      if (base && req.pointLike) html += `<div class="dv"><span>${fmt(G.dist(base, m.pt), 4)}</span><span>${fmt(G.deg(G.normAng(G.ang(base, m.pt) - u.ang)), 1)}°</span></div>`;
      else if (req.pointLike) html += `<div class="dv"><span>${fmt(q.x, 4)}</span><span>${fmt(q.y, 4)}</span></div>`;
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
  /** Diálogo modal: se resuelve con el valor del botón pulsado (si es una función, con lo que devuelve).
   * Cada diálogo devuelve su propio resultado (sin tipo común). @param {string} title @param {Node} content @param {{label: string, value: unknown, primary?: boolean}[]} buttons */
  modal(title, content, buttons) {
    return new Promise(res => {
      const root = $('#modal-root'), under = root.hidden ? [] : [...root.childNodes]; // diálogo abierto desde otro: al cerrarse vuelve el anterior
      const close = v => { root.replaceChildren(...under); root.hidden = !under.length; res(v); };
      const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
        h('div', { class: 'modal-head' }, h('span', {}, title), h('button', { class: 'ib', html: icon('close', 16), onclick: () => close(null) })),
        h('div', { class: 'modal-body' }, content),
        h('div', { class: 'modal-foot' }, ...buttons.map(b => h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label))));
      root.replaceChildren(h('div', { class: 'modal-back', onmousedown: e => { if (e.target === e.currentTarget) close(null); } }, box));
      root.hidden = false;
      box.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && /** @type {HTMLInputElement} */ (e.target).tagName === 'INPUT' && /** @type {HTMLInputElement} */ (e.target).type !== 'checkbox') { const p = buttons.find(b => b.primary); if (p) close(typeof p.value === 'function' ? p.value() : p.value); }
      });
      setTimeout(() => /** @type {HTMLElement | null} */ (box.querySelector('textarea,input,select') || box.querySelector('.btn.primary'))?.focus(), 30);
    });
  }
  // Consola de JavaScript: el código se ejecuta con la API (tc) y la aplicación (app); Ctrl+Intro ejecuta
  jsConsole() {
    const KEY = 'trazocad.jsconsole';
    let saved = '';
    try { saved = localStorage.getItem(KEY) || ''; } catch { /* sin almacenamiento */ }
    const code = h('textarea', { class: 'js-code', spellcheck: 'false', placeholder: "// Ejemplos:\n// tc.line([0, 0], [100, 50]);\n// for (let i = 0; i < 10; i++) tc.circle([i * 20, 0], 5);\n// tc.defineCommand('RECTA100', { desc: 'Recta de 100', fn: async (c, tc) => { const p = await c.getPoint('Punto inicial'); tc.line(p, [p.x + 100, p.y]); } });\n// return tc.all({ type: 'line' }).length;" });
    code.value = saved;
    const outEl = h('pre', { class: 'js-out' });
    const log = (msg, cls = '') => { outEl.append(h('div', { class: cls }, msg)); outEl.scrollTop = outEl.scrollHeight; };
    const run = async () => {
      try { localStorage.setItem(KEY, code.value); } catch { /* sin almacenamiento */ }
      try {
        const v = await runJs(this.app, code.value);
        log(v === undefined ? '✔ Hecho.' : `= ${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`, 'ok');
      } catch (err) { log(`✖ ${err.message}`, 'err'); }
      this.app.renderer.invalidate(); this.refresh();
    };
    code.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
    const help = h('p', { class: 'hint' }, 'API: tc.line, circle, arc, pline, point, text, mtext, insert (devuelven el identificador) · get, all({type, layer}), selection, select · modify, erase, transaction, layer, setLayer, undo · command(nombre, …respuestas), script(texto) · defineCommand(nombre, {aliases, desc, fn(ctx, tc)}) · print. Las coordenadas son universales; los ángulos, en grados.');
    const box = h('div', { class: 'js-console' }, code, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: run }, 'Ejecutar (Ctrl+Intro)'), h('button', { class: 'btn', onclick: () => outEl.replaceChildren() }, 'Limpiar')), outEl, help);
    return this.modal('Consola de JavaScript', box, [{ label: 'Cerrar', value: null }]);
  }
  // Aplicaciones que se cargan al iniciar; devuelve {action: 'load', startup} | {action: 'remove', name} | null
  appManager() {
    const list = startupApps(), startup = h('input', { type: 'checkbox' });
    const rows = list.length ? list.map(a => h('div', { class: 'app-row' }, h('b', {}, a.name), h('span', { class: 'hint' }, `${a.code.length.toLocaleString('es')} caracteres`),
      h('button', { class: 'btn', onclick: () => this.closeModalWith?.({ action: 'remove', name: a.name }) }, 'Quitar'))) : [h('p', { class: 'hint' }, 'No hay aplicaciones que se carguen al iniciar.')];
    const box = h('div', {}, h('div', { class: 'prop-sec' }, 'Se cargan al iniciar'), ...rows,
      h('label', { class: 'chk' }, startup, ' Cargar también al iniciar TrazoCAD (sólo .js; se guarda en este navegador)'),
      h('p', { class: 'hint' }, 'Un archivo .js se ejecuta con la API de TrazoCAD (tc) y puede definir órdenes nuevas con tc.defineCommand. Un archivo .scr se ejecuta como guion.'));
    const p = this.modal('Cargar aplicaciones (APPLOAD)', box, [{ label: 'Cerrar', value: null }, { label: 'Cargar archivo…', value: () => ({ action: 'load', startup: startup.checked }), primary: true }]);
    this.closeModalWith = v => { const b = document.querySelector('#modal-root .modal'); if (b) { this._appPick = v; /** @type {HTMLElement} */ (b.querySelector('.modal-head .ib')).click(); } };
    return p.then(v => { const x = this._appPick; this._appPick = null; this.closeModalWith = null; return x || v; });
  }
  // Barra de progreso (apertura de DXF grandes en segundo plano): set(fracción), done()
  progress(title) {
    const bar = h('div', { class: 'prog-fill' }), pct = h('span', {}, '0 %');
    const box = h('div', { class: 'prog', role: 'progressbar' }, h('div', { class: 'prog-title' }, title, ' ', pct), h('div', { class: 'prog-bar' }, bar));
    let shown = false;
    const show = setTimeout(() => { document.body.appendChild(box); shown = true; }, 150); // los archivos pequeños no la muestran
    return {
      set: f => { const p = Math.max(0, Math.min(100, Math.round(f * 100))); bar.style.width = `${p}%`; pct.textContent = `${p} %`; },
      done: () => { clearTimeout(show); if (shown) box.remove(); },
    };
  }
  /** @param {string} msg @param {string} [okLabel] @returns {Promise<boolean>} */
  confirm(msg, okLabel = 'Aceptar') {
    return this.modal('TrazoCAD', h('p', {}, msg), [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, primary: true }]).then(v => !!v);
  }
  /** @param {string} title @param {string} label @param {string} [value] @returns {Promise<string | null>} */
  prompt(title, label, value = '') {
    const inp = h('input', { type: 'text', value, class: 'full' });
    return /** @type {Promise<string | null>} */ (this.modal(title, h('label', { class: 'fld' }, label, inp), [{ label: 'Cancelar', value: null }, { label: 'Aceptar', value: () => inp.value.trim(), primary: true }]));
  }

  // Editor de texto de líneas múltiples con formato. src: texto plano o {text, rich, h, style}.
  // Devuelve {text, rich} (sin espacios ni saltos finales) o null.
  /** @param {string | {text?: string, rich?: boolean, h?: number, style?: string}} [src] @param {string} [title]
   * @returns {Promise<{text: string, rich: boolean} | null>} */
  editMText(src = '', title = 'Texto de líneas múltiples') {
    const doc = this.app.doc, o = typeof src === 'string' ? { text: src } : src;
    const h0 = o.h || doc.settings.textH, st = doc.textStyle(o.style || doc.cur.textStyle);
    const ed = h('div', { class: 'mtext-edit rich', contenteditable: 'true', spellcheck: 'true' });
    ed.style.fontFamily = `"${st.font}", Arial`;
    const base = baseFmt(h0);
    // ---- modelo: piezas {t:'s', s, f} | {t:'nl'} | {t:'stk', a, b, k, f} ----
    const css = f => [`font-size:${+(f.h / h0).toFixed(4)}em`, f.font ? `font-family:"${f.font}",Arial` : '', f.b ? 'font-weight:bold' : '', f.i ? 'font-style:italic' : '',
      f.color ? `color:${f.color}` : '', (f.u || f.o || f.k) ? `text-decoration:${[f.u && 'underline', f.o && 'overline', f.k && 'line-through'].filter(Boolean).join(' ')}` : ''].filter(Boolean).join(';');
    const write = pieces => {
      ed.replaceChildren(...pieces.map(p => {
        if (p.t === 'nl') return h('br');
        if (p.t === 'stk') return h('span', { class: 'stk', contenteditable: 'false', 'data-p': JSON.stringify(p), style: css(p.f), html: `<sup>${esc(p.a)}</sup>${p.k === '^' ? '' : p.k === '#' ? '/' : '<i class="bar"></i>'}<sub>${esc(p.b)}</sub>` });
        return h('span', { class: 'r', 'data-f': JSON.stringify(p.f), style: css(p.f) }, p.s);
      }));
      if (pieces.length && pieces[pieces.length - 1].t === 'nl') ed.append(h('br')); // el último salto necesita otro <br> para verse
    };
    const read = () => {
      const out = [];
      const walk = (n, f) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) { if (c.data) out.push({ t: 's', s: c.data.replace(/​/g, ''), f }); continue; }
          if (c.nodeType !== 1) continue;
          if (c.tagName === 'BR') { out.push({ t: 'nl' }); continue; }
          if (c.classList.contains('stk')) { out.push(JSON.parse(c.dataset.p)); continue; }
          const block = c.tagName === 'DIV' || c.tagName === 'P';
          if (block && out.length && out[out.length - 1].t !== 'nl') out.push({ t: 'nl' });
          walk(c, c.dataset.f ? JSON.parse(c.dataset.f) : f);
        }
      };
      walk(ed, base);
      while (out.length && out[out.length - 1].t === 'nl') out.pop(); // <br> final de relleno
      return out;
    };
    const plen = p => (p.t === 's' ? p.s.length : 1);
    // Posición de la selección en caracteres del modelo
    const offsetOf = (node, off) => {
      let n = 0, found = null;
      const walk = el => {
        for (const c of el.childNodes) {
          if (found !== null) return;
          if (c === node && c.nodeType === 3) { found = n + off; return; }
          if (c.nodeType === 3) { n += c.data.length; continue; }
          if (c.nodeType !== 1) continue;
          if (node === el && [...el.childNodes].indexOf(c) === off) { found = n; return; }
          if (c.tagName === 'BR' || c.classList.contains('stk')) { n += 1; continue; }
          walk(c);
        }
        if (node === el && found === null && off >= el.childNodes.length) found = n;
      };
      walk(ed);
      return found ?? n;
    };
    const getSel = () => {
      const s = getSelection();
      if (!s.rangeCount || !ed.contains(s.anchorNode)) return null;
      const r = s.getRangeAt(0), a = offsetOf(r.startContainer, r.startOffset), b = offsetOf(r.endContainer, r.endOffset);
      return [Math.min(a, b), Math.max(a, b)];
    };
    const setSel = (a, b = a) => {
      const pos = k => {
        let n = 0;
        for (const c of /** @type {NodeListOf<HTMLElement & Text>} */ (ed.childNodes)) {
          const len = c.nodeType === 3 ? c.data.length : c.tagName === 'SPAN' && c.classList.contains('r') ? c.textContent.length : 1;
          if (k <= n + len && (c.nodeType === 3 || c.classList?.contains('r'))) { const t = /** @type {Text} */ (c.nodeType === 3 ? c : c.firstChild || c); return [t, Math.min(k - n, t.data?.length ?? 0)]; }
          if (k <= n) return [ed, [...ed.childNodes].indexOf(c)];
          n += len;
        }
        return [ed, ed.childNodes.length];
      };
      const r = document.createRange(), [sn, so] = /** @type {[Node, number]} */ (pos(a)), [en, eo] = /** @type {[Node, number]} */ (pos(b));
      r.setStart(sn, so); r.setEnd(en, eo);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    };
    // Divide las piezas en los desplazamientos a y b; devuelve [antes, dentro, después]
    const cut = (pieces, a, b) => {
      const pre = [], mid = [], post = [];
      let n = 0;
      for (const p of pieces) {
        const L = plen(p), s = n, e = n + L;
        n = e;
        if (e <= a) { pre.push(p); continue; }
        if (s >= b) { post.push(p); continue; }
        if (p.t !== 's') { mid.push(p); continue; }
        const i0 = Math.max(0, a - s), i1 = Math.min(L, b - s);
        if (i0 > 0) pre.push({ ...p, s: p.s.slice(0, i0) });
        mid.push({ ...p, s: p.s.slice(i0, i1) });
        if (i1 < L) post.push({ ...p, s: p.s.slice(i1) });
      }
      return [pre, mid, post];
    };
    const apply = fn => {
      const sel = getSel();
      if (!sel || sel[0] === sel[1]) return ed.focus();
      const [pre, mid, post] = cut(read(), sel[0], sel[1]);
      fn(mid);
      write([...pre, ...mid, ...post]);
      ed.focus(); setSel(sel[0], sel[0] + mid.reduce((s, p) => s + plen(p), 0));
    };
    const setF = (key, val) => apply(mid => { for (const p of mid) if (p.f) p.f = { ...p.f, [key]: val }; });
    const toggle = key => apply(mid => { const on = !mid.filter(p => p.f).every(p => p.f[key]); for (const p of mid) if (p.f) p.f = { ...p.f, [key]: on }; });
    const stack = () => apply(mid => {
      if (mid.length === 1 && mid[0].t === 'stk') { const p = mid[0]; mid.splice(0, 1, { t: 's', s: `${p.a}${p.k}${p.b}`, f: p.f }); return; }
      const txt = mid.map(p => (p.t === 's' ? p.s : '')).join(''), m = txt.match(/^(.*?)([/#^])(.*)$/s);
      if (!m) return this.app.print('Para apilar, seleccione un texto con / (fracción), # (diagonal) o ^ (tolerancia), p. ej. 1/2.');
      mid.splice(0, mid.length, { t: 'stk', a: m[1].trim(), b: m[3].trim(), k: m[2], f: mid.find(p => p.f)?.f || base });
    });
    ed.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); /** @type {HTMLElement} */ (ed.closest('.modal').querySelector('.btn.primary')).click(); return; }
      if (e.key === 'Enter') { // salto de línea en el modelo (sin <div> del navegador)
        e.preventDefault();
        const sel = getSel() || [0, 0], [pre, , post] = cut(read(), sel[0], sel[1]);
        write([...pre, { t: 'nl' }, ...post]); setSel(sel[0] + 1);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && 'biu'.includes(e.key.toLowerCase())) { e.preventDefault(); toggle({ b: 'b', i: 'i', u: 'u' }[e.key.toLowerCase()]); }
    });
    ed.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')); });
    // ---- barra de herramientas ----
    const tb = (label, title, fn, cls = '') => h('button', { class: 'tb-btn ' + cls, title, onmousedown: e => e.preventDefault(), onclick: fn }, label);
    const fontSel = h('select', { title: 'Fuente de la selección', onmousedown: () => { saved = getSel(); }, onchange: e => { restore(); setF('font', e.target.value || null); e.target.value = ''; } },
      h('option', { value: '' }, `Fuente (${st.font})`), ...FONTS.map(f => h('option', { value: f }, f)));
    const hInp = h('input', { type: 'number', step: 'any', min: 0, value: h0, title: 'Altura de la selección (Intro para aplicar)', class: 'tb-h',
      onmousedown: () => { saved = getSel(); },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const v = parseFloat(e.target.value); if (v > 0) { restore(); setF('h', v); } } } });
    const colSel = h('select', { title: 'Color de la selección', onmousedown: () => { saved = getSel(); }, onchange: async e => {
      let v = e.target.value; e.target.value = '';
      if (v === '__custom') v = await this.pickColor('#ffffff');
      if (v === null || v === undefined) return;
      restore(); setF('color', v === 'BYLAYER' ? null : v);
    } }, h('option', { value: '' }, 'Color'), ...this.colorOptions(null));
    let saved = null;
    const restore = () => { ed.focus(); if (saved) setSel(saved[0], saved[1]); };
    const sym = ch => tb(ch, `Insertar ${ch}`, () => { ed.focus(); document.execCommand('insertText', false, ch); });
    const bar = h('div', { class: 'mt-toolbar' }, fontSel, hInp,
      tb('B', 'Negrita (Ctrl+B)', () => toggle('b'), 'b'), tb('I', 'Cursiva (Ctrl+I)', () => toggle('i'), 'i'), tb('U', 'Subrayado (Ctrl+U)', () => toggle('u'), 'u'),
      tb('O', 'Sobrerrayado', () => toggle('o'), 'o'), tb('S', 'Tachado', () => toggle('k'), 'k'), colSel,
      tb('a/b', 'Apilar o desapilar la selección (1/2, 1#2, +0.1^-0.1)', stack), sym('°'), sym('±'), sym('Ø'),
      tb('Campo…', 'Insertar un campo que se actualiza solo (fecha, archivo, presentación, escala, autor)', async () => {
        const at = getSel(), code = await this.pickField();
        if (!code) return;
        ed.focus(); if (at) setSel(at[0], at[1]);
        document.execCommand('insertText', false, code);
      }),
      tb('Quitar formato', 'Quita el formato de la selección', () => apply(mid => { for (const p of mid) if (p.f) p.f = base; })));
    write(o.rich ? parseRich(o.text, h0) : String(o.text ?? '').split('\n').flatMap((s, i) => (i ? [{ t: 'nl' }] : []).concat(s ? [{ t: 's', s, f: base }] : [])));
    const box = h('div', {}, bar, ed, h('p', { class: 'hint' }, 'Intro: nueva línea · Ctrl+Intro: aceptar. Seleccione texto y use la barra para darle formato. Las líneas se ajustan a la anchura del texto.'));
    setTimeout(() => { ed.focus(); setSel(read().reduce((s, p) => s + plen(p), 0)); }, 40);
    return this.modal(title, box, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', primary: true, value: () => {
      const pieces = read();
      while (pieces.length && pieces[pieces.length - 1].t === 'nl') pieces.pop();
      const last = pieces[pieces.length - 1];
      if (last?.t === 's') last.s = last.s.replace(/\s+$/, '');
      return buildRich(pieces, h0, st.font);
    } }]);
  }

  // Editor de las celdas de una tabla. focus: [fila, columna] inicial. Devuelve {cells, cols, rows, title, header} o null.
  editTable(e, focus = null) {
    const cells = e.cells.map(r => [...r]), cols = [...e.cols], rows = [...e.rows];
    let title = !!e.title, header = !!e.header, sel = focus || [0, 0];
    const fit = () => { while (cells.length < rows.length) cells.push([]); cells.length = rows.length; for (const r of cells) { while (r.length < cols.length) r.push(''); r.length = cols.length; } };
    const grid = h('div', { class: 'table-grid' });
    // Pegar texto con tabuladores o saltos de línea (hoja de cálculo): se reparte por las celdas
    const paste = (ev, r0, c0) => {
      const t = ev.clipboardData.getData('text/plain');
      if (!/[\t\n]/.test(t.replace(/\r?\n$/, ''))) return;
      ev.preventDefault();
      const data = t.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
      while (rows.length < r0 + data.length) rows.push(rows[rows.length - 1]);
      const wmax = Math.max(...data.map(l => l.length));
      while (cols.length < c0 + wmax) cols.push(cols[cols.length - 1]);
      fit();
      data.forEach((l, i) => l.forEach((v, j) => { cells[r0 + i][c0 + j] = v; }));
      render();
    };
    const render = () => {
      fit();
      const nc = cols.length, letters = i => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
      const tbl = h('table', {}, h('tr', {}, h('th', {}, ''), ...cols.map((_, c) => h('th', {}, letters(c)))));
      rows.forEach((_, r) => {
        const isTitle = title && r === 0, tr = h('tr', {}, h('th', {}, String(r + 1)));
        const cell = (c, span) => {
          const ta = h('textarea', { rows: 1, 'data-rc': `${r},${c}`, onfocus: () => { sel = [r, c]; }, oninput: ev => { cells[r][c] = ev.target.value; }, onpaste: ev => paste(ev, r, c) });
          ta.value = cells[r][c] ?? '';
          ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); /** @type {HTMLElement} */ (grid.closest('.modal').querySelector('.btn.primary')).click(); } });
          return h('td', { class: isTitle ? 'title' : '', colspan: span > 1 ? span : false }, ta);
        };
        if (isTitle) tr.append(cell(0, nc)); else cols.forEach((__, c) => tr.append(cell(c, 1)));
        tbl.append(tr);
      });
      grid.replaceChildren(tbl);
      setTimeout(() => /** @type {HTMLElement | null} */ (grid.querySelector(`[data-rc="${sel[0]},${title && sel[0] === 0 ? 0 : sel[1]}"]`))?.focus(), 0);
    };
    const btn = (label, fn) => h('button', { class: 'btn', onclick: () => { fn(); render(); } }, label);
    const chk = (label, get, set) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: get(), onchange: ev => { set(ev.target.checked); render(); } }), label);
    const bar = h('div', { class: 'lay-bar' },
      btn('+ Fila', () => { rows.splice(sel[0] + 1, 0, rows[sel[0]]); cells.splice(sel[0] + 1, 0, cols.map(() => '')); sel = [sel[0] + 1, sel[1]]; }),
      btn('− Fila', () => { if (rows.length > 1) { rows.splice(sel[0], 1); cells.splice(sel[0], 1); sel = [Math.min(sel[0], rows.length - 1), sel[1]]; } }),
      btn('+ Columna', () => { cols.splice(sel[1] + 1, 0, cols[sel[1]]); for (const r of cells) r.splice(sel[1] + 1, 0, ''); sel = [sel[0], sel[1] + 1]; }),
      btn('− Columna', () => { if (cols.length > 1) { cols.splice(sel[1], 1); for (const r of cells) r.splice(sel[1], 1); sel = [sel[0], Math.min(sel[1], cols.length - 1)]; } }),
      chk('Fila de título', () => title, v => { title = v; }), chk('Encabezados', () => header, v => { header = v; }));
    render();
    const box = h('div', {}, bar, grid, h('p', { class: 'hint' }, 'Escriba en las celdas (Intro: nueva línea dentro de la celda · Ctrl+Intro: aceptar). Puede pegar un rango copiado de una hoja de cálculo.'));
    return this.modal(`Tabla (${rows.length} × ${cols.length})`, box, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', primary: true, value: () => { fit(); return { cells, cols, rows, title, header }; } }]);
  }

  // Valores de los atributos de una referencia a bloque. Devuelve {ETIQUETA: valor} o null.
  editAttribs(ins) {
    const defs = blockAttdefs(ins.name), inputs = {};
    const box = h('div', { class: 'grid2' }, ...defs.map(a => {
      inputs[a.tag] = h('input', { type: 'text', value: attVal(ins, a) });
      return h('label', { class: 'fld' }, `${a.prompt || a.tag} (${a.tag})${a.invisible ? ' · invisible' : ''}`, inputs[a.tag]);
    }));
    return this.modal(`Atributos · ${ins.name}`, box, [{ label: 'Cancelar', value: null },
      { label: 'Aceptar', value: () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])), primary: true }]);
  }

  // Etiqueta, solicitud y valor por defecto de una definición de atributo
  editAttdef(a) {
    const tag = h('input', { type: 'text', value: a.tag }), pr = h('input', { type: 'text', value: a.prompt || '' }), dv = h('input', { type: 'text', value: a.def || '' });
    const box = h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Etiqueta', tag), h('label', { class: 'fld' }, 'Solicitud', pr), h('label', { class: 'fld' }, 'Valor por defecto', dv));
    return this.modal('Editar definición de atributo', box, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', primary: true,
      value: () => { const t = tag.value.trim().toUpperCase().replace(/\s+/g, '_'); return t ? { tag: t, prompt: pr.value, def: dv.value } : null; } }]);
  }

  openSettings() {
    const app = this.app, S = app.doc.settings;
    const box = h('div', { class: 'settings' });
    const sec = (t, ...k) => box.append(h('fieldset', {}, h('legend', {}, t), ...k));
    /** @param {string} label @param {string} key @param {string | number} [step] */
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
    const assocChk = h('input', { type: 'checkbox', checked: !!S.dimAssoc });
    const author = h('input', { type: 'text', value: S.author || '', placeholder: 'Para el campo %<Autor>%' });
    sec('Otros', h('div', { class: 'grid2' }, field('Altura de texto por defecto', 'textH'), field('Escala de tipo de línea', 'ltscale'), field('Decimales de coordenadas', 'coordDec', 1),
      h('label', { class: 'fld' }, 'Autor del dibujo', author),
      h('label', { class: 'chk', title: 'Las cotas nuevas se asocian a la geometría designada con referencia a objetos (DIMASSOC)' }, assocChk, 'Cotas asociativas')));
    this.modal('Parámetros de dibujo', box, [{ label: 'Cancelar', value: false }, { label: 'Aceptar', value: true, primary: true }]).then(ok => {
      if (!ok) return;
      /** @type {NodeListOf<HTMLInputElement>} */ (box.querySelectorAll('[data-key]')).forEach(inp => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v) && v >= 0) S[inp.dataset.key] = inp.dataset.key.endsWith('Dec') ? Math.min(8, Math.round(v)) : v;
      });
      S.iso = isoChk.checked; S.isoPlane = /** @type {import('./types').Settings['isoPlane']} */ (plane.value); S.dimAssoc = assocChk.checked; S.author = author.value.trim();
      app.ui.updateStatus();
      /** @type {NodeListOf<HTMLInputElement>} */ (box.querySelectorAll('[data-osnap]')).forEach(inp => { app.osnapModes[inp.dataset.osnap] = inp.checked; });
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

  // Muestra de un patrón de sombreado
  patThumb(name, extra = {}) {
    const sq = [G.P(0, 0), G.P(40, 0), G.P(40, 40), G.P(0, 40)];
    return this.thumb([{ type: 'hatch', loops: [sq], pattern: name, scale: 1, angle: 0, layer: '0', color: '#ffffff', ltype: 'BYLAYER', lw: 'BYLAYER', ...extra }], 72, 72, 0.02);
  }
  // Selector de patrón de sombreado: predefinidos, personalizados del dibujo (con carga de archivos .pat) y definido por el
  // usuario. Devuelve el nombre o null.
  pickPattern(current) {
    const app = this.app, doc = app.doc;
    let chosen = current;
    const body = h('div', {}), inch = h('input', { type: 'checkbox' });
    const render = () => {
      const grid = h('div', { class: 'swatches' });
      const tile = (name, title, extra, cls = '') => {
        const sw = h('button', { class: `swatch-btn ${cls}` + (name === chosen ? ' sel' : ''), title,
          onclick: () => { chosen = name; grid.querySelectorAll('.swatch-btn').forEach(x => x.classList.remove('sel')); sw.classList.add('sel'); },
          ondblclick: () => /** @type {HTMLElement} */ (body.closest('.modal').querySelector('.btn.primary')).click() },
        this.patThumb(name, extra), h('span', {}, name === 'USER' ? 'Usuario' : name));
        grid.append(sw);
      };
      for (const [name, p] of Object.entries(PATTERNS)) tile(name, p.desc);
      for (const [name, p] of Object.entries(doc.patterns)) tile(name, `${p.desc || name} (personalizado)`, {}, 'custom');
      const u = { ...USER_DEFAULT, ...doc.settings.hatchUser };
      tile('USER', `Definido por el usuario: líneas ${u.dbl ? 'cruzadas' : 'paralelas'} cada ${u.sp} (opción Usuario de SOMBREADO)`, { user: u });
      body.replaceChildren(grid, h('div', { class: 'lay-bar' },
        h('button', { class: 'btn', onclick: async () => {
          const f = await app.io.pickFile('Patrones de sombreado', ['.pat']);
          if (!f) return;
          const names = loadPatterns({ doc, app, print: m => app.print(m) }, await app.io.readText(f.file), inch.checked ? 25.4 : 1, f.file.name);
          if (names.length) chosen = names[0];
          render();
        } }, h('span', { html: icon('open', 16) }), 'Cargar archivo .pat…'),
        h('label', { class: 'chk', title: 'acad.pat está en pulgadas; acadiso.pat y los patrones métricos, en milímetros' }, inch, 'En pulgadas (× 25,4)')),
      h('p', { class: 'hint' }, 'Los patrones personalizados (marcados en azul) se guardan en el dibujo. El comando PATRONES permite pegar definiciones, exportarlas o eliminarlas.'));
    };
    render();
    return this.modal('Patrón de sombreado', body, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', value: () => chosen, primary: true }]);
  }

  // Administrador de patrones personalizados. Devuelve {action: 'load'|'paste'|'delete'|'export'|'use', name?, k} o null.
  patternManager() {
    const doc = this.app.doc, names = Object.keys(doc.patterns).sort();
    let sel = names[0];
    const inch = h('input', { type: 'checkbox' }), k = () => (inch.checked ? 25.4 : 1);
    const grid = h('div', { class: 'swatches' });
    for (const n of names) {
      const p = doc.patterns[n];
      const sw = h('button', { class: 'swatch-btn custom' + (n === sel ? ' sel' : ''), title: `${p.desc || n} · ${p.fam.length} familia(s) de líneas`,
        onclick: () => { sel = n; grid.querySelectorAll('.swatch-btn').forEach(x => x.classList.remove('sel')); sw.classList.add('sel'); } }, this.patThumb(n), h('span', {}, n));
      grid.append(sw);
    }
    const box = h('div', {}, names.length ? grid : h('p', { class: 'hint' }, 'El dibujo no tiene patrones personalizados. Cargue un archivo .pat de AutoCAD (acad.pat, acadiso.pat u otro) o pegue su definición.'),
      h('div', { class: 'lay-bar' }, h('label', { class: 'chk', title: 'acad.pat está en pulgadas; acadiso.pat y los patrones métricos, en milímetros' }, inch, 'Archivo en pulgadas (× 25,4)')),
      h('p', { class: 'hint' }, 'Formato .pat: una línea «*NOMBRE, descripción» y, debajo, una línea por familia: ángulo, x, y, desplazamiento, separación[, trazos…] (trazo negativo = hueco, 0 = punto).'));
    const act = a => () => ({ action: a, name: sel, k: k() });
    return this.modal('Patrones de sombreado personalizados', box, [{ label: 'Cerrar', value: null }, { label: 'Pegar definición…', value: act('paste') }, { label: 'Exportar .pat', value: act('export') },
      ...(names.length ? [{ label: 'Eliminar', value: act('delete') }, { label: 'Usar en SOMBREADO', value: act('use') }] : []), { label: 'Cargar .pat…', value: act('load'), primary: true }]);
  }
  // Texto de un patrón pegado por el usuario. Devuelve el texto o null.
  patternPaste() {
    const ta = h('textarea', { class: 'full', rows: 10, spellcheck: 'false', placeholder: '*LADRILLO45, Ladrillo a 45°\n45, 0, 0, 0, 6\n135, 0, 0, 0, 12, 6, -6' });
    ta.style.fontFamily = 'monospace';
    return this.modal('Pegar definición de patrón (.pat)', h('label', { class: 'fld' }, 'Definición', ta), [{ label: 'Cancelar', value: null }, { label: 'Cargar', value: () => ta.value, primary: true }]);
  }

  // Administrador de grupos. Devuelve {action: 'select'|'rename'|'desc'|'selectable'|'delete', name} o null.
  groupManager() {
    const doc = this.app.doc;
    let showAnon = this.showAnonGroups !== false;
    const list = () => doc.groups.filter(g => showAnon || !isAnonGroup(g.name));
    let sel = (list().at(-1) || doc.groups.at(-1))?.name;
    const tbody = h('tbody');
    const render = () => {
      tbody.replaceChildren(...list().map(g => {
        const tr = h('tr', { class: g.name === sel ? 'sel' : '', onclick: () => { sel = g.name; tbody.querySelectorAll('tr').forEach(x => x.classList.toggle('sel', x === tr)); } },
          h('td', {}, h('b', {}, g.name)), h('td', {}, g.desc || '—'), h('td', { class: 'num' }, String(g.ids.length)), h('td', {}, g.sel ? 'Sí' : 'No'));
        return tr;
      }));
    };
    const anon = h('input', { type: 'checkbox', checked: showAnon, onchange: e => { showAnon = this.showAnonGroups = e.target.checked; render(); } });
    render();
    const box = h('div', {},
      h('table', { class: 'xref-list' }, h('thead', {}, h('tr', {}, ...['Nombre', 'Descripción', 'Objetos', 'Seleccionable'].map(t => h('th', {}, t)))), tbody),
      h('div', { class: 'lay-bar' }, h('label', { class: 'chk' }, anon, 'Mostrar grupos sin nombre (*A…)')),
      h('p', { class: 'hint' }, 'Un grupo seleccionable se designa entero al designar cualquiera de sus objetos (si el botón GRUPO de la barra de estado está activado). «Desagrupar» elimina el grupo y conserva los objetos.'));
    const act = a => () => (sel ? { action: a, name: sel } : null);
    return this.modal('Grupos', box, [{ label: 'Cerrar', value: null }, { label: 'Renombrar…', value: act('rename') }, { label: 'Descripción…', value: act('desc') },
      { label: 'Seleccionable sí/no', value: act('selectable') }, { label: 'Desagrupar', value: act('delete') }, { label: 'Designar', value: act('select'), primary: true }]);
  }

  // Administrador de estados de capa. Devuelve {action: 'new'|'update'|'restore'|'rename'|'desc'|'delete', name, opts} o null.
  layerStateManager() {
    const doc = this.app.doc, S = doc.settings;
    let sel = doc.layerStates.find(s => layerStateMatches(doc, s))?.name || doc.layerStates[0]?.name;
    const tbody = h('tbody');
    for (const st of doc.layerStates) {
      const d = new Date(st.saved), now = layerStateMatches(doc, st);
      const tr = h('tr', { class: st.name === sel ? 'sel' : '', onclick: () => { sel = st.name; tbody.querySelectorAll('tr').forEach(x => x.classList.toggle('sel', x === tr)); } },
        h('td', {}, h('b', {}, st.name), now ? h('span', { class: 'tag' }, ' actual') : null), h('td', {}, st.desc || '—'), h('td', { class: 'num' }, String(Object.keys(st.layers).length)),
        h('td', {}, st.cur || '—'), h('td', {}, Number.isNaN(+d) ? '—' : d.toLocaleString('es')));
      tbody.append(tr);
    }
    const props = S.lsProps || LS_ALL;
    const checks = Object.entries(LS_PROPS).map(([k, l]) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-p': k, checked: props.includes(k) }), l));
    const offMissing = h('input', { type: 'checkbox', checked: !!S.lsOffMissing });
    const box = h('div', {},
      doc.layerStates.length
        ? h('table', { class: 'xref-list' }, h('thead', {}, h('tr', {}, ...['Nombre', 'Descripción', 'Capas', 'Capa actual', 'Guardado'].map(t => h('th', {}, t)))), tbody)
        : h('p', { class: 'hint' }, 'No hay estados de capa. «Nuevo…» guarda la configuración actual de las capas (activadas, bloqueadas, color, tipo y grosor de línea) con un nombre.'),
      h('fieldset', {}, h('legend', {}, 'Propiedades que se restauran'), h('div', { class: 'grid2' }, ...checks, h('label', { class: 'chk', title: 'Las capas creadas después de guardar el estado se desactivan al restaurarlo' }, offMissing, 'Desactivar las capas que no están en el estado'))));
    const opts = () => { const p = [.../** @type {NodeListOf<HTMLInputElement>} */ (box.querySelectorAll('[data-p]'))].filter(x => x.checked).map(x => x.dataset.p); S.lsProps = p; S.lsOffMissing = offMissing.checked; return { props: p, offMissing: offMissing.checked }; };
    const act = a => () => (a === 'new' || a === 'import' || sel ? { action: a, name: sel, opts: opts() } : null);
    return this.modal('Estados de capa', box, [{ label: 'Cerrar', value: null }, { label: 'Nuevo…', value: act('new') }, { label: 'Importar .las…', value: act('import') },
      ...(doc.layerStates.length ? [{ label: 'Exportar .las…', value: act('export') }, { label: 'Actualizar', value: act('update') }, { label: 'Renombrar…', value: act('rename') }, { label: 'Descripción…', value: act('desc') }, { label: 'Eliminar', value: act('delete') }, { label: 'Restaurar', value: act('restore'), primary: true }] : [])]);
  }

  // Editor de la tabla de consulta de un bloque dinámico. cols: claves de los parámetros ('lin:Nombre', 'rot:Nombre', 'vis', 'flip').
  // Devuelve {name, cols, rows: [{label, vals}]} o null. Las celdas vacías no cambian ese parámetro.
  lookupTableEditor(d, cols) {
    const old = d.look, title = k => (k === 'vis' ? 'Visibilidad' : k === 'flip' ? 'Simetría' : k.startsWith('lin:') ? `${k.slice(4)} (distancia)` : `${k.slice(4)} (ángulo °)`);
    const def = k => {
      if (k === 'vis') return d.vis.states[0];
      if (k === 'flip') return false;
      if (k.startsWith('lin:')) { const l = linsOf(d).find(x => x.name === k.slice(4)); return +G.dist(l.p1, l.p2).toFixed(6); }
      const r = rotsOf(d).find(x => x.name === k.slice(4)); return +G.deg(G.ang(r.c, r.p)).toFixed(6);
    };
    const rows = old?.rows?.length
      ? old.rows.map(r => ({ label: r.label, vals: cols.map(k => { const j = old.cols.indexOf(k); return j >= 0 ? r.vals[j] : null; }) }))
      : [{ label: 'Fila1', vals: cols.map(def) }];
    const name = h('input', { type: 'text', value: old?.name || 'Consulta' });
    const tbody = h('tbody');
    const cell = (r, j) => {
      const k = cols[j], v = r.vals[j];
      if (k === 'vis') { const s = h('select', { onchange: e => { r.vals[j] = e.target.value || null; } }, h('option', { value: '' }, '—'), ...d.vis.states.map(x => h('option', { value: x }, x))); s.value = v ?? ''; return s; }
      if (k === 'flip') { const s = h('select', { onchange: e => { r.vals[j] = e.target.value === '' ? null : e.target.value === '1'; } }, h('option', { value: '' }, '—'), h('option', { value: '1' }, 'Invertido'), h('option', { value: '0' }, 'Normal')); s.value = v == null ? '' : v ? '1' : '0'; return s; }
      return h('input', { type: 'text', value: v ?? '', class: 'num', onchange: e => { const t = e.target.value.trim().replace(',', '.'); const n = parseFloat(t); r.vals[j] = t === '' || !Number.isFinite(n) ? null : n; e.target.value = r.vals[j] ?? ''; } });
    };
    const render = () => {
      tbody.replaceChildren(...rows.map((r, i) => h('tr', {},
        h('td', {}, h('input', { type: 'text', value: r.label, onchange: e => { r.label = e.target.value.trim(); } })),
        ...cols.map((_, j) => h('td', {}, cell(r, j))),
        h('td', {}, h('button', { class: 'ib', title: 'Eliminar fila', html: icon('trash', 14), onclick: () => { rows.splice(i, 1); render(); } })))));
    };
    render();
    const add = h('button', { class: 'btn', onclick: () => { rows.push({ label: `Fila${rows.length + 1}`, vals: cols.map(def) }); render(); } }, h('span', { html: icon('plus', 16) }), 'Añadir fila');
    const box = h('div', {}, h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Nombre de la consulta', name)), h('div', { class: 'lay-bar' }, add),
      h('table', { class: 'xref-list params' }, h('thead', {}, h('tr', {}, h('th', {}, 'Fila'), ...cols.map(k => h('th', {}, title(k))), h('th', {}, ''))), tbody),
      h('p', { class: 'hint' }, 'Cada fila fija a la vez los parámetros indicados; una celda vacía (—) deja ese parámetro como esté. Las distancias van en unidades del bloque y los ángulos en grados.'));
    return this.modal('Tabla de consulta', box, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', primary: true, value: () => ({ name: name.value.trim() || 'Consulta', cols, rows: rows.filter(r => r.label) }) }]);
  }

  // Administrador de referencias externas. Devuelve {action: 'attach'|'reload'|'detach'|'bind', name} o null.
  xrefManager() {
    const doc = this.app.doc, names = xrefNames(doc).sort();
    let sel = names[0];
    const tbody = h('tbody');
    for (const n of names) {
      const b = doc.blocks[n], d = new Date(b.xref.loaded), mem = h('td', {}, '…');
      recallXref(b.xref.file).then(src => { mem.textContent = !src ? 'No' : src instanceof Blob ? 'Copia' : 'Sí'; });
      const tr = h('tr', { class: n === sel ? 'sel' : '', onclick: () => { sel = n; tbody.querySelectorAll('tr').forEach(x => x.classList.toggle('sel', x === tr)); } },
        h('td', {}, h('b', {}, n)), h('td', {}, b.xref.file), h('td', {}, String(xrefRefs(doc, n))), h('td', {}, String(b.ents.length)),
        h('td', {}, b.xref.loaded && !Number.isNaN(+d) ? d.toLocaleString('es') : 'Sin cargar'), mem);
      tbody.append(tr);
    }
    const box = h('div', {},
      h('table', { class: 'xref-list' }, h('thead', {}, h('tr', {}, ...['Nombre', 'Archivo', 'Inserciones', 'Objetos', 'Cargada', 'Recordada'].map(t => h('th', {}, t)))), tbody),
      h('p', { class: 'hint' }, 'El contenido de cada referencia se guarda en caché dentro del dibujo. «Recargar» vuelve a leer el archivo; «Unir» la convierte en un bloque normal; «Desenlazar» la elimina. Los archivos «recordados» se vuelven a leer solos al abrir el dibujo en otra sesión (si el navegador conserva el permiso).'));
    const act = a => () => ({ action: a, name: sel });
    return this.modal('Referencias externas', box, [{ label: 'Cerrar', value: null }, { label: 'Enlazar…', value: act('attach') }, { label: 'Desenlazar', value: act('detach') },
      { label: 'Unir', value: act('bind') }, { label: 'Recargar', value: act('reload'), primary: true }]);
  }

  // Selector de bloque con vista previa. Devuelve el nombre o null.
  pickBlock() {
    const doc = this.app.doc, names = Object.keys(doc.blocks).filter(n => !n.startsWith('*') && !doc.blocks[n].xrefDep).sort();
    let chosen = names[0];
    const grid = h('div', { class: 'swatches blocks' });
    for (const name of names) {
      const b = doc.blocks[name];
      const sw = h('button', { class: 'swatch-btn' + (name === chosen ? ' sel' : ''), title: `${name} · ${b.ents.length} objeto(s)`,
        onclick: () => { chosen = name; grid.querySelectorAll('.swatch-btn').forEach(x => x.classList.remove('sel')); sw.classList.add('sel'); },
        ondblclick: () => /** @type {HTMLElement} */ (grid.closest('.modal').querySelector('.btn.primary')).click() },
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
        if (f.render) return h('div', { class: 'fld wide' }, f.label, f.render(s, () => prev.replaceChildren(preview(s))));
        let inp;
        if (f.options) { inp = h('select', {}, ...(typeof f.options === 'function' ? f.options() : f.options).map(([v, l]) => h('option', { value: v }, l))); inp.value = String(s[f.key]); }
        else if (f.type === 'bool') inp = h('input', { type: 'checkbox', checked: !!s[f.key] });
        else inp = h('input', { type: f.type || 'number', step: 'any', value: s[f.key] ?? '' });
        inp.addEventListener('change', () => {
          if (f.type === 'bool') { if (inp.checked) s[f.key] = true; else delete s[f.key]; } else s[f.key] = f.type === 'text' || f.options ? inp.value : parseFloat(inp.value) || 0;
          prev.replaceChildren(preview(s));
        });
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
    // Las referencias a estilos eliminados pasan al estilo base
    const refs = { textStyles: [['text', 'mtext', 'attdef', 'mleader', 'table'], 'style'], dimStyles: [['dim'], 'style'], mleaderStyles: [['mleader'], 'mstyle'], tableStyles: [['table'], 'tstyle'], mlineStyles: [['mline'], 'mlstyle'] }[listKey];
    for (const e of [...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)]) if (refs[0].includes(e.type) && e[refs[1]] != null && !names.has(e[refs[1]])) { doc.before(e); e[refs[1]] = work[0].name; }
    if (listKey === 'textStyles') for (const d of [...doc.dimStyles, ...doc.mleaderStyles, ...doc.tableStyles]) if (!names.has(d.textStyle)) d.textStyle = work[0].name;
    for (const b of Object.values(doc.blocks)) b.ver = (b.ver || 0) + 1;
    doc.changed();
    doc.commit();
    this.app.renderer.invalidate();
  }

  textStyleManager() {
    return this.styleManager({
      title: 'Estilos de texto', listKey: 'textStyles', curKey: 'textStyle', make: s => s,
      fields: [{ key: 'font', label: 'Fuente', options: FONTS.map(f => [f, f]) }, { key: 'width', label: 'Factor de anchura' }, { key: 'oblique', label: 'Ángulo oblicuo (°)' }, { key: 'annotative', label: 'Anotativo (tamaños en el papel)', type: 'bool' }],
      preview: s => {
        const el = h('div', { class: 'text-sample' }, 'AaBbCc 0123 ÁÑ');
        el.style.fontFamily = `"${s.font}", Arial`;
        el.style.transform = `scaleX(${s.width || 1}) skewX(${-(s.oblique || 0)}deg)`;
        return el;
      },
    });
  }

  mleaderStyleManager() {
    const doc = this.app.doc;
    return this.styleManager({
      title: 'Estilos de directriz múltiple', listKey: 'mleaderStyles', curKey: 'mleaderStyle', make: s => s,
      fields: [
        { key: 'h', label: 'Altura de texto' }, { key: 'textStyle', label: 'Estilo de texto', options: () => doc.textStyles.map(t => [t.name, t.name]) }, { key: 'annotative', label: 'Anotativo (tamaños en el papel)', type: 'bool' },
        { key: 'arrow', label: 'Punta de flecha', options: Object.entries(ARROWS) }, { key: 'asz', label: 'Tamaño de flecha' },
        { key: 'land', label: 'Longitud del rellano' }, { key: 'gap', label: 'Separación del texto' },
        { key: 'content', label: 'Contenido por defecto', options: ML_CONTENT },
      ],
      preview: s => {
        const name = '__prev__', saved = doc.mleaderStyles;
        doc.mleaderStyles = [{ ...DEFAULT_MLSTYLE, ...s, name }];
        const P = G.P, base = { type: 'mleader', mstyle: name, w: 0, layer: '0', color: '#ffffff', ltype: 'BYLAYER', lw: 'BYLAYER' };
        const cv = this.thumb([{ ...base, pts: [P(0, 0), P(15, 12)], content: 'mtext', text: 'Texto de nota' }, { ...base, pts: [P(40, 0), P(52, 12)], content: 'block', text: '1' }], 260, 120, 0.1);
        doc.mleaderStyles = saved;
        return cv;
      },
    });
  }

  // Estilos de línea múltiple: elementos (desfase, color, tipo de línea), remates, ingletes y relleno
  mlineStyleManager() {
    const doc = this.app.doc;
    const ltOpts = [['BYLAYER', 'PorCapa'], ['BYBLOCK', 'PorBloque'], ...Object.entries(LTYPES).map(([k, v]) => [k, `${k} · ${v.desc}`])];
    const elemsEditor = (s, changed) => {
      const box = h('div', { class: 'ml-elems' });
      const draw = () => {
        s.elems.sort((a, b) => b.off - a.off);
        box.replaceChildren(h('table', { class: 'xref-list' }, h('thead', {}, h('tr', {}, ...['Desfase', 'Color', 'Tipo de línea', ''].map(t => h('th', {}, t)))),
          h('tbody', {}, ...s.elems.map((el, i) => {
            const off = h('input', { type: 'number', step: 'any', value: el.off, onchange: ev => { const v = parseFloat(ev.target.value); if (Number.isFinite(v)) { el.off = v; draw(); changed(); } } });
            const own = el.color !== 'BYLAYER' && el.color !== 'BYBLOCK';
            const col = h('select', { onchange: async ev => { let v = ev.target.value; if (v === '__custom') v = (await this.pickColor(own ? el.color : '#ffffff')) || el.color; el.color = v; draw(); changed(); } },
              h('option', { value: 'BYLAYER' }, 'PorCapa'), h('option', { value: 'BYBLOCK' }, 'PorBloque'), ...COLORS.map(([v, l]) => h('option', { value: v }, l)), ...(own && !COLORS.some(([v]) => v === el.color) ? [h('option', { value: el.color }, el.color)] : []), h('option', { value: '__custom' }, 'Otro…'));
            col.value = el.color;
            const lt = h('select', { onchange: ev => { el.ltype = ev.target.value; changed(); } }, ...ltOpts.map(([v, l]) => h('option', { value: v }, l)));
            lt.value = el.ltype || 'BYLAYER';
            const del = h('button', { class: 'btn', title: 'Eliminar elemento', onclick: () => { if (s.elems.length > 1) { s.elems.splice(i, 1); draw(); changed(); } } }, '×');
            return h('tr', {}, h('td', {}, off), h('td', {}, col), h('td', {}, lt), h('td', {}, del));
          }))),
          h('button', { class: 'btn', onclick: () => { if (s.elems.length < 16) { s.elems.push({ off: 0, color: 'BYLAYER', ltype: 'BYLAYER' }); draw(); changed(); } } }, h('span', { html: icon('plus', 16) }), 'Añadir elemento'));
      };
      draw();
      return box;
    };
    const capsEditor = (s, changed) => h('div', { class: 'grid2' }, ...Object.entries(CAP_KEYS).map(([k, l]) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!s.caps?.[k], onchange: ev => { s.caps = { ...s.caps, [k]: ev.target.checked }; changed(); } }), l)),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!s.joints, onchange: ev => { s.joints = ev.target.checked; changed(); } }), 'Mostrar uniones (ingletes)'));
    const fillEditor = (s, changed) => {
      const col = h('input', { type: 'color', value: s.fill || '#4a6fa5', class: 'prop-color', disabled: !s.fill, onchange: ev => { s.fill = ev.target.value; changed(); } });
      return h('div', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!s.fill, onchange: ev => { s.fill = ev.target.checked ? col.value : null; col.disabled = !ev.target.checked; changed(); } }), 'Relleno', col);
    };
    return this.styleManager({
      title: 'Estilos de línea múltiple', listKey: 'mlineStyles', curKey: 'mlineStyle', make: s => JSON.parse(JSON.stringify(s)),
      fields: [{ key: 'desc', label: 'Descripción', type: 'text' }, { label: 'Elementos', render: elemsEditor }, { label: 'Remates', render: capsEditor }, { label: 'Relleno', render: fillEditor }],
      preview: s => {
        const name = '__prev__', saved = doc.mlineStyles, offs = s.elems.map(x => x.off), w = Math.max(...offs) - Math.min(...offs) || 1;
        doc.mlineStyles = [{ ...s, name }];
        const cv = this.thumb([{ type: 'mline', pts: samplePts(12 * w), closed: false, just: 'zero', scale: 1, mlstyle: name, layer: '0', color: '#ffffff', ltype: 'BYLAYER', lw: 'BYLAYER' }], 260, 110, 0.12);
        doc.mlineStyles = saved;
        return cv;
      },
    });
  }

  // Herramientas de MLEDIT con una muestra de cada una, hecha con la propia operación sobre el estilo actual. Devuelve la clave o null.
  mleditDialog() {
    const doc = this.app.doc, cur = doc.mlineStyle(doc.cur.mlineStyle), offs = sortedElems(cur).map(x => x.off), wd = Math.max(...offs) - Math.min(...offs) || 1;
    const name = '__mle__', st = { ...JSON.parse(JSON.stringify(cur)), name, fill: null }, k = 4 / wd, P = G.P;
    /** @param {import('./types').Point[]} pts */
    const ml = pts => /** @type {import('./types').MLine} */ ({ type: 'mline', pts, closed: false, just: 'zero', scale: k, mlstyle: name, layer: '0', color: '#ffffff', ltype: 'BYLAYER', lw: 'BYLAYER' });
    const dot = p => ({ type: 'point', p, layer: '0', color: '#f0b429', ltype: 'BYLAYER', lw: 'BYLAYER' });
    const sample = t => {
      if (['CC', 'OC', 'MC'].includes(t)) { const A = ml([P(-10, 0), P(10, 0)]), B = ml([P(0, -10), P(0, 10)]); mlCross(A, st, P(-5, 0), B, st, P(0, -5), t); return [A, B]; }
      if (['CT', 'OT', 'MT'].includes(t)) { const A = ml([P(0, -10), P(0, 0)]), B = ml([P(-10, 4), P(10, 4)]); mlTee(A, st, P(0, -5), B, st, P(5, 4), t); return [A, B]; }
      if (t === 'CJ') { const A = ml([P(-10, 3), P(3, 3)]), B = ml([P(0, -10), P(0, 6)]); mlCorner(A, st, P(-5, 3), B, st, P(0, -5)); return [A, B]; }
      if (t === 'AV') return [ml([P(-10, -4), P(0, 4), P(10, -4)]), dot(P(0, 4))];
      if (t === 'DV') return [ml([P(-10, 0), P(10, 0)]), dot(P(0, 0))];
      const A = ml([P(-10, 0), P(10, 0)]);
      if (t === 'CS') mlCutRange(A, P(-3, 2), P(3, 2), [0]);
      if (t === 'CA') mlCutRange(A, P(-3, 0), P(3, 0), offs.map((_, i) => i));
      return [A];
    };
    const saved = doc.mlineStyles;
    doc.mlineStyles = [st];
    let res = null;
    const grid = h('div', { class: 'swatches mledit' }, ...Object.entries(MLEDIT_TOOLS).map(([t, label]) => h('button', { class: 'swatch-btn', title: `${label} (${t})`,
      onclick: ev => { res = t; /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.currentTarget).closest('.modal').querySelector('.btn.primary')).click(); } }, this.thumb(sample(t), 84, 64, 0.1), h('span', {}, label))));
    doc.mlineStyles = saved;
    return this.modal('Herramientas de edición de líneas múltiples', h('div', {}, grid, h('p', { class: 'hint' }, 'Elija una herramienta y designe después las líneas múltiples. En los cruces y las uniones se conserva la parte de cada línea por la que se designa.')),
      [{ label: 'Cancelar', value: null }, { label: 'Aceptar', value: () => res, primary: true }]);
  }

  tableStyleManager() {
    const doc = this.app.doc;
    return this.styleManager({
      title: 'Estilos de tabla', listKey: 'tableStyles', curKey: 'tableStyle', make: s => s,
      fields: [
        { key: 'th', label: 'Altura de texto' }, { key: 'textStyle', label: 'Estilo de texto', options: () => doc.textStyles.map(t => [t.name, t.name]) },
        { key: 'margin', label: 'Margen de celda (× altura)' }, { key: 'titleScale', label: 'Escala del título' },
        { key: 'align', label: 'Alineación de datos', options: [['auto', 'Automática (números a la derecha)'], ['l', 'Izquierda'], ['c', 'Centro'], ['r', 'Derecha']] },
      ],
      preview: s => {
        const name = '__prev__', saved = doc.tableStyles;
        doc.tableStyles = [{ ...DEFAULT_TBLSTYLE, ...s, name }];
        const th = s.th || 2.5;
        const cv = this.thumb([{ type: 'table', p: G.P(0, 0), rot: 0, tstyle: name, cols: [th * 4, th * 10, th * 5], rows: [th * 2.4, th * 2.2, th * 2.2, th * 2.2], title: true, header: true,
          cells: [['Título', '', ''], ['N.º', 'Descripción', 'Cant.'], ['1', 'Placa', '2'], ['2', 'Tornillo M8', '12']], layer: '0', color: '#ffffff', ltype: 'BYLAYER', lw: 'BYLAYER' }], 260, 130, 0.06);
        doc.tableStyles = saved;
        return cv;
      },
    });
  }

  // Administrador de parámetros. Devuelve {cons: {id: {name, expr}}, params: [{name, expr}]} o null.
  parametersManager() {
    const doc = this.app.doc, { vals, errors } = evalParams(doc);
    /** @type {{kind: 'cons' | 'user', id?: number, name: string, expr: string, type?: string}[]} */
    const rows = [...doc.constraints.filter(k => k.name).map(k => ({ kind: /** @type {const} */ ('cons'), id: k.id, name: k.name, expr: k.expr, type: k.type })), ...doc.params.map(p => ({ kind: /** @type {const} */ ('user'), name: p.name, expr: p.expr }))];
    const tbody = h('tbody');
    const TYPE = { dist: 'Distancia', radius: 'Radio', diameter: 'Diámetro', angle: 'Ángulo (°)' };
    const render = () => {
      tbody.replaceChildren(...rows.map((r, i) => {
        const name = h('input', { type: 'text', value: r.name, oninput: e => { r.name = e.target.value.trim(); } });
        const expr = h('input', { type: 'text', value: r.expr, oninput: e => { r.expr = e.target.value.trim(); } });
        const v = vals.get(r.name);
        return h('tr', {}, h('td', {}, name), h('td', {}, expr), h('td', { class: 'num' }, errors.has(r.name) ? '⚠ ' + errors.get(r.name) : v == null ? '' : fmt(v, 4)),
          h('td', {}, r.kind === 'cons' ? TYPE[r.type] : 'Usuario'),
          h('td', {}, r.kind === 'user' ? h('button', { class: 'ib', title: 'Eliminar', html: icon('trash', 14), onclick: () => { rows.splice(i, 1); render(); } }) : ''));
      }));
    };
    render();
    const add = h('button', { class: 'btn', onclick: () => { let i = 1; while (rows.some(r => r.name === `usuario${i}`)) i++; rows.push({ kind: 'user', name: `usuario${i}`, expr: '10' }); render(); } }, h('span', { html: icon('plus', 16) }), 'Parámetro de usuario');
    const box = h('div', {}, h('div', { class: 'lay-bar' }, add),
      h('table', { class: 'xref-list params' }, h('thead', {}, h('tr', {}, ...['Nombre', 'Expresión', 'Valor', 'Tipo', ''].map(t => h('th', {}, t)))), tbody),
      h('p', { class: 'hint' }, 'Las expresiones admiten números, otros parámetros, + − × ÷ ^, paréntesis, pi y sin, cos, tan, sqrt, abs (ángulos en grados). Ejemplo: d2 = d1/2 + 5.'));
    return this.modal('Administrador de parámetros', box, [{ label: 'Cancelar', value: null }, { label: 'Aplicar', primary: true, value: () => {
      const names = rows.map(r => r.name);
      if (names.some((n, i) => !/^[A-Za-zÁÉÍÓÚáéíóúÑñ_][\wÁÉÍÓÚáéíóúÑñ]*$/.test(n) || names.indexOf(n) !== i)) { this.app.print('Hay nombres vacíos, repetidos o no válidos: no se aplican los cambios.'); return null; }
      return { cons: Object.fromEntries(rows.filter(r => r.kind === 'cons').map(r => [r.id, { name: r.name, expr: r.expr }])), params: rows.filter(r => r.kind === 'user').map(r => ({ name: r.name, expr: r.expr })) };
    } }]);
  }

  // Selector de campo (sin objetos). Devuelve el código %<…>% o null.
  pickField() {
    const kind = h('select', {}, ...[['Fecha', 'Fecha'], ['Archivo', 'Nombre del dibujo'], ['Presentación', 'Presentación'], ['Escala', 'Escala de la ventana'], ['Autor', 'Autor']].map(([v, l]) => h('option', { value: v }, l)));
    const fmtSel = h('select', {}, ...DATE_FORMATS.map(f => h('option', { value: f }, `${f}  →  ${formatDate(new Date(), f)}`)));
    const box = h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Campo', kind), h('label', { class: 'fld' }, 'Formato de fecha', fmtSel),
      h('p', { class: 'hint' }, 'Para la propiedad de un objeto (área, longitud…) use el comando CAMPO.'));
    return this.modal('Insertar campo', box, [{ label: 'Cancelar', value: null }, { label: 'Insertar', primary: true,
      value: () => (kind.value === 'Fecha' ? (fmtSel.value === DATE_FORMATS[0] ? '%<Fecha>%' : `%<Fecha:${fmtSel.value}>%`) : `%<${kind.value}>%`) }]);
  }

  dimStyleManager() {
    const doc = this.app.doc;
    return this.styleManager({
      title: 'Estilos de cota', listKey: 'dimStyles', curKey: 'dimStyle', make: s => s,
      fields: [
        { key: 'annotative', label: 'Anotativo (tamaños en el papel)', type: 'bool' }, { key: 'txt', label: 'Altura de texto' }, { key: 'asz', label: 'Tamaño de flecha' },
        { key: 'arrow', label: 'Tipo de flecha', options: Object.entries(ARROWS) },
        { key: 'textStyle', label: 'Estilo de texto', options: () => doc.textStyles.map(t => [t.name, t.name]) },
        { key: 'gap', label: 'Separación del texto' }, { key: 'exo', label: 'Desfase desde origen' },
        { key: 'exe', label: 'Prolongación línea ref.' }, { key: 'dec', label: 'Decimales' }, { key: 'adec', label: 'Decimales angulares' }, { key: 'dli', label: 'Separación línea base' },
        { key: 'scale', label: 'Escala global' }, { key: 'suffix', label: 'Sufijo (p. ej. mm)', type: 'text' },
        { key: 'tol', label: 'Tolerancia', options: Object.entries(TOL_MODES) }, { key: 'tp', label: 'Desviación superior' },
        { key: 'tm', label: 'Desviación inferior' }, { key: 'tdec', label: 'Decimales de tolerancia' }, { key: 'tfac', label: 'Escala de altura de tolerancia' },
      ],
      preview: s => {
        const name = '__prev__', saved = doc.dimStyles;
        doc.dimStyles = [{ ...DEFAULT_DIMSTYLE, ...s, name }];
        const ents = [{ type: 'line', p1: G.P(0, 0), p2: G.P(30, 0) }, { type: 'line', p1: G.P(30, 0), p2: G.P(30, 15) }, { type: 'line', p1: G.P(0, 0), p2: G.P(30, 15) },
          { type: 'dim', kind: 'lin', p1: G.P(0, 0), p2: G.P(30, 0), p3: G.P(15, -8), rot: 0, style: name },
          { type: 'dim', kind: 'lin', p1: G.P(30, 0), p2: G.P(30, 15), p3: G.P(38, 7), rot: Math.PI / 2, style: name },
          { type: 'dim', kind: 'ang', c: G.P(0, 0), p1: G.P(30, 0), p2: G.P(30, 15), p3: G.P(16, 4), style: name }]
          .map(e => ({ layer: '0', color: '#ffffff', ltype: 'BYLAYER', lw: 'BYLAYER', ...e }));
        const cv = this.thumb(ents, 260, 140, 0.08);
        doc.dimStyles = saved;
        return cv;
      },
    });
  }

  // Configurar página de una presentación (papel, orientación y estilos de trazado) o, con layout = null, del modelo
  async pageSetup(layout) {
    const doc = this.app.doc;
    const tables = () => [h('option', { value: '' }, 'Ninguna (colores del objeto, blanco en negro)'), ...Object.values(plotTables(doc)).map(t => h('option', { value: t.name }, `${t.name} · ${t.desc || (t.type === 'ctb' ? 'por color' : 'con nombre')}`))];
    const pst = h('select', {}, ...tables());
    pst.value = (layout ? layout.plotStyle : doc.settings.modelPlotStyle) || '';
    const edit = h('button', { class: 'btn', onclick: async () => { const v = pst.value; await this.plotStyleManager(); pst.replaceChildren(...tables()); pst.value = plotTables(doc)[v] ? v : ''; } }, 'Editar tablas…');
    const show = h('input', { type: 'checkbox', checked: !!layout?.showPlot });
    let sizeSel = null, orient = null;
    const rows = [h('label', { class: 'fld' }, 'Tabla de estilos de trazado', pst), h('div', { class: 'fld' }, ' ', edit)];
    if (layout) {
      sizeSel = h('select', {}, ...Object.entries(PAPERS).map(([k, [w, hh]]) => h('option', { value: k }, `${k} (${w} × ${hh} mm)`)));
      sizeSel.value = layout.paper in PAPERS ? layout.paper : 'A4';
      orient = h('select', {}, h('option', { value: 'h' }, 'Horizontal'), h('option', { value: 'v' }, 'Vertical'));
      orient.value = layout.w >= layout.h ? 'h' : 'v';
      rows.unshift(h('label', { class: 'fld' }, 'Tamaño de papel', sizeSel), h('label', { class: 'fld' }, 'Orientación', orient));
      rows.push(h('label', { class: 'chk' }, show, 'Mostrar estilos de trazado en la presentación'));
    }
    const box = h('div', {}, h('div', { class: 'grid2' }, ...rows),
      h('p', { class: 'hint' }, 'La tabla cambia el color, el grosor, la intensidad y el tipo de línea al imprimir y exportar a PDF, SVG y PNG. Las tablas .ctb van por color; las .stb, por el estilo con nombre de cada capa u objeto (ESTILOTRAZADO).'));
    const ok = await this.modal(`Configurar página · ${layout ? layout.name : 'Modelo'}`, box, [{ label: 'Cancelar', value: false }, { label: 'Aceptar', value: true, primary: true }]);
    if (!ok) return;
    doc.begin();
    if (layout) {
      const [a, b] = PAPERS[sizeSel.value];
      layout.paper = sizeSel.value;
      [layout.w, layout.h] = orient.value === 'h' ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
      if (pst.value) layout.plotStyle = pst.value; else delete layout.plotStyle;
      if (show.checked) layout.showPlot = true; else delete layout.showPlot;
    } else if (pst.value) doc.settings.modelPlotStyle = pst.value; else delete doc.settings.modelPlotStyle;
    doc.changed();
    doc.commit();
    this.app.renderer.invalidate();
    const tb = pst.value ? `, estilos de trazado ${pst.value}` : '';
    this.app.print(layout ? `Página: ${layout.paper} ${orient.value === 'h' ? 'horizontal' : 'vertical'} (${layout.w} × ${layout.h} mm)${tb}.` : `Modelo${tb || ': sin tabla de estilos de trazado'}.`);
  }

  // Administrador de tablas de estilos de trazado: predefinidas (sólo lectura) y propias del dibujo, que se pueden
  // crear, copiar, editar, importar y exportar como archivos .ctb/.stb de AutoCAD
  async plotStyleManager() {
    const app = this.app, doc = app.doc;
    let cur = Object.keys(plotTables(doc))[0], all = false;
    const box = h('div', { class: 'plot-mgr' });
    const tx = fn => { doc.begin(); fn(); doc.changed(); doc.commit(); app.renderer.invalidate(); draw(); };
    const uniq = base => { let n = base, i = 2; while (plotTables(doc)[n]) n = base.replace(/(\.\w+)?$/, m => ` (${i})${m}`), i++; return n; };
    const usedAci = () => [...new Set([...doc.allEnts(), ...Object.values(doc.blocks).flatMap(b => b.ents)].map(e => hexToAci(doc.style(e).color)))].sort((a, b) => a - b);
    const draw = () => {
      const tabs = plotTables(doc), t = tabs[cur], ro = !!BUILTIN_PLOT[cur];
      const list = h('select', { size: 9, class: 'plot-list', onchange: ev => { cur = ev.target.value; draw(); } },
        ...Object.keys(tabs).map(n => h('option', { value: n }, `${n}${BUILTIN_PLOT[n] ? ' (predefinida)' : ''}`)));
      list.value = cur;
      const act = (label, fn, dis = false) => h('button', { class: 'btn', disabled: dis, onclick: fn }, label);
      const fresh = (kind, desc) => tx(() => { const n = uniq(`nueva.${kind}`); doc.plotStyles[n] = { ...JSON.parse(JSON.stringify(BUILTIN_PLOT[`acad.${kind}`])), name: n, desc }; cur = n; });
      const btns = h('div', { class: 'plot-btns' },
        act('Nueva .ctb', () => fresh('ctb', 'Por color')), act('Nueva .stb', () => fresh('stb', 'Con nombre')),
        act('Copiar', () => tx(() => { const n = uniq(cur); doc.plotStyles[n] = { ...JSON.parse(JSON.stringify(t)), name: n }; cur = n; })),
        act('Eliminar', () => tx(() => {
          delete doc.plotStyles[cur];
          for (const l of doc.layouts) if (l.plotStyle === cur) delete l.plotStyle;
          if (doc.settings.modelPlotStyle === cur) delete doc.settings.modelPlotStyle;
          cur = Object.keys(plotTables(doc))[0];
        }), ro),
        act('Importar…', async () => {
          const f = await app.io.pickFile('Tablas de estilos de trazado', ['.ctb', '.stb']);
          if (!f) return;
          try {
            const t2 = await readPlotFile(await f.file.arrayBuffer(), f.file.name), n = plotTables(doc)[t2.name] ? uniq(t2.name) : t2.name;
            tx(() => { doc.plotStyles[n] = /** @type {import('./types').PlotTable} */ ({ ...t2, name: n }); cur = n; });
            app.print(`Tabla de estilos de trazado "${n}" importada (${Object.keys(t2.styles).length} estilos).`);
          } catch (err) { app.print(`No se puede leer la tabla de estilos: ${err.message}`, 'err'); }
        }),
        act('Exportar…', async () => {
          const bytes = await writePlotFile(t);
          const ok = await app.io.writeFile(new Blob([bytes], { type: 'application/octet-stream' }), t.name, 'application/octet-stream', t.type === 'ctb' ? '.ctb' : '.stb', 'Tabla de estilos de trazado', false);
          if (ok) app.print(`Tabla "${t.name}" exportada.`);
        }));
      // Editor de los estilos de la tabla
      const setSt = (key, patch) => tx(() => { const T = doc.plotStyles[cur]; T.styles[key] = { ...OBJECT, ...T.styles[key], ...patch }; });
      const ltOpts = [['', 'Del objeto'], ...Object.keys(LTYPES).map(k => [k, k])], lwOpts = [['', 'Del objeto'], ...LWEIGHTS.map(v => [String(v), `${v.toFixed(2)} mm`])];
      const opt = (sel, opts, v) => { sel.append(...opts.map(([k, l]) => h('option', { value: k }, l))); sel.value = v; return sel; };
      const row = (key, head) => {
        const s = { ...OBJECT, ...t.styles[key] }, cv = s.gray ? '__gray' : s.color || '';
        const own = s.color && s.color !== '#000000' ? [[s.color, s.color]] : [];
        const col = opt(h('select', { disabled: ro, onchange: async ev => {
          let v = ev.target.value;
          if (v === '__custom') { v = await this.pickColor(s.color || '#000000'); if (!v) return draw(); }
          setSt(key, v === '__gray' ? { color: null, gray: true } : { color: v || null, gray: false });
        } }), [['', 'Del objeto'], ['__gray', 'Escala de grises'], ['#000000', 'Negro'], ...own, ['__custom', 'Otro…']], cv);
        const lw = opt(h('select', { disabled: ro, onchange: ev => setSt(key, { lw: ev.target.value === '' ? null : +ev.target.value }) }), lwOpts, s.lw == null ? '' : String(s.lw));
        const lt = opt(h('select', { disabled: ro, onchange: ev => setSt(key, { ltype: ev.target.value || null }) }), ltOpts, s.ltype || '');
        const scr = h('input', { type: 'number', min: 0, max: 100, step: 1, value: s.screen ?? 100, disabled: ro, onchange: ev => { const v = Math.max(0, Math.min(100, +ev.target.value)); if (Number.isFinite(v)) setSt(key, { screen: v }); } });
        const del = t.type === 'stb' && key !== 'Normal' && !ro ? h('button', { class: 'btn', title: 'Quitar estilo', onclick: () => tx(() => { delete doc.plotStyles[cur].styles[key]; }) }, '×') : '';
        return h('tr', {}, h('td', {}, head), h('td', {}, col), h('td', {}, lw), h('td', {}, scr), h('td', {}, lt), h('td', {}, del));
      };
      const keys = t.type === 'ctb' ? (all ? Array.from({ length: 255 }, (_, i) => i + 1) : (usedAci().length ? usedAci() : [1, 2, 3, 4, 5, 6, 7])) : stbNames(t);
      const rows = keys.map(k => row(k, t.type === 'ctb' ? h('span', { class: 'aci' }, h('i', { style: `background:${aciSample(k)}` }), `Color ${k}`) : h('b', {}, k)));
      const desc = h('input', { type: 'text', value: t.desc || '', disabled: ro, class: 'full', onchange: ev => tx(() => { doc.plotStyles[cur].desc = ev.target.value; }) });
      const extra = t.type === 'ctb'
        ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: all, onchange: ev => { all = ev.target.checked; draw(); } }), 'Mostrar los 255 colores (si no, sólo los usados en el dibujo)')
        : (() => {
          const inp = h('input', { type: 'text', placeholder: 'Nombre del estilo nuevo', disabled: ro });
          return h('div', { class: 'plot-add' }, inp, h('button', { class: 'btn', disabled: ro, onclick: () => { const n = inp.value.trim(); if (n && !t.styles[n]) tx(() => { doc.plotStyles[cur].styles[n] = { ...OBJECT }; }); } }, 'Añadir estilo'));
        })();
      box.replaceChildren(h('div', { class: 'plot-top' }, list, btns),
        h('label', { class: 'fld' }, 'Descripción', desc),
        h('div', { class: 'plot-scroll' }, h('table', { class: 'xref-list' }, h('thead', {}, h('tr', {}, ...[t.type === 'ctb' ? 'Color del objeto' : 'Estilo', 'Color de trazado', 'Grosor', 'Intensidad %', 'Tipo de línea', ''].map(x => h('th', {}, x)))), h('tbody', {}, ...rows))),
        extra,
        h('p', { class: 'hint' }, ro ? 'Las tablas predefinidas no se pueden modificar: use «Copiar» para crear una editable.' : 'Los cambios se aplican al momento y se pueden deshacer.'));
    };
    draw();
    await this.modal('Tablas de estilos de trazado', box, [{ label: 'Cerrar', value: null, primary: true }]);
  }

  // ---------- SCP y vistas ----------
  // Administrador de SCP. Devuelve {action: 'set'|'save'|'rename'|'delete', name} o null.
  ucsManager() {
    const app = this.app, doc = app.doc, S = doc.settings;
    const desc = u => (u ? `${fmt(u.o.x, 4)}, ${fmt(u.o.y, 4)}` : '0, 0');
    /** @type {[string, string, import('./types').Ucs | null][]} */
    const rows = [['*universal*', 'Universal', null], ...(doc.ucsPrev?.length ? [/** @type {[string, string, import('./types').Ucs | null]} */ (['*previo*', 'Previo', doc.ucsPrev.at(-1)])] : []), ...doc.ucsList.map(u => /** @type {[string, string, import('./types').Ucs]} */ ([u.name, u.name, u]))];
    let sel = doc.ucs ? doc.ucs.name || null : '*universal*';
    const tbody = h('tbody');
    for (const [key, label, u] of rows) {
      const cur = key === '*universal*' ? !doc.ucs : key !== '*previo*' && doc.ucs?.name === key;
      const tr = h('tr', { class: key === sel ? 'sel' : '', onclick: () => { sel = key; tbody.querySelectorAll('tr').forEach(x => x.classList.toggle('sel', x === tr)); } },
        h('td', {}, h('b', {}, label), cur ? h('span', { class: 'tag' }, ' actual') : null), h('td', { class: 'num' }, desc(u)), h('td', { class: 'num' }, `${fmt(G.deg(G.normAng(u?.ang || 0)), 2)}°`));
      tbody.append(tr);
    }
    const on = h('input', { type: 'checkbox', checked: S.ucsIcon !== false, onchange: e => { S.ucsIcon = e.target.checked; app.renderer.invalidate(); } });
    const org = h('input', { type: 'checkbox', checked: S.ucsIconOrigin !== false, onchange: e => { S.ucsIconOrigin = e.target.checked; app.renderer.invalidate(); } });
    const box = h('div', {},
      h('p', { class: 'hint' }, `SCP actual: ${!doc.ucs ? 'Universal' : `${doc.ucs.name || 'sin nombre'} (origen ${desc(doc.ucs)}, eje X a ${fmt(G.deg(doc.ucs.ang), 2)}°)`}`),
      h('table', { class: 'xref-list' }, h('thead', {}, h('tr', {}, ...['Nombre', 'Origen', 'Eje X'].map(t => h('th', {}, t)))), tbody),
      h('fieldset', {}, h('legend', {}, 'Icono del SCP'), h('div', { class: 'grid2' }, h('label', { class: 'chk' }, on, 'Mostrar el icono'), h('label', { class: 'chk' }, org, 'Mostrar en el origen del SCP'))),
      h('p', { class: 'hint' }, 'Las coordenadas que se escriben (x,y · @dx,dy · d<a) se miden en el SCP actual; con * delante (*x,y) se miden en el universal. ORTO, POLAR, la rejilla y FORZC siguen los ejes del SCP.'));
    const act = a => () => (a === 'save' || (sel && (a === 'set' || !sel.startsWith('*'))) ? { action: a, name: sel } : null);
    return this.modal('Administrador de SCP', box, [{ label: 'Cerrar', value: null }, { label: 'Guardar actual…', value: act('save') }, { label: 'Renombrar…', value: act('rename') }, { label: 'Suprimir', value: act('delete') }, { label: 'Establecer actual', value: act('set'), primary: true }]);
  }
  // Administrador de vistas con nombre. Devuelve {action: 'restore'|'new'|'update'|'rename'|'delete', name, opts} o null.
  viewManager() {
    const doc = this.app.doc;
    let sel = doc.views[0]?.name;
    const tbody = h('tbody');
    for (const v of doc.views) {
      const tr = h('tr', { class: v.name === sel ? 'sel' : '', onclick: () => { sel = v.name; tbody.querySelectorAll('tr').forEach(x => x.classList.toggle('sel', x === tr)); }, ondblclick: () => { sel = v.name; restore.click(); } },
        h('td', {}, h('b', {}, v.name)), h('td', {}, v.space === 'model' ? 'Modelo' : v.space), h('td', { class: 'num' }, `${fmt(v.cx, 2)}, ${fmt(v.cy, 2)}`), h('td', { class: 'num' }, `${fmt(v.w, 2)} × ${fmt(v.h, 2)}`),
        h('td', {}, v.ucs ? v.ucs.name || 'Sí' : '—'), h('td', {}, v.layers ? 'Sí' : '—'));
      tbody.append(tr);
    }
    const ucs = h('input', { type: 'checkbox', checked: this.viewOpts?.ucs !== false }), lay = h('input', { type: 'checkbox', checked: !!this.viewOpts?.layers }), win = h('input', { type: 'checkbox', checked: !!this.viewOpts?.window });
    const box = h('div', {},
      doc.views.length ? h('table', { class: 'xref-list' }, h('thead', {}, h('tr', {}, ...['Nombre', 'Espacio', 'Centro', 'Tamaño', 'SCP', 'Capas'].map(t => h('th', {}, t)))), tbody)
        : h('p', { class: 'hint' }, 'No hay vistas con nombre. «Nueva…» guarda la vista actual (o una ventana) del modelo o de la presentación.'),
      h('fieldset', {}, h('legend', {}, 'Vista nueva'), h('div', { class: 'grid2' }, h('label', { class: 'chk' }, ucs, 'Guardar el SCP actual con la vista'), h('label', { class: 'chk' }, lay, 'Guardar el estado de las capas (activadas y bloqueadas)'), h('label', { class: 'chk' }, win, 'Definir con una ventana'))));
    const opts = () => (this.viewOpts = { ucs: ucs.checked, layers: lay.checked, window: win.checked });
    const act = a => () => (a === 'new' || sel ? { action: a, name: sel, opts: opts() } : null);
    let restore;
    const p = this.modal('Vistas con nombre', box, [{ label: 'Cerrar', value: null }, { label: 'Nueva…', value: act('new') }, ...(doc.views.length ? [{ label: 'Actualizar', value: act('update') }, { label: 'Renombrar…', value: act('rename') }, { label: 'Suprimir', value: act('delete') }, { label: 'Establecer actual', value: act('restore'), primary: true }] : [])]);
    restore = [...document.querySelectorAll('#modal-root .modal-foot .btn')].find(b => b.textContent === 'Establecer actual') || { click() {} };
    return p;
  }

  // ---------- Selección rápida y filtros ----------
  // Editor de una condición {type, prop, op, value}: devuelve los controles y una función que lee el valor
  condEditor(k, pool, onChange = () => {}) {
    const types = [...new Set(pool.map(e => e.type))].sort((a, b) => TYPES[a].name.localeCompare(TYPES[b].name));
    const tSel = h('select', {}, h('option', { value: '*' }, `Varios (todos los tipos)`), ...types.map(t => h('option', { value: t }, `${TYPES[t].name} (${pool.filter(e => e.type === t).length})`)));
    const pSel = h('select', {}), oSel = h('select', {}, ...Object.entries(OPS).map(([v, l]) => h('option', { value: v }, l)));
    const list = h('datalist', { id: `dl${Math.random().toString(36).slice(2)}` }), val = h('input', { type: 'text', list: list.id, value: k.value ?? '' });
    tSel.value = types.includes(k.type) ? k.type : '*'; oSel.value = k.op || '=';
    const fillProps = () => {
      const names = propNames(pool, tSel.value);
      pSel.replaceChildren(...names.map(n => h('option', { value: n }, n)));
      pSel.value = names.includes(k.prop) ? k.prop : names.includes(pSel.dataset.last) ? pSel.dataset.last : names[0];
      fillVals();
    };
    const fillVals = () => {
      pSel.dataset.last = pSel.value;
      const vs = new Set();
      for (const e of pool) { if (tSel.value !== '*' && e.type !== tSel.value) continue; const v = propValue(e, pSel.value); if (v !== undefined && vs.size < 60) vs.add(typeof v === 'number' ? fmt(v, 4) : String(v)); }
      list.replaceChildren(...[...vs].sort().map(v => h('option', { value: v })));
      val.disabled = oSel.value === 'all';
    };
    tSel.onchange = () => { fillProps(); onChange(); }; pSel.onchange = () => { fillVals(); onChange(); }; oSel.onchange = () => { fillVals(); onChange(); };
    fillProps();
    return { tSel, pSel, oSel, val, list, read: () => ({ type: tSel.value, prop: pSel.value, op: oSel.value, value: val.value.trim() }) };
  }
  qselectDialog() {
    const app = this.app, doc = app.doc, last = this.qsLast || {};
    const scope = h('select', {}, h('option', { value: 'all' }, 'Todo el espacio actual'), app.sel.size ? h('option', { value: 'sel' }, `Designación actual (${app.sel.size})`) : null);
    scope.value = app.sel.size && last.scope === 'sel' ? 'sel' : 'all';
    const how = h('select', {}, h('option', { value: 'in' }, 'Incluir en el nuevo conjunto'), h('option', { value: 'out' }, 'Excluir del nuevo conjunto'));
    how.value = last.exclude ? 'out' : 'in';
    const append = h('input', { type: 'checkbox', checked: !!last.append });
    const wrap = h('div', {});
    let ed;
    const build = () => {
      const pool = candidates(doc, scope.value === 'sel' ? [...app.sel] : null);
      ed = this.condEditor(ed ? ed.read() : last, pool);
      wrap.replaceChildren(h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Tipo de objeto', ed.tSel), h('label', { class: 'fld' }, 'Propiedad', ed.pSel), h('label', { class: 'fld' }, 'Operador', ed.oSel), h('label', { class: 'fld' }, 'Valor', ed.val, ed.list)));
    };
    scope.onchange = build;
    build();
    const box = h('div', {}, h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Aplicar a', scope)), wrap,
      h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Cómo aplicar', how), h('label', { class: 'chk' }, append, 'Añadir a la designación actual')),
      h('p', { class: 'hint' }, 'Colores: PorCapa, un nombre (rojo, azul…), un número ACI o #rrggbb. Los ángulos se comparan en grados. El comodín admite * y ?. Sólo se designan objetos visibles en capas desbloqueadas.'));
    return this.modal('Selección rápida', box, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', primary: true, value: () => (this.qsLast = { ...ed.read(), scope: scope.value, exclude: how.value === 'out', append: append.checked }) }]);
  }
  // Filtros de selección. Devuelve {action: 'apply'|'save'|'delete', filter} o null.
  filterDialog() {
    const doc = this.app.doc, pool = candidates(doc, null);
    const draft = this.filterDraft ? JSON.parse(JSON.stringify(this.filterDraft)) : { name: '', join: 'and', conds: [] };
    const saved = h('select', {}, h('option', { value: '' }, '— Filtro sin guardar —'), ...doc.selFilters.map(f => h('option', { value: f.name }, f.name)));
    saved.value = findFilter(doc, draft.name) ? findFilter(doc, draft.name).name : '';
    const join = h('select', {}, h('option', { value: 'and' }, 'Todas las condiciones (Y)'), h('option', { value: 'or' }, 'Alguna condición (O)'));
    const tbody = h('tbody'), eds = [];
    const render = () => {
      join.value = draft.join || 'and';
      eds.length = 0;
      tbody.replaceChildren(...draft.conds.map((k, i) => {
        const ed = this.condEditor(k, pool), not = h('input', { type: 'checkbox', checked: !!k.not, title: 'Negar la condición (NO)' });
        eds.push({ ed, not });
        return h('tr', {}, h('td', {}, not), h('td', {}, ed.tSel), h('td', {}, ed.pSel), h('td', {}, ed.oSel), h('td', {}, ed.val, ed.list),
          h('td', {}, h('button', { class: 'ib', title: 'Quitar condición', html: icon('trash', 14), onclick: () => { read(); draft.conds.splice(i, 1); render(); } })));
      }));
      if (!draft.conds.length) tbody.append(h('tr', {}, h('td', { colspan: 6 }, h('span', { class: 'hint' }, 'Sin condiciones: el filtro designa todos los objetos. Añada condiciones con el botón de abajo.'))));
    };
    const read = () => { draft.join = join.value; draft.conds = eds.map(({ ed, not }) => ({ ...ed.read(), not: not.checked })); return draft; };
    saved.onchange = () => { const f = findFilter(doc, saved.value); Object.assign(draft, f ? JSON.parse(JSON.stringify(f)) : { name: '', join: 'and', conds: [] }); render(); };
    render();
    const add = h('button', { class: 'btn', onclick: () => { read(); draft.conds.push({ type: '*', prop: 'Capa', op: '=', value: '' }); render(); } }, h('span', { html: icon('plus', 16) }), 'Añadir condición');
    const box = h('div', { class: 'filter-dlg' },
      h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Filtro guardado', saved), h('label', { class: 'fld' }, 'Combinar', join)),
      h('table', { class: 'xref-list params' }, h('thead', {}, h('tr', {}, ...['NO', 'Tipo', 'Propiedad', 'Operador', 'Valor', ''].map(t => h('th', {}, t)))), tbody),
      h('div', { class: 'lay-bar' }, add),
      h('p', { class: 'hint' }, '«Aplicar» pide los objetos (Intro = todo el espacio actual) y designa los que pasan el filtro. Los filtros guardados se conservan en el dibujo.'));
    const out = a => () => { read(); this.filterDraft = JSON.parse(JSON.stringify(draft)); return { action: a, filter: this.filterDraft }; };
    return this.modal('Filtros de selección', box, [{ label: 'Cancelar', value: null }, { label: 'Guardar como…', value: out('save') }, ...(doc.selFilters.length ? [{ label: 'Eliminar filtro', value: () => (saved.value ? { action: 'delete', filter: { name: saved.value } } : null) }] : []), { label: 'Aplicar', value: out('apply'), primary: true }]);
  }

  // ---------- Buscar y reemplazar ----------
  // Busca y reemplaza dentro del diálogo; devuelve {select: ids} con «Designar» o null.
  findDialog(findPool, spaceOf) {
    const app = this.app, doc = app.doc, o = /** @type {{q?: string, rep?: string, matchCase: boolean, whole: boolean, wild: boolean, where: string, kinds: string[]}} */ (this.findOpts || { matchCase: false, whole: false, wild: false, where: 'space', kinds: Object.keys(FIND_KINDS) });
    const q = h('input', { type: 'text', value: o.q || '' }), rep = h('input', { type: 'text', value: o.rep || '' });
    const where = h('select', {}, h('option', { value: 'space' }, 'Espacio actual'), h('option', { value: 'all' }, 'Todo el dibujo (modelo y presentaciones)'), app.sel.size ? h('option', { value: 'sel' }, `Designación actual (${app.sel.size})`) : null);
    where.value = o.where === 'sel' && !app.sel.size ? 'space' : o.where;
    const ck = (k, label) => { const i = h('input', { type: 'checkbox', checked: !!o[k] }); i.dataset.k = k; return h('label', { class: 'chk' }, i, label); };
    const opts = h('div', { class: 'grid2' }, ck('matchCase', 'Mayúsculas y minúsculas'), ck('whole', 'Sólo palabras completas'), ck('wild', 'Usar comodines (* ?)'));
    const kinds = h('div', { class: 'grid2' }, ...Object.entries(FIND_KINDS).map(([k, l]) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-kind': k, checked: o.kinds.includes(k) }), l)));
    const tbody = h('tbody'), status = h('p', { class: 'hint' }, 'Escriba el texto y pulse «Buscar».');
    let results = [];
    const read = () => {
      const r = { q: q.value, rep: rep.value, where: where.value, kinds: [.../** @type {NodeListOf<HTMLInputElement>} */ (kinds.querySelectorAll('[data-kind]'))].filter(x => x.checked).map(x => x.dataset.kind) };
      for (const i of /** @type {NodeListOf<HTMLInputElement>} */ (opts.querySelectorAll('[data-k]'))) r[i.dataset.k] = i.checked;
      return (this.findOpts = r);
    };
    const spaceName = e => { const s = spaceOf(doc, e); return s === 'model' ? 'Modelo' : s === null ? '—' : doc.layouts[s].name; };
    const ctx = (text, n) => { const t = text.replace(/\s+/g, ' '); return t.length > 70 ? t.slice(0, 67) + '…' : t; };
    const search = () => {
      const r = read();
      results = findText(findPool({ app, doc }, r.where), r.q, { ...r, kinds: r.kinds });
      tbody.replaceChildren(...results.map(x => {
        const chk = h('input', { type: 'checkbox', checked: true, onclick: ev => ev.stopPropagation() });
        x.chk = chk;
        return h('tr', { title: 'Clic: ampliar el objeto', onclick: () => {
          if (!doc.ents.includes(x.e)) { status.textContent = `El objeto está en «${spaceName(x.e)}»: cambie a ese espacio para verlo.`; return; }
          const b = bboxOf(x.e);
          if (b) { const m = Math.max(b.x2 - b.x1, b.y2 - b.y1, 1) * 1.5; app.view.push(); app.view.fit({ x1: b.x1 - m, y1: b.y1 - m, x2: b.x2 + m, y2: b.y2 + m }, 0.05); }
          app.sel = new Set([x.e.id]); app.selChanged(); app.renderer.invalidate();
        } }, h('td', {}, chk), h('td', {}, TYPES[x.e.type].name), h('td', {}, x.slot.label), h('td', {}, spaceName(x.e)), h('td', {}, ctx(x.text)), h('td', { class: 'num' }, String(x.n)));
      }));
      status.textContent = r.q ? `${results.length} texto(s) con ${results.reduce((s, x) => s + x.n, 0)} coincidencia(s) de «${r.q}».` : 'Escriba el texto que desea buscar.';
    };
    const replace = all => {
      const r = read(), list = all ? results : results.filter(x => x.chk?.checked);
      if (!r.q || !list.length) return;
      const n = replaceText(doc, list, r.q, r.rep, r);
      app.renderer.invalidate();
      search();
      status.textContent = `${n} reemplazo(s) hecho(s). ${status.textContent}`;
    };
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); search(); } });
    const box = h('div', { class: 'find-dlg' },
      h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Buscar', q), h('label', { class: 'fld' }, 'Reemplazar por', rep), h('label', { class: 'fld' }, 'Dónde', where)),
      h('fieldset', {}, h('legend', {}, 'Opciones'), opts), h('fieldset', {}, h('legend', {}, 'Buscar en'), kinds),
      h('div', { class: 'lay-bar' }, h('button', { class: 'btn primary', onclick: search }, h('span', { html: icon('find', 16) }), 'Buscar'),
        h('button', { class: 'btn', onclick: () => replace(false) }, 'Reemplazar marcados'), h('button', { class: 'btn', onclick: () => replace(true) }, 'Reemplazar todo')),
      h('div', { class: 'find-res' }, h('table', { class: 'xref-list' }, h('thead', {}, h('tr', {}, ...['', 'Objeto', 'Texto', 'Espacio', 'Contenido', 'Veces'].map(t => h('th', {}, t)))), tbody)), status);
    return this.modal('Buscar y reemplazar', box, [{ label: 'Cerrar', value: null }, { label: 'Designar resultados', value: () => ({ select: results.filter(x => x.chk?.checked && doc.ents.includes(x.e) && doc.visible(x.e) && !doc.locked(x.e)).map(x => x.e.id) }) }]);
  }

  // ---------- OVERKILL ----------
  overkillDialog(o) {
    const tol = h('input', { type: 'text', value: String(o.tol) });
    const ign = Object.entries(OK_PROPS).map(([k, l]) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-p': k, checked: o.ignore.includes(k) }), l));
    /** @param {unknown} v @param {string} label @returns {[HTMLInputElement, HTMLLabelElement]} */
    const ck = (v, label) => { const i = h('input', { type: 'checkbox', checked: !!v }); return [i, h('label', { class: 'chk' }, i, label)]; };
    const [pl, plL] = ck(o.plines, 'Optimizar segmentos de polilíneas (vértices repetidos o alineados)'), [ov, ovL] = ck(o.overlap, 'Combinar objetos colineales que se solapan parcialmente'), [ee, eeL] = ck(o.endToEnd, 'Combinar objetos colineales alineados extremo con extremo');
    const box = h('div', {}, h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Tolerancia', tol)),
      h('fieldset', {}, h('legend', {}, 'Ignorar las propiedades'), h('div', { class: 'grid2' }, ...ign)),
      h('fieldset', {}, h('legend', {}, 'Opciones'), plL, ovL, eeL),
      h('p', { class: 'hint' }, 'Se suprimen los objetos iguales a otro dentro de la tolerancia (las líneas y polilíneas aunque tengan el sentido contrario). Las líneas y los arcos colineales se combinan en uno solo; un círculo absorbe los arcos que tiene encima.'));
    return this.modal('Suprimir objetos duplicados', box, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', primary: true, value: () => {
      const t = parseFloat(tol.value.replace(',', '.'));
      return { tol: t > 0 ? t : 1e-6, ignore: [.../** @type {NodeListOf<HTMLInputElement>} */ (box.querySelectorAll('[data-p]'))].filter(x => x.checked).map(x => x.dataset.p), plines: pl.checked, overlap: ov.checked, endToEnd: ee.checked };
    } }]);
  }

  // ---------- Herramientas de capas ----------
  // Recorrer capas: show(nombres) muestra sólo esas capas. Devuelve {keep} al cerrar con el botón, o null (se restauran).
  layWalk(show) {
    const doc = this.app.doc, picked = new Set(doc.layers.filter(l => l.on).map(l => l.name));
    const list = h('div', { class: 'walk-list' }), filt = h('input', { type: 'text', placeholder: 'p. ej. COTA*, *EJE*' });
    const used = usedLayers(doc);
    const render = () => list.replaceChildren(...doc.layers.map(l => h('div', { class: 'walk-row' + (picked.has(l.name) ? ' sel' : ''), title: 'Clic: sólo esta capa · Ctrl+clic: añadir o quitar', onclick: ev => {
      if (ev.ctrlKey || ev.metaKey) { if (picked.has(l.name)) picked.delete(l.name); else picked.add(l.name); } else { picked.clear(); picked.add(l.name); }
      apply();
    } }, h('span', { class: 'swatch', style: `background:${l.color}` }), l.name, used.has(l.name) ? null : h('span', { class: 'tag' }, ' sin uso'))));
    const apply = () => { show([...picked]); render(); };
    filt.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault(); e.stopPropagation();
      const re = filt.value.split(',').filter(s => s.trim()).map(p => new RegExp('^' + p.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));
      picked.clear(); for (const l of doc.layers) if (re.some(r => r.test(l.name))) picked.add(l.name);
      apply();
    });
    const restore = h('input', { type: 'checkbox', checked: true });
    render();
    const box = h('div', {}, h('label', { class: 'fld' }, 'Filtro (Intro: elegir las capas que coinciden)', filt), list,
      h('div', { class: 'lay-bar' }, h('button', { class: 'btn', onclick: () => { picked.clear(); for (const l of doc.layers) picked.add(l.name); apply(); } }, 'Todas'),
        h('button', { class: 'btn', onclick: () => { const inv = doc.layers.filter(l => !picked.has(l.name)).map(l => l.name); picked.clear(); inv.forEach(n => picked.add(n)); apply(); } }, 'Invertir')),
      h('label', { class: 'chk' }, restore, 'Restaurar las capas al cerrar'));
    return this.modal('Recorrer capas', box, [{ label: 'Cerrar', primary: true, value: () => ({ keep: !restore.checked }) }]);
  }
  // Filtros de capa por propiedades y por grupos (la paleta de capas los usa para mostrar sólo algunas capas)
  async layerFilterManager() {
    const app = this.app, doc = app.doc;
    for (;;) {
      let sel = this.layFilter && findLayerFilter(doc, this.layFilter) ? findLayerFilter(doc, this.layFilter).name : doc.layerFilters[0]?.name;
      const tbody = h('tbody'), used = usedLayers(doc);
      const defText = f => (f.kind === 'group' ? f.layers.join(', ') || '(vacío)' : Object.entries(f.rules || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${LF_RULES[k].split(' (')[0]}: ${v}`).join(' · ') || '(todas)');
      for (const f of doc.layerFilters) {
        const n = doc.layers.filter(l => layerMatches(f, l, used)).length;
        const tr = h('tr', { class: f.name === sel ? 'sel' : '', onclick: () => { sel = f.name; tbody.querySelectorAll('tr').forEach(x => x.classList.toggle('sel', x === tr)); } },
          h('td', {}, h('b', {}, f.name)), h('td', {}, f.kind === 'group' ? 'Grupo' : 'Propiedades'), h('td', {}, defText(f)), h('td', { class: 'num' }, String(n)));
        tbody.append(tr);
      }
      const box = h('div', {}, doc.layerFilters.length ? h('table', { class: 'xref-list' }, h('thead', {}, h('tr', {}, ...['Nombre', 'Tipo', 'Definición', 'Capas'].map(t => h('th', {}, t)))), tbody)
        : h('p', { class: 'hint' }, 'No hay filtros de capa. Un filtro de propiedades muestra las capas que cumplen unas condiciones (nombre con comodines, color, activadas…); un filtro de grupo, las capas elegidas a mano.'));
      const r = await this.modal('Filtros de capa', box, [{ label: 'Cerrar', value: null }, { label: 'Nuevo de propiedades…', value: { a: 'prop' } }, { label: 'Nuevo de grupo…', value: { a: 'group' } },
        ...(doc.layerFilters.length ? [{ label: 'Editar…', value: () => (sel ? { a: 'edit' } : null) }, { label: 'Eliminar', value: () => (sel ? { a: 'del' } : null) }, { label: 'Usar en la paleta', primary: true, value: () => (sel ? { a: 'use' } : null) }] : [])]);
      if (!r) return;
      const f = findLayerFilter(doc, sel);
      if (r.a === 'del' && f) { doc.layerFilters = doc.layerFilters.filter(x => x !== f); if (this.layFilter === f.name) this.layFilter = ''; doc.changed(); continue; }
      if (r.a === 'use' && f) { this.layFilter = f.name; this.showPalette('layers'); return; }
      const base = r.a === 'edit' ? f : { name: '', kind: r.a, ...(r.a === 'group' ? { layers: [] } : { rules: {} }) };
      if (!base) continue;
      const out = await this.layerFilterEditor(base);
      if (!out) continue;
      if (doc.layerFilters.some(x => x !== base && x.name.toLowerCase() === out.name.toLowerCase())) { app.print(`Ya existe un filtro de capa "${out.name}".`); continue; }
      if (r.a === 'edit') { if (this.layFilter === base.name) this.layFilter = out.name; Object.assign(base, out); } else doc.layerFilters.push(out);
      doc.changed();
    }
  }
  layerFilterEditor(f) {
    const doc = this.app.doc, used = usedLayers(doc);
    const name = h('input', { type: 'text', value: f.name || `Filtro${doc.layerFilters.length + 1}` });
    const count = h('p', { class: 'hint' });
    let read;
    let body;
    if (f.kind === 'group') {
      const set = new Set(f.layers);
      body = h('div', { class: 'walk-list' }, ...doc.layers.map(l => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: set.has(l.name), onchange: e => { if (e.target.checked) set.add(l.name); else set.delete(l.name); upd(); } }), h('span', { class: 'swatch', style: `background:${l.color}` }), l.name)));
      read = () => ({ name: name.value.trim(), kind: 'group', layers: doc.layers.map(l => l.name).filter(n => set.has(n)) });
    } else {
      const r = f.rules || {}, yn = v => { const s = h('select', { onchange: () => upd() }, h('option', { value: '' }, 'Indiferente'), h('option', { value: 'sí' }, 'Sí'), h('option', { value: 'no' }, 'No')); s.value = v || ''; return s; };
      const nm = h('input', { type: 'text', value: r.name || '', oninput: () => upd() });
      const col = h('select', { onchange: () => upd() }, h('option', { value: '' }, 'Cualquiera'), ...[...new Set(doc.layers.map(l => l.color.toLowerCase()))].map(c => h('option', { value: c, style: `color:${c}` }, `■ ${COLORS.find(x => x[0] === c)?.[1] || c}`)));
      col.value = r.color || '';
      const on = yn(r.on), lock = yn(r.lock), use = yn(r.used);
      const lt = h('select', { onchange: () => upd() }, h('option', { value: '' }, 'Cualquiera'), ...this.ltypeOptions(false)); lt.value = r.ltype || '';
      const lw = h('select', { onchange: () => upd() }, h('option', { value: '' }, 'Cualquiera'), ...this.lwOptions(false)); lw.value = r.lw ?? '';
      body = h('div', { class: 'grid2' }, h('label', { class: 'fld' }, LF_RULES.name, nm), h('label', { class: 'fld' }, 'Color', col), h('label', { class: 'fld' }, 'Activada', on), h('label', { class: 'fld' }, 'Bloqueada', lock),
        h('label', { class: 'fld' }, 'Tipo de línea', lt), h('label', { class: 'fld' }, 'Grosor de línea', lw), h('label', { class: 'fld' }, 'En uso (con objetos)', use));
      read = () => ({ name: name.value.trim(), kind: 'prop', rules: { name: nm.value.trim(), color: col.value, on: on.value, lock: lock.value, ltype: lt.value, lw: lw.value, used: use.value } });
    }
    const upd = () => { const x = read(); const ls = doc.layers.filter(l => layerMatches(x, l, used)); count.textContent = `${ls.length} capa(s): ${ls.slice(0, 12).map(l => l.name).join(', ')}${ls.length > 12 ? '…' : ''}`; };
    upd();
    const box = h('div', {}, h('label', { class: 'fld' }, 'Nombre del filtro', name), body, count);
    return this.modal(f.kind === 'group' ? 'Filtro de grupo' : 'Filtro de propiedades', box, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', primary: true, value: () => { const x = read(); return x.name ? x : null; } }]);
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
        <li>Las coordenadas se miden en el <b>SCP</b> actual; con <code>*</code> delante (<code>*x,y</code>, <code>@*dx,dy</code>) se miden en el universal.</li>
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
      <h4>Novedades de la v0.13</h4>
      <ul>
        <li><b>Cota Z</b>: los puntos se pueden escribir como <code>x,y,z</code> (también <code>@dx,dy,dz</code>); las líneas guardan la Z de cada extremo y los demás objetos planos su <b>Elevación</b> (Propiedades, LIST). <code>ELEV</code> fija la cota de los objetos nuevos y de los puntos designados sin Z; la barra de estado y <code>ID</code> la muestran. <code>FLATTEN</code> (APLANAR) lleva los objetos designados a cota 0 o a la indicada.</li>
        <li><b>Polilíneas 3D</b> (<code>3DPOLY</code>, 3P) con una Z por vértice (opción <i>Elevación</i> para los puntos que se designan con el ratón) y <b>caras 3D</b> (<code>3DFACE</code>, 3F) de tres o cuatro vértices con aristas invisibles; en Propiedades se edita cada vértice (X, Y, Z) y se ven la longitud 3D, la de planta y las Z mínima y máxima. Las referencias a sus vértices llevan la Z.</li>
        <li><b>DXF</b>: Z de las líneas, elevación de polilíneas, círculos, arcos, textos y bloques, POLYLINE 3D, 3DFACE y, al importar, <b>mallas policara</b> (superficies TIN) y mallas M×N como caras 3D.</li>
        <li><b>Coordenadas grandes</b>: al abrir un DXF con coordenadas de proyección el dibujo toma un <b>origen local</b> (<code>LOCALORIGIN</code>, ORIGENLOCAL, también a mano) y guarda las coordenadas relativas a él; se ven, se escriben y se exportan siempre las reales. Sin temblores al ampliar: el dibujo en pantalla resta el centro de la vista antes de pasar las coordenadas al canvas.</li>
        <li><b>Más de 100 000 objetos</b>: deshacer incremental (cada paso guarda sólo lo que cambia), índice espacial incremental, imagen del modelo en caché (al encuadrar sólo se dibujan las franjas nuevas y al editar sólo lo que cambia; tras un zoom se completa en varios fotogramas), curvas de nivel simplificadas según el zoom, designaciones grandes sin retardo y apertura de DXF grandes en segundo plano con barra de progreso. Los dibujos grandes se autoguardan en IndexedDB.</li>
      </ul>
      <h4>Novedades de la v0.12</h4>
      <ul>
        <li><b>Vistas giradas</b>: <code>PLAN</code> alinea la vista con el SCP (actual, con nombre o universal) y <code>DVIEW</code> la gira un ángulo, según dos puntos o un objeto; con <code>UCSFOLLOW</code> = 1 la vista sigue al SCP. La designación por ventana, la rejilla, el rastreo, ZOOM Ventana, las vistas con nombre, la impresión, PDF, SVG, PNG y DXF funcionan con la vista girada.</li>
        <li><b>Ventanas gráficas giradas</b>: propiedad <b>Giro</b> en la paleta Propiedades; al girar una ventana con <code>GIRA</code> la vista gira con ella (<code>VPROTATEASSOC</code>). Con <code>UCSVP</code> = 1 cada ventana (en mosaico o gráfica) conserva su propio SCP.</li>
        <li><b>Escalas anotativas</b>: lista de escalas (<code>SCALELISTEDIT</code>), escala actual en la barra de estado (<code>CANNOSCALE</code>; en una ventana gráfica es la suya), estilos de texto, cota y directriz <i>Anotativos</i>, propiedad <i>Anotativo</i> de los objetos (<code>ANNOTATIVE</code>), escalas por objeto (<code>OBJECTSCALE</code>, <code>AIOBJECTSCALEADD</code>, <code>AIOBJECTSCALEREMOVE</code>), <code>ANNOALLVISIBLE</code> (botón ANOT) y <code>ANNOAUTOSCALE</code>.</li>
        <li><b>Guiones</b>: <code>SCRIPT</code> ejecuta un archivo .scr (espacio o fin de línea = Intro; un punto escrito designa el objeto que pasa por él); <code>ACTRECORD</code> / <code>ACTSTOP</code> graban lo que hace como guion; <code>DELAY</code> hace pausas.</li>
        <li><b>JavaScript</b>: <code>JSCONSOLE</code> (consola), <code>JSEVAL</code> (una línea) y <code>APPLOAD</code> (archivos .js, también al iniciar). La API <code>tc</code> crea, consulta y modifica objetos, ejecuta órdenes y guiones y define órdenes nuevas con <code>tc.defineCommand</code>.</li>
        <li><b>Paleta de herramientas</b> (<code>TOOLPALETTES</code>, pestaña Herramientas): señales, obras de arte, defensas, drenaje, sombreados y órdenes con su capa, escala, rotación y estado; clic para usarlas o arrastrarlas al dibujo; se crean desde la designación.</li>
        <li><b>Biblioteca vial</b> (<code>LIBINSERT</code>) y <b>DesignCenter</b> (<code>ADCENTER</code>): señales reglamentarias, preventivas e informativas anotativas con atributos, alcantarillas de caño y de cajón con tabla de medidas, defensas metálicas, cordones y cunetas con parámetros; bloques, capas y estilos de otros dibujos. <code>LIBUNITS</code>: unidades del dibujo para los planos tipo.</li>
      </ul>
      <h4>Novedades de la v0.11</h4>
      <ul>
        <li><b>SCP</b> (<code>UCS</code>, <code>SCP</code>): origen y eje X, 3 puntos, alineado con un objeto, giro Z, previo, universal y SCP con nombre; <b>UCSMAN</b> los administra y <b>UCSICON</b> muestra el icono en el origen. Las coordenadas escritas, la barra de estado, ORTO, POLAR, la rejilla y FORZC siguen el SCP.</li>
        <li><b>Vistas con nombre</b> (<code>VIEW</code>, <code>-VIEW</code>): guardan la vista actual o una ventana, del modelo o de una presentación, con su SCP y el estado de las capas.</li>
        <li><b>Ventanas en mosaico</b> (<code>VPORTS</code>): divide el modelo en 2, 3 o 4 ventanas con su propia vista; clic para activar una, Unir, Única y configuraciones guardadas. En una presentación crea varias ventanas gráficas de una vez.</li>
        <li><b>QSELECT</b> (selección rápida por tipo y propiedad) y <b>FILTER</b> (<code>FI</code>, condiciones combinadas con Y / O, guardadas con nombre).</li>
        <li><b>FIND</b> (<code>BUSCAR</code>): busca y reemplaza en textos, atributos, cotas, directrices y tablas, en el espacio actual, en todo el dibujo o en la designación.</li>
        <li><b>OVERKILL</b> suprime duplicados y combina líneas y arcos solapados; <b>AUDIT</b> (<code>REVISAR</code>) comprueba el dibujo y corrige los errores.</li>
        <li><b>Capas</b>: LAYISO y LAYUNISO (aislar y desaislar), LAYWALK (recorrer), LAYMRG (fusionar) y filtros de capa por propiedades y por grupos en la paleta (LAYFILTER).</li>
      </ul>
      <h4>Novedades de la v0.10</h4>
      <ul>
        <li><b>Imágenes a escala real</b>: IMAGEATTACH lee la resolución del archivo (PNG, JPEG, BMP) y propone el tamaño real; también admite <b>Píxeles por unidad</b> y <b>Resolución</b> (ppp). Propiedades muestra la <b>Escala (unidades/píxel)</b> y la <b>Resolución</b>.</li>
        <li><b>XCLIP › Añadir contorno</b>: una imagen recortada admite más contornos (par-impar: huecos o zonas separadas), editables con pinzamientos y exportados a SVG, PDF y DXF.</li>
        <li><b>Tolerancias</b> en los estilos de cota (simétrica, desviación, límites y básica) y <b>DIMOVERRIDE</b> (<code>DOV</code>) para cambiar variables sólo en las cotas designadas o borrar esas modificaciones; Propiedades tiene las secciones <i>Tolerancias</i> y <i>Modificaciones de estilo</i>.</li>
        <li><b>Sombreados</b>: detección de islas Normal, Exterior o Ignorar, <b>Incluir islas</b> y <b>Quitar islas</b>; <b>degradados de varios colores</b> (GRADIENT › Colores o Propiedades › Paradas de color).</li>
        <li><b>Referencias externas recordadas</b>: al abrir un dibujo se recargan solas si el navegador conserva el permiso; en DXF 2000/2007 se escriben como bloques XREF.</li>
        <li><b>Estilos de trazado</b>: CONFIGPAG elige la tabla .ctb o .stb de cada presentación (y del modelo) y puede mostrarla en pantalla; <b>STYLESMANAGER</b> (<code>ESTILOSTRAZADO</code>) crea, edita, importa y exporta tablas; <b>ESTILOTRAZADO</b> asigna estilos con nombre a objetos y capas.</li>
        <li><b>Ventanas gráficas</b>: escala de tipo de línea propia (Propiedades) y <b>PSLTSCALE</b>. <b>Propiedades</b> con varios objetos: elija <i>Todos</i> o un tipo en la cabecera y edite la geometría de todos a la vez.</li>
      </ul>
      <h4>Novedades de la v0.9</h4>
      <ul>
        <li><b>Imágenes raster completas</b>: transparencia (propiedad <b>Transparencia</b>, 0–90), recorte editable con <b>pinzamientos</b> (los vértices del contorno se mueven con el ratón), exportación a PDF vectorial incrustando los píxeles (incluida su máscara de transparencia) y escritura/lectura como <b>IMAGE</b> con <code>ACAD_IMAGE_DICT</code> e <code>IMAGEDEF</code> en DXF 2000/2007. El marco del recorte se controla con XCLIPFRAME.</li>
        <li><b>Cotas</b>: los huecos de <b>DIMBREAK</b> viajan en el DXF (XDATA) y se reconstruyen al abrir; <b>REVCLOUDEDIT</b> (<code>EDITNUBE</code>) añade o quita arcos de una nube de revisión o la convierte en polilínea.</li>
        <li><b>Matrices asociativas en el DXF</b>: ARRAYRECT, ARRAYPOLAR y ARRAYPATH se escriben como bloque anónimo con sus datos en XDATA y se vuelven a leer como un único objeto editable.</li>
        <li><b>WIPEOUTFRAME</b> (<code>WOF</code>) muestra u oculta el marco de las coberturas (0 oculto, 1 visible e impreso, 2 sólo en pantalla) y <b>DRAWORDER</b> (<code>ORDEN</code>) lleva los objetos al frente o al fondo del orden de dibujo.</li>
        <li><b>Líneas múltiples</b>: <kbd>Ctrl</kbd>+clic sobre un pinzamiento interior suprime el vértice y <kbd>Ctrl</kbd>+clic sobre el eje añade uno nuevo; los vértices editables se muestran en cian.</li>
      </ul>
      <h4>Novedades de la v0.8</h4>
      <ul>
        <li><b>MLEDIT</b> (<code>MLE</code>): cruces cerrada, abierta y combinada, uniones en T y en esquina, añadir o suprimir vértices, cortar y soldar elementos de una línea múltiple; los cortes se guardan y se exportan a DXF 2000/2007.</li>
        <li><b>ARRAYEDIT</b>: sustituye los objetos de origen o un elemento concreto de una matriz, añade niveles con separación Z y define el ángulo de las filas. Los cambios conservan la asociatividad.</li>
        <li><b>CENTERMARK / CENTERLINE</b>: marcas y líneas de centro asociativas en círculos, arcos y pares de líneas. <b>DIMBREAK</b> rompe cotas donde las cruzan otros objetos y <b>DIMSPACE</b> las separa o alinea.</li>
        <li><b>REVCLOUD / WIPEOUT / IMAGEATTACH</b>: nubes de revisión rectangulares, poligonales o desde un contorno; coberturas que ocultan lo dibujado debajo; imágenes PNG, JPEG, GIF, WebP o BMP con escala y recorte XCLIP.</li>
        <li><b>DXF</b>: los estados de capa se escriben como LAYERSTATE en DXF 2000/2007, junto con los cortes de las líneas múltiples. Archivos <code>.tcad</code> versión 8.</li>
      </ul>
      <h4>Novedades de la v0.7</h4>
      <ul>
        <li><b>Líneas múltiples</b>: MLINE (<code>ML</code>) dibuja elementos paralelos (muros, calzadas…) con justificación superior, cero o inferior y escala; ESTILOLM (MLSTYLE) define sus elementos (desfase, color, tipo de línea), remates de línea o de arco, ingletes y relleno. Pinzamientos en los vértices; se descomponen en líneas y arcos.</li>
        <li><b>Matrices asociativas</b>: ARRAYRECT, ARRAYPOLAR y <b>ARRAYPATH</b> (a lo largo de una línea, arco, polilínea o spline, dividiendo o con separación fija) crean un único objeto editable con ARRAYEDIT, sus pinzamientos cian o la paleta de Propiedades. La matriz de recorrido sigue al recorrido cuando éste cambia. Opción ASOciativa = No para obtener copias sueltas.</li>
        <li><b>Regiones</b>: REGION convierte objetos cerrados o cadenas de líneas y arcos en regiones; UNION, SUBTRACT (DIFERENCIA) e INTERSECT (INTERSEC) operan con ellas conservando los arcos. CONTORNO (BOUNDARY, <code>BO</code>) crea una polilínea o una región con el contorno que rodea un punto, con sus islas.</li>
        <li><b>Cotas</b>: DIMARC (longitud de arco, completa o parcial, con el símbolo de arco) y DIMJOGGED (radio con recodo y centro desplazado para arcos grandes). Las dos son asociativas.</li>
        <li><b>XCLIP</b>: delimita referencias a bloques y referencias externas con un contorno rectangular, poligonal o una polilínea, normal o invertido; activar, desactivar, suprimir o generar la polilínea. XCLIPFRAME muestra u oculta el marco.</li>
        <li><b>DXF 2007</b>: las tablas se escriben como ACAD_TABLE con sus estilos (TABLESTYLE), las líneas múltiples como MLINE con MLINESTYLE (también en DXF 2000), las cotas nuevas como ARC_DIMENSION y LARGE_RADIAL_DIMENSION y las delimitaciones como SPATIAL_FILTER; todo se vuelve a leer. <b>Estados de capa</b> en archivos <code>.las</code>: botones Importar y Exportar de LAYERSTATE y opciones de -LAYERSTATE.</li>
      </ul>
      <h4>Novedades de la v0.6</h4>
      <ul>
        <li><b>Grupos</b>: GROUP (<code>G</code>) agrupa objetos, con nombre y descripción o sin nombre (*A1…). Designar un objeto del grupo designa el grupo entero; el botón <b>GRUPO</b> de la barra de estado (<kbd>Ctrl+Mayús+A</kbd>) lo activa o desactiva. UNGROUP, GROUPEDIT (añadir, quitar, renombrar) y CLASSICGROUP (administrador). Copiar un grupo entero crea un grupo con las copias.</li>
        <li><b>DIVIDE</b> y <b>MEASURE</b> (<code>GRADUA</code>): puntos o bloques (alineados o no) a lo largo de líneas, arcos, círculos, polilíneas, splines y elipses, en partes iguales o cada cierta longitud desde el extremo más próximo al designado.</li>
        <li><b>Estados de capa</b>: LAYERSTATE (<code>LAS</code>) guarda la configuración de las capas con un nombre y la restaura de una vez, entera o sólo algunas propiedades; -LAYERSTATE por la línea de comandos.</li>
        <li><b>Patrones personalizados</b>: PATRONES carga archivos .pat de AutoCAD (acadiso.pat, acad.pat en pulgadas o propios) o definiciones pegadas; quedan guardados en el dibujo. SOMBREADO ofrece también un patrón <b>definido por el usuario</b> (opción Usuario: separación y líneas cruzadas).</li>
        <li><b>AUTOCONSTRAIN</b>: aplica de una vez las restricciones geométricas que la geometría ya cumple dentro de una tolerancia (coincidente, colineal, paralela, perpendicular, tangente, concéntrica, horizontal, vertical, igual), sin restricciones redundantes.</li>
        <li><b>Bloques dinámicos</b>: varios parámetros lineales, parámetro de <b>rotación</b> (BPARAMETER) y <b>tabla de consulta</b> (BLOOKUPTABLE): cada fila fija a la vez varias medidas, el ángulo y el estado de visibilidad; se elige con el pinzamiento triangular o en Propiedades.</li>
        <li><b>DXF 2007</b> (DXFOUT, botón «DXF 2007»): directrices múltiples como MULTILEADER con sus estilos, degradados reales, UTF-8; los grupos y los patrones personalizados se exportan e importan también en DXF 2000.</li>
      </ul>
      <h4>Novedades de la v0.5</h4>
      <ul>
        <li><b>DIMCONTINUE / DIMBASELINE / QDIM</b>: cotas encadenadas, desde una línea base (separación «DIMDLI» del estilo) y acotación rápida de una selección.</li>
        <li><b>Restricciones paramétricas</b> (pestaña Paramétrico): GEOMCONSTRAINT (horizontal, vertical, paralela, perpendicular, coincidente, concéntrica, igual, fija, tangente, colineal) y DIMCONSTRAINT con nombre y expresión (<code>d2 = d1/2</code>). Doble clic en una cota de restricción para cambiarla; PARAMETERS administra los parámetros.</li>
        <li><b>Bloques dinámicos</b>: en el editor de bloques, BPARAMETER añade estiramiento lineal, simetría o visibilidad (BVSTATE, BVHIDE, BVSHOW). Las referencias muestran pinzamientos cian y propiedades «Personalizado».</li>
        <li><b>Campos</b> (CAMPO o botón «Campo…» del editor de texto): fecha, nombre del dibujo, presentación, escala, autor o propiedad de un objeto; se actualizan solos. El cajetín los usa.</li>
        <li><b>Estilos de directriz y de tabla</b> (MLEADERSTYLE, TABLESTYLE), <b>degradados</b> (GRADIENT) y <b>PDF vectorial</b> (PDFOUT) a escala real, con todas las presentaciones en un archivo.</li>
      </ul>
      <h4>Novedades de la v0.4</h4>
      <ul>
        <li><b>Cotas asociativas</b>: los puntos designados con referencia a objetos quedan unidos a la geometría; al modificarla, la cota se actualiza (también en la vista previa de los pinzamientos). INTRO en la primera solicitud de DIMLINEAR/DIMALIGNED acota una línea, un arco o un tramo de polilínea. DIMDISASSOCIATE y DIMREASSOCIATE quitan o restablecen la asociación.</li>
        <li><b>MLEADER</b> (<code>LE</code>): directriz con texto con formato, globo numerado o sin contenido. Flecha y altura del estilo de cota actual.</li>
        <li><b>TABLE</b> (<code>TB</code>): tablas con título, encabezados y celdas que se ajustan al texto. Doble clic para editar; se puede pegar un rango de una hoja de cálculo.</li>
        <li><b>Formato en MTEXT</b>: negrita, cursiva, subrayado, color, fuente, altura y fracciones apiladas desde la barra del editor.</li>
        <li><b>Splines</b>: recortar, alargar, desfasar y partir, con intersecciones exactas.</li>
        <li><b>BEDIT</b>: editor de bloques; BASE, BSAVE y BCLOSE. <b>XATTACH / XREF</b>: referencias externas a otros dibujos .tcad o .dxf (recargar, desenlazar, unir).</li>
        <li><b>DXF</b>: las cotas se exportan como entidades DIMENSION, con sus estilos de cota; se importan DIMENSION, LEADER, MULTILEADER y tablas.</li>
      </ul>
      <h4>Novedades de la v0.3</h4>
      <ul>
        <li><b>Sombreado asociativo</b>: al modificar el contorno (pinzamientos, desplazar, estirar…) el sombreado se actualiza. Si se mueve el sombreado solo o se borra el contorno, deja de ser asociativo.</li>
        <li><b>Atributos de bloque</b>: ATTDEF define textos variables; al insertar el bloque se piden sus valores. Doble clic en la referencia (o ATTEDIT) para cambiarlos. El cajetín de las presentaciones es un bloque con atributos.</li>
        <li><b>MTEXT</b> (<code>T</code>): párrafos con ajuste de palabras a una anchura y nueve justificaciones. Doble clic para editarlo.</li>
        <li><b>SPLINE</b>: curvas por puntos de ajuste o por vértices de control, abiertas o cerradas.</li>
        <li><b>DIMANGULAR</b> y <b>DIMORDINATE</b>: cotas angulares (dos líneas, arco, círculo o tres puntos) y de coordenadas X/Y.</li>
        <li><b>Capas por ventana</b>: con una ventana gráfica activa, la columna «Vent.» de la paleta de capas (o VPLAYER) oculta capas sólo en esa ventana.</li>
        <li><b>DXF</b>: las presentaciones, sus ventanas gráficas, los atributos, MTEXT y las splines se exportan e importan.</li>
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
