import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRitual, RCFG, OBJ, PHASE } from '../js/ritual.js';

test('createRitual inicializa objetos ON_MAP y fase GATHER', () => {
  const r = createRitual([[2, 3], [5, 6]], [4, 4], { NEED_CHANNELERS: 2, CHANNEL_TIME: 10 });
  assert.equal(r.phase, PHASE.GATHER);
  assert.equal(r.channel, 0);
  assert.equal(r.altar.gx, 4);
  assert.equal(r.altar.gz, 4);
  assert.equal(r.objects.length, 2);
  assert.equal(r.needObjects, 2);
  assert.equal(r.needChannelers, 2);
  assert.equal(r.channelTime, 10);
  assert.deepEqual(
    r.objects.map((o) => [o.id, o.gx, o.gz, o.status, o.carrier]),
    [[0, 2, 3, OBJ.ON_MAP, null], [1, 5, 6, OBJ.ON_MAP, null]]
  );
});

test('createRitual usa los defaults RCFG si no se pasan opts', () => {
  const r = createRitual([[1, 1]], [0, 0]);
  assert.equal(r.needChannelers, RCFG.NEED_CHANNELERS);
  assert.equal(r.channelTime, RCFG.CHANNEL_TIME);
});

import { pickup, objectCarriedBy, dropCarried } from '../js/ritual.js';

test('pickup coge un objeto ON_MAP y lo marca CARRIED', () => {
  const r = createRitual([[2, 3]], [4, 4]);
  assert.equal(pickup(r, 0, 7), true);
  assert.equal(r.objects[0].status, OBJ.CARRIED);
  assert.equal(r.objects[0].carrier, 7);
  assert.equal(pickup(r, 0, 9), false); // ya cargado -> no
});

test('objectCarriedBy devuelve el objeto que carga un agente', () => {
  const r = createRitual([[2, 3], [5, 6]], [4, 4]);
  pickup(r, 1, 3);
  assert.equal(objectCarriedBy(r, 3).id, 1);
  assert.equal(objectCarriedBy(r, 99), null);
});

test('dropCarried suelta el objeto en la celda dada', () => {
  const r = createRitual([[2, 3]], [4, 4]);
  pickup(r, 0, 7);
  assert.equal(dropCarried(r, 7, 8, 9), true);
  assert.equal(r.objects[0].status, OBJ.ON_MAP);
  assert.equal(r.objects[0].carrier, null);
  assert.deepEqual([r.objects[0].gx, r.objects[0].gz], [8, 9]);
  assert.equal(dropCarried(r, 7, 1, 1), false); // ya no carga nada
});
