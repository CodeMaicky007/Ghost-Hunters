# Rebanada 2 — Progresión ritual + ritual final + nueva victoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el bucle de "apagar monitores" por la progresión ritual: los 8 supervivientes descubren objetos rituales, los acarrean al altar (mesa) y, reunidos todos, canalizan el ritual final (con defensa) que destruye al fantasma = ganan; el fantasma gana matándolos a todos; el temporizador, al agotarse, escala a cacería permanente.

**Architecture:** Módulo puro `js/ritual.js` (sin THREE, node-testeable) con la máquina de estados del ritual (objetos/altar/fase/canalización) + reparto de roles por fase. `js/main.js` lo conduce y renderiza, reutilizando la IA de R1 (`ai.js`, sin cambios de lógica) y mapeando los roles de fase a celdas. `js/assets.js` carga `mesa.glb` + `wooden_cross.glb`.

**Tech Stack:** JS vanilla ESM, Three.js 0.160 por CDN (sin build), Node test runner (`node --test`) para el núcleo puro, verificación manual en navegador vía CDP/headless.

**Spec:** `docs/superpowers/specs/2026-06-10-progresion-ritual-design.md`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `js/ritual.js` | Núcleo puro: estado del ritual + transiciones (pickup/drop/deposit/channelTick) + `assignRitualRoles`. Sin THREE. | Crear |
| `test/ritual.test.js` | `node --test` del núcleo puro. | Crear |
| `js/assets.js` | Cargar `mesa.glb` + `wooden_cross.glb` junto al resto. | Modificar |
| `js/main.js` | Crear altar+objetos, conducir el ritual, render de carga/depósito/barra, roles de fase, contrajuego, victoria/escalada, HUD, minimapa. | Modificar |

`ritual.js` usa claves de celda string `"gx,gz"` y reutiliza `ROLES` de `ai.js` (ambos puros) para los roles compartidos.

---

## Fase A — Núcleo puro `js/ritual.js` (TDD)

### Task 1: Bootstrap `ritual.js` + constantes + `createRitual`

**Files:**
- Create: `js/ritual.js`
- Create: `test/ritual.test.js`

- [ ] **Step 1: Test que falla**

Crea `test/ritual.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRitual, RCFG, OBJ, PHASE } from '../js/ritual.js';

test('createRitual inicializa objetos ON_MAP y fase GATHER', () => {
  const r = createRitual([[2, 3], [5, 6]], [4, 4], { NEED_CHANNELERS: 2, CHANNEL_TIME: 10 });
  assert.equal(r.phase, PHASE.GATHER);
  assert.equal(r.channel, 0);
  assert.equal(r.altar.gx, 4);
  assert.equal(r.altar.gz, 4);
  assert.equal(r.objects.length, 2);
  assert.equal(r.needObjects, 2);
  assert.equal(r.needChannelers, 2);
  assert.equal(r.channelTime, 10);
  assert.deepEqual(
    r.objects.map((o) => [o.id, o.gx, o.gz, o.status, o.carrier]),
    [[0, 2, 3, OBJ.ON_MAP, null], [1, 5, 6, OBJ.ON_MAP, null]]
  );
});

test('createRitual usa los defaults RCFG si no se pasan opts', () => {
  const r = createRitual([[1, 1]], [0, 0]);
  assert.equal(r.needChannelers, RCFG.NEED_CHANNELERS);
  assert.equal(r.channelTime, RCFG.CHANNEL_TIME);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/ritual.js'`.

- [ ] **Step 3: Implementación**

Crea `js/ritual.js`:

```js
// ============================================================
//  Progresión ritual — núcleo PURO (sin three). Máquina de estados
//  del ritual + reparto de roles por fase. node-testeable.
// ============================================================
import { ROLES } from './ai.js';

export const RCFG = {
  NUM_OBJECTS: 4,        // objetos rituales repartidos por el mapa
  NEED_CHANNELERS: 2,    // mínimo de canalizadores para que suba la barra
  CHANNEL_TIME: 14,      // s para llenar la barra sin interrupciones
  CHANNEL_PENALTY: 0.12, // fracción/seg que retrocede al interrumpir
  ALTAR_RANGE: 1.2,      // unidades de mundo para depositar / contar como canalizador
};

export const OBJ = { ON_MAP: 'ON_MAP', CARRIED: 'CARRIED', DEPOSITED: 'DEPOSITED' };
export const PHASE = { GATHER: 'GATHER', CHANNEL: 'CHANNEL', DONE: 'DONE' };
// Roles de fase: reutiliza los de R1 + añade los específicos del ritual.
export const RROLE = { ...ROLES, FETCH: 'FETCH', CHANNEL: 'CHANNEL', DEFEND: 'DEFEND', DISTRACT: 'DISTRACT' };

export function createRitual(objectCells, altarCell, opts = {}) {
  const p = { ...RCFG, ...opts };
  return {
    altar: { gx: altarCell[0], gz: altarCell[1] },
    objects: objectCells.map(([gx, gz], i) => ({ id: i, gx, gz, status: OBJ.ON_MAP, carrier: null, homeGx: gx, homeGz: gz })),
    phase: PHASE.GATHER,
    channel: 0,
    needObjects: objectCells.length,
    needChannelers: p.NEED_CHANNELERS,
    channelTime: p.CHANNEL_TIME,
    penalty: p.CHANNEL_PENALTY,
  };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS (tests de ritual + los de ai/logic siguen pasando).

- [ ] **Step 5: Commit**

```bash
git add js/ritual.js test/ritual.test.js
git commit -m "feat(ritual): bootstrap nucleo puro + createRitual"
```

---

### Task 2: `pickup` / `objectCarriedBy` / `dropCarried`

**Files:**
- Modify: `js/ritual.js`
- Test: `test/ritual.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ritual.test.js`:

```js
import { pickup, objectCarriedBy, dropCarried } from '../js/ritual.js';

