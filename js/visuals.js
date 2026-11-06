/* Темы уровней: подгружает фон нужного уровня и плавно переключает слои.
   Следит только за body[data-level]; игровую логику не трогает. */
(function () {
  "use strict";

  const FILES = [
    "assets/art/bg-jaguar.webp",
    "assets/art/bg-temple.webp",
    "assets/art/bg-moon.webp",
    "assets/art/bg-sun.webp"
  ];

  const host = document.querySelector(".jungle");
  if (!host) return;

  const layers = [];

  function currentLevel() {
    const n = Number(document.body.dataset.level);
    return Number.isInteger(n) && n >= 0 && n < FILES.length ? n : 0;
  }

  function apply() {
    const cur = currentLevel();
    layers.forEach((el, i) => {
      if (el) el.classList.toggle("on", i === cur && el.classList.contains("ready"));
    });
    const ready = layers[cur] && layers[cur].classList.contains("ready");
    document.body.classList.toggle("has-theme", !!ready);
  }

  /* Картинку грузим только когда она нужна; слой появляется после onload,
     поэтому до загрузки виден прежний фон, а не пустота. */
  function ensure(index) {
    if (layers[index]) return;
    const el = document.createElement("div");
    el.className = "theme-bg";
    el.dataset.theme = String(index);
    host.insertBefore(el, host.firstChild);
    layers[index] = el;

    const img = new Image();
    img.onload = function () {
      el.style.backgroundImage = 'url("' + FILES[index] + '")';
      el.classList.add("ready");
      apply();
    };
    img.src = FILES[index];
  }

  function sync() {
    const cur = currentLevel();
    ensure(cur);
    apply();
    /* Следующий уровень подгружаем заранее, в простое */
    const next = cur + 1;
    if (next < FILES.length) {
      const preload = function () { ensure(next); };
      if (window.requestIdleCallback) window.requestIdleCallback(preload, { timeout: 4000 });
      else setTimeout(preload, 2500);
    }
  }

  new MutationObserver(sync).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-level"]
  });

  sync();
})();
