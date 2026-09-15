import type { GameState, PilotId, PilotState } from './types';

/** Stable pilot IDs belong to the host's simulation, independent of each guest's camera. */
export function squad(s: GameState): PilotState[] {
  const primary: PilotState = {
    slot: s.localPilot ?? 0,
    get player() { return s.player; }, set player(v) { s.player=v; },
    get ship() { return s.ship; }, get weapon() { return s.weapon; },
    get autoFire() { return s.autoFire; }, set autoFire(v) { s.autoFire=v; },
    get upgrades() { return s.upgrades; }, set upgrades(v) { s.upgrades=v; },
    get choices() { return s.choices; }, set choices(v) { s.choices=v; },
    get rerolls() { return s.rerolls; }, set rerolls(v) { s.rerolls=v; },
  };
  const result=[primary];
  if (s.partner) result.push({
    slot: s.localPilot ? 0 : 1,
    get player() { return s.partner!; }, set player(v) { s.partner=v; },
    get ship() { return s.partnerShip!; }, get weapon() { return s.partnerWeapon!; },
    get autoFire() { return !!s.partnerAutoFire; }, set autoFire(v) { s.partnerAutoFire=v; },
    get upgrades() { return s.partnerUpgrades; }, set upgrades(v) { s.partnerUpgrades=v; },
    get choices() { return s.partnerChoices; }, set choices(v) { s.partnerChoices=v; },
    get rerolls() { return s.partnerRerolls; }, set rerolls(v) { s.partnerRerolls=v; },
  });
  return [...result,...(s.extraPilots || [])];
}
export const pilotState = (s: GameState, id: PilotId) => squad(s).find(p=>p.slot===id);
