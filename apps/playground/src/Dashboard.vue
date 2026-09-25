<script setup lang="ts">
/**
 * Dashboard ejecutivo de ejemplo: 40 tiendas simuladas sobre una ciudad
 * sintetica. Muestra las utilidades v5: hora del dia con crossfade, camara con
 * presets y autorrotacion, seleccion simple/multiple, ruta entre tiendas,
 * cobertura con huecos y candidatos, canibalizacion, resumen por distrito,
 * heatmap, comparacion de periodos y tour guiado.
 */
import { computed, ref, watch } from 'vue';
import {
  CitySketchCard,
  CitySketchCompare,
  useCityModel,
  useStoreBinding,
  useUrlState,
  useTimeOfDay,
  useCityCamera,
  useStoreSelection,
  useTour,
  computeIsochrones,
  cannibalization,
  coverageGaps,
  coveredArea,
  districtSummary,
  cityStats,
  routeBetween,
  nearestStores,
  formatBadge,
  downloadPng,
  type StoreDatum,
  type Kpi,
  type TourStep,
  type CameraPresetName,
} from '@empresa/city-sketch/vue';
import { THEME_PRESETS } from '@empresa/city-sketch/theme';
import { createRng, type PoiSpec, type Poi, type ElementStyle } from '@empresa/city-sketch';

// ---------------------------------------------------------------------------
// Ciudad y datos simulados
// ---------------------------------------------------------------------------
const STORE_IDS = Array.from({ length: 40 }, (_, i) => `S-${String(i + 1).padStart(3, '0')}`);
const items: PoiSpec[] = [];
const input = computed(() => ({ seed: 'retail-mx-2026', mode: 'tensor' as const, size: { w: 1200, h: 900 }, pois: { count: 40, minSpacing: 55, items } }));
const { model, generating, lastMs } = useCityModel(input);

function period(seed: string): StoreDatum[] {
  const rng = createRng(seed);
  return STORE_IDS.map((id, i) => {
    const sales = Math.round(rng.range(40, 420) * 1000);
    const margin = rng.range(-0.12, 0.25);
    const conv = rng.range(0.01, 0.09);
    const stock = rng.range(0, 1);
    return { id, sales, margin, conversion: conv, stock, format: i % 7 === 0 ? 'flagship' : 'store' };
  });
}
const august = period('2026-08');
const september = period('2026-09');
const datumById = new Map(september.map((d) => [d.id, d]));

const poisWithIds = computed(() => (model.value ? model.value.pois.map((p, i) => ({ ...p, externalId: STORE_IDS[i]! })) : []));
const modelBound = computed(() => (model.value ? { ...model.value, pois: poisWithIds.value } : null));
const datumOf = (poi: Poi | null | undefined): StoreDatum | undefined => (poi ? datumById.get(poi.externalId ?? '') : undefined);
const sales = (poi: Poi): number => (datumOf(poi)?.sales as number | undefined) ?? 0;

// ---------------------------------------------------------------------------
// Hora del dia, camara, seleccion
// ---------------------------------------------------------------------------
const tod = useTimeOfDay({ initial: 'day' });
const mainCard = ref<InstanceType<typeof CitySketchCard> | null>(null);
const mainSketch = computed(() => mainCard.value?.sketch ?? null);
const camera = useCityCamera(mainSketch);
const cameraPresets: { name: CameraPresetName; label: string }[] = [
  { name: 'hero', label: 'Vista general' },
  { name: 'bird', label: 'Cenital' },
  { name: 'street', label: 'A pie de calle' },
];
const view3d = ref<'2d' | 'iso'>('iso');
watch(view3d, (v) => {
  if (v !== 'iso') camera.stop();
});

const url = useUrlState({ prefix: 'dash' });
const selection = useStoreSelection(modelBound, { mode: 'single' });
watch(
  () => url.selected.value,
  (id) => {
    if (id && !selection.has(id)) selection.add([id]);
  },
  { immediate: true },
);
watch(
  () => selection.primary.value?.id ?? null,
  (id) => (url.selected.value = id),
);
const selected = computed(() => selection.primary.value?.id ?? null);
const multi = computed({
  get: () => selection.mode.value === 'multi',
  set: (v) => selection.setMode(v ? 'multi' : 'single'),
});
function onSelect(id: string): void {
  selection.toggle(id);
}

// ---------------------------------------------------------------------------
// Codificacion visual
// ---------------------------------------------------------------------------
const binding = useStoreBinding(
  () => poisWithIds.value,
  () => september,
  () => ({
    size: { field: 'sales', range: [0.6, 2.4] },
    status: { field: 'stock', classify: (v) => (typeof v === 'number' ? (v < 0.15 ? 'alert' : v < 0.35 ? 'warn' : 'ok') : null) },
    badge: 'sales',
    height: { field: 'sales', range: [12, 80] },
  }),
);
const heights = computed(() => binding.heights.value);
// Overrides de seleccion multiple sobre los del binding.
const poiOverrides = computed<Record<string, ElementStyle>>(() => {
  const out: Record<string, ElementStyle> = { ...binding.overrides.value };
  if (selection.mode.value !== 'multi') return out;
  for (const id of selection.ids.value) {
    const prev = out[id];
    out[id] = { ...prev, className: `${prev?.className ?? ''} cs-multi`.trim() };
  }
  return out;
});

// ---------------------------------------------------------------------------
// Analisis: isocronas, ruta, cobertura, canibalizacion, distritos
// ---------------------------------------------------------------------------
const showIsochrones = ref(true);
const isolated = ref<string | null>(null);
const isochrones = computed(() => {
  const m = modelBound.value;
  const id = selected.value;
  if (!m || !id || !showIsochrones.value) return [];
  const poi = m.pois.find((p) => p.id === id);
  return poi ? computeIsochrones(m, [poi], [120, 240, 360]) : [];
});
const COVER_RADIUS = 150;
const coverage = computed(() => (modelBound.value ? computeIsochrones(modelBound.value, modelBound.value.pois, [COVER_RADIUS]) : []));
const gaps = computed(() => (modelBound.value ? coverageGaps(modelBound.value, COVER_RADIUS * 0.85, { max: 5, minSpacing: 120 }) : []));
const pairs = computed(() => cannibalization(coverage.value, 0.12).slice(0, 8));
const stats = computed(() => (modelBound.value ? cityStats(modelBound.value) : null));
const coverPct = computed(() => (stats.value ? Math.min(100, (coveredArea(coverage.value) / (stats.value.area - stats.value.landUse.water)) * 100) : 0));
const labelOf = (id: string): string => poisWithIds.value.find((p) => p.id === id)?.label ?? id;
const districts = computed(() => (modelBound.value ? districtSummary(modelBound.value, (p) => sales(p)).sort((a, b) => b.total - a.total) : []));
const maxDistrict = computed(() => Math.max(1, ...districts.value.map((d) => d.total)));
const districtColors = computed(() => tod.theme.value.data.categorical);

