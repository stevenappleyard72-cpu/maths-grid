import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE, GRID_SIZE, createRng, createBoard, findTargets, collapseBoard,
  isAdjacent, getPathSum, validatePath, scorePath, shuffleBoard,
} from '../src/surgeEngine.js';

test('a daily seed reproduces the whole run, including refills and offers', () => {
  function run(seed) {
    const rng = createRng(seed);
    let board = createBoard(rng);
    const turns = [];
    for (let i = 0; i < 8; i += 1) {
      const offers = findTargets(board, rng);
      turns.push({ board, offers });
      board = collapseBoard(board, offers[i % offers.length].path, rng);
    }
    return turns;
  }
  assert.deepEqual(run('2026-11-11'), run('2026-11-11'));
  assert.notDeepEqual(run('2026-11-11')[0].board, run('2026-11-12')[0].board);
});

test('generated and refilled boards offer three genuinely solvable, distinct targets', () => {
  for (let seed = 0; seed < 50; seed += 1) {
    const rng = createRng(seed);
    let board = createBoard(rng);
    assert.equal(board.length, BOARD_SIZE);
    assert.ok(board.some((tile) => tile.charged));
    for (let turn = 0; turn < 4; turn += 1) {
      assert.equal(new Set(board.map((tile) => tile.id)).size, BOARD_SIZE);
      const targets = findTargets(board, rng);
      assert.equal(targets.length, 3);
      assert.equal(new Set(targets.map((target) => target.value)).size, 3);
      for (const target of targets) {
        assert.equal(validatePath(board, target.path, target.value), true);
        assert.ok(target.value >= 10 && target.value <= 24);
        assert.ok(target.path.length >= 2 && target.path.length <= 6);
      }
      board = collapseBoard(board, targets[turn % 3].path, rng);
      assert.ok(board.every((tile) => tile.value >= 1 && tile.value <= 9));
    }
  }
});

test('unusual uniform boards still receive three valid targets', () => {
  for (const value of [1, 9]) {
    const board = Array.from({ length: BOARD_SIZE }, (_, id) => ({ id, value, charged: false }));
    const targets = findTargets(board, createRng(value));
    assert.equal(targets.length, 3);
    for (const target of targets) assert.ok(validatePath(board, target.path, target.value));
  }
});

test('adjacency includes diagonals and rejects wrapping between rows', () => {
  assert.equal(isAdjacent(0, 1), true);
  assert.equal(isAdjacent(0, 6), true);
  assert.equal(isAdjacent(4, 5), false);
  assert.equal(isAdjacent(0, 2), false);
  assert.equal(isAdjacent(0, 0), false);
  assert.equal(isAdjacent(-1, 0), false);
  assert.equal(isAdjacent(24, 25), false);
  assert.equal(isAdjacent(0.5, 1), false);
});

test('validation rejects reused tiles, jumps, wrong sums, and malformed indices', () => {
  const board = Array.from({ length: BOARD_SIZE }, (_, id) => ({ id, value: 2, charged: false }));
  assert.equal(validatePath(board, [0, 6, 12], 6), true);
  assert.equal(validatePath(board, [0, 6, 12], 7), false);
  assert.equal(validatePath(board, [0, 1, 0], 6), false);
  assert.equal(validatePath(board, [0, 2], 4), false);
  assert.equal(validatePath(board, [4, 5], 4), false);
  assert.equal(validatePath(board, [0], 2), false);
  assert.equal(validatePath(board, [0, 25], 4), false);
  assert.equal(validatePath(board, [0, '1'], 4), false);
  assert.equal(getPathSum(board, []), 0);
  assert.equal(getPathSum(board, [0, 6, 12]), 6);
  assert.equal(getPathSum(board, [25]), null);
});

test('gravity preserves survivor order, unaffected columns, and original board', () => {
  const board = createBoard(createRng('gravity'));
  const snapshot = structuredClone(board);
  const result = collapseBoard(board, [5, 15, 22], createRng('refill'));
  assert.deepEqual(board, snapshot);
  assert.equal(result.length, BOARD_SIZE);
  assert.equal(new Set(result.map((tile) => tile.id)).size, BOARD_SIZE);
  for (const col of [1, 3, 4]) {
    for (let row = 0; row < GRID_SIZE; row += 1) {
      assert.deepEqual(result[row * GRID_SIZE + col], board[row * GRID_SIZE + col]);
    }
  }
  assert.deepEqual([result[10].id, result[15].id, result[20].id], [board[0].id, board[10].id, board[20].id]);
  assert.deepEqual([result[7].id, result[12].id, result[17].id, result[22].id], [board[2].id, board[7].id, board[12].id, board[17].id]);
  assert.ok([result[0], result[5], result[2]].every((tile) => tile.id >= BOARD_SIZE));
  assert.deepEqual(collapseBoard(board, [], createRng('empty')), board);
  const emptyRefill = collapseBoard(board, Array.from({ length: BOARD_SIZE }, (_, i) => i), createRng('full'));
  assert.ok(emptyRefill.every((tile) => tile.id >= BOARD_SIZE));
  assert.throws(() => collapseBoard(board, [-1]), TypeError);
});

test('length, charged tiles, combo, and surge create independent scoring rewards', () => {
  const board = Array.from({ length: BOARD_SIZE }, (_, id) => ({ id, value: 2, charged: false }));
  assert.equal(scorePath(board, [0, 1]), 20);
  assert.equal(scorePath(board, [0, 1, 2]), 45);
  assert.equal(scorePath(board, [0, 1, 2, 3]), 100);
  board[0].charged = true;
  assert.equal(scorePath(board, [0, 1]), 80);
  assert.equal(scorePath(board, [0, 1], { combo: 3 }), 240);
  assert.equal(scorePath(board, [0, 1], { combo: 3, surge: true }), 480);
  assert.equal(scorePath(board, [0, 1], { combo: 99 }), 400);
  assert.equal(scorePath(board, [0, 1], { combo: 0 }), 80);
  assert.equal(scorePath(board, [0, 1], { combo: Number.NaN }), 80);
  assert.equal(scorePath(board, [0, 4]), 0);
});

test('shuffle changes positions while preserving tile identities and contents', () => {
  const board = createBoard(createRng('shuffle'));
  const snapshot = structuredClone(board);
  const result = shuffleBoard(board, createRng('positions'));
  assert.deepEqual(board, snapshot);
  assert.notDeepEqual(result.map((tile) => tile.id), board.map((tile) => tile.id));
  assert.deepEqual([...result].sort((a, b) => a.id - b.id), [...board].sort((a, b) => a.id - b.id));
  assert.deepEqual(shuffleBoard(board, createRng('positions')), result);
  assert.equal(findTargets(result, createRng('offers')).length, 3);
});
