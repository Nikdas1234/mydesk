const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const { buildElevatedScript, runElevated, buildUacCommand } = require('../src/main/disk/elevated');
const { powershellPath } = require('../src/main/system-tools');
const { makeTempDir, writeFile } = require('./helpers/tmp');

const DAY_MS = 24 * 60 * 60 * 1000;

// Fresh entries can be a few milliseconds ahead of Date.now(), so tests
// without an age rule use a "now" a little later (same trick as walk.test.js).
const laterNow = () => Date.now() + 10 * 1000;

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');
const decode = (encoded) => Buffer.from(encoded, 'base64').toString('utf16le');

// Runs a generated script WITHOUT elevation (plain powershell.exe). Only ever
// used against folders created by makeTempDir.
function runUnelevated(encoded) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: 'pipe',
  });
}

function readResult(resultPath) {
  const text = fs.readFileSync(resultPath, 'utf8');
  assert.notEqual(text.charCodeAt(0), 0xfeff, 'result file has no BOM');
  return JSON.parse(text);
}

// Every single-quoted PowerShell literal in the script, unescaped.
function quotedLiterals(script) {
  const found = [];
  const re = /'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(script)) !== null) found.push(m[1].replace(/''/g, "'"));
  return found;
}

test('script quotes roots safely', () => {
  const script = buildElevatedScript(
    [{ id: 'x', roots: ["C:\\T\\Müller's Temp"], minAgeMs: 0 }],
    'C:\\R\\result.json',
    Date.now(),
  );
  assert.ok(script.includes("'C:\\T\\Müller''s Temp'"));
});

test('script doubles typographic single quotes too (PowerShell treats them as quotes)', () => {
  const root = 'C:\\T\\O\u2019Neil \u2018x\u2019';
  const script = buildElevatedScript([{ id: 'x', roots: [root], minAgeMs: 0 }], 'C:\\R\\r.json', 1);
  assert.ok(script.includes("'C:\\T\\O\u2019\u2019Neil \u2018\u2018x\u2019\u2019'"));
});

