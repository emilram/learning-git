/**
 * @empresa/city-sketch — contrato de tipos del core.
 *
 * Reglas de este archivo:
 *  - Solo tipos. Cero lógica, cero imports en tiempo de ejecución.
 *  - Todo objeto del modelo lleva `id` estable derivado de la semilla (ver rng/ids.ts).
 *  - Las coordenadas del modelo son "unidades de mundo" = píxeles del viewBox base.
 */

// ---------------------------------------------------------------------------
// Primitivas geométricas
// ---------------------------------------------------------------------------

/** Punto 2D en unidades de mundo. Se usa tupla para transferencia estructurada barata. */
export type Vec2 = readonly [x: number, y: number];

/** Polilínea abierta (>= 2 puntos). */
export type Polyline = readonly Vec2[];

/** Polígono simple cerrado implícito (>= 3 puntos, sin repetir el primero). Orientación CCW en coordenadas SVG (y hacia abajo). */
export type Polygon = readonly Vec2[];

export interface Bounds {
  readonly w: number;
  readonly h: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// ---------------------------------------------------------------------------
// Ids con marca de tipo (branded) — evitan mezclar ids de distintas entidades
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type NodeId = Brand<string, 'NodeId'>;
export type StreetId = Brand<string, 'StreetId'>;
export type BlockId = Brand<string, 'BlockId'>;
export type LotId = Brand<string, 'LotId'>;
export type PoiId = Brand<string, 'PoiId'>;
export type LabelId = Brand<string, 'LabelId'>;
export type DistrictId = Brand<string, 'DistrictId'>;

// ---------------------------------------------------------------------------
// Entidades del modelo
// ---------------------------------------------------------------------------

export type StreetClass = 'avenue' | 'street' | 'alley';

export type LandUse = 'retail' | 'residential' | 'park' | 'water' | 'plaza';

export type PoiKind =
  | 'store'
  | 'flagship'
  | 'kiosk'
  | 'warehouse'
  | 'competitor'
  | 'landmark'
  | 'custom';

/** Overrides visuales opcionales que cualquier entidad acepta desde la config. */
export interface ElementStyle {
  /** Atributo `style` inline serializado tal cual. */
  readonly style?: string;
  /** Clases CSS extra (separadas por espacio). */
  readonly className?: string;
  /** Atributos `data-*` extra: clave sin prefijo. */
  readonly data?: Readonly<Record<string, string>>;
}

export interface CityNode {
  readonly id: NodeId;
  readonly x: number;
  readonly y: number;
  /** Número de calles incidentes tras la limpieza topológica. */
  readonly degree: number;
  /** Ids de calles incidentes, ordenados por ángulo CCW. */
  readonly streetIds: readonly StreetId[];
  /** true si el nodo está en el borde del lienzo (calle que sale del mapa). */
  readonly boundary: boolean;
}

export interface Street {
  readonly id: StreetId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly class: StreetClass;
  /** Ancho total en unidades de mundo (se usa para inset de manzanas y stroke). */
  readonly width: number;
  /** Geometría; polyline[0] coincide con `from`, el último con `to`. */
  readonly polyline: Polyline;
  /** Longitud precalculada (suma de segmentos). */
  readonly length: number;
  /** Nombre procedural; ausente si `naming.enabled=false` o la calle es demasiado corta. */
  readonly name?: string;
  /** Distrito al que pertenece el punto medio. */
  readonly districtId?: DistrictId;
  /** Direcciones one-way sintéticas para iconografía (opcional). */
  readonly oneWay?: boolean;
  readonly overrides?: ElementStyle;
}

export interface Block {
  readonly id: BlockId;
  /** Polígono ya "insetado" por el ancho de las calles circundantes. */
  readonly polygon: Polygon;
  /** Polígono original del ciclo (sin inset); útil para hit-test y heatmap. */
  readonly outline: Polygon;
  readonly streetIds: readonly StreetId[];
  readonly landUse: LandUse;
  readonly districtId: DistrictId;
  readonly area: number;
  readonly centroid: Vec2;
  /** Densidad normalizada 0–1 (distancia al centro + ruido); alimenta POIs `auto`. */
  readonly density: number;
  readonly overrides?: ElementStyle;
}

export interface Lot {
  readonly id: LotId;
  readonly blockId: BlockId;
  readonly polygon: Polygon;
  /** Calle a la que da frente el lote. Siempre definido: los lotes sin frente se fusionan o descartan. */
  readonly frontage: StreetId;
  /** Punto medio del lado que da a la calle (ancla por defecto para un POI). */
  readonly frontPoint: Vec2;
  readonly area: number;
  readonly overrides?: ElementStyle;
}

/** Posición de un POI: anclada a lote o normalizada 0–1 respecto al viewBox. */
export type PoiAnchor =
  | { readonly kind: 'lot'; readonly lotId: LotId }
  | { readonly kind: 'normalized'; readonly nx: number; readonly ny: number };

export interface Poi {
  readonly id: PoiId;
  readonly anchor: PoiAnchor;
  /** Posición resuelta en unidades de mundo (derivada de `anchor`). */
  readonly x: number;
  readonly y: number;
  readonly kind: PoiKind;
  readonly label: string;
  readonly tags: readonly string[];
  /** Clave externa para enlazar con datos del dashboard (`useStoreBinding`). */
  readonly externalId?: string;
  /** Calle más cercana (para dirección sintética y orientación del marcador). */
  readonly streetId?: StreetId;
  readonly overrides?: ElementStyle;
}

export type LabelKind = 'street' | 'district' | 'poi' | 'water' | 'park';

export interface Label {
  readonly id: LabelId;
  readonly kind: LabelKind;
  readonly text: string;
  /** Referencia a la entidad etiquetada. */
  readonly targetId: StreetId | DistrictId | PoiId | BlockId;
  /** Path para `<textPath>`; para etiquetas puntuales es un segmento horizontal. */
  readonly path: Polyline;
  /** Desplazamiento inicial a lo largo del path, en % (atributo startOffset). */
  readonly startOffset: number;
  /** Tamaño de fuente en unidades de mundo. */
  readonly fontSize: number;
  /** Prioridad de colisión: mayor gana. */
  readonly priority: number;
  /** Caja aproximada usada por el resolver de colisiones (ya resuelta). */
  readonly bbox: Rect;
}

export interface District {
  readonly id: DistrictId;
  readonly name: string;
  readonly center: Vec2;
  /** Celda de Voronoi del distrito recortada al lienzo. */
  readonly polygon: Polygon;
  /** Modo de generación asignado (solo relevante en `hybrid`). */
  readonly mode: GenerationMode;
  readonly dominantLandUse: LandUse;
}

export interface ModelMeta {
  readonly generator: '@empresa/city-sketch';
  readonly version: string;
  /** Config efectiva tras aplicar defaults (no la parcial del usuario). */
  readonly params: GenerationParams;
  /** Tiempos por etapa en ms (solo informativo; no afecta al determinismo del SVG). */
  readonly timings?: Readonly<Record<PipelineStage, number>>;
  /** Hash cyrb53 de la config efectiva; clave de caché. */
  readonly configHash: string;
}

export interface CityModel {
  readonly seed: string;
  readonly bounds: Bounds;
  readonly nodes: readonly CityNode[];
  readonly streets: readonly Street[];
  readonly blocks: readonly Block[];
  readonly lots: readonly Lot[];
  readonly pois: readonly Poi[];
  readonly labels: readonly Label[];
  readonly districts: readonly District[];
  readonly meta: ModelMeta;
}

// ---------------------------------------------------------------------------
// Parámetros de generación
// ---------------------------------------------------------------------------

export type GenerationMode =
  | 'tensor'
  | 'grid-jitter'
  | 'organic-voronoi'
  | 'radial'
  | 'lsystem'
  | 'hybrid';

export type Symmetry = 'none' | 'mirror-x' | 'mirror-y' | 'quad';

export type Locale = 'es' | 'en';

export interface StreetHierarchy {
  /** Anchos por clase en unidades de mundo. */
  readonly avenue: number;
  readonly street: number;
  readonly alley: number;
  /** Proporción 0–1 de calles menores degradadas a callejón. */
  readonly alleyRatio: number;
}

export interface TensorParams {
  /** Separación objetivo entre avenidas (dsep mayor) en unidades de mundo. */
  readonly spacingMajor: number;
  /** Separación objetivo entre calles (dsep menor). */
  readonly spacingMinor: number;
  /** Ángulo dominante del campo grid en grados. */
  readonly dominantAngle: number;
  /** Número de centros radiales sembrados. */
  readonly radialCenters: number;
  /** Intensidad del ruido rotacional 0–1 (mapea a grados máximos de rotación). */
  readonly noiseIntensity: number;
  /** Escala espacial del ruido (unidades de mundo por "célula"). */
  readonly noiseScale: number;
  /** Peso del campo boundary (alineación al borde/agua). */
  readonly boundaryWeight: number;
  /** Peso del campo grid vs radial (0 = solo radial, 1 = solo grid). */
  readonly gridWeight: number;
  /** Paso de integración RK4. */
  readonly stepSize: number;
  /** Máximo de pasos por streamline. */
  readonly maxSteps: number;
}

export interface CleanupParams {
  /** Radio para fusionar nodos cercanos. */
  readonly snapTolerance: number;
  /** Calles más cortas se eliminan (salvo que dejen huérfanos). */
  readonly minStreetLength: number;
  /** Calles que salen del mismo nodo con ángulo menor (grados) se fusionan. */
  readonly parallelAngle: number;
  /** Radio de fusión de intersecciones. */
  readonly mergeRadius: number;
  /** Si false, se podan todos los callejones sin salida (filamentos). */
  readonly deadEnds: boolean;
}

export type LotMethod = 'obb' | 'skeleton';

export interface LotParams {
  readonly method: LotMethod;
  readonly minArea: number;
  readonly maxArea: number;
  /** Jitter 0–1 del punto de corte respecto al centro de la OBB. */
  readonly splitJitter: number;
  /** Profundidad de la franja frontal en `skeleton` (unidades de mundo). */
  readonly frontageDepth: number;
  /** Probabilidad 0–1 de dejar una manzana sin subdividir. */
  readonly skipChance: number;
}

export interface LandUseParams {
  /** Proporción de área objetivo 0–1. */
  readonly parkRatio: number;
  readonly waterRatio: number;
  readonly plazaRatio: number;
  /** Radio (0–1 del lienzo) dentro del cual domina `retail`. */
  readonly retailRadius: number;
  /** Peso de ruido 0–1 al decidir uso de suelo. */
  readonly noise: number;
}

export interface PoiSpec {
  /** Id estable proporcionado por el usuario; si falta se deriva del label. */
  readonly id?: string;
  readonly label: string;
  readonly kind?: PoiKind;
  readonly tags?: readonly string[];
  readonly externalId?: string;
  /** Uno de los dos; si ambos faltan se coloca en modo auto. */
  readonly lotId?: string;
  readonly nx?: number;
  readonly ny?: number;
  readonly overrides?: ElementStyle;
}

export interface PoiParams {
  readonly mode: 'auto' | 'manual';
  /** Número de POIs en modo auto. */
  readonly count: number;
  /** Sesgo 0–1 hacia manzanas `retail` (1 = solo retail). */
  readonly retailBias: number;
  /** Distancia mínima entre POIs (unidades de mundo). */
  readonly minSpacing: number;
  /** Lista de tiendas para modo manual (también se respetan en auto como fijos). */
  readonly items: readonly PoiSpec[];
}

export interface NamingParams {
  readonly enabled: boolean;
  readonly locale: Locale;
  /** Listas personalizadas: se mezclan con las del idioma. */
  readonly lists?: Partial<StreetNameLists>;
  /** 0–1: fracción de calles que reciben etiqueta visible. */
  readonly labelDensity: number;
  /** Longitud mínima de calle para etiquetarla. */
  readonly minLabelLength: number;
  readonly fontSize: number;
}

export interface StreetNameLists {
  readonly prefixes: readonly string[];
  readonly avenues: readonly string[];
  readonly streets: readonly string[];
  readonly alleys: readonly string[];
  readonly districts: readonly string[];
}

export interface ElementOverrides {
  readonly streets?: Readonly<Record<string, ElementStyle>>;
  readonly blocks?: Readonly<Record<string, ElementStyle>>;
  readonly pois?: Readonly<Record<string, ElementStyle>>;
}

export interface GenerationParams {
  readonly seed: string;
  readonly size: Bounds;
  readonly mode: GenerationMode;
  /** 0–1: multiplica el número de calles (inverso al espaciado). */
  readonly density: number;
  /** 0–1: rectas ↔ curvas (peso radial + ruido + suavizado). */
  readonly curvature: number;
  /** 0–1: "orden vs caos". Jitter, ruido, tolerancias de snap. */
  readonly chaos: number;
  readonly hierarchy: StreetHierarchy;
  readonly blockSize: { readonly min: number; readonly max: number };
  readonly districts: number;
  readonly symmetry: Symmetry;
  readonly tensor: TensorParams;
  readonly cleanup: CleanupParams;
  readonly lots: LotParams;
  readonly landUse: LandUseParams;
  readonly pois: PoiParams;
  readonly naming: NamingParams;
  readonly overrides: ElementOverrides;
}

/** Entrada del usuario: todo opcional salvo la semilla. */
export type GenerationInput = { readonly seed: string } & DeepPartial<Omit<GenerationParams, 'seed'>>;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly (infer U)[]
    ? readonly U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export type PipelineStage =
  | 'districts'
  | 'field'
  | 'trace'
  | 'graph'
  | 'cleanup'
  | 'blocks'
  | 'landuse'
  | 'lots'
  | 'pois'
  | 'names'
  | 'labels';

/** Grafo planar intermedio (salida de los modos, entrada de la limpieza). */
export interface RawGraph {
  readonly nodes: readonly { readonly x: number; readonly y: number }[];
  /** Aristas por índice de nodo; `polyline` incluye ambos extremos. */
  readonly edges: readonly {
    readonly a: number;
    readonly b: number;
    readonly class: StreetClass;
    readonly polyline: Polyline;
  }[];
}

/** Contexto compartido por todas las etapas: PRNG por etapa y utilidades. */
export interface PipelineContext {
  readonly params: GenerationParams;
  readonly bounds: Bounds;
  /** PRNG independiente por etapa: cambiar una etapa no altera las anteriores. */
  readonly rng: (stage: PipelineStage | string) => Rng;
  readonly ids: IdFactory;
  readonly districts: readonly District[];
  /** Polígonos de agua ya decididos (afectan campo y manzanas). */
  readonly water: readonly Polygon[];
}

export interface Rng {
  /** Uniforme [0,1). */
  next(): number;
  /** Uniforme [min,max). */
  range(min: number, max: number): number;
  /** Entero uniforme [min,max]. */
  int(min: number, max: number): number;
  /** Gaussiana (Box–Muller) con media y desviación. */
  gauss(mean?: number, sd?: number): number;
  /** Elemento aleatorio de un arreglo. */
  pick<T>(arr: readonly T[]): T;
  /** Barajado Fisher–Yates devolviendo copia. */
  shuffle<T>(arr: readonly T[]): T[];
  /** Bernoulli. */
  chance(p: number): boolean;
  /** Fork determinista: sub-generador etiquetado. */
  fork(label: string): Rng;
}

export interface IdFactory {
  node(x: number, y: number): NodeId;
  street(from: NodeId, to: NodeId, ordinal: number): StreetId;
  block(centroid: Vec2): BlockId;
  lot(blockId: BlockId, ordinal: number): LotId;
  poi(key: string): PoiId;
  label(kind: LabelKind, targetId: string): LabelId;
  district(ordinal: number): DistrictId;
}

/** Firma de todo modo de generación. */
export type ModeGenerator = (ctx: PipelineContext, region?: Polygon) => RawGraph;

// ---------------------------------------------------------------------------
// Tema y estilo boceto
// ---------------------------------------------------------------------------

export type ThemePresetName =
  | 'blueprint'
  | 'hand-sketch'
  | 'minimal-mono'
  | 'retail-warm'
  | 'dark-ops';

/** Color en OKLCH como string CSS (`oklch(L C H / A)`). */
export type Oklch = `oklch(${string})`;

export type FillPattern = 'none' | 'hatch' | 'cross-hatch' | 'dots' | 'grid';

/** Capa 1: primitivos. Nunca se usan directamente en componentes. */
export interface PrimitiveTokens {
  readonly colors: Readonly<Record<string, Oklch>>;
  readonly fontFamilies: Readonly<Record<string, string>>;
  readonly strokeWidths: Readonly<Record<string, number>>;
}

/** Capa 2: semánticos. Referencian primitivos por nombre. */
export interface SemanticTokens {
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly accent: string;
  readonly accentAlt: string;
  readonly danger: string;
  readonly success: string;
  readonly water: string;
  readonly park: string;
  readonly plaza: string;
  readonly retail: string;
  readonly residential: string;
  readonly fontDisplay: string;
  readonly fontBody: string;
}

/** Capa 3: por componente. Referencian semánticos. */
export interface ComponentTokens {
  readonly street: Readonly<Record<StreetClass, { readonly stroke: string; readonly widthScale: number; readonly casing?: string; readonly dash?: string }>>;
  readonly block: Readonly<Record<LandUse, { readonly fill: string; readonly stroke: string; readonly pattern: FillPattern; readonly opacity: number }>>;
  readonly lot: { readonly stroke: string; readonly strokeWidth: number; readonly opacity: number };
  readonly label: { readonly fill: string; readonly halo: string; readonly font: string; readonly letterSpacing: number };
  readonly poi: { readonly fill: string; readonly stroke: string; readonly ring: string; readonly size: number };
  readonly canvas: { readonly background: string; readonly grid?: string };
}

export type SketchTechnique = 'none' | 'rough' | 'filter';

export interface SketchStyle {
  readonly technique: SketchTechnique;
  /** 0–1: roughness/bowing en rough, baseFrequency/scale en filtro. */
  readonly intensity: number;
  /** Solo `rough`: tipo de relleno. */
  readonly fillStyle?: 'hachure' | 'cross-hatch' | 'zigzag' | 'dots' | 'solid';
  /** Solo `rough`: aplicar a manzanas además de calles (más caro). */
  readonly roughBlocks?: boolean;
}

export interface Theme {
  readonly name: string;
  readonly primitives: PrimitiveTokens;
  readonly semantic: SemanticTokens;
  readonly components: ComponentTokens;
  readonly sketch: SketchStyle;
  /** Esquema de color que declara el tema (afecta `color-scheme`). */
  readonly scheme: 'light' | 'dark';
}

// ---------------------------------------------------------------------------
// Serialización SVG
// ---------------------------------------------------------------------------

export type LayerName =
  | 'defs'
  | 'canvas'
  | 'water'
  | 'blocks'
  | 'lots'
  | 'streets-casing'
  | 'streets'
  | 'labels'
  | 'pois'
  | 'overlay';

export interface SvgOptions {
  /** Capas a emitir (por defecto todas). */
  readonly layers?: readonly LayerName[];
  /** Incluir `<style>` con los tokens (para SVG standalone). */
  readonly embedStyles: boolean;
  /** Prefijo para ids (evita colisiones al insertar varios SVG en la misma página). */
  readonly idPrefix: string;
  /** Precisión decimal de coordenadas. */
  readonly precision: number;
  /** Añadir `role="img"` y `<title>`/`<desc>`. */
  readonly accessible: boolean;
  readonly title?: string;
  readonly description?: string;
}

export interface SvgOutput {
  readonly svg: string;
  readonly viewBox: readonly [number, number, number, number];
  /** Conteo por capa; alimenta el switch SVG/Canvas. */
  readonly elementCount: Readonly<Record<LayerName, number>>;
}

// ---------------------------------------------------------------------------
// Plantilla (.json)
// ---------------------------------------------------------------------------

export interface CityTemplate {
  readonly $schema?: string;
  readonly version: 1;
  readonly name: string;
  readonly params: GenerationInput;
  readonly theme: ThemePresetName | DeepPartial<Theme>;
  readonly pois?: readonly PoiSpec[];
}
