# TrazoCAD — v0.2

Software de dibujo técnico 2D inspirado en AutoCAD, hecho desde cero como **PWA** (aplicación web instalable y sin conexión). JavaScript puro con módulos ES: sin dependencias ni compilación.

![Captura](docs/captura.png)

## Ejecutar

```bash
node serve.mjs          # http://localhost:8080
```

Una PWA necesita `http://localhost` o HTTPS. Para publicarla, sube la carpeta tal cual a cualquier hosting estático con HTTPS (GitHub Pages, Netlify, Hostinger…). En Chrome/Edge aparece el botón **Instalar**.

## Novedades de la v0.2

| Función | Detalle |
|---|---|
| **Sombreado** (`HATCH`, `H`, `SOMBREADO`) | Punto interior con detección automática del contorno e islas, o selección de objetos cerrados. Patrones SOLID, ANSI31, ANSI32, ANSI37, NET, LINE, DASH, BRICK, CROSS, DOTS y EARTH (formato acad.pat), con escala y ángulo, y un selector visual de patrones |
| **Bloques** (`BLOCK`/`B`, `INSERT`/`I`) | Definición con punto base, referencias con escala, rotación y simetría, bloques anidados, capa 0 y PorBloque heredados, referencias a objetos dentro de bloques, redefinición, selector con vista previa, `PURGE` |
| **Polilíneas con arcos** | `PLINE` con modo Arco (tangente) / Línea. Recortar, alargar, desfase, partir, unir, descomponer, pinzamientos de arco, área y longitud exactas |
| **Presentaciones** (espacio papel) | Pestañas Modelo / Presentación, marco y cajetín automáticos, ventanas gráficas (`MVIEW`) a escala estándar, `MSPACE`/`PSPACE` y doble clic para trabajar a través de una ventana, `PAGESETUP` (A4…A0, Carta, Oficio), impresión/SVG/PNG a escala real |
| **Estilos** | `STYLE` (fuente, anchura, oblicuidad) y `DIMSTYLE` (alturas, flechas cerrada/abierta/oblicua/punto, decimales, sufijo, escala global) con vista previa |
| **Edición** | `CHAMFER` (líneas y polilíneas), `FILLET` en polilíneas, `BREAK`, `BREAKATPOINT`, `LENGTHEN` (incremento, porcentaje, total, dinámica) |
| **Isométrico** | Rejilla, forzado y orto isométricos; `F5`/`Ctrl+E` cambia de plano; isocírculos en `ELLIPSE` |
| **Rendimiento** | Índice espacial (árbol R empaquetado con STR) para designación, referencias a objetos y dibujado |
| **DXF 2000** | Exporta AC1015 con identificadores, tablas (capas, tipos de línea, estilos, registros de bloque), LWPOLYLINE con curvatura, HATCH con datos de patrón, ELLIPSE, INSERT, color verdadero y grosor de línea. R12 sigue disponible. Al importar se conservan los bloques, las polilíneas con arcos y los sombreados |

## Base de la v0.1

Línea de comandos con alias y opciones, entrada de coordenadas (`x,y`, `@dx,dy`, `@d<a`, distancia directa), referencias a objetos (punto final, medio, centro, cuadrante, intersección, perpendicular, cercano), ORTO, POLAR, RASTREO, FORZC, entrada dinámica, selección por ventana o captura, pinzamientos, capas, paleta de propiedades, cotas, deshacer ilimitado y autoguardado. Pulsa **F1** en la app para ver los 71 comandos.

## Estructura

```
index.html, manifest.webmanifest, sw.js   PWA
css/app.css                               Interfaz
js/geom.js       Vectores, matrices, intersecciones, curvaturas
js/entities.js   Tipos de entidad (línea … sombreado, referencia a bloque, ventana gráfica)
js/document.js   Capas, modelo, presentaciones, bloques, estilos, deshacer, serialización
js/patterns.js   Patrones de sombreado y recorte de líneas de patrón
js/hatch.js      Detección de contornos (grafo plano, trazado de caras e islas)
js/spatial.js    Índice espacial
js/view.js       Vista del modelo/papel y vista a través de ventana gráfica
js/render.js     Dibujado en canvas
js/snap.js       Referencias, rastreo, polar, orto, isométrico
js/ops.js        Recortar, alargar, partir, longitud, desfase, empalme, chaflán, unir…
js/commands.js   Comandos y alias
js/dxf.js        DXF 2000 / R12
js/io.js         Abrir, guardar, exportar SVG/PNG, imprimir
js/ui.js         Cinta, paletas, barra de estado, diálogos
js/app.js        Núcleo: entrada, motor de comandos, presentaciones
```

## Limitaciones conocidas

- El sombreado no es asociativo: si se modifica el contorno, el sombreado no se actualiza.
- La exportación DXF incluye el espacio modelo y los bloques, pero no las presentaciones. Las cotas se exportan descompuestas.
- En la importación, las referencias con escala no uniforme se descomponen.

## Hoja de ruta (v0.3+)

Sombreado asociativo, atributos de bloque, MTEXT de varias líneas, capas inutilizadas por ventana gráfica, splines, cotas angulares y de coordenadas, y exportación DXF de las presentaciones.
