import { CONFIG } from '../config/gameConfig.js';
import { STATE } from '../entities/Character.js';

// Character-vs-character circle collisions. Fast flying bodies shove whoever they hit
// ("bowling"), which is the secondary way to score ring-outs.
export class CollisionSystem {
  constructor(battle) {
    this.battle = battle;
  }

  #solid(c) {
    return (
      c.y < 0.7 &&
      c.state !== STATE.SPAWN &&
      c.state !== STATE.FALLING &&
      c.state !== STATE.ELIMINATED &&
      c.state !== STATE.AIRBORNE
    );
  }

  update() {
    const chars = this.battle.characters;
    const P = CONFIG.physics;
    for (let i = 0; i < chars.length; i++) {
      const a = chars[i];
      if (!this.#solid(a)) continue;
      for (let j = i + 1; j < chars.length; j++) {
        const b = chars[j];
        if (!this.#solid(b)) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 1e-4;
        const nx = d2 > 1e-8 ? dx / d : 1;
        const nz = d2 > 1e-8 ? dz / d : 0;
        const overlap = (min - d) * P.separationStrength;
        const ia = 1 / a.mass;
        const ib = 1 / b.mass;
        const wa = ia / (ia + ib);
        const wb = ib / (ia + ib);
        // A dodging character slips through: dodging is the deliberate escape / gap-closer.
        if (a.state !== STATE.DODGE && b.state !== STATE.DODGE) {
          a.x -= nx * overlap * wa;
          a.z -= nz * overlap * wa;
          b.x += nx * overlap * wb;
          b.z += nz * overlap * wb;
        }
        this.#bump(a, b, nx, nz);
        this.#bump(b, a, -nx, -nz);
      }
    }
  }

  #bump(src, dst, nx, nz) {
    const P = CONFIG.physics;
    if (src.bumpCd > 0 || dst.bumpCd > 0) return;
    const ks = src.knockSpeed;
    if (ks < P.bumpMinSpeed || !src.knocked) return;
    // must be travelling toward dst
    const along = (src.kx * nx + src.kz * nz) / ks;
    if (along < 0.45) return;
    const transfer = ks * P.bumpTransfer * ((src.mass / (src.mass + dst.mass)) * 2) * (1 / Math.sqrt(dst.mass));
    const dstSpeed = Math.min(transfer, ks * 0.9);
    dst.addKnock(nx, nz, Math.max(dst.knockSpeed, dstSpeed));
    src.kx *= P.bumpRetain;
    src.kz *= P.bumpRetain;
    src.bumpCd = P.bumpCooldown;
    dst.bumpCd = P.bumpCooldown;
    dst.lastHitBy = src.lastHitBy || src;
    dst.lastHitTime = this.battle.time;
    dst.lastBumpBy = src;
    dst.hp = Math.max(0, dst.hp - P.bumpDamage);
    if (dst.state === STATE.NEUTRAL || dst.state === STATE.ATTACK || dst.state === STATE.DODGE) dst.enterHitstun(0.3);
    else if (dst.state === STATE.HITSTUN) dst.stateTime = 0;
    dst.hitFlash = 0.12;
    this.battle.bus.emit('bump', { source: src, target: dst, speed: dstSpeed, x: (src.x + dst.x) / 2, z: (src.z + dst.z) / 2, y: 1 });
    this.battle.bus.emit('hitstop', 0.05);
    if (dst.isPlayer && dst.hp <= 0) this.battle.playerDown('hp');
  }
}
