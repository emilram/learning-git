import { describe, expect, it } from 'vitest';
import { generateCity, serializeSvg, type GenerationMode } from '../src/index';
import { THEME_PRESETS } from '../src/theme';
import { area, distanceToBoundary, pointInPolygon } from '../src/core/geom/polygon';

const MODES: readonly GenerationMode[] = ['tensor', 'grid-jitter', 'organic-voronoi', 'radial', 'lsystem', 'hybrid'];

describe('generateCity', () => {
  for (const mode of MODES) {
    describe(mode, () => {
      const model = generateCity({ seed: 'test-seed', mode, size: { w: 800, h: 600 } });

      it('produce calles, manzanas, lotes y POIs', () => {
        expect(model.streets.length).toBeGreaterThan(10);
        expect(model.blocks.length).toBeGreaterThan(5);
        expect(model.lots.length).toBeGreaterThan(10);
        expect(model.pois.length).toBeGreaterThan(0);
      });

      it('ids unicos y con prefijo por entidad', () => {
        const all = [
          ...model.nodes.map((n) => n.id),
          ...model.streets.map((s) => s.id),
          ...model.blocks.map((b) => b.id),
          ...model.lots.map((l) => l.id),
          ...model.pois.map((p) => p.id),
          ...model.labels.map((l) => l.id),
        ];
        expect(new Set(all).size).toBe(all.length);
        expect(model.streets.every((s) => s.id.startsWith('s_'))).toBe(true);
        expect(model.blocks.every((b) => b.id.startsWith('b_'))).toBe(true);
      });

      it('las calles referencian nodos existentes y su polilinea coincide con ellos', () => {
        const nodes = new Map(model.nodes.map((n) => [n.id, n]));
        for (const s of model.streets) {
          const a = nodes.get(s.from)!;
          const b = nodes.get(s.to)!;
          expect(a).toBeDefined();
          expect(b).toBeDefined();
          const p0 = s.polyline[0]!;
          const p1 = s.polyline[s.polyline.length - 1]!;
          expect(Math.hypot(p0[0] - a.x, p0[1] - a.y)).toBeLessThan(1e-6);
          expect(Math.hypot(p1[0] - b.x, p1[1] - b.y)).toBeLessThan(1e-6);
        }
      });

      it('todo lote tiene frente a una calle de su manzana y esta dentro de ella', () => {
        const blocks = new Map(model.blocks.map((b) => [b.id, b]));
        for (const lot of model.lots) {
          const block = blocks.get(lot.blockId)!;
          expect(block.streetIds).toContain(lot.frontage);
          expect(area(lot.polygon)).toBeGreaterThan(0);
          for (const v of lot.polygon) {
            expect(pointInPolygon(v, block.outline) || distanceToBoundary(v, block.outline) < 1e-3).toBe(true);
          }
        }
      });

      it('las manzanas insetadas son mas pequenas que su contorno', () => {
        for (const b of model.blocks) {
          expect(area(b.polygon)).toBeLessThanOrEqual(area(b.outline) + 1e-6);
          expect(area(b.polygon)).toBeGreaterThan(0);
        }
      });

      it('los POIs estan dentro del lienzo', () => {
        for (const p of model.pois) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(800);
          expect(p.y).toBeLessThanOrEqual(600);
        }
      });
    });
  }

  it('es determinista: misma semilla + config = mismo SVG byte a byte', () => {
    const a = serializeSvg(generateCity({ seed: 'det', mode: 'tensor' }), THEME_PRESETS.blueprint).svg;
    const b = serializeSvg(generateCity({ seed: 'det', mode: 'tensor' }), THEME_PRESETS.blueprint).svg;
    expect(a).toBe(b);
  });

  it('semillas distintas producen ciudades distintas', () => {
    const a = generateCity({ seed: 'one', mode: 'grid-jitter' });
    const b = generateCity({ seed: 'two', mode: 'grid-jitter' });
    expect(a.streets.length === b.streets.length && a.streets[0]!.id === b.streets[0]!.id).toBe(false);
  });

  it('cambiar parametros de lotes no altera calles ni manzanas (PRNG por etapa)', () => {
    const a = generateCity({ seed: 'stage', mode: 'grid-jitter' });
    const b = generateCity({ seed: 'stage', mode: 'grid-jitter', lots: { minArea: 900, maxArea: 3000 } });
    expect(b.streets.map((s) => s.id)).toEqual(a.streets.map((s) => s.id));
    expect(b.blocks.map((s) => s.id)).toEqual(a.blocks.map((s) => s.id));
    expect(b.lots.length).not.toBe(a.lots.length);
  });

  it('POIs manuales por coordenadas normalizadas conservan su ancla', () => {
    const m = generateCity({
      seed: 'manual',
      mode: 'grid-jitter',
      pois: { mode: 'manual', items: [{ id: 'hq', label: 'Sede', nx: 0.5, ny: 0.5, kind: 'flagship' }] },
    });
    expect(m.pois).toHaveLength(1);
    expect(m.pois[0]!.anchor).toEqual({ kind: 'normalized', nx: 0.5, ny: 0.5 });
    expect(m.pois[0]!.x).toBe(600);
    expect(m.pois[0]!.label).toBe('Sede');
  });

  it('la config efectiva y su hash quedan en meta', () => {
    const m = generateCity({ seed: 'meta', density: 0.9 });
    expect(m.meta.params.density).toBe(0.9);
    expect(m.meta.params.tensor.spacingMajor).toBeGreaterThan(0);
    expect(m.meta.configHash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('serializeSvg', () => {
  const model = generateCity({ seed: 'svg', mode: 'grid-jitter', size: { w: 600, h: 400 } });

  it('emite capas con data-layer, defs y accesibilidad', () => {
    const out = serializeSvg(model, THEME_PRESETS['retail-warm']);
    for (const layer of ['canvas', 'blocks', 'lots', 'streets-casing', 'streets', 'labels', 'pois']) {
      expect(out.svg).toContain(`data-layer="${layer}"`);
    }
    expect(out.svg).toContain('role="img"');
    expect(out.svg).toContain('<textPath');
    expect(out.svg).toContain('<symbol id="cs-poi"');
    expect(out.svg).toContain('viewBox="0 0 600 400"');
    expect(out.elementCount.streets).toBe(model.streets.length);
  });

  it('aplica overrides por elemento', () => {
    const sid = model.streets[0]!.id;
    const withOverride = { ...model, meta: { ...model.meta, params: { ...model.meta.params, overrides: { streets: { [sid]: { className: 'hot', style: 'stroke:red' } } } } } };
    const out = serializeSvg(withOverride, THEME_PRESETS['retail-warm']);
    expect(out.svg).toContain(`class="cs-street cs-fill cs-${model.streets[0]!.class} hot"`);
    expect(out.svg).toContain('style="stroke:red"');
  });

  it('rough.js genera trazos multiples deterministas', () => {
    const a = serializeSvg(model, THEME_PRESETS['hand-sketch']).svg;
    const b = serializeSvg(model, THEME_PRESETS['hand-sketch']).svg;
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(serializeSvg(model, THEME_PRESETS['retail-warm']).svg.length);
  });

  for (const theme of Object.keys(THEME_PRESETS) as (keyof typeof THEME_PRESETS)[]) {
    it(`snapshot ${theme}`, () => {
      const small = generateCity({ seed: 'snap', mode: 'organic-voronoi', size: { w: 400, h: 300 }, pois: { count: 6 } });
      expect(serializeSvg(small, THEME_PRESETS[theme]).svg).toMatchSnapshot();
    });
  }
});
