# Ghost Hunters: Reversed — Rebanada 3: Kit del fantasma + cacería de 45s + percepción invertida

> Diseño validado. 10 jun 2026. Arquitectura elegida: **A — módulo puro `js/abilities.js` (energía + estado de habilidades) + integración en `main.js`**.

## Contexto

Tercera rebanada del norte por fases (ver `DESIGN.md`, R1 `2026-06-09-ia-8-supervivientes`, R2 `2026-06-10-progresion-ritual`). R1 dio el cerebro IA; R2 el bucle ritual + victoria. R3 da al **fantasma (jugador)** su kit y refuerza el tema "AL REVÉS" con una **inversión de percepción**: normalmente invisible (te sienten por sonido), visible en cacería.

Hoy el fantasma solo tiene **rugido/susto** y la **cacería auto-temporizada** (40s/12s); R3 la sustituye por una cacería **activada por energía**, más larga y letal-pero-evitable, más 4 habilidades.

## Objetivo

Dar al fantasma: una **barra de Energía Paranormal** que gasta en habilidades y llena para **activar la cacería**; **4 habilidades** (Teletransporte, Trampa, Aparición, Visión espectral); una **cacería de ~45s** (visible, +rápido, parpadeo, letal en rango); y una **percepción invertida** (invisible+audible en normal ↔ visible+silencioso en cacería) que hace que la IA **nunca se acerque** al fantasma en juego normal.

### Decisiones tomadas en brainstorming

1. **Recurso:** **Energía Paranormal** (barra única). Las habilidades la gastan; la cacería requiere barra llena y la consume. Sustituye la cacería auto-temporizada por una activada por el jugador.
2. **Kit (3 pilares + 1 de cacería):** Teletransporte, Trampa Paranormal, Aparición (señuelo) y **Visión espectral** (solo en cacería).
3. **Cacería ~45s, letal pero evitable:** mata en rango + fantasma más rápido + parpadeo + estrés; contrajuego = dispersión de R1; el Parry (R4) añadirá el salvado clutch.
4. **Percepción invertida:** normal = fantasma **invisible**, los supervivientes lo **sienten por proximidad (sonido)** y lo **evitan gradualmente** (nunca se acercan); cacería = **visible** y **sin sonido**.
5. **Visión del fantasma:** por defecto **sin** visión a través de muros; ver a través de paredes solo con la habilidad **Visión espectral**, durante la cacería.
6. **Arquitectura A:** `js/abilities.js` puro y testeable; `main.js` aplica efectos y empuja eventos a la pizarra.

## Alcance

**Dentro (R3):**
- Módulo puro `js/abilities.js`: energía (relleno/gasto), cooldowns, estado de trampas/señuelo/visión-espectral, gate de cacería.
- Integración: input (teclas + mira), efectos (teletransporte, trampa, señuelo, visión espectral, cacería), barra de energía + slots en HUD.
- Inversión de percepción: invisibilidad del fantasma (aura tenue/encendida), sentido por proximidad + evasión gradual de la IA, sonido de proximidad para el jugador.
- Cacería de ~45s: activada por energía, +rápido, parpadeo, letal en rango; ritual en pausa durante la cacería; escalada (R2) como respaldo.
- Las habilidades empujan eventos/zonas de peligro/interrupción que R1/R2 ya consumen.

**Fuera (fases siguientes):**
- **Parry** = **R4** (costura intacta; la cacería letal-pero-evitable es su antesala).
- Habilidades extra del doc (Susurro, Distorsión) — descartadas por YAGNI en R3.

## Arquitectura

| Componente | Qué hace | Depende de |
|---|---|---|
| **`js/abilities.js`** (nuevo, puro, sin THREE) | Energía + cooldowns + estado de activos (trampas/señuelo/visión) + gate de cacería. node-testeable. | — |
| **`js/main.js`** (modificar) | Input, efectos en mundo/IA, render de trampa/señuelo/aura, parpadeo, sonido de proximidad, evasión por sentido, HUD. | `abilities.js`, `ai.js`, `ritual.js` |
| **`js/ai.js`** (sin cambios de lógica) | El cerebro de R1 sigue igual; la evasión se hace en integración. | — |
| **`index.html` / `css/style.css`** | Barra de energía + 5 slots de habilidad. | — |
| **`test/abilities.test.js`** (nuevo) | `node --test` del núcleo puro. | `abilities.js` |

