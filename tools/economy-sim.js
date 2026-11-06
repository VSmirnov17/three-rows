#!/usr/bin/env node
/* Сокровища Солнца — симулятор экономики.
 *
 * Запуск:  node tools/economy-sim.js
 *
 * Скрипт не копирует формулы: он требует js/economy.js и вызывает
 * Economy.clearDetail / levelBonus / speedRating. Меняете константы в
 * economy.js — сразу видите, как меняется отрыв быстрого игрока.
 */
'use strict';

const path = require('path');
const Economy = require(path.join(__dirname, '..', 'js', 'economy.js'));

/* Данные уровней повторяют LEVELS из js/game.js. */
const LEVELS = [
  {
    name: 'Тропа Ягуара',
    time: 120,
    goals: [{ color: 0, need: 12 }, { color: 2, need: 12 }]
  },
  {
    name: 'Храм Пернатого Змея',
    time: 130,
    goals: [{ color: 1, need: 14 }, { color: 3, need: 14 }, { color: 5, need: 9 }]
  },
  {
    name: 'Пещера Лунного Света',
    time: 140,
    goals: [{ color: 4, need: 18 }, { color: 2, need: 16 }]
  },
  {
    name: 'Золотое Солнце',
    time: 155,
    goals: [{ color: 0, need: 18 }, { color: 1, need: 18 }, { color: 4, need: 14 }]
  }
];

const PROFILES = {
  fast: {
    key: 'fast',
    title: 'быстрый',
    secPerMove: 3.2,      // думает и играет без пауз
    budgetShare: 0.42,    // цель — закрыть за ~40% времени (страховка)
    goalBias: 1.12,       // прицельно бьёт по нужным цветам
    idleGoalShare: 0      // пустых ходов не делает
  },
  slow: {
    key: 'slow',
    title: 'медленный',
    secPerMove: 3.6,      // играет чуть медленнее и тянет с закрытием целей
    budgetShare: 0.97,    // досиживает почти до конца
    goalBias: 1.0,
    idleGoalShare: 0.08   // «пустые» ходы почти не двигают цели
  }
};

/* --- Детерминированный ГПСЧ, чтобы таблица не прыгала между запусками --- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rng, items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= items[i].weight;
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* Базовые фигуры: тройка, линия 4, линия 5, квадрат 2×2, уголок 5. */
const PATTERNS = [
  { kind: 'triple', cells: 3, create: null, weight: 50 },
  { kind: 'line4', cells: 4, create: 'line', weight: 24 },
  { kind: 'line5', cells: 5, create: 'sun', weight: 8 },
  { kind: 'square', cells: 4, create: 'bomb', weight: 12 },
  { kind: 'corner', cells: 5, create: 'totem', weight: 6 }
];

const CASCADE_COUNTS = [
  { value: 1, weight: 58 },
  { value: 2, weight: 25 },
  { value: 3, weight: 11 },
  { value: 4, weight: 6 }
];

const TRIGGERS = [
  { type: 'line', weight: 55 },
  { type: 'sun', weight: 15 },
  { type: 'bomb', weight: 20 },
  { type: 'totem', weight: 10 }
];

const AVG_CELLS = 5.7;

function goalColors(level) {
  return new Set(level.goals.map(g => g.color)).size;
}

function goalNeed(level) {
  return level.goals.reduce((sum, g) => sum + g.need, 0);
}

function goalShare(level) {
  return goalColors(level) / 6;
}

/* Один ход: основная фигура + каскады + возможный взрыв спецкамня.
 * Возвращает раскладку по каскадам и потраченное время. */
