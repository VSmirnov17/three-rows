# Шаг 5: раскол камней и удары спецкамней — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обычный камень раскалывается на осколки своего рисунка, у каждого из четырёх спецкамней свой удар; белая вспышка и тряска уходят; механика и время хода не меняются.

**Architecture:** Чистая логика (цели, задержки, раскрой, бюджет частиц) — `js/fx-core.js` с тестами под Node, по образцу `js/fire-core.js`. DOM и один canvas — `js/visuals-fx.js` + `css/fx.css`, объект `window.Fx`. `game.js` вызывает `Fx.*` вместо `blastFx/beamFx/flashFx/...`; ожидания `resolveBoard` (`sleep(310)`, `dropGems`) не меняются.

**Tech Stack:** ванильный JS без сборки (должно работать с `file://`), CSS-анимации `transform`/`opacity`, Web Animations API, canvas 2D; Node `node:test`; Playwright вне проекта; Blender + Pillow для спрайтов.

**Spec:** `docs/superpowers/specs/2026-11-09-phase2-step5-strikes-design.md` (читать вместе с этим планом). Общие правила проекта — `docs/superpowers/STATUS.md`, «Правила работы».

## Global Constraints

- `js/core/board.js` не менять. `node --test tests/` — все 151 старых теста зелёные.
- `sleep(310)` в `resolveBoard` и тайминги `dropGems` не менять (таймер хода тикает во время разрешения поля, `game.js:1786`).
- Анимировать только `transform` и `opacity`; без анимированных `filter` и `box-shadow`.
- Узел камня удаляет `applyCascade` через 310 мс: эффекты — копии в `#fx`, реальный камень прячется сразу (`opacity: 0`), сам узел не анимируется.
- Нет общей вспышки экрана и тряски поля ни от одного удара.
- Длительность: раскол ≤ 600 мс, удар спецкамня ≤ 900 мс, всё убирается из DOM не позже 1100 мс после начала.
- Бюджет на один шаг каскада: не больше 120 DOM-узлов в `#fx` от `Fx`; пыль, блики и угли — только на canvas.
- Режимы: `prefers-reduced-motion` → только угасание камня 200 мс, без осколков, частиц и лучей; `body[data-fx="low"]` → 3 осколка, без пыли/бликов/углей; `body[data-difficulty="calm"]` → число частиц и непрозрачность лучей ×0,6.
- Молния — бирюзовая (`#5fe3d0`–`#bff7ee`), солнце — золото (`#ffd166`), бомба — обсидиан с огненными краями (`#1a1418` → `#ff8a3d`), тотем — нефрит (`#3fbf8a`–`#b8f5d6`).
- Звук в любых тестах выключен (`sun-treasures-muted` + mute браузера). Браузерные проверки — `ONLY=` и один браузер; три браузера — один раз в задаче 5.
- Коммиты без подписей (`Co-Authored-By` и подобных не ставить). На хостинг не выкладывать.

## Review Focus

1. **Солнце на поле, где его цвета 12+ камней, вместе с цепочкой других спецкамней** — ожидание: ни один узел не остаётся в `#fx` через 1,5 с, число узлов `Fx` ≤ 120. Тест: задача 4, e2e «13 strikes» — шаг с солнцем и цепочкой.
2. **Каскад: новые камни падают в клетку, где ещё летят осколки** — ожидание: осколки не прячут упавший камень дольше 300 мс (осколки гаснут к 600 мс и уходят от центра клетки). Тест: задача 2, `shardPolygons` — центры осколков не в центре; e2e задача 2 — через 650 мс в `#fx` нет `.fx-shard`.
3. **Пауза/оверлей посреди удара** — ожидание: после закрытия паузы ничего не «залипает»: canvas пуст, узлов нет. Тест: задача 5, e2e — открыть паузу сразу после удара, через 1,5 с узлов 0, canvas пуст.
4. **Окно сменилось (телефон ↔ десктоп) или клетка в процентах** — ожидание: эффекты стоят на своих клетках при любом размере поля. Позиции только в процентах от `.fx-layer`, canvas пересчитывает размер по `getBoundingClientRect` при каждом запуске. Тест: задача 5, e2e на 390×844 — центр `.fx-strike` бомбы в пределах 5 % от центра её клетки.
5. **Камень в лианах, задетый ударом** — ожидание: он не раскалывается (его нет в `clear`), лиана рвётся как раньше (`vine-snap`). Тест: задача 2, e2e — `__SUN.setVines` на клетку в ряду молнии, после удара узел камня жив, у него `vine-snap`, осколков на его клетке нет.

---

