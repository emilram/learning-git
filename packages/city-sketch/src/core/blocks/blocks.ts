/** Manzanas: caras → inset por ancho de calle → uso de suelo y densidad. */
import { createSimplex2D } from '../geom/noise';
import { area, centroid, cleanPolygon, insetPolygon, pointInPolygon } from '../geom/polygon';
import { dist } from '../geom/vec';
import type { Face } from '../graph/faces';
import type { Block, BlockId, DistrictId, LandUse, PipelineContext, Polygon, StreetId, Vec2 } from '../types';

export interface BlockBuildInput {
  readonly faces: readonly Face[];
  /** StreetId por indice de arista del grafo (null para aristas del marco). */
  readonly streetOf: (ei: number) => StreetId | null;
  readonly widthOf: (ei: number) => number;
}

interface Draft {
  outline: Vec2[];
  polygon: Vec2[];
  streetIds: StreetId[];
  centroid: Vec2;
  area: number;
  districtId: DistrictId;
  density: number;
  score: number;
  noise: number;
  landUse: LandUse;
}

function nearestDistrict(ctx: PipelineContext, p: Vec2): { id: DistrictId; center: Vec2 } {
  let best = ctx.districts[0]!;
  let bd = Infinity;
  for (const d of ctx.districts) {
    if (pointInPolygon(p, d.polygon)) return { id: d.id, center: d.center };
    const dd = dist(p, d.center);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  return { id: best.id, center: best.center };
}

export function buildBlocks(ctx: PipelineContext, input: BlockBuildInput): Block[] {
  const { params, bounds } = ctx;
  const noise = createSimplex2D(ctx.rng('landuse'));
  const cityCenter: Vec2 = [bounds.w / 2, bounds.h / 2];
  const maxR = Math.hypot(bounds.w / 2, bounds.h / 2);
  const minArea = params.blockSize.min * params.blockSize.min * 0.2;
  const drafts: Draft[] = [];
  for (const f of input.faces) {
    const outline = cleanPolygon(f.polygon);
    if (outline.length < 3) continue;
    // Anchos por segmento: el poligono limpio puede haber perdido vertices; reasignar por proximidad.
    const distances: number[] = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!;
      const b = outline[(i + 1) % outline.length]!;
      const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < f.polygon.length; j++) {
        const pa = f.polygon[j]!;
        const pb = f.polygon[(j + 1) % f.polygon.length]!;
        const pm: Vec2 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        const d = dist(m, pm);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      distances.push(input.widthOf(f.segmentEdge[best] as number) / 2 + 1.5);
    }
    let polygon = insetPolygon(outline, distances);
    if (!polygon) {
      // Fallback: inset uniforme mas pequeno.
      const u = Math.min(...distances) * 0.6;
      polygon = insetPolygon(outline, outline.map(() => u));
    }
    if (!polygon) continue;
    const a = area(polygon);
    if (a < minArea) continue;
    const seen = new Set<string>();
    const streetIds: StreetId[] = [];
    for (const e of f.edges) {
      const sid = input.streetOf(e.ei);
      if (sid && !seen.has(sid)) {
        seen.add(sid);
        streetIds.push(sid);
      }
    }
    if (streetIds.length === 0) continue;
    const c = centroid(polygon);
    const d = nearestDistrict(ctx, c);
    const nz = 0.5 + 0.5 * noise(c[0] / 220, c[1] / 220);
    const dCity = dist(c, cityCenter) / maxR;
    const dDistrict = dist(c, d.center) / (maxR * 0.6);
    const density = Math.max(0, Math.min(1, (1 - dCity) * 0.7 + (1 - Math.min(1, dDistrict)) * 0.3));
    const lu = params.landUse;
    const proximity = 1 - Math.min(1, Math.min(dCity, dDistrict * 1.2) / Math.max(0.05, lu.retailRadius));
    const score = proximity * (1 - lu.noise) + nz * lu.noise;
    drafts.push({
      outline,
      polygon,
      streetIds,
      centroid: c,
      area: a,
      districtId: d.id,
      density,
      score,
      noise: nz,
      landUse: score > 0.55 ? 'retail' : 'residential',
    });
  }

  // Agua.
  for (const b of drafts) {
    for (const w of ctx.water) {
      if (pointInPolygon(b.centroid, w)) {
        b.landUse = 'water';
        break;
      }
    }
  }
  const totalArea = drafts.reduce((s, b) => s + b.area, 0);
  // Plazas: manzanas comerciales pequenas.
  let budget = totalArea * params.landUse.plazaRatio;
  for (const b of drafts.filter((x) => x.landUse === 'retail').sort((p, q) => p.area - q.area)) {
    if (budget <= 0) break;
    b.landUse = 'plaza';
    budget -= b.area;
  }
  // Parques: manzanas grandes con mayor ruido, preferentemente fuera del centro.
  budget = totalArea * params.landUse.parkRatio;
  for (const b of drafts
    .filter((x) => x.landUse === 'residential')
    .sort((p, q) => q.noise * (1 + (1 - q.density)) - p.noise * (1 + (1 - p.density)))) {
    if (budget <= 0) break;
    b.landUse = 'park';
    budget -= b.area;
  }

  return drafts.map((b) => ({
    id: ctx.ids.block(b.centroid) as BlockId,
    polygon: b.polygon as Polygon,
    outline: b.outline as Polygon,
    streetIds: b.streetIds,
    landUse: b.landUse,
    districtId: b.districtId,
    area: b.area,
    centroid: b.centroid,
    density: b.density,
  }));
}
