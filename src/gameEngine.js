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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  if (!isAlternatingExpressionTokens(cleaned.split(''))) return null;

  try {
    const value = Function(`"use strict"; return (${cleaned});`)();
    if (!Number.isFinite(value)) return null;
    return Number(value);
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

export function isSimplePath(path) {
  if (!Array.isArray(path) || !path.length) return false;

  const seen = new Set();
  for (const cell of path) {
    if (!cell || typeof cell.row !== 'number' || typeof cell.col !== 'number') return false;
    const key = `${cell.row},${cell.col}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }

  return true;
}

export function getDifficultyProfile(round, mode = MODES.normal) {
  const roundBoost = Math.max(0, round - 1) * 6;
  const modeBoost = mode === MODES.streak ? 8 : mode === MODES.daily ? 4 : 0;
  let pathLength = round <= 2 ? 3 : round <= 5 ? 5 : round <= 8 ? 7 : 9;
  if (mode === MODES.streak) pathLength = Math.min(9, pathLength + 2);
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

function chooseUnaryBonus(targetValue, randomFn = Math.random) {
  const positiveTarget = Number(targetValue);
  if (!Number.isFinite(positiveTarget)) return null;

  const squareRoot = Math.sqrt(positiveTarget);
  const isSquareTarget = Number.isInteger(squareRoot) && squareRoot > 0;

  if (isSquareTarget && randomFn() < 0.6) {
    return {
      operation: 'square',
      label: getUnaryLabel('square'),
    };
  }

  if (positiveTarget <= 40 && randomFn() < 0.45) {
    return {
      operation: 'sqrt',
      label: getUnaryLabel('sqrt'),
    };
  }

  if (randomFn() < 0.3) {
    return {
      operation: 'negate',
      label: getUnaryLabel('negate'),
    };
  }

  return null;
}

function generateExpressionForSeed(randomFn = Math.random, requiredLength = 5, minTarget = 12, maxTarget = 225) {
  const ops = ['+', '-', '*', '/'];
  const earlyFriendlyOps = ['+', '-'];
  const mediumOps = ['+', '-', '*'];
  const safeLength = Math.max(3, Number(requiredLength) || 3);
  const targetTokenCount = safeLength % 2 === 0 ? safeLength - 1 : safeLength;

  for (let attempt = 0; attempt < 500; attempt += 1) {
    let expression = '';
    let seedNumber = 1 + Math.floor(randomFn() * (targetTokenCount <= 5 ? 5 : 7));
    expression += String(seedNumber);

    const pairCount = (targetTokenCount - 1) / 2;
    for (let index = 0; index < pairCount; index += 1) {
      const allowedOps = targetTokenCount <= 5 ? earlyFriendlyOps : targetTokenCount <= 7 ? mediumOps : ops;
      const nextOperator = randomFrom(allowedOps, randomFn);
      const maxOperand = targetTokenCount <= 5 ? 5 : targetTokenCount <= 7 ? 7 : 9;
      let nextNumber = 1 + Math.floor(randomFn() * maxOperand);
      if (nextOperator === '/' && nextNumber === 0) {
        nextNumber = 1;
      }
      expression += `${nextOperator}${nextNumber}`;
    }

    if (!isAlternatingExpressionTokens(expression.split(''))) continue;

    const value = safeEvaluate(expression);
    if (value !== null && Number.isInteger(value) && value >= minTarget && value <= maxTarget) {
      const unaryBonus = randomFn() < 0.45 ? chooseUnaryBonus(value, randomFn) : null;
      return {
        expression,
        target: value,
        unaryBonus,
      };
    }
  }

  const fallbackExpression = targetTokenCount <= 5 ? '3+2' : targetTokenCount <= 7 ? '5-2+1' : '6+5-2+1';
  const fallbackTarget = safeEvaluate(fallbackExpression) || 9;
  return {
    expression: fallbackExpression,
    target: fallbackTarget,
    unaryBonus: chooseUnaryBonus(fallbackTarget, randomFn),
  };
}

export function createBoardState(mode = MODES.normal, dateKey = getDailyKey(), round = 1) {
  const difficulty = getDifficultyProfile(round, mode);

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const seededValue = hashString(`${mode}:${dateKey}:${round}:${attempt}`);
    const randomOffset = mode === MODES.daily ? 0 : Math.floor(Math.random() * 1000000);
    const randomFn = createSeededRandom(seededValue + randomOffset);
    const path = buildPath(difficulty.pathLength, randomFn);

    if (!path || path.length !== difficulty.pathLength || !isSimplePath(path)) {
      continue;
    }

    const { expression, target, unaryBonus } = generateExpressionForSeed(
      randomFn,
      difficulty.pathLength,
      difficulty.minTarget,
      difficulty.maxTarget,
    );

    if (expression.split('').length !== path.length) {
      continue;
    }

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

    const pathExpression = path.map(({ row, col }) => board[row][col].value).join('');
    if (!isSimplePath(path) || !isAlternatingExpressionTokens(pathExpression.split('')) || pathExpression !== expression) {
      continue;
    }

    const evaluatedTarget = safeEvaluate(pathExpression);
    if (evaluatedTarget === null || Number(evaluatedTarget) !== Number(target)) {
      continue;
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

  const fallbackLength = difficulty.pathLength;
  const fallbackExpression = fallbackLength <= 3
    ? '3+2'
    : fallbackLength <= 5
      ? '5-2+1'
      : fallbackLength <= 7
        ? '6+5-2+1'
        : '6+5-2+1+3';
  const fallbackTarget = safeEvaluate(fallbackExpression) || 5;
  const fallbackPath = buildPath(fallbackLength, createSeededRandom(hashString(`${mode}:${dateKey}:${round}:fallback`)));
  const fallbackBoard = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));

  if (fallbackPath && fallbackPath.length === fallbackExpression.length) {
    for (let i = 0; i < fallbackPath.length; i += 1) {
      const cell = fallbackPath[i];
      fallbackBoard[cell.row][cell.col] = {
        value: fallbackExpression[i],
        type: isNumberToken(fallbackExpression[i]) ? 'number' : 'operator',
      };
    }
  }

  const fallbackRandom = createSeededRandom(hashString(`${mode}:${dateKey}:${round}:fill`));
  const fillerNumbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const fillerOperators = ['+', '-', '*', '/'];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      if (fallbackBoard[row][col]) continue;
      const expectedType = getCellType(row, col);
      const fillerPool = expectedType === 'number' ? fillerNumbers : fillerOperators;
      fallbackBoard[row][col] = {
        value: String(randomFrom(fillerPool, fallbackRandom)),
        type: expectedType,
      };
    }
  }

  return {
    board: fallbackBoard,
    target: fallbackTarget,
    expression: fallbackExpression,
    dailyKey: dateKey,
    pathLength: fallbackLength,
    unaryBonus: null,
    path: (fallbackPath || []).map(({ row, col }) => ({ row, col })),
  };
}
