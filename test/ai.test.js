import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, parseKey, createBlackboard } from '../js/ai.js';
import { discoverAround, computeFrontier } from '../js/ai.js';

const openAll = () => true;

test('cellKey/parseKey round-trip', () => {
  assert.equal(cellKey(3, 5), '3,5');
  assert.deepEqual(parseKey('3,5'), [3, 5]);
});

test('createBlackboard has empty collections', () => {
  const bb = createBlackboard();
  assert.equal(bb.discovered.size, 0);
  assert.equal(bb.objectives.size, 0);
  assert.equal(bb.danger.size, 0);
  assert.deepEqual(bb.events, []);
  assert.deepEqual(bb.roster, []);
});

test('discoverAround marca el disco Manhattan de celdas abiertas', () => {
  const bb = createBlackboard();
  const added = discoverAround(bb, 2, 2, 1, openAll);
  assert.equal(added, 5); // centro + 4 vecinas (Manhattan<=1)
  assert.ok(bb.discovered.has('2,2'));
  assert.ok(bb.discovered.has('3,2'));
  assert.ok(!bb.discovered.has('3,3')); // diagonal fuera del disco r=1
});

test('discoverAround respeta isOpen y no recuenta', () => {
  const bb = createBlackboard();
  const isOpen = (x, z) => !(x === 3 && z === 2); // (3,2) es muro
  const added = discoverAround(bb, 2, 2, 1, isOpen);
  assert.equal(added, 4);
  assert.ok(!bb.discovered.has('3,2'));
  assert.equal(discoverAround(bb, 2, 2, 1, isOpen), 0); // ya descubiertas
});

test('computeFrontier devuelve vecinas abiertas no descubiertas', () => {
  const bb = createBlackboard();
  bb.discovered.add('2,2');
  const front = computeFrontier(bb, openAll);
  const keys = front.map(([x, z]) => x + ',' + z).sort();
  assert.deepEqual(keys, ['1,2', '2,1', '2,3', '3,2']);
});
