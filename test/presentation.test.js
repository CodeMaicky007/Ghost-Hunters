// Tests de la lógica pura de presentación (R7): paneles, flicker, cámara, latido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickPanelCells, spreadPicks, fluorFlicker,
  decayTrauma, shakeAmp, heartbeatInterval,
} from '../js/logic.js';

// --- pickPanelCells ---

test('pickPanelCells: solo celdas abiertas, en rejilla cada step', () => {
  const n = 10;
  const map = Array.from({ length: n }, () => new Array(n).fill(0));
  map[2][2] = 1; // muro justo donde caería un panel
  const cells = pickPanelCells(map, n, n, 5);
  // step=5, off=2 -> candidatas (2,2),(7,2),(2,7),(7,7); (2,2) es muro
  assert.equal(cells.length, 3);
  for (const [x, z] of cells) {
    assert.equal(map[z][x], 0);
    assert.equal(x % 5, 2);
    assert.equal(z % 5, 2);
  }
});

test('pickPanelCells: mapa todo muro -> sin paneles', () => {
  const map = Array.from({ length: 6 }, () => new Array(6).fill(1));
  assert.deepEqual(pickPanelCells(map, 6, 6, 3), []);
});

// --- spreadPicks ---

test('spreadPicks: determinista y devuelve k elementos repartidos', () => {
  const cells = [[0, 0], [0, 1], [9, 9], [9, 8], [0, 9], [9, 0]];
  const a = spreadPicks(cells, 3);
  const b = spreadPicks(cells, 3);
  assert.deepEqual(a, b);                 // determinista
  assert.equal(a.length, 3);
  // la 2ª pick debe ser la más lejana a la 1ª (esquina opuesta)
  assert.deepEqual(a[0], [0, 0]);
  assert.deepEqual(a[1], [9, 9]);
});

test('spreadPicks: k mayor que el pool no repite de más', () => {
  const cells = [[1, 1], [2, 2]];
  assert.equal(spreadPicks(cells, 10).length, 2);
  assert.deepEqual(spreadPicks([], 3), []);
  assert.deepEqual(spreadPicks(cells, 0), []);
});

// --- fluorFlicker ---

test('fluorFlicker: determinista, en rango [0,1] y mayormente encendido', () => {
  assert.equal(fluorFlicker(1.25, 7), fluorFlicker(1.25, 7)); // determinista
  let sum = 0, n = 0;
  for (let t = 0; t < 30; t += 0.05) {
    const v = fluorFlicker(t, 3);
    assert.ok(v >= 0 && v <= 1, `fuera de rango: ${v}`);
    sum += v; n++;
  }
  assert.ok(sum / n > 0.8, 'el panel debe estar encendido la mayor parte del tiempo');
});

test('fluorFlicker: seeds distintas dan secuencias distintas', () => {
  let diff = 0;
  for (let t = 0; t < 5; t += 0.1) if (fluorFlicker(t, 1) !== fluorFlicker(t, 2)) diff++;
  assert.ok(diff > 10);
});

// --- trauma / shake ---

test('decayTrauma: decae lineal y clampa en 0', () => {
  assert.equal(decayTrauma(1, 0.1, 1.5), 1 - 0.15);
  assert.equal(decayTrauma(0.05, 1, 1.5), 0);
});

test('shakeAmp: cuadrática (susto pequeño apenas mueve)', () => {
  assert.equal(shakeAmp(0), 0);
  assert.equal(shakeAmp(1), 1);
  assert.ok(shakeAmp(0.3) < 0.3 / 2);
});

// --- heartbeat ---

test('heartbeatInterval: monótono (más cerca = más rápido) y acotado', () => {
  assert.equal(heartbeatInterval(0), 1.3);
  assert.ok(Math.abs(heartbeatInterval(1) - 0.45) < 1e-9);
  assert.ok(heartbeatInterval(0.5) < heartbeatInterval(0.2));
  assert.equal(heartbeatInterval(-1), 1.3);  // clamp
  assert.ok(Math.abs(heartbeatInterval(2) - 0.45) < 1e-9);
});
