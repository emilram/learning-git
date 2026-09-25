/**
 * Vista 2.5D isometrica en SVG (v3).
 *
 * Proyeccion oblicua (rotation, pitch). Entidades (edificios, arboles,
 * vehiculos) ordenadas por profundidad (pintor) con backface culling.
 * Edificios: sombra al suelo, iluminacion continua por orientacion de pared,
 * oclusion en la base, lineas de planta, ventanas (encendidas de noche en
 * temas oscuros), escaparate en tiendas, azotea con parapeto y equipos.
 * Entorno: agua con degradado, olas y orilla; parques con arboles; arboles de
 * alineacion en avenidas; pasos de cebra; trafico; niebla de profundidad;
 * cielo; brujula; nombres de calle y distrito proyectados. Todo determinista.
 */
import { polygonHull } from 'd3-polygon';
import { cyrb53 } from '../rng/ids';
import { createRng } from '../rng/prng';
import { area, bbox, centroid, ensurePositive, insetPolygon, pointInPolygon } from '../geom/polygon';
import { dist } from '../geom/vec';
import { baseStylesheet, resolveColor, themeVariables, variablesToCss } from '../../theme/css';
import type { Block, CityModel, ElementStyle, LandUse, Lot, Poi, Polygon, Street, SvgOutput, Theme, Vec2 } from '../types';
import { escapeXml, fmt } from './paths';

export type IsoDetail = 'low' | 'medium' | 'high';

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
  /** Azimut de la luz en grados en pantalla (0 = sombra hacia la derecha, 90 = hacia el espectador). */
  readonly lightAzimuth: number;
  /** Elevacion de la luz 0-1: 0 = sombras largas, 1 = cenital. */
  readonly lightElevation: number;
  /** Intensidad de sombra 0-1. */
  readonly shadows: number;
  /** Lineas de plantas en fachadas. */
  readonly floors: boolean;
  /** Arboles en parques. */
  readonly trees: boolean;
  /** Niebla de profundidad 0-1. */
  readonly fog: number;
  /** Nivel de detalle: low desactiva ventanas, arboles, trafico y cebras (util al arrastrar). */
  readonly detail: IsoDetail;
  /** Ventanas en fachadas visibles. */
  readonly windows: boolean;
  /** Ventanas encendidas: auto = en temas oscuros. */
  readonly nightLights: boolean | 'auto';
  /** Densidad de vehiculos 0-1 (0 = ninguno). */
  readonly traffic: number;
  /** Arboles de alineacion en avenidas. */
  readonly streetTrees: boolean;
  /** Pasos de cebra en cruces de avenidas. */
  readonly crosswalks: boolean;
  /** Brujula en la esquina. */
  readonly compass: boolean;
  /** Nombres de calle proyectados al suelo. */
  readonly streetLabels: boolean;
  /** Nombres de distrito en el suelo. */
  readonly districtLabels: boolean;
  /** Degradado de cielo tras el terreno. */
  readonly sky: boolean;
  /** Tienda resaltada. */
  readonly selectedId: string | null;
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
  lightAzimuth: 40,
  lightElevation: 0.5,
  shadows: 0.45,
  floors: true,
  trees: true,
  fog: 0.35,
  detail: 'high',
  windows: true,
  nightLights: 'auto',
  traffic: 0.5,
  streetTrees: true,
  crosswalks: true,
  compass: true,
  streetLabels: true,
  districtLabels: false,
  sky: true,
  selectedId: null,
};

interface Projector {
  p(x: number, y: number, z: number): Vec2;
  uv(x: number, y: number): Vec2;
  readonly kz: number;
  readonly kv: number;
}

function makeProjector(model: CityModel, o: IsoOptions): Projector {
  const cx = model.bounds.w / 2;
  const cy = model.bounds.h / 2;
  const th = (o.rotation * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const pitch = (Math.max(15, Math.min(89, o.pitch)) * Math.PI) / 180;
  const kv = Math.sin(pitch);
  const kz = Math.cos(pitch);
  return {
    kv,
    kz,
    uv(x, y) {
      const dx = x - cx;
      const dy = y - cy;
      return [dx * c - dy * s, dx * s + dy * c];
    },
    p(x, y, z) {
      const dx = x - cx;
      const dy = y - cy;
      return [cx + dx * c - dy * s, cy + (dx * s + dy * c) * kv - z * kz];
    },
  };
}

interface Oklch {
  L: number;
  C: number;
  H: number;
  A: string | null;
}

function parseOklch(color: string): Oklch | null {
  const m = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)/.exec(color);
  if (!m) return null;
  return { L: parseFloat(m[1]!), C: parseFloat(m[2]!), H: parseFloat(m[3]!), A: m[4] ?? null };
}

function fmtOklch(c: Oklch): string {
  const L = Math.max(0, Math.min(100, c.L));
  const C = Math.max(0, c.C);
  return c.A ? `oklch(${L.toFixed(1)}% ${C.toFixed(3)} ${c.H} / ${c.A})` : `oklch(${L.toFixed(1)}% ${C.toFixed(3)} ${c.H})`;
}

/** Parsea oklch(L% C H [/ A]) y devuelve una variante con L y C desplazados. */
export function shiftOklch(color: string, dL: number, dC = 0): string {
  const c = parseOklch(color);
  if (!c) return color;
  return fmtOklch({ ...c, L: c.L + dL, C: c.C + dC });
}

function fogMix(color: string, fog: string, t: number): string {
  const a = parseOklch(color);
  const b = parseOklch(fog);
  if (!a || !b || t <= 0) return color;
  return fmtOklch({ L: a.L + (b.L - a.L) * t, C: a.C + (b.C - a.C) * t, H: a.H, A: a.A });
}

function styleAttrs(o: ElementStyle | undefined): string {
  if (!o) return '';
  let s = '';
  if (o.style) s += ` style="${escapeXml(o.style)}"`;
  if (o.data) for (const [k, v] of Object.entries(o.data)) s += ` data-${k}="${escapeXml(v)}"`;
  return s;
}

