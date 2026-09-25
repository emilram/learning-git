/**
 * Utilidades de analisis sobre el modelo (puras, deterministas, sin Vue):
 * resumen de ciudad y distritos, busqueda espacial de tiendas, ruta mas corta
 * por la red de calles, canibalizacion entre areas de cobertura y huecos de
 * cobertura con candidatos a nueva tienda.
 */
import { polygonHull } from 'd3-polygon';
import { area, centroid, clipHalfPlane, ensurePositive, pointInPolygon } from '../geom/polygon';
import { dist, perp, projectOnSegment, sub } from '../geom/vec';
import type { Block, CityModel, District, LandUse, NodeId, Poi, Polygon, Vec2 } from '../types';
import type { IsochroneBand } from './isochrone';

// ---------------------------------------------------------------------------
// Resumenes
// ---------------------------------------------------------------------------

export interface CityStats {
  readonly streets: number;
  readonly avenues: number;
  readonly alleys: number;
  /** Longitud total de calles en unidades de mundo. */
  readonly streetLength: number;
  readonly blocks: number;
  readonly lots: number;
  readonly pois: number;
  readonly districts: number;
  /** Area del lienzo. */
  readonly area: number;
  /** Area por uso de suelo (manzanas insetadas). */
  readonly landUse: Readonly<Record<LandUse, number>>;
  /** Densidad media ponderada por area de manzana (0-1). */
  readonly density: number;
  /** Tiendas por km2 sintetico (por cada 1e6 unidades cuadradas). */
  readonly poiDensity: number;
}

export function cityStats(model: CityModel): CityStats {
  const landUse: Record<LandUse, number> = { retail: 0, residential: 0, park: 0, water: 0, plaza: 0 };
  let dens = 0;
  let total = 0;
  for (const b of model.blocks) {
    landUse[b.landUse] += b.area;
    dens += b.density * b.area;
    total += b.area;
  }
  let len = 0;
  let avenues = 0;
  let alleys = 0;
  for (const s of model.streets) {
    len += s.length;
    if (s.class === 'avenue') avenues++;
    else if (s.class === 'alley') alleys++;
  }
  const canvas = model.bounds.w * model.bounds.h;
  return {
    streets: model.streets.length,
    avenues,
    alleys,
    streetLength: len,
    blocks: model.blocks.length,
    lots: model.lots.length,
    pois: model.pois.length,
    districts: model.districts.length,
    area: canvas,
    landUse,
    density: total > 0 ? dens / total : 0,
    poiDensity: canvas > 0 ? (model.pois.length / canvas) * 1e6 : 0,
  };
}

export interface DistrictRow {
  readonly district: District;
  readonly blocks: number;
  readonly lots: number;
  readonly pois: readonly Poi[];
  readonly area: number;
  readonly density: number;
  /** Suma de la metrica pasada (si se aporta `metric`). */
  readonly total: number;
  /** Media de la metrica (null si no hay datos). */
  readonly mean: number | null;
}

/**
 * Resume cada distrito: manzanas, lotes, tiendas y, opcionalmente, una metrica
 * agregada por tienda (`metric(poi)` devuelve un numero o null).
 */
export function districtSummary(model: CityModel, metric?: (poi: Poi) => number | null): DistrictRow[] {
  const blockDistrict = new Map(model.blocks.map((b) => [b.id, b.districtId]));
  const lotBlock = new Map(model.lots.map((l) => [l.id, l.blockId]));
  const rows = new Map<string, { blocks: number; lots: number; pois: Poi[]; area: number; dens: number }>();
  for (const d of model.districts) rows.set(d.id, { blocks: 0, lots: 0, pois: [], area: 0, dens: 0 });
  for (const b of model.blocks) {
    const r = rows.get(b.districtId);
    if (!r) continue;
    r.blocks++;
    r.area += b.area;
    r.dens += b.density * b.area;
  }
  for (const l of model.lots) {
    const did = blockDistrict.get(l.blockId);
    const r = did ? rows.get(did) : undefined;
    if (r) r.lots++;
  }
  for (const p of model.pois) {
    const lb = p.anchor.kind === 'lot' ? lotBlock.get(p.anchor.lotId) : undefined;
    const did = p.anchor.kind === 'lot' ? (lb ? blockDistrict.get(lb) : undefined) : districtAt(model, [p.x, p.y])?.id;
    const r = did ? rows.get(did) : undefined;
    if (r) r.pois.push(p);
  }
  return model.districts.map((d) => {
    const r = rows.get(d.id)!;
    let total = 0;
    let n = 0;
    if (metric) {
      for (const p of r.pois) {
        const v = metric(p);
        if (v !== null && Number.isFinite(v)) {
          total += v;
          n++;
        }
      }
    }
    return { district: d, blocks: r.blocks, lots: r.lots, pois: r.pois, area: r.area, density: r.area > 0 ? r.dens / r.area : 0, total, mean: n ? total / n : null };
  });
}

