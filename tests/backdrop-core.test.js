'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const BC = require('../js/backdrop-core.js');

const { LIMITS, FIREFLY } = BC;

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
  const period = FIREFLY.period[0];
  const dt = 1 / 60;
  const steps = Math.round(period / dt);
  let min = Infinity;
  let max = -Infinity;
  let prev = BC.fireflyAlpha(0, period, 0);
  for (let i = 0; i <= steps; i++) {
    const a = BC.fireflyAlpha(i * dt, period, 0);
    min = Math.min(min, a);
    max = Math.max(max, a);
    if (i > 0) assert.ok(Math.abs(a - prev) <= 0.02, `скачок ${Math.abs(a - prev)} на шаге ${i}`);
    prev = a;
  }
  assert.ok(min >= 0.08 - 1e-9, `min ${min}`);
  assert.ok(max <= LIMITS.fireflyAlphaMax + 1e-9, `max ${max}`);
  /* сдвиг фазы тоже не выводит за пределы */
  for (let i = 0; i < 200; i++) {
    const a = BC.fireflyAlpha(i * 0.37, 6.5, i * 1.3);
    assert.ok(a >= 0.08 - 1e-9 && a <= LIMITS.fireflyAlphaMax + 1e-9, `a ${a}`);
  }
  assert.ok(Math.abs(BC.fireflyAlpha(0, period, 0) - FIREFLY.alpha[0]) < 1e-12);
  assert.ok(Math.abs(BC.fireflyAlpha(period / 2, period, 0) - FIREFLY.alpha[1]) < 1e-12);
});

test('числа FIREFLY не выходят за LIMITS', () => {
  assert.ok(FIREFLY.count <= LIMITS.fireflyMax);
  assert.ok(FIREFLY.speed[1] + FIREFLY.rise <= LIMITS.fireflySpeedMax);
  assert.ok(FIREFLY.period[0] >= LIMITS.fireflyBlinkMinS);
  assert.ok(FIREFLY.alpha[1] <= LIMITS.fireflyAlphaMax);
  assert.ok(Object.isFrozen(LIMITS));
  assert.ok(Object.isFrozen(FIREFLY));
});

test('isFree и spawnPoint обходят прямоугольники', () => {
  const rects = [{ left: 100, top: 0, right: 900, bottom: 600 }];
  assert.equal(BC.isFree(rects, 50, 300, 14), true);
  assert.equal(BC.isFree(rects, 90, 300, 14), false);

  /* линейный конгруэнтный генератор: результат воспроизводим */
  function lcg(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const w = 1000;
  const h = 700;
  const side = [{ left: 120, top: 0, right: 880, bottom: 700 }];
  const rand = lcg(12345);
  for (let i = 0; i < 200; i++) {
    const p = BC.spawnPoint(side, w, h, rand);
    assert.ok(p, `попытка ${i}: нет точки`);
    assert.ok(BC.isFree(side, p.x, p.y, FIREFLY.pad), `попытка ${i}: точка занята`);
    assert.ok(p.x >= 4 && p.x <= w - 4, `x ${p.x}`);
    assert.ok(p.y >= 0.15 * h && p.y <= h - 6, `y ${p.y}`);
  }

  const all = [{ left: 0, top: 0, right: w, bottom: h }];
  assert.equal(BC.spawnPoint(all, w, h, lcg(1)), null);
});

const fs = require('node:fs');
const path = require('node:path');

test('числа анимаций в css/backdrop.css не выходят за LIMITS', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'backdrop.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const secs = (re, what) => {
    const m = re.exec(css);
    assert.ok(m, `не найдено: ${what}`);
    return parseFloat(m[1]);
  };
  const breath = secs(/animation:\s*bdBreath\s+([\d.]+)s/, 'animation bdBreath');
  assert.ok(breath >= LIMITS.moonBreathMinS, `bdBreath ${breath}s`);
  const drift = secs(/animation:\s*bdDrift\s+([\d.]+)s/, 'animation bdDrift');
  assert.ok(drift >= LIMITS.cloudCrossMinS, `bdDrift ${drift}s`);
  for (const cls of ['bd-water-a', 'bd-water-b']) {
    const dur = secs(new RegExp('\\.' + cls + '\\s*\\{[^}]*--dur:\\s*([\\d.]+)s'), cls + ' --dur');
    assert.ok(dur >= LIMITS.waterMinS, `${cls} --dur ${dur}s`);
  }

  const kf = /@keyframes\s+bdBreath\s*\{([\s\S]*?\})\s*\}/.exec(css);
  assert.ok(kf, '@keyframes bdBreath');
  const ops = [...kf[1].matchAll(/opacity:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
  assert.ok(ops.length >= 2, `в bdBreath ${ops.length} значений opacity`);
  const swing = Math.max(...ops) - Math.min(...ops);
  assert.ok(swing <= LIMITS.haloSwingMax + 1e-9, `размах ореола ${swing}`);
});

