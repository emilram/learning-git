<script setup lang="ts">
/**
 * Calles: casing + relleno. Cuando no hay overrides por calle, las calles de
 * cada clase se funden en un solo <path> (3 nodos en vez de N) para cumplir el
 * presupuesto de render inicial; con overrides se emite un path por calle.
 */
import { computed } from 'vue';
import type { ElementStyle, Street, StreetClass, Theme } from '../../core/types';
import { polylinePath } from '../../core/svg/paths';

const props = defineProps<{
  streets: readonly Street[];
  theme: Theme;
  precision: number;
  overrides?: Readonly<Record<string, ElementStyle>> | undefined;
  /** Animacion de entrada (stroke-dasharray). */
  animate?: boolean | undefined;
  /** Fuerza un path por calle (necesario para hover por calle). */
  perStreet?: boolean | undefined;
}>();

const CLASSES: readonly StreetClass[] = ['avenue', 'street', 'alley'];
const width = (s: Street): number => s.width * props.theme.components.street[s.class].widthScale;
const merged = computed(() => !props.perStreet && !(props.overrides && Object.keys(props.overrides).length));

const grouped = computed(() =>
  CLASSES.map((cls) => {
    const list = props.streets.filter((s) => s.class === cls);
    const w = list.length ? width(list[0]!) : 0;
    return { cls, d: list.map((s) => polylinePath(s.polyline, props.precision)).join(''), w, dash: props.theme.components.street[cls].dash, casing: !!props.theme.components.street[cls].casing, n: list.length };
  }).filter((g) => g.n > 0),
);

const single = computed(() =>
  props.streets.map((s, i) => {
    const ov = props.overrides?.[s.id] ?? s.overrides;
    return {
      s,
      d: polylinePath(s.polyline, props.precision),
      w: width(s),
      cls: `cs-street cs-fill cs-${s.class}${ov?.className ? ` ${ov.className}` : ''}`,
      style: ov?.style,
      dash: props.theme.components.street[s.class].dash,
      casing: !!props.theme.components.street[s.class].casing,
      delay: props.animate ? `${Math.min(1.2, i * 0.004).toFixed(3)}s` : undefined,
    };
  }),
);
</script>

<template>
  <g data-layer="streets-casing">
    <template v-if="merged">
      <path v-for="g in grouped" :key="g.cls" v-show="g.casing" :class="`cs-street cs-casing cs-${g.cls}`" :d="g.d" :stroke-width="(g.w + 1.6).toFixed(2)" />
    </template>
    <template v-else>
      <path v-for="it in single" :key="it.s.id" v-show="it.casing" :class="`cs-street cs-casing cs-${it.s.class}`" :d="it.d" :stroke-width="(it.w + 1.6).toFixed(2)" />
    </template>
  </g>
  <g data-layer="streets" :class="{ 'cs-animate-draw': animate }">
    <template v-if="merged">
      <path v-for="g in grouped" :key="g.cls" :class="`cs-street cs-fill cs-${g.cls}`" :d="g.d" :stroke-width="g.w.toFixed(2)" :stroke-dasharray="animate ? undefined : g.dash" pathLength="1" :data-class="g.cls" />
    </template>
    <template v-else>
      <path
        v-for="it in single"
        :key="it.s.id"
        :class="it.cls"
        :d="it.d"
        :stroke-width="it.w.toFixed(2)"
        :stroke-dasharray="animate ? undefined : it.dash"
        pathLength="1"
        :data-id="it.s.id"
        :data-name="it.s.name"
        :style="[it.style, it.delay ? `animation-delay:${it.delay}` : '']"
      />
    </template>
  </g>
</template>
