import { STATE } from './Character.js';
import { PHASE } from '../combat/Attack.js';
import { clamp, lerp, easeOutCubic, smoothstep } from '../util/math.js';

// Procedural animation: derives a target pose from simulation state every frame and
// eases the rig toward it. Attack phases are driven directly by their normalised
// progress so the animation timing always matches the gameplay timing.

export const HIPS_Y = 0.86;

const KEYS = [
  'hipY', 'lean', 'twist', 'roll', 'headPitch',
  'LSx', 'LSz', 'LEx', 'RSx', 'RSz', 'REx',
  'LHx', 'LKx', 'RHx', 'RKx', 'LHz', 'RHz',
  'tumX', 'tumZ', 'offY',
];

function makePose() {
  const p = {};
  for (const k of KEYS) p[k] = 0;
  return p;
}

// stance presets
function guardPose(p, t, bob) {
  p.hipY = -0.07 + bob;
  p.lean = 0.12;
  p.twist = 0.28;
  p.LSx = -0.85; p.LSz = -0.2; p.LEx = -1.95;
  p.RSx = -1.05; p.RSz = 0.2; p.REx = -1.75;
  p.LHx = -0.22; p.LKx = 0.28; p.RHx = 0.2; p.RKx = 0.3;
  p.LHz = -0.1; p.RHz = 0.1;
  p.headPitch = 0.05;
}

export class CharacterAnimator {
  constructor(model) {
    this.m = model;
    this.pose = makePose();
    this.target = makePose();
    this.walkPhase = Math.random() * 6;
    this.spring = 0; // squash(-) / stretch(+)
    this.springV = 0;
    this.prevState = null;
    this.prevPhase = null;
    this.prevAttackId = 0;
    this.tumbleAccum = 0;
    this.speedSmooth = 0;
    this.hitLean = 0;
    this.hitSide = 0;
  }

  /** Kick the squash/stretch spring (positive = stretch tall, negative = squash flat). */
  kick(amount) {
    this.springV += amount * 24;
  }

