#!/usr/bin/env node
/* Хранитель Солнца — бот-проверка уровней и пороги звёзд.
 *
 * Прогоняет уровни кампании ботом на ядре поля (js/core/board.js) и считает
 * очки по js/economy.js так же, как js/game.js (resolveBoard).
 *
 *   node tools/level-bot.js --check   [--lands 1-2] [--seeds 20] [--seed-offset 0] [--star-seeds 500]
 *   node tools/level-bot.js --suggest [--lands 1-2] [--seeds 20] [--star-seeds 500] [--js]
 * --seeds: партии greedy (проходимость); --star-seeds: партии human (звёзды,
 * медианы ходов); --seed-offset сдвигает сиды (независимая выборка).
 *
 * Политики:
 *   greedy — лучший ход по (прогресс целей, затем очки): проверка проходимости;
 *   human  — случайный из трёх лучших ходов: пороги звёзд для обычного игрока.
 *
 * «Очки для звёзд» — сумма Economy.clearDetail(...).score за уровень,
 * без levelBonus (то же сравнивает экран конца уровня).
 * Ход бота = один успешный обмен; перемешивание ходом не считается.
 */
'use strict';

const Board = require('../js/core/board.js');
const Campaign = require('../js/campaign/campaign.js');
const Economy = require('../js/economy.js');

const MAX_MOVES = 150;
/* Часы очков для «Обычно»/«Испытания» и размер таймеров: ~7 с на ход обычного
   игрока. Проверка проходимости — по быстрому игроку, 4 с на ход (из ТЗ). */
const SECONDS_PER_MOVE = 7;
const FAST_SECONDS_PER_MOVE = 4;
const COLORS = 6;
const HUMAN_TOP = 3;
/* Пороги звёзд берутся с запасом от краёв коридоров (s2: p30-p50, s3: p75-p90):
   40-й перцентиль — почти центр, а 82-й вместо 80-го — чтобы шум выборки
   не выводил порог из коридора на независимых сидах. */
const S2_PCT = 40;
const S3_PCT = 82;
const REST_LEVELS = new Set(['1-10', '1-15', '2-08', '2-14', '3-08', '3-14']);

