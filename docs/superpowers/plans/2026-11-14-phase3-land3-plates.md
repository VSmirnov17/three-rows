# Этап 3, земля 3 «Лунные пещеры»: золотые плиты — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Землю 3 можно пройти в игре: плиты видны под камнями, снимаются рядами, считаются в целях; все 20 уровней проходимы ботом на трёх сложностях; у земли свой фон.

**Architecture:** Правило снятия плит уже живёт в чистом ядре (`Board.makePlates`, `Board.hitPlates`, `js/core/board.js`) и в боте (`tools/level-bot.js`), пороги звёзд в `js/campaign/land-03.js` подобраны по нему. `js/game.js` только держит `state.plates`, рисует слой `#plates` под `#tiles` и снимает плиты тем же вызовом `Board.hitPlates` в `playStep`. Вид плиты — CSS (`css/plates.css`), фон земли — плита Codex через `tools/pack_backdrop.py --land 3`.

**Tech Stack:** ванильный JS без сборки (работает с `file://`), CSS-анимации `transform`/`opacity`; Node `node:test`; Playwright вне проекта (`tools/e2e/run.js`); Codex для арта.

**Spec:** `docs/superpowers/specs/2026-11-06-hranitel-solnca-design.md` — §5 (земля 3, обучение на первом уровне), §6, §8 (живые фоны), §10 (бот-проверка), §11 п.3. Правила проекта — `docs/superpowers/STATUS.md`, «Правила работы».

## Что уже сделано (коммит `c18e255`, влит в `main` локально, НЕ запушен)

- `js/campaign/land-03.js`: 20 уровней, раскладки `o`/`#`/`+`/`~`, цели, время, сцены, пороги звёзд.
- `js/campaign/campaign.js`: `resolve()` отдаёт `plates: [[r, c], …]` и цель `{ type: 'plates', need }`; проверка данных знает плиты.
- `js/core/board.js`: `makePlates(list) -> number[8][8]`, `platesLeft(plates) -> number`, `hitPlates(plates, plan) -> [{ r, c, left }]` (снимает слой с клеток `plan.clear`, `plan.unlocks`, `plan.creates`; меняет `plates`).
- `tools/level-bot.js` играет с плитами; плиты очков не дают.
- Начато в рабочей копии (не закоммичено): слой `<div class="plates-layer" id="plates">` в `index.html`, `css/plates.css`, `.plates-layer` в двух правилах `inset: 0` в `css/hud.css`.

**Сейчас в `main` падение:** `applyLevel` превращает цель `plates` в цветную, `renderGoals` падает на `ART.GEMS[undefined]`. `main` не пушить, пока не закрыта задача 1.

## Global Constraints

- Игрок — пожилой отец: всё крупно, кнопки от 56 px, текст на кнопках от 20 px, высокий контраст, без резких вспышек и суеты.
- Главный браузер — Firefox на Windows; проверять в Firefox, WebKit и Chromium через `tools/e2e/run.js`.
- В любых тестах звук выключен: флажок `sun-treasures-muted` плюс заглушение браузера.
- Без сборки и npm-зависимостей у игры; работает и с хостинга, и с `file://`.
- Тексты UI — HTML поверх текстур, надписи в картинки не впекать.
- Анимировать только `transform` и `opacity` (без анимированных `filter`, `box-shadow`).
- Плиты очков не дают и не входят в `goalCells`: иначе разъедутся пороги звёзд бота.
- `js/core/board.js` и правило `hitPlates` в этом плане не менять.
- Перед серией картинок — 1–2 образца и «да» пользователя. Движение показывать живьём на локальном сервере.
- Полный набор e2e — один раз в конце; при отладке `ONLY=` и один браузер (Firefox). Не оставлять висящих headless и `http.server`.
- Не выкладывать на хостинг и не пушить без прямой просьбы. Коммиты без подписей (`Co-Authored-By` и подобных).

## Review Focus

1. **Следующий уровень или повтор после проигрыша** — плиты прошлого уровня не остаются: слой собирается заново из `state.plates` в `spawnBoard`. Тест — задача 1, шаг 1, проверка «retry».
2. **Перемешивание (кнопка и авто)** — плиты стоят на своих клетках, счётчик цели не меняется. Тест — задача 1, «reshuffle».
3. **Телефон 390×844** — плита совпадает с клеткой камня (правила `inset: 0` в `css/hud.css`). Тест — задача 1, «phone align».
4. **Удар спецкамня по плитам** — сняты плиты под всеми разбитыми клетками, счётчик цели равен числу снятых. Тест — задача 1, «strike».
5. **Земли 1–2 без плит** — нет узлов `.gold-plate` и чипа «Плиты», подсказка прежняя. Тест — задача 1, «no plates on 1-01».

---

### Task 1: Плиты в игре

