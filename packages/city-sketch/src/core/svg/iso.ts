/**
 * Vista 2.5D isometrica en SVG.
 *
 * Proyeccion oblicua (rotation, pitch) del modelo; los lotes se extruyen como
 * edificios con: sombra proyectada al suelo (union con la huella desplazada
 * por la luz), iluminacion continua por orientacion de cada pared, lineas de
 * plantas, cornisa en la azotea, niebla de profundidad; algoritmo del pintor
 * y backface culling. Tiendas: edificio en acento, halo en el suelo, pin y
 * etiqueta con fondo. Parques con arboles, agua con degradado, avenidas con
 * linea central. Todo determinista.
 */
import { polygonHull } from 'd3-polygon';
import { cyrb53 } from '../rng/ids';
import { createRng } from '../rng/prng';
import { area, centroid, ensurePositive, insetPolygon, pointInPolygon, bbox } from '../geom/polygon';
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
      const u = dx * c - dy * s;
      const v = dx * s + dy * c;
      return [cx + u, cy + v * kv - z * kz];
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

/** Mezcla hacia un color de niebla (superficie) segun t 0-1. */
function fogMix(color: string, fog: string, t: number): string {
  const a = parseOklch(color);
  const b = parseOklch(fog);
  if (!a || !b || t <= 0) return color;
  return fmtOklch({ L: a.L + (b.L - a.L) * t, C: a.C + (b.C - a.C) * t, H: a.H, A: a.A });
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

const SKIP_LANDUSE: ReadonlySet<LandUse> = new Set<LandUse>(['park', 'water', 'plaza']);

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
  const dark = theme.scheme === 'dark';
  const surface = resolveColor(theme, 'surface');
  const ink = resolveColor(theme, 'ink');
  const accentAlt = resolveColor(theme, 'accentAlt');
  // Color de sombra: siempre mas oscuro que el suelo (en temas oscuros la tinta es clara).
  const shadowInk = dark ? shiftOklch(surface, -14, 0.01) : ink;

  // Luz definida en pantalla (u, v) y llevada al mundo con la rotacion inversa,
  // para que las sombras caigan siempre hacia el espectador con cualquier rotacion.
  const az = (o.lightAzimuth * Math.PI) / 180;
  const lightU: Vec2 = [Math.cos(az), Math.sin(az)]; // direccion de la sombra en (u, v)
  const rot = (o.rotation * Math.PI) / 180;
  const lightDir: Vec2 = [lightU[0] * Math.cos(rot) + lightU[1] * Math.sin(rot), -lightU[0] * Math.sin(rot) + lightU[1] * Math.cos(rot)];
  const shadowLen = (1 - o.lightElevation) * 2.2; // longitud de sombra por unidad de altura

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
  const depthRange: [number, number] = [Infinity, -Infinity];
  for (const c of corners) {
    const v = c[1];
    if (v < depthRange[0]) depthRange[0] = v;
    if (v > depthRange[1]) depthRange[1] = v;
  }
  const fogT = (screenY: number): number => {
    if (o.fog <= 0) return 0;
    const t = 1 - (screenY - depthRange[0]) / Math.max(1, depthRange[1] - depthRange[0]);
    return Math.max(0, Math.min(1, t)) * o.fog * 0.5;
  };

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
      `<style>${baseStylesheet(`.${prefix}-root`)}\n` +
        `.${prefix}-iso .cs-wall{stroke:${shiftOklch(ink, dark ? -40 : 30)};stroke-width:0.3;stroke-linejoin:round;stroke-opacity:0.6}` +
        `.${prefix}-iso .cs-roof{stroke:${shiftOklch(ink, dark ? -40 : 30)};stroke-width:0.35;stroke-linejoin:round;stroke-opacity:0.7}` +
        `.${prefix}-iso .cs-roof-top{stroke:none}` +
        `.${prefix}-iso .cs-floors{fill:none;stroke:${ink};stroke-width:0.35;stroke-opacity:${dark ? 0.35 : 0.14}}` +
        `.${prefix}-iso .cs-shadows{fill:${shadowInk};opacity:${(o.shadows * (dark ? 1 : 0.6)).toFixed(2)}}` +
        `.${prefix}-iso .cs-shadow{stroke:none}` +
        `.${prefix}-iso .cs-halo{fill:${accentAlt};opacity:0.28}` +
        `.${prefix}-iso .cs-pin{stroke:${ink};stroke-width:1;stroke-opacity:0.8}` +
        `.${prefix}-iso .cs-pin-head{fill:var(--cs-poi-fill);stroke:${surface};stroke-width:1.4}` +
        `.${prefix}-iso .cs-pin-ring{fill:none;stroke:var(--cs-poi-ring);stroke-width:1.6}` +
        `.${prefix}-iso .cs-pin-label{font-family:var(--cs-label-font);font-size:8.5px;font-weight:600;fill:${ink};text-anchor:middle;dominant-baseline:middle}` +
        `.${prefix}-iso .cs-pin-label-bg{fill:${surface};fill-opacity:0.92;stroke:${shiftOklch(ink, dark ? -30 : 45)};stroke-width:0.5}` +
        `.${prefix}-iso .cs-tree{stroke:${shiftOklch(resolveColor(theme, 'success'), -25)};stroke-width:0.5}` +
        `.${prefix}-iso .cs-tree-shadow{fill:${shadowInk};opacity:${dark ? 0.5 : 0.18}}` +
        `.${prefix}-iso .cs-centerline{fill:none;stroke:${shiftOklch(ink, dark ? -20 : 45)};stroke-width:0.5;stroke-dasharray:4 4;stroke-opacity:0.7}` +
        `.${prefix}-iso .cs-building:hover .cs-roof-top{filter:brightness(1.12)}` +
        `.${prefix}-iso .cs-curb{fill:none;stroke:${shiftOklch(ink, dark ? -30 : 50)};stroke-opacity:0.5}` +
        `</style>`,
    );
  }
  // Defs: degradado de agua y de cielo.
  const waterFill = resolveColor(theme, theme.components.block.water.fill);
  parts.push(
    `<defs>` +
      `<linearGradient id="${prefix}-water" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shiftOklch(waterFill, dark ? 4 : 3, 0.01)}"/><stop offset="1" stop-color="${shiftOklch(waterFill, dark ? -3 : -6, 0.02)}"/></linearGradient>` +
      `<pattern id="${prefix}-waves" patternUnits="userSpaceOnUse" width="14" height="6"><path d="M0 3q3.5-2.5 7 0t7 0" fill="none" stroke="${shiftOklch(waterFill, dark ? 8 : -10)}" stroke-width="0.5" stroke-opacity="0.6"/></pattern>` +
      `<pattern id="${prefix}-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="0.6"/></pattern>` +
      `<pattern id="${prefix}-cross-hatch" patternUnits="userSpaceOnUse" width="6" height="6"><path d="M0 3H6M3 0V6" stroke="currentColor" stroke-width="0.5"/></pattern>` +
      `<pattern id="${prefix}-dots" patternUnits="userSpaceOnUse" width="5" height="5"><circle cx="2.5" cy="2.5" r="0.7" fill="currentColor"/></pattern>` +
      `<pattern id="${prefix}-grid" patternUnits="userSpaceOnUse" width="8" height="8"><path d="M8 0H0V8" fill="none" stroke="currentColor" stroke-width="0.4"/></pattern>` +
      `</defs>`,
  );
  parts.push(`<g class="cs-viewport">`);
  // Suelo.
  parts.push(`<g data-layer="canvas"><path class="cs-canvas" d="${poly3([[0, 0], [w, 0], [w, h], [0, h]], 0)}"/></g>`);

  // Manzanas (suelo) con niebla.
  parts.push(`<g data-layer="blocks">`);
  const blockById = new Map<string, Block>();
  for (const b of model.blocks) {
    blockById.set(b.id, b);
    const ov = model.meta.params.overrides.blocks?.[b.id] ?? b.overrides;
    const cls = ov?.className ? `cs-block cs-lu-${b.landUse} ${ov.className}` : `cs-block cs-lu-${b.landUse}`;
    const d = poly3(b.polygon, 0);
    const sy = pr.p(b.centroid[0], b.centroid[1], 0)[1];
    const comp = theme.components.block[b.landUse];
    if (b.landUse === 'water') {
      parts.push(`<path class="${cls}" d="${d}" fill="url(#${prefix}-water)" style="fill:url(#${prefix}-water)" data-id="${b.id}" data-landuse="water"${styleAttrs(ov)}/>`);
      parts.push(`<path d="${d}" fill="url(#${prefix}-waves)" stroke="none"/>`);
      continue;
    }
    const fill = fogMix(resolveColor(theme, comp.fill), surface, fogT(sy));
    parts.push(`<path class="${cls}" d="${d}" style="fill:${fill}${ov?.style ? `;${ov.style}` : ''}" data-id="${b.id}" data-landuse="${b.landUse}"${ov?.data ? styleAttrs({ data: ov.data }) : ''}/>`);
    if (comp.pattern !== 'none' && b.landUse !== 'park') parts.push(`<path class="cs-pattern" d="${d}" fill="url(#${prefix}-${comp.pattern})" style="color:var(--cs-block-${b.landUse}-stroke)"/>`);
  }
  parts.push(`</g>`);

  // Calles: casing, relleno, bordillo sutil y linea central en avenidas.
  const widthScale = (cls: 'avenue' | 'street' | 'alley'): number => theme.components.street[cls].widthScale;
  parts.push(`<g data-layer="streets-casing">`);
  for (const s of model.streets) {
    if (!theme.components.street[s.class].casing) continue;
    parts.push(`<path class="cs-street cs-casing cs-${s.class}" d="${line3(s.polyline)}" stroke-width="${(s.width * widthScale(s.class) + 1.8).toFixed(2)}"/>`);
  }
  parts.push(`</g><g data-layer="streets">`);
  for (const s of model.streets) {
    const ov = model.meta.params.overrides.streets?.[s.id] ?? s.overrides;
    const cls = ov?.className ? `cs-street cs-fill cs-${s.class} ${ov.className}` : `cs-street cs-fill cs-${s.class}`;
    const dash = theme.components.street[s.class].dash;
    parts.push(`<path class="${cls}" d="${line3(s.polyline)}" stroke-width="${(s.width * widthScale(s.class)).toFixed(2)}"${dash ? ` stroke-dasharray="${dash}"` : ''} data-id="${s.id}"${styleAttrs(ov)}/>`);
  }
  for (const s of model.streets) {
    if (s.class !== 'avenue' || s.width * widthScale('avenue') < 6) continue;
    parts.push(`<path class="cs-centerline" d="${line3(s.polyline)}"/>`);
  }
  parts.push(`</g>`);

  // Edificios.
  const poiByLot = new Map<string, Poi>();
  for (const poi of model.pois) if (poi.anchor.kind === 'lot') poiByLot.set(poi.anchor.lotId, poi);
  const buildings: Building[] = [];
  for (const lot of model.lots) {
    const block = blockById.get(lot.blockId);
    if (!block || SKIP_LANDUSE.has(block.landUse)) continue;
    const poi = poiByLot.get(lot.id) ?? null;
    if (!o.buildings && !poi) continue;
    const a = area(lot.polygon);
    if (a < 60) continue;
    const lrng = createRng(model.seed, `h:${lot.id}`);
    const jitter = lrng.range(-2, 4);
    // Hitos: ~4 % de lotes centrales son torres.
    const landmark = !poi && block.density > 0.55 && lrng.chance(0.045) ? 1.9 : 1;
    let height = o.lotHeight
      ? o.lotHeight(lot, block, poi)
      : (6 + block.density ** 1.4 * 30 + (block.landUse === 'retail' ? 5 : 0) + jitter + Math.min(8, Math.sqrt(a) * 0.12)) * landmark * o.heightScale;
    if (poi && !o.lotHeight) height *= o.storeBoost;
    height = Math.max(1, height);
    const fp = ensurePositive(lot.polygon);
    const c = centroid(fp);
    const [, v] = pr.uv(c[0], c[1]);
    const baseColor = poi ? accentAlt : resolveColor(theme, theme.components.block[block.landUse].fill);
    buildings.push({ id: lot.id, footprint: fp, height, depth: v, baseColor, poi, lot, overrides: poi ? (model.meta.params.overrides.pois?.[poi.id] ?? poi.overrides) : undefined });
  }
  buildings.sort((p, q) => p.depth - q.depth || (p.id < q.id ? -1 : 1));

  // Sombras al suelo: envolvente de la huella y la huella desplazada por la luz.
  if (o.shadows > 0 && shadowLen > 0.05) {
    parts.push(`<g class="cs-shadows" data-layer="shadows">`);
    for (const b of buildings) {
      const dx = lightDir[0] * b.height * shadowLen;
      const dy = lightDir[1] * b.height * shadowLen;
      const pts: [number, number][] = [];
      for (const q of b.footprint) {
        pts.push([q[0], q[1]], [q[0] + dx, q[1] + dy]);
      }
      const hull = polygonHull(pts);
      if (!hull) continue;
      parts.push(`<path class="cs-shadow" d="${poly3(hull.map((q) => [q[0], q[1]] as Vec2), 0)}"/>`);
    }
    parts.push(`</g>`);
  }

  // Halo bajo cada tienda (antes de los edificios para que quede en el suelo).
  parts.push(`<g data-layer="halos">`);
  for (const b of buildings) {
    if (!b.poi) continue;
    const grown = growPolygon(b.footprint, 6);
    parts.push(`<path class="cs-halo" d="${poly3(grown, 0)}"/>`);
  }
  parts.push(`</g>`);

  // Arboles en parques.
  if (o.trees) {
    parts.push(`<g data-layer="trees">`);
    const treeFill = resolveColor(theme, 'success');
    const trees: { p: Vec2; r: number; depth: number }[] = [];
    for (const b of model.blocks) {
      if (b.landUse !== 'park') continue;
      const trng = createRng(model.seed, `trees:${b.id}`);
      const bb = bbox(b.polygon);
      const n = Math.min(24, Math.max(3, Math.round(b.area / 900)));
      let tries = 0;
      let placed = 0;
      while (placed < n && tries++ < n * 8) {
        const p: Vec2 = [bb.x + trng.next() * bb.w, bb.y + trng.next() * bb.h];
        if (!pointInPolygon(p, b.polygon)) continue;
        if (trees.some((t) => Math.hypot(t.p[0] - p[0], t.p[1] - p[1]) < 9)) continue;
        trees.push({ p, r: trng.range(3, 5.5), depth: pr.uv(p[0], p[1])[1] });
        placed++;
      }
    }
    trees.sort((a, b) => a.depth - b.depth);
    for (const t of trees) {
      const base = pr.p(t.p[0], t.p[1], 0);
      const top = pr.p(t.p[0], t.p[1], t.r * 1.6);
      const sh = pr.p(t.p[0] + lightDir[0] * t.r * shadowLen * 1.2, t.p[1] + lightDir[1] * t.r * shadowLen * 1.2, 0);
      parts.push(
        `<ellipse class="cs-tree-shadow" cx="${fmt(sh[0], P)}" cy="${fmt(sh[1], P)}" rx="${(t.r * 0.9).toFixed(1)}" ry="${(t.r * 0.45).toFixed(1)}"/>` +
          `<line x1="${fmt(base[0], P)}" y1="${fmt(base[1], P)}" x2="${fmt(top[0], P)}" y2="${fmt(top[1], P)}" stroke="${shiftOklch(treeFill, -35, -0.05)}" stroke-width="0.8"/>` +
          `<circle class="cs-tree" cx="${fmt(top[0], P)}" cy="${fmt(top[1], P)}" r="${t.r.toFixed(1)}" fill="${shiftOklch(treeFill, dark ? 6 : -8, 0.03)}"/>` +
          `<circle cx="${fmt(top[0] - t.r * 0.3, P)}" cy="${fmt(top[1] - t.r * 0.3, P)}" r="${(t.r * 0.45).toFixed(1)}" fill="${shiftOklch(treeFill, dark ? 14 : 4, 0.02)}"/>`,
      );
    }
    parts.push(`</g>`);
  }

  // Edificios: paredes con iluminacion continua, lineas de plantas, azotea con cornisa.
  const floorH = 5.5;
  parts.push(`<g data-layer="buildings">`);
  for (const b of buildings) {
    const fp = b.footprint;
    const n = fp.length;
    const cls = b.poi ? 'cs-building cs-store' : 'cs-building';
    const attrs = ` data-id="${b.id}"${b.poi ? ` data-poi="${b.poi.id}"` : ''}`;
    const screenY = pr.p(centroid(fp)[0], centroid(fp)[1], 0)[1];
    const fog = fogT(screenY);
    const base = fogMix(b.baseColor, surface, fog);
    parts.push(`<g class="${cls}"${attrs}${b.poi ? styleAttrs(b.overrides) : ''}>`);
    let floorsPath = '';
    for (let i = 0; i < n; i++) {
      const a = fp[i]!;
      const c = fp[(i + 1) % n]!;
      const ua = pr.uv(a[0], a[1]);
      const uc = pr.uv(c[0], c[1]);
      const du = uc[0] - ua[0];
      const dv = uc[1] - ua[1];
      const len = Math.hypot(du, dv) || 1;
      // Area positiva = horaria en pantalla: exterior = (dv, -du).
      const nu = dv / len;
      const nv = -du / len;
      if (nv <= 0) continue; // backface
      // Iluminacion: coseno entre normal exterior y direccion a la luz (desde donde viene).
      const lu = -lightU[0];
      const lv = -lightU[1];
      const ll = Math.hypot(lu, lv) || 1;
      const cosL = (nu * lu + nv * lv) / ll; // -1..1
      const dL = (dark ? 3 : -5) + cosL * (dark ? 11 : 14) - (b.poi ? 0 : 2);
      const dC = cosL < 0 ? -0.015 : 0.005;
      const fill = shiftOklch(base, dL, dC);
      const d = `M${pt(pr.p(a[0], a[1], 0))}L${pt(pr.p(c[0], c[1], 0))}L${pt(pr.p(c[0], c[1], b.height))}L${pt(pr.p(a[0], a[1], b.height))}Z`;
      parts.push(`<path class="cs-wall" d="${d}" fill="${fill}"/>`);
      if (o.floors && b.height >= floorH * 2 && len >= 6) {
        for (let z = floorH; z < b.height - 1.5; z += floorH) {
          floorsPath += `M${pt(pr.p(a[0], a[1], z))}L${pt(pr.p(c[0], c[1], z))}`;
        }
      }
    }
    if (floorsPath) parts.push(`<path class="cs-floors" d="${floorsPath}"/>`);
    const roofL = dark ? 12 : 6;
    parts.push(`<path class="cs-roof" d="${poly3(fp, b.height)}" fill="${shiftOklch(base, roofL - 3, b.poi ? 0.01 : -0.01)}"/>`);
    // Cornisa: azotea interior mas clara.
    if (area(fp) > 140) {
      const inner = insetPolygon(fp, fp.map(() => 1.6));
      if (inner) parts.push(`<path class="cs-roof-top" d="${poly3(inner, b.height)}" fill="${shiftOklch(base, roofL + (b.poi ? 4 : 2), b.poi ? 0.02 : -0.005)}"/>`);
    }
    parts.push(`</g>`);
  }
  parts.push(`</g>`);

  // Pins de tienda con etiqueta con fondo, ordenados por profundidad.
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
    const sz = poi.kind === 'flagship' ? pinSize * 1.3 : poi.kind === 'kiosk' ? pinSize * 0.75 : pinSize;
    const cls = ov?.className ? `cs-poi-marker cs-kind-${poi.kind} ${ov.className}` : `cs-poi-marker cs-kind-${poi.kind}`;
    const labelW = poi.label.length * 4.9 + 8;
    const labelY = head[1] - sz - 4;
    parts.push(
      `<g class="${cls}" data-id="${poi.id}" data-kind="${poi.kind}" data-label="${escapeXml(poi.label)}"${styleAttrs(ov)}>` +
        `<line class="cs-pin" x1="${fmt(foot[0], P)}" y1="${fmt(foot[1], P)}" x2="${fmt(head[0], P)}" y2="${fmt(head[1], P)}"/>` +
        `<circle class="cs-pin-ring" cx="${fmt(head[0], P)}" cy="${fmt(head[1], P)}" r="${(sz * 0.9).toFixed(1)}"/>` +
        `<circle class="cs-pin-head" cx="${fmt(head[0], P)}" cy="${fmt(head[1], P)}" r="${(sz * 0.55).toFixed(1)}"/>` +
        (o.storeLabels
          ? `<rect class="cs-pin-label-bg" x="${fmt(head[0] - labelW / 2, P)}" y="${fmt(labelY - 6.5, P)}" width="${labelW.toFixed(1)}" height="12" rx="6"/>` +
            `<text class="cs-pin-label" x="${fmt(head[0], P)}" y="${fmt(labelY, P)}">${escapeXml(poi.label)}</text>`
          : '') +
        `<title>${escapeXml(poi.label)}</title></g>`,
    );
  }
  parts.push(`</g><g data-layer="overlay"></g></g></svg>`);
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

/** Expande un poligono convexo-ish alejando cada vertice del centroide. */
function growPolygon(poly: Polygon, d: number): Vec2[] {
  const c = centroid(poly);
  return poly.map((q) => {
    const dx = q[0] - c[0];
    const dy = q[1] - c[1];
    const l = Math.hypot(dx, dy) || 1;
    return [q[0] + (dx / l) * d, q[1] + (dy / l) * d] as Vec2;
  });
}

/** Hash de opciones iso para claves de cache. */
export function isoOptionsKey(o: Partial<IsoOptions>): string {
  return cyrb53(JSON.stringify({ ...o, lotHeight: o.lotHeight ? 'fn' : undefined })).toString(16);
}
