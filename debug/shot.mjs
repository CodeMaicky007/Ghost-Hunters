import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2]; const OUT = process.argv[3] || 'debug/shot.png'; const SECS = Number(process.argv[4] || 5);
const PORT = 9225; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,1000',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.cwd() + '\\debug\\.cp', 'about:blank'], { stdio: 'ignore' });
async function getWs(){for(let i=0;i<40;i++){try{const t=(await(await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t=>t.type==='page');if(t?.webSocketDebuggerUrl)return t.webSocketDebuggerUrl;}catch{}await sleep(250);}throw new Error('no devtools');}
async function main(){
  const ws=new WebSocket(await getWs()); await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let id=0;const pending=new Map();const logs=[];
  ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);
    if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}
    else if(m.method==='Runtime.consoleAPICalled')logs.push('['+m.params.type+'] '+m.params.args.map(a=>a.value!==undefined?a.value:(a.description||'')).join(' '));
    else if(m.method==='Runtime.exceptionThrown')logs.push('[EXCEPTION] '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text));};
  const cmd=(method,params={})=>new Promise((res)=>{const myId=++id;pending.set(myId,res);ws.send(JSON.stringify({id:myId,method,params}));});
  await cmd('Runtime.enable');await cmd('Page.enable');await cmd('Network.enable');await cmd('Network.setCacheDisabled',{cacheDisabled:true});
  await cmd('Page.navigate',{url:URL}); await sleep(SECS*1000);
  const tag=(await cmd('Runtime.evaluate',{expression:"(document.getElementById('tag')||{}).textContent||''",returnByValue:true})).result?.value;
  const shot=await cmd('Page.captureScreenshot',{format:'png'}); writeFileSync(OUT,Buffer.from(shot.data,'base64'));
  console.log('tag='+tag+'\nlogs='+(logs.join(' | ')||'none'));
  ws.close();chrome.kill();process.exit(0);
}
main().catch(e=>{console.error(e);chrome.kill();process.exit(1);});
