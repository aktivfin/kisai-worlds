
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const S={
  name:localStorage.getItem('kisai.name')||'',
  profile:null,room:null,events:[],selectedEvent:null,crafting:null,
  volume:Number(localStorage.getItem('kisai.musicVolume')||32)/100,
  audio:null,music:null
};

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,opts={})=>{
  const r=await fetch(path,{headers:{'content-type':'application/json',...(opts.headers||{})},...opts});
  let d={};try{d=await r.json()}catch{}
  if(!r.ok){const e=new Error(d.error||d.message||('HTTP '+r.status));e.data=d;e.status=r.status;throw e}
  return d;
};
const toast=m=>{const e=$('#toast');if(!e)return;e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)};
const show=id=>{$$('.screen').forEach(e=>e.classList.toggle('active',e.id===id));$$('.navBtn').forEach(e=>e.classList.toggle('active',e.dataset.nav===id))};
const modal=(id,on=true)=>$(id)?.classList.toggle('hidden',!on);
const setName=n=>{S.name=(n||'').trim()||'Игрок';localStorage.setItem('kisai.name',S.name)};
const wait=async(ms=360)=>{const e=$('#transition');e?.classList.add('active');await new Promise(r=>setTimeout(r,ms));e?.classList.remove('active')};
const money=e=>e?.entry?.type==='free'?'БЕСПЛАТНО':('$'+((e?.entry?.price_cents||0)/100).toFixed(2));
const tier=e=>'◆'.repeat(Math.max(1,e?.danger_tier||1));
const MAP_POSITIONS=[
  [18,27],[43,18],[72,26],[31,48],[58,45],[82,54],[19,72],[47,76],[73,77]
];
const eventGlyph=e=>{
  const t=((e?.genre||'')+' '+(e?.title||'')).toLowerCase();
  if(/босс|дракон|собор|храм/.test(t))return '♜';
  if(/аном|разлом|пустот/.test(t))return '◉';
  if(/архив|исслед|станц/.test(t))return '◇';
  if(/лес|спас|эвак/.test(t))return '✦';
  if(/пес|конвой|ресурс/.test(t))return '⬡';
  return '◆';
};
const eventClass=e=>{
  const t=((e?.genre||'')+' '+(e?.title||'')).toLowerCase();
  if(/босс/.test(t))return 'boss';
  if(/аном|разлом|пустот/.test(t))return 'anomaly';
  if(/добыч|артеф|ресурс/.test(t))return 'loot';
  return 'recon';
};
function rotationRemaining(){
  const cycle=6*60*60*1000, left=cycle-(Date.now()%cycle);
  const h=Math.floor(left/3600000),m=Math.floor((left%3600000)/60000),s=Math.floor((left%60000)/1000);
  return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
}
function startRotationClock(){
  const draw=()=>{const el=$('#eventRotationTime');if(el)el.textContent=rotationRemaining()};
  draw(); if(!S.rotationTimer)S.rotationTimer=setInterval(draw,1000);
}


