// ============================================================
//  Modelos procedurales de props del ritual (R8): sustituyen a los
//  GLB con pinta de prototipo (mesa/TV/cruz) por geometría propia
//  con materiales PBR y desgaste. Se construyen a tamaño final, con
//  la BASE en y=0, centrados en XZ y el FRENTE hacia +Z (para que la
//  rotación "mira al centro del nivel" los oriente de cara al jugador).
//  Cada builder expone el material emissive que la lógica del ritual
//  anima cada frame (pantalla del monitor / sigilo del altar).
// ============================================================
import * as THREE from 'three';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const srgb = (t) => { t.colorSpace = THREE.SRGBColorSpace; return t; };
const lin = (t) => { t.colorSpace = THREE.NoColorSpace; return t; };
function speckle(g, w, h, n, rng, max = 60, a = 0.25) {
  for (let i = 0; i < n; i++) { const v = Math.floor(rng() * max); g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(rng() * w, rng() * h, 1, 1); }
}

// Hormigón/piedra: gris con vetas, manchas y alguna grieta.
function concreteTex(rng) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#5a574f'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${30 + rng() * 40 | 0},${28 + rng() * 38 | 0},${24 + rng() * 34 | 0},${0.1 + rng() * 0.25})`; g.beginPath(); g.arc(rng() * 128, rng() * 128, 6 + rng() * 24, 0, 7); g.fill(); }
  // grietas
  g.strokeStyle = 'rgba(18,16,12,0.5)'; g.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) { g.beginPath(); let x = rng() * 128, y = rng() * 128; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 30; y += (rng() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
  speckle(g, 128, 128, 1600, rng, 70, 0.22);
  return srgb(new THREE.CanvasTexture(c));
}

// Madera: vetas marrones longitudinales, nudos y desgaste.
function woodTex(rng) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#6b4a28'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) { const sh = 20 + rng() * 30; g.strokeStyle = `rgba(${40 + sh | 0},${26 + sh * 0.6 | 0},${12 + sh * 0.3 | 0},0.5)`; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y + Math.sin(y * 0.3) * 2); g.lineTo(128, y + Math.sin(y * 0.3 + 1) * 2); g.stroke(); }
  for (let i = 0; i < 3; i++) { g.strokeStyle = 'rgba(30,18,8,0.6)'; g.lineWidth = 2; g.beginPath(); g.ellipse(rng() * 128, rng() * 128, 4 + rng() * 4, 7 + rng() * 6, 0, 0, 7); g.stroke(); }
  speckle(g, 128, 128, 700, rng, 50, 0.2);
  return srgb(new THREE.CanvasTexture(c));
}

