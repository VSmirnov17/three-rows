# «Хранитель Солнца», фаза 1: движок кампании и главы 1–2 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** превратить игру из 4 уровней в кампанию: данные уровней, главы 1–2 (40 уровней), три сложности, звёзды, осколки и мозаика, карта пути, сюжетные сцены, механика «камни в лианах», перенос сохранения, переименование в «Хранитель Солнца».

**Architecture:** чистая логика поля выносится из `js/game.js` в UMD-модуль `js/core/board.js` (как `js/economy.js`: работает и в браузере через `window`, и в Node через `require`). `game.js` остаётся оркестратором анимаций и вызывает ядро. Кампания (данные + правила сложности) и прогресс (сохранение, миграция, звёзды, осколки) — отдельные чистые UMD-модули. Бот-проверка уровней в Node играет настоящей логикой ядра. Новые экраны (карта, сюжет, перенос прогресса) — отдельные файлы, общаются с `game.js` через `window.Game` (небольшой публичный API).

**Tech Stack:** чистые HTML/CSS/JS без сборки и зависимостей; тесты — встроенный `node --test` (Node 20); ручная проверка в браузере через `python3 -m http.server`.

**Spec:** `docs/superpowers/specs/2026-11-06-hranitel-solnca-design.md` (фаза 1 — §11 п.1; правила — §4, §5, §6, §9, §10).

## Global Constraints

- Без сборки и npm-зависимостей; игра работает со статического хостинга и с `file://` → данные уровней в `.js`, никаких `fetch` за JSON.
- Новые JS-модули логики — UMD по образцу `js/economy.js:13-19` (`window.X` + `module.exports`), без DOM.
- Главный браузер — **Firefox на Windows**; проверять также Chrome и Safari.
- Тексты интерфейса — HTML, на русском; крупно: основной текст кнопок ≥ 20px, цели нажатия ≥ 56px.
- Никаких `alert/confirm/prompt`.
- 10 земель × 20 уровней; в этой фазе — земли 1 (Джунгли Ягуара) и 2 (Храм Змея, механика «камни в лианах»).
- Сложности: `calm` («Спокойно», без таймера, проиграть нельзя), `normal` («Обычно», щадящий таймер), `challenge` («Испытание», таймер строже, цели больше). Ограничения по ходам нет.
- Осколок: лучшая пройденная сложность → `stone` / `silver` / `gold`. Звёзды 1–3, отдельно на каждую сложность, не тратятся.
- Старый ключ `localStorage` `sun-treasures-save` (`{best, unlocked, relaxed}`) читается и переносится; не удаляется. Новый ключ — `sun-keeper-save`.
- Коммиты — через `/usr/bin/git` (хук rtk в этом worktree блокирует просто `git`). Окончание сообщения коммита: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Визуальный стиль B, огонь, перерисовка спецкамней, удаление шамана и локальные шрифты (нужна загрузка файлов шрифтов с разрешения пользователя) — **не в этой фазе** (фаза 2).
- Тесты запускаются `node --test tests/` (проверено на Node 20.19: подхватывает `*.test.js` в папке). Временный арт: мозаика и фон главы 1 — `assets/art/bg-jaguar.webp`, главы 2 — `assets/art/bg-temple.webp`.

## Review Focus

1. Старое сохранение `{unlocked: 4, relaxed: false, best: 9000}` → после обновления «Продолжить» открывает уровень `1-05`, уровни `1-01…1-04` пройдены (на `normal`), лучший счёт сохранён. — тест в Task 5.
2. Бомба/молния/солнце задевают камень в лианах → лиана срывается, камень остаётся на месте и не засчитывается в цель цвета. — тест в Task 3.
3. На поле с лианами нет ходов → перемешивание не двигает камни в лианах и завершается (не зацикливается). — тест в Task 3.
4. Испорченный JSON в `localStorage` или опечатка в коде переноса → игра стартует с пустым/текущим прогрессом, текущее сохранение не затёрто, показывается понятное сообщение. — тесты в Task 5.
5. `localStorage` недоступен (приватный режим, исключение при доступе) → игра запускается и играется, просто без сохранения. — тест в Task 5.

