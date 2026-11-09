/**
 * UI Manager
 * Handles menu screens, title screen, countdown sequence, pause menu, and race results overlay.
 */

export class UIManager {
  constructor(container) {
    this.container = container; // #ui-container
    this.selectedDifficulty = 'easy';
    this.ensureStyles();
  }

  ensureStyles() {
    if (document.getElementById('desert-ui-styles')) return;

    const style = document.createElement('style');
    style.id = 'desert-ui-styles';
    style.textContent = `
      #ui-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 20;
        pointer-events: auto;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        user-select: none;
      }

      .fadeIn {
        animation: uiFadeIn 0.4s ease-out forwards;
      }

      @keyframes uiFadeIn {
        from {
          opacity: 0;
          transform: translateY(16px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes scaleIn {
        0% {
          transform: scale(0.3);
          opacity: 0;
        }
        60% {
          transform: scale(1.15);
          opacity: 1;
        }
        100% {
          transform: scale(1.0);
          opacity: 1;
        }
      }

      /* Title Screen */
      .title-screen {
        background: radial-gradient(circle at center, rgba(32, 22, 16, 0.96), rgba(16, 10, 8, 0.98));
        border: 3px solid #E8A735;
        border-radius: 16px;
        padding: 40px 60px;
        text-align: center;
        color: #F5E6D3;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8), 0 0 35px rgba(232, 167, 53, 0.25);
        max-width: 520px;
        width: 90%;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-sizing: border-box;
      }

      .title-screen h1 {
        font-size: 46px;
        margin: 0 0 8px 0;
        letter-spacing: 4px;
        color: #E8A735;
        text-shadow: 0 4px 12px rgba(0, 0, 0, 0.9), 0 0 20px rgba(232, 167, 53, 0.5);
      }

      .title-subtitle {
        font-size: 18px;
        color: #D4A373;
        letter-spacing: 3px;
        margin: 0 0 28px 0;
        text-transform: uppercase;
        font-weight: 600;
      }

      .title-controls {
        background: rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(232, 167, 53, 0.35);
        border-radius: 10px;
        padding: 16px 24px;
        margin-bottom: 30px;
        width: 100%;
        box-sizing: border-box;
      }

      .title-controls p {
        margin: 8px 0;
        font-size: 14px;
        color: #ECECEC;
        letter-spacing: 1px;
      }

      .mode-picker {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        width: 100%;
        margin: 0 0 24px;
      }

      .mode-btn {
        min-height: 54px;
        border: 1px solid rgba(232, 167, 53, 0.4);
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.35);
        color: #F5E6D3;
        font: inherit;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1px;
        cursor: pointer;
      }

      .mode-btn.selected {
        background: #E8A735;
        border-color: #FFD27A;
        color: #1A0F07;
        box-shadow: 0 0 16px rgba(232, 167, 53, 0.35);
      }

      .difficulty-label {
        align-self: flex-start;
        margin: 0 0 8px;
        color: #D4A373;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1.5px;
      }

      .difficulty-picker {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        width: 100%;
        margin: 0 0 20px;
      }

      .difficulty-btn {
        min-width: 0;
        min-height: 38px;
        padding: 6px 4px;
        border: 1px solid rgba(232, 167, 53, 0.4);
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.35);
        color: #F5E6D3;
        font: inherit;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.5px;
        cursor: pointer;
      }

      .difficulty-btn.selected {
        background: #E8A735;
        border-color: #FFD27A;
        color: #1A0F07;
      }

      @media (max-height: 480px) {
        .title-screen {
          max-height: calc(100vh - 24px);
          padding: 18px 24px;
          overflow-y: auto;
        }

        .title-screen h1 {
          font-size: 30px;
        }

        .title-subtitle {
          margin-bottom: 12px;
          font-size: 14px;
        }

        .title-controls {
          margin-bottom: 12px;
          padding: 10px 12px;
        }

        .title-controls p {
          margin: 4px 0;
          font-size: 12px;
        }

        .mode-picker,
        .difficulty-picker {
          margin-bottom: 12px;
        }

        .start-btn {
          padding: 10px 28px;
          font-size: 16px;
        }
      }

      /* Buttons */
      .start-btn, .resume-btn, .restart-btn, .race-again-btn {
        background: linear-gradient(135deg, #E8A735, #C27D18);
        border: none;
        border-radius: 8px;
        color: #1A0F07;
        font-size: 20px;
        font-weight: 800;
        letter-spacing: 2px;
        padding: 14px 44px;
        cursor: pointer;
        transition: transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease;
        box-shadow: 0 4px 16px rgba(232, 167, 53, 0.45);
      }

      .start-btn:hover, .resume-btn:hover, .restart-btn:hover, .race-again-btn:hover {
        background: linear-gradient(135deg, #FFB944, #D98C1E);
        transform: translateY(-2px);
        box-shadow: 0 6px 22px rgba(232, 167, 53, 0.65);
      }

      .start-btn:active, .resume-btn:active, .restart-btn:active, .race-again-btn:active {
        transform: translateY(1px);
      }

      /* Countdown */
      .countdown {
        font-size: 130px;
        font-weight: 900;
        color: #FFFFFF;
        text-shadow: 0 6px 24px rgba(0, 0, 0, 0.9), 0 0 35px rgba(232, 167, 53, 0.8);
        letter-spacing: 3px;
        user-select: none;
      }

      /* Pause Screen */
      .pause-screen {
        background: radial-gradient(circle at center, rgba(32, 22, 16, 0.96), rgba(16, 10, 8, 0.98));
        border: 3px solid #E8A735;
        border-radius: 16px;
        padding: 40px 60px;
        text-align: center;
        color: #F5E6D3;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.85);
        max-width: 400px;
        width: 85%;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-sizing: border-box;
      }

      .pause-screen h2 {
        font-size: 40px;
        margin: 0 0 28px 0;
        color: #E8A735;
        letter-spacing: 4px;
        text-shadow: 0 3px 8px rgba(0, 0, 0, 0.8);
      }

      .pause-buttons {
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 100%;
      }

      /* Results Screen */
      .results-screen {
        background: radial-gradient(circle at center, rgba(32, 22, 16, 0.97), rgba(16, 10, 8, 0.99));
        border: 3px solid #E8A735;
        border-radius: 16px;
        padding: 35px 48px;
        text-align: center;
        color: #F5E6D3;
        box-shadow: 0 12px 45px rgba(0, 0, 0, 0.9), 0 0 35px rgba(232, 167, 53, 0.3);
        max-width: 580px;
        width: 90%;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-sizing: border-box;
      }

      .results-screen h2 {
        font-size: 36px;
        margin: 0 0 6px 0;
        letter-spacing: 3px;
        color: #FFFFFF;
        text-shadow: 0 3px 8px rgba(0, 0, 0, 0.8);
      }

      .winner-banner {
        font-size: 32px;
        font-weight: 900;
        color: #FFD700;
        margin: 8px 0 18px 0;
        letter-spacing: 2px;
        text-shadow: 0 0 16px rgba(255, 215, 0, 0.8);
      }

      .results-table {
        width: 100%;
        border-collapse: collapse;
        margin: 12px 0 28px 0;
        background: rgba(0, 0, 0, 0.45);
        border-radius: 8px;
        overflow: hidden;
      }

      .results-table th, .results-table td {
        padding: 10px 14px;
        text-align: left;
        font-size: 15px;
      }

      .results-table th {
        background: rgba(232, 167, 53, 0.25);
        color: #E8A735;
        font-weight: 700;
        letter-spacing: 1px;
      }

      .results-table tr {
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      .results-table tr.player-row {
        background: rgba(232, 167, 53, 0.3);
        font-weight: 800;
        color: #FFD700;
      }

      .color-swatch {
        display: inline-block;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 1px solid #FFF;
        vertical-align: middle;
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
      }
    `;
    document.head.appendChild(style);
  }