test('pickup coge un objeto ON_MAP y lo marca CARRIED', () => {
  const r = createRitual([[2, 3]], [4, 4]);
  assert.equal(pickup(r, 0, 7), true);
  assert.equal(r.objects[0].status, OBJ.CARRIED);
  assert.equal(r.objects[0].carrier, 7);
  assert.equal(pickup(r, 0, 9), false); // ya cargado -> no
});

test('objectCarriedBy devuelve el objeto que carga un agente', () => {
  const r = createRitual([[2, 3], [5, 6]], [4, 4]);
  pickup(r, 1, 3);
  assert.equal(objectCarriedBy(r, 3).id, 1);
  assert.equal(objectCarriedBy(r, 99), null);
});

test('dropCarried suelta el objeto en la celda dada', () => {
  const r = createRitual([[2, 3]], [4, 4]);
  pickup(r, 0, 7);
  assert.equal(dropCarried(r, 7, 8, 9), true);
  assert.equal(r.objects[0].status, OBJ.ON_MAP);
  assert.equal(r.objects[0].carrier, null);
  assert.deepEqual([r.objects[0].gx, r.objects[0].gz], [8, 9]);
  assert.equal(dropCarried(r, 7, 1, 1), false); // ya no carga nada
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `pickup is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ritual.js`:

```js
export function objectCarriedBy(ritual, agentId) {
  return ritual.objects.find((o) => o.status === OBJ.CARRIED && o.carrier === agentId) || null;
}

export function pickup(ritual, objId, agentId) {
  const o = ritual.objects.find((x) => x.id === objId);
  if (!o || o.status !== OBJ.ON_MAP) return false;
  o.status = OBJ.CARRIED; o.carrier = agentId;
  return true;
}

export function dropCarried(ritual, agentId, gx, gz) {
  const o = objectCarriedBy(ritual, agentId);
  if (!o) return false;
  o.status = OBJ.ON_MAP; o.carrier = null; o.gx = gx; o.gz = gz;
  return true;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ritual.js test/ritual.test.js
git commit -m "feat(ritual): pickup/dropCarried/objectCarriedBy"
```

---

### Task 3: `depositCarried` + `depositedCount` / `allDeposited` + transición a CHANNEL

**Files:**
- Modify: `js/ritual.js`
- Test: `test/ritual.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ritual.test.js`:

```js
import { depositCarried, depositedCount, allDeposited } from '../js/ritual.js';

test('depositCarried marca DEPOSITED y lo fija al altar', () => {
  const r = createRitual([[2, 3], [5, 6]], [4, 4]);
  pickup(r, 0, 7);
  assert.equal(depositCarried(r, 7), true);
  assert.equal(r.objects[0].status, OBJ.DEPOSITED);
  assert.deepEqual([r.objects[0].gx, r.objects[0].gz], [4, 4]);
  assert.equal(depositedCount(r), 1);
  assert.equal(allDeposited(r), false);
  assert.equal(r.phase, PHASE.GATHER);
});

test('depositar el último objeto pasa a fase CHANNEL', () => {
  const r = createRitual([[2, 3], [5, 6]], [4, 4]);
  pickup(r, 0, 1); depositCarried(r, 1);
  pickup(r, 1, 2); depositCarried(r, 2);
  assert.equal(allDeposited(r), true);
  assert.equal(r.phase, PHASE.CHANNEL);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `depositCarried is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ritual.js`:

```js
export function depositedCount(ritual) {
  return ritual.objects.filter((o) => o.status === OBJ.DEPOSITED).length;
}
export function allDeposited(ritual) {
  return depositedCount(ritual) === ritual.objects.length;
}

export function depositCarried(ritual, agentId) {
  const o = objectCarriedBy(ritual, agentId);
  if (!o) return false;
  o.status = OBJ.DEPOSITED; o.carrier = null;
  o.gx = ritual.altar.gx; o.gz = ritual.altar.gz;
  if (allDeposited(ritual) && ritual.phase === PHASE.GATHER) ritual.phase = PHASE.CHANNEL;
  return true;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ritual.js test/ritual.test.js
git commit -m "feat(ritual): depositCarried + transicion a CHANNEL"
```

---

### Task 4: `channelTick`

**Files:**
- Modify: `js/ritual.js`
- Test: `test/ritual.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ritual.test.js`:

```js
import { channelTick } from '../js/ritual.js';

function channeling() {
  const r = createRitual([[1, 1]], [0, 0], { CHANNEL_TIME: 10, NEED_CHANNELERS: 2, CHANNEL_PENALTY: 0.5 });
  pickup(r, 0, 1); depositCarried(r, 1); // fuerza CHANNEL
  return r;
}

test('channelTick sube con >= needChannelers, no sube con menos', () => {
  const r = channeling();
  channelTick(r, 2, 1);             // +1/10
  assert.ok(Math.abs(r.channel - 0.1) < 1e-9);
  channelTick(r, 1, 1);             // pocos -> sin cambio
  assert.ok(Math.abs(r.channel - 0.1) < 1e-9);
});

test('channelTick retrocede con interrupt y nunca baja de 0', () => {
  const r = channeling();
  channelTick(r, 2, 1); // 0.1
  channelTick(r, 2, 1, { interrupt: true }); // -0.5 -> clamp 0
  assert.equal(r.channel, 0);
});

test('channelTick llega a DONE al 100%', () => {
  const r = channeling();
  for (let i = 0; i < 12; i++) channelTick(r, 2, 1); // 12s > 10s
  assert.equal(r.channel, 1);
  assert.equal(r.phase, PHASE.DONE);
});

test('channelTick no hace nada fuera de fase CHANNEL', () => {
  const r = createRitual([[1, 1]], [0, 0]); // GATHER
  assert.equal(channelTick(r, 5, 1), PHASE.GATHER);
  assert.equal(r.channel, 0);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `channelTick is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ritual.js`:

```js
// Avanza la canalización en fase CHANNEL. interrupt -> retrocede; si no, sube
// con >= needChannelers. Devuelve la fase resultante.
export function channelTick(ritual, nChannelers, dt, { interrupt = false } = {}) {
  if (ritual.phase !== PHASE.CHANNEL) return ritual.phase;
  if (interrupt) ritual.channel = Math.max(0, ritual.channel - ritual.penalty * dt);
  else if (nChannelers >= ritual.needChannelers) ritual.channel = Math.min(1, ritual.channel + dt / ritual.channelTime);
  if (ritual.channel >= 1) ritual.phase = PHASE.DONE;
  return ritual.phase;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ritual.js test/ritual.test.js
git commit -m "feat(ritual): channelTick (sube/retrocede/DONE)"
```

---

### Task 5: `discoverableCells`

**Files:**
- Modify: `js/ritual.js`
- Test: `test/ritual.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ritual.test.js`:

```js
import { discoverableCells } from '../js/ritual.js';

test('discoverableCells da altar + objetos ON_MAP (no los cargados/depositados)', () => {
  const r = createRitual([[2, 3], [5, 6]], [4, 4]);
  pickup(r, 0, 1); // objeto 0 pasa a CARRIED -> no descubrible como suelto
  const cells = discoverableCells(r).map(([x, z]) => x + ',' + z).sort();
  assert.deepEqual(cells, ['4,4', '5,6']); // altar + objeto 1 ON_MAP
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `discoverableCells is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ritual.js`:

```js
// Celdas que la niebla puede descubrir: el altar y los objetos sueltos (ON_MAP).
export function discoverableCells(ritual) {
  const cells = [[ritual.altar.gx, ritual.altar.gz]];
  for (const o of ritual.objects) if (o.status === OBJ.ON_MAP) cells.push([o.gx, o.gz]);
  return cells;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ritual.js test/ritual.test.js
git commit -m "feat(ritual): discoverableCells"
```

---

### Task 6: `assignRitualRoles` (GATHER + CHANNEL)

**Files:**
- Modify: `js/ritual.js`
- Test: `test/ritual.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ritual.test.js`:

```js
import { assignRitualRoles, RROLE } from '../js/ritual.js';

const mkAgents = (n) => Array.from({ length: n }, (_, i) => ({ id: i, alive: true, bravery: i / (n - 1), gx: i, gz: 0 }));

test('GATHER: 8 vivos -> 4 FETCH + 2 EXPLORE_A + 2 EXPLORE_B; portador forzado a FETCH', () => {
  const r = createRitual([[1, 1], [2, 2]], [0, 0]);
  const agents = mkAgents(8);
  const roles = assignRitualRoles(agents, r, 0);
  const counts = {};
  for (const v of roles.values()) counts[v] = (counts[v] || 0) + 1;
  assert.equal(counts[RROLE.FETCH], 4);
  assert.equal(counts[RROLE.EXPLORE_A], 2);
  assert.equal(counts[RROLE.EXPLORE_B], 2);
  // un portador siempre FETCH aunque por valentía cayera en EXPLORE
  pickup(r, 0, 7);
  const roles2 = assignRitualRoles(agents, r, 0);
  assert.equal(roles2.get(7), RROLE.FETCH);
});

test('CHANNEL: needChannelers como CHANNEL (los más cercanos al altar), resto DEFEND/DISTRACT', () => {
  const r = createRitual([[1, 1], [2, 2]], [0, 0]);
  pickup(r, 0, 1); depositCarried(r, 1); pickup(r, 1, 2); depositCarried(r, 2); // -> CHANNEL
  // agentes a distancias crecientes del altar (gx); needChannelers=2
  const agents = mkAgents(6);
  const roles = assignRitualRoles(agents, r, 0);
  const counts = {};
  for (const v of roles.values()) counts[v] = (counts[v] || 0) + 1;
  assert.equal(counts[RROLE.CHANNEL], 2);
  assert.equal(roles.get(0), RROLE.CHANNEL); // el más cercano (gx=0)
  assert.equal(roles.get(1), RROLE.CHANNEL);
  assert.ok((counts[RROLE.DEFEND] || 0) + (counts[RROLE.DISTRACT] || 0) === 4);
});

test('CHANNEL bajo amenaza alta: sin DISTRACT', () => {
  const r = createRitual([[1, 1]], [0, 0]);
  pickup(r, 0, 1); depositCarried(r, 1); // -> CHANNEL
  const agents = mkAgents(6);
  const roles = assignRitualRoles(agents, r, 1); // threat alto
  assert.ok(![...roles.values()].includes(RROLE.DISTRACT));
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `assignRitualRoles is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ritual.js`:

```js
// Reparte roles según la fase. agents: [{id, alive, bravery, gx, gz}]. threat 0..1.
// GATHER: 4 FETCH (los más valientes) + EXPLORE_A/B; el portador siempre FETCH.
// CHANNEL: needChannelers CHANNEL (más cercanos al altar), resto DEFEND, y 1-2
// DISTRACT (los más valientes) salvo amenaza alta.
export function assignRitualRoles(agents, ritual, threat) {
  const out = new Map();
  const alive = agents.filter((a) => a.alive);

  if (ritual.phase === PHASE.CHANNEL) {
    const dA = (a) => Math.abs(a.gx - ritual.altar.gx) + Math.abs(a.gz - ritual.altar.gz);
    const byNear = alive.slice().sort((x, y) => dA(x) - dA(y));
    const need = Math.min(ritual.needChannelers, byNear.length);
    byNear.forEach((a, i) => out.set(a.id, i < need ? RROLE.CHANNEL : RROLE.DEFEND));
    const rest = byNear.slice(need).sort((x, y) => y.bravery - x.bravery);
    const nDistract = threat >= 1 ? 0 : (rest.length >= 3 ? 2 : (rest.length >= 1 ? 1 : 0));
    for (let i = 0; i < nDistract; i++) out.set(rest[i].id, RROLE.DISTRACT);
    return out;
  }

  // GATHER
  const sorted = alive.slice().sort((a, b) => b.bravery - a.bravery);
  const order = [RROLE.FETCH, RROLE.FETCH, RROLE.EXPLORE_A, RROLE.EXPLORE_B];
  const n = sorted.length || 1;
  sorted.forEach((a, i) => out.set(a.id, order[Math.min(3, Math.floor((i * 4) / n))]));
  for (const a of alive) if (objectCarriedBy(ritual, a.id)) out.set(a.id, RROLE.FETCH);
  return out;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ritual.js test/ritual.test.js
git commit -m "feat(ritual): assignRitualRoles por fase"
```

---

## Fase B — Integración en `js/assets.js` y `js/main.js`

> Verificación manual con servidor local + CDP/headless. Tras cada tarea, `node --check js/main.js` (parsea) y `npm test` (núcleo sigue verde).

### Task 7: Cargar `mesa.glb` + `wooden_cross.glb`

**Files:**
- Modify: `js/assets.js`

- [ ] **Step 1: Añadir URLs y trabajos de carga**

En `js/assets.js`, tras la línea `export const TV_URL = ...;`, añade:

```js
export const ALTAR_URL = 'assets/models/objects/mesa.glb';
export const RITUAL_OBJ_URL = 'assets/models/objects/wooden_cross.glb';
```

En `loadAllAssets`, cambia la construcción de `jobs` para incluir altar + objeto ritual:

```js
  const jobs = [
    { key: 'env', url: ENV_URL },
    { key: 'tv', url: TV_URL },
    { key: 'altar', url: ALTAR_URL },
    { key: 'cross', url: RITUAL_OBJ_URL },
    ...chosen.map((name) => ({ key: name, url: charUrl(name) })),
  ];
```

Y amplía el `return`:

```js
  return {
    env: results.env, tv: results.tv, altar: results.altar, cross: results.cross,
    chars: chosen.map((name) => ({ name, gltf: results[name] })),
  };
```

- [ ] **Step 2: Verificación**

Run: `node --check js/assets.js && npm test`
Expected: parsea OK; 42/42 tests (ritual + ai + logic) verdes.

- [ ] **Step 3: Commit**

```bash
git add js/assets.js
git commit -m "feat(ritual): carga mesa.glb + wooden_cross.glb"
```

---

### Task 8: `makeRitual` — altar + objetos, y estado del ritual en `boot()`

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Importar el núcleo ritual**

En `js/main.js`, junto a `import * as AIB from './ai.js';`, añade:

```js
import * as RIT from './ritual.js';
```

- [ ] **Step 2: Constantes**

Bajo `const NUM_HUNTERS = 8;`, añade:

```js
const NUM_RITUAL_OBJECTS = 4;
```

- [ ] **Step 3: Estado del ritual + helper de altura**

Reemplaza el bloque de estaciones (de `const stations = [];` hasta el final de `nearestIncompleteStation`, líneas ~189-236) por:

```js
// ============================================================
//  Ritual: altar (mesa) + objetos rituales (cruces) que los
//  supervivientes acarrean al altar; al reunirlos se canaliza.
// ============================================================
let ritual = null;                 // estado puro (js/ritual.js), creado en makeRitual
const ritualMeshes = new Map();    // objId -> THREE.Object3D
let altarMesh = null, altarMat = null;
const OBJ_HEIGHT = 0.6;            // alto objetivo del objeto ritual en mundo
const ALTAR_HEIGHT = 0.9;         // alto objetivo del altar

// Escala un GLB clonado a `targetH` midiendo su caja y lo apoya en y=0 sobre (wx,wz).
function placeProp(gltf, wx, wz, targetH, faceCenter) {
  const mesh = gltf.scene.clone(true);
  if (faceCenter) {
    const cxw = ((COLS - 1) * CELL) / 2, czw = ((ROWS - 1) * CELL) / 2;
    mesh.rotation.y = Math.atan2(cxw - wx, czw - wz);
  }
  mesh.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(mesh);
  mesh.scale.setScalar(targetH / Math.max(1e-3, box.max.y - box.min.y));
  mesh.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(mesh);
  mesh.position.set(wx - (box.min.x + box.max.x) / 2, -box.min.y, wz - (box.min.z + box.max.z) / 2);
  return mesh;
}

function makeRitual(assets) {
  // Celdas repartidas: la primera para el altar, el resto para los objetos.
  const cells = spreadCells(NUM_RITUAL_OBJECTS + 1, (x, z) => (x <= 5 && z <= 7));
  const [agx, agz] = cells[0], [awx, awz] = worldOf(agx, agz);
  const objCells = cells.slice(1, NUM_RITUAL_OBJECTS + 1);
  ritual = RIT.createRitual(objCells, [agx, agz], { NEED_CHANNELERS: 2 });

  // Altar (mesa) con material propio para el brillo de canalización.
  if (assets && assets.altar) {
    altarMesh = placeProp(assets.altar, awx, awz, ALTAR_HEIGHT, true);
    altarMesh.traverse((o) => { if (o.isMesh && !altarMat) { altarMat = (Array.isArray(o.material) ? o.material[0] : o.material).clone(); } });
    altarMesh.traverse((o) => { if (o.isMesh) o.material = altarMat; });
    if (altarMat) { altarMat.emissive = new THREE.Color(0x9d4edd); altarMat.emissiveIntensity = 0.1; }
  } else {
    altarMat = new THREE.MeshStandardMaterial({ color: 0x3a2a4a, emissive: 0x9d4edd, emissiveIntensity: 0.1 });
    altarMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), altarMat); altarMesh.position.set(awx, 0.45, awz);
  }
  scene.add(altarMesh);

  // Objetos rituales (cruces).
  for (const o of ritual.objects) {
    const [wx, wz] = worldOf(o.gx, o.gz);
    let mesh;
    if (assets && assets.cross) mesh = placeProp(assets.cross, wx, wz, OBJ_HEIGHT, false);
    else { mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, OBJ_HEIGHT, 0.3), new THREE.MeshStandardMaterial({ color: 0xd8c089, emissive: 0x7a5a20, emissiveIntensity: 0.4 })); mesh.position.set(wx, OBJ_HEIGHT / 2, wz); }
    scene.add(mesh);
    ritualMeshes.set(o.id, mesh);
  }
}

// Coloca la malla de cada objeto según su estado: ON_MAP en su celda, CARRIED
// sobre el portador, DEPOSITED apilado junto al altar.
function syncRitualMeshes() {
  let deposited = 0;
  for (const o of ritual.objects) {
    const mesh = ritualMeshes.get(o.id); if (!mesh) continue;
    if (o.status === RIT.OBJ.CARRIED) {
      const carrier = hunters.find((h) => h.id === o.carrier && h.alive);
      if (carrier) mesh.position.set(carrier.pos.x, 1.9, carrier.pos.z);
    } else if (o.status === RIT.OBJ.DEPOSITED) {
      const [ax, az] = worldOf(ritual.altar.gx, ritual.altar.gz);
      mesh.position.set(ax + (deposited % 2 ? 0.2 : -0.2), ALTAR_HEIGHT + 0.1 + Math.floor(deposited / 2) * 0.18, az);
      deposited++;
    } else {
      const [wx, wz] = worldOf(o.gx, o.gz);
      mesh.position.set(wx, OBJ_HEIGHT / 2, wz);
    }
  }
  // Brillo del altar crece con la canalización.
  if (altarMat) altarMat.emissiveIntensity = 0.1 + (ritual.phase === RIT.PHASE.CHANNEL ? 1.2 * ritual.channel : 0);
}
```

- [ ] **Step 4: Reemplazar la creación en boot()**

En `boot()`, sustituye `makeStations(assets && assets.tv);` por:

```js
  makeRitual(assets);
```

- [ ] **Step 5: Verificación**

Run: `node --check js/main.js`
Expected: parsea OK. (El juego aún no usa el ritual en la lógica; las siguientes tareas lo cablean. Habrá referencias a `stations` pendientes de quitar — se resuelven en Task 9-12; si `node --check` pasa, las referencias restantes son runtime, no de sintaxis.)

- [ ] **Step 6: Commit**

```bash
git add js/main.js
git commit -m "feat(ritual): makeRitual (altar + objetos) + sync de mallas"
```

---

### Task 9: Descubrimiento de objetos/altar + bucle del ritual + retirar referencias a estaciones

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Generalizar el descubrimiento**

Reemplaza el cuerpo de `updateBlackboard(dt)` (el bloque `stations.forEach(...)` interno) por la versión que descubre celdas del ritual:

```js
function updateBlackboard(dt) {
  for (const h of hunters) {
    if (!h.alive) continue;
    const [gx, gz] = cellOf(h.pos.x, h.pos.z);
    AIB.discoverAround(BB, gx, gz, VISION_R, isOpenCell);
  }
  // Objetos sueltos + altar descubiertos -> objetivos conocidos por la IA.
  for (const [gx, gz] of RIT.discoverableCells(ritual)) {
    const k = AIB.cellKey(gx, gz);
    if (BB.discovered.has(k) && !BB.objectives.has(k)) BB.objectives.set(k, { gx, gz });
  }
  AIB.decayDanger(BB, dt);
}
```

- [ ] **Step 2: Conducir el ritual cada frame**

En `update(dt)`, sustituye la llamada `updateStations();` por:

```js
  syncRitualMeshes();
```

Y justo después de `for (const h of hunters) updateHunter(...)` (antes de `updateHUD`), añade el tick de canalización:

```js
  // Canalización: cuenta canalizadores en rango del altar; interrumpe si el
  // fantasma ruge cerca del altar durante la fase.
  if (ritual.phase === RIT.PHASE.CHANNEL) {
    const [ax, az] = worldOf(ritual.altar.gx, ritual.altar.gz);
    let nCh = 0;
    for (const h of hunters) if (h.alive && Math.hypot(h.pos.x - ax, h.pos.z - az) <= RIT.RCFG.ALTAR_RANGE + 0.6) nCh++;
    const ghostNear = Math.hypot(pos.x - ax, pos.z - az) <= RIT.RCFG.ALTAR_RANGE + 1.5 && (hunt.active > 0 || roarCd > ROAR_CD - 0.3);
    RIT.channelTick(ritual, nCh, dt, { interrupt: ghostNear });
  }
```

- [ ] **Step 3: Eliminar referencias muertas a estaciones**

Quita las llamadas que ya no existen: en `update(dt)` no debe quedar `updateStations()`. Busca y elimina cualquier resto de `refreshStation`, y en `roar()` el bloque que reinicia `stations[h.working].progress`. Reemplaza ese bloque dentro de `roar()`:

```js
    if (Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) <= SCARE_RANGE) { h.flee = SCARE_FLEE; h.next = null; }
```

(es decir, sin tocar `stations`).

- [ ] **Step 4: Verificación**

Run: `node --check js/main.js && npm test`
Expected: parsea OK; tests verdes. (La IA aún usa los roles de R1; el cableado de roles de fase es la Task 10.)

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat(ritual): descubrimiento de objetos/altar + tick de canalizacion"
```

---

### Task 10: Roles de fase + candidatos FETCH/CHANNEL/DEFEND/DISTRACT + pickup/deposit

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Coordinador usa `assignRitualRoles`**

En `runCoordinator`, sustituye la línea que llama a `AIB.assignRoles(...)` por:

```js
  const roles = RIT.assignRitualRoles(
    hunters.map((h) => { const [gx, gz] = cellOf(h.pos.x, h.pos.z); return { id: h.id, alive: h.alive, bravery: h.bravery, gx, gz }; }),
    ritual, threat
  );
```

- [ ] **Step 2: Candidatos por rol de fase**

Reemplaza el `switch (h.role)` de `buildCandidates(h)` por uno que cubra los roles del ritual:

```js
  switch (h.role) {
    case RIT.RROLE.EXPLORE_A:
    case RIT.RROLE.EXPLORE_B: {
      const wantLeft = h.role === RIT.RROLE.EXPLORE_A;
      cands = frontier.filter(([gx]) => (wantLeft ? gx < midx : gx >= midx)).map(([gx, gz]) => ({ gx, gz, bias: AIB.AI.W_CURIOSITY * h.bravery }));
      if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: AIB.AI.W_CURIOSITY * h.bravery }));
      break;
    }
    case RIT.RROLE.FETCH: {
      const carried = RIT.objectCarriedBy(ritual, h.id);
      if (carried) { cands = [{ gx: ritual.altar.gx, gz: ritual.altar.gz, bias: 5 }]; }
      else {
        // objeto suelto descubierto sin portador, más cercano
        cands = ritual.objects
          .filter((o) => o.status === RIT.OBJ.ON_MAP && BB.objectives.has(AIB.cellKey(o.gx, o.gz)))
          .map((o) => ({ gx: o.gx, gz: o.gz, bias: 4 }));
        if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 })); // nada descubierto -> explora
      }
      break;
    }
    case RIT.RROLE.CHANNEL:
    case RIT.RROLE.GUARD:
      cands = [{ gx: ritual.altar.gx, gz: ritual.altar.gz, bias: 5 }];
      break;
    case RIT.RROLE.DEFEND: {
      // celda entre el fantasma y el altar (un paso desde el altar hacia el fantasma)
      const [ggx, ggz] = cellOf(pos.x, pos.z);
      const dx = Math.sign(ggx - ritual.altar.gx), dz = Math.sign(ggz - ritual.altar.gz);
      cands = [{ gx: ritual.altar.gx + dx, gz: ritual.altar.gz + dz, bias: 3 }, { gx: ritual.altar.gx, gz: ritual.altar.gz, bias: 1 }];
      break;
    }
    case RIT.RROLE.DISTRACT: {
      const [ggx, ggz] = cellOf(pos.x, pos.z);
      cands = [{ gx: ggx, gz: ggz, bias: 3 }];
      break;
    }
    default:
      cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 }));
  }
