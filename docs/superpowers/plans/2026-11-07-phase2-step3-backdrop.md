# «Хранитель Солнца», этап 2, шаг 3: живой фон — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** за полем первой земли «Джунгли Ягуара» лунная ночь в стиле концепта: у левого края течёт водопад с туманом, в правом верхнем углу светится и «дышит» луна, через неё медленно проплывают тонкие облака, по свободным местам летают светлячки. Всё медленное и приглушённое.

**Architecture:** фон земли собран из слоёв внутри слоя темы `.theme-bg[data-theme="1"]`, который уже создаёт `js/visuals.js`. Поэтому плавная смена земель остаётся как есть, через `opacity`. Плита-картина и водопад лежат в «сцене» `.bd-stage`. Сцена занимает экран по правилу cover с привязкой к левому краю, поэтому водопад всегда у левого края. Луна и облака привязаны к правому верхнему углу окна, а не к картине. Вода, ореол луны, туман и облака движутся CSS-анимациями только по `transform` и `opacity`. Светлячки рисуются на одном canvas в одном цикле `requestAnimationFrame`. Чистая логика — пределы, мерцание, выбор свободного места, режим — живёт в UMD-модуле `js/backdrop-core.js` и проверяется в Node. Слои готовит из картинок Codex скрипт `tools/pack_backdrop.py`, ему нужен только PIL.

**Tech Stack:** чистые HTML/CSS/JS без сборки. Системный `python3` с PIL 13, `cwebp`. Тесты: `node --test tests/`. Браузерные проверки: `tools/e2e/run.js`, Playwright в `/tmp/pw`.

**Spec:** `docs/superpowers/specs/2026-11-06-hranitel-solnca-design.md`: §7 (фон «приглушённый и чуть размытый»), §8 «Живые фоны», «Спокойствие», §3, §2 «Анти-цели». Ориентир настроения: `docs/superpowers/specs/assets/b-obsidian.png`.

## Решения

**Пользователь (2026-11-07):** расспросы пропустил («пропускай расспросы»). На пробный образец ответил **«Да, так хорошо»**. Образцы: `art-src/phase2/samples/backdrop-game-1366.mp4`, `backdrop-bare-1366.mp4`, `backdrop-waterfall-zoom.mp4`, `backdrop-bare-1366.png`. Пробник лежит в `art-src/phase2/backdrop/spike/` (`spike.js`, `spike.css`, `spike-rec.js`, `geom.json`). Это эталон вида: в игре всё должно выглядеть так же.