async function loadEvents(){
  S.events=await api('/api/events');
  if(!S.selectedEvent||!S.events.some(e=>e.id===S.selectedEvent))S.selectedEvent=S.events[0]?.id||null;
  renderEvents();
}
function renderEvents(){
  const g=$('#scenarioGrid'),map=$('#eventMapNodes'),detail=$('#eventDetailPanel');
  const cards=S.events.map((e,i)=>{
    const selected=e.id===S.selectedEvent;
    return '<button class="scenarioCard '+(selected?'selected':'')+'" data-id="'+esc(e.id)+'" data-event-id="'+esc(e.id)+'">'+
      '<span class="scenarioIndex">'+String(i+1).padStart(2,'0')+'</span>'+
      '<small>'+esc(e.genre)+' · '+esc(e.duration)+'</small>'+
      '<h3>'+esc(e.title)+'</h3>'+
      '<div class="eventMetaTop"><span class="dangerTier">'+tier(e)+'</span><span>Группа '+e.recommended_players+'/5</span><strong>'+money(e)+'</strong></div>'+
      '<p>'+esc(e.intro)+'</p>'+
      '<div><span>Лут T'+e.loot_tier+' · '+e.inventory_slots+' слотов</span><b>Выбрать →</b></div></button>';
  }).join('');
  if(g)g.innerHTML=cards;

  if(map){
    map.innerHTML=S.events.map((e,i)=>{
      const p=MAP_POSITIONS[i%MAP_POSITIONS.length],selected=e.id===S.selectedEvent,kind=eventClass(e);
      return '<button class="eventMapNode '+kind+' '+(selected?'selected':'')+'" style="--map-x:'+p[0]+'%;--map-y:'+p[1]+'%" data-event-id="'+esc(e.id)+'" aria-label="'+esc(e.title)+'">'+
        '<span class="nodePulse"></span><span class="nodeGlyph">'+eventGlyph(e)+'</span><span class="nodeCopy"><b>'+esc(e.title)+'</b><small>'+tier(e)+' · '+e.recommended_players+'/5 · '+money(e)+'</small></span></button>';
    }).join('');
  }

  const e=selectedEvent();
  if(detail&&e){
    const fixed='T'+e.danger_tier+' · фиксированная';
    detail.innerHTML=
      '<div class="eventDetailVisual '+eventClass(e)+'"><div class="eventDetailBadge">'+eventGlyph(e)+'</div><div><small>ВЫБРАННОЕ СОБЫТИЕ</small><h3>'+esc(e.title)+'</h3><p>'+esc(e.genre)+'</p></div></div>'+
      '<div class="eventDetailBody"><p class="eventIntro">'+esc(e.intro)+'</p>'+
      '<div class="eventStatGrid"><div><small>ОПАСНОСТЬ</small><b>'+tier(e)+'</b><span>'+fixed+'</span></div><div><small>ОТРЯД</small><b>'+e.recommended_players+'/5</b><span>можно идти меньшей группой</span></div><div><small>ДЛИТЕЛЬНОСТЬ</small><b>'+esc(e.duration)+'</b><span>ориентир</span></div><div><small>ВХОД</small><b>'+money(e)+'</b><span>'+esc(e.entry?.type||'event')+'</span></div></div>'+
      '<div class="eventRewardBox"><div><small>ПОТЕНЦИАЛ НАГРАДЫ</small><b>Loot Tier '+e.loot_tier+'</b></div><span>'+e.inventory_slots+' слотов рюкзака</span></div>'+
      '<div class="fixedWarning"><b>△ Сложность не масштабируется вниз</b><span>Меньшая группа получает больший риск и повышенную награду, а не более лёгких врагов.</span></div>'+
      '<button id="prepareSelectedEvent" class="goldBtn wide eventPrepareBtn">Подготовить экспедицию →</button></div>';
    const prep=document.getElementById('prepareSelectedEvent');
    if(prep)prep.onclick=()=>{document.querySelector('.setupBottom')?.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>$('#playerName')?.focus(),350)};
  }

  const count=$('#activeEventCount');if(count)count.textContent=S.events.length;
  $$('[data-event-id]').forEach(c=>c.onclick=()=>{S.selectedEvent=c.dataset.eventId;renderEvents();renderEventAccess()});
  renderEventAccess();
}
function selectedEvent(){return S.events.find(e=>e.id===S.selectedEvent)||null}
function renderEventAccess(){
  const e=selectedEvent(),box=$('#eventAccess');if(!box||!e)return;
  const free=e.entry?.type==='free',sub=S.profile?.subscription?.active,tickets=S.profile?.eventTickets||0;
  let status=free?'Свободный вход':sub?'Входит в подписку':tickets>0?'Будет списан 1 билет':'Нужна оплата/подписка';
  box.innerHTML='<small>ВХОД</small><b>'+money(e)+'</b><span>'+esc(status)+'</span><em>Сложность T'+e.danger_tier+' не меняется от размера группы</em>';
}
async function loadProfile(){
  if(!S.name)return;
  S.profile=await api('/api/profile?name='+encodeURIComponent(S.name));
  renderProfile();
}
function aliveCharacters(){return (S.profile?.characters||[]).filter(c=>c.status==='alive')}
function renderProfile(){
  if(!S.profile)return;
  ['walletBalance','econBalance'].forEach(id=>{const e=$('#'+id);if(e)e.textContent=S.profile.balance||0});
  if($('#walletBigBalance'))$('#walletBigBalance').textContent=(S.profile.balance||0)+' KAI';
  if($('#eventTickets'))$('#eventTickets').textContent=S.profile.eventTickets||0;
  if($('#subscriptionStatus'))$('#subscriptionStatus').textContent=S.profile.subscription?.active?'Активна':'Нет';
  if($('#slotUsage'))$('#slotUsage').textContent=(S.profile.usedSlots||0)+' / '+(S.profile.characterSlots||3);
  if($('#walletAddress'))$('#walletAddress').textContent='kai1…'+String(S.profile.id||'local').slice(-8);
  if($('#farmText'))$('#farmText').textContent=(S.profile.farmToday||0)+' / 60';
  if($('#farmFill'))$('#farmFill').style.width=Math.min(100,(S.profile.farmToday||0)/60*100)+'%';
  renderCharacterSelect();
  renderCharacterRoster();
  renderStash();
  renderTransactions();
  renderEventAccess();
}
function renderCharacterSelect(){
  const sel=$('#eventCharacterSelect');if(!sel||!S.profile)return;
  const current=S.profile.activeCharacterId||'';
  sel.innerHTML='<option value="">Создать нового в лобби</option>'+aliveCharacters().map(c=>
    '<option value="'+c.id+'" '+(c.id===current?'selected':'')+'>'+esc(c.name||c.archetype)+' · LVL '+c.level+' · '+esc(c.archetype)+'</option>'
  ).join('');
  sel.onchange=async()=>{if(!sel.value)return;try{S.profile=await api('/api/profile/select-character',{method:'POST',body:JSON.stringify({name:S.name,characterId:sel.value})});renderProfile()}catch(e){toast(e.message)}};
}
function charStatus(c){return c.status==='dead'?'ПОГИБ':('LVL '+c.level+' · XP '+(c.xp||0))}
function renderCharacterRoster(){
  const targets=[$('#characterRoster'),$('#characterRosterLobby')].filter(Boolean);if(!targets.length||!S.profile)return;
  const cards=(S.profile.characters||[]).map(c=>{
    const alive=c.status==='alive',active=c.id===S.profile.activeCharacterId;
    return '<div class="characterSlot '+(alive?'alive':'dead')+' '+(active?'active':'')+'"><div><small>'+charStatus(c)+'</small><b>'+esc(c.name||c.archetype)+'</b><span>'+esc(c.archetype)+' · '+esc(c.concept||'')+'</span></div>'+
      (alive?'<button class="softBtn mini chooseCharacter" data-id="'+c.id+'">'+(active?'Выбран':'Выбрать')+'</button>':'<em>Навсегда недоступен</em>')+'</div>';
  }).join('');
  const empty=Math.max(0,(S.profile.characterSlots||3)-(S.profile.usedSlots||0));
  const slots='<div class="slotSummary"><b>Живых слотов: '+(S.profile.usedSlots||0)+' / '+(S.profile.characterSlots||3)+'</b><span>Свободно: '+empty+'</span></div>';
  targets.forEach(t=>t.innerHTML=slots+cards);
  $$('.chooseCharacter').forEach(b=>b.onclick=async()=>{try{
    S.profile=await api('/api/profile/select-character',{method:'POST',body:JSON.stringify({name:S.name,characterId:b.dataset.id})});
    if(S.room){const d=await api('/api/rooms/'+S.room.code+'/select-character',{method:'POST',body:JSON.stringify({name:S.name,characterId:b.dataset.id})});S.room=d.room;S.profile=d.profile;renderRoom()}
    renderProfile();renderLoadout();
  }catch(e){toast(e.message)}});
}
function stashLabel(i){return i.stackable?(esc(i.name)+' ×'+(i.quantity||1)):(esc(i.name)+' · '+(i.rarity||''))}
function renderStash(){
  const g=$('#inventoryGrid');if(!g||!S.profile)return;
  const items=S.profile.inventory||[];
  g.innerHTML=items.length?items.map(i=>{
    if(i.kind==='equipment')return itemCard(i);
    return '<div class="stashStack"><small>'+esc(i.kind||'material')+'</small><b>'+esc(i.name)+'</b><strong>×'+(i.quantity||1)+'</strong><span>'+esc(i.catalogId||'')+'</span></div>';
  }).join(''):'<div class="emptyState">Склад пуст.</div>';
  bindItemInspector();
}
function renderTransactions(){
  const tx=$('#txList');if(!tx||!S.profile)return;
  const labels={market_buy:'Покупка',market_sale:'Продажа',market_list:'Выставлен лот',market_cancel:'Лот снят',craft:'Крафт',event_complete:'Приключение завершено',event_ticket:'Вход в приключение'};
  tx.innerHTML=(S.profile.transactions||[]).map(t=>'<div class="txRow"><div><b>'+esc(labels[t.type]||t.type)+'</b><small>'+new Date(t.at).toLocaleString()+'</small></div><strong class="'+((t.amount||0)>0?'positive':(t.amount||0)<0?'negative':'')+'">'+((t.amount||0)>0?'+':'')+(t.amount||0)+' KAI</strong></div>').join('')||'<div class="emptyState">Операций пока нет.</div>';
}

