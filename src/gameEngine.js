export const GRID_SIZE = 5;
export const ROUND_TIME = 60;
export const MODES = {
  normal: 'normal',
  streak: 'streak',
  daily: 'daily',
};

function randomFrom(items, randomFn = Math.random) {
  return items[Math.floor(randomFn() * items.length)];
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function createSeededRandom(seedValue) {
  let seed = seedValue % 2147483647;
  if (seed <= 0) seed += 2147483646;
  return function next() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export function getDailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function getModeLabel(mode) {
  return {
    [MODES.normal]: 'Normal',
    [MODES.streak]: 'Streak',
    [MODES.daily]: 'Daily',
  }[mode] || 'Normal';
}

export function isNumberToken(value) {
  return /^\d$/.test(String(value));
}

export function isOperatorToken(value) {
  return ['+', '-', '*', '/'].includes(String(value));
}

export function safeEvaluate(expression) {
  if (!expression || expression.length < 3) return null;

  const cleaned = expression.replace(/\s+/g, '');
  if (!/^[0-9+\-*/]+$/.test(cleaned)) return null;

  try {
    const value = Function(`"use strict"; return (${cleaned});`)();
    if (!Number.isFinite(value)) return null;
    return Math.round(Number(value));
  } catch {
    return null;
  }
}

export function isAlternatingExpressionTokens(tokens) {
  if (!tokens || tokens.length < 3) return false;
  if (!isNumberToken(tokens[0]) || !isNumberToken(tokens[tokens.length - 1])) return false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const expectedNumber = index % 2 === 0;
    if (expectedNumber && !isNumberToken(token)) return false;
    if (!expectedNumber && !isOperatorToken(token)) return false;
  }

  return true;
}

export function getDifficultyProfile(round, mode = MODES.normal) {
  const roundBoost = Math.max(0, round - 1) * 6;
  const modeBoost = mode === MODES.streak ? 8 : mode === MODES.daily ? 4 : 0;
  const pathLength = Math.min(6, 3 + Math.floor((round - 1) / 3) + (mode === MODES.streak ? 1 : 0));
  const maxTarget = Math.min(65, 10 + roundBoost + modeBoost + ((pathLength - 3) * 4));

  return {
    pathLength,
    minTarget: 3,
    maxTarget,
  };
}

export function getUnaryOptions() {
  return ['square', 'sqrt', 'negate'];
}

export function applyUnaryBonus(value, operation) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;

  switch (operation) {
    case 'square':
      return numericValue * numericValue;
    case 'sqrt':
      return Number.isInteger(Math.sqrt(numericValue)) ? Math.sqrt(numericValue) : null;
    case 'negate':
      return -numericValue;
    default:
      return null;
  }
}

export function getUnaryLabel(operation) {
  return {
    square: 'x²',
    sqrt: '√',
    negate: '±',
  }[operation] || 'x²';
}

function getNeighbors(row, col) {
  return [
    { row: row - 1, col },
    { row: row + 1, col },
    { row, col: col - 1 },
    { row, col: col + 1 },
  ].filter((cell) => cell.row >= 0 && cell.row < GRID_SIZE && cell.col >= 0 && cell.col < GRID_SIZE);
}

function getCellType(row, col) {
  return (row + col) % 2 === 0 ? 'number' : 'operator';
}

function buildPath(length, randomFn = Math.random) {
  const visited = new Set();
  const startCandidates = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const cellType = getCellType(row, col);
      if (cellType === 'number') {
        startCandidates.push({ row, col });
      }
    }
  }

  if (!startCandidates.length) {
    return null;
  }

  const start = randomFrom(startCandidates, randomFn);
  const path = [start];
  visited.add(`${start.row},${start.col}`);
  let current = start;

  while (path.length < length) {
    const neighbors = getNeighbors(current.row, current.col).filter((cell) => {
      const key = `${cell.row},${cell.col}`;
      return !visited.has(key) && getCellType(cell.row, cell.col) !== getCellType(current.row, current.col);
    });

    if (!neighbors.length) {
      return null;
    }

    const next = randomFrom(neighbors, randomFn);
    path.push(next);
    visited.add(`${next.row},${next.col}`);
    current = next;
  }

  return path;
}

