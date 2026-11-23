/* Земля 6 — Болота. Механика: мох (moss).
 *
 * Кочка мха занимает клетку, как валун прочности 1; камни падают сквозь неё.
 * Ряд в одной из восьми клеток вокруг или удар спецкамня по её клетке
 * счищает мох. Если ход не задел мох, мох съедает соседний по стороне камень
 * (на «Спокойно» — через ход), но не больше mossMax клеток и никогда не
 * последний ход на поле.
 *
 * Раскладка уровня — 8 строк по 8 символов:
 *   m мох   % мох только на «Испытании»
 *   A B C D E F идол цвета 0..5
 *   1 2 3 валун такой прочности   * валун прочности 1 только на «Испытании»
 *   o плита   v лиана   # плита под лианой
 *   + плита только на «Испытании»   ~ лиана только на «Испытании»
 * gifts — сколько даров нужно каждому идолу уровня.
 * stars — пороги по очкам бота (tools/level-bot.js).
 */
(function () {
  'use strict';

  /* Пороги звёзд [s2, s3]: node tools/level-bot.js --suggest --lands 6 --js */
  const STARS_BY_LEVEL = {};

  const STARS = n => {
    const s = STARS_BY_LEVEL[n] || { calm: [2000, 3500], normal: [2500, 4000], challenge: [2200, 3600] };
    return { calm: s.calm.slice(), normal: s.normal.slice(), challenge: s.challenge.slice() };
  };

  /* Разбирает раскладку в списки клеток. */
  function parseLayout(rows, gifts) {
    const out = {
      moss: [], idols: [], boulders: [], plates: [], vines: [],
      moreMoss: [], moreBoulders: [], morePlates: [], moreVines: []
    };
    rows.forEach((line, r) => {
      Array.from(line).forEach((ch, c) => {
        const color = 'ABCDEF'.indexOf(ch);
        if (ch === 'm') out.moss.push([r, c]);
        if (ch === '%') out.moreMoss.push([r, c]);
        if (color >= 0) out.idols.push([r, c, color, gifts]);
        if (ch === '1' || ch === '2' || ch === '3') out.boulders.push([r, c, Number(ch)]);
        if (ch === '*') out.moreBoulders.push([r, c, 1]);
        if (ch === 'o' || ch === '#') out.plates.push([r, c]);
        if (ch === 'v' || ch === '#') out.vines.push([r, c]);
        if (ch === '+') out.morePlates.push([r, c]);
        if (ch === '~') out.moreVines.push([r, c]);
      });
    });
    return out;
  }

  /* opts: { gifts, mossMax } */
  const lvl = (n, name, time, opts, colors, rows) => {
    const cells = parseLayout(rows, opts.gifts || 2);
    const goals = colors.map(([color, need]) => ({ type: 'color', color, need }));
    goals.push({ type: 'moss' });
    if (cells.idols.length) goals.push({ type: 'idols' });
    if (cells.boulders.length) goals.push({ type: 'boulders' });
    if (cells.plates.length) goals.push({ type: 'plates' });
    if (cells.vines.length) goals.push({ type: 'vines' });
    const level = {
      id: '6-' + String(n).padStart(2, '0'),
      name,
      time,
      goals,
      moss: cells.moss,
      idols: cells.idols,
      boulders: cells.boulders,
      plates: cells.plates,
      vines: cells.vines,
      stars: STARS(n)
    };
    if (opts.mossMax) level.mossMax = opts.mossMax;
    if (cells.moreMoss.length || cells.moreBoulders.length || cells.morePlates.length || cells.moreVines.length) {
      level.challenge = { moss: cells.moreMoss, boulders: cells.moreBoulders, plates: cells.morePlates, vines: cells.moreVines };
    }
    return level;
  };

  const land = {
    id: 6,
    key: 'swamp',
    name: 'Болота',
    bg: 'assets/backdrop/land5/plate.webp',
    /* Пока своей плиты нет — фон Озёрного города */
    backdrop: {
      plate: 'assets/backdrop/land5/plate.webp',
      clouds: 'assets/backdrop/land1/clouds.webp',
      waterfall: false
    },
    mosaic: 'assets/backdrop/land5/plate.webp',
    mechanic: 'moss',
    scenes: {
      intro: [
        'Болота затянуты туманом. Тзаркун растит здесь тёмный мох.',
        'Мох съедает камни. Если не тронуть его за ход, он разрастётся.',
        'Собери ряд рядом с кочкой мха — она исчезнет. Очисти всё болото.'
      ],
      outro: [
        'Мох отступил. Над болотом поднимается туман.',
        'Небо на востоке светлеет. Ночь уходит.',
        'Впереди Вулкан. Там плиты лежат в два слоя.'
      ]
    },
    levels: [
      lvl(1, 'Топкий берег', 120, {}, [], [
        '........',
        '........',
        '........',
        '...mm...',
        '........',
        '........',
        '........',
        '........']),
      lvl(2, 'Кочки', 140, {}, [[2, 12]], [
        '........',
        '.m......',
        '........',
        '........',
        '........',
        '......m.',
        '.....mm.',
        '........']),
      lvl(3, 'Гнилая гать', 160, {}, [[0, 14]], [
        '........',
        '........',
        'mm....mm',
        '........',
        '........',
        '...mm...',
        '...mm...',
        '........'])
    ]
  };

  if (typeof window !== 'undefined') (window.CAMPAIGN_LANDS = window.CAMPAIGN_LANDS || []).push(land);
  if (typeof module !== 'undefined' && module.exports) module.exports = land;
})();
