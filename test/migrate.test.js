const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTempDir } = require('./helpers/tmp');
const { migrateUserData, USER_FILES } = require('../src/main/migrate');

test('copies the data files of the old program name into the new folder', (t) => {
  const base = makeTempDir(t);
  const from = path.join(base, 'Aufräumzentrale');
  const to = path.join(base, 'MyDesk');
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, 'settings.json'), '{"mailSinceDays":30}');
  fs.writeFileSync(path.join(from, 'accounts.json'), '[]');
  fs.writeFileSync(path.join(from, 'Cache.bin'), 'x');

  assert.deepEqual(migrateUserData({ from, to }), ['settings.json', 'accounts.json']);
  assert.equal(fs.readFileSync(path.join(to, 'settings.json'), 'utf8'), '{"mailSinceDays":30}');
  assert.ok(!fs.existsSync(path.join(to, 'Cache.bin')));
  // The old folder stays as it is.
  assert.ok(fs.existsSync(path.join(from, 'settings.json')));
});

test('never overwrites data that already exists in the new folder', (t) => {
  const base = makeTempDir(t);
  const from = path.join(base, 'alt');
  const to = path.join(base, 'neu');
  fs.mkdirSync(from);
  fs.mkdirSync(to);
  fs.writeFileSync(path.join(from, 'settings.json'), 'alt');
  fs.writeFileSync(path.join(from, 'training.json'), 'alt');
  fs.writeFileSync(path.join(to, 'settings.json'), 'neu');

  assert.deepEqual(migrateUserData({ from, to }), ['training.json']);
  assert.equal(fs.readFileSync(path.join(to, 'settings.json'), 'utf8'), 'neu');
});

test('does nothing without an old folder and never throws', (t) => {
  const base = makeTempDir(t);
  assert.deepEqual(migrateUserData({ from: path.join(base, 'fehlt'), to: path.join(base, 'neu') }), []);
  assert.deepEqual(migrateUserData({ from: base, to: base }), []);
  assert.ok(USER_FILES.includes('unsubscribed.json'));
});

// ---- the key the passwords are encrypted with ("Local State") ----

function folders(t) {
  const base = makeTempDir(t);
  const from = path.join(base, 'alt');
  const to = path.join(base, 'neu');
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, 'Local State'), 'alter-schluessel');
  fs.writeFileSync(path.join(from, 'accounts.json'), '[{"id":"a"}]');
  return { from, to };
}

test('first start under the new name takes the key along with the accounts', (t) => {
  const { from, to } = folders(t);
  migrateUserData({ from, to });
  assert.equal(fs.readFileSync(path.join(to, 'Local State'), 'utf8'), 'alter-schluessel');
  assert.equal(fs.readFileSync(path.join(to, 'accounts.json'), 'utf8'), '[{"id":"a"}]');
});

test('repairs a folder where the accounts were copied without their key', (t) => {
  // State left behind by version 0.3.0: accounts copied, but a new key of its own.
  const { from, to } = folders(t);
  fs.mkdirSync(to);
  fs.writeFileSync(path.join(to, 'accounts.json'), '[{"id":"a"}]');
  fs.writeFileSync(path.join(to, 'Local State'), 'neuer-schluessel');
  migrateUserData({ from, to });
  assert.equal(fs.readFileSync(path.join(to, 'Local State'), 'utf8'), 'alter-schluessel');
});

test('leaves the key alone once accounts were saved under the new name', (t) => {
  const { from, to } = folders(t);
  fs.mkdirSync(to);
  fs.writeFileSync(path.join(to, 'accounts.json'), '[{"id":"neu"}]');
  fs.writeFileSync(path.join(to, 'Local State'), 'neuer-schluessel');
  migrateUserData({ from, to });
  assert.equal(fs.readFileSync(path.join(to, 'Local State'), 'utf8'), 'neuer-schluessel');
});

test('the key is taken over only once', (t) => {
  const { from, to } = folders(t);
  migrateUserData({ from, to });
  // Later the program writes its own state into the file; the old key must not come back.
  fs.writeFileSync(path.join(to, 'Local State'), 'spaeterer-stand');
  migrateUserData({ from, to });
  assert.equal(fs.readFileSync(path.join(to, 'Local State'), 'utf8'), 'spaeterer-stand');
});

test('without old accounts or without an old key nothing is touched', (t) => {
  const base = makeTempDir(t);
  const from = path.join(base, 'alt');
  const to = path.join(base, 'neu');
  fs.mkdirSync(from);
  fs.mkdirSync(to);
  fs.writeFileSync(path.join(from, 'Local State'), 'alter-schluessel');
  fs.writeFileSync(path.join(to, 'Local State'), 'neuer-schluessel');
  migrateUserData({ from, to });
  assert.equal(fs.readFileSync(path.join(to, 'Local State'), 'utf8'), 'neuer-schluessel');
});
