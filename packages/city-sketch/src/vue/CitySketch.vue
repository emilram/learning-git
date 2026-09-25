<script setup lang="ts">
/**
 * CitySketch: renderer SVG reactivo con capas, zoom/pan (d3-zoom), hit-test
 * por quadtree con un unico listener, tooltip, navegacion por teclado,
 * tabla accesible equivalente, animacion de entrada y switch automatico a
 * Canvas para calles y manzanas cuando el modelo supera `canvasThreshold`.
 * En `view="iso"` delega al serializador 3D (string) manteniendo zoom y eventos.
 */
import { computed, nextTick, onScopeDispose, ref, shallowRef, useId, watch } from 'vue';
import type { Block, CityModel, ElementStyle, Poi, Theme } from '../core/types';
import type { IsochroneBand } from '../core/analysis/isochrone';
import { patternDefs, poiSymbolDef, serializeSvg, sketchFilterDef } from '../core/svg/serialize';
import { serializeIsoSvg, type IsoOptions } from '../core/svg/iso';
import { baseStylesheet, themeVariables, variablesToCss } from '../theme/css';
import BlockLayer from './layers/BlockLayer.vue';
import StreetLayer from './layers/StreetLayer.vue';
import LabelLayer from './layers/LabelLayer.vue';
import StoreLayer from './layers/StoreLayer.vue';
import DataOverlayLayer from './layers/DataOverlayLayer.vue';
import CanvasStreetLayer from './layers/CanvasStreetLayer.vue';
import { useHitTest } from './useHitTest';
import { useSketchDimensions } from './useSketchDimensions';
import { useTooltip, type TooltipState } from './useTooltip';
import { prefersReducedMotion, useZoomPan } from './useZoomPan';

const props = withDefaults(
  defineProps<{
    model: CityModel | null;
    theme: Theme;
    view?: '2d' | 'iso' | undefined;
    iso?: Partial<IsoOptions> | undefined;
    showLots?: boolean | undefined;
    showLabels?: boolean | undefined;
    showPois?: boolean | undefined;
    precision?: number | undefined;
    /** Overrides adicionales (p. ej. de useStoreBinding); se combinan con los del modelo. */
    poiOverrides?: Readonly<Record<string, ElementStyle>> | undefined;
    blockOverrides?: Readonly<Record<string, ElementStyle>> | undefined;
    streetOverrides?: Readonly<Record<string, ElementStyle>> | undefined;
    badges?: ReadonlyMap<string, string> | undefined;
    heat?: ReadonlyMap<string, number> | undefined;
    isochrones?: readonly IsochroneBand[] | undefined;
    selectedId?: string | null | undefined;
    zoomable?: boolean | undefined;
    animate?: boolean | undefined;
    /** Elementos a partir de los cuales calles y manzanas pasan a Canvas. */
    canvasThreshold?: number | undefined;
    tooltip?: boolean | undefined;
    /** Ids de POIs visibles (filtro); undefined = todos. */
    filter?: ReadonlySet<string> | null | undefined;
    /** Arrastrar para rotar la camara en vista iso. */
    orbit?: boolean | undefined;
    /** Volar la camara a la tienda seleccionada en vista iso. */
    flyTo?: boolean | undefined;
    /** Fundido entre temas (dia/atardecer/noche) en vista iso. */
    crossfade?: boolean | undefined;
  }>(),
  {
    view: '2d',
    iso: () => ({}),
    showLots: true,
    showLabels: true,
    showPois: true,
    precision: 2,
    zoomable: true,
    animate: true,
    canvasThreshold: 5000,
    tooltip: true,
    selectedId: null,
    filter: null,
    orbit: true,
    flyTo: true,
    crossfade: true,
  },
);

const emit = defineEmits<{
  'store:hover': [payload: { id: string | null; poi: Poi | null; event: PointerEvent }];
  'store:select': [payload: { id: string; poi: Poi; event: Event }];
  /** Boton de un callout 3D (IsoOptions.callout.actions). */
  'store:action': [payload: { id: string | null; action: string; event: Event }];
  'block:select': [payload: { id: string; block: Block; event: Event }];
  'viewport:change': [payload: { k: number; x: number; y: number }];
  'iso:change': [payload: { rotation: number; pitch: number }];
}>();

defineSlots<{
  marker(props: { poi: Poi; size: number; style: string | undefined; badge: string | undefined; selected: boolean }): unknown;
  tooltip(props: { state: TooltipState }): unknown;
  overlay(props: { model: CityModel }): unknown;
}>();

