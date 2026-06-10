# Rebanada 3 — Kit del fantasma + cacería de 45s + percepción invertida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al fantasma una barra de Energía Paranormal que gatea una cacería de ~45s activada por el jugador, 4 habilidades (Teletransporte, Trampa, Aparición, Visión espectral) y una percepción invertida (normal = invisible y los supervivientes te sienten por proximidad y te evitan; cacería = visible, +rápido, parpadeo).

**Architecture:** Módulo puro `js/abilities.js` (sin THREE, node-testeable): energía, cooldowns, estado de trampas/señuelo/visión-espectral y gate de cacería. `js/main.js` aplica los efectos al mundo/IA, dibuja, hace el input y el HUD, y empuja eventos a la pizarra de R1/R2. `js/ai.js` y `js/ritual.js` no cambian de lógica.

**Tech Stack:** JS vanilla ESM, Three.js 0.160 por CDN (sin build), Node test runner (`node --test`) para el núcleo puro, verificación manual en navegador vía CDP/headless.

**Spec:** `docs/superpowers/specs/2026-06-10-kit-fantasma-caceria-design.md`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `js/abilities.js` | Núcleo puro: energía + cooldowns + activos (trampas/señuelo/espectral) + gate de cacería. Sin THREE. | Crear |
| `test/abilities.test.js` | `node --test` del núcleo puro. | Crear |
| `js/main.js` | Input, efectos, render (trampa/señuelo/aura/parpadeo), sonido de proximidad, evasión por sentido, cacería, HUD. | Modificar |
| `index.html` / `css/style.css` | Barra de energía + 5 slots de habilidad. | Modificar |

`abilities.js` usa datos planos (celdas `[gx,gz]`, tiempos en s), sin THREE.

---

## Fase A — Núcleo puro `js/abilities.js` (TDD)

### Task 1: Bootstrap — `AB`, `KEY`, `createAbilities`

**Files:**
- Create: `js/abilities.js`
- Create: `test/abilities.test.js`

- [ ] **Step 1: Test que falla**

Crea `test/abilities.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAbilities, AB, KEY } from '../js/abilities.js';

test('createAbilities inicializa energía 0 y activos vacíos', () => {
  const ab = createAbilities();
  assert.equal(ab.energy, 0);
  assert.deepEqual(ab.cooldowns, { teleport: 0, trap: 0, decoy: 0, spectral: 0 });
  assert.deepEqual(ab.traps, []);
  assert.equal(ab.decoy, null);
  assert.equal(ab.spectral, 0);
});

test('KEY expone las 4 habilidades', () => {
  assert.deepEqual(
    [KEY.TELEPORT, KEY.TRAP, KEY.DECOY, KEY.SPECTRAL],
    ['teleport', 'trap', 'decoy', 'spectral']
  );
  assert.equal(AB.HUNT_DUR > 0, true);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/abilities.js'`.

- [ ] **Step 3: Implementación**

Crea `js/abilities.js`:

```js
// ============================================================
//  Habilidades del fantasma + Energía Paranormal — núcleo PURO
//  (sin three). Economía + cooldowns + estado de activos. node-testeable.
// ============================================================

export const AB = {
  ENERGY_REGEN: 0.06,    // energía/seg (barra llena en ~16 s base)
  STALK_BONUS: 0.05,     // +energía/seg acechando (cerca de supervivientes)
  COST_TELEPORT: 0.25,
  COST_TRAP: 0.3,
  COST_DECOY: 0.3,
  CD_TELEPORT: 6,        // s
  CD_TRAP: 8,
  CD_DECOY: 10,
  CD_SPECTRAL: 10,
  TRAP_DUR: 12,          // s que dura una trampa
  TRAP_RADIUS: 2,        // celdas (Manhattan)
  DECOY_DUR: 8,          // s que dura el señuelo
  SPECTRAL_DUR: 6,       // s de visión espectral
  HUNT_DUR: 45,          // s de cacería activada
  HUNT_SPEED_MULT: 1.3,  // multiplicador de velocidad del fantasma en cacería
  SENSE_RANGE: 7,        // unidades de mundo: rango de "sonido" que sienten
  TELEPORT_RANGE: 12,    // celdas máx de teletransporte
};

export const KEY = { TELEPORT: 'teleport', TRAP: 'trap', DECOY: 'decoy', SPECTRAL: 'spectral' };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createAbilities() {
  return {
    energy: 0,
    cooldowns: { teleport: 0, trap: 0, decoy: 0, spectral: 0 },
    traps: [],       // [{gx, gz, t}]
    decoy: null,     // {gx, gz, t} | null
    spectral: 0,     // s restantes de visión espectral
  };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS (abilities + ritual + ai + logic verdes).

- [ ] **Step 5: Commit**

```bash
git add js/abilities.js test/abilities.test.js
git commit -m "feat(abilities): bootstrap nucleo puro + AB/KEY/createAbilities"
```

---

### Task 2: `tickEnergy` (relleno + caducidad)

**Files:**
- Modify: `js/abilities.js`
- Test: `test/abilities.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/abilities.test.js`:

```js
import { tickEnergy } from '../js/abilities.js';

