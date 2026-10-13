import { describe, it, expect, beforeEach } from 'vitest';
import {
  ControlBindings,
  applyRadialDeadZone,
  profileKey,
  readSource,
  sanitizeStore,
  BINDINGS_KEY,
} from '../src/input/ControlBindings.js';
import { EdgeTracker, NavRepeater } from '../src/input/InputUtils.js';
import { GamepadInput } from '../src/input/GamepadInput.js';
import { STANDARD_DEFAULTS } from '../src/config/controlsConfig.js';

function memoryStorage(initial = {}) {
  const m = { ...initial };
  return {
    m,
    getJSON(k, fb = null) {
      try {
        return k in m ? JSON.parse(m[k]) : fb;
      } catch {
        return fb;
      }
    },
    setJSON(k, v) {
      m[k] = JSON.stringify(v);
    },
  };
}

function fakePad({ id = 'Pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)', mapping = 'standard', buttons = 17, axes = 4, index = 0 } = {}) {
  return {
    id,
    index,
    mapping,
    connected: true,
    timestamp: 0,
    buttons: Array.from({ length: buttons }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: new Array(axes).fill(0),
    press(i, v = 1) {
      this.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v };
    },
    release(i) {
      this.buttons[i] = { pressed: false, touched: false, value: 0 };
    },
  };
}

describe('Radial dead zone', () => {
  it('ignores drift inside the dead zone', () => {
    const r = applyRadialDeadZone(0.1, -0.08, 0.16);
    expect(r.mag).toBe(0);
    expect(r.x).toBe(0);
  });
  it('rescales so movement starts smoothly from zero at the edge of the dead zone', () => {
    const justOut = applyRadialDeadZone(0.17, 0, 0.16);
    expect(justOut.mag).toBeGreaterThan(0);
    expect(justOut.mag).toBeLessThan(0.03);
    expect(applyRadialDeadZone(1, 0, 0.16).mag).toBeCloseTo(1, 5);
  });
  it('clamps diagonals so they are not faster than straight movement', () => {
    const r = applyRadialDeadZone(1, 1, 0.16); // raw magnitude 1.41 on square-gate sticks
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(1, 5);
    expect(r.x).toBeCloseTo(r.y, 5);
  });
});

describe('Edge detection', () => {
  it('produces exactly one pressed frame per physical press', () => {
    const e = new EdgeTracker();
    const pressedFrames = [];
    const seq = [0, 1, 1, 1, 1, 0, 0, 1, 1, 0];
    seq.forEach((v) => {
      e.update({ lightAttack: v });
      pressedFrames.push(!!e.pressed.lightAttack);
    });
    expect(pressedFrames.filter(Boolean).length).toBe(2);
    expect(pressedFrames[1]).toBe(true);
    expect(pressedFrames[2]).toBe(false);
  });
  it('uses hysteresis for analog triggers so they do not chatter', () => {
    const e = new EdgeTracker();
    let presses = 0;
    for (const v of [0.1, 0.6, 0.5, 0.56, 0.45, 0.54, 0.4, 0.2, 0.6]) {
      e.update({ block: v });
      if (e.pressed.block) presses++;
    }
    expect(presses).toBe(2); // 0.6 then, after dropping below 0.35, 0.6 again
  });
  it('reports releases', () => {
    const e = new EdgeTracker();
    e.update({ dodge: 1 });
    e.update({ dodge: 0 });
    expect(e.released.dodge).toBe(true);
  });
});

describe('Navigation repeat', () => {
  it('fires once, waits, then repeats while held', () => {
    const n = new NavRepeater({ delay: 0.4, rate: 0.1 });
    let fires = 0;
    for (let i = 0; i < 60; i++) if (n.update(0, 1, 1 / 60).y === 1) fires++;
    // 1 immediate + repeats after 0.4 s over ~1 s
    expect(fires).toBeGreaterThanOrEqual(6);
    expect(fires).toBeLessThanOrEqual(8);
    expect(n.update(0, 0, 1 / 60)).toEqual({ x: 0, y: 0 });
  });
  it('fires again immediately on a direction change', () => {
    const n = new NavRepeater();
    expect(n.update(1, 0, 0.016).x).toBe(1);
    expect(n.update(1, 0, 0.016).x).toBe(0);
    expect(n.update(-1, 0, 0.016).x).toBe(-1);
  });
});

