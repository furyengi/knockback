import * as THREE from 'three';
import { CONFIG } from '../config/gameConfig.js';

/**
 * Fixed three-quarter camera that keeps the whole arena in frame for any aspect ratio.
 * Distance is solved by projecting the arena's corners, so wide, narrow and ultrawide
 * windows never crop gameplay. The only motion is a small decaying impact impulse.
 */
export class CameraController {
  constructor(camera) {
    this.camera = camera;
    const C = CONFIG.camera;
    this.dir = new THREE.Vector3(...C.dir).normalize();
    this.target = new THREE.Vector3(...C.target);
    this.distance = 30;
    this.impulse = new THREE.Vector3();
    this.shakeAmount = 1;
    this.focus = new THREE.Vector3();
    this.focusGoal = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this.camera.fov = C.fov;
  }

  /** Shift the view target (used to make room for the title menu). */
  setFocusOffset(x, z) {
    this.focusGoal.set(x, 0, z);
  }

  /** Developer aid: freeze the camera at a custom distance/target (used for close-up screenshots). */
  lock(distance, x, y, z) {
    this.debugLock = true;
    this.distance = distance;
    this.target.set(x, y, z);
  }

  setShake(amount) {
    this.shakeAmount = amount;
  }

  /** Re-fit after a resize. `insetTop/Bottom` are NDC-space allowances for HUD. */
  resize(width, height) {
    if (this.debugLock) {
      this.camera.aspect = width / Math.max(1, height);
      this.camera.updateProjectionMatrix();
      return;
    }
    const aspect = width / Math.max(1, height);
    const cam = this.camera;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const half = CONFIG.arena.half + 0.5;
    const pts = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pts.push(new THREE.Vector3(sx * half, 0, sz * half));
        pts.push(new THREE.Vector3(sx * (half - 0.8), 2.6, sz * (half - 0.8))); // heads of fighters at the edge
      }
    }
    const M = CONFIG.camera.margin;
    // The target is nudged so the arena sits centred between the HUD bands.
    let lo = 8;
    let hi = 140;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (this.#fits(mid, pts, M)) hi = mid;
      else lo = mid;
    }
    this.distance = hi;
    this.#place(cam);
  }

  #fits(d, pts, M) {
    const cam = this.camera;
    cam.position.copy(this.target).addScaledVector(this.dir, d);
    cam.lookAt(this.target);
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const v = this._tmp;
    for (const p of pts) {
      v.copy(p).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
      // perspective divide happens inside applyMatrix4 (it divides by w)
      if (Math.abs(v.x) > M.x || v.y > M.top || v.y < -M.bottom) return false;
    }
    return true;
  }

  #place(cam) {
    cam.position.copy(this.target).add(this.focus).addScaledVector(this.dir, this.distance).add(this.impulse);
    cam.lookAt(this._tmp.copy(this.target).add(this.focus).addScaledVector(this.impulse, 0.5));
  }

  /** Nudge the camera along the hit direction. Strength ~0.05-0.35. */
  kick(dx, dz, strength) {
    this.impulse.x += dx * strength * this.shakeAmount;
    this.impulse.z += dz * strength * this.shakeAmount;
    this.impulse.y += strength * 0.35 * this.shakeAmount;
    const l = this.impulse.length();
    if (l > 0.55) this.impulse.multiplyScalar(0.55 / l);
  }

  update(dt) {
    const k = Math.exp(-CONFIG.camera.impulseDecay * dt);
    this.impulse.multiplyScalar(k);
    this.focus.lerp(this.focusGoal, 1 - Math.exp(-6 * dt));
    if (this.impulse.lengthSq() < 1e-6) this.impulse.set(0, 0, 0);
    this.#place(this.camera);
  }
}
