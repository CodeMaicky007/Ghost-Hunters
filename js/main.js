// ============================================================
//  GHOST HUNTERS: REVERSED — Backrooms (nivel GLB, 1 piso)
//  El nivel es un modelo GLB; el MAP de colisión/IA se HORNEA
//  desde su geometría (raycast por celda) y reutiliza la lógica
//  existente (BFS, estaciones, minimapa, cacería).
//  Cacería: las luces mueren y cazas en la oscuridad.
// ============================================================
import * as THREE from 'three';
import { loadAllAssets } from './assets.js';
import { placeEnv, TARGET_CEIL } from './env.js';
import { bakeGrid } from './grid.js';
import { collidesBoxGrid, parryChance, rollParry, PARRY_DEFAULTS, hitResult, canRevive, heartbeatInterval } from './logic.js';
import { HunterModel } from './hunters.js';
import { createPost, createCameraFeel, createDust, createBursts } from './fx.js';
import { buildCeilingLights, createFlashlights } from './lights.js';
import { dressFloor } from './setdress.js';
import { buildMonitor, buildAltar, buildCross } from './propmodels.js';
import { createGhostAvatar } from './ghostavatar.js';
import * as AIB from './ai.js';
import * as RIT from './ritual.js';
import * as ABL from './abilities.js';

// ---------- Config / balance ----------
// CELL=0.75: el horneado rasteriza la huella de los tabiques (finos, ~1u) al
// grid; con celdas pequeñas los muros quedan finos y alineados con lo que se ve,
// y la colisión coincide con los muros visibles.
const CELL = 0.75;
// Grid de COLISIÓN del jugador, mucho más fino que el de IA: a 0.25 los muros y
// pasillos del laberinto se representan ~3× más exactos, así el jugador choca
// contra la pared visible y no contra el "colchón" de medio-celda del grid grueso.
const CELL_COL = 0.25;
const EYE = 1.6;
const PLAYER_R = 0.3;   // ~media celda a CELL=0.75; mayor atascaría al jugador
const HUNTER_R = 0.25;
const SPEED = 4.2;
const SENS = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

const GRID = 26;
const MATCH_TIME = 180;
const NUM_HUNTERS = 8;
const NUM_RITUAL_OBJECTS = 4;
const RITUAL_SPREAD = 18;   // radio (celdas) de la región donde caen altar+objetos
const NUM_MISSIONS = 6;
const REPAIR_RATE = 0.12;   // progreso/seg de una misión (~8s con un bot)
const MISSION_HEIGHT = 0.95; // alto objetivo del monitor
const HUNTER_SPEED = 2.8;
const HUNTER_FLEE_SPEED = 3.6;

const KILL_RANGE = 1.8;

// Combate R6: vidas/derribo/mori + huida
const HIT_COOLDOWN = 1.5;   // s entre golpes al mismo bot (evita doble-hit instantáneo)
const LIVES_UNMARKED = 2;   // vidas por cacería de un bot SIN marcar
const REVIVE_TIME = 4;      // s de canal de reanimación de un KO
const REVIVE_BLOCK = 9;     // u: el fantasma a menos de esto bloquea la reanimación
const MORI_RANGE = 1.6;     // u: alcance del Memento Mori sobre un KO
const MORI_TIME = 2;        // s de la ejecución
const FLEE_RADIUS = 14;     // celdas: radio del anillo de candidatas de huida

const PARRY = PARRY_DEFAULTS;   // fuente única en logic.js (tuneable aquí si diverge)
const STUN_DUR = 3;      // s de aturdimiento del fantasma tras un parry
const STUN_SLOW = 0.4;   // multiplicador de velocidad mientras estás aturdido
const PARRY_FLEE = 3;    // s que huye el superviviente que paró

// ============================================================
//  Mapa de ocupación — fallback procedural; se sustituye por el
//  horneado del GLB en boot(). 0=suelo libre, 1=muro.
// ============================================================
function genBackrooms(n) {
  const g = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++)
    if (x === 0 || z === 0 || x === n - 1 || z === n - 1) g[z][x] = 1;
  for (let z = 2; z < n - 1; z += 4) for (let x = 2; x < n - 1; x += 4) {
    if (Math.random() < 0.7) {
      g[z][x] = 1;
      if (Math.random() < 0.45) g[z][x + 1] = 1;
      if (Math.random() < 0.45 && g[z + 1]) g[z + 1][x] = 1;
    }
  }
  const runs = Math.floor(n * 1.4);
  for (let r = 0; r < runs; r++) {
    const horiz = Math.random() < 0.5, len = 2 + Math.floor(Math.random() * 4);
    let x = 1 + Math.floor(Math.random() * (n - 2)), z = 1 + Math.floor(Math.random() * (n - 2));
    for (let k = 0; k < len; k++) { if (x > 0 && x < n - 1 && z > 0 && z < n - 1) g[z][x] = 1; if (horiz) x++; else z++; }
  }
  g[1][1] = g[1][2] = g[2][1] = 0;
  return g;
}
let MAP = genBackrooms(GRID);
let ROWS = MAP.length, COLS = MAP[0].length;
// Grid de colisión del jugador (fino). Por defecto = grid de IA; boot() lo
// sustituye por el horneado fino cuando el GLB carga.
let COL_MAP = MAP, COL_COLS = COLS, COL_ROWS = ROWS, COL_CELL = CELL;

// ============================================================
//  Helpers de grid (leen MAP/ROWS/COLS en tiempo de llamada)
// ============================================================
function isWall(gx, gz) {
  if (gz < 0 || gz >= ROWS || gx < 0 || gx >= COLS) return true;
  return MAP[gz][gx] === 1;
}
function collides(x, z, r = PLAYER_R) {
  const c = [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]];
  for (const [px, pz] of c) if (isWall(Math.round(px / CELL), Math.round(pz / CELL))) return true;
  return false;
}
const cellOf = (x, z) => [Math.round(x / CELL), Math.round(z / CELL)];
const worldOf = (gx, gz) => [gx * CELL, gz * CELL];
const key = (gx, gz) => gz * COLS + gx;

function floodReachable(sx, sz) {
  const seen = new Set([key(sx, sz)]); const list = [[sx, sz]]; const q = [[sx, sz]];
  const d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) { const [cx, cz] = q.shift();
    for (const [dx, dz] of d) { const nx = cx + dx, nz = cz + dz; if (isWall(nx, nz) || seen.has(key(nx, nz))) continue; seen.add(key(nx, nz)); list.push([nx, nz]); q.push([nx, nz]); }
  }
  return { set: seen, list };
}
function bfsNext(sx, sz, gx, gz) {
  if (sx === gx && sz === gz) return null;
  const prev = new Map([[key(sx, sz), null]]); const q = [[sx, sz]]; const d = [[1, 0], [-1, 0], [0, 1], [0, -1]]; let found = false;
  while (q.length) { const [cx, cz] = q.shift(); if (cx === gx && cz === gz) { found = true; break; }
    for (const [dx, dz] of d) { const nx = cx + dx, nz = cz + dz; if (isWall(nx, nz) || prev.has(key(nx, nz))) continue; prev.set(key(nx, nz), [cx, cz]); q.push([nx, nz]); }
  }
  if (!found) return null;
  let cur = [gx, gz];
  while (true) { const p = prev.get(key(cur[0], cur[1])); if (!p) return cur; if (p[0] === sx && p[1] === sz) return cur; cur = p; }
}
let REACH;                          // se asigna en boot() tras hornear
function firstOpenCell() {
  for (let j = 1; j < ROWS - 1; j++) for (let i = 1; i < COLS - 1; i++) if (MAP[j][i] === 0) return [i, j];
  return [1, 1];
}
// Celda transitable con holgura (sus 8 vecinas libres) para no nacer pegado a un muro.
function clearSpawnCell() {
  const open8 = (i, j) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = i + dx, z = j + dz;
      if (x < 0 || z < 0 || x >= COLS || z >= ROWS || MAP[z][x] === 1) return false;
    }
    return true;
  };
  for (const [i, j] of REACH.list) if (open8(i, j)) return [i, j];
  return REACH.list[0];
}
function spreadCells(count, avoid = () => false) {
  const pool = REACH.list.filter(([x, z]) => !avoid(x, z));
  const picks = [pool[Math.floor(Math.random() * pool.length)]];
  while (picks.length < count) {
    let best = null, bd = -1;
    for (const c of pool) { let dmin = Infinity; for (const p of picks) { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2; if (d < dmin) dmin = d; } if (dmin > bd) { bd = dmin; best = c; } }
    picks.push(best);
  }
  return picks;
}

// ============================================================
//  Escena, cámara, render
// ============================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1808);
scene.fog = new THREE.FogExp2(0x1c1808, 0.05);
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.1, 120);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // curva fílmica: luces calientes, negros con cuerpo
// Exposición por debajo de 1: ACES ya hace rolloff de altas luces; bajarla retira
// el wash sobreexpuesto sin apagar la escena (confort visual en sesiones largas).
renderer.toneMappingExposure = 0.95;
renderer.domElement.id = 'game-canvas';
document.body.appendChild(renderer.domElement);
const canvasEl = renderer.domElement;

const ambient = new THREE.AmbientLight(0xb6a06a, 0.34);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0xb0a06a, 0x191406, 0.28);
scene.add(hemi);
const aura = new THREE.PointLight(0x9d4edd, 0.8, 12, 1.8);
scene.add(aura);

// --- Presentación (R7): postpro, cámara, partículas, luces diegéticas ---
const post = createPost(renderer, scene, camera);
const feel = createCameraFeel(camera, 80);
const dust = createDust(scene);
const bursts = createBursts(scene);
const torches = createFlashlights(scene, 4);
let ceiling = { update() {} };   // paneles fluorescentes; se construye en boot()
let ghostMoving = false;         // lo fija moveGhost(); lo lee la sensación de cámara
let ghostAvatar = null;          // monstruo-entidad (forma visible del fantasma); boot()
// Corrección de encaje del frente del monstruo (su +Z local no es el frente "real").
const AVATAR_FACE = Math.PI;

