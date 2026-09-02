/** Exportacion a SVG (string standalone) y PNG (rasterizado en canvas a la escala pedida). */
import { serializeIsoSvg, type IsoOptions } from '../core/svg/iso';
import { serializeSvg } from '../core/svg/serialize';
import type { CityModel, Theme } from '../core/types';

export interface ExportOptions {
  readonly view?: '2d' | 'iso';
  readonly iso?: Partial<IsoOptions>;
  /** Factor de escala para PNG (2 = retina). */
  readonly scale?: number;
  readonly fileName?: string;
}

export function exportSvgString(model: CityModel, theme: Theme, o: ExportOptions = {}): string {
  return o.view === 'iso' ? serializeIsoSvg(model, theme, { ...o.iso, fit: o.iso?.fit ?? 'contain' }).svg : serializeSvg(model, theme).svg;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportSvg(model: CityModel, theme: Theme, o: ExportOptions = {}): void {
  const svg = exportSvgString(model, theme, o);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), o.fileName ?? `${model.seed}-${theme.name}${o.view === 'iso' ? '-3d' : ''}.svg`);
}

export async function exportPng(model: CityModel, theme: Theme, o: ExportOptions = {}): Promise<Blob> {
  const svg = exportSvgString(model, theme, o);
  const scale = o.scale ?? 2;
  const m = /viewBox="([^"]+)"/.exec(svg);
  const [, , w, h] = (m?.[1] ?? `0 0 ${model.bounds.w} ${model.bounds.h}`).split(/\s+/).map(Number);
  const width = Math.round((w ?? model.bounds.w) * scale);
  const height = Math.round((h ?? model.bounds.h) * scale);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo rasterizar el SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('toBlob devolvio null');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadPng(model: CityModel, theme: Theme, o: ExportOptions = {}): Promise<void> {
  const blob = await exportPng(model, theme, o);
  downloadBlob(blob, o.fileName ?? `${model.seed}-${theme.name}${o.view === 'iso' ? '-3d' : ''}.png`);
}
