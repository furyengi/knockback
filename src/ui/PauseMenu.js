import { Screen } from './Screen.js';
import { h } from './dom.js';

export class PauseMenu extends Screen {
  constructor(ui) {
    super(ui, 'pause');
  }

  build() {
    const ui = this.ui;
    const btn = (label, sub, fn) => {
      const el = h('button.menu-btn', { type: 'button', tabindex: -1 }, h('span.label', label), h('span.sub', sub), h('span.chev', '›'));
      this.addItem(el, { activate: fn });
      return el;
    };
    this.reasonEl = h('p.lead.pause-reason');
    this.el.append(
      h('div.panel-shade.dim'),
      h(
        'div.panel.narrow',
        h('h2.panel-title', 'Paused'),
        this.reasonEl,
        h(
          'nav.menu-list',
          btn('Resume', 'Back to the fight', () => ui.game.resume()),
          btn('Restart', 'Start a fresh run', () => ui.game.restart()),
          btn('Controller setup', 'Bindings & calibration', () => ui.open('controller')),
          btn('Settings', 'Sound, camera, quality', () => ui.open('settings')),
          btn('Quit to menu', 'Abandon this run', () => ui.game.quitToMenu()),
        ),
      ),
      h('footer.menu-foot', ui.hintBar(['nav', ['confirm', 'Select'], ['pause', 'Resume']])),
    );
  }

  onOpen(data) {
    this.reasonEl.textContent = data?.reason || '';
    this.reasonEl.hidden = !data?.reason;
    this.select(0);
  }

  onBack() {
    this.ui.game.resume();
  }

  handleExtra(frame) {
    if (frame.pressed.pause) this.ui.game.resume();
  }
}
