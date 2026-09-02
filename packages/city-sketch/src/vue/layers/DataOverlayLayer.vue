<script setup lang="ts">
/**
 * Overlays de datos: heatmap por manzana (solo tasas 0..1) e isocronas
 * sinteticas de cobertura por tienda. Se dibuja bajo las calles para no
 * tapar la trama, con mezcla multiply.
 */
import { computed } from 'vue';
import { polygonPath } from '../../core/svg/paths';
import type { Block, Polygon } from '../../core/types';
import type { IsochroneBand } from '../../core/analysis/isochrone';

const props = defineProps<{
  blocks: readonly Block[];
  precision: number;
  /** Tasa 0..1 por id de manzana. */
  heat?: ReadonlyMap<string, number> | undefined;
  /** Tono OKLCH del heatmap. */
  heatHue?: number | undefined;
  isochrones?: readonly IsochroneBand[] | undefined;
  isoHue?: number | undefined;
}>();

const heatItems = computed(() => {
  if (!props.heat) return [];
  const hue = props.heatHue ?? 40;
  const out: { id: string; d: string; fill: string }[] = [];
  for (const b of props.blocks) {
    const v = props.heat.get(b.id);
    if (v === undefined || b.landUse === 'water') continue;
    const t = Math.max(0, Math.min(1, v));
    out.push({ id: b.id, d: polygonPath(b.outline, props.precision), fill: `oklch(${(96 - t * 42).toFixed(0)}% ${(0.02 + t * 0.15).toFixed(3)} ${hue})` });
  }
  return out;
});

const isoItems = computed(() => {
  if (!props.isochrones?.length) return [];
  const hue = props.isoHue ?? 250;
  // Bandas grandes primero para que las pequenas queden encima.
  return [...props.isochrones]
    .sort((a, b) => b.distance - a.distance)
    .map((band, i, arr) => {
      const rank = arr.filter((x) => x.poiId === band.poiId).findIndex((x) => x === band);
      return { key: `${band.poiId}-${band.distance}`, d: polygonPath(band.polygon as Polygon, props.precision), fill: `oklch(70% 0.14 ${hue} / ${(0.12 + rank * 0.1).toFixed(2)})`, i };
    });
});
</script>

<template>
  <g data-layer="overlay-data" class="cs-overlay">
    <g v-if="heatItems.length" class="cs-heat" style="mix-blend-mode: multiply">
      <path v-for="h in heatItems" :key="h.id" :d="h.d" :fill="h.fill" :data-id="h.id" />
    </g>
    <g v-if="isoItems.length" class="cs-isochrones">
      <path v-for="b in isoItems" :key="b.key" :d="b.d" :fill="b.fill" class="cs-isochrone" />
    </g>
  </g>
</template>
