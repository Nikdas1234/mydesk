const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTempDir, writeFile } = require('./helpers/tmp');
const { getCategories } = require('../src/main/disk/junk');
const { createRemover } = require('../src/main/disk/remove');
const { createHandlers } = require('../src/main/ipc');

const JUNK_ENV = {
  TEMP: 'C:\\sb\\Temp',
  LOCALAPPDATA: 'C:\\sb\\LocalAppData',
  ProgramData: 'C:\\sb\\ProgramData',
  SystemRoot: 'C:\\sb\\Windows',
  recycleRoots: [],
};
const ALL_IDS = getCategories(JUNK_ENV).map((c) => c.id);

function abortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

// A scan that only ends when its signal is aborted.
function hangingUntilAborted(...args) {
  const { signal } = args[args.length - 1];
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(abortError()));
  });
}

// All dependencies as fakes; `calls` records what the handlers did.
function makeDeps() {
  const calls = { clean: [], elevated: [], trashed: [], shown: [], sent: [], measure: [], mail: [], update: [], history: [], theme: [], programs: [] };
  const settingsValue = {
    downloadsMaxAgeDays: 30, theme: 'system',
  };
  const deps = {
    settings: { load: () => ({ ...settingsValue }), save: (patch) => ({ ...settingsValue, ...patch }) },
    paths: {
      sandbox: false,
      downloadsDir: 'C:\\dl',
      junkEnv: { ...JUNK_ENV, recycleRoots: ['C:\\$Recycle.Bin\\S-1-5-21-1'] },
    },
    junk: {
      getCategories,
      measureCategory: async (cat) => {
        calls.measure.push(cat.id);
        return { id: cat.id, bytes: 100, files: 2, unreadable: false };
      },
      cleanCategory: async (cat, opts) => {
        calls.clean.push({ id: cat.id, opts });
        return { id: cat.id, freedBytes: 10, deleted: 1, skipped: 0 };
      },
    },
    elevated: {
      runElevated: async (cats, opts) => {
        calls.elevated.push({ ids: cats.map((c) => c.id), opts });
        return {
          declined: false,
          results: cats.map((c) => ({ id: c.id, freedBytes: 20, deleted: 2, skipped: 0 })),
        };
      },
    },
    downloads: { findOldDownloads: async () => [] },
    remover: createRemover({ trashItem: async (p) => { calls.trashed.push(p); } }),
    showItemInFolder: (p) => { calls.shown.push(p); },
    send: (channel, payload) => { calls.sent.push({ channel, payload }); },
    programs: {
      list: async () => [{ id: 'p1', name: 'Tool', lastUsedMs: null }],
      uninstall: async (id) => { calls.programs.push(id); return { started: true, name: 'Tool' }; },
    },
    history: {
      get: () => ({ freedBytes: 7, since: 1, lastChecked: {} }),
      addFreed: (bytes) => { calls.history.push(['freed', bytes]); },
      markChecked: (key) => { calls.history.push(['checked', key]); },
    },
    drives: { listDrives: async () => [{ letter: 'C', totalBytes: 10, freeBytes: 4 }] },
    applyTheme: (theme) => { calls.theme.push(theme); },
    updater: {
      state: () => ({ status: 'none' }),
      check: async () => { calls.update.push('check'); },
      download: async () => { calls.update.push('download'); },
      install: () => { calls.update.push('install'); },
    },
    mail: {
      scan: async ({ onProgress }) => {
        onProgress({ account: 'max@gmx.de', done: 0, total: 1 });
        return { important: [], newsletters: [], errors: [] };
      },
      readText: async (arg) => { calls.mail.push(['readText', arg]); return 'Text'; },
      unsubscribe: async (...args) => { calls.mail.push(['unsubscribe', ...args]); return { ok: true }; },
      removeSender: async (arg) => { calls.mail.push(['removeSender', arg]); return { moved: 2 }; },
      label: async (arg) => { calls.mail.push(['label', arg]); return { inbox: [] }; },
      resetLearning: async () => { calls.mail.push(['resetLearning']); return null; },
      removeUnsubscribed: async () => { calls.mail.push(['removeUnsubscribed']); return { moved: 3, senders: [], failed: [] }; },
      learned: async () => ({ important: 1, other: 2, ready: false }),
      listAccounts: async () => [{ id: 'a1', address: 'max@gmx.de', provider: 'gmx' }],
      saveAccount: async (arg) => { calls.mail.push(['saveAccount', arg]); return { id: 'a1' }; },
      removeAccount: async (arg) => { calls.mail.push(['removeAccount', arg]); },
      testAccount: async (arg) => { calls.mail.push(['testAccount', arg]); return { ok: true, message: null, hint: null }; },
    },
  };
  return { deps, calls };
}

