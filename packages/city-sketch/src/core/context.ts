/**
 * Contexto del pipeline: PRNG por etapa, ids, distritos (Voronoi + Lloyd) y agua.
 */
import { Delaunay } from 'd3-delaunay';
import { createSimplex2D } from './geom/noise';
import { area as polyArea, centroid, cleanPolygon, clipToRect } from './geom/polygon';
import { createIdFactory } from './rng/ids';
import { createRng } from './rng/prng';
import { DISTRICT_NAMES } from './names/lists';
import type { District, GenerationMode, GenerationParams, LandUse, PipelineContext, Polygon, Rng, Vec2 } from './types';

const HYBRID_CYCLE: readonly GenerationMode[] = ['tensor', 'grid-jitter', 'organic-voronoi', 'radial'];

function voronoiCells(points: Vec2[], w: number, h: number): Polygon[] {
  const d = Delaunay.from(points.map((p) => [p[0], p[1]] as [number, number]));
  const vor = d.voronoi([0, 0, w, h]);
  const cells: Polygon[] = [];
  for (let i = 0; i < points.length; i++) {
    const cell = vor.cellPolygon(i);
    if (!cell) {
      cells.push([[0, 0], [w, 0], [w, h], [0, h]]);
      continue;
    }
    const pts: Vec2[] = cell.slice(0, -1).map((p) => [p[0], p[1]] as Vec2);
    cells.push(cleanPolygon(pts));
  }
  return cells;
}

export function buildDistricts(params: GenerationParams, rng: Rng, ids: ReturnType<typeof createIdFactory>): District[] {
  const { w, h } = params.size;
  const n = Math.max(1, params.districts);
  let pts: Vec2[] = [];
  if (n === 1) pts = [[w / 2, h / 2]];
  else {
    for (let i = 0; i < n; i++) pts.push([rng.range(w * 0.15, w * 0.85), rng.range(h * 0.15, h * 0.85)]);
  }
  let cells = voronoiCells(pts, w, h);
  // Relajacion de Lloyd: 2 iteraciones bastan para celdas equilibradas.
  for (let it = 0; it < 2 && n > 1; it++) {
    pts = cells.map((c) => centroid(c));
    cells = voronoiCells(pts, w, h);
  }
  const names = rng.fork('district-names').shuffle(DISTRICT_NAMES[params.naming.locale]);
  const center: Vec2 = [w / 2, h / 2];
  return pts.map((p, i) => {
    const dc = Math.hypot(p[0] - center[0], p[1] - center[1]) / Math.hypot(w / 2, h / 2);
    const dominant: LandUse = dc < params.landUse.retailRadius ? 'retail' : 'residential';
    const mode: GenerationMode = params.mode === 'hybrid' ? (HYBRID_CYCLE[i % HYBRID_CYCLE.length] as GenerationMode) : params.mode;
    return {
      id: ids.district(i),
      name: names[i % names.length] as string,
      center: p,
      polygon: cells[i] as Polygon,
      mode,
      dominantLandUse: dominant,
    };
  });
}

/** Un cuerpo de agua como blob con borde ruidoso anclado a un lado del lienzo. */
export function buildWater(params: GenerationParams, rng: Rng): Polygon[] {
  const ratio = params.landUse.waterRatio;
  if (ratio <= 0.005) return [];
  const { w, h } = params.size;
  const total = w * h * ratio;
  // Semicirculo dentro del lienzo: area = pi r^2 / 2.
  const r = Math.sqrt((2 * total) / Math.PI);
  const side = rng.int(0, 3);
  const t = rng.range(0.25, 0.75);
  const c: Vec2 = side === 0 ? [w * t, 0] : side === 1 ? [w, h * t] : side === 2 ? [w * t, h] : [0, h * t];
  const noise = createSimplex2D(rng.fork('water-noise'));
  const pts: Vec2[] = [];
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const nz = noise(Math.cos(a) * 1.3 + 7, Math.sin(a) * 1.3 + 3);
    const rr = r * (1 + 0.28 * nz);
    pts.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]);
  }
  const clipped = clipToRect(pts, { x: 0, y: 0, w, h });
  return clipped.length >= 3 && polyArea(clipped) > 1 ? [clipped] : [];
}

export function createContext(params: GenerationParams): PipelineContext {
  const root = createRng(params.seed);
  const rngFor = (stage: string): Rng => root.fork(stage);
  const ids = createIdFactory(params.seed);
  const water = buildWater(params, rngFor('water'));
  const districts = buildDistricts(params, rngFor('districts'), ids);
  return {
    params,
    bounds: params.size,
    rng: rngFor,
    ids,
    districts,
    water,
  };
}
