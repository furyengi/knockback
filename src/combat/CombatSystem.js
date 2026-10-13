import { CONFIG } from '../config/gameConfig.js';
import { STATE } from '../entities/Character.js';
import { HitDetection } from './HitDetection.js';
import { KnockbackSystem } from './KnockbackSystem.js';
import { StaminaSystem } from './StaminaSystem.js';
import { PHASE } from './Attack.js';

// Resolves active attacks against targets: dodge i-frames, blocks, direct hits.
// Emits events on the battle bus; it never touches rendering.
export class CombatSystem {
  constructor(battle) {
    this.battle = battle;
    this.bus = battle.bus;
    this._hits = [];
  }

  update() {
    const chars = this.battle.characters;
    for (let i = 0; i < chars.length; i++) {
      const a = chars[i];
      const atk = a.attack;
      if (a.state !== STATE.ATTACK || !atk || atk.phase !== PHASE.ACTIVE) continue;
      const targets = HitDetection.collect(a, chars, this._hits);
      for (let j = 0; j < targets.length; j++) {
        if (a.attack !== atk) break; // attacker got interrupted by an earlier target in this loop
        atk.markHit(targets[j].id);
        this.resolveHit(a, targets[j], atk);
      }
    }
  }

  resolveHit(a, t, atk) {
    if (t.invuln > 0) {
      if (t.state === STATE.DODGE) {
        t.counterWindow = 1.2;
        StaminaSystem.refund(t, CONFIG.dodge.staminaRefundOnPerfect * t.mods.perfectRefund);
        this.bus.emit('dodged', { attacker: a, target: t, attack: atk });
      }
      return;
    }

    const canBlock = t.blocking && HitDetection.inBlockArc(t, a, CONFIG.block.arc);
    if (canBlock) {
      if (t.isPlayer && t.blockTime <= CONFIG.block.perfectWindow) return this.#perfectBlock(a, t, atk);
      return this.#blockedHit(a, t, atk);
    }
    return this.#directHit(a, t, atk);
  }

  #point(a, t) {
    const dx = a.x - t.x;
    const dz = a.z - t.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: t.x + (dx / l) * t.radius * 0.8, y: 1.1 * t.scale, z: t.z + (dz / l) * t.radius * 0.8 };
  }

  #perfectBlock(a, t, atk) {
    const B = CONFIG.block;
    const dx = a.x - t.x;
    const dz = a.z - t.z;
    const l = Math.hypot(dx, dz) || 1;
    a.enterStagger(B.perfectStagger, false);
    a.addKnock(dx / l, dz / l, 4.5);
    t.hitFlash = 0;
    t.counterWindow = 1.2;
    StaminaSystem.refund(t, B.perfectStaminaRefund * t.mods.perfectRefund);
    this.bus.emit('perfectBlock', { attacker: a, target: t, attack: atk, ...this.#point(a, t), dirX: -dx / l, dirZ: -dz / l });
    this.bus.emit('hitstop', CONFIG.hitstop.perfectBlock);
  }

  #blockedHit(a, t, atk) {
    const def = atk.def;
    const B = CONFIG.block;
    const dir = KnockbackSystem.direction(a, t, def);
    const cost = (def.staminaDamage ?? 10) * t.mods.blockStamina;
    const broke = t.stamina - cost <= 0;
    const atkMult = def.kind === 'heavy' ? a.mods.heavyKnock : a.mods.lightKnock;
    let speed = KnockbackSystem.speed(a, t, def, { attackMult: atkMult });
    t.lastHitBy = a;
    t.lastHitTime = this.battle.time;

    if (broke) {
      StaminaSystem.drain(t, t.stamina);
      const dmg = def.damage * B.damageTaken * 2;
      this.#applyDamage(t, dmg);
      t.addKnock(dir.x, dir.z, speed * 0.8);
      t.enterStagger(B.guardBreakStun, false);
      t.hitFlash = 0.12;
      this.bus.emit('guardBreak', { attacker: a, target: t, attack: atk, ...this.#point(a, t), dirX: dir.x, dirZ: dir.z });
      this.bus.emit('hitstop', CONFIG.hitstop.heavy);
      if (t.isPlayer && t.hp <= 0) this.battle.playerDown('hp');
      return;
    }
    StaminaSystem.drain(t, cost);
    const dmg = def.damage * B.damageTaken;
    this.#applyDamage(t, dmg);
    speed *= B.knockbackTaken * t.mods.blockKnockback;
    t.addKnock(dir.x, dir.z, speed);
    this.bus.emit('block', { attacker: a, target: t, attack: atk, speed, ...this.#point(a, t), dirX: dir.x, dirZ: dir.z, heavy: def.kind === 'heavy' });
    this.bus.emit('hitstop', CONFIG.hitstop.block);
    if (t.isPlayer && t.hp <= 0) this.battle.playerDown('hp');
  }

  #applyDamage(t, dmg) {
    t.hp = Math.max(0, t.hp - dmg);
    t.lastDamagedAt = this.battle.time;
  }

  #directHit(a, t, atk) {
    const def = atk.def;
    const heavy = def.kind === 'heavy';
    const armored = t.armored;
    const dir = KnockbackSystem.direction(a, t, def);

    let dmg = def.damage * (heavy ? a.mods.heavyDamage : 1);
    if (armored) dmg *= 0.7;
    if (a.counterWindow > 0) dmg *= 1.15;
    const atkMult = heavy ? a.mods.heavyKnock : a.mods.lightKnock;
    const speed = KnockbackSystem.speed(a, t, def, { attackMult: atkMult });
    const counter = a.counterWindow > 0;
    a.counterWindow = 0;

    this.#applyDamage(t, dmg);
    t.lastHitBy = a;
    t.lastHitTime = this.battle.time;
    t.hitFlash = 0.14;
    t.lastBumpBy = null;

    const hs = CONFIG.hitstop[def.hitstop] ?? 0.05;
    let reaction = 'hitstun';

    if (armored) {
      t.addKnock(dir.x, dir.z, speed * 0.35);
      reaction = 'armor';
    } else {
      const wasDazed = t.dazed;
      t.addKnock(dir.x, dir.z, speed);
      const pop = KnockbackSystem.pop(t, def);
      const stun = def.hitstun * (1 - t.resist * 0.5);
      if (!t.isPlayer && t.hp <= 0 && !wasDazed && t.state !== STATE.STAGGER) {
        t.enterStagger(CONFIG.stagger.dazeDuration, true);
        reaction = 'daze';
      } else if (pop > 0.6 && t.state !== STATE.STAGGER) {
        t.launch(pop);
        reaction = 'launch';
      } else if (t.state !== STATE.STAGGER) {
        t.enterHitstun(stun);
      }
    }

    const point = this.#point(a, t);
    this.bus.emit('hit', {
      attacker: a,
      target: t,
      attack: atk,
      heavy,
      finisher: !!atk.finisher,
      counter,
      armored,
      reaction,
      damage: dmg,
      speed,
      dirX: dir.x,
      dirZ: dir.z,
      ...point,
    });
    if (reaction === 'daze') this.bus.emit('daze', { target: t });
    this.bus.emit('hitstop', armored ? hs * 0.5 : hs);
    if (t.isPlayer && t.hp <= 0) this.battle.playerDown('hp');
  }
}