---

### Task 1: Тестовый каркас и вынос поиска совпадений в `js/core/board.js`

**Files:**
- Create: `js/core/board.js`, `tests/board-core.test.js`, `tests/helpers/grid.js`
- Modify: `js/game.js:556-760` (findLineGroups, squaresTouch, findSquares, findCorners, analyzePatterns, findMatches, hasAnyMatch, findMove, hasMove — заменить тела на вызовы ядра), `index.html:248-257` (подключить `js/core/board.js` перед `js/game.js`)

**Interfaces:**
- Produces (`window.BoardCore` / `require('../js/core/board.js')`):
  - `ROWS = 8`, `COLS = 8`, `keyOf(r, c) -> 'r,c'`, `parseKey(k) -> {r, c}`
  - `gemAt(grid, r, c) -> gem|null`
  - `findLineGroups(grid) -> [{dir:'h'|'v', len, cells:[{r,c}]}]`
  - `findSquares(grid) -> [{cells, center:{r,c}}]`
  - `findCorners(grid, groups) -> [{cells, joint:{r,c}}]`
  - `analyzePatterns(grid) -> {groups, squares, corners}`
  - `hasAnyMatch(grid) -> boolean`
  - `findMove(grid) -> {a:{r,c}, b:{r,c}}|null`, `hasMove(grid) -> boolean`
- Gem-объект как сейчас (`game.js:458`): `{id, color, special, lineDir, r, c, el}`; ядро не трогает `el`.
- `tests/helpers/grid.js`: `gridFrom(rows: string[]) -> grid` — строки по 8 символов, `'0'..'5'` — цвет, `'.'` — пусто; суффиксы задаются отдельной картой `{ 'r,c': {special, lineDir, locked} }` вторым аргументом.

- [ ] **Step 1: Написать падающие тесты** в `tests/board-core.test.js`:
  - `findLineGroups находит горизонтальную тройку` — сетка с `000` в строке 0 → одна группа `{dir:'h', len:3}`.
  - `findLineGroups не склеивает через пустую клетку` — `00.0` → групп нет.
  - `findSquares находит квадрат 2×2` → `center` равен одной из четырёх клеток.
  - `findCorners находит уголок из 5` (L-форма) → один уголок.
  - `findMove находит единственный ход` на доске без совпадений, где возможен ровно один обмен; `hasMove` на доске без ходов → `false`.
- [ ] **Step 2: Запуск** `node --test tests/` → FAIL (`Cannot find module '../js/core/board.js'`).
- [ ] **Step 3: Перенести** алгоритмы из `game.js` в `js/core/board.js` без изменения поведения, параметризовав сеткой `grid` вместо `state.grid`. В `game.js` оставить функции-обёртки с прежними именами, вызывающие `BoardCore.*(state.grid, …)`.
- [ ] **Step 4: Запуск** `node --test tests/` → PASS.
- [ ] **Step 5: Ручная регрессия.** `python3 -m http.server 8765`, открыть `http://localhost:8765` в Firefox: сыграть уровень, собрать 4 и 5 в ряд, квадрат и уголок — спецкамни создаются как раньше, подсказка (H) работает. Консоль без ошибок.
- [ ] **Step 6: Commit** `"Ядро поля: поиск совпадений и ходов вынесен в js/core/board.js"`.

### Task 2: Чистый план каскада и обрушение в ядре

