// Novedades de la v0.12 (3): automatización. Guiones .scr (SCRIPT), designación escribiendo un punto, grabación de
// acciones a guion (ACTRECORD / ACTSTOP), API en JavaScript (tc): altas, consultas, órdenes, guiones y órdenes nuevas,
// JSEVAL y la consola
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const doc = app.doc, out = {}, P = (x, y) => ({ x, y });
const cmd = async (name, ...steps) => { const p = app.run(name); for (const s of steps) { await tick(); if (typeof s === 'string') app.submit(s); else await s(); } await tick(); if (app.req) { const pr = app.req.prompt; app.escape(); await p; return 'ESPERANDO ' + pr; } await p; return 'ok'; };
const r4 = v => +(+v).toFixed(4);
const pt = p => [r4(p.x), r4(p.y)];
const last = () => doc.model[doc.model.length - 1];
const SC = await import('./js/scripting.js');
app.view.cx = 50; app.view.cy = 50; app.view.scale = 4; app.renderer.invalidate();

// ---- SCRIPT: espacio y fin de línea = Intro; los textos con espacios toman el resto de la línea ----
const scr = [
  '; Guion de prueba',
  'LINE 0,0 100,0 100,50 ',
  'CIRCLE 50,25 10',
  'TEXT 10,60 5 0 Eje principal km 0+000',
  '',
  'LAYER',
].join('\n');
const n0 = doc.model.length;
const runScr = async (text, name) => { app.run('SCRIPT', { text, name }); await tick(); return app.scriptPromise; };
await runScr(scr.split('\nLAYER')[0], 'prueba.scr');
const made = doc.model.slice(n0);
out.script = { types: made.map(e => e.type), line2: pt(made[1].p2), circle: made[2] ? [pt(made[2].c), made[2].r] : null, text: made[3]?.text };
// Una orden que abre un diálogo detiene el guion
const dlg = await runScr('VIEW\nLINE 0,0 1,1 \n', 'dialogo.scr');
document.querySelector('#modal-root .modal-head .ib')?.click(); await tick(20);
out.dialogStops = { result: dlg, msg: [...document.querySelectorAll('#cmd-history .err')].at(-1)?.textContent.slice(0, 40) };
// Designar escribiendo un punto (en guiones): ERASE con un punto sobre el círculo
const circ = made[2];
await runScr('ERASE *60,25 \n', 'borrar.scr');
out.erasePoint = !doc.get(circ.id);

// ---- Grabación de acciones: se graba y se vuelve a ejecutar ----
await cmd('ACTRECORD');
out.recBadge = !document.querySelector('.sb-rec').hidden;
await cmd('LINE', '200,0', '@50,0', '');
const recLine = last();
// designación con el ratón: se graba como un punto sobre el objeto
await cmd('MOVE', async () => { await tick(); app.req.set.add(recLine.id); app.submit(''); }, '0,0', '0,10');
await app.run('ACTSTOP', { name: 'prueba', noSave: true });
out.recLines = SC.REC.lines.slice();
out.recBadgeOff = document.querySelector('.sb-rec').hidden;
const nRec = doc.model.length;
await runScr(app.lastRecording, 'grabado.scr');
const replay = doc.model.slice(nRec);
out.replay = { n: replay.length, p1: replay[0] ? pt(replay[0].p1) : null, moved: pt(doc.get(recLine.id).p1) };

// ---- API en JavaScript ----
const tc = window.tc;
const id1 = tc.line([0, -50], [100, -50], { layer: tc.layer('EJE', '#ff0000') });
const id2 = tc.circle({ x: 0, y: -80 }, 12);
const id3 = tc.text([0, -100], 3.5, 'Progresiva 0+100', { rot: 90 });
tc.pline([[0, 0], [10, 0], [10, 10]], true);
out.api = { line: tc.get(id1).layer, circle: tc.get(id2).r, textRot: r4(tc.get(id3).rot * 180 / Math.PI), lines: tc.all({ type: 'line' }).length, onEje: tc.all({ layer: 'EJE' }).length };
tc.modify(id2, e => { e.r = 20; });
out.apiModify = tc.get(id2).r;
doc.undo(); app.afterUndo();
out.apiUndo = tc.get(id2).r; // cada llamada es una operación de deshacer
tc.select([id1, id2]);
out.apiSel = tc.selection().length;
tc.select([]);
out.apiCmd = await tc.command('CIRCLE', { x: 300, y: 300 }, '7');
out.apiCmdCircle = last().type === 'circle' && last().r === 7;
out.apiCmdSel = await tc.command('ERASE', [id1]);
out.apiErased = !tc.get(id1);
// Órdenes nuevas definidas desde JavaScript, con alias en español
tc.defineCommand('MARCAPK', { aliases: ['PK'], desc: 'Marca una progresiva', fn: async (c, api) => {
  const p = await c.getPoint('Precise punto de la progresiva');
  const t = await c.getString('Indique progresiva', { spaces: true });
  api.circle(p, 1); api.text([p.x + 2, p.y], 2, t);
} });
out.userCmds = tc.userCommands();
const nu = doc.model.length;
out.runUser = await cmd('PK', '500,500', '0+250');
out.userMade = doc.model.slice(nu).map(e => e.type + (e.text ? ':' + e.text : ''));
out.redefineBuiltin = (() => { try { tc.defineCommand('LINE', () => {}); return 'permitido'; } catch (e) { return e.message; } })();
// JSEVAL: expresión y código con return
await cmd('JSEVAL', 'tc.all({ type: "circle" }).length');
out.jseval = [...document.querySelectorAll('#cmd-history div')].at(-1).textContent;
await cmd('JSEVAL', 'const n = tc.all().length; return n > 0;');
out.jseval2 = [...document.querySelectorAll('#cmd-history div')].at(-1).textContent;
// Error dentro del código: se informa sin romper la aplicación
await cmd('JSEVAL', 'tc.insert("NOEXISTE", [0, 0])');
out.jsErr = [...document.querySelectorAll('#cmd-history .err')].at(-1).textContent;
// API desde un guion (tc.script) y consola
await tc.script('LINE 0,200 50,200 \n');
out.apiScript = pt(last().p2);
app.run('JSCONSOLE'); await tick(30);
const ta = document.querySelector('.js-code');
ta.value = 'return tc.all({ type: "line" }).length;';
document.querySelector('.js-console .btn.primary').click(); await tick(50);
out.console = document.querySelector('.js-out').textContent;
document.querySelector('#modal-root .modal-foot .btn').click(); await tick(20);
tc.removeCommand('MARCAPK');
out.removed = !tc.userCommands().length;
return out;
