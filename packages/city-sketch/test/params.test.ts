import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, PARAM_SPECS, deepMerge, resolveParams } from '../src/core/params';

describe('resolveParams', () => {
  it('aplica defaults y devuelve config completa sin issues', () => {
    const { params, issues } = resolveParams({ seed: 'abc' });
    expect(issues).toEqual([]);
    expect(params.seed).toBe('abc');
    expect(params.tensor.spacingMajor).toBe(DEFAULT_PARAMS.tensor.spacingMajor);
  });

  it('fusiona parciales profundos sin perder hermanos', () => {
    const { params } = resolveParams({ seed: 'x', tensor: { dominantAngle: 30 } });
    expect(params.tensor.dominantAngle).toBe(30);
    expect(params.tensor.spacingMinor).toBe(DEFAULT_PARAMS.tensor.spacingMinor);
  });

  it('recorta fuera de rango y lo reporta', () => {
    const { params, issues } = resolveParams({ seed: 'x', density: 7, districts: 2.6 });
    expect(params.density).toBe(1);
    expect(params.districts).toBe(3);
    expect(issues.map((i) => i.path)).toEqual(['density', 'districts']);
  });

  it('corrige enums inválidos al default', () => {
    const { params, issues } = resolveParams({ seed: 'x', mode: 'nope' as never });
    expect(params.mode).toBe('tensor');
    expect(issues[0]?.path).toBe('mode');
  });

  it('aplica invariantes cruzadas', () => {
    const { params, issues } = resolveParams({
      seed: 'x',
      blockSize: { min: 100, max: 50 },
      landUse: { parkRatio: 0.5, waterRatio: 0.4, plazaRatio: 0.2 },
    });
    expect(params.blockSize).toEqual({ min: 50, max: 100 });
    const total = params.landUse.parkRatio + params.landUse.waterRatio + params.landUse.plazaRatio;
    expect(total).toBeCloseTo(0.8, 6);
    expect(issues.some((i) => i.path === 'blockSize')).toBe(true);
  });

  it('no muta DEFAULT_PARAMS', () => {
    const snapshot = JSON.stringify(DEFAULT_PARAMS);
    resolveParams({ seed: 'x', cleanup: { deadEnds: true }, pois: { items: [{ label: 'A' }] } });
    expect(JSON.stringify(DEFAULT_PARAMS)).toBe(snapshot);
  });

  it('cada spec apunta a una ruta existente en DEFAULT_PARAMS', () => {
    for (const spec of PARAM_SPECS) {
      const v = spec.path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown>)[k], DEFAULT_PARAMS);
      expect(v, spec.path).not.toBeUndefined();
    }
  });
});

describe('deepMerge', () => {
  it('reemplaza arreglos en vez de fusionarlos', () => {
    const out = deepMerge({ a: [1, 2, 3], b: { c: 1 } }, { a: [9] });
    expect(out).toEqual({ a: [9], b: { c: 1 } });
  });
});
