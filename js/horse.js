import * as THREE from 'three';
import { lerp, clamp, smoothstep } from './utils.js';
import { buildHorseModel, LEG_TOTAL } from './horseModel.js';

const TAU = Math.PI * 2;
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const NO_INPUT = Object.freeze({ forward: false, backward: false, left: false, right: false, steer: 0, sprint: false, jump: false });
const LEG_ORDER = ['FL', 'FR', 'BL', 'BR'];
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Per-leg foot travel (in leg-length units scaled by gait amplitude) and swing clearance. */
const REACH = {
  front: { fwd: 0.82, back: 0.62, lift: 1.0 },
  hind: { fwd: 0.55, back: 0.98, lift: 0.9 }
};

/**
 * Speed-keyed gait table. `offs` are touchdown offsets in strides for [FL, FR, BL, BR];
 * values are chosen so neighbouring keys never differ by more than half a stride.
 */
const GAIT_KEYS = [
  { speed: 0, amp: 0.0, duty: 1.0, rate: 1.0, crouch: 0.0, bob: 0.0, pitch: 0.0, neck: 0.0, neckBob: 0.0, lean: 0.05, lift: 0.5, offs: [0.25, 0.75, 0.0, 0.5] },
  { speed: 4, amp: 0.34, duty: 0.64, rate: 1.0, crouch: 0.0, bob: 0.01, pitch: 0.0, neck: 0.0, neckBob: 0.04, lean: 0.08, lift: 0.55, offs: [0.25, 0.75, 0.0, 0.5] },
  { speed: 13, amp: 0.58, duty: 0.47, rate: 1.55, crouch: 0.06, bob: 0.06, pitch: 0.02, neck: -0.06, neckBob: 0.05, lean: 0.2, lift: 0.7, offs: [0.0, 0.5, 0.5, 0.0] },
  { speed: 26, amp: 0.92, duty: 0.3, rate: 2.0, crouch: 0.12, bob: 0.13, pitch: 0.06, neck: -0.18, neckBob: 0.09, lean: 0.5, lift: 0.95, offs: [0.24, 0.46, 1.0, 0.2] },
  { speed: 42, amp: 1.1, duty: 0.25, rate: 2.7, crouch: 0.16, bob: 0.16, pitch: 0.08, neck: -0.3, neckBob: 0.1, lean: 0.72, lift: 1.1, offs: [0.24, 0.46, 1.0, 0.2] }
];
const NUM_KEYS = ['amp', 'duty', 'rate', 'crouch', 'bob', 'pitch', 'neck', 'neckBob', 'lean', 'lift'];

function sampleGait(speed, out) {
  let i = 0;
  while (i < GAIT_KEYS.length - 2 && speed >= GAIT_KEYS[i + 1].speed) i++;
  const a = GAIT_KEYS[i];
  const b = GAIT_KEYS[i + 1];
  const t = clamp((speed - a.speed) / (b.speed - a.speed), 0, 1);
  const e = t * t * (3 - 2 * t);
  for (let k = 0; k < NUM_KEYS.length; k++) out[NUM_KEYS[k]] = lerp(a[NUM_KEYS[k]], b[NUM_KEYS[k]], e);
  for (let j = 0; j < 4; j++) out.offs[j] = lerp(a.offs[j], b.offs[j], e);
  return out;
}

/**
 * Horse + rider: physics, gait animation and the model rig built by buildHorseModel().
 */
