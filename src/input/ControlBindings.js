import { BUTTON_ACTIONS, STANDARD_DEFAULTS, STANDARD_BUTTON_NAMES, INPUT_DEFAULTS } from '../config/controlsConfig.js';
import { Storage } from '../util/Storage.js';
import { clamp } from '../util/math.js';

export const BINDINGS_KEY = 'knockback.controls.v1';
const VERSION = 1;

// ---- pure helpers (unit tested) ---------------------------------------------

/** Stable per-model key so bindings survive reconnects and port changes. */
export function profileKey(id) {
  const s = String(id || 'unknown');
  const vp = /Vendor:\s*([0-9a-f]{4})\s+Product:\s*([0-9a-f]{4})/i.exec(s) || /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(s);
  if (vp) return `${vp[1].toLowerCase()}:${vp[2].toLowerCase()}`;
  return s.slice(0, 80);
}

/** Radial dead zone with rescaling, so slow stick movement still gives slow movement. */
export function applyRadialDeadZone(x, y, dz) {
  const mag = Math.hypot(x, y);
  if (mag <= dz || mag === 0) return { x: 0, y: 0, mag: 0 };
  const scaled = clamp((Math.min(mag, 1) - dz) / (1 - dz), 0, 1);
  return { x: (x / mag) * scaled, y: (y / mag) * scaled, mag: scaled };
}

const isInt = (n) => Number.isInteger(n) && n >= 0 && n < 64;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export function sanitizeSource(b) {
  if (!b || typeof b !== 'object') return null;
  if (b.type === 'button' && isInt(b.index)) return { type: 'button', index: b.index };
  if (b.type === 'axis' && isInt(b.index) && (b.dir === 1 || b.dir === -1)) {
    return { type: 'axis', index: b.index, dir: b.dir, rest: isNum(b.rest) ? clamp(b.rest, -1, 1) : 0 };
  }
  if (b.type === 'hat' && isInt(b.index) && isNum(b.value)) return { type: 'hat', index: b.index, value: b.value };
  return null;
}

export function sanitizeStick(b) {
  if (!b || b.type !== 'stick' || !isInt(b.xAxis) || !isInt(b.yAxis) || b.xAxis === b.yAxis) return null;
  return { type: 'stick', xAxis: b.xAxis, yAxis: b.yAxis, invertX: !!b.invertX, invertY: !!b.invertY };
}

export function sanitizeBindings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const stick = sanitizeStick(raw.move);
  if (stick) out.move = stick;
  for (const a of BUTTON_ACTIONS) {
    if (!Array.isArray(raw[a])) continue;
    const list = raw[a].map(sanitizeSource).filter(Boolean).slice(0, 4);
    if (list.length) out[a] = list;
  }
  return out;
}

/** Validate whatever came out of localStorage; anything wrong is dropped, never thrown. */
export function sanitizeStore(raw) {
  const out = { version: VERSION, deadZone: INPUT_DEFAULTS.deadZone, vibration: true, profiles: {} };
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return out;
  if (isNum(raw.deadZone)) out.deadZone = clamp(raw.deadZone, INPUT_DEFAULTS.deadZoneMin, INPUT_DEFAULTS.deadZoneMax);
  if (typeof raw.vibration === 'boolean') out.vibration = raw.vibration;
  if (raw.profiles && typeof raw.profiles === 'object') {
    for (const key of Object.keys(raw.profiles).slice(0, 20)) {
      const bindings = sanitizeBindings(raw.profiles[key]?.bindings);
      if (Object.keys(bindings).length) out.profiles[key] = { bindings };
    }
  }
  return out;
}

const btnValue = (b) => {
  if (b == null) return 0;
  if (typeof b === 'number') return b;
  const v = typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0;
  return b.pressed && v < 0.5 ? 1 : v;
};

/** Analog 0..1 value of one binding source on a gamepad snapshot. */
export function readSource(src, pad) {
  if (!pad) return 0;
  if (src.type === 'button') return clamp(btnValue(pad.buttons?.[src.index]), 0, 1);
  if (src.type === 'axis') {
    const v = pad.axes?.[src.index];
    if (typeof v !== 'number') return 0;
    const rest = src.rest || 0;
    const range = src.dir > 0 ? 1 - rest : rest + 1;
    if (range < 0.2) return 0;
    return clamp(((v - rest) * src.dir) / range, 0, 1);
  }
  if (src.type === 'hat') {
    const v = pad.axes?.[src.index];
    return typeof v === 'number' && Math.abs(v - src.value) < 0.12 ? 1 : 0;
  }
  return 0;
}

export function readAction(sources, pad) {
  let v = 0;
  if (!sources) return 0;
  for (let i = 0; i < sources.length; i++) v = Math.max(v, readSource(sources[i], pad));
  return v;
}

