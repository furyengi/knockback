// localStorage wrapper that never throws; falls back to an in-memory map.
const memory = new Map();
let backend = null;
try {
  if (typeof localStorage !== 'undefined') {
    const probe = '__knockback_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    backend = localStorage;
  }
} catch {
  backend = null;
}

export const Storage = {
  get available() {
    return backend !== null;
  },
  getRaw(key) {
    try {
      if (backend) return backend.getItem(key);
    } catch {
      /* fall through */
    }
    return memory.has(key) ? memory.get(key) : null;
  },
  setRaw(key, value) {
    memory.set(key, value);
    try {
      if (backend) backend.setItem(key, value);
    } catch {
      /* memory copy is kept */
    }
  },
  removeRaw(key) {
    memory.delete(key);
    try {
      if (backend) backend.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  getJSON(key, fallback = null) {
    const raw = this.getRaw(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  setJSON(key, value) {
    try {
      this.setRaw(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};
