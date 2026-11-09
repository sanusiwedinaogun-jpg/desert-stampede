/**
 * Race HUD Overlay
 * Displays speed, gait, race position, lap progress, race timer, stamina bar, and track minimap.
 * Built with HTML/CSS overlay elements over the 3D canvas.
 */

export class HUD {
  constructor(container) {
    this.container = container;
    this.elements = {};
    this.track = null;
    this.raceMode = 'circuit';
    this.cachedScreenTrack = null;
    this.worldToMinimap = null;

    this.ensureStyles();
    this.init();
  }

  ensureStyles() {
    if (document.getElementById('desert-hud-styles')) return;

    const style = document.createElement('style');
    style.id = 'desert-hud-styles';
    style.textContent = `
      #hud-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: hidden;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        user-select: none;
        z-index: 10;
      }

      .hud-speed {
        position: absolute;
        bottom: 24px;
        left: 24px;
        background: rgba(18, 12, 8, 0.82);
        border: 2px solid rgba(232, 167, 53, 0.6);
        border-radius: 8px;
        padding: 10px 18px;
        color: #fff;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        min-width: 90px;
      }

      .speed-num-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }

      .speed-value {
        font-size: 38px;
        font-weight: 900;
        color: #E8A735;
        line-height: 1;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
      }

      .speed-unit {
        font-size: 14px;
        font-weight: 700;
        color: #bbb;
        letter-spacing: 1px;
      }

      .speed-gait {
        font-size: 13px;
        font-weight: 800;
        color: #66BB6A;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        margin-top: 4px;
      }

      .hud-position {
        position: absolute;
        top: 24px;
        right: 24px;
        background: rgba(18, 12, 8, 0.82);
        border: 2px solid rgba(232, 167, 53, 0.6);
        border-radius: 8px;
        padding: 8px 18px;
        color: #fff;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: baseline;
      }

      .position-value {
        font-size: 42px;
        font-weight: 900;
        color: #E8A735;
        line-height: 1;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
      }

      .position-suffix {
        font-size: 20px;
        font-weight: 800;
        color: #E8A735;
        margin-right: 4px;
      }

      .position-total {
        font-size: 18px;
        font-weight: 600;
        color: #aaa;
      }

      .hud-lap {
        position: absolute;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(18, 12, 8, 0.82);
        border: 2px solid rgba(232, 167, 53, 0.6);
        border-radius: 8px;
        padding: 10px 24px;
        color: #fff;
        font-size: 20px;
        font-weight: 800;
        letter-spacing: 2px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
      }

      .hud-lap span {
        color: #E8A735;
        font-size: 24px;
      }

      .hud-timer {
        position: absolute;
        top: 24px;
        left: 24px;
        background: rgba(18, 12, 8, 0.82);
        border: 2px solid rgba(232, 167, 53, 0.6);
        border-radius: 8px;
        padding: 12px 20px;
        color: #fff;
        font-size: 26px;
        font-weight: 800;
        font-family: 'Courier New', Courier, monospace;
        letter-spacing: 2px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
      }

      .hud-stamina {
        position: absolute;
        bottom: 24px;
        right: 24px;
        background: rgba(18, 12, 8, 0.82);
        border: 2px solid rgba(232, 167, 53, 0.6);
        border-radius: 8px;
        padding: 12px 18px;
        width: 190px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .stamina-bar-container {
        width: 100%;
        height: 14px;
        background: rgba(0, 0, 0, 0.6);
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .stamina-fill {
        height: 100%;
        width: 100%;
        background-color: #4CAF50;
        border-radius: 3px;
        transition: width 0.1s linear, background-color 0.25s ease;
      }

      .stamina-label {
        font-size: 12px;
        font-weight: 800;
        color: #E8A735;
        letter-spacing: 2px;
        text-align: right;
      }

      .hud-minimap {
        position: absolute;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        width: 160px;
        height: 160px;
        background: rgba(18, 12, 8, 0.85);
        border: 2px solid rgba(232, 167, 53, 0.6);
        border-radius: 50%;
        overflow: hidden;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .minimap-canvas {
        width: 160px;
        height: 160px;
        display: block;
      }

      @media (max-width: 700px) {
        .hud-lap {
          top: 84px;
          max-width: calc(100vw - 32px);
          padding: 7px 10px;
          font-size: 13px;
          letter-spacing: 1px;
          text-align: center;
        }
      }
    `;
    document.head.appendChild(style);
  }

