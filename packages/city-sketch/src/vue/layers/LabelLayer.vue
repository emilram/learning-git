<script setup lang="ts">
import type { Label } from '../../core/types';
import { polylinePath } from '../../core/svg/paths';

defineProps<{
  labels: readonly Label[];
  prefix: string;
  precision: number;
}>();
</script>

<template>
  <g data-layer="labels" aria-hidden="true">
    <template v-for="l in labels" :key="l.id">
      <path :id="`${prefix}-${l.id}-p`" class="cs-label-path" :d="polylinePath(l.path, precision)" />
      <text class="cs-label" :font-size="l.fontSize" :data-id="l.id">
        <textPath :href="`#${prefix}-${l.id}-p`" :startOffset="`${l.startOffset}%`">{{ l.text }}</textPath>
      </text>
    </template>
  </g>
</template>