**Files:**
- Modify: `js/core/board.js`, `js/game.js:1098-1157` (expandSpecials), `js/game.js:1159-1383` (resolveBoard — блок создания спецкамней 1184-1265 и удаление/апгрейд 1359-1370), `js/game.js:1385-…` (dropGems), `js/game.js:481-516` (generateGridData)
- Test: `tests/board-core.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `expandSpecials(grid, baseKeys: Set, protectedKeys: Set) -> {clear: Set, triggers: [{r,c,type,color,lineDir}], unlocks: Set}` (`unlocks` пуст до Task 3)
  - `planCascade(grid, swapCell: {r,c}|null) -> null | {matched: Set, creates: [{r,c,type,dir}], clear: Set, triggers, unlocks: Set}` — `null`, если совпадений нет. Приоритет создания как в `game.js:1184-1262`: тотем > солнце > бомба > молния, один спецкамень на блок.
  - `applyCascade(grid, plan) -> {removed: gem[]}` — удаляет `clear`, апгрейдит `creates` (`special`, `lineDir`).
  - `collapse(grid, spawn: (r, c) => gem) -> {moves: [{gem, fromR, toR}], spawned: gem[]}` — обрушение по столбцам и досыпка сверху.
  - `generateGrid(level, rng, nextId) -> grid` — поле без начальных совпадений и с ходом (≤ 50 попыток, как сейчас); `level` пока использует только `colors` (по умолчанию 6).
  - `simulateMove(grid, a, b, rng, nextId) -> null | {cascades: plan[], removed: gem[]}` — полный ход для бота: обмен, все каскады, обрушение; `null`, если обмен недопустим.
- `game.js` `resolveBoard` в цикле вызывает `planCascade` → анимирует → `applyCascade` → `collapse` с анимацией перемещений. Подсчёт очков и целей остаётся в `game.js`.

- [ ] **Step 1: Падающие тесты:**
  - `planCascade: линия из 4 создаёт молнию в клетке обмена` — `creates[0]` = `{type:'line', dir:'row'}` в `swapCell`.
  - `planCascade: L из 5 даёт тотем, а не молнию`.
  - `planCascade: 5 в ряд даёт солнце`.
  - `expandSpecials: бомба чистит 3×3, на углу — 2×2`.
  - `collapse: камни падают вниз, сверху досыпаются новые, сетка полная`.
  - `simulateMove: недопустимый обмен → null; допустимый → сетка без совпадений и полная`.
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3: Реализовать** в ядре, перенеся логику из `game.js` без изменения правил; `game.js` перевести на вызовы ядра.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Ручная регрессия** (как Task 1 Step 5) плюс каскады и срабатывание каждого спецкамня; звук и эффекты на месте.
- [ ] **Step 6: Commit** `"Ядро поля: план каскада, обрушение и симуляция хода"`.

### Task 3: Камни в лианах

**Files:**
- Modify: `js/core/board.js`, `js/game.js` (attemptSwap 782, selectCell 768, createGemEl 463, reshuffleBoard 1035), `styles.css` (класс `.gem.is-locked` + анимация срыва)
- Test: `tests/board-core.test.js`

**Interfaces:**
- Gem получает поле `locked: boolean` (по умолчанию `false`).
- Правила ядра:
  - `canSwap(grid, a, b) -> boolean` — `false`, если любой из камней `locked`; `findMove` учитывает это.
  - Камень в лианах участвует в совпадениях как обычный. Если он попал в `clear` (рядом, бомбой, лучом, солнцем) — переносится из `clear` в `unlocks`: остаётся на месте, `locked = false`. Он не засчитывается в цели цвета и не становится местом создания спецкамня.
  - `collapse`: камень в лианах закреплён; камни над ним падают «сквозь» него в пустые клетки ниже.
  - `shuffle(grid, rng) -> grid` — перемешивает только незакреплённые камни, гарантирует отсутствие совпадений и наличие хода; не более 100 попыток, затем пересоздаёт незакреплённые камни.
  - `generateGrid(level, …)`: `level.vines: [[r,c], …]` → эти клетки получают `locked: true`.
- `game.js`: попытка двинуть камень в лианах → лёгкое покачивание и отказ (без звука ошибки); срыв лианы — событие `sun:unlock {r, c}` и анимация; цель `vines` считает срывы (см. Task 7).

- [ ] **Step 1: Падающие тесты:**
  - `canSwap: камень в лианах не меняется местами`.
  - `лиана срывается рядом, камень остаётся` — тройка с locked-камнем → `unlocks` содержит его, `clear` — нет, после `applyCascade` камень на месте и `locked === false`.
  - `бомба срывает лиану, а не уничтожает камень` (Review Focus 2).
  - `камень в лианах не считается собранным` — `removed` не содержит его.
  - `collapse: закреплённый камень не падает, камни выше проходят сквозь него`.
  - `shuffle не двигает камни в лианах и завершается на доске без ходов` (Review Focus 3) — locked-позиции те же, `hasMove` → `true`.
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3: Реализовать** правила в ядре и в `game.js`. Вид лиан — временный CSS-оверлей (зелёные плетения поверх камня, крупные, контрастные); финальный арт — в фазе 2.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Ручная проверка** через `?debug`: добавить в `window.__SUN` (`game.js:1841-1848`) `setVines(cells: [[r,c]])`, поставить лианы и проверить отказ обмена, срыв, обрушение сквозь закреплённый камень.
- [ ] **Step 6: Commit** `"Механика «камни в лианах»"`.

### Task 4: Данные кампании и правила сложности

**Files:**
- Create: `js/campaign/campaign.js`, `js/campaign/land-01.js`, `js/campaign/land-02.js`, `tests/campaign.test.js`
- Modify: `index.html` (подключить файлы земель, затем `campaign.js`, перед `js/game.js`)

**Interfaces:**
- Файлы земель кладут данные в `window.CAMPAIGN_LANDS` (массив) / `module.exports`:
  ```js
  { id: 1, key: 'jaguar', name: 'Джунгли Ягуара', bg: 'assets/art/bg-jaguar.webp',
    mosaic: 'assets/art/bg-jaguar.webp', mechanic: null,
    scenes: { intro: [..строки..], outro: [..строки..] },
    levels: [ { id: '1-01', name: '…', time: 120,
                goals: [{type:'color', color: 0, need: 12}, {type:'vines'}],
                vines: [[r,c], …],          // только в земле 2+
                challenge: { vines: [...] }, // необязательно: доп. препятствия на «Испытании»
                stars: { calm: [s2, s3], normal: [s2, s3], challenge: [s2, s3] } } ] }
  ```
- `Campaign` (`js/campaign/campaign.js`):
  - `DIFFICULTIES = ['calm', 'normal', 'challenge']`
  - `lands() -> land[]`, `level(id) -> level|null`, `landOf(id) -> land`, `nextLevelId(id) -> string|null`, `allLevelIds() -> string[]`
  - `resolve(id, difficulty) -> {id, name, landId, timer: number|null, econTime: number, goals: [{type, color?, need}], vines: [[r,c]], stars: [s2, s3]}`:
    - `timer` — отсчёт на экране (`null` = таймера нет); `econTime` — всегда число, это `state.totalTime` для экономики (на `calm` экономика берёт `econTime * 0.5`, как `game.js:342`).
    - `calm`: `timer = null`, `econTime = level.time`; цели как в данных.
    - `normal`: `timer = econTime = level.time`.
    - `challenge`: `timer = econTime = Math.round(level.time * 0.8)`; `need` цветовых целей `Math.ceil(need * 1.3)`; лианы = `vines` ∪ `challenge.vines`.
    - цель `{type:'vines'}` получает `need = число лиан`.
  - `validate() -> string[]` — ошибки данных (пустой список = ок).
  - Загрузка земель: в браузере файлы земель подключены раньше и вызывают `Campaign`-независимый `(window.CAMPAIGN_LANDS = window.CAMPAIGN_LANDS || []).push(land)`; в Node `campaign.js` сам делает `require('./land-01.js')`, `require('./land-02.js')` (каждый файл земли экспортирует свой объект через `module.exports`). Список файлов земель — константа `LAND_FILES` в `campaign.js`.
- Содержание:
  - Земля 1, 20 уровней `1-01…1-20`. `1-01…1-04` — нынешние 4 уровня (цели и время из `game.js:12-33`) с новыми названиями (не «Храм Пернатого Змея» и не «Пещера Лунного Света»). Дальше: 2 цвета до `1-07`, 3 цвета с `1-08`; `need` растёт с 12 до ~24; `time` — с 120 до ~200 с; `1-10` и `1-15` — «передышки» полегче.
  - Земля 2, 20 уровней `2-01…2-20`: в каждом есть лианы; `2-01` — 4 лианы и одна цель цвета (обучение); число лиан растёт до ~14; передышки — `2-08`, `2-14`.
  - `scenes`: 2–3 фразы ≤ 120 символов каждая; плюс `Campaign.PROLOGUE` (3 фразы: Повелитель Ночи украл Солнце, Камень разбит, хранитель отправляется в путь). Имена придуманные, реальных богов не использовать.
  - `stars` на этом шаге — заглушки `[1, 2]`; реальные значения выставляет Task 6.

- [ ] **Step 1: Падающие тесты** (`tests/campaign.test.js`):
  - `в кампании 2 земли и 40 уровней с уникальными id`.
  - `validate() пуст` (лианы в пределах 8×8, без повторов; цвета 0..5; у каждого уровня есть `stars` на все сложности; `time > 0`).
  - `resolve calm: timer null, econTime = level.time`; `resolve normal: timer = econTime = level.time`.
  - `resolve challenge: время ×0.8 и need ×1.3 вверх` — для `1-01` (`need` 12 → 16, `timer` 120 → 96).
  - `resolve: need цели vines = число лиан, на challenge включает доп. лианы`.
  - `nextLevelId('1-20') = '2-01'`, `nextLevelId('2-20') = null`.
  - `названия 1-02 и 1-03 не совпадают с названиями земель`.
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3: Реализовать** `campaign.js` и заполнить данные земель 1–2.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** `"Кампания: данные земель 1–2 и правила сложности"`.

### Task 5: Прогресс, миграция и перенос сохранения

**Files:**
- Create: `js/campaign/progress.js`, `tests/progress.test.js`
- Modify: `index.html` (подключить после `campaign.js`)

**Interfaces:**
- Формат сохранения (`sun-keeper-save`):
  ```js
  { version: 2, difficulty: 'calm', best: 0,
    levels: { '1-01': { calm: {stars, best}, normal: {…}, challenge: {…} } },
    seenScenes: ['prologue', '1-intro', …] }
  ```
- `Progress` (`js/campaign/progress.js`):
  - `KEY = 'sun-keeper-save'`, `OLD_KEY = 'sun-treasures-save'`
  - `empty() -> save`
  - `load(storage) -> save` — `storage` — объект с `getItem/setItem` (в браузере `localStorage`). Порядок: новый ключ → иначе миграция старого → иначе `empty()`. Любое исключение/битый JSON → `empty()`, без записи поверх.
  - `migrateV1(old, levelIds) -> save` — `unlocked = N` → первые `N` уровней пройдены на `relaxed ? 'calm' : 'normal'` с `stars: 1`, `best` переносится; `difficulty` = `relaxed ? 'calm' : 'normal'`.
  - `persist(storage, save) -> boolean` — `false` при исключении, без падения.
  - `record(save, levelId, difficulty, score, stars) -> {save, improved: boolean, newTier: 'stone'|'silver'|'gold'|null}` — хранит максимум звёзд и очков; `newTier`, если осколок стал лучше.
  - `fragmentTier(save, levelId) -> 'stone'|'silver'|'gold'|null` — лучшая пройденная сложность (`calm`→stone, `normal`→silver, `challenge`→gold).
  - `isUnlocked(save, levelId, campaign) -> boolean` — первый уровень открыт всегда; остальные — если предыдущий пройден на любой сложности.
  - `currentLevelId(save, campaign) -> string` — первый непройденный открытый уровень (или последний).
  - `starsTotal(save) -> number` — сумма максимумов звёзд по каждой сложности каждого уровня.
  - `exportCode(save) -> string` — `'HS2-' + base64(JSON)` + контрольная сумма; `importCode(code) -> {ok: true, save} | {ok: false, error: 'Код не подходит. Проверьте, что он скопирован целиком.'}`.

- [ ] **Step 1: Падающие тесты** (`tests/progress.test.js`, `storage` — простой объект-заглушка):
  - `миграция {unlocked:4, relaxed:false, best:9000}` (Review Focus 1): `1-01…1-04` пройдены на `normal`, `fragmentTier('1-04') = 'silver'`, `currentLevelId = '1-05'`, `best = 9000`, `difficulty = 'normal'`; старый ключ в `storage` остался.
  - `миграция {unlocked:0, relaxed:true}` → ничего не пройдено, `difficulty = 'calm'`.
  - `битый JSON в новом ключе → empty(), storage не перезаписан` (Review Focus 4).
  - `getItem бросает исключение → load возвращает empty(), persist возвращает false` (Review Focus 5).
  - `record: звёзды не уменьшаются, newTier 'gold' при первой победе на challenge после silver`.
  - `isUnlocked: '1-02' закрыт, пока '1-01' не пройден; '2-01' открыт после '1-20'`.
  - `exportCode → importCode возвращает тот же save`; `испорченный код → ok:false с текстом ошибки` (Review Focus 4).
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3: Реализовать** `progress.js`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** `"Прогресс кампании: сохранение v2, миграция и перенос"`.

### Task 6: Бот-проверка уровней и пороги звёзд

**Files:**
- Create: `tools/level-bot.js`, `tests/level-bot.test.js`
- Modify: `js/campaign/land-01.js`, `js/campaign/land-02.js` (значения `time`, `need`, `stars` по результатам бота)

**Interfaces:**
- Consumes: `BoardCore.simulateMove`, `BoardCore.generateGrid`, `Campaign.resolve`, `Economy.clearDetail`.
- `tools/level-bot.js` (Node, без зависимостей):
  - `playLevel(resolved, seed, opts: {policy: 'greedy'|'human'}) -> {won: boolean, moves: number, score: number}` — детерминированный RNG (mulberry32) по `seed`; потолок 150 ходов. `greedy` выбирает лучший ход по (прогресс целей, затем очки) — для проверки проходимости; `human` — случайный из трёх лучших — для порогов звёзд (жадный бот завысил бы планку для пожилого игрока).
  - **Единое определение «очков для звёзд»** (то же сравнивает экран конца уровня в Task 7): сумма `Economy.clearDetail(...).score` за уровень, **без** `levelBonus`. `totalTime = resolved.econTime`; `timeLeft`: на `calm` — `econTime * 0.5` (как `game.js:342`), на `normal`/`challenge` — `max(0, econTime − moves × 4)` перед каждым ходом (4 с на ход).
  - CLI: `node tools/level-bot.js --check [--lands 1-2] [--seeds 20]` и `--suggest`.
  - `--check` — код выхода 1, если для какого-то уровня (политика `greedy`): на `calm` выигрыш < 100 % сидов за 150 ходов; на `normal` доля сидов с `moves × 4 с ≤ timer` < 90 %; на `challenge` < 60 %; или пороги звёзд вне коридора по очкам политики `human`: `s2` — между 30-м и 50-м перцентилем, `s3` — между 75-м и 90-м.
  - `--suggest` — печатает таблицу: медиана ходов, время, предлагаемые `stars` по сложностям (40-й и 80-й перцентиль политики `human`).
  - Сложность растёт плавно: медиана ходов уровня `n+1` не меньше чем у уровня `n` минус 25 %, кроме уровней-передышек — печатать предупреждение.
- [ ] **Step 1: Падающий тест** `tests/level-bot.test.js`: `playLevel` для `1-01` на `calm` с сидом 1 выигрывает и детерминирован (два запуска → одинаковые `moves` и `score`).
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3: Реализовать** бота и CLI.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Подобрать данные:** `node tools/level-bot.js --suggest --lands 1-2`, перенести `stars`/`time`/`need` в данные земель, повторять до `node tools/level-bot.js --check --lands 1-2` → код выхода 0.
- [ ] **Step 6: Commit** `"Бот-проверка уровней, пороги звёзд глав 1–2"`.

### Task 7: Игра на кампании: сложности, цели, конец уровня

**Files:**
- Modify: `js/game.js` (LEVELS 12-33 удалить; applyLevel 427-451; renderGoals 222; updateGoals 234; resolveBoard подсчёт целей 1328-1336; checkEnd 1427; winLevel 1439; loseLevel 1473; showEndScreen 1491; beginLevel 1519; startNewRun/retryLevel/nextLevel/goHome 1571-1620; loadSave 306; saveProgress 357; setMode 323; updateModeUI 330; econTimeLeft 342; loop timer 1798), `js/visuals.js` (фон по `body[data-land]`), `js/visuals-screens.js:7` (названия из `Campaign`), `css/themes.css` (`data-level` → `data-land`), `css/mode.css`, `index.html` (стартовый экран: переключатель сложности на 3 кнопки), `tools/economy-sim.js:16-37` (брать уровни из `Campaign`)

**Interfaces:**
- Consumes: `Campaign.resolve`, `Progress.*`, `BoardCore`.
- Produces `window.Game` (для экранов из Task 8–9):
  - `Game.startLevel(levelId: string)`, `Game.getSave() -> save`, `Game.setDifficulty(d)`, `Game.getDifficulty() -> d`, `Game.replaceSave(save)` (после импорта), `Game.showHome()`.
- Поведение:
  - `state.relaxed` заменяется на `state.difficulty`; `calm` ведёт себя как нынешний relaxed (таймера нет, `econTimeLeft = totalTime*0.5`, бонуса за время нет, проигрыша нет); `normal` и `challenge` — как нынешний режим «На время» со своим `time`.
  - Сложность, выбранная во время уровня, применяется к следующему запуску; результат записывается под сложностью, с которой уровень начат.
  - Цели: `color` — как сейчас; `vines` — счётчик срывов, иконка лианы в списке целей. Победа — все цели выполнены.
  - `state.totalTime = resolve().econTime`; таймер на экране — по `resolve().timer`.
  - Звёзды: победа = 1★; очки за очистку (без бонуса за время — то же определение, что в Task 6) `≥ s2` → 2★; `≥ s3` → 3★ (пороги из `resolve().stars`).
  - Отладка: в `window.__SUN` (только с `?debug`, `game.js:1841-1848`) добавить `start(levelId)` и `setVines(cells: [[r,c]])`.
  - Экран конца уровня: звёзды крупно, осколок с подписью материала («Каменный осколок» / «Серебряный» / «Золотой»), если `newTier`; кнопки «Дальше», «Ещё раз», «На карту».
  - Победа на последнем уровне земли → сюжетная сцена `outro` (Task 9), затем карта.
  - `body[data-land]` = номер земли; фон земли по `land.bg`.
  - Сохранение только через `Progress.persist(localStorage …)` в `try`.
- [ ] **Step 1:** `node --test tests/` → PASS (регресс ядра и модулей).
- [ ] **Step 2: Реализовать** изменения.
- [ ] **Step 3: Ручная проверка в Firefox:** с очищенным `localStorage` пройти `1-01` на «Спокойно» (1–3★, каменный осколок), переиграть на «Испытании» (таймер 96 с, цели 16) → осколок стал золотым; через `?debug` открыть `2-01` и собрать цель «лианы»; проиграть по времени на «Обычно» → экран поражения, прогресс не потерян. Записать старое сохранение `localStorage.setItem('sun-treasures-save', '{"best":9000,"unlocked":4,"relaxed":false}')`, удалить `sun-keeper-save`, перезагрузить → «Продолжить» открывает `1-05`.
- [ ] **Step 4: Commit** `"Игра на кампании: сложности, звёзды, осколки"`.

### Task 8: Карта пути, мозаика и переименование

**Files:**
- Create: `js/screens/map.js`, `css/map.css`
- Modify: `index.html` (оверлей `#mapScreen`, кнопка «Путь хранителя» на стартовом экране, `<title>`, заголовки), `js/game.js` (кнопка «На карту», `Game.showHome`), `README.md` (название, правила сложности, сохранение, кампания, `node --test tests/`, `node tools/level-bot.js --check`)

