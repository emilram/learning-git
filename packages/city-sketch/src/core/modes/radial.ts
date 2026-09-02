/** Ciudad radial europea: anillos concentricos y radiales con densidad creciente. */
import { createSimplex2D } from '../geom/noise';
import type { ModeGenerator, RawLine, Vec2 } from '../types';

export const radialMode: ModeGenerator = (ctx) => {
  const { params, bounds } = ctx;
  const rng = ctx.rng('radial');
  const noise = createSimplex2D(rng.fork('ring-noise'));
  const centers: Vec2[] =
    params.tensor.radialCenters > 1 ? ctx.districts.slice(0, params.tensor.radialCenters).map((d) => d.center) : [[bounds.w / 2, bounds.h / 2]];
  const spacing = ((params.blockSize.min + params.blockSize.max) / 2) * (1.5 - params.density);
  const maxR = Math.hypot(bounds.w, bounds.h) / (centers.length > 1 ? 2.6 : 1.4);
  const lines: RawLine[] = [];
  centers.forEach((c, ci) => {
    const r0 = spacing * 0.8;
    const growth = 1 + 0.25 * (1 - params.density);
    let r = r0;
    let ring = 0;
    const radii: number[] = [];
    while (r < maxR) {
      radii.push(r);
      r = r * growth + spacing * 0.5;
      ring++;
    }
    void ring;
    // Anillos: dos mitades para que la planarizacion no genere bucles a==b.
    radii.forEach((rad, k) => {
      const cls = k % 3 === 1 ? 'avenue' : 'street';
      const steps = Math.max(24, Math.round((2 * Math.PI * rad) / 12));
      const half: Vec2[][] = [[], []];
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const nz = noise(Math.cos(a) * 2 + ci * 10 + k, Math.sin(a) * 2 + k);
        const rr = rad * (1 + params.chaos * 0.12 * nz);
        const p: Vec2 = [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr];
        if (i <= steps / 2) (half[0] as Vec2[]).push(p);
        if (i >= steps / 2) (half[1] as Vec2[]).push(p);
      }
      lines.push({ points: half[0] as Vec2[], cls }, { points: half[1] as Vec2[], cls });
    });
    // Radiales: entre anillo k y k+1, n_k radiales; los principales llegan hasta el borde.
    const mainSpokes = rng.int(6, 8);
    const spokeOffset = rng.range(0, Math.PI * 2);
    for (let s = 0; s < mainSpokes; s++) {
      const a = spokeOffset + (s / mainSpokes) * Math.PI * 2 + rng.gauss(0, params.chaos * 0.08);
      const far = maxR * 1.2;
      lines.push({ points: [c, [c[0] + Math.cos(a) * far, c[1] + Math.sin(a) * far]], cls: 'avenue' });
    }
    for (let k = 0; k + 1 < radii.length; k++) {
      const rIn = radii[k] as number;
      const rOut = radii[k + 1] as number;
      const n = Math.max(mainSpokes, Math.round((2 * Math.PI * rOut) / spacing));
      const off = (k % 2) * (Math.PI / n) + spokeOffset;
      for (let s = 0; s < n; s++) {
        const a = off + (s / n) * Math.PI * 2 + rng.gauss(0, params.chaos * 0.05);
        // Saltar radiales que se superponen a los principales.
        const rel = ((a - spokeOffset) % (Math.PI * 2 / mainSpokes) + Math.PI * 2 / mainSpokes) % (Math.PI * 2 / mainSpokes);
        if (rel < 0.08 || rel > Math.PI * 2 / mainSpokes - 0.08) continue;
        if (rng.chance(params.chaos * 0.3)) continue;
        lines.push({ points: [[c[0] + Math.cos(a) * rIn, c[1] + Math.sin(a) * rIn], [c[0] + Math.cos(a) * rOut, c[1] + Math.sin(a) * rOut]], cls: 'street' });
      }
    }
  });
  return lines;
};
