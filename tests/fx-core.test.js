'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const FxCore = require('../js/fx-core.js');

const { TIMING } = FxCore;
const plain = { calm: false, reduced: false, low: false };

/* Простой LCG: детерминированная «случайность» для тестов. */
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* Площадь многоугольника по формуле шнурования. */
function area(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/* Поле 8×8 из трёх цветов. */
function boardCells() {
  const colors = ['red', 'green', 'blue'];
  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) cells.push({ r, c, color: colors[(r * 3 + c) % 3] });
  }
  return cells;
}

const keyOf = (t) => t.r + ',' + t.c;

test('TIMING заморожен', () => {
  assert.ok(Object.isFrozen(TIMING));
  assert.ok(Object.isFrozen(TIMING.strikeMs));
  assert.equal(TIMING.shatterMs, 560);
  assert.deepEqual({ ...TIMING.strikeMs }, { line: 700, sun: 900, bomb: 800, totem: 850 });
  assert.equal(TIMING.sunStepMs, 35);
  assert.equal(TIMING.sunMaxDelayMs, 260);
  assert.equal(TIMING.waveStepMs, 30);
  assert.equal(TIMING.waveMaxDelayMs, 240);
  assert.equal(TIMING.cleanupMs, 1100);
});

test('budget: full/calm/low/reduced', () => {
  assert.deepEqual(FxCore.budget(plain),
    { shards: 6, dust: 10, glints: 2, embers: 18, beamAlpha: 1 });
  assert.deepEqual(FxCore.budget({ calm: true }),
    { shards: 3, dust: 6, glints: 1, embers: 10, beamAlpha: 0.6 });
  assert.deepEqual(FxCore.budget({ low: true }),
    { shards: 3, dust: 0, glints: 0, embers: 0, beamAlpha: 1 });
  assert.deepEqual(FxCore.budget({ calm: true, low: true }),
    { shards: 3, dust: 0, glints: 0, embers: 0, beamAlpha: 0.6 });
  assert.deepEqual(FxCore.budget({ reduced: true }),
    { shards: 0, dust: 0, glints: 0, embers: 0, beamAlpha: 0 });
  assert.equal(FxCore.budget({ reduced: true, calm: true, low: true }).shards, 0);
  assert.deepEqual(FxCore.budget(), FxCore.budget(plain));
});

test('shardsFor: меньше осколков при большом числе клеток', () => {
  assert.equal(FxCore.shardsFor(1, plain), 6);
  assert.equal(FxCore.shardsFor(21, plain), 4);
  assert.equal(FxCore.shardsFor(60, plain), 2);
  assert.equal(FxCore.shardsFor(5, { low: true }), 3);
  assert.equal(FxCore.shardsFor(5, { reduced: true }), 0);
});

test('shardPolygons(6): куски покрывают квадрат, центры не в середине', () => {
  const polys = FxCore.shardPolygons(6, seeded(7));
  assert.equal(polys.length, 6);
  let total = 0;
  for (const poly of polys) {
    assert.ok(poly.length >= 3 && poly.length <= 5, 'вершин: ' + poly.length);
    for (const [x, y] of poly) {
      assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100, x + ',' + y);
    }
    total += area(poly);
    assert.ok(Number.isFinite(poly.cx) && Number.isFinite(poly.cy));
    assert.ok(Math.hypot(poly.cx - 50, poly.cy - 50) >= 8, 'центр куска у середины');
  }
  assert.ok(Math.abs(total - 10000) <= 1, 'сумма площадей ' + total);
});

test('shardPolygons: центры кусков не ближе 8 к середине при любом зерне и n', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const n of [2, 3, 4, 5, 6, 8, 10]) {
      const polys = FxCore.shardPolygons(n, seeded(seed));
      assert.equal(polys.length, n);
      let total = 0;
      for (const poly of polys) {
        total += area(poly);
        assert.ok(Math.hypot(poly.cx - 50, poly.cy - 50) >= 8,
          'seed ' + seed + ' n ' + n);
      }
      assert.ok(Math.abs(total - 10000) <= 1, 'seed ' + seed + ' n ' + n);
    }
  }
});

test('shardPolygons детерминирован при одинаковом rand', () => {
  const a = FxCore.shardPolygons(6, seeded(42));
  const b = FxCore.shardPolygons(6, seeded(42));
  assert.deepEqual(a.map((p) => ({ pts: p, cx: p.cx, cy: p.cy })),
    b.map((p) => ({ pts: p, cx: p.cx, cy: p.cy })));
  const c = FxCore.shardPolygons(6, seeded(43));
  assert.notDeepEqual(a.map((p) => [...p]), c.map((p) => [...p]));
});

test('shardFlight: наружу от центра, тяжесть вниз, пределы длины и поворота', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rand = seeded(seed);
    for (const poly of FxCore.shardPolygons(6, rand)) {
      const f = FxCore.shardFlight(poly, rand);
      assert.ok(Math.abs(f.rot) <= 40, 'rot ' + f.rot);
      const len = Math.hypot(f.dx, f.dy - 20);
      assert.ok(len >= 60 - 1e-9 && len <= 110 + 1e-9, 'len ' + len);
      /* направление совпадает с направлением от (50,50) к центру куска */
      const ux = (poly.cx - 50) / Math.hypot(poly.cx - 50, poly.cy - 50);
      const uy = (poly.cy - 50) / Math.hypot(poly.cx - 50, poly.cy - 50);
      assert.ok(Math.abs(f.dx / len - ux) < 1e-9);
      assert.ok(Math.abs((f.dy - 20) / len - uy) < 1e-9);
    }
  }
});