// makeCanvas: usado por el minimapa.
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// ============================================================
//  Audio (sintetizado) + música opcional en bucle
// ============================================================
let actx = null, master = null, musicEl = null;
let senseOsc = null, senseGain = null;
let humGain = null, rumbleGain = null, windGain = null;   // capas ambientales (R7)
let heartT = 0, whisperT = 14;                            // temporizadores latido/susurros
function noiseBuffer(seconds = 2) {
  const b = actx.createBuffer(1, actx.sampleRate * seconds, actx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function initAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  master = actx.createGain(); master.gain.value = 0.6; master.connect(actx.destination);
  senseOsc = actx.createOscillator(); senseGain = actx.createGain();
  senseOsc.type = 'sine'; senseOsc.frequency.value = 54; senseGain.gain.value = 0.0001;
  senseOsc.connect(senseGain); senseGain.connect(master); senseOsc.start();
  // Zumbido fluorescente (50/60Hz + armónicos): el sonido-base de los Backrooms.
  const hum = actx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 120;
  const humF = actx.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 420;
  humGain = actx.createGain(); humGain.gain.value = 0.013;
  hum.connect(humF); humF.connect(humGain); humGain.connect(master); hum.start();
  // Rumble grave de cacería (ruido filtrado, entra tras el corte de luces).
  const rum = actx.createBufferSource(); rum.buffer = noiseBuffer(); rum.loop = true;
  const rumF = actx.createBiquadFilter(); rumF.type = 'lowpass'; rumF.frequency.value = 90;
  rumbleGain = actx.createGain(); rumbleGain.gain.value = 0;
  rum.connect(rumF); rumF.connect(rumbleGain); rumbleGain.connect(master); rum.start();
  // Viento espectral: respira con tu propio movimiento (el fantasma no pisa, fluye).
  const wind = actx.createBufferSource(); wind.buffer = noiseBuffer(); wind.loop = true;
  const windF = actx.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 520; windF.Q.value = 0.7;
  windGain = actx.createGain(); windGain.gain.value = 0;
  wind.connect(windF); windF.connect(windGain); windGain.connect(master); wind.start();
}
// Corte de cacería: el zumbido MUERE en seco -> medio segundo de silencio -> rumble.
function setHuntAudio(on) {
  if (!actx) return; const t = actx.currentTime;
  humGain.gain.cancelScheduledValues(t);
  humGain.gain.setTargetAtTime(on ? 0.0001 : 0.013, t, on ? 0.02 : 1.6);
  rumbleGain.gain.cancelScheduledValues(t);
  if (on) { rumbleGain.gain.setValueAtTime(0.0001, t); rumbleGain.gain.setTargetAtTime(0.45, t + 0.6, 1.1); }
  else rumbleGain.gain.setTargetAtTime(0.0001, t, 0.35);
}
// Latido doble (lub-dub) — la tensión de tener a una presa cerca en la oscuridad.
function heartbeat() {
  tone({ type: 'sine', f0: 58, f1: 36, dur: 0.14, vol: 0.5 });
  tone({ type: 'sine', f0: 52, f1: 33, dur: 0.12, vol: 0.32, at: 0.16 });
}
// Susurro lejano: soplo de aire filtrado, aleatorio, solo fuera de cacería.
function whisper() {
  if (!actx) return; const t = actx.currentTime;
  const src = actx.createBufferSource(); src.buffer = noiseBuffer(1); src.loop = false;
  const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650 + Math.random() * 900; f.Q.value = 9;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.02, t + 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + 1.7);
}
function startMusic() { if (musicEl) return; musicEl = new Audio('assets/music/freesound_community-dark-drone-ambient-66071.mp3'); musicEl.loop = true; musicEl.volume = 0.4; musicEl.play().catch(() => {}); }
function duckMusic(down) { if (musicEl) musicEl.volume = down ? 0.1 : 0.4; }
function tone({ type = 'sine', f0, f1, dur, vol = 0.3, at = 0 }) {
  if (!actx) return; const t = actx.currentTime + at;
  const o = actx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
const sfx = {
  roar() { tone({ type: 'sawtooth', f0: 72, f1: 40, dur: 1.3, vol: 0.55 }); tone({ type: 'square', f0: 98, f1: 52, dur: 1.3, vol: 0.3 }); },
  kill() { tone({ type: 'sine', f0: 170, f1: 38, dur: 0.45, vol: 0.45 }); },
  parry() { tone({ type: 'square', f0: 880, f1: 440, dur: 0.18, vol: 0.4 }); tone({ type: 'sine', f0: 1320, f1: 660, dur: 0.25, vol: 0.25 }); },
  mori() { tone({ type: 'sawtooth', f0: 60, f1: 24, dur: 1.9, vol: 0.5 }); tone({ type: 'sine', f0: 240, f1: 30, dur: 1.9, vol: 0.3 }); },
  win() { tone({ type: 'triangle', f0: 440, f1: 880, dur: 0.5, vol: 0.4 }); },
  lose() { tone({ type: 'sawtooth', f0: 300, f1: 70, dur: 0.85, vol: 0.4 }); },
};

// ============================================================
//  Ritual: altar (mesa) + objetos rituales (cruces) que los
//  supervivientes acarrean al altar; al reunirlos se canaliza.
// ============================================================
let ritual = null;                 // estado puro (js/ritual.js), creado en makeRitual
const ritualMeshes = new Map();    // objId -> THREE.Object3D
const missionMeshes = new Map(); // missionId -> { mesh, mat }
let altarMesh = null, altarMat = null;
const OBJ_HEIGHT = 0.6;            // alto objetivo del objeto ritual en mundo
const ALTAR_HEIGHT = 0.9;         // alto objetivo del altar

// Coloca un modelo procedural (ya construido a tamaño final, base en y=0,
// frente +Z) sobre (wx,wz); opcionalmente lo gira para mirar al centro del nivel.
function placeModel(root, wx, wz, faceCenter) {
  if (faceCenter) {
    const cxw = ((COLS - 1) * CELL) / 2, czw = ((ROWS - 1) * CELL) / 2;
    root.rotation.y = Math.atan2(cxw - wx, czw - wz);
  }
  root.position.set(wx, 0, wz);
  return root;
}

// Escala un GLB clonado a `targetH` midiendo su caja y lo apoya en y=0 sobre (wx,wz).
function placeProp(gltf, wx, wz, targetH, faceCenter) {
  const mesh = gltf.scene.clone(true);
  if (faceCenter) {
    const cxw = ((COLS - 1) * CELL) / 2, czw = ((ROWS - 1) * CELL) / 2;
    mesh.rotation.y = Math.atan2(cxw - wx, czw - wz);
  }
  mesh.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(mesh);
  mesh.scale.setScalar(targetH / Math.max(1e-3, box.max.y - box.min.y));
  mesh.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(mesh);
  mesh.position.set(wx - (box.min.x + box.max.x) / 2, -box.min.y, wz - (box.min.z + box.max.z) / 2);
  return mesh;
}

function makeRitual(assets) {
  // El nivel horneado es enorme (~150×150); si repartiéramos altar y objetos por
  // TODO el mapa, acarrear un objeto cruzaría cientos de celdas y el ritual sería
  // inviable. Acotamos altar+objetos a una región (hub + radio): exige explorar
  // para encontrar la zona, pero el transporte es razonable. RITUAL_SPREAD tunea
  // cuánto se dispersan dentro de la región.
  const hub = REACH.list[Math.floor(Math.random() * REACH.list.length)];
  const cells = spreadCells(NUM_MISSIONS + NUM_RITUAL_OBJECTS + 1, (x, z) => (Math.abs(x - hub[0]) + Math.abs(z - hub[1])) > RITUAL_SPREAD);
  const [agx, agz] = cells[0], [awx, awz] = worldOf(agx, agz);
  const missionCells = cells.slice(1, 1 + NUM_MISSIONS);
  const objCells = cells.slice(1 + NUM_MISSIONS, 1 + NUM_MISSIONS + NUM_RITUAL_OBJECTS);
  ritual = RIT.createRitual(missionCells, objCells, [agx, agz], { NEED_CHANNELERS: 2 });

  // Altar: GLB drop-in (assets/models/objects/altar.glb) si existe; si no, altar
  // procedural de piedra. altarMat = material emissive del brillo de canalización.
  if (assets && assets.altar) {
    altarMesh = placeProp(assets.altar, awx, awz, ALTAR_HEIGHT, true);
    altarMesh.traverse((o) => { if (o.isMesh && !altarMat) altarMat = (Array.isArray(o.material) ? o.material[0] : o.material).clone(); });
    altarMesh.traverse((o) => { if (o.isMesh) o.material = altarMat; });
    if (altarMat) { altarMat.emissive = new THREE.Color(0x9d4edd); altarMat.emissiveIntensity = 0.1; }
  } else {
    const a = buildAltar(); altarMesh = placeModel(a.root, awx, awz, true); altarMat = a.glowMat;
  }
  scene.add(altarMesh);

  // Objetos rituales: GLB drop-in (cross.glb) si existe; si no, cruz procedural.
  for (const o of ritual.objects) {
    const [wx, wz] = worldOf(o.gx, o.gz);
    const mesh = (assets && assets.cross) ? placeProp(assets.cross, wx, wz, OBJ_HEIGHT, false) : placeModel(buildCross(), wx, wz, false);
    scene.add(mesh);
    ritualMeshes.set(o.id, mesh);
  }

  // Estaciones de misión: GLB drop-in (mission.glb) si existe; si no, CRT
  // procedural. Material ÚNICO clonado por estación -> el sync de progreso (rojo
  // averiado -> verde reparado) solo toca ese material.
  for (const m of ritual.missions) {
    const [wx, wz] = worldOf(m.gx, m.gz);
    let mesh, mat;
    if (assets && assets.mission) {
      mesh = placeProp(assets.mission, wx, wz, MISSION_HEIGHT, true);
      mesh.traverse((o) => { if (o.isMesh && !mat) mat = (Array.isArray(o.material) ? o.material[0] : o.material).clone(); });
      mesh.traverse((o) => { if (o.isMesh) o.material = mat; });
    } else {
      const mo = buildMonitor(); mesh = placeModel(mo.root, wx, wz, true); mat = mo.screenMat;
    }
    scene.add(mesh); missionMeshes.set(m.id, { mesh, mat });
  }
}

// Coloca la malla de cada objeto según su estado: ON_MAP en su celda, CARRIED
// sobre el portador, DEPOSITED apilado junto al altar.
function syncRitualMeshes() {
  let deposited = 0;
  for (const o of ritual.objects) {
    const mesh = ritualMeshes.get(o.id); if (!mesh) continue;
    if (o.status === RIT.OBJ.CARRIED) {
      const carrier = hunters.find((h) => h.id === o.carrier && h.alive);
      if (carrier) mesh.position.set(carrier.pos.x, 1.9, carrier.pos.z);
    } else if (o.status === RIT.OBJ.DEPOSITED) {
      const [ax, az] = worldOf(ritual.altar.gx, ritual.altar.gz);
      mesh.position.set(ax + (deposited % 2 ? 0.2 : -0.2), ALTAR_HEIGHT + 0.1 + Math.floor(deposited / 2) * 0.18, az);
      deposited++;
    } else {
      const [wx, wz] = worldOf(o.gx, o.gz);
      mesh.position.set(wx, OBJ_HEIGHT / 2, wz);
    }
  }
  // Brillo del altar crece con la canalización (cap más bajo: el púrpura saturado
  // a tope reventaba en bloom).
  if (altarMat) altarMat.emissiveIntensity = 0.1 + (ritual.phase === RIT.PHASE.CHANNEL ? 0.8 * ritual.channel : 0);
  // Monitores: rojo (averiado) -> verde (reparado) según progreso. Rojo menos puro
  // y emisión más baja: dejan de ser un faro que deslumbra de cerca.
  for (const m of ritual.missions) {
    const mm = missionMeshes.get(m.id); if (!mm || !mm.mat) continue;
    mm.mat.emissive.setRGB(0.85 * (1 - m.progress), 0.2 + 0.6 * m.progress, 0.18);
    mm.mat.emissiveIntensity = 0.3 + 0.3 * m.progress;
  }
}

// ============================================================
//  Investigadores (modelos GLB animados)
// ============================================================
// Fallback si fallara la carga de personajes: una caja con la misma API mínima.
function makeBoxHunter(color) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, 0.4), new THREE.MeshStandardMaterial({ color }));
  body.position.y = 0.85; root.add(body);
  let yaw = 0;
  return {
    root,
    setPos(x, y, z) { root.position.set(x, y, z); },
    faceDir(dx, dz) { if (dx || dz) { yaw = Math.atan2(dx, dz); root.rotation.y = yaw; } },
    setState() {},
    setSpectral(on) { body.material.emissive = new THREE.Color(on ? 0x66ccff : 0x000000); body.material.depthTest = !on; body.renderOrder = on ? 999 : 0; },
    play() {},
    showBark() {},
    glanceBack() {},
    setMarked() {},
    update() {},
  };
}
const hunters = [];
function makeHunters(chars) {
  const spawns = spreadCells(NUM_HUNTERS + 1, (x, z) => (x <= 4 && z <= 4)).slice(1, NUM_HUNTERS + 1);
  const fallbackColors = [0x4f8cff, 0xff8c42, 0x37d67a, 0xe84393];
  for (let i = 0; i < NUM_HUNTERS; i++) {
    const [gx, gz] = spawns[i], [wx, wz] = worldOf(gx, gz);
    const gltf = chars && chars[i % chars.length] && chars[i % chars.length].gltf;
    const model = gltf ? new HunterModel(gltf) : makeBoxHunter(fallbackColors[i % fallbackColors.length]);
    model.setPos(wx, 0, wz); scene.add(model.root);
    torches.attach(model);   // linterna: cono volumétrico + lente (spot real si está cerca)
    hunters.push({
      id: i, pos: new THREE.Vector3(wx, 0, wz), model, alive: true,
      flee: 0, repath: 0, next: null, working: -1,
      // --- estado IA ---
      bravery: 0.2 + Math.random() * 0.7,   // personalidad fija
      stress: 0, sanity: 1, fear: 0, panic: false, parryUsed: false,
      lives: 2, ko: false, reviveT: 0, hitCd: 0,    // combate R6 (vidas/derribo)
      role: AIB.ROLES.EXPLORE_A, recentCells: [], lastBarkT: -999, goal: null,
    });
  }
}
function farthestCell(x, z) { let best = null, bd = -1; for (const [gx, gz] of REACH.list) { const [wx, wz] = worldOf(gx, gz); const d = (wx - x) ** 2 + (wz - z) ** 2; if (d > bd) { bd = d; best = [gx, gz]; } } return best; }
// Celda de huida: candidatas en anillo alrededor del bot, probando primero la
// dirección opuesta al fantasma; vale la primera alcanzable cuyo PRIMER paso BFS
// no acerque al fantasma (evita rutas que pasan por delante de él). Presupuesto
// de BFS acotado; fallback: la celda más lejana global.
function fleeCell(h, ghost) {
  const [hgx, hgz] = cellOf(h.pos.x, h.pos.z);
  const [ggx, ggz] = cellOf(ghost.x, ghost.z);
  const away = Math.atan2(hgz - ggz, hgx - ggx); // dirección de escape
  const tries = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI];
  let bfsBudget = 4;
  for (const off of tries) {
    const ang = away + off;
    const gx = Math.round(hgx + Math.cos(ang) * FLEE_RADIUS), gz = Math.round(hgz + Math.sin(ang) * FLEE_RADIUS);
    if (isWall(gx, gz) || !REACH.set.has(key(gx, gz))) continue;
    if (bfsBudget-- <= 0) break;
    const step = bfsNext(hgx, hgz, gx, gz);
    if (!step) continue;
    const d0 = Math.abs(hgx - ggx) + Math.abs(hgz - ggz);
    const d1 = Math.abs(step[0] - ggx) + Math.abs(step[1] - ggz);
    if (d1 >= d0) return [gx, gz]; // el primer paso ya se aleja: válida
  }
  return farthestCell(ghost.x, ghost.z);
}