export class Horse {
  /**
   * @param {number} [color] - coat hex
   * @param {Object} [palette] - see Horse.PALETTES
   */
  constructor(color = Horse.PALETTES.player.coat, palette = Horse.PALETTES.player) {
    this.mesh = new THREE.Group();
    // Yaw first, then pitch/roll in the horse's own frame.
    this.mesh.rotation.order = 'YXZ';
    this.coatColor = color;
    this.palette = palette;
    this.accentColor = palette.blanket[0];

    this.speed = 0;
    this.maxSpeed = 35;
    this.baseMaxSpeed = 35;
    this.sprintMaxSpeed = 45;
    this.acceleration = 15;
    this.deceleration = 20;
    this.turnSpeed = 2.5;
    this.stamina = 100;
    this.maxStamina = 100;
    this.staminaDrain = 20;
    this.staminaRegen = 10;
    this.currentGait = 'idle';
    this.trackProgress = 0;
    this.lap = 0;
    this.lapTimes = [];
    this.currentLapStartTime = 0;
    this.totalRaceTime = 0;
    this.finished = false;
    this.lastCheckpoint = -1;
    this.direction = new THREE.Vector3(0, 0, -1);
    this.velocity = new THREE.Vector3();

    this.currentRoll = 0;
    this.currentPitch = 0;

    this.isJumping = false;
    this.jumpVelocity = 0;
    this.jumpY = 0;

    // Animation state
    this.stride = 0;
    this.clock = Math.random() * 10;
    this.hairSpeed = 0;
    this.airborne = 0;
    this.hoofStrikes = [];
    this._gait = { offs: [0, 0, 0, 0] };
    NUM_KEYS.forEach((k) => { this._gait[k] = 0; });
    this._lastTouch = [NaN, NaN, NaN, NaN];

    this.rig = buildHorseModel(color, palette);
    this.mesh.add(this.rig.root);
    this.bodyParts = {
      bodyRoot: this.rig.bodyRoot, torso: this.rig.torso, neckPivot: this.rig.neckPivot,
      headPivot: this.rig.headPivot, tailPivot: this.rig.tailPivot, legs: this.rig.legs
    };
    this.setupLegs();
  }

  /** Reads bone lengths and rest tilts from the rig so the two-bone solver matches the mesh. */
  setupLegs() {
    this.legs = LEG_ORDER.map((key) => {
      const leg = this.rig.legs[key];
      const f1 = -leg.knee.position.z;
      const d1 = -leg.knee.position.y;
      const f2 = -leg.hoof.position.z;
      const d2 = -leg.hoof.position.y;
      return {
        key,
        hip: leg.hip,
        knee: leg.knee,
        hoof: leg.hoof,
        front: leg.isFront,
        hx: leg.hip.position.x,
        hz: leg.hip.position.z,
        L1: Math.hypot(f1, d1),
        L2: Math.hypot(f2, d2),
        psi1: Math.atan2(f1, d1),
        psi2: Math.atan2(f2, d2),
        reach: leg.isFront ? REACH.front : REACH.hind
      };
    });
  }

  /**
   * Main per-frame update.
   * @param {number} dt
   * @param {Object|null} input - { forward, backward, left, right, sprint, jump }
   * @param {Object} [terrain] - getHeightAt(x, z)
   * @param {Object} [track] - isOnTrack(pos), getClosestPoint(pos)
   */
  update(dt, input, terrain, track) {
    const coasting = this.finished;
    const inp = coasting ? NO_INPUT : (input || NO_INPUT);

    // 1. Acceleration / deceleration
    if (coasting) {
      this.speed *= Math.max(0, 1 - 2.4 * dt);
      if (this.speed < 0.2) this.speed = 0;
    } else if (inp.forward) {
      this.speed += this.acceleration * dt;
    } else if (inp.backward) {
      this.speed -= this.deceleration * dt;
    } else {
      this.speed *= Math.max(0, 1 - 2.0 * dt);
      if (Math.abs(this.speed) < 0.3) this.speed = 0;
    }

    // 2. Sprint handling (stamina drain / regen)
    const wantsSprint = inp.sprint && this.stamina > 0 && this.speed > 8;
    if (wantsSprint) {
      this.maxSpeed = this.sprintMaxSpeed;
      this.stamina = Math.max(0, this.stamina - this.staminaDrain * dt);
    } else {
      this.maxSpeed = this.baseMaxSpeed;
      if (!inp.sprint) {
        this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * dt);
      }
    }

