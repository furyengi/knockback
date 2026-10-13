import { INPUT_DEFAULTS } from '../config/controlsConfig.js';

/**
 * Turns "held" booleans/analog values into press and release edges so that one physical
 * press produces exactly one `pressed` frame, however long the button is held.
 * Analog values use hysteresis so triggers do not flicker around the threshold.
 */
export class EdgeTracker {
  constructor({ press = INPUT_DEFAULTS.pressThreshold, release = INPUT_DEFAULTS.releaseThreshold } = {}) {
    this.press = press;
    this.release = release;
    this.held = {};
    this.pressed = {};
    this.released = {};
    this.value = {};
  }

  /** @param values map action -> analog 0..1 (or boolean) */
  update(values) {
    const keys = new Set([...Object.keys(values), ...Object.keys(this.held)]);
    this.pressed = {};
    this.released = {};
    for (const k of keys) {
      const raw = values[k];
      const v = raw === true ? 1 : raw === false || raw == null ? 0 : raw;
      const was = !!this.held[k];
      const now = was ? v >= this.release : v >= this.press;
      this.value[k] = v;
      this.held[k] = now;
      if (now && !was) this.pressed[k] = true;
      if (!now && was) this.released[k] = true;
    }
    return this;
  }

  reset() {
    this.held = {};
    this.pressed = {};
    this.released = {};
    this.value = {};
  }
}

/** Menu navigation: fires on direction change, then auto-repeats while held. */
export class NavRepeater {
  constructor({ delay = INPUT_DEFAULTS.navRepeatDelay, rate = INPUT_DEFAULTS.navRepeatRate } = {}) {
    this.delay = delay;
    this.rate = rate;
    this.dirX = 0;
    this.dirY = 0;
    this.timer = 0;
    this.repeating = false;
  }

  /** @returns {{x:number,y:number}} -1/0/1 for the frames on which navigation fires */
  update(dx, dy, dt) {
    // one axis at a time, the dominant one wins
    let x = 0;
    let y = 0;
    if (Math.abs(dx) > Math.abs(dy)) x = Math.sign(dx);
    else if (dy !== 0) y = Math.sign(dy);
    else if (dx !== 0) x = Math.sign(dx);
    if (x === 0 && y === 0) {
      this.dirX = this.dirY = 0;
      this.timer = 0;
      this.repeating = false;
      return { x: 0, y: 0 };
    }
    if (x !== this.dirX || y !== this.dirY) {
      this.dirX = x;
      this.dirY = y;
      this.timer = this.delay;
      this.repeating = false;
      return { x, y };
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer += this.rate;
      this.repeating = true;
      return { x, y };
    }
    return { x: 0, y: 0 };
  }

  reset() {
    this.dirX = this.dirY = 0;
    this.timer = 0;
    this.repeating = false;
  }
}
