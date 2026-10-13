import * as THREE from 'three';
import { Rng } from '../util/Rng.js';

// Procedural canvas textures: no image assets, fully offline, deterministic.
export const PALETTE = {
  concrete: '#cdbda4',
  concreteDark: '#a8987f',
  offWhite: '#efe6d3',
  charcoal: '#2a2929',
  nearBlack: '#171616',
  lime: '#c6ff3d',
  orange: '#ff5a2a',
  haze: '#ecd3b0',
  skyTop: '#e9b98a',
  skyHorizon: '#f6e4c8',
  distant: '#bda98f',
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Warm roof concrete: grain, blotches, expansion joints and a centre ring marking. */
export function makeRoofTexture(size = 2048, half = 9) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const rng = new Rng(4242);
  g.fillStyle = PALETTE.concrete;
  g.fillRect(0, 0, size, size);

  // large soft tonal patches
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(80, 320);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const light = rng.chance(0.5);
    const a = rng.range(0.03, 0.09);
    gr.addColorStop(0, light ? `rgba(255,244,222,${a})` : `rgba(120,98,70,${a})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // panels with expansion joints
  const panels = 4;
  const step = size / panels;
  for (let i = 0; i < panels; i++) {
    for (let j = 0; j < panels; j++) {
      const tone = rng.range(-9, 9);
      g.fillStyle = `rgba(${tone > 0 ? '255,248,232' : '70,52,30'},${Math.abs(tone) / 160})`;
      g.fillRect(i * step, j * step, step, step);
    }
  }
  g.strokeStyle = 'rgba(70,56,40,0.55)';
  g.lineWidth = 3;
  for (let i = 1; i < panels; i++) {
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, size);
    g.moveTo(0, i * step);
    g.lineTo(size, i * step);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,248,232,0.28)';
  g.lineWidth = 2;
  for (let i = 1; i < panels; i++) {
    g.beginPath();
    g.moveTo(i * step + 3, 0);
    g.lineTo(i * step + 3, size);
    g.moveTo(0, i * step + 3);
    g.lineTo(size, i * step + 3);
    g.stroke();
  }

  // stains, cracks, tar patches
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const w = rng.range(20, 120);
    const h = rng.range(14, 70);
    g.fillStyle = `rgba(60,46,32,${rng.range(0.04, 0.12)})`;
    g.beginPath();
    g.ellipse(x, y, w, h, rng.range(0, 3), 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(60,46,32,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    let x = rng.range(0, size);
    let y = rng.range(0, size);
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += rng.range(-34, 34);
      y += rng.range(-34, 34);
      g.lineTo(x, y);
    }
    g.stroke();
  }

  // fine grain
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * 22;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.9;
  }
  g.putImageData(img, 0, 0);

  // painted markings: centre ring and tick marks (flat, readable, not clutter)
  const ppm = size / (half * 2);
  const cx = size / 2;
  g.strokeStyle = 'rgba(239,230,211,0.8)';
  g.lineWidth = 0.1 * ppm;
  g.beginPath();
  g.arc(cx, cx, 3.2 * ppm, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 0.06 * ppm;
  g.strokeStyle = 'rgba(239,230,211,0.5)';
  g.beginPath();
  g.arc(cx, cx, 5.9 * ppm, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(42,41,41,0.65)';
  g.lineWidth = 0.08 * ppm;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 2.2 * ppm, cx + Math.sin(a) * 2.2 * ppm);
    g.lineTo(cx + Math.cos(a) * 4.2 * ppm, cx + Math.sin(a) * 4.2 * ppm);
    g.stroke();
  }
  // stencilled arrow chevrons near the corners, orientation hints
  g.fillStyle = 'rgba(42,41,41,0.25)';
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = cx + sx * 6.7 * ppm;
    const py = cx + sz * 6.7 * ppm;
    g.save();
    g.translate(px, py);
    g.rotate(Math.atan2(sz, sx) + Math.PI);
    g.beginPath();
    g.moveTo(0, -0.5 * ppm);
    g.lineTo(0.9 * ppm, 0);
    g.lineTo(0, 0.5 * ppm);
    g.lineTo(0.28 * ppm, 0);
    g.closePath();
    g.fill();
    g.restore();
  }

  return finish(c);
}

/** Diagonal hazard stripes, tileable along U. */
export function makeHazardTexture() {
  const w = 256;
  const h = 64;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = PALETTE.charcoal;
  g.fillRect(0, 0, w, h);
  g.fillStyle = PALETTE.orange;
  const sw = 32;
  for (let x = -h; x < w + h; x += sw * 2) {
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x + sw, h);
    g.lineTo(x + sw + h, 0);
    g.lineTo(x + h, 0);
    g.closePath();
    g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, w, 3);
  return finish(c, { repeat: true });
}

/** Building facade: warm plaster, window grid, shutters, balconies, AC boxes. */
export function makeFacadeTexture({ seed = 1, base = '#d9c7a8', win = '#3a3633', cols = 8, rows = 14, size = 512, tint = null } = {}) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const rng = new Rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${rng.chance(0.5) ? '255,245,225' : '80,60,40'},${rng.range(0.02, 0.07)})`;
    g.fillRect(rng.range(0, size), rng.range(0, size), rng.range(20, 160), rng.range(20, 160));
  }
  const cw = size / cols;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * 0.2;
      const y = r * rh + rh * 0.18;
      const w = cw * 0.6;
      const h = rh * 0.62;
      const lit = rng.chance(0.14);
      g.fillStyle = lit ? 'rgba(255,214,150,0.9)' : win;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(x, y, w, h * 0.35);
      g.fillStyle = 'rgba(40,34,28,0.5)';
      g.fillRect(x - 2, y + h, w + 4, 3);
      if (rng.chance(0.18)) {
        g.fillStyle = rng.chance(0.5) ? '#8c7f6a' : '#6d6a62';
        g.fillRect(x + w * 0.25, y + h * 0.5, w * 0.6, h * 0.5);
      }
    }
    g.fillStyle = 'rgba(60,46,32,0.18)';
    g.fillRect(0, r * rh + rh * 0.9, size, 2);
  }
  if (tint) {
    g.fillStyle = tint;
    g.fillRect(0, 0, size, size);
  }
  return finish(c, { repeat: true });
}

/** Vertical sky gradient with a soft sun glow. */
export function makeSkyTexture() {
  const c = canvas(16, 512);
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#d9a77a');
  gr.addColorStop(0.45, '#eccaa1');
  gr.addColorStop(0.78, '#f6e4c8');
  gr.addColorStop(1, '#ecd3b0');
  g.fillStyle = gr;
  g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSoftDotTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
