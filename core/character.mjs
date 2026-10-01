import {deriveCombat,normalizeAttributes} from './combat.mjs';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const slug=s=>String(s||'ability').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,'_').replace(/^_|_$/g,'').slice(0,48)||'ability';

export function defaultAttributes(archetype='',concept=''){
  const text=(archetype+' '+concept).toLowerCase();
  const out={strength:1,agility:1,endurance:1,perception:1,intelligence:1,charisma:0};
  if(/маг|аркан|тех|анал|учён/.test(text)){out.intelligence=3;out.perception=2;out.strength=0}
  if(/страж|танк|щит|сила|воин/.test(text)){out.strength=3;out.endurance=3;out.charisma=0}
  if(/след|луч|скрыт|вор|развед/.test(text)){out.agility=3;out.perception=3;out.endurance=0}
  if(/лидер|диплом|харизм|оратор/.test(text)){out.charisma=3;out.perception=2}
  return normalizeAttributes(out);
}

export function inferDynamicSkills(concept='',archetype=''){
  const t=(concept+' '+archetype).toLowerCase(),out=[];
  const add=(id,name,rank,attribute)=>{if(!out.some(x=>x.id===id))out.push({id,name,rank,attribute})};
  if(/скрыт|тень|вор|развед/.test(t))add('stealth','Скрытность',2,'agility');
  if(/мед|леч|хирург/.test(t))add('medicine','Медицина',2,'intelligence');
  if(/горн|шахт|руда/.test(t))add('mining','Горное дело',2,'strength');
  if(/стрел|баллист|лук|винтов/.test(t))add('ballistics','Баллистика',2,'agility');
  if(/некром|маг|аркан|ритуал/.test(t))add('arcana','Аркана',2,'intelligence');
  if(/пилот|кораб|машин/.test(t))add('piloting','Пилотирование',2,'agility');
  if(/карман|краж|вор/.test(t))add('pickpocket','Карманная кража',2,'agility');
  if(/угрож|запуг|страх/.test(t))add('intimidation','Запугивание',2,'charisma');
  if(!out.length)add('adaptation','Адаптация',1,'perception');
  return out;
}

export function resourcePoolForFantasy(fantasy=''){
  const t=String(fantasy||'').toLowerCase();
  if(/проклят|curse|cursed/.test(t))return{id:'cursed_energy',label:'Проклятая энергия'};
  if(/мана|mana|аркан|маг|некром|ритуал/.test(t))return{id:'mana',label:'Мана'};
  if(/ярост|rage/.test(t))return{id:'rage',label:'Ярость'};
  if(/простран|энерг|телепорт|псих|молни|огн|плам/.test(t))return{id:'technique_energy',label:'Энергия техники'};
  return{id:'energy',label:'Энергия'};
}

export function resourceBaseMax(level=1){
  const lvl=clamp(Number(level)||1,1,50);
  return 6+Math.floor((lvl-1)/5);
}

export function ensureCharacterResources(character){
  character.combat=character.combat||deriveCombat(character.attributes||{},character.level||1);
  character.combat.resources=character.combat.resources&&typeof character.combat.resources==='object'?character.combat.resources:{};
  for(const ability of character.abilities||[]){
    if(!ability?.resource?.pool)continue;
    const poolId=ability.resource.pool,meta=resourcePoolForFantasy(ability.fantasy||ability.name||poolId),existing=character.combat.resources[poolId];
    const baseMax=resourceBaseMax(character.level||1),upgradeLevel=Math.max(0,Number(existing?.upgradeLevel)||0),max=Math.max(Number(existing?.max)||0,baseMax+upgradeLevel*2);
    character.combat.resources[poolId]={
      id:poolId,label:existing?.label||ability.resource.label||meta.label,current:Math.min(Number.isFinite(Number(existing?.current))?Number(existing.current):max,max),
      max,baseMax,upgradeLevel,refill:'expedition_start'
    };
  }
  return character.combat.resources;
}

export function refillCharacterResources(character){
  const resources=ensureCharacterResources(character);
  for(const pool of Object.values(resources))pool.current=pool.max;
  return resources;
}

export function abilityResourceState(character,ability){
  if(!ability?.resource?.pool||!(Number(ability.resource.cost)>0))return{required:false,cost:0,pool:null};
  const resources=ensureCharacterResources(character),pool=resources[ability.resource.pool],cost=Math.max(1,Math.floor(Number(ability.resource.cost)||1));
  return{required:true,cost,pool};
}

export function spendAbilityResource(character,ability){
  const state=abilityResourceState(character,ability);if(!state.required)return{spent:0,pool:null};
  if(!state.pool||state.pool.current<state.cost){const e=new Error('insufficient_resource');e.pool=state.pool?.id||ability.resource.pool;e.required=state.cost;e.current=state.pool?.current||0;throw e}
  state.pool.current-=state.cost;
  return{spent:state.cost,poolId:state.pool.id,label:state.pool.label,current:state.pool.current,max:state.pool.max};
}

