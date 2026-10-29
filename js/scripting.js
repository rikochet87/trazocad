// Automatización: guiones .scr (SCRIPT) con las mismas órdenes y respuestas que la línea de comandos, grabación de
// acciones a guion (ACTRECORD / ACTSTOP) y API en JavaScript para el usuario (consola, archivos .js cargados con APPLOAD
// y órdenes nuevas definidas desde JavaScript).
import * as G from './geom.js';
import { CMDS, findCmd } from './commands.js';
import { gripsOf, primsOf, TYPES } from './entities.js';

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// ---------- Guiones .scr ----------
// Como en AutoCAD, cada espacio y cada fin de línea equivalen a pulsar Intro; una línea vacía es un Intro. Cuando la
// orden pide un texto que admite espacios (el contenido de un texto, un nombre), se le da el resto de la línea.
// Las líneas que empiezan por ";" son comentarios.
export class ScriptError extends Error {}

// Espera a que la aplicación pida un dato o termine la orden; una orden que abre un diálogo detiene el guion
async function idle(app, maxMs = 120000) {
  const t0 = performance.now();
  for (;;) {
    await tick();
    if (app.scriptStop) throw new ScriptError('Guion interrumpido.');
    if (app.req || !app.cmdPromise) return;
    if (document.querySelector('#modal-root .modal')) throw new ScriptError(`La orden ${app.cmd?.name || ''} abre un diálogo, que un guion no puede responder: use su versión de línea de órdenes (con guion delante, p. ej. -VIEW) o la API en JavaScript.`);
    if (performance.now() - t0 > maxMs) throw new ScriptError('La orden no responde.');
  }
}

export async function runScript(app, text, name = 'guion') {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); // el salto final no es un Intro más
  app.scriptDepth = (app.scriptDepth || 0) + 1;
  app.scriptStop = false;
  let n = 0;
  try {
    await idle(app);
    for (const line of lines) {
      if (/^\s*;/.test(line)) continue;
      let rest = line;
      for (;;) {
        await idle(app);
        const r = app.req;
        if (r && r.kind === 'string' && r.opts.spaces) { app.submit(rest); n++; break; }
        const i = rest.indexOf(' ');
        if (i < 0) { app.submit(rest); n++; break; }
        app.submit(rest.slice(0, i)); n++;
        rest = rest.slice(i + 1);
      }
    }
    await idle(app);
    return n;
  } catch (err) {
    if (app.cmdPromise) { // se cancela la orden pendiente (y se cierra su diálogo, si lo abrió)
      app.cancelCurrent();
      document.querySelector('#modal-root .modal-head .ib')?.click();
      try { await Promise.race([app.cmdPromise, tick(3000)]); } catch { /* cancelada */ }
    }
    throw err instanceof ScriptError ? err : new ScriptError(`${name}: ${err.message}`);
  } finally {
    app.scriptDepth--;
  }
}