function itemCard(i,listing=null){
  const ench=(i.enchantments||[]).length?'<span class="enchantedMark">✦ '+i.enchantments.length+'</span>':'';
  return '<button class="itemCard rarity-'+esc(i.rarity||'common')+'" data-item="'+esc(i.id)+'">'+ench+
    '<small>'+esc(i.rarity||i.kind||'item')+' · LVL '+(i.level||1)+'</small><h4>'+esc(i.name)+'</h4><p>'+esc(i.slot||'')+' · power '+(i.power||0)+'</p>'+
    (listing?'<strong>'+listing.price+' KAI</strong>':'<span>'+esc(i.serial||'')+'</span>')+'</button>';
}
function bindItemInspector(){
  $$('.itemCard').forEach(c=>c.onclick=()=>{
    const i=(S.profile?.inventory||[]).find(x=>x.id===c.dataset.item);if(!i)return;
    const epic=['epic','relic','mythic'].includes(i.rarity);
    const ench=(i.enchantments||[]).map(x=>'<div class="enchantHistory"><b>'+esc(x.facility)+'</b><span>Q'+x.quality+' · '+x.effects.map(e=>esc(e.label)+' +'+e.value).join(', ')+'</span></div>').join('');
    $('#inspectorBody').innerHTML=(epic?'<div class="itemVisualCard">'+(i.visual?.url?'<img src="'+esc(i.visual.url)+'" alt="">':'<div class="visualPlaceholder"><span>✦</span><small>EPIC+ VISUAL</small></div>')+'</div>':'')+
      '<small>'+esc(i.rarity||'')+'</small><h2>'+esc(i.name)+'</h2><p>'+esc(i.lore||'')+'</p><p>'+esc(i.passive||'')+'</p>'+ench+'<code>'+esc(i.serial||'')+'</code>'+
      '<div class="itemActions">'+(epic&&!i.visual?.url?'<button id="genItemVisual" class="softBtn">✦ Visual card</button>':'')+'</div>'+
      '<div class="sellRow"><input id="sellPrice" type="number" min="1" placeholder="Цена KAI"><button id="sellItem" class="goldBtn">Выставить</button></div>';
    $('#itemInspector').classList.remove('hidden');
    const gv=document.getElementById('genItemVisual');
    if(gv)gv.onclick=async()=>{try{const d=await api('/api/items/'+i.id+'/visual',{method:'POST',body:JSON.stringify({name:S.name})});i.visual=d.visual;renderStash();$('#itemInspector').classList.add('hidden');toast('Visual card создана')}catch(e){toast(e.message)}};
    const sell=document.getElementById('sellItem');
    if(sell)sell.onclick=async()=>{const price=Number(document.getElementById('sellPrice')?.value);if(!price)return toast('Укажи цену');try{await api('/api/market/list',{method:'POST',body:JSON.stringify({name:S.name,itemId:i.id,price})});await loadProfile();await loadMarket();$('#itemInspector').classList.add('hidden');toast('Лот выставлен')}catch(e){toast(e.message)}};
  });
}