```

- [ ] **Step 3: Recoger/depositar al llegar (en `updateHunter`)**

En la rama AI (`else`) de `updateHunter`, reemplaza el bloque que comprobaba estaciones (`const onObj = nearestIncompleteStation(...)` ... trabajar) por la lógica de recoger/depositar:

```js
    h.working = -1;
    // FETCH: si carga un objeto y llega al altar -> deposita; si no carga y llega
    // a un objeto suelto descubierto -> lo coge.
    const [ax, az] = worldOf(ritual.altar.gx, ritual.altar.gz);
    const carried = RIT.objectCarriedBy(ritual, h.id);
    if (carried) {
      if (Math.hypot(h.pos.x - ax, h.pos.z - az) <= RIT.RCFG.ALTAR_RANGE) RIT.depositCarried(ritual, h.id);
    } else if (h.role === RIT.RROLE.FETCH) {
      for (const o of ritual.objects) {
        if (o.status !== RIT.OBJ.ON_MAP) continue;
        const [owx, owz] = worldOf(o.gx, o.gz);
        if (Math.hypot(h.pos.x - owx, h.pos.z - owz) <= 0.7) { RIT.pickup(ritual, o.id, h.id); break; }
      }
    }
    if (h.goal) stepToward(h, h.goal, HUNTER_SPEED, dt);
    pushRecent(h);
