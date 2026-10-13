// Tiny synchronous pub/sub. Simulation emits, views (fx/audio/hud) listen.
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, (list = []));
    list.push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, data) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](data);
  }
  clear() {
    this.handlers.clear();
  }
}
