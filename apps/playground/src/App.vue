<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { CitySketch, useCityModel } from '@empresa/city-sketch/vue';
import Dashboard from './Dashboard.vue';
import { THEME_PRESETS, resolveTheme } from '@empresa/city-sketch/theme';
import { PARAM_SPECS, serializeSvg, serializeIsoSvg, type GenerationInput, type Poi, type ThemePresetName } from '@empresa/city-sketch';

const page = ref<'playground' | 'dashboard'>(location.hash === '#dashboard' ? 'dashboard' : 'playground');
watch(page, (p) => { location.hash = p === 'dashboard' ? '#dashboard' : ''; });
const seed = ref('demo-1');
const mode = ref<GenerationInput['mode']>('tensor');
const themeName = ref<ThemePresetName>('retail-warm');
const sketchTechnique = ref<'none' | 'rough' | 'filter'>('none');
const sketchIntensity = ref(0.5);
const showLots = ref(true);
const showLabels = ref(true);
const view = ref<'2d' | 'iso'>('2d');
const isoRotation = ref(35);
const isoPitch = ref(55);
const isoHeight = ref(1);
const isoFit = ref<'contain' | 'cover'>('cover');
const isoOptions = computed(() => ({ rotation: isoRotation.value, pitch: isoPitch.value, heightScale: isoHeight.value, fit: isoFit.value, zoom: 1.35 }));

const numeric = reactive<Record<string, number>>({
  density: 0.5,
  curvature: 0.3,
  chaos: 0.25,
  districts: 4,
  'tensor.dominantAngle': 0,
  'tensor.radialCenters': 1,
  'tensor.noiseIntensity': 0.2,
  'landUse.parkRatio': 0.08,
  'landUse.waterRatio': 0.05,
  'pois.count': 24,
  'blockSize.min': 40,
  'blockSize.max': 160,
});
const sliderSpecs = computed(() => PARAM_SPECS.filter((s) => s.path in numeric && (s.kind === 'number' || s.kind === 'integer')));

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

const input = computed<GenerationInput>(() => {
  const out: Record<string, unknown> = { seed: seed.value, mode: mode.value };
  for (const [path, v] of Object.entries(numeric)) setPath(out, path, v);
  return out as unknown as GenerationInput;
});

const { model, lastMs, issues } = useCityModel(input);
const theme = computed(() =>
  resolveTheme({ ...THEME_PRESETS[themeName.value], sketch: { ...THEME_PRESETS[themeName.value].sketch, technique: sketchTechnique.value, intensity: sketchIntensity.value } }),
);

const hovered = shallowRef<Poi | null>(null);
const selected = shallowRef<Poi | null>(null);
const selectedBlock = ref<string | null>(null);

const stats = computed(() => {
  const m = model.value;
  if (!m) return [];
  const t = m.meta.timings ?? {};
  return [
    ['calles', m.streets.length],
    ['manzanas', m.blocks.length],
    ['lotes', m.lots.length],
    ['tiendas', m.pois.length],
    ['etiquetas', m.labels.length],
    ['generación', `${lastMs.value.toFixed(1)} ms`],
    ['trazado', `${(t.trace ?? 0).toFixed(1)} ms`],
  ];
});

function randomSeed(): void {
  seed.value = `city-${Math.random().toString(36).slice(2, 8)}`;
}

function exportSvg(): void {
  if (!model.value) return;
  const { svg } = view.value === 'iso' ? serializeIsoSvg(model.value, theme.value, isoOptions.value) : serializeSvg(model.value, theme.value);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${model.value.seed}-${theme.value.name}.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
}

watch(mode, () => {
  selected.value = null;
  selectedBlock.value = null;
});
</script>

