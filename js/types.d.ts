// Tipos de TrazoCAD para el chequeo con TypeScript (sólo declaraciones: no se carga en el navegador).
// Desde los módulos se usan con JSDoc, p. ej. /** @typedef {import('./types').Point} Point */
//
// Unidades:
// - Coordenadas y longitudes: unidades de dibujo (internas, relativas al origen local del modelo: la coordenada real es
//   la interna + Doc.origin; ver origin.js). En el espacio papel, milímetros del papel.
// - Ángulos guardados en las entidades y usados por geom.js: radianes, en sentido antihorario desde +X. Grados sólo
//   en la interfaz (Propiedades, línea de comandos), en DEFAULT_SETTINGS.polarInc y en Hatch.angle (ver abajo).
// - Pantalla (View.toScreen, eventos del ratón): píxeles CSS de la zona de dibujo, con Y hacia abajo.
//   View.scale = píxeles por unidad de dibujo.
// - Grosores de línea (lw): milímetros, o 'BYLAYER' | 'BYBLOCK' | 'DEFAULT'.
// - Colores: '#rrggbb', o 'BYLAYER' | 'BYBLOCK'.

// ---------- Geometría (geom.js) ----------

/** Punto o vector 2D. Algunos llevan cota Z (pline3d, face3d, puntos de referencia). */
export interface Point { x: number; y: number; z?: number }
export interface Point3 { x: number; y: number; z: number }

/** Caja alineada con los ejes: x1 ≤ x2, y1 ≤ y2. */
export interface BBox { x1: number; y1: number; x2: number; y2: number }

/** Matriz afín [a, b, c, d, e, f]: x' = a·x + c·y + e ; y' = b·x + d·y + f */
export type Matrix = [number, number, number, number, number, number];

/** Primitivas para intersecciones, referencias y selección: segmento o arco (círculo completo: a1 = 0, a2 = TAU). */
export interface SegPrim { k: 's'; a: Point; b: Point }
export interface ArcPrim { k: 'a'; c: Point; r: number; a1: number; a2: number }
export type Prim = SegPrim | ArcPrim;

/** Tramo de polilínea (plPieces): de a a b, recto (bulge 0, prim segmento) o con curvatura (prim arco). */
export interface Piece { a: Point; b: Point; bulge: number; prim: Prim }

/** Contorno cerrado como lista de vértices (sombreados, recortes). */
export type Loop = Point[];
/** Contorno de región (region.js): cerrado, con arcos; exteriores antihorarios y huecos horarios. */
export interface RegionLoop { pts: Point[]; bulges?: number[] }

// ---------- Propiedades comunes de las entidades ----------

export type Color = string;          // '#rrggbb' | 'BYLAYER' | 'BYBLOCK'
export type LineWeight = number | 'BYLAYER' | 'BYBLOCK' | 'DEFAULT';

/** Referencia de un punto a la geometría (cotas asociativas, assoc.js). */
export type PointRef = { id: number; snap: Exclude<SnapKind, 'int'>; i: number; ids?: undefined } | { ids: [number, number]; snap: 'int'; id?: undefined; i?: undefined };

interface EntBase {
  id: number;                       // lo asigna Doc.add
  layer: string;
  color: Color;
  ltype: string;                    // nombre de LTYPES o 'BYLAYER' | 'BYBLOCK'
  lw: LineWeight;
  pstyle?: string;                  // estilo de trazado con nombre (plotstyles.js)
  elev?: number;                    // cota Z de los tipos de ELEV_TYPES (la línea usa z1 y z2)
  anno?: string[];                  // escalas anotativas que admite (annoscale.js)
  transparency?: number;            // 0..90 %
  pathId?: number;                  // recorrido asociado (matriz ARRAYPATH)
  assoc?: unknown;                  // asociatividad: cada tipo asociativo la concreta (Dim, CenterMark, Hatch)
  _xf?: boolean;                    // se transformó entero en la orden en curso (document.js, syncAssoc)
  _annoOff?: boolean;               // anotativo sin la escala actual: se dibuja atenuado (annoscale.js, no se guarda)
  seed?: unknown;                   // punto interior de un sombreado asociativo (Hatch)
  z?: number;                       // nivel en las matrices rectangulares con niveles (arrays.js)
}

// ---------- Entidades: unión discriminada por `type` (entities.js) ----------

