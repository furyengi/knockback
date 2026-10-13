import { CONFIG } from '../config/gameConfig.js';

/** Enemy list for wave `n` (1-based). Pure, so it can be tested. */
export function composeWave(n, rng) {
  const W = CONFIG.waves;
  if (n <= W.opening.length) return W.opening[n - 1].slice();
  const budget = W.budgetBase + W.budgetPerWave * n;
  const out = [];
  let spent = 0;
  const weights = { runner: 4, guard: 3 + n * 0.05, bruiser: 1.4 + n * 0.12 };
  const types = Object.keys(weights);
  while (out.length < W.maxPerWave) {
    const affordable = types.filter((t) => spent + W.costs[t] <= budget + 0.01);
    if (!affordable.length) break;
    let total = 0;
    for (const t of affordable) total += weights[t];
    let r = rng.next() * total;
    let pick = affordable[affordable.length - 1];
    for (const t of affordable) {
      r -= weights[t];
      if (r <= 0) {
        pick = t;
        break;
      }
    }
    out.push(pick);
    spent += W.costs[pick];
  }
  // Guarantee a Bruiser every few waves so the heavy-attack dance keeps appearing.
  if (n % 3 === 0 && !out.includes('bruiser')) out[0] = 'bruiser';
  return out;
}

export class WaveManager {
  constructor(battle, rng) {
    this.battle = battle;
    this.bus = battle.bus;
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.wave = 0;
    this.state = 'idle'; // idle | countdown | active | cleared
    this.timer = 0;
    this.pending = [];
    this.warnings = [];
    this.spawnTimer = 0;
    this.total = 0;
  }

  /** Enemies still to be defeated in this wave (queued + warning + on the roof). */
  get remaining() {
    return this.pending.length + this.warnings.length + this.battle.enemiesInPlay();
  }

  startWave(n, delay = CONFIG.waves.startDelay) {
    this.wave = n;
    this.pending = composeWave(n, this.rng);
    this.warnings = [];
    this.total = this.pending.length;
    this.state = 'countdown';
    this.timer = delay;
    this.spawnTimer = 0;
    this.bus.emit('waveQueued', { wave: n, total: this.total });
  }

  get hpScale() {
    return Math.min(CONFIG.waves.hpScaleCap, 1 + (this.wave - 1) * CONFIG.waves.hpScalePerWave);
  }
  get aggression() {
    return Math.min(CONFIG.waves.aggressionCap, 1 + (this.wave - 1) * CONFIG.waves.aggressionPerWave);
  }

  update(dt) {
    const W = CONFIG.waves;
    if (this.state === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'active';
        this.bus.emit('waveStart', { wave: this.wave, total: this.total });
      }
      return;
    }
    if (this.state !== 'active') return;

    // warnings -> real spawns
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.t -= dt;
      if (w.t <= 0) {
        this.warnings.splice(i, 1);
        this.battle.spawnEnemy(w.type, w.x, w.z, this.hpScale, this.aggression);
      }
    }

    this.spawnTimer -= dt;
    const alive = this.battle.enemiesInPlay() + this.warnings.length;
    if (this.pending.length && alive < W.maxAlive && this.spawnTimer <= 0) {
      const type = this.pending.shift();
      const pos = this.pickSpawn();
      this.warnings.push({ type, x: pos.x, z: pos.z, t: W.spawnWarning });
      this.bus.emit('spawnWarning', { type, x: pos.x, z: pos.z, delay: W.spawnWarning });
      this.spawnTimer = W.spawnInterval;
    }

    if (this.pending.length === 0 && this.warnings.length === 0 && this.battle.enemiesInPlay() === 0 && this.battle.player.alive) {
      this.state = 'cleared';
      this.bus.emit('waveClear', { wave: this.wave, total: this.total });
    }
  }

  pickSpawn() {
    const half = CONFIG.arena.half - 1.6;
    const p = this.battle.player;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 14; i++) {
      const x = this.rng.range(-half, half);
      const z = this.rng.range(-half, half);
      let nearest = 99;
      nearest = Math.min(nearest, Math.hypot(x - p.x, z - p.z) * 1.25);
      for (const c of this.battle.characters) if (c.inPlay) nearest = Math.min(nearest, Math.hypot(x - c.x, z - c.z));
      for (const w of this.warnings) nearest = Math.min(nearest, Math.hypot(x - w.x, z - w.z));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = { x, z };
      }
    }
    return best;
  }
}
