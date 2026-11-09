import * as THREE from 'three';
import { WIND } from './atmosphere.js';
import { loft, GeoBatch, ellipsoid, sampleKeys, mixColor } from './geo.js';
import { noise3D, smoothstep, seededRandom } from './utils.js';

/** Hoof-to-hip pivot height: root of the skeleton sits this far above the ground. */
export const LEG_TOTAL = 1.98;

// Torso profile keyed rear -> front so the loft's up axis points to the spine.
const TZ = [1.86, 1.74, 1.50, 1.10, 0.65, 0.15, -0.40, -0.90, -1.25, -1.50, -1.66];
const TTOP = [0.62, 0.82, 0.96, 1.02, 0.96, 0.95, 1.00, 1.05, 0.96, 0.70, 0.35];
const TBOT = [0.36, 0.22, 0.02, -0.20, -0.36, -0.50, -0.54, -0.50, -0.46, -0.30, 0.00];
const THW = [0.12, 0.30, 0.52, 0.62, 0.58, 0.62, 0.64, 0.62, 0.54, 0.38, 0.14];

function torsoAt(f) {
  const top = sampleKeys(TTOP, f);
  const bot = sampleKeys(TBOT, f);
  return { z: sampleKeys(TZ, f), cy: (top + bot) / 2, ry: (top - bot) / 2, rx: sampleKeys(THW, f) };
}

function torsoAtZ(z) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (sampleKeys(TZ, m) > z) lo = m;
    else hi = m;
  }
  return torsoAt((lo + hi) / 2);
}

/** Cloth panel that hugs the barrel between two z stations and two angles measured from the spine. */
function hugPanel({ z0, z1, phi0, phi1, offset, segU = 14, segV = 8 }) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let v = 0; v <= segV; v++) {
    const sec = torsoAtZ(z0 + ((z1 - z0) * v) / segV);
    for (let u = 0; u <= segU; u++) {
      const phi = phi0 + ((phi1 - phi0) * u) / segU;
      pos.push((sec.rx + offset) * Math.sin(phi), sec.cy + (sec.ry + offset) * Math.cos(phi), sec.z ?? z0);
      uv.push(v / segV, u / segU);
    }
  }
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = v * (segU + 1) + u;
      const b = a + 1;
      const c = a + segU + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Southwestern saddle blanket: symmetric about the spine so both flanks mirror. */
function makeBlanketTexture(c) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const css = (hex) => `#${new THREE.Color(hex).getHexString()}`;
  g.fillStyle = css(c[0]);
  g.fillRect(0, 128, S, 128);

  const trim = css(c[2]);
  const second = css(c[1]);
  g.fillStyle = second;
  g.fillRect(0, 138, S, 8);
  g.fillRect(0, 226, S, 12);
  g.fillStyle = trim;
  g.fillRect(0, 146, S, 3);
  g.fillRect(0, 223, S, 3);
  g.fillRect(0, 238, S, 3);

  for (let i = 0; i < 8; i++) {
    const cx = i * 32 + 16;
    g.fillStyle = i % 2 ? trim : second;
    g.beginPath();
    g.moveTo(cx, 156);
    g.lineTo(cx + 13, 185);
    g.lineTo(cx, 214);
    g.lineTo(cx - 13, 185);
    g.closePath();
    g.fill();
    g.fillStyle = css(c[0]);
    g.beginPath();
    g.moveTo(cx, 168);
    g.lineTo(cx + 6, 185);
    g.lineTo(cx, 202);
    g.lineTo(cx - 6, 185);
    g.closePath();
    g.fill();
  }

  g.fillStyle = second;
  g.fillRect(0, 241, S, 15);
  g.fillStyle = trim;
  for (let i = 0; i < 32; i++) g.fillRect(i * 8 + 2, 245, 4, 11);

  g.save();
  g.translate(0, S);
  g.scale(1, -1);
  g.drawImage(cv, 0, 128, S, 128, 0, 128, S, 128);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Strand ribbons whose motion lives in the vertex shader: they stream back with speed. */
