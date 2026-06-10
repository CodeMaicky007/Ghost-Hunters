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