/* ---------- Утилиты ---------- */

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

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* Перцентиль с линейной интерполяцией. */
function percentile(values, p) {
  if (!values.length) return NaN;
  const a = values.slice().sort((x, y) => x - y);
  const pos = (a.length - 1) * (p / 100);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

function cloneGrid(grid) {
  return grid.map(row => row.map(g => (g ? Object.assign({}, g) : null)));
}

/* ---------- Состояние целей ---------- */

function makeProgress(resolved) {
  const colorLeft = new Map();
  let vinesLeft = 0;
  let platesLeft = 0;
  let bouldersLeft = 0;
  let relicsLeft = 0;
  resolved.goals.forEach(g => {
    if (g.type === 'color') colorLeft.set(g.color, (colorLeft.get(g.color) || 0) + g.need);
    else if (g.type === 'vines') vinesLeft += g.need;
    else if (g.type === 'plates') platesLeft += g.need;
    else if (g.type === 'boulders') bouldersLeft += g.need;
    else if (g.type === 'relics') relicsLeft += g.need;
  });
  return { colorLeft, vinesLeft, platesLeft, bouldersLeft, relicsLeft };
}

function isDone(p) {
  if (p.vinesLeft > 0) return false;
  if (p.platesLeft > 0) return false;
  if (p.bouldersLeft > 0) return false;
  if (p.relicsLeft > 0) return false;
  for (const left of p.colorLeft.values()) if (left > 0) return false;
  return true;
}

function cloneProgress(p) {
  return { colorLeft: new Map(p.colorLeft), vinesLeft: p.vinesLeft, platesLeft: p.platesLeft, bouldersLeft: p.bouldersLeft, relicsLeft: p.relicsLeft };
}

/* ---------- Один ход ---------- */

/* Выполняет обмен a<->b на grid (МЕНЯЕТ grid) и считает прогресс и очки.
   Правила goalCells — как в js/game.js resolveBoard: клетки цветов, чьи цели
   ещё открыты, с потолком по оставшейся потребности; cells = clear.size;
   chain с 1. Камни, с которых лишь сорвана лиана, в clear не входят.
   Возвращает null, если обмен недопустим; иначе
   { progress, score, gained: {colors: Map, vines, plates} }.
   plates — слой плит (необязателен); МЕНЯЕТСЯ, для оценки хода передавать копию.
   Плиты, как и лианы, очков не дают (js/game.js playStep).
   boulders — слой валунов (необязателен), тоже МЕНЯЕТСЯ. Очков не дают; для
   выбора хода каждая трещина — единица прогресса (иначе бот не бил бы крепкие
   валуны), в цель (gained.boulders) идут только разбитые. Идолы: прогресс —
   на сколько строк они опустились (снятый идол — до строки ROWS), в цель
   (gained.relics) — снятые со дна. */
function runMove(grid, a, b, turnSeed, progress, timeLefts, totalTime, plates, boulders) {
  const rng = mulberry32(turnSeed);
  let idCounter = 1000000;
  const relicDepth = () => {
    let d = 0;
    grid.forEach(row => row.forEach(g => { if (g && g.relic) d += g.r; }));
    return d;
  };
  const depthBefore = relicDepth();
  const res = Board.simulateMove(grid, a, b, rng, () => ++idCounter, { colors: COLORS, boulders });
  if (!res) return null;

  const left = new Map(progress.colorLeft);
  let vinesLeft = progress.vinesLeft;
  const colorGain = new Map();
  let vinesGain = 0;
  let platesGain = 0;
  let progressUnits = 0;
  const scores = timeLefts.map(() => 0);
  let offset = 0;

  res.cascades.forEach((plan, i) => {
    const size = plan.clear.size;
    const gems = res.removed.slice(offset, offset + size);
    offset += size;

    let goalCells = 0;
    gems.forEach(gem => {
      const l = left.get(gem.color) || 0;
      if (l > 0) {
        goalCells++;
        left.set(gem.color, l - 1);
        colorGain.set(gem.color, (colorGain.get(gem.color) || 0) + 1);
        progressUnits++;
      }
    });

    const unlocked = plan.unlocks ? plan.unlocks.size : 0;
    const take = Math.min(unlocked, vinesLeft);
    vinesLeft -= take;
    vinesGain += take;
    progressUnits += take;

    const hit = Board.hitPlates(plates, plan).length;
    platesGain += hit;
    progressUnits += hit;

    timeLefts.forEach((timeLeft, k) => {
      scores[k] += Economy.clearDetail({
        cells: size,
        goalCells,
        chain: i + 1,
        creates: plan.creates,
        triggers: plan.triggers,
        timeLeft,
        totalTime
      }).score;
    });
  });

  const bouldersGain = Math.min(res.boulderHits.filter(h => h.left === 0).length, progress.bouldersLeft || 0);
  progressUnits += res.boulderHits.length;
  const relicsGain = Math.min(res.relics.length, progress.relicsLeft || 0);
  progressUnits += relicDepth() + res.relics.length * Board.ROWS - depthBefore;

  if (offset !== res.removed.length) {
    throw new Error('runMove: removed (' + res.removed.length + ') не совпадает с суммой clear (' + offset + ') — ядро поля изменилось');
  }
  return { progress: progressUnits, score: scores[0], scores, gained: { colors: colorGain, vines: vinesGain, plates: platesGain, boulders: bouldersGain, relics: relicsGain } };
}

/* Все обмены, дающие совпадение (проверка как в Board.findMove), и спуски идола (Board.relicDrop). */
function legalMoves(grid) {
  const out = [];
  for (let r = 0; r < Board.ROWS; r++) {
    for (let c = 0; c < Board.COLS; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr;
        const c2 = c + dc;
        if (r2 >= Board.ROWS || c2 >= Board.COLS) continue;
        const a = grid[r][c];
        const b = grid[r2][c2];
        if (!a || !b || a.locked || b.locked) continue;
        const drop = Board.relicDrop(grid, { r, c }, { r: r2, c: c2 });
        grid[r][c] = b;
        grid[r2][c2] = a;
        const ok = drop || Board.hasAnyMatch(grid);
        grid[r][c] = a;
        grid[r2][c2] = b;
        if (ok) out.push({ a: { r, c }, b: { r: r2, c: c2 } });
      }
    }
  }
  return out;
}