### Task 1: `FxCore` — логика эффектов

**Files:**
- Create: `js/fx-core.js`
- Create: `tests/fx-core.test.js`
- Modify: `index.html` (тег `<script src="js/fx-core.js">` перед `js/game.js`)

**Interfaces:**
- Produces (`window.FxCore`, `module.exports`), время и случайность приходят параметрами, внутри нет `Math.random`/`Date.now`:
  - `TIMING` — `{ shatterMs: 560, strikeMs: { line: 700, sun: 900, bomb: 800, totem: 850 }, sunStepMs: 35, sunMaxDelayMs: 260, waveStepMs: 30, waveMaxDelayMs: 240, cleanupMs: 1100 }` (заморожен).
  - `budget(mode)` → `{ shards, dust, glints, embers, beamAlpha }`; `mode = { calm, reduced, low }`. Полный: `{6, 10, 2, 18, 1}`; calm: частицы ×0,6 округлением вниз, `beamAlpha: 0.6`; low: `{3, 0, 0, 0, beamAlpha как у calm/полного}`; reduced: всё 0, `beamAlpha: 0`.
  - `shardPolygons(n, rand)` → массив `n` многоугольников, каждый — массив `[x, y]` в процентах 0..100 квадрата клетки; плюс у каждого `{ cx, cy }` центр. Раскрой: случайная точка у центра (40–60 %), лучи к `n` точкам на контуре квадрата, соседние лучи дают треугольник/четырёхугольник (углы квадрата включаются в тот кусок, в который попадают).
  - `shardFlight(poly, rand)` → `{ dx, dy, rot }` в процентах клетки: от центра клетки наружу по направлению к центру куска, длина 60–110 %, `dy` смещён вниз на 20 % (тяжесть), `rot` ±40°.
  - `strikeTargets(trigger, cells)` → `[{ r, c, delay }]` для всех клеток `cells` (массив `{r,c}` из `plan.clear`), отсортированных по `delay`:
    - `sun`: только клетки с `color === trigger.color` (у `cells` есть поле `color`), `delay = min(sunMaxDelayMs, round(dist * sunStepMs))`, `dist` — евклидово в клетках.
    - `totem`: клетки в ряду или столбце триггера, `delay = min(waveMaxDelayMs, (|dr| + |dc|) * waveStepMs)`.
    - `line`: клетки линии по `lineDir`, `delay = min(waveMaxDelayMs, round(dist * waveStepMs * 0.6))`, `dist` — число клеток от триггера.
    - `bomb`: клетки 3×3, `delay = 0`.
    - Остальные клетки `cells` (обычный каскад) в результат не входят.
  - `mergeDelays(cells, triggers)` → `Map<"r,c", delay>`: для каждой клетки — наименьшая задержка среди всех ударов, клетки без удара — `0`.

- [ ] **Step 1: Write the failing tests** в `tests/fx-core.test.js` (стиль как `tests/fire-core.test.js`):
  - `budget: full/calm/low/reduced` — точные значения из Interfaces; `budget({reduced:true, calm:true, low:true}).shards === 0`.
  - `shardPolygons(6, seeded)` — 6 кусков, все точки в 0..100, сумма площадей = 10000 ± 1 (шнурование), ни один `cx,cy` не ближе 8 к `(50,50)` (Review Focus 2).
  - `shardPolygons` детерминирован при одинаковом `rand`.
  - `strikeTargets sun` — на поле 8×8 с клетками трёх цветов результат содержит только цвет солнца, задержки неубывают, максимум ≤ 260.
  - `strikeTargets totem` — 15 клеток креста, у самого тотема `delay 0`, у дальнего угла ряда (7 клеток) `210`.
  - `strikeTargets line` с `lineDir: 'col'` — только столбец.
  - `mergeDelays` — клетка в зоне двух ударов получает меньшую задержку; клетка вне ударов — 0.
  - `TIMING заморожен` — `Object.isFrozen(TIMING)`.
- [ ] **Step 2:** `node --test tests/fx-core.test.js` → FAIL (`Cannot find module`).
- [ ] **Step 3:** Реализовать `js/fx-core.js` по Interfaces (обёртка UMD как в `js/fire-core.js:12-19`; `seeded` для тестов — простой LCG в тесте, не в модуле).
- [ ] **Step 4:** `node --test tests/` → PASS, всего 151 + новые.
- [ ] **Step 5:** Commit: `git add js/fx-core.js tests/fx-core.test.js index.html && git commit -m "FxCore: цели и задержки ударов, раскрой камня, бюджет частиц"`

