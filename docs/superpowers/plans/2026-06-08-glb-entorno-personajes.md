# Integración GLB (entorno + personajes animados) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el mundo procedural por el nivel `backrooms.glb` (horneando un grid de ocupación desde su malla) y los investigadores en sprites por modelos Quaternius animados, reutilizando toda la lógica de juego existente.

**Architecture:** El GLB de entorno se carga, escala y se hornea a un `MAP` de celdas vía raycast vertical, de modo que la lógica actual (colisión por celdas, BFS, estaciones, minimapa, cacería) sigue intacta. Los investigadores pasan a ser `SkinnedMesh` + `AnimationMixer` que siguen la posición/estado que ya calcula la IA. La lógica pura se extrae a `js/logic.js` (testeable en Node sin three); el resto se reparte en módulos pequeños (`assets.js`, `env.js`, `grid.js`, `hunters.js`) orquestados por `main.js`.

**Tech Stack:** Three.js 0.160 (importmap + CDN, sin build), `GLTFLoader` + `SkeletonUtils` desde `three/addons`. Tests de lógica pura con el runner integrado de Node (`node --test`, v24 disponible). Sin git (prototipo). Verificación de render/integración: manual en navegador con servidor local.

---

## Adaptaciones a la realidad del proyecto (leer antes de empezar)

- **Sin git:** el usuario trabaja sin control de versiones por ahora. Donde el flujo TDD pediría `commit`, aquí hacemos un **checkpoint de verificación** (correr tests Node y/o abrir el navegador y comprobar). No se ejecuta ningún `git`.
- **Tests:** la lógica **pura** (matemática de escala, clasificación de celda, selección de animación, elección de modelos) se prueba con `node --test`. El **render/integración** (que el GLB se vea, colisión, animaciones, oscurecer en cacería) no es unit-testeable sin un harness WebGL headless; se verifica **manualmente en el navegador** con pasos de observación explícitos y logs de depuración objetivos.
- **Servidor local:** `python -m http.server 8080` desde la raíz del proyecto; abrir `http://localhost:8080`.
- **ESM en Node:** se añade un `package.json` mínimo con `{"type":"module"}` para que Node importe los módulos ESM en los tests. El navegador ignora `package.json`; no afecta al juego.

---

## Estructura de archivos

| Archivo | Responsabilidad | Importa three |
|---|---|---|
| `package.json` (nuevo) | `{"private":true,"type":"module"}` — habilita ESM en Node para los tests. | no |
| `index.html` (mod) | Ampliar `importmap` con `three/addons/`. | — |
| `js/logic.js` (nuevo) | **Lógica pura, sin three:** `computeEnvScale`, `classifyCell`, `hunterAnimState`, `pickAnim`, `pickDistinct`. | no |
| `js/assets.js` (nuevo) | Cargar GLBs (`GLTFLoader`), elegir N personajes, progreso de carga. | sí |
| `js/env.js` (nuevo) | Escalar/colocar el GLB de entorno; devolver huella (cols/rows) y `ceilY`. | sí |
| `js/grid.js` (nuevo) | `bakeGrid`: raycast por celda → `MAP` (usa `classifyCell`). | sí |
| `js/hunters.js` (nuevo) | `HunterModel`: envuelve un GLB de personaje (escala, mixer, clips, estados, espectral). | sí |
| `js/main.js` (mod) | Orquestador: preload → colocar env → hornear MAP → construir estaciones/investigadores → loop. Eliminar 2º piso/escaleras/procedural. | sí |
| `test/logic.test.js` (nuevo) | Tests Node de `js/logic.js`. | no |
| `README.md` (mod) | Créditos de assets (Quaternius CC0; entorno Sketchfab). | — |

---

## Task 1: package.json + importmap + smoke test de los GLB

**Files:**
- Create: `package.json`
- Modify: `index.html:11-17` (bloque importmap)
- Create: `test/assets.smoke.test.js`

- [ ] **Step 1: Crear `package.json`**

```json
{
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: Ampliar el importmap en `index.html`**

Reemplazar el bloque `<script type="importmap">…</script>` (líneas 11-17) por:

```html
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
  </script>
```

- [ ] **Step 3: Escribir test smoke que falle (parseo de GLB y assets esperados)**

`test/assets.smoke.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

function glbJson(path) {
  const b = readFileSync(path);
  assert.equal(b.readUInt32LE(0), 0x46546c67, 'magic glTF');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.slice(20, 20 + len).toString('utf8'));
}

test('backrooms env GLB parses and has meshes', () => {
  const p = 'assets/models/model-enviroment/source/backrooms.glb';
  assert.ok(existsSync(p), 'env GLB exists');
  const j = glbJson(p);
  assert.ok(j.meshes.length >= 10, 'has wall/plane meshes');
  assert.equal((j.extensionsRequired || []).length, 0, 'no required compression ext');
});

