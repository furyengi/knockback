import { Screen } from './Screen.js';
import { h } from './dom.js';

export class MainMenu extends Screen {
  constructor(ui) {
    super(ui, 'main');
  }

  build() {
    const ui = this.ui;
    this.bestEl = h('div.best');
    this.padEl = h('div.padchip');
    const btn = (label, sub, fn) => {
      const el = h('button.menu-btn', { type: 'button', tabindex: -1 }, h('span.label', label), h('span.sub', sub), h('span.chev', '›'));
      this.addItem(el, { activate: fn });
      return el;
    };
    this.list = h(
      'nav.menu-list',
      { 'aria-label': 'Main menu' },
      btn('Play', 'Survive the rooftop', () => ui.game.startRun()),
      btn('How to play', 'Rules, moves, enemies', () => ui.open('howto')),
      btn('Controller setup', 'Bind buttons, calibrate sticks', () => ui.open('controller')),
      btn('Settings', 'Sound, camera, quality', () => ui.open('settings')),
    );
    this.el.append(
      h('div.menu-shade'),
      h(
        'div.menu-col',
        h(
          'header.brand',
          h('div.brand-kicker', 'Rooftop arena brawler'),
          h('h1.brand-title', h('span.l1', 'Knock'), h('span.l2', 'back')),
          h('div.hazard-bar'),
        ),
        this.list,
        this.bestEl,
      ),
      h('footer.menu-foot', this.padEl, ui.hintBar(['nav', ['confirm', 'Select']])),
    );
  }

  onOpen() {
    const b = this.ui.game.best;
    this.bestEl.replaceChildren(
      h('span', h('em', 'Best score'), h('b', b.score ? b.score.toLocaleString('en-US') : '—')),
      h('span', h('em', 'Best wave'), h('b', b.wave || '—')),
    );
    this.select(0);
  }

  update() {
    const info = this.ui.input.gamepad.info;
    let text;
    let cls = '';
    if (!info.connected) {
      text = 'No controller — press any button on it to connect';
      cls = 'off';
    } else if (!info.configured) {
      text = `${shorten(info.id)} — layout unknown, open Controller setup`;
      cls = 'warn';
    } else {
      text = `${shorten(info.id)} · ${info.mapping}`;
      cls = 'on';
    }
    if (this.padEl.dataset.t !== text) {
      this.padEl.dataset.t = text;
      this.padEl.className = `padchip ${cls}`;
      this.padEl.replaceChildren(h('i'), h('span', text));
    }
  }
}

export function shorten(id) {
  if (!id) return '';
  return id.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 42) || id.slice(0, 42);
}
