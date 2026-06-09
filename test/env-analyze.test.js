import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeEnvMeshes } from '../js/logic.js';

// --- Extractor de AABB por malla del GLB (aplica transformaciones de nodos) ---
function envBoxes(path) {
  const b = readFileSync(path);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + len).toString('utf8'));
  const mul = (a, c) => {
    const r = new Array(16);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) { let s = 0; for (let n = 0; n < 4; n++) s += a[i * 4 + n] * c[n * 4 + k]; r[i * 4 + k] = s; }
    return r;
  };
  const trs = (n) => {
    if (n.matrix) { const m = n.matrix; return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]]; }
    const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [(1 - (yy + zz)) * s[0], (xy - wz) * s[1], (xz + wy) * s[2], t[0],
            (xy + wz) * s[0], (1 - (xx + zz)) * s[1], (yz - wx) * s[2], t[1],
            (xz - wy) * s[0], (yz + wx) * s[1], (1 - (xx + yy)) * s[2], t[2],
            0, 0, 0, 1];
  };
  const apply = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
  const boxes = [];
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = j.scenes[j.scene || 0];
  const rec = (ni, parent) => {
    const n = j.nodes[ni];
    const world = mul(parent, trs(n));
    if (n.mesh != null) {
      const mesh = j.meshes[n.mesh];
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const pr of mesh.primitives) {
        const acc = j.accessors[pr.attributes.POSITION]; if (!acc.min) continue;
        const c = [acc.min, acc.max];
        for (let a = 0; a < 2; a++) for (let bb = 0; bb < 2; bb++) for (let cc = 0; cc < 2; cc++) {
          const w = apply(world, [c[a][0], c[bb][1], c[cc][2]]);
          for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); }
        }
      }
      boxes.push({ minX: mn[0], maxX: mx[0], minY: mn[1], maxY: mx[1], minZ: mn[2], maxZ: mx[2] });
    }
    for (const c of (n.children || [])) rec(c, world);
  };
  for (const ni of scene.nodes) rec(ni, I);
  return boxes;
}

test('analyzeEnvMeshes detecta cáscara, suelo/techo y >=10 muros en el modelo real', () => {
  const boxes = envBoxes('assets/models/model-enviroment/source/backrooms.glb');
  const r = analyzeEnvMeshes(boxes);
  // Hay muros suficientes para subdividir el espacio (los Cube.00X).
  assert.ok(r.walls.length >= 10, `esperaba >=10 muros, hubo ${r.walls.length}`);
  // La altura de la sala es razonable (techo nativo ~8.6-8.8).
  assert.ok(r.ceilHeight > 7 && r.ceilHeight < 11, `ceilHeight=${r.ceilHeight}`);
  // El suelo de la sala está cerca de y=0 (la cáscara, que baja a ~-38, queda excluida).
  assert.ok(Math.abs(r.floorY) < 1.5, `floorY=${r.floorY}`);
  // Suelo, techo y cáscara identificados y distintos entre sí.
  assert.ok(r.floor >= 0 && r.ceiling >= 0 && r.shell >= 0);
  assert.notEqual(r.floor, r.shell);
  assert.notEqual(r.ceiling, r.shell);
  // La cáscara NO está entre los muros a raycastear.
  assert.ok(!r.walls.includes(r.shell));
});
