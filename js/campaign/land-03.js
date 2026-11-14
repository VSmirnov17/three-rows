/* Земля 3 — Лунные пещеры. Механика: золотые плиты под камнями (plates).
 *
 * Раскладка уровня — 8 строк по 8 символов:
 *   o плита   v лиана   # плита под лианой
 *   + плита только на «Испытании»   ~ лиана только на «Испытании»
 * stars — пороги по очкам бота (tools/level-bot.js).
 */
(function () {
  'use strict';

  /* Пороги звёзд [s2, s3]: node tools/level-bot.js --suggest --lands 3 --js */
  const STARS_BY_LEVEL = {
    1: { calm: [670, 1400], normal: [1250, 2450], challenge: [1100, 2200] },
    2: { calm: [2000, 2950], normal: [2600, 4450], challenge: [2350, 4100] },
    3: { calm: [2250, 2950], normal: [2900, 4450], challenge: [2600, 4100] },
    4: { calm: [2600, 3800], normal: [3300, 5300], challenge: [2950, 4650] },
    5: { calm: [2700, 3650], normal: [3300, 5000], challenge: [2950, 4450] },
    6: { calm: [3600, 4800], normal: [5300, 7500], challenge: [4850, 7500] },
    7: { calm: [3150, 4200], normal: [4100, 6300], challenge: [3900, 5800] },
    8: { calm: [1900, 2650], normal: [2700, 4250], challenge: [2500, 3950] },
    9: { calm: [4250, 5400], normal: [6500, 9200], challenge: [5900, 8700] },
    10: { calm: [3650, 5100], normal: [4750, 7000], challenge: [4200, 6300] },
    11: { calm: [5500, 8200], normal: [8100, 11200], challenge: [7400, 10700] },
    12: { calm: [5700, 7700], normal: [7500, 10400], challenge: [6600, 9800] },
    13: { calm: [6000, 8400], normal: [7900, 11000], challenge: [6800, 10000] },
    14: { calm: [2400, 3350], normal: [3050, 4700], challenge: [2750, 4450] },
    15: { calm: [6400, 8700], normal: [8500, 12000], challenge: [7600, 10900] },
    16: { calm: [6200, 8300], normal: [8400, 11800], challenge: [7700, 11100] },
    17: { calm: [6600, 8700], normal: [9500, 12800], challenge: [8200, 11700] },
    18: { calm: [8400, 11200], normal: [12000, 16300], challenge: [11300, 15500] },
    19: { calm: [8900, 11700], normal: [13300, 17700], challenge: [12100, 16500] },
    20: { calm: [8300, 10400], normal: [12400, 16500], challenge: [11100, 16000] }
  };

  const STARS = n => {
    const s = STARS_BY_LEVEL[n];
    return { calm: s.calm.slice(), normal: s.normal.slice(), challenge: s.challenge.slice() };
  };

  /* Разбирает раскладку в списки клеток. */
  function parseLayout(rows) {
    const out = { plates: [], vines: [], morePlates: [], moreVines: [] };
    rows.forEach((line, r) => {
      Array.from(line).forEach((ch, c) => {
        if (ch === 'o' || ch === '#') out.plates.push([r, c]);
        if (ch === 'v' || ch === '#') out.vines.push([r, c]);
        if (ch === '+') out.morePlates.push([r, c]);
        if (ch === '~') out.moreVines.push([r, c]);
      });
    });
    return out;
  }

  const lvl = (n, name, time, colors, rows) => {
    const cells = parseLayout(rows);
    const goals = colors.map(([color, need]) => ({ type: 'color', color, need }));
    goals.push({ type: 'plates' });
    if (cells.vines.length) goals.push({ type: 'vines' });
    const level = {
      id: '3-' + String(n).padStart(2, '0'),
      name,
      time,
      goals,
      plates: cells.plates,
      vines: cells.vines,
      stars: STARS(n)
    };
    if (cells.morePlates.length || cells.moreVines.length) {
      level.challenge = { plates: cells.morePlates, vines: cells.moreVines };
    }
    return level;
  };

  const land = {
    id: 3,
    key: 'moon',
    name: 'Лунные пещеры',
    bg: 'assets/backdrop/land3/plate.webp',
    /* Живой фон пещеры (js/visuals-backdrop.js): только плита и общие светлячки,
       без воды, луны и облаков (неба в пещере нет). Размер плиты — из
       assets/backdrop/land3/backdrop.json (tools/pack_backdrop.py --land 3) */
    backdrop: {
      plate: 'assets/backdrop/land3/plate.webp',
      waterfall: false
    },
    mosaic: 'assets/art/bg-moon.webp',
    mechanic: 'plates',
    scenes: {
      intro: [
        'В Лунных пещерах пол выложен старым золотом. Плиты сияют под камнями.',
        'Сложи ряд над плитой, и она исчезнет. Очисти все плиты до одной.',
        'Под золотом Тзаркун спрятал осколки Камня. Найди их при свете луны.'
      ],
      outro: [
        'Золото поднято. Мозаика Луны сложена до последнего осколка.',
        'Луна снова видит дорогу. Ночь ещё глубока, но ты идёшь не один.',
        'Дальше — Горная тропа. Там путь преградят валуны.'
      ]
    },
    levels: [
      lvl(1, 'Вход в пещеру', 120, [], [
        '........',
        '........',
        '........',
        '..oooo..',
        '..oooo..',
        '........',
        '........',
        '........']),
      lvl(2, 'Лунная дорожка', 120, [[0, 18]], [
        '........',
        '........',
        '........',
        '.oooooo.',
        '.oooooo.',
        '........',
        '........',
        '........']),
      lvl(3, 'Перекрёсток', 125, [[2, 20]], [
        '........',
        '...oo...',
        '...oo...',
        '.oooooo.',
        '...oo...',
        '...oo...',
        '........',
        '........']),
      lvl(4, 'Две галереи', 140, [[4, 22]], [
        '........',
        '.ooo.ooo',
        '.ooo.ooo',
        '.ooo.ooo',
        '........',
        '...++...',
        '...++...',
        '........']),
      lvl(5, 'Лунное кольцо', 145, [[1, 24]], [
        '........',
        '.oooooo.',
        '.o....o.',
        '.o....o.',
        '.o....o.',
        '.oooooo.',
        '...++...',
        '........']),
      lvl(6, 'Подземный двор', 175, [[3, 24], [5, 20]], [
        '........',
        '..oooo..',
        '.oooooo.',
        '.oo..oo.',
        '.oo..oo.',
        '.oooooo.',
        '..oooo..',
        '...++...']),
      lvl(7, 'Первые корни', 200, [[0, 26]], [
        '........',
        '.oo..oo.',
        '.oo..oo.',
        '...vv...',
        '...vv...',
        '.oo..oo.',
        '.oo..oo.',
        '...++~~.']),
      lvl(8, 'Тихая заводь', 120, [[2, 18]], [
        '........',
        '........',
        '..oooo..',
        '..oooo..',
        '..oooo..',
        '........',
        '........',
        '........']),
      lvl(9, 'Хрустальный зал', 215, [[4, 28], [1, 24]], [
        '........',
        '.o....o.',
        '.oo..oo.',
        '..oooo..',
        '..oooo..',
        '.oo..oo.',
        '.o.++.o.',
        '........']),
      lvl(10, 'Спящие своды', 240, [[3, 30]], [
        'oooooooo',
        '........',
        'oooooooo',
        '...vv...',
        '...vv...',
        'oooooooo',
        '..~..~..',
        '.++..++.']),
      lvl(11, 'Лестница теней', 280, [[5, 30], [0, 26]], [
        'oo......',
        'ooo.....',
        '.ooo.v..',
        '..ooo...',
        '...ooo..',
        '..v.ooo.',
        '.....ooo',
        '+.....oo']),
      lvl(12, 'Золотой пояс', 245, [[2, 32], [4, 28]], [
        '........',
        'oooooooo',
        'oooooooo',
        'v..~~..v',
        'v......v',
        'oooooooo',
        'oooooooo',
        '..++++..']),
      lvl(13, 'Лунный колодец', 310, [[1, 34], [3, 30]], [
        '.oooooo.',
        'oo....oo',
        'o..vv..o',
        'o.v++v.o',
        'o.v++v.o',
        'o..vv..o',
        'oo....oo',
        '.oooooo.']),
      lvl(14, 'Тёплый камень', 125, [[5, 22]], [
        '........',
        '...oo...',
        '..oooo..',
        '.oooooo.',
        '..oooo..',
        '...oo...',
        '........',
        '........']),
      lvl(15, 'Сеть трещин', 300, [[0, 36], [2, 32]], [
        'o.o.o.o.',
        '.o.o.o.o',
        'o.o.o.o.',
        '.o#o#o.o',
        'o.#.#.o.',
        '.o.o.o.o',
        'o.o.o.o.',
        '.o+o+o.o']),
      lvl(16, 'Галерея предков', 305, [[4, 36], [1, 34]], [
        'oooooooo',
        'oo.vv.oo',
        'oo....oo',
        'oooooooo',
        'oooooooo',
        'oo....oo',
        'oo.vv.oo',
        '~+++++~~']),
      lvl(17, 'Серебряный ключ', 350, [[3, 38], [5, 34]], [
        '.oooooo.',
        'oooooooo',
        'oov..voo',
        'oo.~~.oo',
        'oo.++.oo',
        'oov..voo',
        'oooooooo',
        '.oooooo.']),
      lvl(18, 'Зал отражений', 375, [[2, 38], [0, 34], [4, 30]], [
        'oooo#ooo',
        'oooo.ooo',
        'oo#.+.oo',
        'oo.+.#oo',
        'oo#.+.oo',
        'oo.+.#oo',
        'oooo.ooo',
        'ooo#oooo']),
      lvl(19, 'Глубокая жила', 385, [[1, 40], [3, 36], [5, 30]], [
        'oooooooo',
        'o#oooo#o',
        'oo....oo',
        'oo.++.oo',
        'oo.++.oo',
        'oo....oo',
        'o#oooo#o',
        'oooooooo']),
      lvl(20, 'Сердце Луны', 385, [[0, 42], [2, 38], [4, 34]], [
        '+oooooo+',
        'oooooooo',
        'ooo##ooo',
        'oo#++#oo',
        'oo#++#oo',
        'ooo##ooo',
        'oooooooo',
        '+oooooo+'])
    ]
  };

  if (typeof window !== 'undefined') (window.CAMPAIGN_LANDS = window.CAMPAIGN_LANDS || []).push(land);
  if (typeof module !== 'undefined' && module.exports) module.exports = land;
})();