function downloadEntry(file, size = 100) {
  return { path: file, name: path.basename(file), isDirectory: false, size, mtimeMs: fs.statSync(file).mtimeMs, ageDays: 200 };
}

test('every channel of the bridge has a handler', () => {
  const { deps } = makeDeps();
  assert.deepEqual(Object.keys(createHandlers(deps)).sort(), [
    'app:info', 'downloads:scan', 'downloads:trash',
    'junk:clean', 'junk:scan', 'mail:accounts:list', 'mail:accounts:remove', 'mail:accounts:save', 'mail:accounts:test',
    'mail:label', 'mail:learned', 'mail:removeSender', 'mail:removeUnsubscribed', 'mail:resetLearning', 'mail:scan', 'mail:text',
    'mail:unsubscribe',
    'scan:cancel', 'settings:get', 'settings:set', 'shell:show', 'update:check', 'update:download', 'update:install',
    'update:state',
  ].concat(['drives:list', 'history:get', 'programs:scan', 'programs:uninstall']).sort());
  assert.ok(!Object.keys(createHandlers(deps)).some((channel) => channel.startsWith('duplicates')));
});

test('settings:get and settings:set go through the store', async () => {
  const { deps } = makeDeps();
  const h = createHandlers(deps);
  assert.equal((await h['settings:get']()).downloadsMaxAgeDays, 30);
  assert.equal((await h['settings:set']({ downloadsMaxAgeDays: 7 })).downloadsMaxAgeDays, 7);
});

test('settings:set passes a save error on', async () => {
  const { deps } = makeDeps();
  deps.settings.save = () => { throw new Error('EPERM: rename failed'); };
  await assert.rejects(createHandlers(deps)['settings:set']({}), /EPERM/);
});

test('junk:scan measures every category and returns label and admin flag', async () => {
  const { deps, calls } = makeDeps();
  const rows = await createHandlers(deps)['junk:scan']();
  assert.deepEqual(rows.map((r) => r.id), ALL_IDS);
  assert.deepEqual(calls.measure, ALL_IDS);
  assert.deepEqual(rows.find((r) => r.id === 'windowsTemp'), {
    id: 'windowsTemp', label: 'Temporäre Dateien von Windows', admin: true, bytes: 100, files: 2, unreadable: false,
  });
});

test('junk:clean splits admin and non-admin', async () => {
  const { deps, calls } = makeDeps();
  const out = await createHandlers(deps)['junk:clean'](['userTemp', 'windowsTemp', 'windowsUpdate']);

  assert.deepEqual(calls.clean.map((c) => c.id), ['userTemp']);
  assert.equal(calls.elevated.length, 1);
  assert.deepEqual(calls.elevated[0].ids, ['windowsTemp', 'windowsUpdate']);
  assert.deepEqual(out.results.map((r) => r.id).sort(), ['userTemp', 'windowsTemp', 'windowsUpdate']);
  assert.deepEqual(out.declinedIds, []);
});

test('junk:clean does not ask for elevation when no admin category is selected', async () => {
  const { deps, calls } = makeDeps();
  await createHandlers(deps)['junk:clean'](['userTemp', 'userTemp']);
  assert.equal(calls.elevated.length, 0);
  assert.equal(calls.clean.length, 1);
});

test('junk:clean reports declined ids but keeps other results', async () => {
  const { deps } = makeDeps();
  deps.elevated.runElevated = async () => ({ declined: true, results: [] });
  const out = await createHandlers(deps)['junk:clean'](['userTemp', 'windowsTemp', 'crashReportsWindows']);
  assert.deepEqual(out.declinedIds, ['windowsTemp', 'crashReportsWindows']);
  assert.deepEqual(out.results.map((r) => r.id), ['userTemp']);
});

test('junk:clean rejects unknown id before cleaning anything', async () => {
  const { deps, calls } = makeDeps();
  await assert.rejects(createHandlers(deps)['junk:clean'](['userTemp', 'nope']), /nope/);
  assert.equal(calls.clean.length, 0);
  assert.equal(calls.elevated.length, 0);
});

test('junk:clean rejects input that is not a list of ids', async () => {
  const { deps } = makeDeps();
  const h = createHandlers(deps);
  await assert.rejects(h['junk:clean']('userTemp'));
  await assert.rejects(h['junk:clean']([42]));
});

