/* Хранитель Солнца — перенос прогресса между браузерами.
 *
 * Показывает код текущего прогресса (Progress.exportCode) и принимает чужой
 * (Progress.importCode → Game.replaceSave). Всё внутри оверлея #transferScreen,
 * без системных диалогов. При ошибке кода сохранение не трогается.
 */
(() => {
  'use strict';

  const Game = window.Game;
  const Progress = window.Progress;
  if (!Game || !Progress) return;

  const $ = id => document.getElementById(id);
  const root = $('transferScreen');
  if (!root) return;

  const exportField = $('transferExport');
  const copyBtn = $('transferCopyBtn');
  const copyNote = $('transferCopyNote');
  const importField = $('transferImport');
  const loadBtn = $('transferLoadBtn');
  const loadNote = $('transferLoadNote');

  function setNote(node, text, kind) {
    node.textContent = text;
    node.className = 'transfer-note' + (kind ? ' ' + kind : '');
  }

  function refreshExport() {
    exportField.value = Progress.exportCode(Game.getSave());
  }

  function open() {
    refreshExport();
    importField.value = '';
    setNote(copyNote, '');
    setNote(loadNote, '');
    Game.openOverlay('transferScreen');
    copyBtn.focus({ preventScroll: true });
  }

  function selectExport() {
    exportField.focus();
    exportField.select();
    try { exportField.setSelectionRange(0, exportField.value.length); } catch (e) { /* ignore */ }
  }

  function showManualHint() {
    selectExport();
    setNote(copyNote, 'Код выделен. Нажмите Ctrl+C, чтобы скопировать.', 'hint');
  }

  async function copy() {
    if (window.SFX) window.SFX.click();
    refreshExport();
    const text = exportField.value;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        /* Браузер может промолчать (нет разрешения) — ждём недолго */
        await Promise.race([
          navigator.clipboard.writeText(text),
          new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
        ]);
        selectExport();
        setNote(copyNote, 'Код скопирован', 'ok');
        return;
      } catch (e) { /* ниже — ручное копирование */ }
    }
    showManualHint();
  }

  function load() {
    if (window.SFX) window.SFX.click();
    const result = Progress.importCode(importField.value);
    if (!result.ok) {
      setNote(loadNote, result.error, 'error');
      return;
    }
    if (!Game.replaceSave(result.save)) {
      setNote(loadNote, 'Не удалось сохранить прогресс. Прежний прогресс не изменён.', 'error');
      return;
    }
    importField.value = '';
    refreshExport();
    setNote(loadNote, 'Прогресс загружен', 'ok');
  }

  $('transferBtn').addEventListener('click', () => {
    if (window.SFX) window.SFX.click();
    open();
  });
  $('transferBackBtn').addEventListener('click', () => {
    if (window.SFX) window.SFX.click();
    Game.closeOverlay('transferScreen');
  });
  copyBtn.addEventListener('click', copy);
  loadBtn.addEventListener('click', load);
  exportField.addEventListener('focus', () => exportField.select());
  importField.addEventListener('input', () => setNote(loadNote, ''));
})();
