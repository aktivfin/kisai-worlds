import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(DATA, 'config.json');
const CONFIG_EXAMPLE = path.join(DATA, 'config.example.json');
const SCENARIOS_FILE = path.join(DATA, 'scenarios.json');
const CRAFTING_FILE = path.join(DATA, 'crafting.json');
const STATE_FILE = path.join(DATA, 'state.json');
const ITEM_MEDIA_DIR = path.join(DATA, 'runtime', 'item-cards');

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(ITEM_MEDIA_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_EXAMPLE, CONFIG_FILE);

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const config = readJson(CONFIG_FILE, { port: 8787 });
const scenarios = readJson(SCENARIOS_FILE, []);
const crafting = readJson(CRAFTING_FILE, {materials:{},recipes:[]});
const persisted = readJson(STATE_FILE, { profiles: {}, market: [], transactions: [] });

const rooms = new Map();
const MIME = {
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
  '.mp3':'audio/mpeg','.wav':'audio/wav','.svg':'image/svg+xml'
};
const now = () => new Date().toISOString();
const id = (p='id') => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const normalize = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const json = (res,status,body) => { const data=JSON.stringify(body); res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(data); };
const body = req => new Promise((resolve,reject)=>{ let raw=''; req.on('data',c=>{raw+=c;if(raw.length>15_000_000){reject(new Error('body too large'));req.destroy();}}); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}}); req.on('error',reject); });
const saveState = () => writeJson(STATE_FILE, persisted);
const TEST_DICE_QUEUE=String(process.env.KISAI_TEST_DICE||'').split(',').map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=20);
const nextD20=()=>TEST_DICE_QUEUE.length?TEST_DICE_QUEUE.shift():crypto.randomInt(1,21);


