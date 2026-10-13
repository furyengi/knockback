import * as THREE from 'three';
import { h, clear } from './dom.js';
import { CONFIG } from '../config/gameConfig.js';
import { STATE } from '../entities/Character.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const _v = new THREE.Vector3();

/**
 * In-game overlay: wave, enemies, score + combo, health & stamina, upgrade chips,
 * control hints, floating score text, enemy health pips and big wave banners.
 * It is deliberately slim and sits on the screen edges so the arena stays clear.
 */
export class HUD {
  constructor(root, ui) {
    this.ui = ui;
    this.root = root;
    this.el = h('div.hud', { hidden: true });
    this.waveEl = h('div.hud-num', '01');
    this.remainEl = h('div.hud-num.small', '0');
    this.scoreEl = h('div.score-val', '0');
    this.comboEl = h('div.combo', { 'aria-live': 'off' });
    this.comboMult = h('span.combo-mult', 'x1');
    this.comboCount = h('span.combo-count', '');
    this.comboBar = h('i');
    this.comboEl.append(this.comboMult, this.comboCount, h('div.combo-timer', this.comboBar));
    this.hpFill = h('i');
    this.hpGhost = h('i.ghost');
    this.hpText = h('span.bar-text', '100');
    this.stFill = h('i');
    this.stSegs = h('div.segs');
    this.upgradesEl = h('div.upchips');
    this.hintEl = h('div.hint-bar');
    this.floaters = h('div.floaters');
    this.enemyBars = h('div.enemy-bars');
    this.banner = h('div.banner', { 'aria-live': 'assertive' });
    this.callout = h('div.callout');
    this.damageVignette = h('div.vignette');

    const left = h(
      'div.hud-left',
      h('div.chip', h('span.chip-label', 'Wave'), this.waveEl),
      h('div.chip.alt', h('span.chip-label', 'Left'), this.remainEl),
    );
    const center = h('div.hud-center', h('div.score', h('span.chip-label', 'Score'), this.scoreEl), this.comboEl);
    const right = h('div.hud-right', h('div.pause-hint', h('kbd.prompt', { 'data-prompt': 'pause' }), h('span', 'Pause')));
    const vitals = h(
      'div.vitals',
      h('div.bar-row', h('span.bar-label', 'HP'), h('div.bar.hp', this.hpGhost, this.hpFill, this.hpText)),
      h('div.bar-row', h('span.bar-label', 'STA'), h('div.bar.st', this.stFill, this.stSegs)),
      this.upgradesEl,
    );
    for (let i = 0; i < 10; i++) this.stSegs.append(h('b'));
    this.el.append(this.damageVignette, this.enemyBars, this.floaters, h('div.hud-top', left, center, right), h('div.hud-bottom', vitals, this.hintEl), this.banner, this.callout);
    root.append(this.el);

    this.last = { hp: -1, st: -1, score: -1, wave: -1, remain: -1, combo: -1, mult: -1 };
    this.ghost = 100;
    this.barPool = new Map();
    this.hintTimer = 0;
    this.bannerTimer = 0;
    this.calloutTimer = 0;
    this.stFlash = 0;
    this.upKey = '';
  }

  show() {
    this.el.hidden = false;
    this.renderHints();
    this.hintTimer = 9;
  }
  hide() {
    this.el.hidden = true;
  }

  reset() {
    this.last = { hp: -1, st: -1, score: -1, wave: -1, remain: -1, combo: -1, mult: -1 };
    this.ghost = 100;
    clear(this.floaters);
    for (const b of this.barPool.values()) b.remove();
    this.barPool.clear();
    this.banner.className = 'banner';
    this.callout.className = 'callout';
    this.upKey = '';
    this.upgradesEl.replaceChildren();
  }

  renderHints() {
    const ui = this.ui;
    clear(this.hintEl);
    const items = [
      ['move', 'Move'],
      ['lightAttack', 'Punch'],
      ['heavyAttack', 'Smash'],
      ['dodge', 'Dodge'],
      ['block', 'Block'],
    ];
    for (const [a, label] of items) {
      this.hintEl.append(h('span.hint', h('kbd.prompt', { 'data-prompt': a }, ui.promptText(a)), h('em', label)));
    }
  }

  showBanner(title, sub = '', cls = '', ms = 1700) {
    this.banner.className = `banner ${cls}`;
    this.banner.replaceChildren(h('div.banner-title', title), sub ? h('div.banner-sub', sub) : null);
    void this.banner.offsetWidth;
    this.banner.classList.add('is-on');
    this.bannerTimer = ms / 1000;
  }

  showCallout(text, cls = '') {
    this.callout.className = `callout ${cls}`;
    this.callout.textContent = text;
    void this.callout.offsetWidth;
    this.callout.classList.add('is-on');
    this.calloutTimer = 0.9;
  }

