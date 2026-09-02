/** Subdivision de lotes: OBB recursiva (Vanegas 2012) con garantia de frente a calle, o franja frontal (skeleton). */
import { area, insetPolygon, orientedBoundingBox, splitPolygon, cleanPolygon, signedArea } from '../geom/polygon';
import { projectOnSegment, perp, scale, add, dist } from '../geom/vec';
import type { Block, Lot, PipelineContext, Polygon, Street, StreetId, Vec2 } from '../types';

interface Frontage {
  streetId: StreetId;
  point: Vec2;
}

function findFrontage(poly: Polygon, streets: readonly Street[], tolerance: number): Frontage | null {
  let best: Frontage | null = null;
  let bestLen = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const edgeLen = dist(a, b);
    for (const s of streets) {
      const limit = s.width / 2 + tolerance;
      const pl = s.polyline;
      for (let j = 0; j + 1 < pl.length; j++) {
        const [, , d2] = projectOnSegment(m, pl[j]!, pl[j + 1]!);
        if (d2 <= limit * limit && edgeLen > bestLen) {
          bestLen = edgeLen;
          best = { streetId: s.id, point: m };
        }
      }
    }
  }
  return best;
}

export function buildLots(ctx: PipelineContext, blocks: readonly Block[], streets: readonly Street[]): Lot[] {
  const { params } = ctx;
  const rng = ctx.rng('lots');
  const lp = params.lots;
  const streetById = new Map(streets.map((s) => [s.id, s]));
  const lots: Lot[] = [];
  for (const block of blocks) {
    if (block.landUse === 'park' || block.landUse === 'water' || block.landUse === 'plaza') continue;
    const bs = block.streetIds.map((id) => streetById.get(id)).filter((s): s is Street => s !== undefined);
    if (bs.length === 0) continue;
    const brng = rng.fork(block.id);
    if (brng.chance(lp.skipChance)) continue;
    const tolerance = 4;
    const pieces: { poly: Vec2[]; front: Frontage }[] = [];
    const emit = (poly: Vec2[]): boolean => {
      const f = findFrontage(poly, bs, tolerance);
      if (!f) return false;
      pieces.push({ poly, front: f });
      return true;
    };
    const trySplit = (poly: Vec2[], axis: Vec2, center: Vec2, half: number): readonly [Vec2[], Vec2[]] | null => {
      const jitter = brng.range(-lp.splitJitter, lp.splitJitter) * half * 2;
      const o = add(center, scale(axis, jitter));
      const [p1, p2] = splitPolygon(poly, o, perp(axis));
      if (p1.length < 3 || p2.length < 3) return null;
      if (area(p1) < lp.minArea * 0.5 || area(p2) < lp.minArea * 0.5) return null;
      if (!findFrontage(p1, bs, tolerance) || !findFrontage(p2, bs, tolerance)) return null;
      return [p1, p2];
    };
    const recurse = (poly: Vec2[], depth: number): void => {
      if (area(poly) <= lp.maxArea || depth > 14) {
        emit(poly);
        return;
      }
      const obb = orientedBoundingBox(poly);
      let r = trySplit(poly, obb.axis, obb.center, obb.halfLong);
      if (!r) r = trySplit(poly, perp(obb.axis), obb.center, obb.halfShort);
      if (!r) {
        emit(poly);
        return;
      }
      recurse(r[0], depth + 1);
      recurse(r[1], depth + 1);
    };
    if (lp.method === 'skeleton') {
      // Franja frontal: anillo entre el poligono y su inset a frontageDepth, cortado por perpendiculares.
      const inner = insetPolygon(block.polygon, block.polygon.map(() => lp.frontageDepth));
      if (!inner) {
        recurse(block.polygon.slice(), 0);
      } else {
        // Cada arista exterior genera un cuadrilatero aproximado (ancho ~ sqrt(minArea)); el nucleo se subdivide por OBB.
        const step = Math.sqrt(lp.minArea);
        const outline = block.polygon;
        for (let i = 0; i < outline.length; i++) {
          const a = outline[i]!;
          const b = outline[(i + 1) % outline.length]!;
          const L = dist(a, b);
          const n = Math.max(1, Math.round(L / step));
          const dir: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
          const nrm = scale(perp(dir), signedArea(outline) > 0 ? 1 : -1);
          for (let k = 0; k < n; k++) {
            const t0 = k / n;
            const t1 = (k + 1) / n;
            const p0: Vec2 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
            const p1: Vec2 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
            const q = cleanPolygon([p0, p1, add(p1, scale(nrm, lp.frontageDepth)), add(p0, scale(nrm, lp.frontageDepth))]);
            if (q.length >= 3 && area(q) >= lp.minArea * 0.3) emit(q);
          }
        }
        if (area(inner) > lp.minArea) recurse(inner, 0);
      }
    } else {
      recurse(block.polygon.slice(), 0);
    }
    pieces.forEach((p, i) => {
      lots.push({
        id: ctx.ids.lot(block.id, i),
        blockId: block.id,
        polygon: p.poly,
        frontage: p.front.streetId,
        frontPoint: p.front.point,
        area: area(p.poly),
      });
    });
  }
  return lots;
}
