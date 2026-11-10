# Notas del chequeo de tipos

Problemas que encontró TypeScript al anotar los módulos (fase 3). Los errores reales **no se arreglan** durante el
chequeo de tipos: se apuntan aquí y la línea queda marcada con `@ts-expect-error` y una referencia a este archivo (al
arreglarlos hay que quitar esa marca, o `tsc` avisará de que ya no hay error).

## Errores reales

| Archivo | Línea | Problema |
|---|---|---|
| `js/app.js` | 415 (`zoomExtents`) | Con una ventana gráfica activa (MSPACE), `this.view` es una `VpView`, cuyos `cx`, `cy` y `scale` son sólo de lectura. Si el modelo no tiene objetos visibles, ZOOM › Extensión (o Todo) asigna `this.view.cx = 210` y lanza `TypeError: Cannot set property cx of #<VpView> which has only a getter`. Comprobado en Chrome: presentación nueva, MSPACE en su ventana y modelo vacío. |
| `js/commands.js` | 2923 (APPLOAD) | `c.print(mensaje, 'err')`: el `print` del contexto de las órdenes (`makeCtx` en `app.js`) sólo recibe el mensaje, así que el error al cargar una aplicación se muestra sin el estilo de error. |
| `js/icons.js` | 135 | La clave `mlstyle` está dos veces: la v0.5 la creó para el estilo de directriz y la v0.7 la reutilizó para el estilo de línea múltiple, que pisa a la primera. El botón MLEADERSTYLE de la cinta muestra el icono de las líneas múltiples y el de la directriz no se usa. |
| `js/scripting.js` | 196 (`tc.defineCommand`) | Llama a `app.ui.refreshHelp?.()`, que no existe en la interfaz: la llamada no hace nada (si la ayuda está abierta, no muestra la orden nueva hasta volver a abrirla). |

## Cambios sin efecto en el funcionamiento

| Archivo | Cambio |
|---|---|
| `js/document.js` (`loadState`) | Se quitó una comparación redundante (`this.space !== 'bedit'` en una rama donde ya no puede valerlo). TypeScript la marcaba como comparación sin coincidencia posible. |
| `js/render.js` (`drawModelTiles`) | `seen(b) - seen(a)` (resta de booleanos) pasa a `+seen(b) - +seen(a)`: mismo resultado. |
| `js/app.js` | Se exporta la clase (`export class App`) para usarla como tipo en los demás módulos, y se declaran (sin valor) los campos que le ponen otros módulos: `xrefHandles`, `lastRecording`, `scriptDepth`, `scriptStop`, `noGroupPick`. |
| `js/document.js` (`class Doc`) | Se declaran (sin valor) los campos que pone la aplicación: `verifyUndo`, `curCmd`, `viewState`, `consDirty`. |
| `js/view.js` (`class View`) | Se declara `vp` (siempre `undefined` en `View`; sólo `VpView` tiene ventana gráfica) para que `v.vp` distinga las dos vistas. |
| `sw.js` | Se usa `sw` (el mismo `self` con el tipo `ServiceWorkerGlobalScope`) en vez de `self`. |
| Varios | Algunas expresiones se partieron en una variable intermedia o se envolvieron en una conversión JSDoc (`/** @type {…} */ (x)`) para que TypeScript siguiera el tipo, p. ej. `arcOf(pc)` en vez de `pc.prim.c` en los tramos con arco de las polilíneas, o `typeDef(e)` en vez de `TYPES[e.type]` para una entidad cualquiera. |

## Sin tipo todavía

- Los resultados de los diálogos de `ui.js` (`modal`) no tienen un tipo común: cada diálogo devuelve su propia estructura, que se queda sin tipo.
- Los parámetros de las funciones internas (no exportadas) de muchos módulos siguen sin anotar: con `strict` (`noImplicitAny`) aparecerán.

## Modo `strict` (fase 4)

`checkJs` está activado y no da errores. `strict` no está activado: con él salen **4516 errores** (y 1 en `sw.js`).
Por opción:

| Opción | Errores | Qué son |
|---|---|---|
| `noImplicitAny` | 3073 | Parámetros (2148, TS7006) y variables sin tipo, sobre todo de funciones internas y de los manejadores de la interfaz. Por módulo: commands 381, ui 300, dxf 257, entities 190, pdf 112, constraints 110… |
| `strictNullChecks` | 1612 | Valores que pueden ser `null` o `undefined` sin comprobar: `doc.get(id)`, `find(…)`, `querySelector(…)`, resultados de las peticiones con Intro (`allowEnter`). |
| `useUnknownInCatchVariables` | 17 | `catch (err)` con `err.message` (en `app.js`, `commands.js`, `constraints.js`, `dxfworker.js`…). |
| `strictFunctionTypes` | 7 | Órdenes que declaran el tipo de su argumento (INSERT, LIBINSERT, CANNOSCALE, JSEVAL, PDFOUT, _GRIP, _GRIPVERTEX) frente a `arg?: unknown` de `def`. |
| `noImplicitThis`, `strictBindCallApply`, `alwaysStrict` | 0 | — |

Por módulo (todas las opciones): commands 1123, ui 558, dxf 415, entities 411, app 242, render 222, constraints 213, pdf 133; el resto, menos de 100 cada uno.
Para avanzar hacia `strict` conviene activar las opciones de una en una (primero `useUnknownInCatchVariables` y `strictFunctionTypes`, luego `strictNullChecks` módulo a módulo) y anotar los parámetros del código nuevo desde ya.
