import * as THREE from 'three';
import { CONFIG } from '../config/gameConfig.js';
import { Battle } from './Battle.js';
import { GameState, GS } from './GameState.js';
import { loadBest, saveBest } from './ScoreManager.js';
import { Presentation } from './Presentation.js';
import { createLighting } from '../world/Lighting.js';
import { Arena } from '../world/Arena.js';
import { Environment } from '../world/Environment.js';
import { CameraController } from '../world/CameraController.js';
import { Effects } from '../fx/Effects.js';
import { CharacterViews } from '../entities/CharacterView.js';
import { disposeSharedGeometry, disposeOutlineMaterial } from '../entities/CharacterModel.js';
import { AudioManager, loadSettings, saveSettings } from '../audio/AudioManager.js';
import { ControlBindings } from '../input/ControlBindings.js';
import { InputManager } from '../input/InputManager.js';
import { UIManager } from '../ui/UIManager.js';
import { HUD } from '../ui/HUD.js';
import { MainMenu, shorten } from '../ui/MainMenu.js';
import { HowToPlay } from '../ui/HowToPlay.js';
import { SettingsMenu } from '../ui/SettingsMenu.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { UpgradeScreen } from '../ui/UpgradeScreen.js';
import { GameOverScreen } from '../ui/GameOverScreen.js';
import { ControllerSetup } from '../ui/ControllerSetup.js';
import { ControllerDebugPanel } from '../ui/ControllerDebugPanel.js';

const EMPTY = Object.freeze({});