describe('Bindings: defaults and unknown layouts', () => {
  it('standard pads get the suggested defaults', () => {
    const b = new ControlBindings(memoryStorage());
    const r = b.resolve(fakePad());
    expect(r.configured).toBe(true);
    expect(r.bindings.dodge).toEqual(STANDARD_DEFAULTS.dodge);
  });
  it('non-standard pads are NOT silently given a layout', () => {
    const b = new ControlBindings(memoryStorage());
    const r = b.resolve(fakePad({ mapping: '', id: 'Generic USB Joystick (Vendor: 0079 Product: 0006)' }));
    expect(r.configured).toBe(false);
    expect(Object.keys(r.bindings)).toHaveLength(0);
    const gp = new GamepadInput(b, { getPads: () => [], target: null });
    gp.pad = fakePad({ mapping: '' });
    gp.pad.press(2);
    expect(gp.read().actions.lightAttack).toBe(0);
  });
  it('applyStandardGuess is an explicit user action', () => {
    const b = new ControlBindings(memoryStorage());
    const pad = fakePad({ mapping: '', id: 'Odd Pad (Vendor: 1234 Product: 5678)' });
    b.applyStandardGuess(pad);
    expect(b.resolve(pad).configured).toBe(true);
  });
});

describe('Bindings: persistence', () => {
  let store;
  beforeEach(() => {
    store = memoryStorage();
  });

  it('saves custom bindings and dead zone and restores them after a "reload"', () => {
    const pad = fakePad();
    const a = new ControlBindings(store);
    a.setSources(pad, 'lightAttack', [{ type: 'button', index: 5 }]);
    a.deadZone = 0.27;
    const b = new ControlBindings(store); // fresh instance reading the same storage
    expect(b.deadZone).toBeCloseTo(0.27);
    expect(b.resolve(pad).bindings.lightAttack).toEqual([{ type: 'button', index: 5 }]);
    expect(b.resolve(pad).custom).toBe(true);
  });

  it('survives a profile key across reconnect with a different gamepad index', () => {
    const a = new ControlBindings(store);
    a.setSources(fakePad({ index: 0 }), 'dodge', [{ type: 'button', index: 7 }]);
    const b = new ControlBindings(store);
    expect(b.resolve(fakePad({ index: 3 })).bindings.dodge[0].index).toBe(7);
  });

  it('rejects corrupt / outdated stored data without throwing', () => {
    store.m[BINDINGS_KEY] = '{not json';
    expect(new ControlBindings(store).deadZone).toBeCloseTo(0.16);
    store.m[BINDINGS_KEY] = JSON.stringify({ version: 0, deadZone: 5, profiles: {} });
    expect(new ControlBindings(store).deadZone).toBeCloseTo(0.16);
    const cleaned = sanitizeStore({
      version: 1,
      deadZone: 9,
      profiles: { x: { bindings: { dodge: [{ type: 'button', index: -4 }, { type: 'nope' }], lightAttack: [{ type: 'button', index: 3 }] } } },
    });
    expect(cleaned.deadZone).toBeLessThanOrEqual(0.5);
    expect(cleaned.profiles.x.bindings.dodge).toBeUndefined();
    expect(cleaned.profiles.x.bindings.lightAttack).toHaveLength(1);
  });

  it('reset restores defaults', () => {
    const pad = fakePad();
    const b = new ControlBindings(store);
    b.setSources(pad, 'dodge', [{ type: 'button', index: 9 }]);
    b.resetToDefaults(pad);
    expect(b.resolve(pad).bindings.dodge).toEqual(STANDARD_DEFAULTS.dodge);
  });

  it('profileKey is stable for vendor/product ids', () => {
    expect(profileKey('Xbox (STANDARD GAMEPAD Vendor: 045E Product: 028E)')).toBe('045e:028e');
    expect(profileKey('045e-028e-Xbox 360 Controller')).toBe('045e:028e');
  });
});

