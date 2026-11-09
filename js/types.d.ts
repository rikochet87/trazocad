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

/** Tramo de polilínea (plPieces): de a a b, recto o con curvatura. */
export interface Piece { a: Point; b: Point; bulge: number; prim: Prim }

/** Contorno cerrado como lista de vértices (sombreados, regiones, recortes). */
export type Loop = Point[];

// ---------- Propiedades comunes de las entidades ----------

export type Color = string;          // '#rrggbb' | 'BYLAYER' | 'BYBLOCK'
export type LineWeight = number | 'BYLAYER' | 'BYBLOCK' | 'DEFAULT';

/** Referencia de un punto a la geometría (cotas asociativas, assoc.js). */
export type PointRef = { id: number; snap: string; i: number } | { ids: [number, number]; snap: 'int' };

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
}

// ---------- Entidades: unión discriminada por `type` (entities.js) ----------

export interface Line extends EntBase { type: 'line'; p1: Point; p2: Point; z1?: number; z2?: number }
export interface Circle extends EntBase { type: 'circle'; c: Point; r: number }
export interface Arc extends EntBase { type: 'arc'; c: Point; r: number; a1: number; a2: number }
/** Polilínea: bulges[i] es la curvatura del tramo i → i+1 (tan(ángulo/4), negativa = horaria). */
export interface Pline extends EntBase { type: 'pline'; pts: Point[]; bulges?: number[]; closed?: boolean }
/** Elipse: rot = giro del eje mayor (rx). */
export interface Ellipse extends EntBase { type: 'ellipse'; c: Point; rx: number; ry: number; rot: number }
/** Spline: por puntos de ajuste (fit), por vértices de control (cv) o sólo con los de control importados (ctrl). */
export interface Spline extends EntBase {
  type: 'spline'; deg: number; ctrl: Point[]; fit?: Point[]; cv?: Point[]; closed?: boolean; knots?: number[]; w?: number[];
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
  type: 'dim'; kind: DimKind; p1?: Point; p2?: Point; p3?: Point; c?: Point; rot?: number; text?: string;
  style?: string; ov?: Partial<DimStyle>; partial?: boolean; l1?: Point[]; l2?: Point[];
  assoc?: { p1?: PointRef; p2?: PointRef; c?: PointRef; obj?: number; l1?: number; l2?: number };
  _xf?: Matrix;
}
export interface CenterMark extends EntBase {
  type: 'center'; kind: 'mark' | 'line'; assoc: { a: number; b?: number }; size: number; lines?: SegPrim[]; _xf?: Matrix;
}
export interface Wipeout extends EntBase { type: 'wipeout'; pts: Point[] }
/** Imagen: p = esquina inferior izquierda; w, h en unidades de dibujo; pxw, pxh en píxeles de la imagen. */
export interface ImageEnt extends EntBase {
  type: 'image'; p: Point; w: number; h: number; rot: number; src: string; name: string; pxw: number; pxh: number;
  clip?: { pts: Point[]; loops?: Loop[]; off?: boolean };
}
export interface Gradient { type: string; c1: Color; c2: Color; centered: boolean; stops?: [number, Color][] }
export type HatchIslands = 'normal' | 'outer' | 'ignore';
/** Sombreado: angle en GRADOS (como en AutoCAD y en el DXF); scale, factor del patrón. */
export interface Hatch extends EntBase {
  type: 'hatch'; loops: Loop[]; pattern: string; scale: number; angle: number;
  grad?: Gradient; user?: { sp: number; dbl: boolean }; islands?: HatchIslands;
  assoc?: number[]; seed?: Point; rmIsl?: Point[]; _xf?: Matrix;
}
/** Inserción de bloque: attribs = {etiqueta: valor}; clip = recorte XCLIP en coordenadas del bloque. */
export interface Insert extends EntBase {
  type: 'insert'; name: string; p: Point; sx: number; sy: number; rot: number;
  attribs?: Record<string, string>; clip?: { pts: Point[]; invert?: boolean; off?: boolean }; dyn?: Record<string, unknown>;
}
export interface Pline3d extends EntBase { type: 'pline3d'; pts: Point3[]; closed?: boolean }
/** Cara 3D: 4 vértices (el 4.º repite el 3.º en las triangulares); hide[i] oculta la arista i. */
export interface Face3d extends EntBase { type: 'face3d'; pts: Point3[]; hide?: boolean[] }
export interface MLine extends EntBase {
  type: 'mline'; pts: Point[]; closed: boolean; just: 'top' | 'zero' | 'bottom'; scale: number; mlstyle: string; cuts?: unknown[];
}
export interface Region extends EntBase { type: 'region'; loops: Loop[] }
/** Matriz asociativa (arrays.js): todo en coordenadas locales; M lleva lo local al dibujo. */
export interface ArrayEnt extends EntBase {
  type: 'array'; kind: 'rect' | 'polar' | 'path'; src: Entity[]; base: Point; M: Matrix;
  rows?: number; cols?: number; dx?: number; dy?: number; ra?: number; lv?: number; dz?: number;
  repl?: Record<number, Entity[]>;
  c?: Point; n?: number; fill?: number; rot?: boolean;
  path?: Entity; method?: 'divide' | 'measure'; sp?: number; align?: boolean;
  _xf?: Matrix;
}
/** Ventana gráfica de una presentación: p1, p2 en el papel; cx, cy = centro en el modelo; s = escala papel/modelo. */
export interface Viewport extends EntBase {
  type: 'vport'; p1: Point; p2: Point; cx: number; cy: number; s: number; twist?: number; frozen?: string[]; ltscale?: number;
}

