<script setup lang="ts">
/**
 * Dashboard de ejemplo: grid de cards con 40 tiendas simuladas enlazadas por
 * externalId, metricas → tamano/color/anillo/badge/altura, heatmap, isocronas,
 * comparacion de periodos, seleccion sincronizada con la URL y vista 3D.
 */
import { computed, ref, watch } from 'vue';
import { CitySketchCard, CitySketchCompare, useCityModel, useStoreBinding, useUrlState, computeIsochrones, formatBadge, type StoreDatum, type Kpi } from '@empresa/city-sketch/vue';
import { THEME_PRESETS } from '@empresa/city-sketch/theme';
import { createRng, type PoiSpec } from '@empresa/city-sketch';

// 40 tiendas con id externo estable; se colocan en modo auto pero con ids fijos.
const STORE_IDS = Array.from({ length: 40 }, (_, i) => `S-${String(i + 1).padStart(3, '0')}`);
const items: PoiSpec[] = [];
const input = computed(() => ({ seed: 'retail-mx-2026', mode: 'tensor' as const, size: { w: 1200, h: 900 }, pois: { count: 40, minSpacing: 55, items } }));
const { model, generating, lastMs } = useCityModel(input);

// Datos simulados de dos periodos (deterministas por semilla).
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

// Asignar externalId a los POIs generados en orden estable.
const poisWithIds = computed(() => (model.value ? model.value.pois.map((p, i) => ({ ...p, externalId: STORE_IDS[i] })) : []));
const modelBound = computed(() => (model.value ? { ...model.value, pois: poisWithIds.value } : null));

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
const isoOptions = computed(() => ({
  rotation: 30,
  pitch: 55,
  fit: 'cover' as const,
  zoom: 1.35,
  lotHeight: (_lot: unknown, block: { density: number }, poi: { id: string } | null) => (poi ? (heights.value.get(poi.id) ?? 20) : 4 + block.density * 10),
}));

// Heatmap de conversion por manzana: media de las tiendas de la manzana, difuminada a vecinas por distrito.
const heat = computed(() => {
  const m = modelBound.value;
  if (!m) return new Map<string, number>();
  const byPoi = new Map(september.map((d) => [d.id, d.conversion as number]));
  const lotBlock = new Map(m.lots.map((l) => [l.id, l.blockId]));
  const acc = new Map<string, number[]>();
  for (const p of m.pois) {
    const blockId = p.anchor.kind === 'lot' ? lotBlock.get(p.anchor.lotId) : undefined;
    const v = byPoi.get(p.externalId ?? '');
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

// Isocronas de la tienda seleccionada.
const url = useUrlState({ prefix: 'dash' });
const selected = computed(() => url.selected.value);
const isochrones = computed(() => {
  const m = modelBound.value;
  const id = selected.value;
  if (!m || !id) return [];
  const poi = m.pois.find((p) => p.id === id);
  return poi ? computeIsochrones(m, [poi], [120, 240, 360]) : [];
});

// Filtro por formato sincronizado con la URL.
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
    { label: 'Alertas stock', value: String(alerts), tone: alerts > 3 ? 'negative' : 'neutral' },
  ];
});

// Comparacion: dos periodos con la misma ciudad.
const bindingAug = useStoreBinding(
  () => poisWithIds.value,
  () => august,
  () => ({ size: { field: 'sales', range: [0.6, 2.4] }, color: { field: 'margin', scheme: 'diverging', hues: [25, 250, 150] } }),
);
const bindingSep = useStoreBinding(
  () => poisWithIds.value,
  () => september,
  () => ({ size: { field: 'sales', range: [0.6, 2.4] }, color: { field: 'margin', scheme: 'diverging', hues: [25, 250, 150] } }),
);

const selectedDatum = computed(() => {
  const poi = poisWithIds.value.find((p) => p.id === selected.value);
  return poi ? { poi, d: september.find((x) => x.id === poi.externalId) } : null;
});
const view3d = ref<'2d' | 'iso'>('2d');
watch(model, () => (view3d.value = '2d'));
</script>

