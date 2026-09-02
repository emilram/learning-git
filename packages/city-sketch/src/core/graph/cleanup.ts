/**
 * Limpieza topologica en orden fijo e idempotente:
 * 1 fusion de intersecciones cercanas, 2 contraccion de calles cortas,
 * 3 aristas casi paralelas, 4 poda de filamentos, 5 fusion de nodos de grado 2,
 * 6 degradacion a callejon.
 */
import { polylineLength } from '../geom/vec';
import type { CleanupParams, StreetHierarchy } from '../types';
import { nodeDist, type GEdge, type PlanarGraph } from './planar';

function removeDegenerate(g: PlanarGraph): void {
  const seen = new Map<string, number>();
  g.edges.forEach((e, i) => {
    if (!e.alive) return;
    if (e.a === e.b) {
      g.killEdge(i);
      return;
    }
    const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
      // Duplicado: conservar el mas largo (probablemente curvo y real) salvo que sea marco.
      const pe = g.edges[prev] as GEdge;
      if (pe.frame) g.killEdge(i);
      else if (e.frame) {
        g.killEdge(prev);
        seen.set(key, i);
      } else if (polylineLength(e.polyline) < polylineLength(pe.polyline)) g.killEdge(i);
      else {
        g.killEdge(prev);
        seen.set(key, i);
      }
      return;
    }
    seen.set(key, i);
  });
}

function mergeCloseIntersections(g: PlanarGraph, radius: number): void {
  if (radius <= 0) return;
  const adj = g.adjacency();
  const candidates: number[] = [];
  g.nodes.forEach((n, i) => {
    if (n.alive && !n.frame && (adj[i] as number[]).length >= 3) candidates.push(i);
  });
  const cell = Math.max(radius, 1);
  const cols = Math.ceil(g.bounds.w / cell) + 3;
  const buckets = new Map<number, number[]>();
  for (const ni of candidates) {
    const n = g.nodes[ni]!;
    const k = (Math.floor(n.y / cell) + 1) * cols + Math.floor(n.x / cell) + 1;
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(ni);
  }
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (const ni of candidates) {
    const n = g.nodes[ni]!;
    const cx = Math.floor(n.x / cell) + 1;
    const cy = Math.floor(n.y / cell) + 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = buckets.get((cy + dy) * cols + cx + dx);
        if (!arr) continue;
        for (const nj of arr) {
          if (nj <= ni) continue;
          if (nodeDist(g, ni, nj) <= radius) {
            const ri = find(ni);
            const rj = find(nj);
            if (ri !== rj) parent.set(Math.max(ri, rj), Math.min(ri, rj));
          }
        }
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const ni of candidates) {
    const r = find(ni);
    if (r === ni && !parent.has(ni)) continue;
    let arr = groups.get(r);
    if (!arr) {
      arr = [r];
      groups.set(r, arr);
    }
    if (ni !== r) arr.push(ni);
  }
  for (const [root, members] of groups) {
    let sx = 0;
    let sy = 0;
    for (const m of members) {
      sx += g.nodes[m]!.x;
      sy += g.nodes[m]!.y;
    }
    g.moveNode(root, sx / members.length, sy / members.length);
    for (const m of members) if (m !== root) g.mergeNodeInto(m, root);
  }
  removeDegenerate(g);
}

function contractShortEdges(g: PlanarGraph, minLength: number): void {
  if (minLength <= 0) return;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const adj = g.adjacency();
    for (let i = 0; i < g.edges.length; i++) {
      const e = g.edges[i] as GEdge;
      if (!e.alive || e.frame) continue;
      if (polylineLength(e.polyline) >= minLength) continue;
      const na = g.nodes[e.a]!;
      const nb = g.nodes[e.b]!;
      if (na.frame && nb.frame) continue;
      // Conservar el nodo de mayor grado (o el del marco).
      let keep = e.a;
      let drop = e.b;
      const da = (adj[e.a] as number[]).length;
      const db = (adj[e.b] as number[]).length;
      if (nb.frame || (!na.frame && db > da)) {
        keep = e.b;
        drop = e.a;
      }
      if (!g.nodes[keep]!.frame) {
        g.moveNode(keep, (na.x + nb.x) / 2, (na.y + nb.y) / 2);
      }
      g.killEdge(i);
      g.mergeNodeInto(drop, keep);
      changed = true;
    }
    removeDegenerate(g);
    if (!changed) break;
  }
}

