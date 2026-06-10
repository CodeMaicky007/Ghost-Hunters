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

  // Render a doble cara: la cáscara y los tabiques finos del GLB tienen normales
  // hacia fuera; sin esto, desde dentro se ve A TRAVÉS de ellos hacia el vacío/pozo.
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m.side = THREE.DoubleSide;
  });

  // Encierra el área jugable: muros perimetrales + tapa de techo. Cierra el mapa,
  // tapa la caída al pozo de la cáscara y el vacío negro que se veía al mirar
  // arriba. Reutiliza los materiales del GLB (papel/techo) para que no desentone.
  buildEnclosure(scene, width, depth, wallMeshes, meshes[info.ceiling]);

  scene.add(root);
  return { root, ceilY: TARGET_CEIL, width, depth, wallMeshes };
}

// Material clonado del GLB con su textura repetida (sin estirar) a 'tile' unidades
// por mosaico; clona también el mapa para no alterar la malla original.
function tiledMat(srcMesh, repU, repV, fallbackColor) {
  let m;
  if (srcMesh && srcMesh.material) {
    const sm = Array.isArray(srcMesh.material) ? srcMesh.material[0] : srcMesh.material;
    m = sm.clone();
    if (m.map) {
      m.map = m.map.clone();
      m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
      if (repU != null) m.map.repeat.set(repU, repV);
      m.map.needsUpdate = true;
    }
  } else {
    m = new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 0.95 });
  }
  m.side = THREE.DoubleSide;
  return m;
}

// Muros perimetrales (papel del GLB, tiled) hasta una tapa de techo opaca por
// encima del techo del GLB. TILE ≈ alto de pared para que el mosaico no se estire.
function buildEnclosure(scene, width, depth, wallMeshes, ceilMesh) {
  const CAP_Y = TARGET_CEIL + 0.2;   // altura de la tapa (sobre el techo del GLB)
  const T = 0.25;                    // grosor del muro perimetral
  const TILE = 2.6;                  // unidades de mundo por mosaico de papel
  const src = wallMeshes.find((m) => m.material);

  const wall = (sx, sz, cx, cz) => {
    const len = Math.max(sx, sz);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sx, CAP_Y, sz),
      tiledMat(src, len / TILE, CAP_Y / TILE, 0x8a7a2a),
    );
    m.position.set(cx, CAP_Y / 2, cz);
    scene.add(m);
  };
  wall(width + 2 * T, T, width / 2, 0);      // sur  (z=0)
  wall(width + 2 * T, T, width / 2, depth);  // norte (z=depth)
  wall(T, depth + 2 * T, 0, depth / 2);      // oeste (x=0)
  wall(T, depth + 2 * T, width, depth / 2);  // este  (x=width)

  // Tapa de techo: cierra el vacío que se veía al mirar hacia arriba. Reusa el
  // material del techo del GLB para que sea el mismo "papel de techo".
  const cap = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 2 * T, depth + 2 * T),
    tiledMat(ceilMesh, null, null, 0x15110a),
  );
  cap.rotation.x = Math.PI / 2;              // horizontal, mirando hacia abajo
  cap.position.set(width / 2, CAP_Y, depth / 2);
  scene.add(cap);
}

function boxOf(mesh) {
  const b = new THREE.Box3().setFromObject(mesh);
  return { minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z };
}
