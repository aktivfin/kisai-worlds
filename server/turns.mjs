export function startTurns(room,now=Date.now()) {
  room.turnOrder=[...room.players.values()].filter(p=>p.alive).sort((a,b)=>(b.character?.combat?.initiative||0)-(a.character?.combat?.initiative||0)).map(p=>p.id);
  room.turnCursor=0;room.round=1;
  setTurnTimer(room,now);
}
export function currentPlayer(room) { return room.turnOrder?.[room.turnCursor]||null; }
export function setTurnTimer(room,now=Date.now()) {
  const playerId=currentPlayer(room);
  room.timer=playerId?{timerType:'combat',playerId,startedAt:now,deadlineAt:now+60000}:null;
}
export function assertTurn(room,actorId,now=Date.now()) {
  if(currentPlayer(room)!==actorId)throw new Error('not_your_turn');
  if(room.timer&&now>room.timer.deadlineAt)throw new Error('turn_expired');
}
export function advanceTurn(room,now=Date.now()) {
  if(!room.turnOrder?.length)return;
  for(let i=0;i<room.turnOrder.length;i++) {
    room.turnCursor++;
    if(room.turnCursor>=room.turnOrder.length){room.turnCursor=0;room.round=(room.round||1)+1;}
    if(room.players.get(currentPlayer(room))?.alive){setTurnTimer(room,now);return;}
  }
  room.timer=null;
}