// ---------- Grabación de acciones ----------
// Se graba una respuesta por línea (así los textos con espacios no se parten): el nombre de cada orden, lo escrito y,
// para lo designado con el ratón, las coordenadas universales (*x,y) o un punto sobre cada objeto designado.
export const REC = { on: false, lines: [], name: '' };
const nf = v => String(+(+v).toFixed(8));
const wpt = p => `*${nf(p.x)},${nf(p.y)}`;
// Punto sobre el objeto (para volver a designarlo escribiendo el punto)
export function pointOn(e) {
  const q = primsOf(e).find(Boolean);
  if (q) return q.k === 's' ? G.mid(q.a, q.b) : G.polar(q.c, q.a2 > q.a1 ? (q.a1 + q.a2) / 2 : q.a1, q.r);
  return gripsOf(e)[0] || null;
}
export function recCommand(d, arg) {
  if (!REC.on || d.hidden || d.name === 'ACTRECORD' || d.name === 'ACTSTOP') return;
  REC.lines.push(d.name);
  if (typeof arg === 'string' || typeof arg === 'number') REC.lines.push(String(arg));
}
export function recAnswer(app, r, v, typed) {
  if (!REC.on || (app.cmd && (app.cmd.name === 'ACTRECORD' || app.cmd.name === 'ACTSTOP'))) return;
  if (r.kind === 'select') { // lo designado (con el ratón o escribiendo), como un punto sobre cada objeto
    for (const id of v || []) { const e = app.doc.get(id), p = e && pointOn(e); if (p) REC.lines.push(wpt(p)); }
    REC.lines.push('');
    return;
  }
  if (typed !== undefined) { REC.lines.push(typed); return; }
  switch (r.kind) {
    case 'point': if (v && typeof v === 'object') REC.lines.push(wpt(v)); else if (v != null) REC.lines.push(String(v)); else REC.lines.push(''); break;
    case 'distance': REC.lines.push(v == null ? '' : nf(v)); break;
    case 'angle': REC.lines.push(v == null ? '' : nf(G.deg(v))); break;
    case 'entity': REC.lines.push(v?.pt ? wpt(v.pt) : ''); break;
    default: REC.lines.push(v == null ? '' : String(v));
  }
}
export const recText = () => `; Guion de TrazoCAD${REC.name ? ` "${REC.name}"` : ''} grabado con ACTRECORD (${new Date().toLocaleString('es')})\n${REC.lines.join('\n')}\n`;

// ---------- API en JavaScript ----------
const pt = p => (Array.isArray(p) ? G.P(+p[0], +p[1]) : G.P(+p.x, +p.y));
const BASE = () => ({});
// Respuestas para command(): textos (como en la línea de órdenes), puntos, números, listas de identificadores (para
// designar) u objetos {pick: id, at: punto}
async function feed(app, name, answers) {
  const p = app.run(name);
  for (const a of answers) {
    await idle(app);
    if (!app.req) break;
    const r = app.req;
    if (Array.isArray(a) && r.kind === 'select') { for (const id of a) r.set.add(id); app.submit(''); continue; }
    if (a && typeof a === 'object' && 'pick' in a && r.kind === 'entity') { const e = app.doc.get(a.pick); r.resolve({ e, pt: a.at ? pt(a.at) : pointOn(e) }); continue; }
    if (a && typeof a === 'object' && 'x' in a) { app.submit(`*${a.x},${a.y}`); continue; }
    app.submit(String(a));
  }
  await idle(app);
  if (app.req) { const pr = app.req.prompt; app.escape(); await p; return `ESPERANDO ${pr}`; }
  await p;
  return 'ok';
}

