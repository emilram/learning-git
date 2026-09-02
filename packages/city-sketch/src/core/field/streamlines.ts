/**
 * Trazado de hyperstreamlines con siembra Jobard-Lefer (dsep/dtest) e integracion RK4.
 */
import { dist, dist2, dot, projectOnSegment, scale, add } from '../geom/vec';
import type { Bounds, Rng, Vec2 } from '../types';
import type { TensorField } from './tensor';

export interface StreamlineParams {
  readonly dsep: number;
  readonly dtest: number;
  readonly dstep: number;
  readonly maxSteps: number;
  readonly seedTries: number;
  readonly major: boolean;
}

/** Rejilla espacial uniforme para consultas de vecindad. */
export class PointGrid {
  private readonly cells = new Map<number, { p: Vec2; line: number; idx: number }[]>();
  private readonly cols: number;

  constructor(
    bounds: Bounds,
    private readonly cell: number,
  ) {
    this.cols = Math.ceil(bounds.w / cell) + 2;
  }

  private key(x: number, y: number): number {
    const cx = Math.floor(x / this.cell) + 1;
    const cy = Math.floor(y / this.cell) + 1;
    return cy * this.cols + cx;
  }

  add(p: Vec2, line: number, idx: number): void {
    const k = this.key(p[0], p[1]);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push({ p, line, idx });
  }

  /** Recorre los puntos en celdas a distancia <= r. */
  forEachNear(p: Vec2, r: number, fn: (q: Vec2, line: number, idx: number) => boolean | void): void {
    const n = Math.ceil(r / this.cell);
    const cx = Math.floor(p[0] / this.cell) + 1;
    const cy = Math.floor(p[1] / this.cell) + 1;
    for (let dy = -n; dy <= n; dy++) {
      for (let dx = -n; dx <= n; dx++) {
        const arr = this.cells.get((cy + dy) * this.cols + (cx + dx));
        if (!arr) continue;
        for (const e of arr) if (fn(e.p, e.line, e.idx) === true) return;
      }
    }
  }

  isFree(p: Vec2, r: number, ignoreLine = -1): boolean {
    const r2 = r * r;
    let free = true;
    this.forEachNear(p, r, (q, line) => {
      if (line !== ignoreLine && dist2(p, q) < r2) {
        free = false;
        return true;
      }
      return false;
    });
    return free;
  }
}

function inBounds(p: Vec2, b: Bounds): boolean {
  return p[0] >= 0 && p[1] >= 0 && p[0] <= b.w && p[1] <= b.h;
}

/** Recorta el segmento a→b al rectangulo y devuelve el punto de salida. */
function clipToBounds(a: Vec2, b: Vec2, bounds: Bounds): Vec2 {
  let t = 1;
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  if (d[0] !== 0) {
    if (b[0] < 0) t = Math.min(t, (0 - a[0]) / d[0]);
    if (b[0] > bounds.w) t = Math.min(t, (bounds.w - a[0]) / d[0]);
  }
  if (d[1] !== 0) {
    if (b[1] < 0) t = Math.min(t, (0 - a[1]) / d[1]);
    if (b[1] > bounds.h) t = Math.min(t, (bounds.h - a[1]) / d[1]);
  }
  t = Math.max(0, t);
  const q: Vec2 = [a[0] + d[0] * t, a[1] + d[1] * t];
  return [Math.min(bounds.w, Math.max(0, q[0])), Math.min(bounds.h, Math.max(0, q[1]))];
}

export interface StreamlineResult {
  readonly lines: Vec2[][];
  readonly grid: PointGrid;
}

