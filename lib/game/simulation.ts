import {
  ACHIEVEMENTS,
  ENEMY_DATA,
  SECTORS,
  SHIPS,
  UPGRADES,
  WEAPONS,
  freshSave,
} from './content';
import type {
  Bullet,
  Effect,
  Enemy,
  EnemyKind,
  GameEvent,
  GameInput,
  GameState,
  Player,
  SaveData,
  ShipId,
  UpgradeId,
  Vec,
  WeaponId,
} from './types';

import { DIFFICULTIES, cleanOptions, bossFor, BOSS_VARIANTS, sectorNumber } from './rules';
import type { Difficulty, RoomOptions, PilotId } from './types';

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
    const count = (v: unknown, max = 1e9) =>
      typeof v === 'number' && Number.isFinite(v)
        ? clamp(Math.floor(v), 0, max)
        : 0;
    return {
      ...base,
      shards: count(data.shards),
      totalRuns: count(data.totalRuns),
      wins: count(data.wins),
      bestScore: count(data.bestScore),
      bestSector: count(data.bestSector, 1000000),
      totalKills: count(data.totalKills),
      ship: SHIPS.some((s) => s.id === data.ship) ? data.ship : base.ship,
      weapon: WEAPONS.some((w) => w.id === data.weapon)
        ? data.weapon
        : base.weapon,
      meta: {
        hull: count(data.meta?.hull, 5),
        damage: count(data.meta?.damage, 5),
        fortune: count(data.meta?.fortune, 5),
      },
      achievements: Array.isArray(data.achievements)
        ? data.achievements.filter((v: unknown) =>
            ACHIEVEMENTS.some((a) => a.id === v),
          )
        : [],
      settings: {
        volume:
          typeof data.settings?.volume === 'number' &&
          Number.isFinite(data.settings.volume)
            ? clamp(data.settings.volume, 0, 1)
            : 0.45,
        muted: data.settings?.muted === true,
        shake: data.settings?.shake !== false,
        quality: data.settings?.quality === 'low' ? 'low' : 'high',
        autoFire: data.settings?.autoFire !== false,
      },
    };
  } catch {
    return base;
  }
}

export class Simulation {
  state: GameState;
  events: GameEvent[] = [];
  private id = 1;
  private randomState: number;
  private awarded = false;
  private activePilot: PilotId = 0;
  constructor(
    ship: ShipId = 'kestrel',
    weapon: WeaponId = 'pulse',
    save: SaveData = freshSave(),
    seed = Date.now(),
    difficulty: Difficulty = 'normal',
    options: Partial<RoomOptions> = {},
  ) {
    this.randomState = seed >>> 0 || 1;
    const spec = SHIPS.find((s) => s.id === ship)!;
    const hp = spec.hp + save.meta.hull * 8;
    this.state = {
      ...cleanOptions({ difficulty, ...options }),
      loop: 0, partnerUpgrades: {}, partnerChoices: [], partnerRerolls: 2, draftId: 0,
      phase: 'menu',
      previousPhase: 'playing',
      ship,
      weapon,
      player: {
        kills: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        angle: -Math.PI / 2,
        hp,
        maxHp: hp,
        shield: spec.shield,
        maxShield: spec.shield,
        speed: spec.speed,
        damage: spec.damage * (1 + save.meta.damage * 0.04),
        fireRate: 1,
        crit: 0.1,
        dashTimer: 0,
        dashCooldown: 0,
        invulnerable: 0,
        hitTimer: 10,
        shootTimer: 0,
        pulse: 60,
        level: 1,
        xp: 0,
        nextXp: 30,
        regenTimer: 0,
        missileTimer: 1,
        droneTimer: 0,
        orbitalTimer: 0,
      },
      enemies: [],
      bullets: [],
      pickups: [],
      effects: [],
      sector: 0,
      wave: 1,
      waveTime: 0,
      time: 0,
      totalTime: 0,
      waveDuration: 38,
      spawnTimer: 1.6,
      intermission: 0,
      bossSpawned: false,
      stats: {
        kills: 0,
        damage: 0,
        damageTaken: 0,
        scrap: 0,
        totalScrap: 0,
        shots: 0,
        hits: 0,
        elites: 0,
        bosses: 0,
        maxCombo: 0,
      },
      upgrades: {},
      choices: [],
      combo: 0,
      comboTime: 0,
      banner: '',
      bannerSub: '',
      bannerTime: 0,
      seed,
      autoFire: save.settings.autoFire,
      screenShake: 0,
      stationBought: [],
      rerolls: 2 + save.meta.fortune,
    };
  }
  random() {
    let x = this.randomState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x >>> 0;
    return this.randomState / 4294967296;
  }
  private ranks(pilot: PilotId = this.activePilot) {
    return pilot === 1 && !this.state.sharedUpgrades ? this.state.partnerUpgrades : this.state.upgrades;
  }
  private rank(id: UpgradeId, pilot: PilotId = this.activePilot) { return this.ranks(pilot)[id] || 0; }
  private get rules() { return DIFFICULTIES[this.state.difficulty]; }
  private emit(type: string, value?: number) {
    this.events.push({ type, value });
  }
  private fx(
    kind: Effect['kind'],
    x: number,
    y: number,
    color: string,
    size = 1,
    life = 0.5,
    extra: Partial<Effect> = {},
  ) {
    if (this.state.effects.length > 200) this.state.effects.splice(0, 20);
    this.state.effects.push({
      id: this.id++,
      kind,
      x,
      y,
      color,
      size,
      life,
      maxLife: life,
      ...extra,
    });
  }
  start() {
    this.state.phase = 'playing';
    this.banner(this.state.mode === 'endless' ? 'ENDLESS EXPEDITION' : 'SECTOR 01', SECTORS[0].name);
    this.emit('start');
  }
  private banner(title: string, subtitle: string, duration = 3.5) {
    Object.assign(this.state, {
      banner: title,
      bannerSub: subtitle,
      bannerTime: duration,
    });
  }
  pause() {
    if (this.state.phase === 'playing') {
      this.state.phase = 'paused';
      this.emit('pause');
    }
  }
  resume() {
    if (this.state.phase === 'paused') {
      this.state.phase = 'playing';
      this.emit('resume');
    }
  }
  toggleAutoFire() {
    this.state.autoFire = !this.state.autoFire;
  }
  private boundary(v: Vec, limit = ARENA_RADIUS) {
    const d = Math.hypot(v.x, v.y);
    if (d > limit) {
      v.x *= limit / d;
      v.y *= limit / d;
    }
  }

