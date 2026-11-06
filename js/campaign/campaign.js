/* Хранитель Солнца — движок кампании: земли, уровни, правила сложности.
 *
 * Модуль не зависит от DOM. В браузере файлы земель (land-NN.js) подключены
 * раньше и кладут данные в window.CAMPAIGN_LANDS; в Node список файлов
 * берётся из LAND_FILES.
 */
(function (factory) {
  'use strict';

  const Campaign = factory();

  if (typeof window !== 'undefined') window.Campaign = Campaign;
  if (typeof module !== 'undefined' && module.exports) module.exports = Campaign;
})(function () {
  'use strict';

  const LAND_FILES = ['./land-01.js', './land-02.js'];
  const DIFFICULTIES = ['calm', 'normal', 'challenge'];
  const ROWS = 8;
  const COLS = 8;
  const COLORS = 6;

  const CHALLENGE_TIME = 0.8;
  const CHALLENGE_NEED = 1.3;

  const PROLOGUE = [
    'Повелитель Ночи Тзаркун украл Солнце. Мир погрузился во тьму.',
    'Солнечный Камень разбился на осколки и разлетелся по десяти землям.',
    'Я, старый жрец Кайоль, верю в тебя, хранитель. Собери Камень и верни свет.'
  ];

  function loadLands() {
    if (typeof window !== 'undefined' && window.CAMPAIGN_LANDS) return window.CAMPAIGN_LANDS;
    if (typeof require === 'function') return LAND_FILES.map(f => require(f));
    return [];
  }

  const LANDS = loadLands().slice().sort((a, b) => a.id - b.id);
  const INDEX = new Map();
  const ORDER = [];
  LANDS.forEach(land => {
    land.levels.forEach(level => {
      INDEX.set(level.id, { level, land });
      ORDER.push(level.id);
    });
  });

  function lands() {
    return LANDS;
  }

  function level(id) {
    const e = INDEX.get(id);
    return e ? e.level : null;
  }

  function landOf(id) {
    const e = INDEX.get(id);
    return e ? e.land : null;
  }

  function allLevelIds() {
    return ORDER.slice();
  }

  function nextLevelId(id) {
    const i = ORDER.indexOf(id);
    return i >= 0 && i + 1 < ORDER.length ? ORDER[i + 1] : null;
  }

  function resolve(id, difficulty) {
    const e = INDEX.get(id);
    if (!e) return null;
    const lv = e.level;
    const hard = difficulty === 'challenge';

    let vines = (lv.vines || []).map(v => [v[0], v[1]]);
    if (hard && lv.challenge && lv.challenge.vines) {
      vines = vines.concat(lv.challenge.vines.map(v => [v[0], v[1]]));
    }

    const goals = lv.goals.map(g => {
      if (g.type === 'vines') return { type: 'vines', need: vines.length };
      const need = hard ? Math.ceil(g.need * CHALLENGE_NEED) : g.need;
      return { type: g.type, color: g.color, need };
    });

    const econTime = hard ? Math.round(lv.time * CHALLENGE_TIME) : lv.time;
    const stars = (lv.stars && lv.stars[difficulty]) || [1, 2];

    return {
      id: lv.id,
      name: lv.name,
      landId: e.land.id,
      timer: difficulty === 'calm' ? null : econTime,
      econTime,
      goals,
      vines,
      stars: stars.slice()
    };
  }

  function validate() {
    const errors = [];
    const seen = new Set();
    const inBoard = v => Array.isArray(v) && v.length === 2 &&
      Number.isInteger(v[0]) && Number.isInteger(v[1]) &&
      v[0] >= 0 && v[0] < ROWS && v[1] >= 0 && v[1] < COLS;

    LANDS.forEach(land => {
      if (!land.scenes || !land.scenes.intro || !land.scenes.outro) {
        errors.push('земля ' + land.id + ': нет сцен intro/outro');
      }
      land.levels.forEach((lv, i) => {
        const tag = lv.id;
        const expected = land.id + '-' + String(i + 1).padStart(2, '0');
        if (lv.id !== expected) errors.push(tag + ': ожидался id ' + expected);
        if (seen.has(lv.id)) errors.push(tag + ': повторяющийся id');
        seen.add(lv.id);
        if (!lv.name) errors.push(tag + ': нет названия');
        if (!(lv.time > 0)) errors.push(tag + ': time должен быть > 0');

        if (!Array.isArray(lv.goals) || lv.goals.length === 0) {
          errors.push(tag + ': нет целей');
        } else {
          const goalColors = new Set();
          lv.goals.forEach(g => {
            if (g.type === 'color') {
              /* Игра засчитывает камень в каждую цель его цвета, бот — в одну:
                 две цели одного цвета разошли бы симулятор и игру */
              if (goalColors.has(g.color)) errors.push(tag + ': две цели одного цвета ' + g.color);
              goalColors.add(g.color);
              if (!Number.isInteger(g.color) || g.color < 0 || g.color >= COLORS) {
                errors.push(tag + ': цвет цели вне 0..' + (COLORS - 1));
              }
              if (!(g.need > 0)) errors.push(tag + ': need цели должен быть > 0');
            } else if (g.type !== 'vines') {
              errors.push(tag + ': неизвестный тип цели ' + g.type);
            }
          });
        }

        const base = lv.vines || [];
        const extra = (lv.challenge && lv.challenge.vines) || [];
        const cells = new Set();
        base.concat(extra).forEach(v => {
          if (!inBoard(v)) {
            errors.push(tag + ': лиана вне поля ' + JSON.stringify(v));
            return;
          }
          const key = v[0] * COLS + v[1];
          if (cells.has(key)) errors.push(tag + ': лиана повторяется ' + JSON.stringify(v));
          cells.add(key);
        });
        if (lv.goals.some(g => g.type === 'vines') && base.length === 0) {
          errors.push(tag + ': цель vines без лиан');
        }

        DIFFICULTIES.forEach(d => {
          const s = lv.stars && lv.stars[d];
          if (!Array.isArray(s) || s.length !== 2 || !(s[0] > 0) || !(s[1] >= s[0])) {
            errors.push(tag + ': stars.' + d + ' должны быть [s2, s3]');
          }
        });
      });
    });
    return errors;
  }

  return {
    LAND_FILES,
    DIFFICULTIES,
    PROLOGUE,
    lands,
    level,
    landOf,
    allLevelIds,
    nextLevelId,
    resolve,
    validate
  };
});
