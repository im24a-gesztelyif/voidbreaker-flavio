import { ACHIEVEMENTS, ENEMY_DATA, SECTORS, SHIPS, UPGRADES, WEAPONS, freshSave } from './content';
import type { Bullet, Effect, Enemy, EnemyKind, GameEvent, GameInput, GameState, Phase, SaveData, ShipId, UpgradeId, Vec, WeaponId } from './types';

export const ARENA_RADIUS = 52;
const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const angleTo = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);
const normalizeAngle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));

export function loadSave(raw?: string | null): SaveData {
  const base = freshSave();
  if (!raw) return base;
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1) return base;
    const count = (v: unknown, max = 1e9) => typeof v === 'number' && Number.isFinite(v) ? clamp(Math.floor(v), 0, max) : 0;
    return { ...base, shards: count(data.shards), totalRuns: count(data.totalRuns), wins: count(data.wins), bestScore: count(data.bestScore), bestSector: count(data.bestSector, 3), totalKills: count(data.totalKills),
      ship: SHIPS.some(s => s.id === data.ship) ? data.ship : base.ship,
      weapon: WEAPONS.some(w => w.id === data.weapon) ? data.weapon : base.weapon,
      meta: { hull: count(data.meta?.hull, 5), damage: count(data.meta?.damage, 5), fortune: count(data.meta?.fortune, 5) },
      achievements: Array.isArray(data.achievements) ? data.achievements.filter((v: unknown) => ACHIEVEMENTS.some(a => a.id === v)) : [],
      settings: { volume: typeof data.settings?.volume === 'number' && Number.isFinite(data.settings.volume) ? clamp(data.settings.volume, 0, 1) : .45, muted: data.settings?.muted === true, shake: data.settings?.shake !== false, quality: data.settings?.quality === 'low' ? 'low' : 'high', autoFire: data.settings?.autoFire !== false } };
  } catch { return base; }
}

export class Simulation {
  state: GameState;
  events: GameEvent[] = [];
  private id = 1;
  private randomState: number;
  private awarded = false;
  constructor(ship: ShipId = 'kestrel', weapon: WeaponId = 'pulse', save: SaveData = freshSave(), seed = Date.now(), difficulty: 'normal' | 'hard' = 'normal') {
    this.randomState = (seed >>> 0) || 1;
    const spec = SHIPS.find(s => s.id === ship)!;
    const hp = spec.hp + save.meta.hull * 8;
    this.state = { phase: 'menu', previousPhase: 'playing', ship, weapon, player: { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, hp, maxHp: hp, shield: spec.shield, maxShield: spec.shield, speed: spec.speed, damage: spec.damage * (1 + save.meta.damage * .04), fireRate: 1, crit: .1, dashTimer: 0, dashCooldown: 0, invulnerable: 0, hitTimer: 10, shootTimer: 0, pulse: 60, level: 1, xp: 0, nextXp: 30, regenTimer: 0, missileTimer: 1, droneTimer: 0, orbitalTimer: 0 }, enemies: [], bullets: [], pickups: [], effects: [], sector: 0, wave: 1, waveTime: 0, time: 0, totalTime: 0, waveDuration: 38, spawnTimer: 1.6, intermission: 0, bossSpawned: false, stats: { kills: 0, damage: 0, damageTaken: 0, scrap: 0, totalScrap: 0, shots: 0, hits: 0, elites: 0, bosses: 0, maxCombo: 0 }, upgrades: {}, choices: [], combo: 0, comboTime: 0, banner: '', bannerSub: '', bannerTime: 0, seed, difficulty, autoFire: save.settings.autoFire, screenShake: 0, stationBought: [], rerolls: 2 + save.meta.fortune };
  }
  random() { let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x >>> 0; return this.randomState / 4294967296; }
  private rank(id: UpgradeId) { return this.state.upgrades[id] || 0; }
  private emit(type: string, value?: number) { this.events.push({ type, value }); }
  private fx(kind: Effect['kind'], x: number, y: number, color: string, size = 1, life = .5, extra: Partial<Effect> = {}) {
    if (this.state.effects.length > 200) this.state.effects.splice(0, 20);
    this.state.effects.push({ id: this.id++, kind, x, y, color, size, life, maxLife: life, ...extra });
  }
  start() { this.state.phase = 'playing'; this.banner('SEKTOR 01', SECTORS[0].name); this.emit('start'); }
  private banner(title: string, subtitle: string, duration = 3.5) { Object.assign(this.state, { banner: title, bannerSub: subtitle, bannerTime: duration }); }
  pause() { if (this.state.phase === 'playing') { this.state.phase = 'paused'; this.emit('pause'); } }
  resume() { if (this.state.phase === 'paused') { this.state.phase = 'playing'; this.emit('resume'); } }
  toggleAutoFire() { this.state.autoFire = !this.state.autoFire; }
  private boundary(v: Vec, limit = ARENA_RADIUS) { const d = Math.hypot(v.x, v.y); if (d > limit) { v.x *= limit / d; v.y *= limit / d; } }

