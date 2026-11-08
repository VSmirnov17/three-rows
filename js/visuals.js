/* Темы земель: подгружает фон нужной земли (land.bg из кампании) и плавно
   переключает слои. Следит только за body[data-land]; игровую логику не трогает.
   У земли с живым фоном (land.backdrop) слой заполняет Backdrop.build
   (js/visuals-backdrop.js), а body.has-backdrop говорит, что он активен. */
(function () {
  "use strict";

  const host = document.querySelector(".jungle");
  if (!host || !window.Campaign) return;

  /* Номер земли -> файл фона */
  const FILES = {};
  const LANDS = {};
  const ORDER = [];
  window.Campaign.lands().forEach(function (land) {
    if (!land.bg) return;
    FILES[land.id] = land.bg;
    LANDS[land.id] = land;
    ORDER.push(land.id);
  });

  const live = id => !!(LANDS[id].backdrop && window.Backdrop);
  if (!ORDER.length) return;

  const layers = {};

  function currentLand() {
    const n = Number(document.body.dataset.land);
    return FILES[n] ? n : ORDER[0];
  }

  function apply() {
    const cur = currentLand();
    Object.keys(layers).forEach(function (id) {
      const el = layers[id];
      el.classList.toggle("on", Number(id) === cur && el.classList.contains("ready"));
    });
    const ready = layers[cur] && layers[cur].classList.contains("ready");
    document.body.classList.toggle("has-theme", !!ready);
    document.body.classList.toggle("has-backdrop", !!ready && live(cur));
  }

  /* Картинку грузим только когда она нужна; слой появляется после onload,
     поэтому до загрузки виден прежний фон, а не пустота. */
  function ensure(id) {
    if (layers[id]) return;
    const el = document.createElement("div");
    el.className = "theme-bg";
    el.dataset.theme = String(id);
    host.insertBefore(el, host.firstChild);
    layers[id] = el;

    const ready = function () {
      el.classList.add("ready");
      apply();
    };
    /* Живой фон: слой готов, когда загрузилась плита */
    if (live(id)) {
      window.Backdrop.build(el, LANDS[id], ready);
      return;
    }

    const img = new Image();
    img.onload = function () {
      el.style.backgroundImage = 'url("' + FILES[id] + '")';
      ready();
    };
    img.src = FILES[id];
  }

  function sync() {
    const cur = currentLand();
    ensure(cur);
    apply();
    /* Фон следующей земли подгружаем заранее, в простое */
    const next = ORDER[ORDER.indexOf(cur) + 1];
    if (next !== undefined) {
      const preload = function () { ensure(next); };
      if (window.requestIdleCallback) window.requestIdleCallback(preload, { timeout: 4000 });
      else setTimeout(preload, 2500);
    }
  }

  new MutationObserver(sync).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-land"]
  });

  sync();
})();