  step(dt: number, input: GameInput, partnerInput?: GameInput) {
    const s = this.state,
      p = s.player;
    if (s.phase !== 'playing') return;
    if (!Number.isFinite(dt)) return;
    dt = clamp(dt, 0, 0.035);
    s.time += dt;
    s.totalTime += dt;
    s.waveTime += dt;
    s.screenShake = Math.max(0, s.screenShake - dt * 3);
    s.bannerTime = Math.max(0, s.bannerTime - dt);
    s.comboTime -= dt;
    if (s.comboTime <= 0) s.combo = 0;
    this.updatePilot(p, s.ship, s.weapon, s.autoFire, input, dt);
    if (s.phase !== 'playing') return;
    if (s.partner && partnerInput)
      this.updatePilot(
        s.partner,
        s.partnerShip!,
        s.partnerWeapon!,
        !!s.partnerAutoFire,
        partnerInput,
        dt,
      );
    if (s.phase !== 'playing') return;
    this.spawning(dt);
    for (const e of s.enemies) if (e.hp > 0) this.updateEnemy(e, dt);
    for (const b of s.bullets) {
      if (s.phase !== 'playing') break;
      this.updateBullet(b, dt);
    }
    s.bullets = s.bullets.filter(
      (b) => b.life > 0 && Math.abs(b.x) < 110 && Math.abs(b.y) < 110,
    );
    s.enemies = s.enemies.filter((e) => e.hp > 0);
    for (const item of s.pickups) {
      item.age += dt;
      const collector = this.closestPilot(item);
      const d = distance(item, collector),
        magnet =
          7 * (1 + this.rank('magnet', collector === s.partner ? 1 : 0) * 0.6 + this.rank('speed', collector === s.partner ? 1 : 0) * 0.15);
      if (d < magnet || item.age > 20 || s.intermission > 0) {
        const a = angleTo(item, collector),
          v = Math.min(d, (13 + 180 / (d + 2)) * dt);
        item.x += Math.cos(a) * v;
        item.y += Math.sin(a) * v;
      }
      if (d < 1.7) {
        this.collect(item.kind, item.value, collector);
        item.value = 0;
      }
    }
    s.pickups = s.pickups.filter((i) => i.value > 0);
    for (const f of s.effects) f.life -= dt;
    s.effects = s.effects.filter((f) => f.life > 0);
    if (
      s.phase === 'playing' &&
      this.pilots().every((pilot) => pilot.hp <= 0)
    ) {
      s.phase = 'defeat';
      this.emit('defeat');
      this.fx('explosion', p.x, p.y, '#ff945e', 8, 2);
    }
    if (s.phase === 'playing' && p.xp >= p.nextXp) this.levelUp();
    if (s.partner) {
      s.partner.xp = p.xp;
      s.partner.level = p.level;
      s.partner.nextXp = p.nextXp;
    }
  }

