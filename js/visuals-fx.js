/* Хранитель Солнца — эффекты поля: раскол камня на осколки (этап 2, шаг 5).
 * Что и сколько (раскрой, полёт, бюджет, задержки) решает js/fx-core.js;
 * здесь только DOM и canvas. Анимируются лишь transform и opacity.
 *
 * Fx.mode()       — { calm, reduced, low } по body[data-difficulty],
 *                   body[data-fx] и prefers-reduced-motion; читается при каждом вызове.
 * Fx.shatter(gemEl, r, c, delayMs, opts)
 *                 — камень прячется сразу (класс fx-gone), на его месте в #fx
 *                   копия .fx-standin; через delayMs она распадается на осколки
 *                   .fx-shard (копии рисунка, обрезанные clip-path), они летят
 *                   и гаснут за TIMING.shatterMs; на canvas — пыль цвета камня
 *                   и золотые блики. opts: { cells — сколько клеток гаснет
 *                   в этом шаге (для FxCore.shardsFor), color — цвет пыли }.
 *                   reduced: копия просто гаснет за 200 мс, больше ничего.
 * Fx.canvas       — один <canvas class="fx-canvas"> в #fx; цикл
 *                   requestAnimationFrame идёт, только пока есть живые частицы.
 * Fx.particles()  — число живых частиц (для e2e).
 * Fx.clear()      — убрать всё; вызывается само, когда открывается любой .overlay. */
