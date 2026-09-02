import type { Vec2 } from '../types';

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const len2 = (a: Vec2): number => a[0] * a[0] + a[1] * a[1];
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const dist2 = (a: Vec2, b: Vec2): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l];
};
export const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const angle = (a: Vec2): number => Math.atan2(a[1], a[0]);
export const rotate = (a: Vec2, th: number): Vec2 => {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp1 = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interseccion de segmentos p1p2 y p3p4. Devuelve [t, u] o null. */
export function segIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): readonly [number, number] | null {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return null;
  const d3 = sub(p3, p1);
  const t = cross(d3, d2) / den;
  const u = cross(d3, d1) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [clamp(t, 0, 1), clamp(u, 0, 1)];
}

/** Interseccion de dos rectas (p + t*d). Null si paralelas. */
export function lineIntersect(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, scale(d1, t));
}

/** Proyeccion del punto p sobre el segmento ab: devuelve [punto, t, distancia^2]. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): readonly [Vec2, number, number] {
  const ab = sub(b, a);
  const l2 = len2(ab);
  const t = l2 < 1e-12 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
  const q = add(a, scale(ab, t));
  return [q, t, dist2(p, q)];
}

export function polylineLength(pl: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < pl.length; i++) s += dist(pl[i - 1] as Vec2, pl[i] as Vec2);
  return s;
}

/** Punto y tangente a distancia `d` a lo largo de la polilinea. */
export function pointAlong(pl: readonly Vec2[], d: number): readonly [Vec2, Vec2] {
  let acc = 0;
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1] as Vec2;
    const b = pl[i] as Vec2;
    const l = dist(a, b);
    if (acc + l >= d || i === pl.length - 1) {
      const t = l < 1e-12 ? 0 : clamp((d - acc) / l, 0, 1);
      return [lerp(a, b, t), norm(sub(b, a))];
    }
    acc += l;
  }
  return [pl[0] as Vec2, [1, 0]];
}

/** Douglas-Peucker. */
export function simplify(pl: readonly Vec2[], tol: number): Vec2[] {
  if (pl.length <= 2) return pl.slice();
  const keep = new Uint8Array(pl.length);
  keep[0] = 1;
  keep[pl.length - 1] = 1;
  const stack: [number, number][] = [[0, pl.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d2 = projectOnSegment(pl[i] as Vec2, pl[s] as Vec2, pl[e] as Vec2)[2];
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < pl.length; i++) if (keep[i]) out.push(pl[i] as Vec2);
  return out;
}

/** Suavizado Chaikin (n iteraciones) conservando extremos. */
export function chaikin(pl: readonly Vec2[], iterations: number): Vec2[] {
  let cur = pl.slice();
  for (let k = 0; k < iterations; k++) {
    if (cur.length < 3) return cur;
    const out: Vec2[] = [cur[0] as Vec2];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i] as Vec2;
      const b = cur[i + 1] as Vec2;
      out.push(lerp(a, b, 0.25), lerp(a, b, 0.75));
    }
    out.push(cur[cur.length - 1] as Vec2);
    cur = out;
  }
  return cur;
}
