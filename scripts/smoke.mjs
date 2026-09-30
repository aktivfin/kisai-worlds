import { spawn } from 'node:child_process';

const child=spawn(process.execPath,['server.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,KISAI_TEST_DICE:'20,1,1'}});
let stderr='';child.stderr.on('data',d=>stderr+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function raw(path,options={}){
  const r=await fetch('http://127.0.0.1:8787'+path,{headers:{'content-type':'application/json'},...options});
  let data=null;try{data=await r.json()}catch{}
  return{status:r.status,ok:r.ok,data};
}
async function request(path,options={}){
  const r=await raw(path,options);if(!r.ok)throw new Error(path+' -> '+r.status+' '+JSON.stringify(r.data));return r.data;
}
async function ready(){
  for(let i=0;i<50;i++){try{return await request('/api/health')}catch{await sleep(100)}}
  throw new Error('server did not become ready: '+stderr);
}
const post=(path,value)=>request(path,{method:'POST',body:JSON.stringify(value)});
const getProfile=name=>request('/api/profile?name='+encodeURIComponent(name));

try{
  const health=await ready();
  if(!health.ok||!String(health.version).includes('0.7'))throw new Error('wrong runtime version');

  const events=await request('/api/events');
  if(!Array.isArray(events)||events.length<3||events.length>9)throw new Error('event rotation must contain 3-9 events');
  if(events.some(e=>!e.danger_tier||!e.recommended_players))throw new Error('event difficulty metadata missing');
  const free=events.filter(e=>e.entry?.type==='free').sort((a,b)=>b.recommended_players-a.recommended_players)[0];
  if(!free)throw new Error('rotation must contain a free event');

  const catalog=await request('/api/event-catalog');
  if(!catalog.some(e=>e.enchantment?.anchor_id))throw new Error('no enchantment event in catalog');
  const crafting=await request('/api/crafting');
  if(!crafting.recipes?.length||!crafting.materials?.ember_salt?.enchant)throw new Error('craft/enchant catalog incomplete');

  const name='CI Hero';
  let created=await post('/api/rooms',{name,eventId:free.id});
  const code=created.room.code;if(!code)throw new Error('room not created');

  const first=await post('/api/rooms/'+code+'/character',{name,wish:'следопыт-разведчик с коротким луком',appearance:'тёмный плащ'});
  const firstChar=first.character;
  if(!firstChar?.id||first.profile.usedSlots!==1)throw new Error('first persistent character not created');

  const second=await post('/api/profile/character',{name,wish:'страж со щитом',appearance:'тяжёлая броня'});
  const third=await post('/api/profile/character',{name,wish:'арканист',appearance:'серый плащ'});
  if(third.profile.usedSlots!==3)throw new Error('three live character slots not occupied');
  const fourth=await raw('/api/profile/character',{method:'POST',body:JSON.stringify({name,wish:'четвёртый герой',appearance:'-'})});
  if(fourth.status!==409||fourth.data?.error!=='character_slots_full')throw new Error('fourth live character must be rejected');

  let crafted=await post('/api/profile/craft',{name,recipeId:'rope_kit',quantity:1});
  crafted=await post('/api/profile/craft',{name,recipeId:'healing_potion',quantity:1});
  let p=crafted.profile;
  const rope=p.inventory.find(x=>x.catalogId==='rope_kit'),potion=p.inventory.find(x=>x.catalogId==='healing_potion');
  if(!rope||!potion)throw new Error('consumables not crafted');

  const selected=await post('/api/rooms/'+code+'/select-character',{name,characterId:firstChar.id});
  if(selected.room.players[0].characterId!==firstChar.id)throw new Error('room character snapshot wrong');

  const load=await post('/api/rooms/'+code+'/loadout',{name,items:[{itemId:rope.id,quantity:1},{itemId:potion.id,quantity:1}]});
  if(load.usage!==2||load.capacity<2)throw new Error('run loadout capacity wrong');

  const started=await post('/api/rooms/'+code+'/start',{});
  if(!started.started||started.participantsAtStart!==1)throw new Error('run not started');

  const craftDuring=await raw('/api/profile/craft',{method:'POST',body:JSON.stringify({name,recipeId:'smoke_bomb',quantity:1})});
  if(craftDuring.status!==409||craftDuring.data?.error!=='cannot_craft_during_run')throw new Error('crafting must be blocked during run');

  const risky=await post('/api/rooms/'+code+'/turn',{name,action:'крадусь вперёд и пытаюсь незаметно перебраться через опасный участок'});
  if(!risky.dice)throw new Error('risky action did not roll d20');
  const expectedDc=Math.max(7,Math.min(19,7+free.danger_tier*2));
  if(risky.dice.dc!==expectedDc)throw new Error('difficulty adapted unexpectedly: '+risky.dice.dc+' vs '+expectedDc);

  const used=await post('/api/rooms/'+code+'/use-item',{name,itemId:started.players[0].runInventory.find(x=>x.catalogId==='healing_potion').id});
  if(used.room.players[0].runInventory.some(x=>x.catalogId==='healing_potion'))throw new Error('consumable was not consumed');

  let room=risky.room,guard=0;
  while(room.progress<100&&guard++<25){
    const d=await post('/api/rooms/'+code+'/turn',{name,action:'спокойно осматриваю безопасную часть сцены, шаг '+guard});
    room=d.room;
  }
  if(room.progress<100)throw new Error('event could not reach completion');

  const extracted=await post('/api/rooms/'+code+'/extract',{name});
  const mine=extracted.rewards.find(x=>x.characterId===firstChar.id);
  if(!mine||mine.xp<=0||!mine.unique?.length)throw new Error('successful extraction did not grant xp + unique loot');
  const expectedUnderfill=Math.max(1,Math.min(2.5,free.recommended_players/1));
  if(Math.abs(mine.underfill-expectedUnderfill)>0.001)throw new Error('underfill reward multiplier wrong');
  p=extracted.profile;
  const unique=p.inventory.find(x=>mine.unique.some(u=>u.id===x.id));
  if(!unique)throw new Error('unique completion item not in account stash');

  const listing=await post('/api/market/list',{name,itemId:unique.id,price:777});
  if(listing.price!==777)throw new Error('player market price not preserved');
  await post('/api/market/cancel',{name,listingId:listing.id});

  // Permadeath + party recovery: only carried gear is at risk.
  const ally='CI Ally';
  const deathRoom=await post('/api/rooms',{name,eventId:free.id,characterId:firstChar.id});
  const deathCode=deathRoom.room.code;
  await post('/api/rooms/'+deathCode+'/loadout',{name,items:[{itemId:unique.id,quantity:1}]});
  await post('/api/rooms/'+deathCode+'/join',{name:ally});
  const allyChar=await post('/api/rooms/'+deathCode+'/character',{name:ally,wish:'полевой медик и разведчик',appearance:'лёгкая броня'});
  if(!allyChar.character?.id)throw new Error('ally character not created');
  await post('/api/rooms/'+deathCode+'/start',{});

  let death=null;
  for(let i=0;i<45;i++){
    const d=await post('/api/rooms/'+deathCode+'/turn',{name,action:'прыгаю в бездну и сознательно иду на смертельный риск '+i});
    if(d.deathDrop?.length){death=d;break}
  }
  if(!death)throw new Error('permadeath did not trigger after repeated lethal failures');
  const victimProfile=await getProfile(name);
  const dead=victimProfile.characters.find(x=>x.id===firstChar.id);
  if(dead?.status!=='dead'||victimProfile.usedSlots!==2)throw new Error('dead character did not free a live slot');
  if(!death.room.scene.loot.some(x=>x.id===unique.id))throw new Error('carried unique item did not drop into scene');

  const claimed=await post('/api/rooms/'+deathCode+'/loot/'+unique.id+'/claim',{name:ally});
  if(!claimed.room.players.find(x=>x.id===claimed.profile.id)?.runInventory.some(x=>x.id===unique.id))throw new Error('ally did not recover dropped item');

  let deathState=claimed.room,steps=0;
  while(deathState.progress<100&&steps++<25){
    const d=await post('/api/rooms/'+deathCode+'/turn',{name:ally,action:'осторожно продвигаюсь по безопасному пути, этап '+steps});
    deathState=d.room;
  }
  const allyExtract=await post('/api/rooms/'+deathCode+'/extract',{name:ally});
  const allyProfile=allyExtract.profile;
  if(!allyProfile.inventory.some(x=>x.id===unique.id))throw new Error('recovered item was not extracted into ally stash');

  const page=await fetch('http://127.0.0.1:8787/');
  if(!page.ok||(await page.text()).indexOf('KisAI Worlds')<0)throw new Error('index not served');

  console.log('Smoke PASS',{
    version:health.version,
    rotatedEvents:events.length,
    fixedTier:free.danger_tier,
    fixedDc:risky.dice.dc,
    characterSlots:'3/3 enforced',
    underfill:mine.underfill,
    completionLoot:mine.unique.length,
    permadeath:dead.status,
    recoveredUnique:unique.serial
  });
}finally{
  child.kill('SIGTERM');
}
