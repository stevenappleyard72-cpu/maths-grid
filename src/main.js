import './style.css';
import {
  GRID_SIZE,
  ROUND_TIME,
  MODES,
  getDailyKey,
  getModeLabel,
  getUnaryLabel,
  getUnaryOptions,
  applyUnaryBonus,
  isNumberToken,
  safeEvaluate,
  isAlternatingExpressionTokens,
  createBoardState,
} from './gameEngine.js';

const state = {
  board: [],
  target: 0,
  score: 0,
  bestScore: 0,
  round: 1,
  timeLeft: ROUND_TIME,
  dragging: false,
  path: [],
  set: new Set(),
  timerId: null,
  unaryTimerId: null,
  statusMessage: 'Select a valid route',
  lastExpression: '-',
  lastValue: null,
  hasStarted: false,
  streak: 0,
  multiplier: 1,
  playerName: 'Player',
  leaderboard: [],
  mode: MODES.normal,
  gameEnded: false,
  dailyKey: getDailyKey(),
  unaryBonus: null,
  screen: 'home',
  difficulty: 'Easy',
  audioContext: null,
  soundEnabled: true,
};

const app = document.querySelector('#app');
const BEST_SCORE_KEY = 'mathsgrid-best-score';
const PLAYER_NAME_KEY = 'mathsgrid-player-name';
const MODE_KEY = 'mathsgrid-mode';
const SOUND_KEY = 'mathsgrid-sound-enabled';
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
let deferredPrompt = null;

function getDifficultyLabel() {
  if (state.round <= 2) return 'Easy';
  if (state.round <= 5) return 'Medium';
  if (state.round <= 8) return 'Hard';
  return 'Chaos';
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem(MODE_KEY, mode);
  const buttons = document.querySelectorAll('[data-mode]');
  buttons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  });
  state.dailyKey = getDailyKey();
  if (state.hasStarted) {
    startNewBoard();
  }
}

function setScreen(screen) {
  state.screen = screen;
  const homeScreen = document.querySelector('#homeScreen');
  const gameScreen = document.querySelector('#gameScreen');
  if (homeScreen) homeScreen.classList.toggle('hidden', screen !== 'home');
  if (gameScreen) gameScreen.classList.toggle('hidden', screen !== 'game');
}

function startNewBoard() {
  state.difficulty = getDifficultyLabel();
  const boardState = createBoardState(state.mode, state.dailyKey, Math.max(1, state.round));
  state.board = boardState.board;
  state.target = boardState.target;
  state.path = [];
  state.set.clear();
  state.lastExpression = '-';
  state.lastValue = null;
  state.statusMessage = 'Swipe across the board to build an expression';
  state.dragging = false;

  if (boardState.unaryBonus) {
    spawnUnaryBonus(boardState.unaryBonus);
  } else {
    state.unaryBonus = null;
    if (state.unaryTimerId) {
      window.clearTimeout(state.unaryTimerId);
      state.unaryTimerId = null;
    }
  }

  renderBoard();
  updateUI();
  renderUnaryButtons();
}

function spawnUnaryBonus(forcedBonus = null) {
  if (state.gameEnded) return;
  const options = getUnaryOptions();
  const chosen = forcedBonus?.operation || options[Math.floor(Math.random() * options.length)];
  const label = forcedBonus?.label || getUnaryLabel(chosen);
  state.unaryBonus = { operation: chosen, label };

  if (state.unaryTimerId) {
    window.clearTimeout(state.unaryTimerId);
  }

  state.unaryTimerId = window.setTimeout(() => {
    state.unaryBonus = null;
    renderUnaryButtons();
  }, 8000);

  renderUnaryButtons();
}

function renderUnaryButtons() {
  const bonusBar = document.querySelector('#bonusBar');
  if (!bonusBar) return;

  if (!state.unaryBonus) {
    bonusBar.innerHTML = '<span class="bonus-empty">No unary bonus active</span>';
    return;
  }

  const viable = state.lastValue !== null && Number.isFinite(applyUnaryBonus(state.lastValue, state.unaryBonus.operation))
    && Number(applyUnaryBonus(state.lastValue, state.unaryBonus.operation)) === Number(state.target);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `unary-btn${viable ? ' pulse' : ''}`;
  button.dataset.operation = state.unaryBonus.operation;
  button.textContent = state.unaryBonus.label;
  button.title = `Use ${state.unaryBonus.label} on the current value`;
  button.addEventListener('click', () => applyUnaryToCurrentValue(state.unaryBonus.operation));
  bonusBar.innerHTML = '';
  bonusBar.appendChild(button);
}

