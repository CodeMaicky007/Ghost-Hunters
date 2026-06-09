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
import { HunterModel } from './hunters.js';

// ---------- Config / balance ----------
// CELL=1.5: los tabiques del modelo Backrooms miden ~1.5u; con celdas de 3 el
// raycast los saltaba y el nivel salía como una sala vacía. A 1.5 el horneado
// reproduce el laberinto real (muros de altura completa, totalmente conexo).
const CELL = 1.5;
const EYE = 1.6;
const PLAYER_R = 0.4;
const HUNTER_R = 0.3;
const SPEED = 4.2;
const SENS = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

const GRID = 26;
const MATCH_TIME = 180;
const NUM_HUNTERS = 3;
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
function makeStations() {
  const cells = spreadCells(NUM_STATIONS + 1, (x, z) => (x <= 5 && z <= 7)).slice(1, NUM_STATIONS + 1);
  const geo = new THREE.CylinderGeometry(0.4, 0.55, 1.3, 10);
  for (const [gx, gz] of cells) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x222244, emissive: 0xff3030, emissiveIntensity: 1.0, roughness: 0.5 });
    const mesh = new THREE.Mesh(geo, mat); const [wx, wz] = worldOf(gx, gz); mesh.position.set(wx, 0.65, wz); scene.add(mesh);
    stations.push({ gx, gz, wx, wz, progress: 0, done: false, mesh, mat });
  }
}
function refreshStation(s) { if (s.done) { s.mat.emissive.setRGB(0.1, 1, 0.2); s.mat.emissiveIntensity = 1.4; return; } s.mat.emissive.setRGB(1 - s.progress, s.progress, 0.12); }
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
    hunters.push({ pos: new THREE.Vector3(wx, 0, wz), model, alive: true, flee: 0, repath: 0, next: null, working: -1 });
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
function updateHunter(h, dt, ghost, hunting, ghostOnFloor0) {
  if (!h.alive) { h.model.update(dt); return; }
  if (h.flee > 0) h.flee -= dt;
  const prevX = h.pos.x, prevZ = h.pos.z;
  if (hunting) {
    h.working = -1;
    stepToward(h, farthestCell(ghost.x, ghost.z), HUNTER_FLEE_SPEED, dt);
    if (ghostOnFloor0 && Math.hypot(h.pos.x - ghost.x, h.pos.z - ghost.z) < KILL_RANGE) { killHunter(h); return; }
  } else if (h.flee > 0) {
    h.working = -1; stepToward(h, farthestCell(ghost.x, ghost.z), HUNTER_FLEE_SPEED, dt);
  } else {
    const si = nearestIncompleteStation(h.pos.x, h.pos.z);
    if (si < 0) h.working = -1;
    else { const s = stations[si];
      if (Math.hypot(s.wx - h.pos.x, s.wz - h.pos.z) < 0.9) { h.working = si; s.progress = Math.min(1, s.progress + dt / MISSION_TIME); if (s.progress >= 1) s.done = true; refreshStation(s); }
      else { h.working = -1; stepToward(h, [s.gx, s.gz], HUNTER_SPEED, dt); }
    }
  }
  const dx = h.pos.x - prevX, dz = h.pos.z - prevZ;
  const moving = (dx * dx + dz * dz) > 1e-6;
  h.model.faceDir(dx, dz);
  h.model.setState({ alive: true, hunting, flee: h.flee, working: h.working, moving });
  h.model.setPos(h.pos.x, 0, h.pos.z);
  h.model.update(dt);
}
function killHunter(h) { h.alive = false; h.model.setSpectral(false); h.model.play('Death'); h.model.update(0); sfx.kill(); checkEnd(); }

// ============================================================
//  Estado del jugador (un solo piso)
// ============================================================
const pos = new THREE.Vector3(CELL, EYE, CELL);
let yaw = 0, pitch = 0, currentFloor = 0;
let roarCd = 0, revealTimer = 0, revealedBot = null;

function groundHeight() { return 0; }
function collidesPlayer(x, z) {
  const r = PLAYER_R;
  const c = [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]];
  for (const [px, pz] of c) {
    const gx = Math.round(px / CELL), gz = Math.round(pz / CELL);
    if (gx < 0 || gz < 0 || gx >= COLS || gz >= ROWS) return true;
    if (MAP[gz][gx] === 1) return true;
  }
  return false;
}

const keys = Object.create(null);
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'KeyG' && hunt.active <= 0) startHunt(); if (e.code === 'Digit1' || e.code === 'KeyQ') roar(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => { if (e.button === 0) roar(); });
function roar() {
  if (roarCd > 0 || GAME.state !== 'playing' || document.pointerLockElement !== canvasEl) return;
  roarCd = ROAR_CD; sfx.roar();
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
function startHunt() { hunt.active = HUNT_DUR; sfx.roar(); duckMusic(true); for (const h of hunters) if (h.alive) h.model.setSpectral(true); }
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
  if (stations.every((s) => s.done)) return endGame(false, 'Completaron todas sus misiones y escaparon.');
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

// ============================================================
//  Bucle
// ============================================================
function update(dt) {
  if (GAME.state !== 'playing') return;
  GAME.timeLeft -= dt;
  if (roarCd > 0) roarCd = Math.max(0, roarCd - dt);
  if (revealTimer > 0) revealTimer = Math.max(0, revealTimer - dt);
  const hunting = updateHunt(dt);
  moveGhost(dt);
  applyAtmosphere();
  for (const h of hunters) updateHunter(h, dt, pos, hunting, currentFloor === 0);
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
  }
  const [ox, oz] = firstOpenCell();
  REACH = floodReachable(ox, oz);
  console.log('REACH celdas transitables:', REACH.list.length);
  pos.set(ox * CELL, EYE, oz * CELL);

  rebuildMinimap();
  makeStations();
  makeHunters(assets && assets.chars);
  startBtn.textContent = 'CLICK PARA JUGAR';
  startBtn.disabled = false;
  requestAnimationFrame(loop);
}
boot();