export type Entity =
  | Line | Circle | Arc | Pline | Ellipse | Spline | PointEnt | Text | MText | MLeader | Table | AttDef | Dim
  | CenterMark | Wipeout | ImageEnt | Hatch | Insert | Pline3d | Face3d | MLine | Region | ArrayEnt | Viewport;
export type EntityType = Entity['type'];
/** Entidad de un tipo concreto: EntityOf<'line'> = Line. */
export type EntityOf<T extends EntityType> = Extract<Entity, { type: T }>;
/** Entidad antes de Doc.add (sin id; capa, color, tipo y grosor de línea los pone el documento si faltan). */
export type NewEntity<E extends Entity = Entity> = E extends Entity
  ? Omit<E, 'id' | 'layer' | 'color' | 'ltype' | 'lw'> & Partial<Pick<E, 'layer' | 'color' | 'ltype' | 'lw'>>
  : never;

// ---------- Registro de tipos (TYPES en entities.js) ----------

export type PropKind = 'num' | 'ang' | 'deg' | 'int' | 'text' | 'bool' | 'select';
export interface PropDef<E extends Entity = Entity> {
  label: string; type: PropKind; ro?: boolean;
  get(e: E): unknown;
  set?(e: E, v: never): void;
  options?: [string, string][] | (() => [string, string][]);
}
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
  path?(c: CanvasRenderingContext2D, e: E, R: RenderCtx): void;
  draw?(c: CanvasRenderingContext2D, e: E, R: RenderCtx, hl?: boolean): void;
  props: PropDef<E>[] | ((e: E) => PropDef<E>[]);
}
export type TypeRegistry = { [T in EntityType]: TypeDef<EntityOf<T>> };

/** Lo que el dibujo de las entidades necesita del Renderer. */
export interface RenderCtx {
  dpr: number;          // píxeles físicos por píxel CSS
  scale: number;        // píxeles por unidad de dibujo
  toScreen(p: Point): Point;
}

// ---------- Estilos ----------

export type ArrowKind = 'closed' | 'open' | 'tick' | 'dot' | 'none';
export interface Layer {
  name: string; color: Color; ltype: string; lw: number | 'DEFAULT'; on: boolean; lock: boolean; plotStyle?: string;
}
export interface TextStyle { name: string; font: string; width: number; oblique: number }
export interface DimStyle {
  name: string; txt: number; asz: number; exo: number; exe: number; gap: number; dec: number; adec: number; dli: number;
  scale: number; arrow: ArrowKind; textStyle: string; suffix: string; [k: string]: unknown;
}
export interface MLeaderStyle { name: string; h: number; asz: number; arrow: ArrowKind; land: number; gap: number; textStyle: string; content: 'mtext' | 'block' | 'none' }
export interface TableStyle { name: string; th: number; textStyle: string; margin: number; titleScale: number; align: string }
export interface MLineStyle { name: string; [k: string]: unknown }

// ---------- Documento (document.js) ----------

