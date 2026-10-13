# KNOCKBACK

A polished, standalone **3D rooftop arena brawler** that runs in the browser (desktop first).
Survive endless waves by knocking enemies off the roof — and staying on it yourself.
Three.js + Vite, plain JavaScript modules, no backend, no accounts, works offline once loaded.

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # 79 unit / simulation tests (Vitest)
npm run build      # production build into dist/
npm run preview    # serve dist/ on http://127.0.0.1:4173
```

Use Chrome or Edge on Windows (target browsers). Any modern browser with WebGL 2 works. The production build must be served over HTTP (`npm run preview`), not opened as a file.

## Controls

| Action | Keyboard | Gamepad (standard layout default) |
| --- | --- | --- |
| Move | `WASD` / arrows | Left stick |
| Light punch | `J` / `Z` | West button (X) |
| Heavy smash | `K` / `X` | North button (Y) |
| Dodge | `Space` / `L` | South button (A) |
| Block (hold) | `Shift` / `I` / `C` | Left trigger or bumper |
| Pause | `Esc` / `P` | Start |
| Menus | arrows + `Enter`, `Esc` back | D-pad / stick + confirm / cancel |

Other keys: `M` mute, `F3` toggles the live controller debug overlay, `1`/`2`/`3` pick an upgrade.
Keyboard keeps working while a controller is connected; on-screen prompts follow whichever you used last.

Movement is **arena-relative**: up always moves away from the camera.

## How the fight works

* **Light punch**: quick and safe; three in a row end with a harder finisher.
* **Heavy smash**: long wind-up, huge knockback, costs stamina, leaves you open.
* **Dodge**: burst in the stick direction (you can cancel late light-punch recovery into it); a short, explicit invulnerable window (0.15 s of a 0.24 s dash). Dodging *through* an attack scores a perfect dodge, refunds stamina and powers up your next hit.
* **Block**: reduces knockback/damage from the front and drains stamina. Raise it just before a hit lands (0.17 s window) for a **perfect block**: the attacker is staggered and you get a counter window.
* **Ring-outs** are the win condition: a fighter is out when their centre crosses the roof edge. Low health makes enemies fly farther; at zero they are dazed.
* **Bowling**: a launched enemy that slams into another transfers momentum.
* Enemies: **Runner** (fast, circles and dives), **Guard** (blocks the front, break it with a smash or flank it), **Bruiser** (armoured, huge overhead smash with a long orange floor warning, tries to herd you toward the edge).
* Enemy attacks are rationed by an attack-token coordinator so they never strike in an unavoidable burst, and every attack shows an orange floor telegraph.
* After each wave pick 1 of 3 upgrades (Heavy Hands, Quick Feet, Iron Guard, Steady Breath, Second Wind).

## Controller support (mandatory feature, built first)

* Discovery via `navigator.getGamepads()`, `gamepadconnected`/`gamepaddisconnected`; handles null entries, several controllers (the one you touch last is active), reconnects, and non-standard mappings.
* **Layouts are never guessed.** Pads that report `mapping: "standard"` get the defaults above. Any other pad (like many wireless-dongle controllers) starts *unconfigured*: the first button press opens a **guided setup** that learns your sticks, buttons, triggers, and D-pad (including hat-switch D-pads), so it works controller-only.
* **Controller setup** (main menu and pause menu): connection status, reported name/ID, mapping type, live button/axis/trigger readout, stick drift measurement with a dead-zone ring, dead-zone slider (default 0.16, radial with rescaling), vibration toggle/test, per-action rebinding, reset to defaults, "use standard layout" as an explicit choice.
* Bindings and dead zone persist per controller model in `localStorage`; invalid/outdated data is discarded safely.
* Game code only sees semantic actions (`move`, `lightAttack`, `heavyAttack`, `dodge`, `block`, `pause`, `confirm`, `cancel`, `navigate`). Press **edges** are separated from held state, so one press = one action; short input buffering makes chains forgiving.
* Haptics are feature-detected and optional.

### Manual controller test (Windows, wireless dongle pad)

1. Plug in the dongle, switch the controller on (if it has an Analog/mode button, make sure the sticks are in analog mode).
2. Open the game in Chrome, **press any button** (browsers hide controllers until used). The title screen shows the controller name; if the layout is unknown, Controller setup opens automatically.
3. Follow the guided setup: push the stick right, then up, then press the requested buttons. Skip a step with `Enter` on the keyboard, cancel with `Esc`.
4. In **Controller setup** confirm: pressing each physical button lights the matching cell, sticks move the dots, idle drift reads inside the dead-zone ring (raise the dead zone if not).
5. Navigate every menu with D-pad + confirm/cancel only; start a run; check movement is smooth, diagonals are not faster, dodge follows the stick, one press = one punch even if held, block works (analog or digital trigger).
6. Unplug the dongle mid-run: the game pauses with a message. Plug back in; press a button; resume.
7. Reload the page: your bindings and dead zone are still there.
8. Press `F3` at any time for the raw live readout if something maps oddly.

If nothing shows: check the pad in Windows (`Win+R` → `joy.cpl`), try the other X/D mode switch, and try Edge.

## Architecture

```
src/
  main.js                 bootstrap
  config/                 gameConfig.js (all balance numbers), controlsConfig.js
  util/                   EventBus, Rng (seedable), math, Storage (never throws)
  game/
    Battle.js             renderer-free simulation (fixed 1/60 step)
    Game.js               loop, renderer, UI, state flow; GameState.js (explicit state machine)
    Presentation.js       sim events -> fx / audio / haptics / camera / HUD text
    WaveManager.js ScoreManager.js UpgradeManager.js
  entities/               Character (state machine), Player, Enemy, PlayerController,
                          CharacterModel (procedural rig), CharacterAnimator, CharacterView
  combat/                 Attack (phases + hit set), HitDetection, KnockbackSystem,
                          CombatSystem, CollisionSystem, StaminaSystem, RingOutSystem
  ai/                     EnemyAI (state machine), Bruiser/Runner/GuardAI, AttackCoordinator
  input/                  InputManager, KeyboardInput, GamepadInput, ControlBindings, InputUtils
  world/                  Arena, Environment, Lighting, CameraController, Textures (procedural)
  fx/Effects.js           instanced particles, rings, telegraph decals
  audio/AudioManager.js   Web Audio synthesis (no asset files)
  ui/                     HUD, UIManager, Screen base, menus, ControllerSetup, ControllerDebugPanel
