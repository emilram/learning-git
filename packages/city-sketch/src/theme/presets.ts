import type { DeepPartial, Theme, ThemePresetName } from '../core/types';
import { deepMerge } from '../core/params';

const base: Theme = {
  name: 'blueprint',
  scheme: 'light',
  primitives: {
    colors: {
      'paper-0': 'oklch(98% 0.005 250)',
      'paper-1': 'oklch(95% 0.01 250)',
      'ink-900': 'oklch(22% 0.03 260)',
      'ink-600': 'oklch(45% 0.03 260)',
      'ink-300': 'oklch(78% 0.02 260)',
      'blue-500': 'oklch(55% 0.16 250)',
      'blue-200': 'oklch(88% 0.06 250)',
      'green-300': 'oklch(85% 0.09 150)',
      'green-500': 'oklch(62% 0.13 150)',
      'amber-500': 'oklch(72% 0.15 70)',
      'amber-200': 'oklch(92% 0.06 80)',
      'red-500': 'oklch(58% 0.2 25)',
      'coral-500': 'oklch(68% 0.17 35)',
      white: 'oklch(100% 0 0)',
    },
    fontFamilies: {
      display: '"Inter", "Segoe UI", system-ui, sans-serif',
      body: '"Inter", "Segoe UI", system-ui, sans-serif',
      mono: '"JetBrains Mono", ui-monospace, monospace',
      hand: '"Caveat", "Segoe Print", cursive',
    },
    strokeWidths: { hair: 0.5, thin: 1, regular: 1.5, bold: 2.5 },
  },
  semantic: {
    surface: 'paper-0',
    surfaceAlt: 'paper-1',
    ink: 'ink-900',
    inkMuted: 'ink-600',
    accent: 'blue-500',
    accentAlt: 'coral-500',
    danger: 'red-500',
    success: 'green-500',
    water: 'blue-200',
    park: 'green-300',
    plaza: 'amber-200',
    retail: 'amber-200',
    residential: 'paper-1',
    fontDisplay: 'display',
    fontBody: 'body',
  },
  components: {
    street: {
      avenue: { stroke: 'surface', widthScale: 1, casing: 'ink' },
      street: { stroke: 'surface', widthScale: 1, casing: 'inkMuted' },
      alley: { stroke: 'surface', widthScale: 1, casing: 'inkMuted', dash: '3 2' },
    },
    block: {
      retail: { fill: 'retail', stroke: 'inkMuted', pattern: 'none', opacity: 1 },
      residential: { fill: 'residential', stroke: 'inkMuted', pattern: 'none', opacity: 1 },
      park: { fill: 'park', stroke: 'success', pattern: 'dots', opacity: 1 },
      water: { fill: 'water', stroke: 'accent', pattern: 'none', opacity: 1 },
      plaza: { fill: 'plaza', stroke: 'inkMuted', pattern: 'hatch', opacity: 1 },
    },
    lot: { stroke: 'inkMuted', strokeWidth: 0.4, opacity: 0.5 },
    label: { fill: 'ink', halo: 'surface', font: 'fontBody', letterSpacing: 0.04 },
    poi: { fill: 'accentAlt', stroke: 'surface', ring: 'accent', size: 7 },
    canvas: { background: 'surface', grid: 'ink-300' },
  },
  sketch: { technique: 'none', intensity: 0.5 },
};

const blueprint: Theme = deepMerge(base, {
  name: 'blueprint',
  primitives: {
    colors: {
      'paper-0': 'oklch(36% 0.11 255)',
      'paper-1': 'oklch(40% 0.1 255)',
      'ink-900': 'oklch(97% 0.02 250)',
      'ink-600': 'oklch(85% 0.05 250)',
      'ink-300': 'oklch(55% 0.08 255)',
      'blue-200': 'oklch(30% 0.09 255)',
      'green-300': 'oklch(45% 0.09 200)',
      'amber-200': 'oklch(44% 0.1 255)',
      'coral-500': 'oklch(85% 0.15 80)',
      'blue-500': 'oklch(92% 0.06 220)',
    },
  },
  scheme: 'dark',
  components: {
    street: {
      avenue: { stroke: 'ink', widthScale: 0.55, casing: 'surface' },
      street: { stroke: 'inkMuted', widthScale: 0.45, casing: 'surface' },
      alley: { stroke: 'inkMuted', widthScale: 0.4, casing: 'surface', dash: '3 2' },
    },
    block: {
      retail: { fill: 'retail', stroke: 'inkMuted', pattern: 'hatch', opacity: 1 },
      residential: { fill: 'residential', stroke: 'inkMuted', pattern: 'none', opacity: 1 },
      park: { fill: 'park', stroke: 'inkMuted', pattern: 'dots', opacity: 1 },
      water: { fill: 'water', stroke: 'inkMuted', pattern: 'none', opacity: 1 },
      plaza: { fill: 'plaza', stroke: 'inkMuted', pattern: 'cross-hatch', opacity: 1 },
    },
    lot: { stroke: 'inkMuted', strokeWidth: 0.35, opacity: 0.45 },
    canvas: { background: 'surface', grid: 'ink-300' },
    poi: { fill: 'accentAlt', stroke: 'surface', ring: 'accent', size: 7 },
  },
} satisfies DeepPartial<Theme>);