// Cachea el destino de huida por bot (recalcula cada ~0.5 s). Si hay un destino
// preferido (p.ej. celda de dispersión), se usa solo si su primer paso se aleja.
function fleeTargetOf(h, ghost, dt, preferred) {
  if (preferred) {
    const [hgx, hgz] = cellOf(h.pos.x, h.pos.z); const [ggx, ggz] = cellOf(ghost.x, ghost.z);
    const step = bfsNext(hgx, hgz, preferred[0], preferred[1]);
    if (step && (Math.abs(step[0] - ggx) + Math.abs(step[1] - ggz)) >= (Math.abs(hgx - ggx) + Math.abs(hgz - ggz))) return preferred;
  }
  h.fleeRepath = (h.fleeRepath || 0) - dt;
  if (!h.fleeTarget || h.fleeRepath <= 0) { h.fleeTarget = fleeCell(h, ghost); h.fleeRepath = 0.5; }
  return h.fleeTarget;
}

function stepToward(ent, goal, speed, dt) {
  if (!goal) return;
  const [cgx, cgz] = cellOf(ent.pos.x, ent.pos.z);
  ent.repath -= dt; if (ent.repath <= 0 || !ent.next) { ent.next = bfsNext(cgx, cgz, goal[0], goal[1]); ent.repath = 0.35; }
  const [tgx, tgz] = ent.next || goal, [tx, tz] = worldOf(tgx, tgz);
  const dx = tx - ent.pos.x, dz = tz - ent.pos.z, d = Math.hypot(dx, dz);
  if (d < 0.12) { ent.next = null; return; }
  const vx = (dx / d) * speed * dt, vz = (dz / d) * speed * dt;
  if (!collides(ent.pos.x + vx, ent.pos.z, HUNTER_R)) ent.pos.x += vx;
  if (!collides(ent.pos.x, ent.pos.z + vz, HUNTER_R)) ent.pos.z += vz;
}
const GHOST_FEAR_RANGE = 5;   // distancia a la que el fantasma estresa
const SENSE_RANGE_W = ABL.AB.SENSE_RANGE;
const GROUP_RADIUS = 3;       // unidades de mundo para considerarse "agrupado"

// Construye el ctx de miedo de un agente a partir del estado del mundo.
function fearCtx(h, ghost, hunting) {
  const dGhost = Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z);
  let near = 0;
  for (const o of hunters) {
    if (o === h || !o.alive) continue;
    if (Math.hypot(o.pos.x - h.pos.x, o.pos.z - h.pos.z) < GROUP_RADIUS) near++;
  }
  const grouped = near >= 1;
  const [gx, gz] = cellOf(h.pos.x, h.pos.z);
  const safe = !hunting && AIB.dangerAt(BB, gx, gz) < 0.3 && dGhost > GHOST_FEAR_RANGE;
  return {
    nearGhost: dGhost < GHOST_FEAR_RANGE,
    inEvent: AIB.dangerAt(BB, gx, gz) > 0.5,
    dark: hunting,
    alone: !grouped,
    grouped,
    safe,
  };
}