**Files:**
- Modify: `js/game.js` — `dom`, `hintMessages`, `renderGoals`, `applyLevel`, `generateGridData`, `spawnBoard`, `playStep` (между `gotBefore` и `changed`), `window.__SUN`
- Modify: `css/plates.css` (уже создан), `index.html`, `css/hud.css` (уже правлены)
- Test: `tools/e2e/run.js` — новый сценарий `16 land 3 plates` после `15 priest portrait`

**Interfaces:**
- Consumes: `Board.makePlates`, `Board.hitPlates` (см. выше); `Campaign.resolve(id, d).plates`.
- Produces: `state.plates: number[8][8]`; DOM `#plates > .gold-plate[data-r][data-c]`, снятая плита получает класс `lift` и уходит из DOM за ≤ 800 мс; чип `.goal-chip.goal-plates` с текстом «Плиты» и `N / M`; `hintMessages.plates`; отладка `__SUN.plates() -> [[r, c], …]`, `__SUN.setPlates([[r, c], …])`.

- [ ] **Step 1: Написать сценарий `16 land 3 plates`** по образцу `3 land 2 vines` (`tools/e2e/run.js:206`). Проверки:
  - `__SUN.start('3-01')`: `.gold-plate` ровно 8, `.goal-chip.goal-plates` один, в тексте `Плиты` и `0 / 8`; `#hintBar` содержит `золотых плитах`; консоль чистая.
  - «strike»: `await __SUN.strike(3, 2, 'line', 'row')` — после `!busy` `__SUN.plates()` не содержит клеток строки 3, число `.gold-plate` (без `.lift`) равно `__SUN.plates().length`, счётчик чипа = `8 - __SUN.plates().length`.
  - «reshuffle»: `await __SUN.reshuffleBoard(false, true)` — `__SUN.plates()` до и после совпадают.
  - «no win while plates left»: на `3-02` поставить цветной цели `got = need`, вызвать `__SUN.checkEnd()` — `state.ended === false` (плиты ещё лежат); затем цели плит `got = need`, `checkEnd()` — `state.ended === true`.
  - «retry»: после `__SUN.start('3-02')` узлов `.gold-plate` ровно столько, сколько плит в данных 3-02 (12), без остатков 3-01.
  - «phone align»: окно 390×844, `3-01` — `boundingBox` первой `.gold-plate` и камня в той же клетке совпадают с точностью до 2 px по `x` и `y`.
  - «no plates on 1-01»: `__SUN.start('1-01')` — `.gold-plate` 0, `.goal-plates` 0.
  - «reduced»: при `prefers-reduced-motion: reduce` снятая плита исчезает сразу, класса `lift` нет.

- [ ] **Step 2: Прогнать — должен упасть**

Run: `python3 -m http.server 8775 &` затем `ONLY="16 land 3 plates" NODE_PATH=/tmp/pw/node_modules node tools/e2e/run.js firefox`
Expected: FAIL (падение `renderGoals` на `ART.GEMS[undefined]` или нет `.gold-plate`).

- [ ] **Step 3: Реализовать в `js/game.js`**
  - `applyLevel`: цели `vines` и `plates` → `{ type, need, got: 0 }`, остальные — цветные как прежде.
  - `renderGoals`: для `plates` — значок `GOAL_PLATE_ICON` (инлайн-SVG золотой плитки размером `mini-gem`, свой `linearGradient`), имя «Плиты», класс `goal-plates`.
  - `hintMessages.plates = 'Собирай ряды на золотых плитах — очисти все плиты'`; функция `levelHint(level) -> string` (`level.name + ' — ' +` подсказка про плиты, если у уровня есть плиты, иначе `default`) заменяет все пять мест `… + ' — ' + hintMessages.default` (строки ~134, ~524, ~983, ~1357, ~1464). Это и есть обучение на 3-01 (как у лиан на 2-01: сцена-вступление + подсказка).
  - `generateGridData`: `state.plates = Board.makePlates(level ? level.plates : [])`.
  - `renderPlates()` — вызывается в `spawnBoard` после очистки `dom.tiles`; строит слой из `state.plates`, позиция `translate(c*100%, r*100%)` как у `applyPos`.
  - `playStep`: после подсчёта цветных целей и лиан, до `changed`, — `const hits = Board.hitPlates(state.plates, plan)`; цель `plates` `got += hits.length` (не больше `need`); `fxSafe(() => liftPlates(hits))`. В `goalCells` и экономику не добавлять.
  - `liftPlates(hits)`: для `left === 0` — класс `lift`, удалить узел через 800 мс; при `reducedMotion()` удалить сразу.
  - `__SUN.plates`, `__SUN.setPlates` (пересоздаёт `state.plates` и слой).

- [ ] **Step 4: Поправить `css/plates.css`**: анимация `plate-lift` — только `transform` и `opacity` (убрать `filter: brightness`); светлая вспышка — отдельный `::after` со светлым градиентом, у которого анимируется `opacity`. На «Спокойно» длительность 0,7 с, иначе 0,55 с.