const SKIP_LANDUSE: ReadonlySet<LandUse> = new Set<LandUse>(['park', 'water', 'plaza']);

interface Building {
  readonly kind: 'building';
  readonly id: string;
  readonly footprint: Polygon;
  readonly height: number;
  readonly depth: number;
  readonly baseColor: string;
  readonly poi: Poi | null;
  readonly lot: Lot;
  readonly block: Block;
  readonly landmark: boolean;
  readonly overrides: ElementStyle | undefined;
}
interface Tree {
  readonly kind: 'tree';
  readonly p: Vec2;
  readonly r: number;
  readonly depth: number;
}
interface Car {
  readonly kind: 'car';
  readonly p: Vec2;
  readonly dir: Vec2;
  readonly color: string;
  readonly depth: number;
}
type Entity = Building | Tree | Car;

/** Expande un poligono alejando cada vertice del centroide. */
function growPolygon(poly: Polygon, d: number): Vec2[] {
  const c = centroid(poly);
  return poly.map((q) => {
    const dx = q[0] - c[0];
    const dy = q[1] - c[1];
    const l = Math.hypot(dx, dy) || 1;
    return [q[0] + (dx / l) * d, q[1] + (dy / l) * d] as Vec2;
  });
}

/** Punto y tangente cada `step` unidades a lo largo de una polilinea. */
function walk(pl: readonly Vec2[], step: number, offset: number, fn: (p: Vec2, t: Vec2, acc: number) => void): void {
  let acc = 0;
  let next = offset;
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1]!;
    const b = pl[i]!;
    const L = dist(a, b);
    if (L < 1e-6) continue;
    const t: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    while (next <= acc + L) {
      const u = (next - acc) / L;
      fn([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], t, next);
      next += step;
    }
    acc += L;
  }
}

