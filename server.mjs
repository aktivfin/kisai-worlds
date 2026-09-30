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
const STATE_FILE = path.join(DATA, 'state.json');

fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_EXAMPLE, CONFIG_FILE);

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const config = readJson(CONFIG_FILE, { port: 8787 });
const scenarios = readJson(SCENARIOS_FILE, []);
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
const body = req => new Promise((resolve,reject)=>{ let raw=''; req.on('data',c=>{raw+=c;if(raw.length>2_000_000){reject(new Error('body too large'));req.destroy();}}); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}}); req.on('error',reject); });
const saveState = () => writeJson(STATE_FILE, persisted);

function ensureProfile(name='Игрок') {
  const key = normalize(name) || 'player';
  if (!persisted.profiles[key]) {
    persisted.profiles[key] = {
      id:id('profile'), name:String(name).trim()||'Игрок', balance:120, farmToday:0, farmDay:new Date().toISOString().slice(0,10),
      inventory:[], equipped:{weapon:null,armor:null,charm:null,tool:null}, recentActions:[], character:null, alive:true
    };
    saveState();
  }
  const p=persisted.profiles[key];
  const day=new Date().toISOString().slice(0,10);
  if(p.farmDay!==day){p.farmDay=day;p.farmToday=0;p.recentActions=[];saveState();}
  return p;
}
function publicProfile(p){ return {id:p.id,name:p.name,balance:p.balance,farmToday:p.farmToday,inventory:p.inventory,equipped:p.equipped,character:p.character,alive:p.alive}; }

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
  const music=classifyMusic(action);
  const narration=`${actor.name} действует: ${action}. Мир отвечает последствием, которое сохраняет текущий канон сцены. Следующий выбор партии уже будет учитывать это действие.`;
  return {narration,music_state:music,intensity:['boss','hell','chase'].includes(music)?.9:['tension','dread'].includes(music)?.65:.35,scene_transition:false,loot:Math.random()<.28};
}
function farm(profile, action, music) {
  const n=normalize(action); if(n.length<8||profile.recentActions.includes(n))return 0;
  const cap=60, base=['boss','discovery'].includes(music)?5:3, reward=Math.min(base,Math.max(0,cap-profile.farmToday));
  profile.farmToday+=reward; profile.balance+=reward; profile.recentActions.unshift(n); profile.recentActions=profile.recentActions.slice(0,12);
  if(reward) persisted.transactions.unshift({id:id('tx'),at:now(),profileId:profile.id,type:'farm',amount:reward});
  saveState(); return reward;
}
function getRoom(c){ return rooms.get(String(c||'').toUpperCase()); }
function roomView(r){ return {code:r.code,scenario:r.scenario,hostId:r.hostId,started:r.started,turnIndex:r.turnIndex,scene:r.scene,players:[...r.players.values()].map(x=>({id:x.id,name:x.name,ready:x.ready,character:x.profile.character,alive:x.profile.alive}))}; }

