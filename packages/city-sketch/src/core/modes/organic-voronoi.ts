/** Centro historico: Poisson-disk + Voronoi relajado; avenidas = caminos minimos sobre aristas Voronoi. */
import { Delaunay } from 'd3-delaunay';
import { centroid, cleanPolygon } from '../geom/polygon';
import { dist } from '../geom/vec';
import type { ModeGenerator, RawLine, Rng, Vec2, Bounds } from '../types';

function poissonDisk(bounds: Bounds, r: number, rng: Rng): Vec2[] {
  const cell = r / Math.SQRT2;
  const gw = Math.ceil(bounds.w / cell);
  const gh = Math.ceil(bounds.h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts: Vec2[] = [];
  const active: number[] = [];
  const insert = (p: Vec2): void => {
    grid[Math.floor(p[1] / cell) * gw + Math.floor(p[0] / cell)] = pts.length;
    pts.push(p);
    active.push(pts.length - 1);
  };
  const ok = (p: Vec2): boolean => {
    if (p[0] < 0 || p[1] < 0 || p[0] >= bounds.w || p[1] >= bounds.h) return false;
    const gx = Math.floor(p[0] / cell);
    const gy = Math.floor(p[1] / cell);
    for (let y = Math.max(0, gy - 2); y <= Math.min(gh - 1, gy + 2); y++) {
      for (let x = Math.max(0, gx - 2); x <= Math.min(gw - 1, gx + 2); x++) {
        const i = grid[y * gw + x] as number;
        if (i >= 0 && dist(pts[i] as Vec2, p) < r) return false;
      }
    }
    return true;
  };
  insert([rng.range(0, bounds.w), rng.range(0, bounds.h)]);
  while (active.length) {
    const ai = rng.int(0, active.length - 1);
    const base = pts[active[ai] as number] as Vec2;
    let found = false;
    for (let k = 0; k < 20; k++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = rng.range(r, 2 * r);
      const p: Vec2 = [base[0] + Math.cos(a) * rr, base[1] + Math.sin(a) * rr];
      if (ok(p)) {
        insert(p);
        found = true;
        break;
      }
    }
    if (!found) {
      active[ai] = active[active.length - 1] as number;
      active.pop();
    }
  }
  return pts;
}

export const organicVoronoiMode: ModeGenerator = (ctx) => {
  const { params, bounds } = ctx;
  const rng = ctx.rng('organic');
  const r = ((params.blockSize.min + params.blockSize.max) / 2) * (1.4 - params.density * 0.8);
  let pts = poissonDisk(bounds, r, rng);
  const box: [number, number, number, number] = [0, 0, bounds.w, bounds.h];
  const relax = Math.round(1 + (1 - params.chaos) * 3);
  let vor = Delaunay.from(pts.map((p) => [p[0], p[1]] as [number, number])).voronoi(box);
  for (let it = 0; it < relax; it++) {
    pts = pts.map((p, i) => {
      const cell = vor.cellPolygon(i);
      if (!cell) return p;
      return centroid(cell.slice(0, -1).map((q) => [q[0], q[1]] as Vec2));
    });
    vor = Delaunay.from(pts.map((p) => [p[0], p[1]] as [number, number])).voronoi(box);
  }
  // Aristas Voronoi unicas por clave de vertices cuantizados.
  const key = (p: Vec2): string => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const verts = new Map<string, Vec2>();
  const edges = new Map<string, [string, string]>();
  const adj = new Map<string, string[]>();
  for (let i = 0; i < pts.length; i++) {
    const cell = vor.cellPolygon(i);
    if (!cell) continue;
    const poly = cleanPolygon(cell.slice(0, -1).map((q) => [q[0], q[1]] as Vec2));
    for (let j = 0; j < poly.length; j++) {
      const a = poly[j] as Vec2;
      const b = poly[(j + 1) % poly.length] as Vec2;
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) continue;
      verts.set(ka, a);
      verts.set(kb, b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edges.has(ek)) {
        edges.set(ek, [ka, kb]);
        (adj.get(ka) ?? adj.set(ka, []).get(ka))!.push(kb);
        (adj.get(kb) ?? adj.set(kb, []).get(kb))!.push(ka);
      }
    }
  }
  // Avenidas: Dijkstra entre vertices mas cercanos a centros de distrito consecutivos y al centro.
  const nearestVert = (p: Vec2): string => {
    let best = '';
    let bd = Infinity;
    for (const [k, q] of verts) {
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };
  const targets = [[bounds.w / 2, bounds.h / 2] as Vec2, ...ctx.districts.map((d) => d.center)].map(nearestVert);
  const avenueEdges = new Set<string>();
  const dijkstra = (from: string, to: string): string[] => {
    const distMap = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const open = new Set<string>([from]);
    while (open.size) {
      let u = '';
      let ud = Infinity;
      for (const k of open) {
        const d = distMap.get(k) as number;
        if (d < ud) {
          ud = d;
          u = k;
        }
      }
      open.delete(u);
      if (u === to) break;
      for (const v of adj.get(u) ?? []) {
        const nd = ud + dist(verts.get(u) as Vec2, verts.get(v) as Vec2);
        if (nd < (distMap.get(v) ?? Infinity)) {
          distMap.set(v, nd);
          prev.set(v, u);
          open.add(v);
        }
      }
    }
    const path: string[] = [];
    let cur: string | undefined = to;
    while (cur) {
      path.push(cur);
      cur = prev.get(cur);
    }
    return path;
  };
  for (let i = 1; i < targets.length; i++) {
    const path = dijkstra(targets[0] as string, targets[i] as string);
    for (let j = 0; j + 1 < path.length; j++) {
      const a = path[j] as string;
      const b = path[j + 1] as string;
      avenueEdges.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }
  const lines: RawLine[] = [];
  for (const [ek, [ka, kb]] of edges) {
    lines.push({ points: [verts.get(ka) as Vec2, verts.get(kb) as Vec2], cls: avenueEdges.has(ek) ? 'avenue' : 'street' });
  }
  return lines;
};
