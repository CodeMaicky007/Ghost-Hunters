# Ghost Hunters: Reversed — Rebanada 2: Progresión de objetivos + ritual final + nueva victoria

> Diseño validado. 10 jun 2026. Arquitectura elegida: **A — módulo puro `js/ritual.js` (máquina de estados) + roles de fase sobre el coordinador de R1**.

## Contexto

Segunda rebanada del norte por fases (ver `2026-06-09-ia-8-supervivientes-design.md` y `DESIGN.md`). R1 dio el cerebro IA de los 8 supervivientes sobre un andamiaje de objetivos placeholder (apagar monitores). R2 sustituye ese bucle por la **progresión real hacia el ritual final** y cambia la condición de victoria.

Assets ya presentes para R2: `assets/models/objects/mesa.glb` (altar) y `assets/models/objects/wooden_cross.glb` (objeto ritual), además del monitor `vintage_television_-_panasonic_tr-555.glb` (atrezzo / retirado).

## Objetivo

Reemplazar "apagar 4 monitores = ganan" por: los supervivientes **descubren** objetos rituales repartidos por el mapa, los **acarrean** al **altar** (mesa), y al reunirlos todos arranca el **ritual final** (canalización con defensa). Completar la canalización **destruye al fantasma = ganan**. El fantasma gana eliminando a los 8; el temporizador, al agotarse, **escala** a cacería permanente en vez de terminar la partida.

### Decisiones tomadas en brainstorming

1. **Progresión de una capa:** objetos rituales → altar → desbloquea el ritual (sin pistas/recursos separados).
2. **Clímax = canalización con defensa:** barra de ritual que sube con ≥`needChannelers` canalizando en el altar; el fantasma interrumpe (matar/rugir junto al altar la hace **retroceder**). Llena → fantasma destruido = ganan.
3. **Victoria del fantasma = matar a todos.** El temporizador no termina la partida: al llegar a 0 → **escalada** (cacería permanente, letal).
4. **Contrajuego en la recogida = susto = soltar:** rugir a un portador hace que **suelte** el objeto donde esté (re-fetch).
5. **Arquitectura A:** `js/ritual.js` puro y testeable; roles de fase (FETCH/CHANNEL/DEFEND/DISTRACT) sobre el coordinador de R1.

## Alcance

**Dentro (R2):**
- Módulo puro `js/ritual.js`: estado del ritual + transiciones (pickup/drop/deposit/channelTick) + reparto de roles por fase.
- Render/integración: altar (mesa.glb), N objetos rituales (wooden_cross.glb), carga visual (reparent al portador), depósito en el altar, barra de ritual, brillo del altar.
- Generalizar la niebla de descubrimiento de R1 a objetos rituales + altar.
- Roles de fase de la IA: GATHER (EXPLORE/FETCH/GUARD) y CHANNEL (CHANNEL/DEFEND/DISTRACT).
- Contrajuego del fantasma: susto = soltar; interrupción de canalización (matar/rugir junto al altar).
- Nueva condición de victoria + escalada del temporizador.
- HUD: contador de objetos / barra de ritual / indicador de fase; marcas de altar+objetos en minimapa y overlay debug.

**Fuera (fases siguientes):**
- **Kit de habilidades del fantasma** (Susurro/Distorsión/Aparición/Teletransporte/Trampa) = **R3**. R2 usa solo rugido + cacería.
- **Parry** = **R4** (costura intacta).
- Múltiples capas de progresión (pistas/recursos separados) — descartado por YAGNI.

## Arquitectura

| Componente | Qué hace | Depende de |
|---|---|---|
| **`js/ritual.js`** (nuevo, puro, sin THREE) | Estado del ritual (objetos/altar/fase/canalización) + transiciones puras + reparto de roles por fase. node-testeable. | — |
| **`js/main.js`** (modificar) | Crea altar+objetos (GLB), conduce el ritual (pickup/deposit/channelTick), render de carga/depósito/barra, contrajuego del fantasma, victoria/escalada, HUD. | `ritual.js`, `ai.js`, grid/BFS |
| **`js/ai.js`** (sin cambios de lógica) | El cerebro de R1 sigue igual; recibe los nuevos roles/candidatos desde la integración. | — |
| **`test/ritual.test.js`** (nuevo) | `node --test` de `ritual.js`. | `ritual.js` |

