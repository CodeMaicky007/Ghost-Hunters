import * as THREE from 'three';
import { classifyCell } from './logic.js';

export const WALL_RAY_THRESHOLD = 0.6; // impacto por encima de 0.6*techo => muro

// Hornea un MAP (ROWS x COLS de 0/1) desde la geometría de muros del entorno.
// Lanza un raycast vertical hacia abajo por celda (con 5 muestras) contra wallMeshes:
// si choca cerca del techo -> muro; si no choca -> libre (el suelo queda implícito).
export function bakeGrid(wallMeshes, width, depth, cell, ceilY) {
  const cols = Math.max(3, Math.round(width / cell) + 1);
  const rows = Math.max(3, Math.round(depth / cell) + 1);
  const ray = new THREE.Raycaster();
  ray.far = ceilY + 2;
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const samples = [[0, 0], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];
  const map = Array.from({ length: rows }, () => new Array(cols).fill(0));
  let walls = 0, open = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) { map[j][i] = 1; walls++; continue; }
    let wallVotes = 0;
    for (const [dx, dz] of samples) {
      origin.set((i + dx) * cell, ceilY + 1, (j + dz) * cell);
      ray.set(origin, down);
      const hits = ray.intersectObjects(wallMeshes, true);
      const hitY = hits.length ? hits[0].point.y : null;
      wallVotes += classifyCell(hitY, ceilY, WALL_RAY_THRESHOLD);
    }
    // Cualquier muestra que toque muro => celda muro. Los tabiques del modelo son
    // finos (~1 celda); exigir mayoría borraría casi todo el laberinto.
    map[j][i] = wallVotes >= 1 ? 1 : 0;
    map[j][i] ? walls++ : open++;
  }
  return { map, cols, rows, walls, open };
}
