import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from './scene.js';
import { WIND } from './atmosphere.js';
import { seededRandom, noise3D } from './utils.js';
import { loft, GeoBatch } from './geo.js';
import { createButteGeometry, createRockMaterial } from './buttes.js';

const KINDS = {
  spire: { talus: 0.30, talusSpread: 2.2, ledges: 3, capOverhang: 0.16, lobes: 2, squareness: 0.0, taper: 0.03, radial: 52, rings: 64 },
  butte: { talus: 0.36, talusSpread: 1.9, ledges: 5, capOverhang: 0.04, lobes: 3, squareness: 0.35, taper: 0.06, radial: 80, rings: 60 },
  mesa: { talus: 0.42, talusSpread: 1.7, ledges: 6, capOverhang: 0.0, lobes: 4, squareness: 0.75, taper: 0.05, radial: 96, rings: 60 },
  outcrop: { talus: 0.40, talusSpread: 2.1, ledges: 3, capOverhang: 0.0, lobes: 3, squareness: 0.2, taper: 0.08, radial: 44, rings: 26 }
};

const ENDLESS_OBSTACLE_COUNTS = { easy: 14, medium: 20, hard: 26, expert: 34 };

const FORMATIONS = [
  { kind: 'spire', x: 560, z: -120, h: 118, r: 19, a: 1.0, seed: 11 },
  { kind: 'butte', x: 615, z: -35, h: 96, r: 46, a: 1.2, seed: 12 },
  { kind: 'mesa', x: 715, z: 70, h: 70, r: 105, a: 1.5, seed: 13 },
  { kind: 'butte', x: 520, z: 195, h: 84, r: 40, a: 1.0, seed: 14 },
  { kind: 'mesa', x: 800, z: -200, h: 88, r: 140, a: 1.3, seed: 15 },
  { kind: 'mesa', x: 160, z: 540, h: 78, r: 110, a: 1.4, seed: 16 },
  { kind: 'butte', x: -60, z: 610, h: 108, r: 46, a: 1.1, seed: 17 },
  { kind: 'spire', x: 300, z: 650, h: 132, r: 22, a: 1.0, seed: 18 },
  { kind: 'spire', x: -260, z: 570, h: 100, r: 17, a: 1.0, seed: 19 },
  { kind: 'mesa', x: -570, z: 80, h: 82, r: 125, a: 1.5, seed: 20 },
  { kind: 'spire', x: -655, z: -85, h: 116, r: 18, a: 1.0, seed: 21 },
  { kind: 'butte', x: -525, z: 305, h: 92, r: 50, a: 1.2, seed: 22 },
  { kind: 'butte', x: -60, z: -480, h: 104, r: 52, a: 1.1, seed: 23 },
  { kind: 'spire', x: 175, z: -535, h: 126, r: 20, a: 1.0, seed: 24 },
  { kind: 'mesa', x: -335, z: -425, h: 72, r: 100, a: 1.4, seed: 25 },
  { kind: 'mesa', x: 365, z: -450, h: 80, r: 120, a: 1.3, seed: 26 },
  { kind: 'butte', x: -230, z: -520, h: 95, r: 48, a: 1.0, seed: 27 },
  { kind: 'mesa', x: 250, z: -650, h: 82, r: 110, a: 1.4, seed: 28 },
  { kind: 'spire', x: -270, z: -770, h: 120, r: 20, a: 1.0, seed: 29 },
  { kind: 'butte', x: 270, z: -830, h: 100, r: 45, a: 1.1, seed: 30 },
  { kind: 'mesa', x: -20, z: -990, h: 90, r: 160, a: 1.5, seed: 31 },
  { kind: 'butte', x: 170, z: -340, h: 70, r: 34, a: 1.0, seed: 32 }
];

