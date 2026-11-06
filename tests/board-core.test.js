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

/* ---------- Task 2: план каскада, обрушение, симуляция ---------- */

const EMPTY = ['........', '........', '........', '........', '........', '........', '........', '........'];
const withRows = (patch) => EMPTY.map((line, r) => (patch[r] !== undefined ? patch[r] : line));
const CHECKER = ['01010101', '10101010', '01010101', '10101010', '01010101', '10101010', '01010101', '10101010'];

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function counter() {
  let n = 1000;
  return () => ++n;
}

test('planCascade: нет совпадений -> null', () => {
  const grid = gridFrom(withRows({ 0: '01010101' }));
  assert.equal(Board.planCascade(grid, null), null);
});

test('planCascade: линия из 4 создаёт молнию в клетке обмена', () => {
  const grid = gridFrom(withRows({ 3: '0000....' }));
  const plan = Board.planCascade(grid, { r: 3, c: 2 });
  assert.ok(plan);
  assert.equal(plan.creates.length, 1);
  assert.deepEqual(plan.creates[0], { r: 3, c: 2, type: 'line', dir: 'row' });
  assert.equal(plan.matched.size, 4);
  assert.ok(!plan.clear.has('3,2'), 'клетка с новым спецкамнем не очищается');
  assert.equal(plan.clear.size, 3);
  assert.equal(plan.unlocks.size, 0);
});

test('planCascade: вертикальная линия из 4 даёт молнию col, без обмена — середина', () => {
  const grid = gridFrom(withRows({ 1: '0.......', 2: '0.......', 3: '0.......', 4: '0.......' }));
  const plan = Board.planCascade(grid, null);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].type, 'line');
  assert.equal(plan.creates[0].dir, 'col');
  assert.equal(plan.creates[0].c, 0);
  assert.equal(plan.creates[0].r, 3);
});

test('planCascade: L из 5 даёт тотем, а не молнию', () => {
  const grid = gridFrom(withRows({ 0: '000.....', 1: '0.......', 2: '0.......' }));
  const plan = Board.planCascade(grid, null);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].type, 'totem');
  assert.deepEqual([plan.creates[0].r, plan.creates[0].c], [0, 0]);
  assert.equal(plan.matched.size, 5);
});

test('planCascade: 5 в ряд даёт солнце', () => {
  const grid = gridFrom(withRows({ 4: '.00000..' }));
  const plan = Board.planCascade(grid, null);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].type, 'sun');
  assert.deepEqual([plan.creates[0].r, plan.creates[0].c], [4, 3]);
});

test('planCascade: квадрат 2×2 даёт бомбу', () => {
  const grid = gridFrom(withRows({ 2: '.00.....', 3: '.00.....' }));
  const plan = Board.planCascade(grid, null);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].type, 'bomb');
});

test('planCascade: простая тройка не создаёт спецкамней', () => {
  const grid = gridFrom(withRows({ 7: '..000...' }));
  const plan = Board.planCascade(grid, null);
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.clear.size, 3);
});

test('planCascade: спецкамень в совпадении срабатывает (триггер)', () => {
  const grid = gridFrom(withRows({ 5: '000.....' }), { '5,0': { special: 'line', lineDir: 'row' } });
  const plan = Board.planCascade(grid, null);
  assert.equal(plan.triggers.length, 1);
  assert.equal(plan.triggers[0].type, 'line');
  assert.ok(plan.clear.has('5,7'));
});

test('expandSpecials: бомба чистит 3×3, на углу — 2×2', () => {
  const mid = gridFrom(CHECKER, { '3,3': { special: 'bomb' } });
  const r1 = Board.expandSpecials(mid, new Set(['3,3']), new Set());
  assert.equal(r1.clear.size, 9);
  assert.equal(r1.triggers.length, 1);
  assert.equal(r1.unlocks.size, 0);

  const corner = gridFrom(CHECKER, { '0,0': { special: 'bomb' } });
  const r2 = Board.expandSpecials(corner, new Set(['0,0']), new Set());
  assert.equal(r2.clear.size, 4);
});

test('expandSpecials: защищённые клетки не очищаются; цепочка спецкамней', () => {
  const grid = gridFrom(CHECKER, {
    '3,3': { special: 'bomb' },
    '3,4': { special: 'line', lineDir: 'col' }
  });
  const res = Board.expandSpecials(grid, new Set(['3,3']), new Set(['3,3']));
  assert.equal(res.triggers.length, 2);
  assert.ok(res.clear.has('0,4') && res.clear.has('7,4'));
  assert.ok(!res.clear.has('3,3'));
});