```

(El `h.goal = newGoal` y la invalidación de `h.next` de R1 quedan justo encima, sin cambios.)

- [ ] **Step 4: Verificación manual (CDP)**

Run: `npm run dev` → JUGAR. Observa ~60 s.
Expected: los supervivientes descubren cruces, **las cogen** (la cruz se mueve sobre el portador) y las llevan al **altar**; al depositar las 4, el HUD/escena pasa a CHANNEL y se agrupan en el altar. Sin errores en consola.

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat(ritual): roles de fase + FETCH/CHANNEL/DEFEND/DISTRACT + pickup/deposit"
```

---

### Task 11: Contrajuego del fantasma (susto = soltar) + interrupción al matar

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Rugido hace soltar a los portadores**

Dentro de `roar()`, en el bucle que aplica `flee` a los cercanos, haz que un portador suelte:

```js
    if (Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) <= SCARE_RANGE) {
      h.flee = SCARE_FLEE; h.next = null;
      const [gx, gz] = cellOf(h.pos.x, h.pos.z);
      RIT.dropCarried(ritual, h.id, gx, gz); // si carga algo, lo suelta aquí
    }
```

- [ ] **Step 2: Muerte suelta el objeto + interrumpe la canalización**

En `killHunter(h)`, tras marcar `h.alive = false` y postear el evento de muerte, añade:

```js
  { const [gx, gz] = cellOf(h.pos.x, h.pos.z); RIT.dropCarried(ritual, h.id, gx, gz); }
  if (ritual.phase === RIT.PHASE.CHANNEL) ritual.channel = Math.max(0, ritual.channel - 0.1); // penalización por matar a un canalizador
```

- [ ] **Step 3: Verificación manual**

Run: `npm run dev` → JUGAR → acércate a un portador y ruge (clic/`Q`).
Expected: el portador **suelta** la cruz donde está (la cruz queda en el suelo y otro la vuelve a recoger). Si matas a un canalizador en CHANNEL, la barra **baja**. Sin errores.

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat(ritual): susto suelta objeto + muerte interrumpe canalizacion"
```

---

### Task 12: Victoria por ritual + escalada del temporizador

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Estado de escalada**

Junto a `let debugAI = false;`, añade:

```js
let escalated = false;   // al agotarse el tiempo: cacería permanente
```

- [ ] **Step 2: `checkEnd` por ritual, sin victoria por timeout**

Reemplaza el cuerpo de `checkEnd()` por:

```js
function checkEnd() {
  if (GAME.state !== 'playing') return;
  if (ritual && ritual.phase === RIT.PHASE.DONE) return endGame(false, 'El ritual te ha destruido.');
  if (hunters.every((h) => !h.alive)) return endGame(true, 'Eliminaste a todos antes del ritual.');
  // El tiempo ya NO da victoria al fantasma: dispara escalada (ver updateHunt).
}
```

- [ ] **Step 3: Escalada en el bucle de cacería**

En `update(dt)`, justo después de `GAME.timeLeft -= dt;`, añade:

```js
  if (GAME.timeLeft <= 0 && !escalated) { escalated = true; GAME.timeLeft = 0; if (hunt.active <= 0) startHunt(); }
