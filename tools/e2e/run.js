const { firefox, webkit, chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.GAME_ROOT || path.resolve(__dirname, '../..');
const OUT = process.env.E2E_OUT || path.join(require('os').tmpdir(), 'hranitel-e2e');
fs.mkdirSync(OUT, { recursive: true });
const PORT = process.env.PORT || '8775';
const HTTP = `http://localhost:${PORT}/index.html?debug`;
const FILE = `file://${ROOT}/index.html?debug`;

function launchOpts(bname) {
  if (bname === 'firefox') return { firefoxUserPrefs: { 'media.volume_scale': '0.0' } };
  if (bname === 'chromium') return { args: ['--mute-audio'] };
  return {};
}
const results = [];
const consoleLog = {};
function rec(browser, scenario, ok, notes) {
  results.push({ browser, scenario, ok, notes: notes || '' });
  console.log(`[${browser}] ${ok ? 'PASS' : 'FAIL'} ${scenario} ${notes || ''}`);
}
function assert(c, msg) { if (!c) throw new Error('assert: ' + msg); }

// Все открытые контексты. Сценарий, упавший до своего ctx.close(), не оставляет
// живую страницу: scenario() закрывает всё, что он открыл. Иначе страница с
// огнём и живым фоном анимируется до конца набора и грузит компьютер.
const openContexts = new Set();

async function newPage(browser, bname, label, viewport, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: viewport || { width: 1366, height: 768 }, ...(opts.reducedMotion ? { reducedMotion: 'reduce' } : {}) });
  await ctx.addInitScript((fxMode) => {
    try { localStorage.setItem('sun-treasures-muted', '1'); } catch (e) {}
    // огонь: полный режим, чтобы медленный headless не включил слабый (без искр) сам;
    // opts.fx = 'low' включает слабый режим нарочно
    if (fxMode) { try { localStorage.setItem('sun-keeper-fx', fxMode); } catch (e) {} }
  }, opts.fx || (opts.fxFull ? 'full' : ''));
  openContexts.add(ctx);
  ctx.on('close', () => openContexts.delete(ctx));
  const page = await ctx.newPage();
  const key = bname + '/' + label;
  consoleLog[key] = consoleLog[key] || [];
  const L = consoleLog[key];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) L.push(`console.${m.type()}: ${m.text()} @${m.location().url}`); });
  page.on('pageerror', e => L.push('pageerror: ' + e.message));
  page.on('requestfailed', r => L.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
  return { ctx, page };
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
async function shot(page, bname, name) {
  const dir = path.join(OUT, 'shots', bname);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name + '.png');
  await page.screenshot({ path: f });
  return f;
}
async function waitStarted(page, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await ev(page, () => ({
      story: document.getElementById('storyScreen').classList.contains('show'),
      started: !!(window.__SUN && window.__SUN.state.started)
    }));
    if (st.started) return;
    if (st.story) await page.click('#storySkipBtn').catch(() => {});
    await page.waitForTimeout(150);
  }
  throw new Error('level did not start');
}
async function startFresh(page, url) {
  await page.goto(url);
  await page.waitForSelector('#startScreen.show');
  await page.waitForFunction(() => window.__SUN && window.__SUN.state.grid && window.__SUN.state.grid.length === 8 && window.__SUN.state.grid[7][7]);
}
async function playRealMove(page) {
  await ev(page, async () => {
    const S = window.__SUN;
    const m = S.findMove();
    if (m) await S.attemptSwap(m[0], m[1]);
  });
  await page.waitForFunction(() => !window.__SUN.state.busy, null, { timeout: 15000 });
}
async function forceWin(page) {
  await ev(page, () => {
    const S = window.__SUN;
    S.state.goals.forEach(g => { g.got = g.need; });
    S.checkEnd();
  });
  await page.waitForSelector('#endScreen.show', { timeout: 10000 });
}
const dbg = (page) => ev(page, () => ({ levelId: __SUN.state.levelId, difficulty: __SUN.state.levelDifficulty, timeLeft: __SUN.state.timeLeft, goals: __SUN.state.goals.map(g => ({ ...g })), running: __SUN.state.running }));

async function scenario(bname, name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const before = new Set(openContexts);
  try { const notes = await fn(); rec(bname, name, true, notes); }
  catch (e) { rec(bname, name, false, e.message.split('\n')[0]); }
  finally {
    const left = [...openContexts].filter(c => !before.has(c));
    await Promise.all(left.map(c => c.close().catch(() => {})));
    left.forEach(c => openContexts.delete(c));
  }
}