/* ---------- Партия ---------- */

/* resolved — результат Campaign.resolve(id, difficulty).
   Возвращает { won, moves, score, scores, shuffles }.
   opts.models — модели времени для очков: 'calm' (timeLeft = econTime/2) и/или
   'timed' (econTime - ходы*4). Ходы выбираются по первой модели, очки
   считаются сразу по всем (scores); по умолчанию — модель самой сложности.
   Так «Спокойно» и «Обычно» делят одну партию. */
function playLevel(resolved, seed, opts) {
  const policy = (opts && opts.policy) || 'greedy';
  const maxMoves = (opts && opts.maxMoves) || MAX_MOVES;
  const models = (opts && opts.models) || [resolved.timer == null ? 'calm' : 'timed'];
  const total = resolved.econTime;

  const base = (Math.imul(seed >>> 0, 2654435761) ^ hashString(resolved.id)) >>> 0;
  const rng = mulberry32(base);
  const pickRng = mulberry32(base ^ 0x9E3779B9);
  /* Оценка кандидатов идёт на отдельном потоке сидов: игрок не видит, какие
     камни досыплются, поэтому бот не должен выбирать ход по реальным досыпкам. */
  const evalRng = mulberry32(base ^ 0x85EBCA6B);
  let idCounter = 0;
  const nextId = () => ++idCounter;

  const grid = Board.generateGrid({ colors: COLORS, vines: resolved.vines, boulders: resolved.boulders, relics: resolved.relics }, rng, nextId);
  const plates = Board.makePlates(resolved.plates);
  const boulders = Board.makeBoulders(resolved.boulders);
  const progress = makeProgress(resolved);

  let moves = 0;
  const scores = models.map(() => 0);
  let shuffles = 0;

  while (!isDone(progress) && moves < maxMoves) {
    if (!Board.hasMove(grid)) {
      Board.shuffle(grid, rng, { colors: COLORS });
      shuffles++;
      if (!Board.hasMove(grid)) break;
    }

    const timeLefts = models.map(m => (m === 'calm' ? total * 0.5 : Math.max(0, total - moves * SECONDS_PER_MOVE)));
    const turnSeed = Math.floor(rng() * 4294967296);
    const evalSeed = Math.floor(evalRng() * 4294967296);

    const cands = [];
    legalMoves(grid).forEach((mv, order) => {
      const r = runMove(cloneGrid(grid), mv.a, mv.b, evalSeed, progress, timeLefts.slice(0, 1), total, plates.map(row => row.slice()), boulders.map(row => row.slice()));
      if (r) cands.push({ mv, order, progress: r.progress, score: r.score });
    });
    if (!cands.length) break;

    cands.sort((x, y) => (y.progress - x.progress) || (y.score - x.score) || (x.order - y.order));
    let pick = cands[0];
    if (policy === 'human') {
      const top = Math.min(HUMAN_TOP, cands.length);
      pick = cands[Math.floor(pickRng() * top)];
    }

    const r = runMove(grid, pick.mv.a, pick.mv.b, turnSeed, progress, timeLefts, total, plates, boulders);
    moves++;
    r.scores.forEach((v, k) => { scores[k] += v; });
    r.gained.colors.forEach((n, color) => {
      progress.colorLeft.set(color, progress.colorLeft.get(color) - n);
    });
    progress.vinesLeft -= r.gained.vines;
    progress.platesLeft -= r.gained.plates;
    progress.bouldersLeft -= r.gained.boulders;
    progress.relicsLeft -= r.gained.relics;
  }

  return { won: isDone(progress), moves, score: scores[0], scores, shuffles };
}

/* ---------- Сбор статистики ---------- */

function parseLands(spec) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(spec || '1-2');
  if (!m) throw new Error('--lands ожидает N или N-M, получено ' + spec);
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return { lo, hi };
}

function levelIds(spec) {
  const { lo, hi } = parseLands(spec);
  return Campaign.allLevelIds().filter(id => {
    const land = Campaign.landOf(id).id;
    return land >= lo && land <= hi;
  });
}

const median = a => percentile(a, 50);

