// ============================================================
//  Avatar de LA ENTIDAD (R8): el monstruo Backrooms es la forma
//  visible del fantasma que controla el jugador. En primera persona
//  acecha tras la cámara (lo atisbas al girar; los investigadores
//  huyen de él) y se abalanza en pantalla (JUMPSCARE) en el Mori.
//
//  El GLB viene casi negro y sin texturas -> se le da un realce
//  espectral (base levantada + emissive frío translúcido) para que
//  se lea en la penumbra sin romper el confort visual de R8.
// ============================================================
import * as THREE from 'three';

const asArr = (m) => (Array.isArray(m) ? m : [m]);

export function createGhostAvatar(scene, gltf, { height = 2.6 } = {}) {
  if (!gltf || !gltf.scene) return null;
  const root = gltf.scene;

  // Escala a una altura amenazante midiendo su caja.
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  root.scale.setScalar(height / Math.max(1e-3, box.max.y - box.min.y));
  root.updateMatrixWorld(true);

  // Realce espectral: levanta la base (casi negra) y añade emissive frío tenue;
  // ligera translucidez para sensación fantasmal. depthWrite off para no recortar.
  let meshCount = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    meshCount++;
    o.visible = true;                 // Sketchfab a veces exporta mallas ocultas
    o.castShadow = o.receiveShadow = false;
    o.frustumCulled = false;
    for (const m of asArr(o.material)) {
      m.color = new THREE.Color(0x6a6470);
      m.emissive = new THREE.Color(0x4a5a72);
      m.emissiveIntensity = 0.7;
      m.roughness = 0.85; m.metalness = 0.0;
      m.side = THREE.DoubleSide;
      m.transparent = true; m.opacity = 0.92; m.depthWrite = true;
    }
  });

  // Centra el modelo en XZ y apoya su base en y=0 dentro de un grupo (el grupo se
  // mueve/gira; el mixer anima los huesos dentro).
  const group = new THREE.Group();
  group.add(root);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  root.position.x -= (box.min.x + box.max.x) / 2;
  root.position.z -= (box.min.z + box.max.z) / 2;
  root.position.y -= box.min.y;
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
  let current = null, currentName = '';
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
