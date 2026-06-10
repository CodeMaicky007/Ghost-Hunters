// ============================================================
//  Cerebro IA de los supervivientes — núcleo PURO (sin three).
//  Datos planos + funciones puras, testeables con `node --test`.
//  Claves de celda como string "gx,gz" para no depender de cols.
// ============================================================

// Constantes de tuning (todas en un sitio para balancear).
export const AI = {
  VISION_RADIUS: 4,      // celdas (disco Manhattan) que descubre un agente
  DANGER_DECAY: 0.6,     // factor multiplicativo por segundo
  DANGER_MIN: 0.05,      // por debajo se borra
  EVENT_DANGER: 1.0,     // peligro que añade un evento
  DEATH_DANGER: 2.0,     // peligro que añade una muerte
  THREAT_REGROUP: 0.6,   // umbral de amenaza que dispara REGROUP
  PANIC_IN: 0.85,        // estrés de entrada a pánico
  PANIC_SANITY: 0.2,     // cordura máx. para entrar en pánico
  PANIC_OUT: 0.5,        // miedo de salida de pánico (histéresis)
  STRESS_GHOST: 0.5,     // +estrés/seg cerca del fantasma
  STRESS_EVENT: 0.25,    // +estrés por tick de evento cercano
  STRESS_DARK: 0.15,     // +estrés/seg en oscuridad (cacería)
  STRESS_ALONE: 0.10,    // +estrés/seg estando solo
  STRESS_CALM: 0.25,     // -estrés/seg agrupado y seguro
  SANITY_DRAIN: 0.04,    // -cordura/seg bajo estrés sostenido
  SANITY_RECOVER: 0.02,  // +cordura/seg al calmarse
  W_DANGER: 3.0,         // peso de evasión de peligro en utilidad
  W_COHESION: 1.0,       // peso de cohesión con aliados
  W_RECENT: 2.0,         // penalización por celda recién visitada
  W_CURIOSITY: 0.5,      // sesgo de exploración (lo aplica la integración)
  BARK_CD: 4.0,          // cooldown de barks por agente (s)
  // Pesos internos de fórmulas (extraídos al tuning; valores idénticos).
  FEAR_W_STRESS: 0.6,        // peso del estrés en el miedo
  FEAR_W_SANITY: 0.4,        // peso de (1-cordura) en el miedo
  FEAR_W_BRAVERY: 0.25,      // descuento por valentía en el miedo
  SANITY_DRAIN_AT: 0.6,      // estrés por encima del cual drena la cordura
  THREAT_W_EVENT: 0.15,      // peso por evento reciente en la amenaza
  THREAT_W_DEATH: 0.25,      // peso por muerte en la amenaza
  THREAT_W_FEAR: 0.4,        // peso del miedo medio en la amenaza
  DANGER_FEAR_BASE: 0.3,     // base de miedo al escalar la evasión de peligro
  COHESION_DIST_SCALE: 0.1,  // escala de distancia en la cohesión
  DISPERSAL_SELF_WEIGHT: 0.3,// descuento por distancia propia en dispersión
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const cellKey = (gx, gz) => gx + ',' + gz;
export const parseKey = (k) => k.split(',').map(Number);

export function createBlackboard() {
  return {
    discovered: new Set(),  // claves "gx,gz" vistas por el escuadrón
    objectives: new Map(),  // clave -> {gx, gz, idx} (idx en stations[])
    danger: new Map(),      // clave -> score
    events: [],             // {type, gx, gz, t}
    roster: [],             // estado público por agente. TODO R2: {id,alive,gx,gz,role,stress}/tick
  };
}

// Marca como descubiertas las celdas ABIERTAS dentro del disco Manhattan de
// radio `radius` alrededor de (gx,gz). Devuelve cuántas eran nuevas.
export function discoverAround(bb, gx, gz, radius, isOpen) {
  let added = 0;
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dz) > radius) continue;
      const x = gx + dx, z = gz + dz;
      if (!isOpen(x, z)) continue;
      const k = cellKey(x, z);
      if (!bb.discovered.has(k)) { bb.discovered.add(k); added++; }
    }
  return added;
}