  addPartner(ship: ShipId, weapon: WeaponId, save = freshSave()) {
    if (this.state.phase !== 'menu' || this.state.partner) return;
    const other = new Simulation(ship, weapon, save, this.state.seed);
    this.state.partner = other.state.player;
    this.state.partner.x = 5;
    this.state.player.x = -5;
    this.state.partnerShip = ship;
    this.state.partnerWeapon = weapon;
    this.state.partnerAutoFire = save.settings.autoFire;
    this.state.partnerRerolls = 2 + save.meta.fortune;
  }
  private pilots() {
    return this.state.partner
      ? [this.state.player, this.state.partner]
      : [this.state.player];
  }
  private closestPilot(origin: Vec) {
    return (
      this.pilots()
        .filter((p) => p.hp > 0)
        .sort((a, b) => distance(origin, a) - distance(origin, b))[0] ||
      this.state.player
    );
  }
  private restorePilots(hull: number) {
    for (const p of this.pilots()) {
      p.hp = Math.min(
        p.maxHp,
        Math.max(p.hp + hull, p.hp <= 0 ? p.maxHp * 0.5 : 0),
      );
      p.invulnerable = 2;
    }
  }
  private updatePilot(
    p: Player,
    ship: ShipId,
    weapon: WeaponId,
    autoFire: boolean,
    input: GameInput,
    dt: number,
  ) {
    this.activePilot = p === this.state.partner ? 1 : 0;
    if (p.hp <= 0) {
      p.vx = 0;
      p.vy = 0;
      return;
    }
    const s = this.state;
    p.hitTimer += dt;
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    p.shootTimer = Math.max(0, p.shootTimer - dt);
    p.missileTimer -= dt;
    p.droneTimer -= dt;
    p.orbitalTimer -= dt;
    if (p.hitTimer > 3.5 && p.shield < p.maxShield)
      p.shield = Math.min(
        p.maxShield,
        p.shield + (12 + this.rank('shield') * 3) * dt,
      );
    if (this.rank('regen')) {
      p.regenTimer += dt;
      if (p.regenTimer >= 8 / this.rank('regen')) {
        p.regenTimer = 0;
        p.hp = Math.min(p.maxHp, p.hp + 4);
      }
    }
    p.pulse = Math.min(100, p.pulse + dt * 0.7);
    const aim = Math.atan2(input.aimY - p.y, input.aimX - p.x);
    if (Number.isFinite(aim)) p.angle = aim;
    let ix = input.x,
      iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    if (input.dash && p.dashCooldown <= 0) {
      const a = len > 0.1 ? Math.atan2(iy, ix) : p.angle;
      p.vx = Math.cos(a) * 65;
      p.vy = Math.sin(a) * 65;
      p.dashTimer = 0.2;
      p.invulnerable = 0.34;
      p.dashCooldown =
        SHIPS.find((x) => x.id === ship)!.dash *
        Math.pow(0.8, this.rank('dash'));
      this.fx('dash', p.x, p.y, '#82ffe3', 4, 0.45);
      this.emit('dash');
      if (this.rank('dash'))
        for (const e of s.enemies)
          if (distance(e, p) < 8)
            this.damageEnemy(e, 35 * this.rank('dash'), false);
    }
    if (p.dashTimer <= 0) {
      const smooth = 1 - Math.exp(-dt * 14);
      p.vx += (ix * p.speed - p.vx) * smooth;
      p.vy += (iy * p.speed - p.vy) * smooth;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.boundary(p, ARENA_RADIUS - 1.5);
    if (input.pulse && p.pulse >= 100) {
      p.pulse = 0;
      p.invulnerable = Math.max(p.invulnerable, 0.65);
      this.fx('pulse', p.x, p.y, '#9affea', 25, 0.8);
      s.screenShake = 1;
      this.emit('pulse');
      for (const e of s.enemies)
        if (distance(e, p) < 26) {
          this.damageEnemy(e, 140 * (1 + this.rank('pulse') * 0.35), false);
          if (e.kind !== 'boss') {
            const a = angleTo(p, e);
            e.x += Math.cos(a) * 4;
            e.y += Math.sin(a) * 4;
          }
        }
      s.bullets = s.bullets.filter((b) => !b.hostile || distance(b, p) > 30);
    }
    if ((input.firing || autoFire) && p.shootTimer <= 0 && s.intermission <= 0)
      this.shoot(p, weapon);
    this.auxiliaries(p);
  }
  private shoot(p: Player, weapon: WeaponId) {
    const s = this.state,
      w = WEAPONS.find((w) => w.id === weapon)!;
    const extra = this.rank('multishot'),
      count = w.count + extra;
    p.shootTimer = w.rate / p.fireRate;
    for (let i = 0; i < count; i++) {
      const spread = w.count > 1 ? w.spread : count > 1 ? 0.13 : w.spread;
      const a =
        p.angle +
        (i - (count - 1) / 2) * spread +
        (this.random() - 0.5) * 0.013;
      const crit = this.random() < p.crit;
      this.addBullet(
        p.x + Math.cos(a) * 1.5,
        p.y + Math.sin(a) * 1.5,
        a,
        w.speed,
        w.damage * p.damage * (i >= w.count ? 0.7 : 1) * (crit ? 2 : 1),
        false,
        w.color,
        weapon === 'rail' ? 'rail' : 'bolt',
        w.pierce + this.rank('pierce'),
        crit,
      );
    }
    s.stats.shots += count;
    this.emit(
      'shoot',
      weapon === 'rail' ? 0.6 : weapon === 'scatter' ? 0.8 : 1,
    );
  }
  private addBullet(
    x: number,
    y: number,
    a: number,
    speed: number,
    damage: number,
    hostile: boolean,
    color: string,
    type: Bullet['type'] = 'bolt',
    pierce = 0,
    crit = false,
  ) {
    if (this.state.bullets.length >= 700) return;
    if (hostile) speed *= this.rules.projectile * Math.min(1.3, 1 + this.state.loop * .035);
    this.state.bullets.push({
      owner: hostile ? undefined : this.activePilot,
      id: this.id++,
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      damage,
      radius: hostile ? 0.48 : type === 'rail' ? 0.5 : 0.3,
      life: type === 'missile' ? 4 : hostile ? 7 : 1.6,
      hostile,
      color,
      pierce,
      hitIds: [],
      type,
      crit,
    });
  }
  private nearest(origin: Vec, max = 100, except = -1) {
    let best: Enemy | undefined,
      d = max;
    for (const e of this.state.enemies) {
      if (e.hp <= 0 || e.id === except || e.age < 0.65) continue;
      const n = distance(origin, e);
      if (n < d) {
        d = n;
        best = e;
      }
    }
    return best;
  }
  private auxiliaries(p: Player) {
    const s = this.state;
    if (this.rank('missiles') && p.missileTimer <= 0) {
      const target = this.nearest(p, 45);
      if (target) {
        for (let i = 0; i < this.rank('missiles'); i++)
          this.addBullet(
            p.x,
            p.y,
            p.angle + (i - 0.5) * 0.7,
            28,
            38 * p.damage,
            false,
            '#ffa26d',
            'missile',
          );
        p.missileTimer = 3;
      }
    }
    if (this.rank('drones') && p.droneTimer <= 0) {
      const target = this.nearest(p, 35);
      if (target) {
        for (let i = 0; i < this.rank('drones'); i++) {
          const a = s.time * 0.7 + (i * TAU) / this.rank('drones'),
            pos = { x: p.x + Math.cos(a) * 4, y: p.y + Math.sin(a) * 4 };
          this.addBullet(
            pos.x,
            pos.y,
            angleTo(pos, target),
            58,
            11 * p.damage,
            false,
            '#b5a0ff',
          );
        }
        p.droneTimer = 0.4;
      }
    }
    if (this.rank('orbitals') && p.orbitalTimer <= 0) {
      const n = this.rank('orbitals') * 2;
      for (let i = 0; i < n; i++) {
        const a = s.time * 2 + (i * TAU) / n,
          pos = { x: p.x + Math.cos(a) * 5.5, y: p.y + Math.sin(a) * 5.5 };
        for (const e of s.enemies)
          if (distance(pos, e) < e.radius + 1.5)
            this.damageEnemy(e, 14 * p.damage, false);
      }
      p.orbitalTimer = 0.2;
    }
  }

  private spawning(dt: number) {
    const s = this.state;
    if (s.intermission > 0) {
      s.intermission -= dt;
      if (s.intermission <= 0) this.nextWave();
      return;
    }
    if (s.wave === 4) {
      if (!s.bossSpawned) {
        s.bossSpawned = true;
        this.spawn('boss');
        this.banner(
          BOSS_VARIANTS[bossFor(s)].name,
          BOSS_VARIANTS[bossFor(s)].subtitle,
          4,
        );
        this.emit('boss');
      }
      return;
    }
    if (s.waveTime >= s.waveDuration) {
      if (s.enemies.length === 0) {
        s.intermission = 3.8;
        this.banner('WAVE COMPLETE', '+20 HULL · SALVAGE ACTIVE', 3);
        this.restorePilots(20);
        for (const i of s.pickups) this.collect(i.kind, i.value);
        s.pickups = [];
      }
      return;
    }
    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0 && s.enemies.length < Math.min(80, this.rules.enemies + s.loop * 3)) {
      const progress = (sectorNumber(s) - 1) * 3 + s.wave - 1;
      s.spawnTimer =
        Math.max(0.28, (1.65 - Math.min(9, progress) * 0.13) / this.rules.pressure / (1 + s.loop * .08)) * (0.7 + this.random() * 0.6);
      const pool: EnemyKind[] = ['drone', 'drone', 'swarm'];
      if (s.wave >= 2 || s.sector > 0) pool.push('gunner', 'striker');
      if (s.sector > 0 || s.loop > 0) pool.push('bomber', 'warden', 'anchor', 'brood');
      if (s.wave >= 2 || s.loop > 0) pool.push('lancer', 'manta');
      const kind = pool[Math.floor(this.random() * pool.length)];
      this.spawn(
        kind,
        undefined,
        undefined,
        progress >= 2 && this.random() < Math.min(.3, (.07 + s.sector * .025 + s.loop * .025) * this.rules.pressure),
      );
      if (kind === 'swarm') for (let i = 0; i < 2; i++) this.spawn('swarm');
    }
  }
  private nextWave() {
    const s = this.state;
    s.wave++;
    s.waveTime = 0;
    s.waveDuration = 33 + s.wave * 5;
    s.spawnTimer = 1.2;
    if (s.wave < 4)
      this.banner(
        `WAVE ${String(s.wave).padStart(2, '0')}`,
        SECTORS[s.sector].name,
      );
  }
  spawn(kind: EnemyKind, x?: number, y?: number, elite = false) {
    const s = this.state,
      data = ENEMY_DATA[kind],
      a = this.random() * TAU;
    const pos = {
      x: x ?? s.player.x + Math.cos(a) * 37,
      y: y ?? s.player.y + Math.sin(a) * 37,
    };
    this.boundary(pos, ARENA_RADIUS - 3);
    if (distance(pos, s.player) < 17) {
      pos.x = -s.player.x * 0.7 + Math.cos(a) * 12;
      pos.y = -s.player.y * 0.7 + Math.sin(a) * 12;
    }
<<<<<<< HEAD
    const depth = sectorNumber(s) - 1;
    const scale = (1 + depth * .55) * this.rules.health;
    const baseHp =
      kind === 'boss'
        ? (2100 + 1900 * depth + 225 * depth * depth) * this.rules.health
=======
    const scale = (1 + s.sector * .55 + s.loop * 1.2) * this.rules.health;
    const baseHp =
      kind === 'boss'
        ? [2100, 4200, 6800][s.sector] * this.rules.health * (1 + s.loop * 1.25)
>>>>>>> b8f51e1edfa8d796a1381972caf7d0705a7aa6bc
        : data.hp * scale * (elite ? 2.5 : 1);
    const hp = baseHp * (s.partner ? 1.65 : 1);
    const e: Enemy = {
      id: this.id++,
      ...pos,
      kind,
      bossVariant: kind === 'boss' ? bossFor(s) : 0,
      telegraphKind: 'ring',
      hp,
      maxHp: hp,
      radius: data.radius * (elite ? 1.2 : 1),
      speed: data.speed * this.rules.speed * Math.min(1.4, 1 + s.loop * .045),
      damage:
        data.damage *
<<<<<<< HEAD
        (1 + depth * 0.16) * this.rules.damage,
=======
        (1 + s.sector * 0.16) *
        this.rules.damage * (1 + s.loop * .22),
>>>>>>> b8f51e1edfa8d796a1381972caf7d0705a7aa6bc
      angle: angleTo(pos, s.player),
      cooldown: 1.5 + this.random(),
      age: 0,
      vx: 0,
      vy: 0,
      hit: 0,
      slow: 0,
      elite,
      bossPhase: 1,
      attack: 0,
      telegraph: 0,
      targetX: 0,
      targetY: 0,
    };
    if (s.enemies.length < 80 || kind === 'boss') s.enemies.push(e);
    this.fx('spawn', pos.x, pos.y, data.color, e.radius * 2, 0.7);
    return e;
  }
  private updateEnemy(e: Enemy, dt: number) {
    const s = this.state,
      p = this.closestPilot(e);
    e.age += dt;
    e.hit = Math.max(0, e.hit - dt);
    e.slow = Math.max(0, e.slow - dt);
    if (e.age < 0.7) return;
    e.cooldown -= dt * this.rules.pressure;
    const d = distance(e, p),
      a = angleTo(e, p);
    let speed =
      e.speed *
      (e.slow > 0
        ? e.kind === 'boss'
          ? 0.92
          : .5
        : 1);
    e.angle += normalizeAngle(a - e.angle) * Math.min(1, dt * 5);
    if (e.kind === 'boss') {
      this.updateBoss(e, dt, a, d);
      return;
    }
    if (['lancer', 'brood', 'manta', 'anchor'].includes(e.kind)) {
      this.updateSpecialEnemy(e, p, dt, a, d);
      return;
    }
    let moveAngle = a;
    if (e.kind === 'gunner' || e.kind === 'bomber' || e.kind === 'warden') {
      if (d < 17) moveAngle += Math.PI / 2 + 0.6;
      else if (d < 23) moveAngle += Math.PI / 2;
    }
    if (e.kind === 'striker') {
      if (e.telegraph > 0) {
        e.telegraph -= dt;
        speed = 0.5;
        if (e.telegraph <= 0) {
          e.vx = Math.cos(e.targetX) * 35;
          e.vy = Math.sin(e.targetX) * 35;
          e.attack = 0.55;
        }
      } else if (e.attack > 0) {
        e.attack -= dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        speed = 0;
      } else if (e.cooldown <= 0) {
        e.cooldown = 4;
        e.telegraph = Math.max(.65, .85 * this.rules.warning);
        e.telegraphKind = 'line';
        e.targetX = a;
      }
    }
    e.x += Math.cos(moveAngle) * speed * dt;
    e.y += Math.sin(moveAngle) * speed * dt;
    this.boundary(e, ARENA_RADIUS - 1);
    if (e.cooldown <= 0) {
      if (e.kind === 'gunner') {
        this.addBullet(e.x, e.y, a, 15, e.damage, true, '#ff8768', 'orb');
        e.cooldown = 2.3;
      } else if (e.kind === 'bomber') {
        for (let i = 0; i < 9; i++)
          this.addBullet(
            e.x,
            e.y,
            (i * TAU) / 9 + e.age,
            9,
            e.damage,
            true,
            '#dd9aff',
            'orb',
          );
        e.cooldown = 3.6;
      } else if (e.kind === 'warden') {
        for (let i = -2; i <= 2; i++)
          this.addBullet(
            e.x,
            e.y,
            a + i * 0.19,
            13,
            e.damage,
            true,
            '#ffb778',
            'orb',
          );
        e.cooldown = 2.7;
      }
    }
    for (const pilot of this.pilots())
      if (distance(e, pilot) < e.radius + 0.95)
        this.hurtPlayer(e.damage, pilot);
    // Soft local separation prevents stacked contact enemies without changing their intent.
    for (const other of s.enemies) {
      if (other.id <= e.id || other.hp <= 0) continue;
      const sep = distance(e, other),
        desired = (e.radius + other.radius) * 0.7;
      if (sep < desired && sep > 0.01) {
        const push = (desired - sep) * dt * 2;
        const nx = (e.x - other.x) / sep,
          ny = (e.y - other.y) / sep;
        e.x += nx * push;
        e.y += ny * push;
        other.x -= nx * push;
        other.y -= ny * push;
      }
    }
  }
  private radialBurst(x: number, y: number, count: number, speed: number, damage: number, color: string, offset = 0, gap?: number) {
    for (let i = 0; i < count; i++) {
      const a = i * TAU / count + offset;
      if (gap !== undefined && Math.abs(normalizeAngle(a - gap)) < .5) continue;
      this.addBullet(x, y, a, speed, damage, true, color, 'orb');
    }
  }
  private updateSpecialEnemy(e: Enemy, p: Player, dt: number, a: number, d: number) {
    const s = this.state, color = ENEMY_DATA[e.kind].color;
    const orbit = a + (d < 24 ? Math.PI / 2 : 0) + (e.kind === 'manta' ? Math.sin(e.age * 1.8) * .85 : 0);
    if (e.telegraph <= 0 || e.kind === 'manta') {
      e.x += Math.cos(orbit) * e.speed * (e.slow > 0 ? .5 : 1) * dt;
      e.y += Math.sin(orbit) * e.speed * (e.slow > 0 ? .5 : 1) * dt;
    }
    this.boundary(e, ARENA_RADIUS - 2);
    if (e.telegraph > 0) {
      e.telegraph -= dt;
      if (e.telegraph <= 0) {
        if (e.kind === 'lancer') {
          for (let i = -1; i <= 1; i++) this.addBullet(e.x, e.y, e.targetX + i * .055, 29, e.damage, true, color, 'orb');
        } else if (e.kind === 'brood') {
          for (let i = 0; i < 3 && s.enemies.length < 80; i++) this.spawn('swarm', e.x + Math.cos(i * TAU / 3) * 3, e.y + Math.sin(i * TAU / 3) * 3);
          this.fx('spawn', e.x, e.y, color, 5, .6);
        } else if (e.kind === 'anchor') {
          this.fx('pulse', e.targetX, e.targetY, color, 6, .65);
          for (const pilot of this.pilots()) if (distance(pilot, { x: e.targetX, y: e.targetY }) < 5.5) this.hurtPlayer(e.damage, pilot);
          this.radialBurst(e.targetX, e.targetY, 10, 8, e.damage * .65, color);
        }
        e.cooldown = e.kind === 'brood' ? 6 : 3.7;
        this.emit('enemyShoot');
      }
    } else if (e.cooldown <= 0) {
      if (e.kind === 'manta') {
        e.attack++;
        for (let i = 0; i < 5; i++) this.addBullet(e.x, e.y, a + (i - 2) * .22 + (e.attack % 2 ? .3 : -.3), 12, e.damage, true, color, 'orb');
        e.cooldown = 2.8;
      } else {
        e.telegraph = Math.max(.75, (e.kind === 'anchor' ? 1.5 : 1.2) * this.rules.warning);
        e.telegraphKind = e.kind === 'lancer' ? 'line' : e.kind === 'anchor' ? 'target' : 'ring';
        e.targetX = e.kind === 'anchor' ? p.x : a;
        e.targetY = e.kind === 'anchor' ? p.y : 0;
      }
    }
    for (const pilot of this.pilots()) if (distance(e, pilot) < e.radius + .9) this.hurtPlayer(e.damage, pilot);
  }
  private updateNewBoss(e: Enemy, dt: number, a: number, d: number) {
    const s = this.state, def = BOSS_VARIANTS[e.bossVariant];
    const phase = e.hp > e.maxHp * .7 ? 1 : e.hp > e.maxHp * .35 ? 2 : 3;
    if (phase !== e.bossPhase) {
      e.bossPhase = phase; e.cooldown = 1.2; e.telegraph = 0;
      this.fx('pulse', e.x, e.y, def.color, 12, .8);
      this.banner(`PHASE ${phase}`, def.subtitle, 2);
    }
    if (e.telegraph <= 0) {
      const orbit = d > 25 ? a : a + Math.PI / 2;
      e.x += Math.cos(orbit) * e.speed * dt; e.y += Math.sin(orbit) * e.speed * dt;
      this.boundary(e, ARENA_RADIUS - 8);
    }
    if (e.telegraph > 0) {
      e.telegraph -= dt;
      if (e.bossVariant === 3) {
        const well = { x: e.targetX, y: e.targetY };
        for (const pilot of this.pilots()) if (pilot.hp > 0 && pilot.dashTimer <= 0 && distance(pilot, well) < 20 && distance(pilot, well) > 1) {
          const pull = angleTo(pilot, well);
          pilot.x += Math.cos(pull) * 3.5 * dt; pilot.y += Math.sin(pull) * 3.5 * dt;
        }
      }
      if (e.telegraph <= 0) {
        if (e.bossVariant === 4) {
          for (let arm = 0; arm < 4; arm++) for (let i = -phase; i <= phase; i++)
            this.addBullet(e.x, e.y, e.targetX + arm * TAU / 4 + i * .07, 18 + phase, e.damage, true, def.color, 'orb');
          this.fx('pulse', e.x, e.y, def.color, 9, .45);
        } else {
          const radius = e.bossVariant === 3 ? 7 : 5;
          this.fx('pulse', e.targetX, e.targetY, def.color, radius + 1, .7);
          for (const pilot of this.pilots()) if (distance(pilot, { x: e.targetX, y: e.targetY }) < radius)
            this.hurtPlayer(e.damage * 1.3, pilot);
          this.radialBurst(e.targetX, e.targetY, e.bossVariant === 3 ? 20 : 12, e.bossVariant === 3 ? 10 : 15, e.damage * .75, def.color, e.attack * .15, angleTo({ x: e.targetX, y: e.targetY }, e));
          if (e.bossVariant === 5 && phase >= 2) {
            // Slow outer fire keeps pressure on pilots after the marked strike.
            this.radialBurst(e.x, e.y, 10 + phase * 2, 8, e.damage * .65, def.color, e.age);
          }
        }
        e.cooldown = e.bossVariant === 5 ? 1.6 - phase * .15 : 2.5 - phase * .25;
        this.emit('enemyShoot');
      }
    } else if (e.cooldown <= 0) {
      const target = this.closestPilot(e);
      e.attack++;
      e.telegraph = Math.max(.85, (e.bossVariant === 3 ? 1.65 : 1.35) * this.rules.warning);
      e.telegraphKind = e.bossVariant === 4 ? 'cross' : 'target';
      e.targetX = e.bossVariant === 4 ? a + e.attack * .19 : target.x;
      e.targetY = e.bossVariant === 4 ? 0 : target.y;
      if (phase >= 2 && e.attack % 4 === 0 && s.enemies.length < 12) {
        for (let i = 0; i < 2; i++) this.spawn(e.bossVariant === 3 ? 'anchor' : e.bossVariant === 4 ? 'manta' : 'lancer', e.x + (i ? 8 : -8), e.y + 5);
      }
    }
    for (const pilot of this.pilots()) if (distance(e, pilot) < e.radius + 1) this.hurtPlayer(e.damage * 1.4, pilot);
  }
  private updateBoss(e: Enemy, dt: number, a: number, d: number) {
    const s = this.state;
    if (e.bossVariant >= 3) { this.updateNewBoss(e, dt, a, d); return; }
    const phase = e.hp > e.maxHp * 0.7 ? 1 : e.hp > e.maxHp * 0.35 ? 2 : 3;
    if (phase !== e.bossPhase) {
      e.bossPhase = phase;
      e.cooldown = 1.4;
      e.telegraph = 0;
      e.attack = 0;
      this.fx('pulse', e.x, e.y, SECTORS[s.sector].color, 12, 0.7);
      this.banner(`PHASE ${phase}`, 'ENERGY SIGNATURE RISING', 2);
    }
    const move = d > 23 ? a : a + Math.PI / 2;
    e.x += Math.cos(move) * e.speed * dt;
    e.y += Math.sin(move) * e.speed * dt;
    this.boundary(e, ARENA_RADIUS - 8);
    if (e.telegraph > 0) {
      e.telegraph -= dt;
      if (e.telegraph <= 0) {
        const gap = e.targetX;
        const count = 16 + s.sector * 6;
        for (let i = 0; i < count; i++) {
          const angle = (i * TAU) / count + e.age * 0.1;
          if (
            Math.abs(normalizeAngle(angle - gap)) < 0.42 ||
            (s.sector === 2 &&
              Math.abs(normalizeAngle(angle - gap - Math.PI)) < 0.35)
          )
            continue;
          this.addBullet(
            e.x + Math.cos(angle) * 4,
            e.y + Math.sin(angle) * 4,
            angle,
            12 + s.sector,
            e.damage,
            true,
            SECTORS[s.sector].color,
            'orb',
          );
        }
        this.emit('enemyShoot');
        e.cooldown = phase === 3 ? 1.85 : 2.4;
      }
    } else if (e.cooldown <= 0) {
      e.attack++;
      if (e.attack % 3 === 0 || (phase === 3 && e.attack % 2 === 0)) {
        e.telegraph = Math.max(.7, this.rules.warning);
        e.telegraphKind = 'ring';
        e.targetX = a + 0.3;
        e.cooldown = 3;
      } else {
        const count = 5 + phase * 2 + s.sector * 2;
        for (let i = 0; i < count; i++)
          this.addBullet(
            e.x + Math.cos(a) * 4,
            e.y + Math.sin(a) * 4,
            a + (i - (count - 1) / 2) * 0.14,
            15 + s.sector,
            e.damage,
            true,
            '#ff8a72',
            'orb',
          );
        e.cooldown = 2.5 - phase * 0.2;
      }
      if (phase >= 2 && e.attack % 4 === 0 && s.enemies.length < 12)
        for (let i = 0; i < 3; i++)
          this.spawn(
            s.sector === 2 ? 'striker' : 'drone',
            e.x + Math.cos((i * TAU) / 3) * 8,
            e.y + Math.sin((i * TAU) / 3) * 8,
          );
    }
    for (const pilot of this.pilots())
      if (distance(e, pilot) < e.radius + 1)
        this.hurtPlayer(e.damage * 1.4, pilot);
  }

