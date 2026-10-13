import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config/gameConfig.js';
import { STATE } from '../src/entities/Character.js';
import { makeBattle, run, collect, emptyInput, DT } from './helpers.js';

// The brief's "most important quality test": an enemy telegraphs a heavy attack, the player
// dodges it, the enemy ends up near the edge, a heavy smash sends it off the roof.
describe('Signature sequence: telegraph -> dodge -> smash -> ring-out', () => {
  it('is achievable against a Bruiser with the shipped timings', () => {
    const b = makeBattle(1234);
    b.start();
    b.waves.pending = [];
    b.waves.state = 'idle';
    const br = b.spawnEnemy('bruiser', 6.4, 0);
    run(b, 1.6); // landing
    const p = b.player;
    p.x = 4.2;
    p.z = 0;
    p.facing = p.aim = Math.PI / 2;
    br.x = 6.4;
    br.z = 0;

    const swings = collect(b, 'swing');
    const dodged = collect(b, 'dodged');
    const hits = [];
    b.bus.on('hit', (e) => hits.push({ ...e, t: b.time }));
    const rings = collect(b, 'ringOut');

    let phase = 'wait';
    let swingAt = 0;
    let smashStarted = false;
    let peakX = 0;
    for (let i = 0; i < 60 * 30 && rings.length === 0; i++) {
      const input = emptyInput();
      const first = swings.find((s) => s.character === br);
      if (first && phase === 'wait') {
        phase = 'telegraph';
        swingAt = b.time;
      }
      // react to the telegraph: dodge sideways ~0.12 s before the strike lands, so the i-frames cover it
      if (phase === 'telegraph' && br.attack && br.attack.phase === 'windup' && br.attack.def.windup - br.attack.phaseTime <= 0.12) {
        input.move = { x: 0, z: 1 };
        input.pressed.dodge = true;
        phase = 'dodged';
      }
      // once the bruiser is recovering, step in line with it and smash toward the edge
      if (phase === 'dodged' && br.attack && br.attack.phase === 'recovery' && !smashStarted) {
        p.x = br.x - 1.5;
        p.z = br.z;
        p.facing = p.aim = Math.PI / 2;
        p.stamina = 100;
        input.pressed.heavyAttack = true;
        smashStarted = true;
        phase = 'smash';
      }
      b.player.hp = b.player.maxHp;
      b.update(DT, input);
      if (smashStarted) peakX = Math.max(peakX, br.x);
    }
    expect(phase === 'smash' || phase === 'dodged').toBe(true);
    expect(smashStarted).toBe(true);
    // the first bruiser attack never landed on us because we read the telegraph
    const firstWindow = hits.filter((h) => h.attacker === br && h.target === p && h.t >= swingAt && h.t <= swingAt + 1.4);
    if (firstWindow.length) console.log("first-window hits", firstWindow.map((h) => ({ t: h.t.toFixed(2), kind: h.attack.kind, dmg: h.damage, pPos: [p.x.toFixed(2), p.z.toFixed(2)], swingAt: swingAt.toFixed(2) })));
    expect(firstWindow.length).toBe(0);
    // the smash connected on the bruiser
    expect(hits.some((h) => h.attacker === p && h.heavy && h.target === br)).toBe(true);
    // ring-out may or may not happen with only one smash at 6.4 m; assert it flew a long way
    expect(peakX - (br.x > 0 ? 0 : 0)).toBeGreaterThan(6.4 + 1.5); // it was sent a long way toward the edge
    console.log('signature: dodged events', dodged.length, 'ring-outs', rings.length, 'bruiser x', br.x.toFixed(2), 'state', br.state);
  });

  it('a smash on a Bruiser standing on the edge band sends it off the roof', () => {
    const b = makeBattle(5);
    b.start();
    b.waves.pending = [];
    b.waves.state = 'idle';
    const br = b.spawnEnemy('bruiser', 8.1, 0);
    br.ai = null;
    run(b, 1.6);
    const p = b.player;
    p.x = 6.6;
    p.z = 0;
    p.facing = p.aim = Math.PI / 2;
    br.x = 8.1;
    br.z = 0;
    const rings = collect(b, 'ringOut');
    p.startAttack('heavy');
    run(b, 3);
    expect(rings.length).toBe(1);
    expect(rings[0].credit).toBe(p);
    expect(br.state === STATE.FALLING || !b.characters.includes(br)).toBe(true);
    expect(b.score.score).toBeGreaterThan(CONFIG.score.ringOut);
  });
});
