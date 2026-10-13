import { KEY_BINDINGS } from '../config/controlsConfig.js';

const GAME_KEYS = new Set(Object.values(KEY_BINDINGS).flat());

/** Raw keyboard state -> semantic action values. No game logic here. */
export class KeyboardInput {
  constructor(target = window) {
    this.target = target;
    this.down = new Set();
    this.tapped = new Set(); // keys pressed since the last poll, so a tap shorter than a frame is not lost
    this.lastKeyAt = 0;
    this.enabled = true;
    this.onKey = null; // optional hook (e.g. to detect device switches)

    this._kd = (e) => {
      if (e.repeat) {
        if (GAME_KEYS.has(e.code) && this.enabled) e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (GAME_KEYS.has(e.code) && this.enabled) e.preventDefault();
      this.down.add(e.code);
      this.tapped.add(e.code);
      this.lastKeyAt = performance.now();
      this.onKey?.(e);
    };
    this._ku = (e) => {
      this.down.delete(e.code);
    };
    this._blur = () => {
      this.down.clear();
      this.tapped.clear();
    };
    target.addEventListener('keydown', this._kd);
    target.addEventListener('keyup', this._ku);
    window.addEventListener('blur', this._blur);
    document.addEventListener('visibilitychange', this._blur);
  }

  any(codes) {
    for (let i = 0; i < codes.length; i++) if (this.down.has(codes[i]) || this.tapped.has(codes[i])) return true;
    return false;
  }

  /** Call once per frame after reading; drops the tap memory. */
  endFrame() {
    this.tapped.clear();
  }

  /** Movement vector in arena space (x right, z toward the camera). Normalised diagonally. */
  getMove() {
    let x = 0;
    let z = 0;
    if (this.any(KEY_BINDINGS.moveLeft)) x -= 1;
    if (this.any(KEY_BINDINGS.moveRight)) x += 1;
    if (this.any(KEY_BINDINGS.moveUp)) z -= 1;
    if (this.any(KEY_BINDINGS.moveDown)) z += 1;
    const l = Math.hypot(x, z);
    if (l > 1) {
      x /= l;
      z /= l;
    }
    return { x, z };
  }

  /** action id -> 0/1 for every button-style action. */
  getActions(out = {}) {
    for (const action of Object.keys(KEY_BINDINGS)) {
      if (action.startsWith('move')) continue;
      out[action] = this.any(KEY_BINDINGS[action]) ? 1 : 0;
    }
    return out;
  }

  dispose() {
    this.target.removeEventListener('keydown', this._kd);
    this.target.removeEventListener('keyup', this._ku);
    window.removeEventListener('blur', this._blur);
    document.removeEventListener('visibilitychange', this._blur);
    this.down.clear();
  }
}
