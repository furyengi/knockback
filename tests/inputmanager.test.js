import { describe, it, expect } from 'vitest';
import { InputManager } from '../src/input/InputManager.js';
import { GamepadInput } from '../src/input/GamepadInput.js';
import { ControlBindings } from '../src/input/ControlBindings.js';
import { BUTTON_ACTIONS } from '../src/config/controlsConfig.js';

function memoryStorage() {
  const m = {};
  return {
    getJSON: (k, fb = null) => (k in m ? JSON.parse(m[k]) : fb),
    setJSON: (k, v) => {
      m[k] = JSON.stringify(v);
    },
  };
}

function fakeKeyboard() {
  const kb = {
    actions: {},
    move: { x: 0, z: 0 },
    onKey: null,
    getActions(out = {}) {
      for (const a of BUTTON_ACTIONS) out[a] = kb.actions[a] || 0;
      return out;
    },
    getMove: () => ({ ...kb.move }),
    endFrame() {},
    dispose() {},
  };
  return kb;
}

function fakePad(over = {}) {
  return {
    id: 'Pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)',
    index: 0,
    mapping: 'standard',
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
    press(i) {
      this.buttons[i] = { pressed: true, value: 1 };
    },
    release(i) {
      this.buttons[i] = { pressed: false, value: 0 };
    },
    ...over,
  };
}

function setup(pad) {
  const bindings = new ControlBindings(memoryStorage());
  const kb = fakeKeyboard();
  const gp = new GamepadInput(bindings, { getPads: () => (pad ? [pad] : []), target: null });
  const im = new InputManager({ bindings, keyboard: kb, gamepad: gp });
  return { im, kb, gp, bindings };
}

describe('InputManager', () => {
  it('produces one pressed edge when keyboard and gamepad press the same action together', () => {
    const pad = fakePad();
    const { im, kb } = setup(pad);
    im.poll(1 / 60);
    kb.actions.lightAttack = 1;
    pad.press(2);
    const f1 = im.poll(1 / 60);
    expect(f1.pressed.lightAttack).toBe(true);
    const f2 = im.poll(1 / 60);
    expect(f2.pressed.lightAttack).toBeUndefined();
    expect(f2.held.lightAttack).toBe(true);
  });

  it('keeps keyboard working while a controller is connected and switches the active device by use', () => {
    const pad = fakePad();
    const { im, kb } = setup(pad);
    const seen = [];
    im.onDeviceChange((d) => seen.push(d));
    im.poll(1 / 60);
    kb.move = { x: 1, z: 0 };
    expect(im.poll(1 / 60).move.x).toBe(1);
    pad.press(0); // dodge on the pad
    const f = im.poll(1 / 60);
    expect(f.pressed.dodge).toBe(true);
    expect(f.device).toBe('gamepad');
    expect(seen).toContain('gamepad');
    expect(im.prompt('dodge')).toBe('A');
    expect(im.prompt('move')).toBe('L-Stick');
  });

  it('combined movement is clamped so diagonals are never faster', () => {
    const pad = fakePad();
    const { im, kb } = setup(pad);
    kb.move = { x: 1, z: 1 };
    pad.axes[0] = 1;
    pad.axes[1] = 1;
    const f = im.poll(1 / 60);
    expect(Math.hypot(f.move.x, f.move.z)).toBeLessThanOrEqual(1.0001);
  });

  it('the D-pad doubles as digital movement when the stick is idle', () => {
    const pad = fakePad();
    const { im } = setup(pad);
    pad.press(14); // D-Left
    pad.press(12); // D-Up
    const f = im.poll(1 / 60);
    expect(f.move.x).toBeLessThan(0);
    expect(f.move.z).toBeLessThan(0);
    expect(Math.hypot(f.move.x, f.move.z)).toBeLessThanOrEqual(1.0001);
  });

  it('menu navigation fires once per direction change and auto-repeats', () => {
    const pad = fakePad();
    const { im } = setup(pad);
    im.poll(1 / 60);
    pad.press(13); // D-Down
    let fires = 0;
    for (let i = 0; i < 90; i++) if (im.poll(1 / 60).nav.y === 1) fires++;
    expect(fires).toBeGreaterThan(5);
    pad.release(13);
    expect(im.poll(1 / 60).nav.y).toBe(0);
  });

  it('an unmapped (non-standard) pad drives nothing and prompts stay on keyboard labels', () => {
    const pad = fakePad({ mapping: '', id: 'Odd Pad (Vendor: 1234 Product: 5678)' });
    const { im } = setup(pad);
    pad.press(2);
    pad.axes[0] = 1;
    const f = im.poll(1 / 60);
    expect(f.pressed.lightAttack).toBeUndefined();
    expect(f.move.x).toBe(0);
    expect(f.padNeedsSetup).toBe(true);
    expect(f.padAnyButton).toBe(true);
    expect(im.prompt('lightAttack')).toBe('J');
  });

  it('flush drops pending edges so a menu confirm cannot leak into gameplay', () => {
    const pad = fakePad();
    const { im } = setup(pad);
    pad.press(0);
    im.poll(1 / 60);
    pad.release(0);
    pad.press(0);
    const f = im.poll(1 / 60);
    im.flush();
    expect(im.frame.pressed.dodge).toBeUndefined();
    expect(f).toBeTruthy();
  });
});
