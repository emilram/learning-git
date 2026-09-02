/**
 * Vista 2.5D isometrica en SVG: proyeccion oblicua del modelo, extrusion de
 * lotes como edificios (algoritmo del pintor + backface culling), tiendas como
 * edificios destacados con pin, calles y manzanas en el plano del suelo.
 */
import { cyrb53 } from '../rng/ids';
import { createRng } from '../rng/prng';
import { area, centroid, ensurePositive } from '../geom/polygon';
import { baseStylesheet, resolveColor, themeVariables, variablesToCss } from '../../theme/css';
import type { Block, CityModel, ElementStyle, LandUse, Lot, Poi, Polygon, SvgOutput, Theme, Vec2 } from '../types';
import { escapeXml, fmt } from './paths';

export interface IsoOptions {
  /** Rotacion (yaw) en grados alrededor del centro. */
  readonly rotation: number;
  /** Inclinacion (pitch) en grados: 90 = cenital, 30 = muy rasante. */
  readonly pitch: number;
  /** Multiplicador global de altura. */
  readonly heightScale: number;
  /** Altura extra (x) de los edificios que alojan tiendas. */
  readonly storeBoost: number;
  /** Dibujar lotes sin tienda como edificios. */
  readonly buildings: boolean;
  /** Etiquetas de tienda sobre el pin. */
  readonly storeLabels: boolean;
  /** Altura por lote (unidades de mundo). Permite mapear metricas a altura. */
  readonly lotHeight?: (lot: Lot, block: Block, poi: Poi | null) => number;
  readonly idPrefix: string;
  readonly precision: number;
  readonly embedStyles: boolean;
  readonly accessible: boolean;
  /** Margen del viewBox en unidades de mundo. */
  readonly padding: number;
  /** contain: todo el lienzo visible; cover: recorte centrado a pantalla completa. */
  readonly fit: 'contain' | 'cover';
  /** Zoom sobre el centro en modo cover (1 = tamaño del lienzo). */
  readonly zoom: number;
}

export const DEFAULT_ISO_OPTIONS: IsoOptions = {
  rotation: 35,
  pitch: 55,
  heightScale: 1,
  storeBoost: 1.8,
  buildings: true,
  storeLabels: true,
  idPrefix: 'cs',
  precision: 1,
  embedStyles: true,
  accessible: true,
  padding: 40,
  fit: 'contain',
  zoom: 1.5,
};

interface Projector {
  /** Proyecta (x, y, z) a pantalla. */
  p(x: number, y: number, z: number): Vec2;
  /** Coordenadas rotadas (u, v) sin proyectar; v crece hacia el espectador. */
  uv(x: number, y: number): Vec2;
}

function makeProjector(model: CityModel, o: IsoOptions): Projector {
  const cx = model.bounds.w / 2;
  const cy = model.bounds.h / 2;
  const th = (o.rotation * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const pitch = (Math.max(15, Math.min(89, o.pitch)) * Math.PI) / 180;
  const kv = Math.sin(pitch); // compresion vertical del plano
  const kz = Math.cos(pitch); // proyeccion de la altura
  return {
    uv(x, y) {
      const dx = x - cx;
      const dy = y - cy;
      return [dx * c - dy * s, dx * s + dy * c];
    },
    p(x, y, z) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * c - dy * s;
      const v = dx * s + dy * c;
      return [cx + u, cy + v * kv - z * kz];
    },
  };
}

/** Parsea oklch(L% C H [/ A]) y devuelve una variante con L desplazado. */
export function shiftOklch(color: string, dL: number, dC = 0): string {
  const m = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)/.exec(color);
  if (!m) return color;
  const L = Math.max(0, Math.min(100, parseFloat(m[1]!) + dL));
  const C = Math.max(0, parseFloat(m[2]!) + dC);
  const H = m[3]!;
  return m[4] ? `oklch(${L.toFixed(1)}% ${C.toFixed(3)} ${H} / ${m[4]})` : `oklch(${L.toFixed(1)}% ${C.toFixed(3)} ${H})`;
}

interface Building {
  readonly id: string;
  readonly footprint: Polygon;
  readonly height: number;
  readonly depth: number;
  readonly baseColor: string;
  readonly poi: Poi | null;
  readonly lot: Lot;
  readonly overrides: ElementStyle | undefined;
}

function styleAttrs(o: ElementStyle | undefined): string {
  if (!o) return '';
  let s = '';
  if (o.style) s += ` style="${escapeXml(o.style)}"`;
  if (o.data) for (const [k, v] of Object.entries(o.data)) s += ` data-${k}="${escapeXml(v)}"`;
  return s;
}

