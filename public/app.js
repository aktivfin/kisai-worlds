
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const S={room:null,profile:null,name:localStorage.getItem('kisai.name')||'',scenario:null,volume:Number(localStorage.getItem('kisai.musicVolume')||32)/100,audio:null,music:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(p,o={})=>{const r=await fetch(p,{headers:{'content-type':'application/json'},...o});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||d.message||('HTTP '+r.status));return d};
const toast=m=>{let e=$('#toast');if(!e)return;e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1800)};
const show=id=>{$$('.screen').forEach(e=>e.classList.toggle('active',e.id===id));$$('.navBtn').forEach(e=>e.classList.toggle('active',e.dataset.nav===id))};
const modal=(id,on=true)=>$(id)?.classList.toggle('hidden',!on);
const saveName=n=>{S.name=(n||'').trim()||'Игрок';localStorage.setItem('kisai.name',S.name)};
const wait=async t=>{let e=$('#transition');if(e)e.classList.add('active');await new Promise(r=>setTimeout(r,t||350));if(e)e.classList.remove('active')};

async function scenarios(){
  let a=await api('/api/scenarios'),g=$('#scenarioGrid'); S.scenario=a[0]?.id||null;
  if(!g)return;
  g.innerHTML=a.map((x,i)=>'<button class="scenarioCard '+(i?'':'selected')+'" data-id="'+esc(x.id)+'"><span class="scenarioIndex">0'+(i+1)+'</span><small>'+esc(x.genre)+' · '+esc(x.players)+'</small><h3>'+esc(x.title)+'</h3><p>'+esc(x.intro)+'</p><div><span>'+esc(x.duration)+'</span><b>Выбрать →</b></div></button>').join('');
  $$('.scenarioCard',g).forEach(c=>c.onclick=()=>{$$('.scenarioCard',g).forEach(x=>x.classList.remove('selected'));c.classList.add('selected');S.scenario=c.dataset.id});
}
function wallet(){
  if(!S.profile)return;
  ['walletBalance','econBalance'].forEach(id=>{let e=$('#'+id);if(e)e.textContent=S.profile.balance||0});
  if($('#walletBigBalance'))$('#walletBigBalance').textContent=(S.profile.balance||0)+' KAI';
  if($('#farmText'))$('#farmText').textContent=(S.profile.farmToday||0)+' / 60';
  if($('#farmFill'))$('#farmFill').style.width=Math.min(100,(S.profile.farmToday||0)/60*100)+'%';
  if($('#walletAddress'))$('#walletAddress').textContent='kai1…'+String(S.profile.id||'local').slice(-8);
}
async function profile(){if(!S.name)return;S.profile=await api('/api/profile?name='+encodeURIComponent(S.name));wallet();economy()}
function room(){
  if(!S.room)return;
  $('#lobbyCode').textContent=S.room.code||''; $('#lobbyScenario').textContent=S.room.scenario?.title||'KisAI World'; $('#playerCount').textContent=(S.room.players?.length||0)+' / 5';
  $('#players').innerHTML=(S.room.players||[]).map(p=>'<div class="playerCard '+(p.ready?'ready':'')+'"><div class="playerAvatar">'+esc((p.name||'?')[0].toUpperCase())+'</div><div><b>'+esc(p.name)+'</b><small>'+(p.character?esc(p.character.archetype):'Создаёт героя')+'</small></div><span>'+(p.ready?'ГОТОВ':'…')+'</span></div>').join('');
}
function character(c){
  $('#charCard').innerHTML='<div class="generatedCharacter"><div class="charTitle"><small>LEVEL '+c.level+'</small><h3>'+esc(c.archetype)+'</h3></div><p>'+esc(c.concept)+'</p><div class="skillGrid">'+Object.entries(c.skills||{}).map(([k,v])=>'<span><b>'+esc(k)+'</b><i>'+v+'</i></span>').join('')+'</div><div class="abilityList">'+(c.abilities||[]).map(a=>'<span>✦ '+esc(a)+'</span>').join('')+'</div><small class="weakness">Слабость: '+esc(c.weakness||'—')+'</small></div>';
}
const rarity=r=>({common:'Common',uncommon:'Uncommon',rare:'Rare',epic:'Epic',relic:'Relic',mythic:'Mythic'})[r]||r;
function card(i,listing){
  return '<button class="itemCard rarity-'+esc(i.rarity)+'" data-item="'+esc(i.id)+'"><small>'+rarity(i.rarity)+' · LVL '+i.level+'</small><h4>'+esc(i.name)+'</h4><p>'+esc(i.slot)+' · power '+i.power+'</p>'+(listing?'<strong>'+listing.price+' KAI</strong>':'<span>'+esc(i.serial)+'</span>')+'</button>';
}
function economy(){
  if(!S.profile)return;wallet();
  let inv=$('#inventoryGrid'); if(inv)inv.innerHTML=(S.profile.inventory||[]).map(i=>card(i)).join('')||'<div class="emptyState">Инвентарь пуст. Уникальный лут появляется в приключениях.</div>';
  let slots=['weapon','armor','charm','tool'],load=$('#heroLoadout');
  if(load)load.innerHTML=slots.map(s=>{let i=(S.profile.inventory||[]).find(x=>x.id===S.profile.equipped?.[s]);return '<div class="loadoutSlot"><small>'+s.toUpperCase()+'</small><b>'+(i?esc(i.name):'Пусто')+'</b><span>'+(i?rarity(i.rarity):'Нет предмета')+'</span></div>'}).join('');
  bindItems();
}
async function market(){
  let a=await api('/api/market'),g=$('#marketGrid'); if(!g)return;
  g.innerHTML=a.length?a.map(l=>'<div class="marketCard">'+card(l.item,l)+'<div class="sellerRow"><span>'+esc(l.sellerName)+'</span><button class="goldBtn mini buyBtn" data-id="'+l.id+'">Купить</button></div></div>').join(''):'<div class="emptyState">Активных лотов пока нет.</div>';
  $$('.buyBtn',g).forEach(b=>b.onclick=async e=>{e.stopPropagation();try{let d=await api('/api/market/buy',{method:'POST',body:JSON.stringify({name:S.name,listingId:b.dataset.id})});S.profile=d.profile;economy();await market();toast('Предмет куплен')}catch(x){toast(x.message)}});
}
function bindItems(){
  $$('.itemCard').forEach(c=>c.onclick=()=>{let i=(S.profile?.inventory||[]).find(x=>x.id===c.dataset.item);if(!i)return;$('#inspectorBody').innerHTML='<small>'+rarity(i.rarity)+'</small><h2>'+esc(i.name)+'</h2><p>'+esc(i.lore||'')+'</p><p>'+esc(i.passive||'')+'</p><code>'+esc(i.serial)+'</code><div class="sellRow"><input id="sellPrice" type="number" min="1" placeholder="Цена KAI"><button id="sellItem" class="goldBtn">Выставить</button></div>';$('#itemInspector').classList.remove('hidden');$('#sellItem').onclick=async()=>{let price=Number($('#sellPrice').value);if(!price)return toast('Укажи цену');try{await api('/api/market/list',{method:'POST',body:JSON.stringify({name:S.name,itemId:i.id,price})});await profile();await market();$('#itemInspector').classList.add('hidden');toast('Лот выставлен')}catch(x){toast(x.message)}}});
}
async function music(name){
  if(!name||S.music===name)return;S.music=name;if($('#musicTitle'))$('#musicTitle').textContent=name;
  let m={};try{m=await fetch('/audio/music_manifest.json').then(r=>r.json())}catch{}let e=m[name];if(!e?.file)return;
  let n=new Audio(e.file);n.loop=true;n.volume=S.volume;n.play().catch(()=>{});if(S.audio)S.audio.pause();S.audio=n;
}
function game(){
  let r=S.room;if(!r)return;let sc=r.scene||{};
  $('#sceneTitle').textContent=sc.title||r.scenario?.title||'Текущая сцена';$('#gmText').textContent=sc.narration||'';$('#gameScenarioLabel').textContent=(r.scenario?.title||'KISAI WORLD').toUpperCase();
  $('#party').innerHTML=(r.players||[]).map((p,i)=>'<div class="partyMember '+(p.alive===false?'dead':'')+'"><b>'+esc(p.name)+'</b><small>'+(p.character?esc(p.character.archetype):'Без героя')+'</small><span>'+(i===r.turnIndex?'ХОД':'')+'</span></div>').join('');
  if($('#myStats')&&S.profile)$('#myStats').innerHTML='<small>Твой герой</small><b>'+esc(S.profile.character?.archetype||'—')+'</b><span>'+S.profile.balance+' KAI</span>';
  let loot=$('#sceneLoot');
  if(loot){
    let items=(sc.loot||[]).filter(x=>x.status==='scene');
    loot.innerHTML=items.length?'<p class="railLabel">Лут сцены</p>'+items.map(i=>'<button class="sceneLootItem" data-id="'+i.id+'"><small>'+rarity(i.rarity)+'</small><b>'+esc(i.name)+'</b><span>Подобрать</span></button>').join(''):'';
    $('.sceneLootItem',loot).forEach(b=>b.onclick=async()=>{try{let d=await api('/api/rooms/'+S.room.code+'/loot/'+b.dataset.id+'/claim',{method:'POST',body:JSON.stringify({name:S.name})});S.room=d.room;S.profile=d.profile;game();economy();toast('Подобрано: '+d.item.name)}catch(x){toast(x.message)}});
  }
  music(sc.music_state||'explore');
}