  init() {
    this.container.innerHTML = '';

    // Speed display (bottom-left)
    const speedContainer = document.createElement('div');
    speedContainer.className = 'hud-speed';

    const speedRow = document.createElement('div');
    speedRow.className = 'speed-num-row';

    const speedVal = document.createElement('span');
    speedVal.className = 'speed-value';
    speedVal.textContent = '0';

    const speedUnit = document.createElement('span');
    speedUnit.className = 'speed-unit';
    speedUnit.textContent = 'MPH';

    speedRow.appendChild(speedVal);
    speedRow.appendChild(speedUnit);

    const speedGait = document.createElement('span');
    speedGait.className = 'speed-gait';
    speedGait.textContent = 'IDLE';

    speedContainer.appendChild(speedRow);
    speedContainer.appendChild(speedGait);

    // Position display (top-right)
    const posContainer = document.createElement('div');
    posContainer.className = 'hud-position';

    const posVal = document.createElement('span');
    posVal.className = 'position-value';
    posVal.textContent = '1';

    const posSuffix = document.createElement('span');
    posSuffix.className = 'position-suffix';
    posSuffix.textContent = 'st';

    const posTotal = document.createElement('span');
    posTotal.className = 'position-total';
    posTotal.textContent = ' / 6';

    posContainer.appendChild(posVal);
    posContainer.appendChild(posSuffix);
    posContainer.appendChild(posTotal);

    // Lap display (top-center)
    const lapContainer = document.createElement('div');
    lapContainer.className = 'hud-lap';

    const lapTextPre = document.createTextNode('LAP ');
    const lapCurrent = document.createElement('span');
    lapCurrent.textContent = '1';
    const lapTextSlash = document.createTextNode(' / ');
    const lapTotal = document.createElement('span');
    lapTotal.textContent = '3';

    lapContainer.appendChild(lapTextPre);
    lapContainer.appendChild(lapCurrent);
    lapContainer.appendChild(lapTextSlash);
    lapContainer.appendChild(lapTotal);

    // Timer display (top-left)
    const timerEl = document.createElement('div');
    timerEl.className = 'hud-timer';
    timerEl.textContent = '00:00.00';

    // Stamina bar (bottom-right)
    const staminaContainer = document.createElement('div');
    staminaContainer.className = 'hud-stamina';

    const staminaBarBg = document.createElement('div');
    staminaBarBg.className = 'stamina-bar-container';

    const staminaFill = document.createElement('div');
    staminaFill.className = 'stamina-fill';
    staminaBarBg.appendChild(staminaFill);

    const staminaLabel = document.createElement('span');
    staminaLabel.className = 'stamina-label';
    staminaLabel.textContent = 'STAMINA';

    staminaContainer.appendChild(staminaBarBg);
    staminaContainer.appendChild(staminaLabel);

    // Minimap (bottom-center)
    const minimapContainer = document.createElement('div');
    minimapContainer.className = 'hud-minimap';

    const minimapCanvas = document.createElement('canvas');
    minimapCanvas.className = 'minimap-canvas';
    minimapCanvas.width = 160;
    minimapCanvas.height = 160;
    minimapContainer.appendChild(minimapCanvas);

    const touchControls = document.createElement('div');
    touchControls.className = 'touch-controls';
    touchControls.setAttribute('aria-hidden', 'true');

    const joystick = document.createElement('div');
    joystick.className = 'touch-joystick';
    joystick.appendChild(document.createElement('span'));

    const touchActions = document.createElement('div');
    touchActions.className = 'touch-actions';
    touchActions.innerHTML = '<div class="touch-action touch-sprint">SPRINT</div><div class="touch-action touch-jump">JUMP</div>';

    touchControls.appendChild(joystick);
    touchControls.appendChild(touchActions);

    // Append all elements to container
    this.container.appendChild(speedContainer);
    this.container.appendChild(posContainer);
    this.container.appendChild(lapContainer);
    this.container.appendChild(timerEl);
    this.container.appendChild(staminaContainer);
    this.container.appendChild(minimapContainer);
    this.container.appendChild(touchControls);

    // Cache element references
    this.elements = {
      speedValue: speedVal,
      speedGait: speedGait,
      positionValue: posVal,
      positionSuffix: posSuffix,
      positionTotal: posTotal,
      lapContainer: lapContainer,
      lapCurrent: lapCurrent,
      lapTotal: lapTotal,
      lapPrefix: lapTextPre,
      timer: timerEl,
      staminaFill: staminaFill,
      minimapCanvas: minimapCanvas,
      minimapCtx: minimapCanvas.getContext('2d')
    };
  }

