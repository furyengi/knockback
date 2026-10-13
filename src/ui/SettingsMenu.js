import { Screen } from './Screen.js';
import { h } from './dom.js';

export class SettingsMenu extends Screen {
  constructor(ui) {
    super(ui, 'settings');
  }

  build() {
    const ui = this.ui;
    const S = ui.settings;

    const slider = (label, get, set, step = 0.1) => {
      const fill = h('i');
      const val = h('span.val');
      const track = h('div.track', fill);
      const el = h('div.setting', h('span.name', label), track, val);
      const paint = () => {
        const v = get();
        fill.style.transform = `scaleX(${v})`;
        val.textContent = `${Math.round(v * 100)}%`;
      };
      const adjust = (d) => {
        set(Math.max(0, Math.min(1, get() + d * step)));
        paint();
      };
      track.addEventListener('click', (e) => {
        const r = track.getBoundingClientRect();
        set(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
        paint();
      });
      this.addItem(el, { adjust, activate: () => adjust(1) });
      el.paint = paint;
      return el;
    };

    const toggle = (label, get, set, hint = '') => {
      const state = h('span.val');
      const sw = h('span.switch', h('i'));
      const el = h('div.setting', h('span.name', label, hint ? h('small', hint) : null), sw, state);
      const paint = () => {
        const v = get();
        el.classList.toggle('on', v);
        state.textContent = v ? 'On' : 'Off';
      };
      const flip = () => {
        set(!get());
        paint();
      };
      this.addItem(el, { activate: flip, adjust: flip });
      el.paint = paint;
      return el;
    };

    this.rows = [
      slider('Volume', () => S.volume, (v) => ui.audio.setVolume(v)),
      toggle('Mute', () => S.muted, (v) => ui.audio.setMuted(v)),
      slider('Camera impact', () => S.shake, (v) => ui.game.setShake(v), 0.1),
      toggle('Controller vibration', () => ui.bindings.vibration, (v) => (ui.bindings.vibration = v), 'If your controller supports it'),
      toggle('Shadows', () => S.shadows, (v) => ui.game.setShadows(v), 'Turn off if the game runs slowly'),
    ];
    const back = h('button.menu-btn.slim', { type: 'button', tabindex: -1 }, h('span.label', 'Back'), h('span.chev', '›'));
    this.addItem(back, { activate: () => this.onBack() });
    this.el.append(
      h('div.panel-shade'),
      h('div.panel', h('h2.panel-title', 'Settings'), h('div.settings', ...this.rows), back),
      h('footer.menu-foot', ui.hintBar(['nav', ['confirm', 'Change'], ['cancel', 'Back']])),
    );
  }

  onOpen() {
    this.rows.forEach((r) => r.paint());
    this.select(0);
  }
}
