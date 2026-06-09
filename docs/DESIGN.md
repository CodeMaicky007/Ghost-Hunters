# Ghost Hunters: Reversed — Diseño (núcleo fijado)

> Mini-spec para evitar más pivotes. Versión Backrooms. 8 jun 2026.

## Pitch
Phasmophobia **al revés**, ambientado en los **Backrooms**. Eres **la entidad** (1ª persona).
Un grupo de humanos investiga el nivel completando **misiones tipo Among Us**. Tú los
**estorbas** con habilidades para que no terminen, y cada cierto tiempo desatas una **CACERÍA**
en la que puedes matarlos.

## El tema "AL REVÉS" (ancla)
1. **Roles invertidos:** no cazas al fantasma — *eres* el fantasma cazando humanos.
2. **La cacería invierte el mundo:** al rugir, **las luces fluorescentes mueren**. Los humanos
   (que tenían la luz) quedan **ciegos** y corren a esconderse; **tú ves en la oscuridad**
   (visión espectral: brillan a través de las paredes). El que veía deja de ver; el acechado caza.

*(Se descartó la inversión de controles y el negativo de pantalla.)*

## Bucle
- **Humanos (IA):** recorren el mapa completando misiones (varios tipos). Si las terminan todas → **ganan ellos**.
- **Fantasma (jugador):** estorba con habilidades + sustos; en la cacería, mata.
- **Victoria fantasma:** matar a todos **o** agotar el tiempo (~3 min) sin que completen las misiones.
- **Cacería:** cada ~40 s, dura ~12 s. Rugido → luces fuera → visión espectral → letalidad.

## Habilidades del fantasma
- v1: **Susto** (interrumpe tarea / hace huir), **Frío + abrigo** (congela zona; humanos buscan abrigo),
  **Temblor** (inmoviliza un radio + screen-shake).
- Extended: **Alarido** (revela a los escondidos), más variedad.

## Estética y audio
- **Backrooms:** paredes mono-amarillas, moqueta húmeda, techos con **paneles fluorescentes emisivos**,
  pasillos largos y repetitivos, mapa grande (~26×26), niebla cálida densa.
- **Personajes:** sprites prerenderizados **CC0/CC-BY** (acreditados); placeholder mejorado mientras se integran.
- **Audio:** ambiente Backrooms sintetizado (zumbido fluorescente + drone). En la cacería el zumbido
  se corta → silencio → rumble. Rugido, susto, congelación, muerte.

## Técnica
- Three.js (importmap+CDN), entrega itch.io. Muros con **InstancedMesh** (mapa grande sin perder FPS).
- ≤2 luces dinámicas; iluminación base por **emisivos + ambiente** (la cacería baja ambos a ~0).
- Visión espectral = sprites de humanos con `depthTest=false` + color brillante durante la cacería.

## Roadmap
- **MVP (d1-4):** mundo Backrooms + cacería (luces fuera + visión espectral) + bots con 2 tipos de tarea
  + escondites + Susto + 1 habilidad + victoria/derrota.
- **Extended (d5-6):** kit completo de habilidades (frío+abrigo, temblor), más tareas, parpadeos, sprites CC0.
- **Pulido (d7):** juice, menú, dificultad, entrega itch.io.