  update(c, dt) {
    const T = this.target;
    const P = this.pose;
    for (const k of KEYS) T[k] = 0;

    // ---- locomotion basics
    const f = c.facing;
    const sf = Math.sin(f);
    const cf = Math.cos(f);
    const vx = c.mvx + c.kx;
    const vz = c.mvz + c.kz;
    const vForward = vx * sf + vz * cf;
    const vSide = vx * cf - vz * sf;
    const speed = Math.hypot(c.mvx, c.mvz);
    this.speedSmooth += (speed - this.speedSmooth) * (1 - Math.exp(-14 * dt));
    this.walkPhase += this.speedSmooth * dt * 2.0;
    const k = Math.min(1, this.speedSmooth / 4.5);
    const t = c.clock;
    const breathe = Math.sin(t * 2.6) * 0.012;

    let rate = 16;
    const a = c.attack;

    switch (c.state) {
      case STATE.NEUTRAL:
        rate = 14;
        if (c.blocking) this.#block(T, t);
        else this.#locomotion(T, k, vForward, vSide, breathe);
        break;
      case STATE.ATTACK:
        rate = 70;
        if (a) this.#attack(c, a, T, k);
        break;
      case STATE.DODGE:
        rate = 28;
        this.#dodge(c, T);
        break;
      case STATE.HITSTUN: {
        rate = 34;
        guardPose(T, t, 0);
        const lean = this.#knockLean(c);
        const u = c.stateDuration > 0 ? clamp(c.stateTime / c.stateDuration, 0, 1) : 1;
        const e = 1 - smoothstep(clamp((u - 0.35) / 0.65, 0, 1));
        T.lean = lean * 0.62 * e + 0.1;
        T.headPitch = -lean * 0.5 * e;
        T.LSx = lerp(-0.85, 0.55, e); T.LSz = lerp(-0.2, -1.0, e); T.LEx = lerp(-1.95, -0.5, e);
        T.RSx = lerp(-1.05, 0.35, e); T.RSz = lerp(0.2, 1.0, e); T.REx = lerp(-1.75, -0.6, e);
        T.hipY = -0.05 - 0.04 * e;
        T.twist = 0.28 + this.hitSide * 0.35 * e;
        T.LHx = lerp(-0.22, -0.5, e); T.RHx = lerp(0.2, 0.5, e);
        break;
      }
      case STATE.STAGGER: {
        rate = 12;
        const sway = Math.sin(t * 7) * (c.dazed ? 0.16 : 0.08);
        T.hipY = -0.12;
        T.lean = 0.5;
        T.headPitch = 0.45;
        T.roll = sway;
        T.LSx = 0.12; T.LSz = -0.3; T.LEx = -0.25;
        T.RSx = 0.08; T.RSz = 0.3; T.REx = -0.25;
        T.LHx = -0.3; T.LKx = 0.5; T.RHx = 0.1; T.RKx = 0.6;
        T.twist = Math.sin(t * 4.5) * 0.25;
        break;
      }
      case STATE.AIRBORNE: {
        rate = 22;
        const lean = this.#knockLean(c);
        const flail = Math.sin(t * 22);
        T.hipY = 0.05;
        T.lean = lean * 0.9;
        T.headPitch = -lean * 0.4;
        T.tumX = lean * Math.min(1.4, c.stateTime * 3.2);
        T.LSx = -2.5 + flail * 0.35; T.LSz = -0.7; T.LEx = -0.4;
        T.RSx = -2.4 - flail * 0.35; T.RSz = 0.7; T.REx = -0.4;
        T.LHx = -0.6; T.LKx = 0.8; T.RHx = 0.5; T.RKx = 0.7;
        T.offY = 0.0;
        break;
      }
      case STATE.FALLING: {
        rate = 20;
        const flail = Math.sin(t * 26);
        this.tumbleAccum += c.spinSpeed * 0.55 * dt;
        T.tumX = this.tumbleAccum;
        T.LSx = -2.7 + flail * 0.5; T.LSz = -0.9; T.LEx = -0.3;
        T.RSx = -2.6 - flail * 0.5; T.RSz = 0.9; T.REx = -0.3;
        T.LHx = -0.7 + flail * 0.4; T.LKx = 0.7; T.RHx = 0.7 - flail * 0.4; T.RKx = 0.5;
        T.headPitch = -0.3;
        T.twist = flail * 0.3;
        break;
      }
      case STATE.KO: {
        rate = 7;
        T.tumX = -1.45;
        T.offY = 0.22;
        T.LSx = 0.2; T.LSz = -0.9; T.LEx = -0.3;
        T.RSx = 0.2; T.RSz = 0.9; T.REx = -0.3;
        T.LHx = -0.1; T.RHx = 0.1; T.LKx = 0.2; T.RKx = 0.3; T.LHz = -0.25; T.RHz = 0.25;
        T.headPitch = -0.15;
        break;
      }
      case STATE.SPAWN: {
        rate = 20;
        T.LSx = -2.8; T.LSz = -0.4; T.LEx = -0.3;
        T.RSx = -2.8; T.RSz = 0.4; T.REx = -0.3;
        T.LHx = -0.3; T.RHx = 0.3; T.LKx = 0.2; T.RKx = 0.2;
        T.hipY = 0.04;
        break;
      }
      default:
        guardPose(T, t, 0);
    }

    // ---- state-entry reactions (squash / stretch)
    if (c.state !== this.prevState) {
      if (c.state === STATE.HITSTUN || c.state === STATE.STAGGER) {
        this.kick(-0.3);
        // which side did it hit from? decides a small twist
        this.hitSide = vSide >= 0 ? 1 : -1;
      }
      if (c.state === STATE.DODGE) this.kick(0.22);
      if (c.state === STATE.AIRBORNE) this.kick(0.18);
      if (this.prevState === STATE.AIRBORNE && c.state === STATE.HITSTUN) this.kick(-0.38);
      if (this.prevState === STATE.SPAWN && c.state === STATE.NEUTRAL) this.kick(-0.55);
      this.prevState = c.state;
    }
    if (a && (a.id !== this.prevAttackId || a.phase !== this.prevPhase)) {
      if (a.phase === PHASE.ACTIVE) this.kick(a.kind === 'heavy' ? -0.35 : 0.14);
      if (a.phase === PHASE.WINDUP && a.kind === 'heavy') this.kick(0.12);
      this.prevAttackId = a.id;
      this.prevPhase = a.phase;
    }

    // ---- ease current pose toward the target
    const e = 1 - Math.exp(-rate * dt);
    for (const key of KEYS) P[key] += (T[key] - P[key]) * e;

    // spring: damped oscillator
    this.springV += (-300 * this.spring - 24 * this.springV) * dt;
    this.spring += this.springV * dt;
    this.spring = clamp(this.spring, -0.5, 0.5);

    this.#apply(c);
  }

