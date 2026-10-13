import { angleDiff } from '../util/math.js';

// Cone-vs-circle test. The cone starts at the attacker centre and reaches
// `attacker.radius + def.range`; targets are circles so their radius extends reach
// and widens the accepted angle.
export const HitDetection = {
  inReach(attacker, target, def) {
    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const dist = Math.hypot(dx, dz);
    const reach = attacker.radius + def.range + target.radius;
    if (dist > reach) return false;
    if (dist < 1e-4) return true;
    const toTarget = Math.atan2(dx, dz);
    const diff = Math.abs(angleDiff(attacker.facing, toTarget));
    const slack = Math.asin(Math.min(1, target.radius / dist));
    return diff <= def.arc / 2 + slack;
  },

  /** Targets struck this step by an active attack, honouring the once-per-swing rule. */
  collect(attacker, candidates, out = []) {
    out.length = 0;
    const atk = attacker.attack;
    if (!atk) return out;
    for (let i = 0; i < candidates.length; i++) {
      const t = candidates[i];
      if (t === attacker || t.team === attacker.team) continue;
      if (!atk.canHit(t.id)) continue;
      if (!t.hittable) continue;
      if (!this.inReach(attacker, t, atk.def)) continue;
      out.push(t);
    }
    return out;
  },

  /** Is `from` inside the frontal block arc of `blocker`? */
  inBlockArc(blocker, from, arc) {
    const dx = from.x - blocker.x;
    const dz = from.z - blocker.z;
    if (dx * dx + dz * dz < 1e-6) return true;
    const diff = Math.abs(angleDiff(blocker.facing, Math.atan2(dx, dz)));
    return diff <= arc / 2;
  },
};
