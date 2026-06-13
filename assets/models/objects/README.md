# Objetos del ritual — slots "drop-in"

El juego carga estos 3 objetos desde aquí **si existe el archivo**; si no, usa un
modelo procedural de respaldo (`js/propmodels.js`). No hay que tocar código: deja
el `.glb` con el nombre exacto y al recargar se usa.

| Archivo            | Qué es en el juego                         | Respaldo procedural |
|--------------------|--------------------------------------------|---------------------|
| `mission.glb`      | Estación de misión (monitor que apagan)    | CRT con pantalla emissive |
| `altar.glb`        | Altar del ritual (brilla al canalizar)     | Altar de piedra + sigilo |
| `cross.glb`        | Reliquia que los supervivientes acarrean   | Cruz de madera |

## Cómo añadir uno (p. ej. de Sketchfab)

1. Descarga el modelo en **GLB** (un solo archivo, con texturas embebidas — es lo
   más cómodo). También vale una carpeta `.gltf` + `.bin` + `texturas`, pero
   entonces el `.gltf` debe llamarse igual que el slot y referenciar bien sus
   rutas relativas.
2. Renómbralo a `mission.glb` / `altar.glb` / `cross.glb` y déjalo en esta carpeta.
3. Recarga el juego. Yo ajusto después escala/orientación/material si hace falta.

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