**Решения автора плана (пользователь может поправить):**
- **Где фон виден (замер 2026-11-07, 8 окон).** На десктопе от фона остаются боковые полосы: 59 px при 1366×768, 113 при 1366×650, 135 при 1920×1080, 436 при 2560×1440 и только 10 при 1024×768. Между колонками и полем есть зазор около 19–24 px. Справа от жаровен свободны уголки. Просвет в правой колонке есть только на высоких окнах. Поэтому водопад — узкая высокая лента у левого края, а луна — справа вверху, правее жаровни. На 4:3 (1024×768) водопад почти скрыт за левой колонкой: это допустимо.
- **Плита** — картина Codex `art-src/phase2/backdrop/src/plate.png` (1672×941, бриф `brief-plate.txt`). Затемнение и мягкость уже в картинке, CSS-фильтров на плите нет. Без апскейла: на 1920 и шире браузер растягивает сам, а фон по спецификации и так «чуть размытый».
- **Вода** — пробная техника. Поверх нарисованного водопада плиты бегут вниз два слоя «струй»: высокие частоты той же картины, растянутые по вертикали и бесшовные по вертикали. Смешивание `mix-blend-mode: screen`. Видны они только внутри маски воды (альфа-маска по яркости и синеве). Слой A — 3,2 с на плитку, непрозрачность 0,55. Слой B — 5,4 с, 0,35, сдвиг фона 37% 41%, задержка −2 с. Высота плитки — 0,7014 высоты сцены (660/941).
- **Туман** у подножия: радиальная заливка, 7 с туда и обратно, непрозрачность 0,55↔0,9, сдвиг ±4–5 %, масштаб до 1,08.
- **Луна** — диск Codex (`src/moon.png`) с ровной альфой (в исходнике почти все пиксели полупрозрачные). Размер `clamp(64px, 10vh, 130px)`, отступы `top: max(10px, 3vh)`, `right: max(8px, 2.2vw)`. Непрозрачность 0,8, `blur(.6px) brightness(.92)` вшиты в картинку. Ореол — радиальная заливка, «дыхание» за 9 с: непрозрачность 0,62↔0,9, масштаб 0,97↔1,03.
- **Облака** — картинка Codex на чёрном (`src/clouds.png`, бриф `brief-clouds2.txt`). Прозрачность считается по яркости. Первая попытка с готовой прозрачностью дала грубые края и отклонена, её не храним. Облака занимают полосу в правом верхнем углу шириной `min(46vw, 700px)` и высотой `max(150px, 26vh)`, края полосы растушёваны маской. Полный проход длится 140 с, непрозрачность 0,38.
- **Светлячки** — 16 штук на canvas поверх фона, под `.game-shell`. Появляются и летают только там, где нет табличек, кнопок, рамки поля, чаш жаровен, круга Солнечного Камня и полосы подсказки (отступ 14 px). Скорость 5–12 px/с, лёгкий подъём 2 px/с. Мерцание плавное, период 3,5–6,5 с, яркость от 0,08 до 0,8. Радиус ядра 1,0–1,7 px, свечение ×6.
- **Старые слои фона** `.light-shaft` (дорогой анимированный `blur(22px)`), точки `#fireflies`, листья `#leaves` и `.jungle::before` у земли с живым фоном не показываются (`body.has-backdrop`). Виньетка остаётся, её непрозрачность 0,55. У земли без живого фона (земля 2) всё как было.
- **Режимы** (`body[data-bd]`):
  - `run` — всё движется;
  - `paused` — вкладка скрыта или показан любой `.overlay.show`: все анимации фона на паузе, цикл светлячков стоит. Под размытым оверлеем ничего не движется, поэтому `backdrop-filter` не пересчитывается каждый кадр;
  - `still` — `prefers-reduced-motion` или телефон (`(max-width: 900px) and (orientation: portrait)`, `(orientation: landscape) and (max-height: 500px)`, как в `css/fire.css`): картина стоит, светлячков нет. На телефоне фона почти не видно (§7: «фоновые анимации упрощаются»).
  - Слабый компьютер `body[data-fx="low"]` (флаг ставит огонь, `js/visuals-fire.js`): светлячков нет, остальное идёт. Своего автоопределения у фона нет.
- **Данные земли.** У `land-01.js` новое поле `backdrop` (пути и геометрия). `land.bg` переходит на новую плиту, поэтому сюжетная сцена (`js/screens/story.js:85`) тоже получает лунную ночь. `land.mosaic` (картинка-награда) остаётся `bg-jaguar.webp`.
- **Земля 2 «Храм Змея»** в этом шаге получает свою плиту в том же стиле и общие слои (луна, облака, светлячки), если пользователь даст «да» на образец (задача 6). Своей воды у неё нет: водопад — примета первой земли. Если «да» не будет, земля 2 остаётся как есть.
- **Звук водопада** не добавляется (по спецификации — по желанию).
- **Бюджет:** все файлы `assets/backdrop/land1/` вместе не больше 450 КБ.

## Global Constraints

- Игрок — пожилой человек: кнопки не ниже **56 px**, текст на кнопках не меньше **20 px**, высокий контраст. Фон не спорит с полем: тёмный, приглушённый.
- Без резких вспышек и мигания (§2, §8). Пределы — `BackdropCore.LIMITS`, они проверяются тестами, в том числе на числа в `css/backdrop.css`.
- Главный браузер — **Firefox на Windows**. Проверять в Firefox, WebKit и Chromium через `tools/e2e/run.js`.
- Без сборки и npm-зависимостей. Игра работает со статического хостинга и с `file://`. Все ассеты — локальные файлы.
- Тексты интерфейса — HTML. Надписей в картинках нет.
- `prefers-reduced-motion` уважать: режим `still`.
- В любых тестах звук выключен: флажок `sun-treasures-muted` плюс заглушение браузера.
- Перед серией картинок показать пользователю 1–2 образца и получить «да» (для земли 1 получено, для земли 2 — задача 6).
- Не выкладывать на хостинг. Коммиты без подписей (`Co-Authored-By` и подобных не ставить).
- Сохранение `sun-keeper-save` не меняется. `js/game.js` и `js/core/board.js` не меняются: фон слушает только `body[data-land]`, `body[data-fx]`, оверлеи и `document.hidden`.
- Все слои фона — `aria-hidden="true"`, `pointer-events: none`. Лежат внутри `.jungle` (z-index −1), под `.game-shell` и оверлеями.
- При 1366×650 игровой экран по-прежнему не прокручивается.