const handSketch: Theme = deepMerge(base, {
  name: 'hand-sketch',
  primitives: {
    colors: {
      'paper-0': 'oklch(96% 0.02 85)',
      'paper-1': 'oklch(93% 0.025 85)',
      'ink-900': 'oklch(28% 0.03 60)',
      'ink-600': 'oklch(48% 0.03 60)',
      'green-300': 'oklch(88% 0.07 140)',
      'blue-200': 'oklch(88% 0.05 230)',
      'amber-200': 'oklch(94% 0.04 80)',
    },
  },
  semantic: { fontBody: 'hand', fontDisplay: 'hand' },
  components: {
    street: {
      avenue: { stroke: 'surface', widthScale: 1, casing: 'ink' },
      street: { stroke: 'surface', widthScale: 1, casing: 'ink' },
      alley: { stroke: 'surface', widthScale: 0.9, casing: 'inkMuted', dash: '4 3' },
    },
    block: {
      retail: { fill: 'retail', stroke: 'ink', pattern: 'hatch', opacity: 1 },
      residential: { fill: 'residential', stroke: 'ink', pattern: 'none', opacity: 1 },
      park: { fill: 'park', stroke: 'ink', pattern: 'dots', opacity: 1 },
      water: { fill: 'water', stroke: 'ink', pattern: 'hatch', opacity: 1 },
      plaza: { fill: 'plaza', stroke: 'ink', pattern: 'cross-hatch', opacity: 1 },
    },
    label: { fill: 'ink', halo: 'surface', font: 'fontBody', letterSpacing: 0.02 },
    lot: { stroke: 'inkMuted', strokeWidth: 0.5, opacity: 0.6 },
  },
  sketch: { technique: 'rough', intensity: 0.6, fillStyle: 'hachure', roughBlocks: false },
} satisfies DeepPartial<Theme>);

