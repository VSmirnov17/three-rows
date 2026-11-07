const { firefox } = require('playwright');
const OUT = process.argv[2];
const CSS_DESK = `
.mk-brazier{--bh:clamp(84px,20vh,200px)!important;height:var(--bh)!important;margin-bottom:calc(var(--bh) * -0.22)!important;z-index:0!important}
.left-panel>.hud-plaque,.right-panel>.plate-btn,.right-panel>.info-pair{position:relative;z-index:2}
.mk-bowl{width:calc(var(--bh) * 0.82)!important}
.mk-fl{position:absolute;bottom:calc(var(--bh) * 0.44);left:50%;z-index:1;mix-blend-mode:screen}
.mk-fl.c{width:calc(var(--bh) * 0.72);transform:translateX(-50%)}
.right-panel .mk-fl.c{transform:translateX(-50%) scaleX(-1)}
.mk-fl.s1{height:calc(var(--bh) * 0.5);transform:translateX(-105%) scaleX(-1)}
.mk-fl.s2{height:calc(var(--bh) * 0.5);transform:translateX(5%)}
.mk-brazier{position:relative;flex:0 0 auto;height:clamp(84px,17vh,190px);margin-bottom:-22px;z-index:3;pointer-events:none}
.mk-bowl{position:absolute;left:50%;bottom:0;width:calc(var(--bh) * 0.95);transform:translateX(-50%);z-index:2}
.mk-flame{position:absolute;left:50%;bottom:calc(var(--bh) * 0.52);width:calc(var(--bh) * 0.86);transform:translateX(-50%);z-index:1}
.mk-brazier{--bh:clamp(84px,17vh,190px)}
.right-panel .mk-flame{transform:translateX(-50%) scaleX(-1)}
.mk-light{position:absolute;inset:0;pointer-events:none;z-index:1;mix-blend-mode:screen;opacity:.3;
 background:radial-gradient(circle at var(--lx) 9%, rgba(255,150,60,.55), transparent 32%),radial-gradient(circle at var(--rx) 9%, rgba(255,150,60,.55), transparent 32%)}
`;
const CSS_P1 = `
.board-frame{overflow:visible}
.mk-p1{position:absolute;top:-40px;width:64px;height:66px;z-index:6;pointer-events:none}
.mk-p1.l{left:-2px}.mk-p1.r{right:-2px}
.mk-p1 .mk-bowl{position:absolute;bottom:0;left:4px;width:56px;z-index:2}
.mk-p1 .mk-fl{position:absolute;bottom:20px;left:50%;z-index:1;mix-blend-mode:screen}
.mk-p1 .mk-fl.c{height:46px;transform:translateX(-50%)}
.mk-p1 .mk-fl.s1{height:36px;transform:translateX(-112%) scaleX(-1)}
.mk-p1 .mk-fl.s2{height:36px;transform:translateX(12%)}
.game-shell{row-gap:6px}
.board-area{margin-top:30px}
`;
const CSS_P2 = `
.board-frame{overflow:visible}
.mk-glow{position:absolute;top:-40px;width:120px;height:110px;z-index:6;pointer-events:none;mix-blend-mode:screen;
 background:radial-gradient(ellipse at 50% 60%, rgba(255,160,70,.55), rgba(255,110,30,.18) 45%, transparent 70%)}
.mk-glow.l{left:-50px}.mk-glow.r{right:-50px}
.mk-spark{position:absolute;width:3px;height:3px;border-radius:50%;background:#ffd27a;box-shadow:0 0 4px #ff9a3a;z-index:7}
`;
async function open(b, w, h) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => localStorage.setItem('sun-treasures-muted','1'));
  await p.goto('http://127.0.0.1:8791/?debug');
  await p.waitForFunction(() => window.__SUN && window.__SUN.state.grid && window.__SUN.state.grid[7] && window.__SUN.state.grid[7][7]);
  await p.evaluate(() => { window.__SUN.start('1-05'); });
  for (let i=0;i<60;i++){ const st = await p.evaluate(()=>({s:window.__SUN.state.started, story:document.getElementById('storyScreen').classList.contains('show')})); if(st.s)break; if(st.story) await p.click('#storySkipBtn').catch(()=>{}); await p.waitForTimeout(200);}
  await p.waitForTimeout(1200);
  return p;
}
const bowl = 'art-src/phase2/fire/mock-bowl.png', flame = 'art-src/phase2/fire/mock-flame.png';
const F = ['art-src/phase2/fire/mock-flame.png'];
(async () => {
  const b = await firefox.launch();
  for (const [w,h] of [[1366,768],[1366,650],[1920,1080]]) {
    const p = await open(b, w, h);
    await p.addStyleTag({ content: CSS_DESK });
    await p.evaluate(({bowl, flame, F}) => {
      for (const sel of ['.left-panel','.right-panel']) {
        const col = document.querySelector(sel);
        const d = document.createElement('div'); d.className='mk-brazier';
        d.innerHTML = `<img class="mk-fl c" src="${F[0]}"><img class="mk-bowl" src="${bowl}">`;
        col.prepend(d);
      }
      const shell = document.querySelector('.game-shell');
      const L = document.querySelector('.left-panel .mk-brazier').getBoundingClientRect(), R = document.querySelector('.right-panel .mk-brazier').getBoundingClientRect();
      const lt = document.createElement('div'); lt.className='mk-light';
      lt.style.setProperty('--lx', (L.x+L.width/2)+'px'); lt.style.setProperty('--rx', (R.x+R.width/2)+'px');
      shell.appendChild(lt);
    }, {bowl, flame, F});
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/braziers-desktop-${w}x${h}.png` });
    const sc = await p.evaluate(() => [document.scrollingElement.scrollHeight, innerHeight]);
    console.log('desk', w, h, 'scroll', sc);
    await p.close();
  }
  for (const v of ['p1','p2']) {
    const p = await open(b, 390, 844);
    await p.addStyleTag({ content: v === 'p1' ? CSS_P1 : CSS_P2 });
    await p.evaluate(({v, bowl, flame, F}) => {
      const fr = document.querySelector('.board-frame');
      for (const s of ['l','r']) {
        const d = document.createElement('div');
        if (v === 'p1') { d.className = 'mk-p1 ' + s; d.innerHTML = `<img class="mk-fl s1" src="${F[1]}"><img class="mk-fl s2" src="${F[2]}"><img class="mk-fl c" src="${F[0]}"><img class="mk-bowl" src="${bowl}">`; }
        else d.className = 'mk-glow ' + s;
        fr.appendChild(d);
      }
      if (v === 'p2') [[14,-30],[30,-52],[352,-38],[368,-60],[24,-70]].forEach(([x,y]) => { const s=document.createElement('i'); s.className='mk-spark'; s.style.left=x+'px'; s.style.top=y+'px'; fr.appendChild(s); });
    }, {v, bowl, flame, F});
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/braziers-${v}.png` });
    console.log(v, 'scroll', await p.evaluate(() => [document.scrollingElement.scrollHeight, innerHeight]));
    await p.close();
  }
  await b.close();
})();
