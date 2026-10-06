const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTempDir } = require('./helpers/tmp');
const { makeSandbox } = require('../scripts/make-sandbox');
const { resolveSandboxDir, SANDBOX_MARKER } = require('../src/main/paths');

test('makeSandbox fills a new folder with example files of the right age', (t) => {
  const dir = path.join(makeTempDir(t), 'sb');
  makeSandbox(dir);

  const ageDays = (p) => (Date.now() - fs.statSync(path.join(dir, p)).mtimeMs) / 86_400_000;
  assert.ok(ageDays('Temp\\alt-1.tmp') > 2);
  assert.ok(ageDays('Temp\\frisch.tmp') < 1);
  assert.ok(fs.existsSync(path.join(dir, 'LocalAppData', 'Microsoft', 'Edge', 'User Data', 'Default', 'History')));
  assert.ok(fs.existsSync(path.join(dir, 'Windows', 'SoftwareDistribution', 'Download')));
  assert.equal(fs.statSync(path.join(dir, 'Dokumente', 'Vertrag.bin')).size, 2 * 1024 * 1024);
});

test('makeSandbox accepts an existing empty folder', (t) => {
  const dir = makeTempDir(t);
  makeSandbox(dir);
  assert.ok(fs.existsSync(path.join(dir, 'Downloads')));
});

test('makeSandbox refuses a folder that already has content', (t) => {
  const dir = makeTempDir(t);
  const precious = path.join(dir, 'wichtig.txt');
  fs.writeFileSync(precious, 'real data');
  assert.throws(() => makeSandbox(dir), /not empty/);
  assert.equal(fs.readFileSync(precious, 'utf8'), 'real data');
  assert.deepEqual(fs.readdirSync(dir), ['wichtig.txt']);
});

test('makeSandbox refuses a path that is a file', (t) => {
  const file = path.join(makeTempDir(t), 'file.txt');
  fs.writeFileSync(file, 'x');
  assert.throws(() => makeSandbox(file), /not a folder/);
});

test('makeSandbox writes the marker file that the app requires', (t) => {
  const dir = path.join(makeTempDir(t), 'sb');
  makeSandbox(dir);
  assert.ok(fs.statSync(path.join(dir, SANDBOX_MARKER)).isFile());
  assert.equal(resolveSandboxDir({ MYDESK_SANDBOX: dir }), dir);
});

test('a refused folder gets no marker', (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, 'wichtig.txt'), 'x');
  assert.throws(() => makeSandbox(dir));
  assert.equal(fs.existsSync(path.join(dir, SANDBOX_MARKER)), false);
});