**Interfaces:**
- Consumes: `Game.*`, `Campaign.*`, `Progress.*`.
- Карта (`#mapScreen`, оверлей как остальные, `openOverlay`):
  - Сверху — выбор сложности: три крупные кнопки с подписью и пояснением («Спокойно — без таймера», «Обычно — с часами», «Испытание — строже и быстрее»).
  - Список земель (2 доступны, остальные 8 — «Скоро», затемнённые); у земли — мозаика 5×4 из `land.mosaic`: собранный осколок показан своим фрагментом картинки с рамкой по материалу (камень/серебро/золото), несобранный — тёмная плита.
  - Под выбранной землёй — 20 кнопок уровней (≥ 64px): номер, звёзды текущей сложности, замок у закрытых; нажатие → `Game.startLevel(id)`.
  - Счётчик «Звёзд собрано: N».
- Переименование: «Хранитель Солнца» в `<title>`, на стартовом экране, в шапке игрового экрана (`index.html`), в README; подзаголовок стартового экрана — про путь хранителя. Эмблему стартового экрана в этой фазе не трогать (фаза 2).
- [ ] **Step 1: Реализовать** карту и переименование.
- [ ] **Step 2: Ручная проверка** в Firefox и Chrome, окно 1366×768 и телефон 390×844 (адаптивный режим DevTools): все подписи читаются, кнопки не меньше 56px, мозаика отражает пройденные уровни и материал осколков, закрытые уровни не запускаются.
- [ ] **Step 3: Commit** `"Карта пути, мозаика земель, название «Хранитель Солнца»"`.

