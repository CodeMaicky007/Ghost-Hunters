import * as THREE from 'three';
import { computeEnvScale, analyzeEnvMeshes } from './logic.js';

export const TARGET_CEIL = 2.7; // altura suelo->techo objetivo tras escalar (unidades de mundo)

// Escala/coloca el GLB del entorno y devuelve los datos que necesita el horneado:
//   { root, ceilY, width, depth, wallMeshes }
// - El suelo de la sala queda en y=0 y su esquina (xmin,zmin) en el origen.
// - ceilY ~= TARGET_CEIL.  width/depth = huella de la sala (no de la cáscara).
// - wallMeshes = solo la geometría de muro (sin suelo/techo/cáscara) para raycastear.
export function placeEnv(scene, gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // Lista estable de mallas + sus AABB nativos (mismo orden -> mismos índices).
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const nativeBoxes = meshes.map((m) => boxOf(m));
  const info = analyzeEnvMeshes(nativeBoxes);

  // Escalar para que la sala (suelo->techo) mida TARGET_CEIL de alto.
  const scale = computeEnvScale(info.ceilHeight, TARGET_CEIL);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  // Colocar: suelo a y=0 y esquina del suelo en el origen.
  const floorBox = new THREE.Box3().setFromObject(meshes[info.floor]);
  root.position.x += -floorBox.min.x;
  root.position.y += -floorBox.min.y;
  root.position.z += -floorBox.min.z;
  root.updateMatrixWorld(true);

  const width = floorBox.max.x - floorBox.min.x;
  const depth = floorBox.max.z - floorBox.min.z;
  const wallMeshes = info.walls.map((i) => meshes[i]);

  scene.add(root);
  return { root, ceilY: TARGET_CEIL, width, depth, wallMeshes };
}

function boxOf(mesh) {
  const b = new THREE.Box3().setFromObject(mesh);
  return { minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z };
}