async function api(req,res,u){
  try {
    if(req.method==='GET'&&u.pathname==='/api/health') return json(res,200,{ok:true,version:'0.6.2-runtime'});
    if(req.method==='GET'&&u.pathname==='/api/scenarios') return json(res,200,scenarios);
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
      const room={code:code(),scenario,hostId:profile.id,started:false,turnIndex:0,players:new Map(),scene:{id:id('scene'),title:scenario?.title||'Сцена',narration:scenario?.opening||'',music_state:'lobby',intensity:.25,loot:[]},log:[]};
      room.players.set(profile.id,{id:profile.id,name:profile.name,ready:false,profile}); rooms.set(room.code,room); return json(res,201,{room:roomView(room),profile:publicProfile(profile)});
    }
    const join=u.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if(req.method==='POST'&&join){const r=getRoom(join[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name);r.players.set(p.id,{id:p.id,name:p.name,ready:false,profile:p});return json(res,200,{room:roomView(r),profile:publicProfile(p)});}
    const roomGet=u.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if(req.method==='GET'&&roomGet){const r=getRoom(roomGet[1]);return r?json(res,200,roomView(r)):json(res,404,{error:'room_not_found'});}
    const char=u.pathname.match(/^\/api\/rooms\/([^/]+)\/character$/);
    if(req.method==='POST'&&char){const r=getRoom(char[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name);p.character=fallbackCharacter(b.wish,b.appearance);saveState();const rp=r.players.get(p.id);if(rp)rp.ready=true;return json(res,200,{character:p.character,profile:publicProfile(p),room:roomView(r)});}
    const start=u.pathname.match(/^\/api\/rooms\/([^/]+)\/start$/);
    if(req.method==='POST'&&start){const r=getRoom(start[1]);if(!r)return json(res,404,{error:'room_not_found'});r.started=true;r.scene.music_state='explore';return json(res,200,roomView(r));}
    const turn=u.pathname.match(/^\/api\/rooms\/([^/]+)\/turn$/);
    if(req.method==='POST'&&turn){const r=getRoom(turn[1]);if(!r)return json(res,404,{error:'room_not_found'});const b=await body(req),p=ensureProfile(b.name);if(!p.alive)return json(res,409,{error:'character_dead'});const result=fallbackGM(r,b.action||'осматривается',p);const earned=farm(p,b.action,result.music_state);let loot=null;if(result.loot&&p.character){loot=createLoot(p,result.music_state);p.inventory.push(loot);saveState();}r.scene={...r.scene,narration:result.narration,music_state:result.music_state,intensity:result.intensity};r.log.unshift({at:now(),actor:p.name,action:b.action,narration:result.narration});return json(res,200,{...result,earned,loot,room:roomView(r),profile:publicProfile(p)});}
    if(req.method==='GET'&&u.pathname==='/api/profile'){const p=ensureProfile(u.searchParams.get('name'));return json(res,200,publicProfile(p));}
    if(req.method==='GET'&&u.pathname==='/api/market') return json(res,200,persisted.market.filter(x=>x.status==='active'));
    if(req.method==='POST'&&u.pathname==='/api/market/list'){const b=await body(req),p=ensureProfile(b.name),idx=p.inventory.findIndex(x=>x.id===b.itemId);if(idx<0)return json(res,404,{error:'item_not_found'});const [item]=p.inventory.splice(idx,1);item.status='escrow';const listing={id:id('listing'),item,sellerId:p.id,sellerName:p.name,price:clamp(Number(b.price)||1,1,1_000_000),status:'active',createdAt:now()};persisted.market.push(listing);saveState();return json(res,201,listing);}
    if(req.method==='POST'&&u.pathname==='/api/market/buy'){const b=await body(req),buyer=ensureProfile(b.name),l=persisted.market.find(x=>x.id===b.listingId&&x.status==='active');if(!l)return json(res,404,{error:'listing_not_found'});if(l.sellerId===buyer.id)return json(res,409,{error:'own_listing'});if(buyer.balance<l.price)return json(res,409,{error:'insufficient_balance'});const seller=Object.values(persisted.profiles).find(x=>x.id===l.sellerId);buyer.balance-=l.price;if(seller)seller.balance+=Math.floor(l.price*.975);l.status='sold';l.item.status='owned';l.item.ownerId=buyer.id;l.item.provenance.push({at:now(),type:'trade',from:l.sellerId,to:buyer.id,price:l.price});buyer.inventory.push(l.item);saveState();return json(res,200,{listing:l,profile:publicProfile(buyer)});}
    if(req.method==='POST'&&u.pathname==='/api/market/cancel'){const b=await body(req),p=ensureProfile(b.name),l=persisted.market.find(x=>x.id===b.listingId&&x.status==='active'&&x.sellerId===p.id);if(!l)return json(res,404,{error:'listing_not_found'});l.status='cancelled';l.item.status='owned';p.inventory.push(l.item);saveState();return json(res,200,{profile:publicProfile(p)});}
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