function updateHunter(h, dt, ghost, hunting, ghostOnFloor0) {
  if (!h.alive) { h.model.update(dt); return; }
  if (h.ko) { h.model.setState({ alive: false }); h.model.update(dt); return; } // KO: tirado, no actúa
  if (h.hitCd > 0) h.hitCd -= dt;
  if (h.flee > 0) h.flee -= dt;
  {
    const r = AIB.updateFear(h, fearCtx(h, ghost, hunting), dt);
    h.stress = r.stress; h.sanity = r.sanity; h.fear = r.fear; h.panic = r.panic;
  }
  // Trampa paranormal: dentro del radio, ralentiza + estrés + reruteo.
  const [hgx, hgz] = cellOf(h.pos.x, h.pos.z);
  const trapped = ABL.agentInTrap(ab, hgx, hgz);
  if (trapped) { h.stress = Math.min(1, h.stress + 0.4 * dt); if (Math.random() < 0.02) h.next = null; }
  const speedMul = trapped ? 0.5 : 1;
  // Sentido del fantasma (invisible): cuanto más cerca, más se alejan. Nunca van hacia él.
  if (!hunting) {
    const dG = Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z);
    if (dG < SENSE_RANGE_W) {
      const prox = 1 - dG / SENSE_RANGE_W; h.flee = Math.max(h.flee, 0.8 + prox * 1.6); h.next = null;
      if (h.role === RIT.RROLE.SCOUT && (h.alertCd || 0) <= 0) {  // el vigía da la alarma
        h.alertCd = 10;
        const [agx2, agz2] = cellOf(h.pos.x, h.pos.z);
        AIB.addEvent(BB, 'alert', agx2, agz2, GAME.timeLeft, AIB.AI.EVENT_DANGER);
        const b = AIB.barkFor(h, 'danger', NOW_SEC, AIB.AI);
        if (b) { h.lastBarkT = b.t; h.model.showBark(b.text); }
      }
    }
    if ((h.alertCd || 0) > 0) h.alertCd -= dt;
  }
  const prevX = h.pos.x, prevZ = h.pos.z;
  if (hunting) {
    h.working = -1;
    const dest = DISPERSAL && DISPERSAL.get(h.id);
    stepToward(h, fleeTargetOf(h, ghost, dt, dest), HUNTER_FLEE_SPEED * speedMul, dt);
    if (ghostOnFloor0 && stun <= 0 && h.hitCd <= 0 && Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z) < KILL_RANGE) {
      if (!h.parryUsed) {
        h.parryUsed = true; // un parry por cacería: gastado tanto si acierta como si falla
        if (rollParry(parryChance(h.bravery, h.panic, PARRY))) {
          stun = STUN_DUR; h.flee = PARRY_FLEE; h.next = null;
          h.model.play('HitRecieve'); h.model.showBark('¡Bloqueado!'); sfx.parry();
          feel.addTrauma(0.6);   // el parry te sacude a TI
          return; // parry exitoso: no golpeas y quedas aturdido
        }
      }
      // Golpe: marcado = muerte directa; sin marca pierde vida y a la última cae KO.
      const r = hitResult(ABL.isMarked(ab, h.id), h.lives);
      h.lives = r.lives; h.hitCd = HIT_COOLDOWN;
      if (r.outcome === 'dead') { killHunter(h); return; }
      if (r.outcome === 'down') { enterKO(h); return; }
      h.model.play('HitRecieve'); h.model.showBark('¡AGH!'); sfx.kill(); // herido
      h.flee = 2.5; h.next = null;
      return;
    }
  } else if (h.flee > 0) {
    h.working = -1; stepToward(h, fleeTargetOf(h, ghost, dt), HUNTER_FLEE_SPEED * speedMul, dt);
  } else if (h.panic) {
    // PÁNICO: no progresa objetivos; huye lejos del fantasma de forma errática.
    h.working = -1;
    const away = fleeTargetOf(h, ghost, dt);
    const jitter = [away[0] + (Math.random() < 0.5 ? 1 : -1), away[1] + (Math.random() < 0.5 ? 1 : -1)];
    stepToward(h, isOpenCell(jitter[0], jitter[1]) ? jitter : away, HUNTER_FLEE_SPEED * speedMul, dt);
    pushRecent(h);
  } else {
    // Objetivo decidido por la IA (coordinador + utilidad). Si carga un objeto y
    // llega al altar, lo deposita; si es FETCH y pisa un objeto suelto, lo coge;
    // luego camina hacia la meta del rol.
    const cands = buildCandidates(h);
    const newGoal = AIB.chooseGoal(h, cands, BB, alliesOf(h), AIB.AI);
    // Si la meta cambia, invalida el waypoint BFS para no seguir 0.35s la ruta vieja.
    if (!h.goal || !newGoal || newGoal[0] !== h.goal[0] || newGoal[1] !== h.goal[1]) h.next = null;
    h.goal = newGoal;
    h.working = -1;
    if (h.role === RIT.RROLE.RESCUER) {
      // RESCUER: junto a un KO, canaliza la reanimación (si el fantasma no está cerca).
      const k = hunters.find((x) => x.alive && x.ko);
      if (k && Math.hypot(h.pos.x - k.pos.x, h.pos.z - k.pos.z) <= 1.2) {
        const dG = Math.hypot(ghost.x - k.pos.x, ghost.z - k.pos.z);
        if (canRevive(dG, REVIVE_BLOCK)) {
          h.working = 0; k.reviveT += dt;
          if (k.reviveT >= REVIVE_TIME) { k.ko = false; k.lives = 1; k.reviveT = 0; k.model.play('Idle'); h.model.showBark('¡Arriba!'); }
        }
        // con el fantasma rondando espera junto al caído sin canalizar
      } else if (h.goal) stepToward(h, h.goal, HUNTER_SPEED * speedMul, dt);
    } else if (ritual.phase === RIT.PHASE.MISSIONS) {
      // REPAIR: si está sobre una misión incompleta, la trabaja; si no, camina hacia la meta.
      let m = null;
      for (const mi of ritual.missions) {
        if (mi.done) continue;
        const [mwx, mwz] = worldOf(mi.gx, mi.gz);
        if (Math.hypot(h.pos.x - mwx, h.pos.z - mwz) <= 1.0) { m = mi; break; }
      }
      if (m) { h.working = 0; RIT.workMission(ritual, m.id, dt, REPAIR_RATE); }
      else if (h.goal) stepToward(h, h.goal, HUNTER_SPEED * speedMul, dt);
    } else {
      // GATHER: recoger/depositar cruces (R2) — bloque existente sin cambios.
      const [ax, az] = worldOf(ritual.altar.gx, ritual.altar.gz);
      const carried = RIT.objectCarriedBy(ritual, h.id);
      if (carried && !hunting) {
        if (Math.hypot(h.pos.x - ax, h.pos.z - az) <= RIT.RCFG.ALTAR_RANGE) RIT.depositCarried(ritual, h.id);
      } else if (h.role === RIT.RROLE.FETCH) {
        for (const o of ritual.objects) {
          if (o.status !== RIT.OBJ.ON_MAP) continue;
          const [owx, owz] = worldOf(o.gx, o.gz);
          if (Math.hypot(h.pos.x - owx, h.pos.z - owz) <= 0.7) { RIT.pickup(ritual, o.id, h.id); break; }
        }
      }
      if (h.goal) stepToward(h, h.goal, HUNTER_SPEED * speedMul, dt);
    }
    pushRecent(h);
  }
  const dx = h.pos.x - prevX, dz = h.pos.z - prevZ;
  const moving = (dx * dx + dz * dz) > 1e-6;
  h.model.faceDir(dx, dz);
  h.model.setState({ alive: true, hunting, flee: h.flee, working: h.working, moving });
  h.model.setPos(h.pos.x, 0, h.pos.z);
  // Barks: dispara según estado y respeta cooldown/prioridad.
  let trig = null;
  if (hunting) trig = 'hunt';
  else if (h.panic || h.fear > 0.7) trig = 'scared';
  else if (ritual.phase === RIT.PHASE.CHANNEL && (h.role === RIT.RROLE.CHANNELER || h.role === RIT.RROLE.DEFEND)) trig = 'regroup';
  if (trig) {
    const b = AIB.barkFor(h, trig, NOW_SEC, AIB.AI);
    if (b) { h.lastBarkT = b.t; h.model.showBark(b.text); if (h.fear > 0.5) h.model.glanceBack(); }
  }
  h.model.update(dt);
}
// Derribo (KO): no muere — queda en el suelo esperando reanimación o el mori.
function enterKO(h) {
  h.ko = true; h.reviveT = 0; h.working = -1;
  if (ab.observe.target === h.id) ab.observe.target = null; // re-apunta: el caído ya no es objetivo
  { const [gx, gz] = cellOf(h.pos.x, h.pos.z); RIT.dropCarried(ritual, h.id, gx, gz); }
  { const [gx, gz] = cellOf(h.pos.x, h.pos.z); AIB.addEvent(BB, 'down', gx, gz, GAME.timeLeft, AIB.AI.DEATH_DANGER); }
  h.model.setSpectral(false); h.model.play('Death'); sfx.kill();
  bursts.spawn(h.pos.x, 1.1, h.pos.z, { color: 0x8fa3b8, count: 18, speed: 1.2, up: 0.8 });
  feel.addTrauma(0.3); feel.kick(3);
}
function killHunter(h) {
  h.alive = false;
  if (ab.observe.target === h.id) ab.observe.target = null;
  delete ab.observe.progress[h.id]; // el progreso de un muerto ya no significa nada
  { const [gx, gz] = cellOf(h.pos.x, h.pos.z); AIB.addEvent(BB, 'death', gx, gz, GAME.timeLeft, AIB.AI.DEATH_DANGER); }
  h.model.setSpectral(false); h.model.play('Death'); h.model.update(0); sfx.kill();
  bursts.spawn(h.pos.x, 1.2, h.pos.z, { color: 0xc77dff, count: 34, speed: 2.0, up: 1.8, size: 0.11 });
  feel.addTrauma(0.45); feel.kick(5);
  { const [gx, gz] = cellOf(h.pos.x, h.pos.z); RIT.dropCarried(ritual, h.id, gx, gz); }
  if (ritual.phase === RIT.PHASE.CHANNEL) ritual.channel = Math.max(0, ritual.channel - 0.1); // penalización por matar a un canalizador
  checkEnd();
}

// ============================================================
//  Estado del jugador (un solo piso)
// ============================================================
const pos = new THREE.Vector3(CELL, EYE, CELL);
let yaw = 0, pitch = 0, currentFloor = 0;
let debugAI = false;   // overlay de depuración de la IA (tecla O)
let escalated = false;   // al agotarse el tiempo: cacería permanente
let stun = 0;   // s restantes de aturdimiento del fantasma (por parry)
let moriT = 0, moriTarget = null;   // ejecución (Memento Mori) en curso
const ab = ABL.createAbilities();   // energía + habilidades del fantasma

// Línea de visión por grid: muestrea el segmento contra los muros (sin Raycaster).
function gridLOS(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(d / (CELL * 0.5)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const [gx, gz] = cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    if (isWall(gx, gz)) return false;
  }
  return true;
}

// Tecla 1: fija como objetivo de observación al bot vivo no-KO más alineado con la mira.
function selectObserveTarget() {
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  let best = null, bs = 0.92; // cos ~23°: hay que apuntarle de verdad
  for (const h of hunters) {
    if (!h.alive || h.ko) continue;
    const to = new THREE.Vector3(h.pos.x - pos.x, 0, h.pos.z - pos.z);
    const d = to.length(); if (d < 0.5 || d > ABL.AB.OBS_RANGE) continue;
    to.normalize();
    const dot = to.dot(fwd);
    if (dot > bs && gridLOS(pos.x, pos.z, h.pos.x, h.pos.z)) { bs = dot; best = h; }
  }
  if (best) { ABL.setObserveTarget(ab, best.id); sfx.parry(); }
}

