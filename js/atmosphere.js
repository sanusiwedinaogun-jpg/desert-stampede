import * as THREE from 'three';

/**
 * Shared golden-hour constants so the sky dome, fog, lights and materials agree.
 * The sun sits low and ahead-right of the start straight: rim-lit horses and long shadows.
 */
export const SUN_DIRECTION = new THREE.Vector3(0.74, 0.40, 0.54).normalize();
export const SUN_LIGHT_COLOR = new THREE.Color(0xFFC48A);
export const SUN_HAZE_COLOR = new THREE.Color(0xFF9A4A);
export const HAZE_COLOR = new THREE.Color(0xD9B08C);
export const FOG_DENSITY = 0.00125;

/** Shared wind clock for vegetation, flags and hair; advanced once per frame by the game loop. */
export const WIND = { time: { value: 0 } };

const v3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
const c3 = (c) => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;

/** GLSL shared by fog and the sky shader: haze brightens and warms toward the sun. */
export const ATMOSPHERE_GLSL = /* glsl */`
const vec3 ATM_SUN_DIR = ${v3(SUN_DIRECTION)};
const vec3 ATM_SUN_HAZE = ${c3(SUN_HAZE_COLOR)};
vec3 atmHaze(vec3 dir, vec3 base) {
  float s = max(dot(dir, ATM_SUN_DIR), 0.0);
  return base + ATM_SUN_HAZE * (pow(s, 5.0) * 0.45 + pow(s, 40.0) * 1.1);
}
`;
