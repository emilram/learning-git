/**
 * PRNG determinista: xmur3 (hash de cadena a 4 semillas de 32 bits) + sfc32.
 * sfc32 pasa PractRand y BigCrush con estado de 128 bits; nunca se usa Math.random.
 */
import type { Rng } from '../types';

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

class SeededRng implements Rng {
  private readonly gen: () => number;
  private spare: number | null = null;

  constructor(private readonly key: string) {
    const h = xmur3(key);
    this.gen = sfc32(h(), h(), h(), h());
    // Descartar los primeros valores: sfc32 necesita unas iteraciones para mezclar el estado.
    for (let i = 0; i < 12; i++) this.gen();
  }

  next(): number {
    return this.gen();
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.gen();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.gen() * (max - min + 1));
  }

  gauss(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return mean + sd * s;
    }
    let u = 0;
    let w = 0;
    while (u === 0) u = this.gen();
    while (w === 0) w = this.gen();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * w;
    this.spare = r * Math.sin(th);
    return mean + sd * r * Math.cos(th);
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick() sobre arreglo vacio');
    return arr[Math.floor(this.gen() * arr.length)] as T;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.gen() * (i + 1));
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  chance(p: number): boolean {
    return this.gen() < p;
  }

  fork(label: string): Rng {
    return new SeededRng(`${this.key}/${label}`);
  }
}

export function createRng(seed: string, label = 'root'): Rng {
  return new SeededRng(`${seed}::${label}`);
}