function playMove(rng, level, elapsed, opts) {
  const totalTime = level.time;
  const pattern = pickWeighted(rng, PATTERNS);
  const cascadeCount = pickWeighted(rng, CASCADE_COUNTS).value;

  const cascades = [];
  cascades.push({
    cells: pattern.cells,
    create: pattern.create,
    chain: 1
  });

  for (let i = 1; i < cascadeCount; i++) {
    const cells = 3 + Math.floor(rng() * 2); // 3–4
    cascades.push({
      cells: cells,
      create: rng() < 0.06 ? 'line' : null,
      chain: i + 1
    });
  }

  /* 12% ходов игрок активирует накопленный спецкамень. */
  let trigger = null;
  if (rng() < 0.12) {
    trigger = pickWeighted(rng, TRIGGERS).type;
    cascades[0].cells += trigger === 'sun' ? 9 : 6;
  }

  const needLeft = goalNeed(level) - opts.progress;
  const share = opts.goalBias * goalShare(level);
  let goalLeft = Math.max(0, needLeft);

  const details = [];
  let spent = 0;
  let oldGain = 0;

  cascades.forEach((item, index) => {
    /* Очки по старой формуле — только для наглядного сравнения в отчёте. */
    const oldMult = Math.min(8, item.chain + 1);
    oldGain += Math.round(item.cells * 20 * oldMult + (item.create ? 1 : 0) * 40);

    const at = elapsed + spent;
    const timeLeft = Math.max(0.01, totalTime - at);

    let goalCells = Math.round(item.cells * share * Math.min(1, item.chain === 1 ? 1 : 0.9));
    if (opts.idle) goalCells = Math.round(item.cells * opts.idleGoalShare);
    goalCells = Math.max(0, Math.min(goalCells, goalLeft));
    goalLeft -= goalCells;

    const creates = item.create ? [{ type: item.create }] : [];
    const triggers = trigger && index === 0 ? [{ type: trigger }] : [];

    const detail = Economy.clearDetail({
      cells: item.cells,
      goalCells: goalCells,
      chain: item.chain,
      creates: creates,
      triggers: triggers,
      timeLeft: timeLeft,
      totalTime: totalTime
    });

    details.push(detail);
    opts.progress += goalCells;
    spent += 0.38; // анимация каскада
  });

  const duration = opts.profile.secPerMove + Math.max(0, cascades.length - 1) * 0.45;
  return { details: details, duration: duration + spent * 0.1, oldGain: oldGain };
}

/* Быстрый игрок: играет, пока цели не закрыты. */
function simulateFast(level, levelIndex, seed) {
  const profile = PROFILES.fast;
  const rng = mulberry32(seed);
  const need = goalNeed(level);
  const progressState = { progress: 0 };
  const acc = { base: 0, clear: 0, moves: 0, cells: 0, old: 0 };
  let elapsed = 0;

  while (progressState.progress < need && elapsed < level.time) {
    const move = playMove(rng, level, elapsed, {
      profile: profile,
      progress: progressState.progress,
      goalBias: profile.goalBias,
      idle: false,
      idleGoalShare: 0,
      need: need
    });
    move.details.forEach(detail => {
      acc.base += detail.raw;
      acc.clear += detail.score;
      acc.cells += detail.cells;
    });
    acc.old += move.oldGain;
    acc.moves++;
    elapsed += move.duration;
    let gained = 0;
    move.details.forEach(detail => { gained += detail.goalCells; });
    progressState.progress += gained;
  }

  const timeLeft = Math.max(0, level.time - elapsed);
  const bonus = Economy.levelBonus({ timeLeft: timeLeft, totalTime: level.time, levelIndex: levelIndex });
  const oldBonus = Math.floor(timeLeft) * 10;
  const rating = Economy.speedRating({ timeLeft: timeLeft, totalTime: level.time });

  return {
    profile: profile.key,
    moves: acc.moves,
    elapsed: elapsed,
    base: acc.base,
    clear: acc.clear,
    bonus: bonus,
    total: acc.clear + bonus,
    old: acc.old + oldBonus,
    pace: acc.base > 0 ? acc.clear / acc.base : 1,
    stars: rating.stars,
    rank: rating.rank
  };
}

