# Rebanada 6 — Observación/Marcado + KO/Mori + rutinas + fix huida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el rugido por la Observación (marcar a un objetivo mirándolo; marcado = kill de 1 golpe en cacería; sin marca = 2 vidas → KO → reanimación de compañeros o Memento Mori con E), dar rutinas complementarias (REPAIR/SCOUT/RESCUER) y arreglar la huida para que ningún bot tome rutas que lo acerquen al fantasma.

**Architecture:** Núcleos puros: `abilities.js` gana el estado de observación (target + progreso por bot), `logic.js` gana `hitResult`/`canRevive`, `ritual.js` gana SCOUT (en MISSIONS) y el override RESCUER por necesidad (ctx con KOs). `main.js` integra: selección/LOS de observación por grid, golpes con vidas/KO en el kill path, canal de reanimación, mori con E, `fleeTargetOf` (huida con primer paso alejándose) y HUD/minimapa. El rugido y el efecto `shaken` se eliminan.

**Tech Stack:** JS vanilla ESM, Three.js 0.160 CDN (sin build), `node --test`, verificación CDP/headless.

**Spec:** `docs/superpowers/specs/2026-06-11-observacion-ko-rutinas-design.md`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `js/abilities.js` + test | Estado de observación (`observe`), `setObserveTarget`/`tickObserve`/`obsProgress`/`isMarked`; constantes OBS_*. | Modificar |
| `js/logic.js` + test | `hitResult(marked, lives)`, `canRevive(distGhost, blockRange)`. | Modificar |
| `js/ritual.js` + test | `RROLE.SCOUT`/`RESCUER`; MISSIONS = 1 SCOUT + resto REPAIR; override RESCUER con KOs (ctx). | Modificar |
| `js/main.js` | Quitar rugido/shaken; observación (input 1, LOS por grid, marca visual); vidas/KO/golpe; revive; mori (E); fleeTargetOf; HUD/minimapa. | Modificar |
| `index.html` | Slot 1 = Observación; overlay `#morifx`; tip `#moriTip`. | Modificar |
| `css/style.css` | Estilos de `#morifx`/`#moriTip`. | Modificar |
| `README.md` | Estado + controles. | Modificar |

---

## Fase A — Núcleos puros (TDD)

### Task 1: Observación en `abilities.js`

**Files:** Modify `js/abilities.js`; Test `test/abilities.test.js`.

- [ ] **Step 1: Tests que fallan** — añadir a `test/abilities.test.js`:

```js
import { setObserveTarget, tickObserve, obsProgress, isMarked } from '../js/abilities.js';

test('observación: sube con visible, persiste al cambiar de objetivo, marca al 100%', () => {
  const ab = createAbilities();
  assert.equal(obsProgress(ab, 3), 0);
  tickObserve(ab, 1, { visible: true });            // sin target -> no sube
  setObserveTarget(ab, 3);
  tickObserve(ab, 1, { visible: false });           // sin visión -> no sube
  assert.equal(obsProgress(ab, 3), 0);
  tickObserve(ab, 1, { visible: true });
  assert.ok(Math.abs(obsProgress(ab, 3) - AB.OBS_RATE) < 1e-9);
  setObserveTarget(ab, 5);                          // cambia de objetivo
  tickObserve(ab, 1, { visible: true });
  assert.ok(obsProgress(ab, 3) > 0);                // el progreso de 3 persiste
  setObserveTarget(ab, 3);
  tickObserve(ab, 1000, { visible: true });         // clamp a 1
  assert.equal(obsProgress(ab, 3), 1);
  assert.equal(isMarked(ab, 3), true);
  assert.equal(isMarked(ab, 5), false);
});
```

- [ ] **Step 2:** Run `npm test` → FAIL (`setObserveTarget is not a function`).
- [ ] **Step 3: Implementación** — en `js/abilities.js`: añadir a `AB`:

```js
  OBS_RANGE: 25,         // unidades de mundo: alcance de la observación
  OBS_RATE: 1 / 12,      // progreso/seg mirando al objetivo (100% en ~12 s)
```

