import { BUTTON_ACTIONS, INPUT_DEFAULTS, KEY_LABELS } from '../config/controlsConfig.js';
import { ControlBindings } from './ControlBindings.js';
import { GamepadInput } from './GamepadInput.js';
import { KeyboardInput } from './KeyboardInput.js';
import { EdgeTracker, NavRepeater } from './InputUtils.js';

/**
 * Merges keyboard and gamepad into one semantic frame per render frame:
 *
 *   frame.move     {x, z, mag}  arena-space movement, dead-zoned and length-limited to 1
 *   frame.held     action -> boolean
 *   frame.value    action -> analog 0..1 (triggers)
 *   frame.pressed  action -> true only on the frame the button went down
 *   frame.released action -> true only on the frame it went up
 *   frame.nav      {x, y}  menu navigation steps (-1/0/1), auto-repeating
 *   frame.device   'keyboard' | 'gamepad'
 *
 * Game systems never see device button indices.
 */
export class InputManager {
  constructor({ bindings, keyboard, gamepad, target } = {}) {
    this.bindings = bindings || new ControlBindings();
    this.keyboard = keyboard || new KeyboardInput(target || window);
    this.gamepad = gamepad || new GamepadInput(this.bindings);
    this.edges = new EdgeTracker();
    this.nav = new NavRepeater();
    this.device = 'keyboard';
    this.deviceListeners = new Set();
    this._gp = null;
    this._kb = {};
    this._values = {};
    this.suspended = false; // true while binding capture owns the pad
    this.frame = {
      move: { x: 0, z: 0, mag: 0 },
      held: this.edges.held,
      value: this.edges.value,
      pressed: this.edges.pressed,
      released: this.edges.released,
      nav: { x: 0, y: 0 },
      device: 'keyboard',
      gamepadConnected: false,
      padNeedsSetup: false,
      padAnyButton: false,
    };
    this.keyboard.onKey = () => this.#setDevice('keyboard');
    // The active device switches to the gamepad only when its (configured) inputs are actually used.
  }

  onDeviceChange(fn) {
    this.deviceListeners.add(fn);
    return () => this.deviceListeners.delete(fn);
  }

  #setDevice(d) {
    if (this.device === d) return;
    this.device = d;
    for (const fn of this.deviceListeners) fn(d);
  }

  /** Sample all devices and build this frame's semantic input. */
  poll(dt) {
    const gpi = this.gamepad;
    gpi.refresh();
    gpi.updateCapture(dt);
    const gp = (this._gp = gpi.read(this._gp));
    const kb = this.keyboard.getActions(this._kb);

    const values = this._values;
    for (const a of BUTTON_ACTIONS) values[a] = Math.max(kb[a] || 0, gp.actions[a] || 0);
    this.edges.update(values);

    // movement
    const km = this.keyboard.getMove();
    this.keyboard.endFrame();
    let mx = km.x;
    let mz = km.z;
    if (gp.move.mag > 0) {
      mx += gp.move.x;
      mz += gp.move.z;
    }
    else {
      // D-pad doubles as digital movement (useful when a pad's sticks are off or in digital mode)
      const dx = (gp.actions.navRight > 0.5 ? 1 : 0) - (gp.actions.navLeft > 0.5 ? 1 : 0);
      const dz = (gp.actions.navDown > 0.5 ? 1 : 0) - (gp.actions.navUp > 0.5 ? 1 : 0);
      mx += dx;
      mz += dz;
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }

    // menu navigation: D-pad / keys, or the stick when pushed hard
    const h = this.edges.held;
    let nx = (h.navRight ? 1 : 0) - (h.navLeft ? 1 : 0);
    let ny = (h.navDown ? 1 : 0) - (h.navUp ? 1 : 0);
    if (nx === 0 && ny === 0 && gp.move.mag > INPUT_DEFAULTS.navThreshold) {
      if (Math.abs(gp.move.x) > Math.abs(gp.move.z)) nx = Math.sign(gp.move.x);
      else ny = Math.sign(gp.move.z);
    }
    const nav = this.nav.update(nx, ny, dt);

    // active device: whoever produced input most recently
    if (gpi.activity > 0.5) this.#setDevice('gamepad');

    const f = this.frame;
    f.move.x = mx;
    f.move.z = mz;
    f.move.mag = Math.min(1, len);
    f.held = this.edges.held;
    f.value = this.edges.value;
    f.pressed = this.edges.pressed;
    f.released = this.edges.released;
    f.nav.x = nav.x;
    f.nav.y = nav.y;
    f.device = this.device;
    f.gamepadConnected = gp.connected;
    f.padNeedsSetup = gp.connected && !gp.configured;
    f.padAnyButton = gp.connected && gpi.rawAnyButton();
    return f;
  }

  /** Treat everything currently held as already handled (call when switching screens). */
  flush() {
    this.edges.pressed = {};
    this.edges.released = {};
    this.frame.pressed = this.edges.pressed;
    this.frame.released = this.edges.released;
    this.nav.reset();
  }

  /** On-screen label for an action on the device currently in use. */
  prompt(action) {
    if (this.device === 'gamepad' && this.gamepad.connected && this.gamepad.info.configured) {
      if (action === 'move') return 'L-Stick';
      return this.bindings.promptLabel(this.gamepad.pad, action);
    }
    return KEY_LABELS[action] || '?';
  }

  dispose() {
    this.keyboard.dispose();
    this.gamepad.dispose();
    this.deviceListeners.clear();
  }
}
