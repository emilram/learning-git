/**
 * useStoreBinding: enlaza metricas del dashboard con la codificacion visual de
 * cada tienda (tamano, color secuencial/divergente, anillo de estado, badge y
 * altura 3D) mediante escalas D3. Produce overrides por id y una leyenda.
 */
import { extent } from './internal/extent';
import { scaleDiverging, scaleLinear, scaleSequential, scaleSqrt } from 'd3-scale';
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import type { ElementStyle, Poi } from '../core/types';

export interface StoreDatum {
  /** Coincide con Poi.externalId o Poi.id. */
  readonly id: string;
  readonly [metric: string]: number | string | boolean | null | undefined;
}

export interface SizeSpec {
  readonly field: string;
  /** Escala relativa [min, max] aplicada al marcador (1 = tamano del tema). */
  readonly range?: readonly [number, number];
}

export interface ColorSpec {
  readonly field: string;
  readonly scheme: 'sequential' | 'diverging';
  /** Dominio explicito; por defecto extent (secuencial) o [min, 0, max] (divergente). */
  readonly domain?: readonly number[];
  /** Tonos OKLCH: secuencial [inicio, fin]; divergente [negativo, neutro, positivo]. */
  readonly hues?: readonly number[];
}

export interface StatusSpec {
  readonly field: string;
  /** Devuelve 'ok' | 'warn' | 'alert' | null para el valor. */
  readonly classify: (value: unknown) => 'ok' | 'warn' | 'alert' | null;
}

export interface HeightSpec {
  readonly field: string;
  readonly range?: readonly [number, number];
}

export interface BindingSpec {
  readonly size?: SizeSpec;
  readonly color?: ColorSpec;
  readonly status?: StatusSpec;
  readonly badge?: string;
  readonly height?: HeightSpec;
}

export interface LegendEntry {
  readonly label: string;
  readonly color?: string;
  readonly size?: number;
}

export interface StoreBinding {
  readonly overrides: ComputedRef<Readonly<Record<string, ElementStyle>>>;
  readonly badges: ComputedRef<ReadonlyMap<string, string>>;
  readonly heights: ComputedRef<ReadonlyMap<string, number>>;
  readonly legend: ComputedRef<{ color: LegendEntry[]; size: LegendEntry[]; status: LegendEntry[] }>;
  readonly datumOf: (poi: Poi) => StoreDatum | undefined;
}

/** Interpolacion OKLCH entre dos colores definidos por (L, C, H). */
function oklchInterpolator(a: readonly [number, number, number], b: readonly [number, number, number]): (t: number) => string {
  return (t) => {
    const u = Math.max(0, Math.min(1, t));
    const L = a[0] + (b[0] - a[0]) * u;
    const C = a[1] + (b[1] - a[1]) * u;
    let dh = b[2] - a[2];
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    const H = (a[2] + dh * u + 360) % 360;
    return `oklch(${L.toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`;
  };
}

const STATUS_COLOR: Record<'ok' | 'warn' | 'alert', string> = {
  ok: 'var(--cs-success)',
  warn: 'oklch(75% 0.16 80)',
  alert: 'var(--cs-danger)',
};