## Review Focus

- **Фон не виден там, где задуман.** Работа может пройти все тесты, но остаться спрятанной за колонками. Проверка: задача 4, e2e «12 backdrop visible» — луна открыта не меньше чем на 60 % при 1366×768, 1366×650 и 1920×1080, у водопада открыто не меньше 25 % точек средней линии при 1366×768.
- **Светлячок поверх таблички.** Огонёк на тексте отвлекает и мешает читать. Проверка: e2e — ни одна точка из `__BD.flies()` не попадает в прямоугольники интерфейса (отступ 10 px), в том числе после смены размера окна.
- **Анимация под оверлеем.** Старт, карта, пауза и сцена размыты `backdrop-filter`, и движение под ними нагружает слабый компьютер. Проверка: e2e — на стартовом экране `body[data-bd="paused"]`, `__BD.frames` за 1 с не растёт, у `.bd-water` `animation-play-state: paused`.
- **Смена земли.** При переходе на землю 2 слой земли 1 гаснет и не продолжает крутить цикл, а старые лучи и листья возвращаются, если у земли 2 нет живого фона. Проверка: e2e — после `__SUN.start('2-01')` слой земли 1 не `.on`, `body.has-backdrop` соответствует земле 2, ошибок в консоли нет.
- **`file://`.** Плита, текстура, маска, луна и облака грузятся с диска во всех трёх браузерах. Маска в `-webkit-mask`/`mask` из локального файла работает. Проверка: задача 4, file://-сценарий — `naturalWidth > 0` у всех пяти, у `.bd-wf` вычисленная `mask-image` не `none`.

---

### Задача 1: Образцы на согласование (ворота) — сделано

- [x] **Шаг 1:** замер свободного места на 8 окнах (скрипт в черновике сессии, итог в «Решениях»).
- [x] **Шаг 2:** плита, луна и облака через Codex (брифы `art-src/phase2/backdrop/brief-*.txt`).
- [x] **Шаг 3:** пробник `art-src/phase2/backdrop/spike/` вставлен в настоящую игру через Playwright, записаны видео `art-src/phase2/samples/backdrop-*.mp4`.
- [x] **Шаг 4:** «Да, так хорошо» от пользователя.

### Задача 2: Слои из исходников (`tools/pack_backdrop.py`)

**Files:**
- Create: `tools/pack_backdrop.py`
- Уже есть (коммит ворот): `art-src/phase2/backdrop/src/plate.png`, `src/moon.png`, `src/clouds.png`; `art-src/phase2/backdrop/make_spike.py` — алгоритмы пробника на numpy, образец для переписывания на PIL (остаётся как запись).
- Create: `assets/backdrop/land1/plate.webp`, `water.webp`, `water-mask.webp`, `moon.webp`, `clouds.webp`, `backdrop.json`
- Modify: `art-src/phase2/PROMPTS.md` — раздел «Шаг 3 — живой фон»: брифы, что отклонено и почему, команда сборки.

**Interfaces:**
- Produces: `assets/backdrop/land1/backdrop.json`:
  `{ "plate": [1672, 941], "wf": { "x": 0.011962, "y": 0, "w": 0.089713, "h": 0.961743 }, "tile": 0.701382, "moon": 256, "clouds": [1086, 362] }`
  `wf` — прямоугольник воды в долях плиты, `tile` — высота плитки текстуры в долях высоты плиты (660/941). Числа взяты из пробника (`spike/geom.json`); если скрипт даст другие, правдой считать вывод скрипта, а задачи 3 и 4 берут их из JSON.

