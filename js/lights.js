// ============================================================
//  Iluminación diegética (R7):
//  - Paneles fluorescentes de techo (InstancedMesh + instanceColor,
//    flicker por panel) + pocas PointLights reales repartidas.
//  - Linternas de los cazadores: cono volumétrico barato por bot
//    + pool de SpotLights reales asignadas a los más cercanos.
//  En cacería TODO muere (con estertores) — "las luces mueren".
// ============================================================
import * as THREE from 'three';
import { pickPanelCells, spreadPicks, fluorFlicker } from './logic.js';

const PANEL_STEP = 6;       // celdas entre paneles
const NUM_LIGHTS = 6;       // PointLights reales (presupuesto de luces dinámicas)
const FAULTY_RATE = 0.12;   // fracción de paneles "estropeados" que parpadean siempre
const POINT_BASE = 11;      // intensidad base de cada PointLight (antes 22: quemaba)

// Confort visual: el panel es un tubo fluorescente, no un foco de soldadura. Un
// crema cálido por debajo del blanco puro evita el "quemado" y el bloom-bomba que
// fatigaban la vista en sesiones largas (el bloom solo lo coronan los píxeles más
// vivos, ya no toda la tira). DEAD = casi negro en cacería.
const WARM = new THREE.Color(0xc7b079);
const DEAD = new THREE.Color(0x050607);
const tmpC = new THREE.Color();

export function buildCeilingLights(scene, { map, cols, rows, cell, ceilY }) {
  const cells = pickPanelCells(map, cols, rows, PANEL_STEP);
  if (!cells.length) return { update() {} };

  // Panel = caja fina emisiva (material básico: ES la fuente de luz visible).
  const geo = new THREE.BoxGeometry(cell * 1.5, 0.06, cell * 0.85);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(geo, mat, cells.length);
  const m4 = new THREE.Matrix4();
  const faulty = [];   // [{i, seed}] — los que parpadean siempre
  for (let i = 0; i < cells.length; i++) {
    const [gx, gz] = cells[i];
    m4.makeTranslation(gx * cell, ceilY - 0.04, gz * cell);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, WARM);
    if (Math.random() < FAULTY_RATE) faulty.push({ i, seed: Math.random() * 100 });
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);

  // Pocas luces reales, lo más repartidas posible entre los paneles.
  const lightCells = spreadPicks(cells, NUM_LIGHTS);
  const lights = lightCells.map(([gx, gz], k) => {
    const l = new THREE.PointLight(0xffe9b8, POINT_BASE, 18, 2.0);
    l.position.set(gx * cell, ceilY - 0.35, gz * cell);
    l.userData.seed = k * 17.3 + 3.1;
    scene.add(l);
    return l;
  });

  let wasHunting = false;
  return {
    update(dt, nowSec, hunting) {
      if (hunting !== wasHunting) {
        // Transición global una sola vez: encendido <-> apagón.
        for (let i = 0; i < cells.length; i++) inst.setColorAt(i, hunting ? DEAD : WARM);
        inst.instanceColor.needsUpdate = true;
        wasHunting = hunting;
      }
      if (!hunting) {
        // Solo los estropeados se animan cada frame (barato).
        for (const f of faulty) {
          const b = fluorFlicker(nowSec, f.seed);
          inst.setColorAt(f.i, tmpC.copy(WARM).multiplyScalar(b));
        }
        if (faulty.length) inst.instanceColor.needsUpdate = true;
        for (const l of lights) l.intensity = POINT_BASE * (0.92 + 0.08 * fluorFlicker(nowSec, l.userData.seed));
      } else {
        // Estertores: algún panel da chispazos moribundos muy de vez en cuando.
        for (const f of faulty) {
          const n = fluorFlicker(nowSec * 1.7, f.seed);
          inst.setColorAt(f.i, tmpC.copy(WARM).multiplyScalar(n > 0.985 ? 0.5 : 0.015));
        }
        if (faulty.length) inst.instanceColor.needsUpdate = true;
        for (const l of lights) l.intensity = 0;
      }
    },
  };
}