  setTrack(track) {
    this.track = track;
    this.cacheTrackPoints();
  }

  setRaceMode(mode) {
    this.raceMode = mode;
  }

  setCourseSection(section) {
    if (!section || !this.elements.lapContainer) return;
    this.elements.lapContainer.textContent = `SECTION ${section.index + 1}/6 - ${section.label.toUpperCase()}`;
  }

  cacheTrackPoints() {
    if (!this.track || typeof this.track.getPointAt !== 'function') return;

    const samples = 120;
    const rawPoints = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i <= samples; i++) {
      const pt = this.track.getPointAt(i / samples);
      if (pt) {
        rawPoints.push(pt);
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
    }

    const spanX = Math.max(maxX - minX, 1);
    const spanZ = Math.max(maxZ - minZ, 1);
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    // Available drawing diameter is roughly 120px to leave padding inside 160x160 circular HUD
    const scale = Math.min(115 / spanX, 115 / spanZ);

    this.worldToMinimap = (x, z) => ({
      x: 80 + (x - centerX) * scale,
      y: 80 + (z - centerZ) * scale
    });

    this.cachedScreenTrack = rawPoints.map(p => this.worldToMinimap(p.x, p.z));
  }

  update(playerHorse, allHorses, raceData) {
    if (!playerHorse || !raceData) return;

    // Check track caching if not done yet
    if (!this.track && playerHorse.track) {
      this.setTrack(playerHorse.track);
    }

    // 1. Update Speed
    const rawSpeed = playerHorse.speed || 0;
    const mph = Math.round(rawSpeed * 1.5);
    this.elements.speedValue.textContent = mph;

    // 2. Update Gait
    let gait = playerHorse.currentGait;
    if (!gait) {
      if (rawSpeed < 0.5) gait = 'IDLE';
      else if (rawSpeed < 8) gait = 'WALK';
      else if (rawSpeed < 18) gait = 'TROT';
      else if (rawSpeed < 28) gait = 'CANTER';
      else gait = 'GALLOP';
    }
    this.elements.speedGait.textContent = String(gait).toUpperCase();

    // 3. Update Position
    const pos = raceData.position || 1;
    this.elements.positionValue.textContent = pos;
    this.elements.positionSuffix.textContent = this.getOrdinal(pos);
    const totalRacers = raceData.totalRacers || (allHorses ? allHorses.length : 1);
    this.elements.positionTotal.textContent = ` / ${totalRacers}`;

    // 4. Update Lap
    if (this.raceMode === 'endless') {
      this.elements.lapPrefix.textContent = 'RUN ';
      this.elements.lapCurrent.textContent = '';
      this.elements.lapTotal.textContent = 'ENDLESS';
    } else {
      const currentLap = Math.min(raceData.lap || 1, raceData.totalLaps || 3);
      this.elements.lapPrefix.textContent = 'LAP ';
      this.elements.lapCurrent.textContent = currentLap;
      this.elements.lapTotal.textContent = raceData.totalLaps || 3;
    }

    // 5. Update Timer
    this.elements.timer.textContent = this.formatTime(raceData.elapsed || 0);

    // 6. Update Stamina Bar
    const stamina = playerHorse.stamina !== undefined ? playerHorse.stamina : 100;
    const maxStamina = playerHorse.maxStamina || 100;
    const staminaPct = Math.max(0, Math.min(100, (stamina / maxStamina) * 100));

    this.elements.staminaFill.style.width = `${staminaPct}%`;
    if (staminaPct > 50) {
      this.elements.staminaFill.style.backgroundColor = '#4CAF50'; // Green
    } else if (staminaPct >= 20) {
      this.elements.staminaFill.style.backgroundColor = '#FFC107'; // Yellow
    } else {
      this.elements.staminaFill.style.backgroundColor = '#F44336'; // Red
    }

    // 7. Update Minimap
    this.updateMinimap(playerHorse, allHorses);
  }

