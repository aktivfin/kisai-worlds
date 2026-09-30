import { spawn } from 'node:child_process';

const child=spawn(process.execPath,['server.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env}});
let stderr='';child.stderr.on('data',d=>stderr+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function raw(path,options={}){
  const r=await fetch('http://127.0.0.1:8787'+path,{headers:{'content-type':'application/json'},...options});
  let data=null;try{data=await r.json()}catch{}
  return{ok:r.ok,status:r.status,data};
}
async function request(path,options={}){
  const x=await raw(path,options);
  if(!x.ok)throw new Error(path+' -> '+x.status+' '+JSON.stringify(x.data));
  return x.data;
}
async function ready(){
  for(let i=0;i<50;i++){try{return await request('/api/health')}catch{await sleep(100)}}
  throw new Error('server did not become ready: '+stderr);
}
const post=(path,data)=>request(path,{method:'POST',body:JSON.stringify(data)});
const postRaw=(path,data)=>raw(path,{method:'POST',body:JSON.stringify(data)});

try{
  const health=await ready();
  if(!health.ok||!String(health.version).startsWith('0.7'))throw new Error('wrong runtime version');

  const events=await request('/api/events');
  if(!Array.isArray(events)||events.length<3||events.length>9)throw new Error('event rotation size invalid');
  if(events.some(e=>!e.danger_tier||!e.recommended_players||!e.inventory_slots))throw new Error('event metadata missing');

  const free=[...events].filter(e=>e.entry?.type==='free').sort((a,b)=>b.recommended_players-a.recommended_players)[0];
  if(!free)throw new Error('rotation must include a free event');
  const forgeEvent=events.find(e=>e.enchantment);
  if(!forgeEvent)throw new Error('rotation must expose an enchanting event for smoke');

  let profile=await request('/api/profile?name='+encodeURIComponent('CI Hero'));
  if(profile.characterSlots!==3||profile.usedSlots!==0)throw new Error('default character slots invalid');

  const c1=await post('/api/profile/character',{name:'CI Hero',wish:'следопыт с коротким луком',appearance:'тёмный плащ'});
  const c2=await post('/api/profile/character',{name:'CI Hero',wish:'страж со щитом',appearance:'тяжёлая броня'});
  const c3=await post('/api/profile/character',{name:'CI Hero',wish:'арканист пространства',appearance:'серый плащ'});
  const overflow=await postRaw('/api/profile/character',{name:'CI Hero',wish:'четвёртый герой',appearance:'-'});
  if(overflow.status!==409||overflow.data?.error!=='character_slots_full')throw new Error('character slot limit not enforced');

  profile=await post('/api/profile/select-character',{name:'CI Hero',characterId:c1.character.id});
  if(profile.activeCharacterId!==c1.character.id||profile.usedSlots!==3)throw new Error('character selection failed');

  const clothBefore=profile.inventory.find(x=>x.catalogId==='cloth')?.quantity||0;
  const crafted=await post('/api/profile/craft',{name:'CI Hero',recipeId:'rope_kit',quantity:1});
  if(crafted.item?.kind!=='consumable')throw new Error('consumable crafting failed');
  profile=crafted.profile;
  const clothAfter=profile.inventory.find(x=>x.catalogId==='cloth')?.quantity||0;
  if(clothBefore-clothAfter!==3)throw new Error('recipe material cost not enforced');

  const created=await post('/api/rooms',{name:'CI Hero',eventId:free.id,characterId:c1.character.id});
  if(!created.room?.code||created.room.event.danger_tier!==free.danger_tier)throw new Error('event room not created');
  const code=created.room.code;

  const rope=profile.inventory.find(x=>x.catalogId==='rope_kit');if(!rope)throw new Error('crafted item missing from stash');
  const loadout=await post('/api/rooms/'+code+'/loadout',{name:'CI Hero',items:[{itemId:rope.id,quantity:1}]});
  if(loadout.usage!==1||loadout.usage>loadout.capacity)throw new Error('loadout capacity broken');
  if(loadout.capacity>free.inventory_slots)throw new Error('event backpack cap ignored');

  const started=await post('/api/rooms/'+code+'/start',{});
  if(!started.started||started.participantsAtStart!==1)throw new Error('run not started');
  const me=started.players.find(x=>x.name==='CI Hero');
  if(!me||me.runInventory.length!==1)throw new Error('run inventory did not move from stash');

  const diceTurn=await post('/api/rooms/'+code+'/turn',{name:'CI Hero',action:'пытаюсь быстро перелезть через опасный провал'});
  if(!diceTurn.narration||!diceTurn.room?.scene||!diceTurn.dice)throw new Error('fixed difficulty dice turn missing');
  if(diceTurn.dice.dc!==7+free.danger_tier*2)throw new Error('DC adapted unexpectedly');

  const early=await postRaw('/api/rooms/'+code+'/extract',{name:'CI Hero'});
  if(early.status!==409||early.data?.error!=='objectives_incomplete')throw new Error('early extraction must be blocked');

  let run=diceTurn.room;
  let guard=0;
  while((run.progress||0)<100&&guard++<30){
    const d=await post('/api/rooms/'+code+'/turn',{name:'CI Hero',action:'внимательно изучаю безопасную часть текущей сцены'});
    run=d.room;
    if(!run.players.find(x=>x.name==='CI Hero')?.alive)throw new Error('safe progress action killed character');
  }
  if((run.progress||0)<100)throw new Error('event progress never reached extraction threshold');

  const extracted=await post('/api/rooms/'+code+'/extract',{name:'CI Hero'});
  const reward=extracted.rewards.find(x=>x.profileId===extracted.profile.id);
  if(!reward||reward.xp<=0||!reward.unique?.length)throw new Error('extraction reward missing');
  const expectedUnderfill=Math.max(1,Math.min(2.5,free.recommended_players/1));
  if(Math.abs(reward.underfill-expectedUnderfill)>.001)throw new Error('underfill reward multiplier incorrect');
  profile=extracted.profile;
  const completedChar=profile.characters.find(x=>x.id===c1.character.id);
  if(completedChar.runs!==1||completedChar.wins!==1)throw new Error('run/win counters incorrect');
  if(completedChar.xp===0&&completedChar.level===1)throw new Error('character XP did not persist');

  const extractedGear=profile.inventory.filter(x=>x.kind==='equipment');
  if(!extractedGear.length)throw new Error('unique extracted equipment missing from account stash');

  if(extractedGear.length>1){
    const listing=await post('/api/market/list',{name:'CI Hero',itemId:extractedGear[1].id,price:777});
    if(listing.price!==777)throw new Error('player-defined market price not preserved');
    const active=await request('/api/market');
    if(!active.some(x=>x.id===listing.id&&x.price===777))throw new Error('market listing missing');
    await post('/api/market/cancel',{name:'CI Hero',listingId:listing.id});
    profile=await request('/api/profile?name='+encodeURIComponent('CI Hero'));
  }

  const ingredient=profile.inventory.find(x=>x.kind==='enchant_ingredient');
  const gear=profile.inventory.find(x=>x.kind==='equipment');
  if(!ingredient||!gear)throw new Error('forge loadout prerequisites missing');

  let ally=await request('/api/profile?name='+encodeURIComponent('CI Ally'));
  const allyChar=await post('/api/profile/character',{name:'CI Ally',wish:'наёмник поддержки',appearance:'дорожная броня'});
  ally=allyChar.profile;

  const paid=await post('/api/rooms',{name:'CI Hero',eventId:forgeEvent.id,characterId:c1.character.id});
  const paidCode=paid.room.code;
  await post('/api/rooms/'+paidCode+'/join',{name:'CI Ally',characterId:allyChar.character.id});
  await post('/api/rooms/'+paidCode+'/loadout',{name:'CI Hero',items:[{itemId:gear.id,quantity:1},{itemId:ingredient.id,quantity:1}]});
  const paidStarted=await post('/api/rooms/'+paidCode+'/start',{});
  if(paidStarted.participantsAtStart!==2)throw new Error('paid party size incorrect');

  const hostAfterPay=await request('/api/profile?name='+encodeURIComponent('CI Hero'));
  const allyAfterPay=await request('/api/profile?name='+encodeURIComponent('CI Ally'));
  if(hostAfterPay.eventTickets!==1||allyAfterPay.eventTickets!==1)throw new Error('paid event must consume one ticket per player');

  const blockedTrade=await postRaw('/api/market/list',{name:'CI Hero',itemId:profile.inventory.find(x=>x.kind==='equipment'&&x.id!==gear.id)?.id||gear.id,price:123});
  if(blockedTrade.status!==409||blockedTrade.data?.error!=='cannot_trade_during_run')throw new Error('trading during run must be blocked');

  const move=await post('/api/rooms/'+paidCode+'/turn',{name:'CI Hero',action:'иду к '+forgeEvent.enchantment.label});
  const hostInRoom=move.room.players.find(x=>x.name==='CI Hero');
  if(hostInRoom.position?.anchorId!==forgeEvent.enchantment.anchor_id)throw new Error('GM move did not reach enchantment facility');

  const inRunGear=hostInRoom.runInventory.find(x=>x.kind==='equipment');
  const inRunIngredient=hostInRoom.runInventory.find(x=>x.kind==='enchant_ingredient');
  const ench=await post('/api/rooms/'+paidCode+'/enchant',{name:'CI Hero',targetId:inRunGear.id,ingredientIds:[inRunIngredient.id]});
  if(!ench.roll||typeof ench.success!=='boolean')throw new Error('enchantment challenge did not resolve');
  if(!(ench.item.provenance||[]).some(x=>x.type==='enchanted'||x.type==='enchant_failed'))throw new Error('enchantment provenance missing');

  const pov=await request('/api/rooms/'+paidCode+'/pov?name='+encodeURIComponent('CI Hero'));
  if(!pov.camera||!Array.isArray(pov.visibleAnchors))throw new Error('POV not available');

  const page=await fetch('http://127.0.0.1:8787/');
  if(!page.ok||(await page.text()).indexOf('KisAI Worlds')<0)throw new Error('index not served');

  console.log('Smoke PASS',{
    version:health.version,events:events.length,freeEvent:free.id,tier:free.danger_tier,
    slots:profile.usedSlots,underfill:reward.underfill,unique:reward.unique.length,
    paidEvent:forgeEvent.id,paidParty:paidStarted.participantsAtStart,forgeRoll:ench.roll.die,forgeSuccess:ench.success
  });
}finally{child.kill('SIGTERM')}
