const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createRemover } = require('../src/main/disk/remove');
const { measurePath } = require('../src/main/disk/walk');
const { makeTempDir, writeFile } = require('./helpers/tmp');

// A fake `trashItem` that deletes the file (or folder) and remembers the path.
// `failFor` lists paths for which it throws instead.
function fakeTrash({ failFor = [] } = {}) {
  const calls = [];
  async function trashItem(target) {
    calls.push(target);
    if (failFor.includes(target)) throw new Error('trash failed');
    fs.rmSync(target, { recursive: true, force: true });
  }
  return { trashItem, calls };
}

function entryOf(filePath, extra = {}) {
  const stat = fs.statSync(filePath);
  return { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs, ...extra };
}

test('refuses unregistered path and deletes nothing', async (t) => {
  const root = makeTempDir(t);
  const known = writeFile(path.join(root, 'known.bin'), 100);
  const foreign = writeFile(path.join(root, 'foreign.bin'), 100);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(known)]);

  await assert.rejects(remover.trash('downloads', [known, foreign]));

  assert.deepEqual(fake.calls, []);
  assert.ok(fs.existsSync(known));
  assert.ok(fs.existsSync(foreign));
});

test('refuses a path registered for the other kind and deletes nothing', async (t) => {
  const root = makeTempDir(t);
  const download = writeFile(path.join(root, 'download.bin'), 100);
  const dupA = writeFile(path.join(root, 'a.bin'), 100);
  const dupB = writeFile(path.join(root, 'b.bin'), 100);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(download)]);
  remover.register('duplicates', [entryOf(dupA, { group: 'g' }), entryOf(dupB, { group: 'g' })]);

  await assert.rejects(remover.trash('duplicates', [dupA, download]));
  await assert.rejects(remover.trash('downloads', [dupA]));

  assert.deepEqual(fake.calls, []);
  assert.ok(fs.existsSync(download));
  assert.ok(fs.existsSync(dupA));
});

test('refuses unknown kind on register and trash', async (t) => {
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });

  assert.throws(() => remover.register('everything', []));
  await assert.rejects(remover.trash('everything', []));
});

test('refuses to delete a whole duplicate group', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const c = writeFile(path.join(root, 'c.bin'), 100, { fill: 1 });
  const other = writeFile(path.join(root, 'other.bin'), 100, { fill: 2 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [
    entryOf(a, { group: 'g1' }),
    entryOf(b, { group: 'g1' }),
    entryOf(c, { group: 'g1' }),
    entryOf(other, { group: 'g2' }),
  ]);

  // Not the whole group: allowed.
  const ok = await remover.trash('duplicates', [a, b]);
  assert.equal(ok.deleted, 2);

  // The remaining member is now the last one of its group.
  await assert.rejects(remover.trash('duplicates', [c]), /group/i);
  assert.ok(fs.existsSync(c));
  assert.ok(fs.existsSync(other));
});

test('refuses a request that contains every file of a group and deletes nothing', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const x = writeFile(path.join(root, 'x.bin'), 100, { fill: 2 });
  const y = writeFile(path.join(root, 'y.bin'), 100, { fill: 2 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [
    entryOf(a, { group: 'g1' }),
    entryOf(b, { group: 'g1' }),
    entryOf(x, { group: 'g2' }),
    entryOf(y, { group: 'g2' }),
  ]);

  // First group is fine, second is complete: the whole request is refused.
  await assert.rejects(remover.trash('duplicates', [a, x, y]));

  assert.deepEqual(fake.calls, []);
  assert.ok(fs.existsSync(a));
});

test('counts duplicated paths in the request once', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [entryOf(a, { group: 'g' }), entryOf(b, { group: 'g' })]);

  const result = await remover.trash('duplicates', [a, a]);

  assert.deepEqual(result, { freedBytes: 100, deleted: 1, skipped: 0 });
  assert.deepEqual(fake.calls, [a]);
});

test('rejects a duplicate entry without group', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100);
  const remover = createRemover({ trashItem: fakeTrash().trashItem });

  assert.throws(() => remover.register('duplicates', [entryOf(a)]));
});

