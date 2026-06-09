# Ghost Hunters: Reversed — Integración de GLB de entorno + personajes animados

> Diseño validado. 8 jun 2026. Enfoque elegido: **A — hornear el GLB a un grid de ocupación** y reutilizar la lógica de juego existente.

## Objetivo

Sustituir el mundo procedural y los investigadores en sprites por **assets 3D reales** ya presentes en `assets/models/`:

- **Entorno:** `assets/models/model-enviroment/source/backrooms.glb` pasa a **ser el nivel**.
- **Investigadores:** modelos animados del pack Quaternius *Ultimate Animated Character* (CC0) en `assets/models/characters/*.glb`.

Decisiones tomadas en brainstorming:
1. El GLB de entorno **es el nivel** (no decorado).
2. **Un solo piso** — se elimina el sistema de 2 pisos + escaleras.
3. Colisión + IA mediante **Enfoque A**: se hornea un grid de ocupación desde la malla del GLB y se reutiliza toda la lógica actual (colisión por celdas, BFS, estaciones, minimapa, cacería, victoria/derrota).

## Hechos de los assets (medidos)

- **`backrooms.glb`** (~9.8 MB): sala/hall cuadrada de ≈**377×377** unidades nativas, techo a ≈**8.6**, **un solo piso**. Caja-cáscara exterior + módulos internos (`Cube.00X`) que subdividen el espacio. Sin animaciones. Materiales: `Material.001`, `Material.005`, `Material`, `wood`. Escala grande respecto a los personajes → requiere reconciliación de escala al cargar.
- **Personajes** (~1.3–2 MB c/u, 11 modelos): rigged, **24 animaciones** por modelo con nombres `CharacterArmature|<Anim>`. Las relevantes: `Idle`, `Walk`, `Run`, `Interact`, `Death`, `HitRecieve`. Mallas múltiples por personaje (cuerpo/cabeza/etc.) bajo un mismo `CharacterArmature`.

## Arquitectura

El cambio es de **render + origen de datos del nivel**, no de la lógica de juego. La lógica de gameplay (estados de IA, estaciones, cacería, HUD, minimapa, condiciones de fin) permanece. Lo que cambia:

1. **Carga asíncrona de GLB** (nuevo módulo de carga).
2. **Entorno**: el `MAP` deja de venir de `genBackrooms()` y pasa a venir del **horneado del GLB**. El render procedural de muros/suelos/techo/escaleras se elimina; se dibuja el GLB.
3. **Investigadores**: el `THREE.Sprite` se sustituye por un grupo con `SkinnedMesh` + `AnimationMixer`. La estructura `hunters[i]` y su actualización lógica se conservan.
4. **Single-floor**: se elimina `MAP1`, `carveStairs`, hueco, escaleras, paneles del piso 1, árboles, `groundHeight` por escalera, `currentFloor` dinámico y el cambio de atmósfera por piso.

### Componentes (unidades con un propósito claro)

| Componente | Qué hace | Depende de |
|---|---|---|
| **AssetLoader** | Carga `backrooms.glb` + 3 personajes elegidos; expone promesas y progreso para la pantalla de carga. | `GLTFLoader` |
| **EnvBuilder** | Escala/centra el GLB, lo añade a la escena, calcula su huella y altura. | GLB de entorno |
| **GridBaker** | Proyecta un grid sobre la huella y, por raycast vertical, marca cada celda muro/libre → produce `MAP`. | EnvBuilder, `THREE.Raycaster` |
| **HunterModel** | Envuelve un GLB de personaje: escala, mixer, mapa de clips, API `setState(state)` y `update(dt, dir)`. | GLB de personaje |
| **Lógica de juego (existente)** | IA/BFS, estaciones, cacería, HUD, minimapa, fin. **Sin cambios de lógica**, solo se le inyecta el `MAP` horneado y se le conectan los `HunterModel`. | `MAP`, `hunters[]` |

## Detalle por sección

### 1. Carga de assets

