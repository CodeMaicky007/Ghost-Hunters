// ============================================================
//  "Sala temática" (R8): un rincón de sala de espera/cine
//  abandonado con mobiliario real (sillón + juego de sillas).
//  Se coloca en UNA zona abierta concreta (no scatter por el
//  mapa) y mira a un foco común. Solo visual (no toca colisión).
// ============================================================
import * as THREE from 'three';

// Clona un GLB, lo escala a `targetH` de alto (midiendo su caja), lo apoya en
// y=0 y lo centra en (wx,wz), girado `yaw`. El frente del modelo es su +Z.
function place(scene, gltf, wx, wz, targetH, yaw) {
  const m = gltf.scene.clone(true);
  m.rotation.y = yaw;
  m.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(m);
  m.scale.setScalar(targetH / Math.max(1e-3, box.max.y - box.min.y));
  m.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(m);
  m.position.set(wx - (box.min.x + box.max.x) / 2, -box.min.y, wz - (box.min.z + box.max.z) / 2);
  scene.add(m);
  return m;
}

// Busca el centro de una zona 3x3 abierta lejos del spawn (para que la sala
// quepa sin clavarse en muros). Devuelve [gx,gz] o null.
function findOpenArea(map, cols, rows, reachList, avoidGx, avoidGz) {
  const open = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && map[j][i] === 0;
  const open3 = (i, j) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!open(i + dx, j + dz)) return false;
    return true;
  };
  let best = null, bd = -1;
  for (const [i, j] of reachList) {
    if (!open3(i, j)) continue;
    const d = (i - avoidGx) ** 2 + (j - avoidGz) ** 2;   // lo más lejos posible del spawn
    if (d > bd) { bd = d; best = [i, j]; }
  }
  return best;
}

// Coloca la sala. Devuelve el centro de mundo [wx,wz] (o null si no hay assets/zona).
export function placeLounge(scene, assets, { map, cols, rows, cell, reachList, spawnGx, spawnGz }) {
  if (!assets || (!assets.armchair && !assets.chairs)) return null;
  const area = findOpenArea(map, cols, rows, reachList, spawnGx, spawnGz);
  if (!area) return null;
  const [agx, agz] = area;
  const cx = agx * cell, cz = agz * cell;
  const faceYaw = Math.PI;   // todo mira hacia -Z (foco común del rincón)

  // Juego de sillas al centro de la zona; sillón a un lado, ambos encarando el foco.
  if (assets.chairs) place(scene, assets.chairs, cx, cz + 0.2, 1.25, faceYaw);
  if (assets.armchair) place(scene, assets.armchair, cx - 0.95, cz - 0.15, 0.95, faceYaw + 0.5);
  return [cx, cz];
}
