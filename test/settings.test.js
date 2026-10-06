const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSettingsStore } = require('../src/main/settings.js');
const { makeTempDir } = require('./helpers/tmp.js');

const KEYWORDS = [
  "Rechnung", "Mahnung", "Zahlungserinnerung", "Termin", "Vertrag", "Kündigung", "Frist",
  "Bescheid", "Sicherheit", "Passwort", "Anmeldung", "Lieferung", "Bestellung",
];
const DEFAULTS = {
  downloadsMaxAgeDays: 90,
  mailSinceDays: 90,
  importantKeywords: KEYWORDS,
  theme: 'system',
  style: 'classic',
  userName: '',
  homeGreeting: true,
  homeClock: true,
  homeSummary: true,
  homeTip: true,
  animations: true,
  autoCheckOnStart: false,
  sidebarExpanded: false,
  hiddenTiles: [],
  lastSeenVersion: '',
};

test('missing file yields defaults', (t) => {
  const store = createSettingsStore(makeTempDir(t));
  assert.deepEqual(store.load(), DEFAULTS);
});

test('save merges and persists', (t) => {
  const dir = makeTempDir(t);
  const saved = createSettingsStore(dir).save({ downloadsMaxAgeDays: 30 });
  assert.deepEqual(saved, { ...DEFAULTS, downloadsMaxAgeDays: 30 });
  assert.deepEqual(createSettingsStore(dir).load(), { ...DEFAULTS, downloadsMaxAgeDays: 30 });
  // a second save keeps earlier values
  createSettingsStore(dir).save({ mailSinceDays: 5 });
  assert.deepEqual(createSettingsStore(dir).load(), {
    ...DEFAULTS, downloadsMaxAgeDays: 30, mailSinceDays: 5,
  });
});

test('corrupt json yields defaults', (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{kaputt');
  assert.deepEqual(createSettingsStore(dir).load(), DEFAULTS);
});

test('invalid values fall back', (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    downloadsMaxAgeDays: -5, mailSinceDays: 'x', hiddenTiles: 'c:\\',
  }));
  assert.deepEqual(createSettingsStore(dir).load(), DEFAULTS);
});

test('invalid values in save fall back per field', (t) => {
  const store = createSettingsStore(makeTempDir(t));
  store.save({ downloadsMaxAgeDays: 30 });
  const result = store.save({ downloadsMaxAgeDays: 1.5, mailSinceDays: 200000, hiddenTiles: [1] });
  assert.deepEqual(result, DEFAULTS);
});

test('boundary values are accepted', (t) => {
  const store = createSettingsStore(makeTempDir(t));
  assert.deepEqual(
    store.save({ downloadsMaxAgeDays: 3650, mailSinceDays: 1, hiddenTiles: ['junk'] }),
    { ...DEFAULTS, downloadsMaxAgeDays: 3650, mailSinceDays: 1, hiddenTiles: ['junk'] },
  );
  assert.equal(store.save({ downloadsMaxAgeDays: 1, mailSinceDays: 3650 }).downloadsMaxAgeDays, 1);
  assert.equal(store.load().mailSinceDays, 3650);
});

test('unknown keys are dropped', (t) => {
  const dir = makeTempDir(t);
  const store = createSettingsStore(dir);
  store.save({ foo: 1 });
  assert.deepEqual(store.load(), DEFAULTS);
  assert.ok(!('foo' in store.load()));
  assert.ok(!fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('foo'));
});

test('save creates a missing directory and leaves no temp file', (t) => {
  const dir = path.join(makeTempDir(t), 'nested', 'config');
  createSettingsStore(dir).save({ downloadsMaxAgeDays: 7 });
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('load returns independent copies of the defaults', (t) => {
  const store = createSettingsStore(makeTempDir(t));
  store.load().hiddenTiles.push('x');
  assert.deepEqual(store.load().hiddenTiles, []);
});

test("mail settings: invalid values fall back, valid ones persist", (t) => {
  const dir = makeTempDir(t);
  const store = createSettingsStore(dir);
  const saved = store.save({ mailSinceDays: 0, importantKeywords: "x", importantSenders: ["a@b.de"] });
  assert.equal(saved.mailSinceDays, 90);
  assert.deepEqual(saved.importantKeywords, KEYWORDS);
  assert.equal(saved.importantSenders, undefined);
  assert.equal(store.save({ mailSinceDays: 30, importantKeywords: [] }).mailSinceDays, 30);
  assert.deepEqual(createSettingsStore(dir).load().importantKeywords, []);
});

test('interface settings accept only their allowed values', (t) => {
  const store = createSettingsStore(makeTempDir(t));
  const saved = store.save({ theme: 'dark', animations: false, autoCheckOnStart: true, sidebarExpanded: true, hiddenTiles: ['junk'], lastSeenVersion: '0.3.0' });
  assert.deepEqual(
    [saved.theme, saved.animations, saved.autoCheckOnStart, saved.sidebarExpanded, saved.hiddenTiles, saved.lastSeenVersion],
    ['dark', false, true, true, ['junk'], '0.3.0'],
  );
  const bad = store.save({ theme: 'pink', animations: 'ja', hiddenTiles: 'alle', lastSeenVersion: 3 });
  assert.deepEqual([bad.theme, bad.animations, bad.hiddenTiles, bad.lastSeenVersion], ['system', true, [], '']);
});

test('settings of the removed duplicate search are dropped from an existing file', (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ duplicateMinSizeMB: 5, extraDuplicateFolders: ['D:\\x'], mailSinceDays: 30 }));
  assert.deepEqual(createSettingsStore(dir).load(), { ...DEFAULTS, mailSinceDays: 30 });
});

test('start page settings accept only their allowed values', (t) => {
  const store = createSettingsStore(makeTempDir(t));
  const saved = store.save({ style: 'glass', userName: 'Alex', homeGreeting: false, homeClock: false, homeSummary: false, homeTip: false });
  assert.deepEqual(
    [saved.style, saved.userName, saved.homeGreeting, saved.homeClock, saved.homeSummary, saved.homeTip],
    ['glass', 'Alex', false, false, false, false],
  );
  const bad = store.save({ style: 'neon', userName: 'x'.repeat(41), homeTip: 'ja' });
  assert.deepEqual([bad.style, bad.userName, bad.homeTip], ['classic', '', true]);
});
