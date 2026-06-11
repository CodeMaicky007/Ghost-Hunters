# Ghost Hunters: Reversed — Rebanada 6: Observación/Marcado + derribo/KO/mori + rutinas complementarias + fix de huida

> Diseño dictado por el usuario (11 jun 2026, post-playtest) y consolidado aquí. Los **defaults asumidos** por el agente están marcados con *(default)* — corregibles tras playtest.

## Contexto

Playtest de R5 detectó: (1) los 8 bots comparten rutina idéntica (todos REPAIR), (2) al huir a veces **se vuelven hacia el fantasma** (la ruta BFS a la celda globalmente más lejana puede pasar por delante de él), (3) el rugido no aporta y se quiere sustituir por un sistema de acecho con ejecuciones tipo **Dead by Daylight**.

## Objetivo

1. **Observación/Marcado** (sustituye al rugido, que se **elimina**): el fantasma acecha a un objetivo para marcarlo; los marcados mueren de 1 golpe en cacería; los no marcados tienen 2 vidas → KO → reanimación o **Memento Mori**.
2. **Rutinas complementarias**: reparadores + vigía + rescatador, reasignadas según necesidad.
3. **Fix de huida**: los bots nunca eligen rutas de escape que los acerquen al fantasma.

## Especificación del usuario (texto normativo)

### Habilidad pasiva: Observación
- El fantasma **selecciona** a un superviviente como objetivo de observación. Mientras permanezca en su **línea de visión**, la barra de Observación sube hasta el 100%.
- Es **permanente** (activa toda la partida); el **progreso se conserva** aunque el objetivo se aleje.
- Al 100% el objetivo queda **MARCADO**.

### Efecto de Marcado (en cacería)
- Objetivo **Marcado** → eliminación **instantánea con un único ataque**.
- Objetivo **NO marcado** → dispone de **2 vidas**.

### Sistema de derribo
- Sin marca: 1er ataque = pierde una vida; 2º ataque = **Derribado (KO)**. No muere: queda en el suelo esperando ayuda.

### Reanimación
- Los supervivientes reviven a un aliado derribado **si el fantasma no está cerca** de la zona.

### Memento Mori
- Para eliminar definitivamente a un derribado, el fantasma se acerca e inicia una **ejecución** (animación); al completarla, el superviviente muere y queda fuera. Como en Dead by Daylight.

### Patrón de juego pretendido
- Observar discretamente para completar la Marca **antes** de iniciar una cacería; con la Marca lista, perseguir agresivamente al marcado en la caza. *(El fantasma es el jugador: esto es guía de juego, no una IA.)*

## Defaults asumidos *(el usuario puede corregirlos)*

- **Vidas por cacería**: "dispondrá de 2 vidas durante la siguiente cacería" → las vidas se **resetean al iniciar cada cacería** (la herida no persiste entre cazas; no hay curación de heridas).
- **Revivido** → se levanta **herido (1 vida)** para la cacería en curso.
- **KO sin desangrado**: espera indefinida a rescate o mori.
- **Selección de objetivo**: apuntar a un superviviente y pulsar **1** (el slot del rugido). Cambiar de objetivo no pierde el progreso del anterior (progreso **por superviviente**).
- **Alcance/LOS de observación**: sube si el objetivo está a ≤ `OBS_RANGE` (~25 u) con línea de visión (raycast contra muros); velocidad `OBS_RATE` (~100% en ~12 s de visión continua).
- **Feedback de marca**: barra en el slot 1 (% del objetivo actual) + indicador rojo sobre el marcado (visible para el fantasma).
- **Mori**: tecla **E** a ≤ `MORI_RANGE` (~1.6 u) de un KO; ejecución de ~2 s (efecto de pantalla + sfx); **no parryable**; utilizable también fuera de cacería.
- **Parry (R4)**: bloquea **golpes** (incluido el de ejecución-por-marca) una vez por cacería; no bloquea el mori.
- **Reanimación**: canal de ~4 s junto al KO; **se pausa/aborta** si el fantasma está a < `REVIVE_BLOCK` (~9 u).
- **Rutinas**: en MISSIONS → **REPAIR** (mayoría) + **SCOUT** (1, el más valiente: patrulla entre estaciones y, al sentir al fantasma, da la alarma → `addEvent`/peligro en la pizarra y los demás evitan la zona) + **RESCUER** como *override por necesidad* en **cualquier fase** (si hay un KO, el vivo más cercano no-canalizador acude a revivir). GATHER/CHANNEL mantienen FETCH/EXPLORE/CHANNELER/DEFEND/DISTRACT.
- **Fix de huida**: el destino de escape se elige entre celdas alcanzables cercanas cuyo **primer paso BFS no acerque** al fantasma (dot alejándose); fallback a la más lejana si no hay candidatas. Aplica a flee, pánico y dispersión.

