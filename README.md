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

`serializeIsoSvg(model, theme, options)` proyecta el modelo en 2.5D y extruye los lotes como edificios. Todo es determinista y sale como SVG standalone.

- **Edificios**: sombra proyectada al suelo, iluminación continua por orientación de cada pared, oclusión en la base, líneas de planta, ventanas (encendidas de noche en temas oscuros), escaparate en planta baja de las tiendas, azotea con parapeto y equipos, torres hito en el centro.
- **Entorno**: agua con degradado, olas y orilla; parques con árboles; árboles de alineación en avenidas; pasos de cebra en cruces de avenidas; tráfico; niebla de profundidad; cielo; brújula; nombres de calle y de distrito proyectados.
- **Diversidad**: cada tema define paletas de fachadas, azoteas y toldos (`components.building`); `variety` controla cuánta variación se aplica por lote. Los presets `city-day` (arena, terracota, asfalto) y `city-dusk` (atardecer con ventanas encendidas) están pensados para demos.
- **Datos y selección**: `lotHeight(lot, block, poi)` mapea métricas a altura; `selectedId` + `focus` resaltan una tienda y atenúan las demás; `groundOverlays` dibuja isócronas o zonas en el suelo; `links` traza arcos entre tiendas; `center` sitúa la cámara. En Vue, al seleccionar una tienda la cámara **vuela** hacia ella (`flyTo`) y el dashboard incluye un **tour ejecutivo** que recorre las mejores tiendas.
- **Cámara y detalle**: `rotation`, `pitch`, `fit` (`cover` recorta a la card, `contain` muestra toda la ciudad), `zoom`, `lightAzimuth`, `lightElevation`, `shadows`, `fog`, y `detail` (`high`, `medium`, `low`) para controlar peso y coste.
- **Vue**: `<CitySketch view="iso" />` permite **arrastrar para orbitar** (durante el gesto baja a `detail: 'low'` y recupera el detalle al soltar), hover y click sobre edificios con tooltip, y emite `iso:change` con la cámara resultante. El botón ⟲ de la card restablece la cámara.

- **Tipologías (v5)**: casas con tejado a dos aguas en residencial de baja densidad, bloques con balcones, comercial bajo con toldo, torres de muro cortina (`components.building.glass`) con corona, y tiendas con altura por datos y tamaño por `kind`. Entorno: farolas en avenidas (con halo de noche), faros de coches, fuentes en plazas y caminos en parques. Se controlan con `typologies`, `lamps` y `furniture`. En modo `cover` se recortan las entidades fuera del encuadre.
- **Rutas**: `groundPaths` dibuja polilíneas sobre el suelo (p. ej. la ruta más corta entre dos tiendas de `routeBetween`).

Coste medido (ciudad de 500 calles, 430 edificios visibles, `cover` con zoom 1.35, Node 22): `high` ≈ 90 ms y ≈ 1.3 MB de SVG (las ventanas son ~35 %); `medium` (sin ventanas ni tráfico) ≈ 50 ms y ≈ 0.6 MB; `low` ≈ 30 ms. Para cards pequeñas se recomienda `medium`.

## Color (v5)

Los temas `city-day`, `city-dusk` y `city-night` usan primitivos con nombre de material (asfalto, acera, arena, terracota, agua) en OKLCH y paletas de fachadas, azoteas, toldos y vidrio. Cada tema expone `theme.data`:

- `categorical`: 6 tonos en orden fijo (`--cs-data-cat-1..6`).
- `status`: `ok` / `warn` / `alert` (`--cs-status-*`), que `useStoreBinding` usa para el anillo; el anillo lleva además **forma** (continuo, discontinuo, doble con pulso) para no depender solo del color.

Las paletas se validaron con el validador de seis comprobaciones del skill *dataviz* sobre las superficies reales: categórica clara y oscura, y estado claro `#0f8a6c #c47a00 #d6336c` / oscuro `#2aa88a #bd8a12 #dc5278` pasan banda de luminosidad, croma, separación CVD, umbral de visión normal y contraste. `test/stats.test.ts` comprueba la banda de luminosidad de los estados de cada tema.

## Identidad de tienda (v6)