function groundHeight() { return 0; }
// Colisión del jugador contra el grid FINO: recorre toda la huella del jugador
// (no 4 esquinas) y para exacto en la pared visible.
function collidesPlayer(x, z) {
  return collidesBoxGrid(COL_MAP, COL_COLS, COL_ROWS, COL_CELL, x, z, PLAYER_R);
}

const keys = Object.create(null);
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (GAME.state !== 'playing' || document.pointerLockElement !== canvasEl) {
    if (e.code === 'KeyO') debugAI = !debugAI; // overlay sin pointerlock para depurar
    return;
  }
  if (e.code === 'Digit1' || e.code === 'KeyQ') selectObserveTarget();
  else if (e.code === 'Digit2') useTeleport();
  else if (e.code === 'Digit3') useTrap();
  else if (e.code === 'Digit4') useDecoy();
  else if (e.code === 'Digit5') useSpectral();
  else if (e.code === 'Space') tryStartHunt();
  else if (e.code === 'KeyE') tryMori();
  else if (e.code === 'KeyO') debugAI = !debugAI;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => { if (e.button === 0 && document.pointerLockElement === canvasEl) selectObserveTarget(); });

// ============================================================
//  Cacería + partida
// ============================================================
const hunt = { active: 0 };
// Pizarra compartida del escuadrón (niebla, objetivos, peligro, eventos, roster).
let BB = AIB.createBlackboard();
const VISION_R = AIB.AI.VISION_RADIUS;
let coordTimer = 0;           // acumulador para correr el coordinador a baja Hz
const COORD_PERIOD = 1.2;     // s entre reasignaciones de rol
let DISPERSAL = null;
function startHunt() { hunt.active = ABL.AB.HUNT_DUR; sfx.roar(); duckMusic(true); setHuntAudio(true); feel.addTrauma(0.55); { const [gx, gz] = cellOf(pos.x, pos.z); AIB.addEvent(BB, 'hunt', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER); }
  for (const h of hunters) if (h.alive && !h.ko) { h.parryUsed = false; h.lives = LIVES_UNMARKED; h.hitCd = 0; } // los KO no recuperan vidas: revividos = 1 // parry + vidas por cacería
}
function endHunt() { hunt.active = 0; duckMusic(false); setHuntAudio(false); for (const h of hunters) if (h.alive) h.model.setSpectral(false); }
function updateHunt(dt) {
  if (escalated) { hunt.active = ABL.AB.HUNT_DUR; return true; }
  if (hunt.active > 0) { hunt.active -= dt; if (hunt.active <= 0) endHunt(); }
  return hunt.active > 0;   // ya NO hay auto-temporizador: la cacería la activa el jugador (Espacio)
}
const GAME = { state: 'playing', timeLeft: MATCH_TIME };
function checkEnd() {
  if (GAME.state !== 'playing') return;
  if (ritual && ritual.phase === RIT.PHASE.DONE) return endGame(false, 'El ritual te ha destruido.');
  if (hunters.every((h) => !h.alive)) return endGame(true, 'Eliminaste a todos antes del ritual.');
  // El tiempo ya NO da victoria al fantasma: dispara escalada (ver updateHunt).
}
function endGame(win, msg) {
  GAME.state = win ? 'win' : 'lose'; stun = 0; endHunt(); document.exitPointerLock(); win ? sfx.win() : sfx.lose();
  const t = document.getElementById('endTitle'); t.textContent = win ? '👻 VICTORIA' : '💀 DERROTA'; t.className = win ? 'win' : 'lose';
  document.getElementById('endMsg').textContent = msg; document.getElementById('endscreen').classList.remove('hidden');
}

// ============================================================
//  Pointer lock + ratón
// ============================================================
const overlay = document.getElementById('overlay'); const hud = document.getElementById('hud');
document.getElementById('startBtn').addEventListener('click', () => { if (GAME.state !== 'playing') return; initAudio(); startMusic(); canvasEl.requestPointerLock(); });
document.getElementById('againBtn').addEventListener('click', () => location.reload());
document.addEventListener('pointerlockchange', () => { const locked = document.pointerLockElement === canvasEl; overlay.classList.toggle('hidden', locked); if (GAME.state === 'playing') hud.classList.toggle('hidden', !locked); });
document.addEventListener('mousemove', (e) => { if (document.pointerLockElement !== canvasEl) return; yaw -= e.movementX * SENS; pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - e.movementY * SENS)); });

// ============================================================
//  HUD + minimapa
// ============================================================
const el = (id) => document.getElementById(id); const banner = el('glitchBanner');
function updateHUD(hunting) {
  const m = Math.floor(GAME.timeLeft / 60), s = Math.floor(GAME.timeLeft % 60);
  el('matchTime').textContent = `${m}:${s.toString().padStart(2, '0')}`;
  if (ritual.phase === RIT.PHASE.MISSIONS) {
    el('missions').textContent = RIT.missionsDoneCount(ritual) + '/' + ritual.missions.length;
  } else if (ritual.phase === RIT.PHASE.CHANNEL || ritual.phase === RIT.PHASE.DONE) {
    el('missions').textContent = 'RITUAL ' + Math.round(ritual.channel * 100) + '%';
  } else {
    el('missions').textContent = RIT.depositedCount(ritual) + '/' + ritual.objects.length;
  }
  el('hunters').textContent = hunters.filter((h) => h.alive).length;
  el('floor').textContent = '🟡 0';
  // Slot 1 = Observación: % del objetivo actual (o MARCADO).
  const ot = ab.observe.target;
  el('cd1').textContent = ot == null ? 'APUNTA+1' : (ABL.isMarked(ab, ot) ? 'MARCADO' : Math.round(ABL.obsProgress(ab, ot) * 100) + '%');
  el('ab1').classList.toggle('ready', ot != null);
  el('nextHunt').textContent = hunting ? Math.ceil(hunt.active) + 's' : '—';
  banner.className = hunting ? 'active' : 'hidden';
  if (hunting) banner.textContent = '⟲ CACERÍA — LUCES FUERA ⟲';
  if (escalated) { banner.className = 'active'; banner.textContent = '☠ EL VELO SE ROMPIÓ — CACERÍA PERMANENTE ☠'; }
  const eb = el('energyBar'); if (eb) eb.style.width = Math.round(ab.energy * 100) + '%';
  const ew = el('energyWrap'); if (ew) ew.classList.toggle('ready', ABL.huntReady(ab));
  el('energyLabel').textContent = ABL.huntReady(ab) ? 'CACERÍA LISTA [ESPACIO]' : 'ENERGÍA';
  const slot = (id, key, cost) => {
    const cd = ab.cooldowns[key];
    el('cd' + id).textContent = cd > 0 ? cd.toFixed(1) + 's' : 'LISTO';
    el('ab' + id).classList.toggle('dim', cd > 0 || ab.energy < cost);
  };
  slot(2, 'teleport', ABL.AB.COST_TELEPORT); slot(3, 'trap', ABL.AB.COST_TRAP); slot(4, 'decoy', ABL.AB.COST_DECOY);
  el('cd5').textContent = ab.cooldowns.spectral > 0 ? ab.cooldowns.spectral.toFixed(1) + 's' : (hunting ? 'LISTO' : 'CAZA');
  el('ab5').classList.toggle('dim', !hunting || ab.cooldowns.spectral > 0);
  el('stunfx').classList.toggle('hidden', stun <= 0);
  el('morifx').classList.toggle('hidden', moriT <= 0);
  el('moriTip').classList.toggle('hidden', moriT > 0 || !hunters.some((h) => h.alive && h.ko && Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) <= MORI_RANGE));
}
const mmCanvas = el('minimap'), mmCtx = mmCanvas.getContext('2d'), MM = mmCanvas.width;
function buildMaze(map, wallColor) {
  const c = makeCanvas(MM, MM), g = c.getContext('2d'), cs = MM / COLS;
  g.fillStyle = '#0c0c0c'; g.fillRect(0, 0, MM, MM);
  for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++) if (map[z][x] === 1) { g.fillStyle = wallColor; g.fillRect(x * cs, z * cs, cs + 0.6, cs + 0.6); }
  return c;
}
let maze0;
function rebuildMinimap() { maze0 = buildMaze(MAP, '#6b5a1f'); }
function drawMinimap() {
  const cs = MM / COLS;
  mmCtx.clearRect(0, 0, MM, MM); if (maze0) mmCtx.drawImage(maze0, 0, 0);
  const [agx, agz] = [ritual.altar.gx, ritual.altar.gz];
  mmCtx.fillStyle = '#9d4edd'; mmCtx.fillRect(agx * cs - 2, agz * cs - 2, cs + 3, cs + 3); // altar
  for (const m of ritual.missions) {
    mmCtx.fillStyle = m.done ? '#37d67a' : '#ff5555';
    mmCtx.fillRect(m.gx * cs - 1, m.gz * cs - 1, cs + 1.5, cs + 1.5);
  }
  for (const o of ritual.objects) {
    if (o.status === RIT.OBJ.DEPOSITED) continue;
    mmCtx.fillStyle = o.status === RIT.OBJ.CARRIED ? '#ffd166' : '#d8c089';
    mmCtx.fillRect(o.gx * cs - 1, o.gz * cs - 1, cs + 1.5, cs + 1.5);
  }
  mmCtx.fillStyle = '#c77dff'; mmCtx.beginPath(); mmCtx.arc((pos.x / CELL) * cs, (pos.z / CELL) * cs, 3, 0, 7); mmCtx.fill();
  if (debugAI) {
    const COLR = { REPAIR: '#00d4ff', SCOUT: '#ffffff', RESCUER: '#ff8ce0', EXPLORE_A: '#4f8cff', EXPLORE_B: '#37d67a', FETCH: '#ffd166', GUARD: '#ffae42', CHANNELER: '#c77dff', DEFEND: '#37d67a', DISTRACT: '#ff3b3b' };
    for (const h of hunters) {
      if (!h.alive) continue;
      if (h.ko) { mmCtx.fillStyle = '#888'; mmCtx.fillRect((h.pos.x / CELL) * cs - 2, (h.pos.z / CELL) * cs - 2, 4, 4); continue; }
      mmCtx.fillStyle = COLR[h.role] || '#fff';
      mmCtx.fillRect((h.pos.x / CELL) * cs - 2, (h.pos.z / CELL) * cs - 2, 4, 4);
      mmCtx.fillStyle = h.panic ? '#ff0000' : '#000';
      mmCtx.fillRect((h.pos.x / CELL) * cs - 2, (h.pos.z / CELL) * cs - 4, 4 * Math.min(1, h.stress), 1.5);
    }
    // celdas descubiertas (tenue)
    mmCtx.fillStyle = 'rgba(255,255,255,0.06)';
    for (const k of BB.discovered) { const [gx, gz] = AIB.parseKey(k); mmCtx.fillRect(gx * cs, gz * cs, cs, cs); }
    mmCtx.fillStyle = '#fff'; mmCtx.font = '9px monospace';
    mmCtx.fillText(ritual.phase + ' ' + RIT.depositedCount(ritual) + '/' + ritual.objects.length, 2, MM - 3);
  }
}

