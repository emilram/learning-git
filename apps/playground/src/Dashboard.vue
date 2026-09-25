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
const view3d = ref<'2d' | 'iso'>('2d');
watch(model, () => (view3d.value = '2d'));
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
    color: { field: 'margin', scheme: 'diverging', hues: [25, 250, 150] },
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
const isochrones = computed(() => {
  const m = modelBound.value;
  const id = selected.value;
  if (!m || !id) return [];
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

const bindingAug = useStoreBinding(() => poisWithIds.value, () => august, () => ({ size: { field: 'sales', range: [0.6, 2.4] }, color: { field: 'margin', scheme: 'diverging', hues: [25, 250, 150] } }));
const bindingSep = useStoreBinding(() => poisWithIds.value, () => september, () => ({ size: { field: 'sales', range: [0.6, 2.4] }, color: { field: 'margin', scheme: 'diverging', hues: [25, 250, 150] } }));

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

const selectedDatum = computed(() => {
  const poi = selection.primary.value;
  return poi ? { poi, d: datumOf(poi) } : null;
});
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
        :subtitle="`Tamaño = ventas · color = margen · anillo = stock · ${multi ? 'clic para añadir a la selección' : 'clic para isócronas y vecinas'} · en 3D arrastra para orbitar`"
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

      <aside class="cs-card dash-detail">
        <header class="cs-card-header"><h3 class="cs-card-title">Detalle</h3></header>
        <div v-if="selectedDatum" class="dash-detail-body">
          <h4>{{ selectedDatum.poi.label }} <small>{{ selectedDatum.poi.externalId }}</small></h4>
          <p v-if="selectedDistrict" class="dash-hint">Distrito {{ selectedDistrict.name }}</p>
          <dl v-if="selectedDatum.d">
            <dt>Ventas</dt><dd>{{ formatBadge(selectedDatum.d.sales as number) }}</dd>
            <dt>Margen</dt><dd>{{ ((selectedDatum.d.margin as number) * 100).toFixed(1) }} %</dd>
            <dt>Conversión</dt><dd>{{ ((selectedDatum.d.conversion as number) * 100).toFixed(1) }} %</dd>
            <dt>Stock</dt><dd>{{ ((selectedDatum.d.stock as number) * 100).toFixed(0) }} %</dd>
            <dt>Formato</dt><dd>{{ selectedDatum.d.format }}</dd>
          </dl>
          <h5>Tiendas vecinas</h5>
          <ul class="dash-list">
            <li v-for="n in neighbors" :key="n.poi.id" @click="selection.select(n.poi.id)">
              <span>{{ n.poi.label }}</span><small>{{ n.distance.toFixed(0) }} u</small><b v-if="n.datum">{{ formatBadge(n.datum.sales as number) }}</b>
            </li>
          </ul>
          <div class="dash-detail-actions">
            <button type="button" @click="selection.selectNeighborhood(selectedDatum.poi.id, 3)">Seleccionar vecindario</button>
            <button type="button" @click="selection.selectWithin([selectedDatum.poi.x, selectedDatum.poi.y], 200)">Radio 200 u</button>
            <button type="button" @click="selection.clear()">Limpiar</button>
          </div>
          <p v-if="multi" class="dash-hint">{{ selection.count.value }} seleccionadas. Con dos o más, la ruta más corta entre las dos últimas se dibuja en 2D y 3D.</p>
        </div>
        <div v-else class="dash-detail-body dash-hint">Selecciona una tienda con clic o con Tab + flechas + Enter. La selección vive en la URL.</div>
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
@media (prefers-reduced-motion: reduce) {
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