- Ampliar el `importmap` de `index.html`:
  ```json
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
  ```
- `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'`.
- La pantalla de inicio espera a que carguen `backrooms.glb` + los **3** modelos de investigador de la partida. El botón **JUGAR** muestra "Cargando…" (con % simple) hasta que las promesas resuelven; entonces se habilita.
- Manejo de error: si el GLB de entorno falla, fallback al generador procedural (red de seguridad mínima) y log visible.

### 2. Entorno = el GLB

- Cargar `backrooms.glb` una vez.
- **Escala**: `envScale = TARGET_CEIL / 8.6` con `TARGET_CEIL ≈ 2.7` (constante tuneable). Resultado: huella ≈120 u. Reposicionar para que el **suelo quede en `y=0`** y centrar en XZ a coordenadas positivas (compatibles con el grid, que indexa desde 0).
- Eliminar del render: `buildWalls`, `floor0`, `floorWithHole`, `ceil1`, paneles (`panelMat`, `panelMat1`), peldaños de escalera, árboles. Eliminar `MAP1`, `carveStairs`, `inShaftCell`, lógica de hueco/escalera.
- Iluminación: `AmbientLight` cálido + 1–2 luces (p. ej. `HemisphereLight` o un `PointLight` de relleno). Conservar `FogExp2` cálido. El `aura` (PointLight morado del fantasma) se mantiene.

### 3. Horneado del grid (GridBaker)

- Entrada: huella del suelo del GLB ya escalado (xmin..xmax, zmin..zmax) y altura de techo.
- `CELL = 3` (reutiliza el valor actual). `COLS = ceil(anchoX/CELL)`, `ROWS = ceil(anchoZ/CELL)`.
- Para cada celda `(i,j)`: centro mundial `(i*CELL, j*CELL)`. Lanzar **raycast vertical hacia abajo** desde `y = techo+2` (con 1 muestra central + algún jitter):
  - Primer impacto cerca del techo (`hit.y > UMBRAL_MURO`, p. ej. > 60 % de la altura) → **muro (`1`)**.
  - Impacto cerca del suelo (`hit.y ≈ 0`) → **libre (`0`)**.
  - Sin impacto (fuera de la huella) → **muro (`1`)**.
- Forzar bordes a muro. El resultado es `MAP` (array `ROWS×COLS` de 0/1), **misma forma** que el actual.
- `floodReachable(spawn)` define la región conexa; `spreadCells` coloca estaciones y spawns de investigadores dentro de ella (igual que hoy). Si la región conexa es demasiado pequeña, bajar `UMBRAL_MURO`/`CELL` (tuneables).
- Spawn del jugador: una celda libre de la región conexa (p. ej. cercana a una esquina).

### 4. Investigadores animados (HunterModel)

- Asignar **3 modelos distintos** al azar de los 11 por partida.
- Cargar con `GLTFLoader`; clonar con `SkeletonUtils.clone` si se reutiliza un modelo. Escalar a **altura ≈1.8 u** midiendo su bounding box. `AnimationMixer` por instancia; indexar clips por sufijo (`|Idle`, `|Walk`, `|Run`, `|Interact`, `|Death`).
- La estructura `hunters[i]` (`pos`, `next`, `working`, `alive`, `flee`) y `updateHunter()` **no cambian** en su lógica. Añadidos:
  - El grupo del modelo sigue `h.pos`; `model.rotation.y` apunta a la dirección de avance (suavizado).
  - **Máquina de estados de animación** derivada del estado existente:

    | Condición (ya calculada en la lógica) | Clip |
    |---|---|
    | Avanzando hacia estación (`stepToward` con velocidad normal) | `Walk` |
    | `flee > 0` o `hunting` (huyendo a `HUNTER_FLEE_SPEED`) | `Run` |
    | Trabajando (`working >= 0`, en la estación) | `Interact` (loop) |
    | Sin objetivo / parado | `Idle` |
    | `killHunter()` | `Death` (una vez, `clampWhenFinished`; el cuerpo permanece) |

  - Transición con `crossFadeTo` corto.
