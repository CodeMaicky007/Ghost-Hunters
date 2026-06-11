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
  CD_TELEPORT: 12,       // s (doblado tras playtest)
  CD_TRAP: 16,
  CD_DECOY: 20,
  CD_SPECTRAL: 20,
  TRAP_DUR: 12,          // s que dura una trampa
  TRAP_RADIUS: 2,        // celdas (Manhattan)
  DECOY_DUR: 8,          // s que dura el señuelo
  SPECTRAL_DUR: 6,       // s de visión espectral
  HUNT_DUR: 45,          // s de cacería activada
  HUNT_SPEED_MULT: 1.3,  // multiplicador de velocidad del fantasma en cacería
  SENSE_RANGE: 10,       // unidades de mundo: rango de "sonido"/sentido (suben al detectarte y se alejan)
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
  for (const t of ab.traps) t.t -= dt;        // baja el reloj de cada trampa…
  ab.traps = ab.traps.filter((t) => t.t > 0); // …y descarta las caducadas (las que sobreviven ya van descontadas)
  if (ab.decoy) { ab.decoy.t -= dt; if (ab.decoy.t <= 0) ab.decoy = null; }
}

// Coste de energía / cooldown por habilidad (lectura directa, sin asignar objetos).
const costOf = (key, p) => (key === KEY.TELEPORT ? p.COST_TELEPORT : key === KEY.TRAP ? p.COST_TRAP : key === KEY.DECOY ? p.COST_DECOY : 0); // spectral: gratis
const cdOf = (key, p) => (key === KEY.TELEPORT ? p.CD_TELEPORT : key === KEY.TRAP ? p.CD_TRAP : key === KEY.DECOY ? p.CD_DECOY : p.CD_SPECTRAL);

export function canActivate(ab, key, ctx = {}, p = AB) {
  if (ab.cooldowns[key] > 0) return false;
  if (key === KEY.SPECTRAL) return !!ctx.hunting; // hunt-only, sin coste de energía
  return ab.energy >= costOf(key, p);
}

// Activa una habilidad si se puede. `cell` = [gx,gz] de trampa/señuelo/teletransporte
// (el teletransporte mueve `pos` en la integración usando `cell`). Devuelve éxito.
export function activate(ab, key, cell, ctx = {}, p = AB) {
  if (key === KEY.TELEPORT && !cell) return false; // sin destino válido, no gastes la habilidad
  if (!canActivate(ab, key, ctx, p)) return false;
  ab.cooldowns[key] = cdOf(key, p);
  if (key !== KEY.SPECTRAL) ab.energy = Math.max(0, ab.energy - costOf(key, p));
  if (key === KEY.TRAP) ab.traps.push({ gx: cell[0], gz: cell[1], t: p.TRAP_DUR });
  else if (key === KEY.DECOY) ab.decoy = { gx: cell[0], gz: cell[1], t: p.DECOY_DUR };
  else if (key === KEY.SPECTRAL) ab.spectral = p.SPECTRAL_DUR;
  return true;
}

export function agentInTrap(ab, gx, gz, p = AB) {
  for (const t of ab.traps) if (t.t > 0 && Math.abs(t.gx - gx) + Math.abs(t.gz - gz) <= p.TRAP_RADIUS) return true;
  return false;
}

export function huntReady(ab) { return ab.energy >= 1; }
export function spendForHunt(ab) { ab.energy = 0; }
