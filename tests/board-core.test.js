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
  // Клетка (5,7) пустая: удар её накрыл, но камня нет — она в voids, не в clear
  assert.ok(plan.voids.has('5,7'));
  assert.ok(!plan.clear.has('5,7'));
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
  // Новые камни приходят по столбцу снизу вверх: игра на это опирается при анимации
  assert.deepEqual(spawned.filter(g => g.c === 0).map(g => g.r), [2, 1, 0]);
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

/* ---------- Task 3: камни в лианах ---------- */

const LOCK = { locked: true };

test('canSwap: камень в лианах не меняется местами', () => {
  const grid = gridFrom(CHECKER, { '2,2': LOCK });
  assert.equal(Board.canSwap(grid, { r: 2, c: 2 }, { r: 2, c: 3 }), false);
  assert.equal(Board.canSwap(grid, { r: 2, c: 3 }, { r: 2, c: 2 }), false);
  assert.equal(Board.canSwap(grid, { r: 2, c: 3 }, { r: 2, c: 4 }), true);
  const holey = gridFrom(withRows({ 3: '01......' }));
  assert.equal(Board.canSwap(holey, { r: 3, c: 1 }, { r: 3, c: 2 }), false, 'пустая клетка');
});

test('findMove и simulateMove не двигают камни в лианах', () => {
  // Оба хода в этой доске затрагивают камень (3,2); без лиан ход есть.
  const rows = withRows({ 2: '..0.....', 3: '0050....' });
  assert.ok(Board.findMove(gridFrom(rows)));
  const grid = gridFrom(rows, { '3,2': LOCK });
  assert.equal(Board.findMove(grid), null);
  assert.equal(Board.hasMove(grid), false);
  const before = grid.map(row => row.slice());
  assert.equal(Board.simulateMove(grid, { r: 2, c: 2 }, { r: 3, c: 2 }, seeded(1), counter()), null);
  assert.deepEqual(grid, before);
  assert.equal(grid[3][2].locked, true);
});

test('лиана срывается рядом, камень остаётся', () => {
  const grid = gridFrom(withRows({ 3: '000.....' }), { '3,1': LOCK });
  const vine = grid[3][1];
  const plan = Board.planCascade(grid, null);
  assert.ok(plan.unlocks.has('3,1'));
  assert.ok(!plan.clear.has('3,1'));
  assert.ok(plan.clear.has('3,0') && plan.clear.has('3,2'));
  const res = Board.applyCascade(grid, plan);
  assert.equal(grid[3][1], vine);
  assert.equal(vine.locked, false);
  assert.equal(grid[3][0], null);
  assert.equal(grid[3][2], null);
  assert.equal(res.removed.length, 2);
  assert.deepEqual(res.unlocked, [vine]);
});

test('тройка из одних закреплённых камней только срывает лианы, потом собирается', () => {
  const grid = gridFrom(withRows({ 3: '000.....' }), { '3,0': LOCK, '3,1': LOCK, '3,2': LOCK });
  const plan = Board.planCascade(grid, null);
  assert.equal(plan.clear.size, 0);
  assert.equal(plan.unlocks.size, 3);
  assert.equal(Board.applyCascade(grid, plan).removed.length, 0);
  const plan2 = Board.planCascade(grid, null);
  assert.equal(plan2.clear.size, 3);
  assert.equal(plan2.unlocks.size, 0);
});

test('бомба срывает лиану, а не уничтожает камень', () => {
  const grid = gridFrom(CHECKER, {
    '3,3': { special: 'bomb' },
    '3,4': LOCK,
    '2,2': LOCK
  });
  const vineA = grid[3][4];
  const vineB = grid[2][2];
  const res = Board.expandSpecials(grid, new Set(['3,3']), new Set());
  assert.deepEqual([...res.unlocks].sort(), ['2,2', '3,4']);
  assert.equal(res.clear.size, 7);
  assert.ok(!res.clear.has('3,4') && !res.clear.has('2,2'));
  const plan = { matched: new Set(['3,3']), creates: [], clear: res.clear, triggers: res.triggers, unlocks: res.unlocks };
  const { removed } = Board.applyCascade(grid, plan);
  assert.equal(grid[3][4], vineA);
  assert.equal(grid[2][2], vineB);
  assert.equal(vineA.locked, false);
  assert.equal(vineB.locked, false);
  assert.ok(!removed.includes(vineA) && !removed.includes(vineB));
});

