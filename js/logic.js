// Lógica pura del juego — SIN dependencias de three (testeable en Node).

// Escala para que la altura nativa del techo encaje en la altura objetivo.
export function computeEnvScale(nativeCeilHeight, targetCeil) {
  return targetCeil / nativeCeilHeight;
}

// Clasifica una celda según el impacto del raycast vertical contra los muros.
// hitY = altura del impacto más alto contra geometría de muro, o null si no hubo impacto.
export function classifyCell(hitY, ceilY, threshold) {
  if (hitY == null) return 0;
  return hitY > threshold * ceilY ? 1 : 0;
}

// Deriva el estado de animación desde los campos que ya calcula la IA.
export function hunterAnimState(h) {
  if (!h.alive) return 'dead';
  if (h.hunting || (h.flee && h.flee > 0)) return 'run';
  if (h.working != null && h.working >= 0) return 'work';
  if (h.moving) return 'walk';
  return 'idle';
}

// Mapea un estado a la animación Quaternius (sufijo tras "CharacterArmature|").
const ANIM = { walk: 'Walk', run: 'Run', work: 'Interact', dead: 'Death', idle: 'Idle' };
export function pickAnim(state) {
  return ANIM[state] || 'Idle';
}

// Elige n elementos distintos de un array usando rng() en [0,1).
export function pickDistinct(pool, n, rng = Math.random) {
  const copy = pool.slice();
  const out = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(rng() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

// ¿La celda (gx,gz) es muro? Fuera del grid cuenta como muro (cierra el borde).
export function isSolidCell(map, cols, rows, gx, gz) {
  if (gx < 0 || gz < 0 || gx >= cols || gz >= rows) return true;
  return map[gz][gx] === 1;
}

// Colisión continua de una caja (jugador, semilado r) contra el grid: marca
// choque si CUALQUIER celda que solape la huella [x±r, z±r] es muro. Recorre toda
// la huella (no solo 4 esquinas) → no se cuela por muros más finos que el jugador,
// y para EXACTO en la celda-muro, sin el "colchón" de medio-celda del grid grueso.
// El grid es centrado: la celda i cubre [(i-0.5)·cell, (i+0.5)·cell] (índice = round).
export function collidesBoxGrid(map, cols, rows, cell, x, z, r) {
  const i0 = Math.round((x - r) / cell), i1 = Math.round((x + r) / cell);
  const j0 = Math.round((z - r) / cell), j1 = Math.round((z + r) / cell);
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      if (isSolidCell(map, cols, rows, i, j)) return true;
  return false;
}

// Ajustes por defecto del parry (fuente única; la integración los reutiliza).
export const PARRY_DEFAULTS = { base: 0.25, perBravery: 0.5, panicMul: 0.3 };

// Probabilidad de parry (0..1) según pericia (valentía). El pánico la hunde.
export function parryChance(bravery, panic, p = PARRY_DEFAULTS) {
  const c = p.base + p.perBravery * bravery;
  const v = panic ? c * p.panicMul : c;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Tirada de parry: true si éxito. rng() en [0,1).
export function rollParry(chance, rng = Math.random) {
  return rng() < chance;
}

// Analiza los AABB de las mallas del entorno (en cualquier escala uniforme) y
// distingue cáscara exterior / suelo / techo / muros, sin depender de three.
// boxes: [{minX,maxX,minY,maxY,minZ,maxZ}] (en el MISMO espacio/escala).
// Devuelve índices de muro (lo transitable se raycastea solo contra estos),
// la altura suelo->techo de la sala, y los índices de suelo/techo/cáscara.
export function analyzeEnvMeshes(boxes) {
  const vol = (b) => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY) * Math.max(0, b.maxZ - b.minZ);
  // La cáscara exterior es la malla de mayor volumen (envuelve a las demás).
  let shell = -1, shellVol = -1;
  boxes.forEach((b, i) => { const v = vol(b); if (v > shellVol) { shellVol = v; shell = i; } });
  // Suelo/techo de la sala = entre las NO-cáscara.
  let floorY = Infinity, ceilY = -Infinity;
  boxes.forEach((b, i) => { if (i === shell) return; if (b.minY < floorY) floorY = b.minY; if (b.maxY > ceilY) ceilY = b.maxY; });
  const ceilHeight = ceilY - floorY || 1;
  // "Plano" = altura despreciable frente a la altura de la sala (suelo o techo).
  const walls = [];
  let floor = -1, ceiling = -1, floorTop = Infinity, ceilTop = -Infinity;
  boxes.forEach((b, i) => {
    if (i === shell) return;
    const h = b.maxY - b.minY;
    if (h < 0.15 * ceilHeight) {            // casi plano -> suelo o techo
      if (b.maxY < floorTop) { floorTop = b.maxY; floor = i; }
      if (b.maxY > ceilTop) { ceilTop = b.maxY; ceiling = i; }
    } else {
      walls.push(i);                        // tiene altura real -> muro
    }
  });
  return { shell, floor, ceiling, walls, floorY, ceilY, ceilHeight };
}

// Resultado de un golpe en cacería: marcado = muerte directa; sin marca, pierde
// una vida y con la última cae derribado (KO), no muerto.
export function hitResult(marked, lives) {
  if (marked) return { outcome: 'dead', lives: 0 };
  const left = lives - 1;
  return left <= 0 ? { outcome: 'down', lives: 0 } : { outcome: 'wounded', lives: left };
}

// Reanimar a un KO solo es posible si el fantasma no está cerca.
export function canRevive(distGhost, blockRange) { return distGhost >= blockRange; }

// ============================================================
//  Presentación (R7) — paneles fluorescentes, flicker, cámara.
//  Funciones puras: la integración three vive en lights.js/fx.js.
// ============================================================

// Celdas de panel fluorescente: rejilla cada `step` celdas sobre celdas abiertas,
// arrancando en el centro del primer bloque para no pegarlos al borde del mapa.
export function pickPanelCells(map, cols, rows, step = 5) {
  const off = Math.floor(step / 2);
  const out = [];
  for (let z = off; z < rows; z += step)
    for (let x = off; x < cols; x += step)
      if (map[z][x] === 0) out.push([x, z]);
  return out;
}

// k celdas lo más repartidas posible (greedy farthest-point, determinista:
// mismo input -> mismas picks). Para decidir qué paneles llevan luz real.
export function spreadPicks(cells, k) {
  if (!cells.length || k <= 0) return [];
  const picks = [cells[0]];
  while (picks.length < Math.min(k, cells.length)) {
    let best = null, bd = -1;
    for (const c of cells) {
      let dmin = Infinity;
      for (const p of picks) { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2; if (d < dmin) dmin = d; }
      if (dmin > bd) { bd = dmin; best = c; }
    }
    picks.push(best);
  }
  return picks;
}

// Brillo 0..1 de un fluorescente en el instante t (determinista por seed).
// Casi siempre ~1 con micro-ruido de red; ventanas breves de apagón parcial.
export function fluorFlicker(t, seed) {
  const h = Math.sin(t * 7.3 + seed * 12.9898) * 43758.5453;
  const n = h - Math.floor(h);                       // ruido 0..1
  const slow = Math.sin(t * 0.7 + seed * 6.1);       // fase lenta propia del panel
  if (slow > 0.92 && n > 0.55) return n * 0.3;       // apagón breve
  return 0.9 + n * 0.1;
}

// Trauma de cámara: decae lineal; la amplitud del shake es cuadrática para que
// los sustos pequeños apenas muevan y los grandes peguen (estándar AAA).
export function decayTrauma(trauma, dt, rate = 1.5) { return Math.max(0, trauma - rate * dt); }
export function shakeAmp(trauma) { return trauma * trauma; }

// Intervalo del latido (s) según proximidad 0..1 (0 = lejos, 1 = encima).
export function heartbeatInterval(prox) {
  const p = prox < 0 ? 0 : prox > 1 ? 1 : prox;
  return 1.3 - 0.85 * p;
}
