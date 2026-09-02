import { clipPolylineToConvex } from '../geom/clip';
import type { GenerationMode, ModeGenerator, PipelineContext, RawLine, RawLines } from '../types';
import { gridJitterMode } from './grid-jitter';
import { lsystemMode } from './lsystem';
import { organicVoronoiMode } from './organic-voronoi';
import { radialMode } from './radial';
import { tensorMode } from './tensor';

export const MODES: Readonly<Record<Exclude<GenerationMode, 'hybrid'>, ModeGenerator>> = {
  tensor: tensorMode,
  'grid-jitter': gridJitterMode,
  'organic-voronoi': organicVoronoiMode,
  radial: radialMode,
  lsystem: lsystemMode,
};

/** Hibrido: cada distrito usa su modo, recortado a su celda; las fronteras son avenidas. */
export const hybridMode: ModeGenerator = (ctx) => {
  const out: RawLine[] = [];
  ctx.districts.forEach((d, i) => {
    const gen = MODES[d.mode === 'hybrid' ? 'tensor' : d.mode];
    // Contexto con semilla de etapa distinta por distrito para que no se repitan patrones.
    const sub: PipelineContext = {
      ...ctx,
      rng: (stage) => ctx.rng(`${stage}#${i}`),
      districts: [d],
    };
    const lines = gen(sub, d.polygon);
    for (const l of lines) {
      for (const piece of clipPolylineToConvex(l.points, d.polygon)) out.push({ points: piece, cls: l.cls });
    }
    const poly = d.polygon;
    for (let j = 0; j < poly.length; j++) {
      out.push({ points: [poly[j]!, poly[(j + 1) % poly.length]!], cls: 'avenue' });
    }
  });
  return out;
};

export function runMode(ctx: PipelineContext): RawLines {
  if (ctx.params.mode === 'hybrid') return hybridMode(ctx);
  return MODES[ctx.params.mode](ctx);
}