// ============================================================
//  Movimiento + atmósfera (un solo piso)
// ============================================================
function applyAtmosphere() {
  const lit = hunt.active <= 0;
  if (lit) {
    ambient.color.setHex(0xb6a06a); ambient.intensity = 0.34;
    hemi.color.setHex(0xb0a06a); hemi.groundColor.setHex(0x191406); hemi.intensity = 0.28;
    scene.fog.color.setHex(0x1c1808); scene.background.setHex(0x1c1808);
  } else {
    // "El otro lado": penumbra fría — los humanos no ven nada; tú ves siluetas.
    const flicker = Math.sin(performance.now() * 0.025) > 0.6 ? 0.0 : 0.05; // parpadeo por tiempo (no por frame)
    ambient.color.setHex(0x8fb3a6); ambient.intensity = flicker;
    hemi.color.setHex(0x4a6a60); hemi.groundColor.setHex(0x0a0f0c); hemi.intensity = 0.22;
    scene.fog.color.setHex(0x05080a); scene.background.setHex(0x05080a);
  }
}
function moveGhost(dt) {
  ghostMoving = false;
  if (moriT > 0) return; // clavado durante la ejecución
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(fwd); if (keys['KeyS']) move.sub(fwd); if (keys['KeyD']) move.add(right); if (keys['KeyA']) move.sub(right);
  if (move.lengthSq() > 0) {
    ghostMoving = true;
    move.normalize().multiplyScalar(SPEED * (hunt.active > 0 ? ABL.AB.HUNT_SPEED_MULT : 1) * (stun > 0 ? STUN_SLOW : 1) * dt);
    if (!collidesPlayer(pos.x + move.x, pos.z)) pos.x += move.x;
    if (!collidesPlayer(pos.x, pos.z + move.z)) pos.z += move.z;
  }
  const h = groundHeight();
  currentFloor = 0;
  pos.y = h + EYE; camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0);
  aura.position.set(pos.x, h + EYE, pos.z);
  aura.intensity = hunt.active > 0 ? 1.7 : 0.12; // invisible (tenue) en normal; en cacería te alumbra el paso
  // Viento espectral ligado a tu movimiento (el fantasma fluye, no pisa).
  if (windGain) windGain.gain.setTargetAtTime(ghostMoving ? (hunt.active > 0 ? 0.03 : 0.02) : 0.0001, actx.currentTime, 0.25);
}

// Avatar de la entidad: en normal/cacería acecha JUSTO detrás de la cámara
// (mirando hacia donde miras: lo atisbas al girar) y en el Memento Mori se
// abalanza de frente con el JUMPSCARE. scareForce permite forzarlo (dbg).
let scareForce = 0, avatarInspect = false, avFrames = 0;
function updateGhostAvatar(dt, hunting) {
  if (!ghostAvatar) return;
  avFrames++;
  ghostAvatar.update(dt);
  if (scareForce > 0) scareForce -= dt;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  if (avatarInspect) {   // dbg: plantado de frente y posado (para verificación en GPU)
    ghostAvatar.setPose(pos.x + fwd.x * 4, 0, pos.z + fwd.z * 4, Math.atan2(-fwd.x, -fwd.z) + AVATAR_FACE);
    ghostAvatar.play('stalkingpose');
    return;
  }
  if (moriT > 0 || scareForce > 0) {
    const ax = pos.x + fwd.x * 2.3, az = pos.z + fwd.z * 2.3;        // delante de ti…
    ghostAvatar.setPose(ax, 0, az, Math.atan2(-fwd.x, -fwd.z) + AVATAR_FACE);  // …de cara
    if (ghostAvatar.hasClip('JUMPSCARE')) ghostAvatar.play('JUMPSCARE', { loop: false });
  } else {
    const ax = pos.x - fwd.x * 0.95, az = pos.z - fwd.z * 0.95;       // tras la cámara
    ghostAvatar.setPose(ax, 0, az, Math.atan2(fwd.x, fwd.z) + AVATAR_FACE);
    ghostAvatar.play(hunting && ghostAvatar.hasClip('chaseSceneEnd') ? 'chaseSceneEnd' : 'stalkingpose');
  }
}

// Predicado de celda abierta para la IA (grid de IA, no el fino de colisión).
const isOpenCell = (gx, gz) => !isWall(gx, gz);

function updateBlackboard(dt) {
  for (const h of hunters) {
    if (!h.alive) continue;
    const [gx, gz] = cellOf(h.pos.x, h.pos.z);
    AIB.discoverAround(BB, gx, gz, VISION_R, isOpenCell);
  }
  // (Objetos rituales + altar son CONOCIDOS desde el inicio: la IA los persigue
  // directamente; la niebla solo rige peligro y exploración general.)
  AIB.decayDanger(BB, dt);
}

// Centro del mapa en celdas (para dividir alas de exploración).
const MID_X = () => Math.floor(COLS / 2);
// Estado por-frame compartido por la IA (se calcula una vez en update()).
let FRONTIER = [];                       // frontera de exploración (1× por frame)
let lastGhostGX = -1, lastGhostGZ = -1;  // celda del fantasma para throttle de dispersión
let NOW_SEC = 0;                         // performance.now()/1000 muestreado 1× por frame

// Corre el coordinador cada COORD_PERIOD s: amenaza -> reparto de roles de fase.
function runCoordinator(dt, hunting) {
  coordTimer -= dt;
  if (coordTimer > 0) return;
  coordTimer = COORD_PERIOD;
  const aliveList = hunters.filter((h) => h.alive);
  const avgFear = aliveList.length ? aliveList.reduce((s, h) => s + h.fear, 0) / aliveList.length : 0;
  const deaths = hunters.filter((h) => !h.alive).length;
  // GAME.timeLeft es CUENTA ATRÁS: un evento reciente tiene e.t algo mayor que el
  // tiempo actual, así que "reciente" = (e.t - GAME.timeLeft) pequeño.
  const recentEvents = BB.events.filter((e) => e.t - GAME.timeLeft < 5).length;
  BB.events = BB.events.filter((e) => e.t - GAME.timeLeft < 30); // poda eventos viejos
  const threat = AIB.computeThreat({ hunting, recentEvents, deaths, avgFear });
  const roles = RIT.assignRitualRoles(
    hunters.map((h) => { const [gx, gz] = cellOf(h.pos.x, h.pos.z); return { id: h.id, alive: h.alive, ko: !!h.ko, bravery: h.bravery, gx, gz }; }),
    ritual, threat, { koIds: hunters.filter((h) => h.alive && h.ko).map((h) => h.id) }
  );
  for (const h of hunters) if (roles.has(h.id)) h.role = roles.get(h.id);
}

// Construye celdas candidatas {gx,gz,bias} según el rol del agente.
function buildCandidates(h) {
  const frontier = FRONTIER;   // calculado 1× por frame en update()
  const midx = MID_X();
  const near = (cell) => -(Math.abs(cell.gx - cellOf(h.pos.x, h.pos.z)[0]) + Math.abs(cell.gz - cellOf(h.pos.x, h.pos.z)[1]));
  let cands = [];
  switch (h.role) {
    case RIT.RROLE.EXPLORE_A:
    case RIT.RROLE.EXPLORE_B: {
      const wantLeft = h.role === RIT.RROLE.EXPLORE_A;
      cands = frontier.filter(([gx]) => (wantLeft ? gx < midx : gx >= midx)).map(([gx, gz]) => ({ gx, gz, bias: AIB.AI.W_CURIOSITY * h.bravery }));
      if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: AIB.AI.W_CURIOSITY * h.bravery }));
      break;
    }
    case RIT.RROLE.FETCH: {
      const carried = RIT.objectCarriedBy(ritual, h.id);
      if (carried) { cands = [{ gx: ritual.altar.gx, gz: ritual.altar.gz, bias: 5 }]; }
      else {
        // objeto suelto sin portador (conocidos desde el inicio), el más cercano
        cands = ritual.objects
          .filter((o) => o.status === RIT.OBJ.ON_MAP)
          .map((o) => ({ gx: o.gx, gz: o.gz, bias: 4 }));
        if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 })); // sin objetos sueltos -> explora
      }
      break;
    }
    case RIT.RROLE.CHANNELER:
    case RIT.RROLE.GUARD:
      cands = [{ gx: ritual.altar.gx, gz: ritual.altar.gz, bias: 5 }];
      break;
    case RIT.RROLE.DEFEND: {
      // celda entre el fantasma y el altar (un paso desde el altar hacia el fantasma)
      const [ggx, ggz] = cellOf(pos.x, pos.z);
      const dx = Math.sign(ggx - ritual.altar.gx), dz = Math.sign(ggz - ritual.altar.gz);
      cands = [{ gx: ritual.altar.gx + dx, gz: ritual.altar.gz + dz, bias: 3 }, { gx: ritual.altar.gx, gz: ritual.altar.gz, bias: 1 }];
      break;
    }
    case RIT.RROLE.DISTRACT: {
      const [ggx, ggz] = cellOf(pos.x, pos.z);
      cands = [{ gx: ggx, gz: ggz, bias: 3 }];
      break;
    }
    case RIT.RROLE.REPAIR: {
      const inc = ritual.missions.filter((m) => !m.done).map((m) => ({ gx: m.gx, gz: m.gz, bias: 4 }));
      cands = inc.length ? inc : [{ gx: ritual.altar.gx, gz: ritual.altar.gz, bias: 1 }];
      break;
    }
    case RIT.RROLE.RESCUER: {
      const k = hunters.find((x) => x.alive && x.ko);
      if (k) { const [kgx, kgz] = cellOf(k.pos.x, k.pos.z); cands = [{ gx: kgx, gz: kgz, bias: 6 }]; }
      else cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 }));
      break;
    }
    case RIT.RROLE.SCOUT: {
      // patrulla rotando entre las estaciones de misión (o el altar si no hay)
      const sites = ritual.missions.length ? ritual.missions : [{ gx: ritual.altar.gx, gz: ritual.altar.gz }];
      const s = sites[Math.floor((performance.now() / 8000) % sites.length)];
      cands = [{ gx: s.gx, gz: s.gz, bias: 2 }];
      break;
    }
    default:
      cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 }));
  }
  // Prioriza por cercanía para no recalcular rutas larguísimas cada vez.
  return cands.sort((a, b) => near(b) - near(a)).slice(0, 12);
}

