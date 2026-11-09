/**
 * Arizona Desert Horse Racing - Main Game Orchestrator
 * Integrates 3D scene, terrain, track, environment, horse models,
 * player controls, AI racers, particle effects, HUD, procedural audio, and UI menus.
 */

import * as THREE from 'three';
import {
  scene, camera, clock, initScene, renderFrame, setQuality, getQualityLevel, getShadowResolution, setStormWeather
} from './scene.js';
import { WIND } from './atmosphere.js';
import { Sky } from './sky.js';
import { Terrain } from './terrain.js';
import { Track } from './track.js';
import { Environment } from './environment.js';
import { Horse } from './horse.js';
import { Controls } from './controls.js';
import { ParticleSystem } from './particles.js';
import { AIManager } from './ai.js';
import { HUD } from './hud.js';
import { AudioManager } from './audio.js';
import { UIManager } from './ui.js';

const STATE = {
  TITLE: 'title',
  COUNTDOWN: 'countdown',
  RACING: 'racing',
  PAUSED: 'paused',
  FINISHED: 'finished'
};

const params = new URLSearchParams(window.location.search);

let state = STATE.TITLE;
let sky, terrain, track, tracks, environment, playerHorse, controls, particles, aiManager, hud, audio, ui;
let raceTime = 0;
let totalLaps = 3;
let raceMode = 'circuit';
let pauseKeyHeld = false;
let speedFx = 0;
let countdownBlend = 0;

const cameraLook = new THREE.Vector3();
const chase = { roll: 0, bob: 0 };
const perf = { acc: 0, frames: 0, cooldown: 2 };
const mark = (label) => params.has('debug') && console.log('[init]', label, Math.round(performance.now()));

function init() {
  let canvas = document.getElementById('game-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);
  }

  initScene(canvas);
  mark('scene');
  if (params.has('q')) setQuality(parseInt(params.get('q'), 10));

  sky = new Sky();
  mark('sky');
  sky.setShadowResolution(getShadowResolution());
  terrain = new Terrain();
  mark('terrain');
  tracks = {
    circuit: new Track(terrain, 'circuit'),
    linear: new Track(terrain, 'linear')
  };
  mark('tracks');
  tracks.linear.group.visible = false;
  track = tracks.circuit;
  terrain.setRoadMask(track.roadMask);
  environment = new Environment(terrain, track, [tracks.circuit, tracks.linear]);
  mark('environment');

  playerHorse = new Horse(Horse.PALETTES.player.coat, Horse.PALETTES.player);
  playerHorse.name = 'Player';
  scene.add(playerHorse.mesh);

  controls = new Controls();
  particles = new ParticleSystem();
  aiManager = new AIManager(track, terrain);
  aiManager.horses.forEach(h => scene.add(h.mesh));

  let hudContainer = document.getElementById('hud-container');
  if (!hudContainer) {
    hudContainer = document.createElement('div');
    hudContainer.id = 'hud-container';
    document.body.appendChild(hudContainer);
  }
  let uiContainer = document.getElementById('ui-container');
  if (!uiContainer) {
    uiContainer = document.createElement('div');
    uiContainer.id = 'ui-container';
    document.body.appendChild(uiContainer);
  }

  hud = new HUD(hudContainer);
  hud.setTrack(track);
  audio = new AudioManager();
  ui = new UIManager(uiContainer);

  if (params.has('debug')) {
    window.__desert = {
      THREE, scene, camera,
      get player() { return playerHorse; },
      get track() { return track; },
      get tracks() { return tracks; },
      get ai() { return aiManager; },
      get controls() { return controls; },
      get state() { return state; },
      get particles() { return particles; }
    };
  }

  showTitle();
  document.body.classList.add('ready');
  requestAnimationFrame(gameLoop);
}

function placeRacers() {
  const lead = track.getStartSlot(0);
  playerHorse.reset(lead.position, lead.direction);
  aiManager.reset();
  aiManager.horses.forEach((horse, i) => {
    const slot = track.getStartSlot(i + 1);
    horse.reset(slot.position, slot.direction);
  });
}

