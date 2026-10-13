import { h } from './dom.js';
import { STANDARD_BUTTON_NAMES } from '../config/controlsConfig.js';

const f2 = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);

/**
 * Live readout of the raw Gamepad API state: every button (with analog value), every axis,
 * the two sticks with the dead-zone ring, and measured idle drift. Used inside the
 * controller setup screen and as a toggleable overlay (F3) while playing.
 */
export class ControllerDebugPanel {
  constructor({ overlay = false } = {}) {
    this.overlay = overlay;
    this.title = h('div.dbg-title');
    this.buttonsEl = h('div.dbg-buttons');
    this.axesEl = h('div.dbg-axes');
    this.stickL = this.#stick('Left stick');
    this.stickR = this.#stick('Right stick');
    this.driftEl = h('div.dbg-drift');
    this.triggerEl = h('div.dbg-triggers');
    this.el = h(
      `div.dbg${overlay ? '.dbg-overlay' : ''}`,
      overlay ? h('div.dbg-head', 'Controller debug (F3)') : null,
      this.title,
      h('div.dbg-sticks', this.stickL.el, this.stickR.el),
      this.driftEl,
      this.triggerEl,
      h('div.dbg-sub', 'Buttons'),
      this.buttonsEl,
      h('div.dbg-sub', 'Axes'),
      this.axesEl,
    );
    if (overlay) this.el.hidden = true;
    this.cells = [];
    this.axisRows = [];
    this.trigRows = [];
    this.restMax = 0;
    this.restSamples = [];
    this.baseAxes = null;
    this.moved = [];
  }

