// Verificación visual headless (dev-only): abre el juego con #dbg, oculta el
// overlay vía window.__dbg y captura PNGs (menú / normal / cacería).
// Uso: node scripts/shot.mjs   (requiere servidor en :8080 y Chrome instalado)
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!CHROME) { console.error('Chrome no encontrado'); process.exit(1); }

const PORT = 9333;
const URL = 'http://localhost:8080/#dbg';
mkdirSync('shots', { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--window-size=1280,720', '--disable-gpu-sandbox', '--no-first-run',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json/version`);
      return (await res.json()).webSocketDebuggerUrl;
    } catch { await sleep(250); }
  }
  throw new Error('CDP no responde');
}

let msgId = 0;
const pending = new Map();
let ws;
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function main() {
  ws = new WebSocket(await getWsUrl());
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };

  const { targetId } = await send('Target.createTarget', { url: URL });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
    return r.result && r.result.value;
  };
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(`shots/${name}.png`, Buffer.from(data, 'base64'));
    console.log('shot:', name);
  };

  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);

  // Espera a que boot() termine (aparece __dbg) — la carga de GLB tarda.
  for (let i = 0; i < 120; i++) {
    if (await evalJs('!!window.__dbg')) break;
    await sleep(500);
  }
  if (!(await evalJs('!!window.__dbg'))) throw new Error('__dbg no apareció: boot no terminó');
  console.log('boot OK:', JSON.stringify(await evalJs('window.__dbg.state()')));

  await sleep(800);
  await shot('1-menu');

  await evalJs('window.__dbg.hide()');
  await sleep(1200);
  await shot('2-normal');

  // Mira hacia un punto con cazadores si es posible; varias vistas.
  await evalJs('window.__dbg.look(2.4, -0.05)');
  await sleep(400);
  await shot('3-normal-b');

  await evalJs('window.__dbg.hunt()');
  await sleep(1800);
  await shot('4-caceria');

  await evalJs('window.__dbg.endHunt()');
  await sleep(1500);
  await shot('5-vuelta');

  // Techo: verifica los paneles fluorescentes.
  await evalJs('window.__dbg.look(2.4, 1.1)');
  await sleep(400);
  await shot('6-techo');

  // Vista desde el centro del mapa (zona jugable real, no el borde).
  await evalJs('window.__dbg.tp(50, 50); window.__dbg.look(0.8, 0)');
  await sleep(600);
  await shot('7-centro');

  // Cazador de cerca: modelo + linterna (cono + spot).
  await evalJs('window.__dbg.nearHunter(0)');
  await sleep(600);
  await shot('8-cazador');

  // El mismo en cacería (estroboscopia de linterna, oscuridad).
  await evalJs('window.__dbg.hunt()');
  await sleep(1500);
  await evalJs('window.__dbg.nearHunter(1)');
  await sleep(500);
  await shot('9-cazador-caza');

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