Las tiendas van en **amarillo con azul** en todos los temas: los marcadores 2D usan `components.poi` (`brand-yellow` / `brand-blue`) y la vista 3D usa `components.store` (`facade`, `band`, `sign`, `signText`, `glass`, `canopy`; variables `--cs-store-*`). El edificio de tienda es un gran almacén de dos o tres plantas con fachada amarilla, zócalo y franja superior azules, escaparate amplio, marquesina en la fachada principal (la más cercana al frente del lote) y **rótulo con el nombre** proyectado sobre el alero. Para otra marca basta con sobrescribir `components.store` y `components.poi` en el tema.

### Clic en tienda en 3D

`IsoOptions.callout` dibuja un **callout desplegable dentro de la escena isométrica** junto al pin seleccionado (título, subtítulo, filas, barra de stock, mini serie y botones). Los botones llevan `data-cs-action` y `<CitySketch>` emite `store:action` con el id del botón (clic o Enter). `groundRings` proyecta círculos de radio en el suelo; `visibleIds` aísla tiendas en 3D (las ocultas se dibujan como edificios corrientes sin pin). La vista 3D es la vista por defecto del dashboard.

### Clic en tienda (dashboard)

Al seleccionar una tienda se despliega un **callout** junto al marcador (ventas, margen, stock y últimos 8 meses) y el panel lateral con: puesto en el ranking, ventas del mes con variación mensual y anual, sparkline de 12 meses con pico marcado, tabla frente a la media del distrito y de la red, barra de stock con estado, y acciones: isócronas, aislar, vecindario, radio, centrar en 3D, orbitar, fijar para comparar (tabla A vs B con deltas y ruta), exportar PNG de la tienda, copiar enlace y rutas a cada vecina.

## Utilidades de análisis (v5)

Funciones puras del core, exportadas también desde `/vue`:

| Función | Devuelve |
|---|---|
| `cityStats(model)` | calles, avenidas, longitud, manzanas, lotes, tiendas, área por uso de suelo, densidad |
| `districtSummary(model, metric?)` | filas por distrito con tiendas y métrica agregada |
| `storesWithin`, `storesInPolygon`, `nearestStores` | búsqueda espacial |
| `routeBetween(model, a, b)` | ruta más corta por la red (Dijkstra con cola binaria), polilínea y calles |
| `cannibalization(bands)` | pares de tiendas con solapamiento de cobertura (área, ratio, polígono) |
| `coverageGaps(model, radius)` | candidatos a nueva tienda fuera de la cobertura, puntuados por distancia y densidad |
| `coveredArea`, `hullOf`, `weightedCenter`, `districtAt`, `blockAt` | apoyo |

Composables Vue: `useCityCamera` (presets `hero`/`bird`/`street`/`north`/`east`, `autoRotate`, `spin`, `flyTo`), `useStoreSelection` (simple/múltiple, radio, polígono, vecindario, predicado), `useTour` (pasos con selección, vista y cámara; progreso), `useTimeOfDay` (fase día/atardecer/noche con tema y luz coherentes; `<CitySketch crossfade>` funde entre temas).

El dashboard de `apps/playground` (#dashboard) muestra todo: hora del día, presets de cámara, selección múltiple con ruta, cobertura con huecos numerados, canibalización, ventas por distrito y tour ejecutivo.

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
| 2 Core | ✅ | PRNG sfc32, campo tensorial + RK4 + Jobard-Lefer, 6 modos, limpieza, caras, inset, lotes OBB/skeleton, uso de suelo, POIs, nombres, etiquetas, calles que respetan el agua, SVG 2D, **vista 3D isométrica** con tipologías y **utilidades de análisis** (`analysis/stats.ts`). 82 tests. |
| 3 Temas y boceto | ◐ | 8 presets OKLCH en 3 capas (incl. `city-day`, `city-dusk` y `city-night` con materiales y paletas de fachadas), paletas de datos validadas (`theme.data`), rough.js y filtro SVG; faltan ejemplos SVG y medición de coste del boceto. |
| 4 Adaptador Vue | ✅ | `CitySketchCard`, `CitySketch`, `CitySketchCompare`, capas `StreetLayer`/`BlockLayer`/`LabelLayer`/`StoreLayer`/`DataOverlayLayer`/`CanvasStreetLayer`; composables `useCityModel` (worker + caché), `useSketchDimensions`, `useZoomPan`, `useHitTest`, `useTooltip`, `useStoreBinding`, `useUrlState`, `useCityCamera`, `useStoreSelection`, `useTour`, `useTimeOfDay`; exportación SVG/PNG; heatmap, isócronas, comparación, animaciones, a11y. Dashboard con 40 tiendas en `apps/playground` (#dashboard). |
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
