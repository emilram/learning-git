/**
 * Extraccion de caras (ciclos minimos) del grafo planar por recorrido angular
 * sobre half-edges. O(E log E) por la ordenacion angular en cada nodo.
 */
import { signedArea } from '../geom/polygon';
import type { Vec2 } from '../types';
import type { GEdge, PlanarGraph } from './planar';

export interface Face {
  /** Aristas (indices) en orden de recorrido, con direccion. */
  readonly edges: readonly { readonly ei: number; readonly forward: boolean }[];
  /** Poligono resultante (sin repetir el primer punto). */
  readonly polygon: Vec2[];
  /** Anchos por segmento del poligono (uno por arista del poligono). */
  readonly segmentEdge: number[];
  readonly area: number;
}

/**
 * Half-edge h = 2*ei + (forward ? 0 : 1). tail(h) = forward ? a : b.
 */
export function extractFaces(g: PlanarGraph, ignoreFilaments = true): Face[] {
  const alive = g.edges.map((e) => e.alive);
  // Filamentos: aristas con un extremo de grado 1 (iterativo) no forman caras.
  if (ignoreFilaments) {
    let changed = true;
    while (changed) {
      changed = false;
      const deg = new Map<number, number>();
      g.edges.forEach((e, i) => {
        if (!alive[i]) return;
        deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
        deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
      });
      g.edges.forEach((e, i) => {
        if (!alive[i]) return;
        if ((deg.get(e.a) ?? 0) === 1 || (deg.get(e.b) ?? 0) === 1) {
          alive[i] = false;
          changed = true;
        }
      });
    }
  }

  const tail = (h: number): number => {
    const e = g.edges[h >> 1] as GEdge;
    return (h & 1) === 0 ? e.a : e.b;
  };
  const head = (h: number): number => {
    const e = g.edges[h >> 1] as GEdge;
    return (h & 1) === 0 ? e.b : e.a;
  };
  const twin = (h: number): number => h ^ 1;

  // Half-edges salientes por nodo, ordenados por angulo.
  const out = new Map<number, number[]>();
  g.edges.forEach((_, ei) => {
    if (!alive[ei]) return;
    for (const h of [ei * 2, ei * 2 + 1]) {
      const t = tail(h);
      let arr = out.get(t);
      if (!arr) {
        arr = [];
        out.set(t, arr);
      }
      arr.push(h);
    }
  });
  const angleOf = new Map<number, number>();
  for (const [n, hs] of out) {
    for (const h of hs) angleOf.set(h, g.outAngle(h >> 1, n));
    hs.sort((p, q) => (angleOf.get(p) as number) - (angleOf.get(q) as number) || p - q);
  }
  const next = (h: number): number => {
    const v = head(h);
    const hs = out.get(v) as number[];
    const tw = twin(h);
    const k = hs.indexOf(tw);
    // Siguiente en sentido horario (angulo decreciente) para caras a la izquierda.
    return hs[(k - 1 + hs.length) % hs.length] as number;
  };

  const visited = new Uint8Array(g.edges.length * 2);
  const faces: Face[] = [];
  const order: number[] = [];
  for (const [, hs] of out) for (const h of hs) order.push(h);
  order.sort((a, b) => a - b);
  for (const h0 of order) {
    if (visited[h0]) continue;
    const cycle: number[] = [];
    let h = h0;
    let guard = 0;
    while (!visited[h] && guard++ < 100000) {
      visited[h] = 1;
      cycle.push(h);
      h = next(h);
    }
    if (cycle.length < 2) continue;
    const polygon: Vec2[] = [];
    const segmentEdge: number[] = [];
    for (const hh of cycle) {
      const e = g.edges[hh >> 1] as GEdge;
      const pl = (hh & 1) === 0 ? e.polyline : e.polyline.slice().reverse();
      for (let i = 0; i + 1 < pl.length; i++) {
        polygon.push(pl[i] as Vec2);
        segmentEdge.push(hh >> 1);
      }
    }
    const a = signedArea(polygon);
    faces.push({
      edges: cycle.map((hh) => ({ ei: hh >> 1, forward: (hh & 1) === 0 })),
      polygon,
      segmentEdge,
      area: a,
    });
  }
  if (faces.length === 0) return [];
  // La cara exterior es la de mayor |area| con signo opuesto a la mayoria.
  let outer = 0;
  for (let i = 1; i < faces.length; i++) if (Math.abs(faces[i]!.area) > Math.abs(faces[outer]!.area)) outer = i;
  const outerSign = Math.sign(faces[outer]!.area);
  return faces.filter((f, i) => i !== outer && Math.sign(f.area) === -outerSign && Math.abs(f.area) > 1e-6);
}
