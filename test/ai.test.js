import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, parseKey, createBlackboard } from '../js/ai.js';

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
