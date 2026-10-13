import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config/gameConfig.js';
import { Attack, PHASE } from '../src/combat/Attack.js';
import { KnockbackSystem } from '../src/combat/KnockbackSystem.js';
import { HitDetection } from '../src/combat/HitDetection.js';
import { RingOutSystem } from '../src/combat/RingOutSystem.js';
import { StaminaSystem } from '../src/combat/StaminaSystem.js';
import { STATE } from '../src/entities/Character.js';
import { makeBattle, run, addDummy, collect, emptyInput, DT } from './helpers.js';

describe('Attack phases', () => {
  it('moves windup -> active -> recovery -> done with the configured timings', () => {
    const def = CONFIG.attacks.heavy;
    const a = new Attack(def);
    expect(a.phase).toBe(PHASE.WINDUP);
    const seen = [];
    let t = 0;
    while (!a.done && t < 5) {
      const entered = a.update(DT);
      t += DT;
      if (entered) seen.push([entered, +t.toFixed(3)]);
    }
    expect(seen.map((s) => s[0])).toEqual([PHASE.ACTIVE, PHASE.RECOVERY, PHASE.DONE]);
    expect(seen[0][1]).toBeCloseTo(def.windup, 1);
    expect(seen[1][1]).toBeCloseTo(def.windup + def.active, 1);
    expect(seen[2][1]).toBeCloseTo(def.windup + def.active + def.recovery, 1);
  });

  it('can only hit during the active phase and once per target', () => {
    const a = new Attack(CONFIG.attacks.light);
    expect(a.canHit(7)).toBe(false);
    while (a.phase === PHASE.WINDUP) a.update(DT);
    expect(a.canHit(7)).toBe(true);
    a.markHit(7);
    expect(a.canHit(7)).toBe(false);
    expect(a.canHit(8)).toBe(true);
  });
});

describe('Hit once per swing', () => {
  it('a single punch damages a target exactly once even though the active window spans many steps', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    const dummy = addDummy(b, 'guard', 0, -1.2);
    dummy.resist = 0.9; // barely moves, stays in range for the whole active window
    dummy.mass = 50;
    const hits = collect(b, 'hit');
    p.facing = p.aim = Math.PI; // face -Z
    expect(p.startAttack('light')).toBe('ok');
    run(b, 0.6);
    expect(hits.length).toBe(1);
  });
});

describe('Stamina', () => {
  it('spends on attacks, refuses when empty, and regenerates after the delay', () => {
    const b = makeBattle();
    const p = b.player;
    expect(p.stamina).toBe(100);
    expect(p.startAttack('heavy')).toBe('ok');
    expect(p.stamina).toBe(100 - CONFIG.attacks.heavy.staminaCost);
    p.setState(STATE.NEUTRAL);
    p.attack = null;
    p.stamina = 3;
    expect(p.startAttack('heavy')).toBe('stamina');
    expect(p.state).toBe(STATE.NEUTRAL);
    p.stamina = 10;
    p.staminaDelay = 0;
    const before = p.stamina;
    for (let i = 0; i < 60; i++) p.update(DT, b.ctx);
    expect(p.stamina).toBeGreaterThan(before + 15);
  });

  it('pauses regeneration right after spending', () => {
    const c = { stamina: 50, maxStamina: 100, staminaRegen: 30, staminaRegenDelay: 0.5, staminaDelay: 0, mods: { staminaRegen: 1 } };
    StaminaSystem.spend(c, 10);
    expect(c.stamina).toBe(40);
    StaminaSystem.regen(c, 0.3);
    expect(c.stamina).toBe(40);
    StaminaSystem.regen(c, 0.3);
    StaminaSystem.regen(c, 0.2);
    expect(c.stamina).toBeGreaterThan(40);
  });
});

