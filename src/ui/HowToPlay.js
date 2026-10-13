import { Screen } from './Screen.js';
import { h } from './dom.js';

export class HowToPlay extends Screen {
  constructor(ui) {
    super(ui, 'howto');
  }

  build() {
    const ui = this.ui;
    const row = (action, name, text) =>
      h('li', h('kbd.prompt', { 'data-prompt': action }, ui.promptText(action)), h('div', h('b', name), h('p', text)));
    const enemy = (cls, name, text) => h('li.enemy-row', h(`i.swatch.${cls}`), h('div', h('b', name), h('p', text)));
    const back = h('button.menu-btn.slim', { type: 'button', tabindex: -1 }, h('span.label', 'Back'), h('span.chev', '›'));
    this.addItem(back, { activate: () => this.onBack() });
    this.el.append(
      h('div.panel-shade'),
      h(
        'div.panel.wide',
        h('h2.panel-title', 'How to play'),
        h('p.lead', 'Knock every enemy off the rooftop and stay on it yourself. Position, timing and the edge win fights, not button mashing.'),
        h(
          'div.cols',
          h(
            'section',
            h('h3', 'Your moves'),
            h(
              'ul.moves',
              row('move', 'Move', 'Arena-relative: up always means away from the camera.'),
              row('lightAttack', 'Light punch', 'Fast, safe, small knockback. Chain three for a harder finisher.'),
              row('heavyAttack', 'Heavy smash', 'Slow wind-up, huge knockback. Costs stamina and leaves you open.'),
              row('dodge', 'Dodge', 'Burst in the stick direction with a brief invulnerable window. Dodging through an attack is rewarded.'),
              row('block', 'Block (hold)', 'Soaks knockback from the front. Raise it just before a hit lands for a PERFECT block that staggers them.'),
            ),
          ),
          h(
            'section',
            h('h3', 'Know your enemies'),
            h(
              'ul.moves',
              enemy('runner', 'Runner', 'Fast and light. Circles you, then dives in. Easy to launch, hard to pin down.'),
              enemy('guard', 'Guard', 'Blocks from the front. Flank it or break the guard with a smash. Attacks leave it open.'),
              enemy('bruiser', 'Bruiser', 'Huge and armoured. Watch the orange warning on the floor, then dodge. Never fight it with your back to the edge.'),
            ),
            h('h3.tight', 'Tips'),
            h(
              'ul.tips',
              h('li', 'Orange zones on the floor show where an enemy attack will land.'),
              h('li', 'Low-health enemies fly farther. Drained to zero they are dazed: smash them off.'),
              h('li', 'Launch an enemy into others to bowl them off the roof for a bonus.'),
              h('li', 'Stamina refills when you stop spending it. Don’t swing on empty.'),
            ),
          ),
        ),
        back,
      ),
      h('footer.menu-foot', ui.hintBar(['nav', ['confirm', 'Back'], ['cancel', 'Back']])),
    );
  }
}
