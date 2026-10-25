import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRID_SIZE,
  MODES,
  applyUnaryBonus,
  createBoardState,
  getDailyKey,
  getDifficultyProfile,
  getModeLabel,
  getUnaryLabel,
  isAlternatingExpressionTokens,
  isNumberToken,
  isOperatorToken,
  isSimplePath,
  safeEvaluate,
} from '../src/gameEngine.js';

test('token helpers distinguish numbers from supported operators', () => {
  assert.equal(isNumberToken('0'), true);
  assert.equal(isNumberToken('9'), true);
  assert.equal(isNumberToken('10'), false);
  assert.equal(isNumberToken('+'), false);

  for (const operator of ['+', '-', '*', '/']) {
    assert.equal(isOperatorToken(operator), true);
  }
  assert.equal(isOperatorToken('x'), false);
});

test('expression validation requires alternating single-digit tokens', () => {
  assert.equal(isAlternatingExpressionTokens(['4', '+', '3']), true);
  assert.equal(isAlternatingExpressionTokens(['8', '/', '2', '-', '1']), true);
  assert.equal(isAlternatingExpressionTokens(['4', '3']), false);
  assert.equal(isAlternatingExpressionTokens(['+', '4', '-', '2']), false);
  assert.equal(isAlternatingExpressionTokens(['4', '+']), false);
  assert.equal(isAlternatingExpressionTokens(['4', '+', '*', '2']), false);
});

test('safeEvaluate handles valid integer expressions and rejects unsafe input', () => {
  assert.equal(safeEvaluate('4+3*2'), 10);
  assert.equal(safeEvaluate(' 8 / 4 + 3 '), 5);
  assert.equal(safeEvaluate('2+'), null);
  assert.equal(safeEvaluate('2**3'), null);
  assert.equal(safeEvaluate('alert(1)'), null);
  assert.equal(safeEvaluate('1/0'), null);
});

test('unary bonuses apply only when mathematically valid', () => {
  assert.equal(applyUnaryBonus(5, 'square'), 25);
  assert.equal(applyUnaryBonus(25, 'sqrt'), 5);
  assert.equal(applyUnaryBonus(10, 'sqrt'), null);
  assert.equal(applyUnaryBonus(-3, 'negate'), 3);
  assert.equal(applyUnaryBonus(3, 'unknown'), null);

  assert.equal(getUnaryLabel('square'), 'x²');
  assert.equal(getUnaryLabel('sqrt'), '√');
  assert.equal(getUnaryLabel('negate'), '±');
});

test('simple paths cannot revisit a cell', () => {
  assert.equal(isSimplePath([{ row: 0, col: 0 }, { row: 0, col: 1 }]), true);
  assert.equal(isSimplePath([{ row: 0, col: 0 }, { row: 0, col: 0 }]), false);
  assert.equal(isSimplePath([]), false);
  assert.equal(isSimplePath([{ row: 0 }]), false);
});

test('difficulty progression preserves odd expression lengths and target bounds', () => {
  assert.deepEqual(getDifficultyProfile(1, MODES.normal), {
    pathLength: 3,
    minTarget: 3,
    maxTarget: 10,
  });
  assert.deepEqual(getDifficultyProfile(7, MODES.normal), {
    pathLength: 7,
    minTarget: 3,
    maxTarget: 62,
  });
  assert.equal(getDifficultyProfile(19, MODES.normal).pathLength, 9);
  assert.equal(getDifficultyProfile(50, MODES.normal).maxTarget, 65);
  assert.equal(getDifficultyProfile(4, MODES.streak).pathLength, 7);
});

test('labels and daily keys are stable for known inputs', () => {
  assert.equal(getModeLabel(MODES.normal), 'Normal');
  assert.equal(getModeLabel(MODES.streak), 'Streak');
  assert.equal(getModeLabel(MODES.daily), 'Daily');
  assert.equal(getModeLabel('unknown'), 'Normal');
  assert.equal(getDailyKey(new Date('2026-10-25T12:00:00.000Z')), '2026-10-25');
});

