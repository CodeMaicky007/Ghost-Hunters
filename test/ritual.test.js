import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRitual, RCFG, OBJ, PHASE, RROLE,
  pickup, objectCarriedBy, dropCarried,
  depositCarried, depositedCount, allDeposited,
  channelTick, discoverableCells, assignRitualRoles,
} from '../js/ritual.js';

test('createRitual inicializa objetos ON_MAP y fase GATHER', () => {
  const r = createRitual([],[[2, 3], [5, 6]], [4, 4], { NEED_CHANNELERS: 2, CHANNEL_TIME: 10 });
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
  const r = createRitual([],[[1, 1]], [0, 0]);
  assert.equal(r.needChannelers, RCFG.NEED_CHANNELERS);
  assert.equal(r.channelTime, RCFG.CHANNEL_TIME);
});

test('pickup coge un objeto ON_MAP y lo marca CARRIED', () => {
  const r = createRitual([],[[2, 3]], [4, 4]);
  assert.equal(pickup(r, 0, 7), true);
  assert.equal(r.objects[0].status, OBJ.CARRIED);
  assert.equal(r.objects[0].carrier, 7);
  assert.equal(pickup(r, 0, 9), false); // ya cargado -> no
});

test('pickup rechaza coger un segundo objeto si ya llevas uno', () => {
  const r = createRitual([],[[1, 1], [2, 2]], [0, 0]);
  pickup(r, 0, 7);
  assert.equal(pickup(r, 1, 7), false); // ya cargando -> no
  assert.equal(r.objects[1].status, OBJ.ON_MAP);
});

test('objectCarriedBy devuelve el objeto que carga un agente', () => {
  const r = createRitual([],[[2, 3], [5, 6]], [4, 4]);
  pickup(r, 1, 3);
  assert.equal(objectCarriedBy(r, 3).id, 1);
  assert.equal(objectCarriedBy(r, 99), null);
});

test('dropCarried suelta el objeto en la celda dada', () => {
  const r = createRitual([],[[2, 3]], [4, 4]);
  pickup(r, 0, 7);
  assert.equal(dropCarried(r, 7, 8, 9), true);
  assert.equal(r.objects[0].status, OBJ.ON_MAP);
  assert.equal(r.objects[0].carrier, null);
  assert.deepEqual([r.objects[0].gx, r.objects[0].gz], [8, 9]);
  assert.equal(dropCarried(r, 7, 1, 1), false); // ya no carga nada
});

test('depositCarried marca DEPOSITED y lo fija al altar', () => {
  const r = createRitual([],[[2, 3], [5, 6]], [4, 4]);
  pickup(r, 0, 7);
  assert.equal(depositCarried(r, 7), true);
  assert.equal(r.objects[0].status, OBJ.DEPOSITED);
  assert.deepEqual([r.objects[0].gx, r.objects[0].gz], [4, 4]);
  assert.equal(depositedCount(r), 1);
  assert.equal(allDeposited(r), false);
  assert.equal(r.phase, PHASE.GATHER);
});

test('depositar el último objeto pasa a fase CHANNEL', () => {
  const r = createRitual([],[[2, 3], [5, 6]], [4, 4]);
  pickup(r, 0, 1); depositCarried(r, 1);
  pickup(r, 1, 2); depositCarried(r, 2);
  assert.equal(allDeposited(r), true);
  assert.equal(r.phase, PHASE.CHANNEL);
});

function channeling() {
  const r = createRitual([],[[1, 1]], [0, 0], { CHANNEL_TIME: 10, NEED_CHANNELERS: 2, CHANNEL_PENALTY: 0.5 });
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
  const r = createRitual([],[[1, 1]], [0, 0]); // GATHER
  assert.equal(channelTick(r, 5, 1), PHASE.GATHER);
  assert.equal(r.channel, 0);
});

