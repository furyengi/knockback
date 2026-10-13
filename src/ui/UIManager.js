import { h } from './dom.js';

/**
 * Owns the stack of menu screens, routes semantic input to the top one, keeps prompts
 * in sync with the active input device, and shows toasts.
 */
export class UIManager {
  constructor({ root, toastRoot, input, audio, bindings, settings, game }) {
    this.root = root;
    this.toastRoot = toastRoot;
    this.input = input;
    this.audio = audio;
    this.bindings = bindings;
    this.settings = settings;
    this.game = game;
    this.screens = new Map();
    this.stack = [];
    this.captureBlocking = null; // set by ControllerSetup while it is listening for a binding
    this.toastTimers = [];
    document.documentElement.dataset.device = input.device;
    input.onDeviceChange((d) => {
      document.documentElement.dataset.device = d;
      this.refreshPrompts();
    });
    bindings.onChange(() => this.refreshPrompts());
    input.gamepad.onConnection(() => queueMicrotask(() => this.refreshPrompts()));
  }

  dispose() {
    for (const s of this.screens.values()) s.dispose?.();
    this.toastTimers.forEach(clearTimeout);
    this.screens.clear();
    this.stack = [];
  }

  register(screen) {
    screen.build();
    this.screens.set(screen.id, screen);
    this.root.append(screen.el);
    return screen;
  }

  get active() {
    return this.stack[this.stack.length - 1] || null;
  }

  get hasScreen() {
    return this.stack.length > 0;
  }

  open(id, data) {
    const s = this.screens.get(id);
    if (!s) return;
    const top = this.active;
    if (top && top !== s) {
      top.isOpen = false;
      top.el.hidden = true;
    }
    this.stack = this.stack.filter((x) => x !== s);
    this.stack.push(s);
    s.open(data);
    this.input.flush();
  }

  /** Replace the whole stack with one screen. */
  openOnly(id, data) {
    this.closeAll();
    this.open(id, data);
  }

  back() {
    if (this.stack.length <= 1) return false;
    const top = this.stack.pop();
    top.close();
    const prev = this.active;
    prev.isOpen = true;
    prev.el.hidden = false;
    prev.el.classList.remove('is-open');
    void prev.el.offsetWidth;
    prev.el.classList.add('is-open');
    prev.onResume?.();
    this.refreshPrompts();
    this.input.flush();
    return true;
  }

  closeAll() {
    for (const s of this.stack) s.close();
    this.stack = [];
  }

  /** Route input frame to the active screen. Returns true if a screen consumed the frame. */
  handleFrame(frame, dt) {
    const s = this.active;
    if (!s) return false;
    if (!this.captureBlocking?.()) {
      if (frame.nav.x || frame.nav.y) s.navigate(frame.nav.x, frame.nav.y);
      if (frame.pressed.confirm) s.activate();
      if (frame.pressed.cancel) s.back();
      s.handleExtra?.(frame);
    }
    s.update(dt, frame);
    return true;
  }

  promptText(action) {
    return this.input.prompt(action);
  }

  refreshPrompts() {
    for (const el of document.querySelectorAll('[data-prompt]')) {
      el.textContent = this.promptText(el.dataset.prompt);
    }
    for (const el of document.querySelectorAll('[data-nav-prompt]')) {
      el.textContent = this.input.device === 'gamepad' ? 'D-Pad' : 'Arrows';
    }
  }

  toast(text, kind = '') {
    const el = h('div.toast', { class: kind, role: 'status' }, text);
    this.toastRoot.append(el);
    requestAnimationFrame(() => el.classList.add('in'));
    const t = setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 350);
    }, 3200);
    this.toastTimers.push(t);
    while (this.toastRoot.children.length > 3) this.toastRoot.firstChild.remove();
  }

  /** Reusable "[key] label  [key] label" footer. */
  hintBar(items) {
    const bar = h('div.hintbar');
    for (const it of items) {
      if (it === 'nav') {
        bar.append(h('span.hint', h('kbd.prompt', { 'data-nav-prompt': '' }, this.input.device === 'gamepad' ? 'D-Pad' : 'Arrows'), h('em', 'Navigate')));
      } else {
        const [action, label] = it;
        bar.append(h('span.hint', h('kbd.prompt', { 'data-prompt': action }, this.promptText(action)), h('em', label)));
      }
    }
    return bar;
  }
}
