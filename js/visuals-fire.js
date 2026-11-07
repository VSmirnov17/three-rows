/* Жаровни: живой огонь, тёплый свет и искры (этап 2, шаг 2).
   Игровую логику не трогает: слушает события sun:* и body[data-*]
   (контракт — js/game.js, «Контракт для визуальных слоёв»).
   Решения (что на какое событие, пределы яркости) — в js/fire-core.js,
   здесь только DOM: один цикл requestAnimationFrame на всё.

   Пауза: скрытая вкладка или любой .overlay.show (старт, карта, сцена…).
   На паузе огонь возвращается к спокойному горению, искры гаснут —
   под оверлеем ничего не замирает на полпути.
   Свет и искры лежат внутри #app под оверлеями (#app — свой контекст
   наложения, поэтому слой на <body> лёг бы поверх всех экранов).
   prefers-reduced-motion: стоит кадр 0, свет ровный, искр и вспышек нет.
   Слабый компьютер: body[data-fx="low"] — сам, если 3 с подряд кадр дольше
   45 мс (первые 2 с после запуска цикла не считаются: там строится поле),
   или вручную localStorage['sun-keeper-fx'] = 'low'. Тогда без искр и
   мерцания, цикл идёт 12 раз в секунду. Значение 'full' отключает
   автоопределение (для тестов и для тех, кому огонь важнее плавности).

   Размер жаровни подгоняется под свободное место в правой колонке
   (fitBraziers). Если места меньше чем на 70 px, жаровни прячутся
   (body[data-braziers="off"]), свет и искры идут от углов рамки поля,
   как на телефоне. */
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
  const BH_MIN = 70;
  // Геометрия жаровни в долях её высоты bh — как в css/fire.css
  const G = { fireW: 0.72, fireBottom: 0.40, cost: 0.9 };
  const FIRE_ASPECT = S.fh / S.fw;
  // Языки пламени в самых высоких кадрах доходят почти до верха кадра
  const FLAME_TOP = 0.01;

  /* ---------- Элементы ---------- */
  const braziers = Array.from(document.querySelectorAll('.brazier')).map((el, i) => ({
    el,
    fire: el.querySelector('.brazier-fire'),
    layers: [el.querySelector('.fire-calm'), el.querySelector('.fire-flare')].filter(Boolean),
    flareLayer: el.querySelector('.fire-flare'),
    phase: i === 0 ? 0 : 23,   // правая жаровня горит не в такт левой
    shown: -1,
    op: '',
    sc: ''
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
  const shell = document.querySelector('.game-shell');
  if (shell) shell.after(light, canvas);
  else body.append(light, canvas);
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

  /* ---------- Размер жаровни под свободное место ----------
     Левая колонка гибкая (круг Камня ужимается), правая — нет: меню,
     уровень, таймер и три кнопки. Жаровня стоит в ней ~0.9·bh, поэтому
     bh уменьшаем на нехватку / 0.9. */
  /* Правая колонка может заходить на полосу подсказки под полем (до низа
     окна) — тогда подсказка не шире поля (body[data-hint-narrow]), чтобы
     не наехать на нижнюю кнопку. */
  const PAD_BOTTOM = 8;
  function fitBraziers() {
    braziers.forEach(b => b.el.style.removeProperty('--bh'));
    delete body.dataset.braziers;
    delete body.dataset.hintNarrow;
    const panel = document.querySelector('.right-panel');
    const first = braziers[0];
    if (!panel || !first || first.el.offsetParent === null) return;  // телефон
    const lastOf = () => {
      const kids = Array.from(panel.children).filter(k => k.offsetParent !== null);
      return kids.length ? kids[kids.length - 1].getBoundingClientRect().bottom : 0;
    };
    const bh0 = first.el.getBoundingClientRect().height;
    const over = Math.max(lastOf() - (window.innerHeight - PAD_BOTTOM),
      document.scrollingElement ? document.scrollingElement.scrollHeight - window.innerHeight : 0);
    if (over > 0) {
      const bh = Math.floor(bh0 - over / G.cost - 1);
      if (bh < BH_MIN) body.dataset.braziers = 'off';
      else braziers.forEach(b => b.el.style.setProperty('--bh', bh + 'px'));
    }
    // И без жаровен (низкое окно) колонка может заходить на полосу подсказки
    const frame = document.querySelector('.board-frame');
    if (frame && lastOf() > frame.getBoundingClientRect().bottom + 1) body.dataset.hintNarrow = '1';
    placeHint();
  }

  /* Длинная подсказка при заходе колонки на её полосу: сначала пробуем
     сдвинуть её влево (правым краем к краю поля). Если там что-то есть
     (узкое окно: поле по центру по высоте, рядом круг Камня), подсказка
     остаётся по центру, не шире поля, и переносится на вторую строку. */
  const hintBar = document.getElementById('hintBar');
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  function placeHint() {
    if (!hintBar) return;
    hintBar.classList.remove('hint-shift', 'hint-fit');
    if (!body.dataset.hintNarrow) return;
    const frame = document.querySelector('.board-frame');
    if (!frame || hintBar.offsetWidth <= frame.getBoundingClientRect().width - 24) return;
    hintBar.classList.add('hint-shift');
    const hr = hintBar.getBoundingClientRect();
    const blockers = document.querySelectorAll('.left-panel > *, .right-panel > *, .right-panel button');
    const blocked = Array.from(blockers).some(el => el.offsetParent !== null && hit(hr, el.getBoundingClientRect()));
    if (blocked) {
      hintBar.classList.remove('hint-shift');
      hintBar.classList.add('hint-fit');
    }
  }
  if (hintBar) new MutationObserver(placeHint).observe(hintBar, { childList: true, characterData: true, subtree: true });

  /* ---------- Точки огня: откуда свет и искры ----------
     Десктоп — основание пламени в каждой жаровне (считается по коробке
     жаровни, без учёта вспышки и колыхания). Телефон и низкое окно без
     жаровен — верхние углы рамки поля. */
  let sources = [];
  let maxScale = L.scaleMax;
  function measure() {
    const pts = [];
    let bh = 0;
    let minScale = L.scaleMax;
    braziers.forEach(b => {
      const r = b.el.getBoundingClientRect();
      if (r.width < 2 || b.el.offsetParent === null) return;  // скрыта
      const h = r.height;
      const fw = h * G.fireW;
      const fh = fw * FIRE_ASPECT;
      const bottom = r.bottom - h * G.fireBottom;
      const top = bottom - fh;
      const mouthY = top + fh * S.mouth.y;
      pts.push({ x: r.left + r.width / 2 + (S.mouth.x - 0.5) * fw, y: mouthY - fh * 0.25, w: fw * 0.5 });
      // Вспышка растёт от основания: кончики не должны уйти за верх окна
      const flameTop = top + fh * FLAME_TOP;
      const room = (mouthY - 2) / Math.max(1, mouthY - flameTop);
      minScale = Math.min(minScale, Math.max(1, room));
      bh = Math.max(bh, h);
    });
    maxScale = minScale;
    let radius;
    if (pts.length) {
      radius = Math.round(Math.max(160, bh * 1.9));
    } else {
      const fr = document.querySelector('.board-frame');
      const r = fr ? fr.getBoundingClientRect() : null;
      if (r && r.width > 2) {
        // чуть внутрь от углов: у края экрана половина свечения пропала бы
        pts.push({ x: r.left + 46, y: r.top + 6, w: 22 }, { x: r.right - 46, y: r.top + 6, w: 22 });
      }
      radius = 170;
    }
    sources = pts;
    const a = pts[0] || { x: -999, y: -999 };
    const b = pts[1] || a;
    light.style.setProperty('--l1x', a.x + 'px');
    light.style.setProperty('--l1y', a.y + 'px');
    light.style.setProperty('--l2x', b.x + 'px');
    light.style.setProperty('--l2y', b.y + 'px');
    light.style.setProperty('--lr', radius + 'px');

    // Холст — по видимой области без полосы прокрутки
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const de = document.documentElement;
    const w = Math.round((de.clientWidth || window.innerWidth) * dpr);
    const h = Math.round((de.clientHeight || window.innerHeight) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function relayout() {
    fitBraziers();
    measure();
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

  function setFlareLook(b, op, sc) {
    if (b.flareLayer && b.op !== op) { b.op = op; b.flareLayer.style.opacity = op; }
    if (b.fire && b.sc !== sc) { b.sc = sc; b.fire.style.setProperty('--flare-scale', sc); }
  }

  /* ---------- Вспышка ----------
     Время вспышки, искр и мерцания — свои часы `clock`, они идут только
     пока цикл работает. */
  let clock = 0;
  let flareStart = -1e9;
  let flareStrength = 0;
  let lastFlareAt = -1e9;
  const flareTotal = L.attackMs + L.holdMs + L.releaseMs;

  function flareLevel() {
    return FC.envelope(clock - flareStart, flareStrength);
  }

  function triggerFlare(strength) {
    // На паузе события не копятся: иначе вспышка проиграла бы потом
    if (!(strength > 0) || paused()) return;
    const cur = flareLevel();
    if (cur >= strength) return;  // идущая вспышка не слабее — не трогаем
    // Не чаще одной вспышки в 250 мс; более сильная (спецкамень в том же
    // шаге каскада) всё равно проходит — она только поднимает яркость
    const active = clock - flareStart < flareTotal;
    if (clock - lastFlareAt < L.throttleMs && !(active && strength > flareStrength)) return;
    lastFlareAt = clock;
    flareStrength = strength;
    // Начинаем с того места проявления, где огибающая уже равна текущей,
    // чтобы яркость не прыгала вниз
    const k = Math.min(1, cur / strength);
    flareStart = clock - L.attackMs * Math.acos(1 - 2 * k) / Math.PI;
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
  let burstWindowAt = -1e9;
  let burstInWindow = 0;

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
    if (low || isReduced() || !sources.length || paused()) return;
    // Не больше sparksMax искр на одно окно 250 мс (ряд, удар и спецкамень
    // одного шага каскада приходят вместе)
    if (clock - burstWindowAt >= L.throttleMs) { burstWindowAt = clock; burstInWindow = 0; }
    const k = Math.min(n, L.sparksMax - burstInWindow);
    if (k <= 0) return;
    burstInWindow += k;
    for (let i = 0; i < k; i++) spawn(sources[i % sources.length], true);
    wake();
  }

  function stepSparks(dt, idle) {
    if (idle && !low && sources.length) {
      if (nextIdle.length !== sources.length) nextIdle = sources.map(() => clock + rand(400, 2500));
      sources.forEach((src, i) => {
        if (clock >= nextIdle[i]) {
          spawn(src, false);
          nextIdle[i] = clock + rand(1500, 3000);
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
  function clearSparks() {
    sparks.length = 0;
    if (canvasDirty) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    canvasDirty = false;
  }
  function drawSparks(fade) {
    if (!sparks.length && !canvasDirty) return;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    canvasDirty = sparks.length > 0;
    ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.globalAlpha = fade;
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
    ctx2d.globalAlpha = 1;
  }

  /* ---------- Спокойное состояние (пауза, reduced motion) ---------- */
  let flaring = false;
  let lightOp = '';
  function setLight(v) {
    const s = v.toFixed(3);
    if (s !== lightOp) { lightOp = s; light.style.opacity = s; }
  }
  function settle() {
    flareStrength = 0;
    flareStart = -1e9;
    braziers.forEach(b => {
      setFlareLook(b, '0', '1');
      delete b.el.dataset.flare;
    });
    flaring = false;
    clearSparks();
    setLight(GLOW_BASE);
  }

  /* ---------- Цикл ---------- */
  let raf = 0;
  let lastTs = 0;
  let fireT = 0;
  let urgSpeed = 1;
  let frames = 0;
  let frameTimes = [];
  let lowCheckAt = 0;
  // Мерцание по тревоге: спокойно — мягче, при нехватке времени — до предела
  const FLICKER_GAIN = { '': 0.6, tense: 0.8, urgent: 1 };

  function paused() {
    return document.hidden || !!document.querySelector('.overlay.show');
  }

  /* Открылся оверлей: огонь не обрывается за кадр, а за то же время, что
     проявляется оверлей (0,3 с), плавно сходит к спокойному горению. */
  const PAUSE_FADE_MS = 320;
  let pauseAt = 0;

  function tick(ts) {
    raf = 0;
    if (isReduced()) {
      lastTs = 0;
      settle();
      return;
    }
    let fade = 1;
    if (paused()) {
      if (!pauseAt) pauseAt = ts;
      fade = 1 - (ts - pauseAt) / PAUSE_FADE_MS;
      if (fade <= 0 || document.hidden) {
        pauseAt = 0;
        lastTs = 0;
        settle();
        return;
      }
    } else {
      pauseAt = 0;
    }
    // Слабый режим: цикл 12 раз в секунду
    if (low && lastTs && ts - lastTs < LOW_STEP_MS) {
      raf = requestAnimationFrame(tick);
      return;
    }
    // Шаг не больше 250 мс: при редких кадрах (слабый компьютер) часы
    // не отстают, а после зависания огонь не прыгает далеко вперёд
    const dt = lastTs ? Math.min(250, ts - lastTs) : 0;
    lastTs = ts;
    clock += dt;
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

    const urgency = body.dataset.urgency || '';
    const target = FC.speedFor(urgency);
    urgSpeed += (target - urgSpeed) * Math.min(1, dt / 270);
    const e = flareLevel() * fade;
    fireT += dt * urgSpeed * FC.flareSpeed(e);
    braziers.forEach(b => showFrame(b, FC.frameAt(fireT, S, 1, b.phase)));

    const on = e > 0.01;
    const op = on ? e.toFixed(3) : '0';
    const sc = on ? (1 + (maxScale - 1) * e).toFixed(4) : '1';
    braziers.forEach(b => {
      setFlareLook(b, op, sc);
      if (on !== flaring) {
        if (on) b.el.dataset.flare = '1';
        else delete b.el.dataset.flare;
      }
    });
    flaring = on;

    const fl = low ? 0 : FC.flicker(clock / 1000, 1) * (FLICKER_GAIN[urgency] || FLICKER_GAIN['']) * fade;
    setLight(FC.glow(GLOW_BASE, e, fl));

    stepSparks(dt, fade === 1);
    drawSparks(Math.max(0, fade));
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
      settle();
      braziers.forEach(b => showFrame(b, 0));
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
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    measure();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { relayout(); wake(); }, 120);
  });
  // Высота табличек зависит от шрифта: подогнать ещё раз, когда он загрузится
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  // Слои света и искр закреплены (fixed): при прокрутке страницы
  // (очень низкое окно) точки огня пересчитать
  window.addEventListener('scroll', () => measure(), { passive: true });
  if (reduceMq) {
    if (reduceMq.addEventListener) reduceMq.addEventListener('change', applyReduced);
    else if (reduceMq.addListener) reduceMq.addListener(applyReduced);
  }

  relayout();
  braziers.forEach(b => showFrame(b, FC.frameAt(0, S, 1, b.phase)));
  setLight(GLOW_BASE);
  applyReduced();

  /* ---------- Отладка (для тестов, только с ?debug) ---------- */
  if (new URLSearchParams(location.search).has('debug')) {
    window.__FIRE = {
      get frames() { return frames; },
      flare: s => { lastFlareAt = -1e9; triggerFlare(s); },
      relayout,
      state: () => ({
        running: !!raf,
        speed: urgSpeed,
        flare: flareLevel(),
        maxScale,
        low,
        reduced: isReduced(),
        sparks: sparks.length,
        braziers: body.dataset.braziers !== 'off',
        flareTotal
      })
    };
  }
})();
