/** Colocacion de POIs: manual (lote o coordenadas normalizadas) y auto (ponderado por retail/densidad, separacion por quadtree). */
import { quadtree } from 'd3-quadtree';
import { projectOnSegment } from '../geom/vec';
import type { Block, Lot, PipelineContext, Poi, PoiSpec, Street, StreetId, Vec2 } from '../types';

function nearestStreet(p: Vec2, streets: readonly Street[]): StreetId | undefined {
  let best: StreetId | undefined;
  let bd = Infinity;
  for (const s of streets) {
    const pl = s.polyline;
    for (let j = 0; j + 1 < pl.length; j++) {
      const [, , d2] = projectOnSegment(p, pl[j]!, pl[j + 1]!);
      if (d2 < bd) {
        bd = d2;
        best = s.id;
      }
    }
  }
  return best;
}

export function placePois(ctx: PipelineContext, blocks: readonly Block[], lots: readonly Lot[], streets: readonly Street[]): Poi[] {
  const { params, bounds } = ctx;
  const pp = params.pois;
  const rng = ctx.rng('pois');
  const lotById = new Map(lots.map((l) => [l.id as string, l]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const placed: Poi[] = [];
  const tree = quadtree<Vec2>()
    .x((d) => d[0])
    .y((d) => d[1]);
  const tooClose = (p: Vec2): boolean => {
    const q = tree.find(p[0], p[1], pp.minSpacing);
    return q !== undefined;
  };
  const overrides = params.overrides.pois ?? {};

  const fromSpec = (spec: PoiSpec, index: number): Poi | null => {
    const key = spec.id ?? spec.externalId ?? `${spec.label}#${index}`;
    const id = ctx.ids.poi(key);
    let x: number;
    let y: number;
    let anchor: Poi['anchor'];
    if (spec.lotId && lotById.has(spec.lotId)) {
      const lot = lotById.get(spec.lotId)!;
      [x, y] = lot.frontPoint;
      anchor = { kind: 'lot', lotId: lot.id };
    } else if (typeof spec.nx === 'number' && typeof spec.ny === 'number') {
      x = spec.nx * bounds.w;
      y = spec.ny * bounds.h;
      anchor = { kind: 'normalized', nx: spec.nx, ny: spec.ny };
    } else {
      return null;
    }
    const poi: Poi = {
      id,
      anchor,
      x,
      y,
      kind: spec.kind ?? 'store',
      label: spec.label,
      tags: spec.tags ?? [],
      ...(spec.externalId !== undefined ? { externalId: spec.externalId } : {}),
      ...(nearestStreet([x, y], streets) !== undefined ? { streetId: nearestStreet([x, y], streets) as StreetId } : {}),
      ...(spec.overrides ?? overrides[key] ? { overrides: { ...(overrides[key] ?? {}), ...(spec.overrides ?? {}) } } : {}),
    };
    return poi;
  };

  // Manuales primero (fijos en ambos modos).
  pp.items.forEach((spec, i) => {
    const poi = fromSpec(spec, i);
    if (poi) {
      placed.push(poi);
      tree.add([poi.x, poi.y]);
    }
  });
  if (pp.mode === 'manual') return placed;

  // Auto: muestreo ponderado sin reemplazo sobre lotes.
  const candidates = lots
    .map((lot) => {
      const b = blockById.get(lot.blockId);
      if (!b) return null;
      const retail = b.landUse === 'retail' ? 1 : b.landUse === 'residential' ? 0.25 : 0;
      const w = pp.retailBias * retail + (1 - pp.retailBias) * b.density;
      return w > 0 ? { lot, w } : null;
    })
    .filter((c): c is { lot: Lot; w: number } => c !== null);
  const labels = rng.fork('labels');
  let remaining = pp.count - placed.length;
  let attempts = 0;
  const pool = candidates.slice();
  while (remaining > 0 && pool.length > 0 && attempts++ < pp.count * 20) {
    const total = pool.reduce((s, c) => s + c.w, 0);
    let r = rng.next() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx]!.w;
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    const c = pool[idx]!;
    pool.splice(idx, 1);
    const p = c.lot.frontPoint;
    if (tooClose(p)) continue;
    const ordinal = placed.length + 1;
    const key = `auto-${c.lot.id}`;
    const poi: Poi = {
      id: ctx.ids.poi(key),
      anchor: { kind: 'lot', lotId: c.lot.id },
      x: p[0],
      y: p[1],
      kind: labels.chance(0.12) ? 'flagship' : labels.chance(0.1) ? 'kiosk' : 'store',
      label: `Tienda ${String(ordinal).padStart(2, '0')}`,
      tags: [blockById.get(c.lot.blockId)!.landUse],
      streetId: c.lot.frontage,
      ...(overrides[key] ? { overrides: overrides[key]! } : {}),
    };
    placed.push(poi);
    tree.add(p);
    remaining--;
  }
  return placed;
}
