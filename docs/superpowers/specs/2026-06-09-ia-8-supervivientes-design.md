# Ghost Hunters: Reversed — Rebanada 1: Cerebro IA de los 8 supervivientes

> Diseño validado. 9 jun 2026. Arquitectura elegida: **A — Coordinador de escuadrón + utilidad individual (híbrido)**, con núcleo puro testeable separado de la capa de render.

## Contexto y norte ampliado

El doc de visión amplía el juego mucho más allá del prototipo actual y se adopta como **norte**, implementado **por fases** (cada una con su propio spec→plan→implementación), manteniendo el prototipo jugable en cada paso. Hoja de ruta acordada:

1. **R1 — Cerebro IA de los 8 supervivientes** *(este documento)*.
2. **R2 — Progresión de objetivos en capas + ritual final + nueva condición de victoria** (pistas → recursos → objetos rituales → invocación → ritual final; el fantasma se destruye = ganan).
3. **R3 — Kit de habilidades del fantasma + cacería de 30s** (Susurro, Distorsión, Aparición, Teletransporte, Trampa Paranormal + cacería: salidas bloqueadas, parpadeo, kill instantáneo, más rápido, estrés).
4. **R4 — Sistema de Parry** (uno por cacería, ventana mínima, éxito = aturde 3s, fallo = muerte; la IA lo ejecuta).

Las dependencias mandan el orden: R1 da vida a los agentes sobre el andamiaje actual; R2 les da el bucle de objetivos; R3 genera los eventos paranormales que la IA de R1 ya sabe consumir; R4 se engancha a la cacería de R3.

## Objetivo de la Rebanada 1

Sustituir la IA simple actual (3 investigadores que van a la estación más cercana y huyen a la celda más lejana) por **8 supervivientes que se comporten como un escuadrón humano coordinado**: exploran con niebla de descubrimiento, recuerdan, se dividen en grupos y se reagrupan ante el peligro, sienten miedo (con estado de pánico recuperable), se comunican con barks + lenguaje corporal, reaccionan a eventos paranormales y se dispersan inteligentemente en cacería.

### Decisiones tomadas en brainstorming

1. **Legibilidad:** la "humanidad" se hace perceptible al fantasma mediante **barks** (burbujas de texto efímeras) **+ lenguaje corporal** (animaciones/posturas). Además, un **overlay de depuración** con toggle (no afecta al juego) para verificar la IA.
2. **Miedo → efecto:** estrés máx / cordura mín = **estado de PÁNICO recuperable** (deja de progresar, huye errático, más errores, más fácil de matar; se recupera al calmarse con el grupo).
3. **Exploración:** **niebla de descubrimiento** con **memoria compartida** (no conocen el mapa ni los objetivos de inicio; descubren, recuerdan y comparten).
4. **Arquitectura:** **A — coordinador de escuadrón + utilidad individual**, núcleo puro (sin THREE) testeable con `node --test`.

## Alcance

**Dentro (R1):**
- Escalar de 3 a 8 supervivientes.
- Stats por agente (valentía/estrés/cordura) y estado de pánico.
- Pizarra compartida: niebla de descubrimiento, frontera de exploración, objetivos descubiertos, zonas de peligro, eventos, roster.
- Coordinador de escuadrón (asignación de roles + reagrupamiento por amenaza).
- Decisión individual por utilidad modulada por stats.
- Barks + lenguaje corporal; overlay de depuración (toggle).
- Reacción a eventos paranormales (rugido/susto, cacería, muertes — los que ya existen).
- Dispersión inteligente en cacería; cooperación (esperar rezagados, ayudar a aislados, avisar, compartir).

**Fuera (fases siguientes):**
- **Condiciones de victoria sin cambio** (matar a todos / aguantar el tiempo; supervivientes ganan completando las estaciones actuales). La niebla solo condiciona *cuándo* pueden trabajar una estación. El ritual y la nueva victoria son **R2**.
- **Habilidades del fantasma:** sigue solo el rugido/susto actual. La IA reacciona a eventos genéricos, listos para que **R3** inyecte el kit.
- **Parry:** costura limpia (`tryParry()` desactivado/que siempre falla) para que **R4** lo rellene sin tocar la arquitectura.

## Arquitectura

Separación **núcleo puro / capa de render**, siguiendo el patrón de `logic.js` (THREE-free, testeable en Node).

| Componente | Qué hace | Depende de |
|---|---|---|
| **`js/ai.js`** (nuevo, puro, sin THREE) | El cerebro: pizarra, coordinador (`assignRoles`), utilidad (`chooseGoal`), miedo (`updateFear`), barks (`barkFor`), reacción a eventos y selección de celdas de dispersión. Funciones puras sobre datos planos (grid, celdas, estado de agentes). | grid (MAP/cols/rows/cell), helpers de celda |
| **`js/hunters.js`** (extender `HunterModel`) | Burbuja de bark (sprite de texto) + helpers de lenguaje corporal (mirar atrás, agacharse, huddle) sobre los clips disponibles. | THREE, GLB de personaje |
| **`js/main.js`** (orquestador) | Posee `agents[]`; construye la pizarra en `boot()`; llama al coordinador a baja frecuencia y a la utilidad por agente con repath escalonado; mapea decisiones a `stepToward`/`bfsNext`/`faceDir`/animación; dibuja barks y el overlay. | `ai.js`, `hunters.js`, grid/BFS existentes |
| **`test/ai.test.js`** (nuevo) | `node --test` del núcleo puro. | `ai.js` |