  step(dt: number, input: GameInput) {
    const s = this.state, p = s.player;
    if (s.phase !== 'playing') return;
    dt = clamp(dt, 0, .035);
    s.time += dt; s.totalTime += dt; s.waveTime += dt;
    s.screenShake = Math.max(0, s.screenShake - dt * 3);
    s.bannerTime = Math.max(0, s.bannerTime - dt);
    s.comboTime -= dt; if (s.comboTime <= 0) s.combo = 0;
    p.hitTimer += dt; p.invulnerable = Math.max(0, p.invulnerable - dt); p.dashCooldown = Math.max(0, p.dashCooldown - dt); p.dashTimer = Math.max(0, p.dashTimer - dt);
    p.shootTimer -= dt; p.missileTimer -= dt; p.droneTimer -= dt; p.orbitalTimer -= dt;
    if (p.hitTimer > 3.5 && p.shield < p.maxShield) p.shield = Math.min(p.maxShield, p.shield + (12 + this.rank('shield') * 3) * dt);
    if (this.rank('regen')) { p.regenTimer += dt; if (p.regenTimer >= 8 / this.rank('regen')) { p.regenTimer = 0; p.hp = Math.min(p.maxHp, p.hp + 4); } }
    p.pulse = Math.min(100, p.pulse + dt * .7);
    const aim = Math.atan2(input.aimY - p.y, input.aimX - p.x);
    if (Number.isFinite(aim)) p.angle = aim;
    let ix = input.x, iy = input.y; const len = Math.hypot(ix, iy); if (len > 1) { ix /= len; iy /= len; }
    if (input.dash && p.dashCooldown <= 0) {
      const a = len > .1 ? Math.atan2(iy, ix) : p.angle;
      p.vx = Math.cos(a) * 65; p.vy = Math.sin(a) * 65; p.dashTimer = .2; p.invulnerable = .34;
      p.dashCooldown = SHIPS.find(x => x.id === s.ship)!.dash * Math.pow(.8, this.rank('dash'));
      this.fx('dash', p.x, p.y, '#82ffe3', 4, .45); this.emit('dash');
      if (this.rank('dash')) for (const e of s.enemies) if (distance(e, p) < 8) this.damageEnemy(e, 35 * this.rank('dash'), false);
    }
    if (p.dashTimer <= 0) { const smooth = 1 - Math.exp(-dt * 14); p.vx += (ix * p.speed - p.vx) * smooth; p.vy += (iy * p.speed - p.vy) * smooth; }
    p.x += p.vx * dt; p.y += p.vy * dt; this.boundary(p, ARENA_RADIUS - 1.5);
    if (input.pulse && p.pulse >= 100) {
      p.pulse = 0; p.invulnerable = Math.max(p.invulnerable, .65); this.fx('pulse', p.x, p.y, '#9affea', 25, .8); s.screenShake = 1; this.emit('pulse');
      for (const e of s.enemies) if (distance(e, p) < 26) { this.damageEnemy(e, 140 * (1 + this.rank('pulse') * .35), false); if (e.kind !== 'boss') { const a = angleTo(p, e); e.x += Math.cos(a) * 4; e.y += Math.sin(a) * 4; } }
      s.bullets = s.bullets.filter(b => !b.hostile || distance(b, p) > 30);
    }
    if ((input.firing || s.autoFire) && p.shootTimer <= 0 && s.intermission <= 0) this.shoot();
    this.auxiliaries();
    this.spawning(dt);
    for (const e of s.enemies) if (e.hp > 0) this.updateEnemy(e, dt);
    for (const b of s.bullets) this.updateBullet(b, dt);
    s.bullets = s.bullets.filter(b => b.life > 0 && Math.abs(b.x) < 110 && Math.abs(b.y) < 110);
    s.enemies = s.enemies.filter(e => e.hp > 0);
    for (const item of s.pickups) {
      item.age += dt; const d = distance(item, p), magnet = 7 * (1 + this.rank('magnet') * .6 + this.rank('speed') * .15);
      if (d < magnet || item.age > 20 || s.intermission > 0) { const a = angleTo(item, p), v = Math.min(d, (13 + 180 / (d + 2)) * dt); item.x += Math.cos(a) * v; item.y += Math.sin(a) * v; }
      if (d < 1.7) { this.collect(item.kind, item.value); item.value = 0; }
    }
    s.pickups = s.pickups.filter(i => i.value > 0);
    for (const f of s.effects) f.life -= dt;
    s.effects = s.effects.filter(f => f.life > 0);
    if (p.hp <= 0) { s.phase = 'defeat'; this.emit('defeat'); this.fx('explosion', p.x, p.y, '#ff945e', 8, 2); }
    if (s.phase === 'playing' && p.xp >= p.nextXp) this.levelUp();
  }

