/**
 * Empaquetado del CityModel para transferencia estructurada entre worker y
 * hilo principal: toda la geometria va en un unico Float64Array transferible
 * y el resto (ids, clases, meta) en un objeto pequeno.
 */
import type { Block, CityModel, CityNode, Label, Lot, Poi, Polygon, Street, Vec2 } from './types';

export interface PackedModel {
  readonly coords: Float64Array;
  readonly json: PackedJson;
}

interface PackedJson {
  seed: string;
  bounds: CityModel['bounds'];
  meta: CityModel['meta'];
  districts: CityModel['districts'];
  nodes: readonly CityNode[];
  streets: readonly (Omit<Street, 'polyline'> & { o: number; n: number })[];
  blocks: readonly (Omit<Block, 'polygon' | 'outline'> & { po: number; pn: number; oo: number; on: number })[];
  lots: readonly (Omit<Lot, 'polygon'> & { o: number; n: number })[];
  pois: readonly Poi[];
  labels: readonly (Omit<Label, 'path'> & { o: number; n: number })[];
}

export function packModel(m: CityModel): PackedModel {
  let total = 0;
  for (const s of m.streets) total += s.polyline.length * 2;
  for (const b of m.blocks) total += (b.polygon.length + b.outline.length) * 2;
  for (const l of m.lots) total += l.polygon.length * 2;
  for (const l of m.labels) total += l.path.length * 2;
  const coords = new Float64Array(total);
  let off = 0;
  const put = (pts: readonly Vec2[]): { o: number; n: number } => {
    const o = off;
    for (const p of pts) {
      coords[off++] = p[0];
      coords[off++] = p[1];
    }
    return { o, n: pts.length };
  };
  const json: PackedJson = {
    seed: m.seed,
    bounds: m.bounds,
    meta: m.meta,
    districts: m.districts,
    nodes: m.nodes,
    streets: m.streets.map((s) => {
      const { polyline, ...rest } = s;
      return { ...rest, ...put(polyline) };
    }),
    blocks: m.blocks.map((b) => {
      const { polygon, outline, ...rest } = b;
      const p = put(polygon);
      const o = put(outline);
      return { ...rest, po: p.o, pn: p.n, oo: o.o, on: o.n };
    }),
    lots: m.lots.map((l) => {
      const { polygon, ...rest } = l;
      return { ...rest, ...put(polygon) };
    }),
    pois: m.pois,
    labels: m.labels.map((l) => {
      const { path, ...rest } = l;
      return { ...rest, ...put(path) };
    }),
  };
  return { coords, json };
}

export function unpackModel(p: PackedModel): CityModel {
  const c = p.coords;
  const get = (o: number, n: number): Vec2[] => {
    const out: Vec2[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = [c[o + i * 2]!, c[o + i * 2 + 1]!];
    return out;
  };
  const j = p.json;
  return {
    seed: j.seed,
    bounds: j.bounds,
    meta: j.meta,
    districts: j.districts,
    nodes: j.nodes,
    streets: j.streets.map(({ o, n, ...rest }) => ({ ...rest, polyline: get(o, n) })),
    blocks: j.blocks.map(({ po, pn, oo, on, ...rest }) => ({ ...rest, polygon: get(po, pn) as Polygon, outline: get(oo, on) as Polygon })),
    lots: j.lots.map(({ o, n, ...rest }) => ({ ...rest, polygon: get(o, n) as Polygon })),
    pois: j.pois,
    labels: j.labels.map(({ o, n, ...rest }) => ({ ...rest, path: get(o, n) })),
  };
}
