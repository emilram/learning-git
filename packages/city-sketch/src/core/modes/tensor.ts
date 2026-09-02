import { fieldFromContext } from '../field/tensor';
import { cacheTensorField } from '../field/cache';
import { joinDanglingEnds, traceStreamlines } from '../field/streamlines';
import { simplify } from '../geom/vec';
import { lerp1 } from '../geom/vec';
import type { ModeGenerator, RawLine, Vec2 } from '../types';

export const tensorMode: ModeGenerator = (ctx) => {
  const { params, bounds } = ctx;
  // Cache en rejilla de 6 unidades: 5x mas rapido que muestrear el campo analitico en cada paso RK4.
  const field = cacheTensorField(fieldFromContext(ctx), bounds, 8);
  const rng = ctx.rng('trace');
  const k = lerp1(1.6, 0.6, params.density);
  const dsepMajor = params.tensor.spacingMajor * k;
  const dsepMinor = Math.min(Math.max(params.tensor.spacingMinor * k, params.blockSize.min), params.blockSize.max);
  const seeds: Vec2[] = [[bounds.w / 2, bounds.h / 2], ...ctx.districts.map((d) => d.center)];
  const jitter = params.chaos * 0.15 * dsepMajor;
  const jittered = seeds.map((s) => [s[0] + rng.gauss(0, jitter), s[1] + rng.gauss(0, jitter)] as Vec2);
  const base = { dstep: params.tensor.stepSize, maxSteps: params.tensor.maxSteps, seedTries: 40 };
  const major = traceStreamlines(field, bounds, { ...base, dsep: dsepMajor, dtest: dsepMajor * 0.5, major: true }, rng.fork('major'), jittered, []);
  const minor = traceStreamlines(field, bounds, { ...base, dsep: dsepMinor, dtest: dsepMinor * 0.5, major: false }, rng.fork('minor'), jittered, major.lines);
  const minorAvenues = traceStreamlines(field, bounds, { ...base, dsep: dsepMajor, dtest: dsepMajor * 0.5, major: false }, rng.fork('minor-av'), jittered, major.lines);
  const majorStreets = traceStreamlines(field, bounds, { ...base, dsep: dsepMinor, dtest: dsepMinor * 0.5, major: true }, rng.fork('major-st'), jittered, minor.lines);
  const all: { pts: Vec2[]; cls: 'avenue' | 'street' }[] = [
    ...major.lines.map((pts) => ({ pts, cls: 'avenue' as const })),
    ...minorAvenues.lines.map((pts) => ({ pts, cls: 'avenue' as const })),
    ...minor.lines.map((pts) => ({ pts, cls: 'street' as const })),
    ...majorStreets.lines.map((pts) => ({ pts, cls: 'street' as const })),
  ];
  const joined = joinDanglingEnds(all.map((l) => l.pts), bounds, dsepMinor * 0.9);
  const tol = 0.4 + params.curvature * 0.4;
  const out: RawLine[] = joined.map((pts, i) => ({ points: simplify(pts, tol), cls: (all[i] as { cls: 'avenue' | 'street' }).cls }));
  return out.filter((l) => l.points.length >= 2);
};