  private updateBullet(b: Bullet, dt: number) {
    this.activePilot = b.owner ?? 0;
    b.life -= dt;
    if (b.life <= 0) return;
    const s = this.state;
    if (b.type === 'missile') {
      const target = this.nearest(b, 45);
      if (target) {
        const a = angleTo(b, target),
          old = Math.atan2(b.vy, b.vx),
          next = old + normalizeAngle(a - old) * Math.min(1, dt * 5);
        b.vx = Math.cos(next) * 32;
        b.vy = Math.sin(next) * 32;
      }
    }
    const oldX = b.x,
      oldY = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // Segment collision keeps rail shots reliable on slow frames.
    const intersects = (v: Vec, r: number) => {
      const dx = b.x - oldX,
        dy = b.y - oldY;
      const t = clamp(
        ((v.x - oldX) * dx + (v.y - oldY) * dy) / (dx * dx + dy * dy || 1),
        0,
        1,
      );
      return (
        Math.hypot(v.x - oldX - dx * t, v.y - oldY - dy * t) < r + b.radius
      );
    };
    if (b.hostile) {
      for (const pilot of this.pilots())
        if (pilot.hp > 0 && intersects(pilot, 0.85)) {
          this.hurtPlayer(b.damage, pilot);
          b.life = 0;
          break;
        }
    } else
      for (const e of s.enemies) {
        if (
          e.hp <= 0 ||
          e.age < 0.65 ||
          b.hitIds.includes(e.id) ||
          !intersects(e, e.radius)
        )
          continue;
        s.stats.hits++;
        this.damageEnemy(e, b.damage, true, b.crit);
        b.hitIds.push(e.id);
        if (this.rank('freeze')) e.slow = 2;
        if (b.type === 'missile') {
          this.fx('explosion', b.x, b.y, '#ffa066', 4, 0.45);
          for (const other of s.enemies)
            if (other.id !== e.id && distance(other, e) < 5)
              this.damageEnemy(other, b.damage * 0.6, false);
        }
        if (
          this.rank('ricochet') &&
          this.random() < 0.35 * this.rank('ricochet')
        ) {
          const target = this.nearest(e, 16, e.id);
          if (target)
            this.addBullet(
              e.x,
              e.y,
              angleTo(e, target),
              60,
              b.damage * 0.5,
              false,
              '#c7a2ff',
              'bolt',
              0,
            );
        }
        if (b.pierce > 0) {
          b.pierce--;
          b.damage *= 0.9;
        } else {
          b.life = 0;
          break;
        }
      }
  }
  private damageEnemy(e: Enemy, damage: number, procs: boolean, crit = false) {
    if (e.hp <= 0) return;
    const s = this.state;
    s.stats.damage += Math.min(e.hp, damage);
    e.hp -= damage;
    e.hit = 0.09;
    this.fx(
      'hit',
      e.x,
      e.y,
      crit ? '#ffe5a3' : '#b8ffe9',
      crit ? 1.1 : 0.65,
      0.2,
    );
    if (crit || (e.kind === 'boss' && this.random() < 0.18))
      this.fx('text', e.x, e.y, crit ? '#ffcd83' : '#d7eee7', 1, 0.65, {
        text: `${Math.round(damage)}${crit ? '!' : ''}`,
      });
    this.emit('hit');
    if (procs && this.rank('chain') && this.random() < 0.2) {
      let from = e;
      const visited = [e.id];
      for (let i = 0; i < 1 + this.rank('chain'); i++) {
        let next: Enemy | undefined;
        let d = 13;
        for (const other of s.enemies)
          if (
            other.hp > 0 &&
            !visited.includes(other.id) &&
            distance(other, from) < d
          ) {
            next = other;
            d = distance(other, from);
          }
        if (!next) break;
        this.fx('chain', from.x, from.y, '#93cfff', 1, 0.22, {
          targetX: next.x,
          targetY: next.y,
        });
        this.damageEnemy(next, damage * 0.45, false);
        visited.push(next.id);
        from = next;
      }
    }
    if (e.hp <= 0) this.kill(e);
  }
  private kill(e: Enemy, suppressExplosion = false) {
<<<<<<< HEAD
    if (e.deathProcessed) return;
    e.deathProcessed = true;
=======
>>>>>>> b8f51e1edfa8d796a1381972caf7d0705a7aa6bc
    const s = this.state,
      p = this.activePilot === 1 && s.partner ? s.partner : s.player;
    s.stats.kills++;
    p.kills++;
    s.combo++;
    s.comboTime = 4.5;
    s.stats.maxCombo = Math.max(s.stats.maxCombo, s.combo);
    if (e.elite) s.stats.elites++;
    for (const p of this.pilots())
      p.pulse = Math.min(
        100,
        p.pulse +
          (e.kind === 'swarm' ? 1 : 2) * (1 + this.rank('pulse', p === s.partner ? 1 : 0) * 0.25),
      );
    this.fx('explosion', e.x, e.y, ENEMY_DATA[e.kind].color, e.radius * 2, 0.7);
    this.emit('explosion', e.kind === 'boss' ? 0.4 : 0.9 + this.random() * 0.3);
    s.screenShake = Math.min(
      1.4,
      s.screenShake + (e.kind === 'boss' ? 1.2 : 0.12),
    );
    const xp = ENEMY_DATA[e.kind].xp * (e.elite ? 2 : 1);
    const scrap = Math.ceil(
      (e.kind === 'boss' ? 80 : e.kind === 'swarm' ? 1 : 3) *
        (1 + this.rank('salvage') * 0.3) *
        (e.elite ? 3 : 1),
    );
    s.pickups.push(
      { id: this.id++, x: e.x, y: e.y, kind: 'xp', value: xp, age: 0 },
      {
        id: this.id++,
        x: e.x + 1,
        y: e.y + 0.5,
        kind: 'scrap',
        value: scrap,
        age: 0,
      },
    );
    if (this.random() < 0.035 || e.elite)
      s.pickups.push({
        id: this.id++,
        x: e.x - 1,
        y: e.y,
        kind: 'health',
        value: 12,
        age: 0,
      });
    if (this.rank('lifesteal') && p.kills % 15 === 0) {
      if (p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + 5 * this.rank('lifesteal'));
      this.fx('heal', p.x, p.y, '#97ffd5', 3, 0.6);
    }
    if (this.rank('explode') && !suppressExplosion) {
      this.fx('pulse', e.x, e.y, '#ffba79', 5, 0.35);
      for (const other of s.enemies)
        if (other.hp > 0 && distance(other, e) < 5) {
          const damage = 22 * this.rank('explode');
          s.stats.damage += Math.min(other.hp, damage);
          other.hp -= damage;
          if (other.hp <= 0) this.kill(other, true);
        }
    }
    if (e.kind === 'boss') {
      s.stats.bosses++;
      s.bullets = s.bullets.filter((b) => !b.hostile);
      for (const other of s.enemies) if (other.id !== e.id) other.hp = 0;
      for (const i of s.pickups) this.collect(i.kind, i.value);
      s.pickups = [];
      for (const pilot of this.pilots()) pilot.shield = pilot.maxShield;
      this.restorePilots(35);
      if (s.sector === 2 && s.mode === 'campaign') {
        s.phase = 'victory';
        this.emit('victory');
      } else {
        s.phase = 'station';
        s.stationBought = [];
        this.emit('station');
      }
    }
  }
  private hurtPlayer(amount: number, p: Player = this.state.player) {
    const s = this.state;
    if (p.hp <= 0 || p.invulnerable > 0 || s.phase !== 'playing') return;
    p.invulnerable = 0.5;
    p.hitTimer = 0;
    const shield = Math.min(p.shield, amount);
    p.shield -= shield;
    p.hp = Math.max(0, p.hp - (amount - shield));
    s.stats.damageTaken += amount;
    s.screenShake = 0.65;
    this.fx('hit', p.x, p.y, shield >= amount ? '#9fdfff' : '#ff6268', 2, 0.35);
    this.emit(shield >= amount ? 'shield' : 'hurt');
  }
  private collect(
    kind: 'xp' | 'scrap' | 'health',
    value: number,
    collector: Player = this.state.player,
  ) {
    const s = this.state;
    if (kind === 'xp') s.player.xp += value * (1 + this.rank('magnet', collector === s.partner ? 1 : 0) * 0.15);
    else if (kind === 'scrap') {
      s.stats.scrap += value;
      s.stats.totalScrap += value;
    } else {
      if (collector.hp > 0)
        collector.hp = Math.min(collector.maxHp, collector.hp + value);
      this.fx('heal', collector.x, collector.y, '#96ffce', 3, 0.5);
    }
    this.emit('pickup');
  }
  private draft(pilot: PilotId = 0) {
    const pool = UPGRADES.filter((u) => this.rank(u.id, pilot) < u.max);
    const result = [];
    while (pool.length && result.length < 3) {
      const index = Math.floor(this.random() * pool.length);
      result.push(pool.splice(index, 1)[0]);
    }
    if (pilot === 1) this.state.partnerChoices = result; else this.state.choices = result;
  }
  private levelUp() {
    const s = this.state;
    s.player.xp -= s.player.nextXp;
    s.player.level++;
    s.player.nextXp = 26 + s.player.level * 15;
    s.previousPhase = 'playing';
    s.phase = 'upgrade';
    this.openDraft();
    this.emit('levelup');
  }
  private openDraft() {
    const s = this.state;
    s.draftId++;
    this.draft(0);
    s.partnerChoices = [];
    if (s.partner && !s.sharedUpgrades) this.draft(1);
    for (const [i,p] of this.pilots().entries()) {
      if (!(i && !s.sharedUpgrades ? s.partnerChoices : s.choices).length && p.hp > 0) p.hp = p.maxHp;
    }
    if (!s.choices.length && !s.partnerChoices.length) s.phase = s.previousPhase;
  }
  chooseUpgrade(id: UpgradeId, pilot: PilotId = 0, draftId = this.state.draftId) {
    const s = this.state, choices = pilot ? s.partnerChoices : s.choices;
    if (s.phase !== 'upgrade' || draftId !== s.draftId || (pilot === 1 && (!s.partner || s.sharedUpgrades)) || !choices.some(c => c.id === id)) return false;
    this.applyUpgrade(id, pilot);
    if (pilot) s.partnerChoices = []; else s.choices = [];
    if (!s.choices.length && !s.partnerChoices.length) s.phase = s.previousPhase;
    this.emit('upgrade');
    return true;
  }
  applyUpgrade(id: UpgradeId, pilot: PilotId = 0) {
    const s = this.state,
      def = UPGRADES.find((u) => u.id === id);
    if (!def || this.rank(id, pilot) >= def.max) return;
    this.ranks(pilot)[id] = this.rank(id, pilot) + 1;
    for (const p of s.sharedUpgrades ? this.pilots() : [pilot === 1 && s.partner ? s.partner : s.player]) {
      const ship = p === s.player ? s.ship : s.partnerShip!;
      if (id === 'damage')
        p.damage += SHIPS.find((x) => x.id === ship)!.damage * 0.2;
      if (id === 'overdrive') {
        p.damage += 0.35;
        p.maxHp = Math.max(30, p.maxHp - 15);
        p.hp = Math.min(p.hp, p.maxHp);
      }
      if (id === 'firerate') p.fireRate += 0.15;
      if (id === 'crit') p.crit = Math.min(0.85, p.crit + 0.1);
      if (id === 'hull') {
        p.maxHp += 30;
        if (p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + 35);
      }
      if (id === 'shield') {
        p.maxShield += 25;
        p.shield = p.maxShield;
      }
      if (id === 'speed')
        p.speed += SHIPS.find((x) => x.id === ship)!.speed * 0.12;
    }
  }
  reroll(pilot: PilotId = 0, draftId = this.state.draftId) {
    const s = this.state, choices = pilot ? s.partnerChoices : s.choices;
    if (s.phase !== 'upgrade' || s.draftId !== draftId || !choices.length || (pilot === 1 && s.sharedUpgrades) || (pilot ? s.partnerRerolls : s.rerolls) <= 0) return false;
    if (pilot) s.partnerRerolls--; else s.rerolls--;
    this.draft(pilot); this.emit('click'); return true;
  }
  purchase(id: 'repair' | 'module' | 'charge') {
    const s = this.state,
      cost = { repair: 40, module: 95, charge: 30 }[id];
    if (
      s.phase !== 'station' ||
      s.stationBought.includes(id) ||
      s.stats.scrap < cost
    )
      return false;
    if (
      (id === 'repair' && this.pilots().every((p) => p.hp >= p.maxHp)) ||
      (id === 'charge' && this.pilots().every((p) => p.pulse >= 100))
    )
      return false;
    if (id === 'module' && !UPGRADES.some(u => this.rank(u.id, 0) < u.max || (s.partner && !s.sharedUpgrades && this.rank(u.id, 1) < u.max)))
      return false;
    s.stats.scrap -= cost;
    s.stationBought.push(id);
    if (id === 'repair') for (const p of this.pilots()) p.hp = p.maxHp;
    if (id === 'charge') for (const p of this.pilots()) p.pulse = 100;
    if (id === 'module') {
      s.previousPhase = 'station';
      s.phase = 'upgrade';
      this.openDraft();
    }
    this.emit('upgrade');
    return true;
  }
  continueSector() {
    const s = this.state;
    if (s.phase !== 'station') return;
    s.sector++;
    if (s.sector >= SECTORS.length) { s.sector = 0; s.loop++; }
    s.wave = 1;
    s.waveTime = 0;
    s.waveDuration = 38;
    s.bossSpawned = false;
    s.enemies = [];
    s.bullets = [];
    s.effects = [];
    s.pickups = [];
    s.player.x = 0;
    s.player.y = 0;
    s.player.vx = 0;
    s.player.vy = 0;
    if (s.partner) {
      Object.assign(s.partner, { x: 5, y: 0, vx: 0, vy: 0 });
      s.player.x = -5;
    }
    s.spawnTimer = 2;
    s.intermission = 0;
    s.phase = 'playing';
    this.banner(`SECTOR ${String(sectorNumber(s)).padStart(2, '0')}`, SECTORS[s.sector].name, 4);
    this.emit('start');
  }
  score() {
    const s = this.state;
    return Math.floor(
      (s.stats.kills * 100 + s.stats.bosses * 2500 + s.stats.maxCombo * 30 + s.player.level * 150 + (s.phase === 'victory' ? 10000 : 0)) * this.rules.reward,
    );
  }
  finish(save: SaveData) {
    if (this.awarded || !['victory', 'defeat'].includes(this.state.phase))
      return { save, earned: 0, achievements: [] as string[] };
    this.awarded = true;
    const s = this.state,
      updated = structuredClone(save),
      earned =
        Math.floor(s.stats.kills / 5) +
        s.stats.bosses * 25 +
        (s.phase === 'victory' ? 80 : 5);
    updated.totalRuns++;
    updated.totalKills += s.stats.kills;
    updated.bestSector = Math.max(updated.bestSector, sectorNumber(s));
    updated.bestScore = Math.max(updated.bestScore, this.score());
    updated.shards += earned;
    if (s.phase === 'victory') updated.wins++;
    const checks: Record<string, boolean> = {
      first: true,
      hunter: updated.totalKills >= 100,
      ace: updated.totalKills >= 500,
      boss: s.stats.bosses > 0,
      win: s.phase === 'victory',
      combo: s.stats.maxCombo >= 25,
    };
    const achievements: string[] = [];
    for (const a of ACHIEVEMENTS)
      if (checks[a.id] && !updated.achievements.includes(a.id)) {
        updated.achievements.push(a.id);
        updated.shards += a.reward;
        achievements.push(a.id);
      }
    return {
      save: updated,
      earned: updated.shards - save.shards,
      achievements,
    };
  }
}
