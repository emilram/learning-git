<script setup lang="ts">
/**
 * CitySketchCard: contenedor con container queries, cabecera, KPIs opcionales,
 * leyenda, acciones (2D/3D, reset zoom, exportar) y el renderer.
 * Toda la card se adapta a su ancho, no al viewport.
 */
import { computed, ref } from 'vue';
import type { CityModel, ElementStyle, Poi, Block, Theme } from '../core/types';
import type { IsoOptions } from '../core/svg/iso';
import type { IsochroneBand } from '../core/analysis/isochrone';
import type { LegendEntry } from './useStoreBinding';
import type { TooltipState } from './useTooltip';
import CitySketch from './CitySketch.vue';
import { downloadPng, exportSvg } from './useExport';

export interface LegendGroups {
  readonly color?: LegendEntry[];
  readonly size?: LegendEntry[];
  readonly status?: LegendEntry[];
}

export interface Kpi {
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
  readonly tone?: 'neutral' | 'positive' | 'negative';
}

const props = withDefaults(
  defineProps<{
    model: CityModel | null;
    theme: Theme;
    title?: string | undefined;
    subtitle?: string | undefined;
    kpis?: readonly Kpi[] | undefined;
    legend?: LegendGroups | undefined;
    legendTitle?: string | undefined;
    view?: '2d' | 'iso' | undefined;
    iso?: Partial<IsoOptions> | undefined;
    poiOverrides?: Readonly<Record<string, ElementStyle>> | undefined;
    blockOverrides?: Readonly<Record<string, ElementStyle>> | undefined;
    streetOverrides?: Readonly<Record<string, ElementStyle>> | undefined;
    badges?: ReadonlyMap<string, string> | undefined;
    heat?: ReadonlyMap<string, number> | undefined;
    isochrones?: readonly IsochroneBand[] | undefined;
    selectedId?: string | null | undefined;
    filter?: ReadonlySet<string> | null | undefined;
    showLots?: boolean | undefined;
    showLabels?: boolean | undefined;
    viewToggle?: boolean | undefined;
    exportable?: boolean | undefined;
    aspect?: string | undefined;
    generating?: boolean | undefined;
  }>(),
  { view: '2d', iso: () => ({}), showLots: true, showLabels: true, viewToggle: true, exportable: true, aspect: '4 / 3', selectedId: null, filter: null, legendTitle: 'Leyenda' },
);

const emit = defineEmits<{
  'store:hover': [payload: { id: string | null; poi: Poi | null; event: PointerEvent }];
  'store:select': [payload: { id: string; poi: Poi; event: Event }];
  'block:select': [payload: { id: string; block: Block; event: Event }];
  'viewport:change': [payload: { k: number; x: number; y: number }];
  'update:view': [view: '2d' | 'iso'];
}>();

defineSlots<{
  header(): unknown;
  actions(): unknown;
  marker(props: { poi: Poi; size: number; style: string | undefined; badge: string | undefined; selected: boolean }): unknown;
  tooltip(props: { state: TooltipState }): unknown;
  legend(props: { legend: LegendGroups | undefined }): unknown;
  footer(): unknown;
}>();

const sketch = ref<InstanceType<typeof CitySketch> | null>(null);
const localView = ref<'2d' | 'iso'>(props.view);
const view = computed({
  get: () => localView.value,
  set: (v) => {
    localView.value = v;
    emit('update:view', v);
  },
});
const hasLegend = computed(() => !!(props.legend && ((props.legend.color?.length ?? 0) + (props.legend.size?.length ?? 0) + (props.legend.status?.length ?? 0)) > 0));

function resetZoom(): void {
  sketch.value?.zoomPan.reset(true);
}
function doExportSvg(): void {
  if (props.model) exportSvg(props.model, props.theme, { view: view.value, iso: props.iso });
}
async function doExportPng(): Promise<void> {
  if (props.model) await downloadPng(props.model, props.theme, { view: view.value, iso: props.iso, scale: 2 });
}
</script>

