const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { measureContents, removeContents } = require('./walk');
const { powershellPath, whoamiPath } = require('../system-tools');

const execFileAsync = promisify(execFile);

// Which folders count as system junk. This is the safety-critical part of the
// app: every root listed here has its CONTENT deleted for good. Roots are
// therefore always exact cache/temp folders, never a parent that also holds
// user data (history, passwords, bookmarks, ...).

const HOUR_MS = 60 * 60 * 1000;
const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive'];

const CHROMIUM_CACHE_FOLDERS = ['Cache', 'Code Cache', 'GPUCache'];

// True only for a real folder. Links (symlinks, junctions) do not count, so a
// root can never be a link that points somewhere else.
async function isRealDirectory(p) {
  try {
    return (await fs.promises.lstat(p)).isDirectory();
  } catch {
    return false;
  }
}

// Names of the real sub-folders of `dir`; empty if `dir` is missing or unreadable.
async function listSubfolders(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function onlyExistingDirectories(candidates) {
  const result = [];
  for (const candidate of candidates) {
    if (await isRealDirectory(candidate)) result.push(candidate);
  }
  return result;
}

async function browserRoots(localAppData) {
  const candidates = [];

  // Chromium browsers: only the profile folders, never "System Profile" or the
  // files next to them.
  const chromiumUserData = [
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    path.join(localAppData, 'Google', 'Chrome', 'User Data'),
  ];
  for (const userData of chromiumUserData) {
    for (const name of await listSubfolders(userData)) {
      if (name !== 'Default' && !name.startsWith('Profile ')) continue;
      for (const cacheFolder of CHROMIUM_CACHE_FOLDERS) {
        candidates.push(path.join(userData, name, cacheFolder));
      }
    }
  }

  const firefoxProfiles = path.join(localAppData, 'Mozilla', 'Firefox', 'Profiles');
  for (const name of await listSubfolders(firefoxProfiles)) {
    candidates.push(path.join(firefoxProfiles, name, 'cache2'));
  }

  return onlyExistingDirectories(candidates);
}

// Builds the category list for one environment. The environment is a parameter
// (not read from process.env) so that tests can point it at temp folders.
function getCategories(env) {
  const fixed = (...parts) => async () => [path.join(...parts)];
  const werRoot = path.join(env.ProgramData, 'Microsoft', 'Windows', 'WER');

  return [
    {
      id: 'userTemp',
      label: 'Temporäre Dateien',
      admin: false,
      minAgeMs: 24 * HOUR_MS,
      roots: async () => [env.TEMP],
    },
    {
      id: 'windowsTemp',
      label: 'Temporäre Dateien von Windows',
      admin: true,
      minAgeMs: 24 * HOUR_MS,
      roots: fixed(env.SystemRoot, 'Temp'),
    },
    {
      id: 'recycleBin',
      label: 'Papierkorb',
      admin: false,
      minAgeMs: 0,
      roots: async () => [...env.recycleRoots],
      ignoreTopLevel: isRecycleBinBookkeeping,
    },
    {
      id: 'browserCache',
      label: 'Browser-Cache',
      admin: false,
      minAgeMs: 0,
      roots: () => browserRoots(env.LOCALAPPDATA),
    },
    {
      id: 'windowsUpdate',
      label: 'Reste von Windows-Updates',
      admin: true,
      minAgeMs: 0,
      roots: fixed(env.SystemRoot, 'SoftwareDistribution', 'Download'),
    },
    {
      id: 'crashDumpsUser',
      label: 'Absturzberichte',
      admin: false,
      minAgeMs: 0,
      roots: fixed(env.LOCALAPPDATA, 'CrashDumps'),
    },
    {
      id: 'crashReportsWindows',
      label: 'Absturzberichte von Windows',
      admin: true,
      minAgeMs: 0,
      roots: async () => ['ReportArchive', 'ReportQueue', 'Temp'].map((name) => path.join(werRoot, name)),
    },
  ];
}

// desktop.ini and the $I… files (one per deleted item, they only record where
// it came from) are always in the recycle bin; they must not make an empty
// recycle bin look full.
function isRecycleBinBookkeeping(name) {
  return name.toLowerCase() === 'desktop.ini' || name.slice(0, 2).toUpperCase() === '$I';
}

async function measureCategory(cat, { signal, now } = {}) {
  let bytes = 0;
  let files = 0;
  let unreadable = false;
  for (const root of await cat.roots()) {
    const part = await measureContents(root, {
      minAgeMs: cat.minAgeMs, now, signal, ignore: cat.ignoreTopLevel,
    });
    bytes += part.bytes;
    files += part.files;
    if (part.unreadable) unreadable = true;
  }
  return { id: cat.id, bytes, files, unreadable };
}

// The PowerShell command that empties the recycle bin of the drives the given
// recycle bin folders lie on. One call per drive, each in its own try/catch,
// and a fixed exit code 0: PowerShell reports exit code 1 as soon as the last
// command failed (an empty bin or a drive without one is enough), even with
// -ErrorAction SilentlyContinue. How much was really freed is measured by the
// caller, so nothing is hidden by this.
function recycleBinCommand(recycleRoots) {
  const letters = new Set();
  for (const root of recycleRoots ?? []) {
    const match = /^([A-Za-z]):[\\/]/.exec(String(root));
    if (match) letters.add(match[1].toUpperCase());
  }
  const calls = [...letters].map(
    (letter) => `try { Clear-RecycleBin -DriveLetter ${letter} -Force -ErrorAction Stop } catch { }`,
  );
  return [...calls, 'exit 0'].join('; ');
}

// Default emptier: Windows' own Clear-RecycleBin. Never run by the tests.
async function clearRecycleBinWithPowerShell(recycleRoots) {
  await execFileAsync(powershellPath(), [
    ...POWERSHELL_ARGS,
    '-Command',
    recycleBinCommand(recycleRoots),
  ], { windowsHide: true });
}

// Deletes the content of a category for good. Admin categories are refused
// here: they need an elevated helper and must never be attempted in-process.
async function cleanCategory(cat, { now, emptyRecycleBin = clearRecycleBinWithPowerShell } = {}) {
  if (cat.admin) {
    throw new Error(`Category ${cat.id} needs administrator rights and cannot be cleaned here`);
  }

  if (cat.id === 'recycleBin') {
    const before = await measureCategory(cat, { now });
    await emptyRecycleBin(await cat.roots());
    const after = await measureCategory(cat, { now });
    return {
      id: cat.id,
      freedBytes: Math.max(0, before.bytes - after.bytes),
      deleted: 0,
      skipped: 0,
    };
  }

  let freedBytes = 0;
  let deleted = 0;
  let skipped = 0;
  for (const root of await cat.roots()) {
    const part = await removeContents(root, { minAgeMs: cat.minAgeMs, now });
    freedBytes += part.freedBytes;
    deleted += part.deleted;
    skipped += part.skipped;
  }
  return { id: cat.id, freedBytes, deleted, skipped };
}

// The current user's recycle bin folders: X:\$Recycle.Bin\<own SID> for every
// drive letter where that folder exists. Only lists paths, deletes nothing.
async function getRecycleRoots() {
  const { stdout } = await execFileAsync(whoamiPath(), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
  // Output looks like: "DOMAIN\user","S-1-5-21-..."
  const match = /"(S-\d+(?:-\d+)+)"/.exec(stdout);
  if (!match) throw new Error(`Could not read the user SID from: ${stdout.trim()}`);
  const sid = match[1];

  const candidates = [];
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
    candidates.push(`${String.fromCharCode(code)}:\\$Recycle.Bin\\${sid}`);
  }
  return onlyExistingDirectories(candidates);
}

module.exports = {
  getCategories, measureCategory, cleanCategory, getRecycleRoots, recycleBinCommand,
};