// Aliados cercanos (para cohesión), en celdas.
function alliesOf(h) {
  return hunters
    .filter((o) => o.alive && o !== h)
    .map((o) => { const [gx, gz] = cellOf(o.pos.x, o.pos.z); return { gx, gz }; });
}

// Guarda las últimas celdas pisadas (ventana corta) para penalizar repetir ruta.
function pushRecent(h) {
  const k = AIB.cellKey(...cellOf(h.pos.x, h.pos.z));
  if (h.recentCells[h.recentCells.length - 1] !== k) {
    h.recentCells.push(k);
    if (h.recentCells.length > 8) h.recentCells.shift();
  }
}

const trapMeshes = [];   // [{gx, gz, mesh, inner, outer}]
let decoyMesh = null;    // malla del señuelo activo
let decoyLight = null;   // luz del señuelo (vive y muere con la malla)
function spawnTrapMesh(gx, gz) {
  const [wx, wz] = worldOf(gx, gz);
  // Sello ritual: aro exterior fino + hexagrama interior que rota en sentido
  // contrario; el grupo gira y pulsa en update() (los muertos se limpian allí).
  const group = new THREE.Group();
  const R = ABL.AB.TRAP_RADIUS * CELL;
  const mat = (op) => new THREE.MeshBasicMaterial({ color: 0x9d4edd, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const outer = new THREE.Mesh(new THREE.RingGeometry(R - 0.07, R, 40), mat(0.5));
  const inner = new THREE.Mesh(new THREE.RingGeometry(R * 0.35, R * 0.52, 6), mat(0.4));
  outer.rotation.x = inner.rotation.x = -Math.PI / 2;
  group.add(outer); group.add(inner);
  group.position.set(wx, 0.06, wz);
  scene.add(group); trapMeshes.push({ gx, gz, mesh: group, inner, outer });
}

function useTeleport() {
  if (stun > 0 || moriT > 0) return;
  if (!ABL.canActivate(ab, ABL.KEY.TELEPORT)) return;
  const [gx, gz] = aimCell(ABL.AB.TELEPORT_RANGE);
  const [cgx, cgz] = cellOf(pos.x, pos.z);
  if (gx === cgx && gz === cgz) return; // miras a un muro pegado: no malgastes la habilidad
  ABL.activate(ab, ABL.KEY.TELEPORT, [gx, gz]);
  bursts.spawn(pos.x, EYE * 0.7, pos.z, { color: 0x9d4edd, count: 20, speed: 1.4, up: 1.0 });   // estela al partir
  const [wx, wz] = worldOf(gx, gz); pos.x = wx; pos.z = wz;
  post.flash(0.22); feel.kick(4);
  for (const h of hunters) h.next = null; // sus rutas hacia tu antigua posición caducan
  tone({ type: 'sine', f0: 600, f1: 120, dur: 0.35, vol: 0.4 });
}
function useTrap() {
  if (stun > 0 || moriT > 0) return;
  const [gx, gz] = cellOf(pos.x, pos.z);
  if (ABL.activate(ab, ABL.KEY.TRAP, [gx, gz])) { AIB.addEvent(BB, 'trap', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER); spawnTrapMesh(gx, gz); }
}
function useDecoy() {
  if (stun > 0 || moriT > 0) return;
  const [gx, gz] = aimCell(ABL.AB.TELEPORT_RANGE);
  const [cgx, cgz] = cellOf(pos.x, pos.z);
  if (gx === cgx && gz === cgz) return; // sin sitio a la vista donde proyectar el señuelo
  if (ABL.activate(ab, ABL.KEY.DECOY, [gx, gz])) { AIB.addEvent(BB, 'apparition', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER); tone({ type: 'triangle', f0: 320, f1: 180, dur: 0.6, vol: 0.35 }); }
}
function useSpectral() { if (stun > 0 || moriT > 0) return; ABL.activate(ab, ABL.KEY.SPECTRAL, null, { hunting: hunt.active > 0 }); }
function tryStartHunt() { if (stun > 0 || moriT > 0) return; if (hunt.active <= 0 && ABL.huntReady(ab)) { ABL.spendForHunt(ab); startHunt(); } }

// Memento Mori: ejecucion de un KO a quemarropa (no parryable; te deja clavado ~2s).
function tryMori() {
  if (stun > 0 || moriT > 0) return;
  for (const h of hunters) {
    if (!h.alive || !h.ko) continue;
    if (Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) <= MORI_RANGE) { moriT = MORI_TIME; moriTarget = h; sfx.mori(); return; }
  }
}

// Celda transitable a la que mira el fantasma: marcha hacia delante (yaw) hasta
// `maxCells` o hasta toparse con muro; devuelve la última celda abierta.
function aimCell(maxCells) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let last = cellOf(pos.x, pos.z);
  for (let s = 1; s <= maxCells; s++) {
    const wx = pos.x + fx * s * CELL, wz = pos.z + fz * s * CELL;
    const [gx, gz] = cellOf(wx, wz);
    if (isWall(gx, gz)) break;
    last = [gx, gz];
  }
  return last;
}