  updateMinimap(playerHorse, allHorses) {
    const ctx = this.elements.minimapCtx;
    if (!ctx) return;

    ctx.clearRect(0, 0, 160, 160);

    // Draw minimap base circle
    ctx.fillStyle = 'rgba(20, 14, 10, 0.75)';
    ctx.beginPath();
    ctx.arc(80, 80, 78, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(232, 167, 53, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw track path
    if (this.cachedScreenTrack && this.cachedScreenTrack.length > 1) {
      // Track road width outline
      ctx.beginPath();
      ctx.moveTo(this.cachedScreenTrack[0].x, this.cachedScreenTrack[0].y);
      for (let i = 1; i < this.cachedScreenTrack.length; i++) {
        ctx.lineTo(this.cachedScreenTrack[i].x, this.cachedScreenTrack[i].y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(168, 114, 60, 0.65)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Centerline
      ctx.strokeStyle = '#D4A373';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Start/finish checkered tick
      const startPt = this.cachedScreenTrack[0];
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(startPt.x, startPt.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!this.worldToMinimap) return;

    // Draw AI horses (smaller colored dots)
    if (allHorses && Array.isArray(allHorses)) {
      for (const horse of allHorses) {
        if (horse === playerHorse) continue;
        const pos = horse.mesh ? horse.mesh.position : horse.position;
        if (pos) {
          const mPos = this.worldToMinimap(pos.x, pos.z);
          ctx.fillStyle = '#FF5252';
          ctx.beginPath();
          ctx.arc(mPos.x, mPos.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Draw Player horse (bright glowing golden dot with direction heading)
    const pPos = playerHorse.mesh ? playerHorse.mesh.position : playerHorse.position;
    if (pPos) {
      const pmPos = this.worldToMinimap(pPos.x, pPos.z);

      // Outer glow
      ctx.fillStyle = 'rgba(255, 215, 0, 0.4)';
      ctx.beginPath();
      ctx.arc(pmPos.x, pmPos.y, 8, 0, Math.PI * 2);
      ctx.fill();

      // Core player dot
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(pmPos.x, pmPos.y, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Heading indicator needle
      if (playerHorse.direction) {
        const headX = pmPos.x + playerHorse.direction.x * 8;
        const headY = pmPos.y + playerHorse.direction.z * 8;
        ctx.beginPath();
        ctx.moveTo(pmPos.x, pmPos.y);
        ctx.lineTo(headX, headY);
        ctx.strokeStyle = '#FFF176';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  show() {
    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
  }

  formatTime(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) {
      return '00:00.00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
  }

  getOrdinal(n) {
    const num = Math.floor(n) || 1;
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  }
}