test('линия и солнце тоже срывают лианы', () => {
  const line = gridFrom(CHECKER, { '4,0': { special: 'line', lineDir: 'row' }, '4,5': LOCK });
  const l = Board.expandSpecials(line, new Set(['4,0']), new Set());
  assert.ok(l.unlocks.has('4,5') && !l.clear.has('4,5'));
  const sun = gridFrom(CHECKER, { '0,0': { special: 'sun' }, '2,2': LOCK });
  const s = Board.expandSpecials(sun, new Set(['0,0']), new Set());
  assert.ok(s.unlocks.has('2,2') && !s.clear.has('2,2'));
});

test('закреплённый спецкамень не срабатывает, а только освобождается', () => {
  const grid = gridFrom(withRows({ 5: '000.....' }), { '5,0': { special: 'line', lineDir: 'row', locked: true } });
  const plan = Board.planCascade(grid, null);
  assert.equal(plan.triggers.length, 0);
  assert.ok(plan.unlocks.has('5,0'));
  assert.ok(!plan.clear.has('5,0'));
});

test('камень в лианах не считается собранным и не становится местом спецкамня', () => {
  const grid = gridFrom(withRows({ 3: '0000....' }), { '3,1': LOCK });
  const vine = grid[3][1];
  const plan = Board.planCascade(grid, { r: 3, c: 1 });
  assert.equal(plan.creates.length, 1);
  assert.ok(!(plan.creates[0].r === 3 && plan.creates[0].c === 1));
  const { removed } = Board.applyCascade(grid, plan);
  assert.ok(!removed.includes(vine));
  assert.equal(removed.length, 2, 'из четырёх: один в лианах, один стал спецкамнем');
  assert.equal(grid[3][1], vine);
  assert.equal(vine.special, null);
});

test('collapse: закреплённый камень не падает, камни выше проходят сквозь него', () => {
  const grid = gridFrom(CHECKER, { '5,0': LOCK });
  const pinned = grid[5][0];
  const top = grid[0][0];
  const above = grid[4][0];
  grid[6][0] = null;
  grid[7][0] = null;
  grid[2][0] = null;
  let id = 500;
  const spawn = (r, c) => ({ id: ++id, color: 2, special: null, lineDir: null, r, c, el: null });
  const { moves, spawned } = Board.collapse(grid, spawn);
  assert.equal(grid[5][0], pinned);
  assert.equal(pinned.r, 5);
  assert.ok(!moves.some(m => m.gem === pinned));
  // Незакреплённые: (4,0) -> 7, (3,0) -> 6, (1,0) -> 4, (0,0) -> 3
  assert.equal(grid[7][0], above);
  assert.equal(above.r, 7);
  assert.equal(grid[3][0], top);
  assert.equal(moves.find(m => m.gem === top).toR, 3);
  // Досыпка в оставшиеся свободные клетки снизу вверх
  assert.deepEqual(spawned.filter(g => g.c === 0).map(g => g.r), [2, 1, 0]);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      assert.ok(grid[r][c]);
      assert.equal(grid[r][c].r, r);
    }
  }
  assert.ok(moves.every(m => m.toR > m.fromR));
});