test('script contains no other paths than the given roots and the result path', () => {
  const roots = ['C:\\Windows\\Temp', "D:\\Odd'Name\\Temp", 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue'];
  const resultPath = 'C:\\Users\\x\\AppData\\Local\\Temp\\mydesk-0123abcd.json';
  const script = buildElevatedScript([
    { id: 'windowsTemp', roots: [roots[0]], minAgeMs: DAY_MS },
    { id: 'other', roots: [roots[1], roots[2]], minAgeMs: 0 },
  ], resultPath, Date.now());

  const allowed = new Set([...roots, resultPath]);
  const pathLike = quotedLiterals(script).filter((s) => /[\\/]|^[A-Za-z]:/.test(s));
  assert.ok(pathLike.length >= 4, 'finds the roots and the result path at all');
  for (const literal of pathLike) {
    assert.ok(allowed.has(literal), `unexpected path-like literal: ${literal}`);
  }
  for (const expected of allowed) {
    assert.ok(pathLike.includes(expected), `missing ${expected}`);
  }
});

test('script stays far below the Windows command line limit for the three admin categories', () => {
  const script = buildElevatedScript([
    { id: 'windowsTemp', roots: ['C:\\Windows\\Temp'], minAgeMs: DAY_MS },
    { id: 'windowsUpdate', roots: ['C:\\Windows\\SoftwareDistribution\\Download'], minAgeMs: 0 },
    {
      id: 'crashReportsWindows',
      roots: ['ReportArchive', 'ReportQueue', 'Temp'].map((n) => `C:\\ProgramData\\Microsoft\\Windows\\WER\\${n}`),
      minAgeMs: 0,
    },
  ], 'C:\\Users\\someone.with.a.long.name\\AppData\\Local\\Temp\\mydesk-0123456789abcdef.json', Date.now());
  assert.ok(encode(script).length < 24000, `encoded length is ${encode(script).length}`);
});

test('buildElevatedScript rejects an invalid age or time', () => {
  assert.throws(() => buildElevatedScript([{ id: 'x', roots: ['C:\\a'], minAgeMs: -1 }], 'C:\\r.json', 1));
  assert.throws(() => buildElevatedScript([{ id: 'x', roots: ['C:\\a'], minAgeMs: 0 }], 'C:\\r.json', NaN));
});

const UNSAFE_ROOTS = [
  ['empty string', ''],
  ['blank string', '   '],
  ['relative path', 'Temp'],
  ['drive-relative path', 'C:Temp'],
  ['path without drive', '\\Windows\\Temp'],
  ['drive root', 'C:\\'],
  ['drive root reached via parent segment', 'C:\\Windows\\..'],
  ['drive root with dot', 'C:\\.'],
  ['UNC path', '\\\\srv\\share\\x'],
  ['UNC share root', '\\\\srv\\share'],
  ['extended-length path', '\\\\?\\C:\\Temp'],
  ['path with parent segment', 'C:\\Windows\\Temp\\..\\System32'],
  ['not a string', undefined],
  ['root that is only a space', 'C:\\ '],
  ['segment of dots', 'C:\\...'],
  ['segment ending in a dot and a space', 'C:\\. '],
  ['segment ending in a space', 'C:\\Windows \\Temp'],
  ['segment ending in a dot', 'C:\\Windows.\\Temp'],
];

for (const [label, root] of UNSAFE_ROOTS) {
  test(`buildElevatedScript refuses an unsafe root: ${label}`, () => {
    assert.throws(
      () => buildElevatedScript(
        [{ id: 'ok', roots: ['C:\\Windows\\Temp'], minAgeMs: 0 }, { id: 'bad', roots: [root], minAgeMs: 0 }],
        'C:\\r.json',
        1,
      ),
      /unsafe root/,
    );
  });

  test(`runElevated passes the error on and never launches: ${label}`, async () => {
    const cats = [{ id: 'windowsTemp', label: 'x', admin: true, minAgeMs: 0, roots: async () => [root] }];
    let launched = false;
    await assert.rejects(
      runElevated(cats, { launch: async () => { launched = true; } }),
      /unsafe root/,
    );
    assert.equal(launched, false);
  });
}

test('buildElevatedScript accepts normal absolute roots', () => {
  const script = buildElevatedScript(
    [{ id: 'x', roots: ['C:\\Windows\\Temp', 'D:/Daten/Temp', 'C:\\Windows\\Temp\\'], minAgeMs: 0 }],
    'C:\\r.json',
    1,
  );
  assert.ok(script.includes("'C:\\Windows\\Temp'"));
});

test('runElevated rejects non-admin category', async () => {
  const cats = [{ id: 'userTemp', label: 'x', admin: false, minAgeMs: 0, roots: async () => ['C:\\x'] }];
  let launched = false;
  await assert.rejects(
    runElevated(cats, { launch: async () => { launched = true; } }),
    /userTemp/,
  );
  assert.equal(launched, false);
});

test('declined when launcher fails', async () => {
  const cats = [{ id: 'windowsTemp', label: 'x', admin: true, minAgeMs: 0, roots: async () => ['C:\\x'] }];
  const outcome = await runElevated(cats, {
    launch: async () => { throw new Error('The operation was canceled by the user.'); },
  });
  assert.deepEqual(outcome, { declined: true, results: [] });
});

test('result unknown (not declined) when the launcher ends without a result file', async () => {
  const cats = [{ id: 'windowsTemp', label: 'x', admin: true, minAgeMs: 0, roots: async () => ['C:\\x'] }];
  const outcome = await runElevated(cats, { launch: async () => {} });
  assert.deepEqual(outcome, { declined: false, unknown: true, results: [] });
});

test('the UAC command starts the full path of Windows PowerShell, quoted as a literal', () => {
  const command = buildUacCommand('QUJD');
  assert.ok(command.startsWith(`Start-Process '${powershellPath()}' -Verb RunAs`), command);
  assert.ok(command.includes("'-EncodedCommand','QUJD'"));
  assert.ok(!/Start-Process powershell/i.test(command));
});

test('no elevation needed (and none launched) for an empty category list', async () => {
  let launched = false;
  const outcome = await runElevated([], { launch: async () => { launched = true; } });
  assert.equal(launched, false);
  assert.deepEqual(outcome, { declined: false, results: [] });
});

test('script cleans like removeContents', (t) => {
  const base = makeTempDir(t);
  const root = path.join(base, "Müller's Temp");
  const oldFile = writeFile(path.join(root, 'old.bin'), 1000, { daysOld: 3 });
  const freshFile = writeFile(path.join(root, 'fresh.bin'), 400, { daysOld: 0 });
  // A folder with one old and one fresh file is fresh as a whole: it stays complete.
  const mixedOld = writeFile(path.join(root, 'mixed', 'old.bin'), 300, { daysOld: 3 });
  const mixedFresh = writeFile(path.join(root, 'mixed', 'fresh.bin'), 200, { daysOld: 0 });
  // A folder with only old content goes away entirely, the root stays.
  const oldDirFile = writeFile(path.join(root, 'olddir', 'deep', 'x.bin'), 50, { daysOld: 3 });
  // A junction pointing out of the root: its target must never be touched.
  const target = path.join(base, 'target');
  const targetFile = writeFile(path.join(target, 'keep.bin'), 700, { daysOld: 5 });
  fs.symlinkSync(target, path.join(root, 'link'), 'junction');

  const resultPath = path.join(base, 'result.json');
  const script = buildElevatedScript([{ id: 'windowsTemp', roots: [root], minAgeMs: DAY_MS }], resultPath, Date.now());
  runUnelevated(encode(script));

  assert.equal(fs.existsSync(oldFile), false, 'old file is gone');
  assert.equal(fs.existsSync(freshFile), true, 'fresh file stays');
  assert.equal(fs.existsSync(mixedOld), true, 'old file inside a fresh folder stays');
  assert.equal(fs.existsSync(mixedFresh), true);
  assert.equal(fs.existsSync(path.join(root, 'olddir')), false, 'old folder is removed');
  assert.equal(fs.existsSync(oldDirFile), false);
  assert.equal(fs.existsSync(root), true, 'root itself stays');
  assert.equal(fs.existsSync(targetFile), true, 'junction target stays');
  assert.equal(fs.lstatSync(path.join(root, 'link')).isSymbolicLink(), true, 'fresh junction stays');

  assert.deepEqual(readResult(resultPath), [{ id: 'windowsTemp', freedBytes: 1050, deleted: 2, skipped: 0 }]);
});

test('script removes a junction itself without touching its target, and sums several roots', (t) => {
  const base = makeTempDir(t);
  const rootA = path.join(base, 'A');
  const rootB = path.join(base, 'B');
  writeFile(path.join(rootA, 'a.bin'), 500);
  writeFile(path.join(rootA, 'sub', 'b.bin'), 300);
  const target = path.join(base, 'target');
  const targetFile = writeFile(path.join(target, 'keep.bin'), 700);
  fs.symlinkSync(target, path.join(rootA, 'link'), 'junction');
  writeFile(path.join(rootB, 'c.bin'), 20);
  fs.mkdirSync(path.join(base, 'MissingRootParent'));
  const missingRoot = path.join(base, 'MissingRootParent', 'nope');

  const resultPath = path.join(base, 'result.json');
  const script = buildElevatedScript(
    [{ id: 'two', roots: [rootA, rootB, missingRoot], minAgeMs: 0 }],
    resultPath,
    laterNow(),
  );
  runUnelevated(encode(script));

  assert.deepEqual(fs.readdirSync(rootA), []);
  assert.deepEqual(fs.readdirSync(rootB), []);
  assert.equal(fs.existsSync(targetFile), true, 'junction target stays');
  // a.bin + b.bin + c.bin = 820 bytes; the junction counts as 0 bytes but 1 deleted.
  assert.deepEqual(readResult(resultPath), [{ id: 'two', freedBytes: 820, deleted: 4, skipped: 0 }]);
});

test('script never enters a root that is itself a junction', (t) => {
  const base = makeTempDir(t);
  const target = path.join(base, 'target');
  const targetFile = writeFile(path.join(target, 'precious.bin'), 100, { daysOld: 9 });
  const rootLink = path.join(base, 'rootlink');
  fs.symlinkSync(target, rootLink, 'junction');

  const resultPath = path.join(base, 'result.json');
  runUnelevated(encode(buildElevatedScript([{ id: 'x', roots: [rootLink], minAgeMs: 0 }], resultPath, laterNow())));

  assert.equal(fs.existsSync(targetFile), true);
  assert.deepEqual(readResult(resultPath), [{ id: 'x', freedBytes: 0, deleted: 0, skipped: 1 }]);
});

test('script works with typographic quotes in a root name', (t) => {
  const base = makeTempDir(t);
  const root = path.join(base, 'O\u2019Neil \u2018Temp\u2019');
  const oldFile = writeFile(path.join(root, 'old.bin'), 10, { daysOld: 3 });
  const resultPath = path.join(base, 'result.json');
  runUnelevated(encode(buildElevatedScript([{ id: 'x', roots: [root], minAgeMs: DAY_MS }], resultPath, Date.now())));
  assert.equal(fs.existsSync(oldFile), false);
  assert.deepEqual(readResult(resultPath), [{ id: 'x', freedBytes: 10, deleted: 1, skipped: 0 }]);
});

test('script counts a failing delete as skipped and still writes the result', async (t) => {
  const base = makeTempDir(t);
  const root = path.join(base, 'R');
  writeFile(path.join(root, 'free.bin'), 10, { daysOld: 3 });
  const locked = writeFile(path.join(root, 'locked.bin'), 30, { daysOld: 3 });

  // A second PowerShell process holds the file open without sharing, so deleting it fails.
  const holder = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "$f=[IO.File]::Open($env:LOCKED_FILE,'Open','Read','None');Write-Output ready;Start-Sleep -Seconds 60",
  ], { windowsHide: true, env: { ...process.env, LOCKED_FILE: locked } });
  // The holder must be gone before the temp folder is removed, so it is stopped in the test body.
  const holderGone = new Promise((resolve) => holder.on('exit', resolve));
  try {
    await new Promise((resolve, reject) => {
      holder.stdout.on('data', (chunk) => { if (String(chunk).includes('ready')) resolve(); });
      holder.on('error', reject);
      holder.on('exit', () => reject(new Error('holder process ended early')));
    });

    const resultPath = path.join(base, 'result.json');
    runUnelevated(encode(buildElevatedScript([{ id: 'x', roots: [root], minAgeMs: DAY_MS }], resultPath, Date.now())));

    assert.equal(fs.existsSync(locked), true, 'locked file stays');
    assert.equal(fs.existsSync(path.join(root, 'free.bin')), false, 'the other file is still removed');
    assert.deepEqual(readResult(resultPath), [{ id: 'x', freedBytes: 10, deleted: 1, skipped: 1 }]);
  } finally {
    holder.kill();
    await holderGone;
  }
});