const route = computed(() => {
  const m = modelBound.value;
  const ps = selection.pois.value;
  if (!m || ps.length < 2) return null;
  const a = ps[ps.length - 2]!;
  const b = ps[ps.length - 1]!;
  const r = routeBetween(m, [a.x, a.y], [b.x, b.y]);
  return r ? { ...r, a, b } : null;
});
const pairPolygon = ref<readonly (readonly [number, number])[] | null>(null);
function showPair(a: string, b: string, polygon: readonly (readonly [number, number])[]): void {
  selection.setMode('multi');
  selection.add([a, b]);
  pairPolygon.value = polygon;
}
watch(() => selection.ids.value, () => (pairPolygon.value = null));

const neighbors = computed(() => {
  const m = modelBound.value;
  const s = selection.primary.value;
  if (!m || !s) return [];
  return nearestStores(m, s, 3).map((n) => ({ ...n, datum: datumOf(n.poi) }));
});

// ---------------------------------------------------------------------------
// Vista 3D: opciones derivadas de la hora del dia, seleccion y analisis
// ---------------------------------------------------------------------------
const accent = computed(() => tod.theme.value.data.categorical[0]!);
const isoOptions = computed(() => ({
  rotation: 30,
  pitch: 55,
  fit: 'cover' as const,
  zoom: 1.35,
  traffic: 0.6,
  focus: selection.mode.value === 'single',
  ...tod.iso.value,
  groundOverlays: [
    ...[...isochrones.value].sort((a, b) => b.distance - a.distance).map((b, i) => ({ polygon: b.polygon, fill: accent.value, opacity: 0.12 + i * 0.1 })),
    ...(pairPolygon.value ? [{ polygon: pairPolygon.value, fill: tod.theme.value.data.status.alert, opacity: 0.45 }] : []),
  ],
  groundRings: radiusRing.value ? [{ center: radiusRing.value.center, radius: radiusRing.value.radius, stroke: tod.theme.value.data.categorical[1]! }] : [],
  callout: calloutIso.value,
  groundPaths: route.value ? [{ polyline: route.value.polyline, stroke: tod.theme.value.data.categorical[1]!, width: 3 }] : [],
  links: selection.mode.value === 'single' && selection.primary.value ? neighbors.value.map((n) => ({ from: [selection.primary.value!.x, selection.primary.value!.y] as const, to: [n.poi.x, n.poi.y] as const, dash: true })) : [],
  lotHeight: (_lot: unknown, block: { density: number }, poi: { id: string } | null) => (poi ? (heights.value.get(poi.id) ?? 20) : 4 + block.density * 10),
}));

// ---------------------------------------------------------------------------
// Heatmap de conversion por manzana
// ---------------------------------------------------------------------------
const heat = computed(() => {
  const m = modelBound.value;
  if (!m) return new Map<string, number>();
  const lotBlock = new Map(m.lots.map((l) => [l.id, l.blockId]));
  const acc = new Map<string, number[]>();
  for (const p of m.pois) {
    const blockId = p.anchor.kind === 'lot' ? lotBlock.get(p.anchor.lotId) : undefined;
    const v = datumOf(p)?.conversion as number | undefined;
    if (!blockId || v === undefined) continue;
    (acc.get(blockId) ?? acc.set(blockId, []).get(blockId))!.push(v);
  }
  const out = new Map<string, number>();
  const districtAvg = new Map<string, number[]>();
  for (const b of m.blocks) {
    const vs = acc.get(b.id);
    if (vs) {
      const v = vs.reduce((s, x) => s + x, 0) / vs.length / 0.09;
      out.set(b.id, v);
      (districtAvg.get(b.districtId) ?? districtAvg.set(b.districtId, []).get(b.districtId))!.push(v);
    }
  }
  for (const b of m.blocks) {
    if (out.has(b.id) || b.landUse === 'park' || b.landUse === 'water') continue;
    const vs = districtAvg.get(b.districtId);
    if (vs) out.set(b.id, (vs.reduce((s, x) => s + x, 0) / vs.length) * 0.5);
  }
  return out;
});

// ---------------------------------------------------------------------------
// Filtro, KPIs, comparacion, tour
// ---------------------------------------------------------------------------
const onlyFlagship = computed({
  get: () => url.filters.value.includes('flagship'),
  set: (v) => {
    url.filters.value = v ? ['flagship'] : [];
  },
});
const filter = computed(() => {
  if (isolated.value) return new Set([isolated.value]);
  if (!onlyFlagship.value) return null;
  const ids = new Set(september.filter((d) => d.format === 'flagship').map((d) => d.id));
  return new Set(poisWithIds.value.filter((p) => ids.has(p.externalId ?? '')).map((p) => p.id));
});

const kpis = computed<Kpi[]>(() => {
  const total = september.reduce((s, d) => s + (d.sales as number), 0);
  const prev = august.reduce((s, d) => s + (d.sales as number), 0);
  const alerts = september.filter((d) => (d.stock as number) < 0.15).length;
  const conv = september.reduce((s, d) => s + (d.conversion as number), 0) / september.length;
  return [
    { label: 'Ventas', value: formatBadge(total), delta: `${(((total - prev) / prev) * 100).toFixed(1)} % vs ago`, tone: total >= prev ? 'positive' : 'negative' },
    { label: 'Tiendas', value: String(september.length) },
    { label: 'Conversión', value: `${(conv * 100).toFixed(1)} %` },
    { label: 'Cobertura', value: `${coverPct.value.toFixed(0)} %` },
    { label: 'Alertas stock', value: String(alerts), tone: alerts > 3 ? 'negative' : 'neutral' },
  ];
});

const compareSpec = { size: { field: 'sales', range: [0.6, 2.4] as const }, status: { field: 'margin', classify: (v: unknown) => (typeof v === 'number' ? (v < 0 ? 'alert' : v < 0.08 ? 'warn' : 'ok') : null) } };
const bindingAug = useStoreBinding(() => poisWithIds.value, () => august, () => compareSpec);
const bindingSep = useStoreBinding(() => poisWithIds.value, () => september, () => compareSpec);