// Plástico de carcasa (TV vintage): base clara amarilleada, arañazos y mugre.
function plasticTex(rng, base = '#b9b29a') {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 10; i++) { g.fillStyle = `rgba(60,52,34,${0.05 + rng() * 0.1})`; g.beginPath(); g.arc(rng() * 128, rng() * 128, 10 + rng() * 26, 0, 7); g.fill(); }
  for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(255,255,255,${0.04 + rng() * 0.08})`; g.lineWidth = 0.7; g.beginPath(); g.moveTo(rng() * 128, rng() * 128); g.lineTo(rng() * 128, rng() * 128); g.stroke(); }
  speckle(g, 128, 128, 600, rng, 40, 0.18);
  return srgb(new THREE.CanvasTexture(c));
}

// Rugosidad genérica: ruido suave alrededor de un gris base.
function roughTex(rng, baseGray = 150) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = `rgb(${baseGray},${baseGray},${baseGray})`; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 40; i++) { const v = baseGray + ((rng() - 0.5) * 90 | 0); g.fillStyle = `rgba(${v},${v},${v},0.4)`; g.beginPath(); g.arc(rng() * 64, rng() * 64, 3 + rng() * 12, 0, 7); g.fill(); }
  return lin(new THREE.CanvasTexture(c));
}

// Líneas de escaneo CRT (mapa emissive de la pantalla): el tinte rojo->verde
// del progreso lo pone la lógica del ritual sobre material.emissive.
function scanlineTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.55)'; for (let y = 0; y < 64; y += 3) g.fillRect(0, y, 64, 1.4);
  // brillo de tubo (más vivo al centro)
  const grad = g.createRadialGradient(32, 30, 4, 32, 32, 40);
  grad.addColorStop(0, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(120,120,120,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return lin(new THREE.CanvasTexture(c));
}

// ------------------------------------------------------------
//  Monitor CRT (estación de misión que los supervivientes apagan).
//  Devuelve { root, screenMat }. screenMat.emissive lo tiñe la lógica
//  (rojo averiado -> verde reparado) vía emissiveIntensity.
// ------------------------------------------------------------
export function buildMonitor(seed = 7) {
  const rng = mulberry32(seed);
  const root = new THREE.Group();
  const cabMat = new THREE.MeshStandardMaterial({ map: plasticTex(rng, '#3c3d42'), roughnessMap: roughTex(rng, 150), metalness: 0.25, roughness: 0.7 });
  const bodyMat = new THREE.MeshStandardMaterial({ map: plasticTex(rng, '#b3ac92'), roughnessMap: roughTex(rng, 140), metalness: 0.05, roughness: 0.75 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x141417, roughness: 0.6, metalness: 0.1 });
  const knobMat = new THREE.MeshStandardMaterial({ color: 0x202024, roughness: 0.5, metalness: 0.3 });
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x05070b, emissive: 0x30ff66, emissiveMap: scanlineTex(), emissiveIntensity: 0.4,
    roughness: 0.25, metalness: 0.0,
  });

  // Mueble/carro inferior
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.44, 0.4), cabMat); cab.position.y = 0.22; root.add(cab);
  // Cuerpo del CRT
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.42), bodyMat); body.position.set(0, 0.66, 0); root.add(body);
  // Bisel oscuro empotrado en el frente (+Z) y pantalla emissive encima
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.03), bezelMat); bezel.position.set(0, 0.67, 0.215); root.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.25), screenMat); screen.position.set(0, 0.67, 0.232); root.add(screen);
  // Mandos en el frente bajo del cuerpo
  for (let i = 0; i < 2; i++) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), knobMat); k.rotation.x = Math.PI / 2; k.position.set(0.13 + i * 0.06, 0.5, 0.215); root.add(k); }
  return { root, screenMat };
}

// ------------------------------------------------------------
//  Altar de ritual (piedra desgastada con sigilo emissive).
//  Devuelve { root, glowMat }. glowMat.emissiveIntensity sube con la
//  canalización (lo anima la lógica del ritual).
// ------------------------------------------------------------
export function buildAltar(seed = 11) {
  const rng = mulberry32(seed);
  const root = new THREE.Group();
  const stoneMap = concreteTex(rng);
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneMap, roughnessMap: roughTex(rng, 175), metalness: 0.0, roughness: 0.92, color: 0x8a8780 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x160b22, emissive: 0x9d4edd, emissiveIntensity: 0.1, roughness: 0.5, metalness: 0.0 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.2, 0.84), stoneMat); base.position.y = 0.1; root.add(base);
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.46, 0.56), stoneMat); column.position.y = 0.43; root.add(column);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.16, 0.72), stoneMat); slab.position.y = 0.74; root.add(slab);

  // Sigilo: anillo emissive plano sobre la losa + runas cortas.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.022, 8, 28), glowMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.825; root.add(ring);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.1), glowMat);
    rune.position.set(Math.cos(a) * 0.26, 0.823, Math.sin(a) * 0.26); rune.rotation.y = -a; root.add(rune);
  }
  return { root, glowMat };
}

// ------------------------------------------------------------
//  Cruz/reliquia de ritual (madera con herraje y núcleo tenue).
//  Devuelve un Group (no necesita material animado).
// ------------------------------------------------------------
export function buildCross(seed = 5) {
  const rng = mulberry32(seed);
  const root = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex(rng), roughnessMap: roughTex(rng, 190), metalness: 0.0, roughness: 0.9 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6, metalness: 0.55 });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x2a1c08, emissive: 0xffaa3c, emissiveIntensity: 0.35, roughness: 0.4 });

  const vert = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.07), woodMat); vert.position.y = 0.3; root.add(vert);
  const horiz = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.068), woodMat); horiz.position.y = 0.42; root.add(horiz);
  // herraje en el cruce
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.085), ironMat); band.position.y = 0.42; root.add(band);
  // núcleo emissive tenue (ayuda a localizar la reliquia al transportarla)
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), coreMat); core.position.set(0, 0.42, 0.05); root.add(core);
  return root;
}