- [x] **Шаг 1: написать `tools/pack_backdrop.py`** — запуск `python3 tools/pack_backdrop.py --land 1` (пути по умолчанию: `art-src/phase2/backdrop/src` → `assets/backdrop/land1`). Только PIL, без numpy (в системном python3 numpy нет). Алгоритмы — как в пробнике `art-src/phase2/backdrop/make_spike.py` (там пути `gen-*/image.png`, теперь это `src/*.png`):
  - вырезка воды — прямоугольник плиты x 20–170, y 0–905;
  - маска: размытая на 10 px яркость, порог `(L−45)/40`, умноженный на синеву `(B−R+5)/30`, оба ограничены 0…1. Потом размытие 6 px и затухание: сверху на 40 px, снизу на 60 px. Сохранить как **альфа**-канал белой картинки WebP lossless: `mask` в CSS по умолчанию берёт альфу, а серая PNG без альфы не маскирует ничего (так было в пробнике);
  - струи: кусок y 150–750 вырезки, «высокие частоты» `(s − blur7(s))·2.2 + 8`, растяжение по вертикали ×1,3, бесшовность — последние 120 строк плавно переходят в первые 120, которые потом отбрасываются;
  - луна: окружность по рамке пикселей с альфой > 128, альфа заново — круг с суперсэмплингом ×4 и отступом 1,5 px, обрезка, 256×256; вшить `brightness(.92)` и размытие 0,6 px;
  - облака: альфа = `max(R,G,B)`, нормированная к 99,9-му процентилю, со степенью 0,8; цвет постоянный бледно-серо-голубой (190, 205, 225); уменьшить вдвое;
  - плита: WebP q 86, остальное — `cwebp`/PIL q 85–88;
  - печатать JSON, писать `backdrop.json` и размеры файлов.
- [x] **Шаг 2: запустить и проверить.** `python3 tools/pack_backdrop.py --land 1`. Ожидается: шесть файлов, сумма ≤ 450 КБ. В `water-mask.webp` есть альфа (`Image.open(...).mode == 'RGBA'`, минимум альфы 0, максимум 255). У `moon.webp` в центре альфа 255, в углах 0. Шов струй: средняя разность строк на стыке «последняя → первая» не больше средней разности соседних строк × 1,5 (скрипт печатает оба числа).
- [x] **Шаг 3: глазами.** Собрать лист `art-src/phase2/backdrop/check.png`: маска, плитка струй (две копии одна над другой — шов посередине), луна на `#0d1b2e`, облака на `#0d1b2e`. Посмотреть: шов не виден, у луны нет светлой или тёмной каймы.
- [x] **Шаг 4: коммит.**

```bash
git add tools/pack_backdrop.py assets/backdrop art-src/phase2/backdrop art-src/phase2/samples/backdrop-* art-src/phase2/PROMPTS.md
git commit -m "Живой фон: слои первой земли из картин Codex (tools/pack_backdrop.py)"
```

### Задача 3: Логика фона `js/backdrop-core.js`

**Files:**
- Create: `js/backdrop-core.js` (UMD, как `js/fire-core.js:13-19`)
- Test: `tests/backdrop-core.test.js`

**Interfaces:**
- Produces: `window.BackdropCore` / `module.exports`:
  - `LIMITS` (заморожен): `{ moonBreathMinS: 8, haloSwingMax: 0.3, cloudCrossMinS: 90, waterMinS: 2.5, fireflyMax: 18, fireflyAlphaMax: 0.8, fireflyBlinkMinS: 3, fireflySpeedMax: 14 }`
  - `FIREFLY` (заморожен): `{ count: 16, pad: 14, speed: [5, 12], rise: 2, period: [3.5, 6.5], alpha: [0.08, 0.8], radius: [1.0, 1.7], glow: 6 }`
  - `modeFor({ hidden, overlay, reduced, phone }) -> 'run' | 'paused' | 'still'` — `still` важнее `paused`.
  - `fliesOn(mode, low) -> boolean` — `mode === 'run' && !low`.
  - `fireflyAlpha(t, period, phase) -> number` — `k = 0.5 − 0.5·cos(2π(t + phase)/period)`, ответ `alpha[0] + (alpha[1] − alpha[0])·k²`.
  - `isFree(rects, x, y, pad) -> boolean` — `rects`: массив `{left, top, right, bottom}`; точка свободна, если не лежит ни в одном прямоугольнике, расширенном на `pad`.
  - `spawnPoint(rects, w, h, rand, tries = 60) -> {x, y} | null` — `x ∈ [4, w−4]`, `y ∈ [0.15h, h−6]`; `rand` — функция `() => [0,1)`; `null`, если за `tries` попыток места нет.
  - Внутри нет `Math.random()`, `Date.now()` и DOM.

- [x] **Шаг 1: тесты (падают).**

