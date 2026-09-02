/**
 * Serializador SVG standalone: capas <g data-layer>, ids estables, <pattern>,
 * <symbol>/<use> para POIs, <textPath> para nombres, estilo boceto (rough / filtro).
 */
import rough from 'roughjs/bin/rough';
import type { Options as RoughOptions } from 'roughjs/bin/core';
import { cyrb53 } from '../rng/ids';
import { baseStylesheet, themeVariables, variablesToCss } from '../../theme/css';
import type { CityModel, ElementStyle, LayerName, SvgOptions, SvgOutput, Theme } from '../types';
import { escapeXml, polygonPath, polylinePath } from './paths';

export const DEFAULT_SVG_OPTIONS: SvgOptions = {
  embedStyles: true,
  idPrefix: 'cs',
  precision: 2,
  accessible: true,
};

const ALL_LAYERS: readonly LayerName[] = ['defs', 'canvas', 'water', 'blocks', 'lots', 'streets-casing', 'streets', 'labels', 'pois', 'overlay'];

function styleAttrs(o: ElementStyle | undefined): string {
  if (!o) return '';
  let s = '';
  if (o.className) s += ` class="${escapeXml(o.className)}"`;
  if (o.style) s += ` style="${escapeXml(o.style)}"`;
  if (o.data) for (const [k, v] of Object.entries(o.data)) s += ` data-${k}="${escapeXml(v)}"`;
  return s;
}

function withoutClass(o: ElementStyle | undefined): ElementStyle | undefined {
  if (!o) return undefined;
  const { className: _c, ...rest } = o;
  void _c;
  return rest;
}

function mergeClass(base: string, o: ElementStyle | undefined): string {
  return o?.className ? `${base} ${o.className}` : base;
}

export function patternDefs(prefix: string): string {
  return [
    `<pattern id="${prefix}-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="0.6"/></pattern>`,
    `<pattern id="${prefix}-cross-hatch" patternUnits="userSpaceOnUse" width="6" height="6"><path d="M0 3H6M3 0V6" stroke="currentColor" stroke-width="0.5"/></pattern>`,
    `<pattern id="${prefix}-dots" patternUnits="userSpaceOnUse" width="5" height="5"><circle cx="2.5" cy="2.5" r="0.7" fill="currentColor"/></pattern>`,
    `<pattern id="${prefix}-grid" patternUnits="userSpaceOnUse" width="8" height="8"><path d="M8 0H0V8" fill="none" stroke="currentColor" stroke-width="0.4"/></pattern>`,
  ].join('');
}

