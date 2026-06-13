// ============================================================
//  Detalle industrial procedural (R8): convierte los Backrooms
//  vacíos en un espacio "de mantenimiento abandonado" sin tocar
//  el GLB del entorno ni la colisión. Todo se MONTA sobre muros
//  y techo (geometría ya no transitable) o es escombro bajo que
//  se pisa: cero impacto en el pathing de IA/jugador.
//
//  Materiales PBR de verdad (metalness/roughness + mapas canvas
//  de óxido/suciedad), pocos draw calls (InstancedMesh por tipo).
//  Acentos emissive deliberadamente BAJOS — coherente con el
//  re-tune de confort visual de R8 ([[r7-presentation-architecture]]).
// ============================================================
import * as THREE from 'three';

// ---- RNG determinista (mismo dressing en cada carga del mismo mapa) ----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------
//  Texturas procedurales (canvas). Color en sRGB; rugosidad en
//  espacio lineal (sin conversión). Pequeñas (128²) y cacheadas.
// ------------------------------------------------------------
function noise(ctx, w, h, n, alpha, rng) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rng() * 60);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rng() * w, rng() * h, 1, 1);
  }
}
function srgb(t) { t.colorSpace = THREE.SRGBColorSpace; return t; }
function lin(t) { t.colorSpace = THREE.NoColorSpace; return t; }

// Metal sucio con óxido en regueros verticales y arañazos.
function rustyMetalTex(rng) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5d6168'; g.fillRect(0, 0, 128, 128);
  // manchas oscuras de mugre
  for (let i = 0; i < 22; i++) {
    g.fillStyle = `rgba(30,28,24,${0.06 + rng() * 0.12})`;
    const r = 8 + rng() * 26;
    g.beginPath(); g.arc(rng() * 128, rng() * 128, r, 0, 7); g.fill();
  }
  // regueros de óxido (gradiente naranja que escurre)
  for (let i = 0; i < 14; i++) {
    const x = rng() * 128, top = rng() * 60, len = 30 + rng() * 60;
    const grad = g.createLinearGradient(x, top, x, top + len);
    grad.addColorStop(0, `rgba(120,66,32,${0.25 + rng() * 0.3})`);
    grad.addColorStop(1, 'rgba(90,48,22,0)');
    g.strokeStyle = grad; g.lineWidth = 1 + rng() * 3;
    g.beginPath(); g.moveTo(x, top); g.lineTo(x + (rng() - 0.5) * 6, top + len); g.stroke();
  }
  // arañazos claros
  for (let i = 0; i < 10; i++) {
    g.strokeStyle = `rgba(160,164,170,${0.1 + rng() * 0.15})`; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(rng() * 128, rng() * 128);
    g.lineTo(rng() * 128, rng() * 128); g.stroke();
  }
  noise(g, 128, 128, 1400, 0.25, rng);
  return srgb(new THREE.CanvasTexture(c));
}

// Acero galvanizado pintado (ductos/cajas): paneles con costuras y óxido en cantos.
function paintedMetalTex(rng, base = '#7e828a') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  // costuras de panel
  g.strokeStyle = 'rgba(20,20,22,0.4)'; g.lineWidth = 2;
  for (let x = 32; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let x = 33; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  // óxido en esquinas
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(110,60,28,${0.12 + rng() * 0.18})`;
    const cx = rng() < 0.5 ? 0 : 128, cy = rng() < 0.5 ? 0 : 128;
    g.beginPath(); g.arc(cx, cy, 18 + rng() * 22, 0, 7); g.fill();
  }
  noise(g, 128, 128, 900, 0.2, rng);
  return srgb(new THREE.CanvasTexture(c));
}

// Mapa de rugosidad: ruido suave (zonas oxidadas/sucias = más rugosas).
function roughTex(rng, baseGray = 150) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${baseGray},${baseGray},${baseGray})`; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) {
    const v = baseGray + Math.floor((rng() - 0.5) * 90);
    g.fillStyle = `rgba(${v},${v},${v},0.4)`;
    g.beginPath(); g.arc(rng() * 128, rng() * 128, 6 + rng() * 20, 0, 7); g.fill();
  }
  return lin(new THREE.CanvasTexture(c));
}

