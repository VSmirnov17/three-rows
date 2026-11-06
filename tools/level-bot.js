#!/usr/bin/env node
/* Хранитель Солнца — бот-проверка уровней и пороги звёзд.
 *
 * Прогоняет уровни кампании ботом на ядре поля (js/core/board.js) и считает
 * очки по js/economy.js так же, как js/game.js (resolveBoard).
 *
 *   node tools/level-bot.js --check   [--lands 1-2] [--seeds 20]
 *   node tools/level-bot.js --suggest [--lands 1-2] [--seeds 20] [--js]
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
const SECONDS_PER_MOVE = 4;
const COLORS = 6;
const HUMAN_TOP = 3;
const REST_LEVELS = new Set(['1-10', '1-15', '2-08', '2-14']);

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
  resolved.goals.forEach(g => {
    if (g.type === 'color') colorLeft.set(g.color, (colorLeft.get(g.color) || 0) + g.need);
    else if (g.type === 'vines') vinesLeft += g.need;
  });
  return { colorLeft, vinesLeft };
}

function isDone(p) {
  if (p.vinesLeft > 0) return false;
  for (const left of p.colorLeft.values()) if (left > 0) return false;
  return true;
}

function cloneProgress(p) {
  return { colorLeft: new Map(p.colorLeft), vinesLeft: p.vinesLeft };
}

/* ---------- Один ход ---------- */

/* Выполняет обмен a<->b на grid (МЕНЯЕТ grid) и считает прогресс и очки.
   Правила goalCells — как в js/game.js resolveBoard: клетки цветов, чьи цели
   ещё открыты, с потолком по оставшейся потребности; cells = clear.size;
   chain с 1. Камни, с которых лишь сорвана лиана, в clear не входят.
   Возвращает null, если обмен недопустим; иначе
   { progress, score, gained: {colors: Map, vines} }. */
function runMove(grid, a, b, turnSeed, progress, timeLeft, totalTime) {
  const rng = mulberry32(turnSeed);
  let idCounter = 1000000;
  const res = Board.simulateMove(grid, a, b, rng, () => ++idCounter, { colors: COLORS });
  if (!res) return null;

  const left = new Map(progress.colorLeft);
  let vinesLeft = progress.vinesLeft;
  const colorGain = new Map();
  let vinesGain = 0;
  let progressUnits = 0;
  let score = 0;
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

    score += Economy.clearDetail({
      cells: size,
      goalCells,
      chain: i + 1,
      creates: plan.creates,
      triggers: plan.triggers,
      timeLeft,
      totalTime
    }).score;
  });

  return { progress: progressUnits, score, gained: { colors: colorGain, vines: vinesGain } };
}

/* Все обмены, дающие совпадение (проверка как в Board.findMove). */
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
        grid[r][c] = b;
        grid[r2][c2] = a;
        const ok = Board.hasAnyMatch(grid);
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
   Возвращает { won, moves, score, shuffles }. */
