// ============================================================
//  GHOST HUNTERS: REVERSED — Backrooms (nivel GLB, 1 piso)
//  El nivel es un modelo GLB; el MAP de colisión/IA se HORNEA
//  desde su geometría (raycast por celda) y reutiliza la lógica
//  existente (BFS, estaciones, minimapa, cacería).
//  Cacería: las luces mueren y cazas en la oscuridad.
// ============================================================
import * as THREE from 'three';
import { loadAllAssets } from './assets.js';
import { placeEnv } from './env.js';
import { bakeGrid } from './grid.js';
import { collidesBoxGrid } from './logic.js';
import { HunterModel } from './hunters.js';
import * as AIB from './ai.js';

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
const NUM_STATIONS = 4;
const MISSION_TIME = 18;
const HUNTER_SPEED = 2.8;
const HUNTER_FLEE_SPEED = 3.6;

const HUNT_EVERY = 40;
const HUNT_DUR = 12;
const KILL_RANGE = 1.8;

const SCARE_RANGE = 6;
const SCARE_FLEE = 4;
const ROAR_CD = 8;
const REVEAL_DUR = 5;

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
renderer.domElement.id = 'game-canvas';
document.body.appendChild(renderer.domElement);
const canvasEl = renderer.domElement;

const ambient = new THREE.AmbientLight(0xbda86a, 0.85);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0xbda86a, 0x191406, 0.5);
scene.add(hemi);
const aura = new THREE.PointLight(0x9d4edd, 0.8, 10, 1.8);
scene.add(aura);

