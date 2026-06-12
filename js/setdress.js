// ============================================================
//  Set dressing (R7): narrativa ambiental barata para los
//  Backrooms — papeles de oficina abandonados y manchas de
//  humedad en la moqueta. InstancedMesh: pocos draw calls.
// ============================================================
import * as THREE from 'three';

// Papel de oficina con "texto" garabateado (3 variantes procedurales).
function paperTexture(variant) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 84;
  const g = c.getContext('2d');
  g.fillStyle = ['#d8d2bd', '#cfc6ad', '#ded8c6'][variant % 3];
  g.fillRect(0, 0, 64, 84);
  g.strokeStyle = 'rgba(40,38,30,0.55)';
  g.lineWidth = 1.5;
  const rnd = (() => { let s = variant * 97 + 13; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  for (let y = 10; y < 76; y += 7) {
    g.beginPath(); g.moveTo(6, y);
    const len = 20 + rnd() * 36;
    g.lineTo(6 + len, y + (rnd() - 0.5) * 2);
    g.stroke();
  }
  if (variant % 3 === 1) { // mancha de café
    g.fillStyle = 'rgba(90,60,20,0.25)';
    g.beginPath(); g.arc(44, 22, 12, 0, 7); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

// Mancha de humedad: gradiente radial oscuro irregular.
function stainTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(12,10,4,0.55)');
  grad.addColorStop(0.6, 'rgba(14,12,5,0.3)');
  grad.addColorStop(1, 'rgba(14,12,5,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Reparte instancias planas sobre celdas transitables.
function scatterFlat(scene, geo, mat, cells, cellSize, count, y, scaleRange, rng) {
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const [gx, gz] = cells[Math.floor(rng() * cells.length)];
    v.set(gx * cellSize + (rng() - 0.5) * cellSize * 0.8, y, gz * cellSize + (rng() - 0.5) * cellSize * 0.8);
    e.set(-Math.PI / 2, 0, rng() * Math.PI * 2);
    q.setFromEuler(e);
    const sc = scaleRange[0] + rng() * (scaleRange[1] - scaleRange[0]);
    s.set(sc, sc, sc);
    m4.compose(v, q, s);
    inst.setMatrixAt(i, m4);
  }
  inst.instanceMatrix.needsUpdate = true;
  scene.add(inst);
  return inst;
}

export function dressFloor(scene, reachList, cellSize, rng = Math.random) {
  if (!reachList || !reachList.length) return;
  // Manchas primero (debajo de los papeles).
  const stainGeo = new THREE.PlaneGeometry(1, 1);
  const stainMat = new THREE.MeshBasicMaterial({
    map: stainTexture(), transparent: true, depthWrite: false,
  });
  const stains = scatterFlat(scene, stainGeo, stainMat, reachList, cellSize, 26, 0.012, [1.0, 2.6], rng);
  stains.renderOrder = 1;
  // Papeles (3 variantes, lambert: reaccionan a la luz y mueren en cacería).
  const paperGeo = new THREE.PlaneGeometry(0.28, 0.37);
  for (let v = 0; v < 3; v++) {
    const mat = new THREE.MeshLambertMaterial({ map: paperTexture(v), side: THREE.DoubleSide });
    const papers = scatterFlat(scene, paperGeo, mat, reachList, cellSize, 16, 0.02, [0.8, 1.15], rng);
    papers.renderOrder = 2;
  }
}