/* Медленный игрок: сначала «пустые» ходы, потом закрытие целей в конце. */
function simulateSlow(level, levelIndex, seed) {
  const profile = PROFILES.slow;
  const rng = mulberry32(seed);
  const need = goalNeed(level);
  const share = goalShare(level);
  const goalRate = AVG_CELLS * share * profile.goalBias;
  const idleRate = AVG_CELLS * profile.idleGoalShare;

  /* Сколько ходов влезает в отведённое время. */
  const budget = level.time * profile.budgetShare;
  const maxMoves = Math.max(4, Math.floor(budget / (profile.secPerMove + 0.55)));

  /* Подбираем число пустых ходов так, чтобы цели закрылись к концу. */
  let idleMoves = 0;
  if (goalRate > idleRate) {
    idleMoves = Math.round((goalRate * maxMoves - need) / (goalRate - idleRate));
  }
  idleMoves = Math.max(0, Math.min(maxMoves - 1, idleMoves));

  const acc = { base: 0, clear: 0, moves: 0, cells: 0, old: 0 };
  let progress = 0;
  let elapsed = 0;

  for (let i = 0; i < idleMoves && elapsed < budget; i++) {
    const move = playMove(rng, level, elapsed, {
      profile: profile,
      progress: progress,
      goalBias: profile.goalBias,
      idle: true,
      idleGoalShare: profile.idleGoalShare,
      need: need
    });
    move.details.forEach(detail => {
      acc.base += detail.raw;
      acc.clear += detail.score;
      acc.cells += detail.cells;
      progress += detail.goalCells;
    });
    acc.old += move.oldGain;
    acc.moves++;
    elapsed += move.duration;
  }

  /* Добиваем цели уже прицельными ходами — они идут на низком темпе. */
  let guard = 0;
  while (progress < need && elapsed < level.time && guard < 200) {
    guard++;
    const move = playMove(rng, level, elapsed, {
      profile: profile,
      progress: progress,
      goalBias: profile.goalBias,
      idle: false,
      idleGoalShare: 0,
      need: need
    });
    move.details.forEach(detail => {
      acc.base += detail.raw;
      acc.clear += detail.score;
      acc.cells += detail.cells;
      progress += detail.goalCells;
    });
    acc.old += move.oldGain;
    acc.moves++;
    elapsed += move.duration;
  }

  /* Если не успел — это проигрыш; в таблице такие случаи быть не должно. */
  const timeLeft = Math.max(0, level.time - elapsed);
  const bonus = Economy.levelBonus({ timeLeft: timeLeft, totalTime: level.time, levelIndex: levelIndex });
  const oldBonus = Math.floor(timeLeft) * 10;
  const rating = Economy.speedRating({ timeLeft: timeLeft, totalTime: level.time });

  return {
    profile: profile.key,
    moves: acc.moves,
    elapsed: elapsed,
    base: acc.base,
    clear: acc.clear,
    bonus: bonus,
    total: acc.clear + bonus,
    old: acc.old + oldBonus,
    pace: acc.base > 0 ? acc.clear / acc.base : 1,
    stars: rating.stars,
    rank: rating.rank,
    won: progress >= need
  };
}

function fmt(number) {
  return Math.round(number).toLocaleString('ru-RU');
}