en `createAbilities()` añadir `observe: { target: null, progress: {} },` y al final del módulo:

```js
// Observación: el fantasma fija un objetivo; mirándolo (visible) su progreso
// sube hasta 1 (MARCADO). El progreso es por superviviente y persiste.
export function setObserveTarget(ab, id) { ab.observe.target = id; }
export function tickObserve(ab, dt, ctx = {}, p = AB) {
  const t = ab.observe.target;
  if (t == null || !ctx.visible) return;
  ab.observe.progress[t] = Math.min(1, (ab.observe.progress[t] || 0) + dt * p.OBS_RATE);
}
export function obsProgress(ab, id) { return ab.observe.progress[id] || 0; }
export function isMarked(ab, id) { return obsProgress(ab, id) >= 1; }
```

- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `git add js/abilities.js test/abilities.test.js && git commit -m "feat(obs): estado de observacion + marcado en abilities"`

### Task 2: `hitResult` + `canRevive` en `logic.js`

**Files:** Modify `js/logic.js`; Test `test/logic.test.js`.

- [ ] **Step 1: Tests que fallan** — añadir a `test/logic.test.js`:

```js
import { hitResult, canRevive } from '../js/logic.js';

test('hitResult: marcado muere de 1 golpe; sin marca 2 vidas -> herido -> KO', () => {
  assert.deepEqual(hitResult(true, 2), { outcome: 'dead', lives: 0 });
  assert.deepEqual(hitResult(false, 2), { outcome: 'wounded', lives: 1 });
  assert.deepEqual(hitResult(false, 1), { outcome: 'down', lives: 0 });
});

test('canRevive: solo si el fantasma esta lejos', () => {
  assert.equal(canRevive(10, 9), true);
  assert.equal(canRevive(5, 9), false);
});
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementación** — al final de `js/logic.js`:

```js
// Resultado de un golpe en cacería: marcado = muerte directa; sin marca, pierde
// una vida y con la última cae derribado (KO), no muerto.
export function hitResult(marked, lives) {
  if (marked) return { outcome: 'dead', lives: 0 };
  const left = lives - 1;
  return left <= 0 ? { outcome: 'down', lives: 0 } : { outcome: 'wounded', lives: left };
}

// Reanimar a un KO solo es posible si el fantasma no está cerca.
export function canRevive(distGhost, blockRange) { return distGhost >= blockRange; }
```

- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `git commit -am "feat(combate): hitResult + canRevive puros"`

### Task 3: SCOUT + override RESCUER en `ritual.js`

**Files:** Modify `js/ritual.js`; Test `test/ritual.test.js`.

- [ ] **Step 1: Tests que fallan** — añadir a `test/ritual.test.js`:

```js
test('MISSIONS: 1 SCOUT (el más valiente) + resto REPAIR', () => {
  const r = createRitual([[1, 1], [2, 2]], [[5, 5]], [0, 0]);
  const agents = [0, 1, 2, 3].map((i) => ({ id: i, alive: true, ko: false, bravery: i / 3, gx: i, gz: 0 }));
  const roles = assignRitualRoles(agents, r, 0);
  assert.equal(roles.get(3), RROLE.SCOUT);          // el más valiente
  assert.equal(roles.get(0), RROLE.REPAIR);
  assert.equal(roles.get(1), RROLE.REPAIR);
});