<template>
  <nav class="pg-nav">
    <strong>city-sketch</strong>
    <button type="button" :class="{ on: page === 'playground' }" @click="page = 'playground'">Playground</button>
    <button type="button" :class="{ on: page === 'dashboard' }" @click="page = 'dashboard'">Dashboard</button>
  </nav>
  <Dashboard v-if="page === 'dashboard'" />
  <div v-else class="pg" :data-scheme="theme.scheme">
    <aside class="pg-panel">
      <h1>Playground</h1>
      <p class="pg-sub">Motor sintético · bloques 2 a 4</p>

      <label class="pg-field">
        <span>Semilla</span>
        <div class="pg-row">
          <input v-model="seed" type="text" spellcheck="false" />
          <button type="button" @click="randomSeed">⟳</button>
        </div>
      </label>

      <label class="pg-field">
        <span>Modo</span>
        <select v-model="mode">
          <option value="tensor">tensor (Chen 2008)</option>
          <option value="grid-jitter">grid-jitter</option>
          <option value="organic-voronoi">organic-voronoi</option>
          <option value="radial">radial</option>
          <option value="lsystem">lsystem</option>
          <option value="hybrid">hybrid</option>
        </select>
      </label>

      <div class="pg-field">
        <span>Vista</span>
        <div class="pg-row pg-seg">
          <button type="button" :class="{ on: view === '2d' }" @click="view = '2d'">2D croquis</button>
          <button type="button" :class="{ on: view === 'iso' }" @click="view = 'iso'">3D isométrica</button>
        </div>
      </div>
      <template v-if="view === 'iso'">
        <label class="pg-field pg-slider"><span>Rotación <b>{{ isoRotation }}°</b></span><input v-model.number="isoRotation" type="range" min="0" max="360" step="1" /></label>
        <label class="pg-field pg-slider"><span>Inclinación <b>{{ isoPitch }}°</b></span><input v-model.number="isoPitch" type="range" min="20" max="89" step="1" /></label>
        <label class="pg-field pg-slider"><span>Altura <b>{{ isoHeight }}</b></span><input v-model.number="isoHeight" type="range" min="0.2" max="3" step="0.1" /></label>
        <label class="pg-field"><span>Encuadre</span><select v-model="isoFit"><option value="cover">cover (recorte)</option><option value="contain">contain (todo)</option></select></label>
      </template>

      <label class="pg-field">
        <span>Tema</span>
        <select v-model="themeName">
          <option v-for="name in Object.keys(THEME_PRESETS)" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>

      <div class="pg-field">
        <span>Boceto</span>
        <div class="pg-row">
          <select v-model="sketchTechnique">
            <option value="none">ninguno</option>
            <option value="rough">rough.js</option>
            <option value="filter">filtro SVG</option>
          </select>
          <input v-model.number="sketchIntensity" type="range" min="0" max="1" step="0.05" :disabled="sketchTechnique === 'none'" />
        </div>
      </div>

      <label v-for="s in sliderSpecs" :key="s.path" class="pg-field pg-slider">
        <span>{{ s.label }} <b>{{ numeric[s.path] }}</b></span>
        <input v-model.number="numeric[s.path]" type="range" :min="s.min" :max="s.max" :step="s.step" :title="s.description" />
      </label>

      <div class="pg-row pg-toggles">
        <label><input v-model="showLots" type="checkbox" /> lotes</label>
        <label><input v-model="showLabels" type="checkbox" /> nombres</label>
      </div>

      <button type="button" class="pg-primary" @click="exportSvg">Exportar SVG</button>

      <dl class="pg-stats">
        <template v-for="[k, v] in stats" :key="k">
          <dt>{{ k }}</dt>
          <dd>{{ v }}</dd>
        </template>
      </dl>
      <ul v-if="issues.length" class="pg-issues">
        <li v-for="i in issues" :key="i.path">{{ i.path }}: {{ i.message }}</li>
      </ul>
    </aside>

    <main class="pg-main">
      <section class="pg-card">
        <header class="pg-card-head">
          <div>
            <strong>{{ seed }}</strong>
            <small> · {{ mode }} · {{ themeName }}</small>
          </div>
          <div class="pg-hover">
            <template v-if="hovered">{{ hovered.label }} <small>({{ hovered.kind }})</small></template>
            <template v-else-if="selected">Seleccionada: {{ selected.label }}</template>
            <template v-else-if="selectedBlock">Manzana {{ selectedBlock }}</template>
            <template v-else>Pasa el cursor por una tienda</template>
          </div>
        </header>
        <CitySketch
          :model="model"
          :theme="theme"
          :show-lots="showLots"
          :show-labels="showLabels"
          :view="view"
          :iso="isoOptions"
          @store:hover="hovered = $event.poi"
          @store:select="selected = $event.poi"
          @block:select="selectedBlock = $event.id"
        />
      </section>
    </main>
  </div>
</template>
