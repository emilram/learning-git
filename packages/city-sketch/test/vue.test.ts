import { describe, expect, it } from 'vitest';
import { generateCity } from '../src/index';
import { packModel, unpackModel } from '../src/core/transfer';
import { computeIsochrones, snapToStreet } from '../src/core/analysis/isochrone';
import { useStoreBinding, formatBadge } from '../src/vue/useStoreBinding';

const model = generateCity({ seed: 'vue-test', mode: 'grid-jitter', size: { w: 700, h: 500 }, pois: { count: 12 } });

describe('transfer', () => {
  it('pack/unpack es una identidad estructural', () => {
    const packed = packModel(model);
    expect(packed.coords).toBeInstanceOf(Float64Array);
    const back = unpackModel(packed);
    expect(back.streets.length).toBe(model.streets.length);
    expect(back.streets[0]!.polyline).toEqual(model.streets[0]!.polyline);
    expect(back.blocks[3]!.outline).toEqual(model.blocks[3]!.outline);
    expect(back.lots.map((l) => l.id)).toEqual(model.lots.map((l) => l.id));
    expect(back.labels[0]?.path).toEqual(model.labels[0]?.path);
    expect(back.meta.configHash).toBe(model.meta.configHash);
  });
});

describe('isochrones', () => {
  it('produce bandas crecientes por tienda', () => {
    const bands = computeIsochrones(model, model.pois.slice(0, 2), [100, 200]);
    expect(bands.length).toBe(4);
    const [a, b] = bands.filter((x) => x.poiId === model.pois[0]!.id);
    expect(a!.polygon.length).toBeGreaterThanOrEqual(3);
    expect(b!.polygon.length).toBeGreaterThanOrEqual(3);
  });
  it('snapToStreet devuelve un punto sobre una calle', () => {
    const r = snapToStreet(model, [350, 250]);
    expect(r).not.toBeNull();
    expect(model.streets.some((s) => s.id === r!.streetId)).toBe(true);
  });
});

describe('useStoreBinding', () => {
  const pois = model.pois.map((p, i) => ({ ...p, externalId: `S${i}` }));
  const data = pois.map((p, i) => ({ id: p.externalId!, sales: 100 + i * 50, margin: i % 2 ? 0.1 : -0.1, stock: i / pois.length }));
  const b = useStoreBinding(
    () => pois,
    () => data,
    () => ({
      size: { field: 'sales' },
      color: { field: 'margin', scheme: 'diverging' },
      status: { field: 'stock', classify: (v) => (typeof v === 'number' && v < 0.2 ? 'alert' : 'ok') },
      badge: 'sales',
      height: { field: 'sales', range: [10, 50] },
    }),
  );
  it('genera overrides con escala, color y anillo', () => {
    const ov = b.overrides.value;
    expect(Object.keys(ov).length).toBe(pois.length);
    const first = ov[pois[0]!.id]!;
    expect(first.style).toMatch(/--cs-poi-scale:[\d.]+/);
    expect(first.style).toMatch(/--cs-poi-fill:oklch\(/);
    expect(first.className).toBe('cs-status-alert');
  });
  it('badges, alturas y leyenda', () => {
    expect(b.badges.value.get(pois[0]!.id)).toBe('100');
    expect(b.heights.value.get(pois[0]!.id)).toBe(10);
    expect(b.heights.value.get(pois[pois.length - 1]!.id)).toBe(50);
    expect(b.legend.value.color.length).toBe(5);
    expect(b.legend.value.status.length).toBe(3);
  });
  it('formatBadge', () => {
    expect(formatBadge(1234)).toBe('1.2k');
    expect(formatBadge(25000)).toBe('25k');
    expect(formatBadge(2500000)).toBe('2.5M');
    expect(formatBadge(0.42)).toBe('42%');
  });
});
