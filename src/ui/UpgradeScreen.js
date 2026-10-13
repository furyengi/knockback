import { Screen } from './Screen.js';
import { h } from './dom.js';

const GLYPHS = {
  heavyHands: '✊',
  quickFeet: '➤',
  ironGuard: '◈',
  steadyBreath: '❀',
  secondWind: '✚',
};

export class UpgradeScreen extends Screen {
  constructor(ui) {
    super(ui, 'upgrade', { layout: 'horizontal' });
  }

  build() {
    this.titleEl = h('h2.panel-title', 'Wave cleared');
    this.subEl = h('p.lead');
    this.cardsEl = h('div.cards', { role: 'menu' });
    this.el.append(
      h('div.panel-shade.dim'),
      h('div.panel.cards-panel', this.titleEl, this.subEl, this.cardsEl),
      h('footer.menu-foot', this.ui.hintBar(['nav', ['confirm', 'Take upgrade']])),
    );
    // number keys pick directly
    this._keys = (e) => {
      if (!this.isOpen) return;
      const n = Number(e.key);
      if (n >= 1 && n <= this.items.length) {
        this.select(n - 1, true);
        this.activate();
      }
    };
    window.addEventListener('keydown', this._keys);
  }

  onOpen(data) {
    this.resetItems();
    this.cardsEl.replaceChildren();
    this.titleEl.textContent = `Wave ${data.wave} cleared`;
    const parts = [`+${data.bonus.toLocaleString('en-US')} points`];
    if (data.flawless) parts.push('flawless!');
    if (data.healed) parts.push(`+${data.healed} HP`);
    this.subEl.textContent = `${parts.join(' · ')} — pick one upgrade for the next wave`;
    data.options.forEach((o, i) => {
      const card = h(
        'button.card',
        { type: 'button', tabindex: -1, 'aria-label': `${o.name}. ${o.desc}` },
        h('span.card-num', String(i + 1)),
        h('span.card-glyph', GLYPHS[o.id] || '★'),
        h('span.card-tag', o.tag),
        h('span.card-name', o.name),
        h('span.card-desc', o.desc),
        h('span.card-level', o.level > 1 ? `Level ${o.level} / ${o.max}` : `New · max ${o.max}`),
      );
      this.cardsEl.append(card);
      this.addItem(card, { activate: () => this.ui.game.pickUpgrade(o.id) });
    });
    this.select(0);
  }

  // Up/down also move between cards for players who expect it
  navigate(dx, dy) {
    super.navigate(dx || dy, 0);
  }

  dispose() {
    window.removeEventListener('keydown', this._keys);
  }

  onBack() {
    /* an upgrade must be chosen */
  }
}