  private shoot() {
    const s = this.state, p = s.player, w = WEAPONS.find(w => w.id === s.weapon)!;
    const extra = this.rank('multishot'), count = w.count + extra;
    p.shootTimer += w.rate / p.fireRate;
    for (let i = 0; i < count; i++) {
      const spread = w.count > 1 ? w.spread : count > 1 ? .13 : w.spread;
      const a = p.angle + (i - (count - 1) / 2) * spread + (this.random() - .5) * .013;
      const crit = this.random() < p.crit;
      this.addBullet(p.x + Math.cos(a) * 1.5, p.y + Math.sin(a) * 1.5, a, w.speed, w.damage * p.damage * (i >= w.count ? .7 : 1) * (crit ? 2 : 1), false, w.color, s.weapon === 'rail' ? 'rail' : 'bolt', w.pierce + this.rank('pierce'), crit);
    }
    s.stats.shots += count; this.emit('shoot', s.weapon === 'rail' ? .6 : s.weapon === 'scatter' ? .8 : 1);
  }
  private addBullet(x: number, y: number, a: number, speed: number, damage: number, hostile: boolean, color: string, type: Bullet['type'] = 'bolt', pierce = 0, crit = false) {
    if (this.state.bullets.length >= 700) return;
    this.state.bullets.push({ id: this.id++, x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, damage, radius: hostile ? .48 : type === 'rail' ? .5 : .3, life: type === 'missile' ? 4 : hostile ? 7 : 1.6, hostile, color, pierce, hitIds: [], type, crit });
  }
  private nearest(origin: Vec, max = 100, except = -1) { let best: Enemy | undefined, d = max; for (const e of this.state.enemies) { if (e.hp <= 0 || e.id === except || e.age < .65) continue; const n = distance(origin, e); if (n < d) { d = n; best = e; } } return best; }
  private auxiliaries() {
    const s = this.state, p = s.player;
    if (this.rank('missiles') && p.missileTimer <= 0) { const target = this.nearest(p, 45); if (target) { for (let i = 0; i < this.rank('missiles'); i++) this.addBullet(p.x, p.y, p.angle + (i - .5) * .7, 28, 38 * p.damage, false, '#ffa26d', 'missile'); p.missileTimer = 3; } }
    if (this.rank('drones') && p.droneTimer <= 0) { const target = this.nearest(p, 35); if (target) { for (let i = 0; i < this.rank('drones'); i++) { const a = s.time * .7 + i * TAU / this.rank('drones'), pos = { x: p.x + Math.cos(a) * 4, y: p.y + Math.sin(a) * 4 }; this.addBullet(pos.x, pos.y, angleTo(pos, target), 58, 11 * p.damage, false, '#b5a0ff'); } p.droneTimer = .4; } }
    if (this.rank('orbitals') && p.orbitalTimer <= 0) { const n = this.rank('orbitals') * 2; for (let i = 0; i < n; i++) { const a = s.time * 2 + i * TAU / n, pos = { x: p.x + Math.cos(a) * 5.5, y: p.y + Math.sin(a) * 5.5 }; for (const e of s.enemies) if (distance(pos, e) < e.radius + 1.5) this.damageEnemy(e, 14 * p.damage, false); } p.orbitalTimer = .2; }
  }