test('strikeTargets sun: только цвет солнца, задержки неубывают, максимум 260', () => {
  const cells = boardCells();
  const trigger = { r: 0, c: 0, type: 'sun', color: 'red', lineDir: null };
  const out = FxCore.strikeTargets(trigger, cells);
  const red = cells.filter((x) => x.color === 'red');
  assert.equal(out.length, red.length);
  const byKey = new Map(cells.map((x) => [x.r + ',' + x.c, x]));
  for (const t of out) assert.equal(byKey.get(keyOf(t)).color, 'red');
  for (let i = 1; i < out.length; i++) assert.ok(out[i].delay >= out[i - 1].delay);
  assert.ok(Math.max(...out.map((t) => t.delay)) <= 260);
  assert.equal(out[0].delay, 0);
  /* дальняя клетка (7,6): dist ~ 9.2 клетки — упирается в потолок */
  const far = out.find((t) => t.r === 7 && t.c === 6);
  assert.equal(far.delay, 260);
  /* ближняя: (1,1) цвета (3+1)%3=1 → green, а красная (0,3): dist 3 → 105 */
  assert.equal(out.find((t) => t.r === 0 && t.c === 3).delay, 105);
});

test('strikeTargets totem: крест из 15 клеток, волна от тотема', () => {
  const cells = boardCells();
  const trigger = { r: 0, c: 0, type: 'totem', color: 'red', lineDir: null };
  const out = FxCore.strikeTargets(trigger, cells);
  /* тотем в углу: ряд 8 + столбец 8 − 1 = 15 клеток */
  assert.equal(out.length, 15);
  assert.equal(out.find((t) => t.r === 0 && t.c === 0).delay, 0);
  assert.equal(out.find((t) => t.r === 0 && t.c === 7).delay, 210);
  assert.equal(out.find((t) => t.r === 7 && t.c === 0).delay, 210);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].delay >= out[i - 1].delay);
  for (const t of out) assert.ok(t.r === 0 || t.c === 0);
});

test('strikeTargets totem: потолок волны 240', () => {
  const cells = boardCells();
  /* тотем в центре: ряд и столбец дают 15 клеток, самая дальняя |dr|+|dc| = 4 */
  const mid = FxCore.strikeTargets({ r: 3, c: 3, type: 'totem', color: 'red' }, cells);
  assert.equal(mid.length, 15);
  assert.ok(Math.max(...mid.map((t) => t.delay)) <= 240);
});

test('strikeTargets line: lineDir col даёт только столбец', () => {
  const cells = boardCells();
  const trigger = { r: 3, c: 5, type: 'line', color: 'red', lineDir: 'col' };
  const out = FxCore.strikeTargets(trigger, cells);
  assert.equal(out.length, 8);
  for (const t of out) assert.equal(t.c, 5);
  assert.equal(out.find((t) => t.r === 3).delay, 0);
  /* (0,5): dist 3 → round(3 * 30 * 0.6) = 54 */
  assert.equal(out.find((t) => t.r === 0).delay, 54);
  /* (7,5): dist 4 → 72 */
  assert.equal(out.find((t) => t.r === 7).delay, 72);

  const row = FxCore.strikeTargets({ r: 3, c: 5, type: 'line', lineDir: 'row' }, cells);
  assert.equal(row.length, 8);
  for (const t of row) assert.equal(t.r, 3);
});

test('strikeTargets bomb: квадрат 3×3 без задержки', () => {
  const cells = boardCells();
  const out = FxCore.strikeTargets({ r: 4, c: 4, type: 'bomb', color: 'red' }, cells);
  assert.equal(out.length, 9);
  for (const t of out) {
    assert.equal(t.delay, 0);
    assert.ok(Math.abs(t.r - 4) <= 1 && Math.abs(t.c - 4) <= 1);
  }
  /* у края поля: клетки только внутри cells */
  assert.equal(FxCore.strikeTargets({ r: 0, c: 0, type: 'bomb' }, cells).length, 4);
});

test('strikeTargets: берёт только клетки из cells (обычный каскад не входит)', () => {
  const cells = [
    { r: 2, c: 2, color: 'red' },
    { r: 2, c: 3, color: 'red' },
    { r: 6, c: 6, color: 'blue' }
  ];
  const out = FxCore.strikeTargets({ r: 2, c: 2, type: 'bomb' }, cells);
  assert.deepEqual(out.map(keyOf).sort(), ['2,2', '2,3']);
  assert.deepEqual(FxCore.strikeTargets({ r: 2, c: 2, type: 'unknown' }, cells), []);
});

test('mergeDelays: меньшая из задержек, вне ударов — 0', () => {
  const cells = boardCells();
  const triggers = [
    { r: 0, c: 0, type: 'line', color: 'red', lineDir: 'row' },
    { r: 0, c: 7, type: 'line', color: 'red', lineDir: 'row' }
  ];
  const m = FxCore.mergeDelays(cells, triggers);
  assert.ok(m instanceof Map);
  assert.equal(m.size, cells.length);
  /* клетка (0,1): от первой dist 1 → 18, от второй dist 6 → 108; берётся 18 */
  assert.equal(m.get('0,1'), 18);
  /* клетка (0,6): от второй dist 1 → 18 */
  assert.equal(m.get('0,6'), 18);
  assert.equal(m.get('0,0'), 0);
  /* вне ударов */
  assert.equal(m.get('5,5'), 0);
});

test('mergeDelays: без ударов все задержки нулевые', () => {
  const cells = boardCells();
  const m = FxCore.mergeDelays(cells, []);
  assert.equal(m.size, cells.length);
  for (const v of m.values()) assert.equal(v, 0);
});
