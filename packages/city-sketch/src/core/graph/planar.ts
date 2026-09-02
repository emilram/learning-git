/**
 * Grafo planar mutable: planarizacion de polilineas (intersecciones + snap),
 * limpieza topologica y utilidades de adyacencia.
 */
import { dist, segIntersect, polylineLength, angle, sub } from '../geom/vec';
import type { Bounds, StreetClass, Vec2 } from '../types';

export interface GNode {
  x: number;
  y: number;
  frame: boolean;
  alive: boolean;
}

export interface GEdge {
  a: number;
  b: number;
  cls: StreetClass;
  polyline: Vec2[];
  frame: boolean;
  alive: boolean;
}

export interface InputLine {
  readonly points: readonly Vec2[];
  readonly cls: StreetClass;
  readonly frame?: boolean;
}

export class PlanarGraph {
  readonly nodes: GNode[] = [];
  readonly edges: GEdge[] = [];
  private adj: number[][] = [];
  private adjDirty = true;

  constructor(readonly bounds: Bounds) {}

  addNode(x: number, y: number, frame = false): number {
    this.nodes.push({ x, y, frame, alive: true });
    this.adjDirty = true;
    return this.nodes.length - 1;
  }

  addEdge(a: number, b: number, cls: StreetClass, polyline: Vec2[], frame = false): number {
    this.edges.push({ a, b, cls, polyline, frame, alive: true });
    this.adjDirty = true;
    return this.edges.length - 1;
  }

  adjacency(): number[][] {
    if (!this.adjDirty) return this.adj;
    this.adj = this.nodes.map(() => []);
    this.edges.forEach((e, i) => {
      if (!e.alive) return;
      (this.adj[e.a] as number[]).push(i);
      (this.adj[e.b] as number[]).push(i);
    });
    this.adjDirty = false;
    return this.adj;
  }

  degree(n: number): number {
    return (this.adjacency()[n] as number[]).length;
  }

  other(e: GEdge, n: number): number {
    return e.a === n ? e.b : e.a;
  }

  /** Direccion de salida de la arista desde el nodo n (primer segmento). */
  outDir(ei: number, n: number): Vec2 {
    const e = this.edges[ei] as GEdge;
    const pl = e.polyline;
    if (e.a === n) return sub(pl[1] as Vec2, pl[0] as Vec2);
    return sub(pl[pl.length - 2] as Vec2, pl[pl.length - 1] as Vec2);
  }

  outAngle(ei: number, n: number): number {
    return angle(this.outDir(ei, n));
  }

  edgeLength(ei: number): number {
    return polylineLength((this.edges[ei] as GEdge).polyline);
  }

  killEdge(ei: number): void {
    (this.edges[ei] as GEdge).alive = false;
    this.adjDirty = true;
  }

  killNode(n: number): void {
    (this.nodes[n] as GNode).alive = false;
    this.adjDirty = true;
  }

  /** Reemplaza el nodo `from` por `to` en todas las aristas y actualiza polilineas. */
  mergeNodeInto(from: number, to: number): void {
    const target = this.nodes[to] as GNode;
    for (const e of this.edges) {
      if (!e.alive) continue;
      if (e.a === from) {
        e.a = to;
        e.polyline[0] = [target.x, target.y];
      }
      if (e.b === from) {
        e.b = to;
        e.polyline[e.polyline.length - 1] = [target.x, target.y];
      }
    }
    this.killNode(from);
  }

  moveNode(n: number, x: number, y: number): void {
    const nd = this.nodes[n] as GNode;
    nd.x = x;
    nd.y = y;
    for (const e of this.edges) {
      if (!e.alive) continue;
      if (e.a === n) e.polyline[0] = [x, y];
      if (e.b === n) e.polyline[e.polyline.length - 1] = [x, y];
    }
  }
}

interface Split {
  seg: number;
  t: number;
}

/**
 * Planariza: detecta intersecciones entre segmentos, parte polilineas y
 * fusiona extremos a `snap`. El marco del lienzo se agrega como aristas `frame`.
 */
