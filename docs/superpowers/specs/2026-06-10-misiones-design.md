# Ghost Hunters: Reversed — Rebanada 5: Sistema de misiones (fase previa al ritual)

> Diseño validado. 10 jun 2026. Arquitectura elegida: **B — fase `MISSIONS` dentro de `js/ritual.js`** (toda la ruta de victoria en un módulo puro testeable).

## Contexto

Tras el playtest de R1–R4, el usuario reportó que los bots **deambulan sin hacer nada** porque el único objetivo (recoger pocos objetos rituales en un mapa enorme) los deja caminando mucho. R5 añade un **sistema de misiones** (tareas tipo Among Us, p. ej. **reparar monitores**) como **fase previa** que mantiene a los bots siempre ocupados y, al completarse, **desbloquea el ritual** de R2. Fiel al doc de visión ("completan objetivos / preparan el ritual antes de invocar").

## Objetivo

Que los 8 bots tengan **misiones constantes** repartidas por el mapa (monitores a reparar). Completarlas **todas** desbloquea el ritual (gather → channel → ganar). El fantasma estorba **acosando** (el rugido no dispersa: baja cordura y ralentiza la tarea). Resultado: los bots nunca están ociosos y hay una progresión clara misiones → ritual → victoria.

### Decisiones tomadas en brainstorming

1. **Misiones desbloquean el ritual.** Bucle: misiones → gather → channel → done. Fase `MISSIONS` previa.
2. **Contrajuego = acoso, no dispersión.** El rugido **no hace huir**: pone a los bots cercanos `shaken` (estrés↑, cordura↓) y **ralentiza** su tarea/movimiento un rato. (Cambia también el rugido de R2 en GATHER: antes hacía soltar la cruz; ahora la ralentiza sin soltarla.)
3. **Arquitectura B:** fase `MISSIONS` + estado de misiones dentro de `ritual.js` (puro, testeable). Reutiliza `assets.tv` + `placeProp` para las estaciones.
4. **Siempre ocupados:** misiones conocidas desde el inicio + reparto por cercanía → ningún bot deambula.

## Alcance

**Dentro (R5):**
- `ritual.js`: fase `MISSIONS`, estado `missions[]`, `workMission`, `missionsDoneCount`/`allMissionsDone`, gate MISSIONS→GATHER, rama de `assignRitualRoles` para REPAIR.
- Integración: colocar estaciones de misión (TV), rol/candidatos REPAIR, `workMission` en el kill/AI path, render de progreso (emissive del monitor), minimapa, HUD.
- Rediseño del rugido: `shaken` (estrés↑/cordura↓ + ralentización) en vez de `flee`/soltar.

**Fuera:**
- Variedad de tipos de misión (solo "reparar monitores" en R5; props extra quedan para más adelante).
- Descargar GLB de internet (no es posible; se usa el TV existente + respaldo procedural).
- Cambios en la cacería/parry/kit (R3/R4 intactos salvo el efecto del rugido).

## Arquitectura

| Componente | Qué hace | Depende de |
|---|---|---|
| **`js/ritual.js`** (extender) | Fase MISSIONS + estado de misiones + transiciones + roles. Puro, testeable. | `ai.js` (ROLES) |
| **`js/main.js`** (modificar) | Coloca estaciones (TV), candidatos REPAIR, `workMission`, render de progreso, rugido→shaken, HUD/minimapa. | `ritual.js`, `ai.js`, `abilities.js` |
| **`test/ritual.test.js`** (añadir) | Tests de la fase MISSIONS. | `ritual.js` |

## Detalle por sección

### 1. Modelo de datos (`ritual.js`)

```
PHASE = { MISSIONS, GATHER, CHANNEL, DONE }
RROLE = { ...ROLES, REPAIR, FETCH, CHANNELER, DEFEND, DISTRACT }

createRitual(missionCells, objectCells, altarCell, opts) →
{
  missions: [{ id, gx, gz, progress: 0, done: false }],   // estaciones (monitores)
  objects:  [...],                                         // cruces (R2)
  altar:    { gx, gz },
  phase:    missionCells.length ? MISSIONS : GATHER,
  channel:  0,
  needObjects, needChannelers, channelTime, penalty, needMissions,
}
```

Transiciones puras:
- `workMission(ritual, id, dt, rate)` — solo en MISSIONS: sube `progress` (clamp 1); al llegar a 1 → `done = true`; si `allMissionsDone` → `phase = GATHER`. Devuelve `done`.
- `missionsDoneCount(ritual)`, `allMissionsDone(ritual)`.
- Las transiciones de R2 (pickup/drop/deposit/channelTick) **no cambian**; siguen operando en GATHER/CHANNEL.

