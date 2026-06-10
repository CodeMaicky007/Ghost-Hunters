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

import { depositCarried, depositedCount, allDeposited } from '../js/ritual.js';

test('depositCarried marca DEPOSITED y lo fija al altar', () => {
  const r = createRitual([[2, 3], [5, 6]], [4, 4]);
  pickup(r, 0, 7);
  assert.equal(depositCarried(r, 7), true);
  assert.equal(r.objects[0].status, OBJ.DEPOSITED);
  assert.deepEqual([r.objects[0].gx, r.objects[0].gz], [4, 4]);
  assert.equal(depositedCount(r), 1);
  assert.equal(allDeposited(r), false);
  assert.equal(r.phase, PHASE.GATHER);
});

test('depositar el último objeto pasa a fase CHANNEL', () => {
  const r = createRitual([[2, 3], [5, 6]], [4, 4]);
  pickup(r, 0, 1); depositCarried(r, 1);
  pickup(r, 1, 2); depositCarried(r, 2);
  assert.equal(allDeposited(r), true);
  assert.equal(r.phase, PHASE.CHANNEL);
});

import { channelTick } from '../js/ritual.js';

function channeling() {
  const r = createRitual([[1, 1]], [0, 0], { CHANNEL_TIME: 10, NEED_CHANNELERS: 2, CHANNEL_PENALTY: 0.5 });
  pickup(r, 0, 1); depositCarried(r, 1); // fuerza CHANNEL
  return r;
}

test('channelTick sube con >= needChannelers, no sube con menos', () => {
  const r = channeling();
  channelTick(r, 2, 1);             // +1/10
  assert.ok(Math.abs(r.channel - 0.1) < 1e-9);
  channelTick(r, 1, 1);             // pocos -> sin cambio
  assert.ok(Math.abs(r.channel - 0.1) < 1e-9);
});

test('channelTick retrocede con interrupt y nunca baja de 0', () => {
  const r = channeling();
  channelTick(r, 2, 1); // 0.1
  channelTick(r, 2, 1, { interrupt: true }); // -0.5 -> clamp 0
  assert.equal(r.channel, 0);
});

test('channelTick llega a DONE al 100%', () => {
  const r = channeling();
  for (let i = 0; i < 12; i++) channelTick(r, 2, 1); // 12s > 10s
  assert.equal(r.channel, 1);
  assert.equal(r.phase, PHASE.DONE);
});

test('channelTick no hace nada fuera de fase CHANNEL', () => {
  const r = createRitual([[1, 1]], [0, 0]); // GATHER
  assert.equal(channelTick(r, 5, 1), PHASE.GATHER);
  assert.equal(r.channel, 0);
});
