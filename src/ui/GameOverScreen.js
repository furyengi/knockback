import { Screen } from './Screen.js';
import { h } from './dom.js';

export class GameOverScreen extends Screen {
  constructor(ui) {
    super(ui, 'gameover');
  }

  build() {
    const ui = this.ui;
    this.causeEl = h('div.go-kicker');
    this.scoreEl = h('div.go-score');
    this.newEl = h('div.go-new', 'New best!');
    this.statsEl = h('div.go-stats');
    const btn = (label, sub, fn) => {
      const el = h('button.menu-btn', { type: 'button', tabindex: -1 }, h('span.label', label), h('span.sub', sub), h('span.chev', '›'));
      this.addItem(el, { activate: fn });
      return el;
    };
    this.el.append(
      h('div.panel-shade.dim'),
      h(
        'div.panel.go-panel',
        this.causeEl,
        h('h2.go-title', 'Game over'),
        this.scoreEl,
        this.newEl,
        this.statsEl,
        h('nav.menu-list', btn('Play again', 'Instant restart', () => ui.game.restart()), btn('Main menu', 'Back to the title', () => ui.game.quitToMenu())),
      ),
      h('footer.menu-foot', ui.hintBar(['nav', ['confirm', 'Select']])),
    );
  }

  onOpen(d) {
    this.causeEl.textContent = d.cause === 'ringout' ? 'You were knocked off the roof' : 'You were knocked out';
    this.scoreEl.textContent = d.score.toLocaleString('en-US');
    this.newEl.hidden = !d.newBest;
    const stat = (k, v) => h('div.stat', h('em', k), h('b', v));
    this.statsEl.replaceChildren(
      stat('Wave reached', d.wave),
      stat('Best wave', d.best.wave),
      stat('Best score', d.best.score.toLocaleString('en-US')),
      stat('Ring-outs', d.ringOuts),
      stat('Best combo', d.bestCombo),
      stat('Perfect blocks', d.perfectBlocks),
    );
    this.select(0);
  }

  onBack() {
    /* confirm one of the two options */
  }
}