function removeNearParallel(g: PlanarGraph, angleDeg: number): void {
  if (angleDeg <= 0) return;
  const limit = (angleDeg * Math.PI) / 180;
  const adj = g.adjacency();
  for (let n = 0; n < g.nodes.length; n++) {
    if (!g.nodes[n]!.alive) continue;
    const es = (adj[n] as number[]).filter((ei) => g.edges[ei]!.alive);
    if (es.length < 2) continue;
    const withAngle = es.map((ei) => ({ ei, a: g.outAngle(ei, n) })).sort((p, q) => p.a - q.a);
    for (let i = 0; i < withAngle.length; i++) {
      const p = withAngle[i]!;
      const q = withAngle[(i + 1) % withAngle.length]!;
      if (p.ei === q.ei) continue;
      let diff = Math.abs(q.a - p.a);
      if (i === withAngle.length - 1) diff = 2 * Math.PI - diff;
      if (diff < limit) {
        const ep = g.edges[p.ei]!;
        const eq = g.edges[q.ei]!;
        if (!ep.alive || !eq.alive || ep.frame || eq.frame) continue;
        const victim = polylineLength(ep.polyline) < polylineLength(eq.polyline) ? p.ei : q.ei;
        g.killEdge(victim);
      }
    }
  }
}

export function pruneFilaments(g: PlanarGraph): void {
  let changed = true;
  while (changed) {
    changed = false;
    const adj = g.adjacency();
    for (let n = 0; n < g.nodes.length; n++) {
      const nd = g.nodes[n]!;
      if (!nd.alive) continue;
      const es = adj[n] as number[];
      if (es.length === 0) {
        g.killNode(n);
        changed = true;
      } else if (es.length === 1 && !nd.frame) {
        g.killEdge(es[0] as number);
        g.killNode(n);
        changed = true;
      }
    }
  }
}

function mergeDegreeTwo(g: PlanarGraph): void {
  const adj = g.adjacency();
  for (let n = 0; n < g.nodes.length; n++) {
    const nd = g.nodes[n]!;
    if (!nd.alive || nd.frame) continue;
    const es = (adj[n] as number[]).filter((ei) => g.edges[ei]!.alive);
    if (es.length !== 2) continue;
    const e1 = g.edges[es[0] as number]!;
    const e2 = g.edges[es[1] as number]!;
    if (e1.frame || e2.frame || e1.cls !== e2.cls) continue;
    const o1 = g.other(e1, n);
    const o2 = g.other(e2, n);
    if (o1 === o2 || o1 === n || o2 === n) continue;
    // Orientar: o1 → n → o2.
    const p1 = e1.a === o1 ? e1.polyline.slice() : e1.polyline.slice().reverse();
    const p2 = e2.a === n ? e2.polyline.slice() : e2.polyline.slice().reverse();
    const merged = [...p1, ...p2.slice(1)];
    g.killEdge(es[0] as number);
    g.killEdge(es[1] as number);
    g.killNode(n);
    g.addEdge(o1, o2, e1.cls, merged);
    // La adyacencia cambio: recalcular y continuar.
    const fresh = g.adjacency();
    for (let i = 0; i < fresh.length; i++) adj[i] = fresh[i] as number[];
  }
}

function assignAlleys(g: PlanarGraph, hierarchy: StreetHierarchy): void {
  if (hierarchy.alleyRatio <= 0) return;
  const streets = g.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.alive && !e.frame && e.cls === 'street')
    .sort((p, q) => polylineLength(p.e.polyline) - polylineLength(q.e.polyline) || p.i - q.i);
  const n = Math.floor(streets.length * hierarchy.alleyRatio);
  for (let k = 0; k < n; k++) streets[k]!.e.cls = 'alley';
}

export function cleanupGraph(g: PlanarGraph, params: CleanupParams, hierarchy: StreetHierarchy): void {
  removeDegenerate(g);
  mergeCloseIntersections(g, params.mergeRadius);
  contractShortEdges(g, params.minStreetLength);
  removeNearParallel(g, params.parallelAngle);
  if (!params.deadEnds) pruneFilaments(g);
  else {
    // Aun con callejones sin salida se eliminan nodos huerfanos.
    const adj = g.adjacency();
    g.nodes.forEach((n, i) => {
      if (n.alive && (adj[i] as number[]).length === 0) g.killNode(i);
    });
  }
  mergeDegreeTwo(g);
  assignAlleys(g, hierarchy);
}
