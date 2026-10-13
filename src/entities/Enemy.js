import { Character } from './Character.js';

export class Enemy extends Character {
  constructor(type, x, z, { hpScale = 1, aggression = 1 } = {}) {
    super({ team: 'enemy', type, x, z, hpScale, facing: Math.atan2(-x, -z) });
    this.aggression = aggression;
    this.ai = null; // set by Battle
  }
}
