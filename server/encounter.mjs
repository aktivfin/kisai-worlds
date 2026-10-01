import {resolveAttack} from '../core/combat.mjs';
import {balanceAbilityFantasy} from '../core/character.mjs';
import {distance} from './world-items.mjs';

// One deterministic environment phase follows every committed player action.
// The narrator sees its result but cannot select or execute NPC mechanics.
export function reactToPlayerAction(room,{nextD20,defenderFor,dropInventory}) {
  const events=[];let firstAttack=null,deathDrop=[];
  const anchors=room.scene.geometry?.anchors||[];
  for(const npc of room.scene.combatants||[]) {
    if(npc.status==='dead'||npc.status==='fled')continue;
    if(npc.conditions?.stun>0){events.push({type:'NPC_STUNNED',npcId:npc.id});npc.conditions.stun--;continue;}
    const targets=[...room.players.values()].filter(p=>p.alive).sort((a,b)=>distance(npc.position,a.position)-distance(npc.position,b.position));
    const target=targets[0];if(!target)break;
    const ability=npc.abilities?.[0]||balanceAbilityFantasy('Удар',npc.level||1);
    const range=ability.name==='Удар'?2:Math.max(1,Math.min(30,Number(ability.range)||2));
    if(distance(npc.position,target.position)>range){
      const from=anchors.findIndex(a=>a.id===npc.position?.anchorId),to=anchors.findIndex(a=>a.id===target.position?.anchorId);
      if(from>=0&&to>=0&&from!==to){const next=anchors[from+Math.sign(to-from)];npc.position={x:next.x,y:next.y,z:next.z||0,anchorId:next.id};events.push({type:'NPC_MOVED',npcId:npc.id,to:next.id});}
      continue;
    }
    const defender=defenderFor(target),accuracy=(ability.accuracy||0)-(npc.conditions?.slow>0?2:0);
    const attack=resolveAttack({attacker:npc,defender,ability:{...ability,accuracy},targetArea:'torso',aimed:false,attackDie:nextD20(),damageRng:max=>1+Math.floor(Math.random()*max)});
    if(!firstAttack)firstAttack=attack;
    events.push({type:'NPC_ATTACKED',npcId:npc.id,profileId:target.id,combat:attack});
    if(defender.combat?.hp_current<=0)deathDrop.push(...dropInventory(room,target.profile));
    if(npc.conditions?.slow>0)npc.conditions.slow--;
  }
  return {events,counterattack:firstAttack,deathDrop};
}
