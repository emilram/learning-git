/** Manzana americana: rejilla ortogonal rotada con espaciados variables y jitter. */
import { rotate } from '../geom/vec';
import type { ModeGenerator, RawLine, Vec2 } from '../types';

export const gridJitterMode: ModeGenerator = (ctx) => {
  const { params, bounds } = ctx;
  const rng = ctx.rng('grid-jitter');
  const theta = (params.tensor.dominantAngle * Math.PI) / 180;
  const c: Vec2 = [bounds.w / 2, bounds.h / 2];
  const diag = Math.hypot(bounds.w, bounds.h) / 2 + 10;
  const { min, max } = params.blockSize;
  const densityScale = 1.5 - params.density; // 0.5..1.5
  const spacings = (): number[] => {
    const arr: number[] = [];
    let acc = -diag;
    while (acc < diag) {
      arr.push(acc);
      acc += rng.range(min, max) * densityScale;
    }
    return arr;
  };
  const xs = spacings();
  const ys = spacings();
  const avenueEvery = rng.int(3, 5);
  const avOffX = rng.int(0, avenueEvery - 1);
  const avOffY = rng.int(0, avenueEvery - 1);
  const jitter = params.chaos * 0.12 * ((min + max) / 2);
  // Jitter por interseccion (compartido por la linea vertical y horizontal que se cruzan ahi).
  const jx: number[][] = xs.map(() => ys.map(() => rng.gauss(0, jitter)));
  const jy: number[][] = xs.map(() => ys.map(() => rng.gauss(0, jitter)));
  const toWorld = (u: number, w: number): Vec2 => {
    const r = rotate([u, w], theta);
    return [c[0] + r[0], c[1] + r[1]];
  };
  const dropChance = params.chaos * 0.18;
  const lines: RawLine[] = [];
  xs.forEach((x, i) => {
    const cls = (i + avOffX) % avenueEvery === 0 ? 'avenue' : 'street';
    let cur: Vec2[] = [];
    ys.forEach((y, j) => {
      const p = toWorld(x + (jx[i]?.[j] ?? 0), y + (jy[i]?.[j] ?? 0));
      cur.push(p);
      if (cls === 'street' && j < ys.length - 1 && rng.chance(dropChance)) {
        if (cur.length >= 2) lines.push({ points: cur, cls });
        cur = [];
      }
    });
    if (cur.length >= 2) lines.push({ points: cur, cls });
  });
  ys.forEach((y, j) => {
    const cls = (j + avOffY) % avenueEvery === 0 ? 'avenue' : 'street';
    let cur: Vec2[] = [];
    xs.forEach((x, i) => {
      const p = toWorld(x + (jx[i]?.[j] ?? 0), y + (jy[i]?.[j] ?? 0));
      cur.push(p);
      if (cls === 'street' && i < xs.length - 1 && rng.chance(dropChance)) {
        if (cur.length >= 2) lines.push({ points: cur, cls });
        cur = [];
      }
    });
    if (cur.length >= 2) lines.push({ points: cur, cls });
  });
  return lines;
};