- [ ] **Step 5: Прогнать — должен пройти**

Run: `ONLY="16 land 3 plates" NODE_PATH=/tmp/pw/node_modules node tools/e2e/run.js firefox` и `node --test tests/`
Expected: сценарий PASS; `node --test` 182 из 182. Затем `ONLY="3 land 2 vines"` в Firefox — PASS. Остановить сервер: `pkill -f "http.server 8775"`.

- [ ] **Step 6: Commit**

```bash
git add index.html css/plates.css css/hud.css js/game.js tools/e2e/run.js
git commit -m "Земля 3: золотые плиты на поле и в целях"
```

### Task 2: Показ плит пользователю (ворота «да»)

- [ ] **Step 1:** Поднять `python3 -m http.server 8765`, дать адрес `http://localhost:8765/?debug` и подсказку: «Земля 3 на карте пока закрыта: в консоли браузера (F12) ввести `__SUN.start('3-01')`; собери ряд над золотом — плита тает, счётчик „Плиты“ растёт; `__SUN.start('3-10')` — плиты вместе с лианами».
- [ ] **Step 2:** Ждать «да». Если вид плиты не принят — менять только `css/plates.css` и значок, повторить показ. Сервер остановить за собой.

### Task 3: Бот-проверка земли 3 на итоговом коде

**Files:**
- Modify (только если проверка падает): `js/campaign/land-03.js` — `time`, раскладки, `STARS_BY_LEVEL`

- [ ] **Step 1:** Run (в фоне): `node tools/level-bot.js --check --lands 3`
Expected: все 20 уровней проходимы на calm / normal / challenge.
- [ ] **Step 2:** Если уровень не проходим — поднять ему `time` на 10–15 % или убрать `+`/`~` клетки «Испытания»; пересчитать пороги `node tools/level-bot.js --suggest --lands 3 --js` и вставить в `STARS_BY_LEVEL`. Кривая: передышки 3-08 и 3-14 легче соседей.
- [ ] **Step 3:** Run: `node tools/level-bot.js --check --lands 1-2` — земли 1–2 не задеты. `node --test tests/` — зелёные.
- [ ] **Step 4: Commit** (если были правки): `git commit -m "Земля 3: время и пороги по бот-проверке"`.

### Task 4: Фон земли 3

**Files:**
- Create: `assets/backdrop/land3/plate.webp` (через `tools/pack_backdrop.py --land 3`), бриф в `art-src/phase2/PROMPTS.md` новым разделом «Этап 3 — земля 3»
- Modify: `js/campaign/land-03.js` — `bg: 'assets/backdrop/land3/plate.webp'`, `backdrop: { plate: …, waterfall: false }` по образцу `land-02.js:58-64`; `mosaic` оставить `assets/art/bg-moon.webp` (мозаики земель 1–2 тоже прежние)
- Test: `tools/e2e/run.js` — в сценарий `16 land 3 plates` проверку: `body[data-land="3"]` показывает слой `.bd-plate` с `land3/plate.webp`, консоль чистая

- [ ] **Step 1:** Бриф Codex по образцу брифа земли 2: пещера с золотым полом, лунный свет из пролома в своде, глубокая ночь, приглушённо, без надписей, композиция с пустым центром под поле; 1–2 образца.
- [ ] **Step 2:** Показать образцы, ждать «да».
- [ ] **Step 3:** Собрать `tools/pack_backdrop.py --land 3`, подключить в `land-03.js`. Луна и облака общие с землёй 1 не подключать (в пещере неба нет); светлячки общие, как у всех земель. Своё живое движение пещеры (мерцание кристаллов) — отложить, записать в STATUS.
- [ ] **Step 4:** Run: `ONLY="16 land 3 plates"` и `ONLY="12 backdrop"` в Firefox — PASS; открыть по `file://` — фон виден.
- [ ] **Step 5: Commit** `git commit -m "Земля 3: фон Лунных пещер"`.

### Task 5: Итоговая проверка, STATUS, слияние

- [ ] **Step 1:** Полный набор один раз: `node tools/e2e/run.js firefox`, затем `webkit`, `chromium` (42 сценария). Упавшие — повтор через `ONLY=`; обрывы `http.server` (`ERR_CONNECTION_RESET`) — повтор, не правка кода.
- [ ] **Step 2:** `STATUS.md`: раздел «Этап 3, земля 3» (что вошло, решения без пользователя: обучение подсказкой, мозаика прежняя, живого элемента пещеры нет), число сценариев и тестов, «Где остановились».
- [ ] **Step 3:** Commit, `git checkout main && git merge --no-ff phase3-land3`. Спросить пользователя про `git push` (Vercel по пушу не выкладывать без просьбы).