const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
const prefix = computed(() => `cs${uid}`);
const host = ref<HTMLElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const viewportEl = ref<SVGGElement | null>(null);
const dims = useSketchDimensions(host);

const vars = computed(() => variablesToCss(themeVariables(props.theme)));
const css = computed(() => baseStylesheet(`.${prefix.value}-root`));
const defs = computed(
  () => patternDefs(prefix.value) + poiSymbolDef(prefix.value) + (props.theme.sketch.technique === 'filter' ? sketchFilterDef(prefix.value, props.theme.sketch.intensity) : ''),
);
const zoomPan = useZoomPan(svgEl, viewportEl, {
  enabled: props.zoomable,
  onChange: (t) => emit('viewport:change', t),
});
const filterAttr = computed(() => (props.theme.sketch.technique === 'filter' && !zoomPan.zooming.value ? `url(#${prefix.value}-sketch)` : undefined));

const useRough = computed(() => props.theme.sketch.technique === 'rough');
const useString = computed(() => useRough.value || props.view === 'iso');
const mergedPoiOverrides = computed(() => ({ ...(props.model?.meta.params.overrides.pois ?? {}), ...(props.poiOverrides ?? {}) }));
const mergedBlockOverrides = computed(() => ({ ...(props.model?.meta.params.overrides.blocks ?? {}), ...(props.blockOverrides ?? {}) }));
const mergedStreetOverrides = computed(() => ({ ...(props.model?.meta.params.overrides.streets ?? {}), ...(props.streetOverrides ?? {}) }));
const modelWithOverrides = computed<CityModel | null>(() => {
  if (!props.model) return null;
  return { ...props.model, meta: { ...props.model.meta, params: { ...props.model.meta.params, overrides: { pois: mergedPoiOverrides.value, blocks: mergedBlockOverrides.value, streets: mergedStreetOverrides.value } } } };
});
// Orbita: rotacion e inclinacion acumuladas por arrastre (se suman a props.iso).
const orbitRotation = shallowRef(0);
const orbitPitch = shallowRef(0);
const dragging = shallowRef(false);
const flying = shallowRef(false);
const camCenter = shallowRef<readonly [number, number] | null>(null);
const camZoom = shallowRef<number | null>(null);
const isoEffective = computed<Partial<IsoOptions>>(() => {
  const base = props.iso ?? {};
  const rotation = ((base.rotation ?? 35) + orbitRotation.value) % 360;
  const pitch = Math.max(20, Math.min(89, (base.pitch ?? 55) + orbitPitch.value));
  const lowDetail = dragging.value || flying.value || autoOrbit.value;
  return {
    ...base,
    rotation,
    pitch,
    selectedId: props.selectedId ?? base.selectedId ?? null,
    visibleIds: props.filter ?? base.visibleIds ?? null,
    ...(camCenter.value ? { center: camCenter.value } : {}),
    ...(camZoom.value ? { zoom: camZoom.value } : {}),
    ...(lowDetail ? { detail: 'low' as const } : {}),
  };
});
// Vuelo de camara (modo cover): interpola centro y zoom con easing; detalle bajo durante el vuelo.
let flightRaf = 0;
function flyTo(target: readonly [number, number] | null, zoom: number | null, duration = 550): void {
  const m = props.model;
  if (!m) return;
  cancelAnimationFrame(flightRaf);
  const from: readonly [number, number] = camCenter.value ?? [m.bounds.w / 2, m.bounds.h / 2];
  const to: readonly [number, number] = target ?? [m.bounds.w / 2, m.bounds.h / 2];
  const z0 = camZoom.value ?? props.iso?.zoom ?? 1.5;
  const z1 = zoom ?? props.iso?.zoom ?? 1.5;
  if (prefersReducedMotion() || duration <= 0) {
    camCenter.value = target;
    camZoom.value = zoom;
    return;
  }
  flying.value = true;
  const t0 = performance.now();
  const step = (): void => {
    const u = Math.min(1, (performance.now() - t0) / duration);
    const e = 1 - (1 - u) ** 3;
    camCenter.value = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
    camZoom.value = z0 + (z1 - z0) * e;
    if (u < 1) flightRaf = requestAnimationFrame(step);
    else {
      camCenter.value = target;
      camZoom.value = zoom;
      flying.value = false;
    }
  };
  flightRaf = requestAnimationFrame(step);
}
watch(
  () => [props.selectedId, props.view] as const,
  ([id, view]) => {
    if (view !== 'iso' || !props.flyTo || (props.iso?.fit ?? 'contain') !== 'cover') return;
    const poi = id ? poiById.value.get(id) : undefined;
    if (poi) flyTo([poi.x, poi.y], (props.iso?.zoom ?? 1.5) * 1.35);
    else flyTo(null, null);
  },
);
const stringSvg = computed(() => {
  const m = modelWithOverrides.value;
  if (!m || !useString.value) return '';
  if (props.view === 'iso') return serializeIsoSvg(m, props.theme, { ...isoEffective.value, idPrefix: prefix.value });
  return serializeSvg(m, props.theme, { idPrefix: prefix.value });
});
watch(() => [props.iso?.rotation, props.iso?.pitch], () => {
  orbitRotation.value = 0;
  orbitPitch.value = 0;
});
onScopeDispose(() => cancelAnimationFrame(flightRaf));
const stringHtml = computed(() => (typeof stringSvg.value === 'string' ? '' : stringSvg.value.svg));

