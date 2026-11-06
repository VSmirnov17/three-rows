'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Board = require('../js/core/board.js');
const { gridFrom } = require('./helpers/grid.js');

test('findLineGroups находит горизонтальную тройку', () => {
  const grid = gridFrom([
    '000.....',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........'
  ]);
  const groups = Board.findLineGroups(grid);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].dir, 'h');
  assert.equal(groups[0].len, 3);
  assert.deepEqual(groups[0].cells, [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }]);
});

test('findLineGroups находит вертикальную серию', () => {
  const grid = gridFrom([
    '.....1..',
    '.....1..',
    '.....1..',
    '.....1..',
    '........',
    '........',
    '........',
    '........'
  ]);
  const groups = Board.findLineGroups(grid);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].dir, 'v');
  assert.equal(groups[0].len, 4);
});

test('findLineGroups не склеивает через пустую клетку', () => {
  const grid = gridFrom([
    '00.0....',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........'
  ]);
  assert.deepEqual(Board.findLineGroups(grid), []);
});

test('findSquares находит квадрат 2×2', () => {
  const grid = gridFrom([
    '........',
    '........',
    '...22...',
    '...22...',
    '........',
    '........',
    '........',
    '........'
  ]);
  const squares = Board.findSquares(grid);
  assert.equal(squares.length, 1);
  assert.equal(squares[0].cells.length, 4);
  const corners = [{ r: 2, c: 3 }, { r: 2, c: 4 }, { r: 3, c: 3 }, { r: 3, c: 4 }];
  assert.ok(corners.some(p => p.r === squares[0].center.r && p.c === squares[0].center.c));
});

test('findSquares не считает квадрат со спецкамнем', () => {
  const grid = gridFrom([
    '........',
    '........',
    '...22...',
    '...22...',
    '........',
    '........',
    '........',
    '........'
  ], { '2,3': { special: 'bomb' } });
  assert.deepEqual(Board.findSquares(grid), []);
});

test('findCorners находит уголок из 5', () => {
  const grid = gridFrom([
    '333.....',
    '3.......',
    '3.......',
    '........',
    '........',
    '........',
    '........',
    '........'
  ]);
  const groups = Board.findLineGroups(grid);
  const corners = Board.findCorners(grid, groups);
  assert.equal(corners.length, 1);
  assert.equal(corners[0].cells.length, 5);
  assert.deepEqual(corners[0].joint, { r: 0, c: 0 });
});

test('analyzePatterns собирает серии, квадраты и уголки', () => {
  const grid = gridFrom([
    '333..44.',
    '3....44.',
    '3.......',
    '........',
    '........',
    '........',
    '........',
    '........'
  ]);
  const p = Board.analyzePatterns(grid);
  assert.equal(p.groups.length, 2);
  assert.equal(p.squares.length, 1);
  assert.equal(p.corners.length, 1);
});

test('hasAnyMatch: серия, квадрат и пустая доска', () => {
  const none = gridFrom(['01234501', '23450123', '45012345', '01234501', '23450123', '45012345', '01234501', '23450123']);
  assert.equal(Board.hasAnyMatch(none), false);
  const line = gridFrom(['111.....', '........', '........', '........', '........', '........', '........', '........']);
  assert.equal(Board.hasAnyMatch(line), true);
  const square = gridFrom(['11......', '11......', '........', '........', '........', '........', '........', '........']);
  assert.equal(Board.hasAnyMatch(square), true);
});

test('findMove находит единственный ход и не портит доску', () => {
  // На этой доске нет совпадений, возможен ровно один обмен: (3,2) <-> (4,2).
  const grid = gridFrom([
    '35154140',
    '04212551',
    '00552123',
    '32440543',
    '51230201',
    '33452234',
    '53454532',
    '40021004'
  ]);
  const before = grid.map(row => row.map(g => g.id));
  const move = Board.findMove(grid);
  assert.deepEqual(move, { a: { r: 3, c: 2 }, b: { r: 4, c: 2 } });
  assert.equal(Board.hasMove(grid), true);
  assert.deepEqual(grid.map(row => row.map(g => g.id)), before);
});

test('hasMove на доске без ходов возвращает false', () => {
  const grid = gridFrom([
    '01234501',
    '23450123',
    '45012345',
    '01234501',
    '23450123',
    '45012345',
    '01234501',
    '23450123'
  ]);
  assert.equal(Board.hasAnyMatch(grid), false);
  assert.equal(Board.findMove(grid), null);
  assert.equal(Board.hasMove(grid), false);
});

test('gemAt, keyOf и parseKey', () => {
  const grid = gridFrom(['5.......', '........', '........', '........', '........', '........', '........', '.......3']);
  assert.equal(Board.ROWS, 8);
  assert.equal(Board.COLS, 8);
  assert.equal(Board.gemAt(grid, 0, 0).color, 5);
  assert.equal(Board.gemAt(grid, 7, 7).color, 3);
  assert.equal(Board.gemAt(grid, 0, 1), null);
  assert.equal(Board.gemAt(grid, -1, 0), null);
  assert.equal(Board.gemAt(grid, 0, 8), null);
  assert.equal(Board.keyOf(3, 5), '3,5');
  assert.deepEqual(Board.parseKey('3,5'), { r: 3, c: 5 });
});
