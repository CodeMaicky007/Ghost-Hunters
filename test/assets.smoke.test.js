import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

function glbJson(path) {
  const b = readFileSync(path);
  assert.equal(b.readUInt32LE(0), 0x46546c67, 'magic glTF');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.slice(20, 20 + len).toString('utf8'));
}

test('backrooms env GLB parses and has meshes', () => {
  const p = 'assets/models/model-enviroment/source/backrooms.glb';
  assert.ok(existsSync(p), 'env GLB exists');
  const j = glbJson(p);
  assert.ok(j.meshes.length >= 10, 'has wall/plane meshes');
  assert.equal((j.extensionsRequired || []).length, 0, 'no required compression ext');
});

test('Adventurer character GLB has the animations we map', () => {
  const j = glbJson('assets/models/characters/Adventurer.glb');
  const names = (j.animations || []).map((a) => a.name);
  for (const need of ['Idle', 'Walk', 'Run', 'Interact', 'Death']) {
    assert.ok(names.some((n) => n.endsWith('|' + need)), 'has ' + need);
  }
});
