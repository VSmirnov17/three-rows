/* Эффекты и экраны: комбо, карточка уровня, победа и поражение.
   Игровую логику не трогает: слушает body[data-*], события sun:* и
   наблюдает за #countdown / #endScreen через MutationObserver. */
(function () {
  "use strict";

  const LEVEL_NAMES = ['Тропа Ягуара', 'Храм Пернатого Змея', 'Пещера Лунного Света', 'Золотое Солнце'];
  const GEM_COUNT = 6;
  const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(reduceMq && reduceMq.matches);
  const $ = id => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);

  /* Перезапуск CSS-анимации: снять класс, форсировать reflow, вернуть */
  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function tierOf(mult) {
    if (mult >= 8) return 'max';
    if (mult >= 6) return 'fire';
    return 'gold';
  }

  /* ---------- Экранный слой: виньетка и вспышка ---------- */
  const screen = document.createElement('div');
  screen.className = 'sfx-screen';
  screen.setAttribute('aria-hidden', 'true');
  const vignette = document.createElement('div');
  vignette.className = 'sfx-vignette';
  const flash = document.createElement('div');
  flash.className = 'sfx-flash';
  screen.append(vignette, flash);
  document.body.appendChild(screen);

  [vignette, flash].forEach(el => el.addEventListener('animationend', () => el.classList.remove('go')));

  /* ---------- 1. Комбо ---------- */
  let lastMatchFx = 0;
  let wordEl = null;
  let wordTimer = 0;
  let punchTimer = 0;

  function showComboWord(mult) {
    const area = document.querySelector('.board-area');
    if (!area || reduced()) return;
    if (wordEl) wordEl.remove();
    clearTimeout(wordTimer);
    const el = document.createElement('div');
    el.className = 'sfx-combo-word';
    el.dataset.tier = tierOf(mult);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<b>×' + mult + '</b><i>КОМБО!</i>';
    area.appendChild(el);
    wordEl = el;
    const drop = () => {
      el.remove();
      if (wordEl === el) wordEl = null;
    };
    el.addEventListener('animationend', drop, { once: true });
    wordTimer = setTimeout(drop, 1400);
  }

  function punchBoard(mult) {
    const frame = document.querySelector('.board-frame');
    if (!frame || reduced()) return;
    frame.classList.toggle('sfx-punch-big', mult >= 6);
    replay(frame, 'sfx-punch');
    clearTimeout(punchTimer);
    punchTimer = setTimeout(() => frame.classList.remove('sfx-punch', 'sfx-punch-big'), 420);
  }

  window.addEventListener('sun:match', e => {
    const mult = Number(e.detail && e.detail.mult) || 1;
    if (mult < 3) return;
    // каскады идут часто — не чаще одного эффекта за 250 мс
    const t = performance.now();
    if (t - lastMatchFx < 250) return;
    lastMatchFx = t;
    showComboWord(mult);
    if (mult >= 4 && !reduced()) {
      vignette.dataset.tier = tierOf(mult);
      replay(vignette, 'go');
      punchBoard(mult);
    }
  });

  window.addEventListener('sun:blast', e => {
    if (!e.detail || e.detail.type !== 'sun' || reduced()) return;
    replay(flash, 'go');
  });

  /* Подпрыгивание значка комбо при каждом росте множителя */
  const badge = $('comboBadge');
  let prevCombo = Number(document.body.dataset.combo) || 1;
  new MutationObserver(() => {
    const c = Number(document.body.dataset.combo) || 1;
    if (c > prevCombo && c > 1 && badge) {
      replay(badge, 'sfx-bump');
    }
    prevCombo = c;
  }).observe(document.body, { attributes: true, attributeFilter: ['data-combo'] });
  if (badge) badge.addEventListener('animationend', ev => {
    if (ev.animationName === 'sfxBadgeBump') badge.classList.remove('sfx-bump');
  });

  /* ---------- 2. Карточка уровня у обратного отсчёта ---------- */
  const countdown = $('countdown');
  const countdownNum = $('countdownNum');
  const banner = document.createElement('div');
  banner.className = 'sfx-level-banner';
  banner.setAttribute('aria-hidden', 'true');
  banner.innerHTML = '<span class="sfx-lb-kicker"></span><span class="sfx-lb-name"></span><span class="sfx-lb-rule"></span>';
  document.body.appendChild(banner);
  const bannerKicker = banner.querySelector('.sfx-lb-kicker');
  const bannerName = banner.querySelector('.sfx-lb-name');
  let bannerShown = false;

  function showBanner() {
    const idx = Math.max(0, Math.min(LEVEL_NAMES.length - 1, Number(document.body.dataset.level) || 0));
    bannerKicker.textContent = 'Уровень ' + (idx + 1);
    bannerName.textContent = LEVEL_NAMES[idx];
    banner.classList.remove('out');
    replay(banner, 'in');
    bannerShown = true;
  }

  function leaveBanner() {
    if (!bannerShown) return;
    banner.classList.remove('in');
    replay(banner, 'out');
  }

  function hideBanner() {
    banner.classList.remove('in', 'out');
    bannerShown = false;
  }

  banner.addEventListener('animationend', ev => {
    if (ev.animationName === 'sfxBannerOut') hideBanner();
  });

  if (countdown) {
    let wasHidden = countdown.classList.contains('hidden');
    new MutationObserver(() => {
      const hidden = countdown.classList.contains('hidden');
      if (hidden === wasHidden) return;
      wasHidden = hidden;
      if (!hidden) showBanner();
      else if (banner.classList.contains('in')) hideBanner(); // отсчёт прерван
    }).observe(countdown, { attributes: true, attributeFilter: ['class'] });
  }

  if (countdownNum) {
    new MutationObserver(() => {
      if (countdownNum.classList.contains('word')) leaveBanner();
    }).observe(countdownNum, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- 3. Экран итогов ---------- */
  const endScreen = $('endScreen');
  const endCard = endScreen && endScreen.querySelector('.end-card');
  const endEmblem = $('endEmblem');
  const endSub = $('endSub');
  let cleanupTimer = 0;
  let countRaf = 0;
  let countItems = [];
  let confettiLayer = null;
  let burstLayer = null;
  let ashLayer = null;

  if (endEmblem && !endEmblem.querySelector('.sfx-rays')) {
    const rays = document.createElement('div');
    rays.className = 'sfx-rays';
    rays.setAttribute('aria-hidden', 'true');
    endEmblem.prepend(rays);
  }

  const gemSrc = i => 'assets/gems/gem-' + (i % GEM_COUNT) + '.png';

  function makeGem(extra) {
    const g = document.createElement('i');
    g.className = 'sfx-gem';
    g.style.backgroundImage = 'url("' + gemSrc(Math.floor(Math.random() * GEM_COUNT)) + '")';
    Object.keys(extra).forEach(k => g.style.setProperty(k, extra[k]));
    return g;
  }

  function spawnConfetti() {
    confettiLayer = document.createElement('div');
    confettiLayer.className = 'sfx-confetti';
    confettiLayer.setAttribute('aria-hidden', 'true');
    const fall = 14;
    for (let i = 0; i < fall; i++) {
      const g = makeGem({
        '--s': Math.round(rand(22, 40)) + 'px',
        '--d': rand(2.4, 3.4).toFixed(2) + 's',
        '--delay': rand(0, .9).toFixed(2) + 's',
        '--dx': Math.round(rand(-90, 90)) + 'px',
        '--rot': Math.round(rand(-540, 540)) + 'deg'
      });
      g.style.left = ((i + rand(.1, .9)) / fall * 100).toFixed(1) + '%';
      confettiLayer.appendChild(g);
    }
    endScreen.prepend(confettiLayer);

    if (endEmblem) {
      burstLayer = document.createElement('div');
      burstLayer.className = 'sfx-burst';
      burstLayer.setAttribute('aria-hidden', 'true');
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-.2, .2);
        const r = rand(110, 170);
        burstLayer.appendChild(makeGem({
          '--s': Math.round(rand(20, 30)) + 'px',
          '--dx': Math.round(Math.cos(a) * r) + 'px',
          '--dy': Math.round(Math.sin(a) * r) + 'px',
          '--rot': Math.round(rand(-360, 360)) + 'deg',
          '--delay': rand(.15, .3).toFixed(2) + 's'
        }));
      }
      endEmblem.appendChild(burstLayer);
    }
  }

  function spawnAsh() {
    ashLayer = document.createElement('div');
    ashLayer.className = 'sfx-ash';
    ashLayer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 22; i++) {
      const p = document.createElement('i');
      p.style.left = rand(0, 100).toFixed(1) + '%';
      p.style.setProperty('--s', rand(2, 5).toFixed(1) + 'px');
      p.style.setProperty('--d', rand(7, 12).toFixed(1) + 's');
      p.style.setProperty('--delay', (-rand(0, 10)).toFixed(1) + 's');
      p.style.setProperty('--dx', Math.round(rand(-60, 60)) + 'px');
      p.style.setProperty('--o', rand(.25, .65).toFixed(2));
      ashLayer.appendChild(p);
    }
    endScreen.prepend(ashLayer);
  }

  function clearEndFx() {
    clearTimeout(cleanupTimer);
    cancelAnimationFrame(countRaf);
    // точные значения, если подсчёт прервали
    countItems.forEach(it => { it.el.textContent = it.original; });
    countItems = [];
    [confettiLayer, burstLayer, ashLayer].forEach(l => l && l.remove());
    confettiLayer = burstLayer = ashLayer = null;
  }

  /* Звёзды и ранг из подзаголовка — отдельной строкой */
  function buildRank(win) {
    const old = endCard.querySelector('.sfx-rank');
    if (old) old.remove();
    if (!win || !endSub) return;
    const text = endSub.textContent;
    const m = text.match(/[★☆]{1,5}/);
    if (!m) return;
    const rankName = text.slice(m.index + m[0].length).trim();
    endSub.textContent = text.slice(0, m.index).replace(/[\s·]+$/, '');
    const row = document.createElement('div');
    row.className = 'sfx-rank';
    const stars = document.createElement('span');
    stars.className = 'sfx-stars';
    stars.setAttribute('role', 'img');
    const on = (m[0].match(/★/g) || []).length;
    stars.setAttribute('aria-label', on + ' из ' + m[0].length);
    for (const ch of m[0]) {
      const s = document.createElement('span');
      s.className = 'sfx-star' + (ch === '★' ? '' : ' off');
      s.textContent = '★';
      s.setAttribute('aria-hidden', 'true');
      stars.appendChild(s);
    }
    row.appendChild(stars);
    if (rankName) {
      const r = document.createElement('span');
      r.className = 'sfx-rank-name';
      r.textContent = rankName;
      row.appendChild(r);
    }
    endSub.after(row);
  }

  /* Набегающий счёт; в конце — точная исходная строка */
  function countUp(ids, delay) {
    if (reduced()) return;
    const items = ids.map(id => $(id)).filter(Boolean).map(el => {
      const original = el.textContent;
      const target = Number(original.replace(/[^\d]/g, '')) || 0;
      const prefix = original.trim().startsWith('+') ? '+' : '';
      return { el, original, target, prefix };
    }).filter(it => it.target > 0);
    if (!items.length) return;
    countItems = items;
    const fmt = n => Math.round(n).toLocaleString('ru-RU');
    items.forEach(it => { it.el.textContent = it.prefix + '0'; });
    const dur = 900;
    let start = 0;
    const step = t => {
      if (!start) start = t + delay;
      const k = Math.min(1, Math.max(0, (t - start) / dur));
      const e = 1 - Math.pow(1 - k, 3);
      items.forEach(it => {
        it.el.textContent = k >= 1 ? it.original : it.prefix + fmt(it.target * e);
      });
      if (k < 1) countRaf = requestAnimationFrame(step);
      else countItems = [];
    };
    countRaf = requestAnimationFrame(step);
  }

  function onEndShow() {
    clearEndFx();
    const win = !endCard.classList.contains('lost') && document.body.dataset.outcome !== 'lose';
    endCard.classList.remove('sfx-win', 'sfx-lose');
    endScreen.classList.toggle('sfx-lose-screen', !win);
    buildRank(win);
    void endCard.offsetWidth;
    endCard.classList.add(win ? 'sfx-win' : 'sfx-lose');
    if (reduced()) return;
    if (win) {
      spawnConfetti();
      countUp(['endScore', 'endBonus'], 550);
      cleanupTimer = setTimeout(() => {
        [confettiLayer, burstLayer].forEach(l => l && l.remove());
        confettiLayer = burstLayer = null;
      }, 4300);
    } else {
      spawnAsh();
    }
  }

  function onEndHide() {
    clearEndFx();
    endCard.classList.remove('sfx-win', 'sfx-lose');
    endScreen.classList.remove('sfx-lose-screen');
  }

  if (endScreen && endCard) {
    let wasShown = endScreen.classList.contains('show');
    new MutationObserver(() => {
      const shown = endScreen.classList.contains('show');
      if (shown === wasShown) return;
      wasShown = shown;
      if (shown) onEndShow();
      else onEndHide();
    }).observe(endScreen, { attributes: true, attributeFilter: ['class'] });
  }
})();
