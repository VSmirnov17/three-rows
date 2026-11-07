/* Хранитель Солнца — игра «три в ряд» */
(() => {
  'use strict';

  const ROWS = 8;
  const COLS = 8;
  const TYPES = 6;
  const GEM_COLORS = ['#ff7a5c', '#ffd166', '#6ef08a', '#63d8ff', '#d58cff', '#e8eef2'];
  /* Сюда кладётся копия нечитаемого нового ключа до первой записи */
  const BROKEN_KEY = 'sun-keeper-save-broken';
  const BACKUP_KEY = 'sun-keeper-save-backup';
  const BACKUP_PREV_KEY = 'sun-keeper-save-backup-prev';
  const FRAGMENT_NAMES = {
    stone: 'Каменный осколок',
    silver: 'Серебряный осколок',
    gold: 'Золотой осколок'
  };

  const $ = id => document.getElementById(id);

  const dom = {
    board: $('board'),
    boardFrame: document.querySelector('.board-frame'),
    tiles: $('tiles'),
    fx: $('fx'),
    score: $('scoreValue'),
    level: $('levelValue'),
    time: $('timeValue'),
    timePlaque: $('timePlaque'),
    timeBar: $('timeBar'),
    goalList: $('goalList'),
    sunStone: $('sunStone'),
    sunStoneCaption: $('sunStoneCaption'),
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
    endStars: $('endStars'),
    endStarsText: $('endStarsText'),
    endFragment: $('endFragment'),
    endFragmentName: $('endFragmentName'),
    nextBtn: $('nextBtn'),
    retryBtn: $('retryBtn'),
    continueBtn: $('continueBtn'),
    playBtn: $('playBtn'),
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
    overlay: true,
    // Выбранная сложность — для следующего запуска уровня
    difficulty: 'calm',
    // Сложность, с которой начат текущий уровень (по ней таймер и запись)
    levelDifficulty: 'calm',
    levelId: null,
    level: null,
    save: null,
    lastResult: null,
    atHome: true,
    score: 0,
    timeLeft: 120,
    totalTime: 120,
    goals: [],
    comboMult: 1,
    chain: 0,
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
  const Board = window.BoardCore;
  const { parseKey } = Board;
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

  function goalCountText(g) {
    return Math.min(g.got, g.need) + ' / ' + g.need;
  }

  function renderGoals() {
    dom.goalList.innerHTML = state.goals.map((g, i) => {
      const vines = g.type === 'vines';
      return `
      <div class="goal-chip${vines ? ' goal-vines' : ''}" data-i="${i}">
        ${vines ? GOAL_VINE_ICON : ART.gemSvg(g.color, 'mini-gem')}
        <div class="goal-meta">
          <span class="goal-name">${vines ? 'Лианы' : ART.GEMS[g.color].name}</span>
          <span class="goal-count">${goalCountText(g)}</span>
        </div>
        <span class="goal-check"><svg viewBox="0 0 100 100"><use href="#icon-check"></use></svg></span>
      </div>`;
    }).join('');
  }

  function updateGoals(popIndex) {
    state.goals.forEach((g, i) => {
      const chip = dom.goalList.querySelector(`.goal-chip[data-i="${i}"]`);
      if (!chip) return;
      const count = chip.querySelector('.goal-count');
      if (count) count.textContent = goalCountText(g);
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
     всё оформление (темы уровней, эффекты) живёт в css/*.css и
     js/visuals.js и сюда не заходит.
       body[data-land]     1..10          номер земли (фон и тема)
       body[data-level-id] "1-05"         текущий уровень кампании
       body[data-difficulty] calm | normal | challenge  сложность уровня
       body[data-combo]   1..8            текущий множитель
       body[data-urgency] "" | tense | urgent
       body[data-outcome] "" | win | lose
       событие sun:special {type, r, c}   создан спецкамень
       событие sun:blast   {type}         сработал спецкамень
       событие sun:match   {chain, mult}  очередной каскад
       событие sun:unlock  {r, c}         с камня сорвана лиана */
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
    if (dom.comboBadge) {
      dom.comboBadge.textContent = 'Серия ×' + mult;
      dom.comboBadge.classList.toggle('show', active);
    }
  }

  function levelNumber(id) {
    return Number(String(id).split('-')[1]) || 1;
  }

  function updateLevelUI() {
    const land = Campaign.landOf(state.levelId);
    dom.level.textContent = levelNumber(state.levelId) + ' / ' + (land ? land.levels.length : 20);
  }

  /* Круг Солнечного Камня: осколки текущей главы, обведён текущий уровень */
  function updateSunStone() {
    if (!dom.sunStone || !window.SunStone) return;
    const land = Campaign.landOf(state.levelId);
    if (!land) return;
    SunStone.render(dom.sunStone, SunStone.segments(state.save, land), levelNumber(state.levelId) - 1);
    if (dom.sunStoneCaption) dom.sunStoneCaption.textContent = land.name;
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

  /* ---------- Сохранение ----------
     Читаем и пишем только через Progress. Само обращение к localStorage
     может бросить (Firefox с запретом cookies) — тогда игра идёт без
     сохранения. Старый ключ sun-treasures-save не пишется никогда. */
  const NO_STORAGE = {
    getItem() { return null; },
    setItem() { throw new Error('storage unavailable'); }
  };

  function getStorage() {
    try {
      return window.localStorage || NO_STORAGE;
    } catch (e) {
      return NO_STORAGE;
    }
  }

  /* Новый ключ есть, но load() его не взял — сохраняем копию, чтобы
     первая же запись не стёрла то, что ещё можно спасти вручную. */
  function backupBrokenSave(storage, raw) {
    try {
      const prev = storage.getItem(BROKEN_KEY);
      if (prev === raw) return;
      storage.setItem(prev === null ? BROKEN_KEY : BROKEN_KEY + '-' + Date.now(), raw);
    } catch (e) { /* ignore */ }
  }

  function loadSave() {
    const storage = getStorage();
    const raw = Progress.readRaw(storage);
    if (raw !== null && !Progress.isUsableRaw(raw)) backupBrokenSave(storage, raw);
    state.save = Progress.load(storage);
    state.difficulty = state.save.difficulty;
    updateDifficultyUI();
    updateStartUI();
  }

  function saveProgress() {
    return Progress.persist(getStorage(), state.save);
  }

  /* ---------- Сложность ----------
     «Спокойно»: таймера нет, проиграть нельзя, уровень идёт, пока не
     собраны цели. «Обычно» и «Испытание» — с отсчётом. Выбор действует
     со следующего запуска уровня. */
  function isTimed() {
    return !!(state.level && state.level.timer != null);
  }

  function setDifficulty(d) {
    if (Campaign.DIFFICULTIES.indexOf(d) < 0) return false;
    state.difficulty = d;
    if (state.save.difficulty !== d) {
      state.save.difficulty = d;
      saveProgress();
    }
    updateDifficultyUI();
    // На стартовом экране за меню видно поле: показываем его под новую сложность
    if (state.atHome && state.levelId) {
      applyLevel(state.levelId, d);
      state.score = 0;
      setScore(0, false);
    }
    return true;
  }

  function updateDifficultyUI() {
    document.querySelectorAll('[data-difficulty-btn]').forEach(btn => {
      const on = btn.dataset.difficultyBtn === state.difficulty;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    const label = document.querySelector('.time-label');
    if (label) label.textContent = isTimed() ? 'Время' : 'Спокойно';
  }

  /* В спокойном режиме темп очков постоянный — как на середине уровня */
  function econTimeLeft() {
    return isTimed() ? state.timeLeft : state.totalTime * 0.5;
  }

  function levelTitle(id) {
    const land = Campaign.landOf(id);
    return (land ? land.name + ' · ' : '') + 'уровень ' + levelNumber(id);
  }

  /* Есть прогресс — первая и самая крупная золотая кнопка «Продолжить»,
     под ней вторая «Начать с начала» (просто запускает 1-01, прогресс не
     стирает). Нет прогресса — одна золотая «Играть». */
  function updateStartUI() {
    dom.bestScore.textContent = fmtNum(state.save.best);
    const canContinue = Progress.starsTotal(state.save) > 0;
    const play = dom.playBtn;
    const cont = dom.continueBtn;
    if (play) {
      play.className = canContinue ? 'stone-btn continue-btn restart-btn' : 'gold-btn big';
      play.firstElementChild.textContent = canContinue ? 'Начать с начала' : 'Играть';
    }
    if (cont) {
      cont.style.display = canContinue ? '' : 'none';
      if (canContinue) {
        const id = Progress.currentLevelId(state.save, Campaign);
        cont.className = 'gold-btn big continue-btn';
        cont.textContent = '';
        const label = document.createElement('span');
        label.textContent = 'Продолжить';
        const sub = document.createElement('small');
        sub.textContent = levelTitle(id);
        cont.appendChild(label);
        cont.appendChild(sub);
      }
    }
  }

  /* ---------- Таймер ---------- */
  let lastTickShown = -1;

  function updateTimerUI() {
    if (!isTimed()) {
      if (dom.time.textContent !== '∞') dom.time.textContent = '∞';
      dom.timeBar.style.width = '100%';
      dom.timePlaque.classList.remove('tense', 'urgent');
      setBodyState('urgency', '');
      SFX.setUrgency(0);
      lastTickShown = -1;
      return;
    }
    const left = Math.max(0, state.timeLeft);
    const text = fmtTime(left);
    if (dom.time.textContent !== text) dom.time.textContent = text;
    const frac = state.totalTime > 0 ? clamp(left / state.totalTime, 0, 1) : 0;
    dom.timeBar.style.width = (frac * 100).toFixed(2) + '%';

    const urgent = left <= 20;
    const tense = left <= 45 && !urgent;
    const active = state.running && !state.paused && !state.ended && !state.overlay;
    setBodyState('urgency', active ? (urgent ? 'urgent' : tense ? 'tense' : '') : '');
    dom.timePlaque.classList.toggle('tense', tense);
    dom.timePlaque.classList.toggle('urgent', urgent);

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
    return Board.gemAt(state.grid, r, c);
  }

  function currentLevel() {
    return state.level;
  }

  /* Ставит уровень кампании id на сложности difficulty: цели, часы, тема. */
  function applyLevel(id, difficulty) {
    const level = Campaign.resolve(id, difficulty) || Campaign.resolve(Campaign.allLevelIds()[0], difficulty);
    state.level = level;
    state.levelId = level.id;
    state.levelDifficulty = difficulty;
    setBodyState('land', level.landId);
    setBodyState('levelId', level.id);
    setBodyState('difficulty', difficulty);
    setBodyState('outcome', '');
    state.goals = level.goals.map(g => g.type === 'vines'
      ? { type: 'vines', need: g.need, got: 0 }
      : { type: 'color', color: g.color, need: g.need, got: 0 });
    state.totalTime = level.econTime;
    state.timeLeft = level.timer != null ? level.timer : level.econTime;
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
    updateDifficultyUI();
    renderGoals();
    updateSunStone();
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

  /* Значок цели «Лианы»: те же плетения на светлой каменной плитке —
     контрастно и на тёмной панели целей. */
  const GOAL_VINE_ICON =
    '<svg class="mini-gem goal-vine-icon" viewBox="0 0 100 100" aria-hidden="true">' +
    '<rect x="5" y="5" width="90" height="90" rx="20" fill="#c9b58a" stroke="#f3e2b0" stroke-width="4"/>' +
    VINE_SVG.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') +
    '</svg>';

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
    const vines = state.level ? state.level.vines : [];
    state.grid = Board.generateGrid({ colors: TYPES, vines }, Math.random, () => ++state.gemSeq);
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
      // сами они не считаются собранными (цели цвета, очки).
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
        if (g.type === 'color' && g.got < g.need) {
          needLeft.set(g.color, (needLeft.get(g.color) || 0) + g.need - g.got);
        }
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
        state.goals.forEach(goal => {
          if (goal.type === 'color' && goal.color === gem.color && goal.got < goal.need) goal.got++;
        });
      });
      // Цель «Лианы»: каждая сорванная лиана — один шаг
      if (unlockArr.length) {
        state.goals.forEach(goal => {
          if (goal.type === 'vines') goal.got = Math.min(goal.need, goal.got + unlockArr.length);
        });
      }
      const changed = state.goals.findIndex((g, i) => g.got !== gotBefore[i]);
      if (changed >= 0) updateGoals(changed);

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
    if (isTimed() && (state.timeUp || state.timeLeft <= 0)) {
      loseLevel();
    }
  }

  /* Звёзды: победа — 1★; очки за очистку (без бонуса времени, как в
     tools/level-bot.js) от s2 — 2★, от s3 — 3★. */
  function starsFor(points, thresholds) {
    const t = thresholds || [];
    if (points >= t[1]) return 3;
    if (points >= t[0]) return 2;
    return 1;
  }

  function isLastOfLand(id) {
    const land = Campaign.landOf(id);
    return !!(land && land.levels.length && land.levels[land.levels.length - 1].id === id);
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

    const bonus = isTimed()
      ? Economy.levelBonus({ timeLeft: state.timeLeft, totalTime: state.totalTime })
      : 0;
    const breakdown = Economy.formatBreakdown({
      base: state.econBase,
      clearScore: state.econClear,
      timeBonus: bonus,
      timeLeft: econTimeLeft(),
      totalTime: state.totalTime
    });
    setScore(state.score + bonus, true);

    const stars = starsFor(state.econClear, state.level.stars);
    const result = Progress.record(state.save, state.levelId, state.levelDifficulty, state.score, stars);
    state.save = result.save;
    saveProgress();
    updateSunStone();
    state.lastResult = {
      win: true,
      stars,
      newTier: result.newTier,
      landComplete: isLastOfLand(state.levelId) ? state.level.landId : null
    };
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
    // Поражение ничего не пишет: сохранённый прогресс остаётся как был
    state.lastResult = { win: false, stars: 0, newTier: null, landComplete: null };
    SFX.lose();
    setBodyState('outcome', 'lose');
    setHint('Время вышло', 'bad');
    setTimeout(() => showEndScreen(false, 0), 350);
  }

  const STAR_SVG =
    '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<polygon points="50,5 62,37 96,38 69,59 79,93 50,73 21,93 31,59 4,38 38,37"/></svg>';

  function starsWord(n) {
    return n === 1 ? 'звезда' : 'звезды';
  }

  function renderEndStars(win, stars) {
    if (!dom.endStars) return;
    dom.endStars.hidden = !win;
    dom.endStarsText.hidden = !win;
    if (!win) return;
    let html = '';
    for (let i = 1; i <= 3; i++) {
      html += '<span class="end-star ' + (i <= stars ? 'on' : 'off') + '">' + STAR_SVG + '</span>';
    }
    dom.endStars.innerHTML = html;
    const text = stars + ' ' + starsWord(stars) + ' из 3';
    dom.endStars.setAttribute('aria-label', text);
    dom.endStarsText.textContent = text;
  }

  function renderEndFragment(tier) {
    if (!dom.endFragment) return;
    const name = tier && FRAGMENT_NAMES[tier];
    dom.endFragment.hidden = !name;
    if (!name) return;
    dom.endFragment.dataset.tier = tier;
    dom.endFragmentName.textContent = name;
  }

  function showEndScreen(win, bonus, breakdown) {
    const res = state.lastResult || {};
    const timed = isTimed();
    const level = currentLevel();
    let sub = win ? level.name : 'Цели не собраны — попробуйте ещё раз';
    /* Темп имеет смысл только в игре на время */
    if (win && timed && breakdown) sub += ' · средний темп ' + breakdown.paceLabel;
    dom.endCard.classList.toggle('lost', !win);
    dom.endTitle.textContent = win ? (res.landComplete ? 'Земля пройдена!' : 'Уровень пройден!') : 'Время вышло';
    dom.endSub.textContent = sub;
    renderEndStars(win, res.stars || 1);
    renderEndFragment(win ? res.newTier : null);
    dom.endScore.textContent = fmtNum(state.score);
    dom.endBonus.textContent = '+' + fmtNum(bonus);
    dom.endTime.textContent = timed ? fmtTime(state.timeLeft) : '∞';
    dom.nextBtn.style.display = win ? '' : 'none';
    dom.retryBtn.style.display = '';
    openOverlay('endScreen');
  }

  /* ---------- Запуск уровня ---------- */
  async function beginLevel(levelId) {
    const session = ++state.session;
    state.atHome = false;
    state.lastResult = null;
    applyLevel(levelId, state.difficulty);
    state.score = 0;
    state.ended = false;
    state.paused = false;
    state.timeUp = false;
    state.started = false;
    clearSelection();
    clearHints();
    closeAllOverlays();
    setCombo(1);
    setScore(0, false);
    updateSoundUI();
    updateTimerUI();
    SFX.musicStart('game');

    await buildBoard();
    if (session !== state.session) return;

    await runCountdown(session);
    if (session !== state.session) return;

    const level = currentLevel();
    state.running = true;
    state.paused = false;
    state.started = true;
    state.timeLeft = level.timer != null ? level.timer : level.econTime;
    state.totalTime = level.econTime;
    state.lastAction = now();
    updateTimerUI();
    setHint(level.name + ' — ' + hintMessages.default);
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

  /* Запуск уровня кампании. Сначала — хук Game.onBeforeLevel (сцены
     Task 9); пока он идёт, игра стоит. Сложность берётся текущая. */
  async function startLevel(levelId) {
    if (!Campaign.level(levelId)) return false;
    const session = ++state.session;
    state.running = false;
    state.paused = false;
    state.ended = false;
    state.started = false;
    clearSelection();
    clearHints();
    try {
      await Game.onBeforeLevel(levelId);
    } catch (e) { /* сцена не должна мешать игре */ }
    if (session !== state.session) return false;
    await beginLevel(levelId);
    return true;
  }

  function retryLevel() {
    SFX.click();
    return startLevel(state.levelId);
  }

  /* Пройден последний уровень земли: хук вызывается один раз за победу,
     когда игрок уходит с экрана итогов вперёд («Дальше» или «На карту»). */
  function finishLand(landId) {
    state.lastResult = null;
    try {
      const r = Game.onLandComplete(landId);
      if (r && typeof r.catch === 'function') r.catch(() => showHome());
    } catch (e) {
      showHome();
    }
  }

  /* Карту подключает js/screens/map.js (Game.showMap); без неё — стартовый экран. */
  function toMap() {
    const res = state.lastResult;
    if (res && res.landComplete) {
      SFX.click();
      finishLand(res.landComplete);
      return;
    }
    if (typeof Game.showMap === 'function') Game.showMap();
    else showHome();
  }

  function nextLevel() {
    SFX.click();
    const res = state.lastResult;
    const next = Campaign.nextLevelId(state.levelId);
    if (res && res.landComplete) {
      /* Финал земли ещё не видели — показываем его (и вступление следующей),
         потом карта. Повторное прохождение последнего уровня, когда финал
         уже видели, ведёт сразу в следующую землю, если она открыта. */
      const outroSeen = (state.save.seenScenes || []).indexOf(res.landComplete + '-outro') >= 0;
      if (outroSeen && next && Progress.isUnlocked(state.save, next, Campaign)) {
        state.lastResult = null;
        startLevel(next);
      } else {
        finishLand(res.landComplete);
      }
      return;
    }
    if (next) startLevel(next);
    else toMap();
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

  /* Стартовый экран; за ним — поле текущего уровня кампании. */
  async function showHome() {
    state.session++;
    state.running = false;
    state.paused = false;
    state.ended = false;
    state.started = false;
    state.busy = true;
    state.atHome = true;
    state.lastResult = null;
    clearSelection();
    clearHints();
    closeAllOverlays();
    applyLevel(Progress.currentLevelId(state.save, Campaign), state.difficulty);
    state.score = 0;
    setScore(0, false);
    dom.countdown.classList.add('hidden');
    updateStartUI();
    SFX.setUrgency(0);
    SFX.musicScene('menu');
    SFX.musicResume();
    openOverlay('startScreen');
    await buildBoard();
    setHint(hintMessages.default);
  }

  /* После импорта кода: сохранение заменяется целиком и сразу пишется.
     Аргумент проходит через ту же чистку, что и импорт кода (Progress).
     Сначала пишется новая запись, и только если запись удалась, меняется
     состояние сессии: при сбое прежний прогресс остаётся и в памяти, и на
     диске. Прежняя запись перед заменой копируется в sun-keeper-save-backup;
     предыдущая копия уезжает в sun-keeper-save-backup-prev (хранятся две). */
  function replaceSave(save) {
    if (!save || typeof save !== 'object' || !save.levels || typeof save.levels !== 'object') return false;
    let clean;
    try {
      const r = Progress.importCode(Progress.exportCode(save));
      if (!r.ok) return false;
      clean = r.save;
    } catch (e) {
      return false;
    }
    const storage = getStorage();
    const prev = Progress.readRaw(storage);
    /* Прежняя запись есть, а копию сделать не вышло — не затираем её */
    if (prev !== null) {
      try {
        const oldBackup = storage.getItem(BACKUP_KEY);
        if (oldBackup !== null && oldBackup !== undefined) storage.setItem(BACKUP_PREV_KEY, oldBackup);
        storage.setItem(BACKUP_KEY, prev);
      } catch (e) {
        return false;
      }
    }
    if (!Progress.persist(storage, clean)) return false;
    state.save = clean;
    state.difficulty = state.save.difficulty;
    if (state.atHome) {
      applyLevel(Progress.currentLevelId(state.save, Campaign), state.difficulty);
    }
    updateDifficultyUI();
    updateStartUI();
    // Открытая карта перерисовывается по этому событию
    window.dispatchEvent(new CustomEvent('sun:save-replaced'));
    return true;
  }

  /* Сцена показана (или пропущена) — запоминаем в сохранении. */
  function markSceneSeen(sceneId) {
    if (typeof sceneId !== 'string' || !sceneId) return false;
    if (!Array.isArray(state.save.seenScenes)) state.save.seenScenes = [];
    if (state.save.seenScenes.indexOf(sceneId) >= 0) return true;
    state.save.seenScenes.push(sceneId);
    return saveProgress();
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
    $('playBtn').addEventListener('click', () => {
      SFX.click();
      startLevel(Campaign.allLevelIds()[0]);
    });
    document.querySelectorAll('[data-difficulty-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        SFX.click();
        setDifficulty(btn.dataset.difficultyBtn);
      });
    });
    dom.continueBtn.addEventListener('click', () => {
      SFX.click();
      startLevel(Progress.currentLevelId(state.save, Campaign));
    });
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
      else if (state.overlay) showHome();
    });
    $('menuBtnMobile').addEventListener('click', () => {
      if (state.ended) return;
      if (state.running) pauseGame();
      else if (state.overlay) showHome();
    });
    $('resumeBtn').addEventListener('click', () => {
      SFX.click();
      resumeGame();
    });
    $('restartBtn').addEventListener('click', () => retryLevel());
    $('homeBtn').addEventListener('click', () => {
      SFX.click();
      showHome();
    });
    $('endHomeBtn').addEventListener('click', toMap);
    dom.nextBtn.addEventListener('click', nextLevel);
    dom.retryBtn.addEventListener('click', () => retryLevel());
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
      if (isTimed()) state.timeLeft = Math.max(0, state.timeLeft - dt);

      const cdBefore = state.shuffleCd;
      state.shuffleCd = Math.max(0, state.shuffleCd - dt);
      if (state.shuffleCd > 0) updateShuffleUI();
      else if (cdBefore > 0) updateShuffleUI();

      updateTimerUI();

      if (isTimed() && state.timeLeft <= 0) {
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
    loadSave();
    updateSoundUI();
    SFX.musicScene('menu');
    attachEvents();
    state.atHome = true;
    applyLevel(Progress.currentLevelId(state.save, Campaign), state.difficulty);
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
      // Запускает уровень кампании: __SUN.start('2-01')
      start: levelId => startLevel(levelId),
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

  /* ---------- Внешний интерфейс для экранов карты и сцен ----------
     Хуки onBeforeLevel / onLandComplete можно заменить присваиванием:
     игра вызывает их через Game.*, а не по ссылке. Карта
     подключается как Game.showMap. */
  const Game = {
    startLevel,
    getSave: () => JSON.parse(JSON.stringify(state.save)),
    setDifficulty,
    getDifficulty: () => state.difficulty,
    replaceSave,
    showHome,
    // Для экранов поверх игры (карта): оверлеи и флаг «поверх поля»
    openOverlay,
    closeOverlay,
    closeAllOverlays,
    markSceneSeen,
    // Перед запуском уровня (пролог, вступление земли). Можно вернуть Promise.
    onBeforeLevel() {},
    // Карта пути подключается в js/screens/map.js как Game.showMap.
    // Пройден последний уровень земли: по умолчанию — на карту или в меню.
    onLandComplete() {
      if (typeof Game.showMap === 'function') Game.showMap();
      else showHome();
    }
  };
  window.Game = Game;

  init();
})();


