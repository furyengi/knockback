import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../util/Rng.js';
import { PALETTE, makeFacadeTexture, makeSkyTexture } from './Textures.js';

/**
 * Everything around the arena: sky, haze, lower annex roofs with rooftop props, and a
 * Lagos-inspired skyline of low and mid-rise blocks. None of it overlaps the playable
 * square, so it can never affect gameplay.
 */
export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'environment';
    this.disposables = [];
    this.rng = new Rng(90210);

    const sky = makeSkyTexture();
    this.disposables.push(sky);
    scene.background = sky;
    scene.fog = new THREE.Fog(new THREE.Color(PALETTE.haze), 38, 150);

    this.mats = {
      facades: [
        this.#mat({ map: this.#tex({ seed: 11, base: '#c9bba3' }), color: '#d2cdc6' }),
        this.#mat({ map: this.#tex({ seed: 23, base: '#bcae98', win: '#46403a' }), color: '#cfcac4' }),
        this.#mat({ map: this.#tex({ seed: 37, base: '#d6cab4', win: '#37332f' }), color: '#d9d4cc' }),
        this.#mat({ map: this.#tex({ seed: 41, base: '#a99d89', win: '#3d3833' }), color: '#c8c3bb' }),
      ],
      roofTop: this.#mat({ color: '#938a7e', roughness: 1 }),
      concrete: this.#mat({ color: PALETTE.concrete, roughness: 0.95 }),
      offWhite: this.#mat({ color: PALETTE.offWhite, roughness: 0.8 }),
      charcoal: this.#mat({ color: PALETTE.charcoal, roughness: 0.7 }),
      steel: this.#mat({ color: '#7d8a8c', roughness: 0.55, metalness: 0.35 }),
      rust: this.#mat({ color: '#8c5a43', roughness: 0.85 }),
      dark: this.#mat({ color: '#2e2b29', roughness: 0.9 }),
      cloth: [
        this.#mat({ color: '#efe6d3', roughness: 1, side: THREE.DoubleSide }),
        this.#mat({ color: '#c99a3c', roughness: 1, side: THREE.DoubleSide }),
        this.#mat({ color: '#6f9a93', roughness: 1, side: THREE.DoubleSide }),
        this.#mat({ color: '#b25a3f', roughness: 1, side: THREE.DoubleSide }),
      ],
    };

    this.#street();
    this.#annexes();
    this.#skyline();
    this.#mergeStatic();
    scene.add(this.group);
  }

  #tex(opts) {
    const t = makeFacadeTexture({ cols: 7, rows: 16, ...opts });
    t.repeat.set(1, 1);
    this.disposables.push(t);
    return t;
  }
  #mat(opts) {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.95, ...opts });
    this.disposables.push(m);
    return m;
  }
  #box(w, h, d, mat, x, y, z, { cast = true, receive = true, parent = this.group } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    this.disposables.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  }
  #cyl(rt, rb, h, seg, mat, x, y, z, parent = this.group) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    this.disposables.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  #street() {
    const g = new THREE.PlaneGeometry(900, 900);
    this.disposables.push(g);
    const m = new THREE.Mesh(g, this.#mat({ color: '#6f6354' }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = -92;
    this.group.add(m);
  }

  /** Lower neighbouring roofs hugging the arena, where the rooftop props live. */
  #annexes() {
    const M = this.mats;
    const defs = [
      { x: -2, z: -18.5, w: 26, d: 17, top: -2.6, tag: 'back' },
      { x: -17.5, z: 1, w: 15, d: 22, top: -3.4, tag: 'left' },
      { x: 18, z: -3, w: 15, d: 22, top: -1.9, tag: 'right' },
    ];
    for (const a of defs) {
      const height = 80;
      const body = this.#box(a.w, height, a.d, M.facades[Math.floor(this.rng.next() * 4)], a.x, a.top - height / 2, a.z);
      body.material = body.material; // shared
      // roof surface
      this.#box(a.w + 0.3, 0.3, a.d + 0.3, M.roofTop, a.x, a.top - 0.15, a.z);
      // low parapet around the annex
      const t = 0.3;
      const ph = 0.55;
      this.#box(a.w + 0.3, ph, t, M.offWhite, a.x, a.top + ph / 2, a.z - a.d / 2);
      this.#box(a.w + 0.3, ph, t, M.offWhite, a.x, a.top + ph / 2, a.z + a.d / 2);
      this.#box(t, ph, a.d, M.offWhite, a.x - a.w / 2, a.top + ph / 2, a.z);
      this.#box(t, ph, a.d, M.offWhite, a.x + a.w / 2, a.top + ph / 2, a.z);
      a.m = M;
    }
    const [back, left, right] = defs;

    // --- back annex: the hero skyline silhouette behind the fight
    this.#waterTank(-9, back.top, -20);
    this.#waterTank(-5.4, back.top, -22.5, 0.8);
    this.#stairHouse(8, back.top, -21);
    this.#dish(2.5, back.top, -15.5, 0.4);
    this.#dish(-13, back.top, -14.5, -0.3);
    this.#vent(-1, back.top, -17);
    this.#vent(0.4, back.top, -17.4);
    this.#acRow(11, back.top, -14.3, 3);
    this.#mast(13.5, back.top, -23);
    this.#pipeRun(-12, back.top, -12.4, 9, 'x');
    this.#clothesline(3.2, back.top, -12.2, 5);

    // --- left annex
    this.#acRow(-13.3, left.top, -5, 3, true);
    this.#vent(-15, left.top, 5);
    this.#vent(-14.2, left.top, 6.2);
    this.#dish(-19, left.top, 8, 0.9);
    this.#pipeRun(-12.6, left.top, -9, 12, 'z');
    this.#waterTank(-20, left.top, -6, 0.7);

    // --- right annex
    this.#stairHouse(20, right.top, -8, 0.8);
    this.#dish(13.8, right.top, 2, -0.6);
    this.#vent(15.6, right.top, 6);
    this.#clothesline(14.5, right.top, -4, 6, true);
    this.#acRow(14, right.top, 9, 3, true);
    this.#mast(21.5, right.top, 5);
  }

  #waterTank(x, topY, z, s = 1) {
    const g = new THREE.Group();
    g.position.set(x, topY, z);
    g.scale.setScalar(s);
    const M = this.mats;
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      this.#box(0.14, 1.5, 0.14, M.dark, lx, 0.75, lz, { parent: g });
    }
    this.#box(1.9, 0.12, 1.9, M.dark, 0, 1.5, 0, { parent: g });
    this.#cyl(1.15, 1.15, 1.9, 14, M.steel, 0, 2.5, 0, g);
    const cap = this.#cyl(0.05, 1.18, 0.5, 14, M.steel, 0, 3.7, 0, g);
    cap.castShadow = true;
    for (const y of [1.9, 2.5, 3.1]) {
      const band = this.#cyl(1.17, 1.17, 0.07, 14, M.dark, 0, y, 0, g);
      band.castShadow = false;
    }
    this.group.add(g);
  }

  #stairHouse(x, topY, z, rot = 0) {
    const g = new THREE.Group();
    g.position.set(x, topY, z);
    g.rotation.y = rot;
    const M = this.mats;
    this.#box(3.6, 2.7, 3, M.offWhite, 0, 1.35, 0, { parent: g });
    this.#box(3.9, 0.22, 3.3, M.concrete, 0, 2.8, 0, { parent: g });
    this.#box(0.9, 1.8, 0.1, M.dark, 0.6, 0.9, 1.52, { parent: g });
    this.#box(1.1, 0.5, 0.1, M.dark, -0.9, 1.5, 1.52, { parent: g });
    this.group.add(g);
  }

  #dish(x, topY, z, rot) {
    const g = new THREE.Group();
    g.position.set(x, topY, z);
    g.rotation.y = rot;
    const M = this.mats;
    this.#cyl(0.07, 0.09, 1.6, 6, M.dark, 0, 0.8, 0, g);
    const dishGeo = new THREE.SphereGeometry(0.85, 14, 8, 0, Math.PI * 2, 0, 0.95);
    this.disposables.push(dishGeo);
    const dish = new THREE.Mesh(dishGeo, M.offWhite);
    dish.material = M.offWhite;
    dish.position.set(0, 1.75, 0.05);
    dish.rotation.x = Math.PI / 2 - 0.35;
    dish.castShadow = true;
    g.add(dish);
    this.#cyl(0.03, 0.03, 0.9, 5, M.dark, 0, 1.85, 0.5, g).rotation.x = Math.PI / 2;
    this.group.add(g);
  }

  #vent(x, topY, z) {
    const g = new THREE.Group();
    g.position.set(x, topY, z);
    const M = this.mats;
    this.#cyl(0.28, 0.32, 0.9, 8, M.steel, 0, 0.45, 0, g);
    this.#cyl(0.05, 0.5, 0.28, 8, M.steel, 0, 1.05, 0, g);
    this.group.add(g);
  }

  #acRow(x, topY, z, n, vertical = false) {
    const M = this.mats;
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      g.position.set(vertical ? x : x + i * 1.35, topY, vertical ? z + i * 1.35 : z);
      this.#box(1, 0.8, 0.9, M.offWhite, 0, 0.4, 0, { parent: g });
      this.#box(0.78, 0.5, 0.06, M.dark, 0, 0.42, vertical ? 0.47 : 0.47, { parent: g });
      this.#cyl(0.32, 0.32, 0.06, 10, M.dark, 0, 0.83, 0, g);
      this.group.add(g);
    }
  }

  #mast(x, topY, z) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(x, topY, z);
    this.#cyl(0.05, 0.07, 5.5, 5, M.dark, 0, 2.75, 0, g);
    for (const y of [3.4, 4.2, 4.9]) this.#box(1.4 - (y - 3.4) * 0.35, 0.05, 0.05, M.dark, 0, y, 0, { parent: g });
    this.group.add(g);
  }

  #pipeRun(x, topY, z, len, axis) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(x, topY, z);
    const p = this.#cyl(0.14, 0.14, len, 8, M.charcoal, 0, 0.35, 0, g);
    if (axis === 'x') {
      p.rotation.z = Math.PI / 2;
      p.position.x = len / 2;
    } else {
      p.rotation.x = Math.PI / 2;
      p.position.z = len / 2;
    }
    for (let i = 0; i <= 3; i++) {
      const t = (i / 3) * len;
      this.#box(0.12, 0.35, 0.12, M.dark, axis === 'x' ? t : 0, 0.17, axis === 'z' ? t : 0, { parent: g });
    }
    this.group.add(g);
  }

  #clothesline(x, topY, z, len, alongZ = false) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(x, topY, z);
    if (alongZ) g.rotation.y = Math.PI / 2;
    this.#cyl(0.04, 0.04, 2.2, 5, M.dark, 0, 1.1, 0, g);
    this.#cyl(0.04, 0.04, 2.2, 5, M.dark, len, 1.1, 0, g);
    const line = this.#cyl(0.012, 0.012, len, 3, M.dark, len / 2, 2.05, 0, g);
    line.rotation.z = Math.PI / 2;
    line.castShadow = false;
    for (let i = 0; i < 5; i++) {
      const w = 0.45 + this.rng.next() * 0.25;
      const h = 0.6 + this.rng.next() * 0.35;
      const pg = new THREE.PlaneGeometry(w, h);
      this.disposables.push(pg);
      const m = new THREE.Mesh(pg, M.cloth[i % 4]);
      m.position.set(0.5 + (i * (len - 0.8)) / 5, 2.05 - h / 2, 0);
      m.rotation.y = this.rng.range(-0.25, 0.25);
      m.castShadow = true;
      g.add(m);
    }
    this.group.add(g);
  }

  /** Layered block skyline around and behind the arena. */
  #skyline() {
    const M = this.mats;
    const rng = this.rng;
    const count = 70;
    for (let i = 0; i < count; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(34, 125);
      const x = Math.sin(ang) * r;
      const z = Math.cos(ang) * r * 0.9 - 4;
      if (z > 16) continue; // behind the camera
      const w = rng.range(5, 13);
      const d = rng.range(5, 13);
      const far = r > 70;
      const top = far ? rng.range(-2, 34) : rng.range(-9, 8);
      const h = top + 95;
      const mat = M.facades[i % 4];
      const b = this.#box(w, h, d, mat, x, top - h / 2, z, { cast: false, receive: false });
      b.rotation.y = rng.range(-0.15, 0.15);
      this.#box(w + 0.2, 0.25, d + 0.2, M.roofTop, x, top + 0.1, z, { cast: false, receive: false });
      if (rng.chance(0.55)) {
        const s = rng.range(0.8, 1.4);
        this.#cyl(0.9 * s, 0.9 * s, 1.6 * s, 8, M.steel, x + rng.range(-w / 3, w / 3), top + 1.5 * s, z + rng.range(-d / 3, d / 3));
      } else if (rng.chance(0.5)) {
        this.#box(2, 1.4, 2, M.offWhite, x + rng.range(-w / 3, w / 3), top + 0.8, z + rng.range(-d / 3, d / 3), { cast: false, receive: false });
      }
    }
    // a few distant towers for scale
    for (let i = 0; i < 7; i++) {
      const x = -90 + i * 30 + rng.range(-8, 8);
      const z = -125 - rng.range(0, 30);
      const h = rng.range(60, 120);
      this.#box(rng.range(9, 15), h + 95, rng.range(9, 15), M.facades[(i + 2) % 4], x, h / 2 - 47.5, z, { cast: false, receive: false });
    }
  }

  /**
   * Everything here is static, so bake each mesh into one big geometry per
   * (material, shadow flags) bucket. This turns hundreds of draw calls into a handful.
   */
  #mergeStatic() {
    this.group.updateMatrixWorld(true);
    const buckets = new Map();
    const meshes = [];
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry && o.material && !Array.isArray(o.material)) meshes.push(o);
    });
    for (const m of meshes) {
      const key = `${m.material.uuid}|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { material: m.material, cast: m.castShadow, receive: m.receiveShadow, geos: [] }));
      let g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      // keep attribute sets identical so merging never fails
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      if (g.index) g = g.toNonIndexed();
      b.geos.push(g);
    }
    for (const m of meshes) m.removeFromParent();
    for (const b of buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      this.disposables.push(merged);
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      this.group.add(mesh);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
  }
}
