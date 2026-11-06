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

test('продолжение с середины земли: ни пролога, ни вступления', () => {
  const save = saveWith({ '1-01': PASSED, '1-02': PASSED });
  assert.deepEqual(Story.nextScenes(save, '1-03', Campaign), []);
});

test('вторая земля: только своё вступление, пролога нет', () => {
  const save = saveWith({ '1-01': PASSED }, []);
  assert.deepEqual(Story.nextScenes(save, LAND2_FIRST, Campaign), ['2-intro']);
  assert.deepEqual(Story.nextScenes(saveWith({ '1-01': PASSED }, ['2-intro']), LAND2_FIRST, Campaign), []);
});

test('неизвестный уровень и пустой аргумент не ломают выбор', () => {
  assert.deepEqual(Story.nextScenes(saveWith(), '99-01', Campaign), []);
  assert.deepEqual(Story.nextScenes(null, FIRST, Campaign), ['prologue', '1-intro']);
});
