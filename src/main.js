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
  isOperatorToken,
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
  unaryUsedThisRound: false,
};

const app = document.querySelector('#app');
const BEST_SCORE_KEY = 'mathsgrid-best-score';
const PLAYER_NAME_KEY = 'mathsgrid-player-name';
const MODE_KEY = 'mathsgrid-mode';
let deferredPrompt = null;

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

function startNewBoard() {
  const boardState = createBoardState(state.mode, state.dailyKey, state.round);
  state.board = boardState.board;
  state.target = boardState.target;
  state.path = [];
  state.set.clear();
  state.lastExpression = '-';
  state.lastValue = null;
  state.statusMessage = 'Select a valid route';
  state.unaryUsedThisRound = false;
  spawnUnaryBonus();
  renderBoard();
  updateUI();
  renderUnaryButtons();
}

function spawnUnaryBonus() {
  if (state.gameEnded) return;

  const options = getUnaryOptions();
  const chosen = options[Math.floor(Math.random() * options.length)];
  state.unaryBonus = { operation: chosen, label: getUnaryLabel(chosen) };

  if (state.unaryTimerId) {
    window.clearTimeout(state.unaryTimerId);
  }

  state.unaryTimerId = window.setTimeout(() => {
    state.unaryBonus = null;
    renderUnaryButtons();
  }, 7000);

  renderUnaryButtons();
}

function renderUnaryButtons() {
  const bonusBar = document.querySelector('#bonusBar');
  if (!bonusBar) return;

  if (!state.unaryBonus) {
    bonusBar.innerHTML = '<span class="bonus-empty">No unary bonus active</span>';
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'unary-btn';
  button.dataset.operation = state.unaryBonus.operation;
  button.textContent = state.unaryBonus.label;
  button.title = `Use ${state.unaryBonus.label} on the current value`;
  button.addEventListener('click', () => applyUnaryToCurrentValue(state.unaryBonus.operation));
  bonusBar.innerHTML = '';
  bonusBar.appendChild(button);
}

function applyUnaryToCurrentValue(operation) {
  if (state.gameEnded) return;
  if (state.lastValue === null || state.lastValue === undefined) {
    state.statusMessage = 'Create a valid number first, then use the bonus.';
    updateUI();
    return;
  }

  const adjusted = applyUnaryBonus(state.lastValue, operation);
  if (adjusted === null) {
    state.statusMessage = 'That unary action is not valid for this value.';
    state.multiplier = 1;
    state.streak = 0;
    flashBoard('invalid');
    updateUI();
    return;
  }

  state.unaryUsedThisRound = true;
  state.lastExpression = `${state.lastValue}${getUnaryLabel(operation)}`;
  const bonusValue = Number(adjusted);
  state.lastValue = bonusValue;

  if (bonusValue === state.target) {
    handleBoardSuccess(true);
    return;
  }

  state.multiplier = 1;
  state.streak = 0;
  state.statusMessage = `${state.lastValue} is not the target — the multiplier reset.`;
  flashBoard('error');
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

function flashBoard(type) {
  const board = document.querySelector('#board');
  if (!board) return;
  board.classList.remove('success', 'error', 'invalid');
  board.classList.add(type);
  window.setTimeout(() => board.classList.remove(type), 420);
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

      tile.addEventListener('pointerenter', () => {
        if (state.dragging && !state.gameEnded) {
          extendDrag(row, col);
        }
      });

      boardEl.appendChild(tile);
    }
  }
}

function beginDrag(row, col) {
  state.dragging = true;
  state.path = [{ row, col }];
  state.set = new Set([`${row},${col}`]);
  state.statusMessage = 'Dragging...';
  updateUI();
  renderBoard();
}

function extendDrag(row, col) {
  const last = state.path[state.path.length - 1];
  const key = `${row},${col}`;

  if (state.set.has(key)) return;

  const rowDelta = Math.abs(row - last.row);
  const colDelta = Math.abs(col - last.col);
  if (rowDelta + colDelta !== 1) return;

  const nextToken = state.board[row][col].value;
  const previousToken = state.board[last.row][last.col].value;
  const nextIsNumber = isNumberToken(nextToken);
  const prevIsNumber = isNumberToken(previousToken);

  if (nextIsNumber === prevIsNumber) {
    state.statusMessage = 'Use alternating numbers and operators';
    updateUI();
    return;
  }

  state.path.push({ row, col });
  state.set.add(key);
  state.statusMessage = 'Selection in progress';
  updateUI();
  renderBoard();
}

function handleBoardSuccess(withUnary = false) {
  state.streak += 1;
  const baseScore = state.mode === MODES.streak ? 18 : 10;
  const multiplierBoost = withUnary ? 2 : 1;
  const nextMultiplier = Math.max(1, state.multiplier + 1) * multiplierBoost;
  state.multiplier = nextMultiplier;
  state.score += baseScore * state.multiplier;
  state.bestScore = Math.max(state.bestScore, state.score);
  saveLocalBest();
  state.round += 1;
  state.statusMessage = withUnary
    ? `Bonus! ${state.lastExpression} = ${state.target} • x${state.multiplier} combo`
    : `Perfect! ${state.lastExpression} = ${state.target} • x${state.multiplier} combo`;
  flashBoard('success');
  window.setTimeout(() => {
    state.timeLeft = Math.min(ROUND_TIME, state.timeLeft + 4);
    startNewBoard();
  }, 450);
}