```

En `updateHunt(dt)`, haz que durante la escalada la cacería no termine. Reemplaza el cuerpo por:

```js
function updateHunt(dt) {
  if (escalated) { hunt.active = HUNT_DUR; for (const h of hunters) if (h.alive) h.model.setSpectral(true); return true; }
  if (hunt.active > 0) { hunt.active -= dt; if (hunt.active <= 0) endHunt(); }
  else { huntTimer -= dt; if (huntTimer <= 0) { startHunt(); huntTimer = HUNT_EVERY; } }
  return hunt.active > 0;
}
```

- [ ] **Step 4: Verificación manual (CDP)**

Run: `npm run dev` → JUGAR.
Expected: si los bots completan el ritual → pantalla **DERROTA** del fantasma ("El ritual te ha destruido."). Si fuerzas el paso del tiempo (déjalo correr) → al llegar a 0:00 la **cacería se vuelve permanente** (banner) y no termina la partida. Matar a los 8 → **VICTORIA**.

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat(ritual): victoria por ritual + escalada de temporizador"
```

---

### Task 13: HUD + minimapa + verificación integral + README

**Files:**
- Modify: `js/main.js`, `README.md`

- [ ] **Step 1: HUD de ritual**

En `updateHUD(hunting)`, sustituye la línea de monitores (`el('missions').textContent = ...`) por el estado del ritual:

```js
  if (ritual.phase === RIT.PHASE.CHANNEL || ritual.phase === RIT.PHASE.DONE) {
    el('missions').textContent = 'RITUAL ' + Math.round(ritual.channel * 100) + '%';
  } else {
    el('missions').textContent = RIT.depositedCount(ritual) + '/' + ritual.objects.length;
  }
```

Y para el banner de escalada, en `updateHUD` tras la lógica de `banner`, añade:

```js
  if (escalated) { banner.className = 'active'; banner.textContent = '☠ EL VELO SE ROMPIÓ — CACERÍA PERMANENTE ☠'; }
```

- [ ] **Step 2: Minimapa — altar + objetos descubiertos**

En `drawMinimap()`, sustituye el bucle que dibuja `stations` por:

```js
  const [agx, agz] = [ritual.altar.gx, ritual.altar.gz];
  mmCtx.fillStyle = '#9d4edd'; mmCtx.fillRect(agx * cs - 2, agz * cs - 2, cs + 3, cs + 3); // altar
  for (const o of ritual.objects) {
    if (o.status === RIT.OBJ.DEPOSITED) continue;
    if (!BB.objectives.has(AIB.cellKey(o.gx, o.gz)) && o.status === RIT.OBJ.ON_MAP) continue; // solo descubiertos
    mmCtx.fillStyle = o.status === RIT.OBJ.CARRIED ? '#ffd166' : '#d8c089';
    mmCtx.fillRect(o.gx * cs - 1, o.gz * cs - 1, cs + 1.5, cs + 1.5);
  }
```

