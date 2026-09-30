import { spawn } from 'node:child_process';

const child=spawn(process.execPath,['server.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env}});
let stderr='';child.stderr.on('data',d=>stderr+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function raw(path,options={}){
  const r=await fetch('http://127.0.0.1:8787'+path,{headers:{'content-type':'application/json'},...options});
  let data=null;try{data=await r.json()}catch{}
  return{ok:r.ok,status:r.status,data};
}
async function request(path,options={}){const x=await raw(path,options);if(!x.ok)throw new Error(path+' -> '+x.status+' '+JSON.stringify(x.data));return x.data}
async function ready(){for(let i=0;i<50;i++){try{return await request('/api/health')}catch{await sleep(100)}}throw new Error('server did not become ready: '+stderr)}

try{
  const health=await ready();
  if(!health.ok||!String(health.version).startsWith('0.7'))throw new Error('wrong runtime version');

  const events=await request('/api/events');
  if(!Array.isArray(events)||events.length<3||events.length>9)throw new Error('event rotation size invalid');
  if(events.some(e=>!e.danger_tier||!e.recommended_players))throw new Error('event difficulty metadata missing');
  const free=events.find(e=>e.entry?.type==='free');if(!free)throw new Error('rotation must include free event');

  let profile=await request('/api/profile?name='+encodeURIComponent('CI Hero'));
  if(profile.characterSlots!==3)throw new Error('default character slots must be 3');

  const c1=await request('/api/profile/character',{method:'POST',body:JSON.stringify({name:'CI Hero',wish:'следопыт с коротким луком',appearance:'тёмный плащ'})});
  const c2=await request('/api/profile/character',{method:'POST',body:JSON.stringify({name:'CI Hero',wish:'страж со щитом',appearance:'тяжёлая броня'})});
  const c3=await request('/api/profile/character',{method:'POST',body:JSON.stringify({name:'CI Hero',wish:'арканист пространства',appearance:'серый плащ'})});
  const overflow=await raw('/api/profile/character',{method:'POST',body:JSON.stringify({name:'CI Hero',wish:'четвёртый герой',appearance:'-'})});
  if(overflow.status!==409||overflow.data?.error!=='character_slots_full')throw new Error('character slot limit not enforced');

  profile=await request('/api/profile/select-character',{method:'POST',body:JSON.stringify({name:'CI Hero',characterId:c1.character.id})});
  if(profile.activeCharacterId!==c1.character.id)throw new Error('character selection failed');

  const crafted=await request('/api/profile/craft',{method:'POST',body:JSON.stringify({name:'CI Hero',recipeId:'rope_kit',quantity:1})});
  if(crafted.item?.kind!=='consumable')throw new Error('consumable crafting failed');
  profile=crafted.profile;

  const created=await request('/api/rooms',{method:'POST',body:JSON.stringify({name:'CI Hero',eventId:free.id,characterId:c1.character.id})});
  if(!created.room?.code||created.room.event.danger_tier!==free.danger_tier)throw new Error('event room not created');
  const code=created.room.code;

  const rope=profile.inventory.find(x=>x.catalogId==='rope_kit');if(!rope)throw new Error('crafted item missing from stash');
  const loadout=await request('/api/rooms/'+code+'/loadout',{method:'POST',body:JSON.stringify({name:'CI Hero',items:[{itemId:rope.id,quantity:1}]})});
  if(loadout.usage>loadout.capacity)throw new Error('loadout capacity broken');

  const started=await request('/api/rooms/'+code+'/start',{method:'POST',body:'{}'});
  if(!started.started||started.participantsAtStart!==1)throw new Error('run not started');
  const me=started.players.find(x=>x.name==='CI Hero');
  if(!me||me.runInventory.length!==1)throw new Error('run inventory did not move from stash');

  const turn=await request('/api/rooms/'+code+'/turn',{method:'POST',body:JSON.stringify({name:'CI Hero',action:'пытаюсь быстро перелезть через опасный провал'})});
  if(!turn.narration||!turn.room?.scene||!turn.dice)throw new Error('fixed difficulty dice turn missing');
  if(turn.dice.dc!==7+free.danger_tier*2)throw new Error('DC adapted unexpectedly');

  const early=await raw('/api/rooms/'+code+'/extract',{method:'POST',body:JSON.stringify({name:'CI Hero'})});
  if(early.status!==409||early.data?.error!=='objectives_incomplete')throw new Error('early extraction must be blocked');

  const pov=await request('/api/rooms/'+code+'/pov?name='+encodeURIComponent('CI Hero'));
  if(!pov.camera||!Array.isArray(pov.visibleAnchors))throw new Error('POV not available');

  const page=await fetch('http://127.0.0.1:8787/');
  if(!page.ok||(await page.text()).indexOf('KisAI Worlds')<0)throw new Error('index not served');

  console.log('Smoke PASS',{version:health.version,events:events.length,event:free.id,tier:free.danger_tier,slots:c3.profile.usedSlots,loadout:loadout.usage+'/'+loadout.capacity,d20:turn.dice.die,dc:turn.dice.dc});
}finally{child.kill('SIGTERM')}