test('tickEnergy rellena con regen y stalk, clamp a 1', () => {
  const ab = createAbilities();
  tickEnergy(ab, 1, { nearSurvivor: false });
  assert.ok(Math.abs(ab.energy - AB.ENERGY_REGEN) < 1e-9);
  tickEnergy(ab, 1, { nearSurvivor: true });
  assert.ok(Math.abs(ab.energy - (AB.ENERGY_REGEN * 2 + AB.STALK_BONUS)) < 1e-9);
  tickEnergy(ab, 1000, {});
  assert.equal(ab.energy, 1); // clamp
});

test('tickEnergy baja cooldowns y spectral, y caduca trampas/decoy', () => {
  const ab = createAbilities();
  ab.cooldowns.teleport = 2; ab.spectral = 1.5;
  ab.traps = [{ gx: 1, gz: 1, t: 0.5 }, { gx: 2, gz: 2, t: 3 }];
  ab.decoy = { gx: 4, gz: 4, t: 0.4 };
  tickEnergy(ab, 1, {});
  assert.ok(Math.abs(ab.cooldowns.teleport - 1) < 1e-9);
  assert.ok(Math.abs(ab.spectral - 0.5) < 1e-9);
  assert.equal(ab.traps.length, 1);        // la de 0.5 caducó
  assert.equal(ab.traps[0].gx, 2);
  assert.equal(ab.decoy, null);            // caducó
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `tickEnergy is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/abilities.js`:

```js
// Avanza energía (regen + bonus de acecho, clamp 0..1), baja cooldowns y el
// temporizador de visión espectral, y caduca trampas/señuelo.
export function tickEnergy(ab, dt, ctx = {}, p = AB) {
  ab.energy = clamp01(ab.energy + (p.ENERGY_REGEN + (ctx.nearSurvivor ? p.STALK_BONUS : 0)) * dt);
  for (const k in ab.cooldowns) ab.cooldowns[k] = Math.max(0, ab.cooldowns[k] - dt);
  if (ab.spectral > 0) ab.spectral = Math.max(0, ab.spectral - dt);
  for (const t of ab.traps) t.t -= dt;
  ab.traps = ab.traps.filter((t) => t.t > 0);
  if (ab.decoy) { ab.decoy.t -= dt; if (ab.decoy.t <= 0) ab.decoy = null; }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/abilities.js test/abilities.test.js
git commit -m "feat(abilities): tickEnergy (relleno + caducidad)"
```

---

### Task 3: `canActivate` (gate de energía/cooldown; espectral en cacería)

**Files:**
- Modify: `js/abilities.js`
- Test: `test/abilities.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/abilities.test.js`:

```js
import { canActivate } from '../js/abilities.js';

test('canActivate respeta energía y cooldown', () => {
  const ab = createAbilities();
  assert.equal(canActivate(ab, KEY.TELEPORT), false); // energía 0
  ab.energy = 1;
  assert.equal(canActivate(ab, KEY.TELEPORT), true);
  ab.cooldowns.teleport = 1;
  assert.equal(canActivate(ab, KEY.TELEPORT), false); // en cooldown
});

test('canActivate de visión espectral solo en cacería, sin coste de energía', () => {
  const ab = createAbilities(); // energía 0
  assert.equal(canActivate(ab, KEY.SPECTRAL, { hunting: false }), false);
  assert.equal(canActivate(ab, KEY.SPECTRAL, { hunting: true }), true);
  ab.cooldowns.spectral = 1;
  assert.equal(canActivate(ab, KEY.SPECTRAL, { hunting: true }), false);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `canActivate is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/abilities.js`:

```js
const COST = (p) => ({ teleport: p.COST_TELEPORT, trap: p.COST_TRAP, decoy: p.COST_DECOY, spectral: 0 });

export function canActivate(ab, key, ctx = {}, p = AB) {
  if (ab.cooldowns[key] > 0) return false;
  if (key === 'spectral') return !!ctx.hunting; // hunt-only, sin coste de energía
  return ab.energy >= COST(p)[key];
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/abilities.js test/abilities.test.js
git commit -m "feat(abilities): canActivate (gate energia/cooldown/caceria)"
```

---

### Task 4: `activate` (gasta + cooldown + añade activo)

**Files:**
- Modify: `js/abilities.js`
- Test: `test/abilities.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/abilities.test.js`:

```js
import { activate } from '../js/abilities.js';

test('activate trampa: gasta energía, fija cooldown y añade trampa', () => {
  const ab = createAbilities(); ab.energy = 1;
  assert.equal(activate(ab, KEY.TRAP, [3, 4]), true);
  assert.ok(Math.abs(ab.energy - (1 - AB.COST_TRAP)) < 1e-9);
  assert.equal(ab.cooldowns.trap, AB.CD_TRAP);
  assert.deepEqual(ab.traps, [{ gx: 3, gz: 4, t: AB.TRAP_DUR }]);
});

test('activate señuelo y visión espectral', () => {
  const ab = createAbilities(); ab.energy = 1;
  activate(ab, KEY.DECOY, [5, 6]);
  assert.deepEqual(ab.decoy, { gx: 5, gz: 6, t: AB.DECOY_DUR });
  assert.equal(activate(ab, KEY.SPECTRAL, null, { hunting: true }), true);
  assert.equal(ab.spectral, AB.SPECTRAL_DUR);
});

test('activate falla si no se puede (devuelve false, sin efecto)', () => {
  const ab = createAbilities(); // energía 0
  assert.equal(activate(ab, KEY.TRAP, [1, 1]), false);
  assert.deepEqual(ab.traps, []);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `activate is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/abilities.js`:

```js
// Activa una habilidad si se puede. `cell` = [gx,gz] de la trampa/señuelo (el
// teletransporte mueve `pos` en la integración usando `cell`). Devuelve éxito.
export function activate(ab, key, cell, ctx = {}, p = AB) {
  if (!canActivate(ab, key, ctx, p)) return false;
  ab.cooldowns[key] = { teleport: p.CD_TELEPORT, trap: p.CD_TRAP, decoy: p.CD_DECOY, spectral: p.CD_SPECTRAL }[key];
  if (key !== 'spectral') ab.energy = Math.max(0, ab.energy - COST(p)[key]);
  if (key === 'trap') ab.traps.push({ gx: cell[0], gz: cell[1], t: p.TRAP_DUR });
  else if (key === 'decoy') ab.decoy = { gx: cell[0], gz: cell[1], t: p.DECOY_DUR };
  else if (key === 'spectral') ab.spectral = p.SPECTRAL_DUR;
  return true;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/abilities.js test/abilities.test.js
git commit -m "feat(abilities): activate (gasta/cooldown/activo)"
```

---

### Task 5: `agentInTrap` + `huntReady` + `spendForHunt`

**Files:**
- Modify: `js/abilities.js`
- Test: `test/abilities.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/abilities.test.js`:

```js
import { agentInTrap, huntReady, spendForHunt } from '../js/abilities.js';

test('agentInTrap detecta celdas dentro del radio (Manhattan)', () => {
  const ab = createAbilities();
  ab.traps = [{ gx: 5, gz: 5, t: 10 }];
  assert.equal(agentInTrap(ab, 5, 5), true);
  assert.equal(agentInTrap(ab, 7, 5), true);  // dist 2 == radio
  assert.equal(agentInTrap(ab, 8, 5), false); // dist 3 > radio
});

test('huntReady y spendForHunt', () => {
  const ab = createAbilities();
  assert.equal(huntReady(ab), false);
  ab.energy = 1;
  assert.equal(huntReady(ab), true);
  spendForHunt(ab);
  assert.equal(ab.energy, 0);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `agentInTrap is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/abilities.js`:

```js
export function agentInTrap(ab, gx, gz, p = AB) {
  for (const t of ab.traps) if (Math.abs(t.gx - gx) + Math.abs(t.gz - gz) <= p.TRAP_RADIUS) return true;
  return false;
}

export function huntReady(ab) { return ab.energy >= 1; }
export function spendForHunt(ab) { ab.energy = 0; }
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/abilities.js test/abilities.test.js
git commit -m "feat(abilities): agentInTrap + huntReady + spendForHunt"
```

---

## Fase B — Integración en `js/main.js`, `index.html`, `css/style.css`

> Verificación manual con servidor local + CDP/headless. Tras cada tarea: `node --check js/main.js` y `npm test` (núcleo verde). Usa **anclas de contenido**, no números de línea.

### Task 6: Estado `ab`, tick por frame, helper de mira

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Importar y crear estado**

En `js/main.js`, junto a `import * as RIT from './ritual.js';`, añade:

```js
import * as ABL from './abilities.js';
```

Junto a `let escalated = false;`, añade:

```js
const ab = ABL.createAbilities();   // energía + habilidades del fantasma
```

- [ ] **Step 2: Helper de celda apuntada (mira)**

Encima de `function update(dt)`, añade:

```js
// Celda transitable a la que mira el fantasma: marcha hacia delante (yaw) hasta
// `maxCells` o hasta toparse con muro; devuelve la última celda abierta.
function aimCell(maxCells) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let last = cellOf(pos.x, pos.z);
  for (let s = 1; s <= maxCells; s++) {
    const wx = pos.x + fx * s * CELL, wz = pos.z + fz * s * CELL;
    const [gx, gz] = cellOf(wx, wz);
    if (isWall(gx, gz)) break;
    last = [gx, gz];
  }
  return last;
}
```

- [ ] **Step 3: Tick de energía por frame**

En `update(dt)`, justo después de `const hunting = updateHunt(dt);`, añade:

```js
  // Energía: gana con el tiempo + bonus si hay un superviviente cerca (acecho).
  let nearSurvivor = false;
  for (const h of hunters) { if (h.alive && Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) < ABL.AB.SENSE_RANGE) { nearSurvivor = true; break; } }
  ABL.tickEnergy(ab, dt, { nearSurvivor });
```

- [ ] **Step 4: Verificación**

Run: `node --check js/main.js && npm test`
Expected: parsea OK; tests verdes. (Aún sin efectos; las siguientes tareas los cablean.)

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat(r3): estado ab + tick de energia + helper de mira"
```

---

### Task 7: Input de habilidades (teclas 1–5 + Espacio)

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Reescribir el handler de keydown**

Sustituye la línea del `addEventListener('keydown', ...)` (la que hoy gestiona `KeyG`/`Digit1`/`KeyO`) por:

```js
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (GAME.state !== 'playing' || document.pointerLockElement !== canvasEl) {
    if (e.code === 'KeyO') debugAI = !debugAI; // overlay sin pointerlock para depurar
    return;
  }
  if (e.code === 'Digit1' || e.code === 'KeyQ') roar();
  else if (e.code === 'Digit2') useTeleport();
  else if (e.code === 'Digit3') useTrap();
  else if (e.code === 'Digit4') useDecoy();
  else if (e.code === 'Digit5') useSpectral();
  else if (e.code === 'Space') tryStartHunt();
  else if (e.code === 'KeyO') debugAI = !debugAI;
});
```

- [ ] **Step 2: Funciones de activación (stubs que se rellenan en Tasks 8–12)**

Encima de `function update(dt)`, añade (las implementaciones completas vienen en las tareas siguientes; defínelas ya para no romper referencias):

```js
function useTeleport() {
  if (!ABL.canActivate(ab, ABL.KEY.TELEPORT)) return;
  const [gx, gz] = aimCell(ABL.AB.TELEPORT_RANGE);
  ABL.activate(ab, ABL.KEY.TELEPORT, [gx, gz]);
  const [wx, wz] = worldOf(gx, gz); pos.x = wx; pos.z = wz;
}
function useTrap() {
  const [gx, gz] = cellOf(pos.x, pos.z);
  if (ABL.activate(ab, ABL.KEY.TRAP, [gx, gz])) { AIB.addEvent(BB, 'trap', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER); spawnTrapMesh(gx, gz); }
}
function useDecoy() {
  const [gx, gz] = aimCell(ABL.AB.TELEPORT_RANGE);
  if (ABL.activate(ab, ABL.KEY.DECOY, [gx, gz])) { AIB.addEvent(BB, 'apparition', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER); }
}
function useSpectral() { ABL.activate(ab, ABL.KEY.SPECTRAL, null, { hunting: hunt.active > 0 }); }
function tryStartHunt() { if (hunt.active <= 0 && ABL.huntReady(ab)) { ABL.spendForHunt(ab); startHunt(); } }
```

- [ ] **Step 3: Stub de `spawnTrapMesh` y registro de mallas**

Encima de las funciones anteriores, añade (el render real se completa en Task 9; este stub evita romper la referencia):

```js
const trapMeshes = [];   // [{gx, gz, mesh}]
let decoyMesh = null;    // malla del señuelo activo
function spawnTrapMesh(gx, gz) {
  const [wx, wz] = worldOf(gx, gz);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, ABL.AB.TRAP_RADIUS * CELL, 24),
    new THREE.MeshBasicMaterial({ color: 0x9d4edd, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.set(wx, 0.05, wz);
  scene.add(ring); trapMeshes.push({ gx, gz, mesh: ring });
}
```

- [ ] **Step 4: Verificación**

Run: `node --check js/main.js`
Expected: parsea OK.

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat(r3): input de habilidades (1-5 + Espacio)"
```

---

### Task 8: Teletransporte — preferir celda oscura + feedback

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: SFX de teletransporte y oscurecer destino**

`useTeleport` ya mueve `pos` (Task 7). Reemplaza `useTeleport` por la versión con SFX:

```js
function useTeleport() {
  if (!ABL.canActivate(ab, ABL.KEY.TELEPORT)) return;
  const [gx, gz] = aimCell(ABL.AB.TELEPORT_RANGE);
  ABL.activate(ab, ABL.KEY.TELEPORT, [gx, gz]);
  const [wx, wz] = worldOf(gx, gz); pos.x = wx; pos.z = wz;
  for (const h of hunters) h.next = null; // sus rutas hacia tu antigua posición caducan
  tone({ type: 'sine', f0: 600, f1: 120, dur: 0.35, vol: 0.4 });
}
```

- [ ] **Step 2: Verificación manual**

Run: `npm run dev` → JUGAR → espera a tener energía → mira a un pasillo y pulsa **2**.
Expected: el fantasma salta a donde miras (no atraviesa muros), suena el SFX, y la energía baja. Sin errores.

- [ ] **Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat(r3): teletransporte a la celda mirada"
```

---

### Task 9: Trampa — ralentiza/desorienta + render + caducidad

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Aplicar el efecto de trampa en `updateHunter`**

En `updateHunter`, justo después de actualizar el miedo (tras el bloque `AIB.updateFear(...)`), añade:

```js
  // Trampa paranormal: dentro del radio, ralentiza + estrés + reruteo.
  const [hgx, hgz] = cellOf(h.pos.x, h.pos.z);
  const trapped = ABL.agentInTrap(ab, hgx, hgz);
  if (trapped) { h.stress = Math.min(1, h.stress + 0.4 * dt); if (Math.random() < 0.02) h.next = null; }
```

Y aplica la ralentización al moverse: localiza las llamadas `stepToward(h, ..., HUNTER_SPEED, dt)` y `stepToward(h, ..., HUNTER_FLEE_SPEED, dt)` dentro de `updateHunter` y multiplícalas por un factor de trampa. Para hacerlo en un único punto, añade al principio de `updateHunter` (tras calcular `trapped`):

```js
  const speedMul = trapped ? 0.5 : 1;
```

y sustituye en ese función `HUNTER_SPEED` por `HUNTER_SPEED * speedMul` y `HUNTER_FLEE_SPEED` por `HUNTER_FLEE_SPEED * speedMul` en las llamadas a `stepToward`.

- [ ] **Step 2: Caducar las mallas de trampa**

En `update(dt)`, junto a `syncRitualMeshes();`, añade una sincronización de trampas:

```js
  // Quita las mallas de trampas que ya caducaron en el estado puro.
  for (let i = trapMeshes.length - 1; i >= 0; i--) {
    const tm = trapMeshes[i];
    if (!ab.traps.some((t) => t.gx === tm.gx && t.gz === tm.gz)) { scene.remove(tm.mesh); trapMeshes.splice(i, 1); }
  }
```

- [ ] **Step 3: Verificación manual (CDP)**

Run: `npm run dev` → JUGAR → coloca una trampa (**3**) en un pasillo por el que pasen supervivientes.
Expected: aparece un anillo morado; los supervivientes que entran se **ralentizan** y se ponen nerviosos; al caducar (~12 s) el anillo desaparece. Sin errores.

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat(r3): trampa ralentiza/desorienta + render + caducidad"
```

---

### Task 10: Aparición — señuelo (render + atracción/susto)

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Render del señuelo + reacción de la IA**

En `update(dt)`, tras el bloque de trampas (Task 9 Step 2), añade la sincronización del señuelo y su efecto:

```js
  // Señuelo (Aparición): luz/sprite temporal; atrae y asusta a los cercanos.
  if (ab.decoy) {
    const [dwx, dwz] = worldOf(ab.decoy.gx, ab.decoy.gz);
    if (!decoyMesh) {
      decoyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), new THREE.MeshBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.7 }));
      scene.add(decoyMesh);
    }
    decoyMesh.position.set(dwx, EYE, dwz);
    decoyMesh.material.opacity = 0.4 + 0.3 * Math.sin(performance.now() * 0.01);
    for (const h of hunters) {
      if (!h.alive) continue;
      if (Math.hypot(h.pos.x - dwx, h.pos.z - dwz) < ABL.AB.SENSE_RANGE) { h.stress = Math.min(1, h.stress + 0.3 * dt); h.next = null; }
    }
  } else if (decoyMesh) { scene.remove(decoyMesh); decoyMesh = null; }
