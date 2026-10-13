import { CONFIG } from '../config/gameConfig.js';
import { FX_COLORS } from '../fx/Effects.js';

const WHY_LABEL = {
  ringout: 'RING-OUT',
  bowling: 'BOWLED OFF',
  perfectBlock: 'PERFECT BLOCK',
  dodge: 'DODGE',
  waveClear: 'WAVE CLEAR',
};

/**
 * Turns simulation events into feedback: particles, sound, camera impulse, haptics, HUD
 * text. Keeping this separate means the simulation never knows how it is being shown.
 */
export class Presentation {
  constructor({ bus, fx, audio, camera, hud, input, game }) {
    this.bus = bus;
    this.fx = fx;
    this.audio = audio;
    this.camera = camera;
    this.hud = hud;
    this.input = input;
    this.game = game;
    this.rumbleCooldown = 0;
    this.lastComboSound = 0;
    this.offs = [];
    const on = (type, fn) => this.offs.push(bus.on(type, fn));

    on('hit', (e) => this.#hit(e));
    on('block', (e) => {
      fx.impact(e.x, e.y, e.z, e.dirX, e.dirZ, { power: 0.7, color: FX_COLORS.white });
      audio.play('block');
      camera.kick(e.dirX, e.dirZ, 0.1);
      this.#rumble(0.3, 0.6, 90);
    });
    on('perfectBlock', (e) => {
      fx.impact(e.x, e.y, e.z, e.dirX, e.dirZ, { power: 1.3, color: FX_COLORS.lime, accent: FX_COLORS.white });
      fx.ring(e.target.x, 0.06, e.target.z, { r0: 0.4, r1: 3.0, dur: 0.45, color: FX_COLORS.lime, a: 0.9 });
      audio.play('perfectBlock');
      hud.showCallout('PERFECT BLOCK', 'good');
      camera.kick(e.dirX, e.dirZ, 0.22);
      this.#rumble(0.8, 0.9, 140);
    });
    on('guardBreak', (e) => {
      fx.impact(e.x, e.y, e.z, e.dirX, e.dirZ, { power: 1.6 });
      audio.play('guardBreak');
      camera.kick(e.dirX, e.dirZ, 0.3);
      if (e.target.isPlayer) {
        hud.flashDamage();
        hud.showCallout('GUARD BROKEN', 'bad');
        this.#rumble(1, 0.7, 220);
      } else hud.floater({ x: e.target.x, y: 2.4, z: e.target.z }, 'GUARD BREAK', 'tag', camera.camera);
    });
    on('dodge', (e) => {
      const c = e.character;
      fx.dust(c.x, c.z, { n: 6, spread: 0.5, size: 0.22 });
      // speed lines trailing opposite to the dodge direction
      for (let i = 0; i < 7; i++) {
        fx.streaks.spawn({
          x: c.x + (Math.random() - 0.5) * 0.7, y: 0.25 + Math.random() * 1.2, z: c.z + (Math.random() - 0.5) * 0.7,
          vx: -c.dodgeDirX * (5 + Math.random() * 5), vy: 0, vz: -c.dodgeDirZ * (5 + Math.random() * 5),
          life: 0.22, size: 0.03, size1: 0, stretch: 1.4, drag: 4, color: FX_COLORS.white,
        });
      }
      audio.play('dodge');
    });
    on('dodged', (e) => {
      audio.play('perfectDodge');
      hud.floater({ x: e.target.x, y: 2.3, z: e.target.z }, 'DODGE', 'tag good', camera.camera);
      fx.ring(e.target.x, 0.06, e.target.z, { r0: 0.3, r1: 1.8, dur: 0.35, color: FX_COLORS.lime, a: 0.8 });
    });
    on('swing', (e) => {
      const heavy = e.attack.kind === 'heavy';
      audio.play(heavy ? 'swingHeavy' : 'swingLight');
      if (!e.character.isPlayer && heavy) audio.play('telegraph', { dur: e.attack.def.windup });
    });
    on('land', (e) => {
      const c = e.character;
      if (e.spawn) {
        fx.land(c.x, c.z, 1.5);
        audio.play('land', { power: 1.2 });
        camera.kick(0, 1, 0.03);
      } else {
        fx.land(c.x, c.z, 0.7);
        audio.play('land', { power: 0.7 });
      }
    });
    on('spawnWarning', (e) => {
      fx.spawnMarker(e.x, e.z, e.delay);
      audio.play('spawn');
    });
    on('bump', (e) => {
      fx.impact(e.x, 1.0, e.z, e.target.x - e.source.x, e.target.z - e.source.z, { power: 1.0 });
      audio.play('bump');
      camera.kick(e.target.x - e.source.x, e.target.z - e.source.z, 0.08);
    });
    on('daze', (e) => {
      hud.floater({ x: e.target.x, y: 2.5, z: e.target.z }, 'DAZED', 'tag', camera.camera);
    });
    on('ringOut', (e) => this.#ringOut(e));
    on('score', (e) => this.#score(e));
    on('combo', (e) => {
      if (e.combo > 1 && e.combo % 3 === 0) audio.play('combo', { combo: e.combo });
      if (e.broken && e.broken >= 6) hud.floater({ x: 0, y: 3, z: 6 }, `${e.broken}-HIT COMBO`, 'tag', camera.camera);
    });
    on('staminaFail', () => {
      hud.staminaFail();
      audio.play('staminaFail');
    });
    on('waveStart', (e) => {
      audio.play('waveStart');
      hud.showBanner(`Wave ${e.wave}`, `${e.total} enem${e.total === 1 ? 'y' : 'ies'} — knock them off`, 'start');
    });
    on('waveClear', () => {
      audio.play('waveClear');
      hud.showBanner('Wave cleared', '', 'clear', 1500);
    });
    on('playerDown', () => {
      this.#rumble(1, 1, 400);
    });
  }

  #rumble(strong, weak, ms) {
    if (this.rumbleCooldown > 0) return;
    this.input.gamepad.rumble(strong, weak, ms);
    this.rumbleCooldown = 0.06;
  }

  update(dt) {
    this.rumbleCooldown = Math.max(0, this.rumbleCooldown - dt);
  }

  #hit(e) {
    const { fx, audio, camera, hud } = this;
    const heavy = e.heavy;
    const power = (heavy ? 1.7 : 0.85) * (e.armored ? 0.6 : 1) * (e.finisher ? 1.3 : 1);
    fx.impact(e.x, e.y, e.z, e.dirX, e.dirZ, { power });
    if (heavy && !e.armored) {
      fx.slam(e.target.x, e.target.z, 0.8);
    }
    audio.play(heavy ? 'hitHeavy' : 'hitLight');
    camera.kick(e.dirX, e.dirZ, heavy ? 0.42 : e.finisher ? 0.18 : 0.07);
    if (e.target.isPlayer) {
      hud.flashDamage();
      audio.play('hurt');
      this.#rumble(heavy ? 1 : 0.5, heavy ? 0.8 : 0.4, heavy ? 240 : 110);
    } else if (e.attacker.isPlayer) {
      this.#rumble(heavy ? 0.8 : 0.25, heavy ? 0.6 : 0.3, heavy ? 160 : 60);
    }
  }

  #ringOut(e) {
    const c = e.character;
    const { fx, audio, camera, hud } = this;
    const half = CONFIG.arena.half;
    const dx = Math.sign(c.x) * (Math.abs(c.x) > Math.abs(c.z) ? 1 : 0);
    const dz = Math.sign(c.z) * (Math.abs(c.z) >= Math.abs(c.x) ? 1 : 0);
    fx.edgeFall(c.x, c.z, dx, dz);
    audio.play('ringOut');
    camera.kick(dx, dz, 0.25);
    if (c.isPlayer) {
      this.#rumble(1, 1, 500);
      return;
    }
    if (e.credit?.isPlayer) {
      this.#rumble(1, 0.9, 260);
      hud.showCallout(e.bowled ? 'BOWLED OFF!' : 'RING-OUT!', 'big');
      audio.play('ringOutCheer');
    }
  }

  #score(e) {
    const at = e.at;
    if (!at) return;
    let pos;
    if (at.character) pos = { x: Math.max(-8, Math.min(8, at.character.x)), y: 1.8, z: Math.max(-8, Math.min(8, at.character.z)) };
    else if (at.target) pos = { x: at.target.x, y: 2.1, z: at.target.z };
    else return;
    if (e.why === 'waveClear') return; // shown on the banner
    const label = WHY_LABEL[e.why];
    const cls = e.why === 'ringout' || e.why === 'bowling' ? 'big' : e.why === 'heavy' ? 'mid' : '';
    this.hud.floater(pos, label ? `${label} +${e.points}` : `+${e.points}`, cls, this.camera.camera);
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