  /** Spawn floating text at a world position. */
  floater(world, text, cls = '', camera = null, size = null) {
    if (!camera) return;
    _v.set(world.x, world.y ?? 1.6, world.z).project(camera);
    if (_v.z > 1) return;
    const x = (_v.x * 0.5 + 0.5) * 100;
    const y = (-_v.y * 0.5 + 0.5) * 100;
    const el = h('div.floater', { class: cls, style: { left: `${x}%`, top: `${y}%` } }, text);
    if (size) el.style.fontSize = `${size}px`;
    this.floaters.append(el);
    setTimeout(() => el.remove(), 1100);
    while (this.floaters.children.length > 14) this.floaters.firstChild.remove();
  }

  flashDamage() {
    this.damageVignette.classList.remove('is-on');
    void this.damageVignette.offsetWidth;
    this.damageVignette.classList.add('is-on');
  }

  staminaFail() {
    this.stFlash = 0.4;
  }

  update(dt, battle, camera, canvasRect) {
    if (this.el.hidden || !battle) return;
    const p = battle.player;
    const S = battle.score;
    const W = battle.waves;

    const hp = Math.round(p.hp);
    if (hp !== this.last.hp) {
      this.last.hp = hp;
      const f = Math.max(0, p.hp / p.maxHp);
      this.hpFill.style.transform = `scaleX(${f})`;
      this.hpText.textContent = hp;
      this.hpFill.parentElement.classList.toggle('low', f < 0.3);
    }
    // ghost bar eases down behind the real value
    const target = (p.hp / p.maxHp) * 100;
    this.ghost += (target - this.ghost) * Math.min(1, dt * 3);
    this.hpGhost.style.transform = `scaleX(${Math.max(0, this.ghost / 100)})`;

    const st = Math.round(p.stamina);
    if (st !== this.last.st) {
      this.last.st = st;
      const f = p.stamina / p.maxStamina;
      this.stFill.style.transform = `scaleX(${f})`;
      const on = Math.ceil(f * 10 - 0.001);
      const kids = this.stSegs.children;
      for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < on);
    }
    if (this.stFlash > 0) {
      this.stFlash -= dt;
      this.stFill.parentElement.classList.toggle('warn', this.stFlash > 0 && Math.floor(this.stFlash * 16) % 2 === 0);
    } else this.stFill.parentElement.classList.remove('warn');

    if (S.score !== this.last.score) {
      this.last.score = S.score;
      this.scoreEl.textContent = fmt(S.score);
      this.scoreEl.classList.remove('pop');
      void this.scoreEl.offsetWidth;
      this.scoreEl.classList.add('pop');
    }
    if (W.wave !== this.last.wave) {
      this.last.wave = W.wave;
      this.waveEl.textContent = String(W.wave).padStart(2, '0');
    }
    const remain = W.state === 'countdown' ? W.total : W.remaining;
    if (remain !== this.last.remain) {
      this.last.remain = remain;
      this.remainEl.textContent = remain;
    }
    // combo
    const combo = S.combo;
    const mult = S.multiplier;
    if (combo !== this.last.combo || mult !== this.last.mult) {
      this.last.combo = combo;
      this.last.mult = mult;
      this.comboEl.classList.toggle('on', combo > 1);
      this.comboMult.textContent = `x${mult % 1 === 0 ? mult : mult.toFixed(2).replace(/0$/, '')}`;
      this.comboCount.textContent = `${combo} HITS`;
      if (combo > 1) {
        this.comboEl.classList.remove('bump');
        void this.comboEl.offsetWidth;
        this.comboEl.classList.add('bump');
      }
    }
    this.comboBar.style.transform = `scaleX(${S.comboFrac})`;

    // upgrades
    const act = battle.upgrades.active();
    const key = act.map((u) => `${u.id}${u.level}`).join('|');
    if (key !== this.upKey) {
      this.upKey = key;
      this.upgradesEl.replaceChildren(...act.map((u) => h('span.upchip', { title: u.name }, u.name, u.level > 1 ? h('b', `×${u.level}`) : null)));
    }

    // timers
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      this.hintEl.classList.toggle('faded', this.hintTimer < 0);
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('is-on');
    }
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) this.callout.classList.remove('is-on');
    }

    this.#updateEnemyBars(battle, camera);
  }

  #updateEnemyBars(battle, camera) {
    const seen = new Set();
    for (const c of battle.characters) {
      if (c.team !== 'enemy' || !c.alive || c.state === STATE.SPAWN) continue;
      seen.add(c.id);
      let b = this.barPool.get(c.id);
      if (!b) {
        b = h('div.ebar', h('i'), h('span.ename', c.name));
        this.enemyBars.append(b);
        this.barPool.set(c.id, b);
      }
      _v.set(c.x, c.y + 2.35 * c.scale * 0.92, c.z).project(camera);
      b.style.transform = `translate(${(_v.x * 0.5 + 0.5) * 100}vw, ${(-_v.y * 0.5 + 0.5) * 100}vh) translate(-50%, -100%)`;
      const f = Math.max(0, c.hp / c.maxHp);
      b.firstChild.style.transform = `scaleX(${f})`;
      b.classList.toggle('dazed', c.dazed);
      b.classList.toggle('guarded', c.blocking);
      b.classList.toggle('danger', !!c.attack && c.attack.phase === 'windup');
    }
    for (const [id, b] of this.barPool) {
      if (!seen.has(id)) {
        b.remove();
        this.barPool.delete(id);
      }
    }
  }
}