test('геометрия land-01 совпадает с assets/backdrop/land1/backdrop.json', () => {
  const land = require('../js/campaign/land-01.js');
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'backdrop', 'land1', 'backdrop.json'), 'utf8'));
  const bd = land.backdrop;
  assert.ok(bd, 'у земли 1 нет backdrop');
  for (const k of ['x', 'y', 'w', 'h']) {
    assert.ok(Math.abs(bd.wf[k] - json.wf[k]) <= 1e-6, `wf.${k}: ${bd.wf[k]} != ${json.wf[k]}`);
  }
  assert.ok(Math.abs(bd.tile - json.tile) <= 1e-6, `tile: ${bd.tile} != ${json.tile}`);
  assert.equal(bd.waterfall, true);
  /* пути от корня игры, файлы на месте */
  for (const k of ['plate', 'water', 'mask', 'moon', 'clouds']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', bd[k])), `${k}: нет файла ${bd[k]}`);
  }
  assert.equal(land.bg, bd.plate);
  assert.equal(land.mosaic, 'assets/art/bg-jaguar.webp');
});

test('маска воды в water-mask.js — те же байты, что water-mask.webp', () => {
  const land = require('../js/campaign/land-01.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'backdrop', 'land1', 'water-mask.js'), 'utf8');
  const win = {};
  new Function('window', src)(win);
  const uri = win.BACKDROP_DATA && win.BACKDROP_DATA[land.backdrop.mask];
  assert.ok(uri, 'нет маски по пути ' + land.backdrop.mask);
  const prefix = 'data:image/webp;base64,';
  assert.ok(uri.startsWith(prefix), uri.slice(0, 30));
  const bytes = Buffer.from(uri.slice(prefix.length), 'base64');
  assert.ok(bytes.equals(fs.readFileSync(path.join(__dirname, '..', land.backdrop.mask))), 'байты маски разошлись с .webp');
});

test('все файлы assets/backdrop/land1 вместе не больше 450 КБ', () => {
  const dir = path.join(__dirname, '..', 'assets', 'backdrop', 'land1');
  const total = fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(total <= 450 * 1024, `${total} байт`);
});

test('земля 2: плита без воды, луна и облака общие с землёй 1, размер совпадает с backdrop.json', () => {
  const land = require('../js/campaign/land-02.js');
  const root = path.join(__dirname, '..');
  const bd = land.backdrop;
  assert.ok(bd, 'у земли 2 нет backdrop');
  assert.equal(bd.waterfall, false);
  assert.ok(!bd.wf && !bd.water && !bd.mask && bd.tile === undefined, 'у земли 2 не должно быть воды');
  for (const k of ['plate', 'moon', 'clouds']) {
    assert.ok(fs.existsSync(path.join(root, bd[k])), `${k}: нет файла ${bd[k]}`);
  }
  assert.equal(bd.plate, 'assets/backdrop/land2/plate.webp');
  assert.equal(bd.moon, 'assets/backdrop/land1/moon.webp');
  assert.equal(bd.clouds, 'assets/backdrop/land1/clouds.webp');
  assert.equal(land.bg, bd.plate);
  assert.equal(land.mosaic, 'assets/art/bg-temple.webp');
  const json = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'backdrop', 'land2', 'backdrop.json'), 'utf8'));
  assert.deepEqual(Object.keys(json), ['plate'], 'в backdrop.json земли 2 только размер плиты');
  // размер плиты — из заголовка WebP (VP8: 14 бит ширины/высоты со смещения 26)
  const buf = fs.readFileSync(path.join(root, bd.plate));
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  assert.equal(buf.toString('ascii', 12, 16), 'VP8 ');
  assert.deepEqual([buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff], json.plate);
  // плита того же вида сцены, что у земли 1 (CSS-сцена 1672×941)
  const j1 = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'backdrop', 'land1', 'backdrop.json'), 'utf8'));
  assert.deepEqual(json.plate, j1.plate);
});