export interface Line extends EntBase { type: 'line'; p1: Point; p2: Point; z1?: number; z2?: number }
export interface Circle extends EntBase { type: 'circle'; c: Point; r: number }
export interface Arc extends EntBase { type: 'arc'; c: Point; r: number; a1: number; a2: number }
/** Polilínea: bulges[i] es la curvatura del tramo i → i+1 (tan(ángulo/4), negativa = horaria). */
export interface Pline extends EntBase { type: 'pline'; pts: Point[]; bulges?: number[]; closed?: boolean; cloud?: number /* nube de revisión: longitud de arco */ }
/** Elipse: rot = giro del eje mayor (rx). */
export interface Ellipse extends EntBase { type: 'ellipse'; c: Point; rx: number; ry: number; rot: number }
/** Spline: por puntos de ajuste (fit), por vértices de control (cv) o sólo con los de control importados (ctrl). */
export interface Spline extends EntBase {
  type: 'spline'; deg: number; ctrl: Point[]; knots: number[]; w?: number[]; fit?: Point[]; cv?: Point[]; closed?: boolean;
}
export interface PointEnt extends EntBase { type: 'point'; p: Point }
export type TextAlign = 'l' | 'c' | 'r';
export interface Text extends EntBase { type: 'text'; p: Point; text: string; h: number; rot?: number; style?: string; align?: TextAlign }
export type MTextAttach = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';
/** Texto de líneas múltiples: w = anchura de ajuste (0 = sin ajuste); rich = text lleva formato (richtext.js). */
export interface MText extends EntBase {
  type: 'mtext'; p: Point; text: string; h: number; w: number; rot: number; attach: MTextAttach; rich?: boolean; style?: string; ls?: number;
}
export interface MLeader extends EntBase {
  type: 'mleader'; pts: Point[]; content: 'mtext' | 'block' | 'none'; text: string; rich?: boolean;
  mstyle?: string; style?: string; h?: number; w?: number; arrow?: ArrowKind; asz?: number; land?: number; gap?: number;
}
/** Tabla: cols y rows son anchuras y alturas; cells[fila][columna] es el texto (puede llevar campos %<…>%). */
export interface Table extends EntBase {
  type: 'table'; p: Point; rot: number; cols: number[]; rows: number[]; cells: string[][];
  tstyle: string; th?: number; style?: string; title: boolean; header: boolean;
}
export interface AttDef extends EntBase {
  type: 'attdef'; p: Point; tag: string; prompt: string; def: string; text?: string; h: number; rot: number;
  align?: TextAlign; style?: string; invisible?: boolean;
}
export type DimKind = 'lin' | 'ali' | 'rad' | 'dia' | 'ang' | 'ord' | 'arc' | 'jog';
/** Cota: el significado de p1, p2, p3 y c depende de kind; rot (lineal) en radianes; ov = DIMOVERRIDE. */
export interface Dim extends EntBase {
  type: 'dim'; kind: DimKind; p1?: Point; p2?: Point; p3?: Point; c?: Point;
  rot?: number; text?: string;
  p4?: Point; p5?: Point;           // radio con recodo: centro desplazado y recodo
  axis?: 'x' | 'y'; org?: Point;   // cota de coordenada: eje medido y origen
  breaks?: { p: Point; len: number }[];   // cortes (DIMBREAK)
  style?: string; ov?: Partial<DimStyle>; partial?: boolean; l1?: Point[]; l2?: Point[];
  assoc?: { p1?: PointRef; p2?: PointRef; c?: PointRef; obj?: number; l1?: number; l2?: number };
  _xf?: boolean;
}
export interface CenterMark extends EntBase {
  type: 'center'; kind: 'mark' | 'line'; assoc: { a: number; b?: number }; size: number; lines?: [Point, Point][]; _xf?: boolean;
}
export interface Wipeout extends EntBase { type: 'wipeout'; pts: Point[] }
/** Imagen: p = esquina inferior izquierda; w, h en unidades de dibujo; pxw, pxh en píxeles de la imagen. */
/** Contorno encontrado por findBoundary (hatch.js): [contorno, ...islas], las entidades que lo forman (ids) y los
 * contornos exactos con arcos (exact, para CONTORNO y REGION). */