`abilities.js` opera con datos planos (celdas, tiempos), sin THREE.

## Detalle por sección

### 1. Modelo de datos (`js/abilities.js`)

`createAbilities()` →
```
{
  energy: 0,                               // 0..1
  cooldowns: { teleport:0, trap:0, decoy:0, spectral:0 },
  traps: [{ gx, gz, t }],                  // trampas activas (radio AB.TRAP_RADIUS)
  decoy: { gx, gz, t } | null,             // Aparición activa
  spectral: 0,                             // tiempo restante de visión espectral (s)
}
```
Constantes `AB`: `ENERGY_REGEN`, `STALK_BONUS`, `COST_TELEPORT/TRAP/DECOY`, `CD_TELEPORT/TRAP/DECOY/SPECTRAL`, `TRAP_DUR`, `TRAP_RADIUS`, `DECOY_DUR`, `SPECTRAL_DUR`, `HUNT_DUR` (≈45), `HUNT_SPEED_MULT` (≈1.3).

Funciones puras:
- `tickEnergy(ab, dt, ctx)` — `energy += (ENERGY_REGEN + (ctx.nearSurvivor ? STALK_BONUS : 0)) * dt`, clamp 0..1; baja cooldowns y `spectral`; caduca trampas/decoy.
- `canActivate(ab, key)` — `energy ≥ COST[key] && cooldowns[key] ≤ 0` (visión espectral además requiere `ctx.hunting`).
- `activate(ab, key, cell)` — gasta energía, fija cooldown; añade trampa (en `cell`), señuelo (en `cell`), o pone `spectral = SPECTRAL_DUR`. Devuelve éxito.
- `huntReady(ab)` — `energy ≥ 1`.
- `spendForHunt(ab)` — `energy = 0`.
- `agentInTrap(ab, gx, gz)` — ¿la celda cae en el radio de alguna trampa activa?

### 2. Percepción invertida

- **Invisibilidad + tell:** el `aura` (PointLight morada del fantasma) queda **tenue** en normal y **encendida** en cacería.
- **Sentido por proximidad (IA, normal):** en `updateHunter`, cada superviviente calcula su distancia al fantasma; **evasión gradual** (sin conocer la posición exacta, acotada por `SENSE_RANGE`):
  - media → sube estrés + sesga la ruta para alejarse/rodear;
  - alta (muy cerca) → `flee` breve en dirección opuesta (mini-escape).
  - **Nunca** fijan objetivo hacia el fantasma. (Reutiliza `flee`/estrés de R1; `ai.js` sin cambios.)
- **Sonido de proximidad (jugador):** susurro/latido cuyo volumen ∝ cercanía del superviviente más próximo; **silenciado en cacería**.
- **Visión del fantasma:** por defecto los supervivientes se renderizan normal (ocultos por muros). A través de muros **solo** con la habilidad de visión espectral (en cacería).

### 3. Cacería de ~45s (activada por energía)

- Activación por el jugador (tecla **Espacio**) si `huntReady`; `spendForHunt` vacía la barra. Sustituye la auto-temporizada.
- Durante la cacería: aura encendida (**visible**), `SPEED × HUNT_SPEED_MULT`, luces mueren **+ parpadean**, mata en `KILL_RANGE`, **sin** sonido de proximidad. Los supervivientes **huyen al verte** (dispersión de R1).
- **El ritual no progresa durante la cacería** (lectura de "salidas bloqueadas"): la canalización se pausa y no se puede depositar.
- **Escalada (R2):** al `timeLeft ≤ 0`, cacería permanente (ya implementado); con energía, la escalada mantiene la cacería sin gastar barra.
- Costura de **Parry (R4)** intacta.

### 4. Las 4 habilidades (efectos + targeting)

