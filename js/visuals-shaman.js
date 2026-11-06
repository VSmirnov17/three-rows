/* Живой шаман: подписка на состояния body[data-combo|urgency|outcome] и события sun:*.
   Игровую логику не трогает.
   Строит вокруг готовой картинки (ART.shaman → img.shaman-img) «риг» из слоёв:
     .shaman-rig
       .shaman-shadow          статичная тень под постаментом
       .shaman-aura            золотое сияние позади фигуры
       .shaman-mood            долгие состояния (дыхание, дрожь, танец, уныние) — только CSS
         .shaman-react         разовые реакции (прыжок, ликование) — классы из JS
           img.shaman-img
           .shaman-orb         свечение сферы (+ .shaman-orb-hot, .shaman-orb-dim)
           .shaman-sparks > i  искры
   Разовые реакции снимаются сами по animationend (и по таймеру-страховке). */
(function () {
  "use strict";

  const SPARKS = [
    // смещение разлёта в процентах от размера искры
    { dx: -380, dy: -300 }, { dx: 380, dy: -330 }, { dx: -480, dy: 20 },
    { dx: 470, dy: 0 }, { dx: -200, dy: -520 }, { dx: 230, dy: -500 },
  ];

  let react = null;
  let timer = 0;

  function build(host) {
    const img = host.querySelector('.shaman-img');
    if (!img || host.querySelector('.shaman-rig')) return;

    const rig = document.createElement('div');
    rig.className = 'shaman-rig';
    rig.setAttribute('aria-hidden', 'true');
    rig.innerHTML =
      '<div class="shaman-shadow"></div>' +
      '<div class="shaman-aura"></div>' +
      '<div class="shaman-mood"><div class="shaman-react">' +
        '<div class="shaman-orb"></div><div class="shaman-orb-hot"></div><div class="shaman-orb-dim"></div>' +
        '<div class="shaman-sparks">' +
          SPARKS.map((s, i) => `<i style="--dx:${s.dx}%;--dy:${s.dy}%;--i:${i}"></i>`).join('') +
        '</div>' +
      '</div></div>';

    react = rig.querySelector('.shaman-react');
    react.insertBefore(img, react.firstChild);
    host.appendChild(rig);

    // Разовая реакция закончилась — возвращаемся к долгому состоянию
    react.addEventListener('animationend', (e) => {
      if (e.target === react) clear();
    });
  }

  function clear() {
    if (!react) return;
    clearTimeout(timer);
    react.classList.remove('is-hop', 'is-cheer');
  }

  function play(cls, ms) {
    if (!react) return;
    react.classList.remove('is-hop', 'is-cheer');
    void react.offsetWidth; // перезапуск анимации
    react.classList.add(cls);
    clearTimeout(timer);
    timer = setTimeout(clear, ms);
  }

  function onMatch(e) {
    if (!react || react.classList.contains('is-cheer')) return;
    const d = (e && e.detail) || {};
    const mult = Math.max(1, Math.min(8, Number(d.mult) || 1));
    // Высота прыжка растёт с множителем: 5% … ~16% высоты фигуры
    react.style.setProperty('--hop', String(5 + (mult - 1) * 1.6));
    play('is-hop', 700);
  }

  function onCheer() {
    play('is-cheer', 1400);
  }

  function init() {
    const host = document.getElementById('shamanArt');
    if (!host) return;
    build(host);
    // Если арт перерисуют (ART.init ещё раз), собираем риг заново
    new MutationObserver(() => build(host)).observe(host, { childList: true });
  }

  window.addEventListener('sun:match', onMatch);
  window.addEventListener('sun:special', onCheer);
  window.addEventListener('sun:blast', onCheer);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