  private spawning(dt: number) {
    const s = this.state;
    if (s.intermission > 0) { s.intermission -= dt; if (s.intermission <= 0) this.nextWave(); return; }
    if (s.wave === 4) { if (!s.bossSpawned) { s.bossSpawned = true; this.spawn('boss'); this.banner(SECTORS[s.sector].bossName, 'SEKTORKERN ERFASST · KAMPFSYSTEME AKTIV', 4); this.emit('boss'); } return; }
    if (s.waveTime >= s.waveDuration) {
      if (s.enemies.length === 0) { s.intermission = 3.8; this.banner('WELLE ABGESCHLOSSEN', '+20 HÜLLE · BERGUNG AKTIV', 3); s.player.hp = Math.min(s.player.maxHp, s.player.hp + 20); for (const i of s.pickups) this.collect(i.kind, i.value); s.pickups = []; }
      return;
    }
    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0 && s.enemies.length < 42) {
      const progress = s.sector * 3 + s.wave - 1;
      s.spawnTimer = Math.max(.4, 1.65 - progress * .13) * (.7 + this.random() * .6);
      let pool: EnemyKind[] = ['drone', 'drone', 'swarm'];
      if (s.wave >= 2 || s.sector > 0) pool.push('gunner', 'striker');
      if (s.sector > 0) pool.push('bomber', 'warden');
      const kind = pool[Math.floor(this.random() * pool.length)];
      this.spawn(kind, undefined, undefined, progress >= 2 && this.random() < .07 + s.sector * .025);
      if (kind === 'swarm') for (let i = 0; i < 2; i++) this.spawn('swarm');
    }
  }
  private nextWave() {
    const s = this.state;
    s.wave++; s.waveTime = 0; s.waveDuration = 33 + s.wave * 5; s.spawnTimer = 1.2;
    if (s.wave < 4) this.banner(`WELLE ${String(s.wave).padStart(2, '0')}`, SECTORS[s.sector].name);
  }
  spawn(kind: EnemyKind, x?: number, y?: number, elite = false) {
    const s = this.state, data = ENEMY_DATA[kind], a = this.random() * TAU;
    const pos = { x: x ?? s.player.x + Math.cos(a) * 37, y: y ?? s.player.y + Math.sin(a) * 37 };
    this.boundary(pos, ARENA_RADIUS - 3);
    if (distance(pos, s.player) < 17) { pos.x = -s.player.x * .7 + Math.cos(a) * 12; pos.y = -s.player.y * .7 + Math.sin(a) * 12; }
    const scale = (1 + s.sector * .55) * (s.difficulty === 'hard' ? 1.3 : 1);
    const hp = kind === 'boss' ? [2100, 4200, 6800][s.sector] * (s.difficulty === 'hard' ? 1.3 : 1) : data.hp * scale * (elite ? 2.5 : 1);
    const e: Enemy = { id: this.id++, ...pos, kind, hp, maxHp: hp, radius: data.radius * (elite ? 1.2 : 1), speed: data.speed, damage: data.damage * (1 + s.sector * .16) * (s.difficulty === 'hard' ? 1.2 : 1), angle: angleTo(pos, s.player), cooldown: 1.5 + this.random(), age: 0, vx: 0, vy: 0, hit: 0, slow: 0, elite, bossPhase: 1, attack: 0, telegraph: 0, targetX: 0, targetY: 0 };
    s.enemies.push(e); this.fx('spawn', pos.x, pos.y, data.color, e.radius * 2, .7); return e;
  }
  private updateEnemy(e: Enemy, dt: number) {
    const s = this.state, p = s.player;
    e.age += dt; e.hit = Math.max(0, e.hit - dt); e.slow = Math.max(0, e.slow - dt);
    if (e.age < .7) return;
    e.cooldown -= dt;
    const d = distance(e, p), a = angleTo(e, p); let speed = e.speed * (e.slow > 0 ? e.kind === 'boss' ? .92 : .65 - this.rank('freeze') * .05 : 1);
    e.angle += normalizeAngle(a - e.angle) * Math.min(1, dt * 5);
    if (e.kind === 'boss') { this.updateBoss(e, dt, a, d); return; }
    let moveAngle = a;
    if (e.kind === 'gunner' || e.kind === 'bomber' || e.kind === 'warden') { if (d < 17) moveAngle += Math.PI / 2 + .6; else if (d < 23) moveAngle += Math.PI / 2; }
    if (e.kind === 'striker') {
      if (e.telegraph > 0) { e.telegraph -= dt; speed = .5; if (e.telegraph <= 0) { e.vx = Math.cos(e.targetX) * 35; e.vy = Math.sin(e.targetX) * 35; e.attack = .55; } }
      else if (e.attack > 0) { e.attack -= dt; e.x += e.vx * dt; e.y += e.vy * dt; speed = 0; }
      else if (e.cooldown <= 0) { e.cooldown = 4; e.telegraph = .85; e.targetX = a; }
    }
    e.x += Math.cos(moveAngle) * speed * dt; e.y += Math.sin(moveAngle) * speed * dt;
    this.boundary(e, ARENA_RADIUS - 1);
    if (e.cooldown <= 0) {
      if (e.kind === 'gunner') { this.addBullet(e.x, e.y, a, 15, e.damage, true, '#ff8768', 'orb'); e.cooldown = 2.3; }
      else if (e.kind === 'bomber') { for (let i = 0; i < 9; i++) this.addBullet(e.x, e.y, i * TAU / 9 + e.age, 9, e.damage, true, '#dd9aff', 'orb'); e.cooldown = 3.6; }
      else if (e.kind === 'warden') { for (let i = -2; i <= 2; i++) this.addBullet(e.x, e.y, a + i * .19, 13, e.damage, true, '#ffb778', 'orb'); e.cooldown = 2.7; }
    }
    if (distance(e, p) < e.radius + .95) this.hurtPlayer(e.damage);
    // Soft local separation prevents stacked contact enemies without changing their intent.
    for (const other of s.enemies) { if (other.id <= e.id || other.hp <= 0) continue; const sep = distance(e, other), desired = (e.radius + other.radius) * .7; if (sep < desired && sep > .01) { const push = (desired - sep) * dt * 2; const nx = (e.x - other.x) / sep, ny = (e.y - other.y) / sep; e.x += nx * push; e.y += ny * push; other.x -= nx * push; other.y -= ny * push; } }
  }
  private updateBoss(e: Enemy, dt: number, a: number, d: number) {
    const s = this.state;
    const phase = e.hp > e.maxHp * .7 ? 1 : e.hp > e.maxHp * .35 ? 2 : 3;
    if (phase !== e.bossPhase) { e.bossPhase = phase; e.cooldown = 1.4; e.telegraph = 0; e.attack = 0; this.fx('pulse', e.x, e.y, SECTORS[s.sector].color, 12, .7); this.banner(`PHASE ${phase}`, 'ENERGIESIGNATUR STEIGT', 2); }
    const move = d > 23 ? a : a + Math.PI / 2;
    e.x += Math.cos(move) * e.speed * dt; e.y += Math.sin(move) * e.speed * dt; this.boundary(e, ARENA_RADIUS - 8);
    if (e.telegraph > 0) { e.telegraph -= dt; if (e.telegraph <= 0) {
      const gap = e.targetX;
      const count = 16 + s.sector * 6;
      for (let i = 0; i < count; i++) { const angle = i * TAU / count + e.age * .1; if (Math.abs(normalizeAngle(angle - gap)) < .42 || (s.sector === 2 && Math.abs(normalizeAngle(angle - gap - Math.PI)) < .35)) continue; this.addBullet(e.x + Math.cos(angle) * 4, e.y + Math.sin(angle) * 4, angle, 12 + s.sector, e.damage, true, SECTORS[s.sector].color, 'orb'); }
      this.emit('enemyShoot'); e.cooldown = phase === 3 ? 1.85 : 2.4;
    } }
    else if (e.cooldown <= 0) {
      e.attack++;
      if (e.attack % 3 === 0 || phase === 3 && e.attack % 2 === 0) { e.telegraph = 1; e.targetX = a + .3; e.cooldown = 3; }
      else { const count = 5 + phase * 2 + s.sector * 2; for (let i = 0; i < count; i++) this.addBullet(e.x + Math.cos(a) * 4, e.y + Math.sin(a) * 4, a + (i - (count - 1) / 2) * .14, 15 + s.sector, e.damage, true, '#ff8a72', 'orb'); e.cooldown = 2.5 - phase * .2; }
      if (phase >= 2 && e.attack % 4 === 0 && s.enemies.length < 12) for (let i = 0; i < 3; i++) this.spawn(s.sector === 2 ? 'striker' : 'drone', e.x + Math.cos(i * TAU / 3) * 8, e.y + Math.sin(i * TAU / 3) * 8);
    }
    if (distance(e, s.player) < e.radius + 1) this.hurtPlayer(e.damage * 1.4);
  }

  private updateBullet(b: Bullet, dt: number) {
    b.life -= dt; if (b.life <= 0) return;
    const s = this.state;
    if (b.type === 'missile') { const target = this.nearest(b, 45); if (target) { const a = angleTo(b, target), old = Math.atan2(b.vy, b.vx), next = old + normalizeAngle(a - old) * Math.min(1, dt * 5); b.vx = Math.cos(next) * 32; b.vy = Math.sin(next) * 32; } }
    const oldX = b.x, oldY = b.y; b.x += b.vx * dt; b.y += b.vy * dt;
    // Segment collision keeps rail shots reliable on slow frames.
    const intersects = (v: Vec, r: number) => { const dx = b.x - oldX, dy = b.y - oldY; const t = clamp(((v.x - oldX) * dx + (v.y - oldY) * dy) / (dx * dx + dy * dy || 1), 0, 1); return Math.hypot(v.x - oldX - dx * t, v.y - oldY - dy * t) < r + b.radius; };
    if (b.hostile) { if (intersects(s.player, .85)) { this.hurtPlayer(b.damage); b.life = 0; } }
    else for (const e of s.enemies) { if (e.hp <= 0 || e.age < .65 || b.hitIds.includes(e.id) || !intersects(e, e.radius)) continue;
      s.stats.hits++; this.damageEnemy(e, b.damage, true, b.crit); b.hitIds.push(e.id);
      if (this.rank('freeze')) e.slow = 2;
      if (b.type === 'missile') { this.fx('explosion', b.x, b.y, '#ffa066', 4, .45); for (const other of s.enemies) if (other.id !== e.id && distance(other, e) < 5) this.damageEnemy(other, b.damage * .6, false); }
      if (this.rank('ricochet') && this.random() < .35 * this.rank('ricochet')) { const target = this.nearest(e, 16, e.id); if (target) this.addBullet(e.x, e.y, angleTo(e, target), 60, b.damage * .5, false, '#c7a2ff', 'bolt', 0); }
      if (b.pierce > 0) { b.pierce--; b.damage *= .9; } else { b.life = 0; break; }
    }
  }
  private damageEnemy(e: Enemy, damage: number, procs: boolean, crit = false) {
    if (e.hp <= 0) return;
    const s = this.state; s.stats.damage += Math.min(e.hp, damage); e.hp -= damage; e.hit = .09;
    this.fx('hit', e.x, e.y, crit ? '#ffe5a3' : '#b8ffe9', crit ? 1.1 : .65, .2);
    if (crit || e.kind === 'boss' && this.random() < .18) this.fx('text', e.x, e.y, crit ? '#ffcd83' : '#d7eee7', 1, .65, { text: `${Math.round(damage)}${crit ? '!' : ''}` });
    this.emit('hit');
    if (procs && this.rank('chain') && this.random() < .2) { let from = e; const visited = [e.id]; for (let i = 0; i < 1 + this.rank('chain'); i++) { let next: Enemy | undefined; let d = 13; for (const other of s.enemies) if (other.hp > 0 && !visited.includes(other.id) && distance(other, from) < d) { next = other; d = distance(other, from); } if (!next) break; this.fx('chain', from.x, from.y, '#93cfff', 1, .22, { targetX: next.x, targetY: next.y }); this.damageEnemy(next, damage * .45, false); visited.push(next.id); from = next; } }
    if (e.hp <= 0) this.kill(e);
  }
  private kill(e: Enemy) {
    const s = this.state, p = s.player;
    s.stats.kills++; s.combo++; s.comboTime = 4.5; s.stats.maxCombo = Math.max(s.stats.maxCombo, s.combo);
    if (e.elite) s.stats.elites++;
    p.pulse = Math.min(100, p.pulse + (e.kind === 'swarm' ? 1 : 2) * (1 + this.rank('pulse') * .25));
    this.fx('explosion', e.x, e.y, ENEMY_DATA[e.kind].color, e.radius * 2, .7); this.emit('explosion', e.kind === 'boss' ? .4 : .9 + this.random() * .3);
    s.screenShake = Math.min(1.4, s.screenShake + (e.kind === 'boss' ? 1.2 : .12));
    const xp = ENEMY_DATA[e.kind].xp * (e.elite ? 2 : 1);
    const scrap = Math.ceil((e.kind === 'boss' ? 80 : e.kind === 'swarm' ? 1 : 3) * (1 + this.rank('salvage') * .3) * (e.elite ? 3 : 1));
    s.pickups.push({ id: this.id++, x: e.x, y: e.y, kind: 'xp', value: xp, age: 0 }, { id: this.id++, x: e.x + 1, y: e.y + .5, kind: 'scrap', value: scrap, age: 0 });
    if (this.random() < .035 || e.elite) s.pickups.push({ id: this.id++, x: e.x - 1, y: e.y, kind: 'health', value: 12, age: 0 });
    if (this.rank('lifesteal') && s.stats.kills % 15 === 0) { p.hp = Math.min(p.maxHp, p.hp + 5 * this.rank('lifesteal')); this.fx('heal', p.x, p.y, '#97ffd5', 3, .6); }
    if (this.rank('explode')) { this.fx('pulse', e.x, e.y, '#ffba79', 5, .35); for (const other of s.enemies) if (other.hp > 0 && distance(other, e) < 5) { const damage = 22 * this.rank('explode'); s.stats.damage += Math.min(other.hp, damage); other.hp -= damage; if (other.hp <= 0) this.killWithoutExplosion(other); } }
    if (e.kind === 'boss') {
      s.stats.bosses++; s.bullets = s.bullets.filter(b => !b.hostile);
      for (const other of s.enemies) if (other.id !== e.id) other.hp = 0;
      for (const i of s.pickups) this.collect(i.kind, i.value); s.pickups = [];
      p.shield = p.maxShield; p.hp = Math.min(p.maxHp, p.hp + 35);
      if (s.sector === 2) { s.phase = 'victory'; this.emit('victory'); }
      else { s.phase = 'station'; s.stationBought = []; this.emit('station'); }
    }
  }
  private killWithoutExplosion(e: Enemy) { // Secondary explosions never recursively trigger themselves.
    const rank = this.state.upgrades.explode; this.state.upgrades.explode = 0; this.kill(e); this.state.upgrades.explode = rank;
  }
  private hurtPlayer(amount: number) {
    const s = this.state, p = s.player; if (p.invulnerable > 0 || s.phase !== 'playing') return;
    p.invulnerable = .5; p.hitTimer = 0; const shield = Math.min(p.shield, amount); p.shield -= shield; p.hp = Math.max(0, p.hp - (amount - shield)); s.stats.damageTaken += amount;
    s.screenShake = .65; this.fx('hit', p.x, p.y, shield >= amount ? '#9fdfff' : '#ff6268', 2, .35); this.emit(shield >= amount ? 'shield' : 'hurt');
  }
  private collect(kind: 'xp' | 'scrap' | 'health', value: number) {
    const s = this.state; if (kind === 'xp') s.player.xp += value * (1 + this.rank('magnet') * .15);
    else if (kind === 'scrap') { s.stats.scrap += value; s.stats.totalScrap += value; }
    else { s.player.hp = Math.min(s.player.maxHp, s.player.hp + value); this.fx('heal', s.player.x, s.player.y, '#96ffce', 3, .5); }
    this.emit('pickup');
  }
  private draft() {
    const pool = UPGRADES.filter(u => this.rank(u.id) < u.max); const result = [];
    while (pool.length && result.length < 3) { const index = Math.floor(this.random() * pool.length); result.push(pool.splice(index, 1)[0]); }
    this.state.choices = result;
  }
  private levelUp() {
    const s = this.state; s.player.xp -= s.player.nextXp; s.player.level++; s.player.nextXp = 26 + s.player.level * 15; s.previousPhase = 'playing'; s.phase = 'upgrade'; this.draft(); this.emit('levelup');
    if (!s.choices.length) { s.phase = 'playing'; s.player.hp = s.player.maxHp; }
  }
  chooseUpgrade(id: UpgradeId) {
    const s = this.state;
    if (s.phase !== 'upgrade' || !s.choices.some(c => c.id === id)) return false;
    this.applyUpgrade(id); s.choices = []; s.phase = s.previousPhase; this.emit('upgrade'); return true;
  }
  applyUpgrade(id: UpgradeId) {
    const s = this.state, p = s.player, def = UPGRADES.find(u => u.id === id); if (!def || this.rank(id) >= def.max) return;
    s.upgrades[id] = this.rank(id) + 1;
    if (id === 'damage') p.damage += SHIPS.find(x => x.id === s.ship)!.damage * .2;
    if (id === 'overdrive') { p.damage += .35; p.maxHp = Math.max(30, p.maxHp - 15); p.hp = Math.min(p.hp, p.maxHp); }
    if (id === 'firerate') p.fireRate += .15;
    if (id === 'crit') p.crit = Math.min(.85, p.crit + .1);
    if (id === 'hull') { p.maxHp += 30; p.hp = Math.min(p.maxHp, p.hp + 35); }
    if (id === 'shield') { p.maxShield += 25; p.shield = p.maxShield; }
    if (id === 'speed') p.speed += SHIPS.find(x => x.id === s.ship)!.speed * .12;
  }
  reroll() { const s = this.state; if (s.phase !== 'upgrade' || s.rerolls <= 0) return false; s.rerolls--; this.draft(); this.emit('click'); return true; }
  purchase(id: 'repair' | 'module' | 'charge') {
    const s = this.state, cost = { repair: 40, module: 95, charge: 30 }[id];
    if (s.phase !== 'station' || s.stationBought.includes(id) || s.stats.scrap < cost) return false;
    if (id === 'repair' && s.player.hp >= s.player.maxHp || id === 'charge' && s.player.pulse >= 100) return false;
    s.stats.scrap -= cost; s.stationBought.push(id);
    if (id === 'repair') s.player.hp = s.player.maxHp;
    if (id === 'charge') s.player.pulse = 100;
    if (id === 'module') { s.previousPhase = 'station'; s.phase = 'upgrade'; this.draft(); }
    this.emit('upgrade'); return true;
  }
  continueSector() {
    const s = this.state; if (s.phase !== 'station') return;
    s.sector++; s.wave = 1; s.waveTime = 0; s.waveDuration = 38; s.bossSpawned = false; s.enemies = []; s.bullets = []; s.effects = []; s.pickups = []; s.player.x = 0; s.player.y = 0; s.player.vx = 0; s.player.vy = 0; s.spawnTimer = 2; s.intermission = 0; s.phase = 'playing';
    this.banner(`SEKTOR 0${s.sector + 1}`, SECTORS[s.sector].name, 4); this.emit('start');
  }
  score() { const s = this.state; return Math.floor(s.stats.kills * 100 + s.stats.bosses * 2500 + s.stats.maxCombo * 30 + s.player.level * 150 + (s.phase === 'victory' ? 10000 : 0)); }
  finish(save: SaveData) {
    if (this.awarded || !['victory', 'defeat'].includes(this.state.phase)) return { save, earned: 0, achievements: [] as string[] };
    this.awarded = true;
    const s = this.state, updated = structuredClone(save), earned = Math.floor(s.stats.kills / 5) + s.stats.bosses * 25 + (s.phase === 'victory' ? 80 : 5);
    updated.totalRuns++; updated.totalKills += s.stats.kills; updated.bestSector = Math.max(updated.bestSector, s.sector + 1); updated.bestScore = Math.max(updated.bestScore, this.score()); updated.shards += earned; if (s.phase === 'victory') updated.wins++;
    const checks: Record<string, boolean> = { first: true, hunter: updated.totalKills >= 100, ace: updated.totalKills >= 500, boss: s.stats.bosses > 0, win: s.phase === 'victory', combo: s.stats.maxCombo >= 25 };
    const achievements: string[] = [];
    for (const a of ACHIEVEMENTS) if (checks[a.id] && !updated.achievements.includes(a.id)) { updated.achievements.push(a.id); updated.shards += a.reward; achievements.push(a.id); }
    return { save: updated, earned, achievements };
  }
}
