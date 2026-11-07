/* Жаровни: живой огонь, тёплый свет и искры (этап 2, шаг 2).
   Игровую логику не трогает: слушает события sun:* и body[data-*]
   (контракт — js/game.js, «Контракт для визуальных слоёв»).
   Решения (что на какое событие, пределы яркости) — в js/fire-core.js,
   здесь только DOM: один цикл requestAnimationFrame на всё.

   Пауза: скрытая вкладка или любой .overlay.show (старт, карта, сцена…).
   prefers-reduced-motion: стоит кадр 0, свет ровный, искр и вспышек нет.
   Слабый компьютер: body[data-fx="low"] — сам, если 3 с подряд кадр дольше
   45 мс (первые 2 с после запуска цикла не считаются: там строится поле),
   или вручную localStorage['sun-keeper-fx'] = 'low'. Тогда без искр и
   мерцания, огонь обновляется 12 раз в секунду. Значение 'full' отключает
   автоопределение (для тестов и для тех, кому огонь важнее плавности). */
(function () {
  "use strict";

  const FC = window.FireCore;
  if (!FC) return;
  const S = FC.SHEET;
  const L = FC.LIMITS;
  const body = document.body;

  const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const isReduced = () => !!(reduceMq && reduceMq.matches);
  const rand = (a, b) => a + Math.random() * (b - a);

  const GLOW_BASE = 0.28;
  const LOW_STEP_MS = 1000 / 12;

  /* ---------- Элементы ---------- */
  const braziers = Array.from(document.querySelectorAll('.brazier')).map((el, i) => ({
    el,
    fire: el.querySelector('.brazier-fire'),
    layers: [el.querySelector('.fire-calm'), el.querySelector('.fire-flare')].filter(Boolean),
    flareLayer: el.querySelector('.fire-flare'),
    phase: i === 0 ? 0 : 23,   // правая жаровня горит не в такт левой
    shown: -1
  }));
  braziers.forEach(b => {
    if (!b.fire) return;
    b.fire.style.setProperty('--mouth-x', (S.mouth.x * 100) + '%');
    b.fire.style.setProperty('--mouth-y', (S.mouth.y * 100) + '%');
  });

  const light = document.createElement('div');
  light.className = 'fire-light';
  light.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'fire-sparks';
  canvas.setAttribute('aria-hidden', 'true');
  body.append(light, canvas);
  const ctx2d = canvas.getContext('2d');

  /* ---------- Слабый режим ---------- */
  let low = false;
  let autoLow = true;
  try {
    const fx = window.localStorage.getItem('sun-keeper-fx');
    low = fx === 'low';
    autoLow = fx !== 'low' && fx !== 'full';
  } catch (e) { /* хранилище недоступно — определяем сами */ }
  const WARMUP_MS = 2000;
  let wokeAt = 0;
  function setLow(v) {
    low = v;
    if (v) body.dataset.fx = 'low';
    else delete body.dataset.fx;
  }
  setLow(low);

  /* ---------- Точки огня: откуда свет и искры ----------
     Десктоп — основание пламени в каждой жаровне. Телефон (жаровен нет) —
     верхние углы рамки поля. */
  let sources = [];
  let lightRadius = 260;
  function measure() {
    const pts = [];
    let bh = 0;
    braziers.forEach(b => {
      if (!b.fire) return;
      const r = b.fire.getBoundingClientRect();
      if (r.width < 2) return;  // скрыта (телефон)
      pts.push({ x: r.left + r.width * S.mouth.x, y: r.top + r.height * S.mouth.y - r.height * 0.25, w: r.width * 0.5 });
      bh = Math.max(bh, b.el.getBoundingClientRect().height);
    });
    if (pts.length) {
      lightRadius = Math.round(Math.max(160, bh * 1.9));
    } else {
      const fr = document.querySelector('.board-frame');
      const r = fr ? fr.getBoundingClientRect() : null;
      if (r && r.width > 2) {
        // чуть внутрь от углов: у края экрана половина свечения пропала бы
        pts.push({ x: r.left + 46, y: r.top + 6, w: 22 }, { x: r.right - 46, y: r.top + 6, w: 22 });
      }
      lightRadius = 170;
    }
    sources = pts;
    const a = pts[0] || { x: -999, y: -999 };
    const b = pts[1] || a;
    light.style.setProperty('--l1x', a.x + 'px');
    light.style.setProperty('--l1y', a.y + 'px');
    light.style.setProperty('--l2x', b.x + 'px');
    light.style.setProperty('--l2y', b.y + 'px');
    light.style.setProperty('--lr', lightRadius + 'px');

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- Кадры огня ---------- */
  function showFrame(b, f) {
    if (b.shown === f) return;
    b.shown = f;
    const col = f % S.cols;
    const row = Math.floor(f / S.cols);
    const pos = (col / (S.cols - 1) * 100) + '% ' + (row / (S.rows - 1) * 100) + '%';
    b.layers.forEach(el => { el.style.backgroundPosition = pos; });
  }

  /* ---------- Вспышка ---------- */
  let flareStart = -1e9;
  let flareStrength = 0;
  let lastFlareAt = -1e9;
  let now = 0;
  const flareTotal = L.attackMs + L.holdMs + L.releaseMs;

  function flareLevel(t) {
    return FC.envelope(t - flareStart, flareStrength);
  }

  function triggerFlare(strength) {
    if (!(strength > 0)) return;
    const t = performance.now();
    if (t - lastFlareAt < L.throttleMs) return;
    const cur = flareLevel(t);
    if (cur >= strength) return;  // идущая вспышка сильнее — не трогаем
    lastFlareAt = t;
    flareStrength = strength;
    // Начинаем с того места проявления, где огибающая уже равна текущей,
    // чтобы яркость не прыгала вниз
    const k = Math.min(1, cur / strength);
    flareStart = t - L.attackMs * Math.acos(1 - 2 * k) / Math.PI;
    wake();
  }

  /* ---------- Колыхание ---------- */
  let swayTimer = 0;
  function sway() {
    braziers.forEach(b => {
      if (!b.fire) return;
      b.fire.classList.remove('sway');
      void b.fire.offsetWidth;
      b.fire.classList.add('sway');
    });
    clearTimeout(swayTimer);
    swayTimer = setTimeout(() => braziers.forEach(b => b.fire && b.fire.classList.remove('sway')), 650);
  }

  /* ---------- Искры ---------- */
  const sparks = [];
  const SPARKS_ALIVE_MAX = 48;
  let nextIdle = [];

  function spawn(src, burst) {
    if (sparks.length >= SPARKS_ALIVE_MAX) return;
    sparks.push({
      x: src.x + rand(-src.w, src.w) * 0.6,
      y: src.y + rand(-4, 4),
      vx: rand(-18, 18),
      vy: burst ? rand(-210, -120) : rand(-110, -60),
      age: 0,
      life: rand(1.2, 2.2),
      size: rand(1.5, 3),
      wob: rand(0, Math.PI * 2)
    });
  }

  function burst(n) {
    if (low || isReduced() || !sources.length) return;
    for (let i = 0; i < n; i++) spawn(sources[i % sources.length], true);
    wake();
  }

  function stepSparks(dt, t) {
    if (!low && sources.length) {
      if (nextIdle.length !== sources.length) nextIdle = sources.map(() => t + rand(400, 2500));
      sources.forEach((src, i) => {
        if (t >= nextIdle[i]) {
          spawn(src, false);
          nextIdle[i] = t + rand(1500, 3000);
        }
      });
    }
    const s = dt / 1000;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.age += s;
      if (p.age >= p.life) { sparks.splice(i, 1); continue; }
      p.wob += s * 3;
      p.x += (p.vx + Math.sin(p.wob) * 12) * s;
      p.y += p.vy * s;
      p.vy *= 1 - 0.35 * s;  // искра замедляется, поднимаясь
    }
  }

  let canvasDirty = false;
  function drawSparks() {
    if (!sparks.length && !canvasDirty) return;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    canvasDirty = sparks.length > 0;
    ctx2d.globalCompositeOperation = 'lighter';
    sparks.forEach(p => {
      const k = p.age / p.life;
      const a = Math.pow(1 - k, 1.5);
      // от светло-золотой к оранжевой
      const g = Math.round(210 - 88 * k);
      const b = Math.round(122 - 80 * k);
      ctx2d.fillStyle = 'rgba(255,' + g + ',' + b + ',' + a.toFixed(3) + ')';
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, p.size * (1 - 0.4 * k), 0, Math.PI * 2);
      ctx2d.fill();
    });
    ctx2d.globalCompositeOperation = 'source-over';
  }

  /* ---------- Цикл ---------- */
  let raf = 0;
  let lastTs = 0;
  let fireT = 0;
  let urgSpeed = 1;
  let frames = 0;
  let lastApply = 0;
  let flaring = false;
  let frameTimes = [];
  let lowCheckAt = 0;

  function paused() {
    return document.hidden || !!document.querySelector('.overlay.show');
  }

  function tick(ts) {
    raf = 0;
    if (paused() || isReduced()) { lastTs = 0; return; }
    const dt = lastTs ? Math.min(100, ts - lastTs) : 0;
    lastTs = ts;
    now = ts;
    frames++;

    // Признак слабого компьютера: кадры по 45+ мс три секунды подряд
    if (autoLow && !low && dt > 0 && ts - wokeAt > WARMUP_MS) {
      frameTimes.push(dt);
      if (frameTimes.length > 400) frameTimes.splice(0, frameTimes.length - 400);
      if (ts - lowCheckAt > 1000) {
        lowCheckAt = ts;
        if (FC.lowFps(frameTimes)) setLow(true);
      }
    }

    const target = FC.speedFor(body.dataset.urgency || '');
    urgSpeed += (target - urgSpeed) * Math.min(1, dt / 270);
    const e = flareLevel(ts);
    const speed = urgSpeed * FC.flareSpeed(e);
    fireT += dt * speed;

    if (!low || ts - lastApply >= LOW_STEP_MS) {
      lastApply = ts;
      braziers.forEach(b => showFrame(b, FC.frameAt(fireT, S, 1, b.phase)));
    }

    const on = e > 0.01;
    braziers.forEach(b => {
      if (b.flareLayer) b.flareLayer.style.opacity = on ? e.toFixed(3) : '0';
      if (b.fire) b.fire.style.setProperty('--flare-scale', on ? (1 + (L.scaleMax - 1) * e).toFixed(4) : '1');
      if (on !== flaring) {
        if (on) b.el.dataset.flare = '1';
        else delete b.el.dataset.flare;
      }
    });
    flaring = on;

    const fl = low ? 0 : FC.flicker(ts / 1000, 1);
    light.style.opacity = FC.glow(GLOW_BASE, e, fl).toFixed(3);

    stepSparks(dt, ts);
    drawSparks();
    raf = requestAnimationFrame(tick);
  }

  function wake() {
    if (raf || paused() || isReduced()) return;
    lastTs = 0;
    frameTimes = [];
    wokeAt = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function applyReduced() {
    if (isReduced()) {
      braziers.forEach(b => {
        showFrame(b, 0);
        if (b.flareLayer) b.flareLayer.style.opacity = '0';
        if (b.fire) b.fire.style.setProperty('--flare-scale', '1');
        delete b.el.dataset.flare;
      });
      sparks.length = 0;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      light.style.opacity = String(GLOW_BASE);
    } else {
      wake();
    }
  }

  /* ---------- Реакции на игру ---------- */
  function react(name, detail) {
    const r = FC.reaction(name, detail, {
      calm: body.dataset.difficulty === 'calm',
      reduced: isReduced(),
      low
    });
    if (!r) return;
    if (r.sway) sway();
    if (r.flare > 0) triggerFlare(r.flare);
    if (r.sparks > 0) burst(r.sparks);
  }

  window.addEventListener('sun:match', e => react('match', e.detail));
  window.addEventListener('sun:special', e => react('special', e.detail));
  window.addEventListener('sun:blast', e => react('blast', e.detail));

  let prevOutcome = body.dataset.outcome || '';
  new MutationObserver(() => {
    const o = body.dataset.outcome || '';
    if (o === 'win' && prevOutcome !== 'win') react('win', {});
    prevOutcome = o;
  }).observe(body, { attributes: true, attributeFilter: ['data-outcome'] });

  /* ---------- Пауза и размеры ---------- */
  const overlayObs = new MutationObserver(() => { measure(); wake(); });
  document.querySelectorAll('.overlay').forEach(o => overlayObs.observe(o, { attributes: true, attributeFilter: ['class'] }));
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('resize', () => { measure(); wake(); });
  if (window.ResizeObserver) {
    const shell = document.querySelector('.game-shell');
    if (shell) new ResizeObserver(measure).observe(shell);
  }
  if (reduceMq) {
    if (reduceMq.addEventListener) reduceMq.addEventListener('change', applyReduced);
    else if (reduceMq.addListener) reduceMq.addListener(applyReduced);
  }

  measure();
  braziers.forEach(b => showFrame(b, FC.frameAt(0, S, 1, b.phase)));
  light.style.opacity = String(GLOW_BASE);
  applyReduced();

  /* ---------- Отладка (для тестов, только с ?debug) ---------- */
  if (new URLSearchParams(location.search).has('debug')) {
    window.__FIRE = {
      get frames() { return frames; },
      flare: s => { lastFlareAt = -1e9; triggerFlare(s); },
      state: () => ({
        running: !!raf,
        speed: urgSpeed,
        flare: flareLevel(now || performance.now()),
        low,
        reduced: isReduced(),
        sparks: sparks.length,
        flareTotal
      })
    };
  }
})();