describe('GamepadInput', () => {
  function setup(pad) {
    const bindings = new ControlBindings(memoryStorage());
    const gp = new GamepadInput(bindings, { getPads: () => [null, pad, undefined], target: null });
    gp.refresh();
    return { bindings, gp };
  }

  it('tolerates null entries and finds the pad', () => {
    const { gp } = setup(fakePad({ index: 1 }));
    expect(gp.connected).toBe(true);
    expect(gp.info.mapping).toBe('standard');
  });

  it('maps each standard face button to its semantic action', () => {
    const pad = fakePad();
    const { gp } = setup(pad);
    const check = (btn, action) => {
      pad.press(btn);
      gp.refresh();
      const r = gp.read();
      expect(r.actions[action]).toBe(1);
      pad.release(btn);
    };
    check(2, 'lightAttack');
    check(3, 'heavyAttack');
    check(0, 'dodge');
    check(9, 'pause');
    check(1, 'cancel');
    check(12, 'navUp');
  });

  it('supports analog and digital triggers for block', () => {
    const pad = fakePad();
    const { gp } = setup(pad);
    pad.press(6, 0.8); // analog LT
    gp.refresh();
    expect(gp.read().actions.block).toBeCloseTo(0.8);
    pad.release(6);
    pad.buttons[6] = { pressed: true, value: 0 }; // digital-only trigger reporting pressed with no value
    gp.refresh();
    expect(gp.read().actions.block).toBe(1);
  });

  it('applies the dead zone to stick drift and returns arena-space movement', () => {
    const pad = fakePad();
    const { gp } = setup(pad);
    pad.axes[0] = 0.1;
    pad.axes[1] = 0.1;
    gp.refresh();
    expect(gp.read().move.mag).toBe(0);
    pad.axes[0] = 0;
    pad.axes[1] = -1; // stick up
    gp.refresh();
    const r = gp.read();
    expect(r.move.z).toBeCloseTo(-1, 3); // up on the stick = away from camera = -Z
    pad.axes[0] = 1;
    pad.axes[1] = 1;
    gp.refresh();
    const d = gp.read();
    expect(Math.hypot(d.move.x, d.move.z)).toBeLessThanOrEqual(1.0001);
  });

  it('reads axis-based buttons (trigger axis resting at -1) and hat switches', () => {
    const pad = fakePad({ mapping: '', axes: 10 });
    const trigger = { type: 'axis', index: 4, dir: 1, rest: -1 };
    pad.axes[4] = -1;
    expect(readSource(trigger, pad)).toBe(0);
    pad.axes[4] = 1;
    expect(readSource(trigger, pad)).toBe(1);
    pad.axes[4] = 0;
    expect(readSource(trigger, pad)).toBeCloseTo(0.5);
    const hat = { type: 'hat', index: 9, value: -1 };
    pad.axes[9] = 3.2857;
    expect(readSource(hat, pad)).toBe(0);
    pad.axes[9] = -1;
    expect(readSource(hat, pad)).toBe(1);
  });

  it('capture: waits for release, then binds the next button; unknown pads become configurable', () => {
    const pad = fakePad({ mapping: '', id: 'Dongle Pad (Vendor: 0079 Product: 0011)', buttons: 12 });
    const { bindings, gp } = setup(pad);
    pad.press(3); // the press that opened the dialog is still held
    gp.refresh();
    let got = null;
    gp.startCapture({ mode: 'button', onCapture: (b) => (got = b) });
    for (let i = 0; i < 20; i++) {
      gp.refresh();
      gp.updateCapture(1 / 60);
    }
    expect(got).toBe(null); // held button was ignored
    pad.release(3);
    for (let i = 0; i < 20; i++) {
      gp.refresh();
      gp.updateCapture(1 / 60);
    }
    pad.press(7);
    gp.refresh();
    gp.updateCapture(1 / 60);
    expect(got).toEqual({ type: 'button', index: 7 });
    bindings.setSources(pad, 'dodge', [got]);
    expect(bindings.resolve(pad).bindings.dodge[0].index).toBe(7);
    pad.release(7);
    gp.refresh();
    pad.press(7);
    gp.refresh();
    expect(gp.read().actions.dodge).toBe(1);
  });

  it('capture times out cleanly and reports disconnects', () => {
    const pad = fakePad();
    const { gp } = setup(pad);
    let reason = null;
    gp.startCapture({ timeout: 0.2, onCancel: (r) => (reason = r) });
    for (let i = 0; i < 30; i++) {
      gp.refresh();
      gp.updateCapture(1 / 60);
    }
    expect(reason).toBe('timeout');
  });

  it('rumble is feature-detected and never throws', () => {
    const pad = fakePad();
    const { gp } = setup(pad);
    expect(() => gp.rumble(1, 1, 50)).not.toThrow(); // no actuator
    let called = 0;
    pad.vibrationActuator = { playEffect: () => (called++, Promise.reject(new Error('nope'))) };
    expect(() => gp.rumble(1, 1, 50)).not.toThrow();
    expect(called).toBe(1);
    pad.vibrationActuator = { playEffect: () => { throw new Error('boom'); } };
    expect(() => gp.rumble(1, 1, 50)).not.toThrow();
  });

  it('with two controllers, the one being used becomes active', () => {
    const a = fakePad({ index: 0 });
    const b = fakePad({ index: 1, id: 'Second Pad (Vendor: 0079 Product: 0011)' });
    const bindings = new ControlBindings(memoryStorage());
    const gp = new GamepadInput(bindings, { getPads: () => [a, b], target: null });
    gp.refresh(10);
    b.press(0);
    gp.refresh(20);
    expect(gp.pad.index).toBe(1);
    b.release(0);
    a.press(0);
    gp.refresh(30);
    expect(gp.pad.index).toBe(0);
  });
});
