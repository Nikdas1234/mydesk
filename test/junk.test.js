const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getCategories, measureCategory, cleanCategory } = require('../src/main/disk/junk');
const { execFileSync } = require('node:child_process');
const { makeTempDir, writeFile } = require('./helpers/tmp');

// Fresh entries can be a millisecond or two ahead of Date.now() (see walk.test.js),
// so tests without an age rule pass a "now" a little later.
const laterNow = () => Date.now() + 10 * 1000;

// Builds a JunkEnv that points into one temp folder. Nothing here touches the real system.
function makeEnv(t) {
  const base = makeTempDir(t);
  const env = {
    TEMP: path.join(base, 'user', 'Temp'),
    LOCALAPPDATA: path.join(base, 'user', 'Local'),
    ProgramData: path.join(base, 'ProgramData'),
    SystemRoot: path.join(base, 'Windows'),
    recycleRoots: [path.join(base, 'recycle-c'), path.join(base, 'recycle-d')],
  };
  return env;
}

function byId(env, id) {
  const cat = getCategories(env).find((c) => c.id === id);
  assert.ok(cat, `category ${id} exists`);
  return cat;
}

test('seven categories, three need admin', () => {
  const cats = getCategories({
    TEMP: 'X:\\t', LOCALAPPDATA: 'X:\\l', ProgramData: 'X:\\p', SystemRoot: 'X:\\w', recycleRoots: [],
  });
  assert.deepEqual(cats.map((c) => c.id), [
    'userTemp', 'windowsTemp', 'recycleBin', 'browserCache',
    'windowsUpdate', 'crashDumpsUser', 'crashReportsWindows',
  ]);
  assert.deepEqual(
    cats.filter((c) => c.admin).map((c) => c.id),
    ['windowsTemp', 'windowsUpdate', 'crashReportsWindows'],
  );
  assert.deepEqual(cats.map((c) => c.label), [
    'Temporäre Dateien', 'Temporäre Dateien von Windows', 'Papierkorb', 'Browser-Cache',
    'Reste von Windows-Updates', 'Absturzberichte', 'Absturzberichte von Windows',
  ]);
  const DAY_MS = 24 * 60 * 60 * 1000;
  assert.deepEqual(cats.map((c) => c.minAgeMs), [DAY_MS, DAY_MS, 0, 0, 0, 0, 0]);
});

test('fixed category roots follow the table', async (t) => {
  const env = makeEnv(t);
  const roots = async (id) => byId(env, id).roots();

  assert.deepEqual(await roots('userTemp'), [env.TEMP]);
  assert.deepEqual(await roots('windowsTemp'), [path.join(env.SystemRoot, 'Temp')]);
  assert.deepEqual(await roots('recycleBin'), env.recycleRoots);
  assert.deepEqual(await roots('windowsUpdate'), [path.join(env.SystemRoot, 'SoftwareDistribution', 'Download')]);
  assert.deepEqual(await roots('crashDumpsUser'), [path.join(env.LOCALAPPDATA, 'CrashDumps')]);
  const wer = path.join(env.ProgramData, 'Microsoft', 'Windows', 'WER');
  assert.deepEqual(await roots('crashReportsWindows'), [
    path.join(wer, 'ReportArchive'), path.join(wer, 'ReportQueue'), path.join(wer, 'Temp'),
  ]);
});

test('browser roots cover profiles only', async (t) => {
  const env = makeEnv(t);
  const edge = path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
  writeFile(path.join(edge, 'Default', 'Cache', 'data_0'), 10);
  writeFile(path.join(edge, 'Profile 1', 'Code Cache', 'js', 'x'), 10);
  writeFile(path.join(edge, 'System Profile', 'Cache', 'data_0'), 10);
  writeFile(path.join(edge, 'Default', 'History'), 10);
  // A file named like a profile folder must not break the listing.
  writeFile(path.join(edge, 'Profile 2'), 10);

  const roots = await byId(env, 'browserCache').roots();
  assert.deepEqual([...roots].sort(), [
    path.join(edge, 'Default', 'Cache'),
    path.join(edge, 'Profile 1', 'Code Cache'),
  ].sort());
});

