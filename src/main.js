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
  pendingUnary: false,
  screen: 'home',
  difficulty: 'Easy',
  audioContext: null,
  soundEnabled: true,
  solutionPath: [],
  hintIndex: 0,
  hintReveal: new Set(),
  ambientLoopId: null,
  lastScoreGain: 0,
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
  const leaderboardTitle = document.querySelector('#leaderboardTitle');
  if (leaderboardTitle) {
    leaderboardTitle.textContent = mode === MODES.daily
      ? `Today's high scores`
      : `${getModeLabel(mode)} high scores`;
  }
  state.dailyKey = getDailyKey();
  refreshLeaderboard();
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

function getDistanceFromTarget(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return Number.POSITIVE_INFINITY;
  return Math.abs(Number(state.target) - Number(value));
}

function startNewBoard() {
  state.difficulty = getDifficultyLabel();
  const boardState = createBoardState(state.mode, state.dailyKey, Math.max(1, state.round));
  state.board = boardState.board;
  state.target = boardState.target;
  state.solutionPath = boardState.path || [];
  state.hintIndex = 0;
  state.hintReveal = new Set();
  state.path = [];
  state.set.clear();
  state.lastExpression = '-';
  state.lastValue = null;
  state.pendingUnary = false;
  state.statusMessage = 'Swipe across the board to build an expression';
  state.dragging = false;

  const guaranteedUnary = boardState.unaryBonus || {
    operation: getUnaryOptions()[0],
    label: getUnaryLabel(getUnaryOptions()[0]),
  };
  spawnUnaryBonus(guaranteedUnary);

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

  renderUnaryButtons();
}

function getCurrentExpressionValue(expression = state.path.map(({ row, col }) => state.board[row][col].value).join('') || state.lastExpression) {
  if (!expression) return null;
  const tokens = expression.split('');
  if (!isAlternatingExpressionTokens(tokens)) return null;
  const value = safeEvaluate(expression);
  return value === null ? null : Number(value);
}

function renderUnaryButtons() {
  const bonusBar = document.querySelector('#bonusBar');
  if (!bonusBar) return;

  if (!state.unaryBonus) {
    bonusBar.innerHTML = '<span class="bonus-empty">⚡</span>';
    return;
  }

  const previewValue = getCurrentExpressionValue() ?? state.lastValue;
  const unaryValue = previewValue !== null && previewValue !== undefined ? applyUnaryBonus(previewValue, state.unaryBonus.operation) : null;
  const canSolve = previewValue !== null && Number.isFinite(Number(unaryValue)) && Number(unaryValue) === Number(state.target);
  const closeEnough = previewValue !== null && Number.isFinite(Number(unaryValue)) && Number(unaryValue) !== Number(state.target) && getDistanceFromTarget(unaryValue) <= 4;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `unary-btn${canSolve || closeEnough ? ' pulse' : ''}`;
  button.dataset.operation = state.unaryBonus.operation;
  button.textContent = state.unaryBonus.label;
  button.title = canSolve
    ? `Use ${state.unaryBonus.label} to solve the target`
    : closeEnough
      ? `Use ${state.unaryBonus.label} for a near-miss solve`
      : `Use ${state.unaryBonus.label} on the current value`;
  button.addEventListener('click', () => applyUnaryToCurrentValue(state.unaryBonus.operation));
  bonusBar.innerHTML = '';
  bonusBar.appendChild(button);
}

