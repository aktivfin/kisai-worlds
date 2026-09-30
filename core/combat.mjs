export const ATTRIBUTE_KEYS=['strength','agility','endurance','perception','intelligence','charisma'];

export const ATTRIBUTE_LABELS={
  strength:'Сила',agility:'Ловкость',endurance:'Выносливость',
  perception:'Восприятие',intelligence:'Интеллект',charisma:'Харизма'
};

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const int=n=>Number.isFinite(Number(n))?Math.trunc(Number(n)):0;

export function parseDice(expr='1d4'){
  const m=String(expr).trim().toLowerCase().match(/^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/);
  if(!m)throw new Error('invalid_dice');
  const count=clamp(int(m[1]),1,20),sides=clamp(int(m[2]),2,100),bonus=(m[3]==='-'?-1:1)*int(m[4]||0);
  return{count,sides,bonus};
}

export function rollDice(expr='1d4',rng=max=>1+Math.floor(Math.random()*max)){
  const d=parseDice(expr),rolls=[];let total=d.bonus;
  for(let i=0;i<d.count;i++){const v=clamp(int(rng(d.sides)),1,d.sides);rolls.push(v);total+=v}
  return{expr:String(expr),rolls,bonus:d.bonus,total};
}

export function normalizeAttributes(input={}){
  const out={};
  for(const key of ATTRIBUTE_KEYS)out[key]=clamp(int(input[key]),-3,4);
  return out;
}

export function deriveCombat(attributes={},level=1){
  const a=normalizeAttributes(attributes),lvl=clamp(int(level)||1,1,50);
  const hpMax=Math.max(6,14+a.endurance*2+(lvl-1)*2);
  return{hp_current:hpMax,hp_max:hpMax,evasion:clamp(10+a.agility,5,19),initiative:a.agility,resources:{}};
}

export function conditionLabel(durability=100){
  const d=clamp(Number(durability)||0,0,100);
  if(d<=0)return'destroyed';if(d<20)return'critical';if(d<40)return'badly_damaged';if(d<60)return'damaged';if(d<80)return'worn';return'intact';
}

export function armorMultiplier(durability=100){
  const d=clamp(Number(durability)||0,0,100);
  if(d<=0)return 0;if(d<20)return .25;if(d<40)return .5;if(d<60)return .7;if(d<80)return .85;return 1;
}

const AREA_AIM_PENALTY={torso:0,chest:0,abdomen:1,arm:2,leg:2,hand:4,head:4,neck:5,eye:7,breach:4};
const AREA_TO_SLOT={torso:'chest',chest:'chest',abdomen:'chest',arm:'arms',hand:'arms',leg:'legs',head:'head',neck:'chest',eye:'head',breach:'chest'};

export function targetedEvasion(baseEvasion=10,area='torso',aimed=false){
  return clamp(int(baseEvasion)+(aimed?(AREA_AIM_PENALTY[area]??3):0),5,25);
}

export function defectArmorPenalty(item,area='torso'){
  const defects=[...(item?.defects||[]),...(item?.damage||[])];
  let penalty=0;
  for(const d of defects){
    const text=typeof d==='string'?d:JSON.stringify(d);
    const t=text.toLowerCase();
    const areaHit=t.includes(String(area).toLowerCase())||area==='breach'||/разрез|пробит|трещ|breach|cut|hole/.test(t);
    if(areaHit)penalty=Math.max(penalty,/глуб|пробит|hole|breach|deep/.test(t)?2:1);
  }
  return penalty;
}

export function effectiveArmor(item,area='torso'){
  if(!item)return 0;
  const base=Math.max(0,int(item.baseArmor??item.armor??0)),scaled=Math.floor(base*armorMultiplier(item.durability??100));
  return Math.max(0,scaled-defectArmorPenalty(item,area));
}