### 2. Reparto de roles (`ritual.js`)

`assignRitualRoles` añade la rama de fase MISSIONS:
- Todos los vivos → **REPAIR** (la integración los manda a la misión incompleta más cercana). Bajo amenaza alta podría reservarse algún DISTRACT, pero en MISSIONS lo normal es reparar.
- Fases GATHER/CHANNEL: igual que R2 (FETCH/CHANNELER/DEFEND/DISTRACT).

### 3. Estaciones + render (`main.js`)

- `makeRitual` coloca `NUM_MISSIONS` (~6) **monitores** (`assets.tv` + `placeProp`, respaldo caja) en celdas repartidas dentro de `MISSION_SPREAD` (acotado, alcanzables). Cada monitor guarda su material; el emissive va de "averiado" (rojo/apagado) a "reparado" (verde) según `progress`.
- `syncMissionMeshes()` (o dentro del sync existente) actualiza el emissive por progreso.
- Minimapa: marca estaciones (color por estado).

### 4. IA: hacer la misión (`main.js`)

- `buildCandidates(h)`: en fase MISSIONS y rol REPAIR → la misión incompleta más cercana (`{gx,gz,bias}`). En GATHER/CHANNEL, candidatos de R2.
- `updateHunter` rama IA: si fase MISSIONS y el bot está en rango de su misión → `workMission(ritual, id, dt, REPAIR_RATE × slow)` y animación `Interact`; si no, camina a la meta. `slow = h.shaken > 0 ? SHAKEN_SLOW : 1`.
- Conocidas desde el inicio (sin niebla) → van directos; reparto por cercanía evita amontonarse → **nunca deambulan**.

### 5. Contrajuego: rugido → `shaken`

- Campo de agente `shaken` (s). En `roar()`, los bots dentro de `SCARE_RANGE` reciben: `stress↑`, `sanity↓`, `shaken = SHAKEN_DUR`. **Se elimina** el `h.flee = SCARE_FLEE` y el `dropCarried` del rugido.
- `shaken` decae en el tick de cada agente. Mientras `shaken > 0`: la tarea va más lenta (`SHAKEN_SLOW` en `workMission` y en `stepToward`).
- La evasión por proximidad (R3) y Trampa/Aparición (R3) siguen igual.

### 6. HUD

- `#missions` (etiqueta "📺 Monitores"): en MISSIONS muestra **`misiones X/N`** (reparadas); en GATHER/CHANNEL, el estado del ritual (`RITUAL %` / `X/objetos`) como en R2.

## Constantes tuneables (nuevas)

`NUM_MISSIONS` (≈6), `REPAIR_RATE` (progreso/seg, p. ej. 0.12 → ~8s/misión), `MISSION_SPREAD` (radio de la región), `SHAKEN_DUR` (≈4s), `SHAKEN_SLOW` (≈0.4).

## Riesgos y mitigaciones

- **Misiones demasiado largas/cortas:** `REPAIR_RATE`/`NUM_MISSIONS` tuneables; con varios bots por estación van más rápido.
- **Cambio del rugido afecta a R2 (GATHER):** intencionado y aprobado (acoso en vez de soltar); reversible vía constante si se quiere recuperar el "soltar".
- **`createRitual` cambia de firma (añade `missionCells`):** se actualizan sus tests de R2 en el mismo cambio.
- **Rendimiento:** ~6 monitores más; sin impacto. Verificar FPS por CDP.
- **TV GLB ausente:** respaldo caja procedural (carga resiliente de R2).

## Verificación

- **`node --test`** sobre `ritual.js`: `createRitual` inicia en MISSIONS con `missions`; `workMission` sube/clampa y marca `done`; **todas hechas → GATHER**; `missionsDoneCount`/`allMissionsDone`; `assignRitualRoles` da REPAIR a los vivos en MISSIONS y los roles de R2 en GATHER/CHANNEL. (Actualizar los tests existentes de `createRitual` a la nueva firma.)
- **Manual (CDP headless):** los 8 van directos a reparar monitores (sin deambular), el emissive sube; al completar **todas** pasan a **GATHER** (recoger cruces → altar → canalizar → ganar); rugir cerca **ralentiza/baja cordura sin hacerles huir**; HUD muestra misiones→ritual; 0 errores, FPS estable.

## Cierre

R5 cierra el bucle completo del doc de visión: **misiones (preparar) → ritual (invocar/destruir) → victoria**, con los bots siempre ocupados y el fantasma acosando + cazando. Fuera de alcance siguen: variedad de misiones, habilidades Susurro/Distorsión, y pulido de jam.
