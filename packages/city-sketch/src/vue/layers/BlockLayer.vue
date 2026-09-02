<script setup lang="ts">
import { computed } from 'vue';
import type { Block, ElementStyle, Theme } from '../../core/types';
import { polygonPath } from '../../core/svg/paths';

const props = defineProps<{
  blocks: readonly Block[];
  theme: Theme;
  prefix: string;
  precision: number;
  overrides?: Readonly<Record<string, ElementStyle>> | undefined;
  selectedId?: string | null | undefined;
}>();

const items = computed(() =>
  props.blocks.map((b) => {
    const ov = props.overrides?.[b.id] ?? b.overrides;
    return {
      b,
      d: polygonPath(b.polygon, props.precision),
      cls: `cs-block cs-lu-${b.landUse}${ov?.className ? ` ${ov.className}` : ''}${props.selectedId === b.id ? ' cs-selected' : ''}`,
      style: ov?.style,
      pattern: props.theme.components.block[b.landUse].pattern,
    };
  }),
);
</script>

<template>
  <g data-layer="blocks">
    <template v-for="it in items" :key="it.b.id">
      <path :class="it.cls" :d="it.d" :data-id="it.b.id" :data-landuse="it.b.landUse" :style="it.style" />
      <path v-if="it.pattern !== 'none'" class="cs-pattern" :d="it.d" :fill="`url(#${prefix}-${it.pattern})`" :style="`color:var(--cs-block-${it.b.landUse}-stroke)`" />
    </template>
  </g>
</template>