## Alcance

**Dentro (R6):** todo lo anterior + eliminación del rugido (tecla 1 pasa a Observación; muere el efecto `shaken` del rugido — las trampas siguen ralentizando) + HUD (barra de observación, indicador de marcado, prompt de mori) + minimapa/overlay (KO en gris).

**Fuera:** curación de heridas entre golpes, desangrado del KO, mori animado con cámara especial (se hace con efecto de pantalla), IA-fantasma.

## Arquitectura

| Componente | Qué hace | Acción |
|---|---|---|
| **`js/abilities.js`** | + estado de observación `{ target, progress: {id: 0..1} }`, `tickObserve(ab, dt, {visible})`, `isMarked(ab, id)`, `setObserveTarget`. Puro. | Modificar |
| **`js/logic.js`** | + `hitResult(marked, lives)` → `{outcome: 'dead'|'wounded'|'down', lives}`; + `canRevive(distGhost, blockRange)`. Puro. | Modificar |
| **`js/ritual.js`** | + rutinas: SCOUT en MISSIONS (1 valiente), override RESCUER por necesidad (`assignRitualRoles(agents, ritual, threat, ctx={koIds})`). Puro. | Modificar |
| **`js/main.js`** | Selección/LOS de observación, golpes con vidas/KO, revive channel, mori (E), quitar rugido, `fleeCell` (huida sin acercarse), HUD/minimapa/overlay. | Modificar |
| **tests** | abilities (observe), logic (hitResult/canRevive), ritual (scout/rescuer). | Modificar |

## Detalle clave de integración

- **Estado por agente**: `lives` (reset a 2 — o 1 si marcado no aplica — en `startHunt`), `ko` (bool), `reviveT` (canal), `marked` derivado de `ab`.
- **Golpe (cacería)**: contacto en `KILL_RANGE` con `stun<=0` y cooldown de golpe por bot (~1.5 s) → parry check (si le queda) → `hitResult(isMarked(ab,h.id), h.lives)`: `dead`→`killHunter`; `down`→ KO (anim Death clampada, deja de actuar, suelta objeto ritual); `wounded`→ pierde vida + mini-burst de huida (no se le puede re-golpear ~1.5 s).
- **KO**: no bloquea `checkEnd` (solo cuentan muertos); los KO no reparan/acarrean/canalizan; `syncRitual` los ignora como portadores (drop al caer).
- **Revive**: RESCUER llega al KO → canal 4 s (pausado si fantasma < `REVIVE_BLOCK`) → KO se levanta con 1 vida.
- **Mori**: `E` junto a KO → 2 s (overlay "EJECUCIÓN" + sfx) → `killHunter`. Si el fantasma se aleja, se cancela.
- **Observación**: cada frame, si hay `target` vivo no-KO, raycast cámara→bot contra muros del nivel; visible → `tickObserve`. HUD slot 1: nombre genérico + %. Marcado → sprite/glow rojo sobre la cabeza.
- **Huida**: `fleeCell(h, ghost)` reemplaza `farthestCell` en flee/pánico; dispersión filtra candidatas por dirección de alejamiento.

## Constantes tuneables (nuevas)

`OBS_RANGE` (~25), `OBS_RATE` (1/12 s⁻¹), `HIT_COOLDOWN` (1.5), `LIVES_UNMARKED` (2), `REVIVE_TIME` (4), `REVIVE_BLOCK` (~9), `MORI_RANGE` (1.6), `MORI_TIME` (2), `FLEE_RADIUS` (~14).

## Verificación

- **`node --test`**: observe (sube con visible, persiste al cambiar de target, marca al 100%), hitResult (marcado→dead; 2 vidas→wounded→down), canRevive, roles (SCOUT 1 en MISSIONS, RESCUER override con KO).
- **CDP**: marcar a un bot y matarlo de 1 golpe en cacería; bot sin marca aguanta 2 golpes y queda KO; un compañero acude y lo revive si te alejas; mori con E lo elimina; los que huyen **no** se acercan al fantasma (muestreo de distancia monótona); rugido eliminado (tecla 1 = observación); 0 errores.