test('skips file changed since scan', async (t) => {
  const root = makeTempDir(t);
  const changed = writeFile(path.join(root, 'changed.bin'), 100);
  const untouched = writeFile(path.join(root, 'untouched.bin'), 100);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(changed), entryOf(untouched)]);

  fs.appendFileSync(changed, 'x');
  const result = await remover.trash('downloads', [changed, untouched]);

  assert.deepEqual(result, { freedBytes: 100, deleted: 1, skipped: 1 });
  assert.ok(fs.existsSync(changed));
  assert.ok(!fs.existsSync(untouched));
});

test('skips file whose modification date moved by more than 2 seconds', async (t) => {
  const root = makeTempDir(t);
  const touched = writeFile(path.join(root, 'touched.bin'), 100);
  const nearly = writeFile(path.join(root, 'nearly.bin'), 100);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(touched), entryOf(nearly)]);

  const stat = fs.statSync(touched);
  const later = new Date(stat.mtimeMs + 5000);
  fs.utimesSync(touched, later, later);
  const slightly = new Date(fs.statSync(nearly).mtimeMs + 1000);
  fs.utimesSync(nearly, slightly, slightly);
  const result = await remover.trash('downloads', [touched, nearly]);

  assert.deepEqual(result, { freedBytes: 100, deleted: 1, skipped: 1 });
  assert.ok(fs.existsSync(touched));
  assert.ok(!fs.existsSync(nearly));
});

test('skips file that vanished', async (t) => {
  const root = makeTempDir(t);
  const gone = writeFile(path.join(root, 'gone.bin'), 100);
  const here = writeFile(path.join(root, 'here.bin'), 100);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(gone), entryOf(here)]);

  fs.rmSync(gone);
  const result = await remover.trash('downloads', [gone, here]);

  assert.deepEqual(result, { freedBytes: 100, deleted: 1, skipped: 1 });
  assert.deepEqual(fake.calls, [here]);
});

test('skips a file that was replaced by a folder', async (t) => {
  const root = makeTempDir(t);
  const file = writeFile(path.join(root, 'thing'), 100);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(file)]);

  fs.rmSync(file);
  fs.mkdirSync(file);
  const result = await remover.trash('downloads', [file]);

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.deepEqual(fake.calls, []);
});

test('skips a file that was replaced by a link', async (t) => {
  const root = makeTempDir(t);
  const file = writeFile(path.join(root, 'thing'), 100);
  const target = writeFile(path.join(root, 'target.bin'), 100);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [{ path: file, size: 100, mtimeMs: fs.statSync(file).mtimeMs }]);

  fs.rmSync(file);
  try {
    fs.symlinkSync(target, file);
  } catch (err) {
    if (err.code === 'EPERM') return t.skip('symlinks need elevated rights here');
    throw err;
  }
  const result = await remover.trash('downloads', [file]);

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.deepEqual(fake.calls, []);
  assert.ok(fs.existsSync(target));
});

// Registers a folder the way the downloads scan does: total size and newest
// modification time of everything inside.
async function folderEntry(dir) {
  const m = await measurePath(dir);
  return { path: dir, size: m.bytes, mtimeMs: m.newestMtimeMs, isDirectory: true };
}