// Frontera = celdas ABIERTAS aún no descubiertas, adyacentes (4-vecindad) a una
// descubierta. Es el conjunto de objetivos de exploración.
export function computeFrontier(bb, isOpen) {
  const N = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const front = new Set();
  for (const k of bb.discovered) {
    const [gx, gz] = parseKey(k);
    for (const [dx, dz] of N) {
      const x = gx + dx, z = gz + dz, nk = cellKey(x, z);
      if (isOpen(x, z) && !bb.discovered.has(nk)) front.add(nk);
    }
  }
  return [...front].map(parseKey);
}

export function bumpDanger(bb, gx, gz, amount) {
  const k = cellKey(gx, gz);
  bb.danger.set(k, (bb.danger.get(k) || 0) + amount);
}

export function addEvent(bb, type, gx, gz, t, amount = AI.EVENT_DANGER) {
  bb.events.push({ type, gx, gz, t });
  bumpDanger(bb, gx, gz, amount);
}

export function decayDanger(bb, dt, rate = AI.DANGER_DECAY, min = AI.DANGER_MIN) {
  const f = Math.pow(rate, dt);
  for (const [k, v] of bb.danger) {
    const nv = v * f;
    if (nv < min) bb.danger.delete(k); else bb.danger.set(k, nv);
  }
}

export function dangerAt(bb, gx, gz) {
  return bb.danger.get(cellKey(gx, gz)) || 0;
}

// Miedo derivado de estrés, cordura y valentía (0..1).
export function deriveFear(stress, sanity, bravery) {
  return clamp01(AI.FEAR_W_STRESS * stress + AI.FEAR_W_SANITY * (1 - sanity) - AI.FEAR_W_BRAVERY * bravery);
}

// Actualiza estrés/cordura/miedo/pánico de un agente. PURA: no muta `agent`,
// devuelve {stress, sanity, fear, panic}. ctx: {nearGhost, inEvent, dark,
// alone, grouped, safe}. Pánico con histéresis (entra duro, sale al calmarse).
export function updateFear(agent, ctx, dt, p = AI) {
  let stress = agent.stress, sanity = agent.sanity;
  let up = 0;
  if (ctx.nearGhost) up += p.STRESS_GHOST;
  if (ctx.inEvent) up += p.STRESS_EVENT;
  if (ctx.dark) up += p.STRESS_DARK;
  if (ctx.alone) up += p.STRESS_ALONE;
  const down = (ctx.grouped && ctx.safe) ? p.STRESS_CALM : 0;
  stress = clamp01(stress + (up - down) * dt);
  if (stress > p.SANITY_DRAIN_AT) sanity = clamp01(sanity - p.SANITY_DRAIN * dt);
  else if (ctx.grouped && ctx.safe) sanity = clamp01(sanity + p.SANITY_RECOVER * dt);
  const fear = deriveFear(stress, sanity, agent.bravery);
  let panic = agent.panic;
  if (!panic && stress >= p.PANIC_IN && sanity <= p.PANIC_SANITY) panic = true;
  else if (panic && fear <= p.PANIC_OUT) panic = false;
  return { stress, sanity, fear, panic };
}

export const ROLES = {
  EXPLORE_A: 'EXPLORE_A',
  EXPLORE_B: 'EXPLORE_B',
  GUARD: 'GUARD',
  SCAVENGE: 'SCAVENGE',
  REGROUP: 'REGROUP',
};

// Amenaza global 0..1. ctx: {hunting, recentEvents, deaths, avgFear}.
export function computeThreat(ctx, p = AI) {
  let t = 0;
  if (ctx.hunting) t += 1;
  t += p.THREAT_W_EVENT * (ctx.recentEvents || 0);
  t += p.THREAT_W_DEATH * (ctx.deaths || 0);
  t += p.THREAT_W_FEAR * (ctx.avgFear || 0);
  return Math.min(1, t);
}

// Asigna un rol por agente vivo. Bajo amenaza alta: todos REGROUP. Si no: orden
// por valentía desc y reparto por quartiles -> 2+2+2+2 con 8. Los valientes
// exploran/guardan; los miedosos recolectan acompañados.
export function assignRoles(agents, threat, p = AI) {
  const out = new Map();
  const alive = agents.filter((a) => a.alive);
  if (threat >= p.THREAT_REGROUP) {
    for (const a of alive) out.set(a.id, ROLES.REGROUP);
    return out;
  }
  const sorted = alive.slice().sort((a, b) => b.bravery - a.bravery);
  const order = [ROLES.EXPLORE_A, ROLES.EXPLORE_B, ROLES.GUARD, ROLES.SCAVENGE];
  const n = sorted.length || 1;
  sorted.forEach((a, i) => {
    const q = Math.min(3, Math.floor((i * 4) / n));
    out.set(a.id, order[q]);
  });
  return out;
}