test('results are read and file removed', async (t) => {
  const base = makeTempDir(t);
  const root = path.join(base, 'WER Temp');
  writeFile(path.join(root, 'old.bin'), 123, { daysOld: 2 });
  writeFile(path.join(root, 'new.bin'), 77, { daysOld: 0 });
  const cats = [
    { id: 'crashReportsWindows', label: 'x', admin: true, minAgeMs: DAY_MS, roots: async () => [root, path.join(base, 'absent')] },
    { id: 'windowsUpdate', label: 'y', admin: true, minAgeMs: DAY_MS, roots: async () => [] },
  ];

  let seenResultPath;
  const outcome = await runElevated(cats, {
    launch: async (encoded) => {
      const script = decode(encoded);
      seenResultPath = quotedLiterals(script).find((s) => /mydesk-[0-9a-f]+\.json$/.test(s));
      assert.ok(seenResultPath, 'script contains the result path');
      assert.equal(path.dirname(seenResultPath), os.tmpdir());
      runUnelevated(encoded);
      assert.equal(fs.existsSync(seenResultPath), true, 'result exists right after the run');
    },
  });

  assert.deepEqual(outcome, {
    declined: false,
    results: [
      { id: 'crashReportsWindows', freedBytes: 123, deleted: 1, skipped: 0 },
      { id: 'windowsUpdate', freedBytes: 0, deleted: 0, skipped: 0 },
    ],
  });
  assert.equal(fs.existsSync(seenResultPath), false, 'result file is deleted after reading');
  assert.equal(fs.existsSync(path.join(root, 'new.bin')), true);
});