- **Visión espectral en cacería**: en lugar del brillo del sprite, durante `hunt.active > 0` cada material del modelo recibe `emissive` elevado + `depthTest = false` (y `renderOrder` alto) para que el fantasma los vea **a través de los muros**. Al terminar la cacería se restauran.
- `makeHumanTexture`/sprites y `ACCENTS` se eliminan.

### 5. Atmósfera / cacería

- Se conserva: cada ~`HUNT_EVERY` s la cacería dura ~`HUNT_DUR` s, **mata las luces** (`ambient.intensity → ~0`), los investigadores quedan a oscuras y el fantasma los ve glow a través de muros y puede matar dentro de `KILL_RANGE`.
- `applyAtmosphere()` se simplifica: sin ramas por piso (`red`/amarillo), solo "iluminado" vs "cacería".

### 6. Limpieza de código

Se eliminan o simplifican en `js/main.js`: `genBackrooms` (queda solo como fallback), `MAP1`, `carveStairs`, `inShaftCell`, `floorWithHole`, geometría de escaleras, `makeTree`, paneles por piso, `makeHumanTexture`, `ACCENTS`, `groundHeight` por escalera, `currentFloor` dinámico. El archivo `main.js` ya es grande y monolítico; al integrar GLB conviene **extraer** la carga/entorno/personajes a módulos pequeños (`assets.js`, `env.js`, `hunters.js`) importados por `main.js`, manteniendo `main.js` como orquestador. (Refactor acotado al trabajo en curso, no rediseño general.)

## Constantes tuneables (nuevas)

- `TARGET_CEIL` (≈2.7): altura de techo objetivo tras escalar el GLB.
- `WALL_RAY_THRESHOLD` (≈0.6·techo): por encima → celda muro.
- `CHAR_HEIGHT` (≈1.8): altura objetivo de los personajes.
- `CELL` (=3, reutilizada): tamaño de celda del grid horneado.

## Riesgos y mitigaciones

- **Interior muy abierto** → el "laberinto" será una sala grande; sigue jugable (la IA deambula). Mitigación: ajustar `CELL`/umbral.
- **Muros internos que no llegan al techo** → el raycast los marca libres (atravesables). Aceptable para prototipo; mitigación: bajar `WALL_RAY_THRESHOLD` o muestrear a media altura.
- **Escala personaje/entorno** → se resuelve midiendo bounding boxes en runtime, no a ojo.
- **Coste de carga** (~9.8 MB entorno + ~3×1.5 MB) → pantalla de carga; aceptable para itch.io.

## Verificación (manual, servidor local)

1. `python -m http.server 8080` → abrir, ver "Cargando…" → **JUGAR** habilitado al terminar.
2. El GLB se ve como nivel; el jugador camina **sin atravesar muros** y sin caer.
3. Los 3 investigadores aparecen como modelos distintos, **caminan** hacia estaciones, hacen `Interact` al trabajar, `Run` al huir/cacería, `Death` al morir.
4. La cacería **oscurece** y los investigadores **se ven glow a través de los muros**; matarlos dentro de rango funciona.
5. Minimapa coherente con la forma del nivel horneado; estaciones y fantasma posicionados.
6. Sin errores en consola; FPS estable.

## Fuera de alcance (futuras iteraciones)

- Segundo piso / verticalidad con el GLB.
- Kit completo de habilidades (Frío, Temblor).
- Modelo 3D para el fantasma (sigue en 1ª persona/cámara).
- Audio nuevo más allá del existente.

## Créditos a registrar en README

- Entorno: `backrooms.glb` descargado de **Sketchfab** — registrar autor/URL y verificar que la licencia del modelo concreto sea CC0/CC-BY antes de publicar en itch.io.
- Personajes: **Quaternius — Ultimate Animated Character Pack (CC0)**, quaternius.com.
