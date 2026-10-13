import { CONFIG } from '../config/gameConfig.js';
import { Storage } from '../util/Storage.js';

const KEY = 'knockback.best.v1';

export function loadBest() {
  const v = Storage.getJSON(KEY, null);
  if (!v || typeof v !== 'object') return { score: 0, wave: 0 };
  return {
    score: Number.isFinite(v.score) && v.score > 0 ? Math.floor(v.score) : 0,
    wave: Number.isFinite(v.wave) && v.wave > 0 ? Math.floor(v.wave) : 0,
  };
}

export function saveBest(best) {
  Storage.setJSON(KEY, best);
}

// Tracks score, combo and run statistics. Listens to battle events.
export class ScoreManager {
  constructor(bus, battle) {
    this.bus = bus;
    this.battle = battle;
    this.reset();
    bus.on('hit', (e) => this.#onHit(e));
    bus.on('ringOut', (e) => this.#onRingOut(e));
    bus.on('perfectBlock', (e) => this.#onPerfectBlock(e));
    bus.on('dodged', (e) => this.#onDodged(e));
    bus.on('playerHurt', () => this.breakCombo());
    bus.on('waveClear', (e) => this.#onWaveClear(e));
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.comboTimer = 0;
    this.kills = 0;
    this.ringOuts = 0;
    this.perfectBlocks = 0;
    this.perfectDodges = 0;
    this.wavesCleared = 0;
    this.damageThisWave = 0;
  }

  get multiplier() {
    const C = CONFIG.combo;
    return Math.min(C.maxMultiplier, 1 + Math.floor(this.combo / C.stepEvery) * C.stepSize);
  }

  get comboFrac() {
    return this.combo > 0 ? Math.max(0, this.comboTimer / CONFIG.combo.window) : 0;
  }

  update(dt) {
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.breakCombo();
    }
  }

  add(points, why, at) {
    const gained = Math.round(points);
    this.score += gained;
    this.bus.emit('score', { points: gained, why, at, total: this.score });
    return gained;
  }

  bumpCombo() {
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTimer = CONFIG.combo.window;
    this.bus.emit('combo', { combo: this.combo, multiplier: this.multiplier });
  }

  breakCombo() {
    if (this.combo > 0) {
      const had = this.combo;
      this.combo = 0;
      this.comboTimer = 0;
      this.bus.emit('combo', { combo: 0, multiplier: 1, broken: had });
    }
  }

  #onHit(e) {
    const S = CONFIG.score;
    if (e.target.isPlayer) {
      this.damageThisWave += e.damage;
      this.bus.emit('playerHurt', e);
      return;
    }
    if (!e.attacker.isPlayer) return;
    this.bumpCombo();
    this.add((e.heavy ? S.heavyHit : S.lightHit) * this.multiplier, e.heavy ? 'heavy' : 'hit', e);
  }

  #onRingOut(e) {
    const S = CONFIG.score;
    if (e.character.isPlayer) return;
    this.kills++;
    if (!e.credit || !e.credit.isPlayer) {
      // enemy fell without the player's involvement: no points
      return;
    }
    this.ringOuts++;
    const typeMul = S.ringOutByType[e.character.type] ?? 1;
    let pts = S.ringOut * typeMul;
    if (e.bowled) pts += S.bowlingBonus;
    this.bumpCombo();
    this.add(pts * this.multiplier, e.bowled ? 'bowling' : 'ringout', e);
  }

  #onPerfectBlock(e) {
    this.perfectBlocks++;
    this.add(CONFIG.score.perfectBlock * this.multiplier, 'perfectBlock', e);
  }

  #onDodged(e) {
    this.perfectDodges++;
    this.add(CONFIG.score.perfectDodge * this.multiplier, 'dodge', e);
  }

  #onWaveClear(e) {
    const S = CONFIG.score;
    this.wavesCleared = e.wave;
    let pts = S.waveClear + S.waveClearPerWave * e.wave;
    const flawless = this.damageThisWave <= 0;
    if (flawless) pts += S.flawlessBonus;
    e.flawless = flawless;
    e.bonus = pts;
    this.add(pts, 'waveClear', e);
    this.damageThisWave = 0;
  }
}