test('junk:clean outside the sandbox uses the real recycle bin emptier and UAC launcher', async () => {
  const { deps, calls } = makeDeps();
  deps.paths = { ...deps.paths, junkEnv: { ...JUNK_ENV, recycleRoots: ['C:\\$Recycle.Bin\\S-1-5-21-1'] } };
  await createHandlers(deps)['junk:clean'](['recycleBin', 'windowsTemp']);
  assert.equal(calls.clean[0].opts.emptyRecycleBin, undefined);
  assert.equal(calls.elevated[0].opts.launch, undefined);
});

test('junk:clean in the sandbox never empties the real recycle bin and never asks for UAC', async () => {
  const { deps, calls } = makeDeps();
  deps.paths.sandbox = true;
  await createHandlers(deps)['junk:clean'](['recycleBin', 'windowsTemp']);
  assert.equal(typeof calls.clean[0].opts.emptyRecycleBin, 'function');
  assert.equal(await calls.clean[0].opts.emptyRecycleBin(), undefined);
  assert.equal(typeof calls.elevated[0].opts.launch, 'function');
});

test('downloads:scan registers entries for trash', async (t) => {
  const file = writeFile(path.join(makeTempDir(t), 'old.zip'), 100, { daysOld: 200 });
  const entry = downloadEntry(file);
  const { deps, calls } = makeDeps();
  deps.downloads.findOldDownloads = async (dir, opts) => {
    calls.scanArgs = { dir, opts };
    return [entry];
  };
  const h = createHandlers(deps);

  assert.deepEqual(await h['downloads:scan'](), [entry]);
  assert.equal(calls.scanArgs.dir, 'C:\\dl');
  assert.equal(calls.scanArgs.opts.maxAgeDays, 30);

  const out = await h['downloads:trash']([file]);
  assert.deepEqual(calls.trashed, [file]);
  assert.deepEqual(out, { freedBytes: 100, deleted: 1, skipped: 0 });
});

test('downloads:trash rejects a path that was not scanned', async (t) => {
  const stranger = writeFile(path.join(makeTempDir(t), 'x.txt'), 1);
  const { deps, calls } = makeDeps();
  await assert.rejects(createHandlers(deps)['downloads:trash']([stranger]), /not registered/);
  assert.deepEqual(calls.trashed, []);
});

test('scan:cancel resolves junk:scan and downloads:scan as cancelled', async () => {
  const { deps } = makeDeps();
  deps.junk.measureCategory = hangingUntilAborted;
  deps.downloads.findOldDownloads = hangingUntilAborted;
  const h = createHandlers(deps);

  const junk = h['junk:scan']();
  const downloads = h['downloads:scan']();
  await h['scan:cancel']('junk');
  await h['scan:cancel']('downloads');
  assert.deepEqual(await junk, { cancelled: true });
  assert.deepEqual(await downloads, { cancelled: true });
});

test('a cancelled scan registers nothing, even if it finishes anyway', async (t) => {
  const file = writeFile(path.join(makeTempDir(t), 'old.zip'), 100, { daysOld: 200 });
  const { deps, calls } = makeDeps();
  let finish;
  deps.downloads.findOldDownloads = () => new Promise((resolve) => {
    finish = () => resolve([downloadEntry(file)]);
  });
  const h = createHandlers(deps);

  const pending = h['downloads:scan']();
  await h['scan:cancel']('downloads');
  finish();
  assert.deepEqual(await pending, { cancelled: true });
  await assert.rejects(h['downloads:trash']([file]), /not registered/);
  assert.deepEqual(calls.trashed, []);
});

test('a new scan cancels the one still running', async () => {
  const { deps } = makeDeps();
  let runs = 0;
  deps.downloads.findOldDownloads = (dir, opts) => {
    runs += 1;
    if (runs === 1) return hangingUntilAborted(dir, opts);
    return Promise.resolve([]);
  };
  const h = createHandlers(deps);

  const first = h['downloads:scan']();
  const second = await h['downloads:scan']();
  assert.deepEqual(await first, { cancelled: true });
  assert.deepEqual(second, []);
});

test('scan:cancel without a running scan does nothing, unknown names are rejected', async () => {
  const { deps } = makeDeps();
  const h = createHandlers(deps);
  await h['scan:cancel']('junk');
  await assert.rejects(h['scan:cancel']('everything'), /everything/);
});

