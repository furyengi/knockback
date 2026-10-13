import { h } from './dom.js';

/**
 * Base class for menu screens. A screen owns a list of focusable items and handles
 * semantic navigation (so keyboard, gamepad and mouse all drive the same code path).
 */
export class Screen {
  constructor(ui, id, { layout = 'vertical', cls = '' } = {}) {
    this.ui = ui;
    this.id = id;
    this.layout = layout; // 'vertical' | 'horizontal' | 'grid'
    this.items = [];
    this.index = 0;
    this.isOpen = false;
    this.el = h(`section.screen.screen-${id}${cls ? '.' + cls : ''}`, { role: 'dialog', 'aria-label': id, hidden: true });
  }

  /** Subclasses fill this.el and call addItem(). */
  build() {}

  onOpen() {}
  onClose() {}
  update() {}

  open(data) {
    this.isOpen = true;
    this.el.hidden = false;
    this.el.classList.remove('is-closing');
    // restart the entrance animation
    this.el.classList.remove('is-open');
    void this.el.offsetWidth;
    this.el.classList.add('is-open');
    this.onOpen(data);
    this.#applySelection(false);
    this.ui.refreshPrompts();
  }

  close() {
    this.isOpen = false;
    this.el.hidden = true;
    this.el.classList.remove('is-open');
    this.onClose();
  }

  addItem(el, handlers = {}) {
    const item = { el, ...handlers };
    this.items.push(item);
    el.setAttribute('role', el.getAttribute('role') || 'menuitem');
    el.addEventListener('mouseenter', () => {
      if (this.ui.captureBlocking?.()) return;
      const i = this.items.indexOf(item);
      if (i >= 0 && i !== this.index && !item.disabled) {
        this.index = i;
        this.#applySelection(false);
      }
    });
    el.addEventListener('click', (e) => {
      if (this.ui.captureBlocking?.()) return;
      e.preventDefault();
      if (item.disabled) return;
      this.index = this.items.indexOf(item);
      this.#applySelection(false);
      this.ui.audio?.unlock();
      this.activate();
    });
    return item;
  }

  resetItems() {
    this.items = [];
    this.index = 0;
  }

  select(i, sound = false) {
    if (!this.items.length) return;
    this.index = Math.max(0, Math.min(this.items.length - 1, i));
    this.#applySelection(sound);
  }

  #applySelection(sound) {
    this.items.forEach((it, i) => {
      const on = i === this.index;
      it.el.classList.toggle('is-selected', on);
      it.el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) it.el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    if (sound) this.ui.audio?.play('uiMove');
  }

  navigate(dx, dy) {
    if (!this.items.length) return;
    const cur = this.items[this.index];
    let step = 0;
    if (this.layout === 'vertical') {
      if (dy) step = dy;
      else if (dx && cur?.adjust) {
        cur.adjust(dx);
        this.ui.audio?.play('uiMove');
        return;
      }
    } else {
      step = dx;
    }
    if (!step) return;
    const n = this.items.length;
    let i = this.index;
    for (let tries = 0; tries < n; tries++) {
      i = (i + Math.sign(step) + n) % n;
      if (!this.items[i].disabled) break;
    }
    this.index = i;
    this.#applySelection(true);
  }

  activate() {
    const it = this.items[this.index];
    if (!it || it.disabled) return;
    this.ui.audio?.play('uiSelect');
    it.activate?.();
  }

  back() {
    const it = this.items[this.index];
    if (it?.back) return it.back();
    this.onBack();
  }

  onBack() {
    this.ui.audio?.play('uiBack');
    this.ui.back();
  }
}
