import {distance,visibleWorldItem} from './world-items.mjs';

export function perceive(room,profileId) {
  const player=room.players.get(profileId);
  if(!player)throw new Error('player_not_in_room');
  const position=player.position||{x:0,y:0,z:0,eyeHeight:1.7};
  const radius=room.scene.geometry?.visibilityRadius||15;
  const anchors=(room.scene.geometry?.anchors||[]).filter(a=>!a.hidden&&distance(position,a)<=radius);
  const visibleNpc=(room.scene.combatants||[]).filter(n=>!n.hidden&&distance(position,n.position)<=radius);
  const visibleIds=new Set(visibleNpc.map(n=>n.id));
  const visibleLoot=(room.scene.loot||[]).filter(item=>visibleWorldItem(item,room.scene,player));
  const knownLog=(room.log||[]).filter(event=>{
    if(event.visibility==='private')return event.profileId===profileId;
    const eventPosition=event.position||room.players.get(event.profileId)?.position;
    if(eventPosition&&event.profileId!==profileId&&distance(position,eventPosition)>radius)return false;
    if(event.npcId)return visibleIds.has(event.npcId);
    if(event.itemId)return visibleLoot.some(x=>x.id===event.itemId)||event.profileId===profileId;
    return !event.hidden;
  }).slice(0,20);
  const camera={x:position.x,y:position.y,z:(position.z||0)+(position.eyeHeight||1.7),eyeHeight:position.eyeHeight||1.7,anchorId:position.anchorId};
  const latestActor=room.players.get((room.log||[]).find(e=>e.actor&&e.profileId)?.profileId);
  const narration=latestActor&&latestActor.id!==profileId&&distance(position,latestActor.position)>radius?'За пределами видимости слышно движение.':room.scene.narration;
  return {camera,visibleAnchors:anchors,visibleNpc,visibleLoot,knownLog,narration,
    hiddenAnchorCount:Math.max(0,(room.scene.geometry?.anchors?.length||0)-anchors.length)};
}

export function filterVoiceEvents(room,profileId,events=[],actorId=null) {
  const view=perceive(room,profileId),npcIds=new Set(view.visibleNpc.map(n=>n.id));
  const actor=room.players.get(actorId),recipient=room.players.get(profileId);
  const audible=!actor||actorId===profileId||Math.hypot((actor.position?.x||0)-(recipient.position?.x||0),(actor.position?.y||0)-(recipient.position?.y||0))<=(room.scene.geometry?.visibilityRadius||15);
  return events.filter(e=>e.speakerType==='TIMER'||((e.speakerType!=='NPC'||npcIds.has(e.speakerId))&&(['GM','PLAYER','SYSTEM'].includes(e.speakerType)?audible:true)))
    .filter(e=>!e.recipientId||e.recipientId===profileId);
}