test('override RESCUER: con un KO, el activo más cercano acude (en cualquier fase)', () => {
  const r = createRitual([[1, 1]], [[5, 5]], [0, 0]); // MISSIONS
  const agents = [
    { id: 0, alive: true, ko: false, bravery: 0.9, gx: 9, gz: 0 },
    { id: 1, alive: true, ko: true, bravery: 0.5, gx: 5, gz: 5 },  // KO
    { id: 2, alive: true, ko: false, bravery: 0.1, gx: 5, gz: 4 }, // el más cercano al KO
  ];
  const roles = assignRitualRoles(agents, r, 0, { koIds: [1] });
  assert.equal(roles.get(2), RROLE.RESCUER);
  assert.equal(roles.has(1), false);                // el KO no recibe rol
});
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementación** — en `js/ritual.js`: añadir a `RROLE` → `SCOUT: 'SCOUT', RESCUER: 'RESCUER'`. En `assignRitualRoles(agents, ritual, threat, ctx = {})`:
  - `const alive = agents.filter((a) => a.alive && !a.ko);` (los KO no reciben rol).
  - Rama MISSIONS: ordenar `alive` por valentía desc; el primero → `SCOUT`, el resto → `REPAIR`.
  - Tras calcular los roles de la fase (todas las ramas), aplicar el override: para cada `koId` de `ctx.koIds || []`, el agente activo más cercano al KO que no sea ya RESCUER ni CHANNELER pasa a `RESCUER`:

```js
  // Override por necesidad: alguien KO -> el activo más cercano acude a reanimar.
  const kos = (ctx.koIds || []).map((id) => agents.find((a) => a.id === id)).filter(Boolean);
  for (const k of kos) {
    let best = null, bd = Infinity;
    for (const a of alive) {
      const r0 = out.get(a.id);
      if (r0 === RROLE.RESCUER || r0 === RROLE.CHANNELER) continue;
      const d = Math.abs(a.gx - k.gx) + Math.abs(a.gz - k.gz);
      if (d < bd) { bd = d; best = a; }
    }
    if (best) out.set(best.id, RROLE.RESCUER);
  }
  return out;
```

  (Reestructurar la función para que todas las ramas dejen `out` y caigan al override antes del `return` único.)
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `git commit -am "feat(rutinas): SCOUT en MISSIONS + override RESCUER con KOs"`

---

## Fase B — Integración (`main.js`, `index.html`, `css`)

> Tras cada tarea: `node --check js/main.js` + `npm test`. Anclas de contenido, no líneas.

### Task 4: Quitar rugido + shaken; observación (input 1 + LOS + tick + marca visual)

- [ ] **Step 1: Quitar rugido/shaken** en `js/main.js`:
  - Eliminar la función `roar()` entera y sus bindings: en keydown `if (e.code === 'Digit1' || e.code === 'KeyQ') roar();` y el `addEventListener('mousedown', ...)` que llama a `roar()`.
  - Eliminar `roarCd`, `ROAR_CD`, `REVEAL_DUR`, `revealTimer`, `revealedBot` y sus usos (decay en `update`, dibujo del revelado en `drawMinimap`, slot `cd1` por roarCd en `updateHUD`).
  - Eliminar `SHAKEN_DUR`/`SHAKEN_SLOW`, el campo `shaken: 0` de `makeHunters`, el decay y `shakenSlow` de `updateHunter` (la trampa mantiene su 0.5), y el `* shakenSlow` de `workMission` (queda `REPAIR_RATE`).
  - `ROAR_INTERRUPT_WINDOW` y su uso en el tick de canalización: la interrupción por rugido desaparece; queda solo `hunt.active > 0` como `ghostNear` *(la cacería en el altar sigue interrumpiendo)*: `const ghostNear = Math.hypot(...) <= ... && hunt.active > 0;`.

- [ ] **Step 2: Estado + LOS por grid + selección.** Junto a `const ab = ABL.createAbilities();` añadir:

```js
let moriT = 0, moriTarget = null;   // ejecución en curso (Memento Mori)
const HIT_COOLDOWN = 1.5;           // s entre golpes al mismo bot
const LIVES_UNMARKED = 2;
const REVIVE_TIME = 4;              // s de canal de reanimación
const REVIVE_BLOCK = 9;             // u: el fantasma cerca bloquea reanimar
const MORI_RANGE = 1.6, MORI_TIME = 2;
const FLEE_RADIUS = 14;             // celdas: anillo de candidatas de huida

// Línea de visión por grid: muestrea el segmento (sin THREE.Raycaster).
function gridLOS(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(d / (CELL * 0.5)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const [gx, gz] = cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    if (isWall(gx, gz)) return false;
  }
  return true;
}

// Tecla 1: fija como objetivo de observación al bot vivo no-KO más alineado con la mira.
function selectObserveTarget() {
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  let best = null, bs = 0.92; // cos ~23°
  for (const h of hunters) {
    if (!h.alive || h.ko) continue;
    const to = new THREE.Vector3(h.pos.x - pos.x, 0, h.pos.z - pos.z);
    const d = to.length(); if (d < 0.5 || d > ABL.AB.OBS_RANGE) continue;
    to.normalize();
    const dot = to.dot(fwd);
    if (dot > bs && gridLOS(pos.x, pos.z, h.pos.x, h.pos.z)) { bs = dot; best = h; }
  }
  if (best) { ABL.setObserveTarget(ab, best.id); sfx.parry(); }
}
```

  En el keydown, donde estaba el rugido: `if (e.code === 'Digit1' || e.code === 'KeyQ') selectObserveTarget();`

- [ ] **Step 3: Tick + marca visual.** En `update(dt)`, tras `ABL.tickEnergy(...)`:

```js
  // Observación: sube si el objetivo está vivo, a rango, con LOS y en el cono de visión.
  {
    const t = hunters.find((x) => x.id === ab.observe.target);
    let visible = false;
    if (t && t.alive && !t.ko) {
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
      if (d <= ABL.AB.OBS_RANGE && gridLOS(pos.x, pos.z, t.pos.x, t.pos.z)) {
        const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const to = new THREE.Vector3(t.pos.x - pos.x, 0, t.pos.z - pos.z).normalize();
        visible = to.dot(fwd) > 0.5; // cono ~60°
      }
    }
    ABL.tickObserve(ab, dt, { visible });
    for (const h of hunters) if (h.alive) h.model.setMarked(ABL.isMarked(ab, h.id));
  }
```

  En `js/hunters.js` (`HunterModel`): añadir `this._markSpr = null;` al constructor y el método:

```js
  // Indicador de MARCADO (rombo rojo sobre la cabeza), visible solo en línea de visión.
  setMarked(on) {
    if (on && !this._markSpr) {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d'); g.fillStyle = '#ff2040';
      g.beginPath(); g.moveTo(16, 2); g.lineTo(30, 16); g.lineTo(16, 30); g.lineTo(2, 16); g.closePath(); g.fill();
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true, transparent: true }));
      spr.scale.set(0.3, 0.3, 1); spr.position.set(0, 2.45, 0);
      this.root.add(spr); this._markSpr = spr;
    } else if (!on && this._markSpr) { this.root.remove(this._markSpr); this._markSpr = null; }
  }
```

  (y `setMarked() {}` no-op en `makeBoxHunter`).
- [ ] **Step 4:** `node --check js/main.js && node --check js/hunters.js && npm test` → OK/PASS.
- [ ] **Step 5:** `git add -A && git commit -m "feat(obs): observacion sustituye al rugido (input/LOS/tick/marca)"`

### Task 5: Vidas/KO en el golpe + reset por cacería

- [ ] **Step 1: Campos.** En `makeHunters` añadir `lives: 2, ko: false, reviveT: 0, hitCd: 0,` (junto a `parryUsed`). En `startHunt()` (junto al reset de parry): `for (const h of hunters) if (h.alive) { h.lives = LIVES_UNMARKED; h.hitCd = 0; }`.
- [ ] **Step 2: KO inerte.** Al principio de `updateHunter` (tras `if (!h.alive ...) return;` o equivalente):

```js
  if (h.ko) { h.model.setState({ alive: false }); h.model.update(dt); return; } // KO: tirado, no actúa
```

  *(El estado `alive:false` reproduce el clip `Death` y lo clampa — sirve como pose de derribado.)*
- [ ] **Step 3: Golpe con vidas.** En la rama `if (hunting)`, sustituir el bloque de kill por:

