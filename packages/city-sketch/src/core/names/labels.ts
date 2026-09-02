/** Nombres procedurales de calles y etiquetas con resolucion de colisiones greedy por prioridad. */
import { bbox } from '../geom/polygon';
import { dist, dot, norm, sub } from '../geom/vec';
import type { Label, PipelineContext, Rect, Street, StreetClass, StreetNameLists, Vec2 } from '../types';
import { STREET_NAMES } from './lists';

export function assignStreetNames(ctx: PipelineContext, streets: readonly Street[]): Street[] {
  const { naming } = ctx.params;
  if (!naming.enabled) return streets.slice();
  const base = STREET_NAMES[naming.locale];
  const lists: StreetNameLists = {
    prefixes: [...(naming.lists?.prefixes ?? []), ...base.prefixes],
    avenues: [...(naming.lists?.avenues ?? []), ...base.avenues],
    streets: [...(naming.lists?.streets ?? []), ...base.streets],
    alleys: [...(naming.lists?.alleys ?? []), ...base.alleys],
    districts: base.districts,
  };
  const rng = ctx.rng('names');
  const pools: Record<StreetClass, string[]> = {
    avenue: rng.fork('av').shuffle(lists.avenues),
    street: rng.fork('st').shuffle(lists.streets),
    alley: rng.fork('al').shuffle(lists.alleys),
  };
  const counters: Record<StreetClass, number> = { avenue: 0, street: 0, alley: 0 };
  const ordered = streets
    .map((s, i) => ({ s, i }))
    .sort((p, q) => q.s.length - p.s.length || p.i - q.i);
  const names = new Map<string, string>();
  for (const { s } of ordered) {
    const pool = pools[s.class];
    const k = counters[s.class]++;
    const baseName = pool[k % pool.length]!;
    const round = Math.floor(k / pool.length);
    let name = baseName;
    if (s.class === 'street' && naming.locale === 'es') {
      const prefix = lists.prefixes[k % lists.prefixes.length]!;
      name = `${prefix} ${baseName}`;
    } else if (s.class === 'street' && naming.locale === 'en') {
      const prefix = lists.prefixes[k % lists.prefixes.length]!;
      name = prefix ? `${prefix} ${baseName}` : baseName;
    }
    if (round > 0) name = `${name} ${round + 1}`;
    names.set(s.id, name);
  }
  return streets.map((s) => (names.has(s.id) ? { ...s, name: names.get(s.id)! } : s));
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Ventana mas recta de longitud `want` a lo largo de la polilinea. */
function straightestWindow(pl: readonly Vec2[], want: number): Vec2[] | null {
  const total = pl.reduce((s, p, i) => (i ? s + dist(pl[i - 1]!, p) : 0), 0);
  if (total < want) return null;
  // Remuestrear cada 6 unidades.
  const step = 6;
  const samples: Vec2[] = [pl[0]!];
  let acc = 0;
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1]!;
    const b = pl[i]!;
    const L = dist(a, b);
    let t = step - acc;
    while (t <= L) {
      samples.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]);
      t += step;
    }
    acc = L - (t - step);
  }
  const n = Math.max(2, Math.round(want / step));
  if (samples.length < n) return null;
  let best = -1;
  let bestTurn = Infinity;
  for (let s = 0; s + n <= samples.length; s++) {
    let turn = 0;
    for (let i = s + 1; i + 1 < s + n; i++) {
      const d0 = norm(sub(samples[i]!, samples[i - 1]!));
      const d1 = norm(sub(samples[i + 1]!, samples[i]!));
      turn += 1 - dot(d0, d1);
    }
    // Preferir el centro de la calle en caso de empate.
    const centerBias = Math.abs(s + n / 2 - samples.length / 2) * 1e-4;
    if (turn + centerBias < bestTurn) {
      bestTurn = turn + centerBias;
      best = s;
    }
  }
  if (best < 0) return null;
  const win = samples.slice(best, best + n);
  const first = win[0]!;
  const last = win[win.length - 1]!;
  return last[0] < first[0] ? win.reverse() : win;
}

export function buildLabels(ctx: PipelineContext, streets: readonly Street[]): Label[] {
  const { naming } = ctx.params;
  if (!naming.enabled) return [];
  const weight: Record<StreetClass, number> = { avenue: 3, street: 1.5, alley: 0.6 };
  const candidates = streets
    .filter((s) => s.name && s.length >= naming.minLabelLength)
    .map((s) => ({ s, priority: weight[s.class] * s.length }))
    .sort((p, q) => q.priority - p.priority || (p.s.id < q.s.id ? -1 : 1));
  const take = Math.round(candidates.length * naming.labelDensity);
  const placed: Rect[] = [];
  const labels: Label[] = [];
  for (const { s, priority } of candidates.slice(0, take)) {
    const text = s.name!;
    const fontSize = naming.fontSize * (s.class === 'avenue' ? 1.15 : s.class === 'alley' ? 0.85 : 1);
    const textWidth = text.length * fontSize * 0.58;
    const win = straightestWindow(s.polyline, textWidth * 1.25);
    if (!win) continue;
    const bb = bbox(win);
    const rect: Rect = { x: bb.x - fontSize, y: bb.y - fontSize, w: bb.w + fontSize * 2, h: bb.h + fontSize * 2 };
    if (placed.some((r) => rectsOverlap(r, rect))) continue;
    placed.push(rect);
    labels.push({
      id: ctx.ids.label('street', s.id),
      kind: 'street',
      text,
      targetId: s.id,
      path: win,
      startOffset: 50,
      fontSize,
      priority,
      bbox: rect,
    });
  }
  return labels;
}
