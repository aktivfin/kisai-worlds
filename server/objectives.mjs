export function initialObjectives(scene) {
  const destination=scene.geometry.anchors.at(-1);
  return [
    {id:'reach_destination',type:'ReachArea',anchorId:destination.id,state:'ACTIVE',required:true,progress:0,completionConditions:{anchorId:destination.id}},
    {id:'defeat_threat',type:'KillTarget',state:'ACTIVE',required:false,progress:0,completionConditions:{allHostilesDead:true}}
  ];
}

export function updateObjectives(room) {
  for(const objective of room.objectives||[]) {
    if(!['ACTIVE','LOCKED'].includes(objective.state))continue;
    if(objective.type==='ReachArea'&&[...room.players.values()].some(p=>p.alive&&p.position?.anchorId===objective.anchorId)){
      objective.state='COMPLETED';objective.progress=1;
    }
    if(objective.type==='KillTarget'&&room.scene.combatants.every(n=>n.status==='dead')){
      objective.state='COMPLETED';objective.progress=1;
    }
  }
}

export function objectivesComplete(room) {
  return (room.objectives||[]).filter(x=>x.required).every(x=>x.state==='COMPLETED'||x.state==='complete');
}

export function migrateObjectives(room) {
  for(const x of room.objectives||[]) {
    if(x.type==='reach_anchor')x.type='ReachArea';
    if(x.type==='defeat_threat')x.type='KillTarget';
    if(x.state==='pending')x.state='ACTIVE';
    if(x.state==='complete')x.state='COMPLETED';
    x.progress=x.state==='COMPLETED'?1:0;
    x.completionConditions||=x.type==='ReachArea'?{anchorId:x.anchorId}:{allHostilesDead:true};
  }
}