## Modelo de datos

**Pizarra compartida** (conocimiento del escuadrón, una por partida):
- `discovered`: `Set` de claves de celda ya vistas (niebla). Cada agente descubre celdas dentro de su radio de visión.
- `frontier`: celdas no descubiertas adyacentes a descubiertas → objetivos de exploración.
- `knownObjectives`: estaciones ya descubiertas (con estado/progreso). Las no descubiertas son invisibles para la IA.
- `dangerZones`: mapa celda→score de peligro que **decae** con el tiempo; sube por eventos paranormales y muertes cercanas.
- `events`: cola de eventos paranormales recientes `{tipo, celda, t}` que consume la reacción.
- `roster`: estado público por agente `{vivo, celda, rol, estrés, últimaVezVisto}` → alimenta al coordinador y la detección de "compañero desaparecido".

**Estado por agente** (extiende `hunters[i]` actual `{pos, model, alive, next, repath, working}`):
- `bravery` (0..1, personalidad fija al nacer), `stress` (0..1 dinámico), `sanity` (1..0 dinámico), `fear` derivado.
- `role` (asignado por el coordinador: `EXPLORE_A` / `EXPLORE_B` / `SCAVENGE` / `GUARD` / `REGROUP` en R1).
- `panic` (bool + timer), `recentCells` (buffer corto anti-repetir-ruta).

La pizarra implementa de forma natural la niebla + memoria compartida; R3 solo empujará eventos a `events`/`dangerZones`.

## Coordinador de escuadrón

`assignRoles(blackboard, agents, threat)` — función pura, baja frecuencia (~cada 1–1.5 s o al saltar un evento):
- Calcula **nivel de amenaza** global = f(cacería activa, eventos recientes, muertes, miedo medio del escuadrón).
- Reparte a los vivos en grupos-tarea balanceados (2+2+2+2 con 8):
  - **EXPLORE_A / EXPLORE_B** → a las dos mayores regiones de `frontier` (alas distintas, sin solaparse).
  - **SCAVENGE** → a estaciones descubiertas e incompletas (trabajarlas).
  - **GUARD** → cerca de estaciones en progreso / objetivos valiosos.
- **Reagrupamiento:** si la amenaza supera umbral (cacería, racha de eventos, baja de un compañero) → casi todos pasan a **REGROUP** hacia un punto de encuentro (centroide de los más valientes, lejos de `dangerZones`). Al calmarse, vuelve a repartir.
- Sesgo por personalidad: los **valientes** tienden a EXPLORE/GUARD (lideran); los **nerviosos**, a SCAVENGE acompañados o REGROUP.

## Decisión individual (utilidad)

`chooseGoal(agent, blackboard, grid)` — pura, por agente. Dado su rol + pizarra + stats, elige **celda objetivo** puntuando por utilidad:
- `+` avanzar al objetivo de su rol;
- `−` cercanía a `dangerZones` (peso ↑ con el miedo);
- `+` quedarse cerca de aliados (peso ↑ con miedo / ↓ con valentía);
- `+` curiosidad hacia `frontier` (peso ↑ con valentía);
- `−` celdas en `recentCells` (anti-repetir ruta).

Devuelve celda objetivo + velocidad/animación deseada + posible disparo de bark. El movimiento real sigue usando `bfsNext`/`stepToward` existentes. La **imperfección humana** emerge del ruido por stats: dudan, cambian de rumbo y cometen errores sin scripting explícito.

## Miedo y pánico

`updateFear(agent, ctx, dt)` — pura, cada frame:
- `stress` **sube** cerca del fantasma, con eventos, en oscuridad y estando **solo**; **baja** agrupado + seguro + con luz.
- `sanity` drena lento bajo estrés sostenido; recupera lento al calmarse.
- `fear = g(stress, sanity, bravery)`.
- **PÁNICO** al tocar estrés≈máx & cordura≈mín: deja de progresar objetivos, huye errático, más errores, más fácil de matar (y peor parry cuando llegue R4). **Recuperable** cuando el miedo baja un tiempo (calmado por estar agrupado y seguro).

## Comunicación (barks) + lenguaje corporal

- `barkFor(agent, eventOrStateChange)` (puro) → **intent de bark**: clave de texto + prioridad + emisor. Disparadores: hallar objetivo ("¡aquí hay algo!"), peligro ("¡no vayáis al norte!"), miedo alto ("no me gusta esto…"), reagrupar ("¡todos conmigo!"), compañero desaparecido ("¿dónde está Sam?"), cacería ("¡CORRED!").
- La capa de render (`HunterModel`) muestra una **burbuja de texto efímera** sobre la cabeza, con rate-limit; el miedo las hace más cortas y frecuentes.
- **Lenguaje corporal** sobre clips disponibles: caminar/correr/interactuar/idle ya existen; se añaden *mirar atrás* (oscilación breve de yaw con miedo), *agacharse/encogerse* y *huddle* (acercarse al grupo). Si falta un clip concreto se aproxima con movimiento; **los nombres reales de clips se verifican al implementar** (el pack Quaternius indexa por sufijo tras `CharacterArmature|`).

