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

const port = 8000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, [join(ROOT, 'serve.mjs'), String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
const errs = [];
page.on('console', async m => { if (m.type() === 'error' || m.type() === 'warning') { let t = m.text(); try { t = (await Promise.all(m.args().map(a => a.evaluate(v => v instanceof Error ? v.stack : String(v))))).join(' '); } catch {} errs.push(`[${m.type()}] ${t}`); } });
page.on('pageerror', e => errs.push(`[pageerror] ${e.message}`));
try {
  await page.goto(`http://localhost:${port}/?nuevo`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.app, { timeout: 5000 });
  if (testFile) {
    const body = readFileSync(testFile, 'utf8');
    const res = await Promise.race([new Promise(r => setTimeout(() => r('TIMEOUT'), 30000)), page.evaluate(`(async () => { const app = window.app; try { ${body} } catch (e) { return "ERROR: " + e.stack; } })()`)]);
    if (res === 'TIMEOUT') console.log('TIMEOUT; orden pendiente:', await page.evaluate(() => window.app.req && window.app.req.prompt));
    // Archivos binarios o grandes que devuelve la prueba: se guardan en tools/out
    if (res && typeof res === 'object') {
      mkdirSync(OUT, { recursive: true });
      if (res.pdf) { writeFileSync(join(OUT, 'out.pdf'), Buffer.from(res.pdf, 'base64')); delete res.pdf; }
      if (res.d2000) { writeFileSync(join(OUT, 'out2000.dxf'), res.d2000); delete res.d2000; }
      if (res.d12) { writeFileSync(join(OUT, 'out12.dxf'), res.d12); delete res.d12; }
    }
    console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
  }
  await new Promise(r => setTimeout(r, 300));
  if (shot) await page.screenshot({ path: shot });
} catch (e) { console.log('FALLO:', e.message); }
if (errs.length) console.log('CONSOLA:\n' + errs.join('\n'));
await browser.close();
srv.kill();