function applyUnaryToCurrentValue(operation) {
  if (state.gameEnded || !state.unaryBonus) return;
  if (state.lastValue === null || state.lastValue === undefined) {
    state.statusMessage = 'Build a valid expression before using the unary bonus.';
    updateUI();
    return;
  }

  const adjusted = applyUnaryBonus(state.lastValue, operation);
  const numericAdjusted = Number(adjusted);

  if (adjusted === null || !Number.isFinite(numericAdjusted)) {
    state.multiplier = 1;
    state.streak = 0;
    state.unaryBonus = null;
    state.statusMessage = 'Unary bonus failed — multiplier reset.';
    flashBoard('error');
    renderUnaryButtons();
    updateUI();
    return;
  }

  if (numericAdjusted === Number(state.target)) {
    state.lastExpression = `${state.lastValue}${getUnaryLabel(operation)}`;
    state.lastValue = numericAdjusted;
    flashBoard('success', true);
    handleBoardSuccess(true);
    return;
  }

  state.multiplier = 1;
  state.streak = 0;
  state.unaryBonus = null;
  state.statusMessage = 'The unary bonus missed the target — multiplier reset.';
  flashBoard('error', false);
  renderUnaryButtons();
  updateUI();
}

function saveLocalBest() {
  localStorage.setItem(BEST_SCORE_KEY, String(state.bestScore));
}

function loadLocalBest() {
  const storedBest = Number(localStorage.getItem(BEST_SCORE_KEY) || 0);
  state.bestScore = storedBest;
  const storedName = localStorage.getItem(PLAYER_NAME_KEY);
  if (storedName) {
    state.playerName = storedName;
  }
  const storedMode = localStorage.getItem(MODE_KEY) || MODES.normal;
  state.mode = Object.values(MODES).includes(storedMode) ? storedMode : MODES.normal;
  const storedSoundEnabled = localStorage.getItem(SOUND_KEY);
  state.soundEnabled = storedSoundEnabled === null ? true : storedSoundEnabled !== 'false';
}

async function submitScore(score) {
  const value = Number(score || 0);
  if (!value || value <= 0) return;

  try {
    const response = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: state.playerName,
        score: value,
        streak: state.streak,
        mode: state.mode,
        dailyKey: state.dailyKey,
      }),
    });

    if (!response.ok) {
      throw new Error('Could not save score');
    }

    await refreshLeaderboard();
  } catch (error) {
    console.warn('Score sync failed:', error);
  }
}

async function refreshLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard');
    const data = await response.json();
    state.leaderboard = Array.isArray(data.entries) ? data.entries : [];
    renderLeaderboard();
  } catch (error) {
    console.warn('Leaderboard unavailable:', error);
  }
}

function renderLeaderboard() {
  const list = document.querySelector('#leaderboardList');
  if (!list) return;

  list.innerHTML = '';
  if (!state.leaderboard.length) {
    list.innerHTML = '<li class="leaderboard-empty">No scores yet</li>';
    return;
  }

  state.leaderboard.slice(0, 5).forEach((entry, index) => {
    const item = document.createElement('li');
    item.className = 'leaderboard-item';
    item.innerHTML = `<span>${index + 1}. ${entry.name}</span><strong>${entry.score}</strong>`;
    list.appendChild(item);
  });
}

function triggerBoardBurst(type = 'success') {
  const boardWrap = document.querySelector('.board-wrap');
  if (!boardWrap) return;

  const colors = {
    success: ['#4ade80', '#facc15', '#60a5fa'],
    error: ['#ef4444', '#f97316', '#fdba74'],
    power: ['#fde68a', '#fca5a5', '#a5b4fc'],
  };

  const palette = colors[type] || colors.success;
  for (let i = 0; i < 10; i += 1) {
    const spark = document.createElement('span');
    spark.className = 'spark-pair';
    spark.style.left = `${50 + (Math.random() * 20 - 10)}%`;
    spark.style.top = `${50 + (Math.random() * 18 - 9)}%`;
    spark.style.background = palette[i % palette.length];
    spark.style.setProperty('--dx', `${(Math.random() * 120 - 60).toFixed(1)}px`);
    spark.style.setProperty('--dy', `${(Math.random() * 120 - 60).toFixed(1)}px`);
    boardWrap.appendChild(spark);

    window.setTimeout(() => spark.remove(), 700);
  }
}