test('deletes an unchanged folder and skips one that vanished', async (t) => {
  const root = makeTempDir(t);
  const dir = path.join(root, 'folder');
  writeFile(path.join(dir, 'inner.bin'), 50, { daysOld: 200 });
  const vanished = path.join(root, 'vanished');
  writeFile(path.join(vanished, 'inner.bin'), 50, { daysOld: 200 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [await folderEntry(dir), await folderEntry(vanished)]);

  fs.rmSync(vanished, { recursive: true });
  const result = await remover.trash('downloads', [dir, vanished]);

  assert.deepEqual(result, { freedBytes: 50, deleted: 1, skipped: 1 });
  assert.ok(!fs.existsSync(dir));
});

test('skips a folder that got a new file after the scan', async (t) => {
  const root = makeTempDir(t);
  const dir = path.join(root, 'folder');
  writeFile(path.join(dir, 'old.bin'), 50, { daysOld: 200 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [await folderEntry(dir)]);

  writeFile(path.join(dir, 'fresh.bin'), 10);
  const result = await remover.trash('downloads', [dir]);

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.deepEqual(fake.calls, []);
  assert.ok(fs.existsSync(path.join(dir, 'fresh.bin')));
});

test('skips a folder whose content changed without changing the size', async (t) => {
  const root = makeTempDir(t);
  const dir = path.join(root, 'folder');
  const inner = writeFile(path.join(dir, 'a.bin'), 50, { daysOld: 200 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [await folderEntry(dir)]);

  fs.writeFileSync(inner, Buffer.alloc(50, 1)); // same size, newer date
  const result = await remover.trash('downloads', [dir]);

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.deepEqual(fake.calls, []);
});

test('skips a folder from which a file was removed after the scan', async (t) => {
  const root = makeTempDir(t);
  const dir = path.join(root, 'folder');
  writeFile(path.join(dir, 'a.bin'), 50, { daysOld: 200 });
  writeFile(path.join(dir, 'b.bin'), 30, { daysOld: 200 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [await folderEntry(dir)]);

  fs.rmSync(path.join(dir, 'b.bin'));
  const result = await remover.trash('downloads', [dir]);

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.deepEqual(fake.calls, []);
});

test('skips a folder that cannot be read any more', async (t) => {
  const root = makeTempDir(t);
  const dir = path.join(root, 'folder');
  writeFile(path.join(dir, 'a.bin'), 50, { daysOld: 200 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [await folderEntry(dir)]);

  const user = execFileSync('whoami', { encoding: 'utf8' }).trim();
  execFileSync('icacls', [dir, '/deny', `${user}:(RD)`], { stdio: 'ignore' });
  let result;
  try {
    result = await remover.trash('downloads', [dir]);
  } finally {
    execFileSync('icacls', [dir, '/remove:d', user], { stdio: 'ignore' });
  }

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.deepEqual(fake.calls, []);
});

test('skips a folder that was replaced by a file', async (t) => {
  const root = makeTempDir(t);
  const dir = path.join(root, 'folder');
  fs.mkdirSync(dir);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [{ path: dir, size: 10, mtimeMs: 1, isDirectory: true }]);

  fs.rmdirSync(dir);
  writeFile(dir, 10);
  const result = await remover.trash('downloads', [dir]);

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.deepEqual(fake.calls, []);
});

test('counts trash failures as skipped', async (t) => {
  const root = makeTempDir(t);
  const bad = writeFile(path.join(root, 'bad.bin'), 100);
  const good = writeFile(path.join(root, 'good.bin'), 200);
  const fake = fakeTrash({ failFor: [bad] });
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(bad), entryOf(good)]);

  const result = await remover.trash('downloads', [bad, good]);

  assert.deepEqual(result, { freedBytes: 200, deleted: 1, skipped: 1 });
  assert.ok(fs.existsSync(bad));
  // A failed file stays registered and can be tried again.
  assert.ok(remover.isRegistered(bad));
  assert.ok(!remover.isRegistered(good));
});

test('reports freed bytes and forgets deleted paths', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100);
  const b = writeFile(path.join(root, 'b.bin'), 250);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(a), entryOf(b)]);

  const result = await remover.trash('downloads', [a, b]);

  assert.deepEqual(result, { freedBytes: 350, deleted: 2, skipped: 0 });
  assert.equal(remover.isRegistered(a), false);
  await assert.rejects(remover.trash('downloads', [a]));
  assert.deepEqual(fake.calls, [a, b]);
});

