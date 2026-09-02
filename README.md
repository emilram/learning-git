# @empresa/city-sketch

Motor **100 % sintético** y determinista de croquis de ciudad (calles, manzanas, lotes, tiendas) con serializador SVG y adaptador Vue 3. Sin datos geográficos reales.

```
docs/ARCHITECTURE.md        decisiones, diagramas, contrato de tipos, tabla de parámetros
packages/city-sketch/       core (framework-agnostic) + theme + vue
apps/playground/            demo Vue con sliders, temas y exportación SVG
```

## Uso rápido

```bash
npm install
npm run dev          # playground en http://127.0.0.1:5173
npm test             # vitest: invariantes, determinismo y snapshots SVG
npm run typecheck    # vue-tsc estricto
```

```ts
import { generateCity, serializeSvg } from '@empresa/city-sketch';
import { THEME_PRESETS } from '@empresa/city-sketch/theme';

const model = generateCity({ seed: 'sucursales-2026', mode: 'tensor', density: 0.6 });
const { svg } = serializeSvg(model, THEME_PRESETS['retail-warm']);
```

```vue
<script setup lang="ts">
import { CitySketch, useCityModel } from '@empresa/city-sketch/vue';
import { THEME_PRESETS } from '@empresa/city-sketch/theme';
const { model } = useCityModel(() => ({ seed: 'demo-1', mode: 'grid-jitter' }));
</script>
<template>
  <CitySketch :model="model" :theme="THEME_PRESETS['dark-ops']" @store:select="onSelect" />
</template>
```

## Vista 3D isométrica

`serializeIsoSvg(model, theme, { rotation, pitch, heightScale, fit, lotHeight })` extruye los lotes como edificios con sombreado por cara (algoritmo del pintor + backface culling), dibuja las tiendas como edificios destacados con pin y etiqueta, y proyecta calles y manzanas al plano. `lotHeight(lot, block, poi)` permite mapear una métrica a altura. En Vue: `<CitySketch view="iso" :iso="{ rotation: 35, pitch: 55, fit: 'cover' }" />`.

## Adaptador Vue (bloque 4)

```vue
<script setup lang="ts">
import { CitySketchCard, useCityModel, useStoreBinding, useUrlState, computeIsochrones } from '@empresa/city-sketch/vue';
import { THEME_PRESETS } from '@empresa/city-sketch/theme';

const { model, generating } = useCityModel(() => ({ seed: 'retail-mx-2026', pois: { count: 40 } })); // Web Worker + caché LRU
const binding = useStoreBinding(() => model.value?.pois ?? [], () => datos, () => ({
  size: { field: 'sales' },                                   // símbolo proporcional (scaleSqrt)
  color: { field: 'margin', scheme: 'diverging' },            // color divergente en OKLCH
  status: { field: 'stock', classify: (v) => (v < 0.15 ? 'alert' : 'ok') }, // anillo de estado
  badge: 'sales',                                             // badge numérico
  height: { field: 'sales', range: [12, 80] },                // altura en la vista 3D
}));
const url = useUrlState({ prefix: 'dash' });                  // ?dash.sel=&dash.f=&dash.z=
</script>
<template>
  <CitySketchCard :model="model" :theme="THEME_PRESETS['retail-warm']" :kpis="kpis" :poi-overrides="binding.overrides.value"
    :badges="binding.badges.value" :legend="binding.legend.value" :selected-id="url.selected.value" :generating="generating"
    @store:select="url.selected.value = $event.id" />
</template>
```

Eventos: `store:hover`, `store:select`, `block:select`, `viewport:change`, `update:view`. Slots: `marker`, `tooltip`, `legend`, `header`, `actions`, `footer`. El zoom usa la rueda con Ctrl/⌘ para no capturar el scroll de la página. Con más de 5 000 elementos las calles y manzanas pasan a Canvas automáticamente (`canvasThreshold`).

## Estado por bloque

| Bloque | Estado | Notas |
|--------|--------|-------|
| 1 Arquitectura | ✅ | `docs/ARCHITECTURE.md`, `types.ts`, `params.ts` |
| 2 Core | ✅ | PRNG sfc32, campo tensorial + RK4 + Jobard-Lefer, 6 modos, limpieza, caras, inset, lotes OBB/skeleton, uso de suelo, POIs, nombres, etiquetas, SVG 2D y **vista 3D isométrica** (`serializeIsoSvg`). 60 tests. |
| 3 Temas y boceto | ◐ | 5 presets OKLCH en 3 capas, rough.js y filtro SVG ya funcionan; faltan ejemplos SVG y medición de coste. |
| 4 Adaptador Vue | ✅ | `CitySketchCard`, `CitySketch`, `CitySketchCompare`, capas `StreetLayer`/`BlockLayer`/`LabelLayer`/`StoreLayer`/`DataOverlayLayer`/`CanvasStreetLayer`; composables `useCityModel` (worker + caché), `useSketchDimensions`, `useZoomPan`, `useHitTest`, `useTooltip`, `useStoreBinding`, `useUrlState`; exportación SVG/PNG; heatmap, isócronas, comparación, animaciones, a11y. Dashboard con 40 tiendas en `apps/playground` (#dashboard). |
| 5 Playground y plantillas | ◐ | Playground con sliders desde `PARAM_SPECS` y vista 2D/3D. Falta arrastre de tiendas, guardado de plantillas y JSON Schema. |
| 6 Guía, benchmarks, limitaciones | ☐ | |

## Rendimiento medido (Node 22, V8, 1200×900, semilla `demo-1`)

| Modo | Generación | Calles | Manzanas | Lotes |
|------|-----------:|-------:|---------:|------:|
| tensor | ~230 ms | 503 | 256 | 551 |
| grid-jitter | ~35 ms | 228 | 114 | 634 |
| organic-voronoi | ~35 ms | 171 | 72 | 710 |
| radial | ~75 ms | 204 | 92 | 586 |
| lsystem | ~25 ms | 56 | 21 | 515 |
| hybrid | ~260 ms | 290 | 128 | 585 |

El modo tensorial aún no cumple el objetivo de 50 ms: el coste está en las cuatro pasadas de trazado (avenidas y calles en ambas familias de eigenvectores). Está previsto reducirlo en el bloque 6 con rejilla de `dtest` más fina y siembra por lotes.
