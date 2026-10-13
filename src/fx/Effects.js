import * as THREE from 'three';
import { PALETTE } from '../world/Textures.js';
import { easeOutCubic, clamp } from '../util/math.js';
import { STATE } from '../entities/Character.js';
import { PHASE } from '../combat/Attack.js';

const MAX_CHUNKS = 260;
const MAX_STREAKS = 160;
const MAX_RINGS = 16;
const MAX_MARKERS = 8;

const COLORS = {
  white: new THREE.Color('#fff6e4'),
  lime: new THREE.Color(PALETTE.lime),
  orange: new THREE.Color(PALETTE.orange),
  dust: new THREE.Color('#d9c8aa'),
  dark: new THREE.Color('#3a3430'),
  debris: new THREE.Color('#b9a88c'),
};
export { COLORS as FX_COLORS };

const _m = new THREE.Object3D();
const _c = new THREE.Color();

class ParticleLayer {
  constructor(scene, geometry, max, { lit = false } = {}) {
    this.max = max;
    this.material = lit
      ? new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true })
      : new THREE.MeshBasicMaterial();
    this.mesh = new THREE.InstancedMesh(geometry, this.material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = max;
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, size1: 0, gravity: 0, drag: 0, color: new THREE.Color(), stretch: 0, spin: 0, rot: 0 });
      _m.position.set(0, -999, 0);
      _m.scale.setScalar(0);
      _m.updateMatrix();
      this.mesh.setMatrixAt(i, _m.matrix);
      this.mesh.setColorAt(i, _c.set(0xffffff));
    }
    this.cursor = 0;
    scene.add(this.mesh);
    this.scene = scene;
  }

  spawn(o) {
    for (let n = 0; n < this.max; n++) {
      const i = (this.cursor + n) % this.max;
      const p = this.items[i];
      if (p.alive) continue;
      this.cursor = (i + 1) % this.max;
      p.alive = true;
      p.x = o.x; p.y = o.y; p.z = o.z;
      p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
      p.life = 0; p.max = o.life || 0.5;
      p.size = o.size || 0.1;
      p.size1 = o.size1 ?? 0;
      p.gravity = o.gravity ?? 0;
      p.drag = o.drag ?? 0;
      p.stretch = o.stretch || 0;
      p.spin = o.spin || 0;
      p.rot = Math.random() * 6;
      p.color.copy(o.color || COLORS.white);
      this.mesh.setColorAt(i, p.color);
      return;
    }
  }

  update(dt) {
    let colorDirty = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.items[i];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        _m.position.set(0, -999, 0);
        _m.scale.setScalar(0);
        _m.updateMatrix();
        this.mesh.setMatrixAt(i, _m.matrix);
        continue;
      }
      p.vy -= p.gravity * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03 && p.gravity > 0 && p.x > -9 && p.x < 9 && p.z > -9 && p.z < 9) {
        p.y = 0.03;
        p.vy = Math.abs(p.vy) * 0.25;
        p.vx *= 0.6; p.vz *= 0.6;
      }
      const t = p.life / p.max;
      const s = p.size + (p.size1 - p.size) * t;
      _m.position.set(p.x, p.y, p.z);
      if (p.stretch > 0) {
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
        _m.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
        _m.scale.set(s, s, s + p.stretch * Math.min(1, sp / 12));
      } else {
        _m.rotation.set(p.rot + p.life * p.spin, p.rot * 0.7 + p.life * p.spin * 0.6, 0);
        _m.scale.setScalar(Math.max(0.0001, s));
      }
      _m.updateMatrix();
      this.mesh.setMatrixAt(i, _m.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.material.dispose();
  }
}

