import { CONFIG } from '../config/gameConfig.js';
import { STATE } from '../entities/Character.js';
import { PHASE } from '../combat/Attack.js';
import { angleOf, angleDiff } from '../util/math.js';

// Explicit enemy state machine. Each state has its own small handler; archetypes
// subclass this and override the hooks (updatePosition, recoverMove, ...).
//
//   approach -> position -> telegraph -> attack -> recover -> position ...
//   any hit / stagger sends the enemy to `staggered`, and it rejoins at `position`.
//
// "telegraph" is the character wind-up (the renderer draws the warning), "attack" is
// its active window, "recover" is the punishable tail. Falling / eliminated enemies are
// handled by the Character itself; the AI simply stops (see update()).
const HANDLERS = {
  approach: 'updateApproach',
  position: 'updatePositionState',
  telegraph: 'updateTelegraph',
  attack: 'updateAttack',
  recover: 'updateRecover',
  staggered: 'updateStaggered',
};

export class EnemyAI {
  constructor(enemy, battle) {
    this.e = enemy;
    this.battle = battle;
    this.rng = battle.rng;
    this.state = 'approach';
    this.stateTime = 0;
    this.cooldown = this.rng.range(0.5, 1.5) / enemy.aggression;
    this.inRangeTime = 0;
    this.reaction = this.rollReaction();
    this.engageDistance = 4;
    this.trackUntil = 0.65; // fraction of the wind-up during which the enemy keeps aiming
    this.recoverExtra = 0.15;
    this.attackKind = null;
  }

  get player() {
    return this.battle.player;
  }
  get aggr() {
    return this.e.aggression || 1;
  }

  rollReaction() {
    const A = CONFIG.ai;
    return this.rng.range(A.reactionMin, A.reactionMax) / (this.e.aggression || 1);
  }

  setState(next) {
    if (this.state === next) return;
    const was = this.state;
    const holding = was === 'telegraph' || was === 'attack' || was === 'recover';
    const stillHolding = next === 'telegraph' || next === 'attack' || next === 'recover';
    if (holding && !stillHolding) this.battle.coordinator.release(this.e);
    this.state = next;
    this.stateTime = 0;
    this.onEnter(next, was);
  }

  onEnter() {}

  update(dt) {
    const e = this.e;
    if (!e.inPlay) {
      this.battle.coordinator.release(e);
      return;
    }
    if (e.state === STATE.SPAWN) return;
    this.cooldown -= dt;
    this.stateTime += dt;

    const stunned = e.state === STATE.HITSTUN || e.state === STATE.STAGGER || e.state === STATE.AIRBORNE;
    if (stunned && this.state !== 'staggered') this.setState('staggered');

    if (!this.player.alive) {
      e.setMove(0, 0);
      e.setBlock(false);
      return;
    }
    this.beforeUpdate(dt);
    this[HANDLERS[this.state]](dt);
  }

  beforeUpdate() {}

  // ---- state handlers ----------------------------------------------------
  updateApproach() {
    const p = this.player;
    this.faceTarget();
    if (this.dist() <= this.engageDistance) {
      this.setState('position');
      return;
    }
    this.moveToward(p.x, p.z, 1);
  }

  updatePositionState(dt) {
    this.updatePosition(dt);
  }

  updatePosition() {}

  updateTelegraph() {
    const e = this.e;
    const a = e.attack;
    if (!a) {
      this.setState(e.state === STATE.NEUTRAL ? 'recover' : 'staggered');
      return;
    }
    e.setMove(0, 0);
    if (a.phase === PHASE.WINDUP) {
      const frac = a.phaseTime / Math.max(0.001, a.def.windup);
      if (frac < this.trackUntil) this.faceTarget();
    } else {
      this.setState('attack');
    }
  }

  updateAttack() {
    const e = this.e;
    const a = e.attack;
    if (!a || a.phase === PHASE.RECOVERY || a.phase === PHASE.DONE) this.setState('recover');
    else e.setMove(0, 0);
  }