/** Wind-swayed foliage: vertex-colored, optionally two-sided, sway grows with height. */
function foliageMaterial({ sway = 0.07, double = true, roughness = 0.85 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness,
    side: double ? THREE.DoubleSide : THREE.FrontSide
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = WIND.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        {
          float swayPhase = 0.0;
          #ifdef USE_INSTANCING
            swayPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
          #endif
          float swayH = max( position.y, 0.0 );
          float gust = sin( uWindTime * 1.7 + swayPhase ) * 0.6 + sin( uWindTime * 3.1 + swayPhase * 1.7 ) * 0.4;
          transformed.x += gust * ${sway.toFixed(3)} * swayH;
          transformed.z += gust * ${(sway * 0.5).toFixed(3)} * swayH;
        }
      `);
  };
  return mat;
}

/** Radial cluster of tapered, curved blades with outward/up normals for soft bush shading. */
function makeBladeCluster({ blades, len, width, tilt, base, tip, seed, radius = 0.12 }) {
  const rand = seededRandom(seed);
  const baseC = new THREE.Color(base);
  const tipC = new THREE.Color(tip);
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  const segs = 3;

  for (let b = 0; b < blades; b++) {
    const ang = rand() * Math.PI * 2;
    const L = len[0] + rand() * (len[1] - len[0]);
    const lean = tilt[0] + rand() * (tilt[1] - tilt[0]);
    const rootR = rand() * radius;
    const out = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const side = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang));
    const root = out.clone().multiplyScalar(rootR);
    const w = width * (0.7 + rand() * 0.6);
    const tone = 0.86 + rand() * 0.28;
    const normal = out.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, 0.85, 0)).normalize();

    const p0 = root;
    const p1 = root.clone().add(new THREE.Vector3(0, L * 0.55, 0)).addScaledVector(out, L * 0.12 * Math.sin(lean));
    const p2 = root.clone().add(new THREE.Vector3(0, L * Math.cos(lean) * 0.92, 0)).addScaledVector(out, L * Math.sin(lean));

    const start = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const a = p0.clone().lerp(p1, u);
      const c = p1.clone().lerp(p2, u);
      const pt = a.lerp(c, u);
      const half = (w * Math.pow(1 - u, 0.9)) / 2;
      const color = baseC.clone().lerp(tipC, Math.pow(u, 0.8)).multiplyScalar(tone);
      [-1, 1].forEach((sgn) => {
        const v = pt.clone().addScaledVector(side, half * sgn);
        pos.push(v.x, v.y, v.z);
        nor.push(normal.x, normal.y, normal.z);
        col.push(color.r, color.g, color.b);
      });
    }
    for (let s = 0; s < segs; s++) {
      const a = start + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function buildSaguaro({ height, trunkR, arms, seed }) {
  const rand = seededRandom(seed);
  const batch = new GeoBatch();
  const ribs = 9;
  const dark = new THREE.Color(0x2D5538);
  const light = new THREE.Color(0x6E9A4E);
  const ribFn = (a) => 1 + 0.075 * Math.cos(a * ribs);
  const colorFor = (t, a) => dark.clone().lerp(light, 0.25 + t * 0.55).multiplyScalar(0.84 + 0.16 * Math.cos(a * ribs));

  const trunk = [];
  const bodyTop = height - trunkR;
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    trunk.push({ p: [0, -0.3 + (bodyTop + 0.3) * t, 0], rx: trunkR * (1 - 0.1 * t), ry: trunkR * (1 - 0.1 * t) });
  }
  [0.4, 0.8, 1.1, 1.35, 1.5].forEach((phi) => {
    const r = trunkR * 0.9 * Math.cos(phi);
    trunk.push({ p: [0, bodyTop + trunkR * 0.9 * Math.sin(phi), 0], rx: r, ry: r });
  });
  batch.add(loft(trunk, {
    radial: 18,
    radialFn: ribFn,
    colorFn: ({ a, i }) => colorFor(Math.min(i / 9, 1), a)
  }));

  arms.forEach((arm) => {
    const ha = height * arm.h;
    const armR = trunkR * 0.62;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, ha, 0),
      new THREE.Vector3(arm.reach * 0.5, ha + 0.05, 0),
      new THREE.Vector3(arm.reach, ha + 0.45, 0),
      new THREE.Vector3(arm.reach + 0.1, ha + arm.rise * 0.55, 0),
      new THREE.Vector3(arm.reach + 0.12, ha + arm.rise, 0)
    ]);
    const stations = curve.getPoints(11).map((p, i, list) => {
      const r = armR * (1 - 0.15 * (i / (list.length - 1)));
      return { p, rx: r, ry: r };
    });
    const tip = stations[stations.length - 1].p.clone();
    [0.45, 0.9, 1.25, 1.5].forEach((phi) => {
      const r = armR * 0.85 * Math.cos(phi);
      stations.push({ p: tip.clone().add(new THREE.Vector3(0, armR * 0.85 * Math.sin(phi), 0)), rx: r, ry: r });
    });
    batch.add(loft(stations, {
      radial: 14,
      sideHint: new THREE.Vector3(0, 0, 1),
      radialFn: (a) => 1 + 0.07 * Math.cos(a * 7),
      colorFn: ({ a, i }) => colorFor(0.35 + Math.min(i / 15, 1) * 0.6, a * 1.3)
    }), { rotation: [0, arm.yaw + (rand() - 0.5) * 0.2, 0] });
  });
  return batch.merged();
}

function buildBarrelCactus() {
  const R = 1;
  const stations = [];
  for (let k = 0; k <= 9; k++) {
    const phi = (k / 9) * Math.PI;
    stations.push({ p: [0, R * 0.8 * (1 - Math.cos(phi)), 0], rx: Math.max(R * Math.sin(phi), 0.02), ry: Math.max(R * Math.sin(phi), 0.02) });
  }
  const dark = new THREE.Color(0x365F34);
  const light = new THREE.Color(0x7FA34A);
  const batch = new GeoBatch();
  batch.add(loft(stations, {
    radial: 24,
    radialFn: (a) => 1 + 0.09 * Math.cos(a * 12),
    colorFn: ({ a, t }) => dark.clone().lerp(light, 0.3 + 0.5 * t).multiplyScalar(0.82 + 0.18 * Math.cos(a * 12))
  }));
  const flower = new THREE.Color(0xF0B73A);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    batch.add(new THREE.SphereGeometry(0.1, 6, 5), { position: [Math.cos(a) * 0.25, 1.58, Math.sin(a) * 0.25], color: flower });
  }
  return batch.merged();
}

function buildAgave(seed) {
  const rand = seededRandom(seed);
  const batch = new GeoBatch();
  const leaves = 17;
  const dark = new THREE.Color(0x3F6E66);
  const light = new THREE.Color(0x8FB8A0);
  const tipC = new THREE.Color(0xA0503A);
  for (let k = 0; k < leaves; k++) {
    const ring = k / leaves;
    const lean = 0.25 + ring * 1.15 + rand() * 0.12;
    const L = 1.5 - ring * 0.35 + rand() * 0.2;
    const stations = [];
    for (let s = 0; s <= 5; s++) {
      const u = s / 5;
      const x = Math.sin(lean) * L * u * 0.9 + (u * u) * 0.35;
      const y = Math.cos(lean) * L * u * 0.9 + 0.1 - u * u * 0.25 * ring * 1.5;
      const wProfile = Math.sin(Math.min(u * 1.25, 1) * Math.PI * 0.5) * (1 - Math.pow(u, 3) * 0.95);
      stations.push({ p: [x, y, 0], rx: 0.2 * wProfile + 0.01, ry: 0.035 * (1 - u * 0.8) + 0.004 });
    }
    batch.add(loft(stations, {
      radial: 4,
      sideHint: new THREE.Vector3(0, 0, 1),
      colorFn: ({ t }) => dark.clone().lerp(light, Math.min(t * 1.4, 1)).lerp(tipC, Math.pow(Math.max(t - 0.85, 0) / 0.15, 1.5) * 0.7)
    }), { rotation: [0, (k * 2.399963) % (Math.PI * 2), 0] });
  }
  return batch.merged();
}

function buildRock(seed, squash) {
  let g = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + 0.26 * noise3D(v.x * 1.5 + seed, v.y * 1.5 + seed * 2, v.z * 1.5) + 0.09 * noise3D(v.x * 4 + seed * 3, v.y * 4, v.z * 4);
    v.multiplyScalar(n);
    v.y *= squash;
    if (v.y < -0.35 * squash) v.y = -0.35 * squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.setAttribute('aInfo', new THREE.BufferAttribute(new Float32Array(pos.count * 2).fill(1), 2));
  return g;
}

function buildTumbleweed() {
  const rand = seededRandom(77);
  const batch = new GeoBatch();
  const ring = new THREE.TorusGeometry(1, 0.028, 4, 20);
  for (let k = 0; k < 15; k++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28));
    const e = new THREE.Euler().setFromQuaternion(q);
    const s = 0.75 + rand() * 0.28;
    const tone = 0.7 + rand() * 0.5;
    batch.add(ring, { rotation: [e.x, e.y, e.z], scale: [s, s * (0.85 + rand() * 0.2), s], color: new THREE.Color(0x9C7B4C).multiplyScalar(tone) });
  }
  return batch.merged();
}

/** Builds instanced meshes bucketed into spatial cells so frustum culling works per chunk. */
function buildChunked(geometry, material, entries, { cell = 170, cast = false, receive = true } = {}) {
  const buckets = new Map();
  entries.forEach((e) => {
    const key = `${Math.floor(e.x / cell)},${Math.floor(e.z / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  });
  const group = new THREE.Group();
  buckets.forEach((list) => {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((e, i) => {
      mesh.setMatrixAt(i, e.matrix);
      if (e.color) mesh.setColorAt(i, e.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if (typeof mesh.computeBoundingSphere === 'function') mesh.computeBoundingSphere();
    else mesh.frustumCulled = false;
    group.add(mesh);
  });
  return group;
}

/**
 * Environment - Monument Valley style buttes, desert flora, boulders and tumbleweeds,
 * concentrated along the race corridors where the camera actually looks.
 */
export class Environment {
  constructor(terrain, track, allTracks = [track]) {
    this.terrain = terrain;
    this.track = track;
    this.tracks = allTracks;
    this.tumbleweeds = [];
    this.raceObstacles = [];
    this.obstacleGroup = null;
    this.obstacleTrack = null;
    this.obstacleDifficulty = null;
    this.endlessMode = false;
    this.difficulty = 'easy';
    this.time = 0;
    this.rand = seededRandom(20240518);
    this.roadPts = null;
    this.saguaros = [];
    this.init();
  }

  init() {
    this.buildRoadIndex();
    this.createButtes();
    this.createFlora();
    this.createRocks();
    this.createSectionRocks();
    this.createTumbleweeds();
  }

  /** Dense point list along every course so scatter can keep clear of the roads. */
  buildRoadIndex() {
    const pts = [];
    this.tracks.forEach((tr) => {
      tr.path.getSpacedPoints(Math.ceil(tr.totalLength / 2.5)).forEach(p => pts.push(p.x, p.z));
    });
    this.roadPts = new Float32Array(pts);
  }

  roadDistance(x, z) {
    const p = this.roadPts;
    let best = Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const dx = x - p[i];
      const dz = z - p[i + 1];
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  isSafeFromTrack(x, z, minDistance = 16) {
    return this.roadDistance(x, z) >= minDistance;
  }

  pickTrack() {
    const total = this.tracks.reduce((s, t) => s + t.totalLength, 0);
    let r = this.rand() * total;
    for (const t of this.tracks) {
      r -= t.totalLength;
      if (r <= 0) return t;
    }
    return this.tracks[0];
  }

  /** Random point near a course: offset grows with a power curve so detail clusters near the road. */
  sampleNearRoad({ min, max, power = 1.6 }) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const tr = this.pickTrack();
      const t = this.rand();
      const p = tr.path.getPointAt(t);
      const tan = tr.path.getTangentAt(t);
      tan.y = 0;
      tan.normalize();
      const off = min + (max - min) * Math.pow(this.rand(), power);
      const sign = this.rand() < 0.5 ? -1 : 1;
      const along = (this.rand() - 0.5) * 9;
      const x = p.x - tan.z * off * sign + tan.x * along;
      const z = p.z + tan.x * off * sign + tan.z * along;
      if (this.roadDistance(x, z) >= min * 0.92) return { x, z };
    }
    return null;
  }

  groundAt(x, z) {
    return this.terrain.getHeightAt(x, z);
  }

  /** Placement matrix helper: yaw/tilt random, scale uniform or per-axis. */
  matrixFor(x, y, z, sx, sy, sz, yaw, tiltX = 0, tiltZ = 0) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    return m;
  }

  tint(spread = 0.14) {
    const r = this.rand;
    return new THREE.Color(1, 1, 1).multiply(new THREE.Color(
      1 - spread / 2 + r() * spread,
      1 - spread / 2 + r() * spread,
      1 - spread + r() * spread * 1.6
    ));
  }

  createButtes() {
    this.buttes = new THREE.Group();
    const material = createRockMaterial();
    this.rockMaterial = material;

    const place = (spec) => {
      const kind = KINDS[spec.kind];
      const footprint = spec.r * kind.talusSpread * Math.max(spec.a, 1);

      // Nudge hero formations outward if their talus skirt would reach a road.
      for (let n = 0; n < 40 && this.roadDistance(spec.x, spec.z) < footprint + 18; n++) {
        const len = Math.hypot(spec.x, spec.z - 40) || 1;
        spec.x += ((spec.x) / len) * 15;
        spec.z += ((spec.z - 40) / len) * 15;
      }

      const geo = createButteGeometry({
        height: spec.h, radius: spec.r, aspect: spec.a, seed: spec.seed,
        ...kind,
        rings: spec.rings ?? kind.rings, radial: spec.radial ?? kind.radial
      });

      let low = Infinity;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        low = Math.min(low, this.groundAt(spec.x + Math.cos(a) * footprint * 0.8, spec.z + Math.sin(a) * footprint * 0.8));
      }
      low = Math.min(low, this.groundAt(spec.x, spec.z));

      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(spec.x, low - 0.6, spec.z);
      mesh.rotation.y = (spec.seed * 1.618) % (Math.PI * 2);
      mesh.receiveShadow = true;
      this.buttes.add(mesh);
    };

    FORMATIONS.forEach(place);

    // Mid-range outcrops give depth between the road and the monuments.
    let guard = 0;
    let made = 0;
    while (made < 22 && guard++ < 400) {
      const s = this.sampleNearRoad({ min: 70, max: 210, power: 1.0 });
      if (!s) continue;
      const r = 7 + this.rand() * 11;
      if (this.roadDistance(s.x, s.z) < r * 2.1 + 22) continue;
      place({
        kind: 'outcrop', x: s.x, z: s.z, h: 14 + this.rand() * 24, r, a: 1 + this.rand() * 0.5,
        seed: 100 + made
      });
      made++;
    }
    scene.add(this.buttes);
  }

  createFlora() {
    this.flora = new THREE.Group();
    const foliage = foliageMaterial({ sway: 0.07 });
    const grass = foliageMaterial({ sway: 0.11 });

    const bushA = makeBladeCluster({ blades: 44, len: [0.55, 1.15], width: 0.075, tilt: [0.35, 1.2], base: 0x4F4A24, tip: 0xB9A547, seed: 3 });
    const bushB = makeBladeCluster({ blades: 56, len: [0.5, 1.0], width: 0.055, tilt: [0.15, 0.95], base: 0x7E6028, tip: 0xE5C770, seed: 4 });
    const tuft = makeBladeCluster({ blades: 16, len: [0.28, 0.6], width: 0.04, tilt: [0.15, 0.8], base: 0x8F7435, tip: 0xE0C46E, seed: 5, radius: 0.08 });

    const bushEntries = [[], []];
    for (let i = 0; i < 1400; i++) {
      const s = this.sampleNearRoad({ min: 13, max: 160, power: 1.8 });
      if (!s) continue;
      const sc = 0.8 + this.rand() * 1.0;
      bushEntries[i % 2].push({
        x: s.x, z: s.z, color: this.tint(0.2),
        matrix: this.matrixFor(s.x, this.groundAt(s.x, s.z) - 0.03, s.z, sc, sc * (0.85 + this.rand() * 0.4), sc, this.rand() * 6.28)
      });
    }
    const tuftEntries = [];
    for (let i = 0; i < 1700; i++) {
      const s = this.sampleNearRoad({ min: 12, max: 70, power: 1.4 });
      if (!s) continue;
      const sc = 0.7 + this.rand() * 0.9;
      tuftEntries.push({
        x: s.x, z: s.z, color: this.tint(0.2),
        matrix: this.matrixFor(s.x, this.groundAt(s.x, s.z) - 0.02, s.z, sc, sc, sc, this.rand() * 6.28)
      });
    }
    this.flora.add(
      buildChunked(bushA, foliage, bushEntries[0], { cast: true }),
      buildChunked(bushB, foliage, bushEntries[1], { cast: true }),
      buildChunked(tuft, grass, tuftEntries)
    );

    // Saguaro: four silhouettes, clustered with scrub for natural groupings.
    const variants = [
      buildSaguaro({ height: 8.2, trunkR: 0.56, seed: 1, arms: [{ h: 0.42, reach: 1.5, rise: 2.7, yaw: 0.4 }, { h: 0.55, reach: 1.3, rise: 2.2, yaw: 3.5 }] }),
      buildSaguaro({ height: 10.5, trunkR: 0.64, seed: 2, arms: [{ h: 0.38, reach: 1.7, rise: 3.4, yaw: 1.2 }, { h: 0.5, reach: 1.5, rise: 3.0, yaw: 4.4 }, { h: 0.62, reach: 1.2, rise: 1.9, yaw: 2.6 }] }),
      buildSaguaro({ height: 6.4, trunkR: 0.5, seed: 3, arms: [{ h: 0.5, reach: 1.3, rise: 2.0, yaw: 5.2 }] }),
      buildSaguaro({ height: 5.2, trunkR: 0.46, seed: 4, arms: [] })
    ];
    this.saguaroGeometries = variants;
    const saguaroMat = foliageMaterial({ sway: 0.004, double: false, roughness: 0.78 });
    this.saguaroMaterial = saguaroMat;
    const sagEntries = variants.map(() => []);
    const clusterEntries = { bush: [], rock: [] };
    for (let i = 0; i < 120; i++) {
      const s = this.sampleNearRoad({ min: 17, max: 210, power: 1.35 });
      if (!s) continue;
      const v = Math.floor(this.rand() * variants.length);
      const sc = 0.85 + this.rand() * 0.45;
      sagEntries[v].push({
        x: s.x, z: s.z, color: this.tint(0.12),
        matrix: this.matrixFor(s.x, this.groundAt(s.x, s.z) - 0.2, s.z, sc, sc, sc, this.rand() * 6.28, (this.rand() - 0.5) * 0.04, (this.rand() - 0.5) * 0.04)
      });
      const around = 2 + Math.floor(this.rand() * 4);
      for (let k = 0; k < around; k++) {
        const a = this.rand() * Math.PI * 2;
        const d = 2 + this.rand() * 5;
        const x = s.x + Math.cos(a) * d;
        const z = s.z + Math.sin(a) * d;
        if (this.roadDistance(x, z) < 13) continue;
        const bsc = 0.7 + this.rand() * 0.9;
        clusterEntries.bush.push({
          x, z, color: this.tint(0.2),
          matrix: this.matrixFor(x, this.groundAt(x, z) - 0.03, z, bsc, bsc, bsc, this.rand() * 6.28)
        });
      }
    }
    variants.forEach((g, i) => this.flora.add(buildChunked(g, saguaroMat, sagEntries[i], { cast: true, cell: 220 })));
    this.flora.add(buildChunked(bushB, foliage, clusterEntries.bush, { cast: true }));

    // Barrel cacti and agave.
    const barrel = buildBarrelCactus();
    const barrelEntries = [];
    for (let i = 0; i < 90; i++) {
      const s = this.sampleNearRoad({ min: 14, max: 120, power: 1.4 });
      if (!s) continue;
      const sc = 0.7 + this.rand() * 0.7;
      barrelEntries.push({
        x: s.x, z: s.z, color: this.tint(0.14),
        matrix: this.matrixFor(s.x, this.groundAt(s.x, s.z) - 0.1, s.z, sc, sc, sc, this.rand() * 6.28)
      });
    }
    this.flora.add(buildChunked(barrel, foliageMaterial({ sway: 0, double: false, roughness: 0.8 }), barrelEntries, { cast: true }));

    const agaveMat = foliageMaterial({ sway: 0.01, double: true, roughness: 0.7 });
    const agaves = [buildAgave(1), buildAgave(2)];
    const agaveEntries = [[], []];
    for (let i = 0; i < 170; i++) {
      const s = this.sampleNearRoad({ min: 14, max: 130, power: 1.4 });
      if (!s) continue;
      const sc = 0.7 + this.rand() * 0.8;
      agaveEntries[i % 2].push({
        x: s.x, z: s.z, color: this.tint(0.14),
        matrix: this.matrixFor(s.x, this.groundAt(s.x, s.z) - 0.05, s.z, sc, sc, sc, this.rand() * 6.28)
      });
    }
    agaves.forEach((g, i) => this.flora.add(buildChunked(g, agaveMat, agaveEntries[i], { cast: true })));

    scene.add(this.flora);
  }

  createRocks() {
    this.rocks = new THREE.Group();
    const geos = [buildRock(1, 0.7), buildRock(2, 0.85), buildRock(3, 0.6), buildRock(4, 0.95)];
    const entries = geos.map(() => []);
    const pebbleEntries = geos.map(() => []);

    for (let i = 0; i < 340; i++) {
      const large = this.rand() < 0.16;
      const s = this.sampleNearRoad({ min: large ? 24 : 15, max: 230, power: 1.3 });
      if (!s) continue;
      const base = large ? 3.5 + this.rand() * 4.5 : 0.9 + this.rand() * 2.4;
      const sx = base * (0.8 + this.rand() * 0.5);
      const sz = base * (0.8 + this.rand() * 0.5);
      const sy = base * (0.7 + this.rand() * 0.45);
      const g = Math.floor(this.rand() * geos.length);
      const col = new THREE.Color(1, 1, 1).multiplyScalar(0.82 + this.rand() * 0.3);
      entries[g].push({
        x: s.x, z: s.z, color: col,
        matrix: this.matrixFor(s.x, this.groundAt(s.x, s.z) + sy * 0.18, s.z, sx, sy, sz, this.rand() * 6.28, (this.rand() - 0.5) * 0.4, (this.rand() - 0.5) * 0.4)
      });
    }
    for (let i = 0; i < 900; i++) {
      const s = this.sampleNearRoad({ min: 11.8, max: 44, power: 1.1 });
      if (!s) continue;
      const base = 0.12 + this.rand() * 0.38;
      const g = Math.floor(this.rand() * geos.length);
      pebbleEntries[g].push({
        x: s.x, z: s.z, color: new THREE.Color(1, 1, 1).multiplyScalar(0.8 + this.rand() * 0.35),
        matrix: this.matrixFor(s.x, this.groundAt(s.x, s.z) + base * 0.1, s.z, base * 1.2, base * 0.8, base, this.rand() * 6.28)
      });
    }
    geos.forEach((g, i) => {
      this.rocks.add(buildChunked(g, this.rockMaterial, entries[i], { cast: true, cell: 200 }));
      this.rocks.add(buildChunked(g, this.rockMaterial, pebbleEntries[i], { cast: false, cell: 200 }));
    });
    scene.add(this.rocks);
  }

  createSectionRocks() {
    const track = this.tracks.find((candidate) => candidate.isSectioned);
    const section = track && track.sections[2];
    if (!section) return;

    const geometry = buildRock(913, 0.72);
    const mesh = new THREE.InstancedMesh(geometry, this.rockMaterial, 56);
    const dummy = new THREE.Object3D();
    const side = new THREE.Vector3();

    for (let index = 0; index < 56; index++) {
      const progress = 0.08 + (index / 55) * 0.84;
      const point = section.path.getPointAt(progress);
      const tangent = section.path.getTangentAt(progress).setY(0).normalize();
      side.set(-tangent.z, 0, tangent.x);
      const sign = index % 2 === 0 ? 1 : -1;
      const offset = sign * (16 + this.rand() * 58);
      point.addScaledVector(side, offset);
      point.y = this.terrain.getHeightAt(point.x, point.z) - 0.3;
      const scale = 1.8 + this.rand() * 4.2;
      dummy.position.copy(point);
      dummy.rotation.set((this.rand() - 0.5) * 0.25, this.rand() * Math.PI * 2, (this.rand() - 0.5) * 0.25);
      dummy.scale.set(scale * (0.8 + this.rand() * 0.5), scale * (0.55 + this.rand() * 0.5), scale * (0.7 + this.rand() * 0.6));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, this.tint(0.28));
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  createTumbleweeds() {
    const geo = buildTumbleweed();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    this.tumbleweeds = [];
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      const radius = 0.9 + this.rand() * 0.7;
      mesh.scale.setScalar(radius);
      mesh.castShadow = true;

      const x = (this.rand() - 0.5) * 1000;
      const z = (this.rand() - 0.5) * 1000;
      const windSpeed = 7 + this.rand() * 6;
      const windAngle = 0.2 + this.rand() * 0.4;
      const vx = Math.cos(windAngle) * windSpeed;
      const vz = Math.sin(windAngle) * windSpeed;

      const tw = {
        mesh,
        pos: new THREE.Vector3(x, this.groundAt(x, z) + radius, z),
        radius, vx, vz,
        rotAxis: new THREE.Vector3(vz, 0, -vx).normalize(),
        rotSpeed: windSpeed / radius,
        bounceFreq: 2.5 + this.rand() * 2,
        bounceHeight: 0.4 + this.rand() * 0.7,
        bouncePhase: this.rand() * Math.PI * 2
      };
      mesh.position.copy(tw.pos);
      this.tumbleweeds.push(tw);
      scene.add(mesh);
    }
  }

  setEndlessMode(enabled) {
    this.endlessMode = enabled;
    if (enabled && (this.obstacleTrack !== this.track || this.obstacleDifficulty !== this.difficulty)) {
      this.rebuildRaceObstacles();
    }
    if (this.obstacleGroup) this.obstacleGroup.visible = enabled;
  }

  setDifficulty(level) {
    this.difficulty = ENDLESS_OBSTACLE_COUNTS[level] ? level : 'easy';
    if (this.endlessMode && this.track?.mode === 'endless') {
      this.rebuildRaceObstacles();
    }
  }

  rebuildRaceObstacles() {
    if (this.obstacleGroup) this.obstacleGroup.removeFromParent();
    this.raceObstacles = [];
    this.obstacleGroup = null;
    this.createRaceObstacles();
    this.obstacleTrack = this.track;
  }

  createRaceObstacles() {
    this.obstacleGroup = new THREE.Group();
    const count = this.track?.mode === 'endless'
      ? ENDLESS_OBSTACLE_COUNTS[this.difficulty]
      : 14;
    const types = ['cactus', 'hurdle', 'boulder', 'log', 'tumbleweed', 'cactus', 'hurdle', 'boulder', 'log', 'tumbleweed'];
    const boulderGeometry = buildRock(713, 0.78);
    const tumbleweedGeometry = buildTumbleweed();
    const tumbleweedMaterial = new THREE.MeshStandardMaterial({ color: 0x9C7B4C, roughness: 0.96 });
    const logGeometry = new THREE.CylinderGeometry(0.38, 0.48, 7.2, 9);
    const logMaterial = new THREE.MeshStandardMaterial({ color: 0x765034, roughness: 0.92 });
    const hurdlePostGeometry = new THREE.BoxGeometry(0.2, 0.9, 0.2);
    const hurdleBeamGeometry = new THREE.BoxGeometry(6.6, 0.18, 0.25);
    const hurdlePostMaterial = new THREE.MeshStandardMaterial({ color: 0x754626, roughness: 0.9 });
    const hurdleBeamMaterial = new THREE.MeshStandardMaterial({ color: 0xD48638, roughness: 0.82 });

    for (let index = 0; index < count; index++) {
      const type = types[index % types.length];
      let mesh;
      let radius;
      let jumpClearance;
      let heightOffset = 0;

      if (type === 'cactus') {
        mesh = new THREE.Mesh(this.saguaroGeometries[index % 2 === 0 ? 2 : 3], this.saguaroMaterial);
        mesh.scale.setScalar(0.5);
        radius = 1.2;
        jumpClearance = 1.15;
      } else if (type === 'hurdle') {
        mesh = new THREE.Group();
        [-3.1, 3.1].forEach((x) => {
          const post = new THREE.Mesh(hurdlePostGeometry, hurdlePostMaterial);
          post.position.set(x, 0.45, 0);
          post.castShadow = true;
          mesh.add(post);
        });
        const beam = new THREE.Mesh(hurdleBeamGeometry, hurdleBeamMaterial);
        beam.position.y = 0.8;
        beam.castShadow = true;
        mesh.add(beam);
        radius = 2.6;
        jumpClearance = 0.82;
      } else if (type === 'boulder') {
        mesh = new THREE.Mesh(boulderGeometry, this.rockMaterial);
        const scale = 0.85 + this.rand() * 0.35;
        mesh.scale.set(scale * 1.2, scale * 0.8, scale);
        mesh.rotation.z = (this.rand() - 0.5) * 0.18;
        radius = 1.55;
        jumpClearance = 1.1;
      } else if (type === 'log') {
        mesh = new THREE.Mesh(logGeometry, logMaterial);
        mesh.rotation.z = Math.PI / 2;
        heightOffset = 0.48;
        radius = 1.45;
        jumpClearance = 0.95;
      } else {
        mesh = new THREE.Mesh(tumbleweedGeometry, tumbleweedMaterial);
        mesh.scale.setScalar(1.3);
        heightOffset = 0.8;
        radius = 1.25;
        jumpClearance = 0.9;
      }

      mesh.castShadow = true;
      mesh.userData.obstacleType = type;

      const obstacle = {
        mesh,
        type,
        progress: this.track?.isSectioned
          ? (4 + (index + 0.5) / count) / 6
          : (index + 2) / (count + 2),
        lane: [-5.5, 0, 5.5][index % 3],
        radius,
        jumpClearance,
        heightOffset,
        hit: false
      };
      this.positionRaceObstacle(obstacle);
      this.raceObstacles.push(obstacle);
      this.obstacleGroup.add(mesh);
    }
    scene.add(this.obstacleGroup);
  }

  positionRaceObstacle(obstacle) {
    if (!this.track) return;
    const point = this.track.getPointAt(obstacle.progress);
    const tangent = this.track.getTangentAt(obstacle.progress).setY(0).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const position = point.addScaledVector(side, obstacle.lane);
    const groundY = this.terrain ? this.terrain.getHeightAt(position.x, position.z) : position.y;
    obstacle.mesh.position.set(position.x, groundY + obstacle.heightOffset, position.z);
    obstacle.mesh.rotation.y = Math.atan2(tangent.x, tangent.z);
  }

  updateRaceObstacles(playerHorse) {
    if (!this.endlessMode || !playerHorse || !this.track) return;
    if (this.track.isSectioned) return;

    for (let index = 0; index < this.raceObstacles.length; index++) {
      const obstacle = this.raceObstacles[index];
      const relativeProgress = (obstacle.progress - playerHorse.trackProgress + 1) % 1;
      if (relativeProgress > 0.9) {
        obstacle.progress = (playerHorse.trackProgress + 0.22 + index * 0.045 + this.rand() * 0.04) % 1;
        obstacle.lane = [-5.5, 0, 5.5][Math.floor(this.rand() * 3)];
        obstacle.hit = false;
        this.positionRaceObstacle(obstacle);
      }
    }
  }

  checkRaceObstacleCollision(playerHorse) {
    if (!this.endlessMode || !playerHorse) return false;

    for (const obstacle of this.raceObstacles) {
      if (obstacle.hit) continue;
      const dx = playerHorse.mesh.position.x - obstacle.mesh.position.x;
      const dz = playerHorse.mesh.position.z - obstacle.mesh.position.z;
      if (dx * dx + dz * dz < (obstacle.radius + 0.7) ** 2 && playerHorse.jumpY < obstacle.jumpClearance) {
        obstacle.hit = true;
        playerHorse.speed *= 0.32;
        playerHorse.stamina = Math.max(0, playerHorse.stamina - 18);
        return true;
      }
    }
    return false;
  }

  /** Rolls tumbleweeds across the desert and recycles endless-mode obstacles. */
  update(dt = 0.016, cameraPosition = null, playerHorse = null) {
    this.time += dt;

    for (let i = 0; i < this.tumbleweeds.length; i++) {
      const tw = this.tumbleweeds[i];
      tw.pos.x += tw.vx * dt;
      tw.pos.z += tw.vz * dt;

      const groundY = this.terrain.getHeightAt(tw.pos.x, tw.pos.z);
      const bounce = Math.abs(Math.sin(this.time * tw.bounceFreq + tw.bouncePhase)) * tw.bounceHeight;
      tw.pos.y = groundY + tw.radius * 0.95 + bounce;
      tw.mesh.position.copy(tw.pos);
      tw.mesh.rotateOnAxis(tw.rotAxis, tw.rotSpeed * dt);

      if (tw.pos.x > 560) tw.pos.x = -560;
      if (tw.pos.x < -560) tw.pos.x = 560;
      if (tw.pos.z > 560) tw.pos.z = -560;
      if (tw.pos.z < -560) tw.pos.z = 560;
    }

    this.updateRaceObstacles(playerHorse);
  }
}
