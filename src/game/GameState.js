// Tiny explicit state machine for the top-level game flow. Illegal transitions are
// ignored (and reported), which prevents stuck or double-fired states such as opening the
// upgrade screen twice or pausing the game-over screen.
export const GS = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  UPGRADE: 'upgrade',
  DYING: 'dying',
  GAME_OVER: 'gameover',
};

const ALLOWED = {
  [GS.MENU]: [GS.PLAYING],
  [GS.PLAYING]: [GS.PAUSED, GS.UPGRADE, GS.DYING, GS.MENU, GS.PLAYING],
  [GS.PAUSED]: [GS.PLAYING, GS.MENU],
  [GS.UPGRADE]: [GS.PLAYING, GS.MENU, GS.PAUSED],
  [GS.DYING]: [GS.GAME_OVER, GS.PLAYING, GS.MENU, GS.PAUSED],
  [GS.GAME_OVER]: [GS.PLAYING, GS.MENU],
};

export class GameState {
  constructor() {
    this.state = GS.MENU;
    this.time = 0;
    this.listeners = new Set();
  }

  is(...s) {
    return s.includes(this.state);
  }

  can(next) {
    return ALLOWED[this.state]?.includes(next) ?? false;
  }

  set(next) {
    if (next === this.state) return true;
    if (!this.can(next)) {
      console.warn(`[GameState] blocked ${this.state} -> ${next}`);
      return false;
    }
    const prev = this.state;
    this.state = next;
    this.time = 0;
    for (const fn of this.listeners) fn(next, prev);
    return true;
  }

  tick(dt) {
    this.time += dt;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
