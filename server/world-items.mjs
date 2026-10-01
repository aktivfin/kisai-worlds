export function distance(a,b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0),(a.z||0)-(b.z||0));
}

export function placeWorldItem(item, scene, position, {droppedBy=null, claimRadius=2}={}) {
  item.world={id:item.world?.id||`world_${item.id}`,itemInstanceId:item.id,sceneId:scene.id,
    position:{x:position.x,y:position.y,z:position.z||0},anchorId:position.anchorId||null,
    claimRadius,droppedBy,droppedAt:new Date().toISOString(),ownerId:null,state:'available',visibility:'public'};
  item.status='scene';item.ownerId=null;
  scene.loot.push(item);
  return item;
}

export function visibleWorldItem(item, scene, player) {
  if(item.status!=='scene'||item.world?.state!=='available'||item.world.sceneId!==scene.id)return false;
  if(item.hidden||item.world.visibility==='hidden')return false;
  const radius=scene.geometry?.visibilityRadius||15;
  return distance(player.position,item.world.position)<=radius;
}

export function assertPickup(item, scene, player, usage, cost) {
  if(!item||item.status!=='scene'||item.world?.state!=='available'||item.world.sceneId!==scene.id)throw new Error('loot_not_found');
  if(!visibleWorldItem(item,scene,player))throw new Error('loot_not_visible');
  if(distance(player.position,item.world.position)>item.world.claimRadius)throw new Error('loot_out_of_range');
  if(usage+cost>player.capacity)throw new Error('run_inventory_full');
}

export function migrateWorldItems(scene) {
  for(const item of scene.loot||[])if(!item.world){
    const anchor=scene.geometry?.anchors?.find(a=>a.id===item.anchorId)||scene.geometry?.anchors?.[0]||{x:0,y:0,z:0};
    item.world={id:`world_${item.id}`,itemInstanceId:item.id,sceneId:scene.id,
      position:{x:anchor.x,y:anchor.y,z:anchor.z||0},anchorId:anchor.id||null,
      claimRadius:2,droppedBy:null,droppedAt:null,ownerId:null,state:item.status==='scene'?'available':'lost',visibility:item.hidden?'hidden':'public'};
  }
}
