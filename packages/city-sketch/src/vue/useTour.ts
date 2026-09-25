/**
 * useTour: recorrido guiado por pasos (seleccion, vista, camara, texto) con
 * temporizador, progreso y controles. Cada paso llama a `onStep` para que el
 * consumidor aplique la seleccion y la camara como prefiera.
 */
import { computed, onScopeDispose, shallowRef, toValue, type ComputedRef, type MaybeRefOrGetter, type ShallowRef } from 'vue';
import { prefersReducedMotion } from './useZoomPan';

export interface TourStep {
  readonly id: string;
  readonly title?: string;
  readonly text?: string;
  /** Tienda a seleccionar (null = limpiar). */
  readonly select?: string | null;
  readonly view?: '2d' | 'iso';
  readonly camera?: { readonly rotation: number; readonly pitch: number };
  /** Duracion del paso en ms (por defecto `interval`). */
  readonly duration?: number;
}

export interface TourOptions {
  readonly interval?: number;
  readonly loop?: boolean;
  readonly onStep?: (step: TourStep, index: number) => void;
  readonly onEnd?: () => void;
}

export interface Tour {
  readonly running: ShallowRef<boolean>;
  readonly index: ShallowRef<number>;
  readonly current: ComputedRef<TourStep | null>;
  readonly total: ComputedRef<number>;
  /** Progreso 0-1 dentro del paso actual (actualizado por rAF; salta a 1 con reduced motion). */
  readonly stepProgress: ShallowRef<number>;
  start(at?: number): void;
  stop(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  goTo(index: number): void;
}

export function useTour(steps: MaybeRefOrGetter<readonly TourStep[]>, options: TourOptions = {}): Tour {
  const running = shallowRef(false);
  const index = shallowRef(-1);
  const stepProgress = shallowRef(0);
  const list = computed(() => toValue(steps));
  const total = computed(() => list.value.length);
  const current = computed(() => list.value[index.value] ?? null);
  const interval = options.interval ?? 3500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let raf = 0;

  const clearTimers = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const apply = (i: number): void => {
    const step = list.value[i];
    if (!step) return;
    index.value = i;
    options.onStep?.(step, i);
  };

  const schedule = (): void => {
    clearTimers();
    const step = current.value;
    if (!step || !running.value) return;
    const d = step.duration ?? interval;
    const t0 = performance.now();
    stepProgress.value = 0;
    if (!prefersReducedMotion()) {
      const tick = (): void => {
        stepProgress.value = Math.min(1, (performance.now() - t0) / d);
        if (stepProgress.value < 1 && running.value) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else stepProgress.value = 1;
    timer = setTimeout(next, d);
  };

  const goTo = (i: number): void => {
    if (!total.value) return;
    const n = ((i % total.value) + total.value) % total.value;
    apply(n);
    if (running.value) schedule();
  };
  const next = (): void => {
    if (!total.value) return;
    if (index.value + 1 >= total.value && !(options.loop ?? true)) return stop();
    goTo(index.value + 1);
  };
  const prev = (): void => goTo(index.value - 1);
  const start = (at = 0): void => {
    if (!total.value) return;
    running.value = true;
    apply(at);
    schedule();
  };
  const stop = (): void => {
    const was = running.value;
    running.value = false;
    clearTimers();
    stepProgress.value = 0;
    if (was) options.onEnd?.();
  };
  const toggle = (): void => (running.value ? stop() : start(Math.max(0, index.value)));

  onScopeDispose(clearTimers);
  return { running, index, current, total, stepProgress, start, stop, toggle, next, prev, goTo };
}