/** Distrito que contiene un punto (por poligono de Voronoi). */
export function districtAt(model: CityModel, p: Vec2): District | null {
  for (const d of model.districts) if (pointInPolygon(p, d.polygon)) return d;
  return null;
}

/** Manzana que contiene un punto (por contorno sin inset). */
export function blockAt(model: CityModel, p: Vec2): Block | null {
  for (const b of model.blocks) if (pointInPolygon(p, b.outline)) return b;
  return null;
}

// ---------------------------------------------------------------------------
// Busqueda espacial
// ---------------------------------------------------------------------------

export interface PoiDistance {
  readonly poi: Poi;
  readonly distance: number;
}

/** Tiendas dentro de un radio euclidiano, ordenadas por distancia. */
export function storesWithin(model: CityModel, center: Vec2, radius: number): PoiDistance[] {
  const out: PoiDistance[] = [];
  for (const p of model.pois) {
    const d = dist(center, [p.x, p.y]);
    if (d <= radius) out.push({ poi: p, distance: d });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** Las k tiendas mas cercanas a otra (excluida ella misma). */
export function nearestStores(model: CityModel, poi: Poi, k = 3): PoiDistance[] {
  return model.pois
    .filter((p) => p.id !== poi.id)
    .map((p) => ({ poi: p, distance: dist([poi.x, poi.y], [p.x, p.y]) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);
}

/** Tiendas dentro de un poligono (isocrona, zona dibujada, distrito). */
export function storesInPolygon(model: CityModel, polygon: Polygon): Poi[] {
  return model.pois.filter((p) => pointInPolygon([p.x, p.y], polygon));
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export interface Route {
  readonly polyline: Vec2[];
  readonly length: number;
  readonly streetIds: string[];
}

interface Graph {
  readonly pos: Vec2[];
  readonly index: Map<NodeId, number>;
  readonly adj: { to: number; w: number; pts: readonly Vec2[]; id: string }[][];
}

function graphOf(model: CityModel): Graph {
  const index = new Map<NodeId, number>();
  const pos: Vec2[] = [];
  model.nodes.forEach((n, i) => {
    index.set(n.id, i);
    pos.push([n.x, n.y]);
  });
  const adj: Graph['adj'] = model.nodes.map(() => []);
  for (const s of model.streets) {
    const a = index.get(s.from);
    const b = index.get(s.to);
    if (a === undefined || b === undefined) continue;
    adj[a]!.push({ to: b, w: s.length, pts: s.polyline, id: s.id });
    adj[b]!.push({ to: a, w: s.length, pts: s.polyline.slice().reverse(), id: s.id });
  }
  return { pos, index, adj };
}

/** Punto de calle mas cercano y el nodo extremo mas proximo a el. */
function nearestStreetPoint(model: CityModel, g: Graph, p: Vec2): { point: Vec2; node: number; streetId: string } {
  let best = { point: p, node: 0, streetId: '', d2: Infinity };
  for (const s of model.streets) {
    for (let i = 0; i + 1 < s.polyline.length; i++) {
      const [q, , d2] = projectOnSegment(p, s.polyline[i]!, s.polyline[i + 1]!);
      if (d2 < best.d2) {
        const a = g.index.get(s.from)!;
        const b = g.index.get(s.to)!;
        const node = dist(q, g.pos[a]!) <= dist(q, g.pos[b]!) ? a : b;
        best = { point: q, node, streetId: s.id, d2 };
      }
    }
  }
  return best;
}

/**
 * Ruta mas corta entre dos puntos por la red de calles (Dijkstra con cola
 * binaria). Los extremos se unen a la calle mas cercana. Null si no hay camino.
 */
export function routeBetween(model: CityModel, from: Vec2, to: Vec2): Route | null {
  const g = graphOf(model);
  if (!g.pos.length) return null;
  const a = nearestStreetPoint(model, g, from);
  const b = nearestStreetPoint(model, g, to);
  const n = g.pos.length;
  const distTo = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge: (Graph['adj'][number][number] | null)[] = new Array(n).fill(null);
  distTo[a.node] = 0;
  // Cola binaria minima sobre (dist, nodo).
  const heap: number[] = [];
  const hd: number[] = [];
  const push = (d: number, v: number): void => {
    heap.push(v);
    hd.push(d);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p]! <= hd[i]!) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      [hd[p], hd[i]] = [hd[i]!, hd[p]!];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const v = heap[0]!;
    const d = hd[0]!;
    const lv = heap.pop()!;
    const ld = hd.pop()!;
    if (heap.length) {
      heap[0] = lv;
      hd[0] = ld;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && hd[l]! < hd[m]!) m = l;
        if (r < heap.length && hd[r]! < hd[m]!) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        [hd[m], hd[i]] = [hd[i]!, hd[m]!];
        i = m;
      }
    }
    return [d, v];
  };
  push(0, a.node);
  while (heap.length) {
    const [d, u] = pop();
    if (d > distTo[u]!) continue;
    if (u === b.node) break;
    for (const e of g.adj[u]!) {
      const nd = d + e.w;
      if (nd < distTo[e.to]!) {
        distTo[e.to] = nd;
        prev[e.to] = u;
        prevEdge[e.to] = e;
        push(nd, e.to);
      }
    }
  }
  if (!Number.isFinite(distTo[b.node]!)) return null;
  const segs: (readonly Vec2[])[] = [];
  const ids: string[] = [];
  for (let v = b.node; v !== a.node; v = prev[v]!) {
    const e = prevEdge[v]!;
    segs.push(e.pts);
    ids.push(e.id);
  }
  segs.reverse();
  ids.reverse();
  const polyline: Vec2[] = [from, a.point];
  for (const s of segs) for (const q of s) if (dist(q, polyline[polyline.length - 1]!) > 1e-6) polyline.push([q[0], q[1]]);
  polyline.push(b.point, to);
  let length = 0;
  for (let i = 1; i < polyline.length; i++) length += dist(polyline[i - 1]!, polyline[i]!);
  return { polyline, length, streetIds: [...new Set(ids)] };
}

// ---------------------------------------------------------------------------
// Canibalizacion
// ---------------------------------------------------------------------------

export interface CannibalizationPair {
  readonly a: string;
  readonly b: string;
  /** Area de solapamiento. */
  readonly overlap: number;
  /** Solapamiento relativo al area menor de las dos (0-1). */
  readonly ratio: number;
  readonly polygon: Polygon;
}

/** Interseccion de dos poligonos convexos (Sutherland-Hodgman). */
export function convexIntersection(a: Polygon, b: Polygon): Vec2[] {
  const clip = ensurePositive(b);
  let out: Vec2[] = ensurePositive(a).slice();
  for (let i = 0; i < clip.length && out.length; i++) {
    const p = clip[i]!;
    const q = clip[(i + 1) % clip.length]!;
    // Interior a la izquierda de la arista en orientacion positiva.
    const nrm = perp(sub(q, p));
    out = clipHalfPlane(out, p, nrm);
  }
  return out;
}

/**
 * Pares de tiendas cuyas areas de cobertura (una banda por tienda) se solapan,
 * ordenados por solapamiento relativo. Las bandas deben ser convexas (como las
 * que produce `computeIsochrones`).
 */
export function cannibalization(bands: readonly IsochroneBand[], minRatio = 0.05): CannibalizationPair[] {
  const out: CannibalizationPair[] = [];
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const A = bands[i]!;
      const B = bands[j]!;
      if (A.poiId === B.poiId) continue;
      const inter = convexIntersection(A.polygon, B.polygon);
      if (inter.length < 3) continue;
      const ov = area(inter);
      const ratio = ov / Math.max(1e-9, Math.min(area(A.polygon), area(B.polygon)));
      if (ratio >= minRatio) out.push({ a: A.poiId, b: B.poiId, overlap: ov, ratio: Math.min(1, ratio), polygon: inter });
    }
  }
  return out.sort((x, y) => y.ratio - x.ratio);
}

