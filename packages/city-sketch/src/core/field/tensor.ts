/**
 * Campo tensorial 2D (Chen et al. 2008). Un tensor simetrico sin traza se
 * representa por [a, b] = R*[cos 2t, sin 2t]; el eigenvector mayor es (cos t, sin t).
 */
import type { Noise2D } from '../geom/noise';
import { createSimplex2D } from '../geom/noise';
import { pointInPolygon } from '../geom/polygon';
import { dist2, norm, sub } from '../geom/vec';
import type { Bounds, PipelineContext, Polygon, Vec2 } from '../types';

export interface TensorSample {
  readonly major: Vec2;
  readonly minor: Vec2;
  readonly degenerate: boolean;
}

export interface TensorField {
  sample(p: Vec2): TensorSample;
  /** Tensor crudo [a, b] sin descomponer (para cacheo); [0,0] si degenerado/bloqueado. */
  tensor?(p: Vec2): Tensor;
  /** true si el punto cae en agua (las calles no entran). */
  isBlocked(p: Vec2): boolean;
}

export type Tensor = readonly [a: number, b: number];

export const gridTensor = (theta: number): Tensor => [Math.cos(2 * theta), Math.sin(2 * theta)];

export function radialTensor(p: Vec2, c: Vec2): Tensor {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const t: Tensor = [dy * dy - dx * dx, -2 * dx * dy];
  const l = Math.hypot(t[0], t[1]);
  return l < 1e-9 ? [0, 0] : [t[0] / l, t[1] / l];
}

export function rotateTensor(t: Tensor, dTheta: number): Tensor {
  const c = Math.cos(2 * dTheta);
  const s = Math.sin(2 * dTheta);
  return [t[0] * c - t[1] * s, t[0] * s + t[1] * c];
}

export interface RadialCenter {
  readonly center: Vec2;
  /** Radio de influencia (unidades de mundo). */
  readonly radius: number;
  readonly weight: number;
}

export interface BoundaryCurve {
  readonly points: readonly Vec2[];
  readonly closed: boolean;
  /** Distancia de influencia. */
  readonly radius: number;
  readonly weight: number;
}

export interface TensorFieldSpec {
  readonly bounds: Bounds;
  readonly gridTheta: number;
  readonly gridWeight: number;
  readonly radials: readonly RadialCenter[];
  readonly boundaries: readonly BoundaryCurve[];
  readonly noise: Noise2D | null;
  readonly noiseScale: number;
  /** Rotacion maxima por ruido en radianes. */
  readonly noiseAngle: number;
  readonly water: readonly Polygon[];
  readonly symmetry: 'none' | 'mirror-x' | 'mirror-y' | 'quad';
  /** Angulo extra por distrito (indice → radianes). */
  readonly districtTheta: (p: Vec2) => number;
}

function nearestTangent(p: Vec2, curve: BoundaryCurve): readonly [Vec2, number] | null {
  const pts = curve.points;
  const n = pts.length;
  const segs = curve.closed ? n : n - 1;
  let bestD = Infinity;
  let bi = -1;
  const px = p[0];
  const py = p[1];
  for (let i = 0; i < segs; i++) {
    const a = pts[i] as Vec2;
    const b = pts[(i + 1) % n] as Vec2;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const l2 = abx * abx + aby * aby;
    let t = l2 < 1e-12 ? 0 : ((px - a[0]) * abx + (py - a[1]) * aby) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a[0] + abx * t - px;
    const qy = a[1] + aby * t - py;
    const d2 = qx * qx + qy * qy;
    if (d2 < bestD) {
      bestD = d2;
      bi = i;
    }
  }
  if (bi < 0) return null;
  return [norm(sub(pts[(bi + 1) % n] as Vec2, pts[bi] as Vec2)), Math.sqrt(bestD)];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(pts: readonly Vec2[], margin: number): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
}

const inBox = (p: Vec2, b: Box): boolean => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;