export type FoundBoundary = Loop[] & { ids: number[]; exact: RegionLoop[] };
export interface ImageEnt extends EntBase {
  type: 'image'; p: Point; w: number; h: number; rot: number; src: string; name: string; pxw: number; pxh: number;
  clip?: { pts: Point[]; loops?: Loop[]; off?: boolean; invert?: boolean };
}
export interface Gradient { type: string; c1: Color; c2: Color; centered: boolean; stops?: [number, Color][] }
export type HatchIslands = 'normal' | 'outer' | 'ignore';
/** Sombreado: angle en GRADOS (como en AutoCAD y en el DXF); scale, factor del patrón. */
export interface Hatch extends EntBase {
  type: 'hatch'; loops: Loop[]; pattern: string; scale: number; angle: number;
  grad?: Gradient; user?: { sp: number; dbl: boolean }; islands?: HatchIslands;
  assoc?: number[]; seed?: Point; rmIsl?: Point[]; _xf?: boolean;
}
/** Inserción de bloque: attribs = {etiqueta: valor}; clip = recorte XCLIP en coordenadas del bloque. */
export interface Insert extends EntBase {
  type: 'insert'; name: string; p: Point; sx: number; sy: number; rot: number;
  attribs?: Record<string, string>; clip?: { pts: Point[]; invert?: boolean; off?: boolean };
  /** Estado de un bloque dinámico: visibilidad, simetría, distancias y ángulos (radianes) por parámetro, fila de consulta */
  dyn?: { vis?: string; flip?: boolean; len?: Record<string, number>; ang?: Record<string, number>; dist?: number };
}
export interface Pline3d extends EntBase { type: 'pline3d'; pts: Point3[]; closed?: boolean }
/** Cara 3D: 4 vértices (el 4.º repite el 3.º en las triangulares); hide[i] oculta la arista i. */
export interface Face3d extends EntBase { type: 'face3d'; pts: Point3[]; hide?: boolean[] }
export interface MLine extends EntBase {
  type: 'mline'; pts: Point[]; closed: boolean; just: 'top' | 'zero' | 'bottom'; scale: number; mlstyle: string;
  cuts?: { s: number; k: number; a: number; b: number }[];   // huecos del elemento k en el tramo s, entre las distancias a y b
}
export interface Region extends EntBase { type: 'region'; loops: RegionLoop[] }
/** Matriz asociativa (arrays.js): todo en coordenadas locales; M lleva lo local al dibujo. */
export interface ArrayEnt extends EntBase {
  type: 'array'; kind: 'rect' | 'polar' | 'path'; src: Entity[]; base: Point; M: Matrix;
  rows?: number; cols?: number; dx?: number; dy?: number; ra?: number; lv?: number; dz?: number;
  repl?: Record<number, Entity[]>;
  c?: Point; n?: number; fill?: number; rot?: boolean;
  path?: Entity; method?: 'divide' | 'measure'; sp?: number; align?: boolean;
  ver?: number;                     // versión (para la caché de sus entidades)
  _xf?: boolean;
}
/** Ventana gráfica de una presentación: p1, p2 en el papel; cx, cy = centro en el modelo; s = escala papel/modelo. */
export interface Viewport extends EntBase {
  type: 'vport'; p1: Point; p2: Point; cx: number; cy: number; s: number; twist?: number; frozen?: string[]; ltscale?: number;
  ucs?: Ucs;                        // SCP de la ventana (UCSVP)
}

export type Entity =
  | Line | Circle | Arc | Pline | Ellipse | Spline | PointEnt | Text | MText | MLeader | Table | AttDef | Dim
  | CenterMark | Wipeout | ImageEnt | Hatch | Insert | Pline3d | Face3d | MLine | Region | ArrayEnt | Viewport;
export type EntityType = Entity['type'];
/** Cualquier entidad con todos sus campos opcionales; el tipo de cada campo es la unión de los de todos los tipos que lo
 * tienen. Para las copias que se modifican campo a campo sin saber de qué tipo son (ops.js). */
type KeysOfUnion<T> = T extends unknown ? keyof T : never;
type FieldOf<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;
/** Point[] | Point3[] → (Point | Point3)[], para poder añadir elementos */
type MergeArrays<T> = [T] extends [readonly (infer U)[]] ? U[] : T;
export type LooseEntity = { [K in KeysOfUnion<Entity>]?: MergeArrays<FieldOf<Entity, K>> };
/** Entidad de un tipo concreto: EntityOf<'line'> = Line. */
export type EntityOf<T extends EntityType> = Extract<Entity, { type: T }>;
/** Entidad antes de Doc.add (sin id; capa, color, tipo y grosor de línea los pone el documento si faltan). */
export type NewEntity<E extends Entity = Entity> = E extends Entity
  ? Omit<E, 'id' | 'layer' | 'color' | 'ltype' | 'lw'> & Partial<Pick<E, 'layer' | 'color' | 'ltype' | 'lw'>>
  : never;

// ---------- Registro de tipos (TYPES en entities.js) ----------

