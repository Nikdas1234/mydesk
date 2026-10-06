const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { powershellPath } = require('./system-tools');

const execFileAsync = promisify(execFile);

const MB = 1024 * 1024;
const SCAN_NAMES = ['junk', 'downloads', 'mail', 'programs'];

// Sandbox replacement for the UAC launcher: runs the same encoded script, but
// without elevation. In the sandbox there is never a UAC prompt.
async function launchUnelevated(encoded) {
  await execFileAsync(
    powershellPath(),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { windowsHide: true },
  );
}

function isAbortError(err) {
  return Boolean(err) && err.name === 'AbortError';
}

function assertStringList(value, what) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${what} must be a list of strings`);
  }
}

// Builds one handler per channel. Everything the handlers need is passed in
// (no `require('electron')` here), see deps below:
//  settings, junk, elevated, downloads: the modules from src/main
//  paths:    result of resolvePaths()
//  remover:  createRemover(...); only what a scan registered may be deleted
//  mail:     createMailService(...); checks mailboxes, unsubscribes
//  showItemInFolder(path), send(channel, payload): from Electron
// A handler that throws rejects its promise; the caller passes the message on.
function createHandlers(deps) {
  const {
    settings, paths, junk, elevated, downloads, remover, showItemInFolder, send, mail, updater, history, drives, applyTheme, programs,
  } = deps;

  // name -> AbortController of the scan that is running right now.
  const running = new Map();

  // Runs one scan. A new scan of the same kind cancels the running one first.
  // Resolves with { cancelled: true } if the scan was cancelled; a cancelled
  // scan never gets to `finish`, so it registers nothing.
  async function runScan(name, scan, finish = (result) => result) {
    running.get(name)?.abort();
    const controller = new AbortController();
    running.set(name, controller);
    try {
      const result = await scan(controller.signal);
      if (controller.signal.aborted) return { cancelled: true };
      history.markChecked(name);
      return finish(result);
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return { cancelled: true };
      throw err;
    } finally {
      if (running.get(name) === controller) running.delete(name);
    }
  }

  // The recycle bin is only offered if its folders are known (real mode) or
  // when practising; a category that cannot be measured must not be emptied.
  function junkCategories() {
    const all = junk.getCategories(paths.junkEnv);
    const offered = paths.sandbox || paths.junkEnv.recycleRoots.length > 0;
    return offered ? all : all.filter((cat) => cat.id !== 'recycleBin');
  }

  async function scanJunk() {
    const categories = junkCategories();
    return runScan('junk', async (signal) => {
      const rows = [];
      for (const cat of categories) {
        const m = await junk.measureCategory(cat, { signal });
        rows.push({
          id: cat.id, label: cat.label, admin: cat.admin, bytes: m.bytes, files: m.files, unreadable: m.unreadable,
        });
      }
      return rows;
    });
  }

  async function cleanJunk(ids) {
    assertStringList(ids, 'ids');
    const categories = junkCategories();
    // Check every id first: an unknown id must not leave a half-done clean-up.
    const selected = [...new Set(ids)].map((id) => {
      const cat = categories.find((c) => c.id === id);
      if (!cat) throw new Error(`Unknown category: ${id}`);
      return cat;
    });

    // In the sandbox the recycle bin is never really emptied.
    const emptyRecycleBin = paths.sandbox ? async () => {} : undefined;
    const results = [];
    for (const cat of selected.filter((c) => !c.admin)) {
      results.push(await junk.cleanCategory(cat, { emptyRecycleBin }));
    }

    const adminCategories = selected.filter((c) => c.admin);
    let declinedIds = [];
    let unknownIds = [];
    if (adminCategories.length > 0) {
      const launch = paths.sandbox ? launchUnelevated : undefined;
      const outcome = await elevated.runElevated(adminCategories, { launch });
      if (outcome.declined) declinedIds = adminCategories.map((c) => c.id);
      else if (outcome.unknown) unknownIds = adminCategories.map((c) => c.id);
      else results.push(...outcome.results);
    }
    history.addFreed(results.reduce((total, row) => total + (row.freedBytes ?? 0), 0));
    return { results, declinedIds, unknownIds };
  }

  async function scanDownloads() {
    return runScan(
      'downloads',
      (signal) => downloads.findOldDownloads(paths.downloadsDir, {
        maxAgeDays: settings.load().downloadsMaxAgeDays,
        signal,
      }),
      (entries) => {
        remover.register('downloads', entries);
        return entries;
      },
    );
  }

  async function scanMail() {
    return runScan('mail', (signal) => mail.scan({
      signal,
      onProgress: (progress) => send('mail:progress', progress),
    }));
  }

  async function cancel(name) {
    if (!SCAN_NAMES.includes(name)) throw new Error(`Unknown scan: ${JSON.stringify(name)}`);
    running.get(name)?.abort();
  }

  async function showInFolder(target) {
    if (typeof target !== 'string' || !remover.isRegistered(target)) {
      throw new Error(`Path is not registered: ${JSON.stringify(target)}`);
    }
    showItemInFolder(target);
  }

  async function trash(kind, targets) {
    assertStringList(targets, 'paths');
    const result = await remover.trash(kind, targets);
    history.addFreed(result.freedBytes);
    return result;
  }

  return {
    'app:info': async () => ({ sandbox: Boolean(paths.sandbox), sandboxDir: paths.sandboxDir ?? null }),
    'settings:get': async () => settings.load(),
    'settings:set': async (patch) => {
      const saved = settings.save(patch);
      applyTheme(saved.theme);
      return saved;
    },
    'history:get': async () => history.get(),
    'programs:scan': () => runScan('programs', () => programs.list()),
    'programs:uninstall': async (id) => {
      if (typeof id !== 'string') throw new Error('Kein Programm angegeben.');
      return programs.uninstall(id);
    },
    'drives:list': async () => drives.listDrives(),
    'junk:scan': scanJunk,
    'junk:clean': cleanJunk,
    'downloads:scan': scanDownloads,
    'downloads:trash': (targets) => trash('downloads', targets),
    'mail:accounts:list': () => mail.listAccounts(),
    'mail:accounts:save': (account) => mail.saveAccount(account),
    'mail:accounts:remove': (id) => mail.removeAccount(id),
    'mail:accounts:test': (id) => mail.testAccount(id),
    'mail:scan': scanMail,
    'mail:text': (ref) => mail.readText(ref),
    // Either the sender key, or { key, browser: true } to open the web link.
    'mail:unsubscribe': (arg) => (typeof arg === 'string'
      ? mail.unsubscribe(arg, { browser: false })
      : mail.unsubscribe(arg?.key, { browser: arg?.browser === true })),
    'mail:removeSender': (key) => mail.removeSender(key),
    'mail:removeUnsubscribed': () => mail.removeUnsubscribed(),
    'mail:label': (decision) => mail.label(decision),
    'mail:resetLearning': () => mail.resetLearning(),
    'mail:learned': () => mail.learned(),
    'update:state': async () => updater.state(),
    'update:check': async () => {
      await updater.check();
      return updater.state();
    },
    'update:download': () => updater.download(),
    'update:install': async () => updater.install(),
    'scan:cancel': cancel,
    'shell:show': showInFolder,
  };
}

module.exports = { createHandlers };
