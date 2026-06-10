# Rebanada 1 — Cerebro IA de los 8 supervivientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir la IA simple (3 investigadores) por 8 supervivientes que se comporten como un escuadrón humano coordinado: niebla de descubrimiento + memoria compartida, coordinador + utilidad por agente, miedo/pánico recuperable, barks + lenguaje corporal, reacción a eventos y dispersión en cacería.

**Architecture:** Núcleo puro en `js/ai.js` (sin THREE, testeable con `node --test`) con funciones puras sobre datos planos (pizarra + estado de agente). `js/main.js` orquesta: construye la pizarra, llama al coordinador a baja frecuencia y a la utilidad por agente, y mapea decisiones al movimiento/animación ya existentes (`bfsNext`/`stepToward`/`faceDir`). `js/hunters.js` (`HunterModel`) gana burbuja de bark y lenguaje corporal.

**Tech Stack:** JS vanilla ESM, Three.js 0.160 por CDN (sin build), Node test runner (`node --test`) para el núcleo puro, verificación manual en navegador vía CDP/headless (flujo del proyecto).

**Spec:** `docs/superpowers/specs/2026-06-09-ia-8-supervivientes-design.md`.

**Nota de refinamiento sobre el spec:** mantenemos el identificador del array `hunters` (y los nombres `makeHunters`/`updateHunter`/`killHunter`) en `main.js` en lugar de renombrar a `agents`. Motivo: hay un id de DOM `'hunters'` en el HUD y un renombrado global arriesga romperlo; conceptualmente cada elemento es un superviviente-agente y gana los campos nuevos. Es el único desvío respecto a la redacción del spec.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `js/ai.js` | Núcleo puro: pizarra, descubrimiento/frontera, peligro, miedo/pánico, amenaza, coordinador, utilidad, dispersión, barks. Sin THREE. | Crear |
| `test/ai.test.js` | `node --test` del núcleo puro. | Crear |
| `package.json` | Añadir script `test`. | Modificar |
| `js/main.js` | Orquestación: pizarra, ciclo IA, candidatos por rol, integración con movimiento/cacería/HUD, overlay debug. | Modificar |
| `js/hunters.js` | `HunterModel`: burbuja de bark + lenguaje corporal (mirar atrás). | Modificar |
| `index.html` | Contenedor del overlay de depuración (opcional, sobre el HUD). | Modificar |

Las funciones de `ai.js` operan con **claves de celda string** `"gx,gz"` para no depender de `cols` y ser puras. La integración les pasa predicados (`isOpen`) y listas de celdas; nunca importan THREE.

---

## Fase A — Núcleo puro `js/ai.js` (TDD)

### Task 1: Bootstrap del módulo puro + script de test

**Files:**
- Create: `js/ai.js`
- Create: `test/ai.test.js`
- Modify: `package.json`

- [ ] **Step 1: Añadir el script de test**

En `package.json`, dentro de `"scripts"`, añade la línea `test` (deja `dev`/`start` como están):

```json
  "scripts": {
    "dev": "http-server -p 8080 -c-1",
    "start": "http-server -p 8080 -c-1",
    "test": "node --test"
  },
```

- [ ] **Step 2: Escribir el test que falla (claves de celda + pizarra)**

Crea `test/ai.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, parseKey, createBlackboard } from '../js/ai.js';

test('cellKey/parseKey round-trip', () => {
  assert.equal(cellKey(3, 5), '3,5');
  assert.deepEqual(parseKey('3,5'), [3, 5]);
});

test('createBlackboard has empty collections', () => {
  const bb = createBlackboard();
  assert.equal(bb.discovered.size, 0);
  assert.equal(bb.objectives.size, 0);
  assert.equal(bb.danger.size, 0);
  assert.deepEqual(bb.events, []);
  assert.deepEqual(bb.roster, []);
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/ai.js'` (o export indefinido).

- [ ] **Step 4: Implementación mínima**

Crea `js/ai.js`:

```js
// ============================================================
//  Cerebro IA de los supervivientes — núcleo PURO (sin three).
//  Datos planos + funciones puras, testeables con `node --test`.
//  Claves de celda como string "gx,gz" para no depender de cols.
// ============================================================

// Constantes de tuning (todas en un sitio para balancear).
export const AI = {
  VISION_RADIUS: 4,      // celdas (disco Manhattan) que descubre un agente
  DANGER_DECAY: 0.6,     // factor multiplicativo por segundo
  DANGER_MIN: 0.05,      // por debajo se borra
  EVENT_DANGER: 1.0,     // peligro que añade un evento
  DEATH_DANGER: 2.0,     // peligro que añade una muerte
  THREAT_REGROUP: 0.6,   // umbral de amenaza que dispara REGROUP
  PANIC_IN: 0.85,        // estrés de entrada a pánico
  PANIC_SANITY: 0.2,     // cordura máx. para entrar en pánico
  PANIC_OUT: 0.5,        // miedo de salida de pánico (histéresis)
  STRESS_GHOST: 0.5,     // +estrés/seg cerca del fantasma
  STRESS_EVENT: 0.25,    // +estrés por tick de evento cercano
  STRESS_DARK: 0.15,     // +estrés/seg en oscuridad (cacería)
  STRESS_ALONE: 0.10,    // +estrés/seg estando solo
  STRESS_CALM: 0.25,     // -estrés/seg agrupado y seguro
  SANITY_DRAIN: 0.04,    // -cordura/seg bajo estrés sostenido
  SANITY_RECOVER: 0.02,  // +cordura/seg al calmarse
  W_DANGER: 3.0,         // peso de evasión de peligro en utilidad
  W_COHESION: 1.0,       // peso de cohesión con aliados
  W_RECENT: 2.0,         // penalización por celda recién visitada
  W_CURIOSITY: 0.5,      // sesgo de exploración (lo aplica la integración)
  BARK_CD: 4.0,          // cooldown de barks por agente (s)
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const cellKey = (gx, gz) => gx + ',' + gz;
export const parseKey = (k) => k.split(',').map(Number);

export function createBlackboard() {
  return {
    discovered: new Set(),  // claves "gx,gz" vistas por el escuadrón
    objectives: new Map(),  // clave -> {gx, gz, done}
    danger: new Map(),      // clave -> score
    events: [],             // {type, gx, gz, t}
    roster: [],             // estado público por agente (lo llena la integración)
  };
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: PASS (2 tests de ai + los de logic siguen pasando).

- [ ] **Step 6: Commit**

```bash
git add package.json js/ai.js test/ai.test.js
git commit -m "feat(ai): bootstrap nucleo puro + script de test"
```

---

### Task 2: Descubrimiento y frontera (niebla)

**Files:**
- Modify: `js/ai.js`
- Test: `test/ai.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ai.test.js`:

```js
import { discoverAround, computeFrontier } from '../js/ai.js';

const openAll = () => true;

