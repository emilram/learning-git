<script setup lang="ts">
/**
 * Renderer SVG reactivo. Recibe un CityModel (crudo, markRaw) y un Theme.
 * D3 no toca el DOM: Vue pinta cada capa con v-for y keys por id estable.
 */
import { computed, useId } from 'vue';
import type { Block, CityModel, Poi, Street, Theme } from '../core/types';
import { polygonPath, polylinePath } from '../core/svg/paths';
import { patternDefs, poiSymbolDef, serializeSvg, sketchFilterDef } from '../core/svg/serialize';
import { serializeIsoSvg, type IsoOptions } from '../core/svg/iso';
import { baseStylesheet, themeVariables, variablesToCss } from '../theme/css';

const props = withDefaults(
  defineProps<{
    model: CityModel | null;
    theme: Theme;
    showLots?: boolean;
    showLabels?: boolean;
    showPois?: boolean;
    precision?: number;
    /** 2d: render por template. iso: vista 2.5D con edificios (string del serializador). */
    view?: '2d' | 'iso';
    iso?: Partial<IsoOptions>;
  }>(),
  { showLots: true, showLabels: true, showPois: true, precision: 2, view: '2d', iso: () => ({}) },
);

const emit = defineEmits<{
  'store:hover': [payload: { id: string; poi: Poi | null; event: PointerEvent }];
  'store:select': [payload: { id: string; poi: Poi; event: MouseEvent }];
  'block:select': [payload: { id: string; block: Block; event: MouseEvent }];
}>();

const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
const prefix = computed(() => `cs${uid}`);
const vars = computed(() => variablesToCss(themeVariables(props.theme)));
const css = computed(() => baseStylesheet(`.${prefix.value}-root`));
const defs = computed(
  () =>
    patternDefs(prefix.value) +
    poiSymbolDef(prefix.value) +
    (props.theme.sketch.technique === 'filter' ? sketchFilterDef(prefix.value, props.theme.sketch.intensity) : ''),
);
const filterAttr = computed(() => (props.theme.sketch.technique === 'filter' ? `url(#${prefix.value}-sketch)` : undefined));
const useRough = computed(() => props.theme.sketch.technique === 'rough');
const useString = computed(() => useRough.value || props.view === 'iso');
/** Con rough.js o vista iso se delega al serializador (misma salida que la exportacion). */
const roughSvg = computed(() => {
  if (!props.model || !useString.value) return '';
  if (props.view === 'iso') return serializeIsoSvg(props.model, props.theme, { ...props.iso, idPrefix: prefix.value }).svg;
  return serializeSvg(props.model, props.theme, { idPrefix: prefix.value }).svg;
});

const viewBox = computed(() => (props.model ? `0 0 ${props.model.bounds.w} ${props.model.bounds.h}` : '0 0 1 1'));
const description = computed(() =>
  props.model
    ? `Ciudad sintetica con ${props.model.streets.length} calles, ${props.model.blocks.length} manzanas y ${props.model.pois.length} tiendas.`
    : 'Sin modelo',
);

const streetWidth = (s: Street): number => s.width * props.theme.components.street[s.class].widthScale;
const poiSize = (p: Poi): number => {
  const base = props.theme.components.poi.size;
  return p.kind === 'flagship' ? base * 1.4 : p.kind === 'kiosk' ? base * 0.7 : base;
};
const blockPath = (b: Block): string => polygonPath(b.polygon, props.precision);
const streetPath = (s: Street): string => polylinePath(s.polyline, props.precision);

const poiById = computed(() => new Map((props.model?.pois ?? []).map((p) => [p.id as string, p])));
const blockById = computed(() => new Map((props.model?.blocks ?? []).map((b) => [b.id as string, b])));

function targetId(e: Event, selector: string): string | null {
  const el = (e.target as Element | null)?.closest(selector);
  return el?.getAttribute('data-id') ?? null;
}
let lastHover: string | null = null;
function onPointerMove(e: PointerEvent): void {
  const id = targetId(e, '.cs-poi-marker');
  if (id === lastHover) return;
  lastHover = id;
  emit('store:hover', { id: id ?? '', poi: id ? (poiById.value.get(id) ?? null) : null, event: e });
}
function onClick(e: MouseEvent): void {
  const pid = targetId(e, '.cs-poi-marker');
  if (pid) {
    const poi = poiById.value.get(pid);
    if (poi) emit('store:select', { id: pid, poi, event: e });
    return;
  }
  const bid = targetId(e, '.cs-block');
  if (bid) {
    const block = blockById.value.get(bid);
    if (block) emit('block:select', { id: bid, block, event: e });
  }
}
</script>

