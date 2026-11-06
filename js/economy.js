/* Хранитель Солнца — экономика очков.
 *
 * Модуль не зависит от DOM и от игрового цикла: его можно подключать
 * как <script src="js/economy.js"></script> перед js/game.js,
 * а также требовать из Node (tools/economy-sim.js).
 *
 * Главная идея:
 *   - очки за очистку платят за прогресс целей (клетки нужных цветов),
 *     поэтому «фарм» пустых камней почти ничего не даёт;
 *   - всё умножается на «темп» — чем раньше сделан ход, тем он дороже;
 *   - бонус за остаток времени маленький и с убывающей отдачей.
 */
(function (factory) {
  'use strict';

  const Economy = factory();

  if (typeof window !== 'undefined') window.Economy = Economy;
  if (typeof module !== 'undefined' && module.exports) module.exports = Economy;
})(function () {
  'use strict';

  /* =====================================================================
   * Все числа экономики — здесь. Крутите их и запускайте
   * `node tools/economy-sim.js`, чтобы увидеть последствия.
   * ===================================================================== */
  const CONST = {
    /* --- Очки за очистку --- */
    CELL_POINTS: 1.5,        // очки за любую очищенную клетку (до множителей)
    GOAL_CELL_POINTS: 15,    // доп. очки за клетку цвета незакрытой цели
    CHAIN_BASE: 1,           // первый каскад: CHAIN_BASE + CHAIN_STEP * chain = ×2
    CHAIN_STEP: 1,           // каждый следующий каскад добавляет этот шаг
    CHAIN_MAX: 8,            // потолок каскадного множителя (как в старой игре)

    /* --- Награды за создание спецкамней --- */
    CREATE_LINE: 42,         // линия 4 → камень-молния
    CREATE_SUN: 84,          // линия 5 → солнечный камень
    CREATE_BOMB: 57,         // квадрат 2×2 → бомба
    CREATE_TOTEM: 72,       // уголок 5 → тотем

    /* --- Награды за срабатывание спецкамней --- */
    TRIGGER_LINE: 18,        // молния очистила ряд + столбец
    TRIGGER_SUN: 36,         // солнце очистило все камни цвета
    TRIGGER_BOMB: 27,        // бомба взорвала 3×3
    TRIGGER_TOTEM: 39,       // тотем очистил ряд + столбец

    /* --- Темп (главный множитель за скорость) ---
     * frac = timeLeft / totalTime в момент хода.
     * pace = PACE_MIN + (PACE_MAX - PACE_MIN) * frac^PACE_POWER
     * При старте — ×PACE_MAX, в конце — ×PACE_MIN.
     * Степень 2 делает кривую читаемой: половина времени → примерно
     * четверть надбавки, последние секунды почти не стоят очков.
     */
    PACE_MIN: 0.25,
    PACE_MAX: 3.2,
    PACE_POWER: 2,

    /* --- Бонус за остаток времени ---
     * bonus = BONUS_PER_SEC * timeLeft * (1 - BONUS_DECAY * frac)
     * Линейная часть мала, квадратичная поправка делает отдачу убывающей:
     * каждая следующая сэкономленная секунда стоит чуть меньше.
     */
    BONUS_PER_SEC: 8,
    BONUS_DECAY: 0.5,

    /* --- Ранг скорости (доля использованного времени) --- */
    RANK_3_USED: 0.50,       // использовать ≤50% времени → 3 звезды
    RANK_2_USED: 0.75,       // использовать ≤75% времени → 2 звезды
    RANK_NAMES: ['Неспешно', 'Быстро', 'Молниеносно'],

    /* --- Служебное --- */
    EPS: 1e-6
  };

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  /* Доля оставшегося времени. Поддерживаем несколько удобных форм входа:
   *   { timeLeft, totalTime }  — как в js/game.js;
   *   { remaining, total };
   *   { now, total }           — now = сколько секунд уже прошло.
   */
  function timeFraction(opts) {
    opts = opts || {};
    const total = Math.max(1, num(opts.totalTime != null ? opts.totalTime : opts.total, 1));
    let left;
    if (opts.timeLeft != null) left = num(opts.timeLeft, total);
    else if (opts.remaining != null) left = num(opts.remaining, total);
    else if (opts.now != null) left = total - num(opts.now, 0);
    else left = total;
    return clamp(left / total, 0, 1);
  }

  /* Множитель темпа для текущей доли оставшегося времени.
   * Эту функцию удобно вызывать из UI, чтобы показать «Темп ×1.8».
   */
  function paceAt(frac) {
    const f = clamp(num(frac, 0), 0, 1);
    return CONST.PACE_MIN + (CONST.PACE_MAX - CONST.PACE_MIN) * Math.pow(f, CONST.PACE_POWER);
  }

  function paceFrom(opts) {
    return paceAt(timeFraction(opts));
  }

  function formatPace(mult) {
    const value = round2(num(mult, 1));
    return '×' + String(value).replace('.', ',');
  }

  /* --- Разбор creates/triggers -----------------------------------------
   * Принимаем:
   *   число                         — старый вызов creates.length (считаем линиями);
   *   строка 'line'|'sun'|...       — один спецкамень;
   *   объект { type: 'sun' }        — как в js/game.js;
   *   массив любых из перечисленных.
   * Так патч интеграции переживёт появление bomb/totem у другого агента.
   */
  const CREATE_POINTS = {
    line: CONST.CREATE_LINE,
    sun: CONST.CREATE_SUN,
    bomb: CONST.CREATE_BOMB,
    totem: CONST.CREATE_TOTEM
  };

  const TRIGGER_POINTS = {
    line: CONST.TRIGGER_LINE,
    sun: CONST.TRIGGER_SUN,
    bomb: CONST.TRIGGER_BOMB,
    totem: CONST.TRIGGER_TOTEM
  };

  function typeOf(item) {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') return item.type || item.kind || 'line';
    return 'line';
  }

  function sumRewards(list, table, fallback) {
    if (list == null) return { points: 0, count: 0 };
    if (typeof list === 'number') {
      const count = Math.max(0, Math.round(list));
      return { points: count * fallback, count: count };
    }
    const items = Array.isArray(list) ? list : [list];
    let points = 0;
    let count = 0;
    items.forEach(item => {
      if (item == null) return;
      if (typeof item === 'number') {
        points += Math.max(0, Math.round(item)) * fallback;
        count += Math.max(0, Math.round(item));
        return;
      }
      const type = typeOf(item);
      points += table[type] != null ? table[type] : fallback;
      count += 1;
    });
    return { points: points, count: count };
  }

  /* --- Очки за один каскад --------------------------------------------
   * Возвращает подробную раскладку. Именно её стоит копить в state,
   * чтобы к концу уровня показать базу и средний темп.
   *
   * opts:
   *   cells      — очищено клеток с учётом взрывов (clear.size);
   *   goalCells  — из них клеток цветов незакрытых целей;
   *   chain      — номер каскада, начиная с 1;
   *   creates    — созданные спецкамни (см. разбор выше);
   *   triggers   — сработавшие спецкамни (см. разбор выше);
   *   timeLeft, totalTime (или now, total) — для темпа;
   *   pace       — необязательный ручной множитель (для тестов).
   */
  function clearDetail(opts) {
    opts = opts || {};

    const cells = Math.max(0, num(opts.cells, 0));
    const goalCells = clamp(num(opts.goalCells, 0), 0, cells);
    const chain = Math.max(1, Math.round(num(opts.chain, 1)));
    const chainMult = Math.min(CONST.CHAIN_MAX, CONST.CHAIN_BASE + CONST.CHAIN_STEP * chain);

    const cellPoints = cells * CONST.CELL_POINTS;
    const goalPoints = goalCells * CONST.GOAL_CELL_POINTS;

    const create = sumRewards(opts.creates, CREATE_POINTS, CONST.CREATE_LINE);
    const trigger = sumRewards(opts.triggers, TRIGGER_POINTS, CONST.TRIGGER_LINE);

    const raw = (cellPoints + goalPoints + create.points + trigger.points) * chainMult;
    const pace = opts.pace != null ? num(opts.pace, 1) : paceFrom(opts);
    const score = Math.round(raw * pace);

    return {
      score: score,
      cells: cells,
      goalCells: goalCells,
      cellPoints: cellPoints,
      goalPoints: goalPoints,
      createPoints: create.points,
      triggerPoints: trigger.points,
      chain: chain,
      chainMult: chainMult,
      raw: raw,
      pace: pace,
      paceLabel: formatPace(pace)
    };
  }

  /* Короткий API: только целое число очков за каскад. */
  function clearScore(opts) {
    return clearDetail(opts).score;
  }

  /* --- Бонус за завершение уровня -------------------------------------
   * Маленький: за 1 секунду остатка платим не больше BONUS_PER_SEC.
   * Это заведомо меньше, чем приносит один нормальный ход, поэтому
   * «досиживание» не окупается.
   */
  function levelBonus(opts) {
    opts = opts || {};
    const total = Math.max(1, num(opts.totalTime != null ? opts.totalTime : opts.total, 1));
    const left = clamp(num(opts.timeLeft, 0), 0, total);
    const frac = left / total;
    const bonus = CONST.BONUS_PER_SEC * left * (1 - CONST.BONUS_DECAY * frac);
    return Math.round(bonus);
  }

  function levelBonusDetail(opts) {
    opts = opts || {};
    const total = Math.max(1, num(opts.totalTime != null ? opts.totalTime : opts.total, 1));
    const left = clamp(num(opts.timeLeft, 0), 0, total);
    const frac = left / total;
    return {
      bonus: levelBonus(opts),
      timeLeft: left,
      totalTime: total,
      frac: frac,
      perSecond: CONST.BONUS_PER_SEC * (1 - CONST.BONUS_DECAY * frac)
    };
  }

  /* --- Ранг скорости ---------------------------------------------------
   * Смотрим, какую долю времени игрок потратил. Это независимо от очков:
   * даже слабый игрок, закрывший цель быстро, получает звёзды за темп.
   */
  function speedRating(opts) {
    opts = opts || {};
    const total = Math.max(1, num(opts.totalTime != null ? opts.totalTime : opts.total, 1));
    const left = clamp(num(opts.timeLeft, 0), 0, total);
    const fracLeft = left / total;
    const used = 1 - fracLeft;

    let stars = 1;
    if (used <= CONST.RANK_3_USED + CONST.EPS) stars = 3;
    else if (used <= CONST.RANK_2_USED + CONST.EPS) stars = 2;

    return {
      stars: stars,
      maxStars: 3,
      rank: CONST.RANK_NAMES[stars - 1],
      usedShare: used,
      leftShare: fracLeft,
      starsLabel: '★'.repeat(stars) + '☆'.repeat(3 - stars)
    };
  }

  /* --- Данные для экрана итогов ---------------------------------------
   * base       — сумма raw по всем каскадам (уже с каскадным множителем,
   *              но ещё без темпа);
   * clearScore — фактически начислено за очистки (сумма score);
   * timeBonus  — бонус за остаток;
   * уровень/время — для ранга и подписи.
   *
   * Возвращаем готовые строки rows, чтобы UI мог отрисовать их как есть.
   */
  function formatBreakdown(opts) {
    opts = opts || {};
    const base = Math.round(num(opts.base, 0));
    const clearScore = Math.round(num(opts.clearScore, base));
    const timeBonus = Math.round(num(opts.timeBonus, levelBonus(opts)));
    const total = clearScore + timeBonus;
    const pace = base > 0 ? clearScore / base : paceFrom(opts);
    const rating = speedRating(opts);

    return {
      base: base,
      clearScore: clearScore,
      pace: round2(pace),
      paceLabel: formatPace(pace),
      timeBonus: timeBonus,
      total: total,
      stars: rating.stars,
      rank: rating.rank,
      starsLabel: rating.starsLabel,
      leftShare: rating.leftShare,
      usedShare: rating.usedShare,
      rows: [
        { key: 'base', label: 'Камни и паттерны', value: base },
        { key: 'pace', label: 'Средний темп', value: formatPace(pace), text: true },
        { key: 'time', label: 'Бонус времени', value: timeBonus }
      ]
    };
  }

  return {
    CONST: CONST,
    paceAt: paceAt,
    paceFrom: paceFrom,
    formatPace: formatPace,
    clearDetail: clearDetail,
    clearScore: clearScore,
    levelBonus: levelBonus,
    levelBonusDetail: levelBonusDetail,
    speedRating: speedRating,
    formatBreakdown: formatBreakdown
  };
});