async function loadCrafting(){
  if(!S.crafting)S.crafting=await api('/api/crafting');
  const g=$('#craftGrid');if(!g||!S.profile)return;
  g.innerHTML=(S.crafting.recipes||[]).map(r=>{
    const cost=Object.entries(r.cost||{}).map(([id,n])=>esc(S.crafting.materials?.[id]?.name||id)+' ×'+n).join(' · ');
    return '<div class="craftCard"><small>РАСХОДНИК</small><h4>'+esc(r.name)+'</h4><p>'+cost+'</p><button class="goldBtn mini craftBtn" data-id="'+r.id+'">Создать</button></div>';
  }).join('');
  $$('.craftBtn',g).forEach(b=>b.onclick=async()=>{try{const d=await api('/api/profile/craft',{method:'POST',body:JSON.stringify({name:S.name,recipeId:b.dataset.id,quantity:1})});S.profile=d.profile;renderProfile();loadCrafting();toast('Создано: '+d.item.name)}catch(e){toast(e.message)}});
}

async function loadMarket(){
  const g=$('#marketGrid');if(!g)return;
  const a=await api('/api/market');
  g.innerHTML=a.length?a.map(l=>'<div class="marketCard">'+itemCard(l.item,l)+'<div class="sellerRow"><span>'+esc(l.sellerName)+'</span>'+
    (l.sellerId===S.profile?.id?'<button class="softBtn mini cancelBtn" data-id="'+l.id+'">Снять</button>':'<button class="goldBtn mini buyBtn" data-id="'+l.id+'">Купить</button>')+'</div></div>').join(''):'<div class="emptyState">Активных лотов нет.</div>';
  $$('.buyBtn',g).forEach(b=>b.onclick=async e=>{e.stopPropagation();try{const d=await api('/api/market/buy',{method:'POST',body:JSON.stringify({name:S.name,listingId:b.dataset.id})});S.profile=d.profile;renderProfile();loadMarket();toast('Предмет куплен')}catch(x){toast(x.message)}});
  $$('.cancelBtn',g).forEach(b=>b.onclick=async e=>{e.stopPropagation();try{const d=await api('/api/market/cancel',{method:'POST',body:JSON.stringify({name:S.name,listingId:b.dataset.id})});S.profile=d.profile;renderProfile();loadMarket();toast('Лот снят')}catch(x){toast(x.message)}});
}