  showTitle(onStart) {
    this.container.innerHTML = '';
    this.container.style.display = 'flex';

    const titleScreen = document.createElement('div');
    titleScreen.className = 'title-screen fadeIn';

    const h1 = document.createElement('h1');
    h1.textContent = 'DESERT STAMPEDE';

    const subtitle = document.createElement('p');
    subtitle.className = 'title-subtitle';
    subtitle.textContent = 'Arizona Horse Racing';

    const controlsBox = document.createElement('div');
    controlsBox.className = 'title-controls';

    const p1 = document.createElement('p');
    p1.textContent = 'W / ↑ : Accelerate  |  S / ↓ : Brake';

    const p2 = document.createElement('p');
    p2.textContent = 'A / ← : Steer Left  |  D / → : Steer Right';

    const p3 = document.createElement('p');
    p3.textContent = 'SHIFT : Sprint  |  ESC : Pause';

    controlsBox.appendChild(p1);
    controlsBox.appendChild(p2);
    controlsBox.appendChild(p3);

    const modePicker = document.createElement('div');
    modePicker.className = 'mode-picker';
    const modes = [
      { id: 'circuit', label: 'CIRCUIT' },
      { id: 'linear', label: 'DESERT DASH' },
      { id: 'endless', label: 'ENDLESS RUN' }
    ];
    let selectedMode = 'circuit';
    const modeButtons = [];

    modes.forEach(mode => {
      const button = document.createElement('button');
      button.className = `mode-btn${mode.id === selectedMode ? ' selected' : ''}`;
      button.textContent = mode.label;
      button.addEventListener('click', () => {
        selectedMode = mode.id;
        modeButtons.forEach(item => item.classList.toggle('selected', item === button));
      });
      modeButtons.push(button);
      modePicker.appendChild(button);
    });

    const difficultyLabel = document.createElement('p');
    difficultyLabel.className = 'difficulty-label';
    difficultyLabel.textContent = 'DIFFICULTY';

    const difficultyPicker = document.createElement('div');
    difficultyPicker.className = 'difficulty-picker';
    const difficulties = [
      { id: 'easy', label: 'EASY' },
      { id: 'medium', label: 'MEDIUM' },
      { id: 'hard', label: 'HARD' },
      { id: 'expert', label: 'EXPERT' }
    ];
    let selectedDifficulty = this.selectedDifficulty;
    const difficultyButtons = [];

    difficulties.forEach(difficulty => {
      const button = document.createElement('button');
      button.className = `difficulty-btn${difficulty.id === selectedDifficulty ? ' selected' : ''}`;
      button.textContent = difficulty.label;
      button.addEventListener('click', () => {
        selectedDifficulty = difficulty.id;
        this.selectedDifficulty = difficulty.id;
        difficultyButtons.forEach(item => item.classList.toggle('selected', item === button));
      });
      difficultyButtons.push(button);
      difficultyPicker.appendChild(button);
    });

    const startBtn = document.createElement('button');
    startBtn.className = 'start-btn';
    startBtn.textContent = 'START RACE';

    startBtn.addEventListener('click', () => {
      this.hideAll();
      if (typeof onStart === 'function') onStart(selectedMode, selectedDifficulty);
    });

    titleScreen.appendChild(h1);
    titleScreen.appendChild(subtitle);
    titleScreen.appendChild(controlsBox);
    titleScreen.appendChild(modePicker);
    titleScreen.appendChild(difficultyLabel);
    titleScreen.appendChild(difficultyPicker);
    titleScreen.appendChild(startBtn);

    this.container.appendChild(titleScreen);
  }