function showTitle() {
  state = STATE.TITLE;
  setStormWeather(false);
  hud.hide();
  controls.disable();
  aiManager.horses.forEach(horse => { horse.mesh.visible = true; });
  placeRacers();
  heroCamera(0, true);

  ui.showTitle((selectedMode, selectedDifficulty) => {
    environment.setDifficulty(selectedDifficulty);
    setRaceMode(selectedMode);
    aiManager.setDifficulty(selectedDifficulty);
    audio.init();
    startRace();
  });
}

function setRaceMode(mode) {
  raceMode = mode;
  const trackKey = mode === 'linear' ? 'linear' : mode === 'endless' ? 'endless' : 'circuit';
  if (!tracks[trackKey]) {
    tracks[trackKey] = new Track(terrain, 'endless');
  }
  track = tracks[trackKey];
  totalLaps = mode === 'circuit' ? 3 : mode === 'linear' ? 1 : Infinity;
  track.totalLaps = totalLaps;

  Object.entries(tracks).forEach(([key, candidate]) => {
    candidate.group.visible = key === trackKey;
  });
  terrain.setRoadMask(track.roadMask);

  aiManager.track = track;
  aiManager.horses.forEach(horse => { horse.mesh.visible = mode !== 'endless'; });
  environment.track = track;
  environment.setEndlessMode(mode === 'endless' || mode === 'linear');
  setStormWeather(false);
  hud.setTrack(track);
  hud.setRaceMode(mode);
}

function startRace() {
  raceTime = 0;
  placeRacers();

  state = STATE.COUNTDOWN;
  countdownBlend = 0;
  hud.show();

  ui.showCountdown(() => {
    state = STATE.RACING;
    controls.enable();
    audio.playCountdownBeep(true);
  });

  setTimeout(() => audio.playCountdownBeep(false), 0);
  setTimeout(() => audio.playCountdownBeep(false), 1000);
  setTimeout(() => audio.playCountdownBeep(false), 2000);
}

function gameLoop() {
  requestAnimationFrame(gameLoop);

  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const time = clock.elapsedTime;
  WIND.time.value = time;

  environment.update(dt, camera.position, playerHorse);
  particles.update(dt, camera.position);

  if (state === STATE.RACING) {
    updateRace(dt);
    updateCamera(dt, 4.2);
  } else if (state === STATE.TITLE) {
    playerHorse.update(dt, null, terrain, null);
    aiManager.horses.forEach(h => h.update(dt, null, terrain, null));
    heroCamera(time, false);
    speedFx = 0;
  } else if (state === STATE.COUNTDOWN) {
    playerHorse.update(dt, null, terrain, null);
    if (raceMode !== 'endless') aiManager.horses.forEach(h => h.update(dt, null, terrain, null));
    countdownBlend = Math.min(1, countdownBlend + dt / 3.2);
    updateCamera(dt, 0.9 + countdownBlend * 3.0);
    speedFx = 0;
  } else if (state === STATE.FINISHED) {
    playerHorse.update(dt, null, terrain, track);
    if (raceMode !== 'endless') aiManager.update(dt, playerHorse);
    updateCamera(dt, 3.0);
    speedFx *= 0.95;
  }

  sky.update(time, camera.position, playerHorse.mesh.position);
  renderFrame(time, speedFx);
  adaptQuality(rawDt);
}

