export type Vec = { x: number; y: number };
export type ShipId = 'kestrel' | 'wraith' | 'bastion';
export type WeaponId = 'pulse' | 'scatter' | 'rail';
export type EnemyKind =
  | 'drone'
  | 'striker'
  | 'gunner'
  | 'bomber'
  | 'warden'
  | 'swarm'
  | 'boss';
export type Phase =
  | 'menu'
  | 'playing'
  | 'paused'
  | 'upgrade'
  | 'station'
  | 'victory'
  | 'defeat';
export type UpgradeId =
  | 'damage'
  | 'firerate'
  | 'multishot'
  | 'pierce'
  | 'crit'
  | 'hull'
  | 'shield'
  | 'regen'
  | 'speed'
  | 'dash'
  | 'magnet'
  | 'salvage'
  | 'missiles'
  | 'drones'
  | 'orbitals'
  | 'chain'
  | 'explode'
  | 'freeze'
  | 'lifesteal'
  | 'pulse'
  | 'overdrive'
  | 'ricochet';
export interface ShipDef {
  id: ShipId;
  name: string;
  role: string;
  description: string;
  hp: number;
  shield: number;
  speed: number;
  damage: number;
  dash: number;
  color: string;
  stats: number[];
  passive: string;
}
export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  damage: number;
  rate: number;
  speed: number;
  count: number;
  spread: number;
  pierce: number;
  color: string;
}
export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  max: number;
  rarity: 'common' | 'rare' | 'epic';
  category: 'Weapon' | 'System' | 'Tech';
  icon: string;
}
export interface SectorDef {
  name: string;
  subtitle: string;
  color: string;
  bossName: string;
  narrative: string;
}
export interface Enemy extends Vec {
  id: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  angle: number;
  cooldown: number;
  age: number;
  vx: number;
  vy: number;
  hit: number;
  slow: number;
  elite: boolean;
  bossPhase: number;
  attack: number;
  telegraph: number;
  targetX: number;
  targetY: number;
}
export interface Bullet extends Vec {
  id: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  life: number;
  hostile: boolean;
  color: string;
  pierce: number;
  hitIds: number[];
  type: 'bolt' | 'rail' | 'missile' | 'orb';
  crit: boolean;
}
export interface Pickup extends Vec {
  id: number;
  kind: 'xp' | 'scrap' | 'health';
  value: number;
  age: number;
}
export interface Effect extends Vec {
  id: number;
  kind:
    | 'explosion'
    | 'hit'
    | 'dash'
    | 'pulse'
    | 'spawn'
    | 'chain'
    | 'heal'
    | 'text';
  color: string;
  life: number;
  maxLife: number;
  size: number;
  targetX?: number;
  targetY?: number;
  text?: string;
}
export interface Player extends Vec {
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  speed: number;
  damage: number;
  fireRate: number;
  crit: number;
  dashTimer: number;
  dashCooldown: number;
  invulnerable: number;
  hitTimer: number;
  shootTimer: number;
  pulse: number;
  level: number;
  xp: number;
  nextXp: number;
  regenTimer: number;
  missileTimer: number;
  droneTimer: number;
  orbitalTimer: number;
}
export interface GameInput {
  x: number;
  y: number;
  aimX: number;
  aimY: number;
  firing: boolean;
  dash: boolean;
  pulse: boolean;
}
export interface RunStats {
  kills: number;
  damage: number;
  damageTaken: number;
  scrap: number;
  totalScrap: number;
  shots: number;
  hits: number;
  elites: number;
  bosses: number;
  maxCombo: number;
}
export interface GameState {
  partner?: Player;
  partnerShip?: ShipId;
  partnerWeapon?: WeaponId;
  partnerAutoFire?: boolean;
  phase: Phase;
  previousPhase: Phase;
  ship: ShipId;
  weapon: WeaponId;
  player: Player;
  enemies: Enemy[];
  bullets: Bullet[];
  pickups: Pickup[];
  effects: Effect[];
  sector: number;
  wave: number;
  waveTime: number;
  time: number;
  totalTime: number;
  waveDuration: number;
  spawnTimer: number;
  intermission: number;
  bossSpawned: boolean;
  stats: RunStats;
  upgrades: Partial<Record<UpgradeId, number>>;
  choices: UpgradeDef[];
  combo: number;
  comboTime: number;
  banner: string;
  bannerSub: string;
  bannerTime: number;
  seed: number;
  difficulty: 'normal' | 'hard';
  autoFire: boolean;
  screenShake: number;
  stationBought: string[];
  rerolls: number;
}
export interface SaveData {
  version: 1;
  shards: number;
  totalRuns: number;
  wins: number;
  bestScore: number;
  bestSector: number;
  totalKills: number;
  ship: ShipId;
  weapon: WeaponId;
  meta: { hull: number; damage: number; fortune: number };
  achievements: string[];
  settings: {
    volume: number;
    muted: boolean;
    shake: boolean;
    quality: 'high' | 'low';
    autoFire: boolean;
  };
}
export interface GameEvent {
  type: string;
  value?: number;
}
