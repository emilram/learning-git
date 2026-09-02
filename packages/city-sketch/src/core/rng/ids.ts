/**
 * Ids estables: cyrb53 sobre (semilla, etapa, clave) truncado a 8 hex.
 * Las colisiones dentro de un mismo modelo reciben sufijo determinista.
 */
import type { BlockId, DistrictId, IdFactory, LabelId, LabelKind, LotId, NodeId, PoiId, StreetId, Vec2 } from '../types';

export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashHex(parts: readonly (string | number)[], len = 8): string {
  return cyrb53(parts.join('|')).toString(16).padStart(14, '0').slice(0, len);
}

export function createIdFactory(seed: string): IdFactory {
  const used = new Map<string, number>();
  const unique = (base: string): string => {
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
  const make = (prefix: string, stage: string, ...keys: (string | number)[]): string =>
    unique(`${prefix}_${hashHex([seed, stage, ...keys])}`);
  return {
    node: (x, y) => make('n', 'node', Math.round(x * 10), Math.round(y * 10)) as NodeId,
    street: (from, to, ordinal) => make('s', 'street', from, to, ordinal) as StreetId,
    block: (c: Vec2) => make('b', 'block', Math.round(c[0]), Math.round(c[1])) as BlockId,
    lot: (blockId, ordinal) => make('l', 'lot', blockId, ordinal) as LotId,
    poi: (key) => make('p', 'poi', key) as PoiId,
    label: (kind: LabelKind, targetId) => make('t', 'label', kind, targetId) as LabelId,
    district: (ordinal) => make('d', 'district', ordinal) as DistrictId,
  };
}
