/** Constructores de atributos `d` compartidos por el serializador y por Vue. */
import type { Polygon, Polyline } from '../types';

export function fmt(n: number, precision = 2): string {
  const s = n.toFixed(precision);
  // Quitar ceros finales para SVG mas compacto y estable.
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function polylinePath(pl: Polyline, precision = 2): string {
  if (pl.length === 0) return '';
  let d = `M${fmt(pl[0]![0], precision)} ${fmt(pl[0]![1], precision)}`;
  for (let i = 1; i < pl.length; i++) d += `L${fmt(pl[i]![0], precision)} ${fmt(pl[i]![1], precision)}`;
  return d;
}

export function polygonPath(poly: Polygon, precision = 2): string {
  return poly.length ? `${polylinePath(poly, precision)}Z` : '';
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
