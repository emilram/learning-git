<script setup lang="ts">
/**
 * Marcadores de tienda: simbolo proporcional (--cs-poi-scale), color (--cs-poi-fill),
 * anillo de estado (--cs-poi-ring) y badge numerico. Slot `marker` para personalizar.
 */
import { computed } from 'vue';
import type { ElementStyle, Poi, Theme } from '../../core/types';

const props = withDefaults(
  defineProps<{
  pois: readonly Poi[];
  theme: Theme;
  prefix: string;
  overrides?: Readonly<Record<string, ElementStyle>> | undefined;
  badges?: ReadonlyMap<string, string> | undefined;
  selectedId?: string | null | undefined;
  hoveredId?: string | null | undefined;
  focusable?: boolean | undefined;
  }>(),
  { focusable: true },
);

defineSlots<{
  marker(props: { poi: Poi; size: number; style: string | undefined; badge: string | undefined; selected: boolean }): unknown;
}>();

const baseSize = computed(() => props.theme.components.poi.size);
const items = computed(() =>
  props.pois.map((p) => {
    const ov = props.overrides?.[p.id] ?? p.overrides;
    const kind = p.kind === 'flagship' ? 1.4 : p.kind === 'kiosk' ? 0.7 : 1;
    return {
      p,
      size: baseSize.value * kind,
      style: ov?.style,
      cls: `cs-poi-marker cs-kind-${p.kind}${ov?.className ? ` ${ov.className}` : ''}${props.selectedId === p.id ? ' cs-selected' : ''}${props.hoveredId === p.id ? ' cs-hovered' : ''}`,
      badge: props.badges?.get(p.id),
    };
  }),
);
</script>

<template>
  <g data-layer="pois">
    <g
      v-for="it in items"
      :key="it.p.id"
      :class="it.cls"
      :transform="`translate(${it.p.x.toFixed(2)} ${it.p.y.toFixed(2)})`"
      :style="it.style"
      :data-id="it.p.id"
      :data-kind="it.p.kind"
      :tabindex="focusable ? 0 : undefined"
      role="button"
      :aria-label="it.badge ? `${it.p.label}: ${it.badge}` : it.p.label"
    >
      <slot name="marker" :poi="it.p" :size="it.size" :style="it.style" :badge="it.badge" :selected="selectedId === it.p.id">
        <g class="cs-poi-scaled">
          <circle class="cs-poi-ring" :r="(it.size * 1.15).toFixed(2)" />
          <circle class="cs-poi" :r="(it.size * 0.7).toFixed(2)" />
          <circle v-if="selectedId === it.p.id" class="cs-poi-selection" :r="(it.size * 1.7).toFixed(2)" />
        </g>
        <g v-if="it.badge" class="cs-badge" :transform="`translate(${(it.size * 0.9).toFixed(1)} ${(-it.size * 0.9).toFixed(1)})`">
          <rect :x="-2" :y="-7" :width="it.badge.length * 5.2 + 5" height="10" rx="5" />
          <text x="0.5" y="0.5">{{ it.badge }}</text>
        </g>
      </slot>
      <title>{{ it.p.label }}</title>
    </g>
  </g>
</template>
