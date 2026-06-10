import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEnvScale, classifyCell, hunterAnimState, pickAnim, pickDistinct, isSolidCell, collidesBoxGrid } from '../js/logic.js';
import { parryChance, rollParry } from '../js/logic.js';

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

test('isSolidCell: in-bounds reads MAP, out-of-bounds is solid', () => {
  const map = [[0, 0, 0], [0, 1, 0], [0, 0, 0]];
  assert.equal(isSolidCell(map, 3, 3, 1, 1), true);  // wall cell
  assert.equal(isSolidCell(map, 3, 3, 0, 0), false); // open cell
  assert.equal(isSolidCell(map, 3, 3, -1, 1), true); // out of bounds -> solid
  assert.equal(isSolidCell(map, 3, 3, 3, 1), true);  // out of bounds -> solid
});

test('collidesBoxGrid: stops at the wall cell, stays free in open space', () => {
  // 5x5, cell=1; only cell (gx=2,gz=2) is a wall. Cell i spans [i-0.5, i+0.5].
  const map = Array.from({ length: 5 }, () => new Array(5).fill(0));
  map[2][2] = 1;
  // Player box centered on the wall -> collides.
  assert.equal(collidesBoxGrid(map, 5, 5, 1, 2, 2, 0.2), true);
  // Far from the wall (box [0.5,0.9] never reaches the cell at [1.5,2.5]) -> free.
  assert.equal(collidesBoxGrid(map, 5, 5, 1, 0.7, 2, 0.2), false);
  // Box edge just reaches the wall cell -> collides (no phantom buffer beyond it).
  assert.equal(collidesBoxGrid(map, 5, 5, 1, 1.4, 2, 0.2), true);
});

test('collidesBoxGrid: scans the whole footprint (no thin-wall tunnelling)', () => {
  // A single-cell wall narrower than the player's diameter must still block:
  // 4-corner sampling at r=0.6 would straddle and miss cell 2; box-scan must not.
  const map = Array.from({ length: 5 }, () => new Array(5).fill(0));
  map[2][2] = 1;
  assert.equal(collidesBoxGrid(map, 5, 5, 1, 2, 2, 0.6), true);
});

test('collidesBoxGrid: treats out-of-bounds as solid (map border closes it)', () => {
  const map = Array.from({ length: 5 }, () => new Array(5).fill(0));
  assert.equal(collidesBoxGrid(map, 5, 5, 1, -0.4, 2, 0.2), true);
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

test('parryChance: valiente para más que tímido; defaults', () => {
  const valiente = parryChance(1, false);
  const timido = parryChance(0.2, false);
  assert.ok(valiente > timido);
  assert.ok(Math.abs(valiente - 0.75) < 1e-9); // 0.25 + 0.5*1
  assert.ok(Math.abs(timido - 0.35) < 1e-9);   // 0.25 + 0.5*0.2
});

test('parryChance: el pánico la penaliza y se mantiene en 0..1', () => {
  const calmado = parryChance(1, false);
  const enPanico = parryChance(1, true);
  assert.ok(enPanico < calmado);
  assert.ok(Math.abs(enPanico - 0.75 * 0.3) < 1e-9); // 0.225
  assert.equal(parryChance(5, false), 1);  // clamp arriba
  assert.equal(parryChance(-5, false), 0); // clamp abajo
});

test('rollParry: éxito si rng() < chance', () => {
  assert.equal(rollParry(0.5, () => 0.4), true);
  assert.equal(rollParry(0.5, () => 0.6), false);
  assert.equal(rollParry(0, () => 0), false); // 0 < 0 es false
});