test('browser roots include Chrome and Firefox, existing folders only', async (t) => {
  const env = makeEnv(t);
  const chrome = path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
  const firefox = path.join(env.LOCALAPPDATA, 'Mozilla', 'Firefox', 'Profiles');
  writeFile(path.join(chrome, 'Default', 'GPUCache', 'data_0'), 10);
  writeFile(path.join(chrome, 'Default', 'Cache', 'data_0'), 10);
  writeFile(path.join(chrome, 'Default', 'Cookies'), 10);
  writeFile(path.join(firefox, 'abc.default-release', 'cache2', 'entries', 'e1'), 10);
  writeFile(path.join(firefox, 'abc.default-release', 'places.sqlite'), 10);
  writeFile(path.join(firefox, 'xyz.other', 'prefs.js'), 10); // profile without cache2

  const roots = await byId(env, 'browserCache').roots();
  assert.deepEqual([...roots].sort(), [
    path.join(chrome, 'Default', 'Cache'),
    path.join(chrome, 'Default', 'GPUCache'),
    path.join(firefox, 'abc.default-release', 'cache2'),
  ].sort());
});

test('browser roots are empty when no browser is installed', async (t) => {
  const env = makeEnv(t);
  assert.deepEqual(await byId(env, 'browserCache').roots(), []);
});

test('browser clean leaves profile data', async (t) => {
  const env = makeEnv(t);
  const edge = path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
  writeFile(path.join(edge, 'Default', 'Cache', 'data_0'), 100);
  writeFile(path.join(edge, 'Default', 'Cache', 'sub', 'data_1'), 50);
  writeFile(path.join(edge, 'Default', 'History'), 30);
  writeFile(path.join(edge, 'Default', 'Login Data'), 20);

  const cat = byId(env, 'browserCache');
  const result = await cleanCategory(cat, { now: laterNow() });

  assert.deepEqual(result, { id: 'browserCache', freedBytes: 150, deleted: 2, skipped: 0 });
  assert.ok(fs.existsSync(path.join(edge, 'Default', 'History')));
  assert.ok(fs.existsSync(path.join(edge, 'Default', 'Login Data')));
  assert.ok(fs.existsSync(path.join(edge, 'Default', 'Cache')), 'the cache folder itself stays');
  assert.deepEqual(fs.readdirSync(path.join(edge, 'Default', 'Cache')), []);
});

test('userTemp ignores entries younger than 24h', async (t) => {
  const env = makeEnv(t);
  writeFile(path.join(env.TEMP, 'old.tmp'), 100, { daysOld: 3 });
  writeFile(path.join(env.TEMP, 'fresh.tmp'), 200, { daysOld: 0 });
  writeFile(path.join(env.TEMP, 'dir', 'old-inside.tmp'), 400, { daysOld: 2 });
  writeFile(path.join(env.TEMP, 'dir', 'fresh-inside.tmp'), 800, { daysOld: 0 }); // keeps the whole dir

  const cat = byId(env, 'userTemp');
  const now = Date.now();

  assert.deepEqual(await measureCategory(cat, { now }), { id: 'userTemp', bytes: 100, files: 1, unreadable: false });

  const result = await cleanCategory(cat, { now });
  assert.deepEqual(result, { id: 'userTemp', freedBytes: 100, deleted: 1, skipped: 0 });
  assert.ok(!fs.existsSync(path.join(env.TEMP, 'old.tmp')));
  assert.ok(fs.existsSync(path.join(env.TEMP, 'fresh.tmp')));
  assert.ok(fs.existsSync(path.join(env.TEMP, 'dir', 'old-inside.tmp')));
  assert.ok(fs.existsSync(path.join(env.TEMP, 'dir', 'fresh-inside.tmp')));
});

test('measureCategory sums several roots', async (t) => {
  const env = makeEnv(t);
  writeFile(path.join(env.recycleRoots[0], 'a.bin'), 100);
  writeFile(path.join(env.recycleRoots[1], 'sub', 'b.bin'), 250);

  assert.deepEqual(
    await measureCategory(byId(env, 'recycleBin'), { now: laterNow() }),
    { id: 'recycleBin', bytes: 350, files: 2, unreadable: false },
  );
});

test('measureCategory is unreadable when one root cannot be listed', async (t) => {
  const env = makeEnv(t);
  writeFile(path.join(env.recycleRoots[0], 'a.bin'), 100);
  fs.mkdirSync(env.recycleRoots[1], { recursive: true });

  const user = execFileSync('whoami', { encoding: 'utf8' }).trim();
  execFileSync('icacls', [env.recycleRoots[1], '/deny', `${user}:(RD)`], { stdio: 'ignore' });
  try {
    assert.deepEqual(
      await measureCategory(byId(env, 'recycleBin'), { now: laterNow() }),
      { id: 'recycleBin', bytes: 100, files: 1, unreadable: true },
    );
  } finally {
    execFileSync('icacls', [env.recycleRoots[1], '/remove:d', user], { stdio: 'ignore' });
  }
});

