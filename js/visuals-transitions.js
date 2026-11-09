/* Хранитель Солнца — переходы между экранами (этап 2, шаг 6).
 * Только оформление: классы .show и логику экранов не трогает и игру не ждёт.
 * Tx.veil() — затухание через тьму при смене экрана во всю ширину
 * (стили и тайминги — css/transitions.css).
 * Tx.reduced() читает настройку заново: MediaQueryList, который держат
 * с загрузки, в Firefox отстаёт (см. Fx.mode). */
(() => {
  'use strict';

  const VEIL_MS = 640;
  let node = null;
  let timer = 0;

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function veil() {
    if (reduced()) return;
    const body = document.body;
    if (body.dataset.tx === 'dip') return;
    if (!node) {
      node = document.createElement('div');
      node.className = 'screen-veil';
      node.setAttribute('aria-hidden', 'true');
      body.appendChild(node);
    }
    body.dataset.tx = 'dip';
    node.classList.add('go');
    clearTimeout(timer);
    timer = setTimeout(() => {
      delete body.dataset.tx;
      node.classList.remove('go');
    }, VEIL_MS);
  }

  window.Tx = { veil, reduced };

  /* Стартовая карточка при загрузке въезжает своей анимацией; дальше —
     общей плитой из css/transitions.css */
  window.addEventListener('load', () => {
    setTimeout(() => { document.body.dataset.txReady = '1'; }, 800);
  });
})();
