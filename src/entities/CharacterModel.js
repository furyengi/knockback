import * as THREE from 'three';
import { PALETTE } from '../world/Textures.js';

// Procedural low-poly fighters: chunky proportions, big gloved fists, clear silhouettes.
// Each archetype is a data-driven outfit applied to the same rig so animation is shared.
//
// Rig (all pivots are Groups so the animator can rotate them):
//   root -> tumble -> hips -> torso -> head
//                          -> shoulderL/R -> elbowL/R (forearm + fist)
//                   hips -> hipL/R -> kneeL/R (shin + shoe)

const OUTLINE_COLOR = 0x14110f;

export const OUTFITS = {
  player: {
    skin: '#8a5a3c',
    top: '#efe6d3',
    topAccent: '#c6ff3d',
    bottom: '#2a2929',
    bottomAccent: '#c6ff3d',
    shoe: '#efe6d3',
    shoeSole: '#c6ff3d',
    glove: '#efe6d3',
    cuff: '#c6ff3d',
    hair: '#161412',
    headgear: 'headband',
    headAccent: '#c6ff3d',
    bulk: 1.0,
    arm: 1.0,
    fist: 1.0,
  },
  runner: {
    skin: '#b27a54',
    top: '#c8923a',
    topAccent: '#efe6d3',
    bottom: '#2f2d2c',
    bottomAccent: '#efe6d3',
    shoe: '#efe6d3',
    shoeSole: '#2a2929',
    glove: '#2f2d2c',
    cuff: '#ff5a2a',
    hair: '#161412',
    headgear: 'beanie',
    headAccent: '#ff5a2a',
    bulk: 0.86,
    arm: 0.88,
    fist: 0.9,
  },
  guard: {
    skin: '#5d3d2c',
    top: '#56616b',
    topAccent: '#efe6d3',
    bottom: '#2a2929',
    bottomAccent: '#56616b',
    shoe: '#171616',
    shoeSole: '#56616b',
    glove: '#2a2929',
    cuff: '#efe6d3',
    hair: '#161412',
    headgear: 'helmet',
    headAccent: '#ff5a2a',
    bulk: 1.12,
    arm: 1.05,
    fist: 1.0,
    shield: true,
  },
  bruiser: {
    skin: '#7a4b34',
    top: '#2c2a29',
    topAccent: '#ff5a2a',
    bottom: '#6b5d50',
    bottomAccent: '#2a2929',
    shoe: '#171616',
    shoeSole: '#ff5a2a',
    glove: '#3a3735',
    cuff: '#ff5a2a',
    hair: '#161412',
    headgear: 'bald',
    headAccent: '#161412',
    bulk: 1.28,
    arm: 1.3,
    fist: 1.4,
    beard: true,
  },
};