### Task 9: Сюжетные сцены и перенос прогресса

**Files:**
- Create: `js/screens/story.js`, `js/screens/transfer.js`, `css/story.css`
- Modify: `index.html` (оверлеи `#storyScreen`, `#transferScreen`, кнопка «Перенести прогресс» на стартовом экране), `js/game.js` (вызов сцен: пролог перед первым запуском, `intro` при первом входе в землю, `outro` после её последнего уровня)

**Interfaces:**
- Consumes: `Game.*`, `Campaign.PROLOGUE`, `land.scenes`, `Progress.exportCode/importCode`.
- `Story.play(sceneId: 'prologue'|'<land>-intro'|'<land>-outro', lines: string[]) -> Promise<void>` — фон земли, фразы по одной крупным шрифтом (≥ 28px), кнопки «Дальше» и «Пропустить»; после показа `sceneId` добавляется в `save.seenScenes` — повторно сама не показывается. На карте у земли — кнопка «История», чтобы пересмотреть.
- Перенос (`#transferScreen`): поле с кодом `exportCode` и крупная кнопка «Скопировать» (`navigator.clipboard`, при ошибке — выделить текст и подсказка «Нажмите Ctrl+C»); поле ввода и кнопка «Загрузить» → `importCode` → `Game.replaceSave` при `ok`, иначе текст ошибки под полем. Без системных диалогов.
- [ ] **Step 1: Реализовать** сцены и перенос.
- [ ] **Step 2: Ручная проверка:** новый игрок видит пролог, затем `1-intro`; после `1-20` — `1-outro`, затем `2-intro`; «Пропустить» работает; повторного показа нет. Экспорт в Firefox → очистить `localStorage` → импорт → прогресс вернулся; испорченный код → сообщение, прогресс не изменился.
- [ ] **Step 3: Commit** `"Сюжетные сцены и перенос прогресса"`.

### Task 10: Итоговая проверка фазы

**Files:** —

- [ ] **Step 1:** `node --test tests/` → все PASS; `node tools/level-bot.js --check --lands 1-2` → код 0.
- [ ] **Step 2:** Проверка в Firefox (главное), Chrome, Safari со `http://localhost:8765` и с `file://` (двойной клик по `index.html`): старт, пролог, карта, уровень на каждой сложности, лианы, конец уровня, сохранение после перезагрузки, миграция старого сохранения. Консоль без ошибок.
- [ ] **Step 3:** Просмотреть изменённые файлы на заглушки (`TODO`, `stars: [1, 2]`, `test.skip`, `.only`) — должно быть пусто.
- [ ] **Step 4: Адрес выкладки.** Перенос сохранения работает только по тому же адресу, где отец играет сейчас. Найти текущий адрес (в репозитории нет `.vercel/`; проверить проекты через Vercel MCP или спросить пользователя) и записать его в README как цель выкладки.
- [ ] **Step 5:** Выкладку на хостинг не делать без подтверждения пользователя (спека §9).
