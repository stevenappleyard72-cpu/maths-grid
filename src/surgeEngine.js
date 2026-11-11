// Pure rules for SUM SURGE. Nothing here depends on the DOM or a running clock.
export const GRID_SIZE = 5;
export const BOARD_SIZE = GRID_SIZE * GRID_SIZE;
export const ROUND_TIME = 90;
export const MIN_PATH_LENGTH = 2;
export const TARGET_MIN = 10;
export const TARGET_MAX = 24;

const MAX_HINT_LENGTH = 6;
const SEARCH_BUDGET = 7000;

export function createRng(seed) {
  const source = String(seed ?? 'sum-surge');
  let value = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    value = Math.imul(value ^ source.charCodeAt(i), 16777619);
  }
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, rng) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const swap = Math.floor(rng() * (i + 1));
    [result[i], result[swap]] = [result[swap], result[i]];
  }
  return result;
}

function newTile(id, rng) {
  return { id, value: 1 + Math.floor(rng() * 9), charged: rng() < 0.09 };
}

function isBoard(board) {
  return Array.isArray(board) && board.length === BOARD_SIZE && board.every(
    (tile) => tile && Number.isInteger(tile.value) && tile.value >= 1 && tile.value <= 9,
  );
}

function requireBoard(board) {
  if (!isBoard(board)) throw new TypeError('A board must contain 25 number tiles with values from 1 to 9.');
}

export function createBoard(rng = Math.random) {
  const board = Array.from({ length: BOARD_SIZE }, (_, id) => newTile(id, rng));
  // A charged tile makes the scoring opportunity visible from the first move.
  if (!board.some((tile) => tile.charged)) board[Math.floor(rng() * BOARD_SIZE)].charged = true;
  return board;
}

export function isAdjacent(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= BOARD_SIZE || b >= BOARD_SIZE || a === b) return false;
  return Math.abs(Math.floor(a / GRID_SIZE) - Math.floor(b / GRID_SIZE)) <= 1
    && Math.abs((a % GRID_SIZE) - (b % GRID_SIZE)) <= 1;
}

const NEIGHBORS = Array.from({ length: BOARD_SIZE }, (_, index) => (
  Array.from({ length: BOARD_SIZE }, (_, neighbor) => neighbor).filter((neighbor) => isAdjacent(index, neighbor))
));

export function getPathSum(board, path) {
  if (!Array.isArray(path) || !Array.isArray(board)) return null;
  if (path.some((index) => !Number.isInteger(index) || index < 0 || index >= board.length || !board[index])) return null;
  return path.reduce((sum, index) => sum + board[index].value, 0);
}

export function validatePath(board, path, target) {
  if (!isBoard(board) || !Array.isArray(path) || path.length < MIN_PATH_LENGTH || path.length > BOARD_SIZE) return false;
  if (new Set(path).size !== path.length) return false;
  if (path.some((index, step) => !Number.isInteger(index) || index < 0 || index >= BOARD_SIZE || (step > 0 && !isAdjacent(path[step - 1], index)))) return false;
  return getPathSum(board, path) === target;
}

export function findTargets(board, rng = Math.random) {
  requireBoard(board);
  const routes = new Map();
  const starts = shuffled(Array.from({ length: BOARD_SIZE }, (_, i) => i), rng);
  const neighbors = NEIGHBORS.map((list) => shuffled(list, rng));
  let visits = 0;

  // Sharing a budget across starts keeps offer generation cheap on every clear.
  const perStart = Math.floor(SEARCH_BUDGET / BOARD_SIZE);
  for (let step = 0; step < starts.length; step += 1) {
    const start = starts[step];
    const before = visits;
    // Explore one start at a time with a fair share of the total budget.
    const stopAt = Math.min(SEARCH_BUDGET, before + perStart);
    const stack = [{ path: [start], sum: board[start].value, used: 1 << start }];
    while (stack.length && visits < stopAt) {
      const item = stack.pop();
      visits += 1;
      if (item.path.length >= MIN_PATH_LENGTH) {
        const previous = routes.get(item.sum);
        if (!previous || item.path.length < previous.length) routes.set(item.sum, item.path);
      }
      if (item.path.length >= MAX_HINT_LENGTH) continue;
      for (const next of neighbors[item.path[item.path.length - 1]]) {
        const bit = 1 << next;
        if (item.used & bit) continue;
        const sum = item.sum + board[next].value;
        // Keep the first full branch so even an all-nines board has offers.
        if (sum > TARGET_MAX && routes.size >= 5) continue;
        stack.push({ path: [...item.path, next], sum, used: item.used | bit });
      }
    }
  }

  const preferred = shuffled([...routes.keys()].filter((sum) => sum >= TARGET_MIN && sum <= TARGET_MAX), rng);
  const values = [];
  // Spread the offers so selecting a different target is a meaningful choice.
  for (const [min, max] of [[10, 14], [15, 19], [20, 24]]) {
    const candidate = preferred.find((sum) => sum >= min && sum <= max);
    if (candidate !== undefined) values.push(candidate);
  }
  for (const sum of [...preferred, ...shuffled([...routes.keys()], rng)]) {
    if (values.length === 3) break;
    if (!values.includes(sum)) values.push(sum);
  }
  return values.sort((a, b) => a - b).map((value) => ({ value, path: [...routes.get(value)] }));
}

export function collapseBoard(board, indices, rng = Math.random) {
  requireBoard(board);
  if (!Array.isArray(indices) || indices.some((index) => !Number.isInteger(index) || index < 0 || index >= BOARD_SIZE)) {
    throw new TypeError('Cleared cells must be valid board indices.');
  }
  const cleared = new Set(indices);
  const result = new Array(BOARD_SIZE);
  let nextId = Math.max(-1, ...board.map((tile) => Number.isInteger(tile.id) ? tile.id : -1)) + 1;
  for (let col = 0; col < GRID_SIZE; col += 1) {
    const survivors = [];
    for (let row = 0; row < GRID_SIZE; row += 1) {
      const index = row * GRID_SIZE + col;
      if (!cleared.has(index)) survivors.push({ ...board[index] });
    }
    const missing = GRID_SIZE - survivors.length;
    const column = [...Array.from({ length: missing }, () => newTile(nextId++, rng)), ...survivors];
    for (let row = 0; row < GRID_SIZE; row += 1) result[row * GRID_SIZE + col] = column[row];
  }
  return result;
}

export function scorePath(board, path, { combo = 1, surge = false } = {}) {
  const sum = getPathSum(board, path);
  if (!validatePath(board, path, sum)) return 0;
  const lengthBonus = Math.max(0, path.length - 2) ** 2 * 15;
  const chargedBonus = path.reduce((count, index) => count + (board[index].charged ? 60 : 0), 0);
  const multiplier = Number.isFinite(combo) ? Math.max(1, Math.min(5, Math.floor(combo))) : 1;
  return (sum * 5 + lengthBonus + chargedBonus) * multiplier * (surge ? 2 : 1);
}

export function shuffleBoard(board, rng = Math.random) {
  requireBoard(board);
  return shuffled(board, rng).map((tile) => ({ ...tile }));
}
