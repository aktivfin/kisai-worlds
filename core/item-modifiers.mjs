const EFFECTS=new Set(['damage_bonus','armor_bonus','accuracy_bonus','skill_bonus','attribute_bonus','resource_bonus','resistance']);
export function itemModifier(item,type,context=null) {
  if(!item||Number(item.durability)===0)return 0;
  let total=0;
  for(const enchant of item.enchantments||[])for(const effect of enchant.effects||[]) {
    if(!EFFECTS.has(effect.type)||effect.type!==type)continue;
    if(context&&effect.context&&effect.context!==context)continue;
    total+=Math.max(0,Math.min(5,Math.floor(Number(effect.value)||0)));
  }
  for(const affix of item.affixes||[]) {
    if(type==='skill_bonus'&&affix.stat===context)total+=Math.max(0,Math.min(3,Math.floor(Number(affix.value)||0)));
    if(type==='attribute_bonus'&&affix.stat===context)total+=Math.max(0,Math.min(3,Math.floor(Number(affix.value)||0)));
  }
  return Math.min(10,total);
}
