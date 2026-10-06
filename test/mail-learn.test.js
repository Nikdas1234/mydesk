const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTempDir } = require('./helpers/tmp');
const {
  tokenize, createModel, createTrainingStore, MIN_PER_CLASS, MAX_TOKENS,
} = require('../src/main/mail/learn');

test('tokenize keeps words, lower-cased and once each', () => {
  assert.deepEqual(
    tokenize('Ihre Rechnung Nr. 4711: Rechnung über 12,50 € – bitte ÜBERWEISEN!'),
    ['ihre', 'rechnung', 'über', 'bitte', 'überweisen'],
  );
});

test('tokenize drops short words, numbers, addresses of links and very long strings', () => {
  const tokens = tokenize(`ab 12345 https://tracker.example/abc?x=1 ${'x'.repeat(40)} Termin`);
  assert.deepEqual(tokens, ['https', 'tracker', 'example', 'abc', 'termin']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(undefined), []);
});

test('tokenize limits the number of tokens', () => {
  const many = Array.from({ length: MAX_TOKENS + 50 }, (_, i) => `wort${'a'.repeat(1 + (i % 20))}${String.fromCharCode(97 + (i % 26))}${i}`.replace(/\d/g, 'q'));
  assert.ok(tokenize(many.join(' ')).length <= MAX_TOKENS);
});

function examples() {
  const list = [];
  for (let i = 0; i < 6; i += 1) {
    list.push({ label: true, tokens: ['rechnung', 'betrag', 'überweisen', `kunde${'abcdef'[i]}`] });
    list.push({ label: false, tokens: ['rabatt', 'angebot', 'jetzt', `aktion${'abcdef'[i]}`] });
  }
  return list;
}

test('a model is only ready with enough examples of both kinds', () => {
  assert.equal(MIN_PER_CLASS, 5);
  assert.equal(createModel([]).ready, false);
  const onlyImportant = examples().filter((e) => e.label);
  assert.equal(createModel(onlyImportant).ready, false);
  const model = createModel(examples());
  assert.equal(model.ready, true);
  assert.deepEqual(model.counts, { important: 6, other: 6 });
});

test('the model recognises what resembles the examples', () => {
  const model = createModel(examples());
  assert.ok(model.score(['rechnung', 'betrag', 'neu']) > 0.9);
  assert.ok(model.score(['rabatt', 'angebot', 'neu']) < 0.1);
  const unknown = model.score(['völlig', 'andere', 'wörter']);
  assert.ok(unknown > 0.3 && unknown < 0.7, String(unknown));
  assert.ok(model.score([]) > 0.3 && model.score([]) < 0.7);
});

test('training store keeps one decision per mail and survives a restart', (t) => {
  const file = path.join(makeTempDir(t), 'training.json');
  const store = createTrainingStore(file);
  assert.deepEqual(store.all(), []);
  store.set('a1|7', { label: true, tokens: ['rechnung'] });
  store.set('a1|8', { label: false, tokens: ['rabatt'] });
  store.set('a1|7', { label: false, tokens: ['rechnung'] });
  assert.deepEqual(createTrainingStore(file).all(), [
    { id: 'a1|8', label: false, tokens: ['rabatt'] },
    { id: 'a1|7', label: false, tokens: ['rechnung'] },
  ]);
  assert.equal(store.get('a1|7').label, false);
  assert.equal(store.get('fremd'), null);
  store.remove('a1|8');
  assert.deepEqual(store.all().map((e) => e.id), ['a1|7']);
  store.clear();
  assert.deepEqual(createTrainingStore(file).all(), []);
});

test('training store drops the oldest decisions beyond its limit and ignores a corrupt file', (t) => {
  const file = path.join(makeTempDir(t), 'training.json');
  const store = createTrainingStore(file, { limit: 3 });
  for (let i = 0; i < 5; i += 1) store.set(`m${i}`, { label: true, tokens: ['x'] });
  assert.deepEqual(store.all().map((e) => e.id), ['m2', 'm3', 'm4']);
  fs.writeFileSync(file, '{kaputt');
  assert.deepEqual(createTrainingStore(file).all(), []);
});