async function suite(bt, bname, url) {
  const browser = await bt.launch(launchOpts(bname));
  try {
    // ---- 1 ----
    await scenario(bname, '1 fresh start/prologue/level/win/map/reload', async () => {
      const { ctx, page } = await newPage(browser, bname, 's1');
      await startFresh(page, url);
      const title = (await page.innerText('.start-title')).replace(/\s+/g, ' ').trim();
      assert(title === 'Хранитель Солнца', 'title: ' + title);
      const nd = await page.locator('#startScreen [data-difficulty-btn]').count();
      assert(nd === 3, 'difficulty buttons ' + nd);
      assert((await page.textContent('#mapBtn')).includes('Путь хранителя'), 'map btn');
      await shot(page, bname, 'desktop-1-start');
      await page.click('#playBtn');
      await page.waitForSelector('#storyScreen.show');
      const texts = [];
      for (let i = 0; i < 3; i++) {
        await page.waitForFunction(() => document.getElementById('storyText').textContent.length > 0 && document.getElementById('storyText').classList.contains('shown'));
        texts.push(await page.textContent('#storyText'));
        if (i === 0) await shot(page, bname, 'desktop-story-prologue');
        await page.click('#storyNextBtn');
        await page.waitForTimeout(350);
      }
      assert(texts[0].includes('Тзаркун'), 'prologue text: ' + texts[0]);
      await page.waitForFunction(() => document.getElementById('storyScreen').classList.contains('show'), null, { timeout: 5000 });
      await page.waitForFunction(() => document.getElementById('storyText').classList.contains('shown'));
      await page.waitForTimeout(400);
      const intro1 = await page.textContent('#storyText');
      assert(!intro1.includes('Тзаркун'), '1-intro expected: ' + intro1);
      const step = await page.textContent('#storyStep');
      await shot(page, bname, 'desktop-story-intro');
      await page.click('#storySkipBtn');
      await waitStarted(page);
      const d = await dbg(page);
      assert(d.levelId === '1-01', 'level ' + d.levelId);
      // «Спокойно»: на табличке времени знак бесконечности, тревоги нет
      const calm = await ev(page, () => ({ time: document.getElementById('timeValue').textContent.trim(), urgency: document.body.dataset.urgency }));
      assert(calm.time === '∞', 'calm timeValue: ' + JSON.stringify(calm.time));
      assert(calm.urgency === undefined || calm.urgency === '', 'calm urgency: ' + JSON.stringify(calm.urgency));
      await shot(page, bname, 'desktop-3-level');
      await playRealMove(page);
      await forceWin(page);
      await page.waitForTimeout(600);
      const stars = await page.textContent('#endStarsText');
      assert(/из 3/.test(stars), 'stars text ' + stars);
      const frag = await page.textContent('#endFragmentName');
      assert(frag.includes('Каменный осколок') && await page.isVisible('#endFragment'), 'fragment ' + frag);
      await shot(page, bname, 'desktop-4-end');
      await page.click('#endHomeBtn');
      await page.waitForSelector('#mapScreen.show');
      await page.waitForTimeout(500);
      const tier = await page.locator('.mosaic-cell').first().getAttribute('class');
      assert(/tier-stone/.test(tier), 'mosaic cell1 class: ' + tier);
      const bg = await page.locator('.mosaic-cell').first().evaluate(e => e.style.backgroundImage);
      assert(bg.includes('url'), 'mosaic bg');
      await shot(page, bname, 'desktop-2-map');
      const saveAfterWin = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      const save2 = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      assert(save2 === saveAfterWin, 'save changed on reload');
      const lv = await ev(page, () => Game.getSave().levels['1-01']);
      assert(lv && lv.calm && lv.calm.stars >= 1, 'persisted ' + JSON.stringify(lv));
      assert(await page.isVisible('#continueBtn'), 'continue visible');
      await page.click('#mapBtn');
      await page.waitForSelector('#mapScreen.show');
      await page.waitForTimeout(400);
      const tier2 = await page.locator('.mosaic-cell').first().getAttribute('class');
      assert(/tier-stone/.test(tier2), 'mosaic after reload ' + tier2);
      // Следующий уровень: первый сектор Солнечного Камня заполнен каменным осколком
      await ev(page, () => { window.__SUN.start('1-02'); });
      await waitStarted(page);
      await page.waitForTimeout(300);
      const seg0 = await ev(page, () => { const e = document.querySelectorAll('#sunStone .sun-seg')[0]; return e ? String(e.getAttribute('class')) : null; });
      assert(seg0 && !/\bempty\b/.test(seg0) && /tier-stone/.test(seg0), 'sector 0 after win: ' + seg0);
      await ctx.close();
      return `stars="${stars}" frag="${frag}" step="${step}" intro1="${intro1.slice(0, 40)}" calm=∞ sector0="${seg0}"`;
    });

    // ---- 2 ----
    await scenario(bname, '2 challenge 1-01 timer 96 need 16', async () => {
      const { ctx, page } = await newPage(browser, bname, 's2');
      await startFresh(page, url);
      await page.click('#startScreen [data-difficulty-btn="challenge"]');
      await page.click('#playBtn');
      await waitStarted(page);
      await page.waitForTimeout(300);
      const d = await dbg(page);
      const txt = await page.textContent('#timeValue');
      const chips = await page.locator('.goal-chip').allTextContents();
      assert(d.timeLeft <= 96 && d.timeLeft > 94, 'timeLeft ' + d.timeLeft);
      const needs = d.goals.map(g => g.need);
      assert(needs.includes(16), 'needs ' + JSON.stringify(needs));
      await shot(page, bname, 'desktop-challenge-level');
      await ctx.close();
      return `difficulty=${d.difficulty} timeLeft=${d.timeLeft.toFixed(1)} text=${txt} goals=${JSON.stringify(needs)} chips=${JSON.stringify(chips.map(s => s.replace(/\s+/g, ' ').trim()))}`;
    });

    // ---- 3 ----
    await scenario(bname, '3 land 2 vines', async () => {
      const { ctx, page } = await newPage(browser, bname, 's3');
      await startFresh(page, url);
      await ev(page, () => { window.__SUN.start('2-01'); });
      await waitStarted(page);
      await page.waitForTimeout(300);
      const chip = await page.locator('.goal-chip.goal-vines').count();
      assert(chip === 1, 'vines chip count ' + chip);
      const chipText = (await page.locator('.goal-chip.goal-vines').textContent()).replace(/\s+/g, ' ').trim();
      assert(chipText.includes('Лианы'), 'chip text ' + chipText);
      const nLocked = await page.locator('.gem.is-locked').count();
      const nOverlay = await page.locator('.gem.is-locked .vine-overlay').count();
      assert(nLocked > 0 && nOverlay === nLocked, `locked ${nLocked} overlays ${nOverlay}`);
      await shot(page, bname, 'desktop-vines-level');
      const snap = () => ev(page, () => JSON.stringify(__SUN.state.grid.map(r => r.map(g => g.color + (g.locked ? 'L' : '')))));
      const before = await snap();
      const res = await ev(page, async () => {
        const S = window.__SUN;
        let target = null;
        for (let r = 0; r < 8 && !target; r++) for (let c = 0; c < 8 && !target; c++) {
          const g = S.gemAt(r, c);
          if (g && g.locked) {
            for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
              const o = S.gemAt(r + dr, c + dc);
              if (o && !o.locked) { target = { a: { r, c }, b: { r: r + dr, c: c + dc } }; break; }
            }
          }
        }
        if (!target) return 'no target';
        await S.attemptSwap(target.a, target.b);
        await S.attemptSwap(target.b, target.a);
        return target;
      });
      await page.waitForTimeout(500);
      const after = await snap();
      assert(res !== 'no target', 'no locked neighbour');
      assert(before === after, 'grid changed after refused swap');
      assert(await ev(page, () => __SUN.state.running && !__SUN.state.busy), 'game stuck after refuse');
      const box = await page.locator('.gem.is-locked').first().boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(500);
      const hint = await page.textContent('#hintBar');
      assert(await ev(page, () => !__SUN.state.busy && __SUN.state.running), 'stuck after click');
      assert(await snap() === before, 'grid changed after click');
      await ctx.close();
      return `locked=${nLocked} chip="${chipText}" hint="${hint}"`;
    });

    // ---- 4 ----
    await scenario(bname, '4 normal timeout loss; progress unchanged', async () => {
      const { ctx, page } = await newPage(browser, bname, 's4');
      await startFresh(page, url);
      await page.click('#startScreen [data-difficulty-btn="normal"]');
      await page.click('#playBtn');
      await waitStarted(page);
      await page.waitForTimeout(300);
      const d0 = await dbg(page);
      assert(d0.timeLeft > 0, 'timed');
      const before = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      // Тревога у таймера: 30 с — «напряжённо», 10 с — «срочно» (табличка и body[data-urgency])
      const urg = async (left, cls) => {
        await ev(page, (v) => { __SUN.state.timeLeft = v; }, left);
        await page.waitForFunction((c) => document.getElementById('timePlaque').classList.contains(c), cls, { timeout: 3000 });
        return ev(page, () => ({ cls: document.getElementById('timePlaque').className, urgency: document.body.dataset.urgency }));
      };
      const tenseState = await urg(30, 'tense');
      assert(/\btense\b/.test(tenseState.cls) && tenseState.urgency === 'tense', 'tense at 30s: ' + JSON.stringify(tenseState));
      const urgentState = await urg(10, 'urgent');
      assert(/\burgent\b/.test(urgentState.cls) && urgentState.urgency === 'urgent', 'urgent at 10s: ' + JSON.stringify(urgentState));
      await ev(page, () => { __SUN.state.timeLeft = 0.2; });
      await page.waitForSelector('#endScreen.show', { timeout: 10000 });
      await page.waitForTimeout(500);
      const title = await page.textContent('#endTitle');
      assert(title.includes('Время вышло'), 'title ' + title);
      assert(!(await page.isVisible('#nextBtn')), 'next visible on loss');
      assert(await page.isVisible('#retryBtn'), 'retry visible');
      await shot(page, bname, 'desktop-5-loss');
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      const after = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      const levels = await ev(page, () => JSON.stringify(Game.getSave().levels));
      assert(levels === '{}', 'levels ' + levels);
      assert(before === after, 'save changed: ' + before + ' -> ' + after);
      await ctx.close();
      return `title="${title}" levels=${levels} (timeLeft at start ${d0.timeLeft.toFixed(1)})`;
    });

    // ---- 5 ----
    await scenario(bname, '5 old save migration', async () => {
      const { ctx, page } = await newPage(browser, bname, 's5');
      await startFresh(page, url);
      const old = '{"best":9000,"unlocked":4,"relaxed":false}';
      await ev(page, o => { localStorage.setItem('sun-treasures-save', o); localStorage.removeItem('sun-keeper-save'); }, old);
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      await page.waitForFunction(() => window.__SUN && window.__SUN.state.grid[7] && window.__SUN.state.grid[7][7]);
      assert(await page.isVisible('#continueBtn'), 'continue not visible');
      const ctext = (await page.textContent('#continueBtn')).replace(/\s+/g, ' ').trim();
      await shot(page, bname, 'desktop-migrated-start');
      await page.click('#continueBtn');
      const seen = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        const st = await ev(page, () => ({ story: document.getElementById('storyScreen').classList.contains('show'), started: __SUN.state.started }));
        if (st.started) break;
        if (st.story) {
          await page.waitForFunction(() => document.getElementById('storyText').classList.contains('shown'));
          const txt = await page.textContent('#storyText');
          if (!seen.includes(txt)) seen.push(txt);
          await page.click('#storyNextBtn');
        }
        await page.waitForTimeout(300);
      }
      const d = await dbg(page);
      assert(d.levelId === '1-05', 'level ' + d.levelId);
      assert(seen.some(t => t.includes('Тзаркун')), 'prologue not shown');
      assert(seen.length >= 4, 'scenes seen: ' + seen.length);
      const oldNow = await ev(page, () => localStorage.getItem('sun-treasures-save'));
      assert(oldNow === old, 'old key changed/removed: ' + oldNow);
      const sc = await ev(page, () => Game.getSave().seenScenes);
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      await page.click('#continueBtn');
      await waitStarted(page, 15000);
      const d2 = await dbg(page);
      assert(d2.levelId === '1-05', 'second start level ' + d2.levelId);
      await ctx.close();
      return `continue="${ctext}" level=${d.levelId} storyLinesShown=${seen.length} seenScenes=${JSON.stringify(sc)} oldKeyIntact=true; second continue starts 1-05 directly`;
    });

    // ---- 6 ----
    await scenario(bname, '6 transfer export/import/corrupt', async () => {
      const { ctx, page } = await newPage(browser, bname, 's6');
      await startFresh(page, url);
      await page.click('#playBtn');
      await waitStarted(page);
      await playRealMove(page);
      await forceWin(page);
      await page.waitForTimeout(500);
      await page.click('#endHomeBtn');
      await page.waitForSelector('#mapScreen.show');
      await page.click('#mapBackBtn');
      await page.waitForSelector('#startScreen.show');
      await page.click('#transferBtn');
      await page.waitForSelector('#transferScreen.show');
      await shot(page, bname, 'desktop-transfer');
      const code = await page.inputValue('#transferExport');
      assert(code.length > 10, 'code empty');
      const saved = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      await page.click('#transferBackBtn');
      await ev(page, () => localStorage.clear());
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      assert(!(await page.isVisible('#continueBtn')), 'continue visible after clear');
      await page.click('#transferBtn');
      await page.fill('#transferImport', code);
      await page.click('#transferLoadBtn');
      await page.click('#transferLoadBtn');
      await page.waitForTimeout(300);
      const okNote = await page.textContent('#transferLoadNote');
      assert(okNote.includes('загружен'), 'ok note ' + okNote);
      const lv = await ev(page, () => Game.getSave().levels['1-01']);
      assert(lv && lv.calm, 'progress not back ' + JSON.stringify(lv));
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      assert(await page.isVisible('#continueBtn'), 'continue after import+reload');
      const storeAfterImport = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      await page.click('#transferBtn');
      const bad = code.slice(0, Math.floor(code.length / 2)) + '!!' + code.slice(Math.floor(code.length / 2) + 3);
      await page.fill('#transferImport', bad);
      await page.click('#transferLoadBtn');
      await page.waitForTimeout(300);
      const errNote = await page.textContent('#transferLoadNote');
      const errCls = await page.getAttribute('#transferLoadNote', 'class');
      assert(/error/.test(errCls) && errNote.length > 3, `err note "${errNote}" cls ${errCls}`);
      assert(await ev(page, () => localStorage.getItem('sun-keeper-save')) === storeAfterImport, 'save changed by bad import');
      await shot(page, bname, 'desktop-transfer-error');
      await page.fill('#transferImport', 'мусор');
      await page.click('#transferLoadBtn');
      await page.waitForTimeout(200);
      const errNote2 = await page.textContent('#transferLoadNote');
      assert(await ev(page, () => localStorage.getItem('sun-keeper-save')) === storeAfterImport, 'save changed by garbage');
      await ctx.close();
      return `codeLen=${code.length} storedAfterImportEqualsOriginal=${saved === storeAfterImport} okNote="${okNote}" errNote="${errNote}" garbageNote="${errNote2}"`;
    });


    // ---- 8 (a) import with failing setItem ----
    await scenario(bname, '8a import with failing setItem: message, session unchanged', async () => {
      const { ctx, page } = await newPage(browser, bname, 's8a');
      await startFresh(page, url);
      await page.click('#playBtn');
      await waitStarted(page);
      await playRealMove(page);
      await forceWin(page);
      await page.waitForTimeout(400);
      await page.click('#endHomeBtn');
      await page.waitForSelector('#mapScreen.show');
      await page.click('#mapBackBtn');
      await page.waitForSelector('#startScreen.show');
      const code = await ev(page, () => {
        const s = JSON.parse(JSON.stringify(Game.getSave()));
        s.levels['1-02'] = { calm: { score: 777, stars: 1 } };
        return Progress.exportCode(s);
      });
      await page.click('#transferBtn');
      await page.fill('#transferImport', code);
      await ev(page, () => { window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('quota'); }; });
      await page.click('#transferLoadBtn');
      await page.click('#transferLoadBtn');
      await page.waitForTimeout(300);
      const note = await page.textContent('#transferLoadNote');
      const cls = await page.getAttribute('#transferLoadNote', 'class');
      await shot(page, bname, 'desktop-transfer-write-fail');
      assert(/error/.test(cls) && note.includes('Прежний прогресс не изменён'), `note "${note}" cls ${cls}`);
      const sess = await ev(page, () => ({ has2: !!Game.getSave().levels['1-02'], has1: !!Game.getSave().levels['1-01'] }));
      assert(!sess.has2 && sess.has1, 'session save changed: ' + JSON.stringify(sess));
      await ev(page, () => { Storage.prototype.setItem = window.__origSet; });
      // the next write must not persist the imported save
      await page.click('#transferBackBtn');
      await page.click('#startScreen [data-difficulty-btn="normal"]');
      const afterWrite = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      assert(!afterWrite.includes('"1-02"') && afterWrite.includes('"1-01"'), 'later write persisted import: ' + afterWrite.slice(0, 120));
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      const lv = await ev(page, () => ({ has2: !!Game.getSave().levels['1-02'], has1: !!Game.getSave().levels['1-01'] }));
      assert(!lv.has2 && lv.has1, 'after reload ' + JSON.stringify(lv));
      await ctx.close();
      return `note="${note}" sessionUnchanged=true; after next write and reload: old progress only (1-01)`;
    });

    // ---- 8 (b) import needs confirming second click ----
    await scenario(bname, '8b import requires confirming second click (+backups)', async () => {
      const { ctx, page } = await newPage(browser, bname, 's8b');
      await startFresh(page, url);
      await page.click('#playBtn');
      await waitStarted(page);
      await playRealMove(page);
      await forceWin(page);
      await page.waitForTimeout(400);
      await page.click('#endHomeBtn');
      await page.waitForSelector('#mapScreen.show');
      await page.click('#mapBackBtn');
      await page.waitForSelector('#startScreen.show');
      const mk = n => ev(page, n => {
        const s = JSON.parse(JSON.stringify(Game.getSave()));
        s.levels['1-0' + n] = { calm: { score: 100 * n, stars: 1 } };
        return Progress.exportCode(s);
      }, n);
      const code2 = await mk(2), code3 = await mk(3);
      const orig = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      await page.click('#transferBtn');
      await page.waitForSelector('#transferScreen.show');
      await page.waitForTimeout(700);
      const warn = (await page.locator('.transfer-warn').textContent()).trim();
      assert(warn === 'Текущий прогресс будет заменён', 'warn ' + warn);
      assert(await page.locator('.transfer-warn').isVisible(), 'warn hidden');
      await page.fill('#transferImport', code2);
      assert((await page.textContent('#transferLoadBtn')).trim() === 'Загрузить', 'label initial');
      await page.click('#transferLoadBtn');
      const lab1 = (await page.textContent('#transferLoadBtn')).trim();
      assert(lab1 === 'Да, заменить прогресс', 'label after first click: ' + lab1);
      await shot(page, bname, 'desktop-transfer-confirm');
      assert(await ev(page, () => localStorage.getItem('sun-keeper-save')) === orig, 'storage changed after 1st click');
      assert(await ev(page, () => !Game.getSave().levels['1-02']), 'session changed after 1st click');
      await page.waitForTimeout(6600);
      const lab2 = (await page.textContent('#transferLoadBtn')).trim();
      assert(lab2 === 'Загрузить', 'label after timeout: ' + lab2);
      await page.click('#transferLoadBtn');
      assert((await page.textContent('#transferLoadBtn')).trim() === 'Да, заменить прогресс', 'single click again only asks');
      assert(await ev(page, () => !Game.getSave().levels['1-02']), 'imported by single click');
      await page.fill('#transferImport', code2 + ' ');
      assert((await page.textContent('#transferLoadBtn')).trim() === 'Загрузить', 'edit resets');
      await page.click('#transferLoadBtn');
      await page.click('#transferLoadBtn');
      await page.waitForTimeout(300);
      const note = await page.textContent('#transferLoadNote');
      assert(note.includes('загружен'), 'note ' + note);
      assert(await ev(page, () => !!Game.getSave().levels['1-02']), 'second click did not import');
      const b1 = await ev(page, () => localStorage.getItem('sun-keeper-save-backup'));
      assert(b1 === orig, 'backup is previous save');
      await page.fill('#transferImport', code3);
      await page.click('#transferLoadBtn');
      await page.click('#transferLoadBtn');
      await page.waitForTimeout(300);
      const prev = await ev(page, () => localStorage.getItem('sun-keeper-save-backup-prev'));
      const b2 = await ev(page, () => localStorage.getItem('sun-keeper-save-backup'));
      assert(prev === orig, 'backup-prev holds the older backup');
      assert(b2 && b2 !== orig && b2.includes('"1-02"'), 'backup holds the save before 2nd import');
      await ctx.close();
      return `warn="${warn}" labels: "${lab1}" -> (6.6s) "${lab2}"; two-click import ok; backup + backup-prev kept`;
    });

    // ---- 8 (c) 1-20 passed + «Ещё раз» -> later 2-01 plays 1-outro then 2-intro ----
    const seedSave = async (page, upTo, seen) => {
      await ev(page, ({ upTo, seen }) => {
        const s = Progress.empty();
        for (let i = 1; i <= upTo; i++) s.levels['1-' + String(i).padStart(2, '0')] = { calm: { score: 1000, stars: 1 } };
        s.seenScenes = seen;
        localStorage.setItem('sun-keeper-save', JSON.stringify(s));
      }, { upTo, seen });
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      await page.waitForFunction(() => window.__SUN && window.__SUN.state.grid[7] && window.__SUN.state.grid[7][7]);
    };
    const readScenes = async (page, expectedStart) => {
      const seen = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        const st = await ev(page, () => ({ story: document.getElementById('storyScreen').classList.contains('show'), started: __SUN.state.started, id: __SUN.state.levelId }));
        if (st.started && st.id === expectedStart) break;
        if (st.story) {
          await page.waitForFunction(() => document.getElementById('storyText').classList.contains('shown'));
          const total = Number((await page.textContent('#storyStep')).split('из')[1]);
          for (let i = 0; i < total; i++) {
            await page.waitForFunction(() => document.getElementById('storyText').classList.contains('shown'));
            const txt = await page.textContent('#storyText');
            if (i === 0) seen.push(txt);
            await page.click('#storyNextBtn');
            await page.waitForTimeout(350);
          }
        }
        await page.waitForTimeout(250);
      }
      return seen;
    };
    await scenario(bname, '8c 1-20 passed, «Ещё раз», later 2-01 plays 1-outro then 2-intro', async () => {
      const { ctx, page } = await newPage(browser, bname, 's8c');
      await startFresh(page, url);
      await seedSave(page, 19, ['prologue', '1-intro']);
      await page.click('#continueBtn');
      await waitStarted(page);
      assert((await dbg(page)).levelId === '1-20', 'continue level ' + (await dbg(page)).levelId);
      await playRealMove(page);
      await forceWin(page);
      await page.waitForTimeout(500);
      await page.click('#retryBtn');
      await waitStarted(page);
      assert((await ev(page, () => Game.getSave().seenScenes)).indexOf('1-outro') < 0, 'outro already seen?');
      await ev(page, () => { window.__SUN.start('2-01'); });
      const seen = await readScenes(page, '2-01');
      const lines = await ev(page, () => ({ o: Campaign.lands()[0].scenes.outro[0], i: Campaign.lands()[1].scenes.intro[0] }));
      assert(seen.length === 2, 'scenes count ' + seen.length + ' ' + JSON.stringify(seen));
      assert(seen[0] === lines.o, 'first scene not 1-outro: ' + seen[0]);
      assert(seen[1] === lines.i, 'second scene not 2-intro: ' + seen[1]);
      const sc = await ev(page, () => Game.getSave().seenScenes);
      assert(sc.indexOf('1-outro') >= 0 && sc.indexOf('2-intro') >= 0, 'seenScenes ' + JSON.stringify(sc));
      await ctx.close();
      return `scene1="${seen[0].slice(0, 40)}" scene2="${seen[1].slice(0, 40)}" seenScenes=${JSON.stringify(sc)}`;
    });

    // ---- 8 (e) replayed last level, outro seen: Дальше -> 2-01 ----
    await scenario(bname, '8e replayed 1-20 with outro seen: Дальше goes to 2-01', async () => {
      const { ctx, page } = await newPage(browser, bname, 's8e');
      await startFresh(page, url);
      await seedSave(page, 20, ['prologue', '1-intro', '1-outro', '2-intro']);
      await ev(page, () => { window.__SUN.start('1-20'); });
      await waitStarted(page);
      assert((await dbg(page)).levelId === '1-20', 'level');
      await playRealMove(page);
      await forceWin(page);
      await page.waitForTimeout(500);
      await page.click('#nextBtn');
      await waitStarted(page);
      const d = await dbg(page);
      assert(d.levelId === '2-01', 'next level ' + d.levelId);
      await ctx.close();
      return 'Дальше -> ' + d.levelId;
    });

    // ---- 8 (d) start screen with progress ----
    await scenario(bname, '8d start screen with progress: gold Продолжить + Начать с начала', async () => {
      const { ctx, page } = await newPage(browser, bname, 's8d');
      await startFresh(page, url);
      const fresh = await ev(page, () => {
        const p = document.getElementById('playBtn'), c = document.getElementById('continueBtn');
        return { play: p.textContent.trim(), playCls: p.className, contVisible: getComputedStyle(c).display !== 'none' };
      });
      assert(fresh.play === 'Играть' && /gold-btn/.test(fresh.playCls) && !fresh.contVisible, 'fresh: ' + JSON.stringify(fresh));
      await seedSave(page, 3, ['prologue', '1-intro']);
      const info = await ev(page, () => {
        const p = document.getElementById('playBtn'), c = document.getElementById('continueBtn');
        const rp = p.getBoundingClientRect(), rc = c.getBoundingClientRect();
        return { cont: c.textContent.replace(/\s+/g, ' ').trim(), contCls: c.className, contVisible: getComputedStyle(c).display !== 'none', contTop: rc.top, contH: rc.height, contW: rc.width,
          play: p.textContent.trim(), playCls: p.className, playTop: rp.top, playH: rp.height, playW: rp.width, playFont: parseFloat(getComputedStyle(p).fontSize), contFont: parseFloat(getComputedStyle(c).fontSize) };
      });
      await shot(page, bname, 'desktop-8d-start-progress');
      assert(info.contVisible && /gold-btn/.test(info.contCls), 'continue not gold: ' + JSON.stringify(info));
      assert(info.cont.startsWith('Продолжить'), 'continue text ' + info.cont);
      assert(info.play === 'Начать с начала' && /stone-btn/.test(info.playCls) && !/gold-btn/.test(info.playCls), 'play: ' + JSON.stringify(info));
      assert(info.contTop < info.playTop, 'continue is not first');
      assert(info.contH >= 56 && info.playH >= 56 && info.contFont >= 20 && info.playFont >= 20, 'size ' + JSON.stringify(info));
      assert(info.contH >= info.playH, 'continue not biggest');
      const saveBefore = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      await page.click('#playBtn');
      await waitStarted(page);
      assert((await dbg(page)).levelId === '1-01', 'restart level');
      assert(await ev(page, () => localStorage.getItem('sun-keeper-save')) === saveBefore, 'progress erased');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      await page.waitForTimeout(800);
      const mob = await ev(page, () => ({ sw: document.scrollingElement.scrollWidth, iw: innerWidth,
        c: document.getElementById('continueBtn').getBoundingClientRect().height, p: document.getElementById('playBtn').getBoundingClientRect().height }));
      await shot(page, bname, 'mobile-8d-start-progress');
      assert(mob.sw <= mob.iw && mob.c >= 56 && mob.p >= 56, 'mobile ' + JSON.stringify(mob));
      await ctx.close();
      return `continue="${info.cont}" ${Math.round(info.contW)}x${Math.round(info.contH)} first; restart="${info.play}" ${Math.round(info.playW)}x${Math.round(info.playH)}; mobile ${JSON.stringify(mob)}`;
    });

    // ---- 7 layout ----
    for (const vp of [
      { width: 1366, height: 768, n: 'desktop' },
      { width: 1366, height: 650, n: 'desktop-short' },
      { width: 390, height: 844, n: 'mobile' },
      { width: 360, height: 740, n: 'mobile-small' }
    ]) {
      await scenario(bname, `7 layout ${vp.width}x${vp.height}`, async () => {
        const { ctx, page } = await newPage(browser, bname, 's7' + vp.n, { width: vp.width, height: vp.height });
        const issues = [];
        const log = [];
        const visit = async (screen, filter) => {
          await page.waitForTimeout(500);
          const r = await ev(page, () => {
            const sw = document.scrollingElement.scrollWidth, iw = innerWidth;
            const small = [];
            document.querySelectorAll('button').forEach(b => {
              const cs = getComputedStyle(b);
              const rc = b.getBoundingClientRect();
              if (cs.display === 'none' || cs.visibility === 'hidden' || rc.width === 0 || rc.height === 0) return;
              const ov = b.closest('.overlay');
              if (ov && !ov.classList.contains('show')) return;
              if (rc.height < 56) small.push({ id: b.id, cls: b.className, text: b.textContent.trim().slice(0, 20), h: Math.round(rc.height), w: Math.round(rc.width), inOverlay: ov ? ov.id : null });
            });
            const wide = [];
            if (sw > iw) document.querySelectorAll('body *').forEach(e => {
              const rc = e.getBoundingClientRect();
              if (rc.width > 0 && rc.right > iw + 0.5) wide.push((e.id ? '#' + e.id : '') + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(' ').join('.') + ' ' + e.tagName + ' right=' + Math.round(rc.right) + ' w=' + Math.round(rc.width));
            });
            return { sw, iw, small, wide: wide.slice(0, 8) };
          });
          const small = r.small.filter(filter);
          log.push(`${screen}: scrollW=${r.sw}/${r.iw}${r.sw > r.iw ? ' OVERFLOW ' + JSON.stringify(r.wide) : ''}; buttons<56px: ${small.length ? JSON.stringify(small.map(s => `${s.id || s.cls}:"${s.text}" ${s.w}x${s.h}`)) : 'none'}`);
          if (r.sw > r.iw) issues.push(screen + ' horizontal overflow ' + r.sw + '/' + r.iw + ' ' + JSON.stringify(r.wide));
          if (small.length) issues.push(screen + ' buttons<56px: ' + small.map(s => `${s.id || s.cls}:"${s.text}" ${s.w}x${s.h}`).join('; '));
        };
        await startFresh(page, url);
        await shot(page, bname, vp.n + '-L1-start');
        await visit('start', b => b.inOverlay === 'startScreen');
        await page.click('#mapBtn');
        await page.waitForSelector('#mapScreen.show');
        await shot(page, bname, vp.n + '-L2-map');
        await visit('map', b => b.inOverlay === 'mapScreen');
        await page.click('#mapBackBtn');
        await page.waitForSelector('#startScreen.show');
        await page.click('#playBtn');
        await page.waitForSelector('#storyScreen.show');
        await page.waitForFunction(() => document.getElementById('storyText').classList.contains('shown'));
        await page.waitForTimeout(400);
        await shot(page, bname, vp.n + '-L3-story');
        await visit('story', b => b.inOverlay === 'storyScreen');
        await page.click('#storySkipBtn');
        await waitStarted(page);
        await page.waitForTimeout(500);
        await shot(page, bname, vp.n + '-L4-level');
        await visit('level (game)', b => !b.inOverlay);
        const desktop = vp.width >= 901;
        const gm = await ev(page, () => {
          const se = document.scrollingElement;
          const segs = document.querySelectorAll('#sunStone .sun-seg').length;
          const ring = document.querySelector('#sunStone svg.sun-stone-ring');
          const rs = document.getElementById('sunStone').getBoundingClientRect();
          return { sh: se.scrollHeight, ih: innerHeight, segs, ring: !!ring, stoneShown: rs.width > 0 && rs.height > 0, plaque: !!document.getElementById('timePlaque'), bar: !!document.getElementById('timeBar') };
        });
        if (vp.height === 650) {
          log.push(`game scrollH=${gm.sh}/${gm.ih}`);
          if (gm.sh > gm.ih + 1) issues.push(`game screen scrolls vertically ${gm.sh}/${gm.ih}`);
        }
        if (desktop) {
          log.push(`sun-seg=${gm.segs}`);
          if (gm.segs !== 20 || !gm.ring || !gm.stoneShown) issues.push(`Sun Stone: segments ${gm.segs}, ring ${gm.ring}, visible ${gm.stoneShown}`);
        }
        if (!gm.plaque || !gm.bar) issues.push('time plaque/bar missing');
        // Большой счёт «1 234 567» целиком помещается на табличке
        const big = await ev(page, () => {
          window.__SUN.setScore(1234567);
          const el = document.getElementById('scoreValue');
          const rc = el.getBoundingClientRect();
          return { text: el.textContent, want: (1234567).toLocaleString('ru-RU'), sw: el.scrollWidth, cw: el.clientWidth, len: el.dataset.len, right: Math.round(rc.right), iw: innerWidth };
        });
        await page.waitForTimeout(300);
        log.push(`bigScore "${big.text}" scrollW=${big.sw}/${big.cw} len=${big.len}`);
        if (big.text !== big.want) issues.push(`big score text "${big.text}" != "${big.want}"`);
        if (big.sw > big.cw) issues.push(`big score clipped ${big.sw}/${big.cw}`);
        if (big.right > big.iw) issues.push(`big score outside viewport right=${big.right}/${big.iw}`);
        await ev(page, () => window.__SUN.setScore(0));
        await playRealMove(page);
        await forceWin(page);
        await page.waitForTimeout(2500);
        await shot(page, bname, vp.n + '-L5-end');
        await visit('end', b => b.inOverlay === 'endScreen');
        await page.click('#endHomeBtn');
        await page.waitForSelector('#mapScreen.show');
        await page.waitForTimeout(500);
        await shot(page, bname, vp.n + '-L6-map-progress');
        await visit('map after progress', b => b.inOverlay === 'mapScreen');
        if (desktop) {
          await ev(page, () => { window.__SUN.start('1-02'); });
          await waitStarted(page);
          await page.waitForTimeout(300);
          const seg0 = await ev(page, () => { const e = document.querySelectorAll('#sunStone .sun-seg')[0]; return e ? String(e.getAttribute('class')) : null; });
          log.push(`sector0 after win: ${seg0}`);
          if (!seg0 || /\bempty\b/.test(seg0)) issues.push('sector 0 empty after win: ' + seg0);
        }
        await ctx.close();
        if (issues.length) throw new Error(issues.join(' | ') + ' || ' + log.join(' || '));
        return log.join(' || ');
      });
    }

    // ---- 9 braziers layout ----
    for (const vp of [
      { width: 1366, height: 768, n: 'desktop' },
      { width: 1366, height: 721, n: 'desktop-721' },
      { width: 1366, height: 650, n: 'desktop-short' },
      { width: 1366, height: 640, n: 'desktop-640' },
      { width: 1366, height: 600, n: 'desktop-600' },
      { width: 1024, height: 768, n: 'desktop-1024' },
      { width: 390, height: 844, n: 'mobile' },
      { width: 360, height: 740, n: 'mobile-small' }
    ]) {
      await scenario(bname, `9 braziers ${vp.width}x${vp.height}`, async () => {
        const { ctx, page } = await newPage(browser, bname, 's9' + vp.n, { width: vp.width, height: vp.height }, { fxFull: true });
        await startFresh(page, url);
        await page.click('#playBtn');
        await page.waitForSelector('#storyScreen.show');
        await page.click('#storySkipBtn');
        await waitStarted(page);
        await page.waitForTimeout(600);
        const r = await ev(page, () => {
          const iw = innerWidth, ih = innerHeight;
          const box = e => { const c = e.getBoundingClientRect(); return { l: c.left, t: c.top, r: c.right, b: c.bottom, w: c.width, h: c.height }; };
          const shown = e => { const cs = getComputedStyle(e); const c = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && c.width > 0 && c.height > 0; };
          const name = e => (e.id ? '#' + e.id : '') + '.' + String(e.className).trim().split(/\s+/).join('.');
          const hits = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
          const controls = [...document.querySelectorAll('button, .hud-plaque, .goal-card, .board-frame')].filter(e => !e.closest('.overlay') && shown(e));
          const all = [...document.querySelectorAll('.brazier')];
          const vis = all.filter(shown);
          const bad = [];
          const out = [];
          vis.forEach(br => {
            const below = br.nextElementSibling;
            const fire = br.querySelector('.brazier-fire'), bowl = br.querySelector('img.brazier-bowl');
            const bf = box(fire), bb = box(bowl), bbr = box(br);
            if (bbr.l < 0 || bbr.r > iw || bbr.t < 0 || bbr.b > ih) bad.push(name(br) + ' вне окна ' + JSON.stringify(bbr));
            if (bf.t < 0 || bb.t < 0) bad.push(name(br) + ' пламя/чаша выше окна');
            if (bowl.naturalWidth === 0) bad.push('чаша не загрузилась');
            controls.forEach(c => {
              const bc = box(c);
              if (hits(bf, bc)) bad.push(name(br) + ' .brazier-fire × ' + name(c));
              if (c !== below && !(below && below.contains(c)) && hits(bb, bc)) bad.push(name(br) + ' чаша × ' + name(c));
            });
            out.push(name(br) + ' fire ' + Math.round(bf.t) + '..' + Math.round(bf.b) + ' bowl ' + Math.round(bb.t) + '..' + Math.round(bb.b));
          });
          // подсказка под полем не заезжает на кнопки правой колонки
          const hint = document.getElementById('hintBar');
          const hintHits = [];
          if (hint && shown(hint)) {
            const hb = box(hint);
            document.querySelectorAll('.right-panel button').forEach(btn => { if (shown(btn) && hits(hb, box(btn))) hintHits.push(name(btn)); });
            // и на содержимое левой колонки (круг Солнечного Камня на узком окне)
            document.querySelectorAll('.left-panel > *').forEach(el => { if (!el.classList.contains('brazier') && shown(el) && hits(hb, box(el))) hintHits.push(name(el)); });
            if (hint.scrollHeight > hint.clientHeight + 2) hintHits.push('текст подсказки обрезан');
          }
          const small = [...document.querySelectorAll('button')].filter(b => shown(b) && !b.closest('.overlay') && b.getBoundingClientRect().height < 56).map(b => (b.id || b.className) + ':' + Math.round(b.getBoundingClientRect().height));
          return {
            total: all.length, vis: vis.length, bad, out, small,
            aria: all.map(b => b.getAttribute('aria-hidden')),
            pe: all.map(b => getComputedStyle(b).pointerEvents),
            hintHits, off: document.body.dataset.braziers === 'off', hintNarrow: !!document.body.dataset.hintNarrow,
            light: document.querySelectorAll('.fire-light').length,
            sparks: document.querySelectorAll('canvas.fire-sparks').length,
            sh: document.scrollingElement.scrollHeight, ih, sw: document.scrollingElement.scrollWidth, iw
          };
        });
        await shot(page, bname, vp.n + '-L4-braziers');
        const desktop = vp.width >= 901;
        const off = vp.height <= 600;   // жаровням не хватает места: body[data-braziers="off"]
        const issues = [];
        if (r.total !== 2) issues.push('жаровен в разметке ' + r.total);
        if (r.aria.some(a => a !== 'true')) issues.push('aria-hidden: ' + JSON.stringify(r.aria));
        if (r.pe.some(p => p !== 'none')) issues.push('pointer-events: ' + JSON.stringify(r.pe));
        if (r.light !== 1 || r.sparks !== 1) issues.push(`fire-light=${r.light} fire-sparks=${r.sparks}`);
        if (desktop && !off && r.vis !== 2) issues.push('на десктопе видимых жаровен ' + r.vis);
        if (desktop && !off && r.off) issues.push('data-braziers=off, а место есть');
        if (desktop && off && !r.off) issues.push('низкое окно: нет body[data-braziers="off"]');
        if (off && r.vis !== 0) issues.push('низкое окно: жаровни видны ' + r.vis);
        if (!desktop && r.vis !== 0) issues.push('на телефоне жаровни видны: ' + r.vis);
        if (r.bad.length) issues.push('перекрытие: ' + r.bad.join('; '));
        if (r.small.length) issues.push('кнопки <56px: ' + r.small.join(', '));
        if (desktop && r.hintHits.length) issues.push('подсказка заходит на кнопки: ' + r.hintHits.join(', '));
        if (r.sw > r.iw) issues.push(`горизонтальная прокрутка ${r.sw}/${r.iw}`);
        if (desktop && r.sh > r.ih + 1) issues.push(`вертикальная прокрутка ${r.sh}/${r.ih}`);
        await ctx.close();
        if (issues.length) throw new Error(issues.join(' | '));
        return `visible=${r.vis} off=${r.off} hintNarrow=${r.hintNarrow} ${r.out.join(' | ')} fire-light=${r.light} fire-sparks=${r.sparks} scrollH=${r.sh}/${r.ih}`;
      });
    }

    // ---- 10 fire reacts ----
    await scenario(bname, '10 fire reacts: pause on overlay, flare, sparks, no stuck flare', async () => {
      const { ctx, page } = await newPage(browser, bname, 's10', { width: 1366, height: 768 }, { fxFull: true });
      await startFresh(page, url);
      assert(await ev(page, () => !!window.__FIRE), '__FIRE missing (need ?debug)');
      // Стартовый экран — оверлей: цикл стоит
      await page.waitForTimeout(500);
      const f0 = await ev(page, () => __FIRE.frames);
      await page.waitForTimeout(1000);
      const f1 = await ev(page, () => __FIRE.frames);
      assert(f0 === f1, `на стартовом экране кадры идут: ${f0} -> ${f1}`);
      assert(await ev(page, () => !__FIRE.state().running), 'running на стартовом экране');
      await page.click('#playBtn');
      await page.waitForSelector('#storyScreen.show');
      await page.click('#storySkipBtn');
      await waitStarted(page);
      await page.waitForTimeout(500);
      const g0 = await ev(page, () => __FIRE.frames);
      await page.waitForTimeout(1000);
      const g1 = await ev(page, () => __FIRE.frames);
      assert(g1 > g0, `на уровне кадры не идут: ${g0} -> ${g1}`);
      const st0 = await ev(page, () => __FIRE.state());
      assert(st0.running && !st0.low && !st0.reduced, 'состояние на уровне: ' + JSON.stringify(st0));
      assert(await ev(page, () => !document.querySelector('.brazier[data-flare]')), 'data-flare до события');
      // Каскад из 5: вспышка видна в течение 300 мс, свет не выше 0.55, через 2.2 с её нет
      const fl = await ev(page, () => new Promise(res => {
        const t0 = performance.now();
        let appeared = -1, maxLight = 0, maxScale = 1, sparksMax = 0;
        const light = document.querySelector('.fire-light');
        const fire = document.querySelector('.brazier-fire');
        window.dispatchEvent(new CustomEvent('sun:match', { detail: { chain: 5, mult: 6 } }));
        const iv = setInterval(() => {
          const t = performance.now() - t0;
          if (appeared < 0 && document.querySelector('.brazier[data-flare]')) appeared = Math.round(t);
          maxLight = Math.max(maxLight, parseFloat(getComputedStyle(light).opacity));
          maxScale = Math.max(maxScale, parseFloat(fire.style.getPropertyValue('--flare-scale')) || 1);
          sparksMax = Math.max(sparksMax, __FIRE.state().sparks);
          if (t >= 2200) { clearInterval(iv); res({ appeared, maxLight, maxScale, sparksMax, stuck: !!document.querySelector('.brazier[data-flare]'), end: __FIRE.state() }); }
        }, 40);
      }));
      assert(fl.appeared >= 0 && fl.appeared <= 300, 'data-flare не появился за 300 мс: ' + fl.appeared);
      assert(!fl.stuck, 'data-flare залип через 2.2 с');
      assert(fl.maxLight <= 0.56, 'свет ярче 0.55: ' + fl.maxLight);
      assert(fl.maxScale <= 1.225, 'пламя выросло больше 22%: ' + fl.maxScale);
      assert(fl.sparksMax > 0, 'искр не было');
      assert(fl.end.flare < 0.01, 'огибающая не дошла до 0: ' + fl.end.flare);
      // Пауза: вспышка и искры в полёте, открываем паузу — огонь успокаивается (искр нет, data-flare снят)
      await ev(page, () => { __FIRE.flare(1); });
      await page.waitForTimeout(150);
      const live = await ev(page, () => ({ sparks: __FIRE.state().sparks, flare: !!document.querySelector('.brazier[data-flare]') }));
      assert(live.flare, 'перед паузой вспышки нет: ' + JSON.stringify(live));
      await page.click('#menuBtn');
      await page.waitForSelector('#pauseScreen.show');
      // Огонь сходит на нет за 0,32 с от первого кадра после открытия окна; кадр под нагрузкой приходит позже
      const pauseT0 = Date.now();
      await page.waitForFunction(() => !__FIRE.state().running, null, { timeout: 1000 }).catch(() => {});
      console.log(`[${bname}] fire settled ${Date.now() - pauseT0}ms after pause`);
      const paused = await ev(page, () => ({ st: __FIRE.state(), flare: !!document.querySelector('.brazier[data-flare]') }));
      assert(paused.st.sparks === 0 && !paused.flare && !paused.st.running, 'на паузе огонь не успокоился: ' + JSON.stringify(paused));
      await page.click('#resumeBtn');
      await page.waitForFunction(() => !document.querySelector('.overlay.show'));
      await page.waitForTimeout(300);
      // Вспышка на пике: верх рамки спрайта (в нём прозрачные поля) может чуть выйти за окно, видимое пламя нет — это смотрят глазами по скриншоту
      const top = await ev(page, () => new Promise(res => {
        __FIRE.flare(1);
        setTimeout(() => {
          const tops = [...document.querySelectorAll('.brazier-fire')].map(e => Math.round(e.getBoundingClientRect().top));
          res(tops);
        }, 450);
      }));
      assert(top.every(t => t > -40), 'пламя при вспышке далеко за верхом окна: ' + JSON.stringify(top));
      await shot(page, bname, 'desktop-L4-flare-peak');
      await page.waitForTimeout(1700);
      assert(await ev(page, () => !document.querySelector('.brazier[data-flare]')), 'data-flare залип после __FIRE.flare(1)');
      await ctx.close();
      return `startFrames ${f0}->${f1}; levelFrames ${g0}->${g1}; flare appeared ${fl.appeared}ms maxLight=${fl.maxLight.toFixed(2)} maxScale=${fl.maxScale.toFixed(2)} sparksMax=${fl.sparksMax}; no stuck flare; flareTop=${JSON.stringify(top)}`;
    });

    // ---- 11 reduced motion ----
    await scenario(bname, '11 prefers-reduced-motion: static fire, no sparks', async () => {
      const { ctx, page } = await newPage(browser, bname, 's11', { width: 1366, height: 768 }, { reducedMotion: true, fxFull: true });
      await startFresh(page, url);
      await page.click('#playBtn');
      await page.waitForSelector('#storyScreen.show');
      await page.click('#storySkipBtn');
      await waitStarted(page);
      await page.waitForTimeout(500);
      await ev(page, () => window.dispatchEvent(new CustomEvent('sun:match', { detail: { chain: 5, mult: 6 } })));
      const f0 = await ev(page, () => __FIRE.frames);
      await page.waitForTimeout(800);
      const r = await ev(page, () => {
        const cv = document.querySelector('canvas.fire-sparks');
        const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let painted = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) painted++;
        return { st: __FIRE.state(), frames: __FIRE.frames, flare: !!document.querySelector('.brazier[data-flare]'), painted, mq: matchMedia('(prefers-reduced-motion: reduce)').matches };
      });
      assert(r.mq, 'браузер не применил reducedMotion');
      assert(r.st.reduced === true && r.st.running === false, 'цикл идёт: ' + JSON.stringify(r.st));
      assert(r.st.sparks === 0 && r.painted === 0, `искры есть: sparks=${r.st.sparks} painted=${r.painted}`);
      assert(!r.flare, 'data-flare при reduced-motion');
      assert(r.frames === f0, `кадры идут: ${f0} -> ${r.frames}`);
      // Живой фон стоит: режим still, холст светлячков пуст, у струй нет анимации
      await page.waitForFunction(() => document.body.classList.contains('has-backdrop'));
      const bd = await ev(page, () => {
        const cv = document.querySelector('canvas.bd-flies');
        const px = cv.width && cv.height ? cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data : [];
        let painted = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) painted++;
        return { mode: document.body.dataset.bd, painted, flies: __BD.flies().length, anim: getComputedStyle(document.querySelector('.theme-bg.on .bd-water')).animationName };
      });
      assert(bd.mode === 'still', 'data-bd при reduced-motion: ' + bd.mode);
      assert(bd.painted === 0 && bd.flies === 0, `светлячки при reduced-motion: painted=${bd.painted} flies=${bd.flies}`);
      assert(bd.anim === 'none', 'струи воды движутся: ' + bd.anim);
      await shot(page, bname, 'desktop-L4-reduced');
      await ctx.close();
      return `reduced=true running=false sparks=0 canvasPainted=0 frames ${f0}->${r.frames}; backdrop data-bd=${bd.mode} fliesPainted=${bd.painted} water=${bd.anim}`;
    });

    // ---- 12 backdrop ----
    // Открыта ли точка фона: идём по elementsFromPoint сверху вниз. Слои фона
    // pointer-events: none, а .game-shell занимает всё окно и ловит точку,
    // поэтому прозрачные обёртки пропускаем: точку закрывает только то, что
    // рисует (фон, рамка, картинка, кнопка, текст). Жаровни pointer-events: none —
    // их чаши проверяем по прямоугольнику.
    const bdOpen = (page, pts) => ev(page, (pts) => {
      const jungle = document.querySelector('.jungle');
      const clear = c => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
      const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '');
      const paints = e => {
        if (/^(img|canvas|svg|button|video|input)$/i.test(e.tagName) || e instanceof SVGElement) return true;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
        if (!clear(cs.backgroundColor) || cs.backgroundImage !== 'none') return true;
        if (['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && !clear(cs['border' + s + 'Color']))) return true;
        return [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      };
      const bowls = [...document.querySelectorAll('.brazier-bowl')].map(b => b.getBoundingClientRect()).filter(r => r.width > 0);
      return pts.map(([x, y]) => {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'outside';
        if (bowls.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return 'brazier-bowl';
        for (const e of document.elementsFromPoint(x, y)) {
          if (jungle.contains(e)) return '';
          if (paints(e)) return name(e);
        }
        return 'nothing';
      });
    }, pts);
    // Светлячки вне занятых мест (по __BD.busy() и по свежим прямоугольникам) с отступом 10 px
    // Список занятых мест — тот же, что у игры (__BD.busySelector), без копии здесь
    const fliesCheck = (page) => ev(page, () => {
      const sel = __BD.busySelector;
      const pad = 10;
      const fresh = [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
      const rects = __BD.busy().concat(fresh.map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })));
      const flies = __BD.flies();
      const bad = flies.filter(p => rects.some(r => p.x > r.left - pad && p.x < r.right + pad && p.y > r.top - pad && p.y < r.bottom + pad));
      return { n: flies.length, bad: bad.map(p => Math.round(p.x) + ',' + Math.round(p.y)) };
    });
    const VPS12 = [
      { width: 1366, height: 768, n: 'desktop', moonMin: 0.6, wfMin: 0.25, next: [1920, 1080] },
      { width: 1366, height: 650, n: 'desktop-short', moonMin: 0.6, next: [1024, 768] },
      { width: 1920, height: 1080, n: 'desktop-1920', moonMin: 0.6, wfMin: 0.25, next: [1366, 650] },
      { width: 1024, height: 768, n: 'desktop-1024', next: [1366, 768] },
      { width: 390, height: 844, n: 'mobile', phone: true, next: [1366, 768] }
    ];
    for (const vp of VPS12) {
      await scenario(bname, `12 backdrop ${vp.width}x${vp.height}`, async () => {
        const { ctx, page } = await newPage(browser, bname, 's12' + vp.n, { width: vp.width, height: vp.height }, { fxFull: true });
        await startFresh(page, url);
        assert(await ev(page, () => !!window.__BD), '__BD missing (need ?debug)');
        await page.waitForFunction(() => document.body.classList.contains('has-backdrop') && document.querySelector('.theme-bg.on .bd-stage'), null, { timeout: 15000 });
        const notes = [];
        // Доступность: слои фона скрыты от чтения с экрана и не ловят мышь
        const a11y = await ev(page, () => ['.bd-stage', '.bd-sky', '.bd-flies'].map(s => {
          const e = document.querySelector(s);
          return e ? { s, aria: e.getAttribute('aria-hidden'), pe: getComputedStyle(e).pointerEvents } : { s, missing: true };
        }));
        a11y.forEach(a => assert(!a.missing && a.aria === 'true' && a.pe === 'none', 'слой фона: ' + JSON.stringify(a)));
        // Стартовый экран — оверлей: фон на паузе (на телефоне стоит всегда)
        await page.waitForTimeout(300);
        const s0 = await ev(page, () => ({ mode: document.body.dataset.bd, f: __BD.frames, ps: getComputedStyle(document.querySelector('.theme-bg.on .bd-water')).animationPlayState, an: getComputedStyle(document.querySelector('.theme-bg.on .bd-water')).animationName }));
        await page.waitForTimeout(1000);
        const s1 = await ev(page, () => __BD.frames);
        assert(s0.mode === (vp.phone ? 'still' : 'paused'), 'режим на стартовом экране: ' + s0.mode);
        assert(s1 === s0.f, `на стартовом экране кадры светлячков идут: ${s0.f} -> ${s1}`);
        if (vp.phone) assert(s0.an === 'none', 'на телефоне струи движутся: ' + s0.an);
        else assert(s0.ps === 'paused', 'на стартовом экране струи не на паузе: ' + s0.ps);
        notes.push(`start ${s0.mode} frames ${s0.f}->${s1}`);
        // Уровень 1-01
        await page.click('#playBtn');
        await waitStarted(page);
        await page.waitForTimeout(2000);
        const g0 = await ev(page, () => ({ mode: document.body.dataset.bd, f: __BD.frames, ps: getComputedStyle(document.querySelector('.theme-bg.on .bd-water')).animationPlayState, an: getComputedStyle(document.querySelector('.theme-bg.on .bd-water')).animationName }));
        await page.waitForTimeout(1000);
        const g1 = await ev(page, () => __BD.frames);
        if (vp.phone) {
          assert(g0.mode === 'still', 'на телефоне режим ' + g0.mode);
          assert(g0.an === 'none', 'на телефоне у струй анимация ' + g0.an);
          assert(g1 === g0.f, `на телефоне кадры светлячков идут: ${g0.f} -> ${g1}`);
        } else {
          assert(g0.mode === 'run', 'на уровне режим ' + g0.mode);
          assert(g0.ps === 'running' && g0.an === 'bdFall', `струи на уровне: ${g0.an} ${g0.ps}`);
          assert(g1 > g0.f, `на уровне кадры светлячков не идут: ${g0.f} -> ${g1}`);
        }
        notes.push(`level ${g0.mode} frames ${g0.f}->${g1}`);
        await shot(page, bname, vp.n + '-L4-backdrop');
        // Луна: 7×7 точек по рамке .bd-moon
        const moonPts = await ev(page, () => {
          const r = document.querySelector('.theme-bg.on .bd-moon').getBoundingClientRect();
          const p = [];
          for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) p.push([r.left + r.width * (i + 0.5) / 7, r.top + r.height * (j + 0.5) / 7]);
          return p;
        });
        const moonHit = await bdOpen(page, moonPts);
        const moonFrac = moonHit.filter(h => h === '').length / moonHit.length;
        const moonBy = [...new Set(moonHit.filter(Boolean))].join(',');
        notes.push(`moon open ${(moonFrac * 100).toFixed(0)}%${moonBy ? ' (closed by ' + moonBy + ')' : ''}`);
        if (vp.moonMin) assert(moonFrac >= vp.moonMin, `луна открыта на ${(moonFrac * 100).toFixed(0)}% < ${vp.moonMin * 100}%: ${moonBy}`);
        // Водопад: 20 точек по средней вертикали .bd-wf
        const wfPts = await ev(page, () => {
          const r = document.querySelector('.theme-bg.on .bd-wf').getBoundingClientRect();
          const p = [];
          for (let i = 0; i < 20; i++) p.push([r.left + r.width / 2, r.top + r.height * (i + 0.5) / 20]);
          return p;
        });
        const wfHit = await bdOpen(page, wfPts);
        const wfFrac = wfHit.filter(h => h === '').length / wfHit.length;
        const wfBy = [...new Set(wfHit.filter(Boolean))].join(',');
        notes.push(`waterfall open ${(wfFrac * 100).toFixed(0)}% at x=${Math.round(wfPts[0][0])}${wfBy ? ' (closed by ' + wfBy + ')' : ''}`);
        if (vp.wfMin) assert(wfFrac >= vp.wfMin, `водопад открыт на ${(wfFrac * 100).toFixed(0)}% < ${vp.wfMin * 100}%: ${wfBy}`);
        // Светлячки не на табличках, кнопках, рамке, жаровнях, Камне и подсказке
        const fc = await fliesCheck(page);
        assert(!fc.bad.length, 'светлячки на занятых местах: ' + fc.bad.join(' '));
        if (vp.phone) assert(fc.n === 0, 'на телефоне светлячки летают: ' + fc.n);
        else assert(fc.n > 0, 'на десктопе нет ни одного светлячка: проверка мест прошла бы вхолостую');
        notes.push(`flies ${fc.n} ok`);
        // То же после смены окна
        await page.setViewportSize({ width: vp.next[0], height: vp.next[1] });
        await page.waitForTimeout(1000);
        const fc2 = await fliesCheck(page);
        const m2 = await ev(page, () => document.body.dataset.bd);
        assert(!fc2.bad.length, `после смены окна на ${vp.next.join('x')} светлячки на занятых местах: ` + fc2.bad.join(' '));
        assert(fc2.n > 0, `после смены окна на ${vp.next.join('x')} нет ни одного светлячка`);
        notes.push(`resize ${vp.next.join('x')}: ${m2}, flies ${fc2.n} ok`);
        await ctx.close();
        return notes.join('; ');
      });
    }

    await scenario(bname, '12 backdrop land switch 2-01 (temple plate, no waterfall), mosaic keeps bg-jaguar', async () => {
      const key = 's12switch';
      const { ctx, page } = await newPage(browser, bname, key, { width: 1366, height: 768 }, { fxFull: true });
      await startFresh(page, url);
      await page.click('#playBtn');
      await waitStarted(page);
      await page.waitForFunction(() => document.body.classList.contains('has-backdrop'));
      // Картинка-награда на карте — прежняя bg-jaguar.webp
      await forceWin(page);
      await page.click('#endHomeBtn');
      await page.waitForSelector('#mapScreen.show');
      await page.waitForTimeout(300);
      const mosaic = await ev(page, () => [...document.querySelectorAll('.mosaic-cell')].map(c => c.style.backgroundImage).filter(Boolean));
      assert(mosaic.length > 0 && mosaic.every(b => b.includes('bg-jaguar.webp')), 'мозаика: ' + JSON.stringify(mosaic.slice(0, 2)));
      await ev(page, () => { window.__SUN.start('2-01'); });
      await waitStarted(page);
      await page.waitForFunction(() => { const l = document.querySelector('.theme-bg[data-theme="2"]'); return l && l.classList.contains('on'); }, null, { timeout: 15000 });
      await page.waitForTimeout(2000);
      const r = await ev(page, () => {
        const l2 = document.querySelector('.theme-bg[data-theme="2"]');
        const plate = l2.querySelector('.bd-plate');
        return {
          on1: document.querySelector('.theme-bg[data-theme="1"]').classList.contains('on'),
          hb: document.body.classList.contains('has-backdrop'),
          want: !!Campaign.lands().find(l => l.id === 2).backdrop,
          stage: !!l2.querySelector('.bd-stage'),
          wf: l2.querySelectorAll('.bd-wf, .bd-mist, .bd-water').length,
          moon: !!l2.querySelector('.bd-moon'),
          clouds: !!l2.querySelector('.bd-cloud-track'),
          plateSrc: plate && plate.src.replace(/^.*\/assets\//, 'assets/'),
          plateW: plate ? plate.naturalWidth : 0,
          mode: document.body.dataset.bd,
          f: __BD.frames
        };
      });
      await page.waitForTimeout(1000);
      const f1 = await ev(page, () => __BD.frames);
      assert(!r.on1, 'слой земли 1 остался .on');
      assert(r.want === true && r.hb === true, `has-backdrop=${r.hb}, backdrop у земли 2 ${r.want}: должен быть живой фон`);
      assert(r.stage, 'в слое земли 2 нет .bd-stage');
      assert(r.wf === 0, `в слое земли 2 есть водопад или туман (${r.wf})`);
      assert(r.moon && r.clouds, 'в слое земли 2 нет луны или облаков');
      assert(r.plateSrc === 'assets/backdrop/land2/plate.webp' && r.plateW === 1672, 'плита земли 2: ' + r.plateSrc + ' ' + r.plateW);
      assert(r.mode === 'run', 'на уровне земли 2 режим ' + r.mode);
      assert(f1 > r.f, `на земле 2 светлячки не летают: ${r.f} -> ${f1}`);
      // Луна открыта (7×7 точек по рамке .bd-moon) и не закрыта кнопками и табличками
      const moonPts = await ev(page, () => {
        const m = document.querySelector('.theme-bg[data-theme="2"] .bd-moon').getBoundingClientRect();
        const p = [];
        for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) p.push([m.left + m.width * (i + 0.5) / 7, m.top + m.height * (j + 0.5) / 7]);
        return p;
      });
      const moonHit = await bdOpen(page, moonPts);
      const moonFrac = moonHit.filter(h => h === '').length / moonHit.length;
      assert(moonFrac >= 0.6, `луна земли 2 открыта на ${(moonFrac * 100).toFixed(0)}%: ` + [...new Set(moonHit.filter(Boolean))].join(','));
      // Светлячки и здесь не над табличками, кнопками, рамкой поля
      const fc = await fliesCheck(page);
      assert(fc.n > 0 && !fc.bad.length, `светлячки земли 2: ${fc.n}, на занятых местах: ` + fc.bad.join(' '));
      await shot(page, bname, 'desktop-L4-land2-backdrop');
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      await ctx.close();
      assert(!errs.length, 'ошибки консоли: ' + errs.join(' | '));
      return `mosaic ${mosaic.length} cells bg-jaguar; land2 has-backdrop=${r.hb}, no .bd-wf/.bd-mist, plate ${r.plateW}px, moon open ${(moonFrac * 100).toFixed(0)}%, flies ${fc.n} ok; layer1 on=${r.on1}; frames ${r.f}->${f1}; console errors 0`;
    });

    // ---- 13 ----
    await scenario(bname, '13 strikes: gem shatters into shards, no flash or shake, vines survive a line', async () => {
      const key = 's13';
      const { ctx, page } = await newPage(browser, bname, key, { width: 1366, height: 768 }, { fxFull: true });
      await startFresh(page, url);
      await page.click('#startScreen [data-difficulty-btn="normal"]');
      await page.click('#playBtn');
      await waitStarted(page);
      await page.waitForFunction(() => __SUN.state.running && !__SUN.state.busy, null, { timeout: 10000 });
      // Наблюдатель на весь сценарий: вспышки .blast-flash, тряска рамки,
      // когда камень спрятан (fx-gone) и когда появились осколки (с клеткой).
      await ev(page, () => {
        const W = window.__fxWatch = { flash: 0, ring: 0, frameBlast: 0, gone: [], shards: [], lifeMax: 0 };
        const born = new WeakMap();
        new MutationObserver(list => list.forEach(m => {
          m.addedNodes.forEach(n => {
            if (!n.classList) return;
            if (n.classList.contains('blast-flash')) W.flash++;
            if (n.classList.contains('shockwave')) W.ring++;
            if (n.classList.contains('fx-shard')) {
              born.set(n, performance.now());
              W.shards.push({ t: performance.now(), cell: n.dataset.cell });
            }
          });
          m.removedNodes.forEach(n => {
            if (born.has(n)) W.lifeMax = Math.max(W.lifeMax, performance.now() - born.get(n));
          });
        })).observe(document.getElementById('fx'), { childList: true, subtree: true });
        new MutationObserver(list => list.forEach(m => {
          if (m.target.classList && m.target.classList.contains('fx-gone')) W.gone.push(performance.now());
        })).observe(document.getElementById('tiles'), { attributes: true, attributeFilter: ['class'], subtree: true });
        const frame = document.querySelector('.board-frame');
        new MutationObserver(() => {
          if (frame.classList.contains('blast') || frame.classList.contains('blast-sun')) W.frameBlast++;
        }).observe(frame, { attributes: true, attributeFilter: ['class'] });
      });

      // Обычный ход: камни раскалываются на осколки в течение 150 мс,
      // через 700 мс после хода ни осколков, ни копий камней не осталось.
      await playRealMove(page);
      const mv = await ev(page, () => {
        const W = window.__fxWatch;
        return { gone: W.gone.length, shards: W.shards.length, lag: W.shards.length && W.gone.length ? W.shards[0].t - W.gone[0] : null };
      });
      assert(mv.gone > 0, 'после хода ни один камень не спрятан (fx-gone)');
      assert(mv.shards > 0, 'после хода нет .fx-shard');
      // Два наблюдателя доставляют записи в своём порядке (в WebKit осколки бывали «раньше» на доли мс), поэтому ниже нуля допуск 20 мс
      assert(mv.lag !== null && mv.lag >= -20 && mv.lag <= 150, 'осколки появились не за 150 мс: ' + (mv.lag === null ? 'нет данных' : mv.lag.toFixed(0)));
      await page.waitForTimeout(700);
      const left = await ev(page, () => document.querySelectorAll('#fx .fx-shard, #fx .fx-standin').length);
      assert(left === 0, 'через 700 мс в #fx осталось осколков/копий: ' + left);
      mv.lifeMax = await ev(page, () => window.__fxWatch.lifeMax);
      assert(mv.lifeMax > 0 && mv.lifeMax <= 700, 'осколок жил дольше 700 мс: ' + mv.lifeMax.toFixed(0));
      await page.waitForTimeout(800);
      const parts = await ev(page, () => window.Fx.particles());
      assert(parts === 0, 'через 1,5 с на canvas живые частицы: ' + parts);

      // Лианы: молния по ряду 3 срывает лиану с (3,5), камень остаётся на месте.
      await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
      await ev(page, () => __SUN.setVines([[3, 5]]));
      const vr = await ev(page, async () => {
        const S = window.__SUN;
        const W = window.__fxWatch;
        const node = S.gemAt(3, 5).el;
        let snapped = false;
        const mo = new MutationObserver(() => { if (node.classList.contains('vine-snap')) snapped = true; });
        mo.observe(node, { attributes: true, attributeFilter: ['class'] });
        const t0 = performance.now();
        const run = S.strike(3, 1, 'line', 'row');
        // Первый шаг: гашение сразу, удаление узлов через 310 мс, затем падение (≥390 мс)
        await new Promise(res => setTimeout(res, 400));
        const alive = node.isConnected && S.gemAt(3, 5) && S.gemAt(3, 5).el === node;
        const firstStep = W.shards.filter(s => s.t >= t0 && s.t - t0 < 400);
        await run;
        mo.disconnect();
        return {
          snapped, alive,
          at35: firstStep.filter(s => s.cell === '3,5').length,
          row3: firstStep.filter(s => s.cell && s.cell.startsWith('3,')).length
        };
      });
      assert(vr.snapped, 'камень (3,5) не получил vine-snap');
      assert(vr.alive, 'узел камня (3,5) убран молнией');
      assert(vr.at35 === 0, 'у клетки (3,5) были осколки: ' + vr.at35);
      assert(vr.row3 > 0, 'молния по ряду 3 не расколола ни одного камня');

      // Бомба в (4,4): спрайт взрыва .fx-bomb, центр — центр клетки (4,4)
      // с точностью 5 % клетки; угли на canvas за 200 мс; узел взрыва живёт
      // не дольше 1100 мс; когда поле успокоилось, через 1,5 с ни узлов
      // эффектов, ни частиц. Режимы: low — взрыв без углей, reduced — ничего,
      // calm — углей не больше 10 и взрыв прозрачнее.
      const bomb = (setup) => ev(page, async (setup) => {
        const S = window.__SUN;
        const fx = document.getElementById('fx');
        const B = document.body;
        const keep = { fx: B.dataset.fx, difficulty: B.dataset.difficulty };
        if (setup === 'low') B.dataset.fx = 'low';
        if (setup === 'calm') B.dataset.difficulty = 'calm';
        // Спецкамни от прошлых каскадов задели бы цепочкой: на поле их не оставляем
        S.state.grid.flat().forEach(g => { if (g && g.special) { g.special = null; g.lineDir = null; } });
        const FXSEL = '.fx-strike, .fx-shard, .fx-standin';
        let node = null, born = 0, gone = 0, maxNodes = 0, added = 0;
        const mo = new MutationObserver(list => list.forEach(m => {
          m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('fx-bomb')) { added++; node = n; born = performance.now(); } });
          m.removedNodes.forEach(n => { if (n === node) gone = performance.now(); });
          maxNodes = Math.max(maxNodes, fx.querySelectorAll(FXSEL).length);
        }));
        mo.observe(fx, { childList: true });
        const run = S.strike(4, 4, 'bomb');
        await new Promise(res => setTimeout(res, 150));
        const el = fx.querySelector('.fx-bomb');
        let off = -1, cells = 0, opacity = -1;
        if (el) {
          const b = el.getBoundingClientRect();
          const f = fx.getBoundingClientRect();
          const cell = f.width / 8;
          off = Math.hypot(b.left + b.width / 2 - (f.left + 4.5 * cell), b.top + b.height / 2 - (f.top + 4.5 * cell)) / cell;
          cells = el.offsetWidth / cell;
        }
        const embers = window.Fx.particles('ember');
        await new Promise(res => setTimeout(res, 250));
        if (el) opacity = +getComputedStyle(el).opacity;
        await run;
        await new Promise(res => setTimeout(res, 1500));
        mo.disconnect();
        const res = {
          added, off, cells, embers, opacity,
          life: born && gone ? gone - born : (node && node.isConnected ? 99999 : 0),
          maxNodes,
          leftNodes: fx.querySelectorAll(FXSEL).length,
          leftParts: window.Fx.particles()
        };
        B.dataset.fx = keep.fx || '';
        if (!keep.fx) delete B.dataset.fx;
        B.dataset.difficulty = keep.difficulty;
        return res;
      }, setup);

      await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
      const bf = await bomb('full');
      assert(bf.added === 1, 'бомба: .fx-bomb появился ' + bf.added + ' раз');
      assert(bf.off >= 0 && bf.off <= 0.05, 'бомба: центр .fx-bomb дальше 5 % клетки от центра (4,4): ' + bf.off.toFixed(3));
      assert(bf.cells >= 3, 'бомба: взрыв уже 3 клеток: ' + bf.cells.toFixed(2));
      assert(bf.embers > 0, 'бомба: нет углей на canvas за 150 мс');
      assert(bf.life > 0 && bf.life <= 1100, 'бомба: узел взрыва жил ' + bf.life.toFixed(0) + ' мс (предел 1100)');
      assert(bf.maxNodes <= 120, 'бомба: узлов эффектов в #fx ' + bf.maxNodes + ' (предел 120)');
      assert(bf.leftNodes === 0 && bf.leftParts === 0, 'бомба: через 1,5 с осталось узлов ' + bf.leftNodes + ', частиц ' + bf.leftParts);

      await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
      const bl = await bomb('low');
      assert(bl.added === 1 && bl.embers === 0, 'бомба low: взрыв ' + bl.added + ', углей ' + bl.embers + ' (ждали 1 и 0)');
      assert(bl.leftNodes === 0 && bl.leftParts === 0, 'бомба low: остались узлы/частицы');

      await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
      const bc = await bomb('calm');
      assert(bc.added === 1 && bc.embers > 0 && bc.embers <= 10, 'бомба calm: взрыв ' + bc.added + ', углей ' + bc.embers + ' (ждали 1..10)');
      assert(bc.opacity >= 0 && bc.opacity < bf.opacity, 'бомба calm: взрыв не прозрачнее полного: ' + bc.opacity + ' vs ' + bf.opacity);

      // Удары молнии, солнца и тотема: свой узел появляется за 150 мс, все узлы
      // уходят за 1100 мс, через 1,5 с ни узлов, ни частиц.
      const FXNODES = '.fx-strike, .fx-strip, .fx-shard, .fx-standin';
      const strikeProbe = (o) => ev(page, async ({ r, c, type, dir, sel, setup, FXNODES, keepSpecials }) => {
        const S = window.__SUN;
        const fx = document.getElementById('fx');
        const B = document.body;
        const keep = { fx: B.dataset.fx, difficulty: B.dataset.difficulty };
        if (setup === 'low') B.dataset.fx = 'low';
        if (setup === 'calm') B.dataset.difficulty = 'calm';
        if (!keepSpecials) S.state.grid.flat().forEach(g => { if (g && g.special) { g.special = null; g.lineDir = null; } });
        const sun = S.gemAt(r, c).color;
        const expectRays = Math.min(16, S.state.grid.flat().filter(g => g && g.color === sun && !(g.r === r && g.c === c)).length);
        const t0 = performance.now();
        let firstAt = -1, added = 0, maxNodes = 0, lifeMax = 0;
        const born = new Map();
        const mo = new MutationObserver(list => {
          const t = performance.now();
          list.forEach(m => {
            m.addedNodes.forEach(n => {
              if (!n.classList) return;
              if (n.matches(sel)) { added++; if (firstAt < 0) firstAt = t - t0; }
              if (n.classList.contains('fx-strike')) born.set(n, t);
            });
            m.removedNodes.forEach(n => { if (born.has(n)) { lifeMax = Math.max(lifeMax, t - born.get(n)); born.delete(n); } });
          });
          maxNodes = Math.max(maxNodes, fx.querySelectorAll(FXNODES).length);
        });
        mo.observe(fx, { childList: true, subtree: true });
        const run = S.strike(r, c, type, dir);
        await new Promise(res => setTimeout(res, 240));
        const el = fx.querySelector(sel);
        const opacity = el ? +getComputedStyle(el).opacity : -1;
        const embers = window.Fx.particles();
        await run;
        await new Promise(res => setTimeout(res, 1500));
        mo.disconnect();
        const res = { firstAt, added, expectRays, opacity, embers, maxNodes, lifeMax, stuck: born.size,
          leftNodes: fx.querySelectorAll(FXNODES).length, leftParts: window.Fx.particles() };
        if (keep.fx) B.dataset.fx = keep.fx; else delete B.dataset.fx;
        B.dataset.difficulty = keep.difficulty;
        return res;
      }, { ...o, FXNODES });
      const idle = () => page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
      const clean = (name, p) => {
        assert(p.lifeMax > 0 && p.lifeMax <= 1100 && p.stuck === 0, name + ': узел удара жил ' + p.lifeMax.toFixed(0) + ' мс, не убрано ' + p.stuck);
        assert(p.leftNodes === 0 && p.leftParts === 0, name + ': через 1,5 с узлов ' + p.leftNodes + ', частиц ' + p.leftParts);
        assert(p.maxNodes <= 120, name + ': узлов в #fx ' + p.maxNodes + ' (предел 120)');
      };
      const seen = (name, p) => assert(p.firstAt >= 0 && p.firstAt <= 150, name + ': свой узел за ' + p.firstAt.toFixed(0) + ' мс (предел 150)');

      await idle();
      const lr = await strikeProbe({ r: 3, c: 2, type: 'line', dir: 'row', sel: '.fx-line' });
      seen('молния ряд', lr); clean('молния ряд', lr);
      assert(lr.added === 2, 'молния ряд: лучей ' + lr.added + ' (ждали 2, в обе стороны)');
      await idle();
      const lc = await strikeProbe({ r: 2, c: 5, type: 'line', dir: 'col', sel: '.fx-line' });
      seen('молния столбец', lc); clean('молния столбец', lc);
      assert(lc.added === 2, 'молния столбец: лучей ' + lc.added + ' (ждали 2)');
      await idle();
      const le = await strikeProbe({ r: 0, c: 0, type: 'line', dir: 'row', sel: '.fx-line' });
      assert(le.added === 1, 'молния с края: лучей ' + le.added + ' (ждали 1)');
      await idle();
      const lCalm = await strikeProbe({ r: 3, c: 2, type: 'line', dir: 'row', sel: '.fx-line', setup: 'calm' });
      assert(lCalm.opacity >= 0 && lCalm.opacity < lr.opacity, 'молния calm: не прозрачнее полной: ' + lCalm.opacity + ' vs ' + lr.opacity);
      await idle();
      const lLow = await strikeProbe({ r: 3, c: 2, type: 'line', dir: 'row', sel: '.fx-line', setup: 'low' });
      assert(lLow.added === 2 && lLow.embers === 0, 'молния low: лучей ' + lLow.added + ', частиц ' + lLow.embers + ' (ждали 2 и 0)');

      await idle();
      const sn = await strikeProbe({ r: 4, c: 3, type: 'sun', sel: '.fx-ray' });
      seen('солнце', sn); clean('солнце', sn);
      assert(sn.added === sn.expectRays && sn.added > 0, 'солнце: лучей ' + sn.added + ' (ждали ' + sn.expectRays + ')');

      await idle();
      const tm = await strikeProbe({ r: 4, c: 3, type: 'totem', sel: '.fx-wave' });
      seen('тотем', tm); clean('тотем', tm);
      assert(tm.added === 4, 'тотем: полос ' + tm.added + ' (ждали 4)');
      await idle();
      const tCalm = await strikeProbe({ r: 4, c: 3, type: 'totem', sel: '.fx-wave', setup: 'calm' });
      assert(tCalm.opacity >= 0 && tCalm.opacity < tm.opacity, 'тотем calm: не прозрачнее полного: ' + tCalm.opacity + ' vs ' + tm.opacity);

      // Цепочка: солнце с 20 целями и бомба рядом (её цвет — цвет солнца, солнце её задевает)
      await idle();
      await ev(page, () => {
        const S = window.__SUN;
        const sunColor = S.gemAt(4, 3).color;
        let n = 0;
        S.state.grid.forEach(row => row.forEach(g => { if (g && n < 21 && !g.special) { g.color = sunColor; n++; } }));
        const b = S.gemAt(4, 4);
        b.color = sunColor;
        S.upgradeGem(b, 'bomb');
      });
      const ch = await strikeProbe({ r: 4, c: 3, type: 'sun', sel: '.fx-ray', keepSpecials: true });
      assert(ch.added === 16, 'цепочка: лучей ' + ch.added + ' (ждали 16)');
      assert(ch.maxNodes >= 40, 'цепочка: подозрительно мало узлов, сценарий не сработал: ' + ch.maxNodes);
      clean('цепочка', ch);

      // Fx.mode() сразу видит смену prefers-reduced-motion. MediaQueryList, который
      // держали с загрузки, в Playwright Firefox отставал: сразу после emulateMedia
      // .matches ещё старый (через 300 мс верный), свежий matchMedia верен сразу.
      await idle();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert(await ev(page, () => window.Fx.mode().reduced) === true, 'Fx.mode().reduced не видит reduce сразу');
      const br = await bomb('reduced');
      assert(br.added === 0 && br.embers === 0, 'бомба reduced: взрыв ' + br.added + ', углей ' + br.embers + ' (ждали 0)');
      await idle();
      const sRed = await strikeProbe({ r: 2, c: 2, type: 'sun', sel: '.fx-ray' });
      await idle();
      const lRed = await strikeProbe({ r: 2, c: 2, type: 'line', dir: 'row', sel: '.fx-line' });
      await idle();
      const tRed = await strikeProbe({ r: 2, c: 2, type: 'totem', sel: '.fx-wave' });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert(await ev(page, () => window.Fx.mode().reduced) === false, 'Fx.mode().reduced не видит no-preference сразу');
      assert(sRed.added === 0 && lRed.added === 0 && tRed.added === 0, 'reduced: узлы удара есть: ' + [sRed.added, lRed.added, tRed.added]);

      const w = await ev(page, () => window.__fxWatch);
      const frameCls = await ev(page, () => document.querySelector('.board-frame').className);
      assert(w.flash === 0, '.blast-flash появлялся: ' + w.flash);
      assert(w.ring === 0, 'белое кольцо .shockwave появлялось: ' + w.ring);
      assert(w.frameBlast === 0 && !/\bblast(-sun)?\b/.test(frameCls), 'тряска рамки blast/blast-sun: ' + w.frameBlast + ' ' + frameCls);
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      await ctx.close();
      assert(!errs.length, 'ошибки консоли: ' + errs.join(' | '));
      return `move: gone ${mv.gone}, shards ${mv.shards}, lag ${mv.lag.toFixed(0)} ms, shard life ≤ ${mv.lifeMax.toFixed(0)} ms; line: row3 shards ${vr.row3}, (3,5) snapped & alive; bomb: off ${bf.off.toFixed(3)} cell, ${bf.cells.toFixed(2)} cells wide, embers ${bf.embers}/low ${bl.embers}/calm ${bc.embers}/reduced ${br.embers}, life ${bf.life.toFixed(0)} ms, nodes ≤ ${bf.maxNodes}, opacity ${bf.opacity.toFixed(2)}/calm ${bc.opacity.toFixed(2)}; line ${lr.firstAt.toFixed(0)}/${lc.firstAt.toFixed(0)} ms, sun ${sn.added} rays, totem ${tm.added} waves, chain peak ${ch.maxNodes} nodes; flash 0, shake 0, ring 0; console errors 0`;
    });

    // ---- 13 strikes: режимы и граничные случаи (имена с «13 strikes» — ONLY="13 strikes" берёт все) ----
    const startNormal = async (page) => {
      await startFresh(page, url);
      await page.click('#startScreen [data-difficulty-btn="normal"]');
      await page.click('#playBtn');
      await waitStarted(page);
      await page.waitForFunction(() => __SUN.state.running && !__SUN.state.busy, null, { timeout: 10000 });
    };
    // Наблюдатель за #fx и полем: какие узлы эффектов появились, сколько камней спрятано, пик частиц
    const installWatch = (page) => ev(page, () => {
      const W = window.__modeWatch = { shards: {}, nShards: 0, other: {}, gone: 0, partsMax: 0 };
      const OTHER = ['fx-ray', 'fx-wave', 'fx-line', 'fx-bomb', 'fx-strip', 'fx-strike'];
      new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
        if (!n.classList) return;
        if (n.classList.contains('fx-shard')) { W.nShards++; W.shards[n.dataset.cell] = (W.shards[n.dataset.cell] || 0) + 1; }
        OTHER.forEach(k => { if (n.classList.contains(k)) W.other[k] = (W.other[k] || 0) + 1; });
      }))).observe(document.getElementById('fx'), { childList: true, subtree: true });
      new MutationObserver(list => list.forEach(m => {
        if (m.target.classList && m.target.classList.contains('fx-gone')) W.gone++;
      })).observe(document.getElementById('tiles'), { attributes: true, attributeFilter: ['class'], subtree: true });
      setInterval(() => { W.partsMax = Math.max(W.partsMax, window.Fx.particles()); }, 30);
    });
    const FXLEFT = '#fx .fx-strike, #fx .fx-strip, #fx .fx-shard, #fx .fx-standin';

    // Слабый режим: у раскола ровно 3 осколка на клетку, частиц на canvas нет
    await scenario(bname, '13 strikes low: exactly 3 shards per cell, no canvas particles', async () => {
      const key = 's13low';
      const { ctx, page } = await newPage(browser, bname, key, { width: 1366, height: 768 }, { fx: 'low' });
      await startNormal(page);
      assert(await ev(page, () => window.Fx.mode().low) === true, 'sun-keeper-fx=low не включил слабый режим');
      await installWatch(page);
      await playRealMove(page);
      await page.waitForTimeout(1500);
      const w = await ev(page, () => window.__modeWatch);
      const cells = Object.keys(w.shards);
      assert(cells.length > 0, 'low: осколков нет совсем');
      // Каскад может разбить ту же клетку ещё раз (волны идут с разницей около 700 мс), счётчик копится:
      // кратно 3, и хотя бы одна клетка ровно 3 (в обычном режиме по 6 осколков — такое условие не пройдёт)
      const bad = cells.filter(k => w.shards[k] % 3 !== 0);
      assert(!bad.length && cells.some(k => w.shards[k] === 3), 'low: у клеток не по 3 осколка: ' + cells.map(k => k + '=' + w.shards[k]).join(' '));
      assert(w.partsMax === 0, 'low: на canvas были частицы: ' + w.partsMax);
      const left = await ev(page, (sel) => document.querySelectorAll(sel).length, FXLEFT);
      assert(left === 0, 'low: через 1,5 с остались узлы: ' + left);
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      await ctx.close();
      assert(!errs.length, 'ошибки консоли: ' + errs.join(' | '));
      return `low: ${cells.length} cells x 3 shards, max particles ${w.partsMax}`;
    });

    // reduced-motion с самой загрузки: ни осколков, ни узлов ударов, ни частиц;
    // камни всё равно исчезают; апгрейд и перетасовка приходят в верное состояние без element.animate
    await scenario(bname, '13 strikes reduced: no shards, rays, waves, lines or bombs; gems still vanish', async () => {
      const key = 's13red';
      const { ctx, page } = await newPage(browser, bname, key, { width: 1366, height: 768 }, { reducedMotion: true, fxFull: true });
      await startNormal(page);
      assert(await ev(page, () => window.Fx.mode().reduced) === true, 'reduced: Fx.mode().reduced не видит reduce');
      await installWatch(page);
      await playRealMove(page);
      const mv = await ev(page, () => ({ ...window.__modeWatch }));
      assert(mv.gone > 0, 'reduced: после хода камни не исчезли (fx-gone)');
      assert(mv.nShards === 0, 'reduced: .fx-shard появлялись: ' + mv.nShards);
      assert(mv.partsMax === 0, 'reduced: частицы на canvas: ' + mv.partsMax);
      await page.waitForTimeout(700);
      const after = await ev(page, () => ({
        gone: document.querySelectorAll('#tiles .fx-gone').length,
        gems: document.querySelectorAll('#tiles .gem').length,
        left: document.querySelectorAll('#fx .fx-strike, #fx .fx-strip, #fx .fx-shard, #fx .fx-standin').length
      }));
      assert(after.gone === 0 && after.gems === 64, `reduced: после хода спрятанных камней ${after.gone}, всего ${after.gems} (ждали 0 и 64)`);
      assert(after.left === 0, 'reduced: через 700 мс остались узлы эффектов: ' + after.left);

      // Все четыре удара: узлов ударов нет, частиц нет, камни целей исчезают
      const types = [['bomb', undefined], ['line', 'row'], ['sun', undefined], ['totem', undefined]];
      for (const [type, dir] of types) {
        await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
        const r = await ev(page, async ({ type, dir }) => {
          const S = window.__SUN, W = window.__modeWatch;
          S.state.grid.flat().forEach(g => { if (g && g.special) { g.special = null; g.lineDir = null; } });
          W.other = {}; W.nShards = 0; W.gone = 0; W.partsMax = 0;
          await S.strike(3, 3, type, dir);
          await new Promise(res => setTimeout(res, 300));
          return { other: { ...W.other }, shards: W.nShards, gone: W.gone, parts: Math.max(W.partsMax, window.Fx.particles()) };
        }, { type, dir });
        assert(Object.keys(r.other).length === 0, `reduced ${type}: узлы эффектов ${JSON.stringify(r.other)}`);
        assert(r.shards === 0 && r.parts === 0, `reduced ${type}: осколков ${r.shards}, частиц ${r.parts}`);
        assert(r.gone > 0, `reduced ${type}: камни не исчезли`);
      }

      // Солнце с дальними целями: копия камня не ждёт лучей, которых в reduced нет —
      // живёт только своё угасание (200 мс), даже у самой дальней цели
      await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
      const sd = await ev(page, async () => {
        const S = window.__SUN, fx = document.getElementById('fx');
        S.state.grid.flat().forEach(g => { if (g && g.special) { g.special = null; g.lineDir = null; } });
        const color = S.gemAt(0, 0).color;
        S.state.grid.forEach((row, r) => row.forEach((g, c) => { if (g && (r + c >= 10 || (r === 7 && c === 7))) g.color = color; }));
        const born = new Map(); let life = 0, n = 0;
        const mo = new MutationObserver(list => list.forEach(m => {
          m.addedNodes.forEach(x => { if (x.classList && x.classList.contains('fx-standin')) born.set(x, performance.now()); });
          m.removedNodes.forEach(x => { if (born.has(x)) { n++; life = Math.max(life, performance.now() - born.get(x)); born.delete(x); } });
        }));
        mo.observe(fx, { childList: true });
        await S.strike(0, 0, 'sun');
        await new Promise(res => setTimeout(res, 100));
        mo.disconnect();
        return { life, n, open: born.size };
      });
      assert(sd.n >= 8, 'reduced sun: копий камней-целей ' + sd.n + ' (ждали ≥ 8), проверка пустая');
      assert(sd.life <= 320, `reduced sun: копия камня жила ${sd.life.toFixed(0)} мс (ждали ≤ 320, ждала лучей)`);

      // Апгрейд камня: итоговое состояние верное, движения (element.animate) нет
      await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
      const up = await ev(page, () => {
        const S = window.__SUN;
        const g = S.gemAt(5, 5);
        S.upgradeGem(g, 'bomb');
        const inner = g.el.querySelector('.gem-inner');
        return { special: g.special, cls: g.el.className, anims: inner ? inner.getAnimations().length : -1, hasInner: !!inner };
      });
      assert(up.special === 'bomb' && up.hasInner && /special-bomb|bomb/.test(up.cls), 'reduced: камень не стал бомбой: ' + JSON.stringify(up));
      assert(up.anims === 0, 'reduced: апгрейд запустил анимацию (element.animate): ' + up.anims);

      // Отказ для камня в лианах: покачивания нет
      const rf = await ev(page, async () => {
        const S = window.__SUN;
        S.setVines([[2, 2]]);
        const g = S.gemAt(2, 2);
        const [mr, mc] = [[2, 3], [1, 2], [3, 2]].find(([r, c]) => S.gemAt(r, c));
        await S.attemptSwap({ r: 2, c: 2 }, { r: mr, c: mc });
        const parts = g.el.querySelectorAll('.gem-inner, .vine-overlay');
        const anims = [...parts].reduce((n, p) => n + p.getAnimations().length, 0);
        const still = S.gemAt(2, 2) === g && g.locked;
        S.setVines([]);
        return { anims, still, parts: parts.length };
      });
      assert(rf.parts > 0 && rf.still, 'reduced: отказ — не тот камень/лианы сняты: ' + JSON.stringify(rf));
      assert(rf.anims === 0, 'reduced: отказ для лиан качает камень (element.animate): ' + rf.anims);

      // Перетасовка: камни возвращаются на поле, анимаций на них нет
      await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
      const sh = await ev(page, async () => {
        const S = window.__SUN;
        const run = S.reshuffleBoard(false);
        await new Promise(res => setTimeout(res, 420));
        const anims = [...document.querySelectorAll('#tiles .gem-inner')].reduce((n, e) => n + e.getAnimations().length, 0);
        await run;
        await new Promise(res => setTimeout(res, 100));
        const visible = [...document.querySelectorAll('#tiles .gem')].filter(e => e.style.opacity === '' || +getComputedStyle(e).opacity === 1).length;
        return { anims, visible, total: document.querySelectorAll('#tiles .gem').length };
      });
      assert(sh.anims === 0, 'reduced: перетасовка запустила element.animate на камнях: ' + sh.anims);
      assert(sh.total === 64 && sh.visible === 64, 'reduced: после перетасовки камней ' + sh.total + ', видимых ' + sh.visible);
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      await ctx.close();
      assert(!errs.length, 'ошибки консоли: ' + errs.join(' | '));
      return `reduced: move gone ${mv.gone}, shards 0, strikes bomb/line/sun/totem clean, upgrade/refuse/reshuffle without animate`;
    });

    // Сбой эффектов не ломает механику: Fx.shatter и Fx.strike бросают, ход и удар
    // всё равно доигрываются (busy снят, 64 камня, счёт вырос). Ошибки консоли
    // здесь ожидаемы, но только подставленные — любая другая роняет сценарий.
    await scenario(bname, '13 strikes effect failure: board recovers when Fx throws', async () => {
      const key = 's13fail';
      const { ctx, page } = await newPage(browser, bname, key, { width: 1366, height: 768 }, { fxFull: true });
      await startNormal(page);
      await ev(page, () => {
        window.Fx.shatter = () => { throw new Error('injected shatter failure'); };
        window.Fx.strike = () => { throw new Error('injected strike failure'); };
      });
      const gemsOk = () => ev(page, () => ({
        busy: __SUN.state.busy,
        dom: document.querySelectorAll('#tiles .gem').length,
        grid: __SUN.state.grid.flat().filter(Boolean).length,
        gone: document.querySelectorAll('#tiles .fx-gone').length
      }));
      const score0 = await ev(page, () => __SUN.state.score);
      // Обычный ход: каскад гасит камни через Fx.shatter, который бросает
      await ev(page, async () => {
        const S = window.__SUN;
        const m = S.findMove();
        if (m) await S.attemptSwap(m[0], m[1]).catch(() => {});
      });
      await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 5000 });
      await page.waitForTimeout(500);
      const afterMove = await gemsOk();
      const score1 = await ev(page, () => __SUN.state.score);
      assert(!afterMove.busy, 'после хода со сбоем эффектов busy остался true');
      assert(afterMove.dom === 64 && afterMove.grid === 64, `после хода камней в DOM ${afterMove.dom}, в сетке ${afterMove.grid} (ждали 64)`);
      assert(afterMove.gone === 0, 'после хода остались спрятанные камни: ' + afterMove.gone);
      assert(score1 > score0, `счёт не вырос после хода: ${score0} -> ${score1}`);
      // Удар бомбы: Fx.strike и Fx.shatter бросают
      const struck = await ev(page, async () => {
        const S = window.__SUN;
        S.state.grid.flat().forEach(g => { if (g && g.special) { g.special = null; g.lineDir = null; } });
        let err = null;
        try { await S.strike(4, 4, 'bomb'); } catch (e) { err = String(e && e.message); }
        return err;
      });
      assert(struck === null, 'удар со сбоем эффектов бросил наружу: ' + struck);
      await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 5000 });
      await page.waitForTimeout(500);
      const afterStrike = await gemsOk();
      const score2 = await ev(page, () => __SUN.state.score);
      assert(!afterStrike.busy, 'после удара со сбоем эффектов busy остался true');
      assert(afterStrike.dom === 64 && afterStrike.grid === 64, `после удара камней в DOM ${afterStrike.dom}, в сетке ${afterStrike.grid} (ждали 64)`);
      assert(afterStrike.gone === 0, 'после удара остались спрятанные камни: ' + afterStrike.gone);
      assert(score2 > score1, `счёт не вырос после удара: ${score1} -> ${score2}`);
      // Игра жива: следующий ход проходит
      await playRealMove(page);
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      await ctx.close();
      const foreign = errs.filter(l => !/injected (shatter|strike) failure/.test(l));
      assert(foreign.length === 0, 'чужие ошибки консоли: ' + foreign.join(' | '));
      assert(errs.some(l => /injected shatter failure/.test(l)) && errs.some(l => /injected strike failure/.test(l)),
        'подставленные сбои не дошли до консоли (сценарий пустой): ' + errs.length);
      return `Fx throws: move score ${score0}->${score1}, bomb ->${score2}, busy released, 64 gems, ${errs.length} injected console errors`;
    });

    // Пауза посреди удара: через 1,5 с узлов эффектов нет, частиц нет
    await scenario(bname, '13 strikes pause: overlay mid-strike leaves no nodes or particles', async () => {
      const key = 's13pause';
      const { ctx, page } = await newPage(browser, bname, key, { width: 1366, height: 768 }, { fxFull: true });
      await startNormal(page);
      const out = [];
      for (const [type, dir] of [['bomb', undefined], ['line', 'row'], ['sun', undefined]]) {
        await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
        await ev(page, ({ type, dir }) => {
          const S = window.__SUN;
          S.state.grid.flat().forEach(g => { if (g && g.special) { g.special = null; g.lineDir = null; } });
          window.__pauseRun = S.strike(4, 4, type, dir);
        }, { type, dir });
        await page.waitForTimeout(150);
        const mid = await ev(page, (sel) => ({ nodes: document.querySelectorAll(sel).length, parts: window.Fx.particles() }), FXLEFT);
        assert(mid.nodes + mid.parts > 0, `пауза ${type}: на 150 мс удара ещё ничего нет, проверка пустая`);
        // Кнопка паузы во время хода только ставит паузу в очередь (сценарий «queued pause»),
        // поэтому оверлей посреди удара открываем так же, как экраны игры: через Game.openOverlay
        await ev(page, () => window.Game.openOverlay('pauseScreen'));
        await page.waitForSelector('#pauseScreen.show');
        await page.waitForTimeout(60);
        // Оверлей сразу убрал всё, что играло
        const cut = await ev(page, (sel) => ({ nodes: document.querySelectorAll(sel).length, parts: window.Fx.particles() }), FXLEFT);
        assert(cut.nodes === 0 && cut.parts === 0, `пауза ${type}: через 60 мс после оверлея узлов ${cut.nodes}, частиц ${cut.parts}`);
        // Ход под оверлеем доигрывается (логика не останавливается), после него ничего не висит
        await ev(page, () => window.__pauseRun);
        await page.waitForTimeout(1500);
        const end = await ev(page, (sel) => ({ nodes: document.querySelectorAll(sel).length, parts: window.Fx.particles() }), FXLEFT);
        assert(end.nodes === 0 && end.parts === 0, `пауза ${type}: через 1,5 с после удара узлов ${end.nodes}, частиц ${end.parts}`);
        await ev(page, () => window.Game.closeAllOverlays());
        await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
        out.push(`${type} ${mid.nodes}n/${mid.parts}p -> 0`);
      }
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      await ctx.close();
      assert(!errs.length, 'ошибки консоли: ' + errs.join(' | '));
      return 'pause mid-strike: ' + out.join(', ');
    });

    // Кнопка «Меню» посреди хода: пауза ждёт конца хода, время пока стоит
    await scenario(bname, '13 strikes queued pause: menu during a move opens pause after it', async () => {
      const key = 's13queue';
      const { ctx, page } = await newPage(browser, bname, key, { width: 1366, height: 768 });
      await startNormal(page);
      await ev(page, () => {
        const S = window.__SUN;
        S.state.grid.flat().forEach(g => { if (g && g.special) { g.special = null; g.lineDir = null; } });
        window.__queueRun = S.strike(4, 4, 'bomb');
      });
      await page.waitForTimeout(100);
      const mid = await ev(page, () => {
        document.getElementById('menuBtn').click();
        const s = window.__SUN.state;
        return { busy: s.busy, req: s.pauseRequested, shown: document.getElementById('pauseScreen').classList.contains('show'), t: s.timeLeft, hint: document.getElementById('hintBar').textContent };
      });
      assert(mid.busy, 'на 100 мс удара ход уже кончился, проверка пустая');
      assert(mid.req && !mid.shown, `посреди хода: запрос ${mid.req}, окно паузы ${mid.shown}`);
      assert(/Пауза после хода/.test(mid.hint), 'подсказка: ' + mid.hint);
      await page.waitForTimeout(300);
      const t2 = await ev(page, () => window.__SUN.state.timeLeft);
      assert(t2 === mid.t, `время шло во время запроса паузы: ${mid.t} -> ${t2}`);
      await ev(page, () => window.__queueRun);
      await page.waitForSelector('#pauseScreen.show', { timeout: 3000 });
      const after = await ev(page, () => ({ paused: window.__SUN.state.paused, req: window.__SUN.state.pauseRequested }));
      assert(after.paused && !after.req, 'после хода: ' + JSON.stringify(after));
      await page.click('#resumeBtn');
      await page.waitForFunction(() => !__SUN.state.paused && __SUN.state.running && !document.querySelector('#pauseScreen.show'), null, { timeout: 3000 });
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      await ctx.close();
      assert(!errs.length, 'ошибки консоли: ' + errs.join(' | '));
      return `queued pause: timer held at ${mid.t.toFixed(1)}, overlay after move`;
    });

    // Телефон 390×844: центр .fx-bomb в 5 % клетки от центра клетки удара
    await scenario(bname, '13 strikes phone: bomb centre within 5% of its cell at 390x844', async () => {
      const key = 's13phone';
      const { ctx, page } = await newPage(browser, bname, key, { width: 390, height: 844 }, { fxFull: true });
      await startNormal(page);
      const offs = [];
      for (const [r, c] of [[4, 4], [2, 5]]) {
        await page.waitForFunction(() => !__SUN.state.busy, null, { timeout: 15000 });
        const o = await ev(page, async ({ r, c }) => {
          const S = window.__SUN, fx = document.getElementById('fx');
          S.state.grid.flat().forEach(g => { if (g && g.special) { g.special = null; g.lineDir = null; } });
          const run = S.strike(r, c, 'bomb');
          await new Promise(res => setTimeout(res, 150));
          const el = fx.querySelector('.fx-bomb');
          let off = -1;
          if (el) {
            const b = el.getBoundingClientRect(), f = fx.getBoundingClientRect(), cell = f.width / 8;
            off = Math.hypot(b.left + b.width / 2 - (f.left + (c + 0.5) * cell), b.top + b.height / 2 - (f.top + (r + 0.5) * cell)) / cell;
          }
          await run;
          return off;
        }, { r, c });
        assert(o >= 0 && o <= 0.05, `телефон: центр .fx-bomb в (${r},${c}) дальше 5 % клетки: ${o.toFixed(3)}`);
        offs.push(o.toFixed(3));
      }
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      await ctx.close();
      assert(!errs.length, 'ошибки консоли: ' + errs.join(' | '));
      return 'phone bomb off ' + offs.join(', ') + ' cells';
    });
  } finally {
    await browser.close();
  }
}

