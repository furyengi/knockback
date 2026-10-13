import { CONFIG } from '../config/gameConfig.js';
import { angleOf, angleDiff, turnToward } from '../util/math.js';

// Translates semantic input frames into Character actions, with input buffering
// and a light aim assist toward nearby enemies.
export class PlayerController {
  constructor(player, battle) {
    this.player = player;
    this.battle = battle;
    this.buffered = null; // 'lightAttack' | 'heavyAttack' | 'dodge'
    this.bufferTime = 0;
  }

  update(dt, input) {
    const p = this.player;
    if (!input) input = { move: { x: 0, z: 0 }, held: {}, pressed: {} };
    this.bufferTime -= dt;
    if (this.bufferTime <= 0) this.buffered = null;
    if (!p.alive) {
      p.setMove(0, 0);
      return;
    }

    const mv = input.move;
    p.setMove(mv.x, mv.z, 1);
    const moving = Math.abs(mv.x) + Math.abs(mv.z) > 0.01;

    p.setBlock(!!input.held.block);
    if (p.blocking) {
      const t = this.#nearestEnemy(7, Math.PI);
      if (t) p.faceToward(t.x, t.z);
    } else if (moving) {
      p.aim = angleOf(mv.x, mv.z);
    }

    const pr = input.pressed;
    if (pr.dodge) this.#tryAction('dodge', input);
    if (pr.heavyAttack) this.#tryAction('heavyAttack', input);
    if (pr.lightAttack) this.#tryAction('lightAttack', input);

    if (this.buffered && (p.canAct || (this.buffered === 'dodge' && p.dodgeCancelable))) this.#tryAction(this.buffered, input, true);
  }

  #tryAction(action, input, fromBuffer = false) {
    const p = this.player;
    let result;
    if (action === 'dodge') {
      const free = p.canAct || p.dodgeCancelable;
      result = p.startDodge(input.move.x, input.move.z) ? 'ok' : free ? (p.dodgeCd > 0 ? 'cooldown' : 'stamina') : 'busy';
      if (result === 'ok') this.battle.bus.emit('dodge', { character: p });
    } else {
      const kind = action === 'heavyAttack' ? 'heavy' : 'light';
      if (p.canAct) this.#prepareAim(input);
      result = p.startAttack(kind);
      if (result === 'ok') {
        this.battle.bus.emit('swing', { character: p, attack: p.attack });
      }
    }
    if (result === 'ok') {
      this.buffered = null;
    } else if (result === 'busy' && !fromBuffer) {
      this.buffered = action;
      this.bufferTime = CONFIG.player.inputBuffer;
    } else if (result === 'stamina') {
      this.buffered = null;
      this.battle.bus.emit('staminaFail', { character: p });
    } else if (result === 'cooldown') {
      this.buffered = fromBuffer ? null : action;
      this.bufferTime = fromBuffer ? 0 : CONFIG.player.inputBuffer;
    }
  }

  /** Point the swing along the stick, then magnetise toward a nearby enemy. */
  #prepareAim(input) {
    const p = this.player;
    const mv = input.move;
    if (Math.abs(mv.x) + Math.abs(mv.z) > 0.3) p.aim = angleOf(mv.x, mv.z);
    else p.aim = p.facing;
    const t = this.#nearestEnemy(CONFIG.player.aimAssistRange, CONFIG.player.aimAssistArc, p.aim);
    if (t) p.faceToward(t.x, t.z);
    p.facing = turnToward(p.facing, p.aim, Math.PI); // snap: windups are too short to rotate in
  }

  #nearestEnemy(range, arc, aim = this.player.facing) {
    const p = this.player;
    let best = null;
    let bestD = Infinity;
    for (const c of this.battle.characters) {
      if (c.team !== 'enemy' || !c.hittable) continue;
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      const d = Math.hypot(dx, dz) - c.radius;
      if (d > range) continue;
      if (arc < Math.PI && Math.abs(angleDiff(aim, angleOf(dx, dz))) > arc) continue;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}
