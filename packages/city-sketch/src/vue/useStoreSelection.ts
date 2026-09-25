/**
 * useStoreSelection: seleccion simple o multiple de tiendas con utilidades
 * espaciales (radio, poligono, vecinas mas cercanas, predicado) y una
 * seleccion primaria para camara y detalle.
 */
import { computed, shallowRef, toValue, type ComputedRef, type MaybeRefOrGetter, type ShallowRef } from 'vue';
import { nearestStores, storesInPolygon, storesWithin } from '../core/analysis/stats';
import type { CityModel, Poi, Polygon, Vec2 } from '../core/types';

export type SelectionMode = 'single' | 'multi';

export interface StoreSelection {
  readonly ids: ShallowRef<ReadonlySet<string>>;
  readonly mode: ShallowRef<SelectionMode>;
  /** Ultima tienda seleccionada (o null). */
  readonly primary: ComputedRef<Poi | null>;
  readonly pois: ComputedRef<Poi[]>;
  readonly count: ComputedRef<number>;
  has(id: string): boolean;
  select(id: string | null): void;
  toggle(id: string): void;
  add(ids: Iterable<string>): void;
  remove(ids: Iterable<string>): void;
  clear(): void;
  setMode(mode: SelectionMode): void;
  selectWithin(center: Vec2, radius: number): void;
  selectInPolygon(polygon: Polygon): void;
  /** Selecciona una tienda y sus k vecinas mas cercanas. */
  selectNeighborhood(id: string, k?: number): void;
  selectWhere(predicate: (poi: Poi) => boolean): void;
  invert(): void;
}

export function useStoreSelection(model: MaybeRefOrGetter<CityModel | null>, options: { readonly mode?: SelectionMode; readonly initial?: Iterable<string> } = {}): StoreSelection {
  const ids = shallowRef<ReadonlySet<string>>(new Set(options.initial ?? []));
  const mode = shallowRef<SelectionMode>(options.mode ?? 'single');
  const order: string[] = [...ids.value];

  const commit = (next: Set<string>): void => {
    for (let i = order.length - 1; i >= 0; i--) if (!next.has(order[i]!)) order.splice(i, 1);
    for (const id of next) if (!order.includes(id)) order.push(id);
    ids.value = next;
  };
  const poiById = computed(() => new Map((toValue(model)?.pois ?? []).map((p) => [p.id as string, p])));
  // Leer ids.value antes de recorrer `order` (no reactivo) para que la dependencia quede registrada aunque este vacio.
  const pois = computed(() => {
    const set = ids.value;
    return order.filter((id) => set.has(id)).map((id) => poiById.value.get(id)).filter((p): p is Poi => !!p);
  });
  const primary = computed(() => {
    const set = ids.value;
    for (let i = order.length - 1; i >= 0; i--) {
      const p = poiById.value.get(order[i]!);
      if (p && set.has(p.id)) return p;
    }
    return null;
  });

  const has = (id: string): boolean => ids.value.has(id);
  const select = (id: string | null): void => commit(id ? new Set([id]) : new Set());
  const toggle = (id: string): void => {
    if (mode.value === 'single') return select(has(id) ? null : id);
    const next = new Set(ids.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    commit(next);
  };
  const add = (list: Iterable<string>): void => {
    const next = mode.value === 'single' ? new Set<string>() : new Set(ids.value);
    for (const id of list) next.add(id);
    if (mode.value === 'single' && next.size > 1) commit(new Set([[...next][next.size - 1]!]));
    else commit(next);
  };
  const remove = (list: Iterable<string>): void => {
    const next = new Set(ids.value);
    for (const id of list) next.delete(id);
    commit(next);
  };
  const clear = (): void => commit(new Set());
  const setMode = (m: SelectionMode): void => {
    mode.value = m;
    if (m === 'single' && ids.value.size > 1) commit(new Set(primary.value ? [primary.value.id] : []));
  };
  const withModel = (fn: (m: CityModel) => Iterable<string>): void => {
    const m = toValue(model);
    if (!m) return;
    const list = [...fn(m)];
    if (mode.value === 'single') mode.value = 'multi';
    commit(new Set(list));
  };
  const selectWithin = (center: Vec2, radius: number): void => withModel((m) => storesWithin(m, center, radius).map((r) => r.poi.id));
  const selectInPolygon = (polygon: Polygon): void => withModel((m) => storesInPolygon(m, polygon).map((p) => p.id));
  const selectNeighborhood = (id: string, k = 3): void =>
    withModel((m) => {
      const p = poiById.value.get(id);
      return p ? [p.id, ...nearestStores(m, p, k).map((r) => r.poi.id)] : [];
    });
  const selectWhere = (predicate: (poi: Poi) => boolean): void => withModel((m) => m.pois.filter(predicate).map((p) => p.id));
  const invert = (): void => withModel((m) => m.pois.filter((p) => !ids.value.has(p.id)).map((p) => p.id));

  return { ids, mode, primary, pois, count: computed(() => ids.value.size), has, select, toggle, add, remove, clear, setMode, selectWithin, selectInPolygon, selectNeighborhood, selectWhere, invert };
}