test('generateGrid: level.vines закрепляет камни, совпадений нет, ход есть', () => {
  const vines = [[0, 0], [3, 3], [7, 7], [4, 1]];
  for (let seed = 1; seed <= 20; seed++) {
    const grid = Board.generateGrid({ colors: 5, vines }, seeded(seed), counter());
    assert.equal(Board.hasAnyMatch(grid), false);
    assert.equal(Board.hasMove(grid), true);
    grid.forEach((row, r) => row.forEach((g, c) => {
      assert.equal(g.locked, vines.some(v => v[0] === r && v[1] === c));
    }));
  }
  const plain = Board.generateGrid({ colors: 5 }, seeded(3), counter());
  assert.ok(plain.every(row => row.every(g => g.locked === false)));
});

function lockedSnapshot(grid) {
  const out = [];
  grid.forEach((row, r) => row.forEach((g, c) => { if (g && g.locked) out.push([r, c, g.id, g.color]); }));
  return out;
}

test('shuffle не двигает камни в лианах и завершается на доске без ходов', () => {
  const vines = [[1, 1], [1, 2], [4, 4], [6, 0], [3, 7]];
  for (let seed = 1; seed <= 15; seed++) {
    const grid = Board.generateGrid({ colors: 5, vines }, seeded(seed), counter());
    const before = lockedSnapshot(grid);
    const ids = grid.flat().map(g => g.id).sort((a, b) => a - b);
    const out = Board.shuffle(grid, seeded(seed + 100), { colors: 5 });
    assert.equal(out, grid);
    assert.deepEqual(lockedSnapshot(out), before);
    assert.equal(Board.hasAnyMatch(out), false);
    assert.equal(Board.hasMove(out), true);
    assert.deepEqual(out.flat().map(g => g.id).sort((a, b) => a - b), ids, 'те же камни');
    out.forEach((row, r) => row.forEach((g, c) => { assert.equal(g.r, r); assert.equal(g.c, c); }));
  }
});

test('shuffle выводит доску без ходов (с лианами) на доску с ходом', () => {
  const DEAD = ['01234501', '23450123', '45012345', '01234501', '23450123', '45012345', '01234501', '23450123'];
  const vines = { '1,1': LOCK, '2,5': LOCK, '4,4': LOCK, '6,2': LOCK, '7,7': LOCK };
  for (let seed = 1; seed <= 15; seed++) {
    const grid = gridFrom(DEAD, vines);
    assert.equal(Board.hasAnyMatch(grid), false);
    assert.equal(Board.hasMove(grid), false, 'исходная доска мёртвая');
    const before = lockedSnapshot(grid);
    const out = Board.shuffle(grid, seeded(seed), { colors: 6 });
    assert.deepEqual(lockedSnapshot(out), before);
    assert.equal(Board.hasAnyMatch(out), false);
    assert.equal(Board.hasMove(out), true);
  }
});

test('shuffle: запасной путь не оставляет совпадений (проверка на многих зерна)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const grid = gridFrom(Array(8).fill('00000000'), { '3,3': LOCK, '0,5': LOCK });
    const out = Board.shuffle(grid, seeded(seed), { colors: 5 });
    assert.equal(Board.hasAnyMatch(out), false, 'seed ' + seed);
    assert.equal(Board.hasMove(out), true, 'seed ' + seed);
  }
});

test('shuffle: спецкамни остаются со своими камнями', () => {
  const grid = Board.generateGrid({ colors: 5, vines: [[2, 2]] }, seeded(5), counter());
  const bomb = grid[0][0];
  const line = grid[7][7];
  bomb.special = 'bomb';
  line.special = 'line';
  line.lineDir = 'col';
  Board.shuffle(grid, seeded(6), { colors: 5 });
  assert.equal(bomb.special, 'bomb');
  assert.equal(line.special, 'line');
  assert.equal(line.lineDir, 'col');
  assert.ok(grid.flat().includes(bomb) && grid.flat().includes(line));
});

test('shuffle: если перестановки не помогают, перекрашивает незакреплённые камни', () => {
  // Все камни одного цвета: никакая перестановка не уберёт совпадения.
  const grid = gridFrom(Array(8).fill('00000000'), { '3,3': LOCK, '0,5': LOCK });
  const before = lockedSnapshot(grid);
  const out = Board.shuffle(grid, seeded(11), { colors: 5 });
  assert.deepEqual(lockedSnapshot(out), before);
  assert.equal(Board.hasAnyMatch(out), false);
  assert.equal(Board.hasMove(out), true);
  out.forEach(row => row.forEach(g => assert.ok(g.color >= 0 && g.color < 5)));
});