export function upgradeResourcePool(character,poolId){
  materializeCharacterCore(character);const resources=ensureCharacterResources(character),pool=resources[poolId];if(!pool)throw new Error('resource_pool_not_found');
  pool.upgradeLevel=(Number(pool.upgradeLevel)||0)+1;pool.max=resourceBaseMax(character.level||1)+pool.upgradeLevel*2;pool.baseMax=resourceBaseMax(character.level||1);pool.current=pool.max;
  return{...pool};
}

export function abilityBudget(level=1){
  const lvl=clamp(Number(level)||1,1,50);
  return{damage:8+Math.floor((lvl-1)/3)*2,control:1+Math.floor((lvl-1)/5),area:1+Math.floor((lvl-1)/6),range:10+Math.floor((lvl-1)/4)*5};
}

export function balanceAbilityFantasy(fantasy='Основной приём',level=1){
  const name=String(fantasy||'Основной приём').slice(0,64),t=name.toLowerCase(),budget=abilityBudget(level);
  let damage='1d8',range=Math.min(10,budget.range),targets=1,cooldown=0,cost=null,control=null,damageType='physical',attackAttribute='agility',skill=null,resource=null;
  if(/разрез|реж|клин|меч/.test(t)){damageType=/простран/.test(t)?'spatial_slash':'slashing';skill=/простран|маг|проклят/.test(t)?'Аркана':null}
  if(/огн|плам/.test(t))damageType='fire';
  if(/молот|дроб|кулак/.test(t)){damageType='blunt';attackAttribute='strength'}
  if(/стрел|лук|винтов|пистолет/.test(t)){damageType='piercing';skill='Баллистика';range=Math.min(20,budget.range+10)}
  if(/облак|взрыв|волна|все|область|aoe/.test(t)){damage='1d6';targets=Math.min(3,budget.area+1)}
  if(/замед|оглуш|стан|silence|немот/.test(t)){damage='1d6';control={type:/оглуш|стан/.test(t)?'stun':'slow',value:1}}
  if(/уничтож|аннигил|12d20|смерт|ваншот|реальност/.test(t)){damage='1d8';cooldown=1}
  if(/мощн|сильн|усилен|burst/.test(t)){damage='1d10';cooldown=Math.max(cooldown,2)}
  const powered=/простран|проклят|curse|cursed|маг|аркан|мана|некром|ритуал|телепорт|псих|молни|огн|плам|энерг/.test(t);
  if(powered){
    const pool=resourcePoolForFantasy(t),expensive=targets>1||damage==='1d10'||/уничтож|аннигил|реальност|мощн|усилен/.test(t);
    resource={pool:pool.id,label:pool.label,cost:expensive?2:1};
  }
  return{id:slug(name),name,fantasy:name,type:'active_attack',actionCost:1,range,targets,damage,damageType,attackAttribute,skill,accuracy:0,minDamage:damageType==='spatial_slash'?1:0,control,cooldown,cost,resource,budgetVersion:'v0.2'};
}

function oldStat(character,label,fallback=1){
  const n=Number(character?.skills?.[label]);
  return Number.isFinite(n)?clamp(n-2,-3,4):fallback;
}

export function materializeCharacterCore(character={}){
  if(character.coreVersion==='0.2'&&character.attributes&&character.combat){ensureCharacterResources(character);return character;}
  const attrs=character.attributes?normalizeAttributes(character.attributes):normalizeAttributes({
    strength:oldStat(character,'Сила',defaultAttributes(character.archetype,character.concept).strength),
    agility:oldStat(character,'Ловкость',defaultAttributes(character.archetype,character.concept).agility),
    endurance:oldStat(character,'Выносливость',1),
    perception:oldStat(character,'Восприятие',defaultAttributes(character.archetype,character.concept).perception),
    intelligence:oldStat(character,'Интеллект',defaultAttributes(character.archetype,character.concept).intelligence),
    charisma:oldStat(character,'Харизма',defaultAttributes(character.archetype,character.concept).charisma)
  });
  character.attributes=attrs;
  const oldAbilities=Array.isArray(character.abilities)?character.abilities:[];
  character.abilities=oldAbilities.length&&typeof oldAbilities[0]==='object'?oldAbilities.map(a=>({...balanceAbilityFantasy(a.name||a.fantasy,character.level),...a})):oldAbilities.map(x=>balanceAbilityFantasy(x,character.level));
  if(!character.abilities.length)character.abilities=[balanceAbilityFantasy(character.concept||'Основной приём',character.level)];
  if(!Array.isArray(character.dynamicSkills))character.dynamicSkills=inferDynamicSkills(character.concept,character.archetype);
  if(!character.combat)character.combat=deriveCombat(attrs,character.level);
  else{const derived=deriveCombat(attrs,character.level);character.combat={...derived,...character.combat,hp_max:Math.max(character.combat.hp_max||0,derived.hp_max),hp_current:Math.min(character.combat.hp_current??derived.hp_current,Math.max(character.combat.hp_max||0,derived.hp_max))}}
  character.injuries=Array.isArray(character.injuries)?character.injuries:[];
  character.developmentPoints=Math.max(0,Number(character.developmentPoints)||0);
  ensureCharacterResources(character);
  character.coreVersion='0.2';
  return character;
}