function runtimeConfig(){ return readJson(CONFIG_FILE, {}); }
function providerReady(section){ const c=runtimeConfig()[section]||{}; return Boolean(c.api_key && c.base_url && c.model); }
function safeJsonText(text=''){
  const cleaned=String(text).trim().replace(/^\\\`\\\`\\\`(?:json)?/i,'').replace(/\\\`\\\`\\\`$/,'').trim();
  try{return JSON.parse(cleaned)}catch{return null}
}
async function openAIChat(messages, temperature=.7){
  const c=runtimeConfig().llm||{};
  if(!c.api_key||!c.base_url||!c.model) return null;
  const url=String(c.base_url).replace(/\/$/,'')+'/chat/completions';
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+c.api_key},body:JSON.stringify({model:c.model,messages,temperature})});
  if(!r.ok) throw new Error('llm_'+r.status);
  const d=await r.json();
  return d.choices?.[0]?.message?.content||null;
}
async function generateCharacterAI(wish,appearance){
  if(!providerReady('llm')) return null;
  const prompt='Return ONLY compact JSON for a level-1 RPG character. Preserve fantasy, but keep numeric power server-safe. Schema: {"archetype":string,"concept":string,"skills":{"Сила":1-4,"Ловкость":1-4,"Интеллект":1-4,"Воля":1-4,"Восприятие":1-4},"abilities":[string,string],"weakness":string}. Total skill points must be <=13.';
  const text=await openAIChat([{role:'system',content:prompt},{role:'user',content:'Concept: '+wish+'\\nAppearance: '+appearance}],.5);
  const x=safeJsonText(text); if(!x||typeof x!=='object') return null;
  const base=fallbackCharacter(wish,appearance), skills={};
  for(const k of Object.keys(base.skills)) skills[k]=clamp(Number(x.skills?.[k])||base.skills[k],1,4);
  let total=Object.values(skills).reduce((a,b)=>a+b,0);
  while(total>13){const k=Object.keys(skills).sort((a,b)=>skills[b]-skills[a])[0];if(skills[k]<=1)break;skills[k]--;total--;}
  return {...base,archetype:String(x.archetype||base.archetype).slice(0,48),concept:String(x.concept||wish||base.concept).slice(0,400),skills,abilities:Array.isArray(x.abilities)?x.abilities.slice(0,2).map(v=>String(v).slice(0,180)):base.abilities,weakness:String(x.weakness||base.weakness).slice(0,180)};
}
async function resolveGMAI(room,action,actor){
  const player=room.players.get(actor.id),fallback=fallbackGM(room,action,actor);
  if(!providerReady('llm'))return fallback;
  const recent=room.log.slice(0,8).reverse().map(x=>x.actor+': '+x.action+' -> '+x.narration).join('\n');
  const system='You are a GM planner. Event difficulty and dice are server-controlled. Return ONLY JSON: {"check_required":boolean,"check_skill":"Сила|Ловкость|Интеллект|Воля|Восприятие","difficulty_shift":-1|0|1,"danger":"safe|risky|lethal","success_narration":string,"failure_narration":string,"no_check_narration":string,"music_state":"explore|tavern|investigation|discovery|tension|chase|ritual|abyss|dread|hell|boss|grief","move_to":string|null,"loot":boolean}. move_to may only be an existing anchor id. Do not adapt difficulty to party size.';
  const user='FIXED EVENT TIER '+(room.scenario?.danger_tier||1)+'; recommended party '+(room.scenario?.recommended_players||1)+'; progress '+(room.progress||0)+'/100.\nEvent: '+room.scenario?.title+'\nGeometry: '+JSON.stringify(room.scene.geometry)+'\nPlayer: '+JSON.stringify({character:actor.character,wounds:player?.wounds||0,runInventory:(player?.runInventory||[]).map(x=>x.name)})+'\nRecent:\n'+recent+'\nAction: '+action;
  try{
    const x=safeJsonText(await openAIChat([{role:'system',content:system},{role:'user',content:user}],.55));if(!x)return fallback;
    const skills=['Сила','Ловкость','Интеллект','Воля','Восприятие'],music=['explore','tavern','investigation','discovery','tension','chase','ritual','abyss','dread','hell','boss','grief'];
    return{check_required:Boolean(x.check_required),check_skill:skills.includes(x.check_skill)?x.check_skill:fallback.check_skill,difficulty_shift:clamp(Number(x.difficulty_shift)||0,-1,1),
      danger:['safe','risky','lethal'].includes(x.danger)?x.danger:'safe',success_narration:String(x.success_narration||fallback.success_narration).slice(0,650),
      failure_narration:String(x.failure_narration||fallback.failure_narration).slice(0,650),no_check_narration:String(x.no_check_narration||fallback.no_check_narration).slice(0,650),
      music_state:music.includes(x.music_state)?x.music_state:fallback.music_state,move_to:typeof x.move_to==='string'?x.move_to:null,loot:Boolean(x.loot)};
  }catch(e){console.warn('GM planner fallback:',e.message);return fallback}
}
async function transcribeAudio(audioBase64,mimeType='audio/webm'){
  const c=runtimeConfig().stt||{}; if(!c.api_key||!c.base_url||!c.model) throw new Error('stt_not_configured');
  const bytes=Buffer.from(String(audioBase64||''),'base64'); if(!bytes.length||bytes.length>10_000_000) throw new Error('invalid_audio');
  const form=new FormData(); form.set('model',c.model); form.set('file',new Blob([bytes],{type:mimeType}),'turn.webm');
  const r=await fetch(String(c.base_url).replace(/\/$/,'')+'/audio/transcriptions',{method:'POST',headers:{authorization:'Bearer '+c.api_key},body:form});
  if(!r.ok) throw new Error('stt_'+r.status); const d=await r.json(); return String(d.text||'').trim();
}
async function synthesizeSpeech(text){
  const c=runtimeConfig().tts||{}; if(!c.api_key||!c.model||!text) return null;
  if((c.provider||'openai')==='openai'){
    if(!c.base_url)return null;
    const r=await fetch(String(c.base_url).replace(/\/$/,'')+'/audio/speech',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.api_key},body:JSON.stringify({model:c.model,voice:c.voice||'alloy',input:text,format:'mp3'})});
    if(!r.ok)return null; return Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  if(c.provider==='elevenlabs'&&c.base_url&&c.voice){
    const r=await fetch(String(c.base_url).replace(/\/$/,'')+'/v1/text-to-speech/'+encodeURIComponent(c.voice),{method:'POST',headers:{'content-type':'application/json','xi-api-key':c.api_key},body:JSON.stringify({text,model_id:c.model})});
    if(!r.ok)return null; return Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  return null;
}
function tryAddRunItem(r,player,item){
  player.runInventory=player.runInventory||[];player.capacity=player.capacity||runCapacity(player.profile.character);item.status='run';item.ownerId=player.id;
  if(inventoryUsage(player.runInventory)+stackCost(item)<=player.capacity){player.runInventory.push(item);return'run'}
  item.status='scene';item.ownerId=null;r.scene.loot.push(item);return'scene';
}
function dropCharacterInventory(r,p){
  const player=r.players.get(p.id);if(!player||!player.alive)return[];
  const dropped=[...(player.runInventory||[])];player.runInventory=[];
  for(const item of dropped){item.status='scene';item.ownerId=null;item.provenance=item.provenance||[];item.provenance.push({at:now(),type:'death_drop',characterId:player.characterId,eventId:r.scenario.id,sceneId:r.scene.id})}
  r.scene.loot.push(...dropped);player.alive=false;player.wounds=3;
  const c=p.characters.find(x=>x.id===player.characterId);if(c){c.status='dead';c.deathAt=now();c.deathEventId=r.scenario.id}
  syncActiveCharacter(p);saveState();return dropped;
}
function commitTurn(r,p,action,result){
  const player=r.players.get(p.id);if(!player)throw new Error('player_not_in_room');syncActiveCharacter(p);
  const roll=rollCheck(r.scenario,p.character,action,result,player);let woundsAdded=0,deathDrop=[];
  if(roll&&!roll.success){
    if(result.danger==='lethal')woundsAdded=roll.criticalFail?2:1;
    else if(result.danger==='risky'&&(r.scenario.danger_tier||1)>=3&&roll.criticalFail)woundsAdded=1;
    player.wounds=clamp((player.wounds||0)+woundsAdded,0,3);
  }
  if(player.wounds>=3)deathDrop=dropCharacterInventory(r,p);else movePlayerToAnchor(r,p.id,result.move_to);
  const narration=roll?(roll.success?result.success_narration:result.failure_narration):result.no_check_narration;
  r.progress=clamp((r.progress||0)+(roll?(roll.success?14+(r.scenario.danger_tier||1)*2:3):6),0,100);
  const drops=[];
  if(player.alive&&(result.loot||roll?.success)&&Math.random()<.18+(r.scenario.danger_tier||1)*.06){
    const material=randomMaterial(r.scenario);if(material){tryAddRunItem(r,player,material);drops.push(material)}
  }
  if(player.alive&&roll?.success&&Math.random()<.06+(r.scenario.danger_tier||1)*.035){
    const item=createLoot(p,result.music_state,r.scenario,behaviorTags(r,p.id));tryAddRunItem(r,player,item);drops.push(item)
  }
  r.scene.narration=narration+(deathDrop.length?' Персонаж погибает, а всё взятое в поход остаётся в этой сцене.':'');
  r.scene.music_state=deathDrop.length?'grief':result.music_state||'explore';r.scene.intensity=result.danger==='lethal'?0.9:result.danger==='risky'?0.65:0.35;
  r.log.unshift({at:now(),profileId:p.id,actor:p.name,characterId:player.characterId,action,narration:r.scene.narration,roll});
  const alive=[...r.players.values()].filter(x=>x.alive);if(alive.length)r.turnIndex=(r.turnIndex+1)%alive.length;
  if(!alive.length){r.completed=true;r.outcome='wipe';for(const item of r.scene.loot){item.status='lost'}r.scene.loot=[]}
  saveState();return{narration:r.scene.narration,music_state:r.scene.music_state,intensity:r.scene.intensity,dice:roll,wounds:player.wounds,woundsAdded,deathDrop,drops,progress:r.progress};
}


function starterInventory(){
  const out=[];
  for(const [catalogId,quantity] of Object.entries({herb:4,cloth:4,crystal:3,ember_salt:1,frost_heart:1})){
    const def=crafting.materials[catalogId];if(!def)continue;
    out.push({id:id('stack'),catalogId,kind:def.kind,name:def.name,quantity,stackable:true,slotCost:def.slot_cost||1,status:'owned'});
  }
  return out;
}
function syncActiveCharacter(p){
  p.characters=Array.isArray(p.characters)?p.characters:[];
  let active=p.characters.find(x=>x.id===p.activeCharacterId&&x.status==='alive')||p.characters.find(x=>x.status==='alive')||null;
  p.activeCharacterId=active?.id||null;p.character=active;p.alive=Boolean(active);return active;
}
function migrateProfile(p){
  p.characterSlots=Number(p.characterSlots)||3;p.eventTickets=Number.isFinite(p.eventTickets)?p.eventTickets:2;p.subscription=p.subscription||{active:false,expiresAt:null};
  p.inventory=Array.isArray(p.inventory)?p.inventory:[];p.characters=Array.isArray(p.characters)?p.characters:[];p.equipped=p.equipped||{weapon:null,armor:null,charm:null,tool:null};
  if(p.character&&p.characters.length===0){
    const old={...p.character,id:p.character.id||id('char'),status:p.alive===false?'dead':'alive',xp:Number(p.character.xp)||0,level:Number(p.character.level)||1,createdAt:now(),runs:0,wins:0};
    p.characters.push(old);if(old.status==='alive')p.activeCharacterId=old.id;
  }
  syncActiveCharacter(p);return p;
}
function ensureProfile(name='Игрок') {
  const key=normalize(name)||'player';
  if(!persisted.profiles[key]){
    persisted.profiles[key]={id:id('profile'),name:String(name).trim()||'Игрок',balance:120,farmToday:0,farmDay:new Date().toISOString().slice(0,10),inventory:starterInventory(),equipped:{weapon:null,armor:null,charm:null,tool:null},recentActions:[],characterSlots:3,characters:[],activeCharacterId:null,eventTickets:2,subscription:{active:false,expiresAt:null}};
    saveState();
  }
  const p=migrateProfile(persisted.profiles[key]),day=new Date().toISOString().slice(0,10);
  if(p.farmDay!==day){p.farmDay=day;p.farmToday=0;p.recentActions=[];saveState();}
  return p;
}
function publicProfile(p){
  syncActiveCharacter(p);
  return {id:p.id,name:p.name,balance:p.balance,farmToday:p.farmToday,inventory:p.inventory,equipped:p.equipped||{weapon:null,armor:null,charm:null,tool:null},character:p.character,alive:p.alive,
    characterSlots:p.characterSlots,usedSlots:p.characters.filter(x=>x.status==='alive').length,characters:p.characters,activeCharacterId:p.activeCharacterId,
    eventTickets:p.eventTickets,subscription:p.subscription,transactions:persisted.transactions.filter(x=>x.profileId===p.id).slice(0,40)};
}
function xpNeeded(level){return 100+Math.max(0,level-1)*80}
function grantXp(character,amount){
  character.xp=(character.xp||0)+Math.max(0,Math.floor(amount));let levels=0;
  while(character.xp>=xpNeeded(character.level||1)&&(character.level||1)<50){character.xp-=xpNeeded(character.level||1);character.level=(character.level||1)+1;levels++}
  return levels;
}
function runCapacity(character){return clamp(6+Math.floor((((character?.level)||1)-1)/5),6,10)}
function stackCost(item,quantity){return Math.max(1,Number(item.slotCost)||1)*Math.max(1,quantity??item.quantity??1)}
function inventoryUsage(items){return (items||[]).reduce((n,x)=>n+stackCost(x),0)}
function addToStash(p,item){
  item.status='owned';item.ownerId=p.id;
  if(item.stackable){const same=p.inventory.find(x=>x.stackable&&x.catalogId===item.catalogId&&x.kind===item.kind);if(same){same.quantity=(same.quantity||0)+(item.quantity||1);return same}}
  p.inventory.push(item);return item;
}
function canTakeFromStash(p,itemId,quantity=1){const item=p.inventory.find(x=>x.id===itemId);return Boolean(item&&(item.stackable?(item.quantity||0)>=quantity:quantity===1))}
function takeFromStash(p,itemId,quantity=1){
  const idx=p.inventory.findIndex(x=>x.id===itemId);if(idx<0)throw new Error('item_not_found');const item=p.inventory[idx];
  if(item.stackable){if((item.quantity||0)<quantity)throw new Error('insufficient_quantity');item.quantity-=quantity;const out={...item,id:id('runstack'),quantity,status:'run',ownerId:p.id};if(item.quantity<=0)p.inventory.splice(idx,1);return out}
  p.inventory.splice(idx,1);return {...item,status:'run',ownerId:p.id};
}
function consumeInventoryItem(items,itemId,quantity=1){
  const idx=items.findIndex(x=>x.id===itemId);if(idx<0)throw new Error('item_not_found');const item=items[idx];
  if(item.stackable){if((item.quantity||0)<quantity)throw new Error('insufficient_quantity');item.quantity-=quantity;if(item.quantity<=0)items.splice(idx,1);return item}
  if(quantity!==1)throw new Error('insufficient_quantity');items.splice(idx,1);return item;
}
function materialItem(catalogId,quantity=1,status='scene'){
  const d=crafting.materials[catalogId];if(!d)return null;return{id:id('stack'),catalogId,kind:d.kind,name:d.name,quantity,stackable:true,slotCost:d.slot_cost||1,status};
}


function rotationSlot(){return Math.floor(Date.now()/(6*60*60*1000))}
function rotationSeed(){return parseInt(crypto.createHash('sha1').update(String(rotationSlot())).digest('hex').slice(0,8),16)}
function currentEvents(){
  if(!scenarios.length)return[];
  const seed=rotationSeed(),count=clamp(3+(seed%7),3,Math.min(9,scenarios.length)),start=seed%scenarios.length,out=[];
  for(let i=0;i<count;i++)out.push(scenarios[(start+i)%scenarios.length]);
  if(!out.some(x=>x.entry?.type==='free')){const free=scenarios.find(x=>x.entry?.type==='free');if(free)out[out.length-1]=free}
  const expires=new Date((rotationSlot()+1)*6*60*60*1000);
  return [...new Map(out.map(x=>[x.id,x])).values()].map(x=>({...x,players:'1–5 · рек. '+(x.recommended_players||1),rotation_expires_at:expires.toISOString()}));
}
function activeEvent(eventId){return currentEvents().find(x=>x.id===eventId)||null}
function subscriptionActive(p){return Boolean(p.subscription?.active&&(!p.subscription.expiresAt||new Date(p.subscription.expiresAt)>new Date()))}
function accessStatus(p,event){
  if(event.entry?.type==='free')return{ok:true,source:'free'};
  if(subscriptionActive(p))return{ok:true,source:'subscription'};
  if((p.eventTickets||0)>0)return{ok:true,source:'ticket'};
  return{ok:false,source:'payment_required'};
}
function consumeAccess(p,event){
  const a=accessStatus(p,event);if(!a.ok)throw new Error('payment_required');
  if(a.source==='ticket'){p.eventTickets--;persisted.transactions.unshift({id:id('tx'),at:now(),profileId:p.id,type:'event_ticket',amount:0,eventId:event.id})}
  return a;
}
function craftForProfile(p,recipeId,quantity=1){
  const recipe=crafting.recipes.find(x=>x.id===recipeId);if(!recipe)throw new Error('recipe_not_found');quantity=clamp(Math.floor(Number(quantity)||1),1,20);
  for(const [catalogId,cost] of Object.entries(recipe.cost)){
    const have=p.inventory.filter(x=>x.catalogId===catalogId).reduce((n,x)=>n+(x.quantity||1),0);
    if(have<cost*quantity)throw new Error('missing_material_'+catalogId);
  }
  for(const [catalogId,cost] of Object.entries(recipe.cost)){
    let need=cost*quantity;
    for(const item of [...p.inventory]){if(item.catalogId!==catalogId||need<=0)continue;const take=Math.min(need,item.quantity||1);consumeInventoryItem(p.inventory,item.id,take);need-=take}
  }
  const out={id:id('stack'),catalogId:recipe.id,kind:'consumable',name:recipe.output.name,quantity,stackable:true,slotCost:recipe.output.slot_cost||1,effect:recipe.output.effect,status:'owned'};
  addToStash(p,out);persisted.transactions.unshift({id:id('tx'),at:now(),profileId:p.id,type:'craft',amount:0,recipeId,quantity});saveState();return out;
}
function storeView(){
  return{currency:'USD',products:[
    {id:'subscription_monthly',type:'subscription',title:'KisAI Worlds Monthly',price_cents:1499},
    {id:'event_ticket',type:'event_ticket',title:'Билет на платное приключение',price_cents:null,note:'Цена берётся из выбранного события'},
    {id:'character_slot',type:'character_slot',title:'Дополнительный слот персонажа',price_cents:799}
  ],note:'Prototype exposes entitlement gates; checkout provider is intentionally not implemented in this repository.'};
}


async function createCharacterForProfile(p,wish,appearance){
  if(p.characters.filter(x=>x.status==='alive').length>=p.characterSlots)throw new Error('character_slots_full');
  let character=null,ai=false;
  try{character=await generateCharacterAI(wish,appearance);ai=Boolean(character)}catch(e){console.warn('character AI fallback:',e.message)}
  character=character||fallbackCharacter(wish,appearance);
  if(!character.id)character.id=id('char');character.status='alive';character.xp=Number(character.xp)||0;character.level=Number(character.level)||1;character.runs=Number(character.runs)||0;character.wins=Number(character.wins)||0;character.createdAt=character.createdAt||now();
  p.characters.push(character);p.activeCharacterId=character.id;syncActiveCharacter(p);saveState();return{character,ai};
}
function attachCharacterToRoom(room,p,character){
  const pl=room.players.get(p.id);if(!pl)throw new Error('player_not_in_room');
  pl.characterId=character.id;pl.character=character;pl.ready=true;pl.alive=true;pl.wounds=0;pl.nextRollBonus=0;pl.capacity=Math.min(Number(room.scenario?.inventory_slots)||10,runCapacity(character));pl.pendingLoadout=[];pl.runInventory=[];
}
function findActiveRun(profileId){
  for(const room of rooms.values())if(room.started&&!room.completed&&room.players.has(profileId))return room;
  return null;
}
function enchantDefinition(item){const d=crafting.materials[item?.catalogId];return d?.kind==='enchant_ingredient'?d:null}
function enchantRunItem(room,player,targetId,ingredientIds){
  const facility=room.scenario.enchantment;if(!facility)throw new Error('event_has_no_enchanting');
  if(player.position?.anchorId!==facility.anchor_id)throw new Error('not_at_enchantment_facility');
  const target=(player.runInventory||[]).find(x=>x.id===targetId&&x.kind==='equipment');if(!target)throw new Error('equipment_not_in_run_inventory');
  const ids=[...new Set((ingredientIds||[]).map(String))];if(!ids.length||ids.length>facility.max_ingredients)throw new Error('invalid_ingredients');
  const picked=ids.map(x=>{const item=player.runInventory.find(i=>i.id===x),def=enchantDefinition(item);if(!def)throw new Error('invalid_enchant_ingredient');return{item,def}});
  for(const x of picked)consumeInventoryItem(player.runInventory,x.item.id,1);
  const skill=Math.max(Number(player.character?.skills?.Интеллект)||2,Number(player.character?.skills?.Воля)||2);
  const die=nextD20(),modifier=skill-2+Math.floor(((player.character?.level)||1)-1)/5,success=die===20||(die!==1&&die+modifier>=facility.challenge_dc);
  const roll={die,skill:'Интеллект/Воля',modifier,dc:facility.challenge_dc,total:die+modifier,success,critical:die===20,criticalFail:die===1};
  target.enchantments=target.enchantments||[];target.provenance=target.provenance||[];
  if(success){
    const quality=clamp(facility.tier+(roll.critical?1:0),1,5),effects=picked.map(x=>({key:x.def.enchant.key,label:x.def.enchant.label,value:x.def.enchant.base_value*quality}));
    const ench={id:id('ench'),at:now(),eventId:room.scenario.id,facility:facility.label,forgeTier:facility.tier,quality,effects};
    target.enchantments.push(ench);target.provenance.push({at:now(),type:'enchanted',eventId:room.scenario.id,facility:facility.label,quality,effects});
  }else target.provenance.push({at:now(),type:'enchant_failed',eventId:room.scenario.id,facility:facility.label});
  saveState();return{roll,item:target,success};
}

const rarities=['common','uncommon','rare','epic','relic','mythic'];
const rarityBudget={common:2,uncommon:3,rare:5,epic:7,relic:10,mythic:14};
function fingerprint(c={}) {
  return crypto.createHash('sha1').update(JSON.stringify({archetype:c.archetype,skills:c.skills,abilities:c.abilities,weakness:c.weakness,concept:c.concept})).digest('hex').slice(0,12);
}
function rollRarity(state='explore',event=null){
  let x=Math.random()-(Math.max(1,event?.danger_tier||1)-1)*.045;
  if(['boss','discovery'].includes(state))x-=.08;
  if(x<.015)return'mythic';if(x<.055)return'relic';if(x<.15)return'epic';if(x<.34)return'rare';if(x<.62)return'uncommon';return'common';
}
function behaviorTags(room,profileId){
  const text=(room?.log||[]).filter(x=>x.profileId===profileId).slice(0,12).map(x=>x.action).join(' ').toLowerCase(),tags=[];
  if(/скрыт|тихо|тень|обход/.test(text))tags.push('скрытность');
  if(/маг|заклин|ритуал|энерг/.test(text))tags.push('магия');
  if(/удар|атак|меч|ближ/.test(text))tags.push('ближний бой');
  if(/осмотр|след|ищ|развед/.test(text))tags.push('разведка');
  if(/говор|убеж|обман|переговор/.test(text))tags.push('социальное');
  return tags.length?tags:['адаптивность'];
}
function createLoot(profile,state='explore',event=null,tags=[]){
  syncActiveCharacter(profile);
  const c=profile.character||{id:'unknown',name:profile.name,archetype:'Странник',level:1,skills:{Ловкость:1,Воля:1}};
  const rarity=rollRarity(state,event),budget=rarityBudget[rarity],level=clamp(Number(c.level)||1,1,50),skills=Object.entries(c.skills||{}).sort((x,y)=>y[1]-x[1]).slice(0,2).map(x=>x[0]),primary=skills[0]||'Воля';
  const slot=/сил|страж/i.test(c.archetype||'')?'armor':/маг|аркан/i.test(c.archetype||'')?'charm':/лов|следопыт/i.test(c.archetype||'')?'weapon':['weapon','armor','charm','tool'][crypto.randomInt(0,4)];
  const nouns={weapon:['Клинок','Копьё','Резак'],armor:['Панцирь','Кираса','Плащ'],charm:['Печать','Талисман','Осколок'],tool:['Компас','Ключ','Фокус']},style=tags[0]||'адаптивность';
  return{
    id:id('item'),serial:'KW-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase(),kind:'equipment',stackable:false,
    name:nouns[slot][crypto.randomInt(0,nouns[slot].length)]+' · '+style,slot,rarity,level,eventTier:event?.danger_tier||1,
    power:Math.max(1,Math.floor((level+(event?.danger_tier||1)*2+budget)*1.2)),affixes:[{stat:primary,value:Math.max(1,Math.ceil(budget/2))}],
    passive:'Синергия: '+style+' / '+primary,lore:'Уникальный предмет, сформированный поведением '+(c.name||profile.name)+(event?' в событии «'+event.title+'»':'')+'.',
    adaptiveFor:{characterId:c.id,name:c.name||profile.name,archetype:c.archetype,level,dominantSkills:skills,behaviorTags:tags},
    enchantments:[],visualPrompt:'Square premium dark-fantasy RPG inventory card, '+slot+', '+rarity+', '+style+', no text, no UI, no watermark',visual:null,
    provenance:[{at:now(),type:'found',owner:profile.id,eventId:event?.id||null,characterId:c.id}],createdAt:now(),status:'owned',ownerId:profile.id
  };
}
function randomMaterial(event){
  const ids=Object.keys(crafting.materials).filter(k=>crafting.materials[k].kind!=='enchant_ingredient'||(event?.danger_tier||1)>=3);
  if(!ids.length)return null;const catalogId=ids[crypto.randomInt(0,ids.length)],qty=(event?.danger_tier||1)>=4&&crypto.randomInt(0,2)?2:1;
  return materialItem(catalogId,qty,'scene');
}

function fallbackCharacter(wish='',appearance='') {
  const t=normalize(wish);
  const archetype=/маг|разрез|простран|аркан/.test(t)?'Арканист':/щит|брон|танк|сила/.test(t)?'Страж':/лук|след|ловк|скрыт/.test(t)?'Следопыт':'Авантюрист';
  const skills={Сила:2,Ловкость:2,Интеллект:2,Воля:2,Восприятие:2};
  if(archetype==='Арканист'){skills.Интеллект=4;skills.Воля=3}
  if(archetype==='Страж'){skills.Сила=4;skills.Воля=3}
  if(archetype==='Следопыт'){skills.Ловкость=4;skills.Восприятие=3}
  return {id:id('char'),name:'Герой',archetype,level:1,xp:0,status:'alive',runs:0,wins:0,createdAt:now(),concept:wish||'Искатель приключений',appearance,skills,abilities:['Основной приём','Ситуативная способность'],weakness:'Ограниченный ресурс сильных приёмов'};
}
function classifyMusic(text='') {
  const t=normalize(text);
  if(/босс|гигант|последн/.test(t))return'boss'; if(/смерт|погиб|потер/.test(t))return'grief';
  if(/погон|беж|гонит/.test(t))return'chase'; if(/ритуал|культ|алтар/.test(t))return'ritual';
  if(/ад|лава|плам|печь/.test(t))return'hell'; if(/ужас|страх|бездна/.test(t))return'dread';
  if(/бой|атак|удар|враг/.test(t))return'tension'; if(/наш|откр|понял|тайн/.test(t))return'discovery';
  return'explore';
}
function chooseSkill(action){
  const t=normalize(action);if(/поднять|слом|толк|удар|сил/.test(t))return'Сила';if(/прыг|уклон|крад|тихо|ловк|стрел/.test(t))return'Ловкость';
  if(/анализ|взлом|маг|знан|механ/.test(t))return'Интеллект';if(/страх|вол|концент|ритуал/.test(t))return'Воля';return'Восприятие';
}
function fallbackGM(room,action,actor){
  const t=normalize(action),risky=/атак|прыг|взлом|крад|бег|ритуал|слом|лез|переб|плыв/.test(t),lethal=/пропаст|огн|босс|бездн|смертел|прыгаю вниз|прыжок вниз/.test(t);
  const anchor=room.scene.geometry?.anchors?.find(x=>t.includes(normalize(x.label))||t.includes(normalize(x.id)));
  return{check_required:risky,check_skill:chooseSkill(action),difficulty_shift:0,danger:lethal?'lethal':risky?'risky':'safe',
    success_narration:(actor.character?.name||actor.name)+' добивается результата.',failure_narration:'Попытка проваливается и создаёт осложнение.',
    no_check_narration:(actor.character?.name||actor.name)+' действует: '+action+'.',music_state:risky?'tension':'explore',move_to:anchor?.id||null,loot:risky};
}
function fixedDc(event,shift=0){return clamp(7+(event?.danger_tier||1)*2+clamp(Number(shift)||0,-1,1)*2,7,19)}
function rollCheck(event,character,action,proposal,player){
  if(!proposal.check_required)return null;const skill=proposal.check_skill||chooseSkill(action),die=nextD20(),skillValue=Number(character?.skills?.[skill])||2;
  const modifier=skillValue-2+Math.floor(((character?.level)||1)-1)/5+(Number(player?.nextRollBonus)||0);if(player)player.nextRollBonus=0;
  const dc=fixedDc(event,proposal.difficulty_shift),critical=die===20,criticalFail=die===1,success=critical||(!criticalFail&&die+modifier>=dc);
  return{die,skill,modifier,dc,total:die+modifier,success,critical,criticalFail};
}

function farm(profile, action, music) {
  const n=normalize(action); if(n.length<8||profile.recentActions.includes(n))return 0;
  const cap=60, base=['boss','discovery'].includes(music)?5:3, reward=Math.min(base,Math.max(0,cap-profile.farmToday));
  profile.farmToday+=reward; profile.balance+=reward; profile.recentActions.unshift(n); profile.recentActions=profile.recentActions.slice(0,12);
  if(reward) persisted.transactions.unshift({id:id('tx'),at:now(),profileId:profile.id,type:'farm',amount:reward});
  saveState(); return reward;
}
function findItemById(itemId){
  for(const p of Object.values(persisted.profiles)){const item=p.inventory.find(x=>x.id===itemId);if(item)return item;}
  for(const l of persisted.market){if(l.item?.id===itemId)return l.item;}
  for(const r of rooms.values()){const item=(r.scene.loot||[]).find(x=>x.id===itemId);if(item)return item;}
  return null;
}
async function ensureItemVisual(item){
  if(!['epic','relic','mythic'].includes(item.rarity))throw new Error('visual_requires_epic');
  const existing=path.join(ITEM_MEDIA_DIR,item.id+'.png');
  if(fs.existsSync(existing)){item.visual={url:'/api/item-media/'+item.id+'.png',generated:true};return item.visual;}
  const c=runtimeConfig().image||{};if(!c.enabled||!c.api_key||!c.base_url||!c.model)throw new Error('image_not_configured');
  const r=await fetch(String(c.base_url).replace(/\/$/,'')+'/images/generations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.api_key},body:JSON.stringify({model:c.model,prompt:item.visualPrompt||('RPG item '+item.name),size:'1024x1024',n:1})});
  if(!r.ok)throw new Error('image_'+r.status);const d=await r.json(),entry=d.data?.[0];let bytes=null;
  if(entry?.b64_json)bytes=Buffer.from(entry.b64_json,'base64');
  else if(entry?.url){const ir=await fetch(entry.url);if(ir.ok)bytes=Buffer.from(await ir.arrayBuffer());}
  if(!bytes?.length||bytes.length>12_000_000)throw new Error('invalid_generated_image');
  fs.writeFileSync(existing,bytes);item.visual={url:'/api/item-media/'+item.id+'.png',generated:true};saveState();return item.visual;
}
function sceneGeometryFor(scenario){
  const maps={
    glass_maze:{width:28,depth:18,visibilityRadius:12,anchors:[{id:'entry_mirror',label:'Входная арка',x:3,y:9,z:0},{id:'split_gallery',label:'Раздвоенная галерея',x:12,y:6,z:0},{id:'mirror_core',label:'Сердце лабиринта',x:24,y:10,z:0}]},
    black_station:{width:38,depth:16,visibilityRadius:19,anchors:[{id:'train_door',label:'Двери поезда',x:4,y:8,z:0},{id:'platform_lamp',label:'Мигающий фонарь',x:15,y:5,z:0},{id:'station_sign',label:'Табличка ЧЁРНАЯ',x:24,y:7,z:0},{id:'service_door',label:'Служебная дверь',x:34,y:12,z:0}]},
    ash_crown:{width:30,depth:22,visibilityRadius:16,anchors:[{id:'tavern_table',label:'Стол с письмом',x:8,y:10,z:0},{id:'front_door',label:'Выход из трактира',x:15,y:18,z:0},{id:'ash_forge',label:'Пепельная кузница',x:27,y:7,z:0}]},
    red_orbit:{width:32,depth:18,visibilityRadius:17,anchors:[{id:'airlock',label:'Стыковочный шлюз',x:3,y:9,z:0},{id:'main_corridor',label:'Главный коридор',x:13,y:9,z:0},{id:'control_door',label:'Центр управления',x:24,y:5,z:0},{id:'service_hatch',label:'Сервисный люк',x:27,y:14,z:0}]},
    bone_foundry:{width:42,depth:24,visibilityRadius:16,anchors:[{id:'cage_lift',label:'Лифт-клеть',x:3,y:12,z:0},{id:'smelter',label:'Плавильный цех',x:17,y:9,z:0},{id:'bone_forge',label:'Кузница Белого Пламени',x:31,y:6,z:0},{id:'exit_shaft',label:'Выходная шахта',x:39,y:18,z:0}]},
    drowned_cathedral:{width:48,depth:30,visibilityRadius:15,anchors:[{id:'sealed_door',label:'Каменная дверь',x:4,y:15,z:0},{id:'nave',label:'Затопленный неф',x:18,y:15,z:0},{id:'crypt',label:'Крипта',x:31,y:21,z:-3},{id:'deep_altar',label:'Алтарь Глубины',x:43,y:10,z:-5}]},
    ember_archive:{width:32,depth:18,visibilityRadius:14,anchors:[{id:'elevator',label:'Лифт −1',x:3,y:9,z:0},{id:'stacks',label:'Горячие стеллажи',x:15,y:8,z:0},{id:'night_book',label:'Книга текущей ночи',x:28,y:12,z:0}]},
    iron_rain:{width:50,depth:26,visibilityRadius:18,anchors:[{id:'valley_edge',label:'Край долины',x:3,y:13,z:0},{id:'storm_field',label:'Поле железного дождя',x:20,y:13,z:0},{id:'tower',label:'Старая башня',x:34,y:18,z:0},{id:'storm_anvil',label:'Грозовая наковальня',x:46,y:8,z:0}]},
    null_garden:{width:52,depth:34,visibilityRadius:16,anchors:[{id:'airlock',label:'Гермодверь',x:4,y:17,z:0},{id:'white_tree',label:'Белое дерево',x:25,y:17,z:0},{id:'fracture',label:'Разлом физики',x:37,y:24,z:-2},{id:'zero_font',label:'Источник Нуля',x:48,y:9,z:-4}]}
  };
  return maps[scenario?.id]||{width:24,depth:18,visibilityRadius:15,anchors:[{id:'center',label:'Центр сцены',x:12,y:9,z:0}]};
}
function createScene(scenario,narration){
  return {id:id('scene'),title:scenario?.title||'Сцена',narration:narration??scenario?.opening??'',music_state:'explore',intensity:.25,loot:[],geometry:sceneGeometryFor(scenario)};
}
function spawnPosition(scene,index=0){
  const a=scene.geometry?.anchors?.[0]||{x:0,y:0,z:0};
  return {x:a.x+Math.min(index,3)*.7,y:a.y,z:a.z||0,eyeHeight:1.7,anchorId:a.id};
}
function movePlayerToAnchor(room,profileId,anchorId){
  if(!anchorId)return false;const player=room.players.get(profileId),a=room.scene.geometry?.anchors?.find(x=>x.id===anchorId);
  if(!player||!a)return false;player.position={x:a.x,y:a.y,z:a.z||0,eyeHeight:player.position?.eyeHeight||1.7,anchorId:a.id};return true;
}
function personalPOV(room,profileId){
  const player=room.players.get(profileId);if(!player)return null;
  const pos=player.position||spawnPosition(room.scene,0),radius=room.scene.geometry?.visibilityRadius||15;
  const visible=(room.scene.geometry?.anchors||[]).filter(a=>Math.hypot((a.x||0)-pos.x,(a.y||0)-pos.y)<=radius);
  return {sceneId:room.scene.id,canonicalTitle:room.scene.title,camera:{x:pos.x,y:pos.y,z:(pos.z||0)+pos.eyeHeight,eyeHeight:pos.eyeHeight,anchorId:pos.anchorId},visibleAnchors:visible,hiddenAnchorCount:Math.max(0,(room.scene.geometry?.anchors?.length||0)-visible.length),narration:room.scene.narration,music_state:room.scene.music_state};
}

async function createPersistentCharacter(p,wish,appearance){
  if(p.characters.filter(x=>x.status==='alive').length>=p.characterSlots)throw new Error('character_slots_full');
  let generated=null;try{generated=await generateCharacterAI(wish,appearance)}catch(e){console.warn('character AI fallback:',e.message)}
  const c=generated||fallbackCharacter(wish,appearance);
  Object.assign(c,{id:c.id||id('char'),status:'alive',xp:Number(c.xp)||0,level:Number(c.level)||1,createdAt:now(),runs:0,wins:0});
  p.characters.push(c);p.activeCharacterId=c.id;syncActiveCharacter(p);saveState();return c;
}
function selectCharacter(p,characterId){
  const c=p.characters.find(x=>x.id===characterId&&x.status==='alive');if(!c)throw new Error('character_not_found_or_dead');
  p.activeCharacterId=c.id;syncActiveCharacter(p);saveState();return c;
}
function makeRoomPlayer(p,scene,index=0){
  const c=syncActiveCharacter(p);
  return{id:p.id,name:p.name,profile:p,characterId:c?.id||null,character:c||null,ready:Boolean(c),alive:Boolean(c),position:spawnPosition(scene,index),wounds:0,nextRollBonus:0,capacity:runCapacity(c),pendingLoadout:[],runInventory:[]};
}
function findActiveRunForProfile(profileId){for(const r of rooms.values())if(r.started&&!r.completed&&r.players.has(profileId))return r;return null}
function finishRun(r){
  if(r.completed)throw new Error('run_completed');if((r.progress||0)<100)throw new Error('objectives_incomplete');
  const alive=[...r.players.values()].filter(x=>x.alive);if(!alive.length)throw new Error('party_wiped');
  const participants=Math.max(1,r.participantsAtStart||r.players.size),underfill=clamp((r.scenario.recommended_players||1)/participants,1,2.5),rewards=[];
  for(const pl of alive){
    const p=ensureProfile(pl.name),c=p.characters.find(x=>x.id===pl.characterId);if(!c)continue;
    for(const item of pl.runInventory||[]){item.provenance=item.provenance||[];item.provenance.push({at:now(),type:'extracted',eventId:r.scenario.id,characterId:c.id});addToStash(p,item)}
    pl.runInventory=[];
    const uniqueCount=clamp(1+Math.floor((underfill-1)*1.5),1,3),unique=[];
    p.activeCharacterId=c.id;syncActiveCharacter(p);
    for(let i=0;i<uniqueCount;i++){const item=createLoot(p,'discovery',r.scenario,behaviorTags(r,p.id));addToStash(p,item);unique.push(item)}
    const xp=Math.round((r.scenario.xp_base||80)*underfill),levels=grantXp(c,xp);c.wins=(c.wins||0)+1;
    persisted.transactions.unshift({id:id('tx'),at:now(),profileId:p.id,type:'event_complete',amount:0,eventId:r.scenario.id,xp,underfill});
    rewards.push({profileId:p.id,characterId:c.id,xp,levels,underfill,unique});
  }
  for(const item of r.scene.loot||[]){item.status='lost';item.provenance=item.provenance||[];item.provenance.push({at:now(),type:'left_behind',eventId:r.scenario.id})}
  r.scene.loot=[];r.completed=true;r.outcome='success';r.completedAt=now();saveState();return rewards;
}
function useRunItem(r,player,itemId){
  const item=(player.runInventory||[]).find(x=>x.id===itemId&&x.kind==='consumable');if(!item)throw new Error('consumable_not_found');
  const effect=item.effect||{};consumeInventoryItem(player.runInventory,item.id,1);
  if(effect.type==='heal_wound')player.wounds=Math.max(0,(player.wounds||0)-(Number(effect.value)||1));
  if(['roll_bonus','traversal','escape'].includes(effect.type))player.nextRollBonus=Math.max(Number(player.nextRollBonus)||0,Number(effect.value)||1);
  saveState();return{effect,wounds:player.wounds,nextRollBonus:player.nextRollBonus||0};
}
function enchantItem(r,player,targetId,ingredientIds){
  const facility=r.scenario.enchantment;if(!facility)throw new Error('event_has_no_enchanting');
  if(player.position?.anchorId!==facility.anchor_id)throw new Error('not_at_enchantment_facility');
  const target=(player.runInventory||[]).find(x=>x.id===targetId&&x.kind==='equipment');if(!target)throw new Error('equipment_not_in_run_inventory');
  target.enchantments=Array.isArray(target.enchantments)?target.enchantments:[];
  if(target.enchantments.length>=1+Math.floor((facility.tier||1)/2))throw new Error('enchantment_slots_full');
  const ids=[...new Set((ingredientIds||[]).map(String))];if(!ids.length||ids.length>(facility.max_ingredients||1))throw new Error('invalid_ingredients');
  const ingredients=ids.map(itemId=>{
    const item=player.runInventory.find(x=>x.id===itemId),def=item&&crafting.materials[item.catalogId];
    if(!item||def?.kind!=='enchant_ingredient')throw new Error('invalid_enchant_ingredient');return{item,def};
  });
  for(const x of ingredients)consumeInventoryItem(player.runInventory,x.item.id,1);
  const skill=Math.max(Number(player.character?.skills?.Интеллект)||2,Number(player.character?.skills?.Воля)||2),die=nextD20(),modifier=skill-2+Math.floor(((player.character?.level)||1)-1)/5,dc=facility.challenge_dc||13;
  const success=die===20||(die!==1&&die+modifier>=dc),roll={die,skill:'Интеллект/Воля',modifier,dc,total:die+modifier,success,critical:die===20,criticalFail:die===1};
  target.provenance=target.provenance||[];
  if(success){
    const quality=clamp((facility.tier||1)+(roll.critical?1:0),1,5);
    const effects=ingredients.map(x=>({key:x.def.enchant.key,label:x.def.enchant.label,value:x.def.enchant.base_value*quality}));
    const ench={id:id('ench'),at:now(),eventId:r.scenario.id,facility:facility.label,forgeTier:facility.tier,quality,effects};
    target.enchantments.push(ench);target.provenance.push({at:now(),type:'enchanted',eventId:r.scenario.id,facility:facility.label,quality,effects});
  }else target.provenance.push({at:now(),type:'enchant_failed',eventId:r.scenario.id,facility:facility.label});
  saveState();return{roll,item:target,success};
}

function getRoom(c){ return rooms.get(String(c||'').toUpperCase()); }
function roomView(r){
  return {code:r.code,scenario:r.scenario,event:r.scenario,hostId:r.hostId,started:r.started,completed:Boolean(r.completed),outcome:r.outcome||null,
    turnIndex:r.turnIndex,progress:r.progress||0,participantsAtStart:r.participantsAtStart||0,scene:r.scene,
    players:[...r.players.values()].map(x=>({id:x.id,name:x.name,ready:x.ready,characterId:x.characterId,character:x.character||x.profile?.character||null,
      alive:x.alive!==false,position:x.position,wounds:x.wounds||0,capacity:x.capacity||6,runUsage:inventoryUsage(x.runInventory||[]),
      runInventory:x.runInventory||[],pendingLoadout:x.pendingLoadout||[]}))};
}

async function api(req,res,u){
  try{
    if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,version:'0.7.0-extraction-core',llm:providerReady('llm'),stt:providerReady('stt'),tts:providerReady('tts')});
    if(req.method==='GET'&&(u.pathname==='/api/scenarios'||u.pathname==='/api/events'))return json(res,200,currentEvents());
    if(req.method==='GET'&&u.pathname==='/api/event-catalog')return json(res,200,scenarios);
    if(req.method==='GET'&&u.pathname==='/api/crafting')return json(res,200,crafting);
    if(req.method==='GET'&&u.pathname==='/api/store')return json(res,200,storeView());

    const itemMedia=u.pathname.match(/^\/api\/item-media\/([a-zA-Z0-9_-]+)\.png$/);
    if(req.method==='GET'&&itemMedia){
      const file=path.join(ITEM_MEDIA_DIR,itemMedia[1]+'.png');if(!fs.existsSync(file)){res.writeHead(404);return res.end('Not found')}
      res.writeHead(200,{'content-type':'image/png','cache-control':'private, max-age=86400'});return fs.createReadStream(file).pipe(res);
    }
    const itemVisual=u.pathname.match(/^\/api\/items\/([^/]+)\/visual$/);
    if(req.method==='POST'&&itemVisual){
      const b=await body(req);ensureProfile(b.name);const item=findItemById(itemVisual[1]);if(!item)return json(res,404,{error:'item_not_found'});
      try{return json(res,200,{visual:await ensureItemVisual(item)})}catch(e){return json(res,e.message==='image_not_configured'?409:422,{error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/config'){
      const c=readJson(CONFIG_FILE,{}),scrub=o=>Object.fromEntries(Object.entries(o||{}).map(([k,v])=>[k,/key/i.test(k)?(v?'••••••':''):v]));
      return json(res,200,{...c,llm:scrub(c.llm),stt:scrub(c.stt),tts:scrub(c.tts),image:scrub(c.image)});
    }
    if(req.method==='POST'&&u.pathname==='/api/config'){
      const incoming=await body(req),current=readJson(CONFIG_FILE,{});
      for(const section of ['llm','stt','tts','image'])if(incoming[section])current[section]={...(current[section]||{}),...incoming[section],api_key:incoming[section].api_key?.includes('•')?current[section]?.api_key:incoming[section].api_key};
      if(Number(incoming.port))current.port=Number(incoming.port);writeJson(CONFIG_FILE,current);return json(res,200,{ok:true});
    }

    if(req.method==='GET'&&u.pathname==='/api/profile'){const p=ensureProfile(u.searchParams.get('name'));return json(res,200,publicProfile(p))}
    if(req.method==='POST'&&u.pathname==='/api/profile/character'){
      const b=await body(req),p=ensureProfile(b.name);
      try{const made=await createCharacterForProfile(p,b.wish,b.appearance);return json(res,201,{...made,profile:publicProfile(p)})}catch(e){return json(res,409,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/select-character'){
      const b=await body(req),p=ensureProfile(b.name),c=p.characters.find(x=>x.id===b.characterId&&x.status==='alive');if(!c)return json(res,404,{error:'character_not_found_or_dead'});
      p.activeCharacterId=c.id;syncActiveCharacter(p);saveState();return json(res,200,publicProfile(p));
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/craft'){
      const b=await body(req),p=ensureProfile(b.name);if(findActiveRun(p.id))return json(res,409,{error:'cannot_craft_during_run'});
      try{return json(res,200,{item:craftForProfile(p,b.recipeId,b.quantity),profile:publicProfile(p)})}catch(e){return json(res,409,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/equip'){
      const b=await body(req),p=ensureProfile(b.name),item=p.inventory.find(x=>x.id===b.itemId&&x.kind==='equipment');if(!item)return json(res,404,{error:'equipment_not_found'});
      p.equipped=p.equipped||{weapon:null,armor:null,charm:null,tool:null};p.equipped[item.slot]=item.id;saveState();return json(res,200,publicProfile(p));
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/unequip'){
      const b=await body(req),p=ensureProfile(b.name),slot=String(b.slot||'');if(!['weapon','armor','charm','tool'].includes(slot))return json(res,409,{error:'invalid_slot'});
      p.equipped=p.equipped||{weapon:null,armor:null,charm:null,tool:null};p.equipped[slot]=null;saveState();return json(res,200,publicProfile(p));
    }

    if(req.method==='POST'&&u.pathname==='/api/rooms'){
      const b=await body(req),event=activeEvent(b.eventId||b.scenarioId);if(!event)return json(res,409,{error:'event_not_active'});
      const p=ensureProfile(b.name);if(findActiveRun(p.id))return json(res,409,{error:'already_in_active_run'});const c=p.characters.find(x=>x.id===(b.characterId||p.activeCharacterId)&&x.status==='alive')||syncActiveCharacter(p);
      const scene=createScene(event,event.opening||'');scene.music_state='lobby';
      const r={code:code(),scenario:event,hostId:p.id,started:false,completed:false,outcome:null,turnIndex:0,progress:0,participantsAtStart:0,players:new Map(),scene,log:[],createdAt:now()};
      const pl={id:p.id,name:p.name,ready:false,profile:p,characterId:null,character:null,alive:false,wounds:0,nextRollBonus:0,position:spawnPosition(scene,0),capacity:6,pendingLoadout:[],runInventory:[]};
      r.players.set(p.id,pl);if(c)attachCharacterToRoom(r,p,c);rooms.set(r.code,r);
      return json(res,201,{room:roomView(r),profile:publicProfile(p),access:accessStatus(p,event)});
    }
    const join=u.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if(req.method==='POST'&&join){
      const r=getRoom(join[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});if(r.players.size>=5)return json(res,409,{error:'party_full'});
      const b=await body(req),p=ensureProfile(b.name);if(findActiveRun(p.id))return json(res,409,{error:'already_in_active_run'});const c=p.characters.find(x=>x.id===(b.characterId||p.activeCharacterId)&&x.status==='alive')||syncActiveCharacter(p);
      const pl={id:p.id,name:p.name,ready:false,profile:p,characterId:null,character:null,alive:false,wounds:0,nextRollBonus:0,position:spawnPosition(r.scene,r.players.size),capacity:6,pendingLoadout:[],runInventory:[]};
      r.players.set(p.id,pl);if(c)attachCharacterToRoom(r,p,c);return json(res,200,{room:roomView(r),profile:publicProfile(p),access:accessStatus(p,r.scenario)});
    }
    const roomGet=u.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if(req.method==='GET'&&roomGet){const r=getRoom(roomGet[1]);return r?json(res,200,roomView(r)):json(res,404,{error:'room_not_found'})}
    const pov=u.pathname.match(/^\/api\/rooms\/([^/]+)\/pov$/);
    if(req.method==='GET'&&pov){const r=getRoom(pov[1]);if(!r)return json(res,404,{error:'room_not_found'});const p=ensureProfile(u.searchParams.get('name')),view=personalPOV(r,p.id);return view?json(res,200,view):json(res,404,{error:'player_not_in_room'})}

    const select=u.pathname.match(/^\/api\/rooms\/([^/]+)\/select-character$/);
    if(req.method==='POST'&&select){
      const r=getRoom(select[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});
      const b=await body(req),p=ensureProfile(b.name),c=p.characters.find(x=>x.id===b.characterId&&x.status==='alive');if(!c)return json(res,404,{error:'character_not_found_or_dead'});
      p.activeCharacterId=c.id;syncActiveCharacter(p);attachCharacterToRoom(r,p,c);saveState();return json(res,200,{room:roomView(r),profile:publicProfile(p)});
    }
    const char=u.pathname.match(/^\/api\/rooms\/([^/]+)\/character$/);
    if(req.method==='POST'&&char){
      const r=getRoom(char[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});
      const b=await body(req),p=ensureProfile(b.name);
      try{const made=await createCharacterForProfile(p,b.wish,b.appearance);attachCharacterToRoom(r,p,made.character);return json(res,200,{...made,profile:publicProfile(p),room:roomView(r)})}catch(e){return json(res,409,{error:e.message})}
    }
    const loadout=u.pathname.match(/^\/api\/rooms\/([^/]+)\/loadout$/);
    if(req.method==='POST'&&loadout){
      const r=getRoom(loadout[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});
      const b=await body(req),p=ensureProfile(b.name),pl=r.players.get(p.id);if(!pl?.character)return json(res,409,{error:'character_required'});
      const agg=new Map();for(const x of Array.isArray(b.items)?b.items:[]){const itemId=String(x.itemId||''),q=clamp(Math.floor(Number(x.quantity)||1),1,99);if(itemId)agg.set(itemId,(agg.get(itemId)||0)+q)}
      const requests=[...agg].map(([itemId,quantity])=>({itemId,quantity}));let usage=0;
      for(const q of requests){const item=p.inventory.find(x=>x.id===q.itemId);if(!item||!canTakeFromStash(p,q.itemId,q.quantity))return json(res,409,{error:'invalid_loadout_item',itemId:q.itemId});usage+=stackCost(item,q.quantity)}
      if(usage>pl.capacity)return json(res,409,{error:'run_inventory_over_capacity',usage,capacity:pl.capacity});
      pl.pendingLoadout=requests;return json(res,200,{room:roomView(r),usage,capacity:pl.capacity});
    }
    const start=u.pathname.match(/^\/api\/rooms\/([^/]+)\/start$/);
    if(req.method==='POST'&&start){
      const r=getRoom(start[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});
      const players=[...r.players.values()];if(!players.length)return json(res,409,{error:'empty_party'});
      for(const pl of players){
        const p=ensureProfile(pl.name);if(!pl.character||!pl.alive)return json(res,409,{error:'all_players_need_alive_character',player:pl.name});
        if(!accessStatus(p,r.scenario).ok)return json(res,402,{error:'payment_required',player:pl.name,event:r.scenario.id});
        for(const q of pl.pendingLoadout||[])if(!canTakeFromStash(p,q.itemId,q.quantity))return json(res,409,{error:'loadout_changed',player:pl.name,itemId:q.itemId});
      }
      for(const pl of players){
        const p=ensureProfile(pl.name);consumeAccess(p,r.scenario);pl.runInventory=[];
        for(const q of pl.pendingLoadout||[]){const item=takeFromStash(p,q.itemId,q.quantity);item.provenance=item.provenance||[];item.provenance.push({at:now(),type:'entered_event',eventId:r.scenario.id,characterId:pl.characterId});pl.runInventory.push(item)}
        const c=p.characters.find(x=>x.id===pl.characterId);if(c)c.runs=(c.runs||0)+1;
      }
      r.started=true;r.participantsAtStart=players.length;r.startedAt=now();r.scene.music_state='explore';saveState();return json(res,200,roomView(r));
    }

    const turn=u.pathname.match(/^\/api\/rooms\/([^/]+)\/turn$/);
    if(req.method==='POST'&&turn){
      const r=getRoom(turn[1]);if(!r)return json(res,404,{error:'room_not_found'});if(!r.started||r.completed)return json(res,409,{error:'run_not_active'});
      const b=await body(req),p=ensureProfile(b.name),pl=r.players.get(p.id);if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      const action=String(b.action||'осматриваюсь').slice(0,1200),proposal=await resolveGMAI(r,action,p),committed=commitTurn(r,p,action,proposal);
      return json(res,200,{...proposal,...committed,room:roomView(r),profile:publicProfile(p),ai:providerReady('llm')});
    }
    const voiceTurn=u.pathname.match(/^\/api\/rooms\/([^/]+)\/voice-turn$/);
    if(req.method==='POST'&&voiceTurn){
      const r=getRoom(voiceTurn[1]);if(!r)return json(res,404,{error:'room_not_found'});if(!r.started||r.completed)return json(res,409,{error:'run_not_active'});
      const b=await body(req),p=ensureProfile(b.name),pl=r.players.get(p.id);if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      const action=await transcribeAudio(b.audioBase64,b.mimeType||'audio/webm');if(!action)return json(res,422,{error:'empty_transcript'});
      const proposal=await resolveGMAI(r,action,p),committed=commitTurn(r,p,action,proposal);let speechBase64=null;
      try{speechBase64=await synthesizeSpeech(committed.narration)}catch(e){console.warn('TTS fallback:',e.message)}
      return json(res,200,{transcript:action,...proposal,...committed,room:roomView(r),profile:publicProfile(p),speechBase64,speechMime:'audio/mpeg'});
    }

    const claim=u.pathname.match(/^\/api\/rooms\/([^/]+)\/loot\/([^/]+)\/claim$/);
    if(req.method==='POST'&&claim){
      const r=getRoom(claim[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name),pl=r.players.get(p.id);
      if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      const idx=(r.scene.loot||[]).findIndex(x=>x.id===claim[2]&&x.status==='scene');if(idx<0)return json(res,404,{error:'loot_not_found'});const item=r.scene.loot[idx];
      if(inventoryUsage(pl.runInventory)+stackCost(item)>pl.capacity)return json(res,409,{error:'run_inventory_full',usage:inventoryUsage(pl.runInventory),capacity:pl.capacity});
      r.scene.loot.splice(idx,1);item.status='run';item.ownerId=p.id;item.provenance=item.provenance||[];item.provenance.push({at:now(),type:'claimed_in_event',eventId:r.scenario.id,characterId:pl.characterId});pl.runInventory.push(item);saveState();
      return json(res,200,{item,room:roomView(r),profile:publicProfile(p)});
    }
    const use=u.pathname.match(/^\/api\/rooms\/([^/]+)\/use-item$/);
    if(req.method==='POST'&&use){
      const r=getRoom(use[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name),pl=r.players.get(p.id);if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      try{return json(res,200,{...useRunItem(r,pl,b.itemId),room:roomView(r)})}catch(e){return json(res,409,{error:e.message})}
    }
    const enchant=u.pathname.match(/^\/api\/rooms\/([^/]+)\/enchant$/);
    if(req.method==='POST'&&enchant){
      const r=getRoom(enchant[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name),pl=r.players.get(p.id);if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      try{return json(res,200,{...enchantRunItem(r,pl,b.targetId,b.ingredientIds),room:roomView(r)})}catch(e){return json(res,409,{error:e.message})}
    }
    const extract=u.pathname.match(/^\/api\/rooms\/([^/]+)\/extract$/);
    if(req.method==='POST'&&extract){
      const r=getRoom(extract[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name);if(!r.players.has(p.id))return json(res,404,{error:'player_not_in_room'});
      try{const rewards=finishRun(r);return json(res,200,{rewards,room:roomView(r),profile:publicProfile(p)})}catch(e){return json(res,409,{error:e.message,progress:r.progress||0})}
    }

    if(req.method==='GET'&&u.pathname==='/api/market')return json(res,200,persisted.market.filter(x=>x.status==='active'));
    if(req.method==='POST'&&u.pathname==='/api/market/list'){
      const b=await body(req),p=ensureProfile(b.name);if(findActiveRun(p.id))return json(res,409,{error:'cannot_trade_during_run'});
      const idx=p.inventory.findIndex(x=>x.id===b.itemId&&x.kind==='equipment');if(idx<0)return json(res,404,{error:'equipment_not_found'});
      const item=p.inventory.splice(idx,1)[0];p.equipped=p.equipped||{};if(p.equipped[item.slot]===item.id)p.equipped[item.slot]=null;item.status='escrow';
      const listing={id:id('listing'),item,sellerId:p.id,sellerName:p.name,price:clamp(Number(b.price)||1,1,1_000_000),status:'active',createdAt:now()};persisted.market.push(listing);persisted.transactions.unshift({id:id('tx'),at:now(),profileId:p.id,type:'market_list',amount:0,itemId:item.id,price:listing.price});saveState();return json(res,201,listing);
    }
    if(req.method==='POST'&&u.pathname==='/api/market/buy'){
      const b=await body(req),buyer=ensureProfile(b.name);if(findActiveRun(buyer.id))return json(res,409,{error:'cannot_trade_during_run'});
      const l=persisted.market.find(x=>x.id===b.listingId&&x.status==='active');if(!l)return json(res,404,{error:'listing_not_found'});if(l.sellerId===buyer.id)return json(res,409,{error:'own_listing'});if(buyer.balance<l.price)return json(res,409,{error:'insufficient_balance'});
      const seller=Object.values(persisted.profiles).map(migrateProfile).find(x=>x.id===l.sellerId),net=Math.floor(l.price*.975),fee=l.price-net;buyer.balance-=l.price;if(seller)seller.balance+=net;l.status='sold';l.item.status='owned';l.item.ownerId=buyer.id;l.item.provenance=l.item.provenance||[];l.item.provenance.push({at:now(),type:'trade',from:l.sellerId,to:buyer.id,price:l.price});addToStash(buyer,l.item);
      persisted.transactions.unshift({id:id('tx'),at:now(),profileId:buyer.id,type:'market_buy',amount:-l.price,itemId:l.item.id,counterparty:l.sellerId},{id:id('tx'),at:now(),profileId:l.sellerId,type:'market_sale',amount:net,itemId:l.item.id,counterparty:buyer.id,fee});saveState();return json(res,200,{listing:l,profile:publicProfile(buyer)});
    }
    if(req.method==='POST'&&u.pathname==='/api/market/cancel'){
      const b=await body(req),p=ensureProfile(b.name),l=persisted.market.find(x=>x.id===b.listingId&&x.status==='active'&&x.sellerId===p.id);if(!l)return json(res,404,{error:'listing_not_found'});
      l.status='cancelled';addToStash(p,l.item);persisted.transactions.unshift({id:id('tx'),at:now(),profileId:p.id,type:'market_cancel',amount:0,itemId:l.item.id});saveState();return json(res,200,{profile:publicProfile(p)});
    }

    return json(res,404,{error:'not_found'});
  }catch(e){console.error(e);return json(res,500,{error:'server_error',message:e.message})}
}
function staticFile(req,res,u){
  let rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname);
  rel=path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file=path.join(PUBLIC,rel);
  if(!file.startsWith(PUBLIC)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':'no-cache'});
  fs.createReadStream(file).pipe(res);
}

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(u.pathname.startsWith('/api/')) return api(req,res,u);
  staticFile(req,res,u);
});
server.listen(Number(config.port)||8787,'0.0.0.0',()=>console.log(`KisAI Worlds running at http://localhost:${Number(config.port)||8787}`));