function materialFactor(materials=[],damageType='physical'){
  const m=(Array.isArray(materials)?materials:[materials]).map(x=>String(x).toLowerCase());
  const type=String(damageType).toLowerCase();
  if(/acid|кисл/.test(type))return 1.6;
  if(/fire|огн/.test(type))return m.some(x=>/cloth|leather|ткан|кож/.test(x))?1.7:.35;
  if(/impact|blunt|дроб|молот/.test(type))return m.some(x=>/steel|iron|металл|сталь/.test(x))?1.25:.9;
  if(/space|spatial|простран/.test(type))return 1.35;
  if(/pierc|колющ|arrow|стрел/.test(type))return m.some(x=>/plate|steel|iron|плит|сталь/.test(x))?.55:1;
  if(/slash|cut|реж/.test(type))return m.some(x=>/plate|steel|iron|плит|сталь/.test(x))?.7:1.05;
  return 1;
}

export function applyArmorWear(item,{rawDamage=0,hpDamage=0,damageType='physical',critical=false,area='torso'}={}){
  if(!item)return null;
  const factor=materialFactor(item.material||[],damageType);
  const blocked=Math.max(0,Number(rawDamage)-Number(hpDamage));
  const wear=clamp(Math.ceil((Math.max(1,rawDamage)*.55+blocked*.35)*(critical?1.35:1)*factor),1,28);
  const current=Number.isFinite(Number(item.durability))?Number(item.durability):100;item.durability=clamp(current-wear,0,100);
  item.condition=conditionLabel(item.durability);
  item.damage=Array.isArray(item.damage)?item.damage:[];
  if(rawDamage>=Math.max(4,(item.baseArmor||item.armor||0)+3)||critical){
    const kind=/impact|blunt|дроб|молот/.test(String(damageType).toLowerCase())?'dent':'cut';
    item.damage.push({area,kind,severity:critical?'deep':'moderate'});
    item.damage=item.damage.slice(-8);
  }
  return{wear,durability:item.durability,condition:item.condition,effectiveArmor:effectiveArmor(item,area)};
}

export function applyWeaponWear(item,{targetArmor=0,damageType='physical',critical=false}={}){
  if(!item)return null;
  const materials=item.material||[];
  const hardContact=targetArmor>0&&/slash|cut|pierc|impact|physical|реж|кол|дроб/.test(String(damageType).toLowerCase());
  const factor=hardContact?materialFactor(materials,'impact'):.25;
  const wear=clamp(Math.ceil((hardContact?2:1)*factor*(critical?1.5:1)),1,8);
  const current=Number.isFinite(Number(item.durability))?Number(item.durability):100;item.durability=clamp(current-wear,0,100);
  item.condition=conditionLabel(item.durability);
  item.defects=Array.isArray(item.defects)?item.defects:[];
  if(item.durability<60&&!item.defects.includes('dulled_edge')&&/weapon/.test(item.type||item.kind||'weapon'))item.defects.push('dulled_edge');
  if(item.durability<=0&&!item.defects.includes('broken'))item.defects.push('broken');
  return{wear,durability:item.durability,condition:item.condition,broken:item.durability<=0};
}


export function weaponConditionModifiers(item){
  if(!item)return{accuracy:0,damageBonus:0,broken:false};
  const d=clamp(Number(item.durability)??100,0,100),base=int(item.damageBonus||0);
  if(d<=0)return{accuracy:-4,damageBonus:0,broken:true};
  if(d<20)return{accuracy:-2,damageBonus:Math.max(0,base-3),broken:false};
  if(d<40)return{accuracy:-1,damageBonus:Math.max(0,base-2),broken:false};
  if(d<60)return{accuracy:0,damageBonus:Math.max(0,base-1),broken:false};
  return{accuracy:0,damageBonus:base,broken:false};
}

export function skillRank(character,skillName){
  if(!skillName)return 0;
  const key=String(skillName).toLowerCase();
  const dynamic=Array.isArray(character?.dynamicSkills)?character.dynamicSkills:[];
  const found=dynamic.find(x=>String(x.name||x.id).toLowerCase()===key);
  if(found)return int(found.rank||0);
  const skills=character?.skills||{};
  if(Array.isArray(skills))return int(skills.find(x=>String(x.name||x.id).toLowerCase()===key)?.rank||0);
  return int(skills[skillName]??skills[key]??0);
}

export function resolveCheck({character,attribute='perception',skill=null,dc=10,die=10,bonus=0}={}){
  const attrs=normalizeAttributes(character?.attributes||{}),d=clamp(int(die),1,20),modifier=(attrs[attribute]||0)+skillRank(character,skill)+int(bonus);
  const total=d+modifier,critical=d===20,criticalFail=d===1,success=critical||(!criticalFail&&total>=dc);
  return{die:d,attribute,skill,modifier,dc,total,success,critical,criticalFail};
}