function renderRoom(){
  if(!S.room)return;
  $('#lobbyCode').textContent=S.room.code||'';
  $('#lobbyScenario').textContent=(S.room.event||S.room.scenario)?.title||'KisAI World';
  $('#playerCount').textContent=(S.room.players?.length||0)+' / 5';
  $('#players').innerHTML=(S.room.players||[]).map(p=>'<div class="playerCard '+(p.ready?'ready':'')+'"><div class="playerAvatar">'+esc((p.name||'?')[0].toUpperCase())+'</div><div><b>'+esc(p.name)+'</b><small>'+(p.character?esc(p.character.name||p.character.archetype)+' · LVL '+p.character.level:'Нужен живой персонаж')+'</small></div><span>'+(p.ready?'ГОТОВ':'…')+'</span></div>').join('');
  renderCharacterRoster();
  renderLoadout();
}
function renderCharacterCard(c){
  if(!c){$('#charCard').innerHTML='';return}
  $('#charCard').innerHTML='<div class="generatedCharacter"><div class="charTitle"><small>LEVEL '+c.level+' · XP '+(c.xp||0)+'</small><h3>'+esc(c.name||c.archetype)+'</h3></div><p>'+esc(c.concept)+'</p><div class="skillGrid">'+Object.entries(c.skills||{}).map(([k,v])=>'<span><b>'+esc(k)+'</b><i>'+v+'</i></span>').join('')+'</div><div class="abilityList">'+(c.abilities||[]).map(a=>'<span>✦ '+esc(a)+'</span>').join('')+'</div></div>';
}
function myRoomPlayer(){return S.room?.players?.find(p=>p.id===S.profile?.id)||null}
function renderLoadout(){
  const g=$('#loadoutGrid');if(!g||!S.profile)return;
  const pl=myRoomPlayer(),capacity=pl?.capacity||6,pending=new Map((pl?.pendingLoadout||[]).map(x=>[x.itemId,x.quantity]));
  const items=S.profile.inventory||[];
  g.innerHTML=items.length?items.map(i=>{
    const qty=i.stackable?(i.quantity||1):1,chosen=pending.get(i.id)||0;
    return '<label class="loadoutPick"><input class="loadoutCheck" type="checkbox" data-id="'+i.id+'" '+(chosen?'checked':'')+'><div><b>'+stashLabel(i)+'</b><small>'+esc(i.kind||'equipment')+' · '+(i.slotCost||1)+' слот/шт</small></div>'+
      (i.stackable?'<input class="loadoutQty" data-id="'+i.id+'" type="number" min="1" max="'+qty+'" value="'+(chosen||1)+'">':'')+'</label>';
  }).join(''):'<div class="emptyState">На складе пока ничего нет.</div>';
  const usage=(pl?.pendingLoadout||[]).reduce((n,q)=>{const i=items.find(x=>x.id===q.itemId);return n+(i?(i.slotCost||1)*q.quantity:0)},0);
  if($('#loadoutUsage'))$('#loadoutUsage').textContent=usage+' / '+capacity;
}
async function saveLoadout(){
  const items=$$('.loadoutCheck:checked').map(c=>({itemId:c.dataset.id,quantity:Number(document.querySelector('.loadoutQty[data-id="'+c.dataset.id+'"]')?.value||1)}));
  try{const d=await api('/api/rooms/'+S.room.code+'/loadout',{method:'POST',body:JSON.stringify({name:S.name,items})});S.room=d.room;renderRoom();toast('Рюкзак сохранён: '+d.usage+' / '+d.capacity)}catch(e){toast(e.message)}
}