function applyUnaryToCurrentValue(operation) {
  if (state.gameEnded || !state.unaryBonus) return;
  const sourceValue = getCurrentExpressionValue() ?? state.lastValue;
  if (sourceValue === null || sourceValue === undefined) {
    state.statusMessage = 'Build a valid expression before using the unary bonus.';
    updateUI();
    return;
  }

  state.pendingUnary = false;
  const adjusted = applyUnaryBonus(sourceValue, operation);
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
    state.lastExpression = `${sourceValue}${getUnaryLabel(operation)}`;
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
    const params = new URLSearchParams({ mode: state.mode });
    if (state.mode === MODES.daily) {
      params.set('dailyKey', state.dailyKey);
    }
    const response = await fetch(`/api/leaderboard?${params.toString()}`);
    if (!response.ok) throw new Error('Could not load leaderboard');
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
    const name = document.createElement('span');
    const score = document.createElement('strong');
    name.textContent = `${index + 1}. ${String(entry.name || 'Player')}`;
    score.textContent = String(Number(entry.score) || 0);
    item.append(name, score);
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
    soundButton.innerHTML = enabled ? '🔊 Sound On' : '🔇 Sound Off';
    soundButton.setAttribute('aria-pressed', String(enabled));
    soundButton.classList.toggle('is-muted', !enabled);
  }

  if (enabled) {
    if (state.hasStarted && !state.gameEnded) {
      startAmbientTune();
    }
  } else {
    stopAmbientTune();
  }
}

function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) {
      state.audioContext = new AudioCtor();
    }
  }
  if (state.audioContext && state.audioContext.state === 'suspended') {
    state.audioContext.resume();
  }
  return state.audioContext;
}

function stopAmbientTune() {
  if (state.ambientLoopId) {
    window.clearInterval(state.ambientLoopId);
    state.ambientLoopId = null;
  }
}

function startAmbientTune() {
  if (!state.soundEnabled || !state.hasStarted || state.gameEnded) return;
  if (state.ambientLoopId) return;

  const context = ensureAudioContext();
  if (!context) return;

  const melody = [261.63, 329.63, 392.0, 329.63, 293.66, 349.23, 392.0, 440.0];
  let step = 0;

  const playStep = () => {
    if (!state.soundEnabled || !state.hasStarted || state.gameEnded) {
      stopAmbientTune();
      return;
    }

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const frequency = melody[step % melody.length];
    const now = context.currentTime;

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, now);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.012, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.25);

    step += 1;
  };

  playStep();
  state.ambientLoopId = window.setInterval(playStep, 260);
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
      tile.title = `${cell.type === 'number' ? 'Number' : 'Operator'} ${cell.value}`;

      const pathIndex = state.path.findIndex((pathCell) => pathCell.row === row && pathCell.col === col);
      if (pathIndex !== -1) {
        const step = document.createElement('span');
        step.className = 'path-step';
        step.textContent = String(pathIndex + 1);
        tile.appendChild(step);
      }

      if (state.set.has(key)) {
        tile.classList.add('selected');
      }

      if (state.hintReveal.has(key)) {
        tile.classList.add('hint');
        const hintIndex = state.solutionPath.findIndex((hintCell) => hintCell.row === row && hintCell.col === col);
        if (hintIndex !== -1 && pathIndex === -1) {
          const hintStep = document.createElement('span');
          hintStep.className = 'hint-step';
          hintStep.textContent = String(hintIndex + 1);
          tile.appendChild(hintStep);
        }
      }

      tile.setAttribute('aria-label', `${tile.title}${pathIndex !== -1 ? `, route step ${pathIndex + 1}` : ''}`);

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
  state.pendingUnary = false;
  state.path = [{ row, col }];
  state.set = new Set([`${row},${col}`]);
  state.lastExpression = state.board[row][col].value;
  state.lastValue = null;
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
  const routeLength = Math.max(3, state.path.length || expressionTokens.length);
  const numberCount = Math.ceil(routeLength / 2);
  const operatorCount = Math.floor(routeLength / 2);
  const routeLengthBonus = routeLength >= 9 ? 36 : routeLength >= 7 ? 24 : routeLength >= 5 ? 14 : 8;
  const chainBonus = Math.max(0, routeLength - 3) * 4;
  const densityBonus = (numberCount + operatorCount) * 3;
  const streakBonus = state.streak * 12;
  const unaryBoost = withUnary ? 35 : 0;
  const baseScore = state.mode === MODES.streak ? 18 : 12;
  const nextMultiplier = Math.min(9, state.multiplier + (withUnary ? 2 : 1));
  state.multiplier = nextMultiplier;
  const scoreGain = Math.max(10, baseScore + routeLengthBonus + chainBonus + densityBonus + streakBonus + unaryBoost) * state.multiplier;
  state.lastScoreGain = scoreGain;
  state.streak += 1;
  state.score += scoreGain;
  state.bestScore = Math.max(state.bestScore, state.score);
  saveLocalBest();
  state.round += 1;
  state.timeLeft = Math.min(60, state.timeLeft + (state.mode === MODES.streak ? 4 : 6));
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

  const seenCells = new Set();
  for (const tile of state.path) {
    const key = `${tile.row},${tile.col}`;
    if (seenCells.has(key)) {
      state.statusMessage = 'You cannot retrace a route through the same tile again';
      flashBoard('invalid');
      updateUI();
      return false;
    }
    seenCells.add(key);
  }

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

  const distanceToTarget = getDistanceFromTarget(state.lastValue);
  const bonusCanHit = state.unaryBonus && Number.isFinite(Number(applyUnaryBonus(state.lastValue, state.unaryBonus.operation)))
    && Number(applyUnaryBonus(state.lastValue, state.unaryBonus.operation)) === Number(state.target);
  const closeMiss = distanceToTarget <= 4;

  if (bonusCanHit) {
    state.pendingUnary = true;
    state.statusMessage = `Current value ${state.lastValue} is ready — tap ${state.unaryBonus.label} to hit the target.`;
    showToast('Unary ready', 'info');
    flashBoard('power');
    updateUI();
    renderUnaryButtons();
    return false;
  }

  state.streak = 0;
  state.multiplier = 1;

  if (state.mode === MODES.streak) {
    state.timeLeft = Math.max(0, state.timeLeft - 5);
  }

  state.statusMessage = closeMiss
    ? `Close! ${state.lastValue} is ${distanceToTarget} away. Try another route on this board.`
    : `${state.lastValue} misses the target. The board stays — try another route.`;
  if (state.mode === MODES.streak) {
    state.statusMessage += ' Streak penalty: −5 seconds.';
  }
  showToast(closeMiss ? `Close! ${distanceToTarget} away` : 'Target missed', closeMiss ? 'info' : 'error');
  flashBoard('error');
  updateUI();
  renderUnaryButtons();
  return false;
}

