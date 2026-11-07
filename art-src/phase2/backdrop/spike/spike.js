/* ПРОБНИК (выбрасывается): живой фон поверх настоящей игры. Вставляется Playwright-ом. */
(() => {
  const BASE = window.__BD_BASE || 'art-src/phase2/backdrop/spike/';
  const G = window.__BD_GEOM; // {wf:{x,y,w,h} в долях плиты, tile: px высоты плитки текстуры}
  const jungle = document.querySelector('.jungle');
  const stage = document.createElement('div');
  stage.className = 'bd-stage';
  stage.innerHTML = `
    <img class="bd-plate" src="${BASE}plate.webp" alt="">
    <div class="bd-wf" style="left:${G.wf.x * 100}%;top:${G.wf.y * 100}%;width:${G.wf.w * 100}%;height:${G.wf.h * 100}%">
      <div class="bd-water bd-water-a"></div>
      <div class="bd-water bd-water-b"></div>
    </div>
    <div class="bd-mist" style="left:${(G.wf.x - G.wf.w * 0.6) * 100}%;top:${(G.wf.y + G.wf.h - 0.14) * 100}%;width:${G.wf.w * 2.6 * 100}%;height:22%"></div>`;
  jungle.appendChild(stage);

  const sky = document.createElement('div');
  sky.className = 'bd-sky';
  sky.innerHTML = `
    <div class="bd-moon-wrap"><div class="bd-halo"></div><img class="bd-moon" src="${BASE}moon.webp" alt=""></div>
    <div class="bd-clouds"><div class="bd-cloud-track"></div></div>`;
  jungle.appendChild(sky);

  const cv = document.createElement('canvas');
  cv.className = 'bd-flies';
  jungle.appendChild(cv);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, busy = [];
  const SEL = '.hud-plaque, .plate-btn, .board-frame, .brazier-bowl, .sun-stone, .hint-bar';
  function measure() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    busy = [...document.querySelectorAll(SEL)].map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
  }
  const free = (x, y) => !busy.some(r => x > r.left - 14 && x < r.right + 14 && y > r.top - 14 && y < r.bottom + 14);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const flies = [];
  function spawn(f) {
    for (let i = 0; i < 60; i++) { const x = rnd(4, W - 4), y = rnd(H * 0.15, H - 6); if (free(x, y)) { f.x = x; f.y = y; break; } }
    f.a = rnd(0, Math.PI * 2); f.v = rnd(5, 12); f.p = rnd(3.5, 6.5); f.t0 = rnd(0, 10); f.r = rnd(1.0, 1.7);
    return f;
  }
  measure();
  for (let i = 0; i < 16; i++) flies.push(spawn({}));
  addEventListener('resize', () => { measure(); flies.forEach(spawn); });
  setTimeout(measure, 1500);
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ctx.clearRect(0, 0, W, H);
    const t = now / 1000;
    for (const f of flies) {
      f.a += rnd(-1, 1) * dt * 1.2;
      f.x += Math.cos(f.a) * f.v * dt; f.y += Math.sin(f.a) * f.v * dt - 2 * dt;
      if (!free(f.x, f.y) || f.x < 0 || f.x > W || f.y < 0 || f.y > H) { f.a += Math.PI; f.x += Math.cos(f.a) * 3; f.y += Math.sin(f.a) * 3; }
      const k = 0.5 - 0.5 * Math.cos(((t + f.t0) / f.p) * Math.PI * 2); // 0..1, плавно
      const al = 0.08 + 0.72 * k * k;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 6);
      g.addColorStop(0, `rgba(255,246,190,${al})`);
      g.addColorStop(0.25, `rgba(230,240,140,${al * 0.55})`);
      g.addColorStop(1, 'rgba(200,230,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 6, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
