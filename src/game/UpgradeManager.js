// Upgrades are data: each one mutates the player's `mods` table (see defaultMods).
// New upgrades only need an entry here - the wave manager and UI never change.
//
// apply(player, level) runs once per pick; `max` caps how many times it can stack.

export const UPGRADES = [
  {
    id: 'heavyHands',
    name: 'Heavy Hands',
    tag: 'POWER',
    desc: 'Heavy smash launches +22% farther and hits +15% harder.',
    max: 4,
    apply(p) {
      p.mods.heavyKnock *= 1.22;
      p.mods.heavyDamage *= 1.15;
    },
  },
  {
    id: 'quickFeet',
    name: 'Quick Feet',
    tag: 'SPEED',
    desc: 'Move 8% faster. Dodge recharges 18% sooner and costs 15% less stamina.',
    max: 4,
    apply(p) {
      p.mods.moveSpeed *= 1.08;
      p.mods.dodgeCooldown *= 0.82;
      p.mods.dodgeCost *= 0.85;
    },
  },
  {
    id: 'ironGuard',
    name: 'Iron Guard',
    tag: 'DEFENCE',
    desc: 'Blocking absorbs 25% more knockback and costs 30% less stamina. Perfect blocks refund more.',
    max: 3,
    apply(p) {
      p.mods.blockKnockback *= 0.75;
      p.mods.blockStamina *= 0.7;
      p.mods.perfectRefund *= 1.35;
    },
  },
  {
    id: 'steadyBreath',
    name: 'Steady Breath',
    tag: 'STAMINA',
    desc: 'Stamina recovers 28% faster, and light punches knock back 10% farther.',
    max: 3,
    apply(p) {
      p.mods.staminaRegen *= 1.28;
      p.mods.lightKnock *= 1.1;
    },
  },
  {
    id: 'secondWind',
    name: 'Second Wind',
    tag: 'RECOVERY',
    desc: 'Restore 30 health now and after every wave you clear.',
    max: 3,
    apply(p, level, state) {
      state.regenPerWave += 30;
      p.hp = Math.min(p.maxHp, p.hp + 30);
    },
  },
];

export class UpgradeManager {
  constructor(rng) {
    this.rng = rng;
    this.defs = UPGRADES;
    this.reset();
  }

  reset() {
    this.levels = {};
    this.state = { regenPerWave: 0 };
    this.history = [];
  }

  level(id) {
    return this.levels[id] || 0;
  }

  /** Three distinct options that are not maxed out. */
  roll(count = 3) {
    const pool = this.defs.filter((u) => this.level(u.id) < u.max);
    // Fisher-Yates over a copy so the pool never has duplicates.
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, count).map((u) => ({
      id: u.id,
      name: u.name,
      tag: u.tag,
      desc: u.desc,
      level: this.level(u.id) + 1,
      max: u.max,
    }));
  }

  pick(id, player) {
    const u = this.defs.find((d) => d.id === id);
    if (!u || this.level(id) >= u.max) return false;
    this.levels[id] = this.level(id) + 1;
    u.apply(player, this.levels[id], this.state);
    this.history.push(id);
    return true;
  }

  /** Called when a wave is cleared (Second Wind heals here). */
  onWaveClear(player) {
    if (this.state.regenPerWave > 0 && player.hp > 0) {
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + this.state.regenPerWave);
      return player.hp - before;
    }
    return 0;
  }

  /** Active upgrades for the HUD. */
  active() {
    return this.defs.filter((u) => this.level(u.id) > 0).map((u) => ({ id: u.id, name: u.name, tag: u.tag, level: this.level(u.id) }));
  }
}