export function createTensorField(spec: TensorFieldSpec): TensorField {
  const { bounds } = spec;
  const cx = bounds.w / 2;
  const cy = bounds.h / 2;
  // Cajas envolventes: fuera de ellas el peso gaussiano es < 1e-3 y se omite el calculo.
  const boundaryBoxes = spec.boundaries.map((c) => boxOf(c.points, c.radius * 2.7));
  const waterBoxes = spec.water.map((w) => boxOf(w, 0));

  const reflect = (p: Vec2): readonly [Vec2, number, number] => {
    // Devuelve punto reflejado y signos para des-reflejar el eigenvector.
    let x = p[0];
    let y = p[1];
    let sx = 1;
    let sy = 1;
    if ((spec.symmetry === 'mirror-x' || spec.symmetry === 'quad') && x > cx) {
      x = 2 * cx - x;
      sx = -1;
    }
    if ((spec.symmetry === 'mirror-y' || spec.symmetry === 'quad') && y > cy) {
      y = 2 * cy - y;
      sy = -1;
    }
    return [[x, y], sx, sy];
  };

  const rawTensor = (p: Vec2): Tensor => {
    let a = 0;
    let b = 0;
    const theta = spec.gridTheta + spec.districtTheta(p);
    const g = gridTensor(theta);
    a += g[0] * spec.gridWeight;
    b += g[1] * spec.gridWeight;
    for (const r of spec.radials) {
      const d2 = dist2(p, r.center);
      const w = r.weight * Math.exp(-d2 / (r.radius * r.radius));
      if (w < 1e-4) continue;
      const t = radialTensor(p, r.center);
      a += t[0] * w;
      b += t[1] * w;
    }
    for (let ci = 0; ci < spec.boundaries.length; ci++) {
      const c = spec.boundaries[ci]!;
      if (!inBox(p, boundaryBoxes[ci]!)) continue;
      const nt = nearestTangent(p, c);
      if (!nt) continue;
      const [tan, d] = nt;
      const w = c.weight * Math.exp(-(d * d) / (c.radius * c.radius));
      if (w < 1e-4) continue;
      const th = Math.atan2(tan[1], tan[0]);
      const t = gridTensor(th);
      a += t[0] * w;
      b += t[1] * w;
    }
    let t: Tensor = [a, b];
    if (spec.noise && spec.noiseAngle > 0) {
      const n = spec.noise(p[0] / spec.noiseScale, p[1] / spec.noiseScale);
      t = rotateTensor(t, n * spec.noiseAngle);
    }
    return t;
  };

  const isBlocked = (p: Vec2): boolean => {
    for (let i = 0; i < spec.water.length; i++) {
      if (inBox(p, waterBoxes[i]!) && pointInPolygon(p, spec.water[i]!)) return true;
    }
    return false;
  };

  return {
    isBlocked,
    tensor(p) {
      const [q, sx, sy] = reflect(p);
      const t = rawTensor(q);
      if (isBlocked(p)) return [0, 0];
      // Reflejar el tensor: con t → -t o t → pi - t solo cambia el signo de sin 2t.
      return [t[0], t[1] * sx * sy];
    },
    sample(p) {
      const [q, sx, sy] = reflect(p);
      const t = rawTensor(q);
      const mag = Math.hypot(t[0], t[1]);
      if (mag < 1e-6 || isBlocked(p)) {
        return { major: [1, 0], minor: [0, 1], degenerate: true };
      }
      const th = 0.5 * Math.atan2(t[1], t[0]);
      const major: Vec2 = [Math.cos(th) * sx, Math.sin(th) * sy];
      const minor: Vec2 = [-Math.sin(th) * sx, Math.cos(th) * sy];
      return { major, minor, degenerate: false };
    },
  };
}

/** Construye el campo a partir del contexto del pipeline. */
export function fieldFromContext(ctx: PipelineContext): TensorField {
  const { params, bounds } = ctx;
  const t = params.tensor;
  const rng = ctx.rng('field');
  const noise = t.noiseIntensity > 0 ? createSimplex2D(rng.fork('noise')) : null;
  const radials: RadialCenter[] = [];
  const n = t.radialCenters;
  const radialWeight = 1 - t.gridWeight + params.curvature * 0.5;
  for (let i = 0; i < n; i++) {
    const d = ctx.districts[i % Math.max(1, ctx.districts.length)];
    const base: Vec2 = d ? d.center : [bounds.w / 2, bounds.h / 2];
    const jitter = params.chaos * 0.1 * Math.min(bounds.w, bounds.h);
    const center: Vec2 = n === 1 && i === 0 && !d ? base : [base[0] + rng.gauss(0, jitter), base[1] + rng.gauss(0, jitter)];
    radials.push({ center, radius: Math.max(bounds.w, bounds.h) * (0.35 + 0.3 * params.curvature), weight: radialWeight });
  }
  const boundaries: BoundaryCurve[] = [];
  if (t.boundaryWeight > 0) {
    for (const w of ctx.water) boundaries.push({ points: w, closed: true, radius: 120, weight: t.boundaryWeight });
  }
  // Angulo por distrito: el caos desalinea la trama entre distritos.
  const districtAngles = ctx.districts.map((_, i) => rng.fork(`district-angle-${i}`).gauss(0, params.chaos * 0.5));
  const districtTheta = (p: Vec2): number => {
    if (ctx.districts.length <= 1 || params.chaos === 0) return 0;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < ctx.districts.length; i++) {
      const d = dist2(p, (ctx.districts[i] as { center: Vec2 }).center);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return districtAngles[best] ?? 0;
  };
  return createTensorField({
    bounds,
    gridTheta: (t.dominantAngle * Math.PI) / 180,
    gridWeight: t.gridWeight,
    radials,
    boundaries,
    noise,
    noiseScale: t.noiseScale,
    noiseAngle: (t.noiseIntensity + params.curvature * 0.3) * (Math.PI / 4),
    water: ctx.water,
    symmetry: params.symmetry,
    districtTheta,
  });
}
