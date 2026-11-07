'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FireCore = require('../js/fire-core.js');

const { LIMITS, SHEET } = FireCore;
const plain = { calm: false, reduced: false, low: false };

test('SHEET совпадает с assets/fire/fire.json', () => {
  const json = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'fire', 'fire.json'), 'utf8'));
  for (const k of ['frames', 'cols', 'rows', 'fw', 'fh', 'fps']) {
    assert.equal(SHEET[k], json[k], k);
  }
  assert.equal(SHEET.mouth.x, json.mouth.x);
  assert.equal(SHEET.mouth.y, json.mouth.y);
});

test('обычный ряд — колыхание без вспышки', () => {
  assert.deepEqual(FireCore.reaction('match', { chain: 1, mult: 2 }, plain),
    { flare: 0, sparks: 0, sway: true });
});

test('каскад растёт с длиной', () => {
  const r3 = FireCore.reaction('match', { chain: 3 }, plain);
  const r5 = FireCore.reaction('match', { chain: 5 }, plain);
  const r20 = FireCore.reaction('match', { chain: 20 }, plain);
  assert.ok(r3.flare > 0);
  assert.ok(r3.flare < r5.flare);
  assert.equal(r20.flare, 1);
  assert.equal(r3.sway, false);
  for (const chain of [2, 3, 5, 10, 20, 100]) {
    const r = FireCore.reaction('match', { chain }, plain);
    assert.ok(Number.isInteger(r.sparks));
    assert.ok(r.sparks >= 0 && r.sparks <= LIMITS.sparksMax, 'chain ' + chain);
  }
});

test('особые события: special 0,6, blast 0,8, blast-солнце 1, win 1', () => {
  assert.equal(FireCore.reaction('special', {}, plain).flare, 0.6);
  assert.equal(FireCore.reaction('blast', { type: 'line' }, plain).flare, 0.8);
  assert.equal(FireCore.reaction('blast', { type: 'sun' }, plain).flare, 1);
  assert.equal(FireCore.reaction('win', {}, plain).flare, 1);
  for (const e of ['special', 'blast', 'win']) {
    const r = FireCore.reaction(e, {}, plain);
    assert.equal(r.sway, false);
    assert.ok(r.sparks > 0 && r.sparks <= LIMITS.sparksMax);
  }
});

test('неизвестное событие — null', () => {
  assert.equal(FireCore.reaction('nope', {}, plain), null);
});

test('на «Спокойно» мягче', () => {
  for (const [e, d] of [['match', { chain: 4 }], ['special', {}], ['blast', { type: 'sun' }], ['win', {}]]) {
    const a = FireCore.reaction(e, d, plain);
    const b = FireCore.reaction(e, d, { ...plain, calm: true });
    assert.ok(Math.abs(b.flare - a.flare * LIMITS.calmFactor) < 1e-12, e);
    assert.equal(b.sparks, Math.floor(a.sparks / 2), e);
  }
  assert.equal(FireCore.reaction('match', { chain: 1 }, { ...plain, calm: true }).sway, true);
});

test('reduced — нет реакции', () => {
  const ctx = { ...plain, reduced: true };
  assert.equal(FireCore.reaction('match', { chain: 1 }, ctx), null);
  assert.equal(FireCore.reaction('match', { chain: 5 }, ctx), null);
  assert.equal(FireCore.reaction('special', {}, ctx), null);
  assert.equal(FireCore.reaction('blast', { type: 'sun' }, ctx), null);
  assert.equal(FireCore.reaction('win', {}, ctx), null);
});

test('low — без искр', () => {
  const ctx = { ...plain, low: true };
  for (const [e, d] of [['match', { chain: 9 }], ['special', {}], ['blast', {}], ['win', {}]]) {
    const r = FireCore.reaction(e, d, ctx);
    assert.equal(r.sparks, 0, e);
    assert.ok(r.flare > 0, e);
  }
});

