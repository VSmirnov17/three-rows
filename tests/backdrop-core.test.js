'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const BC = require('../js/backdrop-core.js');

const { LIMITS, FIREFLY } = BC;

test('режимы: still важнее paused', () => {
  assert.equal(BC.modeFor({ hidden: false, overlay: false, reduced: false, phone: false }), 'run');
  assert.equal(BC.modeFor({ hidden: true, overlay: false, reduced: false, phone: false }), 'paused');
  assert.equal(BC.modeFor({ hidden: false, overlay: true, reduced: false, phone: false }), 'paused');
  assert.equal(BC.modeFor({ hidden: true, overlay: true, reduced: true, phone: false }), 'still');
  assert.equal(BC.modeFor({ hidden: false, overlay: false, reduced: false, phone: true }), 'still');
});

test('светлячки только в run и не в слабом режиме', () => {
  assert.equal(BC.fliesOn('run', false), true);
  assert.equal(BC.fliesOn('run', true), false);
  assert.equal(BC.fliesOn('paused', false), false);
  assert.equal(BC.fliesOn('still', false), false);
});

test('мерцание светлячка в пределах и без ступенек', () => {
  const period = FIREFLY.period[0];
  const dt = 1 / 60;
  const steps = Math.round(period / dt);
  let min = Infinity;
  let max = -Infinity;
  let prev = BC.fireflyAlpha(0, period, 0);
  for (let i = 0; i <= steps; i++) {
    const a = BC.fireflyAlpha(i * dt, period, 0);
    min = Math.min(min, a);
    max = Math.max(max, a);
    if (i > 0) assert.ok(Math.abs(a - prev) <= 0.02, `скачок ${Math.abs(a - prev)} на шаге ${i}`);
    prev = a;
  }
  assert.ok(min >= 0.08 - 1e-9, `min ${min}`);
  assert.ok(max <= LIMITS.fireflyAlphaMax + 1e-9, `max ${max}`);
  /* сдвиг фазы тоже не выводит за пределы */
  for (let i = 0; i < 200; i++) {
    const a = BC.fireflyAlpha(i * 0.37, 6.5, i * 1.3);
    assert.ok(a >= 0.08 - 1e-9 && a <= LIMITS.fireflyAlphaMax + 1e-9, `a ${a}`);
  }
  assert.ok(Math.abs(BC.fireflyAlpha(0, period, 0) - FIREFLY.alpha[0]) < 1e-12);
  assert.ok(Math.abs(BC.fireflyAlpha(period / 2, period, 0) - FIREFLY.alpha[1]) < 1e-12);
});

test('числа FIREFLY не выходят за LIMITS', () => {
  assert.ok(FIREFLY.count <= LIMITS.fireflyMax);
  assert.ok(FIREFLY.speed[1] + FIREFLY.rise <= LIMITS.fireflySpeedMax);
  assert.ok(FIREFLY.period[0] >= LIMITS.fireflyBlinkMinS);
  assert.ok(FIREFLY.alpha[1] <= LIMITS.fireflyAlphaMax);
  assert.ok(Object.isFrozen(LIMITS));
  assert.ok(Object.isFrozen(FIREFLY));
});

test('isFree и spawnPoint обходят прямоугольники', () => {
  const rects = [{ left: 100, top: 0, right: 900, bottom: 600 }];
  assert.equal(BC.isFree(rects, 50, 300, 14), true);
  assert.equal(BC.isFree(rects, 90, 300, 14), false);

  /* линейный конгруэнтный генератор: результат воспроизводим */
  function lcg(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const w = 1000;
  const h = 700;
  const side = [{ left: 120, top: 0, right: 880, bottom: 700 }];
  const rand = lcg(12345);
  for (let i = 0; i < 200; i++) {
    const p = BC.spawnPoint(side, w, h, rand);
    assert.ok(p, `попытка ${i}: нет точки`);
    assert.ok(BC.isFree(side, p.x, p.y, FIREFLY.pad), `попытка ${i}: точка занята`);
    assert.ok(p.x >= 4 && p.x <= w - 4, `x ${p.x}`);
    assert.ok(p.y >= 0.15 * h && p.y <= h - 6, `y ${p.y}`);
  }

  const all = [{ left: 0, top: 0, right: w, bottom: h }];
  assert.equal(BC.spawnPoint(all, w, h, lcg(1)), null);
});