  #stick(label) {
    const dot = h('i.dot');
    const ring = h('i.ring');
    const val = h('span.sval', '+0.00 / +0.00');
    const lab = h('div.stick-label', label);
    const el = h('div.stick', h('div.stick-pad', ring, h('i.cross'), dot), lab, val);
    return { el, dot, ring, val, label: lab };
  }

  #build(snap) {
    this.buttonsEl.replaceChildren();
    this.cells = [];
    const std = snap.mapping === 'standard';
    snap.buttons.forEach((_, i) => {
      const fill = h('i');
      const name = std && STANDARD_BUTTON_NAMES[i] ? STANDARD_BUTTON_NAMES[i] : String(i);
      const el = h('div.dbtn', { title: `Button ${i}` }, fill, h('span', name));
      this.buttonsEl.append(el);
      this.cells.push({ el, fill });
    });
    this.axesEl.replaceChildren();
    this.axisRows = [];
    snap.axes.forEach((_, i) => {
      const bar = h('i');
      const num = h('span.anum', '+0.00');
      const el = h('div.daxis', h('span.aname', `Axis ${i}`), h('div.abar', bar), num);
      this.axesEl.append(el);
      this.axisRows.push({ el, bar, num });
    });
    this.triggerEl.replaceChildren();
    this.trigRows = [];
    // triggers: standard pads expose them as buttons 6/7 with analog values
    if (std && snap.buttons.length > 7) {
      for (const [idx, name] of [[6, 'LT'], [7, 'RT']]) {
        const bar = h('i');
        const num = h('span.anum', '0.00');
        const el = h('div.dtrig', h('span.aname', name), h('div.abar', bar), num);
        this.triggerEl.append(el);
        this.trigRows.push({ idx, bar, num });
      }
    }
    this.builtFor = `${snap.id}|${snap.buttons.length}|${snap.axes.length}|${snap.mapping}`;
  }

  /** @param snap result of GamepadInput.snapshot() or null */
  update(snap, info, { deadZone = 0.16, moveStick = null } = {}) {
    if (!snap) {
      this.title.textContent = 'No controller detected';
      this.buttonsEl.replaceChildren();
      this.axesEl.replaceChildren();
      this.triggerEl.replaceChildren();
      this.builtFor = null;
      this.driftEl.textContent = '';
      return;
    }
    const key = `${snap.id}|${snap.buttons.length}|${snap.axes.length}|${snap.mapping}`;
    if (this.builtFor !== key) this.#build(snap);
    this.title.textContent = `${snap.id || 'Unknown controller'}  ·  mapping: ${snap.mapping || 'none reported'}`;

    for (let i = 0; i < snap.buttons.length; i++) {
      const b = snap.buttons[i];
      const c = this.cells[i];
      c.el.classList.toggle('down', b.pressed);
      c.fill.style.transform = `scaleY(${b.value})`;
    }
    for (let i = 0; i < snap.axes.length; i++) {
      const v = snap.axes[i];
      const r = this.axisRows[i];
      // hat switches report values beyond ±1; clamp the bar but show the number
      const bv = Math.max(-1, Math.min(1, v));
      r.bar.style.transform = `translateX(${bv * 50}%)`;
      r.num.textContent = f2(v);
      r.el.classList.toggle('active', Math.abs(bv) > deadZone && Math.abs(v) <= 1.05);
    }
    for (const t of this.trigRows) {
      const b = snap.buttons[t.idx];
      t.bar.style.transform = `scaleX(${b.value})`;
      t.num.textContent = b.value.toFixed(2);
    }

    // sticks: left = bound movement stick (else axes 0/1), right = axes 2/3 (or the next pair)
    const lx = moveStick ? moveStick.xAxis : 0;
    const ly = moveStick ? moveStick.yAxis : 1;
    const l = [snap.axes[lx] ?? 0, snap.axes[ly] ?? 0];
    if (moveStick?.invertX) l[0] = -l[0];
    if (moveStick?.invertY) l[1] = -l[1];
    // Right stick: learn which two axes (other than the left stick and hat switches) actually move.
    if (!this.baseAxes || this.baseAxes.length !== snap.axes.length) {
      this.baseAxes = snap.axes.slice();
      this.moved = [];
    }
    for (let i = 0; i < snap.axes.length; i++) {
      const v = snap.axes[i];
      if (i === lx || i === ly || Math.abs(this.baseAxes[i]) > 1.2) continue;
      if (Math.abs(v - this.baseAxes[i]) > 0.35 && !this.moved.includes(i)) this.moved.push(i);
    }
    let rx = this.moved[0] ?? (lx === 2 || ly === 3 ? 0 : 2);
    let ry = this.moved[1] ?? (lx === 2 || ly === 3 ? 1 : 3);
    this.stickR.label.textContent = this.moved.length ? `Right stick (axes ${rx} / ${ry})` : 'Right stick (move it)';
    const r = [snap.axes[rx] ?? 0, snap.axes[ry] ?? 0];
    this.#paintStick(this.stickL, l[0], l[1], deadZone);
    this.#paintStick(this.stickR, r[0], r[1], deadZone);

    // idle drift: highest stick magnitude while the stick is roughly at rest
    const mag = Math.hypot(l[0], l[1]);
    if (mag < 0.4) {
      this.restSamples.push(mag);
      if (this.restSamples.length > 120) this.restSamples.shift();
      this.restMax = Math.max(...this.restSamples);
    }
    const ok = this.restMax < deadZone;
    this.driftEl.className = `dbg-drift ${ok ? 'ok' : 'bad'}`;
    this.driftEl.textContent = `Stick drift at rest: ${this.restMax.toFixed(3)} — ${
      ok ? 'inside the dead zone, no phantom movement' : `above the dead zone (${deadZone.toFixed(2)}). Raise the dead zone to at least ${(this.restMax + 0.03).toFixed(2)}`
    }`;
  }

  #paintStick(s, x, y, dz) {
    const cx = Math.max(-1.2, Math.min(1.2, x));
    const cy = Math.max(-1.2, Math.min(1.2, y));
    s.dot.style.left = `${50 + cx * 41}%`;
    s.dot.style.top = `${50 + cy * 41}%`;
    s.ring.style.width = s.ring.style.height = `${dz * 82}%`;
    s.val.textContent = `${f2(x)} / ${f2(y)}`;
    const out = Math.hypot(x, y) > dz;
    s.dot.classList.toggle('live', out);
  }

  resetDrift() {
    this.baseAxes = null;
    this.moved = [];
    this.restSamples.length = 0;
    this.restMax = 0;
  }

  setVisible(v) {
    this.el.hidden = !v;
  }
}