function endDrag() {
  if (!state.dragging || state.gameEnded) return;

  evaluateCurrentExpression();
  state.dragging = false;
  if (!state.pendingUnary) {
    state.path = [];
    state.set.clear();
  }
  renderBoard();
}

function revealHint() {
  if (!state.solutionPath || !state.solutionPath.length) {
    showToast('No hint available for this round', 'error');
    return;
  }

  if (state.hintIndex >= state.solutionPath.length) {
    state.statusMessage = 'The full route is already highlighted';
    updateUI();
    showToast('Full route is now visible', 'success');
    return;
  }

  const nextCell = state.solutionPath[state.hintIndex];
  state.hintReveal.add(`${nextCell.row},${nextCell.col}`);
  state.hintIndex += 1;
  state.timeLeft = Math.max(1, state.timeLeft - 3);
  state.statusMessage = `Hint ${state.hintIndex}/${state.solutionPath.length}: follow the numbered blue route. −3 seconds.`;
  updateUI();
  renderBoard();
  showToast('Hint revealed • −3 seconds', 'info');
}

function toggleRules() {
  const rulesPanel = document.querySelector('#rulesPanel');
  if (!rulesPanel) return;
  const isHidden = rulesPanel.classList.toggle('hidden');
  const rulesBtn = document.querySelector('#rulesBtn');
  if (rulesBtn) {
    rulesBtn.setAttribute('aria-expanded', String(!isHidden));
    rulesBtn.classList.toggle('is-active', !isHidden);
  }
}

