import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config/gameConfig.js';
import { composeWave } from '../src/game/WaveManager.js';
import { UpgradeManager, UPGRADES } from '../src/game/UpgradeManager.js';
import { Rng } from '../src/util/Rng.js';
import { Storage } from '../src/util/Storage.js';
import { loadBest, saveBest } from '../src/game/ScoreManager.js';
import { STATE } from '../src/entities/Character.js';
import { makeBattle, run, addDummy, collect, emptyInput, DT } from './helpers.js';

describe('Score', () => {
  it('rewards ring-outs far more than hits, and builds a combo multiplier', () => {
    const b = makeBattle();
    const s = b.score;
    for (let i = 0; i < 6; i++) {
      s.bumpCombo();
    }
    expect(s.multiplier).toBeGreaterThan(1);
    expect(s.multiplier).toBeLessThanOrEqual(CONFIG.combo.maxMultiplier);
    const before = s.score;
    b.bus.emit('perfectBlock', { target: b.player });
    expect(s.score - before).toBeGreaterThanOrEqual(CONFIG.score.perfectBlock);
    expect(CONFIG.score.ringOut).toBeGreaterThan(CONFIG.score.heavyHit * 5);
  });

  it('combo expires after the window and breaks when the player is hurt', () => {
    const b = makeBattle();
    b.score.bumpCombo();
    b.score.bumpCombo();
    expect(b.score.combo).toBe(2);
    for (let i = 0; i < 60 * (CONFIG.combo.window + 0.2); i++) b.score.update(DT);
    expect(b.score.combo).toBe(0);
    b.score.bumpCombo();
    b.bus.emit('playerHurt', {});
    expect(b.score.combo).toBe(0);
  });

  it('awards nothing for enemies that fall without the player involved', () => {
    const b = makeBattle();
    b.bus.emit('ringOut', { character: { isPlayer: false, type: 'runner' }, credit: null });
    expect(b.score.score).toBe(0);
    expect(b.score.kills).toBe(1);
  });

  it('gives wave-clear and flawless bonuses', () => {
    const b = makeBattle();
    b.bus.emit('waveClear', { wave: 2 });
    expect(b.score.score).toBe(CONFIG.score.waveClear + 2 * CONFIG.score.waveClearPerWave + CONFIG.score.flawlessBonus);
  });

  it('persists best score safely, even with corrupt storage', () => {
    saveBest({ score: 1234, wave: 5 });
    expect(loadBest()).toEqual({ score: 1234, wave: 5 });
    Storage.setRaw('knockback.best.v1', '{"score":"abc"');
    expect(loadBest()).toEqual({ score: 0, wave: 0 });
  });
});

describe('Waves', () => {
  it('starts with a manageable three enemies and keeps growing without exploding', () => {
    const rng = new Rng(5);
    expect(composeWave(1, rng)).toHaveLength(3);
    let prev = 0;
    for (let n = 1; n <= 40; n++) {
      const w = composeWave(n, rng);
      expect(w.length).toBeGreaterThanOrEqual(3);
      expect(w.length).toBeLessThanOrEqual(CONFIG.waves.maxPerWave);
      expect(w.every((t) => ['runner', 'guard', 'bruiser'].includes(t))).toBe(true);
      prev = Math.max(prev, w.length);
    }
    expect(prev).toBeGreaterThan(5);
    expect(composeWave(3, rng)).toContain('bruiser');
  });

  it('runs a wave to completion and fires waveStart / waveClear exactly once', () => {
    const b = makeBattle();
    const started = collect(b, 'waveStart');
    const cleared = collect(b, 'waveClear');
    b.beginWave(1, 0.2);
    run(b, 0.5);
    expect(started).toHaveLength(1);
    expect(b.waves.remaining).toBeGreaterThan(0);
    // Kill everything by shoving them off the roof as soon as they land
    for (let i = 0; i < 60 * 25 && cleared.length === 0; i++) {
      for (const c of b.characters) {
        if (c.team === 'enemy' && c.state === STATE.NEUTRAL) {
          c.x = CONFIG.arena.half + 1;
          c.setState(STATE.HITSTUN, 1);
        }
      }
      b.update(DT, emptyInput());
    }
    expect(cleared).toHaveLength(1);
    expect(b.waves.remaining).toBe(0);
    run(b, 2);
    expect(cleared).toHaveLength(1);
  });

  it('restart yields a clean run with no leftover entities', () => {
    const b = makeBattle();
    b.start();
    run(b, 3);
    expect(b.characters.length).toBeGreaterThan(1);
    b.start();
    expect(b.characters).toHaveLength(1);
    expect(b.player.hp).toBe(b.player.maxHp);
    expect(b.score.score).toBe(0);
    expect(b.waves.wave).toBe(1);
    expect(b.waves.pending.length + b.waves.warnings.length).toBe(3);
    expect(b.coordinator.holders.size).toBe(0);
  });
});