```

- [ ] **Step 2: SFX al lanzar el señuelo**

Reemplaza `useDecoy` por:

```js
function useDecoy() {
  const [gx, gz] = aimCell(ABL.AB.TELEPORT_RANGE);
  if (ABL.activate(ab, ABL.KEY.DECOY, [gx, gz])) { AIB.addEvent(BB, 'apparition', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER); tone({ type: 'triangle', f0: 320, f1: 180, dur: 0.6, vol: 0.35 }); }
}
```

- [ ] **Step 3: Verificación manual**

Run: `npm run dev` → JUGAR → lanza Aparición (**4**) a una zona con supervivientes.
Expected: aparece una esfera morada pulsante; los supervivientes cercanos se ponen nerviosos (estrés) y rerutan; desaparece a los ~8 s. Sin errores.

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat(r3): aparicion (senuelo) render + reaccion IA"
```

---

### Task 11: Visión espectral solo por habilidad (quitar la constante)

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Quitar el revelado automático en cacería**

En `startHunt()`, elimina el `for (const h of hunters) if (h.alive) h.model.setSpectral(true);` (los supervivientes ya **no** se revelan solos). En `updateHunt(dt)`, en la rama `if (escalated) { ... }`, elimina igualmente el `for ... setSpectral(true)` (deja solo `hunt.active = HUNT_DUR; return true;`). En `endHunt()`, mantén el `setSpectral(false)`.