function showComboPop(multiplier, label = 'combo') {
  const boardWrap = document.querySelector('.board-wrap');
  if (!boardWrap) return;

  const popup = document.createElement('div');
  popup.className = 'combo-pop';
  popup.textContent = `${label === 'bonus' ? 'BONUS ' : ''}x${multiplier}`;
  popup.style.left = '50%';
  popup.style.top = '44%';
  boardWrap.appendChild(popup);

  window.setTimeout(() => popup.remove(), 820);
}

function setSoundEnabled(enabled) {
  state.soundEnabled = enabled;
  localStorage.setItem(SOUND_KEY, String(enabled));
  const soundButton = document.querySelector('#audioToggleBtn');
  if (soundButton) {
    soundButton.textContent = enabled ? 'Sound: On' : 'Sound: Off';
    soundButton.setAttribute('aria-pressed', String(enabled));
    soundButton.classList.toggle('is-muted', !enabled);
  }
}

function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) {
      state.audioContext = new AudioCtor();
    }
  }
  return state.audioContext;
}

function playFeedbackCue(type = 'success') {
  if (!state.soundEnabled) return;
  const context = ensureAudioContext();
  if (!context) return;

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const now = context.currentTime;

  oscillator.type = type === 'error' ? 'sawtooth' : 'triangle';
  oscillator.frequency.setValueAtTime(type === 'error' ? 180 : 420, now);
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.04, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + (type === 'error' ? 0.17 : 0.24));

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (type === 'error' ? 0.18 : 0.25));
}

function showToast(message, tone = 'success') {
  const container = document.querySelector('#toastContainer') || (() => {
    const node = document.createElement('div');
    node.id = 'toastContainer';
    node.className = 'toast-container';
    document.body.appendChild(node);
    return node;
  })();

  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 220);
  }, 900);
}

function flashBoard(type, isPower = false) {
  const board = document.querySelector('#board');
  const statusCard = document.querySelector('.status-card');
  if (!board) return;
  board.classList.remove('success', 'error', 'invalid', 'power');
  board.classList.add(type);
  if (statusCard) {
    statusCard.classList.remove('is-good', 'is-warning');
    statusCard.classList.add(type === 'success' ? 'is-good' : 'is-warning');
  }

  if (isPower) {
    board.classList.add('power');
  }

  triggerBoardBurst(isPower ? 'power' : type);
  playFeedbackCue(type === 'error' ? 'error' : 'success');

  window.setTimeout(() => {
    board.classList.remove(type, 'power');
    if (statusCard) {
      statusCard.classList.remove('is-good', 'is-warning');
    }
  }, 540);
}

function showGameOverModal() {
  const modal = document.querySelector('#gameOverModal');
  const summary = document.querySelector('#gameOverSummary');
  if (!modal || !summary) return;

  summary.textContent = `${state.playerName} scored ${state.score} in ${getModeLabel(state.mode)} mode.`;
  modal.classList.remove('hidden');
}

function hideGameOverModal() {
  const modal = document.querySelector('#gameOverModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function renderBoard() {
  const boardEl = document.querySelector('#board');
  if (!boardEl) return;

  boardEl.onpointermove = (event) => {
    if (!state.dragging || state.gameEnded) return;
    const tile = event.target.closest('.tile');
    if (!tile) return;
    const row = Number(tile.dataset.row);
    const col = Number(tile.dataset.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return;
    extendDrag(row, col);
  };

  boardEl.innerHTML = '';

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const tile = document.createElement('button');
      const cell = state.board[row][col];
      const key = `${row},${col}`;

      tile.type = 'button';
      tile.className = 'tile';
      tile.dataset.row = String(row);
      tile.dataset.col = String(col);
      tile.textContent = cell.value;
      tile.title = `Cell ${row + 1}, ${col + 1}`;

      if (state.set.has(key)) {
        tile.classList.add('selected');
      }

      tile.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (state.gameEnded) return;
        beginDrag(row, col);
      });

      boardEl.appendChild(tile);
    }
  }
}

function beginDrag(row, col) {
  state.dragging = true;
  state.path = [{ row, col }];
  state.set = new Set([`${row},${col}`]);
  state.lastExpression = state.board[row][col].value;
  state.statusMessage = 'Swipe across the grid';
  updateUI();
  renderBoard();
}

