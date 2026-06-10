import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAbilities, AB, KEY, tickEnergy, canActivate, activate, agentInTrap, huntReady, spendForHunt } from '../js/abilities.js';

test('createAbilities inicializa energía 0 y activos vacíos', () => {
  const ab = createAbilities();
  assert.equal(ab.energy, 0);
  assert.deepEqual(ab.cooldowns, { teleport: 0, trap: 0, decoy: 0, spectral: 0 });
  assert.deepEqual(ab.traps, []);
  assert.equal(ab.decoy, null);
  assert.equal(ab.spectral, 0);
});

test('KEY expone las 4 habilidades', () => {
  assert.deepEqual(
    [KEY.TELEPORT, KEY.TRAP, KEY.DECOY, KEY.SPECTRAL],
    ['teleport', 'trap', 'decoy', 'spectral']
  );
  assert.equal(AB.HUNT_DUR > 0, true);
});

test('tickEnergy rellena con regen y stalk, clamp a 1', () => {
  const ab = createAbilities();
  tickEnergy(ab, 1, { nearSurvivor: false });
  assert.ok(Math.abs(ab.energy - AB.ENERGY_REGEN) < 1e-9);
  tickEnergy(ab, 1, { nearSurvivor: true });
  assert.ok(Math.abs(ab.energy - (AB.ENERGY_REGEN * 2 + AB.STALK_BONUS)) < 1e-9);
  tickEnergy(ab, 1000, {});
  assert.equal(ab.energy, 1); // clamp
});

test('tickEnergy baja cooldowns y spectral, y caduca trampas/decoy', () => {
  const ab = createAbilities();
  ab.cooldowns.teleport = 2; ab.spectral = 1.5;
  ab.traps = [{ gx: 1, gz: 1, t: 0.5 }, { gx: 2, gz: 2, t: 3 }];
  ab.decoy = { gx: 4, gz: 4, t: 0.4 };
  tickEnergy(ab, 1, {});
  assert.ok(Math.abs(ab.cooldowns.teleport - 1) < 1e-9);
  assert.ok(Math.abs(ab.spectral - 0.5) < 1e-9);
  assert.equal(ab.traps.length, 1);        // la de 0.5 caducó
  assert.equal(ab.traps[0].gx, 2);
  assert.equal(ab.decoy, null);            // caducó
});

test('canActivate respeta energía y cooldown', () => {
  const ab = createAbilities();
  assert.equal(canActivate(ab, KEY.TELEPORT), false); // energía 0
  ab.energy = 1;
  assert.equal(canActivate(ab, KEY.TELEPORT), true);
  ab.cooldowns.teleport = 1;
  assert.equal(canActivate(ab, KEY.TELEPORT), false); // en cooldown
});

test('canActivate de visión espectral solo en cacería, sin coste de energía', () => {
  const ab = createAbilities(); // energía 0
  assert.equal(canActivate(ab, KEY.SPECTRAL, { hunting: false }), false);
  assert.equal(canActivate(ab, KEY.SPECTRAL, { hunting: true }), true);
  ab.cooldowns.spectral = 1;
  assert.equal(canActivate(ab, KEY.SPECTRAL, { hunting: true }), false);
});

test('activate trampa: gasta energía, fija cooldown y añade trampa', () => {
  const ab = createAbilities(); ab.energy = 1;
  assert.equal(activate(ab, KEY.TRAP, [3, 4]), true);
  assert.ok(Math.abs(ab.energy - (1 - AB.COST_TRAP)) < 1e-9);
  assert.equal(ab.cooldowns.trap, AB.CD_TRAP);
  assert.deepEqual(ab.traps, [{ gx: 3, gz: 4, t: AB.TRAP_DUR }]);
});

test('activate señuelo y visión espectral', () => {
  const ab = createAbilities(); ab.energy = 1;
  activate(ab, KEY.DECOY, [5, 6]);
  assert.deepEqual(ab.decoy, { gx: 5, gz: 6, t: AB.DECOY_DUR });
  assert.equal(activate(ab, KEY.SPECTRAL, null, { hunting: true }), true);
  assert.equal(ab.spectral, AB.SPECTRAL_DUR);
});

test('activate falla si no se puede (devuelve false, sin efecto)', () => {
  const ab = createAbilities(); // energía 0
  assert.equal(activate(ab, KEY.TRAP, [1, 1]), false);
  assert.deepEqual(ab.traps, []);
});

test('agentInTrap detecta celdas dentro del radio (Manhattan)', () => {
  const ab = createAbilities();
  ab.traps = [{ gx: 5, gz: 5, t: 10 }];
  assert.equal(agentInTrap(ab, 5, 5), true);
  assert.equal(agentInTrap(ab, 7, 5), true);  // dist 2 == radio
  assert.equal(agentInTrap(ab, 8, 5), false); // dist 3 > radio
});

test('huntReady y spendForHunt', () => {
  const ab = createAbilities();
  assert.equal(huntReady(ab), false);
  ab.energy = 1;
  assert.equal(huntReady(ab), true);
  spendForHunt(ab);
  assert.equal(ab.energy, 0);
});
