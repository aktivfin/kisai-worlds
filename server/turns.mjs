export function startTurns(room,now=Date.now()) {
  room.turnOrder=[...room.players.values()].filter(p=>p.alive).sort((a,b)=>(b.character?.combat?.initiative||0)-(a.character?.combat?.initiative||0)).map(p=>p.id);
  room.turnCursor=0;room.round=1;
  setTurnTimer(room,now);
}
export function currentPlayer(room) { return room.turnOrder?.[room.turnCursor]||null; }
export const TIMER_POLICY={EXPLORATION:null,DIALOGUE:45000,COMBAT:60000,REACTION:12000,TRAP:8000,CRITICAL:7000};
export function setTurnTimer(room,now=Date.now()) {
  const playerId=currentPlayer(room);
  const type=room.nextTimerType||'COMBAT';room.nextTimerType=null;
  const duration=TIMER_POLICY[type];
  room.timer=playerId&&duration?{timerType:type,playerId,startedAt:now,deadlineAt:now+duration}:null;
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