// ============================================================
//  Bucle
// ============================================================
function update(dt) {
  if (GAME.state !== 'playing') return;
  GAME.timeLeft -= dt;
  if (GAME.timeLeft <= 0 && !escalated) { escalated = true; GAME.timeLeft = 0; if (hunt.active <= 0) startHunt(); }
  NOW_SEC = performance.now() / 1000;   // reloj monótono muestreado 1× por frame
  if (stun > 0) stun = Math.max(0, stun - dt);
  if (moriT > 0 && moriTarget) {   // ejecución en curso: cancela si el KO se va o te alejas
    if (!moriTarget.ko || !moriTarget.alive || Math.hypot(moriTarget.pos.x - pos.x, moriTarget.pos.z - pos.z) > MORI_RANGE + 0.6) { moriT = 0; moriTarget = null; }
    else { moriT -= dt; if (moriT <= 0) { moriTarget.ko = false; killHunter(moriTarget); moriTarget = null; moriT = 0; } }
  }
  const hunting = updateHunt(dt);
  // Energía: gana con el tiempo + bonus si hay un superviviente cerca (acecho).
  let nearSurvivor = false;
  for (const h of hunters) { if (h.alive && Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) < ABL.AB.SENSE_RANGE) { nearSurvivor = true; break; } }
  const energyBefore = ab.energy;
  ABL.tickEnergy(ab, dt, { nearSurvivor }); // cooldowns y visión espectral siguen corriendo en cacería
  if (hunting) ab.energy = energyBefore;     // solo se congela la energía (no encadenar cacerías)
  // Observación: sube si el objetivo está vivo, a rango, con LOS y en el cono de visión.
  {
    const t = hunters.find((x) => x.id === ab.observe.target);
    let visible = false;
    if (t && t.alive && !t.ko) {
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
      if (d <= ABL.AB.OBS_RANGE && gridLOS(pos.x, pos.z, t.pos.x, t.pos.z)) {
        const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const to = new THREE.Vector3(t.pos.x - pos.x, 0, t.pos.z - pos.z).normalize();
        visible = to.dot(fwd) > 0.5; // cono ~60°
      }
    }
    ABL.tickObserve(ab, dt, { visible });
    for (const h of hunters) if (h.alive) h.model.setMarked(ABL.isMarked(ab, h.id));
  }
  if (senseGain) {
    let dmin = Infinity;
    for (const h of hunters) if (h.alive) dmin = Math.min(dmin, Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z));
    const prox = hunting ? 0 : Math.max(0, 1 - dmin / ABL.AB.SENSE_RANGE); // 0..1, silenciado en cacería
    senseGain.gain.setTargetAtTime(0.0001 + prox * 0.25, actx.currentTime, 0.1);
  }
  updateBlackboard(dt);
  runCoordinator(dt, hunting);
  FRONTIER = AIB.computeFrontier(BB, isOpenCell);   // 1× por frame (lo leen los 8 agentes)
  // En cacería, reparte celdas de escape distintas (lejos del fantasma).
  // Recalcula solo cuando el fantasma cambia de celda (no cada frame).
  if (hunting) {
    const [ggx, ggz] = cellOf(pos.x, pos.z);
    if (!DISPERSAL || ggx !== lastGhostGX || ggz !== lastGhostGZ) {
      lastGhostGX = ggx; lastGhostGZ = ggz;
      const aliveAgents = hunters.filter((h) => h.alive).map((h) => { const [gx, gz] = cellOf(h.pos.x, h.pos.z); return { id: h.id, gx, gz }; });
      const safe = REACH.list
        .filter(([gx, gz]) => (Math.abs(gx - ggx) + Math.abs(gz - ggz)) > 6)
        .map(([gx, gz]) => ({ gx, gz }));
      DISPERSAL = AIB.dispersalTargets(aliveAgents, { gx: ggx, gz: ggz }, safe, AIB.AI);
    }
  } else {
    DISPERSAL = null; lastGhostGX = -1; lastGhostGZ = -1;
  }
  moveGhost(dt);
  applyAtmosphere();
  // Presentación (R7): cámara, luces diegéticas, partículas, postpro, audio reactivo.
  feel.update(dt, NOW_SEC, { moving: ghostMoving, hunting });
  ceiling.update(dt, NOW_SEC, hunting);
  torches.update(hunters, pos, hunting, NOW_SEC);
  updateGhostAvatar(dt, hunting);
  dust.update(dt, pos);
  bursts.update(dt);
  post.set('hunt', hunting ? 1 : 0);
  post.set('stun', stun > 0 ? 1 : 0);
  post.set('mori', moriT > 0 ? 1 : 0);
  document.body.classList.toggle('hunting', hunting);
  if (actx) {
    // Latido: en cacería, más rápido cuanto más cerca está la presa más próxima.
    let dmin = Infinity;
    for (const h of hunters) if (h.alive) dmin = Math.min(dmin, Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z));
    const prox = hunting ? Math.max(0, 1 - dmin / 14) : 0;
    if (prox > 0) { heartT -= dt; if (heartT <= 0) { heartbeat(); heartT = heartbeatInterval(prox); } }
    else heartT = 0;
    // Susurros aleatorios fuera de cacería: los Backrooms nunca callan del todo.
    if (!hunting) { whisperT -= dt; if (whisperT <= 0) { whisper(); whisperT = 16 + Math.random() * 22; } }
  }
  for (const h of hunters) updateHunter(h, dt, pos, hunting, currentFloor === 0);
  // Canalización: cuenta canalizadores en rango del altar; interrumpe si el
  // fantasma ruge cerca del altar durante la fase. En cacería el ritual se pausa.
  if (ritual.phase === RIT.PHASE.CHANNEL && !hunting) {
    const [ax, az] = worldOf(ritual.altar.gx, ritual.altar.gz);
    let nCh = 0;
    for (const h of hunters) if (h.alive && !h.ko && Math.hypot(h.pos.x - ax, h.pos.z - az) <= RIT.RCFG.ALTAR_RANGE + 0.6) nCh++;
    const ghostNear = Math.hypot(pos.x - ax, pos.z - az) <= RIT.RCFG.ALTAR_RANGE + 1.5 && hunt.active > 0; // sin rugido: interrumpe la cacería junto al altar
    RIT.channelTick(ritual, nCh, dt, { interrupt: ghostNear });
  }
  syncRitualMeshes();
  // Trampas: anima el sello (giro + pulso) y quita las que caducaron en el estado puro.
  for (let i = trapMeshes.length - 1; i >= 0; i--) {
    const tm = trapMeshes[i];
    if (!ab.traps.some((t) => t.gx === tm.gx && t.gz === tm.gz)) {
      scene.remove(tm.mesh);
      tm.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      trapMeshes.splice(i, 1);
      continue;
    }
    tm.mesh.rotation.y += dt * 0.7;
    tm.inner.rotation.z -= dt * 1.6;   // el hexagrama contrarrota
    const pulse = 0.35 + 0.2 * Math.sin(NOW_SEC * 3.5);
    tm.outer.material.opacity = pulse + 0.15;
    tm.inner.material.opacity = pulse;
  }
  // Señuelo (Aparición): wisp con luz propia; atrae y asusta a los cercanos.
  if (ab.decoy) {
    const [dwx, dwz] = worldOf(ab.decoy.gx, ab.decoy.gz);
    if (!decoyMesh) {
      decoyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), new THREE.MeshBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      decoyLight = new THREE.PointLight(0xc77dff, 5, 8, 2.0);
      scene.add(decoyMesh); scene.add(decoyLight);
    }
    const throb = 0.4 + 0.3 * Math.sin(performance.now() * 0.01);
    decoyMesh.position.set(dwx, EYE + Math.sin(NOW_SEC * 1.7) * 0.15, dwz);   // levita
    decoyMesh.material.opacity = throb;
    decoyLight.position.copy(decoyMesh.position);
    decoyLight.intensity = 3 + 3.5 * throb;
    for (const h of hunters) {
      if (!h.alive) continue;
      if (Math.hypot(h.pos.x - dwx, h.pos.z - dwz) < ABL.AB.SENSE_RANGE) { h.stress = Math.min(1, h.stress + 0.3 * dt); h.next = null; }
    }
  } else if (decoyMesh) { scene.remove(decoyMesh); scene.remove(decoyLight); decoyMesh.geometry.dispose(); decoyMesh.material.dispose(); decoyMesh = null; decoyLight = null; }
  // Visión espectral: revela a los supervivientes a través de muros solo mientras
  // dure la habilidad (que solo se activa en cacería).
  const seeThrough = ab.spectral > 0;
  for (const h of hunters) if (h.alive) h.model.setSpectral(seeThrough);
  updateHUD(hunting); drawMinimap(); checkEnd();
}
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  update(dt);
  post.update(dt, now / 1000);
  post.render();
  requestAnimationFrame(loop);
}

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight); });

// ============================================================
//  Arranque: preload -> colocar entorno -> hornear MAP -> mundo
// ============================================================
async function boot() {
  const startBtn = document.getElementById('startBtn');
  let assets;
  try {
    assets = await loadAllAssets(NUM_HUNTERS, (f) => { startBtn.textContent = 'CARGANDO… ' + Math.round(f * 100) + '%'; });
  } catch (e) {
    console.error('Fallo al cargar assets, usando entorno procedural de respaldo:', e);
  }
  if (assets && assets.env) {
    const info = placeEnv(scene, assets.env);
    const baked = bakeGrid(info.wallMeshes, info.width, info.depth, CELL, info.ceilY);
    MAP = baked.map; ROWS = baked.rows; COLS = baked.cols;
    console.log('BAKE cols', baked.cols, 'rows', baked.rows, 'walls', baked.walls, 'open', baked.open);
    // Grid fino de colisión del jugador (mismas mallas de muro, celda menor).
    const col = bakeGrid(info.wallMeshes, info.width, info.depth, CELL_COL, info.ceilY);
    COL_MAP = col.map; COL_COLS = col.cols; COL_ROWS = col.rows; COL_CELL = CELL_COL;
    console.log('BAKE col cols', col.cols, 'rows', col.rows, 'walls', col.walls, 'open', col.open);
  }
  const [ox, oz] = firstOpenCell();
  REACH = floodReachable(ox, oz);
  BB = AIB.createBlackboard();
  console.log('REACH celdas transitables:', REACH.list.length);
  const [sx, sz] = clearSpawnCell();
  pos.set(sx * CELL, EYE, sz * CELL);
  // Primer fotograma: mira hacia el interior del mapa, no a la pared del rincón.
  const cxw = ((COLS - 1) * CELL) / 2, czw = ((ROWS - 1) * CELL) / 2;
  yaw = Math.atan2(-(cxw - pos.x), -(czw - pos.z));

  // Paneles fluorescentes del techo + narrativa ambiental del suelo (R7).
  ceiling = buildCeilingLights(scene, { map: MAP, cols: COLS, rows: ROWS, cell: CELL, ceilY: TARGET_CEIL });
  dressFloor(scene, REACH.list, CELL);

  rebuildMinimap();
  makeRitual(assets);
  torches.setModel(assets && assets.flashlight);   // linterna GLB en la mano (si cargó)
  ghostAvatar = createGhostAvatar(scene, assets && assets.monster);   // forma visible de la entidad
  makeHunters(assets && assets.chars);
  startBtn.textContent = 'CLICK PARA JUGAR';
  startBtn.disabled = false;

  // Hook de depuración/verificación visual (solo con #dbg en la URL).
  if (location.hash.includes('dbg')) {
    window.__dbg = {
      hide() { overlay.classList.add('hidden'); hud.classList.remove('hidden'); },
      hunt() { startHunt(); },
      endHunt() { endHunt(); },
      tp(x, z) { pos.x = x; pos.z = z; },
      look(y, p) { yaw = y; pitch = p; },
      nearHunter(i = 0) {   // enfoca el torso del bot i desde el lado abierto (no contra el muro)
        const h = hunters[i]; if (!h) return;
        this.lookAt(h.pos.x, 1.3, h.pos.z, 2.2);
      },
      lookAt(tx, ty, tz, dist = 2.4) {   // mira un punto del mundo desde el lado del CENTRO (los props miran al centro)
        const cxw = ((COLS - 1) * CELL) / 2, czw = ((ROWS - 1) * CELL) / 2;
        let ox = cxw - tx, oz = czw - tz; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
        pos.x = tx + ox * dist; pos.z = tz + oz * dist; pos.y = EYE;
        const dx = tx - pos.x, dz = tz - pos.z, dy = (ty || 0.7) - pos.y;
        yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz));
      },
      altar() { const [x, z] = worldOf(ritual.altar.gx, ritual.altar.gz); this.lookAt(x, 0.8, z, 2.2); },
      mission(i = 0) { const m = ritual.missions[i]; if (!m) return; const [x, z] = worldOf(m.gx, m.gz); this.lookAt(x, 0.7, z, 1.8); },
      cross(i = 0) { const o = ritual.objects[i]; if (!o) return; const [x, z] = worldOf(o.gx, o.gz); this.lookAt(x, 0.4, z, 1.3); },
      scare() { scareForce = 2.5; },          // fuerza el JUMPSCARE del avatar de frente
      turn() { yaw += Math.PI; },             // gira 180° (para ver al acechador a tu espalda)
      avatarInfo() { if (!ghostAvatar) return 'NULL'; const b = new THREE.Box3().setFromObject(ghostAvatar.group); const sz = b.getSize(new THREE.Vector3()); return { meshes: ghostAvatar.meshCount, clips: ghostAvatar.clipNames, p: ghostAvatar.group.position.toArray().map((v) => +v.toFixed(2)), cam: [+pos.x.toFixed(2), +pos.z.toFixed(2)], frames: avFrames, size: sz.toArray().map((v) => +v.toFixed(2)) }; },
      inspect() { avatarInspect = !avatarInspect; return avatarInspect; },
      state() { return { x: pos.x, z: pos.z, hunters: hunters.filter((h) => h.alive).length, hunting: hunt.active > 0 }; },
    };
  }
  requestAnimationFrame(loop);
}
boot();