test('generated boards contain a valid, adjacent solution path', () => {
  const cases = [
    { mode: MODES.normal, round: 1 },
    { mode: MODES.normal, round: 7 },
    { mode: MODES.normal, round: 19 },
    { mode: MODES.streak, round: 4 },
    { mode: MODES.daily, round: 10 },
  ];

  for (const { mode, round } of cases) {
    const profile = getDifficultyProfile(round, mode);

    // Multiple generations exercise random path placement and filler values.
    for (let sample = 0; sample < 25; sample += 1) {
      const result = createBoardState(mode, '2026-10-25', round);

      assert.equal(result.board.length, GRID_SIZE);
      assert.equal(result.path.length, profile.pathLength);
      assert.equal(result.expression.length, profile.pathLength);
      assert.equal(isSimplePath(result.path), true);
      assert.equal(isAlternatingExpressionTokens(result.expression.split('')), true);
      assert.equal(safeEvaluate(result.expression), result.target);
      assert.ok(result.target >= profile.minTarget);
      assert.ok(result.target <= profile.maxTarget);

      for (let row = 0; row < GRID_SIZE; row += 1) {
        assert.equal(result.board[row].length, GRID_SIZE);
        for (let col = 0; col < GRID_SIZE; col += 1) {
          const cell = result.board[row][col];
          assert.ok(cell, `expected a cell at ${row},${col}`);
          const expectedType = (row + col) % 2 === 0 ? 'number' : 'operator';
          assert.equal(cell.type, expectedType);
        }
      }

      for (let index = 1; index < result.path.length; index += 1) {
        const previous = result.path[index - 1];
        const current = result.path[index];
        const distance = Math.abs(previous.row - current.row) + Math.abs(previous.col - current.col);
        assert.equal(distance, 1, 'solution steps must be orthogonally adjacent');
      }

      const pathExpression = result.path
        .map(({ row, col }) => result.board[row][col].value)
        .join('');
      assert.equal(pathExpression, result.expression);
    }
  }
});

test('Daily mode generates the same board for a given date and round', () => {
  const first = createBoardState(MODES.daily, '2026-10-25', 12);
  const second = createBoardState(MODES.daily, '2026-10-25', 12);
  assert.deepEqual(second, first);
});

test('generated division expressions always have exact integer targets', () => {
  for (let sample = 0; sample < 250; sample += 1) {
    const result = createBoardState(MODES.normal, '2026-10-25', 19);
    assert.equal(Number.isInteger(safeEvaluate(result.expression)), true);
    assert.equal(safeEvaluate(result.expression), result.target);
  }
});

test('every third round guarantees a route solved by its unary power move', () => {
  for (const mode of Object.values(MODES)) {
    for (const round of [3, 6, 9]) {
      for (let sample = 0; sample < 40; sample += 1) {
        const result = createBoardState(mode, '2026-10-25', round);
        const routeValue = safeEvaluate(result.expression);
        const boardRoute = result.path
          .map(({ row, col }) => result.board[row][col].value)
          .join('');

        assert.equal(result.isPowerRound, true);
        assert.ok(result.unaryBonus);
        assert.equal(boardRoute, result.expression);
        assert.equal(routeValue, result.sourceValue);
        assert.notEqual(routeValue, result.target);
        assert.equal(
          applyUnaryBonus(routeValue, result.unaryBonus.operation),
          result.target,
          `${result.expression} followed by ${result.unaryBonus.operation} should hit ${result.target}`,
        );
      }
    }
  }
});

test('ordinary rounds use direct solutions and do not display a unary move', () => {
  for (const round of [1, 2, 4, 5, 7, 8]) {
    const result = createBoardState(MODES.normal, '2026-10-25', round);
    assert.equal(result.isPowerRound, false);
    assert.equal(result.unaryBonus, null);
    assert.equal(safeEvaluate(result.expression), result.target);
  }
});