/* Прогоняет уровень по всем сложностям и политикам.
   greedy: seeds партий (проходимость); human: starSeeds партий (пороги звёзд
   и медианы ходов — им нужна большая выборка). «Спокойно» и «Обычно» имеют
   одни цели, поэтому играются одной партией с двумя моделями времени. */
function analyzeLevel(id, seeds, offset, starSeeds) {
  const off = offset || 0;
  const nStar = starSeeds || seeds;
  const resolved = {};
  Campaign.DIFFICULTIES.forEach(d => { resolved[d] = Campaign.resolve(id, d); });

  const run = (diffs, policy, count) => {
    const res = diffs.map(() => []);
    const models = diffs.map(d => (d === 'calm' ? 'calm' : 'timed'));
    for (let s = off + 1; s <= off + count; s++) {
      const r = playLevel(resolved[diffs[diffs.length - 1]], s, { policy, models });
      diffs.forEach((d, k) => res[k].push({ won: r.won, moves: r.moves, score: r.scores[k], shuffles: r.shuffles }));
    }
    return res;
  };

  const out = {};
  const gCN = run(['calm', 'normal'], 'greedy', seeds);
  const gCh = run(['challenge'], 'greedy', seeds);
  const hCN = run(['calm', 'normal'], 'human', nStar);
  const hCh = run(['challenge'], 'human', nStar);
  out.calm = { resolved: resolved.calm, greedy: gCN[0], human: hCN[0] };
  out.normal = { resolved: resolved.normal, greedy: gCN[1], human: hCN[1] };
  out.challenge = { resolved: resolved.challenge, greedy: gCh[0], human: hCh[0] };
  return out;
}

function share(list, pred) {
  return list.filter(pred).length / list.length;
}

function evaluate(id, data) {
  const lv = Campaign.level(id);
  const violations = [];
  const info = {};

  Campaign.DIFFICULTIES.forEach(diff => {
    const { resolved, greedy, human } = data[diff];
    const wins = greedy.filter(r => r.won);
    const winRate = wins.length / greedy.length;
    const inTime = resolved.timer == null
      ? winRate
      : share(greedy, r => r.won && r.moves * FAST_SECONDS_PER_MOVE <= resolved.timer);

    if (diff === 'calm' && winRate < 1) {
      violations.push(id + ' calm: выигрыш ' + pct(winRate) + ' < 100% за ' + MAX_MOVES + ' ходов');
    }
    if (diff === 'normal' && inTime < 0.9) {
      violations.push(id + ' normal: уложились в ' + resolved.timer + ' с (' + FAST_SECONDS_PER_MOVE + ' с/ход) ' + pct(inTime) + ' < 90%');
    }
    if (diff === 'challenge' && inTime < 0.6) {
      violations.push(id + ' challenge: уложились в ' + resolved.timer + ' с (' + FAST_SECONDS_PER_MOVE + ' с/ход) ' + pct(inTime) + ' < 60%');
    }

    const scores = human.filter(r => r.won).map(r => r.score);
    const p30 = percentile(scores, 30);
    const p50 = percentile(scores, 50);
    const p75 = percentile(scores, 75);
    const p90 = percentile(scores, 90);
    const [s2, s3] = resolved.stars;
    if (!scores.length) {
      violations.push(id + ' ' + diff + ': human-бот ни разу не выиграл, пороги звёзд не проверить');
    } else {
      if (s2 < p30 || s2 > p50) {
        violations.push(id + ' ' + diff + ': s2=' + s2 + ' вне [p30=' + Math.round(p30) + ', p50=' + Math.round(p50) + ']');
      }
      if (s3 < p75 || s3 > p90) {
        violations.push(id + ' ' + diff + ': s3=' + s3 + ' вне [p75=' + Math.round(p75) + ', p90=' + Math.round(p90) + ']');
      }
    }

    info[diff] = {
      winRate,
      inTime,
      timer: resolved.timer,
      medMoves: median(wins.map(r => r.moves)),
      humanMoves: median(human.filter(r => r.won).map(r => r.moves)),
      stars: resolved.stars,
      shuffles: greedy.reduce((n, r) => n + r.shuffles, 0)
    };
  });
  return { id, name: lv.name, time: lv.time, info, violations };
}

function pct(x) {
  return Math.round(x * 100) + '%';
}

