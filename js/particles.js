import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './utils.js';
import { scene, renderer, camera } from './scene.js';
import { WIND, ATMOSPHERE_GLSL } from './atmosphere.js';

const DUST_MAX = 1800;
const MOTE_COUNT = 260;
const CLOD_MAX = 260;
const MOTE_RANGE = 70;

const DUST_VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute float aSeed;
  uniform float uScale;
  uniform float uMaxPoint;
  varying float vAlpha;
  varying float vSeed;
  varying float vLit;
  ${ATMOSPHERE_GLSL}
  void main() {
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
    float depth = max( -mv.z, 0.2 );
    float px = aSize * uScale / depth;
    float fade = 1.0 - smoothstep( 0.7 * uMaxPoint, uMaxPoint, px );
    fade *= smoothstep( 0.8, 3.0, depth );
    gl_PointSize = clamp( px, 1.0, uMaxPoint );
    vAlpha = aAlpha * fade;
    vSeed = aSeed;
    vec3 rayWorld = ( vec4( mv.xyz, 0.0 ) * viewMatrix ).xyz;
    float s = max( dot( normalize( rayWorld ), ATM_SUN_DIR ), 0.0 );
    vLit = 1.0 + pow( s, 3.0 ) * 1.4;
  }
`;

const DUST_FRAG = /* glsl */`
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vSeed;
  varying float vLit;
  float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float vn( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ),
                mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a = vSeed * 6.2831853;
    p = mat2( cos( a ), -sin( a ), sin( a ), cos( a ) ) * p;
    float r = length( p );
    float n = vn( p * 2.4 + vSeed * 17.0 ) * 0.65 + vn( p * 5.3 - vSeed * 9.0 ) * 0.35;
    float d = r + ( n - 0.5 ) * 0.7;
    float alpha = smoothstep( 1.0, 0.15, d ) * vAlpha;
    if ( alpha < 0.004 ) discard;
    float shade = 0.78 + 0.34 * n + 0.18 * ( 1.0 - r );
    gl_FragColor = vec4( uColor * vLit * shade, alpha );
  }