test('measureCategory passes the abort signal on', async (t) => {
  const env = makeEnv(t);
  writeFile(path.join(env.recycleRoots[0], 'a.bin'), 100);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    measureCategory(byId(env, 'recycleBin'), { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('admin category refuses cleanCategory', async (t) => {
  const env = makeEnv(t);
  const file = writeFile(path.join(env.SystemRoot, 'Temp', 'x.tmp'), 100, { daysOld: 5 });

  await assert.rejects(cleanCategory(byId(env, 'windowsTemp'), { now: laterNow() }));
  assert.ok(fs.existsSync(file), 'nothing was deleted');
});

test('recycle bin uses injected emptier', async (t) => {
  const env = makeEnv(t);
  writeFile(path.join(env.recycleRoots[0], '$R1.bin'), 100);
  writeFile(path.join(env.recycleRoots[1], 'sub', '$R2.bin'), 250);

  let calls = 0;
  const emptyRecycleBin = async () => {
    calls += 1;
    for (const root of env.recycleRoots) {
      for (const name of fs.readdirSync(root)) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  };

  const result = await cleanCategory(byId(env, 'recycleBin'), { now: laterNow(), emptyRecycleBin });

  assert.equal(calls, 1);
  assert.deepEqual(result, { id: 'recycleBin', freedBytes: 350, deleted: 0, skipped: 0 });
  assert.deepEqual(fs.readdirSync(env.recycleRoots[0]), []);
});

test('non-recycle categories never call the emptier', async (t) => {
  const env = makeEnv(t);
  writeFile(path.join(env.LOCALAPPDATA, 'CrashDumps', 'd.dmp'), 70);
  const emptyRecycleBin = async () => assert.fail('emptier must not run');

  const result = await cleanCategory(byId(env, 'crashDumpsUser'), { now: laterNow(), emptyRecycleBin });
  assert.deepEqual(result, { id: 'crashDumpsUser', freedBytes: 70, deleted: 1, skipped: 0 });
});

test('recycle bin measurement ignores desktop.ini and the $I… bookkeeping files', async (t) => {
  const env = makeEnv(t);
  writeFile(path.join(env.recycleRoots[0], 'desktop.ini'), 129);
  writeFile(path.join(env.recycleRoots[0], '$IABC123.txt'), 544);
  writeFile(path.join(env.recycleRoots[1], 'DESKTOP.INI'), 129);

  assert.deepEqual(
    await measureCategory(byId(env, 'recycleBin'), { now: laterNow() }),
    { id: 'recycleBin', bytes: 0, files: 0, unreadable: false },
  );

  // The $R… file holds the real content and still counts.
  writeFile(path.join(env.recycleRoots[0], '$RABC123.txt'), 1000);
  assert.deepEqual(
    await measureCategory(byId(env, 'recycleBin'), { now: laterNow() }),
    { id: 'recycleBin', bytes: 1000, files: 1, unreadable: false },
  );
});

test('only the recycle bin ignores those names; other categories count them', async (t) => {
  const env = makeEnv(t);
  writeFile(path.join(env.TEMP, 'desktop.ini'), 50, { daysOld: 3 });
  assert.equal((await measureCategory(byId(env, 'userTemp'), { now: laterNow() })).files, 1);
});

test('the recycle bin command empties drive by drive and never reports a suppressed error as failure', () => {
  const { recycleBinCommand } = require('../src/main/disk/junk');
  const command = recycleBinCommand(['C:\\$Recycle.Bin\\S-1-5-21-1', 'd:\\$Recycle.Bin\\S-1-5-21-1', 'C:\\$Recycle.Bin\\S-1-5-21-2']);
  // One call per drive, each in its own try/catch; the script always ends with exit code 0.
  // (PowerShell exits with 1 when the last command failed, even with -ErrorAction SilentlyContinue.)
  assert.equal(command, [
    "try { Clear-RecycleBin -DriveLetter C -Force -ErrorAction Stop } catch { }",
    "try { Clear-RecycleBin -DriveLetter D -Force -ErrorAction Stop } catch { }",
    'exit 0',
  ].join('; '));
  assert.equal(recycleBinCommand([]), 'exit 0');
  assert.equal(recycleBinCommand(['\\\\server\\share\\x', 'relativ', '']), 'exit 0');
});

test('cleanCategory hands the recycle bin folders to the emptier', async (t) => {
  const env = makeEnv(t);
  let seen = null;
  await cleanCategory(byId(env, 'recycleBin'), { now: laterNow(), emptyRecycleBin: async (roots) => { seen = roots; } });
  assert.deepEqual(seen, env.recycleRoots);
});