Targeting con la mira (raycast de cámara a celda transitable, clamp a alcance):
1. **Teletransporte** (normal/cacería) — `pos` salta a la celda mirada (preferencia de celda oscura). Reposicionamiento/sigilo.
2. **Trampa Paranormal** (normal/cacería) — trampa en tu celda; agentes dentro del radio: ralentizados (`speed × slow`) + estrés + `h.next=null` (reruteo). Empuja `addEvent(BB,'trap',...)` (zona de peligro; interrumpe el ritual si toca el altar). Render: decal/marca en el suelo.
3. **Aparición** (normal) — señuelo en la celda mirada (sprite/luz). Empuja `addEvent(BB,'apparition',...)`: los cercanos reaccionan (estrés + se apartan/agrupan según diseño de evento). Útil para apartarlos del altar o juntarlos antes de la cacería. Render: sprite/luz temporal.
4. **Visión espectral** (solo cacería) — `spectral = SPECTRAL_DUR`; mientras dure, los supervivientes reciben el material espectral (emissive + `depthTest=false` + `renderOrder`). Única visión a través de muros.

### 5. Integración con IA / ritual (eventos)

Las habilidades alimentan los sistemas existentes:
- Trampa/Aparición → `addEvent`/`bumpDanger` (R1: estrés, reruteo, evasión; R2: `interrupt` del ritual si cerca del altar).
- Cacería → pausa del ritual + dispersión (R1).
- Energía gana bonus al asustar (rugido) y al **acechar** (estar cerca de supervivientes), premiando el sigilo agresivo.

### 6. Input + HUD

- Teclas: **1** Rugido · **2** Teletransporte · **3** Trampa · **4** Aparición · **5** Visión espectral · **Espacio** Cacería (si barra llena). (`G` deja de "forzar cacería"; la cacería va por energía/Espacio.)
- HUD: **Barra de Energía Paranormal** (con aviso "CACERÍA LISTA" al llenarse) + **5 slots** (tecla, nombre, cooldown, atenuados si falta energía o fuera de cacería para la visión espectral). Ajustes en `index.html`/`css`.

## Constantes tuneables (nuevas)

`ENERGY_REGEN`, `STALK_BONUS`, costes y cooldowns por habilidad, `TRAP_DUR/RADIUS/SLOW`, `DECOY_DUR`, `SPECTRAL_DUR`, `SENSE_RANGE` (rango de sentido de proximidad), `HUNT_DUR` (≈45), `HUNT_SPEED_MULT` (≈1.3), `TELEPORT_RANGE`.

## Riesgos y mitigaciones

- **Evasión perfecta → imposible acorralar:** la evasión es gradual y acotada por `SENSE_RANGE`; el fantasma usa Teletransporte/Aparición/Trampa para cortarles rutas y la cacería (visible pero +rápido) para el remate. Tunear `SENSE_RANGE`/velocidades.
- **Cacería de 45s demasiado/poco letal:** dispersión de R1 como contrajuego; tunear `HUNT_SPEED_MULT`/`KILL_RANGE`/duración. Parry (R4) equilibra después.
- **Economía de energía descompensada:** todos los ritmos en constantes; verificación con `node --test` del relleno/gasto.
- **Rendimiento:** trampas/señuelo son pocas mallas; el sonido de proximidad es 1 oscilador. Sin impacto; verificar FPS por CDP.
- **Sonido en navegador headless:** el feedback de audio no se verifica por CDP (no hay gesto/audio); se valida que no haya errores y manualmente por el usuario.

## Verificación

- **`node --test`** sobre `abilities.js`: relleno/clamp de energía (+stalk), bajada de cooldowns + `spectral`, caducidad de trampas/decoy, `canActivate` (gate energía+cd; espectral requiere cacería), `activate` (gasta+cd+añade activo), `agentInTrap` (radio), `huntReady`/`spendForHunt`.
- **Manual (CDP headless):** la barra se llena; teletransporte mueve al fantasma; la trampa ralentiza a quien entra; el señuelo atrae/asusta; la cacería solo con barra llena (45s, +rápido, parpadeo, huyen al verte); la visión espectral revela a través de muros solo en cacería; **en normal los supervivientes evitan tu proximidad y nunca se acercan**; el ritual se pausa en cacería; 0 errores, FPS estable. (El sonido de proximidad se valida sin errores; el feel, manualmente por el usuario.)

## Ganchos para fases siguientes

- **Parry (R4):** la cacería letal-pero-evitable es su antesala; el kill en cacería pasará por `tryParry()` (costura).
- Habilidades extra (Susurro/Distorsión) podrían añadirse sobre el mismo `abilities.js` + sistema de eventos.
