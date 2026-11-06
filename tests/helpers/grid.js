/* Помощник для тестов: собирает сетку поля из строк.
 *
 * gridFrom(rows, extras) -> grid[r][c]
 *   rows   — 8 строк по 8 символов: '0'..'5' — цвет камня, '.' — пусто;
 *   extras — карта { 'r,c': { special, lineDir, locked } } с доп. полями камня.
 */
'use strict';

const ROWS = 8;
const COLS = 8;

function gridFrom(rows, extras) {
  if (rows.length !== ROWS) throw new Error('Нужно ровно ' + ROWS + ' строк, получено ' + rows.length);
  const extra = extras || {};
  let id = 1;
  return rows.map((line, r) => {
    if (line.length !== COLS) throw new Error('Строка ' + r + ': нужно ' + COLS + ' символов');
    return Array.from(line, (ch, c) => {
      if (ch === '.') return null;
      const color = Number(ch);
      if (!Number.isInteger(color) || color < 0 || color > 5) {
        throw new Error('Строка ' + r + ', колонка ' + c + ': неизвестный символ «' + ch + '»');
      }
      return Object.assign(
        { id: id++, color, special: null, lineDir: null, r, c, el: null },
        extra[r + ',' + c]
      );
    });
  });
}

module.exports = { gridFrom, ROWS, COLS };
