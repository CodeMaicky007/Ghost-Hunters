import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEnvScale, classifyCell, hunterAnimState, pickAnim, pickDistinct } from '../js/logic.js';

test('computeEnvScale fits ceiling to target', () => {
  assert.ok(Math.abs(computeEnvScale(8.6, 2.7) - 0.31395) < 1e-4);
});

test('classifyCell: hit near ceiling is wall, hit near floor is open, no hit is open', () => {
  const ceil = 2.7, thr = 0.6;
  assert.equal(classifyCell(2.6, ceil, thr), 1);
  assert.equal(classifyCell(0.05, ceil, thr), 0);
  assert.equal(classifyCell(null, ceil, thr), 0);
});

test('hunterAnimState maps game state to anim key', () => {
  assert.equal(hunterAnimState({ alive: false }), 'dead');
  assert.equal(hunterAnimState({ alive: true, hunting: true }), 'run');
  assert.equal(hunterAnimState({ alive: true, flee: 1.2 }), 'run');
  assert.equal(hunterAnimState({ alive: true, working: 2 }), 'work');
  assert.equal(hunterAnimState({ alive: true, moving: true }), 'walk');
  assert.equal(hunterAnimState({ alive: true }), 'idle');
});

test('pickAnim returns the Quaternius clip suffix for a state', () => {
  assert.equal(pickAnim('walk'), 'Walk');
  assert.equal(pickAnim('run'), 'Run');
  assert.equal(pickAnim('work'), 'Interact');
  assert.equal(pickAnim('dead'), 'Death');
  assert.equal(pickAnim('idle'), 'Idle');
});

test('pickDistinct returns n unique items', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  let seed = 42;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const got = pickDistinct(pool, 3, rng);
  assert.equal(got.length, 3);
  assert.equal(new Set(got).size, 3);
  got.forEach((g) => assert.ok(pool.includes(g)));
});