const topStores = computed(() => [...poisWithIds.value].sort((a, b) => sales(b) - sales(a)).slice(0, 5));
const tourSteps = computed<TourStep[]>(() => [
  { id: 'overview', title: 'Red completa', text: 'Vista general de las 40 tiendas; tamaño = ventas, color = margen.', select: null, view: 'iso', camera: { rotation: 30, pitch: 60 }, duration: 4200 },
  ...topStores.value.map((p, i) => ({ id: p.id, title: `Top ${i + 1} · ${p.label}`, text: `${formatBadge(sales(p))} en ventas · margen ${((datumOf(p)?.margin as number) * 100).toFixed(1)} %`, select: p.id, view: 'iso' as const, duration: 3600 })),
  { id: 'coverage', title: 'Huecos de cobertura', text: `${gaps.value.length} emplazamientos candidatos fuera del radio de cobertura actual.`, select: null, view: '2d', duration: 4500 },
]);
const tour = useTour(tourSteps, {
  interval: 3600,
  onStep: (step) => {
    if (step.view) view3d.value = step.view;
    selection.setMode('single');
    selection.select(step.select ?? null);
    if (step.camera) camera.orbitTo(step.camera.rotation, step.camera.pitch, true);
    if (step.id === 'coverage') tod.set('day');
  },
  onEnd: () => camera.stop(),
});

// ---------------------------------------------------------------------------
// Panel de tienda: historico, ranking, comparativas y acciones
// ---------------------------------------------------------------------------
const MONTHS = ['oct', 'nov', 'dic', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep'];
const historyCache = new Map<string, number[]>();
/** Serie mensual simulada (12 meses) que termina en las ventas actuales; determinista por tienda. */
function history(id: string, current: number): number[] {
  const hit = historyCache.get(id);
  if (hit) return hit;
  const rng = createRng(`hist:${id}`);
  const out: number[] = [];
  let v = current * rng.range(0.7, 1.2);
  for (let i = 0; i < 11; i++) {
    out.push(Math.round(v));
    v = v * rng.range(0.9, 1.12);
  }
  out.push(current);
  historyCache.set(id, out);
  return out;
}
function sparkPath(series: readonly number[], w: number, h: number): string {
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = Math.max(1, hi - lo);
  return series.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (series.length - 1)) * w).toFixed(1)} ${(h - ((v - lo) / span) * h).toFixed(1)}`).join('');
}
const ranking = computed(() => [...poisWithIds.value].sort((a, b) => sales(b) - sales(a)).map((p) => p.id));
const mean = (list: readonly Poi[], field: string): number => {
  const vs = list.map((p) => datumOf(p)?.[field]).filter((v): v is number => typeof v === 'number');
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
};
const panel = computed(() => {
  const poi = selection.primary.value;
  const d = datumOf(poi);
  const m = modelBound.value;
  if (!poi || !d || !m) return null;
  const district = selectedDistrict.value;
  const inDistrict = district ? districts.value.find((r) => r.district.id === district.id)?.pois ?? [] : [];
  const cur = d.sales as number;
  const hist = history(poi.id, cur);
  const prevMonth = hist[hist.length - 2] ?? cur;
  const augD = august.find((x) => x.id === poi.externalId);
  const metrics = [
    { key: 'sales', label: 'Ventas', value: cur, fmt: (v: number) => formatBadge(v), district: mean(inDistrict, 'sales'), network: mean(poisWithIds.value, 'sales') },
    { key: 'margin', label: 'Margen', value: d.margin as number, fmt: (v: number) => `${(v * 100).toFixed(1)} %`, district: mean(inDistrict, 'margin'), network: mean(poisWithIds.value, 'margin') },
    { key: 'conversion', label: 'Conversión', value: d.conversion as number, fmt: (v: number) => `${(v * 100).toFixed(1)} %`, district: mean(inDistrict, 'conversion'), network: mean(poisWithIds.value, 'conversion') },
  ];
  return {
    poi,
    d,
    district,
    rank: ranking.value.indexOf(poi.id) + 1,
    total: ranking.value.length,
    hist,
    spark: sparkPath(hist, 200, 44),
    monthDelta: prevMonth ? (cur - prevMonth) / prevMonth : 0,
    yearDelta: augD ? (cur - (augD.sales as number)) / (augD.sales as number) : 0,
    stock: d.stock as number,
    metrics,
    peak: hist.indexOf(Math.max(...hist)),
  };
});
const compareA = ref<string | null>(null);
const comparison = computed(() => {
  const a = poisWithIds.value.find((p) => p.id === compareA.value);
  const b = selection.primary.value;
  if (!a || !b || a.id === b.id) return null;
  const da = datumOf(a);
  const db = datumOf(b);
  if (!da || !db) return null;
  const rows = (['sales', 'margin', 'conversion', 'stock'] as const).map((k) => ({ k, label: k === 'sales' ? 'Ventas' : k === 'margin' ? 'Margen' : k === 'conversion' ? 'Conversión' : 'Stock', a: da[k] as number, b: db[k] as number }));
  return { a, b, rows, distance: Math.hypot(a.x - b.x, a.y - b.y) };
});
const fmtMetric = (k: string, v: number): string => (k === 'sales' ? formatBadge(v) : `${(v * 100).toFixed(k === 'stock' ? 0 : 1)} %`);
const copied = ref(false);
async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(location.href);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    copied.value = false;
  }
}
function centerOn3d(): void {
  const p = selection.primary.value;
  if (!p) return;
  view3d.value = 'iso';
  requestAnimationFrame(() => camera.flyTo([p.x, p.y], 2.6, 700));
}
function orbitAround(): void {
  centerOn3d();
  setTimeout(() => camera.autoRotate(10), 750);
}
async function exportStore(): Promise<void> {
  const p = selection.primary.value;
  const m = modelBound.value;
  if (!p || !m) return;
  await downloadPng(m, tod.theme.value, { view: 'iso', iso: { ...isoOptions.value, fit: 'cover', zoom: 3, center: [p.x, p.y], selectedId: p.id, storeLabels: true }, scale: 2, fileName: `${p.label}.png` });
}
function routeTo(id: string): void {
  const p = selection.primary.value;
  if (!p) return;
  selection.setMode('multi');
  selection.add([p.id, id]);
}
watch(() => selection.primary.value?.id, () => {
  if (isolated.value && isolated.value !== selection.primary.value?.id) isolated.value = null;
});
const calloutSeries = computed(() => (panel.value ? panel.value.hist.slice(-8) : []));
// Anillo de radio en el suelo (3D) y callout dentro de la escena isometrica con botones.
const radiusRing = ref<{ center: readonly [number, number]; radius: number } | null>(null);
watch(() => selection.primary.value?.id, () => (radiusRing.value = null));
function selectRadius(r = 200): void {
  const p = selection.primary.value;
  if (!p) return;
  radiusRing.value = { center: [p.x, p.y], radius: r };
  selection.selectWithin([p.x, p.y], r);
}
const calloutIso = computed(() => {
  const pn = panel.value;
  if (!pn) return null;
  const st = pn.stock;
  const status = tod.theme.value.data.status;
  return {
    title: `${pn.poi.label} · #${pn.rank} de ${pn.total}`,
    subtitle: `${pn.poi.externalId} · ${pn.district?.name ?? ''} · ${pn.monthDelta >= 0 ? '+' : ''}${(pn.monthDelta * 100).toFixed(1)} % mes`,
    rows: [
      { label: 'Ventas', value: formatBadge(pn.d.sales as number) },
      { label: 'Margen', value: `${((pn.d.margin as number) * 100).toFixed(1)} %` },
      { label: 'Conversión', value: `${((pn.d.conversion as number) * 100).toFixed(1)} %` },
    ],
    bar: { label: `Stock ${(st * 100).toFixed(0)} %`, value: st, color: st < 0.15 ? status.alert : st < 0.35 ? status.warn : status.ok },
    series: calloutSeries.value,
    actions: [
      { id: 'neighbors', label: 'Vecinas', active: selection.mode.value === 'multi' && selection.count.value > 1 && !radiusRing.value },
      { id: 'radius', label: 'Radio', active: !!radiusRing.value },
      { id: 'isolate', label: 'Aislar', active: isolated.value === pn.poi.id },
      { id: 'street', label: 'Calle' },
      { id: 'compare', label: compareA.value === pn.poi.id ? 'Fijada' : 'Fijar', active: compareA.value === pn.poi.id },
    ],
  };
});
function onStoreAction(action: string): void {
  const p = selection.primary.value;
  if (!p) return;
  switch (action) {
    case 'neighbors':
      selection.selectNeighborhood(p.id, 3);
      break;
    case 'radius':
      if (radiusRing.value) {
        radiusRing.value = null;
        selection.select(p.id);
      } else selectRadius(200);
      break;
    case 'isolate':
      isolated.value = isolated.value === p.id ? null : p.id;
      break;
    case 'street':
      view3d.value = 'iso';
      camera.orbitTo(25, 34, false);
      camera.flyTo([p.x, p.y], 3.2, 700);
      break;
    case 'top':
      view3d.value = 'iso';
      camera.orbitTo(30, 75, false);
      camera.flyTo([p.x, p.y], 2.4, 700);
      break;
    case 'compare':
      compareA.value = compareA.value === p.id ? null : p.id;
      break;
    case 'orbit':
      orbitAround();
      break;
  }
}

