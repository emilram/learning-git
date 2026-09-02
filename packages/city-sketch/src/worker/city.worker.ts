/// <reference lib="webworker" />
/**
 * Worker de generacion: recibe params efectivos, genera y devuelve el modelo
 * empaquetado con el Float64Array transferido (sin copia).
 */
import { generateFromParams } from '../core/generate';
import { packModel } from '../core/transfer';
import type { GenerationParams } from '../core/types';

export interface WorkerRequest {
  readonly id: number;
  readonly params: GenerationParams;
}

export interface WorkerResponse {
  readonly id: number;
  readonly coords: Float64Array;
  readonly json: ReturnType<typeof packModel>['json'];
  readonly ms: number;
  readonly error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, params } = ev.data;
  const t0 = performance.now();
  try {
    const model = generateFromParams(params, { timings: true });
    const packed = packModel(model);
    const res: WorkerResponse = { id, coords: packed.coords, json: packed.json, ms: performance.now() - t0 };
    ctx.postMessage(res, [packed.coords.buffer]);
  } catch (e) {
    const res: WorkerResponse = { id, coords: new Float64Array(0), json: null as never, ms: performance.now() - t0, error: e instanceof Error ? e.message : String(e) };
    ctx.postMessage(res);
  }
};
