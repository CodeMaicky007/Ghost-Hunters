import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, parseKey, createBlackboard } from '../js/ai.js';
import { discoverAround, computeFrontier } from '../js/ai.js';
import { bumpDanger, addEvent, decayDanger, dangerAt } from '../js/ai.js';
import { deriveFear, updateFear } from '../js/ai.js';
import { computeThreat, assignRoles, ROLES } from '../js/ai.js';
import { scoreCell, chooseGoal } from '../js/ai.js';
import { dispersalTargets } from '../js/ai.js';

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

import { AI } from '../js/ai.js';

test('bumpDanger acumula y dangerAt lee', () => {
  const bb = createBlackboard();
  bumpDanger(bb, 1, 1, 2);
  bumpDanger(bb, 1, 1, 1);
  assert.equal(dangerAt(bb, 1, 1), 3);
  assert.equal(dangerAt(bb, 9, 9), 0);
});

test('addEvent encola y sube el peligro de la celda', () => {
  const bb = createBlackboard();
  addEvent(bb, 'roar', 4, 5, 12.3);
  assert.equal(bb.events.length, 1);
  assert.deepEqual(bb.events[0], { type: 'roar', gx: 4, gz: 5, t: 12.3 });
  assert.equal(dangerAt(bb, 4, 5), AI.EVENT_DANGER);
});

test('decayDanger reduce con el tiempo y borra lo despreciable', () => {
  const bb = createBlackboard();
  bumpDanger(bb, 0, 0, 1);
  decayDanger(bb, 1, 0.5, 0.05); // *0.5 en 1s -> 0.5
  assert.ok(Math.abs(dangerAt(bb, 0, 0) - 0.5) < 1e-9);
  decayDanger(bb, 5, 0.5, 0.05); // *0.5^5 -> ~0.0156 < min -> borrado
  assert.equal(bb.danger.has('0,0'), false);
});

test('deriveFear sube con estrés/baja cordura y baja con valentía', () => {
  assert.ok(deriveFear(0, 1, 0) === 0);
  const a = deriveFear(0.8, 0.2, 0); // mucho estrés, poca cordura
  const b = deriveFear(0.8, 0.2, 1); // igual pero muy valiente
  assert.ok(a > b);
  assert.ok(a > 0 && a <= 1);
});

test('updateFear entra en PÁNICO con estrés alto y cordura baja', () => {
  const ag = { stress: 0.86, sanity: 0.15, bravery: 0, panic: false };
  const r = updateFear(ag, {}, 0); // dt=0: sin deriva, evalúa umbrales
  assert.equal(r.panic, true);
});

test('updateFear sale de pánico cuando el miedo baja (histéresis)', () => {
  const ag = { stress: 0.3, sanity: 0.9, bravery: 0.5, panic: true };
  const r = updateFear(ag, {}, 0);
  assert.equal(r.panic, false);
});

test('updateFear acumula estrés cerca del fantasma y lo calma agrupado+seguro', () => {
  const ag = { stress: 0.2, sanity: 1, bravery: 0, panic: false };
  const up = updateFear(ag, { nearGhost: true }, 1);
  assert.ok(up.stress > 0.2);
  const ag2 = { stress: 0.5, sanity: 1, bravery: 0, panic: false };
  const down = updateFear(ag2, { grouped: true, safe: true }, 1);
  assert.ok(down.stress < 0.5);
});

test('computeThreat: cacería dispara reagrupamiento, calma no', () => {
  assert.ok(computeThreat({ hunting: true, recentEvents: 0, deaths: 0, avgFear: 0 }) >= AI.THREAT_REGROUP);
  assert.ok(computeThreat({ hunting: false, recentEvents: 0, deaths: 0, avgFear: 0.1 }) < AI.THREAT_REGROUP);
});

