/* Живой фон земли (этап 2, шаг 3): водопад, луна, облака, светлячки.
   Игровую логику не трогает: слушает body[data-fx], body.has-backdrop
   (ставит js/visuals.js), оверлеи и document.hidden.
   Решения (режим, мерцание, свободные места, полёт и перерождение
   светлячков) — в js/backdrop-core.js, здесь только DOM.

   Backdrop.build(layer, land, onReady) строит слои внутри слоя темы
   .theme-bg (его создаёт js/visuals.js): .bd-stage (плита, водопад, туман)
   и .bd-sky (луна с ореолом, облака). onReady — когда загрузилась плита.
   Светлячки — один общий холст .bd-flies в .jungle, рисуются только пока
   активна земля с живым фоном (body.has-backdrop).

   Режим body[data-bd] (BackdropCore.modeFor):
     run    — всё движется;
     paused — вкладка скрыта, открыт любой .overlay.show или идёт отсчёт
              «3, 2, 1» перед уровнем (.countdown, он размывает фон);
     still  — prefers-reduced-motion или телефон (те же условия, что прячут
              жаровни в css/fire.css): картина стоит, светлячков нет.
   Слабый компьютер body[data-fx="low"] (ставит js/visuals-fire.js):
   светлячков нет, остальное идёт. */