function extendDrag(row, col) {
  if (!state.dragging || state.gameEnded) return;

  const last = state.path[state.path.length - 1];
  const key = `${row},${col}`;

  if (row === last.row && col === last.col) {
    state.lastExpression = state.path.map(({ row: r, col: c }) => state.board[r][c].value).join('');
    updateUI();
    return;
  }

  const previousIndex = state.path.findIndex((cell) => cell.row === row && cell.col === col);
  if (previousIndex !== -1) {
    if (previousIndex === state.path.length - 2) {
      state.path.pop();
      state.set.delete(key);
      state.lastExpression = state.path.map(({ row: r, col: c }) => state.board[r][c].value).join('');
      state.statusMessage = 'Backtracking...';
      updateUI();
      renderBoard();
    }
    return;
  }

  const rowDelta = Math.abs(row - last.row);
  const colDelta = Math.abs(col - last.col);
  if (rowDelta + colDelta !== 1) return;

  const nextToken = state.board[row][col].value;
  const previousToken = state.board[last.row][last.col].value;
  const nextIsNumber = isNumberToken(nextToken);
  const prevIsNumber = isNumberToken(previousToken);

  if (nextIsNumber === prevIsNumber) {
    state.statusMessage = 'Numbers and operators must alternate';
    updateUI();
    return;
  }

  state.path.push({ row, col });
  state.set.add(key);
  state.lastExpression = state.path.map(({ row: r, col: c }) => state.board[r][c].value).join('');
  state.statusMessage = 'Expression building...';
  updateUI();
  renderBoard();
}

function handleBoardSuccess(withUnary = false) {
  const expressionTokens = state.lastExpression.split('');
  const numberCount = expressionTokens.filter((token) => /\d/.test(token)).length;
  const operatorCount = expressionTokens.filter((token) => /[+\-*/]/.test(token)).length;
  const chainBonus = Math.max(0, expressionTokens.length - 3) * 4;
  const densityBonus = (numberCount + operatorCount) * 3;
  const unaryBoost = withUnary ? 25 : 0;
  const baseScore = state.mode === MODES.streak ? 18 : 12;
  const extraMultiplier = Math.max(1, Math.floor((numberCount + operatorCount - 2) / 2));
  const multiplierBoost = withUnary ? 2 : 1;
  const nextMultiplier = Math.max(1, state.multiplier + 1 + extraMultiplier) * multiplierBoost;
  state.multiplier = nextMultiplier;
  const scoreGain = Math.max(10, baseScore + chainBonus + densityBonus + unaryBoost) * state.multiplier;
  state.streak += 1;
  state.score += scoreGain;
  state.bestScore = Math.max(state.bestScore, state.score);
  saveLocalBest();
  state.round += 1;
  state.timeLeft = Math.min(60, state.timeLeft + 10);
  state.statusMessage = withUnary
    ? `Bonus! ${state.lastExpression} = ${state.target} • x${state.multiplier}`
    : `Perfect! ${state.lastExpression} = ${state.target} • x${state.multiplier}`;
  state.unaryBonus = null;
  showToast(`+${scoreGain} points`, 'success');
  showComboPop(state.multiplier, withUnary ? 'bonus' : 'combo');
  flashBoard('success', withUnary);
  renderUnaryButtons();

  window.setTimeout(() => {
    startNewBoard();
  }, 420);
}

function resetDifficultyAndBoard() {
  state.round = 1;
  state.streak = 0;
  state.multiplier = 1;
  state.statusMessage = 'Difficulty reset — back to easy mode.';
  flashBoard('error');
  window.setTimeout(() => {
    startNewBoard();
  }, 260);
}

function evaluateCurrentExpression() {
  const expression = state.path.map(({ row, col }) => state.board[row][col].value).join('');
  state.lastExpression = expression;

  if (!expression || expression.length < 3) {
    state.statusMessage = 'Swipe a longer route';
    flashBoard('invalid');
    updateUI();
    return false;
  }

  const tokens = expression.split('');
  if (!isAlternatingExpressionTokens(tokens)) {
    state.statusMessage = 'Numbers and operators must alternate';
    flashBoard('invalid');
    updateUI();
    return false;
  }

  const value = safeEvaluate(expression);
  if (value === null) {
    state.statusMessage = 'That route evaluates to no value.';
    flashBoard('invalid');
    updateUI();
    return false;
  }

  state.lastValue = Number(value);
  if (state.lastValue === Number(state.target)) {
    handleBoardSuccess(false);
    return true;
  }

  state.round = 1;
  state.streak = 0;
  state.multiplier = 1;
  const bonusCanHit = state.unaryBonus && Number.isFinite(applyUnaryBonus(state.lastValue, state.unaryBonus.operation))
    && Number(applyUnaryBonus(state.lastValue, state.unaryBonus.operation)) === Number(state.target);
  state.statusMessage = bonusCanHit
    ? `Current value ${state.lastValue} is close — the bonus can hit the target.`
    : `Current value ${state.lastValue} is not the target — multiplier reset and difficulty reset.`;
  showToast(bonusCanHit ? 'Almost there!' : 'Target missed', 'error');
  flashBoard('error');
  updateUI();
  renderUnaryButtons();
  window.setTimeout(() => {
    startNewBoard();
  }, 320);
  return false;
}

