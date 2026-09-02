/**
 * Isocronas sinteticas de cobertura por tienda: Dijkstra sobre el grafo de
 * calles desde el nodo mas cercano y envolvente convexa de los puntos
 * alcanzados por banda de distancia. Determinista y sin datos reales.
 */
import { polygonHull } from 'd3-polygon';
import { dist, projectOnSegment } from '../geom/vec';
import type { CityModel, NodeId, Poi, Polygon, Vec2 } from '../types';

export interface IsochroneBand {
  readonly poiId: string;
  /** Distancia maxima de la banda (unidades de mundo). */
  readonly distance: number;
  readonly polygon: Polygon;
}

interface GraphIndex {
  readonly nodeIndex: Map<NodeId, number>;
  readonly nodePos: Vec2[];
  readonly adj: { to: number; w: number; pts: readonly Vec2[] }[][];
}

function buildIndex(model: CityModel): GraphIndex {
  const nodeIndex = new Map<NodeId, number>();
  const nodePos: Vec2[] = [];
  model.nodes.forEach((n, i) => {
    nodeIndex.set(n.id, i);
    nodePos.push([n.x, n.y]);
  });
  const adj: GraphIndex['adj'] = model.nodes.map(() => []);
  for (const s of model.streets) {
    const a = nodeIndex.get(s.from);
    const b = nodeIndex.get(s.to);
    if (a === undefined || b === undefined) continue;
    adj[a]!.push({ to: b, w: s.length, pts: s.polyline });
    adj[b]!.push({ to: a, w: s.length, pts: s.polyline });
  }
  return { nodeIndex, nodePos, adj };
}

function nearestNode(model: CityModel, idx: GraphIndex, p: Vec2): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < idx.nodePos.length; i++) {
    const d = dist(p, idx.nodePos[i]!);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  void model;
  return best;
}

/**
 * Calcula bandas de isocrona para cada POI. `distances` ordenadas ascendentes.
 * Las bandas incluyen puntos intermedios de las polilineas alcanzadas, por lo que
 * la envolvente sigue la forma de la red y no solo los nodos.
 */
export function computeIsochrones(model: CityModel, pois: readonly Poi[], distances: readonly number[]): IsochroneBand[] {
  const idx = buildIndex(model);
  const out: IsochroneBand[] = [];
  const maxD = Math.max(...distances);
  for (const poi of pois) {
    const start = nearestNode(model, idx, [poi.x, poi.y]);
    const distTo = new Float64Array(idx.nodePos.length).fill(Infinity);
    distTo[start] = dist([poi.x, poi.y], idx.nodePos[start]!);
    const visited = new Uint8Array(idx.nodePos.length);
    // Cola por seleccion lineal: los grafos son pequenos (< 2000 nodos).
    for (;;) {
      let u = -1;
      let ud = Infinity;
      for (let i = 0; i < distTo.length; i++) {
        if (!visited[i] && distTo[i]! < ud) {
          ud = distTo[i]!;
          u = i;
        }
      }
      if (u < 0 || ud > maxD) break;
      visited[u] = 1;
      for (const e of idx.adj[u]!) {
        const nd = ud + e.w;
        if (nd < distTo[e.to]!) distTo[e.to] = nd;
      }
    }
    for (const d of distances) {
      const pts: [number, number][] = [[poi.x, poi.y]];
      for (let i = 0; i < distTo.length; i++) {
        if (distTo[i]! <= d) {
          pts.push([idx.nodePos[i]![0], idx.nodePos[i]![1]]);
          // Puntos parciales sobre aristas salientes que exceden la banda.
          for (const e of idx.adj[i]!) {
            const remain = d - distTo[i]!;
            if (remain <= 0 || remain >= e.w) continue;
            const from = idx.nodePos[i]!;
            const pl = e.pts[0] && dist(e.pts[0], from) < 1e-6 ? e.pts : e.pts.slice().reverse();
            let acc = 0;
            for (let k = 1; k < pl.length; k++) {
              const L = dist(pl[k - 1]!, pl[k]!);
              if (acc + L >= remain) {
                const t = (remain - acc) / L;
                pts.push([pl[k - 1]![0] + (pl[k]![0] - pl[k - 1]![0]) * t, pl[k - 1]![1] + (pl[k]![1] - pl[k - 1]![1]) * t]);
                break;
              }
              acc += L;
            }
          }
        }
      }
      // Radio minimo para que la banda exista aunque la red sea escasa.
      if (pts.length < 3) {
        for (let a = 0; a < 8; a++) pts.push([poi.x + Math.cos((a / 8) * Math.PI * 2) * d * 0.5, poi.y + Math.sin((a / 8) * Math.PI * 2) * d * 0.5]);
      }
      const hull = polygonHull(pts);
      if (hull) out.push({ poiId: poi.id, distance: d, polygon: hull.map((q) => [q[0], q[1]] as Vec2) });
    }
  }
  return out;
}

/** Proyecta un punto sobre la calle mas cercana (util para "snap" al arrastrar tiendas). */
export function snapToStreet(model: CityModel, p: Vec2): { point: Vec2; streetId: string } | null {
  let best: { point: Vec2; streetId: string } | null = null;
  let bd = Infinity;
  for (const s of model.streets) {
    for (let i = 0; i + 1 < s.polyline.length; i++) {
      const [q, , d2] = projectOnSegment(p, s.polyline[i]!, s.polyline[i + 1]!);
      if (d2 < bd) {
        bd = d2;
        best = { point: q, streetId: s.id };
      }
    }
  }
  return best;
}