export class Game {
  constructor({ canvas, hudRoot, screensRoot, toastRoot, appRoot }) {
    this.canvas = canvas;
    this.settings = loadSettings();
    this.best = loadBest();
    this.gs = new GameState();
    this.acc = 0;
    this.hitStop = 0;
    this.afterClear = -1;
    this.dyingTimer = 0;
    this.deathCause = 'hp';
    this.offeredSetup = new Set();
    this.disposed = false;
    this.lastTime = performance.now();
    this.simInput = { move: { x: 0, z: 0 }, held: EMPTY, pressed: EMPTY };
    this.pendingPressed = {};
    this.menuOffset = 0;
    this.headless = false; // test aid: skip WebGL rendering

    this.#initRenderer();
    this.#initWorld();

    this.audio = new AudioManager(this.settings);
    this.bindings = new ControlBindings();
    this.input = new InputManager({ bindings: this.bindings });

    this.battle = new Battle();
    this.views = new CharacterViews(this.scene);
    this.#wireBattle();

    this.ui = new UIManager({
      root: screensRoot,
      toastRoot,
      input: this.input,
      audio: this.audio,
      bindings: this.bindings,
      settings: this.settings,
      game: this,
    });
    this.hud = new HUD(hudRoot, this.ui);
    for (const S of [MainMenu, HowToPlay, SettingsMenu, PauseMenu, UpgradeScreen, GameOverScreen, ControllerSetup]) this.ui.register(new S(this.ui));
    this.debugPanel = new ControllerDebugPanel({ overlay: true });
    appRoot.append(this.debugPanel.el);

    this.presentation = new Presentation({
      bus: this.battle.bus,
      fx: this.fx,
      audio: this.audio,
      camera: this.cc,
      hud: this.hud,
      input: this.input,
      game: this,
    });
    this.#wireGameEvents();
    this.#wireWindow();

    this.cc.setShake(this.settings.shake);
    this.battle.reset(); // emits 'spawned' for the menu-screen player now that views are listening
    this.resize();
    this.gs.set(GS.MENU);
    this.ui.openOnly('main');
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ---- setup -----------------------------------------------------------------------

  #initRenderer() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.prCap = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(this.prCap);
    renderer.shadowMap.enabled = this.settings.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.renderer = renderer;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ui?.toast('Graphics context lost. Reload the page to continue.', 'warn');
    });
  }

  #initWorld() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
    this.cc = new CameraController(this.camera);
    this.lights = createLighting(this.scene, { shadows: this.settings.shadows });
    this.arena = new Arena(this.scene);
    this.env = new Environment(this.scene);
    this.fx = new Effects(this.scene);
  }

  #wireBattle() {
    const bus = this.battle.bus;
    bus.on('spawned', (e) => this.views.add(e.character));
    bus.on('removed', (e) => this.views.remove(e.character));
    bus.on('hitstop', (t) => {
      this.hitStop = Math.min(0.14, Math.max(this.hitStop, t));
    });
  }

  #wireGameEvents() {
    const bus = this.battle.bus;
    bus.on('waveClear', (e) => {
      this.afterClear = CONFIG.waves.clearDelay;
      this.lastClear = e;
    });
    bus.on('playerDown', (e) => {
      if (this.gs.is(GS.PLAYING)) {
        this.deathCause = e.cause;
        this.dyingTimer = e.cause === 'ringout' ? 1.7 : 1.4;
        this.gs.set(GS.DYING);
        this.afterClear = -1;
      }
    });
    this.input.gamepad.onConnection((type, pad) => {
      if (!pad) return;
      if (type === 'connected') {
        const now = performance.now();
        if (this._lastPadToast && this._lastPadToast.id === pad.id && now - this._lastPadToast.t < 2000) return; // same adapter exposing two slots
        this._lastPadToast = { id: pad.id, t: now };
        const std = pad.mapping === 'standard';
        this.ui.toast(`Controller connected: ${shorten(pad.id) || 'gamepad'}${std ? '' : ' — layout unknown, open Controller setup'}`);
      } else {
        this.ui.toast('Controller disconnected', 'warn');
        if (this.gs.is(GS.PLAYING)) this.pause('Controller disconnected. Reconnect it, or keep playing on the keyboard.');
      }
    });
  }

  #wireWindow() {
    this._onResize = () => this.resize();
    this._onVis = () => {
      if (document.hidden && this.gs.is(GS.PLAYING)) this.pause();
      this.lastTime = performance.now();
    };
    this._onBlur = () => {
      if (this.gs.is(GS.PLAYING)) this.pause();
    };
    this._onKey = (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.debugPanel.setVisible(this.debugPanel.el.hidden);
      } else if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey) {
        const muted = this.audio.toggleMute();
        this.ui.toast(muted ? 'Sound muted' : 'Sound on');
      }
      this.audio.unlock();
    };
    this._onPointer = () => this.audio.unlock();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('pointerdown', this._onPointer);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 2 || h < 2) return; // minimised / hidden pane
    // Cap total rendered pixels (~4 MP) so 4K / high-DPI screens stay smooth.
    const budget = Math.sqrt(4.0e6 / (w * h));
    this.renderer.setPixelRatio(Math.max(1, Math.min(this.prCap, budget)));
    this.renderer.setSize(w, h, false);
    this.cc.resize(w, h);
    // UI scale: 1.0 at 1500x820, shrinking for small windows and growing a little for big monitors
    const s = Math.max(0.6, Math.min(1.35, Math.min(w / 1500, h / 820)));
    document.documentElement.style.setProperty('--s', s.toFixed(3));
  }

  // ---- settings hooks (called from the settings screen) ----------------------------

  setShake(v) {
    this.settings.shake = v;
    saveSettings(this.settings);
    this.cc.setShake(v);
  }

  setShadows(on) {
    this.settings.shadows = !!on;
    saveSettings(this.settings);
    this.renderer.shadowMap.enabled = !!on;
    this.lights.sun.castShadow = !!on;
    this.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
  }

  // ---- flow ------------------------------------------------------------------------

  startRun() {
    this.audio.unlock();
    this.fx.clear();
    this.battle.start();
    this.hud.reset();
    this.hud.show();
    this.cc.impulse.set(0, 0, 0);
    this.ui.closeAll();
    this.afterClear = -1;
    this.hitStop = 0;
    this.acc = 0;
    this.gs.set(GS.PLAYING);
    this.#flushInput();
    this.audio.play('uiSelect');
  }

  #flushInput() {
    this.input.flush();
    for (const k in this.pendingPressed) delete this.pendingPressed[k];
  }

  restart() {
    this.startRun();
  }

  quitToMenu() {
    this.fx.clear();
    this.battle.reset();
    this.hud.hide();
    this.afterClear = -1;
    this.gs.set(GS.MENU);
    this.ui.openOnly('main');
  }

  pause(reason = '') {
    if (!this.gs.is(GS.PLAYING)) return;
    this.gs.set(GS.PAUSED);
    this.ui.openOnly('pause', { reason });
  }

  resume() {
    if (!this.gs.is(GS.PAUSED)) return;
    this.ui.closeAll();
    this.gs.set(GS.PLAYING);
    this.acc = 0;
    this.#flushInput();
  }

  #openUpgrade() {
    const b = this.battle;
    const clear = this.lastClear || {};
    const healed = Math.round(b.upgrades.onWaveClear(b.player));
    const options = b.upgrades.roll(3);
    if (!options.length) {
      b.beginWave(b.waves.wave + 1, CONFIG.waves.startDelay);
      return;
    }
    this.gs.set(GS.UPGRADE);
    this.ui.openOnly('upgrade', { wave: b.waves.wave, bonus: clear.bonus || 0, flawless: !!clear.flawless, healed, options });
  }

  pickUpgrade(id) {
    if (!this.gs.is(GS.UPGRADE)) return;
    const b = this.battle;
    if (!b.upgrades.pick(id, b.player)) return;
    this.audio.play('upgrade');
    this.fx.ring(b.player.x, 0.06, b.player.z, { r0: 0.4, r1: 2.6, dur: 0.5, color: new THREE.Color('#c6ff3d'), a: 0.9 });
    this.ui.closeAll();
    this.gs.set(GS.PLAYING);
    this.#flushInput();
    b.beginWave(b.waves.wave + 1, 1.2);
  }

  #gameOver() {
    const b = this.battle;
    const s = b.score;
    const wave = b.waves.wave;
    const newBest = s.score > this.best.score;
    this.best = { score: Math.max(this.best.score, s.score), wave: Math.max(this.best.wave, wave) };
    saveBest(this.best);
    this.gs.set(GS.GAME_OVER);
    this.hud.hide();
    this.audio.play('gameOver');
    this.ui.openOnly('gameover', {
      cause: this.deathCause,
      score: s.score,
      wave,
      best: this.best,
      newBest: newBest && s.score > 0,
      ringOuts: s.ringOuts,
      bestCombo: s.bestCombo,
      perfectBlocks: s.perfectBlocks,
    });
  }

  // ---- main loop -------------------------------------------------------------------

  frame(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    try {
      this.#tick(now);
    } catch (err) {
      if (!this._reported) {
        this._reported = true;
        console.error('[Knockback] frame error', err);
        this.ui?.toast('Something went wrong. Check the console.', 'warn');
      }
    }
  }

  #tick(now) {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, CONFIG.sim.maxFrame);

    const input = this.input.poll(dt);
    if (input.pressed.confirm || input.pressed.lightAttack || input.pressed.dodge) this.audio.unlock();
    this.#watchAudio(dt);
    this.#adaptQuality(dt);
    const gs = this.gs.state;
    this.gs.tick(dt);

    this.#offerControllerSetup(input);
    if (this.ui.hasScreen) this.ui.handleFrame(input, dt);

    let simulating = false;
    if (gs === GS.PLAYING) {
      if (input.pressed.pause && !this.ui.hasScreen) this.pause();
      else {
        simulating = true;
        this.#stepSim(dt, input);
        if (this.afterClear > 0) {
          this.afterClear -= dt;
          if (this.afterClear <= 0) this.#openUpgrade();
        }
      }
    } else if (gs === GS.DYING) {
      simulating = true;
      this.#stepSim(dt, null);
      this.dyingTimer -= dt;
      if (this.dyingTimer <= 0) this.#gameOver();
    } else if (gs === GS.GAME_OVER || gs === GS.MENU) {
      simulating = true;
      this.#stepSim(dt, null);
    }

    // ---- presentation (runs every frame regardless of simulation pauses)
    const frozen = this.hitStop > 0;
    const alpha = simulating ? Math.min(1, this.acc / CONFIG.sim.step) : 1;
    const viewDt = simulating && !frozen ? dt : 0;
    this.views.update(viewDt, alpha);
    this.fx.update(frozen ? dt * 0.3 : dt);
    this.fx.updateTelegraphs(this.battle.characters);
    this.arena.update(this.battle.player, dt);
    this.presentation.update(dt);

    // gentle camera shift so the arena sits right of the title menu
    const wantOff = gs === GS.MENU ? 1 : 0;
    this.menuOffset += (wantOff - this.menuOffset) * (1 - Math.exp(-4 * dt));
    this.cc.setFocusOffset(-3.4 * this.menuOffset, 0);
    this.cc.update(dt);

    this.hud.update(dt, this.battle, this.camera);
    if (!this.debugPanel.el.hidden) {
      const snap = this.input.gamepad.snapshot();
      this.debugPanel.update(snap, this.input.gamepad.info, { deadZone: this.bindings.deadZone, moveStick: this.input.gamepad.pad ? this.bindings.resolve(this.input.gamepad.pad).bindings.move : null });
    }

    if (!this.headless) this.renderer.render(this.scene, this.camera);
  }

  /** Some browsers do not count gamepad presses as a user gesture; tell the player once. */
  #watchAudio(dt) {
    const a = this.audio;
    if (this._audioToast || a.failed || this.settings.muted) return;
    if (!a.ctx) {
      this._audioWait = 0;
      return;
    }
    if (a.ctx.state === 'running') {
      this._audioToast = true;
      return;
    }
    this._audioWait = (this._audioWait || 0) + dt;
    if (this._audioWait > 1.5) {
      this._audioToast = true;
      this.ui.toast('Sound is blocked by the browser until you press a keyboard key or click once.', 'warn');
    }
  }

  /** If the machine cannot hold ~45fps for a few seconds, trade resolution for smoothness. */
  #adaptQuality(rawDt) {
    if (this.headless || document.hidden) return;
    this._ema = this._ema ? this._ema + (rawDt - this._ema) * 0.05 : rawDt;
    if (this._ema > 1 / 40) this._slow = (this._slow || 0) + rawDt;
    else this._slow = Math.max(0, (this._slow || 0) - rawDt * 2);
    if (this._slow > 3) {
      this._slow = 0;
      if (this.prCap > 1.01 && this.renderer.getPixelRatio() > 1.01) {
        this.prCap = Math.max(1, this.renderer.getPixelRatio() - 0.25);
        this.resize();
      } else if (this.settings.shadows) {
        this.setShadows(false);
        this.ui.toast('Shadows turned off to keep the game smooth. You can re-enable them in Settings.');
      }
    }
  }

  #stepSim(dt, input) {
    // Press edges are collected until a simulation step actually consumes them. Without this a
    // press that lands on a frame with no step (144 Hz displays, hit-stop) would be lost.
    const pending = this.pendingPressed;
    if (input) {
      for (const k in input.pressed) pending[k] = true;
    } else {
      for (const k in pending) delete pending[k];
    }
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    const step = CONFIG.sim.step;
    this.acc += dt;
    const simIn = this.simInput;
    if (input) {
      simIn.move = input.move;
      simIn.held = input.held;
    } else {
      simIn.move = { x: 0, z: 0 };
      simIn.held = EMPTY;
    }
    let steps = 0;
    while (this.acc >= step && steps < CONFIG.sim.maxSteps) {
      simIn.pressed = steps === 0 ? pending : EMPTY; // an edge belongs to exactly one simulation step
      this.battle.update(step, simIn);
      if (steps === 0) for (const k in pending) delete pending[k];
      this.acc -= step;
      steps++;
      if (this.hitStop > 0) break;
    }
    if (steps >= CONFIG.sim.maxSteps) this.acc = 0;
  }

  #offerControllerSetup(input) {
    if (!input.padNeedsSetup || !input.padAnyButton) return;
    if (!this.gs.is(GS.MENU) || this.ui.active?.id !== 'main') return;
    const pad = this.input.gamepad.pad;
    const key = pad?.id || 'pad';
    if (this.offeredSetup.has(key)) return;
    this.offeredSetup.add(key);
    this.ui.toast('This controller’s layout is unknown. Let’s set it up.');
    this.ui.open('controller', { autoWizard: true });
  }

  /** Run frames synchronously (testing / automation): advances time by n * ms milliseconds. */
  advance(n = 1, ms = 1000 / 60) {
    for (let i = 0; i < n; i++) {
      this.#tick(this.lastTime + ms);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('pointerdown', this._onPointer);
    this.presentation.dispose();
    this.ui.dispose();
    this.input.dispose();
    this.views.clear();
    this.fx.dispose();
    this.arena.dispose();
    this.env.dispose();
    disposeSharedGeometry();
    disposeOutlineMaterial();
    this.renderer.dispose();
  }
}