- [ ] **Step 2: Aplicar espectral mientras dure la habilidad**

En `update(dt)`, tras el bloque del señuelo (Task 10), añade:

```js
  // Visión espectral: revela a los supervivientes a través de muros solo mientras
  // dure la habilidad (que solo se activa en cacería).
  const seeThrough = ab.spectral > 0;
  for (const h of hunters) if (h.alive) h.model.setSpectral(seeThrough);
```

- [ ] **Step 3: Verificación manual (CDP)**

Run: `npm run dev` → JUGAR → activa una cacería (energía llena → **Espacio**), luego **5**.
Expected: durante ~6 s ves a los supervivientes **a través de los muros** (glow); fuera de esa ventana NO se ven a través de paredes (ni siquiera en cacería). Sin errores.

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat(r3): vision espectral solo por habilidad (quita constante)"
```

---

### Task 12: Cacería de 45s (activada por energía, +rápido, parpadeo, ritual en pausa)

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Duración 45s y sin auto-temporizador**

Reemplaza `startHunt`/`updateHunt` por:

```js
function startHunt() { hunt.active = ABL.AB.HUNT_DUR; sfx.roar(); duckMusic(true); { const [gx, gz] = cellOf(pos.x, pos.z); AIB.addEvent(BB, 'hunt', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER); } }
function endHunt() { hunt.active = 0; duckMusic(false); for (const h of hunters) if (h.alive) h.model.setSpectral(false); }
function updateHunt(dt) {
  if (escalated) { hunt.active = ABL.AB.HUNT_DUR; return true; }
  if (hunt.active > 0) { hunt.active -= dt; if (hunt.active <= 0) endHunt(); }
  return hunt.active > 0;   // ya NO hay auto-temporizador: la cacería la activa el jugador (Espacio)
}
```

(Elimina la variable `huntTimer` y su uso; ya no se autodispara.) Como `updateHUD` mostraba `huntTimer` en `#nextHunt`, sustituye en `updateHUD(hunting)` la línea `el('nextHunt').textContent = ...huntTimer...` por:

```js
  el('nextHunt').textContent = hunting ? Math.ceil(hunt.active) + 's' : '—';
```

- [ ] **Step 2: Fantasma más rápido en cacería**

En `moveGhost(dt)`, donde se calcula el desplazamiento con `SPEED`, multiplícalo por el factor de cacería. Sustituye `move.normalize().multiplyScalar(SPEED * dt);` por:

```js
    move.normalize().multiplyScalar(SPEED * (hunt.active > 0 ? ABL.AB.HUNT_SPEED_MULT : 1) * dt);
```

- [ ] **Step 3: Parpadeo de luces en cacería**

En `applyAtmosphere()`, en la rama de cacería (no `lit`), añade parpadeo. Sustituye el cuerpo por:

```js
function applyAtmosphere() {
  const lit = hunt.active <= 0;
  ambient.color.setHex(0xbda86a);
  const flicker = lit ? 1 : (Math.random() < 0.2 ? 0.0 : 0.06); // parpadeo en cacería
  ambient.intensity = lit ? 0.85 : flicker;
  hemi.intensity = lit ? 0.5 : 0.02;
  const fogc = 0x1c1808; scene.fog.color.setHex(fogc); scene.background.setHex(fogc);
}
```

- [ ] **Step 4: Ritual en pausa durante la cacería**

