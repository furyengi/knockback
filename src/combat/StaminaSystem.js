import { CONFIG } from '../config/gameConfig.js';

// Stamina rules as pure functions over a character-like object
// { stamina, maxStamina, staminaDelay, staminaRegen, mods }.
export const StaminaSystem = {
  canAfford(c, cost) {
    return cost <= 0 || c.stamina >= cost - 1e-6;
  },
  spend(c, cost) {
    if (cost <= 0) return true;
    if (!this.canAfford(c, cost)) return false;
    c.stamina = Math.max(0, c.stamina - cost);
    c.staminaDelay = c.staminaRegenDelay;
    return true;
  },
  /** Drain without requiring affordability (blocked hits). Returns true if stamina hit zero. */
  drain(c, amount) {
    c.stamina = Math.max(0, c.stamina - amount);
    c.staminaDelay = c.staminaRegenDelay;
    return c.stamina <= 0;
  },
  refund(c, amount) {
    c.stamina = Math.min(c.maxStamina, c.stamina + amount);
  },
  regen(c, dt, rateScale = 1) {
    if (c.maxStamina <= 0) return;
    if (c.staminaDelay > 0) {
      c.staminaDelay -= dt;
      return;
    }
    c.stamina = Math.min(c.maxStamina, c.stamina + c.staminaRegen * c.mods.staminaRegen * rateScale * dt);
  },
};

export const DEFAULT_REGEN_DELAY = CONFIG.player.staminaRegenDelay;