function fmtPace(value) {
  return '×' + value.toFixed(2).replace('.', ',');
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function avg(list) {
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

function run(level, levelIndex, profile, runs) {
  const out = [];
  for (let i = 0; i < runs; i++) {
    const seed = 1000 + levelIndex * 7919 + (profile.key === 'fast' ? 13 : 29) * 104729 + i * 37;
    out.push(profile.key === 'fast'
      ? simulateFast(level, levelIndex, seed)
      : simulateSlow(level, levelIndex, seed));
  }
  return {
    moves: avg(out.map(r => r.moves)),
    elapsed: avg(out.map(r => r.elapsed)),
    base: avg(out.map(r => r.base)),
    clear: avg(out.map(r => r.clear)),
    bonus: avg(out.map(r => r.bonus)),
    total: avg(out.map(r => r.total)),
    old: avg(out.map(r => r.old)),
    pace: avg(out.map(r => r.pace)),
    stars: avg(out.map(r => r.stars)),
    winRate: avg(out.map(r => (r.won === false ? 0 : 1)))
  };
}

function pad(value, width) {
  const text = String(value);
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function padStart(value, width) {
  const text = String(value);
  return ' '.repeat(Math.max(0, width - text.length)) + text;
}

function main() {
  const runs = 160;
  const divider = '─'.repeat(101);

  console.log('');
  console.log('Сокровища Солнца — симуляция экономики');
  console.log('Формула и константы: js/economy.js');
  console.log(divider);
  console.log(
    pad('Уровень', 28) +
    padStart('Время', 7) +
    padStart('Игрок', 10) +
    padStart('Ходов', 7) +
    padStart('Доля', 6) +
    padStart('База', 9) +
    padStart('Темп', 8) +
    padStart('Бонус', 8) +
    padStart('ИТОГО', 10) +
    padStart('Звёзды', 8)
  );
  console.log(divider);

  const summary = [];

  LEVELS.forEach((level, index) => {
    const fast = run(level, index, PROFILES.fast, runs);
    const slow = run(level, index, PROFILES.slow, runs);
    const diff = ((fast.total - slow.total) / slow.total) * 100;
    summary.push({ level: level.name, diff: diff, fast: fast, slow: slow });

    const name = (index + 1) + '. ' + level.name;
    console.log(
      pad(name, 28) +
      padStart(fmtTime(level.time), 7) +
      padStart('быстрый', 10) +
      padStart(fmt(fast.moves), 7) +
      padStart(Math.round(fast.elapsed / level.time * 100) + '%', 6) +
      padStart(fmt(fast.base), 9) +
      padStart(fmtPace(fast.pace), 8) +
      padStart('+' + fmt(fast.bonus), 8) +
      padStart(fmt(fast.total), 10) +
      padStart('★'.repeat(Math.round(fast.stars)), 8)
    );
    console.log(
      pad('', 28) +
      padStart('', 7) +
      padStart('медленный', 10) +
      padStart(fmt(slow.moves), 7) +
      padStart(Math.round(slow.elapsed / level.time * 100) + '%', 6) +
      padStart(fmt(slow.base), 9) +
      padStart(fmtPace(slow.pace), 8) +
      padStart('+' + fmt(slow.bonus), 8) +
      padStart(fmt(slow.total), 10) +
      padStart('★'.repeat(Math.round(slow.stars)), 8)
    );
    console.log(
      pad('', 28) +
      padStart('', 7) +
      padStart('разница', 10) +
      padStart('', 7) +
      padStart('', 6) +
      padStart('', 9) +
      padStart('', 8) +
      padStart('', 8) +
      padStart((diff >= 0 ? '+' : '') + diff.toFixed(1).replace('.', ',') + '%', 10) +
      padStart('', 8)
    );
    console.log(divider);
  });

  const avgDiff = avg(summary.map(item => item.diff));
  console.log('Средний отрыв быстрого игрока: ' + (avgDiff >= 0 ? '+' : '') + avgDiff.toFixed(1).replace('.', ',') + '%');
  console.log('Целевой коридор: +25…+45%');
  console.log('');

  console.log('Для сравнения — старая формула (cells×20×mult + creates×40, бонус timeLeft×10):');
  summary.forEach(item => {
    const oldDiff = ((item.fast.old - item.slow.old) / item.slow.old) * 100;
    console.log(
      '  ' + pad(item.level, 28) +
      'быстрый ' + padStart(fmt(item.fast.old), 6) +
      '   медленный ' + padStart(fmt(item.slow.old), 6) +
      '   быстрый ' + (oldDiff >= 0 ? '+' : '') + oldDiff.toFixed(1).replace('.', ',') + '%'
    );
  });
  console.log('');
}

main();
