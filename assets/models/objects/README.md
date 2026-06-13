# Objetos del ritual — slots "drop-in"

El juego mapea cada objeto del ritual a un archivo GLB real (o a un modelo
procedural de respaldo). El mapeo está en `js/assets.js` -> `SLOT_FILES`:

| Slot      | Archivo actual                          | Qué es / respaldo procedural |
|-----------|-----------------------------------------|------------------------------|
| `mission` | `proyecto_final_televisor_entrega.glb`  | Monitor/TV que los investigadores apagan (pantalla con tinte de progreso) |
| `altar`   | *(null)*                                | Altar procedural de piedra + sigilo |
| `cross`   | *(null)*                                | Cruz procedural de madera |

## Cómo añadir/cambiar un objeto (p. ej. de Sketchfab)

1. Descarga el modelo en **GLB** (un solo archivo con texturas embebidas — lo más
   cómodo) y déjalo en esta carpeta.
2. Apunta el slot a tu archivo en `SLOT_FILES` (o dime el nombre y lo cableo yo).
3. Recarga. Yo ajusto escala/orientación/material si hace falta (el frente debe
   mirar a +Z; la escala se normaliza por altura).

### Notas de integración (lo que hago yo al recibirlos)
- **Escala**: se escala midiendo la altura (Box3) hasta la altura objetivo del
  slot. Funciona con modelos *verticales* bien proporcionados; un objeto plano se
  ve enorme (hay que afinarlo a mano).
- **Orientación**: el frente debe mirar a **+Z** (se gira para encarar al jugador).
- **`mission.glb`**: si tiene una pantalla con textura **emissive**, el progreso
  rojo→verde se ve en ella. Si no, tiñe todo el material (también vale).
- **Formatos**: evita FBX si puedes (exporta GLB). Three r160 puede no pintar
  `KHR_materials_pbrSpecularGlossiness`; si un modelo sale gris/raro, suele ser eso.
- **Animaciones de personajes** (Mixamo, etc.): se conectan aparte; exporta el
  GLB/FBX rigeado y lo enlazo al sistema de animación.

> Los `.glb` antiguos de prototipo (`mesa`, `vintage_television…`, `wooden_cross`)
> ya **no se usan**; quedan aquí por si los quieres conservar.
