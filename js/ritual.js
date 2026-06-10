// ============================================================
//  Progresión ritual — núcleo PURO (sin three). Máquina de estados
//  del ritual + reparto de roles por fase. node-testeable.
// ============================================================
import { ROLES } from './ai.js';

export const RCFG = {
  NUM_OBJECTS: 4,        // objetos rituales repartidos por el mapa
  NEED_CHANNELERS: 2,    // mínimo de canalizadores para que suba la barra
  CHANNEL_TIME: 14,      // s para llenar la barra sin interrupciones
  CHANNEL_PENALTY: 0.12, // fracción/seg que retrocede al interrumpir
  ALTAR_RANGE: 1.2,      // unidades de mundo para depositar / contar como canalizador
};

export const OBJ = { ON_MAP: 'ON_MAP', CARRIED: 'CARRIED', DEPOSITED: 'DEPOSITED' };
export const PHASE = { GATHER: 'GATHER', CHANNEL: 'CHANNEL', DONE: 'DONE' };
// Roles de fase: reutiliza los de R1 + añade los específicos del ritual.
export const RROLE = { ...ROLES, FETCH: 'FETCH', CHANNEL: 'CHANNEL', DEFEND: 'DEFEND', DISTRACT: 'DISTRACT' };

export function createRitual(objectCells, altarCell, opts = {}) {
  const p = { ...RCFG, ...opts };
  return {
    altar: { gx: altarCell[0], gz: altarCell[1] },
    objects: objectCells.map(([gx, gz], i) => ({ id: i, gx, gz, status: OBJ.ON_MAP, carrier: null, homeGx: gx, homeGz: gz })),
    phase: PHASE.GATHER,
    channel: 0,
    needObjects: objectCells.length,
    needChannelers: p.NEED_CHANNELERS,
    channelTime: p.CHANNEL_TIME,
    penalty: p.CHANNEL_PENALTY,
  };
}

export function objectCarriedBy(ritual, agentId) {
  return ritual.objects.find((o) => o.status === OBJ.CARRIED && o.carrier === agentId) || null;
}

export function pickup(ritual, objId, agentId) {
  const o = ritual.objects.find((x) => x.id === objId);
  if (!o || o.status !== OBJ.ON_MAP) return false;
  o.status = OBJ.CARRIED; o.carrier = agentId;
  return true;
}

export function dropCarried(ritual, agentId, gx, gz) {
  const o = objectCarriedBy(ritual, agentId);
  if (!o) return false;
  o.status = OBJ.ON_MAP; o.carrier = null; o.gx = gx; o.gz = gz;
  return true;
}

export function depositedCount(ritual) {
  return ritual.objects.filter((o) => o.status === OBJ.DEPOSITED).length;
}
export function allDeposited(ritual) {
  return depositedCount(ritual) === ritual.objects.length;
}

export function depositCarried(ritual, agentId) {
  const o = objectCarriedBy(ritual, agentId);
  if (!o) return false;
  o.status = OBJ.DEPOSITED; o.carrier = null;
  o.gx = ritual.altar.gx; o.gz = ritual.altar.gz;
  if (allDeposited(ritual) && ritual.phase === PHASE.GATHER) ritual.phase = PHASE.CHANNEL;
  return true;
}

// Avanza la canalización en fase CHANNEL. interrupt -> retrocede; si no, sube
// con >= needChannelers. Devuelve la fase resultante.
export function channelTick(ritual, nChannelers, dt, { interrupt = false } = {}) {
  if (ritual.phase !== PHASE.CHANNEL) return ritual.phase;
  if (interrupt) ritual.channel = Math.max(0, ritual.channel - ritual.penalty * dt);
  else if (nChannelers >= ritual.needChannelers) ritual.channel = Math.min(1, ritual.channel + dt / ritual.channelTime);
  if (ritual.channel >= 1) ritual.phase = PHASE.DONE;
  return ritual.phase;
}

// Celdas que la niebla puede descubrir: el altar y los objetos sueltos (ON_MAP).
export function discoverableCells(ritual) {
  const cells = [[ritual.altar.gx, ritual.altar.gz]];
  for (const o of ritual.objects) if (o.status === OBJ.ON_MAP) cells.push([o.gx, o.gz]);
  return cells;
}

// Reparte roles según la fase. agents: [{id, alive, bravery, gx, gz}]. threat 0..1.
// GATHER: 4 FETCH (los más valientes) + EXPLORE_A/B; el portador siempre FETCH.
// CHANNEL: needChannelers CHANNEL (más cercanos al altar), resto DEFEND, y 1-2
// DISTRACT (los más valientes) salvo amenaza alta.
export function assignRitualRoles(agents, ritual, threat) {
  const out = new Map();
  const alive = agents.filter((a) => a.alive);

  if (ritual.phase === PHASE.CHANNEL) {
    const dA = (a) => Math.abs(a.gx - ritual.altar.gx) + Math.abs(a.gz - ritual.altar.gz);
    const byNear = alive.slice().sort((x, y) => dA(x) - dA(y));
    const need = Math.min(ritual.needChannelers, byNear.length);
    byNear.forEach((a, i) => out.set(a.id, i < need ? RROLE.CHANNEL : RROLE.DEFEND));
    const rest = byNear.slice(need).sort((x, y) => y.bravery - x.bravery);
    const nDistract = threat >= 1 ? 0 : (rest.length >= 3 ? 2 : (rest.length >= 1 ? 1 : 0));
    for (let i = 0; i < nDistract; i++) out.set(rest[i].id, RROLE.DISTRACT);
    return out;
  }

  // GATHER
  const sorted = alive.slice().sort((a, b) => b.bravery - a.bravery);
  const order = [RROLE.FETCH, RROLE.FETCH, RROLE.EXPLORE_A, RROLE.EXPLORE_B];
  const n = sorted.length || 1;
  sorted.forEach((a, i) => out.set(a.id, order[Math.min(3, Math.floor((i * 4) / n))]));
  for (const a of alive) if (objectCarriedBy(ritual, a.id)) out.set(a.id, RROLE.FETCH);
  return out;
}
