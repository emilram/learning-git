/**
 * useZoomPan: d3-zoom sobre el <svg>, aplicando la transformacion al <g class="cs-viewport">.
 * d3-selection se usa solo como adaptador de eventos; Vue sigue siendo dueno del DOM.
 */
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { onScopeDispose, shallowRef, watch, type Ref, type ShallowRef } from 'vue';

export interface ZoomPanOptions {
  readonly minScale?: number;
  readonly maxScale?: number;
  /** Extension de traslacion en coordenadas del viewBox. */
  readonly extent?: readonly [number, number, number, number];
  readonly enabled?: boolean;
  readonly onChange?: (t: { k: number; x: number; y: number }) => void;
}

export interface ZoomPan {
  readonly transform: ShallowRef<{ k: number; x: number; y: number }>;
  readonly zooming: ShallowRef<boolean>;
  reset(animate?: boolean): void;
  zoomTo(k: number, cx: number, cy: number, animate?: boolean): void;
  /** Convierte coordenadas de pantalla (px relativos al svg) a coordenadas del viewBox. */
  toModel(px: number, py: number): readonly [number, number];
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useZoomPan(svg: Ref<SVGSVGElement | null>, viewport: Ref<SVGGElement | null>, options: ZoomPanOptions = {}): ZoomPan {
  const transform = shallowRef({ k: 1, x: 0, y: 0 });
  const zooming = shallowRef(false);
  let behavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let current: ZoomTransform = zoomIdentity;

  const apply = (t: ZoomTransform): void => {
    current = t;
    transform.value = { k: t.k, x: t.x, y: t.y };
    if (viewport.value) viewport.value.setAttribute('transform', `translate(${t.x.toFixed(3)} ${t.y.toFixed(3)}) scale(${t.k.toFixed(4)})`);
    options.onChange?.(transform.value);
  };

  const attach = (): void => {
    if (!svg.value || behavior) return;
    behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([options.minScale ?? 0.5, options.maxScale ?? 8])
      .filter((e: Event) => {
        // Rueda solo con ctrl/meta para no secuestrar el scroll de la pagina; arrastre libre.
        if (e.type === 'wheel') return (e as WheelEvent).ctrlKey || (e as WheelEvent).metaKey;
        return !(e as MouseEvent).button;
      })
      .on('start', () => {
        zooming.value = true;
      })
      .on('zoom', (e: { transform: ZoomTransform }) => apply(e.transform))
      .on('end', () => {
        zooming.value = false;
      });
    if (options.extent) {
      const [x0, y0, x1, y1] = options.extent;
      behavior.translateExtent([
        [x0 - (x1 - x0) * 0.25, y0 - (y1 - y0) * 0.25],
        [x1 + (x1 - x0) * 0.25, y1 + (y1 - y0) * 0.25],
      ]);
    }
    select(svg.value).call(behavior);
    if (options.enabled === false) select(svg.value).on('.zoom', null);
  };
  const detach = (): void => {
    if (svg.value && behavior) select(svg.value).on('.zoom', null);
    behavior = null;
  };

  watch(svg, (el) => (el ? attach() : detach()), { immediate: true, flush: 'post' });
  onScopeDispose(detach);

  const transition = (t: ZoomTransform, animate: boolean): void => {
    if (!svg.value || !behavior) return;
    if (animate && !prefersReducedMotion()) {
      const sel = select(svg.value);
      const from = current;
      const t0 = performance.now();
      const dur = 350;
      const step = (): void => {
        const u = Math.min(1, (performance.now() - t0) / dur);
        const e = 1 - (1 - u) ** 3;
        const k = from.k + (t.k - from.k) * e;
        const x = from.x + (t.x - from.x) * e;
        const y = from.y + (t.y - from.y) * e;
        const tt = zoomIdentity.translate(x, y).scale(k);
        behavior!.transform(sel, tt);
        if (u < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else {
      behavior.transform(select(svg.value), t);
    }
  };

  return {
    transform,
    zooming,
    reset(animate = true) {
      transition(zoomIdentity, animate);
    },
    zoomTo(k, cx, cy, animate = true) {
      if (!svg.value) return;
      const vb = svg.value.viewBox.baseVal;
      const t = zoomIdentity.translate(vb.x + vb.width / 2, vb.y + vb.height / 2).scale(k).translate(-cx, -cy);
      transition(t, animate);
    },
    toModel(px, py) {
      const el = svg.value;
      if (!el) return [px, py];
      const r = el.getBoundingClientRect();
      const vb = el.viewBox.baseVal;
      // preserveAspectRatio meet: escala uniforme centrada.
      const s = Math.min(r.width / vb.width, r.height / vb.height);
      const ox = (r.width - vb.width * s) / 2;
      const oy = (r.height - vb.height * s) / 2;
      const vx = vb.x + (px - ox) / s;
      const vy = vb.y + (py - oy) / s;
      return [(vx - current.x) / current.k, (vy - current.y) / current.k];
    },
  };
}
