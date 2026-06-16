import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pickDistinct } from './logic.js';

const loader = new GLTFLoader();

export const ENV_URL = 'assets/models/model-enviroment/source/backrooms.glb';

// Slots de objetos del ritual -> archivo GLB real (Sketchfab/CC0) o null para usar
// el modelo procedural de respaldo (js/propmodels.js). Edita aquí al añadir modelos.
export const OBJ_DIR = 'assets/models/objects/';
export const SLOT_FILES = {
  mission: 'proyecto_final_televisor_entrega.glb',  // TV que los investigadores apagan
  altar: null,                                       // -> altar procedural de piedra
  cross: null,                                       // -> cruz procedural de madera
};


// Nombres exactos de archivo (con espacios) del pack de personajes.
export const CHARACTER_FILES = [
  'Adventurer', 'Astronaut', 'Beach Character', 'Business Man', 'Casual Character',
  'Farmer', 'Hoodie Character', 'King', 'Punk', 'Swat', 'Worker',
];
const charUrl = (name) => 'assets/models/characters/' + encodeURIComponent(name) + '.glb';

export function loadGLB(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

// Da por nulo un load que tarde demasiado: un asset opcional lento/colgado NUNCA
// debe bloquear el arranque del juego.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((res) => setTimeout(() => res(null), ms))]);
}

// Carga el entorno + n personajes distintos. onProgress(fraction 0..1).
// Esenciales (entorno + personajes): si fallan, se propaga el error y boot()
// usa el entorno procedural completo.
export async function loadAllAssets(n, onProgress = () => {}) {
  const chosen = pickDistinct(CHARACTER_FILES, n);
  const jobs = [
    { key: 'env', url: ENV_URL },
    // Slots del ritual: opcionales (si no hay archivo -> modelo procedural).
    ...Object.entries(SLOT_FILES).filter(([, f]) => f).map(([s, f]) => ({ key: s, url: OBJ_DIR + f, optional: true })),
    // (linternas y monstruo retirados: no se cargan)
    // Mobiliario de la "sala temática" (sillón + juego de sillas).
    { key: 'armchair', url: OBJ_DIR + 'backrooms_movie_armchair.glb', optional: true },
    { key: 'chairs', url: OBJ_DIR + 'the_backrooms_chairs.glb', optional: true },
    ...chosen.map((name) => ({ key: name, url: charUrl(name) })),
  ];
  let done = 0;
  const results = {};
  await Promise.all(jobs.map(async (job) => {
    try {
      const load = loadGLB(job.url);
      results[job.key] = job.optional ? await withTimeout(load, 20000) : await load;
    } catch (e) {
      if (!job.optional) throw e;   // esenciales (entorno/personajes): propaga
      results[job.key] = null;      // slot vacío -> makeRitual usa el procedural
    }
    done++; onProgress(done / jobs.length);
  }));
  return {
    env: results.env,
    mission: results.mission, altar: results.altar, cross: results.cross,
    armchair: results.armchair, chairs: results.chairs,
    chars: chosen.map((name) => ({ name, gltf: results[name] })),
  };
}
