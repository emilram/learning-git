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

## Estado por bloque

| Bloque | Estado | Notas |
|--------|--------|-------|
| 1 Arquitectura | ✅ | `docs/ARCHITECTURE.md`, `types.ts`, `params.ts` |
| 2 Core | ✅ | PRNG sfc32, campo tensorial + RK4 + Jobard-Lefer, 6 modos, limpieza, caras, inset, lotes OBB/skeleton, uso de suelo, POIs, nombres, etiquetas, SVG 2D y **vista 3D isométrica** (`serializeIsoSvg`). 60 tests. |
| 3 Temas y boceto | ◐ | 5 presets OKLCH en 3 capas, rough.js y filtro SVG ya funcionan; faltan ejemplos SVG y medición de coste. |
| 4 Adaptador Vue | ◐ | `CitySketch` y `useCityModel` (hilo principal). Faltan capas separadas, zoom, hit-test quadtree, binding de métricas, worker. |
| 5 Playground y plantillas | ◐ | Playground básico con sliders desde `PARAM_SPECS`. Falta editor completo, arrastre de tiendas y JSON Schema. |
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
