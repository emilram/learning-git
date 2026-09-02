/** Recorte de polilineas a rectangulo (Liang-Barsky) y a poligono convexo (Cyrus-Beck). */
import type { Bounds, Polygon, Vec2 } from '../types';
import { cross, dot, sub } from './vec';

function clipSegmentParams(a: Vec2, b: Vec2, test: (p: number, q: number) => boolean, ranges: { p: number; q: number }[]): readonly [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  for (const { p, q } of ranges) {
    if (!test(p, q)) return null;
    if (p !== 0) {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  void a;
  void b;
  return [t0, t1];
}

function clipSegmentRect(a: Vec2, b: Vec2, bounds: Bounds): readonly [Vec2, Vec2] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ranges = [
    { p: -dx, q: a[0] },
    { p: dx, q: bounds.w - a[0] },
    { p: -dy, q: a[1] },
    { p: dy, q: bounds.h - a[1] },
  ];
  const r = clipSegmentParams(a, b, (p, q) => !(p === 0 && q < 0), ranges);
  if (!r) return null;
  const [t0, t1] = r;
  if (t1 < t0) return null;
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1],
  ];
}

function clipSegmentConvex(a: Vec2, b: Vec2, poly: Polygon): readonly [Vec2, Vec2] | null {
  const n = poly.length;
  const d = sub(b, a);
  // Orientacion del poligono para normales interiores.
  let area = 0;
  for (let i = 0; i < n; i++) area += cross(poly[i] as Vec2, poly[(i + 1) % n] as Vec2);
  const sgn = area > 0 ? 1 : -1;
  const ranges: { p: number; q: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[i] as Vec2;
    const p1 = poly[(i + 1) % n] as Vec2;
    const e = sub(p1, p0);
    const nrm: Vec2 = [-e[1] * sgn, e[0] * sgn]; // interior
    // Condicion: dot(a + t d - p0, nrm) >= 0  →  p = -dot(d,nrm), q = dot(a - p0, nrm)
    ranges.push({ p: -dot(d, nrm), q: dot(sub(a, p0), nrm) });
  }
  const r = clipSegmentParams(a, b, (p, q) => !(p === 0 && q < 0), ranges);
  if (!r) return null;
  const [t0, t1] = r;
  if (t1 < t0) return null;
  return [
    [a[0] + d[0] * t0, a[1] + d[1] * t0],
    [a[0] + d[0] * t1, a[1] + d[1] * t1],
  ];
}

function assemble(pl: readonly Vec2[], clipSeg: (a: Vec2, b: Vec2) => readonly [Vec2, Vec2] | null): Vec2[][] {
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  for (let i = 0; i + 1 < pl.length; i++) {
    const r = clipSeg(pl[i] as Vec2, pl[i + 1] as Vec2);
    if (!r) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
      continue;
    }
    const [p, q] = r;
    if (cur.length === 0) cur.push(p);
    else {
      const last = cur[cur.length - 1] as Vec2;
      if (Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) {
        if (cur.length >= 2) out.push(cur);
        cur = [p];
      }
    }
    cur.push(q);
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

export function clipPolylineToBounds(pl: readonly Vec2[], bounds: Bounds): Vec2[][] {
  return assemble(pl, (a, b) => clipSegmentRect(a, b, bounds));
}

export function clipPolylineToConvex(pl: readonly Vec2[], poly: Polygon): Vec2[][] {
  return assemble(pl, (a, b) => clipSegmentConvex(a, b, poly));
}