const minimalMono: Theme = deepMerge(base, {
  name: 'minimal-mono',
  primitives: {
    colors: {
      'paper-0': 'oklch(100% 0 0)',
      'paper-1': 'oklch(96% 0 0)',
      'ink-900': 'oklch(15% 0 0)',
      'ink-600': 'oklch(50% 0 0)',
      'ink-300': 'oklch(85% 0 0)',
      'blue-200': 'oklch(92% 0 0)',
      'green-300': 'oklch(94% 0 0)',
      'amber-200': 'oklch(97% 0 0)',
      'coral-500': 'oklch(15% 0 0)',
      'blue-500': 'oklch(50% 0 0)',
    },
  },
  components: {
    street: {
      avenue: { stroke: 'ink', widthScale: 0.35, casing: 'surface' },
      street: { stroke: 'ink', widthScale: 0.2, casing: 'surface' },
      alley: { stroke: 'inkMuted', widthScale: 0.18, casing: 'surface', dash: '2 2' },
    },
    block: {
      retail: { fill: 'retail', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      residential: { fill: 'residential', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      park: { fill: 'park', stroke: 'ink-300', pattern: 'dots', opacity: 1 },
      water: { fill: 'water', stroke: 'ink-300', pattern: 'hatch', opacity: 1 },
      plaza: { fill: 'plaza', stroke: 'ink-300', pattern: 'none', opacity: 1 },
    },
    lot: { stroke: 'ink-300', strokeWidth: 0.3, opacity: 0.6 },
    poi: { fill: 'accentAlt', stroke: 'surface', ring: 'inkMuted', size: 6 },
    canvas: { background: 'surface' },
  },
} satisfies DeepPartial<Theme>);

const retailWarm: Theme = deepMerge(base, {
  name: 'retail-warm',
  primitives: {
    colors: {
      'paper-0': 'oklch(95% 0.02 75)',
      'paper-1': 'oklch(90% 0.035 75)',
      'ink-900': 'oklch(30% 0.05 40)',
      'ink-600': 'oklch(52% 0.06 40)',
      'ink-300': 'oklch(82% 0.03 60)',
      'amber-200': 'oklch(90% 0.09 75)',
      'green-300': 'oklch(88% 0.08 135)',
      'blue-200': 'oklch(88% 0.06 220)',
      'coral-500': 'oklch(62% 0.2 30)',
      'blue-500': 'oklch(60% 0.14 45)',
    },
  },
  components: {
    street: {
      avenue: { stroke: 'surface', widthScale: 1, casing: 'inkMuted' },
      street: { stroke: 'surface', widthScale: 1, casing: 'ink-300' },
      alley: { stroke: 'surface', widthScale: 0.9, casing: 'ink-300', dash: '3 2' },
    },
    poi: { fill: 'accentAlt', stroke: 'surface', ring: 'accent', size: 8 },
  },
} satisfies DeepPartial<Theme>);

const darkOps: Theme = deepMerge(base, {
  name: 'dark-ops',
  scheme: 'dark',
  primitives: {
    colors: {
      'paper-0': 'oklch(18% 0.01 260)',
      'paper-1': 'oklch(24% 0.012 260)',
      'ink-900': 'oklch(92% 0.01 260)',
      'ink-600': 'oklch(70% 0.02 260)',
      'ink-300': 'oklch(38% 0.02 260)',
      'blue-200': 'oklch(28% 0.06 250)',
      'green-300': 'oklch(30% 0.06 150)',
      'amber-200': 'oklch(30% 0.04 80)',
      'coral-500': 'oklch(78% 0.17 60)',
      'blue-500': 'oklch(75% 0.14 200)',
      'red-500': 'oklch(65% 0.2 25)',
    },
  },
  components: {
    street: {
      avenue: { stroke: 'ink-600', widthScale: 0.5, casing: 'surface' },
      street: { stroke: 'ink-300', widthScale: 0.45, casing: 'surface' },
      alley: { stroke: 'ink-300', widthScale: 0.35, casing: 'surface', dash: '3 3' },
    },
    block: {
      retail: { fill: 'retail', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      residential: { fill: 'residential', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      park: { fill: 'park', stroke: 'ink-300', pattern: 'dots', opacity: 1 },
      water: { fill: 'water', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      plaza: { fill: 'plaza', stroke: 'ink-300', pattern: 'hatch', opacity: 1 },
    },
    lot: { stroke: 'ink-300', strokeWidth: 0.35, opacity: 0.5 },
    label: { fill: 'ink', halo: 'surface', font: 'fontBody', letterSpacing: 0.06 },
    poi: { fill: 'accentAlt', stroke: 'surface', ring: 'accent', size: 7 },
    canvas: { background: 'surface', grid: 'ink-300' },
  },
} satisfies DeepPartial<Theme>);

const cityDay: Theme = deepMerge(base, {
  name: 'city-day',
  scheme: 'light',
  primitives: {
    colors: {
      'paper-0': 'oklch(88% 0.035 80)',
      'paper-1': 'oklch(85% 0.045 75)',
      'ink-900': 'oklch(24% 0.03 50)',
      'ink-600': 'oklch(44% 0.03 50)',
      'ink-300': 'oklch(72% 0.02 70)',
      'blue-200': 'oklch(68% 0.11 215)',
      'green-300': 'oklch(70% 0.13 140)',
      'green-500': 'oklch(48% 0.13 145)',
      'amber-200': 'oklch(83% 0.07 60)',
      'coral-500': 'oklch(58% 0.21 28)',
      'blue-500': 'oklch(52% 0.15 240)',
      'asphalt-500': 'oklch(48% 0.012 260)',
      'asphalt-400': 'oklch(56% 0.012 260)',
      'asphalt-300': 'oklch(63% 0.01 260)',
      'sidewalk-200': 'oklch(80% 0.025 80)',
    },
  },
  components: {
    street: {
      avenue: { stroke: 'asphalt-500', widthScale: 1, casing: 'sidewalk-200' },
      street: { stroke: 'asphalt-400', widthScale: 1, casing: 'sidewalk-200' },
      alley: { stroke: 'asphalt-300', widthScale: 0.9, casing: 'sidewalk-200' },
    },
    block: {
      retail: { fill: 'retail', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      residential: { fill: 'residential', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      park: { fill: 'park', stroke: 'green-500', pattern: 'none', opacity: 1 },
      water: { fill: 'water', stroke: 'blue-500', pattern: 'none', opacity: 1 },
      plaza: { fill: 'plaza', stroke: 'ink-300', pattern: 'dots', opacity: 1 },
    },
    lot: { stroke: 'ink-300', strokeWidth: 0.35, opacity: 0.5 },
    label: { fill: 'ink', halo: 'surface', font: 'fontBody', letterSpacing: 0.04 },
    poi: { fill: 'accentAlt', stroke: 'surface', ring: 'accent', size: 7 },
    canvas: { background: 'surface' },
    building: {
      facades: ['oklch(80% 0.07 55)', 'oklch(84% 0.05 80)', 'oklch(74% 0.09 40)', 'oklch(79% 0.03 95)', 'oklch(70% 0.05 60)', 'oklch(81% 0.02 250)', 'oklch(76% 0.06 25)', 'oklch(86% 0.03 70)'],
      roofs: ['oklch(58% 0.12 35)', 'oklch(62% 0.1 45)', 'oklch(68% 0.03 80)', 'oklch(55% 0.02 260)', 'oklch(64% 0.08 60)'],
      awnings: ['oklch(58% 0.2 25)', 'oklch(60% 0.15 250)', 'oklch(62% 0.16 145)', 'oklch(74% 0.17 80)', 'oklch(50% 0.12 320)'],
    },
  },
} satisfies DeepPartial<Theme>);

const cityDusk: Theme = deepMerge(base, {
  name: 'city-dusk',
  scheme: 'dark',
  primitives: {
    colors: {
      'paper-0': 'oklch(32% 0.05 290)',
      'paper-1': 'oklch(38% 0.05 285)',
      'ink-900': 'oklch(94% 0.02 80)',
      'ink-600': 'oklch(78% 0.04 80)',
      'ink-300': 'oklch(50% 0.05 290)',
      'blue-200': 'oklch(34% 0.09 250)',
      'green-300': 'oklch(40% 0.08 150)',
      'green-500': 'oklch(60% 0.1 150)',
      'amber-200': 'oklch(44% 0.06 300)',
      'coral-500': 'oklch(76% 0.18 55)',
      'blue-500': 'oklch(82% 0.1 200)',
      'red-500': 'oklch(68% 0.2 25)',
      'asphalt-500': 'oklch(26% 0.03 285)',
      'asphalt-400': 'oklch(30% 0.03 285)',
      'sidewalk-200': 'oklch(46% 0.05 290)',
    },
  },
  components: {
    street: {
      avenue: { stroke: 'asphalt-500', widthScale: 1, casing: 'sidewalk-200' },
      street: { stroke: 'asphalt-400', widthScale: 1, casing: 'sidewalk-200' },
      alley: { stroke: 'asphalt-400', widthScale: 0.9, casing: 'sidewalk-200' },
    },
    block: {
      retail: { fill: 'retail', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      residential: { fill: 'residential', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      park: { fill: 'park', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      water: { fill: 'water', stroke: 'ink-300', pattern: 'none', opacity: 1 },
      plaza: { fill: 'plaza', stroke: 'ink-300', pattern: 'dots', opacity: 1 },
    },
    lot: { stroke: 'ink-300', strokeWidth: 0.35, opacity: 0.45 },
    label: { fill: 'ink', halo: 'surface', font: 'fontBody', letterSpacing: 0.05 },
    poi: { fill: 'accentAlt', stroke: 'surface', ring: 'accent', size: 7 },
    canvas: { background: 'surface' },
    building: {
      facades: ['oklch(46% 0.06 290)', 'oklch(50% 0.05 270)', 'oklch(42% 0.07 310)', 'oklch(54% 0.04 260)', 'oklch(48% 0.08 330)', 'oklch(44% 0.04 240)'],
      roofs: ['oklch(40% 0.05 290)', 'oklch(36% 0.06 300)', 'oklch(44% 0.03 270)'],
      awnings: ['oklch(72% 0.18 55)', 'oklch(70% 0.15 340)', 'oklch(75% 0.12 200)', 'oklch(78% 0.16 90)'],
    },
  },
} satisfies DeepPartial<Theme>);

export const THEME_PRESETS: Readonly<Record<ThemePresetName, Theme>> = {
  'city-day': cityDay,
  'city-dusk': cityDusk,
  blueprint,
  'hand-sketch': handSketch,
  'minimal-mono': minimalMono,
  'retail-warm': retailWarm,
  'dark-ops': darkOps,
};

export function resolveTheme(input: ThemePresetName | DeepPartial<Theme> | Theme | undefined): Theme {
  if (!input) return THEME_PRESETS['retail-warm'];
  if (typeof input === 'string') return THEME_PRESETS[input];
  const presetName = (input.name as ThemePresetName | undefined) ?? 'retail-warm';
  const preset = THEME_PRESETS[presetName] ?? THEME_PRESETS['retail-warm'];
  return deepMerge(preset, input as DeepPartial<Theme>);
}