/** Valor que recibe set según el tipo de la propiedad (ang: radianes). */
export interface PropValues {
  num: number; ang: number; deg: number; int: number; text: string; mtext: { text: string; rich?: boolean };
  bool: boolean; select: string; color: string; table: string; action: undefined;
}
export type PropKind = keyof PropValues;
interface PropBase<E> {
  label: string; ro?: boolean; sec?: undefined;
  get(e: E): unknown;
  options?: string[][] | ((e?: E) => string[][]);  // select: [valor, texto]
}
/** Propiedad de un tipo de valor concreto. */
export type PropOf<E, K extends PropKind> = PropBase<E> & { type: K; set?(e: E, v: PropValues[K]): void };
/** Propiedad de la paleta Propiedades. */
export type PropDef<E extends Entity = Entity> = { [K in PropKind]: PropOf<E, K> }[PropKind];
/** Encabezado de sección en la lista de propiedades. */
export interface PropSection { sec: string; label?: undefined; type?: undefined; get?: undefined; set?: undefined; ro?: undefined; options?: undefined }
export type PropItem<E extends Entity = Entity> = PropDef<E> | PropSection;
/** Contexto que envuelve ShiftCtx (render.js): pasa los argumentos tal cual, con las firmas de número variable. */
export type VarArgsCtx = Omit<CanvasRenderingContext2D, 'setTransform' | 'transform' | 'arc' | 'ellipse' | 'fillText' | 'strokeText' | 'drawImage'> & {
  setTransform(...a: number[]): void; transform(...a: number[]): void; arc(...a: (number | boolean)[]): void;
  ellipse(...a: (number | boolean)[]): void; fillText(t: string, ...a: number[]): void; strokeText(t: string, ...a: number[]): void;
  drawImage(img: CanvasImageSource, ...a: number[]): void;
};
/** Contexto 2D del lienzo; el de la salida PDF (pdf.js) añade drawImageSrc. */
export type Ctx2D = CanvasRenderingContext2D & { drawImageSrc?(src: string, x: number, y: number, w: number, h: number): void };
export type SnapKind = 'end' | 'mid' | 'cen' | 'qua' | 'int' | 'per' | 'nea' | 'nod' | 'ins';
export type SnapPoints = Partial<Record<SnapKind, Point[]>>;

export interface TypeDef<E extends Entity = Entity> {
  name: string;                                   // nombre en la interfaz
  prims(e: E): Prim[];
  selPrims?(e: E): Prim[];
  bbox(e: E): BBox | null;
  hit?(e: E, p: Point): number;
  snaps(e: E): SnapPoints;
  grips(e: E): Point[];
  moveGrip(e: E, i: number, p: Point): void;
  xform(e: E, m: Matrix): void;
  path?(c: Ctx2D, e: E, R?: RenderCtx): void;
  draw?(c: Ctx2D, e: E, R: RenderCtx, st?: DrawStyle): void;
  gripKinds?(e: E): string[];                     // tipo de cada pinzamiento (bloques dinámicos, matrices)
  axes?(e: E): Point[];
  props: PropItem<E>[] | ((e: E) => PropItem<E>[]);
}
export type TypeRegistry = { [T in EntityType]: TypeDef<EntityOf<T>> };

/** Estilo resuelto con el que se dibuja una entidad (App.styleFor). px: grosor en píxeles. */
export interface DrawStyle { color: Color; px: number; pat: number[]; ltscale?: number; paper?: boolean; hl?: boolean }

/** Pinzamiento de un bloque dinámico o de una matriz asociativa. */
export interface Grip { p: Point; kind: string; i?: number }

/** ENV de entities.js: documento activo, presentación que se dibuja y ganchos que registran otros módulos
 * (para no importarlos desde entities.js y evitar dependencias circulares). */
export interface Env {
  doc: Document | null;
  layout: Layout | null;
  onScreen?: boolean;                                  // se dibuja en pantalla (no al imprimir)
  onImageLoad?(): void;
  applyDyn?(b: Block, e: Insert, ents: Entity[]): Entity[];     // dynblock.js
  dynGrips?(e: Insert): Grip[];
  dynMoveGrip?(e: Insert, i: number, p: Point): void;
  dynProps?(e: Insert): PropItem<Insert>[];
  arrayEnts?(e: ArrayEnt): Entity[];                   // arrays.js
  arrayGrips?(e: ArrayEnt): Grip[];
  arrayMoveGrip?(e: ArrayEnt, i: number, p: Point): void;
  arrayProps?(e: ArrayEnt): PropItem<ArrayEnt>[];
  assocLoops?(h: Hatch, srcs: Entity[]): { loops: Loop[]; ids: number[]; seed?: Point } | null; // hatch.js
}

/** Vista con la que se dibuja (render.js, makeRV): centro (cx, cy) en el dibujo, tamaño (w, h) y esquina (ox, oy) en
 * píxeles CSS, giro en radianes. */
export interface RenderCtx {
  dpr: number;          // píxeles físicos por píxel CSS
  scale: number;        // píxeles por unidad de dibujo
  cx: number; cy: number; w: number; h: number; ox: number; oy: number; rot: number;
  clip?: BBox;          // zona del dibujo de una tesela: las polilíneas largas sólo dibujan lo que cae en ella
  toScreen(p: Point): Point;
}

// ---------- Estilos ----------