function renderGame(result=null){
  if(!S.room)return;
  const r=S.room,sc=r.scene||{},event=r.event||r.scenario;
  $('#sceneTitle').textContent=sc.title||event?.title||'Текущая сцена';
  $('#gmText').textContent=sc.narration||'';
  $('#gameScenarioLabel').textContent=(event?.title||'KISAI WORLD').toUpperCase()+' · T'+(event?.danger_tier||1);
  const progress=Math.round(r.progress||0);$('#runProgressText').textContent=progress+'%';$('#runProgressFill').style.width=progress+'%';$('#extractRun').disabled=progress<100||r.completed;
  $('#party').innerHTML=(r.players||[]).map((p,i)=>'<div class="partyMember '+(!p.alive?'dead':'')+'"><b>'+esc(p.name)+'</b><small>'+(p.character?esc(p.character.name||p.character.archetype)+' · '+p.wounds+'/3 раны':'Без героя')+'</small><span>'+(i===r.turnIndex?'ХОД':'')+'</span></div>').join('');
  const me=myRoomPlayer();
  if($('#myStats'))$('#myStats').innerHTML=me?'<small>ТВОЙ ГЕРОЙ</small><b>'+esc(me.character?.name||me.character?.archetype||'—')+'</b><span>Раны '+me.wounds+'/3 · Рюкзак '+me.runUsage+'/'+me.capacity+'</span>':'';
  renderRunInventory();
  renderSceneLoot();
  if(result?.dice)animateDice(result.dice);
  music(sc.music_state||'explore');
  renderPOV();
}
function animateDice(d){
  const box=$('#diceResult');if(!box)return;
  box.classList.remove('success','fail');box.classList.add('rolling');let n=0;
  const timer=setInterval(()=>{box.textContent='d20 '+(1+Math.floor(Math.random()*20));if(++n>7){clearInterval(timer);box.classList.remove('rolling');box.classList.add(d.success?'success':'fail');box.textContent='d20 '+d.die+' '+(d.modifier>=0?'+':'')+d.modifier+' = '+d.total+' / DC '+d.dc}},55);
}
function renderSceneLoot(){
  const box=$('#sceneLoot');if(!box)return;
  const items=(S.room?.scene?.loot||[]).filter(x=>x.status==='scene');
  box.innerHTML=items.length?'<p class="railLabel">ЛУТ СЦЕНЫ</p>'+items.map(i=>'<button class="sceneLootItem" data-id="'+i.id+'"><small>'+esc(i.kind||i.rarity||'loot')+'</small><b>'+esc(i.name)+'</b><span>Подобрать</span></button>').join(''):'';
  $$('.sceneLootItem',box).forEach(b=>b.onclick=async()=>{try{const d=await api('/api/rooms/'+S.room.code+'/loot/'+b.dataset.id+'/claim',{method:'POST',body:JSON.stringify({name:S.name})});S.room=d.room;S.profile=d.profile;renderGame();renderProfile();toast('Подобрано: '+d.item.name)}catch(e){toast(e.message)}});
}
function renderRunInventory(){
  const box=$('#runInventory');if(!box)return;
  const me=myRoomPlayer(),items=me?.runInventory||[];
  box.innerHTML=items.length?items.map(i=>'<div class="runItem"><div><small>'+esc(i.kind||i.rarity||'item')+'</small><b>'+esc(i.name)+(i.stackable?' ×'+(i.quantity||1):'')+'</b></div>'+(i.kind==='consumable'?'<button class="softBtn mini useRunItem" data-id="'+i.id+'">Использовать</button>':'')+'</div>').join(''):'<span class="muted">Пусто</span>';
  $$('.useRunItem',box).forEach(b=>b.onclick=async()=>{try{const d=await api('/api/rooms/'+S.room.code+'/use-item',{method:'POST',body:JSON.stringify({name:S.name,itemId:b.dataset.id})});S.room=d.room;renderGame();toast('Расходник использован')}catch(e){toast(e.message)}});
  const event=S.room?.event||S.room?.scenario,atForge=event?.enchantment&&me?.position?.anchorId===event.enchantment.anchor_id;
  if(atForge){
    const equipment=items.filter(x=>x.kind==='equipment'),ingredients=items.filter(x=>x.kind==='enchant_ingredient');
    if(equipment.length&&ingredients.length){
      box.insertAdjacentHTML('beforeend','<div class="enchantStation"><small>'+esc(event.enchantment.label)+'</small><b>Зачарование доступно · Q'+event.enchantment.tier+'</b><select id="enchantTarget">'+equipment.map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join('')+'</select><div id="enchantIngredients">'+ingredients.map(x=>'<label><input type="checkbox" class="enchIng" value="'+x.id+'"> '+esc(x.name)+' ×'+(x.quantity||1)+'</label>').join('')+'</div><button id="enchantNow" class="goldBtn mini">Зачаровать</button></div>');
      const btn=document.getElementById('enchantNow');if(btn)btn.onclick=async()=>{const targetId=document.getElementById('enchantTarget').value,ingredientIds=[...document.querySelectorAll('.enchIng:checked')].map(x=>x.value);try{const d=await api('/api/rooms/'+S.room.code+'/enchant',{method:'POST',body:JSON.stringify({name:S.name,targetId,ingredientIds})});S.room=d.room;renderGame();toast(d.success?'Зачарование успешно · d20 '+d.roll.die:'Зачарование провалено · d20 '+d.roll.die)}catch(e){toast(e.message)}};
    }
  }
}
async function renderPOV(){
  if(!S.room||!S.name)return;
  try{const p=await api('/api/rooms/'+S.room.code+'/pov?name='+encodeURIComponent(S.name)),box=$('#log');if(!box)return;box.innerHTML='<div class="povCard"><small>PERSONAL POV</small><b>'+esc(p.camera.anchorId||'scene')+'</b><span>'+p.visibleAnchors.map(a=>esc(a.label)).join(' · ')+'</span></div>'}catch{}
}
function applyTurn(d){
  S.room=d.room;S.profile=d.profile;renderProfile();renderGame(d);
  if(d.deathDrop?.length)toast('Персонаж погиб. В сцене осталось '+d.deathDrop.length+' предметов.');
  else if(d.transcript)toast('Распознано: '+d.transcript.slice(0,80));
  else if(d.drops?.length)toast('Найдено: '+d.drops.map(x=>x.name).join(', '));
  if(d.speechBase64){try{const a=new Audio('data:'+(d.speechMime||'audio/mpeg')+';base64,'+d.speechBase64);if(S.audio)S.audio.volume=S.volume*.25;a.onended=()=>{if(S.audio)S.audio.volume=S.volume};a.play().catch(()=>{})}catch{}}
}