`ritual.js` opera con datos planos (celdas, ids), claves de celda string `"gx,gz"` (consistente con `ai.js`), sin THREE.

## Detalle por sección

### 1. Modelo de datos (`js/ritual.js`)

`createRitual(objectCells, altarCell, { needObjects, needChannelers, channelTime })` →
```
{
  altar: { gx, gz },
  objects: [{ id, gx, gz, status, carrier, homeGx, homeGz }],  // status: ON_MAP|CARRIED|DEPOSITED
  phase: 'GATHER',          // 'GATHER' -> 'CHANNEL' -> 'DONE'
  channel: 0,               // 0..1
  needObjects, needChannelers, channelTime,
}
```

Transiciones puras:
- `pickup(ritual, objId, agentId)` — ON_MAP→CARRIED (`carrier=agentId`) si el objeto está libre; no-op si no.
- `dropCarried(ritual, agentId, gx, gz)` — el objeto que carga `agentId` vuelve a ON_MAP en (gx,gz), `carrier=null`. Lo usan susto y muerte.
- `depositCarried(ritual, agentId)` — CARRIED→DEPOSITED. Si `allDeposited` → `phase='CHANNEL'`.
- `channelTick(ritual, nChannelers, dt, { interrupt })` — solo en CHANNEL: `interrupt`→ `channel = max(0, channel - PENALTY*dt)`; si no y `nChannelers≥needChannelers`→ `channel = min(1, channel + dt/channelTime)`. Al llegar a 1 → `phase='DONE'`.
- helpers: `objectCarriedBy(ritual, agentId)`, `depositedCount(ritual)`, `allDeposited(ritual)`, `discoverableCells(ritual)` (objetos ON_MAP + altar, para la niebla).

### 2. Reparto de roles por fase (`js/ritual.js`, puro)

`assignRitualRoles(agents, ritual, threat, ctx)` → `Map id→role`. `ctx` aporta posiciones de agentes/altar y objetos descubiertos.
- **GATHER:** reparte EXPLORE_A/B (frontera), **FETCH** (objetos descubiertos ON_MAP sin portador, o llevar al altar si ya cargan), GUARD (cerca del altar). Sesgo por valentía como en R1.
- **CHANNEL:** asigna `needChannelers` como **CHANNEL** (los más cercanos al altar), unos **DEFEND** (resto cerca del altar, hacia accesos), 1–2 **DISTRACT** (los más valientes). Bajo amenaza alta, DEFEND/DISTRACT pueden huir/dispersarse pero se intenta mantener el mínimo de CHANNEL si es seguro.

Devuelve solo roles; `main.js` mapea cada rol a celdas candidatas y reutiliza `chooseGoal`/`stepToward` de R1.

### 3. Integración y render (`js/main.js`)

- `makeRitual(meshes)`: coloca **altar** (mesa.glb) en celda central abierta (orientado al área jugable, apoyado en y=0) y `needObjects` **objetos** (wooden_cross.glb) en celdas repartidas (`spreadCells`), con emissive tenue. Retira los monitores (o los deja como atrezzo sin lógica).
- **Descubrimiento:** generalizar `updateBlackboard`: las celdas de `discoverableCells(ritual)` descubiertas entran en `BB.objectives` (objetos+altar). La IA solo persigue lo descubierto.
- **Carga visual:** al `pickup`, reparentar/posicionar la malla del objeto sobre el portador y seguirle cada frame; al `dropCarried`, dejarla en la celda; al `depositCarried`, colocarla junto al altar.
- **Bucle:** en `update()`, tras mover agentes, si `phase==='CHANNEL'` contar canalizadores en rango del altar y llamar `channelTick(ritual, n, dt, {interrupt})`. El altar aumenta su emissive con `channel`.

### 4. Comportamiento de IA por fase (integración)

`runCoordinator` pasa a usar `assignRitualRoles` (que envuelve/extiende la lógica de R1 según `ritual.phase`). `buildCandidates` gana ramas para los roles nuevos:
- **FETCH:** si el agente carga un objeto → meta = altar (y al llegar, `depositCarried`); si no → objeto descubierto ON_MAP sin portador más cercano (y al llegar, `pickup`).
- **CHANNEL:** meta = celda del altar; al estar en rango, cuenta como canalizador (no se mueve).
- **DEFEND:** meta = celda entre el fantasma y el altar / acceso cercano.
- **DISTRACT:** meta = hacia el fantasma, lejos del altar.

