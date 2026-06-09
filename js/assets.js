import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pickDistinct } from './logic.js';

const loader = new GLTFLoader();

export const ENV_URL = 'assets/models/model-enviroment/source/backrooms.glb';

// Nombres exactos de archivo (con espacios) del pack de personajes.
export const CHARACTER_FILES = [
  'Adventurer', 'Astronaut', 'Beach Character', 'Business Man', 'Casual Character',
  'Farmer', 'Hoodie Character', 'King', 'Punk', 'Swat', 'Worker',
];
const charUrl = (name) => 'assets/models/characters/' + encodeURIComponent(name) + '.glb';

export function loadGLB(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

// Carga el entorno + n personajes distintos. onProgress(fraction 0..1).
export async function loadAllAssets(n, onProgress = () => {}) {
  const chosen = pickDistinct(CHARACTER_FILES, n);
  const jobs = [{ key: 'env', url: ENV_URL }, ...chosen.map((name) => ({ key: name, url: charUrl(name) }))];
  let done = 0;
  const results = {};
  await Promise.all(jobs.map(async (job) => {
    results[job.key] = await loadGLB(job.url);
    done++; onProgress(done / jobs.length);
  }));
  return { env: results.env, chars: chosen.map((name) => ({ name, gltf: results[name] })) };
}
