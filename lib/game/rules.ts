import type { Difficulty, GameState, RoomOptions } from './types';

export const DIFFICULTIES: Record<Difficulty, { name: string; description: string; health: number; damage: number; speed: number; projectile: number; pressure: number; warning: number; enemies: number; reward: number }> = {
  easy: { name: 'Easy', description: 'Room to learn. Gentler damage, slower threats, longer warnings.', health: .72, damage: .55, speed: .82, projectile: .78, pressure: .72, warning: 1.35, enemies: 30, reward: .8 },
  normal: { name: 'Normal', description: 'The intended balance of movement, firepower, and survival.', health: 1, damage: 1, speed: 1, projectile: 1, pressure: 1, warning: 1, enemies: 42, reward: 1 },
  hard: { name: 'Hard', description: 'Faster attacks and denser waves. Build with purpose.', health: 1.25, damage: 1.25, speed: 1.08, projectile: 1.12, pressure: 1.18, warning: .9, enemies: 52, reward: 1.25 },
  veteran: { name: 'Veteran', description: 'Relentless pressure. Precise dodges and strong builds required.', health: 1.55, damage: 1.6, speed: 1.16, projectile: 1.25, pressure: 1.4, warning: .8, enemies: 64, reward: 1.55 },
  ace: { name: 'Ace', description: 'Maximum threat. Dense crossfire, lethal hits, very little hesitation.', health: 1.9, damage: 2, speed: 1.25, projectile: 1.4, pressure: 1.65, warning: .7, enemies: 76, reward: 1.9 },
};
export const defaultOptions = (): RoomOptions => ({ mode: 'campaign', difficulty: 'normal', sharedUpgrades: true, sharedKills: true });
export function cleanOptions(value: unknown): RoomOptions {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<RoomOptions>;
  return { mode: v.mode === 'endless' ? 'endless' : 'campaign', difficulty: Object.hasOwn(DIFFICULTIES, v.difficulty || '') ? v.difficulty! : 'normal', sharedUpgrades: v.sharedUpgrades !== false, sharedKills: v.sharedKills !== false };
}
export const sectorNumber = (s: Pick<GameState, 'sector' | 'loop'>) => s.loop * 3 + s.sector + 1;
export const BOSS_VARIANTS = [
  { name: 'THE COLLECTOR', subtitle: 'SIEGE CARRIER · FIND THE SAFE GAP', model: 1, color: '#ff8968' },
  { name: 'THE ARCHITECT', subtitle: 'TRIUNE HUNTER · THREAD THE CROSSFIRE', model: 2, color: '#b59aff' },
  { name: 'THE NULLHEART', subtitle: 'DREADNOUGHT · HOLD YOUR NERVE', model: 3, color: '#ffc178' },
  { name: 'THE GRAVEMAW', subtitle: 'GRAVITY ENGINE · ESCAPE THE MARKED WELLS', model: 4, color: '#74d9ff' },
  { name: 'THE MIRROR REGENT', subtitle: 'PRISM CROWN · SLIP BETWEEN THE ARMS', model: 5, color: '#ff91cf' },
  { name: 'THE CHRONOVORE', subtitle: 'TIME EATER · NEVER STAND WHERE YOU WERE', model: 6, color: '#b1ff79' },
];
export const bossFor = (s: Pick<GameState, 'sector' | 'loop'>) => (s.sector + s.loop * 3 + 3) % BOSS_VARIANTS.length;