```js
const BC = require('../js/backdrop-core.js');
test('режимы: still важнее paused', () => {
  assert.equal(BC.modeFor({ hidden: false, overlay: false, reduced: false, phone: false }), 'run');
  assert.equal(BC.modeFor({ hidden: true, overlay: false, reduced: false, phone: false }), 'paused');
  assert.equal(BC.modeFor({ hidden: false, overlay: true, reduced: false, phone: false }), 'paused');
  assert.equal(BC.modeFor({ hidden: true, overlay: true, reduced: true, phone: false }), 'still');
  assert.equal(BC.modeFor({ hidden: false, overlay: false, reduced: false, phone: true }), 'still');
});
test('светлячки только в run и не в слабом режиме', () => {
  assert.equal(BC.fliesOn('run', false), true);
  assert.equal(BC.fliesOn('run', true), false);
  assert.equal(BC.fliesOn('paused', false), false);
  assert.equal(BC.fliesOn('still', false), false);
});
test('мерцание светлячка в пределах и без ступенек', () => {
  // по периоду 3.5 с с шагом 1/60 с: min ≥ 0.08, max ≤ LIMITS.fireflyAlphaMax,
  // разность соседних значений ≤ 0.02 (плавно, без вспышек)
});
test('числа FIREFLY не выходят за LIMITS', () => {
  // count ≤ fireflyMax, speed[1] + rise ≤ fireflySpeedMax, period[0] ≥ fireflyBlinkMinS, alpha[1] ≤ fireflyAlphaMax
});
test('isFree и spawnPoint обходят прямоугольники', () => {
  const rects = [{ left: 100, top: 0, right: 900, bottom: 600 }];
  assert.equal(BC.isFree(rects, 50, 300, 14), true);
  assert.equal(BC.isFree(rects, 90, 300, 14), false);
  // spawnPoint с детерминированным rand (линейный конгруэнтный) 200 раз: каждая точка isFree,
  // y ≥ 0.15·h; при rects на весь экран — null
});
test('числа анимаций в css/backdrop.css не выходят за LIMITS', () => {
  // читаем css/backdrop.css; длительности анимаций bdBreath ≥ moonBreathMinS,
  // bdDrift ≥ cloudCrossMinS, у .bd-water-a и .bd-water-b --dur ≥ waterMinS;
  // в @keyframes bdBreath разность opacity ≤ haloSwingMax
});
test('геометрия land-01 совпадает с assets/backdrop/land1/backdrop.json', () => {
  // Campaign land 1: backdrop.wf.{x,y,w,h} и backdrop.tile равны полям JSON (до 1e-6)
});
```

  Последние два теста зависят от задачи 4. До неё пусть падают, а в задаче 4 их нужно сделать зелёными.
- [x] **Шаг 2:** `node --test tests/backdrop-core.test.js`. Ожидается: FAIL, «Cannot find module '../js/backdrop-core.js'».
- [x] **Шаг 3:** написать `js/backdrop-core.js` по Interfaces. Шапка-комментарий — как у `fire-core.js`.
- [x] **Шаг 4:** `node --test tests/backdrop-core.test.js`. Ожидается: проходят все, кроме двух, зависящих от задачи 4.
- [x] **Шаг 5: коммит** `"Живой фон: логика и пределы (js/backdrop-core.js) с тестами"`.

### Задача 4: Слои в игре и браузерные проверки

