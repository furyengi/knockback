import { CONFIG, tokensForWave } from '../config/gameConfig.js';

// Hands out "attack tokens" so enemies take turns instead of striking together.
// Heavy telegraphs are exclusive: nothing else starts while one is winding up.
export class AttackCoordinator {
  constructor(battle) {
    this.battle = battle;
    this.holders = new Map(); // enemy -> kind
    this.max = 1;
    this.nextStart = 0;
  }

  reset() {
    this.holders.clear();
    this.nextStart = 0;
  }

  setWave(wave) {
    this.max = tokensForWave(wave);
  }

  request(enemy, kind) {
    this.#prune();
    const now = this.battle.time;
    if (this.holders.has(enemy)) return true;
    if (now < this.nextStart) return false;
    if (this.holders.size >= this.max) return false;
    for (const k of this.holders.values()) if (k === 'heavy') return false;
    if (kind === 'heavy' && this.holders.size > 0) return false;
    this.holders.set(enemy, kind);
    const aggr = enemy.aggression || 1;
    this.nextStart = now + (CONFIG.ai.attackGap * this.battle.rng.range(1, 1.7)) / aggr;
    return true;
  }

  release(enemy) {
    this.holders.delete(enemy);
  }

  #prune() {
    for (const e of this.holders.keys()) if (!e.inPlay) this.holders.delete(e);
  }
}
