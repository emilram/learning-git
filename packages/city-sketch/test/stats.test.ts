import { describe, expect, it } from 'vitest';
import { generateCity } from '../src/core/generate';
import { computeIsochrones } from '../src/core/analysis/isochrone';
import { cannibalization, cityStats, convexIntersection, coverageGaps, coveredArea, districtSummary, hullOf, nearestStores, routeBetween, storesWithin, weightedCenter } from '../src/core/analysis/stats';
import { area, pointInPolygon } from '../src/core/geom/polygon';
import { THEME_PRESETS } from '../src/theme/presets';

const model = generateCity({ seed: 'stats-1', mode: 'grid-jitter', size: { w: 700, h: 500 }, pois: { count: 12, minSpacing: 40 } });

describe('cityStats y districtSummary', () => {
  it('cuenta entidades y reparte el area por uso de suelo', () => {
    const s = cityStats(model);
    expect(s.streets).toBe(model.streets.length);
    expect(s.pois).toBe(12);
    expect(s.avenues + s.alleys).toBeLessThanOrEqual(s.streets);
    const sum = Object.values(s.landUse).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThan(s.area);
    expect(s.density).toBeGreaterThan(0);
    expect(s.density).toBeLessThanOrEqual(1);
  });
  it('asigna todas las tiendas a un distrito y agrega la metrica', () => {
    const rows = districtSummary(model, (p) => p.label.length);
    expect(rows.length).toBe(model.districts.length);
    expect(rows.reduce((n, r) => n + r.pois.length, 0)).toBe(model.pois.length);
    for (const r of rows) if (r.pois.length) expect(r.mean).toBeGreaterThan(0);
  });
});

describe('busqueda espacial', () => {
  it('storesWithin y nearestStores son coherentes', () => {
    const p = model.pois[0]!;
    const near = nearestStores(model, p, 3);
    expect(near.length).toBe(3);
    expect(near[0]!.distance).toBeLessThanOrEqual(near[1]!.distance);
    const within = storesWithin(model, [p.x, p.y], near[2]!.distance + 1e-6);
    expect(within.map((w) => w.poi.id)).toContain(near[2]!.poi.id);
    expect(within[0]!.poi.id).toBe(p.id);
  });
  it('hullOf y weightedCenter', () => {
    const hull = hullOf(model.pois)!;
    expect(hull.length).toBeGreaterThanOrEqual(3);
    const c = weightedCenter(model.pois)!;
    expect(pointInPolygon(c, hull)).toBe(true);
    expect(weightedCenter([])).toBeNull();
  });
});

describe('routeBetween', () => {
  it('devuelve una ruta continua por la red, simetrica en longitud', () => {
    const a = model.pois[0]!;
    const b = model.pois[5]!;
    const r = routeBetween(model, [a.x, a.y], [b.x, b.y])!;
    expect(r).not.toBeNull();
    expect(r.polyline[0]).toEqual([a.x, a.y]);
    expect(r.polyline[r.polyline.length - 1]).toEqual([b.x, b.y]);
    expect(r.length).toBeGreaterThanOrEqual(Math.hypot(a.x - b.x, a.y - b.y) - 1e-6);
    const back = routeBetween(model, [b.x, b.y], [a.x, a.y])!;
    expect(Math.abs(back.length - r.length)).toBeLessThan(1e-6);
    expect(r.streetIds.length).toBeGreaterThan(0);
  });
});

describe('cobertura', () => {
  it('convexIntersection de cuadrados solapados', () => {
    const inter = convexIntersection([[0, 0], [10, 0], [10, 10], [0, 10]], [[5, 5], [15, 5], [15, 15], [5, 15]]);
    expect(area(inter)).toBeCloseTo(25, 6);
    expect(convexIntersection([[0, 0], [1, 0], [1, 1]], [[5, 5], [6, 5], [6, 6]]).length).toBe(0);
  });
  it('cannibalization devuelve ratios en [0,1] ordenados', () => {
    const bands = computeIsochrones(model, model.pois, [140]);
    const pairs = cannibalization(bands, 0.01);
    expect(pairs.length).toBeGreaterThan(0);
    for (let i = 0; i < pairs.length; i++) {
      expect(pairs[i]!.ratio).toBeGreaterThan(0);
      expect(pairs[i]!.ratio).toBeLessThanOrEqual(1);
      if (i > 0) expect(pairs[i - 1]!.ratio).toBeGreaterThanOrEqual(pairs[i]!.ratio);
    }
    expect(coveredArea(bands)).toBeGreaterThan(0);
  });
  it('coverageGaps solo propone puntos fuera del radio y separados entre si', () => {
    const gaps = coverageGaps(model, 90, { max: 4, minSpacing: 60 });
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.length).toBeLessThanOrEqual(4);
    for (const g of gaps) {
      for (const p of model.pois) expect(Math.hypot(p.x - g.point[0], p.y - g.point[1])).toBeGreaterThanOrEqual(90);
      expect(g.score).toBeGreaterThan(0);
      expect(g.score).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < gaps.length; i++) for (let j = i + 1; j < gaps.length; j++) expect(Math.hypot(gaps[i]!.point[0] - gaps[j]!.point[0], gaps[i]!.point[1] - gaps[j]!.point[1])).toBeGreaterThanOrEqual(60);
    expect(coverageGaps(model, 90)).toEqual(coverageGaps(model, 90));
  });
});

describe('paletas de datos', () => {
  const hexToOklchL = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c: number): number => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const r = lin(n >> 16), g = lin((n >> 8) & 255), b = lin(n & 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  };
  it('los estados de cada tema quedan dentro de la banda de luminosidad de su esquema', () => {
    for (const t of Object.values(THEME_PRESETS)) {
      const [lo, hi] = t.scheme === 'dark' ? [0.48, 0.67] : [0.43, 0.77];
      for (const c of Object.values(t.data.status)) {
        const L = hexToOklchL(c);
        expect(L, `${t.name} ${c}`).toBeGreaterThanOrEqual(lo - 1e-3);
        expect(L, `${t.name} ${c}`).toBeLessThanOrEqual(hi + 1e-3);
      }
      expect(t.data.categorical.length).toBe(6);
    }
  });
});