**Files:**
- Create: `css/backdrop.css`, `js/visuals-backdrop.js`
- Modify: `js/campaign/land-01.js:49` (поле `backdrop`, `bg` → `assets/backdrop/land1/plate.webp`; `mosaic` без изменений)
- Modify: `js/visuals.js:38-53` — у земли с `land.backdrop` слой темы не получает `backgroundImage`: его заполняет `Backdrop.build(el, land, onReady)`. Слой `ready`, когда загрузилась плита. Пустой фон до загрузки не показывать.
- Modify: `index.html` — `css/backdrop.css` после `css/themes.css`; `js/backdrop-core.js` и `js/visuals-backdrop.js` перед `js/visuals.js:309`.
- Modify: `tools/e2e/run.js` (сценарий «12 backdrop», дополнение file://), `tools/e2e/README.md`
- Test: `tests/backdrop-core.test.js` (два теста из задачи 3 становятся зелёными)

**Interfaces:**
- Consumes: `BackdropCore` (задача 3), `assets/backdrop/land1/*` и `backdrop.json` (задача 2).
- Produces:
  - поле земли `backdrop: { plate, water, mask, moon, clouds, wf: {x, y, w, h}, tile, waterfall: true }` (пути от корня игры, числа из `backdrop.json`);
  - `window.Backdrop.build(layerEl, land, onReady)` — строит внутри слоя `.bd-stage` (плита `img.bd-plate`; `.bd-wf` с маской и двумя `.bd-water`; `.bd-mist`), `.bd-sky` (`.bd-moon-wrap` > `.bd-halo` + `img.bd-moon`; `.bd-clouds` > `.bd-cloud-track`). Все анимированные элементы получают класс `bd-anim`;
  - один общий `canvas.bd-flies` в `.jungle`, рисуются светлячки активного слоя (`.theme-bg.on` с живым фоном);
  - `body.has-backdrop` — активна земля с живым фоном (ставит `js/visuals.js` в `apply()`);
  - `body[data-bd]` — `run | paused | still` (ставит `visuals-backdrop.js` по `BackdropCore.modeFor`);
  - при `?debug`: `window.__BD = { frames, mode, flies: () => [{x, y}], busy: () => rects }`.

- [x] **Шаг 1: `css/backdrop.css`** — перенести правила из `art-src/phase2/backdrop/spike/spike.css`. Отличия:
  - пути — от `css/` (`../assets/backdrop/land1/...`), но плитку, маску и облака задаёт JS через custom properties `--bd-tex`, `--bd-mask`, `--bd-clouds`, `--bd-tile` у слоя, чтобы CSS не знал номер земли;
  - `--bd-tile: calc(max(100vh, 56.25vw) * <tile>)`, отношение сторон сцены — из `plate` (`16:9` ≈ 1672/941; `max(100vw, 177.7vh)` / `max(100vh, 56.27vw)`);
  - `body:not([data-bd="run"]) .bd-anim { animation-play-state: paused; }`;
  - `body[data-bd="still"] .bd-anim { animation: none; }`;
  - `body.has-backdrop .light-shaft, body.has-backdrop #fireflies, body.has-backdrop #leaves { display: none; }`, `body.has-backdrop .jungle::before { display: none; }`, `body.has-backdrop .vignette { opacity: .55; }`;
  - `-webkit-mask` и `mask` обе строки (Safari).
- [x] **Шаг 2: `js/visuals-backdrop.js`** — по Interfaces. Светлячки — как в `spike.js`, числа из `BackdropCore.FIREFLY`, мерцание `BackdropCore.fireflyAlpha`, места `BackdropCore.spawnPoint`/`isFree`. Если светлячок упирается в занятое место или край, он разворачивается. Прямоугольники занятых мест: `.hud-plaque, .plate-btn, .board-frame, .brazier-bowl, .brazier-fire, .sun-stone, .hint-bar, .combo-badge` с видимым размером. Пересчёт — на `resize` (с задержкой 120 мс), после `document.fonts.ready`, при открытии и закрытии оверлеев. После пересчёта светлячки, оказавшиеся на занятом месте, перерождаются. Режим пересчитывается при изменении класса любого `.overlay`, на `visibilitychange`, на `change` у `matchMedia` для reduced-motion и телефона и при изменении `body[data-fx]`. Цикл `requestAnimationFrame` работает только при `fliesOn(mode, low)`; при выходе из режима canvas очищается. Шаг времени — не больше 50 мс. DPR — не больше 2. На слое `aria-hidden="true"`.
- [x] **Шаг 3: данные и подключение** — `land-01.js`, `visuals.js`, `index.html` по Files. `node --test tests/` — все 138 старых тестов и новые проходят.
- [x] **Шаг 4: глазами.** Скриншоты на 1366×768, 1366×650, 1920×1080, 1024×768, 390×844 (игра и стартовый экран) сравнить с `art-src/phase2/samples/backdrop-bare-1366.png` и видео. Нужно убедиться: водопад и луна на месте, облака проходят по луне, светлячки не на табличках, на телефоне всё стоит, на земле 2 прежний фон.
- [x] **Шаг 5: e2e «12 backdrop»** в `tools/e2e/run.js`:
  - окна 1366×768, 1366×650, 1920×1080, 1024×768, 390×844, уровень 1-01;
  - у `.bd-stage`, `.bd-sky`, `.bd-flies` `aria-hidden` и вычисленный `pointer-events: none`;
  - луна: сетка 7×7 точек по рамке `.bd-moon`, в каждой `document.elementFromPoint` — элемент внутри `.jungle`. Открыто не меньше 60 % при 1366×768, 1366×650 и 1920×1080; на 1024×768 только записать долю;
  - водопад: 20 точек по средней вертикали `.bd-wf`, открыто не меньше 25 % при 1366×768 и 1920×1080;
  - светлячки: через 2 с все `__BD.flies()` вне `__BD.busy()` с отступом 10 px; то же после `page.setViewportSize` на другое окно и 1 с;
  - режимы: на стартовом экране `data-bd="paused"`, `__BD.frames` за 1 с не растёт, `getComputedStyle(.bd-water).animationPlayState === 'paused'`; на уровне `run` и `frames` растёт; на 390×844 `still`, `animationName` у `.bd-water` — `none`;
  - смена земли: `__SUN.start('2-01')` → слой `[data-theme="1"]` без `.on`, `body.has-backdrop` равен наличию `backdrop` у земли 2 (сейчас `false`, после задачи 6 — `true`), ошибок консоли нет;
  - скриншоты `<окно>-L4-backdrop.png`.

  В сценарии «11 prefers-reduced-motion» добавить: `data-bd="still"`, холст светлячков пуст.
- [x] **Шаг 6: file://** — в `smokeFile` пять картинок фона (`plate`, `water`, `mask`, `moon`, `clouds` из `Campaign` для земли 1) грузятся через `new Image()` с `naturalWidth > 0`, `getComputedStyle(.bd-wf).maskImage` (или `webkitMaskImage`) не `none`.
- [x] **Шаг 7: прогон.** `node --test tests/` — всё проходит. `NODE_PATH=/tmp/pw/node_modules node tools/e2e/run.js` (сервер `python3 -m http.server 8775` отдельно), по очереди Firefox, WebKit, Chromium. Ожидается: 0 FAIL. Старые сценарии про огонь и раскладку не сломаны. Обновить счёт сценариев и описание в `tools/e2e/README.md`.
- [x] **Шаг 8: коммит** `"Живой фон первой земли: водопад, луна, облака, светлячки; проверки e2e"`.

### Задача 5: Документация

**Files:**
- Modify: `README.md` — раздел «Визуальные слои»: новый абзац «Живой фон» (слои, режимы `data-bd`, флаг `sun-keeper-fx`, как пересобрать `tools/pack_backdrop.py`); раздел «Структура»: новые файлы.
- Modify: `docs/superpowers/STATUS.md` — шаг 3 сделан (что вошло, что отложено), следующий шаг.
- Modify: этот план — отметить шаги.

- [x] **Шаг 1:** написать тексты (простым языком, по-русски, как в соседних разделах).
- [x] **Шаг 2: коммит** `"Живой фон: README и STATUS"`.

### Задача 6: Земля 2 «Храм Змея» (ворота — образец)

**Files:**
- Create: `art-src/phase2/backdrop/brief-plate-land2.txt`, `src/plate-land2.png`, `art-src/phase2/samples/backdrop-land2.png`
- Create: `assets/backdrop/land2/plate.webp`, `backdrop.json` (без воды; луна и облака — копии из `land1`, без дублирования файлов: пути в данных земли 2 указывают на `land1/moon.webp` и `land1/clouds.webp`)
- Modify: `tools/pack_backdrop.py` (`--land 2`, без воды), `js/campaign/land-02.js:54`, `tools/e2e/run.js` (ожидание `has-backdrop` для земли 2)

- [x] **Шаг 1: образец.** Бриф в том же языке, что `brief-plate.txt`. Ночь, тот же синий лунный свет. В правой трети большой ступенчатый храм со змеиными головами у лестницы. Небо справа вверху пустое, под луну. Центр — спокойная дымка. Без воды. Показать пользователю кадр игры 1366×768 с этим фоном (через пробник `spike-rec.js` или уже через игру) и спросить «да».
- [x] **Шаг 2 (только после «да»):** собрать `land2`, подключить `backdrop` у земли 2 (`waterfall: false` — `.bd-wf` и `.bd-mist` не строятся), `land.bg` → новая плита, `mosaic` без изменений. Тесты и e2e по задаче 4, шаг 7.
- [x] **Шаг 3: коммит** `"Живой фон второй земли: плита храма, луна, облака, светлячки"`.

  Если «да» нет, задача закрывается без изменений кода, а в STATUS это записывается как отложенное.
