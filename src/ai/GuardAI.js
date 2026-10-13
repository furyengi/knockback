import { EnemyAI } from './EnemyAI.js';
import { STATE } from '../entities/Character.js';

// Defensive: keeps its guard up and marches forward. Only the front is protected, so
// flanking works; a heavy smash (or a few jabs) breaks the guard.
export class GuardAI extends EnemyAI {
  constructor(enemy, battle) {
    super(enemy, battle);
    this.engageDistance = 4.2;
    this.recoverExtra = 0.4;
    this.trackUntil = 0.7;
  }

  nextCooldown() {
    return this.rng.range(1.4, 2.6) / this.aggr;
  }

  onEnter(next) {
    if (next === 'telegraph' || next === 'staggered') this.e.setBlock(false);
  }

  updateApproach() {
    this.e.setBlock(this.dist() < 4.4);
    super.updateApproach();
  }

  updatePosition(dt) {
    const e = this.e;
    const p = this.player;
    const d = this.dist();
    this.faceTarget();

    // Guard up while the player is close; it drops only to strike.
    if (e.canAct) e.setBlock(d < 4.6);

    const inRange = d < 2.45;
    if (d > 1.9) this.moveToward(p.x, p.z, 0.9, true);
    else e.setMove(0, 0);

    if (this.attackReady(inRange, dt) && e.state === STATE.NEUTRAL) {
      const heavy = this.rng.chance(0.4);
      this.tryBegin(heavy ? 'heavy' : 'light');
    }
  }
}