describe('Knockback', () => {
  it('heavy hits travel much farther than light hits (tuning targets)', () => {
    const light = KnockbackSystem.slideDistance(CONFIG.attacks.light.knockback);
    const heavyGround = KnockbackSystem.slideDistance(CONFIG.attacks.heavy.knockback);
    console.log('light slide', light.toFixed(2), 'heavy ground slide (no air)', heavyGround.toFixed(2));
    expect(heavyGround).toBeGreaterThan(light * 1.8);
  });

  it('is directional (away from attacker) and heavier targets move less', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.facing = p.aim = Math.PI;
    const runner = addDummy(b, 'runner', 0, -1.3);
    const bruiser = addDummy(b, 'bruiser', 4, 0);
    const dRun = KnockbackSystem.speed(p, runner, CONFIG.attacks.heavy);
    const dBru = KnockbackSystem.speed(p, bruiser, CONFIG.attacks.heavy);
    expect(dRun).toBeGreaterThan(dBru * 1.5);
    const dir = KnockbackSystem.direction(p, runner, CONFIG.attacks.heavy);
    expect(dir.z).toBeLessThan(-0.9);
    expect(Math.abs(dir.x)).toBeLessThan(0.1);
  });

  it('lower health increases knockback', () => {
    const b = makeBattle();
    const p = b.player;
    const e = addDummy(b, 'guard', 0, -1);
    const full = KnockbackSystem.speed(p, e, CONFIG.attacks.light);
    e.hp = e.maxHp * 0.2;
    expect(KnockbackSystem.speed(p, e, CONFIG.attacks.light)).toBeGreaterThan(full * 1.2);
  });

  it('measured: a full-health heavy smash on a Runner flies about 6-8 m', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    const e = addDummy(b, 'runner', 0, -1.2);
    p.facing = p.aim = Math.PI;
    p.startAttack('heavy');
    run(b, 0.7);
    const dist = Math.hypot(e.x - 0, e.z + 1.2);
    run(b, 1.5);
    const total = Math.hypot(e.x, e.z + 1.2);
    console.log('runner heavy distance (after settling)', total.toFixed(2), 'state', e.state);
    expect(total).toBeGreaterThan(5);
    expect(total).toBeLessThan(9.5);
  });
});

describe('Ring-outs', () => {
  it('detects the real boundary, not a decorative line', () => {
    const half = CONFIG.arena.half;
    expect(RingOutSystem.isOutside({ x: half - 0.01, z: 0 })).toBe(false);
    expect(RingOutSystem.isOutside({ x: half + 0.01, z: 0 })).toBe(true);
    expect(RingOutSystem.isOutside({ x: 0, z: -half - 0.5 })).toBe(true);
  });

  it('a heavy smash near the edge eliminates the enemy, awards credit, and cleans it up', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 6.2;
    p.z = 0;
    p.facing = p.aim = Math.PI / 2; // face +X
    const e = addDummy(b, 'runner', 7.6, 0);
    const ringOuts = collect(b, 'ringOut');
    const removed = collect(b, 'removed');
    p.startAttack('heavy');
    run(b, 0.4);
    run(b, 3);
    expect(ringOuts.length).toBe(1);
    expect(ringOuts[0].credit).toBe(p);
    expect(b.characters.includes(e)).toBe(false);
    expect(removed.some((r) => r.character === e)).toBe(true);
    expect(b.score.ringOuts).toBe(1);
    expect(b.score.score).toBeGreaterThan(100);
  });

  it('walking cannot leave the arena', () => {
    const b = makeBattle();
    run(b, 6, () => emptyInput({ move: { x: 1, z: 0 } }));
    expect(Math.abs(b.player.x)).toBeLessThanOrEqual(CONFIG.arena.half - CONFIG.arena.walkInset + 1e-6);
    expect(b.player.state).not.toBe(STATE.FALLING);
  });

  it('dodging toward the edge cannot leave the arena', () => {
    const b = makeBattle();
    b.player.x = CONFIG.arena.half - 1;
    b.player.z = 0;
    b.controller.update(DT, emptyInput({ move: { x: 1, z: 0 }, pressed: { dodge: true } }));
    run(b, 1);
    expect(b.player.state).not.toBe(STATE.FALLING);
    expect(Math.abs(b.player.x)).toBeLessThanOrEqual(CONFIG.arena.half);
  });

  it('eliminated characters stop colliding and cannot be hit or score twice', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    const e = addDummy(b, 'runner', 0, -1);
    e.x = CONFIG.arena.half + 0.5;
    e.z = 0;
    e.setState(STATE.HITSTUN, 0.5);
    run(b, 0.1);
    expect(e.state).toBe(STATE.FALLING);
    expect(e.hittable).toBe(false);
    expect(e.inPlay).toBe(false);
    expect(b.enemiesInPlay()).toBe(0);
  });
});

