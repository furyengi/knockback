import '@fontsource/anton/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles/main.css';
import { Game } from './game/Game.js';

function boot() {
  const canvas = document.getElementById('game');
  try {
    const game = new Game({
      canvas,
      appRoot: document.getElementById('app'),
      hudRoot: document.getElementById('hud'),
      screensRoot: document.getElementById('screens'),
      toastRoot: document.getElementById('toasts'),
    });
    window.__knockback = game; // handy for debugging and automated checks
  } catch (err) {
    console.error(err);
    document.getElementById('app').insertAdjacentHTML(
      'beforeend',
      '<div class="fatal"><h1>Knockback could not start</h1><p>This game needs WebGL. Try Chrome or Edge with hardware acceleration enabled.</p><pre></pre></div>',
    );
    document.querySelector('.fatal pre').textContent = String(err && err.message ? err.message : err);
  }
}
boot();
