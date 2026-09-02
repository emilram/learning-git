/**
 * useUrlState: sincroniza seleccion, filtros y viewport con la URL (replaceState
 * con debounce). Lee el estado inicial de la URL al montar.
 */
import { onMounted, onScopeDispose, ref, watch, type Ref } from 'vue';

export interface UrlState {
  readonly selected: Ref<string | null>;
  readonly filters: Ref<string[]>;
  readonly viewport: Ref<{ k: number; x: number; y: number } | null>;
}

export interface UrlStateOptions {
  /** Prefijo de parametros para varias cards en la misma pagina. */
  readonly prefix?: string;
  readonly debounceMs?: number;
  readonly enabled?: boolean;
}

export function useUrlState(options: UrlStateOptions = {}): UrlState {
  const p = options.prefix ?? 'cs';
  const selected = ref<string | null>(null);
  const filters = ref<string[]>([]);
  const viewport = ref<{ k: number; x: number; y: number } | null>(null);
  const enabled = options.enabled ?? typeof window !== 'undefined';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const read = (): void => {
    if (!enabled) return;
    const q = new URLSearchParams(window.location.search);
    selected.value = q.get(`${p}.sel`);
    const f = q.get(`${p}.f`);
    filters.value = f ? f.split(',').filter(Boolean) : [];
    const z = q.get(`${p}.z`);
    if (z) {
      const [k, x, y] = z.split(',').map(Number);
      if ([k, x, y].every((n) => Number.isFinite(n))) viewport.value = { k: k!, x: x!, y: y! };
    }
  };
  const write = (): void => {
    if (!enabled) return;
    const url = new URL(window.location.href);
    const q = url.searchParams;
    if (selected.value) q.set(`${p}.sel`, selected.value);
    else q.delete(`${p}.sel`);
    if (filters.value.length) q.set(`${p}.f`, filters.value.join(','));
    else q.delete(`${p}.f`);
    const v = viewport.value;
    if (v && (Math.abs(v.k - 1) > 1e-3 || Math.abs(v.x) > 0.5 || Math.abs(v.y) > 0.5)) q.set(`${p}.z`, `${v.k.toFixed(3)},${v.x.toFixed(1)},${v.y.toFixed(1)}`);
    else q.delete(`${p}.z`);
    history.replaceState(history.state, '', url.toString());
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, options.debounceMs ?? 150);
  };
  onMounted(read);
  watch([selected, filters, viewport], schedule, { deep: true });
  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });
  return { selected, filters, viewport };
}