function endDrag() {
  if (!state.dragging || state.gameEnded) return;

  const expression = state.path.map(({ row, col }) => state.board[row][col].value).join('');
  const tokens = expression.split('');
  state.lastExpression = expression;

  if (!isAlternatingExpressionTokens(tokens)) {
    state.statusMessage = 'That route is not valid — numbers and operators must alternate';
    flashBoard('invalid');
  } else {
    const value = safeEvaluate(expression);

    if (value === null || expression.length < 3) {
      state.statusMessage = 'That route is not valid';
      flashBoard('invalid');
    } else {
      state.lastValue = Number(value);
      if (state.lastValue === state.target) {
        handleBoardSuccess(false);
      } else {
        state.streak = 0;
        state.multiplier = 1;
        state.statusMessage = `Current value ${state.lastValue} is close, but target is ${state.target}. Use a bonus if it appears.`;
        flashBoard('error');
      }
    }
  }

  state.dragging = false;
  state.path = [];
  state.set.clear();
  updateUI();
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

  if (!scoreEl || !bestEl || !roundEl || !targetEl || !timerEl || !comboEl || !statusEl || !expressionEl) return;

  scoreEl.textContent = state.score;
  bestEl.textContent = state.bestScore;
  roundEl.textContent = state.round;
  targetEl.textContent = state.target;
  timerEl.textContent = `${Math.ceil(state.timeLeft)}s`;
  comboEl.textContent = `x${state.multiplier}`;
  statusEl.textContent = state.statusMessage;
  expressionEl.textContent = state.lastExpression;
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
    document.querySelector('#nameError').textContent = 'Please enter a player name.';
    return;
  }

  state.playerName = nameValue;
  localStorage.setItem(PLAYER_NAME_KEY, nameValue);
  document.querySelector('#nameModal').classList.add('hidden');
  state.score = 0;
  state.streak = 0;
  state.round = 1;
  state.timeLeft = ROUND_TIME;
  state.gameEnded = false;
  state.hasStarted = true;
  state.multiplier = 1;
  state.dailyKey = getDailyKey();
  startNewBoard();
  if (!state.timerId) startTimer();
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
  state.statusMessage = 'Select a valid route';
  startNewBoard();
  hideGameOverModal();
  if (!state.timerId) startTimer();
}

function buildShell() {
  app.innerHTML = `
    <div class="shell">
      <div class="panel">
        <header class="topbar">
          <div>
            <p class="eyebrow">Target number puzzle</p>
            <h1>MathsGrid</h1>
          </div>
          <div class="header-actions">
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
            <div id="startOverlay" class="start-overlay visible">
              <div class="overlay-card">
                <p class="eyebrow">Math challenge</p>
                <h2>Hit the target value</h2>
                <p>Drag across adjacent tiles and build a valid arithmetic line.</p>
                <button id="startBtn" class="primary-btn">Play</button>
              </div>
            </div>
          </div>
          <aside class="side-panel">
            <div class="info-card">
              <h2>Rules</h2>
              <p>Drag across adjacent tiles to form a valid expression.</p>
              <p>Numbers and operators must alternate, and a line cannot pass through two operators in a row.</p>
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
              <p id="Status">Select a valid route</p>
            </div>
            <div class="info-card">
              <h2>High scores</h2>
              <ul id="leaderboardList" class="leaderboard-list"></ul>
            </div>
          </aside>
        </section>
      </div>
    </div>

    <div id="nameModal" class="modal">
      <div class="modal-card">
        <p class="eyebrow">Welcome</p>
        <h2>Enter your player name</h2>
        <label class="field-wrap">
          <span>Player name</span>
          <input id="playerNameInput" maxlength="18" value="${state.playerName}" />
        </label>
        <p id="nameError" class="field-error"></p>
        <button id="nameSubmitBtn" class="primary-btn">Start</button>
      </div>
    </div>

    <div id="gameOverModal" class="modal hidden">
      <div class="modal-card">
        <p class="eyebrow">Round over</p>
        <h2>Game over</h2>
        <p id="gameOverSummary"></p>
        <div class="modal-actions">
          <button id="playAgainBtn" class="primary-btn">Play again</button>
          <button id="changeNameBtn" class="secondary-btn">Change name</button>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  document.querySelector('#restart').addEventListener('click', () => {
    resetGame();
  });

  document.querySelector('#startBtn').addEventListener('click', () => {
    state.hasStarted = true;
    state.gameEnded = false;
      document.querySelector('#startOverlay').classList.remove('visible');
    state.statusMessage = 'Round live — make your move';
    state.hasStarted = true;
    if (!state.timerId) startTimer();
    updateUI();
  });

  document.querySelector('#nameSubmitBtn').addEventListener('click', startGame);
  document.querySelector('#playAgainBtn').addEventListener('click', () => {
    resetGame();
    hideGameOverModal();
  });
  document.querySelector('#changeNameBtn').addEventListener('click', () => {
    document.querySelector('#nameModal').classList.remove('hidden');
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
  const nameModal = document.querySelector('#nameModal');
  if (nameModal) nameModal.classList.remove('hidden');
  startNewBoard();
  updateUI();
  renderLeaderboard();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  }
}

init();
