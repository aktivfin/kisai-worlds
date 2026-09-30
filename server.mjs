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
  if(!providerReady('llm')) return null;
  const recent=room.log.slice(0,8).reverse().map(x=>x.actor+': '+x.action+' -> '+x.narration).join('\\n');
  const system='You are the authoritative GM runtime for KisAI Worlds. Resolve one player action using only established scene facts. Never grant impossible numeric power because the player asks for it. Character death is allowed only when it is a direct, clearly justified consequence already supported by the scene. Return ONLY JSON: {"narration":string,"music_state":"explore|tavern|investigation|discovery|tension|chase|ritual|abyss|dread|hell|boss|grief","intensity":0..1,"scene_transition":boolean,"loot":boolean,"actor_dies":boolean,"move_to":string|null}. move_to may only be an anchor id from the canonical geometry. Keep narration under 650 chars.';
  const user='Scenario: '+room.scenario?.title+'\\nOpening: '+room.scenario?.opening+'\\nCurrent scene: '+room.scene?.narration+'\\nRecent history:\\n'+recent+'\\nActor: '+actor.name+' / '+JSON.stringify(actor.character||{})+'\\nAction: '+action;
  const text=await openAIChat([{role:'system',content:system},{role:'user',content:user}],.65);
  const x=safeJsonText(text); if(!x)return null;
  const allowed=['explore','tavern','investigation','discovery','tension','chase','ritual','abyss','dread','hell','boss','grief'];
  return {narration:String(x.narration||'').slice(0,900)||fallbackGM(room,action,actor).narration,music_state:allowed.includes(x.music_state)?x.music_state:classifyMusic(x.narration||action),intensity:clamp(Number(x.intensity)||.4,0,1),scene_transition:Boolean(x.scene_transition),loot:Boolean(x.loot),actor_dies:Boolean(x.actor_dies),move_to:typeof x.move_to==='string'?x.move_to:null};
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
function dropCharacterInventory(r,p){
  if(!p.alive)return [];
  const dropped=[...p.inventory]; p.inventory=[];
  for(const listing of persisted.market){
    if(listing.status==='active'&&listing.sellerId===p.id){
      listing.status='cancelled_on_death';
      dropped.push(listing.item);
    }
  }
  for(const item of dropped){
    item.status='scene'; item.ownerId=null;
    item.provenance.push({at:now(),type:'death_drop',owner:p.id,sceneId:r.scene.id});
  }
  r.scene.loot=[...(r.scene.loot||[]),...dropped];
  p.equipped={weapon:null,armor:null,charm:null,tool:null}; p.alive=false;
  saveState();
  return dropped;
}
function commitTurn(r,p,action,result){
  const earned=farm(p,action,result.music_state);let loot=null,deathDrop=[];
  if(result.loot&&p.character&&!result.actor_dies){loot=createLoot(p,result.music_state);p.inventory.push(loot);saveState();}
  if(result.actor_dies)deathDrop=dropCharacterInventory(r,p);else movePlayerToAnchor(r,p.id,result.move_to);
  const previousSceneId=r.scene.id;
  if(result.scene_transition){
    const abandoned=(r.scene.loot||[]).filter(x=>x.status==='scene');
    for(const item of abandoned){item.status='lost';item.provenance.push({at:now(),type:'lost',sceneId:previousSceneId});}
    r.scene=createScene(r.scenario,result.narration);for(const [idx,pl] of [...r.players.values()].entries())pl.position=spawnPosition(r.scene,idx);saveState();
  }
  r.scene={...r.scene,narration:result.narration,music_state:result.music_state,intensity:result.intensity};
  r.log.unshift({at:now(),actor:p.name,action,narration:result.narration});
  const alive=[...r.players.values()].filter(x=>x.profile.alive);
  if(alive.length)r.turnIndex=(r.turnIndex+1)%alive.length;
  return {earned,loot,deathDrop};
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
  p.inventory=Array.isArray(p.inventory)?p.inventory:[];p.characters=Array.isArray(p.characters)?p.characters:[];
  if(p.character&&p.characters.length===0){
    const old={...p.character,id:p.character.id||id('char'),status:p.alive===false?'dead':'alive',xp:Number(p.character.xp)||0,level:Number(p.character.level)||1,createdAt:now(),runs:0,wins:0};
    p.characters.push(old);if(old.status==='alive')p.activeCharacterId=old.id;
  }
  syncActiveCharacter(p);return p;
}
function ensureProfile(name='Игрок') {
  const key=normalize(name)||'player';
  if(!persisted.profiles[key]){
    persisted.profiles[key]={id:id('profile'),name:String(name).trim()||'Игрок',balance:120,farmToday:0,farmDay:new Date().toISOString().slice(0,10),inventory:starterInventory(),recentActions:[],characterSlots:3,characters:[],activeCharacterId:null,eventTickets:2,subscription:{active:false,expiresAt:null}};
    saveState();
  }
  const p=migrateProfile(persisted.profiles[key]),day=new Date().toISOString().slice(0,10);
  if(p.farmDay!==day){p.farmDay=day;p.farmToday=0;p.recentActions=[];saveState();}
  return p;
}
function publicProfile(p){
  syncActiveCharacter(p);
  return {id:p.id,name:p.name,balance:p.balance,farmToday:p.farmToday,inventory:p.inventory,character:p.character,alive:p.alive,
    characterSlots:p.characterSlots,usedSlots:p.characters.filter(x=>x.status==='alive').length,characters:p.characters,activeCharacterId:p.activeCharacterId,
    eventTickets:p.eventTickets,subscription:p.subscription,transactions:persisted.transactions.filter(x=>x.profileId===p.id).slice(0,40)};
}
function xpNeeded(level){return 100+Math.max(0,level-1)*80}
function grantXp(character,amount){
  character.xp=(character.xp||0)+Math.max(0,Math.floor(amount));let levels=0;
  while(character.xp>=xpNeeded(character.level||1)&&(character.level||1)<50){character.xp-=xpNeeded(character.level||1);character.level=(character.level||1)+1;levels++}
  return levels;
}
function runCapacity(character){return clamp(6+Math.floor(((character?.level)||1)-1)/5,6,10)}
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

