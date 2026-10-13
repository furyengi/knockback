import { BUTTON_ACTIONS } from '../config/controlsConfig.js';
import { readAction, readStick, applyRadialDeadZone } from './ControlBindings.js';

/**
 * Browser Gamepad API wrapper. It discovers controllers, picks the one you are using,
 * and converts its raw buttons/axes into semantic action values through ControlBindings.
 * It never assumes a layout: unknown mappings produce no actions until the player has
 * configured them (see ControlBindings.resolve).
 */
export class GamepadInput {
  /**
   * @param {ControlBindings} bindings
   * @param {{ getPads?: () => any[], target?: EventTarget }} [opts] injection points for tests
   */
  constructor(bindings, opts = {}) {
    this.bindings = bindings;
    this.getPads = opts.getPads || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads() || []) : []));
    this.target = opts.target || (typeof window !== 'undefined' ? window : null);
    this.pads = []; // sanitized list of connected snapshots (no nulls)
    this.activeIndex = -1;
    this.pad = null; // snapshot of the active pad
    this.lastSeenIds = new Set();
    this.listeners = new Set(); // connection events
    this.capture = null;
    this.activity = 0; // 0..1 how hard the player is using the pad this frame
    this.wasConnected = false;
    this.lastUsed = new Map(); // index -> timestamp
    this.prevAxes = new Map(); // index -> axes last frame
    this.rest = { axes: [] };

    this._conn = (e) => this.#notify('connected', e.gamepad);
    this._disc = (e) => {
      this.#notify('disconnected', e.gamepad);
      if (e.gamepad && e.gamepad.index === this.activeIndex) {
        this.activeIndex = -1;
        this.pad = null;
      }
    };
    if (this.target) {
      this.target.addEventListener('gamepadconnected', this._conn);
      this.target.addEventListener('gamepaddisconnected', this._disc);
    }
  }

  onConnection(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  #notify(type, pad) {
    for (const fn of this.listeners) fn(type, pad);
  }

  get connected() {
    return !!this.pad;
  }

  get info() {
    const p = this.pad;
    if (!p) return { connected: false, id: '', mapping: '', index: -1, count: this.pads.length, configured: false, standard: false, buttons: 0, axes: 0 };
    const r = this.bindings.resolve(p);
    return {
      connected: true,
      id: p.id,
      mapping: p.mapping || 'unknown',
      index: p.index,
      count: this.pads.length,
      configured: r.configured,
      custom: r.custom,
      standard: r.standard,
      buttons: p.buttons?.length || 0,
      axes: p.axes?.length || 0,
    };
  }

  /** Re-read the browser's gamepad list. Call once per frame (before using state). */
  refresh(now = performance.now()) {
    const raw = this.getPads() || [];
    this.pads = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (p && p.connected !== false) this.pads.push(p);
    }
    if (!this.pads.length) {
      this.activeIndex = -1;
      this.pad = null;
      return;
    }
    // Track activity per pad so the one in your hands wins when several are plugged in.
    let best = null;
    let bestT = -1;
    for (const p of this.pads) {
      if (this.#isActive(p)) this.lastUsed.set(p.index, now);
      const t = this.lastUsed.get(p.index) ?? -1;
      if (t > bestT) {
        bestT = t;
        best = p;
      }
    }
    if (!best) best = this.pads.find((p) => p.index === this.activeIndex) || this.pads[0];
    this.activeIndex = best.index;
    this.pad = best;
  }

  /**
   * Is the player touching this pad right now? Judged by changes (a pressed button, or an axis that
   * moved since last frame) so pads whose idle axes rest at -1 or 1 are not mistaken for "in use".
   */
  #isActive(p) {
    let prev = this.prevAxes.get(p.index);
    if (!prev || prev.length !== p.axes.length) {
      prev = Array.from(p.axes);
      this.prevAxes.set(p.index, prev);
    }
    let active = false;
    for (let i = 0; i < p.buttons.length; i++) {
      const b = p.buttons[i];
      if (b && (b.pressed || b.value > 0.5)) active = true;
    }
    for (let i = 0; i < p.axes.length; i++) {
      const v = p.axes[i];
      if (Math.abs(v - prev[i]) > 0.25 && Math.abs(v) <= 1.3) active = true;
      prev[i] = v;
    }
    return active;
  }

  /**
   * Current action values for the active pad.
   * @returns {{ connected:boolean, actions:Object, move:{x:number,z:number,mag:number}, rawStick:{x:number,y:number} }}
   */
  read(out = null) {
    const res = out || { connected: false, actions: {}, move: { x: 0, z: 0, mag: 0 }, rawStick: { x: 0, y: 0 }, configured: false };
    res.connected = !!this.pad;
    res.move.x = res.move.z = res.move.mag = 0;
    res.rawStick.x = res.rawStick.y = 0;
    for (const a of BUTTON_ACTIONS) res.actions[a] = 0;
    res.configured = false;
    this.activity = 0;
    const pad = this.pad;
    if (!pad || this.capture) return res; // while capturing a binding the pad does not drive the game
    const r = this.bindings.resolve(pad);
    res.configured = r.configured;
    for (const a of BUTTON_ACTIONS) res.actions[a] = readAction(r.bindings[a], pad);
    if (r.bindings.move) {
      const raw = readStick(r.bindings.move, pad);
      res.rawStick.x = raw.x;
      res.rawStick.y = raw.y;
      const dz = applyRadialDeadZone(raw.x, raw.y, this.bindings.deadZone);
      res.move.x = dz.x; // stick right -> +x
      res.move.z = dz.y; // stick down (+y) -> +z (toward the camera)
      res.move.mag = dz.mag;
    }
    let act = res.move.mag;
    for (const a of BUTTON_ACTIONS) act = Math.max(act, res.actions[a]);
    this.activity = act;
    return res;
  }

  /** True on the frame a never-configured pad has any button pressed (to offer setup). */
  rawAnyButton() {
    const p = this.pad;
    if (!p) return false;
    for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i]?.pressed) return true;
    return false;
  }

  // ---- raw snapshot for diagnostics / setup UI -------------------------------

  snapshot() {
    const p = this.pad;
    if (!p) return null;
    const buttons = [];
    for (let i = 0; i < p.buttons.length; i++) {
      const b = p.buttons[i];
      buttons.push({ pressed: !!b?.pressed, value: typeof b?.value === 'number' ? b.value : b?.pressed ? 1 : 0 });
    }
    return { id: p.id, index: p.index, mapping: p.mapping || '', buttons, axes: Array.from(p.axes), timestamp: p.timestamp };
  }

  // ---- binding capture ----------------------------------------------------------

  /**
   * Listen for the next input from the active pad.
   * mode: 'button' (button/trigger/axis/hat) | 'axis' (single stick axis, with direction)
   * Resolves `onCapture(binding)` or `onCancel(reason)`.
   */
  startCapture({ mode = 'button', timeout = 8, onCapture, onCancel } = {}) {
    this.cancelCapture('replaced');
    const snap = this.snapshot();
    this.capture = {
      mode,
      timeLeft: timeout,
      onCapture,
      onCancel,
      armed: false, // wait until everything is released/neutral so the opening press is not captured
      baseAxes: snap ? snap.axes.slice() : [],
      settle: 0,
    };
  }

  cancelCapture(reason = 'cancelled') {
    const c = this.capture;
    this.capture = null;
    if (c?.onCancel) c.onCancel(reason);
  }

  get capturing() {
    return !!this.capture;
  }

  /** Advance a pending capture. Call once per frame after refresh(). */
  updateCapture(dt) {
    const c = this.capture;
    if (!c) return;
    const snap = this.snapshot();
    if (!snap) {
      this.cancelCapture('disconnected');
      return;
    }
    c.timeLeft -= dt;
    if (c.timeLeft <= 0) {
      this.cancelCapture('timeout');
      return;
    }
    if (!c.armed) {
      const anyDown = snap.buttons.some((b) => b.pressed || b.value > 0.5);
      if (!anyDown) {
        c.settle += dt;
        if (c.settle > 0.15) {
          c.armed = true;
          c.baseAxes = snap.axes.slice(); // resting values (some triggers rest at -1)
        }
      } else c.settle = 0;
      return;
    }

    if (c.mode === 'button' || c.mode === 'stick') {
      for (let i = 0; i < snap.buttons.length; i++) {
        const b = snap.buttons[i];
        if (b.pressed || b.value > 0.55) return this.#finish({ type: 'button', index: i });
      }
    }
    for (let i = 0; i < snap.axes.length; i++) {
      const rest = c.baseAxes[i] ?? 0;
      const v = snap.axes[i];
      // Hat switches report discrete values far from the normal -1..1 range at rest.
      if (rest > 1.2 && Math.abs(v - rest) > 0.3 && Math.abs(v) <= 1.3) {
        if (c.mode === 'button' || c.mode === 'stick') return this.#finish({ type: 'hat', index: i, value: v });
        continue;
      }
      const d = v - rest;
      if (Math.abs(d) > 0.65) {
        if (c.mode === 'axis' || c.mode === 'stick') return this.#finish({ type: 'axis', index: i, dir: d > 0 ? 1 : -1, rest: 0, raw: v });
        // axis used as a button (trigger-as-axis / digital pad on an axis)
        return this.#finish({ type: 'axis', index: i, dir: d > 0 ? 1 : -1, rest: Math.abs(rest) > 0.5 ? rest : 0 });
      }
    }
  }

  #finish(binding) {
    const c = this.capture;
    this.capture = null;
    c.onCapture?.(binding);
  }

  // ---- haptics ----------------------------------------------------------------------

  /** Feature-detected rumble. Silently does nothing where unsupported. */
  rumble(strong = 0.5, weak = 0.5, duration = 120) {
    if (!this.bindings.vibration) return;
    const p = this.pad;
    if (!p) return;
    try {
      const act = p.vibrationActuator;
      if (act && typeof act.playEffect === 'function') {
        const r = act.playEffect('dual-rumble', { startDelay: 0, duration, weakMagnitude: weak, strongMagnitude: strong });
        if (r && typeof r.catch === 'function') r.catch(() => {});
        return;
      }
      const h = p.hapticActuators?.[0];
      if (h && typeof h.pulse === 'function') {
        const r = h.pulse(Math.max(strong, weak), duration);
        if (r && typeof r.catch === 'function') r.catch(() => {});
      }
    } catch {
      /* haptics are optional */
    }
  }

  get supportsRumble() {
    const p = this.pad;
    return !!(p && (p.vibrationActuator || p.hapticActuators?.length));
  }

  dispose() {
    if (this.target) {
      this.target.removeEventListener('gamepadconnected', this._conn);
      this.target.removeEventListener('gamepaddisconnected', this._disc);
    }
    this.listeners.clear();
    this.capture = null;
  }
}
