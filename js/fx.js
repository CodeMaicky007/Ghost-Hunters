// ============================================================
//  FX de presentación (R7): postprocesado cinematográfico,
//  sensación de cámara (shake/bob/FOV) y partículas (polvo/bursts).
//  La lógica testeable (trauma, flicker) vive en logic.js.
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { decayTrauma, shakeAmp } from './logic.js';

// ------------------------------------------------------------
//  Postprocesado: bloom + pase final propio (viñeta, grano,
//  aberración cromática, grading de cacería "el otro lado",
//  pulso rojo de stun/mori, flash). Transiciones suavizadas aquí.
// ------------------------------------------------------------
const GhostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.045 },
    uAberr: { value: 0.0016 },
    uHunt: { value: 0 },   // 0..1 — grading "el otro lado" (el fantasma ve en la oscuridad)
    uStun: { value: 0 },   // 0..1 — pulso rojo (parry / aturdido)
    uMori: { value: 0 },   // 0..1 — pulso oscuro de ejecución
    uFlash: { value: 0 },  // impulso blanco (teleport)
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberr, uHunt, uStun, uMori, uFlash;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453 + fract(uTime)); }

    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);

      // Aberración cromática radial (sube en cacería y aturdido).
      float ab = uAberr * (1.0 + uHunt * 2.2 + uStun * 3.0 + uMori * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + d * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - d * ab).b;

      // CACERÍA — "el otro lado": desatura, levanta sombras frías verdosas.
      // Es la visión espectral del fantasma: ve en lo que para otros es negro.
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 other = mix(vec3(lum), col, 0.3);
      other = other * 1.35 + vec3(0.022, 0.065, 0.052);
      col = mix(col, other, uHunt);

      // Pulso rojo de stun y latido oscuro del mori, en los bordes.
      float edge = smoothstep(0.12, 0.6, r2);
      float beat = 0.55 + 0.45 * sin(uTime * 9.0);
      col = mix(col, vec3(0.5, 0.03, 0.06), edge * clamp(uStun + uMori * 0.8, 0.0, 1.0) * beat);

      // Viñeta.
      col *= 1.0 - uVignette * smoothstep(0.1, 0.72, r2);

      // Grano de película (más denso en cacería).
      float g = hash(vUv * vec2(917.13, 533.7));
      col += (g - 0.5) * (uGrain + uHunt * 0.05 + uMori * 0.03);

      col += vec3(uFlash);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.38, 0.4, 0.85);
  composer.addPass(bloom);
  const ghost = new ShaderPass(GhostShader);
  composer.addPass(ghost);
  composer.addPass(new OutputPass());

  // Objetivos hacia los que se interpola cada frame (sin cortes bruscos).
  const target = { hunt: 0, stun: 0, mori: 0 };
  const u = ghost.uniforms;
  return {
    set(name, v) { target[name] = v; },
    flash(v = 0.3) { u.uFlash.value = Math.min(0.6, u.uFlash.value + v); },
    update(dt, nowSec) {
      u.uTime.value = nowSec;
      const k = 1 - Math.exp(-5 * dt);
      u.uHunt.value += (target.hunt - u.uHunt.value) * k;
      u.uStun.value += (target.stun - u.uStun.value) * k;
      u.uMori.value += (target.mori - u.uMori.value) * k;
      u.uFlash.value = Math.max(0, u.uFlash.value - 1.8 * dt);
    },
    render() { composer.render(); },
    setSize(w, h) { composer.setSize(w, h); bloom.setSize(w, h); },
  };
}

