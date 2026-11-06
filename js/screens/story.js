/* Хранитель Солнца — сюжетные сцены: пролог, вступление и финал земли.
 *
 * Сцены идут по одной фразе крупным шрифтом на фоне земли; «Дальше» листает,
 * «Пропустить» закрывает сцену. Показанная (или пропущенная) сцена
 * запоминается в сохранении через Game.markSceneSeen — сама не повторяется,
 * пересмотреть можно кнопкой «История» на карте.
 *
 * Чистая часть (nextScenes) не зависит от DOM и проверяется в Node. В
 * браузере модуль ещё ставит хуки Game.onBeforeLevel / Game.onLandComplete.
 */
(function (factory) {
  'use strict';

  const Story = factory();

  if (typeof window !== 'undefined') {
    window.Story = Story;
    Story.install();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = Story;
})(function () {
  'use strict';

  const PROLOGUE_ID = 'prologue';

  function hasSeen(save, sceneId) {
    return !!(save && Array.isArray(save.seenScenes) && save.seenScenes.indexOf(sceneId) >= 0);
  }

  /* Какие сцены показать перед стартом уровня (по порядку): пролог, если он
     ещё не показан, и вступление земли этого уровня, если оно не показано —
     независимо от результатов. Игрок со старым сохранением видит их один раз. */
  function nextScenes(save, levelId, campaign) {
    const out = [];
    const land = campaign && campaign.landOf ? campaign.landOf(levelId) : null;
    if (!land) return out;
    if (!hasSeen(save, PROLOGUE_ID)) out.push(PROLOGUE_ID);
    const introId = land.id + '-intro';
    if (!hasSeen(save, introId)) out.push(introId);
    return out;
  }

  /* ---------------- Браузерная часть ---------------- */
  let playing = null;
  let lastSkipped = false;

  function sceneLand(sceneId) {
    const lands = window.Campaign.lands();
    const m = /^(\d+)-/.exec(sceneId);
    if (m) {
      const land = lands.find(l => l.id === Number(m[1]));
      if (land) return land;
    }
    return lands[0] || null;
  }

  /* Одна сцена. Пока она идёт, повторный вызов возвращает тот же Promise. */
  function play(sceneId, lines) {
    if (playing) return playing;
    lastSkipped = false;
    const root = document.getElementById('storyScreen');
    const Game = window.Game;
    if (!root || !Game || !Array.isArray(lines) || lines.length === 0) return Promise.resolve();

    const textNode = document.getElementById('storyText');
    const stepNode = document.getElementById('storyStep');
    const nextBtn = document.getElementById('storyNextBtn');
    const skipBtn = document.getElementById('storySkipBtn');
    const land = sceneLand(sceneId);
    root.style.backgroundImage = land && land.bg ? 'url("' + land.bg + '")' : '';

    playing = new Promise(resolve => {
      let index = 0;
      let finished = false;
      let swapTimer = 0;

      function showLine() {
        textNode.classList.remove('shown');
        clearTimeout(swapTimer);
        swapTimer = setTimeout(() => {
          textNode.textContent = lines[index];
          stepNode.textContent = (index + 1) + ' из ' + lines.length;
          textNode.classList.add('shown');
        }, index === 0 ? 0 : 220);
      }

      function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(swapTimer);
        nextBtn.removeEventListener('click', onNext);
        skipBtn.removeEventListener('click', onSkip);
        Game.markSceneSeen(sceneId);
        Game.closeOverlay('storyScreen');
        playing = null;
        resolve();
      }

      function onNext() {
        if (window.SFX) window.SFX.click();
        index++;
        if (index >= lines.length) finish();
        else showLine();
      }

      function onSkip() {
        if (window.SFX) window.SFX.click();
        lastSkipped = true;
        finish();
      }

      nextBtn.addEventListener('click', onNext);
      skipBtn.addEventListener('click', onSkip);
      showLine();
      Game.openOverlay('storyScreen');
      nextBtn.focus({ preventScroll: true });
    });
    return playing;
  }

  /* Сцены подряд; со stopOnSkip «Пропустить» обрывает всю цепочку */
  async function playList(items, stopOnSkip) {
    for (const item of items) {
      await play(item.id, item.lines);
      if (stopOnSkip && lastSkipped) break;
    }
  }

  function sceneLines(sceneId) {
    const Campaign = window.Campaign;
    if (sceneId === PROLOGUE_ID) return Campaign.PROLOGUE;
    const m = /^(\d+)-(intro|outro)$/.exec(sceneId);
    if (!m) return null;
    const land = Campaign.lands().find(l => l.id === Number(m[1]));
    return land && land.scenes ? land.scenes[m[2]] : null;
  }

  /* «История» на карте: пролог (для первой земли), вступление и, если
     земля пройдена, финал. Показываются независимо от «уже видел». */
  function replayLand(landId) {
    const items = [];
    if (landId === 1) items.push({ id: PROLOGUE_ID, lines: sceneLines(PROLOGUE_ID) });
    items.push({ id: landId + '-intro', lines: sceneLines(landId + '-intro') });
    if (hasSeen(window.Game.getSave(), landId + '-outro')) {
      items.push({ id: landId + '-outro', lines: sceneLines(landId + '-outro') });
    }
    return playList(items, true);
  }

  function install() {
    const Game = window.Game;
    const Campaign = window.Campaign;
    if (!Game || !Campaign) return;

    let beforePending = null;
    let landPending = null;

    /* Пока сцены идут, повторный вызов получает тот же Promise: двойной
       щелчок не запускает уровень или сцену дважды. */
    Game.onBeforeLevel = function (levelId) {
      if (beforePending) return beforePending;
      const ids = nextScenes(Game.getSave(), levelId, Campaign);
      if (ids.length === 0) return undefined;
      /* Итоги и паузу закрываем до ожидания, чтобы их кнопки не нажимались */
      Game.closeAllOverlays();
      beforePending = playList(ids.map(id => ({ id, lines: sceneLines(id) })))
        .catch(() => { /* сцена не должна мешать игре */ })
        .then(() => { beforePending = null; });
      return beforePending;
    };

    Game.onLandComplete = function (landId) {
      if (landPending) return landPending;
      Game.closeAllOverlays();
      landPending = (async () => {
        const items = [];
        const save = Game.getSave();
        const outroId = landId + '-outro';
        if (!hasSeen(save, outroId)) items.push({ id: outroId, lines: sceneLines(outroId) });
        const next = Campaign.lands().find(l => l.id === landId + 1);
        if (next) {
          const introId = next.id + '-intro';
          if (!hasSeen(save, introId)) items.push({ id: introId, lines: sceneLines(introId) });
        }
        try {
          await playList(items);
        } catch (e) { /* к карте всё равно вернёмся */ }
        landPending = null;
        if (typeof Game.showMap === 'function') Game.showMap();
        else Game.showHome();
      })();
      return landPending;
    };
  }

  return { PROLOGUE_ID, nextScenes, play, replayLand, sceneLines, install };
});
