import * as THREE from 'three';
import { Horse } from './horse.js';
import { lerp, clamp, randomRange } from './utils.js';

const DIFFICULTY_PROFILES = {
  easy: { speed: null, variance: 1, cornering: 0, stamina: 0, aggression: 1, baseMaxSpeed: 35, sprintMaxSpeed: 45, rubberBandMin: 0.78, rubberBandMax: 1.25 },
  medium: { speed: 32, variance: 0.8, cornering: 0.03, stamina: 0.04, aggression: 1.05, baseMaxSpeed: 38, sprintMaxSpeed: 46, rubberBandMin: 0.76, rubberBandMax: 1.32 },
  hard: { speed: 35, variance: 0.75, cornering: 0.06, stamina: 0.08, aggression: 1.1, baseMaxSpeed: 41, sprintMaxSpeed: 49, rubberBandMin: 0.74, rubberBandMax: 1.42 },
  expert: { speed: [36, 38, 40, 42, 44], variance: 0.7, cornering: 0.1, stamina: 0.13, aggression: 1.15, baseMaxSpeed: 49, sprintMaxSpeed: 57, rubberBandMin: 0.7, rubberBandMax: 1.52 }
};

/**
 * Manages 5 AI opponent horses with distinct personalities, racing skills,
 * collision avoidance, rubber-banding, and track-following navigation.
 */
export class AIManager {
  /**
   * @param {Object} track - Track reference with getPointAt, getTangentAt, isOnTrack, etc.
   * @param {Object} terrain - Terrain reference with getHeightAt
   */
  constructor(track, terrain) {
    this.track = track;
    this.terrain = terrain;
    this.horses = [];
    this.aiData = [];
    this.baseSkills = [];
    this.difficulty = 'easy';

    this.init();
  }

  /**
   * Spawns 5 AI horses with unique visual coats, names, and driving skill profiles.
   */
  init() {
    const names = ['Shadow', 'Goldie', 'Ghost', 'Blaze', 'Midnight'];
    const skills = [
      { baseSpeed: 28, speedVariance: 2.0, corneringSkill: 0.85, staminaManagement: 0.70, aggressiveness: 0.80 },
      { baseSpeed: 30, speedVariance: 1.5, corneringSkill: 0.90, staminaManagement: 0.80, aggressiveness: 0.60 },
      { baseSpeed: 32, speedVariance: 3.0, corneringSkill: 0.75, staminaManagement: 0.60, aggressiveness: 0.90 },
      { baseSpeed: 27, speedVariance: 1.0, corneringSkill: 0.95, staminaManagement: 0.90, aggressiveness: 0.50 },
      { baseSpeed: 29, speedVariance: 2.5, corneringSkill: 0.80, staminaManagement: 0.75, aggressiveness: 0.70 }
    ];
    this.baseSkills = skills;

    for (let i = 0; i < 5; i++) {
      const palette = Horse.PALETTES.ai[i];
      const horse = new Horse(palette.coat, palette);
      horse.name = names[i];
      horse.isAI = true;

      this.horses.push(horse);
      this.aiData.push({
        ...skills[i],
        horse,
        name: names[i],
        trackT: 0,
        targetSpeed: skills[i].baseSpeed,
        lateralOffset: randomRange(-2.5, 2.5),
        targetLateralOffset: randomRange(-2.5, 2.5),
        nextOffsetChange: randomRange(2.0, 5.0),
        offsetTimer: 0,
        speedVarianceTimer: randomRange(1.0, 3.0),
        currentSpeedVariance: 0,
        targetSpeedVariance: 0,
        steerInput: 0,
        isSprinting: false,
        stuckTimer: 0,
        rubberBandFactor: 1.0
      });
    }

    this.setDifficulty('easy');
    this.reset();
  }