test('register replaces earlier results of the same kind only', async (t) => {
  const root = makeTempDir(t);
  const old = writeFile(path.join(root, 'old.bin'), 100);
  const fresh = writeFile(path.join(root, 'fresh.bin'), 100);
  const dupA = writeFile(path.join(root, 'dupA.bin'), 100);
  const dupB = writeFile(path.join(root, 'dupB.bin'), 100);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(old)]);
  remover.register('duplicates', [entryOf(dupA, { group: 'g' }), entryOf(dupB, { group: 'g' })]);
  remover.register('downloads', [entryOf(fresh)]);

  assert.equal(remover.isRegistered(old), false);
  assert.equal(remover.isRegistered(fresh), true);
  assert.equal(remover.isRegistered(dupA), true);
  await assert.rejects(remover.trash('downloads', [old]));
  assert.equal((await remover.trash('downloads', [fresh])).deleted, 1);
});

test('re-registering duplicates resets the group bookkeeping', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [entryOf(a, { group: 'g' }), entryOf(b, { group: 'g' })]);
  // A new scan finds a third copy of the same group.
  const c = writeFile(path.join(root, 'c.bin'), 100, { fill: 1 });
  remover.register('duplicates', [
    entryOf(a, { group: 'g' }),
    entryOf(b, { group: 'g' }),
    entryOf(c, { group: 'g' }),
  ]);

  const result = await remover.trash('duplicates', [a, b]);

  assert.equal(result.deleted, 2);
});

test('isRegistered ignores case and slash style but trash uses the original path', async (t) => {
  const root = makeTempDir(t);
  const file = writeFile(path.join(root, 'Mixed Case.bin'), 100);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('downloads', [entryOf(file)]);

  const variant = file.toUpperCase().replaceAll('\\', '/');
  assert.equal(remover.isRegistered(variant), true);
  assert.equal(remover.isRegistered(path.join(root, 'other.bin')), false);

  const result = await remover.trash('downloads', [variant]);

  assert.equal(result.deleted, 1);
  assert.deepEqual(fake.calls, [file]);
});

test('isRegistered works for either kind', async (t) => {
  const root = makeTempDir(t);
  const download = writeFile(path.join(root, 'd.bin'), 10);
  const dup = writeFile(path.join(root, 'u.bin'), 10);
  const remover = createRemover({ trashItem: fakeTrash().trashItem });
  remover.register('downloads', [entryOf(download)]);
  remover.register('duplicates', [entryOf(dup, { group: 'g' })]);

  assert.equal(remover.isRegistered(download), true);
  assert.equal(remover.isRegistered(dup), true);
  assert.equal(remover.isRegistered(path.join(root, 'nope.bin')), false);
});

test('concurrent requests cannot together delete a whole group', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [entryOf(a, { group: 'g' }), entryOf(b, { group: 'g' })]);

  const results = await Promise.allSettled([
    remover.trash('duplicates', [a]),
    remover.trash('duplicates', [b]),
  ]);

  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.ok(fs.existsSync(b));
});

test('skips a duplicate whose only other copy was deleted from outside', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [entryOf(a, { group: 'g' }), entryOf(b, { group: 'g' })]);

  fs.rmSync(b);
  const result = await remover.trash('duplicates', [a]);

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.ok(fs.existsSync(a));
  assert.deepEqual(fake.calls, []);
  assert.ok(remover.isRegistered(a));
});

test('skips a duplicate whose only other copy changed since scan', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [entryOf(a, { group: 'g' }), entryOf(b, { group: 'g' })]);

  fs.appendFileSync(b, 'x');
  const result = await remover.trash('duplicates', [a]);

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.ok(fs.existsSync(a));
  assert.deepEqual(fake.calls, []);
});

test('deletes a duplicate while a third copy is still there', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const c = writeFile(path.join(root, 'c.bin'), 100, { fill: 1 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [
    entryOf(a, { group: 'g' }),
    entryOf(b, { group: 'g' }),
    entryOf(c, { group: 'g' }),
  ]);

  fs.rmSync(c);
  const result = await remover.trash('duplicates', [a]);

  assert.deepEqual(result, { freedBytes: 100, deleted: 1, skipped: 0 });
  assert.ok(!fs.existsSync(a));
  assert.ok(fs.existsSync(b));
});

