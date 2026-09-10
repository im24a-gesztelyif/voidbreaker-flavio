import type { GameState } from './types';

// Ordered WebRTC packets carry compact entity tuples; stable run metadata is sent only when it changes.
const fields = {
  player: 'x y vx vy angle hp maxHp shield maxShield speed damage fireRate crit dashTimer dashCooldown invulnerable hitTimer shootTimer pulse level xp nextXp regenTimer missileTimer droneTimer orbitalTimer kills'.split(' '),
  enemies: 'id kind x y hp maxHp radius angle age hit elite bossPhase telegraph targetX targetY bossVariant telegraphKind'.split(' '),
  bullets: 'id x y vx vy radius life hostile color type'.split(' '),
  pickups: 'id x y kind value age'.split(' '),
  effects: 'id kind x y color life maxLife size targetX targetY text'.split(' '),
};
type Row = (number | string | boolean | null)[];
export interface Frame { p: Row; q: Row | null; e: Row[]; b: Row[]; i: Row[]; f: Row[]; d: number[]; stats: GameState['stats']; meta?: Partial<GameState> }
const dynamic = 'time totalTime waveTime intermission bannerTime screenShake combo comboTime'.split(' ');
const omitted = new Set(['player','partner','enemies','bullets','pickups','effects','stats','spawnTimer',...dynamic]);
const row = (value: object, keys: string[]): Row => keys.map(k => {
  const v = (value as Record<string, unknown>)[k];
  return typeof v === 'number' ? Math.round(v * 100) / 100 : (v ?? null) as Row[number];
});
const object = (values: Row, keys: string[]) => Object.fromEntries(keys.map((k,i) => [k, values[i] ?? undefined]));
export class SnapshotEncoder {
  private signature = '';
  reset() { this.signature = ''; }
  encode(s: GameState, force = false): Frame {
    const meta = Object.fromEntries(Object.entries(s).filter(([k]) => !omitted.has(k))) as Partial<GameState>;
    const signature = JSON.stringify(meta);
    const frame: Frame = { p: row(s.player,fields.player), q: s.partner ? row(s.partner,fields.player) : null,
      e: s.enemies.map(e => row(e,fields.enemies)), b: s.bullets.map(b => row(b,fields.bullets)),
      i: s.pickups.map(i => row(i,fields.pickups)), f: s.effects.map(f => row(f,fields.effects)),
      d: dynamic.map(k => Math.round((s[k as keyof GameState] as number) * 100) / 100), stats: {...s.stats} };
    if (force || signature !== this.signature) frame.meta = structuredClone(meta);
    this.signature = signature;
    return frame;
  }
}
export class SnapshotDecoder {
  private meta: Partial<GameState> | undefined;
  reset() { this.meta = undefined; }
  decode(value: unknown): GameState | null {
    if (!value || typeof value !== 'object') return null;
    const f = value as Frame;
    const valid = (r: unknown, keys: string[]) => Array.isArray(r) && r.length === keys.length && r.every(v => v === null || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 300) || (typeof v === 'number' && Number.isFinite(v)));
    if (!valid(f.p, fields.player) || !valid(f.q, fields.player) || !Array.isArray(f.d) || f.d.length !== dynamic.length || !f.d.every(Number.isFinite)) return null;
    for (const [key, name, max] of [['e','enemies',100],['b','bullets',700],['i','pickups',1000],['f','effects',500]] as const)
      if (!Array.isArray(f[key]) || f[key].length > max || !f[key].every(r => valid(r,fields[name]))) return null;
    const meta = f.meta || this.meta;
    if (!meta || !['playing','paused','upgrade','station','victory','defeat'].includes(meta.phase!) || !Number.isInteger(meta.sector) || meta.sector! < 0 || meta.sector! > 2 || !f.stats) return null;
    this.meta = meta;
    return { ...meta, ...Object.fromEntries(dynamic.map((k,i) => [k,f.d[i]])), stats: f.stats,
      player: object(f.p,fields.player), partner: object(f.q!,fields.player),
      enemies: f.e.map(r => object(r,fields.enemies)), bullets: f.b.map(r => object(r,fields.bullets)),
      pickups: f.i.map(r => object(r,fields.pickups)), effects: f.f.map(r => object(r,fields.effects)) } as unknown as GameState;
  }
}