const selectedDistrict = computed(() => {
  const p = selection.primary.value;
  const m = modelBound.value;
  if (!p || !m) return null;
  const lotBlock = new Map(m.lots.map((l) => [l.id, l.blockId]));
  const blockId = p.anchor.kind === 'lot' ? lotBlock.get(p.anchor.lotId) : undefined;
  const block = m.blocks.find((b) => b.id === blockId);
  return block ? m.districts.find((d) => d.id === block.districtId) ?? null : null;
});
</script>

<template>
  <div class="dash" :data-phase="tod.phase.value">
    <header class="dash-head">
      <div class="dash-titles">
        <h1>Red de tiendas</h1>
        <p>Septiembre 2026 · 40 tiendas con datos simulados sobre una ciudad sintética · generación {{ lastMs.toFixed(0) }} ms{{ generating ? ', regenerando…' : '' }}</p>
      </div>
      <div class="dash-actions">
        <div class="dash-seg" role="group" aria-label="Hora del día">
          <button v-for="ph in ['day', 'dusk', 'night'] as const" :key="ph" type="button" :class="{ on: tod.phase.value === ph }" :aria-pressed="tod.phase.value === ph" @click="tod.set(ph)">
            {{ ph === 'day' ? 'Día' : ph === 'dusk' ? 'Atardecer' : 'Noche' }}
          </button>
        </div>
        <div class="dash-seg" role="group" aria-label="Selección">
          <button type="button" :class="{ on: !multi }" @click="multi = false">Simple</button>
          <button type="button" :class="{ on: multi }" @click="multi = true">Múltiple</button>
        </div>
        <label class="dash-toggle"><input v-model="onlyFlagship" type="checkbox" /> Solo flagship</label>
        <button type="button" class="dash-tour" :class="{ on: tour.running.value }" @click="tour.toggle()">{{ tour.running.value ? 'Detener tour' : 'Tour ejecutivo' }}</button>
      </div>
    </header>

    <div v-if="tour.running.value && tour.current.value" class="dash-tourbar" :style="`--p:${tour.stepProgress.value}`" aria-live="polite">
      <strong>{{ tour.current.value.title }}</strong>
      <span>{{ tour.current.value.text }}</span>
      <small>{{ tour.index.value + 1 }} / {{ tour.total.value }}</small>
      <button type="button" @click="tour.prev()">Anterior</button>
      <button type="button" @click="tour.next()">Siguiente</button>
    </div>

    <div class="dash-grid">
      <CitySketchCard
        ref="mainCard"
        class="span-2 dash-main"
        title="Ventas por tienda"
        :subtitle="`Tamaño = ventas · anillo = stock (continuo, discontinuo, doble) · ${multi ? 'clic para añadir a la selección' : 'clic para isócronas y vecinas'} · en 3D arrastra para orbitar`"
        :model="modelBound"
        :theme="tod.theme.value"
        :kpis="kpis"
        :poi-overrides="poiOverrides"
        :badges="binding.badges.value"
        :legend="binding.legend.value"
        :isochrones="isochrones"
        :selected-id="selected"
        :filter="filter"
        :iso="isoOptions"
        :view="view3d"
        :generating="generating"
        @store:select="onSelect($event.id)"
        @store:action="onStoreAction($event.action)"
        @update:view="view3d = $event"
      >
        <template #actions>
          <template v-if="view3d === 'iso'">
            <button v-for="p in cameraPresets" :key="p.name" type="button" class="cs-btn" @click="camera.preset(p.name)">{{ p.label }}</button>
            <button type="button" class="cs-btn" :aria-pressed="camera.rotating.value" @click="camera.rotating.value ? camera.stop() : camera.autoRotate(9)">{{ camera.rotating.value ? 'Parar giro' : 'Girar' }}</button>
          </template>
        </template>
        <template #overlay>
          <g v-if="route" class="dash-route" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path :d="`M${route.polyline.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}`" class="dash-route-halo" />
            <path :d="`M${route.polyline.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}`" class="dash-route-line" />
          </g>
          <path v-if="pairPolygon" class="dash-pair" :d="`M${pairPolygon.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}Z`" />
          <!-- Callout desplegable junto a la tienda seleccionada. -->
          <g v-if="panel && view3d === '2d'" class="dash-callout" :transform="`translate(${(panel.poi.x > 1000 ? panel.poi.x - 118 : panel.poi.x + 14).toFixed(1)} ${Math.max(6, panel.poi.y - 58).toFixed(1)})`">
            <rect width="104" height="52" rx="8" class="dash-callout-bg" />
            <rect width="104" height="12" rx="8" class="dash-callout-head" />
            <rect y="6" width="104" height="6" class="dash-callout-head" />
            <text x="6" y="8.6" class="dash-callout-title">{{ panel.poi.label }} · #{{ panel.rank }}</text>
            <text x="6" y="22" class="dash-callout-k">Ventas</text><text x="98" y="22" class="dash-callout-v">{{ formatBadge(panel.d.sales as number) }}</text>
            <text x="6" y="31" class="dash-callout-k">Margen</text><text x="98" y="31" class="dash-callout-v">{{ ((panel.d.margin as number) * 100).toFixed(1) }} %</text>
            <text x="6" y="40" class="dash-callout-k">Stock</text>
            <rect x="40" y="36" width="58" height="4" rx="2" class="dash-callout-track" />
            <rect x="40" y="36" :width="(58 * panel.stock).toFixed(1)" height="4" rx="2" class="dash-callout-fill" :data-state="panel.stock < 0.15 ? 'alert' : panel.stock < 0.35 ? 'warn' : 'ok'" />
            <g transform="translate(6 43)">
              <rect v-for="(v, i) in calloutSeries" :key="i" :x="i * 12" :y="(6 - (6 * v) / Math.max(...calloutSeries)).toFixed(1)" width="9" :height="((6 * v) / Math.max(...calloutSeries)).toFixed(1)" class="dash-callout-bar" :class="{ last: i === calloutSeries.length - 1 }" />
            </g>
          </g>
        </template>
        <template #tooltip="{ state }">
          <template v-if="state.poi">
            <strong>{{ state.poi.label }}</strong> <small>{{ state.poi.externalId }}</small>
            <div v-if="datumOf(state.poi)" class="tt-grid">
              <span>Ventas</span><b>{{ formatBadge(datumOf(state.poi)!.sales as number) }}</b>
              <span>Margen</span><b>{{ ((datumOf(state.poi)!.margin as number) * 100).toFixed(1) }} %</b>
              <span>Stock</span><b>{{ ((datumOf(state.poi)!.stock as number) * 100).toFixed(0) }} %</b>
            </div>
          </template>
          <template v-else-if="state.block">Manzana {{ state.block.landUse }} · densidad {{ (state.block.density * 100).toFixed(0) }} %</template>
        </template>
        <template #footer>
          <div v-if="route" class="dash-route-info">
            Ruta <b>{{ route.a.label }}</b> → <b>{{ route.b.label }}</b>: {{ route.length.toFixed(0) }} u por {{ route.streetIds.length }} calles.
          </div>
        </template>
      </CitySketchCard>

      <aside class="cs-card dash-detail" :class="{ 'dash-detail-open': panel }">
        <header class="cs-card-header">
          <div class="cs-card-titles">
            <h3 class="cs-card-title">{{ panel ? panel.poi.label : 'Tienda' }}</h3>
            <p v-if="panel" class="cs-card-subtitle">{{ panel.poi.externalId }} · {{ panel.d.format }} · {{ panel.district?.name ?? 'sin distrito' }}</p>
          </div>
          <div v-if="panel" class="dash-rank" :title="`Puesto ${panel.rank} de ${panel.total} por ventas`">#{{ panel.rank }}<small>/{{ panel.total }}</small></div>
        </header>
        <div v-if="panel" class="dash-panel">
          <section class="dash-panel-hero">
            <div>
              <span class="dash-panel-label">Ventas del mes</span>
              <strong class="dash-panel-big">{{ formatBadge(panel.d.sales as number) }}</strong>
              <span class="dash-delta" :data-tone="panel.monthDelta >= 0 ? 'positive' : 'negative'">{{ panel.monthDelta >= 0 ? '+' : '' }}{{ (panel.monthDelta * 100).toFixed(1) }} % vs mes anterior</span>
              <span class="dash-delta" :data-tone="panel.yearDelta >= 0 ? 'positive' : 'negative'">{{ panel.yearDelta >= 0 ? '+' : '' }}{{ (panel.yearDelta * 100).toFixed(1) }} % vs agosto</span>
            </div>
            <svg class="dash-spark" viewBox="-2 -4 204 60" aria-label="Ventas de los últimos 12 meses">
              <path :d="`${panel.spark}L200 52L0 52Z`" class="dash-spark-area" />
              <path :d="panel.spark" class="dash-spark-line" />
              <circle :cx="((panel.peak / 11) * 200).toFixed(1)" :cy="(44 - ((panel.hist[panel.peak]! - Math.min(...panel.hist)) / Math.max(1, Math.max(...panel.hist) - Math.min(...panel.hist))) * 44).toFixed(1)" r="3" class="dash-spark-peak" />
              <circle cx="200" :cy="(44 - ((panel.hist[11]! - Math.min(...panel.hist)) / Math.max(1, Math.max(...panel.hist) - Math.min(...panel.hist))) * 44).toFixed(1)" r="3.5" class="dash-spark-now" />
              <text x="0" y="58" class="dash-spark-axis">{{ MONTHS[0] }}</text>
              <text x="200" y="58" class="dash-spark-axis" text-anchor="end">{{ MONTHS[11] }}</text>
            </svg>
          </section>

          <section>
            <h5>Frente a distrito y red</h5>
            <table class="dash-table">
              <thead><tr><th></th><th>Tienda</th><th>Distrito</th><th>Red</th></tr></thead>
              <tbody>
                <tr v-for="m in panel.metrics" :key="m.key">
                  <td>{{ m.label }}</td>
                  <td><b>{{ m.fmt(m.value) }}</b></td>
                  <td :data-tone="m.value >= m.district ? 'positive' : 'negative'">{{ m.fmt(m.district) }}</td>
                  <td :data-tone="m.value >= m.network ? 'positive' : 'negative'">{{ m.fmt(m.network) }}</td>
                </tr>
              </tbody>
            </table>
            <div class="dash-stock">
              <span>Stock {{ (panel.stock * 100).toFixed(0) }} %</span>
              <i class="dash-bar dash-bar-wide" :style="`--w:${(panel.stock * 100).toFixed(0)}%`" :data-state="panel.stock < 0.15 ? 'alert' : panel.stock < 0.35 ? 'warn' : 'ok'" />
              <small>{{ panel.stock < 0.15 ? 'Alerta: reponer' : panel.stock < 0.35 ? 'Vigilar' : 'Correcto' }}</small>
            </div>
          </section>

          <section>
            <h5>Acciones</h5>
            <div class="dash-actions-grid">
              <button type="button" :class="{ on: showIsochrones }" @click="showIsochrones = !showIsochrones">Isócronas</button>
              <button type="button" :class="{ on: isolated === panel.poi.id }" @click="isolated = isolated === panel.poi.id ? null : panel.poi.id">Aislar</button>
              <button type="button" @click="selection.selectNeighborhood(panel.poi.id, 3)">Vecindario</button>
              <button type="button" :class="{ on: !!radiusRing }" @click="onStoreAction('radius')">Radio 200 u</button>
              <button type="button" @click="centerOn3d">Centrar en 3D</button>
              <button type="button" @click="orbitAround">Orbitar</button>
              <button type="button" @click="onStoreAction('street')">Escaparate</button>
              <button type="button" @click="onStoreAction('top')">Cenital</button>
              <button type="button" :class="{ on: compareA === panel.poi.id }" @click="compareA = compareA === panel.poi.id ? null : panel.poi.id">{{ compareA === panel.poi.id ? 'Fijada como A' : 'Fijar para comparar' }}</button>
              <button type="button" @click="exportStore">Exportar PNG</button>
              <button type="button" @click="copyLink">{{ copied ? 'Enlace copiado' : 'Copiar enlace' }}</button>
              <button type="button" @click="selection.clear()">Cerrar</button>
            </div>
          </section>

          <section v-if="comparison">
            <h5>Comparación · {{ comparison.a.label }} vs {{ comparison.b.label }}</h5>
            <table class="dash-table">
              <thead><tr><th></th><th>{{ comparison.a.label }}</th><th>{{ comparison.b.label }}</th><th>Δ</th></tr></thead>
              <tbody>
                <tr v-for="r in comparison.rows" :key="r.k">
                  <td>{{ r.label }}</td><td>{{ fmtMetric(r.k, r.a) }}</td><td><b>{{ fmtMetric(r.k, r.b) }}</b></td>
                  <td :data-tone="r.b >= r.a ? 'positive' : 'negative'">{{ r.k === 'sales' ? formatBadge(r.b - r.a) : `${((r.b - r.a) * 100).toFixed(1)} pp` }}</td>
                </tr>
              </tbody>
            </table>
            <p class="dash-hint">Distancia entre ambas: {{ comparison.distance.toFixed(0) }} u. <a href="#" @click.prevent="routeTo(comparison.a.id)">Trazar ruta</a>.</p>
          </section>
          <section v-else-if="compareA && compareA !== panel.poi.id" class="dash-hint">Tienda A fijada. Selecciona otra tienda para compararla.</section>

          <section>
            <h5>Tiendas vecinas</h5>
            <ul class="dash-list dash-neighbors">
              <li v-for="n in neighbors" :key="n.poi.id">
                <span @click="selection.select(n.poi.id)">{{ n.poi.label }}</span>
                <small>{{ n.distance.toFixed(0) }} u</small>
                <b v-if="n.datum">{{ formatBadge(n.datum.sales as number) }}</b>
                <button type="button" class="dash-mini" @click="routeTo(n.poi.id)">Ruta</button>
              </li>
            </ul>
          </section>
          <p v-if="multi" class="dash-hint">{{ selection.count.value }} seleccionadas. Con dos o más, la ruta más corta entre las dos últimas se dibuja en 2D y 3D.</p>
        </div>
        <div v-else class="dash-detail-body dash-hint">
          <p>Haz clic en una tienda en la vista 3D (o Tab + flechas + Enter) para desplegar el callout en la escena y este panel: histórico de 12 meses, puesto en el ranking, comparativa frente a distrito y red, stock, acciones de cámara, aislamiento, comparación entre dos tiendas, rutas a vecinas, exportación y enlace.</p>
          <p>La selección vive en la URL.</p>
        </div>
      </aside>

      <CitySketchCard
        title="Cobertura y huecos"
        :subtitle="`Radio ${COVER_RADIUS} u por tienda · ${coverPct.toFixed(0)} % del suelo cubierto · candidatos numerados`"
        :model="modelBound"
        :theme="THEME_PRESETS['city-day']"
        :isochrones="coverage"
        :poi-overrides="binding.overrides.value"
        :show-lots="false"
        :show-labels="false"
        :view-toggle="false"
        :exportable="false"
        aspect="4 / 3"
        @store:select="onSelect($event.id)"
      >
        <template #overlay>
          <g class="dash-gaps">
            <g v-for="(g, i) in gaps" :key="g.lotId ?? i" :transform="`translate(${g.point[0].toFixed(1)} ${g.point[1].toFixed(1)})`">
              <circle r="14" class="dash-gap-halo" />
              <circle r="8" class="dash-gap" />
              <text y="0.5" class="dash-gap-n">{{ i + 1 }}</text>
            </g>
          </g>
        </template>
        <template #footer>
          <ol class="dash-list dash-gaps-list">
            <li v-for="(g, i) in gaps" :key="g.lotId ?? i">
              <span>Candidato {{ i + 1 }}</span><small>{{ g.distance.toFixed(0) }} u a la tienda más cercana</small><b>{{ (g.score * 100).toFixed(0) }}</b>
            </li>
          </ol>
        </template>
      </CitySketchCard>

      <section class="cs-card dash-pairs">
        <header class="cs-card-header">
          <div class="cs-card-titles">
            <h3 class="cs-card-title">Canibalización</h3>
            <p class="cs-card-subtitle">Pares con más solapamiento de cobertura; clic para verlos en el mapa</p>
          </div>
        </header>
        <ul class="dash-list dash-pairs-list">
          <li v-for="p in pairs" :key="p.a + p.b" :class="{ on: selection.has(p.a) && selection.has(p.b) }" @click="showPair(p.a, p.b, p.polygon)">
            <span>{{ labelOf(p.a) }} · {{ labelOf(p.b) }}</span>
            <i class="dash-bar" :style="`--w:${(p.ratio * 100).toFixed(0)}%`" />
            <b>{{ (p.ratio * 100).toFixed(0) }} %</b>
          </li>
          <li v-if="!pairs.length" class="dash-hint">Sin solapamientos relevantes.</li>
        </ul>
      </section>

      <section class="cs-card dash-districts">
        <header class="cs-card-header">
          <div class="cs-card-titles">
            <h3 class="cs-card-title">Ventas por distrito</h3>
            <p class="cs-card-subtitle">Suma de ventas de las tiendas de cada distrito; clic para seleccionarlas</p>
          </div>
        </header>
        <ul class="dash-list dash-districts-list">
          <li v-for="(d, i) in districts" :key="d.district.id" @click="selection.setMode('multi'); selection.selectWhere((p) => d.pois.some((q) => q.id === p.id))">
            <span><i class="dash-swatch" :style="`--sw:${districtColors[i % districtColors.length]}`" />{{ d.district.name }}</span>
            <i class="dash-bar" :style="`--w:${((d.total / maxDistrict) * 100).toFixed(0)}%;--bar:${districtColors[i % districtColors.length]}`" />
            <b>{{ formatBadge(d.total) }}</b>
            <small>{{ d.pois.length }} tiendas</small>
          </li>
        </ul>
      </section>

      <CitySketchCard
        title="Conversión por manzana"
        subtitle="Tasa media 0–9 %, difuminada por distrito"
        :model="modelBound"
        :theme="THEME_PRESETS['minimal-mono']"
        :heat="heat"
        :filter="new Set()"
        :show-lots="false"
        :show-labels="false"
        :view-toggle="false"
        :exportable="false"
        aspect="4 / 3"
      />

      <section class="cs-card span-2 dash-compare">
        <header class="cs-card-header">
          <div class="cs-card-titles">
            <h3 class="cs-card-title">Comparación de periodos</h3>
            <p class="cs-card-subtitle">Mismo croquis; tamaño = ventas, color = margen</p>
          </div>
        </header>
        <div class="dash-compare-body">
          <CitySketchCompare
            :model="modelBound"
            :theme="THEME_PRESETS['retail-warm']"
            :left="{ title: 'Agosto 2026', poiOverrides: bindingAug.overrides.value }"
            :right="{ title: 'Septiembre 2026', poiOverrides: bindingSep.overrides.value }"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style>
