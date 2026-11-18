/* Хранитель Солнца — ядро поля: поиск совпадений и ходов.
 *
 * Модуль чистый: не знает про DOM и про глобальное состояние игры, всё
 * берёт из переданной сетки grid[r][c] (8×8, строка 0 — верх, пусто = null).
 * Подключается как <script src="js/core/board.js"></script> перед js/game.js,
 * а также требуется из Node (тесты, бот).
 *
 * Камень: { id, color, special, lineDir, locked, r, c, el }. Поле el ядро не
 * трогает. locked — камень «в лианах»: не двигается (ни обменом, ни падением),
 * а совпадение или взрыв рядом лишь срывает лиану, камень остаётся на месте.
 * relic — идол (земля 5): падает и меняется местами, как камень, но не
 * совпадает, не убирается ударами и снимается с поля на нижней строке.
 * Узнаётся только по флагу: запасной путь shuffle временно даёт камням
 * отрицательные цвета.
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
  const DEFAULT_COLORS = 6;
  let fallbackId = 0;

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
        if (!gem || gem.relic) { c++; continue; }
        let end = c;
        while (end + 1 < COLS) {
          const next = grid[r][end + 1];
          if (!next || next.relic || next.color !== gem.color) break;
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
        if (!gem || gem.relic) { r++; continue; }
        let end = r;
        while (end + 1 < ROWS) {
          const next = grid[end + 1][c];
          if (!next || next.relic || next.color !== gem.color) break;
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
      !a || !b || !c || !d || a.special || b.special || c.special || d.special || a.relic ||
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

  /* Можно ли менять камни местами: оба на месте и ни один не в лианах.
     (Соседство клеток проверяет вызывающий.) */
  function canSwap(grid, a, b) {
    const ga = a && gemAt(grid, a.r, a.c);
    const gb = b && gemAt(grid, b.r, b.c);
    if (!ga || !gb) return false;
    return !ga.locked && !gb.locked;
  }

  /* Первый ход-обмен соседних камней, после которого есть совпадение.
     Камни меняются местами на время проверки и возвращаются назад.
     Камни в лианах не двигаются, ходы с ними не предлагаются. */
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
          if (!a || !b || a.locked || b.locked) continue;
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

  /* ---------- Раскрытие спецкамней ----------
     baseKeys — клетки совпадения ('r,c'). Спецкамни среди них (и среди
     вновь задетых) срабатывают цепочкой. protectedKeys — клетки, где
     только что созданы новые спецкамни: они не очищаются.
     Возвращает { clear, triggers, unlocks, voids }. unlocks — клетки камней в
     лианах, которые задело совпадением или взрывом: лиана срывается, а
     камень остаётся на месте (его нет в clear). Камень в лианах сам не
     срабатывает, даже если он спецкамень. voids — клетки без камня (валуны),
     которые накрыл удар: в clear их нет, чтобы clear.size считал только
     убранные камни (на нём держатся очки игры и бота). */
  function expandSpecials(grid, baseKeys, protectedKeys) {
    const clear = new Set(baseKeys);
    const unlocks = new Set();
    const triggers = [];
    const queue = [];
    baseKeys.forEach(k => {
      const p = parseKey(k);
      const gem = gemAt(grid, p.r, p.c);
      if (gem && gem.special && !gem.locked) queue.push({ r: p.r, c: p.c });
    });
    const seen = new Set();

    while (queue.length) {
      const { r, c } = queue.shift();
      const k = keyOf(r, c);
      if (seen.has(k)) continue;
      seen.add(k);
      const gem = gemAt(grid, r, c);
      if (!gem || !gem.special || gem.locked) continue;
      triggers.push({ r, c, type: gem.special, color: gem.color, lineDir: gem.lineDir });

      const extra = [];
      if (gem.special === 'line') {
        if (gem.lineDir === 'col') {
          for (let rr = 0; rr < ROWS; rr++) extra.push({ r: rr, c });
        } else {
          for (let cc = 0; cc < COLS; cc++) extra.push({ r, c: cc });
        }
      } else if (gem.special === 'sun') {
        for (let rr = 0; rr < ROWS; rr++) {
          for (let cc = 0; cc < COLS; cc++) {
            const other = gemAt(grid, rr, cc);
            if (other && other.color === gem.color) extra.push({ r: rr, c: cc });
          }
        }
      } else if (gem.special === 'bomb') {
        // Область 3×3 вокруг камня; на краю поля — сколько помещается
        for (let rr = Math.max(0, r - 1); rr <= Math.min(ROWS - 1, r + 1); rr++) {
          for (let cc = Math.max(0, c - 1); cc <= Math.min(COLS - 1, c + 1); cc++) {
            extra.push({ r: rr, c: cc });
          }
        }
      } else if (gem.special === 'totem') {
        // Крест: весь свой ряд и весь свой столбец
        for (let cc = 0; cc < COLS; cc++) extra.push({ r, c: cc });
        for (let rr = 0; rr < ROWS; rr++) extra.push({ r: rr, c });
      }

      extra.forEach(pos => {
        const kk = keyOf(pos.r, pos.c);
        clear.add(kk);
        const other = gemAt(grid, pos.r, pos.c);
        if (other && other.special && !seen.has(kk)) queue.push(pos);
      });
    }

    protectedKeys.forEach(k => {
      if (clear.has(k)) clear.delete(k);
    });
    // Камень в лианах не удаляется: из clear он переходит в unlocks.
    // Идола удар не берёт: его клетка просто уходит из clear.
    const voids = new Set();
    Array.from(clear).forEach(k => {
      const p = parseKey(k);
      const gem = gemAt(grid, p.r, p.c);
      if (!gem) {
        clear.delete(k);
        voids.add(k);
      } else if (gem.relic) {
        clear.delete(k);
      } else if (gem.locked) {
        clear.delete(k);
        unlocks.add(k);
      }
    });
    return { clear, triggers, unlocks, voids };
  }

  /* ---------- План одного каскада ----------
     Ничего не меняет в сетке. Возвращает null, если совпадений нет, иначе
     { matched, creates, clear, triggers, unlocks, voids }.

     Приоритет создания спецкамней (важно):
       1. уголок/T — «Тотем» (важнее линии и солнца);
       2. линия из 5 — «Солнце» (важнее квадрата и линии);
       3. квадрат 2×2 — «Камень-взрыв» (важнее линии);
       4. линия из 4 — «Камень-молния».
     На один блок (совокупность пересекающихся клеток) создаётся ровно
     один спецкамень: клетки блока, который уже дал спецкамень, попадают
     в usedCells, и более низкий приоритет этот блок не трогает.
     Позиция: сначала swapCell, если он в паттерне; иначе центр
     квадрата / угловая клетка уголка (стык у T) / середина линии.
     Клетка не должна быть спецкамнем или уже занятой другим созданием. */
  function planCascade(grid, swapCell) {
    const patterns = analyzePatterns(grid);
    const groups = patterns.groups;
    if (!groups.length && !patterns.squares.length && !patterns.corners.length) return null;

    const matched = new Set();
    groups.forEach(group => group.cells.forEach(cell => matched.add(keyOf(cell.r, cell.c))));
    patterns.squares.forEach(sq => sq.cells.forEach(cell => matched.add(keyOf(cell.r, cell.c))));
    patterns.corners.forEach(cn => cn.cells.forEach(cell => matched.add(keyOf(cell.r, cell.c))));

    const creates = [];
    const reserved = new Set();
    const usedCells = new Set();
    const markUsed = cells => cells.forEach(cell => usedCells.add(keyOf(cell.r, cell.c)));

    const pickCreate = (cells, fallback) => {
      const usable = cells.filter(cell => {
        const g = gemAt(grid, cell.r, cell.c);
        return g && !g.special && !g.locked && !reserved.has(keyOf(cell.r, cell.c));
      });
      if (!usable.length) return null;
      const swapped = usable.find(cell =>
        swapCell && cell.r === swapCell.r && cell.c === swapCell.c);
      if (swapped) return swapped;
      const fb = fallback && usable.find(cell => cell.r === fallback.r && cell.c === fallback.c);
      return fb || usable[0];
    };

    const addCreate = (cells, type, dir, fallback) => {
      const pos = pickCreate(cells, fallback);
      if (!pos) return false;
      reserved.add(keyOf(pos.r, pos.c));
      creates.push({ r: pos.r, c: pos.c, type, dir });
      return true;
    };

    // 1. Уголок/T → тотем. Уголок из 5 имеет ровно одну угловую клетку
    //    (соседа по обеим линиям); у T угловых нет — берём стык.
    patterns.corners.forEach(corner => {
      if (corner.cells.some(cell => usedCells.has(keyOf(cell.r, cell.c)))) return;
      const cells = corner.cells;
      const cornerCell = cells.find(cell =>
        cells.some(o => o.r === cell.r && Math.abs(o.c - cell.c) === 1) &&
        cells.some(o => o.c === cell.c && Math.abs(o.r - cell.r) === 1));
      if (addCreate(cells, 'totem', null, cornerCell || corner.joint)) {
        markUsed(cells);
      }
    });

    // 2. Линия из 5 (и длиннее) → солнце
    const sunGroups = groups.filter(g => g.len >= 5).sort((a, b) => b.len - a.len);
    sunGroups.forEach(group => {
      if (addCreate(group.cells, 'sun', null, group.cells[Math.floor(group.cells.length / 2)])) {
        markUsed(group.cells);
      }
    });

    // 3. Квадрат 2×2 → бомба. Если квадрат — часть блока, который уже
    //    дал солнце/тотем, второй спецкамень не создаём.
    patterns.squares.forEach(square => {
      if (square.cells.some(cell => usedCells.has(keyOf(cell.r, cell.c)))) return;
      if (addCreate(square.cells, 'bomb', null, square.center)) {
        markUsed(square.cells);
      }
    });

    // 4. Линия из 4 → молния, если её блок ещё не занят спецкамнем
    groups
      .filter(group => group.len === 4)
      .forEach(group => {
        if (group.cells.some(cell => usedCells.has(keyOf(cell.r, cell.c)))) return;
        const dir = group.dir === 'h' ? 'row' : 'col';
        if (addCreate(group.cells, 'line', dir, group.cells[Math.floor(group.cells.length / 2)])) {
          markUsed(group.cells);
        }
      });

    const protectedKeys = new Set(creates.map(cr => keyOf(cr.r, cr.c)));
    const { clear, triggers, unlocks, voids } = expandSpecials(grid, matched, protectedKeys);
    if (clear.size === 0 && unlocks.size === 0) return null;

    return { matched, creates, clear, triggers, unlocks, voids };
  }

  /* Применяет план к сетке: убирает clear, делает из creates спецкамни,
     срывает лианы с камней из unlocks (они остаются на месте).
     Возвращает { removed, unlocked }: убранные камни (их el игра убирает
     сама) и камни, с которых сорвана лиана. */
  function applyCascade(grid, plan) {
    const removed = [];
    const unlocked = [];
    plan.clear.forEach(k => {
      const p = parseKey(k);
      const gem = gemAt(grid, p.r, p.c);
      if (!gem) return;
      removed.push(gem);
      grid[p.r][p.c] = null;
    });
    plan.creates.forEach(cr => {
      const gem = gemAt(grid, cr.r, cr.c);
      if (!gem) return;
      gem.special = cr.type;
      gem.lineDir = cr.type === 'line' ? cr.dir : null;
    });
    (plan.unlocks || []).forEach(k => {
      const p = parseKey(k);
      const gem = gemAt(grid, p.r, p.c);
      if (!gem || !gem.locked) return;
      gem.locked = false;
      unlocked.push(gem);
    });
    return { removed, unlocked };
  }

  /* ---------- Золотые плиты ----------
     Слой клеток отдельно от камней: камни падают и меняются местами, а плита
     лежит на своей клетке. plates[r][c] — сколько слоёв осталось (0 — пусто). */
  function makePlates(list) {
    const plates = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    (list || []).forEach(v => { plates[v[0]][v[1]] = 1; });
    return plates;
  }

  function platesLeft(plates) {
    let n = 0;
    plates.forEach(row => row.forEach(v => { n += v; }));
    return n;
  }

  /* Снимает по слою с плит, которых коснулся шаг каскада plan: это убранные
     камни, рождающиеся спецкамни (ряд над плитой собран, хотя камень остался)
     и камни с сорванной лианой. Меняет plates, возвращает снятые { r, c, left }. */
  function hitPlates(plates, plan) {
    if (!plates) return [];
    const cells = new Set(plan.clear);
    (plan.unlocks || []).forEach(k => cells.add(k));
    (plan.creates || []).forEach(cr => cells.add(keyOf(cr.r, cr.c)));
    const hits = [];
    cells.forEach(k => {
      const { r, c } = parseKey(k);
      if (plates[r][c] > 0) {
        plates[r][c]--;
        hits.push({ r, c, left: plates[r][c] });
      }
    });
    return hits;
  }

  /* ---------- Валуны ----------
     Слой клеток, как плиты, но клетка валуна в сетке пустая (null): камня
     там нет, двигать и менять нечего. boulders[r][c] — прочность (0 — пусто).
     list — [[r, c, hp], …], без hp прочность 1. */
  function makeBoulders(list) {
    const boulders = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    (list || []).forEach(v => { boulders[v[0]][v[1]] = v[2] || 1; });
    return boulders;
  }

  function bouldersLeft(boulders) {
    let n = 0;
    boulders.forEach(row => row.forEach(v => { if (v > 0) n++; }));
    return n;
  }

  /* Шаг каскада plan трескает валун, если удар спецкамня накрыл его клетку
     (plan.voids) или соседняя по стороне клетка — камень из clear, unlocks
     или creates. За шаг не больше одного удара на валун. Меняет boulders,
     возвращает задетые { r, c, left }. */
  function hitBoulders(boulders, plan) {
    if (!boulders) return [];
    const hit = new Set();
    const mark = (r, c) => {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && boulders[r][c] > 0) hit.add(keyOf(r, c));
    };
    (plan.voids || []).forEach(k => { const p = parseKey(k); mark(p.r, p.c); });
    const sources = new Set(plan.clear);
    (plan.unlocks || []).forEach(k => sources.add(k));
    (plan.creates || []).forEach(cr => sources.add(keyOf(cr.r, cr.c)));
    sources.forEach(k => {
      const { r, c } = parseKey(k);
      mark(r - 1, c); mark(r + 1, c); mark(r, c - 1); mark(r, c + 1);
    });
    const hits = [];
    hit.forEach(k => {
      const { r, c } = parseKey(k);
      boulders[r][c]--;
      hits.push({ r, c, left: boulders[r][c] });
    });
    return hits;
  }

  /* ---------- Идолы ----------
     Идол — особый камень сетки без цвета (см. шапку). Засчитывается, когда
     опустится на нижнюю строку. */
  function makeRelic(id, r, c) {
    return { id, relic: true, color: -1, special: null, lineDir: null, locked: false, r, c, el: null };
  }

  function relicsLeft(grid) {
    let n = 0;
    grid.forEach(row => row.forEach(g => { if (g && g.relic) n++; }));
    return n;
  }

  /* Снимает идолов с нижней строки (клетка -> null), возвращает их. */
  function collectRelics(grid) {
    const got = [];
    for (let c = 0; c < COLS; c++) {
      const gem = grid[ROWS - 1][c];
      if (gem && gem.relic) {
        got.push(gem);
        grid[ROWS - 1][c] = null;
      }
    }
    return got;
  }

  /* Обрушение до покоя: пока внизу оказываются идолы, снять их и обрушить
     снова (два идола друг над другом снимаются оба). Игра делает тот же
     цикл сама (js/game.js dropGems), чтобы показать каждый сбор. */
  function settle(grid, spawn, blocked) {
    const moves = [];
    const spawned = [];
    const relics = [];
    for (let guard = 0; guard <= ROWS; guard++) {
      const step = collapse(grid, spawn, blocked);
      moves.push(...step.moves);
      spawned.push(...step.spawned);
      const got = collectRelics(grid);
      if (!got.length) break;
      relics.push(...got);
    }
    return { moves, spawned, relics };
  }

  /* ---------- Обрушение ----------
     Камни в каждом столбце падают вниз, сверху досыпаются новые через
     spawn(r, c) -> gem (ядро DOM не создаёт). Меняет grid и r/c камней.
     moves — упавшие камни, spawned — новые (по столбцам, снизу вверх).
     Камни в лианах неподвижны; остальные «проходят сквозь» них: свободные
     клетки столбца (без закреплённых) заполняются снизу вверх подряд,
     минуя закреплённые камни. blocked(r, c) (необязательно) — клетки
     валунов: они не свободны, камни так же проходят сквозь них. */
  function collapse(grid, spawn, blocked) {
    const moves = [];
    const spawned = [];
    for (let c = 0; c < COLS; c++) {
      // Свободные клетки снизу вверх; закреплённые камни не в счёт.
      const free = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        const gem = grid[r][c];
        if (blocked && blocked(r, c)) continue;
        if (!gem || !gem.locked) free.push(r);
      }
      let k = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        const gem = grid[r][c];
        if (!gem || gem.locked) continue;
        const write = free[k++];
        if (r !== write) {
          grid[write][c] = gem;
          grid[r][c] = null;
          gem.r = write;
          gem.c = c;
          moves.push({ gem, fromR: r, toR: write });
        }
      }
      for (; k < free.length; k++) {
        const r = free[k];
        const gem = spawn(r, c);
        gem.r = r;
        gem.c = c;
        grid[r][c] = gem;
        spawned.push(gem);
      }
    }
    return { moves, spawned };
  }

  /* ---------- Новое поле ----------
     Без начальных совпадений (серии и квадраты 2×2) и с ходом, до 50
     попыток. level.colors — число цветов (по умолчанию 6); rng() в [0,1);
     nextId() выдаёт свежие id камней. level.vines — [[r, c], …]: эти камни
     в лианах (locked); в совпадениях и ходах они участвуют как обычные.
     level.boulders — [[r, c, hp], …]: эти клетки остаются пустыми (null).
     level.relics — [[r, c], …]: здесь стоят идолы. */
  function generateGrid(level, rng, nextId) {
    const colors = (level && level.colors) || DEFAULT_COLORS;
    const random = rng || Math.random;
    const newId = nextId || (() => ++fallbackId);
    const vineKeys = new Set(((level && level.vines) || []).map(v => keyOf(v[0], v[1])));
    const boulderKeys = new Set(((level && level.boulders) || []).map(v => keyOf(v[0], v[1])));
    const relicKeys = new Set(((level && level.relics) || []).map(v => keyOf(v[0], v[1])));
    let grid;
    let attempts = 0;
    do {
      grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (boulderKeys.has(keyOf(r, c))) continue;
          if (relicKeys.has(keyOf(r, c))) {
            grid[r][c] = makeRelic(newId(), r, c);
            continue;
          }
          const banned = new Set();
          if (c >= 2) {
            const a = grid[r][c - 1];
            const b = grid[r][c - 2];
            if (a && b && a.color === b.color) banned.add(a.color);
          }
          if (r >= 2) {
            const a = grid[r - 1][c];
            const b = grid[r - 2][c];
            if (a && b && a.color === b.color) banned.add(a.color);
          }
          // Квадрат 2×2 — тоже совпадение: три уже поставленных камня угла
          // запрещают четвёртый того же цвета.
          if (r >= 1 && c >= 1) {
            const a = grid[r - 1][c - 1];
            const b = grid[r - 1][c];
            const d = grid[r][c - 1];
            if (a && b && d && a.color === b.color && a.color === d.color) banned.add(a.color);
          }
          const options = [];
          for (let color = 0; color < colors; color++) {
            if (!banned.has(color)) options.push(color);
          }
          // При очень малом числе цветов запретить может всё — берём любой.
          const pool = options.length ? options : Array.from({ length: colors }, (_, i) => i);
          const color = pool[Math.floor(random() * pool.length)];
          grid[r][c] = {
            id: newId(), color, special: null, lineDir: null,
            locked: vineKeys.has(keyOf(r, c)), r, c, el: null
          };
        }
      }
      attempts++;
    } while (!hasMove(grid) && attempts < 50);
    return grid;
  }

  /* ---------- Перемешивание ----------
     Перемешивает на месте только камни не в лианах: меняются клетки камней
     (спецкамни остаются при своих камнях, лианы стоят где стояли). Доска
     после перемешивания без совпадений и с ходом. До 100 попыток; если не
     вышло — незакреплённым камням заново подбираются цвета.
     opts.colors — сколько цветов в игре (для запасного пути; по умолчанию
     наибольший цвет на доске + 1, не меньше 3). Возвращает ту же grid. */
  function shuffle(grid, rng, opts) {
    const random = rng || Math.random;
    const cells = [];
    const gems = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const gem = grid[r][c];
        if (gem && !gem.locked && !gem.relic) {
          cells.push({ r, c });
          gems.push(gem);
        }
      }
    }
    if (gems.length < 2) return grid;

    const place = order => {
      cells.forEach((pos, i) => {
        const gem = order[i];
        grid[pos.r][pos.c] = gem;
        gem.r = pos.r;
        gem.c = pos.c;
      });
    };
    const good = () => !hasAnyMatch(grid) && hasMove(grid);

    for (let attempt = 0; attempt < 100; attempt++) {
      const order = gems.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const t = order[i];
        order[i] = order[j];
        order[j] = t;
      }
      place(order);
      if (good()) return grid;
    }

    // Запасной путь: те же камни на своих местах, но цвета подбираются заново.
    let colors = (opts && opts.colors) || 0;
    if (!colors) {
      grid.forEach(row => row.forEach(g => { if (g && g.color + 1 > colors) colors = g.color + 1; }));
      colors = Math.max(colors, 3);
    }
    place(gems);
    for (let attempt = 0; attempt < 100; attempt++) {
      // Нерассчитанным камням — уникальные «пустые» цвета: они не совпадают
      // ни друг с другом, ни с настоящими, поэтому проверка идёт честно.
      cells.forEach((pos, i) => { grid[pos.r][pos.c].color = -1 - i; });
      cells.forEach(pos => {
        const gem = grid[pos.r][pos.c];
        const options = [];
        for (let color = 0; color < colors; color++) {
          gem.color = color;
          if (!hasAnyMatch(grid)) options.push(color);
        }
        const pool = options.length ? options : Array.from({ length: colors }, (_, i) => i);
        gem.color = pool[Math.floor(random() * pool.length)];
      });
      if (good()) break;
    }
    return grid;
  }

  /* ---------- Полный ход (для бота) ----------
     Обмен a<->b, затем все каскады и обрушение до успокоения. Меняет grid.
     null, если обмен недопустим (не соседи, пустая клетка или нет
     совпадения) — сетка при этом остаётся как была.
     opts.colors — число цветов для досыпки (по умолчанию 6); opts.boulders —
     слой валунов (меняется), задетые валуны — в boulderHits. Снятые со дна
     идолы — в relics (в removed их нет). */
  function simulateMove(grid, a, b, rng, nextId, opts) {
    if (!a || !b) return null;
    if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return null;
    const ga = gemAt(grid, a.r, a.c);
    const gb = gemAt(grid, b.r, b.c);
    if (!ga || !gb || !canSwap(grid, a, b)) return null;

    const colors = (opts && opts.colors) || DEFAULT_COLORS;
    const random = rng || Math.random;
    const newId = nextId || (() => ++fallbackId);

    const swap = () => {
      grid[a.r][a.c] = gb;
      grid[b.r][b.c] = ga;
      ga.r = b.r; ga.c = b.c;
      gb.r = a.r; gb.c = a.c;
    };
    swap();
    if (!hasAnyMatch(grid)) {
      grid[a.r][a.c] = ga;
      grid[b.r][b.c] = gb;
      ga.r = a.r; ga.c = a.c;
      gb.r = b.r; gb.c = b.c;
      return null;
    }

    const swapCell = { r: b.r, c: b.c };
    const spawn = (r, c) => ({
      id: newId(),
      color: Math.floor(random() * colors),
      special: null,
      lineDir: null,
      locked: false,
      r,
      c,
      el: null
    });
    const boulders = opts && opts.boulders;
    const blocked = boulders ? (r, c) => boulders[r][c] > 0 : null;
    const cascades = [];
    const removed = [];
    const boulderHits = [];
    const relics = [];
    for (let guard = 0; guard < 200; guard++) {
      const plan = planCascade(grid, swapCell);
      if (!plan) break;
      cascades.push(plan);
      removed.push(...applyCascade(grid, plan).removed);
      if (boulders) boulderHits.push(...hitBoulders(boulders, plan));
      relics.push(...settle(grid, spawn, blocked).relics);
    }
    return { cascades, removed, boulderHits, relics };
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
    canSwap,
    findMove,
    hasMove,
    expandSpecials,
    planCascade,
    applyCascade,
    makePlates,
    platesLeft,
    hitPlates,
    makeBoulders,
    bouldersLeft,
    hitBoulders,
    makeRelic,
    relicsLeft,
    collectRelics,
    settle,
    collapse,
    generateGrid,
    shuffle,
    simulateMove
  };
});