test('a result file with a BOM is read, a damaged one counts as unknown and is removed', async () => {
  const cats = [{ id: 'windowsTemp', label: 'x', admin: true, minAgeMs: 0, roots: async () => ['C:\\x'] }];
  const writeVia = (content) => async (encoded) => {
    const resultPath = quotedLiterals(decode(encoded)).find((s) => /mydesk-[0-9a-f]+\.json$/.test(s));
    fs.writeFileSync(resultPath, content);
    writeVia.last = resultPath;
  };

  const bom = '\ufeff[{"id":"windowsTemp","freedBytes":5,"deleted":1,"skipped":0}]';
  assert.deepEqual(await runElevated(cats, { launch: writeVia(bom) }), {
    declined: false,
    results: [{ id: 'windowsTemp', freedBytes: 5, deleted: 1, skipped: 0 }],
  });
  assert.equal(fs.existsSync(writeVia.last), false);

  assert.deepEqual(
    await runElevated(cats, { launch: writeVia('[{"id":') }),
    { declined: false, unknown: true, results: [] },
  );
  assert.deepEqual(
    await runElevated(cats, { launch: writeVia('{"id":1}') }),
    { declined: false, unknown: true, results: [] },
  );
  assert.equal(fs.existsSync(writeVia.last), false);
});
