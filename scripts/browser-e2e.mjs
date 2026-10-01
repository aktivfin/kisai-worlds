import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { atomicWrite, loadState } from '../server/persistence.mjs';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kisai-browser-'));
const state=path.join(temp,'state.json'),config=path.join(temp,'config.json');
const port=20000+Math.floor(Math.random()*30000),origin=`http://127.0.0.1:${port}`;
const settings=JSON.parse(fs.readFileSync('data/config.example.json'));settings.port=port;atomicWrite(config,settings);
let child,browser;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function launch(){
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,KISAI_STATE_FILE:state,KISAI_CONFIG_FILE:config,KISAI_PORT:String(port)},stdio:'ignore'});
  for(let n=0;n<100;n++){try{if((await fetch(origin+'/api/health')).ok)return}catch{}await sleep(50)}
  throw new Error('browser test server did not start');
}
async function stop(){if(!child)return;const c=child;child=null;c.kill();await new Promise(resolve=>{c.once('exit',resolve);setTimeout(resolve,1500)})}
try {
  await launch();browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const host=await browser.newContext(),guest=await browser.newContext(),A=await host.newPage(),B=await guest.newPage();
  await Promise.all([A.goto(origin),B.goto(origin)]);
  await A.locator('#hostBtn').click();await B.locator('#joinBtn').click();
  await A.locator('#playerName').fill('Browser Host');
  await A.locator('#createRoom').click();
  await A.locator('#lobby.screen.active').waitFor();
  const code=(await A.locator('#lobbyCode').textContent()).trim();assert.match(code,/^[A-F0-9]{6}$/);
  await B.locator('#joinName').fill('Browser Guest');await B.locator('#roomCode').fill(code);await B.locator('#joinRoom').click();
  await B.locator('#lobby.screen.active').waitFor();
  await A.locator('#players').getByText('Browser Guest').waitFor(); // Push, no reload.
  await A.locator('#charWish').fill('следопыт');await A.locator('#genChar').click();
  await B.locator('#charWish').fill('страж');await B.locator('#genChar').click();
  await A.locator('#startGame:not([disabled])').waitFor();
  assert.equal(await B.locator('#startGame').isDisabled(),true);
  const guestToken=await B.evaluate(()=>localStorage.getItem('kisai.session'));
  const denied=await B.request.post(origin+`/api/rooms/${code}/start`,{headers:{authorization:'Bearer '+guestToken},data:{}});
  assert.equal(denied.status(),403);
  await A.locator('#startGame').click();await A.locator('#game.screen.active').waitFor();await B.locator('#game.screen.active').waitFor();
  const aToken=await A.evaluate(()=>localStorage.getItem('kisai.session'));
  const stateBefore=await (await A.request.get(origin+`/api/rooms/${code}`,{headers:{authorization:'Bearer '+aToken}})).json();
  const actor=stateBefore.turnOrder[stateBefore.turnCursor]===stateBefore.players.find(x=>x.name==='Browser Host').id?A:B;
  const spectator=actor===A?B:A,spectatorToken=actor===A?guestToken:aToken;
  assert.equal(await spectator.locator('#sendText').isDisabled(),true);
  const outOfTurn=await spectator.request.post(origin+`/api/rooms/${code}/turn`,{headers:{authorization:'Bearer '+spectatorToken},data:{action:'осматриваюсь'}});
  assert.equal(outOfTurn.status(),409);
  await actor.locator('#textTurn').fill('осматриваю помещение');await actor.locator('#sendText').click();
  await spectator.waitForFunction(()=>document.querySelector('#gmText')?.textContent.includes('осматриваю помещение'),null,{timeout:10000});
  await B.reload();await B.locator('#game.screen.active').waitFor();
  const restored=await (await B.request.get(origin+`/api/rooms/${code}`,{headers:{authorization:'Bearer '+guestToken}})).json();
  assert.equal(restored.turnIndex,1);
  await stop();
  const fixture=loadState(state,{}),room=fixture.rooms[code];
  room.scene.loot.push({id:'browser_loot_fixture',serial:'KW-BROWSER-FIXTURE',name:'Test Relic',kind:'equipment',slot:'charm',rarity:'rare',status:'scene',stackable:false,slotCost:1,provenance:[{type:'test_fixture'}]});
  room.progress=100;for(const objective of room.objectives)objective.state='complete';atomicWrite(state,fixture);
  await launch();await B.reload();await B.locator('#game.screen.active').waitFor();
  await A.locator('.sceneLootItem[data-id="browser_loot_fixture"]').waitFor({timeout:10000});
  await B.locator('.sceneLootItem[data-id="browser_loot_fixture"]').click();
  await A.locator('.sceneLootItem[data-id="browser_loot_fixture"]').waitFor({state:'detached',timeout:10000});
  await B.locator('#extractRun:not([disabled])').click();
  await A.waitForFunction(()=>document.querySelector('#extractRun')?.textContent.includes('Завершено'),null,{timeout:10000});
  console.log('Browser E2E PASS: join push, host authority, turn sync, refresh reconnect, loot claim and extraction sync');
} finally {await browser?.close();await stop();fs.rmSync(temp,{recursive:true,force:true})}