function armorForArea(defender,area){
  const slot=AREA_TO_SLOT[area]||'chest',eq=defender?.equipment||{};
  return eq[slot]||eq.chest||null;
}

export function resolveAttack({
  attacker,defender,ability={},targetArea='torso',aimed=false,
  attackDie=10,damageRng,weapon=null
}={}){
  if(!attacker||!defender)throw new Error('combatants_required');
  const attrs=normalizeAttributes(attacker.attributes||{}),attackAttribute=ability.attackAttribute||ability.attribute||'agility';
  const skill=ability.skill||null,damageType=String(ability.damageType||'physical').toLowerCase(),weaponApplies=Boolean(weapon)&&!/spatial|space|magic|psychic|fire|acid|простран|маг|псих|огн|кисл/.test(damageType),weaponMods=weaponConditionModifiers(weaponApplies?weapon:null);
  const accuracy=int(ability.accuracy||0)+(attrs[attackAttribute]||0)+skillRank(attacker,skill)+weaponMods.accuracy;
  const evasion=targetedEvasion(defender.combat?.evasion??10,targetArea,aimed),die=clamp(int(attackDie),1,20);
  const total=die+accuracy,critical=die===20,criticalFail=die===1,hit=critical||(!criticalFail&&total>=evasion);
  const base={type:'attack',hit,critical,criticalFail,attack:{die,accuracy,total,evasion,attribute:attackAttribute,skill},targetArea,aimed,abilityId:ability.id||null,abilityName:ability.name||'Атака'};
  if(!hit)return{...base,damage:null,armor:null,injury:null,defenderHp:defender.combat?.hp_current??null};

  const damageExpr=weaponApplies&&weapon?.baseDamage?weapon.baseDamage:(ability.damage||'1d4');
  const damageRoll=rollDice(damageExpr,damageRng),rawDamage=Math.max(0,damageRoll.total+int(ability.damageBonus||0)+weaponMods.damageBonus+(critical?int(ability.criticalBonus||0):0));
  const armorItem=armorForArea(defender,targetArea),armorBefore=effectiveArmor(armorItem,targetArea);
  const minDamage=clamp(int(ability.minDamage||0),0,rawDamage),hpDamage=Math.max(minDamage,rawDamage-armorBefore);
  defender.combat=defender.combat||deriveCombat(defender.attributes||{},defender.level||1);
  defender.combat.hp_current=clamp((defender.combat.hp_current??defender.combat.hp_max)-hpDamage,0,defender.combat.hp_max);
  const armorWear=applyArmorWear(armorItem,{rawDamage,hpDamage,damageType:ability.damageType||'physical',critical,area:targetArea});
  const weaponWear=applyWeaponWear(weaponApplies?weapon:null,{targetArmor:armorBefore,damageType:ability.damageType||'physical',critical});
  let injury=null;
  const severe=hpDamage>=Math.max(5,Math.ceil((defender.combat.hp_max||10)*.25));
  if(hpDamage>0&&(critical||severe||aimed&&hpDamage>=3)){
    injury={id:'injury_'+Date.now().toString(36),area:targetArea,severity:critical||hpDamage>=8?'severe':'moderate',type:/slash|cut|space|реж|простран/.test(String(ability.damageType).toLowerCase())?'cut':'trauma'};
    defender.injuries=Array.isArray(defender.injuries)?defender.injuries:[];defender.injuries.push(injury);
  }
  const killed=defender.combat.hp_current<=0;if(killed)defender.status='dead';
  return{...base,damage:{...damageRoll,raw:rawDamage,absorbed:Math.min(rawDamage,armorBefore),hp:hpDamage,type:ability.damageType||'physical'},armor:{before:armorBefore,itemId:armorItem?.id||null,wear:armorWear},weapon:{applied:weaponApplies,itemId:weaponApplies?weapon?.id||null:null,condition:weaponApplies?weaponMods:null,wear:weaponWear},weaponWear,injury,defenderHp:defender.combat.hp_current,killed};
}