// makeCanvas: usado por el minimapa.
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// ============================================================
//  Audio (sintetizado) + música opcional en bucle
// ============================================================
let actx = null, master = null, musicEl = null;
function initAudio() { if (actx) return; actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = 0.6; master.connect(actx.destination); }
function startMusic() { if (musicEl) return; musicEl = new Audio('assets/music/track.mp3'); musicEl.loop = true; musicEl.volume = 0.5; musicEl.play().catch(() => {}); }
function duckMusic(down) { if (musicEl) musicEl.volume = down ? 0.12 : 0.5; }
function tone({ type = 'sine', f0, f1, dur, vol = 0.3 }) {
  if (!actx) return; const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
const sfx = {
  roar() { tone({ type: 'sawtooth', f0: 72, f1: 40, dur: 1.3, vol: 0.55 }); tone({ type: 'square', f0: 98, f1: 52, dur: 1.3, vol: 0.3 }); },
  kill() { tone({ type: 'sine', f0: 170, f1: 38, dur: 0.45, vol: 0.45 }); },
  win() { tone({ type: 'triangle', f0: 440, f1: 880, dur: 0.5, vol: 0.4 }); },
  lose() { tone({ type: 'sawtooth', f0: 300, f1: 70, dur: 0.85, vol: 0.4 }); },
};

// ============================================================
//  Estaciones de misión
// ============================================================
const stations = [];
const TV_HEIGHT = 0.95;   // alto objetivo del monitor en el suelo (unidades de mundo)
// Cada estación es un MONITOR: arranca ENCENDIDO (pantalla con brillo emissive) y
// los investigadores lo van APAGANDO (progress 0->1). Apagado = pantalla sin brillo.
function makeStations(tvGltf) {
  const cells = spreadCells(NUM_STATIONS + 1, (x, z) => (x <= 5 && z <= 7)).slice(1, NUM_STATIONS + 1);
  const fallbackGeo = new THREE.CylinderGeometry(0.4, 0.55, 1.3, 10);
  for (const [gx, gz] of cells) {
    const [wx, wz] = worldOf(gx, gz);
    let mesh, mat;
    if (tvGltf) {
      mesh = tvGltf.scene.clone(true);
      // La pantalla mira a +Z local: orientarla hacia el centro de la sala para
      // que el brillo se vea desde el área jugable.
      const cxw = ((COLS - 1) * CELL) / 2, czw = ((ROWS - 1) * CELL) / 2;
      mesh.rotation.y = Math.atan2(cxw - wx, czw - wz);
      // Escalar a TV_HEIGHT midiendo la caja real (los nodos del GLB ya escalan).
      mesh.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(mesh);
      mesh.scale.setScalar(TV_HEIGHT / Math.max(1e-3, box.max.y - box.min.y));
      mesh.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(mesh);
      // Centrar en XZ sobre la celda y apoyar la base en el suelo (y=0).
      mesh.position.set(wx - (box.min.x + box.max.x) / 2, -box.min.y, wz - (box.min.z + box.max.z) / 2);
      // Material propio por TV (clon) para apagarla sin afectar a las demás.
      let base = null;
      mesh.traverse((o) => { if (o.isMesh && o.material && !base) base = Array.isArray(o.material) ? o.material[0] : o.material; });
      mat = base ? base.clone() : new THREE.MeshStandardMaterial({ emissive: 0x9fe8ff, emissiveIntensity: 1 });
      mat.emissiveIntensity = 1;
      mesh.traverse((o) => { if (o.isMesh) o.material = mat; });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: 0x222244, emissive: 0x9fe8ff, emissiveIntensity: 1, roughness: 0.5 });
      mesh = new THREE.Mesh(fallbackGeo, mat); mesh.position.set(wx, 0.65, wz);
    }
    scene.add(mesh);
    stations.push({ gx, gz, wx, wz, progress: 0, done: false, mesh, mat });
  }
}
// Apagado (done) = sin brillo. El parpadeo de "encendido" lo aplica updateStations().
function refreshStation(s) { if (s.mat && s.done) s.mat.emissiveIntensity = 0; }
// Parpadeo de monitor encendido; el brillo baja conforme se va apagando (progress).
function updateStations() {
  for (const s of stations) {
    if (s.done || !s.mat) continue;
    s.mat.emissiveIntensity = (1 - 0.8 * s.progress) * (0.8 + 0.2 * Math.random());
  }
}
const nearestIncompleteStation = (x, z) => { let best = -1, bd = Infinity; stations.forEach((s, i) => { if (s.done) return; const d = (s.wx - x) ** 2 + (s.wz - z) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };

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
    hunters.push({
      id: i, pos: new THREE.Vector3(wx, 0, wz), model, alive: true,
      flee: 0, repath: 0, next: null, working: -1,
      // --- estado IA ---
      bravery: 0.2 + Math.random() * 0.7,   // personalidad fija
      stress: 0, sanity: 1, fear: 0, panic: false,
      role: AIB.ROLES.EXPLORE_A, recentCells: [], lastBarkT: -999, goal: null,
    });
  }
}
function farthestCell(x, z) { let best = null, bd = -1; for (const [gx, gz] of REACH.list) { const [wx, wz] = worldOf(gx, gz); const d = (wx - x) ** 2 + (wz - z) ** 2; if (d > bd) { bd = d; best = [gx, gz]; } } return best; }
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
  if (h.flee > 0) h.flee -= dt;
  {
    const r = AIB.updateFear(h, fearCtx(h, ghost, hunting), dt);
    h.stress = r.stress; h.sanity = r.sanity; h.fear = r.fear; h.panic = r.panic;
  }
  const prevX = h.pos.x, prevZ = h.pos.z;
  if (hunting) {
    h.working = -1;
    const dest = DISPERSAL && DISPERSAL.get(h.id);
    stepToward(h, dest || farthestCell(ghost.x, ghost.z), HUNTER_FLEE_SPEED, dt);
    if (ghostOnFloor0 && Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z) < KILL_RANGE) { killHunter(h); return; }
  } else if (h.flee > 0) {
    h.working = -1; stepToward(h, farthestCell(ghost.x, ghost.z), HUNTER_FLEE_SPEED, dt);
  } else if (h.panic) {
    // PÁNICO: no progresa objetivos; huye lejos del fantasma de forma errática.
    h.working = -1;
    const away = farthestCell(ghost.x, ghost.z);
    const jitter = [away[0] + (Math.random() < 0.5 ? 1 : -1), away[1] + (Math.random() < 0.5 ? 1 : -1)];
    stepToward(h, isOpenCell(jitter[0], jitter[1]) ? jitter : away, HUNTER_FLEE_SPEED, dt);
    pushRecent(h);
  } else {
    // Objetivo decidido por la IA (coordinador + utilidad). Si la meta es una
    // estación descubierta y estamos encima, trabajamos; si no, caminamos a la meta.
    const cands = buildCandidates(h);
    const newGoal = AIB.chooseGoal(h, cands, BB, alliesOf(h), AIB.AI);
    // Si la meta cambia, invalida el waypoint BFS para no seguir 0.35s la ruta vieja.
    if (!h.goal || !newGoal || newGoal[0] !== h.goal[0] || newGoal[1] !== h.goal[1]) h.next = null;
    h.goal = newGoal;
    const onObj = nearestIncompleteStation(h.pos.x, h.pos.z);
    if (onObj >= 0 && BB.objectives.has(AIB.cellKey(stations[onObj].gx, stations[onObj].gz))
        && Math.hypot(stations[onObj].wx - h.pos.x, stations[onObj].wz - h.pos.z) < 0.9) {
      h.working = onObj;
      const s = stations[onObj];
      s.progress = Math.min(1, s.progress + dt / MISSION_TIME);
      if (s.progress >= 1) s.done = true;
      refreshStation(s);
    } else {
      h.working = -1;
      if (h.goal) stepToward(h, h.goal, HUNTER_SPEED, dt);
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
  else if (h.role === AIB.ROLES.REGROUP) trig = 'regroup';
  if (trig) {
    const b = AIB.barkFor(h, trig, NOW_SEC, AIB.AI);
    if (b) { h.lastBarkT = b.t; h.model.showBark(b.text); if (h.fear > 0.5) h.model.glanceBack(); }
  }
  h.model.update(dt);
}
function killHunter(h) { h.alive = false; { const [gx, gz] = cellOf(h.pos.x, h.pos.z); AIB.addEvent(BB, 'death', gx, gz, GAME.timeLeft, AIB.AI.DEATH_DANGER); } h.model.setSpectral(false); h.model.play('Death'); h.model.update(0); sfx.kill(); checkEnd(); }

// ============================================================
//  Estado del jugador (un solo piso)
// ============================================================
const pos = new THREE.Vector3(CELL, EYE, CELL);
let yaw = 0, pitch = 0, currentFloor = 0;
let roarCd = 0, revealTimer = 0, revealedBot = null;
let debugAI = false;   // overlay de depuración de la IA (tecla O)

function groundHeight() { return 0; }
// Colisión del jugador contra el grid FINO: recorre toda la huella del jugador
// (no 4 esquinas) y para exacto en la pared visible.
function collidesPlayer(x, z) {
  return collidesBoxGrid(COL_MAP, COL_COLS, COL_ROWS, COL_CELL, x, z, PLAYER_R);
}

const keys = Object.create(null);
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'KeyG' && hunt.active <= 0) startHunt(); if (e.code === 'Digit1' || e.code === 'KeyQ') roar(); if (e.code === 'KeyO') debugAI = !debugAI; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => { if (e.button === 0) roar(); });
function roar() {
  if (roarCd > 0 || GAME.state !== 'playing' || document.pointerLockElement !== canvasEl) return;
  roarCd = ROAR_CD; sfx.roar();
  { const [gx, gz] = cellOf(pos.x, pos.z); AIB.addEvent(BB, 'roar', gx, gz, GAME.timeLeft); }
  let best = null, bd = -1;
  for (const h of hunters) { if (!h.alive) continue; const d = (h.pos.x - pos.x) ** 2 + (h.pos.z - pos.z) ** 2; if (d > bd) { bd = d; best = h; } }
  revealedBot = best; revealTimer = REVEAL_DUR;
  for (const h of hunters) {
    if (!h.alive) continue;
    if (Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) <= SCARE_RANGE) { h.flee = SCARE_FLEE; h.next = null; if (h.working >= 0 && !stations[h.working].done) { stations[h.working].progress = 0; refreshStation(stations[h.working]); } }
  }
}