function endDrag() {
  if (!state.dragging || state.gameEnded) return;

  evaluateCurrentExpression();
  state.dragging = false;
  state.path = [];
  state.set.clear();
  renderBoard();
}

function updateUI() {
  const scoreEl = document.querySelector('#Score');
  const bestEl = document.querySelector('#Best');
  const roundEl = document.querySelector('#Round');
  const targetEl = document.querySelector('#Target');
  const timerEl = document.querySelector('#Timer');
  const comboEl = document.querySelector('#Combo');
  const statusEl = document.querySelector('#Status');
  const expressionEl = document.querySelector('#Expression');
  const difficultyEl = document.querySelector('#Difficulty');
  const expressionCard = document.querySelector('#Expression')?.closest('.info-card');

  if (!scoreEl || !bestEl || !roundEl || !targetEl || !timerEl || !comboEl || !statusEl || !expressionEl) return;

  state.difficulty = getDifficultyLabel();
  scoreEl.textContent = state.score;
  bestEl.textContent = state.bestScore;
  roundEl.textContent = state.round;
  targetEl.textContent = state.target;
  timerEl.textContent = `${Math.ceil(state.timeLeft)}s`;
  comboEl.textContent = `x${state.multiplier}`;
  statusEl.textContent = state.statusMessage;
  expressionEl.textContent = state.lastExpression;

  if (difficultyEl) {
    difficultyEl.textContent = state.difficulty;
  }

  if (expressionCard) {
    expressionCard.classList.remove('is-good', 'is-warning');
    if (state.lastExpression && state.lastExpression !== '-') {
      expressionCard.classList.add('is-good');
    }
  }
}

function startTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
  }

  state.timerId = window.setInterval(() => {
    if (!state.hasStarted || state.gameEnded) return;

    state.timeLeft = Math.max(0, state.timeLeft - 1);
    if (state.timeLeft <= 0) {
      state.gameEnded = true;
      state.bestScore = Math.max(state.bestScore, state.score);
      saveLocalBest();
      submitScore(state.score);
      state.statusMessage = 'Time is up!';
      showGameOverModal();
      updateUI();
      return;
    }

    updateUI();
  }, 1000);
}

function startGame() {
  const input = document.querySelector('#playerNameInput');
  const nameValue = (input?.value || '').trim();

  if (!nameValue) {
    const error = document.querySelector('#nameError');
    if (error) error.textContent = 'Please enter a player name.';
    return;
  }

  state.playerName = nameValue;
  localStorage.setItem(PLAYER_NAME_KEY, nameValue);
  setScreen('game');
  state.score = 0;
  state.streak = 0;
  state.round = 1;
  state.timeLeft = ROUND_TIME;
  state.gameEnded = false;
  state.hasStarted = true;
  state.multiplier = 1;
  state.dailyKey = getDailyKey();
  state.lastExpression = '-';
  state.lastValue = null;
  startNewBoard();
  startTimer();
  hideGameOverModal();
}

function resetGame() {
  state.score = 0;
  state.streak = 0;
  state.round = 1;
  state.timeLeft = ROUND_TIME;
  state.gameEnded = false;
  state.multiplier = 1;
  state.dailyKey = getDailyKey();
  state.statusMessage = 'Swipe across the board to build an expression';
  state.lastExpression = '-';
  state.lastValue = null;
  startNewBoard();
  hideGameOverModal();
  startTimer();
}

