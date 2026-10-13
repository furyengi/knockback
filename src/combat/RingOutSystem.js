import { CONFIG } from '../config/gameConfig.js';
import { STATE } from '../entities/Character.js';

export const RING_OUT_CREDIT_WINDOW = 5; // seconds a last hit counts toward a ring-out

export const RingOutSystem = {
  /** True when the character's centre is beyond the playable square. */
  isOutside(c, half = CONFIG.arena.half) {
    return Math.abs(c.x) > half || Math.abs(c.z) > half;
  },

  /** Should this character begin falling this step? */
  shouldFall(c, half = CONFIG.arena.half) {
    if (c.state === STATE.FALLING || c.state === STATE.ELIMINATED || c.state === STATE.SPAWN) return false;
    if (!this.isOutside(c, half)) return false;
    // Under control and slow = clamped by Character; anything else is a ring-out.
    return c.knocked || c.state === STATE.KO || c.state === STATE.AIRBORNE;
  },

  /** Who gets credit for this ring-out (or null for a self-inflicted one). */
  creditFor(c, now) {
    const a = c.lastHitBy;
    if (!a || a.team === c.team) return null;
    return now - c.lastHitTime <= RING_OUT_CREDIT_WINDOW ? a : null;
  },
};