function generateExpressionForSeed(randomFn = Math.random, requiredLength = 5, minTarget = 12, maxTarget = 225) {
  const ops = ['+', '-', '*', '/'];
  const earlyFriendlyOps = ['+', '-'];
  const mediumOps = ['+', '-', '*'];

  for (let attempt = 0; attempt < 500; attempt += 1) {
    let expression = '';
    let seedNumber = 1 + Math.floor(randomFn() * (requiredLength <= 4 ? 5 : 7));
    expression += String(seedNumber);

    for (let index = 1; index < requiredLength; index += 1) {
      const allowedOps = requiredLength <= 4 ? earlyFriendlyOps : requiredLength <= 5 ? mediumOps : ops;
      const nextOperator = randomFrom(allowedOps, randomFn);
      const maxOperand = requiredLength <= 4 ? 5 : requiredLength <= 5 ? 7 : 9;
      let nextNumber = 1 + Math.floor(randomFn() * maxOperand);
      if (nextOperator === '/' && nextNumber === 0) {
        nextNumber = 1;
      }
      expression += `${nextOperator}${nextNumber}`;
    }

    if (!isAlternatingExpressionTokens(expression.split(''))) continue;

    const value = safeEvaluate(expression);
    if (value !== null && value >= minTarget && value <= maxTarget) {
      const unaryOptions = getUnaryOptions();
      const unaryBonus = randomFn() < 0.18 ? (() => {
        const chosen = randomFrom(unaryOptions, randomFn);
        return { operation: chosen, label: getUnaryLabel(chosen) };
      })() : null;
      return {
        expression,
        target: value,
        unaryBonus,
      };
    }
  }

  const fallbackExpression = requiredLength <= 4 ? '4+3+2' : '6+5+4';
  const fallbackTarget = safeEvaluate(fallbackExpression) || 9;
  return {
    expression: fallbackExpression,
    target: fallbackTarget,
    unaryBonus: null,
  };
}

export function createBoardState(mode = MODES.normal, dateKey = getDailyKey(), round = 1) {
  const seededValue = hashString(`${mode}:${dateKey}:${round}`);
  const randomFn = createSeededRandom(seededValue + Math.floor(Math.random() * 1000));
  const difficulty = getDifficultyProfile(round, mode);
  const path = buildPath(difficulty.pathLength, randomFn);

  if (!path) {
    return { board: [], target: 20, pathLength: difficulty.pathLength };
  }

  const { expression, target, unaryBonus } = generateExpressionForSeed(
    randomFn,
    difficulty.pathLength,
    difficulty.minTarget,
    difficulty.maxTarget,
  );
  const board = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
  const tokenValues = expression.split('');

  for (let i = 0; i < path.length; i += 1) {
    const cell = path[i];
    const tokenValue = tokenValues[i];
    const expectedType = isNumberToken(tokenValue) ? 'number' : 'operator';
    board[cell.row][cell.col] = {
      value: tokenValue,
      type: expectedType,
    };
  }

  const fillerNumbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const fillerOperators = ['+', '-', '*', '/'];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      if (board[row][col]) continue;
      const expectedType = getCellType(row, col);
      const fillerPool = expectedType === 'number' ? fillerNumbers : fillerOperators;
      const fillerValue = String(randomFrom(fillerPool, randomFn));
      board[row][col] = {
        value: fillerValue,
        type: expectedType,
      };
    }
  }

  return {
    board,
    target,
    expression,
    dailyKey: dateKey,
    pathLength: difficulty.pathLength,
    unaryBonus,
    path: path.map(({ row, col }) => ({ row, col })),
  };
}
