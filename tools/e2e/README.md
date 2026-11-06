# Браузерные проверки (Playwright)

`run.js` проходит 14 сценариев в Firefox (главный браузер игрока), WebKit (вместо Safari) и Chromium. Среди них: первый запуск и пролог, уровни на всех сложностях, лианы, проигрыш по времени, перенос старого сохранения, перенос прогресса кодом, порядок сцен в конце главы и раскладка на 1366×768 и 390×844 (кнопки не меньше 56px, страница не уходит вбок). Звук выключен: флажок игры `sun-treasures-muted` плюс заглушение в самом браузере.

Playwright ставится **вне проекта**, у игры зависимостей нет:

```bash
mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright && npx playwright install firefox webkit chromium
# из корня игры:
python3 -m http.server 8775 &
NODE_PATH=/tmp/pw/node_modules node tools/e2e/run.js
```

Скриншоты и `results-*.json` пишутся в `$E2E_OUT` (по умолчанию `<tmp>/hranitel-e2e`). Корень игры задаёт `GAME_ROOT`, порт задаёт `PORT`.