// ============================================================
//  Cacería + partida
// ============================================================
const hunt = { active: 0 }; let huntTimer = HUNT_EVERY;
// Pizarra compartida del escuadrón (niebla, objetivos, peligro, eventos, roster).
let BB = AIB.createBlackboard();
const VISION_R = AIB.AI.VISION_RADIUS;
let coordTimer = 0;           // acumulador para correr el coordinador a baja Hz
const COORD_PERIOD = 1.2;     // s entre reasignaciones de rol
let rendezvous = null;        // celda de reunión para REGROUP
let DISPERSAL = null;
function startHunt() { hunt.active = HUNT_DUR; sfx.roar(); duckMusic(true); for (const h of hunters) if (h.alive) h.model.setSpectral(true); { const [gx, gz] = cellOf(pos.x, pos.z); AIB.addEvent(BB, 'hunt', gx, gz, GAME.timeLeft, AIB.AI.EVENT_DANGER); } }
function endHunt() { hunt.active = 0; duckMusic(false); for (const h of hunters) if (h.alive) h.model.setSpectral(false); }
function updateHunt(dt) {
  if (hunt.active > 0) { hunt.active -= dt; if (hunt.active <= 0) endHunt(); }
  else { huntTimer -= dt; if (huntTimer <= 0) { startHunt(); huntTimer = HUNT_EVERY; } }
  return hunt.active > 0;
}
const GAME = { state: 'playing', timeLeft: MATCH_TIME };
function checkEnd() {
  if (GAME.state !== 'playing') return;
  if (hunters.every((h) => !h.alive)) return endGame(true, 'Eliminaste a todos los investigadores.');
  if (stations.every((s) => s.done)) return endGame(false, 'Apagaron todos los monitores y escaparon.');
  if (GAME.timeLeft <= 0) return endGame(true, 'Aguantaste: no terminaron a tiempo.');
}
function endGame(win, msg) {
  GAME.state = win ? 'win' : 'lose'; endHunt(); document.exitPointerLock(); win ? sfx.win() : sfx.lose();
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
  el('missions').textContent = `${stations.filter((s) => s.done).length}/${stations.length}`;
  el('hunters').textContent = hunters.filter((h) => h.alive).length;
  el('floor').textContent = '🟡 0';
  el('cd1').textContent = roarCd > 0 ? `${roarCd.toFixed(1)}s` : 'LISTO';
  el('ab1').classList.toggle('ready', roarCd <= 0);
  el('nextHunt').textContent = hunting ? 'AHORA' : `${Math.max(0, huntTimer).toFixed(0)}s`;
  banner.className = hunting ? 'active' : 'hidden';
  if (hunting) banner.textContent = '⟲ CACERÍA — LUCES FUERA ⟲';
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
  for (const s of stations) { mmCtx.fillStyle = s.done ? '#37d67a' : '#ffae42'; mmCtx.fillRect(s.gx * cs - 1, s.gz * cs - 1, cs + 1.5, cs + 1.5); }
  if (revealTimer > 0 && revealedBot && revealedBot.alive) { mmCtx.fillStyle = '#ff3b3b'; mmCtx.beginPath(); mmCtx.arc((revealedBot.pos.x / CELL) * cs, (revealedBot.pos.z / CELL) * cs, 4, 0, 7); mmCtx.fill(); }
  mmCtx.fillStyle = '#c77dff'; mmCtx.beginPath(); mmCtx.arc((pos.x / CELL) * cs, (pos.z / CELL) * cs, 3, 0, 7); mmCtx.fill();
  if (debugAI) {
    const COLR = { EXPLORE_A: '#4f8cff', EXPLORE_B: '#37d67a', GUARD: '#ffae42', SCAVENGE: '#c77dff', REGROUP: '#ff3b3b' };
    for (const h of hunters) {
      if (!h.alive) continue;
      mmCtx.fillStyle = COLR[h.role] || '#fff';
      mmCtx.fillRect((h.pos.x / CELL) * cs - 2, (h.pos.z / CELL) * cs - 2, 4, 4);
      mmCtx.fillStyle = h.panic ? '#ff0000' : '#000';
      mmCtx.fillRect((h.pos.x / CELL) * cs - 2, (h.pos.z / CELL) * cs - 4, 4 * Math.min(1, h.stress), 1.5);
    }
    // celdas descubiertas (tenue)
    mmCtx.fillStyle = 'rgba(255,255,255,0.06)';
    for (const k of BB.discovered) { const [gx, gz] = AIB.parseKey(k); mmCtx.fillRect(gx * cs, gz * cs, cs, cs); }
  }
}