```js
    if (h.hitCd > 0) h.hitCd -= dt;
    if (ghostOnFloor0 && stun <= 0 && h.hitCd <= 0 && Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z) < KILL_RANGE) {
      if (!h.parryUsed) {
        h.parryUsed = true;
        if (rollParry(parryChance(h.bravery, h.panic, PARRY))) {
          stun = STUN_DUR; h.flee = PARRY_FLEE; h.next = null;
          h.model.play('HitRecieve'); h.model.showBark('¡Bloqueado!'); sfx.parry();
          return;
        }
      }
      const r = hitResult(ABL.isMarked(ab, h.id), h.lives);
      h.lives = r.lives; h.hitCd = HIT_COOLDOWN;
      if (r.outcome === 'dead') { killHunter(h); return; }
      if (r.outcome === 'down') { enterKO(h); return; }
      // herido: pierde vida, grito y burst de escape
      h.model.play('HitRecieve'); h.model.showBark('¡AGH!'); sfx.kill();
      h.flee = 2.5; h.next = null;
      return;
    }
```

  Y encima de `killHunter`, añadir:

```js
// Derribo (KO): no muere — queda en el suelo esperando reanimación o el mori.
function enterKO(h) {
  h.ko = true; h.reviveT = 0; h.working = -1;
  { const [gx, gz] = cellOf(h.pos.x, h.pos.z); RIT.dropCarried(ritual, h.id, gx, gz); }
  { const [gx, gz] = cellOf(h.pos.x, h.pos.z); AIB.addEvent(BB, 'down', gx, gz, GAME.timeLeft, AIB.AI.DEATH_DANGER); }
  h.model.setSpectral(false); h.model.play('Death'); sfx.kill();
}
```

- [ ] **Step 4: KO no canaliza/cuenta.** En el tick de canalización, el conteo `h.alive` pasa a `h.alive && !h.ko`. En `runCoordinator`, los agentes llevan `ko: h.ko` y `ctx` con KOs:

```js
  const roles = RIT.assignRitualRoles(
    hunters.map((h) => { const [gx, gz] = cellOf(h.pos.x, h.pos.z); return { id: h.id, alive: h.alive, ko: !!h.ko, bravery: h.bravery, gx, gz }; }),
    ritual, threat, { koIds: hunters.filter((h) => h.alive && h.ko).map((h) => h.id) }
  );
```

- [ ] **Step 5:** checks + `git commit -am "feat(combate): vidas/KO en el golpe + reset por caceria"`

### Task 6: Reanimación (RESCUER) + SCOUT con alarma

- [ ] **Step 1: Candidatos.** En `buildCandidates`, añadir casos:

```js
    case RIT.RROLE.RESCUER: {
      const k = hunters.find((x) => x.alive && x.ko);
      cands = k ? [{ gx: cellOf(k.pos.x, k.pos.z)[0], gz: cellOf(k.pos.x, k.pos.z)[1], bias: 6 }] : [];
      if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 }));
      break;
    }
    case RIT.RROLE.SCOUT: {
      // patrulla entre estaciones de misión (o el altar si no quedan)
      const sites = ritual.missions.length ? ritual.missions : [{ gx: ritual.altar.gx, gz: ritual.altar.gz }];
      const s = sites[Math.floor((performance.now() / 8000) % sites.length)]; // rota de sitio cada ~8s
      cands = [{ gx: s.gx, gz: s.gz, bias: 2 }];
      break;
    }
```

- [ ] **Step 2: Canal de reanimación.** En la rama IA de `updateHunter` (antes del bloque de fase MISSIONS/GATHER), insertar:

```js
    // RESCUER: junto a un KO, canaliza la reanimación (si el fantasma no está cerca).
    if (h.role === RIT.RROLE.RESCUER) {
      const k = hunters.find((x) => x.alive && x.ko);
      if (k && Math.hypot(h.pos.x - k.pos.x, h.pos.z - k.pos.z) <= 1.2) {
        const dG = Math.hypot(ghost.x - k.pos.x, ghost.z - k.pos.z);
        if (canRevive(dG, REVIVE_BLOCK)) {
          h.working = 0; k.reviveT += dt;
          if (k.reviveT >= REVIVE_TIME) { k.ko = false; k.lives = 1; k.reviveT = 0; k.model.play('Idle'); h.model.showBark('¡Arriba!'); }
        } else { h.working = -1; } // el fantasma ronda: espera sin canalizar
        pushRecent(h);
        // sigue al final común (anim/barks) sin stepToward
      } else if (h.goal) { stepToward(h, h.goal, HUNTER_SPEED * speedMul, dt); pushRecent(h); }
    } else if (ritual.phase === RIT.PHASE.MISSIONS) {
```

  *(es decir, RESCUER se antepone a la rama MISSIONS/GATHER existente; importar `canRevive` y `hitResult` junto a `parryChance` en el import de `./logic.js`).*
- [ ] **Step 3: Alarma del SCOUT.** Donde está la evasión por sentido (bloque `if (!hunting) { const dG = ... }`), ampliar para el vigía:

```js
  if (!hunting) {
    const dG = Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z);
    if (dG < SENSE_RANGE_W) {
      const prox = 1 - dG / SENSE_RANGE_W; h.flee = Math.max(h.flee, 0.8 + prox * 1.6); h.next = null;
      if (h.role === RIT.RROLE.SCOUT && (h.alertCd || 0) <= 0) {  // el vigía da la alarma
        h.alertCd = 10;
        const [gx, gz] = cellOf(h.pos.x, h.pos.z);
        AIB.addEvent(BB, 'alert', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER);
        const b = AIB.barkFor(h, 'danger', NOW_SEC, AIB.AI);
        if (b) { h.lastBarkT = b.t; h.model.showBark(b.text); }
      }
    }
    if ((h.alertCd || 0) > 0) h.alertCd -= dt;
  }
```

- [ ] **Step 4:** checks + `git commit -am "feat(rutinas): reanimacion RESCUER + vigia SCOUT con alarma"`

### Task 7: Memento Mori (E) + fix de huida

- [ ] **Step 1: Mori.** En keydown: `else if (e.code === 'KeyE') tryMori();`. Funciones (junto a `useTeleport`):

```js
function tryMori() {
  if (stun > 0 || moriT > 0) return;
  for (const h of hunters) {
    if (!h.alive || !h.ko) continue;
    if (Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) <= MORI_RANGE) { moriT = MORI_TIME; moriTarget = h; sfx.roarHunt(); return; }
  }
}
```

  En `update(dt)`, junto al decay de `stun`:

```js
  if (moriT > 0 && moriTarget) {
    if (!moriTarget.ko || !moriTarget.alive || Math.hypot(moriTarget.pos.x - pos.x, moriTarget.pos.z - pos.z) > MORI_RANGE + 0.6) { moriT = 0; moriTarget = null; }
    else { moriT -= dt; if (moriT <= 0) { moriTarget.ko = false; killHunter(moriTarget); moriTarget = null; } }
  }
```

  En `moveGhost`, primera línea: `if (moriT > 0) return; // clavado durante la ejecución`. Gating de habilidades: añadir `|| moriT > 0` a las guardas `if (stun > 0) return;` de `useTeleport/useTrap/useDecoy/useSpectral/tryStartHunt`. En `sfx` añadir `roarHunt() { tone({ type: 'sawtooth', f0: 60, f1: 28, dur: 1.8, vol: 0.5 }); },`.
  *(Nota: `startHunt` llama `sfx.roar()` — el rugido-habilidad muere pero el SONIDO de la cacería se conserva; mantener `roar()` dentro de `sfx`.)*
- [ ] **Step 2: HUD del mori.** En `index.html` (dentro de `#hud`): `<div id="moriTip" class="hidden">[E] MEMENTO MORI</div>` y `<div id="morifx" class="hidden">EJECUTANDO…</div>`. CSS:

```css
#moriTip { position: absolute; left: 50%; bottom: 140px; transform: translateX(-50%); font: 700 14px monospace; color: #ffd0d0; text-shadow: 0 0 8px #ff3b3b; letter-spacing: 2px; }
#moriTip.hidden, #morifx.hidden { display: none; }
#morifx { position: absolute; inset: 0; pointer-events: none; display: flex; align-items: center; justify-content: center; font: 700 30px/1 monospace; letter-spacing: 6px; color: #fff; text-shadow: 0 0 16px #ff3b3b; box-shadow: inset 0 0 260px 80px rgba(120,0,10,0.8); animation: stunpulse 0.4s ease-in-out infinite; }
```

  En `updateHUD`: `el('moriTip').classList.toggle('hidden', moriT > 0 || !hunters.some((h) => h.alive && h.ko && Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) <= MORI_RANGE));` y `el('morifx').classList.toggle('hidden', moriT <= 0);`. Slot 1: `el('cd1').textContent = ...` → muestra el % del objetivo de observación: `const ot = ab.observe.target; el('cd1').textContent = ot == null ? 'APUNTA+1' : (ABL.isMarked(ab, ot) ? 'MARCADO' : Math.round(ABL.obsProgress(ab, ot) * 100) + '%');`
- [ ] **Step 3: Fix de huida.** Junto a `farthestCell`:

```js
// Celda de huida: candidatas en anillo alrededor del bot, ordenadas por alejarse
// del fantasma; la primera cuyo PRIMER paso BFS no acerque al fantasma gana.
// (Evita rutas que pasan por delante del fantasma.) Fallback: la más lejana global.
function fleeCell(h, ghost) {
  const [hgx, hgz] = cellOf(h.pos.x, h.pos.z);
  const [ggx, ggz] = cellOf(ghost.x, ghost.z);
  const away = Math.atan2(hgz - ggz, hgx - ggx); // dirección de escape
  const tries = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI];
  let bfsBudget = 4;
  for (const off of tries) {
    const ang = away + off;
    const gx = Math.round(hgx + Math.cos(ang) * FLEE_RADIUS), gz = Math.round(hgz + Math.sin(ang) * FLEE_RADIUS);
    if (isWall(gx, gz) || !REACH.set.has(key(gx, gz))) continue;
    if (bfsBudget-- <= 0) break;
    const step = bfsNext(hgx, hgz, gx, gz);
    if (!step) continue;
    const d0 = Math.abs(hgx - ggx) + Math.abs(hgz - ggz);
    const d1 = Math.abs(step[0] - ggx) + Math.abs(step[1] - ggz);
    if (d1 >= d0) return [gx, gz]; // el primer paso ya se aleja: válida
  }
  return farthestCell(ghost.x, ghost.z);
}

// Cachea el destino de huida por bot (recalcula cada ~0.5 s o si se invalida).
function fleeTargetOf(h, ghost, preferred) {
  h.fleeRepath = (h.fleeRepath || 0) - 0.016;
  if (preferred) { // p.ej. celda de dispersión asignada: úsala si su primer paso se aleja
    const [hgx, hgz] = cellOf(h.pos.x, h.pos.z); const [ggx, ggz] = cellOf(ghost.x, ghost.z);
    const step = bfsNext(hgx, hgz, preferred[0], preferred[1]);
    if (step && (Math.abs(step[0] - ggx) + Math.abs(step[1] - ggz)) >= (Math.abs(hgx - ggx) + Math.abs(hgz - ggz))) return preferred;
  }
  if (!h.fleeTarget || h.fleeRepath <= 0) { h.fleeTarget = fleeCell(h, ghost); h.fleeRepath = 0.5; }
  return h.fleeTarget;
}
```

  Sustituir los destinos de huida en `updateHunter`:
  - rama `if (hunting)`: `stepToward(h, fleeTargetOf(h, ghost, dest), HUNTER_FLEE_SPEED * speedMul, dt);` (donde `dest` es el de DISPERSAL).
  - rama `else if (h.flee > 0)`: `stepToward(h, fleeTargetOf(h, ghost), HUNTER_FLEE_SPEED * speedMul, dt);`
  - rama pánico: `const away = fleeTargetOf(h, ghost);` (el jitter se mantiene).