En el bloque `if (debugAI)` del minimapa, añade la fase tras el velo de descubierto:

```js
    mmCtx.fillStyle = '#fff'; mmCtx.font = '9px monospace';
    mmCtx.fillText(ritual.phase + ' ' + RIT.depositedCount(ritual) + '/' + ritual.objects.length, 2, MM - 3);
```

- [ ] **Step 3: `node --test` + verificación integral (CDP)**

Run: `npm test`
Expected: PASS (ritual + ai + logic).

Run: `npm run dev` y revisa una partida:
- Los 8 descubren y **acarrean** las 4 cruces al altar (cruz sobre el portador en tránsito).
- Rugir a un portador → **suelta**; otro la recupera.
- Las 4 depositadas → **CHANNEL**; con ≥2 en el altar la **barra sube**; matar/rugir junto al altar la **baja**.
- Barra al 100% → **DERROTA** del fantasma (gana el equipo). Matar a los 8 → **VICTORIA**. `timeLeft=0` → **cacería permanente**.
- HUD muestra objetos/`RITUAL %`; minimapa marca altar + objetos; overlay `O` muestra fase. FPS estable, consola limpia.

- [ ] **Step 4: README**

En `README.md`, en el bloque de estado, sustituye la nota de R1 por:

```markdown
> **Estado:** R2 — progresión ritual: los 8 supervivientes acarrean objetos rituales al altar y canalizan el ritual final (con defensa) que destruye al fantasma. Timeout → cacería permanente.
```

- [ ] **Step 5: Commit**

```bash
git add js/main.js README.md
git commit -m "feat(ritual): HUD + minimapa de ritual; verificacion + README"
```

---

## Self-Review (cobertura del spec)

| Requisito del spec | Tarea(s) |
|---|---|
| `ritual.js`: estado + createRitual | Task 1 |
| pickup/dropCarried/objectCarriedBy | Task 2 |
| depositCarried + transición CHANNEL | Task 3 |
| channelTick (sube/retrocede/DONE) | Task 4 |
| discoverableCells (niebla) | Task 5 |
| assignRitualRoles (GATHER/CHANNEL) | Task 6 |
| Cargar mesa + cruz | Task 7 |
| Altar + objetos + carga visual + sync | Task 8 |
| Descubrimiento generalizado + tick de canalización | Task 9 |
| Roles de fase + candidatos + pickup/deposit | Task 10 |
| Susto = soltar; muerte suelta + interrumpe | Task 11 |
| Victoria por ritual; sin timeout; escalada | Task 12 |
| HUD (objetos/barra/fase) + minimapa | Task 13 |
| Verificación node --test + CDP | Tasks 1-6 (node), 8-13 (manual) |
| Kit de habilidades (R3) / Parry (R4) | Fuera de alcance: no se tocan |

**Consistencia de tipos:** `ritual` es el objeto de `createRitual`; estados `RIT.OBJ.*`; fases `RIT.PHASE.*`; roles `RIT.RROLE.*` (superset de `AIB.ROLES`). Las constantes de tuning son `RIT.RCFG.*` (p. ej. `RIT.RCFG.ALTAR_RANGE`); el módulo se importa en `main.js` como `import * as RIT from './ritual.js'`. `assignRitualRoles` y las funciones de transición mutan `ritual` (patrón del proyecto) y son node-testeables.

**Nota:** R2 elimina la lógica de monitores; el GLB de TV deja de colocarse (no se llama `makeStations`). Si se quisiera dejar como atrezzo, sería trabajo aparte.

---

## Execution Handoff

Tras guardar el plan, elige cómo ejecutarlo (ver final del mensaje).