  showCountdown(onComplete) {
    this.container.innerHTML = '';
    this.container.style.display = 'flex';

    const countEl = document.createElement('div');
    countEl.className = 'countdown';
    this.container.appendChild(countEl);

    let count = 3;
    const tick = () => {
      if (count > 0) {
        countEl.textContent = count;
        countEl.style.color = '#FFFFFF';
        countEl.style.animation = 'none';
        countEl.offsetHeight; // trigger reflow
        countEl.style.animation = 'scaleIn 0.5s ease-out';
        count--;
        setTimeout(tick, 1000);
      } else {
        countEl.textContent = 'GO!';
        countEl.style.color = '#E8A735';
        countEl.style.animation = 'scaleIn 0.3s ease-out';
        setTimeout(() => {
          this.hideAll();
          if (typeof onComplete === 'function') onComplete();
        }, 500);
      }
    };

    tick();
  }

  showPause(onResume, onRestart, onMainMenu) {
    this.container.innerHTML = '';
    this.container.style.display = 'flex';

    const pauseScreen = document.createElement('div');
    pauseScreen.className = 'pause-screen fadeIn';

    const h2 = document.createElement('h2');
    h2.textContent = 'PAUSED';

    const btnContainer = document.createElement('div');
    btnContainer.className = 'pause-buttons';

    const resumeBtn = document.createElement('button');
    resumeBtn.className = 'resume-btn';
    resumeBtn.textContent = 'RESUME';
    resumeBtn.addEventListener('click', () => {
      this.hideAll();
      if (typeof onResume === 'function') onResume();
    });

    const restartBtn = document.createElement('button');
    restartBtn.className = 'restart-btn';
    restartBtn.textContent = 'RESTART';
    restartBtn.addEventListener('click', () => {
      this.hideAll();
      if (typeof onRestart === 'function') onRestart();
    });

    const mainMenuBtn = document.createElement('button');
    mainMenuBtn.className = 'restart-btn';
    mainMenuBtn.textContent = 'MAIN MENU';
    mainMenuBtn.addEventListener('click', () => {
      this.hideAll();
      if (typeof onMainMenu === 'function') onMainMenu();
    });

    btnContainer.appendChild(resumeBtn);
    btnContainer.appendChild(restartBtn);
    btnContainer.appendChild(mainMenuBtn);

    pauseScreen.appendChild(h2);
    pauseScreen.appendChild(btnContainer);

    this.container.appendChild(pauseScreen);
  }

