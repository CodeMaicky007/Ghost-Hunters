import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { hunterAnimState, pickAnim } from './logic.js';

export const CHAR_HEIGHT = 1.8; // altura objetivo del personaje en unidades de mundo

export class HunterModel {
  constructor(gltf) {
    this.root = cloneSkinned(gltf.scene);
    // Medir la altura con las matrices de mundo ya actualizadas: si no, la Box3
    // de un SkinnedMesh recién clonado sale corrupta y la escala explota.
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    const h = box.max.y - box.min.y;
    const scale = (h > 0.1 && h < 50) ? CHAR_HEIGHT / h : 1; // guarda contra medidas degeneradas
    this.root.scale.setScalar(scale);
    this.root.updateMatrixWorld(true);
    // mixer + clips indexados por sufijo
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const clip of gltf.animations) {
      const suffix = clip.name.split('|').pop();
      this.actions[suffix] = this.mixer.clipAction(clip);
    }
    this.current = null;
    this._yaw = 0;
    this._origMats = [];
    this.root.traverse((o) => { if (o.isMesh) this._origMats.push([o, o.material]); });
    this.play('Idle');
  }

  play(clipName, opts = {}) {
    if (this.current === clipName) return;
    const next = this.actions[clipName];
    if (!next) return;
    next.reset();
    if (clipName === 'Death') { next.setLoop(THREE.LoopOnce); next.clampWhenFinished = true; }
    else next.setLoop(THREE.LoopRepeat);
    if (this.actions[this.current]) this.actions[this.current].crossFadeTo(next, 0.2, false);
    next.play();
    this.current = clipName;
  }

  // estado del juego -> animación
  setState(stateFields) { this.play(pickAnim(hunterAnimState(stateFields))); }

  // orientar hacia (dx,dz) suavizado
  faceDir(dx, dz) {
    if (dx === 0 && dz === 0) return;
    // El modelo Quaternius mira a -Z por defecto; +PI para que mire su avance.
    const target = Math.atan2(dx, dz) + Math.PI;
    let d = target - this._yaw;
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    this._yaw += d * 0.25;
    this.root.rotation.y = this._yaw;
  }

  setPos(x, y, z) { this.root.position.set(x, y, z); }

  // visión espectral: glow + visible a través de muros
  setSpectral(on) {
    for (const [mesh, orig] of this._origMats) {
      if (on) {
        mesh.material = orig.clone();
        mesh.material.emissive = new THREE.Color(0x66ccff);
        mesh.material.emissiveIntensity = 1.2;
        mesh.material.depthTest = false;
        mesh.renderOrder = 999;
      } else {
        mesh.material = orig; mesh.renderOrder = 0;
      }
    }
  }

  update(dt) { this.mixer.update(dt); }
  dispose(scene) { scene.remove(this.root); }
}