test('a scan that fails reports the error and frees the slot for the next scan', async () => {
  const { deps } = makeDeps();
  let runs = 0;
  deps.downloads.findOldDownloads = async () => {
    runs += 1;
    if (runs === 1) throw new Error('EACCES: not readable');
    return [];
  };
  const h = createHandlers(deps);
  await assert.rejects(h['downloads:scan'](), /EACCES/);
  assert.deepEqual(await h['downloads:scan'](), []);
});

test('shell:show rejects unregistered path', async (t) => {
  const stranger = writeFile(path.join(makeTempDir(t), 'x.txt'), 1);
  const { deps, calls } = makeDeps();
  await assert.rejects(createHandlers(deps)['shell:show'](stranger), /not registered/);
  assert.deepEqual(calls.shown, []);
});

test('shell:show opens a registered path', async (t) => {
  const file = writeFile(path.join(makeTempDir(t), 'old.zip'), 100, { daysOld: 200 });
  const { deps, calls } = makeDeps();
  deps.downloads.findOldDownloads = async () => [downloadEntry(file)];
  const h = createHandlers(deps);
  await h['downloads:scan']();
  await h['shell:show'](file);
  assert.deepEqual(calls.shown, [file]);
});

test('app:info tells whether the practice mode is active and where', async () => {
  const { deps } = makeDeps();
  assert.deepEqual(await createHandlers(deps)['app:info'](), { sandbox: false, sandboxDir: null });

  deps.paths = { ...deps.paths, sandbox: true, sandboxDir: 'C:\\sb' };
  assert.deepEqual(await createHandlers(deps)['app:info'](), { sandbox: true, sandboxDir: 'C:\\sb' });
});

test('without known recycle bin folders the recycle bin is neither measured nor cleaned (real mode)', async () => {
  const { deps, calls } = makeDeps();
  deps.paths = { ...deps.paths, junkEnv: JUNK_ENV };
  const h = createHandlers(deps);

  const rows = await h['junk:scan']();
  assert.ok(!rows.some((r) => r.id === 'recycleBin'));
  assert.ok(!calls.measure.includes('recycleBin'));

  await assert.rejects(h['junk:clean'](['userTemp', 'recycleBin']), /Unknown category: recycleBin/);
  assert.equal(calls.clean.length, 0);
});

test('with recycle bin folders the recycle bin is offered', async () => {
  const { deps } = makeDeps();
  deps.paths = { ...deps.paths, junkEnv: { ...JUNK_ENV, recycleRoots: ['C:\\$Recycle.Bin\\S-1-5-21-1'] } };
  const rows = await createHandlers(deps)['junk:scan']();
  assert.ok(rows.some((r) => r.id === 'recycleBin'));
});

test('in the practice mode the recycle bin stays in the list (it is just empty)', async () => {
  const { deps } = makeDeps();
  deps.paths = { ...deps.paths, junkEnv: JUNK_ENV, sandbox: true, sandboxDir: 'C:\\sb' };
  const rows = await createHandlers(deps)['junk:scan']();
  assert.ok(rows.some((r) => r.id === 'recycleBin'));
});

test('junk:clean reports unknown ids when the elevated run left no result', async () => {
  const { deps } = makeDeps();
  deps.elevated.runElevated = async () => ({ declined: false, unknown: true, results: [] });
  const out = await createHandlers(deps)['junk:clean'](['userTemp', 'windowsTemp', 'crashReportsWindows']);
  assert.deepEqual(out.unknownIds, ['windowsTemp', 'crashReportsWindows']);
  assert.deepEqual(out.declinedIds, []);
  assert.deepEqual(out.results.map((r) => r.id), ['userTemp']);
});

test('junk:clean always has an (empty) unknownIds list', async () => {
  const { deps } = makeDeps();
  const out = await createHandlers(deps)['junk:clean'](['userTemp']);
  assert.deepEqual(out.unknownIds, []);
});