function sectorGeometry(arc, segs = 28) {
  const verts = [0, 0, 0];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const a = -arc / 2 + (arc * i) / segs;
    verts.push(Math.sin(a), 0, Math.cos(a));
    if (i > 0) idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.chunks = new ParticleLayer(scene, new THREE.IcosahedronGeometry(1, 0), MAX_CHUNKS, { lit: true });
    this.streaks = new ParticleLayer(scene, new THREE.BoxGeometry(1, 1, 1), MAX_STREAKS);

    // ground rings
    this.ringGeo = new THREE.RingGeometry(0.88, 1, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(this.ringGeo, mat);
      m.visible = false;
      m.renderOrder = 4;
      this.group.add(m);
      this.rings.push({ mesh: m, mat, t: 0, dur: 1, r0: 0.2, r1: 1, a: 1, alive: false });
    }

    // spawn markers
    this.markerFill = new THREE.CircleGeometry(1, 32);
    this.markerFill.rotateX(-Math.PI / 2);
    this.markers = [];
    for (let i = 0; i < MAX_MARKERS; i++) {
      const fillMat = new THREE.MeshBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0, depthWrite: false });
      const fill = new THREE.Mesh(this.markerFill, fillMat);
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      fill.visible = ring.visible = false;
      fill.renderOrder = ring.renderOrder = 3;
      this.group.add(fill, ring);
      this.markers.push({ fill, ring, t: 0, dur: 1, alive: false, r: 0.9 });
    }

    // telegraph decals
    this.sectorGeos = new Map();
    this.decals = new Map(); // character id -> {fill, edge}
    this.decalMats = {
      fill: new THREE.MeshBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
      edge: new THREE.MeshBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.time = 0;
  }

  // ---- spawners -------------------------------------------------------------------

  /** Directional impact burst at a point. dir is the push direction (x,z). */
  impact(x, y, z, dirX, dirZ, { power = 1, color = COLORS.white, accent = COLORS.orange } = {}) {
    const n = Math.round(6 + power * 7);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dirX, dirZ) + (Math.random() - 0.5) * 1.7;
      const sp = (4 + Math.random() * 7) * (0.6 + power * 0.5);
      this.streaks.spawn({
        x, y, z,
        vx: Math.sin(a) * sp, vy: (Math.random() - 0.2) * 3.5 * power, vz: Math.cos(a) * sp,
        life: 0.16 + Math.random() * 0.14, size: 0.035 + power * 0.01, size1: 0.0, stretch: 0.5 + power * 0.3, drag: 3,
        color: Math.random() < 0.4 ? accent : color,
      });
    }
    const m = Math.round(2 + power * 3);
    for (let i = 0; i < m; i++) {
      this.chunks.spawn({
        x, y: y * 0.8, z,
        vx: dirX * (2 + Math.random() * 3) + (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 3.2,
        vz: dirZ * (2 + Math.random() * 3) + (Math.random() - 0.5) * 3,
        life: 0.45 + Math.random() * 0.3, size: 0.05 + Math.random() * 0.05, size1: 0, gravity: 18, drag: 0.5, spin: 8, color: COLORS.debris,
      });
    }
    // star flash ring on the impact point (vertical-ish disc feel via ground ring)
    this.ring(x, 0.05, z, { r0: 0.25, r1: 1.0 + power * 0.5, dur: 0.22, color: color, a: 0.55 });
  }

  dust(x, z, { n = 8, spread = 0.7, size = 0.28, y = 0.15, speed = 1.8 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      const r = Math.random() * spread;
      this.chunks.spawn({
        x: x + Math.sin(a) * r * 0.4, y, z: z + Math.cos(a) * r * 0.4,
        vx: Math.sin(a) * speed * (0.5 + Math.random()), vy: 0.6 + Math.random() * 1.2, vz: Math.cos(a) * speed * (0.5 + Math.random()),
        life: 0.4 + Math.random() * 0.3, size: size * (0.5 + Math.random() * 0.6), size1: 0, gravity: -0.5, drag: 3.2, spin: 2, color: COLORS.dust,
      });
    }
  }

  ring(x, y, z, { r0 = 0.3, r1 = 2, dur = 0.4, color = COLORS.white, a = 0.7 } = {}) {
    const r = this.rings.find((q) => !q.alive) || this.rings[0];
    r.alive = true;
    r.t = 0; r.dur = dur; r.r0 = r0; r.r1 = r1; r.a = a;
    r.mat.color.copy(color);
    r.mesh.position.set(x, y, z);
    r.mesh.visible = true;
  }

  /** Heavy-slam shockwave: expanding ring + dust + debris. */
  slam(x, z, power = 1) {
    this.ring(x, 0.04, z, { r0: 0.4, r1: 2.8 * power, dur: 0.4, color: COLORS.orange, a: 0.8 });
    this.ring(x, 0.045, z, { r0: 0.2, r1: 1.8 * power, dur: 0.3, color: COLORS.white, a: 0.6 });
    this.dust(x, z, { n: 14, spread: 1.4, size: 0.4, speed: 3.2 });
  }

  spawnMarker(x, z, delay) {
    const m = this.markers.find((q) => !q.alive) || this.markers[0];
    m.alive = true;
    m.t = 0;
    m.dur = delay;
    m.fill.position.set(x, 0.035, z);
    m.ring.position.set(x, 0.04, z);
    m.fill.visible = m.ring.visible = true;
  }

  /** Burst of dust where something lands. */
  land(x, z, power = 1) {
    this.dust(x, z, { n: Math.round(8 * power), spread: 0.9, size: 0.3 * power, speed: 2.4 * power });
    this.ring(x, 0.04, z, { r0: 0.3, r1: 1.7 * power, dur: 0.33, color: COLORS.dust, a: 0.55 });
  }

  /** Falling off the roof: a few streaks as the body drops past the edge. */
  edgeFall(x, z, dirX, dirZ) {
    for (let i = 0; i < 10; i++) {
      this.streaks.spawn({
        x: x + (Math.random() - 0.5), y: 0.2 + Math.random(), z: z + (Math.random() - 0.5),
        vx: dirX * 3, vy: -3 - Math.random() * 6, vz: dirZ * 3,
        life: 0.5, size: 0.05, size1: 0, stretch: 0.9, drag: 1, color: COLORS.white,
      });
    }
  }

  // ---- telegraphs ----------------------------------------------------------------

  #sector(arc) {
    const key = Math.round(arc * 100);
    let g = this.sectorGeos.get(key);
    if (!g) {
      g = sectorGeometry(arc);
      this.sectorGeos.set(key, g);
    }
    return g;
  }

  #decalFor(c, arc) {
    let d = this.decals.get(c.id);
    const key = Math.round(arc * 100);
    if (d && d.key !== key) {
      d.fill.geometry = this.#sector(arc);
      d.edge.geometry = this.#sector(arc);
      d.key = key;
    }
    if (!d) {
      const edge = new THREE.Mesh(this.#sector(arc), this.decalMats.edge);
      const fill = new THREE.Mesh(this.#sector(arc), this.decalMats.fill);
      edge.renderOrder = 2;
      fill.renderOrder = 3;
      edge.visible = fill.visible = false;
      this.group.add(edge, fill);
      d = { fill, edge, key };
      this.decals.set(c.id, d);
    }
    return d;
  }

  /** Update ground warnings for every enemy that is winding up an attack. */
  updateTelegraphs(characters) {
    const live = new Set();
    for (const c of characters) {
      const a = c.attack;
      if (c.team !== 'enemy' || !a || c.state !== STATE.ATTACK || a.phase === PHASE.RECOVERY) continue;
      const def = a.def;
      const d = this.#decalFor(c, def.arc);
      live.add(c.id);
      const reach = c.radius + def.range + 0.3;
      const windup = a.phase === PHASE.WINDUP;
      const p = windup ? a.progress : 1;
      d.edge.visible = d.fill.visible = true;
      for (const m of [d.edge, d.fill]) {
        m.position.set(c.x, 0.05, c.z);
        m.rotation.y = c.facing;
      }
      d.edge.scale.setScalar(reach);
      d.fill.scale.setScalar(Math.max(0.01, reach * (windup ? 0.15 + 0.85 * p : 1)));
      const pulse = windup ? 1 : 1.6;
      this.decalMats.fill.opacity = 0.32 + 0.1 * Math.sin(this.time * 18);
      this.decalMats.edge.opacity = 0.16 + (def.kind === 'heavy' ? 0.1 : 0.04) * pulse;
    }
    for (const [id, d] of this.decals) {
      if (!live.has(id)) d.edge.visible = d.fill.visible = false;
    }
    // drop decals of characters that no longer exist
    if (this.decals.size > 24) {
      const ids = new Set(characters.map((c) => c.id));
      for (const [id, d] of this.decals) {
        if (!ids.has(id)) {
          this.group.remove(d.edge, d.fill);
          this.decals.delete(id);
        }
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.chunks.update(dt);
    this.streaks.update(dt);
    for (const r of this.rings) {
      if (!r.alive) continue;
      r.t += dt;
      const u = r.t / r.dur;
      if (u >= 1) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      const e = easeOutCubic(u);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mat.opacity = r.a * (1 - u) * (1 - u);
    }
    for (const m of this.markers) {
      if (!m.alive) continue;
      m.t += dt;
      const u = m.t / m.dur;
      if (u >= 1) {
        m.alive = false;
        m.fill.visible = m.ring.visible = false;
        continue;
      }
      const pulse = 0.5 + 0.5 * Math.sin(m.t * 22);
      m.fill.scale.setScalar(0.25 + 0.75 * u);
      m.fill.material.opacity = 0.14 + 0.16 * u;
      m.ring.scale.setScalar(1.0 + (1 - u) * 0.5);
      m.ring.material.opacity = 0.35 + 0.4 * pulse * u;
    }
  }

  clear() {
    for (const r of this.rings) {
      r.alive = false;
      r.mesh.visible = false;
    }
    for (const m of this.markers) {
      m.alive = false;
      m.fill.visible = m.ring.visible = false;
    }
    for (const l of [this.chunks, this.streaks]) for (const p of l.items) p.alive = false;
    for (const d of this.decals.values()) d.edge.visible = d.fill.visible = false;
  }

  dispose() {
    this.chunks.dispose();
    this.streaks.dispose();
    this.ringGeo.dispose();
    this.markerFill.dispose();
    for (const r of this.rings) r.mat.dispose();
    for (const m of this.markers) {
      m.fill.material.dispose();
      m.ring.material.dispose();
    }
    for (const g of this.sectorGeos.values()) g.dispose();
    this.decalMats.fill.dispose();
    this.decalMats.edge.dispose();
    this.scene.remove(this.group);
  }
}