describe('Upgrades', () => {
  it('offers three distinct choices and applies them to the player mods', () => {
    const b = makeBattle();
    const um = new UpgradeManager(new Rng(3));
    const opts = um.roll(3);
    expect(opts).toHaveLength(3);
    expect(new Set(opts.map((o) => o.id)).size).toBe(3);
    const p = b.player;
    const before = p.mods.heavyKnock;
    expect(um.pick('heavyHands', p)).toBe(true);
    expect(p.mods.heavyKnock).toBeGreaterThan(before);
    um.pick('quickFeet', p);
    expect(p.mods.dodgeCooldown).toBeLessThan(1);
    um.pick('ironGuard', p);
    expect(p.mods.blockKnockback).toBeLessThan(1);
  });

  it('Heavy Hands visibly increases how far a smash sends enemies', () => {
    const measure = (upgraded) => {
      const b = makeBattle();
      const p = b.player;
      if (upgraded) b.upgrades.pick('heavyHands', p);
      p.x = 0;
      p.z = 0;
      p.facing = p.aim = Math.PI;
      const e = addDummy(b, 'guard', 0, -1.3);
      p.startAttack('heavy');
      run(b, 3);
      return Math.hypot(e.x, e.z + 1.3);
    };
    expect(measure(true)).toBeGreaterThan(measure(false) * 1.15);
  });

  it('caps stacking and Second Wind heals after a wave', () => {
    const b = makeBattle();
    const um = new UpgradeManager(new Rng(1));
    const p = b.player;
    for (let i = 0; i < 10; i++) um.pick('heavyHands', p);
    expect(um.level('heavyHands')).toBe(UPGRADES.find((u) => u.id === 'heavyHands').max);
    p.hp = 40;
    um.pick('secondWind', p);
    expect(p.hp).toBe(70);
    p.hp = 50;
    expect(um.onWaveClear(p)).toBe(30);
    expect(p.hp).toBe(80);
  });

  it('a new upgrade only needs a definition entry (roll includes any non-maxed def)', () => {
    const um = new UpgradeManager(new Rng(9));
    um.defs = [...um.defs, { id: 'test', name: 'T', tag: 'T', desc: 'd', max: 1, apply(p) { p.mods.moveSpeed *= 2; } }];
    const seen = new Set();
    for (let i = 0; i < 50; i++) um.roll(3).forEach((o) => seen.add(o.id));
    expect(seen.has('test')).toBe(true);
  });
});

describe('Headless soak: AI + player bot', () => {
  it('plays through several waves with no exceptions, stuck states or duplicate entities', () => {
    const b = makeBattle(77);
    b.start();
    const p = b.player;
    const rngBot = new Rng(5);
    const cleared = collect(b, 'waveClear');
    const states = new Set();
    let maxChars = 0;
    // Simple bot: chase nearest enemy, light-punch, heavy when enemy is near the edge, dodge randomly.
    const bot = () => {
      const input = emptyInput();
      let best = null;
      let bd = 99;
      for (const c of b.characters) {
        if (c.team !== 'enemy' || !c.alive) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best) {
        const dx = best.x - p.x;
        const dz = best.z - p.z;
        const l = Math.hypot(dx, dz) || 1;
        if (bd > 1.6) input.move = { x: dx / l, z: dz / l };
        const edge = CONFIG.arena.half - Math.max(Math.abs(best.x), Math.abs(best.z));
        if (bd < 2.2) {
          if (edge < 3.5 && rngBot.chance(0.2)) input.pressed.heavyAttack = true;
          else if (rngBot.chance(0.35)) input.pressed.lightAttack = true;
        }
        if (rngBot.chance(0.01)) input.pressed.dodge = true;
      }
      // keep the bot alive: heal between waves so the soak exercises many waves
      if (p.hp < 40) p.hp = 100;
      // an immortal bot, so the soak exercises many waves: put it back if it is thrown off
      if (p.state === STATE.FALLING || p.state === STATE.KO) {
        p.x = 0; p.z = 0; p.y = 0; p.ky = 0; p.kx = p.kz = 0; p.setState(STATE.NEUTRAL);
        b.playerDownReported = false;
      }
      return input;
    };
    let wave = 1;
    for (let i = 0; i < 60 * 240; i++) {
      b.update(DT, bot());
      maxChars = Math.max(maxChars, b.characters.length);
      for (const c of b.characters) states.add(c.state);
      // between waves, just launch the next one (the Game class does this after the upgrade screen)
      if (b.waves.state === 'cleared') {
        wave++;
        b.beginWave(wave, 0.5);
      }
    }
    expect(cleared.length).toBeGreaterThanOrEqual(4);
    // no duplicates in the entity list
    expect(new Set(b.characters.map((c) => c.id)).size).toBe(b.characters.length);
    // no enemy permanently outside the roof without falling
    for (const c of b.characters) {
      if (c.state === STATE.NEUTRAL) {
        expect(Math.abs(c.x)).toBeLessThanOrEqual(CONFIG.arena.half);
        expect(Math.abs(c.z)).toBeLessThanOrEqual(CONFIG.arena.half);
      }
    }
    expect(maxChars).toBeLessThan(20);
    console.log('soak: waves cleared', cleared.length, 'score', b.score.score, 'ringOuts', b.score.ringOuts, 'states seen', [...states].join(','));
  });

  it('enemies never launch simultaneous unavoidable attacks (token spacing)', () => {
    const b = makeBattle(11);
    b.start();
    b.beginWave(6, 0.1);
    const starts = [];
    b.bus.on('swing', (e) => {
      if (!e.character.isPlayer) starts.push({ t: b.time, kind: e.attack.kind, who: e.character.id });
    });
    // passive player: stands still
    run(b, 40);
    expect(starts.length).toBeGreaterThan(2);
    let minGap = Infinity;
    for (let i = 1; i < starts.length; i++) minGap = Math.min(minGap, starts[i].t - starts[i - 1].t);
    expect(minGap).toBeGreaterThanOrEqual((CONFIG.ai.attackGap / 1.3) * 0.95);
  });
});
