import * as THREE from 'three';
import { CONFIG } from '../config/gameConfig.js';
import { PALETTE, makeRoofTexture, makeHazardTexture, makeFacadeTexture } from './Textures.js';

/**
 * The rooftop: a square slab whose top surface IS the playable area
 * ([-half, half] on X and Z). Everything decorative lives outside that square or is
 * a flat decal, so nothing here can interfere with hit detection or movement.
 */
export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'arena';
    this.disposables = [];
    const half = CONFIG.arena.half;

    const roofTex = this.#track(makeRoofTexture(2048, half));
    const sideTex = this.#track(makeFacadeTexture({ seed: 7, base: '#d6c3a3', cols: 6, rows: 10, size: 512 }));
    sideTex.repeat.set(3, 6);
    const hazardTex = this.#track(makeHazardTexture());

    // roof slab (top uses the painted concrete)
    const slabMats = [
      new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.92, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.95 }),
    ];
    this.disposables.push(...slabMats);
    const slabGeo = new THREE.BoxGeometry(half * 2, 0.5, half * 2);
    this.disposables.push(slabGeo);
    const slab = new THREE.Mesh(slabGeo, slabMats);
    slab.position.y = -0.25;
    slab.receiveShadow = true;
    this.group.add(slab);

    // cornice overhang: reads as a roof edge and gives the facade a shadow line
    const corniceMat = new THREE.MeshStandardMaterial({ color: PALETTE.offWhite, roughness: 0.85 });
    const corniceGeo = new THREE.BoxGeometry(half * 2 + 0.5, 0.34, half * 2 + 0.5);
    this.disposables.push(corniceMat, corniceGeo);
    const cornice = new THREE.Mesh(corniceGeo, corniceMat);
    cornice.position.y = -0.67;
    cornice.castShadow = true;
    cornice.receiveShadow = true;
    this.group.add(cornice);

    // building body falling away under the roof so height is obvious
    const bodyMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.95 });
    const bodyGeo = new THREE.BoxGeometry(half * 2 - 0.5, 90, half * 2 - 0.5);
    this.disposables.push(bodyMat, bodyGeo);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = -0.84 - 45;
    body.receiveShadow = true;
    this.group.add(body);

    // hazard perimeter, painted flat just inside the edge
    const stripW = 0.55;
    // one material per edge so each side can glow as a fighter approaches it
    this.hazardMats = [0, 1, 2, 3].map(() => {
      const m = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.8, emissive: new THREE.Color(PALETTE.orange), emissiveMap: hazardTex, emissiveIntensity: 0 });
      this.disposables.push(m);
      return m;
    });
    const stripGeos = [];
    const mk = (len, x, z, rotY, hazardMat) => {
      const g = new THREE.PlaneGeometry(len, stripW);
      const t = len / (stripW * 4);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * t);
      this.disposables.push(g);
      stripGeos.push(g);
      const m = new THREE.Mesh(g, hazardMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rotY;
      m.position.set(x, 0.012, z);
      m.receiveShadow = true;
      this.group.add(m);
    };
    const e = half - stripW / 2;
    mk(half * 2, 0, -e, 0, this.hazardMats[0]); // far edge (-Z)
    mk(half * 2, 0, e, 0, this.hazardMats[1]); // near edge (+Z)
    mk(half * 2 - stripW * 2, -e, 0, Math.PI / 2, this.hazardMats[2]); // left (-X)
    mk(half * 2 - stripW * 2, e, 0, Math.PI / 2, this.hazardMats[3]); // right (+X)

    // thin off-white keyline marking the inside of the hazard band
    const lineMat = new THREE.MeshBasicMaterial({ color: PALETTE.offWhite });
    this.disposables.push(lineMat);
    const inner = half - stripW;
    const lineGeoH = new THREE.PlaneGeometry(inner * 2, 0.06);
    const lineGeoV = new THREE.PlaneGeometry(0.06, inner * 2);
    this.disposables.push(lineGeoH, lineGeoV);
    for (const sgn of [-1, 1]) {
      const a = new THREE.Mesh(lineGeoH, lineMat);
      a.rotation.x = -Math.PI / 2;
      a.position.set(0, 0.014, sgn * inner);
      const b = new THREE.Mesh(lineGeoV, lineMat);
      b.rotation.x = -Math.PI / 2;
      b.position.set(sgn * inner, 0.014, 0);
      this.group.add(a, b);
    }

    scene.add(this.group);
  }

  /** Edges glow orange as the player gets close to them: an in-world ring-out warning. */
  update(player, dt) {
    const half = CONFIG.arena.half;
    const near = (d) => Math.max(0, Math.min(1, 1 - d / 2.4));
    const alive = player && player.alive;
    const targets = alive
      ? [near(player.z + half), near(half - player.z), near(player.x + half), near(half - player.x)]
      : [0, 0, 0, 0];
    const k = 1 - Math.exp(-10 * dt);
    for (let i = 0; i < 4; i++) {
      const m = this.hazardMats[i];
      m.emissiveIntensity += (targets[i] * 1.5 - m.emissiveIntensity) * k;
    }
  }

  #track(t) {
    this.disposables.push(t);
    return t;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
  }
}