function updateUI() {
  const scoreEl = document.querySelector('#Score');
  const bestEl = document.querySelector('#Best');
  const targetEl = document.querySelector('#Target');
  const timerEl = document.querySelector('#Timer');
  const comboEl = document.querySelector('#Combo');
  const statusEl = document.querySelector('#Status');
  const difficultyEl = document.querySelector('#Difficulty');
  const expressionEl = document.querySelector('#Expression');
  const liveValueEl = document.querySelector('#LiveValue');
  const roundEl = document.querySelector('#Round');
  const streakEl = document.querySelector('#Streak');

  if (!scoreEl || !targetEl || !timerEl || !comboEl) return;

  state.difficulty = getDifficultyLabel();
  scoreEl.textContent = state.score;
  if (bestEl) bestEl.textContent = state.bestScore;
  targetEl.textContent = state.target;
  timerEl.textContent = `${Math.ceil(state.timeLeft)}s`;
  comboEl.textContent = `x${state.multiplier}`;
  if (roundEl) roundEl.textContent = state.round;
  if (streakEl) streakEl.textContent = state.streak;

  const activeExpression = state.path.length
    ? state.path.map(({ row, col }) => state.board[row][col].value).join('')
    : state.lastExpression;
  if (expressionEl) expressionEl.textContent = activeExpression || '—';
  if (liveValueEl) {
    const liveValue = getCurrentExpressionValue(activeExpression);
    liveValueEl.textContent = liveValue === null ? '—' : String(liveValue);
  }

  timerEl.classList.toggle('is-urgent', state.timeLeft <= 10 && !state.gameEnded);

  if (statusEl) {
    statusEl.textContent = state.statusMessage;
  }

  if (difficultyEl) {
    difficultyEl.textContent = state.difficulty;
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
      window.clearInterval(state.timerId);
      state.timerId = null;
      stopAmbientTune();
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
  ensureAudioContext();

  const input = document.querySelector('#playerNameInput');
  const nameValue = (input?.value || '').trim();

  if (!nameValue) {
    const error = document.querySelector('#nameError');
    if (error) error.textContent = 'Please enter a player name.';
    return;
  }

  const error = document.querySelector('#nameError');
  if (error) error.textContent = '';

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
  startAmbientTune();
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
  startAmbientTune();
}

function returnHome() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
  state.hasStarted = false;
  state.gameEnded = true;
  state.dragging = false;
  stopAmbientTune();
  hideGameOverModal();
  setScreen('home');
  const homeBest = document.querySelector('#HomeBest');
  if (homeBest) homeBest.textContent = state.bestScore;
  refreshLeaderboard();
}

