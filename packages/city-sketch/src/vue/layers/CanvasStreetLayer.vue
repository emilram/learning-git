<script setup lang="ts">
/**
 * Fallback Canvas para > 5000 elementos: pinta manzanas y calles en un
 * <canvas> alineado bajo el SVG (que conserva POIs, overlays y etiquetas).
 * Repinta en cada cambio de viewport con requestAnimationFrame.
 */
import { onMounted, ref, watch } from 'vue';
import type { CityModel, Theme } from '../../core/types';
import { resolveColor } from '../../theme/css';

const props = defineProps<{
  model: CityModel;
  theme: Theme;
  width: number;
  height: number;
  transform: { k: number; x: number; y: number };
  viewBox: readonly [number, number, number, number];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let raf = 0;

function draw(): void {
  const c = canvas.value;
  if (!c) return;
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  if (c.width !== Math.round(props.width * dpr) || c.height !== Math.round(props.height * dpr)) {
    c.width = Math.round(props.width * dpr);
    c.height = Math.round(props.height * dpr);
  }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const [vx, vy, vw, vh] = props.viewBox;
  const s = Math.min(props.width / vw, props.height / vh);
  const ox = (props.width - vw * s) / 2;
  const oy = (props.height - vh * s) / 2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, props.width, props.height);
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  ctx.translate(-vx, -vy);
  ctx.translate(props.transform.x, props.transform.y);
  ctx.scale(props.transform.k, props.transform.k);
  const t = props.theme;
  ctx.fillStyle = resolveColor(t, t.components.canvas.background);
  ctx.fillRect(0, 0, props.model.bounds.w, props.model.bounds.h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const b of props.model.blocks) {
    const comp = t.components.block[b.landUse];
    ctx.fillStyle = resolveColor(t, comp.fill);
    ctx.strokeStyle = resolveColor(t, comp.stroke);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    b.polygon.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  const pass = (casing: boolean): void => {
    for (const st of props.model.streets) {
      const comp = t.components.street[st.class];
      if (casing && !comp.casing) continue;
      ctx.strokeStyle = resolveColor(t, casing ? comp.casing! : comp.stroke);
      ctx.lineWidth = st.width * comp.widthScale + (casing ? 1.6 : 0);
      ctx.setLineDash(!casing && comp.dash ? comp.dash.split(' ').map(Number) : []);
      ctx.beginPath();
      st.polyline.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
    }
  };
  pass(true);
  pass(false);
}

function schedule(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}
onMounted(schedule);
watch(() => [props.model, props.theme, props.width, props.height, props.transform, props.viewBox], schedule, { deep: false });
</script>

<template>
  <canvas ref="canvas" class="cs-canvas-layer" :style="`width:${width}px;height:${height}px`" aria-hidden="true" />
</template>