// ------------------------------------------------------------
//  Linternas: cono aditivo + "lente" brillante por cazador, y un
//  pool de K SpotLights reales que siempre sirven a los K bots
//  más cercanos al fantasma. En cacería estroboscopia moribunda.
// ------------------------------------------------------------
function lensTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.3, 'rgba(255,240,190,0.7)');
  grad.addColorStop(1, 'rgba(255,240,190,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

const CONE_LEN = 5.5, CONE_R = 0.95, SPOT_BASE = 16, CONE_OPACITY = 0.05;
const strobe = (t, seed) => {
  const h = Math.sin(Math.floor(t * 12) * 12.9898 + seed * 78.233) * 43758.5453;
  return (h - Math.floor(h)) > 0.72 ? 1 : 0;   // mayormente apagada, chispazos
};

export function createFlashlights(scene, k = 4) {
  const coneGeo = new THREE.ConeGeometry(CONE_R, CONE_LEN, 18, 1, true);
  coneGeo.translate(0, -CONE_LEN / 2, 0);   // ápice en el origen…
  coneGeo.rotateX(-Math.PI / 2);            // …abriéndose hacia +Z (frente del modelo)
  const lensTex = lensTexture();

  const spots = [];
  for (let i = 0; i < k; i++) {
    const s = new THREE.SpotLight(0xffe9b8, 0, 14, 0.46, 0.5, 1.7);
    scene.add(s); scene.add(s.target);
    spots.push(s);
  }

  const rigs = new Map();   // model -> { group, coneMat }
  const tmpPos = new THREE.Vector3(), tmpDir = new THREE.Vector3();
  let flashTpl = null, flashScale = 1;   // modelo GLB de linterna (opcional)

  return {
    // Cuelga un modelo real de linterna del rig (si no se llama, solo cono+lente).
    setModel(gltf) {
      if (!gltf || !gltf.scene) return;
      const tpl = gltf.scene.clone(true);
      tpl.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(tpl);
      flashScale = 0.24 / Math.max(1e-3, box.max.y - box.min.y);   // ~24 cm de largo
      flashTpl = tpl;
    },
    attach(model) {
      const group = new THREE.Group();
      group.position.set(0.12, 1.32, 0.22);   // mano/altura del pecho, frente +Z
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xffeec2, transparent: true, opacity: CONE_OPACITY,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      group.add(new THREE.Mesh(coneGeo, coneMat));
      const lens = new THREE.Sprite(new THREE.SpriteMaterial({
        map: lensTex, transparent: true, depthTest: true, blending: THREE.AdditiveBlending,
      }));
      lens.scale.set(0.16, 0.16, 1);
      group.add(lens);
      if (flashTpl) {
        const fl = flashTpl.clone(true);
        fl.scale.setScalar(flashScale);
        fl.rotation.x = Math.PI / 2;     // eje +Y del modelo -> frente +Z
        fl.position.set(0, -0.04, 0.02); // asentada en la mano, lente hacia delante
        group.add(fl);
      }
      model.root.add(group);
      rigs.set(model, { group, coneMat });
    },
    update(hunters, ghostPos, hunting, nowSec) {
      // K más cercanos al fantasma reciben SpotLight real.
      const active = hunters.filter((h) => h.alive && !h.ko && rigs.has(h.model));
      active.sort((a, b) =>
        ((a.pos.x - ghostPos.x) ** 2 + (a.pos.z - ghostPos.z) ** 2) -
        ((b.pos.x - ghostPos.x) ** 2 + (b.pos.z - ghostPos.z) ** 2));
      let si = 0;
      for (const h of hunters) {
        const rig = rigs.get(h.model); if (!rig) continue;
        const usable = h.alive && !h.ko;
        rig.group.visible = usable;
        if (!usable) continue;
        const on = hunting ? strobe(nowSec, h.id) : 1;   // en cacería: estroboscopia moribunda
        rig.coneMat.opacity = CONE_OPACITY * on;
        if (si < spots.length && active.indexOf(h) > -1 && active.indexOf(h) < spots.length) {
          const s = spots[si++];
          rig.group.getWorldPosition(tmpPos);
          rig.group.getWorldDirection(tmpDir);
          s.position.copy(tmpPos);
          s.target.position.copy(tmpPos).addScaledVector(tmpDir, 6);
          s.intensity = SPOT_BASE * on;
        }
      }
      for (; si < spots.length; si++) spots[si].intensity = 0;
    },
  };
}