En `update(dt)`, en el bloque `if (ritual.phase === RIT.PHASE.CHANNEL) { ... channelTick ... }`, añade el guard de cacería: cambia la condición a `if (ritual.phase === RIT.PHASE.CHANNEL && !hunting)`. Además, en `updateHunter`, en la lógica de depósito (`if (carried) { if (...altar...) RIT.depositCarried(...) }`), envuélvela para no depositar en cacería: `if (carried && !hunting) { ... }`.

- [ ] **Step 5: Verificación manual (CDP)**

Run: `npm run dev` → JUGAR → llena energía → **Espacio**.
Expected: empieza una cacería de ~45 s; las luces **mueren y parpadean**; el fantasma se mueve **más rápido**; durante la cacería el ritual no sube (barra de RITUAL congelada) ni se deposita. Termina sola a los 45 s. Sin errores.

- [ ] **Step 6: Commit**

```bash
git add js/main.js
git commit -m "feat(r3): caceria 45s por energia + mas rapido + parpadeo + ritual en pausa"
```

---

### Task 13: Percepción — aura invisible/visible + sonido de proximidad + evasión por sentido

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Aura tenue en normal / encendida en cacería**

En `moveGhost(dt)`, donde se posiciona `aura`, fija su intensidad según cacería. Tras `aura.position.set(pos.x, h + EYE, pos.z);` añade:

```js
  aura.intensity = hunt.active > 0 ? 1.2 : 0.12; // invisible (tenue) en normal, visible en cacería
```

- [ ] **Step 2: Oscilador de proximidad (sonido)**

En `initAudio()`, antes del cierre `}`, crea un oscilador persistente de "sentido":

```js
  senseOsc = actx.createOscillator(); senseGain = actx.createGain();
  senseOsc.type = 'sine'; senseOsc.frequency.value = 54; senseGain.gain.value = 0.0001;
  senseOsc.connect(senseGain); senseGain.connect(master); senseOsc.start();
```