async function music(name){
  if(!name||S.music===name)return;S.music=name;if($('#musicTitle'))$('#musicTitle').textContent=name;
  let m={};try{m=await fetch('/audio/music_manifest.json').then(r=>r.json())}catch{}const e=m[name];if(!e?.file)return;
  const n=new Audio(e.file);n.loop=true;n.volume=S.volume;n.play().catch(()=>{});if(S.audio)S.audio.pause();S.audio=n;
}
function blobBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(blob)})}
function setupVoice(){
  const btn=$('#ptt');if(!btn||!navigator.mediaDevices||!window.MediaRecorder){if(btn)btn.onclick=()=>toast('Запись микрофона не поддерживается');return}
  let rec=null,chunks=[],stream=null,started=0;
  const begin=async e=>{e.preventDefault();if(rec?.state==='recording'||!S.room)return;try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});chunks=[];rec=new MediaRecorder(stream);started=Date.now();
    rec.ondataavailable=x=>{if(x.data.size)chunks.push(x.data)};
    rec.onstop=async()=>{btn.classList.remove('recording');stream?.getTracks().forEach(t=>t.stop());if(Date.now()-started<350)return toast('Слишком короткая запись');try{
      const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'}),audioBase64=await blobBase64(blob);
      const d=await api('/api/rooms/'+S.room.code+'/voice-turn',{method:'POST',body:JSON.stringify({name:S.name,audioBase64,mimeType:blob.type||'audio/webm'})});applyTurn(d);
    }catch(x){toast(x.message==='stt_not_configured'?'Настрой STT API в ⚙ AI':x.message)}};
    rec.start();btn.classList.add('recording');
  }catch{toast('Нет доступа к микрофону')}};
  const end=e=>{e?.preventDefault();if(rec?.state==='recording')rec.stop()};
  btn.addEventListener('pointerdown',begin);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
}
function econTab(name){
  show('economy');$$('.econTab').forEach(e=>e.classList.toggle('active',e.dataset.tab===name));$$('.econPane').forEach(e=>e.classList.remove('active'));
  const pane=document.getElementById('econ'+name[0].toUpperCase()+name.slice(1));pane?.classList.add('active');
  if(name==='market')loadMarket();if(name==='craft')loadCrafting();
}