export function traceStreamlines(
  field: TensorField,
  bounds: Bounds,
  params: StreamlineParams,
  rng: Rng,
  initialSeeds: readonly Vec2[],
  /** Rejilla de la familia opuesta: se usa para sembrar sobre sus lineas. */
  crossLines: readonly Vec2[][],
): StreamlineResult {
  const grid = new PointGrid(bounds, params.dsep);
  const lines: Vec2[][] = [];
  const queue: Vec2[] = [];
  let head = 0;

  const dirAt = (p: Vec2, prev: Vec2): Vec2 | null => {
    const s = field.sample(p);
    if (s.degenerate) return null;
    const v = params.major ? s.major : s.minor;
    return dot(v, prev) < 0 ? [-v[0], -v[1]] : v;
  };

  const rk4 = (p: Vec2, prev: Vec2): Vec2 | null => {
    const h = params.dstep;
    const k1 = dirAt(p, prev);
    if (!k1) return null;
    const k2 = dirAt(add(p, scale(k1, h / 2)), k1);
    if (!k2) return null;
    const k3 = dirAt(add(p, scale(k2, h / 2)), k2);
    if (!k3) return null;
    const k4 = dirAt(add(p, scale(k3, h)), k3);
    if (!k4) return null;
    return [
      (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6,
      (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6,
    ];
  };

  const integrate = (seed: Vec2, initialDir: Vec2, lineIdx: number): Vec2[] => {
    const pts: Vec2[] = [];
    let p = seed;
    let prev = initialDir;
    for (let i = 0; i < params.maxSteps; i++) {
      const d = rk4(p, prev);
      if (!d) break;
      const next: Vec2 = [p[0] + d[0] * params.dstep, p[1] + d[1] * params.dstep];
      if (!inBounds(next, bounds)) {
        pts.push(clipToBounds(p, next, bounds));
        break;
      }
      if (field.isBlocked(next)) break;
      // Giro brusco: el eigenvector cambio de signo (singularidad).
      if (dot(d, prev) < 0.2) break;
      if (!grid.isFree(next, params.dtest, lineIdx)) {
        pts.push(next);
        break;
      }
      pts.push(next);
      p = next;
      prev = d;
    }
    return pts;
  };

  const tryTrace = (seed: Vec2): boolean => {
    if (!inBounds(seed, bounds) || field.isBlocked(seed)) return false;
    if (!grid.isFree(seed, params.dsep)) return false;
    const s = field.sample(seed);
    if (s.degenerate) return false;
    const d0 = params.major ? s.major : s.minor;
    const lineIdx = lines.length;
    const fwd = integrate(seed, d0, lineIdx);
    const bwd = integrate(seed, [-d0[0], -d0[1]], lineIdx);
    const pts: Vec2[] = [...bwd.reverse(), seed, ...fwd];
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1] as Vec2, pts[i] as Vec2);
    if (length < params.dsep * 0.6) return false;
    lines.push(pts);
    for (let i = 0; i < pts.length; i++) grid.add(pts[i] as Vec2, lineIdx, i);
    // Candidatos perpendiculares cada dsep.
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += dist(pts[i - 1] as Vec2, pts[i] as Vec2);
      if (acc >= params.dsep) {
        acc = 0;
        const a = pts[i - 1] as Vec2;
        const b = pts[i] as Vec2;
        const t: Vec2 = [b[0] - a[0], b[1] - a[1]];
        const l = Math.hypot(t[0], t[1]) || 1;
        const n: Vec2 = [-t[1] / l, t[0] / l];
        queue.push([b[0] + n[0] * params.dsep, b[1] + n[1] * params.dsep]);
        queue.push([b[0] - n[0] * params.dsep, b[1] - n[1] * params.dsep]);
      }
    }
    return true;
  };

  for (const s of initialSeeds) queue.push(s);
  // Semillas sobre las lineas de la familia opuesta (garantiza cruces).
  for (const cl of crossLines) {
    let acc = 0;
    for (let i = 1; i < cl.length; i++) {
      acc += dist(cl[i - 1] as Vec2, cl[i] as Vec2);
      if (acc >= params.dsep) {
        acc = 0;
        queue.push(cl[i] as Vec2);
      }
    }
  }

  let failures = 0;
  while (failures < params.seedTries) {
    let seed: Vec2;
    if (head < queue.length) {
      seed = queue[head++] as Vec2;
    } else {
      seed = [rng.range(0, bounds.w), rng.range(0, bounds.h)];
    }
    if (tryTrace(seed)) {
      if (head >= queue.length) failures = 0;
    } else if (head >= queue.length) {
      failures++;
    }
  }
  return { lines, grid };
}

/**
 * Extiende extremos colgantes hasta la linea mas cercana (dlookahead) para
 * cerrar manzanas; los extremos en el borde del lienzo se dejan como estan.
 */
export function joinDanglingEnds(lines: Vec2[][], bounds: Bounds, lookahead: number): Vec2[][] {
  const grid = new PointGrid(bounds, lookahead);
  lines.forEach((l, li) => l.forEach((p, pi) => grid.add(p, li, pi)));
  const onEdge = (p: Vec2): boolean => p[0] <= 1e-6 || p[1] <= 1e-6 || p[0] >= bounds.w - 1e-6 || p[1] >= bounds.h - 1e-6;
  const out = lines.map((l) => l.slice());
  for (let li = 0; li < out.length; li++) {
    const l = out[li] as Vec2[];
    if (l.length < 2) continue;
    for (const end of [0, 1] as const) {
      const p = (end === 0 ? l[0] : l[l.length - 1]) as Vec2;
      if (onEdge(p)) continue;
      let best: Vec2 | null = null;
      let bestD = lookahead * lookahead;
      grid.forEachNear(p, lookahead, (q, line, idx) => {
        if (line === li) return;
        const other = lines[line] as Vec2[];
        for (const j of [idx - 1, idx]) {
          if (j < 0 || j + 1 >= other.length) continue;
          const [proj, , d2] = projectOnSegment(p, other[j] as Vec2, other[j + 1] as Vec2);
          if (d2 < bestD) {
            bestD = d2;
            best = proj;
          }
        }
        void q;
      });
      if (best) {
        if (end === 0) l.unshift(best);
        else l.push(best);
      }
    }
  }
  return out;
}