// ---------------------------------------------------------------------------
// Huecos de cobertura
// ---------------------------------------------------------------------------

export interface CoverageGap {
  readonly point: Vec2;
  readonly blockId: string;
  readonly lotId: string | null;
  /** Distancia a la tienda mas cercana. */
  readonly distance: number;
  /** Puntuacion 0-1: distancia relativa x densidad; mayor = mejor candidato. */
  readonly score: number;
}

/**
 * Candidatos a nueva tienda: lotes de manzanas retail/residenciales cuya
 * distancia a toda tienda existente supera `radius`, puntuados por distancia y
 * densidad de la manzana, con separacion minima entre candidatos.
 */
export function coverageGaps(model: CityModel, radius: number, options: { readonly max?: number; readonly minSpacing?: number; readonly pois?: readonly Poi[] } = {}): CoverageGap[] {
  const pois = options.pois ?? model.pois;
  const max = options.max ?? 5;
  const minSpacing = options.minSpacing ?? radius * 0.9;
  const blockById = new Map(model.blocks.map((b) => [b.id, b]));
  const cands: CoverageGap[] = [];
  for (const lot of model.lots) {
    const block = blockById.get(lot.blockId);
    if (!block || (block.landUse !== 'retail' && block.landUse !== 'residential')) continue;
    const p = lot.frontPoint;
    let d = Infinity;
    for (const poi of pois) d = Math.min(d, dist(p, [poi.x, poi.y]));
    if (d < radius) continue;
    const rel = Math.min(1, (d - radius) / radius);
    cands.push({ point: p, blockId: block.id, lotId: lot.id, distance: d, score: 0.35 + 0.35 * rel + 0.3 * block.density });
  }
  cands.sort((a, b) => b.score - a.score || a.lotId!.localeCompare(b.lotId!));
  const out: CoverageGap[] = [];
  for (const c of cands) {
    if (out.length >= max) break;
    if (out.some((o) => dist(o.point, c.point) < minSpacing)) continue;
    out.push(c);
  }
  return out;
}

