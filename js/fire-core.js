/* Хранитель Солнца — огонь жаровен: чистая логика без DOM (работает в Node).
 *
 * SHEET    — параметры спрайт-листа; копия assets/fire/fire.json
 *            (совпадение проверяет tests/fire-core.test.js).
 * LIMITS   — пределы яркости, частоты и искр («Спокойствие», §8).
 * reaction — что делает огонь на событие игры.
 * envelope, flareSpeed — форма и разгон вспышки.
 * frameAt, speedFor    — номер кадра цикла и скорость по тревоге.
 * glow, flicker        — свет вокруг огня и его мягкое мерцание.
 * lowFps               — признак слабого компьютера.
 * Время сюда приходит параметром: ни Date.now(), ни Math.random() внутри нет.
 */
(function (factory) {
  'use strict';

  const FireCore = factory();

  if (typeof window !== 'undefined') window.FireCore = FireCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = FireCore;
})(function () {
  'use strict';

  /* Те же числа, что в assets/fire/fire.json. */
  const SHEET = Object.freeze({
    frames: 48,
    cols: 8,
    rows: 6,
    fw: 224,
    fh: 219,
    fps: 24,
    mouth: Object.freeze({ x: 0.507, y: 0.936 })
  });

  const LIMITS = Object.freeze({
    glowMax: 0.55,      // непрозрачность света не выше, даже при вспышке 1,0
    scaleMax: 1.22,     // пламя при вспышке растёт не больше чем на 22 %
    flareSpeed: 1.6,    // кадры идут быстрее не больше чем в 1,6 раза
    flickerAmp: 0.08,   // размах мерцания света (± непрозрачности)
    flickerHz: 2.5,     // самая быстрая частота мерцания
    throttleMs: 250,    // вспышки не чаще одной в 250 мс
    sparksMax: 24,      // искр за один раз
    calmFactor: 0.6,    // на «Спокойно» вспышка слабее
    attackMs: 120,      // проявление вспышки
    holdMs: 500,        // держание
    releaseMs: 900      // затухание
  });

  const SPEED_BY_URGENCY = { tense: 1.25, urgent: 1.5 };
  const LOW_FPS_WINDOW_MS = 3000;
  const LOW_FPS_FRAME_MS = 45;

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  /* Искры по силе вспышки: round(4 + 20·сила), не больше sparksMax.
   * Сила 0,35 — 11 искр, сила 1 — 24 (потолок). */
  function sparksFor(flare) {
    return Math.min(LIMITS.sparksMax, Math.round(4 + 20 * flare));
  }

  /* Реакция огня на событие: { flare 0..1, sparks, sway } или null.
   * eventName: 'match' | 'special' | 'blast' | 'win'.
   * ctx: { calm, reduced, low } — «Спокойно», reduced-motion, слабый компьютер. */
  function reaction(eventName, detail, ctx) {
    const c = ctx || {};
    const d = detail || {};
    if (c.reduced) return null;

    let flare;
    let sway = false;
    if (eventName === 'match') {
      const chain = Number(d.chain) || 1;
      if (chain <= 1) {
        flare = 0;
        sway = true;
      } else {
        flare = Math.min(1, 0.35 + 0.15 * (chain - 2));
      }
    } else if (eventName === 'special') {
      flare = 0.6;
    } else if (eventName === 'blast') {
      flare = d.type === 'sun' ? 1 : 0.8;
    } else if (eventName === 'win') {
      flare = 1;
    } else {
      return null;
    }

    let sparks = flare > 0 ? sparksFor(flare) : 0;
    if (c.calm) {
      flare *= LIMITS.calmFactor;
      sparks = Math.floor(sparks / 2);
    }
    if (c.low) sparks = 0;
    return { flare, sparks, sway };
  }

  /* Огибающая вспышки: проявление (по косинусу), держание, затухание
   * (по косинусу). Не больше strength; после полной длины ровно 0. */
  function envelope(tMs, strength) {
    const { attackMs, holdMs, releaseMs } = LIMITS;
    if (!(tMs > 0)) return 0;
    if (tMs < attackMs) return strength * (1 - Math.cos(Math.PI * tMs / attackMs)) / 2;
    if (tMs < attackMs + holdMs) return strength;
    const r = tMs - attackMs - holdMs;
    if (r >= releaseMs) return 0;
    return strength * (1 + Math.cos(Math.PI * r / releaseMs)) / 2;
  }

  /* Множитель скорости кадров при огибающей e (0..1). */
  function flareSpeed(e) {
    return 1 + (LIMITS.flareSpeed - 1) * e;
  }

  /* Номер кадра цикла. speed — множитель скорости, phase — сдвиг в кадрах.
   * Скорость постоянна на всём отрезке 0..tMs: если она меняется,
   * вызывающий копит «время огня» сам и подаёт его как tMs. */
  function frameAt(tMs, sheet, speed, phase) {
    const n = sheet.frames;
    const pos = Math.floor(tMs / 1000 * sheet.fps * speed + (phase || 0));
    return ((pos % n) + n) % n;
  }

  /* Множитель скорости кадров по body[data-urgency]. */
  function speedFor(urgency) {
    return SPEED_BY_URGENCY[urgency] || 1;
  }

  /* Непрозрачность света: основа base, вспышка поднимает её к glowMax,
   * мерцание (flicker) добавляется сверху; всегда в [0, glowMax]. */
  function glow(base, flare, flicker) {
    const b = clamp(base, 0, LIMITS.glowMax);
    const f = clamp(flare, 0, 1);
    return clamp(b + f * (LIMITS.glowMax - b) + flicker, 0, LIMITS.glowMax);
  }

  /* Мерцание: сумма трёх синусов (до flickerHz), веса дают в сумме 1,
   * seed сдвигает фазы, чтобы две жаровни не мерцали в такт.
   * Результат в [−flickerAmp, flickerAmp]. */
  function flicker(tSec, seed) {
    const s = seed || 0;
    const w = 2 * Math.PI;
    const v = 0.5 * Math.sin(w * LIMITS.flickerHz * tSec + s * 2.3) +
      0.3 * Math.sin(w * 1.3 * tSec + s * 4.1 + 1.7) +
      0.2 * Math.sin(w * 0.7 * tSec + s * 0.9 + 4.2);
    return LIMITS.flickerAmp * v;
  }

  /* Слабый компьютер: средний кадр дольше 45 мс за последние 3 с.
   * frameTimesMs — длительности кадров, самые новые в конце. Пока набралось
   * меньше 3 с, ответ false. */
  function lowFps(frameTimesMs) {
    let sum = 0;
    let count = 0;
    for (let i = frameTimesMs.length - 1; i >= 0 && sum < LOW_FPS_WINDOW_MS; i--) {
      sum += frameTimesMs[i];
      count++;
    }
    if (count === 0 || sum < LOW_FPS_WINDOW_MS) return false;
    return sum / count > LOW_FPS_FRAME_MS;
  }

  return {
    SHEET, LIMITS, reaction, envelope, flareSpeed,
    frameAt, speedFor, glow, flicker, lowFps
  };
});