export function serializeIsoSvg(model: CityModel, theme: Theme, opts: Partial<IsoOptions> = {}): SvgOutput {
  const o0: IsoOptions = { ...DEFAULT_ISO_OPTIONS, ...opts };
  // Nivel de detalle efectivo.
  const o: IsoOptions =
    o0.detail === 'low'
      ? { ...o0, floors: false, windows: false, trees: false, streetTrees: false, traffic: 0, crosswalks: false, streetLabels: false, shadows: o0.shadows * 0.6 }
      : o0.detail === 'medium'
        ? { ...o0, windows: false, traffic: 0 }
        : o0;
  const pr = makeProjector(model, o);
  const P = o.precision;
  const prefix = o.idPrefix;
  const vars = themeVariables(theme);
  const parts: string[] = [];
  const pt = (q: Vec2): string => `${fmt(q[0], P)} ${fmt(q[1], P)}`;
  const poly3 = (poly: Polygon, z: number): string => `M${poly.map((q) => pt(pr.p(q[0], q[1], z))).join('L')}Z`;
  const line3 = (pl: readonly Vec2[]): string => `M${pl.map((q) => pt(pr.p(q[0], q[1], 0))).join('L')}`;
  const dark = theme.scheme === 'dark';
  const night = o.nightLights === 'auto' ? dark : o.nightLights;
  const surface = resolveColor(theme, 'surface');
  const ink = resolveColor(theme, 'ink');
  const accentAlt = resolveColor(theme, 'accentAlt');
  const accent = resolveColor(theme, 'accent');
  const success = resolveColor(theme, 'success');
  const shadowInk = dark ? shiftOklch(surface, -14, 0.01) : ink;
  const seedRng = (label: string) => createRng(model.seed, label);

  // Luz en pantalla llevada al mundo por rotacion inversa.
  const az = (o.lightAzimuth * Math.PI) / 180;
  const lightU: Vec2 = [Math.cos(az), Math.sin(az)];
  const rot = (o.rotation * Math.PI) / 180;
  const lightDir: Vec2 = [lightU[0] * Math.cos(rot) + lightU[1] * Math.sin(rot), -lightU[0] * Math.sin(rot) + lightU[1] * Math.cos(rot)];
  const shadowLen = (1 - o.lightElevation) * 2.2;

  // ViewBox.
  const { w, h } = model.bounds;
  const corners: Vec2[] = ([[0, 0], [w, 0], [w, h], [0, h]] as Vec2[]).map((q) => pr.p(q[0], q[1], 0));
  const cb = bbox(corners);
  const maxH = 40 * o.heightScale * o.storeBoost;
  let vb: [number, number, number, number] = [cb.x - o.padding, cb.y - o.padding - maxH, cb.w + o.padding * 2, cb.h + o.padding * 2 + maxH];
  if (o.fit === 'cover') {
    const cw = w / o.zoom;
    const ch = (h * pr.kv) / o.zoom;
    vb = [w / 2 - cw / 2, h / 2 - maxH * 0.25 - ch / 2, cw, ch];
  }
  const depthRange: [number, number] = [cb.y, cb.y + cb.h];
  const fogT = (screenY: number): number => {
    if (o.fog <= 0) return 0;
    const t = 1 - (screenY - depthRange[0]) / Math.max(1, depthRange[1] - depthRange[0]);
    return Math.max(0, Math.min(1, t)) * o.fog * 0.5;
  };
  const inView = (q: Vec2, m = 40): boolean => q[0] >= vb[0] - m && q[0] <= vb[0] + vb[2] + m && q[1] >= vb[1] - m && q[1] <= vb[1] + vb[3] + m;

  const rootAttrs = [
    `xmlns="http://www.w3.org/2000/svg"`,
    `viewBox="${vb.map((n) => fmt(n, 1)).join(' ')}"`,
    `class="${prefix}-root ${prefix}-iso"`,
    `data-seed="${escapeXml(model.seed)}"`,
    `data-view="iso"`,
    `data-rotation="${fmt(o.rotation, 1)}"`,
    `style="${escapeXml(variablesToCss(vars))}"`,
  ];
  if (o.accessible) rootAttrs.push(`role="img"`, `aria-labelledby="${prefix}-title ${prefix}-desc"`);
  parts.push(`<svg ${rootAttrs.join(' ')}>`);
  if (o.accessible) {
    parts.push(
      `<title id="${prefix}-title">${escapeXml(`Croquis 3D ${model.seed}`)}</title><desc id="${prefix}-desc">${escapeXml(`Vista isometrica con ${model.streets.length} calles, ${model.lots.length} edificios y ${model.pois.length} tiendas.`)}</desc>`,
    );
  }
  const edge = shiftOklch(ink, dark ? -40 : 30);
  if (o.embedStyles) {
    parts.push(
      `<style>${baseStylesheet(`.${prefix}-root`)}\n` +
        `.${prefix}-iso .cs-wall{stroke:${edge};stroke-width:0.3;stroke-linejoin:round;stroke-opacity:0.6}` +
        `.${prefix}-iso .cs-roof{stroke:${edge};stroke-width:0.35;stroke-linejoin:round;stroke-opacity:0.7}` +
        `.${prefix}-iso .cs-roof-top,.${prefix}-iso .cs-hvac{stroke:none}` +
        `.${prefix}-iso .cs-ao{fill:${shadowInk};opacity:${dark ? 0.35 : 0.14};stroke:none}` +
        `.${prefix}-iso .cs-floors{fill:none;stroke:${ink};stroke-width:0.35;stroke-opacity:${dark ? 0.3 : 0.12}}` +
        `.${prefix}-iso .cs-win{fill:${night ? shiftOklch(surface, 4) : shiftOklch(ink, dark ? -30 : 55)};stroke:none;opacity:${night ? 0.9 : 0.55}}` +
        `.${prefix}-iso .cs-win-lit{fill:oklch(88% 0.12 85);stroke:none}` +
        `.${prefix}-iso .cs-storefront{fill:oklch(${dark ? 78 : 62}% 0.06 230);stroke:none;opacity:0.85}` +
        `.${prefix}-iso .cs-shadows{fill:${shadowInk};opacity:${(o.shadows * (dark ? 1 : 0.6)).toFixed(2)}}` +
        `.${prefix}-iso .cs-shadow{stroke:none}` +
        `.${prefix}-iso .cs-halo{fill:${accentAlt};opacity:0.28}` +
        `.${prefix}-iso .cs-halo-selected{fill:${accent};opacity:0.4}` +
        `.${prefix}-iso .cs-pin{stroke:${ink};stroke-width:1;stroke-opacity:0.8}` +
        `.${prefix}-iso .cs-pin-head{fill:var(--cs-poi-fill);stroke:${surface};stroke-width:1.4}` +
        `.${prefix}-iso .cs-pin-ring{fill:none;stroke:var(--cs-poi-ring);stroke-width:1.6}` +
        `.${prefix}-iso .cs-pin-label{font-family:var(--cs-label-font);font-size:8.5px;font-weight:600;fill:${ink};text-anchor:middle;dominant-baseline:middle}` +
        `.${prefix}-iso .cs-pin-label-bg{fill:${surface};fill-opacity:0.92;stroke:${shiftOklch(ink, dark ? -30 : 45)};stroke-width:0.5}` +
        `.${prefix}-iso .cs-tree{stroke:${shiftOklch(success, -25)};stroke-width:0.5}` +
        `.${prefix}-iso .cs-tree-shadow{fill:${shadowInk};opacity:${dark ? 0.5 : 0.18}}` +
        `.${prefix}-iso .cs-centerline{fill:none;stroke:${shiftOklch(ink, dark ? -20 : 45)};stroke-width:0.5;stroke-dasharray:4 4;stroke-opacity:0.7}` +
        `.${prefix}-iso .cs-crosswalk{fill:none;stroke:${dark ? 'oklch(85% 0.01 260)' : 'oklch(99% 0 0)'};stroke-width:1.1;stroke-opacity:${dark ? 0.55 : 0.9}}` +
        `.${prefix}-iso .cs-shore{fill:none;stroke:oklch(${dark ? 45 : 96}% 0.03 230);stroke-width:1.2;stroke-opacity:0.8}` +
        `.${prefix}-iso .cs-car{stroke:${shadowInk};stroke-width:0.3;stroke-opacity:0.5}` +
        `.${prefix}-iso .cs-car-shadow{fill:${shadowInk};opacity:${dark ? 0.6 : 0.25};stroke:none}` +
        `.${prefix}-iso .cs-iso-label{font-family:var(--cs-label-font);font-size:8px;fill:${shiftOklch(ink, dark ? -15 : 20)};letter-spacing:0.08em;text-anchor:middle;dominant-baseline:middle;paint-order:stroke;stroke:${surface};stroke-width:2;stroke-opacity:0.8}` +
        `.${prefix}-iso .cs-district-label{font-family:var(--cs-font-display);font-size:26px;font-weight:700;fill:${ink};opacity:0.12;letter-spacing:0.2em;text-anchor:middle;text-transform:uppercase}` +
        `.${prefix}-iso .cs-compass-ring{fill:${surface};fill-opacity:0.85;stroke:${edge};stroke-width:0.8}` +
        `.${prefix}-iso .cs-compass-n{fill:${accentAlt}}.${prefix}-iso .cs-compass-s{fill:${shiftOklch(ink, dark ? -35 : 50)}}` +
        `.${prefix}-iso .cs-compass-t{font-family:var(--cs-font-body);font-size:7px;font-weight:700;fill:${ink};text-anchor:middle;dominant-baseline:middle}` +
        `.${prefix}-iso .cs-building:hover .cs-roof-top{filter:brightness(1.12)}` +
        `.${prefix}-iso .cs-building.cs-selected .cs-roof-top{filter:brightness(1.25)}` +
        `</style>`,
    );
  }

  // Defs.
  const waterFill = resolveColor(theme, theme.components.block.water.fill);
  const skyTop = shiftOklch(surface, dark ? -6 : -3, dark ? 0.02 : 0.015);
  parts.push(
    `<defs>` +
      `<linearGradient id="${prefix}-water" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shiftOklch(waterFill, dark ? 5 : 3, 0.01)}"/><stop offset="1" stop-color="${shiftOklch(waterFill, dark ? -4 : -7, 0.02)}"/></linearGradient>` +
      `<linearGradient id="${prefix}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${surface}"/></linearGradient>` +
      `<pattern id="${prefix}-waves" patternUnits="userSpaceOnUse" width="14" height="6"><path d="M0 3q3.5-2.5 7 0t7 0" fill="none" stroke="${shiftOklch(waterFill, dark ? 9 : -10)}" stroke-width="0.5" stroke-opacity="0.6"/></pattern>` +
      `<pattern id="${prefix}-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="0.6"/></pattern>` +
      `<pattern id="${prefix}-cross-hatch" patternUnits="userSpaceOnUse" width="6" height="6"><path d="M0 3H6M3 0V6" stroke="currentColor" stroke-width="0.5"/></pattern>` +
      `<pattern id="${prefix}-dots" patternUnits="userSpaceOnUse" width="5" height="5"><circle cx="2.5" cy="2.5" r="0.7" fill="currentColor"/></pattern>` +
      `<pattern id="${prefix}-grid" patternUnits="userSpaceOnUse" width="8" height="8"><path d="M8 0H0V8" fill="none" stroke="currentColor" stroke-width="0.4"/></pattern>` +
      `</defs>`,
  );
  parts.push(`<g class="cs-viewport">`);
  if (o.sky) parts.push(`<rect data-layer="sky" x="${fmt(vb[0] - 2000, 0)}" y="${fmt(vb[1] - 2000, 0)}" width="${fmt(vb[2] + 4000, 0)}" height="${fmt(vb[3] + 4000, 0)}" fill="url(#${prefix}-sky)"/>`);
  parts.push(`<g data-layer="canvas"><path class="cs-canvas" d="${poly3([[0, 0], [w, 0], [w, h], [0, h]], 0)}"/></g>`);

  // Manzanas.
  parts.push(`<g data-layer="blocks">`);
  const blockById = new Map<string, Block>();
  const waterPaths: string[] = [];
  for (const b of model.blocks) {
    blockById.set(b.id, b);
    const ov = model.meta.params.overrides.blocks?.[b.id] ?? b.overrides;
    const cls = ov?.className ? `cs-block cs-lu-${b.landUse} ${ov.className}` : `cs-block cs-lu-${b.landUse}`;
    const d = poly3(b.polygon, 0);
    const comp = theme.components.block[b.landUse];
    if (b.landUse === 'water') {
      parts.push(`<path class="${cls}" d="${d}" style="fill:url(#${prefix}-water)" data-id="${b.id}" data-landuse="water"${styleAttrs(ov)}/>`);
      parts.push(`<path d="${d}" fill="url(#${prefix}-waves)" stroke="none"/>`);
      waterPaths.push(d);
      continue;
    }
    const sy = pr.p(b.centroid[0], b.centroid[1], 0)[1];
    const fill = fogMix(resolveColor(theme, comp.fill), surface, fogT(sy));
    parts.push(`<path class="${cls}" d="${d}" style="fill:${fill}${ov?.style ? `;${ov.style}` : ''}" data-id="${b.id}" data-landuse="${b.landUse}"/>`);
    if (comp.pattern !== 'none' && b.landUse !== 'park') parts.push(`<path class="cs-pattern" d="${d}" fill="url(#${prefix}-${comp.pattern})" style="color:var(--cs-block-${b.landUse}-stroke)"/>`);
  }
  for (const d of waterPaths) parts.push(`<path class="cs-shore" d="${d}"/>`);
  parts.push(`</g>`);

  // Nombres de distrito (suelo).
  if (o.districtLabels && model.districts.length > 1) {
    parts.push(`<g data-layer="district-labels" aria-hidden="true">`);
    for (const d of model.districts) {
      const q = pr.p(d.center[0], d.center[1], 0);
      parts.push(`<text class="cs-district-label" x="${fmt(q[0], P)}" y="${fmt(q[1], P)}" transform="scale(1 ${pr.kv.toFixed(3)})" style="transform-box:fill-box;transform-origin:center">${escapeXml(d.name)}</text>`);
    }
    parts.push(`</g>`);
  }

  // Calles.
  const widthScale = (cls: Street['class']): number => theme.components.street[cls].widthScale;
  const sw = (s: Street): number => s.width * widthScale(s.class);
  parts.push(`<g data-layer="streets-casing">`);
  for (const s of model.streets) {
    if (!theme.components.street[s.class].casing) continue;
    parts.push(`<path class="cs-street cs-casing cs-${s.class}" d="${line3(s.polyline)}" stroke-width="${(sw(s) + 1.8).toFixed(2)}"/>`);
  }
  parts.push(`</g><g data-layer="streets">`);
  for (const s of model.streets) {
    const ov = model.meta.params.overrides.streets?.[s.id] ?? s.overrides;
    const cls = ov?.className ? `cs-street cs-fill cs-${s.class} ${ov.className}` : `cs-street cs-fill cs-${s.class}`;
    const dash = theme.components.street[s.class].dash;
    parts.push(`<path class="${cls}" d="${line3(s.polyline)}" stroke-width="${sw(s).toFixed(2)}"${dash ? ` stroke-dasharray="${dash}"` : ''} data-id="${s.id}"${styleAttrs(ov)}/>`);
  }
  for (const s of model.streets) if (s.class === 'avenue' && sw(s) >= 6) parts.push(`<path class="cs-centerline" d="${line3(s.polyline)}"/>`);
  // Pasos de cebra en cruces con >= 2 avenidas.
  if (o.crosswalks) {
    const streetById = new Map(model.streets.map((s) => [s.id, s]));
    let zebra = '';
    for (const n of model.nodes) {
      const inc = n.streetIds.map((id) => streetById.get(id)).filter((s): s is Street => !!s);
      const avs = inc.filter((s) => s.class === 'avenue');
      if (avs.length < 2 || inc.length < 3) continue;
      const maxW = Math.max(...inc.map(sw));
      for (const s of avs) {
        const pl = s.from === n.id ? s.polyline : s.polyline.slice().reverse();
        const a = pl[0]!;
        const b = pl[1]!;
        const L = dist(a, b);
        if (L < maxW + 8) continue;
        const t: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        const nrm: Vec2 = [-t[1], t[0]];
        const half = sw(s) * 0.42;
        const start = maxW / 2 + 2.5;
        for (let k = 0; k < 5; k++) {
          const d0 = start + k * 1.7;
          const c: Vec2 = [a[0] + t[0] * d0, a[1] + t[1] * d0];
          zebra += `M${pt(pr.p(c[0] - nrm[0] * half, c[1] - nrm[1] * half, 0))}L${pt(pr.p(c[0] + nrm[0] * half, c[1] + nrm[1] * half, 0))}`;
        }
      }
    }
    if (zebra) parts.push(`<path class="cs-crosswalk" d="${zebra}"/>`);
  }
  parts.push(`</g>`);

  // Nombres de calle proyectados (textPath sobre el suelo).
  if (o.streetLabels && model.labels.length) {
    parts.push(`<g data-layer="street-labels" aria-hidden="true">`);
    for (const l of model.labels) {
      if (l.kind !== 'street') continue;
      let path = l.path.map((q) => pr.p(q[0], q[1], 0));
      if (path[path.length - 1]![0] < path[0]![0]) path = path.reverse();
      if (!inView(path[0]!, 0) && !inView(path[path.length - 1]!, 0)) continue;
      const pid = `${prefix}-${l.id}-p3`;
      parts.push(`<path id="${pid}" fill="none" stroke="none" d="M${path.map(pt).join('L')}"/><text class="cs-iso-label" font-size="${(l.fontSize * 0.85).toFixed(1)}"><textPath href="#${pid}" startOffset="50%">${escapeXml(l.text)}</textPath></text>`);
    }
    parts.push(`</g>`);
  }

  // Entidades: edificios, arboles, coches.
  const poiByLot = new Map<string, Poi>();
  for (const poi of model.pois) if (poi.anchor.kind === 'lot') poiByLot.set(poi.anchor.lotId, poi);
  const entities: Entity[] = [];
  const buildings: Building[] = [];
  for (const lot of model.lots) {
    const block = blockById.get(lot.blockId);
    if (!block || SKIP_LANDUSE.has(block.landUse)) continue;
    const poi = poiByLot.get(lot.id) ?? null;
    if (!o.buildings && !poi) continue;
    const a = area(lot.polygon);
    if (a < 60) continue;
    const lrng = seedRng(`h:${lot.id}`);
    const jitter = lrng.range(-2, 4);
    const landmark = !poi && block.density > 0.55 && lrng.chance(0.045);
    let height = o.lotHeight
      ? o.lotHeight(lot, block, poi)
      : (6 + block.density ** 1.4 * 30 + (block.landUse === 'retail' ? 5 : 0) + jitter + Math.min(8, Math.sqrt(a) * 0.12)) * (landmark ? 1.9 : 1) * o.heightScale;
    if (poi && !o.lotHeight) height *= o.storeBoost;
    height = Math.max(1, height);
    const fp = ensurePositive(lot.polygon);
    const c = centroid(fp);
    const baseColor = poi ? accentAlt : resolveColor(theme, theme.components.block[block.landUse].fill);
    const b: Building = { kind: 'building', id: lot.id, footprint: fp, height, depth: pr.uv(c[0], c[1])[1], baseColor, poi, lot, block, landmark, overrides: poi ? (model.meta.params.overrides.pois?.[poi.id] ?? poi.overrides) : undefined };
    buildings.push(b);
    entities.push(b);
  }
  const trees: Tree[] = [];
  const addTree = (p: Vec2, r: number): void => {
    if (trees.some((t) => Math.hypot(t.p[0] - p[0], t.p[1] - p[1]) < 8)) return;
    trees.push({ kind: 'tree', p, r, depth: pr.uv(p[0], p[1])[1] });
  };
  if (o.trees) {
    for (const b of model.blocks) {
      if (b.landUse !== 'park') continue;
      const trng = seedRng(`trees:${b.id}`);
      const bb = bbox(b.polygon);
      const n = Math.min(24, Math.max(3, Math.round(b.area / 900)));
      let placed = 0;
      for (let tries = 0; placed < n && tries < n * 8; tries++) {
        const p: Vec2 = [bb.x + trng.next() * bb.w, bb.y + trng.next() * bb.h];
        if (!pointInPolygon(p, b.polygon)) continue;
        addTree(p, trng.range(3, 5.5));
        placed++;
      }
    }
  }
  if (o.streetTrees) {
    const trng = seedRng('street-trees');
    for (const s of model.streets) {
      if (s.class !== 'avenue' || s.length < 60) continue;
      const off = sw(s) / 2 + 3.2;
      walk(s.polyline, 26, 18 + trng.range(0, 8), (p, t, acc) => {
        if (acc > s.length - 14) return;
        for (const side of [-1, 1]) {
          const q: Vec2 = [p[0] - t[1] * off * side, p[1] + t[0] * off * side];
          if (q[0] < 2 || q[1] < 2 || q[0] > w - 2 || q[1] > h - 2) continue;
          if (model.water.some((wp) => pointInPolygon(q, wp))) continue;
          addTree(q, 2.6 + trng.range(0, 0.8));
        }
      });
    }
  }
  entities.push(...trees);
  if (o.traffic > 0) {
    const crng = seedRng('traffic');
    const palette = dark ? ['oklch(80% 0.01 260)', 'oklch(35% 0.01 260)', 'oklch(60% 0.2 25)', 'oklch(55% 0.15 250)', 'oklch(70% 0.02 260)'] : ['oklch(97% 0 0)', 'oklch(30% 0.01 260)', 'oklch(58% 0.2 25)', 'oklch(50% 0.16 250)', 'oklch(75% 0.02 260)', 'oklch(45% 0.12 150)'];
    let count = 0;
    const max = 140;
    for (const s of model.streets) {
      if (s.class === 'alley' || count >= max) continue;
      const n = Math.round((s.length / 110) * o.traffic * (s.class === 'avenue' ? 1.6 : 0.8));
      for (let k = 0; k < n && count < max; k++) {
        const at = crng.range(8, Math.max(9, s.length - 8));
        let placed = false;
        walk(s.polyline, 1e9, at, (p, t) => {
          if (placed) return;
          placed = true;
          const lane = sw(s) * 0.24;
          const side = crng.chance(0.5) ? 1 : -1;
          const q: Vec2 = [p[0] - t[1] * lane * side, p[1] + t[0] * lane * side];
          entities.push({ kind: 'car', p: q, dir: side > 0 ? t : [-t[0], -t[1]], color: crng.pick(palette), depth: pr.uv(q[0], q[1])[1] });
          count++;
        });
      }
    }
  }
  entities.sort((p, q) => p.depth - q.depth);

  // Sombras al suelo (edificios + arboles), todas antes de las entidades.
  if (o.shadows > 0 && shadowLen > 0.05) {
    parts.push(`<g class="cs-shadows" data-layer="shadows">`);
    for (const b of buildings) {
      const dx = lightDir[0] * b.height * shadowLen;
      const dy = lightDir[1] * b.height * shadowLen;
      const pts: [number, number][] = [];
      for (const q of b.footprint) pts.push([q[0], q[1]], [q[0] + dx, q[1] + dy]);
      const hull = polygonHull(pts);
      if (hull) parts.push(`<path class="cs-shadow" d="${poly3(hull.map((q) => [q[0], q[1]] as Vec2), 0)}"/>`);
    }
    parts.push(`</g>`);
  }

  // Halos bajo tiendas.
  parts.push(`<g data-layer="halos">`);
  for (const b of buildings) {
    if (!b.poi) continue;
    const sel = b.poi.id === o.selectedId;
    parts.push(`<path class="${sel ? 'cs-halo cs-halo-selected' : 'cs-halo'}" d="${poly3(growPolygon(b.footprint, sel ? 11 : 6), 0)}"/>`);
  }
  parts.push(`</g>`);

  // Entidades en orden de profundidad.
  const floorH = 5.5;
  parts.push(`<g data-layer="buildings">`);
  for (const e of entities) {
    if (e.kind === 'tree') {
      const t = e;
      const base = pr.p(t.p[0], t.p[1], 0);
      const top = pr.p(t.p[0], t.p[1], t.r * 1.6);
      const sh = pr.p(t.p[0] + lightDir[0] * t.r * shadowLen * 1.2, t.p[1] + lightDir[1] * t.r * shadowLen * 1.2, 0);
      parts.push(
        `<g class="cs-tree-g"><ellipse class="cs-tree-shadow" cx="${fmt(sh[0], P)}" cy="${fmt(sh[1], P)}" rx="${(t.r * 0.9).toFixed(1)}" ry="${(t.r * 0.45).toFixed(1)}"/>` +
          `<line x1="${fmt(base[0], P)}" y1="${fmt(base[1], P)}" x2="${fmt(top[0], P)}" y2="${fmt(top[1], P)}" stroke="${shiftOklch(success, -35, -0.05)}" stroke-width="0.8"/>` +
          `<circle class="cs-tree" cx="${fmt(top[0], P)}" cy="${fmt(top[1], P)}" r="${t.r.toFixed(1)}" fill="${shiftOklch(success, dark ? 6 : -8, 0.03)}"/>` +
          `<circle cx="${fmt(top[0] - t.r * 0.3, P)}" cy="${fmt(top[1] - t.r * 0.3, P)}" r="${(t.r * 0.45).toFixed(1)}" fill="${shiftOklch(success, dark ? 14 : 4, 0.02)}"/></g>`,
      );
      continue;
    }
    if (e.kind === 'car') {
      const c = e;
      const L = 4.6;
      const W = 2.2;
      const t = c.dir;
      const nrm: Vec2 = [-t[1], t[0]];
      const corner = (du: number, dv: number, z: number): Vec2 => pr.p(c.p[0] + t[0] * du + nrm[0] * dv, c.p[1] + t[1] * du + nrm[1] * dv, z);
      const body = [corner(-L / 2, -W / 2, 1.6), corner(L / 2, -W / 2, 1.6), corner(L / 2, W / 2, 1.6), corner(-L / 2, W / 2, 1.6)];
      const roof = [corner(-L * 0.22, -W * 0.42, 2.6), corner(L * 0.18, -W * 0.42, 2.6), corner(L * 0.18, W * 0.42, 2.6), corner(-L * 0.22, W * 0.42, 2.6)];
      const shadow = [corner(-L / 2 + 0.6, -W / 2 + 0.4, 0), corner(L / 2 + 0.6, -W / 2 + 0.4, 0), corner(L / 2 + 0.6, W / 2 + 0.4, 0), corner(-L / 2 + 0.6, W / 2 + 0.4, 0)];
      const ring = (q: Vec2[]): string => `M${q.map(pt).join('L')}Z`;
      parts.push(
        `<g class="cs-car-g"><path class="cs-car-shadow" d="${ring(shadow)}"/>` +
          `<path class="cs-car" d="${ring(body)}" fill="${c.color}"/>` +
          `<path class="cs-car" d="${ring(roof)}" fill="${shiftOklch(c.color, dark ? 8 : -10)}"/></g>`,
      );
      continue;
    }
    const b = e;
    const fp = b.footprint;
    const n = fp.length;
    const selected = b.poi !== null && b.poi.id === o.selectedId;
    const cls = `cs-building${b.poi ? ' cs-store' : ''}${b.landmark ? ' cs-landmark' : ''}${selected ? ' cs-selected' : ''}`;
    const c0 = centroid(fp);
    const fog = fogT(pr.p(c0[0], c0[1], 0)[1]);
    const base = fogMix(b.baseColor, surface, fog);
    parts.push(`<g class="${cls}" data-id="${b.id}" data-block="${b.block.id}"${b.poi ? ` data-poi="${b.poi.id}"` : ''}${b.poi ? styleAttrs(b.overrides) : ''}>`);
    let floorsPath = '';
    let aoPath = '';
    let winPath = '';
    let litPath = '';
    let storePath = '';
    const wrng = seedRng(`win:${b.id}`);
    for (let i = 0; i < n; i++) {
      const a = fp[i]!;
      const c = fp[(i + 1) % n]!;
      const ua = pr.uv(a[0], a[1]);
      const uc = pr.uv(c[0], c[1]);
      const du = uc[0] - ua[0];
      const dv = uc[1] - ua[1];
      const len2 = Math.hypot(du, dv) || 1;
      const nu = dv / len2;
      const nv = -du / len2;
      if (nv <= 0) continue; // backface
      const lu = -lightU[0];
      const lv = -lightU[1];
      const cosL = (nu * lu + nv * lv) / (Math.hypot(lu, lv) || 1);
      const dL = (dark ? 3 : -5) + cosL * (dark ? 11 : 14) - (b.poi ? 0 : 2);
      const fill = shiftOklch(base, dL, cosL < 0 ? -0.015 : 0.005);
      const wallLen = dist(a, c);
      const dir: Vec2 = [(c[0] - a[0]) / wallLen, (c[1] - a[1]) / wallLen];
      const at = (d: number, z: number): Vec2 => pr.p(a[0] + dir[0] * d, a[1] + dir[1] * d, z);
      parts.push(`<path class="cs-wall" d="M${pt(at(0, 0))}L${pt(at(wallLen, 0))}L${pt(at(wallLen, b.height))}L${pt(at(0, b.height))}Z" fill="${fill}"/>`);
      const aoH = Math.min(2.2, b.height * 0.2);
      aoPath += `M${pt(at(0, 0))}L${pt(at(wallLen, 0))}L${pt(at(wallLen, aoH))}L${pt(at(0, aoH))}Z`;
      if (o.floors && b.height >= floorH * 2 && wallLen >= 6) {
        for (let z = floorH; z < b.height - 1.5; z += floorH) floorsPath += `M${pt(at(0, z))}L${pt(at(wallLen, z))}`;
      }
      // Escaparate en planta baja de tiendas.
      if (b.poi && wallLen >= 5 && b.height >= floorH) {
        storePath += `M${pt(at(0.8, 0.6))}L${pt(at(wallLen - 0.8, 0.6))}L${pt(at(wallLen - 0.8, floorH - 1.2))}L${pt(at(0.8, floorH - 1.2))}Z`;
      }
      // Ventanas: columnas cada ~5.4 unidades, una fila por planta, solo en fachadas cercanas.
      // Subpaths relativos: los vectores (ancho, alto) son iguales para todas las ventanas de la pared.
      if (o.windows && wallLen >= 8 && b.height >= floorH * 1.7 && (fog < 0.09 || b.poi || b.landmark)) {
        const cols = Math.floor((wallLen - 2) / 5.4);
        const gap = (wallLen - cols * 2.2) / (cols + 1);
        const z0 = b.poi ? floorH : 0;
        const e0 = at(0, 0);
        const e1 = at(2.2, 0);
        const wa = fmt(e1[0] - e0[0], P);
        const wb = fmt(e1[1] - e0[1], P);
        const wc = fmt(-pr.kz * 2.3, P);
        const rel = `l${wa} ${wb} 0 ${wc} ${fmt(-(e1[0] - e0[0]), P)} ${fmt(-(e1[1] - e0[1]), P)}z`;
        for (let z = z0; z + floorH <= b.height + 0.5; z += floorH) {
          for (let k = 0; k < cols; k++) {
            const q = `M${pt(at(gap + k * (2.2 + gap), z + 1.6))}${rel}`;
            if (night && wrng.chance(0.55)) litPath += q;
            else winPath += q;
          }
        }
      }
    }
    if (aoPath) parts.push(`<path class="cs-ao" d="${aoPath}"/>`);
    if (floorsPath) parts.push(`<path class="cs-floors" d="${floorsPath}"/>`);
    if (winPath) parts.push(`<path class="cs-win" d="${winPath}"/>`);
    if (litPath) parts.push(`<path class="cs-win-lit" d="${litPath}"/>`);
    if (storePath) parts.push(`<path class="cs-storefront" d="${storePath}"/>`);
    const roofL = dark ? 12 : 6;
    parts.push(`<path class="cs-roof" d="${poly3(fp, b.height)}" fill="${shiftOklch(base, roofL - 3, b.poi ? 0.01 : -0.01)}"/>`);
    const fpArea = area(fp);
    if (fpArea > 140) {
      const inner = insetPolygon(fp, fp.map(() => 1.6));
      if (inner) {
        parts.push(`<path class="cs-roof-top" d="${poly3(inner, b.height)}" fill="${shiftOklch(base, roofL + (b.poi ? 4 : 2), b.poi ? 0.02 : -0.005)}"/>`);
        // Equipos de azotea en edificios grandes (detalle alto).
        if (o.detail === 'high' && fpArea > 320 && !b.poi && wrng.chance(0.6)) {
          const rc = centroid(inner);
          const s = 2.2;
          const zz = b.height;
          const hz = zz + 2.2;
          const box: Vec2[] = [[rc[0] - s, rc[1] - s], [rc[0] + s, rc[1] - s], [rc[0] + s, rc[1] + s], [rc[0] - s, rc[1] + s]];
          if (box.every((q) => pointInPolygon(q, inner))) {
            for (let i = 0; i < 4; i++) {
              const a = box[i]!;
              const c = box[(i + 1) % 4]!;
              const ua = pr.uv(a[0], a[1]);
              const uc = pr.uv(c[0], c[1]);
              if (-(uc[0] - ua[0]) <= 0) continue;
              parts.push(`<path class="cs-hvac" d="M${pt(pr.p(a[0], a[1], zz))}L${pt(pr.p(c[0], c[1], zz))}L${pt(pr.p(c[0], c[1], hz))}L${pt(pr.p(a[0], a[1], hz))}Z" fill="${shiftOklch(base, -8)}"/>`);
            }
            parts.push(`<path class="cs-hvac" d="${poly3(box, hz)}" fill="${shiftOklch(base, 2)}"/>`);
          }
        }
      }
    }
    parts.push(`</g>`);
  }
  parts.push(`</g>`);

  // Pins.
  const pinSize = theme.components.poi.size;
  parts.push(`<g data-layer="pois">`);
  const pinned = [...model.pois]
    .map((poi) => {
      const b = poi.anchor.kind === 'lot' ? buildings.find((x) => x.id === (poi.anchor as { lotId: string }).lotId) : undefined;
      const basePt: Vec2 = b ? centroid(b.footprint) : [poi.x, poi.y];
      return { poi, base: basePt, z: b ? b.height : 0, depth: pr.uv(basePt[0], basePt[1])[1] };
    })
    .sort((p, q) => p.depth - q.depth);
  for (const { poi, base, z } of pinned) {
    const ov = model.meta.params.overrides.pois?.[poi.id] ?? poi.overrides;
    const foot = pr.p(base[0], base[1], z);
    const stem = 8 + pinSize;
    const head: Vec2 = [foot[0], foot[1] - stem];
    const sz = (poi.kind === 'flagship' ? 1.3 : poi.kind === 'kiosk' ? 0.75 : 1) * pinSize;
    const sel = poi.id === o.selectedId;
    const cls = `cs-poi-marker cs-kind-${poi.kind}${ov?.className ? ` ${ov.className}` : ''}${sel ? ' cs-selected' : ''}`;
    const labelW = poi.label.length * 4.9 + 8;
    const labelY = head[1] - sz - 4;
    parts.push(
      `<g class="${cls}" data-id="${poi.id}" data-kind="${poi.kind}" data-label="${escapeXml(poi.label)}"${styleAttrs(ov)}>` +
        `<line class="cs-pin" x1="${fmt(foot[0], P)}" y1="${fmt(foot[1], P)}" x2="${fmt(head[0], P)}" y2="${fmt(head[1], P)}"/>` +
        `<circle class="cs-pin-ring" cx="${fmt(head[0], P)}" cy="${fmt(head[1], P)}" r="${(sz * (sel ? 1.25 : 0.9)).toFixed(1)}"/>` +
        `<circle class="cs-pin-head" cx="${fmt(head[0], P)}" cy="${fmt(head[1], P)}" r="${(sz * 0.55).toFixed(1)}"/>` +
        (o.storeLabels
          ? `<rect class="cs-pin-label-bg" x="${fmt(head[0] - labelW / 2, P)}" y="${fmt(labelY - 6.5, P)}" width="${labelW.toFixed(1)}" height="12" rx="6"/><text class="cs-pin-label" x="${fmt(head[0], P)}" y="${fmt(labelY, P)}">${escapeXml(poi.label)}</text>`
          : '') +
        `<title>${escapeXml(poi.label)}</title></g>`,
    );
  }
  parts.push(`</g><g data-layer="overlay"></g></g>`);

  // Brujula (fuera del viewport para que no la afecte el zoom).
  if (o.compass) {
    const cxs = vb[0] + vb[2] - 24;
    const cys = vb[1] + 24;
    const a0 = pr.p(w / 2, h / 2, 0);
    const a1 = pr.p(w / 2, h / 2 - 1, 0);
    const ang = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
    const deg = (ang * 180) / Math.PI + 90;
    parts.push(
      `<g data-layer="compass" aria-hidden="true" transform="translate(${fmt(cxs, 1)} ${fmt(cys, 1)})"><circle class="cs-compass-ring" r="13"/>` +
        `<g transform="rotate(${deg.toFixed(1)})"><path class="cs-compass-n" d="M0 -10L3.2 0L0 -2.5L-3.2 0Z"/><path class="cs-compass-s" d="M0 10L3.2 0L0 2.5L-3.2 0Z"/></g>` +
        `<text class="cs-compass-t" y="-16" transform="rotate(${deg.toFixed(1)}) translate(0 -1) rotate(${(-deg).toFixed(1)})">N</text></g>`,
    );
  }
  parts.push(`</svg>`);
  return {
    svg: parts.join('\n'),
    viewBox: vb,
    elementCount: {
      defs: 1,
      canvas: 1,
      water: waterPaths.length,
      blocks: model.blocks.length,
      lots: buildings.length,
      'streets-casing': model.streets.length,
      streets: model.streets.length,
      labels: o.streetLabels ? model.labels.length : 0,
      pois: model.pois.length,
      overlay: entities.length - buildings.length,
    },
  };
}

/** Hash de opciones iso para claves de cache. */
export function isoOptionsKey(o: Partial<IsoOptions>): string {
  return cyrb53(JSON.stringify({ ...o, lotHeight: o.lotHeight ? 'fn' : undefined })).toString(16);
}
