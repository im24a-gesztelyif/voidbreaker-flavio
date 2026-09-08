import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Compile the pure game modules without needing a browser or a test framework.
const directory = await mkdtemp(join(tmpdir(), 'voidbreaker-tests-'));
for (const name of ['types','content','simulation','multiplayer']) {
  const source = await readFile(new URL(`../lib/game/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  await writeFile(join(directory, `${name}.mjs`), outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"));
}
const { Simulation, loadSave } = await import(pathToFileURL(join(directory,'simulation.mjs')));
const { freshSave, UPGRADES } = await import(pathToFileURL(join(directory,'content.mjs')));
const { Multiplayer, cleanInput, neutralInput, guestView } = await import(pathToFileURL(join(directory,'multiplayer.mjs')));
after(() => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('voidbreaker-tests-'));
  return rm(directory, {recursive:true,force:true});
});
const input = (patch={}) => ({...neutralInput(),...patch});
const flight = (coop=false) => { const save=freshSave(); save.settings.autoFire=false; const s=new Simulation('kestrel','pulse',save,12345); if(coop)s.addPartner('wraith','rail',save);s.start();s.state.spawnTimer=1000;return s; };
const frames = (s,n,a=input(),b=input()) => { for(let i=0;i<n;i++)s.step(1/60,a,b); };

test('seeded simulation is deterministic', () => { const a=flight(),b=flight();frames(a,600,input({x:.2,firing:true}));frames(b,600,input({x:.2,firing:true}));assert.deepEqual(a.state,b.state); });
test('idle weapons cannot bank a burst of shots', () => {const s=flight();frames(s,360);frames(s,60,input({firing:true}));assert.ok(s.state.stats.shots>=6&&s.state.stats.shots<=7);});
test('two pilots move independently while the world clock advances once', () => {const s=flight(true);frames(s,60,input({x:-1}),input({x:1}));assert.ok(s.state.player.x < -15);assert.ok(s.state.partner.x > 20);assert.ok(Math.abs(s.state.totalTime-1)<.001);});
test('both pilots fire their own selected weapon', () => {const s=flight(true);frames(s,1,input({firing:true}),input({firing:true}));assert.equal(s.state.stats.shots,2);assert.deepEqual(new Set(s.state.bullets.map(b=>b.type)),new Set(['bolt','rail']));});
test('shared upgrades increment once and affect each ship', () => {const s=flight(true);s.applyUpgrade('damage');assert.equal(s.state.upgrades.damage,1);assert.equal(s.state.player.damage,1.2);assert.ok(Math.abs(s.state.partner.damage-1.38)<1e-8);});
test('dead pilots cannot move or fire; surviving pilot keeps the run alive', () => {const s=flight(true);s.state.player.hp=0;frames(s,60,input({x:1,firing:true}),input());assert.equal(s.state.phase,'playing');assert.equal(s.state.player.x,-5);assert.equal(s.state.stats.shots,0);s.state.partner.hp=0;frames(s,1);assert.equal(s.state.phase,'defeat');});
test('clearing a wave revives the downed pilot', () => {const s=flight(true);s.state.player.hp=0;s.state.waveTime=s.state.waveDuration;frames(s,1);assert.ok(s.state.player.hp>=s.state.player.maxHp*.5);assert.ok(s.state.intermission>0);});
test('hostile bullets can hit the wingmate without hurting the commander', () => {const s=flight(true);const p=s.state.partner;s.state.bullets.push({id:999,x:p.x,y:p.y,vx:0,vy:0,damage:20,radius:.5,life:1,hostile:true,color:'#fff',pierce:0,hitIds:[],type:'orb',crit:false});frames(s,1);assert.equal(p.shield,25);assert.equal(s.state.player.shield,60);assert.equal(s.state.bullets.length,0);});
test('boss contact damages the nearby wingmate', () => {const s=flight(true);s.state.player.x=-45;s.state.partner.x=20;const e=s.spawn('boss',20,0);e.age=2;e.cooldown=5;frames(s,1);assert.ok(s.state.partner.shield<45);assert.equal(s.state.player.shield,60);});
test('nearest living pilot collects health; team XP is shared', () => {const s=flight(true);s.state.partner.hp=20;s.state.pickups.push({id:999,x:5,y:0,kind:'health',value:12,age:0},{id:998,x:5,y:0,kind:'xp',value:5,age:0});frames(s,1);assert.equal(s.state.partner.hp,32);assert.equal(s.state.player.xp,5);assert.equal(s.state.partner.xp,5);});
test('repair can be bought when only the wingmate is hurt', () => {const s=flight(true);s.state.phase='station';s.state.stats.scrap=100;s.state.partner.hp=10;assert.equal(s.purchase('repair'),true);assert.equal(s.state.partner.hp,s.state.partner.maxHp);assert.equal(s.state.stats.scrap,60);assert.equal(s.purchase('repair'),false);});
test('an exhausted module shop never spends scrap or softlocks', () => {const s=flight();for(const u of UPGRADES)s.state.upgrades[u.id]=u.max;s.state.phase='station';s.state.stats.scrap=100;assert.equal(s.purchase('module'),false);assert.equal(s.state.stats.scrap,100);assert.equal(s.state.phase,'station');});
test('station upgrades return to the station and reset both pilots for the jump', () => {const s=flight(true);s.state.phase='station';s.state.stats.scrap=100;assert.equal(s.purchase('module'),true);assert.equal(s.state.phase,'upgrade');s.chooseUpgrade(s.state.choices[0].id);assert.equal(s.state.phase,'station');s.continueSector();assert.equal(s.state.sector,1);assert.equal(s.state.phase,'playing');assert.equal(s.state.player.x,-5);assert.equal(s.state.partner.x,5);});
test('boss kills progress through stations and end in victory', () => {const s=flight(true);for(let sector=0;sector<3;sector++){const boss=s.spawn('boss',0,10);boss.age=1;boss.hp=1;s.state.player.pulse=100;frames(s,1,input({pulse:true}));assert.equal(s.state.phase,sector===2?'victory':'station');if(sector<2)s.continueSector();}assert.equal(s.state.stats.bosses,3);});
test('rewards include achievement bonuses and are awarded only once', () => {const s=flight();s.state.phase='defeat';const save=freshSave();const result=s.finish(save);assert.equal(result.earned,20);assert.equal(result.save.shards,20);assert.equal(s.finish(result.save).earned,0);});
test('save loading rejects corrupted values without losing valid selections', () => {const save=loadSave(JSON.stringify({version:1,ship:'wraith',shards:-20,meta:{hull:999},settings:{volume:9}}));assert.equal(save.ship,'wraith');assert.equal(save.shards,0);assert.equal(save.meta.hull,5);assert.equal(save.settings.volume,1);assert.deepEqual(loadSave('broken'),freshSave());});
test('network input validation rejects non-finite values and clamps movement', () => {assert.equal(cleanInput(input({x:Infinity})),null);assert.equal(cleanInput({}),null);assert.equal(cleanInput(input({x:999})).x,1);});
test('guest camera view never mutates the authoritative state', () => {const s=flight(true);const view=guestView(s.state);assert.equal(view.ship,'wraith');assert.equal(view.partnerShip,'kestrel');assert.equal(s.state.ship,'kestrel');assert.equal(view.player,s.state.partner);});
test('two-client protocol synchronizes runs, pauses, rematches and one-shot inputs', () => {
  const s=flight(true);let guestState,newRuns=0;
  const host=new Multiplayer({change(){},snapshot(){},pause(){s.pause();},save:freshSave});
  const guest=new Multiplayer({change(){},snapshot(state,newRun){guestState=state;if(newRun)newRuns++;},pause(){},save:freshSave});
  host.role='host';guest.role='guest';host.status=guest.status='connected';host.remoteSave=freshSave();
  host.connection={open:true,dataChannel:{bufferedAmount:0},send:data=>guest.receive(structuredClone(data))};
  guest.connection={open:true,dataChannel:{bufferedAmount:0},send:data=>host.receive(structuredClone(data))};
  host.begin();host.broadcast(s.state,true);assert.equal(guestState.ship,'wraith');assert.equal(newRuns,1);
  guest.send({type:'input',run:host.run,seq:1,input:input({x:1,dash:true})});assert.equal(host.consume().dash,true);assert.equal(host.consume().dash,false);
  guest.send({type:'input',run:'stale',seq:2,input:input({x:-1})});assert.equal(host.consume().x,1);
  guest.send({type:'input',run:host.run,seq:1,input:input({x:-1})});assert.equal(host.consume().x,1);
  guest.requestPause();assert.equal(s.state.phase,'paused');host.broadcast(s.state,true);assert.equal(guestState.phase,'paused');
  host.begin();s.resume();host.broadcast(s.state,true);assert.equal(newRuns,2);assert.equal(host.consume().dash,false);
  host.lastInput=Date.now()-500;assert.equal(host.consume().x,0);
});
