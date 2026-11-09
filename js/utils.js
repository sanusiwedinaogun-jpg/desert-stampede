/**
 * Desert Stampede - Math & Procedural Utilities
 * Self-contained 2D/3D Simplex noise, interpolation, easing, and angle math.
 */

// ==========================================================================
// INTERPOLATION & CLAMPING
// ==========================================================================

/**
 * Linearly interpolates between a and b by t.
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolant factor
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamps val between min and max.
 * @param {number} val - Value to clamp
 * @param {number} min - Minimum bound
 * @param {number} max - Maximum bound
 * @returns {number}
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Performs smooth Hermite interpolation between 0 and 1 when edge0 < x < edge1.
 * @param {number} edge0 - Lower edge
 * @param {number} edge1 - Upper edge
 * @param {number} x - Input value
 * @returns {number}
 */
export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x >= edge0 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes the normalized linear parameter t such that lerp(a, b, t) === value.
 * @param {number} a - Start range
 * @param {number} b - End range
 * @param {number} value - Value between a and b
 * @returns {number}
 */
export function inverseLerp(a, b, value) {
  if (Math.abs(b - a) < 1e-9) return 0;
  return (value - a) / (b - a);
}

/**
 * Maps value from input range [inMin, inMax] to output range [outMin, outMax].
 * @param {number} inMin - Input lower bound
 * @param {number} inMax - Input upper bound
 * @param {number} outMin - Output lower bound
 * @param {number} outMax - Output upper bound
 * @param {number} value - Value to remap
 * @returns {number}
 */
export function remap(inMin, inMax, outMin, outMax, value) {
  const t = inverseLerp(inMin, inMax, value);
  return lerp(outMin, outMax, t);
}

// ==========================================================================
// EASING FUNCTIONS
// ==========================================================================

/** Quadratic ease-in */
export function easeIn(t) {
  return t * t;
}

/** Quadratic ease-out */
export function easeOut(t) {
  return t * (2 - t);
}

/** Quadratic ease-in-out */
export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** Cubic ease-in */
export function easeInCubic(t) {
  return t * t * t;
}

/** Cubic ease-out */
export function easeOutCubic(t) {
  const t1 = t - 1;
  return t1 * t1 * t1 + 1;
}

// ==========================================================================
// RANDOM GENERATION
// ==========================================================================

/**
 * Returns a uniform random float in [min, max).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Returns a uniform random integer in [min, max] (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Creates a deterministic 32-bit PRNG (Mulberry32) returning floats in [0, 1).
 * @param {number} seed - Starting integer seed
 * @returns {() => number} Generator function
 */