(function () {
  'use strict';

  const FC = window.FxCore;
  const T = FC.TIMING;
  const layer = document.getElementById('fx');
  const body = document.body;
  const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const rand = Math.random;

  const CELL = 12.5;              // клетка, % поля
  const REDUCED_FADE_MS = 200;
  const SAG = 18;                 // осколок проседает к концу полёта, % клетки
  const MAX_PARTICLES = 260;      // потолок частиц на canvas
  const DPR_MAX = 2;
  const GOLD = '#ffd27a';
  const SPRITE_PX = 64;

  function mode() {
    return {
      calm: body.dataset.difficulty === 'calm',
      reduced: !!(reduceMq && reduceMq.matches),
      low: body.dataset.fx === 'low'
    };
  }

  /* ---------- Таймеры: Fx.clear() отменяет все отложенные шаги ---------- */
  const timers = new Set();
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  }

  /* ---------- Копии камня в #fx ---------- */
  function cellBox(cls, r, c, inner) {
    const el = document.createElement('div');
    el.className = 'fx-cell ' + cls;
    el.style.left = (c * CELL) + '%';
    el.style.top = (r * CELL) + '%';
    el.dataset.cell = r + ',' + c;
    el.appendChild(inner.cloneNode(true));
    return el;
  }

  function fadeOut(el, ms) {
    if (el.animate) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
    later(() => el.remove(), ms + 20);
  }

  /* Полёт осколка: наружу быстро и с замедлением, к концу проседает
   * (тяжесть), чуть поворачивается вокруг своего центра и гаснет. */
  function fly(el, poly) {
    const f = FC.shardFlight(poly, rand);
    const dur = Math.round(T.shatterMs * (0.84 + rand() * 0.16));
    if (el.animate) {
      const frames = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const out = 1 - (1 - t) * (1 - t);
        const x = f.dx * out;
        const y = f.dy * out + SAG * t * t;
        const fade = t < 0.4 ? 1 : Math.pow(1 - (t - 0.4) / 0.6, 1.3);
        frames.push({
          offset: t,
          transform: `translate(${x.toFixed(2)}%, ${y.toFixed(2)}%) rotate(${(f.rot * out).toFixed(1)}deg) scale(${(1 - 0.12 * t).toFixed(3)})`,
          opacity: fade.toFixed(3)
        });
      }
      el.animate(frames, { duration: dur, easing: 'linear', fill: 'forwards' });
    }
    later(() => el.remove(), dur + 40);
  }

  function burst(r, c, inner, opts, m) {
    const n = FC.shardsFor(Math.max(1, opts.cells || 1), m);
    const polys = FC.shardPolygons(n, rand);
    const shards = polys.map(poly => {
      const el = cellBox('fx-shard', r, c, inner);
      el.style.clipPath = 'polygon(' + poly.map(p => p[0].toFixed(1) + '% ' + p[1].toFixed(1) + '%').join(', ') + ')';
      el.style.transformOrigin = poly.cx.toFixed(1) + '% ' + poly.cy.toFixed(1) + '%';
      return el;
    });
    const frag = document.createDocumentFragment();
    shards.forEach(el => frag.appendChild(el));
    layer.appendChild(frag);
    shards.forEach((el, i) => fly(el, polys[i]));

    const b = FC.budget(m);
    if (b.dust > 0) dust(r, c, opts.color || GOLD, b.dust, b.beamAlpha);
    if (b.glints > 0) glints(r, c, b.glints, b.beamAlpha);
  }

  function shatter(gemEl, r, c, delayMs, opts) {
    if (!gemEl) return;
    const o = opts || {};
    const m = mode();
    const inner = gemEl.querySelector('.gem-inner');
    gemEl.classList.add('fx-gone');
    if (!inner) return;
    const delay = Math.max(0, delayMs || 0);

    if (m.reduced) {
      const st = cellBox('fx-standin', r, c, inner);
      layer.appendChild(st);
      later(() => fadeOut(st, REDUCED_FADE_MS), delay);
      return;
    }
    if (delay === 0) {
      burst(r, c, inner, o, m);
      return;
    }
    // Ждём своей очереди (удар ещё не дошёл): на месте камня стоит его копия
    const st = cellBox('fx-standin', r, c, inner);
    layer.appendChild(st);
    later(() => { st.remove(); burst(r, c, inner, o, m); }, delay);
  }

  /* ---------- Canvas: пыль и блики ---------- */
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  let parts = [];
  let raf = 0;
  let cellPx = 0;
  let dpr = 1;

  /* #fx очищается целиком при новой раскладке поля — холст возвращаем на место */
  function ensureCanvas() {
    if (canvas.parentNode !== layer) layer.insertBefore(canvas, layer.firstChild);
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    cellPx = w / 8;
  }

  /* Мягкие спрайты рисуются один раз на цвет */
  const sprites = new Map();
  function softSprite(color) {
    let s = sprites.get(color);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = SPRITE_PX;
    const g = s.getContext('2d');
    const h = SPRITE_PX / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, hexA(color, 0.55));
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
    sprites.set(color, s);
    return s;
  }

  /* Блик — четырёхлучевая звёздочка с тёплым ядром */
  let starSprite = null;
  function star() {
    if (starSprite) return starSprite;
    const s = document.createElement('canvas');
    s.width = s.height = SPRITE_PX;
    const g = s.getContext('2d');
    const h = SPRITE_PX / 2;
    const core = g.createRadialGradient(h, h, 0, h, h, h * 0.42);
    core.addColorStop(0, 'rgba(255, 246, 214, 1)');
    core.addColorStop(0.4, hexA(GOLD, 0.7));
    core.addColorStop(1, hexA(GOLD, 0));
    g.fillStyle = core;
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
    g.globalCompositeOperation = 'lighter';
    [[SPRITE_PX, 3], [3, SPRITE_PX]].forEach(([w, hh]) => {
      const ray = g.createRadialGradient(h, h, 0, h, h, h);
      ray.addColorStop(0, hexA(GOLD, 0.9));
      ray.addColorStop(1, hexA(GOLD, 0));
      g.fillStyle = ray;
      g.fillRect(h - w / 2, h - hh / 2, w, hh);
    });
    starSprite = s;
    return s;
  }

  function hexA(hex, a) {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
  }

  function add(p) {
    if (parts.length >= MAX_PARTICLES) return;
    parts.push(p);
  }

  /* Пыль: облачко цвета камня — один крупный медленный клуб и мелкая
   * пыль, разлетается и оседает. Позиции и скорости — в клетках. */
  function dust(r, c, color, count, bright) {
    const sprite = softSprite(color);
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      const puff = i === 0;
      const a = rand() * Math.PI * 2;
      const sp = puff ? 0.15 : 0.5 + rand() * 0.9;
      add({
        sprite, add: false,
        x: c + 0.5 + Math.cos(a) * 0.12, y: r + 0.5 + Math.sin(a) * 0.12,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.25, g: 0.6,
        size: puff ? 0.9 : 0.16 + rand() * 0.22, grow: puff ? 0.5 : 0.3,
        alpha: (puff ? 0.2 : 0.22 + rand() * 0.14) * bright,
        born: t0 + rand() * 40, life: puff ? 520 : 480 + rand() * 320,
        rot: 0, spin: 0
      });
    }
    start();
  }

  function glints(r, c, count, bright) {
    const sprite = star();
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = 0.18 + rand() * 0.16;
      add({
        sprite, add: true, twinkle: true,
        x: c + 0.5 + Math.cos(a) * d, y: r + 0.5 + Math.sin(a) * d,
        vx: 0, vy: -0.12, g: 0,
        size: 0.42 + rand() * 0.14, grow: 0,
        alpha: 0.85 * bright,
        born: t0 + 30 + i * 70 + rand() * 40, life: 420 + rand() * 100,
        rot: rand() * 0.6, spin: 0.9
      });
    }
    start();
  }

  function start() {
    if (raf || !parts.length) return;
    ensureCanvas();
    raf = requestAnimationFrame(frame);
  }

  let lastT = 0;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
    lastT = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const k = cellPx * dpr;
    const alive = [];
    for (const p of parts) {
      const age = now - p.born;
      if (age > p.life) continue;
      alive.push(p);
      if (age < 0) continue;
      p.vx *= 1 - 1.8 * dt;
      p.vy = p.vy * (1 - 1.8 * dt) + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = age / p.life;
      // Появляется быстро, гаснет плавно; блик — вспыхивает и сжимается
      const env = p.twinkle ? Math.sin(Math.PI * t) : Math.min(1, t / 0.15) * (1 - t) * (1 - t);
      const scale = p.twinkle ? 0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.3)) : 1 + p.grow * t;
      const s = p.size * scale * k;
      ctx.globalAlpha = Math.max(0, p.alpha * env);
      ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
      if (p.spin) {
        ctx.setTransform(1, 0, 0, 1, p.x * k, p.y * k);
        ctx.rotate(p.rot + p.spin * t);
        ctx.drawImage(p.sprite, -s / 2, -s / 2, s, s);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        ctx.drawImage(p.sprite, p.x * k - s / 2, p.y * k - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    parts = alive;
    if (parts.length) raf = requestAnimationFrame(frame);
    else lastT = 0;
  }

  function clear() {
    timers.forEach(id => clearTimeout(id));
    timers.clear();
    layer.querySelectorAll('.fx-standin, .fx-shard').forEach(el => el.remove());
    parts = [];
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastT = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  ensureCanvas();

  /* Открылся любой оверлей (пауза, конец уровня, карта…) — эффекты убрать */
  const overlayObs = new MutationObserver(list => {
    if (list.some(m => m.target.classList.contains('show'))) clear();
  });
  document.querySelectorAll('.overlay').forEach(o => overlayObs.observe(o, { attributes: true, attributeFilter: ['class'] }));

  window.Fx = {
    mode,
    shatter,
    canvas,
    particles: () => parts.length,
    clear
  };
})();
