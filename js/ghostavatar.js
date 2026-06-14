// ============================================================
//  Avatar de LA ENTIDAD (R8): el monstruo Backrooms es la forma
//  visible del fantasma que controla el jugador. Va con el jugador
//  (los investigadores huyen de él) y se abalanza en pantalla
//  (JUMPSCARE) en el Mori.
//
//  El GLB viene casi negro y sin texturas -> realce espectral. Y se
//  mide/centra por los HUESOS del esqueleto, no por Box3 del mesh:
//  en un SkinnedMesh el Box3 da la talla del bind-pose (mentira),
//  por eso antes salía diminuto. Los huesos dan la talla real posada.
// ============================================================
import * as THREE from 'three';

const asArr = (m) => (Array.isArray(m) ? m : [m]);

// Caja que abarca las posiciones de mundo de TODOS los huesos (talla real posada).
function skeletonBox(root) {
  const box = new THREE.Box3(); const v = new THREE.Vector3(); let found = false;
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) for (const b of o.skeleton.bones) { b.getWorldPosition(v); box.expandByPoint(v); found = true; }
  });
  return found ? box : null;
}

export function createGhostAvatar(scene, gltf, { height = 2.6 } = {}) {
  if (!gltf || !gltf.scene) return null;
  const root = gltf.scene;

  // Realce: levanta el material (casi negro), pálido y algo emissive frío.
  let meshCount = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    meshCount++;
    o.visible = true;                 // Sketchfab a veces exporta mallas ocultas
    o.castShadow = o.receiveShadow = false;
    o.frustumCulled = false;
    for (const m of asArr(o.material)) {
      m.color = new THREE.Color(0x8c8a93);
      m.emissive = new THREE.Color(0x394a63);
      m.emissiveIntensity = 0.55;
      m.roughness = 0.85; m.metalness = 0.0;
      m.side = THREE.DoubleSide;
      m.transparent = true; m.opacity = 0.95; m.depthWrite = true;
    }
  });

  const group = new THREE.Group();
  group.add(root);
  group.visible = false;
  scene.add(group);

  // Mixer + clips (nombres tipo "Armature.001|stalkingpose").
  const mixer = new THREE.AnimationMixer(root);
  const clips = {};
  for (const a of gltf.animations) clips[a.name.split('|').pop()] = a;
  const cache = {};
  const action = (name) => {
    if (cache[name] !== undefined) return cache[name];
    const c = clips[name];
    cache[name] = c ? mixer.clipAction(c) : null;
    return cache[name];
  };

  // Posa el rig (la bind-pose puede estar colapsada) y MIDE POR HUESOS para
  // escalar a `height` y centrar/apoyar en y=0. Recalcula tras escalar.
  const poseName = clips.stalkingpose ? 'stalkingpose' : (clips.TposeLifeform ? 'TposeLifeform' : Object.keys(clips)[0]);
  if (poseName) { const a = action(poseName); if (a) a.play(); }
  mixer.update(0.3);
  group.updateMatrixWorld(true);
  let bbox = skeletonBox(root) || new THREE.Box3().setFromObject(root);
  root.scale.multiplyScalar(height / Math.max(1e-3, bbox.max.y - bbox.min.y));
  group.updateMatrixWorld(true);
  bbox = skeletonBox(root) || new THREE.Box3().setFromObject(root);
  root.position.x -= (bbox.min.x + bbox.max.x) / 2;
  root.position.z -= (bbox.min.z + bbox.max.z) / 2;
  root.position.y -= bbox.min.y;

  let current = null, currentName = poseName || '';
  function play(name, { loop = true } = {}) {
    if (currentName === name) return;
    const act = action(name) || action('stalkingpose') || action(Object.keys(clips)[0]);
    if (!act) return;
    act.reset();
    act.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    act.clampWhenFinished = !loop;
    if (current && current !== act) current.fadeOut(0.25);
    act.fadeIn(0.25).play();
    current = act; currentName = name;
  }

  return {
    group,
    meshCount,
    clipNames: Object.keys(clips),
    hasClip: (name) => !!clips[name],
    setPose(x, y, z, yaw) { group.visible = true; group.position.set(x, y, z); group.rotation.y = yaw; },
    hide() { group.visible = false; },
    play,
    update(dt) { mixer.update(dt); },
  };
}
