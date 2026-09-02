/**
 * Cliente del worker con cache LRU por hash de configuracion y fallback al
 * hilo principal cuando no hay Worker (SSR, tests).
 */
import { configHash, generateFromParams } from '../core/generate';
import { unpackModel } from '../core/transfer';
import type { CityModel, GenerationParams } from '../core/types';
import type { WorkerRequest, WorkerResponse } from './city.worker';

export interface CityGenerator {
  generate(params: GenerationParams): Promise<{ model: CityModel; ms: number; cached: boolean }>;
  dispose(): void;
}

export interface GeneratorOptions {
  readonly cacheSize?: number;
  /** Forzar hilo principal aunque exista Worker. */
  readonly inline?: boolean;
}

class Lru<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly max: number) {}
  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }
}

export function createCityGenerator(opts: GeneratorOptions = {}): CityGenerator {
  const cache = new Lru<string, CityModel>(opts.cacheSize ?? 16);
  const canWorker = !opts.inline && typeof Worker !== 'undefined';
  let worker: Worker | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();

  const ensureWorker = (): Worker => {
    if (worker) return worker;
    worker = new Worker(new URL('./city.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message));
      pending.clear();
    };
    return worker;
  };

  return {
    async generate(params) {
      const key = configHash(params);
      const hit = cache.get(key);
      if (hit) return { model: hit, ms: 0, cached: true };
      if (!canWorker) {
        const t0 = performance.now();
        const model = generateFromParams(params, { timings: true });
        cache.set(key, model);
        return { model, ms: performance.now() - t0, cached: false };
      }
      const w = ensureWorker();
      const id = ++seq;
      const res = await new Promise<WorkerResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const req: WorkerRequest = { id, params };
        w.postMessage(req);
      });
      const model = unpackModel({ coords: res.coords, json: res.json });
      cache.set(key, model);
      return { model, ms: res.ms, cached: false };
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