// ============================================================
//  Movimiento + atmósfera (un solo piso)
// ============================================================
function applyAtmosphere() {
  const lit = hunt.active <= 0;
  ambient.color.setHex(0xbda86a);
  ambient.intensity = lit ? 0.85 : 0.04;
  hemi.intensity = lit ? 0.5 : 0.02;
  const fogc = 0x1c1808; scene.fog.color.setHex(fogc); scene.background.setHex(fogc);
}
function moveGhost(dt) {
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(fwd); if (keys['KeyS']) move.sub(fwd); if (keys['KeyD']) move.add(right); if (keys['KeyA']) move.sub(right);
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(SPEED * dt);
    if (!collidesPlayer(pos.x + move.x, pos.z)) pos.x += move.x;
    if (!collidesPlayer(pos.x, pos.z + move.z)) pos.z += move.z;
  }
  const h = groundHeight();
  currentFloor = 0;
  pos.y = h + EYE; camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0);
  aura.position.set(pos.x, h + EYE, pos.z);
}

// Predicado de celda abierta para la IA (grid de IA, no el fino de colisión).
const isOpenCell = (gx, gz) => !isWall(gx, gz);

// Cada frame: los vivos descubren a su alrededor; las estaciones cuya celda ya
// se descubrió pasan a ser objetivos conocidos; el peligro decae.
function updateBlackboard(dt) {
  for (const h of hunters) {
    if (!h.alive) continue;
    const [gx, gz] = cellOf(h.pos.x, h.pos.z);
    AIB.discoverAround(BB, gx, gz, VISION_R, isOpenCell);
  }
  stations.forEach((s, i) => {
    const k = AIB.cellKey(s.gx, s.gz);
    if (BB.discovered.has(k) && !BB.objectives.has(k)) {
      BB.objectives.set(k, { gx: s.gx, gz: s.gz, idx: i });
      // Bark 'found' del agente vivo más cercano al objetivo recién descubierto.
      let best = null, bd = Infinity;
      for (const h of hunters) { if (!h.alive) continue; const d = (h.pos.x - s.wx) ** 2 + (h.pos.z - s.wz) ** 2; if (d < bd) { bd = d; best = h; } }
      if (best) { const b = AIB.barkFor(best, 'found', NOW_SEC, AIB.AI); if (b) { best.lastBarkT = b.t; best.model.showBark(b.text); } }
    }
  });
  AIB.decayDanger(BB, dt);
}