- [ ] **Step 4:** checks + `git commit -am "feat(combate): memento mori (E) + fix de huida (primer paso alejandose)"`

### Task 8: Minimapa/overlay + README + verificación integral

- [ ] **Step 1: Minimapa.** En `drawMinimap` overlay debug: los KO en gris — en el bucle de agentes, antes del fillStyle por rol: `if (h.ko) { mmCtx.fillStyle = '#888'; mmCtx.fillRect((h.pos.x / CELL) * cs - 2, (h.pos.z / CELL) * cs - 2, 4, 4); continue; }` *(usar un `for...of` si era forEach)*. Añadir `SCOUT: '#ffffff', RESCUER: '#ff8ce0'` al mapa `COLR`.
- [ ] **Step 2: index.html.** Slot 1: `<span class="n">Observación</span>` (antes "Rugido") y `<span class="cd" id="cd1">APUNTA+1</span>`; hint del overlay: sustituir "[1] Rugido" por "[1] Observar (marca al 100%) · [E] Mori sobre KO".
- [ ] **Step 3: README.** Controles: fila `1`/clic → `| `1` | Observar al apuntado (al 100% queda MARCADO: muere de 1 golpe en cacería) |` y añadir `| `E` | Memento Mori sobre un derribado |`. Estado:

```markdown
> **Estado:** R6 — observación/marcado + derribo: marca observando (100% = kill de 1 golpe en cacería); sin marca, 2 golpes → KO → los compañeros reaniman si no estás cerca, o lo ejecutas con E (Memento Mori). Rutinas: reparadores + vigía + rescatador. Los que huyen ya nunca corren hacia ti.
```

- [ ] **Step 4: Verificación integral.** `npm test` (todo verde). CDP: marcar y matar de 1 golpe; sin marca 2 golpes → KO; rescate al alejarse; mori con E; huida monótona (dist al fantasma no decrece al huir); tecla 1 selecciona objetivo y la barra sube solo con LOS; 0 errores.
- [ ] **Step 5:** `git add -A && git commit -m "feat(r6): minimapa/HUD/README + verificacion"`

---

## Self-Review (cobertura del spec)

| Requisito | Tarea |
|---|---|
| Observación (target, LOS, progreso persistente, marcado) | T1, T4 |
| Marcado = 1 golpe; sin marca = 2 vidas → KO | T2, T5 |
| KO espera; reanimación si fantasma lejos | T5, T6 |
| Memento Mori (E, ejecución, definitivo) | T7 |
| Quitar rugido (y shaken) | T4 |
| Rutinas complementarias (REPAIR/SCOUT/RESCUER) | T3, T6 |
| Fix de huida (primer paso alejándose; flee/pánico/dispersión) | T7 |
| Parry bloquea golpes, no mori | T5 (orden parry→hitResult), T7 (mori sin parry) |
| Vidas reset por cacería; revivido = 1 vida | T5, T6 |
| HUD (slot1 %/MARCADO, moriTip, morifx) + minimapa | T4, T7, T8 |

**Consistencia:** `ab.observe = {target, progress}`; `ABL.setObserveTarget/tickObserve/obsProgress/isMarked`; `hitResult/canRevive` de `logic.js`; `RROLE.SCOUT/RESCUER`; `assignRitualRoles(agents, ritual, threat, ctx={koIds})` con agentes `{id,alive,ko,bravery,gx,gz}`; campos de agente `lives/ko/reviveT/hitCd/alertCd/fleeTarget/fleeRepath`; constantes `HIT_COOLDOWN/LIVES_UNMARKED/REVIVE_TIME/REVIVE_BLOCK/MORI_RANGE/MORI_TIME/FLEE_RADIUS` en main + `OBS_RANGE/OBS_RATE` en AB.
