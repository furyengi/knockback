import { Battle } from '../src/game/Battle.js';
import { Enemy } from '../src/entities/Enemy.js';

export const DT = 1 / 60;

export function emptyInput(over = {}) {
  return {
    move: { x: 0, z: 0 },
    held: {},
    pressed: {},
    ...over,
  };
}

export function makeBattle(seed = 1234) {
  const b = new Battle({ seed });
  b.reset();
  return b;
}

/** Step the battle for `seconds`, optionally with a function producing the input per step. */
export function run(b, seconds, inputFn = null) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) b.update(DT, inputFn ? inputFn(i) : emptyInput());
}

/** Place a passive dummy enemy (no AI) for combat tests. */
export function addDummy(b, type, x, z, opts = {}) {
  const e = new Enemy(type, x, z, opts);
  e.ai = null;
  e.facing = e.aim = Math.atan2(b.player.x - x, b.player.z - z);
  b.characters.push(e);
  return e;
}

export function collect(b, type) {
  const out = [];
  b.bus.on(type, (e) => out.push(e));
  return out;
}