tests/                    combat, game, input, ai
```

Key decisions:

* **Custom physics, no engine.** Knockback is velocity + exponential damping, which is predictable and tunable; Rapier would add weight for no gain here.
* **Fixed timestep (60 Hz)** with render interpolation, so combat is frame-rate independent and smooth on 144 Hz displays; frame gaps are clamped so tab switches do not cause physics jumps, and hit-stop pauses simulation, not rendering.
* **Simulation never imports Three.js**, so the whole game logic (waves, AI, combat, scoring) is unit-tested and soak-tested headlessly.
* **Art** is fully procedural (canvas textures, low-poly rigs with inverted-hull outlines, merged static environment) so there are no external assets to license.

All balance values live in `src/config/gameConfig.js`.

## Debug aids

`window.__knockback` is the running game. `advance(n)` runs frames synchronously, `headless = true` skips rendering for fast soak runs, `cc.lock(dist, x, y, z)` freezes the camera for close-ups.

## Known limitations

See the bottom of the project report in the chat, or:

* Physical-controller play was verified with injected fake pads that mimic a real generic USB adapter, not by pressing a real pad; do the manual test above on your hardware.
* Rendering performance was only checked structurally (draw calls, merged geometry), not on a real GPU. The game lowers resolution, then shadows, automatically if it cannot hold ~40 fps; toggle shadows in Settings.
* Audio is synthesized and unmastered by a sound designer; Chrome may keep audio muted until the first keypress/click (a gamepad press may not count as a gesture).
* No mobile/touch controls (explicitly out of scope for v1), no music track.
