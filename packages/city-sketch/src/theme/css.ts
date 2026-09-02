/**
 * Resolucion de tokens (primitivo → semantico → componente) a custom properties.
 * Convencion: --cs-<componente>-<variante>-<propiedad>.
 */
import type { LandUse, StreetClass, Theme } from '../core/types';

const LAND_USES: readonly LandUse[] = ['retail', 'residential', 'park', 'water', 'plaza'];
const CLASSES: readonly StreetClass[] = ['avenue', 'street', 'alley'];

function isLiteral(v: string): boolean {
  return v.startsWith('oklch(') || v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl') || v.startsWith('var(') || /^[A-Z]/.test(v);
}

/** Resuelve un nombre semantico o primitivo a su valor literal. */
export function resolveColor(theme: Theme, ref: string): string {
  if (isLiteral(ref)) return ref;
  const sem = (theme.semantic as unknown as Record<string, string>)[ref];
  if (sem !== undefined) return resolveColor(theme, sem);
  const prim = theme.primitives.colors[ref];
  if (prim !== undefined) return prim;
  return ref;
}

export function resolveFont(theme: Theme, ref: string): string {
  const sem = (theme.semantic as unknown as Record<string, string>)[ref];
  const key = sem ?? ref;
  return theme.primitives.fontFamilies[key] ?? key;
}

export function themeVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  const c = theme.components;
  vars['--cs-canvas-bg'] = resolveColor(theme, c.canvas.background);
  if (c.canvas.grid) vars['--cs-canvas-grid'] = resolveColor(theme, c.canvas.grid);
  vars['--cs-ink'] = resolveColor(theme, 'ink');
  vars['--cs-ink-muted'] = resolveColor(theme, 'inkMuted');
  vars['--cs-surface'] = resolveColor(theme, 'surface');
  vars['--cs-accent'] = resolveColor(theme, 'accent');
  vars['--cs-accent-alt'] = resolveColor(theme, 'accentAlt');
  vars['--cs-danger'] = resolveColor(theme, 'danger');
  vars['--cs-success'] = resolveColor(theme, 'success');
  for (const cls of CLASSES) {
    const s = c.street[cls];
    vars[`--cs-street-${cls}-stroke`] = resolveColor(theme, s.stroke);
    vars[`--cs-street-${cls}-casing`] = s.casing ? resolveColor(theme, s.casing) : 'none';
    vars[`--cs-street-${cls}-scale`] = String(s.widthScale);
    vars[`--cs-street-${cls}-dash`] = s.dash ?? 'none';
  }
  for (const lu of LAND_USES) {
    const b = c.block[lu];
    vars[`--cs-block-${lu}-fill`] = resolveColor(theme, b.fill);
    vars[`--cs-block-${lu}-stroke`] = resolveColor(theme, b.stroke);
    vars[`--cs-block-${lu}-opacity`] = String(b.opacity);
  }
  vars['--cs-lot-stroke'] = resolveColor(theme, c.lot.stroke);
  vars['--cs-lot-width'] = String(c.lot.strokeWidth);
  vars['--cs-lot-opacity'] = String(c.lot.opacity);
  vars['--cs-label-fill'] = resolveColor(theme, c.label.fill);
  vars['--cs-label-halo'] = resolveColor(theme, c.label.halo);
  vars['--cs-label-font'] = resolveFont(theme, c.label.font);
  vars['--cs-label-spacing'] = `${c.label.letterSpacing}em`;
  vars['--cs-poi-fill'] = resolveColor(theme, c.poi.fill);
  vars['--cs-poi-stroke'] = resolveColor(theme, c.poi.stroke);
  vars['--cs-poi-ring'] = resolveColor(theme, c.poi.ring);
  vars['--cs-poi-size'] = String(c.poi.size);
  vars['--cs-font-display'] = resolveFont(theme, 'fontDisplay');
  vars['--cs-font-body'] = resolveFont(theme, 'fontBody');
  return vars;
}

/** Hoja de estilos base para el SVG (standalone o inline). `scope` es el selector raiz. */
export function baseStylesheet(scope: string): string {
  return [
    `${scope}{font-family:var(--cs-font-body);color-scheme:light dark}`,
    `${scope} .cs-canvas{fill:var(--cs-canvas-bg)}`,
    `${scope} .cs-block{stroke-width:0.6;stroke-linejoin:round}`,
    `${scope} .cs-lu-retail{fill:var(--cs-block-retail-fill);stroke:var(--cs-block-retail-stroke);opacity:var(--cs-block-retail-opacity)}`,
    `${scope} .cs-lu-residential{fill:var(--cs-block-residential-fill);stroke:var(--cs-block-residential-stroke);opacity:var(--cs-block-residential-opacity)}`,
    `${scope} .cs-lu-park{fill:var(--cs-block-park-fill);stroke:var(--cs-block-park-stroke);opacity:var(--cs-block-park-opacity)}`,
    `${scope} .cs-lu-water{fill:var(--cs-block-water-fill);stroke:var(--cs-block-water-stroke);opacity:var(--cs-block-water-opacity)}`,
    `${scope} .cs-lu-plaza{fill:var(--cs-block-plaza-fill);stroke:var(--cs-block-plaza-stroke);opacity:var(--cs-block-plaza-opacity)}`,
    `${scope} .cs-pattern{fill-opacity:0.55}`,
    `${scope} .cs-lot{fill:none;stroke:var(--cs-lot-stroke);stroke-width:var(--cs-lot-width);opacity:var(--cs-lot-opacity)}`,
    `${scope} .cs-street{fill:none;stroke-linecap:round;stroke-linejoin:round}`,
    `${scope} .cs-casing.cs-avenue{stroke:var(--cs-street-avenue-casing)}`,
    `${scope} .cs-casing.cs-street{stroke:var(--cs-street-street-casing)}`,
    `${scope} .cs-casing.cs-alley{stroke:var(--cs-street-alley-casing)}`,
    `${scope} .cs-fill.cs-avenue{stroke:var(--cs-street-avenue-stroke)}`,
    `${scope} .cs-fill.cs-street{stroke:var(--cs-street-street-stroke)}`,
    `${scope} .cs-fill.cs-alley{stroke:var(--cs-street-alley-stroke)}`,
    `${scope} .cs-label{fill:var(--cs-label-fill);font-family:var(--cs-label-font);letter-spacing:var(--cs-label-spacing);paint-order:stroke;stroke:var(--cs-label-halo);stroke-width:2.5;stroke-linejoin:round;text-anchor:middle;dominant-baseline:middle}`,
    `${scope} .cs-label-path{fill:none;stroke:none}`,
    `${scope} .cs-poi{fill:var(--cs-poi-fill);stroke:var(--cs-poi-stroke);stroke-width:1.2}`,
    `${scope} .cs-poi-ring{fill:none;stroke:var(--cs-poi-ring);stroke-width:1.5}`,
    `${scope} .cs-water{fill:var(--cs-block-water-fill);stroke:var(--cs-block-water-stroke);stroke-width:0.8}`,
    `@media (forced-colors: active){${scope} .cs-block{fill:Canvas;stroke:CanvasText}${scope} .cs-street{stroke:CanvasText}${scope} .cs-label{fill:CanvasText;stroke:Canvas}${scope} .cs-poi{fill:Highlight;stroke:Canvas}${scope} .cs-pattern{display:none}}`,
  ].join('\n');
}

export function variablesToCss(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}
