# city-sketch v5 — Diseño: color realista, utilidades y dashboard ejecutivo

Fecha: 2026-09-25. Estado: aprobado por instrucción permanente del usuario ("no pares a preguntar").

## 1. Objetivo

Elevar el asset a calidad de producto: (a) colores creíbles basados en materiales reales, validados para daltonismo; (b) más tipologías de edificio y entorno en la vista 3D; (c) una capa de utilidades de análisis reutilizable (core, sin Vue); (d) composables Vue que empaqueten cámara, selección, tour y hora del día; (e) un dashboard de demostración con dirección de diseño explícita.

Fuera de alcance: datos reales, editor de arrastre (bloque 5), optimización del modo tensorial (bloque 6).

## 2. Color

### 2.1 Materiales (OKLCH)

Cada tema "ciudad" define primitivos con nombre de material. Valores de referencia medidos sobre fotografía aérea y ajustados a OKLCH para que la luminosidad sea perceptual:

| Material | Día | Atardecer | Noche |
|---|---|---|---|
| asfalto avenida | L46 C0.012 H255 | L30 C0.03 H290 | L22 C0.02 H265 |
| asfalto calle | L52 C0.012 H255 | L34 C0.03 H290 | L26 C0.02 H265 |
| acera | L80 C0.02 H85 | L46 C0.05 H290 | L38 C0.02 H270 |
| suelo (arena/tierra) | L86 C0.035 H80 | L34 C0.05 H290 | L20 C0.015 H265 |
| retail (manzana) | L82 C0.06 H60 | L44 C0.06 H300 | L28 C0.02 H270 |
| residencial | L84 C0.045 H75 | L38 C0.05 H285 | L24 C0.015 H265 |
| parque | L68 C0.12 H140 | L40 C0.08 H150 | L30 C0.05 H150 |
| agua | L66 C0.10 H220 | L34 C0.09 H250 | L26 C0.06 H245 |
| plaza | L83 C0.06 H60 | L44 C0.06 H300 | L30 C0.02 H80 |

Fachadas (8–10 por tema): arena, terracota, ladrillo, estuco blanco cálido, gris hormigón, vidrio azulado (torres), verde salvia, ocre. En noche las fachadas bajan a L28–40 y las ventanas encendidas (L88 C0.12 H85) llevan la escena.

Decisión: no existe un tema "blanco"; `minimal-mono` se conserva para heatmaps pero el dashboard ya no lo usa como principal.

### 2.2 Paletas de datos (validadas)

Ejecutado `validate_palette.js` (skill dataviz) sobre las superficies reales de los temas:

- Categórica 6 (claro, superficie arena `#e8dcc7`): `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #4a3aa7` → PASS (contraste WARN en 3 → obligatorio etiqueta directa + tabla accesible, que la card ya emite).
- Categórica 6 (oscuro): `#3987e5 #d95926 #199e70 #c98500 #d55181 #9085e9` → PASS.
- Estado claro (ok/warn/alert): `#0f8a6c #c47a00 #d6336c` → PASS (todas las comprobaciones).
- Estado oscuro: `#2aa88a #bd8a12 #dc5278` → PASS (todas).

Los estados nunca van solo por color: el anillo del marcador lleva **forma** (ok = anillo continuo, warn = anillo discontinuo, alert = anillo doble con pulso) y la leyenda lo replica.

Los temas exponen `theme.data = { categorical, sequentialHue, divergingHues, status }` y `themeVariables` emite `--cs-data-cat-1..6`, `--cs-status-ok|warn|alert`. `useStoreBinding` toma los colores de estado de esas variables en lugar de constantes.

## 3. Vista 3D: tipologías

Por lote se elige una tipología determinista (`createRng(seed, 'h:'+lot.id)`):