### Task 2: раскол обычного камня, без вспышек и тряски

**Files:**
- Create: `js/visuals-fx.js`, `css/fx.css`
- Modify: `index.html` (`<link>` на `css/fx.css` после `css/specials.css`; `<script src="js/visuals-fx.js">` сразу после `js/fx-core.js`)
- Modify: `js/game.js` — `resolveBoard` (блок `clear.forEach(... 'clearing' ...)`, `game.js:1186-1192`), `blastFx` (`game.js:906-943`), `impactFx` (`game.js:955-959`), отладочный `__SUN` (`game.js:1830`)
- Modify: `js/visuals-screens.js:89-92` — убрать обработчик `sun:blast` (вспышка экрана)
- Modify: `styles.css` — правила `.blast-flash`, `.board-frame.blast`, `.board-frame.blast-sun` (`styles.css:738-783`) и `css/screens.css:80-81` удалить
- Modify: `tools/e2e/run.js` — новый сценарий `13 strikes`

**Interfaces:**
- Consumes: `FxCore.budget`, `shardPolygons`, `shardFlight`, `TIMING`, `mergeDelays` (Task 1).
- Produces (`window.Fx`):
  - `Fx.mode()` → `{ calm, reduced, low }` из `body[data-difficulty]`, `body[data-fx]`, `matchMedia('(prefers-reduced-motion: reduce)')`.
  - `Fx.shatter(gemEl, r, c, delayMs)` — сразу ставит `gemEl` класс `fx-gone` (`opacity: 0`, `pointer-events: none`), кладёт в `#fx` копию камня `.fx-standin` (те же `<img>` из `.gem-inner`, позиция клетки в %), через `delayMs` заменяет её на `budget.shards` кусков `.fx-shard` (копия `<img>` с `clip-path: polygon(...)`), кусок летит по `shardFlight` и гаснет за `TIMING.shatterMs`; на canvas — пыль цвета камня и золотые блики. При reduced — копия гаснет за 200 мс.
  - `Fx.canvas` — один `<canvas class="fx-canvas" aria-hidden="true">` в `.fx-layer`, цикл `requestAnimationFrame` идёт только пока есть живые частицы; `Fx.particles()` → число живых частиц (для e2e); `Fx.clear()` — убрать всё; вызывается сам, когда у любого `.overlay` появляется класс `show` (MutationObserver по `class`, как `js/visuals-fire.js:503-504`).
  - `__SUN.strike(r, c, type, dir)` (только `?debug`): `upgradeGem` на клетке, затем план `{ matched: new Set(), creates: [], ...Board.expandSpecials(state.grid, [key], []) }` проигрывается тем же путём, что шаг `resolveBoard`, затем `await resolveBoard()`. Для этого тело одного шага цикла `resolveBoard` выносится в `async function playStep(plan, chain)` без изменения порядка и пауз.

- [ ] **Step 1: Write the failing e2e** `13 strikes` в `tools/e2e/run.js` (Firefox, 1366×768, уровень `1-01` на «Обычно», `?debug`, `sun-keeper-fx = 'full'`):
  - обычный ход `playRealMove` → в течение 150 мс в `#fx` есть `.fx-shard`, через 700 мс `.fx-shard` и `.fx-standin` нет;
  - `.blast-flash` ни разу не появляется (MutationObserver на `#fx` за весь сценарий), у `.board-frame` нет классов `blast`/`blast-sun`;
  - лианы (Review Focus 5): `__SUN.setVines([[3,5]])`, `__SUN.strike(3, 1, 'line', 'row')` → узел камня `[data-r="3"][data-c="5"]` жив и получил `vine-snap`, `.fx-shard` у клетки (3,5) не было;
  - ошибок консоли нет.
- [ ] **Step 2:** `ONLY="13 strikes" node tools/e2e/run.js firefox` → FAIL (нет `.fx-shard`, нет `__SUN.strike`).
- [ ] **Step 3:** Реализовать `js/visuals-fx.js` и `css/fx.css` по Interfaces; в `resolveBoard` заменить `classList.add('clearing') + spawnParticles` на `Fx.shatter(gem.el, p.r, p.c, delays.get(k) || 0)`, где `delays = FxCore.mergeDelays(cellsArr, triggers)` (задача 3 и 4 добавят задержки для ударов; пока все 0). Из `blastFx` убрать `flashFx` и тряску рамки; из `impactFx` убрать `flashFx`; функции `flashFx`, `spawnParticles` и CSS `.gem.clearing`/`gemPop` удалить, если больше не используются (проверить агентом `grep`). Остальное в `blastFx` пока оставить. Выделить `playStep`, добавить `__SUN.strike`.
- [ ] **Step 4:** тот же запуск → PASS; `node --test tests/` → PASS.
- [ ] **Step 5:** Commit: `git commit -m "Раскол камня на осколки рисунка; без белой вспышки и тряски поля"`

