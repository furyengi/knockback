import { CONFIG } from '../config/gameConfig.js';
import { Attack, PHASE } from '../combat/Attack.js';
import { StaminaSystem } from '../combat/StaminaSystem.js';
import { clamp, angleOf, turnToward, damp } from '../util/math.js';

// Character = pure simulation entity (no rendering). The view layer reads these fields.
//
// States:
//   spawn     dropping onto the roof, untouchable
//   neutral   free movement (optionally blocking)
//   attack    windup / active / recovery of a swing
//   dodge     directional burst
//   hitstun   short reaction after a hit
//   stagger   long reaction: guard break, perfect-blocked, dazed
//   airborne  launched into the air above the roof
//   falling   past the edge, gravity only
//   ko        player at 0 hp
//   eliminated  fully gone, awaiting cleanup
export const STATE = {
  SPAWN: 'spawn',
  NEUTRAL: 'neutral',
  ATTACK: 'attack',
  DODGE: 'dodge',
  HITSTUN: 'hitstun',
  STAGGER: 'stagger',
  AIRBORNE: 'airborne',
  FALLING: 'falling',
  KO: 'ko',
  ELIMINATED: 'eliminated',
};

let nextId = 1;

export function defaultMods() {
  return {
    heavyKnock: 1,
    heavyDamage: 1,
    lightKnock: 1,
    moveSpeed: 1,
    dodgeCooldown: 1,
    dodgeCost: 1,
    staminaRegen: 1,
    blockKnockback: 1,
    blockStamina: 1,
    perfectRefund: 1,
  };
}

function mergeMove(kind, override, scale = 1) {
  const m = { ...CONFIG.attacks[kind], ...(override || {}) };
  m.kind = kind;
  return m;
}

export class Character {
  /**
   * @param {object} o { team:'player'|'enemy', type:'player'|'runner'|..., x, z, facing, hpScale }
   */
  constructor(o) {
    this.id = nextId++;
    this.team = o.team;
    this.type = o.type;
    const base = o.team === 'player' ? CONFIG.player : CONFIG.enemies[o.type];
    this.def = base;
    this.name = base.name || 'Player';

    this.x = o.x || 0;
    this.z = o.z || 0;
    this.y = 0;
    this.mvx = 0; // self-driven velocity
    this.mvz = 0;
    this.kx = 0; // knockback velocity
    this.kz = 0;
    this.ky = 0; // vertical velocity
    this.facing = o.facing || 0;
    this.aim = this.facing; // desired facing
    // previous-step transform, used by the renderer to interpolate between fixed steps
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.pf = this.facing;
    this.moveX = 0; // intent, set by controller (player input / AI)
    this.moveZ = 0;
    this.moveScale = 1;

    this.radius = base.radius;
    this.mass = base.mass;
    this.resist = base.knockbackResist;
    this.scale = base.scale || 1;
    this.baseSpeed = base.moveSpeed;
    this.accel = base.accel;
    this.turnRate = base.turnRate;

    const hpScale = o.hpScale || 1;
    this.maxHp = Math.round(base.maxHp * hpScale);
    this.hp = this.maxHp;
    this.maxStamina = base.maxStamina || 0;
    this.stamina = this.maxStamina;
    this.staminaRegen = base.staminaRegen ?? CONFIG.player.staminaRegen;
    this.staminaRegenDelay = CONFIG.player.staminaRegenDelay;
    this.staminaDelay = 0;

    this.mods = defaultMods();
    this.moves = {
      light: mergeMove('light', base.attacks?.light),
      heavy: mergeMove('heavy', base.attacks?.heavy),
    };
    this.hasMove = { light: o.team === 'player' || !!base.attacks?.light, heavy: o.team === 'player' || !!base.attacks?.heavy };
    this.finisherDef = this.#buildFinisher();

    this.state = STATE.NEUTRAL;
    this.stateTime = 0;
    this.stateDuration = 0; // for timed states (hitstun / stagger)
    this.attack = null;
    this.chainIndex = 0;
    this.chainTimer = 0;
    this.handSide = 1;

    this.blocking = false;
    this.blockTime = 0;
    this.blockLock = 0;

    this.dodgeCd = 0;
    this.dodgeDirX = 0;
    this.dodgeDirZ = 1;
    this.dodgeTime = 0;
    this.dodgeRecover = 0;
    this.invuln = 0;

    this.dazed = false;
    this.counterWindow = 0; // after a perfect dodge: next hit lands harder
    this.lastHitBy = null;
    this.lastHitTime = -99;
    this.lastBumpBy = null;
    this.bumpCd = 0;
    this.hitFlash = 0;
    this.spinSpeed = 0;
    this.fallTime = 0;
    this.clock = 0; // per-character clock for animation / credit windows
    this.lastDamagedAt = -99;
    this.knockTotal = 0; // diagnostics
    this.ringOutCredit = null;
  }