export function planarize(lines: readonly InputLine[], bounds: Bounds, snap: number): PlanarGraph {
  const g = new PlanarGraph(bounds);
  const all: InputLine[] = [
    ...lines,
    { points: [[0, 0], [bounds.w, 0]], cls: 'street', frame: true },
    { points: [[bounds.w, 0], [bounds.w, bounds.h]], cls: 'street', frame: true },
    { points: [[bounds.w, bounds.h], [0, bounds.h]], cls: 'street', frame: true },
    { points: [[0, bounds.h], [0, 0]], cls: 'street', frame: true },
  ];

  // Indexar segmentos en rejilla.
  const cell = Math.max(16, snap * 4);
  const cols = Math.ceil(bounds.w / cell) + 3;
  const buckets = new Map<number, number[]>();
  const segLine: number[] = [];
  const segIdx: number[] = [];
  const segKey = (x: number, y: number): number => (Math.floor(y / cell) + 1) * cols + Math.floor(x / cell) + 1;
  all.forEach((ln, li) => {
    for (let i = 0; i + 1 < ln.points.length; i++) {
      const sid = segLine.length;
      segLine.push(li);
      segIdx.push(i);
      const a = ln.points[i] as Vec2;
      const b = ln.points[i + 1] as Vec2;
      const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
      const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
      const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const k = (y + 1) * cols + x + 1;
          let arr = buckets.get(k);
          if (!arr) {
            arr = [];
            buckets.set(k, arr);
          }
          arr.push(sid);
        }
      }
    }
  });
  void segKey;

  const splits: Split[][] = all.map(() => []);
  const vertexNodes: Set<number>[] = all.map(() => new Set<number>());
  const seen = new Set<number>();
  const EPS = 1e-6;
  for (const arr of buckets.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const s1 = arr[i] as number;
        const s2 = arr[j] as number;
        const l1 = segLine[s1] as number;
        const l2 = segLine[s2] as number;
        if (l1 === l2) continue;
        const pairKey = s1 < s2 ? s1 * 1e7 + s2 : s2 * 1e7 + s1;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const i1 = segIdx[s1] as number;
        const i2 = segIdx[s2] as number;
        const p1 = (all[l1] as InputLine).points;
        const p2 = (all[l2] as InputLine).points;
        const r = segIntersect(p1[i1] as Vec2, p1[i1 + 1] as Vec2, p2[i2] as Vec2, p2[i2 + 1] as Vec2);
        if (!r) continue;
        const [t, u] = r;
        if (t > EPS && t < 1 - EPS) (splits[l1] as Split[]).push({ seg: i1, t });
        else (vertexNodes[l1] as Set<number>).add(t <= EPS ? i1 : i1 + 1);
        if (u > EPS && u < 1 - EPS) (splits[l2] as Split[]).push({ seg: i2, t: u });
        else (vertexNodes[l2] as Set<number>).add(u <= EPS ? i2 : i2 + 1);
      }
    }
  }

  // Snap de nodos por rejilla hash.
  const snapCell = Math.max(snap, 1e-3);
  const snapCols = Math.ceil(bounds.w / snapCell) + 3;
  const nodeBuckets = new Map<number, number[]>();
  const findOrCreate = (p: Vec2, frame: boolean): number => {
    const cx = Math.floor(p[0] / snapCell) + 1;
    const cy = Math.floor(p[1] / snapCell) + 1;
    let best = -1;
    let bd = snap * snap;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = nodeBuckets.get((cy + dy) * snapCols + cx + dx);
        if (!arr) continue;
        for (const ni of arr) {
          const n = g.nodes[ni] as GNode;
          const d = (n.x - p[0]) ** 2 + (n.y - p[1]) ** 2;
          if (d <= bd) {
            bd = d;
            best = ni;
          }
        }
      }
    }
    if (best >= 0) {
      if (frame) (g.nodes[best] as GNode).frame = true;
      return best;
    }
    const ni = g.addNode(p[0], p[1], frame);
    const k = cy * snapCols + cx;
    let arr = nodeBuckets.get(k);
    if (!arr) {
      arr = [];
      nodeBuckets.set(k, arr);
    }
    arr.push(ni);
    return ni;
  };

  all.forEach((ln, li) => {
    const pts = ln.points;
    const sp = (splits[li] as Split[]).sort((a, b) => a.seg - b.seg || a.t - b.t);
    // Construir secuencia de vertices con marcas de nodo.
    const verts: { p: Vec2; node: boolean }[] = [];
    let si = 0;
    for (let i = 0; i < pts.length; i++) {
      verts.push({ p: pts[i] as Vec2, node: i === 0 || i === pts.length - 1 || (vertexNodes[li] as Set<number>).has(i) });
      if (i + 1 < pts.length) {
        const a = pts[i] as Vec2;
        const b = pts[i + 1] as Vec2;
        let lastT = -1;
        while (si < sp.length && (sp[si] as Split).seg === i) {
          const t = (sp[si] as Split).t;
          si++;
          if (t - lastT < 1e-6) continue;
          lastT = t;
          verts.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], node: true });
        }
      }
    }
    const frame = ln.frame === true;
    let startNode = -1;
    let chain: Vec2[] = [];
    for (const vtx of verts) {
      if (vtx.node) {
        const ni = findOrCreate(vtx.p, frame);
        if (startNode < 0) {
          startNode = ni;
          chain = [[(g.nodes[ni] as GNode).x, (g.nodes[ni] as GNode).y]];
        } else {
          chain.push([(g.nodes[ni] as GNode).x, (g.nodes[ni] as GNode).y]);
          if (ni !== startNode && polylineLength(chain) > 1e-6) {
            g.addEdge(startNode, ni, ln.cls, chain, frame);
          }
          startNode = ni;
          chain = [[(g.nodes[ni] as GNode).x, (g.nodes[ni] as GNode).y]];
        }
      } else if (startNode >= 0) {
        chain.push(vtx.p);
      }
    }
  });
  return g;
}

export function edgeOrDefault(g: PlanarGraph, ei: number): GEdge {
  return g.edges[ei] as GEdge;
}

export function nodeDist(g: PlanarGraph, a: number, b: number): number {
  const na = g.nodes[a] as GNode;
  const nb = g.nodes[b] as GNode;
  return dist([na.x, na.y], [nb.x, nb.y]);
}