function applyTurn(d){
  S.room=d.room;S.profile=d.profile;game();economy();
  if(d.deathDrop?.length)toast('Персонаж погиб. В сцене осталось предметов: '+d.deathDrop.length);
  else if(d.transcript)toast('Распознано: '+d.transcript.slice(0,90));
  else toast(d.loot?'Найдено: '+d.loot.name:(d.earned?'+'+d.earned+' KAI':'Ход выполнен'));
  if(d.speechBase64){
    try{let a=new Audio('data:'+(d.speechMime||'audio/mpeg')+';base64,'+d.speechBase64);if(S.audio)S.audio.volume=S.volume*.28;a.onended=()=>{if(S.audio)S.audio.volume=S.volume};a.play().catch(()=>{if(S.audio)S.audio.volume=S.volume})}catch{}
  }
}
function blobBase64(blob){return new Promise((resolve,reject)=>{let r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(blob)})}
function setupVoice(){
  let btn=$('#ptt');if(!btn||!navigator.mediaDevices||!window.MediaRecorder){if(btn)btn.onclick=()=>toast('Браузер не поддерживает запись микрофона');return}
  let rec=null,chunks=[],stream=null,started=0;
  const begin=async e=>{
    e.preventDefault();if(rec?.state==='recording'||!S.room)return;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      chunks=[];rec=new MediaRecorder(stream);started=Date.now();rec.ondataavailable=x=>{if(x.data.size)chunks.push(x.data)};
      rec.onstop=async()=>{
        btn.classList.remove('recording');if($('#voiceStatus'))$('#voiceStatus').innerHTML='<span></span>Распознаём речь…';
        stream?.getTracks().forEach(t=>t.stop());
        if(Date.now()-started<350)return toast('Слишком короткая запись');
        try{
          let blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'}),audioBase64=await blobBase64(blob);
          let d=await api('/api/rooms/'+S.room.code+'/voice-turn',{method:'POST',body:JSON.stringify({name:S.name,audioBase64,mimeType:blob.type||'audio/webm'})});
          applyTurn(d);
        }catch(x){toast(x.message==='stt_not_configured'?'Настрой STT API в ⚙ AI':x.message)}
        finally{if($('#voiceStatus'))$('#voiceStatus').innerHTML='<span></span>Ожидание хода'}
      };
      rec.start();btn.classList.add('recording');if($('#voiceStatus'))$('#voiceStatus').innerHTML='<span></span>Говори…';if(S.audio)S.audio.volume=S.volume*.28;
    }catch{toast('Не удалось получить доступ к микрофону')}
  };
  const end=e=>{e?.preventDefault();if(rec?.state==='recording')rec.stop();if(S.audio)S.audio.volume=S.volume};
  btn.addEventListener('pointerdown',begin);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
}
function econTab(n){show('economy');$$('.econTab').forEach(e=>e.classList.toggle('active',e.dataset.tab===n));$$('.econPane').forEach(e=>e.classList.remove('active'));let id='#econ'+n[0].toUpperCase()+n.slice(1);$(id)?.classList.add('active');if(n==='market')market()}

