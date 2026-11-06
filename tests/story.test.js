'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Campaign = require('../js/campaign/campaign.js');
const Progress = require('../js/campaign/progress.js');
const Story = require('../js/screens/story.js');

const FIRST = Campaign.allLevelIds()[0];
const LAND2_FIRST = Campaign.lands()[1].levels[0].id;

function saveWith(levels, seen) {
  const s = Progress.empty();
  Object.keys(levels || {}).forEach(id => { s.levels[id] = levels[id]; });
  s.seenScenes = (seen || []).slice();
  return s;
}

const PASSED = { calm: { score: 1000, stars: 1 } };

test('новый игрок: пролог и вступление первой земли', () => {
  assert.deepEqual(Story.nextScenes(saveWith(), FIRST, Campaign), ['prologue', '1-intro']);
});

test('пролог показан — остаётся вступление', () => {
  assert.deepEqual(Story.nextScenes(saveWith({}, ['prologue']), FIRST, Campaign), ['1-intro']);
});

test('всё показано — сцен нет', () => {
  assert.deepEqual(Story.nextScenes(saveWith({}, ['prologue', '1-intro']), FIRST, Campaign), []);
});

test('старое сохранение на 1-05: пролог и вступление один раз', () => {
  const save = saveWith({ '1-01': PASSED, '1-02': PASSED, '1-03': PASSED, '1-04': PASSED });
  assert.deepEqual(Story.nextScenes(save, '1-05', Campaign), ['prologue', '1-intro']);
  const seen = saveWith({ '1-01': PASSED, '1-02': PASSED, '1-03': PASSED, '1-04': PASSED }, ['prologue', '1-intro']);
  assert.deepEqual(Story.nextScenes(seen, '1-05', Campaign), []);
});

test('вторая земля: пролог уже показан — только своё вступление', () => {
  const save = saveWith({ '1-01': PASSED }, ['prologue']);
  assert.deepEqual(Story.nextScenes(save, LAND2_FIRST, Campaign), ['2-intro']);
  assert.deepEqual(Story.nextScenes(saveWith({ '1-01': PASSED }, ['prologue', '2-intro']), LAND2_FIRST, Campaign), []);
});

test('неизвестный уровень и пустой аргумент не ломают выбор', () => {
  assert.deepEqual(Story.nextScenes(saveWith(), '99-01', Campaign), []);
  assert.deepEqual(Story.nextScenes(null, FIRST, Campaign), ['prologue', '1-intro']);
});

function passLand(id) {
  const o = {};
  Campaign.lands().find(l => l.id === id).levels.forEach(l => { o[l.id] = PASSED; });
  return o;
}

test('земля пройдена, финал не показан: перед 2-01 идёт финал 1 и вступление 2', () => {
  const save = saveWith(passLand(1), ['prologue', '1-intro']);
  assert.deepEqual(Story.nextScenes(save, LAND2_FIRST, Campaign), ['1-outro', '2-intro']);
});

test('пролог не показан, земля пройдена: пролог, финал, вступление', () => {
  const save = saveWith(passLand(1), []);
  assert.deepEqual(Story.nextScenes(save, LAND2_FIRST, Campaign), ['prologue', '1-outro', '2-intro']);
});

test('финал уже показан или земля не пройдена: финал не повторяется', () => {
  const seen = saveWith(passLand(1), ['prologue', '1-intro', '1-outro']);
  assert.deepEqual(Story.nextScenes(seen, LAND2_FIRST, Campaign), ['2-intro']);
  const notDone = passLand(1);
  delete notDone['1-20'];
  assert.deepEqual(Story.nextScenes(saveWith(notDone, ['prologue', '1-intro']), LAND2_FIRST, Campaign), ['2-intro']);
});

test('landDone: последний уровень пройден на любой сложности', () => {
  const land1 = Campaign.lands()[0];
  assert.equal(Story.landDone(saveWith(), land1), false);
  assert.equal(Story.landDone(saveWith({ '1-20': { challenge: { score: 5, stars: 1 } } }), land1), true);
});

test('«История»: финал пройденной земли предлагается, даже если он не показан', () => {
  const done = saveWith(passLand(1), ['prologue', '1-intro']);
  assert.deepEqual(Story.replayIds(done, 1, Campaign), ['prologue', '1-intro', '1-outro']);
  const partial = saveWith({ '1-01': PASSED }, ['prologue', '1-intro']);
  assert.deepEqual(Story.replayIds(partial, 1, Campaign), ['prologue', '1-intro']);
  const seenOnly = saveWith({}, ['2-outro']);
  assert.deepEqual(Story.replayIds(seenOnly, 2, Campaign), ['2-intro', '2-outro']);
});
