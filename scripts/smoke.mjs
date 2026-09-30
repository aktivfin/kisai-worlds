import { spawn } from 'node:child_process';

const child=spawn(process.execPath,['server.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env}});
let stderr='';
child.stderr.on('data',d=>stderr+=d);

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,options={}){
  const r=await fetch('http://127.0.0.1:8787'+path,{headers:{'content-type':'application/json'},...options});
  let data=null;try{data=await r.json()}catch{}
  if(!r.ok)throw new Error(path+' -> '+r.status+' '+JSON.stringify(data));
  return data;
}
async function ready(){
  for(let i=0;i<40;i++){try{return await request('/api/health')}catch{await sleep(100)}}
  throw new Error('server did not become ready: '+stderr);
}
try{
  const health=await ready();
  if(!health.ok)throw new Error('health not ok');
  const scenarios=await request('/api/scenarios');
  if(!Array.isArray(scenarios)||!scenarios.length)throw new Error('no scenarios');
  const created=await request('/api/rooms',{method:'POST',body:JSON.stringify({name:'CI Hero',scenarioId:scenarios[0].id})});
  if(!created.room?.code)throw new Error('room not created');
  const code=created.room.code;
  const char=await request('/api/rooms/'+code+'/character',{method:'POST',body:JSON.stringify({name:'CI Hero',wish:'следопыт с коротким луком',appearance:'тёмный плащ'})});
  if(!char.character?.archetype)throw new Error('character not generated');
  const started=await request('/api/rooms/'+code+'/start',{method:'POST',body:'{}'});
  if(!started.started)throw new Error('room not started');
  const turn=await request('/api/rooms/'+code+'/turn',{method:'POST',body:JSON.stringify({name:'CI Hero',action:'осматриваю платформу и ищу следы'})});
  if(!turn.narration||!turn.room?.scene)throw new Error('turn did not commit');
  const pov=await request('/api/rooms/'+code+'/pov?name='+encodeURIComponent('CI Hero'));
  if(!pov.camera||!Array.isArray(pov.visibleAnchors))throw new Error('POV not available');
  const page=await fetch('http://127.0.0.1:8787/');
  if(!page.ok||(await page.text()).indexOf('KisAI Worlds')<0)throw new Error('index not served');
  console.log('Smoke PASS:',{version:health.version,scenario:scenarios[0].id,room:code,archetype:char.character.archetype,music:turn.music_state,visible:pov.visibleAnchors.length});
}finally{
  child.kill('SIGTERM');
}
