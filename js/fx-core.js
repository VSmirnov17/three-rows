/* Хранитель Солнца — эффекты поля: чистая логика без DOM (работает в Node).
 *
 * TIMING        — длительности и шаги задержек, мс.
 * budget        — сколько частиц и какой силы луч по режиму (calm/reduced/low).
 * shardsFor     — на сколько осколков делить камень при данном числе клеток;
 *                 reserved — узлы, уже занятые ударами в этом шаге.
 * shardPolygons — раскрой квадрата клетки на осколки (в процентах 0..100).
 * shardFlight   — куда и как далеко летит осколок.
 * strikeTargets — клетки удара спецкамня и задержка каждой.
 * mergeDelays   — наименьшая задержка клетки среди всех ударов.
 * Время и случайность приходят параметрами: ни Date.now(), ни Math.random() внутри нет.
 */
(function (factory) {
  'use strict';

  const FxCore = factory();

  if (typeof window !== 'undefined') window.FxCore = FxCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = FxCore;
})(function () {
  'use strict';

  const TIMING = Object.freeze({
    shatterMs: 560,
    strikeMs: Object.freeze({ line: 700, sun: 900, bomb: 800, totem: 850 }),
    sunStepMs: 35,
    sunMaxDelayMs: 260,
    waveStepMs: 30,
    lineStepMs: 18,
    waveMaxDelayMs: 240,
    cleanupMs: 1100
  });

  const FULL = { shards: 6, dust: 10, glints: 2, embers: 18, beamAlpha: 1 };
  const CALM_FACTOR = 0.6;
  const CALM_BEAM = 0.6;
  const LOW_SHARDS = 3;
  const SHARDS_PER_STEP = 110;
  const NODES_PER_STEP = 120;
  const MID = 50;           // центр квадрата клетки, %

  /* Бюджет частиц. mode: { calm, reduced, low }.
   * reduced — всё по нулям; calm — пыль, блики и угли ×0,6 вниз, луч слабее,
   * а осколки полные: это сам рисунок камня, он не яркий;
   * low — не больше 3 осколков, без пыли, бликов и углей. */
  function budget(mode) {
    const m = mode || {};
    if (m.reduced) return { shards: 0, dust: 0, glints: 0, embers: 0, beamAlpha: 0 };
    const b = { ...FULL };
    if (m.calm) {
      b.dust = Math.floor(b.dust * CALM_FACTOR);
      b.glints = Math.floor(b.glints * CALM_FACTOR);
      b.embers = Math.floor(b.embers * CALM_FACTOR);
      b.beamAlpha = CALM_BEAM;
    }
    if (m.low) {
      b.shards = Math.min(b.shards, LOW_SHARDS);
      b.dust = 0;
      b.glints = 0;
      b.embers = 0;
    }
    return b;
  }

  /* Осколков на камень: чем больше клеток гаснет разом, тем меньше на каждую —
   * всего за шаг не больше SHARDS_PER_STEP (узлов в #fx не больше 120, узлы
   * ударов reserved вычитаются); не меньше 1 и не больше бюджета. cellCount ≥ 1. */
  function shardsFor(cellCount, mode, reserved) {
    const m = mode || {};
    if (m.reduced) return 0;
    const room = Math.min(SHARDS_PER_STEP, NODES_PER_STEP - (reserved || 0));
    return Math.max(1, Math.min(budget(m).shards, Math.floor(room / cellCount)));
  }

  /* Площадь и центр тяжести многоугольника (шнурование). */
  function centroid(poly) {
    let a = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const cr = x1 * y2 - x2 * y1;
      a += cr;
      sx += (x1 + x2) * cr;
      sy += (y1 + y2) * cr;
    }
    if (Math.abs(a) < 1e-9) return { cx: MID, cy: MID };
    return { cx: sx / (3 * a), cy: sy / (3 * a) };
  }

  /* Точка контура квадрата 100×100 по длине обхода t в 0..400
   * (от левого верхнего угла по часовой стрелке). */
  function perimeterPoint(t) {
    const s = ((t % 400) + 400) % 400;
    if (s < 100) return [s, 0];
    if (s < 200) return [100, s - 100];
    if (s < 300) return [300 - s, 100];
    return [0, 400 - s];
  }

  /* Раскрой клетки на n осколков: случайная точка у центра (40–60 %) и лучи
   * к n точкам на контуре; соседние лучи ограничивают осколок.
   * Каждый осколок — массив [x, y] (проценты 0..100) с полями cx, cy — центром.
   * Доли обхода ограничены (от 0,2 до 0,8 своей доли), поэтому центр куска
   * не бывает ближе 8 % к середине клетки (проверяет тест на сотнях зёрен). */
  function shardPolygons(n, rand) {
    const ox = 40 + rand() * 20;
    const oy = 40 + rand() * 20;
    /* n точек на контуре: по одной в своей доле обхода, со сдвигом. */
    const ts = [];
    for (let i = 0; i < n; i++) ts.push((i + 0.2 + rand() * 0.6) / n * 400);

    const polys = [];
    for (let i = 0; i < n; i++) {
      const t1 = ts[i];
      const t2 = i + 1 < n ? ts[i + 1] : ts[0] + 400;
      const poly = [[ox, oy], perimeterPoint(t1)];
      /* углы квадрата (t = 100, 200, 300, 400) между лучами — в этот кусок */
      for (let k = Math.floor(t1 / 100) + 1; k * 100 < t2; k++) {
        poly.push(perimeterPoint(k * 100));
      }
      poly.push(perimeterPoint(t2));
      const cen = centroid(poly);
      poly.cx = cen.cx;
      poly.cy = cen.cy;
      polys.push(poly);
    }
    return polys;
  }

  /* Полёт осколка: от центра клетки наружу к центру куска, длина 60–110 %,
   * вниз добавлено 20 % (тяжесть), поворот ±40°. */
  function shardFlight(poly, rand) {
    const vx = poly.cx - MID;
    const vy = poly.cy - MID;
    const d = Math.hypot(vx, vy);
    const ux = d > 1e-9 ? vx / d : 0;
    const uy = d > 1e-9 ? vy / d : -1;
    const len = 60 + rand() * 50;
    const rot = (rand() * 2 - 1) * 40;
    return { dx: ux * len, dy: uy * len + 20, rot };
  }

  /* Клетки удара спецкамня и задержки их гашения, по возрастанию delay.
   * trigger: { r, c, type, color, lineDir }; cells: [{ r, c, color }] —
   * всё, что гаснет в этот ход. Клетки вне удара (обычный каскад) не входят.
   * Линия: lineDir 'col' — столбец, иначе ряд. */
  function strikeTargets(trigger, cells) {
    const t = trigger;
    const out = [];
    for (const cell of cells) {
      const dr = cell.r - t.r;
      const dc = cell.c - t.c;
      let delay = null;
      if (t.type === 'sun') {
        if (cell.color === t.color) {
          delay = Math.min(TIMING.sunMaxDelayMs, Math.round(Math.hypot(dr, dc) * TIMING.sunStepMs));
        }
      } else if (t.type === 'totem') {
        if (dr === 0 || dc === 0) {
          delay = Math.min(TIMING.waveMaxDelayMs, (Math.abs(dr) + Math.abs(dc)) * TIMING.waveStepMs);
        }
      } else if (t.type === 'line') {
        const col = t.lineDir === 'col';
        if (col ? dc === 0 : dr === 0) {
          const dist = Math.abs(col ? dr : dc);
          delay = Math.min(TIMING.waveMaxDelayMs, dist * TIMING.lineStepMs);
        }
      } else if (t.type === 'bomb') {
        if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) delay = 0;
      }
      if (delay !== null) out.push({ r: cell.r, c: cell.c, delay });
    }
    return out.sort((a, b) => a.delay - b.delay);
  }

  /* Для каждой клетки из cells — наименьшая задержка среди ударов triggers;
   * клетки без удара получают 0. Ключ — "r,c". */
  function mergeDelays(cells, triggers) {
    const best = new Map();
    for (const trg of triggers) {
      for (const t of strikeTargets(trg, cells)) {
        const key = t.r + ',' + t.c;
        const prev = best.get(key);
        if (prev === undefined || t.delay < prev) best.set(key, t.delay);
      }
    }
    const out = new Map();
    for (const cell of cells) {
      const key = cell.r + ',' + cell.c;
      out.set(key, best.has(key) ? best.get(key) : 0);
    }
    return out;
  }

  return {
    TIMING, budget, shardsFor, shardPolygons, shardFlight, strikeTargets, mergeDelays
  };
});
