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

async function newPage(browser, bname, label, viewport, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: viewport || { width: 1366, height: 768 }, ...(opts.reducedMotion ? { reducedMotion: 'reduce' } : {}) });
  await ctx.addInitScript((fxFull) => {
    try { localStorage.setItem('sun-treasures-muted', '1'); } catch (e) {}
    // огонь: полный режим, чтобы медленный headless не включил слабый (без искр) сам
    if (fxFull) { try { localStorage.setItem('sun-keeper-fx', 'full'); } catch (e) {} }
  }, !!opts.fxFull);
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
  try { const notes = await fn(); rec(bname, name, true, notes); }
  catch (e) { rec(bname, name, false, e.message.split('\n')[0]); }
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
      await page.waitForTimeout(400);
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
    const BUSY_SEL = '.hud-plaque, .plate-btn, .board-frame, .brazier-bowl, .brazier-fire, .sun-stone, .hint-bar, .combo-badge';
    // Светлячки вне занятых мест (по __BD.busy() и по свежим прямоугольникам) с отступом 10 px
    const fliesCheck = (page) => ev(page, (sel) => {
      const pad = 10;
      const fresh = [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
      const rects = __BD.busy().concat(fresh.map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })));
      const flies = __BD.flies();
      const bad = flies.filter(p => rects.some(r => p.x > r.left - pad && p.x < r.right + pad && p.y > r.top - pad && p.y < r.bottom + pad));
      return { n: flies.length, bad: bad.map(p => Math.round(p.x) + ',' + Math.round(p.y)) };
    }, BUSY_SEL);
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
        notes.push(`flies ${fc.n} ok`);
        // То же после смены окна
        await page.setViewportSize({ width: vp.next[0], height: vp.next[1] });
        await page.waitForTimeout(1000);
        const fc2 = await fliesCheck(page);
        const m2 = await ev(page, () => document.body.dataset.bd);
        assert(!fc2.bad.length, `после смены окна на ${vp.next.join('x')} светлячки на занятых местах: ` + fc2.bad.join(' '));
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
  } finally {
    await browser.close();
  }
}

async function smokeFile(bt, bname) {
  const browser = await bt.launch(launchOpts(bname));
  try {
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
      return `file:// level=${d.levelId} fontPhilosopher=${fontOk} fireSheet=${fire.calmW}px bowl=${fire.bowlW}px backdrop=${JSON.stringify(bd.sizes)} mask=data: land2=${JSON.stringify(bd2.sizes)} savePersistsAfterReload=${kept}`;
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
