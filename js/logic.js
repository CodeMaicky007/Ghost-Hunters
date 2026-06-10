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