async function init(){
  $('#playerName').value=S.name;$('#joinName').value=S.name;await scenarios();if(S.name)await profile();music('menu');
  $('#hostBtn').onclick=()=>show('setup');$('#joinBtn').onclick=()=>show('join');$('#economyBtn').onclick=()=>econTab('hero');$('#demoTourBtn').onclick=()=>modal('#tour');$('#installBtn').onclick=()=>modal('#install');$('#brandBtn').onclick=()=>show('home');
  $$('.back').forEach(b=>b.onclick=()=>show('home'));$$('.navBtn[data-econ]').forEach(b=>b.onclick=()=>econTab(b.dataset.econ));$$('.econTab').forEach(b=>b.onclick=()=>econTab(b.dataset.tab));
  $('#createRoom').onclick=async()=>{try{saveName($('#playerName').value);let d=await api('/api/rooms',{method:'POST',body:JSON.stringify({name:S.name,scenarioId:S.scenario})});S.room=d.room;S.profile=d.profile;room();wallet();await wait();show('lobby');music('lobby')}catch(x){toast(x.message)}};
  $('#joinRoom').onclick=async()=>{try{saveName($('#joinName').value);let c=$('#roomCode').value.trim().toUpperCase(),d=await api('/api/rooms/'+c+'/join',{method:'POST',body:JSON.stringify({name:S.name})});S.room=d.room;S.profile=d.profile;room();await wait();show('lobby');music('lobby')}catch{x=>toast(x.message);toast('Комната не найдена')}};
  $('#genChar').onclick=async()=>{try{let d=await api('/api/rooms/'+S.room.code+'/character',{method:'POST',body:JSON.stringify({name:S.name,wish:$('#charWish').value,appearance:$('#charAppearance').value})});S.room=d.room;S.profile=d.profile;character(d.character);room();$('#saveChar').disabled=false;toast('Герой сбалансирован')}catch(x){toast(x.message)}};
  $('#saveChar').onclick=()=>toast('Герой выбран');$('#startGame').onclick=async()=>{try{S.room=await api('/api/rooms/'+S.room.code+'/start',{method:'POST',body:'{}'});game();await wait(550);show('game')}catch(x){toast(x.message)}};
  $('#sendText').onclick=async()=>{let a=$('#textTurn').value.trim();if(!a)return;$('#textTurn').value='';try{let d=await api('/api/rooms/'+S.room.code+'/turn',{method:'POST',body:JSON.stringify({name:S.name,action:a})});applyTurn(d)}catch(x){toast(x.message)}};
  $('#textTurn').onkeydown=e=>{if(e.key==='Enter')$('#sendText').click()};$('#copyLink').onclick=()=>navigator.clipboard?.writeText(location.origin+'?room='+(S.room?.code||'')).then(()=>toast('Ссылка скопирована'));
  $('#settingsBtn').onclick=async()=>{modal('#settings');let c=await api('/api/config');$('#llmUrl').value=c.llm?.base_url||'';$('#llmModel').value=c.llm?.model||'';$('#sttModel').value=c.stt?.model||'';$('#ttsProvider').value=c.tts?.provider||'openai';$('#ttsModel').value=c.tts?.model||'';$('#ttsVoice').value=c.tts?.voice||'';$('#imgEnabled').checked=!!c.image?.enabled;$('#imgModel').value=c.image?.model||'';$('#musicVolume').value=Math.round(S.volume*100)};
  $('#saveSettings').onclick=async()=>{S.volume=Number($('#musicVolume').value)/100;localStorage.setItem('kisai.musicVolume',String(Math.round(S.volume*100)));if(S.audio)S.audio.volume=S.volume;await api('/api/config',{method:'POST',body:JSON.stringify({llm:{base_url:$('#llmUrl').value,model:$('#llmModel').value,api_key:$('#llmKey').value},stt:{model:$('#sttModel').value,api_key:$('#sttKey').value},tts:{provider:$('#ttsProvider').value,model:$('#ttsModel').value,voice:$('#ttsVoice').value,api_key:$('#ttsKey').value},image:{enabled:$('#imgEnabled').checked,model:$('#imgModel').value,api_key:$('#imgKey').value}})});modal('#settings',false);toast('Настройки сохранены')};
  $('#closeSettings').onclick=()=>modal('#settings',false);$('#closeTour').onclick=()=>modal('#tour',false);$('#closeInstall').onclick=()=>modal('#install',false);$('#closeInspector').onclick=()=>$('#itemInspector').classList.add('hidden');$('#refreshMarket').onclick=market;
  let q=new URLSearchParams(location.search).get('room');if(q){show('join');$('#roomCode').value=q.toUpperCase()}
  setupVoice();
}
init().catch(e=>{console.error(e);toast('Ошибка запуска: '+e.message)});
