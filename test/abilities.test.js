import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAbilities, AB, KEY } from '../js/abilities.js';

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