export function readStick(stick, pad) {
  if (!stick || !pad) return { x: 0, y: 0 };
  const x = pad.axes?.[stick.xAxis];
  const y = pad.axes?.[stick.yAxis];
  return {
    x: typeof x === 'number' ? (stick.invertX ? -x : x) : 0,
    y: typeof y === 'number' ? (stick.invertY ? -y : y) : 0,
  };
}

export function describeSource(src, mapping) {
  if (!src) return 'Unbound';
  if (src.type === 'button') {
    return mapping === 'standard' && STANDARD_BUTTON_NAMES[src.index] ? STANDARD_BUTTON_NAMES[src.index] : `Btn ${src.index}`;
  }
  if (src.type === 'axis') return `Axis ${src.index}${src.dir > 0 ? '+' : '−'}`;
  if (src.type === 'hat') return `Hat ${src.index}`;
  return '?';
}

const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- store -----------------------------------------------------------------

export class ControlBindings {
  constructor(storage = Storage) {
    this.storage = storage;
    this.listeners = new Set();
    this.data = sanitizeStore(null);
    this.load();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  #changed() {
    for (const fn of this.listeners) fn();
  }

  load() {
    this.data = sanitizeStore(this.storage.getJSON(BINDINGS_KEY, null));
  }

  save() {
    this.storage.setJSON(BINDINGS_KEY, this.data);
  }

  get deadZone() {
    return this.data.deadZone;
  }
  set deadZone(v) {
    this.data.deadZone = clamp(Number(v) || INPUT_DEFAULTS.deadZone, INPUT_DEFAULTS.deadZoneMin, INPUT_DEFAULTS.deadZoneMax);
    this.save();
    this.#changed();
  }
  get vibration() {
    return this.data.vibration;
  }
  set vibration(v) {
    this.data.vibration = !!v;
    this.save();
    this.#changed();
  }

  /**
   * Bindings in effect for a gamepad. Standard-mapping pads get the defaults; anything
   * else gets nothing until the player configures it (never a silent guess).
   */
  resolve(pad) {
    if (!pad) return { key: null, bindings: {}, configured: false, custom: false, standard: false };
    const key = profileKey(pad.id);
    const saved = this.data.profiles[key];
    const standard = pad.mapping === 'standard';
    if (saved) {
      // fill gaps from defaults only for standard pads
      const base = standard ? clone(STANDARD_DEFAULTS) : {};
      return { key, bindings: { ...base, ...clone(saved.bindings) }, configured: true, custom: true, standard };
    }
    if (standard) return { key, bindings: clone(STANDARD_DEFAULTS), configured: true, custom: false, standard };
    return { key, bindings: {}, configured: false, custom: false, standard };
  }

  #profile(pad) {
    const key = profileKey(pad.id);
    if (!this.data.profiles[key]) {
      const base = this.resolve(pad);
      this.data.profiles[key] = { bindings: clone(base.bindings) };
    }
    return this.data.profiles[key];
  }

  setSources(pad, action, sources) {
    if (!pad || !BUTTON_ACTIONS.includes(action)) return false;
    const list = (Array.isArray(sources) ? sources : [sources]).map(sanitizeSource).filter(Boolean);
    if (!list.length) return false;
    const prof = this.#profile(pad);
    prof.bindings[action] = list;
    this.save();
    this.#changed();
    return true;
  }

  setMove(pad, stick) {
    const s = sanitizeStick(stick);
    if (!pad || !s) return false;
    this.#profile(pad).bindings.move = s;
    this.save();
    this.#changed();
    return true;
  }

  clearAction(pad, action) {
    const prof = this.#profile(pad);
    delete prof.bindings[action];
    this.save();
    this.#changed();
  }

  /** Forget custom bindings; standard pads fall back to defaults, others to "unconfigured". */
  resetToDefaults(pad) {
    if (!pad) return;
    delete this.data.profiles[profileKey(pad.id)];
    this.save();
    this.#changed();
  }

  /** Explicit user choice: treat an unknown-mapping pad as if it had the standard layout. */
  applyStandardGuess(pad) {
    if (!pad) return;
    this.data.profiles[profileKey(pad.id)] = { bindings: clone(STANDARD_DEFAULTS) };
    this.save();
    this.#changed();
  }

  describe(pad, action) {
    const r = this.resolve(pad);
    if (action === 'move') return r.bindings.move ? 'Left stick' : 'Unbound';
    const list = r.bindings[action];
    if (!list || !list.length) return 'Unbound';
    return list.map((s) => describeSource(s, pad?.mapping)).join(' / ');
  }

  /** Short label for the first binding only (for on-screen prompts). */
  promptLabel(pad, action) {
    const r = this.resolve(pad);
    const list = r.bindings[action];
    if (!list || !list.length) return '?';
    // Prefer a digital-looking first source for prompts
    return describeSource(list[0], pad?.mapping);
  }
}