/* ---------- Золотые плиты ---------- */

const TRIPLE = [
  '000.....', '........', '........', '........',
  '........', '........', '........', '........'
];

test('makePlates: плита стоит только в указанных клетках', () => {
  const plates = Board.makePlates([[0, 1], [7, 7]]);
  assert.equal(plates[0][1], 1);
  assert.equal(plates[7][7], 1);
  assert.equal(plates[0][0], 0);
  assert.equal(Board.platesLeft(plates), 2);
});

test('makePlates без списка даёт пустой слой', () => {
  assert.equal(Board.platesLeft(Board.makePlates()), 0);
  assert.equal(Board.platesLeft(Board.makePlates([])), 0);
});

test('hitPlates снимает плиты под собранным рядом и не трогает остальные', () => {
  const plan = Board.planCascade(gridFrom(TRIPLE), null);
  const plates = Board.makePlates([[0, 0], [0, 2], [3, 3]]);
  const hits = Board.hitPlates(plates, plan);
  assert.deepEqual(hits.map(h => [h.r, h.c]).sort(), [[0, 0], [0, 2]]);
  assert.equal(Board.platesLeft(plates), 1);
  assert.equal(plates[3][3], 1);
});

test('hitPlates: повторное попадание по пустой клетке ничего не даёт', () => {
  const plan = Board.planCascade(gridFrom(TRIPLE), null);
  const plates = Board.makePlates([[0, 0]]);
  assert.equal(Board.hitPlates(plates, plan).length, 1);
  assert.equal(Board.hitPlates(plates, plan).length, 0);
  assert.equal(plates[0][0], 0);
});

test('hitPlates: плита под рождающимся спецкамнем снимается', () => {
  const grid = gridFrom([
    '0000....', '........', '........', '........',
    '........', '........', '........', '........'
  ]);
  const plan = Board.planCascade(grid, { r: 0, c: 1 });
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.clear.has('0,1'), false, 'камень на месте спецкамня не убирается');
  const plates = Board.makePlates([[0, 1]]);
  assert.equal(Board.hitPlates(plates, plan).length, 1);
});

test('hitPlates: срыв лианы над плитой снимает и плиту', () => {
  const plan = Board.planCascade(gridFrom(TRIPLE, { '0,1': { locked: true } }), null);
  assert.ok(plan.unlocks.has('0,1'));
  const plates = Board.makePlates([[0, 1]]);
  assert.equal(Board.hitPlates(plates, plan).length, 1);
});

test('hitPlates: удар спецкамня снимает плиты по всей своей линии', () => {
  const grid = gridFrom([
    '00012345', '........', '........', '........',
    '........', '........', '........', '........'
  ], { '0,0': { special: 'line', lineDir: 'row' } });
  const plan = Board.planCascade(grid, null);
  const plates = Board.makePlates([[0, 7]]);
  assert.equal(Board.hitPlates(plates, plan).length, 1);
});

test('hitPlates без слоя плит безопасен', () => {
  const plan = Board.planCascade(gridFrom(TRIPLE), null);
  assert.deepEqual(Board.hitPlates(null, plan), []);
});

/* ---------- Валуны ---------- */

const BLANK = Array(8).fill('........');

test('expandSpecials: пустые клетки в зоне удара уходят из clear в voids', () => {
  const grid = gridFrom([
    '........', '........', '........', '...000..',
    '...1.2..', '........', '........', '........'
  ], { '3,4': { special: 'bomb' } });
  const plan = Board.planCascade(grid, null);
  plan.clear.forEach(k => {
    const { r, c } = Board.parseKey(k);
    assert.ok(grid[r][c], 'в clear только клетки с камнями: ' + k);
  });
  assert.ok(plan.voids.has('4,4'), 'пустая клетка под бомбой — в voids');
  assert.ok(plan.clear.has('4,3') && plan.clear.has('4,5'));
});

