import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAbilities, AB, KEY, tickEnergy } from '../js/abilities.js';

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