function stepFor(x) {
  return x < 200 ? 5 : x < 1000 ? 10 : x < 5000 ? 50 : 100;
}

/* Круглый порог, ближайший к target, но внутри коридора [lo, hi]. */
function niceFit(target, lo, hi) {
  const step = stepFor(target);
  const round = Math.max(step, Math.round(target / step) * step);
  if (round >= lo && round <= hi) return round;
  const up = Math.ceil(lo / step) * step;
  if (up <= hi) return up;
  const down = Math.floor(hi / step) * step;
  if (down >= lo) return down;
  return Math.min(Math.floor(hi), Math.max(Math.ceil(lo), Math.round(target)));
}

function suggestStars(human) {
  const scores = human.filter(r => r.won).map(r => r.score);
  const s2 = niceFit(percentile(scores, S2_PCT), percentile(scores, 30), percentile(scores, 50));
  const s3 = niceFit(percentile(scores, S3_PCT), percentile(scores, 75), percentile(scores, 90));
  return [s2, Math.max(s3, s2 + 1)];
}

/* ---------- CLI ---------- */

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padL(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

/* Гладкость: медиана human-ходов на «Спокойно» уровня n+1 не меньше 75% от
   уровня n. Исключения: уровни-передышки и первый уровень земли (новая земля
   начинается с обучающего уровня). */
function smoothnessWarnings(rows) {
  const warns = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (REST_LEVELS.has(cur.id) || /-01$/.test(cur.id)) continue;
    const a = prev.info.calm.humanMoves;
    const b = cur.info.calm.humanMoves;
    if (b < a * 0.75) {
      warns.push('ПРЕДУПРЕЖДЕНИЕ ' + cur.id + ': медиана human-ходов ' + b + ' < 75% от ' + prev.id + ' (' + a + ')');
    }
  }
  return warns;
}

/* ---------- Параллельный прогон по уровням (worker_threads) ---------- */

function analyzeAll(ids, seeds, offset, starSeeds, jobs) {
  const { Worker } = require('node:worker_threads');
  const n = Math.max(1, Math.min(jobs, ids.length));
  if (n === 1) return Promise.resolve(ids.map(id => analyzeLevel(id, seeds, offset, starSeeds)));
  return new Promise((resolve, reject) => {
    const results = new Array(ids.length);
    let next = 0;
    let done = 0;
    const workers = [];
    const feed = w => {
      if (next >= ids.length) { w.terminate(); return; }
      const index = next++;
      w.postMessage({ index, id: ids[index], seeds, offset, starSeeds });
    };
    for (let i = 0; i < n; i++) {
      const w = new Worker(__filename);
      workers.push(w);
      w.on('message', msg => {
        results[msg.index] = msg.data;
        if (++done === ids.length) { workers.forEach(x => x.terminate()); resolve(results); } else feed(w);
      });
      w.on('error', err => { workers.forEach(x => x.terminate()); reject(err); });
      feed(w);
    }
  });
}

