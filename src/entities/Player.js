import { Character } from './Character.js';

export class Player extends Character {
  constructor(x = 0, z = 3) {
    super({ team: 'player', type: 'player', x, z, facing: Math.PI });
    this.name = 'You';
  }
}
