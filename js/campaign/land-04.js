/* Земля 4 — Горная тропа. Механика: валуны (boulders).
 *
 * Раскладка уровня — 8 строк по 8 символов:
 *   1 2 3 валун такой прочности   * валун прочности 1 только на «Испытании»
 *   o плита   v лиана   # плита под лианой
 *   + плита только на «Испытании»   ~ лиана только на «Испытании»
 * stars — пороги по очкам бота (tools/level-bot.js).
 */
(function () {
  'use strict';

  /* Пороги звёзд [s2, s3]: node tools/level-bot.js --suggest --lands 4 --js */
  const STARS_BY_LEVEL = {};
  const PLACEHOLDER = { calm: [1000, 2000], normal: [1500, 3000], challenge: [1400, 2800] };

  const STARS = n => {
    const s = STARS_BY_LEVEL[n] || PLACEHOLDER;
    return { calm: s.calm.slice(), normal: s.normal.slice(), challenge: s.challenge.slice() };
  };

  /* Разбирает раскладку в списки клеток. */
  function parseLayout(rows) {
    const out = { boulders: [], plates: [], vines: [], moreBoulders: [], morePlates: [], moreVines: [] };
    rows.forEach((line, r) => {
      Array.from(line).forEach((ch, c) => {
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
    goals.push({ type: 'boulders' });
    if (cells.plates.length) goals.push({ type: 'plates' });
    if (cells.vines.length) goals.push({ type: 'vines' });
    const level = {
      id: '4-' + String(n).padStart(2, '0'),
      name,
      time,
      goals,
      boulders: cells.boulders,
      plates: cells.plates,
      vines: cells.vines,
      stars: STARS(n)
    };
    if (cells.moreBoulders.length || cells.morePlates.length || cells.moreVines.length) {
      level.challenge = { boulders: cells.moreBoulders, plates: cells.morePlates, vines: cells.moreVines };
    }
    return level;
  };

  const land = {
    id: 4,
    key: 'mountain',
    name: 'Горная тропа',
    /* Фон и мозаика временные (земля 3 и bg-sun), свои — в задаче 7 плана */
    bg: 'assets/backdrop/land3/plate.webp',
    backdrop: {
      plate: 'assets/backdrop/land3/plate.webp',
      waterfall: false
    },
    mosaic: 'assets/art/bg-sun.webp',
    mechanic: 'boulders',
    scenes: {
      intro: [
        'Горная тропа вьётся над пропастью. Тзаркун завалил её валунами.',
        'Сложи ряд рядом с валуном, и он треснет. Крепкий валун держит два или три удара.',
        'Разбей все валуны. За ними ждут осколки Камня.'
      ],
      outro: [
        'Тропа свободна. Последний валун скатился в пропасть.',
        'Над горами небо чуть посветлело. До рассвета ещё далеко, но он ближе.',
        'Внизу, у озера, ждёт Озёрный город. Там Тзаркун спрятал древние реликвии.'
      ]
    },
    levels: [
      lvl(1, 'Подножие', 120, [], [
        '........',
        '........',
        '........',
        '..1..1..',
        '........',
        '..1..1..',
        '........',
        '........']),
      lvl(2, 'Каменистая тропа', 120, [[0, 18]], [
        '........',
        '........',
        '.1....1.',
        '........',
        '...11...',
        '........',
        '.1....1.',
        '........']),
      lvl(3, 'Осыпь', 125, [[2, 20]], [
        '........',
        '..1..1..',
        '........',
        '.1.**.1.',
        '........',
        '..1..1..',
        '........',
        '........']),
      lvl(4, 'Узкий проход', 140, [[4, 22]], [
        '........',
        '.1.11.1.',
        '........',
        '........',
        '........',
        '........',
        '.1.11.1.',
        '........']),
      lvl(5, 'Перевал ветров', 145, [[1, 24]], [
        '........',
        '...11...',
        '..1..1..',
        '.1.**.1.',
        '.1....1.',
        '..1..1..',
        '........',
        '........']),
      lvl(6, 'Крепкий камень', 165, [[3, 24]], [
        '........',
        '.2....2.',
        '........',
        '..1111..',
        '........',
        '.2....2.',
        '........',
        '...**...']),
      lvl(7, 'Корни на скалах', 185, [[0, 24]], [
        '........',
        '..2..2..',
        '........',
        '.v.vv.v.',
        '........',
        '..2..2..',
        '........',
        '.1.~~.1.']),
      lvl(8, 'Привал', 120, [[2, 18]], [
        '........',
        '........',
        '..1..1..',
        '........',
        '........',
        '..1..1..',
        '........',
        '...11...']),
      lvl(9, 'Каменный мост', 200, [[4, 26]], [
        '........',
        '.2.vv.2.',
        '........',
        '2..vv..2',
        '........',
        '.2....2.',
        '........',
        '..*..*..']),
      lvl(10, 'Обвал', 220, [[1, 28]], [
        '1......1',
        '.2....2.',
        '..v11v..',
        '........',
        '........',
        '..v22v..',
        '.1....1.',
        '...**...']),
      lvl(11, 'Золотая жила', 240, [[3, 28]], [
        '........',
        '.oo22oo.',
        '.oo..oo.',
        '........',
        '........',
        '.oo..oo.',
        '.oo22oo.',
        '...++...']),
      lvl(12, 'Гранитные врата', 260, [[5, 30]], [
        '........',
        '..oooo..',
        '.2o33o2.',
        '..oooo..',
        '........',
        '.2....2.',
        '........',
        '..+**+..']),
      lvl(13, 'Орлиное гнездо', 280, [[0, 30]], [
        '........',
        '.3....3.',
        '..v..v..',
        '...22...',
        '...22...',
        '..v..v..',
        '.3....3.',
        '...~~...']),
      lvl(14, 'Тёплый уступ', 125, [[2, 20]], [
        '........',
        '...11...',
        '........',
        '.1....1.',
        '........',
        '...11...',
        '........',
        '........']),
      lvl(15, 'Ледяной склон', 290, [[4, 32]], [
        'oo....oo',
        'o.2..2.o',
        '..o33o..',
        '..o..o..',
        '..o..o..',
        '..o33o..',
        'o.2..2.o',
        'oo.**.oo']),
      lvl(16, 'Висячие сады', 300, [[1, 32]], [
        'o.o..o.o',
        '.2.vv.2.',
        'o.o..o.o',
        '..2oo2..',
        '..2oo2..',
        'o.o..o.o',
        '.2.vv.2.',
        'o.o~~o.o']),
      lvl(17, 'Стена великанов', 330, [[3, 34]], [
        '........',
        'oooooooo',
        '..v..v..',
        '3.3..3.3',
        '..v..v..',
        'oooooooo',
        '........',
        '..*..*..']),
      lvl(18, 'Тропа предков', 350, [[5, 34]], [
        'oo2..2oo',
        'o.v..v.o',
        '2..33..2',
        '..o..o..',
        '..o..o..',
        '2..33..2',
        'o.v..v.o',
        'oo2**2oo']),
      lvl(19, 'Седло горы', 370, [[0, 36]], [
        '3oo..oo3',
        'o.v..v.o',
        'o..22..o',
        '.2#..#2.',
        '.2#..#2.',
        'o..22..o',
        'o.v..v.o',
        '3oo**oo3']),
      lvl(20, 'Вершина', 380, [[2, 38]], [
        '2oooooo2',
        'o.3..3.o',
        'o.v..v.o',
        'o..33..o',
        'o..33..o',
        'o.v..v.o',
        'o.3..3.o',
        '2oo**oo2'])
    ]
  };

  if (typeof window !== 'undefined') (window.CAMPAIGN_LANDS = window.CAMPAIGN_LANDS || []).push(land);
  if (typeof module !== 'undefined' && module.exports) module.exports = land;
})();