async function init(){
  $('#playerName').value=S.name;$('#joinName').value=S.name;
  if(S.name)await loadProfile();await loadEvents();startRotationClock();music('menu');

  $('#brandBtn').onclick=()=>show('home');
  $('#hostBtn').onclick=()=>show('setup');
  $('#joinBtn').onclick=()=>show('join');
  $('#economyBtn').onclick=()=>econTab('hero');
  $('#demoTourBtn').onclick=()=>modal('#tour');
  $('#installBtn').onclick=()=>modal('#install');
  $$('.back').forEach(b=>b.onclick=()=>show('home'));
  $$('.navBtn[data-nav]').forEach(b=>b.onclick=async()=>{if(b.dataset.nav==='setup'){if(S.name)await loadProfile();await loadEvents()}show(b.dataset.nav)});
  $$('.navBtn[data-econ]').forEach(b=>b.onclick=()=>econTab(b.dataset.econ));
  $$('.econTab').forEach(b=>b.onclick=()=>econTab(b.dataset.tab));

  $('#createRoom').onclick=async()=>{try{
    setName($('#playerName').value);await loadProfile();
    const characterId=$('#eventCharacterSelect').value||null;
    const d=await api('/api/rooms',{method:'POST',body:JSON.stringify({name:S.name,eventId:S.selectedEvent,characterId})});
    S.room=d.room;S.profile=d.profile;renderProfile();renderRoom();await wait();show('lobby');music('lobby');
  }catch(e){toast(e.message)}};
  $('#joinRoom').onclick=async()=>{try{
    setName($('#joinName').value);await loadProfile();const code=$('#roomCode').value.trim().toUpperCase();
    const d=await api('/api/rooms/'+code+'/join',{method:'POST',body:JSON.stringify({name:S.name,characterId:S.profile.activeCharacterId})});
    S.room=d.room;S.profile=d.profile;renderProfile();renderRoom();await wait();show('lobby');music('lobby');
  }catch(e){toast(e.message==='room_not_found'?'Комната не найдена':e.message)}};

  $('#genChar').onclick=async()=>{try{
    const d=await api('/api/rooms/'+S.room.code+'/character',{method:'POST',body:JSON.stringify({name:S.name,wish:$('#charWish').value,appearance:$('#charAppearance').value})});
    S.room=d.room;S.profile=d.profile;renderProfile();renderRoom();renderCharacterCard(d.character);$('#saveChar').disabled=false;toast('Новый персонаж занял слот');
  }catch(e){toast(e.message==='character_slots_full'?'Все живые слоты заняты':e.message)}};
  $('#saveChar').onclick=()=>toast('Персонаж выбран');
  $('#saveLoadout').onclick=saveLoadout;
  $('#startGame').onclick=async()=>{try{
    S.room=await api('/api/rooms/'+S.room.code+'/start',{method:'POST',body:'{}'});renderGame();await wait(550);show('game');
  }catch(e){toast(e.message==='payment_required'?'У одного из игроков нет доступа к событию':e.message)}};

  $('#sendText').onclick=async()=>{const input=$('#textTurn'),action=input.value.trim();if(!action)return;input.value='';try{applyTurn(await api('/api/rooms/'+S.room.code+'/turn',{method:'POST',body:JSON.stringify({name:S.name,action})}))}catch(e){toast(e.message)}};
  $('#textTurn').onkeydown=e=>{if(e.key==='Enter')$('#sendText').click()};
  $('#extractRun').onclick=async()=>{try{const d=await api('/api/rooms/'+S.room.code+'/extract',{method:'POST',body:JSON.stringify({name:S.name})});S.room=d.room;S.profile=d.profile;renderProfile();renderGame();const mine=d.rewards.find(x=>x.profileId===S.profile.id);toast(mine?'Эвакуация успешна · +'+mine.xp+' XP · '+mine.unique.length+' уник. предметов':'Приключение завершено')}catch(e){toast(e.message==='objectives_incomplete'?'Сначала заверши цели: '+(e.data?.progress||0)+'%':e.message)}};
  $('#copyLink').onclick=()=>navigator.clipboard?.writeText(location.origin+'?room='+(S.room?.code||'')).then(()=>toast('Ссылка скопирована'));

  $('#settingsBtn').onclick=async()=>{modal('#settings');const c=await api('/api/config');$('#llmUrl').value=c.llm?.base_url||'';$('#llmModel').value=c.llm?.model||'';$('#sttModel').value=c.stt?.model||'';$('#ttsProvider').value=c.tts?.provider||'openai';$('#ttsModel').value=c.tts?.model||'';$('#ttsVoice').value=c.tts?.voice||'';$('#imgEnabled').checked=!!c.image?.enabled;$('#imgModel').value=c.image?.model||'';$('#musicVolume').value=Math.round(S.volume*100)};
  $('#saveSettings').onclick=async()=>{S.volume=Number($('#musicVolume').value)/100;localStorage.setItem('kisai.musicVolume',String(Math.round(S.volume*100)));if(S.audio)S.audio.volume=S.volume;await api('/api/config',{method:'POST',body:JSON.stringify({llm:{base_url:$('#llmUrl').value,model:$('#llmModel').value,api_key:$('#llmKey').value},stt:{model:$('#sttModel').value,api_key:$('#sttKey').value},tts:{provider:$('#ttsProvider').value,model:$('#ttsModel').value,voice:$('#ttsVoice').value,api_key:$('#ttsKey').value},image:{enabled:$('#imgEnabled').checked,model:$('#imgModel').value,api_key:$('#imgKey').value}})});modal('#settings',false);toast('Настройки сохранены')};
  $('#closeSettings').onclick=()=>modal('#settings',false);$('#closeTour').onclick=()=>modal('#tour',false);$('#closeInstall').onclick=()=>modal('#install',false);$('#closeInspector').onclick=()=>$('#itemInspector').classList.add('hidden');$('#refreshMarket').onclick=loadMarket;

  const q=new URLSearchParams(location.search).get('room');if(q){show('join');$('#roomCode').value=q.toUpperCase()}
  setupVoice();
}
init().catch(e=>{console.error(e);toast('Ошибка запуска: '+e.message)});
