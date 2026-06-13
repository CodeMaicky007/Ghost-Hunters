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

// Avatar de la entidad (el jugador): monstruo Backrooms con animaciones.
export const MONSTER_URL = 'assets/models/characters/MONSTER/accurate_backrooms_bacteria_v2_with_animations.glb';

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
    // Slots del ritual: opcionales (si no hay archivo -> modelo procedural).
    ...Object.entries(SLOT_FILES).filter(([, f]) => f).map(([s, f]) => ({ key: s, url: OBJ_DIR + f, optional: true })),
    // Linterna que llevan los investigadores (prop que se cuelga al rig de luz).
    { key: 'flashlight', url: OBJ_DIR + 'flashlight.glb', optional: true },
    // Avatar-monstruo de la entidad (opcional: si falta, el fantasma es invisible).
    { key: 'monster', url: MONSTER_URL, optional: true },
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
    flashlight: results.flashlight, monster: results.monster,
    chars: chosen.map((name) => ({ name, gltf: results[name] })),
  };
}
