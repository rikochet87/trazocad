// Ejecuta todas las pruebas de tools/tests (salvo las de captura) y muestra su salida.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(join(TOOLS, 'tests')).filter(f => f.endsWith('.js') && !f.startsWith('captura'))) {
  console.log(`\n######## ${f}`);
  spawnSync(process.execPath, [join(TOOLS, 'run.mjs'), join(TOOLS, 'tests', f)], { stdio: 'inherit' });
}
