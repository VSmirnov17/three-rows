/* Сокровища Солнца — игра «три в ряд» */
(() => {
  'use strict';

  const ROWS = 8;
  const COLS = 8;
  const TYPES = 6;
  const GEM_COLORS = ['#ff7a5c', '#ffd166', '#6ef08a', '#63d8ff', '#d58cff', '#e8eef2'];
  const SAVE_KEY = 'sun-treasures-save';
  const DIAL_C = 345.575;

  const LEVELS = [
    {
      name: 'Тропа Ягуара',
      time: 120,
      goals: [{ color: 0, need: 12 }, { color: 2, need: 12 }]
    },
    {
      name: 'Храм Пернатого Змея',
      time: 130,
      goals: [{ color: 1, need: 14 }, { color: 3, need: 14 }, { color: 5, need: 9 }]
    },
    {
      name: 'Пещера Лунного Света',
      time: 140,
      goals: [{ color: 4, need: 18 }, { color: 2, need: 16 }]
    },
    {
      name: 'Золотое Солнце',
      time: 155,
      goals: [{ color: 0, need: 18 }, { color: 1, need: 18 }, { color: 4, need: 14 }]
    }
  ];

  const $ = id => document.getElementById(id);

  const dom = {
    board: $('board'),
    boardFrame: document.querySelector('.board-frame'),
    tiles: $('tiles'),
    fx: $('fx'),
    score: $('scoreValue'),
    level: $('levelValue'),
    time: $('timeValue'),
    dial: $('dialProgress'),
    dialTicks: $('dialTicks'),
    goalList: $('goalList'),
    relic: $('relicValue'),
    ladder: $('ladder'),
    ladderFill: $('ladderFill'),
    rungs: Array.from(document.querySelectorAll('.rung')),
    comboBadge: $('comboBadge'),
    hintBar: $('hintBar'),
    toast: $('toast'),
    shuffleBtn: $('shuffleBtn'),
    shuffleCd: $('shuffleCd'),
    soundIcon: $('soundIcon'),
    soundStartBtn: $('soundStartBtn'),
    startScreen: $('startScreen'),
    howScreen: $('howScreen'),
    pauseScreen: $('pauseScreen'),
    endScreen: $('endScreen'),
    countdown: $('countdown'),
    countdownNum: $('countdownNum'),
    endTitle: $('endTitle'),
    endSub: $('endSub'),
    endEmblem: $('endEmblem'),
    endScore: $('endScore'),
    endBonus: $('endBonus'),
    endTime: $('endTime'),
    endCard: document.querySelector('.end-card'),
    nextBtn: $('nextBtn'),
    retryBtn: $('retryBtn'),
    continueBtn: $('continueBtn'),
    bestScore: $('bestScore')
  };

  const state = {
    grid: [],
    gemSeq: 0,
    selected: null,
    dragStart: null,
    busy: true,
    running: false,
    paused: false,
    ended: false,
    timeUp: false,
    relaxed: true,
    overlay: true,
    levelIndex: 0,
    levelStartScore: 0,
    score: 0,
    best: 0,
    unlocked: 0,
    timeLeft: 120,
    totalTime: 120,
    goals: [],
    comboMult: 1,
    chain: 0,
    clearedTotal: 0,
    econBase: 0,
    econClear: 0,
    lastAction: 0,
    hintShown: false,
    shuffleCd: 0,
    lastTickSec: -1,
    soundOn: true,
    started: false,
    session: 0,
    swapCell: null
  };

  const now = () => performance.now();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const { parseKey } = window.BoardCore;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isAdjacent = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function fmtNum(n) {
    return Math.round(n).toLocaleString('ru-RU');
  }

  /* ---------- Мелкие эффекты интерфейса ---------- */
  let toastTimer = null;
  function showToast(text, ms = 1500) {
    dom.toast.textContent = text;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), ms);
  }

  let flashTimer = null;
  function flashHint(text, tone, ms = 2200) {
    setHint(text, tone);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      if (state.running && !state.ended && !state.paused) {
        setHint(currentLevel().name + ' — ' + hintMessages.default);
      }
    }, ms);
  }

  const hintMessages = {
    default: 'Соединяй камни в ряд из трёх и более',
    swap: 'Меняй местами соседние камни',
    bad: 'Так нельзя — нужен ряд из трёх',
    vines: 'Камень в лианах не сдвинуть — собери ряд вместе с ним'
  };

  function setHint(text, tone) {
    dom.hintBar.textContent = text;
    dom.hintBar.classList.remove('good', 'bad');
    if (tone) dom.hintBar.classList.add(tone);
  }

  function buildFireflies() {
    const host = $('fireflies');
    let html = '';
    for (let i = 0; i < 24; i++) {
      const x = Math.random() * 96 + 2;
      const y = Math.random() * 88 + 4;
      const dur = 7 + Math.random() * 8;
      const delay = -Math.random() * 12;
      const fx = (Math.random() * 50 - 25).toFixed(0);
      html += `<span class="firefly" style="left:${x}%;top:${y}%;--dur:${dur}s;--fx:${fx}px;animation-delay:${delay}s"></span>`;
    }
    host.innerHTML = html;
  }

  function buildDialTicks() {
    if (!dom.dialTicks) return;
    let html = '';
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const inner = i % 3 === 0 ? 58 : 60;
      const x1 = 65 + Math.cos(a) * inner;
      const y1 = 65 + Math.sin(a) * inner;
      const x2 = 65 + Math.cos(a) * 62;
      const y2 = 65 + Math.sin(a) * 62;
      html += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }
    dom.dialTicks.innerHTML = html;
  }

  /* ---------- Оверлеи ---------- */
  function syncOverlayFlag() {
    state.overlay = !!document.querySelector('.overlay.show');
  }

  function openOverlay(id) {
    const node = $(id);
    if (!node) return;
    node.classList.add('show');
    state.overlay = true;
  }

  function closeOverlay(id) {
    const node = $(id);
    if (node) node.classList.remove('show');
    syncOverlayFlag();
  }

  function closeAllOverlays() {
    document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'));
    state.overlay = false;
  }

  /* ---------- Счёт, цели, комбо, звук ---------- */
  function setScore(value, animate) {
    state.score = value;
    dom.score.textContent = fmtNum(value);
    if (animate) {
      dom.score.classList.remove('bump');
      void dom.score.offsetWidth;
      dom.score.classList.add('bump');
    }
  }

  function renderGoals() {
    dom.goalList.innerHTML = state.goals.map((g, i) => `
      <div class="goal-chip" data-i="${i}">
        ${ART.gemSvg(g.color, 'mini-gem')}
        <div class="goal-meta">
          <span class="goal-name">${ART.GEMS[g.color].name}</span>
          <span class="goal-count">${Math.min(g.got, g.need)} / ${g.need}</span>
        </div>
        <span class="goal-check"><svg viewBox="0 0 100 100"><use href="#icon-check"></use></svg></span>
      </div>`).join('');
  }

  function updateGoals(popIndex) {
    state.goals.forEach((g, i) => {
      const chip = dom.goalList.querySelector(`.goal-chip[data-i="${i}"]`);
      if (!chip) return;
      const count = chip.querySelector('.goal-count');
      if (count) count.textContent = `${Math.min(g.got, g.need)} / ${g.need}`;
      const done = g.got >= g.need;
      chip.classList.toggle('done', done);
      if (popIndex === i) {
        chip.classList.remove('pop');
        void chip.offsetWidth;
        chip.classList.add('pop');
      }
    });
  }

  /* ---------- Контракт для визуальных слоёв ----------
     Игра только выставляет атрибуты на <body> и шлёт события «sun:*» —
     всё оформление (темы уровней, шаман, эффекты) живёт в css/*.css и
     js/visuals.js и сюда не заходит.
       body[data-level]   0..3            номер уровня
       body[data-combo]   1..8            текущий множитель
       body[data-urgency] "" | tense | urgent
       body[data-outcome] "" | win | lose
       событие sun:special {type, r, c}   создан спецкамень
       событие sun:blast   {type}         сработал спецкамень
       событие sun:match   {chain, mult}  очередной каскад */
  function setBodyState(name, value) {
    const v = String(value);
    if (document.body.dataset[name] !== v) document.body.dataset[name] = v;
  }

  function emitVisual(name, detail) {
    window.dispatchEvent(new CustomEvent('sun:' + name, { detail }));
  }

  function setCombo(mult) {
    setBodyState('combo', mult);
    state.comboMult = mult;
    SFX.setEnergy(mult);
    const active = mult > 1;
    const pct = active ? clamp((mult - 1) / 7, 0, 1) * 100 : 0;
    if (dom.ladderFill) dom.ladderFill.style.height = pct + '%';
    dom.rungs.forEach(rung => {
      rung.classList.toggle('active', active && mult >= Number(rung.dataset.mult));
    });
    if (dom.comboBadge) {
      dom.comboBadge.textContent = '×' + mult;
      dom.comboBadge.classList.toggle('show', active);
    }
  }

  function updateLevelUI() {
    dom.level.textContent = `${state.levelIndex + 1} / ${LEVELS.length}`;
  }

  function updateRelic() {
    dom.relic.textContent = fmtNum(state.clearedTotal);
  }

  function updateSoundUI() {
    state.soundOn = !SFX.muted;
    if (dom.soundIcon) dom.soundIcon.setAttribute('href', state.soundOn ? '#icon-sound' : '#icon-mute');
    if (dom.soundStartBtn) dom.soundStartBtn.textContent = state.soundOn ? 'Звук: вкл' : 'Звук: выкл';
  }

  function toggleSound() {
    SFX.setMuted(!SFX.muted);
    updateSoundUI();
    if (!SFX.muted) SFX.click();
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        state.best = Number(data.best) || 0;
        state.unlocked = Number(data.unlocked) || 0;
        if (typeof data.relaxed === 'boolean') state.relaxed = data.relaxed;
      }
    } catch (e) { /* ignore */ }
    updateModeUI();
    updateStartUI();
  }

  /* ---------- Режим игры ----------
     «Спокойно» (по умолчанию): таймер стоит, проиграть нельзя, уровень идёт,
     пока не собраны цели. «На время» — прежние правила с отсчётом. */
  function setMode(relaxed) {
    state.relaxed = !!relaxed;
    updateModeUI();
    saveProgress();
    updateTimerUI();
  }

  function updateModeUI() {
    setBodyState('mode', state.relaxed ? 'relaxed' : 'timed');
    document.querySelectorAll('[data-mode-btn]').forEach(btn => {
      const on = (btn.dataset.modeBtn === 'relaxed') === state.relaxed;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    const label = document.querySelector('.time-label');
    if (label) label.textContent = state.relaxed ? 'Спокойно' : 'Время';
  }

  /* В спокойном режиме темп очков постоянный — как на середине уровня */
  function econTimeLeft() {
    return state.relaxed ? state.totalTime * 0.5 : state.timeLeft;
  }

  function updateStartUI() {
    dom.bestScore.textContent = fmtNum(state.best);
    if (dom.continueBtn) {
      const canContinue = state.unlocked > 0 && state.unlocked < LEVELS.length;
      dom.continueBtn.style.display = canContinue ? '' : 'none';
      if (canContinue) {
        dom.continueBtn.textContent = 'Продолжить · уровень ' + (state.unlocked + 1);
      }
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ best: state.best, unlocked: state.unlocked, relaxed: state.relaxed }));
    } catch (e) { /* ignore */ }
  }

  /* ---------- Таймер ---------- */
  let lastTickShown = -1;

  function updateTimerUI() {
    if (state.relaxed) {
      if (dom.time.textContent !== '∞') dom.time.textContent = '∞';
      dom.dial.style.strokeDashoffset = '0';
      dom.dial.classList.remove('tense', 'urgent');
      dom.time.classList.remove('tense', 'urgent');
      setBodyState('urgency', '');
      SFX.setUrgency(0);
      lastTickShown = -1;
      return;
    }
    const left = Math.max(0, state.timeLeft);
    const text = fmtTime(left);
    if (dom.time.textContent !== text) dom.time.textContent = text;
    const frac = state.totalTime > 0 ? clamp(left / state.totalTime, 0, 1) : 0;
    dom.dial.style.strokeDashoffset = String(DIAL_C * (1 - frac));

    const urgent = left <= 20;
    const tense = left <= 45 && !urgent;
    const active = state.running && !state.paused && !state.ended && !state.overlay;
    setBodyState('urgency', active ? (urgent ? 'urgent' : tense ? 'tense' : '') : '');
    dom.dial.classList.toggle('tense', tense);
    dom.dial.classList.toggle('urgent', urgent);
    dom.time.classList.toggle('tense', tense);
    dom.time.classList.toggle('urgent', urgent);

    /* На последних 45 секундах включаем часы и постепенное нагнетание */
    SFX.setUrgency(active && left <= 45 ? clamp((45 - left) / 45, 0, 1) : 0);

    if (active && left <= 45) {
      const sec = Math.ceil(left);
      if (sec !== lastTickShown) {
        lastTickShown = sec;
        SFX.clockTick(left);
      }
    } else {
      lastTickShown = -1;
    }
  }

  function updateShuffleUI() {
    const cd = state.shuffleCd;
    if (cd > 0) {
      dom.shuffleBtn.disabled = true;
      dom.shuffleCd.textContent = Math.ceil(cd);
    } else {
      dom.shuffleBtn.disabled = false;
      dom.shuffleCd.textContent = '';
    }
  }

  /* ---------- Вспомогательное ---------- */
  function gemAt(r, c) {
    return window.BoardCore.gemAt(state.grid, r, c);
  }

  function currentLevel() {
    return LEVELS[state.levelIndex];
  }

  function applyLevel(index) {
    state.levelIndex = clamp(index, 0, LEVELS.length - 1);
    setBodyState('level', state.levelIndex);
    setBodyState('outcome', '');
    const level = currentLevel();
    state.goals = level.goals.map(g => ({ color: g.color, need: g.need, got: 0 }));
    state.timeLeft = level.time;
    state.totalTime = level.time;
    state.clearedTotal = 0;
    state.econBase = 0;
    state.econClear = 0;
    state.chain = 0;
    state.shuffleCd = 0;
    state.timeUp = false;
    state.ended = false;
    state.lastTickSec = -1;
    lastTickShown = -1;
    setCombo(1);
    updateLevelUI();
    renderGoals();
    updateRelic();
    updateTimerUI();
    updateShuffleUI();
    setHint(level.name + ' — ' + hintMessages.default);
  }

  /* ---------- Поле и камни ---------- */
  function randomColor() {
    return Math.floor(Math.random() * TYPES);
  }

  function makeGem(color, r, c) {
    state.gemSeq += 1;
    return { id: state.gemSeq, color, special: null, lineDir: null, locked: false, r, c, el: null };
  }

  /* Лианы поверх камня (временный вид; финальный арт — в фазе 2). Крупные
     толстые плетения с тёмной обводкой: видно сразу и без подсказок. */
  const VINE_SVG =
    '<svg class="vine-svg" viewBox="0 0 100 100" aria-hidden="true">' +
    '<g fill="none" stroke-linecap="round">' +
    '<path d="M3 12 C28 40 54 28 97 84" stroke="#0b2a0d" stroke-width="15"/>' +
    '<path d="M97 12 C72 40 46 30 3 86" stroke="#0b2a0d" stroke-width="15"/>' +
    '<path d="M3 50 C30 66 68 36 97 52" stroke="#0b2a0d" stroke-width="15"/>' +
    '<path d="M3 12 C28 40 54 28 97 84" stroke="#4fc23a" stroke-width="9"/>' +
    '<path d="M97 12 C72 40 46 30 3 86" stroke="#4fc23a" stroke-width="9"/>' +
    '<path d="M3 50 C30 66 68 36 97 52" stroke="#4fc23a" stroke-width="9"/>' +
    '<path d="M3 12 C28 40 54 28 97 84" stroke="#a9ee84" stroke-width="2.6"/>' +
    '<path d="M97 12 C72 40 46 30 3 86" stroke="#a9ee84" stroke-width="2.6"/>' +
    '<path d="M3 50 C30 66 68 36 97 52" stroke="#a9ee84" stroke-width="2.6"/>' +
    '</g>' +
    '<g fill="#3aa52b" stroke="#0b2a0d" stroke-width="2.4">' +
    '<ellipse cx="22" cy="20" rx="9" ry="5" transform="rotate(-35 22 20)"/>' +
    '<ellipse cx="80" cy="22" rx="9" ry="5" transform="rotate(35 80 22)"/>' +
    '<ellipse cx="20" cy="78" rx="9" ry="5" transform="rotate(35 20 78)"/>' +
    '<ellipse cx="80" cy="76" rx="9" ry="5" transform="rotate(-35 80 76)"/>' +
    '<ellipse cx="50" cy="40" rx="8" ry="4.6" transform="rotate(-20 50 40)"/>' +
    '</g></svg>';

  /* Включает/выключает лианы на камне: класс и оверлей. */
  function setGemLocked(gem, locked) {
    gem.locked = !!locked;
    if (!gem.el) return;
    gem.el.classList.remove('vine-snap');
    gem.el.classList.toggle('is-locked', gem.locked);
    const old = gem.el.querySelector('.vine-overlay');
    if (old) old.remove();
    if (gem.locked) {
      const overlay = document.createElement('div');
      overlay.className = 'vine-overlay';
      overlay.innerHTML = VINE_SVG;
      gem.el.appendChild(overlay);
    }
  }

  function createGemEl(gem) {
    const node = document.createElement('div');
    node.className = 'gem' + (gem.special ? ' special-' + gem.special : '');
    node.dataset.id = String(gem.id);
    node.dataset.r = String(gem.r);
    node.dataset.c = String(gem.c);
    node.innerHTML = ART.gemInner(gem.color, gem.special);
    gem.el = node;
    setGemLocked(gem, gem.locked);
    return node;
  }

  /* Мягкий отказ для камня в лианах: небольшое покачивание, без звука
     ошибки и без красного. Повторные нажатия подряд не накладываются. */
  let lastRefuseAt = 0;
  function refuseLocked(gems) {
    const t = Date.now();
    if (t - lastRefuseAt < 380) return;
    lastRefuseAt = t;
    gems.forEach(gem => {
      if (!gem || !gem.el) return;
      gem.el.querySelectorAll('.gem-inner, .vine-overlay').forEach(part => {
        if (!part.animate) return;
        part.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-5%) rotate(-3deg)' },
            { transform: 'translateX(5%) rotate(3deg)' },
            { transform: 'translateX(-3%) rotate(-1.5deg)' },
            { transform: 'translateX(0)' }
          ],
          { duration: 360, easing: 'ease-in-out' }
        );
      });
    });
    flashHint(hintMessages.vines, undefined, 2800);
  }

  function applyPos(gem) {
    if (!gem.el) return;
    gem.el.style.transform = `translate(${gem.c * 100}%, ${gem.r * 100}%)`;
    gem.el.dataset.r = String(gem.r);
    gem.el.dataset.c = String(gem.c);
  }

  function generateGridData() {
    state.grid = window.BoardCore.generateGrid({ colors: TYPES }, Math.random, () => ++state.gemSeq);
  }

  function spawnBoard() {
    dom.tiles.innerHTML = '';
    dom.fx.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const gem = state.grid[r][c];
        if (!gem) continue;
        const node = createGemEl(gem);
        node.style.transition = 'none';
        node.style.transform = `translate(${c * 100}%, ${(r - ROWS) * 100}%)`;
        dom.tiles.appendChild(node);
        void node.offsetWidth;
        node.style.transition = 'transform 640ms cubic-bezier(.22,.82,.28,1)';
        node.style.transitionDelay = `${c * 22 + (7 - r) * 8}ms`;
        node.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
        setTimeout(() => {
          if (node.isConnected) {
            node.style.transition = '';
            node.style.transitionDelay = '';
          }
        }, 1000);
      }
    }
  }

  async function buildBoard() {
    state.busy = true;
    clearSelection();
    clearHints();
    generateGridData();
    spawnBoard();
    state.lastAction = now();
    await sleep(900);
    state.busy = false;
    state.lastAction = now();
  }

  /* ---------- Поиск совпадений и ходов ----------
     Алгоритмы вынесены в js/core/board.js (чистое ядро без DOM).
     Здесь — тонкие обёртки над state.grid с прежними именами. */
  const Board = window.BoardCore;

  /* Горизонтальные и вертикальные серии длиной >= 3 */
  function findLineGroups() {
    return Board.findLineGroups(state.grid);
  }

  /* Квадрат 2×2 (соприкасающиеся квадраты склеены в один блок) */
  function findSquares() {
    return Board.findSquares(state.grid);
  }

  /* Уголок и T: пересечение горизонтальной и вертикальной серий */
  function findCorners(groups) {
    return Board.findCorners(state.grid, groups);
  }

  /* Общий разбор совпадений: серии, квадраты, уголки.
     Приоритет при создании спецкамней описан в resolveBoard. */
  function analyzePatterns() {
    return Board.analyzePatterns(state.grid);
  }

  /* Только серии: совпадение для обмена и раскрытия простых совпадений */
  function findMatches() {
    return Board.findLineGroups(state.grid);
  }

  /* Любое совпадение, включая квадрат и уголок (для findMove) */
  function hasAnyMatch() {
    return Board.hasAnyMatch(state.grid);
  }

  /* Подсказка: пара клеток [{r,c},{r,c}] или null */
  function findMove() {
    const move = Board.findMove(state.grid);
    return move ? [move.a, move.b] : null;
  }

  function hasMove() {
    return Board.hasMove(state.grid);
  }

  /* ---------- Выделение ---------- */
  function clearSelection() {
    dom.tiles.querySelectorAll('.gem.selected').forEach(node => node.classList.remove('selected'));
    state.selected = null;
  }

  let hintTimeout = null;

  function clearHints() {
    dom.tiles.querySelectorAll('.gem.hint').forEach(node => node.classList.remove('hint'));
    state.hintShown = false;
    if (hintTimeout) {
      clearTimeout(hintTimeout);
      hintTimeout = null;
    }
  }

  function selectCell(cell) {
    if (state.selected && state.selected.r === cell.r && state.selected.c === cell.c) {
      clearSelection();
      return;
    }
    clearSelection();
    const gem = gemAt(cell.r, cell.c);
    if (!gem) return;
    if (gem.locked) {
      refuseLocked([gem]);
      return;
    }
    state.selected = { r: cell.r, c: cell.c };
    gem.el.classList.add('selected');
    SFX.click();
  }

  /* ---------- Обмен ---------- */
  async function attemptSwap(a, b) {
    if (!state.running || state.busy || state.ended || state.paused) return;
    if (!isAdjacent(a, b)) return;
    const ga = gemAt(a.r, a.c);
    const gb = gemAt(b.r, b.c);
    if (!ga || !gb) return;

    // Камень в лианах не двигается: мягкий отказ, ход не тратится.
    if (!Board.canSwap(state.grid, a, b)) {
      clearSelection();
      state.lastAction = now();
      refuseLocked([ga, gb].filter(g => g.locked));
      return;
    }

    state.busy = true;
    state.lastAction = now();
    clearSelection();
    clearHints();
    state.swapCell = null;

    SFX.swap();
    state.grid[a.r][a.c] = gb;
    state.grid[b.r][b.c] = ga;
    ga.r = b.r; ga.c = b.c;
    gb.r = a.r; gb.c = a.c;
    applyPos(ga);
    applyPos(gb);
    await sleep(240);

    if (!hasAnyMatch()) {
      SFX.invalid();
      flashHint(hintMessages.bad, 'bad', 1600);
      dom.boardFrame.classList.add('shake');
      setTimeout(() => dom.boardFrame.classList.remove('shake'), 360);

      state.grid[a.r][a.c] = ga;
      state.grid[b.r][b.c] = gb;
      ga.r = a.r; ga.c = a.c;
      gb.r = b.r; gb.c = b.c;
      applyPos(ga);
      applyPos(gb);
      await sleep(250);
      state.busy = false;
      state.lastAction = now();
      return;
    }

    state.swapCell = { r: b.r, c: b.c };
    const maxChain = await resolveBoard();
    state.busy = false;
    state.lastAction = now();
    if (!state.ended) {
      if (maxChain >= 3) flashHint('Каскад ×' + Math.min(8, maxChain + 1) + '!', 'good');
      else flashHint('Отличный ход!', 'good');
    }
    checkEnd();
  }

  /* ---------- Эффекты ---------- */
  const particleColors = GEM_COLORS;

  function spawnParticles(r, c, color) {
    if (dom.fx.childElementCount > 110) return;
    const left = (c + 0.5) * 12.5;
    const top = (r + 0.5) * 12.5;
    for (let i = 0; i < 3; i++) {
      const p = document.createElement('span');
      p.className = 'particle';
      p.style.left = left + '%';
      p.style.top = top + '%';
      p.style.background = color;
      p.style.color = color;
      p.style.setProperty('--dx', ((Math.random() - 0.5) * 74).toFixed(0) + 'px');
      p.style.setProperty('--dy', (-22 - Math.random() * 52).toFixed(0) + 'px');
      p.style.animationDelay = (Math.random() * 70).toFixed(0) + 'ms';
      dom.fx.appendChild(p);
      setTimeout(() => p.remove(), 760);
    }
  }

  function spawnScoreFloat(r, c, text) {
    const node = document.createElement('div');
    node.className = 'score-float';
    node.textContent = text;
    node.style.left = ((c + 0.5) * 12.5) + '%';
    node.style.top = ((r + 0.5) * 12.5) + '%';
    dom.fx.appendChild(node);
    setTimeout(() => node.remove(), 1050);
  }

  function beamFx(r, c, dir) {
    const beam = document.createElement('div');
    beam.className = 'beam ' + (dir === 'h' ? 'horizontal' : 'vertical');
    if (dir === 'h') {
      beam.style.left = '0';
      beam.style.top = (r * 12.5) + '%';
      beam.style.width = '100%';
    } else {
      beam.style.left = (c * 12.5) + '%';
      beam.style.top = '0';
      beam.style.height = '100%';
    }
    dom.fx.appendChild(beam);

    const flare = document.createElement('div');
    flare.className = 'beam-flare';
    flare.style.left = ((c + 0.5) * 12.5) + '%';
    flare.style.top = ((r + 0.5) * 12.5) + '%';
    dom.fx.appendChild(flare);

    setTimeout(() => {
      beam.remove();
      flare.remove();
    }, 560);
  }

  function sunBurstFx(r, c) {
    const node = document.createElement('div');
    node.className = 'sun-burst epic';
    node.style.left = ((c + 0.5) * 12.5) + '%';
    node.style.top = ((r + 0.5) * 12.5) + '%';
    dom.fx.appendChild(node);
    setTimeout(() => node.remove(), 900);
  }

  function shockwaveFx(r, c, epic) {
    const node = document.createElement('div');
    node.className = 'shockwave' + (epic ? ' epic' : '');
    node.style.left = ((c + 0.5) * 12.5) + '%';
    node.style.top = ((r + 0.5) * 12.5) + '%';
    dom.fx.appendChild(node);
    setTimeout(() => node.remove(), 900);
  }

  function sunRaysFx(r, c) {
    const node = document.createElement('div');
    node.className = 'sun-rays';
    node.style.left = ((c + 0.5) * 12.5) + '%';
    node.style.top = ((r + 0.5) * 12.5) + '%';
    dom.fx.appendChild(node);
    setTimeout(() => node.remove(), 900);
  }

  function flashFx(color) {
    const node = document.createElement('div');
    node.className = 'blast-flash';
    node.style.background = `radial-gradient(circle at 50% 50%, ${color} 0%, rgba(255,255,255,0) 68%)`;
    dom.fx.appendChild(node);
    setTimeout(() => node.remove(), 620);
  }

  function spawnBurst(r, c, color, count) {
    if (dom.fx.childElementCount > 150) return;
    const left = (c + 0.5) * 12.5;
    const top = (r + 0.5) * 12.5;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'particle spark';
      p.style.left = left + '%';
      p.style.top = top + '%';
      p.style.background = color;
      p.style.color = color;
      const a = Math.random() * Math.PI * 2;
      const dist = 34 + Math.random() * 88;
      p.style.setProperty('--dx', (Math.cos(a) * dist).toFixed(0) + 'px');
      p.style.setProperty('--dy', (Math.sin(a) * dist - 12).toFixed(0) + 'px');
      p.style.animationDelay = (Math.random() * 60).toFixed(0) + 'ms';
      dom.fx.appendChild(p);
      setTimeout(() => p.remove(), 900);
    }
  }

  let blastShakeTimer = null;
  function blastFx(trigger) {
    emitVisual('blast', { type: trigger.type });
    const isSun = trigger.type === 'sun';
    const isBomb = trigger.type === 'bomb';
    const isTotem = trigger.type === 'totem';
    if (isSun) {
      sunBurstFx(trigger.r, trigger.c);
    } else if (isBomb) {
      explosionFx(trigger.r, trigger.c);
    } else if (isTotem) {
      beamFx(trigger.r, trigger.c, 'h');
      beamFx(trigger.r, trigger.c, 'v');
      sunRaysFx(trigger.r, trigger.c);
    } else {
      beamFx(trigger.r, trigger.c, trigger.lineDir === 'col' ? 'v' : 'h');
    }

    shockwaveFx(trigger.r, trigger.c, isSun || isTotem);
    if (isSun) sunRaysFx(trigger.r, trigger.c);
    const burstColor = isSun ? '#ffd166' : isBomb ? '#ffb070' : isTotem ? '#d9b4ff' : '#a9ecff';
    spawnBurst(trigger.r, trigger.c, burstColor, isSun ? 26 : isBomb ? 22 : isTotem ? 24 : 16);
    const flashColor = isSun
      ? 'rgba(255, 232, 150, .9)'
      : isBomb
        ? 'rgba(255, 176, 112, .88)'
        : isTotem
          ? 'rgba(206, 168, 255, .88)'
          : 'rgba(150, 235, 255, .82)';
    flashFx(flashColor);

    dom.boardFrame.classList.remove('blast', 'blast-sun');
    void dom.boardFrame.offsetWidth;
    dom.boardFrame.classList.add(isSun ? 'blast-sun' : 'blast');
    clearTimeout(blastShakeTimer);
    blastShakeTimer = setTimeout(() => {
      dom.boardFrame.classList.remove('blast', 'blast-sun');
    }, 800);
  }

  /* Взрыв камня-бомбы: огненный шар вместо луча */
  function explosionFx(r, c) {
    const node = document.createElement('div');
    node.className = 'bomb-blast';
    node.style.left = ((c + 0.5) * 12.5) + '%';
    node.style.top = ((r + 0.5) * 12.5) + '%';
    dom.fx.appendChild(node);
    setTimeout(() => node.remove(), 760);
  }

  function impactFx(r, c, strength) {
    shockwaveFx(r, c, false);
    flashFx('rgba(255, 231, 160, ' + (0.16 + strength * 0.16).toFixed(2) + ')');
    spawnBurst(r, c, '#ffe6a0', 8 + Math.round(strength * 6));
  }

  /* Классы спецкамней: новый тип должен попасть в CSS-ауру и ART.gemInner */
  const SPECIAL_CLASS = {
    line: 'special-line',
    sun: 'special-sun',
    bomb: 'special-bomb',
    totem: 'special-totem'
  };

  const SPECIAL_TOAST = {
    sun: 'Солнечный камень!',
    line: 'Камень-молния!',
    bomb: 'Камень-взрыв!',
    totem: 'Тотем!'
  };

  function upgradeGem(gem, type, dir) {
    gem.special = type;
    gem.lineDir = type === 'line' ? dir : null;
    gem.el.className = 'gem ' + (SPECIAL_CLASS[type] || 'special-line');
    gem.el.innerHTML = ART.gemInner(gem.color, type);
    const inner = gem.el.querySelector('.gem-inner');
    if (inner && inner.animate) {
      inner.animate(
        [{ transform: 'scale(.2) rotate(-30deg)' }, { transform: 'scale(1.3) rotate(6deg)' }, { transform: 'scale(1)' }],
        { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1.3)' }
      );
    }
    SFX.special();
    emitVisual('special', { type, r: gem.r, c: gem.c });
  }

  /* ---------- Перемешивание ---------- */
  async function reshuffleBoard(auto, force) {
    if (state.busy && !force) return;
    state.busy = true;
    clearSelection();
    clearHints();
    showToast(auto ? 'Ходов нет — перемешиваем камни' : 'Камни перемешаны', 1700);
    // Перемешиваются только камни не в лианах; закреплённые стоят на месте.
    const movable = [];
    state.grid.forEach(row => row.forEach(gem => {
      if (gem && !gem.locked && gem.el) movable.push(gem);
    }));
    movable.forEach(gem => {
      const node = gem.el;
      node.style.transition = 'transform .28s ease, opacity .28s ease';
      node.style.opacity = '0';
      node.style.transform += ' scale(.4) rotate(20deg)';
    });
    await sleep(300);
    const colorBefore = new Map(movable.map(gem => [gem, gem.color]));
    Board.shuffle(state.grid, Math.random, { colors: TYPES });
    movable.forEach(gem => {
      const node = gem.el;
      if (colorBefore.get(gem) !== gem.color) node.innerHTML = ART.gemInner(gem.color, gem.special);
      node.style.transition = 'none';
      applyPos(gem);
    });
    void dom.tiles.offsetWidth;
    movable.forEach(gem => {
      const node = gem.el;
      node.style.transition = 'opacity .35s ease';
      node.style.opacity = '1';
      const inner = node.querySelector('.gem-inner');
      if (inner && inner.animate) {
        inner.animate(
          [{ transform: 'scale(.3) rotate(-20deg)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
          { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1.2)' }
        );
      }
    });
    await sleep(480);
    movable.forEach(gem => {
      gem.el.style.transition = '';
      gem.el.style.opacity = '';
    });
    // Запасной путь ядра не даёт гарантий на совсем тесной доске: если
    // совпадения всё же остались, разбираем их как обычный каскад.
    if (Board.hasAnyMatch(state.grid)) await resolveBoard();
    if (!force) state.busy = false;
    state.lastAction = now();
    flashHint('Новая комбинация готова', 'good');
    SFX.special();
  }

  function manualShuffle() {
    if (!state.running || state.busy || state.ended || state.paused) return;
    if (state.shuffleCd > 0) {
      showToast('Перемешать можно через ' + Math.ceil(state.shuffleCd) + ' с');
      return;
    }
    state.shuffleCd = 22;
    updateShuffleUI();
    reshuffleBoard(false);
  }

  /* ---------- Подсказка ---------- */
  function showHint(fromButton) {
    if (!state.running || state.busy || state.ended || state.paused) return;
    const move = findMove();
    if (!move) {
      showToast('Ходов нет');
      return;
    }
    clearHints();
    move.forEach(cell => {
      const gem = gemAt(cell.r, cell.c);
      if (gem && gem.el) gem.el.classList.add('hint');
    });
    state.hintShown = true;
    state.lastAction = now();
    if (fromButton) SFX.hint();
    flashHint('Попробуй обменять эти камни', 'good', 3200);
    hintTimeout = setTimeout(() => {
      clearHints();
      if (state.running && !state.ended && !state.paused) {
        setHint(currentLevel().name + ' — ' + hintMessages.default);
      }
    }, 3200);
  }

  /* ---------- Разрешение совпадений ---------- */
  async function resolveBoard() {
    let chain = 0;
    let maxChain = 0;

    while (true) {
      // Решения принимает ядро (js/core/board.js): что совпало, какие
      // спецкамни создать (тотем > солнце > бомба > молния, по одному на
      // блок) и что очистить. Здесь — только анимация, звук и подсчёт.
      const plan = Board.planCascade(state.grid, state.swapCell);
      if (!plan) break;
      const { creates, clear, triggers } = plan;
      // Камни в лианах из clear уже исключены ядром: их лиана срывается, а
      // сами они не считаются собранными (цели цвета, очки, clearedTotal).
      const unlockArr = Array.from(plan.unlocks || []).map(parseKey);

      chain++;
      maxChain = Math.max(maxChain, chain);
      state.chain = chain;
      const mult = Math.min(8, chain + 1);
      setCombo(mult);
      emitVisual('match', { chain, mult });

      triggers.forEach(t => blastFx(t));

      if (triggers.length) {
        const sunCount = triggers.filter(t => t.type === 'sun').length;
        const lineCount = triggers.filter(t => t.type === 'line' || t.type === 'totem').length;
        const bombCount = triggers.filter(t => t.type === 'bomb').length;
        const pan = clamp((triggers[0].c + 0.5) / COLS * 2 - 1, -0.8, 0.8);
        SFX.blast({ line: lineCount, sun: sunCount, chain, pan, bomb: bombCount });
      }

      const cellsArr = Array.from(clear).map(parseKey);

      // Клетки, которые реально двигают незакрытые цели: за них платим
      // заметно больше, чтобы «фарм» пустых камней не окупался.
      const needLeft = new Map();
      state.goals.forEach(g => {
        if (g.got < g.need) needLeft.set(g.color, g.need - g.got);
      });
      let goalCells = 0;
      cellsArr.forEach(p => {
        const gem = gemAt(p.r, p.c);
        if (!gem) return;
        const left = needLeft.get(gem.color) || 0;
        if (left > 0) {
          goalCells++;
          needLeft.set(gem.color, left - 1);
        }
      });

      const econ = Economy.clearDetail({
        cells: clear.size,
        goalCells: goalCells,
        chain: chain,
        creates: creates,
        triggers: triggers,
        timeLeft: econTimeLeft(),
        totalTime: state.totalTime
      });

      const gained = econ.score;
      state.econBase += econ.raw;
      state.econClear += econ.score;
      setScore(state.score + gained, true);

      let sr = 0;
      let sc = 0;
      cellsArr.forEach(p => { sr += p.r; sc += p.c; });
      if (cellsArr.length) {
        spawnScoreFloat(
          sr / cellsArr.length,
          sc / cellsArr.length,
          '+' + fmtNum(gained) + (mult > 1 ? ' ×' + mult : '') + ' · темп ' + econ.paceLabel
        );
      }

      if (cellsArr.length && !triggers.length && (clear.size >= 6 || chain >= 3)) {
        const strength = Math.min(1, (clear.size - 5) / 10 + (chain - 2) * 0.12);
        impactFx(sr / cellsArr.length, sc / cellsArr.length, strength);
        SFX.impact();
      }

      const gotBefore = state.goals.map(g => g.got);
      cellsArr.forEach(p => {
        const gem = gemAt(p.r, p.c);
        if (!gem) return;
        state.clearedTotal++;
        state.goals.forEach(goal => {
          if (goal.color === gem.color && goal.got < goal.need) goal.got++;
        });
      });
      const changed = state.goals.findIndex((g, i) => g.got !== gotBefore[i]);
      if (changed >= 0) updateGoals(changed);
      updateRelic();

      SFX.match(chain, clear.size, triggers.length > 0);
      clear.forEach(k => {
        const p = parseKey(k);
        const gem = gemAt(p.r, p.c);
        if (!gem || !gem.el) return;
        gem.el.classList.add('clearing');
        spawnParticles(p.r, p.c, GEM_COLORS[gem.color]);
      });

      // Срыв лиан: лиана вспыхивает и рвётся, камень остаётся на месте.
      unlockArr.forEach(p => {
        const gem = gemAt(p.r, p.c);
        if (!gem || !gem.el) return;
        gem.el.classList.add('vine-snap');
        spawnBurst(p.r, p.c, '#6fe04a', 7);
        emitVisual('unlock', { r: p.r, c: p.c });
      });

      if (creates.length) {
        // Показываем самый приоритетный из созданных спецкамней
        const rank = { totem: 0, sun: 1, bomb: 2, line: 3 };
        const top = creates.slice().sort((a, b) => rank[a.type] - rank[b.type])[0];
        showToast(SPECIAL_TOAST[top.type] || 'Особый камень!', 1200);
      }

      await sleep(310);

      const { removed, unlocked } = Board.applyCascade(state.grid, plan);
      removed.forEach(gem => {
        if (gem.el) gem.el.remove();
      });
      unlocked.forEach(gem => setGemLocked(gem, false));

      creates.forEach(cr => {
        const gem = gemAt(cr.r, cr.c);
        if (gem) upgradeGem(gem, cr.type, cr.dir);
      });

      await dropGems();
    }

    state.chain = 0;
    setCombo(1);
    state.swapCell = null;

    if (!hasMove()) {
      await reshuffleBoard(true, true);
    }
    return maxChain;
  }

  async function dropGems() {
    // Падение и досыпку считает ядро; здесь — только движение и появление узлов.
    const { moves, spawned } = Board.collapse(state.grid, (r, c) => makeGem(randomColor(), r, c));

    let maxDist = 0;
    moves.forEach(m => {
      applyPos(m.gem);
      maxDist = Math.max(maxDist, m.toR - m.fromR);
    });

    // Новые камни приходят по столбцам снизу вверх; сколько их в столбце —
    // столько рядов над полем они стартуют.
    const perCol = new Array(COLS).fill(0);
    spawned.forEach(gem => { perCol[gem.c]++; });
    const index = new Array(COLS).fill(0);
    spawned.forEach(gem => {
      const { r, c } = gem;
      index[c]++;
      const node = createGemEl(gem);
      node.style.transition = 'none';
      node.style.transform = `translate(${c * 100}%, ${(r - perCol[c]) * 100}%)`;
      dom.tiles.appendChild(node);
      void node.offsetWidth;
      const dur = 320 + index[c] * 45;
      node.style.transition = `transform ${dur}ms cubic-bezier(.25,.82,.34,1.05)`;
      node.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
      setTimeout(() => {
        if (node.isConnected) node.style.transition = '';
      }, dur + 80);
    });

    await sleep(390 + Math.min(maxDist, 7) * 16);
  }

  /* ---------- Завершение уровня ---------- */
  function checkEnd() {
    if (state.ended || !state.started) return;
    const allDone = state.goals.every(g => g.got >= g.need);
    if (allDone) {
      winLevel();
      return;
    }
    if (!state.relaxed && (state.timeUp || state.timeLeft <= 0)) {
      loseLevel();
    }
  }

  function winLevel() {
    if (state.ended) return;
    state.ended = true;
    state.running = false;
    state.paused = false;
    clearSelection();
    clearHints();
    SFX.setUrgency(0);
    SFX.musicScene('menu');

    const breakdown = Economy.formatBreakdown({
      base: state.econBase,
      clearScore: state.econClear,
      timeBonus: state.relaxed ? 0 : Economy.levelBonus({
        timeLeft: state.timeLeft,
        totalTime: state.totalTime,
        levelIndex: state.levelIndex
      }),
      timeLeft: econTimeLeft(),
      totalTime: state.totalTime,
      levelIndex: state.levelIndex
    });
    const bonus = breakdown.timeBonus;
    setScore(state.score + bonus, true);
    state.best = Math.max(state.best, state.score);
    state.unlocked = Math.max(state.unlocked, state.levelIndex + 1);
    saveProgress();
    updateStartUI();
    SFX.win();
    setBodyState('outcome', 'win');
    setHint('Уровень пройден!', 'good');
    setTimeout(() => showEndScreen(true, bonus, breakdown), 500);
  }

  function loseLevel() {
    if (state.ended) return;
    state.ended = true;
    state.running = false;
    state.paused = false;
    clearSelection();
    clearHints();
    SFX.setUrgency(0);
    SFX.musicScene('menu');
    state.best = Math.max(state.best, state.score);
    saveProgress();
    updateStartUI();
    SFX.lose();
    setBodyState('outcome', 'lose');
    setHint('Время вышло', 'bad');
    setTimeout(() => showEndScreen(false, 0), 350);
  }

  function showEndScreen(win, bonus, breakdown) {
    const last = state.levelIndex >= LEVELS.length - 1;
    const bd = breakdown || Economy.formatBreakdown({
      base: state.econBase,
      clearScore: state.econClear,
      timeBonus: bonus,
      timeLeft: state.timeLeft,
      totalTime: state.totalTime,
      levelIndex: state.levelIndex
    });
    const sub = win
      ? (last ? 'Все сокровища древних ацтеков собраны' : currentLevel().name)
      : 'Цели не достигнуты — попробуй ещё раз';
    dom.endCard.classList.toggle('lost', !win);
    dom.endTitle.textContent = win ? (last ? 'Солнце у тебя!' : 'Уровень пройден!') : 'Время вышло';
    /* Темп и ранг скорости имеют смысл только в игре на время */
    dom.endSub.textContent = win && !state.relaxed
      ? sub + ' · средний темп ' + bd.paceLabel + ' · ' + bd.starsLabel + ' ' + bd.rank
      : sub;
    dom.endScore.textContent = fmtNum(state.score);
    dom.endBonus.textContent = '+' + fmtNum(bonus);
    dom.endTime.textContent = state.relaxed ? '∞' : fmtTime(state.timeLeft);
    dom.nextBtn.style.display = win && !last ? '' : 'none';
    dom.retryBtn.style.display = win ? 'none' : '';
    openOverlay('endScreen');
  }

  /* ---------- Запуск уровня ---------- */
  async function beginLevel(index) {
    const session = ++state.session;
    applyLevel(index);
    state.levelStartScore = state.score;
    state.ended = false;
    state.paused = false;
    state.timeUp = false;
    state.started = false;
    clearSelection();
    clearHints();
    closeAllOverlays();
    setCombo(1);
    setScore(state.score, false);
    updateSoundUI();
    updateTimerUI();
    SFX.musicStart('game');

    await buildBoard();
    if (session !== state.session) return;

    await runCountdown(session);
    if (session !== state.session) return;

    state.running = true;
    state.paused = false;
    state.started = true;
    state.timeLeft = currentLevel().time;
    state.totalTime = currentLevel().time;
    state.lastAction = now();
    updateTimerUI();
    setHint(currentLevel().name + ' — ' + hintMessages.default);
  }

  async function runCountdown(session) {
    dom.countdown.classList.remove('hidden');
    const beats = ['3', '2', '1', 'ВПЕРЁД!'];
    for (let i = 0; i < beats.length; i++) {
      if (session !== state.session) {
        dom.countdown.classList.add('hidden');
        return;
      }
      dom.countdownNum.textContent = beats[i];
      dom.countdownNum.classList.toggle('word', i === beats.length - 1);
      dom.countdownNum.style.animation = 'none';
      void dom.countdownNum.offsetWidth;
      dom.countdownNum.style.animation = '';
      SFX.tone(i < 3 ? 440 + i * 80 : 880, 0.12, { type: 'triangle', gain: 0.07 });
      await sleep(i < 3 ? 620 : 540);
    }
    dom.countdown.classList.add('hidden');
  }

  async function startNewRun(startIndex = 0) {
    SFX.click();
    state.score = 0;
    setScore(0, false);
    state.levelIndex = clamp(startIndex, 0, LEVELS.length - 1);
    await beginLevel(state.levelIndex);
  }

  async function retryLevel() {
    SFX.click();
    state.score = state.levelStartScore;
    await beginLevel(state.levelIndex);
  }

  async function nextLevel() {
    SFX.click();
    if (state.levelIndex >= LEVELS.length - 1) {
      goHome();
      return;
    }
    await beginLevel(state.levelIndex + 1);
  }

  function pauseGame() {
    if (!state.running || state.ended || state.paused || state.busy) return;
    state.paused = true;
    SFX.musicPause();
    SFX.setUrgency(0);
    openOverlay('pauseScreen');
    setHint('Пауза');
  }

  function resumeGame() {
    if (!state.paused) return;
    closeOverlay('pauseScreen');
    state.paused = false;
    state.lastAction = now();
    SFX.musicResume();
    setHint(currentLevel().name + ' — ' + hintMessages.default);
  }

  async function goHome() {
    state.session++;
    state.running = false;
    state.paused = false;
    state.ended = false;
    state.started = false;
    state.busy = true;
    clearSelection();
    clearHints();
    closeAllOverlays();
    applyLevel(0);
    state.score = 0;
    setScore(0, false);
    state.timeLeft = LEVELS[0].time;
    updateTimerUI();
    dom.countdown.classList.add('hidden');
    updateStartUI();
    SFX.setUrgency(0);
    SFX.musicScene('menu');
    SFX.musicResume();
    openOverlay('startScreen');
    await buildBoard();
    setHint(hintMessages.default);
  }

  /* ---------- Ввод ---------- */
  function cellFromPoint(x, y) {
    const target = document.elementFromPoint(x, y);
    if (!target) return null;
    const node = target.closest ? target.closest('.gem') : null;
    if (!node || !dom.tiles.contains(node)) return null;
    const r = Number(node.dataset.r);
    const c = Number(node.dataset.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    return { r, c };
  }

  function canPlay() {
    return state.running && !state.busy && !state.ended && !state.paused && !state.overlay;
  }

  function onPointerDown(e) {
    if (!canPlay()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    // Гасим нативный скролл/зум/контекстное меню: иначе iOS Safari
    // присылает pointercancel и свайп по камню не доходит до pointerup.
    e.preventDefault();
    state.lastAction = now();
    state.hintShown = false;

    const sel = state.selected;
    if (sel && isAdjacent(sel, cell)) {
      state.dragStart = null;
      attemptSwap(sel, cell);
      return;
    }
    selectCell(cell);

    const rect = dom.tiles.getBoundingClientRect();
    state.dragStart = {
      r: cell.r,
      c: cell.c,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      step: rect.width / COLS,
      moved: false
    };
    if (dom.tiles.setPointerCapture) {
      try { dom.tiles.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }

  function onPointerMove(e) {
    const start = state.dragStart;
    if (!start || start.id !== e.pointerId) return;
    if (!canPlay()) {
      state.dragStart = null;
      return;
    }
    e.preventDefault();
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) < Math.max(8, start.step * 0.42)) return;

    start.moved = true;
    let dr = 0;
    let dc = 0;
    if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
    else dr = dy > 0 ? 1 : -1;

    const target = { r: start.r + dr, c: start.c + dc };
    if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) return;

    state.dragStart = null;
    attemptSwap(start, target);
  }

  function onPointerUp(e) {
    const start = state.dragStart;
    state.dragStart = null;
    if (!start || start.id !== e.pointerId) return;
    if (!canPlay()) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (cell && isAdjacent(start, cell)) {
      attemptSwap(start, cell);
    }
  }

  /* ---------- События ---------- */
  function attachEvents() {
    $('playBtn').addEventListener('click', () => startNewRun(0));
    document.querySelectorAll('[data-mode-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        SFX.click();
        setMode(btn.dataset.modeBtn === 'relaxed');
      });
    });
    dom.continueBtn.addEventListener('click', () => startNewRun(state.unlocked));
    $('howBtn').addEventListener('click', () => {
      SFX.click();
      openOverlay('howScreen');
    });
    $('closeHowBtn').addEventListener('click', () => {
      SFX.click();
      closeOverlay('howScreen');
    });
    dom.soundStartBtn.addEventListener('click', toggleSound);
    $('soundBtn').addEventListener('click', toggleSound);
    $('menuBtn').addEventListener('click', () => {
      if (state.ended) return;
      if (state.running) pauseGame();
      else if (state.overlay) goHome();
    });
    $('menuBtnMobile').addEventListener('click', () => {
      if (state.ended) return;
      if (state.running) pauseGame();
      else if (state.overlay) goHome();
    });
    $('resumeBtn').addEventListener('click', () => {
      SFX.click();
      resumeGame();
    });
    $('restartBtn').addEventListener('click', async () => {
      closeAllOverlays();
      await retryLevel();
    });
    $('homeBtn').addEventListener('click', goHome);
    $('endHomeBtn').addEventListener('click', goHome);
    dom.nextBtn.addEventListener('click', async () => {
      closeAllOverlays();
      await nextLevel();
    });
    dom.retryBtn.addEventListener('click', async () => {
      closeAllOverlays();
      await retryLevel();
    });
    $('hintBtn').addEventListener('click', () => showHint(true));
    dom.shuffleBtn.addEventListener('click', manualShuffle);
    dom.tiles.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', () => { state.dragStart = null; });
    window.addEventListener('blur', () => { state.dragStart = null; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.running && !state.paused) pauseGame();
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (state.paused) resumeGame();
        else if (state.running) pauseGame();
      }
      if (e.key === 'h' || e.key === 'H') showHint(true);
    });
  }

  /* ---------- Игровой цикл ---------- */
  let lastFrame = now();

  function loop(t) {
    const dt = Math.min(0.25, (t - lastFrame) / 1000);
    lastFrame = t;

    if (state.running && !state.paused && !state.overlay && !state.ended) {
      if (!state.relaxed) state.timeLeft = Math.max(0, state.timeLeft - dt);

      const cdBefore = state.shuffleCd;
      state.shuffleCd = Math.max(0, state.shuffleCd - dt);
      if (state.shuffleCd > 0) updateShuffleUI();
      else if (cdBefore > 0) updateShuffleUI();

      updateTimerUI();

      if (!state.relaxed && state.timeLeft <= 0) {
        state.timeUp = true;
        if (!state.busy) checkEnd();
      }

      if (!state.busy && !state.hintShown && t - state.lastAction > 9000) {
        showHint(false);
      }
    }

    requestAnimationFrame(loop);
  }

  /* ---------- Старт ---------- */
  async function init() {
    ART.init();
    buildFireflies();
    buildDialTicks();
    loadSave();
    updateSoundUI();
    SFX.musicScene('menu');
    attachEvents();
    applyLevel(0);
    state.score = 0;
    setScore(0, false);
    updateTimerUI();
    setHint(hintMessages.default);
    openOverlay('startScreen');
    await buildBoard();
    requestAnimationFrame(loop);
  }

  /* ---------- Отладка (для тестов) ----------
     Хук доступен только при открытии с ?debug в адресе. */
  if (new URLSearchParams(location.search).has('debug')) {
    window.__SUN = {
      state, gemAt, findMove, findMatches, attemptSwap, resolveBoard,
      checkEnd, upgradeGem, applyPos, beginLevel, showHint,
      findSquares, findCorners, analyzePatterns,
      findLineGroups, hasAnyMatch,
      expandSpecials: (base, protectedKeys) => Board.expandSpecials(state.grid, base, protectedKeys),
      reshuffleBoard,
      // Ставит лианы на камни в клетках [[r, c], …] (остальные снимает)
      setVines(cells) {
        const want = new Set((cells || []).map(([r, c]) => r + ',' + c));
        state.grid.forEach((row, r) => row.forEach((gem, c) => {
          if (gem) setGemLocked(gem, want.has(r + ',' + c));
        }));
      }
    };
  }

  init();
})();