  setDifficulty(level = 'easy') {
    const key = DIFFICULTY_PROFILES[level] ? level : 'easy';
    const profile = DIFFICULTY_PROFILES[key];
    this.difficulty = key;

    this.aiData.forEach((ai, index) => {
      const base = this.baseSkills[index];
      ai.baseSpeed = Array.isArray(profile.speed)
        ? profile.speed[index]
        : profile.speed ?? base.baseSpeed;
      ai.speedVariance = base.speedVariance * profile.variance;
      ai.corneringSkill = clamp(base.corneringSkill + profile.cornering, 0, 1);
      ai.staminaManagement = clamp(base.staminaManagement + profile.stamina, 0, 1);
      ai.aggressiveness = clamp(base.aggressiveness * profile.aggression, 0, 1);
      ai.rubberBandMin = profile.rubberBandMin;
      ai.rubberBandMax = profile.rubberBandMax;
      ai.targetSpeed = ai.baseSpeed;
      ai.horse.baseMaxSpeed = profile.baseMaxSpeed;
      ai.horse.sprintMaxSpeed = profile.sprintMaxSpeed;
      ai.horse.maxSpeed = ai.horse.baseMaxSpeed;
    });
  }

  /**
   * Resets all AI horses onto the starting grid (slot 0 belongs to the player).
   */
  reset() {
    for (let i = 0; i < this.horses.length; i++) {
      const horse = this.horses[i];
      const data = this.aiData[i];
      const lane = (i + 1) % 2 === 0 ? 3.4 : -3.4;

      data.trackT = 0;
      data.lateralOffset = lane;
      data.targetLateralOffset = lane;
      data.offsetTimer = 0;
      data.nextOffsetChange = randomRange(2.0, 5.0);
      data.currentSpeedVariance = 0;
      data.targetSpeedVariance = 0;
      data.steerInput = 0;
      data.isSprinting = false;
      data.rubberBandFactor = 1.0;

      const slot = this.track.getStartSlot(i + 1);
      horse.reset(slot.position, slot.direction);
    }
  }

