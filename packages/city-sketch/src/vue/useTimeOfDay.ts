/**
 * useTimeOfDay: fase dia / atardecer / noche con tema y ajustes de luz 3D
 * coherentes. Puede ciclar automaticamente; el crossfade visual lo hace
 * <CitySketch crossfade>.
 */
import { computed, onScopeDispose, shallowRef, type ComputedRef, type ShallowRef } from 'vue';
import type { Theme } from '../core/types';
import type { IsoOptions } from '../core/svg/iso';
import { THEME_PRESETS } from '../theme/presets';

export type DayPhase = 'day' | 'dusk' | 'night';

export const DAY_PHASES: readonly DayPhase[] = ['day', 'dusk', 'night'];

export interface TimeOfDayOptions {
  readonly initial?: DayPhase;
  /** Temas por fase (por defecto city-day / city-dusk / city-night). */
  readonly themes?: Partial<Record<DayPhase, Theme>>;
}

export interface TimeOfDay {
  readonly phase: ShallowRef<DayPhase>;
  readonly theme: ComputedRef<Theme>;
  /** Luz, sombras y luces coherentes con la fase; mezclar con las opciones iso propias. */
  readonly iso: ComputedRef<Partial<IsoOptions>>;
  readonly label: ComputedRef<string>;
  readonly cycling: ShallowRef<boolean>;
  set(phase: DayPhase): void;
  next(): void;
  /** Cicla las fases cada `periodMs` (0 detiene). */
  cycle(periodMs: number): void;
  stop(): void;
}

const ISO_BY_PHASE: Readonly<Record<DayPhase, Partial<IsoOptions>>> = {
  day: { lightAzimuth: 40, lightElevation: 0.55, shadows: 0.45, nightLights: false, fog: 0.35 },
  dusk: { lightAzimuth: 160, lightElevation: 0.22, shadows: 0.6, nightLights: true, fog: 0.4 },
  night: { lightAzimuth: 90, lightElevation: 0.6, shadows: 0.3, nightLights: true, fog: 0.25 },
};

const LABELS: Readonly<Record<DayPhase, string>> = { day: 'Día', dusk: 'Atardecer', night: 'Noche' };

export function useTimeOfDay(options: TimeOfDayOptions = {}): TimeOfDay {
  const phase = shallowRef<DayPhase>(options.initial ?? 'day');
  const cycling = shallowRef(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  const theme = computed(() => options.themes?.[phase.value] ?? THEME_PRESETS[phase.value === 'day' ? 'city-day' : phase.value === 'dusk' ? 'city-dusk' : 'city-night']);
  const iso = computed(() => ISO_BY_PHASE[phase.value]);
  const label = computed(() => LABELS[phase.value]);
  const set = (p: DayPhase): void => {
    phase.value = p;
  };
  const next = (): void => set(DAY_PHASES[(DAY_PHASES.indexOf(phase.value) + 1) % DAY_PHASES.length]!);
  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    cycling.value = false;
  };
  const cycle = (periodMs: number): void => {
    stop();
    if (periodMs <= 0) return;
    cycling.value = true;
    timer = setInterval(next, periodMs);
  };
  onScopeDispose(stop);
  return { phase, theme, iso, label, cycling, set, next, cycle, stop };
}