## Reacción a eventos, cacería y cooperación

- **Reacción a eventos paranormales:** cuando algo entra en `events` (hoy: rugido/susto, cacería, muertes; R3 añadirá las habilidades), los cercanos suben `stress`, marcan `dangerZones` en esa celda, **barkean** el aviso, **reenrutan** lejos y suben vigilancia. Eventos **repetidos en la misma zona** acumulan peligro → el coordinador la evita en juego normal. (El "investigar la zona sospechosa" queda enganchado para R2, cuando exista el objetivo de localizar al fantasma.)
- **Cacería — dispersión inteligente:** al activarse, el coordinador pone a todos en **ESCAPE**, pero a celdas **distintas** entre sí y lejos del fantasma (no todos a la misma celda lejana como hoy). La selección reparte destinos para que el fantasma no pueda barrerlos juntos.
- **Cooperación:** esperar rezagados (un grupo frena si un miembro se queda atrás), ayudar a aislados (un valiente se acerca a un asustado solo), avisar (bark de peligro), compartir hallazgos (vía pizarra). Nunca actúan como individuos totalmente independientes.

## Integración con el código actual

- `NUM_HUNTERS` **3 → 8**. `hunters[]` → `agents[]`, con los nuevos campos (stats/rol/pánico/memoria). `updateHunter` se reescribe para **delegar la decisión** en `ai.js` y conservar `stepToward`/`bfsNext`/`faceDir`/animación.
- `main.js` construye la **pizarra** en `boot()`, llama al coordinador a baja frecuencia y a la utilidad por agente con **repath escalonado** (no los 8 en el mismo frame).
- `HunterModel`: añade burbuja de bark + helpers de lenguaje corporal.
- **Overlay de depuración** con toggle (tecla `O`): etiquetas de rol/estrés y colores de grupo sobre el minimapa y/o cabezas. No afecta al juego.

## Rendimiento

8 personajes animados + IA: reutilizar los modelos GLB ya cargados clonados a 8 instancias (`SkeletonUtils.clone`); coordinador a baja frecuencia; repath escalonado; ≤2 luces dinámicas (ya es así). Verificar FPS con el flujo CDP/headless del proyecto.

## Constantes tuneables (nuevas)

- `NUM_SURVIVORS` (=8).
- `VISION_RADIUS` (radio de descubrimiento de celdas por agente).
- `DANGER_DECAY` (decaimiento del score de zonas de peligro).
- `THREAT_REGROUP` (umbral de amenaza que dispara reagrupamiento).
- `PANIC_IN` / `PANIC_OUT` (umbrales de entrada/salida de pánico, con histéresis).
- `COORD_HZ` (frecuencia del coordinador).
- `BARK_COOLDOWN` (rate-limit de barks por agente).
- Pesos de utilidad (rol / peligro / aliados / frontera / anti-repetir).

## Riesgos y mitigaciones

- **Coordinador "demasiado perfecto"** → ruido/latencia por stats por agente; decisiones imperfectas emergen del miedo.
- **Rendimiento con 8 skinned meshes** → clonado de modelos ya cargados, coordinador a baja Hz, repath escalonado; verificación CDP de FPS.
- **Mapa muy abierto** (la sala horneada puede tener poca estructura) → la utilidad de frontera/curiosidad mantiene la exploración con sentido aunque haya pocos muros.
- **Clips de lenguaje corporal ausentes** → fallback a aproximación por movimiento; nombres verificados al implementar.
- **Pánico injusto si llega pronto** → histéresis `PANIC_IN`/`PANIC_OUT` y recuperación al agruparse.

## Verificación

- **`node --test`** sobre `ai.js`:
  - El coordinador reparte roles de forma balanceada (2+2+2+2 con 8 vivos) y dispara REGROUP cuando la amenaza supera el umbral.
  - La utilidad elige celdas que **evitan** `dangerZones` y penaliza `recentCells`.
  - Transiciones de miedo: estrés sostenido → PÁNICO; calma sostenida → recuperación (con histéresis).
  - El descubrimiento añade celdas a `discovered` y reduce `frontier`.
  - La dispersión en cacería devuelve celdas **distintas** entre agentes.
- **Manual (servidor local + CDP/headless):** 8 supervivientes que exploran sin repetir rutas, se dividen en grupos y se reagrupan ante peligro, barkean con burbujas, entran en pánico bajo estrés y se recuperan, se dispersan a sitios distintos en cacería; FPS estable; sin errores en consola.

## Ganchos para fases siguientes

- `events`/`dangerZones` listos para que **R3** inyecte el kit de habilidades.
- "Investigar zona sospechosa" y objetivos en capas → **R2**.
- `tryParry()` (costura desactivada) → **R4**.
