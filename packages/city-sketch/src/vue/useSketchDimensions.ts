/** Dimensiones del contenedor via ResizeObserver, con fallback a valores iniciales. */
import { onMounted, onScopeDispose, shallowRef, type Ref, type ShallowRef } from 'vue';

export interface SketchDimensions {
  readonly width: ShallowRef<number>;
  readonly height: ShallowRef<number>;
  readonly ratio: ShallowRef<number>;
}

export function useSketchDimensions(el: Ref<HTMLElement | null>, initial = { width: 400, height: 300 }): SketchDimensions {
  const width = shallowRef(initial.width);
  const height = shallowRef(initial.height);
  const ratio = shallowRef(initial.width / Math.max(1, initial.height));
  let ro: ResizeObserver | null = null;
  const update = (w: number, h: number): void => {
    if (w <= 0 || h <= 0) return;
    width.value = w;
    height.value = h;
    ratio.value = w / h;
  };
  onMounted(() => {
    if (!el.value || typeof ResizeObserver === 'undefined') return;
    ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const box = e.contentBoxSize?.[0];
      if (box) update(box.inlineSize, box.blockSize);
      else update(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(el.value);
    const r = el.value.getBoundingClientRect();
    update(r.width, r.height);
  });
  onScopeDispose(() => ro?.disconnect());
  return { width, height, ratio };
}
