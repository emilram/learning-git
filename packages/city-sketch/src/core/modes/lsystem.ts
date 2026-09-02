/** Crecimiento por reglas (Parish-Muller simplificado): cola de segmentos con metas globales y restricciones locales. */
import { createSimplex2D } from '../geom/noise';
import { dist, segIntersect } from '../geom/vec';
import type { ModeGenerator, RawLine, StreetClass, Vec2 } from '../types';

interface Seg {
  a: Vec2;
  b: Vec2;
  cls: StreetClass;
  t: number;
  depth: number;
}

export const lsystemMode: ModeGenerator = (ctx) => {
  const { params, bounds } = ctx;
  const rng = ctx.rng('lsystem');
  const noise = createSimplex2D(rng.fork('pop'));
  const L = ((params.blockSize.min + params.blockSize.max) / 2) * (1.3 - params.density * 0.6);
  const maxSegments = Math.round(((bounds.w * bounds.h) / (L * L)) * (1.5 + params.density * 2));
  const snap = Math.max(params.cleanup.snapTolerance * 2, L * 0.25);
  const center: Vec2 = [bounds.w / 2, bounds.h / 2];
  const population = (p: Vec2): number => {
    const d = dist(p, center) / Math.hypot(bounds.w / 2, bounds.h / 2);
    return Math.max(0, 1 - d * 0.9) * 0.7 + 0.3 * (0.5 + 0.5 * noise(p[0] / 300, p[1] / 300));
  };
  const accepted: Seg[] = [];
  const nodes: Vec2[] = [];
  const queue: Seg[] = [];
  const inBounds = (p: Vec2): boolean => p[0] >= 0 && p[1] >= 0 && p[0] <= bounds.w && p[1] <= bounds.h;

  const spawn = (a: Vec2, angle: number, cls: StreetClass, t: number, depth: number): void => {
    const len = cls === 'avenue' ? L * 1.6 : L;
    queue.push({ a, b: [a[0] + Math.cos(angle) * len, a[1] + Math.sin(angle) * len], cls, t, depth });
  };

  // Semillas: cruce inicial de avenidas en el centro + centros de distrito.
  const seeds: Vec2[] = [center, ...ctx.districts.map((d) => d.center)];
  seeds.forEach((s, i) => {
    const base = rng.range(0, Math.PI / 2);
    for (let k = 0; k < 4; k++) spawn(s, base + (k * Math.PI) / 2, 'avenue', i * 3, 0);
  });

  const localConstraints = (s: Seg): Seg | null => {
    if (!inBounds(s.a)) return null;
    let b = s.b;
    if (!inBounds(b)) {
      // Recortar al borde.
      const t = Math.min(
        b[0] < 0 ? s.a[0] / (s.a[0] - b[0]) : b[0] > bounds.w ? (bounds.w - s.a[0]) / (b[0] - s.a[0]) : 1,
        b[1] < 0 ? s.a[1] / (s.a[1] - b[1]) : b[1] > bounds.h ? (bounds.h - s.a[1]) / (b[1] - s.a[1]) : 1,
      );
      b = [s.a[0] + (b[0] - s.a[0]) * t, s.a[1] + (b[1] - s.a[1]) * t];
      if (dist(s.a, b) < snap) return null;
      return { ...s, b, depth: 9999 };
    }
    // Snap a nodo cercano.
    for (const n of nodes) {
      if (dist(n, b) < snap && dist(n, s.a) > snap) return { ...s, b: n, depth: 9999 };
    }
    // Interseccion con segmentos existentes: truncar y detener.
    let bestT = 1;
    let hit: Vec2 | null = null;
    for (const e of accepted) {
      const r = segIntersect(s.a, b, e.a, e.b);
      if (!r) continue;
      const [t] = r;
      if (t < 1e-6) continue;
      if (t < bestT) {
        bestT = t;
        hit = [s.a[0] + (b[0] - s.a[0]) * t, s.a[1] + (b[1] - s.a[1]) * t];
      }
    }
    if (hit) {
      if (dist(s.a, hit) < snap) return null;
      return { ...s, b: hit, depth: 9999 };
    }
    return { ...s, b };
  };

  let guard = 0;
  while (queue.length && accepted.length < maxSegments && guard++ < maxSegments * 20) {
    // Menor t primero (cola de prioridad simple por seleccion).
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if ((queue[i] as Seg).t < (queue[bi] as Seg).t) bi = i;
    const s = queue[bi] as Seg;
    queue[bi] = queue[queue.length - 1] as Seg;
    queue.pop();
    const ok = localConstraints(s);
    if (!ok) continue;
    accepted.push(ok);
    nodes.push(ok.b);
    if (ok.depth === 9999) continue;
    const pop = population(ok.b);
    const angle = Math.atan2(ok.b[1] - ok.a[1], ok.b[0] - ok.a[0]);
    const wobble = rng.gauss(0, params.chaos * 0.35);
    // Meta global: seguir recto con leve giro hacia mayor poblacion.
    let bestA = angle + wobble;
    let bestP = -1;
    for (const da of [-0.3, 0, 0.3]) {
      const q: Vec2 = [ok.b[0] + Math.cos(angle + da) * L, ok.b[1] + Math.sin(angle + da) * L];
      const p = population(q);
      if (p > bestP) {
        bestP = p;
        bestA = angle + da * params.curvature + wobble;
      }
    }
    if (ok.cls === 'avenue') {
      spawn(ok.b, bestA, 'avenue', ok.t + 1, ok.depth + 1);
      if (rng.chance(0.55 * pop + 0.2)) spawn(ok.b, angle + Math.PI / 2 + rng.gauss(0, params.chaos * 0.3), 'street', ok.t + 4, 0);
      if (rng.chance(0.55 * pop + 0.2)) spawn(ok.b, angle - Math.PI / 2 + rng.gauss(0, params.chaos * 0.3), 'street', ok.t + 4, 0);
      if (rng.chance(0.08 * params.density)) spawn(ok.b, angle + (rng.chance(0.5) ? 1 : -1) * Math.PI / 2, 'avenue', ok.t + 2, 0);
    } else {
      if (rng.chance(0.85 * pop + 0.1)) spawn(ok.b, bestA, 'street', ok.t + 1, ok.depth + 1);
      if (rng.chance(0.45 * pop)) spawn(ok.b, angle + Math.PI / 2 + rng.gauss(0, params.chaos * 0.3), 'street', ok.t + 2, 0);
      if (rng.chance(0.45 * pop)) spawn(ok.b, angle - Math.PI / 2 + rng.gauss(0, params.chaos * 0.3), 'street', ok.t + 2, 0);
    }
  }
  const lines: RawLine[] = accepted.map((s) => ({ points: [s.a, s.b], cls: s.cls }));
  return lines;
};