export function sketchFilterDef(prefix: string, intensity: number): string {
  const freq = (0.008 + 0.03 * intensity).toFixed(4);
  const scale = (2 + 8 * intensity).toFixed(2);
  return `<filter id="${prefix}-sketch" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
}

export function poiSymbolDef(prefix: string): string {
  return `<symbol id="${prefix}-poi" viewBox="-10 -10 20 20" overflow="visible"><circle class="cs-poi-ring" r="7.5" style="fill:none;stroke:var(--cs-poi-ring);stroke-width:1.5"/><circle class="cs-poi" r="4.5" style="fill:var(--cs-poi-fill);stroke:var(--cs-poi-stroke);stroke-width:1.2"/></symbol>`;
}

export function serializeSvg(model: CityModel, theme: Theme, opts: Partial<SvgOptions> = {}): SvgOutput {
  const o: SvgOptions = { ...DEFAULT_SVG_OPTIONS, ...opts };
  const p = o.precision;
  const prefix = o.idPrefix;
  const layers = new Set<LayerName>(o.layers ?? ALL_LAYERS);
  const counts: Record<LayerName, number> = { defs: 0, canvas: 0, water: 0, blocks: 0, lots: 0, 'streets-casing': 0, streets: 0, labels: 0, pois: 0, overlay: 0 };
  const parts: string[] = [];
  const { w, h } = model.bounds;
  const vars = themeVariables(theme);
  const sketch = theme.sketch;
  const roughGen = sketch.technique === 'rough' ? rough.generator() : null;
  const roughOpts = (id: string, extra: RoughOptions = {}): RoughOptions => ({
    roughness: 0.4 + sketch.intensity * 1.6,
    bowing: 0.5 + sketch.intensity * 1.5,
    seed: cyrb53(id) % 2147483647,
    disableMultiStroke: sketch.intensity < 0.5,
    preserveVertices: true,
    ...extra,
  });
  const roughPath = (d: string, id: string, cls: string, attrs: string, extra: RoughOptions = {}): string => {
    const drawable = roughGen!.path(d, roughOpts(id, extra));
    const paths = roughGen!.toPaths(drawable);
    return paths
      .map((pi) => `<path class="${cls}" d="${pi.d}"${attrs}${pi.fill && pi.fill !== 'none' ? ` fill="${pi.fill}"` : ''}/>`)
      .join('');
  };

  const titleId = `${prefix}-title`;
  const descId = `${prefix}-desc`;
  const rootAttrs = [
    `xmlns="http://www.w3.org/2000/svg"`,
    `xmlns:xlink="http://www.w3.org/1999/xlink"`,
    `viewBox="0 0 ${w} ${h}"`,
    `width="${w}"`,
    `height="${h}"`,
    `class="${prefix}-root"`,
    `data-seed="${escapeXml(model.seed)}"`,
    `data-theme="${escapeXml(theme.name)}"`,
    `style="${escapeXml(variablesToCss(vars))}"`,
  ];
  if (o.accessible) rootAttrs.push(`role="img"`, `aria-labelledby="${titleId} ${descId}"`);
  parts.push(`<svg ${rootAttrs.join(' ')}>`);
  if (o.accessible) {
    const title = o.title ?? `Croquis de ciudad ${model.seed}`;
    const desc =
      o.description ??
      `Ciudad sintetica con ${model.streets.length} calles, ${model.blocks.length} manzanas y ${model.pois.length} puntos de interes. Modo ${model.meta.params.mode}.`;
    parts.push(`<title id="${titleId}">${escapeXml(title)}</title><desc id="${descId}">${escapeXml(desc)}</desc>`);
  }
  if (o.embedStyles) parts.push(`<style>${baseStylesheet(`.${prefix}-root`)}</style>`);

  if (layers.has('defs')) {
    parts.push(`<defs>${patternDefs(prefix)}${poiSymbolDef(prefix)}${sketch.technique === 'filter' ? sketchFilterDef(prefix, sketch.intensity) : ''}</defs>`);
    counts.defs = 1;
  }
  if (layers.has('canvas')) {
    parts.push(`<g data-layer="canvas"><rect class="cs-canvas" x="0" y="0" width="${w}" height="${h}"/></g>`);
    counts.canvas = 1;
  }
  const filterAttr = sketch.technique === 'filter' ? ` filter="url(#${prefix}-sketch)"` : '';

  if (layers.has('blocks')) {
    parts.push(`<g data-layer="blocks"${sketch.roughBlocks ? '' : filterAttr}>`);
    for (const b of model.blocks) {
      const ov = model.meta.params.overrides.blocks?.[b.id] ?? b.overrides;
      const cls = mergeClass(`cs-block cs-lu-${b.landUse}`, ov);
      const attrs = ` id="${prefix}-${b.id}" data-id="${b.id}" data-landuse="${b.landUse}" data-district="${b.districtId}"${styleAttrs(withoutClass(ov))}`;
      const d = polygonPath(b.polygon, p);
      const pattern = theme.components.block[b.landUse].pattern;
      if (roughGen && sketch.roughBlocks) {
        parts.push(roughPath(d, b.id, cls, attrs, { fill: 'currentColor', fillStyle: sketch.fillStyle ?? 'hachure', hachureGap: 5 }));
      } else {
        parts.push(`<path class="${cls}" d="${d}"${attrs}/>`);
        if (pattern !== 'none') {
          parts.push(`<path class="cs-pattern" d="${d}" fill="url(#${prefix}-${pattern})" style="color:var(--cs-block-${b.landUse}-stroke)"/>`);
        }
      }
      counts.blocks++;
    }
    parts.push(`</g>`);
  }
  if (layers.has('lots')) {
    parts.push(`<g data-layer="lots">`);
    for (const l of model.lots) {
      parts.push(`<path class="cs-lot" d="${polygonPath(l.polygon, p)}" data-id="${l.id}" data-block="${l.blockId}"/>`);
      counts.lots++;
    }
    parts.push(`</g>`);
  }
  if (layers.has('water')) {
    parts.push(`<g data-layer="water"${filterAttr}>`);
    // El agua ya esta representada como manzanas `water`; aqui van los cuerpos de agua que no coinciden con manzanas.
    counts.water = 0;
    parts.push(`</g>`);
  }
  const streetWidth = (cls: 'avenue' | 'street' | 'alley', width: number): number => width * theme.components.street[cls].widthScale;
  if (layers.has('streets-casing')) {
    parts.push(`<g data-layer="streets-casing"${filterAttr}>`);
    for (const s of model.streets) {
      const comp = theme.components.street[s.class];
      if (!comp.casing) continue;
      const wdt = streetWidth(s.class, s.width);
      const d = polylinePath(s.polyline, p);
      const attrs = ` stroke-width="${(wdt + 1.6).toFixed(2)}" data-id="${s.id}"`;
      if (roughGen) parts.push(roughPath(d, `${s.id}:c`, `cs-street cs-casing cs-${s.class}`, attrs));
      else parts.push(`<path class="cs-street cs-casing cs-${s.class}" d="${d}"${attrs}/>`);
      counts['streets-casing']++;
    }
    parts.push(`</g>`);
  }
  if (layers.has('streets')) {
    parts.push(`<g data-layer="streets"${filterAttr}>`);
    for (const s of model.streets) {
      const ov = model.meta.params.overrides.streets?.[s.id] ?? s.overrides;
      const comp = theme.components.street[s.class];
      const wdt = streetWidth(s.class, s.width);
      const d = polylinePath(s.polyline, p);
      const cls = mergeClass(`cs-street cs-fill cs-${s.class}`, ov);
      const attrs = ` id="${prefix}-${s.id}" stroke-width="${wdt.toFixed(2)}"${comp.dash ? ` stroke-dasharray="${comp.dash}"` : ''} data-id="${s.id}" data-class="${s.class}"${s.name ? ` data-name="${escapeXml(s.name)}"` : ''}${styleAttrs(withoutClass(ov))}`;
      if (roughGen) parts.push(roughPath(d, s.id, cls, attrs));
      else parts.push(`<path class="${cls}" d="${d}"${attrs}/>`);
      counts.streets++;
    }
    parts.push(`</g>`);
  }
  if (layers.has('labels')) {
    parts.push(`<g data-layer="labels">`);
    for (const l of model.labels) {
      const pid = `${prefix}-${l.id}-p`;
      parts.push(
        `<path id="${pid}" class="cs-label-path" d="${polylinePath(l.path, p)}"/>` +
          `<text class="cs-label" font-size="${l.fontSize}" data-id="${l.id}" data-target="${l.targetId}"><textPath href="#${pid}" startOffset="${l.startOffset}%">${escapeXml(l.text)}</textPath></text>`,
      );
      counts.labels++;
    }
    parts.push(`</g>`);
  }
  if (layers.has('pois')) {
    parts.push(`<g data-layer="pois">`);
    const size = theme.components.poi.size;
    for (const poi of model.pois) {
      const ov = model.meta.params.overrides.pois?.[poi.id] ?? poi.overrides;
      const cls = mergeClass(`cs-poi-marker cs-kind-${poi.kind}`, ov);
      const sz = poi.kind === 'flagship' ? size * 1.4 : poi.kind === 'kiosk' ? size * 0.7 : size;
      parts.push(
        `<use href="#${prefix}-poi" class="${cls}" x="${poi.x.toFixed(p)}" y="${poi.y.toFixed(p)}" width="${(sz * 2).toFixed(2)}" height="${(sz * 2).toFixed(2)}" transform="translate(${(-sz).toFixed(2)} ${(-sz).toFixed(2)})" id="${prefix}-${poi.id}" data-id="${poi.id}" data-kind="${poi.kind}" data-label="${escapeXml(poi.label)}"${poi.externalId ? ` data-external-id="${escapeXml(poi.externalId)}"` : ''}${styleAttrs(withoutClass(ov))}><title>${escapeXml(poi.label)}</title></use>`,
      );
      counts.pois++;
    }
    parts.push(`</g>`);
  }
  if (layers.has('overlay')) parts.push(`<g data-layer="overlay"></g>`);
  parts.push(`</svg>`);
  return { svg: parts.join('\n'), viewBox: [0, 0, w, h], elementCount: counts };
}