test('discoverAround marca el disco Manhattan de celdas abiertas', () => {
  const bb = createBlackboard();
  const added = discoverAround(bb, 2, 2, 1, openAll);
  assert.equal(added, 5); // centro + 4 vecinas (Manhattan<=1)
  assert.ok(bb.discovered.has('2,2'));
  assert.ok(bb.discovered.has('3,2'));
  assert.ok(!bb.discovered.has('3,3')); // diagonal fuera del disco r=1
});

test('discoverAround respeta isOpen y no recuenta', () => {
  const bb = createBlackboard();
  const isOpen = (x, z) => !(x === 3 && z === 2); // (3,2) es muro
  const added = discoverAround(bb, 2, 2, 1, isOpen);
  assert.equal(added, 4);
  assert.ok(!bb.discovered.has('3,2'));
  assert.equal(discoverAround(bb, 2, 2, 1, isOpen), 0); // ya descubiertas
});

test('computeFrontier devuelve vecinas abiertas no descubiertas', () => {
  const bb = createBlackboard();
  bb.discovered.add('2,2');
  const front = computeFrontier(bb, openAll);
  const keys = front.map(([x, z]) => x + ',' + z).sort();
  assert.deepEqual(keys, ['1,2', '2,1', '2,3', '3,2']);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `discoverAround is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ai.js`:

```js
// Marca como descubiertas las celdas ABIERTAS dentro del disco Manhattan de
// radio `radius` alrededor de (gx,gz). Devuelve cuántas eran nuevas.
export function discoverAround(bb, gx, gz, radius, isOpen) {
  let added = 0;
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dz) > radius) continue;
      const x = gx + dx, z = gz + dz;
      if (!isOpen(x, z)) continue;
      const k = cellKey(x, z);
      if (!bb.discovered.has(k)) { bb.discovered.add(k); added++; }
    }
  return added;
}

// Frontera = celdas ABIERTAS aún no descubiertas, adyacentes (4-vecindad) a una
// descubierta. Es el conjunto de objetivos de exploración.
export function computeFrontier(bb, isOpen) {
  const N = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const front = new Set();
  for (const k of bb.discovered) {
    const [gx, gz] = parseKey(k);
    for (const [dx, dz] of N) {
      const x = gx + dx, z = gz + dz, nk = cellKey(x, z);
      if (isOpen(x, z) && !bb.discovered.has(nk)) front.add(nk);
    }
  }
  return [...front].map(parseKey);
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ai.js test/ai.test.js
git commit -m "feat(ai): niebla de descubrimiento + frontera"
```

---

### Task 3: Zonas de peligro (eventos + decaimiento)

**Files:**
- Modify: `js/ai.js`
- Test: `test/ai.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ai.test.js`:

```js
import { bumpDanger, addEvent, decayDanger, dangerAt } from '../js/ai.js';

test('bumpDanger acumula y dangerAt lee', () => {
  const bb = createBlackboard();
  bumpDanger(bb, 1, 1, 2);
  bumpDanger(bb, 1, 1, 1);
  assert.equal(dangerAt(bb, 1, 1), 3);
  assert.equal(dangerAt(bb, 9, 9), 0);
});

test('addEvent encola y sube el peligro de la celda', () => {
  const bb = createBlackboard();
  addEvent(bb, 'roar', 4, 5, 12.3);
  assert.equal(bb.events.length, 1);
  assert.deepEqual(bb.events[0], { type: 'roar', gx: 4, gz: 5, t: 12.3 });
  assert.equal(dangerAt(bb, 4, 5), AI.EVENT_DANGER);
});

test('decayDanger reduce con el tiempo y borra lo despreciable', () => {
  const bb = createBlackboard();
  bumpDanger(bb, 0, 0, 1);
  decayDanger(bb, 1, 0.5, 0.05); // *0.5 en 1s -> 0.5
  assert.ok(Math.abs(dangerAt(bb, 0, 0) - 0.5) < 1e-9);
  decayDanger(bb, 5, 0.5, 0.05); // *0.5^5 -> ~0.0156 < min -> borrado
  assert.equal(bb.danger.has('0,0'), false);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `bumpDanger is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ai.js`:

```js
export function bumpDanger(bb, gx, gz, amount) {
  const k = cellKey(gx, gz);
  bb.danger.set(k, (bb.danger.get(k) || 0) + amount);
}

export function addEvent(bb, type, gx, gz, t, amount = AI.EVENT_DANGER) {
  bb.events.push({ type, gx, gz, t });
  bumpDanger(bb, gx, gz, amount);
}

export function decayDanger(bb, dt, rate = AI.DANGER_DECAY, min = AI.DANGER_MIN) {
  const f = Math.pow(rate, dt);
  for (const [k, v] of bb.danger) {
    const nv = v * f;
    if (nv < min) bb.danger.delete(k); else bb.danger.set(k, nv);
  }
}

export function dangerAt(bb, gx, gz) {
  return bb.danger.get(cellKey(gx, gz)) || 0;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ai.js test/ai.test.js
git commit -m "feat(ai): zonas de peligro con eventos y decaimiento"
```

---

### Task 4: Miedo, cordura y pánico (con histéresis)

**Files:**
- Modify: `js/ai.js`
- Test: `test/ai.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ai.test.js`:

```js
import { deriveFear, updateFear } from '../js/ai.js';

test('deriveFear sube con estrés/baja cordura y baja con valentía', () => {
  assert.ok(deriveFear(0, 1, 0) === 0);
  const a = deriveFear(0.8, 0.2, 0); // mucho estrés, poca cordura
  const b = deriveFear(0.8, 0.2, 1); // igual pero muy valiente
  assert.ok(a > b);
  assert.ok(a > 0 && a <= 1);
});

test('updateFear entra en PÁNICO con estrés alto y cordura baja', () => {
  const ag = { stress: 0.86, sanity: 0.15, bravery: 0, panic: false };
  const r = updateFear(ag, {}, 0); // dt=0: sin deriva, evalúa umbrales
  assert.equal(r.panic, true);
});

test('updateFear sale de pánico cuando el miedo baja (histéresis)', () => {
  const ag = { stress: 0.3, sanity: 0.9, bravery: 0.5, panic: true };
  const r = updateFear(ag, {}, 0);
  assert.equal(r.panic, false);
});

test('updateFear acumula estrés cerca del fantasma y lo calma agrupado+seguro', () => {
  const ag = { stress: 0.2, sanity: 1, bravery: 0, panic: false };
  const up = updateFear(ag, { nearGhost: true }, 1);
  assert.ok(up.stress > 0.2);
  const ag2 = { stress: 0.5, sanity: 1, bravery: 0, panic: false };
  const down = updateFear(ag2, { grouped: true, safe: true }, 1);
  assert.ok(down.stress < 0.5);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `deriveFear is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ai.js`:

```js
// Miedo derivado de estrés, cordura y valentía (0..1).
export function deriveFear(stress, sanity, bravery) {
  return clamp01(0.6 * stress + 0.4 * (1 - sanity) - 0.25 * bravery);
}

// Actualiza estrés/cordura/miedo/pánico de un agente. PURA: no muta `agent`,
// devuelve {stress, sanity, fear, panic}. ctx: {nearGhost, inEvent, dark,
// alone, grouped, safe}. Pánico con histéresis (entra duro, sale al calmarse).
export function updateFear(agent, ctx, dt, p = AI) {
  let stress = agent.stress, sanity = agent.sanity;
  let up = 0;
  if (ctx.nearGhost) up += p.STRESS_GHOST;
  if (ctx.inEvent) up += p.STRESS_EVENT;
  if (ctx.dark) up += p.STRESS_DARK;
  if (ctx.alone) up += p.STRESS_ALONE;
  const down = (ctx.grouped && ctx.safe) ? p.STRESS_CALM : 0;
  stress = clamp01(stress + (up - down) * dt);
  if (stress > 0.6) sanity = clamp01(sanity - p.SANITY_DRAIN * dt);
  else if (ctx.grouped && ctx.safe) sanity = clamp01(sanity + p.SANITY_RECOVER * dt);
  const fear = deriveFear(stress, sanity, agent.bravery);
  let panic = agent.panic;
  if (!panic && stress >= p.PANIC_IN && sanity <= p.PANIC_SANITY) panic = true;
  else if (panic && fear <= p.PANIC_OUT) panic = false;
  return { stress, sanity, fear, panic };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ai.js test/ai.test.js
git commit -m "feat(ai): miedo/cordura/panico con histeresis"
```

---

### Task 5: Amenaza global + coordinador de roles

**Files:**
- Modify: `js/ai.js`
- Test: `test/ai.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ai.test.js`:

```js
import { computeThreat, assignRoles, ROLES } from '../js/ai.js';

test('computeThreat: cacería dispara reagrupamiento, calma no', () => {
  assert.ok(computeThreat({ hunting: true, recentEvents: 0, deaths: 0, avgFear: 0 }) >= AI.THREAT_REGROUP);
  assert.ok(computeThreat({ hunting: false, recentEvents: 0, deaths: 0, avgFear: 0.1 }) < AI.THREAT_REGROUP);
});

test('assignRoles reparte 8 vivos en 2+2+2+2 por quartiles de valentía', () => {
  const agents = Array.from({ length: 8 }, (_, i) => ({ id: i, alive: true, bravery: i / 7 }));
  const roles = assignRoles(agents, 0);
  const counts = {};
  for (const r of roles.values()) counts[r] = (counts[r] || 0) + 1;
  assert.equal(counts[ROLES.EXPLORE_A], 2);
  assert.equal(counts[ROLES.EXPLORE_B], 2);
  assert.equal(counts[ROLES.GUARD], 2);
  assert.equal(counts[ROLES.SCAVENGE], 2);
  // El más valiente explora; el más miedoso recolecta.
  assert.equal(roles.get(7), ROLES.EXPLORE_A);
  assert.equal(roles.get(0), ROLES.SCAVENGE);
});

test('assignRoles con amenaza alta pone a todos en REGROUP (solo vivos)', () => {
  const agents = [{ id: 0, alive: true, bravery: 0.5 }, { id: 1, alive: false, bravery: 0.5 }];
  const roles = assignRoles(agents, 1);
  assert.equal(roles.get(0), ROLES.REGROUP);
  assert.equal(roles.has(1), false);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `computeThreat is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ai.js`:

```js
export const ROLES = {
  EXPLORE_A: 'EXPLORE_A',
  EXPLORE_B: 'EXPLORE_B',
  GUARD: 'GUARD',
  SCAVENGE: 'SCAVENGE',
  REGROUP: 'REGROUP',
};

// Amenaza global 0..1. ctx: {hunting, recentEvents, deaths, avgFear}.
export function computeThreat(ctx, p = AI) {
  let t = 0;
  if (ctx.hunting) t += 1;
  t += 0.15 * (ctx.recentEvents || 0);
  t += 0.25 * (ctx.deaths || 0);
  t += 0.4 * (ctx.avgFear || 0);
  return Math.min(1, t);
}

// Asigna un rol por agente vivo. Bajo amenaza alta: todos REGROUP. Si no: orden
// por valentía desc y reparto por quartiles -> 2+2+2+2 con 8. Los valientes
// exploran/guardan; los miedosos recolectan acompañados.
export function assignRoles(agents, threat, p = AI) {
  const out = new Map();
  const alive = agents.filter((a) => a.alive);
  if (threat >= p.THREAT_REGROUP) {
    for (const a of alive) out.set(a.id, ROLES.REGROUP);
    return out;
  }
  const sorted = alive.slice().sort((a, b) => b.bravery - a.bravery);
  const order = [ROLES.EXPLORE_A, ROLES.EXPLORE_B, ROLES.GUARD, ROLES.SCAVENGE];
  const n = sorted.length || 1;
  sorted.forEach((a, i) => {
    const q = Math.min(3, Math.floor((i * 4) / n));
    out.set(a.id, order[q]);
  });
  return out;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ai.js test/ai.test.js
git commit -m "feat(ai): amenaza global + coordinador de roles"
```

---

### Task 6: Utilidad — puntuación de celdas y elección de objetivo

**Files:**
- Modify: `js/ai.js`
- Test: `test/ai.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ai.test.js`:

```js
import { scoreCell, chooseGoal } from '../js/ai.js';

const baseAgent = () => ({ fear: 0.2, recentCells: [] });

test('scoreCell penaliza el peligro y escala con el miedo', () => {
  const bb = createBlackboard();
  bumpDanger(bb, 5, 5, 2);
  const ag = baseAgent();
  const calm = scoreCell({ gx: 5, gz: 5, bias: 0 }, ag, bb, [], AI);
  ag.fear = 0.9;
  const scared = scoreCell({ gx: 5, gz: 5, bias: 0 }, ag, bb, [], AI);
  assert.ok(scared < calm); // más miedo -> evita más el peligro
});

test('chooseGoal elige la candidata segura frente a la peligrosa', () => {
  const bb = createBlackboard();
  bumpDanger(bb, 5, 5, 3);
  const goal = chooseGoal(baseAgent(), [{ gx: 0, gz: 0, bias: 0 }, { gx: 5, gz: 5, bias: 0 }], bb, [], AI);
  assert.deepEqual(goal, [0, 0]);
});

test('chooseGoal evita celdas recién visitadas', () => {
  const bb = createBlackboard();
  const ag = baseAgent();
  ag.recentCells = ['0,0'];
  const goal = chooseGoal(ag, [{ gx: 0, gz: 0, bias: 0 }, { gx: 9, gz: 9, bias: 0 }], bb, [], AI);
  assert.deepEqual(goal, [9, 9]);
});

test('chooseGoal con miedo prefiere acercarse a los aliados', () => {
  const bb = createBlackboard();
  const ag = baseAgent();
  ag.fear = 0.9;
  const allies = [{ gx: 1, gz: 1 }];
  const goal = chooseGoal(ag, [{ gx: 2, gz: 2, bias: 0 }, { gx: 9, gz: 9, bias: 0 }], bb, allies, AI);
  assert.deepEqual(goal, [2, 2]);
});

test('chooseGoal sin candidatas devuelve null', () => {
  assert.equal(chooseGoal(baseAgent(), [], createBlackboard(), [], AI), null);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `scoreCell is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ai.js`:

```js
// Puntúa una celda candidata para un agente. `cand` = {gx, gz, bias}, donde
// `bias` lo aporta la integración según el rol (atractivo del objetivo / sesgo
// de exploración). Resta peligro (escalado por miedo), celdas recientes, y
// (con miedo) la distancia a los aliados. Mayor = mejor.
export function scoreCell(cand, agent, bb, allies, p = AI) {
  const { gx, gz } = cand;
  let s = cand.bias || 0;
  s -= p.W_DANGER * dangerAt(bb, gx, gz) * (0.3 + agent.fear);
  if (agent.recentCells && agent.recentCells.includes(cellKey(gx, gz))) s -= p.W_RECENT;
  if (allies && allies.length) {
    let dmin = Infinity;
    for (const a of allies) {
      const d = Math.abs(a.gx - gx) + Math.abs(a.gz - gz);
      if (d < dmin) dmin = d;
    }
    s -= p.W_COHESION * agent.fear * dmin * 0.1;
  }
  return s;
}

// Elige la celda candidata de mayor utilidad. Devuelve [gx,gz] o null.
export function chooseGoal(agent, candidates, bb, allies, p = AI) {
  let best = null, bs = -Infinity;
  for (const c of candidates) {
    const sc = scoreCell(c, agent, bb, allies, p);
    if (sc > bs) { bs = sc; best = c; }
  }
  return best ? [best.gx, best.gz] : null;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ai.js test/ai.test.js
git commit -m "feat(ai): utilidad de celdas + eleccion de objetivo"
```

---

### Task 7: Dispersión en cacería (destinos distintos)

**Files:**
- Modify: `js/ai.js`
- Test: `test/ai.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ai.test.js`:

```js
import { dispersalTargets } from '../js/ai.js';

test('dispersalTargets asigna celdas distintas y lejos del fantasma', () => {
  const agents = [{ id: 0, gx: 1, gz: 1 }, { id: 1, gx: 2, gz: 1 }, { id: 2, gx: 1, gz: 2 }];
  const ghost = { gx: 0, gz: 0 };
  const safe = [{ gx: 9, gz: 9 }, { gx: 8, gz: 1 }, { gx: 1, gz: 8 }, { gx: 0, gz: 1 }];
  const out = dispersalTargets(agents, ghost, safe, AI);
  assert.equal(out.size, 3);
  const cells = [...out.values()].map((c) => c.join(','));
  assert.equal(new Set(cells).size, 3); // todas distintas
  // ninguna es la celda pegada al fantasma (0,1) si hay alternativas
  assert.ok(!cells.includes('0,1'));
});

test('dispersalTargets no asigna más agentes que celdas seguras', () => {
  const agents = [{ id: 0, gx: 0, gz: 0 }, { id: 1, gx: 0, gz: 0 }];
  const out = dispersalTargets(agents, { gx: 5, gz: 5 }, [{ gx: 1, gz: 1 }], AI);
  assert.equal(out.size, 1);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `dispersalTargets is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ai.js`:

```js
// Reparte celdas de escape DISTINTAS para que el fantasma no barra al grupo.
// Procesa primero a los agentes más cercanos al fantasma (más urgentes). Cada
// uno toma la celda segura libre que maximiza (lejos del fantasma - un poco la
// distancia a sí mismo). Devuelve Map id -> [gx,gz].
export function dispersalTargets(agents, ghost, safeCells, p = AI) {
  const used = new Set();
  const out = new Map();
  const dist = (ax, az, bx, bz) => Math.abs(ax - bx) + Math.abs(az - bz);
  const order = agents.slice().sort(
    (a, b) => dist(a.gx, a.gz, ghost.gx, ghost.gz) - dist(b.gx, b.gz, ghost.gx, ghost.gz)
  );
  for (const a of order) {
    let best = null, bs = -Infinity;
    for (const c of safeCells) {
      const k = cellKey(c.gx, c.gz);
      if (used.has(k)) continue;
      const score = dist(c.gx, c.gz, ghost.gx, ghost.gz) - 0.3 * dist(c.gx, c.gz, a.gx, a.gz);
      if (score > bs) { bs = score; best = c; }
    }
    if (best) { used.add(cellKey(best.gx, best.gz)); out.set(a.id, [best.gx, best.gz]); }
  }
  return out;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ai.js test/ai.test.js
git commit -m "feat(ai): dispersion en caceria con destinos distintos"
```

---

### Task 8: Barks (comunicación con cooldown y prioridad)

**Files:**
- Modify: `js/ai.js`
- Test: `test/ai.test.js`

- [ ] **Step 1: Tests que fallan**

Añade a `test/ai.test.js`:

```js
import { barkFor } from '../js/ai.js';

test('barkFor respeta el cooldown salvo prioridad alta', () => {
  const ag = { lastBarkT: 100 };
  assert.equal(barkFor(ag, 'scared', 101, AI), null); // dentro del cooldown
  const b = barkFor(ag, 'scared', 100 + AI.BARK_CD + 0.1, AI);
  assert.equal(b.text, 'No me gusta esto…');
  // 'hunt' (prio alta) ignora el cooldown
  const h = barkFor(ag, 'hunt', 101, AI);
  assert.equal(h.text, '¡CORRED!');
});

test('barkFor con trigger desconocido devuelve null', () => {
  assert.equal(barkFor({ lastBarkT: -999 }, 'nope', 0, AI), null);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test`
Expected: FAIL — `barkFor is not a function`.

- [ ] **Step 3: Implementación**

Añade a `js/ai.js`:

```js
// Tabla de barks: clave de trigger -> {text, prio}. prio>=4 ignora cooldown.
const BARKS = {
  found:   { text: '¡Aquí hay algo!',    prio: 2 },
  danger:  { text: '¡Por ahí no!',        prio: 3 },
  scared:  { text: 'No me gusta esto…',   prio: 1 },
  regroup: { text: '¡Todos conmigo!',     prio: 3 },
  missing: { text: '¿Dónde está?',        prio: 2 },
  hunt:    { text: '¡CORRED!',            prio: 5 },
};

// Devuelve {text, prio, t} o null. El llamador actualiza agent.lastBarkT con t.
export function barkFor(agent, trigger, now, p = AI) {
  const b = BARKS[trigger];
  if (!b) return null;
  const since = now - (agent.lastBarkT ?? -Infinity);
  if (b.prio < 4 && since < p.BARK_CD) return null;
  return { text: b.text, prio: b.prio, t: now };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ai.js test/ai.test.js
git commit -m "feat(ai): barks con cooldown y prioridad"
```

---

## Fase B — Integración en `js/main.js` y `js/hunters.js`

> Las tareas de integración tocan el juego en navegador; se verifican **manualmente** con servidor local + CDP/headless (flujo del proyecto), no con `node --test`. Tras cada tarea, arranca `npm run dev` y comprueba la consola sin errores.

### Task 9: Escalar a 8 y dar campos de agente + pizarra

**Files:**
- Modify: `js/main.js` (constantes ~31-36; import ~13; `makeHunters` 257-267; `boot` 452-483)

- [ ] **Step 1: Importar el núcleo IA**

En `js/main.js`, junto a los demás imports (tras la línea `import { HunterModel } from './hunters.js';`), añade:

```js
import * as AIB from './ai.js';
```

- [ ] **Step 2: Subir el número de supervivientes**

Cambia la constante (línea ~33):

```js
const NUM_HUNTERS = 8;
```

- [ ] **Step 3: Crear la pizarra global y radio de visión**

Bajo la línea `const hunt = { active: 0 }; let huntTimer = HUNT_EVERY;` (línea ~340), añade:

```js
// Pizarra compartida del escuadrón (niebla, objetivos, peligro, eventos, roster).
let BB = AIB.createBlackboard();
const VISION_R = AIB.AI.VISION_RADIUS;
let coordTimer = 0;           // acumulador para correr el coordinador a baja Hz
const COORD_PERIOD = 1.2;     // s entre reasignaciones de rol
let rendezvous = null;        // celda de reunión para REGROUP
```

- [ ] **Step 4: Dar campos de agente al crear los supervivientes**

Reemplaza el cuerpo del bucle en `makeHunters` (líneas 260-266) por:

```js
  for (let i = 0; i < NUM_HUNTERS; i++) {
    const [gx, gz] = spawns[i], [wx, wz] = worldOf(gx, gz);
    const gltf = chars && chars[i % chars.length] && chars[i % chars.length].gltf;
    const model = gltf ? new HunterModel(gltf) : makeBoxHunter(fallbackColors[i % fallbackColors.length]);
    model.setPos(wx, 0, wz); scene.add(model.root);
    hunters.push({
      id: i, pos: new THREE.Vector3(wx, 0, wz), model, alive: true,
      flee: 0, repath: 0, next: null, working: -1,
      // --- estado IA ---
      bravery: 0.2 + Math.random() * 0.7,   // personalidad fija
      stress: 0, sanity: 1, fear: 0, panic: false,
      role: AIB.ROLES.EXPLORE_A, recentCells: [], lastBarkT: -999, goal: null,
    });
  }
```

- [ ] **Step 5: Resetear la pizarra en boot()**

En `boot()`, justo después de `REACH = floodReachable(ox, oz);` (línea ~471), añade:

```js
  BB = AIB.createBlackboard();
```

- [ ] **Step 6: Verificación manual**

Run: `npm run dev` → abrir `http://localhost:8080` → JUGAR.
Expected: aparecen **8** supervivientes; el juego corre sin errores en consola; FPS estable. (Aún se mueven con la lógica vieja; eso cambia en la Task 11.)

- [ ] **Step 7: Commit**

```bash
git add js/main.js
git commit -m "feat(ia): 8 supervivientes con campos de agente + pizarra"
```

---

### Task 10: Descubrimiento, decaimiento y posteo de eventos por frame

**Files:**
- Modify: `js/main.js` (`update` 432-443; `roar` 325-335; `startHunt` 341; `killHunter` 305)

- [ ] **Step 1: Helper de niebla/objetivos/decaimiento**

Encima de `function update(dt)` (línea ~432), añade:

```js
// Predicado de celda abierta para la IA (grid de IA, no el fino de colisión).
const isOpenCell = (gx, gz) => !isWall(gx, gz);

// Cada frame: los vivos descubren a su alrededor; las estaciones cuya celda ya
// se descubrió pasan a ser objetivos conocidos; el peligro decae.
function updateBlackboard(dt) {
  for (const h of hunters) {
    if (!h.alive) continue;
    const [gx, gz] = cellOf(h.pos.x, h.pos.z);
    AIB.discoverAround(BB, gx, gz, VISION_R, isOpenCell);
  }
  stations.forEach((s, i) => {
    const k = AIB.cellKey(s.gx, s.gz);
    if (BB.discovered.has(k) && !BB.objectives.has(k)) {
      BB.objectives.set(k, { gx: s.gx, gz: s.gz, idx: i });
    }
  });
  AIB.decayDanger(BB, dt);
}
```

- [ ] **Step 2: Llamar a updateBlackboard en el loop**

En `update(dt)`, justo después de `const hunting = updateHunt(dt);` (línea ~437), añade:

```js
  updateBlackboard(dt);
```

- [ ] **Step 3: Postear evento al rugir**

Dentro de `roar()`, justo después de `roarCd = ROAR_CD; sfx.roar();` (línea ~327), añade:

```js
  { const [gx, gz] = cellOf(pos.x, pos.z); AIB.addEvent(BB, 'roar', gx, gz, GAME.timeLeft); }
```

- [ ] **Step 4: Postear evento al iniciar cacería**

En `startHunt()` (línea ~341), al final de la función (antes del cierre `}`), añade:

```js
  { const [gx, gz] = cellOf(pos.x, pos.z); AIB.addEvent(BB, 'hunt', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER); }
```

- [ ] **Step 5: Postear peligro al morir un superviviente**

En `killHunter(h)` (línea 305), justo después de `h.alive = false;`, añade:

```js
  { const [gx, gz] = cellOf(h.pos.x, h.pos.z); AIB.addEvent(BB, 'death', gx, gz, GAME.timeLeft, AIB.AI.DEATH_DANGER); }
```

- [ ] **Step 6: Verificación manual**

Run: `npm run dev` → JUGAR → moverse y pulsar rugido (`Q`/click).
Expected: sin errores; `BB.discovered` crece al explorar (puedes loguear `console.log(BB.discovered.size)` temporalmente y quitarlo). El juego sigue corriendo.

- [ ] **Step 7: Commit**

```bash
git add js/main.js
git commit -m "feat(ia): descubrimiento, decaimiento y eventos en el loop"
```

---

### Task 11: Coordinador + decisión por utilidad guiando el movimiento

**Files:**
- Modify: `js/main.js` (`update` 432-443; reescribir objetivo dentro de `updateHunter` 280-304)

- [ ] **Step 1: Ciclo del coordinador (baja Hz)**

Encima de `function update(dt)`, añade:

```js
// Centro del mapa en celdas (para dividir alas de exploración).
const MID_X = () => Math.floor(COLS / 2);

// Corre el coordinador cada COORD_PERIOD s: amenaza -> roles -> rendezvous.
function runCoordinator(dt, hunting) {
  coordTimer -= dt;
  if (coordTimer > 0) return;
  coordTimer = COORD_PERIOD;
  const aliveList = hunters.filter((h) => h.alive);
  const avgFear = aliveList.length ? aliveList.reduce((s, h) => s + h.fear, 0) / aliveList.length : 0;
  const deaths = hunters.filter((h) => !h.alive).length;
  const recentEvents = BB.events.filter((e) => GAME.timeLeft - e.t < 5).length;
  const threat = AIB.computeThreat({ hunting, recentEvents, deaths, avgFear });
  const roles = AIB.assignRoles(hunters.map((h) => ({ id: h.id, alive: h.alive, bravery: h.bravery })), threat);
  for (const h of hunters) if (roles.has(h.id)) h.role = roles.get(h.id);
  // Rendezvous = celda del aliado más valiente (líder), para REGROUP.
  const leader = aliveList.slice().sort((a, b) => b.bravery - a.bravery)[0];
  rendezvous = leader ? cellOf(leader.pos.x, leader.pos.z) : null;
}
```

- [ ] **Step 2: Generador de candidatas por rol**

Añade debajo de `runCoordinator`:

```js
// Construye celdas candidatas {gx,gz,bias} según el rol del agente.
function buildCandidates(h) {
  const frontier = AIB.computeFrontier(BB, isOpenCell);
  const objs = [...BB.objectives.values()].filter((o) => !stations[o.idx].done);
  const midx = MID_X();
  const near = (cell) => -(Math.abs(cell.gx - cellOf(h.pos.x, h.pos.z)[0]) + Math.abs(cell.gz - cellOf(h.pos.x, h.pos.z)[1]));
  let cands = [];
  switch (h.role) {
    case AIB.ROLES.EXPLORE_A:
    case AIB.ROLES.EXPLORE_B: {
      const wantLeft = h.role === AIB.ROLES.EXPLORE_A;
      cands = frontier
        .filter(([gx]) => (wantLeft ? gx < midx : gx >= midx))
        .map(([gx, gz]) => ({ gx, gz, bias: AIB.AI.W_CURIOSITY * h.bravery }));
      if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: AIB.AI.W_CURIOSITY * h.bravery }));
      break;
    }
    case AIB.ROLES.SCAVENGE:
      cands = objs.map((o) => ({ gx: o.gx, gz: o.gz, bias: 3 }));
      if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 }));
      break;
    case AIB.ROLES.GUARD:
      cands = objs.map((o) => ({ gx: o.gx, gz: o.gz, bias: 1.5 }));
      if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 }));
      break;
    case AIB.ROLES.REGROUP:
      cands = rendezvous ? [{ gx: rendezvous[0], gz: rendezvous[1], bias: 4 }] : [];
      break;
  }
  // Prioriza por cercanía para no recalcular rutas larguísimas cada vez.
  return cands.sort((a, b) => near(b) - near(a)).slice(0, 12);
}

// Aliados cercanos (para cohesión), en celdas.
function alliesOf(h) {
  return hunters
    .filter((o) => o.alive && o !== h)
    .map((o) => { const [gx, gz] = cellOf(o.pos.x, o.pos.z); return { gx, gz }; });
}
```

- [ ] **Step 2b: Memoria anti-repetir-ruta**

Añade debajo de `alliesOf`:

```js
// Guarda las últimas celdas pisadas (ventana corta) para penalizar repetir ruta.
function pushRecent(h) {
  const k = AIB.cellKey(...cellOf(h.pos.x, h.pos.z));
  if (h.recentCells[h.recentCells.length - 1] !== k) {
    h.recentCells.push(k);
    if (h.recentCells.length > 8) h.recentCells.shift();
  }
}
```

- [ ] **Step 3: Reescribir el objetivo dentro de updateHunter**

Reemplaza el bloque `else { ... trabajar/ir a estación ... }` de `updateHunter` (líneas 290-297, la rama no-cacería/no-flee) por:

```js
  } else {
    // Objetivo decidido por la IA (coordinador + utilidad). Si la meta es una
    // estación descubierta y estamos encima, trabajamos; si no, caminamos a la meta.
    const cands = buildCandidates(h);
    h.goal = AIB.chooseGoal(h, cands, BB, alliesOf(h), AIB.AI);
    const onObj = nearestIncompleteStation(h.pos.x, h.pos.z);
    if (onObj >= 0 && BB.objectives.has(AIB.cellKey(stations[onObj].gx, stations[onObj].gz))
        && Math.hypot(stations[onObj].wx - h.pos.x, stations[onObj].wz - h.pos.z) < 0.9) {
      h.working = onObj;
      const s = stations[onObj];
      s.progress = Math.min(1, s.progress + dt / MISSION_TIME);
      if (s.progress >= 1) s.done = true;
      refreshStation(s);
    } else {
      h.working = -1;
      if (h.goal) stepToward(h, h.goal, HUNTER_SPEED, dt);
    }
    pushRecent(h);
  }
```

- [ ] **Step 4: Llamar al coordinador en el loop**

En `update(dt)`, justo después de `updateBlackboard(dt);` (añadido en Task 10), añade:

```js
  runCoordinator(dt, hunting);
```

- [ ] **Step 5: Verificación manual (CDP)**

Run: `npm run dev` → JUGAR. Observa durante ~60 s.
Expected:
- Los 8 **exploran** zonas distintas al principio (no van todos a la misma estación).
- Sólo trabajan estaciones **ya descubiertas**; las no descubiertas se ignoran hasta explorarlas.
- No repiten la misma ida-y-vuelta en bucle cerrado (la penalización de recentCells los empuja a variar).
- Sin errores en consola; FPS estable.

- [ ] **Step 6: Commit**

```bash
git add js/main.js
git commit -m "feat(ia): coordinador + utilidad guiando el movimiento"
```

---

### Task 12: Miedo/pánico por agente + entradas de contexto

**Files:**
- Modify: `js/main.js` (`updateHunter` 280-304; helper de contexto)

- [ ] **Step 1: Helper de contexto de miedo**

Encima de `function updateHunter` (línea ~280), añade:

```js
const GHOST_FEAR_RANGE = 5;   // distancia a la que el fantasma estresa
const GROUP_RADIUS = 3;       // unidades de mundo para considerarse "agrupado"

// Construye el ctx de miedo de un agente a partir del estado del mundo.
function fearCtx(h, ghost, hunting) {
  const dGhost = Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z);
  let near = 0;
  for (const o of hunters) {
    if (o === h || !o.alive) continue;
    if (Math.hypot(o.pos.x - h.pos.x, o.pos.z - h.pos.z) < GROUP_RADIUS) near++;
  }
  const grouped = near >= 1;
  const [gx, gz] = cellOf(h.pos.x, h.pos.z);
  const safe = !hunting && AIB.dangerAt(BB, gx, gz) < 0.3 && dGhost > GHOST_FEAR_RANGE;
  return {
    nearGhost: dGhost < GHOST_FEAR_RANGE,
    inEvent: AIB.dangerAt(BB, gx, gz) > 0.5,
    dark: hunting,
    alone: !grouped,
    grouped,
    safe,
  };
}
```

- [ ] **Step 2: Actualizar miedo al principio de updateHunter**

Dentro de `updateHunter(h, dt, ghost, hunting, ghostOnFloor0)`, justo después de `if (h.flee > 0) h.flee -= dt;` (línea ~283), añade:

```js
  {
    const r = AIB.updateFear(h, fearCtx(h, ghost, hunting), dt);
    h.stress = r.stress; h.sanity = r.sanity; h.fear = r.fear; h.panic = r.panic;
  }
```

- [ ] **Step 3: El pánico interrumpe el trabajo (huye errático)**

En la rama no-cacería/no-flee de `updateHunter` (la reescrita en Task 11), envuélvela con una comprobación de pánico al inicio del `else`:

```js
  } else if (h.panic) {
    // PÁNICO: no progresa objetivos; huye lejos del fantasma de forma errática.
    h.working = -1;
    const away = farthestCell(ghost.x, ghost.z);
    const jitter = [away[0] + (Math.random() < 0.5 ? 1 : -1), away[1] + (Math.random() < 0.5 ? 1 : -1)];
    stepToward(h, isOpenCell(jitter[0], jitter[1]) ? jitter : away, HUNTER_FLEE_SPEED, dt);
    pushRecent(h);
  } else {
```

(es decir, la cadena queda: `if (hunting) {...} else if (h.flee > 0) {...} else if (h.panic) {...} else { ...IA... }`).

- [ ] **Step 4: Verificación manual**

Run: `npm run dev` → JUGAR → acércate a un superviviente y rugе/persíguelo repetidamente.
Expected: su estrés sube (acércate en cacería para acelerarlo); al saturar entra en **pánico** (deja de trabajar, huye errático); si lo dejas tranquilo y agrupado, se recupera. Sin errores.

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat(ia): miedo/panico por agente con contexto del mundo"
```

---

### Task 13: Barks + lenguaje corporal (mirar atrás) en HunterModel

**Files:**
- Modify: `js/hunters.js` (clase `HunterModel`)
- Modify: `js/main.js` (`updateHunter`; disparo de barks)

- [ ] **Step 1: Burbuja de bark en HunterModel**

En `js/hunters.js`, dentro del `constructor` (tras `this.play('Idle');`), añade:

```js
    this._bubble = null;       // sprite de texto efímero
    this._bubbleT = 0;         // tiempo restante de la burbuja
    this._lookBack = 0;        // temporizador de "mirar atrás"
```

Añade estos métodos a la clase `HunterModel` (antes de `update(dt)`):

```js
  // Muestra una burbuja de texto sobre la cabeza durante `dur` s.
  showBark(text, dur = 2.2) {
    if (this._bubble) { this.root.remove(this._bubble); this._bubble.material.map.dispose?.(); }
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff'; g.font = '22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(1.4, 0.35, 1); spr.position.set(0, 2.1, 0); spr.renderOrder = 1000;
    this.root.add(spr); this._bubble = spr; this._bubbleT = dur;
  }

  // Lenguaje corporal: oscilación breve de yaw como "mirar atrás".
  glanceBack(dur = 0.8) { this._lookBack = dur; }
```

Dentro de `update(dt)`, antes de `this.mixer.update(dt);`, añade:

```js
    if (this._bubbleT > 0) { this._bubbleT -= dt; if (this._bubbleT <= 0 && this._bubble) { this.root.remove(this._bubble); this._bubble = null; } }
    if (this._lookBack > 0) { this._lookBack -= dt; this.root.rotation.y = this._yaw + Math.sin(this._lookBack * 12) * 0.5; }
```

(Importante: `faceDir` ya fija `this.root.rotation.y = this._yaw`; cuando `_lookBack>0` lo sobreescribimos arriba para la oscilación.)

- [ ] **Step 2: Disparar barks desde la IA**

En `js/main.js`, dentro de `updateHunter`, justo antes de `h.model.update(dt);` (línea ~303), añade:

```js
  // Barks: dispara según estado y respeta cooldown/prioridad.
  let trig = null;
  if (hunting) trig = 'hunt';
  else if (h.panic || h.fear > 0.7) trig = 'scared';
  else if (h.role === AIB.ROLES.REGROUP) trig = 'regroup';
  if (trig) {
    const b = AIB.barkFor(h, trig, GAME.timeLeft, AIB.AI);
    if (b) { h.lastBarkT = b.t; h.model.showBark(b.text); if (h.fear > 0.5) h.model.glanceBack(); }
  }
```

(Nota: `GAME.timeLeft` decrece, así que el cooldown usa diferencias negativas de tiempo de forma consistente — `barkFor` compara `now - lastBarkT`; al decrecer, usa `Math.abs` no es necesario porque ambos vienen del mismo reloj y el deltas relevante es el de "tiempo transcurrido". Para robustez, dispara con el reloj de pared.)

Corrige el disparo para usar un reloj monótono. Sustituye `GAME.timeLeft` en el bloque anterior por `performance.now() / 1000`:

```js
    const b = AIB.barkFor(h, trig, performance.now() / 1000, AIB.AI);
```

- [ ] **Step 3: Verificación manual**

Run: `npm run dev` → JUGAR → provoca una cacería (`G`).
Expected: aparecen burbujas ("¡CORRED!", "No me gusta esto…", "¡Todos conmigo!") sobre las cabezas; los asustados "miran atrás"; las burbujas no saturan (cooldown). Sin errores.

- [ ] **Step 4: Commit**

```bash
git add js/hunters.js js/main.js
git commit -m "feat(ia): barks + lenguaje corporal (mirar atras)"
```

---

### Task 14: Dispersión inteligente en cacería

**Files:**
- Modify: `js/main.js` (`updateHunter` rama `if (hunting)` 284-287)

- [ ] **Step 1: Calcular destinos de dispersión una vez por frame**

En `update(dt)`, justo después de `runCoordinator(dt, hunting);`, añade:

```js
  // En cacería, reparte celdas de escape distintas (lejos del fantasma).
  if (hunting) {
    const aliveAgents = hunters.filter((h) => h.alive).map((h) => { const [gx, gz] = cellOf(h.pos.x, h.pos.z); return { id: h.id, gx, gz }; });
    const [ggx, ggz] = cellOf(pos.x, pos.z);
    const safe = REACH.list
      .filter(([gx, gz]) => (Math.abs(gx - ggx) + Math.abs(gz - ggz)) > 6)
      .map(([gx, gz]) => ({ gx, gz }));
    DISPERSAL = AIB.dispersalTargets(aliveAgents, { gx: ggx, gz: ggz }, safe, AIB.AI);
  } else {
    DISPERSAL = null;
  }
```

Declara `DISPERSAL` junto a `rendezvous` (Task 9, Step 3):

```js
let DISPERSAL = null;
```

- [ ] **Step 2: Usar el destino asignado en la rama de cacería**

Reemplaza la rama `if (hunting) { ... }` de `updateHunter` (líneas 284-287) por:

```js
  if (hunting) {
    h.working = -1;
    const dest = DISPERSAL && DISPERSAL.get(h.id);
    stepToward(h, dest || farthestCell(ghost.x, ghost.z), HUNTER_FLEE_SPEED, dt);
    if (ghostOnFloor0 && Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z) < KILL_RANGE) { killHunter(h); return; }
  } else if (h.flee > 0) {
```

- [ ] **Step 3: Verificación manual (CDP)**

Run: `npm run dev` → JUGAR → fuerza cacería (`G`) estando en medio del grupo.
Expected: los supervivientes huyen a **direcciones distintas** (no todos al mismo rincón); cuesta más barrerlos juntos. Sin errores; FPS estable.

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat(ia): dispersion inteligente en caceria"
```

---

### Task 15: Overlay de depuración (toggle `O`)

**Files:**
- Modify: `js/main.js` (handler de teclado ~322; `drawMinimap` 395-401)

- [ ] **Step 1: Estado del toggle**

Junto a las variables de estado del jugador (línea ~311, tras `let roarCd = ...`), añade:

```js
let debugAI = false;   // overlay de depuración de la IA (tecla O)
```

En el `keydown` (línea 322), añade el toggle (dentro del handler, tras la condición de `KeyG`):

```js
  if (e.code === 'KeyO') debugAI = !debugAI;
```

- [ ] **Step 2: Dibujar rol/estrés sobre el minimapa**

Al final de `drawMinimap()` (antes del cierre `}`, tras dibujar al jugador, línea ~400), añade:

```js
  if (debugAI) {
    const cs = MM / COLS;
    const COLR = { EXPLORE_A: '#4f8cff', EXPLORE_B: '#37d67a', GUARD: '#ffae42', SCAVENGE: '#c77dff', REGROUP: '#ff3b3b' };
    for (const h of hunters) {
      if (!h.alive) continue;
      mmCtx.fillStyle = COLR[h.role] || '#fff';
      mmCtx.fillRect((h.pos.x / CELL) * cs - 2, (h.pos.z / CELL) * cs - 2, 4, 4);
      mmCtx.fillStyle = h.panic ? '#ff0000' : '#000';
      mmCtx.fillRect((h.pos.x / CELL) * cs - 2, (h.pos.z / CELL) * cs - 4, 4 * Math.min(1, h.stress), 1.5);
    }
    // celdas descubiertas (tenue)
    mmCtx.fillStyle = 'rgba(255,255,255,0.06)';
    for (const k of BB.discovered) { const [gx, gz] = AIB.parseKey(k); mmCtx.fillRect(gx * cs, gz * cs, cs, cs); }
  }
```

- [ ] **Step 3: Verificación manual**

Run: `npm run dev` → JUGAR → pulsa `O`.
Expected: el minimapa muestra puntos de color por rol, una barrita de estrés y un velo sobre lo descubierto; al volver a pulsar `O` desaparece. No afecta a la jugabilidad.

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat(ia): overlay de depuracion (toggle O)"
```

---

### Task 16: Verificación integral + README/DESIGN

**Files:**
- Modify: `README.md` (controles/estado), opcional `docs/DESIGN.md`

- [ ] **Step 1: Suite de tests del núcleo puro**

Run: `npm test`
Expected: PASS — todos los tests de `ai.js` y `logic.js`.

- [ ] **Step 2: Verificación manual completa (CDP/headless)**

Run: `npm run dev` y revisa, durante una partida:
- 8 supervivientes; exploran zonas distintas y **no repiten** rutas en bucle.
- Se dividen en grupos (overlay `O`: ves ~2 por rol) y **se reagrupan** al subir la amenaza (cacería) → casi todos en rol REGROUP/escape.
- **Barks** con burbujas + miran atrás con miedo.
- **Pánico** bajo estrés sostenido y **recuperación** al calmarse.
- En cacería se **dispersan** a sitios distintos.
- FPS estable; consola sin errores.

- [ ] **Step 3: Actualizar README (controles + estado)**

En `README.md`, en la tabla de controles añade la fila del overlay:

```markdown
| `O` | Overlay de depuración de la IA (roles/estrés/descubierto) |
```

Y en el bloque de estado, sustituye la nota de "Sin IA" por:

```markdown
> **Estado:** IA de 8 supervivientes (R1): niebla de descubrimiento, coordinador + utilidad, miedo/pánico, barks, dispersión en cacería.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: actualiza estado y controles (IA R1)"
```

---

## Self-Review (cobertura del spec)

| Requisito del spec | Tarea(s) |
|---|---|
| Escalar 3→8 | Task 9 |
| Pizarra: niebla de descubrimiento + frontera | Task 2, Task 10 |
| Pizarra: objetivos descubiertos | Task 10 |
| Pizarra: zonas de peligro (eventos + decaimiento) | Task 3, Task 10 |
| Stats por agente (valentía/estrés/cordura) + pánico recuperable | Task 4, Task 9, Task 12 |
| Amenaza global + coordinador de roles (2+2+2+2, REGROUP) | Task 5, Task 11 |
| Decisión por utilidad (peligro/cohesión/anti-repetir/sesgo rol) | Task 6, Task 11 |
| Reacción a eventos (estrés/peligro/bark/reenrutar) | Task 10, Task 12, Task 13 |
| Barks + lenguaje corporal | Task 8, Task 13 |
| Dispersión inteligente en cacería | Task 7, Task 14 |
| Cooperación (cohesión/ayuda/agrupar) | Task 6/Task 11 (cohesión), Task 11/Task 5 (reagrupar) |
| Overlay de depuración (toggle) | Task 15 |
| Verificación node --test + manual CDP | Tasks 1-8 (node), 9-16 (manual) |
| Parry como costura (fuera de alcance) | No-op: `tryParry()` se añadirá en R4; R1 no toca el kill salvo postear evento (Task 10) |

**Notas de consistencia de tipos:** la pizarra usa siempre claves string `"gx,gz"` (`cellKey`/`parseKey`); las candidatas son siempre `{gx,gz,bias}`; los agentes públicos del coordinador son `{id,alive,bravery}`; `dispersalTargets`/`assignRoles` devuelven `Map`. `updateFear` devuelve `{stress,sanity,fear,panic}` y NO muta el agente (la integración copia los campos). `barkFor` usa reloj de pared (`performance.now()/1000`) en la integración.

**Desvío respecto al spec (documentado arriba):** se conserva el identificador `hunters` en `main.js` (no se renombra a `agents`) para no romper el id de DOM `'hunters'` del HUD.

---

## Execution Handoff

Tras guardar el plan, elige cómo ejecutarlo (ver final del mensaje).
