import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pickDistinct } from './logic.js';

const loader = new GLTFLoader();

export const ENV_URL = 'assets/models/model-enviroment/source/backrooms.glb';

// Slots "drop-in" de objetos del ritual: si existe el .glb se usa tal cual; si
// no (404), makeRitual cae al modelo procedural de js/propmodels.js. Así puedes
// soltar un modelo (p. ej. de Sketchfab) en assets/models/objects/<slot>.glb y
// el juego lo coge sin tocar código. Slots: mission / altar / cross.
export const OBJ_DIR = 'assets/models/objects/';
export const RITUAL_SLOTS = ['mission', 'altar', 'cross'];

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
// Esenciales (entorno + personajes): si fallan, se propaga el error y boot()
// usa el entorno procedural completo.
export async function loadAllAssets(n, onProgress = () => {}) {
  const chosen = pickDistinct(CHARACTER_FILES, n);
  const jobs = [
    { key: 'env', url: ENV_URL },
    // Slots del ritual: opcionales (si no existe el .glb -> modelo procedural).
    ...RITUAL_SLOTS.map((s) => ({ key: s, url: OBJ_DIR + s + '.glb', optional: true })),
    // Linterna que llevan los investigadores (prop que se cuelga al rig de luz).
    { key: 'flashlight', url: OBJ_DIR + 'flashlight.glb', optional: true },
    ...chosen.map((name) => ({ key: name, url: charUrl(name) })),
  ];
  let done = 0;
  const results = {};
  await Promise.all(jobs.map(async (job) => {
    try {
      results[job.key] = await loadGLB(job.url);
    } catch (e) {
      if (!job.optional) throw e;   // esenciales (entorno/personajes): propaga
      results[job.key] = null;      // slot vacío -> makeRitual usa el procedural
    }
    done++; onProgress(done / jobs.length);
  }));
  return {
    env: results.env,
    mission: results.mission, altar: results.altar, cross: results.cross,
    flashlight: results.flashlight,
    chars: chosen.map((name) => ({ name, gltf: results[name] })),
  };
}