test('applyCascade: удаляет clear и апгрейдит creates', () => {
  const grid = gridFrom(withRows({ 3: '0000....' }));
  const plan = Board.planCascade(grid, { r: 3, c: 1 });
  const { removed } = Board.applyCascade(grid, plan);
  assert.equal(removed.length, 3);
  assert.equal(grid[3][1].special, 'line');
  assert.equal(grid[3][1].lineDir, 'row');
  assert.equal(grid[3][0], null);
  assert.equal(grid[3][2], null);
  assert.equal(grid[3][3], null);
});

test('collapse: камни падают вниз, сверху досыпаются новые, сетка полная', () => {
  const grid = gridFrom(CHECKER);
  const top = grid[0][0];
  const second = grid[1][0];
  grid[5][0] = null;
  grid[6][0] = null;
  grid[7][0] = null;
  grid[7][3] = null;
  let id = 500;
  const spawn = (r, c) => ({ id: ++id, color: 2, special: null, lineDir: null, r, c, el: null });
  const { moves, spawned } = Board.collapse(grid, spawn);

  assert.equal(spawned.length, 4);
  assert.ok(spawned.every(g => g.color === 2));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      assert.ok(grid[r][c], 'клетка ' + r + ',' + c + ' заполнена');
      assert.equal(grid[r][c].r, r);
      assert.equal(grid[r][c].c, c);
    }
  }
  const mv = moves.find(m => m.gem === top);
  assert.deepEqual([mv.fromR, mv.toR], [0, 3]);
  assert.equal(grid[3][0], top);
  assert.equal(grid[4][0], second);
  assert.equal(spawned.filter(g => g.c === 0).length, 3);
  assert.equal(spawned.filter(g => g.c === 3).length, 1);
  assert.ok(moves.every(m => m.toR > m.fromR));
});

test('generateGrid: нет совпадений, есть ход, цвета в пределах level.colors', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const grid = Board.generateGrid({ colors: 5 }, seeded(seed), counter());
    assert.equal(Board.hasAnyMatch(grid), false);
    assert.equal(Board.hasMove(grid), true);
    const ids = new Set();
    grid.forEach(row => row.forEach(g => {
      assert.ok(g && g.color >= 0 && g.color < 5);
      ids.add(g.id);
    }));
    assert.equal(ids.size, 64);
  }
  const def = Board.generateGrid(null, seeded(7), counter());
  assert.equal(Board.hasAnyMatch(def), false);
});

test('simulateMove: недопустимый обмен → null; допустимый → сетка без совпадений и полная', () => {
  const rng = seeded(42);
  const nextId = counter();
  const grid = Board.generateGrid({ colors: 6 }, rng, nextId);

  // Недопустимый: любой обмен соседей без совпадения
  let bad = null;
  for (let r = 0; r < 8 && !bad; r++) {
    for (let c = 0; c < 7 && !bad; c++) {
      const a = grid[r][c];
      const b = grid[r][c + 1];
      grid[r][c] = b;
      grid[r][c + 1] = a;
      const ok = Board.hasAnyMatch(grid);
      grid[r][c] = a;
      grid[r][c + 1] = b;
      if (!ok) bad = { a: { r, c }, b: { r, c: c + 1 } };
    }
  }
  assert.ok(bad);
  const before = grid.map(row => row.slice());
  assert.equal(Board.simulateMove(grid, bad.a, bad.b, rng, nextId), null);
  assert.deepEqual(grid, before);
  assert.equal(grid[bad.a.r][bad.a.c].c, bad.a.c);

  // Не соседи -> null
  assert.equal(Board.simulateMove(grid, { r: 0, c: 0 }, { r: 2, c: 2 }, rng, nextId), null);

  // Допустимый
  const move = Board.findMove(grid);
  const res = Board.simulateMove(grid, move.a, move.b, rng, nextId);
  assert.ok(res);
  assert.ok(res.cascades.length >= 1);
  assert.ok(res.removed.length >= 3);
  assert.equal(Board.hasAnyMatch(grid), false);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      assert.ok(grid[r][c]);
      assert.equal(grid[r][c].r, r);
      assert.equal(grid[r][c].c, c);
    }
  }
});

test('simulateMove: много ходов подряд не ломают поле', () => {
  const rng = seeded(99);
  const nextId = counter();
  const grid = Board.generateGrid({ colors: 6 }, rng, nextId);
  for (let i = 0; i < 100; i++) {
    const move = Board.findMove(grid);
    if (!move) break;
    const res = Board.simulateMove(grid, move.a, move.b, rng, nextId);
    assert.ok(res);
    assert.equal(Board.hasAnyMatch(grid), false);
    grid.forEach(row => row.forEach(g => assert.ok(g)));
  }
});