// Señalética: cartel pintado; devuelve {tex, emissive} (emissive solo en salidas).
function signTex(kind, rng) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 80;
  const g = c.getContext('2d');
  let emissive = false;
  if (kind === 'exit') {
    g.fillStyle = '#0a3d1f'; g.fillRect(0, 0, 128, 80);
    g.fillStyle = '#1f8f4a'; g.fillRect(4, 4, 120, 72);
    g.fillStyle = '#e8fff0'; g.font = 'bold 26px sans-serif'; g.textBaseline = 'middle';
    g.fillText('SALIDA', 14, 30);
    // flecha
    g.fillRect(20, 52, 50, 8); g.beginPath(); g.moveTo(70, 44); g.lineTo(92, 56); g.lineTo(70, 68); g.fill();
    emissive = true;
  } else if (kind === 'danger') {
    g.fillStyle = '#d6b81e'; g.fillRect(0, 0, 128, 80);
    g.fillStyle = '#101010';
    for (let x = -80; x < 128; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 16 + 80, 80); g.lineTo(x + 80, 80); g.fill(); }
    g.fillStyle = '#d6b81e'; g.fillRect(10, 20, 108, 40);
    g.fillStyle = '#101010'; g.font = 'bold 22px sans-serif'; g.textBaseline = 'middle';
    g.fillText('PELIGRO', 18, 42);
  } else { // 'volt'
    g.fillStyle = '#c9c4ad'; g.fillRect(0, 0, 128, 80);
    g.fillStyle = '#d6b81e'; g.beginPath(); g.moveTo(64, 10); g.lineTo(104, 70); g.lineTo(24, 70); g.fill();
    g.strokeStyle = '#101010'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#101010'; g.beginPath();
    g.moveTo(60, 26); g.lineTo(52, 46); g.lineTo(62, 46); g.lineTo(54, 62);
    g.lineTo(74, 40); g.lineTo(64, 40); g.lineTo(72, 26); g.fill();
  }
  // desgaste
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(20,18,12,${rng() * 0.18})`; g.fillRect(rng() * 128, rng() * 80, 1 + rng() * 3, 1 + rng() * 3); }
  return { tex: srgb(new THREE.CanvasTexture(c)), emissive };
}

// ------------------------------------------------------------
//  Recolecta puntos de montaje en muros: celda abierta + dirección
//  (dx,dz) hacia un muro vecino. nx/nz = posición de mundo del eje
//  del muro; yaw mira hacia el espacio abierto.
// ------------------------------------------------------------
function wallMounts(map, cols, rows, cell, reachList, rng) {
  const isWall = (x, z) => x < 0 || z < 0 || x >= cols || z >= rows || map[z][x] === 1;
  const out = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [x, z] of reachList) {
    for (const [dx, dz] of dirs) {
      if (!isWall(x + dx, z + dz)) continue;
      out.push({
        x, z, dx, dz,
        wx: (x + dx * 0.5) * cell, wz: (z + dz * 0.5) * cell, // cara del muro
        yawFace: Math.atan2(-dx, -dz),                         // mira al hueco
        yawAlong: Math.atan2(dz, -dx),                         // a lo largo del muro
      });
    }
  }
  // baraja determinista
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// Coloca instancias a partir de una lista de "poses" (objeto dummy reusado).
function instanceFrom(scene, geo, mat, poses) {
  if (!poses.length) return null;
  const inst = new THREE.InstancedMesh(geo, mat, poses.length);
  const d = new THREE.Object3D();
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i];
    d.position.set(p.x, p.y, p.z);
    d.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
    d.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
    d.updateMatrix(); inst.setMatrixAt(i, d.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = false; inst.receiveShadow = false;
  scene.add(inst);
  return inst;
}

// ============================================================
//  dressProps: punto de entrada. Llamar tras hornear el grid.
// ============================================================
export function dressProps(scene, { map, cols, rows, cell, reachList, ceilY, seed = 1337 }) {
  if (!reachList || !reachList.length) return { update() {} };
  const rng = mulberry32(seed);
  const mounts = wallMounts(map, cols, rows, cell, reachList, rng);
  if (!mounts.length) return { update() {} };

  // Escala de densidad: proporcional al tamaño jugable, con tope (evita saturar).
  const N = mounts.length;
  const cap = (frac, max) => Math.min(max, Math.floor(N * frac));
  let mi = 0;
  const take = (n) => mounts.slice(mi, mi += n);

  // ---- Materiales PBR compartidos ----
  const metalMap = rustyMetalTex(rng), metalRough = roughTex(rng, 140);
  const pipeMat = new THREE.MeshStandardMaterial({ map: metalMap, roughnessMap: metalRough, metalness: 0.45, roughness: 0.7, color: 0x9aa0a8 });
  const ductMap = paintedMetalTex(rng, '#80848c');
  const ductMat = new THREE.MeshStandardMaterial({ map: ductMap, roughnessMap: roughTex(rng, 160), metalness: 0.35, roughness: 0.75, color: 0xaab0b8 });
  const boxMat = new THREE.MeshStandardMaterial({ map: paintedMetalTex(rng, '#4a4d52'), metalness: 0.4, roughness: 0.6, color: 0x9aa0a8 });
  const cardboardMat = new THREE.MeshStandardMaterial({ color: 0x6e5230, roughness: 0.95, metalness: 0.0 });
  const barrelMat = new THREE.MeshStandardMaterial({ map: rustyMetalTex(rng), metalness: 0.5, roughness: 0.65, color: 0x3f6b4a });
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xc4541c, roughness: 0.7, metalness: 0.0 });

  // ---- Tuberías horizontales (2 alturas) a lo largo de muros ----
  const pipeGeo = new THREE.CylinderGeometry(0.05, 0.05, cell * 1.08, 9);
  pipeGeo.rotateZ(Math.PI / 2);                 // eje a lo largo de X local
  const pipePoses = [];
  for (const m of take(cap(0.16, 1500))) {
    const h = rng() < 0.5 ? 0.32 + rng() * 0.1 : 1.7 + rng() * 0.25;
    const off = 0.07;
    pipePoses.push({ x: m.wx - m.dx * off, y: h, z: m.wz - m.dz * off, ry: m.yawAlong, sy: 0.8 + rng() * 0.6, sz: 0.8 + rng() * 0.6 });
  }
  instanceFrom(scene, pipeGeo, pipeMat, pipePoses);

  // ---- Conducto eléctrico vertical + caja de registro con LED tenue ----
  const conduitGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 7);
  const boxGeo = new THREE.BoxGeometry(0.22, 0.3, 0.12);
  const ledGeo = new THREE.SphereGeometry(0.018, 6, 5);
  const conduitPoses = [], boxPoses = [], ledPoses = [];
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x123018, emissive: 0x33ff66, emissiveIntensity: 0.5 });
  for (const m of take(cap(0.08, 720))) {
    const off = 0.06;
    conduitPoses.push({ x: m.wx - m.dx * off, y: 0.9, z: m.wz - m.dz * off, sy: 0.7 + rng() * 0.5 });
    boxPoses.push({ x: m.wx - m.dx * (off + 0.05), y: 1.25, z: m.wz - m.dz * (off + 0.05), ry: m.yawFace });
    if (rng() < 0.5) ledPoses.push({ x: m.wx - m.dx * (off + 0.12), y: 1.3, z: m.wz - m.dz * (off + 0.12) });
  }
  instanceFrom(scene, conduitGeo, pipeMat, conduitPoses);
  instanceFrom(scene, boxGeo, boxMat, boxPoses);
  instanceFrom(scene, ledGeo, ledMat, ledPoses);

  // ---- Rejillas de ventilación en muro ----
  const ventGeo = new THREE.PlaneGeometry(0.5, 0.34);
  const ventTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 44; const g = c.getContext('2d');
    g.fillStyle = '#7a7e84'; g.fillRect(0, 0, 64, 44);
    g.fillStyle = '#2a2c2e'; for (let y = 6; y < 40; y += 6) g.fillRect(4, y, 56, 3);
    g.strokeStyle = '#3a3d40'; g.lineWidth = 3; g.strokeRect(2, 2, 60, 40);
    return srgb(new THREE.CanvasTexture(c));
  })();
  const ventMat = new THREE.MeshStandardMaterial({ map: ventTex, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide });
  const ventPoses = [];
  for (const m of take(cap(0.035, 320))) {
    ventPoses.push({ x: m.wx - m.dx * 0.04, y: 1.9 + rng() * 0.4, z: m.wz - m.dz * 0.04, ry: m.yawFace });
  }
  instanceFrom(scene, ventGeo, ventMat, ventPoses);

  // ---- Señalética (pocas, individuales: texturas distintas + emissive en salidas) ----
  const signGeo = new THREE.PlaneGeometry(0.46, 0.29);
  const signKinds = ['exit', 'exit', 'danger', 'volt', 'danger'];
  for (const m of take(Math.min(90, Math.floor(N * 0.012)))) {
    const kind = signKinds[Math.floor(rng() * signKinds.length)];
    const { tex, emissive } = signTex(kind, rng);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
    if (emissive) { mat.emissive = new THREE.Color(0x1f8f4a); mat.emissiveMap = tex; mat.emissiveIntensity = 0.28; }
    const s = new THREE.Mesh(signGeo, mat);
    s.position.set(m.wx - m.dx * 0.04, 1.85 + rng() * 0.3, m.wz - m.dz * 0.04);
    s.rotation.y = m.yawFace;
    scene.add(s);
  }

  // ---- Ductos HVAC en el techo, a lo largo de corredores ----
  const isWall = (x, z) => x < 0 || z < 0 || x >= cols || z >= rows || map[z][x] === 1;
  const ductGeo = new THREE.BoxGeometry(cell * 1.02, 0.34, 0.42);
  const ductPoses = [];
  let ductBudget = cap(0.05, 450);
  for (const [x, z] of reachList) {
    if (ductBudget <= 0) break;
    if (rng() > 0.16) continue;
    const horiz = !isWall(x - 1, z) && !isWall(x + 1, z);
    const vert = !isWall(x, z - 1) && !isWall(x, z + 1);
    if (!horiz && !vert) continue;
    ductPoses.push({ x: x * cell, y: ceilY - 0.26, z: z * cell, ry: horiz ? 0 : Math.PI / 2 });
    ductBudget--;
  }
  instanceFrom(scene, ductGeo, ductMat, ductPoses);

  // ---- Mobiliario/escombro deteriorado pegado a muros (no estorba el paso) ----
  const crateGeo = new THREE.BoxGeometry(0.5, 0.46, 0.5);
  const barrelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.82, 12);
  const cratePoses = [], barrelPoses = [];
  for (const m of take(cap(0.05, 460))) {
    const into = 0.28;                       // empujado contra el muro
    const px = m.wx - m.dx * into + (rng() - 0.5) * 0.2;
    const pz = m.wz - m.dz * into + (rng() - 0.5) * 0.2;
    if (rng() < 0.6) {
      const stack = rng() < 0.3;
      cratePoses.push({ x: px, y: 0.23, z: pz, ry: rng() * Math.PI, sy: 0.8 + rng() * 0.5 });
      if (stack) cratePoses.push({ x: px + 0.1, y: 0.66, z: pz, ry: rng() * Math.PI, sx: 0.8, sy: 0.7, sz: 0.8 });
    } else {
      barrelPoses.push({ x: px, y: 0.41, z: pz, rz: rng() < 0.25 ? Math.PI / 2 : 0, ry: rng() * Math.PI });
    }
  }
  instanceFrom(scene, crateGeo, cardboardMat, cratePoses);
  instanceFrom(scene, barrelGeo, barrelMat, barrelPoses);

  // ---- Conos de seguridad y escombro bajo, repartido (se pisa por encima) ----
  const coneGeo = new THREE.ConeGeometry(0.16, 0.4, 10);
  const debrisGeo = new THREE.BoxGeometry(0.3, 0.04, 0.22);
  const conePoses = [], debrisPoses = [];
  const coneN = cap(0.02, 150), debrisN = cap(0.06, 520);
  for (let i = 0; i < coneN; i++) {
    const [x, z] = reachList[Math.floor(rng() * reachList.length)];
    conePoses.push({ x: x * cell + (rng() - 0.5) * cell * 0.5, y: 0.2, z: z * cell + (rng() - 0.5) * cell * 0.5 });
  }
  for (let i = 0; i < debrisN; i++) {
    const [x, z] = reachList[Math.floor(rng() * reachList.length)];
    debrisPoses.push({ x: x * cell + (rng() - 0.5) * cell * 0.7, y: 0.022, z: z * cell + (rng() - 0.5) * cell * 0.7, ry: rng() * Math.PI, sx: 0.6 + rng() * 1.1, sz: 0.6 + rng() * 1.1 });
  }
  instanceFrom(scene, coneGeo, coneMat, conePoses);
  instanceFrom(scene, debrisGeo, new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: 1.0 }), debrisPoses);

  // ---- Cables colgantes (catenarias) entre puntos altos de muro ----
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9, metalness: 0.1 });
  const cableN = Math.min(90, Math.floor(N * 0.012));
  const along = new THREE.Vector3();
  for (const m of take(cableN)) {
    const span = 0.9 + rng() * 1.0, droop = 0.18 + rng() * 0.35;
    const ax = m.wx - m.dx * 0.05, az = m.wz - m.dz * 0.05;
    along.set(Math.cos(m.yawAlong), 0, Math.sin(m.yawAlong)); // tangente del muro
    const a = new THREE.Vector3(ax, 1.95, az);
    const b = a.clone().addScaledVector(along, span);
    const mid = a.clone().lerp(b, 0.5); mid.y -= droop;
    const curve = new THREE.CatmullRomCurve3([a, mid, b]);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.012, 5, false), cableMat));
  }

  const counts = {
    mounts: N, pipes: pipePoses.length, conduit: conduitPoses.length, vents: ventPoses.length,
    ducts: ductPoses.length, crates: cratePoses.length, barrels: barrelPoses.length,
    cones: conePoses.length, debris: debrisPoses.length, cables: cableN,
  };
  if (typeof location !== 'undefined' && location.hash.includes('dbg')) window.__propsDbg = counts;
  return { update() {}, counts };
}
