import { CONFIG } from '../config/gameConfig.js';
import { EventBus } from '../util/EventBus.js';
import { Rng } from '../util/Rng.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { STATE } from '../entities/Character.js';
import { PlayerController } from '../entities/PlayerController.js';
import { CombatSystem } from '../combat/CombatSystem.js';
import { CollisionSystem } from '../combat/CollisionSystem.js';
import { RingOutSystem } from '../combat/RingOutSystem.js';
import { AttackCoordinator } from '../ai/AttackCoordinator.js';
import { BruiserAI } from '../ai/BruiserAI.js';
import { RunnerAI } from '../ai/RunnerAI.js';
import { GuardAI } from '../ai/GuardAI.js';
import { ScoreManager } from './ScoreManager.js';
import { UpgradeManager } from './UpgradeManager.js';
import { WaveManager } from './WaveManager.js';

const AI_BY_TYPE = { bruiser: BruiserAI, runner: RunnerAI, guard: GuardAI };

/**
 * The renderer-free game simulation: characters, combat, AI, waves, score, upgrades.
 * Views subscribe to `bus` events and read entity state; nothing in here touches THREE.
 */
export class Battle {
  constructor({ seed } = {}) {
    this.bus = new EventBus();
    this.rng = new Rng(seed);
    this.characters = [];
    this.time = 0;
    this.coordinator = new AttackCoordinator(this);
    this.combat = new CombatSystem(this);
    this.collision = new CollisionSystem(this);
    this.score = new ScoreManager(this.bus, this);
    this.upgrades = new UpgradeManager(this.rng);
    this.waves = new WaveManager(this, this.rng);
    this.player = null;
    this.controller = null;
    this.playerDownReported = false;
    this.ctx = { onLand: (c, spawn) => this.bus.emit('land', { character: c, spawn }) };
    this.reset();
  }

  /** Begin a clean run. Safe to call repeatedly: it rebuilds all run state. */
  reset() {
    for (const c of this.characters) this.bus.emit('removed', { character: c });
    this.characters.length = 0;
    this.time = 0;
    this.playerDownReported = false;
    this.coordinator.reset();
    this.score.reset();
    this.upgrades.reset();
    this.waves.reset();
    this.player = new Player(0, 2.5);
    this.characters.push(this.player);
    this.controller = new PlayerController(this.player, this);
    this.bus.emit('spawned', { character: this.player });
  }

  start() {
    this.reset();
    this.beginWave(1, CONFIG.waves.startDelay);
  }

  beginWave(n, delay) {
    this.coordinator.setWave(n);
    this.waves.startWave(n, delay);
  }

  enemiesInPlay() {
    let n = 0;
    for (const c of this.characters) if (c.team === 'enemy' && c.inPlay) n++;
    return n;
  }

  spawnEnemy(type, x, z, hpScale = 1, aggression = 1) {
    const e = new Enemy(type, x, z, { hpScale, aggression });
    e.ai = new AI_BY_TYPE[type](e, this);
    e.beginSpawn(12 + this.rng.range(0, 3));
    this.characters.push(e);
    this.bus.emit('spawned', { character: e });
    return e;
  }

  playerDown(cause) {
    if (this.playerDownReported) return;
    this.playerDownReported = true;
    if (cause === 'hp') this.player.beginKo();
    this.bus.emit('playerDown', { cause });
  }

  /** Advance the simulation by a fixed step. `input` is the semantic input frame. */
  update(dt, input) {
    this.time += dt;
    const player = this.player;

    this.controller.update(dt, input);
    for (const c of this.characters) if (c.ai) c.ai.update(dt);
    for (const c of this.characters) c.update(dt, this.ctx);

    this.collision.update();
    this.combat.update();
    this.#ringOuts();

    this.score.update(dt);
    this.waves.update(dt);

    // Second pass cleanup
    for (let i = this.characters.length - 1; i >= 0; i--) {
      const c = this.characters[i];
      if (c.state === STATE.ELIMINATED) {
        this.characters.splice(i, 1);
        this.bus.emit('removed', { character: c });
      }
    }
    if (player.hp <= 0 && !this.playerDownReported) this.playerDown('hp');
  }

  #ringOuts() {
    for (const c of this.characters) {
      if (!RingOutSystem.shouldFall(c)) continue;
      const wasInPlay = c.inPlay;
      c.beginFall();
      c.ky = Math.min(c.ky, 1.5);
      if (!wasInPlay && !c.isPlayer) continue;
      const credit = RingOutSystem.creditFor(c, this.time);
      const bowled = !!c.lastBumpBy && this.time - c.lastHitTime < 2.5;
      if (c.isPlayer) {
        this.bus.emit('ringOut', { character: c, credit, bowled: false });
        this.playerDown('ringout');
      } else {
        this.bus.emit('ringOut', { character: c, credit, bowled });
      }
    }
  }
}
