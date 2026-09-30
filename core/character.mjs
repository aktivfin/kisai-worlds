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

export function abilityBudget(level=1){
  const lvl=clamp(Number(level)||1,1,50);
  return{damage:8+Math.floor((lvl-1)/3)*2,control:1+Math.floor((lvl-1)/5),area:1+Math.floor((lvl-1)/6),range:10+Math.floor((lvl-1)/4)*5};
}

export function balanceAbilityFantasy(fantasy='Основной приём',level=1){
  const name=String(fantasy||'Основной приём').slice(0,64),t=name.toLowerCase(),budget=abilityBudget(level);
  let damage='1d8',range=Math.min(10,budget.range),targets=1,cooldown=0,cost=null,control=null,damageType='physical',attackAttribute='agility',skill=null;
  if(/разрез|реж|клин|меч/.test(t)){damageType=/простран/.test(t)?'spatial_slash':'slashing';skill=/простран|маг/.test(t)?'Аркана':null}
  if(/огн|плам/.test(t))damageType='fire';
  if(/молот|дроб|кулак/.test(t)){damageType='blunt';attackAttribute='strength'}
  if(/стрел|лук|винтов|пистолет/.test(t)){damageType='piercing';skill='Баллистика';range=Math.min(20,budget.range+10)}
  if(/облак|взрыв|волна|все|область|aoe/.test(t)){damage='1d6';targets=Math.min(3,budget.area+1)}
  if(/замед|оглуш|стан|silence|немот/.test(t)){damage='1d6';control={type:/оглуш|стан/.test(t)?'stun':'slow',value:1}}
  if(/уничтож|аннигил|12d20|смерт|ваншот|реальност/.test(t)){damage='1d8';cooldown=1}
  if(/мощн|сильн|усилен|burst/.test(t)){damage='1d10';cooldown=Math.max(cooldown,2)}
  return{id:slug(name),name,fantasy:name,type:'active_attack',actionCost:1,range,targets,damage,damageType,attackAttribute,skill,accuracy:0,minDamage:damageType==='spatial_slash'?1:0,control,cooldown,cost,budgetVersion:'v0.1'};
}

function oldStat(character,label,fallback=1){
  const n=Number(character?.skills?.[label]);
  return Number.isFinite(n)?clamp(n-2,-3,4):fallback;
}

export function materializeCharacterCore(character={}){
  if(character.coreVersion==='0.1'&&character.attributes&&character.combat)return character;
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
  character.coreVersion='0.1';
  return character;
}

export function createNpcCombatant({id='enemy',name='Противник',tier=1,evasion=null,armor=null,hp=null}={}){
  const t=clamp(Number(tier)||1,1,5),attributes=normalizeAttributes({strength:Math.min(4,t),agility:Math.min(4,Math.max(0,t-1)),endurance:Math.min(4,t),perception:Math.min(4,t-1),intelligence:0,charisma:0});
  const combat=deriveCombat(attributes,t);combat.hp_max=hp||12+t*5;combat.hp_current=combat.hp_max;combat.evasion=evasion||clamp(9+t,7,16);
  const baseArmor=armor??clamp(Math.floor((t+1)/2),1,4);
  return{id,name,kind:'hostile',status:'alive',level:t,attributes,combat,dynamicSkills:[],abilities:[balanceAbilityFantasy('Удар',t)],injuries:[],equipment:{chest:{id:id+'_armor',type:'armor',name:'Броня '+name,baseArmor,armor:baseArmor,durability:100,condition:'intact',material:['steel'],damage:[]}}};
}