function buildShell() {
  app.innerHTML = `
    <div id="homeScreen" class="screen home-screen">
      <div class="home-card">
        <div class="version-chip">build ${APP_VERSION}</div>
        <p class="eyebrow">Target number puzzle</p>
        <h1>MathsGrid</h1>
        <p class="home-copy">Swipe across adjacent tiles to build a valid arithmetic line. Hit the target before time runs out, and use the bonus unary operator when it lines up.</p>

        <label class="field-wrap">
          <span>Player name</span>
          <input id="playerNameInput" maxlength="18" value="${state.playerName}" />
        </label>

        <div class="home-actions">
          <button id="homeStartBtn" class="primary-btn">Start game</button>
        </div>

        <div class="home-meta">
          <span>Best score</span>
          <strong>${state.bestScore}</strong>
        </div>
      </div>
    </div>

    <div id="gameScreen" class="screen game-screen hidden">
      <div class="panel">
        <header class="topbar">
          <div>
            <div class="version-chip">build ${APP_VERSION}</div>
            <p class="eyebrow">Target number puzzle</p>
            <h1>MathsGrid</h1>
          </div>
          <div class="header-actions">
            <span id="Difficulty" class="difficulty-pill">Easy</span>
            <button id="audioToggleBtn" class="sound-btn" type="button" aria-pressed="true">Sound: On</button>
            <button id="installBtn" class="install-btn" hidden>Install App</button>
            <button id="restart" class="restart-btn">Restart</button>
          </div>
        </header>

        <section class="mode-picker" aria-label="Game modes">
          <button class="mode-btn is-active" data-mode="normal">Normal</button>
          <button class="mode-btn" data-mode="streak">Streak</button>
          <button class="mode-btn" data-mode="daily">Daily</button>
        </section>

        <section class="stats">
          <div class="stat-card accent">
            <span class="label">Score</span>
            <strong id="Score">0</strong>
          </div>
          <div class="stat-card">
            <span class="label">Best</span>
            <strong id="Best">0</strong>
          </div>
          <div class="stat-card">
            <span class="label">Round</span>
            <strong id="Round">1</strong>
          </div>
          <div class="stat-card">
            <span class="label">Target</span>
            <strong id="Target">0</strong>
          </div>
          <div class="stat-card timer">
            <span class="label">Combo</span>
            <strong id="Combo">x1</strong>
          </div>
          <div class="stat-card timer">
            <span class="label">Timer</span>
            <strong id="Timer">60s</strong>
          </div>
        </section>

        <section class="game-area">
          <div class="board-wrap">
            <div id="board" class="board" aria-label="Maths grid"></div>
          </div>

          <aside class="side-panel">
            <div class="info-card">
              <h2>Rules</h2>
              <p>Swipe across adjacent tiles to build a valid expression.</p>
              <p>Numbers and operators must alternate and cannot sit next to the same type.</p>
            </div>
            <div class="info-card">
              <h2>Current expression</h2>
              <p id="Expression">-</p>
            </div>
            <div class="info-card bonus-card">
              <h2>Unary bonus</h2>
              <div id="bonusBar" class="bonus-bar"></div>
            </div>
            <div class="info-card status-card">
              <h2>Status</h2>
              <p id="Status">Swipe across the board to build an expression</p>
            </div>
            <div class="info-card">
              <h2>High scores</h2>
              <ul id="leaderboardList" class="leaderboard-list"></ul>
            </div>
          </aside>
        </section>
      </div>
    </div>

    <div id="gameOverModal" class="modal hidden">
      <div class="modal-card">
        <p class="eyebrow">Time up</p>
        <h2>Game over</h2>
        <p id="gameOverSummary"></p>
        <div class="modal-actions">
          <button id="playAgainBtn" class="primary-btn">Play again</button>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  document.querySelector('#homeStartBtn').addEventListener('click', startGame);
  document.querySelector('#restart').addEventListener('click', resetGame);

  document.querySelector('#playAgainBtn').addEventListener('click', () => {
    resetGame();
    hideGameOverModal();
  });

  const installButton = document.querySelector('#installBtn');
  if (installButton) {
    installButton.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installButton.hidden = true;
    });
  }

  const audioButton = document.querySelector('#audioToggleBtn');
  if (audioButton) {
    audioButton.addEventListener('click', () => setSoundEnabled(!state.soundEnabled));
    setSoundEnabled(state.soundEnabled);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function init() {
  loadLocalBest();
  buildShell();
  state.mode = localStorage.getItem(MODE_KEY) || MODES.normal;
  setScreen('home');
  startNewBoard();
  updateUI();
  renderLeaderboard();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });

      if (registration.waiting) {
        window.location.reload();
      }
    }).catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  }
}

init();