export type ArrowKind = 'closed' | 'open' | 'tick' | 'dot' | 'none';
export interface Layer {
  name: string; color: Color; ltype: string; lw: number | 'DEFAULT'; on: boolean; lock: boolean; plotStyle?: string;
  pstyle?: string;              // estilo de trazado con nombre (tablas STB)
  xref?: string;                // capa de la referencia externa con ese nombre (xref.js)
}
export interface TextStyle { name: string; font: string; width: number; oblique: number; annotative?: boolean }
/** Los estilos de cota y de directriz y los bloques también pueden ser anotativos. */
export interface DimStyle {
  name: string; txt: number; asz: number; exo: number; exe: number; gap: number; dec: number; adec: number; dli: number;
  scale: number; arrow: ArrowKind; textStyle: string; suffix: string; annotative?: boolean; [k: string]: unknown;
}
export interface MLeaderStyle { name: string; h: number; asz: number; arrow: ArrowKind; land: number; gap: number; textStyle: string; content: 'mtext' | 'block' | 'none'; annotative?: boolean }
export interface TableStyle { name: string; th: number; textStyle: string; margin: number; titleScale: number; align: string }
/** Estilo de multilínea (mline.js): off, desfase de cada elemento; caps, remates de inicio (s) y fin (e). */
export interface MLineStyle {
  name: string; desc: string; elems: { off: number; color: Color; ltype: string }[];
  caps: { sLine: boolean; eLine: boolean; sOuter: boolean; eOuter: boolean; sInner: boolean; eInner: boolean };
  joints: boolean; fill: Color | null;
}

// ---------- Documento (document.js) ----------

/** Parámetros de un bloque dinámico (dynblock.js); en el editor de bloques se refieren a identificadores, en el bloque a índices. */
export interface DynLinear { name: string; p1: Point; p2: Point; rect: BBox; ents: number[]; min?: number; max?: number }
export interface DynRotation { name: string; c: Point; p: Point; ents: number[] }
export interface DynDef {
  vis?: { states: string[]; hide?: Record<string, number[]>; pos?: Point };
  flip?: { a: Point; b: Point };
  lins?: DynLinear[]; lin?: DynLinear;   // lin: un único parámetro lineal (formato de la v0.5)
  rots?: DynRotation[];
  /** Tabla de consulta: columnas 'lin:Nombre' | 'rot:Nombre' | 'vis' | 'flip'; distancias en unidades del bloque, ángulos en grados */
  look?: { name?: string; pos?: Point; cols: string[]; rows: { label: string; vals: unknown[] }[] };
}
export interface Block {
  name: string; base: Point; ents: Entity[]; ver: number; dyn?: DynDef;
  xref?: { file: string; loaded: string | null; path?: string };   // referencia externa (xref.js)
  annotative?: boolean;
  xrefDep?: string;
  lib?: boolean;                // bloque de la biblioteca (library.js)
  desc?: string;
}
export interface Layout { name: string; paper: string; w: number; h: number; ents: Entity[]; plotStyle?: string; showPlot?: boolean }
/** SCP: o = origen, ang = giro de los ejes en radianes. */
export interface Ucs { o: Point; ang: number; name?: string; world?: boolean }
export interface BlockEditor { name: string; base: Point; ents: Entity[]; prev: Space; dyn?: DynDef | null; visCur?: string | null }
/** Espacio activo: modelo, editor de bloques o índice de la presentación en Doc.layouts. */
export type Space = 'model' | 'bedit' | number;
export interface CurrentProps {
  layer: string; color: Color; ltype: string; lw: LineWeight; textStyle: string; dimStyle: string;
  mleaderStyle: string; tableStyle: string; mlineStyle: string; pstyle?: string;
}
/** Parámetros del dibujo (doc.settings): los de DEFAULT_SETTINGS y los que guardan las órdenes. Ángulos de los parámetros
 * en grados (polarInc, hatchAng, chamferA es una distancia). Los números 0/1 son variables de AutoCAD (PSLTSCALE, UCSVP…). */
export interface Settings {
  gridX: number; snapX: number; polarInc: number; ltscale: number; coordDec: number; textH: number;
  filletR: number; chamferA: number; chamferB: number; offsetD: number; lastRadius: number; polySides: number;
  hatchPat: string; hatchScale: number; hatchAng: number; hatchAssoc: boolean; hatchIslands: HatchIslands;
  iso: boolean; isoPlane: 'top' | 'left' | 'right'; splineMethod: 'fit' | 'cv';
  dimAssoc: boolean; mleaderContent: MLeader['content']; balloonNum: number; insBase: Point;
  mlScale: number; mlJust: MLine['just']; arrayAssoc: boolean; xclipFrame: number; wipeoutFrame: number;
  boundaryType: 'pline' | 'region'; boundaryIslands: boolean; revcloud: number;
  unitsPerInch: number; psltscale: number; ucsIcon: boolean; ucsIconOrigin: boolean;
  ucsvp: number; ucsfollow: number; vprotateassoc: number; cannoscale: string; annoAllVisible: number; annoAutoScale: number;
  // Guardados por las órdenes
  elevation?: number; author?: string; modelPlotStyle?: string;
  autoCons?: { tol: number; off?: string[]; [k: string]: unknown }; gradient?: Partial<Gradient>; hatchUser?: { sp: number; dbl: boolean }; hatchAnno?: boolean;
  divideN?: number; measureD?: number; lenMode?: 'delta' | 'percent' | 'total' | 'dynamic'; lenVal?: number;
  layIsoMode?: string; libUnits?: string; lsOffMissing?: boolean; lsProps?: string[];
  overkill?: Record<string, unknown>; qdimMode?: string; showCons?: boolean; tableCols?: number; tableRows?: number;
}
export type DocEvent = 'reset' | 'change' | 'commit' | 'origin' | 'constraint-fail';

