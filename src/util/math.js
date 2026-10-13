export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const TAU = Math.PI * 2;

export function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

export function angleDiff(from, to) {
  return wrapAngle(to - from);
}

/** Rotate `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current, target, maxStep) {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return wrapAngle(current + Math.sign(d) * maxStep);
}

/** Facing angle for a direction vector (x, z): forward = (sin a, cos a). */
export const angleOf = (x, z) => Math.atan2(x, z);

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