    // 3. Clamp speed
    this.speed = clamp(this.speed, 0, this.maxSpeed);

    // 4. Off-track penalty increases with distance from the racing surface.
    if (track && !coasting && typeof track.getClosestPoint === 'function') {
      const closest = track.getClosestPoint(this.mesh.position);
      const trackDistance = closest && typeof closest.distance === 'number' ? closest.distance : 0;
      const trackEdge = (track.trackWidth || 20) * 0.5;

      if (trackDistance > trackEdge) {
        const sandDepth = clamp((trackDistance - trackEdge) / trackEdge, 0, 1);
        const sandDrag = lerp(0.982, 0.94, sandDepth);
        const sandSpeedCap = lerp(this.maxSpeed, 12, sandDepth);
        this.speed = Math.min(this.speed * Math.pow(sandDrag, dt * 60), sandSpeedCap);
      }
    }

    // 5. Steering
    const steer = Number.isFinite(inp.steer)
      ? clamp(inp.steer, -1, 1)
      : (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    if (steer !== 0) this.direction.applyAxisAngle(AXIS_Y, this.turnSpeed * dt * steer);
    this.direction.y = 0;
    this.direction.normalize();

    // Speed-sensitive cornering penalty and lean into turns
    const turnIntent = steer;
    const speedRatio = clamp(this.speed / 25, 0, 1);
    const corneringLoad = Math.abs(turnIntent) * speedRatio * speedRatio;
    this.speed *= Math.max(0, 1 - corneringLoad * 0.65 * dt);
    const targetRoll = turnIntent * 0.22 * speedRatio;
    this.currentRoll = lerp(this.currentRoll, targetRoll, clamp(6.0 * dt, 0, 1));

    // 6. Movement along direction
    this.velocity.copy(this.direction).multiplyScalar(this.speed * dt);
    this.mesh.position.add(this.velocity);

    // 7. Jump handling
    if (inp.jump && !this.isJumping && this.jumpY <= 0.05) {
      this.isJumping = true;
      this.jumpVelocity = 8.5;
    }
    if (this.isJumping) {
      this.jumpVelocity -= 24.0 * dt;
      this.jumpY += this.jumpVelocity * dt;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        this.isJumping = false;
        this.jumpVelocity = 0;
      }
    }

    // 8. Terrain following and slope pitch (positive pitch = nose up)
    let groundY = this.mesh.position.y - this.jumpY;
    let groundPitch = 0;
    if (terrain && typeof terrain.getHeightAt === 'function') {
      const p = this.mesh.position;
      groundY = terrain.getHeightAt(p.x, p.z);
      const sampleDist = 1.4;
      const frontY = terrain.getHeightAt(p.x + this.direction.x * sampleDist, p.z + this.direction.z * sampleDist);
      const backY = terrain.getHeightAt(p.x - this.direction.x * sampleDist, p.z - this.direction.z * sampleDist);
      groundPitch = Math.atan((frontY - backY) / (sampleDist * 2));
    }
    this.mesh.position.y = groundY + this.jumpY;

    // 9. Orientation
    this.mesh.rotation.y = Math.atan2(-this.direction.x, -this.direction.z);
    this.currentPitch = lerp(this.currentPitch, groundPitch, clamp(8.0 * dt, 0, 1));
    this.mesh.rotation.x = this.currentPitch;
    this.mesh.rotation.z = this.currentRoll;

    // 10. Gait + pose
    this.currentGait = this.getGait();
    this.animate(dt);