/** Clase Doc de document.js (interfaz pública que usan los demás módulos). */
export interface Document {
  name: string; dirty: boolean; ver: number;
  layers: Layer[]; model: Entity[]; layouts: Layout[]; blocks: Record<string, Block>;
  bedit: BlockEditor | null; space: Space; activeVp: number | null;
  textStyles: TextStyle[]; dimStyles: DimStyle[]; mleaderStyles: MLeaderStyle[]; tableStyles: TableStyle[]; mlineStyles: MLineStyle[];
  ucs: Ucs | null; ucsList: Ucs[]; origin: Point;
  patterns: Record<string, { desc?: string; fam: number[][] }>;   // fam: [ángulo°, x, y, dx, dy, trazos…]   // patrones de sombreado propios (patterns.js)
  plotStyles: Record<string, PlotTable>;
  scales: ScaleDef[];                // lista de escalas (SCALELISTEDIT)
  cur: CurrentProps; settings: Settings;
  byId: Map<number, Entity>; nextId: number;
  readonly ents: Entity[];                  // las del espacio activo
  allEnts(): Generator<Entity>;
  layout(): Layout | null;
  on(fn: (kind: DocEvent, data?: unknown) => void): void;
  emit(kind: DocEvent, data?: unknown): void;
  /** Transacción: begin(); add/remove/modify…; commit() = un paso de deshacer. Se pueden anidar. */
  begin(full?: boolean): void;
  commit(): void;
  /** Avisa antes de cambiar a mano una entidad del modelo (modify lo hace solo). */
  before(e: Entity): void;
  undo(): boolean | void;
  redo(): boolean | void;
  /** Devuelve la misma entidad, ya con id: add({type: 'line', …}) es un Line. */
  add<N extends NewEntity>(e: N, target?: Entity[]): EntityOf<N['type']>;
  get(id: number): Entity | undefined;
  remove(id: number): void;
  removeMany(ids: Iterable<number>): void;
  modify<E = LooseEntity>(id: number, fn: (e: E) => void): E | undefined;
  layer(name: string): Layer;
  addLayer(name: string, color?: Color): Layer;
  ensureLayer(name: string, color?: Color): Layer;
  visible(e: Entity): boolean;
  locked(e: Entity): boolean;
  textStyle(name?: string): TextStyle;
  dimStyle(name?: string): DimStyle;
  mleaderStyle(name?: string): MLeaderStyle;
  tableStyle(name?: string): TableStyle;
  mlineStyle(name?: string): MLineStyle;
  style(e: Entity): { color: Color; lw: number; pat: number[] | null };
  extents(ents?: Entity[]): BBox | null;
  defineBlock(name: string, base: Point, ents: Entity[], extra?: Partial<Block>): void;
  addLayout(name: string, paper?: string): Layout;
  changed(): void;
  toJSON(): object;
  fromJSON(o: object): void;
}

// ---------- Vista (view.js) ----------

/** cx, cy: punto del dibujo en el centro de la vista; scale: píxeles por unidad; rot: giro de la vista en radianes;
 * w, h, ox, oy: tamaño y esquina de la vista en la zona de dibujo, en píxeles. */
export interface View {
  cx: number; cy: number; scale: number; rot: number; w: number; h: number; ox: number; oy: number;
  toScreen(p: Point): Point;
  toWorld(s: Point): Point;
  rect(): BBox;
  fit(b: BBox | null, margin?: number): void;
  fitPts(pts: Point[], margin?: number): void;
}

// ---------- Órdenes (commands.js y makeCtx de app.js) ----------