test('never deletes every real copy when another copy is gone and two are requested', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const c = writeFile(path.join(root, 'c.bin'), 100, { fill: 1 });
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [
    entryOf(a, { group: 'g' }),
    entryOf(b, { group: 'g' }),
    entryOf(c, { group: 'g' }),
  ]);

  fs.rmSync(c);
  const result = await remover.trash('duplicates', [a, b]);

  // The first one has no intact sibling yet and is skipped; the second then
  // has the first as its backup. Exactly one real copy survives.
  assert.equal(result.deleted, 1);
  assert.equal(result.skipped, 1);
  assert.notEqual(fs.existsSync(a), fs.existsSync(b));
});

test('a register during trash does not change the state the running call works on', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 1 });
  const b = writeFile(path.join(root, 'b.bin'), 100, { fill: 1 });
  const c = writeFile(path.join(root, 'c.bin'), 100, { fill: 1 });
  const d = writeFile(path.join(root, 'd.bin'), 100, { fill: 1 });
  const x = writeFile(path.join(root, 'x.bin'), 100, { fill: 2 });
  const y = writeFile(path.join(root, 'y.bin'), 100, { fill: 2 });
  const calls = [];
  let remover;
  async function trashItem(target) {
    calls.push(target);
    if (calls.length === 1) {
      // While the first file is being deleted: the last untouched copy of the
      // old group disappears, and a new scan reuses the group id 'g' for
      // unrelated files (and also lists c).
      fs.rmSync(d);
      remover.register('duplicates', [
        entryOf(x, { group: 'g' }),
        entryOf(y, { group: 'g' }),
        entryOf(c, { group: 'g' }),
      ]);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  remover = createRemover({ trashItem });
  remover.register('duplicates', [
    entryOf(a, { group: 'g' }),
    entryOf(b, { group: 'g' }),
    entryOf(c, { group: 'g' }),
    entryOf(d, { group: 'g' }),
  ]);

  const result = await remover.trash('duplicates', [a, b, c]);

  // a had d as backup. After d vanished, b has no intact sibling (a is gone,
  // c is pending, x and y are unrelated files of the new scan) and is skipped;
  // c then has b as its backup.
  assert.deepEqual(calls, [a, c]);
  assert.deepEqual(result, { freedBytes: 200, deleted: 2, skipped: 1 });
  assert.ok(fs.existsSync(b));
  // The new state is untouched by the old call: all its entries stay registered.
  assert.equal(remover.isRegistered(x), true);
  assert.equal(remover.isRegistered(y), true);
  assert.equal(remover.isRegistered(c), true);
  assert.equal((await remover.trash('duplicates', [x])).deleted, 1);
});

test('a hard link to the same file is no safe sibling: deleting either path is skipped', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100);
  const b = path.join(root, 'b.bin');
  fs.linkSync(a, b); // same file, second name
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [entryOf(a, { group: 'g' }), entryOf(b, { group: 'g' })]);

  const result = await remover.trash('duplicates', [b]);

  assert.deepEqual(result, { freedBytes: 0, deleted: 0, skipped: 1 });
  assert.deepEqual(fake.calls, []);
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
});

test('a hard link does not hide a real third copy: the real copy still counts as sibling', async (t) => {
  const root = makeTempDir(t);
  const a = writeFile(path.join(root, 'a.bin'), 100, { fill: 7 });
  const b = path.join(root, 'b.bin');
  fs.linkSync(a, b);
  const c = writeFile(path.join(root, 'c.bin'), 100, { fill: 7 });
  fs.utimesSync(c, fs.statSync(a).atime, fs.statSync(a).mtime);
  const fake = fakeTrash();
  const remover = createRemover({ trashItem: fake.trashItem });
  remover.register('duplicates', [entryOf(a, { group: 'g' }), entryOf(b, { group: 'g' }), entryOf(c, { group: 'g' })]);

  const result = await remover.trash('duplicates', [a]);

  assert.deepEqual(result, { freedBytes: 100, deleted: 1, skipped: 0 });
});
