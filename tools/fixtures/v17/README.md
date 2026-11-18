# Referencias independientes de topografía

`delaunay.json` contiene 80 puntos aleatorios y 149 triángulos calculados con
SciPy / `scipy.spatial.Delaunay` (Qhull), fuera de TrazoCAD. Se generaron con
`numpy.random.default_rng(17017).uniform(-100, 100, (80, 2))` y cotas
`z = 12 + 0.13*x - 0.08*y`. La prueba compara los conjuntos de vértices de
cada cara, sin depender del orden/orientación de salida de Qhull.
SciPy y NumPy sólo se usaron para generar esta referencia; no son dependencias
de la aplicación ni de las pruebas de navegador.

Los demás controles son analíticos: el plano `z=x+2y`, una superficie cóncava
con dos huecos (área 70), pendientes constantes y una poligonal de lados
100, 100, 100 y 99 con azimutes 0°, 90°, 180°, 270°. Su cierre es 1,
longitud 399 y precisión 1:399. Bowditch aplica correcciones X `-Li/399`;
Tránsito reparte X entre las proyecciones de 100 y 99.
El MDT sintético de 7×7 muestras tiene gradientes métricos 0.1 y -0.2;
su NoData interior elimina cuatro celdas del paso 1 y una del paso 2.
