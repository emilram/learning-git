/** Estado de tooltip anclado a coordenadas del contenedor, con retardo de cierre para evitar parpadeo. */
import { shallowRef, type ShallowRef } from 'vue';
import type { Block, Poi } from '../core/types';

export interface TooltipState {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly poi: Poi | null;
  readonly block: Block | null;
}

export interface Tooltip {
  readonly state: ShallowRef<TooltipState>;
  show(x: number, y: number, target: { poi?: Poi | null; block?: Block | null }): void;
  move(x: number, y: number): void;
  hide(immediate?: boolean): void;
}

export function useTooltip(hideDelay = 80): Tooltip {
  const state = shallowRef<TooltipState>({ visible: false, x: 0, y: 0, poi: null, block: null });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    state,
    show(x, y, target) {
      clear();
      state.value = { visible: true, x, y, poi: target.poi ?? null, block: target.block ?? null };
    },
    move(x, y) {
      if (state.value.visible) state.value = { ...state.value, x, y };
    },
    hide(immediate = false) {
      clear();
      const doHide = (): void => {
        state.value = { ...state.value, visible: false };
      };
      if (immediate) doHide();
      else timer = setTimeout(doHide, hideDelay);
    },
  };
}