// ------------------------------------------------------------
//  Sensación de cámara: shake por trauma (rotacional), head-bob,
//  FOV dinámico con kick. Llamar a update() DESPUÉS de fijar la
//  posición/rotación base de la cámara en moveGhost().
// ------------------------------------------------------------
export function createCameraFeel(camera, baseFov = 80) {
  let trauma = 0, bobT = 0, fov = baseFov, fovKick = 0, stepFlag = false, lastStride = 0;
  return {
    addTrauma(a) { trauma = Math.min(1, trauma + a); },
    kick(deg) { fovKick = Math.min(12, fovKick + deg); },
    // true una vez por zancada (para sincronizar audio de movimiento)
    stepPulse() { const f = stepFlag; stepFlag = false; return f; },
    update(dt, nowSec, ctx = {}) {
      trauma = decayTrauma(trauma, dt);
      fovKick = Math.max(0, fovKick - 30 * dt);
      const amp = shakeAmp(trauma);
      camera.rotation.x += amp * 0.05 * Math.sin(nowSec * 41.7);
      camera.rotation.y += amp * 0.05 * Math.sin(nowSec * 37.3 + 2.1);
      camera.rotation.z += amp * 0.04 * Math.sin(nowSec * 43.9 + 4.2);
      if (ctx.moving) {
        bobT += dt * (ctx.hunting ? 10.5 : 8.2);
        const stride = Math.floor(bobT / Math.PI);
        if (stride !== lastStride) { lastStride = stride; stepFlag = true; }
      }
      camera.position.y += Math.sin(bobT * 2) * 0.02 * (ctx.moving ? 1 : 0);
      camera.rotation.z += Math.sin(bobT) * 0.0035 * (ctx.moving ? 1 : 0);
      const targetFov = baseFov + (ctx.hunting ? 6 : 0);
      fov += (targetFov - fov) * (1 - Math.exp(-5 * dt));
      const f = fov + fovKick;
      if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
    },
  };
}

// ------------------------------------------------------------
//  Polvo en suspensión: nube de puntos que envuelve a la cámara
//  (wrap toroidal) — da densidad al aire de los Backrooms.
// ------------------------------------------------------------
function softDotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function createDust(scene, count = 240, box = 16, height = 2.6) {
  const posArr = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    posArr[i * 3] = (Math.random() - 0.5) * box;
    posArr[i * 3 + 1] = Math.random() * height;
    posArr[i * 3 + 2] = (Math.random() - 0.5) * box;
    vel[i * 3] = (Math.random() - 0.5) * 0.06;
    vel[i * 3 + 1] = -0.02 - Math.random() * 0.04;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.06;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const mat = new THREE.PointsMaterial({
    map: softDotTexture(), size: 0.035, transparent: true, opacity: 0.5,
    color: 0xfff3cf, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const half = box / 2;
  return {
    update(dt, cam) {
      const p = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        p[i * 3] += vel[i * 3] * dt;
        p[i * 3 + 1] += vel[i * 3 + 1] * dt;
        p[i * 3 + 2] += vel[i * 3 + 2] * dt;
        // wrap alrededor de la cámara (la nube siempre te rodea)
        if (p[i * 3] < cam.x - half) p[i * 3] += box; else if (p[i * 3] > cam.x + half) p[i * 3] -= box;
        if (p[i * 3 + 2] < cam.z - half) p[i * 3 + 2] += box; else if (p[i * 3 + 2] > cam.z + half) p[i * 3 + 2] -= box;
        if (p[i * 3 + 1] < 0) p[i * 3 + 1] += height;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------
//  Bursts: explosiones breves de partículas (kill/KO/mori/teleport).
//  Cada burst es un Points propio con velocidad por partícula,
//  vida corta y fundido; se autodestruye al expirar.
// ------------------------------------------------------------
export function createBursts(scene) {
  const live = [];
  const tex = softDotTexture();
  function spawn(x, y, z, { color = 0xc77dff, count = 26, speed = 1.6, up = 1.4, life = 0.9, size = 0.09 } = {}) {
    const posArr = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      posArr[i * 3] = x; posArr[i * 3 + 1] = y; posArr[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, r = (0.3 + Math.random() * 0.7) * speed;
      vel[i * 3] = Math.cos(a) * r;
      vel[i * 3 + 1] = up * (0.4 + Math.random() * 0.9);
      vel[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const mat = new THREE.PointsMaterial({
      map: tex, size, color, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    live.push({ pts, geo, mat, vel, t: 0, life, count });
  }
  return {
    spawn,
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const b = live[i];
        b.t += dt;
        if (b.t >= b.life) {
          scene.remove(b.pts); b.geo.dispose(); b.mat.dispose();
          live.splice(i, 1); continue;
        }
        const p = b.geo.attributes.position.array;
        for (let j = 0; j < b.count; j++) {
          p[j * 3] += b.vel[j * 3] * dt;
          p[j * 3 + 1] += b.vel[j * 3 + 1] * dt;
          p[j * 3 + 2] += b.vel[j * 3 + 2] * dt;
          b.vel[j * 3 + 1] -= 1.6 * dt;   // gravedad suave: ceniza espectral
        }
        b.geo.attributes.position.needsUpdate = true;
        b.mat.opacity = 0.95 * (1 - b.t / b.life);
      }
    },
  };
}
