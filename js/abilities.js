// ============================================================
//  Habilidades del fantasma + Energía Paranormal — núcleo PURO
//  (sin three). Economía + cooldowns + estado de activos. node-testeable.
// ============================================================

export const AB = {
  ENERGY_REGEN: 0.06,    // energía/seg (barra llena en ~16 s base)
  STALK_BONUS: 0.05,     // +energía/seg acechando (cerca de supervivientes)
  COST_TELEPORT: 0.25,
  COST_TRAP: 0.3,
  COST_DECOY: 0.3,
  CD_TELEPORT: 6,        // s
  CD_TRAP: 8,
  CD_DECOY: 10,
  CD_SPECTRAL: 10,
  TRAP_DUR: 12,          // s que dura una trampa
  TRAP_RADIUS: 2,        // celdas (Manhattan)
  DECOY_DUR: 8,          // s que dura el señuelo
  SPECTRAL_DUR: 6,       // s de visión espectral
  HUNT_DUR: 45,          // s de cacería activada
  HUNT_SPEED_MULT: 1.3,  // multiplicador de velocidad del fantasma en cacería
  SENSE_RANGE: 7,        // unidades de mundo: rango de "sonido" que sienten
  TELEPORT_RANGE: 12,    // celdas máx de teletransporte
};

export const KEY = { TELEPORT: 'teleport', TRAP: 'trap', DECOY: 'decoy', SPECTRAL: 'spectral' };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createAbilities() {
  return {
    energy: 0,
    cooldowns: { teleport: 0, trap: 0, decoy: 0, spectral: 0 },
    traps: [],       // [{gx, gz, t}]
    decoy: null,     // {gx, gz, t} | null
    spectral: 0,     // s restantes de visión espectral
  };
}

// Avanza energía (regen + bonus de acecho, clamp 0..1), baja cooldowns y el
// temporizador de visión espectral, y caduca trampas/señuelo.
export function tickEnergy(ab, dt, ctx = {}, p = AB) {
  ab.energy = clamp01(ab.energy + (p.ENERGY_REGEN + (ctx.nearSurvivor ? p.STALK_BONUS : 0)) * dt);
  for (const k in ab.cooldowns) ab.cooldowns[k] = Math.max(0, ab.cooldowns[k] - dt);
  if (ab.spectral > 0) ab.spectral = Math.max(0, ab.spectral - dt);
  for (const t of ab.traps) t.t -= dt;
  ab.traps = ab.traps.filter((t) => t.t > 0);
  if (ab.decoy) { ab.decoy.t -= dt; if (ab.decoy.t <= 0) ab.decoy = null; }
}

const COST = (p) => ({ teleport: p.COST_TELEPORT, trap: p.COST_TRAP, decoy: p.COST_DECOY, spectral: 0 });

export function canActivate(ab, key, ctx = {}, p = AB) {
  if (ab.cooldowns[key] > 0) return false;
  if (key === 'spectral') return !!ctx.hunting; // hunt-only, sin coste de energía
  return ab.energy >= COST(p)[key];
}

// Activa una habilidad si se puede. `cell` = [gx,gz] de la trampa/señuelo (el
// teletransporte mueve `pos` en la integración usando `cell`). Devuelve éxito.
export function activate(ab, key, cell, ctx = {}, p = AB) {
  if (!canActivate(ab, key, ctx, p)) return false;
  ab.cooldowns[key] = { teleport: p.CD_TELEPORT, trap: p.CD_TRAP, decoy: p.CD_DECOY, spectral: p.CD_SPECTRAL }[key];
  if (key !== 'spectral') ab.energy = Math.max(0, ab.energy - COST(p)[key]);
  if (key === 'trap') ab.traps.push({ gx: cell[0], gz: cell[1], t: p.TRAP_DUR });
  else if (key === 'decoy') ab.decoy = { gx: cell[0], gz: cell[1], t: p.DECOY_DUR };
  else if (key === 'spectral') ab.spectral = p.SPECTRAL_DUR;
  return true;
}

export function agentInTrap(ab, gx, gz, p = AB) {
  for (const t of ab.traps) if (Math.abs(t.gx - gx) + Math.abs(t.gz - gz) <= p.TRAP_RADIUS) return true;
  return false;
}

export function huntReady(ab) { return ab.energy >= 1; }
export function spendForHunt(ab) { ab.energy = 0; }
