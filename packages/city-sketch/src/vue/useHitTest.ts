/**
 * useHitTest: quadtree de POIs (d3-quadtree) + point-in-polygon sobre manzanas
 * candidatas por centroide. Un solo listener delegado en el <svg>.
 */
import { quadtree, type Quadtree } from 'd3-quadtree';
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import { pointInPolygon } from '../core/geom/polygon';
import type { Block, CityModel, Poi } from '../core/types';

export interface HitResult {
  readonly poi: Poi | null;
  readonly block: Block | null;
}

export interface HitTester {
  readonly ready: ComputedRef<boolean>;
  hit(x: number, y: number, radius: number): HitResult;
  nearestPoi(x: number, y: number, radius: number): Poi | null;
}

export function useHitTest(model: MaybeRefOrGetter<CityModel | null>): HitTester {
  const trees = computed(() => {
    const m = toValue(model);
    if (!m) return null;
    const pois: Quadtree<Poi> = quadtree<Poi>()
      .x((d) => d.x)
      .y((d) => d.y)
      .addAll(m.pois as Poi[]);
    const blocks: Quadtree<Block> = quadtree<Block>()
      .x((d) => d.centroid[0])
      .y((d) => d.centroid[1])
      .addAll(m.blocks as Block[]);
    let maxR = 0;
    for (const b of m.blocks) {
      for (const p of b.outline) maxR = Math.max(maxR, Math.hypot(p[0] - b.centroid[0], p[1] - b.centroid[1]));
    }
    return { pois, blocks, maxR };
  });
  const nearestPoi = (x: number, y: number, radius: number): Poi | null => trees.value?.pois.find(x, y, radius) ?? null;
  return {
    ready: computed(() => trees.value !== null),
    nearestPoi,
    hit(x, y, radius) {
      const t = trees.value;
      if (!t) return { poi: null, block: null };
      const poi = t.pois.find(x, y, radius) ?? null;
      let block: Block | null = null;
      // Visitar solo nodos del quadtree cuyo rectangulo pueda contener una manzana que cubra (x, y).
      const r = t.maxR;
      t.blocks.visit((node, x0, y0, x1, y1) => {
        if (x0 > x + r || x1 < x - r || y0 > y + r || y1 < y - r) return true;
        if (!('length' in node)) {
          let leaf: typeof node | undefined = node;
          while (leaf) {
            const b = leaf.data;
            if (!block && pointInPolygon([x, y], b.outline)) block = b;
            leaf = leaf.next;
          }
        }
        return block !== null;
      });
      return { poi, block };
    },
  };
}
