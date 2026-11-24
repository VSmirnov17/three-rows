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
  const STARS_BY_LEVEL = {
    1: { calm: [960, 2400], normal: [1650, 3000], challenge: [1400, 2650] },
    2: { calm: [1300, 2100], normal: [2600, 4050], challenge: [2450, 4150] },
    3: { calm: [1750, 2900], normal: [3000, 4700], challenge: [2800, 4550] },
    4: { calm: [1700, 2600], normal: [3050, 4600], challenge: [2950, 4500] },
    5: { calm: [2550, 3900], normal: [4550, 6500], challenge: [4350, 6400] },
    6: { calm: [1500, 2200], normal: [3100, 4700], challenge: [3100, 4750] },
    7: { calm: [2000, 3150], normal: [3700, 5700], challenge: [3350, 5300] },
    8: { calm: [1250, 1900], normal: [2500, 4100], challenge: [2550, 4100] },
    9: { calm: [2100, 3100], normal: [3800, 5800], challenge: [3750, 5600] },
    10: { calm: [2500, 3850], normal: [3850, 5800], challenge: [3550, 5400] },
    11: { calm: [2250, 3350], normal: [3850, 5800], challenge: [3500, 5700] },
    12: { calm: [1900, 2850], normal: [3950, 5800], challenge: [4100, 6300] },
    13: { calm: [2250, 3550], normal: [4450, 6400], challenge: [4150, 6300] },
    14: { calm: [1600, 2400], normal: [3150, 4650], challenge: [3050, 4600] },
    15: { calm: [1800, 3100], normal: [2700, 4250], challenge: [2350, 3800] },
    16: { calm: [2200, 3550], normal: [3950, 5900], challenge: [3600, 5400] },
    17: { calm: [2950, 4750], normal: [4800, 7000], challenge: [4350, 6300] },
    18: { calm: [2850, 4600], normal: [3700, 5600], challenge: [3150, 4650] },
    19: { calm: [3400, 5200], normal: [5200, 7300], challenge: [4700, 6700] },
    20: { calm: [2450, 3850], normal: [3550, 5400], challenge: [2900, 4500] }
  };

  const STARS = n => {
    const s = STARS_BY_LEVEL[n];
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
    bg: 'assets/backdrop/land6/plate.webp',
    /* Живой фон: своя плита, рассвет справа светлее и теплее, чем у земли 5
       (третий шаг рассвета), луны нет; облака общие с землёй 1.
       Размер — assets/backdrop/land6/backdrop.json (tools/pack_backdrop.py --land 6) */
    backdrop: {
      plate: 'assets/backdrop/land6/plate.webp',
      clouds: 'assets/backdrop/land1/clouds.webp',
      waterfall: false
    },
    /* Своего тайла мозаики нет: мозаика — та же плита фона */
    mosaic: 'assets/backdrop/land6/plate.webp',
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
        'm......m',
        '........',
        '........',
        '...mm...',
        '........',
        '........',
        '........',
        'm......m']),
      lvl(2, 'Кочки', 140, {}, [[2, 12]], [
        '........',
        '.m....m.',
        '........',
        '...mm...',
        '........',
        '........',
        '.m....m.',
        '........']),
      lvl(3, 'Гнилая гать', 160, {}, [[0, 14]], [
        'm......m',
        '........',
        '........',
        '..m..m..',
        '..m..m..',
        '........',
        '........',
        'm......m']),
      lvl(4, 'Ряска', 170, {}, [[3, 16]], [
        '........',
        '.mm..mm.',
        '........',
        '........',
        '...%%...',
        '........',
        '.mm..mm.',
        '........']),
      lvl(5, 'Туманная заводь', 190, {}, [[1, 14], [4, 14]], [
        'mm....mm',
        'm......m',
        '........',
        '...mm...',
        '...mm...',
        '........',
        'm......m',
        'mm....mm']),
      lvl(6, 'Старый пень', 190, {}, [[5, 14]], [
        '........',
        '.m.11.m.',
        '........',
        '.1....1.',
        '...mm...',
        '........',
        '.m....m.',
        '..%..%..']),
      lvl(7, 'Корни', 210, {}, [[2, 16]], [
        'm..2...m',
        '........',
        '.m....m.',
        '...mm...',
        '.1....1.',
        '........',
        'm..*...m',
        'm......m']),
      lvl(8, 'Тихая протока', 150, {}, [[0, 12]], [
        '........',
        '........',
        '..m..m..',
        '........',
        '...11...',
        '........',
        '..m..m..',
        '........']),
      lvl(9, 'Затянутый мостик', 220, {}, [[3, 16]], [
        '........',
        'm.vvvv.m',
        '........',
        '.m.mm.m.',
        '........',
        '..1..1..',
        'm......m',
        '..~~~~..']),
      lvl(10, 'Болотные огни', 230, {}, [[4, 18]], [
        'mm....mm',
        '...vv...',
        '.2....2.',
        '...mm...',
        '...mm...',
        '.v....v.',
        '........',
        'mm.%%.mm']),
      lvl(11, 'Трясина', 240, {}, [[1, 18]], [
        'm.m..m.m',
        '........',
        '.vv..vv.',
        '...22...',
        '........',
        'm......m',
        'mm....mm',
        '..*..*..']),
      lvl(12, 'Затонувшая плита', 240, {}, [[2, 16]], [
        '........',
        '.m....m.',
        '..oooo..',
        '.mo..om.',
        '.mo..om.',
        '..oooo..',
        '.m....m.',
        '...++...']),
      lvl(13, 'Мшистые ступени', 260, {}, [[0, 18]], [
        'mm....mm',
        '..o..o..',
        '.2.oo.2.',
        '........',
        'm......m',
        '.o.mm.o.',
        '........',
        'm.%..%.m']),
      lvl(14, 'Сухой островок', 170, {}, [[3, 14]], [
        '........',
        '...oo...',
        '.m....m.',
        '........',
        '........',
        '.m....m.',
        '...oo...',
        '........']),
      lvl(15, 'Идол в тумане', 260, { gifts: 2 }, [], [
        'm......m',
        '........',
        '..B..D..',
        '.m....m.',
        '...mm...',
        '.1....1.',
        'm......m',
        'mm.%%.mm']),
      lvl(16, 'Гнездо цапли', 280, { gifts: 2 }, [[5, 16]], [
        'mm....mm',
        '...mm...',
        '..A..C..',
        '........',
        '........',
        '.m.22.m.',
        '........',
        'm.%..%.m']),
      lvl(17, 'Чёрная топь', 300, {}, [[2, 20]], [
        'mmm..mmm',
        'm......m',
        '..3..3..',
        '...mm...',
        '...mm...',
        'o......o',
        'oo.mm.oo',
        '..*..*..']),
      lvl(18, 'Затопленный храм', 320, { gifts: 2 }, [], [
        'mm....mm',
        '.E....F.',
        'oo.mm.oo',
        'o.2..2.o',
        'o......o',
        'oo.mm.oo',
        'm......m',
        'mm.++.mm']),
      lvl(19, 'Сердце трясины', 340, { gifts: 2 }, [[1, 20]], [
        'm.m..m.m',
        '.C....A.',
        '...mm...',
        '.2.mm.2.',
        '........',
        '.3....3.',
        'm......m',
        'mm%..%mm']),
      lvl(20, 'Логово мха', 360, { gifts: 2 }, [], [
        'mmm..mmm',
        'm.D..B.m',
        '..2..2..',
        'o..mm..o',
        'oo.mm.oo',
        '........',
        'm.3..3.m',
        'mm%++%mm'])
    ]
  };

  if (typeof window !== 'undefined') (window.CAMPAIGN_LANDS = window.CAMPAIGN_LANDS || []).push(land);
  if (typeof module !== 'undefined' && module.exports) module.exports = land;
})();
