import * as THREE from 'three';

/** Warm late-morning sun, soft sky fill, shadow frustum fitted to the arena. */
export function createLighting(scene, { shadows = true, shadowSize = 2048 } = {}) {
  const hemi = new THREE.HemisphereLight(0xfff0d8, 0x9a8670, 1.15);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffd8a6, 2.6);
  sun.position.set(-11, 20, 9);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const s = 14;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 2, far: 60 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
  }
  scene.add(sun, sun.target);

  // cool bounce from the opposite side keeps shadowed faces readable
  const fill = new THREE.DirectionalLight(0xb8c8ff, 0.35);
  fill.position.set(12, 8, -10);
  scene.add(fill);

  return { hemi, sun, fill };
}