const visiblePois = computed(() => {
  const pois = props.model?.pois ?? [];
  return props.filter ? pois.filter((p) => props.filter!.has(p.id)) : pois;
});
const elementCount = computed(() => (props.model ? props.model.streets.length * 2 + props.model.blocks.length + props.model.lots.length + props.model.pois.length + props.model.labels.length : 0));
const useCanvas = computed(() => props.view === '2d' && !useRough.value && elementCount.value > props.canvasThreshold);
const viewBox = computed<readonly [number, number, number, number]>(() => (props.model ? [0, 0, props.model.bounds.w, props.model.bounds.h] : [0, 0, 1, 1]));
const animate = computed(() => props.animate && !prefersReducedMotion());
const description = computed(() => (props.model ? `Ciudad sintetica con ${props.model.streets.length} calles, ${props.model.blocks.length} manzanas y ${props.model.pois.length} tiendas.` : 'Sin modelo'));

// Hit-test y tooltip.
const hit = useHitTest(() => props.model);
const tooltip = useTooltip();
const hoveredId = shallowRef<string | null>(null);
const poiById = computed(() => new Map((props.model?.pois ?? []).map((p) => [p.id as string, p])));
const blockById = computed(() => new Map((props.model?.blocks ?? []).map((b) => [b.id as string, b])));

