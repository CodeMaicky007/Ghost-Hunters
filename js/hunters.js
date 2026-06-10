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
    this._bubble = null;       // sprite de texto efímero
    this._bubbleT = 0;         // tiempo restante de la burbuja
    this._lookBack = 0;        // temporizador de "mirar atrás"
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
    // El modelo Quaternius mira a +Z por defecto: atan2(dx,dz) sin offset.
    const target = Math.atan2(dx, dz);
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

  // Muestra una burbuja de texto sobre la cabeza durante `dur` s.
  showBark(text, dur = 2.2) {
    if (this._bubble) { this.root.remove(this._bubble); this._bubble.material.map.dispose?.(); }
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff'; g.font = '22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(1.4, 0.35, 1); spr.position.set(0, 2.1, 0); spr.renderOrder = 1000;
    this.root.add(spr); this._bubble = spr; this._bubbleT = dur;
  }

  // Lenguaje corporal: oscilación breve de yaw como "mirar atrás".
  glanceBack(dur = 0.8) { this._lookBack = dur; }

  update(dt) {
    if (this._bubbleT > 0) { this._bubbleT -= dt; if (this._bubbleT <= 0 && this._bubble) { this.root.remove(this._bubble); this._bubble = null; } }
    if (this._lookBack > 0) { this._lookBack -= dt; this.root.rotation.y = this._yaw + Math.sin(this._lookBack * 12) * 0.5; }
    this.mixer.update(dt);
  }
  dispose(scene) { scene.remove(this.root); }
}