function makeHairMaterial({ stream, lift, wave, roughness = 0.7, color = 0xffffff }) {
  const mat = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness, side: THREE.DoubleSide });
  const speed = { value: 0 };
  mat.userData.speed = speed;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = WIND.time;
    shader.uniforms.uHairSpeed = speed;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute vec2 aHair;
        uniform float uWindTime;
        uniform float uHairSpeed;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        {
          float f = aHair.x;
          float ph = uWindTime * ( 4.0 + 8.0 * uHairSpeed ) + aHair.y;
          float sway = sin( ph ) * ${wave.toFixed(3)} * f * ( 0.4 + uHairSpeed );
          transformed.x += sway;
          transformed.y += sin( ph * 1.3 + 1.7 ) * ${(wave * 0.5).toFixed(3)} * f + uHairSpeed * ${lift.toFixed(3)} * f * f;
          transformed.z += uHairSpeed * ${stream.toFixed(3)} * f * f + sin( ph * 0.8 ) * ${(wave * 0.4).toFixed(3)} * f;
        }
      `);
  };
  return mat;
}

/**
 * Builds ribbons from strand descriptors.
 * Each strand: { root: Vector3, dir: Vector3, wide: Vector3, length, width, curl, colors: [root, tip], phase }
 */
function makeStrands(strands, segs = 6) {
  const pos = [];
  const nor = [];
  const col = [];
  const hair = [];
  const idx = [];
  strands.forEach((s) => {
    const start = pos.length / 3;
    const normal = new THREE.Vector3().crossVectors(s.dir, s.wide).normalize();
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      const centre = s.root.clone()
        .addScaledVector(s.dir, s.length * u)
        .addScaledVector(s.bend ?? new THREE.Vector3(0, -1, 0), s.curl * s.length * u * u);
      const half = (s.width * (1 - 0.82 * u)) / 2;
      const c = s.colors[0].clone().lerp(s.colors[1], u);
      [-1, 1].forEach((sg) => {
        const p = centre.clone().addScaledVector(s.wide, half * sg);
        pos.push(p.x, p.y, p.z);
        nor.push(normal.x, normal.y, normal.z);
        col.push(c.r, c.g, c.b);
        hair.push(u, s.phase);
      });
    }
    for (let k = 0; k < segs; k++) {
      const a = start + k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aHair', new THREE.Float32BufferAttribute(hair, 2));
  geo.setIndex(idx);
  return geo;
}

/** Thin crossed-ribbon rein updated every frame between the bit and the rider's hand. */
export class Rein {
  constructor(material) {
    this.segs = 8;
    const verts = (this.segs + 1) * 4;
    this.pos = new Float32Array(verts * 3);
    const idx = [];
    for (let s = 0; s < this.segs; s++) {
      for (let q = 0; q < 2; q++) {
        const a = s * 4 + q * 2;
        idx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
      }
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    geo.setAttribute('position', this.attr);
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
  }

  update(a, b) {
    const sag = 0.08 + a.distanceTo(b) * 0.07;
    const w = 0.012;
    for (let s = 0; s <= this.segs; s++) {
      const u = s / this.segs;
      const x = a.x + (b.x - a.x) * u;
      const y = a.y + (b.y - a.y) * u - sag * 4 * u * (1 - u);
      const z = a.z + (b.z - a.z) * u;
      const o = s * 12;
      this.pos.set([x - w, y, z, x + w, y, z, x, y - w, z, x, y + w, z], o);
    }
    this.attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

/**
 * Builds the complete horse + rider rig. Returns the skeleton groups used by the animation code.
 * Local space: faces -Z, +Y up, hooves at y = 0.
 */
export function buildHorseModel(coatHex, pal) {
  const coat = new THREE.Color(coatHex);
  const maneC = new THREE.Color(pal.mane ?? mixColor(coat, 0x000000, 0.7).getHex());
  const pointsC = pal.points != null ? new THREE.Color(pal.points) : null;
  const rider = pal.rider;
  const rand = seededRandom(pal.seed ?? 7);

  const mats = {
    coat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0 }),
    leather: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xE6B650, roughness: 0.3, metalness: 1.0 }),
    hoof: new THREE.MeshStandardMaterial({ color: 0x1D1814, roughness: 0.5 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0A0806, roughness: 0.06, metalness: 0.1 }),
    blanket: new THREE.MeshStandardMaterial({ map: makeBlanketTexture(pal.blanket), roughness: 0.92, side: THREE.DoubleSide }),
    rein: new THREE.MeshStandardMaterial({ color: 0x2A1A10, roughness: 0.6, side: THREE.DoubleSide }),
    mane: makeHairMaterial({ stream: 0.9, lift: 0.35, wave: 0.07 }),
    tail: makeHairMaterial({ stream: 1.55, lift: 1.05, wave: 0.1 }),
    scarf: makeHairMaterial({ stream: 1.9, lift: 1.0, wave: 0.16, roughness: 0.85 })
  };

  const leatherC = new THREE.Color(0x3B2314);
  const addMesh = (parent, batch, material, opts) => {
    const m = batch.mesh(material, opts);
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();
  const bodyRoot = new THREE.Group();
  bodyRoot.position.y = LEG_TOTAL;
  root.add(bodyRoot);
  const torso = new THREE.Group();
  bodyRoot.add(torso);

  // ---------------------------------------------------------------- torso
  const torsoColor = ({ p, a }) => {
    const belly = smoothstep(0.1, 1.0, -Math.sin(a));
    const back = smoothstep(0.3, 1.0, Math.sin(a));
    const n = noise3D(p.x * 2.4, p.y * 2.4, p.z * 2.4) * 0.05;
    return coat.clone().multiplyScalar(1 + 0.2 * belly - 0.07 * back + n);
  };
  const torsoStations = [];
  for (let k = 0; k <= 26; k++) {
    const s = torsoAt(k / 26);
    torsoStations.push({ p: [0, s.cy, s.z], rx: s.rx, ry: s.ry });
  }
  const body = new GeoBatch();
  body.add(loft(torsoStations, { radial: 22, colorFn: torsoColor }));
  [-1, 1].forEach((sg) => {
    body.add(ellipsoid(0.2, 0.52, 0.46, 12, 9), { position: [0.5 * sg, 0.46, -1.02], rotation: [0, 0, -0.15 * sg], color: coat });
    body.add(ellipsoid(0.27, 0.62, 0.5, 12, 9), { position: [0.5 * sg, 0.26, 1.2], rotation: [0, 0, -0.12 * sg], color: coat });
  });
  body.add(ellipsoid(0.42, 0.45, 0.34, 12, 9), { position: [0, -0.12, -1.42], color: coat.clone().multiplyScalar(1.05) });
  addMesh(torso, body, mats.coat);

  // ---------------------------------------------------------------- neck + head
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.62, -1.15);
  torso.add(neckPivot);

  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.0, 0.25),
    new THREE.Vector3(0, 0.42, -0.12),
    new THREE.Vector3(0, 0.80, -0.55),
    new THREE.Vector3(0, 1.10, -0.98),
    new THREE.Vector3(0, 1.30, -1.38)
  ]);
  const NRX = [0.42, 0.34, 0.27, 0.22, 0.19];
  const NRY = [0.55, 0.46, 0.38, 0.31, 0.27];
  const neckStations = neckCurve.getPoints(12).map((p, i, l) => {
    const f = i / (l.length - 1);
    return { p, rx: sampleKeys(NRX, f), ry: sampleKeys(NRY, f) };
  });
  const neck = new GeoBatch();
  neck.add(loft(neckStations, {
    radial: 18,
    colorFn: ({ a, p }) => coat.clone().multiplyScalar(1 + 0.12 * smoothstep(0.1, 1, -Math.sin(a)) + noise3D(p.x * 3, p.y * 3, p.z * 3) * 0.04)
  }));
  addMesh(neckPivot, neck, mats.coat);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.32, -1.40);
  neckPivot.add(headPivot);

  const headStations = [
    { p: [0, 0.10, 0.12], rx: 0.150, ry: 0.20 },
    { p: [0, 0.0, -0.10], rx: 0.185, ry: 0.25 },
    { p: [0, -0.17, -0.38], rx: 0.17, ry: 0.27 },
    { p: [0, -0.37, -0.68], rx: 0.125, ry: 0.165 },
    { p: [0, -0.55, -0.93], rx: 0.125, ry: 0.15 },
    { p: [0, -0.63, -1.07], rx: 0.112, ry: 0.122 }
  ];
  const blaze = pal.blaze ? new THREE.Color(0xF2EBDD) : null;
  const headColor = ({ a, t }) => {
    let c = coat.clone();
    if (pointsC) c.lerp(pointsC, smoothstep(0.78, 1.0, t) * 0.85);
    else c.lerp(new THREE.Color(0x3A2E28), smoothstep(0.85, 1.0, t) * 0.4);
    if (blaze && Math.sin(a) > 0.5 && Math.abs(Math.cos(a)) < 0.38 && t > 0.08 && t < 0.97) c = blaze.clone();
    return c;
  };
  const head = new GeoBatch();
  head.add(loft(headStations, { radial: 18, colorFn: headColor }));
  head.add(ellipsoid(0.17, 0.2, 0.23, 12, 9), { position: [0, -0.22, -0.30], color: coat.clone().multiplyScalar(1.02) });
  head.add(ellipsoid(0.1, 0.09, 0.1, 8, 6), { position: [0, -0.60, -0.97], color: pointsC ?? coat.clone().multiplyScalar(0.7) });
  addMesh(headPivot, head, mats.coat);

  const earGeo = new GeoBatch();
  earGeo.add(new THREE.ConeGeometry(0.07, 0.3, 6), { position: [0, 0.15, 0], color: coat });
  const earGeometry = earGeo.merged();
  const ears = [-1, 1].map((sg) => {
    const ear = new THREE.Mesh(earGeometry, mats.coat);
    ear.position.set(0.105 * sg, 0.30, 0.09);
    ear.rotation.set(-0.35, 0, -0.16 * sg);
    ear.castShadow = true;
    headPivot.add(ear);
    return ear;
  });

  const eyeBatch = new GeoBatch();
  [-1, 1].forEach((sg) => {
    eyeBatch.add(new THREE.SphereGeometry(0.05, 10, 8), { position: [0.168 * sg, 0.02, -0.16] });
    eyeBatch.add(ellipsoid(0.07, 0.04, 0.09, 8, 6), { position: [0.16 * sg, 0.1, -0.15], color: coat.clone().multiplyScalar(0.8) });
    eyeBatch.add(ellipsoid(0.03, 0.025, 0.035, 6, 5), { position: [0.07 * sg, -0.6, -1.12] });
  });
  addMesh(headPivot, eyeBatch, mats.eye, { cast: false });

  // Bridle: noseband, cheek straps, browband, gold bit rings and studs.
  const bridle = new GeoBatch();
  const gold = new GeoBatch();
  const headT = new THREE.Vector3(0, -0.6, -0.8).normalize();
  const alignQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), headT);
  const alignE = new THREE.Euler().setFromQuaternion(alignQ);
  const ring = (st, grow) => ({ rotation: [alignE.x, alignE.y, alignE.z], scale: [st.rx + grow, st.ry + grow, 1], position: st.p });
  bridle.add(new THREE.TorusGeometry(1, 0.016, 5, 20), { ...ring(headStations[3], 0.012), color: leatherC });
  bridle.add(new THREE.TorusGeometry(1, 0.014, 5, 20), { ...ring(headStations[1], 0.012), color: leatherC, position: [0, 0.05, -0.2] });
  [-1, 1].forEach((sg) => {
    bridle.add(new THREE.BoxGeometry(0.02, 0.025, 0.62), { position: [0.185 * sg, -0.12, -0.45], rotation: [0.62, 0, 0], color: leatherC });
    bridle.add(new THREE.BoxGeometry(0.02, 0.22, 0.025), { position: [0.18 * sg, -0.05, -0.1], color: leatherC });
    gold.add(new THREE.TorusGeometry(0.045, 0.009, 6, 14), { position: [0.125 * sg, -0.56, -0.96], rotation: [0, Math.PI / 2, 0] });
    gold.add(new THREE.SphereGeometry(0.03, 8, 6), { position: [0.18 * sg, 0.14, -0.22] });
    gold.add(new THREE.SphereGeometry(0.024, 8, 6), { position: [0.13 * sg, -0.36, -0.62] });
  });
  gold.add(new THREE.SphereGeometry(0.035, 8, 6), { position: [0, 0.12, -0.28] });
  addMesh(headPivot, bridle, mats.leather, { cast: false });
  addMesh(headPivot, gold, mats.gold, { cast: false });

  const bit = [-1, 1].map((sg) => {
    const o = new THREE.Object3D();
    o.position.set(0.125 * sg, -0.56, -0.96);
    headPivot.add(o);
    return o;
  });

  // Forelock and mane.
  const forelock = [];
  for (let k = 0; k < 7; k++) {
    forelock.push({
      root: new THREE.Vector3((k - 3) * 0.022, 0.2, 0.0),
      dir: new THREE.Vector3((rand() - 0.5) * 0.25, -0.35, -0.9).normalize(),
      wide: new THREE.Vector3(1, 0, 0),
      length: 0.34 + rand() * 0.14, width: 0.05, curl: 0.35,
      colors: [maneC.clone().multiplyScalar(0.8), maneC.clone()], phase: rand() * 6.28
    });
  }
  const forelockMesh = new THREE.Mesh(makeStrands(forelock, 4), mats.mane);
  forelockMesh.castShadow = true;
  forelockMesh.frustumCulled = false;
  headPivot.add(forelockMesh);

  const maneStrands = [];
  for (let k = 0; k < 30; k++) {
    const u = 0.1 + (k / 29) * 0.9;
    const p = neckCurve.getPoint(u);
    const t = neckCurve.getTangent(u);
    const up = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), t).normalize();
    const ry = sampleKeys(NRY, u);
    const rootPos = p.clone().addScaledVector(up, ry * 0.93);
    maneStrands.push({
      root: rootPos,
      dir: new THREE.Vector3(0.55 + rand() * 0.2, -0.75, 0.1 + rand() * 0.15).normalize(),
      wide: t.clone().normalize(),
      length: 0.5 + rand() * 0.28 - u * 0.1, width: 0.11, curl: 0.25,
      bend: new THREE.Vector3(0, -1, 0.2),
      colors: [maneC.clone().multiplyScalar(0.72), maneC.clone().multiplyScalar(0.95 + rand() * 0.2)],
      phase: rand() * 6.28
    });
  }
  const maneMesh = new THREE.Mesh(makeStrands(maneStrands, 5), mats.mane);
  maneMesh.castShadow = true;
  maneMesh.frustumCulled = false;
  neckPivot.add(maneMesh);

  // ---------------------------------------------------------------- tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.7, 1.82);
  torso.add(tailPivot);
  const tailStrands = [];
  for (let k = 0; k < 36; k++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.11;
    tailStrands.push({
      root: new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.8 - 0.05, 0),
      dir: new THREE.Vector3((rand() - 0.5) * 0.3, -0.92, 0.3 + rand() * 0.15).normalize(),
      wide: new THREE.Vector3(Math.cos(a * 1.7), 0, Math.sin(a * 1.7)).normalize(),
      length: 1.5 + rand() * 0.55, width: 0.08, curl: 0.12,
      bend: new THREE.Vector3(0, -1, 0.15),
      colors: [maneC.clone().multiplyScalar(0.7), maneC.clone().multiplyScalar(0.92 + rand() * 0.25)],
      phase: rand() * 6.28
    });
  }
  const tailMesh = new THREE.Mesh(makeStrands(tailStrands, 8), mats.tail);
  tailMesh.castShadow = true;
  tailMesh.frustumCulled = false;
  tailPivot.add(tailMesh);

  // ---------------------------------------------------------------- legs
  const legs = {};
  const specs = {
    FL: { x: -0.40, z: -0.98, front: true },
    FR: { x: 0.40, z: -0.98, front: true },
    BL: { x: -0.42, z: 1.12, front: false },
    BR: { x: 0.42, z: 1.12, front: false }
  };
  const socks = !!pal.socks;
  const sockC = new THREE.Color(0xF2EBDD);
  Object.entries(specs).forEach(([key, spec]) => {
    const hip = new THREE.Group();
    hip.position.set(spec.x, 0, spec.z);
    bodyRoot.add(hip);

    const upperSt = spec.front
      ? [
        { p: [0, 0.15, 0], rx: 0.19, ry: 0.24 }, { p: [0, -0.15, 0], rx: 0.155, ry: 0.21 },
        { p: [0, -0.55, 0], rx: 0.12, ry: 0.15 }, { p: [0, -0.90, 0], rx: 0.10, ry: 0.11 }, { p: [0, -1.0, 0], rx: 0.105, ry: 0.115 }
      ]
      : [
        { p: [0, 0.2, 0], rx: 0.26, ry: 0.33 }, { p: [0, -0.15, 0.05], rx: 0.2, ry: 0.3 },
        { p: [0, -0.55, 0.14], rx: 0.13, ry: 0.2 }, { p: [0, -0.9, 0.2], rx: 0.095, ry: 0.13 }, { p: [0, -1.0, 0.2], rx: 0.1, ry: 0.16 }
      ];
    const lowerSt = spec.front
      ? [
        { p: [0, 0.02, 0], rx: 0.10, ry: 0.11 }, { p: [0, -0.15, 0], rx: 0.075, ry: 0.085 }, { p: [0, -0.55, 0], rx: 0.068, ry: 0.078 },
        { p: [0, -0.72, 0.0], rx: 0.085, ry: 0.09 }, { p: [0, -0.82, 0.03], rx: 0.07, ry: 0.075 }
      ]
      : [
        { p: [0, 0.02, 0], rx: 0.095, ry: 0.15 }, { p: [0, -0.2, -0.05], rx: 0.07, ry: 0.09 }, { p: [0, -0.58, -0.10], rx: 0.062, ry: 0.075 },
        { p: [0, -0.74, -0.10], rx: 0.082, ry: 0.088 }, { p: [0, -0.84, -0.07], rx: 0.068, ry: 0.072 }
      ];

    const legBase = pointsC ?? coat.clone().multiplyScalar(0.8);
    const upperBatch = new GeoBatch();
    upperBatch.add(loft(upperSt, {
      radial: 14,
      colorFn: ({ p }) => coat.clone().lerp(legBase, smoothstep(-0.55, -1.0, p.y) * (pointsC ? 1 : 0.35))
    }));
    addMesh(hip, upperBatch, mats.coat);

    const knee = new THREE.Group();
    knee.position.set(0, -1.0, spec.front ? 0 : 0.2);
    hip.add(knee);

    const lowerBatch = new GeoBatch();
    lowerBatch.add(loft(lowerSt, {
      radial: 12,
      colorFn: ({ p }) => {
        let c = legBase.clone();
        if (socks && p.y < -0.45) c = sockC.clone();
        return c;
      }
    }));
    lowerBatch.add(new THREE.SphereGeometry(spec.front ? 0.11 : 0.125, 10, 8), { color: legBase });
    addMesh(knee, lowerBatch, mats.coat);

    const hoofBatch = new GeoBatch();
    const zOff = lowerSt[lowerSt.length - 1].p[2];
    hoofBatch.add(new THREE.CylinderGeometry(0.085, 0.118, 0.19, 10), { position: [0, -0.89, zOff + (spec.front ? 0.01 : 0)] });
    addMesh(knee, hoofBatch, mats.hoof);

    const hoof = new THREE.Object3D();
    hoof.position.set(0, -0.98, zOff);
    knee.add(hoof);

    legs[key] = { hip, knee, hoof, isFront: spec.front, defaultX: spec.x, defaultZ: spec.z };
  });

  // ---------------------------------------------------------------- tack
  const blanketMesh = new THREE.Mesh(hugPanel({ z0: -0.88, z1: 0.38, phi0: -1.6, phi1: 1.6, offset: 0.035, segU: 20, segV: 10 }), mats.blanket);
  blanketMesh.castShadow = true;
  blanketMesh.receiveShadow = true;
  torso.add(blanketMesh);

  const leather = new GeoBatch();
  const metal = new GeoBatch();
  leather.add(hugPanel({ z0: -0.56, z1: 0.30, phi0: -1.05, phi1: 1.05, offset: 0.07, segU: 12, segV: 6 }), { color: leatherC });
  leather.add(ellipsoid(0.40, 0.1, 0.48, 14, 8), { position: [0, 1.12, -0.12], color: leatherC.clone().multiplyScalar(1.25) });
  leather.add(new THREE.BoxGeometry(0.56, 0.2, 0.12), { position: [0, 1.2, 0.33], rotation: [-0.3, 0, 0], color: leatherC });
  leather.add(new THREE.CylinderGeometry(0.045, 0.06, 0.2, 8), { position: [0, 1.27, -0.52], color: leatherC });
  metal.add(new THREE.SphereGeometry(0.085, 10, 8), { position: [0, 1.4, -0.52] });
  leather.add(hugPanel({ z0: -0.31, z1: -0.20, phi0: 1.0, phi1: Math.PI * 2 - 1.0, offset: 0.04, segU: 16, segV: 2 }), { color: leatherC.clone().multiplyScalar(0.8) });
  [-1, 1].forEach((sg) => {
    leather.add(new THREE.BoxGeometry(0.05, 0.92, 0.025), { position: [0.58 * sg, 0.63, -0.28], rotation: [0, 0, 0.356 * sg], color: leatherC });
    metal.add(new THREE.TorusGeometry(0.1, 0.014, 6, 16), { position: [0.75 * sg, 0.2, -0.28], rotation: [0, Math.PI / 2, 0] });
    metal.add(new THREE.BoxGeometry(0.06, 0.04, 0.05), { position: [0.43 * sg, 1.04, -0.28] });
  });

  const breastCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.62, 0.45, -0.5), new THREE.Vector3(0.66, 0.1, -1.0), new THREE.Vector3(0.52, -0.2, -1.42),
    new THREE.Vector3(0.22, -0.3, -1.68), new THREE.Vector3(-0.22, -0.3, -1.68), new THREE.Vector3(-0.52, -0.2, -1.42),
    new THREE.Vector3(-0.66, 0.1, -1.0), new THREE.Vector3(-0.62, 0.45, -0.5)
  ]);
  leather.add(loft(breastCurve.getPoints(22).map(p => ({ p, rx: 0.04, ry: 0.04 })), { radial: 6, capStart: true, capEnd: true }), { color: leatherC });
  for (let k = 1; k <= 7; k++) metal.add(new THREE.SphereGeometry(0.055, 8, 6), { position: breastCurve.getPoint(k / 8).toArray() });
  addMesh(torso, leather, mats.leather);
  addMesh(torso, metal, mats.gold);

  // ---------------------------------------------------------------- rider
  const seat = new THREE.Group();
  seat.position.set(0, 1.16, -0.08);
  torso.add(seat);
  const upper = new THREE.Group();
  seat.add(upper);

  const robe = new THREE.Color(rider.robe);
  const vest = new THREE.Color(rider.vest);
  const turbanC = new THREE.Color(rider.turban);
  const skin = new THREE.Color(rider.skin ?? 0xC98B5E);
  const boot = new THREE.Color(0x2E1B10);

  const riderUp = new GeoBatch();
  const jacketSt = [
    { p: [0, 0.10, 0.02], rx: 0.2, ry: 0.14 }, { p: [0, 0.34, -0.02], rx: 0.22, ry: 0.15 },
    { p: [0, 0.58, -0.09], rx: 0.28, ry: 0.17 }, { p: [0, 0.76, -0.14], rx: 0.31, ry: 0.15 }, { p: [0, 0.86, -0.16], rx: 0.1, ry: 0.1 }
  ];
  riderUp.add(loft(jacketSt, {
    radial: 16,
    colorFn: ({ t }) => robe.clone().lerp(vest, smoothstep(0.25, 0.4, t))
  }));
  riderUp.add(new THREE.TorusGeometry(0.22, 0.03, 6, 18), { position: [0, 0.2, 0.0], rotation: [Math.PI / 2, 0, 0], color: new THREE.Color(pal.blanket[1]) });
  riderUp.add(new THREE.SphereGeometry(0.15, 14, 12), { position: [0, 1.0, -0.18], scale: [1, 1.08, 1], color: skin });
  riderUp.add(new THREE.SphereGeometry(0.158, 14, 8, 0, Math.PI * 2, 1.5, 1.2), { position: [0, 1.0, -0.18], scale: [1, 1.08, 1], color: robe });
  riderUp.add(new THREE.TorusGeometry(0.155, 0.045, 8, 18), { position: [0, 1.085, -0.18], rotation: [Math.PI / 2, 0, 0], color: turbanC });
  riderUp.add(new THREE.TorusGeometry(0.14, 0.05, 8, 18), { position: [0, 1.13, -0.17], rotation: [Math.PI / 2 + 0.18, 0, 0.12], color: turbanC.clone().multiplyScalar(0.94) });
  riderUp.add(new THREE.TorusGeometry(0.115, 0.045, 8, 16), { position: [0, 1.18, -0.17], rotation: [Math.PI / 2 - 0.12, 0, -0.1], color: turbanC });
  riderUp.add(new THREE.SphereGeometry(0.12, 12, 8), { position: [0, 1.17, -0.17], scale: [1, 0.7, 1], color: turbanC });
  riderUp.add(new THREE.BoxGeometry(0.27, 0.045, 0.05), { position: [0, 1.02, -0.325], color: 0x15100C });
  riderUp.add(new THREE.TorusGeometry(0.156, 0.016, 5, 18), { position: [0, 1.065, -0.18], rotation: [Math.PI / 2, 0, 0], color: new THREE.Color(pal.blanket[0]) });

  const hands = [];
  [-1, 1].forEach((sg) => {
    const shoulder = new THREE.Vector3(0.31 * sg, 0.74, -0.14);
    const elbow = new THREE.Vector3(0.37 * sg, 0.4, -0.04);
    const hand = new THREE.Vector3(0.17 * sg, 0.2, -0.64);
    riderUp.add(loft([
      { p: shoulder, rx: 0.085, ry: 0.085 }, { p: shoulder.clone().lerp(elbow, 0.5), rx: 0.078, ry: 0.078 }, { p: elbow, rx: 0.068, ry: 0.068 }
    ], { radial: 10, colorFn: () => robe.clone() }));
    riderUp.add(loft([
      { p: elbow, rx: 0.068, ry: 0.068 }, { p: elbow.clone().lerp(hand, 0.55), rx: 0.062, ry: 0.062 }, { p: hand, rx: 0.052, ry: 0.052 }
    ], { radial: 10, colorFn: () => robe.clone() }));
    riderUp.add(new THREE.SphereGeometry(0.055, 8, 6), { position: hand.toArray(), color: skin });
    const h = new THREE.Object3D();
    h.position.copy(hand);
    upper.add(h);
    hands.push(h);
  });
  addMesh(upper, riderUp, mats.cloth);

  const riderLegs = new GeoBatch();
  [-1, 1].forEach((sg) => {
    const hipP = new THREE.Vector3(0.2 * sg, 0.06, -0.02);
    const knee = new THREE.Vector3(0.64 * sg, -0.1, -0.46);
    const ankle = new THREE.Vector3(0.72 * sg, -0.9, -0.24);
    riderLegs.add(loft([
      { p: hipP, rx: 0.14, ry: 0.14 }, { p: hipP.clone().lerp(knee, 0.5), rx: 0.115, ry: 0.115 }, { p: knee, rx: 0.09, ry: 0.09 }
    ], { radial: 10, colorFn: () => robe.clone() }));
    riderLegs.add(loft([
      { p: knee, rx: 0.092, ry: 0.092 }, { p: knee.clone().lerp(ankle, 0.5), rx: 0.078, ry: 0.078 }, { p: ankle, rx: 0.062, ry: 0.062 }
    ], { radial: 10, colorFn: ({ t }) => (t > 0.15 ? boot.clone() : robe.clone()) }));
    riderLegs.add(new THREE.BoxGeometry(0.12, 0.1, 0.3), { position: [ankle.x, ankle.y - 0.06, ankle.z - 0.1], rotation: [0.25, 0, 0], color: boot });
  });
  addMesh(seat, riderLegs, mats.cloth);

  const scarfStrands = [{
    root: new THREE.Vector3(0, 1.1, -0.04),
    dir: new THREE.Vector3(0, -0.35, 0.94).normalize(),
    wide: new THREE.Vector3(1, 0, 0),
    length: 1.9, width: 0.2, curl: 0.35,
    bend: new THREE.Vector3(0, -1, 0),
    colors: [robe.clone(), robe.clone().lerp(new THREE.Color(pal.blanket[1]), 0.5)], phase: 0.5
  }, {
    root: new THREE.Vector3(0.05, 1.05, -0.06),
    dir: new THREE.Vector3(0.12, -0.45, 0.88).normalize(),
    wide: new THREE.Vector3(1, 0, 0),
    length: 1.4, width: 0.14, curl: 0.35,
    bend: new THREE.Vector3(0, -1, 0),
    colors: [new THREE.Color(pal.blanket[0]), new THREE.Color(pal.blanket[0]).multiplyScalar(0.8)], phase: 2.1
  }];
  const scarf = new THREE.Mesh(makeStrands(scarfStrands, 12), mats.scarf);
  scarf.castShadow = true;
  scarf.frustumCulled = false;
  upper.add(scarf);

  const reins = [new Rein(mats.rein), new Rein(mats.rein)];
  reins.forEach(r => torso.add(r.mesh));

  root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });

  return {
    root, bodyRoot, torso, neckPivot, headPivot, tailPivot, seat, upper, legs,
    ears, hands, bit, reins,
    hair: [mats.mane, mats.tail, mats.scarf]
  };
}