/** Opciones de las peticiones de datos (getPoint, getDistance…). */
export interface AskOpts {
  base?: Point;                 // punto base: línea elástica y coordenadas relativas
  options?: string[];           // palabras clave aceptadas (la mayúscula marca la abreviatura)
  def?: string | number;        // valor por defecto con Intro
  allowEnter?: boolean;         // Intro devuelve null
  allowNumber?: boolean;
  rubber?: boolean; noSnap?: boolean; noPickfirst?: boolean; gripCmd?: boolean;
  preview?: (p: Point) => unknown;
  min?: number; max?: number; int?: boolean;
  [k: string]: unknown;
}
/** Contexto que recibe cada orden (app.makeCtx). Cancelar (Esc) rechaza la promesa pendiente. */
/** Opciones con palabras clave: la petición puede devolver una de ellas (la que escribió o pulsó el usuario). */
type WithKw<K extends string> = AskOpts & { options: readonly K[] };
type NoKw = AskOpts & { options?: undefined };
export interface CommandCtx {
  app: import('./app.js').App;
  doc: import('./document.js').Doc;
  readonly settings: Settings;
  // Con allowEnter, Intro devuelve null. Con options, una palabra clave.
  getPoint(prompt: string, o?: NoKw): Promise<Point | null>;
  getPoint<K extends string>(prompt: string, o: WithKw<K>): Promise<Point | K | null>;
  getDistance(prompt: string, o?: NoKw): Promise<number | null>;
  getDistance<K extends string>(prompt: string, o: WithKw<K>): Promise<number | K | null>;
  getAngle(prompt: string, o?: NoKw): Promise<number | null>;   // radianes
  getAngle<K extends string>(prompt: string, o: WithKw<K>): Promise<number | K | null>;
  getNumber(prompt: string, o?: NoKw): Promise<number | null>;
  getNumber<K extends string>(prompt: string, o: WithKw<K>): Promise<number | K | null>;
  getString(prompt: string, o?: AskOpts): Promise<string | null>;
  getKeyword<K extends string>(prompt: string, options: readonly K[], def?: K): Promise<K | null>;
  // Con un filtro que es un predicado de tipo (p. ej. e => e.type === 'circle'), la entidad designada es de ese tipo
  getEntity<E extends Entity>(prompt: string, o: NoKw & { filter: (e: Entity) => e is E }): Promise<Picked<E> | null>;
  getEntity(prompt: string, o?: NoKw & { filter?: (e: Entity) => boolean }): Promise<Picked | null>;
  getEntity<E extends Entity, K extends string>(prompt: string, o: WithKw<K> & { filter: (e: Entity) => e is E }): Promise<Picked<E> | K | null>;
  getEntity<K extends string>(prompt: string, o: WithKw<K> & { filter?: (e: Entity) => boolean }): Promise<Picked | K | null>;
  getSelection(prompt?: string, o?: AskOpts): Promise<number[]>;     // identificadores
  print(msg: string): void;
  add<N extends NewEntity>(e: N): EntityOf<N['type']>;
  ref(): PointRef | null;
  setLast(p: Point): void;
}
/** Objeto designado: la entidad, el punto donde se designó y si se pulsó Mayús. */
export interface Picked<E extends Entity = Entity> { e: E; pt: Point; shift: boolean }
export interface CommandOpts {
  group?: string;               // grupo de la ayuda
  sel?: boolean;                // usa la selección previa (pickfirst)
  keepSel?: boolean;            // no vacía la selección al empezar
  hidden?: boolean;             // no se anuncia ni se repite con Intro
  user?: boolean;               // definida por el usuario con la API (tc.defineCommand)
  noTx?: boolean;               // no abre transacción de deshacer
  fullUndo?: boolean;           // la transacción guarda el estado completo (AUDIT)
}
/** Entrada de CMDS: def(name, aliases, desc, fn, opts). */
export interface CommandDef extends CommandOpts {
  name: string; aliases: string[]; desc: string;
  fn(c: CommandCtx, arg?: unknown): unknown;   // lo que devuelve no se usa
}

/** Archivo .tcad (Doc.toJSON / fromJSON). Los de versiones antiguas pueden no tener algunos campos. */
export interface TcadFile {
  app?: string; version?: number; name?: string;
  layers?: Layer[]; model?: Entity[]; ents?: Entity[]; layouts?: Layout[]; blocks?: Record<string, Block>;
  textStyles?: TextStyle[]; dimStyles?: DimStyle[]; mleaderStyles?: MLeaderStyle[]; tableStyles?: TableStyle[]; mlineStyles?: MLineStyle[];
  constraints?: Constraint[]; params?: { name: string; expr: string }[]; groups?: Group[]; layerStates?: LayerState[];
  patterns?: Document['patterns']; plotStyles?: Record<string, PlotTable>;
  cur?: Partial<CurrentProps>;
  /** v1: el estilo de cota estaba en los parámetros (dimTxt, dimAsz…) */
  settings?: Partial<Settings> & { dimTxt?: number; dimAsz?: number; dimExo?: number; dimExe?: number; dimGap?: number; dimDec?: number };
  nextId?: number; ucs?: Ucs | null; ucsList?: Ucs[]; views?: NamedView[]; vportConfigs?: VportConfig[]; selFilters?: SelFilter[];
  layerFilters?: LayerFilter[]; layIso?: LayIsoState | null; scales?: ScaleDef[]; origin?: Point; tiles?: TilesState | null;
}