// Puntúa una celda candidata para un agente. `cand` = {gx, gz, bias}, donde
// `bias` lo aporta la integración según el rol (atractivo del objetivo / sesgo
// de exploración). Resta peligro (escalado por miedo), celdas recientes, y
// (con miedo) la distancia a los aliados. Mayor = mejor.
export function scoreCell(cand, agent, bb, allies, p = AI) {
  const { gx, gz } = cand;
  let s = cand.bias || 0;
  s -= p.W_DANGER * dangerAt(bb, gx, gz) * (p.DANGER_FEAR_BASE + agent.fear);
  if (agent.recentCells && agent.recentCells.includes(cellKey(gx, gz))) s -= p.W_RECENT;
  if (allies && allies.length) {
    let dmin = Infinity;
    for (const a of allies) {
      const d = Math.abs(a.gx - gx) + Math.abs(a.gz - gz);
      if (d < dmin) dmin = d;
    }
    s -= p.W_COHESION * agent.fear * dmin * p.COHESION_DIST_SCALE;
  }
  return s;
}

// Elige la celda candidata de mayor utilidad. Devuelve [gx,gz] o null.
export function chooseGoal(agent, candidates, bb, allies, p = AI) {
  let best = null, bs = -Infinity;
  for (const c of candidates) {
    const sc = scoreCell(c, agent, bb, allies, p);
    if (sc > bs) { bs = sc; best = c; }
  }
  return best ? [best.gx, best.gz] : null;
}

// Reparte celdas de escape DISTINTAS para que el fantasma no barra al grupo.
// Procesa primero a los agentes más cercanos al fantasma (más urgentes). Cada
// uno toma la celda segura libre que maximiza (lejos del fantasma - un poco la
// distancia a sí mismo). Devuelve Map id -> [gx,gz].
export function dispersalTargets(agents, ghost, safeCells, p = AI) {
  const used = new Set();
  const out = new Map();
  const dist = (ax, az, bx, bz) => Math.abs(ax - bx) + Math.abs(az - bz);
  const order = agents.slice().sort(
    (a, b) => dist(a.gx, a.gz, ghost.gx, ghost.gz) - dist(b.gx, b.gz, ghost.gx, ghost.gz)
  );
  for (const a of order) {
    let best = null, bs = -Infinity;
    for (const c of safeCells) {
      const k = cellKey(c.gx, c.gz);
      if (used.has(k)) continue;
      const score = dist(c.gx, c.gz, ghost.gx, ghost.gz) - p.DISPERSAL_SELF_WEIGHT * dist(c.gx, c.gz, a.gx, a.gz);
      if (score > bs) { bs = score; best = c; }
    }
    if (best) { used.add(cellKey(best.gx, best.gz)); out.set(a.id, [best.gx, best.gz]); }
  }
  return out;
}

// Tabla de barks: clave de trigger -> {text, prio}. prio>=4 ignora cooldown.
// Cableados en la integración: hunt/scared/regroup (updateHunter) y found
// (updateBlackboard). 'danger' y 'missing' son semillas para R2 (aún no se disparan).
const BARKS = {
  found:   { text: '¡Aquí hay algo!',    prio: 2 },
  danger:  { text: '¡Por ahí no!',        prio: 3 },
  scared:  { text: 'No me gusta esto…',   prio: 1 },
  regroup: { text: '¡Todos conmigo!',     prio: 3 },
  missing: { text: '¿Dónde está?',        prio: 2 },
  hunt:    { text: '¡CORRED!',            prio: 5 },
};

// Devuelve {text, prio, t} o null. El llamador actualiza agent.lastBarkT con t.
export function barkFor(agent, trigger, now, p = AI) {
  const b = BARKS[trigger];
  if (!b) return null;
  const since = now - (agent.lastBarkT ?? -Infinity);
  if (b.prio < 4 && since < p.BARK_CD) return null;
  return { text: b.text, prio: b.prio, t: now };
}
