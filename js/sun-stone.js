/* Хранитель Солнца — круг Солнечного Камня: осколки уровней текущей главы.
 *
 * segments() — чистая логика без DOM (работает в Node).
 * render()   — рисует основу (картинка) и кольцо секторов (SVG) внутри host.
 *              DOM трогается только здесь, через host.ownerDocument.
 * Раскраску делает CSS по классам: sun-seg, tier-stone|tier-silver|tier-gold,
 * empty, current; градиенты sunSegStone/Silver/Gold лежат в <defs>.
 */
(function (factory) {
  'use strict';

  const SunStone = factory();

  if (typeof window !== 'undefined') window.SunStone = SunStone;
  if (typeof module !== 'undefined' && module.exports) module.exports = SunStone;
})(function () {
  'use strict';

  /* Размеры кольца в системе координат viewBox 0 0 200 200;
   * измерены на утверждённом арте (art-src/phase2/PROMPTS.md). */
  const R_IN = 54;
  const R_OUT = 83;
  const CENTER = 100;
  const GAP_DEG = 1.5;
  const BASE_SRC = 'assets/ui/sun-stone.webp';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const GRADIENTS = [
    { id: 'sunSegStone', from: '#c9b38f', to: '#7a6448' },
    { id: 'sunSegSilver', from: '#f1f1ea', to: '#9aa3a8' },
    { id: 'sunSegGold', from: '#ffe08a', to: '#c8901e' }
  ];

  function getProgress() {
    if (typeof window !== 'undefined' && window.Progress) return window.Progress;
    if (typeof require === 'function') return require('./campaign/progress.js');
    return null;
  }

  /* Осколки земли: по одному значению на уровень, в порядке уровней.
   * Никогда не бросает исключений. */
  function segments(save, land) {
    const levels = land && land.levels;
    if (!Array.isArray(levels)) return [];
    let Progress = null;
    try { Progress = getProgress(); } catch (e) { Progress = null; }
    return levels.map(function (level) {
      try {
        const tier = Progress && level ? Progress.fragmentTier(save, level.id) : null;
        return tier === 'stone' || tier === 'silver' || tier === 'gold' ? tier : null;
      } catch (e) {
        return null;
      }
    });
  }

  function point(r, deg) {
    const a = deg * Math.PI / 180;
    return (CENTER + r * Math.cos(a)).toFixed(2) + ' ' + (CENTER + r * Math.sin(a)).toFixed(2);
  }

  /* Сектор i из n: две дуги и два отрезка; старт на -90° (сверху), по часовой. */
  function sectorPath(i, n) {
    const step = 360 / n;
    const a0 = -90 + i * step + GAP_DEG;
    const a1 = -90 + (i + 1) * step - GAP_DEG;
    const large = a1 - a0 > 180 ? 1 : 0;
    return 'M ' + point(R_OUT, a0) +
      ' A ' + R_OUT + ' ' + R_OUT + ' 0 ' + large + ' 1 ' + point(R_OUT, a1) +
      ' L ' + point(R_IN, a1) +
      ' A ' + R_IN + ' ' + R_IN + ' 0 ' + large + ' 0 ' + point(R_IN, a0) +
      ' Z';
  }

  function render(host, segs, currentIndex) {
    const doc = host.ownerDocument;
    const list = Array.isArray(segs) ? segs : [];
    const n = list.length;

    host.textContent = '';

    const img = doc.createElement('img');
    img.setAttribute('class', 'sun-stone-base');
    img.setAttribute('src', BASE_SRC);
    img.setAttribute('alt', '');
    host.appendChild(img);

    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sun-stone-ring');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('aria-hidden', 'true');

    const defs = doc.createElementNS(SVG_NS, 'defs');
    GRADIENTS.forEach(function (g) {
      const rg = doc.createElementNS(SVG_NS, 'radialGradient');
      rg.setAttribute('id', g.id);
      rg.setAttribute('cx', '50%');
      rg.setAttribute('cy', '50%');
      rg.setAttribute('r', '50%');
      [[0, g.from], [100, g.to]].forEach(function (s) {
        const stop = doc.createElementNS(SVG_NS, 'stop');
        stop.setAttribute('offset', s[0] + '%');
        stop.setAttribute('stop-color', s[1]);
        rg.appendChild(stop);
      });
      defs.appendChild(rg);
    });
    svg.appendChild(defs);

    let lit = 0;
    list.forEach(function (tier, i) {
      if (tier) lit++;
      const path = doc.createElementNS(SVG_NS, 'path');
      let cls = 'sun-seg ' + (tier ? 'tier-' + tier : 'empty');
      if (i === currentIndex) cls += ' current';
      path.setAttribute('class', cls);
      path.setAttribute('d', sectorPath(i, n));
      svg.appendChild(path);
    });
    host.appendChild(svg);

    host.setAttribute('aria-label', 'Осколки главы: ' + lit + ' из ' + n);
  }

  return { segments, render, R_IN, R_OUT };
});
