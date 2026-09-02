import { polygonHull } from 'd3-polygon';
import type { Polygon, Rect, Vec2 } from '../types';
import { add, cross, dist, dot, lineIntersect, norm, perp, scale, sub } from './vec';

/** Area con signo. Positiva = horaria en pantalla (y hacia abajo). */
export function signedArea(p: Polygon): number {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const p0 = p[i] as Vec2;
    const p1 = p[(i + 1) % n] as Vec2;
    a += p0[0] * p1[1] - p1[0] * p0[1];
  }
  return a / 2;
}

export const area = (p: Polygon): number => Math.abs(signedArea(p));

export function centroid(p: Polygon): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const p0 = p[i] as Vec2;
    const p1 = p[(i + 1) % n] as Vec2;
    const f = p0[0] * p1[1] - p1[0] * p0[1];
    cx += (p0[0] + p1[0]) * f;
    cy += (p0[1] + p1[1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const q of p) {
      sx += q[0];
      sy += q[1];
    }
    return [sx / p.length, sy / p.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function bbox(p: readonly Vec2[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of p) {
    if (q[0] < x0) x0 = q[0];
    if (q[0] > x1) x1 = q[0];
    if (q[1] < y0) y0 = q[1];
    if (q[1] > y1) y1 = q[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function pointInPolygon(pt: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function perimeter(p: Polygon): number {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) s += dist(p[i] as Vec2, p[(i + 1) % n] as Vec2);
  return s;
}

/** Garantiza area con signo positiva. */
export function ensurePositive(p: Polygon): Polygon {
  return signedArea(p) < 0 ? p.slice().reverse() : p;
}

/** Elimina vertices repetidos consecutivos y colineales. */
export function cleanPolygon(p: Polygon, eps = 1e-6): Vec2[] {
  const out: Vec2[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || dist(last, q) > eps) out.push(q);
  }
  while (out.length > 1 && dist(out[0] as Vec2, out[out.length - 1] as Vec2) <= eps) out.pop();
  if (out.length < 3) return out;
  const res: Vec2[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i + out.length - 1) % out.length] as Vec2;
    const b = out[i] as Vec2;
    const c = out[(i + 1) % out.length] as Vec2;
    const cr = cross(sub(b, a), sub(c, b));
    if (Math.abs(cr) > eps) res.push(b);
  }
  return res.length >= 3 ? res : out;
}

/**
 * Inset por desplazamiento de aristas con distancia por arista.
 * Devuelve null si el resultado degenera (area <= 0, mayor que la original o fuera del poligono).
 */
export function insetPolygon(poly: Polygon, distances: readonly number[]): Vec2[] | null {
  const n = poly.length;
  if (n < 3) return null;
  const sgn = signedArea(poly) > 0 ? 1 : -1;
  const offP: Vec2[] = [];
  const offD: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % n] as Vec2;
    const d = norm(sub(b, a));
    // Con area positiva (horaria en pantalla, y hacia abajo) el interior queda a la derecha: +perp.
    const nrm = scale(perp(d), sgn);
    const dd = distances[i] ?? 0;
    offP.push(add(a, scale(nrm, dd)));
    offD.push(d);
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + n - 1) % n;
    const x = lineIntersect(offP[j] as Vec2, offD[j] as Vec2, offP[i] as Vec2, offD[i] as Vec2);
    out.push(x ?? (offP[i] as Vec2));
  }
  // Eliminar aristas invertidas (vertices que se cruzaron al desplazar).
  let cleaned = out;
  let orig: Vec2[] = poly.slice();
  for (let pass = 0; pass < 4; pass++) {
    const m = cleaned.length;
    if (m < 3) return null;
    const bad = new Set<number>();
    for (let i = 0; i < m; i++) {
      const a = cleaned[i] as Vec2;
      const b = cleaned[(i + 1) % m] as Vec2;
      const oa = orig[i] as Vec2;
      const ob = orig[(i + 1) % m] as Vec2;
      if (dot(sub(b, a), sub(ob, oa)) < 0) bad.add((i + 1) % m);
    }
    if (bad.size === 0) break;
    cleaned = cleaned.filter((_, i) => !bad.has(i));
    orig = orig.filter((_, i) => !bad.has(i));
  }
  const res = cleanPolygon(cleaned);
  if (res.length < 3) return null;
  const a0 = area(poly);
  const a1 = signedArea(res) * sgn;
  if (a1 <= 0 || a1 > a0) return null;
  for (const q of res) if (!pointInPolygon(q, poly)) return null;
  return res;
}