export function seededRandom(seed = 123456789) {
  let s = Math.floor(seed) >>> 0;
  if (s === 0) s = 1;
  return function() {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==========================================================================
// SIMPLEX NOISE & FBM (STANDALONE IMPLEMENTATION)
// ==========================================================================

// Precomputed skew factors
const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;

// Gradient vectors for 3D and 2D simplex noise
const grad3 = new Float32Array([
  1, 1, 0,  -1, 1, 0,   1,-1, 0,  -1,-1, 0,
  1, 0, 1,  -1, 0, 1,   1, 0,-1,  -1, 0,-1,
  0, 1, 1,   0,-1, 1,   0, 1,-1,   0,-1,-1
]);

// Classic Perlin permutation table (256 values)
const p = new Uint8Array([
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
  8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,
  35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
  134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,
  55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
  18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,
  250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,
  189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,
  172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
  228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,
  107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,
  138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180
]);

// Extended 512-entry permutation table
const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);
for (let i = 0; i < 512; i++) {
  perm[i] = p[i & 255];
  permMod12[i] = p[i & 255] % 12;
}

/**
 * 2D Simplex Noise.
 * Evaluates smooth procedural noise at (xin, yin), returning values in [-1, 1].
 * @param {number} xin - X coordinate
 * @param {number} yin - Y coordinate
 * @returns {number} Noise value in [-1, 1]
 */
export function noise2D(xin, yin) {
  let n0 = 0, n1 = 0, n2 = 0;

  // Skew input space to determine simplex cell origin
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = xin - X0;
  const y0 = yin - Y0;

  // Determine triangle simplex
  let i1, j1;
  if (x0 > y0) {
    i1 = 1; j1 = 0; // Lower triangle
  } else {
    i1 = 0; j1 = 1; // Upper triangle
  }

  // Offsets for second and third corners in unskewed coordinates
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1.0 + 2.0 * G2;
  const y2 = y0 - 1.0 + 2.0 * G2;

  // Hashed gradient indices
  const ii = i & 255;
  const jj = j & 255;
  const gi0 = permMod12[ii + perm[jj]];
  const gi1 = permMod12[ii + i1 + perm[jj + j1]];
  const gi2 = permMod12[ii + 1 + perm[jj + 1]];

  // Corner contributions
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    t0 *= t0;
    n0 = t0 * t0 * (grad3[gi0 * 3] * x0 + grad3[gi0 * 3 + 1] * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    t1 *= t1;
    n1 = t1 * t1 * (grad3[gi1 * 3] * x1 + grad3[gi1 * 3 + 1] * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    t2 *= t2;
    n2 = t2 * t2 * (grad3[gi2 * 3] * x2 + grad3[gi2 * 3 + 1] * y2);
  }

  // Scale result to [-1, 1]
  return 70.0 * (n0 + n1 + n2);
}

/**
 * 3D Simplex Noise.
 * Evaluates smooth 3D procedural noise at (xin, yin, zin), returning values in [-1, 1].
 * @param {number} xin - X coordinate
 * @param {number} yin - Y coordinate
 * @param {number} zin - Z coordinate
 * @returns {number} Noise value in [-1, 1]
 */
export function noise3D(xin, yin, zin) {
  let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

  // Skew input space to determine simplex cell origin
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const X0 = i - t;
  const Y0 = j - t;
  const Z0 = k - t;
  const x0 = xin - X0;
  const y0 = yin - Y0;
  const z0 = zin - Z0;

  // Determine tetrahedron simplex order
  let i1, j1, k1;
  let i2, j2, k2;

  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    } else if (x0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
    } else {
      i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
    }
  } else {
    if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }
  }

  // Corner coordinates in unskewed space
  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;

  const x2 = x0 - i2 + 2.0 * G3;
  const y2 = y0 - j2 + 2.0 * G3;
  const z2 = z0 - k2 + 2.0 * G3;

  const x3 = x0 - 1.0 + 3.0 * G3;
  const y3 = y0 - 1.0 + 3.0 * G3;
  const z3 = z0 - 1.0 + 3.0 * G3;

  // Hashed gradient indices
  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;
  const gi0 = permMod12[ii + perm[jj + perm[kk]]];
  const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
  const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
  const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];

  // Corner contributions
  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 > 0) {
    t0 *= t0;
    n0 = t0 * t0 * (grad3[gi0 * 3] * x0 + grad3[gi0 * 3 + 1] * y0 + grad3[gi0 * 3 + 2] * z0);
  }

  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 > 0) {
    t1 *= t1;
    n1 = t1 * t1 * (grad3[gi1 * 3] * x1 + grad3[gi1 * 3 + 1] * y1 + grad3[gi1 * 3 + 2] * z1);
  }

  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 > 0) {
    t2 *= t2;
    n2 = t2 * t2 * (grad3[gi2 * 3] * x2 + grad3[gi2 * 3 + 1] * y2 + grad3[gi2 * 3 + 2] * z2);
  }

  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 > 0) {
    t3 *= t3;
    n3 = t3 * t3 * (grad3[gi3 * 3] * x3 + grad3[gi3 * 3 + 1] * y3 + grad3[gi3 * 3 + 2] * z3);
  }

  // Scale result to [-1, 1]
  return 32.0 * (n0 + n1 + n2 + n3);
}

/**
 * Fractal Brownian Motion (fBm) in 2D using layered simplex noise.
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} [octaves=6] - Number of detail octaves
 * @param {number} [lacunarity=2.0] - Frequency multiplier per octave
 * @param {number} [gain=0.5] - Amplitude multiplier per octave
 * @returns {number} Normalized noise value roughly in [-1, 1]
 */
export function fbm2D(x, y, octaves = 6, lacunarity = 2.0, gain = 0.5) {
  let total = 0;
  let amplitude = 1.0;
  let frequency = 1.0;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    total += noise2D(x * frequency, y * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return maxAmp > 0 ? total / maxAmp : 0;
}

// ==========================================================================
// ANGLE HELPERS
// ==========================================================================

/**
 * Normalizes an angle in radians to the range [-PI, PI].
 * @param {number} angle - Angle in radians
 * @returns {number} Normalized angle
 */
export function normalizeAngle(angle) {
  let a = (angle + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/**
 * Calculates the shortest signed angular difference from angle a to angle b.
 * Positive is counter-clockwise, negative is clockwise. Result in [-PI, PI].
 * @param {number} a - From angle in radians
 * @param {number} b - To angle in radians
 * @returns {number} Shortest angle difference
 */
export function angleDiff(a, b) {
  return normalizeAngle(b - a);
}

/**
 * Correctly interpolates between angle a and angle b along the shortest arc.
 * @param {number} a - Start angle in radians
 * @param {number} b - Target angle in radians
 * @param {number} t - Interpolation factor [0, 1]
 * @returns {number} Interpolated angle in [-PI, PI]
 */
export function lerpAngle(a, b, t) {
  return normalizeAngle(a + angleDiff(a, b) * t);
}
