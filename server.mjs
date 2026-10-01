import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadState, atomicWrite } from './server/persistence.mjs';
import { validateProviderUrl, providerFetch } from './server/provider-security.mjs';
import { startTurns, currentPlayer, assertTurn, advanceTurn } from './server/turns.mjs';
import { itemModifier } from './core/item-modifiers.mjs';
import { GM_VOICE_PROFILES, PLAYER_VOICE_PROFILES, assignNpcVoiceProfile, profileForSpeaker, speechInstructions, publicVoiceCatalog, makeVoiceEvent, voiceProfile } from './core/voice.mjs';
import { resolveAttack, resolveCheck, conditionLabel, effectiveArmor } from './core/combat.mjs';
import { materializeCharacterCore, createNpcCombatant, balanceAbilityFantasy, recordSkillUse, evolveAbilityDefinition, spendAbilityResource, refillCharacterResources, upgradeResourcePool, refreshResourceCaps, maxAbilitySlots, maxDynamicSkillRank } from './core/character.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_FILE = process.env.KISAI_CONFIG_FILE||path.join(DATA, 'config.json');
const CONFIG_EXAMPLE = path.join(DATA, 'config.example.json');
const SCENARIOS_FILE = path.join(DATA, 'scenarios.json');
const CRAFTING_FILE = path.join(DATA, 'crafting.json');
const STATE_FILE = process.env.KISAI_STATE_FILE||path.join(DATA, 'state.json');
const ITEM_MEDIA_DIR = path.join(DATA, 'runtime', 'item-cards');

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(ITEM_MEDIA_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_EXAMPLE, CONFIG_FILE);
try { fs.chmodSync(CONFIG_FILE,0o600); } catch {}

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = atomicWrite;
const config = readJson(CONFIG_FILE, { port: 8787 });
const scenarios = readJson(SCENARIOS_FILE, []);
const crafting = readJson(CRAFTING_FILE, {materials:{},recipes:[]});
const persisted = loadState(STATE_FILE, { profiles: {}, market: [], transactions: [], sessions: {}, rooms: {} });
persisted.sessions ||= {}; persisted.rooms ||= {};persisted.farmBuckets ||= {};

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
const subscribers=new Map();
const busyRooms=new Set();
function publishRoom(room,type='ROOM_UPDATED') {
  for(const client of subscribers.get(room.code)||[])try{client.res.write(`data: ${JSON.stringify({type,room:roomView(room,client.profileId)})}\n\n`)}catch{}
}
const json = (res,status,body) => {
  const req=res.req, match=req?.url?.match(/^\/api\/rooms\/([^/?]+)/);
  res.errorCode=body?.error||null;
  const room=match&&getRoom(match[1]);
  if(status>=200&&status<300&&req?.method==='POST'){
    if(room){room.revision=(room.revision||0)+1;if(body?.room)body.room.revision=room.revision;else if(body?.code===room.code)body.revision=room.revision;}
    if(room&&req.actionId){room.actionIds ||= [];room.actionIds.push(req.actionId);room.actionIds=room.actionIds.slice(-300);}
    saveState();
  }
  const data=JSON.stringify(body); res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-request-id':req?.requestId||''}); res.end(data);
  if(room&&status>=200&&status<300&&req?.method==='POST'){publishRoom(room);if(body?.voiceEvents)for(const client of subscribers.get(room.code)||[])try{client.res.write(`data: ${JSON.stringify({type:'VOICE_EVENT',revision:room.revision,actorId:room.log[0]?.profileId,voiceEvents:body.voiceEvents,voiceAudio:body.voiceAudio||[]})}\n\n`)}catch{}}
};
const body = req => new Promise((resolve,reject)=>{ let raw=''; req.on('data',c=>{raw+=c;if(raw.length>15_000_000){reject(new Error('body too large'));req.destroy();}}); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}}); req.on('error',reject); });
const saveState = () => {
  persisted.rooms = Object.fromEntries([...rooms].map(([key,room])=>[key,{...room,players:[...room.players].map(([pid,pl])=>[pid,{...pl,profile:undefined}])}]));
  writeJson(STATE_FILE, persisted);
};
for (const [key,data] of Object.entries(persisted.rooms)) {
  const room={...data,players:new Map(data.players.map(([pid,pl])=>{
    const profile=Object.values(persisted.profiles).find(p=>p.id===pid);
    if (!profile) throw new Error(`state_corrupt: room ${key} references missing profile ${pid}`);
    migrateProfile(profile);
    return [pid,{...pl,profile,character:profile.characters.find(c=>c.id===pl.characterId)||null}];
  }))};
  rooms.set(key,room);
}
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
  const r=await providerFetch(url,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+c.api_key},body:JSON.stringify({model:c.model,messages,temperature})});
  if(!r.ok) throw new Error('llm_'+r.status);
  const d=await r.json();
  return d.choices?.[0]?.message?.content||null;
}
async function generateCharacterAI(wish,appearance){
  if(!providerReady('llm')) return null;
  const prompt='Return ONLY compact JSON for a level-1 classless RPG character. Preserve fantasy; never set combat numbers. Schema: {"archetype":string,"concept":string,"attributes":{"strength":-3..4,"agility":-3..4,"endurance":-3..4,"perception":-3..4,"intelligence":-3..4,"charisma":-3..4},"dynamicSkills":[{"name":string,"rank":0..3,"attribute":"strength|agility|endurance|perception|intelligence|charisma"}],"abilities":[string,string],"weakness":string}. Ability names are fantasy only; server balances their mechanics.';
  const text=await openAIChat([{role:'system',content:prompt},{role:'user',content:'Concept: '+wish+'\\nAppearance: '+appearance}],.5);
  const x=safeJsonText(text); if(!x||typeof x!=='object') return null;
  const base=fallbackCharacter(wish,appearance),attributes={...base.attributes};
  for(const k of Object.keys(attributes))attributes[k]=clamp(Number(x.attributes?.[k]??attributes[k]),-3,4);
  let total=Object.values(attributes).reduce((a,b)=>a+b,0);while(total>9){const k=Object.keys(attributes).sort((a,b)=>attributes[b]-attributes[a])[0];if(attributes[k]<=0)break;attributes[k]--;total--}
  const dynamicSkills=Array.isArray(x.dynamicSkills)?x.dynamicSkills.slice(0,5).map(v=>({name:String(v.name||'Навык').slice(0,40),rank:clamp(Math.floor(Number(v.rank)||1),0,maxDynamicSkillRank(1)),attribute:['strength','agility','endurance','perception','intelligence','charisma'].includes(v.attribute)?v.attribute:'perception'})):base.dynamicSkills;
  return materializeCharacterCore({...base,archetype:String(x.archetype||base.archetype).slice(0,48),concept:String(x.concept||wish||base.concept).slice(0,400),attributes,dynamicSkills,abilities:Array.isArray(x.abilities)?x.abilities.slice(0,maxAbilitySlots(1)).map(v=>String(v).slice(0,180)):base.abilities,weakness:String(x.weakness||base.weakness).slice(0,180)});
}
async function resolveGMAI(room,action,actor){
  const player=room.players.get(actor.id),fallback=fallbackGM(room,action,actor);
  if(!providerReady('llm'))return fallback;
  const recent=room.log.slice(0,8).reverse().map(x=>x.actor+': '+x.action+' -> '+x.narration).join('\n');
  const system='You are Intent Interpreter, not Rules Engine. Return ONLY JSON: {"check_required":boolean,"check_attribute":"strength|agility|endurance|perception|intelligence|charisma","check_skill":string|null,"difficulty_shift":-1|0|1,"danger":"safe|risky|lethal","success_narration":string,"failure_narration":string,"no_check_narration":string,"npc_dialogue":[{"speaker_id":string,"text":string,"emotion":string}],"music_state":"explore|tavern|investigation|discovery|tension|chase|ritual|abyss|dread|hell|boss|grief","move_to":string|null,"loot":boolean}. GM narration describes scene/actions/consequences only. NEVER put spoken NPC dialogue or quotes inside GM narration. NPC speech belongs only in npc_dialogue. Never invent dice, DC, damage, armor, HP or final mechanical outcome. speaker_id must be an existing scene combatant id. move_to may only be an existing anchor id. Do not adapt difficulty to party size.';
  const user='FIXED EVENT TIER '+(room.scenario?.danger_tier||1)+'; recommended party '+(room.scenario?.recommended_players||1)+'; progress '+(room.progress||0)+'/100.\nEvent: '+room.scenario?.title+'\nGeometry: '+JSON.stringify(room.scene.geometry)+'\nPlayer: '+JSON.stringify({character:actor.character,wounds:player?.wounds||0,runInventory:(player?.runInventory||[]).map(x=>x.name)})+'\nRecent:\n'+recent+'\nAction: '+action;
  try{
    const x=safeJsonText(await openAIChat([{role:'system',content:system},{role:'user',content:user}],.55));if(!x)return fallback;
    const attributes=['strength','agility','endurance','perception','intelligence','charisma'],music=['explore','tavern','investigation','discovery','tension','chase','ritual','abyss','dread','hell','boss','grief'];
    return{check_required:Boolean(x.check_required),check_attribute:attributes.includes(x.check_attribute)?x.check_attribute:fallback.check_attribute,check_skill:typeof x.check_skill==='string'?x.check_skill.slice(0,40):fallback.check_skill,difficulty_shift:clamp(Number(x.difficulty_shift)||0,-1,1),
      danger:['safe','risky','lethal'].includes(x.danger)?x.danger:'safe',npc_dialogue:Array.isArray(x.npc_dialogue)?x.npc_dialogue.slice(0,3).map(v=>({speaker_id:String(v.speaker_id||'').slice(0,80),text:String(v.text||'').slice(0,260),emotion:String(v.emotion||'neutral').slice(0,32)})).filter(v=>v.text):fallback.npc_dialogue,success_narration:String(x.success_narration||fallback.success_narration).slice(0,650),
      failure_narration:String(x.failure_narration||fallback.failure_narration).slice(0,650),no_check_narration:String(x.no_check_narration||fallback.no_check_narration).slice(0,650),
      music_state:music.includes(x.music_state)?x.music_state:fallback.music_state,move_to:typeof x.move_to==='string'?x.move_to:null,loot:Boolean(x.loot)};
  }catch(e){console.warn('GM planner fallback:',e.message);return fallback}
}
async function transcribeAudio(audioBase64,mimeType='audio/webm'){
  const c=runtimeConfig().stt||{}; if(!c.api_key||!c.base_url||!c.model) throw new Error('stt_not_configured');
  const bytes=Buffer.from(String(audioBase64||''),'base64'); if(!bytes.length||bytes.length>10_000_000) throw new Error('invalid_audio');
  const form=new FormData(); form.set('model',c.model); form.set('file',new Blob([bytes],{type:mimeType}),'turn.webm');
  const r=await providerFetch(String(c.base_url).replace(/\/$/,'')+'/audio/transcriptions',{method:'POST',headers:{authorization:'Bearer '+c.api_key},body:form});
  if(!r.ok) throw new Error('stt_'+r.status); const d=await r.json(); return String(d.text||'').trim();
}
async function synthesizeSpeech(text,profile=null,event={}){
  const c=runtimeConfig().tts||{}; if(!c.api_key||!c.model||!text) return null;
  const provider=(c.provider||'openai'),providerVoice=profile?.providerVoice?.[provider]||c.voice;
  if(provider==='openai'){
    if(!c.base_url)return null;
    const payload={model:c.model,voice:providerVoice||'alloy',input:text,format:'mp3'};
    const instructions=speechInstructions(profile,event);if(instructions)payload.instructions=instructions;
    const r=await providerFetch(String(c.base_url).replace(/\/$/,'')+'/audio/speech',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.api_key},body:JSON.stringify(payload)});
    if(!r.ok)return null; return Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  if(provider==='elevenlabs'&&c.base_url&&providerVoice){
    const style=profile?.style||{},r=await providerFetch(String(c.base_url).replace(/\/$/,'')+'/v1/text-to-speech/'+encodeURIComponent(providerVoice),{method:'POST',headers:{'content-type':'application/json','xi-api-key':c.api_key},body:JSON.stringify({text,model_id:c.model,voice_settings:{stability:clamp(0.72-(style.roughness||0)*.25,.2,.9),similarity_boost:.78,style:clamp(Math.abs(style.pitch||0)*.05+(event.emotion&&event.emotion!=='neutral'?.18:.06),0,.5)}})});
    if(!r.ok)return null; return Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  return null;
}
async function synthesizeVoiceQueue(events,room){
  return Promise.all((events||[]).map(async event=>{
    if(event.speakerType==='SYSTEM'||!event.text)return{...event,audioBase64:null};
    const speaker=event.speakerType==='NPC'?(room.scene.combatants||[]).find(x=>x.id===event.speakerId):event.speakerType==='PLAYER'?[...room.players.values()].map(x=>x.character).find(x=>x?.id===event.speakerId):null;
    const profile=profileForSpeaker({speakerType:event.speakerType,speaker,room});let audioBase64=null;
    try{audioBase64=await synthesizeSpeech(event.text,profile,event)}catch(e){console.warn('TTS event fallback:',e.message)}
    return{...event,voiceProfileId:profile?.id||null,audioBase64,audioMime:'audio/mpeg'};
  }));
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
function isAttackAction(action=''){
  return /атак|бью|удар|реж|разрез|руб|колю|стрел|выстрел|кастаю.*(огн|молни|луч)|пинаю|кулаком/i.test(action);
}
function attackArea(action=''){
  const t=normalize(action);if(/глаз/.test(t))return'eye';if(/ше[юи]|горло/.test(t))return'neck';if(/голов|лиц/.test(t))return'head';if(/рук|кист/.test(t))return'arm';if(/ног|колен/.test(t))return'leg';if(/повреж|трещ|дыр|пробит|разрез.*брон/.test(t))return'breach';return'torso';
}
function selectAttackAbility(character,action=''){
  materializeCharacterCore(character);const t=normalize(action),abilities=character.abilities||[];
  const named=abilities.find(a=>t.includes(normalize(a.name||a.fantasy||'')));if(named)return named;
  if(/разрез/.test(t))return abilities.find(a=>/разрез/i.test(a.name||''))||balanceAbilityFantasy('Разрез пространства',character.level);
  if(/стрел|выстрел/.test(t))return abilities.find(a=>/стрел/i.test(a.name||''))||balanceAbilityFantasy('Точный выстрел',character.level);
  if(/кулак|пинаю|удар/.test(t))return balanceAbilityFantasy('Удар',character.level);
  return abilities[0]||balanceAbilityFantasy('Основной приём',character.level);
}
function tickCooldowns(player){for(const key of Object.keys(player.cooldowns||{})){player.cooldowns[key]--;if(player.cooldowns[key]<=0)delete player.cooldowns[key]}}
function equippedRunWeapon(profile,player){
  const equippedId=profile.equipped?.weapon;
  return (player.runInventory||[]).find(x=>x.id===equippedId)||(player.runInventory||[]).find(x=>x.kind==='equipment'&&x.slot==='weapon')||null;
}
function equippedRunArmor(profile,player){
  const equippedId=profile.equipped?.armor;
  return (player.runInventory||[]).find(x=>x.id===equippedId)||(player.runInventory||[]).find(x=>x.kind==='equipment'&&x.slot==='armor')||null;
}
function playerCombatDefender(profile,player){
  const c=materializeCharacterCore(player.character),armor=equippedRunArmor(profile,player);
  return{...c,combat:c.combat,injuries:c.injuries,equipment:{...(c.equipment||{}),chest:armor||null}};
}
function counterNarrative(target,counter){
  if(!counter)return'';
  if(!counter.hit)return target.name+' пытается ответить, но не попадает.';
  const hp=counter.damage?.hp||0,arm=counter.armor?.before||0;
  if(hp===0)return target.name+' отвечает ударом, но защита героя полностью поглощает урон.';
  return target.name+' отвечает: '+(counter.damage?.raw||0)+' урона − броня '+arm+' = '+hp+' HP.';
}
function combatNarrativeFallback(actor,target,result){
  if(!result.hit)return (actor.character?.name||actor.name)+' атакует, но '+target.name+' уходит от удара.';
  const armor=result.armor?.before||0,hp=result.damage?.hp||0;
  if(result.killed)return 'Атака достигает цели: '+target.name+' получает '+hp+' урона после брони '+armor+' и больше не способен продолжать бой.';
  if(hp===0)return 'Удар попадает в '+target.name+', но броня ('+armor+') полностью принимает '+(result.damage?.raw||0)+' урона. Защита получает износ.';
  return 'Попадание. '+target.name+' получает '+hp+' HP-урона после брони '+armor+'.'+(result.injury?' Возникает травма области «'+result.targetArea+'».':'');
}
async function narrateCombatOutcome(room,actor,action,target,result){
  const fallback=combatNarrativeFallback(actor,target,result);if(!providerReady('llm'))return fallback;
  const system='You are Narrative Engine. Mechanics are already final. Describe only the supplied facts in vivid Russian in 1-3 sentences. Never change hit/miss, HP damage, armor, injury, death, item state or numbers. A declared goal such as decapitation is not guaranteed unless mechanics say killed and the result plausibly supports it.';
  const facts={action,attacker:actor.character?.name||actor.name,target:target.name,result};
  try{const text=await openAIChat([{role:'system',content:system},{role:'user',content:JSON.stringify(facts)}],.45);return String(text||fallback).slice(0,700)}catch{return fallback}
}
function socialAction(action=''){return /говор|спраш|скажи|отвеч|убеж|угрож|крич|шеп|зову|кто ты|что тебе|зачем|поговор/i.test(String(action))}
function fallbackNpcDialogue(room,action){
  const npc=(room.scene.combatants||[]).find(x=>x.status!=='dead');if(!npc||!socialAction(action))return[];
  const t=normalize(action),panic=(npc.morale||100)<35;
  let text=panic?'Хватит. Я ухожу.':/угрож|отреж|убью|сломаю/.test(t)?'Попробуй. Только сделай ещё шаг.':/кто ты|имя/.test(t)?'Тебе это знать не нужно.':'Говори. Я слушаю.';
  return[{speaker_id:npc.id,text,emotion:panic?'fear':'guarded'}];
}
function npcCombatBark(target,combat,counterattack){
  if(!target||target.status==='dead'||combat?.killed)return null;
  if((combat?.armor?.wear?.wear||0)>=6)return{text:'Он режет броню! Назад!',emotion:'panic'};
  if((combat?.damage?.hp||0)>=5)return{text:'Чёрт... держи дистанцию!',emotion:'pain'};
  if(counterattack?.hit)return{text:'Попался.',emotion:'aggressive'};
  return null;
}
function mechanicsVoiceEvent(committed){
  if(committed?.combat)return makeVoiceEvent({speakerType:'SYSTEM',speakerId:'SYSTEM',type:'mechanics',mechanics:{combat:committed.combat,counterattack:committed.counterattack||null,resourceSpend:committed.resourceSpend||null}});
  if(committed?.dice)return makeVoiceEvent({speakerType:'SYSTEM',speakerId:'SYSTEM',type:'mechanics',mechanics:{dice:committed.dice,woundsAdded:committed.woundsAdded||0}});
  return null;
}
function buildVoiceEvents(room,actor,action,committed,proposal={}){
  const events=[];
  const character=room.players.get(actor.id)?.character;
  const exactSpeech=String(action).match(/[«"]([^»"]{1,300})[»"]/)?.[1]||'';
  const playerSpeech=character?.voiceMode==='manual'?exactSpeech:socialAction(action)?action.slice(0,300):'';
  if(character&&playerSpeech)events.push(makeVoiceEvent({speakerType:'PLAYER',speakerId:character.id,type:'dialogue',text:playerSpeech,emotion:character.voiceMode==='character'?'character':'neutral'}));
  if(committed?.narration)events.push(makeVoiceEvent({speakerType:'GM',speakerId:'GM',type:'narration',text:committed.narration}));
  const system=mechanicsVoiceEvent(committed);if(system)events.push(system);
  const target=(room.scene.combatants||[]).find(x=>x.id===committed?.combat?.targetId)||(room.scene.combatants||[]).find(x=>x.status!=='dead');
  const bark=committed?.combat?npcCombatBark(target,committed.combat,committed.counterattack):null;
  if(bark&&target)events.push(makeVoiceEvent({speakerType:'NPC',speakerId:target.id,type:'dialogue',text:bark.text,emotion:bark.emotion}));
  else for(const line of proposal?.npc_dialogue||fallbackNpcDialogue(room,action)) {
    const npc=(room.scene.combatants||[]).find(x=>x.id===line.speaker_id)||target;if(npc)events.push(makeVoiceEvent({speakerType:'NPC',speakerId:npc.id,type:'dialogue',text:line.text,emotion:line.emotion||npc.currentEmotion||'neutral'}));
  }
  if(!room.completed&&room.timer)events.push(makeVoiceEvent({speakerType:'TIMER',speakerId:'GM',type:'timer',text:'Ход игрока '+(room.players.get(room.timer.playerId)?.name||''),seconds:Math.max(0,Math.ceil((room.timer.deadlineAt-Date.now())/1000))}));
  return events.filter(x=>x.speakerType==='SYSTEM'||x.text);
}

async function commitCombatTurn(r,p,action,{targetId=null,abilityId=null,targetArea=null,aimed=null}={}){
  const player=r.players.get(p.id);if(!player)throw new Error('player_not_in_room');const character=materializeCharacterCore(player.character);
  const target=(r.scene.combatants||[]).find(x=>x.id===targetId&&x.status!=='dead')||(r.scene.combatants||[]).find(x=>x.status!=='dead');if(!target)throw new Error('no_hostile_target');
  const ability=(character.abilities||[]).find(x=>x.id===abilityId)||selectAttackAbility(character,action),area=targetArea||attackArea(action),isAimed=aimed??area!=='torso';
  if((player.cooldowns?.[ability.id]||0)>0)throw new Error('ability_on_cooldown');
  const pos=player.position||spawnPosition(r.scene),targetPos=target.position||r.scene.geometry.anchors.at(-1);
  if(Math.hypot(pos.x-targetPos.x,pos.y-targetPos.y)>Math.min(30,Math.max(1,Number(ability.range)||2)))throw new Error('target_out_of_range');
  const resourceSpend=spendAbilityResource(character,ability);
  const weapon=equippedRunWeapon(p,player),relicBonus=(player.runInventory||[]).filter(x=>['charm','tool'].includes(x.slot)&&(!p.equipped?.[x.slot]||p.equipped[x.slot]===x.id)).reduce((n,x)=>n+itemModifier(x,'accuracy_bonus'),0);
  const combatAbility={...ability,accuracy:(Number(ability.accuracy)||0)+Math.min(10,relicBonus)};
  const combat=resolveAttack({attacker:character,defender:target,ability:combatAbility,targetArea:area,aimed:isAimed,attackDie:nextD20(),damageRng:max=>crypto.randomInt(1,max+1),weapon});
  if((Number(ability.targets)||1)>1){
    combat.additionalTargets=[];
    const range=Math.min(30,Math.max(1,Number(ability.range)||2));
    for(const other of (r.scene.combatants||[]).filter(x=>x!==target&&x.status!=='dead'&&!x.hidden).slice(0,Math.min(4,ability.targets-1))){
      const otherPos=other.position||targetPos;
      if(Math.hypot(pos.x-otherPos.x,pos.y-otherPos.y)>range)continue;
      const resolved=resolveAttack({attacker:character,defender:other,ability:combatAbility,targetArea:'torso',aimed:false,attackDie:nextD20(),damageRng:max=>crypto.randomInt(1,max+1),weapon});
      combat.additionalTargets.push({targetId:other.id,...resolved});
      if(resolved.hit&&ability.control&&['stun','slow'].includes(ability.control.type))other.conditions={...(other.conditions||{}),[ability.control.type]:Math.min(2,ability.control.value||1)};
    }
  }
  const skillGrowth=ability.skill?recordSkillUse(character,{name:ability.skill,attribute:ability.attackAttribute||'agility',success:combat.hit}):null;
  let narration=combatNarrativeFallback(p,target,combat),counterattack=null,deathDrop=[];
  if(combat.hit&&ability.control){target.conditions||={};const type=ability.control.type;if(['stun','slow'].includes(type))target.conditions[type]=Math.max(target.conditions[type]||0,Math.min(2,ability.control.value||1));}
  if(!combat.killed&&target.status!=='dead'&&!(target.conditions?.stun>0)){
    const enemyAbility=target.abilities?.[0]||balanceAbilityFantasy('Удар',target.level||1),defender=playerCombatDefender(p,player);
    counterattack=resolveAttack({attacker:target,defender,ability:{...enemyAbility,accuracy:(enemyAbility.accuracy||0)-(target.conditions?.slow>0?2:0)},targetArea:'torso',aimed:false,attackDie:nextD20(),damageRng:max=>crypto.randomInt(1,max+1)});
    narration+=' '+counterNarrative(target,counterattack);
    if(defender.combat?.hp_current<=0){
      deathDrop=dropCharacterInventory(r,p);narration+=' Персонаж больше не способен продолжать бой; его походное снаряжение остаётся в сцене.';
    }
  }
  for(const key of ['stun','slow'])if(target.conditions?.[key]>0)target.conditions[key]--;
  tickCooldowns(player);if(ability.cooldown>0)player.cooldowns={...(player.cooldowns||{}),[ability.id]:Math.min(5,Math.ceil(ability.cooldown))};
  const gain=combat.killed?24+(r.scenario.danger_tier||1)*4:combat.hit?8:2;r.progress=clamp((r.progress||0)+gain,0,100);
  if(combat.killed){const objective=r.objectives?.find(x=>x.type==='defeat_threat');if(objective)objective.state='complete';}
  r.scene.narration=narration;r.scene.music_state=deathDrop.length?'grief':combat.killed?'discovery':'tension';r.scene.intensity=deathDrop.length?.95:combat.killed?.45:.82;
  r.log.unshift({at:now(),profileId:p.id,actor:p.name,characterId:player.characterId,action,narration,combat,counterattack});
  if(combat.hit)farm(p,action,r.scene.music_state);
  const alive=[...r.players.values()].filter(x=>x.alive);advanceTurn(r);r.turnIndex=(r.turnIndex||0)+1;
  if(!alive.length){r.completed=true;r.outcome='wipe';for(const item of r.scene.loot){item.status='lost'}r.scene.loot=[]}
  saveState(); // Mechanics and inventory are durable before any provider call.
  const spoken=await narrateCombatOutcome(r,p,action,target,combat);
  if(spoken!==combatNarrativeFallback(p,target,combat)){
    r.scene.narration=spoken+(counterattack?' '+counterNarrative(target,counterattack):'')+(deathDrop.length?' Персонаж больше не способен продолжать бой; его походное снаряжение остаётся в сцене.':'');
    r.log[0].narration=r.scene.narration;saveState();
  }
  return{narration:r.scene.narration,music_state:r.scene.music_state,intensity:r.scene.intensity,combat,counterattack,resourceSpend,skillGrowth,deathDrop,progress:r.progress};
}

function commitTurn(r,p,action,result){
  const player=r.players.get(p.id);if(!player)throw new Error('player_not_in_room');
  tickCooldowns(player);
  const roll=rollCheck(r.scenario,player.character,action,result,player);const skillGrowth=roll?.skill?recordSkillUse(player.character,{name:roll.skill,attribute:roll.attribute||result.check_attribute||'perception',success:roll.success}):null;let woundsAdded=0,deathDrop=[];
  if(roll&&!roll.success){
    if(result.danger==='lethal')woundsAdded=roll.criticalFail?2:1;
    else if(result.danger==='risky'&&(r.scenario.danger_tier||1)>=3&&roll.criticalFail)woundsAdded=1;
    player.wounds=clamp((player.wounds||0)+woundsAdded,0,3);
  }
  if(player.wounds>=3)deathDrop=dropCharacterInventory(r,p);else if(movePlayerToAnchor(r,p.id,result.move_to)){
    const objective=r.objectives?.find(x=>x.type==='reach_anchor');if(objective&&result.move_to===objective.anchorId)objective.state='complete';
  }
  const narration=roll?(roll.success?result.success_narration:result.failure_narration):result.no_check_narration;
  r.progress=clamp((r.progress||0)+(roll?(roll.success?14+(r.scenario.danger_tier||1)*2:3):6),0,100);
  const drops=[];
  if(player.alive&&roll?.success&&result.danger!=='safe'&&Math.random()<.18+(r.scenario.danger_tier||1)*.06){
    const material=randomMaterial(r.scenario);if(material){tryAddRunItem(r,player,material);drops.push(material)}
  }
  if(player.alive&&roll?.success&&result.danger!=='safe'&&Math.random()<.06+(r.scenario.danger_tier||1)*.035){
    const item=createLoot(p,result.music_state,r.scenario,behaviorTags(r,p.id),player.character);tryAddRunItem(r,player,item);drops.push(item)
  }
  r.scene.narration=narration+(deathDrop.length?' Персонаж погибает, а всё взятое в поход остаётся в этой сцене.':'');
  r.scene.music_state=deathDrop.length?'grief':result.music_state||'explore';r.scene.intensity=result.danger==='lethal'?0.9:result.danger==='risky'?0.65:0.35;
  r.log.unshift({at:now(),profileId:p.id,actor:p.name,characterId:player.characterId,action,narration:r.scene.narration,roll});
  if(roll?.success&&result.danger!=='safe')farm(p,action,r.scene.music_state);
  const alive=[...r.players.values()].filter(x=>x.alive);advanceTurn(r);r.turnIndex=(r.turnIndex||0)+1;
  if(!alive.length){r.completed=true;r.outcome='wipe';for(const item of r.scene.loot){item.status='lost'}r.scene.loot=[]}
  saveState();return{narration:r.scene.narration,music_state:r.scene.music_state,intensity:r.scene.intensity,dice:roll,skillGrowth,wounds:player.wounds,woundsAdded,deathDrop,drops,progress:r.progress};
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
function migrateItemState(item){
  if(!item||item.kind!=='equipment')return item;
  item.durability=Number.isFinite(Number(item.durability))?clamp(Number(item.durability),0,100):100;
  item.condition=item.condition||conditionLabel(item.durability);
  item.material=Array.isArray(item.material)?item.material:(item.slot==='armor'?['steel']:['steel']);
  item.damage=Array.isArray(item.damage)?item.damage:[];
  item.defects=Array.isArray(item.defects)?item.defects:[];
  if(item.slot==='weapon'){item.baseDamage=item.baseDamage||'1d8';item.damageBonus=Number(item.damageBonus)||Math.max(0,Math.floor((item.power||1)/8))}
  if(item.slot==='armor'){item.baseArmor=Number(item.baseArmor)||clamp(1+Math.floor((item.eventTier||1)/2),1,5);item.armor=item.baseArmor}
  return item;
}
function migrateProfile(p){
  p.characterSlots=Number(p.characterSlots)||3;p.eventTickets=Number.isFinite(p.eventTickets)?p.eventTickets:2;p.subscription=p.subscription||{active:false,expiresAt:null};
  p.inventory=(Array.isArray(p.inventory)?p.inventory:[]).map(migrateItemState);p.characters=(Array.isArray(p.characters)?p.characters:[]).map(materializeCharacterCore);p.equipped=p.equipped||{weapon:null,armor:null,charm:null,tool:null};
  if(p.character&&p.characters.length===0){
    const old={...p.character,id:p.character.id||id('char'),status:p.alive===false?'dead':'alive',xp:Number(p.character.xp)||0,level:Number(p.character.level)||1,createdAt:now(),runs:0,wins:0};
    p.characters.push(old);if(old.status==='alive')p.activeCharacterId=old.id;
  }
  syncActiveCharacter(p);return p;
}
function ensureProfile(name='Игрок') {
  const key=normalize(name)||'player';
  if(!persisted.profiles[key]){
    persisted.profiles[key]={id:crypto.randomUUID(),name:String(name).trim()||'Игрок',balance:0,farmToday:0,farmDay:new Date().toISOString().slice(0,10),inventory:starterInventory(),equipped:{weapon:null,armor:null,charm:null,tool:null},recentActions:[],characterSlots:3,characters:[],activeCharacterId:null,eventTickets:2,subscription:{active:false,expiresAt:null}};
    saveState();
  }
  const p=migrateProfile(persisted.profiles[key]),day=new Date().toISOString().slice(0,10);
  if(p.farmDay!==day){p.farmDay=day;p.farmToday=0;p.recentActions=[];saveState();}
  return p;
}
function createSession(name,remoteAddress) {
  // Display names never grant access to existing accounts.
  const p=ensureProfile(`guest_${crypto.randomUUID()}`);
  p.name=String(name||'Игрок').trim().slice(0,48)||'Игрок';
  p.farmOrigin=crypto.createHash('sha256').update(String(remoteAddress||'unknown')).digest('hex');
  const token=crypto.randomBytes(32).toString('base64url');
  persisted.sessions[crypto.createHash('sha256').update(token).digest('hex')]=p.id;
  saveState();return {token,profile:publicProfile(p)};
}
function sessionProfile(req) {
  const token=String(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{40,})$/)?.[1];
  const pid=token&&persisted.sessions[crypto.createHash('sha256').update(token).digest('hex')];
  const p=pid&&Object.values(persisted.profiles).find(x=>x.id===pid);
  if(!p)throw Object.assign(new Error('unauthorized'),{status:401});
  return migrateProfile(p);
}
function localAdmin(req) {
  const addr=req.socket.remoteAddress;
  return addr==='127.0.0.1'||addr==='::1'||addr==='::ffff:127.0.0.1';
}
function publicProfile(p){
  syncActiveCharacter(p);
  return {id:p.id,name:p.name,balance:p.balance,farmToday:p.farmToday,inventory:p.inventory,equipped:p.equipped||{weapon:null,armor:null,charm:null,tool:null},character:p.character,alive:p.alive,
    characterSlots:p.characterSlots,usedSlots:p.characters.filter(x=>x.status==='alive').length,characters:p.characters,activeCharacterId:p.activeCharacterId,
    eventTickets:p.eventTickets,subscription:p.subscription,transactions:persisted.transactions.filter(x=>x.profileId===p.id).slice(0,40)};
}
function xpNeeded(level){return 100+Math.max(0,level-1)*80}
function grantXp(character,amount){
  materializeCharacterCore(character);character.xp=(character.xp||0)+Math.max(0,Math.floor(amount));let levels=0;
  while(character.xp>=xpNeeded(character.level||1)&&(character.level||1)<50){character.xp-=xpNeeded(character.level||1);character.level=(character.level||1)+1;levels++}
  if(levels){character.developmentPoints=(Number(character.developmentPoints)||0)+levels;refreshResourceCaps(character)}
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
  if(p.characters.filter(x=>x.status==='alive').length>=p.characterSlots)throw new Error('character_slots_full');
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
function enchantEffects(picked,quality,slot){
  const type=slot==='armor'?'armor_bonus':slot==='weapon'?'damage_bonus':'accuracy_bonus';
  return picked.map(x=>({type,key:x.def.enchant.key,label:x.def.enchant.label,value:Math.min(5,Math.max(1,Math.floor(x.def.enchant.base_value*quality/2)))}));
}
function enchantRunItem(room,player,targetId,ingredientIds){
  const facility=room.scenario.enchantment;if(!facility)throw new Error('event_has_no_enchanting');
  if(player.position?.anchorId!==facility.anchor_id)throw new Error('not_at_enchantment_facility');
  const target=(player.runInventory||[]).find(x=>x.id===targetId&&x.kind==='equipment');if(!target)throw new Error('equipment_not_in_run_inventory');
  if((target.enchantments||[]).length>=1+Math.floor((facility.tier||1)/2))throw new Error('enchantment_slots_full');
  const ids=[...new Set((ingredientIds||[]).map(String))];if(!ids.length||ids.length>facility.max_ingredients)throw new Error('invalid_ingredients');
  const picked=ids.map(x=>{const item=player.runInventory.find(i=>i.id===x),def=enchantDefinition(item);if(!def)throw new Error('invalid_enchant_ingredient');return{item,def}});
  for(const x of picked)consumeInventoryItem(player.runInventory,x.item.id,1);
  materializeCharacterCore(player.character);
  const modifier=(Number(player.character?.attributes?.intelligence)||0)+Math.floor(((player.character?.level)||1)-1)/5;
  const die=nextD20(),success=die===20||(die!==1&&die+modifier>=facility.challenge_dc);
  const roll={die,skill:'Интеллект/Воля',modifier,dc:facility.challenge_dc,total:die+modifier,success,critical:die===20,criticalFail:die===1};
  target.enchantments=target.enchantments||[];target.provenance=target.provenance||[];
  if(success){
    const quality=clamp(facility.tier+(roll.critical?1:0),1,5),effects=enchantEffects(picked,quality,target.slot);
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
function createLoot(profile,state='explore',event=null,tags=[],runCharacter=null){
  syncActiveCharacter(profile);
  const c=runCharacter||profile.character||{id:'unknown',name:profile.name,archetype:'Странник',level:1,attributes:{perception:1}};
  const rarity=rollRarity(state,event),budget=rarityBudget[rarity],level=clamp(Number(c.level)||1,1,50),skills=(c.dynamicSkills||[]).slice().sort((x,y)=>(Number(y.rank)||0)-(Number(x.rank)||0)).slice(0,2).map(x=>x.name),primary=skills[0]||Object.entries(c.attributes||{}).sort((x,y)=>y[1]-x[1])[0]?.[0]||'perception';
  const slot=/сил|страж/i.test(c.archetype||'')?'armor':/маг|аркан/i.test(c.archetype||'')?'charm':/лов|следопыт/i.test(c.archetype||'')?'weapon':['weapon','armor','charm','tool'][crypto.randomInt(0,4)];
  const nouns={weapon:['Клинок','Копьё','Резак'],armor:['Панцирь','Кираса','Плащ'],charm:['Печать','Талисман','Осколок'],tool:['Компас','Ключ','Фокус']},style=tags[0]||'адаптивность';
  return{
    id:id('item'),serial:'KW-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase(),kind:'equipment',stackable:false,
    name:nouns[slot][crypto.randomInt(0,nouns[slot].length)]+' · '+style,slot,rarity,level,eventTier:event?.danger_tier||1,
    power:Math.max(1,Math.floor((level+(event?.danger_tier||1)*2+budget)*1.2)),affixes:[{stat:primary,value:Math.max(1,Math.ceil(budget/2))}],
    durability:100,condition:'intact',material:slot==='armor'?['steel','leather']:slot==='weapon'?['steel']:['crystal','alloy'],damage:[],defects:[],
    ...(slot==='weapon'?{baseDamage:'1d8',damageBonus:Math.max(0,Math.floor(budget/4))}:{}),...(slot==='armor'?{baseArmor:clamp(1+Math.floor(((event?.danger_tier)||1)/2)+Math.floor(budget/6),1,6),armor:clamp(1+Math.floor(((event?.danger_tier)||1)/2)+Math.floor(budget/6),1,6)}:{}),
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
  const archetype=/маг|разрез|простран|аркан/.test(t)?'Арканист':/щит|брон|танк|сила/.test(t)?'Страж':/лук|след|ловк|скрыт|стрел/.test(t)?'Следопыт':'Авантюрист';
  const fantasy=/разрез|простран/.test(t)?'Разрез пространства':/стрел|лук/.test(t)?'Точный выстрел':/щит|страж/.test(t)?'Силовой удар':'Основной приём';
  return materializeCharacterCore({id:id('char'),name:'Герой',archetype,level:1,xp:0,status:'alive',runs:0,wins:0,createdAt:now(),concept:wish||'Искатель приключений',appearance,abilities:[fantasy],weakness:'Сила авторских приёмов ограничена уровневым бюджетом'});
}
function classifyMusic(text='') {
  const t=normalize(text);
  if(/босс|гигант|последн/.test(t))return'boss'; if(/смерт|погиб|потер/.test(t))return'grief';
  if(/погон|беж|гонит/.test(t))return'chase'; if(/ритуал|культ|алтар/.test(t))return'ritual';
  if(/ад|лава|плам|печь/.test(t))return'hell'; if(/ужас|страх|бездна/.test(t))return'dread';
  if(/бой|атак|удар|враг/.test(t))return'tension'; if(/наш|откр|понял|тайн/.test(t))return'discovery';
  return'explore';
}
function chooseCheck(action){
  const t=normalize(action);
  if(/слом|поднять|толк|тащ|удерж/.test(t))return{attribute:'strength',skill:null};
  if(/угрож|запуг/.test(t))return{attribute:/ломаю|разбиваю|сжимаю/.test(t)?'strength':'charisma',skill:'Запугивание'};
  if(/убеж|обман|переговор|лидер/.test(t))return{attribute:'charisma',skill:/обман/.test(t)?'Обман':'Убеждение'};
  if(/крад|тихо|скрыт/.test(t))return{attribute:'agility',skill:'Скрытность'};
  if(/стрел|винтов|лук|пистолет/.test(t))return{attribute:'agility',skill:'Баллистика'};
  if(/прыг|уклон|акроб|баланс/.test(t))return{attribute:'agility',skill:null};
  if(/яд|боль|истощ|выдерж|терп/.test(t))return{attribute:'endurance',skill:null};
  if(/анализ|взлом|механ|техник|медицин/.test(t))return{attribute:'intelligence',skill:/медицин/.test(t)?'Медицина':null};
  if(/осмотр|ищ|след|слуш|замеч|воспр/.test(t))return{attribute:'perception',skill:null};
  return{attribute:'perception',skill:null};
}
function fallbackGM(room,action,actor){
  const t=normalize(action),risky=/атак|удар|реж|стрел|прыг|взлом|крад|бег|ритуал|слом|лез|переб|плыв/.test(t),lethal=/пропаст|огн|босс|бездн|смертел|прыгаю вниз|прыжок вниз/.test(t),check=chooseCheck(action);
  const anchor=room.scene.geometry?.anchors?.find(x=>t.includes(normalize(x.label))||t.includes(normalize(x.id)));
  return{check_required:risky,check_attribute:check.attribute,check_skill:check.skill,difficulty_shift:0,danger:lethal?'lethal':risky?'risky':'safe',npc_dialogue:fallbackNpcDialogue(room,action),
    success_narration:(actor.character?.name||actor.name)+' добивается результата.',failure_narration:'Попытка проваливается и создаёт осложнение.',
    no_check_narration:(actor.character?.name||actor.name)+' действует: '+action+'.',music_state:risky?'tension':'explore',move_to:anchor?.id||null,loot:risky};
}
function fixedDc(event,shift=0){return clamp(7+(event?.danger_tier||1)*2+clamp(Number(shift)||0,-1,1)*2,7,19)}
function rollCheck(event,character,action,proposal,player){
  if(!proposal.check_required)return null;
  materializeCharacterCore(character);
  const picked=chooseCheck(action),die=nextD20(),bonus=Math.floor(((character?.level)||1)-1)/5+(Number(player?.nextRollBonus)||0);if(player)player.nextRollBonus=0;
  const dc=fixedDc(event,proposal.difficulty_shift);
  const equipped=(player?.runInventory||[]).filter(item=>item.kind==='equipment'&&(!player.profile?.equipped?.[item.slot]||player.profile.equipped[item.slot]===item.id));
  const itemBonus=equipped.reduce((total,item)=>total+itemModifier(item,'skill_bonus',proposal.check_skill??picked.skill)+itemModifier(item,'attribute_bonus',proposal.check_attribute||picked.attribute),0);
  return resolveCheck({character,attribute:proposal.check_attribute||picked.attribute,skill:proposal.check_skill??picked.skill,dc,die,bonus:bonus+Math.min(10,itemBonus)});
}

function farm(profile, action, music) {
  const n=normalize(action); if(n.length<8||profile.recentActions.includes(n))return 0;
  const cap=60,base=['boss','discovery'].includes(music)?5:3,key=`${profile.farmDay}:${profile.farmOrigin||profile.id}`;
  const reward=Math.min(base,Math.max(0,cap-profile.farmToday),Math.max(0,cap-(persisted.farmBuckets[key]||0)));
  persisted.farmBuckets[key]=(persisted.farmBuckets[key]||0)+reward;
  profile.farmToday+=reward; profile.balance+=reward; profile.recentActions.unshift(n); profile.recentActions=profile.recentActions.slice(0,12);
  if(reward) persisted.transactions.unshift({id:id('tx'),at:now(),profileId:profile.id,type:'farm',amount:reward});
  saveState(); return reward;
}
async function ensureItemVisual(item){
  if(!['epic','relic','mythic'].includes(item.rarity))throw new Error('visual_requires_epic');
  const existing=path.join(ITEM_MEDIA_DIR,item.id+'.png');
  if(fs.existsSync(existing)){item.visual={url:'/api/item-media/'+item.id+'.png',generated:true};return item.visual;}
  const c=runtimeConfig().image||{};if(!c.enabled||!c.api_key||!c.base_url||!c.model)throw new Error('image_not_configured');
  const r=await providerFetch(String(c.base_url).replace(/\/$/,'')+'/images/generations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.api_key},body:JSON.stringify({model:c.model,prompt:item.visualPrompt||('RPG item '+item.name),size:'1024x1024',n:1})});
  if(!r.ok)throw new Error('image_'+r.status);const d=await r.json(),entry=d.data?.[0];let bytes=null;
  if(entry?.b64_json)bytes=Buffer.from(entry.b64_json,'base64');
  else if(entry?.url){const ir=await providerFetch(entry.url);if(ir.ok)bytes=Buffer.from(await ir.arrayBuffer());}
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
function encounterName(scenario){
  const names={glass_maze:'Зеркальный страж',black_station:'Пассажир без лица',ash_crown:'Пепельный латник',red_orbit:'Аварийный дрон',bone_foundry:'Костяной кузнец',drowned_cathedral:'Служитель глубины',ember_archive:'Архивариус',iron_rain:'Штурмовик Бури',null_garden:'Нулевая тень'};
  return names[scenario?.id]||'Угроза события';
}
function createScene(scenario,narration){
  const hostile=createNpcCombatant({id:id('enemy'),name:encounterName(scenario),tier:scenario?.danger_tier||1});
  assignNpcVoiceProfile(hostile,{unique:(scenario?.danger_tier||1)>=5,seed:scenario?.id||hostile.name});
  hostile.temperament=hostile.temperament||((scenario?.danger_tier||1)>=4?'aggressive':'guarded');hostile.currentEmotion='alert';hostile.morale=100;
  const geometry=sceneGeometryFor(scenario),last=geometry.anchors.at(-1);hostile.position={x:last.x,y:last.y,z:last.z||0,anchorId:last.id};
  return {id:id('scene'),title:scenario?.title||'Сцена',narration:narration??scenario?.opening??'',music_state:'explore',intensity:.25,loot:[],combatants:[hostile],geometry};
}
function spawnPosition(scene,index=0){
  const a=scene.geometry?.anchors?.[0]||{x:0,y:0,z:0};
  return {x:a.x+Math.min(index,3)*.7,y:a.y,z:a.z||0,eyeHeight:1.7,anchorId:a.id};
}
function movePlayerToAnchor(room,profileId,anchorId){
  if(!anchorId)return false;const player=room.players.get(profileId),a=room.scene.geometry?.anchors?.find(x=>x.id===anchorId);
  if(!player||!a)return false;
  const anchors=room.scene.geometry.anchors,current=anchors.findIndex(x=>x.id===player.position?.anchorId),destination=anchors.indexOf(a);
  if(current>=0&&Math.abs(destination-current)>1)return false;
  player.position={x:a.x,y:a.y,z:a.z||0,eyeHeight:player.position?.eyeHeight||1.7,anchorId:a.id};return true;
}
function personalPOV(room,profileId){
  const player=room.players.get(profileId);if(!player)return null;
  const pos=player.position||spawnPosition(room.scene,0),radius=room.scene.geometry?.visibilityRadius||15;
  const visible=(room.scene.geometry?.anchors||[]).filter(a=>Math.hypot((a.x||0)-pos.x,(a.y||0)-pos.y)<=radius);
  return {sceneId:room.scene.id,canonicalTitle:room.scene.title,camera:{x:pos.x,y:pos.y,z:(pos.z||0)+pos.eyeHeight,eyeHeight:pos.eyeHeight,anchorId:pos.anchorId},visibleAnchors:visible,hiddenAnchorCount:Math.max(0,(room.scene.geometry?.anchors?.length||0)-visible.length),narration:room.scene.narration,music_state:room.scene.music_state};
}

function finishRun(r){
  if(r.completed)throw new Error('run_completed');if((r.progress||0)<100||!r.objectives?.filter(x=>x.required).every(x=>x.state==='complete'))throw new Error('objectives_incomplete');
  const alive=[...r.players.values()].filter(x=>x.alive);if(!alive.length)throw new Error('party_wiped');
  const participants=Math.max(1,r.participantsAtStart||r.players.size),underfill=clamp((r.scenario.recommended_players||1)/participants,1,2.5),rewards=[];
  for(const pl of alive){
    const p=pl.profile,c=p.characters.find(x=>x.id===pl.characterId);if(!c)continue;
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
  if(effect.type==='heal_wound'){player.wounds=Math.max(0,(player.wounds||0)-(Number(effect.value)||1));const c=materializeCharacterCore(player.character);c.combat.hp_current=Math.min(c.combat.hp_max,c.combat.hp_current+(Number(effect.value)||1)*4)}
  if(['roll_bonus','traversal','escape'].includes(effect.type))player.nextRollBonus=Math.max(Number(player.nextRollBonus)||0,Number(effect.value)||1);
  saveState();return{effect,wounds:player.wounds,hp:player.character?.combat?.hp_current??player.profile?.character?.combat?.hp_current??null,nextRollBonus:player.nextRollBonus||0};
}
function getRoom(c){ return rooms.get(String(c||'').toUpperCase()); }
function runDefenseView(player){
  const source=player.character||player.profile?.character;if(!source)return{hp_current:null,hp_max:null,evasion:null,initiative:null,armor:null};
  const c=materializeCharacterCore(source);
  const equippedId=player.profile?.equipped?.armor;
  const armor=(player.runInventory||[]).find(x=>x.id===equippedId)||(player.runInventory||[]).find(x=>x.kind==='equipment'&&x.slot==='armor')||null;
  return{hp_current:c.combat?.hp_current??null,hp_max:c.combat?.hp_max??null,evasion:c.combat?.evasion??null,initiative:c.combat?.initiative??null,
    armor:armor?{id:armor.id,name:armor.name,base:armor.baseArmor??armor.armor??0,effective:effectiveArmor(armor,'torso'),durability:armor.durability??100,condition:armor.condition||conditionLabel(armor.durability??100)}:null};
}
function roomView(r,profileId){
  if(!r.players.has(profileId))throw new Error('player_not_in_room');
  const pov=personalPOV(r,profileId),visible=new Set(pov.visibleAnchors.map(a=>a.id));
  const scene={...r.scene,geometry:{...r.scene.geometry,anchors:pov.visibleAnchors},
    combatants:(r.scene.combatants||[]).filter(c=>!c.hidden&&(!c.position||Math.hypot(c.position.x-pov.camera.x,c.position.y-pov.camera.y)<=(r.scene.geometry?.visibilityRadius||15))),
    loot:(r.scene.loot||[]).filter(item=>!item.hidden&&(!item.anchorId||visible.has(item.anchorId)))};
  return {code:r.code,scenario:r.scenario,event:r.scenario,hostId:r.hostId,voice:r.voice||{gmVoiceId:GM_VOICE_PROFILES[0].id},started:r.started,completed:Boolean(r.completed),outcome:r.outcome||null,
    turnIndex:r.turnIndex,turnOrder:r.turnOrder||[],turnCursor:r.turnCursor||0,round:r.round||1,timer:r.timer||null,revision:r.revision||0,progress:r.progress||0,objectives:r.objectives||[],participantsAtStart:r.participantsAtStart||0,scene,log:(r.log||[]).slice(0,20),
    players:[...r.players.values()].map(x=>({id:x.id,name:x.name,ready:x.ready,characterId:x.characterId,character:x.character||x.profile?.character||null,
      alive:x.alive!==false,position:x.position,wounds:x.wounds||0,defense:runDefenseView(x),capacity:x.capacity||6,runUsage:inventoryUsage(x.runInventory||[]),
      runInventory:x.id===profileId?x.runInventory||[]:[],pendingLoadout:x.id===profileId?x.pendingLoadout||[]:[]}))};
}

async function api(req,res,u){
  try{
    const stream=u.pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
    if(req.method==='GET'&&stream){const r=getRoom(stream[1]);if(!r)return json(res,404,{error:'room_not_found'});const p=sessionProfile(req);if(!r.players.has(p.id))return json(res,403,{error:'player_not_in_room'});
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive'});res.write(`data: ${JSON.stringify({type:'ROOM_UPDATED',room:roomView(r,p.id)})}\n\n`);
      const client={res,profileId:p.id};if(!subscribers.has(r.code))subscribers.set(r.code,new Set());subscribers.get(r.code).add(client);
      const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(heartbeat);subscribers.get(r.code)?.delete(client)});return;
    }
    if(req.method==='POST'&&u.pathname==='/api/session'){const input=await body(req);return json(res,201,createSession(input.name,req.socket.remoteAddress));}
    if(req.method==='GET'&&u.pathname==='/api/session'){const p=sessionProfile(req);return json(res,200,{profile:publicProfile(p),room:[...rooms.values()].filter(r=>r.players.has(p.id)&&!r.completed).map(r=>r.code)});}
    if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,version:'0.8.0-character-combat-core',llm:providerReady('llm'),stt:providerReady('stt'),tts:providerReady('tts')});
    if(req.method==='GET'&&u.pathname==='/api/voice-profiles')return json(res,200,publicVoiceCatalog());
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
      const owner=sessionProfile(req);
      const item=owner.inventory.find(x=>x.id===itemVisual[1])||[...rooms.values()].flatMap(r=>r.players.get(owner.id)?.runInventory||[]).find(x=>x.id===itemVisual[1]);
      if(!item)return json(res,404,{error:'item_not_found'});
      try{return json(res,200,{visual:await ensureItemVisual(item)})}catch(e){return json(res,e.message==='image_not_configured'?409:422,{error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/config'){
      if(!localAdmin(req))return json(res,403,{error:'local_admin_only'});
      const c=readJson(CONFIG_FILE,{}),scrub=o=>Object.fromEntries(Object.entries(o||{}).map(([k,v])=>[k,/key/i.test(k)?(v?'••••••':''):v]));
      return json(res,200,{...c,llm:scrub(c.llm),stt:scrub(c.stt),tts:scrub(c.tts),image:scrub(c.image)});
    }
    if(req.method==='POST'&&u.pathname==='/api/config'){
      if(!localAdmin(req))return json(res,403,{error:'local_admin_only'});
      const incoming=await body(req),current=readJson(CONFIG_FILE,{});
      for(const section of ['llm','stt','tts','image'])if(incoming[section]){
        const update={...incoming[section]};
        if(!update.api_key||String(update.api_key).includes('•'))delete update.api_key;
        if(update.base_url)await validateProviderUrl(update.base_url,{allowPrivate:process.env.KISAI_ALLOW_PRIVATE_PROVIDER==='1'});
        current[section]={...(current[section]||{}),...update};
      }
      if(Number(incoming.port))current.port=Number(incoming.port);writeJson(CONFIG_FILE,current);return json(res,200,{ok:true});
    }

    if(req.method==='GET'&&u.pathname==='/api/profile'){const p=sessionProfile(req);return json(res,200,publicProfile(p))}
    if(req.method==='POST'&&u.pathname==='/api/profile/character'){
      const b=await body(req),p=sessionProfile(req);
      if(findActiveRun(p.id))return json(res,409,{error:'cannot_create_character_during_run'});
      try{const made=await createCharacterForProfile(p,b.wish,b.appearance);return json(res,201,{...made,profile:publicProfile(p)})}catch(e){return json(res,409,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/select-character'){
      const b=await body(req),p=sessionProfile(req),c=p.characters.find(x=>x.id===b.characterId&&x.status==='alive');if(!c)return json(res,404,{error:'character_not_found_or_dead'});
      p.activeCharacterId=c.id;syncActiveCharacter(p);saveState();return json(res,200,publicProfile(p));
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/craft'){
      const b=await body(req),p=sessionProfile(req);if(findActiveRun(p.id))return json(res,409,{error:'cannot_craft_during_run'});
      try{return json(res,200,{item:craftForProfile(p,b.recipeId,b.quantity),profile:publicProfile(p)})}catch(e){return json(res,409,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/character-voice'){
      const b=await body(req),p=sessionProfile(req);if(findActiveRun(p.id))return json(res,409,{error:'cannot_change_voice_during_run'});
      const c=syncActiveCharacter(p);if(!c)return json(res,404,{error:'active_character_not_found'});
      const profile=voiceProfile(b.voiceProfileId),mode=String(b.mode||'raw');if(!profile||profile.kind!=='player')return json(res,409,{error:'invalid_player_voice'});
      if(!['raw','character','manual'].includes(mode))return json(res,409,{error:'invalid_voice_mode'});
      c.voiceProfileId=profile.id;c.voiceMode=mode;saveState();return json(res,200,{character:c,profile:publicProfile(p)});
    }

    if(req.method==='POST'&&u.pathname==='/api/profile/resource-upgrade'){
      const b=await body(req),p=sessionProfile(req);if(findActiveRun(p.id))return json(res,409,{error:'cannot_upgrade_resource_during_run'});
      const c=syncActiveCharacter(p);if(!c)return json(res,404,{error:'active_character_not_found'});if((Number(c.developmentPoints)||0)<1)return json(res,409,{error:'no_development_points'});
      try{const resource=upgradeResourcePool(c,String(b.poolId||''));c.developmentPoints--;saveState();return json(res,200,{resource,character:c,profile:publicProfile(p)})}catch(e){return json(res,409,{error:e.message})}
    }

    if(req.method==='POST'&&u.pathname==='/api/profile/ability-evolve'){
      const b=await body(req),p=sessionProfile(req);if(findActiveRun(p.id))return json(res,409,{error:'cannot_evolve_during_run'});
      const c=syncActiveCharacter(p);if(!c)return json(res,404,{error:'active_character_not_found'});if((Number(c.developmentPoints)||0)<1)return json(res,409,{error:'no_development_points'});
      try{const ability=evolveAbilityDefinition(c,{abilityId:b.abilityId,idea:b.idea,mode:b.mode==='new'?'new':'modify'});c.developmentPoints--;saveState();return json(res,200,{ability,character:c,profile:publicProfile(p)})}catch(e){return json(res,409,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/equip'){
      const b=await body(req),p=sessionProfile(req),item=p.inventory.find(x=>x.id===b.itemId&&x.kind==='equipment');if(!item)return json(res,404,{error:'equipment_not_found'});
      p.equipped=p.equipped||{weapon:null,armor:null,charm:null,tool:null};p.equipped[item.slot]=item.id;saveState();return json(res,200,publicProfile(p));
    }
    if(req.method==='POST'&&u.pathname==='/api/profile/unequip'){
      const b=await body(req),p=sessionProfile(req),slot=String(b.slot||'');if(!['weapon','armor','charm','tool'].includes(slot))return json(res,409,{error:'invalid_slot'});
      p.equipped=p.equipped||{weapon:null,armor:null,charm:null,tool:null};p.equipped[slot]=null;saveState();return json(res,200,publicProfile(p));
    }

    if(req.method==='POST'&&u.pathname==='/api/rooms'){
      const b=await body(req),event=activeEvent(b.eventId||b.scenarioId);if(!event)return json(res,409,{error:'event_not_active'});
      const p=sessionProfile(req);if(findActiveRun(p.id))return json(res,409,{error:'already_in_active_run'});const c=p.characters.find(x=>x.id===(b.characterId||p.activeCharacterId)&&x.status==='alive')||syncActiveCharacter(p);
      const scene=createScene(event,event.opening||'');scene.music_state='lobby';
      const requestedGm=voiceProfile(b.gmVoiceId);const r={code:code(),scenario:event,hostId:p.id,voice:{gmVoiceId:requestedGm?.kind==='gm'?requestedGm.id:GM_VOICE_PROFILES[0].id},started:false,completed:false,outcome:null,turnIndex:0,progress:0,participantsAtStart:0,players:new Map(),scene,log:[],createdAt:now()};
      const pl={id:p.id,name:p.name,ready:false,profile:p,characterId:null,character:null,alive:false,wounds:0,nextRollBonus:0,position:spawnPosition(scene,0),capacity:6,pendingLoadout:[],runInventory:[]};
      r.players.set(p.id,pl);if(c)attachCharacterToRoom(r,p,c);rooms.set(r.code,r);
      return json(res,201,{room:roomView(r,sessionProfile(req).id),profile:publicProfile(p),access:accessStatus(p,event)});
    }
    const join=u.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if(req.method==='POST'&&join){
      const r=getRoom(join[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});if(r.players.size>=5)return json(res,409,{error:'party_full'});
      const b=await body(req),p=sessionProfile(req);if(r.players.has(p.id))return json(res,200,{room:roomView(r,p.id),profile:publicProfile(p),access:accessStatus(p,r.scenario)});if(findActiveRun(p.id))return json(res,409,{error:'already_in_active_run'});const c=p.characters.find(x=>x.id===(b.characterId||p.activeCharacterId)&&x.status==='alive')||syncActiveCharacter(p);
      const pl={id:p.id,name:p.name,ready:false,profile:p,characterId:null,character:null,alive:false,wounds:0,nextRollBonus:0,position:spawnPosition(r.scene,r.players.size),capacity:6,pendingLoadout:[],runInventory:[]};
      r.players.set(p.id,pl);if(c)attachCharacterToRoom(r,p,c);return json(res,200,{room:roomView(r,sessionProfile(req).id),profile:publicProfile(p),access:accessStatus(p,r.scenario)});
    }
    const roomVoice=u.pathname.match(/^\/api\/rooms\/([^/]+)\/voice-config$/);
    if(req.method==='POST'&&roomVoice){
      const r=getRoom(roomVoice[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});
      const b=await body(req),p=sessionProfile(req);if(r.hostId!==p.id)return json(res,403,{error:'host_only'});
      const profile=voiceProfile(b.gmVoiceId);if(!profile||profile.kind!=='gm')return json(res,409,{error:'invalid_gm_voice'});
      r.voice={...(r.voice||{}),gmVoiceId:profile.id};return json(res,200,roomView(r,sessionProfile(req).id));
    }
    const roomGet=u.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if(req.method==='GET'&&roomGet){const r=getRoom(roomGet[1]);if(!r)return json(res,404,{error:'room_not_found'});const p=sessionProfile(req);return r.players.has(p.id)?json(res,200,roomView(r,p.id)):json(res,403,{error:'player_not_in_room'});}
    const pov=u.pathname.match(/^\/api\/rooms\/([^/]+)\/pov$/);
    if(req.method==='GET'&&pov){const r=getRoom(pov[1]);if(!r)return json(res,404,{error:'room_not_found'});const p=sessionProfile(req),view=personalPOV(r,p.id);return view?json(res,200,view):json(res,404,{error:'player_not_in_room'})}

    const select=u.pathname.match(/^\/api\/rooms\/([^/]+)\/select-character$/);
    if(req.method==='POST'&&select){
      const r=getRoom(select[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});
      const b=await body(req),p=sessionProfile(req),c=p.characters.find(x=>x.id===b.characterId&&x.status==='alive');if(!c)return json(res,404,{error:'character_not_found_or_dead'});
      if(!r.players.has(p.id))return json(res,403,{error:'player_not_in_room'});
      p.activeCharacterId=c.id;syncActiveCharacter(p);attachCharacterToRoom(r,p,c);saveState();return json(res,200,{room:roomView(r,sessionProfile(req).id),profile:publicProfile(p)});
    }
    const char=u.pathname.match(/^\/api\/rooms\/([^/]+)\/character$/);
    if(req.method==='POST'&&char){
      const r=getRoom(char[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});
      const b=await body(req),p=sessionProfile(req);
      if(!r.players.has(p.id))return json(res,403,{error:'player_not_in_room'});
      try{const made=await createCharacterForProfile(p,b.wish,b.appearance);attachCharacterToRoom(r,p,made.character);return json(res,200,{...made,profile:publicProfile(p),room:roomView(r,sessionProfile(req).id)})}catch(e){return json(res,409,{error:e.message})}
    }
    const loadout=u.pathname.match(/^\/api\/rooms\/([^/]+)\/loadout$/);
    if(req.method==='POST'&&loadout){
      const r=getRoom(loadout[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});
      const b=await body(req),p=sessionProfile(req),pl=r.players.get(p.id);if(!pl?.character)return json(res,409,{error:'character_required'});
      const agg=new Map();for(const x of Array.isArray(b.items)?b.items:[]){const itemId=String(x.itemId||''),q=clamp(Math.floor(Number(x.quantity)||1),1,99);if(itemId)agg.set(itemId,(agg.get(itemId)||0)+q)}
      const requests=[...agg].map(([itemId,quantity])=>({itemId,quantity}));let usage=0;
      for(const q of requests){const item=p.inventory.find(x=>x.id===q.itemId);if(!item||!canTakeFromStash(p,q.itemId,q.quantity))return json(res,409,{error:'invalid_loadout_item',itemId:q.itemId});usage+=stackCost(item,q.quantity)}
      if(usage>pl.capacity)return json(res,409,{error:'run_inventory_over_capacity',usage,capacity:pl.capacity});
      pl.pendingLoadout=requests;return json(res,200,{room:roomView(r,sessionProfile(req).id),usage,capacity:pl.capacity});
    }
    const start=u.pathname.match(/^\/api\/rooms\/([^/]+)\/start$/);
    if(req.method==='POST'&&start){
      const r=getRoom(start[1]);if(!r)return json(res,404,{error:'room_not_found'});if(r.started)return json(res,409,{error:'run_already_started'});
      const host=sessionProfile(req);if(host.id!==r.hostId)return json(res,403,{error:'host_only'});
      const players=[...r.players.values()];if(!players.length)return json(res,409,{error:'empty_party'});
      for(const pl of players){
        const p=pl.profile;if(!pl.character||!pl.alive)return json(res,409,{error:'all_players_need_alive_character',player:pl.name});
        if(!accessStatus(p,r.scenario).ok)return json(res,402,{error:'payment_required',player:pl.name,event:r.scenario.id});
        for(const q of pl.pendingLoadout||[])if(!canTakeFromStash(p,q.itemId,q.quantity))return json(res,409,{error:'loadout_changed',player:pl.name,itemId:q.itemId});
      }
      for(const pl of players){
        const p=pl.profile;consumeAccess(p,r.scenario);pl.runInventory=[];
        for(const q of pl.pendingLoadout||[]){const item=takeFromStash(p,q.itemId,q.quantity);item.provenance=item.provenance||[];item.provenance.push({at:now(),type:'entered_event',eventId:r.scenario.id,characterId:pl.characterId});pl.runInventory.push(item)}
        const c=p.characters.find(x=>x.id===pl.characterId);if(c){c.runs=(c.runs||0)+1;refillCharacterResources(c);pl.character=c}
      }
      r.started=true;r.participantsAtStart=players.length;r.startedAt=now();r.scene.music_state='explore';
      const destination=r.scene.geometry.anchors.at(-1);
      r.objectives=[{id:'reach_destination',type:'reach_anchor',anchorId:destination.id,state:'pending',required:true},{id:'defeat_threat',type:'defeat_threat',state:'pending',required:false}];
      startTurns(r);saveState();return json(res,200,roomView(r,sessionProfile(req).id));
    }

    const combatAttack=u.pathname.match(/^\/api\/rooms\/([^/]+)\/combat\/attack$/);
    if(req.method==='POST'&&combatAttack){
      const r=getRoom(combatAttack[1]);if(!r)return json(res,404,{error:'room_not_found'});if(!r.started||r.completed)return json(res,409,{error:'run_not_active'});
      const b=await body(req),p=sessionProfile(req),pl=r.players.get(p.id);if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      try{const action=String(b.action||'атакую').slice(0,1200),committed=await commitCombatTurn(r,p,action,b),voiceEvents=buildVoiceEvents(r,p,action,committed,{}),voiceAudio=await synthesizeVoiceQueue(voiceEvents,r);return json(res,200,{...committed,voiceEvents,voiceAudio,room:roomView(r,sessionProfile(req).id),profile:publicProfile(p)})}catch(e){return json(res,409,{error:e.message,pool:e.pool,current:e.current,required:e.required})}
    }

    const turn=u.pathname.match(/^\/api\/rooms\/([^/]+)\/turn$/);
    if(req.method==='POST'&&turn){
      const r=getRoom(turn[1]);if(!r)return json(res,404,{error:'room_not_found'});if(!r.started||r.completed)return json(res,409,{error:'run_not_active'});
      const b=await body(req),p=sessionProfile(req),pl=r.players.get(p.id);if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      const action=String(b.action||'осматриваюсь').slice(0,1200);
      if(isAttackAction(action)){try{const committed=await commitCombatTurn(r,p,action,b);const voiceEvents=buildVoiceEvents(r,p,action,committed,{}),voiceAudio=await synthesizeVoiceQueue(voiceEvents,r);return json(res,200,{...committed,voiceEvents,voiceAudio,room:roomView(r,sessionProfile(req).id),profile:publicProfile(p),ai:providerReady('llm')})}catch(e){if(e.message==='insufficient_resource')return json(res,409,{error:e.message,pool:e.pool,current:e.current,required:e.required});if(e.message!=='no_hostile_target')throw e}}
      const proposal=await resolveGMAI(r,action,p),committed=commitTurn(r,p,action,proposal);
      const voiceEvents=buildVoiceEvents(r,p,action,committed,proposal),voiceAudio=await synthesizeVoiceQueue(voiceEvents,r);return json(res,200,{...proposal,...committed,voiceEvents,voiceAudio,room:roomView(r,sessionProfile(req).id),profile:publicProfile(p),ai:providerReady('llm')});
    }
    const voiceTurn=u.pathname.match(/^\/api\/rooms\/([^/]+)\/voice-turn$/);
    if(req.method==='POST'&&voiceTurn){
      const r=getRoom(voiceTurn[1]);if(!r)return json(res,404,{error:'room_not_found'});if(!r.started||r.completed)return json(res,409,{error:'run_not_active'});
      const b=await body(req),p=sessionProfile(req),pl=r.players.get(p.id);if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      const action=await transcribeAudio(b.audioBase64,b.mimeType||'audio/webm');if(!action)return json(res,422,{error:'empty_transcript'});
      let proposal={},committed;if(isAttackAction(action)){try{committed=await commitCombatTurn(r,p,action,b)}catch(e){if(e.message==='insufficient_resource')return json(res,409,{error:e.message,pool:e.pool,current:e.current,required:e.required,transcript:action});if(e.message!=='no_hostile_target')throw e}}
      if(!committed){proposal=await resolveGMAI(r,action,p);committed=commitTurn(r,p,action,proposal)}
      const voiceEvents=buildVoiceEvents(r,p,action,committed,proposal),voiceAudio=await synthesizeVoiceQueue(voiceEvents,r);
      return json(res,200,{transcript:action,...proposal,...committed,voiceEvents,voiceAudio,room:roomView(r,sessionProfile(req).id),profile:publicProfile(p)});
    }

    const claim=u.pathname.match(/^\/api\/rooms\/([^/]+)\/loot\/([^/]+)\/claim$/);
    if(req.method==='POST'&&claim){
      const r=getRoom(claim[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=sessionProfile(req),pl=r.players.get(p.id);
      if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      const idx=(r.scene.loot||[]).findIndex(x=>x.id===claim[2]&&x.status==='scene');if(idx<0)return json(res,404,{error:'loot_not_found'});const item=r.scene.loot[idx];
      if(inventoryUsage(pl.runInventory)+stackCost(item)>pl.capacity)return json(res,409,{error:'run_inventory_full',usage:inventoryUsage(pl.runInventory),capacity:pl.capacity});
      r.scene.loot.splice(idx,1);item.status='run';item.ownerId=p.id;item.provenance=item.provenance||[];item.provenance.push({at:now(),type:'claimed_in_event',eventId:r.scenario.id,characterId:pl.characterId});pl.runInventory.push(item);saveState();
      return json(res,200,{item,room:roomView(r,sessionProfile(req).id),profile:publicProfile(p)});
    }
    const use=u.pathname.match(/^\/api\/rooms\/([^/]+)\/use-item$/);
    if(req.method==='POST'&&use){
      const r=getRoom(use[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=sessionProfile(req),pl=r.players.get(p.id);if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      try{return json(res,200,{...useRunItem(r,pl,b.itemId),room:roomView(r,sessionProfile(req).id)})}catch(e){return json(res,409,{error:e.message})}
    }
    const enchant=u.pathname.match(/^\/api\/rooms\/([^/]+)\/enchant$/);
    if(req.method==='POST'&&enchant){
      const r=getRoom(enchant[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=sessionProfile(req),pl=r.players.get(p.id);if(!pl||!pl.alive)return json(res,409,{error:'character_dead'});
      try{return json(res,200,{...enchantRunItem(r,pl,b.targetId,b.ingredientIds),room:roomView(r,sessionProfile(req).id)})}catch(e){return json(res,409,{error:e.message})}
    }
    const extract=u.pathname.match(/^\/api\/rooms\/([^/]+)\/extract$/);
    if(req.method==='POST'&&extract){
      const r=getRoom(extract[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=sessionProfile(req);if(!r.players.has(p.id))return json(res,404,{error:'player_not_in_room'});
      try{const rewards=finishRun(r);return json(res,200,{rewards,room:roomView(r,sessionProfile(req).id),profile:publicProfile(p)})}catch(e){return json(res,409,{error:e.message,progress:r.progress||0})}
    }

    if(req.method==='GET'&&u.pathname==='/api/market')return json(res,200,persisted.market.filter(x=>x.status==='active'));
    if(req.method==='POST'&&u.pathname==='/api/market/list'){
      const b=await body(req),p=sessionProfile(req);if(findActiveRun(p.id))return json(res,409,{error:'cannot_trade_during_run'});
      const idx=p.inventory.findIndex(x=>x.id===b.itemId&&x.kind==='equipment');if(idx<0)return json(res,404,{error:'equipment_not_found'});
      const item=p.inventory.splice(idx,1)[0];p.equipped=p.equipped||{};if(p.equipped[item.slot]===item.id)p.equipped[item.slot]=null;item.status='escrow';
      const listing={id:id('listing'),item,sellerId:p.id,sellerName:p.name,price:clamp(Math.floor(Number(b.price)||1),1,1_000_000),status:'active',createdAt:now()};persisted.market.push(listing);persisted.transactions.unshift({id:id('tx'),at:now(),profileId:p.id,type:'market_list',amount:0,itemId:item.id,price:listing.price});saveState();return json(res,201,listing);
    }
    if(req.method==='POST'&&u.pathname==='/api/market/buy'){
      const b=await body(req),buyer=sessionProfile(req);if(findActiveRun(buyer.id))return json(res,409,{error:'cannot_trade_during_run'});
      const l=persisted.market.find(x=>x.id===b.listingId&&x.status==='active');if(!l)return json(res,404,{error:'listing_not_found'});if(l.sellerId===buyer.id)return json(res,409,{error:'own_listing'});if(buyer.balance<l.price)return json(res,409,{error:'insufficient_balance'});
      const seller=Object.values(persisted.profiles).map(migrateProfile).find(x=>x.id===l.sellerId),fee=Math.floor(l.price*25/1000),net=l.price-fee;buyer.balance-=l.price;if(seller)seller.balance+=net;l.status='sold';l.item.status='owned';l.item.ownerId=buyer.id;l.item.provenance=l.item.provenance||[];l.item.provenance.push({at:now(),type:'trade',from:l.sellerId,to:buyer.id,price:l.price});addToStash(buyer,l.item);
      persisted.transactions.unshift({id:id('tx'),at:now(),profileId:buyer.id,type:'market_buy',amount:-l.price,itemId:l.item.id,counterparty:l.sellerId},{id:id('tx'),at:now(),profileId:l.sellerId,type:'market_sale',amount:net,itemId:l.item.id,counterparty:buyer.id,fee});saveState();return json(res,200,{listing:l,profile:publicProfile(buyer)});
    }
    if(req.method==='POST'&&u.pathname==='/api/market/cancel'){
      const b=await body(req),p=sessionProfile(req),l=persisted.market.find(x=>x.id===b.listingId&&x.status==='active'&&x.sellerId===p.id);if(!l)return json(res,404,{error:'listing_not_found'});
      l.status='cancelled';addToStash(p,l.item);persisted.transactions.unshift({id:id('tx'),at:now(),profileId:p.id,type:'market_cancel',amount:0,itemId:l.item.id});saveState();return json(res,200,{profile:publicProfile(p)});
    }

    return json(res,404,{error:'not_found'});
  }catch(e){console.error(JSON.stringify({event:'api_error',path:u.pathname,code:e.message}));return json(res,e.status||(['invalid_provider_url','private_provider_url'].includes(e.message)?422:500),{error:e.status?e.message:'server_error',message:e.message})}
}
function staticFile(req,res,u){
  let rel;try{rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname)}catch{res.writeHead(400);return res.end('Bad path')}
  const file=path.resolve(PUBLIC,'.'+rel),relative=path.relative(PUBLIC,file);
  if(relative.startsWith('..')||path.isAbsolute(relative)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':'no-cache'});
  fs.createReadStream(file).pipe(res);
}

const server=http.createServer((req,res)=>{
  res.req=req;
  req.requestId=crypto.randomUUID();const started=Date.now();
  res.on('finish',()=>{
    if(req.method!=='POST'&&res.statusCode<400)return;
    let profileId=null;try{profileId=sessionProfile(req).id}catch{}
    console.log(JSON.stringify({event:'http_request',requestId:req.requestId,method:req.method,path:req.url?.split('?')[0],room:req.url?.match(/^\/api\/rooms\/([^/?]+)/)?.[1]||null,profileId,actionId:req.actionId||null,durationMs:Date.now()-started,status:res.statusCode,errorCode:res.errorCode||null}));
  });
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')) {
    const action=u.pathname.match(/^\/api\/rooms\/([^/]+)\/(turn|voice-turn|combat\/attack|use-item|enchant)$/);
    if(req.method==='POST'&&action){
      const r=getRoom(action[1]);if(!r)return json(res,404,{error:'room_not_found'});
      let p;try{p=sessionProfile(req);assertTurn(r,p.id);}catch(e){return json(res,e.message==='unauthorized'?401:409,{error:e.message})}
      if(busyRooms.has(r.code))return json(res,409,{error:'action_in_progress'});
      const actionId=String(req.headers['x-action-id']||'');
      if(actionId&&r.actionIds?.includes(actionId))return json(res,409,{error:'duplicate_action'});
      req.actionId=actionId||null;busyRooms.add(r.code);
      api(req,res,u).finally(()=>busyRooms.delete(r.code));return;
    }
    return api(req,res,u);
  }
  staticFile(req,res,u);
});
setInterval(()=>{
  for(const r of rooms.values())if(r.started&&!r.completed&&r.timer&&Date.now()>=r.timer.deadlineAt&&!busyRooms.has(r.code)){
    const expired=r.timer.playerId;r.log.unshift({at:now(),event:'TIMER_EXPIRED',profileId:expired,action:'timeout',narration:'Время хода истекло.'});
    advanceTurn(r);r.turnIndex=(r.turnIndex||0)+1;r.revision=(r.revision||0)+1;saveState();publishRoom(r,'TIMER_EXPIRED');
  }
},500);
const listenPort=Number(process.env.KISAI_PORT||config.port)||8787,listenHost=process.env.KISAI_BIND||config.host||'127.0.0.1';
server.listen(listenPort,listenHost,()=>console.log(`KisAI Worlds listening on ${listenHost}:${listenPort}`));