(function () {
  "use strict";

  const BC = window.BackdropCore;
  const host = document.querySelector(".jungle");
  if (!BC || !host) return;

  const body = document.body;
  const F = BC.FIREFLY;

  /* Пути в custom properties — абсолютные: относительный url() внутри var()
     браузеры разрешают по-разному (от документа или от css/backdrop.css). */
  const abs = p => new URL(p, document.baseURI).href;
  const cssUrl = p => 'url("' + abs(p) + '")';

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  const pct = v => (v * 100).toFixed(4) + "%";

  /* ---------- Слои ---------- */
  function build(layer, land, onReady) {
    const b = land.backdrop;
    layer.setAttribute("aria-hidden", "true");
    const water = !!(b.waterfall && b.wf);   // у земли без воды (земля 2) струй, маски и тумана нет
    if (water) {
      layer.style.setProperty("--bd-tex", cssUrl(b.water));
      // Маска — data: URI из assets/backdrop/landN/water-mask.js, если он подключён:
      // CSS-маску с file:// Chromium и WebKit не грузят (запрос маски идёт с CORS)
      const maskData = window.BACKDROP_DATA && window.BACKDROP_DATA[b.mask];
      layer.style.setProperty("--bd-mask", maskData ? 'url("' + maskData + '")' : cssUrl(b.mask));
      // Высота плитки струй — доля высоты сцены (высота сцены — как в css/backdrop.css)
      layer.style.setProperty("--bd-tile", "calc(max(100vh, 56.27vw) * " + b.tile + ")");
    }
    layer.style.setProperty("--bd-clouds", cssUrl(b.clouds));

    const stage = el("div", "bd-stage");
    stage.setAttribute("aria-hidden", "true");
    const plate = el("img", "bd-plate");
    plate.alt = "";
    plate.decoding = "async";
    plate.onload = function () { if (onReady) onReady(); };
    plate.src = b.plate;
    stage.appendChild(plate);

    if (water) {
      const g = b.wf;
      const wf = el("div", "bd-wf");
      wf.style.left = pct(g.x);
      wf.style.top = pct(g.y);
      wf.style.width = pct(g.w);
      wf.style.height = pct(g.h);
      wf.appendChild(el("div", "bd-water bd-water-a bd-anim"));
      wf.appendChild(el("div", "bd-water bd-water-b bd-anim"));
      stage.appendChild(wf);
      // Туман у подножия: шире водопада, низ — по низу воды
      const mist = el("div", "bd-mist bd-anim");
      mist.style.left = pct(g.x - g.w * 0.6);
      mist.style.top = pct(g.y + g.h - 0.14);
      mist.style.width = pct(g.w * 2.6);
      mist.style.height = "22%";
      stage.appendChild(mist);
    }

    const sky = el("div", "bd-sky");
    sky.setAttribute("aria-hidden", "true");
    const moonWrap = el("div", "bd-moon-wrap");
    moonWrap.appendChild(el("div", "bd-halo bd-anim"));
    const moon = el("img", "bd-moon");
    moon.alt = "";
    moon.src = b.moon;
    moonWrap.appendChild(moon);
    sky.appendChild(moonWrap);
    const clouds = el("div", "bd-clouds");
    clouds.appendChild(el("div", "bd-cloud-track bd-anim"));
    sky.appendChild(clouds);

    layer.appendChild(stage);
    layer.appendChild(sky);
    refresh();
  }

  /* ---------- Светлячки ---------- */
  const canvas = el("canvas", "bd-flies");
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  /* Занятые места: таблички, кнопки, рамка поля, жаровни, круг Камня с
     подписью земли, подсказка, значок серии. Тот же список берёт e2e (__BD). */
  const BUSY = ".hud-plaque, .plate-btn, .board-frame, .brazier-bowl, .brazier-fire, .sun-stone, .sun-stone-caption, .hint-bar, .combo-badge";
  let W = 0;
  let H = 0;
  let busy = [];
  // Светлячок или null (места не нашлось — пробуем раз в секунду)
  const flies = [];
  for (let i = 0; i < F.count; i++) flies.push(null);
  let retryAt = 0;

  let raf = 0;
  let last = 0;
  let clock = 0;
  let frames = 0;

  const born = () => BC.newFly(busy, W, H, clock, Math.random);

  /* Холст — по видимой области, занятые места — по таблицам и кнопкам.
     Светлячок на занятом месте или за границами перерождается. */
  function measure() {
    const de = document.documentElement;
    W = de.clientWidth || window.innerWidth;
    H = de.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    busy = [];
    document.querySelectorAll(BUSY).forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) busy.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    });
    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      if (!f || !BC.flyFits(busy, W, H, f.x, f.y)) flies[i] = born();
    }
  }

  function clear() {
    ctx.clearRect(0, 0, W, H);
  }

  function draw(f, alpha) {
    const R = f.r * F.glow;
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, R);
    g.addColorStop(0, "rgba(255,246,190," + alpha.toFixed(3) + ")");
    g.addColorStop(0.25, "rgba(230,240,140," + (alpha * 0.55).toFixed(3) + ")");
    g.addColorStop(1, "rgba(200,230,120,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, R, 0, Math.PI * 2);
    ctx.fill();
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    // Шаг не больше 50 мс: после простоя светлячки не прыгают
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    clock += dt;
    frames++;
    clear();
    const retry = clock >= retryAt;
    if (retry) retryAt = clock + 1;
    for (let i = 0; i < flies.length; i++) {
      let f = flies[i];
      if (!f) {
        if (!retry) continue;
        f = born();
        if (!f) continue;
      } else {
        // Полёт, разворот у занятых мест и краёв, перерождение в тусклый момент
        f = BC.stepFly(f, clock, dt, busy, W, H, Math.random);
      }
      flies[i] = f;
      if (f) draw(f, BC.fireflyAlpha(clock, f.p, f.ph));
    }
  }

  /* ---------- Режим ---------- */
  const mq = q => (window.matchMedia ? window.matchMedia(q) : null);
  const reduceMq = mq("(prefers-reduced-motion: reduce)");
  // Как в css/fire.css («Телефон и альбомный телефон»)
  const phoneMqs = [
    mq("(max-width: 900px) and (orientation: portrait), (max-width: 900px) and (min-height: 501px)"),
    mq("(orientation: landscape) and (max-height: 500px)")
  ];

  let mode = "";
  function refresh() {
    const m = BC.modeFor({
      hidden: document.hidden,
      overlay: !!document.querySelector(".overlay.show, .countdown:not(.hidden)"),
      reduced: !!(reduceMq && reduceMq.matches),
      phone: phoneMqs.some(q => q && q.matches)
    });
    if (m !== mode) {
      mode = m;
      body.dataset.bd = m;
    }
    const active = body.classList.contains("has-backdrop") && !!host.querySelector(".theme-bg.on .bd-stage");
    const want = active && BC.fliesOn(mode, body.dataset.fx === "low");
    if (want && !raf) {
      measure();
      last = 0;
      raf = requestAnimationFrame(tick);
    } else if (!want) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clear();
    }
  }

  function relayout() {
    measure();
    refresh();
  }

  const overlayObs = new MutationObserver(relayout);
  document.querySelectorAll(".overlay, .countdown").forEach(o => overlayObs.observe(o, { attributes: true, attributeFilter: ["class"] }));
  new MutationObserver(refresh).observe(body, { attributes: true, attributeFilter: ["class", "data-fx"] });
  document.addEventListener("visibilitychange", refresh);
  [reduceMq].concat(phoneMqs).forEach(q => {
    if (!q) return;
    if (q.addEventListener) q.addEventListener("change", refresh);
    else if (q.addListener) q.addListener(refresh);
  });
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 120);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  /* Жаровни подгоняются под окно после resize (js/visuals-fire.js), подсказка
     меняет длину, табличка появляется — занятые места пересчитываем и тогда */
  if (window.ResizeObserver) {
    let roPending = 0;
    const ro = new ResizeObserver(() => {
      if (roPending) return;
      roPending = requestAnimationFrame(() => { roPending = 0; measure(); });
    });
    document.querySelectorAll(BUSY).forEach(e => ro.observe(e));
  }

  measure();
  refresh();

  window.Backdrop = { build };

  /* ---------- Отладка (для тестов, только с ?debug) ---------- */
  if (new URLSearchParams(location.search).has("debug")) {
    window.__BD = {
      get frames() { return frames; },
      get mode() { return mode; },
      // Только те, что сейчас рисуются: без цикла (пауза, still, земля без фона) — пусто
      flies: () => (raf ? flies.filter(Boolean).map(f => ({ x: f.x, y: f.y })) : []),
      busy: () => busy.map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
      busySelector: BUSY
    };
  }
})();
