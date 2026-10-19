# TrazoCAD: guía para Claude

CAD 2D tipo AutoCAD hecho como PWA en JavaScript puro con módulos ES. Sin dependencias ni compilación: `node serve.mjs` y abrir http://localhost:8080. La estructura de archivos está en el README.

## Cómo se trabaja

- El proyecto avanza por versiones. «Continúa con la versión N» significa implementar la sección **Hoja de ruta** del README de la versión anterior, completa y en el mismo estilo.
- Todo en español: interfaz, mensajes de la línea de comandos, comentarios, README y mensajes de commit. Los nombres de comando son los de AutoCAD en inglés, con alias en español (`def('DIMCONTINUE', ['DCO', 'COTACONTINUA', …], …)` en `js/commands.js`).
- La app no puede tener dependencias. Las de `tools/` son sólo para probar.
- Commits sólo cuando el usuario los pide («haz el commit»), con mensaje del tipo `TrazoCAD v0.N: resumen de las novedades`. No hacer push salvo que lo pida.

## Al terminar una versión

1. Pasar todas las pruebas (`tools/`) y añadir pruebas nuevas para lo implementado en `tools/tests/`.
2. README: título `TrazoCAD — v0.N`, tabla «Novedades de la v0.N» con su captura, estructura de archivos, limitaciones conocidas y nueva «Hoja de ruta (v0.N+1+)».
3. Captura nueva en `docs/` hecha con un guion como `tools/tests/captura-v05.js`.
4. `sw.js`: subir `CACHE` (`trazocad-vN`) y añadir los módulos nuevos a `ASSETS`.
5. Comprobar la sintaxis de todos los módulos: `for f in js/*.js sw.js; do node --check "$f"; done`.

## Pruebas en Chrome sin interfaz

```sh
cd tools && npm install
# si no hay Chrome instalado (p. ej. en la nube):
npx @puppeteer/browsers install chrome@stable --path ~/.cache/puppeteer
npm test                                          # todas las pruebas
node run.mjs tests/restricciones.js               # una sola
node run.mjs tests/captura-v05.js out/c.png 1500 900   # captura
```

Una prueba es el cuerpo de una función async que recibe `app` (= `window.app`) y devuelve un objeto que se imprime como JSON. `run.mjs` también muestra los errores de la consola. Los archivos `pdf`, `d2000` y `d12` que devuelva se guardan en `tools/out/`. Cada prueba define al principio sus utilidades (cópialas de una existente):

- `cmd('LINE', '0,0', '10,0', '')` ejecuta una orden y responde a sus peticiones. Si la orden se queda esperando, devuelve `'ESPERANDO <petición>'`.
- `pick(ent, punto)` designa un objeto cuando la orden lo pide.
- Las órdenes que abren un diálogo (INSERT sin argumento, por ejemplo) bloquean la prueba: usar `app.run('INSERT', 'NOMBRE')` o modificar el documento directamente con `doc.begin(); doc.modify(...); doc.commit()`.
- GRADIENT, HATCH y otras órdenes que buscan contornos necesitan que la zona esté visible: ajustar antes `app.view.cx`, `cy` y `scale`.

## Trampas conocidas

- Al parchear archivos con un guion de Node, `String.replace(texto, nuevo)` interpreta `$'`, `$&` y `$1` dentro de `nuevo` y corrompe el archivo. Usar un reemplazo con función (`() => nuevo`) o `slice`. En la v0.5 una inserción en `js/icons.js` se comió una clave y rompió la carga de la app.
