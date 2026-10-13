import { CONFIG } from '../config/gameConfig.js';
import { clamp } from '../util/math.js';

// Pure knockback maths so it can be unit tested and tuned without a renderer.
export const KnockbackSystem = {
  /** How much knockback a target absorbs: heavier / more resistant = less movement. */
  takenMultiplier(target) {
    return (1 - clamp(target.resist, 0, 0.9)) / Math.sqrt(Math.max(0.2, target.mass));
  },

  /** Lower health => further flight. */
  healthFactor(target, def) {
    const missing = 1 - clamp(target.hp / target.maxHp, 0, 1);
    return 1 + missing * (def.hpKnockScale ?? 0.4);
  },

  /**
   * Direction a hit sends the target: a blend of attacker->target and attacker facing,
   * so a swing sends people where it points, not just radially.
   */
  direction(attacker, target, def) {
    let rx = target.x - attacker.x;
    let rz = target.z - attacker.z;
    const rl = Math.hypot(rx, rz);
    if (rl > 1e-4) {
      rx /= rl;
      rz /= rl;
    } else {
      rx = attacker.forwardX;
      rz = attacker.forwardZ;
    }
    const w = def.kind === 'heavy' ? 0.62 : 0.4;
    let dx = rx * (1 - w) + attacker.forwardX * w;
    let dz = rz * (1 - w) + attacker.forwardZ * w;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  },

  /**
   * Launch speed for a direct hit. `attackMult` carries attacker upgrades.
   */
  speed(attacker, target, def, { attackMult = 1, extra = 1 } = {}) {
    let s = def.knockback * attackMult * this.takenMultiplier(target) * this.healthFactor(target, def) * extra;
    if (target.state === 'stagger') s *= target.dazed ? CONFIG.stagger.dazeKnock : CONFIG.stagger.vulnerableKnock;
    if (attacker.counterWindow > 0) s *= 1.2;
    return s;
  },

  /** Vertical launch (0 = stays grounded). Heavier targets pop less. */
  pop(target, def, extra = 1) {
    if (!def.pop) return 0;
    return def.pop * Math.sqrt(this.takenMultiplier(target)) * extra;
  },

  /**
   * Distance a grounded target travels from launch speed `v0` (integrates the same
   * damping the Character uses). Handy for tuning and tests.
   */
  slideDistance(v0, dt = 1 / 240) {
    const P = CONFIG.physics;
    let v = v0;
    let d = 0;
    for (let i = 0; i < 4000 && v > 0; i++) {
      d += v * dt;
      v = Math.max(0, v * Math.exp(-P.groundDamp * dt) - P.groundBrake * dt);
      if (v < P.stopSpeed) break;
    }
    return d;
  },
};
