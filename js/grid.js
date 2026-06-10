import * as THREE from 'three';

// Hornea un MAP (ROWS x COLS de 0/1) desde la geometría de muros del entorno
// RASTERIZANDO la huella XZ de cada triángulo de muro: marca toda celda que un
// triángulo toque. Conservador (no se salta muros finos) y exacto a cualquier
// resolución — a diferencia del raycast por centro de celda, que saltaba los
// tabiques finos no alineados al grid y los dejaba atravesables.
export function bakeGrid(wallMeshes, width, depth, cell, ceilY) {
  const cols = Math.max(3, Math.round(width / cell) + 1);
  const rows = Math.max(3, Math.round(depth / cell) + 1);
  const map = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const floorThresh = Math.max(0.4, ceilY * 0.15); // ignora geometría a ras de suelo
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  for (const mesh of wallMeshes) {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry; const pos = geo.attributes.position; if (!pos) continue;
    const index = geo.index;
    const triVerts = index ? index.count : pos.count;
    for (let t = 0; t + 2 < triVerts; t += 3) {
      const ia = index ? index.getX(t) : t, ib = index ? index.getX(t + 1) : t + 1, ic = index ? index.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
      if (Math.max(a.y, b.y, c.y) < floorThresh) continue; // triángulo pegado al suelo
      const i0 = Math.max(0, Math.round(Math.min(a.x, b.x, c.x) / cell));
      const i1 = Math.min(cols - 1, Math.round(Math.max(a.x, b.x, c.x) / cell));
      const j0 = Math.max(0, Math.round(Math.min(a.z, b.z, c.z) / cell));
      const j1 = Math.min(rows - 1, Math.round(Math.max(a.z, b.z, c.z) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) map[j][i] = 1;
    }
  }

  let walls = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) map[j][i] = 1; // borde
    if (map[j][i] === 1) walls++;
  }
  return { map, cols, rows, walls, open: cols * rows - walls };
}