### 5. Contrajuego del fantasma

- **Susto = soltar:** en `roar()`, para cada superviviente que entra en `flee`, si es portador → `dropCarried(ritual, h.id, celda)`; su malla se deja en el suelo.
- **Interrupción de canalización:** en CHANNEL, si el fantasma **mata** a un canalizador (`killHunter`) o **ruge** dentro del rango del altar, el `channelTick` del frame recibe `interrupt=true` (la barra retrocede). Matar además reduce el nº de canalizadores.
- La **cacería** existente es el momento de máximo peligro durante CHANNEL (puede barrer el altar); de ahí DEFEND/DISTRACT.

### 6. Victoria y escalada

- `checkEnd`: `ritual.phase==='DONE'` → `endGame(false, 'El ritual te ha destruido.')` (gana el equipo humano). Todos muertos → `endGame(true, 'Eliminaste a todos antes del ritual.')`. Se elimina la rama de victoria por timeout.
- **Escalada:** al `timeLeft ≤ 0`, `escalated=true` (permanente): cacería continua/letal (visión espectral siempre on), banner "EL VELO SE ROMPIÓ — CACERÍA PERMANENTE", reloj a 0:00/∞. El fantasma no gana esperando.

### 7. HUD

- "Monitores X/4" → "Objetos rituales **X/N**" (depositados) en GATHER; **barra "RITUAL ▓▓▓░ 62%"** en CHANNEL; indicador de fase.
- Minimapa: icono fijo del **altar** + objetos rituales **descubiertos**; overlay debug (`O`) añade fase + nº de canalizadores.

## Constantes tuneables (nuevas)

- `NUM_RITUAL_OBJECTS` (≈4).
- `NEED_CHANNELERS` (≈2–3).
- `CHANNEL_TIME` (s para llenar la barra sin interrupciones).
- `CHANNEL_PENALTY` (retroceso/seg al interrumpir).
- `ALTAR_RANGE` (distancia para contar como canalizador).
- `DROP_ON_SCARE` (bool, =true).

## Riesgos y mitigaciones

- **Estancamiento (ni ritual ni wipe):** la escalada del temporizador fuerza el cierre; balancear `CHANNEL_TIME`/`needChannelers`.
- **Acarreo frágil/exploit:** si el fantasma campea el altar, los objetos sueltos se re-descubren; DEFEND/DISTRACT y la dispersión de R1 lo mitigan; tunar `DROP_ON_SCARE`/penalización.
- **Render de carga (reparent de SkinnedMesh):** seguir al portador por posición (no reparent del skeleton) si el reparent da problemas; medir caja como en R1.
- **Rendimiento:** N objetos + altar son pocas mallas; sin impacto. Verificar FPS con CDP.
- **Reparto de roles en CHANNEL con pocos vivos:** si vivos < needChannelers, todos CHANNEL y la barra sube si es seguro; sin DISTRACT/DEFEND.

## Verificación

- **`node --test`** sobre `ritual.js`: transiciones pickup/drop/deposit; `allDeposited`→CHANNEL; `channelTick` sube con ≥N y **baja** con `interrupt`; DONE al 100%; `assignRitualRoles` da `needChannelers` CHANNEL en fase CHANNEL y roles de GATHER en GATHER.
- **Manual (CDP headless):** los 8 descubren y **acarrean** objetos al altar; rugir a un portador lo hace **soltar**; depositar todos → **CHANNEL**; ≥N en el altar suben la barra; matar/rugir junto al altar la **bajan**; 100% → **ganan** (mensaje de ritual); `timeLeft=0` → **cacería permanente**; FPS estable, consola limpia.

## Ganchos para fases siguientes

- El kit de habilidades (**R3**) podrá interrumpir el ritual de formas nuevas (Distorsión sobre canalizadores, Trampa en accesos) inyectando en el mismo `interrupt`/eventos.
- **Parry** (**R4**) sigue como costura desactivada; durante CHANNEL será especialmente relevante.