<template>
  <section class="cs-card" :data-scheme="theme.scheme" :aria-busy="generating || undefined">
    <header class="cs-card-header">
      <slot name="header">
        <div class="cs-card-titles">
          <h3 v-if="title" class="cs-card-title">{{ title }}</h3>
          <p v-if="subtitle" class="cs-card-subtitle">{{ subtitle }}</p>
        </div>
      </slot>
      <div class="cs-card-actions">
        <slot name="actions" />
        <div v-if="viewToggle" class="cs-seg" role="group" aria-label="Vista">
          <button type="button" :class="{ 'cs-on': view === '2d' }" :aria-pressed="view === '2d'" @click="view = '2d'">2D</button>
          <button type="button" :class="{ 'cs-on': view === 'iso' }" :aria-pressed="view === 'iso'" @click="view = 'iso'">3D</button>
        </div>
        <button v-if="view === '2d'" type="button" class="cs-btn" title="Restablecer zoom" @click="resetZoom">⟲</button>
        <button v-if="exportable" type="button" class="cs-btn" title="Exportar SVG" @click="doExportSvg">SVG</button>
        <button v-if="exportable" type="button" class="cs-btn" title="Exportar PNG" @click="doExportPng">PNG</button>
      </div>
    </header>

    <div v-if="kpis?.length" class="cs-kpis">
      <div v-for="k in kpis" :key="k.label" class="cs-kpi" :data-tone="k.tone ?? 'neutral'">
        <span class="cs-kpi-label">{{ k.label }}</span>
        <span class="cs-kpi-value">{{ k.value }}</span>
        <span v-if="k.delta" class="cs-kpi-delta">{{ k.delta }}</span>
      </div>
    </div>

    <div class="cs-card-body" :style="`aspect-ratio:${aspect}`">
      <CitySketch
        ref="sketch"
        :model="model"
        :theme="theme"
        :view="view"
        :iso="iso"
        :show-lots="showLots"
        :show-labels="showLabels"
        :poi-overrides="poiOverrides"
        :block-overrides="blockOverrides"
        :street-overrides="streetOverrides"
        :badges="badges"
        :heat="heat"
        :isochrones="isochrones"
        :selected-id="selectedId"
        :filter="filter"
        @store:hover="emit('store:hover', $event)"
        @store:select="emit('store:select', $event)"
        @block:select="emit('block:select', $event)"
        @viewport:change="emit('viewport:change', $event)"
      >
        <template #marker="p"><slot name="marker" v-bind="p" /></template>
        <template #tooltip="p"><slot name="tooltip" v-bind="p" /></template>
      </CitySketch>
      <div v-if="generating" class="cs-card-loading" aria-hidden="true"><span class="cs-spinner" /></div>
    </div>

    <footer v-if="hasLegend || $slots.footer" class="cs-card-footer">
      <slot name="legend" :legend="legend">
        <div v-if="hasLegend" class="cs-legend" :aria-label="legendTitle">
          <div v-if="legend?.color?.length" class="cs-legend-row">
            <span class="cs-legend-swatch" v-for="e in legend.color" :key="e.label" :style="`--sw:${e.color}`">{{ e.label }}</span>
          </div>
          <div v-if="legend?.size?.length" class="cs-legend-row">
            <span class="cs-legend-size" v-for="e in legend.size" :key="e.label"><i :style="`--sz:${(e.size ?? 1) * 8}px`" />{{ e.label }}</span>
          </div>
          <div v-if="legend?.status?.length" class="cs-legend-row">
            <span class="cs-legend-ring" v-for="e in legend.status" :key="e.label" :style="`--sw:${e.color}`">{{ e.label }}</span>
          </div>
        </div>
      </slot>
      <slot name="footer" />
    </footer>
  </section>
</template>
