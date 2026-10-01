import { spawn } from 'node:child_process';

const child=spawn(process.execPath,['server.mjs'],{
  stdio:['ignore','pipe','pipe'],
  env:{...process.env,KISAI_TEST_DICE:'20,20,1,1'}
});
let stderr='';child.stderr.on('data',d=>stderr+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sessions=new Map(),hosts=new Map();

async function raw(path,options={}){
  let value={};try{value=JSON.parse(options.body||'{}')}catch{}
  const named=value.name||new URL('http://local'+path).searchParams.get('name')||hosts.get(path.match(/^\/api\/rooms\/([^/]+)/)?.[1]);
  if(named&&!sessions.has(named)){
    const created=await fetch('http://127.0.0.1:8787/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:named})});
    sessions.set(named,(await created.json()).token);
  }
  const r=await fetch('http://127.0.0.1:8787'+path,{...options,headers:{'content-type':'application/json',...(named?{authorization:'Bearer '+sessions.get(named)}:{})}});
  let data=null;try{data=await r.json()}catch{}
  if(path==='/api/rooms'&&r.ok)hosts.set(data.room.code,named);
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
const postRaw=(path,value)=>raw(path,{method:'POST',body:JSON.stringify(value)});
const getProfile=name=>request('/api/profile?name='+encodeURIComponent(name));
async function navigate(code,actorName,actorId,room,targetId,otherName=null){
  const initial=await fetch('http://127.0.0.1:8787/api/rooms/'+code,{headers:{authorization:'Bearer '+sessions.get(actorName)}});
  room=await initial.json();
  const visited=new Set([room.players.find(p=>p.id===actorId).position.anchorId]);
  for(let i=0;i<16&&room.players.find(p=>p.id===actorId).position.anchorId!==targetId;i++){
    if(room.turnOrder[room.turnCursor]!==actorId){
      if(!otherName)throw new Error('navigator lost turn');
      await post('/api/rooms/'+code+'/turn',{name:otherName,action:'осматриваю обстановку'});
      const response=await fetch('http://127.0.0.1:8787/api/rooms/'+code,{headers:{authorization:'Bearer '+sessions.get(actorName)}});
      room=await response.json();continue;
    }
    const visible=room.scene.geometry.anchors;
    const next=visible.some(a=>a.id===targetId)?targetId:visible.filter(a=>!visited.has(a.id)).at(-1)?.id||targetId;
    room=(await post('/api/rooms/'+code+'/turn',{name:actorName,action:'иду к '+next})).room;
    visited.add(next);
  }
  if(room.players.find(p=>p.id===actorId).position.anchorId!==targetId)throw new Error('cannot navigate to '+targetId);
  return room;
}

try{
  const health=await ready();
  if(!health.ok||!String(health.version).includes('0.8'))throw new Error('wrong runtime version');

  const events=await request('/api/events');
  if(!Array.isArray(events)||events.length<3||events.length>9)throw new Error('event rotation must contain 3-9 events');
  if(events.some(e=>!e.danger_tier||!e.recommended_players||!e.inventory_slots))throw new Error('event metadata missing');
  const free=events.filter(e=>e.entry?.type==='free').sort((a,b)=>b.recommended_players-a.recommended_players)[0];
  const forgeEvent=events.find(e=>e.enchantment);
  if(!free)throw new Error('rotation must contain a free event');
  if(!forgeEvent)throw new Error('rotation must contain an enchanting event');

  const catalog=await request('/api/event-catalog');
  if(catalog.length<9)throw new Error('event catalog must contain at least nine authored events');
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
  const fourth=await postRaw('/api/profile/character',{name,wish:'четвёртый герой',appearance:'-'});
  if(fourth.status!==409||fourth.data?.error!=='character_slots_full')throw new Error('fourth live character must be rejected');

  let p=third.profile;
  const clothBefore=p.inventory.find(x=>x.catalogId==='cloth')?.quantity||0;
  let crafted=await post('/api/profile/craft',{name,recipeId:'rope_kit',quantity:1});
  crafted=await post('/api/profile/craft',{name,recipeId:'healing_potion',quantity:1});
  p=crafted.profile;
  const clothAfter=p.inventory.find(x=>x.catalogId==='cloth')?.quantity||0;
  if(clothBefore-clothAfter!==3)throw new Error('recipe material cost not enforced');
  const rope=p.inventory.find(x=>x.catalogId==='rope_kit'),potion=p.inventory.find(x=>x.catalogId==='healing_potion');
  if(!rope||!potion)throw new Error('consumables not crafted');

  const selected=await post('/api/rooms/'+code+'/select-character',{name,characterId:firstChar.id});
  if(selected.room.players[0].characterId!==firstChar.id)throw new Error('room character snapshot wrong');

  const load=await post('/api/rooms/'+code+'/loadout',{name,items:[{itemId:rope.id,quantity:1},{itemId:potion.id,quantity:1}]});
  if(load.usage!==2||load.capacity<2||load.capacity>free.inventory_slots)throw new Error('run loadout capacity wrong');

  const started=await post('/api/rooms/'+code+'/start',{});
  if(!started.started||started.participantsAtStart!==1)throw new Error('run not started');
  if(started.players[0].runInventory.length!==2)throw new Error('loadout did not move from account stash');

  const craftDuring=await postRaw('/api/profile/craft',{name,recipeId:'smoke_bomb',quantity:1});
  if(craftDuring.status!==409||craftDuring.data?.error!=='cannot_craft_during_run')throw new Error('crafting must be blocked during run');

  const risky=await post('/api/rooms/'+code+'/turn',{name,action:'крадусь вперёд и пытаюсь незаметно перебраться через опасный участок'});
  if(!risky.dice||risky.dice.die!==20)throw new Error('deterministic risky d20 missing');
  const expectedDc=Math.max(7,Math.min(19,7+free.danger_tier*2));
  if(risky.dice.dc!==expectedDc)throw new Error('difficulty adapted unexpectedly: '+risky.dice.dc+' vs '+expectedDc);
  if(!Array.isArray(risky.room.log)||!risky.room.log.some(x=>x.action?.includes('крадусь вперёд')))throw new Error('room log was not exposed to gameplay client');

  const potionInRun=started.players[0].runInventory.find(x=>x.catalogId==='healing_potion');
  const used=await post('/api/rooms/'+code+'/use-item',{name,itemId:potionInRun.id});
  if(used.room.players[0].runInventory.some(x=>x.catalogId==='healing_potion'))throw new Error('consumable was not consumed');
  if(used.room.turnIndex!==risky.room.turnIndex+1)throw new Error('consumable must consume one turn');

  const early=await postRaw('/api/rooms/'+code+'/extract',{name});
  if(early.status!==409||early.data?.error!=='objectives_incomplete')throw new Error('early extraction must be blocked');

  let room=risky.room,guard=0;
  while(room.progress<100&&guard++<25){
    const d=await post('/api/rooms/'+code+'/turn',{name,action:'спокойно осматриваю безопасную часть сцены, шаг '+guard});
    room=d.room;
  }
  if(room.progress<100)throw new Error('event could not reach completion');
  room=await navigate(code,name,p.id,room,room.objectives[0].anchorId);

  const extracted=await post('/api/rooms/'+code+'/extract',{name});
  const mine=extracted.rewards.find(x=>x.characterId===firstChar.id);
  if(!mine||mine.xp<=0||!mine.unique?.length)throw new Error('successful extraction did not grant xp + unique loot');
  const expectedUnderfill=Math.max(1,Math.min(2.5,free.recommended_players));
  if(Math.abs(mine.underfill-expectedUnderfill)>0.001)throw new Error('underfill reward multiplier wrong');
  p=extracted.profile;
  const firstAfter=p.characters.find(x=>x.id===firstChar.id);
  if(firstAfter.runs!==1||firstAfter.wins!==1)throw new Error('run/win counters must increment once');
  if((firstAfter.developmentPoints||0)<1)throw new Error('level-up did not grant a development point');
  const evolvedAbility=await post('/api/profile/ability-evolve',{name,abilityId:firstAfter.abilities[0].id,mode:'modify',idea:'мощный точный вариант основной способности'});
  if(evolvedAbility.profile.character.developmentPoints!==firstAfter.developmentPoints-1)throw new Error('ability evolution did not consume one development point');
  if(!evolvedAbility.ability?.budgetVersion)throw new Error('ability evolution did not pass through server balance engine');
  p=evolvedAbility.profile;
  const unique=p.inventory.find(x=>mine.unique.some(u=>u.id===x.id));
  if(!unique)throw new Error('unique completion item not in account stash');

  const listing=await post('/api/market/list',{name,itemId:unique.id,price:777});
  if(listing.price!==777)throw new Error('player market price not preserved');
  const listed=(await request('/api/market')).find(x=>x.id===listing.id);
  if(!listed||listed.price!==777)throw new Error('market listing missing');
  await post('/api/market/cancel',{name,listingId:listing.id});

  // Paid expedition: each participant consumes access, and enchanting exists only inside the authored facility.
  p=await getProfile(name);
  const ingredient=p.inventory.find(x=>x.kind==='enchant_ingredient');
  const forgeGear=p.inventory.find(x=>x.id===unique.id);
  if(!ingredient||!forgeGear)throw new Error('forge prerequisites missing from account stash');

  const paidAlly='CI Paid Ally';
  const paidAllyChar=await post('/api/profile/character',{name:paidAlly,wish:'поддержка и разведка',appearance:'лёгкая броня'});
  const paidRoom=await post('/api/rooms',{name,eventId:forgeEvent.id,characterId:second.character.id});
  const paidCode=paidRoom.room.code;
  await post('/api/rooms/'+paidCode+'/join',{name:paidAlly,characterId:paidAllyChar.character.id});
  await post('/api/rooms/'+paidCode+'/loadout',{name,items:[{itemId:forgeGear.id,quantity:1},{itemId:ingredient.id,quantity:1}]});
  const paidStarted=await post('/api/rooms/'+paidCode+'/start',{});
  if(paidStarted.participantsAtStart!==2)throw new Error('paid party size incorrect');

  const hostPaid=await getProfile(name),allyPaid=await getProfile(paidAlly);
  if(hostPaid.eventTickets!==1||allyPaid.eventTickets!==1)throw new Error('paid event must consume one entitlement per player');

  const tradeDuring=await postRaw('/api/market/list',{name,itemId:forgeGear.id,price:123});
  if(tradeDuring.status!==409||tradeDuring.data?.error!=='cannot_trade_during_run')throw new Error('trading must be blocked during active expedition');

  const movedRoom=await navigate(paidCode,name,hostPaid.id,paidStarted,forgeEvent.enchantment.anchor_id,paidAlly);
  const hostRoomPlayer=movedRoom.players.find(x=>x.id===hostPaid.id);
  if(hostRoomPlayer.position?.anchorId!==forgeEvent.enchantment.anchor_id)throw new Error('player did not reach enchantment facility');
  const runGear=hostRoomPlayer.runInventory.find(x=>x.kind==='equipment');
  const runIngredient=hostRoomPlayer.runInventory.find(x=>x.kind==='enchant_ingredient');
  if(movedRoom.turnOrder[movedRoom.turnCursor]!==hostPaid.id)await post('/api/rooms/'+paidCode+'/turn',{name:paidAlly,action:'проверяю обстановку'});
  const enchanted=await post('/api/rooms/'+paidCode+'/enchant',{name,targetId:runGear.id,ingredientIds:[runIngredient.id]});
  if(enchanted.roll?.die!==20||!enchanted.success)throw new Error('deterministic adventure enchantment should succeed');
  if(enchanted.room.turnIndex!==movedRoom.turnIndex+2)throw new Error('enchant must consume a turn after ally handoff');
  if(!(enchanted.item.enchantments||[]).length)throw new Error('enchantment was not persisted on unique item');

  let paidState=enchanted.room,paidSteps=0;
  while(paidState.progress<100&&paidSteps++<25){
    const actor=paidState.turnOrder[paidState.turnCursor]===hostPaid.id?name:paidAlly;
    const d=await post('/api/rooms/'+paidCode+'/turn',{name:actor,action:'осторожно выполняю безопасную часть задания, этап '+paidSteps});
    paidState=d.room;
  }
  if(paidState.progress<100)throw new Error('paid event could not complete');
  paidState=await navigate(paidCode,name,hostPaid.id,paidState,paidState.objectives[0].anchorId,paidAlly);
  const paidExtract=await post('/api/rooms/'+paidCode+'/extract',{name});
  p=paidExtract.profile;
  const enchantedInStash=p.inventory.find(x=>x.id===unique.id);
  if(!enchantedInStash?.enchantments?.length)throw new Error('enchanted item was not extracted back to stash');

  // Permadeath + party recovery: only the carried expedition inventory is lost.
  const rescue='CI Rescue';
  const deathRoom=await post('/api/rooms',{name,eventId:free.id,characterId:firstChar.id});
  const deathCode=deathRoom.room.code;
  await post('/api/rooms/'+deathCode+'/loadout',{name,items:[{itemId:enchantedInStash.id,quantity:1}]});
  await post('/api/rooms/'+deathCode+'/join',{name:rescue});
  const rescueChar=await post('/api/rooms/'+deathCode+'/character',{name:rescue,wish:'полевой медик и разведчик',appearance:'лёгкая броня'});
  if(!rescueChar.character?.id)throw new Error('rescue character not created');
  let deathState=await post('/api/rooms/'+deathCode+'/start',{});

  let death=null;
  for(let i=0;i<8;i++){
    if(deathState.turnOrder[deathState.turnCursor]!==p.id){deathState=(await post('/api/rooms/'+deathCode+'/turn',{name:rescue,action:'осматриваю вход '+i})).room;}
    const d=await post('/api/rooms/'+deathCode+'/turn',{name,action:'прыгаю в бездну и сознательно иду на смертельный риск '+i});
    deathState=d.room;
    if(d.deathDrop?.length){death=d;break}
  }
  if(!death)throw new Error('deterministic permadeath did not trigger');
  const victimProfile=await getProfile(name);
  const dead=victimProfile.characters.find(x=>x.id===firstChar.id);
  if(dead?.status!=='dead'||victimProfile.usedSlots!==2)throw new Error('dead character did not become permanently unavailable');
  if(!death.room.scene.loot.some(x=>x.id===enchantedInStash.id))throw new Error('carried item did not drop into death scene');
  if(victimProfile.inventory.some(x=>x.id===enchantedInStash.id))throw new Error('carried item incorrectly remained in account stash');

  const claimed=await post('/api/rooms/'+deathCode+'/loot/'+enchantedInStash.id+'/claim',{name:rescue});
  const rescuePlayer=claimed.room.players.find(x=>x.id===claimed.profile.id);
  if(!rescuePlayer?.runInventory.some(x=>x.id===enchantedInStash.id))throw new Error('party member did not recover death-drop item');

  deathState=claimed.room;let steps=0;
  while(deathState.progress<100&&steps++<25){
    const d=await post('/api/rooms/'+deathCode+'/turn',{name:rescue,action:'осторожно продвигаюсь по безопасному пути, этап '+steps});
    deathState=d.room;
  }
  deathState=await navigate(deathCode,rescue,claimed.profile.id,deathState,deathState.objectives[0].anchorId);
  const rescueExtract=await post('/api/rooms/'+deathCode+'/extract',{name:rescue});
  if(!rescueExtract.profile.inventory.some(x=>x.id===enchantedInStash.id))throw new Error('recovered item was not extracted into rescuer stash');

  const pov=await request('/api/rooms/'+deathCode+'/pov?name='+encodeURIComponent(rescue));
  if(!pov.camera||!Array.isArray(pov.visibleAnchors))throw new Error('POV unavailable');

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
    paidParty:paidStarted.participantsAtStart,
    enchantQuality:enchanted.item.enchantments.at(-1).quality,
    permadeath:dead.status,
    recoveredUnique:enchantedInStash.serial
  });
}finally{
  child.kill('SIGTERM');
}