test('огибающая', () => {
  const total = LIMITS.attackMs + LIMITS.holdMs + LIMITS.releaseMs;
  const s = 0.8;
  assert.equal(FireCore.envelope(0, 1), 0);
  assert.equal(FireCore.envelope(LIMITS.attackMs, 1), 1);
  assert.equal(FireCore.envelope(LIMITS.attackMs + LIMITS.holdMs / 2, s), s);
  assert.equal(FireCore.envelope(total, 1), 0);
  assert.equal(FireCore.envelope(total + 5000, 1), 0);
  assert.equal(FireCore.envelope(-10, 1), 0);
  let prev = 0;
  for (let t = 0; t <= total; t += 1) {
    const e = FireCore.envelope(t, s);
    assert.ok(e >= 0 && e <= s, 't=' + t);
    if (t <= LIMITS.attackMs) assert.ok(e >= prev, 'рост t=' + t);
    else if (t >= LIMITS.attackMs + LIMITS.holdMs) assert.ok(e <= prev, 'спад t=' + t);
    prev = e;
  }
});

test('скорость кадров при вспышке: от 1 до flareSpeed', () => {
  assert.equal(FireCore.flareSpeed(0), 1);
  assert.equal(FireCore.flareSpeed(1), LIMITS.flareSpeed);
  assert.ok(Math.abs(FireCore.flareSpeed(0.5) - (1 + (LIMITS.flareSpeed - 1) * 0.5)) < 1e-12);
});

test('кадр в пределах', () => {
  for (let i = 0; i < 1000; i++) {
    const t = Math.random() * 100000;
    const speed = 0.5 + Math.random() * 1.5;
    const phase = Math.random() * 200 - 50;
    const f = FireCore.frameAt(t, SHEET, speed, phase);
    assert.ok(Number.isInteger(f), 'целое');
    assert.ok(f >= 0 && f < SHEET.frames, 'в пределах: ' + f);
  }
  assert.equal(FireCore.frameAt(0, SHEET, 1, 0), 0);
  assert.equal(FireCore.frameAt(1000, SHEET, 1, 0), SHEET.fps % SHEET.frames);
  assert.equal(FireCore.frameAt(0, SHEET, 1, 5), 5);
});

test('свет ограничен', () => {
  assert.ok(FireCore.glow(0.4, 1, 0.08) <= LIMITS.glowMax);
  assert.ok(FireCore.glow(0, 0, -0.08) >= 0);
  assert.ok(FireCore.glow(0.9, 5, 1) <= LIMITS.glowMax);
  assert.ok(FireCore.glow(-1, 0, -1) >= 0);
});

test('мерцание мягкое', () => {
  const amp = LIMITS.flickerAmp;
  const maxStep = amp * 2 * Math.PI * LIMITS.flickerHz / 60 * 1.1;
  for (const seed of [0, 1, 2.5, 7]) {
    let prev = FireCore.flicker(0, seed);
    for (let i = 1; i <= 600; i++) {
      const v = FireCore.flicker(i / 60, seed);
      assert.ok(Math.abs(v) <= amp, 'размах, seed ' + seed);
      assert.ok(Math.abs(v - prev) <= maxStep, 'ступень, seed ' + seed);
      prev = v;
    }
  }
});

test('скорость по тревоге', () => {
  assert.equal(FireCore.speedFor(''), 1);
  assert.equal(FireCore.speedFor('tense'), 1.25);
  assert.equal(FireCore.speedFor('urgent'), 1.5);
  assert.equal(FireCore.speedFor('что-то'), 1);
  assert.equal(FireCore.speedFor(undefined), 1);
});

test('слабый компьютер', () => {
  assert.equal(FireCore.lowFps(new Array(60).fill(50)), true);
  assert.equal(FireCore.lowFps(new Array(188).fill(16)), false);
  assert.equal(FireCore.lowFps([]), false);
  // меньше 3 с данных — решения пока нет
  assert.equal(FireCore.lowFps(new Array(10).fill(80)), false);
  // старые медленные кадры за окном 3 с не считаются
  assert.equal(FireCore.lowFps([200, 200].concat(new Array(190).fill(16))), false);
});