  #buildFinisher() {
    const f = CONFIG.lightFinisher;
    const l = this.moves.light;
    return {
      ...l,
      damage: l.damage * f.damage,
      knockback: l.knockback * f.knockback,
      recovery: l.recovery * f.recovery,
      hitstun: l.hitstun * f.hitstun,
      range: l.range + f.range * 0.25,
      pop: 0,
      staminaCost: l.staminaCost,
      finisher: true,
    };
  }

  // ---- queries -----------------------------------------------------------
  get isPlayer() {
    return this.team === 'player';
  }
  /** Still taking part in the fight (counts toward the remaining total). */
  get alive() {
    return (
      this.state !== STATE.FALLING && this.state !== STATE.ELIMINATED && this.state !== STATE.KO && this.state !== STATE.SPAWN
    );
  }
  /** Counted as present in the wave (spawning enemies count too). */
  get inPlay() {
    return this.state !== STATE.FALLING && this.state !== STATE.ELIMINATED && this.state !== STATE.KO;
  }
  get canAct() {
    return this.state === STATE.NEUTRAL;
  }
  get hittable() {
    return (
      this.y < 0.9 &&
      this.state !== STATE.SPAWN &&
      this.state !== STATE.AIRBORNE &&
      this.state !== STATE.FALLING &&
      this.state !== STATE.ELIMINATED &&
      this.state !== STATE.KO
    );
  }
  get speed() {
    return Math.hypot(this.mvx + this.kx, this.mvz + this.kz);
  }
  get knockSpeed() {
    return Math.hypot(this.kx, this.kz);
  }
  get armored() {
    return !!(this.attack && this.attack.def.armor && this.attack.phase !== PHASE.RECOVERY);
  }
  /** Out of control: arena-edge clamping no longer protects the character. */
  get knocked() {
    return (
      this.state === STATE.HITSTUN ||
      this.state === STATE.STAGGER ||
      this.state === STATE.AIRBORNE ||
      this.knockSpeed > 3.5
    );
  }
  get forwardX() {
    return Math.sin(this.facing);
  }
  get forwardZ() {
    return Math.cos(this.facing);
  }
  get hpFrac() {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }
  get dodgeReady() {
    return this.dodgeCd <= 0;
  }
  get moveSpeed() {
    return this.baseSpeed * this.mods.moveSpeed;
  }

  // ---- state helpers -----------------------------------------------------
  setState(s, duration = 0) {
    this.state = s;
    this.stateTime = 0;
    this.stateDuration = duration;
  }

  setMove(x, z, scale = 1) {
    this.moveX = x;
    this.moveZ = z;
    this.moveScale = scale;
  }

  faceToward(x, z) {
    const dx = x - this.x;
    const dz = z - this.z;
    if (dx * dx + dz * dz > 1e-6) this.aim = angleOf(dx, dz);
  }

  // ---- actions -----------------------------------------------------------
  beginSpawn(height = 13) {
    this.y = height;
    this.ky = 0;
    this.setState(STATE.SPAWN);
    this.invuln = 99;
  }

  setBlock(held) {
    if (held) {
      if (!this.blocking && this.canAct && this.blockLock <= 0 && (this.maxStamina === 0 || this.stamina > 0)) {
        this.blocking = true;
        this.blockTime = 0;
      }
    } else if (this.blocking) {
      this.blocking = false;
      this.blockLock = CONFIG.block.raiseLock;
    }
  }

  /** Returns 'ok' | 'busy' | 'stamina'. */
  startAttack(kind) {
    if (!this.canAct) return 'busy';
    if (!this.hasMove[kind]) return 'busy';
    let def = this.moves[kind];
    let finisher = false;
    let side = this.handSide;
    let chainIndex = 1;
    if (kind === 'light') {
      if (def.chainWindow > 0 && this.chainTimer > 0 && this.chainIndex > 0) {
        chainIndex = this.chainIndex >= 3 ? 1 : this.chainIndex + 1;
      }
      if (chainIndex === 3) {
        def = this.finisherDef;
        finisher = true;
      }
    }
    if (!StaminaSystem.canAfford(this, def.staminaCost)) return 'stamina';
    StaminaSystem.spend(this, def.staminaCost);
    this.blocking = false;
    this.handSide = -this.handSide;
    this.attack = new Attack(def, { chainIndex, finisher, side });
    if (kind === 'light') {
      this.chainIndex = chainIndex;
      this.chainTimer = 0;
    } else {
      this.chainIndex = 0;
    }
    this.setState(STATE.ATTACK);
    this.mvx *= 0.4;
    this.mvz *= 0.4;
    return 'ok';
  }

  /** Returns true if the dodge started. dir is arena-space; falls back to facing. */
  /** Light punches can be cancelled into a dodge once their recovery is half over (keeps flow). */
  get dodgeCancelable() {
    const a = this.attack;
    return this.state === STATE.ATTACK && !!a && a.kind === 'light' && a.phase === PHASE.RECOVERY && a.progress >= 0.4;
  }

  startDodge(dx, dz) {
    if ((!this.canAct && !this.dodgeCancelable) || this.dodgeCd > 0) return false;
    const cost = CONFIG.dodge.staminaCost * this.mods.dodgeCost;
    if (this.maxStamina > 0 && !StaminaSystem.canAfford(this, cost)) return false;
    if (this.maxStamina > 0) StaminaSystem.spend(this, cost);
    let len = Math.hypot(dx, dz);
    if (len < 0.2) {
      dx = Math.sin(this.facing) * -1; // no input: hop backwards
      dz = Math.cos(this.facing) * -1;
      len = 1;
    }
    this.dodgeDirX = dx / len;
    this.dodgeDirZ = dz / len;
    this.blocking = false;
    this.attack = null;
    this.dodgeTime = 0;
    this.dodgeRecover = 0;
    this.dodgeCd = CONFIG.dodge.cooldown * this.mods.dodgeCooldown;
    this.invuln = CONFIG.dodge.invuln;
    this.setState(STATE.DODGE);
    return true;
  }

  // Reaction entry points used by the combat system -------------------------
  enterHitstun(duration) {
    this.interruptActions();
    this.setState(STATE.HITSTUN, duration);
  }

  enterStagger(duration, dazed = false) {
    this.interruptActions();
    this.dazed = dazed;
    this.setState(STATE.STAGGER, duration);
  }

  launch(vy) {
    this.interruptActions();
    this.ky = vy;
    this.y = Math.max(this.y, 0.02);
    this.setState(STATE.AIRBORNE);
  }

  interruptActions() {
    if (this.attack) this.attack.interrupted = true;
    this.attack = null;
    this.blocking = false;
    this.chainIndex = 0;
    this.chainTimer = 0;
    this.invuln = 0;
  }

  addKnock(dirX, dirZ, speed) {
    this.kx = dirX * speed;
    this.kz = dirZ * speed;
    this.mvx = 0;
    this.mvz = 0;
    this.knockTotal += speed;
  }

  beginFall() {
    this.interruptActions();
    this.setState(STATE.FALLING);
    this.fallTime = 0;
    this.spinSpeed = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 3);
  }

  beginKo() {
    this.interruptActions();
    this.setState(STATE.KO);
  }

  // ---- per-step update ---------------------------------------------------
  update(dt, ctx) {
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.pf = this.facing;
    this.clock += dt;
    this.stateTime += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.bumpCd = Math.max(0, this.bumpCd - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.blockLock = Math.max(0, this.blockLock - dt);
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    if (this.state !== STATE.SPAWN) this.invuln = Math.max(0, this.invuln - dt);
    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) this.chainIndex = 0;
    }

    switch (this.state) {
      case STATE.SPAWN:
        this.#updateSpawn(dt, ctx);
        break;
      case STATE.NEUTRAL:
        this.#updateNeutral(dt);
        break;
      case STATE.ATTACK:
        this.#updateAttack(dt);
        break;
      case STATE.DODGE:
        this.#updateDodge(dt);
        break;
      case STATE.HITSTUN:
      case STATE.STAGGER:
        this.#updateStun(dt);
        break;
      case STATE.AIRBORNE:
        this.#updateAirborne(dt, ctx);
        break;
      case STATE.FALLING:
        this.#updateFalling(dt, ctx);
        break;
      case STATE.KO:
        this.#updateKo(dt);
        break;
      default:
        break;
    }
    if (this.state !== STATE.ELIMINATED) this.#integrate(dt, ctx);
  }

  #regen(dt, scale = 1) {
    StaminaSystem.regen(this, dt, scale);
  }

  #updateSpawn(dt, ctx) {
    this.ky -= CONFIG.arena.gravity * 1.4 * dt;
    this.y += this.ky * dt;
    if (this.y <= 0) {
      this.y = 0;
      this.ky = 0;
      this.invuln = 0.25;
      this.setState(STATE.NEUTRAL);
      ctx?.onLand?.(this, true);
    }
  }

  #updateNeutral(dt) {
    this.#regen(dt, this.blocking ? 0.4 : 1);
    let speed = this.moveSpeed * this.moveScale;
    if (this.blocking) {
      this.blockTime += dt;
      speed *= CONFIG.player.blockMoveFactor;
      if (this.maxStamina > 0 && this.stamina <= 0) this.setBlock(false);
    }
    const tx = this.moveX * speed;
    const tz = this.moveZ * speed;
    this.#approachVelocity(tx, tz, dt, this.accel, this.accel * 0.9);
    // Face movement unless an explicit aim is set (blocking / combat keep aim)
    this.facing = turnToward(this.facing, this.aim, this.turnRate * dt);
  }

  #approachVelocity(tx, tz, dt, accel, decel) {
    const dvx = tx - this.mvx;
    const dvz = tz - this.mvz;
    const dist = Math.hypot(dvx, dvz);
    if (dist < 1e-6) return;
    const hasTarget = Math.abs(tx) + Math.abs(tz) > 1e-4;
    const step = (hasTarget ? accel : decel) * dt;
    if (dist <= step) {
      this.mvx = tx;
      this.mvz = tz;
    } else {
      this.mvx += (dvx / dist) * step;
      this.mvz += (dvz / dist) * step;
    }
  }

  #updateAttack(dt) {
    const a = this.attack;
    if (!a) {
      this.setState(STATE.NEUTRAL);
      return;
    }
    this.#regen(dt, 0.6);
    const entered = a.update(dt);
    const d = a.def;
    // Steering: free during windup, locked afterwards.
    if (a.phase === PHASE.WINDUP) {
      this.facing = turnToward(this.facing, this.aim, this.turnRate * dt);
    }
    // Lunge toward the facing direction during windup tail and active phase.
    let lunge = 0;
    if (a.phase === PHASE.WINDUP) lunge = d.lunge * 0.25;
    else if (a.phase === PHASE.ACTIVE) lunge = d.lunge;
    const moveFactor = CONFIG.player.attackMoveFactor;
    const tx = this.forwardX * lunge + this.moveX * this.moveSpeed * this.moveScale * moveFactor;
    const tz = this.forwardZ * lunge + this.moveZ * this.moveSpeed * this.moveScale * moveFactor;
    this.#approachVelocity(tx, tz, dt, 120, 60);
    if (a.done || entered === PHASE.DONE) {
      if (a.kind === 'light' && d.chainWindow > 0) this.chainTimer = d.chainWindow;
      this.attack = null;
      this.setState(STATE.NEUTRAL);
    }
  }

  #updateDodge(dt) {
    this.dodgeTime += dt;
    const D = CONFIG.dodge;
    if (this.dodgeTime < D.duration) {
      const t = this.dodgeTime / D.duration;
      const s = D.speed * (1 - t * t * 0.85);
      this.mvx = this.dodgeDirX * s;
      this.mvz = this.dodgeDirZ * s;
      // Face movement direction while dodging for a readable pose
      this.facing = turnToward(this.facing, angleOf(this.dodgeDirX, this.dodgeDirZ), 20 * dt);
    } else {
      this.dodgeRecover += dt;
      this.#approachVelocity(0, 0, dt, 0, 90);
      this.#regen(dt, 0.5);
      if (this.dodgeRecover >= D.recovery) this.setState(STATE.NEUTRAL);
    }
  }

  #updateStun(dt) {
    this.mvx = 0;
    this.mvz = 0;
    if (this.stateTime >= this.stateDuration) {
      if (this.dazed) {
        this.dazed = false;
        this.hp = Math.max(this.hp, this.maxHp * CONFIG.stagger.dazeRecoverHp);
      }
      this.setState(STATE.NEUTRAL);
      this.aim = this.facing;
    }
  }

  #updateAirborne(dt, ctx) {
    this.mvx = 0;
    this.mvz = 0;
    this.ky -= CONFIG.arena.gravity * dt;
    this.y += this.ky * dt;
    if (this.y <= 0 && this.ky <= 0) {
      this.y = 0;
      this.ky = 0;
      this.setState(STATE.HITSTUN, 0.22);
      ctx?.onLand?.(this, false);
    }
  }

  #updateFalling(dt, ctx) {
    this.fallTime += dt;
    this.ky -= CONFIG.arena.gravity * dt;
    this.y += this.ky * dt;
    this.facing += this.spinSpeed * dt;
    if (this.y < CONFIG.arena.killY) {
      this.setState(STATE.ELIMINATED);
    }
  }

  #updateKo(dt) {
    this.mvx = 0;
    this.mvz = 0;
  }

  #integrate(dt, ctx) {
    const P = CONFIG.physics;
    const airborne = this.y > 0.001 || this.state === STATE.AIRBORNE || this.state === STATE.FALLING;

    // Knockback decay
    const ks = this.knockSpeed;
    if (ks > 0) {
      let ns;
      if (airborne) ns = ks * Math.exp(-P.airDamp * dt);
      else ns = Math.max(0, ks * Math.exp(-P.groundDamp * dt) - P.groundBrake * dt);
      if (ns < P.stopSpeed && !airborne) ns = 0;
      const f = ns / ks;
      this.kx *= f;
      this.kz *= f;
    }

    this.x += (this.mvx + this.kx) * dt;
    this.z += (this.mvz + this.kz) * dt;

    // Edge protection: only characters under their own control are held inside.
    if (this.state !== STATE.FALLING && this.state !== STATE.KO && !this.knocked && this.state !== STATE.SPAWN) {
      const lim = CONFIG.arena.half - CONFIG.arena.walkInset;
      if (Math.abs(this.x) > lim) {
        this.x = clamp(this.x, -lim, lim);
        this.mvx = 0;
        this.kx = 0;
      }
      if (Math.abs(this.z) > lim) {
        this.z = clamp(this.z, -lim, lim);
        this.mvz = 0;
        this.kz = 0;
      }
    }
    if (this.state === STATE.SPAWN) {
      // spawn drop stays inside the roof
      const lim = CONFIG.arena.half - 0.5;
      this.x = clamp(this.x, -lim, lim);
      this.z = clamp(this.z, -lim, lim);
    }
  }
}
