import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _tmpA = new THREE.Vector3();

/**
 * Sweeps an elliptical cross-section along a list of stations.
 * Frames are parallel-transported so limbs and tubes never twist.
 * @param {{ p: number[]|THREE.Vector3, rx: number, ry: number }[]} stations
 * @param {Object} [opts]
 * @param {number} [opts.radial] segments around the section
 * @param {THREE.Vector3} [opts.sideHint] initial direction of the rx axis (default world X)
 * @param {boolean} [opts.capStart]
 * @param {boolean} [opts.capEnd]
 * @param {(a: number, t: number) => number} [opts.radialFn] radius multiplier around the section (ribs, flutes)
 * @param {(info: { p: THREE.Vector3, a: number, t: number, i: number, center: THREE.Vector3 }) => THREE.Color} [opts.colorFn]
 */
export function loft(stations, opts = {}) {
  const radial = opts.radial ?? 14;
  const n = stations.length;
  const pts = stations.map(s => (Array.isArray(s.p) ? new THREE.Vector3(...s.p) : s.p.clone()));

  const tangents = pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, n - 1)];
    return b.clone().sub(a).normalize();
  });

  const hint = (opts.sideHint ?? new THREE.Vector3(1, 0, 0)).clone();
  let side = hint.sub(tangents[0].clone().multiplyScalar(hint.dot(tangents[0])));
  if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
  side.normalize();

  const positions = [];
  const uvs = [];
  const colors = opts.colorFn ? [] : null;
  const indices = [];

  for (let i = 0; i < n; i++) {
    const T = tangents[i];
    side = side.sub(_tmpA.copy(T).multiplyScalar(side.dot(T))).normalize();
    const up = new THREE.Vector3().crossVectors(side, T).normalize();
    const { rx, ry } = stations[i];

    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const k = opts.radialFn ? opts.radialFn(a, i / Math.max(n - 1, 1)) : 1;
      const p = pts[i].clone()
        .addScaledVector(side, Math.cos(a) * rx * k)
        .addScaledVector(up, Math.sin(a) * ry * k);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radial, i / Math.max(n - 1, 1));
      if (colors) {
        const c = opts.colorFn({ p, a, t: i / Math.max(n - 1, 1), i, center: pts[i] });
        colors.push(c.r, c.g, c.b);
      }
    }
  }

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      indices.push(a, c, b, b, c, d);
    }
  }

  const addCap = (index, flip) => {
    const center = pts[index];
    const ci = positions.length / 3;
    positions.push(center.x, center.y, center.z);
    uvs.push(0.5, index === 0 ? 0 : 1);
    if (colors) {
      const c = opts.colorFn({ p: center, a: 0, t: index === 0 ? 0 : 1, i: index, center });
      colors.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < radial; j++) {
      const a = index * radial + j;
      const b = index * radial + ((j + 1) % radial);
      if (flip) indices.push(ci, b, a);
      else indices.push(ci, a, b);
    }
  };
  if (opts.capStart ?? true) addCap(0, false);
  if (opts.capEnd ?? true) addCap(n - 1, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Catmull-Rom scalar interpolation over evenly spaced keys. */
export function sampleKeys(keys, f) {
  const n = keys.length;
  const x = THREE.MathUtils.clamp(f, 0, 1) * (n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const t = x - i;
  const p0 = keys[Math.max(i - 1, 0)];
  const p1 = keys[i];
  const p2 = keys[i + 1];
  const p3 = keys[Math.min(i + 2, n - 1)];
  return 0.5 * (
    2 * p1 + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
  );
}

/**
 * Collects transformed geometries and merges them into one vertex-colored mesh per material.
 */
export class GeoBatch {
  constructor() {
    this.parts = [];
  }

  /**
   * @param {THREE.BufferGeometry} geometry
   * @param {{ position?: number[], rotation?: number[], scale?: number|number[], color?: THREE.Color|number }} [o]
   */
  add(geometry, o = {}) {
    const g = geometry.clone();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rotation ?? [0, 0, 0])));
    const s = Array.isArray(o.scale) ? o.scale : [o.scale ?? 1, o.scale ?? 1, o.scale ?? 1];
    m.compose(new THREE.Vector3(...(o.position ?? [0, 0, 0])), q, new THREE.Vector3(...s));
    g.applyMatrix4(m);

    const count = g.attributes.position.count;
    if (!g.attributes.color) {
      const c = o.color !== undefined ? new THREE.Color(o.color) : new THREE.Color(1, 1, 1);
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    }
    this.parts.push(g);
    return g;
  }

  merged() {
    return mergeGeometries(this.parts, false);
  }

  mesh(material, { cast = true, receive = true } = {}) {
    const mesh = new THREE.Mesh(this.merged(), material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }
}

/** Unit-sphere ellipsoid helper. */
export function ellipsoid(rx, ry, rz, w = 14, h = 10) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

/** Linear blend of two colors by t, returned as a fresh Color. */
export function mixColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), THREE.MathUtils.clamp(t, 0, 1));
}