    // 11. Lap bookkeeping
    if (track && !coasting) this.updateTrackProgress(track, dt);
  }

  /** @returns {'idle'|'walk'|'trot'|'gallop'|'sprint'} */
  getGait() {
    if (this.speed < 0.8) return 'idle';
    if (this.speed < 8.0) return 'walk';
    if (this.speed < 18.0) return 'trot';
    if (this.speed < 34.0) return 'gallop';
    return 'sprint';
  }

  /**
   * Poses the rig: feet follow ground-planted paths solved with two-bone IK, the body rises
   * during flight, and neck, tail, ears, rider and reins follow the stride.
   */
  animate(dt) {
    const rig = this.rig;
    const g = sampleGait(this.speed, this._gait);
    const time = (this.clock += dt);

    this.stride += dt * g.rate * smoothstep(0.25, 1.5, this.speed);
    const stride = this.stride;
    const speedN = clamp(this.speed / 40, 0, 1);
    const jump = clamp(this.jumpY / 1.4, 0, 1);

    // Foot targets and stance weighting
    let stanceSum = 0;
    const fwd = [0, 0, 0, 0];
    const lift = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const leg = this.legs[i];
      const r = leg.reach;
      const phase = stride - g.offs[i];
      const u = phase - Math.floor(phase);
      if (u < g.duty) {
        const s = u / g.duty;
        fwd[i] = lerp(r.fwd, -r.back, s) * g.amp;
        lift[i] = 0.05 * smoothstep(0.8, 1.0, s) * g.amp;
        stanceSum += 1;
      } else {
        const s = (u - g.duty) / (1 - g.duty);
        const e = s * s * (3 - 2 * s);
        fwd[i] = lerp(-r.back, r.fwd, e) * g.amp;
        lift[i] = r.lift * g.lift * Math.pow(Math.sin(Math.PI * s), 0.85);
      }
      if (jump > 0) {
        fwd[i] += leg.front ? jump * 0.5 : -jump * 0.1;
        lift[i] += jump * (leg.front ? 1.0 : 0.8);
      }
    }

    // Body height: low while feet carry weight, rising through the flight phase.
    const air = clamp(1 - stanceSum / 1.7, 0, 1);
    this.airborne = lerp(this.airborne, air, 1 - Math.exp(-dt * 18));
    const breath = Math.sin(time * 1.7);
    const H = LEG_TOTAL - g.crouch + g.bob * this.airborne + breath * 0.008 * (1 - speedN);
    const pitch = g.pitch * Math.sin(TAU * stride);
    rig.bodyRoot.position.y = H;
    rig.bodyRoot.rotation.x = pitch;

    for (let i = 0; i < 4; i++) this.solveLeg(this.legs[i], fwd[i], lift[i], H, pitch);

    // Neck, head, tail, ears
    const nodWave = Math.sin(TAU * (stride - 0.05));
    rig.neckPivot.rotation.x = g.neck - g.neckBob * nodWave + Math.sin(time * 1.2) * 0.02;
    rig.headPivot.rotation.x = -g.neck * 0.85 + g.neckBob * 0.6 * nodWave + Math.sin(time * 1.2 + 1.0) * 0.02;
    rig.tailPivot.rotation.x = -(0.06 + 0.4 * speedN) + Math.sin(time * 1.3) * 0.03;
    rig.tailPivot.rotation.z = -this.currentRoll * 0.6 + Math.sin(time * 1.1) * 0.05 * (1 - speedN);
    rig.ears.forEach((ear, k) => {
      const sg = k === 0 ? -1 : 1;
      ear.rotation.x = -0.35 + speedN * 0.62 + Math.sin(time * 2.3 + sg * 1.7) * 0.06 * (1 - speedN);
    });

    // Rider keeps a racing crouch that deepens with speed and soaks up the body pitch.
    rig.upper.rotation.x = -g.lean - 0.6 * pitch;
    rig.upper.rotation.z = this.currentRoll * 0.5;
    rig.upper.position.y = -this.airborne * g.bob * 0.5;

    // Hair streams back with speed.
    this.hairSpeed = lerp(this.hairSpeed, clamp(this.speed / 38, 0, 1), 1 - Math.exp(-dt * 4));
    for (let k = 0; k < rig.hair.length; k++) rig.hair[k].userData.speed.value = this.hairSpeed;

    // Matrices are needed for hoof contact points and rein endpoints.
    this.mesh.updateMatrixWorld(true);

    this.hoofStrikes = [];
    for (let i = 0; i < 4; i++) {
      const idx = Math.floor(stride - g.offs[i]);
      const last = this._lastTouch[i];
      if (!Number.isNaN(last) && idx > last && this.speed > 3) {
        this.hoofStrikes.push({ leg: this.legs[i].key, position: this.legs[i].hoof.getWorldPosition(new THREE.Vector3()) });
      }
      this._lastTouch[i] = idx;
    }

    for (let i = 0; i < 2; i++) {
      rig.bit[i].getWorldPosition(_a);
      rig.hands[i].getWorldPosition(_b);
      rig.torso.worldToLocal(_a);
      rig.torso.worldToLocal(_b);
      rig.reins[i].update(_a, _b);
    }
  }

  /**
   * Two-bone IK in the sagittal plane. Targets are expressed in the horse root frame
   * (forward offset from the hip, height above the ground) and moved into the pitched body frame.
   */
  solveLeg(leg, fwd, footY, H, pitch) {
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    const tz = leg.hz - fwd;
    const dy = footY - H;
    const yb = dy * c + tz * s;
    const zb = -dy * s + tz * c;
    const tf = -(zb - leg.hz);
    const td = -yb;

    const { L1, L2 } = leg;
    const D = clamp(Math.hypot(tf, td), Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.004);
    const beta = Math.atan2(tf, td);
    const alpha = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    // Front knees point forward, hind hocks point backward.
    const theta1 = leg.front ? beta + alpha : beta - alpha;
    const kf = L1 * Math.sin(theta1);
    const kd = L1 * Math.cos(theta1);
    const theta2 = Math.atan2(D * Math.sin(beta) - kf, D * Math.cos(beta) - kd);

    leg.hip.rotation.x = theta1 - leg.psi1;
    leg.knee.rotation.x = theta2 - theta1 + leg.psi1 - leg.psi2;
  }

  /**
   * Tracks race progression, checkpoint crossings, and lap completion.
   * @param {Object} track
   * @param {number} dt
   */
  updateTrackProgress(track, dt) {
    this.totalRaceTime += dt;
    this.currentLapStartTime += dt;

    if (typeof track.getClosestPoint !== 'function') return;

    const closest = track.getClosestPoint(this.mesh.position);
    let progressT = 0;

    if (typeof closest === 'number') {
      progressT = closest;
    } else if (closest && typeof closest.t === 'number') {
      progressT = closest.t;
    } else if (closest && typeof closest.progress === 'number') {
      progressT = closest.progress;
    }

    const prevT = this.trackProgress;
    this.trackProgress = progressT;

    // Official checkpoints must be crossed in order before the finish line counts a lap.
    const checkpoints = Array.isArray(track.checkpoints) && track.checkpoints.length > 1
      ? track.checkpoints
      : null;

    if (checkpoints) {
      const nextCheckpointIndex = this.lastCheckpoint + 1;
      const nextCheckpoint = checkpoints[nextCheckpointIndex];
      const movedForward = progressT >= prevT;

      if (nextCheckpoint && movedForward && prevT < nextCheckpoint.t && progressT >= nextCheckpoint.t) {
        this.lastCheckpoint = nextCheckpointIndex;
      }
    }

    const finishThreshold = checkpoints ? checkpoints[checkpoints.length - 1].t : 0.82;
    const requiredCheckpoint = checkpoints ? checkpoints.length - 1 : 2;
    const crossedFinish = track.isClosed === false
      ? prevT < 0.985 && progressT >= 0.985
      : prevT > finishThreshold && progressT < 0.18;

    if (crossedFinish && this.lastCheckpoint >= requiredCheckpoint) {
      this.lap++;
      this.lapTimes.push(this.currentLapStartTime);
      this.currentLapStartTime = 0;
      this.lastCheckpoint = 0;

      const totalLaps = track.totalLaps || 3;
      if (this.lap >= totalLaps) {
        this.finished = true;
      }
    }
  }

  /**
   * Hoof contacts recorded this frame.
   * @returns {Array<{ leg: string, position: THREE.Vector3 }>}
   */
  getRecentHoofStrikes() {
    return this.hoofStrikes;
  }

  /**
   * Resets horse to given position and direction for race restart.
   * @param {THREE.Vector3} [position]
   * @param {THREE.Vector3} [direction]
   */
  reset(position, direction) {
    if (position) this.mesh.position.copy(position);
    if (direction) {
      this.direction.copy(direction).setY(0).normalize();
    } else {
      this.direction.set(0, 0, -1);
    }

    this.speed = 0;
    this.maxSpeed = this.baseMaxSpeed;
    this.stamina = this.maxStamina;
    this.lap = 0;
    this.trackProgress = 0;
    this.finished = false;
    // Start/finish is checkpoint zero; racers must clear every later checkpoint before returning.
    this.lastCheckpoint = 0;
    this.lapTimes = [];
    this.currentLapStartTime = 0;
    this.totalRaceTime = 0;
    this.velocity.set(0, 0, 0);
    this.isJumping = false;
    this.jumpVelocity = 0;
    this.jumpY = 0;
    this.currentRoll = 0;
    this.currentPitch = 0;
    this.stride = 0;
    this.hairSpeed = 0;
    this.airborne = 0;
    this._lastTouch.fill(NaN);
    this.hoofStrikes = [];

    this.mesh.rotation.set(0, Math.atan2(-this.direction.x, -this.direction.z), 0);
  }
}

