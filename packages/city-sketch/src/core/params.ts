/**
 * Valores por defecto y especificación de rangos de GenerationParams.
 * PARAM_SPECS es la única fuente de verdad: alimenta el playground (sliders),
 * el JSON Schema de plantillas y la validación en `resolveParams`.
 */
import type { DeepPartial, GenerationInput, GenerationParams } from './types';

export const GENERATOR_VERSION = '0.1.0';

export const DEFAULT_PARAMS: GenerationParams = {
  seed: 'city-001',
  size: { w: 1200, h: 900 },
  mode: 'tensor',
  density: 0.5,
  curvature: 0.3,
  chaos: 0.25,
  hierarchy: { avenue: 14, street: 8, alley: 4, alleyRatio: 0.15 },
  blockSize: { min: 40, max: 160 },
  districts: 4,
  symmetry: 'none',
  tensor: {
    spacingMajor: 160,
    spacingMinor: 60,
    dominantAngle: 0,
    radialCenters: 1,
    noiseIntensity: 0.2,
    noiseScale: 300,
    boundaryWeight: 0.3,
    gridWeight: 0.7,
    stepSize: 4,
    maxSteps: 600,
  },
  cleanup: {
    snapTolerance: 6,
    minStreetLength: 18,
    parallelAngle: 12,
    mergeRadius: 10,
    deadEnds: false,
  },
  lots: {
    method: 'obb',
    minArea: 400,
    maxArea: 1600,
    splitJitter: 0.15,
    frontageDepth: 24,
    skipChance: 0.05,
  },
  landUse: {
    parkRatio: 0.08,
    waterRatio: 0.05,
    plazaRatio: 0.02,
    retailRadius: 0.35,
    noise: 0.3,
  },
  pois: {
    mode: 'auto',
    count: 24,
    retailBias: 0.75,
    minSpacing: 40,
    items: [],
  },
  naming: {
    enabled: true,
    locale: 'es',
    labelDensity: 0.5,
    minLabelLength: 90,
    fontSize: 9,
  },
  overrides: {},
};

export type ParamKind = 'number' | 'integer' | 'boolean' | 'enum' | 'string';

export interface ParamSpec {
  /** Ruta con puntos dentro de GenerationParams, p. ej. `tensor.spacingMajor`. */
  readonly path: string;
  readonly kind: ParamKind;
  readonly label: string;
  readonly description: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  /** Grupo para el playground. */
  readonly group: 'general' | 'hierarchy' | 'tensor' | 'cleanup' | 'lots' | 'landUse' | 'pois' | 'naming';
  /** Etapa del pipeline que invalida al cambiar (para caché parcial). */
  readonly invalidates: 'all' | 'field' | 'cleanup' | 'blocks' | 'lots' | 'pois' | 'labels';
}

