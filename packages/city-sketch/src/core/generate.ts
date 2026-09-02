/** Orquestador puro del pipeline: GenerationInput → CityModel. */
import { buildBlocks } from './blocks/blocks';
import { buildLots } from './blocks/lots';
import { createContext } from './context';
import { clipPolylineToBounds } from './geom/clip';
import { pointInPolygon } from './geom/polygon';
import { polylineLength } from './geom/vec';
import { cleanupGraph } from './graph/cleanup';
import { extractFaces } from './graph/faces';
import { planarize, type InputLine } from './graph/planar';
import { runMode } from './modes';
import { assignStreetNames, buildLabels } from './names/labels';
import { GENERATOR_VERSION, resolveParams } from './params';
import { placePois } from './pois/place';
import { cyrb53 } from './rng/ids';
import type { CityModel, CityNode, GenerationInput, GenerationParams, NodeId, PipelineStage, Street, StreetId, Vec2 } from './types';

export interface GenerateOptions {
  /** Registrar tiempos por etapa en meta.timings. */
  readonly timings?: boolean;
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function configHash(params: GenerationParams): string {
  return cyrb53(stableStringify(params)).toString(16);
}

export function generateCity(input: GenerationInput, options: GenerateOptions = {}): CityModel {
  const { params } = resolveParams(input);
  return generateFromParams(params, options);
}

export function generateFromParams(params: GenerationParams, options: GenerateOptions = {}): CityModel {
  const timings: Partial<Record<PipelineStage, number>> = {};
  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const mark = (stage: PipelineStage, t0: number): void => {
    if (options.timings) timings[stage] = now() - t0;
  };

  let t = now();
  const ctx = createContext(params);
  mark('districts', t);

  t = now();
  const raw = runMode(ctx);
  mark('trace', t);

  t = now();
  const lines: InputLine[] = [];
  for (const l of raw) {
    for (const piece of clipPolylineToBounds(l.points, ctx.bounds)) {
      if (polylineLength(piece) > 0.5) lines.push({ points: piece, cls: l.cls });
    }
  }
  const g = planarize(lines, ctx.bounds, params.cleanup.snapTolerance);
  mark('graph', t);

  t = now();
  cleanupGraph(g, params.cleanup, params.hierarchy);
  mark('cleanup', t);

  // Nodos y calles con ids estables.
  const nodeIds = new Map<number, NodeId>();
  const nodeStreets = new Map<number, StreetId[]>();
  g.nodes.forEach((n, i) => {
    if (!n.alive) return;
    nodeIds.set(i, ctx.ids.node(n.x, n.y));
    nodeStreets.set(i, []);
  });
  const pairCount = new Map<string, number>();
  const edgeStreet = new Map<number, StreetId>();
  const streetsRaw: Street[] = [];
  const width = (cls: Street['class']): number => params.hierarchy[cls];
  g.edges.forEach((e, ei) => {
    if (!e.alive || e.frame) return;
    const from = nodeIds.get(e.a);
    const to = nodeIds.get(e.b);
    if (!from || !to) return;
    const key = `${from}>${to}`;
    const ordinal = pairCount.get(key) ?? 0;
    pairCount.set(key, ordinal + 1);
    const id = ctx.ids.street(from, to, ordinal);
    edgeStreet.set(ei, id);
    nodeStreets.get(e.a)!.push(id);
    nodeStreets.get(e.b)!.push(id);
    const mid = e.polyline[Math.floor(e.polyline.length / 2)] as Vec2;
    const district = ctx.districts.find((d) => pointInPolygon(mid, d.polygon)) ?? ctx.districts[0];
    streetsRaw.push({
      id,
      from,
      to,
      class: e.cls,
      width: width(e.cls),
      polyline: e.polyline.slice(),
      length: polylineLength(e.polyline),
      ...(district ? { districtId: district.id } : {}),
    });
  });
  const nodes: CityNode[] = [];
  g.nodes.forEach((n, i) => {
    if (!n.alive) return;
    const sids = nodeStreets.get(i) ?? [];
    if (sids.length === 0) return;
    nodes.push({ id: nodeIds.get(i)!, x: n.x, y: n.y, degree: sids.length, streetIds: sids, boundary: n.frame });
  });

  t = now();
  const faces = extractFaces(g, true);
  const blocks = buildBlocks(ctx, {
    faces,
    streetOf: (ei) => edgeStreet.get(ei) ?? null,
    widthOf: (ei) => {
      const e = g.edges[ei]!;
      return e.frame ? 2 : width(e.cls);
    },
  });
  mark('blocks', t);

  t = now();
  const lots = buildLots(ctx, blocks, streetsRaw);
  mark('lots', t);

  t = now();
  const streets = assignStreetNames(ctx, streetsRaw);
  mark('names', t);

  t = now();
  const pois = placePois(ctx, blocks, lots, streets);
  mark('pois', t);

  t = now();
  const labels = buildLabels(ctx, streets);
  mark('labels', t);

  return {
    seed: params.seed,
    bounds: ctx.bounds,
    nodes,
    streets,
    blocks,
    lots,
    pois,
    labels,
    districts: ctx.districts,
    meta: {
      generator: '@empresa/city-sketch',
      version: GENERATOR_VERSION,
      params,
      configHash: configHash(params),
      ...(options.timings ? { timings: timings as Record<PipelineStage, number> } : {}),
    },
  };
}