/** Area total cubierta por un conjunto de bandas (union aproximada por envolvente de cada banda; sin doble conteo entre pares convexos). */
export function coveredArea(bands: readonly IsochroneBand[]): number {
  let total = 0;
  for (const b of bands) total += area(b.polygon);
  for (let i = 0; i < bands.length; i++) for (let j = i + 1; j < bands.length; j++) {
    const inter = convexIntersection(bands[i]!.polygon, bands[j]!.polygon);
    if (inter.length >= 3) total -= area(inter);
  }
  return Math.max(0, total);
}

/** Envolvente convexa de un conjunto de tiendas (para "zona" de una seleccion). */
export function hullOf(pois: readonly Poi[]): Polygon | null {
  if (pois.length < 3) return null;
  const h = polygonHull(pois.map((p) => [p.x, p.y] as [number, number]));
  return h ? h.map((q) => [q[0], q[1]] as Vec2) : null;
}

/** Centro de masas de un conjunto de tiendas ponderado por una metrica (o uniforme). */
export function weightedCenter(pois: readonly Poi[], weight?: (p: Poi) => number): Vec2 | null {
  if (!pois.length) return null;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const p of pois) {
    const w = weight ? Math.max(0, weight(p)) : 1;
    sx += p.x * w;
    sy += p.y * w;
    sw += w;
  }
  if (sw <= 0) return centroid(pois.map((p) => [p.x, p.y] as Vec2));
  return [sx / sw, sy / sw];
}