function localPoint(e: PointerEvent | MouseEvent): readonly [number, number] {
  const r = host.value?.getBoundingClientRect();
  return [e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0)];
}
function domTarget(e: Event, selector: string): string | null {
  return (e.target as Element | null)?.closest(selector)?.getAttribute('data-id') ?? null;
}
function resolveHit(e: PointerEvent | MouseEvent): { poi: Poi | null; block: Block | null } {
  if (props.view === 'iso' || useRough.value) {
    const el = e.target as Element | null;
    const pid = domTarget(e, '.cs-poi-marker') ?? el?.closest('.cs-building')?.getAttribute('data-poi') ?? null;
    const bid = pid ? null : (el?.closest('.cs-building')?.getAttribute('data-block') ?? domTarget(e, '.cs-block'));
    return { poi: pid ? (poiById.value.get(pid) ?? null) : null, block: bid ? (blockById.value.get(bid) ?? null) : null };
  }
  const [px, py] = localPoint(e);
  const [mx, my] = zoomPan.toModel(px, py);
  const radius = (props.theme.components.poi.size * 2.2) / zoomPan.transform.value.k;
  const r = hit.hit(mx, my, radius);
  return { poi: r.poi && (!props.filter || props.filter.has(r.poi.id)) ? r.poi : null, block: r.block };
}
// Arrastre para orbitar en vista iso.
let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
function onPointerDown(e: PointerEvent): void {
  if (props.view !== 'iso' || !props.orbit || e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
}
function onPointerUp(): void {
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  if (wasDrag) {
    dragging.value = false;
    emit('iso:change', { rotation: isoEffective.value.rotation ?? 0, pitch: isoEffective.value.pitch ?? 0 });
  }
}
let suppressClick = false;
function onPointerMove(e: PointerEvent): void {
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      dragging.value = true;
      suppressClick = true;
      tooltip.hide(true);
      host.value?.setPointerCapture(drag.id);
    }
    orbitRotation.value += dx * 0.35;
    orbitPitch.value -= dy * 0.2;
    drag.x = e.clientX;
    drag.y = e.clientY;
    return;
  }
  if (zoomPan.zooming.value) return;
  const { poi, block } = resolveHit(e);
  const id = poi?.id ?? null;
  if (id !== hoveredId.value) {
    hoveredId.value = id;
    emit('store:hover', { id, poi, event: e });
  }
  if (props.tooltip) {
    const [px, py] = localPoint(e);
    if (poi || block) tooltip.show(px, py, { poi, block });
    else tooltip.hide();
  }
}
function onPointerLeave(e: PointerEvent): void {
  if (hoveredId.value !== null) {
    hoveredId.value = null;
    emit('store:hover', { id: null, poi: null, event: e });
  }
  tooltip.hide(true);
}
function onClick(e: MouseEvent): void {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const actionEl = (e.target as Element | null)?.closest('[data-cs-action]');
  if (actionEl) {
    emit('store:action', { id: props.selectedId ?? null, action: actionEl.getAttribute('data-cs-action') ?? '', event: e });
    return;
  }
  const { poi, block } = resolveHit(e);
  if (poi) emit('store:select', { id: poi.id, poi, event: e });
  else if (block) emit('block:select', { id: block.id, block, event: e });
}
// Navegacion por teclado entre tiendas (orden por calle y posicion).
const ordered = computed(() => [...visiblePois.value].sort((a, b) => (a.streetId ?? '').localeCompare(b.streetId ?? '') || a.x - b.x || a.y - b.y));
function onKeydown(e: KeyboardEvent): void {
  const actionEl = (e.target as Element | null)?.closest('[data-cs-action]');
  if (actionEl && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    emit('store:action', { id: props.selectedId ?? null, action: actionEl.getAttribute('data-cs-action') ?? '', event: e });
    return;
  }
  const target = (e.target as Element | null)?.closest('.cs-poi-marker');
  if (!target) return;
  const id = target.getAttribute('data-id');
  const idx = ordered.value.findIndex((p) => p.id === id);
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = ordered.value[(idx + dir + ordered.value.length) % ordered.value.length];
    if (next) (host.value?.querySelector(`.cs-poi-marker[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const poi = id ? poiById.value.get(id) : undefined;
    if (poi) emit('store:select', { id: poi.id, poi, event: e });
  }
}

watch(
  () => props.selectedId,
  async (id) => {
    if (!id || !props.model || props.view !== '2d') return;
    await nextTick();
    const poi = poiById.value.get(id);
    if (poi && props.zoomable) zoomPan.zoomTo(Math.max(zoomPan.transform.value.k, 1.6), poi.x, poi.y);
  },
);

const tooltipState = computed(() => tooltip.state.value);

function setOrbit(rotation: number, pitch: number, resetCenter = true): void {
  orbitRotation.value = rotation - (props.iso?.rotation ?? 35);
  orbitPitch.value = pitch - (props.iso?.pitch ?? 55);
  if (resetCenter) flyTo(null, null, 400);
}
/** Incremento relativo de camara (para autorotacion) sin tocar el centro. Baja el detalle mientras dure el movimiento. */
let orbitTimer: ReturnType<typeof setTimeout> | null = null;
const autoOrbit = shallowRef(false);
function orbitBy(dRotation: number, dPitch = 0): void {
  orbitRotation.value += dRotation;
  orbitPitch.value += dPitch;
  autoOrbit.value = true;
  if (orbitTimer) clearTimeout(orbitTimer);
  orbitTimer = setTimeout(() => (autoOrbit.value = false), 220);
}
function getOrbit(): { rotation: number; pitch: number } {
  return { rotation: isoEffective.value.rotation ?? 0, pitch: isoEffective.value.pitch ?? 0 };
}

// Crossfade al cambiar de tema en vista iso: la imagen anterior se desvanece encima de la nueva.
const fadeHtml = shallowRef('');
let fadeTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => props.theme.name,
  (_n, _o) => {
    if (!props.crossfade || props.view !== 'iso' || !stringHtml.value || prefersReducedMotion()) return;
    fadeHtml.value = stringHtml.value;
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => (fadeHtml.value = ''), 700);
  },
  { flush: 'sync' },
);
onScopeDispose(() => {
  if (fadeTimer) clearTimeout(fadeTimer);
  if (orbitTimer) clearTimeout(orbitTimer);
});

defineExpose({ zoomPan, hostEl: host, svgEl, setOrbit, orbitBy, getOrbit, flyTo, dragging, flying });
</script>

<template>
  <div
    ref="host"
    class="cs-host"
    :class="{ 'cs-view-iso': view === 'iso', 'cs-orbit': view === 'iso' && orbit, 'cs-dragging': dragging }"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @click="onClick"
    @keydown="onKeydown"
  >
    <CanvasStreetLayer v-if="model && useCanvas" :model="model" :theme="theme" :width="dims.width.value" :height="dims.height.value" :transform="zoomPan.transform.value" :view-box="viewBox" />
    <div v-if="model && useString" class="cs-string-host" v-html="stringHtml" />
    <div v-if="fadeHtml" class="cs-string-host cs-fade-out" aria-hidden="true" v-html="fadeHtml" />
    <svg
      v-else-if="model"
      ref="svgEl"
      :class="[`${prefix}-root`, 'cs-svg', { 'cs-over-canvas': useCanvas, 'cs-animate': animate }]"
      :viewBox="viewBox.join(' ')"
      :style="vars"
      role="img"
      :aria-labelledby="`${prefix}-title ${prefix}-desc`"
      preserveAspectRatio="xMidYMid meet"
    >
      <title :id="`${prefix}-title`">Croquis {{ model.seed }}</title>
      <desc :id="`${prefix}-desc`">{{ description }}</desc>
      <component :is="'style'">{{ css }}</component>
      <defs v-html="defs" />
      <g ref="viewportEl" class="cs-viewport">
        <g v-if="!useCanvas" data-layer="canvas"><rect class="cs-canvas" x="0" y="0" :width="model.bounds.w" :height="model.bounds.h" /></g>
        <BlockLayer v-if="!useCanvas" :blocks="model.blocks" :theme="theme" :prefix="prefix" :precision="precision" :overrides="mergedBlockOverrides" :selected-id="selectedId" />
        <DataOverlayLayer :blocks="model.blocks" :precision="precision" :heat="heat" :isochrones="isochrones" />
        <g v-if="showLots && !useCanvas" data-layer="lots">
          <path v-for="l in model.lots" :key="l.id" class="cs-lot" :d="`M${l.polygon.map((p) => `${p[0].toFixed(precision)} ${p[1].toFixed(precision)}`).join('L')}Z`" :data-id="l.id" />
        </g>
        <g :filter="filterAttr">
          <StreetLayer v-if="!useCanvas" :streets="model.streets" :theme="theme" :precision="precision" :overrides="mergedStreetOverrides" :animate="animate" />
        </g>
        <LabelLayer v-if="showLabels" :labels="model.labels" :prefix="prefix" :precision="precision" />
        <StoreLayer v-if="showPois" :pois="visiblePois" :theme="theme" :prefix="prefix" :overrides="mergedPoiOverrides" :badges="badges" :selected-id="selectedId" :hovered-id="hoveredId">
          <template #marker="slotProps"><slot name="marker" v-bind="slotProps" /></template>
        </StoreLayer>
        <g data-layer="overlay"><slot name="overlay" :model="model" /></g>
      </g>
    </svg>
    <div v-else class="cs-empty" aria-busy="true">Generando…</div>

    <!-- Tabla equivalente para lectores de pantalla. -->
    <table v-if="model" class="cs-sr-only">
      <caption>Tiendas del croquis {{ model.seed }}</caption>
      <thead><tr><th>Tienda</th><th>Tipo</th><th>Calle</th><th>Valor</th></tr></thead>
      <tbody>
        <tr v-for="p in visiblePois" :key="p.id">
          <td>{{ p.label }}</td><td>{{ p.kind }}</td><td>{{ model.streets.find((s) => s.id === p.streetId)?.name ?? '' }}</td><td>{{ badges?.get(p.id) ?? '' }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="tooltip && tooltipState.visible" class="cs-tooltip" :style="`left:${tooltipState.x}px;top:${tooltipState.y}px`" role="tooltip">
      <slot name="tooltip" :state="tooltipState">
        <strong v-if="tooltipState.poi">{{ tooltipState.poi.label }}</strong>
        <template v-else-if="tooltipState.block">Manzana {{ tooltipState.block.landUse }}</template>
        <div v-if="tooltipState.poi && badges?.get(tooltipState.poi.id)" class="cs-tooltip-value">{{ badges.get(tooltipState.poi.id) }}</div>
      </slot>
    </div>
  </div>
</template>