  showGameOver(onRestart, onMainMenu) {
    this.container.innerHTML = '';
    this.container.style.display = 'flex';

    const screen = document.createElement('div');
    screen.className = 'pause-screen fadeIn';

    const title = document.createElement('h2');
    title.textContent = 'GAME OVER';
    screen.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'pause-buttons';

    const restartBtn = document.createElement('button');
    restartBtn.className = 'restart-btn';
    restartBtn.textContent = 'TRY AGAIN';
    restartBtn.addEventListener('click', () => {
      this.hideAll();
      if (typeof onRestart === 'function') onRestart();
    });

    const mainMenuBtn = document.createElement('button');
    mainMenuBtn.className = 'restart-btn';
    mainMenuBtn.textContent = 'MAIN MENU';
    mainMenuBtn.addEventListener('click', () => {
      this.hideAll();
      if (typeof onMainMenu === 'function') onMainMenu();
    });

    actions.appendChild(restartBtn);
    actions.appendChild(mainMenuBtn);
    screen.appendChild(actions);
    this.container.appendChild(screen);
  }

  showResults(results, onRestart, onMainMenu) {
    this.container.innerHTML = '';
    this.container.style.display = 'flex';

    const resultsScreen = document.createElement('div');
    resultsScreen.className = 'results-screen fadeIn';

    const h2 = document.createElement('h2');
    h2.textContent = 'RACE COMPLETE';
    resultsScreen.appendChild(h2);

    // If player is 1st: show 'YOU WIN!' banner
    const playerWon = results && results.length > 0 && results[0].isPlayer;
    if (playerWon) {
      const banner = document.createElement('div');
      banner.className = 'winner-banner';
      banner.textContent = '🏆 YOU WIN! 🏆';
      resultsScreen.appendChild(banner);
    }

    // Results table
    const table = document.createElement('table');
    table.className = 'results-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th style="width: 50px;">Pos</th>
        <th style="width: 50px;">Color</th>
        <th>Racer</th>
        <th style="text-align: right;">Time</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    (results || []).forEach((racer, index) => {
      const tr = document.createElement('tr');
      if (racer.isPlayer) {
        tr.className = 'player-row';
      }

      const posTd = document.createElement('td');
      posTd.textContent = this.getOrdinal(index + 1);

      const colorTd = document.createElement('td');
      const swatch = document.createElement('span');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = racer.color || '#888';
      colorTd.appendChild(swatch);

      const nameTd = document.createElement('td');
      nameTd.textContent = racer.name + (racer.isPlayer ? ' (You)' : '');

      const timeTd = document.createElement('td');
      timeTd.style.textAlign = 'right';
      timeTd.style.fontFamily = 'monospace';
      timeTd.textContent = racer.finished ? this.formatTime(racer.time) : 'DNF';

      tr.appendChild(posTd);
      tr.appendChild(colorTd);
      tr.appendChild(nameTd);
      tr.appendChild(timeTd);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    resultsScreen.appendChild(table);

    // Race Again button
    const raceAgainBtn = document.createElement('button');
    raceAgainBtn.className = 'race-again-btn';
    raceAgainBtn.textContent = 'RACE AGAIN';
    raceAgainBtn.addEventListener('click', () => {
      this.hideAll();
      if (typeof onRestart === 'function') onRestart();
    });

    const mainMenuBtn = document.createElement('button');
    mainMenuBtn.className = 'restart-btn';
    mainMenuBtn.textContent = 'MAIN MENU';
    mainMenuBtn.addEventListener('click', () => {
      this.hideAll();
      if (typeof onMainMenu === 'function') onMainMenu();
    });

    resultsScreen.appendChild(raceAgainBtn);
    resultsScreen.appendChild(mainMenuBtn);
    this.container.appendChild(resultsScreen);
  }

  hideAll() {
    this.container.style.display = 'none';
    this.container.innerHTML = '';
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
    if (j === 1 && k !== 11) return `${num}st`;
    if (j === 2 && k !== 12) return `${num}nd`;
    if (j === 3 && k !== 13) return `${num}rd`;
    return `${num}th`;
  }
}
