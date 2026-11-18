'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Campaign = require('../js/campaign/campaign.js');
const Progress = require('../js/campaign/progress.js');

const IDS = Campaign.allLevelIds();

function stubStorage(initial) {
  const data = Object.assign({}, initial);
  const writes = [];
  return {
    data,
    writes,
    getItem: k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { writes.push(k); data[k] = String(v); }
  };
}

const throwingStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); }
};

const ERR = 'Код не подходит. Проверьте, что он скопирован целиком.';

/* Код переноса из произвольного JSON — тот же формат, что у exportCode
 * (HS2- + base64 + '.' + FNV-1a), но без нормализации. */
function rawCode(obj) {
  const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  let h = 0x811c9dc5;
  for (let i = 0; i < b64.length; i++) {
    h ^= b64.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'HS2-' + b64 + '.' + ('00000000' + h.toString(16)).slice(-8);
}

function decodeCode(code) {
  const b64 = code.slice(4, code.lastIndexOf('.'));
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

test('ключи сохранения', () => {
  assert.equal(Progress.KEY, 'sun-keeper-save');
  assert.equal(Progress.OLD_KEY, 'sun-treasures-save');
});

test('empty(): версия 2, спокойно, ничего не пройдено', () => {
  const s = Progress.empty();
  assert.deepEqual(s, { version: 2, difficulty: 'calm', best: 0, levels: {}, seenScenes: [] });
  assert.notEqual(Progress.empty().levels, s.levels);
});

test('миграция {unlocked:4, relaxed:false, best:9000}', () => {
  const oldRaw = JSON.stringify({ best: 9000, unlocked: 4, relaxed: false });
  const st = stubStorage({ [Progress.OLD_KEY]: oldRaw });
  const s = Progress.load(st);
  for (const id of ['1-01', '1-02', '1-03', '1-04']) {
    assert.equal(s.levels[id].normal.stars, 1, id);
    assert.equal(s.levels[id].calm, undefined, id);
  }
  assert.equal(s.levels['1-05'], undefined);
  assert.equal(Progress.fragmentTier(s, '1-04'), 'silver');
  assert.equal(Progress.currentLevelId(s, Campaign), '1-05');
  assert.equal(s.best, 9000);
  assert.equal(s.difficulty, 'normal');
  assert.equal(s.version, 2);
  // load ничего не пишет, старый ключ цел
  assert.equal(st.writes.length, 0);
  assert.equal(st.data[Progress.OLD_KEY], oldRaw);
});

test('миграция {unlocked:0, relaxed:true}: ничего не пройдено, calm', () => {
  const st = stubStorage({ [Progress.OLD_KEY]: JSON.stringify({ best: 0, unlocked: 0, relaxed: true }) });
  const s = Progress.load(st);
  assert.deepEqual(s.levels, {});
  assert.equal(s.difficulty, 'calm');
  assert.equal(Progress.currentLevelId(s, Campaign), '1-01');
});

test('миграция: relaxed -> calm, пропущенные и кривые поля', () => {
  const a = Progress.migrateV1({ unlocked: 2, relaxed: true, best: 50 }, IDS);
  assert.equal(a.levels['1-02'].calm.stars, 1);
  assert.equal(Progress.fragmentTier(a, '1-02'), 'stone');
  assert.equal(a.difficulty, 'calm');
  assert.equal(a.best, 50);

  // пропущены оба поля: unlocked = 0, relaxed = true
  assert.deepEqual(Progress.migrateV1({}, IDS), Progress.empty());
  assert.deepEqual(Progress.migrateV1({ unlocked: 'много', relaxed: 'нет', best: 'x' }, IDS), Progress.empty());

  const d = Progress.migrateV1({ unlocked: 999, relaxed: false }, IDS);
  assert.equal(Object.keys(d.levels).length, IDS.length);
  assert.deepEqual(Progress.migrateV1({ unlocked: -5 }, IDS).levels, {});
  assert.equal(Object.keys(Progress.migrateV1({ unlocked: 2.7 }, IDS).levels).length, 2);

  for (const junk of [null, undefined, 7, 'str', []]) {
    assert.deepEqual(Progress.migrateV1(junk, IDS), Progress.empty());
  }
});

test('валидный новый ключ важнее старого', () => {
  const mine = Progress.empty();
  mine.difficulty = 'challenge';
  mine.best = 123;
  const st = stubStorage({
    [Progress.KEY]: JSON.stringify(mine),
    [Progress.OLD_KEY]: JSON.stringify({ best: 9000, unlocked: 4, relaxed: false })
  });
  const s = Progress.load(st);
  assert.equal(s.best, 123);
  assert.equal(s.difficulty, 'challenge');
  assert.deepEqual(s.levels, {});
  assert.equal(st.writes.length, 0);
});

test('пустое хранилище -> empty()', () => {
  assert.deepEqual(Progress.load(stubStorage({})), Progress.empty());
  assert.deepEqual(Progress.load(null), Progress.empty());
});

test('битый JSON в новом ключе + нет старого -> empty(), storage не перезаписан', () => {
  const st = stubStorage({ [Progress.KEY]: '{"version":2,"lev' });
  assert.deepEqual(Progress.load(st), Progress.empty());
  assert.equal(st.writes.length, 0);
  assert.equal(st.data[Progress.KEY], '{"version":2,"lev');
});

test('битый новый ключ + валидный старый -> миграция старого, storage не тронут', () => {
  const oldRaw = JSON.stringify({ best: 500, unlocked: 3, relaxed: false });
  for (const bad of ['{"version":2,"lev', '{"version":1}', '[]', 'null']) {
    const st = stubStorage({ [Progress.KEY]: bad, [Progress.OLD_KEY]: oldRaw });
    const s = Progress.load(st);
    assert.equal(Progress.currentLevelId(s, Campaign), '1-04', bad);
    assert.equal(s.difficulty, 'normal', bad);
    assert.equal(s.best, 500, bad);
    assert.equal(st.writes.length, 0, bad);
    assert.equal(st.data[Progress.KEY], bad);
    assert.equal(st.data[Progress.OLD_KEY], oldRaw);
  }
});

test('битый новый ключ + битый старый -> empty()', () => {
  const st = stubStorage({ [Progress.KEY]: '{', [Progress.OLD_KEY]: 'тоже не json' });
  assert.deepEqual(Progress.load(st), Progress.empty());
  assert.equal(st.writes.length, 0);
});

test('readRaw: сырая строка нового ключа, null если нет или хранилище бросает', () => {
  assert.equal(Progress.readRaw(stubStorage({ [Progress.KEY]: '{"битый' })), '{"битый');
  assert.equal(Progress.readRaw(stubStorage({})), null);
  assert.equal(Progress.readRaw(throwingStorage), null);
  assert.equal(Progress.readRaw(null), null);
});

test('битый JSON в старом ключе -> empty(), без записи', () => {
  const st = stubStorage({ [Progress.OLD_KEY]: 'не json' });
  assert.deepEqual(Progress.load(st), Progress.empty());
  assert.equal(st.writes.length, 0);
});

test('новый ключ с чужой структурой (старого нет) -> empty()', () => {
  for (const raw of ['null', '7', '[]', '{}', '{"version":1}', '{"version":2}', '{"version":2,"levels":[]}']) {
    const st = stubStorage({ [Progress.KEY]: raw });
    assert.deepEqual(Progress.load(st), Progress.empty(), raw);
  }
});

test('load чистит мусор внутри валидного сохранения, но не теряет хорошее', () => {
  const raw = '{"version":2,"difficulty":"вау","best":-4,"levels":{' +
    '"1-01":{"calm":{"stars":3,"best":500},"normal":{"stars":"x"},"extra":1},' +
    '"1-02":"мусор",' +
    '"__proto__":{"calm":{"stars":1,"best":1}},' +
    '"abc":{"calm":{"stars":1,"best":1}}},' +
    '"seenScenes":["prologue",5,"prologue","1-intro"]}';
  const s = Progress.load(stubStorage({ [Progress.KEY]: raw }));
  assert.equal(s.difficulty, 'calm');
  assert.equal(s.best, 0);
  assert.deepEqual(s.levels, { '1-01': { calm: { stars: 3, best: 500 } } });
  assert.deepEqual(s.seenScenes, ['prologue', '1-intro']);
  assert.equal(Object.getPrototypeOf(s.levels), Object.prototype);
});

test('getItem бросает -> load возвращает empty(), persist возвращает false', () => {
  assert.deepEqual(Progress.load(throwingStorage), Progress.empty());
  assert.equal(Progress.persist(throwingStorage, Progress.empty()), false);
  assert.equal(Progress.persist(null, Progress.empty()), false);
});

test('persist пишет JSON под новым ключом и возвращает true', () => {
  const st = stubStorage({});
  const s = Progress.empty();
  assert.equal(Progress.persist(st, s), true);
  assert.deepEqual(JSON.parse(st.data[Progress.KEY]), s);
  assert.deepEqual(Progress.load(st), s);
});

test('record: звёзды и очки не уменьшаются, newTier gold на challenge после silver', () => {
  let s = Progress.empty();
  let r = Progress.record(s, '1-01', 'normal', 1000, 2);
  assert.equal(r.improved, true);
  assert.equal(r.newTier, 'silver');
  s = r.save;
  assert.deepEqual(s.levels['1-01'].normal, { stars: 2, best: 1000 });

  r = Progress.record(s, '1-01', 'normal', 400, 1);
  assert.equal(r.improved, false);
  assert.equal(r.newTier, null);
  assert.deepEqual(r.save.levels['1-01'].normal, { stars: 2, best: 1000 });

  r = Progress.record(s, '1-01', 'normal', 1500, 1);
  assert.equal(r.improved, true);
  assert.equal(r.newTier, null);
  assert.deepEqual(r.save.levels['1-01'].normal, { stars: 2, best: 1500 });

  r = Progress.record(s, '1-01', 'challenge', 900, 1);
  assert.equal(r.improved, true);
  assert.equal(r.newTier, 'gold');
  assert.equal(Progress.fragmentTier(r.save, '1-01'), 'gold');

  // победа на более лёгкой сложности осколок не меняет
  const lower = Progress.record(r.save, '1-01', 'calm', 100, 3);
  assert.equal(lower.newTier, null);
  assert.equal(Progress.fragmentTier(lower.save, '1-01'), 'gold');
});

test('record: не мутирует вход, обновляет общий рекорд', () => {
  const s = Progress.empty();
  const frozen = JSON.stringify(s);
  const r = Progress.record(s, '1-01', 'calm', 700, 3);
  assert.equal(JSON.stringify(s), frozen);
  assert.notEqual(r.save, s);
  assert.notEqual(r.save.levels, s.levels);
  assert.equal(r.save.best, 700);
  assert.equal(r.newTier, 'stone');
  // следующий record не трогает предыдущий результат
  const r2 = Progress.record(r.save, '1-01', 'calm', 800, 3);
  assert.equal(r.save.levels['1-01'].calm.best, 700);
  assert.equal(r2.save.levels['1-01'].calm.best, 800);
  assert.equal(r2.save.best, 800);
});

test('record: неизвестный уровень или сложность игнорируются', () => {
  const s = Progress.empty();
  let r = Progress.record(s, '9-99', 'calm', 5, 1);
  assert.equal(r.improved, false);
  assert.equal(r.newTier, null);
  assert.deepEqual(r.save, s);
  r = Progress.record(s, '1-01', 'hard', 5, 1);
  assert.equal(r.improved, false);
  assert.deepEqual(r.save, s);
});

test('fragmentTier: пока не пройден — null', () => {
  assert.equal(Progress.fragmentTier(Progress.empty(), '1-01'), null);
  const s = Progress.record(Progress.empty(), '1-01', 'calm', 1, 1).save;
  assert.equal(Progress.fragmentTier(s, '1-01'), 'stone');
  assert.equal(Progress.fragmentTier(s, '1-02'), null);
});

test('isUnlocked: 1-02 закрыт пока 1-01 не пройден; 2-01 открыт после 1-20', () => {
  let s = Progress.empty();
  assert.equal(Progress.isUnlocked(s, '1-01', Campaign), true);
  assert.equal(Progress.isUnlocked(s, '1-02', Campaign), false);
  s = Progress.record(s, '1-01', 'challenge', 1, 1).save;
  assert.equal(Progress.isUnlocked(s, '1-02', Campaign), true);
  assert.equal(Progress.isUnlocked(s, '1-03', Campaign), false);

  const all = Progress.migrateV1({ unlocked: 19, relaxed: true }, IDS);
  assert.equal(Progress.isUnlocked(all, '2-01', Campaign), false);
  const done = Progress.record(all, '1-20', 'calm', 1, 1).save;
  assert.equal(Progress.isUnlocked(done, '2-01', Campaign), true);
  assert.equal(Progress.isUnlocked(done, '2-02', Campaign), false);
});

test('isUnlocked: неизвестный уровень -> false', () => {
  assert.equal(Progress.isUnlocked(Progress.empty(), '9-99', Campaign), false);
  assert.equal(Progress.isUnlocked(Progress.empty(), undefined, Campaign), false);
});

test('currentLevelId: первый непройденный, а после всех — последний', () => {
  assert.equal(Progress.currentLevelId(Progress.empty(), Campaign), '1-01');
  const mid = Progress.migrateV1({ unlocked: 20, relaxed: true }, IDS);
  assert.equal(Progress.currentLevelId(mid, Campaign), '2-01');
  const all = Progress.migrateV1({ unlocked: 99, relaxed: true }, IDS);
  assert.equal(Progress.currentLevelId(all, Campaign), '4-20');
});

test('starsTotal: сумма максимумов по каждой сложности каждого уровня', () => {
  let s = Progress.empty();
  assert.equal(Progress.starsTotal(s), 0);
  s = Progress.record(s, '1-01', 'calm', 1, 3).save;
  s = Progress.record(s, '1-01', 'normal', 1, 2).save;
  s = Progress.record(s, '1-02', 'calm', 1, 1).save;
  s = Progress.record(s, '1-01', 'calm', 1, 1).save; // не уменьшает
  assert.equal(Progress.starsTotal(s), 6);
});

test('exportCode -> importCode возвращает тот же save', () => {
  let s = Progress.migrateV1({ unlocked: 7, relaxed: false, best: 4321 }, IDS);
  s = Progress.record(s, '1-08', 'challenge', 777, 3).save;
  s.seenScenes = ['prologue', '1-intro'];
  const code = Progress.exportCode(s);
  assert.match(code, /^HS2-[A-Za-z0-9+/]+={0,2}\.[0-9a-f]{8}$/);
  const r = Progress.importCode(code);
  assert.equal(r.ok, true);
  assert.deepEqual(r.save, s);

  assert.deepEqual(Progress.importCode(Progress.exportCode(Progress.empty())), { ok: true, save: Progress.empty() });
});

test('importCode: пробелы, переносы строк и табы вокруг и внутри кода', () => {
  const s = Progress.record(Progress.empty(), '1-01', 'normal', 10, 2).save;
  const code = Progress.exportCode(s);
  const wrapped = '  \n' + code.replace(/(.{20})/g, '$1\n') + '\r\n\t ';
  const r = Progress.importCode(wrapped);
  assert.equal(r.ok, true);
  assert.deepEqual(r.save, s);
});

test('importCode: испорченный код -> ok:false с текстом ошибки', () => {
  const s = Progress.record(Progress.empty(), '1-01', 'normal', 10, 2).save;
  const code = Progress.exportCode(s);
  const flipped = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
  const cases = [
    flipped,
    code.slice(0, -3),                  // обрезан
    code.slice(0, code.indexOf('.')),   // нет контрольной суммы
    code.replace('HS2-', 'HS1-'),
    '', '   ', 'просто текст', 'HS2-.', 'HS2-!!!.00000000',
    null, undefined, 42, {}, []
  ];
  for (const c of cases) {
    assert.deepEqual(Progress.importCode(c), { ok: false, error: ERR }, String(c));
  }
});

test('importCode: корректная сумма, но чужая структура -> ok:false', () => {
  const bad = [
    { version: 1, difficulty: 'calm', levels: {} },
    { version: 2, difficulty: 'hard', levels: {} },
    { version: 2, difficulty: 'calm', levels: [] },
    { version: 2, difficulty: 'calm' },
    [1, 2], 'строка', 5, null
  ];
  for (const obj of bad) {
    // код с корректной суммой собираем вручную: exportCode нормализует вход
    const code = rawCode(obj);
    assert.deepEqual(Progress.importCode(code), { ok: false, error: ERR }, JSON.stringify(obj));
  }
});

test('importCode: неверная сумма отвергается даже при валидном JSON', () => {
  const code = Progress.exportCode(Progress.empty());
  const tampered = code.slice(0, code.lastIndexOf('.') + 1) + '00000000';
  assert.equal(Progress.importCode(tampered).ok, false);
});

test('кодирование работает и без Buffer (путь браузера)', () => {
  const s = Progress.record(Progress.empty(), '1-01', 'calm', 5, 1).save;
  s.seenScenes = ['сцена-привет'];
  const withBuffer = Progress.exportCode(s);
  const realBuffer = global.Buffer;
  let withoutBuffer, back;
  try {
    global.Buffer = undefined;
    withoutBuffer = Progress.exportCode(s);
    back = Progress.importCode(withBuffer);
  } finally {
    global.Buffer = realBuffer;
  }
  assert.equal(withoutBuffer, withBuffer);
  assert.equal(back.ok, true);
  assert.deepEqual(back.save, s);
});

test('миграция: числа в строках читаются как у старой игры (Number + обрезка)', () => {
  const a = Progress.migrateV1({ unlocked: '4', best: '9000', relaxed: false }, IDS);
  assert.deepEqual(Object.keys(a.levels), ['1-01', '1-02', '1-03', '1-04']);
  assert.equal(a.levels['1-04'].normal.stars, 1);
  assert.equal(a.best, 9000);
  assert.equal(a.difficulty, 'normal');

  assert.equal(Object.keys(Progress.migrateV1({ unlocked: '4.7' }, IDS).levels).length, 4);
  assert.equal(Object.keys(Progress.migrateV1({ unlocked: ' 3 ' }, IDS).levels).length, 3);
  assert.deepEqual(Progress.migrateV1({ unlocked: '-3', best: '-10' }, IDS), Progress.empty());
  assert.deepEqual(Progress.migrateV1({ unlocked: 'abc', best: 'abc' }, IDS), Progress.empty());
  assert.equal(Object.keys(Progress.migrateV1({ unlocked: '99' }, IDS).levels).length, IDS.length);
  assert.equal(Progress.migrateV1({ best: '123.5' }, IDS).best, 123.5);

  const st = stubStorage({ [Progress.OLD_KEY]: '{"best":"9000","unlocked":"4","relaxed":false}' });
  const s = Progress.load(st);
  assert.equal(Progress.currentLevelId(s, Campaign), '1-05');
  assert.equal(s.best, 9000);
  assert.equal(st.writes.length, 0);
});

test('importCode: невидимые символы U+200B–U+200D и U+FEFF внутри и вокруг кода', () => {
  const s = Progress.record(Progress.empty(), '1-03', 'challenge', 321, 3).save;
  const code = Progress.exportCode(s);
  const mid = Math.floor(code.length / 2);
  const dirty = '\uFEFF' + code.slice(0, 5) + '\u200B' + code.slice(5, mid) + '\u200C\u200D' +
    code.slice(mid) + '\u200B\n';
  const r = Progress.importCode(dirty);
  assert.equal(r.ok, true);
  assert.deepEqual(r.save, s);
});

test('exportCode: кодирует нормализованную копию и не меняет вход', () => {
  const s = Progress.record(Progress.empty(), '1-02', 'normal', 50, 2).save;
  s.junk = { secret: 1 };
  s.levels['1-02'].normal.extra = 'x';
  s.levels['мусор'] = { calm: { stars: 3, best: 1 } };
  s.seenScenes = ['prologue', 'prologue', 7];
  const before = JSON.stringify(s);
  const code = Progress.exportCode(s);
  assert.equal(JSON.stringify(s), before);

  const decoded = decodeCode(code);
  assert.equal(decoded.junk, undefined);
  assert.equal(decoded.levels['мусор'], undefined);
  assert.deepEqual(decoded.levels['1-02'], { normal: { stars: 2, best: 50 } });
  assert.deepEqual(decoded.seenScenes, ['prologue']);
  assert.deepEqual(Progress.importCode(code), { ok: true, save: decoded });

  // мусор на входе не роняет экспорт
  for (const junk of [null, undefined, 5, 'str', {}, { levels: [] }]) {
    assert.deepEqual(decodeCode(Progress.exportCode(junk)), Progress.empty(), String(junk));
  }
});

test('isUsableRaw: true только для строки, которую load возьмёт из нового ключа', () => {
  assert.equal(Progress.isUsableRaw(JSON.stringify(Progress.empty())), true);
  const withJunk = Object.assign(Progress.empty(), { difficulty: 'hard', levels: { '1-01': 5 } });
  assert.equal(Progress.isUsableRaw(JSON.stringify(withJunk)), true);
  for (const bad of [null, undefined, '', '{bad', 'null', '[]', '{"version":1,"levels":{}}',
    '{"version":2}', '{"version":2,"levels":[]}', 42]) {
    assert.equal(Progress.isUsableRaw(bad), false, String(bad));
  }
  // согласовано с load(): битый новый ключ -> берётся старое сохранение
  const st = stubStorage({ [Progress.KEY]: '{bad', [Progress.OLD_KEY]: '{"unlocked":2}' });
  assert.equal(Progress.isUsableRaw(Progress.readRaw(st)), false);
  assert.equal(Object.keys(Progress.load(st).levels).length, 2);
});