export interface Obb {
  readonly center: Vec2;
  readonly axis: Vec2;
  readonly halfLong: number;
  readonly halfShort: number;
}

/** Caja envolvente orientada de area minima (rotating calipers sobre la envolvente convexa). */
export function orientedBoundingBox(poly: Polygon): Obb {
  const pts = poly.map((q) => [q[0], q[1]] as [number, number]);
  const hull = pts.length >= 3 ? (polygonHull(pts) ?? pts) : pts;
  let best: Obb | null = null;
  let bestArea = Infinity;
  const m = hull.length;
  for (let i = 0; i < m; i++) {
    const a = hull[i] as Vec2;
    const b = hull[(i + 1) % m] as Vec2;
    const ax = norm(sub(b, a));
    if (ax[0] === 0 && ax[1] === 0) continue;
    const ay = perp(ax);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const q of hull) {
      const u = dot(q, ax);
      const w = dot(q, ay);
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (w < v0) v0 = w;
      if (w > v1) v1 = w;
    }
    const ar = (u1 - u0) * (v1 - v0);
    if (ar < bestArea) {
      bestArea = ar;
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      const center: Vec2 = [ax[0] * cu + ay[0] * cv, ax[1] * cu + ay[1] * cv];
      const long = u1 - u0 >= v1 - v0;
      best = {
        center,
        axis: long ? ax : ay,
        halfLong: (long ? u1 - u0 : v1 - v0) / 2,
        halfShort: (long ? v1 - v0 : u1 - u0) / 2,
      };
    }
  }
  return best ?? { center: centroid(poly), axis: [1, 0], halfLong: 1, halfShort: 1 };
}

/** Recorta un poligono por el semiplano dot(p - o, n) >= 0 (Sutherland-Hodgman). */
export function clipHalfPlane(poly: Polygon, o: Vec2, nrm: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % n] as Vec2;
    const da = dot(sub(a, o), nrm);
    const db = dot(sub(b, o), nrm);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return cleanPolygon(out);
}

/** Divide por la recta (o, dir): devuelve las dos mitades. */
export function splitPolygon(poly: Polygon, o: Vec2, dir: Vec2): readonly [Vec2[], Vec2[]] {
  const nrm = perp(dir);
  return [clipHalfPlane(poly, o, nrm), clipHalfPlane(poly, o, scale(nrm, -1))];
}

/** Recorta poligono a un rectangulo. */
export function clipToRect(poly: Polygon, r: Rect): Vec2[] {
  let p: Vec2[] = poly.slice();
  p = clipHalfPlane(p, [r.x, r.y], [1, 0]);
  p = clipHalfPlane(p, [r.x + r.w, r.y], [-1, 0]);
  p = clipHalfPlane(p, [r.x, r.y], [0, 1]);
  p = clipHalfPlane(p, [r.x, r.y + r.h], [0, -1]);
  return p;
}

/** Distancia minima de un punto al contorno del poligono. */
export function distanceToBoundary(pt: Vec2, poly: Polygon): number {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % n] as Vec2;
    const ab = sub(b, a);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(pt, a), ab) / l2));
    const q: Vec2 = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    const d = dist(pt, q);
    if (d < best) best = d;
  }
  return best;
}
