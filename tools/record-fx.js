/* Запись видео-образца эффектов поля (этап 2, шаг 5).
 *
 * Playwright, окно 1366×768, звук выключен (флажок sun-treasures-muted
 * и выключенный звук браузера), огонь в полном режиме, ?debug, уровень 1-01.
 * Сценарий: 3 обычных хода, удар бомбы в центре поля
 * (__SUN.strike(4, 4, 'bomb')), затем то же на «Спокойно». ~10 с.
 * Сервер (python3 -m http.server) скрипт поднимает сам и гасит в finally.
 *
 *   NODE_PATH=/tmp/pw/node_modules node tools/record-fx.js \
 *       --out art-src/phase2/strikes/sample1.webm [--stills <папка>] [--port 8776] \
 *       [--browser chromium|firefox]
 *
 * Видео пишет Chromium: запись экрана headless-Firefox в Playwright
 * присылает только изменившиеся куски кадра, и неподвижная часть экрана
 * в видео остаётся чёрной (проверено на этом образце). Кадры (--stills)
 * снимает Firefox, как e2e. Загрузка страницы из видео вырезается
 * ffmpeg (если он есть): видео начинается с готового поля.
 *
 * --stills — отдельным проходом без видео снять кадры бомбы: до, пик,
 * дым, после, и удар у края поля (кадры экрана целиком и крупно поле).
 */
const { firefox, chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(ROOT, opt('out') || 'art-src/phase2/strikes/sample1.webm');
const STILLS = opt('stills') ? path.resolve(opt('stills')) : null;
const PORT = opt('port') || '8776';
const URL = `http://localhost:${PORT}/index.html?debug`;
const VP = { width: 1366, height: 768 };
const BROWSER = opt('browser') || (STILLS ? 'firefox' : 'chromium');

const wait = ms => new Promise(res => setTimeout(res, ms));

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(URL); if (r.ok) return; } catch (e) { /* ещё не поднялся */ }
    await wait(100);
  }
  throw new Error('http.server не отвечает на ' + PORT);
}

async function newCtx(browser, video) {
  const ctx = await browser.newContext({
    viewport: VP,
    ...(video ? { recordVideo: { dir: path.join(path.dirname(OUT), '.rec'), size: VP } } : {})
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('sun-treasures-muted', '1');
      localStorage.setItem('sun-keeper-fx', 'full');
    } catch (e) { /* без хранилища — звук всё равно выключен в браузере */ }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => console.log('pageerror:', e.message));
  return { ctx, page };
}

/* Пропустить сюжетные сцены, дождаться начала уровня и свободного поля */
async function waitPlayable(page) {
  for (let i = 0; i < 150; i++) {
    const st = await page.evaluate(() => ({
      story: document.getElementById('storyScreen').classList.contains('show'),
      ok: !!(window.__SUN && __SUN.state.started && __SUN.state.running && !__SUN.state.busy)
    }));
    if (st.ok) return;
    if (st.story) await page.click('#storySkipBtn', { timeout: 1000 }).catch(() => {});
    await wait(150);
  }
  throw new Error('уровень не начался');
}

async function openLevel(page) {
  await page.goto(URL);
  await page.waitForSelector('#startScreen.show');
  await page.waitForFunction(() => window.__SUN && __SUN.state.grid && __SUN.state.grid.length === 8);
  await page.click('#startScreen [data-difficulty-btn="normal"]');
  await page.click('#playBtn');
  await waitPlayable(page);
  const id = await page.evaluate(() => __SUN.state.levelId);
  if (id !== '1-01') throw new Error('ждали уровень 1-01, открыт ' + id);
}

async function move(page) {
  await page.evaluate(async () => {
    const m = __SUN.findMove();
    if (m) await __SUN.attemptSwap(m[0], m[1]);
  });
  await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
}

async function bomb(page, r, c) {
  await page.evaluate(([r, c]) => __SUN.strike(r, c, 'bomb'), [r, c]);
  await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
}

/* Тот же уровень на «Спокойно»: сложность меняется только при запуске уровня */
async function toCalm(page) {
  await page.evaluate(() => { Game.setDifficulty('calm'); __SUN.start('1-01'); });
  await waitPlayable(page);
  const d = await page.evaluate(() => document.body.dataset.difficulty);
  if (d !== 'calm') throw new Error('body[data-difficulty] = ' + d + ', ждали calm');
}