<template>
  <div v-if="model && useString" class="cs-rough-host" v-html="roughSvg" @pointermove="onPointerMove" @click="onClick" />
  <svg
    v-else-if="model"
    :class="`${prefix}-root cs-svg`"
    :viewBox="viewBox"
    :style="vars"
    role="img"
    :aria-labelledby="`${prefix}-title ${prefix}-desc`"
    preserveAspectRatio="xMidYMid meet"
    @pointermove="onPointerMove"
    @click="onClick"
  >
    <title :id="`${prefix}-title`">Croquis {{ model.seed }}</title>
    <desc :id="`${prefix}-desc`">{{ description }}</desc>
    <component :is="'style'">{{ css }}</component>
    <defs v-html="defs" />
    <g data-layer="canvas"><rect class="cs-canvas" x="0" y="0" :width="model.bounds.w" :height="model.bounds.h" /></g>
    <g data-layer="blocks" :filter="filterAttr">
      <template v-for="b in model.blocks" :key="b.id">
        <path :class="`cs-block cs-lu-${b.landUse}`" :d="blockPath(b)" :data-id="b.id" :data-landuse="b.landUse" />
        <path
          v-if="theme.components.block[b.landUse].pattern !== 'none'"
          class="cs-pattern"
          :d="blockPath(b)"
          :fill="`url(#${prefix}-${theme.components.block[b.landUse].pattern})`"
          :style="`color:var(--cs-block-${b.landUse}-stroke)`"
        />
      </template>
    </g>
    <g v-if="showLots" data-layer="lots">
      <path v-for="l in model.lots" :key="l.id" class="cs-lot" :d="polygonPath(l.polygon, precision)" :data-id="l.id" />
    </g>
    <g data-layer="streets-casing" :filter="filterAttr">
      <template v-for="s in model.streets" :key="s.id">
        <path
          v-if="theme.components.street[s.class].casing"
          :class="`cs-street cs-casing cs-${s.class}`"
          :d="streetPath(s)"
          :stroke-width="(streetWidth(s) + 1.6).toFixed(2)"
        />
      </template>
    </g>
    <g data-layer="streets" :filter="filterAttr">
      <path
        v-for="s in model.streets"
        :key="s.id"
        :class="`cs-street cs-fill cs-${s.class}`"
        :d="streetPath(s)"
        :stroke-width="streetWidth(s).toFixed(2)"
        :stroke-dasharray="theme.components.street[s.class].dash"
        :data-id="s.id"
        :data-name="s.name"
      />
    </g>
    <g v-if="showLabels" data-layer="labels">
      <template v-for="l in model.labels" :key="l.id">
        <path :id="`${prefix}-${l.id}-p`" class="cs-label-path" :d="polylinePath(l.path, precision)" />
        <text class="cs-label" :font-size="l.fontSize" :data-id="l.id">
          <textPath :href="`#${prefix}-${l.id}-p`" :startOffset="`${l.startOffset}%`">{{ l.text }}</textPath>
        </text>
      </template>
    </g>
    <g v-if="showPois" data-layer="pois">
      <slot name="markers" :pois="model.pois" :size="poiSize">
        <use
          v-for="p in model.pois"
          :key="p.id"
          :href="`#${prefix}-poi`"
          :class="`cs-poi-marker cs-kind-${p.kind}`"
          :x="p.x"
          :y="p.y"
          :width="poiSize(p) * 2"
          :height="poiSize(p) * 2"
          :transform="`translate(${-poiSize(p)} ${-poiSize(p)})`"
          :data-id="p.id"
          tabindex="0"
        >
          <title>{{ p.label }}</title>
        </use>
      </slot>
    </g>
    <g data-layer="overlay"><slot name="overlay" :model="model" /></g>
  </svg>
</template>

<style>
.cs-svg,
.cs-rough-host > svg {
  display: block;
  width: 100%;
  height: auto;
}
.cs-poi-marker {
  cursor: pointer;
}
.cs-poi-marker:focus-visible {
  outline: 2px solid var(--cs-accent);
}
</style>
