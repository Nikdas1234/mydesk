const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTempDir } = require('./helpers/tmp');
const { createHistory } = require('../src/main/history');
const { listDrives } = require('../src/main/disk/drives');

const EMPTY = { mail: null, junk: null, downloads: null, programs: null };

test('history starts empty and adds up what was freed', (t) => {
  const file = path.join(makeTempDir(t), 'history.json');
  let clock = 1000;
  const history = createHistory(file, { now: () => clock });
  assert.deepEqual(history.get(), { freedBytes: 0, since: null, lastChecked: EMPTY });

  history.addFreed(500);
  clock = 2000;
  history.addFreed(250);
  history.addFreed(0);
  history.addFreed(-5);
  history.addFreed(NaN);
  assert.deepEqual(createHistory(file).get(), { freedBytes: 750, since: 1000, lastChecked: EMPTY });
});

test('history remembers when each area was last checked', (t) => {
  const file = path.join(makeTempDir(t), 'history.json');
  let clock = 5000;
  const history = createHistory(file, { now: () => clock });
  history.markChecked('junk');
  clock = 6000;
  history.markChecked('mail');
  history.markChecked('unbekannt');
  assert.deepEqual(history.get().lastChecked, { ...EMPTY, junk: 5000, mail: 6000 });
});

test('history survives a corrupt file and an unwritable place', (t) => {
  const dir = makeTempDir(t);
  const file = path.join(dir, 'history.json');
  fs.writeFileSync(file, '{kaputt');
  const history = createHistory(file);
  assert.equal(history.get().freedBytes, 0);
  history.addFreed(10);
  assert.equal(history.get().freedBytes, 10);

  // A folder where the file should be: writing fails, but nothing is thrown.
  const blocked = path.join(dir, 'ordner.json');
  fs.mkdirSync(blocked);
  const broken = createHistory(blocked);
  broken.addFreed(10);
  broken.markChecked('junk');
  assert.equal(broken.get().freedBytes, 0);
});

test('listDrives reports the drives that answer, sorted by letter', async () => {
  const statfs = async (root) => {
    if (root === 'D:\\') return { bsize: 4096, blocks: 1000, bavail: 250 };
    if (root === 'C:\\') return { bsize: 4096n, blocks: 2000n, bavail: 500n };
    if (root === 'E:\\') return { bsize: 4096, blocks: 0, bavail: 0 };
    throw new Error('ENOENT');
  };
  assert.deepEqual(await listDrives({ statfs }), [
    { letter: 'C', totalBytes: 8192000, freeBytes: 2048000 },
    { letter: 'D', totalBytes: 4096000, freeBytes: 1024000 },
  ]);
});