/* Direccion: ancla Organic. Arena, salvia y arcilla; Fraunces + Epilogue; radios 24 px; grano al 2 %. */
.dash {
  --d-sand: #e8dcc7;
  --d-oat: #d4b895;
  --d-sage: #8b9d83;
  --d-clay: #b08b6e;
  --d-terracotta: #c66b3d;
  --d-moss: #606c38;
  --d-ink: oklch(28% 0.03 60);
  --d-muted: oklch(44% 0.03 60);
  --d-line: oklch(70% 0.03 75);
  --d-panel: oklch(92% 0.03 80);
  --cs-card-bg: var(--d-panel);
  --cs-card-ink: var(--d-ink);
  --cs-card-line: var(--d-line);
  --cs-card-radius: 24px;
  --cs-card-font: 'Epilogue', system-ui, sans-serif;
  position: relative;
  min-height: 100vh;
  padding: 28px 32px 48px;
  background: var(--d-sand);
  color: var(--d-ink);
  font-family: 'Epilogue', system-ui, sans-serif;
  transition: background 450ms ease, color 450ms ease;
}
.dash[data-phase='dusk'] {
  --d-sand: oklch(36% 0.05 290);
  --d-panel: oklch(42% 0.045 290);
  --d-ink: oklch(94% 0.02 80);
  --d-muted: oklch(80% 0.03 80);
  --d-line: oklch(52% 0.05 290);
}
.dash[data-phase='night'] {
  --d-sand: oklch(20% 0.015 265);
  --d-panel: oklch(26% 0.02 265);
  --d-ink: oklch(92% 0.015 80);
  --d-muted: oklch(74% 0.03 80);
  --d-line: oklch(38% 0.02 265);
}
.dash::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.02;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23g)'/%3E%3C/svg%3E");
}
.dash > * {
  position: relative;
}
.dash-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.dash-head h1 {
  margin: 0 0 4px;
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 600;
  font-size: 34px;
  letter-spacing: -0.015em;
  line-height: 1.05;
}
.dash-head p {
  margin: 0;
  color: var(--d-muted);
  font-size: 13px;
}
.dash-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.dash-seg {
  display: inline-flex;
  border: 1px solid var(--d-line);
  border-radius: 999px;
  overflow: hidden;
  background: var(--d-panel);
}
.dash-seg button {
  font: inherit;
  font-size: 13px;
  padding: 7px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 350ms ease, color 350ms ease;
}
.dash-seg button.on {
  background: var(--d-moss);
  color: var(--d-sand);
}
.dash-toggle {
  font-size: 13px;
  white-space: nowrap;
}
.dash-tour {
  font: inherit;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--d-terracotta);
  color: #fff7ee;
  cursor: pointer;
  transition: background 350ms ease;
}
.dash-tour.on {
  background: var(--d-moss);
}
.dash-tourbar {
  display: grid;
  grid-template-columns: auto 1fr auto auto auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px 18px;
  border-radius: 20px;
  background: var(--d-panel);
  border: 1px solid var(--d-line);
  position: relative;
  overflow: hidden;
  font-size: 13px;
}
.dash-tourbar::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: calc(var(--p) * 100%);
  background: var(--d-sage);
  opacity: 0.25;
  pointer-events: none;
}
.dash-tourbar > * {
  position: relative;
}
.dash-tourbar small {
  color: var(--d-muted);
  font-variant-numeric: tabular-nums;
}
.dash-tourbar button {
  font: inherit;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--d-line);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dash-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.span-2 {
  grid-column: span 2;
}
.dash .cs-card {
  border-color: var(--d-line);
  box-shadow: 0 1px 2px oklch(0% 0 0 / 0.05), 0 12px 32px oklch(20% 0.04 60 / 0.1);
  transition: background 450ms ease, color 450ms ease, border-color 450ms ease;
}
.dash .cs-card-title {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 600;
  font-size: 18px;
}
.dash .cs-kpi-value {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 600;
}
.dash-list {
  list-style: none;
  padding: 0 14px;
  margin: 0 0 8px;
}
.dash-list li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid var(--d-line);
  cursor: pointer;
  font-size: 13px;
}
.dash-list li.on {
  color: var(--d-terracotta);
}
.dash-list small {
  color: var(--d-muted);
}
.dash-list b {
  font-variant-numeric: tabular-nums;
}
.dash-bar {
  display: block;
  width: 90px;
  height: 6px;
  border-radius: 999px;
  background: var(--d-line);
  position: relative;
  overflow: hidden;
}
.dash-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  width: var(--w);
  border-radius: 999px;
  background: var(--bar, var(--d-terracotta));
}
.dash-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--sw);
  margin-right: 6px;
  vertical-align: -1px;
}
.dash-pairs-list li,
.dash-districts-list li {
  grid-template-columns: 1fr auto auto auto;
}
.dash-gaps-list {
  padding: 10px 14px 4px;
}
.dash-gaps-list li {
  cursor: default;
}
.dash-route-halo {
  stroke: oklch(98% 0.01 80);
  stroke-width: 7;
  stroke-opacity: 0.85;
}
.dash-route-line {
  stroke: var(--d-terracotta);
  stroke-width: 3.2;
}
.dash-pair {
  fill: oklch(60% 0.2 20 / 0.35);
  stroke: oklch(45% 0.2 20);
  stroke-width: 1;
}
.dash-gap-halo {
  fill: var(--d-terracotta);
  opacity: 0.18;
  animation: dash-breathe 2.8s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}