test('planCascade без пустых клеток даёт пустой voids', () => {
  const plan = Board.planCascade(gridFrom(CHECKER.map((row, r) => r === 0 ? '00010101' : row)), null);
  assert.equal(plan.voids.size, 0);
});

test('makeBoulders: прочность из списка, по умолчанию 1; bouldersLeft считает валуны', () => {
  const b = Board.makeBoulders([[0, 1, 3], [7, 7]]);
  assert.equal(b[0][1], 3);
  assert.equal(b[7][7], 1);
  assert.equal(b[0][0], 0);
  assert.equal(Board.bouldersLeft(b), 2);
  assert.equal(Board.bouldersLeft(Board.makeBoulders()), 0);
});

test('hitBoulders: ряд рядом снимает 1 прочность, два ряда с двух сторон — тоже 1', () => {
  const grid = gridFrom(['000.....', '........', '111.....', ...BLANK.slice(3)]);
  const plan = Board.planCascade(grid, null);
  const b = Board.makeBoulders([[1, 1, 3], [1, 4, 1], [5, 5, 1]]);
  const hits = Board.hitBoulders(b, plan);
  assert.deepEqual(hits.map(h => [h.r, h.c, h.left]), [[1, 1, 2]], 'соседи (0,1) и (2,1) оба в ряду, удар один');
  assert.equal(b[1][4], 1, 'валун без соседей в ряду не тронут');
  assert.equal(b[5][5], 1);
});

test('hitBoulders: прочность 3 -> 2 -> 1 -> 0, по пустой клетке удара нет', () => {
  const plan = Board.planCascade(gridFrom(['........', '000.....', '........', '........', '........', '........', '........', '........']), null);
  const b = Board.makeBoulders([[0, 1, 3]]);
  assert.equal(Board.hitBoulders(b, plan)[0].left, 2);
  assert.equal(Board.hitBoulders(b, plan)[0].left, 1);
  assert.equal(Board.hitBoulders(b, plan)[0].left, 0);
  assert.deepEqual(Board.hitBoulders(b, plan), []);
});

test('hitBoulders: прямой удар спецкамня по клетке валуна (voids)', () => {
  const grid = gridFrom([
    '0001234.', '........', '........', '........',
    '........', '........', '........', '........'
  ], { '0,0': { special: 'line', lineDir: 'row' } });
  const plan = Board.planCascade(grid, null);
  assert.ok(plan.voids.has('0,7'));
  const b = Board.makeBoulders([[0, 7, 1]]);
  assert.deepEqual(Board.hitBoulders(b, plan).map(h => [h.r, h.c, h.left]), [[0, 7, 0]]);
});

test('hitBoulders: соседний валун в зоне удара не бьёт валун рядом с собой', () => {
  // Молния по строке 0 бьёт валун (0,7) напрямую; валун (1,7) рядом с (0,7) — но (0,7) не камень.
  const grid = gridFrom([
    '0001234.', '1234501.', '........', '........',
    '........', '........', '........', '........'
  ], { '0,0': { special: 'line', lineDir: 'row' } });
  const plan = Board.planCascade(grid, null);
  const b = Board.makeBoulders([[0, 7, 1], [1, 7, 1]]);
  const hits = Board.hitBoulders(b, plan);
  assert.ok(hits.some(h => h.r === 0 && h.c === 7));
  assert.ok(!hits.some(h => h.r === 1 && h.c === 7), 'валун (1,7) не задет: его сосед (0,7) — валун, а (1,6) не в clear');
});

