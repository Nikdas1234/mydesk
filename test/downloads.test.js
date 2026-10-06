const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { findOldDownloads } = require('../src/main/disk/downloads');
const { makeTempDir, writeFile } = require('./helpers/tmp');

const DAY_MS = 86_400_000;

// Sets the folder's own modification time to "now minus daysOld days".
function ageFolder(dir, daysOld) {
  const when = new Date(Date.now() - daysOld * DAY_MS);
  fs.utimesSync(dir, when, when);
}

test('lists only entries older than limit', async (t) => {
  const dir = makeTempDir(t);
  writeFile(path.join(dir, 'alt.zip'), 10, { daysOld: 120 });
  writeFile(path.join(dir, 'neu.exe'), 10, { daysOld: 10 });

  const result = await findOldDownloads(dir, { maxAgeDays: 90 });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'alt.zip');
  assert.equal(result[0].path, path.join(dir, 'alt.zip'));
  assert.equal(result[0].isDirectory, false);
  assert.equal(result[0].size, 10);
  assert.equal(result[0].ageDays, 120);
});

test('entry exactly at the limit is not old', async (t) => {
  const dir = makeTempDir(t);
  writeFile(path.join(dir, 'grenze.zip'), 10, { daysOld: 90 });
  writeFile(path.join(dir, 'drueber.zip'), 10, { daysOld: 91 });

  const result = await findOldDownloads(dir, { maxAgeDays: 90 });

  assert.deepEqual(result.map((e) => e.name), ['drueber.zip']);
});

test('ageDays is floored using the given now', async (t) => {
  const dir = makeTempDir(t);
  const file = writeFile(path.join(dir, 'a.bin'), 1, { daysOld: 0 });
  const mtimeMs = fs.statSync(file).mtimeMs;
  const now = mtimeMs + 100.9 * DAY_MS;

  const result = await findOldDownloads(dir, { maxAgeDays: 90, now });

  assert.equal(result.length, 1);
  assert.equal(result[0].ageDays, 100);
  assert.equal(result[0].mtimeMs, mtimeMs);
});

test('folder counts once with total size', async (t) => {
  const dir = makeTempDir(t);
  writeFile(path.join(dir, 'ordner', 'a.bin'), 100, { daysOld: 120 });
  writeFile(path.join(dir, 'ordner', 'unter', 'b.bin'), 200, { daysOld: 120 });
  ageFolder(path.join(dir, 'ordner'), 120);

  const result = await findOldDownloads(dir, { maxAgeDays: 90 });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'ordner');
  assert.equal(result[0].isDirectory, true);
  assert.equal(result[0].size, 300);
});

test('folder with fresh file inside is not old', async (t) => {
  const dir = makeTempDir(t);
  writeFile(path.join(dir, 'ordner', 'alt.bin'), 100, { daysOld: 200 });
  writeFile(path.join(dir, 'ordner', 'frisch.bin'), 100, { daysOld: 1 });
  ageFolder(path.join(dir, 'ordner'), 200);

  const result = await findOldDownloads(dir, { maxAgeDays: 90 });

  assert.deepEqual(result, []);
});

test('empty folder is dated by its own modification time', async (t) => {
  const dir = makeTempDir(t);
  fs.mkdirSync(path.join(dir, 'leer-alt'));
  fs.mkdirSync(path.join(dir, 'leer-neu'));
  ageFolder(path.join(dir, 'leer-alt'), 120);

  const result = await findOldDownloads(dir, { maxAgeDays: 90 });

  assert.deepEqual(result.map((e) => e.name), ['leer-alt']);
  assert.equal(result[0].isDirectory, true);
  assert.equal(result[0].size, 0);
});

test('desktop.ini is ignored', async (t) => {
  const dir = makeTempDir(t);
  writeFile(path.join(dir, 'desktop.ini'), 10, { daysOld: 500 });
  writeFile(path.join(dir, 'Desktop.INI.bak'), 10, { daysOld: 500 });
  writeFile(path.join(dir, 'DESKTOP.INI'), 10, { daysOld: 500 });

  const result = await findOldDownloads(dir, { maxAgeDays: 90 });

  // Only the exact name (any casing) is skipped, not names that merely contain it.
  assert.deepEqual(result.map((e) => e.name), ['Desktop.INI.bak']);
});

test('sorted by size descending', async (t) => {
  const dir = makeTempDir(t);
  writeFile(path.join(dir, 'klein.bin'), 10, { daysOld: 200 });
  writeFile(path.join(dir, 'gross.bin'), 1000, { daysOld: 200 });
  writeFile(path.join(dir, 'mittel.bin'), 100, { daysOld: 200 });

  const result = await findOldDownloads(dir, { maxAgeDays: 90 });

  assert.deepEqual(result.map((e) => e.name), ['gross.bin', 'mittel.bin', 'klein.bin']);
});

test('missing directory yields empty list', async (t) => {
  const dir = makeTempDir(t);

  const result = await findOldDownloads(path.join(dir, 'gibt-es-nicht'), { maxAgeDays: 90 });

  assert.deepEqual(result, []);
});

test('a link in the folder is an entry of size 0 and its target is not followed', async (t) => {
  const dir = makeTempDir(t);
  const target = path.join(dir, 'ziel');
  writeFile(path.join(target, 'gross.bin'), 5000, { daysOld: 200 });
  ageFolder(target, 200);
  const link = path.join(dir, 'verknuepfung');
  fs.symlinkSync(target, link, 'junction');
  const when = new Date(Date.now() - 200 * DAY_MS);
  fs.lutimesSync(link, when, when);

  const result = await findOldDownloads(dir, { maxAgeDays: 90 });

  const linkEntry = result.find((e) => e.name === 'verknuepfung');
  assert.ok(linkEntry, 'link is listed');
  assert.equal(linkEntry.size, 0);
  assert.equal(linkEntry.isDirectory, false);
  assert.equal(result.find((e) => e.name === 'ziel').size, 5000);
});

test('aborted signal rejects with AbortError', async (t) => {
  const dir = makeTempDir(t);
  writeFile(path.join(dir, 'a.bin'), 10, { daysOld: 200 });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    findOldDownloads(dir, { maxAgeDays: 90, signal: controller.signal }),
    { name: 'AbortError' },
  );
});

for (const [label, value] of [['undefined', undefined], ['NaN', NaN], ['Infinity', Infinity], ['a text', '90'], ['null', null]]) {
  test(`findOldDownloads refuses maxAgeDays that is not a finite number: ${label}`, async (t) => {
    const dir = makeTempDir(t);
    writeFile(path.join(dir, 'alt.zip'), 10, { daysOld: 120 });
    await assert.rejects(findOldDownloads(dir, { maxAgeDays: value }), /maxAgeDays/);
  });
}