| Tipología | Condición | Rasgos |
|---|---|---|
| casa con tejado a dos aguas | residencial, densidad < 0.45, huella cuadrilátera, área < 260 | altura 6–11, cumbrera sobre el lado largo, dos faldones con luz distinta |
| bloque residencial | residencial, resto | plantas, balcones (repisas cada 2 plantas en fachadas iluminadas) |
| comercial bajo | retail, densidad < 0.5 | 1–2 plantas, toldo, escaparate, rótulo |
| torre | densidad > 0.6 y área > 200, prob. 0.12 | 8–16 plantas, fachada vidrio (paleta `glass`), cornisa, antena si hito |
| tienda (POI) | lote con POI | altura por datos, escaparate, toldo, pin |

Entorno nuevo: farolas en avenidas (encendidas de noche, halo), fuente en plazas > 400 u², caminos en parques (polilínea entre dos vértices con más distancia), coches con faros de noche.

Todo cabe en `iso.ts` como funciones `renderGableHouse`, `renderTower`... El coste objetivo se mantiene: ≤ 800 KB en `high` para 500 calles.

## 4. Utilidades de análisis (core, `src/core/analysis/stats.ts`)

```ts
cityStats(model): { streets, avenues, blocks, lots, pois, area, landUse: Record<LandUse, number>, density: number }
districtSummary(model, data?): DistrictRow[]   // tiendas, ventas agregadas, uso dominante
storesWithin(model, center, radius): Poi[]
nearestStores(model, poi, k): { poi, distance }[]
routeBetween(model, a: Vec2, b: Vec2): { polyline, length } | null   // Dijkstra sobre calles
cannibalization(model, bands: IsochroneBand[]): Pair[]   // solapamiento de áreas (%), pares ordenados
coverageGaps(model, pois, radius): { point, blockId, score }[]   // candidatos a nueva tienda (lotes retail/residencial lejos de toda cobertura, ponderados por densidad)
```

Determinismo: todo es función pura del modelo; `coverageGaps` usa la rejilla de bloques, no aleatoriedad.

## 5. Composables Vue

- `useCityCamera(sketchRef)`: presets (`bird`, `street`, `north`, `hero`), `orbitTo`, `autoRotate(speed)` con rAF y respeto a `prefers-reduced-motion`.
- `useStoreSelection(model)`: `selected` (Set), `mode: 'single'|'multi'`, `toggle`, `selectWithin(center, r)`, `selectByFilter(pred)`, `primary`.
- `useTour(steps, opts)`: `start/stop/next/prev`, `index`, `progress`; cada paso puede fijar selección, vista y cámara.
- `useTimeOfDay()`: `phase: 'day'|'dusk'|'night'`, `theme` computado y crossfade CSS (`transition: filter/opacity`) en la card.

## 6. Dashboard (frontend-design, ancla **Organic**)

Pareja inesperada: un terminal de datos ejecutivo en registro orgánico. Superficie arena `#E8DCC7` con paneles salvia/arcilla, tipografía Fraunces (display) + Epilogue (cuerpo), radios 20–28 px, grano SVG al 2 %, transiciones 350 ms. Diferenciador: la **ciudad respira** — al pasar de día a noche la card hace crossfade y las ventanas se encienden en oleada.

Cards: ventas (principal 2D/3D), cobertura y huecos (mapa con candidatos), canibalización (pares con % de solapamiento), rutas (selección múltiple → ruta más corta sobre la ciudad), conversión (heatmap), comparación de periodos, detalle.

Contenido: sólo métricas simuladas etiquetadas como tales en la cabecera; copia estándar para acciones (Exportar, Restablecer, Tour).

## 7. Pruebas

- Snapshots iso para `city-day`, `city-dusk`, `city-night`.
- `stats.test.ts`: cityStats suma de áreas = área del lienzo ± agua; routeBetween simétrica; coverageGaps no devuelve puntos dentro de cobertura; cannibalization en [0, 1].
- Validación de paletas: test que comprueba L/C de `theme.data.status` dentro de banda (misma fórmula que el validador, sin dependencias).