  /**
   * Updates all AI horses each frame.
   * Handles navigation, overtaking, collision avoidance, rubber-banding, and synthetic input generation.
   * @param {number} dt - Delta time in seconds
   * @param {Horse} playerHorse - Reference to player horse for race context
   */
  update(dt, playerHorse) {
    if (!this.track || typeof this.track.getPointAt !== 'function') {
      // Fallback update if track not ready
      for (let i = 0; i < this.horses.length; i++) {
        this.horses[i].update(dt, { forward: true, backward: false, left: false, right: false, sprint: false, jump: false }, this.terrain, this.track);
      }
      return;
    }

    const playerProgress = playerHorse ? (playerHorse.lap || 0) + (playerHorse.trackProgress || 0) : 0;

    for (let i = 0; i < this.horses.length; i++) {
      const horse = this.horses[i];
      const ai = this.aiData[i];

      if (horse.finished) {
        horse.update(dt, { forward: false, backward: false, left: false, right: false, sprint: false, jump: false }, this.terrain, this.track);
        continue;
      }

      // --- 1. RUBBER-BANDING ---
      if (playerHorse) {
        const aiProgress = (horse.lap || 0) + (horse.trackProgress || 0);
        const progressDiff = aiProgress - playerProgress;

        if (progressDiff > 0.05) {
          // AI is significantly ahead of player: slow down slightly
          const excess = progressDiff - 0.05;
          ai.rubberBandFactor = lerp(ai.rubberBandFactor, clamp(1.0 - excess * 1.8, ai.rubberBandMin, 1.0), 3.0 * dt);
        } else if (progressDiff < -0.05) {
          // AI is significantly behind player: speed up slightly
          const deficit = -progressDiff - 0.05;
          ai.rubberBandFactor = lerp(ai.rubberBandFactor, clamp(1.0 + deficit * 1.5, 1.0, ai.rubberBandMax), 3.0 * dt);
        } else {
          ai.rubberBandFactor = lerp(ai.rubberBandFactor, 1.0, 2.0 * dt);
        }
      }

      // --- 2. NATURAL SPEED FLUCTUATION ---
      ai.speedVarianceTimer -= dt;
      if (ai.speedVarianceTimer <= 0) {
        ai.speedVarianceTimer = randomRange(2.0, 4.5);
        ai.targetSpeedVariance = randomRange(-ai.speedVariance, ai.speedVariance);
      }
      ai.currentSpeedVariance = lerp(ai.currentSpeedVariance, ai.targetSpeedVariance, 1 - Math.exp(-1.2 * dt));

      // Compute target speed
      let baseTarget = (ai.baseSpeed + ai.currentSpeedVariance) * ai.rubberBandFactor;

      // --- 3. RACING LINE & LATERAL OFFSET CHANGES ---
      ai.offsetTimer += dt;
      if (ai.offsetTimer >= ai.nextOffsetChange) {
        ai.offsetTimer = 0;
        ai.nextOffsetChange = randomRange(2.5, 6.0);
        // Vary lateral position across track width (-3.0 to +3.0)
        ai.targetLateralOffset = randomRange(-2.8, 2.8);
      }

      // Smoothly drift lateral offset toward target
      ai.lateralOffset = lerp(ai.lateralOffset, ai.targetLateralOffset, clamp(1.8 * dt, 0, 1));

      // --- 4. COLLISION AVOIDANCE & OVERTAKING ---
      const allRacers = [...this.horses.filter((_, idx) => idx !== i)];
      if (playerHorse) allRacers.push(playerHorse);

      let wantsOvertakeSprint = false;

      for (let r = 0; r < allRacers.length; r++) {
        const other = allRacers[r];
        const distSq = horse.mesh.position.distanceToSquared(other.mesh.position);

        if (distSq < 25.0) { // Within 5 meters
          const dist = Math.sqrt(distSq);
          const toOther = other.mesh.position.clone().sub(horse.mesh.position);
          const forwardDot = toOther.dot(horse.direction);

          // Other horse is directly in front
          if (forwardDot > 0.8 && dist < 4.2) {
            // Cut to whichever side has more room
            if (ai.lateralOffset > other.mesh.position.x) {
              ai.targetLateralOffset = clamp(ai.targetLateralOffset + 1.8 * dt * ai.aggressiveness, -3.2, 3.2);
            } else {
              ai.targetLateralOffset = clamp(ai.targetLateralOffset - 1.8 * dt * ai.aggressiveness, -3.2, 3.2);
            }

            // Aggressive horses try to sprint past
            if (ai.aggressiveness > 0.65 && horse.stamina > 35) {
              wantsOvertakeSprint = true;
            }
          }

          // Side-by-side lateral separation
          if (dist < 2.0) {
            const sideNormal = new THREE.Vector3(-horse.direction.z, 0, horse.direction.x);
            const sideDot = toOther.dot(sideNormal);
            if (sideDot > 0) {
              ai.targetLateralOffset = clamp(ai.targetLateralOffset - 2.5 * dt, -3.5, 3.5);
            } else {
              ai.targetLateralOffset = clamp(ai.targetLateralOffset + 2.5 * dt, -3.5, 3.5);
            }
          }
        }
      }

      // --- 5. STAMINA & SPRINT DECISION ---
      const isFinalStretch = (horse.lap >= 2 && horse.trackProgress > 0.72);
      const staminaThreshold = (1.0 - ai.staminaManagement) * 45;

      if (isFinalStretch && horse.stamina > 5) {
        ai.isSprinting = true;
      } else if (wantsOvertakeSprint) {
        ai.isSprinting = true;
      } else if (horse.stamina > 80 && ai.rubberBandFactor > 1.05) {
        ai.isSprinting = true;
      } else if (horse.stamina < staminaThreshold) {
        ai.isSprinting = false;
      }

      // --- 6. TRACK NAVIGATION & STEERING ---
      const speedNorm = clamp(horse.speed / 35, 0.2, 1.2);
      const lookaheadDistance = lerp(7, 15, clamp(speedNorm, 0, 1));
      const progressStep = lookaheadDistance / this.track.totalLength;
      const aheadProgress = (progress) => this.track.isClosed
        ? ((progress % 1) + 1) % 1
        : clamp(progress, 0, 1);
      const lookaheadT = aheadProgress(horse.trackProgress + progressStep);

      const trackPoint = this.track.getPointAt(lookaheadT);
      let tangent = new THREE.Vector3(0, 0, -1);

      if (typeof this.track.getTangentAt === 'function') {
        tangent = this.track.getTangentAt(lookaheadT).clone();
      } else {
        const nextLookahead = aheadProgress(lookaheadT + 0.005);
        tangent = this.track.getPointAt(nextLookahead).clone().sub(trackPoint).normalize();
      }

      tangent.y = 0;
      tangent.normalize();

      const cornerPreviewDistance = 20;
      const previewT = aheadProgress(lookaheadT + cornerPreviewDistance / this.track.totalLength);
      const previewTangent = this.track.getTangentAt(previewT).clone().setY(0).normalize();
      const turnAngle = Math.acos(clamp(tangent.dot(previewTangent), -1, 1));
      if (turnAngle > 0.01) {
        const curveRadius = cornerPreviewDistance / turnAngle;
        const safeCornerSpeed = Math.sqrt(18 * curveRadius);
        baseTarget = Math.min(baseTarget, safeCornerSpeed);
      }

      // Normal perpendicular to tangent in horizontal plane
      const trackNormal = new THREE.Vector3(-tangent.z, 0, tangent.x);

      // Target world position including lateral offset
      const targetPos = trackPoint.clone().add(trackNormal.multiplyScalar(ai.lateralOffset));

      // Calculate steer angle to target point
      const toTarget = targetPos.clone().sub(horse.mesh.position);
      toTarget.y = 0;
      const targetDist = toTarget.length();

      let targetSteer = 0;

      if (targetDist > 0.2) {
        toTarget.normalize();
        // 2D cross product in horizontal plane determines turn direction
        const cross = horse.direction.x * toTarget.z - horse.direction.z * toTarget.x;
        const dot = horse.direction.x * toTarget.x + horse.direction.z * toTarget.z;

        // Angle between current heading and target direction
        const angleDiff = Math.atan2(cross, dot);
        targetSteer = clamp(-angleDiff / 0.34, -1, 1);

        // Failsafe recovery if horse is pushed far off the racing line
        if (targetDist > 7.0) {
          horse.direction.lerp(toTarget, 1 - Math.exp(-3.5 * dt)).normalize();
        }
      }
      ai.steerInput = lerp(ai.steerInput, targetSteer, 1 - Math.exp(-8 * dt));

      // --- 7. SYNTHETIC INPUT & HORSE UPDATE ---
      // Forward throttle control
      let forwardInput = true;
      let backwardInput = false;

      // Tap brakes if approaching sharp corner too fast
      if (horse.speed > baseTarget * 1.1) {
        forwardInput = false;
        if (horse.speed > baseTarget * 1.25) {
          backwardInput = true;
        }
      }

      const syntheticInput = {
        forward: forwardInput,
        backward: backwardInput,
        left: false,
        right: false,
        steer: ai.steerInput,
        sprint: ai.isSprinting,
        jump: false
      };

      horse.update(dt, syntheticInput, this.terrain, this.track);
      ai.trackT = horse.trackProgress;
    }
  }

  /**
   * Returns current race rankings for all competitors.
   * @param {Horse} [playerHorse]
   * @returns {Array<{ name: string, horse: Horse, lap: number, progress: number, score: number, isPlayer: boolean }>}
   */
  getLeaderboard(playerHorse = null) {
    const list = this.horses.map((h, i) => ({
      name: this.aiData[i].name,
      horse: h,
      lap: h.lap,
      progress: h.trackProgress,
      score: h.lap * 1000 + h.trackProgress,
      isPlayer: false
    }));

    if (playerHorse) {
      list.push({
        name: 'Player',
        horse: playerHorse,
        lap: playerHorse.lap,
        progress: playerHorse.trackProgress,
        score: playerHorse.lap * 1000 + playerHorse.trackProgress,
        isPlayer: true
      });
    }

    list.sort((a, b) => b.score - a.score);
    return list;
  }

  /**
   * Returns array of AI horses.
   * @returns {Horse[]}
   */
  getHorses() {
    return this.horses;
  }
}
