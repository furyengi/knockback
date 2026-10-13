import { Screen } from './Screen.js';
import { h } from './dom.js';
import { ControllerDebugPanel } from './ControllerDebugPanel.js';
import { ACTION_LIST, WIZARD_ORDER, INPUT_DEFAULTS } from '../config/controlsConfig.js';
import { shorten } from './MainMenu.js';

const LABELS = Object.fromEntries(ACTION_LIST.map((a) => [a.id, a.label]));

/**
 * Controller status, live diagnostics, dead-zone, vibration test and per-action rebinding.
 * Everything is reachable with the keyboard OR the controller. While a binding is being
 * captured the pad stops driving the game (see GamepadInput.capture) and Esc cancels.
 */
export class ControllerSetup extends Screen {
  constructor(ui) {
    super(ui, 'controller');
    this.capturing = null; // {kind:'action'|'move-x'|'move-y', action?, rowEl}
    this.wizard = null; // {steps:[], i}
    this.tmpMove = null;
  }

  get gp() {
    return this.ui.input.gamepad;
  }

  build() {
    const ui = this.ui;
    this.debug = new ControllerDebugPanel();
    this.statusPill = h('span.pill');
    this.nameEl = h('div.dev-name');
    this.metaEl = h('div.dev-meta');
    this.noteEl = h('div.dev-note');
    this.helpEl = h('div.dev-help');
    this.wizardEl = h('div.wizard', { hidden: true, 'aria-live': 'assertive' });

    const action = (label, sub, fn, cls = '') => {
      const el = h(`button.setup-btn${cls}`, { type: 'button', tabindex: -1 }, h('span.label', label), h('span.sub', sub));
      this.addItem(el, { activate: fn });
      return el;
    };

    this.btnGuided = action('Guided setup', 'Walk through every action', () => this.startWizard());
    this.btnStd = action('Use standard layout', 'Treat this controller like an Xbox pad', () => this.useStandard());
    this.btnReset = action('Reset to defaults', 'Clear custom bindings', () => this.reset());

    // dead zone slider
    this.dzFill = h('i');
    this.dzVal = h('span.val');
    const dzTrack = h('div.track', this.dzFill);
    this.dzRow = h('div.setting', h('span.name', 'Dead zone', h('small', 'Ignores small stick movements (drift)')), dzTrack, this.dzVal);
    const dzAdjust = (d) => {
      ui.bindings.deadZone = ui.bindings.deadZone + d * 0.01;
      this.paintDeadZone();
    };
    dzTrack.addEventListener('click', (e) => {
      const r = dzTrack.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      ui.bindings.deadZone = INPUT_DEFAULTS.deadZoneMin + t * (INPUT_DEFAULTS.deadZoneMax - INPUT_DEFAULTS.deadZoneMin);
      this.paintDeadZone();
    });
    this.addItem(this.dzRow, { adjust: dzAdjust, activate: () => dzAdjust(1) });

    // vibration
    this.vibVal = h('span.val');
    this.vibRow = h('div.setting', h('span.name', 'Vibration', h('small', 'Hits, blocks, ring-outs')), h('span.switch', h('i')), this.vibVal);
    const flipVib = () => {
      ui.bindings.vibration = !ui.bindings.vibration;
      this.paintVibration();
    };
    this.addItem(this.vibRow, { activate: flipVib, adjust: flipVib });
    this.btnRumble = action('Test vibration', 'Buzz the controller if it supports it', () => this.testRumble());

    // binding rows
    this.rows = {};
    const rowsEl = h('div.bind-list');
    const moveRow = this.#bindRow('move', 'Move (left stick)', rowsEl);
    this.rows.move = moveRow;
    for (const a of ACTION_LIST) this.rows[a.id] = this.#bindRow(a.id, a.label, rowsEl);

    const back = h('button.menu-btn.slim', { type: 'button', tabindex: -1 }, h('span.label', 'Back'), h('span.chev', '›'));
    this.addItem(back, { activate: () => this.onBack() });

    this.el.append(
      h('div.panel-shade'),
      h(
        'div.panel.setup',
        h('header.setup-head', h('h2.panel-title', 'Controller setup'), this.statusPill),
        h(
          'div.setup-grid',
          h('div.setup-col', h('div.card.device', this.nameEl, this.metaEl, this.noteEl, this.helpEl), h('div.card.live', this.debug.el)),
          h(
            'div.setup-col',
            h('div.card.controls', h('div.btn-row', this.btnGuided, this.btnStd, this.btnReset), this.dzRow, h('div.vib-row', this.vibRow, this.btnRumble)),
            h('div.card.bindings', h('h3', 'Bindings'), rowsEl),
            back,
          ),
        ),
        this.wizardEl,
      ),
      h('footer.menu-foot', ui.hintBar(['nav', ['confirm', 'Select / rebind'], ['cancel', 'Back']])),
    );
    this.backItem = back;
  }

