const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { measurePath, measureContents, removeContents } = require('../src/main/disk/walk');
const { makeTempDir, writeFile } = require('./helpers/tmp');

const HOUR_MS = 60 * 60 * 1000;

// NTFS timestamps of just-created entries can be a millisecond or two ahead of
// Date.now(). Tests with fresh entries and no age rule therefore pass a "now"
// a little later, so that "everything counts" is not a race.
const laterNow = () => Date.now() + 10 * 1000;

// Denies the current user the right to list `dir` while `fn` runs, and always
// restores the permission afterwards (before the temp dir is cleaned up).
async function withListingDenied(dir, fn) {
  const user = execFileSync('whoami', { encoding: 'utf8' }).trim();
  execFileSync('icacls', [dir, '/deny', `${user}:(RD)`], { stdio: 'ignore' });
  try {
    await fn();
  } finally {
    execFileSync('icacls', [dir, '/remove:d', user], { stdio: 'ignore' });
  }
}

test('measures nested files', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'a.bin'), 100);
  writeFile(path.join(root, 'sub', 'b.bin'), 200);
  writeFile(path.join(root, 'sub', 'deep', 'c.bin'), 300);

  assert.deepEqual(await measureContents(root, { now: laterNow() }), { bytes: 600, files: 3, unreadable: false });

  const whole = await measurePath(root);
  assert.equal(whole.bytes, 600);
  assert.equal(whole.files, 3);
  assert.equal(whole.unreadable, false);

  const single = await measurePath(path.join(root, 'sub', 'b.bin'));
  assert.equal(single.bytes, 200);
  assert.equal(single.files, 1);
});

test('measurePath reports the newest modification time inside a folder', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'old.bin'), 1, { daysOld: 10 });
  writeFile(path.join(root, 'sub', 'newer.bin'), 1, { daysOld: 2 });

  const result = await measurePath(root);
  const expected = Date.now() - 2 * 24 * HOUR_MS;
  assert.ok(Math.abs(result.newestMtimeMs - expected) < 60 * 1000);
});

test('missing root is empty', async (t) => {
  const missing = path.join(makeTempDir(t), 'does-not-exist');

  assert.deepEqual(await measureContents(missing), { bytes: 0, files: 0, unreadable: false });
  const measured = await measurePath(missing);
  assert.equal(measured.bytes, 0);
  assert.equal(measured.files, 0);
  assert.equal(measured.unreadable, false);
  assert.deepEqual(await removeContents(missing), { freedBytes: 0, deleted: 0, skipped: 0 });
});

test('unreadable root is flagged', async (t) => {
  const parent = makeTempDir(t);
  const locked = path.join(parent, 'locked');
  writeFile(path.join(locked, 'hidden.bin'), 100);

  await withListingDenied(locked, async () => {
    assert.deepEqual(await measureContents(locked), { bytes: 0, files: 0, unreadable: true });
    assert.equal((await measurePath(locked)).unreadable, true);
  });
});

test('unreadable entry under root adds nothing and is skipped on removal', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'plain.tmp'), 100, { daysOld: 3 });
  const locked = path.join(root, 'locked');
  writeFile(path.join(locked, 'hidden.bin'), 500, { daysOld: 3 });
  const lockedTime = new Date(Date.now() - 3 * 24 * HOUR_MS);
  fs.utimesSync(locked, lockedTime, lockedTime);

  await withListingDenied(locked, async () => {
    assert.deepEqual(await measureContents(root), { bytes: 100, files: 1, unreadable: false });
    assert.deepEqual(await removeContents(root), { freedBytes: 100, deleted: 1, skipped: 1 });
  });

  assert.equal(fs.existsSync(path.join(root, 'plain.tmp')), false);
  assert.equal(fs.existsSync(path.join(locked, 'hidden.bin')), true);
});

test('junction is not followed', async (t) => {
  const base = makeTempDir(t);
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  writeFile(path.join(outside, 'keep.bin'), 1000);
  writeFile(path.join(root, 'own.tmp'), 10);
  const link = path.join(root, 'link');
  fs.symlinkSync(outside, link, 'junction');

  assert.deepEqual(await measureContents(root, { now: laterNow() }), { bytes: 10, files: 1, unreadable: false });
  assert.equal((await measurePath(link)).bytes, 0);

  const result = await removeContents(root, { now: laterNow() });

  assert.equal(result.freedBytes, 10);
  assert.equal(result.skipped, 0);
  assert.equal(fs.existsSync(path.join(outside, 'keep.bin')), true);
  assert.equal(fs.readdirSync(root).length, 0, 'root should be empty, link included');
});

test('junction nested below a folder is not followed either', async (t) => {
  const base = makeTempDir(t);
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  writeFile(path.join(outside, 'keep.bin'), 1000);
  writeFile(path.join(root, 'sub', 'own.tmp'), 10);
  fs.symlinkSync(outside, path.join(root, 'sub', 'link'), 'junction');

  assert.equal((await measureContents(root, { now: laterNow() })).bytes, 10);

  await removeContents(root, { now: laterNow() });

  assert.equal(fs.existsSync(path.join(outside, 'keep.bin')), true);
  assert.equal(fs.readdirSync(root).length, 0);
});

