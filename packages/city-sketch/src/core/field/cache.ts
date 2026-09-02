/**
 * Cache del campo tensorial en rejilla con interpolacion bilineal de las
 * componentes [a, b]. Reduce ~5x el coste del trazado sin perder suavidad:
 * interpolar el tensor (no los eigenvectores) evita discontinuidades de signo.
 */
import type { Bounds, Vec2 } from '../types';
import type { TensorField, TensorSample } from './tensor';

export function cacheTensorField(field: TensorField, bounds: Bounds, cell: number): TensorField {
  const cols = Math.ceil(bounds.w / cell) + 2;
  const rows = Math.ceil(bounds.h / cell) + 2;
  const A = new Float32Array(cols * rows);
  const B = new Float32Array(cols * rows);
  const blocked = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p: Vec2 = [i * cell, j * cell];
      const k = j * cols + i;
      if (field.tensor) {
        const t = field.tensor(p);
        const mag = Math.hypot(t[0], t[1]);
        A[k] = mag < 1e-6 ? 0 : t[0] / mag;
        B[k] = mag < 1e-6 ? 0 : t[1] / mag;
      } else {
        const s = field.sample(p);
        if (s.degenerate) {
          A[k] = 0;
          B[k] = 0;
        } else {
          const th = Math.atan2(s.major[1], s.major[0]);
          A[k] = Math.cos(2 * th);
          B[k] = Math.sin(2 * th);
        }
      }
      blocked[k] = field.isBlocked(p) ? 1 : 0;
    }
  }
  const sample = (p: Vec2): TensorSample => {
    const fx = Math.max(0, Math.min(cols - 2, p[0] / cell));
    const fy = Math.max(0, Math.min(rows - 2, p[1] / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const k00 = j * cols + i;
    const k10 = k00 + 1;
    const k01 = k00 + cols;
    const k11 = k01 + 1;
    const a = (A[k00]! * (1 - tx) + A[k10]! * tx) * (1 - ty) + (A[k01]! * (1 - tx) + A[k11]! * tx) * ty;
    const b = (B[k00]! * (1 - tx) + B[k10]! * tx) * (1 - ty) + (B[k01]! * (1 - tx) + B[k11]! * tx) * ty;
    const mag = Math.hypot(a, b);
    if (mag < 1e-3) return { major: [1, 0], minor: [0, 1], degenerate: true };
    const th = 0.5 * Math.atan2(b, a);
    const c = Math.cos(th);
    const s = Math.sin(th);
    return { major: [c, s], minor: [-s, c], degenerate: false };
  };
  const isBlocked = (p: Vec2): boolean => {
    const i = Math.round(Math.max(0, Math.min(cols - 1, p[0] / cell)));
    const j = Math.round(Math.max(0, Math.min(rows - 1, p[1] / cell)));
    return blocked[j * cols + i] === 1;
  };
  return { sample, isBlocked };
}