function parseArgs(argv) {
  const args = { mode: null, lands: '1-2', seeds: 20, offset: 0, starSeeds: 500, jobs: Math.max(1, Math.min(8, require('node:os').cpus().length - 1)), js: false };
  const num = (name, raw, min) => {
    const v = Number(raw);
    if (raw === undefined || !Number.isInteger(v) || v < min) {
      throw new Error(name + ' ожидает целое число >= ' + min + ', получено ' + raw);
    }
    return v;
  };
  const val = (name, raw) => {
    if (raw === undefined || raw.startsWith('--')) throw new Error(name + ' ожидает значение');
    return raw;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.mode = 'check';
    else if (a === '--suggest') args.mode = 'suggest';
    else if (a === '--js') args.js = true;
    else if (a === '--lands') args.lands = val(a, argv[++i]);
    else if (a === '--seeds') args.seeds = num(a, argv[++i], 1);
    else if (a === '--seed-offset') args.offset = num(a, argv[++i], 0);
    else if (a === '--star-seeds') args.starSeeds = num(a, argv[++i], 1);
    else if (a === '--jobs') args.jobs = num(a, argv[++i], 1);
    else if (a === '--level') args.level = val(a, argv[++i]);
    else throw new Error('неизвестный аргумент ' + a);
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.mode) {
    console.log('Использование: node tools/level-bot.js --check|--suggest [--lands 1-2] [--seeds 20] [--seed-offset 0] [--star-seeds 500] [--jobs N] [--level 1-01] [--js]');
    return 0;
  }
  if (args.level && !Campaign.level(args.level)) throw new Error('неизвестный уровень ' + args.level);
  const ids = args.level ? [args.level] : levelIds(args.lands);
  if (!ids.length) throw new Error('нет уровней для --lands ' + args.lands);
  const datas = await analyzeAll(ids, args.seeds, args.offset, args.starSeeds, args.jobs);
  const rows = ids.map((id, i) => evaluate(id, datas[i]));

  if (args.mode === 'suggest') {
    console.log('Уровень | время | greedy-ходы calm/norm/chal | human-ходы calm/norm/chal | звёзды [s2,s3] calm / normal / challenge (p40/p82 human)');
    const table = {};
    ids.forEach((id, i) => {
      const r = rows[i];
      const sg = {};
      Campaign.DIFFICULTIES.forEach(d => { sg[d] = suggestStars(datas[i][d].human); });
      table[id] = sg;
      console.log(
        pad(id, 6) + ' ' + padL(r.time, 4) + ' с | ' +
        Campaign.DIFFICULTIES.map(d => padL(r.info[d].medMoves, 5)).join(' ') + ' | ' +
        Campaign.DIFFICULTIES.map(d => padL(r.info[d].humanMoves, 5)).join(' ') + ' | ' +
        Campaign.DIFFICULTIES.map(d => '[' + sg[d].join(',') + ']').join(' ')
      );
    });
    if (args.js) {
      console.log('\n// Таблица для land-NN.js');
      ids.forEach(id => {
        const n = Number(id.split('-')[1]);
        const sg = table[id];
        console.log('  ' + n + ': { calm: [' + sg.calm + '], normal: [' + sg.normal + '], challenge: [' + sg.challenge + '] },');
      });
    }
    smoothnessWarnings(rows).forEach(w => console.log(w));
    return 0;
  }

  // --check
  let bad = 0;
  console.log(pad('Уровень', 8) + pad('время', 7) + pad('calm', 6) + pad('normal в срок', 15) + pad('chal в срок', 13) + 'ходов c/n/ch   звёзды calm/normal/challenge');
  rows.forEach(r => {
    const i = r.info;
    console.log(
      pad(r.id, 8) + pad(r.time, 7) + pad(pct(i.calm.winRate), 6) +
      pad(pct(i.normal.inTime) + ' (' + i.normal.timer + ')', 15) +
      pad(pct(i.challenge.inTime) + ' (' + i.challenge.timer + ')', 13) +
      Campaign.DIFFICULTIES.map(d => padL(i[d].medMoves, 3)).join(' ') + '   ' +
      Campaign.DIFFICULTIES.map(d => '[' + i[d].stars.join(',') + ']').join(' ') +
      (r.violations.length ? '  <-- НАРУШЕНИЕ' : '')
    );
    r.violations.forEach(v => { bad++; console.log('   ! ' + v); });
  });
  smoothnessWarnings(rows).forEach(w => console.log(w));
  console.log(bad ? 'ИТОГ: нарушений ' + bad : 'ИТОГ: все проверки пройдены');
  return bad ? 1 : 0;
}

module.exports = {
  playLevel,
  runMove,
  parseArgs,
  percentile,
  mulberry32,
  suggestStars,
  analyzeLevel,
  evaluate,
  levelIds,
  MAX_MOVES,
  SECONDS_PER_MOVE,
  FAST_SECONDS_PER_MOVE
};

const wt = require('node:worker_threads');
if (!wt.isMainThread && wt.parentPort) {
  /* Рабочий поток: считает один уровень по запросу из analyzeAll. */
  wt.parentPort.on('message', msg => {
    wt.parentPort.postMessage({ index: msg.index, data: analyzeLevel(msg.id, msg.seeds, msg.offset, msg.starSeeds) });
  });
} else if (require.main === module) {
  main(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    err => { console.error('Ошибка: ' + (err && err.message ? err.message : err)); process.exitCode = 1; }
  );
}
