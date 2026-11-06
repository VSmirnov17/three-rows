'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Campaign = require('../js/campaign/campaign.js');
const { playLevel, percentile } = require('../tools/level-bot.js');

test('бот проходит 1-01 на «Спокойно» и детерминирован', () => {
  const resolved = Campaign.resolve('1-01', 'calm');
  const a = playLevel(resolved, 1, { policy: 'greedy' });
  const b = playLevel(resolved, 1, { policy: 'greedy' });
  assert.equal(a.won, true);
  assert.ok(a.moves > 0 && a.moves <= 150);
  assert.ok(a.score > 0);
  assert.equal(a.moves, b.moves);
  assert.equal(a.score, b.score);
});

test('бот проходит 2-01 (лианы), политика human детерминирована', () => {
  const resolved = Campaign.resolve('2-01', 'calm');
  const a = playLevel(resolved, 1, { policy: 'human' });
  const b = playLevel(resolved, 1, { policy: 'human' });
  assert.equal(a.won, true);
  assert.equal(a.moves, b.moves);
  assert.equal(a.score, b.score);
});

test('percentile считает с интерполяцией', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([10, 20], 50), 15);
  assert.equal(percentile([7], 90), 7);
});