export function useStoreBinding(pois: MaybeRefOrGetter<readonly Poi[]>, data: MaybeRefOrGetter<readonly StoreDatum[]>, spec: MaybeRefOrGetter<BindingSpec>): StoreBinding {
  const index = computed(() => new Map(toValue(data).map((d) => [d.id, d])));
  const datumOf = (poi: Poi): StoreDatum | undefined => index.value.get(poi.externalId ?? '') ?? index.value.get(poi.id);
  const num = (d: StoreDatum | undefined, field: string): number | null => {
    const v = d?.[field];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const scales = computed(() => {
    const s = toValue(spec);
    const ps = toValue(pois);
    const values = (field: string): number[] => ps.map((p) => num(datumOf(p), field)).filter((v): v is number => v !== null);
    const size = s.size
      ? scaleSqrt()
          .domain(extent(values(s.size.field)))
          .range(s.size.range ?? [0.6, 2.2])
          .clamp(true)
      : null;
    let color: ((v: number) => string) | null = null;
    let colorDomain: number[] = [];
    if (s.color) {
      const vals = values(s.color.field);
      if (s.color.scheme === 'sequential') {
        colorDomain = s.color.domain ? [...s.color.domain] : extent(vals);
        const h0 = s.color.hues?.[0] ?? 250;
        const h1 = s.color.hues?.[1] ?? h0;
        const interp = oklchInterpolator([93, 0.04, h0], [45, 0.18, h1]);
        const sc = scaleSequential(interp).domain([colorDomain[0] ?? 0, colorDomain[1] ?? 1]);
        color = (v) => sc(v);
      } else {
        const [lo, hi] = extent(vals);
        const m = Math.max(Math.abs(lo), Math.abs(hi));
        colorDomain = s.color.domain ? [...s.color.domain] : [-m, 0, m];
        const [hn, hz, hp] = s.color.hues ?? [25, 250, 150];
        const neg = oklchInterpolator([94, 0.02, hz ?? 250], [50, 0.2, hn ?? 25]);
        const pos = oklchInterpolator([94, 0.02, hz ?? 250], [50, 0.18, hp ?? 150]);
        const sc = scaleDiverging((t: number) => (t < 0.5 ? neg(1 - t * 2) : pos((t - 0.5) * 2))).domain([colorDomain[0] ?? -1, colorDomain[1] ?? 0, colorDomain[2] ?? 1]);
        color = (v) => sc(v);
      }
    }
    const height = s.height
      ? scaleLinear()
          .domain(extent(values(s.height.field)))
          .range(s.height.range ?? [10, 70])
          .clamp(true)
      : null;
    return { s, size, color, colorDomain, height };
  });

  const overrides = computed(() => {
    const { s, size, color } = scales.value;
    const out: Record<string, ElementStyle> = {};
    for (const p of toValue(pois)) {
      const d = datumOf(p);
      const parts: string[] = [];
      const classes: string[] = [];
      if (size && s.size) {
        const v = num(d, s.size.field);
        if (v !== null) parts.push(`--cs-poi-scale:${size(v).toFixed(3)}`);
      }
      if (color && s.color) {
        const v = num(d, s.color.field);
        if (v !== null) parts.push(`--cs-poi-fill:${color(v)}`);
      }
      if (s.status) {
        const st = s.status.classify(d?.[s.status.field]);
        if (st) {
          parts.push(`--cs-poi-ring:${STATUS_COLOR[st]}`);
          classes.push(`cs-status-${st}`);
        } else parts.push('--cs-poi-ring:transparent');
      }
      if (parts.length || classes.length) out[p.id] = { style: parts.join(';'), ...(classes.length ? { className: classes.join(' ') } : {}) };
    }
    return out;
  });

  const badges = computed(() => {
    const { s } = scales.value;
    const m = new Map<string, string>();
    if (!s.badge) return m;
    for (const p of toValue(pois)) {
      const v = datumOf(p)?.[s.badge];
      if (v !== undefined && v !== null) m.set(p.id, typeof v === 'number' ? formatBadge(v) : String(v));
    }
    return m;
  });

  const heights = computed(() => {
    const { s, height } = scales.value;
    const m = new Map<string, number>();
    if (!height || !s.height) return m;
    for (const p of toValue(pois)) {
      const v = num(datumOf(p), s.height.field);
      if (v !== null) m.set(p.id, height(v));
    }
    return m;
  });

  const legend = computed(() => {
    const { s, size, color, colorDomain } = scales.value;
    const colorEntries: LegendEntry[] = [];
    if (color && colorDomain.length) {
      const lo = colorDomain[0]!;
      const hi = colorDomain[colorDomain.length - 1]!;
      for (let i = 0; i <= 4; i++) {
        const v = lo + ((hi - lo) * i) / 4;
        colorEntries.push({ label: formatBadge(v), color: color(v) });
      }
    }
    const sizeEntries: LegendEntry[] = [];
    if (size && s.size) {
      const [lo, hi] = size.domain();
      for (const v of [lo, (lo! + hi!) / 2, hi]) sizeEntries.push({ label: formatBadge(v!), size: size(v!) });
    }
    const statusEntries: LegendEntry[] = s.status ? (['ok', 'warn', 'alert'] as const).map((k) => ({ label: k, color: STATUS_COLOR[k] })) : [];
    return { color: colorEntries, size: sizeEntries, status: statusEntries };
  });

  return { overrides, badges, heights, legend, datumOf };
}

export function formatBadge(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  if (a < 1 && a > 0) return `${(v * 100).toFixed(0)}%`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