### Task 3: удар бомбы + видео-образец (стоп до «да» пользователя)

**Files:**
- Create: `blender/explosion_vdb.py` (вариант `blender/fire_vdb.py` для взрыва), `tools/pack_strike.py` (вариант `tools/pack_fire.py`: кадры → `assets/fx/bomb.webp` + `assets/fx/bomb.json`), `assets/fx/LICENSE-*.txt`
- Create: `tools/record-fx.js` — запись видео образца (Playwright `recordVideo`, Firefox, 1366×768, звук выключен, по образцу `art-src/phase2/backdrop/spike/spike-rec.js`)
- Modify: `js/visuals-fx.js`, `css/fx.css`, `js/game.js` (`blastFx`: ветка `bomb`), `art-src/phase2/PROMPTS.md` (раздел «Шаг 5»)

**Interfaces:**
- Consumes: `Fx.shatter`, `__SUN.strike` (Task 2), `FxCore.strikeTargets`, `TIMING.strikeMs.bomb` (Task 1).
- Produces: `Fx.strike(trigger, targets)` — общий вход ударов; в этой задаче реализована ветка `bomb`: спрайт-лист взрыва `.fx-strike.fx-bomb` на 3×3 клетки вокруг триггера (кадры через `steps()` по `background-position`, длительность `TIMING.strikeMs.bomb`), угли (`budget.embers`) на canvas, летят от центра и гаснут. `blastFx` для `bomb` вызывает `Fx.strike`, остальные типы — пока старый код.

- [ ] **Step 1: Найти источник взрыва.** Страница JangaFX `https://jangafx.com/software/embergen/download/free-vdb-animations/` — выбрать взрыв с тёмным дымом (CC0). Если скачать нельзя без пользователя — попросить его скачать архив и положить вне проекта, как с огнём. Запасной путь, только если CC0 нет: Codex рисует 8–12 кадров обсидианового взрыва (бриф в `PROMPTS.md`).
- [ ] **Step 2:** Рендер и сборка: `explosion_vdb.py` (тёмный дым, огненные края, прозрачный фон, 24 к/с, ≤ 24 кадра, кадр ≤ 256 px) → `pack_strike.py` → `assets/fx/bomb.webp` ≤ 400 КБ. Проверка: `python3 tools/pack_strike.py --check` печатает число кадров и размер, выход 0.
- [ ] **Step 3:** Добавить в e2e `13 strikes`: `__SUN.strike(4, 4, 'bomb')` → появляется `.fx-bomb`, его центр в пределах 5 % от центра клетки (4,4); `Fx.particles() > 0` за 200 мс; через 1,5 с узлов `.fx-*` в `#fx` нет и `Fx.particles() === 0`. Запустить → FAIL.
- [ ] **Step 4:** Реализовать ветку `bomb`; e2e → PASS.
- [ ] **Step 5:** Записать видео: `node tools/record-fx.js --out art-src/phase2/strikes/sample1.webm` — 3 обычных хода, затем `strike` бомбы в центре, затем бомба на «Спокойно». Видео ~10 с.
- [ ] **Step 6:** Commit (`assets/fx`, скрипты, `PROMPTS.md`, видео не коммитить, если > 5 МБ): `git commit -m "Удар бомбы: обсидиановый взрыв из CC0-симуляции, угли"`
- [ ] **Step 7: СТОП.** Показать пользователю видео (путь целиком), спросить через AskUserQuestion: «да, так» / «поправить» (что). Тряску 1–2 px не делаем, если пользователь сам не попросит. Дальше — только после «да».

### Task 4: удары молнии, солнца и тотема + второе видео

**Files:**
- Create: спрайты `assets/fx/beam-turquoise.webp`, `assets/fx/ray-gold.webp`, `assets/fx/wave-jade.webp` (мягкие полосы/кольца; источник — Codex в утверждённой манере или CC0-флипбук; бриф и результат в `PROMPTS.md`)
- Modify: `js/visuals-fx.js`, `css/fx.css`, `js/game.js` (`blastFx` целиком → `Fx.strike`; удалить `beamFx`, `sunBurstFx`, `sunRaysFx`, `shockwaveFx` в части ударов и их CSS, если больше не используются — проверить агентом `grep`; `impactFx` и `vine-snap` оставить)