/** Condición de QSELECT o de un filtro de selección (select.js): type '*' o un tipo de objeto; prop, nombre de una
 * propiedad general o de la paleta Propiedades; op, clave de OPS ('=', '<>', '>', '<', '>=', '<=', '*', 'all'). */
export interface SelCond { type?: string; prop?: string; op: string; value?: unknown; not?: boolean; exclude?: boolean }
/** Filtro de selección con nombre (FILTER). */
export interface SelFilter { name: string; join: 'and' | 'or'; conds: SelCond[] }

/** Referencia de una restricción (constraints.js): punto {id, k, i?} (k: p1, p2, c, p, s/e extremos de arco, v vértice i),
 * línea {id, seg?} (línea o tramo seg de una polilínea) o círculo {id}. */
export interface ConsRef { id: number; k?: 'p1' | 'p2' | 'c' | 's' | 'e' | 'p' | 'v' | 'mid'; i?: number; seg?: number }
/** Restricción paramétrica: geométrica o de cota (con nombre, expresión y colocación del texto). */
export interface Constraint { id: number; type: string; refs: ConsRef[]; name?: string; expr?: string; off?: number; ang?: number; sgn?: number; orient?: string; [k: string]: unknown }
/** Grupo (groups.js): los anónimos se llaman *A1, *A2…; sel: se designa entero. */
export interface Group { name: string; desc: string; ids: number[]; sel: boolean }
/** Estado de capa (layerstates.js): configuración de las capas guardada con nombre. */
export interface LayerState { name: string; desc: string; cur?: string; layers?: Record<string, Partial<Pick<Layer, 'on' | 'lock' | 'color' | 'ltype' | 'lw'>>>; saved?: string; [k: string]: unknown }
/** Vista con nombre (views.js): centro y tamaño en los ejes de la vista; twist, giro (sólo en el modelo). */
export interface NamedView { name: string; space: string; cx: number; cy: number; w: number; h: number; twist?: number; ucs?: Ucs; layers?: Record<string, { on: boolean; lock: boolean }> }
/** Ventana en mosaico del modelo que se guarda con el dibujo: r en fracciones de la zona de dibujo; vh, altura visible. */
export interface TileState { r: BBox; cx: number; cy: number; vh: number; rot?: number; ucs?: Ucs | null }
export interface TilesState { active: number; tiles: TileState[] }
/** Permisos de los manejadores de archivo (File System Access API, sólo en algunos navegadores). */
declare global {
  interface FileSystemHandle {
    queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
}
/** Selectores de archivos del File System Access API (sólo en algunos navegadores; io.js comprueba que existan). */
declare global {
  interface FilePickerType { description?: string; accept: Record<string, string[]> }
  interface Window {
    showOpenFilePicker(o?: { types?: FilePickerType[]; multiple?: boolean }): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker(o?: { suggestedName?: string; types?: FilePickerType[] }): Promise<FileSystemFileHandle>;
    /** Archivos abiertos con la PWA (File Handling API) */
    launchQueue?: { setConsumer(f: (p: { files: FileSystemFileHandle[] }) => unknown): void };
    app: import('./app.js').App;          // la aplicación (app.js)
    tc: unknown;                           // API en JavaScript para el usuario (scripting.js)
    TC_VERIFY_UNDO?: boolean;              // comprobación del deshacer en las pruebas (tools/run.mjs)
  }
}
/** Configuración de ventanas en mosaico con nombre (VPORTS › Guardar). */
export interface VportConfig { name: string; tiles: TileState[]; active?: number }
/** Filtro de capas (layertools.js): por propiedades (reglas) o por grupo (lista de capas). */
export type LayerFilter = { name: string; kind: 'prop'; rules?: { name?: string; color?: string; on?: string | boolean; lock?: string | boolean; ltype?: string; lw?: string | number; used?: string | boolean }; layers?: undefined }
  | { name: string; kind: 'group'; layers: string[]; rules?: undefined };
/** Estilo de trazado (plotstyles.js): null = el del objeto. */
export interface PlotStyle { color: Color | null; gray?: boolean; lw: number | null; screen: number; ltype: string | null }
/** Tabla de estilos de trazado: dependiente del color (ctb, claves ACI) o con nombre (stb). */
export interface PlotTable { name: string; type: 'ctb' | 'stb'; desc: string; styles: Record<string, PlotStyle> }
/** Escala de la lista del dibujo: unidades del papel : unidades del dibujo. */
export interface ScaleDef { name: string; paper: number; draw: number }
/** Estado de las capas antes de LAYISO (para LAYUNISO). */
export interface LayIsoState { mode: string; cur: string; layers: Record<string, { on: boolean; lock: boolean }> }