function updateRace(dt) {
  raceTime += dt;
  controls.update();

  if (controls.isPausePressed() && !pauseKeyHeld) {
    pauseKeyHeld = true;
    pauseGame();
    return;
  }
  if (!controls.isPausePressed()) pauseKeyHeld = false;

  playerHorse.update(dt, controls.input, terrain, track);
  if (raceMode === 'endless' || raceMode === 'linear') {
    const hitCactus = environment.checkRaceObstacleCollision(playerHorse);
    if (hitCactus && raceMode === 'endless') {
      finishGameOver();
      return;
    }
  }
  const section = track.getSectionAtProgress?.(playerHorse.trackProgress);
  setStormWeather(section?.type === 'storm');

  const allHorses = raceMode === 'endless' ? [playerHorse] : [playerHorse, ...aiManager.horses];
  if (raceMode !== 'endless') aiManager.update(dt, playerHorse);

  emitHorseEffects(playerHorse);
  if (raceMode !== 'endless') aiManager.horses.forEach(emitHorseEffects);

  const positions = calculatePositions(allHorses);
  const playerPosition = positions.indexOf(playerHorse) + 1;

  hud.update(playerHorse, allHorses, {
    position: playerPosition,
    totalRacers: allHorses.length,
    lap: raceMode === 'endless' ? 1 : (playerHorse.lap || 0) + 1,
    totalLaps: raceMode === 'endless' ? 1 : totalLaps,
    elapsed: raceTime,
    bestLap: (playerHorse.lapTimes && playerHorse.lapTimes.length > 0) ? Math.min(...playerHorse.lapTimes) : null
  });
  if (section) hud.setCourseSection(section);

  audio.setHoofSpeed(playerHorse.speed);
  audio.setWindSpeed(playerHorse.speed);
  audio.update(dt);

  if (raceMode !== 'endless' && playerHorse.lap >= totalLaps) {
    finishRace(allHorses, positions);
  }
}

/** Hoof-strike puffs and flung clods, plus a dust plume that grows with speed. */
function emitHorseEffects(horse) {
  const strikes = horse.getRecentHoofStrikes();
  for (let i = 0; i < strikes.length; i++) {
    const p = strikes[i].position;
    p.y = terrain.getHeightAt(p.x, p.z) + 0.05;
    particles.emitHoofDust(p, horse.speed);
    particles.emitClods(p, horse.direction, horse.speed);
  }

  if (horse.speed > 5) {
    const pos = horse.mesh.position;
    const intensity = Math.min(1, horse.speed / 40);
    particles.emitDust(
      new THREE.Vector3(pos.x, terrain.getHeightAt(pos.x, pos.z) + 0.3, pos.z),
      horse.direction,
      intensity
    );
  }
}

/** Slow orbit around the lead horse for the title screen, rim-lit by the low sun. */
function heroCamera(time, snap) {
  const target = playerHorse.mesh.position;
  const dir = playerHorse.direction;
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const phi = -0.75 + Math.sin(time * 0.12) * 0.45;
  const radius = 12.5 + Math.sin(time * 0.17) * 1.2;

  const desired = target.clone()
    .addScaledVector(dir, Math.cos(phi) * radius)
    .addScaledVector(side, Math.sin(phi) * radius);
  desired.y = target.y + 2.3 + Math.sin(time * 0.21) * 0.25;

  const groundY = terrain.getHeightAt(desired.x, desired.z) + 1.4;
  desired.y = Math.max(desired.y, groundY);

  if (snap) camera.position.copy(desired);
  else camera.position.lerp(desired, 0.1);

  cameraLook.copy(target).add(new THREE.Vector3(0, 2.6, 0)).addScaledVector(dir, 0.6);
  camera.lookAt(cameraLook);
  camera.fov = 40;
  camera.updateProjectionMatrix();
}