function playLevel(resolved, seed, opts) {
  const policy = (opts && opts.policy) || 'greedy';
  const maxMoves = (opts && opts.maxMoves) || MAX_MOVES;
  const calm = resolved.timer == null;
  const total = resolved.econTime;

  const base = (Math.imul(seed >>> 0, 2654435761) ^ hashString(resolved.id)) >>> 0;
  const rng = mulberry32(base);
  const pickRng = mulberry32(base ^ 0x9E3779B9);
  let idCounter = 0;
  const nextId = () => ++idCounter;

  const grid = Board.generateGrid({ colors: COLORS, vines: resolved.vines }, rng, nextId);
  const progress = makeProgress(resolved);

  let moves = 0;
  let score = 0;
  let shuffles = 0;

  while (!isDone(progress) && moves < maxMoves) {
    if (!Board.hasMove(grid)) {
      Board.shuffle(grid, rng, { colors: COLORS });
      shuffles++;
      if (!Board.hasMove(grid)) break;
    }

    const timeLeft = calm ? total * 0.5 : Math.max(0, total - moves * SECONDS_PER_MOVE);
    const turnSeed = Math.floor(rng() * 4294967296);

    const cands = [];
    legalMoves(grid).forEach((mv, order) => {
      const r = runMove(cloneGrid(grid), mv.a, mv.b, turnSeed, progress, timeLeft, total);
      if (r) cands.push({ mv, order, progress: r.progress, score: r.score });
    });
    if (!cands.length) break;

    cands.sort((x, y) => (y.progress - x.progress) || (y.score - x.score) || (x.order - y.order));
    let pick = cands[0];
    if (policy === 'human') {
      const top = Math.min(HUMAN_TOP, cands.length);
      pick = cands[Math.floor(pickRng() * top)];
    }

    const r = runMove(grid, pick.mv.a, pick.mv.b, turnSeed, progress, timeLeft, total);
    moves++;
    score += r.score;
    r.gained.colors.forEach((n, color) => {
      progress.colorLeft.set(color, progress.colorLeft.get(color) - n);
    });
    progress.vinesLeft -= r.gained.vines;
  }

  return { won: isDone(progress), moves, score, shuffles };
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

/* Прогоняет уровень по всем сложностям и политикам. */
function analyzeLevel(id, seeds) {
  const out = {};
  Campaign.DIFFICULTIES.forEach(diff => {
    const resolved = Campaign.resolve(id, diff);
    const greedy = [];
    const human = [];
    for (let s = 1; s <= seeds; s++) {
      greedy.push(playLevel(resolved, s, { policy: 'greedy' }));
      human.push(playLevel(resolved, s, { policy: 'human' }));
    }
    out[diff] = { resolved, greedy, human };
  });
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
      : share(greedy, r => r.won && r.moves * SECONDS_PER_MOVE <= resolved.timer);

    if (diff === 'calm' && winRate < 1) {
      violations.push(id + ' calm: выигрыш ' + pct(winRate) + ' < 100% за ' + MAX_MOVES + ' ходов');
    }
    if (diff === 'normal' && inTime < 0.9) {
      violations.push(id + ' normal: уложились в ' + resolved.timer + ' с (4 с/ход) ' + pct(inTime) + ' < 90%');
    }
    if (diff === 'challenge' && inTime < 0.6) {
      violations.push(id + ' challenge: уложились в ' + resolved.timer + ' с (4 с/ход) ' + pct(inTime) + ' < 60%');
    }

    const scores = human.filter(r => r.won).map(r => r.score);
    const p30 = percentile(scores, 30);
    const p40 = percentile(scores, 40);
    const p50 = percentile(scores, 50);
    const p75 = percentile(scores, 75);
    const p80 = percentile(scores, 80);
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
      sugg: [p40, p80],
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
  const s2 = niceFit(percentile(scores, 40), percentile(scores, 30), percentile(scores, 50));
  const s3 = niceFit(percentile(scores, 80), percentile(scores, 75), percentile(scores, 90));
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

function smoothnessWarnings(rows) {
  const warns = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (REST_LEVELS.has(cur.id)) continue;
    const a = prev.info.calm.medMoves;
    const b = cur.info.calm.medMoves;
    if (b < a * 0.75) {
      warns.push('ПРЕДУПРЕЖДЕНИЕ ' + cur.id + ': медиана ходов ' + b + ' < 75% от ' + prev.id + ' (' + a + ')');
    }
  }
  return warns;
}

function parseArgs(argv) {
  const args = { mode: null, lands: '1-2', seeds: 20, js: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.mode = 'check';
    else if (a === '--suggest') args.mode = 'suggest';
    else if (a === '--js') args.js = true;
    else if (a === '--lands') args.lands = argv[++i];
    else if (a === '--seeds') args.seeds = Number(argv[++i]);
    else if (a === '--level') args.level = argv[++i];
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.mode) {
    console.log('Использование: node tools/level-bot.js --check|--suggest [--lands 1-2] [--seeds 20] [--level 1-01] [--js]');
    return 0;
  }
  const ids = args.level ? [args.level] : levelIds(args.lands);
  const datas = ids.map(id => analyzeLevel(id, args.seeds));
  const rows = ids.map((id, i) => evaluate(id, datas[i]));

  if (args.mode === 'suggest') {
    console.log('Уровень | время | ходов (greedy, calm/norm/chal) | human-ходов (calm) | звёзды [s2,s3] calm / normal / challenge (p40/p80 human)');
    const table = {};
    ids.forEach((id, i) => {
      const r = rows[i];
      const sg = {};
      Campaign.DIFFICULTIES.forEach(d => { sg[d] = suggestStars(datas[i][d].human); });
      table[id] = sg;
      console.log(
        pad(id, 6) + ' ' + padL(r.time, 4) + ' с | ' +
        Campaign.DIFFICULTIES.map(d => padL(r.info[d].medMoves, 4)).join(' ') + ' | ' +
        padL(r.info.calm.humanMoves, 4) + ' | ' +
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
  percentile,
  mulberry32,
  suggestStars,
  analyzeLevel,
  evaluate,
  levelIds,
  MAX_MOVES,
  SECONDS_PER_MOVE
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
