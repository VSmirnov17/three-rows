const { firefox, chromium } = require('playwright');
const fs = require('fs');
const ROOT = '/Users/vladimirsmirnov/opencode-projects/deepseek/three-rows/';
const B = 'art-src/phase2/backdrop/spike/';
const OUT = process.argv[2];
const geom = JSON.parse(fs.readFileSync(ROOT + B + 'geom.json'));
const css = fs.readFileSync(ROOT + B + 'spike.css', 'utf8').replace('url("clouds.webp")', `url("${B}clouds.webp")`)
  + `:root{--bd-mask:url("${B}wf-mask.png");--bd-tex:url("${B}wf-tex.png");--tile:calc(max(100vh, 56.25vw) * ${geom.texH / geom.plateH});}`;
const VPS = (process.argv[3] || '1366x768').split(',').map(s => s.split('x').map(Number));
const video = process.argv[4] === 'video';
(async () => {
  const b = await chromium.launch({ args: ['--mute-audio'] });
  for (const [w, h] of VPS) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(video ? { recordVideo: { dir: OUT + '/vid', size: { width: w, height: h } } } : {}) });
    await ctx.addInitScript(() => { localStorage.setItem('sun-treasures-muted', '1'); localStorage.setItem('sun-keeper-fx', 'full'); });
    const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    await p.goto('http://localhost:8766/index.html?debug');
    await p.waitForSelector('#startScreen.show'); await p.click('#playBtn');
    await p.waitForSelector('#storyScreen.show'); await p.waitForTimeout(500); await p.click('#storySkipBtn');
    for (let i = 0; i < 40; i++) { const st = await p.evaluate(() => ({ s: document.getElementById('storyScreen').classList.contains('show'), st: !!(window.__SUN && __SUN.state.started) })); if (st.st) break; if (st.s) await p.click('#storySkipBtn', { timeout: 1000 }).catch(() => {}); await p.waitForTimeout(200); }
    await p.addStyleTag({ content: css });
    await p.evaluate((g) => { window.__BD_GEOM = g; }, geom);
    await p.addScriptTag({ path: ROOT + B + 'spike.js' });
    await p.waitForTimeout(video ? 9000 : 2500);
    await p.screenshot({ path: `${OUT}/spike-${w}x${h}.png` });
    if (process.argv[5] === 'bare') { await p.addStyleTag({ content: '.game-shell{visibility:hidden} .fire-light,.fire-sparks{display:none}' }); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/spike-bare-${w}x${h}.png` }); }
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