.dash-gap {
  fill: var(--d-terracotta);
  stroke: #fff7ee;
  stroke-width: 1.5;
}
.dash-gap-n {
  fill: #fff7ee;
  font-size: 9px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: middle;
}
@keyframes dash-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.18;
  }
  50% {
    transform: scale(1.35);
    opacity: 0.08;
  }
}
.dash-detail-body {
  padding: 12px 16px;
  font-size: 13px;
}
.dash-detail-body h4 {
  margin: 0 0 6px;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 18px;
  font-weight: 600;
}
.dash-detail-body h5 {
  margin: 10px 0 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--d-muted);
}
.dash-detail-body dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0 0 8px;
}
.dash-detail-body dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.dash-detail-body .dash-list {
  padding: 0;
}
.dash-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}
.dash-detail-actions button {
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--d-line);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dash-hint {
  color: var(--d-muted);
  font-size: 12px;
}
.dash-route-info {
  font-size: 12px;
  padding: 4px 0;
}
.dash-compare-body {
  padding: 12px 16px;
}
.tt-grid {
  display: grid;
  grid-template-columns: auto auto;
  gap: 1px 10px;
  margin-top: 4px;
}
.tt-grid b {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/* Panel de tienda */
.dash-rank {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 22px;
  font-weight: 700;
  color: var(--d-terracotta);
}
.dash-rank small {
  font-size: 12px;
  color: var(--d-muted);
  font-weight: 500;
}
.dash-panel {
  padding: 8px 16px 14px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: dash-unfold 350ms ease;
}
@keyframes dash-unfold {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
.dash-panel h5 {
  margin: 4px 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--d-muted);
}
.dash-panel-hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-items: end;
  padding: 10px 12px;
  border-radius: 18px;
  background: color-mix(in oklch, var(--d-panel), var(--d-sage) 25%);
}
.dash-panel-label {
  display: block;
  font-size: 11px;
  color: var(--d-muted);
}
.dash-panel-big {
  display: block;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 30px;
  line-height: 1;
  margin: 2px 0 4px;
}
.dash-delta {
  display: block;
  font-size: 11px;
}
.dash-delta[data-tone='positive'],
.dash-table td[data-tone='positive'] {
  color: oklch(45% 0.13 150);
}
.dash-delta[data-tone='negative'],
.dash-table td[data-tone='negative'] {
  color: oklch(50% 0.18 25);
}
.dash[data-phase='dusk'] .dash-delta[data-tone='positive'],
.dash[data-phase='night'] .dash-delta[data-tone='positive'],
.dash[data-phase='dusk'] .dash-table td[data-tone='positive'],
.dash[data-phase='night'] .dash-table td[data-tone='positive'] {
  color: oklch(78% 0.13 150);
}
.dash[data-phase='dusk'] .dash-delta[data-tone='negative'],
.dash[data-phase='night'] .dash-delta[data-tone='negative'],
.dash[data-phase='dusk'] .dash-table td[data-tone='negative'],
.dash[data-phase='night'] .dash-table td[data-tone='negative'] {
  color: oklch(78% 0.15 25);
}
.dash-spark {
  width: 100%;
  height: 64px;
  overflow: visible;
}
.dash-spark-area {
  fill: var(--d-terracotta);
  opacity: 0.15;
}
.dash-spark-line {
  fill: none;
  stroke: var(--d-terracotta);
  stroke-width: 2;
  stroke-linejoin: round;
}
.dash-spark-peak {
  fill: var(--d-panel);
  stroke: var(--d-moss);
  stroke-width: 1.5;
}
.dash-spark-now {
  fill: var(--d-terracotta);
}
.dash-spark-axis {
  font-size: 8px;
  fill: var(--d-muted);
}
.dash-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.dash-table th {
  text-align: right;
  font-weight: 500;
  color: var(--d-muted);
  padding: 2px 0 4px;
}
.dash-table th:first-child,
.dash-table td:first-child {
  text-align: left;
}
.dash-table td {
  text-align: right;
  padding: 4px 0;
  border-top: 1px solid var(--d-line);
  font-variant-numeric: tabular-nums;
}
.dash-stock {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  font-size: 12px;
}
.dash-bar-wide {
  width: auto;
}
.dash-bar[data-state='ok']::after {
  background: var(--cs-status-ok, #0f8a6c);
}
.dash-bar[data-state='warn']::after {
  background: var(--cs-status-warn, #c47a00);
}
.dash-bar[data-state='alert']::after {
  background: var(--cs-status-alert, #d6336c);
}
.dash-actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.dash-actions-grid button,
.dash-mini {
  font: inherit;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--d-line);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 300ms ease, color 300ms ease;
}
.dash-actions-grid button.on {
  background: var(--d-moss);
  color: var(--d-sand);
  border-color: transparent;
}
.dash-mini {
  padding: 2px 8px;
  font-size: 11px;
}
.dash-neighbors li {
  grid-template-columns: 1fr auto auto auto;
}
.dash-neighbors span {
  cursor: pointer;
}
.dash-panel a {
  color: var(--d-terracotta);
}
/* Callout SVG en el mapa 2D */
.dash-callout {
  pointer-events: none;
  animation: dash-unfold 300ms ease;
}
.dash-callout-bg {
  fill: oklch(97% 0.015 85);
  stroke: oklch(42% 0.17 262);
  stroke-width: 0.8;
  filter: drop-shadow(0 2px 3px oklch(0% 0 0 / 0.25));
}
.dash-callout-head {
  fill: oklch(42% 0.17 262);
}
.dash-callout-title {
  font-size: 6.5px;
  font-weight: 700;
  fill: oklch(92% 0.17 95);
}
.dash-callout-k {
  font-size: 6px;
  fill: oklch(40% 0.03 60);
}
.dash-callout-v {
  font-size: 6.5px;
  font-weight: 700;
  text-anchor: end;
  fill: oklch(22% 0.03 60);
  font-variant-numeric: tabular-nums;
}
.dash-callout-track {
  fill: oklch(85% 0.02 80);
}
.dash-callout-fill[data-state='ok'] {
  fill: #0f8a6c;
}
.dash-callout-fill[data-state='warn'] {
  fill: #c47a00;
}
.dash-callout-fill[data-state='alert'] {
  fill: #d6336c;
}
.dash-callout-bar {
  fill: oklch(42% 0.17 262);
  opacity: 0.45;
}
.dash-callout-bar.last {
  opacity: 1;
  fill: oklch(80% 0.17 95);
  stroke: oklch(42% 0.17 262);
  stroke-width: 0.6;
}
@media (prefers-reduced-motion: reduce) {
  .dash-panel,
  .dash-callout {
    animation: none;
  }
  .dash-gap-halo {
    animation: none;
  }
}
@media (max-width: 1100px) {
  .dash-grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: auto;
  }
  .dash {
    padding: 20px 16px 40px;
  }
}
</style>