async function recordVideo(browser) {
  const { ctx, page } = await newCtx(browser, true);
  const t0 = Date.now();
  const sec = () => (Date.now() - t0) / 1000;
  // Куски видео [начало, конец] в секундах: без загрузки и без отсчёта «3, 2, 1»
  const keep = [];
  try {
    await openLevel(page);
    keep.push([sec(), null]);
    await wait(700);
    for (let i = 0; i < 3; i++) { await move(page); await wait(450); }
    await bomb(page, 4, 4);
    await wait(900);
    keep[0][1] = sec() + 0.3;
    await toCalm(page);
    keep.push([sec() - 0.4, null]);
    await wait(600);
    await bomb(page, 4, 4);
    await wait(1100);
  } finally {
    const video = page.video();
    await ctx.close();
    if (video) {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      const raw = OUT.replace(/\.webm$/, '') + '.raw.webm';
      await video.saveAs(raw);
      await video.delete();
      trim(raw, OUT, keep);
    }
    fs.rmSync(path.join(path.dirname(OUT), '.rec'), { recursive: true, force: true });
  }
}

/* Склеить нужные куски (VP9, без звука): без загрузки страницы и без
 * отсчёта перед уровнем на «Спокойно». keep — [[начало, конец|null], …], с. */
function trim(raw, out, keep) {
  const parts = keep.filter(k => k[0] != null);
  const chains = parts.map(([a, b], i) =>
    `[0:v]trim=start=${a.toFixed(2)}${b != null ? ':end=' + b.toFixed(2) : ''},setpts=PTS-STARTPTS[v${i}]`);
  const graph = chains.join(';') + ';' + parts.map((_, i) => `[v${i}]`).join('') + `concat=n=${parts.length}:v=1[v]`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-filter_complex', graph, '-map', '[v]',
    '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-row-mt', '1', '-an', out], { stdio: 'inherit' });
  if (r.status === 0) fs.rmSync(raw);
  else {
    console.log('ffmpeg не сработал — оставлено видео целиком');
    fs.renameSync(raw, out);
  }
}

/* Кадры бомбы по времени от начала удара: экран целиком и крупно поле */
async function shoot(page, name, r, c, marks) {
  const board = await page.evaluate(() => {
    const b = document.getElementById('fx').getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height };
  });
  const pad = 24;
  const clip = { x: board.x - pad, y: board.y - pad, width: board.width + 2 * pad, height: board.height + 2 * pad };
  await page.screenshot({ path: path.join(STILLS, `${name}-before.png`) });
  const t0 = Date.now();
  const run = page.evaluate(([r, c]) => __SUN.strike(r, c, 'bomb'), [r, c]);
  for (const [label, ms] of marks) {
    await wait(Math.max(0, ms - (Date.now() - t0)));
    const at = Date.now() - t0;
    // Сначала крупно поле (ближе к метке времени), потом экран целиком
    await page.screenshot({ path: path.join(STILLS, `${name}-${label}-board.png`), clip });
    await page.screenshot({ path: path.join(STILLS, `${name}-${label}.png`) });
    console.log(`${name}-${label}: ${at} ms`);
  }
  await run;
  await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
}

async function stills(browser) {
  fs.mkdirSync(STILLS, { recursive: true });
  const { ctx, page } = await newCtx(browser, false);
  try {
    await openLevel(page);
    await move(page);
    await wait(1200);
    await shoot(page, 'bomb', 4, 4, [['peak', 220], ['smoke', 400], ['after', 1300]]);
    await wait(800);
    await shoot(page, 'edge', 0, 7, [['peak', 300]]);
    await wait(800);
    await toCalm(page);
    await wait(800);
    await shoot(page, 'calm', 4, 4, [['peak', 280]]);
  } finally {
    await ctx.close();
  }
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', PORT], { cwd: ROOT, stdio: 'ignore' });
  let browser = null;
  try {
    await waitServer();
    browser = BROWSER === 'firefox'
      ? await firefox.launch({ firefoxUserPrefs: { 'media.volume_scale': '0.0' } })
      : await chromium.launch({ args: ['--mute-audio'] });
    if (STILLS) await stills(browser);
    else {
      await recordVideo(browser);
      console.log('видео:', OUT, Math.round(fs.statSync(OUT).size / 1024) + ' КБ');
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
})().catch(e => { console.log('ERR', e.message); process.exitCode = 1; });