test('discoverableCells da altar + objetos ON_MAP (no los cargados/depositados)', () => {
  const r = createRitual([],[[2, 3], [5, 6]], [4, 4]);
  pickup(r, 0, 1); // objeto 0 pasa a CARRIED -> no descubrible como suelto
  const cells = discoverableCells(r).map(([x, z]) => x + ',' + z).sort();
  assert.deepEqual(cells, ['4,4', '5,6']); // altar + objeto 1 ON_MAP
});

const mkAgents = (n) => Array.from({ length: n }, (_, i) => ({ id: i, alive: true, bravery: i / (n - 1), gx: i, gz: 0 }));

test('GATHER: 8 vivos -> 4 FETCH + 2 EXPLORE_A + 2 EXPLORE_B; portador forzado a FETCH', () => {
  const r = createRitual([],[[1, 1], [2, 2]], [0, 0]);
  const agents = mkAgents(8);
  const roles = assignRitualRoles(agents, r, 0);
  const counts = {};
  for (const v of roles.values()) counts[v] = (counts[v] || 0) + 1;
  assert.equal(counts[RROLE.FETCH], 4);
  assert.equal(counts[RROLE.EXPLORE_A], 2);
  assert.equal(counts[RROLE.EXPLORE_B], 2);
  // un portador siempre FETCH aunque por valentía cayera en EXPLORE
  pickup(r, 0, 7);
  const roles2 = assignRitualRoles(agents, r, 0);
  assert.equal(roles2.get(7), RROLE.FETCH);
});

test('GATHER con escuadra pequeña (n=4): 2 FETCH + 1 EXPLORE_A + 1 EXPLORE_B', () => {
  const r = createRitual([],[[1, 1]], [0, 0]);
  const roles = assignRitualRoles(mkAgents(4), r, 0);
  const counts = {};
  for (const v of roles.values()) counts[v] = (counts[v] || 0) + 1;
  assert.equal(counts[RROLE.FETCH], 2);
  assert.equal(counts[RROLE.EXPLORE_A], 1);
  assert.equal(counts[RROLE.EXPLORE_B], 1);
});

test('CHANNEL: needChannelers como CHANNELER (los más cercanos al altar), resto DEFEND/DISTRACT', () => {
  const r = createRitual([],[[1, 1], [2, 2]], [0, 0]);
  pickup(r, 0, 1); depositCarried(r, 1); pickup(r, 1, 2); depositCarried(r, 2); // -> CHANNEL
  // agentes a distancias crecientes del altar (gx); needChannelers=2
  const agents = mkAgents(6);
  const roles = assignRitualRoles(agents, r, 0);
  const counts = {};
  for (const v of roles.values()) counts[v] = (counts[v] || 0) + 1;
  assert.equal(counts[RROLE.CHANNELER], 2);
  assert.equal(roles.get(0), RROLE.CHANNELER); // el más cercano (gx=0)
  assert.equal(roles.get(1), RROLE.CHANNELER);
  assert.ok((counts[RROLE.DEFEND] || 0) + (counts[RROLE.DISTRACT] || 0) === 4);
});

test('CHANNEL bajo amenaza alta: sin DISTRACT', () => {
  const r = createRitual([],[[1, 1]], [0, 0]);
  pickup(r, 0, 1); depositCarried(r, 1); // -> CHANNEL
  const agents = mkAgents(6);
  const roles = assignRitualRoles(agents, r, 1); // threat alto
  assert.ok(![...roles.values()].includes(RROLE.DISTRACT));
});

test('createRitual con misiones empieza en MISSIONS; sin misiones, en GATHER', () => {
  const conM = createRitual([[1, 1]], [[2, 2]], [0, 0]);
  assert.equal(conM.phase, PHASE.MISSIONS);
  assert.equal(conM.missions.length, 1);
  assert.equal(conM.needMissions, 1);
  const sinM = createRitual([], [[2, 2]], [0, 0]);
  assert.equal(sinM.phase, PHASE.GATHER);
  assert.equal(sinM.missions.length, 0);
});
