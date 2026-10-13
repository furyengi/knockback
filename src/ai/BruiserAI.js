import { EnemyAI } from './EnemyAI.js';

// Slow, armoured, telegraphs a big overhead smash. Tries to stand between the player
// and the arena centre so that its hit sends the player toward the edge.
export class BruiserAI extends EnemyAI {
  constructor(enemy, battle) {
    super(enemy, battle);
    this.engageDistance = 3.6;
    this.trackUntil = 0.55;
    this.recoverExtra = 0.3;
  }

  nextCooldown() {
    return this.rng.range(1.5, 2.6) / this.aggr;
  }

  updatePosition(dt) {
    const p = this.player;
    const e = this.e;
    this.faceTarget();
    const d = this.dist();

    // Herd: when the player is near a wall, take the centre-side spot.
    const hold = 2.35;
    let tx;
    let tz;
    if (this.edgeDistance(p.x, p.z) < 4.5) {
      const l = Math.hypot(p.x, p.z) || 1;
      tx = p.x - (p.x / l) * hold;
      tz = p.z - (p.z / l) * hold;
    } else {
      const l = d || 1;
      tx = p.x + ((e.x - p.x) / l) * hold;
      tz = p.z + ((e.z - p.z) / l) * hold;
    }
    const inRange = d < 3.0;
    if (!inRange) this.moveToward(tx, tz, 1, true);
    else e.setMove(0, 0);

    if (this.attackReady(inRange, dt)) {
      const heavy = this.rng.chance(0.7);
      this.tryBegin(heavy ? 'heavy' : 'light');
    }
  }
}
