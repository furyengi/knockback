import { Storage } from '../util/Storage.js';
import { clamp } from '../util/math.js';

const KEY = 'knockback.settings.v1';

export function loadSettings() {
  const v = Storage.getJSON(KEY, null) || {};
  return {
    volume: typeof v.volume === 'number' ? clamp(v.volume, 0, 1) : 0.7,
    muted: !!v.muted,
    shake: typeof v.shake === 'number' ? clamp(v.shake, 0, 1) : 1,
    shadows: v.shadows !== false,
  };
}
export function saveSettings(s) {
  Storage.setJSON(KEY, s);
}

/**
 * All sound is synthesised with the Web Audio API (no asset files, so it is original and
 * works offline). The context is created lazily on the first user gesture to respect
 * browser autoplay rules. Every call is safe when audio is unavailable.
 */
export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.last = new Map();
    this.ambience = null;
    this.failed = false;
  }

  /** Call from a user gesture (key/click/gamepad press). */
  unlock() {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          this.failed = true;
          return;
        }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = -14;
        this.comp.ratio.value = 4;
        this.master.connect(this.comp).connect(this.ctx.destination);
        this.#applyVolume();
        this.#makeNoise();
        this.#startAmbience();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.failed = true;
    }
  }

  #applyVolume() {
    if (!this.master) return;
    const v = this.settings.muted ? 0 : this.settings.volume;
    this.master.gain.setTargetAtTime(v * v * 1.1, this.ctx.currentTime, 0.02);
  }

  setVolume(v) {
    this.settings.volume = clamp(v, 0, 1);
    saveSettings(this.settings);
    this.#applyVolume();
  }
  setMuted(m) {
    this.settings.muted = !!m;
    saveSettings(this.settings);
    this.#applyVolume();
  }
  toggleMute() {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  #makeNoise() {
    const len = this.ctx.sampleRate * 3;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  #startAmbience() {
    // distant city wind: very quiet filtered noise with a slow swell
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg).connect(g.gain);
    src.connect(bp).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.ambience = { src, g };
  }

  // ---- building blocks -------------------------------------------------------------

  #ok(name, minGap = 0.03) {
    if (!this.ctx || this.ctx.state !== 'running' || this.settings.muted) return false;
    const now = this.ctx.currentTime;
    const l = this.last.get(name) || -1;
    if (now - l < minGap) return false;
    this.last.set(name, now);
    return true;
  }

  #env(gain, t0, attack, dur, peak) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.2, gain = 0.3, attack = 0.004, delay = 0, detune = 0, filter = null }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    this.#env(g, t0, attack, dur, gain);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.f;
      f.Q.value = filter.q || 0.7;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.15, gain = 0.3, type = 'bandpass', f0 = 1000, f1 = null, q = 1, attack = 0.002, delay = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.#env(g, t0, attack, dur, gain);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.8, dur + 0.05);
  }

  // ---- game sounds -----------------------------------------------------------------

  play(name, p = {}) {
    if (!this.#ok(name, name === 'uiMove' ? 0.02 : 0.025)) return;
    const r = 0.94 + Math.random() * 0.12;
    try {
      switch (name) {
        case 'uiMove':
          this.tone({ type: 'triangle', f0: 760 * r, f1: 900 * r, dur: 0.05, gain: 0.07 });
          break;
        case 'uiSelect':
          this.tone({ type: 'triangle', f0: 520, dur: 0.09, gain: 0.12 });
          this.tone({ type: 'triangle', f0: 780, dur: 0.14, gain: 0.12, delay: 0.06 });
          break;
        case 'uiBack':
          this.tone({ type: 'triangle', f0: 520, f1: 360, dur: 0.12, gain: 0.1 });
          break;
        case 'swingLight':
          this.noise({ dur: 0.11, gain: 0.1, f0: 1800 * r, f1: 500, q: 0.9 });
          break;
        case 'swingHeavy':
          this.noise({ dur: 0.3, gain: 0.16, f0: 900, f1: 160, q: 0.7, attack: 0.05 });
          this.tone({ type: 'sine', f0: 140, f1: 60, dur: 0.3, gain: 0.1, attack: 0.08 });
          break;
        case 'telegraph':
          this.tone({ type: 'sawtooth', f0: 120, f1: 260, dur: p.dur || 0.5, gain: 0.05, attack: 0.1, filter: { type: 'lowpass', f: 600 } });
          break;
        case 'hitLight':
          this.tone({ type: 'sine', f0: 210 * r, f1: 70, dur: 0.12, gain: 0.34 });
          this.noise({ dur: 0.06, gain: 0.22, type: 'highpass', f0: 2200, q: 0.5 });
          break;
        case 'hitHeavy':
          this.tone({ type: 'sine', f0: 120 * r, f1: 34, dur: 0.38, gain: 0.55 });
          this.tone({ type: 'square', f0: 220, f1: 60, dur: 0.14, gain: 0.12, filter: { type: 'lowpass', f: 900 } });
          this.noise({ dur: 0.14, gain: 0.4, type: 'lowpass', f0: 3800, f1: 400, q: 0.4 });
          break;
        case 'block':
          this.tone({ type: 'square', f0: 480 * r, f1: 300, dur: 0.08, gain: 0.1, filter: { type: 'bandpass', f: 900, q: 2 } });
          this.noise({ dur: 0.08, gain: 0.2, f0: 2800, q: 2.4 });
          this.tone({ type: 'sine', f0: 130, f1: 60, dur: 0.16, gain: 0.25 });
          break;
        case 'perfectBlock':
          this.tone({ type: 'triangle', f0: 1180, dur: 0.5, gain: 0.22 });
          this.tone({ type: 'triangle', f0: 1770, dur: 0.38, gain: 0.14, delay: 0.015 });
          this.noise({ dur: 0.1, gain: 0.3, f0: 3600, q: 2 });
          this.tone({ type: 'sine', f0: 160, f1: 55, dur: 0.22, gain: 0.3 });
          break;
        case 'guardBreak':
          this.noise({ dur: 0.22, gain: 0.4, type: 'highpass', f0: 1200, f1: 3500 });
          this.tone({ type: 'square', f0: 340, f1: 90, dur: 0.25, gain: 0.16, filter: { type: 'lowpass', f: 1200 } });
          this.tone({ type: 'sine', f0: 100, f1: 38, dur: 0.4, gain: 0.45 });
          break;
        case 'dodge':
          this.noise({ dur: 0.2, gain: 0.14, f0: 500, f1: 2600, q: 0.8, attack: 0.03 });
          break;
        case 'perfectDodge':
          this.tone({ type: 'sine', f0: 700, f1: 1500, dur: 0.18, gain: 0.14 });
          break;
        case 'hurt':
          this.tone({ type: 'sawtooth', f0: 170 * r, f1: 72, dur: 0.24, gain: 0.2, filter: { type: 'lowpass', f: 700 } });
          this.tone({ type: 'sine', f0: 90, f1: 40, dur: 0.3, gain: 0.35 });
          break;
        case 'ringOut':
          this.tone({ type: 'sine', f0: 1100, f1: 150, dur: 1.15, gain: 0.12, attack: 0.02 });
          this.noise({ dur: 1.1, gain: 0.07, f0: 3000, f1: 300, q: 0.6 });
          this.tone({ type: 'sine', f0: 70, f1: 30, dur: 0.55, gain: 0.45, delay: 1.0 });
          this.noise({ dur: 0.3, gain: 0.2, type: 'lowpass', f0: 800, q: 0.5, delay: 1.0 });
          break;
        case 'ringOutCheer':
          this.tone({ type: 'triangle', f0: 523, dur: 0.12, gain: 0.12 });
          this.tone({ type: 'triangle', f0: 784, dur: 0.22, gain: 0.12, delay: 0.09 });
          break;
        case 'bump':
          this.tone({ type: 'sine', f0: 150, f1: 50, dur: 0.18, gain: 0.35 });
          this.noise({ dur: 0.05, gain: 0.18, type: 'highpass', f0: 1800 });
          break;
        case 'land':
          this.tone({ type: 'sine', f0: 90, f1: 38, dur: 0.22, gain: 0.35 * (p.power || 1) });
          this.noise({ dur: 0.12, gain: 0.12 * (p.power || 1), type: 'lowpass', f0: 1200, q: 0.4 });
          break;
        case 'spawn':
          this.tone({ type: 'sine', f0: 600, f1: 200, dur: 0.5, gain: 0.07, attack: 0.1 });
          break;
        case 'staminaFail':
          this.tone({ type: 'square', f0: 120, f1: 95, dur: 0.1, gain: 0.07, filter: { type: 'lowpass', f: 500 } });
          break;
        case 'waveStart':
          this.tone({ type: 'sawtooth', f0: 196, dur: 0.5, gain: 0.14, filter: { type: 'lowpass', f: 900 } });
          this.tone({ type: 'sawtooth', f0: 294, dur: 0.5, gain: 0.12, delay: 0.14, filter: { type: 'lowpass', f: 1100 } });
          this.tone({ type: 'sine', f0: 98, f1: 90, dur: 0.6, gain: 0.3 });
          break;
        case 'waveClear':
          [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.3, gain: 0.14, delay: i * 0.085 }));
          break;
        case 'upgrade':
          [660, 880, 1320].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.28, gain: 0.13, delay: i * 0.06 }));
          this.noise({ dur: 0.3, gain: 0.08, type: 'highpass', f0: 5000, delay: 0.1 });
          break;
        case 'gameOver':
          [392, 330, 262, 196].forEach((f, i) => this.tone({ type: 'sawtooth', f0: f, dur: 0.45, gain: 0.1, delay: i * 0.22, filter: { type: 'lowpass', f: 800 } }));
          this.tone({ type: 'sine', f0: 80, f1: 32, dur: 1.2, gain: 0.4, delay: 0.5 });
          break;
        case 'combo':
          this.tone({ type: 'triangle', f0: 600 + (p.combo || 0) * 22, dur: 0.07, gain: 0.07 });
          break;
        default:
          break;
      }
    } catch {
      /* audio is optional */
    }
  }
}