export function serializeIsoSvg(model: CityModel, theme: Theme, opts: Partial<IsoOptions> = {}): SvgOutput {
  const o: IsoOptions = { ...DEFAULT_ISO_OPTIONS, ...opts };
  const pr = makeProjector(model, o);
  const P = o.precision;
  const prefix = o.idPrefix;
  const vars = themeVariables(theme);
  const parts: string[] = [];
  const pt = (q: Vec2): string => `${fmt(q[0], P)} ${fmt(q[1], P)}`;
  const poly3 = (poly: Polygon, z: number): string => `M${poly.map((q) => pt(pr.p(q[0], q[1], z))).join('L')}Z`;
  const line3 = (pl: readonly Vec2[]): string => `M${pl.map((q) => pt(pr.p(q[0], q[1], 0))).join('L')}`;

  // ViewBox: proyectar las esquinas del lienzo y la altura maxima.
  const { w, h } = model.bounds;
  const corners: Vec2[] = ([[0, 0], [w, 0], [w, h], [0, h]] as Vec2[]).map((q) => pr.p(q[0], q[1], 0));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of corners) {
    minX = Math.min(minX, q[0]);
    maxX = Math.max(maxX, q[0]);
    minY = Math.min(minY, q[1]);
    maxY = Math.max(maxY, q[1]);
  }
  const maxH = 40 * o.heightScale * o.storeBoost;
  let vb: [number, number, number, number] = [minX - o.padding, minY - o.padding - maxH, maxX - minX + o.padding * 2, maxY - minY + o.padding * 2 + maxH];
  if (o.fit === 'cover') {
    const kv = Math.sin((Math.max(15, Math.min(89, o.pitch)) * Math.PI) / 180);
    const cw = w / o.zoom;
    const ch = (h * kv) / o.zoom;
    const cxs = w / 2;
    const cys = h / 2 - maxH * 0.25;
    vb = [cxs - cw / 2, cys - ch / 2, cw, ch];
  }

  const rootAttrs = [
    `xmlns="http://www.w3.org/2000/svg"`,
    `viewBox="${vb.map((n) => fmt(n, 1)).join(' ')}"`,
    `class="${prefix}-root ${prefix}-iso"`,
    `data-seed="${escapeXml(model.seed)}"`,
    `data-view="iso"`,
    `style="${escapeXml(variablesToCss(vars))}"`,
  ];
  if (o.accessible) rootAttrs.push(`role="img"`, `aria-labelledby="${prefix}-title ${prefix}-desc"`);
  parts.push(`<svg ${rootAttrs.join(' ')}>`);
  if (o.accessible) {
    parts.push(
      `<title id="${prefix}-title">${escapeXml(`Croquis 3D ${model.seed}`)}</title><desc id="${prefix}-desc">${escapeXml(`Vista isometrica con ${model.streets.length} calles, ${model.lots.length} edificios y ${model.pois.length} tiendas.`)}</desc>`,
    );
  }
  if (o.embedStyles) {
    parts.push(
      `<style>${baseStylesheet(`.${prefix}-root`)}\n.${prefix}-iso .cs-wall{stroke:var(--cs-ink-muted);stroke-width:0.35;stroke-linejoin:round}.${prefix}-iso .cs-roof{stroke:var(--cs-ink-muted);stroke-width:0.4;stroke-linejoin:round}.${prefix}-iso .cs-shadow{fill:var(--cs-ink);opacity:0.12}.${prefix}-iso .cs-pin{stroke:var(--cs-ink);stroke-width:1}.${prefix}-iso .cs-pin-head{fill:var(--cs-poi-fill);stroke:var(--cs-poi-stroke);stroke-width:1.2}.${prefix}-iso .cs-pin-ring{fill:none;stroke:var(--cs-poi-ring);stroke-width:1.5}.${prefix}-iso .cs-pin-label{font-family:var(--cs-label-font);font-size:9px;font-weight:600;fill:var(--cs-ink);paint-order:stroke;stroke:var(--cs-surface);stroke-width:3;stroke-linejoin:round;text-anchor:middle}</style>`,
    );
  }
  // Suelo: lienzo proyectado.
  parts.push(`<g data-layer="canvas"><path class="cs-canvas" d="${poly3([[0, 0], [w, 0], [w, h], [0, h]], 0)}"/></g>`);

  // Manzanas (suelo).
  parts.push(`<g data-layer="blocks">`);
  const blockById = new Map<string, Block>();
  for (const b of model.blocks) {
    blockById.set(b.id, b);
    const ov = model.meta.params.overrides.blocks?.[b.id] ?? b.overrides;
    const cls = ov?.className ? `cs-block cs-lu-${b.landUse} ${ov.className}` : `cs-block cs-lu-${b.landUse}`;
    parts.push(`<path class="${cls}" d="${poly3(b.polygon, 0)}" data-id="${b.id}" data-landuse="${b.landUse}"${styleAttrs(ov)}/>`);
    const pattern = theme.components.block[b.landUse].pattern;
    if (pattern !== 'none') parts.push(`<path class="cs-pattern" d="${poly3(b.polygon, 0)}" fill="url(#${prefix}-${pattern})" style="color:var(--cs-block-${b.landUse}-stroke)"/>`);
  }
  parts.push(`</g>`);
  // Patrones (mismos ids que el serializador 2D).
  parts.push(
    `<defs><pattern id="${prefix}-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="0.6"/></pattern><pattern id="${prefix}-cross-hatch" patternUnits="userSpaceOnUse" width="6" height="6"><path d="M0 3H6M3 0V6" stroke="currentColor" stroke-width="0.5"/></pattern><pattern id="${prefix}-dots" patternUnits="userSpaceOnUse" width="5" height="5"><circle cx="2.5" cy="2.5" r="0.7" fill="currentColor"/></pattern><pattern id="${prefix}-grid" patternUnits="userSpaceOnUse" width="8" height="8"><path d="M8 0H0V8" fill="none" stroke="currentColor" stroke-width="0.4"/></pattern></defs>`,
  );

  // Calles (suelo): casing + relleno, ancho escalado por la compresion media.
  const widthScale = (cls: 'avenue' | 'street' | 'alley'): number => theme.components.street[cls].widthScale;
  parts.push(`<g data-layer="streets-casing">`);
  for (const s of model.streets) {
    if (!theme.components.street[s.class].casing) continue;
    parts.push(`<path class="cs-street cs-casing cs-${s.class}" d="${line3(s.polyline)}" stroke-width="${(s.width * widthScale(s.class) + 1.6).toFixed(2)}"/>`);
  }
  parts.push(`</g><g data-layer="streets">`);
  for (const s of model.streets) {
    const ov = model.meta.params.overrides.streets?.[s.id] ?? s.overrides;
    const cls = ov?.className ? `cs-street cs-fill cs-${s.class} ${ov.className}` : `cs-street cs-fill cs-${s.class}`;
    const dash = theme.components.street[s.class].dash;
    parts.push(`<path class="${cls}" d="${line3(s.polyline)}" stroke-width="${(s.width * widthScale(s.class)).toFixed(2)}"${dash ? ` stroke-dasharray="${dash}"` : ''} data-id="${s.id}"${styleAttrs(ov)}/>`);
  }
  parts.push(`</g>`);

  // Edificios.
  const poiByLot = new Map<string, Poi>();
  for (const poi of model.pois) if (poi.anchor.kind === 'lot') poiByLot.set(poi.anchor.lotId, poi);
  const rng = createRng(model.seed, 'iso-heights');
  const buildings: Building[] = [];
  const skip: ReadonlySet<LandUse> = new Set<LandUse>(['park', 'water', 'plaza']);
  for (const lot of model.lots) {
    const block = blockById.get(lot.blockId);
    if (!block || skip.has(block.landUse)) continue;
    const poi = poiByLot.get(lot.id) ?? null;
    if (!o.buildings && !poi) continue;
    const a = area(lot.polygon);
    if (a < 60) continue;
    const jitter = createRng(model.seed, `h:${lot.id}`).range(-2, 3);
    let height = o.lotHeight
      ? o.lotHeight(lot, block, poi)
      : (7 + block.density * 22 + (block.landUse === 'retail' ? 5 : 0) + jitter + Math.min(8, Math.sqrt(a) * 0.12)) * o.heightScale;
    if (poi && !o.lotHeight) height *= o.storeBoost;
    height = Math.max(1, height);
    const fp = ensurePositive(lot.polygon);
    const c = centroid(fp);
    const [, v] = pr.uv(c[0], c[1]);
    const base = poi ? resolveColor(theme, 'accentAlt') : resolveColor(theme, theme.components.block[block.landUse].fill);
    buildings.push({ id: lot.id, footprint: fp, height, depth: v, baseColor: base, poi, lot, overrides: poi ? (model.meta.params.overrides.pois?.[poi.id] ?? poi.overrides) : undefined });
  }
  void rng;
  buildings.sort((p, q) => p.depth - q.depth || (p.id < q.id ? -1 : 1));

  const dark = theme.scheme === 'dark';
  const shade = { roof: dark ? 10 : 4, lit: dark ? 2 : -6, shadow: dark ? -6 : -16, poiRoof: dark ? 8 : 6 };
  parts.push(`<g data-layer="buildings">`);
  for (const b of buildings) {
    const fp = b.footprint;
    const n = fp.length;
    const cls = b.poi ? 'cs-building cs-store' : 'cs-building';
    const attrs = ` data-id="${b.id}"${b.poi ? ` data-poi="${b.poi.id}"` : ''}`;
    parts.push(`<g class="${cls}"${attrs}${b.poi ? styleAttrs(b.overrides) : ''}>`);
    // Paredes visibles: normal exterior con componente v > 0 (hacia el espectador).
    for (let i = 0; i < n; i++) {
      const a = fp[i]!;
      const c = fp[(i + 1) % n]!;
      const ua = pr.uv(a[0], a[1]);
      const uc = pr.uv(c[0], c[1]);
      const du = uc[0] - ua[0];
      const dv = uc[1] - ua[1];
      // Area positiva = horaria en pantalla: interior a la derecha (-dv, du); exterior = (dv, -du).
      const nu = dv;
      const nv = -du;
      if (nv <= 0) continue;
      const lit = nu < 0;
      const fill = shiftOklch(b.baseColor, lit ? shade.lit : shade.shadow, lit ? 0 : -0.01);
      const d = `M${pt(pr.p(a[0], a[1], 0))}L${pt(pr.p(c[0], c[1], 0))}L${pt(pr.p(c[0], c[1], b.height))}L${pt(pr.p(a[0], a[1], b.height))}Z`;
      parts.push(`<path class="cs-wall${lit ? ' cs-wall-lit' : ' cs-wall-shade'}" d="${d}" fill="${fill}"/>`);
    }
    parts.push(`<path class="cs-roof" d="${poly3(fp, b.height)}" fill="${shiftOklch(b.baseColor, b.poi ? shade.poiRoof : shade.roof)}"/>`);
    parts.push(`</g>`);
  }
  parts.push(`</g>`);

  // Pins de tienda (encima de todo, ordenados por profundidad).
  const pinSize = theme.components.poi.size;
  parts.push(`<g data-layer="pois">`);
  const pinned = [...model.pois]
    .map((poi) => {
      const b = poi.anchor.kind === 'lot' ? buildings.find((x) => x.id === (poi.anchor as { lotId: string }).lotId) : undefined;
      const base: Vec2 = b ? centroid(b.footprint) : [poi.x, poi.y];
      const z = b ? b.height : 0;
      return { poi, base, z, depth: pr.uv(base[0], base[1])[1] };
    })
    .sort((p, q) => p.depth - q.depth);
  for (const { poi, base, z } of pinned) {
    const ov = model.meta.params.overrides.pois?.[poi.id] ?? poi.overrides;
    const foot = pr.p(base[0], base[1], z);
    const stem = 10 + pinSize;
    const head: Vec2 = [foot[0], foot[1] - stem];
    const sz = poi.kind === 'flagship' ? pinSize * 1.3 : poi.kind === 'kiosk' ? pinSize * 0.75 : pinSize;
    const cls = ov?.className ? `cs-poi-marker cs-kind-${poi.kind} ${ov.className}` : `cs-poi-marker cs-kind-${poi.kind}`;
    parts.push(
      `<g class="${cls}" data-id="${poi.id}" data-kind="${poi.kind}" data-label="${escapeXml(poi.label)}"${styleAttrs(ov)}>` +
        `<line class="cs-pin" x1="${fmt(foot[0], P)}" y1="${fmt(foot[1], P)}" x2="${fmt(head[0], P)}" y2="${fmt(head[1], P)}"/>` +
        `<circle class="cs-pin-ring" cx="${fmt(head[0], P)}" cy="${fmt(head[1], P)}" r="${(sz * 0.9).toFixed(1)}"/>` +
        `<circle class="cs-pin-head" cx="${fmt(head[0], P)}" cy="${fmt(head[1], P)}" r="${(sz * 0.55).toFixed(1)}"/>` +
        (o.storeLabels ? `<text class="cs-pin-label" x="${fmt(head[0], P)}" y="${fmt(head[1] - sz - 3, P)}">${escapeXml(poi.label)}</text>` : '') +
        `<title>${escapeXml(poi.label)}</title></g>`,
    );
  }
  parts.push(`</g><g data-layer="overlay"></g></svg>`);
  return {
    svg: parts.join('\n'),
    viewBox: vb,
    elementCount: {
      defs: 1,
      canvas: 1,
      water: 0,
      blocks: model.blocks.length,
      lots: buildings.length,
      'streets-casing': model.streets.length,
      streets: model.streets.length,
      labels: 0,
      pois: model.pois.length,
      overlay: 0,
    },
  };
}

/** Hash de opciones iso para claves de cache. */
export function isoOptionsKey(o: Partial<IsoOptions>): string {
  return cyrb53(JSON.stringify({ ...o, lotHeight: o.lotHeight ? 'fn' : undefined })).toString(16);
}