/** Coats, tack and rider outfits. Blanket colors are [field, border, trim]. */
Horse.PALETTES = {
  player: {
    coat: 0x5A3318,
    mane: 0x120D0A,
    points: 0x1B1410,
    blanket: [0x8E1F1A, 0xE0B14C, 0xF2E4C2],
    rider: { robe: 0xEADFC4, vest: 0x7B1E19, turban: 0xF4EFE4, skin: 0xC98B5E },
    seed: 3
  },
  ai: [
    {
      coat: 0x2C1810, mane: 0x0E0A08, points: 0x120D0A,
      blanket: [0x1F5F8B, 0xE8C26A, 0xF2EEDF],
      rider: { robe: 0x3C5A7A, vest: 0x1B3350, turban: 0xBFD6EA, skin: 0xB97A4E },
      seed: 5
    },
    {
      coat: 0xD4A056, mane: 0xF3E6C6,
      blanket: [0x2E7D4F, 0xF2D58A, 0xFFF5DC],
      rider: { robe: 0xF1E6C8, vest: 0x2E7D4F, turban: 0xF8F3E6, skin: 0xD8A072 },
      seed: 8
    },
    {
      coat: 0xCFCBC2, mane: 0x8F8A82, points: 0x6D6A64,
      blanket: [0x5B2A86, 0xC9B3E6, 0xF2EEDF],
      rider: { robe: 0xD6D0E3, vest: 0x4A2272, turban: 0xEEE8F8, skin: 0xB07A52 },
      seed: 11
    },
    {
      coat: 0x8B4513, mane: 0x5C2C0E, blaze: true, socks: true,
      blanket: [0xD35400, 0xFFD27A, 0xFFF1D6],
      rider: { robe: 0xF0C27A, vest: 0xB8420F, turban: 0xFFE6C0, skin: 0xD9A67A },
      seed: 14
    },
    {
      coat: 0x16161E, mane: 0x0A0A0E,
      blanket: [0xC2185B, 0xF5C6D9, 0xF2EEDF],
      rider: { robe: 0x2A2A3A, vest: 0x8E1243, turban: 0xF0C6D6, skin: 0x7A4B2E },
      seed: 17
    }
  ]
};
