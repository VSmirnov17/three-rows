/* Земля 5 — Озёрный город. Механика: реликвии (золотые идолы, relics).
 *
 * Раскладка уровня — 8 строк по 8 символов:
 *   i идол   ^ идол только на «Испытании»
 *   1 2 3 валун такой прочности   * валун прочности 1 только на «Испытании»
 *   o плита   v лиана   # плита под лианой
 *   + плита только на «Испытании»   ~ лиана только на «Испытании»
 * stars — пороги по очкам бота (tools/level-bot.js).
 */
(function () {
  'use strict';

  /* Пороги звёзд [s2, s3]: node tools/level-bot.js --suggest --lands 5 --js */
  const STARS_BY_LEVEL = {
    1: { calm: [300, 700], normal: [700, 1600], challenge: [700, 1600] },
    2: { calm: [1800, 2700], normal: [2600, 4300], challenge: [2400, 4100] },
    3: { calm: [2000, 2800], normal: [2800, 4400], challenge: [2400, 4000] },
    4: { calm: [2200, 3100], normal: [2800, 4700], challenge: [2400, 4300] },
    5: { calm: [2400, 3200], normal: [2800, 4600], challenge: [2400, 3900] },
    6: { calm: [2400, 3300], normal: [3200, 5100], challenge: [2800, 4600] },
    7: { calm: [2600, 3700], normal: [3400, 5300], challenge: [3000, 4800] },
    8: { calm: [1900, 2700], normal: [2600, 4300], challenge: [2400, 4000] },
    9: { calm: [2600, 3600], normal: [3700, 5700], challenge: [3300, 5300] },
    10: { calm: [3000, 4000], normal: [3800, 5900], challenge: [3400, 5200] },
    11: { calm: [3200, 4200], normal: [4500, 6700], challenge: [4000, 6200] },
    12: { calm: [3000, 3900], normal: [4700, 6800], challenge: [4300, 6500] },
    13: { calm: [3200, 4200], normal: [4400, 6100], challenge: [3700, 5500] },
    14: { calm: [2000, 2800], normal: [2800, 4400], challenge: [2500, 4100] },
    15: { calm: [5000, 7800], normal: [5100, 7400], challenge: [4300, 6200] },
    16: { calm: [5100, 8300], normal: [6000, 8800], challenge: [5200, 7400] },
    17: { calm: [4000, 5200], normal: [5800, 8000], challenge: [5000, 7200] },
    18: { calm: [5500, 8600], normal: [5900, 8300], challenge: [5100, 7300] },
    19: { calm: [5400, 8100], normal: [6100, 8700], challenge: [5000, 7300] },
    20: { calm: [5200, 7400], normal: [6000, 8000], challenge: [4800, 6900] }
  };

  const STARS = n => {
    const s = STARS_BY_LEVEL[n];
    return { calm: s.calm.slice(), normal: s.normal.slice(), challenge: s.challenge.slice() };
  };

  /* Разбирает раскладку в списки клеток. */
  function parseLayout(rows) {
    const out = {
      relics: [], boulders: [], plates: [], vines: [],
      moreRelics: [], moreBoulders: [], morePlates: [], moreVines: []
    };
    rows.forEach((line, r) => {
      Array.from(line).forEach((ch, c) => {
        if (ch === 'i') out.relics.push([r, c]);
        if (ch === '^') out.moreRelics.push([r, c]);
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

  const lvl = (n, name, time, colors, rows) => {
    const cells = parseLayout(rows);
    const goals = colors.map(([color, need]) => ({ type: 'color', color, need }));
    goals.push({ type: 'relics' });
    if (cells.boulders.length) goals.push({ type: 'boulders' });
    if (cells.plates.length) goals.push({ type: 'plates' });
    if (cells.vines.length) goals.push({ type: 'vines' });
    const level = {
      id: '5-' + String(n).padStart(2, '0'),
      name,
      time,
      goals,
      relics: cells.relics,
      boulders: cells.boulders,
      plates: cells.plates,
      vines: cells.vines,
      stars: STARS(n)
    };
    const more = { relics: cells.moreRelics, boulders: cells.moreBoulders, plates: cells.morePlates, vines: cells.moreVines };
    if (Object.values(more).some(list => list.length)) level.challenge = more;
    return level;
  };

  const land = {
    id: 5,
    key: 'lake',
    name: 'Озёрный город',
    bg: 'assets/backdrop/land5/plate.webp',
    /* Живой фон: своя плита, рассвет справа светлее, чем у земли 4 (второй
       шаг рассвета), луны нет; облака общие с землёй 1.
       Размер — assets/backdrop/land5/backdrop.json (tools/pack_backdrop.py --land 5) */
    backdrop: {
      plate: 'assets/backdrop/land5/plate.webp',
      clouds: 'assets/backdrop/land1/clouds.webp',
      waterfall: false
    },
    /* Своего тайла мозаики нет: мозаика — та же плита фона */
    mosaic: 'assets/backdrop/land5/plate.webp',
    mechanic: 'relics',
    scenes: {
      intro: [
        'Озёрный город стоит на сваях посреди тёмной воды.',
        'Здесь Тзаркун спрятал реликвии — золотых идолов.',
        'Тяни идола вниз или собирай ряды под ним. Опусти всех на дно.'
      ],
      outro: [
        'Все идолы снова в храмах. Город зажёг огни на воде.',
        'Небо над озером розовеет. Рассвет всё ближе.',
        'Дальше лежат Болота. Там Тзаркун растит тёмный мох.'
      ]
    },
    levels: [
      lvl(1, 'Пристань', 120, [], [
        '........',
        '........',
        '..i..i..',
        '........',
        '........',
        '........',
        '........',
        '........']),
      lvl(2, 'Мостки', 125, [[1, 18]], [
        '........',
        '........',
        '.i......',
        '......i.',
        '........',
        '........',
        '........',
        '........']),
      lvl(3, 'Рыбачьи лодки', 135, [[3, 20]], [
        '........',
        '........',
        '..i..i..',
        '...^....',
        '........',
        '........',
        '........',
        '........']),
      lvl(4, 'Каналы', 145, [[0, 22]], [
        '........',
        '........',
        '.i....i.',
        '....i...',
        '........',
        '........',
        '........',
        '........']),
      lvl(5, 'Плавучий рынок', 150, [[5, 24]], [
        '........',
        '........',
        '..i..i..',
        '.^....i.',
        '........',
        '........',
        '........',
        '........']),
      lvl(6, 'Затопленная лестница', 170, [[2, 22]], [
        '........',
        '........',
        '..i..i..',
        '.1....1.',
        '........',
        '...11...',
        '........',
        '...**...']),
      lvl(7, 'Храм на сваях', 185, [[4, 24]], [
        '........',
        '.i..^.i.',
        '..2..2..',
        '........',
        '.1....1.',
        '........',
        '...22...',
        '........']),
      lvl(8, 'Тихая заводь', 120, [[1, 18]], [
        '........',
        '........',
        '........',
        '...ii...',
        '........',
        '........',
        '........',
        '........']),
      lvl(9, 'Заросший мост', 200, [[3, 24]], [
        '........',
        '........',
        '.i..i.i.',
        '..v..v..',
        '.v.vv.v.',
        '........',
        '........',
        '...~~...']),
      lvl(10, 'Ворота города', 215, [[0, 26]], [
        '........',
        '........',
        '..i..i..',
        '.^....i.',
        '.2....2.',
        '..v..v..',
        '........',
        '..~..~..']),
      lvl(11, 'Сад кувшинок', 230, [[5, 26]], [
        '........',
        '........',
        'i..ii..i',
        '.v....v.',
        '..v..v..',
        '........',
        '.v....v.',
        '........']),
      lvl(12, 'Золотой причал', 250, [[2, 28]], [
        '........',
        '..i..i..',
        '.i....i.',
        '........',
        'oo....oo',
        '.oo..oo.',
        '..oooo..',
        '...++...']),
      lvl(13, 'Башня маяка', 270, [[4, 28]], [
        '........',
        '.i.^..i.',
        '....i...',
        '..3..3..',
        '........',
        '.2....2.',
        '........',
        '..*..*..']),
      lvl(14, 'Лунная гавань', 125, [[1, 20]], [
        '........',
        '........',
        '........',
        '..i..i..',
        '........',
        '........',
        '........',
        '........']),
      lvl(15, 'Дворец старейшин', 290, [[3, 30]], [
        '........',
        'i..ii..i',
        '.oo..oo.',
        '..o22o..',
        '..o..o..',
        '.oo..oo.',
        '........',
        'o.o++o.o']),
      lvl(16, 'Висячие мосты', 320, [[0, 30]], [
        '........',
        '.i.ii.i.',
        '.v....v.',
        '.oo..oo.',
        '..o..o..',
        '.oo..oo.',
        '.v....v.',
        '..~..~..']),
      lvl(17, 'Сокровищница', 330, [[5, 32]], [
        '........',
        'i..^...i',
        '..i..i..',
        '.3....3.',
        '..2..2..',
        '........',
        '.2.22.2.',
        '..*..*..']),
      lvl(18, 'Храм воды', 350, [[2, 32]], [
        '........',
        'i.i..i.i',
        'oo....oo',
        'o.2..2.o',
        'o......o',
        'o.3..3.o',
        'oo....oo',
        '...++...']),
      lvl(19, 'Тёмное зеркало', 370, [[4, 34]], [
        '........',
        '.i.ii.i.',
        '........',
        '.2.vv.2.',
        '........',
        '.3....3.',
        '........',
        '..*~~*..']),
      lvl(20, 'Сердце озера', 380, [[1, 36]], [
        '........',
        'i.i..i.i',
        'oo.^^.oo',
        'o.3..3.o',
        'o......o',
        'o.2..2.o',
        'oo....oo',
        '..++++..'])
    ]
  };

  if (typeof window !== 'undefined') (window.CAMPAIGN_LANDS = window.CAMPAIGN_LANDS || []).push(land);
  if (typeof module !== 'undefined' && module.exports) module.exports = land;
})();
