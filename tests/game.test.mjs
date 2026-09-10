import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { EventEmitter } from 'node:events';

// Compile the pure game modules without needing a browser or a test framework.
const directory = await mkdtemp(join(tmpdir(), 'voidbreaker-tests-'));
for (const name of ['types','content','rules','damage-feedback','codec','simulation','multiplayer']) {
  const source = await readFile(new URL(`../lib/game/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  await writeFile(join(directory, `${name}.mjs`), outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'").replace('../network/ice.mjs', pathToFileURL(resolve('lib/network/ice.mjs')).href));
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
test('pointer aim remains independent while snapshots are capped at 20Hz', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const multiplayer = await readFile(new URL('../lib/game/multiplayer.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /coarse\.current\s*\|\|\s*touch\.current\.active/);
  assert.match(multiplayer, /playing' \? 50 : 1000/);

});
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

const fakeConnection = () => Object.assign(new EventEmitter(), {
  open: false, metadata: { protocol: 3 }, send() {},
  close() { this.open = false; this.emit('close'); },
});
const fakePeer = () => Object.assign(new EventEmitter(), {
  destroyed: false, disconnected: false, connects: 0,
  connect() { this.connects++; return fakeConnection(); },
  reconnect() { this.disconnected = false; this.emit('open'); },
  destroy() { this.destroyed = true; },
});
const room = () => new Multiplayer({ change() {}, snapshot() {}, pause() {}, save: freshSave });

test('signaling reopen preserves active rooms on both sides without duplicate channels', () => {
  for (const role of ['host', 'guest']) {
    const r = room(), peer = fakePeer(); r.role = role;
    try {
      r.connectPeer(peer); peer.emit('open');
      if (role === 'host') peer.emit('connection', fakeConnection());
      const connection = r.connection;
      connection.open = true; connection.emit('open');
      connection.emit('data', { type: 'hello', protocol: 3, save: freshSave() });
      r.begin(); const run = r.run;
      peer.emit('error', { type: 'network' }); peer.emit('open');
      assert.equal(r.status, 'connected'); assert.equal(r.connection, connection);
      assert.equal(r.run, run); assert.equal(peer.connects, role === 'host' ? 0 : 1);
    } finally { r.dispose(); }
  }
});

test('failed and expired handshakes release the host slot; stale events cannot evict a new guest', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const r = room(), peer = fakePeer();
  try {
    r.connectPeer(peer); peer.emit('open');
    const failed = fakeConnection(); peer.emit('connection', failed);
    t.mock.timers.tick(20001);
    assert.equal(r.connection, undefined); assert.equal(r.status, 'waiting');
    const replacement = fakeConnection(); peer.emit('connection', replacement);
    replacement.open = true; replacement.emit('open');
    replacement.emit('data', { type: 'hello', protocol: 3, save: freshSave() });
    failed.emit('close'); failed.emit('data', { type: 'reject', message: 'stale' });
    assert.equal(r.status, 'connected'); assert.equal(r.connection, replacement);
    replacement.close(); assert.equal(r.status, 'waiting'); assert.equal(r.remoteSave, null);
  } finally { r.dispose(); }
});

test('asynchronous serialization preserves dash/pulse; focus loss immediately sends neutral controls', async () => {
  const r = room(), sent = []; r.role = 'guest'; r.status = 'connected'; r.begin();
  r.connection = { open: true, async send(data) { await Promise.resolve(); sent.push(structuredClone(data)); }, close() {} };
  try {
    r.sentAt = -Infinity;
    r.submit(input({ x: 1, dash: true, pulse: true }), false);
    await Promise.resolve();
    assert.equal(sent[0].input.dash, true); assert.equal(sent[0].input.pulse, true);
    r.releaseInput(); await Promise.resolve();
    assert.deepEqual(sent[1].input, neutralInput()); assert.ok(sent[1].seq > sent[0].seq);
  } finally { r.dispose(); }
});

test('a synchronous hello send failure does not leave an extra heartbeat running', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const r = room(), peer = fakePeer();
  try {
    r.connectPeer(peer); peer.emit('open');
    const failed = fakeConnection(); failed.send = () => { throw new Error('Closed channel'); };
    peer.emit('connection', failed); failed.open = true; failed.emit('open');
    assert.equal(r.status, 'waiting');
    const replacement = fakeConnection(); let pings = 0;
    replacement.send = data => { if (data.type === 'ping') pings++; };
    peer.emit('connection', replacement); replacement.open = true; replacement.emit('open');
    replacement.emit('data', { type: 'hello', protocol: 3, save: freshSave() });
    t.mock.timers.tick(2000); assert.equal(pings, 1);
  } finally { r.dispose(); }
});
const { SnapshotEncoder, SnapshotDecoder } = await import(pathToFileURL(join(directory,'codec.mjs')));
const { DIFFICULTIES } = await import(pathToFileURL(join(directory,'rules.mjs')));

test('all five difficulties progressively raise actual enemy pressure and attack speed', () => {
  let previous;
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const s=new Simulation('kestrel','pulse',freshSave(),42,difficulty); s.start();
    const e=s.spawn('lancer',20,20); s.addBullet(0,0,0,10,10,true,'#fff');
    const current=[e.hp,e.damage,e.speed,s.state.bullets[0].vx];
    if(previous) current.forEach((v,i)=>assert.ok(v>previous[i],difficulty));
    previous=current;
  }
});

test('endless completes two full circuits without victory, rotates all six bosses, and scales danger', () => {
  const s=new Simulation('kestrel','pulse',freshSave(),42,'normal',{mode:'endless'});s.start();
  const variants=new Set(); let initial;
  for(let i=0;i<7;i++) {
    const boss=s.spawn('boss',0,10);variants.add(boss.bossVariant);if(i===0)initial=boss.hp;if(i===3)assert.ok(boss.hp>initial);
    boss.hp=0;s.kill(boss);assert.equal(s.state.phase,'station');s.continueSector();
    assert.equal(s.state.phase,'playing'); assert.ok(s.state.sector>=0 && s.state.sector<3);
  }
  assert.equal(variants.size,6);assert.equal(s.state.loop,2);assert.equal(s.state.sector,1);
});

test('individual drafts wait for both pilots and reject duplicate, stale, or unoffered choices', () => {
  const s=flight(true);s.state.sharedUpgrades=false;s.levelUp();const draft=s.state.draftId;
  const a=s.state.choices[0].id,b=s.state.partnerChoices[0].id;
  assert.equal(s.chooseUpgrade(a,0,draft),true);assert.equal(s.state.phase,'upgrade');
  assert.equal(s.chooseUpgrade(a,0,draft),false);assert.equal(s.chooseUpgrade(b,1,draft-1),false);
  assert.equal(s.chooseUpgrade(b,1,draft),true);assert.equal(s.state.phase,'playing');
  assert.equal(s.state.upgrades[a],1);assert.equal(s.state.partnerUpgrades[b],1);
  const view=guestView(s.state);assert.equal(view.upgrades,s.state.partnerUpgrades);
});

test('independent stats and auxiliary weapons apply only to their owning pilot', () => {
  const s=flight(true);s.state.sharedUpgrades=false;
  const hostDamage=s.state.player.damage;s.applyUpgrade('damage',1);s.applyUpgrade('multishot',1);
  assert.equal(s.state.player.damage,hostDamage);assert.ok(s.state.partner.damage>1.15);
  frames(s,1,input({firing:true}),input({firing:true}));
  assert.equal(s.state.bullets.filter(b=>b.owner===0).length,1);
  assert.ok(s.state.bullets.filter(b=>b.owner===1).length>1);
  const enemy=s.spawn('drone',10,10);s.activePilot=1;s.kill(enemy);
  assert.equal(s.state.player.kills,0);assert.equal(s.state.partner.kills,1);assert.equal(s.state.stats.kills,1);
});

test('exhausted independent drafts resume and shared draft does not repair a non-maxed wingmate', () => {
  const s=flight(true);s.state.partner.hp=10;s.levelUp();assert.equal(s.state.partner.hp,10);
  s.state.sharedUpgrades=false;for(const u of UPGRADES){s.state.upgrades[u.id]=u.max;s.state.partnerUpgrades[u.id]=u.max;}
  s.openDraft();assert.equal(s.state.phase,'playing');assert.equal(s.state.partner.hp,s.state.partner.maxHp);
});

test('new enemies warn before attacks and carriers cannot create unbounded swarms', () => {
  for(const kind of ['lancer','brood','anchor']) {
    const s=flight();const e=s.spawn(kind,10,10);e.age=2;e.cooldown=0;
    s.updateEnemy(e,1/60);assert.ok(e.telegraph>=.75);assert.equal(s.state.bullets.length,0);
    for(let i=0;i<180;i++)s.updateEnemy(e,1/60);
    assert.ok(kind==='brood'?s.state.enemies.some(x=>x.kind==='swarm'):s.state.bullets.length>0);
  }
  const s=flight();for(let i=0;i<1000;i++)s.spawn('swarm',0,0);assert.equal(s.state.enemies.length,80);
});

test('compact snapshots retain stable metadata, preserve guest visuals, and reject corrupt rows', () => {
  const s=flight(true),encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();
  s.state.sharedUpgrades=false;s.state.mode='endless';s.applyUpgrade('orbitals',1);s.spawn('anchor',12.123,9);
  const first=encoder.encode(s.state);const decoded=decoder.decode(first);assert.equal(decoded.mode,'endless');assert.equal(decoded.enemies[0].kind,'anchor');assert.equal(decoded.partnerUpgrades.orbitals,1);
  s.state.time=.05;s.state.spawnTimer=5;const second=encoder.encode(s.state);assert.equal(second.meta,undefined);assert.equal(decoder.decode(second).mode,'endless');
  s.state.phase='paused';assert.equal(decoder.decode(encoder.encode(s.state)).phase,'paused');
  const broken=structuredClone(second);broken.p[0]=NaN;assert.equal(decoder.decode(broken),null);
  assert.equal(new SnapshotDecoder().decode(second),null);
});

test('compact 20Hz traffic is substantially smaller than full 40Hz snapshots in a busy scene', async () => {
  const { pack }=await import('peerjs-js-binarypack');
  const s=flight(true);for(let i=0;i<30;i++)s.spawn('drone',i,20);
  for(let i=0;i<120;i++)s.addBullet(i/4,10,.3,12,20,i%2===0,'#ff7755');
  const encoder=new SnapshotEncoder();encoder.encode(s.state);
  const bytes=value=>pack(value).byteLength;
  const full=bytes({type:'state',run:'a'.repeat(32),state:s.state})*40;
  const compact=bytes({type:'state',run:'a'.repeat(32),frame:encoder.encode(s.state)})*20;
  assert.ok(compact<full*.35,`${compact} vs ${full}`);
  console.log(`Busy-scene payload: ${Math.round(full/1024)} KiB/s before, ${Math.round(compact/1024)} KiB/s now (${Math.round(100*(1-compact/full))}% reduction; excludes transport overhead).`);
});

test('chain and explosion cascades award each death exactly once', () => {
  const s=flight();s.applyUpgrade('chain');s.applyUpgrade('explode');s.random=()=>0;
  const a=s.spawn('drone',25,25),b=s.spawn('drone',25,25);a.age=b.age=2;a.hp=50;b.hp=5;
  s.damageEnemy(a,40,true);assert.equal(s.state.stats.kills,2);assert.equal(s.state.player.kills,2);
  const loot=s.state.pickups.length;s.kill(a);assert.equal(s.state.pickups.length,loot);
});

test('room settings persist through loadout updates and guest module requests reach host validation', () => {
  const s=flight(true);s.state.sharedUpgrades=false;s.levelUp();let snapshot;
  const host=new Multiplayer({change(){},snapshot(){},pause(){},save:freshSave,choose:(id,draft)=>id===null?s.reroll(1,draft):s.chooseUpgrade(id,1,draft)});
  const guest=new Multiplayer({change(){},snapshot:value=>snapshot=value,pause(){},save:freshSave});
  host.role='host';guest.role='guest';host.status=guest.status='connected';
  host.connection={open:true,dataChannel:{bufferedAmount:0},send:data=>guest.receive(structuredClone(data))};
  guest.connection={open:true,dataChannel:{bufferedAmount:0},send:data=>host.receive(structuredClone(data))};
  host.configure({mode:'endless',difficulty:'ace',sharedUpgrades:false,sharedKills:false});host.updateLoadout();assert.deepEqual(guest.options,host.options);
  guest.configure({difficulty:'easy'});assert.equal(host.options.difficulty,'ace');
  host.begin();host.broadcast(s.state,true);const choice=snapshot.choices[0].id;
  guest.choose(choice,snapshot.draftId-1);assert.equal(s.state.partnerUpgrades[choice],undefined);
  guest.choose(choice,snapshot.draftId);assert.equal(s.state.partnerUpgrades[choice],1);
  guest.choose(choice,snapshot.draftId);assert.equal(s.state.partnerUpgrades[choice],1);
});

test('damage feedback distinguishes shield, hull and overflow hits for mutable and network states', async () => {
  const {DamageFeedback}=await import(pathToFileURL(join(directory,'damage-feedback.mjs')));
  const s=flight(),f=new DamageFeedback();f.update(s.state,0);
  s.state.player.shield-=10;f.update(s.state,.016);assert.ok(f.shield>0);assert.equal(f.hull,0);
  const snapshot=structuredClone(s.state);snapshot.player.hp-=5;f.update(snapshot,.016);assert.ok(f.hull>0);
  f.update(snapshot,1);assert.equal(f.hull,0);assert.equal(f.shield,0);
  snapshot.phase='menu';f.update(snapshot,0);snapshot.phase='playing';snapshot.player.hp=20;f.update(snapshot,0);assert.equal(f.hull,0);
});