// Centro del mapa en celdas (para dividir alas de exploración).
const MID_X = () => Math.floor(COLS / 2);
// Estado por-frame compartido por la IA (se calcula una vez en update()).
let FRONTIER = [];                       // frontera de exploración (1× por frame)
let lastGhostGX = -1, lastGhostGZ = -1;  // celda del fantasma para throttle de dispersión
let NOW_SEC = 0;                         // performance.now()/1000 muestreado 1× por frame

// Corre el coordinador cada COORD_PERIOD s: amenaza -> roles -> rendezvous.
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
  const roles = AIB.assignRoles(hunters.map((h) => ({ id: h.id, alive: h.alive, bravery: h.bravery })), threat);
  for (const h of hunters) if (roles.has(h.id)) h.role = roles.get(h.id);
  // Rendezvous = celda del aliado más valiente (líder), para REGROUP.
  const leader = aliveList.slice().sort((a, b) => b.bravery - a.bravery)[0];
  rendezvous = leader ? cellOf(leader.pos.x, leader.pos.z) : null;
}

// Construye celdas candidatas {gx,gz,bias} según el rol del agente.
function buildCandidates(h) {
  const frontier = FRONTIER;   // calculado 1× por frame en update()
  const objs = [...BB.objectives.values()].filter((o) => !stations[o.idx].done);
  const midx = MID_X();
  const near = (cell) => -(Math.abs(cell.gx - cellOf(h.pos.x, h.pos.z)[0]) + Math.abs(cell.gz - cellOf(h.pos.x, h.pos.z)[1]));
  let cands = [];
  switch (h.role) {
    case AIB.ROLES.EXPLORE_A:
    case AIB.ROLES.EXPLORE_B: {
      const wantLeft = h.role === AIB.ROLES.EXPLORE_A;
      cands = frontier
        .filter(([gx]) => (wantLeft ? gx < midx : gx >= midx))
        .map(([gx, gz]) => ({ gx, gz, bias: AIB.AI.W_CURIOSITY * h.bravery }));
      if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: AIB.AI.W_CURIOSITY * h.bravery }));
      break;
    }
    case AIB.ROLES.SCAVENGE:
      cands = objs.map((o) => ({ gx: o.gx, gz: o.gz, bias: 3 }));
      if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 }));
      break;
    case AIB.ROLES.GUARD:
      cands = objs.map((o) => ({ gx: o.gx, gz: o.gz, bias: 1.5 }));
      if (!cands.length) cands = frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 }));
      break;
    case AIB.ROLES.REGROUP:
      cands = rendezvous
        ? [{ gx: rendezvous[0], gz: rendezvous[1], bias: 4 }]
        : frontier.map(([gx, gz]) => ({ gx, gz, bias: 0.5 })); // sin punto de reunión: explora
      break;
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

// ============================================================
//  Bucle
// ============================================================
function update(dt) {
  if (GAME.state !== 'playing') return;
  GAME.timeLeft -= dt;
  NOW_SEC = performance.now() / 1000;   // reloj monótono muestreado 1× por frame
  if (roarCd > 0) roarCd = Math.max(0, roarCd - dt);
  if (revealTimer > 0) revealTimer = Math.max(0, revealTimer - dt);
  const hunting = updateHunt(dt);
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
  for (const h of hunters) updateHunter(h, dt, pos, hunting, currentFloor === 0);
  updateStations();
  updateHUD(hunting); drawMinimap(); checkEnd();
}
let last = performance.now();
function loop(now) { const dt = Math.min((now - last) / 1000, 0.05); last = now; update(dt); renderer.render(scene, camera); requestAnimationFrame(loop); }

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

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

  rebuildMinimap();
  makeStations(assets && assets.tv);
  makeHunters(assets && assets.chars);
  startBtn.textContent = 'CLICK PARA JUGAR';
  startBtn.disabled = false;
  requestAnimationFrame(loop);
}
boot();
