/* Хранитель Солнца — карта пути: земли, мозаики осколков, кнопки уровней.
 *
 * Подключается после js/game.js и добавляет Game.showMap(). Всё рисуется в
 * готовый оверлей #mapScreen из index.html. Прогресс только читается
 * (Game.getSave), запуск уровня — через Game.startLevel.
 * Разметку собираем через DOM и textContent: данные кампании в HTML не
 * подставляются строкой.
 */
(() => {
  'use strict';

  const Game = window.Game;
  const Campaign = window.Campaign;
  const Progress = window.Progress;
  if (!Game || !Campaign || !Progress) return;

  const TOTAL_LANDS = 10;
  const LEVELS_PER_LAND = 20;
  const MOSAIC_COLS = 5;
  const MOSAIC_ROWS = 4;
  /* Названия земель, которых ещё нет в данных (по замыслу кампании) */
  const SOON_NAMES = {
    4: 'Горная тропа',
    5: 'Озёрный город',
    6: 'Болота',
    7: 'Вулкан',
    8: 'Подземный мир',
    9: 'Ветреные вершины',
    10: 'Небесный храм'
  };
  const TIER_NAMES = { stone: 'Каменный осколок', silver: 'Серебряный осколок', gold: 'Золотой осколок' };
  const TIER_HINTS = { stone: 'Спокойно', silver: 'Обычно', gold: 'Испытание' };
  const LOCKED_NOTE = 'Этот уровень откроется, когда будет пройден предыдущий.';

  const root = document.getElementById('mapScreen');
  const landsBox = document.getElementById('mapLands');
  const starsTotalNode = document.getElementById('mapStarsTotal');
  if (!root || !landsBox) return;

  let selectedLandId = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgLock() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'lv-lock');
    svg.setAttribute('aria-hidden', 'true');
    const body = document.createElementNS(ns, 'rect');
    body.setAttribute('x', '22'); body.setAttribute('y', '44');
    body.setAttribute('width', '56'); body.setAttribute('height', '42');
    body.setAttribute('rx', '7');
    const arc = document.createElementNS(ns, 'path');
    arc.setAttribute('d', 'M32 46 V32 a18 18 0 0 1 36 0 V46');
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', 'currentColor');
    arc.setAttribute('stroke-width', '9');
    arc.setAttribute('stroke-linecap', 'round');
    svg.appendChild(arc);
    svg.appendChild(body);
    return svg;
  }

  function starsText(count) {
    return '★'.repeat(count) + '☆'.repeat(3 - count);
  }

  function starsLabel(count) {
    if (count === 0) return 'без звёзд';
    if (count === 1) return '1 звезда';
    return count + ' звезды';
  }

  function levelNumber(id) {
    return parseInt(String(id).split('-')[1], 10);
  }

  function starsOf(save, id, difficulty) {
    const e = save.levels && save.levels[id];
    const r = e && e[difficulty];
    return r && r.stars >= 1 ? Math.min(3, r.stars) : 0;
  }

  function fragmentCount(save, land) {
    let n = 0;
    land.levels.forEach(lv => { if (Progress.fragmentTier(save, lv.id)) n++; });
    return n;
  }

  /* ---------- Мозаика 5×4 ---------- */
  function buildMosaic(land, save) {
    const box = el('div', 'mosaic');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Мозаика земли: ' + land.name);
    land.levels.forEach((lv, i) => {
      const col = i % MOSAIC_COLS;
      const row = Math.floor(i / MOSAIC_COLS);
      const tier = Progress.fragmentTier(save, lv.id);
      const cell = el('div', 'mosaic-cell ' + (tier ? 'tier-' + tier : 'empty'));
      const n = levelNumber(lv.id);
      if (tier) {
        cell.style.backgroundImage = 'url("' + land.mosaic + '")';
        cell.style.backgroundSize = (MOSAIC_COLS * 100) + '% ' + (MOSAIC_ROWS * 100) + '%';
        cell.style.backgroundPosition =
          (col / (MOSAIC_COLS - 1) * 100) + '% ' + (row / (MOSAIC_ROWS - 1) * 100) + '%';
        cell.title = 'Уровень ' + n + ': ' + TIER_NAMES[tier];
        cell.setAttribute('aria-label', 'Уровень ' + n + ': ' + TIER_NAMES[tier]);
      } else {
        cell.title = 'Уровень ' + n + ': осколок ещё не найден';
        cell.setAttribute('aria-label', 'Уровень ' + n + ': осколок ещё не найден');
      }
      cell.appendChild(el('span', 'mosaic-num', String(n)));
      box.appendChild(cell);
    });
    return box;
  }

  function buildLegend() {
    const box = el('ul', 'mosaic-legend');
    ['stone', 'silver', 'gold'].forEach(tier => {
      const item = el('li');
      item.appendChild(el('span', 'legend-swatch tier-' + tier));
      item.appendChild(el('span', null, TIER_NAMES[tier].replace(' осколок', '') + ' — ' + TIER_HINTS[tier]));
      box.appendChild(item);
    });
    const dark = el('li');
    dark.appendChild(el('span', 'legend-swatch empty'));
    dark.appendChild(el('span', null, 'Тёмная плита — осколок ещё не найден'));
    box.appendChild(dark);
    return box;
  }

  /* ---------- Кнопки уровней ---------- */
  function buildLevels(land, save, difficulty, noteNode) {
    const grid = el('div', 'level-grid');
    const currentId = Progress.currentLevelId(save, Campaign);
    land.levels.forEach(lv => {
      const n = levelNumber(lv.id);
      const unlocked = Progress.isUnlocked(save, lv.id, Campaign);
      const stars = starsOf(save, lv.id, difficulty);
      const btn = el('button', 'level-btn');
      btn.type = 'button';
      btn.dataset.levelId = lv.id;
      btn.appendChild(el('span', 'lv-num', String(n)));
      if (unlocked) {
        btn.appendChild(el('span', 'lv-stars', starsText(stars)));
        btn.setAttribute('aria-label', 'Уровень ' + n + ', ' + lv.name + ', ' + starsLabel(stars));
        btn.title = lv.name;
        if (lv.id === currentId) {
          btn.classList.add('current');
          btn.setAttribute('aria-current', 'true');
        }
      } else {
        btn.classList.add('locked');
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('aria-label', 'Уровень ' + n + ', закрыт');
        btn.appendChild(svgLock());
      }
      btn.addEventListener('click', () => {
        if (!Progress.isUnlocked(Game.getSave(), lv.id, Campaign)) {
          noteNode.textContent = LOCKED_NOTE;
          noteNode.classList.add('show');
          return;
        }
        if (window.SFX) window.SFX.click();
        Game.startLevel(lv.id);
      });
      grid.appendChild(btn);
    });
    return grid;
  }

  /* «История» — пересмотреть вступление (и финал, если он уже показан) */
  function buildStoryBtn(land) {
    const btn = el('button', 'stone-btn wide story-open-btn', 'История');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (window.SFX) window.SFX.click();
      if (window.Story) window.Story.replayLand(land.id);
    });
    return btn;
  }

  /* ---------- Земли ---------- */
  function buildLandCard(land, save, difficulty) {
    const selected = land.id === selectedLandId;
    const card = el('section', 'land-card' + (selected ? ' selected' : ''));
    const head = el('button', 'land-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(selected));
    head.appendChild(el('span', 'land-name', land.id + '. ' + land.name));
    head.appendChild(el('span', 'land-count',
      'Осколков: ' + fragmentCount(save, land) + ' из ' + LEVELS_PER_LAND));
    head.addEventListener('click', () => {
      if (window.SFX) window.SFX.click();
      selectedLandId = land.id;
      render();
      const node = landsBox.querySelector('.land-card.selected');
      if (node && node.scrollIntoView) node.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
    card.appendChild(head);

    if (selected) {
      const body = el('div', 'land-body');
      const left = el('div', 'land-mosaic-col');
      left.appendChild(buildMosaic(land, save));
      left.appendChild(buildLegend());
      left.appendChild(buildStoryBtn(land));
      const right = el('div', 'land-levels-col');
      const note = el('p', 'level-note');
      note.setAttribute('role', 'status');
      right.appendChild(el('h3', 'levels-title', 'Уровни'));
      right.appendChild(buildLevels(land, save, difficulty, note));
      right.appendChild(note);
      body.appendChild(left);
      body.appendChild(right);
      card.appendChild(body);
    }
    return card;
  }

  function buildSoonCard(id) {
    const card = el('section', 'land-card soon');
    card.setAttribute('aria-disabled', 'true');
    const head = el('div', 'land-head');
    head.appendChild(el('span', 'land-name', id + '. ' + (SOON_NAMES[id] || 'Земля ' + id)));
    head.appendChild(el('span', 'land-soon', 'Скоро'));
    card.appendChild(head);
    return card;
  }

  /* ---------- Полёт осколка на мозаику ----------
     Только оформление: прогресс уже записан, ячейка в DOM уже готова и лишь
     притушена на время полёта. Уход с карты или перерисовка обрывают полёт. */
  let flight = null;

  function cancelFlight() {
    if (flight) flight.stop();
  }

  function playShardFlight(shard) {
    const land = Campaign.landOf(shard.levelId);
    if (!land || window.Tx && window.Tx.reduced()) return;
    const index = land.levels.findIndex(lv => lv.id === shard.levelId);
    const cell = landsBox.querySelectorAll('.land-card.selected .mosaic-cell')[index];
    if (!cell) return;
    if (cell.scrollIntoView) cell.scrollIntoView({ block: 'center', behavior: 'auto' });

    const rect = cell.getBoundingClientRect();
    const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
    const dy = window.innerHeight * 0.46 - (rect.top + rect.height / 2);
    const big = Math.min(2.6, 150 / Math.max(rect.width, 1));

    const fly = el('div', 'shard-fly tier-' + shard.tier);
    fly.setAttribute('aria-hidden', 'true');
    fly.style.cssText = 'left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width +
      'px;height:' + rect.height + 'px;';
    fly.style.backgroundImage = cell.style.backgroundImage;
    fly.style.backgroundSize = cell.style.backgroundSize;
    fly.style.backgroundPosition = cell.style.backgroundPosition;
    document.body.appendChild(fly);
    cell.classList.add('shard-pending');

    const at = (x, y, s, opacity, offset) =>
      ({ transform: 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')', opacity, offset });
    const anim = fly.animate([
      at(dx, dy, big * 0.85, 0, 0),
      at(dx, dy, big, 1, 0.2),
      at(dx, dy, big, 1, 0.38),
      at(dx * 0.42, dy * 0.42 - 70, (big + 1) / 2, 1, 0.72),
      at(0, 0, 1, 1, 1)
    ], { duration: 1300, delay: 420, easing: 'ease-in-out', fill: 'both' });

    const watch = new MutationObserver(() => {
      if (!root.classList.contains('show')) cancelFlight();
    });
    watch.observe(root, { attributes: true, attributeFilter: ['class'] });

    const current = {
      stop(landed) {
        if (flight !== current) return;
        flight = null;
        watch.disconnect();
        anim.onfinish = null;
        anim.cancel();
        fly.remove();
        cell.classList.remove('shard-pending');
        if (!landed) return;
        cell.classList.add('shard-landed');
        setTimeout(() => cell.classList.remove('shard-landed'), 950);
        if (window.SFX) window.SFX.tone(660, 0.22, { type: 'triangle', gain: 0.06 });
      }
    };
    flight = current;
    anim.onfinish = () => current.stop(true);
  }

  function render() {
    cancelFlight();
    const save = Game.getSave();
    const difficulty = Game.getDifficulty();
    const lands = Campaign.lands();
    if (selectedLandId === null || !lands.some(l => l.id === selectedLandId)) {
      const cur = Campaign.landOf(Progress.currentLevelId(save, Campaign));
      selectedLandId = cur ? cur.id : (lands[0] ? lands[0].id : null);
    }
    starsTotalNode.textContent = String(Progress.starsTotal(save));
    landsBox.textContent = '';
    for (let id = 1; id <= TOTAL_LANDS; id++) {
      const land = lands.find(l => l.id === id);
      landsBox.appendChild(land ? buildLandCard(land, save, difficulty) : buildSoonCard(id));
    }
  }

  function isOpen() {
    return root.classList.contains('show');
  }

  /* Карта открывается с земли текущего уровня */
  function showMap() {
    const shard = Game.takeShard();
    const shardLand = shard && Campaign.landOf(shard.levelId);
    selectedLandId = shardLand ? shardLand.id : null;
    render();
    Game.closeAllOverlays();
    Game.openOverlay('mapScreen');
    root.scrollTop = 0;
    if (shard) playShardFlight(shard);
  }

  Game.showMap = showMap;

  document.getElementById('mapBtn').addEventListener('click', () => {
    if (window.SFX) window.SFX.click();
    showMap();
  });
  document.getElementById('mapBackBtn').addEventListener('click', () => {
    if (window.SFX) window.SFX.click();
    Game.showHome();
  });
  /* Игра уже сменила сложность своим обработчиком; здесь — перерисовка звёзд */
  root.querySelectorAll('[data-difficulty-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      Game.setDifficulty(btn.dataset.difficultyBtn);
      render();
    });
  });
  window.addEventListener('sun:save-replaced', () => {
    if (isOpen()) render();
  });
})();