Declara las variables junto a `let actx = null, master = null, musicEl = null;`:

```js
let senseOsc = null, senseGain = null;
```

- [ ] **Step 3: Volumen del sonido por cercanía (solo normal)**

En `update(dt)`, tras calcular `nearSurvivor` (Task 6), ajusta el volumen del sentido. Añade:

```js
  if (senseGain) {
    let dmin = Infinity;
    for (const h of hunters) if (h.alive) dmin = Math.min(dmin, Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z));
    const prox = hunting ? 0 : Math.max(0, 1 - dmin / ABL.AB.SENSE_RANGE); // 0..1, silenciado en cacería
    senseGain.gain.setTargetAtTime(0.0001 + prox * 0.25, actx.currentTime, 0.1);
  }
```

- [ ] **Step 4: Evasión gradual por sentido (IA, normal)**

En `updateHunter`, tras calcular el miedo y la trampa, añade la evasión por proximidad (solo fuera de cacería):

```js
  // Sentido del fantasma (invisible): cuanto más cerca, más se alejan. Nunca van hacia él.
  if (!hunting) {
    const dG = Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z);
    if (dG < SENSE_RANGE_W) { const prox = 1 - dG / SENSE_RANGE_W; h.flee = Math.max(h.flee, 0.3 + prox * 1.2); h.next = null; }
  }
```

Declara la constante junto a las demás de `updateHunter` (p. ej. cerca de `GHOST_FEAR_RANGE`):

```js
const SENSE_RANGE_W = ABL.AB.SENSE_RANGE;
```

(La rama `else if (h.flee > 0)` de R1 ya los hace huir lejos del fantasma a `HUNTER_FLEE_SPEED`: eso es la evasión.)

- [ ] **Step 5: Verificación manual (CDP)**

Run: `npm run dev` → JUGAR → acércate despacio a un superviviente en juego normal.
Expected: el **aura está tenue** (casi invisible); al acercarte sube un **zumbido** y el superviviente **se aleja** sin acercarse nunca; en cacería el aura se enciende y el zumbido se calla. Sin errores.

- [ ] **Step 6: Commit**

```bash
git add js/main.js
git commit -m "feat(r3): percepcion invertida (aura + sonido proximidad + evasion)"
```

---

### Task 14: HUD — barra de energía + 5 slots

**Files:**
- Modify: `index.html`, `css/style.css`, `js/main.js`

- [ ] **Step 1: Markup del HUD**

En `index.html`, sustituye el bloque `<div id="abilities">…</div>` por:

```html
    <div id="energyWrap"><div id="energyBar"></div><span id="energyLabel">ENERGÍA</span></div>
    <div id="abilities">
      <div class="abil" id="ab1"><span class="k">1</span><span class="n">Rugido</span><span class="cd" id="cd1">LISTO</span></div>
      <div class="abil" id="ab2"><span class="k">2</span><span class="n">Teletransporte</span><span class="cd" id="cd2">LISTO</span></div>
      <div class="abil" id="ab3"><span class="k">3</span><span class="n">Trampa</span><span class="cd" id="cd3">LISTO</span></div>
      <div class="abil" id="ab4"><span class="k">4</span><span class="n">Aparición</span><span class="cd" id="cd4">LISTO</span></div>
      <div class="abil" id="ab5"><span class="k">5</span><span class="n">Espectral</span><span class="cd" id="cd5">CAZA</span></div>
    </div>
```

- [ ] **Step 2: CSS de la barra de energía**

En `css/style.css`, añade al final:

```css
#energyWrap { position: absolute; left: 50%; bottom: 92px; transform: translateX(-50%); width: 320px; height: 14px; background: #1a1206; border: 1px solid #6b5a1f; border-radius: 7px; overflow: hidden; }
#energyBar { height: 100%; width: 0%; background: linear-gradient(90deg, #6d28a8, #c77dff); transition: width 0.1s linear; }
#energyLabel { position: absolute; left: 50%; top: -1px; transform: translateX(-50%); font: 10px/14px monospace; color: #e9d8ff; letter-spacing: 2px; }
#energyWrap.ready { box-shadow: 0 0 12px #c77dff; }
.abil.dim { opacity: 0.4; }
```

- [ ] **Step 3: Actualizar el HUD por frame**

En `updateHUD(hunting)`, antes del cierre, añade:

```js
  const eb = el('energyBar'); if (eb) eb.style.width = Math.round(ab.energy * 100) + '%';
  const ew = el('energyWrap'); if (ew) ew.classList.toggle('ready', ABL.huntReady(ab));
  el('energyLabel').textContent = ABL.huntReady(ab) ? 'CACERÍA LISTA [ESPACIO]' : 'ENERGÍA';
  const slot = (id, key, cost) => {
    const cd = ab.cooldowns[key];
    el('cd' + id).textContent = cd > 0 ? cd.toFixed(1) + 's' : 'LISTO';
    el('ab' + id).classList.toggle('dim', cd > 0 || ab.energy < cost);
  };
  slot(2, 'teleport', ABL.AB.COST_TELEPORT); slot(3, 'trap', ABL.AB.COST_TRAP); slot(4, 'decoy', ABL.AB.COST_DECOY);
  el('cd5').textContent = ab.cooldowns.spectral > 0 ? ab.cooldowns.spectral.toFixed(1) + 's' : (hunting ? 'LISTO' : 'CAZA');
  el('ab5').classList.toggle('dim', !hunting || ab.cooldowns.spectral > 0);
```