  updateRecover(dt) {
    const e = this.e;
    this.recoverMove(dt);
    if (e.state === STATE.NEUTRAL && !e.attack && this.stateTime > this.recoverExtra) {
      this.cooldown = this.nextCooldown();
      this.reaction = this.rollReaction();
      this.inRangeTime = 0;
      this.setState('position');
    }
  }

  recoverMove() {
    this.e.setMove(0, 0);
  }

  updateStaggered() {
    const e = this.e;
    e.setMove(0, 0);
    if (e.state === STATE.NEUTRAL) {
      this.cooldown = Math.max(this.cooldown, this.rollReaction() + 0.2);
      this.inRangeTime = 0;
      this.setState(this.dist() > this.engageDistance * 1.6 ? 'approach' : 'position');
    }
  }

  nextCooldown() {
    return 1;
  }

  // ---- helpers -----------------------------------------------------------
  dist() {
    const p = this.player;
    return Math.hypot(p.x - this.e.x, p.z - this.e.z);
  }

  faceTarget() {
    const p = this.player;
    this.e.aim = angleOf(p.x - this.e.x, p.z - this.e.z);
  }

  facingError() {
    const p = this.player;
    return Math.abs(angleDiff(this.e.facing, angleOf(p.x - this.e.x, p.z - this.e.z)));
  }

  /** Walk toward a point with mild separation from other enemies. `scale` = speed fraction. */
  moveToward(tx, tz, scale = 1, keepAim = false) {
    const e = this.e;
    let dx = tx - e.x;
    let dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      e.setMove(0, 0);
      return;
    }
    dx /= d;
    dz /= d;
    const sep = this.separation();
    dx += sep.x * 0.8;
    dz += sep.z * 0.8;
    const l = Math.hypot(dx, dz) || 1;
    // slow down when almost there so enemies do not jitter around the point
    const s = Math.min(1, d / 0.8) * scale;
    e.setMove((dx / l) * s, (dz / l) * s, 1);
    if (!keepAim) e.aim = angleOf(dx, dz);
  }

  moveAway(scale = 1) {
    const p = this.player;
    const e = this.e;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    // bias away from the nearest wall so the retreat never pins the enemy to the edge
    const lim = CONFIG.arena.half - 1.2;
    let bx = dx / l;
    let bz = dz / l;
    if (Math.abs(e.x) > lim && Math.sign(bx) === Math.sign(e.x)) bx = -bx * 0.3;
    if (Math.abs(e.z) > lim && Math.sign(bz) === Math.sign(e.z)) bz = -bz * 0.3;
    e.setMove(bx * scale, bz * scale, 1);
  }

  separation() {
    const e = this.e;
    let x = 0;
    let z = 0;
    for (const c of this.battle.characters) {
      if (c === e || !c.inPlay || c.team !== 'enemy') continue;
      const dx = e.x - c.x;
      const dz = e.z - c.z;
      const d = Math.hypot(dx, dz);
      const r = (e.radius + c.radius) * 1.8;
      if (d > 0 && d < r) {
        const w = (r - d) / r;
        x += (dx / d) * w;
        z += (dz / d) * w;
      }
    }
    return { x, z };
  }

  edgeDistance(x, z) {
    const h = CONFIG.arena.half;
    return h - Math.max(Math.abs(x), Math.abs(z));
  }

  /** Ready to throw an attack: cooldown elapsed, reaction delay served, roughly facing the player. */
  attackReady(inRange, dt) {
    this.inRangeTime = inRange ? this.inRangeTime + dt : 0;
    return inRange && this.cooldown <= 0 && this.inRangeTime >= this.reaction && this.facingError() < 0.45 && this.e.canAct;
  }

  /** Ask the coordinator for a turn and start the attack. */
  tryBegin(kind) {
    const e = this.e;
    if (!e.canAct) return false;
    if (!this.battle.coordinator.request(e, kind)) return false;
    this.faceTarget();
    const r = e.startAttack(kind);
    if (r !== 'ok') {
      this.battle.coordinator.release(e);
      return false;
    }
    this.attackKind = kind;
    this.battle.bus.emit('swing', { character: e, attack: e.attack });
    this.setState('telegraph');
    return true;
  }
}