test('Adventurer character GLB has the animations we map', () => {
  const j = glbJson('assets/models/characters/Adventurer.glb');
  const names = (j.animations || []).map((a) => a.name);
  for (const need of ['Idle', 'Walk', 'Run', 'Interact', 'Death']) {
    assert.ok(names.some((n) => n.endsWith('|' + need)), 'has ' + need);
  }
});
```

- [ ] **Step 4: Correr el test**

Run: `node --test test/assets.smoke.test.js`
Expected: PASS (ambos tests verdes). Si falla `existsSync`, revisar rutas de assets.

- [ ] **Step 5: Checkpoint**

Verificación de assets superada. (Sin git: no se commitea.)

---

## Task 2: Lógica pura en `js/logic.js` (TDD con Node)

**Files:**
- Create: `js/logic.js`
- Create: `test/logic.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

`test/logic.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEnvScale, classifyCell, hunterAnimState, pickAnim, pickDistinct } from '../js/logic.js';

test('computeEnvScale fits ceiling to target', () => {
  // techo nativo 8.6 -> objetivo 2.7
  assert.ok(Math.abs(computeEnvScale(8.6, 2.7) - 0.31395) < 1e-4);
});

test('classifyCell: hit near ceiling is wall, hit near floor is open, no hit is open', () => {
  const ceil = 2.7, thr = 0.6;
  assert.equal(classifyCell(2.6, ceil, thr), 1); // 2.6 > 0.6*2.7=1.62 -> muro
  assert.equal(classifyCell(0.05, ceil, thr), 0); // suelo -> libre
  assert.equal(classifyCell(null, ceil, thr), 0); // sin impacto -> libre
});

test('hunterAnimState maps game state to anim key', () => {
  assert.equal(hunterAnimState({ alive: false }), 'dead');
  assert.equal(hunterAnimState({ alive: true, hunting: true }), 'run');
  assert.equal(hunterAnimState({ alive: true, flee: 1.2 }), 'run');
  assert.equal(hunterAnimState({ alive: true, working: 2 }), 'work');
  assert.equal(hunterAnimState({ alive: true, moving: true }), 'walk');
  assert.equal(hunterAnimState({ alive: true }), 'idle');
});

test('pickAnim returns the Quaternius clip suffix for a state', () => {
  assert.equal(pickAnim('walk'), 'Walk');
  assert.equal(pickAnim('run'), 'Run');
  assert.equal(pickAnim('work'), 'Interact');
  assert.equal(pickAnim('dead'), 'Death');
  assert.equal(pickAnim('idle'), 'Idle');
});

test('pickDistinct returns n unique items', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  let seed = 42;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const got = pickDistinct(pool, 3, rng);
  assert.equal(got.length, 3);
  assert.equal(new Set(got).size, 3);
  got.forEach((g) => assert.ok(pool.includes(g)));
});
```

- [ ] **Step 2: Correr para ver fallar**

Run: `node --test test/logic.test.js`
Expected: FAIL ("Cannot find module '../js/logic.js'" o exports indefinidos).

- [ ] **Step 3: Implementar `js/logic.js`**

```js
// Lógica pura del juego — SIN dependencias de three (testeable en Node).

// Escala para que la altura nativa del techo encaje en la altura objetivo.
export function computeEnvScale(nativeCeilHeight, targetCeil) {
  return targetCeil / nativeCeilHeight;
}

// Clasifica una celda según el impacto del raycast vertical contra los muros.
// hitY = altura del impacto más alto contra geometría de muro, o null si no hubo impacto.
export function classifyCell(hitY, ceilY, threshold) {
  if (hitY == null) return 0;           // sin muro en la columna -> libre
  return hitY > threshold * ceilY ? 1 : 0;
}

// Deriva el estado de animación desde los campos que ya calcula la IA.
export function hunterAnimState(h) {
  if (!h.alive) return 'dead';
  if (h.hunting || (h.flee && h.flee > 0)) return 'run';
  if (h.working != null && h.working >= 0) return 'work';
  if (h.moving) return 'walk';
  return 'idle';
}

// Mapea un estado a la animación Quaternius (sufijo tras "CharacterArmature|").
const ANIM = { walk: 'Walk', run: 'Run', work: 'Interact', dead: 'Death', idle: 'Idle' };
export function pickAnim(state) {
  return ANIM[state] || 'Idle';
}

// Elige n elementos distintos de un array usando rng() en [0,1).
export function pickDistinct(pool, n, rng = Math.random) {
  const copy = pool.slice();
  const out = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(rng() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/logic.test.js`
Expected: PASS (5 tests verdes).

- [ ] **Step 5: Checkpoint**

Lógica pura lista y verificada.

---

## Task 3: Cargador de assets (`js/assets.js`) + puerta de carga

**Files:**
- Create: `js/assets.js`
- Modify: `index.html:29` (texto del botón) y `js/main.js` (preload; ver Task 6 para el wiring final del boot)

