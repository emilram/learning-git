<script setup lang="ts">
/**
 * Modo comparacion: dos paneles lado a lado con el mismo layout (mismo modelo o
 * misma semilla) y datos distintos. Los eventos de hover/seleccion se
 * sincronizan entre ambos.
 */
import { ref } from 'vue';
import type { CityModel, ElementStyle, Poi, Theme } from '../core/types';
import type { IsoOptions } from '../core/svg/iso';
import CitySketch from './CitySketch.vue';

export interface ComparePanel {
  readonly title: string;
  readonly model?: CityModel | null;
  readonly poiOverrides?: Readonly<Record<string, ElementStyle>>;
  readonly blockOverrides?: Readonly<Record<string, ElementStyle>>;
  readonly badges?: ReadonlyMap<string, string>;
  readonly heat?: ReadonlyMap<string, number>;
}

const props = withDefaults(
  defineProps<{
    model: CityModel | null;
    theme: Theme;
    left: ComparePanel;
    right: ComparePanel;
    view?: '2d' | 'iso' | undefined;
    iso?: Partial<IsoOptions> | undefined;
    showLabels?: boolean | undefined;
  }>(),
  { view: '2d', iso: () => ({}), showLabels: false },
);

const emit = defineEmits<{
  'store:select': [payload: { id: string; poi: Poi; side: 'left' | 'right' }];
}>();

const hovered = ref<string | null>(null);
const selected = ref<string | null>(null);
const panels = [
  { key: 'left' as const, get: () => props.left },
  { key: 'right' as const, get: () => props.right },
];
</script>

<template>
  <div class="cs-compare">
    <div v-for="pn in panels" :key="pn.key" class="cs-compare-panel">
      <h4 class="cs-compare-title">{{ pn.get().title }}</h4>
      <CitySketch
        :model="pn.get().model ?? model"
        :theme="theme"
        :view="view"
        :iso="iso"
        :show-labels="showLabels"
        :show-lots="false"
        :poi-overrides="pn.get().poiOverrides"
        :block-overrides="pn.get().blockOverrides"
        :badges="pn.get().badges"
        :heat="pn.get().heat"
        :selected-id="selected"
        :zoomable="false"
        :animate="false"
        @store:hover="hovered = $event.id"
        @store:select="
          selected = $event.id;
          emit('store:select', { id: $event.id, poi: $event.poi, side: pn.key });
        "
      />
    </div>
  </div>
</template>