const rarities=['common','uncommon','rare','epic','relic','mythic'];
const rarityBudget={common:2,uncommon:3,rare:5,epic:7,relic:10,mythic:14};
function fingerprint(c={}) {
  return crypto.createHash('sha1').update(JSON.stringify({archetype:c.archetype,skills:c.skills,abilities:c.abilities,weakness:c.weakness,concept:c.concept})).digest('hex').slice(0,12);
}
function rollRarity(state='explore') {
  let x=Math.random();
  const boost=['boss','discovery'].includes(state)?0.12:0;
  x=Math.max(0,x-boost);
  if(x<.01)return'mythic'; if(x<.04)return'relic'; if(x<.12)return'epic'; if(x<.30)return'rare'; if(x<.58)return'uncommon'; return'common';
}
function createLoot(profile,state='explore') {
  const c=profile.character||{archetype:'Странник',level:1,skills:{Ловкость:1,Воля:1}};
  const rarity=rollRarity(state), budget=rarityBudget[rarity], level=clamp(Number(c.level)||1,1,50);
  const skills=Object.entries(c.skills||{}).sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]);
  const primary=skills[0]||'Воля';
  const slot = /сил|страж/i.test(c.archetype||'')?'armor':/маг|аркан/i.test(c.archetype||'')?'charm':/лов|следопыт/i.test(c.archetype||'')?'weapon':(['weapon','armor','charm','tool'][Math.floor(Math.random()*4)]);
  const nouns={weapon:['Клинок','Копьё','Резак'],armor:['Панцирь','Кираса','Плащ'],charm:['Печать','Талисман','Осколок'],tool:['Компас','Ключ','Фокус']};
  const item={
    id:id('item'),serial:`KW-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    name:`${nouns[slot][Math.floor(Math.random()*nouns[slot].length)]} ${c.archetype||'Странника'}`,slot,rarity,level,
    power:Math.max(1,Math.floor((level+budget)*1.25)),affixes:[{stat:primary,value:Math.max(1,Math.ceil(budget/2))}],
    passive:`Ситуативная синергия с навыком «${primary}».`, lore:`Уникальный предмет, возникший из пути героя ${profile.name}.`,
    adaptiveFor:{name:profile.name,archetype:c.archetype||'Странник',level,dominantSkills:skills,buildFingerprint:fingerprint(c)},
    visualPrompt:`Square premium dark-fantasy RPG inventory card, single ${slot} item, ${rarity} rarity, designed for ${c.archetype||'adventurer'}, inspired by skills ${skills.join(' and ')||primary}, isolated artifact, cinematic material detail, no text, no UI, no watermark`,visual:null,
    provenance:[{at:now(),type:'found',owner:profile.id}],createdAt:now(),status:'owned',ownerId:profile.id
  };
  return item;
}
function fallbackCharacter(wish='',appearance='') {
  const t=normalize(wish);
  const archetype=/маг|разрез|простран|аркан/.test(t)?'Арканист':/щит|брон|танк|сила/.test(t)?'Страж':/лук|след|ловк|скрыт/.test(t)?'Следопыт':'Авантюрист';
  const skills={Сила:2,Ловкость:2,Интеллект:2,Воля:2,Восприятие:2};
  if(archetype==='Арканист'){skills.Интеллект=4;skills.Воля=3}
  if(archetype==='Страж'){skills.Сила=4;skills.Воля=3}
  if(archetype==='Следопыт'){skills.Ловкость=4;skills.Восприятие=3}
  return {name:'Герой',archetype,level:1,concept:wish||'Искатель приключений',appearance,skills,abilities:['Основной приём','Ситуативная способность'],weakness:'Ограниченный ресурс сильных приёмов'};
}
function classifyMusic(text='') {
  const t=normalize(text);
  if(/босс|гигант|последн/.test(t))return'boss'; if(/смерт|погиб|потер/.test(t))return'grief';
  if(/погон|беж|гонит/.test(t))return'chase'; if(/ритуал|культ|алтар/.test(t))return'ritual';
  if(/ад|лава|плам|печь/.test(t))return'hell'; if(/ужас|страх|бездна/.test(t))return'dread';
  if(/бой|атак|удар|враг/.test(t))return'tension'; if(/наш|откр|понял|тайн/.test(t))return'discovery';
  return'explore';
}
function fallbackGM(room, action, actor) {
  const music=classifyMusic(action);const t=normalize(action);const anchor=room.scene.geometry?.anchors?.find(a=>t.includes(normalize(a.label))||t.includes(normalize(a.id)));
  const narration=`${actor.name} действует: ${action}. Мир отвечает последствием, которое сохраняет текущий канон сцены. Следующий выбор партии уже будет учитывать это действие.`;
  return {narration,music_state:music,intensity:['boss','hell','chase'].includes(music)?.9:['tension','dread'].includes(music)?.65:.35,scene_transition:false,loot:Math.random()<.28,actor_dies:false,move_to:anchor?.id||null};
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
  const id=scenario?.id||'default';
  const maps={
    black_station:{width:38,depth:16,visibilityRadius:19,anchors:[
      {id:'train_door',label:'Двери поезда',x:4,y:8,z:0},{id:'platform_lamp',label:'Мигающий фонарь',x:15,y:5,z:0},
      {id:'station_sign',label:'Табличка ЧЁРНАЯ',x:24,y:7,z:0},{id:'service_door',label:'Служебная дверь',x:34,y:12,z:0}
    ]},
    ash_crown:{width:24,depth:20,visibilityRadius:16,anchors:[
      {id:'tavern_table',label:'Стол с письмом',x:12,y:10,z:0},{id:'hearth',label:'Камин',x:4,y:5,z:0},
      {id:'front_door',label:'Вход в трактир',x:21,y:16,z:0},{id:'stairs',label:'Лестница наверх',x:5,y:17,z:0}
    ]},
    red_orbit:{width:32,depth:18,visibilityRadius:17,anchors:[
      {id:'airlock',label:'Стыковочный шлюз',x:3,y:9,z:0},{id:'main_corridor',label:'Главный коридор',x:13,y:9,z:0},
      {id:'control_door',label:'Дверь центра управления',x:24,y:5,z:0},{id:'service_hatch',label:'Сервисный люк',x:27,y:14,z:0}
    ]}
  };
  return maps[id]||{width:24,depth:18,visibilityRadius:15,anchors:[{id:'center',label:'Центр сцены',x:12,y:9,z:0}]};
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
function getRoom(c){ return rooms.get(String(c||'').toUpperCase()); }
function roomView(r){ return {code:r.code,scenario:r.scenario,hostId:r.hostId,started:r.started,turnIndex:r.turnIndex,scene:r.scene,players:[...r.players.values()].map(x=>({id:x.id,name:x.name,ready:x.ready,character:x.profile.character,alive:x.profile.alive,position:x.position}))}; }

async function api(req,res,u){
  try {
    if(req.method==='GET'&&u.pathname==='/api/health') return json(res,200,{ok:true,version:'0.6.1',llm:providerReady('llm'),stt:providerReady('stt'),tts:providerReady('tts')});
    if(req.method==='GET'&&u.pathname==='/api/scenarios') return json(res,200,scenarios);
    const itemMedia=u.pathname.match(/^\/api\/item-media\/([a-zA-Z0-9_-]+)\.png$/);
    if(req.method==='GET'&&itemMedia){const file=path.join(ITEM_MEDIA_DIR,itemMedia[1]+'.png');if(!fs.existsSync(file)){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'content-type':'image/png','cache-control':'private, max-age=86400'});return fs.createReadStream(file).pipe(res);}
    const itemVisual=u.pathname.match(/^\/api\/items\/([^/]+)\/visual$/);
    if(req.method==='POST'&&itemVisual){const b=await body(req);ensureProfile(b.name);const item=findItemById(itemVisual[1]);if(!item)return json(res,404,{error:'item_not_found'});try{return json(res,200,{visual:await ensureItemVisual(item)})}catch(e){return json(res,e.message==='image_not_configured'?409:422,{error:e.message});}}

    if(req.method==='GET'&&u.pathname==='/api/config') {
      const c=readJson(CONFIG_FILE,{});
      const scrub=o=>Object.fromEntries(Object.entries(o||{}).map(([k,v])=>[k,/key/i.test(k)?(v?'••••••':''):v]));
      return json(res,200,{...c,llm:scrub(c.llm),stt:scrub(c.stt),tts:scrub(c.tts),image:scrub(c.image)});
    }
    if(req.method==='POST'&&u.pathname==='/api/config') {
      const incoming=await body(req), current=readJson(CONFIG_FILE,{});
      for(const section of ['llm','stt','tts','image']) if(incoming[section]) current[section]={...(current[section]||{}),...incoming[section],api_key:incoming[section].api_key?.includes('•')?current[section]?.api_key:incoming[section].api_key};
      if(Number(incoming.port)) current.port=Number(incoming.port);
      writeJson(CONFIG_FILE,current); return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&u.pathname==='/api/rooms') {
      const b=await body(req), scenario=scenarios.find(s=>s.id===b.scenarioId)||scenarios[0], profile=ensureProfile(b.name);
      const room={code:code(),scenario,hostId:profile.id,started:false,turnIndex:0,players:new Map(),scene:createScene(scenario,scenario?.opening||''),log:[]};room.scene.music_state='lobby';
      room.players.set(profile.id,{id:profile.id,name:profile.name,ready:false,profile,position:spawnPosition(room.scene,0)}); rooms.set(room.code,room); return json(res,201,{room:roomView(room),profile:publicProfile(profile)});
    }
    const join=u.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if(req.method==='POST'&&join){const r=getRoom(join[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name);r.players.set(p.id,{id:p.id,name:p.name,ready:false,profile:p,position:spawnPosition(r.scene,r.players.size)});return json(res,200,{room:roomView(r),profile:publicProfile(p)});}
    const roomGet=u.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if(req.method==='GET'&&roomGet){const r=getRoom(roomGet[1]);return r?json(res,200,roomView(r)):json(res,404,{error:'room_not_found'});}
    const povGet=u.pathname.match(/^\/api\/rooms\/([^/]+)\/pov$/);
    if(req.method==='GET'&&povGet){const r=getRoom(povGet[1]);if(!r)return json(res,404,{error:'room_not_found'});const p=ensureProfile(u.searchParams.get('name')),view=personalPOV(r,p.id);return view?json(res,200,view):json(res,404,{error:'player_not_in_room'});}

    const char=u.pathname.match(/^\/api\/rooms\/([^/]+)\/character$/);
    if(req.method==='POST'&&char){const r=getRoom(char[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name);let generated=null;try{generated=await generateCharacterAI(b.wish,b.appearance)}catch(e){console.warn('character AI fallback:',e.message)}p.character=generated||fallbackCharacter(b.wish,b.appearance);p.alive=true;saveState();const rp=r.players.get(p.id);if(rp)rp.ready=true;return json(res,200,{character:p.character,profile:publicProfile(p),room:roomView(r),ai:Boolean(generated)});}
    const start=u.pathname.match(/^\/api\/rooms\/([^/]+)\/start$/);
    if(req.method==='POST'&&start){const r=getRoom(start[1]);if(!r)return json(res,404,{error:'room_not_found'});r.started=true;r.scene.music_state='explore';return json(res,200,roomView(r));}
    const turn=u.pathname.match(/^\/api\/rooms\/([^/]+)\/turn$/);
    if(req.method==='POST'&&turn){const r=getRoom(turn[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name);if(!p.alive)return json(res,409,{error:'character_dead'});const action=String(b.action||'осматривается').slice(0,1200);let result=null;try{result=await resolveGMAI(r,action,p)}catch(e){console.warn('GM AI fallback:',e.message)}result=result||fallbackGM(r,action,p);const committed=commitTurn(r,p,action,result);return json(res,200,{...result,...committed,room:roomView(r),profile:publicProfile(p),ai:Boolean(result&&providerReady('llm'))});}
    
    const voiceTurn=u.pathname.match(/^\/api\/rooms\/([^/]+)\/voice-turn$/);
    if(req.method==='POST'&&voice){
      const r=getRoom(voiceTurn[1]);if(!r)return json(res,404,{error:'room_not_found'});
      const b=await body(req),p=ensureProfile(b.name);if(!p.alive)return json(res,409,{error:'character_dead'});
      const action=await transcribeAudio(b.audioBase64,b.mimeType||'audio/webm');if(!action)return json(res,422,{error:'empty_transcript'});
      let result=null;try{result=await resolveGMAI(r,action,p)}catch(e){console.warn('GM AI fallback:',e.message)}result=result||fallbackGM(r,action,p);
      const committed=commitTurn(r,p,action,result);let speechBase64=null;try{speechBase64=await synthesizeSpeech(result.narration)}catch(e){console.warn('TTS fallback:',e.message)}
      return json(res,200,{transcript:action,...result,...committed,room:roomView(r),profile:publicProfile(p),speechBase64,speechMime:'audio/mpeg'});
    }
        const claimLoot=u.pathname.match(/^\/api\/rooms\/([^/]+)\/loot\/([^/]+)\/claim$/);
    if(req.method==='POST'&&claim){
      const r=getRoom(claim[1]);if(!r)return json(res,404,{error:'room_not_found'});
      const b=await body(req),p=ensureProfile(b.name);if(!p.alive)return json(res,409,{error:'character_dead'});
      const idx=(r.scene.loot||[]).findIndex(x=>x.id===claim[2]&&x.status==='scene');if(idx<0)return json(res,404,{error:'loot_not_found'});
      const [item]=r.scene.loot.splice(idx,1);item.status='owned';item.ownerId=p.id;item.provenance.push({at:now(),type:'claimed',owner:p.id,sceneId:r.scene.id});p.inventory.push(item);saveState();
      return json(res,200,{item,room:roomView(r),profile:publicProfile(p)});
    }
        if(req.method==='POST'&&u.pathname==='/api/profile/equip'){
      const b=await body(req),p=ensureProfile(b.name);if(!p.alive)return json(res,409,{error:'character_dead'});
      const item=p.inventory.find(x=>x.id===b.itemId);if(!item)return json(res,404,{error:'item_not_found'});
      if(!['weapon','armor','charm','tool'].includes(item.slot))return json(res,409,{error:'invalid_slot'});
      p.equipped[item.slot]=item.id;saveState();return json(res,200,publicProfile(p));
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/unequip'){
      const b=await body(req),p=ensureProfile(b.name),slot=String(b.slot||'');
      if(!['weapon','armor','charm','tool'].includes(slot))return json(res,409,{error:'invalid_slot'});
      p.equipped[slot]=null;saveState();return json(res,200,publicProfile(p));
    }
    if(req.method==='GET'&&u.pathname==='/api/profile'){const p=ensureProfile(u.searchParams.get('name'));return json(res,200,publicProfile(p));}
    if(req.method==='GET'&&u.pathname==='/api/market') return json(res,200,persisted.market.filter(x=>x.status==='active'));
    if(req.method==='POST'&&u.pathname==='/api/market/list'){const b=await body(req),p=ensureProfile(b.name),idx=p.inventory.findIndex(x=>x.id===b.itemId);if(idx<0)return json(res,404,{error:'item_not_found'});const item=p.inventory[idx];if(Object.values(p.equipped||{}).includes(item.id))p.equipped[item.slot]=null;p.inventory.splice(idx,1);item.status='escrow';const listing={id:id('listing'),item,sellerId:p.id,sellerName:p.name,price:clamp(Number(b.price)||1,1,1_000_000),status:'active',createdAt:now()};persisted.market.push(listing);persisted.transactions.unshift({id:id('tx'),at:now(),profileId:p.id,type:'market_list',amount:0,itemId:item.id,price:listing.price});saveState();return json(res,201,listing);}
    if(req.method==='POST'&&u.pathname==='/api/market/buy'){const b=await body(req),buyer=ensureProfile(b.name),l=persisted.market.find(x=>x.id===b.listingId&&x.status==='active');if(!l)return json(res,404,{error:'listing_not_found'});if(l.sellerId===buyer.id)return json(res,409,{error:'own_listing'});if(buyer.balance<l.price)return json(res,409,{error:'insufficient_balance'});const seller=Object.values(persisted.profiles).find(x=>x.id===l.sellerId),net=Math.floor(l.price*.975),fee=l.price-net;buyer.balance-=l.price;if(seller)seller.balance+=net;l.status='sold';l.item.status='owned';l.item.ownerId=buyer.id;l.item.provenance.push({at:now(),type:'trade',from:l.sellerId,to:buyer.id,price:l.price});buyer.inventory.push(l.item);persisted.transactions.unshift({id:id('tx'),at:now(),profileId:buyer.id,type:'market_buy',amount:-l.price,itemId:l.item.id,counterparty:l.sellerId},{id:id('tx'),at:now(),profileId:l.sellerId,type:'market_sale',amount:net,itemId:l.item.id,counterparty:buyer.id,fee});saveState();return json(res,200,{listing:l,profile:publicProfile(buyer)});}
    if(req.method==='POST'&&u.pathname==='/api/market/cancel'){const b=await body(req),p=ensureProfile(b.name),l=persisted.market.find(x=>x.id===b.listingId&&x.status==='active'&&x.sellerId===p.id);if(!l)return json(res,404,{error:'listing_not_found'});l.status='cancelled';l.item.status='owned';p.inventory.push(l.item);persisted.transactions.unshift({id:id('tx'),at:now(),profileId:p.id,type:'market_cancel',amount:0,itemId:l.item.id});saveState();return json(res,200,{profile:publicProfile(p)});}
    return json(res,404,{error:'not_found'});
  } catch(e){ console.error(e); return json(res,500,{error:'server_error',message:e.message}); }
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
