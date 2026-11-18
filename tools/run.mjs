// Ejecutor de pruebas en Chrome sin interfaz.
// Uso: node tools/run.mjs <prueba.js> [captura.png] [ancho] [alto]
// Sirve el proyecto, abre la app y ejecuta la prueba (cuerpo de una función async con `app` disponible); imprime lo que devuelva.
// Chrome: variable CHROME_PATH, o la ruta habitual de Windows/Linux/macOS, o el Chrome que descarga `npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer`.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TOOLS, '..');
const OUT = join(TOOLS, 'out');
const [, , testFile, shot, W = '1500', H = '900'] = process.argv;

// Busca un Chrome instalado
function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  // Chrome descargado por @puppeteer/browsers en ~/.cache/puppeteer
  try {
    const base = join(homedir(), '.cache', 'puppeteer', 'chrome');
    for (const v of readdirSync(base)) for (const sub of ['chrome-linux64/chrome', 'chrome-win64/chrome.exe']) if (existsSync(join(base, v, sub))) return join(base, v, sub);
  } catch { /* no hay Chrome descargado */ }
  return null;
}

const executablePath = findChrome();
if (!executablePath) { console.log('No se encontró Chrome: define CHROME_PATH o ejecuta `npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer`.'); process.exit(1); }

// El sistema elige un puerto libre. Esperar a listen evita colisiones y arranques a medias en pruebas paralelas.
const srv = spawn(process.execPath, [join(ROOT, 'serve.mjs'), '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
const port = await new Promise((resolve, reject) => {
  let stderr = ''; const timer = setTimeout(() => { srv.kill(); reject(Error('El servidor de pruebas no inició en 10 s.')); }, 10000);
  srv.stderr.on('data', data => { stderr += data; });
  srv.on('error', e => { clearTimeout(timer); reject(e); });
  srv.on('exit', code => { clearTimeout(timer); reject(Error(`Servidor de pruebas cerrado (${code}): ${stderr}`)); });
  srv.stdout.on('data', data => { const m = String(data).match(/http:\/\/localhost:(\d+)/); if (m) { clearTimeout(timer); resolve(+m[1]); } });
});

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
const errs = [];
page.on('console', async m => { if (m.type() === 'error' || m.type() === 'warning') { let t = m.text(); try { if (m.args().length) t = (await Promise.all(m.args().map(a => a.evaluate(v => v instanceof Error ? v.stack : String(v))))).join(' '); } catch {} errs.push(`[${m.type()}] ${t}`); } });
page.on('response', res => { if (res.status() >= 400) errs.push(`[HTTP ${res.status()}] ${new URL(res.url()).pathname}`); });
page.on('requestfailed', req => errs.push(`[red] ${new URL(req.url()).pathname}: ${req.failure()?.errorText}`));
page.on('pageerror', e => errs.push(`[pageerror] ${e.message}`));
// TC_VERIFY_UNDO=1: la app comprueba en cada transacción que deshacer y rehacer devuelven el estado exacto
if (process.env.TC_VERIFY_UNDO) await page.evaluateOnNewDocument(() => { window.TC_VERIFY_UNDO = true; });
try {
  await page.goto(`http://localhost:${port}/?nuevo`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.app, { timeout: 15000 });
  if (testFile) {
    const body = readFileSync(testFile, 'utf8');
    let timer;
    const res = await Promise.race([new Promise(r => { timer = setTimeout(() => r('TIMEOUT'), 30000); }), page.evaluate(`(async () => { const app = window.app; try { ${body} } catch (e) { return "ERROR: " + e.stack; } })()`)]).finally(() => clearTimeout(timer));
    if (res === 'TIMEOUT' || typeof res === 'string' && res.startsWith('ERROR:')) process.exitCode = 1;
    if (res === 'TIMEOUT') console.log('TIMEOUT; orden pendiente:', await page.evaluate(() => window.app.req && window.app.req.prompt));
    // Archivos binarios o grandes que devuelve la prueba: se guardan en tools/out
    if (res && typeof res === 'object') {
      mkdirSync(OUT, { recursive: true });
      if (res.pdf) { writeFileSync(join(OUT, 'out.pdf'), Buffer.from(res.pdf, 'base64')); delete res.pdf; }
      if (res.d2000) { writeFileSync(join(OUT, 'out2000.dxf'), res.d2000); delete res.d2000; }
      if (res.d12) { writeFileSync(join(OUT, 'out12.dxf'), res.d12); delete res.d12; }
      if (res.d2007) { writeFileSync(join(OUT, 'out2007.dxf'), res.d2007); delete res.d2007; }
    }
    console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
  }
  await new Promise(r => setTimeout(r, 300));
  if (shot) await page.screenshot({ path: shot });
} catch (e) { console.log('FALLO:', e.message); process.exitCode = 1; }
if (errs.length) console.log('CONSOLA:\n' + errs.join('\n'));
if (errs.some(s => s.startsWith('[pageerror]'))) process.exitCode = 1;
await browser.close();
srv.kill();