test('все файлы assets/backdrop/land2 вместе не больше 250 КБ', () => {
  const dir = path.join(__dirname, '..', 'assets', 'backdrop', 'land2');
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, ['backdrop.json', 'plate.webp']);
  const total = names.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(total <= 250 * 1024, `${total} байт`);
});

/* линейный конгруэнтный генератор для симуляций */
function lcgRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('новый светлячок появляется самым тусклым', () => {
  const rand = lcgRand(7);
  for (const t of [0, 3.3, 17.25, 600.5]) {
    const f = BC.newFly([], 1366, 768, t, rand);
    assert.ok(f, 'нет светлячка');
    assert.ok(Math.abs(BC.fireflyAlpha(t, f.p, f.ph) - FIREFLY.alpha[0]) < 1e-9, `t=${t}: ${BC.fireflyAlpha(t, f.p, f.ph)}`);
    assert.ok(f.life >= FIREFLY.life[0] && f.life <= FIREFLY.life[1], `life ${f.life}`);
  }
  assert.equal(BC.newFly([{ left: 0, top: 0, right: 1366, bottom: 768 }], 1366, 768, 0, rand), null);
});

test('светлячки за 10 минут не собираются у верха и не заходят на занятое', () => {
  /* 1366×768: свободны только боковые полосы (занято x 73..1293 на всю высоту) */
  const w = 1366;
  const h = 768;
  const rects = [{ left: 73, top: 0, right: 1293, bottom: h }];
  const rand = lcgRand(2026);
  const dt = 1 / 60;
  let t = 0;
  let flies = [];
  for (let i = 0; i < FIREFLY.count; i++) flies.push(BC.newFly(rects, w, h, t, rand));
  let samples = 0;
  let top10 = 0;
  let topQuarter = 0;
  let respawns = 0;
  const steps = 10 * 60 * 60;
  for (let s = 1; s <= steps; s++) {
    t = s * dt;
    flies = flies.map(f => {
      const g = BC.stepFly(f, t, dt, rects, w, h, rand);
      if (g !== f) {
        respawns++;
        assert.ok(g, `t=${t.toFixed(2)}: место для перерождения не нашлось`);
        assert.ok(BC.fireflyAlpha(t, g.p, g.ph) - FIREFLY.alpha[0] < 1e-9, 'переродился не самым тусклым');
        assert.ok(t - f.born >= f.life, 'переродился раньше срока');
        /* старый уходит в самый тусклый момент: яркость у минимума */
        assert.ok(BC.fireflyAlpha(t, f.p, f.ph) < FIREFLY.alpha[0] + 0.01, 'ушёл не в тусклый момент');
      }
      assert.ok(BC.flyFits(rects, w, h, g.x, g.y), `t=${t.toFixed(2)}: (${g.x.toFixed(1)}, ${g.y.toFixed(1)}) вне свободного места`);
      return g;
    });
    if (s % 60 === 0) {
      for (const f of flies) {
        samples++;
        if (f.y < 0.1 * h) top10++;
        if (f.y < 0.25 * h) topQuarter++;
      }
    }
  }
  const share = top10 / samples;
  assert.ok(share <= 0.2, `в верхних 10% окна ${(share * 100).toFixed(1)}%`);
  /* полоса между полом 0,15·h и 0,25·h — меньше трети (равномерно было бы ~12%) */
  assert.ok(topQuarter / samples <= 0.33, `в верхней четверти ${(topQuarter / samples * 100).toFixed(1)}%`);
  assert.ok(respawns >= FIREFLY.count * 5, `перерождений ${respawns}`);
});