(El slot 1 "Rugido" sigue usando `cd1`/`roarCd` como hoy.)

- [ ] **Step 4: Verificación manual**

Run: `npm run dev` → JUGAR.
Expected: la **barra de energía** sube; al llenarse, brilla y pone "CACERÍA LISTA [ESPACIO]"; los slots 2–4 se **atenúan** sin energía o en cooldown y muestran el cooldown; el slot 5 está atenuado fuera de cacería. Sin errores.

- [ ] **Step 5: Commit**

```bash
git add index.html css/style.css js/main.js
git commit -m "feat(r3): HUD barra de energia + 5 slots de habilidad"
```

---

### Task 15: Verificación integral + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: `node --test`**

Run: `npm test`
Expected: PASS (abilities + ritual + ai + logic).

- [ ] **Step 2: Verificación integral (CDP/headless + manual)**

Run: `npm run dev` y revisa:
- La barra de energía se llena; **2** teletransporta a donde miras; **3** pone trampa (ralentiza a quien entra); **4** señuelo (atrae/asusta); **Espacio** inicia cacería solo con barra llena (45 s, +rápido, parpadeo, huyen al verte); **5** visión espectral solo en cacería (a través de muros un rato).
- En juego normal el **aura está tenue**, sube un **zumbido** al acercarte y los supervivientes **te evitan sin acercarse nunca**.
- El ritual **se pausa** durante la cacería.
- FPS estable; consola sin errores.

- [ ] **Step 3: README — controles + estado**

En `README.md`, en la tabla de controles, sustituye las filas de habilidades por:

```markdown
| `1` / clic | Rugido (susto; revela al más lejano) |
| `2` | Teletransporte (a donde miras) |
| `3` | Trampa paranormal (en tu celda) |
| `4` | Aparición (señuelo donde miras) |
| `5` | Visión espectral (solo en cacería) |
| `Espacio` | Cacería (si la barra de energía está llena) |
| `O` | Overlay de depuración de la IA |
```

Y actualiza el bloque de estado:

```markdown
> **Estado:** R3 — kit del fantasma + cacería de 45s + percepción invertida: invisible y te sienten por sonido en normal (te evitan); visible y +rápido en cacería; Energía Paranormal, Teletransporte/Trampa/Aparición/Visión espectral.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: actualiza controles y estado (R3)"
```

---

## Self-Review (cobertura del spec)

| Requisito del spec | Tarea(s) |
|---|---|
| `abilities.js`: energía + createAbilities | Task 1 |
| tickEnergy (relleno+stalk+caducidad) | Task 2 |
| canActivate (gate energía/cd; espectral en cacería) | Task 3 |
| activate (gasta/cd/activo) | Task 4 |
| agentInTrap + huntReady + spendForHunt | Task 5 |
| Estado `ab` + tick + mira | Task 6 |
| Input 1–5 + Espacio | Task 7 |
| Teletransporte | Task 7, Task 8 |
| Trampa (ralentiza/desorienta + render + caducidad) | Task 7, Task 9 |
| Aparición (señuelo + reacción IA) | Task 7, Task 10 |
| Visión espectral solo por habilidad (quita constante) | Task 11 |
| Cacería 45s + energía + +rápido + parpadeo + ritual en pausa | Task 12 |
| Percepción: aura invisible/visible + sonido proximidad + evasión IA | Task 13 |
| HUD: barra de energía + 5 slots | Task 14 |
| Verificación node --test + CDP | Tasks 1-5 (node), 8-15 (manual) |
| Parry (R4) | Fuera de alcance: costura intacta (no se toca el kill) |

**Consistencia de tipos:** `ab` es el objeto de `createAbilities`; claves de habilidad `ABL.KEY.*` (`'teleport'|'trap'|'decoy'|'spectral'`); constantes `ABL.AB.*`. `activate(ab, key, cell, ctx)` y `canActivate(ab, key, ctx)` reciben `ctx.hunting` solo para la espectral. `agentInTrap(ab, gx, gz)` usa radio Manhattan. La integración importa el módulo como `import * as ABL from './abilities.js'`.

**Notas:** la cacería deja de autodispararse (se elimina `huntTimer`); la escalada (R2) la mantiene. La visión espectral constante de la cacería se sustituye por la habilidad. El sonido no se verifica por CDP (sin audio en headless); se valida sin errores y el feel manualmente.

---

## Execution Handoff

Tras guardar el plan, elige cómo ejecutarlo (ver final del mensaje).