test('assignRoles reparte 8 vivos en 2+2+2+2 por quartiles de valentía', () => {
  const agents = Array.from({ length: 8 }, (_, i) => ({ id: i, alive: true, bravery: i / 7 }));
  const roles = assignRoles(agents, 0);
  const counts = {};
  for (const r of roles.values()) counts[r] = (counts[r] || 0) + 1;
  assert.equal(counts[ROLES.EXPLORE_A], 2);
  assert.equal(counts[ROLES.EXPLORE_B], 2);
  assert.equal(counts[ROLES.GUARD], 2);
  assert.equal(counts[ROLES.SCAVENGE], 2);
  // El más valiente explora; el más miedoso recolecta.
  assert.equal(roles.get(7), ROLES.EXPLORE_A);
  assert.equal(roles.get(0), ROLES.SCAVENGE);
});

test('assignRoles con amenaza alta pone a todos en REGROUP (solo vivos)', () => {
  const agents = [{ id: 0, alive: true, bravery: 0.5 }, { id: 1, alive: false, bravery: 0.5 }];
  const roles = assignRoles(agents, 1);
  assert.equal(roles.get(0), ROLES.REGROUP);
  assert.equal(roles.has(1), false);
});

const baseAgent = () => ({ fear: 0.2, recentCells: [] });

test('scoreCell penaliza el peligro y escala con el miedo', () => {
  const bb = createBlackboard();
  bumpDanger(bb, 5, 5, 2);
  const ag = baseAgent();
  const calm = scoreCell({ gx: 5, gz: 5, bias: 0 }, ag, bb, [], AI);
  ag.fear = 0.9;
  const scared = scoreCell({ gx: 5, gz: 5, bias: 0 }, ag, bb, [], AI);
  assert.ok(scared < calm); // más miedo -> evita más el peligro
});

test('chooseGoal elige la candidata segura frente a la peligrosa', () => {
  const bb = createBlackboard();
  bumpDanger(bb, 5, 5, 3);
  const goal = chooseGoal(baseAgent(), [{ gx: 0, gz: 0, bias: 0 }, { gx: 5, gz: 5, bias: 0 }], bb, [], AI);
  assert.deepEqual(goal, [0, 0]);
});

test('chooseGoal evita celdas recién visitadas', () => {
  const bb = createBlackboard();
  const ag = baseAgent();
  ag.recentCells = ['0,0'];
  const goal = chooseGoal(ag, [{ gx: 0, gz: 0, bias: 0 }, { gx: 9, gz: 9, bias: 0 }], bb, [], AI);
  assert.deepEqual(goal, [9, 9]);
});

test('chooseGoal con miedo prefiere acercarse a los aliados', () => {
  const bb = createBlackboard();
  const ag = baseAgent();
  ag.fear = 0.9;
  const allies = [{ gx: 1, gz: 1 }];
  const goal = chooseGoal(ag, [{ gx: 2, gz: 2, bias: 0 }, { gx: 9, gz: 9, bias: 0 }], bb, allies, AI);
  assert.deepEqual(goal, [2, 2]);
});

test('chooseGoal sin candidatas devuelve null', () => {
  assert.equal(chooseGoal(baseAgent(), [], createBlackboard(), [], AI), null);
});

test('dispersalTargets asigna celdas distintas y lejos del fantasma', () => {
  const agents = [{ id: 0, gx: 1, gz: 1 }, { id: 1, gx: 2, gz: 1 }, { id: 2, gx: 1, gz: 2 }];
  const ghost = { gx: 0, gz: 0 };
  const safe = [{ gx: 9, gz: 9 }, { gx: 8, gz: 1 }, { gx: 1, gz: 8 }, { gx: 0, gz: 1 }];
  const out = dispersalTargets(agents, ghost, safe, AI);
  assert.equal(out.size, 3);
  const cells = [...out.values()].map((c) => c.join(','));
  assert.equal(new Set(cells).size, 3); // todas distintas
  // ninguna es la celda pegada al fantasma (0,1) si hay alternativas
  assert.ok(!cells.includes('0,1'));
});

test('dispersalTargets no asigna más agentes que celdas seguras', () => {
  const agents = [{ id: 0, gx: 0, gz: 0 }, { id: 1, gx: 0, gz: 0 }];
  const out = dispersalTargets(agents, { gx: 5, gz: 5 }, [{ gx: 1, gz: 1 }], AI);
  assert.equal(out.size, 1);
});