async function smokeFile(bt, bname) {
  const browser = await bt.launch(launchOpts(bname));
  try {
    await scenario(bname, '14 transitions: veil on screen change, shard flies to mosaic, nothing left behind', async () => {
      const { ctx, page } = await newPage(browser, bname, 's14');
      await startFresh(page, HTTP);
      await page.click('#mapBtn');
      await page.waitForSelector('#mapScreen.show');
      const during = await ev(page, () => ({ tx: document.body.dataset.tx, go: !!document.querySelector('.screen-veil.go') }));
      assert(during.tx === 'dip' && during.go, 'veil during map open: ' + JSON.stringify(during));
      await page.waitForFunction(() => !document.body.dataset.tx, null, { timeout: 2000 });
      assert(await ev(page, () => !document.querySelector('.screen-veil.go')), 'veil left on');
      const wave = await ev(page, () => {
        window.__SUN.beginLevel('1-01'); // поле строится синхронно, до первого await
        return new Set([...document.querySelectorAll('.gem')].map(g => g.style.transitionDelay)).size;
      });
      assert(wave > 5, 'stones pour as a wave, distinct delays: ' + wave);
      await waitStarted(page);
      await forceWin(page);
      await page.waitForTimeout(600);
      await page.click('#endHomeBtn');
      await page.waitForSelector('#mapScreen.show');
      const fly = await ev(page, () => ({
        nodes: document.querySelectorAll('.shard-fly').length,
        pending: document.querySelector('.land-card.selected .mosaic-cell').classList.contains('shard-pending')
      }));
      assert(fly.nodes === 1 && fly.pending, 'shard flight started: ' + JSON.stringify(fly));
      await page.waitForFunction(() => !document.querySelector('.shard-fly'), null, { timeout: 4000 });
      const cls = await page.locator('.land-card.selected .mosaic-cell').first().getAttribute('class');
      assert(/tier-stone/.test(cls) && !/shard-pending/.test(cls), 'cell after flight: ' + cls);
      // Уход с карты посреди полёта не оставляет осколка над игрой
      await ev(page, () => { window.__SUN.beginLevel('1-02'); });
      await waitStarted(page);
      await forceWin(page);
      await page.waitForTimeout(600);
      await page.click('#endHomeBtn');
      await page.waitForSelector('.shard-fly', { state: 'attached' });
      await page.click('#mapBackBtn');
      await page.waitForSelector('#startScreen.show');
      const left = await ev(page, () => document.querySelectorAll('.shard-fly, .shard-pending').length);
      assert(left === 0, 'flight leftovers: ' + left);
      await ctx.close();
      return `veil=${during.tx} cell="${cls}"`;
    });

    await scenario(bname, '14 transitions reduced: no veil, no flight, instant board', async () => {
      const { ctx, page } = await newPage(browser, bname, 's14r', { width: 1366, height: 768 }, { reducedMotion: true });
      await startFresh(page, HTTP);
      await page.click('#mapBtn');
      await page.waitForSelector('#mapScreen.show');
      assert(await ev(page, () => !document.body.dataset.tx && !document.querySelector('.screen-veil.go')), 'veil in reduced');
      const inFlight = await ev(page, () => {
        window.__SUN.beginLevel('1-01'); // поле строится синхронно, до первого await
        return [...document.querySelectorAll('.gem')].filter(g => g.style.transitionDelay).length;
      });
      await waitStarted(page);
      assert(inFlight === 0, 'gems with wave delay: ' + inFlight);
      await forceWin(page);
      await page.waitForTimeout(600);
      await page.click('#endHomeBtn');
      await page.waitForSelector('#mapScreen.show');
      assert(await ev(page, () => document.querySelectorAll('.shard-fly').length === 0), 'flight in reduced');
      await ctx.close();
      return 'ok';
    });

    await scenario(bname, '15 priest portrait: beside or above the text, never over it', async () => {
      const notes = [];
      // [ширина, высота, должен ли портрет быть виден]
      const sizes = [[1366, 768, true], [1920, 1080, true], [1024, 768, true], [390, 844, true], [360, 740, true], [360, 640, true], [844, 390, false]];
      for (const [width, height, shown] of sizes) {
        const { ctx, page } = await newPage(browser, bname, 's15-' + width, { width, height });
        await startFresh(page, HTTP);
        await ev(page, () => { window.Story.play(window.Story.PROLOGUE_ID, window.Story.sceneLines(window.Story.PROLOGUE_ID)); });
        await page.waitForSelector('#storyScreen.show');
        await page.waitForFunction(() => document.getElementById('storyText').classList.contains('shown'));
        await page.waitForTimeout(700); // плита доехала
        const m = await ev(page, () => {
          const rect = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
          const img = document.querySelector('#storyScreen .story-portrait');
          return {
            exists: !!img,
            alt: img ? img.getAttribute('alt') : null,
            loaded: img ? img.complete && img.naturalWidth > 0 : false,
            display: img ? getComputedStyle(img).display : '',
            portrait: img ? rect(img) : null,
            card: rect(document.querySelector('#storyScreen .story-card')),
            font: parseFloat(getComputedStyle(document.getElementById('storyText')).fontSize),
            btn: document.getElementById('storyNextBtn').offsetHeight,
            btnFont: parseFloat(getComputedStyle(document.getElementById('storyNextBtn')).fontSize),
            scrollX: document.documentElement.scrollWidth,
            vw: innerWidth,
            vh: innerHeight
          };
        });
        const tag = width + 'x' + height + ' ';
        assert(m.exists && m.alt === '' && m.loaded, tag + 'portrait present, decorative, loaded: ' + JSON.stringify(m));
        assert(m.font >= 28 && m.btn >= 56 && m.btnFont >= 20, tag + 'sizes: ' + JSON.stringify(m));
        assert(m.scrollX <= m.vw, tag + 'horizontal scroll ' + m.scrollX);
        assert(m.card.t >= 0 && m.card.b <= m.vh + 0.5, tag + 'card off screen: ' + JSON.stringify(m.card));
        if (shown) {
          const p = m.portrait, c = m.card;
          assert(m.display !== 'none' && p.w > 100 && p.h > 100, tag + 'portrait too small: ' + JSON.stringify(p));
          assert(p.l >= 0 && p.t >= 0 && p.r <= m.vw + 0.5 && p.b <= m.vh + 0.5, tag + 'portrait off screen: ' + JSON.stringify(p));
          const overlaps = p.l < c.r - 0.5 && p.r > c.l + 0.5 && p.t < c.b - 0.5 && p.b > c.t + 0.5; // встык — не наложение (дробные пиксели)
          assert(!overlaps, tag + 'portrait over the card: ' + JSON.stringify({ p, c }));
          notes.push(tag + Math.round(p.w) + 'x' + Math.round(p.h));
        } else {
          assert(m.display === 'none', tag + 'portrait should be hidden, display=' + m.display);
          notes.push(tag + 'hidden');
        }
        // Самые длинные фразы: кнопки и портрет остаются на экране
        const lines = await ev(page, () => {
          const S = window.Story, out = []; let maxCard = 0, count = 0;
          const ids = [S.PROLOGUE_ID, ...window.Campaign.lands().flatMap(l => [l.id + '-intro', l.id + '-outro'])];
          const text = document.getElementById('storyText');
          const inside = el => { const b = el.getBoundingClientRect(); return b.top >= -0.5 && b.left >= -0.5 && b.bottom <= innerHeight + 0.5 && b.right <= innerWidth + 0.5; };
          const img = document.querySelector('#storyScreen .story-portrait');
          for (const id of ids) for (const line of S.sceneLines(id) || []) {
            text.textContent = line;
            const card = document.querySelector('#storyScreen .story-card').getBoundingClientRect();
            const p = img.getBoundingClientRect();
            const visible = getComputedStyle(img).display !== 'none';
            maxCard = Math.max(maxCard, card.height); count++;
            const bad = [];
            if (!inside(document.getElementById('storyNextBtn'))) bad.push('next');
            if (!inside(document.getElementById('storySkipBtn'))) bad.push('skip');
            if (visible && !inside(img)) bad.push('portrait');
            if (visible && p.left < card.right - 0.5 && p.right > card.left + 0.5 && p.top < card.bottom - 0.5 && p.bottom > card.top + 0.5) bad.push('overlap');
            if (bad.length) out.push(id + ': ' + bad.join(',') + ' h=' + Math.round(p.height) + ' cardH=' + Math.round(card.height) + ' "' + line.slice(0, 24) + '"');
          }
          return { out, maxCard: Math.round(maxCard), count };
        });
        assert(lines.count >= 10 && lines.out.length === 0, tag + 'long lines: ' + lines.count + ' ' + lines.out.join(' | '));
        notes[notes.length - 1] += ' maxCard=' + lines.maxCard;
        await ctx.close();
      }
      // С диска портрет тоже грузится
      const { ctx, page } = await newPage(browser, bname, 's15-file');
      await startFresh(page, FILE);
      await page.waitForFunction(() => { const i = document.querySelector('#storyScreen .story-portrait'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 });
      await ctx.close();
      return notes.join('; ');
    });

    await scenario(bname, '16 land 3 plates: plates on board and in goals, lift, reshuffle, retry, phone, reduced', async () => {
      const notes = [];
      // Следит за #plates: была ли у какой-нибудь плиты метка lift
      const watchLift = (page) => ev(page, () => {
        window.__liftSeen = false;
        if (window.__liftObs) window.__liftObs.disconnect();
        const check = n => { if (n.nodeType === 1 && n.classList.contains('lift')) window.__liftSeen = true; };
        window.__liftObs = new MutationObserver(list => list.forEach(m => {
          check(m.target);
          m.addedNodes.forEach(check);
        }));
        window.__liftObs.observe(document.getElementById('plates'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
      });
      const platesDom = (page) => ev(page, () => ({
        all: document.querySelectorAll('#plates .gold-plate').length,
        live: document.querySelectorAll('#plates .gold-plate:not(.lift)').length,
        lifting: document.querySelectorAll('#plates .gold-plate.lift').length,
        state: __SUN.plates().length
      }));
      const chipOf = (page) => ev(page, () => {
        const chips = document.querySelectorAll('.goal-chip.goal-plates');
        return { n: chips.length, text: chips[0] ? chips[0].textContent.replace(/\s+/g, ' ').trim() : '' };
      });

      // ---- 3-01: 8 плит, чип «Плиты 0 / 8», подсказка про плиты ----
      const key = 's16';
      const { page } = await newPage(browser, bname, key);
      await startFresh(page, HTTP);
      await ev(page, () => { window.__SUN.start('3-01'); });
      await waitStarted(page);
      await page.waitForTimeout(300);
      const d0 = await platesDom(page);
      assert(d0.all === 8 && d0.state === 8, '3-01 plates: ' + JSON.stringify(d0));
      const c0 = await chipOf(page);
      assert(c0.n === 1 && c0.text.includes('Плиты') && c0.text.includes('0 / 8'), '3-01 chip: ' + JSON.stringify(c0));
      const hint = await page.textContent('#hintBar');
      assert(hint.includes('золотых плитах'), 'hint: ' + hint);
      // Фон земли 3: плита пещеры, без воды, луны и облаков
      const bdProbe = (pg) => ev(pg, () => {
        const l3 = document.querySelector('.theme-bg[data-theme="3"]');
        const plate = l3 && l3.querySelector('.bd-plate');
        return {
          land: document.body.dataset.land,
          on: !!l3 && l3.classList.contains('on'),
          stage: !!(l3 && l3.querySelector('.bd-stage')),
          plateSrc: plate ? plate.src : '',
          plateW: plate ? plate.naturalWidth : 0,
          extra: l3 ? l3.querySelectorAll('.bd-wf, .bd-mist, .bd-moon, .bd-cloud-track').length : -1,
          hb: document.body.classList.contains('has-backdrop')
        };
      });
      await page.waitForFunction(() => { const l = document.querySelector('.theme-bg[data-theme="3"] .bd-plate'); return l && l.naturalWidth > 0; }, null, { timeout: 15000 });
      const bd3 = await bdProbe(page);
      assert(bd3.land === '3' && bd3.on && bd3.stage && bd3.hb, '3-01 backdrop: ' + JSON.stringify(bd3));
      assert(/assets\/backdrop\/land3\/plate\.webp$/.test(bd3.plateSrc) && bd3.plateW === 1672, '3-01 plate: ' + bd3.plateSrc + ' ' + bd3.plateW);
      assert(bd3.extra === 0, '3-01 backdrop has water/moon/clouds layers: ' + bd3.extra);
      notes.push('backdrop plate ' + bd3.plateW + 'px');
      await shot(page, bname, 'desktop-plates-level');

      // ---- strike: ряд 3 снимает плиты строки 3, снятые уходят за 800 мс ----
      await watchLift(page);
      await ev(page, async () => { await __SUN.strike(3, 2, 'line', 'row'); });
      await page.waitForFunction(() => !window.__SUN.state.busy, null, { timeout: 15000 });
      const left = await ev(page, () => __SUN.plates());
      assert(!left.some(([r]) => r === 3), 'row 3 plates left: ' + JSON.stringify(left));
      const d1 = await platesDom(page);
      assert(d1.live === left.length, 'plate nodes vs state: ' + JSON.stringify(d1));
      const c1 = await chipOf(page);
      assert(c1.text.includes((8 - left.length) + ' / 8'), 'chip after strike: ' + JSON.stringify(c1) + ' left ' + left.length);
      assert(await ev(page, () => window.__liftSeen), 'no plate got .lift');
      await page.waitForTimeout(850);
      const d1b = await platesDom(page);
      assert(d1b.lifting === 0 && d1b.all === d1b.state, 'lifted plates still in DOM after 800ms: ' + JSON.stringify(d1b));
      notes.push('strike left=' + left.length);

      // ---- reshuffle: плиты на месте ----
      const ps0 = JSON.stringify(await ev(page, () => __SUN.plates()));
      await ev(page, async () => { await __SUN.reshuffleBoard(false, true); __SUN.state.busy = false; });
      const ps1 = JSON.stringify(await ev(page, () => __SUN.plates()));
      assert(ps0 === ps1, 'plates changed on reshuffle: ' + ps0 + ' -> ' + ps1);
      const d2 = await platesDom(page);
      assert(d2.all === d2.state, 'plate nodes after reshuffle: ' + JSON.stringify(d2));

      // ---- retry: 3-02 — ровно 12 плит, без остатков 3-01 ----
      await ev(page, () => { window.__SUN.start('3-02'); });
      await waitStarted(page);
      await page.waitForTimeout(300);
      const d3 = await platesDom(page);
      assert(d3.all === 12 && d3.state === 12, '3-02 plates: ' + JSON.stringify(d3));

      // ---- no win while plates left ----
      const w = await ev(page, () => {
        const S = window.__SUN;
        S.state.goals.forEach(g => { if (g.type === 'color') g.got = g.need; });
        S.checkEnd();
        const ended1 = S.state.ended;
        S.state.goals.forEach(g => { if (g.type === 'plates') g.got = g.need; });
        S.checkEnd();
        return { ended1, ended2: S.state.ended, types: S.state.goals.map(g => g.type) };
      });
      assert(w.ended1 === false, 'won with plates left: ' + JSON.stringify(w));
      assert(w.ended2 === true, 'no win after plates done: ' + JSON.stringify(w));

      // ---- 1-01: плит нет ----
      await ev(page, () => { window.__SUN.start('1-01'); });
      await waitStarted(page);
      await page.waitForTimeout(300);
      const d4 = await ev(page, () => ({ plates: document.querySelectorAll('.gold-plate').length, chips: document.querySelectorAll('.goal-plates').length }));
      assert(d4.plates === 0 && d4.chips === 0, '1-01 has plates: ' + JSON.stringify(d4));
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      assert(errs.length === 0, 'console: ' + errs.join(' | '));

      // ---- phone 390×844: плита точно под камнем своей клетки ----
      {
        const { page: ph } = await newPage(browser, bname, 's16-phone', { width: 390, height: 844 });
        await startFresh(ph, HTTP);
        await ev(ph, () => { window.__SUN.start('3-01'); });
        await waitStarted(ph);
        await ph.waitForTimeout(1100); // волна появления камней закончилась
        const a = await ev(ph, () => {
          const p = document.querySelector('#plates .gold-plate');
          const g = document.querySelector(`#tiles .gem[data-r="${p.dataset.r}"][data-c="${p.dataset.c}"]`);
          const b = e => { const x = e.getBoundingClientRect(); return { x: x.x, y: x.y, w: x.width, h: x.height }; };
          return { cell: [p.dataset.r, p.dataset.c], plate: b(p), gem: g ? b(g) : null };
        });
        assert(a.gem && Math.abs(a.plate.x - a.gem.x) <= 2 && Math.abs(a.plate.y - a.gem.y) <= 2, 'phone align: ' + JSON.stringify(a));
        await shot(ph, bname, 'mobile-plates-level');
        const errsPh = (consoleLog[bname + '/s16-phone'] || []).filter(l => !/warning/.test(l));
        assert(errsPh.length === 0, 'phone console: ' + errsPh.join(' | '));
        notes.push('phone dx=' + (a.plate.x - a.gem.x).toFixed(2) + ' dy=' + (a.plate.y - a.gem.y).toFixed(2));

        // ---- пять целей (3-20) на телефоне: подсказка над панелью кнопок,
        // поле целиком в окне, страница не длиннее, чем с четырьмя целями (3-17).
        // Счётчики двузначные («41 / 42»): с ними чипы шире, чем в начале уровня.
        const layout = async (lvl, wide) => {
          await ev(ph, l => { window.__SUN.start(l); }, lvl);
          await waitStarted(ph);
          await ph.waitForTimeout(400);
          if (wide) await ev(ph, () => { __SUN.state.goals.forEach(g => { g.got = g.need - 1; }); __SUN.updateGoals(); });
          await ph.waitForTimeout(100);
          return ev(ph, () => {
            const b = s => { const c = document.querySelector(s).getBoundingClientRect(); return { t: c.top, b: c.bottom, l: c.left, r: c.right }; };
            return { chips: document.querySelectorAll('.goal-chip').length, frame: b('.board-frame'), hint: b('#hintBar'), bar: b('.tool-row'), sh: document.scrollingElement.scrollHeight, iw: innerWidth, ih: innerHeight };
          });
        };
        for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
          await ph.setViewportSize(vp);
          const tag = vp.width + 'x' + vp.height + ' ';
          const four = await layout('3-17', true);
          const fresh = await layout('3-20', false);
          const five = await layout('3-20', true);
          assert(four.chips === 4 && five.chips === 5, tag + 'chips: ' + four.chips + '/' + five.chips);
          const f = five.frame;
          assert(f.t >= 0 && f.l >= -1 && f.r <= five.iw + 1 && f.b <= five.ih, tag + '3-20 board outside window: ' + JSON.stringify(f));
          assert(f.b <= five.hint.t + 1, tag + '3-20 board over hint: ' + JSON.stringify({ f, hint: five.hint }));
          assert(five.hint.b <= five.bar.t + 1, tag + '3-20 hint under button bar: ' + JSON.stringify({ hint: five.hint, bar: five.bar }));
          assert(five.sh <= four.sh, tag + '3-20 page taller than 3-17: ' + five.sh + ' > ' + four.sh);
          assert(Math.abs(fresh.frame.t - five.frame.t) <= 1, tag + 'board jumps when counts get two digits: ' + fresh.frame.t + ' -> ' + five.frame.t);
          if (vp.width === 390) await shot(ph, bname, 'mobile-five-goals');
          notes.push(tag + 'five goals frame ' + Math.round(f.r - f.l) + ' hint.b ' + Math.round(five.hint.b) + ' bar.t ' + Math.round(five.bar.t) + ' sh ' + five.sh + '/' + four.sh);
        }
      }

      // ---- reduced: снятая плита исчезает сразу, без lift ----
      {
        const { page: rd } = await newPage(browser, bname, 's16-reduced', { width: 1366, height: 768 }, { reducedMotion: true });
        await startFresh(rd, HTTP);
        await ev(rd, () => { window.__SUN.start('3-01'); });
        await waitStarted(rd);
        await rd.waitForTimeout(300);
        assert(await ev(rd, () => matchMedia('(prefers-reduced-motion: reduce)').matches), 'browser did not apply reducedMotion');
        await watchLift(rd);
        await ev(rd, async () => { await __SUN.strike(3, 2, 'line', 'row'); });
        await rd.waitForFunction(() => !window.__SUN.state.busy, null, { timeout: 15000 });
        const r = await platesDom(rd);
        const seen = await ev(rd, () => window.__liftSeen);
        assert(!seen, 'plate got .lift in reduced');
        assert(r.state < 8 && r.all === r.state && r.lifting === 0, 'reduced plates: ' + JSON.stringify(r));
        const errsRd = (consoleLog[bname + '/s16-reduced'] || []).filter(l => !/warning/.test(l));
        assert(errsRd.length === 0, 'reduced console: ' + errsRd.join(' | '));
        notes.push('reduced left=' + r.state);
      }
      // ---- file://: плита пещеры видна ----
      {
        const { page: fp } = await newPage(browser, bname, 's16-file');
        await startFresh(fp, FILE);
        await ev(fp, () => { window.__SUN.start('3-01'); });
        await waitStarted(fp);
        await fp.waitForFunction(() => { const l = document.querySelector('.theme-bg[data-theme="3"] .bd-plate'); return l && l.naturalWidth > 0; }, null, { timeout: 15000 });
        const bf = await bdProbe(fp);
        assert(bf.on && bf.plateW === 1672 && bf.extra === 0, 'file:// backdrop: ' + JSON.stringify(bf));
        const errsF = (consoleLog[bname + '/s16-file'] || []).filter(l => !/warning/.test(l));
        assert(errsF.length === 0, 'file console: ' + errsF.join(' | '));
        notes.push('file:// plate ' + bf.plateW + 'px');
      }
      return notes.join('; ');
    });

    await scenario(bname, '17 land 4 boulders: board, goals, crack, break, refuse, reshuffle, retry, phone, reduced', async () => {
      const notes = [];
      const rocks = (page) => ev(page, () => {
        const S = window.__SUN;
        const holes = [];
        S.state.grid.forEach((row, r) => row.forEach((g, c) => {
          const rock = S.state.boulders[r][c] > 0;
          if (!!g === rock) holes.push([r, c, rock ? 'gem on boulder' : 'empty']);
        }));
        return {
          live: document.querySelectorAll('#boulders .boulder:not(.break)').length,
          all: document.querySelectorAll('#boulders .boulder').length,
          state: S.boulders(),
          holes
        };
      });
      const chipOf = (page) => ev(page, () => {
        const chips = document.querySelectorAll('.goal-chip.goal-boulders');
        return { n: chips.length, text: chips[0] ? chips[0].textContent.replace(/\s+/g, ' ').trim() : '' };
      });
      let stage = 'start';
      const idle = async (page) => {
        try {
          await page.waitForFunction(() => !window.__SUN.state.busy, null, { timeout: 15000 });
        } catch (e) {
          const st = await ev(page, () => ({ busy: __SUN.state.busy, running: __SUN.state.running, b: __SUN.boulders() })).catch(() => null);
          throw new Error('busy at ' + stage + ': ' + JSON.stringify(st));
        }
      };
      const hpOf = (page, r, c) => ev(page, ([r, c]) => {
        const n = document.querySelector(`#boulders .boulder[data-r="${r}"][data-c="${c}"]:not(.break)`);
        return n ? n.dataset.hp : null;
      }, [r, c]);
      // Центр клетки на экране
      const cellXY = (page, r, c) => ev(page, ([r, c]) => {
        const b = document.getElementById('tiles').getBoundingClientRect();
        return { x: b.left + (c + 0.5) * b.width / 8, y: b.top + (r + 0.5) * b.height / 8, step: b.width / 8 };
      }, [r, c]);
      const gridIds = (page) => ev(page, () => window.__SUN.state.grid.map(row => row.map(g => (g ? g.id : 0)).join(',')).join(';'));

      // ---- 4-01: валуны на поле и в целях, клетки валунов пусты ----
      const key = 's17';
      const { ctx, page } = await newPage(browser, bname, key);
      await startFresh(page, HTTP);
      await ev(page, () => { window.__SUN.start('4-01'); });
      await waitStarted(page);
      await page.waitForTimeout(300);
      const want = await ev(page, () => window.Campaign.level('4-01').boulders.length);
      const d0 = await rocks(page);
      assert(d0.live === want && d0.state.length === want && d0.holes.length === 0, '4-01 boulders: ' + JSON.stringify(d0));
      const c0 = await chipOf(page);
      assert(c0.n === 1 && c0.text.includes('Валуны') && c0.text.includes('0 / ' + want), '4-01 chip: ' + JSON.stringify(c0));
      const hint = await page.textContent('#hintBar');
      assert(hint.includes('валунами'), 'hint: ' + hint);
      await shot(page, bname, 'desktop-boulders-level');

      // ---- прямой удар: молния по строке 4 трескает валун 2 -> 1, потом разбивает ----
      stage = 'crack';
      // Каскады после удара могут задеть валун ещё раз, поэтому проверяем, что
      // прочность только убывает и валун разбит не больше чем за 3 удара
      await ev(page, () => window.__SUN.setBoulders([[4, 4, 3]]));
      await idle(page);
      const hpSeq = [await hpOf(page, 4, 4)];
      for (let i = 0; i < 3 && hpSeq[hpSeq.length - 1] !== null; i++) {
        await ev(page, async () => { await window.__SUN.strike(4, 0, 'line', 'row'); });
        await idle(page);
        hpSeq.push(await hpOf(page, 4, 4));
      }
      const nums = hpSeq.map(v => (v === null ? 0 : Number(v)));
      assert(nums[0] === 3 && nums.every((v, i) => i === 0 || v < nums[i - 1]) && nums[nums.length - 1] === 0,
        'hp sequence ' + JSON.stringify(hpSeq));
      notes.push('hp ' + nums.join('>'));
      await page.waitForTimeout(850);
      const d1 = await rocks(page);
      assert(d1.all === 0 && d1.state.length === 0 && d1.holes.length === 0, 'after break: ' + JSON.stringify(d1));
      const c1 = await chipOf(page);
      assert(c1.text.includes('1 / ' + want), 'chip after break: ' + JSON.stringify(c1));

      stage = 'neighbour';
      // ---- соседство: ряд под валуном трескает его ----
      await ev(page, () => window.__SUN.setBoulders([[2, 2, 1]]));
      await idle(page);
      await ev(page, async () => { await window.__SUN.strike(3, 0, 'line', 'row'); });
      await idle(page);
      await page.waitForTimeout(850);
      const d2 = await rocks(page);
      assert(d2.state.length === 0 && d2.holes.length === 0, 'neighbour crack: ' + JSON.stringify(d2));
      notes.push('neighbour break');

      stage = 'refuse';
      // ---- отказ: касание валуна и свайп с камня на валун не меняют поле ----
      await ev(page, () => window.__SUN.setBoulders([[3, 3, 2]]));
      await idle(page);
      const before = await gridIds(page);
      const p = await cellXY(page, 3, 3);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(200);
      const hintTap = await page.textContent('#hintBar');
      assert(hintTap.includes('Валун не сдвинуть'), 'tap hint: ' + hintTap);
      await page.waitForTimeout(450);
      const q = await cellXY(page, 3, 2);
      await page.mouse.move(q.x, q.y);
      await page.mouse.down();
      await page.mouse.move(q.x + q.step * 0.4, q.y, { steps: 3 });
      await page.mouse.move(q.x + q.step * 0.9, q.y, { steps: 3 });
      await page.mouse.up();
      await idle(page);
      await page.waitForTimeout(200);
      assert(await gridIds(page) === before, 'grid changed after boulder tap/swipe');
      assert(await hpOf(page, 3, 3) === '2', 'refusal must not crack the boulder');
      notes.push('refuse tap+swipe');

      stage = 'reshuffle';
      // ---- перемешивание: валуны на месте, их клетки пусты ----
      await ev(page, async () => { await window.__SUN.reshuffleBoard(false, true); window.__SUN.state.busy = false; });
      await idle(page);
      const d3 = await rocks(page);
      assert(JSON.stringify(d3.state) === JSON.stringify([[3, 3, 2]]) && d3.holes.length === 0, 'reshuffle: ' + JSON.stringify(d3));

      stage = 'wingate';
      // ---- нельзя выиграть, пока стоят валуны ----
      await ev(page, () => { window.__SUN.start('4-02'); });
      await waitStarted(page);
      await idle(page);
      const want2 = await ev(page, () => window.Campaign.level('4-02').boulders.length);
      const d4 = await rocks(page);
      assert(d4.live === want2 && d4.holes.length === 0, 'retry 4-02 without leftovers: ' + JSON.stringify(d4));
      const ended = await ev(page, () => {
        const S = window.__SUN;
        S.state.goals.forEach(g => { if (g.type === 'color') g.got = g.need; });
        S.checkEnd();
        const a = S.state.ended;
        S.state.goals.forEach(g => { g.got = g.need; });
        S.checkEnd();
        return [a, S.state.ended];
      });
      assert(ended[0] === false && ended[1] === true, 'win gate: ' + JSON.stringify(ended));

      // ---- земли 1–3 без валунов ----
      await ev(page, () => { window.__SUN.start('1-01'); });
      await waitStarted(page);
      const d5 = await ev(page, () => ({ nodes: document.querySelectorAll('#boulders .boulder').length, chip: document.querySelectorAll('.goal-boulders').length }));
      assert(d5.nodes === 0 && d5.chip === 0, '1-01 has boulders: ' + JSON.stringify(d5));
      const errs = (consoleLog[bname + '/' + key] || []).filter(l => !/warning/.test(l));
      await ctx.close();
      assert(errs.length === 0, 'console: ' + errs.join(' | '));

      // ---- телефон 390×844: валун совпадает с клеткой ----
      {
        const { ctx: pc, page: pp } = await newPage(browser, bname, 's17-phone', { width: 390, height: 844 });
        await startFresh(pp, HTTP);
        await ev(pp, () => { window.__SUN.start('4-01'); });
        await waitStarted(pp);
        await pp.waitForTimeout(300);
        const box = await ev(pp, () => {
          const n = document.querySelector('#boulders .boulder');
          const r = +n.dataset.r, c = +n.dataset.c;
          const b = n.getBoundingClientRect();
          const t = document.getElementById('tiles').getBoundingClientRect();
          return { dx: Math.abs(b.left - (t.left + c * t.width / 8)), dy: Math.abs(b.top - (t.top + r * t.height / 8)), w: b.width, cell: t.width / 8 };
        });
        assert(box.dx < 2 && box.dy < 2 && Math.abs(box.w - box.cell) < 2, 'phone align: ' + JSON.stringify(box));
        await shot(pp, bname, 'phone-boulders-level');
        await pc.close();
        notes.push('phone cell ' + box.cell.toFixed(1) + 'px');
      }

      // ---- «уменьшить движение»: разбитый валун исчезает сразу ----
      {
        const { ctx: rc, page: rp } = await newPage(browser, bname, 's17-reduced', undefined, { reducedMotion: true });
        await startFresh(rp, HTTP);
        await ev(rp, () => { window.__SUN.start('4-01'); });
        await waitStarted(rp);
        await ev(rp, () => window.__SUN.setBoulders([[4, 4, 1]]));
        await rp.waitForFunction(() => !window.__SUN.state.busy, null, { timeout: 15000 });
        await ev(rp, async () => { await window.__SUN.strike(4, 0, 'line', 'row'); });
        await rp.waitForFunction(() => !window.__SUN.state.busy, null, { timeout: 15000 });
        const n = await ev(rp, () => document.querySelectorAll('#boulders .boulder').length);
        assert(n === 0, 'reduced: boulder nodes left ' + n);
        await rc.close();
      }
      return notes.join('; ');
    });

    await scenario(bname, 'file:// smoke (load, no errors, level starts, save persists)', async () => {
      const { ctx, page } = await newPage(browser, bname, 'file-smoke');
      await startFresh(page, FILE);
      await page.click('#playBtn');
      await waitStarted(page);
      const d = await dbg(page);
      assert(d.levelId === '1-01', 'level');
      // Шрифт заголовков загрузился с диска (проверка по кириллице)
      const fontOk = await ev(page, async () => {
        await document.fonts.load('20px "Philosopher"', 'Хранитель');
        await document.fonts.ready;
        // check() даёт true и когда такого шрифта вовсе нет, поэтому ещё смотрим, что лицо объявлено и загружено
        const faceLoaded = [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Philosopher' && f.status === 'loaded');
        return faceLoaded && document.fonts.check('20px "Philosopher"', 'Хранитель');
      });
      assert(fontOk === true, 'Philosopher face not loaded from file:// (or check failed)');
      // Лист огня и чаша жаровни грузятся с диска: фон .fire-calm / .fire-flare и img.brazier-bowl
      const fire = await ev(page, async () => {
        const urlOf = sel => { const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(document.querySelector(sel)).backgroundImage); return m && m[1]; };
        const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth); im.onerror = () => res(0); im.src = src; });
        const calm = urlOf('.fire-calm'), flare = urlOf('.fire-flare');
        const bowl = document.querySelector('img.brazier-bowl');
        return { calm, flare, calmW: calm ? await load(calm) : 0, flareW: flare ? await load(flare) : 0, bowlW: bowl.complete ? bowl.naturalWidth : 0 };
      });
      assert(fire.calm && fire.calm.startsWith('file:') && fire.calmW > 0, 'fire-calm sheet not loaded: ' + JSON.stringify(fire));
      assert(fire.flare && fire.flareW > 0, 'fire-flare sheet not loaded: ' + JSON.stringify(fire));
      assert(fire.bowlW > 0, 'brazier bowl not loaded: ' + JSON.stringify(fire));
      // Лист взрыва бомбы (css/fx.css) с диска: адрес — из правила .fx-bomb
      const bombW = await ev(page, async () => {
        const probe = document.createElement('div');
        probe.className = 'fx-strike fx-bomb';
        probe.style.animation = 'none';
        document.getElementById('fx').appendChild(probe);
        const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(probe).backgroundImage);
        probe.remove();
        if (!m || !m[1].startsWith('file:')) return 0;
        return new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth); im.onerror = () => res(0); im.src = m[1]; });
      });
      assert(bombW > 0, 'bomb sheet not loaded from file://');
      // Все спрайты ударов — по тем же адресам, что предзагружает Fx (js/visuals-fx.js)
      const strikeSprites = await ev(page, async () => {
        const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth); im.onerror = () => res(0); im.src = src; });
        const sizes = {};
        for (const n of ['bomb', 'beam-turquoise', 'ray-gold', 'wave-jade', 'glow-cores']) sizes[n] = await load('assets/fx/' + n + '.webp');
        return sizes;
      });
      assert(Object.values(strikeSprites).every(w => w > 0), 'strike sprites not loaded from file://: ' + JSON.stringify(strikeSprites));
      // Живой фон земли 1 с диска: пять картинок грузятся, маска воды задана.
      // Маска — data: URI (assets/backdrop/land1/water-mask.js): CSS-маску по
      // file:// Chromium и WebKit не грузят (CORS), и струи легли бы на весь прямоугольник.
      await page.waitForFunction(() => document.body.classList.contains('has-backdrop'));
      const bd = await ev(page, async () => {
        const land = Campaign.lands().find(l => l.id === 1).backdrop;
        const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth); im.onerror = () => res(0); im.src = src; });
        const sizes = {};
        for (const k of ['plate', 'water', 'mask', 'moon', 'clouds']) sizes[k] = await load(land[k]);
        const cs = getComputedStyle(document.querySelector('.theme-bg.on .bd-wf'));
        const mask = cs.maskImage && cs.maskImage !== 'none' ? cs.maskImage : cs.webkitMaskImage;
        return { sizes, mask: String(mask).slice(0, 40) };
      });
      assert(Object.values(bd.sizes).every(w => w > 0), 'backdrop images not loaded: ' + JSON.stringify(bd.sizes));
      assert(bd.mask && bd.mask !== 'none' && bd.mask !== 'undefined', 'no mask on .bd-wf: ' + bd.mask);
      assert(bd.mask.startsWith('url("data:'), 'mask is not a data: URI (file:// CORS): ' + bd.mask);
      // Земля 2 (без воды): плита с диска, луна и облака — общие файлы земли 1
      const bd2 = await ev(page, async () => {
        const land = Campaign.lands().find(l => l.id === 2).backdrop;
        const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth); im.onerror = () => res(0); im.src = src; });
        const sizes = {};
        for (const k of ['plate', 'moon', 'clouds']) sizes[k] = await load(land[k]);
        return { sizes, water: !!(land.water || land.mask || land.wf), waterfall: land.waterfall };
      });
      assert(Object.values(bd2.sizes).every(w => w > 0), 'land 2 backdrop images not loaded: ' + JSON.stringify(bd2.sizes));
      assert(!bd2.water && bd2.waterfall === false, 'land 2 backdrop must have no water: ' + JSON.stringify(bd2));
      const bdErr = (consoleLog[bname + '/file-smoke'] || []).filter(l => /assets\/backdrop\//.test(l) || /CORS|Access-Control/.test(l));
      assert(!bdErr.length, 'backdrop load errors: ' + bdErr.join(' | '));
      await playRealMove(page);
      await forceWin(page);
      const saved = await ev(page, () => localStorage.getItem('sun-keeper-save'));
      assert(saved && saved.includes('1-01'), 'file:// save not written');
      await page.reload();
      await page.waitForSelector('#startScreen.show');
      const kept = await ev(page, () => !!Game.getSave().levels['1-01']);
      await ctx.close();
      return `file:// level=${d.levelId} fontPhilosopher=${fontOk} fireSheet=${fire.calmW}px bombSheet=${bombW}px strikeSprites=${JSON.stringify(strikeSprites)} bowl=${fire.bowlW}px backdrop=${JSON.stringify(bd.sizes)} mask=data: land2=${JSON.stringify(bd2.sizes)} savePersistsAfterReload=${kept}`;
    });
  } finally { await browser.close(); }
}

(async () => {
  const which = process.argv[2] || 'all';
  const targets = [];
  if (which === 'all' || which === 'firefox') targets.push([firefox, 'firefox']);
  if (which === 'all' || which === 'webkit') targets.push([webkit, 'webkit']);
  if (which === 'all' || which === 'chromium') targets.push([chromium, 'chromium']);
  for (const [bt, bname] of targets) {
    await suite(bt, bname, HTTP);
    await smokeFile(bt, bname);
  }
  fs.writeFileSync(path.join(OUT, 'results-' + which + '.json'), JSON.stringify({ results, consoleLog }, null, 2));
  console.log('\n=== CONSOLE ===');
  for (const [k, v] of Object.entries(consoleLog)) if (v.length) console.log(k, '\n  ' + v.join('\n  '));
  console.log('\n=== SUMMARY ===');
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.browser}] ${r.scenario} :: ${r.notes}`));
  // Любой упавший сценарий — ненулевой код выхода (для скриптов и CI)
  // Пустой список результатов (не запустилось ни одного сценария) — тоже провал
  process.exitCode = (results.length === 0 || results.some(r => !r.ok)) ? 1 : 0;
})();
