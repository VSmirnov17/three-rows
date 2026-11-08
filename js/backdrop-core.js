/* Хранитель Солнца — живой фон: чистая логика без DOM (работает в Node).
 *
 * LIMITS   — пределы движения фона («Спокойствие», §2 и §8). Числа в
 *            css/backdrop.css и FIREFLY ниже проверяют tests/backdrop-core.test.js.
 * FIREFLY  — параметры светлячков: число, отступ, скорость, мерцание, размер.
 * modeFor  — режим фона: 'run' (всё движется), 'paused' (вкладка скрыта или
 *            открыт оверлей), 'still' (картина стоит: reduced-motion или телефон).
 * fliesOn  — летят ли светлячки: только в 'run' и не на слабом компьютере.
 * fireflyAlpha — плавная яркость светлячка в момент t.
 * isFree, spawnPoint — свободное от табличек и кнопок место для светлячка.
 * Время и случайность сюда приходят параметрами: ни Date.now(), ни Math.random()
 * внутри нет.
 */
(function (factory) {
  'use strict';

  const BackdropCore = factory();

  if (typeof window !== 'undefined') window.BackdropCore = BackdropCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = BackdropCore;
})(function () {
  'use strict';

  const LIMITS = Object.freeze({
    moonBreathMinS: 8,     // «дыхание» ореола луны не быстрее чем за 8 с
    haloSwingMax: 0.3,     // размах непрозрачности ореола не больше 0,3
    cloudCrossMinS: 90,    // облака пересекают полосу не быстрее чем за 90 с
    waterMinS: 2.5,        // струя воды проходит плитку не быстрее чем за 2,5 с
    fireflyMax: 18,        // светлячков не больше 18
    fireflyAlphaMax: 0.8,  // яркость светлячка не выше 0,8
    fireflyBlinkMinS: 3,   // период мерцания не короче 3 с
    fireflySpeedMax: 14    // скорость светлячка не выше 14 px/с
  });

  const FIREFLY = Object.freeze({
    count: 16,
    pad: 14,                          // отступ от табличек, кнопок и рамки, px
    speed: Object.freeze([5, 12]),    // px/с
    rise: 2,                          // лёгкий подъём, px/с
    period: Object.freeze([3.5, 6.5]),// период мерцания, с
    alpha: Object.freeze([0.08, 0.8]),
    radius: Object.freeze([1.0, 1.7]),// радиус ядра, px
    glow: 6                           // свечение: радиус ядра × 6
  });

  /* 'still' важнее 'paused': при reduced-motion или на телефоне картина стоит всегда. */
  function modeFor(s) {
    if (s.reduced || s.phone) return 'still';
    if (s.hidden || s.overlay) return 'paused';
    return 'run';
  }

  function fliesOn(mode, low) {
    return mode === 'run' && !low;
  }

  /* Яркость: k = 0,5 − 0,5·cos(2π(t + phase)/period), ответ alpha0 + (alpha1 − alpha0)·k².
   * Квадрат делает свечение дольше тёмным и мягко разгорающимся. */
  function fireflyAlpha(t, period, phase) {
    const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * (t + phase) / period);
    return FIREFLY.alpha[0] + (FIREFLY.alpha[1] - FIREFLY.alpha[0]) * k * k;
  }

  /* Точка свободна, если не лежит ни в одном прямоугольнике, расширенном на pad. */
  function isFree(rects, x, y, pad) {
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (x >= r.left - pad && x <= r.right + pad &&
          y >= r.top - pad && y <= r.bottom + pad) return false;
    }
    return true;
  }

  /* Случайная свободная точка: x ∈ [4, w−4], y ∈ [0,15·h, h−6].
   * Если за tries попыток места нет — null. */
  function spawnPoint(rects, w, h, rand, tries) {
    const n = tries === undefined ? 60 : tries;
    const x0 = 4;
    const x1 = w - 4;
    const y0 = 0.15 * h;
    const y1 = h - 6;
    for (let i = 0; i < n; i++) {
      const x = x0 + rand() * (x1 - x0);
      const y = y0 + rand() * (y1 - y0);
      if (isFree(rects, x, y, FIREFLY.pad)) return { x: x, y: y };
    }
    return null;
  }

  return { LIMITS, FIREFLY, modeFor, fliesOn, fireflyAlpha, isFree, spawnPoint };
});
