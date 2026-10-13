// All tunable gameplay numbers live here. Units: metres, seconds, radians.
// Coordinate system: Y up, ground plane = XZ. A character's facing angle `a`
// points along (sin a, cos a). The camera sits on the +Z side looking toward -Z,
// so "up" on a stick / W key is -Z.

const deg = (d) => (d * Math.PI) / 180;

export const CONFIG = {
  sim: {
    step: 1 / 60, // fixed simulation timestep
    maxFrame: 0.1, // clamp huge frame gaps (tab switches, breakpoints)
    maxSteps: 6,
  },

  arena: {
    half: 9, // playable square is [-half, half] on X and Z
    walkInset: 0.35, // walking/dodging characters are clamped this far inside the edge
    killY: -22, // anything below is removed
    gravity: 30,
  },

  physics: {
    // Knockback velocity decays exponentially plus a small constant braking.
    groundDamp: 5.4,
    groundBrake: 3.0,
    airDamp: 0.9,
    stopSpeed: 0.25,
    // Characters thrown into other characters transfer momentum ("bowling").
    bumpMinSpeed: 6.5,
    bumpTransfer: 0.55,
    bumpRetain: 0.55,
    bumpDamage: 6,
    bumpCooldown: 0.35,
    separationStrength: 1.0,
  },

  hitstop: { light: 0.045, heavy: 0.1, block: 0.05, perfectBlock: 0.11, ringOut: 0.12 },

  // Generic move definitions. Player uses these directly; enemies override fields.
  attacks: {
    light: {
      kind: 'light',
      windup: 0.085,
      active: 0.075,
      recovery: 0.17,
      staminaCost: 8,
      damage: 7,
      knockback: 10.5,
      pop: 0,
      hitstun: 0.3,
      staminaDamage: 10,
      range: 1.55,
      arc: deg(110),
      lunge: 3.4, // forward speed during windup+active
      armor: false,
      hpKnockScale: 0.45,
      hitstop: 'light',
      chainWindow: 0.38,
    },
    heavy: {
      kind: 'heavy',
      windup: 0.4,
      active: 0.11,
      recovery: 0.5,
      staminaCost: 28,
      damage: 22,
      knockback: 19,
      pop: 4.4,
      hitstun: 0.55,
      staminaDamage: 32,
      range: 2.05,
      arc: deg(140),
      lunge: 4.2,
      armor: false,
      hpKnockScale: 0.45,
      hitstop: 'heavy',
      chainWindow: 0,
    },
  },
  // 3rd hit of the light string
  lightFinisher: { damage: 1.25, knockback: 1.45, recovery: 1.35, hitstun: 1.2, range: 1.1 },

  player: {
    maxHp: 100,
    maxStamina: 100,
    radius: 0.52,
    mass: 1,
    knockbackResist: 0,
    moveSpeed: 6.4,
    accel: 55,
    decel: 46,
    turnRate: 16,
    staminaRegen: 26,
    staminaRegenDelay: 0.55,
    aimAssistRange: 3.4,
    aimAssistArc: deg(65),
    inputBuffer: 0.16,
    attackMoveFactor: 0.12, // movement speed multiplier while swinging
    blockMoveFactor: 0.45,
  },

  dodge: {
    duration: 0.24,
    speed: 17.5,
    invuln: 0.15,
    recovery: 0.1,
    cooldown: 0.65,
    staminaCost: 20,
    staminaRefundOnPerfect: 12,
  },

  block: {
    arc: deg(150), // total frontal arc that can block
    perfectWindow: 0.17,
    raiseLock: 0.28, // after releasing block you can't re-raise instantly
    damageTaken: 0.25,
    knockbackTaken: 0.3,
    guardBreakStun: 0.95,
    perfectStagger: 1.15,
    perfectStaminaRefund: 18,
  },

  stagger: {
    vulnerableKnock: 1.3, // staggered targets are launched further
    dazeDuration: 2.0,
    dazeKnock: 1.45,
    dazeRecoverHp: 0.4,
  },

  combo: { window: 2.6, stepEvery: 3, stepSize: 0.25, maxMultiplier: 3 },

  score: {
    lightHit: 5,
    heavyHit: 12,
    ringOut: 100,
    ringOutByType: { runner: 1, guard: 1.5, bruiser: 2 },
    bowlingBonus: 60,
    perfectBlock: 40,
    perfectDodge: 25,
    waveClear: 150,
    waveClearPerWave: 50,
    flawlessBonus: 120,
  },

  enemies: {
    runner: {
      name: 'Runner',
      radius: 0.46,
      mass: 0.8,
      knockbackResist: 0,
      maxHp: 34,
      maxStamina: 0,
      moveSpeed: 5.3,
      accel: 40,
      turnRate: 12,
      scale: 0.92,
      score: 1,
      attacks: {
        light: { windup: 0.28, active: 0.09, recovery: 0.55, damage: 6, knockback: 9, range: 1.45, lunge: 7, staminaCost: 0, hitstun: 0.26 },
      },
    },
    guard: {
      name: 'Guard',
      radius: 0.6,
      mass: 1.5,
      knockbackResist: 0.1,
      maxHp: 62,
      maxStamina: 46,
      staminaRegen: 9,
      moveSpeed: 3.1,
      accel: 30,
      turnRate: 3.4, // slow turning lets you flank
      scale: 1.05,
      score: 1.6,
      attacks: {
        light: { windup: 0.38, active: 0.1, recovery: 0.5, damage: 7, knockback: 9, range: 1.55, lunge: 3, staminaCost: 0 },
        heavy: { windup: 0.62, active: 0.12, recovery: 0.9, damage: 14, knockback: 14, pop: 2.6, range: 1.8, lunge: 4.5, staminaCost: 0, hitstun: 0.45 },
      },
    },
    bruiser: {
      name: 'Bruiser',
      radius: 0.82,
      mass: 2.4,
      knockbackResist: 0.28,
      maxHp: 96,
      maxStamina: 0,
      moveSpeed: 2.5,
      accel: 20,
      turnRate: 4.5,
      scale: 1.32,
      score: 2.2,
      attacks: {
        light: { windup: 0.4, active: 0.1, recovery: 0.55, damage: 8, knockback: 10, range: 1.9, lunge: 2.2, staminaCost: 0 },
        heavy: { windup: 0.95, active: 0.14, recovery: 0.95, damage: 24, knockback: 22, pop: 4.8, range: 2.5, arc: deg(150), lunge: 3.2, staminaCost: 0, armor: true, hitstun: 0.6, staminaDamage: 45 },
      },
    },
  },

  ai: {
    reactionMin: 0.15,
    reactionMax: 0.45,
    attackGap: 0.55, // min seconds between any two enemy attack starts
    tokensByWave: [
      [1, 1],
      [5, 2],
      [10, 3],
    ],
  },

  waves: {
    startDelay: 1.6,
    clearDelay: 1.5,
    maxAlive: 6,
    maxPerWave: 14,
    spawnInterval: 0.9,
    spawnWarning: 0.85,
    hpScalePerWave: 0.04,
    hpScaleCap: 1.8,
    aggressionPerWave: 0.05,
    aggressionCap: 1.7,
    // Hand-authored opening waves, then a budget formula.
    opening: [
      ['runner', 'runner', 'runner'],
      ['runner', 'runner', 'guard'],
      ['runner', 'guard', 'bruiser'],
      ['runner', 'runner', 'runner', 'guard'],
    ],
    costs: { runner: 1, guard: 1.6, bruiser: 2.3 },
    budgetBase: 3,
    budgetPerWave: 1.35,
  },

  camera: {
    fov: 30,
    // Direction from target to camera (normalised in code).
    dir: [0, 0.68, 0.74],
    target: [0, 0.2, 0.6],
    margin: { x: 0.93, top: 0.8, bottom: 0.8 },
    impulseDecay: 9,
  },
};

export function tokensForWave(wave) {
  let t = 1;
  for (const [fromWave, n] of CONFIG.ai.tokensByWave) if (wave >= fromWave) t = n;
  return t;
}
