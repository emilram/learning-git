/** Extent numerico sin depender de d3-array (fuera de la lista de submodulos permitidos). */
export function extent(values: readonly number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  if (lo === hi) return [lo, lo + 1];
  return [lo, hi];
}
