'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Campaign = require('../js/campaign/campaign.js');

test('в кампании 2 земли и 40 уровней с уникальными id', () => {
  assert.equal(Campaign.lands().length, 2);
  const ids = Campaign.allLevelIds();
  assert.equal(ids.length, 40);
  assert.equal(new Set(ids).size, 40);
  assert.equal(ids[0], '1-01');
  assert.equal(ids[19], '1-20');
  assert.equal(ids[20], '2-01');
  assert.equal(ids[39], '2-20');
});

test('validate() пуст', () => {
  assert.deepEqual(Campaign.validate(), []);
});

test('validate() находит ошибки данных', () => {
  const lvl = Campaign.lands()[1].levels[0];
  const saved = lvl.vines;
  lvl.vines = [[0, 0], [0, 0], [9, 1]];
  const errors = Campaign.validate();
  lvl.vines = saved;
  assert.ok(errors.length >= 2);
  assert.deepEqual(Campaign.validate(), []);
});

test('validate() запрещает две цели одного цвета в уровне', () => {
  const lvl = Campaign.lands()[0].levels[0];
  const saved = lvl.goals;
  lvl.goals = [{ type: 'color', color: 1, need: 5 }, { type: 'color', color: 1, need: 7 }];
  const errors = Campaign.validate();
  lvl.goals = saved;
  assert.ok(errors.some(e => e.indexOf('одного цвета') >= 0), errors.join('; '));
  assert.deepEqual(Campaign.validate(), []);
});

test('resolve calm: timer null, econTime = level.time', () => {
  const lvl = Campaign.level('1-01');
  const r = Campaign.resolve('1-01', 'calm');
  assert.equal(r.timer, null);
  assert.equal(r.econTime, lvl.time);
  assert.equal(r.landId, 1);
  assert.equal(r.name, lvl.name);
  assert.deepEqual(r.goals, [{ type: 'color', color: 0, need: 12 }, { type: 'color', color: 2, need: 12 }]);
});

test('resolve normal: timer = econTime = level.time', () => {
  const lvl = Campaign.level('1-02');
  const r = Campaign.resolve('1-02', 'normal');
  assert.equal(r.timer, lvl.time);
  assert.equal(r.econTime, lvl.time);
});

test('resolve challenge: время ×0.8 и need ×1.3 вверх', () => {
  const r = Campaign.resolve('1-01', 'challenge');
  assert.equal(r.timer, 96);
  assert.equal(r.econTime, 96);
  assert.deepEqual(r.goals.map(g => g.need), [16, 16]);
});

test('resolve не меняет исходные данные', () => {
  Campaign.resolve('1-01', 'challenge');
  assert.equal(Campaign.level('1-01').goals[0].need, 12);
});

test('resolve: need цели vines = число лиан, на challenge включает доп. лианы', () => {
  const lvl = Campaign.level('2-01');
  assert.equal(lvl.vines.length, 4);
  const normal = Campaign.resolve('2-01', 'normal');
  assert.equal(normal.goals.find(g => g.type === 'vines').need, 4);
  assert.equal(normal.vines.length, 4);

  const extra = Campaign.level('2-10');
  assert.ok(extra.challenge && extra.challenge.vines.length > 0);
  const base = Campaign.resolve('2-10', 'normal');
  const hard = Campaign.resolve('2-10', 'challenge');
  assert.equal(hard.vines.length, base.vines.length + extra.challenge.vines.length);
  assert.equal(hard.goals.find(g => g.type === 'vines').need, hard.vines.length);
});

test('2-01: 4 лианы, одна цель цвета и цель лиан', () => {
  const lvl = Campaign.level('2-01');
  assert.equal(lvl.goals.filter(g => g.type === 'color').length, 1);
  assert.ok(lvl.goals.some(g => g.type === 'vines'));
});

test('в земле 2 в каждом уровне есть лианы, в земле 1 их нет', () => {
  for (const id of Campaign.allLevelIds()) {
    const lvl = Campaign.level(id);
    if (id.startsWith('2-')) assert.ok(lvl.vines.length > 0, id);
    else assert.ok(!lvl.vines || lvl.vines.length === 0, id);
  }
});

test('nextLevelId', () => {
  assert.equal(Campaign.nextLevelId('1-01'), '1-02');
  assert.equal(Campaign.nextLevelId('1-20'), '2-01');
  assert.equal(Campaign.nextLevelId('2-20'), null);
  assert.equal(Campaign.nextLevelId('9-99'), null);
});

test('level / landOf', () => {
  assert.equal(Campaign.level('9-99'), null);
  assert.equal(Campaign.landOf('2-05').key, Campaign.lands()[1].key);
  assert.equal(Campaign.landOf('1-05').id, 1);
});

test('названия 1-02 и 1-03 не совпадают с названиями земель', () => {
  const banned = ['Храм Змея', 'Лунные пещеры', 'Джунгли Ягуара', 'Храм Пернатого Змея', 'Пещера Лунного Света'];
  for (const id of ['1-02', '1-03']) {
    assert.ok(!banned.includes(Campaign.level(id).name), id);
  }
  const landNames = Campaign.lands().map(l => l.name);
  for (const id of Campaign.allLevelIds()) {
    const name = Campaign.level(id).name;
    assert.ok(!landNames.includes(name) && !banned.includes(name), id);
    assert.ok(name.length > 0 && name.length <= 28, id);
  }
});

test('первые 4 уровня сохраняют цели и время старой игры', () => {
  const expected = {
    '1-01': [120, [[0, 12], [2, 12]]],
    '1-02': [130, [[1, 14], [3, 14], [5, 9]]],
    '1-03': [140, [[4, 18], [2, 16]]],
    '1-04': [155, [[0, 18], [1, 18], [4, 14]]]
  };
  for (const id of Object.keys(expected)) {
    const lvl = Campaign.level(id);
    assert.equal(lvl.time, expected[id][0]);
    assert.deepEqual(lvl.goals.map(g => [g.color, g.need]), expected[id][1]);
    assert.ok(lvl.goals.every(g => g.type === 'color'));
  }
});

test('тексты: пролог и сцены земель короткие', () => {
  assert.equal(Campaign.PROLOGUE.length, 3);
  const lines = [...Campaign.PROLOGUE];
  for (const land of Campaign.lands()) {
    for (const part of ['intro', 'outro']) {
      const s = land.scenes[part];
      assert.ok(s.length >= 2 && s.length <= 3, land.key + part);
      lines.push(...s);
    }
  }
  for (const l of lines) assert.ok(l.length > 0 && l.length <= 120, l);
});

test('DIFFICULTIES', () => {
  assert.deepEqual(Campaign.DIFFICULTIES, ['calm', 'normal', 'challenge']);
});