<template>
  <div class="dash">
    <header class="dash-head">
      <div>
        <h1>Red de tiendas · Septiembre 2026</h1>
        <p>40 tiendas simuladas sobre una ciudad sintética (semilla <code>retail-mx-2026</code>). Generación {{ lastMs.toFixed(0) }} ms{{ generating ? ', regenerando…' : '' }}.</p>
      </div>
      <label class="dash-toggle"><input v-model="onlyFlagship" type="checkbox" /> Solo flagship</label>
    </header>

    <div class="dash-grid">
      <CitySketchCard
        class="span-2"
        title="Ventas por tienda"
        subtitle="Tamaño = ventas · color = margen · anillo = stock · clic para isócronas"
        :model="modelBound"
        :theme="THEME_PRESETS['retail-warm']"
        :kpis="kpis"
        :poi-overrides="binding.overrides.value"
        :badges="binding.badges.value"
        :legend="binding.legend.value"
        :isochrones="isochrones"
        :selected-id="selected"
        :filter="filter"
        :iso="isoOptions"
        :generating="generating"
        @store:select="url.selected.value = $event.id === url.selected.value ? null : $event.id"
        @update:view="view3d = $event"
      >
        <template #tooltip="{ state }">
          <template v-if="state.poi">
            <strong>{{ state.poi.label }}</strong> <small>{{ state.poi.externalId }}</small>
            <div v-if="september.find((d) => d.id === state.poi?.externalId)" class="tt-grid">
              <span>Ventas</span><b>{{ formatBadge(september.find((d) => d.id === state.poi?.externalId)!.sales as number) }}</b>
              <span>Margen</span><b>{{ ((september.find((d) => d.id === state.poi?.externalId)!.margin as number) * 100).toFixed(1) }} %</b>
              <span>Stock</span><b>{{ ((september.find((d) => d.id === state.poi?.externalId)!.stock as number) * 100).toFixed(0) }} %</b>
            </div>
          </template>
          <template v-else-if="state.block">Manzana {{ state.block.landUse }} · densidad {{ (state.block.density * 100).toFixed(0) }} %</template>
        </template>
      </CitySketchCard>

      <CitySketchCard
        title="Conversión por manzana"
        subtitle="Heatmap de tasa (0–9 %), sin tiendas"
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

      <CitySketchCard
        title="Vista 3D · altura = ventas"
        subtitle="dark-ops · rotación 30° · lotHeight desde useStoreBinding"
        :model="modelBound"
        :theme="THEME_PRESETS['dark-ops']"
        view="iso"
        :iso="isoOptions"
        :poi-overrides="binding.overrides.value"
        :selected-id="selected"
        :view-toggle="false"
        aspect="4 / 3"
        @store:select="url.selected.value = $event.id"
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
            :theme="THEME_PRESETS['minimal-mono']"
            :left="{ title: 'Agosto 2026', poiOverrides: bindingAug.overrides.value }"
            :right="{ title: 'Septiembre 2026', poiOverrides: bindingSep.overrides.value }"
          />
        </div>
      </section>

      <aside class="cs-card dash-detail">
        <header class="cs-card-header"><h3 class="cs-card-title">Detalle</h3></header>
        <div v-if="selectedDatum" class="dash-detail-body">
          <h4>{{ selectedDatum.poi.label }} <small>{{ selectedDatum.poi.externalId }}</small></h4>
          <dl v-if="selectedDatum.d">
            <dt>Ventas</dt><dd>{{ formatBadge(selectedDatum.d.sales as number) }}</dd>
            <dt>Margen</dt><dd>{{ ((selectedDatum.d.margin as number) * 100).toFixed(1) }} %</dd>
            <dt>Conversión</dt><dd>{{ ((selectedDatum.d.conversion as number) * 100).toFixed(1) }} %</dd>
            <dt>Stock</dt><dd>{{ ((selectedDatum.d.stock as number) * 100).toFixed(0) }} %</dd>
            <dt>Formato</dt><dd>{{ selectedDatum.d.format }}</dd>
          </dl>
          <p class="dash-hint">Las isócronas (120/240/360 unidades por calle) se dibujan en la card principal. La selección vive en la URL (<code>?dash.sel=…</code>).</p>
        </div>
        <div v-else class="dash-detail-body dash-hint">Selecciona una tienda con clic o con Tab + flechas + Enter.</div>
      </aside>
    </div>
  </div>
</template>

<style>
.dash {
  padding: 24px;
  max-width: 1500px;
  margin: 0 auto;
}
.dash-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 16px;
}
.dash-head h1 {
  margin: 0 0 4px;
  font-size: 22px;
  letter-spacing: -0.02em;
}
.dash-head p {
  margin: 0;
  color: var(--pg-muted);
  font-size: 13px;
}
.dash-toggle {
  font-size: 13px;
  white-space: nowrap;
}
.dash-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.span-2 {
  grid-column: span 2;
}
.dash-compare-body {
  padding: 12px 14px;
}
.dash-detail-body {
  padding: 12px 14px;
  font-size: 13px;
}
.dash-detail-body h4 {
  margin: 0 0 8px;
}
.dash-detail-body dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0 0 12px;
}
.dash-detail-body dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.dash-hint {
  color: var(--pg-muted);
  font-size: 12px;
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
@media (max-width: 1000px) {
  .dash-grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: auto;
  }
}
</style>
