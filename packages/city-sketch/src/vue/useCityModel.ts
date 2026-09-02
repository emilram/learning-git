/**
 * useCityModel: genera el modelo en el hilo principal (el worker llega en el bloque 4)
 * con shallowRef + markRaw y cache LRU por hash de configuracion.
 */
import { computed, markRaw, shallowRef, watch, type MaybeRefOrGetter, toValue, type ShallowRef } from 'vue';
import { configHash, generateFromParams } from '../core/generate';
import { resolveParams } from '../core/params';
import type { CityModel, GenerationInput } from '../core/types';

const cache = new Map<string, CityModel>();
const MAX_CACHE = 16;

export interface UseCityModelResult {
  readonly model: ShallowRef<CityModel | null>;
  readonly generating: ShallowRef<boolean>;
  readonly lastMs: ShallowRef<number>;
  readonly issues: ShallowRef<readonly { path: string; message: string }[]>;
  regenerate(): void;
}

export function useCityModel(input: MaybeRefOrGetter<GenerationInput>): UseCityModelResult {
  const model = shallowRef<CityModel | null>(null);
  const generating = shallowRef(false);
  const lastMs = shallowRef(0);
  const issues = shallowRef<readonly { path: string; message: string }[]>([]);
  const resolved = computed(() => resolveParams(toValue(input)));

  const run = (): void => {
    const { params, issues: iss } = resolved.value;
    issues.value = iss;
    const key = configHash(params);
    const hit = cache.get(key);
    if (hit) {
      model.value = hit;
      lastMs.value = 0;
      return;
    }
    generating.value = true;
    const t0 = performance.now();
    const m = markRaw(generateFromParams(params, { timings: true }));
    lastMs.value = performance.now() - t0;
    cache.set(key, m);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
    model.value = m;
    generating.value = false;
  };
  watch(resolved, run, { immediate: true });
  return { model, generating, lastMs, issues, regenerate: run };
}