`;

function makePointsMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1000 },
      uMaxPoint: { value: 256 },
      uColor: { value: new THREE.Color(color) }
    },
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false
  });
}

function makePointsGeometry(count) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1));
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return geo;
}

const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * Dust, kicked clods and sun-lit air motes.
 * Dust is a ring-buffer pool of noisy soft sprites that glow when seen against the sun;
 * clods are instanced low-poly chunks with simple ballistics and bounces.
 */
export class ParticleSystem {
  constructor() {
    this.frameDt = 1 / 60;
    this.head = 0;

    const n = DUST_MAX;
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.alphaMax = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.rise = new Float32Array(n);

    this.dustMaterial = makePointsMaterial(0xFFCB93);
    this.dustGeometry = makePointsGeometry(n);
    this.dust = new THREE.Points(this.dustGeometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 10;
    scene.add(this.dust);

    this.createMotes();
    this.createClods();
  }

  createMotes() {
    this.moteMaterial = makePointsMaterial(0xFFE2A8);
    this.moteMaterial.uniforms.uColor.value.multiplyScalar(2.6);
    this.moteGeometry = makePointsGeometry(MOTE_COUNT);
    const pos = this.moteGeometry.attributes.position.array;
    const size = this.moteGeometry.attributes.aSize.array;
    const alpha = this.moteGeometry.attributes.aAlpha.array;
    this.moteData = [];
    for (let i = 0; i < MOTE_COUNT; i++) {
      pos[i * 3] = rnd(-MOTE_RANGE, MOTE_RANGE);
      pos[i * 3 + 1] = rnd(0.6, 22);
      pos[i * 3 + 2] = rnd(-MOTE_RANGE, MOTE_RANGE);
      size[i] = rnd(0.05, 0.13);
      alpha[i] = rnd(0.35, 0.8);
      this.moteData.push({ phase: rnd(0, 6.28), speed: rnd(0.6, 1.6) });
    }
    this.motes = new THREE.Points(this.moteGeometry, this.moteMaterial);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 11;
    scene.add(this.motes);
  }

  createClods() {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.7 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.5;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.8, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    this.clods = new THREE.InstancedMesh(geo, mat, CLOD_MAX);
    this.clods.frustumCulled = false;
    this.clods.castShadow = true;
    this.clodData = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CLOD_MAX; i++) {
      this.clods.setMatrixAt(i, zero);
      this.clods.setColorAt(i, new THREE.Color(0x7B5733));
      this.clodData.push({ life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0, size: 0, ground: 0, bounces: 0 });
    }
    this.clodHead = 0;
    this.clodTints = [0x8A5E36, 0x6E4A2C, 0xA8794A, 0x5A3E26, 0xB98B5A].map(c => new THREE.Color(c));
    this.clodDummy = new THREE.Object3D();
    this.clodZero = zero;
    scene.add(this.clods);
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, alpha, drag, rise) {
    const i = this.head;
    this.head = (this.head + 1) % DUST_MAX;
    const pos = this.dustGeometry.attributes.position.array;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = s0;
    this.size1[i] = s1;
    this.alphaMax[i] = alpha;
    this.drag[i] = drag;
    this.rise[i] = rise;
  }

  /**
   * Trailing plume behind a running horse; call once per frame per horse.
   * @param {THREE.Vector3} position - ground point under the horse
   * @param {THREE.Vector3} direction - heading (unit)
   * @param {number} intensity - 0..1 from speed
   */
  emitDust(position, direction, intensity = 1) {
    const k = clamp(intensity, 0, 1.2);
    const rate = 14 + 46 * k * k;
    const count = Math.floor(rate * this.frameDt + Math.random());
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    const speed = 8 + 34 * k;

    for (let c = 0; c < count; c++) {
      const back = rnd(0.8, 2.6);
      const lateral = rnd(-1.0, 1.0);
      this.spawn(
        position.x - direction.x * back + side.x * lateral,
        position.y + rnd(0.05, 0.5),
        position.z - direction.z * back + side.z * lateral,
        -direction.x * speed * rnd(0.05, 0.22) + rnd(-0.6, 0.6),
        rnd(0.4, 1.5) + 1.6 * k,
        -direction.z * speed * rnd(0.05, 0.22) + rnd(-0.6, 0.6),
        rnd(1.3, 2.6),
        rnd(1.0, 1.7) + 0.8 * k,
        rnd(3.4, 5.2) + 3.2 * k,
        rnd(0.16, 0.3) * (0.5 + k),
        0.955,
        0.3
      );
    }
  }

  /**
   * Sharp puff where a hoof lands.
   * @param {THREE.Vector3} position
   * @param {number} speed
   */
  emitHoofDust(position, speed = 20) {
    const k = clamp(speed / 40, 0.2, 1);
    const count = 2 + Math.floor(Math.random() * 2 + k * 2);
    for (let c = 0; c < count; c++) {
      const a = Math.random() * Math.PI * 2;
      const r = rnd(0.4, 1.7) * (0.6 + k);
      this.spawn(
        position.x + rnd(-0.15, 0.15),
        position.y + 0.08,
        position.z + rnd(-0.15, 0.15),
        Math.cos(a) * r,
        rnd(0.9, 2.2),
        Math.sin(a) * r,
        rnd(0.45, 1.0),
        rnd(0.6, 1.0),
        rnd(1.8, 3.0) + k,
        rnd(0.38, 0.6),
        0.9,
        0.5
      );
    }
  }

  /**
   * Chunks of turf flung up and back from a hoof strike.
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} direction - horse heading (unit)
   * @param {number} speed
   */
  emitClods(position, direction, speed) {
    if (speed < 10) return;
    const k = clamp((speed - 10) / 30, 0, 1);
    const count = Math.random() < 0.55 + 0.4 * k ? 1 + Math.floor(Math.random() * (1 + 2 * k)) : 0;
    const side = new THREE.Vector3(-direction.z, 0, direction.x);

    for (let c = 0; c < count; c++) {
      const i = this.clodHead;
      this.clodHead = (this.clodHead + 1) % CLOD_MAX;
      const d = this.clodData[i];
      const back = speed * rnd(0.15, 0.4) + rnd(0, 3);
      const lat = rnd(-2.5, 2.5);
      d.x = position.x + rnd(-0.2, 0.2);
      d.y = position.y + 0.12;
      d.z = position.z + rnd(-0.2, 0.2);
      d.vx = -direction.x * back + side.x * lat;
      d.vy = rnd(3.5, 8.0) + 3 * k;
      d.vz = -direction.z * back + side.z * lat;
      d.rx = Math.random() * 6.28;
      d.ry = Math.random() * 6.28;
      d.rz = Math.random() * 6.28;
      d.sx = rnd(-9, 9);
      d.sy = rnd(-9, 9);
      d.sz = rnd(-9, 9);
      d.size = rnd(0.07, 0.2) * (0.8 + 0.5 * k);
      d.ground = position.y;
      d.bounces = 0;
      d.maxLife = rnd(0.9, 1.7);
      d.life = d.maxLife;
      this.clods.setColorAt(i, this.clodTints[Math.floor(Math.random() * this.clodTints.length)]);
      this.clods.instanceColor.needsUpdate = true;
    }
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} [focus] - camera position; keeps air motes around the viewer
   */
  update(dt, focus = null) {
    this.frameDt = clamp(dt, 0.001, 0.05);
    this.updateScale();
    this.updateDust(dt);
    this.updateClods(dt);
    this.updateMotes(dt, focus);
  }

  updateScale() {
    if (!renderer || !camera) return;
    const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
    this.dustMaterial.uniforms.uScale.value = scale;
    this.moteMaterial.uniforms.uScale.value = scale;
    if (!this.maxPoint) {
      const gl = renderer.getContext();
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      this.maxPoint = Math.max(64, Math.min(range ? range[1] : 256, 512));
      this.dustMaterial.uniforms.uMaxPoint.value = this.maxPoint;
      this.moteMaterial.uniforms.uMaxPoint.value = this.maxPoint;
    }
  }

  updateDust(dt) {
    const geo = this.dustGeometry;
    const pos = geo.attributes.position.array;
    const size = geo.attributes.aSize.array;
    const alpha = geo.attributes.aAlpha.array;
    const vel = this.vel;
    const windX = 0.8 * dt;
    const windZ = 0.55 * dt;

    for (let i = 0; i < DUST_MAX; i++) {
      let life = this.life[i];
      if (life <= 0) continue;
      life -= dt;
      if (life <= 0) {
        this.life[i] = 0;
        alpha[i] = 0;
        continue;
      }
      this.life[i] = life;

      const k = 1 - life / this.maxLife[i];
      const drag = Math.pow(this.drag[i], dt * 60);
      const i3 = i * 3;
      vel[i3] = (vel[i3] + windX) * drag;
      vel[i3 + 1] = (vel[i3 + 1] + this.rise[i] * dt) * drag;
      vel[i3 + 2] = (vel[i3 + 2] + windZ) * drag;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      const grow = 1 - (1 - k) * (1 - k);
      size[i] = lerp(this.size0[i], this.size1[i], grow);
      alpha[i] = this.alphaMax[i] * smoothstep(0, 0.1, k) * (1 - smoothstep(0.3, 1, k));
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }

  updateClods(dt) {
    const dummy = this.clodDummy;
    let dirty = false;
    for (let i = 0; i < CLOD_MAX; i++) {
      const d = this.clodData[i];
      if (d.life <= 0) continue;
      dirty = true;
      d.life -= dt;
      if (d.life <= 0) {
        d.life = 0;
        this.clods.setMatrixAt(i, this.clodZero);
        continue;
      }

      d.vy -= 24 * dt;
      d.vx *= 1 - 0.4 * dt;
      d.vz *= 1 - 0.4 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < d.ground + d.size * 0.4) {
        d.y = d.ground + d.size * 0.4;
        if (d.bounces < 2 && d.vy < -1.5) {
          d.vy *= -0.32;
          d.vx *= 0.6;
          d.vz *= 0.6;
          d.bounces++;
        } else {
          d.vy = 0;
          d.vx *= 0.8;
          d.vz *= 0.8;
          d.sx *= 0.8;
          d.sy *= 0.8;
          d.sz *= 0.8;
        }
      }
      d.rx += d.sx * dt;
      d.ry += d.sy * dt;
      d.rz += d.sz * dt;

      const fade = 1 - smoothstep(0.65, 1, 1 - d.life / d.maxLife);
      dummy.position.set(d.x, d.y, d.z);
      dummy.rotation.set(d.rx, d.ry, d.rz);
      dummy.scale.setScalar(d.size * fade);
      dummy.updateMatrix();
      this.clods.setMatrixAt(i, dummy.matrix);
    }
    if (dirty) this.clods.instanceMatrix.needsUpdate = true;
  }

  updateMotes(dt, focus) {
    const pos = this.moteGeometry.attributes.position.array;
    const cx = focus ? focus.x : 0;
    const cz = focus ? focus.z : 0;
    const time = WIND.time.value;
    const span = MOTE_RANGE * 2;

    for (let i = 0; i < MOTE_COUNT; i++) {
      const m = this.moteData[i];
      const i3 = i * 3;
      pos[i3] += (1.1 + Math.sin(time * 0.7 + m.phase) * 0.5) * m.speed * dt;
      pos[i3 + 1] += Math.sin(time * 0.9 + m.phase * 2) * 0.25 * dt;
      pos[i3 + 2] += (0.6 + Math.cos(time * 0.5 + m.phase) * 0.4) * m.speed * dt;

      pos[i3] = cx + ((pos[i3] - cx + MOTE_RANGE) % span + span) % span - MOTE_RANGE;
      pos[i3 + 2] = cz + ((pos[i3 + 2] - cz + MOTE_RANGE) % span + span) % span - MOTE_RANGE;
      if (pos[i3 + 1] < 0.5) pos[i3 + 1] = 20;
      else if (pos[i3 + 1] > 24) pos[i3 + 1] = 0.8;
    }
    this.moteGeometry.attributes.position.needsUpdate = true;
  }
}