test('mail channels pass their argument to the mail service', async () => {
  const { deps, calls } = makeDeps();
  const h = createHandlers(deps);
  assert.deepEqual(await h['mail:accounts:list'](), [{ id: 'a1', address: 'max@gmx.de', provider: 'gmx' }]);
  await h['mail:accounts:save']({ address: 'a@gmx.de', password: 'x' });
  await h['mail:accounts:remove']('a1');
  await h['mail:accounts:test']('a1');
  assert.equal(await h['mail:text']({ account: 'a1', uid: 3 }), 'Text');
  await h['mail:unsubscribe']('a1|news@shop.de');
  await h['mail:unsubscribe']({ key: 'a1|news@shop.de', browser: true });
  assert.deepEqual(await h['mail:removeSender']('a1|news@shop.de'), { moved: 2 });
  await h['mail:label']({ account: 'a1', uid: 3, important: true });
  await h['mail:resetLearning']();
  assert.deepEqual(await h['mail:removeUnsubscribed'](), { moved: 3, senders: [], failed: [] });
  assert.deepEqual(await h['mail:learned'](), { important: 1, other: 2, ready: false });
  assert.deepEqual(calls.mail, [
    ['saveAccount', { address: 'a@gmx.de', password: 'x' }],
    ['removeAccount', 'a1'],
    ['testAccount', 'a1'],
    ['readText', { account: 'a1', uid: 3 }],
    ['unsubscribe', 'a1|news@shop.de', { browser: false }],
    ['unsubscribe', 'a1|news@shop.de', { browser: true }],
    ['removeSender', 'a1|news@shop.de'],
    ['label', { account: 'a1', uid: 3, important: true }],
    ['resetLearning'],
    ['removeUnsubscribed'],
  ]);
});

test('mail:scan returns the result and forwards progress', async () => {
  const { deps, calls } = makeDeps();
  const result = await createHandlers(deps)['mail:scan']();
  assert.deepEqual(result, { important: [], newsletters: [], errors: [] });
  assert.deepEqual(calls.sent, [{ channel: 'mail:progress', payload: { account: 'max@gmx.de', done: 0, total: 1 } }]);
});

test('scan:cancel resolves mail:scan as cancelled', async () => {
  const { deps } = makeDeps();
  deps.mail.scan = hangingUntilAborted;
  const h = createHandlers(deps);
  const pending = h['mail:scan']();
  await h['scan:cancel']('mail');
  assert.deepEqual(await pending, { cancelled: true });
});

test('update channels pass through to the updater', async () => {
  const { deps, calls } = makeDeps();
  const h = createHandlers(deps);
  assert.deepEqual(await h['update:state'](), { status: 'none' });
  assert.deepEqual(await h['update:check'](), { status: 'none' });
  await h['update:download']();
  await h['update:install']();
  assert.deepEqual(calls.update, ['check', 'download', 'install']);
});

test('scans mark their area as checked, clean-ups add up what was freed', async (t) => {
  const dir = makeTempDir(t);
  const file = writeFile(path.join(dir, 'alt.zip'), 300);
  const { deps, calls } = makeDeps();
  deps.downloads.findOldDownloads = async () => [downloadEntry(file, 300)];
  const h = createHandlers(deps);

  await h['junk:scan']();
  await h['downloads:scan']();
  await h['mail:scan']();
  assert.deepEqual(calls.history, [['checked', 'junk'], ['checked', 'downloads'], ['checked', 'mail']]);

  calls.history.length = 0;
  await h['junk:clean'](['userTemp', 'windowsTemp']);
  await h['downloads:trash']([file]);
  assert.deepEqual(calls.history, [['freed', 30], ['freed', 300]]);
  assert.deepEqual(await h['history:get'](), { freedBytes: 7, since: 1, lastChecked: {} });
  assert.deepEqual(await h['drives:list'](), [{ letter: 'C', totalBytes: 10, freeBytes: 4 }]);
});

test('a cancelled scan is not marked as checked', async () => {
  const { deps, calls } = makeDeps();
  deps.downloads.findOldDownloads = hangingUntilAborted;
  const h = createHandlers(deps);
  const pending = h['downloads:scan']();
  await h['scan:cancel']('downloads');
  await pending;
  assert.deepEqual(calls.history, []);
});

test('saving settings applies the chosen colour scheme', async () => {
  const { deps, calls } = makeDeps();
  const h = createHandlers(deps);
  await h['settings:set']({ theme: 'dark' });
  assert.deepEqual(calls.theme, ['dark']);
});

test('programs:scan lists the programs and programs:uninstall passes the id on', async () => {
  const { deps, calls } = makeDeps();
  const h = createHandlers(deps);
  assert.deepEqual(await h['programs:scan'](), [{ id: 'p1', name: 'Tool', lastUsedMs: null }]);
  assert.deepEqual(calls.history, [['checked', 'programs']]);
  assert.deepEqual(await h['programs:uninstall']('p1'), { started: true, name: 'Tool' });
  await assert.rejects(h['programs:uninstall']({ id: 'p1' }), /Programm/);
  assert.deepEqual(calls.programs, ['p1']);
});
