import { EnemyAI } from './EnemyAI.js';
import { CONFIG } from '../config/gameConfig.js';
import { angleOf } from '../util/math.js';
import { PHASE } from '../combat/Attack.js';

// Fast and evasive: circles the player, dives in for a quick strike, then backs off.
export class RunnerAI extends EnemyAI {
  constructor(enemy, battle) {
    super(enemy, battle);
    this.engageDistance = 4.6;
    this.orbitDir = this.rng.sign();
    this.orbitTimer = this.rng.range(1.2, 2.8);
    this.orbitRadius = this.rng.range(2.9, 3.6);
    this.diving = false;
    this.diveTime = 0;
    this.evadedAttack = 0;
    this.recoverExtra = 0.25;
    this.retreatTime = 0.7;
  }

  nextCooldown() {
    return this.rng.range(1.0, 2.2) / this.aggr;
  }

  onEnter(next) {
    if (next === 'position') {
      this.diving = false;
      this.diveTime = 0;
    }
  }

  beforeUpdate() {
    // Occasionally sidestep a telegraphed player attack. Rare and on a long cooldown.
    const e = this.e;
    const pa = this.player.attack;
    if (!pa || pa.phase !== PHASE.WINDUP || pa.id === this.evadedAttack) return;
    if (!e.canAct || e.dodgeCd > 0 || this.dist() > 2.8) return;
    this.evadedAttack = pa.id;
    if (this.rng.chance(0.3)) {
      const p = this.player;
      const ang = angleOf(e.x - p.x, e.z - p.z) + this.rng.sign() * 1.4; // sideways relative to the player
      if (e.startDodge(Math.sin(ang), Math.cos(ang))) e.dodgeCd = 3.2;
    }
  }

  updatePosition(dt) {
    const p = this.player;
    const e = this.e;
    const d = this.dist();
    this.faceTarget();

    if (!this.diving && this.cooldown <= 0) {
      this.diving = true;
      this.diveTime = 0;
    }

    if (this.diving) {
      this.diveTime += dt;
      this.moveToward(p.x, p.z, 1, true);
      if (this.attackReady(d < 2.45, dt)) {
        if (!this.tryBegin('light')) {
          // no token: loiter in the orbit and retry shortly
          this.cooldown = 0.25;
          this.diving = false;
        }
      } else if (this.diveTime > 3.5) {
        this.diving = false;
        this.cooldown = 0.8;
      }
      return;
    }

    this.orbitTimer -= dt;
    if (this.orbitTimer <= 0) {
      this.orbitDir = -this.orbitDir;
      this.orbitTimer = this.rng.range(1.4, 3.2);
    }
    const ang = angleOf(e.x - p.x, e.z - p.z) + this.orbitDir * 0.5;
    let tx = p.x + Math.sin(ang) * this.orbitRadius;
    let tz = p.z + Math.cos(ang) * this.orbitRadius;
    const lim = CONFIG.arena.half - 1.3;
    if (Math.abs(tx) > lim || Math.abs(tz) > lim) {
      this.orbitDir = -this.orbitDir;
      tx = Math.max(-lim, Math.min(lim, tx));
      tz = Math.max(-lim, Math.min(lim, tz));
    }
    this.moveToward(tx, tz, 0.85, true);
  }

  recoverMove() {
    if (this.stateTime < this.retreatTime && this.e.canAct) this.moveAway(0.9);
    else this.e.setMove(0, 0);
  }
}
