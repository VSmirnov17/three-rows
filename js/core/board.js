/* Сокровища Солнца — ядро поля: поиск совпадений и ходов.
 *
 * Модуль чистый: не знает про DOM и про глобальное состояние игры, всё
 * берёт из переданной сетки grid[r][c] (8×8, строка 0 — верх, пусто = null).
 * Подключается как <script src="js/core/board.js"></script> перед js/game.js,
 * а также требуется из Node (тесты, бот).
 *
 * Камень: { id, color, special, lineDir, r, c, el }. Поле el ядро не трогает.
 */
(function (factory) {
  'use strict';

  const BoardCore = factory();

  if (typeof window !== 'undefined') window.BoardCore = BoardCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = BoardCore;
})(function () {
  'use strict';

  const ROWS = 8;
  const COLS = 8;

  const keyOf = (r, c) => r + ',' + c;

  function parseKey(k) {
    const [r, c] = k.split(',').map(Number);
    return { r, c };
  }

  function gemAt(grid, r, c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return grid[r][c];
  }

  /* Горизонтальные и вертикальные серии длиной >= 3 */
  function findLineGroups(grid) {
    const groups = [];
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const gem = grid[r][c];
        if (!gem) { c++; continue; }
        let end = c;
        while (end + 1 < COLS) {
          const next = grid[r][end + 1];
          if (!next || next.color !== gem.color) break;
          end++;
        }
        const len = end - c + 1;
        if (len >= 3) {
          const cells = [];
          for (let x = c; x <= end; x++) cells.push({ r, c: x });
          groups.push({ dir: 'h', len, cells });
        }
        c = end + 1;
      }
    }
    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const gem = grid[r][c];
        if (!gem) { r++; continue; }
        let end = r;
        while (end + 1 < ROWS) {
          const next = grid[end + 1][c];
          if (!next || next.color !== gem.color) break;
          end++;
        }
        const len = end - r + 1;
        if (len >= 3) {
          const cells = [];
          for (let y = r; y <= end; y++) cells.push({ r: y, c });
          groups.push({ dir: 'v', len, cells });
        }
        r = end + 1;
      }
    }
    return groups;
  }

  /* ---------- Квадрат 2×2 ----------
     Один блок может быть найден до четырёх раз (с любого угла), поэтому
     его клетки помечаем в seen. Если из области 2×3 собираются два
     квадрата, берётся только первый — на блок создаётся РОВНО
     один камень-взрыв, без дублей. Квадрат, который является частью
     длинной линии, тоже считается: для квадрата нужны две строки. */
  function squaresTouch(a, b) {
    return a.cells.some(c1 => b.cells.some(c2 =>
      Math.abs(c1.r - c2.r) + Math.abs(c1.c - c2.c) === 1));
  }

  function findSquares(grid) {
    const seen = new Set();
    const raw = [];
    const bad = (a, b, c, d) =>
      !a || !b || !c || !d || a.special || b.special || c.special || d.special ||
      a.color !== b.color || a.color !== c.color || a.color !== d.color;
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        if (seen.has(keyOf(r, c))) continue;
        const a = grid[r][c];
        const b = grid[r][c + 1];
        const cc = grid[r + 1][c];
        const d = grid[r + 1][c + 1];
        if (bad(a, b, cc, d)) continue;
        seen.add(keyOf(r, c));
        seen.add(keyOf(r, c + 1));
        seen.add(keyOf(r + 1, c));
        seen.add(keyOf(r + 1, c + 1));
        raw.push({
          type: 'square',
          color: a.color,
          cells: [{ r, c }, { r, c: c + 1 }, { r: r + 1, c }, { r: r + 1, c: c + 1 }],
          center: { r, c }
        });
      }
    }

    // Склеиваем соприкасающиеся квадраты в один блок: из прямоугольника
    // 2×4 можно собрать два квадрата, но спецкамень на блок всё равно один.
    const blocks = [];
    raw.forEach(sq => {
      const hit = blocks.filter(block => squaresTouch(block, sq));
      if (!hit.length) {
        blocks.push(sq);
        return;
      }
      const main = hit[0];
      sq.cells.forEach(cell => {
        if (!main.cells.some(t => t.r === cell.r && t.c === cell.c)) main.cells.push(cell);
      });
      for (let i = 1; i < hit.length; i++) {
        hit[i].cells.forEach(cell => {
          if (!main.cells.some(t => t.r === cell.r && t.c === cell.c)) main.cells.push(cell);
        });
        blocks.splice(blocks.indexOf(hit[i]), 1);
      }
    });
    return blocks;
  }

  /* ---------- Уголок и T ----------
     Пересечение горизонтальной и вертикальной серий одного цвета.
     Уголок из 5 (3 + 3 с общей клеткой) даёт объединение ровно из 5
     клеток; T из 5 и небольшие T подходят при объединении <= 6.
     Уголок внутри одной длинной линии (>= 7) не считаем: там главнее
     линия/солнце. */
  function findCorners(grid, groups) {
    const hs = groups.filter(g => g.dir === 'h');
    const vs = groups.filter(g => g.dir === 'v');
    const found = [];
    const joints = new Set();
    for (const h of hs) {
      for (const v of vs) {
        const hGem = gemAt(grid, h.cells[0].r, h.cells[0].c);
        const vGem = gemAt(grid, v.cells[0].r, v.cells[0].c);
        if (!hGem || !vGem || hGem.color !== vGem.color) continue;
        const joint = h.cells.find(cell =>
          cell.c === v.cells[0].c && v.cells.some(vc => vc.r === cell.r));
        if (!joint) continue;
        const union = new Map();
        h.cells.forEach(cell => union.set(keyOf(cell.r, cell.c), cell));
        v.cells.forEach(cell => union.set(keyOf(cell.r, cell.c), cell));
        if (union.size < 5 || union.size > 6) continue;
        if ((h.len >= 7 && v.len <= 3) || (v.len >= 7 && h.len <= 3)) continue;
        const gem = gemAt(grid, joint.r, joint.c);
        if (!gem || gem.special) continue;
        const jk = keyOf(joint.r, joint.c);
        if (joints.has(jk)) continue;
        joints.add(jk);
        found.push({
          type: 'corner',
          color: gem.color,
          cells: Array.from(union.values()),
          joint: { r: joint.r, c: joint.c }
        });
      }
    }
    return found;
  }

  /* ---------- Общий разбор совпадений ----------
     groups — обычные серии, squares/corners — новые паттерны.
     Приоритет при создании спецкамней описан в resolveBoard (game.js). */
  function analyzePatterns(grid) {
    const groups = findLineGroups(grid);
    return { groups, squares: findSquares(grid), corners: findCorners(grid, groups) };
  }

  /* Любое совпадение, включая квадрат и уголок (для findMove) */
  function hasAnyMatch(grid) {
    const groups = findLineGroups(grid);
    if (groups.length) return true;
    if (findSquares(grid).length) return true;
    return findCorners(grid, groups).length > 0;
  }

  /* Первый ход-обмен соседних камней, после которого есть совпадение.
     Камни меняются местами на время проверки и возвращаются назад. */
  function findMove(grid) {
    const dirs = [[0, 1], [1, 0]];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        for (const [dr, dc] of dirs) {
          const r2 = r + dr;
          const c2 = c + dc;
          if (r2 >= ROWS || c2 >= COLS) continue;
          const a = grid[r][c];
          const b = grid[r2][c2];
          if (!a || !b) continue;
          grid[r][c] = b;
          grid[r2][c2] = a;
          const found = hasAnyMatch(grid);
          grid[r][c] = a;
          grid[r2][c2] = b;
          if (found) return { a: { r, c }, b: { r: r2, c: c2 } };
        }
      }
    }
    return null;
  }

  function hasMove(grid) {
    return findMove(grid) !== null;
  }

  return {
    ROWS,
    COLS,
    keyOf,
    parseKey,
    gemAt,
    findLineGroups,
    findSquares,
    findCorners,
    analyzePatterns,
    hasAnyMatch,
    findMove,
    hasMove
  };
});
