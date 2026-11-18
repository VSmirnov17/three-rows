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

/* ---------- runMove: учёт целей на собранном вручную поле ---------- */

const Board = require('../js/core/board.js');
const Economy = require('../js/economy.js');
const { runMove, mulberry32, parseArgs } = require('../tools/level-bot.js');
const { gridFrom } = require('./helpers/grid.js');

/* Поле без совпадений: цвет (c + 2r) % 6. В верхнем ряду собираем 0 0 [0]:
   обмен (0,2)<->(1,2) даёт ровно одну тройку нулей в ряду 0. */
const ROWS = [
  '01234501', '23450123', '45012345', '01234501',
  '23450123', '45012345', '01234501', '23450123'
].map(s => s.split(''));
ROWS[0][1] = '0';
ROWS[1][2] = '0';
const MOVE = [{ r: 0, c: 2 }, { r: 1, c: 2 }];
const TOTAL = 200;

function build(extras) {
  return gridFrom(ROWS.map(r => r.join('')), extras);
}

/* Сид, при котором досыпка не даёт каскадов: ровно одна тройка. */
function singleCascadeSeed() {
  for (let seed = 1; seed < 200; seed++) {
    let id = 1000000;
    const res = Board.simulateMove(build(), MOVE[0], MOVE[1], mulberry32(seed), () => ++id, { colors: 6 });
    if (res && res.cascades.length === 1) return seed;
  }
  throw new Error('не нашли сид без каскадов');
}
const SEED = singleCascadeSeed();

function expectedScore(cells, goalCells, timeLeft) {
  return Economy.clearDetail({ cells, goalCells, chain: 1, creates: [], triggers: [], timeLeft, totalTime: TOTAL }).score;
}

test('runMove: goalCells ограничены остатком цели', () => {
  const r = runMove(build(), MOVE[0], MOVE[1], SEED, { colorLeft: new Map([[0, 2]]), vinesLeft: 0 }, [TOTAL * 0.5], TOTAL);
  assert.equal(r.gained.colors.get(0), 2);
  assert.equal(r.progress, 2);
  assert.equal(r.score, expectedScore(3, 2, TOTAL * 0.5));
});

test('runMove: цель шире тройки — засчитываются все три', () => {
  const r = runMove(build(), MOVE[0], MOVE[1], SEED, { colorLeft: new Map([[0, 9]]), vinesLeft: 0 }, [TOTAL * 0.5], TOTAL);
  assert.equal(r.gained.colors.get(0), 3);
  assert.equal(r.score, expectedScore(3, 3, TOTAL * 0.5));
});

test('runMove: чужой цвет цели не растёт, очки идут без goalCells', () => {
  const r = runMove(build(), MOVE[0], MOVE[1], SEED, { colorLeft: new Map([[4, 9]]), vinesLeft: 0 }, [TOTAL * 0.5], TOTAL);
  assert.equal(r.gained.colors.size, 0);
  assert.equal(r.progress, 0);
  assert.equal(r.score, expectedScore(3, 0, TOTAL * 0.5));
});

test('runMove: камень в лианах не собран, лиана только срывается', () => {
  const grid = build({ '0,1': { locked: true } });
  const r = runMove(grid, MOVE[0], MOVE[1], SEED, { colorLeft: new Map([[0, 9]]), vinesLeft: 3 }, [TOTAL * 0.5], TOTAL);
  assert.equal(r.gained.colors.get(0), 2, 'цвет считают только убранные камни');
  assert.equal(r.gained.vines, 1);
  assert.equal(r.progress, 3);
  assert.equal(r.score, expectedScore(2, 2, TOTAL * 0.5));
  assert.equal(grid[0][1].locked, false);
});

test('runMove: цель лиан ограничена остатком', () => {
  const grid = build({ '0,1': { locked: true } });
  const r = runMove(grid, MOVE[0], MOVE[1], SEED, { colorLeft: new Map(), vinesLeft: 0 }, [TOTAL * 0.5], TOTAL);
  assert.equal(r.gained.vines, 0);
});

test('runMove: «Спокойно» и «Обычно» считают очки по своим часам', () => {
  const calm = TOTAL * 0.5;
  const timed = TOTAL - 5 * 7;
  const r = runMove(build(), MOVE[0], MOVE[1], SEED, { colorLeft: new Map([[0, 9]]), vinesLeft: 0 }, [calm, timed], TOTAL);
  assert.equal(r.scores[0], expectedScore(3, 3, calm));
  assert.equal(r.scores[1], expectedScore(3, 3, timed));
  assert.notEqual(r.scores[0], r.scores[1]);
});

test('runMove: недопустимый обмен даёт null', () => {
  const r = runMove(build(), { r: 3, c: 3 }, { r: 3, c: 4 }, SEED, { colorLeft: new Map(), vinesLeft: 0 }, [TOTAL], TOTAL);
  assert.equal(r, null);
});

test('parseArgs отвергает мусорные значения', () => {
  assert.throws(() => parseArgs(['--check', '--seeds', 'abc']));
  assert.throws(() => parseArgs(['--check', '--seeds', '0']));
  assert.throws(() => parseArgs(['--check', '--seed-offset', '-1']));
  assert.throws(() => parseArgs(['--check', '--bogus']));
  assert.equal(parseArgs(['--check', '--seed-offset', '1000']).offset, 1000);
});

test('runMove: плиты под рядом идут в прогресс, очков не добавляют', () => {
  const plates = Board.makePlates([[0, 0], [0, 1], [5, 5]]);
  const r = runMove(build(), MOVE[0], MOVE[1], SEED, { colorLeft: new Map(), vinesLeft: 0, platesLeft: 3 }, [TOTAL * 0.5], TOTAL, plates);
  assert.equal(r.gained.plates, 2);
  assert.equal(r.progress, 2);
  assert.equal(r.score, expectedScore(3, 0, TOTAL * 0.5));
  assert.equal(Board.platesLeft(plates), 1, 'слой плит меняется');
});

test('playLevel: уровень только с плитами проходится, пока плиты не сняты', () => {
  const resolved = {
    id: 't-plates', timer: null, econTime: 300, vines: [],
    plates: [[3, 3], [3, 4], [4, 3], [4, 4]],
    goals: [{ type: 'plates', need: 4 }]
  };
  const r = playLevel(resolved, 1, { policy: 'greedy' });
  assert.equal(r.won, true);
  assert.ok(r.moves >= 1);
});

test('playLevel: уровень с валунами проходится, пока валуны не разбиты', () => {
  const resolved = {
    id: 't-boulders', timer: null, econTime: 300, vines: [], plates: [],
    boulders: [[3, 3, 1], [4, 4, 2]],
    goals: [{ type: 'boulders', need: 2 }]
  };
  const r = playLevel(resolved, 1, { policy: 'greedy' });
  assert.equal(r.won, true);
  assert.ok(r.moves >= 2, 'крепкому валуну нужно два удара');
});

test('playLevel: уровень с идолами проходится, когда оба опустились на дно', () => {
  const resolved = {
    id: 't-relics', timer: null, econTime: 300, vines: [], plates: [], boulders: [],
    relics: [[0, 2], [0, 5]],
    goals: [{ type: 'relics', need: 2 }]
  };
  const r = playLevel(resolved, 1, { policy: 'greedy' });
  assert.equal(r.won, true);
  assert.ok(r.moves >= 2, 'идолу нужно несколько ходов до дна');
});
