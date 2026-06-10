# Ghost Hunters: Reversed — Rebanada 4: Sistema de Parry

> Diseño validado. 10 jun 2026. Arquitectura elegida: **B — `parryChance`/`rollParry` puros en `js/logic.js` + estado/stun en la integración**.

## Contexto

Cuarta y última rebanada del norte por fases (R1 IA, R2 ritual, R3 kit+cacería). Materializa la **costura de Parry** que R1–R3 dejaron intacta en el kill path. Como los supervivientes son IA y el jugador es el fantasma, el Parry es la **defensa de emergencia de la IA** contra tu kill durante la cacería.

Hoy el kill ocurre en la rama `if (hunting)` de `updateHunter`: si el fantasma está dentro de `KILL_RANGE` de un superviviente, `killHunter(h)`. R4 inserta el parry justo antes de matar.

## Objetivo

Dar a cada superviviente **un parry por cacería**: cuando intentas matarlo, tira un éxito según su **pericia** (valentía, penalizada por pánico). Éxito → te **aturde 3s** (no matas, no usas habilidades, te mueves lento) y sobrevive huyendo; fallo → muere. Tu contrajuego: **re-atacar a quien ya gastó su parry** (kill seguro). Sin marca persistente: lo recuerdas tú.

### Decisiones tomadas en brainstorming

1. **Modelo:** **probabilidad por pericia.** Al intentar el kill, si le queda parry, tira `rollParry(parryChance(bravery, panic))`. Éxito → stun + sobrevive; fallo → muere. Uno por cacería.
2. **Aturdimiento (3s):** **ralentizado** + **sin kill** + **sin habilidades/rugido**, con efecto de pantalla + sonido. La cacería sigue corriendo.
3. **Legibilidad:** **sin marca persistente** de "parry gastado"; feedback claro en el momento del parry (pose + bark + señal de stun), pero recordar quién paró es del jugador.
4. **Arquitectura B:** `parryChance`/`rollParry` puros en `js/logic.js` (testeables con rng inyectable); estado (`parryUsed`, `stun`) y efectos en `main.js`.

## Alcance

**Dentro (R4):**
- `js/logic.js`: `parryChance(bravery, panic, params)` y `rollParry(chance, rng)`.
- Integración: `parryUsed` por agente (reset en `startHunt`), `stun` del fantasma, roll en el kill path, gating de kill/habilidades/rugido + ralentización durante el stun, feedback (pose `HitRecieve`, bark, banner + viñeta + audio).

**Fuera:**
- Finta del fantasma / contrajuego activo (se eligió probabilidad pura).
- Marca persistente de parry gastado (se eligió "memoria").
- Parry fuera de la cacería (solo aplica al kill de cacería).

## Arquitectura

| Componente | Qué hace | Depende de |
|---|---|---|
| **`js/logic.js`** (añadir 2 funciones) | `parryChance` + `rollParry` puros, node-testeables. | — |
| **`js/main.js`** (modificar) | `parryUsed` por agente, `stun` del fantasma, roll en el kill path, gating + ralentización, feedback. | `logic.js`, kit/cacería de R3 |
| **`test/logic.test.js`** (añadir) | tests de `parryChance`/`rollParry`. | `logic.js` |

## Detalle por sección

### 1. Núcleo puro (`js/logic.js`)

```
// Probabilidad de parry (0..1) por pericia; el pánico la hunde.
parryChance(bravery, panic, p = { base: 0.25, perBravery: 0.5, panicMul: 0.3 }) {
  const c = p.base + p.perBravery * bravery;
  return clamp01(panic ? c * p.panicMul : c);
}
// Tirada: true si éxito. rng() en [0,1).
rollParry(chance, rng = Math.random) { return rng() < chance; }
```
Con defaults: valiente (1.0) ≈ 0.75; tímido (0.2) ≈ 0.35; en pánico ×0.3.

### 2. Estado e integración (`main.js`)

- **`parryUsed`** por agente (en `makeHunters`, init `false`). En `startHunt()`: `for (const h of hunters) if (h.alive) h.parryUsed = false;` (un parry por cacería).
- **`stun`** del fantasma (segundos), junto a `roarCd`/`escalated`. En `update()`: `if (stun > 0) stun = Math.max(0, stun - dt);`.
- **Kill path** (rama `if (hunting)` de `updateHunter`): la condición de kill exige `stun <= 0`. Al dispararse sobre `h`:
  - `if (!h.parryUsed) { h.parryUsed = true; if (rollParry(parryChance(h.bravery, h.panic, PARRY))) { stun = STUN_DUR; h.flee = PARRY_FLEE; h.next = null; h.model.play('HitRecieve'); h.model.showBark('¡Bloqueado!'); sfx.parry(); triggerStunFx(); return; } }`
  - Si no entra en el `if` (ya gastado) o el roll falla → `killHunter(h); return;`.
- **Gating del stun:** `roar()` y `useTeleport/useTrap/useDecoy/useSpectral/tryStartHunt` → early-return si `stun > 0`. `moveGhost`: `SPEED × (stun > 0 ? STUN_SLOW : 1) × (hunting ? HUNT_SPEED_MULT : 1)`.
- **Feedback:** `triggerStunFx()` muestra un banner "ATURDIDO" + activa una viñeta/tinte (overlay CSS, p. ej. `#stunfx`) durante el stun; `sfx.parry()` (tono nuevo). Se apagan al terminar.

### 3. Constantes tuneables (nuevas)

`PARRY = { base: 0.25, perBravery: 0.5, panicMul: 0.3 }`, `STUN_DUR = 3`, `STUN_SLOW = 0.4`, `PARRY_FLEE = 3`.

## Riesgos y mitigaciones

- **% mal balanceado (frustración):** todo en `PARRY`; verificación de `parryChance` por `node --test`; ajuste manual.
- **Stun encadenado:** un superviviente solo para una vez por cacería; el fantasma no puede ser stuneado dos veces por el mismo en una cacería. (Varios supervivientes podrían stunear en cadena; aceptable y dramático — mitigable subiendo `KILL_RANGE`/bajando `base`.)
- **Feedback poco claro:** banner + viñeta + audio + pose dejan claro el parry y el stun; el "quién paró" es intencionadamente memoria del jugador.
- **`HitRecieve` ausente en algún modelo:** si el clip no existe, `play()` ya hace no-op; el bark + stun fx bastan como feedback.

## Verificación

- **`node --test`** sobre `logic.js`: `parryChance` (valiente > tímido; pánico penaliza; clamp 0..1; defaults) y `rollParry` (umbral con rng inyectable: éxito/fallo deterministas).
- **Manual (CDP headless):** forzar cacería y acercarse a un superviviente → a veces **bloquea** (pose + bark + **te aturdes**: no matas ni usas habilidades, te mueves lento, banner+viñeta) y huye; **re-atacar** a uno que ya paró → **muere**; un superviviente solo para **una vez por cacería**; el stun corre y te come segundos de la cacería; 0 errores, FPS estable. (El feedback de audio no se verifica por CDP; se valida sin errores y el feel manualmente.)

## Cierre del norte

Con R4 se completa la hoja de ruta R1–R4: IA de 8 supervivientes → progresión ritual + victoria → kit del fantasma + cacería + percepción invertida → Parry. Quedan como "extended" (fuera del norte fijado): habilidades adicionales (Susurro/Distorsión), finta del fantasma, y pulido/balance de jam.
