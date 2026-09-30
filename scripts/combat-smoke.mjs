import assert from 'node:assert/strict';
import {resolveAttack,effectiveArmor,targetedEvasion,conditionLabel} from '../core/combat.mjs';
import {balanceAbilityFantasy,materializeCharacterCore,recordSkillUse,maxDynamicSkillRank} from '../core/character.mjs';
import {spawn} from 'node:child_process';

{
  const armor={id:'cuirass',type:'armor',baseArmor:4,durability:100,material:['steel'],damage:[]};
  const defender={level:1,attributes:{agility:0,endurance:1},combat:{hp_current:18,hp_max:18,evasion:10},equipment:{chest:armor},injuries:[]};
  const attacker=materializeCharacterCore({level:1,archetype:'Арканист',concept:'пространственный Разрез',abilities:['Разрез пространства']});
  const result=resolveAttack({attacker,defender,ability:{...attacker.abilities[0],damage:'1d8'},attackDie:20,damageRng:()=>8,targetArea:'torso'});
  assert.equal(result.hit,true);
  assert.equal(result.damage.raw,8);
  assert.equal(result.armor.before,4);
  assert.equal(result.damage.hp,4);
  assert.equal(defender.combat.hp_current,14);
  assert.ok(armor.durability<100,'armor must wear when absorbing damage');
}

{
  const armor={id:'cuirass',type:'armor',baseArmor:4,durability:100,material:['steel'],damage:[]};
  const defender={combat:{hp_current:18,hp_max:18,evasion:10},equipment:{chest:armor},injuries:[]};
  const attacker=materializeCharacterCore({level:1,concept:'короткий клинок',abilities:['Удар клинком']});
  const result=resolveAttack({attacker,defender,ability:{...attacker.abilities[0],damage:'1d3',damageType:'slashing'},attackDie:20,damageRng:()=>3});
  assert.equal(result.damage.hp,0,'armor 4 must fully stop raw damage 3');
  assert.ok(armor.durability<100,'blocked hit must still wear armor');
}

{
  const armor={baseArmor:4,durability:100,material:['steel'],damage:[{area:'breach',kind:'cut',severity:'deep'}]};
  assert.equal(effectiveArmor(armor,'breach'),2,'deep damaged area must reduce local armor');
  assert.equal(targetedEvasion(10,'breach',true),14,'aiming at a breach must be harder');
}

{
  assert.equal(conditionLabel(100),'intact');
  assert.equal(conditionLabel(55),'damaged');
  assert.equal(conditionLabel(10),'critical');
  assert.equal(conditionLabel(0),'destroyed');
  const absurd=balanceAbilityFantasy('Уничтожение реальности 12d20 гарантированно',1);
  assert.equal(absurd.damage,'1d8','fantasy wording must not bypass level-1 budget');
  const aoe=balanceAbilityFantasy('Облако разрезов вокруг меня',1);
  assert.equal(aoe.damage,'1d6');
  assert.ok(aoe.targets>1);
  const learner=materializeCharacterCore({level:1,concept:'обычный путешественник',abilities:['Удар']});
  const before=learner.dynamicSkills.length;
  for(let n=0;n<4;n++)recordSkillUse(learner,{name:'Медицина',attribute:'intelligence',success:false});
  const learned=learner.dynamicSkills.find(x=>x.name==='Медицина');
  assert.equal(learner.dynamicSkills.length,before+1,'repeated relevant actions should create a dynamic skill');
  assert.equal(learned.rank,1);
  assert.equal(maxDynamicSkillRank(1),2);
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const child=spawn(process.execPath,['server.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,KISAI_TEST_DICE:'20,20'}});
let stderr='';child.stderr.on('data',d=>stderr+=d);
const raw=async(path,options={})=>{
  const r=await fetch('http://127.0.0.1:8787'+path,{headers:{'content-type':'application/json'},...options});let data=null;try{data=await r.json()}catch{}
  return{ok:r.ok,status:r.status,data};
};
const request=async(path,options={})=>{const r=await raw(path,options);if(!r.ok)throw new Error(path+' -> '+r.status+' '+JSON.stringify(r.data));return r.data};
const post=(path,value)=>request(path,{method:'POST',body:JSON.stringify(value)});

try{
  let health=null;for(let i=0;i<50&&!health;i++){try{health=await request('/api/health')}catch{await sleep(100)}}if(!health)throw new Error('server did not start: '+stderr);
  const events=await request('/api/events'),event=events.find(x=>x.entry?.type==='free')||events[0];
  const name='Combat CI Hero';
  const created=await post('/api/rooms',{name,eventId:event.id});
  const code=created.room.code;
  const made=await post('/api/rooms/'+code+'/character',{name,wish:'пространственный мечник. Главная способность — Разрез пространства',appearance:'тёмный плащ'});
  assert.equal(made.character.coreVersion,'0.1');
  assert.ok(made.character.attributes&&made.character.combat);
  assert.equal(typeof made.character.abilities[0],'object');
  const started=await post('/api/rooms/'+code+'/start',{});
  const enemy=started.scene.combatants?.[0];assert.ok(enemy&&enemy.combat?.hp_max>0,'canonical scene must expose a hostile combatant');
  const beforeDurability=enemy.equipment.chest.durability;
  const playerHpBefore=started.players[0].character.combat.hp_current;
  const attack=await post('/api/rooms/'+code+'/combat/attack',{name,action:'Режу противника Разрезом в повреждённое место брони',targetId:enemy.id,targetArea:'breach',aimed:true});
  assert.equal(attack.combat.hit,true);
  assert.equal(attack.combat.attack.die,20);
  assert.ok(attack.combat.attack.evasion>enemy.combat.evasion,'aimed attack must raise hit threshold');
  assert.ok(attack.room.scene.combatants[0].equipment.chest.durability<beforeDurability,'runtime attack must persist armor wear');
  assert.ok(attack.counterattack&&attack.counterattack.hit,'living enemy should resolve a deterministic counterattack');
  const playerAfter=attack.room.players[0];assert.ok(playerAfter.character.combat.hp_current<playerHpBefore,'counterattack must reduce authoritative player HP');
  assert.ok(attack.room.log?.[0]?.combat&&attack.room.log?.[0]?.counterattack,'room log must contain both sides of the combat exchange');
  console.log('Combat core PASS',{enemy:enemy.name,attack:attack.combat.attack,damage:attack.combat.damage,armor:attack.combat.armor?.before});
}finally{child.kill('SIGTERM')}