**Interfaces:**
- Consumes: `Fx.strike`, `FxCore.strikeTargets`, `mergeDelays` (уже подключён в Task 2).
- Produces: ветки `Fx.strike`:
  - `line`: бирюзовый луч `.fx-strike.fx-line` из клетки триггера в обе стороны вдоль `lineDir` (`scaleX`/`scaleY` от 0 до 1 за ~250 мс, затем угасание), непрозрачность × `beamAlpha`.
  - `sun`: от клетки солнца к каждой цели — узкий золотой луч `.fx-ray` (поворот `atan2`, длина до цели), появляется в `delay` цели; камень цели раскалывается в тот же `delay` (через `mergeDelays`); в центре — мягкий золотой диск, гаснет к 900 мс. Лучей не больше 16 (если целей больше — лучи к 16 ближайшим, остальные раскалываются без луча).
  - `totem`: нефритовая волна `.fx-wave` бежит крестом от тотема (4 полосы, каждая растёт от центра со скоростью `waveStepMs` на клетку), под ней раскалываются камни по их `delay`.

- [ ] **Step 1:** e2e `13 strikes` дополнить: для `line` (`row` и `col`), `sun`, `totem` — свой узел (`.fx-line`, `.fx-ray`, `.fx-wave`) появляется ≤ 150 мс; для `sun` число `.fx-ray` = min(16, число целей); цепочка (Review Focus 1): поле, где у солнца 12+ целей и рядом бомба — пик узлов `Fx` в `#fx` ≤ 120 (MutationObserver), через 1,5 с узлов 0, `Fx.particles() === 0`. Запустить → FAIL.
- [ ] **Step 2:** Реализовать ветки; e2e → PASS; `node --test tests/` → PASS.
- [ ] **Step 3:** Видео `art-src/phase2/strikes/sample2.webm`: по одному удару каждого типа на «Обычно» и один на «Спокойно».
- [ ] **Step 4:** Commit: `git commit -m "Удары молнии, солнца и тотема"`
- [ ] **Step 5: СТОП.** Показать видео пользователю, получить «да» или правки.

### Task 5: режимы, итоговая проверка, документы

**Files:**
- Modify: `js/game.js` — `upgradeGem` (`game.js:976-990`), `refuseLocked` (`game.js:598`) и анимация перетасовки (`game.js:1026`): `element.animate` не вызывать при reduced-motion
- Modify: `tools/e2e/run.js`, `tools/e2e/README.md`, `README.md` (раздел «Эффекты поля»), `docs/superpowers/STATUS.md`, `art-src/phase2/PROMPTS.md`

- [ ] **Step 1:** e2e: сценарий `13 strikes reduced` (контекст `reducedMotion: 'reduce'`): обычный ход и `strike` каждого типа → `.fx-shard`, `.fx-ray`, `.fx-wave`, `.fx-line`, `.fx-bomb` не появляются, `Fx.particles() === 0`, камни всё равно исчезают. Сценарий `13 strikes low` (`sun-keeper-fx = 'low'`): у раскола ровно 3 `.fx-shard` на клетку, частиц на canvas 0. Пауза (Review Focus 3): сразу после `strike` бомбы открыть паузу → через 1,5 с узлов `.fx-*` 0, `Fx.particles() === 0`. Телефон 390×844 (Review Focus 4): центр `.fx-bomb` в 5 % от клетки. Запустить → FAIL там, где не реализовано.
- [ ] **Step 2:** Реализовать недостающее; `ONLY="13 strikes"` в Firefox → PASS.
- [ ] **Step 3:** Полный прогон один раз: `node tools/e2e/run.js` (аргумент по умолчанию `all`) во всех трёх браузерах (сценариев станет 35+). Ожидается всё зелёное; обрыв `http.server` (`ERR_CONNECTION_RESET`) — повторить только упавший сценарий через `ONLY=`. После прогона проверить `ps`: нет `chrome-headless-shell`, `run.js`, `http.server`.
- [ ] **Step 4:** `node --test tests/` → PASS; `node tools/level-bot.js --check --lands 1-2` → все 40 уровней проходимы (логика не менялась, проверка что ничего не задели).
- [ ] **Step 5:** Документы: README — как устроены эффекты и как пересобрать спрайты; STATUS — раздел «Этап 2, шаг 5 — сделан» и «Отложено после шага 5», пункт в списке «что делать» отметить; `tools/e2e/README.md` — сценарии 13.
- [ ] **Step 6:** Commit: `git commit -m "Эффекты поля: режимы, проверки, документы"`. Слить в `main` и запушить — только после того, как пользователь одобрил второе видео.
