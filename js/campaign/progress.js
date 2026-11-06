/* Хранитель Солнца — прогресс кампании: сохранение v2, миграция, перенос.
 *
 * Модуль не зависит от DOM. Хранилище (localStorage или заглушка в тестах)
 * передаётся снаружи. load() ничего не пишет: перенос старого сохранения
 * фиксируется позже, когда игра сама вызовет persist(). Старый ключ не
 * удаляется никогда.
 *
 * Формат (ключ sun-keeper-save):
 *   { version: 2, difficulty: 'calm', best: 0,
 *     levels: { '1-01': { calm: {stars, best}, normal: {…}, challenge: {…} } },
 *     seenScenes: ['prologue', …] }
 */
(function (factory) {
  'use strict';

  const Progress = factory();

  if (typeof window !== 'undefined') window.Progress = Progress;
  if (typeof module !== 'undefined' && module.exports) module.exports = Progress;
})(function () {
  'use strict';

  const KEY = 'sun-keeper-save';
  const OLD_KEY = 'sun-treasures-save';
  const VERSION = 2;
  const CODE_PREFIX = 'HS2-';
  const CODE_MAX_LENGTH = 200000;
  const IMPORT_ERROR = 'Код не подходит. Проверьте, что он скопирован целиком.';

  const DIFFICULTIES = ['calm', 'normal', 'challenge'];
  const TIER_BY_DIFFICULTY = { calm: 'stone', normal: 'silver', challenge: 'gold' };
  const LEVEL_ID = /^\d+-\d+$/;

  /* ---------------------------------------------------------------- */
  /* Вспомогательное                                                  */
  /* ---------------------------------------------------------------- */

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function num(v) {
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
  }

  function getCampaign() {
    if (typeof window !== 'undefined' && window.Campaign) return window.Campaign;
    if (typeof require === 'function') return require('./campaign.js');
    return null;
  }

  function empty() {
    return { version: VERSION, difficulty: 'calm', best: 0, levels: {}, seenScenes: [] };
  }

  /* Строгая проверка структуры (для импорта и нового ключа). */
  function isValidShape(obj) {
    return isObject(obj) &&
      obj.version === VERSION &&
      isObject(obj.levels) &&
      DIFFICULTIES.indexOf(obj.difficulty) >= 0;
  }

  /* Мягкая проверка для чтения с диска: прогресс не выбрасываем из-за
   * одного испорченного поля (сложность подменяется на 'calm'). */
  function isLoadable(obj) {
    return isObject(obj) && obj.version === VERSION && isObject(obj.levels);
  }

  /* Чистая копия: оставляет только годные поля, остальное отбрасывает.
   * Идемпотентна для корректного сохранения (round-trip не меняет его). */
  function normalize(obj) {
    const out = empty();
    if (DIFFICULTIES.indexOf(obj.difficulty) >= 0) out.difficulty = obj.difficulty;
    out.best = num(obj.best);

    Object.keys(obj.levels).forEach(id => {
      if (!LEVEL_ID.test(id) || !isObject(obj.levels[id])) return;
      const entry = {};
      DIFFICULTIES.forEach(d => {
        const r = obj.levels[id][d];
        if (!isObject(r)) return;
        const stars = Math.floor(num(r.stars));
        if (stars < 1) return;
        entry[d] = { stars: Math.min(3, stars), best: num(r.best) };
      });
      if (Object.keys(entry).length) out.levels[id] = entry;
    });

    if (Array.isArray(obj.seenScenes)) {
      obj.seenScenes.forEach(s => {
        if (typeof s === 'string' && out.seenScenes.indexOf(s) < 0) out.seenScenes.push(s);
      });
    }
    return out;
  }

  function clone(save) {
    return normalize(save);
  }

  function isPassed(save, levelId) {
    const e = save && save.levels && save.levels[levelId];
    if (!isObject(e)) return false;
    return DIFFICULTIES.some(d => isObject(e[d]) && e[d].stars >= 1);
  }

  /* ---------------------------------------------------------------- */
  /* Загрузка, миграция, запись                                       */
  /* ---------------------------------------------------------------- */

  function migrateV1(old, levelIds) {
    const save = empty();
    const o = isObject(old) ? old : {};
    const relaxed = typeof o.relaxed === 'boolean' ? o.relaxed : true;
    const diff = relaxed ? 'calm' : 'normal';
    const ids = Array.isArray(levelIds) ? levelIds : [];
    const unlocked = typeof o.unlocked === 'number' && isFinite(o.unlocked)
      ? Math.max(0, Math.min(ids.length, Math.floor(o.unlocked)))
      : 0;

    save.difficulty = diff;
    save.best = num(o.best);
    for (let i = 0; i < unlocked; i++) {
      save.levels[ids[i]] = { [diff]: { stars: 1, best: 0 } };
    }
    return save;
  }

  function load(storage, levelIds) {
    try {
      const raw = storage.getItem(KEY);
      if (raw !== null && raw !== undefined) {
        const obj = JSON.parse(raw);
        return isLoadable(obj) ? normalize(obj) : empty();
      }
      const oldRaw = storage.getItem(OLD_KEY);
      if (oldRaw !== null && oldRaw !== undefined) {
        const ids = levelIds || getCampaign().allLevelIds();
        return migrateV1(JSON.parse(oldRaw), ids);
      }
    } catch (e) {
      /* битые данные или недоступное хранилище — начинаем с нуля, не перезаписывая */
    }
    return empty();
  }

  function persist(storage, save) {
    try {
      storage.setItem(KEY, JSON.stringify(save));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Результаты                                                       */
  /* ---------------------------------------------------------------- */

  function fragmentTier(save, levelId) {
    const e = save && save.levels && save.levels[levelId];
    if (!isObject(e)) return null;
    for (let i = DIFFICULTIES.length - 1; i >= 0; i--) {
      const r = e[DIFFICULTIES[i]];
      if (isObject(r) && r.stars >= 1) return TIER_BY_DIFFICULTY[DIFFICULTIES[i]];
    }
    return null;
  }

  function isKnownLevel(levelId) {
    if (typeof levelId !== 'string' || !LEVEL_ID.test(levelId)) return false;
    try {
      return getCampaign().allLevelIds().indexOf(levelId) >= 0;
    } catch (e) {
      return true;
    }
  }

  function record(save, levelId, difficulty, score, stars) {
    const next = clone(save);
    if (!isKnownLevel(levelId) || DIFFICULTIES.indexOf(difficulty) < 0) {
      return { save: next, improved: false, newTier: null };
    }
    const tierBefore = fragmentTier(next, levelId);
    const pts = num(score);
    const st = Math.min(3, Math.max(1, Math.floor(num(stars)) || 1));

    const levelEntry = next.levels[levelId] || (next.levels[levelId] = {});
    const prev = levelEntry[difficulty];
    let improved = false;
    if (!prev) {
      levelEntry[difficulty] = { stars: st, best: pts };
      improved = true;
    } else {
      if (st > prev.stars) { prev.stars = st; improved = true; }
      if (pts > prev.best) { prev.best = pts; improved = true; }
    }
    if (pts > next.best) next.best = pts;

    const tierAfter = fragmentTier(next, levelId);
    const newTier = tierAfter !== tierBefore ? tierAfter : null;
    return { save: next, improved, newTier };
  }

  function isUnlocked(save, levelId, campaign) {
    const ids = campaign.allLevelIds();
    const i = ids.indexOf(levelId);
    if (i < 0) return false;
    if (i === 0) return true;
    return isPassed(save, ids[i - 1]);
  }

  function currentLevelId(save, campaign) {
    const ids = campaign.allLevelIds();
    for (let i = 0; i < ids.length; i++) {
      if (!isPassed(save, ids[i])) return ids[i];
    }
    return ids[ids.length - 1];
  }

  function starsTotal(save) {
    let sum = 0;
    const levels = save && save.levels;
    if (!isObject(levels)) return 0;
    Object.keys(levels).forEach(id => {
      DIFFICULTIES.forEach(d => {
        const r = isObject(levels[id]) ? levels[id][d] : null;
        if (isObject(r)) sum += num(r.stars);
      });
    });
    return sum;
  }

  /* ---------------------------------------------------------------- */
  /* Перенос кодом                                                    */
  /* ---------------------------------------------------------------- */

  /* FNV-1a, 32 бита, по символам строки; результат — 8 hex-цифр. */
  function checksum(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /* UTF-8-безопасный base64: Buffer в Node, btoa/atob в браузере. */
  function toBase64(str) {
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(str)));
  }

  function fromBase64(b64) {
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(b64)));
  }

  function exportCode(save) {
    const b64 = toBase64(String(JSON.stringify(save)));
    return CODE_PREFIX + b64 + '.' + checksum(b64);
  }

  function importCode(code) {
    const fail = { ok: false, error: IMPORT_ERROR };
    try {
      if (typeof code !== 'string') return fail;
      const text = code.replace(/\s+/g, '');
      if (text.length > CODE_MAX_LENGTH) return fail;
      if (text.slice(0, CODE_PREFIX.length).toUpperCase() !== CODE_PREFIX) return fail;
      const dot = text.lastIndexOf('.');
      if (dot < CODE_PREFIX.length) return fail;
      const b64 = text.slice(CODE_PREFIX.length, dot);
      const sum = text.slice(dot + 1).toLowerCase();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return fail;
      if (sum !== checksum(b64)) return fail;
      const obj = JSON.parse(fromBase64(b64));
      if (!isValidShape(obj)) return fail;
      return { ok: true, save: normalize(obj) };
    } catch (e) {
      return fail;
    }
  }

  return {
    KEY,
    OLD_KEY,
    empty,
    load,
    migrateV1,
    persist,
    record,
    fragmentTier,
    isUnlocked,
    currentLevelId,
    starsTotal,
    exportCode,
    importCode
  };
});