test('hitBoulders: срыв лианы и рождение спецкамня рядом тоже трескают валун', () => {
  const vine = Board.planCascade(gridFrom(TRIPLE, { '0,1': { locked: true } }), null);
  const b1 = Board.makeBoulders([[1, 1, 2]]);
  assert.equal(Board.hitBoulders(b1, vine).length, 1);
  const plan = Board.planCascade(gridFrom(['0000....', ...BLANK.slice(1)]), { r: 0, c: 1 });
  const b2 = Board.makeBoulders([[1, 1, 2]]);
  assert.equal(Board.hitBoulders(b2, plan).length, 1);
  assert.deepEqual(Board.hitBoulders(null, plan), []);
});

test('collapse с blocked: камни проходят сквозь валун, его клетка не досыпается', () => {
  const grid = gridFrom(CHECKER);
  grid[5][0] = null; // валун
  grid[6][0] = null;
  grid[7][0] = null;
  const top = grid[0][0];
  const above = grid[4][0];
  let id = 900;
  const spawn = (r, c) => ({ id: ++id, color: 2, special: null, lineDir: null, locked: false, r, c, el: null });
  const blocked = (r, c) => r === 5 && c === 0;
  const { spawned } = Board.collapse(grid, spawn, blocked);
  assert.equal(grid[5][0], null, 'клетка валуна пустая');
  assert.equal(grid[7][0], above);
  assert.equal(top.r, 2);
  assert.ok(!spawned.some(g => g.r === 5 && g.c === 0));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) if (!(r === 5 && c === 0)) assert.ok(grid[r][c], 'нет дыр: ' + r + ',' + c);
  }
});

test('generateGrid: клетки валунов пустые, совпадений нет, ход есть', () => {
  const boulders = [[0, 0, 1], [3, 3, 2], [3, 4, 3], [7, 7, 1]];
  for (let seed = 1; seed <= 20; seed++) {
    const grid = Board.generateGrid({ colors: 5, boulders }, seeded(seed), counter());
    assert.equal(Board.hasAnyMatch(grid), false);
    assert.equal(Board.hasMove(grid), true);
    grid.forEach((row, r) => row.forEach((g, c) => {
      assert.equal(g === null, boulders.some(v => v[0] === r && v[1] === c));
    }));
  }
});

test('shuffle оставляет клетки валунов пустыми', () => {
  const grid = Board.generateGrid({ colors: 5, boulders: [[2, 2], [6, 1]] }, seeded(7), counter());
  Board.shuffle(grid, seeded(8));
  assert.equal(grid[2][2], null);
  assert.equal(grid[6][1], null);
  assert.equal(grid.flat().filter(g => g === null).length, 2);
});

test('simulateMove с opts.boulders: живые валуны пусты, остальное поле без дыр, валуны трескаются', () => {
  // Полоса валунов поперёк поля: камни сверху падают сквозь неё.
  const list = [0, 1, 2, 3, 4, 5, 6, 7].map(c => [4, c, 2]);
  let hitsTotal = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const grid = Board.generateGrid({ colors: 5, boulders: list }, seeded(seed), counter());
    const boulders = Board.makeBoulders(list);
    for (let turn = 0; turn < 6; turn++) {
      const move = Board.findMove(grid);
      if (!move) break;
      const res = Board.simulateMove(grid, move.a, move.b, seeded(seed * 31 + turn), counter(), { colors: 5, boulders });
      assert.ok(res, 'ход из findMove допустим');
      hitsTotal += res.boulderHits.length;
      grid.forEach((row, r) => row.forEach((g, c) => {
        if (boulders[r][c] > 0) assert.equal(g, null, 'живой валун пуст: ' + r + ',' + c);
        else assert.ok(g && g.r === r && g.c === c, 'нет дыр: ' + r + ',' + c);
      }));
      res.cascades.forEach(plan => plan.clear.forEach(k => {
        const { r, c } = Board.parseKey(k);
        assert.ok(!(list.some(v => v[0] === r && v[1] === c) && plan.voids.has(k)), 'ключ не в clear и voids сразу');
      }));
    }
  }
  assert.ok(hitsTotal > 0, 'хоть один валун треснул');
});