export function createNpcCombatant({id='enemy',name='Противник',tier=1,evasion=null,armor=null,hp=null}={}){
  const t=clamp(Number(tier)||1,1,5),attributes=normalizeAttributes({strength:Math.min(4,t),agility:Math.min(4,Math.max(0,t-1)),endurance:Math.min(4,t),perception:Math.min(4,t-1),intelligence:0,charisma:0});
  const combat=deriveCombat(attributes,t);combat.hp_max=hp||12+t*5;combat.hp_current=combat.hp_max;combat.evasion=evasion||clamp(9+t,7,16);
  const baseArmor=armor??clamp(Math.floor((t+1)/2),1,4);
  return{id,name,kind:'hostile',status:'alive',level:t,attributes,combat,dynamicSkills:[],abilities:[balanceAbilityFantasy('Удар',t)],injuries:[],equipment:{chest:{id:id+'_armor',type:'armor',name:'Броня '+name,baseArmor,armor:baseArmor,durability:100,condition:'intact',material:['steel'],damage:[]}}};
}

export function maxDynamicSkillRank(level=1){
  return clamp(1+Math.ceil(clamp(Number(level)||1,1,50)/3),1,4);
}

export function recordSkillUse(character,{name,attribute='perception',success=false}={}){
  if(!character||!name)return null;
  materializeCharacterCore(character);
  const skillName=String(name).trim().slice(0,40);if(!skillName)return null;
  const key=slug(skillName),gain=success?2:1;
  character.skillPractice=character.skillPractice&&typeof character.skillPractice==='object'?character.skillPractice:{};
  const entry=character.skillPractice[key]||{name:skillName,attribute,count:0};
  entry.attribute=attribute||entry.attribute||'perception';entry.count=(Number(entry.count)||0)+gain;character.skillPractice[key]=entry;
  let skill=(character.dynamicSkills||[]).find(x=>String(x.id||x.name).toLowerCase()===key||String(x.name).toLowerCase()===skillName.toLowerCase());
  if(!skill&&entry.count>=4){
    skill={id:key,name:skillName,rank:1,attribute:entry.attribute};character.dynamicSkills.push(skill);entry.count-=4;
    return{type:'learned',skill:{...skill},practice:entry.count};
  }
  if(skill){
    const cap=maxDynamicSkillRank(character.level),threshold=5+(Number(skill.rank)||0)*3;
    if(entry.count>=threshold&&(Number(skill.rank)||0)<cap){
      entry.count-=threshold;skill.rank=(Number(skill.rank)||0)+1;
      return{type:'rank_up',skill:{...skill},practice:entry.count,cap};
    }
  }
  return{type:'practice',skill:skill?{...skill}:null,practice:entry.count};
}

export function maxAbilitySlots(level=1){
  return clamp(2+Math.floor((clamp(Number(level)||1,1,50)-1)/5),2,6);
}

export function evolveAbilityDefinition(character,{abilityId=null,idea='',mode='modify'}={}){
  materializeCharacterCore(character);
  const fantasy=String(idea||'').trim();if(!fantasy)throw new Error('ability_idea_required');
  const abilities=character.abilities||[],balanced=balanceAbilityFantasy(fantasy,character.level||1);
  if(mode==='new'){
    if(abilities.length>=maxAbilitySlots(character.level))throw new Error('ability_slots_full');
    const next={...balanced,revision:1,evolutionHistory:[{from:null,idea:fantasy,level:character.level||1}]};
    abilities.push(next);ensureCharacterResources(character);return next;
  }
  const index=abilities.findIndex(x=>x.id===abilityId);if(index<0)throw new Error('ability_not_found');
  const prev=abilities[index],history=Array.isArray(prev.evolutionHistory)?prev.evolutionHistory:[];
  const next={...balanced,id:prev.id,revision:(Number(prev.revision)||1)+1,evolutionHistory:[...history,{from:prev.name,idea:fantasy,level:character.level||1}].slice(-12)};
  abilities[index]=next;ensureCharacterResources(character);return next;
}