export interface Block { name: string; base: Point; ents: Entity[]; ver: number; dyn?: unknown; xref?: unknown; xrefDep?: string }
export interface Layout { name: string; paper: string; w: number; h: number; ents: Entity[]; plotStyle?: string }
/** SCP: o = origen, ang = giro de los ejes en radianes. */
export interface Ucs { o: Point; ang: number; name?: string }
export interface BlockEditor { name: string; base: Point; ents: Entity[]; prev: Space; dyn?: unknown; visCur?: string | null }
/** Espacio activo: modelo, editor de bloques o índice de la presentación en Doc.layouts. */
export type Space = 'model' | 'bedit' | number;
export interface CurrentProps {
  layer: string; color: Color; ltype: string; lw: LineWeight; textStyle: string; dimStyle: string;
  mleaderStyle: string; tableStyle: string; mlineStyle: string; pstyle?: string;
}
/** DEFAULT_SETTINGS y las que añaden las órdenes; ángulos de los parámetros en grados (polarInc, hatchAng). */
export interface Settings {
  gridX: number; snapX: number; polarInc: number; ltscale: number; coordDec: number; textH: number;
  filletR: number; chamferA: number; chamferB: number; offsetD: number; lastRadius: number; polySides: number;
  hatchPat: string; hatchScale: number; hatchAng: number; hatchAssoc: boolean; hatchIslands: HatchIslands;
  iso: boolean; isoPlane: 'top' | 'left' | 'right'; splineMethod: 'fit' | 'cv';
  dimAssoc: boolean; insBase: Point; unitsPerInch: number; cannoscale: string; elevation?: number;
  [k: string]: unknown;
}
export type DocEvent = 'reset' | 'change' | 'commit' | 'origin';

/** Clase Doc de document.js (interfaz pública que usan los demás módulos). */
export interface Document {
  name: string; dirty: boolean; ver: number;
  layers: Layer[]; model: Entity[]; layouts: Layout[]; blocks: Record<string, Block>;
  bedit: BlockEditor | null; space: Space; activeVp: number | null;
  textStyles: TextStyle[]; dimStyles: DimStyle[]; mleaderStyles: MLeaderStyle[]; tableStyles: TableStyle[]; mlineStyles: MLineStyle[];
  ucs: Ucs | null; ucsList: Ucs[]; origin: Point;
  cur: CurrentProps; settings: Settings;
  byId: Map<number, Entity>; nextId: number;
  readonly ents: Entity[];                  // las del espacio activo
  allEnts(): Generator<Entity>;
  layout(): Layout | null;
  on(fn: (kind: DocEvent, data?: unknown) => void): void;
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
  modify<E extends Entity = Entity>(id: number, fn: (e: E) => void): E | undefined;
  layer(name: string): Layer;
  addLayer(name: string, color?: Color): Layer;
  ensureLayer(name: string, color?: Color): Layer;
  visible(e: Entity): boolean;
  locked(e: Entity): boolean;
  textStyle(name?: string): TextStyle;
  dimStyle(name?: string): DimStyle;
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
  filter?: (e: Entity) => boolean;
  min?: number; max?: number; int?: boolean;
  [k: string]: unknown;
}
/** Contexto que recibe cada orden (app.makeCtx). Cancelar (Esc) rechaza la promesa pendiente. */
export interface CommandCtx {
  app: unknown;                 // la App (app.js); se tipa en la fase 3
  doc: Document;
  readonly settings: Settings;
  getPoint(prompt: string, o?: AskOpts): Promise<Point | string | null>;
  getDistance(prompt: string, o?: AskOpts): Promise<number | string | null>;
  getAngle(prompt: string, o?: AskOpts): Promise<number | string | null>;   // radianes
  getNumber(prompt: string, o?: AskOpts): Promise<number | string | null>;
  getString(prompt: string, o?: AskOpts): Promise<string | null>;
  getKeyword(prompt: string, options: string[], def?: string): Promise<string | null>;
  getEntity(prompt: string, o?: AskOpts): Promise<{ e: Entity; pt: Point; shift: boolean } | string | null>;
  getSelection(prompt?: string, o?: AskOpts): Promise<number[]>;     // identificadores
  print(msg: string): void;
  add<N extends NewEntity>(e: N): EntityOf<N['type']>;
  ref(): PointRef | null;
  setLast(p: Point): void;
}
export interface CommandOpts {
  group?: string;               // grupo de la ayuda
  sel?: boolean;                // usa la selección previa (pickfirst)
  keepSel?: boolean;            // no vacía la selección al empezar
  hidden?: boolean;             // no se anuncia ni se repite con Intro
  noTx?: boolean;               // no abre transacción de deshacer
  fullUndo?: boolean;           // la transacción guarda el estado completo (AUDIT)
}
/** Entrada de CMDS: def(name, aliases, desc, fn, opts). */
export interface CommandDef extends CommandOpts {
  name: string; aliases: string[]; desc: string;
  fn(c: CommandCtx, arg?: unknown): Promise<void> | void;
}