function updateCamera(dt, follow) {
  const horse = playerHorse;
  const speedRatio = THREE.MathUtils.clamp(horse.speed / horse.sprintMaxSpeed, 0, 1);
  const dir = horse.direction.clone().setY(0).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);

  const distance = THREE.MathUtils.lerp(9.6, 13.4, speedRatio);
  const height = THREE.MathUtils.lerp(4.3, 5.7, speedRatio);
  const shoulder = -horse.currentRoll * 6.0;

  const base = horse.mesh.position;
  const desired = base.clone()
    .addScaledVector(dir, -distance)
    .addScaledVector(side, shoulder);
  desired.y = base.y + height;

  const k = 1 - Math.exp(-follow * dt);
  camera.position.lerp(desired, k);

  const groundY = terrain.getHeightAt(camera.position.x, camera.position.z);
  if (camera.position.y < groundY + 2.4) camera.position.y = groundY + 2.4;

  const lookAhead = THREE.MathUtils.lerp(7.5, 17, speedRatio);
  const lookTarget = base.clone().addScaledVector(dir, lookAhead);
  lookTarget.y = base.y + 2.2;
  cameraLook.lerp(lookTarget, 1 - Math.exp(-(follow + 2.0) * dt));
  camera.lookAt(cameraLook);

  // Lean the camera into turns and add a faint gallop bob at speed.
  chase.roll = THREE.MathUtils.lerp(chase.roll, horse.currentRoll, 1 - Math.exp(-4 * dt));
  chase.bob += dt * (6 + speedRatio * 10);
  camera.rotateZ(-chase.roll * 0.32);
  camera.position.y += Math.sin(chase.bob) * 0.025 * speedRatio;

  const desiredFov = THREE.MathUtils.lerp(52, 68, speedRatio);
  camera.fov = THREE.MathUtils.lerp(camera.fov, desiredFov, 1 - Math.exp(-3 * dt));
  camera.updateProjectionMatrix();

  speedFx = THREE.MathUtils.lerp(
    speedFx,
    THREE.MathUtils.clamp((horse.speed - 28) / 17, 0, 1),
    1 - Math.exp(-3 * dt)
  );
}

/** One-way quality ratchet: drops a tier when frames stay slow. */
function adaptQuality(rawDt) {
  if (params.has('q') || rawDt > 0.25) return;
  perf.acc += rawDt;
  perf.frames++;
  if (perf.frames < 90) return;

  const average = perf.acc / perf.frames;
  perf.acc = 0;
  perf.frames = 0;
  if (perf.cooldown > 0) {
    perf.cooldown--;
    return;
  }
  const level = getQualityLevel();
  if (average > 1 / 40 && level > 0) {
    setQuality(level - 1);
    sky.setShadowResolution(getShadowResolution());
    perf.cooldown = 2;
  }
}

function calculatePositions(allHorses) {
  return [...allHorses].sort((a, b) => {
    const lapA = a.lap || 0;
    const lapB = b.lap || 0;
    if (lapB !== lapA) return lapB - lapA;

    const progA = a.trackProgress !== undefined ? a.trackProgress : (a.progress || 0);
    const progB = b.trackProgress !== undefined ? b.trackProgress : (b.progress || 0);
    return progB - progA;
  });
}

function pauseGame() {
  state = STATE.PAUSED;
  controls.disable();

  ui.showPause(
    () => {
      ui.hideAll();
      state = STATE.RACING;
      controls.enable();
    },
    () => {
      ui.hideAll();
      startRace();
    },
    () => {
      returnToMainMenu();
    }
  );
}

function finishGameOver() {
  state = STATE.FINISHED;
  controls.disable();
  hud.hide();
  ui.showGameOver(
    () => startRace(),
    () => returnToMainMenu()
  );
}

function returnToMainMenu() {
  setRaceMode('circuit');
  showTitle();
}

function finishRace(allHorses, positions) {
  state = STATE.FINISHED;
  controls.disable();
  hud.hide();
  audio.playFinish();

  const resultsDeadline = performance.now() + 20000;
  const showResults = () => {
    if (allHorses.some(horse => !horse.finished) && performance.now() < resultsDeadline) {
      setTimeout(showResults, 250);
      return;
    }

    const results = calculatePositions(allHorses).map(horse => {
      let hexColor = horse.coatColor !== undefined
        ? new THREE.Color(horse.coatColor).getHexString()
        : '888888';

      return {
        name: horse.name || 'Competitor',
        color: '#' + hexColor,
        accent: horse.accentColor !== undefined ? '#' + new THREE.Color(horse.accentColor).getHexString() : null,
        time: horse.totalRaceTime,
        finished: horse.finished,
        isPlayer: horse === playerHorse
      };
    });

    ui.showResults(results, () => {
      ui.hideAll();
      startRace();
    }, () => {
      ui.hideAll();
      showTitle();
    });
  };

  showResults();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
