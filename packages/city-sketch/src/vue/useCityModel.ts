/**
 * useCityModel: genera el modelo (worker si existe, hilo principal si no),
 * memoizado por hash de configuracion. Devuelve shallowRef + markRaw:
 * la geometria nunca pasa por el proxy reactivo.
 */
import { computed, markRaw, onScopeDispose, shallowRef, toValue, watch, type MaybeRefOrGetter, type ShallowRef } from 'vue';
import { resolveParams } from '../core/params';
import type { CityModel, GenerationInput } from '../core/types';
import { createCityGenerator, type CityGenerator } from '../worker/client';

export interface UseCityModelOptions {
  /** Generar en el hilo principal (sincrono). Util en SSR o tests. */
  readonly inline?: boolean;
  readonly generator?: CityGenerator;
}

export interface UseCityModelResult {
  readonly model: ShallowRef<CityModel | null>;
  readonly generating: ShallowRef<boolean>;
  readonly lastMs: ShallowRef<number>;
  readonly error: ShallowRef<string | null>;
  readonly issues: ShallowRef<readonly { path: string; message: string }[]>;
  regenerate(): void;
}

let shared: CityGenerator | null = null;
function sharedGenerator(inline: boolean): CityGenerator {
  if (inline) return createCityGenerator({ inline: true });
  if (!shared) shared = createCityGenerator();
  return shared;
}

export function useCityModel(input: MaybeRefOrGetter<GenerationInput>, options: UseCityModelOptions = {}): UseCityModelResult {
  const model = shallowRef<CityModel | null>(null);
  const generating = shallowRef(false);
  const lastMs = shallowRef(0);
  const error = shallowRef<string | null>(null);
  const issues = shallowRef<readonly { path: string; message: string }[]>([]);
  const resolved = computed(() => resolveParams(toValue(input)));
  const gen = options.generator ?? sharedGenerator(options.inline ?? false);
  let ticket = 0;

  const run = (): void => {
    const { params, issues: iss } = resolved.value;
    issues.value = iss;
    const my = ++ticket;
    generating.value = true;
    gen
      .generate(params)
      .then((r) => {
        if (my !== ticket) return; // respuesta obsoleta
        model.value = markRaw(r.model);
        lastMs.value = r.ms;
        error.value = null;
      })
      .catch((e: unknown) => {
        if (my !== ticket) return;
        error.value = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        if (my === ticket) generating.value = false;
      });
  };
  watch(resolved, run, { immediate: true });
  onScopeDispose(() => {
    ticket++;
    if (options.generator === undefined && options.inline) gen.dispose();
  });
  return { model, generating, lastMs, error, issues, regenerate: run };
}