// ---- shared geometry cache -------------------------------------------------------------
const geoCache = new Map();
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
export function disposeSharedGeometry() {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}
const G = {
  capsule: (r, len, seg = 5) => geo(`cap${r}_${len}_${seg}`, () => new THREE.CapsuleGeometry(r, len, 3, seg + 1)),
  sphere: (r, w = 9, h = 7) => geo(`sph${r}_${w}_${h}`, () => new THREE.SphereGeometry(r, w, h)),
  cyl: (rt, rb, h, seg = 8) => geo(`cyl${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
  box: (w, h, d) => geo(`box${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cone: (r, h, seg = 7) => geo(`cone${r}_${h}_${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  half: (r) => geo(`half${r}`, () => new THREE.SphereGeometry(r, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
};

// A single shared outline material: inverted hull, pushed out along normals.
let outlineMat = null;
function getOutlineMaterial() {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
    outlineMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(normal) * 0.028;');
    };
    outlineMat.customProgramCacheKey = () => 'kb-outline';
  }
  return outlineMat;
}
export function disposeOutlineMaterial() {
  outlineMat?.dispose();
  outlineMat = null;
}

export class CharacterModel {
  /**
   * @param {string} type 'player' | 'runner' | 'guard' | 'bruiser'
   */
  constructor(type) {
    this.type = type;
    this.outfit = OUTFITS[type];
    this.materials = []; // per-character materials (flash / telegraph tint)
    this.root = new THREE.Group();
    this.tumble = new THREE.Group();
    this.hips = new THREE.Group();
    this.torso = new THREE.Group();
    this.head = new THREE.Group();
    this.shoulderL = new THREE.Group();
    this.shoulderR = new THREE.Group();
    this.elbowL = new THREE.Group();
    this.elbowR = new THREE.Group();
    this.hipL = new THREE.Group();
    this.hipR = new THREE.Group();
    this.kneeL = new THREE.Group();
    this.kneeR = new THREE.Group();
    this.fistL = new THREE.Group();
    this.fistR = new THREE.Group();
    this.shield = null;
    this.build();
  }

  mat(color, rough = 0.78) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02, flatShading: true });
    m.userData.baseEmissive = new THREE.Color(0x000000);
    this.materials.push(m);
    return m;
  }

  part(geometry, material, parent, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, outline = true, shadow = true } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = shadow;
    if (outline) {
      const o = new THREE.Mesh(geometry, getOutlineMaterial());
      o.userData.isOutline = true;
      mesh.add(o);
    }
    parent.add(mesh);
    return mesh;
  }

  build() {
    const o = this.outfit;
    const bulk = o.bulk;
    const armK = o.arm;
    const skin = this.mat(o.skin, 0.7);
    const top = this.mat(o.top);
    const topAccent = this.mat(o.topAccent);
    const bottom = this.mat(o.bottom);
    const bottomAccent = this.mat(o.bottomAccent);
    const shoe = this.mat(o.shoe, 0.6);
    const sole = this.mat(o.shoeSole, 0.8);
    const glove = this.mat(o.glove, 0.55);
    const cuff = this.mat(o.cuff, 0.6);
    const hair = this.mat(o.hair, 0.9);
    const dark = this.mat('#14110f', 0.9);
    const white = this.mat('#ffffff', 0.5);

    const { root, tumble, hips, torso, head } = this;
    root.add(tumble);
    tumble.add(hips);
    hips.position.y = 0.86;

    // --- pelvis & shorts
    this.part(G.cyl(0.3 * bulk, 0.34 * bulk, 0.34, 9), bottom, hips, { y: 0.0 });
    this.part(G.box(0.05, 0.3, 0.2 * bulk), bottomAccent, hips, { x: 0.33 * bulk, y: -0.02, outline: false });
    this.part(G.box(0.05, 0.3, 0.2 * bulk), bottomAccent, hips, { x: -0.33 * bulk, y: -0.02, outline: false });

    // --- torso
    hips.add(torso);
    torso.position.y = 0.08;
    const torsoMesh = this.part(G.cyl(0.4 * bulk, 0.3 * bulk, 0.6, 9), top, torso, { y: 0.32 });
    torsoMesh.scale.z = 0.8;
    // chest shape: shoulder yoke
    this.part(G.capsule(0.15, 0.62 * bulk, 5), top, torso, { y: 0.54, rz: Math.PI / 2 });
    // accent stripes (hem + chest) so the outfit reads at a distance
    this.part(G.cyl(0.318 * bulk, 0.325 * bulk, 0.06, 9), topAccent, torso, { y: 0.04, sz: 0.82, outline: false });
    this.part(G.cyl(0.405 * bulk, 0.4 * bulk, 0.05, 9), topAccent, torso, { y: 0.46, sz: 0.82, outline: false });

    // --- head
    torso.add(head);
    head.position.y = 0.66;
    this.part(G.sphere(0.265, 10, 8), skin, head, { y: 0.2, sy: 1.0, sx: 1.05 });
    this.part(G.box(0.12, 0.1, 0.1), skin, head, { y: 0.16, z: 0.26, outline: false }); // nose
    // eyes + brow: expressive front
    const eyeGeo = G.sphere(0.04, 6, 5);
    this.part(eyeGeo, white, head, { x: -0.1, y: 0.25, z: 0.235, sy: 1.15, outline: false, shadow: false });
    this.part(eyeGeo, white, head, { x: 0.1, y: 0.25, z: 0.235, sy: 1.15, outline: false, shadow: false });
    this.part(G.sphere(0.022, 5, 4), dark, head, { x: -0.1, y: 0.25, z: 0.27, outline: false, shadow: false });
    this.part(G.sphere(0.022, 5, 4), dark, head, { x: 0.1, y: 0.25, z: 0.27, outline: false, shadow: false });
    this.part(G.box(0.12, 0.03, 0.04), dark, head, { x: -0.1, y: 0.31, z: 0.255, rz: -0.18, outline: false, shadow: false });
    this.part(G.box(0.12, 0.03, 0.04), dark, head, { x: 0.1, y: 0.31, z: 0.255, rz: 0.18, outline: false, shadow: false });
    this.#headgear(head, hair, dark, o);

    // --- arms
        const armR = 0.115 * armK;
    for (const side of [-1, 1]) {
      const shoulder = side < 0 ? this.shoulderL : this.shoulderR;
      const elbow = side < 0 ? this.elbowL : this.elbowR;
      const fist = side < 0 ? this.fistL : this.fistR;
      torso.add(shoulder);
      shoulder.position.set(side * (0.52 * bulk + 0.02), 0.56, 0);
      // upper arm: skin (bare arm) or sleeve for top-heavy outfits
      this.part(G.sphere(armR * 1.35, 8, 6), top, shoulder, { y: 0.0, outline: true });
      this.part(G.capsule(armR, 0.2, 5), skin, shoulder, { y: -0.2 });
      shoulder.add(elbow);
      elbow.position.y = -0.38;
      this.part(G.capsule(armR * 0.95, 0.14, 5), skin, elbow, { y: -0.16 });
      // glove / fist: oversized so punches read
      elbow.add(fist);
      fist.position.y = -0.36;
      const fs = o.fist;
      this.part(G.sphere(0.19 * fs, 9, 7), glove, fist, { y: -0.04, sy: 0.95 });
      this.part(G.cyl(0.155 * fs, 0.16 * fs, 0.1, 9), cuff, fist, { y: 0.12 * fs, outline: false });
    }

    // guard shield on the left forearm
    if (o.shield) {
      const s = new THREE.Group();
      this.elbowL.add(s);
      s.position.set(-0.06, -0.2, 0.14);
      this.part(G.box(0.12, 0.74, 0.5), this.mat('#56616b', 0.55), s, { rz: 0.0, y: -0.05 });
      this.part(G.box(0.07, 0.55, 0.32), this.mat('#efe6d3', 0.6), s, { x: -0.07, y: -0.05, outline: false });
      this.part(G.box(0.08, 0.1, 0.5), this.mat('#ff5a2a', 0.6), s, { x: -0.01, y: 0.3, outline: false });
      this.shield = s;
    }

    // --- legs
    for (const side of [-1, 1]) {
      const hip = side < 0 ? this.hipL : this.hipR;
      const knee = side < 0 ? this.kneeL : this.kneeR;
      hips.add(hip);
      hip.position.set(side * 0.18 * bulk, -0.1, 0);
      this.part(G.capsule(0.14 * bulk, 0.14, 5), skin, hip, { y: -0.18 });
      this.part(G.cyl(0.165 * bulk, 0.15 * bulk, 0.28, 8), bottom, hip, { y: -0.15 });
      hip.add(knee);
      knee.position.y = -0.36;
      this.part(G.capsule(0.12 * bulk, 0.1, 5), skin, knee, { y: -0.18 });
      // shoe
      this.part(G.box(0.24 * bulk, 0.12, 0.42), shoe, knee, { y: -0.33, z: 0.07 });
      this.part(G.box(0.26 * bulk, 0.06, 0.45), sole, knee, { y: -0.38, z: 0.07, outline: false });
    }

    if (o.beard) {
      this.part(G.sphere(0.2, 8, 6), hair, head, { y: 0.05, z: 0.09, sy: 0.7, sx: 1.1 });
    }
    // The lowest foot point sits at hips.y - 0.12 - 0.46 - 0.5 = 0 -> feet touch y=0.
  }

  #headgear(head, hair, dark, o) {
    const accent = this.mat(o.headAccent, 0.7);
    switch (o.headgear) {
      case 'headband':
        this.part(G.half(0.275), hair, head, { y: 0.22, sy: 0.95, rx: -0.15 });
        this.part(G.cyl(0.275, 0.275, 0.07, 10), accent, head, { y: 0.31, outline: false });
        // headband tails
        this.part(G.box(0.06, 0.22, 0.03), accent, head, { x: 0.05, y: 0.22, z: -0.3, rx: 0.5, outline: false });
        break;
      case 'beanie':
        this.part(G.half(0.285), accent, head, { y: 0.24, sy: 1.05 });
        this.part(G.cyl(0.285, 0.285, 0.09, 10), this.mat('#2f2d2c'), head, { y: 0.26, outline: false });
        this.part(G.sphere(0.07, 6, 5), this.mat('#efe6d3'), head, { y: 0.55 });
        break;
      case 'helmet': {
        const hm = this.mat('#2f3338', 0.5);
        this.part(G.half(0.31), hm, head, { y: 0.2, sy: 1.1 });
        this.part(G.box(0.46, 0.09, 0.16), this.mat('#14110f'), head, { y: 0.26, z: 0.22, outline: false });
        this.part(G.box(0.06, 0.1, 0.4), accent, head, { y: 0.52, z: 0 , outline: false });
        break;
      }
      case 'bald':
        this.part(G.cyl(0.02, 0.02, 0.01, 4), hair, head, { y: 0.5, outline: false, shadow: false });
        break;
      default:
        this.part(G.half(0.275), hair, head, { y: 0.22 });
    }
  }

  setEmissive(color, intensity) {
    for (let i = 0; i < this.materials.length; i++) {
      const m = this.materials[i];
      m.emissive.copy(color);
      m.emissiveIntensity = intensity;
    }
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    this.root.removeFromParent();
  }
}
