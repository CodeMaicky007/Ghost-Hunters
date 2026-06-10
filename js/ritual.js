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