- [ ] **Step 1: Implementar `js/assets.js`**

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pickDistinct } from './logic.js';

const loader = new GLTFLoader();

export const ENV_URL = 'assets/models/model-enviroment/source/backrooms.glb';

// Nombres exactos de archivo (con espacios) del pack de personajes.
export const CHARACTER_FILES = [
  'Adventurer', 'Astronaut', 'Beach Character', 'Business Man', 'Casual Character',
  'Farmer', 'Hoodie Character', 'King', 'Punk', 'Swat', 'Worker',
];
const charUrl = (name) => 'assets/models/characters/' + encodeURIComponent(name) + '.glb';

export function loadGLB(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

// Carga el entorno + n personajes distintos. onProgress(fraction 0..1).
export async function loadAllAssets(n, onProgress = () => {}) {
  const chosen = pickDistinct(CHARACTER_FILES, n);
  const jobs = [{ key: 'env', url: ENV_URL }, ...chosen.map((name) => ({ key: name, url: charUrl(name) }))];
  let done = 0;
  const results = {};
  await Promise.all(jobs.map(async (job) => {
    results[job.key] = await loadGLB(job.url);
    done++; onProgress(done / jobs.length);
  }));
  return { env: results.env, chars: chosen.map((name) => ({ name, gltf: results[name] })) };
}
```

- [ ] **Step 2: Ajustar el botón de inicio en `index.html`**

Cambiar la línea 29 del botón:

```html
      <button id="startBtn" disabled>CARGANDO…</button>
```

- [ ] **Step 3: Verificación manual (puente; el boot completo es Task 6)**

Temporalmente, al final de `js/main.js`, antes del wiring definitivo, comprobar la carga en consola:

```js
import { loadAllAssets } from './assets.js';
loadAllAssets(3, (f) => console.log('carga', Math.round(f * 100) + '%'))
  .then((a) => console.log('OK env+chars', a.chars.map((c) => c.name)))
  .catch((e) => console.error('FALLO carga', e));
```

Run: `python -m http.server 8080` → abrir `http://localhost:8080` → consola.
Expected: logs `carga 25% … 100%` y `OK env+chars [3 nombres]` sin errores 404/CORS.

- [ ] **Step 4: Checkpoint**

Carga de assets funcionando. (El bloque temporal del Step 3 se sustituye por el boot definitivo en Task 6.)

---

## Task 4: Colocar el entorno (`js/env.js`) y renderizarlo

**Files:**
- Create: `js/env.js`
- Modify: `js/main.js` (eliminar render procedural de muros/suelos/techo; añadir env)

- [ ] **Step 1: Implementar `js/env.js`**

```js
import * as THREE from 'three';
import { computeEnvScale } from './logic.js';

export const TARGET_CEIL = 2.7; // altura de techo objetivo tras escalar

// Escala/coloca el GLB: techo a ~TARGET_CEIL, suelo en y=0, esquina (xmin,zmin) en el origen.
// Devuelve { root, ceilY, width, depth, wallMeshes }.
export function placeEnv(scene, gltf) {
  const root = gltf.scene;
  // bbox nativa
  let box = new THREE.Box3().setFromObject(root);
  const nativeCeil = box.max.y - box.min.y;        // altura total nativa (incluye cáscara)
  // Usamos la altura del suelo->techo reales: aproximamos con el plano de techo (~maxY de las planas).
  const scale = computeEnvScale(nativeCeilForRoom(root) || nativeCeil, TARGET_CEIL);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  // suelo a y=0 y esquina al origen
  root.position.x += -box.min.x;
  root.position.z += -box.min.z;
  root.position.y += -roomFloorY(root);            // pone el suelo de la sala en 0
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  scene.add(root);

  const ceilY = TARGET_CEIL;
  const wallMeshes = collectWallMeshes(root, ceilY);
  return { root, ceilY, width: box.max.x - box.min.x, depth: box.max.z - box.min.z, wallMeshes };
}

// Altura suelo->techo de la SALA: diferencia entre los dos planos casi-horizontales mayores.
function nativeCeilForRoom(root) {
  const planes = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const h = b.max.y - b.min.y;
    if (h < 0.05 * (b.max.x - b.min.x + 1e-6)) planes.push(b.max.y); // casi plano horizontal
  });
  if (planes.length < 2) return null;
  planes.sort((a, b) => a - b);
  return planes[planes.length - 1] - planes[0];
}
function roomFloorY(root) {
  let minPlane = Infinity;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const h = b.max.y - b.min.y;
    if (h < 0.05 * (b.max.x - b.min.x + 1e-6)) minPlane = Math.min(minPlane, b.min.y);
  });
  return minPlane === Infinity ? 0 : minPlane;
}

// Muros = meshes que NO son las planas (suelo/techo) ni la cáscara (se extiende muy por debajo del suelo).
function collectWallMeshes(root, ceilY) {
  const walls = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const h = b.max.y - b.min.y;
    const flat = h < 0.05 * (b.max.x - b.min.x + 1e-6);   // suelo o techo
    const shell = b.min.y < -0.5 * ceilY;                  // cáscara exterior (baja mucho)
    if (!flat && !shell) walls.push(o);
  });
  return walls;
}
```

- [ ] **Step 2: Eliminar el render procedural de geometría en `js/main.js`**

Quitar (o comentar) en `js/main.js` las construcciones procedurales de mundo: las dos llamadas `buildWalls(...)` (líneas ~176-177), `floor0` (~183-184), `floorWithHole(...)` añadido a la escena (~198), `ceil1` (~200-201), el bloque de **paneles** (~204-210), el bloque de **escaleras** (~212-220) y el bloque de **árboles** (~233-240). Conservar `ambient` y `aura`.

> Nota: NO borrar todavía `genBackrooms`, `MAP`, `ROWS/COLS` ni los helpers — el grid se sustituye en Task 5. Aquí solo se deja de **dibujar** la geometría procedural.

- [ ] **Step 3: Añadir el entorno en el arranque (provisional, se integra en boot en Task 6)**

En `js/main.js`, tras crear `scene`/luces, añadir un import y una función que coloque el env cuando esté cargado:

```js
import { placeEnv } from './env.js';
// usado dentro del boot (Task 6): const envInfo = placeEnv(scene, assets.env);
```

Para esta tarea, verificar con el bloque temporal de carga (Task 3 Step 3) ampliado:

```js
loadAllAssets(3, () => {}).then((a) => { const info = placeEnv(scene, a.env); console.log('ENV', info.width.toFixed(1), 'x', info.depth.toFixed(1), 'ceil', info.ceilY, 'wallMeshes', info.wallMeshes.length); });
```

- [ ] **Step 4: Verificación manual**

Run: `python -m http.server 8080` → abrir.
Expected: se ve el modelo del backrooms en la escena (cámara en el spawn actual). Consola loguea `ENV <ancho> x <fondo> ceil 2.7 wallMeshes N` con N ≥ 10. El suelo del modelo está a la altura de los pies (no flotando ni hundido).

- [ ] **Step 5: Checkpoint**

Entorno visible y correctamente escalado/posicionado.

---

## Task 5: Hornear el grid (`js/grid.js`) — **GATE de derisk**

**Files:**
- Create: `js/grid.js`
- Modify: `js/main.js` (asignar `MAP` desde el horneado en vez de `genBackrooms`)

- [ ] **Step 1: Implementar `js/grid.js`**

```js
import * as THREE from 'three';
import { classifyCell } from './logic.js';

export const WALL_RAY_THRESHOLD = 0.6; // impacto por encima de 0.6*techo => muro

// Hornea un MAP (ROWS x COLS de 0/1) desde la geometría de muros del entorno.
export function bakeGrid(wallMeshes, width, depth, cell, ceilY) {
  const cols = Math.max(3, Math.round(width / cell) + 1);
  const rows = Math.max(3, Math.round(depth / cell) + 1);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  ray.far = ceilY + 2;
  const samples = [[0, 0], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];
  const map = Array.from({ length: rows }, () => new Array(cols).fill(0));
  let walls = 0, open = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) { map[j][i] = 1; walls++; continue; }
    let wallVotes = 0;
    for (const [dx, dz] of samples) {
      const ox = (i + dx) * cell, oz = (j + dz) * cell;
      ray.set(new THREE.Vector3(ox, ceilY + 1, oz), down);
      const hits = ray.intersectObjects(wallMeshes, true);
      const hitY = hits.length ? hits[0].point.y : null;
      wallVotes += classifyCell(hitY, ceilY, WALL_RAY_THRESHOLD);
    }
    map[j][i] = wallVotes >= 3 ? 1 : 0; // mayoría de 5
    map[j][i] ? walls++ : open++;
  }
  return { map, cols, rows, walls, open };
}
```

- [ ] **Step 2: Reemplazar el origen de `MAP` en `js/main.js`**

Cambiar las declaraciones procedurales del mapa (líneas ~75-78):

```js
const MAP = genBackrooms(GRID);   // piso 0
const MAP1 = genBackrooms(GRID);  // piso 1
carveStairs(MAP, MAP1);
const ROWS = MAP.length, COLS = MAP[0].length;
```

por declaraciones mutables que se rellenan tras hornear:

```js
let MAP = genBackrooms(GRID);     // fallback; se sustituye por el horneado del GLB en boot()
let ROWS = MAP.length, COLS = MAP[0].length;
// MAP1/carveStairs eliminados: un solo piso.
```

(Los helpers `isWall`, `collides`, `key`, etc. ya leen `MAP/ROWS/COLS` en tiempo de llamada; al ser `let`, tomarán el valor horneado.)

- [ ] **Step 3: Hornear dentro del flujo de carga (provisional) y loguear el GATE**

Ampliar el bloque temporal:

```js
import { bakeGrid } from './grid.js';
loadAllAssets(3, () => {}).then((a) => {
  const info = placeEnv(scene, a.env);
  const baked = bakeGrid(info.wallMeshes, info.width, info.depth, CELL, info.ceilY);
  MAP = baked.map; ROWS = baked.rows; COLS = baked.cols;
  const REACH = floodReachable(1, 1);
  console.log('BAKE', 'cols', baked.cols, 'rows', baked.rows, 'walls', baked.walls, 'open', baked.open, 'reachable', REACH.list.length);
});
```

- [ ] **Step 4: GATE de verificación (decisión de seguir/parar)**

Run: `python -m http.server 8080` → abrir → consola.
Expected — el log `BAKE` debe mostrar una mezcla **sana**:
- `open` y `reachable` claramente > 0 y mucho menor que el total de celdas (hay muros).
- `reachable` representa una zona transitable plausible (decenas/cientos de celdas, no 0 ni el 100%).

**Si `reachable` ≈ 0** (todo muro) **o** `walls` ≈ 0 (todo abierto): el modelo no subdivide como se asume. **Parar y reevaluar** antes de seguir — opciones: bajar `WALL_RAY_THRESHOLD`, reducir `CELL` (p. ej. 2), o muestrear a media altura. No continuar a Task 6+ hasta tener un MAP transitable.

- [ ] **Step 5: Checkpoint**

`MAP` horneado y transitable confirmado por el GATE.

---

## Task 6: Boot async single-floor (`js/main.js`) — wiring del mundo

**Files:**
- Modify: `js/main.js` (reestructurar init a `boot()` async; eliminar 2º piso/escaleras; spawn desde región conexa)

- [ ] **Step 1: Eliminar el sistema de 2 pisos y escaleras en `js/main.js`**

Quitar: constantes `FLOOR_H` usadas para piso 1 (mantener una constante de altura si hace falta para `aura`, pero ya no hay piso 1), `SX/SZ0/SZ1`, `carveStairs`, `inShaftCell`, `floorWithHole`, `genBackrooms`→(dejar solo como fallback ya en Task 5). Simplificar:

```js
// groundHeight: un solo piso -> siempre 0.
function groundHeight() { return 0; }
```

Y en `collidesPlayer`, eliminar la rama de `MAP1`/`inShaftCell`:

```js
function collidesPlayer(x, z) {
  const r = PLAYER_R;
  const c = [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]];
  for (const [px, pz] of c) {
    const gx = Math.round(px / CELL), gz = Math.round(pz / CELL);
    if (gx < 0 || gz < 0 || gx >= COLS || gz >= ROWS) return true;
    if (MAP[gz][gx] === 1) return true;
  }
  return false;
}
```

En `moveGhost`, fijar piso 0:

```js
  const h = groundHeight();
  currentFloor = 0;
  pos.y = h + EYE; camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0);
  aura.position.set(pos.x, h + EYE, pos.z);
```

- [ ] **Step 2: Convertir el init síncrono en `boot()` async**

Reemplazar el final del archivo (líneas ~493 `makeStations(); makeHunters(); requestAnimationFrame(loop);`) y el bloque temporal de carga por un arranque ordenado. `REACH`, estaciones e investigadores se construyen **después** de hornear:

```js
import { loadAllAssets } from './assets.js';
import { placeEnv } from './env.js';
import { bakeGrid } from './grid.js';

let REACH; // se asigna en boot()

async function boot() {
  const startBtn = document.getElementById('startBtn');
  const assets = await loadAllAssets(NUM_HUNTERS, (f) => { startBtn.textContent = 'CARGANDO… ' + Math.round(f * 100) + '%'; });
  const info = placeEnv(scene, assets.env);
  const baked = bakeGrid(info.wallMeshes, info.width, info.depth, CELL, info.ceilY);
  MAP = baked.map; ROWS = baked.rows; COLS = baked.cols;
  REACH = floodReachable(1, 1);
  // spawn del jugador en la primera celda transitable
  const [sgx, sgz] = REACH.list[0];
  pos.set(sgx * CELL, EYE, sgz * CELL);

  rebuildMinimap();          // ver Task 6 Step 4
  makeStations();
  makeHunters(assets.chars); // ver Task 7/8 (firma nueva)
  startBtn.textContent = 'CLICK PARA JUGAR';
  startBtn.disabled = false;
  requestAnimationFrame(loop);
}
boot();
```

> `REACH` deja de ser `const` global (línea ~115 `const REACH = floodReachable(1,1);` se elimina; pasa a `let REACH` asignado en boot). `farthestCell`, `spreadCells` y demás ya lo leen en tiempo de llamada.

- [ ] **Step 3: `floodReachable(1,1)` puede no ser transitable — usar primera celda abierta**

Sustituir el spawn fijo `(1,1)` por la primera celda abierta hallada, y usarla como semilla del flood:

```js
function firstOpenCell() {
  for (let j = 1; j < ROWS - 1; j++) for (let i = 1; i < COLS - 1; i++) if (MAP[j][i] === 0) return [i, j];
  return [1, 1];
}
```

y en `boot()`: `const [ox, oz] = firstOpenCell(); REACH = floodReachable(ox, oz); pos.set(ox * CELL, EYE, oz * CELL);`

- [ ] **Step 4: Quitar `inShaftCell` del filtro de `makeStations`**

`makeStations` filtra spawns con `(x, z) => (x <= 5 && z <= 7) || inShaftCell(x, z)`. Como `inShaftCell` se elimina (single-floor), dejarlo en:

```js
const cells = spreadCells(NUM_STATIONS + 1, (x, z) => (x <= 5 && z <= 7)).slice(1, NUM_STATIONS + 1);
```

- [ ] **Step 5: Reconstruir el minimapa tras hornear**

El minimapa actual construye `maze0/maze1` a nivel de módulo (líneas ~438) con el MAP procedural. Envolver en función y llamarla en boot:

```js
let maze0;
function rebuildMinimap() { maze0 = buildMaze(MAP, '#6b5a1f'); }
```

y en `drawMinimap`, usar siempre `maze0` (un solo piso): `mmCtx.drawImage(maze0, 0, 0);` y eliminar referencias a `maze1`/`currentFloor` en el minimapa.

- [ ] **Step 6: Verificación manual**

Run: `python -m http.server 8080` → abrir → esperar "CLICK PARA JUGAR" → jugar.
Expected: apareces dentro del modelo; **WASD camina sin atravesar muros** ni caer; el minimapa refleja la forma del nivel horneado; sin errores en consola.

- [ ] **Step 7: Checkpoint**

Mundo GLB jugable en un solo piso, colisión OK.

---

## Task 7: `HunterModel` (envoltorio de personaje animado)

**Files:**
- Create: `js/hunters.js`

- [ ] **Step 1: Implementar `js/hunters.js`**

```js
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { hunterAnimState, pickAnim } from './logic.js';

export const CHAR_HEIGHT = 1.8; // altura objetivo del personaje en unidades de mundo

export class HunterModel {
  constructor(gltf) {
    this.root = cloneSkinned(gltf.scene);
    // escalar a CHAR_HEIGHT
    const box = new THREE.Box3().setFromObject(this.root);
    const h = box.max.y - box.min.y || 1;
    this.root.scale.setScalar(CHAR_HEIGHT / h);
    this.root.updateMatrixWorld(true);
    // mixer + clips indexados por sufijo
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const clip of gltf.animations) {
      const suffix = clip.name.split('|').pop();
      this.actions[suffix] = this.mixer.clipAction(clip);
    }
    this.current = null;
    this._yaw = 0;
    this._origMats = [];
    this.root.traverse((o) => { if (o.isMesh) this._origMats.push([o, o.material]); });
    this.play('Idle');
  }

  play(clipName, opts = {}) {
    if (this.current === clipName) return;
    const next = this.actions[clipName];
    if (!next) return;
    next.reset();
    if (clipName === 'Death') { next.setLoop(THREE.LoopOnce); next.clampWhenFinished = true; }
    else next.setLoop(THREE.LoopRepeat);
    if (this.actions[this.current]) this.actions[this.current].crossFadeTo(next, 0.2, false);
    next.play();
    this.current = clipName;
  }

  // estado del juego -> animación
  setState(stateFields) { this.play(pickAnim(hunterAnimState(stateFields))); }

  // orientar hacia (dx,dz) suavizado
  faceDir(dx, dz) {
    if (dx === 0 && dz === 0) return;
    const target = Math.atan2(dx, dz);
    let d = target - this._yaw;
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    this._yaw += d * 0.25;
    this.root.rotation.y = this._yaw;
  }

  setPos(x, y, z) { this.root.position.set(x, y, z); }

  // visión espectral: glow + visible a través de muros
  setSpectral(on) {
    for (const [mesh, orig] of this._origMats) {
      if (on) {
        mesh.material = orig.clone();
        mesh.material.emissive = new THREE.Color(0x66ccff);
        mesh.material.emissiveIntensity = 1.2;
        mesh.material.depthTest = false;
        mesh.renderOrder = 999;
      } else {
        mesh.material = orig; mesh.renderOrder = 0;
      }
    }
  }

  update(dt) { this.mixer.update(dt); }
  dispose(scene) { scene.remove(this.root); }
}
```

- [ ] **Step 2: Verificación (indirecta, vía Task 2)**

`hunterAnimState`/`pickAnim` ya están cubiertos por `test/logic.test.js`. Re-correr para asegurar que no se rompió la firma:

Run: `node --test test/logic.test.js`
Expected: PASS.

- [ ] **Step 3: Checkpoint**

`HunterModel` listo para integrarse.

---

## Task 8: Integrar investigadores animados en `js/main.js`

**Files:**
- Modify: `js/main.js` (`makeHunters`, `updateHunter`, `killHunter`; eliminar sprites)

- [ ] **Step 1: Eliminar el render por sprites**

Quitar `makeHumanTexture` (líneas ~281-290) y `ACCENTS` (~291). Importar el modelo:

```js
import { HunterModel } from './hunters.js';
```

- [ ] **Step 2: Reescribir `makeHunters` para recibir los GLB cargados**

```js
function makeHunters(chars) {
  const spawns = spreadCells(NUM_HUNTERS + 1, (x, z) => (x <= 4 && z <= 4)).slice(1, NUM_HUNTERS + 1);
  for (let i = 0; i < NUM_HUNTERS; i++) {
    const [gx, gz] = spawns[i], [wx, wz] = worldOf(gx, gz);
    const model = new HunterModel(chars[i % chars.length].gltf);
    model.setPos(wx, 0, wz);
    scene.add(model.root);
    hunters.push({ pos: new THREE.Vector3(wx, 0, wz), model, alive: true, flee: 0, repath: 0, next: null, working: -1, _px: wx, _pz: wz });
  }
}
```

(Se elimina todo lo de `sprite`/`mat`/`SpriteMaterial`. `inShaftCell` ya no existe → el filtro de spawn no lo usa.)

- [ ] **Step 3: Reescribir `updateHunter` para mover/orientar/animar el modelo**

Conservar la lógica de decisión existente (huida, trabajo en estación, cacería) y, al final, sincronizar el modelo:

```js
function updateHunter(h, dt, ghost, hunting, ghostOnFloor0) {
  if (!h.alive) { h.model.update(dt); return; }
  if (h.flee > 0) h.flee -= dt;
  const prevX = h.pos.x, prevZ = h.pos.z;
  if (hunting) {
    h.working = -1;
    stepToward(h, farthestCell(ghost.x, ghost.z), HUNTER_FLEE_SPEED, dt);
    if (ghostOnFloor0 && Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z) < KILL_RANGE) { killHunter(h); return; }
  } else if (h.flee > 0) {
    h.working = -1; stepToward(h, farthestCell(ghost.x, ghost.z), HUNTER_FLEE_SPEED, dt);
  } else {
    const si = nearestIncompleteStation(h.pos.x, h.pos.z);
    if (si < 0) h.working = -1;
    else { const s = stations[si];
      if (Math.hypot(s.wx - h.pos.x, s.wz - h.pos.z) < 0.9) { h.working = si; s.progress = Math.min(1, s.progress + dt / MISSION_TIME); if (s.progress >= 1) s.done = true; refreshStation(s); }
      else { h.working = -1; stepToward(h, [s.gx, s.gz], HUNTER_SPEED, dt); }
    }
  }
  // sincronizar modelo
  const dx = h.pos.x - prevX, dz = h.pos.z - prevZ;
  const moving = (dx * dx + dz * dz) > 1e-6;
  h.model.faceDir(dx, dz);
  h.model.setState({ alive: true, hunting, flee: h.flee, working: h.working, moving });
  h.model.setPos(h.pos.x, 0, h.pos.z);
  h.model.update(dt);
}
```

(Se elimina la asignación de color a `h.mat` —ya no hay sprite—.)

- [ ] **Step 4: Reescribir `killHunter` para reproducir `Death`**

```js
function killHunter(h) {
  h.alive = false;
  h.model.setSpectral(false);
  h.model.play('Death');
  h.model.update(0);
  sfx.kill();
  checkEnd();
}
```

(El modelo permanece como cadáver; `updateHunter` sigue llamando `h.model.update(dt)` para que termine la animación de muerte.)

- [ ] **Step 5: Verificación manual**

Run: `python -m http.server 8080` → jugar.
Expected: 3 investigadores como **modelos 3D distintos**; **caminan** (`Walk`) hacia estaciones orientados hacia su avance; al llegar hacen `Interact`; al rugir/cacería corren (`Run`); al matarlos caen (`Death`) y quedan en el suelo.

- [ ] **Step 6: Checkpoint**

Investigadores animados integrados.

---

## Task 9: Visión espectral en cacería

**Files:**
- Modify: `js/main.js` (`startHunt`/`endHunt` activan/desactivan espectral)

- [ ] **Step 1: Activar/desactivar el modo espectral en los modelos**

En `startHunt()` y `endHunt()`, recorrer los investigadores vivos:

```js
function startHunt() { hunt.active = HUNT_DUR; sfx.roar(); duckMusic(true); for (const h of hunters) if (h.alive) h.model.setSpectral(true); }
function endHunt() { hunt.active = 0; duckMusic(false); for (const h of hunters) if (h.alive) h.model.setSpectral(false); }
```

- [ ] **Step 2: Verificación manual**

Run: `python -m http.server 8080` → jugar → pulsar `G` (forzar cacería) o esperar.
Expected: durante la cacería las luces bajan a oscuras y los investigadores **se ven con glow azul a través de los muros**; al terminar, vuelven a su material normal y quedan ocultos tras los muros.

- [ ] **Step 3: Checkpoint**

Visión espectral fiel al diseño.

---

## Task 10: Atmósfera single-floor, limpieza y créditos

**Files:**
- Modify: `js/main.js` (`applyAtmosphere`, HUD de piso, código muerto)
- Modify: `README.md`

- [ ] **Step 1: Simplificar `applyAtmosphere` (sin ramas por piso)**

```js
function applyAtmosphere() {
  const lit = hunt.active <= 0;
  ambient.color.setHex(0xbda86a);
  ambient.intensity = lit ? 0.85 : 0.04;
  const fogc = 0x1c1808; scene.fog.color.setHex(fogc); scene.background.setHex(fogc);
}
```

(Se eliminan `panelMat`/`panelMat1` y sus referencias; ya no hay paneles procedurales.)

- [ ] **Step 2: HUD — fijar piso y limpiar referencias muertas**

En `updateHUD`, dejar el piso fijo y eliminar lógica de `currentFloor` dinámico:

```js
  el('floor').textContent = '🟡 0';
```

Quitar del HUD/minimapa cualquier uso restante de `maze1`, `MAP1`, `currentFloor` variable, `FLOOR_H` (salvo que se conserve como constante sin uso → eliminarla).

- [ ] **Step 3: Eliminar código muerto**

Borrar definitivamente de `js/main.js` lo que ya no se referencia: `MAP1`, `carveStairs`, `inShaftCell`, `floorWithHole`, geometría/bloque de escaleras, `makeTree`, `panelGeo`/`panelMat`/`panelMat1`, `makeHumanTexture`, `ACCENTS`, `maze1`. Mantener `genBackrooms` solo si se usa como fallback real en `let MAP = genBackrooms(GRID)`; si se decide no tener fallback, eliminarlo también y arrancar `MAP` vacío.

- [ ] **Step 4: Actualizar créditos en `README.md`**

Sustituir la sección "Créditos de assets" por:

```markdown
## Créditos de assets

- **Personajes:** Quaternius — *Ultimate Animated Character Pack* (CC0). https://quaternius.com
- **Entorno:** `backrooms.glb` descargado de Sketchfab — _registrar autor + URL y verificar licencia CC0/CC-BY del modelo concreto antes de publicar_.
- **Música:** `freesound_community-dark-drone-ambient` (Freesound).
```

- [ ] **Step 5: Verificación manual — checklist completo**

Run: `python -m http.server 8080` → jugar una partida entera.
Expected (todo verde):
1. "CARGANDO… %" → "CLICK PARA JUGAR" → entras.
2. Nivel GLB visible; caminas sin atravesar muros.
3. 3 investigadores distintos: `Walk`/`Interact`/`Run`/`Death` según estado.
4. Cacería: oscurece + glow a través de muros + matar dentro de rango.
5. Minimapa coherente; estaciones visibles; HUD sin referencias a piso 1.
6. Victoria (matar a todos / aguantar tiempo) y derrota (completan misiones) funcionan.
7. Consola sin errores.

- [ ] **Step 6: Re-correr tests de lógica**

Run: `node --test`
Expected: PASS (smoke + logic).

- [ ] **Step 7: Checkpoint final**

Integración completa verificada.

---

## Self-review (cobertura del spec)

- **Carga de assets / importmap / GLTFLoader** → Tasks 1, 3. ✓
- **Entorno = GLB, escala, suelo y=0** → Task 4. ✓
- **Horneado del grid (raycast, classifyCell, reachable)** → Tasks 2, 5. ✓
- **Single-floor (eliminar 2º piso/escaleras/paneles/árboles)** → Tasks 4, 6, 10. ✓
- **Investigadores animados (3 distintos, Walk/Run/Interact/Idle/Death, orientación)** → Tasks 7, 8. ✓
- **Visión espectral en cacería** → Task 9. ✓
- **Atmósfera simplificada + limpieza + créditos** → Task 10. ✓
- **Constantes tuneables** (`TARGET_CEIL`, `WALL_RAY_THRESHOLD`, `CHAR_HEIGHT`, `CELL`) → definidas en env.js/grid.js/hunters.js/main.js. ✓
- **Riesgo "interior abierto/cerrado"** → GATE explícito en Task 5 Step 4. ✓
- **Sin git / tests Node / verificación navegador** → declarado en "Adaptaciones". ✓

Consistencia de tipos/nombres revisada: `loadAllAssets(n,onProgress)`, `placeEnv(scene,gltf)→{root,ceilY,width,depth,wallMeshes}`, `bakeGrid(wallMeshes,width,depth,cell,ceilY)→{map,cols,rows,walls,open}`, `HunterModel(gltf)` con `setState/faceDir/setPos/setSpectral/play/update`, `makeHunters(chars)`. Coinciden entre tareas.
