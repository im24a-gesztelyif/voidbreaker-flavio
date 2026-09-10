import type { GameState } from './types';

/** Compare values, not object identity: solo mutates state and multiplayer replaces snapshots. */
export class DamageFeedback {
  shield = 0;
  hull = 0;
  private previous?: {hp:number;shield:number;time:number};
  update(s: GameState, dt: number) {
    this.shield = Math.max(0,this.shield-dt);
    this.hull = Math.max(0,this.hull-dt);
    if (s.phase === 'menu') {this.previous=undefined;this.shield=this.hull=0;return;}
    const p=s.player, previous=this.previous;
    if (previous && s.totalTime >= previous.time) {
      if(p.shield < previous.shield-.01)this.shield=.35;
      if(p.hp < previous.hp-.01)this.hull=.45;
    } else {this.shield=this.hull=0;}
    this.previous={hp:p.hp,shield:p.shield,time:s.totalTime};
  }
}
