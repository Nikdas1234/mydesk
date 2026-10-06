const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTempDir, writeFile } = require('./helpers/tmp');
const { resolvePaths, resolveSandboxDir, createSandboxTrashItem, SANDBOX_MARKER } = require('../src/main/paths');

// A temp folder that carries the marker file, i.e. a valid sandbox.
function makeMarkedSandbox(t) {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, SANDBOX_MARKER), 'sandbox');
  return dir;
}

const REAL_ENV = {
  TEMP: 'C:\\Users\\x\\AppData\\Local\\Temp',
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  ProgramData: 'C:\\ProgramData',
  SystemRoot: 'C:\\Windows',
};

const FOLDERS = {
  userData: 'C:\\Users\\x\\AppData\\Roaming\\App',
  downloads: 'C:\\Users\\x\\Downloads',
  desktop: 'C:\\Users\\x\\Desktop',
  documents: 'C:\\Users\\x\\Documents',
  pictures: 'C:\\Users\\x\\Pictures',
  videos: 'C:\\Users\\x\\Videos',
  music: 'C:\\Users\\x\\Music',
};
const getPath = (name) => {
  if (!(name in FOLDERS)) throw new Error(`unexpected getPath(${name})`);
  return FOLDERS[name];
};

test('real paths come from getPath', () => {
  const recycleRoots = ['C:\\$Recycle.Bin\\S-1-5-21-1'];
  const paths = resolvePaths({ getPath, env: REAL_ENV, recycleRoots });

  assert.equal(paths.sandbox, false);
  assert.equal(paths.settingsDir, FOLDERS.userData);
  assert.equal(paths.downloadsDir, FOLDERS.downloads);
  assert.deepEqual(paths.duplicateDefaults, [
    FOLDERS.desktop, FOLDERS.documents, FOLDERS.downloads,
    FOLDERS.pictures, FOLDERS.videos, FOLDERS.music,
  ]);
  assert.deepEqual(paths.junkEnv, { ...REAL_ENV, recycleRoots });
});

test('sandbox keeps every path inside the sandbox', (t) => {
  const sandbox = makeMarkedSandbox(t);
  const env = { ...REAL_ENV, MYDESK_SANDBOX: sandbox };
  const paths = resolvePaths({ getPath, env, recycleRoots: ['C:\\$Recycle.Bin\\S-1-5-21-1'] });

  const inside = (p) => {
    const rel = path.relative(sandbox, p);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const { recycleRoots, ...junkPaths } = paths.junkEnv;
  const all = [
    paths.settingsDir, paths.downloadsDir, ...paths.duplicateDefaults, ...Object.values(junkPaths),
  ];
  assert.equal(paths.sandbox, true);
  assert.equal(paths.sandboxDir, sandbox);
  assert.equal(all.length, 2 + 6 + 4);
  for (const p of all) assert.ok(inside(p), `${p} is not inside ${sandbox}`);
  assert.deepEqual(recycleRoots, []);
  assert.equal(paths.downloadsDir, path.join(sandbox, 'Downloads'));
  assert.equal(paths.junkEnv.SystemRoot, path.join(sandbox, 'Windows'));
});

test('real paths have no sandbox folder', () => {
  assert.equal(resolvePaths({ getPath, env: REAL_ENV, recycleRoots: [] }).sandboxDir, null);
  assert.equal(resolveSandboxDir(REAL_ENV), null);
});

test('a sandbox folder with the marker file is accepted', (t) => {
  const sandbox = makeMarkedSandbox(t);
  assert.equal(resolveSandboxDir({ MYDESK_SANDBOX: sandbox }), sandbox);
});

test('a folder without the marker file is refused', (t) => {
  const plain = makeTempDir(t);
  const env = { ...REAL_ENV, MYDESK_SANDBOX: plain };
  assert.throws(() => resolveSandboxDir(env), /.mydesk-sandbox/);
  assert.throws(() => resolvePaths({ getPath, env, recycleRoots: [] }), /.mydesk-sandbox/);
});

test('a missing folder is refused', (t) => {
  const missing = path.join(makeTempDir(t), 'gibt-es-nicht');
  assert.throws(() => resolveSandboxDir({ MYDESK_SANDBOX: missing }), /.mydesk-sandbox/);
});

test('a marker that is a folder, not a file, is refused', (t) => {
  const dir = makeTempDir(t);
  fs.mkdirSync(path.join(dir, SANDBOX_MARKER));
  assert.throws(() => resolveSandboxDir({ MYDESK_SANDBOX: dir }), /.mydesk-sandbox/);
});

for (const [label, value] of [
  ['a drive root', 'C:\\'],
  ['a drive root without separator', 'C:'],
  ['a root-relative path', '\\'],
  ['an empty value', ''],
  ['a blank value', '   '],
  ['a relative path', 'relative-sandbox'],
  ['a UNC path', '\\\\server\\share'],
]) {
  test(`${label} is refused as sandbox, resolvePaths included`, () => {
    assert.throws(() => resolveSandboxDir({ MYDESK_SANDBOX: value }), /MYDESK_SANDBOX/);
    assert.throws(
      () => resolvePaths({ getPath, env: { ...REAL_ENV, MYDESK_SANDBOX: value }, recycleRoots: [] }),
      /MYDESK_SANDBOX/,
    );
  });
}

test('an invalid sandbox never yields real paths as a fallback', () => {
  const env = { ...REAL_ENV, MYDESK_SANDBOX: 'C:\\' };
  let result = null;
  try {
    result = resolvePaths({ getPath, env, recycleRoots: [] });
  } catch {
    // expected
  }
  assert.equal(result, null);
});

test('sandbox trash moves into the Papierkorb folder and never overwrites', async (t) => {
  const sandbox = makeTempDir(t);
  const trashItem = createSandboxTrashItem(sandbox);

  const first = writeFile(path.join(sandbox, 'Downloads', 'a.txt'), 10);
  await trashItem(first);
  const second = writeFile(path.join(sandbox, 'Desktop', 'a.txt'), 20);
  await trashItem(second);
  const folder = path.join(sandbox, 'Downloads', 'Ordner');
  writeFile(path.join(folder, 'inner.txt'), 5);
  await trashItem(folder);

  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(second), false);
  assert.equal(fs.existsSync(folder), false);
  const trashDir = path.join(sandbox, 'Papierkorb');
  const names = fs.readdirSync(trashDir);
  assert.equal(names.length, 3);
  assert.ok(names.includes('Ordner'));
  const sizes = names
    .filter((n) => n.startsWith('a'))
    .map((n) => fs.statSync(path.join(trashDir, n)).size)
    .sort((a, b) => a - b);
  assert.deepEqual(sizes, [10, 20]);
});

test('sandbox trash refuses items outside the sandbox', async (t) => {
  const sandbox = makeTempDir(t);
  const outside = writeFile(path.join(makeTempDir(t), 'x.txt'), 1);
  await assert.rejects(createSandboxTrashItem(sandbox)(outside), /outside the sandbox/);
  assert.equal(fs.existsSync(outside), true);
});