  #bindRow(id, label, parent) {
    const value = h('span.bval');
    const state = h('span.bstate', 'Rebind');
    const el = h('button.bind-row', { type: 'button', tabindex: -1, 'data-action': id }, h('span.bname', label), value, state);
    parent.append(el);
    this.addItem(el, { activate: () => this.startRebind(id, el) });
    return { el, value, state };
  }

  onOpen(data) {
    this.cancelAll();
    this.debug.resetDrift();
    this.paintDeadZone();
    this.paintVibration();
    this.select(0);
    this.ui.captureBlocking = () => !!this.capturing;
    // A controller with an unknown layout cannot navigate menus yet, so when setup was opened
    // automatically (the player pressed a button) walk them through the mapping straight away.
    if (data?.autoWizard && this.gp.connected && !this.gp.info.configured) this.startWizard();
  }

  onClose() {
    this.cancelAll();
    this.ui.captureBlocking = null;
  }

  onResume() {
    this.ui.captureBlocking = () => !!this.capturing;
  }

  // ---- painting -------------------------------------------------------------

  paintDeadZone() {
    const dz = this.ui.bindings.deadZone;
    const t = (dz - INPUT_DEFAULTS.deadZoneMin) / (INPUT_DEFAULTS.deadZoneMax - INPUT_DEFAULTS.deadZoneMin);
    this.dzFill.style.transform = `scaleX(${Math.max(0, Math.min(1, t))})`;
    this.dzVal.textContent = dz.toFixed(2);
  }

  paintVibration() {
    const on = this.ui.bindings.vibration;
    this.vibRow.classList.toggle('on', on);
    this.vibVal.textContent = on ? 'On' : 'Off';
  }

  update(dt, frame) {
    const gp = this.gp;
    const info = gp.info;
    const pad = gp.pad;
    const resolved = pad ? this.ui.bindings.resolve(pad) : null;

    // status
    this.statusPill.className = `pill ${info.connected ? (info.configured ? 'ok' : 'warn') : 'off'}`;
    this.statusPill.textContent = !info.connected ? 'Not connected' : info.configured ? 'Connected' : 'Needs setup';
    this.nameEl.textContent = info.connected ? shorten(info.id) || 'Unnamed controller' : 'No controller detected';
    this.metaEl.textContent = info.connected
      ? `Mapping: ${info.mapping === 'standard' ? 'standard' : 'non-standard / unknown'} · ${info.buttons} buttons · ${info.axes} axes · slot ${info.index}${info.count > 1 ? ` · ${info.count} controllers (using the active one)` : ''}`
      : '—';
    if (!info.connected) {
      this.noteEl.textContent = 'Press any button on your controller. Browsers only reveal a controller after it is used.';
      this.helpEl.textContent =
        'Nothing showing? Make sure the wireless dongle is plugged in and the controller is switched on, then check it responds in Windows (Win+R → joy.cpl). Try Chrome or Edge; if the controller has an X/D mode switch, try the other mode.';
    } else if (!info.configured) {
      this.noteEl.textContent = 'This controller does not report the standard layout, so Knockback will not guess. Run Guided setup, or pick Use standard layout if its buttons match an Xbox pad.';
      this.helpEl.textContent = '';
    } else {
      this.noteEl.textContent = info.custom ? 'Using your custom bindings.' : 'Using the standard layout defaults. Rebind anything you like.';
      this.helpEl.textContent = '';
    }

    // availability
    this.items.find((i) => i.el === this.btnGuided).disabled = !info.connected;
    this.items.find((i) => i.el === this.btnRumble).disabled = !info.connected || !gp.supportsRumble;
    this.items.find((i) => i.el === this.btnStd).disabled = !info.connected || info.standard;
    this.items.find((i) => i.el === this.btnReset).disabled = !info.connected;
    for (const el of [this.btnGuided, this.btnRumble, this.btnStd, this.btnReset]) {
      const it = this.items.find((i) => i.el === el);
      el.classList.toggle('disabled', !!it.disabled);
    }
    for (const a of ['move', ...ACTION_LIST.map((x) => x.id)]) {
      const it = this.items.find((i) => i.el === this.rows[a].el);
      if (it) {
        it.disabled = !info.connected;
        it.el.classList.toggle('disabled', !info.connected);
      }
      this.rows[a].value.textContent = info.connected ? this.ui.bindings.describe(pad, a) : '—';
    }

    this.debug.update(gp.snapshot(), info, { deadZone: this.ui.bindings.deadZone, moveStick: resolved?.bindings.move || null });

    // keyboard escape hatches while capturing (the pad is suspended during capture)
    if (this.capturing || this.wizard) {
      if (frame.pressed.cancel || frame.pressed.pause) this.cancelAll(true);
      else if (this.wizard && (frame.pressed.confirm || frame.nav.x > 0)) this.skipStep();
    }
  }

  // ---- actions ---------------------------------------------------------------

  testRumble() {
    this.gp.rumble(1, 0.8, 300);
    this.ui.toast(this.gp.supportsRumble ? 'Vibration sent' : 'This controller does not report vibration support');
  }

  useStandard() {
    if (!this.gp.pad) return;
    this.ui.bindings.applyStandardGuess(this.gp.pad);
    this.ui.toast('Standard layout applied. Check the live buttons to make sure they match.');
  }

  reset() {
    if (!this.gp.pad) return;
    this.ui.bindings.resetToDefaults(this.gp.pad);
    this.ui.toast('Bindings reset');
  }

  // ---- rebinding -------------------------------------------------------------

  startRebind(action, rowEl) {
    if (!this.gp.connected) {
      this.ui.toast('Connect a controller first');
      return;
    }
    if (action === 'move') {
      this.wizard = { steps: [{ kind: 'move-x' }, { kind: 'move-y' }], i: 0, single: true };
      this.runStep();
      return;
    }
    this.wizard = { steps: [{ kind: 'action', action }], i: 0, single: true };
    this.runStep();
  }

  startWizard() {
    if (!this.gp.connected) return;
    const steps = [{ kind: 'move-x' }, { kind: 'move-y' }, ...WIZARD_ORDER.map((a) => ({ kind: 'action', action: a }))];
    this.wizard = { steps, i: 0, single: false };
    this.tmpMove = null;
    this.runStep();
  }

  runStep() {
    const w = this.wizard;
    if (!w) return;
    const step = w.steps[w.i];
    if (!step) {
      this.finishWizard();
      return;
    }
    this.capturing = step;
    this.ui.captureBlocking = () => !!this.capturing;
    this.ui.input.flush();
    const total = w.steps.length;
    let title;
    let body;
    if (step.kind === 'move-x') {
      title = 'Movement stick';
      body = 'Push the stick you want to MOVE with fully to the RIGHT and hold it. No working analog stick? Press any button to skip and move with the D-pad.';
    } else if (step.kind === 'move-y') {
      title = 'Movement stick';
      body = 'Now push the same stick fully UP and hold it.';
    } else {
      title = LABELS[step.action];
      body = `Press the button, trigger or direction for ${LABELS[step.action].toUpperCase()}.`;
    }
    this.wizardEl.hidden = false;
    this.wizardEl.replaceChildren(
      h('div.wiz-step', w.single ? 'Rebind' : `Step ${w.i + 1} of ${total}`),
      h('div.wiz-title', title),
      h('div.wiz-body', body),
      h('div.wiz-keys', h('kbd', 'Esc'), ' cancel', w.single ? null : [h('kbd', 'Enter'), ' skip this step']),
    );
    this.rows[step.action || 'move']?.el.classList.add('listening');
    this.gp.startCapture({
      // The first stick step also accepts a button/D-pad press, meaning "this pad has no analog stick".
      mode: step.kind === 'action' ? 'button' : step.kind === 'move-x' ? 'stick' : 'axis',
      timeout: 25,
      onCapture: (b) => this.onCaptured(step, b),
      onCancel: (reason) => this.onCaptureCancel(reason),
    });
  }

  onCaptured(step, b) {
    const pad = this.gp.pad;
    const bindings = this.ui.bindings;
    if (step.kind === 'move-x' && b.type !== 'axis') {
      // Button / D-pad pressed instead of a stick: the pad is probably in digital mode. Skip the stick
      // steps; the D-pad (bound later in this setup) will move the fighter.
      this.tmpMove = null;
      this.ui.toast('No analog stick found, so the D-pad will move you. Switch the pad to analog mode (ANALOG button) and re-run setup for stick control.');
      if (this.wizard) this.wizard.i++; // also skip the vertical step
    } else if (step.kind === 'move-x') {
      this.tmpMove = { xAxis: b.index, invertX: b.dir < 0 };
    } else if (step.kind === 'move-y') {
      if (this.tmpMove && b.index === this.tmpMove.xAxis) {
        this.ui.toast('That is the same axis as before. Push the stick UP.', 'warn');
        this.runStep();
        return;
      }
      // standard: up reads negative, so a positive reading when pushing UP means inverted
      if (this.tmpMove) {
        bindings.setMove(pad, { type: 'stick', xAxis: this.tmpMove.xAxis, yAxis: b.index, invertX: this.tmpMove.invertX, invertY: b.dir > 0 });
      }
      this.tmpMove = null;
    } else {
      const clean = { ...b };
      delete clean.raw;
      bindings.setSources(pad, step.action, [clean]);
    }
    this.advance();
  }

  advance() {
    const w = this.wizard;
    this.clearListening();
    if (!w) return;
    w.i++;
    // Short pause so the user releases the input before the next capture arms.
    this.capturing = null;
    if (w.i >= w.steps.length) this.finishWizard();
    else this.runStep();
  }

  skipStep() {
    this.gp.cancelCapture('skip');
  }

  onCaptureCancel(reason) {
    if (!this.wizard) return;
    if (reason === 'skip') {
      this.advance();
      return;
    }
    if (reason === 'replaced') return;
    if (reason === 'timeout') this.ui.toast('Timed out waiting for input', 'warn');
    if (reason === 'disconnected') this.ui.toast('Controller disconnected', 'warn');
    this.cancelAll(false);
  }

  finishWizard() {
    const single = this.wizard?.single;
    this.cancelAll(false);
    this.ui.toast(single ? 'Binding saved' : 'Controller configured and saved');
    this.ui.audio?.play('uiSelect');
  }

  clearListening() {
    for (const r of Object.values(this.rows)) r.el.classList.remove('listening');
  }

  cancelAll(announce = false) {
    this.wizard = null;
    this.capturing = null;
    this.tmpMove = null;
    this.gp.capture = null; // drop silently, we are tearing the wizard down
    this.wizardEl.hidden = true;
    this.clearListening();
    this.ui.captureBlocking = this.isOpen ? () => !!this.capturing : null;
    this.ui.input.flush();
    if (announce) this.ui.toast('Cancelled');
  }

  onBack() {
    if (this.capturing || this.wizard) {
      this.cancelAll(true);
      return;
    }
    this.ui.audio?.play('uiBack');
    this.ui.back();
  }
}
