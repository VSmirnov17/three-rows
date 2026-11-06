'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Campaign = require('../js/campaign/campaign.js');
const Progress = require('../js/campaign/progress.js');
const SunStone = require('../js/sun-stone.js');

const land1 = Campaign.lands()[0];
const land2 = Campaign.lands()[1];
const NULLS = Array(20).fill(null);

test('пустое сохранение — 20 пустых секторов', () => {
  assert.deepEqual(SunStone.segments(Progress.empty(), land1), NULLS);
});

test('пройдено на calm — stone', () => {
  const save = Progress.empty();
  save.levels['1-01'] = { calm: { stars: 2, best: 100 } };
  const segs = SunStone.segments(save, land1);
  assert.equal(segs[0], 'stone');
  assert.deepEqual(segs.slice(1), Array(19).fill(null));
});

test('calm и challenge — gold', () => {
  const save = Progress.empty();
  save.levels['1-01'] = { calm: { stars: 2, best: 100 }, challenge: { stars: 1, best: 50 } };
  assert.equal(SunStone.segments(save, land1)[0], 'gold');
});

test('прогресс земли 2 не попадает в круг земли 1', () => {
  const save = Progress.empty();
  save.levels[land2.levels[0].id] = { calm: { stars: 3, best: 500 } };
  assert.deepEqual(SunStone.segments(save, land1), NULLS);
});

test('испорченное сохранение не падает', () => {
  assert.deepEqual(SunStone.segments(null, land1), NULLS);
  assert.deepEqual(SunStone.segments({}, land1), NULLS);
  assert.deepEqual(SunStone.segments({ levels: 5 }, land1), NULLS);
  assert.deepEqual(SunStone.segments(undefined, land1), NULLS);
  assert.deepEqual(SunStone.segments({ levels: { '1-01': 7 } }, land1), NULLS);
});

test('земля без levels — пустой массив', () => {
  assert.deepEqual(SunStone.segments(Progress.empty(), { id: 'x' }), []);
  assert.deepEqual(SunStone.segments(Progress.empty(), null), []);
  assert.deepEqual(SunStone.segments(Progress.empty(), { levels: 'abc' }), []);
});

test('геттер, бросающий исключение, не ломает круг', () => {
  const save = Progress.empty();
  Object.defineProperty(save.levels, '1-02', { enumerable: true, get() { throw new Error('boom'); } });
  save.levels['1-01'] = { calm: { stars: 1, best: 1 } };
  const segs = SunStone.segments(save, land1);
  assert.equal(segs.length, 20);
  assert.equal(segs[0], 'stone');
  assert.equal(segs[1], null);
});

/* --- render на минимальном поддельном DOM --- */

function fakeDoc() {
  function el(tag) {
    return {
      tag, attrs: {}, children: [],
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { this.children.push(c); return c; },
      get className() { return this.attrs.class || ''; }
    };
  }
  const doc = { createElement: el, createElementNS: (ns, tag) => el(tag) };
  const host = el('div');
  host.ownerDocument = doc;
  host.replaceChildren = function () { this.children = []; for (const c of arguments) this.children.push(c); };
  Object.defineProperty(host, 'textContent', { set() { this.children = []; }, get() { return ''; } });
  return host;
}

function walk(node, out) {
  out = out || [];
  out.push(node);
  (node.children || []).forEach(c => walk(c, out));
  return out;
}

test('render: основа, svg, сектора и классы', () => {
  const host = fakeDoc();
  const save = Progress.empty();
  save.levels['1-01'] = { calm: { stars: 1, best: 1 } };
  save.levels['1-02'] = { challenge: { stars: 1, best: 1 } };
  const segs = SunStone.segments(save, land1);
  SunStone.render(host, segs, 2);
  const all = walk(host);
  const img = all.find(n => n.tag === 'img');
  assert.equal(img.attrs.class, 'sun-stone-base');
  assert.equal(img.attrs.src, 'assets/ui/sun-stone.webp');
  const svg = all.find(n => n.tag === 'svg');
  assert.equal(svg.attrs.class, 'sun-stone-ring');
  assert.equal(svg.attrs.viewBox, '0 0 200 200');
  assert.equal(svg.attrs['aria-hidden'], 'true');
  const paths = all.filter(n => n.tag === 'path');
  assert.equal(paths.length, 20);
  assert.equal(paths[0].attrs.class, 'sun-seg tier-stone');
  assert.equal(paths[1].attrs.class, 'sun-seg tier-gold');
  assert.equal(paths[2].attrs.class, 'sun-seg empty current');
  assert.equal(paths.filter(p => /\bcurrent\b/.test(p.attrs.class)).length, 1);
  paths.forEach(p => assert.match(p.attrs.d, /^M/));
  const grads = all.filter(n => n.tag === 'radialGradient').map(g => g.attrs.id);
  assert.deepEqual(grads, ['sunSegStone', 'sunSegSilver', 'sunSegGold']);
  assert.equal(host.attrs['aria-label'], 'Осколки главы: 2 из 20');
});

test('render: повторный вызов заменяет содержимое', () => {
  const host = fakeDoc();
  SunStone.render(host, NULLS, 0);
  SunStone.render(host, NULLS, 0);
  assert.equal(walk(host).filter(n => n.tag === 'svg').length, 1);
  assert.equal(host.attrs['aria-label'], 'Осколки главы: 0 из 20');
});