test('minAge keeps fresh entries', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'alt.tmp'), 100, { daysOld: 3 });
  writeFile(path.join(root, 'neu.tmp'), 50, { daysOld: 1 / 24 });
  writeFile(path.join(root, 'ordner', 'alt.bin'), 10, { daysOld: 5 });
  writeFile(path.join(root, 'ordner', 'frisch.bin'), 20, { daysOld: 0.01 });
  const minAgeMs = 24 * HOUR_MS;

  assert.deepEqual(await measureContents(root, { minAgeMs }), {
    bytes: 100,
    files: 1,
    unreadable: false,
  });

  const result = await removeContents(root, { minAgeMs });

  assert.deepEqual(result, { freedBytes: 100, deleted: 1, skipped: 0 });
  assert.equal(fs.existsSync(path.join(root, 'alt.tmp')), false);
  assert.equal(fs.existsSync(path.join(root, 'neu.tmp')), true);
  assert.equal(fs.existsSync(path.join(root, 'ordner', 'alt.bin')), true, 'old file in a fresh folder stays');
  assert.equal(fs.existsSync(path.join(root, 'ordner', 'frisch.bin')), true);
});

test('minAge removes a whole folder once everything in it is old enough', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'ordner', 'a.bin'), 10, { daysOld: 5 });
  writeFile(path.join(root, 'ordner', 'sub', 'b.bin'), 20, { daysOld: 4 });

  const result = await removeContents(root, { minAgeMs: 24 * HOUR_MS });

  assert.deepEqual(result, { freedBytes: 30, deleted: 2, skipped: 0 });
  assert.equal(fs.readdirSync(root).length, 0);
});

test('failed delete is skipped', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'busy.tmp'), 100);
  writeFile(path.join(root, 'free.tmp'), 40);
  const fsp = {
    ...fs.promises,
    unlink: async (p) => {
      if (path.basename(p) === 'busy.tmp') {
        throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
      }
      return fs.promises.unlink(p);
    },
  };

  const result = await removeContents(root, { fsp, now: laterNow() });

  assert.deepEqual(result, { freedBytes: 40, deleted: 1, skipped: 1 });
  assert.equal(fs.existsSync(path.join(root, 'busy.tmp')), true);
  assert.equal(fs.existsSync(path.join(root, 'free.tmp')), false);
});

test('a folder with a failed delete stays, the rest of it goes', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'ordner', 'busy.tmp'), 100);
  writeFile(path.join(root, 'ordner', 'free.tmp'), 40);
  const fsp = {
    ...fs.promises,
    unlink: async (p) => {
      if (path.basename(p) === 'busy.tmp') {
        throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
      }
      return fs.promises.unlink(p);
    },
  };

  const result = await removeContents(root, { fsp, now: laterNow() });

  assert.deepEqual(result, { freedBytes: 40, deleted: 1, skipped: 1 });
  assert.deepEqual(fs.readdirSync(path.join(root, 'ordner')), ['busy.tmp']);
});

test('root itself survives', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'a.bin'), 10);
  writeFile(path.join(root, 'sub', 'b.bin'), 20);

  const result = await removeContents(root, { now: laterNow() });

  assert.deepEqual(result, { freedBytes: 30, deleted: 2, skipped: 0 });
  assert.equal(fs.existsSync(root), true);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('an aborted signal rejects with AbortError', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'a.bin'), 10);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(measureContents(root, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(measurePath(root, { signal: controller.signal }), { name: 'AbortError' });
});

test('measureContents skips top-level names the ignore callback names', async (t) => {
  const root = makeTempDir(t);
  writeFile(path.join(root, 'keep.bin'), 100);
  writeFile(path.join(root, 'skip.ini'), 7);
  writeFile(path.join(root, 'sub', 'skip.ini'), 9);

  const result = await measureContents(root, { now: laterNow(), ignore: (name) => name === 'skip.ini' });
  assert.deepEqual(result, { bytes: 109, files: 2, unreadable: false });
});

test('a root that is itself a junction is entered: only links INSIDE a root are never followed', async (t) => {
  const target = makeTempDir(t);
  const holder = makeTempDir(t);
  writeFile(path.join(target, 'inside.bin'), 100);
  const link = path.join(holder, 'redirected');
  fs.symlinkSync(target, link, 'junction');

  assert.deepEqual(await measureContents(link, { now: laterNow() }), { bytes: 100, files: 1, unreadable: false });
  const removed = await removeContents(link, { now: laterNow() });
  assert.equal(removed.deleted, 1);
  assert.equal(fs.existsSync(path.join(target, 'inside.bin')), false, 'the target of a redirected root is cleaned');
});