export const PARAM_SPECS: readonly ParamSpec[] = [
  { path: 'seed', kind: 'string', label: 'Semilla', description: 'Cadena arbitraria; misma semilla + misma config = mismo SVG.', group: 'general', invalidates: 'all' },
  { path: 'size.w', kind: 'integer', label: 'Ancho', description: 'Unidades de mundo del viewBox.', min: 200, max: 4000, step: 10, group: 'general', invalidates: 'all' },
  { path: 'size.h', kind: 'integer', label: 'Alto', description: 'Unidades de mundo del viewBox.', min: 200, max: 4000, step: 10, group: 'general', invalidates: 'all' },
  { path: 'mode', kind: 'enum', label: 'Modo', description: 'Algoritmo de trazado de calles.', options: ['tensor', 'grid-jitter', 'organic-voronoi', 'radial', 'lsystem', 'hybrid'], group: 'general', invalidates: 'all' },
  { path: 'density', kind: 'number', label: 'Densidad', description: 'Multiplica el número de calles (inverso al espaciado).', min: 0, max: 1, step: 0.01, group: 'general', invalidates: 'field' },
  { path: 'curvature', kind: 'number', label: 'Curvatura', description: '0 = rectas, 1 = muy curvas.', min: 0, max: 1, step: 0.01, group: 'general', invalidates: 'field' },
  { path: 'chaos', kind: 'number', label: 'Orden ↔ caos', description: 'Jitter, ruido y tolerancias.', min: 0, max: 1, step: 0.01, group: 'general', invalidates: 'field' },
  { path: 'districts', kind: 'integer', label: 'Distritos', description: 'Número de celdas Voronoi de distrito.', min: 1, max: 12, step: 1, group: 'general', invalidates: 'all' },
  { path: 'symmetry', kind: 'enum', label: 'Simetría', description: 'Espejo del campo tensorial.', options: ['none', 'mirror-x', 'mirror-y', 'quad'], group: 'general', invalidates: 'field' },
  { path: 'blockSize.min', kind: 'number', label: 'Manzana mín.', description: 'Lado mínimo aproximado.', min: 20, max: 200, step: 5, group: 'general', invalidates: 'field' },
  { path: 'blockSize.max', kind: 'number', label: 'Manzana máx.', description: 'Lado máximo aproximado.', min: 40, max: 600, step: 5, group: 'general', invalidates: 'field' },

  { path: 'hierarchy.avenue', kind: 'number', label: 'Ancho avenida', description: '', min: 4, max: 40, step: 1, group: 'hierarchy', invalidates: 'blocks' },
  { path: 'hierarchy.street', kind: 'number', label: 'Ancho calle', description: '', min: 2, max: 30, step: 1, group: 'hierarchy', invalidates: 'blocks' },
  { path: 'hierarchy.alley', kind: 'number', label: 'Ancho callejón', description: '', min: 1, max: 20, step: 1, group: 'hierarchy', invalidates: 'blocks' },
  { path: 'hierarchy.alleyRatio', kind: 'number', label: 'Prop. callejones', description: 'Fracción de calles menores degradadas.', min: 0, max: 1, step: 0.01, group: 'hierarchy', invalidates: 'cleanup' },

  { path: 'tensor.spacingMajor', kind: 'number', label: 'Espaciado avenidas', description: 'dsep de streamlines mayores.', min: 60, max: 600, step: 5, group: 'tensor', invalidates: 'field' },
  { path: 'tensor.spacingMinor', kind: 'number', label: 'Espaciado calles', description: 'dsep de streamlines menores.', min: 20, max: 300, step: 5, group: 'tensor', invalidates: 'field' },
  { path: 'tensor.dominantAngle', kind: 'number', label: 'Ángulo dominante', description: 'Grados del campo grid.', min: -90, max: 90, step: 1, group: 'tensor', invalidates: 'field' },
  { path: 'tensor.radialCenters', kind: 'integer', label: 'Centros radiales', description: '', min: 0, max: 6, step: 1, group: 'tensor', invalidates: 'field' },
  { path: 'tensor.noiseIntensity', kind: 'number', label: 'Ruido', description: 'Rotación máxima por ruido (0–1 → 0–45°).', min: 0, max: 1, step: 0.01, group: 'tensor', invalidates: 'field' },
  { path: 'tensor.noiseScale', kind: 'number', label: 'Escala ruido', description: 'Tamaño de célula del ruido.', min: 50, max: 1000, step: 10, group: 'tensor', invalidates: 'field' },
  { path: 'tensor.boundaryWeight', kind: 'number', label: 'Peso borde', description: 'Alineación con agua/borde.', min: 0, max: 1, step: 0.01, group: 'tensor', invalidates: 'field' },
  { path: 'tensor.gridWeight', kind: 'number', label: 'Grid vs radial', description: '1 = solo grid.', min: 0, max: 1, step: 0.01, group: 'tensor', invalidates: 'field' },
  { path: 'tensor.stepSize', kind: 'number', label: 'Paso RK4', description: 'Menor = más fiel y más lento.', min: 1, max: 20, step: 0.5, group: 'tensor', invalidates: 'field' },
  { path: 'tensor.maxSteps', kind: 'integer', label: 'Pasos máx.', description: '', min: 50, max: 5000, step: 50, group: 'tensor', invalidates: 'field' },

  { path: 'cleanup.snapTolerance', kind: 'number', label: 'Snap', description: 'Radio de fusión de nodos.', min: 0, max: 30, step: 0.5, group: 'cleanup', invalidates: 'cleanup' },
  { path: 'cleanup.minStreetLength', kind: 'number', label: 'Calle mínima', description: '', min: 0, max: 100, step: 1, group: 'cleanup', invalidates: 'cleanup' },
  { path: 'cleanup.parallelAngle', kind: 'number', label: 'Ángulo paralelo', description: 'Grados para fusionar salidas casi paralelas.', min: 0, max: 45, step: 1, group: 'cleanup', invalidates: 'cleanup' },
  { path: 'cleanup.mergeRadius', kind: 'number', label: 'Fusión intersecciones', description: '', min: 0, max: 40, step: 1, group: 'cleanup', invalidates: 'cleanup' },
  { path: 'cleanup.deadEnds', kind: 'boolean', label: 'Callejones sin salida', description: 'Conservar filamentos.', group: 'cleanup', invalidates: 'cleanup' },

  { path: 'lots.method', kind: 'enum', label: 'Método lotes', description: '', options: ['obb', 'skeleton'], group: 'lots', invalidates: 'lots' },
  { path: 'lots.minArea', kind: 'number', label: 'Área mín. lote', description: '', min: 50, max: 5000, step: 10, group: 'lots', invalidates: 'lots' },
  { path: 'lots.maxArea', kind: 'number', label: 'Área máx. lote', description: '', min: 100, max: 20000, step: 50, group: 'lots', invalidates: 'lots' },
  { path: 'lots.splitJitter', kind: 'number', label: 'Jitter corte', description: '', min: 0, max: 0.45, step: 0.01, group: 'lots', invalidates: 'lots' },
  { path: 'lots.frontageDepth', kind: 'number', label: 'Profundidad frente', description: 'Solo skeleton.', min: 5, max: 100, step: 1, group: 'lots', invalidates: 'lots' },
  { path: 'lots.skipChance', kind: 'number', label: 'Sin subdividir', description: 'Probabilidad por manzana.', min: 0, max: 1, step: 0.01, group: 'lots', invalidates: 'lots' },

  { path: 'landUse.parkRatio', kind: 'number', label: 'Parques', description: 'Proporción de área.', min: 0, max: 0.5, step: 0.01, group: 'landUse', invalidates: 'blocks' },
  { path: 'landUse.waterRatio', kind: 'number', label: 'Agua', description: 'Proporción de área.', min: 0, max: 0.4, step: 0.01, group: 'landUse', invalidates: 'all' },
  { path: 'landUse.plazaRatio', kind: 'number', label: 'Plazas', description: '', min: 0, max: 0.2, step: 0.01, group: 'landUse', invalidates: 'blocks' },
  { path: 'landUse.retailRadius', kind: 'number', label: 'Radio comercial', description: 'Fracción del lienzo.', min: 0, max: 1, step: 0.01, group: 'landUse', invalidates: 'blocks' },
  { path: 'landUse.noise', kind: 'number', label: 'Ruido uso suelo', description: '', min: 0, max: 1, step: 0.01, group: 'landUse', invalidates: 'blocks' },

  { path: 'pois.mode', kind: 'enum', label: 'Modo POIs', description: '', options: ['auto', 'manual'], group: 'pois', invalidates: 'pois' },
  { path: 'pois.count', kind: 'integer', label: 'Nº tiendas', description: 'Solo auto.', min: 0, max: 500, step: 1, group: 'pois', invalidates: 'pois' },
  { path: 'pois.retailBias', kind: 'number', label: 'Sesgo retail', description: '', min: 0, max: 1, step: 0.01, group: 'pois', invalidates: 'pois' },
  { path: 'pois.minSpacing', kind: 'number', label: 'Separación mín.', description: '', min: 0, max: 200, step: 1, group: 'pois', invalidates: 'pois' },

  { path: 'naming.enabled', kind: 'boolean', label: 'Nombres', description: '', group: 'naming', invalidates: 'labels' },
  { path: 'naming.locale', kind: 'enum', label: 'Idioma', description: '', options: ['es', 'en'], group: 'naming', invalidates: 'labels' },
  { path: 'naming.labelDensity', kind: 'number', label: 'Densidad etiquetas', description: '', min: 0, max: 1, step: 0.01, group: 'naming', invalidates: 'labels' },
  { path: 'naming.minLabelLength', kind: 'number', label: 'Long. mín. etiqueta', description: '', min: 20, max: 400, step: 5, group: 'naming', invalidates: 'labels' },
  { path: 'naming.fontSize', kind: 'number', label: 'Tamaño fuente', description: 'Unidades de mundo.', min: 4, max: 24, step: 0.5, group: 'naming', invalidates: 'labels' },
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Merge profundo inmutable: arreglos se reemplazan, objetos se fusionan. */
export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    const pv = (patch as Record<string, unknown>)[key];
    if (pv === undefined) continue;
    const bv = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(bv) && isPlainObject(pv) ? deepMerge(bv, pv) : pv;
  }
  return out as T;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (isPlainObject(acc) ? acc[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    const next = cur[k];
    if (!isPlainObject(next)) {
      cur[k] = {};
    } else {
      cur[k] = { ...next };
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

export interface ParamIssue {
  readonly path: string;
  readonly message: string;
  readonly clamped?: unknown;
}

export interface ResolvedParams {
  readonly params: GenerationParams;
  readonly issues: readonly ParamIssue[];
}

/**
 * Aplica defaults, valida contra PARAM_SPECS y recorta a rango.
 * Nunca lanza: los valores fuera de rango se recortan y se reportan en `issues`
 * para que el playground pueda mostrarlos sin romper el render.
 */
export function resolveParams(input: GenerationInput): ResolvedParams {
  const merged = deepMerge(DEFAULT_PARAMS, input as DeepPartial<GenerationParams>) as unknown as Record<string, unknown>;
  const issues: ParamIssue[] = [];
  for (const spec of PARAM_SPECS) {
    const v = getPath(merged, spec.path);
    switch (spec.kind) {
      case 'number':
      case 'integer': {
        if (typeof v !== 'number' || Number.isNaN(v)) {
          const def = getPath(DEFAULT_PARAMS, spec.path);
          issues.push({ path: spec.path, message: 'no numérico; se usa el valor por defecto', clamped: def });
          setPath(merged, spec.path, def);
          break;
        }
        let c = v;
        if (spec.min !== undefined && c < spec.min) c = spec.min;
        if (spec.max !== undefined && c > spec.max) c = spec.max;
        if (spec.kind === 'integer') c = Math.round(c);
        if (c !== v) {
          issues.push({ path: spec.path, message: `fuera de rango [${spec.min},${spec.max}]`, clamped: c });
          setPath(merged, spec.path, c);
        }
        break;
      }
      case 'boolean': {
        if (typeof v !== 'boolean') {
          issues.push({ path: spec.path, message: 'se esperaba booleano', clamped: Boolean(v) });
          setPath(merged, spec.path, Boolean(v));
        }
        break;
      }
      case 'enum': {
        if (typeof v !== 'string' || !spec.options?.includes(v)) {
          const def = getPath(DEFAULT_PARAMS, spec.path);
          issues.push({ path: spec.path, message: `valor no permitido; opciones: ${spec.options?.join(', ')}`, clamped: def });
          setPath(merged, spec.path, def);
        }
        break;
      }
      case 'string': {
        if (typeof v !== 'string' || v.length === 0) {
          issues.push({ path: spec.path, message: 'cadena vacía; se usa "city-001"', clamped: 'city-001' });
          setPath(merged, spec.path, 'city-001');
        }
        break;
      }
    }
  }
  const p = merged as unknown as GenerationParams;
  // Invariantes cruzadas.
  if (p.blockSize.min > p.blockSize.max) {
    issues.push({ path: 'blockSize', message: 'min > max; se intercambian' });
    setPath(merged, 'blockSize', { min: p.blockSize.max, max: p.blockSize.min });
  }
  if (p.lots.minArea > p.lots.maxArea) {
    issues.push({ path: 'lots', message: 'minArea > maxArea; se intercambian' });
    setPath(merged, 'lots', { ...p.lots, minArea: p.lots.maxArea, maxArea: p.lots.minArea });
  }
  const total = p.landUse.parkRatio + p.landUse.waterRatio + p.landUse.plazaRatio;
  if (total > 0.8) {
    const k = 0.8 / total;
    issues.push({ path: 'landUse', message: 'parques+agua+plazas > 80 %; se reescalan' });
    setPath(merged, 'landUse', {
      ...p.landUse,
      parkRatio: p.landUse.parkRatio * k,
      waterRatio: p.landUse.waterRatio * k,
      plazaRatio: p.landUse.plazaRatio * k,
    });
  }
  return { params: merged as unknown as GenerationParams, issues };
}
