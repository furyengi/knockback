import * as THREE from 'three';
import { CharacterModel } from './CharacterModel.js';
import { CharacterAnimator } from './CharacterAnimator.js';
import { STATE } from './Character.js';
import { PHASE } from '../combat/Attack.js';
import { PALETTE } from '../world/Textures.js';
import { clamp } from '../util/math.js';

export const MODEL_SCALE = 0.92;
const TRAIL_POINTS = 12;

const _v = new THREE.Vector3();
const _w = new THREE.Color();
const _x = new THREE.Color();
const FLASH = new THREE.Color(0.8, 0.8, 0.8);
const WARN = new THREE.Color(PALETTE.orange);

/** Swoosh ribbon behind a fist. Vertex alpha fades from head to tail. */
class Trail {
  constructor(scene, color) {
    this.scene = scene;
    this.n = TRAIL_POINTS;
    this.pts = [];
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 2 * 3);
    this.col = new Float32Array(this.n * 2 * 4);
    const idx = [];
    for (let i = 0; i < this.n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.color = new THREE.Color(color);
    this.width = 0.12;
    this.age = 99;
    scene.add(this.mesh);
  }

  setColor(c, width) {
    this.color.set(c);
    this.width = width;
  }

  push(x, y, z, px, pz) {
    this.pts.unshift({ x, y, z, px, pz, t: 0 });
    if (this.pts.length > this.n) this.pts.pop();
    this.age = 0;
  }