  #knockLean(c) {
    const f = c.facing;
    const kv = Math.hypot(c.kx, c.kz);
    if (kv < 0.5) return this.hitLean * 0.9;
    // moving backwards relative to facing -> lean back (negative), forward -> positive
    const l = (c.kx * Math.sin(f) + c.kz * Math.cos(f)) / kv;
    this.hitLean = l;
    return l;
  }

  #locomotion(T, k, vForward, vSide, breathe) {
    guardPose(T, 0, breathe);
    const ph = this.walkPhase;
    const sw = Math.sin(ph) * 0.75 * k;
    const sw2 = Math.sin(ph + Math.PI) * 0.75 * k;
    T.LHx = -0.22 + sw;
    T.RHx = 0.2 + sw2;
    T.LKx = 0.28 + Math.max(0, Math.cos(ph)) * 0.85 * k;
    T.RKx = 0.3 + Math.max(0, Math.cos(ph + Math.PI)) * 0.85 * k;
    T.hipY += -Math.abs(Math.sin(ph)) * 0.06 * k;
    T.lean += clamp(vForward / 7, -0.4, 0.4) * 0.45;
    T.roll = clamp(-vSide / 12, -0.15, 0.15);
    T.twist -= vSide * 0.01;
    // arms bob with stride
    T.LSx += Math.sin(ph + Math.PI) * 0.18 * k;
    T.RSx += Math.sin(ph) * 0.18 * k;
  }

  #block(T, t) {
    guardPose(T, t, 0);
    T.hipY = -0.16;
    T.lean = 0.2;
    T.twist = 0.1;
    T.LSx = -1.3; T.LSz = 0.5; T.LEx = -2.45;
    T.RSx = -1.3; T.RSz = -0.5; T.REx = -2.45;
    T.LHz = -0.2; T.RHz = 0.2;
    T.LKx = 0.5; T.RKx = 0.5;
    T.headPitch = 0.15;
  }

  #dodge(c, T) {
    guardPose(T, 0, 0);
    T.lean = 0.7;
    T.hipY = -0.22;
    T.twist = 0;
    T.LHx = -1.0; T.LKx = 0.3; T.RHx = 0.7; T.RKx = 1.1;
    T.LSx = 0.8; T.LSz = -0.3; T.LEx = -0.4;
    T.RSx = 0.8; T.RSz = 0.3; T.REx = -0.4;
    T.headPitch = -0.2;
    T.tumZ = 0;
  }

  #attack(c, a, T, k) {
    const p = a.progress;
    const heavy = a.kind === 'heavy';
    guardPose(T, c.clock, 0);
    if (heavy) {
      T.LHz = -0.25; T.RHz = 0.25; T.LHx = -0.35; T.RHx = 0.3; T.LKx = 0.4; T.RKx = 0.4;
      if (a.phase === PHASE.WINDUP) {
        const e = smoothstep(p);
        T.LSx = lerp(-0.85, -3.0, e); T.LSz = lerp(-0.2, -0.35, e); T.LEx = lerp(-1.95, -0.25, e);
        T.RSx = lerp(-1.05, -3.0, e); T.RSz = lerp(0.2, 0.35, e); T.REx = lerp(-1.75, -0.25, e);
        T.lean = lerp(0.1, -0.5, e);
        T.hipY = lerp(-0.07, -0.18, e);
        T.twist = lerp(0.28, 0, e);
        T.headPitch = lerp(0.05, -0.35, e);
        T.LKx = T.RKx = lerp(0.3, 0.7, e);
      } else if (a.phase === PHASE.ACTIVE) {
        const e = easeOutCubic(p);
        T.LSx = lerp(-3.0, -0.6, e); T.LEx = lerp(-0.25, -0.5, e); T.LSz = -0.3;
        T.RSx = lerp(-3.0, -0.6, e); T.REx = lerp(-0.25, -0.5, e); T.RSz = 0.3;
        T.lean = lerp(-0.5, 0.85, e);
        T.hipY = lerp(-0.18, -0.3, e);
        T.headPitch = lerp(-0.35, 0.3, e);
        T.twist = 0;
        T.LKx = T.RKx = 0.9;
      } else {
        const e = smoothstep(p);
        T.LSx = lerp(-0.6, -0.9, e); T.LEx = lerp(-0.5, -1.95, e); T.LSz = -0.2;
        T.RSx = lerp(-0.6, -1.05, e); T.REx = lerp(-0.5, -1.75, e); T.RSz = 0.2;
        T.lean = lerp(0.85, 0.12, smoothstep(clamp((p - 0.35) / 0.65, 0, 1)));
        T.hipY = lerp(-0.3, -0.07, smoothstep(clamp((p - 0.25) / 0.75, 0, 1)));
        T.headPitch = lerp(0.3, 0.05, e);
        T.LKx = T.RKx = lerp(0.9, 0.3, e);
      }
      return;
    }
    // light punch: the swinging arm is on `a.side`
    const right = a.side > 0;
    const fin = a.finisher;
    const sw = right ? 'R' : 'L';
    const op = right ? 'L' : 'R';
    const sgn = right ? 1 : -1;
    const sx = `${sw}Sx`; const sz = `${sw}Sz`; const ex = `${sw}Ex`;
    // lead leg lunges
    T.LHx = -0.55; T.LKx = 0.45; T.RHx = 0.5; T.RKx = 0.4;
    if (a.phase === PHASE.WINDUP) {
      const e = smoothstep(p);
      T[sx] = lerp(-1.0, 0.35, e); T[ex] = lerp(-1.75, -2.2, e); T[sz] = sgn * lerp(0.2, 0.5, e);
      T.twist = -sgn * lerp(0.28, 0.55, e) * (fin ? 1.5 : 1) + 0;
      T.lean = lerp(0.12, -0.05, e);
    } else if (a.phase === PHASE.ACTIVE) {
      const e = easeOutCubic(p);
      T[sx] = lerp(0.35, -1.55, e); T[ex] = lerp(-2.2, -0.12, e); T[sz] = sgn * lerp(0.5, fin ? 0.05 : 0.12, e);
      T.twist = sgn * lerp(-0.55, fin ? 0.9 : 0.55, e);
      T.lean = lerp(-0.05, fin ? 0.55 : 0.35, e);
      T.hipY = -0.12;
    } else {
      const e = smoothstep(p);
      T[sx] = lerp(-1.55, -1.0, e); T[ex] = lerp(-0.12, -1.75, e); T[sz] = sgn * lerp(0.12, 0.2, e);
      T.twist = lerp(sgn * (fin ? 0.9 : 0.55), 0.28, e);
      T.lean = lerp(fin ? 0.55 : 0.35, 0.12, e);
      T.LHx = lerp(-0.55, -0.22, e); T.RHx = lerp(0.5, 0.2, e);
    }
    // off hand guards the chin
    T[`${op}Sx`] = -1.0; T[`${op}Ex`] = -2.05;
  }

  #apply(c) {
    const m = this.m;
    const P = this.pose;
    m.hips.position.y = HIPS_Y + P.hipY;
    m.hips.rotation.z = P.roll;
    m.torso.rotation.set(P.lean, P.twist, 0);
    m.head.rotation.set(P.headPitch - P.lean * 0.4, -P.twist * 0.5, 0);
    m.shoulderL.rotation.set(P.LSx, 0, P.LSz);
    m.shoulderR.rotation.set(P.RSx, 0, P.RSz);
    m.elbowL.rotation.set(P.LEx, 0, 0);
    m.elbowR.rotation.set(P.REx, 0, 0);
    m.hipL.rotation.set(P.LHx, 0, P.LHz);
    m.hipR.rotation.set(P.RHx, 0, P.RHz);
    m.kneeL.rotation.x = P.LKx;
    m.kneeR.rotation.x = P.RKx;
    m.tumble.rotation.set(P.tumX, 0, P.tumZ);
    m.tumble.position.y = P.offY;
    const s = this.spring;
    m.tumble.scale.set(1 - s * 0.55, 1 + s, 1 - s * 0.55);
    if (m.shield) m.shield.rotation.x = c.blocking ? 0.0 : 0.0;
  }
}
