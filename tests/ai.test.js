import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config/gameConfig.js';
import { STATE } from '../src/entities/Character.js';
import { makeBattle, run, collect, emptyInput, DT } from './helpers.js';

function arenaWith(type, seed = 21, aggression = 1) {
  const b = makeBattle(seed);
  b.start();
  b.waves.pending = [];
  b.waves.state = 'idle';
  const e = b.spawnEnemy(type, 5, -4, 1, aggression);
  run(b, 1.5); // let it land
  b.player.x = 0;
  b.player.z = 3;
  return { b, e };
}

describe('Enemy archetypes', () => {
  for (const type of ['runner', 'guard', 'bruiser']) {
    it(`${type} approaches, telegraphs, attacks an idle player, and never leaves the roof by itself`, () => {
      const { b, e } = arenaWith(type);
      const swings = collect(b, 'swing');
      const states = new Set();
      for (let i = 0; i < 60 * 25; i++) {
        b.player.hp = b.player.maxHp; // keep the player alive and still
        b.player.x = 0;
        b.player.z = 3;
        b.update(DT, emptyInput());
        states.add(e.ai.state);
        expect(e.state).not.toBe(STATE.FALLING);
      }
      const mine = swings.filter((s) => s.character === e);
      expect(mine.length).toBeGreaterThan(0);
      expect(states.has('approach')).toBe(true);
      expect(states.has('telegraph')).toBe(true);
      expect(states.has('recover')).toBe(true);
    });
  }

  it('every attack has a readable telegraph and a punishable recovery', () => {
    for (const [name, def] of Object.entries(CONFIG.enemies)) {
      for (const [kind, atk] of Object.entries(def.attacks)) {
        expect(atk.windup, `${name} ${kind} windup`).toBeGreaterThanOrEqual(0.25);
        expect(atk.recovery, `${name} ${kind} recovery`).toBeGreaterThanOrEqual(0.45);
      }
    }
    // the dangerous one is the most telegraphed
    expect(CONFIG.enemies.bruiser.attacks.heavy.windup).toBeGreaterThanOrEqual(0.9);
  });

  it('bruiser heavy has armour during windup; runner light does not', () => {
    const { b, e } = arenaWith('bruiser');
    e.ai = null;
    e.startAttack('heavy');
    expect(e.armored).toBe(true);
    const r = arenaWith('runner');
    r.e.ai = null;
    r.e.startAttack('light');
    expect(r.e.armored).toBe(false);
  });

  it('guard blocks frontal light punches, loses stamina, and a heavy smash breaks its guard', () => {
    const b = makeBattle(3);
    b.start();
    b.waves.pending = [];
    b.waves.state = 'idle';
    const g = b.spawnEnemy('guard', 0, -1.5);
    g.ai = null;
    run(b, 1.5);
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.facing = p.aim = Math.PI;
    g.x = 0;
    g.z = -1.4;
    g.facing = g.aim = 0;
    g.setBlock(true);
    const blocks = collect(b, 'block');
    const breaks = collect(b, 'guardBreak');
    p.startAttack('light');
    run(b, 0.5);
    expect(blocks.length).toBe(1);
    expect(g.stamina).toBeLessThan(g.maxStamina);
    expect(g.state).toBe(STATE.NEUTRAL);
    // two smashes break the guard
    for (let i = 0; i < 2; i++) {
      g.setBlock(true);
      g.x = 0;
      g.z = -1.4;
      g.kx = g.kz = 0;
      g.facing = 0;
      p.x = 0;
      p.z = 0;
      p.facing = p.aim = Math.PI;
      p.stamina = 100;
      p.startAttack('heavy');
      run(b, 1.3);
    }
    expect(breaks.length).toBeGreaterThanOrEqual(1);
  });

  it('a guard can be hit from behind where its block does not apply', () => {
    const b = makeBattle(3);
    b.start();
    b.waves.pending = [];
    b.waves.state = 'idle';
    const g = b.spawnEnemy('guard', 0, -1.4);
    g.ai = null;
    run(b, 1.5);
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.facing = p.aim = Math.PI;
    g.x = 0;
    g.z = -1.4;
    g.facing = g.aim = Math.PI; // guard faces away from the player
    g.setBlock(true);
    const hits = collect(b, 'hit');
    p.startAttack('light');
    run(b, 0.5);
    expect(hits.filter((h) => h.target === g).length).toBe(1);
  });

  it('daze: an enemy drained to zero health is stunned and launched farther', () => {
    const b = makeBattle(8);
    b.start();
    b.waves.pending = [];
    b.waves.state = 'idle';
    const r = b.spawnEnemy('runner', 0, -1.3);
    r.ai = null;
    run(b, 1.5);
    const p = b.player;
    p.x = 0;
    p.z = 0;
    p.facing = p.aim = Math.PI;
    r.x = 0;
    r.z = -1.3;
    r.hp = 1;
    const daze = collect(b, 'daze');
    p.startAttack('light');
    run(b, 0.3);
    expect(daze.length).toBe(1);
    expect(r.dazed).toBe(true);
    expect(r.state).toBe(STATE.STAGGER);
    run(b, CONFIG.stagger.dazeDuration + 0.5);
    expect(r.dazed).toBe(false);
    expect(r.hp).toBeGreaterThan(0);
  });

  it('bowling: a launched enemy knocks another off and the player is credited with a bonus', () => {
    const b = makeBattle(9);
    b.start();
    b.waves.pending = [];
    b.waves.state = 'idle';
    const a = b.spawnEnemy('runner', 6.4, 0);
    const c = b.spawnEnemy('runner', 8.0, 0);
    a.ai = c.ai = null;
    run(b, 1.5);
    const p = b.player;
    p.x = 4.6;
    p.z = 0;
    p.facing = p.aim = Math.PI / 2;
    a.x = 6.1;
    a.z = 0;
    c.x = 7.7;
    c.z = 0;
    const ro = collect(b, 'ringOut');
    p.startAttack('heavy');
    run(b, 3);
    expect(ro.length).toBeGreaterThanOrEqual(1);
    expect(ro.every((r) => r.credit === p)).toBe(true);
  });

  it('waves get measurably more aggressive but are capped', () => {
    const b = makeBattle(1);
    b.waves.wave = 1;
    expect(b.waves.aggression).toBe(1);
    b.waves.wave = 8;
    expect(b.waves.aggression).toBeGreaterThan(1.2);
    b.waves.wave = 200;
    expect(b.waves.aggression).toBeLessThanOrEqual(CONFIG.waves.aggressionCap);
    expect(b.waves.hpScale).toBeLessThanOrEqual(CONFIG.waves.hpScaleCap);
  });
});