export function makeApi(app) {
  const doc = () => app.doc;
  // Las altas y modificaciones fuera de una orden se agrupan en una operación de deshacer
  const tx = fn => {
    const d = doc(), own = !d.tx;
    if (own) d.begin();
    try { return fn(d); } finally { if (own) { d.commit(); app.renderer.invalidate(); app.ui.refresh(); } }
  };
  const add = (e, props = {}) => tx(d => d.add(app.annoNew({ ...BASE(), ...e, ...props })).id);
  const api = {
    version: '0.12',
    get app() { return app; },
    get doc() { return doc(); },
    G, P: G.P,
    // Altas: devuelven el identificador del objeto
    add: e => add(e),
    line: (a, b, props) => add({ type: 'line', p1: pt(a), p2: pt(b) }, props),
    circle: (c, r, props) => add({ type: 'circle', c: pt(c), r: +r }, props),
    arc: (c, r, a1, a2, props) => add({ type: 'arc', c: pt(c), r: +r, a1: G.rad(a1), a2: G.rad(a2) }, props),
    pline: (pts, closed = false, props) => add({ type: 'pline', pts: pts.map(pt), closed: !!closed }, props),
    point: (p, props) => add({ type: 'point', p: pt(p) }, props),
    text: (p, h, text, { rot = 0, ...props } = {}) => add({ type: 'text', p: pt(p), h: +h, rot: G.rad(rot), text: String(text), align: 'l' }, props), // rot en grados
    mtext: (p, h, text, props) => add({ type: 'mtext', p: pt(p), h: +h, w: 0, rot: 0, attach: 'tl', text: String(text) }, props),
    insert: (name, p, props) => {
      if (!doc().blocks[name]) throw new Error(`No existe el bloque "${name}".`);
      return add({ type: 'insert', name, p: pt(p), sx: 1, sy: 1, rot: 0 }, props);
    },
    // Consultas
    get: id => doc().get(id) || null,
    all: (filter = {}) => {
      const f = typeof filter === 'function' ? filter : e => Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(e[k]) : e[k] === v));
      return doc().ents.filter(f);
    },
    selection: () => [...app.sel],
    select: ids => { app.sel.clear(); for (const id of [].concat(ids)) if (doc().get(id)) app.sel.add(id); app.selChanged(); return app.sel.size; },
    typeName: e => TYPES[e.type]?.name || e.type,
    // Modificaciones
    modify: (id, fn) => tx(d => { d.modify(id, fn); }),
    erase: ids => tx(d => { for (const id of [].concat(ids)) if (d.get(id)) d.remove(id); }),
    transaction: fn => tx(() => fn(api)),
    layer: (name, color = '#ffffff') => tx(d => d.ensureLayer(name, color)).name,
    setLayer: name => { tx(d => d.ensureLayer(name)); doc().cur.layer = name; app.ui.refresh(); },
    undo: () => { doc().undo(); app.afterUndo(); },
    // Órdenes y guiones
    command: (name, ...answers) => feed(app, name, answers),
    script: text => runScript(app, text, 'API'),
    print: msg => app.print(String(msg)),
    zoomExtents: () => app.zoomExtents(),
    // Órdenes nuevas: fn(ctx, api, arg); ctx tiene getPoint, getSelection, getString, getNumber, print, add…
    defineCommand(name, opts) {
      const o = typeof opts === 'function' ? { fn: opts } : opts || {};
      const N = String(name).trim().toUpperCase();
      if (!/^[A-Z0-9_-]{1,40}$/.test(N)) throw new Error(`Nombre de orden no válido: "${name}".`);
      if (CMDS[N] && !CMDS[N].user) throw new Error(`La orden ${N} ya existe en TrazoCAD.`);
      const aliases = (o.aliases || []).map(a => String(a).toUpperCase()).filter(a => !findCmd(a) || findCmd(a).user);
      CMDS[N] = { name: N, aliases, desc: o.desc || 'Orden definida por el usuario', group: 'Usuario', user: true, ...(o.noTx ? { noTx: true } : {}), fn: (c, arg) => o.fn(c, api, arg) };
      app.ui.refreshHelp?.();
      return N;
    },
    removeCommand(name) { const N = String(name).toUpperCase(); if (CMDS[N]?.user) { delete CMDS[N]; return true; } return false; },
    userCommands: () => Object.values(CMDS).filter(d => d.user).map(d => d.name),
  };
  return api;
}

// Ejecuta código JavaScript del usuario con la API (tc) y la aplicación (app); devuelve lo que devuelva el código
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
export async function runJs(app, code, name = 'consola') {
  try { return await new AsyncFunction('tc', 'app', String(code))(app.api, app); }
  catch (err) { err.message = `${name}: ${err.message}`; throw err; }
}

// Aplicaciones cargadas al iniciar (APPLOAD › Cargar al iniciar), guardadas en el navegador
const APPS_KEY = 'trazocad.apps';
export function startupApps() { try { return JSON.parse(localStorage.getItem(APPS_KEY) || '[]'); } catch { return []; } }
export function saveStartupApps(list) { try { localStorage.setItem(APPS_KEY, JSON.stringify(list)); return true; } catch { return false; } }
export async function loadStartupApps(app) {
  for (const a of startupApps()) {
    try { await runJs(app, a.code, a.name); app.print(`Aplicación "${a.name}" cargada.`); } catch (err) { app.print(`Error al cargar "${a.name}": ${err.message}`, 'err'); }
  }
}
