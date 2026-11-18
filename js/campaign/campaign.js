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

  const LAND_FILES = ['./land-01.js', './land-02.js', './land-03.js', './land-04.js', './land-05.js'];
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

    /* Клетки слоя key (лианы, плиты); на «Испытании» — с добавкой challenge */
    const cellsOf = key => {
      const extra = (hard && lv.challenge && lv.challenge[key]) || [];
      return (lv[key] || []).concat(extra).map(v => [v[0], v[1]]);
    };
    const vines = cellsOf('vines');
    const plates = cellsOf('plates');
    /* Валуны — [r, c, прочность] */
    const boulders = (lv.boulders || []).concat((hard && lv.challenge && lv.challenge.boulders) || [])
      .map(v => [v[0], v[1], v[2] || 1]);
    const relics = cellsOf('relics');

    const goals = lv.goals.map(g => {
      if (g.type === 'vines') return { type: 'vines', need: vines.length };
      if (g.type === 'plates') return { type: 'plates', need: plates.length };
      if (g.type === 'boulders') return { type: 'boulders', need: boulders.length };
      if (g.type === 'relics') return { type: 'relics', need: relics.length };
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
      plates,
      boulders,
      relics,
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
            } else if (g.type !== 'vines' && g.type !== 'plates' && g.type !== 'boulders' && g.type !== 'relics') {
              errors.push(tag + ': неизвестный тип цели ' + g.type);
            }
          });
        }

        [['vines', 'лиана', 'лиан'], ['plates', 'плита', 'плит']].forEach(([key, one, many]) => {
          const base = lv[key] || [];
          const extra = (lv.challenge && lv.challenge[key]) || [];
          const cells = new Set();
          base.concat(extra).forEach(v => {
            if (!inBoard(v)) {
              errors.push(tag + ': ' + one + ' вне поля ' + JSON.stringify(v));
              return;
            }
            const cell = v[0] * COLS + v[1];
            if (cells.has(cell)) errors.push(tag + ': ' + one + ' повторяется ' + JSON.stringify(v));
            cells.add(cell);
          });
          if (lv.goals.some(g => g.type === key) && base.length === 0) {
            errors.push(tag + ': цель ' + key + ' без ' + many);
          }
        });

        /* Валуны: [r, c, прочность 1..3], не на плите и не на лиане — с учётом
           клеток «Испытания», которые добавляются на этой сложности */
        const allOf = key => (lv[key] || []).concat((lv.challenge && lv.challenge[key]) || []);
        const cellSet = key => new Set(allOf(key).filter(inBoard).map(v => v[0] * COLS + v[1]));
        const plateCells = cellSet('plates');
        const vineCells = cellSet('vines');
        const boulderCells = new Set();
        allOf('boulders').forEach(v => {
          if (!Array.isArray(v) || !inBoard(v.slice(0, 2))) {
            errors.push(tag + ': валун вне поля ' + JSON.stringify(v));
            return;
          }
          const hp = v[2] == null ? 1 : v[2];
          if (!Number.isInteger(hp) || hp < 1 || hp > 3) errors.push(tag + ': прочность валуна вне 1..3 ' + JSON.stringify(v));
          const cell = v[0] * COLS + v[1];
          if (boulderCells.has(cell)) errors.push(tag + ': валун повторяется ' + JSON.stringify(v));
          if (plateCells.has(cell)) errors.push(tag + ': валун на плите ' + JSON.stringify(v));
          if (vineCells.has(cell)) errors.push(tag + ': валун на лиане ' + JSON.stringify(v));
          boulderCells.add(cell);
        });
        if (lv.goals.some(g => g.type === 'boulders') && (lv.boulders || []).length === 0) {
          errors.push(tag + ': цель boulders без валунов');
        }

        /* Идолы: не на валуне, не на лиане и не в нижней строке (там их
           сразу бы засчитало) — с учётом клеток «Испытания» */
        const relicCells = new Set();
        allOf('relics').forEach(v => {
          if (!inBoard(v)) {
            errors.push(tag + ': идол вне поля ' + JSON.stringify(v));
            return;
          }
          const cell = v[0] * COLS + v[1];
          if (relicCells.has(cell)) errors.push(tag + ': идол повторяется ' + JSON.stringify(v));
          if (boulderCells.has(cell)) errors.push(tag + ': идол на валуне ' + JSON.stringify(v));
          if (vineCells.has(cell)) errors.push(tag + ': идол на лиане ' + JSON.stringify(v));
          if (v[0] === ROWS - 1) errors.push(tag + ': идол в нижней строке ' + JSON.stringify(v));
          relicCells.add(cell);
        });
        if (lv.goals.some(g => g.type === 'relics') && (lv.relics || []).length === 0) {
          errors.push(tag + ': цель relics без идолов');
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