function buildShell() {
  app.innerHTML = `
    <div id="homeScreen" class="screen home-screen">
      <div class="home-card">
        <div class="version-chip">build ${APP_VERSION}</div>
        <p class="eyebrow">Target number puzzle</p>
        <h1>MathsGrid</h1>
        <p class="home-copy">Find the target. Chain a route. Build a ridiculous combo before the clock wins.</p>

        <div class="home-mode-picker" aria-label="Game modes">
          <button class="mode-btn is-active" data-mode="normal"><strong>Normal</strong><span>Explore and retry</span></button>
          <button class="mode-btn" data-mode="streak"><strong>Streak</strong><span>Mistakes cost 5s</span></button>
          <button class="mode-btn" data-mode="daily"><strong>Daily</strong><span>Same grid for all</span></button>
        </div>

        <label class="field-wrap">
          <span>Player name</span>
          <input id="playerNameInput" maxlength="18" autocomplete="nickname" />
          <small id="nameError" class="field-error" aria-live="polite"></small>
        </label>

        <div class="home-actions">
          <button id="homeStartBtn" class="primary-btn">Start game</button>
          <button id="homeInstallBtn" class="install-btn" type="button">Install App</button>
        </div>

        <div class="home-meta">
          <span>Best score</span>
          <strong id="HomeBest">${state.bestScore}</strong>
        </div>

        <div class="home-meta home-leaderboard">
          <span id="leaderboardTitle">Normal high scores</span>
          <ul id="leaderboardList" class="leaderboard-list compact"></ul>
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
            <button id="menuBtn" class="rules-btn" type="button">Menu</button>
            <button id="rulesBtn" class="rules-btn" type="button" aria-expanded="false" aria-controls="rulesPanel">Rules</button>
            <span id="Difficulty" class="difficulty-pill">Easy</span>
            <button id="hintBtn" class="secondary-btn" type="button" aria-label="Show a hint">Hint</button>
            <button id="audioToggleBtn" class="sound-btn" type="button" aria-pressed="true">🔊 Sound On</button>
            <button id="restart" class="restart-btn">Restart</button>
          </div>
        </header>

        <div id="rulesPanel" class="rules-panel hidden" aria-live="polite">
          <h2>How to play</h2>
          <ul>
            <li>Swipe across adjacent tiles to build an arithmetic line.</li>
            <li>Numbers and operators must alternate, and you cannot revisit the same tile.</li>
            <li>Match the target value exactly to win the round.</li>
            <li>A wrong route keeps the board in play; Streak mode also removes 5 seconds.</li>
            <li>Power moves transform your current result, and each numbered hint costs 3 seconds.</li>
          </ul>
        </div>

        <section class="stats">
          <div class="stat-card accent">
            <span class="label">Score</span>
            <strong id="Score">0</strong>
          </div>
          <div class="stat-card">
            <span class="label">Round</span>
            <strong id="Round">1</strong>
          </div>
          <div class="stat-card target-stat">
            <span class="label">Target</span>
            <strong id="Target">0</strong>
          </div>
          <div class="stat-card">
            <span class="label">Combo</span>
            <strong id="Combo">x1</strong>
          </div>
          <div class="stat-card">
            <span class="label">Streak</span>
            <strong id="Streak">0</strong>
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
            <div class="info-card equation-card">
              <h2>Your route</h2>
              <div id="Expression" class="expression-display">—</div>
              <div class="live-result"><span>Value</span><strong id="LiveValue">—</strong></div>
            </div>

            <div class="info-card status-card">
              <h2>Game feed</h2>
              <p id="Status" aria-live="polite">Swipe across the board to build an expression</p>
            </div>

            <div class="info-card bonus-card">
              <div>
                <h2>⚡ Power move</h2>
                <p>Apply it when your route is one transformation away.</p>
              </div>
              <div id="bonusBar" class="bonus-bar"></div>
            </div>

            <div class="round-tip">Hints reveal the route in order and cost 3 seconds.</div>
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
          <button id="modalHomeBtn" class="secondary-btn">Main menu</button>
        </div>
      </div>
    </div>
  `;

  document.querySelector('#playerNameInput').value = state.playerName;

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  document.querySelector('#homeStartBtn').addEventListener('click', startGame);
  document.querySelector('#restart').addEventListener('click', resetGame);
  document.querySelector('#menuBtn').addEventListener('click', returnHome);
  document.querySelector('#modalHomeBtn').addEventListener('click', returnHome);

  document.querySelector('#playAgainBtn').addEventListener('click', () => {
    resetGame();
    hideGameOverModal();
  });

  const homeInstallButton = document.querySelector('#homeInstallBtn');
  if (homeInstallButton) {
    homeInstallButton.addEventListener('click', async () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
      if (isStandalone) {
        homeInstallButton.hidden = true;
        return;
      }

      if (!deferredPrompt) {
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        showToast(
          isIOS ? 'On iPhone: tap Share → Add to Home Screen' : 'Use the browser menu to install this app',
          'info',
        );
        return;
      }

      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      homeInstallButton.hidden = true;
    });
  }

  const hintBtn = document.querySelector('#hintBtn');
  if (hintBtn) {
    hintBtn.addEventListener('click', revealHint);
  }

  const audioButton = document.querySelector('#audioToggleBtn');
  if (audioButton) {
    audioButton.addEventListener('click', () => {
      ensureAudioContext();
      setSoundEnabled(!state.soundEnabled);
    });
    setSoundEnabled(state.soundEnabled);
  }

  const rulesBtn = document.querySelector('#rulesBtn');
  if (rulesBtn) {
    rulesBtn.addEventListener('click', toggleRules);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (homeInstallButton) {
      homeInstallButton.hidden = false;
      homeInstallButton.textContent = 'Install App';
    }
  });

  window.addEventListener('appinstalled', () => {
    if (homeInstallButton) homeInstallButton.hidden = true;
  });

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function init() {
  loadLocalBest();
  buildShell();
  setMode(state.mode);
  setScreen('home');
  startNewBoard();
  updateUI();

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