  update(dt) {
    this.age += dt;
    for (const p of this.pts) p.t += dt;
    while (this.pts.length && this.pts[this.pts.length - 1].t > 0.16) this.pts.pop();
    if (this.pts.length < 2) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const n = this.pts.length;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const fade = i < n ? clamp(1 - p.t / 0.16, 0, 1) : 0;
      const w = this.width * (1 - i / this.n * 0.5) * (i < n ? 1 : 0);
      this.pos[i * 6 + 0] = p.x + p.px * w;
      this.pos[i * 6 + 1] = p.y;
      this.pos[i * 6 + 2] = p.z + p.pz * w;
      this.pos[i * 6 + 3] = p.x - p.px * w;
      this.pos[i * 6 + 4] = p.y;
      this.pos[i * 6 + 5] = p.z - p.pz * w;
      for (let k = 0; k < 2; k++) {
        const o = i * 8 + k * 4;
        this.col[o] = this.color.r;
        this.col[o + 1] = this.color.g;
        this.col[o + 2] = this.color.b;
        this.col[o + 3] = fade * 0.75;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

export class CharacterView {
  constructor(char, scene) {
    this.char = char;
    this.scene = scene;
    this.model = new CharacterModel(char.type);
    this.anim = new CharacterAnimator(this.model);
    this.scale = char.scale * MODEL_SCALE;
    this.model.root.scale.setScalar(this.scale);
    scene.add(this.model.root);
    this.model.root.traverse((o) => {
      if (o.isMesh && !o.userData.isOutline) o.receiveShadow = false;
    });
    this.trail = new Trail(scene, char.isPlayer ? PALETTE.lime : PALETTE.orange);
    this.stars = null;
    this.glow = 0;
    this.dead = false;
    this.lastTrailHand = null;
    this.update(0, 1);
  }

  #ensureStars() {
    if (this.stars) return;
    this.stars = new THREE.Group();
    const g = new THREE.OctahedronGeometry(0.07);
    const m = new THREE.MeshBasicMaterial({ color: PALETTE.offWhite });
    this.starGeo = g;
    this.starMat = m;
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(g, m);
      this.stars.add(s);
    }
    this.stars.position.y = 0.62;
    this.model.head.add(this.stars);
  }

  update(dt, alpha = 1) {
    const c = this.char;
    const m = this.model;
    const a0 = alpha;
    // interpolate between the last two fixed simulation steps for smooth motion at any refresh rate
    const x = c.px + (c.x - c.px) * a0;
    const y = c.py + (c.y - c.py) * a0;
    const z = c.pz + (c.z - c.pz) * a0;
    const fd = Math.atan2(Math.sin(c.facing - c.pf), Math.cos(c.facing - c.pf));
    m.root.position.set(x, Math.max(y, -50), z);
    m.root.rotation.y = c.pf + fd * a0;
    this.anim.update(c, Math.max(dt, 1e-5));

    // emissive: hit flash (white) and attack telegraph (orange-red)
    let flash = c.hitFlash > 0 ? clamp(c.hitFlash / 0.14, 0, 1) : 0;
    let warn = 0;
    const a = c.attack;
    if (c.team === 'enemy' && a && c.state === STATE.ATTACK && a.phase === PHASE.WINDUP) {
      const p = a.progress;
      warn = (a.kind === 'heavy' ? 0.6 : 0.4) * p * (0.75 + 0.25 * Math.sin(c.clock * 40));
    }
    if (c.team === 'enemy' && a && a.phase === PHASE.ACTIVE) warn = 0.65;
    if (c.counterWindow > 0 && c.isPlayer) warn = Math.max(warn, 0.18 * (0.6 + 0.4 * Math.sin(c.clock * 24)));
    if (flash > 0 || warn > 0) {
      _w.copy(FLASH).multiplyScalar(flash).add(_x.copy(WARN).multiplyScalar(warn));
      m.setEmissive(_w, 0.9);
    } else if (this.glow) {
      m.setEmissive(_w.set(0, 0, 0), 0);
    }
    this.glow = flash > 0 || warn > 0 ? 1 : 0;

    // dazed stars
    if (c.dazed && c.state === STATE.STAGGER) {
      this.#ensureStars();
      this.stars.visible = true;
      this.stars.children.forEach((s, i) => {
        const ang = c.clock * 5 + (i * Math.PI * 2) / 3;
        s.position.set(Math.sin(ang) * 0.32, Math.sin(c.clock * 7 + i) * 0.04, Math.cos(ang) * 0.32);
        s.rotation.y = ang * 2;
      });
    } else if (this.stars) this.stars.visible = false;

    this.#updateTrail(dt);
  }

  fistWorld(side, out) {
    return (side < 0 ? this.model.fistL : this.model.fistR).getWorldPosition(out);
  }

  #updateTrail(dt) {
    const c = this.char;
    const a = c.attack;
    let emit = false;
    if (a && c.state === STATE.ATTACK) {
      emit = (a.phase === PHASE.WINDUP && a.progress > 0.5) || a.phase === PHASE.ACTIVE || (a.phase === PHASE.RECOVERY && a.progress < 0.28);
    }
    if (emit) {
      this.model.root.updateMatrixWorld(true);
      const heavy = a.kind === 'heavy';
      if (heavy) {
        this.fistWorld(1, _v);
        const x1 = _v.x, y1 = _v.y, z1 = _v.z;
        this.fistWorld(-1, _v);
        const mx = (x1 + _v.x) / 2, my = (y1 + _v.y) / 2, mz = (z1 + _v.z) / 2;
        const right = c.facing;
        this.trail.setColor(c.isPlayer ? PALETTE.offWhite : PALETTE.orange, 0.55);
        this.trail.push(mx, my, mz, Math.cos(right), -Math.sin(right));
      } else {
        this.fistWorld(a.side > 0 ? 1 : -1, _v);
        this.trail.setColor(c.isPlayer ? PALETTE.lime : PALETTE.offWhite, 0.13);
        this.trail.push(_v.x, _v.y, _v.z, Math.cos(c.facing), -Math.sin(c.facing));
      }
    }
    this.trail.update(dt);
  }

  dispose() {
    this.trail.dispose();
    this.starGeo?.dispose();
    this.starMat?.dispose();
    this.model.dispose();
  }
}

/** Keeps a view per live character; removed characters are disposed. */
export class CharacterViews {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map();
  }
  add(char) {
    if (this.views.has(char.id)) return this.views.get(char.id);
    const v = new CharacterView(char, this.scene);
    this.views.set(char.id, v);
    return v;
  }
  remove(char) {
    const v = this.views.get(char.id);
    if (!v) return;
    v.dispose();
    this.views.delete(char.id);
  }
  get(char) {
    return this.views.get(char.id);
  }
  update(dt, alpha = 1) {
    for (const v of this.views.values()) v.update(dt, alpha);
  }
  clear() {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
  }
}