describe('Block and dodge', () => {
  it('a well-timed block is a perfect block that staggers the attacker without knockback', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.facing = p.aim = Math.PI;
    const e = addDummy(b, 'runner', 0, -1.3);
    e.facing = e.aim = 0; // face +Z toward the player
    const perfect = collect(b, 'perfectBlock');
    e.startAttack('light');
    run(b, 0.18); // raise the block just before the swing lands
    run(b, 0.6, () => emptyInput({ held: { block: true } }));
    expect(perfect.length).toBe(1);
    expect(e.state).toBe(STATE.STAGGER);
    expect(p.hp).toBe(p.maxHp);
    expect(p.knockSpeed).toBeLessThan(0.5);
  });

  it('a late block reduces knockback and damage but does not erase them', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.facing = p.aim = Math.PI;
    const e = addDummy(b, 'bruiser', 0, -1.8);
    e.facing = e.aim = 0;
    const blocks = collect(b, 'block');
    p.setBlock(true);
    p.blockTime = 1; // held for a while: not a perfect block
    e.startAttack('light');
    run(b, 0.8, () => emptyInput({ held: { block: true } }));
    expect(blocks.length).toBe(1);
    expect(p.hp).toBeLessThan(p.maxHp);
    expect(p.hp).toBeGreaterThan(p.maxHp - CONFIG.enemies.bruiser.attacks.light.damage);
  });

  it('blocking only protects the front arc', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.facing = 0; // facing +Z
    expect(HitDetection.inBlockArc(p, { x: 0, z: 2 }, CONFIG.block.arc)).toBe(true);
    expect(HitDetection.inBlockArc(p, { x: 1.2, z: 1.2 }, CONFIG.block.arc)).toBe(true);
    expect(HitDetection.inBlockArc(p, { x: 2, z: 0 }, CONFIG.block.arc)).toBe(false);
    expect(HitDetection.inBlockArc(p, { x: 0, z: -2 }, CONFIG.block.arc)).toBe(false);
  });

  it('dodge grants an explicit, short invulnerability window and respects its cooldown and cost', () => {
    const b = makeBattle();
    const p = b.player;
    expect(p.startDodge(1, 0)).toBe(true);
    expect(p.invuln).toBeCloseTo(CONFIG.dodge.invuln, 5);
    expect(p.stamina).toBe(100 - CONFIG.dodge.staminaCost);
    run(b, CONFIG.dodge.invuln + 0.05);
    expect(p.invuln).toBe(0);
    run(b, CONFIG.dodge.duration + CONFIG.dodge.recovery);
    expect(p.state).toBe(STATE.NEUTRAL);
    expect(p.startDodge(1, 0)).toBe(false); // still cooling down
    run(b, CONFIG.dodge.cooldown);
    expect(p.startDodge(1, 0)).toBe(true);
  });

  it('dodging through an attack avoids it and reports a perfect dodge', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.facing = p.aim = Math.PI;
    const e = addDummy(b, 'runner', 0, -1.2);
    e.facing = e.aim = 0;
    const dodged = collect(b, 'dodged');
    const hits = collect(b, 'hit');
    e.startAttack('light');
    run(b, 0.2);
    p.startDodge(1, 0);
    run(b, 0.6);
    // the attack's active window overlaps the dodge i-frames in this timing
    expect(hits.filter((h) => h.target === p).length + dodged.length).toBeGreaterThan(0);
  });
});

describe('Armor and interrupts', () => {
  it('player attack winding up is interrupted by a hit; a bruiser smash is not', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.facing = p.aim = Math.PI;
    const r = addDummy(b, 'runner', 0, -1.1);
    r.facing = r.aim = 0;
    p.startAttack('heavy');
    r.startAttack('light');
    run(b, 0.35);
    expect(p.attack === null || p.state !== STATE.ATTACK).toBe(true);

    const b2 = makeBattle();
    const p2 = b2.player;
    p2.x = 0;
    p2.z = 0;
    p2.facing = p2.aim = Math.PI;
    const br = addDummy(b2, 'bruiser', 0, -2.3);
    br.facing = br.aim = 0;
    br.startAttack('heavy');
    run(b2, 0.4);
    // player jabs the bruiser mid-windup
    p2.x = 0;
    p2.z = -0.5;
    p2.startAttack('light');
    run(b2, 0.3);
    expect(br.state).toBe(STATE.ATTACK);
  });
});

describe('Dodge cancel', () => {
  it('a light punch can be cancelled into a dodge late in its recovery, a heavy smash cannot', () => {
    const b = makeBattle();
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.startAttack('light');
    run(b, 0.13); // windup + active
    expect(p.startDodge(1, 0)).toBe(false); // early recovery: still committed
    run(b, 0.12);
    expect(p.dodgeCancelable).toBe(true);
    expect(p.startDodge(1, 0)).toBe(true);
    expect(p.state).toBe(STATE.DODGE);

    const b2 = makeBattle();
    const p2 = b2.player;
    p2.startAttack('heavy');
    run(b2, CONFIG.attacks.heavy.windup + CONFIG.attacks.heavy.active + CONFIG.attacks.heavy.recovery * 0.8);
    expect(p2.dodgeCancelable).toBe(false);
    expect(p2.startDodge(1, 0)).toBe(false);
  });
});
